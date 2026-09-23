import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

// チャネル別・部屋タイプ別・曜日別の内訳 API（#88）の統合テスト。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス abtest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'abtest'
const TENANT_A = `${PREFIX}-tenant-a`
const TENANT_B = `${PREFIX}-tenant-b`
const HOTEL_A = `${PREFIX}-hotel-a`
const HOTEL_B = `${PREFIX}-hotel-b`
const PASSWORD = 'Test1234'

describeIntegration('分析の内訳 API（#88）', () => {
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
      await prisma.hotel.create({ data: { id: hotelId, tenantId, name: hotelId, totalRooms: 100, weekendDays: [5, 6] } })
    }
    await prisma.user.createMany({
      data: [
        { email: `${PREFIX}-op@example.com`, password, name: 'o', role: 'OPERATOR', tenantId: TENANT_A, hotelId: HOTEL_A },
        { email: `${PREFIX}-b@example.com`, password, name: 'b', role: 'MANAGER', tenantId: TENANT_B, hotelId: HOTEL_B },
      ],
    })

    // 2026-08-07（金）と 08-10（月）の実績、部屋タイプ別・チャネル別の内訳
    const twin = await prisma.roomType.create({
      data: { tenantId: TENANT_A, hotelId: HOTEL_A, name: 'ツイン', code: 'TWN', capacity: 2, count: 60 },
    })
    const single = await prisma.roomType.create({
      data: { tenantId: TENANT_A, hotelId: HOTEL_A, name: 'シングル', code: 'SGL', capacity: 1, count: 40, sortOrder: 1 },
    })
    for (const [date, sold, revenue, twinRooms] of [
      ['2026-08-07', 90, 2_250_000, 60],
      ['2026-08-10', 50, 900_000, 30],
    ] as const) {
      const day = await prisma.dailyData.create({
        data: { tenantId: TENANT_A, hotelId: HOTEL_A, date: new Date(`${date}T00:00:00Z`), soldRooms: sold, totalRevenue: revenue },
      })
      await prisma.dailyRoomData.createMany({
        data: [
          { tenantId: TENANT_A, dailyDataId: day.id, roomTypeId: twin.id, soldRooms: twinRooms, revenue: revenue * 0.7 },
          { tenantId: TENANT_A, dailyDataId: day.id, roomTypeId: single.id, soldRooms: sold - twinRooms, revenue: revenue * 0.3 },
        ],
      })
      await prisma.otaChannelData.createMany({
        data: [
          { tenantId: TENANT_A, hotelId: HOTEL_A, date: new Date(`${date}T00:00:00Z`), channel: '公式', roomsSold: sold / 2, revenue: revenue / 2 },
          { tenantId: TENANT_A, hotelId: HOTEL_A, date: new Date(`${date}T00:00:00Z`), channel: '楽天', roomsSold: sold / 2, revenue: revenue / 2 },
        ],
      })
    }

    for (const [key, email] of [
      ['op', `${PREFIX}-op@example.com`],
      ['b', `${PREFIX}-b@example.com`],
    ]) {
      const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD })
      tokens[key] = res.body.data.tokens.accessToken
    }
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  const get = (path: string, token: string) =>
    request(app).get(path).query({ hotelId: HOTEL_A, year: 2026, month: 8 }).set('Authorization', `Bearer ${token}`)

  it('チャネル別', async () => {
    const res = await get('/api/v1/analysis/channels', tokens.op)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.data.channels).toHaveLength(2)
    expect(res.body.data.channels[0]).toMatchObject({ roomsSold: 70, revenue: 1_575_000, revenueShare: 50 })
  })

  it('部屋タイプ別（実績日数2日 × 室数で稼働率を出す）', async () => {
    const res = await get('/api/v1/analysis/room-types', tokens.op)
    expect(res.status).toBe(200)
    expect(res.body.data.actualDays).toBe(2)
    expect(res.body.data.roomTypes[0]).toMatchObject({ code: 'TWN', soldRooms: 90, occupancy: 0.75 })
  })

  it('曜日別（金曜は週末）', async () => {
    const res = await get('/api/v1/analysis/day-of-week', tokens.op)
    expect(res.status).toBe(200)
    expect(res.body.data.days[5]).toMatchObject({ isWeekend: true, days: 1, soldRooms: 90, occupancy: 0.9, adr: 25_000 })
    expect(res.body.data.days[1]).toMatchObject({ isWeekend: false, days: 1, occupancy: 0.5 })
  })

  it('他テナントは 403', async () => {
    for (const path of ['/api/v1/analysis/channels', '/api/v1/analysis/room-types', '/api/v1/analysis/day-of-week']) {
      expect((await get(path, tokens.b)).status).toBe(403)
    }
  })
})
