"use client"

import { useState, useMemo, useEffect, useCallback, useRef, Fragment } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Skeleton } from "@/components/ui/skeleton"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"
import { format } from "date-fns"
import { ja } from "date-fns/locale/ja"
import { CalendarIcon, AlertCircle, RefreshCw, Download, ImageDown } from "lucide-react"

import { Tab } from "@shared/types"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type DashboardKpi, type AlertItem, type AiSummary } from "@/lib/api"

interface DashboardTabProps {
  onTabChange?: (tab: Tab) => void
}

const now = new Date()

// 在庫表（日別・タイプ別残室推移）用のモック定義。
// PMSでは過去時点の残室を確認できないため、日々の予約情報から残室推移を記録・表示する想定
const INVENTORY_ROOM_TYPES = [
  { key: "standard", label: "スタンダード", share: 0.6 },
  { key: "deluxe", label: "デラックス", share: 0.3 },
  { key: "suite", label: "スイート", share: 0.1 },
]

const SNAPSHOT_OPTIONS = [
  { value: "1", label: "前日時点" },
  { value: "7", label: "1週間前時点" },
  { value: "30", label: "1か月前時点" },
]

/**
 * ダッシュボードに表示するアラートの最小レベル（F-DASH-05）。
 * 重要度は1〜5の5段階で管理し、ダッシュボードにはLevel 5・4のみを表示する。
 * Level 3以下は各分析画面側で確認する運用。
 */
const DASHBOARD_MIN_ALERT_LEVEL = 4

// KPI進捗表に表示する指標（設定タブで施設ごとに選択。F-DASH-01）
const ALL_KPI_KEYS = [
  "roomRevenue",
  "soldRooms",
  "adr",
  "occupancyRate",
  "revPar",
  "guests",
  "dor",
  "guestUnitPrice",
] as const

const dashboardKpiItemsKey = (hotelId: string) => `dashboard.kpiItems.${hotelId}`

// KPI進捗の表示月数（開始月からの相対。F-DASH-01）
const MONTH_SPAN_OPTIONS = [
  { value: "1", label: "1か月" },
  { value: "3", label: "3か月" },
  { value: "6", label: "6か月" },
  { value: "12", label: "12か月" },
]

// KPI進捗の比較軸（F-DASH-02）
type ComparisonAxisKey = "toDate" | "cumulative" | "fiscalYear"

const COMPARISON_AXES: Array<{ key: ComparisonAxisKey; label: string; description: string }> = [
  { key: "toDate", label: "本日まで", description: "経過日数で按分した予算に対する進捗ペース" },
  { key: "cumulative", label: "累計進捗", description: "月間予算に対する現時点の到達率" },
  { key: "fiscalYear", label: "年度累計", description: "年度開始月から当月までの累計どうしの比較" },
]

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

function formatYen(value: number | null | undefined): string {
  if (value == null) return "-"
  return `¥${Math.round(value).toLocaleString()}`
}

function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null) return "-"
  return `${(value * 100).toFixed(digits)}%`
}

function formatRatio(actual: number | null | undefined, target: number | null | undefined): string {
  if (actual == null || target == null || target === 0) return "-"
  return `${((actual / target) * 100).toFixed(1)}%`
}

function ratioNegative(actual: number | null | undefined, target: number | null | undefined): boolean {
  if (actual == null || target == null || target === 0) return false
  return actual / target < 0.95
}

/**
 * 比較時点のKPIスナップショット（F-DASH-04）。
 * 予約は日々積み上がるため、過去時点ほど販売室数・売上が小さくなる想定で
 * 現在の実績から遡って生成する。対応APIが未整備のためモック値。
 */
interface KpiSnapshot {
  roomRevenue: number
  soldRooms: number
  adr: number
  occupancyRate: number
  revPar: number
}

function buildSnapshot(summary: DashboardKpi["summary"], daysAgo: number, seed: number): KpiSnapshot {
  const rng = createSeededRandom(seed)
  // 1日あたりの予約積み上がりペース（0.4〜0.9%/日）
  const pace = 0.004 + rng() * 0.005
  const pickup = Math.max(0.45, 1 - pace * Math.max(0, daysAgo))
  // ADRは日次で大きくは動かないため、変動幅を小さくする
  const adrShift = 1 - (rng() - 0.4) * 0.02 * Math.min(daysAgo / 7, 3)

  const soldRooms = Math.round(summary.soldRooms * pickup)
  const adr = Math.round(summary.adr * adrShift)
  const roomRevenue = soldRooms * adr
  const occupancyRate =
    summary.soldRooms > 0
      ? Number((summary.occupancyRate * pickup).toFixed(3))
      : 0
  const revPar = Math.round(adr * occupancyRate)

  return { roomRevenue, soldRooms, adr, occupancyRate, revPar }
}

/** 現在値と比較時点の差分を、表示用に整形した行にする */
function buildComparisonRows(summary: DashboardKpi["summary"], snapshot: KpiSnapshot) {
  const diff = (current: number, before: number) => current - before
  const rate = (current: number, before: number) =>
    before === 0 ? null : (current - before) / before

  return [
    {
      label: "室料売上",
      current: formatYen(summary.roomRevenue),
      before: formatYen(snapshot.roomRevenue),
      diffLabel: `${diff(summary.roomRevenue, snapshot.roomRevenue) >= 0 ? "+" : "-"}${formatYen(Math.abs(diff(summary.roomRevenue, snapshot.roomRevenue))).replace("¥", "¥")}`,
      diffRate: rate(summary.roomRevenue, snapshot.roomRevenue),
    },
    {
      label: "販売室数",
      current: `${summary.soldRooms.toLocaleString()}室`,
      before: `${snapshot.soldRooms.toLocaleString()}室`,
      diffLabel: `${diff(summary.soldRooms, snapshot.soldRooms) >= 0 ? "+" : ""}${diff(summary.soldRooms, snapshot.soldRooms).toLocaleString()}室`,
      diffRate: rate(summary.soldRooms, snapshot.soldRooms),
    },
    {
      label: "ADR",
      current: formatYen(summary.adr),
      before: formatYen(snapshot.adr),
      diffLabel: `${diff(summary.adr, snapshot.adr) >= 0 ? "+" : "-"}${formatYen(Math.abs(diff(summary.adr, snapshot.adr)))}`,
      diffRate: rate(summary.adr, snapshot.adr),
    },
    {
      label: "稼働率",
      current: formatPercent(summary.occupancyRate),
      before: formatPercent(snapshot.occupancyRate),
      diffLabel: `${summary.occupancyRate - snapshot.occupancyRate >= 0 ? "+" : ""}${((summary.occupancyRate - snapshot.occupancyRate) * 100).toFixed(1)}pt`,
      diffRate: rate(summary.occupancyRate, snapshot.occupancyRate),
    },
    {
      label: "REV-Per",
      current: formatYen(summary.revPar),
      before: formatYen(snapshot.revPar),
      diffLabel: `${diff(summary.revPar, snapshot.revPar) >= 0 ? "+" : "-"}${formatYen(Math.abs(diff(summary.revPar, snapshot.revPar)))}`,
      diffRate: rate(summary.revPar, snapshot.revPar),
    },
  ]
}

/** 月初比較・日付比較の表（F-DASH-04） */
function ComparisonTable({
  rows,
  beforeLabel,
  note,
}: {
  rows: ReturnType<typeof buildComparisonRows>
  beforeLabel: string
  note: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left py-1.5 px-2 font-medium border-r">指標</th>
              <th className="text-right py-1.5 px-2 font-medium border-r whitespace-nowrap">
                {beforeLabel}
              </th>
              <th className="text-right py-1.5 px-2 font-medium border-r">現在</th>
              <th className="text-right py-1.5 px-2 font-medium">増減</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b hover:bg-muted/20">
                <td className="py-1.5 px-2 font-medium border-r bg-muted/10 whitespace-nowrap">
                  {row.label}
                </td>
                <td className="text-right py-1.5 px-2 border-r text-muted-foreground whitespace-nowrap">
                  {row.before}
                </td>
                <td className="text-right py-1.5 px-2 border-r font-semibold whitespace-nowrap">
                  {row.current}
                </td>
                <td
                  className={`text-right py-1.5 px-2 whitespace-nowrap ${
                    row.diffRate == null
                      ? "text-muted-foreground"
                      : row.diffRate >= 0
                        ? "text-positive"
                        : "text-negative"
                  }`}
                >
                  {row.diffLabel}
                  {row.diffRate != null && (
                    <span className="ml-1 text-[10px]">
                      ({row.diffRate >= 0 ? "+" : ""}
                      {(row.diffRate * 100).toFixed(1)}%)
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground">※ {note}（数値はモックデータです）</p>
    </div>
  )
}

export function DashboardTab({ onTabChange }: DashboardTabProps) {
  const { hotelId } = useAuth()

  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  // 伸び率の高いサイトの表示/非表示設定（設定画面から制御。対応APIがないため表示のみ）
  const [showTopSitesSection, setShowTopSitesSection] = useState(false)

  // 在庫表の比較時点（残室推移の記録データと比較する想定。対応APIがないためモック表示）
  const [snapshotPeriod, setSnapshotPeriod] = useState("7")

  // KPI進捗の比較軸（F-DASH-02: 本日まで／累計進捗／年度累計）
  const [comparisonAxis, setComparisonAxis] = useState<ComparisonAxisKey>("toDate")

  // KPI進捗の表示月数（1/3/6/12か月。開始月＝上部で選択中の対象年月）
  const [monthSpan, setMonthSpan] = useState("1")
  // 複数月表示時の各月KPI（開始月ぶんは kpi をそのまま使う）
  const [spanKpis, setSpanKpis] = useState<DashboardKpi[]>([])
  const [spanLoading, setSpanLoading] = useState(false)

  // 設定タブで選択されたKPI表示項目（施設ごと。未保存なら全項目）
  const [visibleKpiKeys, setVisibleKpiKeys] = useState<string[]>([...ALL_KPI_KEYS])

  // 日付比較設定（対応APIがないため参考値表示のまま）
  const [comparisonType, setComparisonType] = useState<"previousDay" | "weekAgo" | "lastMonth" | "custom">("previousDay")
  const [customComparisonDate, setCustomComparisonDate] = useState<Date | undefined>(undefined)

  const [kpi, setKpi] = useState<DashboardKpi | null>(null)
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null)
  const [totalRooms, setTotalRooms] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 画像エクスポート時に描画済みSVGを取得するためのラッパー参照
  const chartWrapperRef = useRef<HTMLDivElement>(null)

  const comparisonDate = useMemo(() => {
    const base = new Date()
    switch (comparisonType) {
      case "previousDay": {
        const d = new Date(base)
        d.setDate(d.getDate() - 1)
        return d
      }
      case "weekAgo": {
        const d = new Date(base)
        d.setDate(d.getDate() - 7)
        return d
      }
      case "lastMonth": {
        const d = new Date(base)
        d.setMonth(d.getMonth() - 1)
        return d
      }
      case "custom":
        return customComparisonDate || base
      default:
        return base
    }
  }, [comparisonType, customComparisonDate])

  useEffect(() => {
    const loadSettings = () => {
      if (typeof window === "undefined") return
      const savedTopSites = localStorage.getItem("dashboard.showTopSitesSection")
      setShowTopSitesSection(savedTopSites === "true")

      // KPI表示項目（設定タブで施設ごとに保存。未保存・不正値なら全項目）
      if (!hotelId) return
      const raw = localStorage.getItem(dashboardKpiItemsKey(hotelId))
      if (!raw) {
        setVisibleKpiKeys([...ALL_KPI_KEYS])
        return
      }
      try {
        const parsed = JSON.parse(raw)
        const valid = Array.isArray(parsed)
          ? parsed.filter((k): k is string => ALL_KPI_KEYS.includes(k as (typeof ALL_KPI_KEYS)[number]))
          : []
        setVisibleKpiKeys(valid.length > 0 ? valid : [...ALL_KPI_KEYS])
      } catch {
        setVisibleKpiKeys([...ALL_KPI_KEYS])
      }
    }
    loadSettings()
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "dashboard.showTopSitesSection" || e.key?.startsWith("dashboard.kpiItems.")) {
        loadSettings()
      }
    }
    window.addEventListener("storage", handleStorageChange)
    window.addEventListener("settingsUpdated", loadSettings)
    return () => {
      window.removeEventListener("storage", handleStorageChange)
      window.removeEventListener("settingsUpdated", loadSettings)
    }
  }, [hotelId])

  const loadData = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      const [kpiResult, alertsResult, summaryResult, hotels] = await Promise.all([
        api.dashboardKpi(hotelId, year, month),
        // ダッシュボードはLevel 5・4のみ表示（F-DASH-05）。Level 3以下は各分析画面で確認する
        api.alerts(hotelId, DASHBOARD_MIN_ALERT_LEVEL),
        api.aiSummary(hotelId),
        api.hotels(),
      ])
      setKpi(kpiResult)
      setAlerts(alertsResult)
      setAiSummary(summaryResult)
      setTotalRooms(hotels.find((h) => h.id === hotelId)?.totalRooms ?? null)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "データの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId, year, month])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 複数月表示（F-DASH-01）: 開始月からNか月ぶんを単月APIの並列取得で組み立てる
  useEffect(() => {
    const span = Number(monthSpan)
    if (!hotelId || span <= 1) {
      setSpanKpis([])
      return
    }
    let cancelled = false
    setSpanLoading(true)
    const targets = Array.from({ length: span }, (_, i) => {
      const offset = month - 1 + i
      return { year: year + Math.floor(offset / 12), month: (offset % 12) + 1 }
    })
    Promise.all(targets.map((t) => api.dashboardKpi(hotelId, t.year, t.month)))
      .then((results) => {
        if (!cancelled) setSpanKpis(results)
      })
      .catch(() => {
        // 単月表示は成功しているため、複数月ぶんの取得失敗時は単月表示にフォールバックする
        if (!cancelled) setSpanKpis([])
      })
      .finally(() => {
        if (!cancelled) setSpanLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [hotelId, year, month, monthSpan])

  const todayKey = format(new Date(), "yyyy-MM-dd")

  // 稼働率・ADRの月間推移チャートデータ（実績→予測の連続系列）
  const trendChartData = useMemo(() => {
    if (!kpi) return []
    const rows = kpi.dailyTrend
    return rows.map((row, idx) => {
      const next = rows[idx + 1]
      const isBoundary = row.isActual && !!next && !next.isActual
      const [, m, d] = row.date.split("-")
      return {
        date: `${Number(m)}/${Number(d)}`,
        rawDate: row.date,
        occupancyActual: row.isActual && row.occupancy != null ? Math.round(row.occupancy * 1000) / 10 : null,
        adrActual: row.isActual ? row.adr : null,
        occupancyForecast: !row.isActual
          ? row.predictedOccupancy != null
            ? Math.round(row.predictedOccupancy * 1000) / 10
            : null
          : isBoundary && row.occupancy != null
            ? Math.round(row.occupancy * 1000) / 10
            : null,
        adrForecast: !row.isActual ? row.predictedAdr : isBoundary ? row.adr : null,
        occupancyLastYear:
          row.lastYearOccupancy != null ? Math.round(row.lastYearOccupancy * 1000) / 10 : null,
        adrLastYear: row.lastYearAdr,
        isToday: row.date === todayKey,
      }
    })
  }, [kpi, todayKey])

  // グラフに引く予算・目標の水平線（F-DASH-03）。月次予算が未登録なら非表示
  const budgetOccupancyLine = useMemo(() => {
    const value = kpi?.comparison?.budgetOccupancy
    return value != null ? Math.round(value * 1000) / 10 : null
  }, [kpi])
  const budgetAdrLine = kpi?.comparison?.budgetAdr ?? null

  const hasLastYearTrend = useMemo(
    () => trendChartData.some((d) => d.occupancyLastYear != null || d.adrLastYear != null),
    [trendChartData]
  )

  // グラフのCSVエクスポート（日付・稼働率・ADR・予測・前年）
  const exportTrendCsv = useCallback(() => {
    if (trendChartData.length === 0) return
    const header = ["日付", "稼働率(%)", "ADR(円)", "予測稼働率(%)", "予測ADR(円)", "前年稼働率(%)", "前年ADR(円)"]
    const rows = trendChartData.map((d) => [
      d.rawDate,
      d.occupancyActual ?? "",
      d.adrActual ?? "",
      d.occupancyForecast ?? "",
      d.adrForecast ?? "",
      d.occupancyLastYear ?? "",
      d.adrLastYear ?? "",
    ])
    const csv = [header, ...rows].map((cols) => cols.join(",")).join("\r\n")
    // Excelで文字化けしないようBOM付きUTF-8で出力
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `稼働ADR月間推移_${year}-${String(month).padStart(2, "0")}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }, [trendChartData, year, month])

  // グラフのPNGエクスポート（描画済みSVGをcanvasに転写。追加ライブラリ不要）
  const exportTrendImage = useCallback(() => {
    const svg = chartWrapperRef.current?.querySelector("svg")
    if (!svg) return
    const clone = svg.cloneNode(true) as SVGSVGElement
    const { width, height } = svg.getBoundingClientRect()
    clone.setAttribute("width", String(width))
    clone.setAttribute("height", String(height))
    // 背景が透過だと黒背景で見えなくなるため白地を敷く
    clone.style.background = "#ffffff"
    const source = new XMLSerializer().serializeToString(clone)
    const svgUrl = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }))

    const image = new Image()
    image.onload = () => {
      const scale = 2 // 資料貼り付け用に2倍解像度
      const canvas = document.createElement("canvas")
      canvas.width = width * scale
      canvas.height = height * scale
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        URL.revokeObjectURL(svgUrl)
        return
      }
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(svgUrl)
      canvas.toBlob((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = `稼働ADR月間推移_${year}-${String(month).padStart(2, "0")}.png`
        link.click()
        URL.revokeObjectURL(url)
      }, "image/png")
    }
    image.onerror = () => URL.revokeObjectURL(svgUrl)
    image.src = svgUrl
  }, [year, month])

  // 月初比較（F-DASH-04）: 選択中の対象月の1日時点と現在を比較する
  const monthStartComparison = useMemo(() => {
    if (!kpi) return null
    const monthStart = new Date(year, month - 1, 1)
    const base = new Date()
    // 選択中の月が過去なら月末まで、当月なら本日までの経過日数
    const monthEnd = new Date(year, month, 0)
    const until = base < monthEnd ? base : monthEnd
    const daysAgo = Math.max(
      1,
      Math.round((until.getTime() - monthStart.getTime()) / 86400000)
    )
    const snapshot = buildSnapshot(kpi.summary, daysAgo, year * 100 + month)
    return { snapshot, daysAgo, rows: buildComparisonRows(kpi.summary, snapshot) }
  }, [kpi, year, month])

  // 日付比較（F-DASH-04）: 選択した比較日と現在を比較する
  const dateComparison = useMemo(() => {
    if (!kpi) return null
    const base = new Date()
    const daysAgo = Math.max(
      1,
      Math.round((base.getTime() - comparisonDate.getTime()) / 86400000)
    )
    const seed =
      comparisonDate.getFullYear() * 10000 +
      (comparisonDate.getMonth() + 1) * 100 +
      comparisonDate.getDate()
    const snapshot = buildSnapshot(kpi.summary, daysAgo, seed)
    return { snapshot, daysAgo, rows: buildComparisonRows(kpi.summary, snapshot) }
  }, [kpi, comparisonDate])

  // 表示中の比較軸（F-DASH-02: 本日まで／累計進捗／年度累計）
  const axis = useMemo(() => {
    if (!kpi?.comparison) return null
    return kpi.comparison[comparisonAxis] ?? null
  }, [kpi, comparisonAxis])

  // KPI進捗テーブル用の行（実データのみ。バックエンドが提供しない比較値は「-」表示）
  const kpiRows = useMemo(() => {
    if (!kpi) return []
    const { summary, comparison, simulation } = kpi
    // 年度累計軸では実績側も年度累計値を使う
    const isFiscal = comparisonAxis === "fiscalYear"
    const revenueActual = isFiscal
      ? (comparison?.actualSummary.fiscalRevenue ?? summary.roomRevenue)
      : summary.roomRevenue
    const adrActual = isFiscal ? (comparison?.actualSummary.fiscalAdr ?? summary.adr) : summary.adr
    const occupancyActual = isFiscal
      ? (comparison?.actualSummary.fiscalOccupancy ?? summary.occupancyRate)
      : summary.occupancyRate

    return [
      {
        key: "roomRevenue",
        label: "室料売上",
        actual: formatYen(revenueActual),
        budgetRatio: axis?.budgetRevenueRatio != null ? formatPercent(axis.budgetRevenueRatio) : "-",
        budgetNegative: axis?.budgetRevenueRatio != null && axis.budgetRevenueRatio < 0.95,
        lastYearRatio: axis?.lastYearRevenueRatio != null ? formatPercent(axis.lastYearRevenueRatio) : "-",
        lastYearNegative: axis?.lastYearRevenueRatio != null && axis.lastYearRevenueRatio < 0.95,
        aiPrediction: formatYen(simulation?.projectedRevenue),
        aiBudgetRatio: formatRatio(simulation?.projectedRevenue, comparison?.budgetRevenue),
        aiBudgetNegative: ratioNegative(simulation?.projectedRevenue, comparison?.budgetRevenue),
        aiLastYearRatio: formatRatio(simulation?.projectedRevenue, comparison?.lastYearRevenue),
        aiLastYearNegative: ratioNegative(simulation?.projectedRevenue, comparison?.lastYearRevenue),
      },
      {
        key: "soldRooms",
        label: "販売室数",
        actual: `${summary.soldRooms.toLocaleString()}室`,
        budgetRatio: "-",
        budgetNegative: false,
        lastYearRatio: "-",
        lastYearNegative: false,
        aiPrediction: "-",
        aiBudgetRatio: "-",
        aiBudgetNegative: false,
        aiLastYearRatio: "-",
        aiLastYearNegative: false,
      },
      {
        key: "adr",
        label: "ADR",
        actual: formatYen(adrActual),
        budgetRatio: axis?.budgetAdrRatio != null ? formatPercent(axis.budgetAdrRatio) : "-",
        budgetNegative: axis?.budgetAdrRatio != null && axis.budgetAdrRatio < 0.95,
        lastYearRatio: axis?.lastYearAdrRatio != null ? formatPercent(axis.lastYearAdrRatio) : "-",
        lastYearNegative: axis?.lastYearAdrRatio != null && axis.lastYearAdrRatio < 0.95,
        aiPrediction: formatYen(simulation?.projectedAdr),
        aiBudgetRatio: formatRatio(simulation?.projectedAdr, comparison?.budgetAdr),
        aiBudgetNegative: ratioNegative(simulation?.projectedAdr, comparison?.budgetAdr),
        aiLastYearRatio: formatRatio(simulation?.projectedAdr, comparison?.lastYearAdr),
        aiLastYearNegative: ratioNegative(simulation?.projectedAdr, comparison?.lastYearAdr),
      },
      {
        key: "occupancyRate",
        label: "稼働率",
        actual: formatPercent(occupancyActual),
        budgetRatio: axis?.budgetOccupancyRatio != null ? formatPercent(axis.budgetOccupancyRatio) : "-",
        budgetNegative: axis?.budgetOccupancyRatio != null && axis.budgetOccupancyRatio < 0.95,
        lastYearRatio:
          axis?.lastYearOccupancyRatio != null ? formatPercent(axis.lastYearOccupancyRatio) : "-",
        lastYearNegative: axis?.lastYearOccupancyRatio != null && axis.lastYearOccupancyRatio < 0.95,
        aiPrediction: formatPercent(simulation?.projectedOccupancy),
        aiBudgetRatio: formatRatio(simulation?.projectedOccupancy, comparison?.budgetOccupancy),
        aiBudgetNegative: ratioNegative(simulation?.projectedOccupancy, comparison?.budgetOccupancy),
        aiLastYearRatio: formatRatio(simulation?.projectedOccupancy, comparison?.lastYearOccupancy),
        aiLastYearNegative: ratioNegative(simulation?.projectedOccupancy, comparison?.lastYearOccupancy),
      },
      {
        key: "revPar",
        label: "REV-Per",
        actual: formatYen(summary.revPar),
        budgetRatio: "-",
        budgetNegative: false,
        lastYearRatio: "-",
        lastYearNegative: false,
        aiPrediction: formatYen(simulation?.projectedRevPar),
        aiBudgetRatio: "-",
        aiBudgetNegative: false,
        aiLastYearRatio: "-",
        aiLastYearNegative: false,
      },
      {
        key: "guests",
        label: "宿泊人数",
        actual: `${summary.guests.toLocaleString()}人`,
        budgetRatio: "-",
        budgetNegative: false,
        lastYearRatio: "-",
        lastYearNegative: false,
        aiPrediction: "-",
        aiBudgetRatio: "-",
        aiBudgetNegative: false,
        aiLastYearRatio: "-",
        aiLastYearNegative: false,
      },
      {
        key: "dor",
        label: "DOR",
        actual: `${summary.dor.toFixed(2)}人`,
        budgetRatio: "-",
        budgetNegative: false,
        lastYearRatio: "-",
        lastYearNegative: false,
        aiPrediction: "-",
        aiBudgetRatio: "-",
        aiBudgetNegative: false,
        aiLastYearRatio: "-",
        aiLastYearNegative: false,
      },
      {
        key: "guestUnitPrice",
        label: "客単価",
        actual: formatYen(summary.guestUnitPrice),
        budgetRatio: "-",
        budgetNegative: false,
        lastYearRatio: "-",
        lastYearNegative: false,
        aiPrediction: "-",
        aiBudgetRatio: "-",
        aiBudgetNegative: false,
        aiLastYearRatio: "-",
        aiLastYearNegative: false,
      },
    ]
  }, [kpi, comparisonAxis, axis])

  // 設定タブで選択された表示項目のみに絞る（F-DASH-01）
  const visibleKpiRows = useMemo(
    () => kpiRows.filter((row) => visibleKpiKeys.includes(row.key)),
    [kpiRows, visibleKpiKeys]
  )

  // 複数月表示（F-DASH-01）: 指標×月のマトリクス。実績値のみを月ごとに並べる
  const multiMonthTable = useMemo(() => {
    if (Number(monthSpan) <= 1 || spanKpis.length === 0) return null

    const columns = spanKpis.map((k) => ({
      key: `${k.year}-${k.month}`,
      label: `${k.year}/${String(k.month).padStart(2, "0")}`,
    }))

    const formatters: Record<string, (k: DashboardKpi) => string> = {
      roomRevenue: (k) => formatYen(k.summary.roomRevenue),
      soldRooms: (k) => `${k.summary.soldRooms.toLocaleString()}室`,
      adr: (k) => formatYen(k.summary.adr),
      occupancyRate: (k) => formatPercent(k.summary.occupancyRate),
      revPar: (k) => formatYen(k.summary.revPar),
      guests: (k) => `${k.summary.guests.toLocaleString()}人`,
      dor: (k) => `${k.summary.dor.toFixed(2)}人`,
      guestUnitPrice: (k) => formatYen(k.summary.guestUnitPrice),
    }

    const labels: Record<string, string> = {
      roomRevenue: "室料売上",
      soldRooms: "販売室数",
      adr: "ADR",
      occupancyRate: "稼働率",
      revPar: "REV-Per",
      guests: "宿泊人数",
      dor: "DOR",
      guestUnitPrice: "客単価",
    }

    const rows = ALL_KPI_KEYS.filter((key) => visibleKpiKeys.includes(key)).map((key) => ({
      key,
      label: labels[key],
      values: spanKpis.map((k) => formatters[key](k)),
    }))

    return { columns, rows }
  }, [monthSpan, spanKpis, visibleKpiKeys])

  // 在庫表（日別・タイプ別残室と比較時点との差分）。日付から決定的に導出するモックデータ
  const inventoryRows = useMemo(() => {
    const rooms = totalRooms ?? 300
    const periodDays = Number(snapshotPeriod)
    const base = new Date()
    return Array.from({ length: 14 }, (_, i) => {
      const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)
      const dow = date.getDay()
      const weekend = dow === 5 || dow === 6
      const rng = createSeededRandom(date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate())
      const types = INVENTORY_ROOM_TYPES.map((t) => {
        const capacity = Math.round(rooms * t.share)
        const occ = Math.min(0.98, Math.max(0.2, (weekend ? 0.88 : 0.66) - i * 0.015 + (rng() - 0.5) * 0.1))
        const remaining = Math.max(0, Math.round(capacity * (1 - occ)))
        // 比較時点の残室（過去ほど残室が多い＝その後の予約進捗ぶん）
        const pace = capacity * (0.005 + rng() * 0.02)
        const snapshotRemaining = Math.min(capacity, remaining + Math.round(pace * periodDays))
        return { key: t.key, label: t.label, capacity, remaining, diff: remaining - snapshotRemaining }
      })
      const totalRemaining = types.reduce((a, t) => a + t.remaining, 0)
      const totalDiff = types.reduce((a, t) => a + t.diff, 0)
      return { date, dow, types, totalRemaining, totalDiff }
    })
  }, [totalRooms, snapshotPeriod])

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">{payload[0].payload.date}</p>
          <div className="space-y-1">
            <p className="text-xs flex items-center gap-2">
              <span className="w-3 h-0.5 bg-[color:var(--chart-1)]"></span>
              <span>稼働率: {payload[0].value != null ? `${payload[0].value.toFixed(1)}%` : "-"}</span>
            </p>
            <p className="text-xs flex items-center gap-2">
              <span className="w-3 h-0.5 bg-[color:var(--chart-3)]"></span>
              <span>ADR: {payload[1]?.value != null ? `¥${Math.round(payload[1].value).toLocaleString()}` : "-"}</span>
            </p>
          </div>
        </div>
      )
    }
    return null
  }

  // アラート重要度（1-5の5段階）。ダッシュボードはLevel 5・4のみ表示する（F-DASH-05）
  const alertLevelStyles: Record<number, { border: string; bg: string; dot: string; label: string; text: string }> = {
    5: {
      border: "border-negative",
      bg: "bg-negative/10",
      dot: "bg-negative",
      label: "Level 5 / すぐに修正する",
      text: "text-negative",
    },
    4: {
      border: "border-warning",
      bg: "bg-warning/10",
      dot: "bg-warning",
      label: "Level 4 / 1週間内での経過観察が必要",
      text: "text-warning",
    },
  }

  // level未設定の旧データはseverityから補完する
  const resolveAlertLevel = (alert: AlertItem): number =>
    alert.level ?? (alert.severity === "RED" ? 5 : 4)

  const alertStyleFor = (alert: AlertItem) => {
    const level = resolveAlertLevel(alert)
    return (
      alertLevelStyles[level] ?? {
        border: "border-border",
        bg: "bg-muted/50",
        dot: "bg-muted-foreground",
        label: `Level ${level}`,
        text: "text-muted-foreground",
      }
    )
  }

  if (!hotelId) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">ホテル情報を読み込んでいます...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
            <AlertCircle className="w-8 h-8 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={loadData} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              再試行
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-4">
        {/* 対象年月選択 */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs whitespace-nowrap">対象年</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-24 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}年
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-xs whitespace-nowrap">対象月</Label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-20 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {i + 1}月
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {totalRooms != null && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-md ml-auto">
              <p className="text-xs text-muted-foreground">客室数</p>
              <div className="text-lg font-bold">
                {totalRooms.toLocaleString()}
                <span className="text-sm font-semibold ml-0.5">室</span>
              </div>
            </div>
          )}
        </div>

        {/* アラートセクション - 一番上に配置 */}
        <Card>
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-lg font-semibold">アラート</CardTitle>
              <p className="text-xs text-muted-foreground">
                重要度5段階のうち Level 5・4 を表示（Level 3以下は各分析画面で確認）
              </p>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                現在、対応が必要なアラート（Level 5・4）はありません。
              </p>
            ) : (
              <div className="space-y-3">
                {alerts.map((alert) => {
                  const style = alertStyleFor(alert)
                  return (
                    <div key={alert.id} className={`border-l-4 ${style.border} ${style.bg} p-3 rounded-r`}>
                      <div className="flex items-start gap-2">
                        <div className={`w-3 h-3 rounded-full ${style.dot} mt-1 flex-shrink-0`}></div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className={`text-xs font-semibold ${style.text}`}>{style.label}</span>
                            {alert.linkTab && (
                              <button
                                onClick={() => onTabChange?.(alert.linkTab as Tab)}
                                className="text-xs text-primary hover:underline hover:text-[color:var(--cyan-edge)] transition-colors"
                              >
                                {alert.targetDate ? format(new Date(alert.targetDate), "yyyy/MM/dd") : ""}
                                {alert.linkTab === "pricing" && " (料金設定へ)"}
                                {alert.linkTab === "daily" && " (日別分析へ)"}
                                {alert.linkTab === "analysis" && " (各種分析へ)"}
                              </button>
                            )}
                          </div>
                          <p className={`text-sm ${style.text.replace("700", "800").replace("400", "300")}`}>
                            {alert.title}: {alert.message}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI解説セクション */}
        <Card className="bg-[color:var(--sky-wash)]/25 border-[color:var(--cyan-edge)]/40">
          <CardHeader className="pb-1">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <span className="text-xl">🤖</span>
              AI解説
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : aiSummary?.content ? (
              <p className="max-h-60 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap">
                {aiSummary.content}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">この月のAIまとめはまだ生成されていません。</p>
            )}
          </CardContent>
        </Card>

        {/* 稼働・ADR月間推移 */}
        <Card>
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-lg font-semibold">稼働・ADR月間推移</CardTitle>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={exportTrendCsv}
                  disabled={loading || trendChartData.length === 0}
                >
                  <Download className="h-3 w-3" />
                  CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={exportTrendImage}
                  disabled={loading || trendChartData.length === 0}
                >
                  <ImageDown className="h-3 w-3" />
                  画像
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : trendChartData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">この月のデータがありません。</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-0.5 bg-[color:var(--chart-1)]"></div>
                      <span className="font-medium text-xs">稼働率</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-0.5 bg-[color:var(--chart-3)]"></div>
                      <span className="font-medium text-xs">ADR</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="w-4 h-0.5 bg-muted-foreground"></span>実線＝実績
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span
                        className="w-4 border-t border-dashed border-muted-foreground"
                        aria-hidden
                      ></span>
                      点線＝予測
                    </span>
                    {hasLastYearTrend && (
                      <span className="flex items-center gap-1.5">
                        <span className="w-4 h-0.5 bg-[color:var(--chart-5)] opacity-70"></span>
                        前年実績
                      </span>
                    )}
                    {(budgetOccupancyLine != null || budgetAdrLine != null) && (
                      <span className="flex items-center gap-1.5">
                        <span
                          className="w-4 border-t-2 border-dotted border-[color:var(--chart-4)]"
                          aria-hidden
                        ></span>
                        予算・目標
                      </span>
                    )}
                  </div>
                </div>

                <div ref={chartWrapperRef}>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trendChartData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      interval={2}
                      stroke="currentColor"
                      opacity={0.6}
                      label={{ value: "日付", position: "insideBottom", offset: -5, style: { textAnchor: "middle", fontSize: 12 } }}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 12 }}
                      stroke="currentColor"
                      opacity={0.6}
                      tickFormatter={(value) => `${value}%`}
                      label={{ value: "稼働率", angle: -90, position: "insideLeft", style: { textAnchor: "middle", fontSize: 12 } }}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 12 }}
                      stroke="currentColor"
                      opacity={0.6}
                      tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                      label={{ value: "ADR（円）", angle: 90, position: "insideRight", style: { textAnchor: "middle", fontSize: 12 } }}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    {trendChartData.find((d) => d.isToday) && (
                      <ReferenceLine
                        x={trendChartData.find((d) => d.isToday)?.date}
                        stroke="#666"
                        strokeDasharray="5 5"
                        strokeWidth={1.5}
                        label={{ value: `本日 ${trendChartData.find((d) => d.isToday)?.date}`, position: "top", fill: "#666", fontSize: 11 }}
                      />
                    )}
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="occupancyActual"
                      stroke="var(--chart-1)"
                      strokeWidth={2.5}
                      dot={false}
                      name="稼働率"
                      activeDot={{ r: 6 }}
                      connectNulls={false}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="occupancyForecast"
                      stroke="var(--chart-1)"
                      strokeWidth={2.5}
                      strokeDasharray="5 5"
                      dot={false}
                      name="稼働率（予測）"
                      activeDot={{ r: 6 }}
                      connectNulls={false}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="adrActual"
                      stroke="var(--chart-3)"
                      strokeWidth={2.5}
                      dot={false}
                      name="ADR"
                      activeDot={{ r: 6 }}
                      connectNulls={false}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="adrForecast"
                      stroke="var(--chart-3)"
                      strokeWidth={2.5}
                      strokeDasharray="5 5"
                      dot={false}
                      name="ADR（予測）"
                      activeDot={{ r: 6 }}
                      connectNulls={false}
                    />
                    {/* 前年実績（細線で背面に重ねる） */}
                    {hasLastYearTrend && (
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="occupancyLastYear"
                        stroke="var(--chart-5)"
                        strokeWidth={1.5}
                        strokeOpacity={0.7}
                        dot={false}
                        name="稼働率（前年）"
                        activeDot={{ r: 4 }}
                        connectNulls
                      />
                    )}
                    {hasLastYearTrend && (
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="adrLastYear"
                        stroke="var(--chart-5)"
                        strokeWidth={1.5}
                        strokeOpacity={0.7}
                        strokeDasharray="2 3"
                        dot={false}
                        name="ADR（前年）"
                        activeDot={{ r: 4 }}
                        connectNulls
                      />
                    )}
                    {/* 予算・目標の水平線（月次予算が登録されている場合のみ） */}
                    {budgetOccupancyLine != null && (
                      <ReferenceLine
                        yAxisId="left"
                        y={budgetOccupancyLine}
                        stroke="var(--chart-4)"
                        strokeDasharray="2 2"
                        strokeWidth={1.5}
                        label={{
                          value: `予算稼働率 ${budgetOccupancyLine.toFixed(1)}%`,
                          position: "insideTopLeft",
                          fill: "var(--chart-4)",
                          fontSize: 10,
                        }}
                      />
                    )}
                    {budgetAdrLine != null && (
                      <ReferenceLine
                        yAxisId="right"
                        y={budgetAdrLine}
                        stroke="var(--chart-4)"
                        strokeDasharray="2 2"
                        strokeWidth={1.5}
                        label={{
                          value: `予算ADR ¥${Math.round(budgetAdrLine).toLocaleString()}`,
                          position: "insideBottomRight",
                          fill: "var(--chart-4)",
                          fontSize: 10,
                        }}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 月初比較・日付比較（F-DASH-04）。対応APIが未整備のため現在の実績から遡ったモック値 */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-lg font-semibold">月初比較・日付比較</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-sm font-medium text-muted-foreground">月初比較</h3>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">vs {month}月1日</span>
                </div>
                {loading ? (
                  <Skeleton className="h-40 w-full" />
                ) : monthStartComparison ? (
                  <ComparisonTable
                    rows={monthStartComparison.rows}
                    beforeLabel={`${month}/1時点`}
                    note={`${month}月1日から${monthStartComparison.daysAgo}日分の積み上がり`}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">データがありません。</p>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-sm font-medium text-muted-foreground">日付比較</h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select
                      value={comparisonType}
                      onValueChange={(value: "previousDay" | "weekAgo" | "lastMonth" | "custom") => {
                        setComparisonType(value)
                        if (value !== "custom") {
                          setCustomComparisonDate(undefined)
                        }
                      }}
                    >
                      <SelectTrigger className="w-32 h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="previousDay">前日</SelectItem>
                        <SelectItem value="weekAgo">1週間前</SelectItem>
                        <SelectItem value="lastMonth">先月同日</SelectItem>
                        <SelectItem value="custom">日付選択</SelectItem>
                      </SelectContent>
                    </Select>
                    {comparisonType === "custom" && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-7 text-xs">
                            <CalendarIcon className="mr-1 h-3 w-3" />
                            {customComparisonDate ? format(customComparisonDate, "M/d", { locale: ja }) : "選択"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                          <Calendar mode="single" selected={customComparisonDate} onSelect={(date) => setCustomComparisonDate(date)} initialFocus />
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="whitespace-nowrap">vs {format(comparisonDate, "M月d日", { locale: ja })}</span>
                </div>
                {loading ? (
                  <Skeleton className="h-40 w-full" />
                ) : dateComparison ? (
                  <ComparisonTable
                    rows={dateComparison.rows}
                    beforeLabel={format(comparisonDate, "M/d時点", { locale: ja })}
                    note={`${dateComparison.daysAgo}日前との比較`}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">データがありません。</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 伸び率の高いサイト上位3件（設定で有効化された場合のみ・対応APIなし） */}
        {showTopSitesSection && (
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-lg font-semibold">伸び率の高いサイト上位3件</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground">この機能は今後提供予定です。</p>
            </CardContent>
          </Card>
        )}

        {/* KPI進捗状況 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-heading font-medium tracking-tight">KPI進捗状況</h2>
            <div className="flex items-center gap-3 flex-wrap">
              {/* 開始月は上部の対象年月。ここでは表示月数を選ぶ（F-DASH-01） */}
              <div className="flex items-center gap-1.5">
                <Label className="text-xs whitespace-nowrap">
                  {year}年{month}月から
                </Label>
                <Select value={monthSpan} onValueChange={setMonthSpan}>
                  <SelectTrigger className="h-7 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_SPAN_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                {kpi
                  ? comparisonAxis === "fiscalYear" && kpi.comparison
                    ? `${kpi.comparison.actualSummary.fiscalActualDays}日分の実績を集計（年度累計）`
                    : `${kpi.summary.actualDays}日分の実績を集計`
                  : ""}
              </p>
            </div>
          </div>

          {/* 比較軸の切り替え（F-DASH-02） */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              {COMPARISON_AXES.map((option) => (
                <button
                  key={option.key}
                  onClick={() => setComparisonAxis(option.key)}
                  title={option.description}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    comparisonAxis === option.key
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {option.key === "fiscalYear" && kpi?.comparison
                    ? kpi.comparison.fiscalYearLabel
                    : option.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {COMPARISON_AXES.find((o) => o.key === comparisonAxis)?.description}
            </p>
          </div>

          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : kpi ? (
            <Card>
              <CardContent className="p-0 pt-2 pb-2">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-center py-1.5 px-2 font-medium border-r">指標</th>
                        <th className="text-center py-1.5 px-2 font-medium border-r">
                          {comparisonAxis === "fiscalYear" ? "年度累計実績" : "当月実績"}
                        </th>
                        <th className="text-center py-1.5 px-2 font-medium border-r">
                          予算比（{COMPARISON_AXES.find((o) => o.key === comparisonAxis)?.label}）
                        </th>
                        <th className="text-center py-1.5 px-2 font-medium border-r">
                          前年比（{COMPARISON_AXES.find((o) => o.key === comparisonAxis)?.label}）
                        </th>
                        <th className="text-center py-1.5 px-2 font-medium border-r">AI着地予測</th>
                        <th className="text-center py-1.5 px-2 font-medium border-r">対予算(AI)</th>
                        <th className="text-center py-1.5 px-2 font-medium">対前年(AI)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleKpiRows.map((row) => (
                        <tr key={row.label} className="border-b hover:bg-muted/20">
                          <td className="py-1.5 px-2 font-medium border-r bg-muted/10">{row.label}</td>
                          <td className="text-right py-1.5 px-2 font-semibold border-r">{row.actual}</td>
                          <td className={`text-right py-1.5 px-2 border-r ${row.budgetNegative ? "text-[color:var(--negative)]" : ""}`}>
                            {row.budgetRatio}
                          </td>
                          <td className={`text-right py-1.5 px-2 border-r ${row.lastYearNegative ? "text-[color:var(--negative)]" : ""}`}>
                            {row.lastYearRatio}
                          </td>
                          <td className="text-right py-1.5 px-2 border-r font-semibold text-positive">
                            {row.aiPrediction}
                          </td>
                          <td className={`text-right py-1.5 px-2 border-r ${row.aiBudgetNegative ? "text-[color:var(--negative)]" : ""}`}>
                            {row.aiBudgetRatio}
                          </td>
                          <td className={`text-right py-1.5 px-2 ${row.aiLastYearNegative ? "text-[color:var(--negative)]" : ""}`}>
                            {row.aiLastYearRatio}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">データがありません。</p>
          )}

          {/* 複数月表示（F-DASH-01）: 指標×月の実績マトリクス */}
          {Number(monthSpan) > 1 && (
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium">
                  月別実績推移（{year}年{month}月から{monthSpan}か月）
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                {spanLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : multiMonthTable ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-center py-1.5 px-2 font-medium border-r whitespace-nowrap">指標</th>
                          {multiMonthTable.columns.map((col) => (
                            <th
                              key={col.key}
                              className="text-center py-1.5 px-2 font-medium border-r whitespace-nowrap"
                            >
                              {col.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {multiMonthTable.rows.map((row) => (
                          <tr key={row.key} className="border-b hover:bg-muted/20">
                            <td className="py-1.5 px-2 font-medium border-r bg-muted/10 whitespace-nowrap">
                              {row.label}
                            </td>
                            {row.values.map((value, i) => (
                              <td
                                key={multiMonthTable.columns[i].key}
                                className="text-right py-1.5 px-2 border-r whitespace-nowrap"
                              >
                                {value}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    月別データを取得できませんでした。表示月数を変更して再度お試しください。
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* 在庫表（日別・タイプ別残室推移） */}
        <Card>
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-lg font-semibold">在庫表（日別・タイプ別残室推移）</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  日々の予約情報から残室数を記録し、選択した時点との推移を表示します（PMSでは過去時点の残室を確認できないため本システムで記録）
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs whitespace-nowrap">比較時点</Label>
                <Select value={snapshotPeriod} onValueChange={setSnapshotPeriod}>
                  <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SNAPSHOT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th rowSpan={2} className="text-center py-1.5 px-2 font-medium border-r">日付</th>
                    <th rowSpan={2} className="text-center py-1.5 px-2 font-medium border-r">曜日</th>
                    {INVENTORY_ROOM_TYPES.map((t) => (
                      <th key={t.key} colSpan={2} className="text-center py-1.5 px-2 font-medium border-r">
                        {t.label}
                      </th>
                    ))}
                    <th colSpan={2} className="text-center py-1.5 px-2 font-medium">合計</th>
                  </tr>
                  <tr className="border-b bg-muted/30">
                    {INVENTORY_ROOM_TYPES.map((t) => (
                      <Fragment key={t.key}>
                        <th className="text-center py-1 px-2 font-normal text-muted-foreground border-r border-dashed">残室</th>
                        <th className="text-center py-1 px-2 font-normal text-muted-foreground border-r">推移</th>
                      </Fragment>
                    ))}
                    <th className="text-center py-1 px-2 font-normal text-muted-foreground border-r border-dashed">残室</th>
                    <th className="text-center py-1 px-2 font-normal text-muted-foreground">推移</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryRows.map((row) => {
                    const dayName = ["日", "月", "火", "水", "木", "金", "土"][row.dow]
                    const isWeekend = row.dow === 5 || row.dow === 6
                    return (
                      <tr key={row.date.toISOString()} className={`border-b hover:bg-muted/20 ${isWeekend ? "bg-primary/5" : ""}`}>
                        <td className="text-center py-1.5 px-2 font-medium border-r">{format(row.date, "M/d")}</td>
                        <td className={`text-center py-1.5 px-2 border-r ${row.dow === 0 ? "text-negative" : row.dow === 6 ? "text-primary" : ""}`}>
                          {dayName}
                        </td>
                        {row.types.map((t) => (
                          <Fragment key={t.key}>
                            <td className="text-right py-1.5 px-2 border-r border-dashed">
                              {t.remaining}
                              <span className="text-[9px] text-muted-foreground">/{t.capacity}</span>
                            </td>
                            <td className={`text-right py-1.5 px-2 border-r ${t.diff < 0 ? "text-[color:var(--positive)]" : t.diff > 0 ? "text-[color:var(--negative)]" : "text-muted-foreground"}`}>
                              {t.diff === 0 ? "±0" : t.diff > 0 ? `+${t.diff}` : t.diff}
                            </td>
                          </Fragment>
                        ))}
                        <td className="text-right py-1.5 px-2 font-semibold border-r border-dashed">{row.totalRemaining}</td>
                        <td className={`text-right py-1.5 px-2 font-semibold ${row.totalDiff < 0 ? "text-[color:var(--positive)]" : row.totalDiff > 0 ? "text-[color:var(--negative)]" : "text-muted-foreground"}`}>
                          {row.totalDiff === 0 ? "±0" : row.totalDiff > 0 ? `+${row.totalDiff}` : row.totalDiff}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              ※ 推移は比較時点からの残室数の増減です（マイナス＝予約が進んで残室が減少）。表示は今後14日分・数値はモックデータです
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
