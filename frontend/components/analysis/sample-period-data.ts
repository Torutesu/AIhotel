"use client"

// 需要構成（利用人数別）・予約動向（リードタイム分析）のサンプルデータ（U-15 で analysis-tab.tsx から分割）
//
// 予約明細のモデルが無いため、利用人数別・リードタイム別・キャンセルの数値は
// すべて画面確認用のサンプル。表示側は必ず SampleDataNotice を併記すること。
// 2026-10 PDF c分析02・c分析03 の項目（販売室数〜前年同月比、CXL）と期間（121-180日前まで）に合わせている。

/** 利用人数別の1行（需要構成の表と同じ項目 — c分析02） */
export interface GuestCountSampleRow {
  guestCount: string
  soldRooms: number
  occupancy: number
  adr: number
  guestUnitPrice: number
  revenue: number
  revenueShare: number
  roomsShare: number
  dor: number
  avgNights: number
  yoy: number
}

/** リードタイム（予約期間）別の予約の1行（c分析03） */
export interface LeadTimeSampleRow {
  window: string
  /** その予約期間の時点での対象月の日に最も多かった日のタイプ（2026-10 xlsx 分析03） */
  dayType: string
  soldRooms: number
  occupancy: number
  adr: number
  guestUnitPrice: number
  revenue: number
  revenueShare: number
  cancelRate: number
  dor: number
  avgNights: number
  yoy: number
}

/** リードタイム別のキャンセルの1行（c分析03「予約データの下部に CXL データも同様に」） */
export interface CancelSampleRow {
  window: string
  rooms: number
  cancelRate: number
  adr: number
  guestUnitPrice: number
  revenue: number
  share: number
  dor: number
  avgNights: number
  yoy: number
}

const SAMPLE_TOTAL_ROOMS = 200

/** 予約期間（c分析03: 61-90・91-120・121-180日前を追加。181日以上前はヒアリング後） */
export const LEAD_TIME_WINDOWS = ["当日", "1-3日前", "4-7日前", "8-14日前", "15-30日前", "31-60日前", "61-90日前", "91-120日前", "121-180日前"] as const

const round1 = (v: number) => Math.round(v * 10) / 10

/** 月による季節の強さ（サンプル） */
function seasonOf(targetPeriod: string): { year: number; month: number; boost: number } {
  const [y, m] = targetPeriod.split("-").map(Number)
  const boost = [0.85, 0.88, 1.0, 1.05, 1.02, 0.92, 1.08, 1.15, 0.98, 1.0, 0.95, 1.06][(m - 1) % 12] ?? 1
  return { year: y, month: m, boost }
}

/** 対象期間に応じたサンプルデータ（利用人数別・リードタイム別・キャンセル）を生成する純粋関数。チャネル別・部屋タイプ別は実API（#88） */
export function buildPeriodData(targetPeriod: string) {
  const { year, month, boost } = seasonOf(targetPeriod)
  const days = new Date(year, month, 0).getDate()
  const capacity = SAMPLE_TOTAL_ROOMS * days
  const monthRooms = Math.round(capacity * 0.78 * boost)

  // 利用人数別（1室あたりの人数）。客単価 = 室料 ÷ 人数、DOR = 人数 ÷ 室数
  const guestDefs = [
    { guestCount: "1名", share: 0.44, adr: 15200, dor: 1.0, nights: 1.3, yoy: 4.2 },
    { guestCount: "2名", share: 0.38, adr: 21800, dor: 2.0, nights: 1.7, yoy: 9.8 },
    { guestCount: "3名", share: 0.12, adr: 26400, dor: 3.0, nights: 2.1, yoy: -2.6 },
    { guestCount: "4名以上", share: 0.06, adr: 31500, dor: 4.3, nights: 2.4, yoy: 12.1 },
  ]
  const guestRevenue = guestDefs.map((g) => Math.round(monthRooms * g.share) * Math.round(g.adr * boost))
  const guestRevenueTotal = guestRevenue.reduce((a, b) => a + b, 0)
  const guestCountData: GuestCountSampleRow[] = guestDefs.map((g, i) => {
    const soldRooms = Math.round(monthRooms * g.share)
    const adr = Math.round(g.adr * boost)
    return {
      guestCount: g.guestCount,
      soldRooms,
      occupancy: Math.round((soldRooms / capacity) * 1000) / 1000,
      adr,
      guestUnitPrice: Math.round(adr / g.dor),
      revenue: guestRevenue[i],
      revenueShare: round1((guestRevenue[i] / guestRevenueTotal) * 100),
      roomsShare: round1(g.share * 100),
      dor: g.dor,
      avgNights: g.nights,
      yoy: round1(g.yoy * boost),
    }
  })

  // リードタイム別の予約（早い予約ほど単価が高く、キャンセル率も高い）
  const leadDefs: Array<{ share: number; adr: number; cancel: number; dor: number; nights: number; yoy: number; dayType: string }> = [
    { share: 0.05, adr: 15400, cancel: 1.8, dor: 1.3, nights: 1.1, yoy: -3.5, dayType: "平日B型" },
    { share: 0.11, adr: 16800, cancel: 3.2, dor: 1.4, nights: 1.2, yoy: 5.2, dayType: "平日B型" },
    { share: 0.17, adr: 18100, cancel: 4.4, dor: 1.5, nights: 1.3, yoy: 8.7, dayType: "平日B型" },
    { share: 0.2, adr: 19000, cancel: 5.1, dor: 1.6, nights: 1.4, yoy: 12.3, dayType: "平日B型" },
    { share: 0.19, adr: 19700, cancel: 6.6, dor: 1.7, nights: 1.6, yoy: 15.8, dayType: "平日C型" },
    { share: 0.13, adr: 20400, cancel: 8.4, dor: 1.8, nights: 1.8, yoy: 18.2, dayType: "平日C型" },
    { share: 0.07, adr: 21000, cancel: 10.9, dor: 1.9, nights: 2.0, yoy: 21.4, dayType: "平日C型" },
    { share: 0.05, adr: 21400, cancel: 12.6, dor: 2.0, nights: 2.2, yoy: 24.0, dayType: "平日C型" },
    { share: 0.03, adr: 21900, cancel: 15.2, dor: 2.1, nights: 2.4, yoy: 27.5, dayType: "平日C型" },
  ]
  const leadRooms = leadDefs.map((l) => Math.round(monthRooms * l.share))
  const leadRevenue = leadDefs.map((l, i) => leadRooms[i] * Math.round(l.adr * boost))
  const leadRevenueTotal = leadRevenue.reduce((a, b) => a + b, 0)
  const bookingWindowData: LeadTimeSampleRow[] = LEAD_TIME_WINDOWS.map((window, i) => {
    const l = leadDefs[i]
    const adr = Math.round(l.adr * boost)
    return {
      window,
      dayType: l.dayType,
      soldRooms: leadRooms[i],
      occupancy: Math.round((leadRooms[i] / capacity) * 1000) / 1000,
      adr,
      guestUnitPrice: Math.round(adr / l.dor),
      revenue: leadRevenue[i],
      revenueShare: round1((leadRevenue[i] / leadRevenueTotal) * 100),
      cancelRate: l.cancel,
      dor: l.dor,
      avgNights: l.nights,
      yoy: round1(l.yoy * boost),
    }
  })

  // リードタイム別のキャンセル（室数 = 予約室数 × CXL率 ÷（1 − CXL率））
  const cancelRooms = leadDefs.map((l, i) => Math.round((leadRooms[i] * l.cancel) / (100 - l.cancel)))
  const cancelTotal = cancelRooms.reduce((a, b) => a + b, 0) || 1
  const cancelData: CancelSampleRow[] = LEAD_TIME_WINDOWS.map((window, i) => {
    const l = leadDefs[i]
    const adr = Math.round(l.adr * boost * 1.02)
    return {
      window,
      rooms: cancelRooms[i],
      cancelRate: l.cancel,
      adr,
      guestUnitPrice: Math.round(adr / l.dor),
      revenue: cancelRooms[i] * adr,
      share: round1((cancelRooms[i] / cancelTotal) * 100),
      dor: l.dor,
      avgNights: l.nights,
      yoy: round1(-l.yoy * 0.4),
    }
  })

  return { guestCountData, bookingWindowData, cancelData }
}
