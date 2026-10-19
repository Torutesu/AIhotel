import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { addUtcDays, todayJst } from '../lib/date.js'

// 2026-10 のデモ画面の修正で足した API。
//   - 料金カレンダー: 日割り予算・オンハンド・想定売上・日のタイプとその推移
//   - ブッキングカーブ: 前年同曜日の参考カーブ・日割り予算・AI の予測
//   - 日別パフォーマンス: 実績と日割り予算・AI の予測・前年同曜日
//   - イベントの取り込み・周辺の新規ホテル（登録・取り込み・権限・テナント分離・監査ログ）
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス dstest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'dstest'
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
const TOTAL_ROOMS = 100

describeIntegration('デモ画面の修正で足した API（2026-10）', () => {
  let app: Express
  let prisma: PrismaClient
  const tokens: Record<string, string> = {}
  const today = todayJst()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  // 来月（全日がこれから）と先月（全日が結果あり）
  const next = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1))
  const prev = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
  const daysIn = (first: Date) => new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const monthDays = (first: Date) => Array.from({ length: daysIn(first) }, (_, i) => addUtcDays(first, i))
  const ly = (d: Date) => addUtcDays(d, -364)
  // 来月の15日を見る日にする
  const target = addUtcDays(next, 14)
  const targetLead = Math.round((target.getTime() - today.getTime()) / 86_400_000)

  const get = (path: string, token: string, query: Record<string, string | number> = {}) =>
    request(app).get(path).query(query).set('Authorization', `Bearer ${token}`)
  const post = (path: string, token: string, body: unknown) =>
    request(app).post(path).set('Authorization', `Bearer ${token}`).send(body as object)

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
      await prisma.hotel.create({ data: { id: hotelId, tenantId, name: hotelId, totalRooms: TOTAL_ROOMS } })
    }
    await prisma.user.createMany({
      data: [
        { email: EMAILS.manager, password, name: 'm', role: 'MANAGER', tenantId: TENANT_A, hotelId: HOTEL_A },
        { email: EMAILS.operator, password, name: 'o', role: 'OPERATOR', tenantId: TENANT_A, hotelId: HOTEL_A },
        { email: EMAILS.otherManager, password, name: 'b', role: 'MANAGER', tenantId: TENANT_B, hotelId: HOTEL_B },
      ],
    })

    const base = { tenantId: TENANT_A, hotelId: HOTEL_A }
    // 来月・先月の予算（室数は 月の日数 × 50室、ADR 10,000円）
    for (const first of [next, prev]) {
      const rooms = daysIn(first) * 50
      await prisma.monthlyBudget.create({
        data: {
          ...base,
          year: first.getUTCFullYear(),
          month: first.getUTCMonth() + 1,
          budgetRooms: rooms,
          budgetAdr: 10_000,
          budgetRevenue: rooms * 10_000,
        },
      })
    }
    // 前年同曜日の実績: 来月・先月とも、前年同曜日の販売室数は 15日だけ 80室、それ以外は 40室
    const lastYearRows = [...monthDays(next), ...monthDays(prev)].map((d) => ({
      ...base,
      date: ly(d),
      soldRooms: d.getUTCDate() === 15 ? 80 : 40,
      occupancy: d.getUTCDate() === 15 ? 0.8 : 0.4,
      adr: 9_000,
      revPar: 3_600,
      totalRevenue: (d.getUTCDate() === 15 ? 80 : 40) * 9_000,
    }))
    await prisma.dailyData.createMany({ data: lastYearRows })
    // 先月の実績: 60室・ADR 12,000円
    await prisma.dailyData.createMany({
      data: monthDays(prev).map((d) => ({ ...base, date: d, soldRooms: 60, occupancy: 0.6, adr: 12_000, revPar: 7_200, totalRevenue: 720_000 })),
    })
    // AI の予測（来月・先月とも 予測稼働率 70%・予測ADR 11,000円）
    await prisma.aiPriceRecommendation.createMany({
      data: [...monthDays(next), ...monthDays(prev)].map((d) => ({
        ...base,
        date: d,
        predictedOccupancy: 0.7,
        predictedAdr: 11_000,
        recommendedRank: 20,
        recommendedPrice: 12_000,
        demandLevel: 'C' as const,
        confidence: 0.8,
        modelVersion: 'test',
      })),
    })
    // 見る日（来月15日）の予約積上: 90日前（来る前なら）と今日。前年同曜日は 90日前と今日と同じ残日数
    const curve = [
      { stayDate: target, daysBefore: targetLead, roomsBooked: 36 },
      { stayDate: ly(target), daysBefore: targetLead, roomsBooked: 30 },
      { stayDate: ly(target), daysBefore: 0, roomsBooked: 80 },
    ]
    if (targetLead < 90) {
      curve.push({ stayDate: target, daysBefore: 90, roomsBooked: 10 }, { stayDate: ly(target), daysBefore: 90, roomsBooked: 10 })
    }
    await prisma.bookingCurveData.createMany({ data: curve.map((c) => ({ ...base, ...c })) })

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

  describe('料金カレンダー（DP02 / DP03 / DP04）', () => {
    it('予算を前年同曜日の販売室数の比で日に配り、ADR は月の値にする', async () => {
      const res = await get('/api/v1/pricing/calendar', tokens.operator, { hotelId: HOTEL_A, year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.data.totalRooms).toBe(TOTAL_ROOMS)
      const days = res.body.data.calendar as Array<Record<string, number | string | null>>
      const n = daysIn(next)
      // 重み: 15日だけ 80、他は 40 → 15日の予算室数 = 50n × 80 / (40(n−1) + 80)
      const expected15 = Math.round((50 * n * 80) / (40 * (n - 1) + 80))
      const day15 = days[14]
      expect(day15.budgetRooms).toBe(expected15)
      expect(day15.budgetAdr).toBe(10_000)
      expect(day15.budgetRevenue).toBe(Math.round((50 * n * 10_000 * 80) / (40 * (n - 1) + 80)))
      expect(day15.budgetOccupancy).toBeCloseTo(expected15 / TOTAL_ROOMS, 2)
      expect(Number(days[0].budgetRooms)).toBeLessThan(expected15)
      // 想定売上 = 70室 × 11,000円
      expect(day15.expectedRevenue).toBe(770_000)
    })

    it('先の日はオンハンド（今の予約室数）と日のタイプ・推移を返す', async () => {
      const res = await get('/api/v1/pricing/calendar', tokens.operator, { hotelId: HOTEL_A, year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 })
      const day15 = res.body.data.calendar[14]
      expect(day15.onHandRooms).toBe(36)
      expect(day15.currentOccupancy).toBe(0.36)
      expect(day15.currentRevenue).toBeNull()
      // 着地見込み 36 + (80 − 30) = 86室 → B、ペース 36 / 30 = 1.2 → 1
      expect(day15.dayType).toBe('B1')
      expect(day15.dayTypeExpectedOccupancy).toBe(0.86)
      expect(day15.dayTypePaceRatio).toBe(1.2)
      if (targetLead < 90) {
        // 90日前: 10室 vs 10室 → ペース 1.0 → 3、着地 10 + 70 = 80室 → C
        expect(day15.dayTypeHistory[0]).toEqual({ daysBefore: 90, dayType: 'C3', otbRooms: 10, paceRatio: 1 })
      }
      // 予約積上の無い日は AI の予測で英字だけ（70% → C）
      expect(res.body.data.calendar[0].dayType).toBe('C')
    })

    it('結果の出た日は実績をオンハンド・現在値にする', async () => {
      const res = await get('/api/v1/pricing/calendar', tokens.operator, { hotelId: HOTEL_A, year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1 })
      const day = res.body.data.calendar[0]
      expect(day).toMatchObject({ onHandRooms: 60, currentOccupancy: 0.6, currentRevenue: 720_000 })
      // 結果 60室 vs 前年 40室 → 1.5 → 1、着地 60% → D
      expect(day.dayType).toBe('D1')
      expect(day.dayTypeHistory.map((h: { daysBefore: number }) => h.daysBefore)).toEqual([90, 60, 30, 14, 7, 3, 1, 0])
    })
  })

  describe('ブッキングカーブ（ダッシュボードの月間BCグラフ）', () => {
    it('前年同曜日の参考カーブ・日割り予算・AI の予測を返す', async () => {
      const res = await get('/api/v1/daily/booking-curve', tokens.operator, { hotelId: HOTEL_A, date: iso(target) })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      const data = res.body.data
      expect(data.points.map((p: { roomsBooked: number }) => p.roomsBooked).at(-1)).toBe(36)
      expect(data.reference.date).toBe(iso(ly(target)))
      expect(data.reference.points.at(-1)).toMatchObject({ daysBefore: 0, roomsBooked: 80 })
      expect(data.reference.finalRooms).toBe(80)
      expect(data.budget.adr).toBe(10_000)
      expect(data.prediction).toEqual({ occupancy: 0.7, rooms: 70, adr: 11_000 })
      expect(data.actual).toBeNull()
    })

    it('前年同曜日が特殊日なら参考カーブを出さない', async () => {
      const special = await prisma.event.create({
        data: { tenantId: TENANT_A, hotelId: HOTEL_A, name: '前年の台風', type: 'weather', startDate: ly(target), endDate: ly(target), excludeFromHistory: true },
      })
      const res = await get('/api/v1/daily/booking-curve', tokens.operator, { hotelId: HOTEL_A, date: iso(target) })
      expect(res.body.data.reference.points).toEqual([])
      expect(res.body.data.reference.finalRooms).toBeNull()
      await prisma.event.delete({ where: { id: special.id } })
    })
  })

  describe('日別パフォーマンス', () => {
    it('実績と、日割り予算・AI の予測・前年同曜日を日ごとに返す', async () => {
      const res = await get('/api/v1/analysis/daily-performance', tokens.operator, { hotelId: HOTEL_A, year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1 })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.data.days).toHaveLength(daysIn(prev))
      const day = res.body.data.days[0]
      expect(day.actual).toEqual({ soldRooms: 60, occupancy: 0.6, adr: 12_000, revPar: 7_200, revenue: 720_000 })
      expect(day.ai).toEqual({ soldRooms: 70, occupancy: 0.7, adr: 11_000, revPar: 7_700, revenue: 770_000 })
      expect(day.lastYearDate).toBe(iso(ly(prev)))
      expect(day.lastYear).toMatchObject({ soldRooms: 40, adr: 9_000, revenue: 360_000 })
      expect(day.budget.adr).toBe(10_000)
    })

    it('月のグラフ: 月の予約の積み上がりと、予算・AI の予測・前年同曜日の合計を返す', async () => {
      const res = await get('/api/v1/analysis/month-pace', tokens.operator, { hotelId: HOTEL_A, year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1 })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      const n = daysIn(prev)
      const data = res.body.data
      expect(data).toMatchObject({ totalRooms: TOTAL_ROOMS, days: n, budgetRooms: 50 * n, aiRooms: 70 * n })
      expect(data.budgetOccupancy).toBe(0.5)
      // 先月の宿泊日には予約積上の記録が無く結果だけ → 結果（0日前）だけが出る
      expect(data.points).toEqual([
        { daysBefore: 0, rooms: 60 * n, occupancy: 0.6, comparableRooms: 60 * n, lastYearRooms: 40 * (n - 1) + 80 },
      ])
      expect((await get('/api/v1/analysis/month-pace', tokens.otherManager, { hotelId: HOTEL_A, year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1 })).status).toBe(403)
    })

    it('他テナントは 403', async () => {
      const res = await get('/api/v1/analysis/daily-performance', tokens.otherManager, { hotelId: HOTEL_A, year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1 })
      expect(res.status).toBe(403)
    })
  })

  describe('イベントの取り込み（外部需要動向）', () => {
    const rows = [
      { name: '花火大会', type: 'festival', startDate: iso(addUtcDays(today, 10)), endDate: iso(addUtcDays(today, 10)), expectedImpact: 'high' },
      { name: '学会', type: 'conference', startDate: iso(addUtcDays(today, 20)), endDate: iso(addUtcDays(today, 22)), location: '国際会議場' },
    ]

    it('確認（dryRun）では書き込まず、取り込むと登録し、同じ行を取り込み直すと上書きする', async () => {
      const dry = await post('/api/v1/events/import', tokens.manager, { hotelId: HOTEL_A, dryRun: true, rows })
      expect(dry.status, JSON.stringify(dry.body)).toBe(200)
      expect(dry.body.data).toMatchObject({ dryRun: true, total: 2, created: 2, updated: 0 })
      expect(dry.body.data.tenantId).toBeUndefined()
      expect(await prisma.event.count({ where: { hotelId: HOTEL_A } })).toBe(0)

      const done = await post('/api/v1/events/import', tokens.manager, { hotelId: HOTEL_A, rows })
      expect(done.body.data).toMatchObject({ dryRun: false, created: 2, updated: 0, startDate: rows[0].startDate, endDate: rows[1].endDate })
      expect(await prisma.event.count({ where: { hotelId: HOTEL_A } })).toBe(2)

      const again = await post('/api/v1/events/import', tokens.manager, {
        hotelId: HOTEL_A,
        rows: [{ ...rows[0], expectedImpact: 'low', description: '雨天中止' }],
      })
      expect(again.body.data).toMatchObject({ created: 0, updated: 1 })
      const updated = await prisma.event.findFirst({ where: { hotelId: HOTEL_A, name: '花火大会' } })
      expect(updated).toMatchObject({ expectedImpact: 'low', description: '雨天中止' })
      expect(await prisma.event.count({ where: { hotelId: HOTEL_A } })).toBe(2)
      expect(await prisma.auditLog.count({ where: { tenantId: TENANT_A, entity: 'Event' } })).toBe(2)
    })

    it('1行でも不正なら何も書かず、行番号つきのエラーを返す', async () => {
      const res = await post('/api/v1/events/import', tokens.manager, {
        hotelId: HOTEL_A,
        rows: [
          { name: '新規', type: 'other', startDate: iso(addUtcDays(today, 5)), endDate: iso(addUtcDays(today, 5)) },
          { name: '逆転', type: 'other', startDate: iso(addUtcDays(today, 9)), endDate: iso(addUtcDays(today, 8)) },
          { name: '新規', type: 'other', startDate: iso(addUtcDays(today, 5)), endDate: iso(addUtcDays(today, 6)) },
        ],
      })
      expect(res.status).toBe(400)
      expect(res.body.errors.map((e: { field: string }) => e.field)).toEqual(['rows.1.endDate', 'rows.2.name'])
      expect(await prisma.event.count({ where: { hotelId: HOTEL_A, name: '新規' } })).toBe(0)
    })

    it('オペレーターと他テナントは取り込めない', async () => {
      expect((await post('/api/v1/events/import', tokens.operator, { hotelId: HOTEL_A, rows })).status).toBe(403)
      expect((await post('/api/v1/events/import', tokens.otherManager, { hotelId: HOTEL_A, rows })).status).toBe(403)
    })
  })

  describe('周辺の新規ホテル（外部需要動向）', () => {
    let id = ''

    it('マネージャーは登録・更新・削除でき、監査ログに残る', async () => {
      const created = await post('/api/v1/new-hotels', tokens.manager, {
        hotelId: HOTEL_A,
        name: 'ホテル駅前新館',
        openingDate: iso(addUtcDays(today, 60)),
        rooms: 180,
        category: 'ビジネス',
        distanceKm: 0.8,
        expectedImpact: 'high',
      })
      expect(created.status, JSON.stringify(created.body)).toBe(201)
      id = created.body.data.id

      const list = await get('/api/v1/new-hotels', tokens.operator, { hotelId: HOTEL_A })
      expect(list.status).toBe(200)
      expect(list.body.data).toHaveLength(1)
      expect(list.body.data[0]).toMatchObject({ name: 'ホテル駅前新館', rooms: 180, distanceKm: 0.8 })

      const updated = await request(app)
        .put(`/api/v1/new-hotels/${id}`)
        .query({ hotelId: HOTEL_A })
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ rooms: 200, notes: '客室数を訂正' })
      expect(updated.status, JSON.stringify(updated.body)).toBe(200)
      expect(updated.body.data).toMatchObject({ rooms: 200, notes: '客室数を訂正' })
      expect(await prisma.auditLog.count({ where: { tenantId: TENANT_A, entity: 'NewHotelOpening' } })).toBe(2)
    })

    it('オペレーターは変更できず、他テナントは見ることも変えることもできない', async () => {
      expect((await post('/api/v1/new-hotels', tokens.operator, { hotelId: HOTEL_A, name: 'x', openingDate: iso(today) })).status).toBe(403)
      expect((await get('/api/v1/new-hotels', tokens.otherManager, { hotelId: HOTEL_A })).status).toBe(403)
      // 自分のホテルを指定しても、他テナントの行は消せない
      const other = await request(app)
        .delete(`/api/v1/new-hotels/${id}`)
        .query({ hotelId: HOTEL_B })
        .set('Authorization', `Bearer ${tokens.otherManager}`)
      expect(other.status).toBe(404)
      expect(await prisma.newHotelOpening.count({ where: { id } })).toBe(1)
    })

    it('取り込みは同じ名前・同じ開業日を上書きし、不正な行があれば何も書かない', async () => {
      const rows = [
        { name: 'ホテル駅前新館', openingDate: iso(addUtcDays(today, 60)), rooms: 210 },
        { name: 'リゾート南', openingDate: iso(addUtcDays(today, 120)), category: 'リゾート', expectedImpact: 'medium' },
      ]
      const dry = await post('/api/v1/new-hotels/import', tokens.manager, { hotelId: HOTEL_A, dryRun: true, rows })
      expect(dry.body.data).toMatchObject({ dryRun: true, total: 2, created: 1, updated: 1 })
      const done = await post('/api/v1/new-hotels/import', tokens.manager, { hotelId: HOTEL_A, rows })
      expect(done.status).toBe(200)
      expect(await prisma.newHotelOpening.count({ where: { hotelId: HOTEL_A } })).toBe(2)
      expect((await prisma.newHotelOpening.findUnique({ where: { id } }))?.rooms).toBe(210)

      const bad = await post('/api/v1/new-hotels/import', tokens.manager, {
        hotelId: HOTEL_A,
        rows: [{ name: '追加', openingDate: iso(today) }, { name: '負の客室', openingDate: iso(today), rooms: -1 }],
      })
      expect(bad.status).toBe(400)
      expect(bad.body.errors[0].field).toBe('rows.1.rooms')
      expect(await prisma.newHotelOpening.count({ where: { hotelId: HOTEL_A } })).toBe(2)
    })

    it('マネージャーは削除できる', async () => {
      const res = await request(app)
        .delete(`/api/v1/new-hotels/${id}`)
        .query({ hotelId: HOTEL_A })
        .set('Authorization', `Bearer ${tokens.manager}`)
      expect(res.status).toBe(200)
      expect(await prisma.newHotelOpening.count({ where: { id } })).toBe(0)
    })
  })
})
