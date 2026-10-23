import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  insightSchema,
  proposalRecordSchema,
  threadRecordSchema,
  type Insight,
  type ProposalRecord,
  type ThreadRecord,
} from "../../shared/schemas.ts";
import { StudioError } from "../errors.ts";
import { writeFileAtomic } from "./atomic-write.ts";

export const STORE_SCHEMA_VERSION = 1;

const storeSchema = z.object({
  schemaVersion: z.literal(STORE_SCHEMA_VERSION),
  workspaceRoot: z.string(),
  threads: z.array(threadRecordSchema),
  insights: z.array(insightSchema),
  proposals: z.array(proposalRecordSchema),
});

export type StoreData = {
  schemaVersion: typeof STORE_SCHEMA_VERSION;
  workspaceRoot: string;
  threads: ThreadRecord[];
  insights: Insight[];
  proposals: ProposalRecord[];
};

export type Store = {
  readonly filePath: string;
  snapshot(): StoreData;
  update<T>(mutate: (draft: StoreData) => T): Promise<T>;
};

export async function openStore(directory: string, workspaceRoot: string): Promise<Store> {
  const filePath = path.join(directory, "studio.json");
  await fs.mkdir(directory, { recursive: true });

  let data: StoreData;
  let source: string | undefined;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (source === undefined) {
    data = { schemaVersion: STORE_SCHEMA_VERSION, workspaceRoot, threads: [], insights: [], proposals: [] };
  } else {
    // 壊れたメタデータを空で上書きすると対話履歴を失う。読めないときは起動を止める。
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new Error(`対話データを読み取れません（JSON が壊れています）: ${filePath}`);
    }
    const result = storeSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`対話データの形式が想定と異なります: ${filePath}\n${result.error.message}`);
    }
    data = result.data;
  }

  let queue: Promise<unknown> = Promise.resolve();

  return {
    filePath,
    snapshot: () => structuredClone(data),
    // 下書きへ変更を加えて保存し、保存に成功してからメモリ上の状態を差し替える。
    update<T>(mutate: (draft: StoreData) => T): Promise<T> {
      const run = queue.catch(() => undefined).then(async () => {
        const draft = structuredClone(data);
        const result = mutate(draft);
        try {
          await writeFileAtomic(filePath, `${JSON.stringify(draft, null, 2)}\n`);
        } catch {
          throw new StudioError("store_unwritable", "対話データを保存できませんでした", 500);
        }
        data = draft;
        return result;
      });
      queue = run;
      return run;
    },
  };
}
