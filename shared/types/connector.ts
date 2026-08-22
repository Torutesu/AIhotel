// ======================================
// コネクタ連携（サイトコントローラー/PMS 画面操作連携）の共有型
// backend と connector-agent の両方が参照する契約。docs/コネクタ連携設計.md を参照
// ======================================

export type SyncTarget = 'LINCOLN' | 'NEHOPPS'
export type SyncDirection = 'READ' | 'WRITE'
export type SyncJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'DONE'
  | 'FAILED'
  | 'CANCELLED'
  | 'NEEDS_REVIEW'
export type AgentDeviceRole = 'PRIMARY' | 'STANDBY'
export type SnapshotKind = 'READ_RAW' | 'PRE_WRITE' | 'POST_WRITE' | 'FAILURE_EVIDENCE'

// エラー分類（docs/コネクタ連携設計.md §11 のマトリクスに対応）
export type SyncErrorCode =
  | 'NETWORK'
  | 'SESSION_EXPIRED'
  | 'AUTH_FAILED'
  | 'CAPTCHA_BLOCKED'
  | 'SELECTOR_MISMATCH'
  | 'TARGET_MAINTENANCE'
  | 'VERIFY_MISMATCH'
  | 'PRECONDITION_CHANGED'
  | 'GUARDRAIL_VIOLATION'
  | 'UNSUPPORTED'
  | 'UNKNOWN'

// 料金ランク1件分（PriceRank と同じ形。price3P/4P は設定が無いプランでは null）
export interface SyncPriceRankItem {
  rank: number
  label?: string
  price1P: number
  price2P: number
  price3P?: number | null
  price4P?: number | null
}

// READジョブの payload（取得範囲の指定。現状は全ランク取得のみ）
export interface ReadJobPayload {
  kind: 'PRICE_RANKS'
}

// WRITEジョブの payload。
// expectedCurrent はジョブ生成時点でシステムが把握している現在値 —
// エージェントは書き込み直前の実際の値と照合し、不一致なら PRECONDITION_CHANGED で中断する
export interface WriteJobPayload {
  kind: 'PRICE_RANKS'
  items: SyncPriceRankItem[]
  expectedCurrent?: SyncPriceRankItem[]
}

// エージェント → backend のREAD結果
export interface ReadResultData {
  kind: 'PRICE_RANKS'
  capturedAt: string // ISO8601
  items: SyncPriceRankItem[]
}

// エージェント → backend のWRITE検証結果（読み戻し検証）
export interface WriteVerification {
  verifiedAt: string // ISO8601
  itemResults: Array<{
    rank: number
    ok: boolean
    message?: string
  }>
}

// GET /connector/jobs/next のレスポンス data
export interface ClaimedJob {
  id: string
  target: SyncTarget
  direction: SyncDirection
  payload: ReadJobPayload | WriteJobPayload
  dryRun: boolean
  attemptCount: number
  leaseExpiresAt: string // ISO8601
}

// ======================================
// 連携定義（セレクタ・操作手順）— backend が配信しエージェントが解釈する
// 画面変更時は backend 側の定義更新のみで対応し、エージェントを再配布しない
// ======================================

export interface LincolnDefinition {
  target: 'LINCOLN'
  version: number
  // このバージョンでWRITEを許可するか（自己修復直後はREADの連続成功までfalse — §10.1 L3）
  writeEnabled: boolean
  // メンテナンス窓（JST 'HH:mm'）。この間ジョブ実行を静止する
  maintenanceWindows: Array<{ start: string; end: string }>
  login: {
    url: string
    // ログイン済み判定に使うセレクタ（存在すればログイン済み）
    loggedInSelector: string
    userSelector: string
    passwordSelector: string
    submitSelector: string
    // 認証失敗の判定（このセレクタが出たら AUTH_FAILED で即停止 — 再試行禁止）
    errorSelector: string
  }
  read: {
    url: string
    rowSelector: string
    cells: {
      rank: string
      label?: string
      price1P: string
      price2P: string
      price3P?: string
      price4P?: string
    }
  }
  write: {
    url: string
    // rank をキーに入力欄を特定するセレクタテンプレート（{rank} を置換）
    inputSelectors: {
      price1P: string
      price2P: string
      price3P?: string
      price4P?: string
    }
    submitSelector: string
    // 送信成功の判定セレクタ
    successSelector: string
  }
}

export interface NehoppsDefinition {
  target: 'NEHOPPS'
  version: number
  writeEnabled: boolean
  maintenanceWindows: Array<{ start: string; end: string }>
  // FlaUI CLI に渡す操作定義（UIA調査後に確定。それまで空）
  cli: {
    executable: string
    windowTitle: string
  } | null
}

export type ConnectorDefinition = LincolnDefinition | NehoppsDefinition
