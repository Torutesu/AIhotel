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

  async function setWeights(weightOccupancy: number, weightAdr: number, weightCompetitor: number) {
    const res = await request(app)
      .put('/api/v1/pricing/strategy')
      .set('Authorization', `Bearer ${token}`)
      .send({ hotelId: HOTEL, weightOccupancy, weightAdr, weightCompetitor })
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
      expect(row.modelVersion).toBe('rule-based-v2')
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
})
