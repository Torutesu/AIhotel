// デモモード用のサンプルデータ（D-13: 予測の準備状況・月別需要指数・外部要因の取得状況・日別予算）。
// NEXT_PUBLIC_DEMO_MODE=true でバックエンドに接続できないときだけ使われる（実データではない）。
// 形はバックエンドの GET /hotels/:id/forecast-readiness・/external-signals/demand-index・/external-signals/status・
// /settings/daily-budgets と同じ。

import type { DailyBudgetRow, DemandIndex, ExternalSignalsStatus, ForecastReadiness } from "./externalSignals"

/** デモのホテルは実績が揃っている前提（ダッシュボードには出ず、設定タブでは「準備完了」を見せる） */
export function mockForecastReadiness(hotelId: string): ForecastReadiness {
  return {
    hotelId,
    mode: "full",
    summary: "1年以上の実績と毎日の予約の記録があり、需要予測のすべての材料が揃っています。",
    historyDays: 730,
    openedOn: null,
    capabilities: [
      { key: "dayType", label: "日のタイプ（着地の4象限）", status: "active", detail: "平日・週末・特日ごとに過去の着地から型を作っています" },
      { key: "pacePattern", label: "ピックアップ型", status: "active", detail: "マイルストーン別のピックアップから 6 つの型に分けています" },
      { key: "lastYearPace", label: "前年ペース", status: "active", detail: "前年同曜日の予約の記録があります" },
      { key: "similarDays", label: "似た日の着地", status: "active", detail: "背景と入り方の近い過去の日から着地を出しています" },
      { key: "weather", label: "天気（気象庁）", status: "limited", detail: "予報区を都道府県から自動で決めています" },
      { key: "budget", label: "日別予算", status: "limited", detail: "日別予算が無いため、月の予算を日に配っています" },
    ],
  }
}

function addMonths(year: number, month: number, offset: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + offset, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

const iso = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`

// 月ごとの季節・イベント・市場の動き（サンプル。月の数字から決める）
const SEASONS: Record<number, string[]> = {
  1: ["年末年始", "受験"],
  2: ["受験", "春節"],
  3: ["春休み"],
  4: ["春休み", "GW"],
  5: ["GW"],
  7: ["夏休み"],
  8: ["夏休み", "お盆"],
  9: ["SW"],
  12: ["年末年始"],
}
const SEASONAL: Record<number, number> = { 1: 92, 2: 88, 3: 104, 4: 106, 5: 102, 6: 84, 7: 108, 8: 118, 9: 98, 10: 103, 11: 100, 12: 96 }

export function mockDemandIndex(months = 6, now: Date = new Date()): DemandIndex {
  const rows: DemandIndex["months"] = []
  for (let i = 0; i < months; i++) {
    const { year, month } = addMonths(now.getFullYear(), now.getMonth() + 1, i)
    const seasonal = SEASONAL[month] ?? 100
    const events: DemandIndex["months"][number]["events"] =
      month % 3 === 0
        ? [{ name: "市内の音楽フェス（サンプル）", startDate: iso(year, month, 14), endDate: iso(year, month, 15), expectedImpact: "high", source: "agent" }]
        : month % 2 === 0
          ? [{ name: "展示会（サンプル）", startDate: iso(year, month, 8), endDate: iso(year, month, 10), expectedImpact: "medium", source: "manual" }]
          : []
    const eventPt = events.reduce((sum, e) => sum + (e.expectedImpact === "high" ? 5 : 3), 0)
    const signals: DemandIndex["months"][number]["signals"] =
      i === 2 ? [{ kind: "inbound", title: "国際線の増便（サンプル）", direction: "up", magnitude: "medium" }] : []
    const market = i === 2 ? 3 : 0
    rows.push({
      year,
      month,
      index: seasonal + eventPt + market,
      components: { seasonal, events: eventPt, market },
      seasons: SEASONS[month] ?? [],
      events,
      signals,
    })
  }
  return { months: rows, basis: "100 = 直近1年の平均稼働。季節（前年同月）＋イベント＋市場の動き。市場の動きは推奨にも ±6pt まで効かせています（サンプル）" }
}

export function mockExternalSignalsStatus(now: Date = new Date()): ExternalSignalsStatus {
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()
  return {
    weather: { areaCode: "130000", reportedAt: daysAgo(0.2), daysAhead: 7 },
    holidays: { knownThrough: now.getFullYear() + 1 },
    agent: {
      enabled: true,
      intervalDays: 7,
      upcomingAgentEvents: 3,
      activeSignals: 1,
      recentRuns: [
        {
          startedAt: daysAgo(2),
          finishedAt: daysAgo(1.99),
          status: "succeeded",
          model: "claude",
          webSearches: 8,
          eventsSaved: 2,
          openingsSaved: 0,
          signalsSaved: 1,
          errorMessage: null,
        },
      ],
    },
  }
}

/** デモのホテルは日別予算を持たない（月の予算を配っている） */
export function mockDailyBudgets(): DailyBudgetRow[] {
  return []
}
