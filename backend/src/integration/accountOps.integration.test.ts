import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import type { MemoryMailer } from '../lib/mailer.js'

// アカウント運用（#89）の統合テスト: パスワード変更・一時パスワードの発行・監査ログの閲覧。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス actest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'actest'
const TENANT_A = `${PREFIX}-tenant-a`
const TENANT_B = `${PREFIX}-tenant-b`
const HOTEL_A = `${PREFIX}-hotel-a`
const HOTEL_B = `${PREFIX}-hotel-b`
const PASSWORD = 'Test1234'
const EMAILS = {
  admin: `${PREFIX}-admin@example.com`,
  manager: `${PREFIX}-manager@example.com`,
  operator: `${PREFIX}-operator@example.com`,
  selfService: `${PREFIX}-self@example.com`,
  otherAdmin: `${PREFIX}-admin-b@example.com`,
}

describeIntegration('アカウント運用（#89）', () => {
  let app: Express
  let prisma: PrismaClient
  // vitest.config.ts が MAIL_DRIVER=memory にしているので、送ったメールはここに貯まる
  let mailbox: MemoryMailer
  const tokens: Record<string, string> = {}
  const ids: Record<string, string> = {}

  async function login(email: string, password = PASSWORD) {
    return request(app).post('/api/v1/auth/login').send({ email, password })
  }
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } })
    await prisma.auditLog.deleteMany({
      where: { OR: [{ tenantId: { in: [TENANT_A, TENANT_B] } }, { userId: { in: users.map((u) => u.id) } }] },
    })
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } })
  }

  beforeAll(async () => {
    const appModule = await import('../app.js')
    app = appModule.app as unknown as Express
    mailbox = (await import('../lib/mailer.js')).mailer as MemoryMailer
    prisma = new PrismaClient()
    await cleanup()

    const password = await bcrypt.hash(PASSWORD, 10)
    for (const [tenantId, hotelId] of [
      [TENANT_A, HOTEL_A],
      [TENANT_B, HOTEL_B],
    ] as const) {
      await prisma.tenant.create({ data: { id: tenantId, code: tenantId, name: tenantId } })
      await prisma.hotel.create({ data: { id: hotelId, tenantId, name: hotelId, totalRooms: 50 } })
    }
    await prisma.user.createMany({
      data: [
        { email: EMAILS.admin, password, name: '管理者', role: 'ADMIN', tenantId: TENANT_A },
        { email: EMAILS.manager, password, name: 'マネージャー', role: 'MANAGER', tenantId: TENANT_A, hotelId: HOTEL_A },
        { email: EMAILS.operator, password, name: 'オペレーター', role: 'OPERATOR', tenantId: TENANT_A, hotelId: HOTEL_A },
        { email: EMAILS.selfService, password, name: '本人', role: 'OPERATOR', tenantId: TENANT_A, hotelId: HOTEL_A },
        { email: EMAILS.otherAdmin, password, name: '他テナント管理者', role: 'ADMIN', tenantId: TENANT_B },
      ],
    })
    for (const [key, email] of Object.entries(EMAILS)) {
      const res = await login(email)
      tokens[key] = res.body.data.tokens.accessToken
      ids[key] = res.body.data.user.id
    }
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  describe('本人のパスワード変更', () => {
    it('現在のパスワードが違えば 400', async () => {
      const res = await request(app)
        .put('/api/v1/auth/password')
        .set(auth(tokens.selfService))
        .send({ currentPassword: 'Wrong1234', newPassword: 'NewPass123' })
      expect(res.status).toBe(400)
      expect(res.body.errors[0].field).toBe('currentPassword')
    })

    it('変更すると他の端末のリフレッシュトークンは失効し、この端末には新しいトークンが返る', async () => {
      const other = await login(EMAILS.selfService)
      const otherRefresh = other.body.data.tokens.refreshToken

      const res = await request(app)
        .put('/api/v1/auth/password')
        .set(auth(tokens.selfService))
        .send({ currentPassword: PASSWORD, newPassword: 'NewPass123' })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.data.tokens.refreshToken).toBeTruthy()

      expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: otherRefresh })).status).toBe(401)
      expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: res.body.data.tokens.refreshToken })).status).toBe(200)
      expect((await login(EMAILS.selfService, PASSWORD)).status).toBe(401)
      expect((await login(EMAILS.selfService, 'NewPass123')).status).toBe(200)
    })
  })

  describe('一時パスワードの発行', () => {
    it('マネージャーは管理者を、誰も自分自身を対象にできず、他テナントのユーザーは存在しない扱い', async () => {
      // ホテル所属のマネージャーにとって、テナント全体の管理者は管理範囲の外（#79）なので 404
      expect((await request(app).post(`/api/v1/users/${ids.admin}/reset-password`).set(auth(tokens.manager))).status).toBe(404)
      expect((await request(app).post(`/api/v1/users/${ids.admin}/reset-password`).set(auth(tokens.admin))).status).toBe(400)
      expect((await request(app).post(`/api/v1/users/${ids.operator}/reset-password`).set(auth(tokens.otherAdmin))).status).toBe(404)
      expect((await request(app).post(`/api/v1/users/${ids.admin}/reset-password`).set(auth(tokens.operator))).status).toBe(403)
    })

    it('発行した一時パスワードでログインすると、変更するまでパスワード変更以外の API が使えない', async () => {
      const res = await request(app).post(`/api/v1/users/${ids.operator}/reset-password`).set(auth(tokens.manager))
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      // メールで本人に届けたので、レスポンス（管理者の画面）には一時パスワードを含めない
      expect(res.body.data.emailSent).toBe(true)
      expect(res.body.data.temporaryPassword).toBeNull()
      const mail = [...mailbox.sent].reverse().find((m) => m.to === EMAILS.operator)
      expect(mail?.subject).toContain('一時パスワード')
      const temporary = mail!.text.match(/一時パスワード: (\S+)/)![1]
      expect(temporary).toMatch(/^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9]).{12}$/)

      // 元のパスワードは使えない
      expect((await login(EMAILS.operator, PASSWORD)).status).toBe(401)

      const loggedIn = await login(EMAILS.operator, temporary)
      expect(loggedIn.status).toBe(200)
      expect(loggedIn.body.data.user.mustChangePassword).toBe(true)
      const token = loggedIn.body.data.tokens.accessToken

      expect((await request(app).get('/api/v1/hotels').set(auth(token))).status).toBe(403)
      expect((await request(app).get('/api/v1/auth/me').set(auth(token))).status).toBe(200)

      const changed = await request(app)
        .put('/api/v1/auth/password')
        .set(auth(token))
        .send({ currentPassword: temporary, newPassword: 'Operator99' })
      expect(changed.status).toBe(200)
      expect(changed.body.data.user.mustChangePassword).toBe(false)
      expect((await request(app).get('/api/v1/hotels').set(auth(token))).status).toBe(200)
    })
  })

  describe('招待（パスワードを省略したユーザー登録）', () => {
    it('一時パスワードを本人にメールで送り、初回ログインで変更を求める', async () => {
      const email = `${PREFIX}-invited@example.com`
      const res = await request(app)
        .post('/api/v1/auth/register')
        .set(auth(tokens.manager))
        .send({ email, name: '招待者', role: 'OPERATOR', hotelId: HOTEL_A })
      expect(res.status, JSON.stringify(res.body)).toBe(201)
      expect(res.body.data.invitation).toEqual({ emailSent: true, temporaryPassword: null })
      expect(res.body.data.mustChangePassword).toBe(true)

      const mail = [...mailbox.sent].reverse().find((m) => m.to === email)
      expect(mail?.subject).toContain('アカウントのご案内')
      const temporary = mail!.text.match(/一時パスワード: (\S+)/)![1]
      const loggedIn = await login(email, temporary)
      expect(loggedIn.status).toBe(200)
      expect(loggedIn.body.data.user.mustChangePassword).toBe(true)
    })

    it('パスワードを指定した登録は従来どおりで、メールは送らない', async () => {
      const email = `${PREFIX}-direct@example.com`
      const before = mailbox.sent.length
      const res = await request(app)
        .post('/api/v1/auth/register')
        .set(auth(tokens.manager))
        .send({ email, password: PASSWORD, name: '直接登録', role: 'OPERATOR', hotelId: HOTEL_A })
      expect(res.status, JSON.stringify(res.body)).toBe(201)
      expect(res.body.data.invitation).toBeNull()
      expect(res.body.data.mustChangePassword).toBe(false)
      expect(mailbox.sent.length).toBe(before)
    })
  })

  describe('監査ログの閲覧', () => {
    it('管理者は自テナントのログを新しい順に見られ、パスワードそのものは記録されていない', async () => {
      const res = await request(app).get('/api/v1/audit-logs').query({ hotelId: HOTEL_A }).set(auth(tokens.admin))
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      const actions = res.body.data.items.map((i: { action: string }) => i.action)
      expect(actions).toContain('PASSWORD_RESET')
      expect(actions).toContain('PASSWORD_CHANGED')
      expect(JSON.stringify(res.body)).not.toContain('Operator99')
      const times = res.body.data.items.map((i: { createdAt: string }) => i.createdAt)
      expect([...times].sort().reverse()).toEqual(times)
    })

    it('操作の種類で絞り込め、カーソルで次のページを取れる', async () => {
      const first = await request(app)
        .get('/api/v1/audit-logs')
        .query({ hotelId: HOTEL_A, action: 'LOGIN', limit: 2 })
        .set(auth(tokens.admin))
      expect(first.body.data.items).toHaveLength(2)
      expect(first.body.data.items.every((i: { action: string }) => i.action === 'LOGIN')).toBe(true)
      expect(first.body.data.nextCursor).toBeTruthy()

      const second = await request(app)
        .get('/api/v1/audit-logs')
        .query({ hotelId: HOTEL_A, action: 'LOGIN', limit: 2, cursor: first.body.data.nextCursor })
        .set(auth(tokens.admin))
      const firstIds = first.body.data.items.map((i: { id: string }) => i.id)
      expect(second.body.data.items.some((i: { id: string }) => firstIds.includes(i.id))).toBe(false)
    })

    it('マネージャーは見られず、他テナントの管理者は 403', async () => {
      expect((await request(app).get('/api/v1/audit-logs').query({ hotelId: HOTEL_A }).set(auth(tokens.manager))).status).toBe(403)
      expect((await request(app).get('/api/v1/audit-logs').query({ hotelId: HOTEL_A }).set(auth(tokens.otherAdmin))).status).toBe(403)
    })
  })
})
