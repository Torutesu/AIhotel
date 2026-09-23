import { defineConfig, devices } from "@playwright/test"

// E2E スモークテスト（#87）。
// frontend（:3000）と backend（:3001）が起動済みで、seed 済みの DB につながっている前提。
// CI では e2e ジョブが Postgres・migrate・seed・両サーバーの起動まで行ってから実行する。
// 手元では `pnpm --filter @hotel-revenue-system/e2e test`（E2E_BASE_URL で接続先を変えられる）。
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // seed のデモアカウントを共有するため、ファイルをまたいで並列にしない
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // ブラウザが事前に用意されている環境では、そのパスを使う（未指定なら Playwright が入れたものを使う）
        launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
      },
    },
  ],
})
