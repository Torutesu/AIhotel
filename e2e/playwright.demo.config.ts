import { defineConfig, devices } from "@playwright/test"

// 実物のNextルート・Cookie・暗号化を通す。保存先だけローカルメモリ。
export default defineConfig({
  testDir: "./demo-tests",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: "http://localhost:3100",
    ...devices["Desktop Chrome"],
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    { command: "node fixtures/demo-kv.mjs", url: "http://127.0.0.1:4199", reuseExistingServer: false },
    {
      command: "pnpm --filter frontend dev --port 3100", url: "http://localhost:3100", timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_DEMO_MODE: "true", NEXT_PUBLIC_DEMO_ADMIN_CONSOLE: "true",
        DEMO_ADMIN_EMAIL: "owner@example.test", DEMO_PUBLIC_URL: "https://public.example.test",
        DEMO_TRIAL_CREDENTIALS_KEY: "e".repeat(64),
        KV_REST_API_URL: "http://127.0.0.1:4199", KV_REST_API_TOKEN: "local-e2e-only",
        BACKEND_URL: "http://127.0.0.1:4198",
      },
    },
  ],
})
