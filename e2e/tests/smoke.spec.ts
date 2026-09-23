import { expect, test } from "@playwright/test"

import { ACCOUNTS, collectProblems, login } from "./helpers"

// 主要な画面が3ロールで描画でき、ロールに応じて操作が出し分けられていることを確かめる（#87）

const TABS: Array<{ tab: string; heading: RegExp }> = [
  { tab: "dashboard", heading: /KPI進捗状況/ },
  { tab: "pricing", heading: /ダイナミックプライシング/ },
  { tab: "analysis", heading: /分析/ },
  { tab: "reports", heading: /レポート/ },
  { tab: "settings", heading: /設定/ },
]

for (const [role, email] of Object.entries(ACCOUNTS)) {
  test(`${role}: 主要タブがエラーなく描画される`, async ({ page }) => {
    const problems = collectProblems(page)
    await login(page, email)
    for (const { tab, heading } of TABS) {
      await page.goto(`/?tab=${tab}`)
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible()
      // 取得失敗の表示（ErrorState は role=alert）が出ていないこと
      await expect(page.getByText("再試行")).toHaveCount(0)
    }
    expect(problems).toEqual([])
  })
}

test("オペレーターには変更系の操作が出ない", async ({ page }) => {
  await login(page, ACCOUNTS.operator)
  await page.goto("/?tab=pricing")
  await expect(page.getByRole("heading", { name: /ダイナミックプライシング/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /AI予測値へリセット/ })).toHaveCount(0)
  await expect(page.locator('button[aria-label*="を編集"]')).toHaveCount(0)

  await page.goto("/?tab=settings")
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible()
  await expect(page.getByText("ユーザー管理")).toHaveCount(0)
  await expect(page.getByRole("button", { name: /CSV を選択/ })).toHaveCount(0)
})

test("マネージャーは月次レポートの PDF をダウンロードできる", async ({ page }) => {
  await login(page, ACCOUNTS.manager)
  await page.goto("/?tab=reports")
  const downloadPromise = page.waitForEvent("download")
  // 出力形式の既定は PDF
  await page.getByRole("button", { name: "レポートをダウンロード" }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.pdf$/)
})

test("ログアウトするとログイン画面に戻り、再読み込みしてもログインしたままにならない", async ({ page }) => {
  await login(page, ACCOUNTS.admin)
  await page.getByRole("button", { name: "ログアウト" }).first().click()
  // 破壊的操作の確認ダイアログ（F-5）
  await page.getByRole("alertdialog").getByRole("button", { name: "ログアウト" }).click()
  await expect(page.getByRole("button", { name: "ログイン" })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("button", { name: "ログイン" })).toBeVisible()
})
