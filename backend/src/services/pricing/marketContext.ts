// 価格決定・需要予測の両方が使う市場コンテキスト（適用中ランク・競合価格中央値）。
// forecastService と ruleBasedForecaster の循環参照を避けるためここに置く
import { prisma } from '../../lib/prisma.js'
import { toIsoDate } from '../signals/holidaySignal.js'

/**
 * 対象期間の「適用中ランク」（最新の採否記録）を日付キーで返す
 */
export async function getAppliedRanksService(hotelId: string, startDate: Date, endDate: Date): Promise<Map<string, number>> {
  const decisions = await prisma.recommendationDecision.findMany({
    where: { hotelId, stayDate: { gte: startDate, lte: endDate } },
    orderBy: { createdAt: 'desc' },
    select: { stayDate: true, appliedRank: true },
  })
  const map = new Map<string, number>()
  for (const d of decisions) {
    const key = toIsoDate(d.stayDate)
    if (!map.has(key)) map.set(key, d.appliedRank)
  }
  return map
}

/**
 * 対象期間の競合価格（1名利用）の日別中央値
 */
export async function getCompetitorMedianPricesService(hotelId: string, startDate: Date, endDate: Date): Promise<Map<string, number>> {
  const rows = await prisma.competitorPriceData.findMany({
    where: { date: { gte: startDate, lte: endDate }, competitor: { hotelId, isActive: true, excludedFromPricing: false }, price1P: { not: null } },
    select: { date: true, price1P: true },
  })
  const byDate = new Map<string, number[]>()
  for (const r of rows) {
    const key = toIsoDate(r.date)
    const list = byDate.get(key) ?? []
    list.push(r.price1P!)
    byDate.set(key, list)
  }
  const out = new Map<string, number>()
  for (const [key, list] of byDate) {
    const sorted = [...list].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    out.set(key, sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
  }
  return out
}
