// 「今日決めるべき日」ダイジェスト（docs/外部要因設計.md §6）。
//   1. 推奨≠比較対象の日を期待増収額順に並べる
//   2. 前回スナップショットから推奨が動いた日とその理由
//   3. 昨日の答え合わせ（実績 vs その時点の予測）
//   4. 直近30日の採用率
import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import { toIsoDate } from '../signals/holidaySignal.js'
import { dateOnly, getAppliedRanksService, type RecommendationExplanation } from '../forecast/forecastService.js'
import type { DemandFactor } from '../forecast/demandModel.js'

const PRIORITY_LIMIT = 10
const CHANGES_LIMIT = 20
const HORIZON_DAYS = 90

function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function formatPt(pt: number): string {
  const v = Math.round(pt * 100)
  return `${v >= 0 ? '+' : '−'}${Math.abs(v)}pt`
}

/** 需要要因のうち base/pace 以外と pace を影響の大きい順に最大3件、日本語で要約する */
export function summarizeFactors(factors: DemandFactor[]): { summary: string; top: DemandFactor[] } {
  const top = factors
    .filter((f) => f.key !== 'base' && Math.abs(f.pt) >= 0.005)
    .sort((a, b) => Math.abs(b.pt) - Math.abs(a.pt))
    .slice(0, 3)
  const summary = top.length > 0 ? top.map((f) => `${f.label} ${formatPt(f.pt)}`).join('、') : '基準どおり（特別な要因なし）'
  return { summary, top }
}

export interface PricingDigest {
  asOfDate: string
  totalRooms: number
  priorityDays: Array<{
    date: string
    recommendedRank: number
    recommendedPrice: number | null
    currentRank: number | null
    comparisonRank: number
    expectedRevParCurrent: number
    expectedRevParRecommended: number
    expectedRevenueDelta: number
    demandLevel: string | null
    predictedOccupancy: number
    summary: string
    topFactors: DemandFactor[]
  }>
  changesSinceYesterday: Array<{ date: string; previousRank: number; newRank: number; previousAsOfDate: string; reasons: string[] }>
  yesterdayReview: {
    date: string
    predictedOccupancy: number
    actualOccupancy: number
    errorPt: number
    actualAdr: number | null
    actualRevPar: number | null
    comment: string
  } | null
  adoption: { decided: number; adopted: number; adoptionRate: number | null }
}

export async function getPricingDigestService(hotelId: string, asOfDate?: Date): Promise<PricingDigest> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { id: true, totalRooms: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const asOf = dateOnly(asOfDate ?? new Date())
  const horizonEnd = addUtcDays(asOf, HORIZON_DAYS)
  const yesterday = addUtcDays(asOf, -1)

  const [recs, appliedRanks, latestSnapshots, previousSnapshots, yesterdayActual, yesterdaySnapshot, decisions] = await Promise.all([
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, roomTypeId: null, date: { gte: asOf, lte: horizonEnd }, recommendedRank: { not: null } },
      orderBy: { date: 'asc' },
    }),
    getAppliedRanksService(hotelId, asOf, horizonEnd),
    prisma.forecastSnapshot.findMany({
      where: { hotelId, asOfDate: asOf, stayDate: { gte: asOf, lte: horizonEnd } },
      select: { stayDate: true, recommendedRank: true, contributions: true },
    }),
    prisma.forecastSnapshot.findMany({
      where: { hotelId, asOfDate: { lt: asOf }, stayDate: { gte: asOf, lte: horizonEnd } },
      orderBy: { asOfDate: 'desc' },
      select: { stayDate: true, asOfDate: true, recommendedRank: true, contributions: true },
    }),
    prisma.dailyData.findFirst({ where: { hotelId, date: yesterday }, select: { occupancy: true, adr: true, revPar: true } }),
    prisma.forecastSnapshot.findFirst({
      where: { hotelId, stayDate: yesterday, leadDays: { gte: 1 } },
      orderBy: { asOfDate: 'desc' },
      select: { predictedOccupancy: true, leadDays: true, contributions: true },
    }),
    prisma.recommendationDecision.findMany({
      where: { hotelId, createdAt: { gte: addUtcDays(asOf, -30) } },
      select: { recommendedRank: true, appliedRank: true },
    }),
  ])

  // ---- 1. 今日決めるべき日
  const priorityDays = recs
    .map((rec) => {
      const key = toIsoDate(rec.date)
      const explanation = rec.contributions as unknown as RecommendationExplanation | null
      const currentRank = appliedRanks.get(key) ?? null
      const comparisonRank = explanation?.comparisonRank ?? currentRank ?? rec.recommendedRank!
      const { summary, top } = summarizeFactors(explanation?.demandFactors ?? [])
      const cur = rec.expectedRevParCurrent ?? 0
      const recv = rec.expectedRevParRecommended ?? 0
      return {
        date: key,
        recommendedRank: rec.recommendedRank!,
        recommendedPrice: rec.recommendedPrice,
        currentRank,
        comparisonRank,
        expectedRevParCurrent: cur,
        expectedRevParRecommended: recv,
        expectedRevenueDelta: Math.round((recv - cur) * hotel.totalRooms),
        demandLevel: rec.demandLevel,
        predictedOccupancy: rec.predictedOccupancy ?? 0,
        summary,
        topFactors: top,
      }
    })
    .filter((d) => d.recommendedRank !== d.comparisonRank)
    .sort((a, b) => Math.abs(b.expectedRevenueDelta) - Math.abs(a.expectedRevenueDelta))
    .slice(0, PRIORITY_LIMIT)

  // ---- 2. 前回スナップショットからの変化
  const previousByStay = new Map<string, { asOfDate: Date; recommendedRank: number; contributions: unknown }>()
  for (const p of previousSnapshots) {
    const key = toIsoDate(p.stayDate)
    if (!previousByStay.has(key)) previousByStay.set(key, p)
  }
  const changesSinceYesterday: PricingDigest['changesSinceYesterday'] = []
  for (const s of latestSnapshots) {
    const key = toIsoDate(s.stayDate)
    const prev = previousByStay.get(key)
    if (!prev || prev.recommendedRank === s.recommendedRank) continue
    const now = (s.contributions as unknown as RecommendationExplanation | null)?.demandFactors ?? []
    const before = (prev.contributions as unknown as RecommendationExplanation | null)?.demandFactors ?? []
    const beforeByKey = new Map(before.map((f) => [f.key, f.pt]))
    const reasons: string[] = []
    for (const f of now) {
      const b = beforeByKey.get(f.key)
      const diff = f.pt - (b ?? 0)
      if (Math.abs(diff) >= 0.01) reasons.push(`${f.label} ${formatPt(diff)}`)
      beforeByKey.delete(f.key)
    }
    for (const [key, pt] of beforeByKey) {
      const label = before.find((f) => f.key === key)?.label ?? key
      if (Math.abs(pt) >= 0.01) reasons.push(`${label} 解消（${formatPt(-pt)}）`)
    }
    changesSinceYesterday.push({
      date: key,
      previousRank: prev.recommendedRank,
      newRank: s.recommendedRank,
      previousAsOfDate: toIsoDate(prev.asOfDate),
      reasons: reasons.slice(0, 4),
    })
  }
  changesSinceYesterday.sort((a, b) => a.date.localeCompare(b.date))

  // ---- 3. 昨日の答え合わせ
  let yesterdayReview: PricingDigest['yesterdayReview'] = null
  if (yesterdayActual?.occupancy != null && yesterdaySnapshot) {
    const errorPt = yesterdayActual.occupancy - yesterdaySnapshot.predictedOccupancy
    const abs = Math.abs(errorPt)
    const factors = (yesterdaySnapshot.contributions as unknown as RecommendationExplanation | null)?.demandFactors ?? []
    const { summary } = summarizeFactors(factors)
    const comment =
      abs < 0.05
        ? `${yesterdaySnapshot.leadDays}日前の予測どおりでした（誤差 ${formatPt(errorPt)}）。`
        : errorPt > 0
          ? `${yesterdaySnapshot.leadDays}日前の予測より ${formatPt(errorPt)} 高い稼働でした。効いていた要因: ${summary}。係数を上方修正します。`
          : `${yesterdaySnapshot.leadDays}日前の予測より ${formatPt(errorPt)} 低い稼働でした。効いていた要因: ${summary}。係数を下方修正します。`
    yesterdayReview = {
      date: toIsoDate(yesterday),
      predictedOccupancy: yesterdaySnapshot.predictedOccupancy,
      actualOccupancy: yesterdayActual.occupancy,
      errorPt,
      actualAdr: yesterdayActual.adr,
      actualRevPar: yesterdayActual.revPar,
      comment,
    }
  }

  // ---- 4. 採用率
  const adopted = decisions.filter((d) => d.appliedRank === d.recommendedRank).length
  return {
    asOfDate: toIsoDate(asOf),
    totalRooms: hotel.totalRooms,
    priorityDays,
    changesSinceYesterday: changesSinceYesterday.slice(0, CHANGES_LIMIT),
    yesterdayReview,
    adoption: {
      decided: decisions.length,
      adopted,
      adoptionRate: decisions.length > 0 ? adopted / decisions.length : null,
    },
  }
}
