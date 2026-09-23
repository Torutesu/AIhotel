import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { addUtcDays, todayJst } from '../lib/date.js'
import type { CompetitorRateSource } from '../services/competitorRates/types.js'

// 競合価格の定期取得（#9 段階B）の統合テスト。実際のサイトには繋がず、テスト用の取得元を差し込む。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス cftest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'cftest'
const TENANT = `${PREFIX}-tenant`
const HOTEL = `${PREFIX}-hotel`

describeIntegration('競合価格の定期取得（#9 段階B）', () => {
  let prisma: PrismaClient
  let fetchCompetitorRatesForHotel: typeof import('../services/competitorRates/fetchService.js').fetchCompetitorRatesForHotel
  let runCompetitorPricesJob: typeof import('../services/competitorRates/job.js').runCompetitorPricesJob
  const today = todayJst()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  let competitorA = ''

  const rakuten: CompetitorRateSource = {
    key: 'rakuten',
    fetch: async (_target, dates) => [
      { stayDate: dates[0], price1P: 12000, price2P: 20000, price3P: null, soldOut: false },
      { stayDate: dates[1], price1P: 99999, price2P: null, price3P: null, soldOut: true }, // 満室なら料金は捨てる
    ],
  }
  const brokenJalan: CompetitorRateSource = {
    key: 'jalan',
    fetch: async () => {
      throw new Error('ページの構造が変わりました')
    },
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    ;({ fetchCompetitorRatesForHotel } = await import('../services/competitorRates/fetchService.js'))
    ;({ runCompetitorPricesJob } = await import('../services/competitorRates/job.js'))
    await prisma.tenant.deleteMany({ where: { id: TENANT } })
    await prisma.tenant.create({ data: { id: TENANT, code: TENANT, name: TENANT } })
    await prisma.hotel.create({ data: { id: HOTEL, tenantId: TENANT, name: HOTEL, totalRooms: 10 } })
    const a = await prisma.competitor.create({
      data: {
        tenantId: TENANT,
        hotelId: HOTEL,
        name: '競合A',
        otaUrls: { rakuten: 'https://example.com/a', jalan: 'https://example.com/a-j' },
      },
    })
    competitorA = a.id
    // URL が無い競合は取得しない
    await prisma.competitor.create({ data: { tenantId: TENANT, hotelId: HOTEL, name: '競合B', otaUrls: {} } })
  })

  afterAll(async () => {
    if (!prisma) return
    await prisma.tenant.deleteMany({ where: { id: TENANT } })
    await prisma.$disconnect()
  })

  it('成功した取得元は観測値と代表値を保存し、失敗した取得元は実行記録に理由を残す', async () => {
    const results = await fetchCompetitorRatesForHotel(HOTEL, [rakuten, brokenJalan])
    expect(results.map((r) => [r.source, r.status, r.observations])).toEqual([
      ['rakuten', 'succeeded', 2],
      ['jalan', 'failed', 0],
    ])
    expect(results[1]).toMatchObject({ consecutiveFailure: false, errorMessage: 'ページの構造が変わりました' })

    const rows = await prisma.competitorPriceData.findMany({ where: { competitorId: competitorA }, orderBy: { date: 'asc' } })
    expect(rows.map((r) => [r.date.toISOString().slice(0, 10), r.price1P, r.soldOut, r.dataSource])).toEqual([
      [iso(today), 12000, false, 'rakuten'],
      [iso(addUtcDays(today, 1)), null, true, 'rakuten'],
    ])
    const runs = await prisma.competitorFetchRun.findMany({ where: { hotelId: HOTEL }, orderBy: { source: 'asc' } })
    expect(runs.map((r) => [r.source, r.status, r.observations])).toEqual([
      ['jalan', 'failed', 0],
      ['rakuten', 'succeeded', 2],
    ])
  })

  it('同じ取得元が2回続けて失敗したら連続失敗として知らせる', async () => {
    const results = await fetchCompetitorRatesForHotel(HOTEL, [brokenJalan])
    expect(results[0]).toMatchObject({ status: 'failed', consecutiveFailure: true })
  })

  // ジョブ全体（全ホテルが対象）は、他のテナントのデータに実行記録を作らないよう、取得元が空の場合だけを確かめる
  it('取得元が登録されていなければ何もしない', async () => {
    expect(await runCompetitorPricesJob([])).toEqual({ succeeded: 0, failed: 0 })
  })
})
