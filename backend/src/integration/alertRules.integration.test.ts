import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { addUtcDays, todayJst } from '../lib/date.js'

// アラートの自動生成（#83）の統合テスト。サービスを実DBに対して直接呼ぶ。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス atest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const TENANT = 'atest-tenant'
const HOTEL = 'atest-hotel'

describeIntegration('アラートの自動生成（#83）', () => {
  let prisma: PrismaClient
  let evaluateAlertsService: typeof import('../services/alertRulesService.js').evaluateAlertsService
  const today = todayJst()
  const year = today.getUTCFullYear()
  const month = today.getUTCMonth() + 1
  const months = [{ year, month }]

  beforeAll(async () => {
    ;({ evaluateAlertsService } = await import('../services/alertRulesService.js'))
    prisma = new PrismaClient()
    await prisma.tenant.deleteMany({ where: { id: TENANT } })
    await prisma.tenant.create({ data: { id: TENANT, code: TENANT, name: 'アラートテストテナント' } })
    await prisma.hotel.create({
      data: { id: HOTEL, tenantId: TENANT, name: 'アラートテストホテル', totalRooms: 100 },
    })
    // 手動（ruleKey なし）のアラートは自動判定の対象外であることも確かめる
    await prisma.alert.create({
      data: { tenantId: TENANT, hotelId: HOTEL, severity: 'YELLOW', level: 3, title: '手動のアラート', message: '手動' },
    })
    await prisma.monthlyBudget.create({
      data: { tenantId: TENANT, hotelId: HOTEL, year, month, budgetRevenue: 10_000_000 },
    })
    await prisma.monthlyLandingSimulation.create({
      data: { tenantId: TENANT, hotelId: HOTEL, year, month, projectedRevenue: 8_000_000 },
    })
    await prisma.aiPriceRecommendation.create({
      data: { tenantId: TENANT, hotelId: HOTEL, date: addUtcDays(today, 3), demandLevel: 'A' },
    })
  })

  afterAll(async () => {
    if (!prisma) return
    await prisma.tenant.deleteMany({ where: { id: TENANT } })
    await prisma.$disconnect()
  })

  const activeSystemAlerts = () =>
    prisma.alert.findMany({
      where: { hotelId: HOTEL, ruleKey: { not: null }, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      orderBy: { ruleKey: 'asc' },
    })

  it('条件を満たすとアラートを作り、2回実行しても重複しない', async () => {
    expect(await evaluateAlertsService(HOTEL, months, today)).toEqual({ created: 2, updated: 0, resolved: 0 })
    expect(await evaluateAlertsService(HOTEL, months, today)).toEqual({ created: 0, updated: 0, resolved: 0 })

    const alerts = await activeSystemAlerts()
    expect(alerts.map((a) => [a.ruleKey?.split(':')[0], a.level])).toEqual([
      ['HIGH_DEMAND', 4],
      ['LANDING_BELOW_BUDGET', 5],
    ])
  })

  it('確認済みにしたアラートは、内容が変わっても OPEN に戻さない', async () => {
    const landing = (await activeSystemAlerts()).find((a) => a.ruleKey?.startsWith('LANDING'))!
    await prisma.alert.update({ where: { id: landing.id }, data: { status: 'ACKNOWLEDGED' } })
    // 予算比 92% に改善 → Level 4 に下がる
    await prisma.monthlyLandingSimulation.updateMany({
      where: { hotelId: HOTEL },
      data: { projectedRevenue: 9_200_000 },
    })

    expect(await evaluateAlertsService(HOTEL, months, today)).toEqual({ created: 0, updated: 1, resolved: 0 })
    const after = await prisma.alert.findUniqueOrThrow({ where: { id: landing.id } })
    expect(after.status).toBe('ACKNOWLEDGED')
    expect(after.level).toBe(4)
  })

  it('条件が消えたら自動で解決し、手動のアラートには触れない', async () => {
    await prisma.monthlyLandingSimulation.updateMany({
      where: { hotelId: HOTEL },
      data: { projectedRevenue: 10_500_000 },
    })
    await prisma.aiPriceRecommendation.updateMany({ where: { hotelId: HOTEL }, data: { demandLevel: 'C' } })

    expect(await evaluateAlertsService(HOTEL, months, today)).toEqual({ created: 0, updated: 0, resolved: 2 })
    expect(await activeSystemAlerts()).toHaveLength(0)

    const manual = await prisma.alert.findFirstOrThrow({ where: { hotelId: HOTEL, ruleKey: null } })
    expect(manual.status).toBe('OPEN')
  })
})
