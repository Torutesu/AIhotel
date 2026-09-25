// デモモード用のサンプルデータ（#91 で lib/api.ts から分割）。
// NEXT_PUBLIC_DEMO_MODE=true でバックエンドに接続できないときだけ使われ、
// 本番ビルドではツリーシェイクで成果物から消える（scripts/verify-demo-mode.mjs で検証）。

import type {
  AlertStatus,
  AuditLogItem,
  BudgetYear,
  CompetitorSetting,
  Event as HotelEvent,
  PriceRank,
  ReviewScore,
  RoomType,
  User,
} from "@shared/types"
import { parseWeekendDays } from "@/lib/date"
import { createSeededRandom } from "@/lib/format"
import {
  MOCK_ACCOUNTS,
  MOCK_HOTEL_ID,
  MOCK_HOTEL,
  MOCK_TENANT_ID,
} from "./client"
import {
  ComparisonAxis,
  ActualSummary,
  DashboardKpi,
  AlertItem,
  AiSummary,
  PricingCalendarDay,
  PricingCalendar,
  PricingStrategy,
  BookingCurve,
  CompetitorPrices,
  MonthlyTrend,
  CompetitorAnalysis,
  KpiSnapshot,
  MonthlyBudgetRow,
  PricingSimulation,
  ChannelBreakdown,
  RoomTypeBreakdown,
  DayOfWeekBreakdown,
  DashboardPreference,
} from "./types"

// ---- Dev-only demo data (ダッシュボード/ダイナミックプライシング画面用) ----
// バックエンドの seed データと近い分布になるよう簡易な季節・曜日変動を再現しているだけの
// ダミー値。実データではない。

export function toLocalDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function isMockWeekend(date: Date): boolean {
  return parseWeekendDays(MOCK_HOTEL.weekendDays).includes(date.getDay())
}

export function mockSeasonBoost(month: number): number {
  return 1 + 0.1 * Math.sin(((month + 1) / 12) * 2 * Math.PI)
}

export function mockDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function mockRankToPrice1P(rank: number): number {
  const ratio = (rank - 1) / 39
  return Math.round(6500 + ratio * 23500)
}

export function mockDashboardKpi(hotelId: string, year: number, month: number): DashboardKpi {
  const totalRooms = MOCK_HOTEL.totalRooms
  const numDays = mockDaysInMonth(year, month)
  const today = new Date()
  const rng = createSeededRandom(year * 100 + month)
  const boost = mockSeasonBoost(month)

  let totalRevenue = 0
  let soldRoomsSum = 0
  let guestsSum = 0
  let actualDays = 0
  const dailyTrend: DashboardKpi["dailyTrend"] = []

  for (let d = 1; d <= numDays; d++) {
    const date = new Date(year, month - 1, d)
    const weekend = isMockWeekend(date)
    const occupancy = Math.min(1, Math.max(0.3, (weekend ? 0.9 : 0.72) * boost + (rng() - 0.5) * 0.12))
    const adr = Math.round((weekend ? 23000 : 16500) * boost + (rng() - 0.5) * 1000)
    const isActual = date <= today
    const soldRooms = Math.round(occupancy * totalRooms)

    if (isActual) {
      actualDays += 1
      totalRevenue += soldRooms * adr
      soldRoomsSum += soldRooms
      guestsSum += Math.round(soldRooms * (1.3 + rng() * 0.4))
    }

    dailyTrend.push({
      date: toLocalDateStr(date),
      occupancy: isActual ? Number(occupancy.toFixed(3)) : null,
      adr: isActual ? adr : null,
      predictedOccupancy: Number(Math.min(1, occupancy + (rng() - 0.5) * 0.06).toFixed(3)),
      predictedAdr: Math.round(adr * (1 + (rng() - 0.5) * 0.05)),
      // 前年同月同日の実績（モックでは当年から数%低い水準として生成）
      lastYearOccupancy: Number(Math.max(0.2, occupancy * (0.93 + rng() * 0.06)).toFixed(3)),
      lastYearAdr: Math.round(adr * (0.9 + rng() * 0.06)),
      isActual,
    })
  }

  const adr = soldRoomsSum > 0 ? Math.round(totalRevenue / soldRoomsSum) : 0
  const occupancyRate = actualDays > 0 ? soldRoomsSum / (totalRooms * actualDays) : 0
  const revPar = actualDays > 0 ? totalRevenue / (totalRooms * actualDays) : 0
  // DOR = 宿泊人数 / 販売室数（1室あたり平均利用人数）
  const dor = soldRoomsSum > 0 ? Math.round((guestsSum / soldRoomsSum) * 100) / 100 : 0
  const guestUnitPrice = guestsSum > 0 ? Math.round(totalRevenue / guestsSum) : 0

  const budgetOccupancy = 0.78
  const budgetAdr = 18500
  const budgetRevenue = Math.round(budgetAdr * budgetOccupancy * totalRooms * numDays)
  const budgetRevenueToDate = actualDays > 0 ? Math.round((budgetRevenue / numDays) * actualDays) : null
  const lastYearRevenue = Math.round(budgetRevenue * 0.95)
  const lastYearAdr = 17200
  const lastYearOccupancy = 0.74

  const mockRatio = (actual: number | null, target: number | null): number | null =>
    actual == null || target == null || target === 0 ? null : Number((actual / target).toFixed(3))

  const mockAxis = (
    budgetRev: number | null,
    lastYearRev: number | null,
    actualRevenue: number,
    actualAdr: number,
    actualOccupancy: number
  ): ComparisonAxis => ({
    budgetRevenue: budgetRev,
    budgetRevenueRatio: mockRatio(actualRevenue, budgetRev),
    budgetAdr,
    budgetAdrRatio: mockRatio(actualAdr, budgetAdr),
    budgetOccupancy,
    budgetOccupancyRatio: mockRatio(actualOccupancy, budgetOccupancy),
    lastYearRevenue: lastYearRev,
    lastYearRevenueRatio: mockRatio(actualRevenue, lastYearRev),
    lastYearAdr,
    lastYearAdrRatio: mockRatio(actualAdr, lastYearAdr),
    lastYearOccupancy,
    lastYearOccupancyRatio: mockRatio(actualOccupancy, lastYearOccupancy),
  })

  // 年度累計（4月始まり）のモック: 経過月数ぶんを当月実績から外挿する
  const fiscalStartYear = month >= 4 ? year : year - 1
  const elapsedFiscalMonths = month >= 4 ? month - 3 : month + 9
  const fiscalRevenue = Math.round(totalRevenue * elapsedFiscalMonths * 0.98)
  const fiscalBudgetRevenue = Math.round((budgetRevenueToDate ?? 0) * elapsedFiscalMonths)
  const fiscalLastYearRevenue = Math.round(fiscalBudgetRevenue * 0.95)
  const fiscalSoldRooms = soldRoomsSum * elapsedFiscalMonths
  const fiscalGuests = guestsSum * elapsedFiscalMonths
  const fiscalAdr = fiscalSoldRooms > 0 ? Math.round(fiscalRevenue / fiscalSoldRooms) : 0

  const monthSummary: ActualSummary = {
    roomRevenue: Math.round(totalRevenue),
    soldRooms: soldRoomsSum,
    adr,
    occupancyRate: Number(occupancyRate.toFixed(3)),
    revPar: Math.round(revPar),
    guests: guestsSum,
    dor,
    guestUnitPrice,
    actualDays,
  }

  return {
    hotelId,
    year,
    month,
    summary: monthSummary,
    comparison:
      actualDays > 0 && budgetRevenueToDate
        ? {
            budgetRevenue,
            budgetRevenueToDate,
            budgetRatioToDate: Number((totalRevenue / budgetRevenueToDate).toFixed(3)),
            budgetAdr,
            budgetOccupancy,
            lastYearRevenue,
            lastYearRatio: Number((totalRevenue / (lastYearRevenue * (actualDays / numDays))).toFixed(3)),
            lastYearAdr,
            lastYearOccupancy,
            toDate: mockAxis(
              budgetRevenueToDate,
              Math.round(lastYearRevenue * (actualDays / numDays)),
              totalRevenue,
              adr,
              occupancyRate
            ),
            cumulative: mockAxis(budgetRevenue, lastYearRevenue, totalRevenue, adr, occupancyRate),
            fiscalYear: mockAxis(
              fiscalBudgetRevenue,
              fiscalLastYearRevenue,
              fiscalRevenue,
              fiscalAdr,
              occupancyRate
            ),
            fiscalYearLabel: `${fiscalStartYear}年度（4月〜${month}月）`,
            actualSummary: {
              toDate: monthSummary,
              cumulative: monthSummary,
              fiscalYear: {
                roomRevenue: fiscalRevenue,
                soldRooms: fiscalSoldRooms,
                adr: fiscalAdr,
                occupancyRate: Number(occupancyRate.toFixed(3)),
                revPar: Math.round(revPar),
                guests: fiscalGuests,
                dor: fiscalSoldRooms > 0 ? Number((fiscalGuests / fiscalSoldRooms).toFixed(2)) : 0,
                guestUnitPrice: fiscalGuests > 0 ? Math.round(fiscalRevenue / fiscalGuests) : 0,
                actualDays: actualDays * elapsedFiscalMonths,
              },
            },
          }
        : null,
    dailyTrend,
    simulation: {
      projectedRevenue: Math.round(budgetAdr * 1.02 * 0.81 * totalRooms * numDays),
      projectedAdr: Math.round(budgetAdr * 1.02),
      projectedOccupancy: 0.81,
      projectedRevPar: Math.round(budgetAdr * 1.02 * 0.81),
    },
  }
}

export function mockAlerts(minLevel?: number): AlertItem[] {
  const today = new Date()
  const plusDays = (n: number) => {
    const d = new Date(today)
    d.setDate(d.getDate() + n)
    return toLocalDateStr(d)
  }
  const all: AlertItem[] = [
    {
      id: "mock-alert-1",
      severity: "RED",
      level: 5,
      title: "稼働率が予算を大幅に下回っています",
      message: "来週火曜の予約積上が予算比 -18pt です。価格ランクの引き下げを検討してください。",
      linkTab: "pricing",
      targetDate: plusDays(4),
      status: "OPEN",
      detectedAt: today.toISOString(),
    },
    {
      id: "mock-alert-2",
      severity: "YELLOW",
      level: 4,
      title: "競合価格との乖離が拡大",
      message: "今週末の自社価格が競合水準より 12% 高くなっています。経過観察してください。",
      linkTab: "daily",
      targetDate: plusDays(2),
      status: "OPEN",
      detectedAt: today.toISOString(),
    },
    {
      id: "mock-alert-3",
      severity: "YELLOW",
      level: 3,
      title: "OTA別の予約構成比に変化",
      message: "公式サイト経由の構成比が前月比 -4pt です。チャネル分析で推移を確認してください。",
      linkTab: "analysis",
      targetDate: plusDays(7),
      status: "OPEN",
      detectedAt: today.toISOString(),
    },
    {
      id: "mock-alert-4",
      severity: "YELLOW",
      level: 2,
      title: "翌月の予算未登録",
      message: "翌月の予算データが未登録です。設定画面から登録してください。",
      linkTab: "settings",
      targetDate: null,
      status: "OPEN",
      detectedAt: today.toISOString(),
    },
    {
      id: "mock-alert-5",
      severity: "YELLOW",
      level: 1,
      title: "料金ランクの見直し推奨",
      message: "直近30日で未使用の料金ランクが3件あります。マスタ整理を検討してください。",
      linkTab: "settings",
      targetDate: null,
      status: "OPEN",
      detectedAt: today.toISOString(),
    },
  ]
  // 画面で「確認済み」「解決済み」にした状態を反映する。解決済みはバックエンドと同じく一覧から外す
  const withStatus = all.map((a) => ({ ...a, status: mockAlertStatuses.get(a.id) ?? a.status }))
  const open = withStatus.filter((a) => a.status !== "RESOLVED")
  return minLevel != null ? open.filter((a) => a.level >= minLevel) : open
}

/** デモ表示中にアラートの状態を変えたもの（ページを再読み込みすると元に戻る） */
const mockAlertStatuses = new Map<string, AlertStatus>()

export function updateMockAlertStatus(id: string, status: AlertStatus): AlertItem | null {
  const target = mockAlerts().find((a) => a.id === id)
  if (!target) return null
  mockAlertStatuses.set(id, status)
  return { ...target, status }
}

export function mockAiSummary(section?: string): AiSummary {
  return {
    id: "mock-ai-summary",
    section: section ?? "dashboard-summary",
    content:
      "今月の稼働率は予算比 +2.1pt と好調に推移しています。週末（金・土）のADRは前年比 +6% で、" +
      "特に土曜日は満室に近い水準です。一方、平日火曜・水曜の稼働が予算を下回っており、" +
      "平日限定プランまたは料金ランク引き下げの検討を推奨します。",
    generatedAt: new Date().toISOString(),
  }
}

export function mockPricingCalendar(hotelId: string, year: number, month: number): PricingCalendar {
  const numDays = mockDaysInMonth(year, month)
  const today = new Date()
  const rng = createSeededRandom(year * 100 + month + 7)
  const boost = mockSeasonBoost(month)
  const calendar: PricingCalendarDay[] = []

  for (let d = 1; d <= numDays; d++) {
    const date = new Date(year, month - 1, d)
    const weekend = isMockWeekend(date)
    const isPast = date < today
    const predictedOccupancy = Number(
      Math.min(1, Math.max(0.3, (weekend ? 0.9 : 0.72) * boost + (rng() - 0.5) * 0.1)).toFixed(3)
    )
    const predictedAdr = Math.round((weekend ? 24000 : 17000) * boost)
    const recommendedRank = Math.min(40, Math.max(1, Math.round(predictedOccupancy * 40)))
    const price1P = mockRankToPrice1P(recommendedRank)
    const demandLevel: PricingCalendarDay["demandLevel"] =
      predictedOccupancy > 0.9 ? "A" : predictedOccupancy > 0.8 ? "B" : predictedOccupancy > 0.65 ? "C" : predictedOccupancy > 0.5 ? "D" : "E"
    const competitorMedianPrice = Math.round((weekend ? 22000 : 15500) * boost * (0.95 + rng() * 0.15))

    calendar.push({
      date: toLocalDateStr(date),
      demandLevel,
      recommendedRank,
      recommendedPrice: price1P,
      rankLabel: `R${String(recommendedRank).padStart(2, "0")}`,
      price1P,
      price2P: Math.round(price1P * 1.4),
      price3P: Math.round(price1P * 1.8),
      predictedOccupancy,
      predictedAdr,
      actualOccupancy: isPast ? Number(Math.min(1, predictedOccupancy + (rng() - 0.5) * 0.1).toFixed(3)) : null,
      actualAdr: isPast ? Math.round(predictedAdr * (1 + (rng() - 0.5) * 0.06)) : null,
      competitorMedianPrice,
      competitorMinPrice: Math.round(competitorMedianPrice * 0.88),
      competitorMaxPrice: Math.round(competitorMedianPrice * 1.14),
      confidence: Number((0.7 + rng() * 0.25).toFixed(2)),
    })
  }

  return { hotelId, year, month, calendar }
}

/** 中央値（デモデータ生成用） */
export function mockMedian(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid]
}

// 競合ホテル（seedと同等の3社構成）
export const MOCK_COMPETITOR_DEFS = [
  { id: "mock-comp-1", name: "コンペティターホテルA", category: "アップスケール", factor: 1.08 },
  { id: "mock-comp-2", name: "コンペティターホテルB", category: "ミッドスケール", factor: 0.94 },
  { id: "mock-comp-3", name: "コンペティターホテルC", category: "アップスケール", factor: 1.02 },
]

export function eachMockDate(startDate: string, endDate: string): Date[] {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const dates: Date[] = []
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d))
  }
  return dates
}

export function mockBookingCurve(hotelId: string, date: string): BookingCurve {
  const stay = new Date(date)
  const totalRooms = MOCK_HOTEL.totalRooms
  const rng = createSeededRandom(stay.getFullYear() * 10000 + (stay.getMonth() + 1) * 100 + stay.getDate())
  const weekend = isMockWeekend(stay)
  const finalOccupancy = Math.min(0.98, (weekend ? 0.92 : 0.74) + (rng() - 0.5) * 0.1)

  // 宿泊日までの日数が減るほど積み上がる（右肩上がり — F-DAILY-01）
  const daysBeforeList = [90, 60, 45, 30, 21, 14, 10, 7, 5, 3, 2, 1, 0]
  const points = daysBeforeList.map((daysBefore) => {
    const progress = Math.pow(1 - daysBefore / 90, 1.6)
    const occupancy = Number((finalOccupancy * progress).toFixed(3))
    return {
      daysBefore,
      roomsBooked: Math.round(totalRooms * occupancy),
      occupancy,
    }
  })

  return { hotelId, stayDate: date, totalRooms, points }
}

export function mockCompetitorPrices(hotelId: string, startDate: string, endDate: string): CompetitorPrices {
  const dates = eachMockDate(startDate, endDate)
  const today = new Date()

  const basePrice = (date: Date, rng: () => number) => {
    const weekend = isMockWeekend(date)
    return Math.round((weekend ? 23000 : 16500) * mockSeasonBoost(date.getMonth() + 1) * (0.97 + rng() * 0.08))
  }

  const ownPrices = dates.map((date) => {
    const rng = createSeededRandom(date.getTime() / 86400000)
    const price1P = basePrice(date, rng)
    return {
      date: toLocalDateStr(date),
      price: price1P,
      isActual: date <= today,
      // 利用人数別の自館価格（料金ランク相当。1名を基準に2名・3名を積み上げる）
      price1P,
      price2P: Math.round(price1P * 1.4),
      price3P: Math.round(price1P * 1.8),
    }
  })

  const competitors = MOCK_COMPETITOR_DEFS.map((comp, ci) => ({
    id: comp.id,
    name: comp.name,
    category: comp.category,
    prices: dates.map((date) => {
      const rng = createSeededRandom(date.getTime() / 86400000 + ci * 977)
      const price1P = Math.round(basePrice(date, rng) * comp.factor)
      return {
        date: toLocalDateStr(date),
        price1P,
        price2P: Math.round(price1P * 1.38),
        price3P: Math.round(price1P * 1.75),
        reliability: rng() > 0.15 ? "HIGH" : "MEDIUM",
      }
    }),
  }))

  return { hotelId, startDate, endDate, ownPrices, competitors }
}

export function mockMonthlyTrend(hotelId: string, year: number): MonthlyTrend {
  const today = new Date()
  const totalRooms = MOCK_HOTEL.totalRooms

  const months = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const rng = createSeededRandom(year * 100 + month)
    const boost = mockSeasonBoost(month)
    const days = mockDaysInMonth(year, month)
    const hasActuals = new Date(year, month - 1, 1) <= today

    const occupancy = Number(Math.min(0.97, 0.76 * boost + (rng() - 0.5) * 0.08).toFixed(3))
    const adr = Math.round(18000 * boost * (0.97 + rng() * 0.06))
    const soldRooms = Math.round(totalRooms * days * occupancy)
    const revenue = soldRooms * adr
    const guests = Math.round(soldRooms * 1.5)

    return {
      month,
      revenue: hasActuals ? revenue : 0,
      soldRooms: hasActuals ? soldRooms : 0,
      guests: hasActuals ? guests : 0,
      adr: hasActuals ? adr : null,
      occupancy: hasActuals ? occupancy : null,
      revPar: hasActuals ? Math.round(adr * occupancy) : null,
      budgetRevenue: Math.round(revenue * 0.97),
      lastYearRevenue: Math.round(revenue * 0.93),
      hasActuals,
    }
  })

  return { hotelId, year, months }
}

export function mockCompetitorAnalysis(
  hotelId: string,
  startDate: string,
  endDate: string
): CompetitorAnalysis {
  const prices = mockCompetitorPrices(hotelId, startDate, endDate)

  const competitors = prices.competitors.map((comp) => {
    const values = comp.prices
      .map((p) => p.price1P)
      .filter((v): v is number => v != null)
    return {
      id: comp.id,
      name: comp.name,
      category: comp.category,
      sampleSize: values.length,
      minPrice: values.length > 0 ? Math.min(...values) : null,
      maxPrice: values.length > 0 ? Math.max(...values) : null,
      medianPrice: mockMedian(values),
    }
  })

  return { hotelId, startDate, endDate, competitors }
}

// 料金ランク40段階（F-SET-02）。更新はメモリ上に保持してUI操作を確認できるようにする
export let mockPriceRanks: PriceRank[] | null = null

export function getMockPriceRanks(hotelId: string): PriceRank[] {
  if (mockPriceRanks) return mockPriceRanks
  mockPriceRanks = Array.from({ length: 40 }, (_, i) => {
    const rank = i + 1
    const price1P = mockRankToPrice1P(rank)
    return {
      id: `mock-rank-${rank}`,
      hotelId,
      rank,
      label: `R${String(rank).padStart(2, "0")}`,
      price1P,
      price2P: Math.round(price1P * 1.4),
      price3P: Math.round(price1P * 1.8),
      price4P: Math.round(price1P * 2.1),
      isActive: true,
    } as PriceRank
  })
  return mockPriceRanks
}

export let mockStrategy: PricingStrategy = {
  id: "mock-strategy",
  hotelId: MOCK_HOTEL_ID,
  weightOccupancy: 40,
  weightAdr: 40,
  weightCompetitor: 20,
  competitorOccupancy: null,
  competitorOffsetPct: 0,
  minRank: null,
  maxRank: null,
  maxDailyRankChange: 3,
  hysteresisRanks: 1,
}

export let mockEvents: HotelEvent[] | null = null

export function getMockEvents(hotelId: string): HotelEvent[] {
  if (mockEvents) return mockEvents
  const today = new Date()
  mockEvents = [
    {
      id: "mock-event-1",
      hotelId,
      name: "地域花火大会",
      type: "festival",
      startDate: new Date(today.getFullYear(), today.getMonth(), 15),
      endDate: new Date(today.getFullYear(), today.getMonth(), 15),
      location: "近隣河川敷",
      expectedImpact: "high",
      description: "周辺ホテルの需要増加が見込まれます。",
    },
  ]
  return mockEvents
}

/** デモモードで保存した価格戦略を差し替える（ES モジュールの import は再代入できないため関数で行う） */
export function setMockStrategy(next: PricingStrategy): PricingStrategy {
  mockStrategy = next
  return mockStrategy
}

/** デモモードで編集したイベント一覧を差し替える */
export function setMockEvents(next: HotelEvent[]): HotelEvent[] {
  mockEvents = next
  return mockEvents
}

// ---- KPI比較・着地予測・分析の内訳・設定タブ ----
// 構成は seed（backend/prisma/seed.ts）と揃えている（部屋タイプ5種・販売チャネル6種・口コミ5サイト）。
// 値はダッシュボードのモック（mockDashboardKpi）から導き、画面間で数字が大きく食い違わないようにする。

/** KPIスナップショット。対象月の1日から今日まで1日1件（対象月がまだ先なら直近14日） */
export function mockKpiSnapshots(hotelId: string, year: number, month: number, baseDate?: string): KpiSnapshot[] {
  const { simulation } = mockDashboardKpi(hotelId, year, month)
  const numDays = mockDaysInMonth(year, month)
  const capacity = MOCK_HOTEL.totalRooms * numDays
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const monthStart = new Date(year, month - 1, 1)
  const monthEnd = new Date(year, month, 0)
  const last = todayStart < monthEnd ? todayStart : monthEnd
  const first = todayStart < monthStart
    ? new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() - 13)
    : monthStart
  const rng = createSeededRandom(year * 1000 + month * 7)

  const dates: Date[] = []
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) dates.push(new Date(d))

  const snapshots = dates.map((date, i): KpiSnapshot => {
    // 月初は控えめな見込みで、日を追うごとに着地見込みへ近づく
    const progress = dates.length > 1 ? i / (dates.length - 1) : 1
    const occupancy = Number(((simulation?.projectedOccupancy ?? 0.8) * (0.94 + 0.06 * progress + (rng() - 0.5) * 0.01)).toFixed(3))
    const adr = Math.round((simulation?.projectedAdr ?? 18000) * (0.98 + 0.02 * progress))
    const soldRooms = Math.round(occupancy * capacity)
    const revenue = soldRooms * adr
    const snapshotDate = toLocalDateStr(date)
    return {
      id: `mock-snapshot-${snapshotDate}`,
      hotelId,
      snapshotDate,
      targetYear: year,
      targetMonth: month,
      revenue,
      soldRooms,
      adr,
      occupancy,
      revPar: Math.round(revenue / capacity),
      guests: Math.round(soldRooms * 1.45),
    }
  })
  return baseDate ? snapshots.filter((s) => s.snapshotDate === baseDate) : snapshots
}

/** 月次予算（季節変動つき）と前年実績 */
function mockBudgetValues(year: number, month: number): Omit<MonthlyBudgetRow, "id" | "hotelId" | "year" | "month"> {
  const capacity = MOCK_HOTEL.totalRooms * mockDaysInMonth(year, month)
  const boost = mockSeasonBoost(month)
  const budgetOccupancy = Number(Math.min(0.95, 0.78 * boost).toFixed(3))
  const budgetAdr = Math.round((18500 * boost) / 100) * 100
  const budgetRooms = Math.round(capacity * budgetOccupancy)
  const lastYearOccupancy = Number((budgetOccupancy * 0.95).toFixed(3))
  const lastYearAdr = Math.round((budgetAdr * 0.93) / 100) * 100
  const lastYearRooms = Math.round(capacity * lastYearOccupancy)
  return {
    budgetRevenue: budgetRooms * budgetAdr,
    budgetRooms,
    budgetAdr,
    budgetOccupancy,
    budgetGuests: Math.round(budgetRooms * 1.45),
    lastYearRevenue: lastYearRooms * lastYearAdr,
    lastYearRooms,
    lastYearAdr,
    lastYearOccupancy,
    lastYearGuests: Math.round(lastYearRooms * 1.42),
  }
}

export function mockBudgetYear(hotelId: string, year: number): BudgetYear {
  const now = new Date()
  return {
    hotelId,
    year,
    months: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      budget: {
        id: `mock-budget-${year}-${i + 1}`,
        tenantId: MOCK_TENANT_ID,
        hotelId,
        year,
        month: i + 1,
        ...mockBudgetValues(year, i + 1),
        createdAt: now,
        updatedAt: now,
      },
    })),
  }
}

/** 月次着地シミュレーション（予測値はダッシュボードのモックと同じ） */
export function mockPricingSimulation(hotelId: string, year: number, month: number): PricingSimulation {
  const { simulation } = mockDashboardKpi(hotelId, year, month)
  const capacity = MOCK_HOTEL.totalRooms * mockDaysInMonth(year, month)
  return {
    simulation: simulation && {
      id: `mock-simulation-${year}-${month}`,
      hotelId,
      year,
      month,
      projectedRevenue: simulation.projectedRevenue,
      projectedAdr: simulation.projectedAdr,
      projectedOccupancy: simulation.projectedOccupancy,
      projectedRevPar: simulation.projectedRevPar,
      projectedRooms: simulation.projectedOccupancy == null ? null : Math.round(simulation.projectedOccupancy * capacity),
      computedAt: new Date().toISOString(),
    },
    budget: { id: `mock-budget-${year}-${month}`, hotelId, year, month, ...mockBudgetValues(year, month) },
  }
}

const MOCK_CHANNELS = [
  { channel: "公式サイト", share: 0.3, adrFactor: 1.05 },
  { channel: "楽天トラベル", share: 0.25, adrFactor: 0.98 },
  { channel: "じゃらん", share: 0.2, adrFactor: 0.97 },
  { channel: "一休", share: 0.1, adrFactor: 1.15 },
  { channel: "Expedia", share: 0.08, adrFactor: 0.95 },
  { channel: "Agoda", share: 0.07, adrFactor: 0.92 },
]

/** チャネル別の実績（対象月の実績を seed と同じ比率で分ける） */
export function mockChannelBreakdown(hotelId: string, year: number, month: number): ChannelBreakdown {
  const { summary } = mockDashboardKpi(hotelId, year, month)
  const rng = createSeededRandom(year * 100 + month + 11)
  const weightSum = MOCK_CHANNELS.reduce((sum, c) => sum + c.share * c.adrFactor, 0)
  const channels = summary.soldRooms === 0 ? [] : MOCK_CHANNELS.map((c) => {
    const roomsSold = Math.round(summary.soldRooms * c.share)
    const revenue = Math.round((summary.roomRevenue * c.share * c.adrFactor) / weightSum)
    return {
      channel: c.channel,
      roomsSold,
      revenue,
      adr: roomsSold > 0 ? Math.round(revenue / roomsSold) : null,
      revenueShare: Number(((revenue / summary.roomRevenue) * 100).toFixed(1)),
      revenueGrowth: Number(((rng() - 0.4) * 20).toFixed(1)),
    }
  })
  return { hotelId, year, month, channels }
}

const MOCK_ROOM_TYPE_DEFS = [
  { code: "STD_SINGLE", name: "スタンダードシングル", capacity: 1, count: 80 },
  { code: "STD_DOUBLE", name: "スタンダードダブル", capacity: 2, count: 40 },
  { code: "MOD_TWIN", name: "モデレートツイン", capacity: 2, count: 50 },
  { code: "DLX_TWIN", name: "デラックスツイン", capacity: 2, count: 20 },
  { code: "TRIPLE", name: "トリプル", capacity: 3, count: 10 },
]

export function mockRoomTypes(hotelId: string): RoomType[] {
  return MOCK_ROOM_TYPE_DEFS.map((t, i) => ({
    id: `mock-room-type-${i + 1}`,
    hotelId,
    name: t.name,
    code: t.code,
    capacity: t.capacity,
    count: t.count,
    isActive: true,
    sortOrder: i + 1,
  }))
}

/** 部屋タイプ別の実績（上位の部屋ほど単価が高い） */
export function mockRoomTypeBreakdown(hotelId: string, year: number, month: number): RoomTypeBreakdown {
  const { summary } = mockDashboardKpi(hotelId, year, month)
  const types = mockRoomTypes(hotelId)
  const totalCount = types.reduce((sum, t) => sum + t.count, 0)
  const weightSum = types.reduce((sum, t) => sum + t.count * (1 + t.sortOrder * 0.12), 0)
  return {
    hotelId,
    year,
    month,
    actualDays: summary.actualDays,
    roomTypes: types.map((t) => {
      const soldRooms = Math.round((summary.soldRooms * t.count) / totalCount)
      const revenue = Math.round((summary.roomRevenue * t.count * (1 + t.sortOrder * 0.12)) / weightSum)
      return {
        roomTypeId: t.id,
        name: t.name,
        code: t.code,
        count: t.count,
        soldRooms,
        revenue,
        adr: soldRooms > 0 ? Math.round(revenue / soldRooms) : null,
        occupancy: summary.actualDays > 0 ? Number((soldRooms / (t.count * summary.actualDays)).toFixed(3)) : null,
      }
    }),
  }
}

/** 曜日別の実績（ダッシュボードのモックの日別実績を曜日ごとに集計） */
export function mockDayOfWeekBreakdown(hotelId: string, year: number, month: number): DayOfWeekBreakdown {
  const { dailyTrend } = mockDashboardKpi(hotelId, year, month)
  const totalRooms = MOCK_HOTEL.totalRooms
  const buckets = Array.from({ length: 7 }, () => ({ days: 0, soldRooms: 0, revenue: 0 }))
  for (const day of dailyTrend) {
    if (!day.isActual || day.occupancy == null || day.adr == null) continue
    const [y, m, d] = day.date.split("-").map(Number)
    const bucket = buckets[new Date(y, m - 1, d).getDay()]
    const soldRooms = Math.round(day.occupancy * totalRooms)
    bucket.days += 1
    bucket.soldRooms += soldRooms
    bucket.revenue += soldRooms * day.adr
  }
  const weekendDays = parseWeekendDays(MOCK_HOTEL.weekendDays)
  return {
    hotelId,
    year,
    month,
    days: buckets.map((b, dayOfWeek) => ({
      dayOfWeek,
      isWeekend: weekendDays.includes(dayOfWeek),
      days: b.days,
      soldRooms: b.soldRooms,
      revenue: b.revenue,
      occupancy: b.days > 0 ? Number((b.soldRooms / (totalRooms * b.days)).toFixed(3)) : null,
      adr: b.soldRooms > 0 ? Math.round(b.revenue / b.soldRooms) : null,
      revPar: b.days > 0 ? Math.round(b.revenue / (totalRooms * b.days)) : null,
    })),
  }
}

export function mockCompetitorSettings(hotelId: string): CompetitorSetting[] {
  const now = new Date()
  return MOCK_COMPETITOR_DEFS.map((c) => ({
    id: c.id,
    tenantId: MOCK_TENANT_ID,
    hotelId,
    name: c.name,
    address: null,
    category: c.category,
    otaUrls: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }))
}

export function mockUsers(hotelId: string): User[] {
  const now = new Date()
  return Object.entries(MOCK_ACCOUNTS).map(([email, account]) => ({
    id: `mock-${account.role.toLowerCase()}`,
    tenantId: MOCK_TENANT_ID,
    email,
    name: account.name,
    role: account.role,
    hotelId,
    isActive: true,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  }))
}

/** 口コミ評価点（seed と同じ5サイト × 直近6か月の月初時点。新しい順） */
export function mockReviewScores(hotelId: string): ReviewScore[] {
  const sources = [
    { source: "rakuten", base: 4.32, reviewCount: 1840 },
    { source: "jalan", base: 4.18, reviewCount: 1260 },
    { source: "ikkyu", base: 4.45, reviewCount: 430 },
    { source: "google", base: 4.05, reviewCount: 2210 },
    { source: "tripadvisor", base: 4.21, reviewCount: 760 },
  ]
  const rng = createSeededRandom(4242)
  const today = new Date()
  const rows: ReviewScore[] = []
  for (let monthsAgo = 0; monthsAgo <= 5; monthsAgo++) {
    const capturedAt = new Date(Date.UTC(today.getFullYear(), today.getMonth() - monthsAgo, 1)).toISOString()
    for (const src of sources) {
      const drift = (5 - monthsAgo) * 0.02 + (rng() - 0.5) * 0.06
      rows.push({
        id: `mock-review-${src.source}-${monthsAgo}`,
        tenantId: MOCK_TENANT_ID,
        hotelId,
        source: src.source,
        score: Math.round(Math.min(5, Math.max(1, src.base + drift)) * 100) / 100,
        reviewCount: src.reviewCount - monthsAgo * 25,
        capturedAt,
      })
    }
  }
  return rows
}

export function mockAuditLogs(action?: string): { items: AuditLogItem[]; nextCursor: string | null } {
  const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000).toISOString()
  const admin = { name: MOCK_ACCOUNTS["admin@demo-hotel.example.com"].name, email: "admin@demo-hotel.example.com" }
  const manager = { name: MOCK_ACCOUNTS["manager@demo-hotel.example.com"].name, email: "manager@demo-hotel.example.com" }
  const items: AuditLogItem[] = [
    { id: "mock-audit-1", action: "LOGIN", entity: "User", entityId: "mock-admin", oldValue: null, newValue: null, ipAddress: "203.0.113.10", createdAt: at(0.1), user: admin },
    { id: "mock-audit-2", action: "UPDATE", entity: "PricingStrategy", entityId: "mock-strategy", oldValue: { weightOccupancy: 50 }, newValue: { weightOccupancy: 40 }, ipAddress: "203.0.113.24", createdAt: at(5), user: manager },
    { id: "mock-audit-3", action: "UPDATE", entity: "PriceRank", entityId: "mock-rank-12", oldValue: { price1p: 14200 }, newValue: { price1p: 14800 }, ipAddress: "203.0.113.24", createdAt: at(26), user: manager },
    { id: "mock-audit-4", action: "CREATE", entity: "Event", entityId: "mock-event-1", oldValue: null, newValue: { name: "東京国際展示会" }, ipAddress: "203.0.113.10", createdAt: at(50), user: admin },
    { id: "mock-audit-5", action: "LOGIN_FAILED", entity: "User", entityId: null, oldValue: null, newValue: null, ipAddress: "198.51.100.7", createdAt: at(73), user: null },
  ]
  return { items: action ? items.filter((i) => i.action === action) : items, nextCursor: null }
}

/** ダッシュボードの表示設定（デモ表示中に保存したもの。ページを再読み込みすると既定に戻る） */
let mockDashboardPreference: DashboardPreference = {
  showTopSitesSection: false,
  // バックエンドの既定（services/preferencesService.ts の DASHBOARD_KPI_KEYS）と同じ
  kpiItems: ["roomRevenue", "soldRooms", "adr", "occupancyRate", "revPar", "guests", "dor", "guestUnitPrice"],
}

export function getMockDashboardPreference(): DashboardPreference {
  return mockDashboardPreference
}

export function setMockDashboardPreference(next: DashboardPreference): DashboardPreference {
  mockDashboardPreference = next
  return next
}
