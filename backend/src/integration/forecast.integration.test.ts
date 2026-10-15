import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { addUtcDays, todayJst } from '../lib/date.js'

// 需要予測・推奨価格の統合テスト（#76 / #77 / #90）。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス ftest）で検証する。
//
// 観点ごとに推奨ランクが大きく離れるようにデータを置く:
// - 料金ランク 1〜10（1名料金 = ランク × 5,000円）
// - 過去28日の実績: 稼働率 0.5（→ 稼働率観点はおおむねランク5）、ADR 47,000円（→ 最も近い 45,000円のランク9。1名料金と一致させないため端数をずらす）
// - 対象期間の競合価格: 10,000円（→ 競合観点はランク2）

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'ftest'
const TENANT = `${PREFIX}-tenant`
const HOTEL = `${PREFIX}-hotel`
const PASSWORD = 'Test1234'
const MANAGER_EMAIL = `${PREFIX}-manager@example.com`
const FORECAST_DAYS = 7
const NO_GUARDRAILS = { maxDailyRankChange: null, hysteresisRanks: 0, minRank: null, maxRank: null, competitorOffsetPct: 0 }

describeIntegration('需要予測と推奨価格（#76 / #77 / #90）', () => {
  let app: Express
  let prisma: PrismaClient
  let token = ''
  const today = todayJst()
  const endDate = addUtcDays(today, FORECAST_DAYS - 1)

  async function cleanup() {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: PREFIX } },
      select: { id: true },
    })
    await prisma.auditLog.deleteMany({
      where: { OR: [{ tenantId: TENANT }, { userId: { in: users.map((u) => u.id) } }] },
    })
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
    await prisma.tenant.deleteMany({ where: { id: TENANT } })
  }

  async function setWeights(
    weightOccupancy: number,
    weightAdr: number,
    weightCompetitor: number,
    extra: Record<string, unknown> = {}
  ) {
    const res = await request(app)
      .put('/api/v1/pricing/strategy')
      .set('Authorization', `Bearer ${token}`)
      // 重みの効き方だけを見るため、前回推奨からの変動幅・ヒステリシス（#17）は切る
      .send({ hotelId: HOTEL, weightOccupancy, weightAdr, weightCompetitor, ...NO_GUARDRAILS, ...extra })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
  }

  async function recomputeAndReadRanks(): Promise<number[]> {
    const res = await request(app)
      .post('/api/v1/pricing/recompute')
      .set('Authorization', `Bearer ${token}`)
      .send({
        hotelId: HOTEL,
        startDate: today.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
      })
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    const rows = await prisma.aiPriceRecommendation.findMany({
      where: { hotelId: HOTEL, roomTypeId: null },
      orderBy: { date: 'asc' },
    })
    expect(rows).toHaveLength(FORECAST_DAYS)
    return rows.map((r) => r.recommendedRank as number)
  }

  beforeAll(async () => {
    const appModule = await import('../app.js')
    app = appModule.app as unknown as Express
    prisma = new PrismaClient()

    await cleanup()

    await prisma.tenant.create({ data: { id: TENANT, code: TENANT, name: '予測テストテナント' } })
    await prisma.hotel.create({
      data: { id: HOTEL, tenantId: TENANT, name: '予測テストホテル', totalRooms: 100 },
    })
    await prisma.user.create({
      data: {
        email: MANAGER_EMAIL,
        password: await bcrypt.hash(PASSWORD, 10),
        name: '予測テストマネージャー',
        role: 'MANAGER',
        tenantId: TENANT,
        hotelId: HOTEL,
      },
    })

    await prisma.priceRank.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        tenantId: TENANT,
        hotelId: HOTEL,
        rank: i + 1,
        label: `R${String(i + 1).padStart(2, '0')}`,
        price1P: (i + 1) * 5_000,
        price2P: (i + 1) * 9_000,
      })),
    })

    await prisma.dailyData.createMany({
      data: Array.from({ length: 28 }, (_, i) => ({
        tenantId: TENANT,
        hotelId: HOTEL,
        date: addUtcDays(today, -(i + 1)),
        occupancy: 0.5,
        adr: 47_000,
        soldRooms: 50,
        totalRevenue: 50 * 47_000,
      })),
    })

    const active = await prisma.competitor.create({
      data: { tenantId: TENANT, hotelId: HOTEL, name: '有効な競合' },
    })
    await prisma.competitorPriceData.createMany({
      data: Array.from({ length: FORECAST_DAYS }, (_, i) => ({
        tenantId: TENANT,
        competitorId: active.id,
        date: addUtcDays(today, i),
        price1P: 10_000,
        dataSource: 'manual',
      })),
    })

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: MANAGER_EMAIL, password: PASSWORD })
    expect(res.status).toBe(200)
    token = res.body.data.tokens.accessToken
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  describe('価格戦略の重み（#76）', () => {
    it('まだ保存していないホテルは 404 ではなく既定値（稼働率100%）を返す', async () => {
      const res = await request(app)
        .get('/api/v1/pricing/strategy')
        .query({ hotelId: HOTEL })
        .set('Authorization', `Bearer ${token}`)
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.data).toMatchObject({ id: null, weightOccupancy: 100, weightAdr: 0, weightCompetitor: 0 })
    })

    it('重みを変えると推奨ランクが変わる', async () => {
      await setWeights(100, 0, 0)
      const byOccupancy = await recomputeAndReadRanks()

      await setWeights(0, 100, 0)
      const byAdr = await recomputeAndReadRanks()

      await setWeights(0, 0, 100)
      const byCompetitor = await recomputeAndReadRanks()

      // ADR観点はすべての日でランク9、競合観点はランク2
      expect(byAdr.every((r) => r === 9)).toBe(true)
      expect(byCompetitor.every((r) => r === 2)).toBe(true)
      // 稼働率観点はそのどちらとも異なる
      expect(byOccupancy.every((r) => r !== 9 && r !== 2)).toBe(true)
    })

    it('競合価格が無い日は競合の重みを残りの観点へ按分する（ランクが下がらない）', async () => {
      await prisma.competitorPriceData.deleteMany({ where: { tenantId: TENANT } })
      try {
        await setWeights(0, 50, 50)
        const ranks = await recomputeAndReadRanks()
        expect(ranks.every((r) => r === 9)).toBe(true)
      } finally {
        const competitor = await prisma.competitor.findFirstOrThrow({
          where: { hotelId: HOTEL, isActive: true },
        })
        await prisma.competitorPriceData.createMany({
          data: Array.from({ length: FORECAST_DAYS }, (_, i) => ({
            tenantId: TENANT,
            competitorId: competitor.id,
            date: addUtcDays(today, i),
            price1P: 10_000,
            dataSource: 'manual',
          })),
        })
      }
    })

    it('推奨行に新しいモデルバージョンが記録される', async () => {
      await setWeights(60, 20, 20)
      await recomputeAndReadRanks()
      const row = await prisma.aiPriceRecommendation.findFirstOrThrow({ where: { hotelId: HOTEL } })
      expect(row.modelVersion).toBe('rule-based-v4')
    })
  })

  describe('推奨ランクの調整とガードレール（#17）', () => {
    it('設定を保存すると監査ログに残り、GET で返る', async () => {
      await setWeights(0, 0, 100, { competitorOffsetPct: 10, minRank: 2, maxRank: 8, maxDailyRankChange: 2, hysteresisRanks: 1 })
      const res = await request(app)
        .get('/api/v1/pricing/strategy')
        .query({ hotelId: HOTEL })
        .set('Authorization', `Bearer ${token}`)
      expect(res.body.data).toMatchObject({ competitorOffsetPct: 10, minRank: 2, maxRank: 8, maxDailyRankChange: 2 })
      const log = await prisma.auditLog.findFirst({
        where: { tenantId: TENANT, entity: 'PricingStrategyConfig' },
        orderBy: { createdAt: 'desc' },
      })
      expect(log).not.toBeNull()
    })

    it('重みを送らずに調整だけを保存でき、重みは変わらない。重みを一部だけ送ると 400', async () => {
      await setWeights(20, 30, 50)
      const res = await request(app)
        .put('/api/v1/pricing/strategy')
        .set('Authorization', `Bearer ${token}`)
        .send({ hotelId: HOTEL, hysteresisRanks: 2 })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.data).toMatchObject({ weightOccupancy: 20, weightAdr: 30, weightCompetitor: 50, hysteresisRanks: 2 })

      const partial = await request(app)
        .put('/api/v1/pricing/strategy')
        .set('Authorization', `Bearer ${token}`)
        .send({ hotelId: HOTEL, weightOccupancy: 100 })
      expect(partial.status).toBe(400)
    })

    it('下限が上限より大きければ 400', async () => {
      const res = await request(app)
        .put('/api/v1/pricing/strategy')
        .set('Authorization', `Bearer ${token}`)
        .send({ hotelId: HOTEL, weightOccupancy: 100, weightAdr: 0, weightCompetitor: 0, minRank: 9, maxRank: 3 })
      expect(res.status).toBe(400)
    })

    it('下限を設定すると、それより下のランクは推奨しない', async () => {
      // 競合観点だけならランク2。下限4で4に引き上げる
      await setWeights(0, 0, 100, { minRank: 4 })
      const ranks = await recomputeAndReadRanks()
      expect(ranks.every((r) => r === 4)).toBe(true)
    })

    it('相対ポジション +30% で、競合の中央値（10,000円）の1.3倍に近いランクを狙う', async () => {
      await setWeights(0, 0, 100, { competitorOffsetPct: 30 })
      const ranks = await recomputeAndReadRanks()
      // 13,000円に最も近いのは 15,000円のランク3（10,000円のランク2 より近い）
      expect(ranks.every((r) => r === 3)).toBe(true)
    })

    it('前回の推奨から動かせるのは1回あたり maxDailyRankChange まで', async () => {
      await setWeights(0, 0, 100) // 前回 = ランク2
      await recomputeAndReadRanks()
      await setWeights(0, 100, 0, { maxDailyRankChange: 3 }) // ADR観点ならランク9
      const ranks = await recomputeAndReadRanks()
      expect(ranks.every((r) => r === 5)).toBe(true)
    })

    it('取得から48時間を超えた競合価格は使わず、推奨理由に stale と残す', async () => {
      await prisma.competitorPriceData.updateMany({
        where: { tenantId: TENANT },
        data: { observedAt: addUtcDays(new Date(), -3) },
      })
      try {
        await setWeights(0, 50, 50)
        const ranks = await recomputeAndReadRanks()
        // 競合観点が外れて ADR 観点（ランク9）だけになる
        expect(ranks.every((r) => r === 9)).toBe(true)
        const row = await prisma.aiPriceRecommendation.findFirstOrThrow({ where: { hotelId: HOTEL } })
        const rationale = row.rationale as { version: number; excluded: Array<{ key: string; reason: string }> }
        expect(rationale.version).toBe(1)
        expect(rationale.excluded).toContainEqual({ key: 'competitor', reason: 'stale' })
      } finally {
        await prisma.competitorPriceData.updateMany({ where: { tenantId: TENANT }, data: { observedAt: null } })
      }
    })

    it('固定期間の日は再計算しても前回の推奨を残す。登録・削除は監査ログに残る', async () => {
      await setWeights(0, 0, 100)
      const before = await recomputeAndReadRanks() // すべてランク2

      const iso = (d: Date) => d.toISOString().slice(0, 10)
      const created = await request(app)
        .post('/api/v1/pricing/locks')
        .set('Authorization', `Bearer ${token}`)
        .send({ hotelId: HOTEL, startDate: iso(today), endDate: iso(addUtcDays(today, 1)), reason: '団体' })
      expect(created.status, JSON.stringify(created.body)).toBe(201)

      await setWeights(0, 100, 0)
      const after = await recomputeAndReadRanks()
      expect(after.slice(0, 2)).toEqual(before.slice(0, 2))
      expect(after.slice(2).every((r) => r === 9)).toBe(true)

      const list = await request(app).get('/api/v1/pricing/locks').query({ hotelId: HOTEL }).set('Authorization', `Bearer ${token}`)
      expect(list.body.data).toHaveLength(1)

      const removed = await request(app)
        .delete(`/api/v1/pricing/locks/${created.body.data.id}`)
        .query({ hotelId: HOTEL })
        .set('Authorization', `Bearer ${token}`)
      expect(removed.status).toBe(200)
      const actions = await prisma.auditLog.findMany({ where: { tenantId: TENANT, entity: 'PricingLockPeriod' } })
      expect(actions.map((a) => a.action).sort()).toEqual(['CREATE', 'DELETE'])
    })
  })

  describe('予測ADR（#77）', () => {
    it('再計算後も predictedAdr が入っている（実績ADRを推奨ランクへの価格変化率で補正）', async () => {
      await setWeights(0, 100, 0)
      await recomputeAndReadRanks()
      const rows = await prisma.aiPriceRecommendation.findMany({ where: { hotelId: HOTEL } })
      // 推奨ランク9 = 実績ADRに見合うランクなので、実績ADRがそのまま予測ADRになる
      expect(rows.every((r) => r.predictedAdr === 47_000)).toBe(true)

      await setWeights(0, 0, 100)
      await recomputeAndReadRanks()
      const lowered = await prisma.aiPriceRecommendation.findMany({ where: { hotelId: HOTEL } })
      // 推奨ランク2（10,000円）は基準ランク9（45,000円）の 2/9 倍
      expect(lowered.every((r) => r.predictedAdr === Math.round((47_000 * 10_000) / 45_000))).toBe(true)
    })

    it('着地シミュレーションは1名料金ではなく予測ADRで積み上がる', async () => {
      await setWeights(0, 100, 0)
      await recomputeAndReadRanks()

      const year = today.getUTCFullYear()
      const month = today.getUTCMonth() + 1
      const res = await request(app)
        .post('/api/v1/pricing/simulation/recompute')
        .set('Authorization', `Bearer ${token}`)
        .send({ hotelId: HOTEL, year, month })
      expect(res.status, JSON.stringify(res.body)).toBe(200)

      // 実績・予測ともに ADR は 47,000円なので着地ADRも 47,000円になる。
      // predictedAdr が無かった従来は予測日が1名料金（ランク9 = 45,000円）で積まれ、着地ADRが下がっていた
      expect(res.body.data.simulation.projectedAdr).toBe(47_000)
    })
  })

  describe('削除済み競合の除外（#90）', () => {
    it('論理削除した競合の価格は価格カレンダーの代表値に含まれない', async () => {
      await setWeights(100, 0, 0)
      await recomputeAndReadRanks()

      const deleted = await prisma.competitor.create({
        data: { tenantId: TENANT, hotelId: HOTEL, name: '削除済みの競合', isActive: false },
      })
      await prisma.competitorPriceData.create({
        data: {
          tenantId: TENANT,
          competitorId: deleted.id,
          date: today,
          price1P: 90_000,
          dataSource: 'manual',
        },
      })

      const res = await request(app)
        .get('/api/v1/pricing/calendar')
        .query({ hotelId: HOTEL, year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 })
        .set('Authorization', `Bearer ${token}`)
      expect(res.status, JSON.stringify(res.body)).toBe(200)

      const day = res.body.data.calendar.find(
        (d: { date: string }) => d.date === today.toISOString().slice(0, 10)
      )
      expect(day).toBeDefined()
      expect(day.competitorMaxPrice).toBe(10_000)
      expect(day.competitorMedianPrice).toBe(10_000)
    })
  })

  describe('IDeaS の運用を参考にした調整（D-11）', () => {
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const auth = () => ({ Authorization: `Bearer ${token}` })
    const readRationales = async () =>
      (
        await prisma.aiPriceRecommendation.findMany({ where: { hotelId: HOTEL, roomTypeId: null }, orderBy: { date: 'asc' } })
      ).map(
        (r) =>
          r.rationale as {
            guardrails: Array<{ key: string; from: number; to: number }>
            adjustments: Array<{ key: string; impact: number; input?: Record<string, unknown> }>
          }
      )

    it('期間・曜日ごとの価格の幅で推奨を止め、推奨理由に残る。登録・削除は監査ログに残る', async () => {
      await setWeights(0, 0, 100) // 競合観点だけならすべてランク2
      const everyDay = await request(app)
        .post('/api/v1/pricing/bounds')
        .set(auth())
        .send({ hotelId: HOTEL, startDate: iso(today), endDate: iso(endDate), minRank: 4, reason: '繁忙期の下限' })
      expect(everyDay.status, JSON.stringify(everyDay.body)).toBe(201)
      // 今日と同じ曜日だけ R6 に固定（後から登録したほうが優先）
      const oneWeekday = await request(app)
        .post('/api/v1/pricing/bounds')
        .set(auth())
        .send({ hotelId: HOTEL, startDate: iso(today), endDate: iso(endDate), weekdays: [today.getUTCDay()], minRank: 6, maxRank: 6 })
      expect(oneWeekday.status, JSON.stringify(oneWeekday.body)).toBe(201)

      const ranks = await recomputeAndReadRanks()
      expect(ranks[0]).toBe(6)
      expect(ranks.slice(1).every((r) => r === 4)).toBe(true)
      const rationales = await readRationales()
      expect(rationales[1].guardrails).toContainEqual({ key: 'periodMinRank', from: 2, to: 4 })

      const list = await request(app).get('/api/v1/pricing/bounds').query({ hotelId: HOTEL }).set(auth())
      expect(list.body.data).toHaveLength(2)

      for (const created of [everyDay, oneWeekday]) {
        const removed = await request(app)
          .delete(`/api/v1/pricing/bounds/${created.body.data.id}`)
          .query({ hotelId: HOTEL })
          .set(auth())
        expect(removed.status).toBe(200)
      }
      const actions = await prisma.auditLog.findMany({ where: { tenantId: TENANT, entity: 'PriceBoundPeriod' } })
      expect(actions.map((a) => a.action).sort()).toEqual(['CREATE', 'CREATE', 'DELETE', 'DELETE'])
      expect((await recomputeAndReadRanks()).every((r) => r === 2)).toBe(true)
    })

    it('下限も上限も無い・下限が上限より大きい価格の幅は 400', async () => {
      for (const body of [{}, { minRank: 8, maxRank: 3 }, { minRank: 2, weekdays: [1, 1] }]) {
        const res = await request(app)
          .post('/api/v1/pricing/bounds')
          .set(auth())
          .send({ hotelId: HOTEL, startDate: iso(today), endDate: iso(endDate), ...body })
        expect(res.status, JSON.stringify(body)).toBe(400)
      }
    })

    it('特殊日に登録した期間の実績は、同曜日平均の基準に使わない', async () => {
      await setWeights(100, 0, 0)
      const lastWeek = { gte: addUtcDays(today, -7), lte: addUtcDays(today, -1) }
      // 直近1週間だけ満室（台風明けの特需などを想定）
      await prisma.dailyData.updateMany({ where: { hotelId: HOTEL, date: lastWeek }, data: { occupancy: 1 } })
      try {
        const withSpike = await recomputeAndReadRanks()
        const created = await request(app)
          .post('/api/v1/events')
          .set(auth())
          .send({
            hotelId: HOTEL,
            name: '台風の影響',
            type: 'weather',
            startDate: iso(addUtcDays(today, -7)),
            endDate: iso(addUtcDays(today, -1)),
            excludeFromHistory: true,
          })
        expect(created.status, JSON.stringify(created.body)).toBe(201)
        const excluded = await recomputeAndReadRanks()
        // 満室の週を外すと同曜日平均が 0.625 → 0.5 に戻り、推奨が下がる
        excluded.forEach((rank, i) => expect(rank).toBeLessThan(withSpike[i]))
      } finally {
        await prisma.dailyData.updateMany({ where: { hotelId: HOTEL, date: lastWeek }, data: { occupancy: 0.5 } })
        await prisma.event.deleteMany({ where: { hotelId: HOTEL } })
      }
    })

    it('前年同曜日より予約が速い日は予測を引き上げ、予約済みの室数を下限にする', async () => {
      await setWeights(100, 0, 0)
      const baseline = await recomputeAndReadRanks()
      const target = addUtcDays(today, 3)
      const lastYear = addUtcDays(target, -364)
      const floorTarget = addUtcDays(today, 5)
      await prisma.bookingCurveData.createMany({
        data: [
          // 今年: 残3日で30室。前年同曜日: 残3日で20室、最終90室 → ペース比1.5
          { tenantId: TENANT, hotelId: HOTEL, stayDate: target, daysBefore: 3, roomsBooked: 30 },
          { tenantId: TENANT, hotelId: HOTEL, stayDate: lastYear, daysBefore: 3, roomsBooked: 20 },
          // 前年と比べられなくても、残5日で96室入っていればそれが下限
          { tenantId: TENANT, hotelId: HOTEL, stayDate: floorTarget, daysBefore: 5, roomsBooked: 96 },
        ],
      })
      // 前年の最終販売室数（稼働率は入れない＝前年比較の稼働率には使わせない）
      await prisma.dailyData.create({ data: { tenantId: TENANT, hotelId: HOTEL, date: lastYear, soldRooms: 90 } })
      try {
        const ranks = await recomputeAndReadRanks()
        expect(ranks[3]).toBeGreaterThan(baseline[3])
        expect(ranks[5]).toBe(10)
        const rationales = await readRationales()
        expect(rationales[3].adjustments.find((a) => a.key === 'pace')?.input).toMatchObject({ ratio: 1.5, leadDays: 3 })
        expect(rationales[5].adjustments.map((a) => a.key)).toContain('otbFloor')
      } finally {
        await prisma.bookingCurveData.deleteMany({ where: { hotelId: HOTEL } })
        await prisma.dailyData.deleteMany({ where: { hotelId: HOTEL, date: lastYear } })
      }
    })

    it('販売開始チェック: 前年同曜日のADRを割る日を数え、前年の特殊日は比べない', async () => {
      await setWeights(0, 100, 0) // 予測ADRは 47,000円前後
      const year = today.getUTCMonth() === 11 ? today.getUTCFullYear() + 1 : today.getUTCFullYear()
      const month = ((today.getUTCMonth() + 1) % 12) + 1 // 来月
      const first = new Date(Date.UTC(year, month - 1, 1))
      const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
      const lastYearDates = Array.from({ length: days }, (_, i) => addUtcDays(addUtcDays(first, i), -364))
      // 前年同曜日の実績 ADR を高く置く（推奨は前年割れになる）。1日目の前年同曜日は特殊日にする
      await prisma.dailyData.createMany({
        data: lastYearDates.map((date) => ({ tenantId: TENANT, hotelId: HOTEL, date, adr: 100_000, soldRooms: 50, totalRevenue: 5_000_000 })),
        skipDuplicates: true,
      })
      await prisma.event.create({
        data: { tenantId: TENANT, hotelId: HOTEL, name: '前年の年末年始', type: 'holiday', startDate: lastYearDates[0], endDate: lastYearDates[0], excludeFromHistory: true },
      })
      try {
        const res = await request(app)
          .get('/api/v1/pricing/sale-open-check')
          .query({ hotelId: HOTEL, year, month })
          .set(auth())
        expect(res.status, JSON.stringify(res.body)).toBe(200)
        const { days: rows, summary } = res.body.data
        expect(rows).toHaveLength(days)
        expect(rows[0].status).toBe('no_comparison')
        expect(rows.slice(1).every((d: { status: string }) => d.status === 'below_last_year')).toBe(true)
        expect(summary).toMatchObject({ belowLastYearDays: days - 1, comparableDays: days - 1, verdict: 'review' })

        // 推奨は保存しない（料金カレンダーは変わらない）
        const saved = await prisma.aiPriceRecommendation.count({ where: { hotelId: HOTEL, date: { gte: first } } })
        expect(saved).toBe(0)

        const past = await request(app)
          .get('/api/v1/pricing/sale-open-check')
          .query({ hotelId: HOTEL, year: today.getUTCFullYear() - 1, month: 1 })
          .set(auth())
        expect(past.status).toBe(400)
      } finally {
        await prisma.dailyData.deleteMany({ where: { hotelId: HOTEL, date: { in: lastYearDates } } })
        await prisma.event.deleteMany({ where: { hotelId: HOTEL } })
      }
    })
  })
})
