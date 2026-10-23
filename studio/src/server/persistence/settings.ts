import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomic-write.ts";

// 画面から変えられる AI の設定。環境変数が設定されていれば、そちらを優先する。
const settingsSchema = z.object({
  schemaVersion: z.literal(1),
  model: z.string().min(1).max(200).optional(),
  ai: z.enum(["chatgpt", "openai-api"]).optional(),
});
export type StudioSettings = z.infer<typeof settingsSchema>;

export function settingsFilePath(dataRoot: string): string {
  return path.join(dataRoot, "settings.json");
}

export async function readSettings(file: string): Promise<StudioSettings> {
  let source: string;
  try {
    source = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1 };
    throw error;
  }
  const parsed = settingsSchema.safeParse(JSON.parse(source));
  if (!parsed.success) throw new Error(`設定ファイルの形式が想定と異なります: ${file}`);
  return parsed.data;
}

export async function writeSettings(file: string, settings: StudioSettings): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFileAtomic(file, `${JSON.stringify(settingsSchema.parse(settings), null, 2)}\n`, { mode: 0o600 });
}
