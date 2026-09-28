import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

// トライアル（デモ）アカウントの統合テスト: 発行・ログイン・期限切れ・延長・停止・パスワード再発行・削除。
// DATABASE_URL が無ければスキップし、専用のユーザー（プレフィクス trtest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'trtest'
const PASSWORD = 'Test1234'
const TENANT = `${PREFIX}-tenant`
const HOTEL = `${PREFIX}-hotel`
const EMAILS = {
  platform: `${PREFIX}-platform@example.com`,
  admin: `${PREFIX}-admin@example.com`,
}
const DAY_MS = 86_400_000

describeIntegration('トライアル（デモ）アカウント', () => {
  let app: Express
  let prisma: PrismaClient
  const tokens: Record<string, string> = {}
  const createdTrialIds: string[] = []

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
  const login = (email: string, password: string) =>
    request(app).post('/api/v1/auth/login').send({ email, password })

  async function createTrial(body: Record<string, unknown>) {
    const res = await request(app).post('/api/v1/platform/trials').set(auth(tokens.platform)).send(body)
    if (res.status === 201) createdTrialIds.push(res.body.data.trial.id)
    return res
  }

  async function cleanup() {
    for (const id of createdTrialIds) {
      await prisma.refreshToken.deleteMany({ where: { tenantId: id } })
      await prisma.auditLog.deleteMany({ where: { tenantId: id } })
      await prisma.user.deleteMany({ where: { tenantId: id } })
      await prisma.tenant.deleteMany({ where: { id } })
    }
    const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } })
    await prisma.auditLog.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } })
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
    await prisma.tenant.deleteMany({ where: { id: TENANT } })
  }

  beforeAll(async () => {
    const appModule = await import('../app.js')
    app = appModule.app as unknown as Express
    prisma = new PrismaClient()
    await cleanup()

    const password = await bcrypt.hash(PASSWORD, 10)
    await prisma.tenant.create({ data: { id: TENANT, code: TENANT, name: TENANT } })
    await prisma.hotel.create({ data: { id: HOTEL, tenantId: TENANT, name: HOTEL, totalRooms: 50 } })
    await prisma.user.createMany({
      data: [
        { email: EMAILS.platform, password, name: '運営', role: 'PLATFORM_ADMIN' },
        { email: EMAILS.admin, password, name: '管理者', role: 'ADMIN', tenantId: TENANT },
      ],
    })
    for (const [key, email] of Object.entries(EMAILS)) {
      tokens[key] = (await login(email, PASSWORD)).body.data.tokens.accessToken
    }
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  it('運営以外（テナントの管理者を含む）は使えない', async () => {
    expect((await request(app).get('/api/v1/platform/trials').set(auth(tokens.admin))).status).toBe(403)
    expect((await request(app).post('/api/v1/platform/trials').set(auth(tokens.admin)).send({ name: 'x', kind: 'DEALER' })).status).toBe(403)
  })

  it('発行すると専用のデモホテルにログインでき、他のテナントは見えない', async () => {
    const res = await createTrial({ name: `${PREFIX} 販売店A`, kind: 'DEALER', note: '担当: 山田' })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const { trial, password } = res.body.data
    expect(trial).toMatchObject({ kind: 'DEALER', status: 'ACTIVE', daysLeft: 30, note: '担当: 山田' })
    expect(trial.loginEmail).toMatch(/^trial-[0-9a-f]{8}@trial\.example\.com$/)
    expect(password).toMatch(/^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9]).{12}$/)

    const loggedIn = await login(trial.loginEmail, password)
    expect(loggedIn.status, JSON.stringify(loggedIn.body)).toBe(200)
    const token = loggedIn.body.data.tokens.accessToken

    const hotels = await request(app).get('/api/v1/hotels').set(auth(token))
    expect(hotels.status).toBe(200)
    expect(hotels.body.data).toHaveLength(1)
    const hotelId = hotels.body.data[0].id
    expect(await prisma.dailyData.count({ where: { hotelId } })).toBeGreaterThan(80)
    expect(await prisma.priceRank.count({ where: { hotelId } })).toBe(40)

    // 他テナント（テスト用の通常テナント）のホテルには触れない
    expect((await request(app).get(`/api/v1/hotels/${HOTEL}`).set(auth(token))).status).toBe(403)

    // 画面上部に残り日数を出すため、/auth/me がトライアルの期限を返す
    const me = await request(app).get('/api/v1/auth/me').set(auth(token))
    expect(me.body.data.trial.expiresAt).toBe(trial.expiresAt)

    // 通常のテナント一覧には出ない（トライアルの一覧で扱う）
    const tenants = await request(app).get('/api/v1/platform/tenants').set(auth(tokens.platform))
    expect(tenants.body.data.map((t: { id: string }) => t.id)).not.toContain(trial.id)
    const trials = await request(app).get('/api/v1/platform/trials').set(auth(tokens.platform))
    expect(trials.body.data.map((t: { id: string }) => t.id)).toContain(trial.id)
  })

  it('期限を過ぎると利用中でも使えなくなり、延長すると戻る', async () => {
    const { trial, password } = (await createTrial({ name: `${PREFIX} ホテルB`, kind: 'PROSPECT_HOTEL', days: 7 })).body.data
    const token = (await login(trial.loginEmail, password)).body.data.tokens.accessToken

    await prisma.tenant.update({ where: { id: trial.id }, data: { trialExpiresAt: new Date(Date.now() - 1000) } })

    expect((await request(app).get('/api/v1/hotels').set(auth(token))).status).toBe(401)
    const expired = await login(trial.loginEmail, password)
    expect(expired.status).toBe(401)
    expect(expired.body.error).toContain('トライアル期間が終了しました')
    // パスワードが違えば、期限切れかどうかは明かさない
    const wrong = await login(trial.loginEmail, 'Wrong1234')
    expect(wrong.body.error).not.toContain('トライアル')

    const list = await request(app).get('/api/v1/platform/trials').set(auth(tokens.platform))
    const row = list.body.data.find((t: { id: string }) => t.id === trial.id)
    expect(row).toMatchObject({ status: 'EXPIRED', daysLeft: 0 })
    expect(row.purgeAt).not.toBeNull()

    const extended = await request(app)
      .put(`/api/v1/platform/trials/${trial.id}`)
      .set(auth(tokens.platform))
      .send({ extendDays: 30 })
    expect(extended.status, JSON.stringify(extended.body)).toBe(200)
    // 期限切れからの延長は今日から数える
    expect(extended.body.data).toMatchObject({ status: 'ACTIVE', daysLeft: 30 })
    expect((await login(trial.loginEmail, password)).status).toBe(200)

    // 期限は今日から90日まで
    const tooLong = await request(app)
      .put(`/api/v1/platform/trials/${trial.id}`)
      .set(auth(tokens.platform))
      .send({ extendDays: 90 })
    expect(tooLong.status).toBe(400)
  })

  it('停止すると期限内でも使えず、パスワードの再発行で古いパスワードは使えなくなる', async () => {
    const { trial, password } = (await createTrial({ name: `${PREFIX} 販売店C`, kind: 'DEALER' })).body.data

    const stop = await request(app).put(`/api/v1/platform/trials/${trial.id}`).set(auth(tokens.platform)).send({ isActive: false })
    expect(stop.body.data.status).toBe('SUSPENDED')
    expect((await login(trial.loginEmail, password)).status).toBe(401)
    await request(app).put(`/api/v1/platform/trials/${trial.id}`).set(auth(tokens.platform)).send({ isActive: true })

    const reset = await request(app).post(`/api/v1/platform/trials/${trial.id}/reset-password`).set(auth(tokens.platform))
    expect(reset.status).toBe(200)
    expect((await login(trial.loginEmail, password)).status).toBe(401)
    expect((await login(trial.loginEmail, reset.body.data.password)).status).toBe(200)

    // 監査ログにパスワードは残らない
    const logs = await prisma.auditLog.findMany({ where: { entity: 'Trial', entityId: trial.id } })
    expect(logs.map((l) => l.action).sort()).toEqual(['CREATE', 'PASSWORD_RESET', 'UPDATE', 'UPDATE'])
    expect(JSON.stringify(logs)).not.toContain(reset.body.data.password)
  })

  it('削除するとテナントとデモデータが消え、期限から30日たったものは日次の掃除で消える', async () => {
    const a = (await createTrial({ name: `${PREFIX} 削除D`, kind: 'DEALER' })).body.data.trial
    const del = await request(app).delete(`/api/v1/platform/trials/${a.id}`).set(auth(tokens.platform))
    expect(del.status).toBe(200)
    expect(await prisma.tenant.findUnique({ where: { id: a.id } })).toBeNull()
    expect(await prisma.hotel.count({ where: { tenantId: a.id } })).toBe(0)
    expect(await prisma.user.count({ where: { email: a.loginEmail } })).toBe(0)
    // 運営の操作記録は残る
    expect(await prisma.auditLog.count({ where: { entity: 'Trial', entityId: a.id, action: 'DELETE' } })).toBe(1)

    const b = (await createTrial({ name: `${PREFIX} 掃除E`, kind: 'DEALER' })).body.data.trial
    const c = (await createTrial({ name: `${PREFIX} 掃除F`, kind: 'DEALER' })).body.data.trial
    await prisma.tenant.update({ where: { id: b.id }, data: { trialExpiresAt: new Date(Date.now() - 31 * DAY_MS) } })
    await prisma.tenant.update({ where: { id: c.id }, data: { trialExpiresAt: new Date(Date.now() - 29 * DAY_MS) } })

    const { purgeExpiredTrialsService } = await import('../services/trialsService.js')
    await purgeExpiredTrialsService()
    expect(await prisma.tenant.findUnique({ where: { id: b.id } })).toBeNull()
    expect(await prisma.tenant.findUnique({ where: { id: c.id } })).not.toBeNull()
  })
})
