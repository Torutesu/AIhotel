import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { addUtcDays, todayJst } from '../lib/date.js'

// 競合価格（#9）と OTB（#24 E2）の取り込みの統合テスト。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス xitest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'xitest'
const TENANT = `${PREFIX}-tenant`
const OTHER_TENANT = `${PREFIX}-tenant-b`
const HOTEL = `${PREFIX}-hotel`
const PASSWORD = 'Test1234'

describeIntegration('競合価格と OTB の取り込み（#9 / #24）', () => {
  let app: Express
  let prisma: PrismaClient
  const tokens: Record<string, string> = {}
  const today = todayJst()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const post = (path: string, key: string, body: object) =>
    request(app).post(path).set('Authorization', `Bearer ${tokens[key]}`).send(body)

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } })
    await prisma.auditLog.deleteMany({
      where: { OR: [{ tenantId: { in: [TENANT, OTHER_TENANT] } }, { userId: { in: users.map((u) => u.id) } }] },
    })
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER_TENANT] } } })
  }

  beforeAll(async () => {
    const appModule = await import('../app.js')
    app = appModule.app as unknown as Express
    prisma = new PrismaClient()
    await cleanup()

    const password = await bcrypt.hash(PASSWORD, 10)
    await prisma.tenant.create({ data: { id: TENANT, code: TENANT, name: TENANT } })
    await prisma.tenant.create({ data: { id: OTHER_TENANT, code: OTHER_TENANT, name: OTHER_TENANT } })
    await prisma.hotel.create({ data: { id: HOTEL, tenantId: TENANT, name: HOTEL, totalRooms: 50 } })
    await prisma.competitor.createMany({
      data: [
        { tenantId: TENANT, hotelId: HOTEL, name: '競合A' },
        { tenantId: TENANT, hotelId: HOTEL, name: '削除済み', isActive: false },
      ],
    })
    await prisma.user.createMany({
      data: [
        { email: `${PREFIX}-manager@example.com`, password, name: 'm', role: 'MANAGER', tenantId: TENANT, hotelId: HOTEL },
        { email: `${PREFIX}-operator@example.com`, password, name: 'o', role: 'OPERATOR', tenantId: TENANT, hotelId: HOTEL },
        { email: `${PREFIX}-other@example.com`, password, name: 'x', role: 'ADMIN', tenantId: OTHER_TENANT },
      ],
    })
    for (const key of ['manager', 'operator', 'other']) {
      const res = await request(app).post('/api/v1/auth/login').send({ email: `${PREFIX}-${key}@example.com`, password: PASSWORD })
      tokens[key] = res.body.data.tokens.accessToken
    }
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  describe('競合価格（#9）', () => {
    const day = () => iso(addUtcDays(today, 3))

    it('取得元をまたいで人数ごとの最安値を保存し、取得日時と満室を残す。監査ログに件数が残る', async () => {
      const res = await post('/api/v1/imports/competitor-prices', 'manager', {
        hotelId: HOTEL,
        rows: [
          { competitorName: '競合A', date: day(), price1P: 12000, price2P: 20000, source: 'rakuten', observedAt: new Date().toISOString() },
          { competitorName: '競合A', date: day(), price1P: 11000, source: 'jalan' },
          { competitorName: '競合A', date: iso(addUtcDays(today, 4)), soldOut: true, source: 'rakuten' },
        ],
      })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.data).toMatchObject({ total: 3, aggregated: 2, created: 2, updated: 0 })

      const rows = await prisma.competitorPriceData.findMany({ where: { tenantId: TENANT }, orderBy: { date: 'asc' } })
      expect(rows[0]).toMatchObject({ price1P: 11000, price2P: 20000, soldOut: false, dataSource: 'csv:jalan+rakuten' })
      expect(rows[0].observedAt).not.toBeNull()
      expect(rows[1]).toMatchObject({ price1P: null, soldOut: true })

      const log = await prisma.auditLog.findFirst({ where: { tenantId: TENANT, entity: 'CompetitorPriceData' } })
      expect(log?.newValue).toMatchObject({ import: 'competitor-prices', aggregated: 2 })
    })

    it('未登録・論理削除済みの競合名は 400 で、1行も書き込まない', async () => {
      const before = await prisma.competitorPriceData.count({ where: { tenantId: TENANT } })
      const res = await post('/api/v1/imports/competitor-prices', 'manager', {
        hotelId: HOTEL,
        rows: [
          { competitorName: '競合A', date: iso(addUtcDays(today, 10)), price1P: 10000 },
          { competitorName: '削除済み', date: iso(addUtcDays(today, 10)), price1P: 10000 },
        ],
      })
      expect(res.status).toBe(400)
      expect(res.body.errors[0].field).toBe('rows.1.competitorName')
      expect(await prisma.competitorPriceData.count({ where: { tenantId: TENANT } })).toBe(before)
    })

    it('オペレーターは 403、他テナントは 403', async () => {
      const body = { hotelId: HOTEL, rows: [{ competitorName: '競合A', date: day(), price1P: 1 }] }
      expect((await post('/api/v1/imports/competitor-prices', 'operator', body)).status).toBe(403)
      expect((await post('/api/v1/imports/competitor-prices', 'other', body)).status).toBe(403)
    })
  })

  describe('OTB（#24 E2）', () => {
    it('取込日からの残日数で保存し、同じ日の再取り込みは上書きする', async () => {
      const capturedDate = iso(today)
      const rows = [
        { stayDate: iso(today), roomsBooked: 40 },
        { stayDate: iso(addUtcDays(today, 30)), roomsBooked: 12 },
      ]
      const first = await post('/api/v1/imports/otb', 'manager', { hotelId: HOTEL, capturedDate, rows })
      expect(first.status, JSON.stringify(first.body)).toBe(200)
      expect(first.body.data).toMatchObject({ total: 2, created: 2, updated: 0, capturedDate })

      const again = await post('/api/v1/imports/otb', 'manager', {
        hotelId: HOTEL,
        rows: [{ stayDate: iso(addUtcDays(today, 30)), roomsBooked: 15 }],
      })
      expect(again.body.data).toMatchObject({ created: 0, updated: 1 })

      const saved = await prisma.bookingCurveData.findMany({ where: { hotelId: HOTEL }, orderBy: { daysBefore: 'asc' } })
      expect(saved.map((r) => [r.daysBefore, r.roomsBooked])).toEqual([
        [0, 40],
        [30, 15],
      ])
    })

    it('dryRun は書き込まない。過去の宿泊日と客室数超えは 400', async () => {
      const dry = await post('/api/v1/imports/otb', 'manager', {
        hotelId: HOTEL,
        dryRun: true,
        rows: [{ stayDate: iso(addUtcDays(today, 60)), roomsBooked: 5 }],
      })
      expect(dry.body.data).toMatchObject({ dryRun: true, created: 1 })
      expect(await prisma.bookingCurveData.count({ where: { hotelId: HOTEL, daysBefore: 60 } })).toBe(0)

      const bad = await post('/api/v1/imports/otb', 'manager', {
        hotelId: HOTEL,
        rows: [
          { stayDate: iso(addUtcDays(today, -1)), roomsBooked: 5 },
          { stayDate: iso(addUtcDays(today, 5)), roomsBooked: 51 },
        ],
      })
      expect(bad.status).toBe(400)
      expect(bad.body.errors.map((e: { field: string }) => e.field)).toEqual(['rows.0.stayDate', 'rows.1.roomsBooked'])
    })
  })
})
