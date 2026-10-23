import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect, type Page } from "@playwright/test";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export type Studio = {
  url: string;
  workspace: string;
  dataDir: string;
  aiCalls(): Promise<Array<{ action: string; selection: string; surroundingContext: string; turns: unknown[] }>>;
  readFile(relative: string): Promise<string>;
  writeFile(relative: string, content: string): Promise<void>;
};

type Options = { aiEnabled: boolean; files: Record<string, string> };

async function startStudio(options: Options): Promise<{ studio: Studio; stop(): Promise<void> }> {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "jp-docs-studio-e2e-")));
  const workspace = path.join(base, "workspace");
  const dataDir = path.join(base, "data");
  await fs.mkdir(workspace);
  await fs.mkdir(dataDir);
  for (const [relative, content] of Object.entries(options.files)) {
    await fs.mkdir(path.dirname(path.join(workspace, relative)), { recursive: true });
    await fs.writeFile(path.join(workspace, relative), content, "utf8");
  }
  const args = ["tests/e2e/server.ts", "--workspace", workspace, "--data", dataDir];
  if (!options.aiEnabled) args.push("--no-ai");
  const child: ChildProcess = spawn(process.execPath, args, { cwd: studioRoot, stdio: ["ignore", "pipe", "pipe"] });
  const ready = await new Promise<{ url: string; control: number }>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`サーバーが起動しませんでした:\n${output}`)), 15_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const match = /studio ready (\S+) control (\d+)/.exec(output);
      if (match?.[1] && match[2]) {
        clearTimeout(timer);
        resolve({ url: match[1], control: Number(match[2]) });
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => reject(new Error(`サーバーが終了しました (${code}):\n${output}`)));
  });
  const studio: Studio = {
    url: ready.url,
    workspace,
    dataDir,
    aiCalls: async () => (await fetch(`http://127.0.0.1:${ready.control}/calls`)).json(),
    readFile: (relative) => fs.readFile(path.join(workspace, relative), "utf8"),
    writeFile: (relative, content) => fs.writeFile(path.join(workspace, relative), content, "utf8"),
  };
  return {
    studio,
    stop: async () => {
      child.kill();
      await fs.rm(base, { recursive: true, force: true });
    },
  };
}

export const SAMPLE = [
  "# 文章を書くということ",
  "",
  "私は、AIが文章を完成させてくれることよりも、AIとの対話を通じて自分の考えが明確になることに価値を感じている。",
  "",
  "しかし、AIと対話することが、いつも思考を深めるとは限らない。",
  "",
  "では、どのような対話に価値があるのだろうか。",
  "",
].join("\n");

export const test = base.extend<Options & { studio: Studio }>({
  aiEnabled: [true, { option: true }],
  files: [{ "考えるということ.md": SAMPLE }, { option: true }],
  studio: async ({ aiEnabled, files }, use) => {
    const { studio, stop } = await startStudio({ aiEnabled, files });
    await use(studio);
    await stop();
  },
});

export { expect };

export async function openDocument(page: Page, studio: Studio, name: string) {
  await page.goto(studio.url);
  await page.getByRole("button", { name }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

// 指定した文を含む行を、キーボードで行頭から行末まで選ぶ。
export async function selectLine(page: Page, text: string) {
  const line = page.locator(".cm-line", { hasText: text });
  const box = await line.boundingBox();
  if (!box) throw new Error(`行が見つかりません: ${text}`);
  await page.mouse.click(box.x + 4, box.y + box.height / 2);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
}

export async function waitSaved(page: Page) {
  await expect(page.getByTestId("save-status")).toHaveText("保存済み");
}

export async function lineBoxes(page: Page) {
  return page.locator(".cm-line").evaluateAll((lines) =>
    lines.map((line) => {
      const rect = line.getBoundingClientRect();
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, text: line.textContent };
    }),
  );
}
