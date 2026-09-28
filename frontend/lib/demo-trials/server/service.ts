// デモのトライアルの共有保存（サーバー専用）。app/api/demo/ のルートから呼ぶ。
//
// - 運営のパスワード: 運営用 URL で最初にログインしたときのパスワードを登録する（環境変数の設定は要らない）。
//   ハッシュだけを保存する。再設定は運用環境で passwordHash と adminSigningKey を置換し、signingKey を維持する
// - トライアルのパスワード: 認証用ハッシュと、運営の再表示用の暗号文を保存する
// - ログインの状態: 署名した Cookie で持つ。署名の鍵は運営の初回登録のときに作って保存する
// - ログインの失敗が続いたアクセス元は15分止める

import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

import type { CreateTrialRequest, TrialCredentials, TrialLoginInfo, TrialSummary, UpdateTrialRequest } from "@shared/types"
import {
  DemoTrialError, LOGIN_FAILED_MESSAGE, applyTrialUpdate, assertCanLogin, newTrialRecord, randomPassword, sortTrials,
  summarize, type DemoTrialRecord,
} from "../core"
import type { DemoKv } from "./kv"
import { encryptTrialPassword, decryptTrialPassword, trialLoginUrl } from "./credentials"

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>

const KEY_ADMIN = "demo:admin"
const KEY_TRIALS = "demo:trials"
const FAIL_LIMIT = 10
const FAIL_WINDOW_SECONDS = 15 * 60
export const ADMIN_SESSION_SECONDS = 12 * 60 * 60
export const TRIAL_SESSION_SECONDS = 30 * 24 * 60 * 60
export const ADMIN_PASSWORD_MIN_LENGTH = 10

interface AdminRecord {
  passwordHash: string
  /** Cookie の署名鍵 */
  signingKey: string
  /** 運営の再設定時にだけ更新。トライアル用の署名鍵は維持する */
  adminSigningKey?: string
}

// ---- パスワードと署名 ----

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, 32)
  return `s1$${salt.toString("hex")}$${hash.toString("hex")}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [version, saltHex, hashHex] = stored.split("$")
  if (version !== "s1" || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, "hex")
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length)
  return timingSafeEqual(actual, expected)
}

function sign(key: string, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url")
}

function sameSignature(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

// ---- 保存の読み書き ----

async function readAdmin(kv: DemoKv): Promise<AdminRecord | null> {
  const raw = await kv.get(KEY_ADMIN)
  return raw ? (JSON.parse(raw) as AdminRecord) : null
}

async function readTrials(kv: DemoKv): Promise<DemoTrialRecord[]> {
  return Object.values(await kv.hgetall(KEY_TRIALS)).map((raw) => JSON.parse(raw) as DemoTrialRecord)
}

async function writeTrial(kv: DemoKv, record: DemoTrialRecord) {
  await kv.hset(KEY_TRIALS, record.id, JSON.stringify(record))
}

async function findTrial(kv: DemoKv, id: string): Promise<DemoTrialRecord> {
  const trial = (await readTrials(kv)).find((t) => t.id === id)
  if (!trial) throw new DemoTrialError(404, "トライアルが見つかりません")
  return trial
}

async function guardFailures(kv: DemoKv, scope: string, ip: string | null) {
  const count = Number((await kv.get(`demo:fail:${scope}:${ip ?? "unknown"}`)) ?? 0)
  if (count >= FAIL_LIMIT) {
    throw new DemoTrialError(429, "ログインの失敗が続いたため、しばらく時間をおいてからお試しください")
  }
}

async function recordFailure(kv: DemoKv, scope: string, ip: string | null) {
  await kv.incrWithTtl(`demo:fail:${scope}:${ip ?? "unknown"}`, FAIL_WINDOW_SECONDS)
}

// ---- 運営 ----

export async function adminConfigured(kv: DemoKv): Promise<boolean> {
  return (await readAdmin(kv)) !== null
}

/**
 * 運営のログイン。まだ登録が無ければ、このパスワードを運営のパスワードとして登録する
 * （登録は運営用 URL でだけ許す — 呼び出し側で確認する）。成功したら Cookie の値を返す
 */
export async function adminLogin(kv: DemoKv, password: string, ip: string | null, now = Date.now()): Promise<string> {
  await guardFailures(kv, "admin", ip)
  let admin = await readAdmin(kv)
  if (!admin) {
    if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
      throw new DemoTrialError(
        400,
        `運営のパスワードを登録します。${ADMIN_PASSWORD_MIN_LENGTH}文字以上のパスワードを入力してください（最初にログインしたパスワードが登録されます）`,
      )
    }
    const record: AdminRecord = { passwordHash: await hashPassword(password), signingKey: randomBytes(32).toString("hex") }
    // 同時に登録されたら先に保存した方を使う
    await kv.setIfAbsent(KEY_ADMIN, JSON.stringify(record))
    admin = (await readAdmin(kv))!
  }
  if (!(await verifyPassword(password, admin.passwordHash))) {
    await recordFailure(kv, "admin", ip)
    throw new DemoTrialError(401, LOGIN_FAILED_MESSAGE)
  }
  const exp = Math.floor(now / 1000) + ADMIN_SESSION_SECONDS
  return `${exp}.${sign(admin.adminSigningKey ?? admin.signingKey, `admin:${exp}`)}`
}

export async function verifyAdminSession(kv: DemoKv, cookie: string | undefined, now = Date.now()): Promise<boolean> {
  if (!cookie) return false
  const [exp, signature] = cookie.split(".")
  if (!exp || !signature || Number(exp) * 1000 <= now) return false
  const admin = await readAdmin(kv)
  return admin !== null && sameSignature(signature, sign(admin.adminSigningKey ?? admin.signingKey, `admin:${exp}`))
}

// ---- トライアルの管理（運営） ----

export async function listTrials(kv: DemoKv, now = Date.now()): Promise<TrialSummary[]> {
  return sortTrials((await readTrials(kv)).map((t) => summarize(t, now)))
}

export async function createTrial(kv: DemoKv, input: CreateTrialRequest, now = Date.now()): Promise<TrialCredentials> {
  const password = randomPassword()
  const record = newTrialRecord(input, await readTrials(kv), await hashPassword(password), now)
  record.encryptedPassword = encryptTrialPassword(record.id, password)
  const loginUrl = trialLoginUrl(record.id)
  await writeTrial(kv, record)
  return { trial: summarize(record, now), password, loginUrl, redisplayable: true }
}

export async function updateTrial(kv: DemoKv, id: string, input: UpdateTrialRequest, now = Date.now()): Promise<TrialSummary> {
  const record = applyTrialUpdate(await findTrial(kv, id), input, now)
  await writeTrial(kv, record)
  return summarize(record, now)
}

/** パスワードを作り直す。ログイン中の端末の Cookie も使えなくなる（署名に今のハッシュを含めているため） */
export async function resetTrialPassword(kv: DemoKv, id: string, now = Date.now()): Promise<TrialCredentials> {
  const password = randomPassword()
  const record = { ...(await findTrial(kv, id)), secret: await hashPassword(password) }
  record.encryptedPassword = encryptTrialPassword(record.id, password)
  const loginUrl = trialLoginUrl(record.id)
  await writeTrial(kv, record)
  return { trial: summarize(record, now), password, loginUrl, redisplayable: true }
}

/** 呼び出し側で運営セッション必須。旧レコードはパスワードを変えずに null を返す */
export async function trialLoginInfo(kv: DemoKv, id: string, now = Date.now()): Promise<TrialLoginInfo> {
  const record = await findTrial(kv, id)
  return {
    trial: summarize(record, now),
    password: record.encryptedPassword ? decryptTrialPassword(record.id, record.encryptedPassword) : null,
    loginUrl: trialLoginUrl(record.id),
    redisplayable: Boolean(record.encryptedPassword),
  }
}

export async function deleteTrial(kv: DemoKv, id: string): Promise<void> {
  await findTrial(kv, id)
  await kv.hdel(KEY_TRIALS, id)
}

// ---- トライアルの ID でのログイン（配布用 URL を含むどの URL でも） ----

function trialSignature(admin: AdminRecord, record: DemoTrialRecord, exp: number): string {
  return sign(admin.signingKey, `trial:${record.id}:${exp}:${record.secret}`)
}

/** 一致するトライアルが無ければ null（呼び出し側はデモの固定アカウントを試す） */
export async function trialLogin(
  kv: DemoKv,
  email: string,
  password: string,
  ip: string | null,
  now = Date.now(),
  trialId?: string,
): Promise<{ name: string; expiresAt: string; cookie: string; email: string } | null> {
  const loginEmail = email.trim().toLowerCase()
  await guardFailures(kv, "trial", ip)
  const record = (await readTrials(kv)).find((t) => trialId ? t.id === trialId : t.loginEmail === loginEmail)
  if (!record) {
    await recordFailure(kv, "trial", ip)
    return null
  }
  if (!(await verifyPassword(password, record.secret))) {
    await recordFailure(kv, "trial", ip)
    throw new DemoTrialError(401, LOGIN_FAILED_MESSAGE)
  }
  assertCanLogin(record, now)
  const admin = await readAdmin(kv)
  if (!admin) throw new DemoTrialError(401, LOGIN_FAILED_MESSAGE)
  await writeTrial(kv, { ...record, lastLoginAt: new Date(now).toISOString() })
  const exp = Math.floor(now / 1000) + TRIAL_SESSION_SECONDS
  return { email: record.loginEmail!, name: record.name, expiresAt: record.expiresAt, cookie: `${record.id}.${exp}.${trialSignature(admin, record, exp)}` }
}

/**
 * ログイン中のトライアルがまだ使えるか（画面を開き直したときに確認する）。
 * 停止・期限切れ・パスワード再発行・削除で使えなくなる
 */
export async function trialSession(
  kv: DemoKv,
  cookie: string | undefined,
  now = Date.now(),
  expectedTrialId?: string,
): Promise<{ active: true; name: string; expiresAt: string } | { active: false; message: string }> {
  const ended = { active: false as const, message: "トライアルのログインが無効になりました。もう一度ログインしてください" }
  if (!cookie) return ended
  const [id, expRaw, signature] = cookie.split(".")
  if (expectedTrialId && id !== expectedTrialId) return ended
  const exp = Number(expRaw)
  if (!id || !signature || !Number.isFinite(exp) || exp * 1000 <= now) return ended
  const [admin, record] = await Promise.all([readAdmin(kv), readTrials(kv).then((all) => all.find((t) => t.id === id))])
  if (!admin || !record || !sameSignature(signature, trialSignature(admin, record, exp))) return ended
  try {
    assertCanLogin(record, now)
  } catch (err) {
    return { active: false, message: err instanceof DemoTrialError && err.status === 401 && record.isActive ? err.message : ended.message }
  }
  return { active: true, name: record.name, expiresAt: record.expiresAt }
}
