import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

// IP 制限（#12）の統合テスト。supertest のアクセス元は 127.0.0.1（::ffff:127.0.0.1）になる。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス iptest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'iptest'
const TENANT_A = `${PREFIX}-tenant-a`
const TENANT_B = `${PREFIX}-tenant-b`
const PASSWORD = 'Test1234'
const EMAILS = {
  admin: `${PREFIX}-admin@example.com`,
  manager: `${PREFIX}-manager@example.com`,
  otherAdmin: `${PREFIX}-admin-b@example.com`,
  platform: `${PREFIX}-platform@example.com`,
}

describeIntegration('IP 制限（#12）', () => {
  let app: Express
  let prisma: PrismaClient
  const tokens: Record<string, string> = {}

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
  const login = (email: string, password = PASSWORD) => request(app).post('/api/v1/auth/login').send({ email, password })

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } })
    await prisma.auditLog.deleteMany({
      where: { OR: [{ tenantId: { in: [TENANT_A, TENANT_B] } }, { userId: { in: users.map((u) => u.id) } }] },
    })
    await prisma.refreshToken.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } })
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } })
  }

  beforeAll(async () => {
    const appModule = await import('../app.js')
    app = appModule.app as unknown as Express
    prisma = new PrismaClient()
    await cleanup()
    const password = await bcrypt.hash(PASSWORD, 10)
    for (const id of [TENANT_A, TENANT_B]) await prisma.tenant.create({ data: { id, code: id, name: id } })
    await prisma.user.createMany({
      data: [
        { email: EMAILS.admin, password, name: '管理者', role: 'ADMIN', tenantId: TENANT_A },
        { email: EMAILS.manager, password, name: 'マネージャー', role: 'MANAGER', tenantId: TENANT_A },
        { email: EMAILS.otherAdmin, password, name: '他テナント管理者', role: 'ADMIN', tenantId: TENANT_B },
        { email: EMAILS.platform, password, name: '運営', role: 'PLATFORM_ADMIN' },
      ],
    })
    for (const [key, email] of Object.entries(EMAILS)) tokens[key] = (await login(email)).body.data.tokens.accessToken
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  it('設定できるのはテナントの管理者だけ', async () => {
    expect((await request(app).get('/api/v1/settings/ip-restriction').set(auth(tokens.manager))).status).toBe(403)
    const res = await request(app).get('/api/v1/settings/ip-restriction').set(auth(tokens.admin))
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ enabled: false, entries: [], currentIp: '127.0.0.1' })
  })

  it('自分のアクセス元が入っていない許可リストでは有効にできない（締め出し防止）', async () => {
    const res = await request(app)
      .put('/api/v1/settings/ip-restriction')
      .set(auth(tokens.admin))
      .send({ enabled: true, entries: [{ cidr: '203.0.113.0/24', label: '本社' }] })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('127.0.0.1')

    const bad = await request(app)
      .put('/api/v1/settings/ip-restriction')
      .set(auth(tokens.admin))
      .send({ enabled: true, entries: [{ cidr: 'not-an-ip' }] })
    expect(bad.status).toBe(400)
  })

  it('有効にすると許可リスト外からはログイン・利用中の API・トークン更新がすべて止まり、他テナントには影響しない', async () => {
    const ok = await request(app)
      .put('/api/v1/settings/ip-restriction')
      .set(auth(tokens.admin))
      .send({ enabled: true, entries: [{ cidr: '127.0.0.1', label: 'テスト' }, { cidr: '203.0.113.0/24', label: '本社' }] })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect((await request(app).get('/api/v1/auth/me').set(auth(tokens.manager))).status).toBe(200)
    const refreshToken = (await login(EMAILS.manager)).body.data.tokens.refreshToken

    // アクセス元が許可リストから外れた状態にする（管理画面からは締め出し防止で作れないので DB で直接）
    await prisma.tenant.update({
      where: { id: TENANT_A },
      data: { ipAllowlist: [{ cidr: '203.0.113.0/24', label: '本社' }] },
    })

    const me = await request(app).get('/api/v1/auth/me').set(auth(tokens.manager))
    expect(me.status).toBe(403)
    expect(me.body.error).toContain('許可されていないネットワーク')
    expect((await login(EMAILS.manager)).status).toBe(403)
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken })).status).toBe(403)
    // パスワードが違えば、IP 制限の有無は明かさない
    const wrong = await login(EMAILS.manager, 'Wrong1234')
    expect(wrong.status).toBe(401)
    expect(wrong.body.error).not.toContain('ネットワーク')

    expect((await request(app).get('/api/v1/auth/me').set(auth(tokens.otherAdmin))).status).toBe(200)
    expect((await request(app).get('/api/v1/auth/me').set(auth(tokens.platform))).status).toBe(200)

    const tenants = await request(app).get('/api/v1/platform/tenants').set(auth(tokens.platform))
    expect(tenants.body.data.find((t: { id: string }) => t.id === TENANT_A).ipRestrictionEnabled).toBe(true)
  })

  it('締め出されたテナントは運営が解除でき、監査ログに残る', async () => {
    expect((await request(app).post(`/api/v1/platform/tenants/${TENANT_A}/disable-ip-restriction`).set(auth(tokens.admin))).status).toBe(403)
    const res = await request(app).post(`/api/v1/platform/tenants/${TENANT_A}/disable-ip-restriction`).set(auth(tokens.platform))
    expect(res.status).toBe(200)
    expect((await login(EMAILS.manager)).status).toBe(200)

    const logs = await prisma.auditLog.findMany({ where: { tenantId: TENANT_A, entity: 'IpRestriction' }, orderBy: { createdAt: 'asc' } })
    expect(logs).toHaveLength(2)
    expect(logs[1].newValue).toMatchObject({ enabled: false, by: 'PLATFORM_ADMIN' })
    const failures = await prisma.auditLog.findMany({ where: { tenantId: TENANT_A, action: 'LOGIN_FAILED' } })
    expect(failures.map((f) => (f.newValue as { reason: string }).reason)).toContain('IP_NOT_ALLOWED')
  })
})
