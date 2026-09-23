import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { addUtcDays, todayJst } from '../lib/date.js'

// これまで統合テストで一度も呼ばれていなかったエンドポイントの穴埋め（#87）。
// 各ルートで「正常系」「他テナントは 403」「オペレーターの変更系は 403」を確かめる。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス cvtest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'cvtest'
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

describeIntegration('統合テストの穴埋め（#87）', () => {
  let app: Express
  let prisma: PrismaClient
  const tokens: Record<string, string> = {}
  const refreshTokens: Record<string, string> = {}
  const today = todayJst()
  const year = today.getUTCFullYear()
  const month = today.getUTCMonth() + 1
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const get = (path: string, token: string, query: Record<string, string | number> = {}) =>
    request(app).get(path).query(query).set('Authorization', `Bearer ${token}`)

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
      await prisma.hotel.create({ data: { id: hotelId, tenantId, name: hotelId, totalRooms: 60 } })
    }
    await prisma.user.createMany({
      data: [
        { email: EMAILS.manager, password, name: 'm', role: 'MANAGER', tenantId: TENANT_A, hotelId: HOTEL_A },
        { email: EMAILS.operator, password, name: 'o', role: 'OPERATOR', tenantId: TENANT_A, hotelId: HOTEL_A },
        { email: EMAILS.otherManager, password, name: 'b', role: 'MANAGER', tenantId: TENANT_B, hotelId: HOTEL_B },
      ],
    })
    // 集計系が空でない結果を返すよう、当月の実績と競合価格を少し入れる
    await prisma.dailyData.createMany({
      data: [1, 2, 3].map((n) => ({
        tenantId: TENANT_A,
        hotelId: HOTEL_A,
        date: addUtcDays(today, -n),
        occupancy: 0.5,
        adr: 20_000,
        soldRooms: 30,
        totalRevenue: 600_000,
      })),
    })
    const competitor = await prisma.competitor.create({ data: { tenantId: TENANT_A, hotelId: HOTEL_A, name: '競合' } })
    await prisma.competitorPriceData.create({
      data: { tenantId: TENANT_A, competitorId: competitor.id, date: today, price1P: 18_000, dataSource: 'manual' },
    })

    for (const [key, email] of Object.entries(EMAILS)) {
      const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD })
      tokens[key] = res.body.data.tokens.accessToken
      refreshTokens[key] = res.body.data.tokens.refreshToken
    }
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  describe('イベント（S-4 / F-DP-07）', () => {
    let eventId = ''

    it('オペレーターも登録でき、一覧に出る', async () => {
      const created = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${tokens.operator}`)
        .send({ hotelId: HOTEL_A, name: '花火大会', type: 'festival', startDate: iso(today), endDate: iso(today), expectedImpact: 'high' })
      expect(created.status, JSON.stringify(created.body)).toBe(201)
      eventId = created.body.data.id

      const list = await get('/api/v1/events', tokens.operator, { hotelId: HOTEL_A })
      expect(list.status).toBe(200)
      expect(list.body.data.map((e: { id: string }) => e.id)).toContain(eventId)
    })

    it('オペレーターは更新・削除できず、マネージャーはできる', async () => {
      const opUpdate = await request(app)
        .put(`/api/v1/events/${eventId}`)
        .query({ hotelId: HOTEL_A })
        .set('Authorization', `Bearer ${tokens.operator}`)
        .send({ name: '変更' })
      expect(opUpdate.status).toBe(403)
      const opDelete = await request(app)
        .delete(`/api/v1/events/${eventId}`)
        .query({ hotelId: HOTEL_A })
        .set('Authorization', `Bearer ${tokens.operator}`)
      expect(opDelete.status).toBe(403)

      const update = await request(app)
        .put(`/api/v1/events/${eventId}`)
        .query({ hotelId: HOTEL_A })
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ name: '花火大会（雨天順延）' })
      expect(update.status, JSON.stringify(update.body)).toBe(200)
      expect(update.body.data.name).toBe('花火大会（雨天順延）')
    })

    it('開始日が終了日より後なら 400、他テナントは 403', async () => {
      const bad = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ hotelId: HOTEL_A, name: 'x', type: 'festival', startDate: iso(addUtcDays(today, 2)), endDate: iso(today) })
      expect(bad.status).toBe(400)
      expect((await get('/api/v1/events', tokens.otherManager, { hotelId: HOTEL_A })).status).toBe(403)
      const otherDelete = await request(app)
        .delete(`/api/v1/events/${eventId}`)
        .query({ hotelId: HOTEL_A })
        .set('Authorization', `Bearer ${tokens.otherManager}`)
      expect(otherDelete.status).toBe(403)
    })

    it('マネージャーは削除できる', async () => {
      const res = await request(app)
        .delete(`/api/v1/events/${eventId}`)
        .query({ hotelId: HOTEL_A })
        .set('Authorization', `Bearer ${tokens.manager}`)
      expect(res.status).toBe(200)
    })
  })

  describe('参照系（自テナントは 200、他テナントは 403）', () => {
    const cases: Array<[string, () => Record<string, string | number>]> = [
      ['/api/v1/pricing/calendar', () => ({ hotelId: HOTEL_A, year, month })],
      ['/api/v1/pricing/strategy', () => ({ hotelId: HOTEL_A })],
      ['/api/v1/daily/booking-curve', () => ({ hotelId: HOTEL_A, date: iso(today) })],
      ['/api/v1/daily/competitor-prices', () => ({ hotelId: HOTEL_A, startDate: iso(today), endDate: iso(today) })],
      ['/api/v1/analysis/monthly', () => ({ hotelId: HOTEL_A, year })],
      ['/api/v1/analysis/competitor', () => ({ hotelId: HOTEL_A, startDate: iso(today), endDate: iso(today) })],
      ['/api/v1/dashboard/alerts', () => ({ hotelId: HOTEL_A })],
      ['/api/v1/dashboard/ai-summary', () => ({ hotelId: HOTEL_A })],
    ]

    for (const [path, query] of cases) {
      it(path, async () => {
        const own = await get(path, tokens.operator, query())
        expect(own.status, `${path}: ${JSON.stringify(own.body)}`).toBe(200)
        expect(own.body.success).toBe(true)
        expect((await get(path, tokens.otherManager, query())).status).toBe(403)
      })
    }

    it('日付に時刻を付けたり、期間が長すぎたりすると 400（#90）', async () => {
      const shifted = await get('/api/v1/daily/competitor-prices', tokens.operator, {
        hotelId: HOTEL_A,
        startDate: `${iso(today)}T00:00:00+09:00`,
        endDate: iso(today),
      })
      expect(shifted.status).toBe(400)
      const tooLong = await get('/api/v1/events', tokens.operator, {
        hotelId: HOTEL_A,
        startDate: iso(today),
        endDate: iso(addUtcDays(today, 400)),
      })
      expect(tooLong.status).toBe(400)
    })

    it('競合価格は登録した価格を返す', async () => {
      const res = await get('/api/v1/daily/competitor-prices', tokens.operator, {
        hotelId: HOTEL_A,
        startDate: iso(today),
        endDate: iso(today),
      })
      const prices = res.body.data.competitors.flatMap((c: { prices: Array<{ price1P: number }> }) => c.prices)
      expect(prices.map((p: { price1P: number }) => p.price1P)).toContain(18_000)
    })
  })

  describe('月次レポート（F-REP-01/02）', () => {
    it('PDF と Excel をダウンロードでき、他テナントは 403', async () => {
      const pdf = await get('/api/v1/reports/monthly', tokens.operator, { hotelId: HOTEL_A, year, month, format: 'pdf' })
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => done(null, Buffer.concat(chunks)))
        })
      expect(pdf.status).toBe(200)
      expect(pdf.headers['content-type']).toContain('application/pdf')
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF')

      const excel = await get('/api/v1/reports/monthly', tokens.operator, { hotelId: HOTEL_A, year, month, format: 'excel' })
      expect(excel.status).toBe(200)
      expect(excel.headers['content-type']).toContain('spreadsheetml')

      expect(
        (await get('/api/v1/reports/monthly', tokens.otherManager, { hotelId: HOTEL_A, year, month, format: 'pdf' })).status
      ).toBe(403)
    })
  })

  describe('ヘルスチェック（#49-2）', () => {
    it('liveness は DB を見ずに 200、readiness は DB 込みで 200', async () => {
      const live = await request(app).get('/livez')
      expect(live.status).toBe(200)
      expect(live.body.data).not.toHaveProperty('services')
      const ready = await request(app).get('/readyz')
      expect(ready.status).toBe(200)
      expect(ready.body.data.services.database).toBe('healthy')
    })
  })

  describe('ログアウト', () => {
    it('logout はその端末のリフレッシュトークンだけを失効させる', async () => {
      const second = await request(app).post('/api/v1/auth/login').send({ email: EMAILS.operator, password: PASSWORD })
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${tokens.operator}`)
        .send({ refreshToken: refreshTokens.operator })
      expect(res.status).toBe(200)
      expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: refreshTokens.operator })).status).toBe(401)
      expect(
        (await request(app).post('/api/v1/auth/refresh').send({ refreshToken: second.body.data.tokens.refreshToken })).status
      ).toBe(200)
    })

    it('logout-all はすべての端末のリフレッシュトークンを失効させる', async () => {
      const res = await request(app).post('/api/v1/auth/logout-all').set('Authorization', `Bearer ${tokens.manager}`)
      expect(res.status).toBe(200)
      expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: refreshTokens.manager })).status).toBe(401)
      const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAILS.manager } })
      expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0)
    })
  })
})
