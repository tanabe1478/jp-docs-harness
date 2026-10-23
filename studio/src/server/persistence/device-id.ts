import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// OpenAI の Sign in with ChatGPT はインストールごとに固定の ID を求める。初回に作り、以後は同じ値を返す。
export function getDeviceId(dataRoot: string): string {
  const file = path.join(dataRoot, "device-id");
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    try {
      writeFileSync(file, `${id}\n`, { flag: "wx", mode: 0o600 });
      return id;
    } catch {
      // 別のプロセスが同時に作った場合は、そちらを使う。
      return readFileSync(file, "utf8").trim();
    }
  }
}
