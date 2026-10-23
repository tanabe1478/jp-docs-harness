import fs from "node:fs/promises";
import path from "node:path";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { writeFileAtomic } from "./atomic-write.ts";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 10_000;

type CredentialFile = { schemaVersion: 1; credentials: Record<string, Credential> };

// pi-ai の CredentialStore を、Studio のデータ置き場の JSON ファイルで実装する。
// トークンの更新は modify の中で行われるため、サーバーと npm run login の両方が
// 同時に書かないよう、プロセス内の直列化とロックファイルの両方で守る。
export class FileCredentialStore implements CredentialStore {
  readonly filePath: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return (await this.load()).credentials[providerId];
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const { credentials } = await this.load();
    return Object.entries(credentials).map(([providerId, credential]) => ({ providerId, type: credential.type }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.serialize(async () => {
      const release = await this.lock(options?.signal);
      try {
        const data = await this.load();
        const next = await fn(data.credentials[providerId]);
        if (next === undefined) delete data.credentials[providerId];
        else data.credentials[providerId] = next;
        await this.save(data);
        return next;
      } finally {
        await release();
      }
    });
  }

  async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    await this.modify(providerId, async () => undefined, options);
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.catch(() => undefined).then(task);
    this.chain = run;
    return run;
  }

  private async load(): Promise<CredentialFile> {
    let source: string;
    try {
      source = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, credentials: {} };
      throw error;
    }
    const parsed = JSON.parse(source) as Partial<CredentialFile>;
    if (parsed.schemaVersion !== 1 || typeof parsed.credentials !== "object" || parsed.credentials === null) {
      throw new Error(`ログイン情報の形式が想定と異なります: ${this.filePath}`);
    }
    return { schemaVersion: 1, credentials: parsed.credentials };
  }

  private async save(data: CredentialFile): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  }

  private async lock(signal?: AbortSignal): Promise<() => Promise<void>> {
    const lockPath = `${this.filePath}.lock`;
    await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      signal?.throwIfAborted();
      try {
        const handle = await fs.open(lockPath, "wx", 0o600);
        await handle.writeFile(String(process.pid));
        await handle.close();
        return () => fs.rm(lockPath, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      // 落ちたプロセスが残したロックは、一定時間を過ぎたら取り除く。
      const stat = await fs.stat(lockPath).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        await fs.rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`ログイン情報のロックを取得できません: ${lockPath}`);
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
}

export function credentialFilePath(dataRoot: string): string {
  return path.join(dataRoot, "credentials.json");
}
