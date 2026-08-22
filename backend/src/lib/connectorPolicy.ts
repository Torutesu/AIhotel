import type { SyncDirection, SyncErrorCode } from '@hotel-revenue-system/shared/types'

// コネクタ連携の判断ロジック（純関数）— docs/コネクタ連携設計.md §10.4, §11, §14。
// DBアクセスを持たないため単体テスト可能。services/connectorJobService.ts と
// services/syncSweepService.ts がこの判断に従って副作用を実行する。

export type OpsSeverity = 'SEV1' | 'SEV2' | 'SEV3'

/** ジョブのリース時間。期限までに延長も結果報告もなければスイープが回収する */
export const JOB_LEASE_MS = 10 * 60 * 1000

/** READは冪等なので自動3回（§10.4）。WRITEは検証込みで最大1回の再実行＝計2回 */
export const READ_MAX_ATTEMPTS = 3
export const WRITE_MAX_ATTEMPTS = 2

/** デバイスheartbeat途絶の閾値（§10.2） */
export const DEVICE_DOWN_THRESHOLD_MS = 5 * 60 * 1000

/** 鮮度SLO（§10.5） */
export const STALE_READ_SEV2_MS = 12 * 60 * 60 * 1000
export const STALE_READ_SEV1_MS = 24 * 60 * 60 * 1000

/** READ連続失敗のSEV2閾値（§11） */
export const READ_FAILING_THRESHOLD = 3

/** スナップショット保持期限（§4）: READ_RAW/FAILURE_EVIDENCE 30日、PRE/POST_WRITE 90日 */
export const SNAPSHOT_RETENTION_MS: Record<string, number> = {
  READ_RAW: 30 * 24 * 60 * 60 * 1000,
  FAILURE_EVIDENCE: 30 * 24 * 60 * 60 * 1000,
  PRE_WRITE: 90 * 24 * 60 * 60 * 1000,
  POST_WRITE: 90 * 24 * 60 * 60 * 1000,
}

/** 指数バックオフ（1分 → 2分 → 4分 … 上限30分） */
export function computeBackoffMs(attemptCount: number): number {
  const base = 60 * 1000
  return Math.min(base * 2 ** Math.max(0, attemptCount - 1), 30 * 60 * 1000)
}

export interface OpsNotifyDirective {
  eventKey: string
  severity: OpsSeverity
  title: string
}

export interface FailureDecision {
  nextStatus: 'PENDING' | 'FAILED' | 'NEEDS_REVIEW' | 'CANCELLED'
  retryDelayMs?: number
  /** 当該ホテルのWRITEを自動凍結するか（誤反映の連鎖を止める — §10.4） */
  freezeWrites: boolean
  notify?: OpsNotifyDirective
}

/**
 * ジョブ失敗時の対応を決める（§11 エラー分類マトリクスの実装）。
 * 原則: READは積極リトライ・WRITEは保守的。「書けないこと」より「間違って書くこと」を恐れる。
 */
export function decideFailureHandling(input: {
  direction: SyncDirection
  errorCode: SyncErrorCode
  attemptCount: number
  maxAttempts: number
}): FailureDecision {
  const { direction, errorCode, attemptCount, maxAttempts } = input
  const canRetry = attemptCount < maxAttempts

  switch (errorCode) {
    // 認証失敗: 即停止。自動リトライでアカウントロックを絶対に起こさない（§11）
    case 'AUTH_FAILED':
      return {
        nextStatus: 'FAILED',
        freezeWrites: direction === 'WRITE',
        notify: {
          eventKey: 'AUTH_FAILED',
          severity: 'SEV1',
          title: '対象システムの認証に失敗しました（自動停止済み・要資格情報確認）',
        },
      }

    case 'CAPTCHA_BLOCKED':
      return {
        nextStatus: 'FAILED',
        freezeWrites: direction === 'WRITE',
        notify: {
          eventKey: 'CAPTCHA_BLOCKED',
          severity: 'SEV1',
          title: 'CAPTCHA/不正アクセス検知でブロックされました（自動停止済み）',
        },
      }

    // 書き込み検証不一致: リトライ1回 → NEEDS_REVIEW＋WRITE凍結（§10.4）
    case 'VERIFY_MISMATCH':
      if (canRetry) {
        return { nextStatus: 'PENDING', retryDelayMs: computeBackoffMs(attemptCount), freezeWrites: false }
      }
      return {
        nextStatus: 'NEEDS_REVIEW',
        freezeWrites: true,
        notify: {
          eventKey: 'VERIFY_MISMATCH',
          severity: 'SEV1',
          title: '書き込みの読み戻し検証が不一致です（当該ホテルのWRITEを凍結済み・ロールバック検討）',
        },
      }

    // 前提値不一致（スタッフの同時操作競合）: 上書きせず中断。
    // 最新値での再生成は価格確定ロジック側の責務なのでジョブはCANCELLED（§11）
    case 'PRECONDITION_CHANGED':
      return { nextStatus: 'CANCELLED', freezeWrites: false }

    // ガードレール違反（エージェント側検査）: 価格ロジックの異常出力を疑う（§15）
    case 'GUARDRAIL_VIOLATION':
      return {
        nextStatus: 'NEEDS_REVIEW',
        freezeWrites: direction === 'WRITE',
        notify: {
          eventKey: 'GUARDRAIL_VIOLATION',
          severity: 'SEV1',
          title: 'ガードレール違反の書き込みをブロックしました（価格ロジックの出力を要確認）',
        },
      }

    // 画面変更: リトライしても無駄。保留してL3自己修復/開発側対応へ（§11）
    case 'SELECTOR_MISMATCH':
      return {
        nextStatus: 'FAILED',
        freezeWrites: false,
        notify: {
          eventKey: 'SELECTOR_MISMATCH',
          severity: 'SEV2',
          title: '画面構造の変更を検知しました（セレクタ定義の更新が必要）',
        },
      }

    // 未実装の対象（ねほっぷすCLI未確定 等）
    case 'UNSUPPORTED':
      return { nextStatus: 'FAILED', freezeWrites: false }

    // ネットワーク断・セッション切れ・メンテ等の一過性エラー: バックオフ再試行
    case 'NETWORK':
    case 'SESSION_EXPIRED':
    case 'TARGET_MAINTENANCE':
    case 'UNKNOWN':
    default:
      if (canRetry) {
        return { nextStatus: 'PENDING', retryDelayMs: computeBackoffMs(attemptCount), freezeWrites: false }
      }
      return { nextStatus: 'FAILED', freezeWrites: false }
  }
}

/**
 * リース期限切れのRUNNINGジョブの回収方法を決める（§10.4）。
 * READは自動再割当。WRITEは「書けたか不明」な状態のため自動再実行せず開発側対応にする。
 */
export function decideLeaseExpiry(input: {
  direction: SyncDirection
  attemptCount: number
  maxAttempts: number
}): FailureDecision {
  if (input.direction === 'READ') {
    if (input.attemptCount < input.maxAttempts) {
      return { nextStatus: 'PENDING', retryDelayMs: 60 * 1000, freezeWrites: false }
    }
    return { nextStatus: 'FAILED', freezeWrites: false }
  }
  return {
    nextStatus: 'NEEDS_REVIEW',
    freezeWrites: true,
    notify: {
      eventKey: 'WRITE_LEASE_EXPIRED',
      severity: 'SEV1',
      title: 'WRITEジョブが結果不明のまま途絶しました（実際の反映状態の確認が必要・WRITE凍結済み）',
    },
  }
}

// ======================================
// デッドマン方式の健全性評価（§14.1）
// 「報告が来ないこと自体が異常」をサーバー側スイープで検知する
// ======================================

export interface HotelHealthInput {
  now: Date
  lastSuccessfulReadAt: Date | null
  consecutiveReadFails: number
  /** アクティブ（未失効）デバイスの lastSeenAt 一覧 */
  deviceLastSeenAts: Array<Date | null>
}

export interface HotelHealthResult {
  fire: OpsNotifyDirective[]
  /** 回復した事象キー（resolveOps対象） */
  resolve: string[]
}

export function evaluateHotelHealth(input: HotelHealthInput): HotelHealthResult {
  const fire: OpsNotifyDirective[] = []
  const resolve: string[] = []
  const now = input.now.getTime()

  // 全デバイス途絶（デバイスが1台も無いホテルは導入前なので対象外）
  if (input.deviceLastSeenAts.length > 0) {
    const anyAlive = input.deviceLastSeenAts.some(
      (seen) => seen !== null && now - seen.getTime() < DEVICE_DOWN_THRESHOLD_MS
    )
    if (!anyAlive) {
      fire.push({
        eventKey: 'ALL_DEVICES_DOWN',
        severity: 'SEV1',
        title: '全エージェントデバイスのheartbeatが途絶しています',
      })
    } else {
      resolve.push('ALL_DEVICES_DOWN')
    }
  }

  // 鮮度SLO（一度でも取得実績のあるホテルのみ対象 — 導入前ノイズを避ける）
  if (input.lastSuccessfulReadAt) {
    const age = now - input.lastSuccessfulReadAt.getTime()
    if (age >= STALE_READ_SEV1_MS) {
      fire.push({
        eventKey: 'STALE_READ_24H',
        severity: 'SEV1',
        title: '料金ランクの取得が24時間以上停止しています（AI価格推奨の入力から除外中）',
      })
    } else if (age >= STALE_READ_SEV2_MS) {
      fire.push({
        eventKey: 'STALE_READ_12H',
        severity: 'SEV2',
        title: '料金ランクの取得が12時間以上停止しています',
      })
      resolve.push('STALE_READ_24H')
    } else {
      resolve.push('STALE_READ_12H', 'STALE_READ_24H')
    }
  }

  // READ連続失敗
  if (input.consecutiveReadFails >= READ_FAILING_THRESHOLD) {
    fire.push({
      eventKey: 'READ_FAILING',
      severity: 'SEV2',
      title: `料金ランクの取得が${input.consecutiveReadFails}回連続で失敗しています`,
    })
  } else if (input.consecutiveReadFails === 0) {
    resolve.push('READ_FAILING')
  }

  return { fire, resolve }
}

// ======================================
// 定期READスケジューラ（スイープがREADジョブを自動生成する — §14.1）
// ======================================

/**
 * 取得失敗が続いているときにジョブを乱発しないための再スケジュール間隔。
 * 終局FAILEDのたびに次スイープ（5分毎）で即再生成すると、対象システムへの
 * アクセス頻度が跳ね上がりブロックを誘発するため、最低この間隔は空ける
 */
export const READ_RESCHEDULE_COOLDOWN_MS = 30 * 60 * 1000

export interface ReadScheduleInput {
  now: Date
  autoReadEnabled: boolean
  readIntervalMinutes: number
  lastSuccessfulReadAt: Date | null
  /** PENDING/RUNNING のREADジョブが既にあるか（二重生成防止） */
  hasOpenReadJob: boolean
  /** 直近のREADジョブ生成時刻（失敗連発時のクールダウン基準） */
  lastReadJobCreatedAt: Date | null
}

/**
 * 定期READジョブを今生成すべきか（純関数）。
 * 「鮮度が interval を超えた」「未完了ジョブが無い」「クールダウンを空けた」の3条件で判定する。
 */
export function shouldScheduleRead(input: ReadScheduleInput): boolean {
  if (!input.autoReadEnabled) return false
  if (input.hasOpenReadJob) return false

  const now = input.now.getTime()
  const intervalMs = input.readIntervalMinutes * 60 * 1000
  const due =
    input.lastSuccessfulReadAt === null || now - input.lastSuccessfulReadAt.getTime() >= intervalMs
  if (!due) return false

  if (
    input.lastReadJobCreatedAt !== null &&
    now - input.lastReadJobCreatedAt.getTime() < READ_RESCHEDULE_COOLDOWN_MS
  ) {
    return false
  }
  return true
}

/**
 * 鮮度SLOに基づき、このホテルの取得データをAI価格推奨の入力に使ってよいか（§10.5）。
 * 24時間超のstaleデータで推奨を出さないためのガード。
 */
export function isReadDataUsableForRecommendation(
  lastSuccessfulReadAt: Date | null,
  now: Date
): boolean {
  if (!lastSuccessfulReadAt) return false
  return now.getTime() - lastSuccessfulReadAt.getTime() < STALE_READ_SEV1_MS
}
