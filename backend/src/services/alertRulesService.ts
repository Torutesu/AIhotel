import type { AlertSeverity } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import { addUtcDays, todayJst } from '../lib/date.js'
import { isInRanges, lastYearSameWeekday } from './forecast/pace.js'

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

/** 推奨価格の異常を探す期間（日 — D-11） */
export const ANOMALY_LOOKAHEAD_DAYS = 90
/** 予測ADRが前年同曜日のADRのこの倍率を超えたら「高すぎる」 */
export const ANOMALY_HIGH_RATIO = 1.5
/** 予測ADRが前年同曜日のADRのこの倍率を下回ったら「安すぎる」 */
export const ANOMALY_LOW_RATIO = 0.6
/** 宿泊日までこの日数以内を「直近」とする（直近は是正、先々は様子見を案内する） */
export const ANOMALY_NEAR_DAYS = 30

const RULE_LANDING = 'LANDING_BELOW_BUDGET'
const RULE_HIGH_DEMAND = 'HIGH_DEMAND'
const RULE_RECOMMENDATION_ANOMALY = 'RECOMMENDATION_ANOMALY'

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

export interface AnomalyInputDay {
  date: Date
  /** 推奨の予測ADR（料金ランクから見た客室単価の見込み） */
  predictedAdr: number | null
  /** 前年同曜日（364日前）の実績ADR。特殊日・実績なしは null */
  lastYearAdr: number | null
}

const md = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`

/**
 * 推奨価格の異常（前年同曜日のADRから大きく外れた日）を1件のアラートにまとめる（純関数 — D-11）。
 * IDeaS の運用に合わせて、宿泊日が先か近いかで案内を変える:
 *   - 高すぎる日が直近（30日以内）にある → Level 4。予算の進捗を見て是正（価格の幅の上限で抑える）
 *   - 先々だけ → Level 3。予約の入り方を見ながら様子見でよい
 *   - 安すぎる日 → 価格の幅の下限で止められることを案内する
 * landingRatioByMonth は月ごとの着地見込みの予算比（"2026-11" → 0.93）。あれば直近の案内に添える
 */
export function evaluateRecommendationAnomalies(
  days: AnomalyInputDay[],
  today: Date,
  landingRatioByMonth: Map<string, number> = new Map()
): DesiredAlert | null {
  const end = addUtcDays(today, ANOMALY_LOOKAHEAD_DAYS)
  const near = addUtcDays(today, ANOMALY_NEAR_DAYS)
  const inRange = days
    .filter((d) => d.date >= today && d.date < end && d.predictedAdr != null && d.lastYearAdr != null && d.lastYearAdr > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
  const ratio = (d: AnomalyInputDay) => (d.predictedAdr as number) / (d.lastYearAdr as number)
  const high = inRange.filter((d) => ratio(d) > ANOMALY_HIGH_RATIO)
  const low = inRange.filter((d) => ratio(d) < ANOMALY_LOW_RATIO)
  if (high.length === 0 && low.length === 0) return null

  const highNear = high.filter((d) => d.date < near)
  const list = (items: AnomalyInputDay[]) =>
    items
      .slice(0, 5)
      .map((d) => `${md(d.date)}（${Math.round(ratio(d) * 100)}%）`)
      .join('、') + (items.length > 5 ? ` ほか${items.length - 5}日` : '')

  const parts: string[] = []
  if (highNear.length > 0) {
    const monthKey = `${highNear[0].date.getUTCFullYear()}-${String(highNear[0].date.getUTCMonth() + 1).padStart(2, '0')}`
    const landing = landingRatioByMonth.get(monthKey)
    parts.push(
      `直近で前年同曜日のADRより大幅に高い日: ${list(highNear)}。` +
        (landing != null ? `その月の着地見込みは予算の${(landing * 100).toFixed(1)}%です。` : '') +
        '予算の進捗を見て、必要なら価格の幅の上限で抑えてください。'
    )
  }
  const highFar = high.filter((d) => d.date >= near)
  if (highFar.length > 0) {
    parts.push(`先々で高い日: ${list(highFar)}。予約の入り方を見ながら様子見で構いません。`)
  }
  if (low.length > 0) {
    parts.push(`前年同曜日のADRより大幅に安い日: ${list(low)}。要因を確認し、必要なら価格の幅の下限を設定してください。`)
  }

  const count = high.length + low.length
  const urgent = highNear.length > 0
  return {
    ruleKey: RULE_RECOMMENDATION_ANOMALY,
    severity: 'YELLOW',
    level: urgent ? 4 : 3,
    title: `推奨価格が前年同曜日から大きく外れている日が${count}日あります`,
    message: parts.join(' '),
    linkTab: 'pricing',
    targetDate: (urgent ? highNear[0] : (high[0] ?? low[0])).date,
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

  const anomalyEnd = addUtcDays(today, ANOMALY_LOOKAHEAD_DAYS)
  const [simulations, budgets, recommendations, active, lastYearDaily, specialEvents] = await Promise.all([
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
        date: { gte: today, lt: anomalyEnd },
      },
      select: { date: true, demandLevel: true, predictedAdr: true },
    }),
    prisma.alert.findMany({
      where: { hotelId, ruleKey: { not: null }, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
    }),
    // 前年同曜日（364日前）の実績ADR（D-11）
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: lastYearSameWeekday(today), lt: lastYearSameWeekday(anomalyEnd) } },
      select: { date: true, adr: true },
    }),
    // 前年の特殊日は比べない（D-11）
    prisma.event.findMany({
      where: {
        hotelId,
        excludeFromHistory: true,
        startDate: { lt: lastYearSameWeekday(anomalyEnd) },
        endDate: { gte: lastYearSameWeekday(today) },
      },
      select: { startDate: true, endDate: true },
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

  const lastYearAdrByDate = new Map(
    lastYearDaily
      .filter((d) => d.adr != null && !isInRanges(d.date, specialEvents))
      .map((d) => [d.date.getTime(), d.adr as number])
  )
  const landingRatioByMonth = new Map<string, number>()
  for (const { year, month } of months) {
    const projected = simulationByMonth.get(key(year, month))
    const budget = budgetByMonth.get(key(year, month))
    if (projected != null && budget != null && budget > 0) {
      landingRatioByMonth.set(`${year}-${String(month).padStart(2, '0')}`, projected / budget)
    }
  }
  const anomaly = evaluateRecommendationAnomalies(
    recommendations.map((r) => ({
      date: r.date,
      predictedAdr: r.predictedAdr,
      lastYearAdr: lastYearAdrByDate.get(lastYearSameWeekday(r.date).getTime()) ?? null,
    })),
    today,
    landingRatioByMonth
  )
  if (anomaly) desired.set(anomaly.ruleKey, anomaly)

  // 今回評価した範囲の ruleKey だけを解決の対象にする（対象外の月のアラートは残す）
  const evaluatedLandingKeys = new Set(
    months.map(({ year, month }) => `${RULE_LANDING}:${year}-${String(month).padStart(2, '0')}`)
  )
  // 終わった月（今月より前）の着地アラートは、もう打つ手が無いので解決する。
  // 評価対象は今月以降のため、これが無いと前月のアラートが「10月」のまま残り続ける
  const currentMonthKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`
  const isPastLanding = (ruleKey: string) =>
    ruleKey.startsWith(`${RULE_LANDING}:`) && ruleKey.slice(RULE_LANDING.length + 1) < currentMonthKey
  const isEvaluated = (ruleKey: string) =>
    ruleKey === RULE_HIGH_DEMAND ||
    ruleKey === RULE_RECOMMENDATION_ANOMALY ||
    evaluatedLandingKeys.has(ruleKey) ||
    isPastLanding(ruleKey)

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
