// ChatGPT のサブスクリプションで AI を使うためのログイン（npm run login）とログアウト（npm run logout）。
// ログイン情報は Studio のデータ置き場の credentials.json（権限 0600）に保存し、ブラウザには渡さない。
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { createModels } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { defaultDataRoot } from "./persistence/data-dir.ts";
import { FileCredentialStore, credentialFilePath } from "./persistence/credential-store.ts";

const dataRoot = defaultDataRoot();
const store = new FileCredentialStore(credentialFilePath(dataRoot));
const models = createModels({ credentials: store });
models.setProvider(openaiProvider());

if (process.argv.includes("--logout")) {
  await models.logout("openai");
  process.stdout.write(`ChatGPT からログアウトしました（${store.filePath}）\n`);
  process.exit(0);
}

const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
try {
  await models.login("openai", "oauth", {
    async prompt(request) {
      // 端末から入力できないときは手入力を待たず、ブラウザからのコールバックだけで完了させる。
      if (!process.stdin.isTTY) {
        return new Promise<string>((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => reject(new Error("入力は使いません")), { once: true });
        });
      }
      if (request.type === "select") {
        const choices = request.options.map((option, index) => `  ${index + 1}. ${option.label}`).join("\n");
        const answer = await terminal.question(`${request.message}\n${choices}\n番号: `, { signal: request.signal ?? new AbortController().signal });
        return request.options[Number(answer) - 1]?.id ?? "";
      }
      return terminal.question(`${request.message} `, { signal: request.signal ?? new AbortController().signal });
    },
    notify(event) {
      if (event.type === "auth_url") {
        process.stdout.write(`\nブラウザで次の URL を開き、ChatGPT にログインしてください。\n${event.url}\n\n`);
        openBrowser(event.url);
      } else if (event.type === "device_code") {
        process.stdout.write(`${event.verificationUri} でコード ${event.userCode} を入力してください\n`);
      } else {
        process.stdout.write(`${event.message}\n`);
      }
    },
  }, { getDeviceId, agentName: "jp-docs Studio" });
  process.stdout.write(`\nログインしました（${store.filePath}）。Studio を起動し直すと ChatGPT で応答します。\n`);
} catch (error) {
  process.stderr.write(`ログインできませんでした: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  terminal.close();
}

// OpenAI はインストールごとに固定の ID を求める。初回に作り、以後は同じ値を返す。
function getDeviceId(): string {
  const file = path.join(dataRoot, "device-id");
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    writeFileSync(file, `${id}\n`, { flag: "wx", mode: 0o600 });
    return id;
  }
}

function openBrowser(url: string) {
  // URL はシェルを通さず引数で渡す。開けなくても上に表示した URL から続けられる。
  const command = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : null;
  if (!command) return;
  const child = spawn(command, [url], { stdio: "ignore", detached: true, shell: false });
  child.on("error", () => undefined);
  child.unref();
}
