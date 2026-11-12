// 画面の描画が要るサイト用のブラウザ（D-13 — 自前巡回の基盤）。Playwright は本番イメージに入れていないので、
// 入れたときだけ使える（npm の playwright とブラウザを足したイメージで動かす）。入っていなければ null を返す。
// 決まった手順（ページを開く→決まった要素を読む）にだけ使う。画面を見て操作するエージェント（PC Use）にはしない（types.ts の約束）。
// robots.txt の確認と間隔の制御は呼び出し側（scriptedSource.ts）が PoliteFetcher で行う。

export interface BrowserPage {
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeout?: number }): Promise<unknown>
  content(): Promise<string>
  close(): Promise<void>
}

export interface BrowserSession {
  newPage(): Promise<BrowserPage>
  close(): Promise<void>
}

interface PlaywrightLike {
  chromium: {
    launch(options?: Record<string, unknown>): Promise<{
      newContext(options?: Record<string, unknown>): Promise<{ newPage(): Promise<BrowserPage> }>
      close(): Promise<void>
    }>
  }
}

/** Playwright が入っていれば起動する。無ければ null（取得元はブラウザを使わない取り方に倒すか、失敗にする） */
export async function launchBrowser(userAgent: string): Promise<BrowserSession | null> {
  let playwright: PlaywrightLike
  try {
    // 依存に入れていないので、名前を変数にして型の解決とバンドルの対象から外す
    const name = 'playwright'
    playwright = (await import(name)) as PlaywrightLike
  } catch {
    return null
  }
  const browser = await playwright.chromium.launch({ headless: true })
  const context = await browser.newContext({ userAgent, locale: 'ja-JP' })
  return {
    newPage: () => context.newPage(),
    close: () => browser.close(),
  }
}
