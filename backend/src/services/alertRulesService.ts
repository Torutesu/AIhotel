import type { AlertSeverity } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import { addUtcDays, todayJst } from '../lib/date.js'

// アラートの自動生成（F-DASH-05 / #83）。日次バッチから呼ぶ。
//
// 閾値は #19（業務運用ルール・KPI定義）で確定するまでの暫定値。確定したら
// ここの定数（またはホテル設定）を差し替える。
//
// 自動生成したアラートは ruleKey で識別する:
// - 同じ ruleKey の未解決アラート（OPEN / ACKNOWLEDGED）があれば作り直さず、内容だけ更新する
//   （利用者が「確認済み」にしたものを OPEN に戻さない）
// - 条件が消えた ruleKey の未解決アラートは RESOLVED にする
// 手動・seed のアラート（ruleKey が null）には触れない。

/** 着地予測の予算比がこれ未満なら Level 5（RED） */
export const LANDING_RED_RATIO = 0.9
/** 着地予測の予算比がこれ未満なら Level 4（YELLOW） */
export const LANDING_YELLOW_RATIO = 0.95
/** 高需要日を探す期間（日） */
export const HIGH_DEMAND_LOOKAHEAD_DAYS = 14

const RULE_LANDING = 'LANDING_BELOW_BUDGET'
const RULE_HIGH_DEMAND = 'HIGH_DEMAND'

export interface DesiredAlert {
  ruleKey: string
  severity: AlertSeverity
  level: number
  title: string
  message: string
  linkTab: string
  targetDate: Date | null
}

function yen(value: number): string {
  return `¥${Math.round(value).toLocaleString('ja-JP')}`
}

/**
 * 着地予測と予算から、予算未達のアラートを作るか判定する（純関数）。
 * 予算・着地予測のどちらかが無い月は判定しない。
 */
export function evaluateLandingBudget(params: {
  year: number
  month: number
  projectedRevenue: number | null
  budgetRevenue: number | null
}): DesiredAlert | null {
  const { year, month, projectedRevenue, budgetRevenue } = params
  if (projectedRevenue == null || budgetRevenue == null || budgetRevenue <= 0) return null

  const ratio = projectedRevenue / budgetRevenue
  if (ratio >= LANDING_YELLOW_RATIO) return null

  const red = ratio < LANDING_RED_RATIO
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  return {
    ruleKey: `${RULE_LANDING}:${monthKey}`,
    severity: red ? 'RED' : 'YELLOW',
    level: red ? 5 : 4,
    title: `${year}年${month}月の着地見込みが予算を下回っています`,
    message:
      `着地予測の室料売上 ${yen(projectedRevenue)} は予算 ${yen(budgetRevenue)} の` +
      `${(ratio * 100).toFixed(1)}% です。価格設定と販売施策を見直してください。`,
    linkTab: 'pricing',
    targetDate: new Date(Date.UTC(year, month - 1, 1)),
  }
}

/**
 * 今日から HIGH_DEMAND_LOOKAHEAD_DAYS 日以内の需要レベル A の日を1件のアラートにまとめる（純関数）。
 */
export function evaluateHighDemand(
  days: Array<{ date: Date; demandLevel: string | null }>,
  today: Date
): DesiredAlert | null {
  const end = addUtcDays(today, HIGH_DEMAND_LOOKAHEAD_DAYS)
  const dates = days
    .filter((d) => d.demandLevel === 'A' && d.date >= today && d.date < end)
    .map((d) => d.date)
    .sort((a, b) => a.getTime() - b.getTime())
  if (dates.length === 0) return null

  const labels = dates.map((d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`)
  return {
    ruleKey: RULE_HIGH_DEMAND,
    severity: 'YELLOW',
    level: 4,
    title: `今後${HIGH_DEMAND_LOOKAHEAD_DAYS}日以内に高需要日が${dates.length}日あります`,
    message: `需要レベルAの日: ${labels.join('、')}。推奨ランクと在庫を確認してください。`,
    linkTab: 'pricing',
    targetDate: dates[0],
  }
}

export interface AlertEvaluationResult {
  created: number
  updated: number
  resolved: number
}

/**
 * 1ホテルぶんのアラートを評価して DB に反映する（冪等）。
 * @param months 着地予算判定の対象月（日次バッチが着地シミュレーションを更新した月）
 */
export async function evaluateAlertsService(
  hotelId: string,
  months: Array<{ year: number; month: number }>,
  today: Date = todayJst()
): Promise<AlertEvaluationResult> {
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, isActive: true },
    select: { tenantId: true },
  })
  if (!hotel) throw new NotFoundError('ホテル')

  const [simulations, budgets, recommendations, active] = await Promise.all([
    prisma.monthlyLandingSimulation.findMany({
      where: { hotelId, OR: months.map((m) => ({ year: m.year, month: m.month })) },
      select: { year: true, month: true, projectedRevenue: true },
    }),
    prisma.monthlyBudget.findMany({
      where: { hotelId, OR: months.map((m) => ({ year: m.year, month: m.month })) },
      select: { year: true, month: true, budgetRevenue: true },
    }),
    prisma.aiPriceRecommendation.findMany({
      where: {
        hotelId,
        roomTypeId: null,
        date: { gte: today, lt: addUtcDays(today, HIGH_DEMAND_LOOKAHEAD_DAYS) },
      },
      select: { date: true, demandLevel: true },
    }),
    prisma.alert.findMany({
      where: { hotelId, ruleKey: { not: null }, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
    }),
  ])

  const key = (y: number, m: number) => `${y}-${m}`
  const simulationByMonth = new Map(simulations.map((s) => [key(s.year, s.month), s.projectedRevenue]))
  const budgetByMonth = new Map(budgets.map((b) => [key(b.year, b.month), b.budgetRevenue]))

  const desired = new Map<string, DesiredAlert>()
  for (const { year, month } of months) {
    const alert = evaluateLandingBudget({
      year,
      month,
      projectedRevenue: simulationByMonth.get(key(year, month)) ?? null,
      budgetRevenue: budgetByMonth.get(key(year, month)) ?? null,
    })
    if (alert) desired.set(alert.ruleKey, alert)
  }
  const highDemand = evaluateHighDemand(recommendations, today)
  if (highDemand) desired.set(highDemand.ruleKey, highDemand)

  // 今回評価した範囲の ruleKey だけを解決の対象にする（対象外の月のアラートは残す）
  const evaluatedLandingKeys = new Set(
    months.map(({ year, month }) => `${RULE_LANDING}:${year}-${String(month).padStart(2, '0')}`)
  )
  const isEvaluated = (ruleKey: string) =>
    ruleKey === RULE_HIGH_DEMAND || evaluatedLandingKeys.has(ruleKey)

  let created = 0
  let updated = 0
  let resolved = 0

  await prisma.$transaction(async (tx) => {
    const activeByKey = new Map(active.map((a) => [a.ruleKey as string, a]))

    for (const alert of desired.values()) {
      const existing = activeByKey.get(alert.ruleKey)
      if (!existing) {
        await tx.alert.create({ data: { hotelId, tenantId: hotel.tenantId, ...alert } })
        created += 1
        continue
      }
      const changed =
        existing.level !== alert.level ||
        existing.severity !== alert.severity ||
        existing.title !== alert.title ||
        existing.message !== alert.message ||
        existing.targetDate?.getTime() !== alert.targetDate?.getTime()
      if (changed) {
        await tx.alert.update({
          where: { id: existing.id },
          data: {
            level: alert.level,
            severity: alert.severity,
            title: alert.title,
            message: alert.message,
            targetDate: alert.targetDate,
          },
        })
        updated += 1
      }
    }

    const stale = active.filter((a) => a.ruleKey && isEvaluated(a.ruleKey) && !desired.has(a.ruleKey))
    if (stale.length > 0) {
      const result = await tx.alert.updateMany({
        where: { id: { in: stale.map((a) => a.id) }, hotelId },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      })
      resolved = result.count
    }
  })

  return { created, updated, resolved }
}
