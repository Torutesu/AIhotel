import { expect, type Page } from "@playwright/test"

/** seed のデモアカウント（本番には投入しない — AGENTS.md） */
export const ACCOUNTS = {
  admin: "admin@demo-hotel.example.com",
  manager: "manager@demo-hotel.example.com",
  operator: "operator@demo-hotel.example.com",
} as const
export const DEMO_PASSWORD = "Admin1234"

export async function login(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/")
  await page.getByLabel("メールアドレス").fill(email)
  await page.getByLabel("パスワード").fill(password)
  await page.getByRole("button", { name: "ログイン" }).click()
  await expect(page.getByRole("button", { name: "ダッシュボード" })).toBeVisible()
}

/** 画面が描画されている間のコンソールエラー・5xx 応答を集める（最後に空であることを確かめる） */
export function collectProblems(page: Page): string[] {
  const problems: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text()}`)
  })
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`))
  page.on("response", (res) => {
    if (res.status() >= 500) problems.push(`${res.status()} ${res.url()}`)
  })
  return problems
}
