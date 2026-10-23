import { defineConfig, devices } from "@playwright/test";

// 各テストが tests/e2e/fixtures.ts で一時 workspace とサーバーを起動する。
// 画面は事前に npm run build したものを使う（npm run test:e2e がビルドも行う）。
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    locale: "ja-JP",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium" }],
});
