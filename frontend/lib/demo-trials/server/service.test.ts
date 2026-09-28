import { beforeEach, describe, it, expect, vi } from "vitest"

import { DAY_MS } from "../core"
import { memoryKv } from "./kv"
import {
  adminConfigured, adminLogin, createTrial, deleteTrial, listTrials, resetTrialPassword, trialLogin, trialSession,
  updateTrial, verifyAdminSession, trialLoginInfo,
} from "./service"

// デモのトライアルの共有保存（運営用 URL で発行した ID を、配布用 URL や他の端末でも使う）

describe("運営のログイン", () => {
  it("最初のログインでパスワードを登録し、以後はそのパスワードだけ通す", async () => {
    const kv = memoryKv()
    expect(await adminConfigured(kv)).toBe(false)
    await expect(adminLogin(kv, "short", null)).rejects.toThrow("10文字以上")
    expect(await adminConfigured(kv)).toBe(false)

    const cookie = await adminLogin(kv, "operator-pass-1", "192.0.2.1")
    expect(await adminConfigured(kv)).toBe(true)
    expect(await verifyAdminSession(kv, cookie)).toBe(true)
    expect(await verifyAdminSession(kv, cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBe(false)
    expect(await verifyAdminSession(kv, cookie, Date.now() + 13 * 3600_000)).toBe(false)

    await expect(adminLogin(kv, "someone-else-pass", "192.0.2.1")).rejects.toThrow("正しくありません")
    expect(await verifyAdminSession(kv, await adminLogin(kv, "operator-pass-1", "192.0.2.1"))).toBe(true)
  })

  it("失敗が続いたアクセス元は止める", async () => {
    const kv = memoryKv()
    await adminLogin(kv, "operator-pass-1", null)
    for (let i = 0; i < 10; i++) await expect(adminLogin(kv, "wrong-password", "192.0.2.9")).rejects.toThrow()
    await expect(adminLogin(kv, "operator-pass-1", "192.0.2.9")).rejects.toThrow("しばらく時間をおいて")
    await expect(adminLogin(kv, "operator-pass-1", "192.0.2.10")).resolves.toBeTruthy()
  })
})

describe("トライアル", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_TRIAL_CREDENTIALS_KEY", "a".repeat(64))
    vi.stubEnv("DEMO_PUBLIC_URL", "https://public.example.test")
  })
  async function setup() {
    const kv = memoryKv()
    await adminLogin(kv, "operator-pass-1", null)
    return kv
  }

  it("発行した ID は別の端末でもログインでき、パスワードを平文保存しない", async () => {
    const kv = await setup()
    const { trial, password } = await createTrial(kv, { name: "○○販売店", kind: "DEALER", days: 30 })
    expect(trial).toMatchObject({ status: "ACTIVE", daysLeft: 30 })
    expect(JSON.stringify(await kv.hgetall("demo:trials"))).not.toContain(password)

    expect(await trialLogin(kv, "unknown@example.com", password, null)).toBeNull()
    await expect(trialLogin(kv, trial.loginEmail!, "wrong", null)).rejects.toThrow("正しくありません")
    const login = await trialLogin(kv, trial.loginEmail!.toUpperCase(), password, null)
    expect(login).toMatchObject({ name: "○○販売店", expiresAt: trial.expiresAt })
    expect((await listTrials(kv))[0].lastLoginAt).not.toBeNull()
    expect(await trialSession(kv, login!.cookie)).toMatchObject({ active: true, name: "○○販売店" })
  })

  it("停止・期限切れ・パスワード再発行・削除でログイン中の端末も使えなくなる", async () => {
    const kv = await setup()
    const { trial, password } = await createTrial(kv, { name: "△△ホテル", kind: "PROSPECT_HOTEL", days: 7 })
    const { cookie } = (await trialLogin(kv, trial.loginEmail!, password, null))!

    await updateTrial(kv, trial.id, { isActive: false })
    expect(await trialSession(kv, cookie)).toMatchObject({ active: false })
    await expect(trialLogin(kv, trial.loginEmail!, password, null)).rejects.toThrow("正しくありません")
    await updateTrial(kv, trial.id, { isActive: true })
    expect(await trialSession(kv, cookie)).toMatchObject({ active: true })

    const later = Date.now() + 8 * DAY_MS
    expect(await trialSession(kv, cookie, later)).toMatchObject({ active: false, message: expect.stringContaining("トライアル期間が終了") })
    await expect(trialLogin(kv, trial.loginEmail!, password, null, later)).rejects.toThrow("トライアル期間が終了")

    const reset = await resetTrialPassword(kv, trial.id)
    expect(await trialSession(kv, cookie)).toMatchObject({ active: false })
    await expect(trialLogin(kv, trial.loginEmail!, password, null)).rejects.toThrow()
    const again = (await trialLogin(kv, trial.loginEmail!, reset.password, null))!

    await deleteTrial(kv, trial.id)
    expect(await trialSession(kv, again.cookie)).toMatchObject({ active: false })
    expect(await listTrials(kv)).toHaveLength(0)
  })

  it("個別URLと暗号化パスワードを再取得でき、一覧には秘密を含めない", async () => {
    const kv = await setup()
    const first = await createTrial(kv, { name: "A", kind: "DEALER" })
    const second = await createTrial(kv, { name: "B", kind: "PROSPECT_HOTEL" })
    expect(first.loginUrl).not.toEqual(second.loginUrl)
    expect(new URL(first.loginUrl!).origin).toBe("https://public.example.test")
    expect(new URL(first.loginUrl!).searchParams.get("trial")).toBe(first.trial.id)
    expect(await trialLoginInfo(kv, first.trial.id)).toEqual(first)
    expect((await listTrials(kv))[0]).not.toHaveProperty("encryptedPassword")
    expect((await listTrials(kv))[0]).not.toHaveProperty("secret")
    const login = await trialLogin(kv, "", first.password, null, Date.now(), first.trial.id)
    expect(login?.email).toBe(first.trial.loginEmail)
    await expect(trialLogin(kv, "", first.password, null, Date.now(), second.trial.id)).rejects.toThrow()
    expect(await trialSession(kv, login!.cookie, Date.now(), second.trial.id)).toMatchObject({ active: false })
    expect(await trialSession(kv, login!.cookie, Date.now(), first.trial.id)).toMatchObject({ active: true })
    const reset = await resetTrialPassword(kv, first.trial.id)
    expect((await trialLoginInfo(kv, first.trial.id)).password).toBe(reset.password)
    expect(await trialSession(kv, login!.cookie)).toMatchObject({ active: false })
  })

  it("旧データは勝手に再発行せず、暗号化設定なしでは新規保存しない", async () => {
    const kv = await setup()
    const issued = await createTrial(kv, { name: "Legacy", kind: "DEALER" })
    const record = JSON.parse((await kv.hgetall("demo:trials"))[issued.trial.id])
    delete record.encryptedPassword
    await kv.hset("demo:trials", issued.trial.id, JSON.stringify(record))
    expect((await trialLoginInfo(kv, issued.trial.id)).password).toBeNull()
    expect(await trialLogin(kv, "", issued.password, null, Date.now(), issued.trial.id)).toBeTruthy()
    const before = await kv.hgetall("demo:trials")
    vi.stubEnv("DEMO_TRIAL_CREDENTIALS_KEY", "")
    await expect(createTrial(kv, { name: "No key", kind: "DEALER" })).rejects.toMatchObject({ status: 503 })
    await expect(resetTrialPassword(kv, issued.trial.id)).rejects.toMatchObject({ status: 503 })
    expect(await kv.hgetall("demo:trials")).toEqual(before)
  })

  it("期限は今日から90日まで", async () => {
    const kv = await setup()
    await expect(createTrial(kv, { name: "A", kind: "DEALER", days: 91 })).rejects.toThrow("90日以内")
    const { trial } = await createTrial(kv, { name: "A", kind: "DEALER", days: 30 })
    await expect(updateTrial(kv, trial.id, { extendDays: 61 })).rejects.toThrow("90日以内")
    expect((await updateTrial(kv, trial.id, { extendDays: 60 })).daysLeft).toBe(90)
  })
})
