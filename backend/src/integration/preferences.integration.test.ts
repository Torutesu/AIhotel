import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

// 画面表示設定のサーバ保存 API の統合テスト（#51-2）。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス ptest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'ptest'
const TENANT_A = `${PREFIX}-tenant-a`
const TENANT_B = `${PREFIX}-tenant-b`
const HOTEL_A = `${PREFIX}-hotel-a`
const HOTEL_B = `${PREFIX}-hotel-b`
const PASSWORD = 'Test1234'

const EMAILS = {
  operator: `${PREFIX}-operator@example.com`,
  manager: `${PREFIX}-manager@example.com`,
  otherTenantManager: `${PREFIX}-manager-b@example.com`,
}

describeIntegration('画面表示設定 API（#51-2）', () => {
  let app: Express
  let prisma: PrismaClient
  const tokens: Record<string, string> = {}

  async function login(email: string) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD })
    expect(res.status, `${email} のログインに失敗: ${JSON.stringify(res.body)}`).toBe(200)
    return res.body.data.tokens.accessToken as string
  }

  async function cleanup() {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: PREFIX } },
      select: { id: true },
    })
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ tenantId: { in: [TENANT_A, TENANT_B] } }, { userId: { in: users.map((u) => u.id) } }],
      },
    })
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } })
  }

  beforeAll(async () => {
    const appModule = await import('../app.js')
    app = appModule.app as unknown as Express
    prisma = new PrismaClient()

    await cleanup()

    const password = await bcrypt.hash(PASSWORD, 10)
    for (const [tenantId, hotelId, suffix] of [
      [TENANT_A, HOTEL_A, 'A'],
      [TENANT_B, HOTEL_B, 'B'],
    ] as const) {
      await prisma.tenant.create({
        data: { id: tenantId, code: tenantId, name: `表示設定テストテナント${suffix}` },
      })
      await prisma.hotel.create({
        data: { id: hotelId, tenantId, name: `表示設定テストホテル${suffix}`, totalRooms: 80 },
      })
    }

    await prisma.user.createMany({
      data: [
        {
          email: EMAILS.operator,
          password,
          name: '表示設定テストオペレーター',
          role: 'OPERATOR',
          tenantId: TENANT_A,
          hotelId: HOTEL_A,
        },
        {
          email: EMAILS.manager,
          password,
          name: '表示設定テストマネージャー',
          role: 'MANAGER',
          tenantId: TENANT_A,
          hotelId: HOTEL_A,
        },
        {
          email: EMAILS.otherTenantManager,
          password,
          name: '別テナントマネージャー',
          role: 'MANAGER',
          tenantId: TENANT_B,
          hotelId: HOTEL_B,
        },
      ],
    })

    tokens.operator = await login(EMAILS.operator)
    tokens.manager = await login(EMAILS.manager)
    tokens.otherTenantManager = await login(EMAILS.otherTenantManager)
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('未保存なら既定値（全KPI表示・販売サイト非表示）を返す', async () => {
    const res = await request(app)
      .get(`/api/v1/preferences?hotelId=${HOTEL_A}`)
      .set('Authorization', `Bearer ${tokens.manager}`)

    expect(res.status).toBe(200)
    expect(res.body.data.dashboard.showTopSitesSection).toBe(false)
    expect(res.body.data.dashboard.kpiItems).toHaveLength(8)
  })

  it('OPERATOR も自分の表示設定を保存・再取得できる', async () => {
    const save = await request(app)
      .put('/api/v1/preferences')
      .set('Authorization', `Bearer ${tokens.operator}`)
      .send({
        hotelId: HOTEL_A,
        dashboard: { showTopSitesSection: true, kpiItems: ['adr', 'occupancyRate'] },
      })

    expect(save.status).toBe(200)
    expect(save.body.data.dashboard).toEqual({
      showTopSitesSection: true,
      kpiItems: ['adr', 'occupancyRate'],
    })

    const read = await request(app)
      .get(`/api/v1/preferences?hotelId=${HOTEL_A}`)
      .set('Authorization', `Bearer ${tokens.operator}`)
    expect(read.body.data.dashboard.kpiItems).toEqual(['adr', 'occupancyRate'])

    // 他の利用者の設定には影響しない
    const otherUser = await request(app)
      .get(`/api/v1/preferences?hotelId=${HOTEL_A}`)
      .set('Authorization', `Bearer ${tokens.manager}`)
    expect(otherUser.body.data.dashboard.kpiItems).toHaveLength(8)
  })

  it('保存は監査ログに記録される', async () => {
    await request(app)
      .put('/api/v1/preferences')
      .set('Authorization', `Bearer ${tokens.manager}`)
      .send({ hotelId: HOTEL_A, dashboard: { showTopSitesSection: false, kpiItems: ['adr'] } })

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'UserPreference', tenantId: TENANT_A },
    })
    expect(audit).not.toBeNull()
  })

  it('KPI表示項目を空にできない', async () => {
    const res = await request(app)
      .put('/api/v1/preferences')
      .set('Authorization', `Bearer ${tokens.manager}`)
      .send({ hotelId: HOTEL_A, dashboard: { showTopSitesSection: false, kpiItems: [] } })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('未知のKPIキーは拒否する', async () => {
    const res = await request(app)
      .put('/api/v1/preferences')
      .set('Authorization', `Bearer ${tokens.manager}`)
      .send({ hotelId: HOTEL_A, dashboard: { showTopSitesSection: false, kpiItems: ['__evil__'] } })

    expect(res.status).toBe(400)
  })

  it('他テナントのホテルの設定は取得も保存もできない', async () => {
    const read = await request(app)
      .get(`/api/v1/preferences?hotelId=${HOTEL_A}`)
      .set('Authorization', `Bearer ${tokens.otherTenantManager}`)
    expect(read.status).toBe(403)

    const write = await request(app)
      .put('/api/v1/preferences')
      .set('Authorization', `Bearer ${tokens.otherTenantManager}`)
      .send({ hotelId: HOTEL_A, dashboard: { showTopSitesSection: true, kpiItems: ['adr'] } })
    expect(write.status).toBe(403)
    expect(
      await prisma.userPreference.count({ where: { hotelId: HOTEL_A, tenantId: TENANT_B } })
    ).toBe(0)
  })

  it('未認証では 401 を返す', async () => {
    expect((await request(app).get(`/api/v1/preferences?hotelId=${HOTEL_A}`)).status).toBe(401)
  })
})
