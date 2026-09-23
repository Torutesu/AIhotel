import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

// 日次実績の取り込み（#82）の統合テスト。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス itst）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'itst'
const TENANT_A = `${PREFIX}-tenant-a`
const TENANT_B = `${PREFIX}-tenant-b`
const HOTEL_A = `${PREFIX}-hotel-a`
const HOTEL_B = `${PREFIX}-hotel-b`
const PASSWORD = 'Test1234'
const EMAILS = {
  manager: `${PREFIX}-manager@example.com`,
  operator: `${PREFIX}-operator@example.com`,
  otherManager: `${PREFIX}-manager-b@example.com`,
}

const ROWS = [
  { date: '2026-08-01', soldRooms: 80, totalRevenue: 1_600_000, guests: 150 },
  { date: '2026-08-02', soldRooms: 50, totalRevenue: 900_000 },
]

describeIntegration('日次実績の取り込み（#82）', () => {
  let app: Express
  let prisma: PrismaClient
  const tokens: Record<string, string> = {}

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } })
    await prisma.auditLog.deleteMany({
      where: { OR: [{ tenantId: { in: [TENANT_A, TENANT_B] } }, { userId: { in: users.map((u) => u.id) } }] },
    })
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } })
  }

  const post = (token: string, body: object) =>
    request(app).post('/api/v1/imports/daily-data').set('Authorization', `Bearer ${token}`).send(body)

  const rowsInDb = () =>
    prisma.dailyData.findMany({ where: { hotelId: HOTEL_A }, orderBy: { date: 'asc' } })

  beforeAll(async () => {
    const appModule = await import('../app.js')
    app = appModule.app as unknown as Express
    prisma = new PrismaClient()
    await cleanup()

    const password = await bcrypt.hash(PASSWORD, 10)
    for (const [tenantId, hotelId] of [
      [TENANT_A, HOTEL_A],
      [TENANT_B, HOTEL_B],
    ] as const) {
      await prisma.tenant.create({ data: { id: tenantId, code: tenantId, name: tenantId } })
      await prisma.hotel.create({ data: { id: hotelId, tenantId, name: hotelId, totalRooms: 100 } })
    }
    await prisma.user.createMany({
      data: [
        { email: EMAILS.manager, password, name: 'm', role: 'MANAGER', tenantId: TENANT_A, hotelId: HOTEL_A },
        { email: EMAILS.operator, password, name: 'o', role: 'OPERATOR', tenantId: TENANT_A, hotelId: HOTEL_A },
        { email: EMAILS.otherManager, password, name: 'b', role: 'MANAGER', tenantId: TENANT_B, hotelId: HOTEL_B },
      ],
    })
    for (const [key, email] of Object.entries(EMAILS)) {
      const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD })
      tokens[key] = res.body.data.tokens.accessToken
    }
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  it('オペレーターと他テナントのマネージャーは取り込めない', async () => {
    expect((await post(tokens.operator, { hotelId: HOTEL_A, rows: ROWS })).status).toBe(403)
    expect((await post(tokens.otherManager, { hotelId: HOTEL_A, rows: ROWS })).status).toBe(403)
  })

  it('dryRun は件数だけ返して書き込まない', async () => {
    const res = await post(tokens.manager, { hotelId: HOTEL_A, rows: ROWS, dryRun: true })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.data).toMatchObject({ dryRun: true, total: 2, created: 2, updated: 0 })
    expect(await rowsInDb()).toHaveLength(0)
  })

  it('取り込むと KPI を算出して保存し、同じ内容を2回取り込んでも結果が変わらない', async () => {
    const first = await post(tokens.manager, { hotelId: HOTEL_A, rows: ROWS })
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body.data).toMatchObject({ created: 2, updated: 0, startDate: '2026-08-01', endDate: '2026-08-02' })

    const second = await post(tokens.manager, { hotelId: HOTEL_A, rows: ROWS })
    expect(second.body.data).toMatchObject({ created: 0, updated: 2 })

    const saved = await rowsInDb()
    expect(saved).toHaveLength(2)
    expect(saved[0]).toMatchObject({ soldRooms: 80, totalRevenue: 1_600_000, guests: 150, occupancy: 0.8, adr: 20_000, revPar: 16_000 })
    expect(saved[1]).toMatchObject({ guests: null, occupancy: 0.5, adr: 18_000 })
  })

  it('不正な行を含むファイルは1行も書き込まず、行番号つきのエラーを返す', async () => {
    const res = await post(tokens.manager, {
      hotelId: HOTEL_A,
      rows: [
        { date: '2026-08-03', soldRooms: 10, totalRevenue: 100_000 },
        { date: '2026-08-04', soldRooms: 101, totalRevenue: 100_000 },
      ],
    })
    expect(res.status).toBe(400)
    expect(res.body.errors).toEqual([
      { field: 'rows.1.soldRooms', message: '販売室数 101 がホテルの客室数 100 を超えています' },
    ])
    expect(await rowsInDb()).toHaveLength(2)
  })

  it('形式の誤り（存在しない日付）はスキーマで弾く', async () => {
    const res = await post(tokens.manager, {
      hotelId: HOTEL_A,
      rows: [{ date: '2026-02-30', soldRooms: 1, totalRevenue: 1 }],
    })
    expect(res.status).toBe(400)
    expect(res.body.errors[0]).toMatchObject({ field: 'rows.0.date', message: '存在しない日付です' })
  })
})
