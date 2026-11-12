import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { addUtcDays, todayJst } from '../lib/date.js'
import type { MessagesClient } from '../services/externalSignals/agent/collect.js'

// AI 解説の生成（D-13）の統合テスト。Claude API には繋がず、決まった提出を返す偽のクライアントを使う。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス actest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'actest'
const TENANT = `${PREFIX}-tenant`
const HOTEL = `${PREFIX}-hotel`

describeIntegration('AI 解説の生成（D-13）', () => {
  let prisma: PrismaClient
  let generateAiCommentsForHotel: typeof import('../services/aiComments/generate.js').generateAiCommentsForHotel
  let buildHotelFacts: typeof import('../services/aiComments/facts.js').buildHotelFacts
  const today = todayJst()

  const submission = {
    dashboardSummary: '【当月】予算比 95.0% の見込みです。\n【先々】来月は予算に届いています。',
    pricingProposals: [
      { level: 'high', text: '12/5（金）はイベントで需要が高いため、ランクの引き上げを検討してください。' },
      { level: 'low', text: '平日の稼働は予算どおりです。' },
    ],
    externalOutlook: '【総合見通し】イベントが需要を押し上げます。\n【注意事項】特になし。\n【推奨アクション】価格の幅を確かめてください。',
  }

  function fakeClient(input: unknown, calls: Array<{ messages: Array<{ content: string }> }> = []): MessagesClient {
    return {
      create: (async (params: { messages: Array<{ content: string }> }) => {
        calls.push(params)
        return {
          model: 'claude-opus-5-5',
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 't', name: 'submit_comments', input }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }
      }) as unknown as MessagesClient['create'],
    }
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    ;({ generateAiCommentsForHotel } = await import('../services/aiComments/generate.js'))
    ;({ buildHotelFacts } = await import('../services/aiComments/facts.js'))
    await prisma.tenant.deleteMany({ where: { id: TENANT } })
    await prisma.tenant.create({ data: { id: TENANT, code: TENANT, name: TENANT } })
    await prisma.hotel.create({ data: { id: HOTEL, tenantId: TENANT, name: 'テストホテル', totalRooms: 100 } })
    await prisma.monthlyBudget.create({
      data: { tenantId: TENANT, hotelId: HOTEL, year: today.getUTCFullYear(), month: today.getUTCMonth() + 1, budgetRevenue: 10_000_000 },
    })
    await prisma.monthlyLandingSimulation.create({
      data: { tenantId: TENANT, hotelId: HOTEL, year: today.getUTCFullYear(), month: today.getUTCMonth() + 1, projectedRevenue: 9_500_000, projectedOccupancy: 0.78 },
    })
    await prisma.alert.create({
      data: { tenantId: TENANT, hotelId: HOTEL, severity: 'YELLOW', level: 4, title: '予約の入りが遅い', message: '前年の88%です' },
    })
    await prisma.event.create({
      data: { tenantId: TENANT, hotelId: HOTEL, name: '大型コンサート', type: 'concert', startDate: addUtcDays(today, 10), endDate: addUtcDays(today, 10), expectedImpact: 'high' },
    })
    await prisma.aiPriceRecommendation.create({
      data: {
        tenantId: TENANT,
        hotelId: HOTEL,
        date: addUtcDays(today, 10),
        predictedOccupancy: 0.92,
        recommendedRank: 30,
        demandLevel: 'A',
        rationale: { adjustments: [{ key: 'event', impact: 0.15 }], dayType: { name: '平日A型', model: 'adr' } },
      },
    })
    // 30日より古い解説（消える）
    await prisma.aiComment.create({
      data: { tenantId: TENANT, hotelId: HOTEL, section: 'dashboard-summary', content: '古い', generatedAt: addUtcDays(new Date(), -40) },
    })
  })

  afterAll(async () => {
    if (!prisma) return
    await prisma.tenant.deleteMany({ where: { id: TENANT } })
    await prisma.$disconnect()
  })

  it('事実の束に予算の達成率・アラート・イベント・30日の推奨と補正を入れる', async () => {
    const facts = await buildHotelFacts(HOTEL, today)
    expect(facts.months[0]).toMatchObject({ budgetRevenue: 10_000_000, projectedRevenue: 9_500_000, achievementPct: 95 })
    expect(facts.alerts[0]).toMatchObject({ level: 4, title: '予約の入りが遅い' })
    expect(facts.events[0]).toMatchObject({ name: '大型コンサート', impact: 'high', source: 'manual' })
    const day = facts.next30Days.find((d) => d.predictedOccupancyPct === 92)
    expect(day?.drivers).toContain('イベント +15pt')
    expect(day?.dayType).toBe('平日A型')
  })

  it('3つのセクションを保存し、価格の提案は JSON の配列。古い解説は消す', async () => {
    const calls: Array<{ messages: Array<{ content: string }> }> = []
    await generateAiCommentsForHotel(fakeClient(submission, calls), HOTEL, today)
    expect(calls[0].messages[0].content).toContain('<facts>')
    const rows = await prisma.aiComment.findMany({ where: { hotelId: HOTEL }, orderBy: { section: 'asc' } })
    expect(rows.map((r) => r.section)).toEqual(['dashboard-summary', 'external-outlook', 'pricing'])
    expect(rows.every((r) => r.modelVersion === 'claude-opus-5-5')).toBe(true)
    expect(JSON.parse(rows.find((r) => r.section === 'pricing')!.content)).toEqual(submission.pricingProposals)
    expect(rows.some((r) => r.content === '古い')).toBe(false)
  })

  it('形の違う提出は保存しない', async () => {
    const before = await prisma.aiComment.count({ where: { hotelId: HOTEL } })
    await expect(generateAiCommentsForHotel(fakeClient({ dashboardSummary: '', pricingProposals: [], externalOutlook: 'x' }), HOTEL, today)).rejects.toThrow('形が想定と違います')
    expect(await prisma.aiComment.count({ where: { hotelId: HOTEL } })).toBe(before)
  })
})
