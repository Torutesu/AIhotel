// デモ用トライアルの規則（ブラウザ内の保存とサーバーの共有保存で共通）。
//
// 本番のトライアル（backend/src/services/trialsService.ts）と同じ規則をデモで再現する:
// 期限は発行日から1〜90日、延長しても今日から90日まで、停止中・期限切れはログインできない。
// 保存方法（sessionStorage か Upstash Redis か）とパスワードの持ち方は呼び出し側が決める。

import type { CreateTrialRequest, TrialSummary, UpdateTrialRequest } from "@shared/types"

export const DAY_MS = 86_400_000
export const TRIAL_MAX_DAYS = 90
export const TRIAL_DEFAULT_DAYS = 30
/** デモで持てるトライアルの上限（共有保存の肥大を防ぐ） */
export const TRIAL_MAX_COUNT = 50
export const TRIAL_LOGIN_DOMAIN = "trial.example.com"

export const TRIAL_EXPIRED_MESSAGE = "トライアル期間が終了しました。延長をご希望の場合は担当者にお問い合わせください"
export const LOGIN_FAILED_MESSAGE = "メールアドレスまたはパスワードが正しくありません"

/** 保存するトライアル。secret は保存先ごとの形（ブラウザ内は平文、共有保存はハッシュ） */
export interface DemoTrialRecord extends Omit<TrialSummary, "status" | "daysLeft" | "purgeAt"> {
  isActive: boolean
  secret: string
  encryptedPassword?: string
}

export class DemoTrialError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "DemoTrialError"
  }
}

const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"

function randomIndexes(count: number, max: number): number[] {
  const values = new Uint32Array(count)
  globalThis.crypto.getRandomValues(values)
  return Array.from(values, (v) => v % max)
}

export function randomHex(length: number): string {
  return randomIndexes(length, 16)
    .map((v) => v.toString(16))
    .join("")
}

/** 読み間違えやすい文字を除いた12文字。英大文字・小文字・数字を必ず含む */
export function randomPassword(): string {
  const [upper, lower, digit] = randomIndexes(3, 1000)
  const head = "ABCDEFGHJKLMNPQRSTUVWXYZ"[upper % 24] + "abcdefghijkmnpqrstuvwxyz"[lower % 24] + "23456789"[digit % 8]
  return head + randomIndexes(9, PASSWORD_CHARS.length).map((i) => PASSWORD_CHARS[i]).join("")
}

function checkDays(days: number) {
  if (!Number.isInteger(days) || days < 1) throw new DemoTrialError(400, "1日以上にしてください")
  if (days > TRIAL_MAX_DAYS) throw new DemoTrialError(400, `${TRIAL_MAX_DAYS}日以内にしてください`)
}

/** 保存しているトライアルに、今の時刻から状態・残り日数を付け直す */
export function summarize(record: DemoTrialRecord, now = Date.now()): TrialSummary {
  const expiresAt = new Date(record.expiresAt).getTime()
  const expired = expiresAt <= now
  const { secret: _secret, encryptedPassword: _encryptedPassword, isActive, ...rest } = record
  return {
    ...rest,
    status: !isActive ? "SUSPENDED" : expired ? "EXPIRED" : "ACTIVE",
    daysLeft: expired ? 0 : Math.ceil((expiresAt - now) / DAY_MS),
    purgeAt: expired ? new Date(expiresAt + 30 * DAY_MS).toISOString() : null,
  }
}

export function sortTrials(trials: TrialSummary[]): TrialSummary[] {
  return [...trials].sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
}

/** 入力を検証して新しいトライアルを作る（secret は呼び出し側が入れる） */
export function newTrialRecord(
  input: CreateTrialRequest,
  existing: DemoTrialRecord[],
  secret: string,
  now = Date.now(),
): DemoTrialRecord {
  const name = input.name?.trim()
  if (!name) throw new DemoTrialError(400, "渡し先の名前を入力してください")
  if (name.length > 100) throw new DemoTrialError(400, "渡し先の名前は100文字以内にしてください")
  if (input.kind !== "DEALER" && input.kind !== "PROSPECT_HOTEL") throw new DemoTrialError(400, "種類が正しくありません")
  const days = input.days ?? TRIAL_DEFAULT_DAYS
  checkDays(days)
  if (existing.length >= TRIAL_MAX_COUNT) {
    throw new DemoTrialError(400, `デモで発行できるトライアルは${TRIAL_MAX_COUNT}件までです。使い終わったものを削除してください`)
  }
  const suffix = randomHex(8)
  const loginEmail = (input.loginEmail?.trim() || `trial-${suffix}@${TRIAL_LOGIN_DOMAIN}`).toLowerCase()
  if (existing.some((t) => t.loginEmail === loginEmail)) {
    throw new DemoTrialError(409, "このログイン ID は既に使われています")
  }
  return {
    id: `demo-trial-${suffix}`,
    name,
    kind: input.kind,
    note: input.note?.trim() || null,
    expiresAt: new Date(now + days * DAY_MS).toISOString(),
    loginEmail,
    lastLoginAt: null,
    createdAt: new Date(now).toISOString(),
    isActive: true,
    secret,
  }
}

/** 名前・メモ・停止／再開・延長を反映した新しいトライアルを返す */
export function applyTrialUpdate(record: DemoTrialRecord, input: UpdateTrialRequest, now = Date.now()): DemoTrialRecord {
  const next = { ...record }
  if (input.extendDays !== undefined) {
    checkDays(input.extendDays)
    const base = Math.max(now, new Date(record.expiresAt).getTime())
    const expiresAt = base + input.extendDays * DAY_MS
    if (expiresAt - now > TRIAL_MAX_DAYS * DAY_MS) {
      throw new DemoTrialError(400, `期限は今日から${TRIAL_MAX_DAYS}日以内にしてください`)
    }
    next.expiresAt = new Date(expiresAt).toISOString()
  }
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new DemoTrialError(400, "渡し先の名前を入力してください")
    next.name = name
  }
  if (input.note !== undefined) next.note = input.note?.trim() || null
  if (input.isActive !== undefined) next.isActive = input.isActive
  return next
}

/** パスワードが合ったトライアルでログインしてよいか。停止中は存在を明かさない */
export function assertCanLogin(record: DemoTrialRecord, now = Date.now()) {
  if (!record.isActive) throw new DemoTrialError(401, LOGIN_FAILED_MESSAGE)
  if (new Date(record.expiresAt).getTime() <= now) throw new DemoTrialError(401, TRIAL_EXPIRED_MESSAGE)
}
