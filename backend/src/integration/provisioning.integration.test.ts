import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { addUtcDays, todayJst } from '../lib/date.js'

// 新しいテナントの立ち上げ（D-13 / R-3-8）と、開業直後のホテルの初期設定・予測の準備状況の統合テスト。
// DATABASE_URL が無ければスキップし、専用のプレフィクス（pvtest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'pvtest'
const EXISTING_TENANT = `${PREFIX}-existing`
const PASSWORD = 'Test1234'

describeIntegration('新しいテナントの立ち上げと、開業直後のホテル（D-13）', () => {
  let app: Express
  let prisma: PrismaClient
  const tokens: Record<string, string> = {}
  const today = todayJst()
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  async function cleanup() {
    const tenants = await prisma.tenant.findMany({ where: { code: { startsWith: PREFIX } }, select: { id: true } })
    const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } })
    await prisma.auditLog.deleteMany({
      where: { OR: [{ tenantId: { in: tenants.map((t) => t.id) } }, { userId: { in: users.map((u) => u.id) } }] },
    })
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
    await prisma.tenant.deleteMany({ where: { code: { startsWith: PREFIX } } })
  }

  const body = (suffix: string, over: Record<string, unknown> = {}) => ({
    tenant: { name: `新規運営会社${suffix}`, code: `${PREFIX}-new-${suffix}` },
    admin: { email: `${PREFIX}-admin-${suffix}@example.com`, name: '管理者' },
    hotel: {
      name: '新規ホテル',
      totalRooms: 120,
      hotelType: 'LIMITED_SERVICE',
      prefectureCode: '13',
      weekendDays: [5, 6],
      saleOpenDaysBefore: 330,
      openedOn: iso(addUtcDays(today, -40)),
    },
    ...over,
  })

  beforeAll(async () => {
    app = (await import('../app.js')).app as unknown as Express
    prisma = new PrismaClient()
    await cleanup()
    const password = await bcrypt.hash(PASSWORD, 10)
    await prisma.tenant.create({ data: { id: EXISTING_TENANT, code: EXISTING_TENANT, name: EXISTING_TENANT } })
    await prisma.user.createMany({
      data: [
        { email: `${PREFIX}-platform@example.com`, password, name: '運営', role: 'PLATFORM_ADMIN' },
        { email: `${PREFIX}-tenantadmin@example.com`, password, name: 'a', role: 'ADMIN', tenantId: EXISTING_TENANT },
      ],
    })
    for (const key of ['platform', 'tenantadmin']) {
      const res = await request(app).post('/api/v1/auth/login').send({ email: `${PREFIX}-${key}@example.com`, password: PASSWORD })
      tokens[key] = res.body.data.tokens.accessToken
    }
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  const provision = (key: string, payload: object) =>
    request(app).post('/api/v1/platform/tenants/provision').set('Authorization', `Bearer ${tokens[key]}`).send(payload)

  let hotelId = ''

  it('運営だけが、テナント・ホテル・管理者を1回で作れる（管理者は初回ログインでパスワード変更）', async () => {
    expect((await provision('tenantadmin', body('a'))).status).toBe(403)
    const res = await provision('platform', body('a'))
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    hotelId = res.body.data.hotel.id
    // メールで送れたら一時パスワードは返さない。送れなければ1回だけ返す
    expect(res.body.data.temporaryPassword).toEqual(res.body.data.emailSent ? null : expect.any(String))

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: `${PREFIX}-admin-a@example.com` } })
    expect(admin).toMatchObject({ role: 'ADMIN', mustChangePassword: true, hotelId: null })
    const hotel = await prisma.hotel.findUniqueOrThrow({ where: { id: hotelId } })
    expect(hotel).toMatchObject({ tenantId: admin.tenantId, totalRooms: 120, hotelType: 'LIMITED_SERVICE', saleOpenDaysBefore: 330 })
    expect(iso(hotel.openedOn!)).toBe(iso(addUtcDays(today, -40)))
    // 監査ログに一時パスワードを残さない
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entity: 'TenantProvision', tenantId: admin.tenantId! } })
    expect(JSON.stringify(log.newValue)).not.toContain('temporaryPassword')

    // 以降の確認用に、同じテナントにパスワードの分かっている管理者を作る
    await prisma.user.create({
      data: {
        email: `${PREFIX}-admin2@example.com`,
        password: await bcrypt.hash(PASSWORD, 10),
        name: 'a2',
        role: 'ADMIN',
        tenantId: admin.tenantId,
      },
    })
    const login = await request(app).post('/api/v1/auth/login').send({ email: `${PREFIX}-admin2@example.com`, password: PASSWORD })
    expect(login.status).toBe(200)
    tokens.newAdmin = login.body.data.tokens.accessToken
  })

  it('コードやメールが使われていれば 409 で、何も作らない', async () => {
    const dupCode = await provision('platform', body('b', { tenant: { name: 'x', code: `${PREFIX}-new-a` } }))
    expect(dupCode.status).toBe(409)
    const dupEmail = await provision('platform', body('c', { admin: { email: `${PREFIX}-admin-a@example.com`, name: 'x' } }))
    expect(dupEmail.status).toBe(409)
    expect(dupEmail.body.error).not.toContain('他')
    expect(await prisma.tenant.count({ where: { code: { in: [`${PREFIX}-new-b`, `${PREFIX}-new-c`] } } })).toBe(0)
    // 市区町村と都道府県の食い違いは 400
    const bad = await provision('platform', body('d', { hotel: { name: 'h', totalRooms: 10, prefectureCode: '13', municipalityCode: '271004' } }))
    expect(bad.status).toBe(400)
  })

  it('開業1年未満のホテルは、実績の基準を開業からの日数に合わせる', async () => {
    // 開業40日 × 0.8 = 32日分の実績が要る。30日分だけ入れる
    const { tenantId } = await hotelTenant()
    await prisma.dailyData.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        tenantId,
        hotelId,
        date: addUtcDays(today, -(i + 1)),
        occupancy: 0.7,
        soldRooms: 84,
        totalRevenue: 840_000,
      })),
    })
    const res = await request(app).get(`/api/v1/hotels/${hotelId}/setup-status`).set('Authorization', `Bearer ${tokens.newAdmin}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const actuals = res.body.data.items.find((i: { key: string }) => i.key === 'actuals')
    expect(actuals).toMatchObject({ label: '過去実績（開業から）', done: false })
    expect(actuals.detail).toContain('32 日分以上必要')
    expect(res.body.data.items.map((i: { key: string }) => i.key)).toEqual(
      expect.arrayContaining(['strategy', 'saleOpen', 'otb'])
    )
    expect(res.body.data.items.find((i: { key: string }) => i.key === 'saleOpen').done).toBe(true)
  })

  it('予測の準備状況: 実績が少ないうちは learning で、ピックアップ型や外部要因がまだ働いていないことを返す', async () => {
    const res = await request(app).get(`/api/v1/hotels/${hotelId}/forecast-readiness`).set('Authorization', `Bearer ${tokens.newAdmin}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.data).toMatchObject({ mode: 'learning', historyDays: 30 })
    const caps = Object.fromEntries(res.body.data.capabilities.map((c: { key: string; status: string }) => [c.key, c.status]))
    expect(caps).toMatchObject({ baseline: 'limited', similarDays: 'limited', paceClusters: 'inactive', externalAgent: 'inactive' })
    // 他テナントの管理者は見られない
    const other = await request(app).get(`/api/v1/hotels/${hotelId}/forecast-readiness`).set('Authorization', `Bearer ${tokens.tenantadmin}`)
    expect(other.status).toBe(403)
  })

  it('実績の無いホテルの予測は、ホテルタイプの典型と今の予約から作る（推奨理由に coldStart）', async () => {
    await prisma.dailyData.deleteMany({ where: { hotelId } })
    const stay = addUtcDays(today, 14)
    const { tenantId } = await hotelTenant()
    await prisma.bookingCurveData.create({
      data: { tenantId, hotelId, stayDate: stay, daysBefore: 14, roomsBooked: 60, capturedAt: new Date() },
    })
    const res = await request(app)
      .post('/api/v1/pricing/recompute')
      .set('Authorization', `Bearer ${tokens.newAdmin}`)
      .send({ hotelId, startDate: iso(today), endDate: iso(addUtcDays(today, 20)) })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const rec = await prisma.aiPriceRecommendation.findFirstOrThrow({ where: { hotelId, date: stay, roomTypeId: null } })
    const cold = (rec.rationale as { adjustments: Array<{ key: string; input?: Record<string, unknown> }> }).adjustments.find((a) => a.key === 'coldStart')
    expect(cold?.input?.method).toBe('extrapolated')
    // 宿泊特化の残14日の典型の割合 0.65 → 60 ÷ 0.65 ÷ 120 ≈ 77%。典型 78% と混ぜる
    expect(rec.predictedOccupancy).toBeGreaterThan(0.7)
    const readiness = await request(app).get(`/api/v1/hotels/${hotelId}/forecast-readiness`).set('Authorization', `Bearer ${tokens.newAdmin}`)
    expect(readiness.body.data.mode).toBe('coldStart')
  })

  it('過去の予約積上をまとめて取り込める（残日数か取得日。取得時点は宿泊日 − 残日数）', async () => {
    const post = (payload: object) =>
      request(app).post('/api/v1/imports/booking-curve').set('Authorization', `Bearer ${tokens.newAdmin}`).send({ hotelId, ...payload })
    const stay = iso(addUtcDays(today, -200))
    const bad = await post({
      rows: [
        { stayDate: stay, daysBefore: 30, roomsBooked: 40 },
        { stayDate: stay, capturedDate: iso(addUtcDays(today, -230)), roomsBooked: 41 }, // 同じ残日数30 → 重複
        { stayDate: stay, capturedDate: iso(addUtcDays(today, -100)), roomsBooked: 10 }, // 宿泊日より後
        { stayDate: stay, roomsBooked: 10 }, // 残日数も取得日も無い
        { stayDate: stay, daysBefore: 1, roomsBooked: 999 }, // 客室数を超える
      ],
    })
    expect(bad.status).toBe(400)
    expect(bad.body.errors.map((e: { field: string }) => e.field)).toEqual([
      'rows.1.stayDate',
      'rows.2.capturedDate',
      'rows.3.daysBefore',
      'rows.4.roomsBooked',
    ])

    const rows = [
      { stayDate: stay, daysBefore: 90, roomsBooked: 20 },
      { stayDate: stay, capturedDate: iso(addUtcDays(today, -230)), roomsBooked: 60 },
      { stayDate: stay, daysBefore: 0, roomsBooked: 100 },
    ]
    const dry = await post({ rows, dryRun: true })
    expect(dry.body.data).toMatchObject({ dryRun: true, total: 3, created: 3 })
    expect(await prisma.bookingCurveData.count({ where: { hotelId, stayDate: addUtcDays(today, -200) } })).toBe(0)
    const ok = await post({ rows })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    const saved = await prisma.bookingCurveData.findMany({ where: { hotelId, stayDate: addUtcDays(today, -200) }, orderBy: { daysBefore: 'desc' } })
    expect(saved.map((r) => [r.daysBefore, r.roomsBooked])).toEqual([
      [90, 20],
      [30, 60],
      [0, 100],
    ])
    expect(iso(saved[1].capturedAt)).toBe(iso(addUtcDays(today, -230)))
    expect(await prisma.auditLog.count({ where: { entity: 'BookingCurveData', entityId: hotelId } })).toBe(1)
  })

  it('予約明細から過去の予約の推移を作って取り込む（D-13 の推奨の方法）', async () => {
    const post = (payload: object) =>
      request(app).post('/api/v1/imports/reservations').set('Authorization', `Bearer ${tokens.newAdmin}`).send({ hotelId, ...payload })
    const stay = addUtcDays(today, -100)
    const rows = [
      { bookedDate: iso(addUtcDays(stay, -60)), checkInDate: iso(stay), nights: 2, rooms: 3 },
      { bookedDate: iso(addUtcDays(stay, -10)), checkInDate: iso(stay), nights: 1, rooms: 2, cancelledDate: iso(addUtcDays(stay, -2)) },
    ]
    const bad = await post({ stayFrom: iso(stay), stayTo: iso(stay), rows: [{ ...rows[0], bookedDate: iso(addUtcDays(stay, 1)) }] })
    expect(bad.status).toBe(400)
    expect(bad.body.errors[0].field).toBe('rows.0.bookedDate')
    const tooLong = await post({ stayFrom: iso(stay), stayTo: iso(addUtcDays(stay, 70)), rows })
    expect(tooLong.status).toBe(400)

    const ok = await post({ stayFrom: iso(stay), stayTo: iso(addUtcDays(stay, 1)), rows })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.data.reservations).toBe(2)
    const point = (d: Date, lead: number) =>
      prisma.bookingCurveData.findUnique({ where: { hotelId_stayDate_daysBefore: { hotelId, stayDate: d, daysBefore: lead } } })
    expect((await point(stay, 30))?.roomsBooked).toBe(3)
    expect((await point(stay, 7))?.roomsBooked).toBe(5) // 取消前
    expect((await point(stay, 0))?.roomsBooked).toBe(3) // 2日前に取消
    expect((await point(addUtcDays(stay, 1), 0))?.roomsBooked).toBe(3) // 連泊の2泊目

    // 明細も保存し、同じ範囲を取り込み直すと入れ替わる（二重にならない）
    expect(await prisma.reservation.count({ where: { hotelId } })).toBe(2)
    expect((await post({ stayFrom: iso(stay), stayTo: iso(addUtcDays(stay, 1)), rows: [{ ...rows[0], guests: 6, revenue: 120_000 }] })).status).toBe(200)
    expect(await prisma.reservation.count({ where: { hotelId } })).toBe(1)

    // 予約動向・利用人数別の集計
    const y = stay.getUTCFullYear()
    const m = stay.getUTCMonth() + 1
    const windows = await request(app).get(`/api/v1/analysis/booking-windows?hotelId=${hotelId}&year=${y}&month=${m}`).set('Authorization', `Bearer ${tokens.newAdmin}`)
    expect(windows.status, JSON.stringify(windows.body)).toBe(200)
    expect(windows.body.data.reservations).toBe(1)
    const sixty = windows.body.data.bookings.find((b: { window: string }) => b.window === '31-60日前')
    expect(sixty.soldRooms).toBeGreaterThan(0)
    const guests = await request(app).get(`/api/v1/analysis/guest-counts?hotelId=${hotelId}&year=${y}&month=${m}`).set('Authorization', `Bearer ${tokens.newAdmin}`)
    expect(guests.body.data.segments.find((s: { name: string }) => s.name === '2名').soldRooms).toBeGreaterThan(0)
    const other = await request(app).get(`/api/v1/analysis/guest-counts?hotelId=${hotelId}&year=${y}&month=${m}`).set('Authorization', `Bearer ${tokens.tenantadmin}`)
    expect(other.status).toBe(403)

    // ブッキングカーブの系列: 宿泊日のカーブに ADR の推移と利用人数別の内訳、月単位の積み上がり
    const stayCurve = await request(app).get(`/api/v1/daily/booking-curve?hotelId=${hotelId}&date=${iso(stay)}`).set('Authorization', `Bearer ${tokens.newAdmin}`)
    expect(stayCurve.status, JSON.stringify(stayCurve.body)).toBe(200)
    expect(stayCurve.body.data.adrHistory.at(-1)).toEqual({ daysBefore: 0, adr: 20_000 }) // 12万円 ÷ 2泊 ÷ 3室
    expect(stayCurve.body.data.breakdowns.guests).toEqual([
      expect.objectContaining({ label: '2名利用', points: expect.arrayContaining([{ daysBefore: 0, roomsBooked: 3, adr: 20_000 }]) }),
    ])
    const monthCurve = await request(app).get(`/api/v1/analysis/month-curve?hotelId=${hotelId}&year=${y}&month=${m}`).set('Authorization', `Bearer ${tokens.newAdmin}`)
    expect(monthCurve.status).toBe(200)
    expect(monthCurve.body.data.points.at(-1)).toMatchObject({ monthsBefore: 0 })
    expect(monthCurve.body.data.reservations).toBe(1)
    const otherCurve = await request(app).get(`/api/v1/analysis/month-curve?hotelId=${hotelId}&year=${y}&month=${m}`).set('Authorization', `Bearer ${tokens.tenantadmin}`)
    expect(otherCurve.status).toBe(403)
  })

  async function hotelTenant() {
    return prisma.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { tenantId: true } })
  }
})
