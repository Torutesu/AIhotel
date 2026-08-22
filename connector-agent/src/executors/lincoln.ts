import * as path from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'
import type {
  ClaimedJob,
  LincolnDefinition,
  SyncPriceRankItem,
  WriteJobPayload,
} from '@hotel-revenue-system/shared/types'
import { sanitizeHtml } from '../sanitize.js'
import type { ExecOutcome } from './types.js'

// リンカーン（Web）実行器 — 定義駆動のPlaywright自動化（設計書 §3.1）。
// セレクタは backend 配信の LincolnDefinition から取り、コードに埋め込まない。
// 原則: 決定的スクリプトのみ。判断に迷う状態は必ず FAILED + 証跡で返し、勝手に続行しない。

const NAV_TIMEOUT_MS = 30_000
// 人間の操作速度に律速する最低ウェイト（不正検知・負荷起因のブロック予防 — §10.3）
const HUMAN_PACE_MS = 1_500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parsePrice(text: string): number | null {
  const digits = text.replace(/[^\d]/g, '')
  if (digits.length === 0) return null
  return parseInt(digits, 10)
}

/** 'HH:mm'-'HH:mm' のメンテ窓に現在時刻（ローカル=JST想定のクライアントPC）が入っているか */
export function isInMaintenanceWindow(
  windows: Array<{ start: string; end: string }>,
  now: Date
): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes()
  return windows.some((w) => {
    const [sh, sm] = w.start.split(':').map(Number)
    const [eh, em] = w.end.split(':').map(Number)
    const start = sh * 60 + sm
    const end = eh * 60 + em
    // 日付跨ぎ（例 23:00-01:00）にも対応
    return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end
  })
}

export class LincolnExecutor {
  private context: BrowserContext | null = null

  constructor(
    private readonly dataDir: string,
    private readonly credentials: { user: string; password: string } | null,
    private readonly headless: boolean
  ) {}

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context
    this.context = await chromium.launchPersistentContext(path.join(this.dataDir, 'lincoln-profile'), {
      headless: this.headless,
      viewport: this.headless ? { width: 1280, height: 900 } : null,
    })
    return this.context
  }

  async close(): Promise<void> {
    await this.context?.close()
    this.context = null
  }

  async execute(job: ClaimedJob, def: LincolnDefinition): Promise<ExecOutcome> {
    if (isInMaintenanceWindow(def.maintenanceWindows, new Date())) {
      return { status: 'FAILED', errorCode: 'TARGET_MAINTENANCE', errorMessage: 'メンテナンス時間帯のため実行を見送りました' }
    }
    if (def.login.url.includes('placeholder.invalid')) {
      return {
        status: 'FAILED',
        errorCode: 'UNSUPPORTED',
        errorMessage: 'リンカーンのセレクタ定義が未確定です（recon調査の完了待ち）',
      }
    }

    const context = await this.ensureContext()
    const page = await context.newPage()
    page.setDefaultTimeout(NAV_TIMEOUT_MS)
    try {
      const loginOutcome = await this.ensureLoggedIn(page, def)
      if (loginOutcome) return loginOutcome

      if (job.direction === 'READ') {
        return await this.executeRead(page, def)
      }
      return await this.executeWrite(page, def, job)
    } catch (error) {
      return {
        status: 'FAILED',
        errorCode: this.classifyError(error),
        errorMessage: error instanceof Error ? error.message : String(error),
        evidence: await this.captureEvidence(page),
      }
    } finally {
      await page.close().catch(() => {})
    }
  }

  private classifyError(error: unknown): 'SELECTOR_MISMATCH' | 'NETWORK' | 'UNKNOWN' {
    const message = error instanceof Error ? error.message : String(error)
    if (/Timeout.*waiting for|locator|selector/i.test(message)) return 'SELECTOR_MISMATCH'
    if (/net::|NS_ERROR|ECONN|ETIMEDOUT|ERR_/i.test(message)) return 'NETWORK'
    return 'UNKNOWN'
  }

  private async captureEvidence(page: Page): Promise<ExecOutcome['evidence']> {
    try {
      return {
        html: sanitizeHtml(await page.content()),
        screenshotPng: await page.screenshot({ fullPage: true }),
        capturedAt: new Date().toISOString(),
      }
    } catch {
      return undefined
    }
  }

  /** ログイン状態を保証する。失敗時は ExecOutcome を返す（認証失敗は再試行禁止 — §11） */
  private async ensureLoggedIn(page: Page, def: LincolnDefinition): Promise<ExecOutcome | null> {
    await page.goto(def.login.url, { waitUntil: 'domcontentloaded' })
    await sleep(HUMAN_PACE_MS)

    if (await page.locator(def.login.loggedInSelector).count()) return null

    if (!this.credentials) {
      return {
        status: 'FAILED',
        errorCode: 'AUTH_FAILED',
        errorMessage: 'ログインが必要ですが資格情報が設定されていません',
      }
    }

    // 自動ログインは1回だけ試みる。失敗画面が出たら即停止（アカウントロックを自分で起こさない）
    await page.fill(def.login.userSelector, this.credentials.user)
    await page.fill(def.login.passwordSelector, this.credentials.password)
    await sleep(HUMAN_PACE_MS)
    await page.click(def.login.submitSelector)
    await page.waitForLoadState('domcontentloaded')
    await sleep(HUMAN_PACE_MS)

    if (await page.locator(def.login.errorSelector).count()) {
      return {
        status: 'FAILED',
        errorCode: 'AUTH_FAILED',
        errorMessage: 'ログインに失敗しました（自動再試行は行いません）',
        evidence: await this.captureEvidence(page),
      }
    }
    if (!(await page.locator(def.login.loggedInSelector).count())) {
      return {
        status: 'FAILED',
        errorCode: 'SELECTOR_MISMATCH',
        errorMessage: 'ログイン後の画面判定に失敗しました（画面変更の可能性）',
        evidence: await this.captureEvidence(page),
      }
    }
    return null
  }

  /** 料金ランク一覧をDOMから構造化して取得する */
  private async readRanks(page: Page, def: LincolnDefinition): Promise<SyncPriceRankItem[]> {
    await page.goto(def.read.url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(def.read.rowSelector)
    await sleep(HUMAN_PACE_MS)

    const rows = page.locator(def.read.rowSelector)
    const count = await rows.count()
    const items: SyncPriceRankItem[] = []
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i)
      const cellText = async (selector: string | undefined): Promise<string | null> => {
        if (!selector) return null
        const cell = row.locator(selector)
        if (!(await cell.count())) return null
        return (await cell.first().innerText()).trim()
      }

      const rankText = await cellText(def.read.cells.rank)
      const rank = rankText ? parseInt(rankText.replace(/[^\d]/g, ''), 10) : NaN
      if (!Number.isInteger(rank) || rank < 1) continue // ヘッダ行・空行はスキップ

      const price1P = parsePrice((await cellText(def.read.cells.price1P)) ?? '')
      const price2P = parsePrice((await cellText(def.read.cells.price2P)) ?? '')
      if (price1P === null || price2P === null) {
        throw new Error(`rank ${rank} の価格セルを解釈できません（画面変更の可能性）`)
      }
      items.push({
        rank,
        label: (await cellText(def.read.cells.label)) ?? undefined,
        price1P,
        price2P,
        price3P: parsePrice((await cellText(def.read.cells.price3P)) ?? ''),
        price4P: parsePrice((await cellText(def.read.cells.price4P)) ?? ''),
      })
    }
    if (items.length === 0) {
      throw new Error('料金ランクを1件も取得できません（画面変更の可能性）')
    }
    return items
  }

  private async executeRead(page: Page, def: LincolnDefinition): Promise<ExecOutcome> {
    const items = await this.readRanks(page, def)
    return {
      status: 'DONE',
      readData: { kind: 'PRICE_RANKS', capturedAt: new Date().toISOString(), items },
      evidence: await this.captureEvidence(page), // READ_RAW（再パース用バックアップ — §13.1）
    }
  }

  private async executeWrite(page: Page, def: LincolnDefinition, job: ClaimedJob): Promise<ExecOutcome> {
    if (!def.writeEnabled) {
      return {
        status: 'FAILED',
        errorCode: 'UNSUPPORTED',
        errorMessage: 'この定義バージョンではWRITEが許可されていません（READ実績の蓄積待ち — §10.1 L3）',
      }
    }
    const payload = job.payload as WriteJobPayload

    // 書き込み直前の前提値照合（スタッフの同時操作競合 — §11）。
    // ジョブ生成時点の現在値と実画面が食い違っていたら、上書きせず中断する
    const currentItems = await this.readRanks(page, def)
    const currentByRank = new Map(currentItems.map((item) => [item.rank, item]))
    if (payload.expectedCurrent) {
      for (const expected of payload.expectedCurrent) {
        const actual = currentByRank.get(expected.rank)
        if (!actual) continue
        if (actual.price1P !== expected.price1P || actual.price2P !== expected.price2P) {
          return {
            status: 'FAILED',
            errorCode: 'PRECONDITION_CHANGED',
            errorMessage: `rank ${expected.rank} の現在値がジョブ生成時点と異なります（同時操作の可能性）`,
            preWriteItems: currentItems,
          }
        }
      }
    }

    // 入力
    await page.goto(def.write.url, { waitUntil: 'domcontentloaded' })
    await sleep(HUMAN_PACE_MS)
    for (const item of payload.items) {
      const fill = async (template: string | undefined, value: number | null | undefined) => {
        if (!template || value === null || value === undefined) return
        await page.fill(template.replace('{rank}', String(item.rank)), String(value))
      }
      await fill(def.write.inputSelectors.price1P, item.price1P)
      await fill(def.write.inputSelectors.price2P, item.price2P)
      await fill(def.write.inputSelectors.price3P, item.price3P)
      await fill(def.write.inputSelectors.price4P, item.price4P)
    }
    await sleep(HUMAN_PACE_MS)

    if (job.dryRun) {
      // 入力まで行い送信しない（§6 dry-run）。入力後画面を証跡として返す
      return {
        status: 'DONE',
        writeVerification: { verifiedAt: new Date().toISOString(), itemResults: [] },
        evidence: await this.captureEvidence(page),
        preWriteItems: currentItems,
      }
    }

    await page.click(def.write.submitSelector)
    await page.waitForSelector(def.write.successSelector, { timeout: NAV_TIMEOUT_MS })
    await sleep(HUMAN_PACE_MS)

    // 読み戻し検証（write-after-write verify — §3.1）
    const afterItems = await this.readRanks(page, def)
    const afterByRank = new Map(afterItems.map((item) => [item.rank, item]))
    const itemResults = payload.items.map((item) => {
      const actual = afterByRank.get(item.rank)
      const ok =
        actual !== undefined &&
        actual.price1P === item.price1P &&
        actual.price2P === item.price2P &&
        (item.price3P == null || actual.price3P === item.price3P) &&
        (item.price4P == null || actual.price4P === item.price4P)
      return { rank: item.rank, ok, ...(ok ? {} : { message: '読み戻し値が書き込み値と一致しません' }) }
    })

    if (itemResults.some((r) => !r.ok)) {
      return {
        status: 'FAILED',
        errorCode: 'VERIFY_MISMATCH',
        errorMessage: `読み戻し検証で不一致: rank ${itemResults.filter((r) => !r.ok).map((r) => r.rank).join(', ')}`,
        evidence: await this.captureEvidence(page),
        preWriteItems: currentItems,
      }
    }

    return {
      status: 'DONE',
      writeVerification: { verifiedAt: new Date().toISOString(), itemResults },
      evidence: await this.captureEvidence(page),
      preWriteItems: currentItems,
    }
  }
}
