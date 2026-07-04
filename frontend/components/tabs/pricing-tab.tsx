"use client"

import React, { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { TrendingUp, TrendingDown, AlertCircle, Table2, Calendar, Edit2, Save, CheckCircle2, Info } from "lucide-react"
import { toast } from "sonner"
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Bar, ComposedChart, Legend } from "recharts"
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

// 料金ランク表のデータ（65段階）
// 実際のホテルでは料金表から読み込む形になる
const PRICE_RANKS = (() => {
  const ranks: { rank: number; label: string; price1P: number; price2P: number; price3P: number }[] = []
  // 65段階の料金ランクを生成
  // 最低価格: 1P=6,500円、最高価格: 1P=30,000円 程度のグラデーション
  for (let i = 1; i <= 65; i++) {
    const ratio = (i - 1) / 64 // 0 to 1
    const base1P = Math.round(6500 + ratio * 23500) // 6,500 ~ 30,000
    const base2P = Math.round(base1P * 1.4) // 1Pの1.4倍
    const base3P = Math.round(base1P * 1.8) // 1Pの1.8倍
    ranks.push({
      rank: i,
      label: `R${String(i).padStart(2, '0')}`,
      price1P: base1P,
      price2P: base2P,
      price3P: base3P,
    })
  }
  return ranks
})()

// 金額から最も近い料金ランクを見つける関数
function findPriceRank(price: number, personType: '1P' | '2P' | '3P' = '1P'): { rank: number; label: string; exactPrice: number; diff: number; diffPercent: number } {
  const priceKey = `price${personType}` as 'price1P' | 'price2P' | 'price3P'
  
  let closestRank = PRICE_RANKS[0]
  let closestDiff = Math.abs(price - PRICE_RANKS[0][priceKey])
  
  for (const rank of PRICE_RANKS) {
    const diff = Math.abs(price - rank[priceKey])
    if (diff < closestDiff) {
      closestDiff = diff
      closestRank = rank
    }
  }
  
  const exactPrice = closestRank[priceKey]
  const diff = price - exactPrice
  const diffPercent = (diff / exactPrice) * 100
  
  return {
    rank: closestRank.rank,
    label: closestRank.label,
    exactPrice,
    diff,
    diffPercent,
  }
}

// 料金ランクバッジのカラー（グラデーション）
function getRankBadgeColor(rank: number): string {
  if (rank <= 13) return "bg-blue-500 text-white" // 低価格帯
  if (rank <= 26) return "bg-cyan-500 text-white"
  if (rank <= 39) return "bg-green-500 text-white" // 中価格帯
  if (rank <= 52) return "bg-yellow-500 text-black"
  return "bg-red-500 text-white" // 高価格帯
}

export function PricingTab() {
  const [targetMonth, setTargetMonth] = useState("2025-04")
  const [displayMonths, setDisplayMonths] = useState("1")
  const [roomType, setRoomType] = useState("all")
  const [priceStrategy, setPriceStrategy] = useState("balanced")
  const [calendarViewMode, setCalendarViewMode] = useState<"table" | "grid">("table")
  const [selectedCalendarMonth, setSelectedCalendarMonth] = useState("2025-04")
  const [selectedDate, setSelectedDate] = useState<{
    date: number
    month: number
    year: number
    price1P?: number
    price2P?: number
    price3P?: number
  } | null>(null)
  const [selectedRowForAnalysis, setSelectedRowForAnalysis] = useState<{
    date: string
    day: string
    current: number
    recommended: number
    demand: string
    occupancy: number
    status: string
    month: number
    year: number
    dateNum: number
  } | null>(null)

  // イベント情報と外部要因情報を管理する状態
  // キーは "YYYY-MM-DD" 形式
  const [eventInfoMap, setEventInfoMap] = useState<Record<string, {
    eventInfo?: string
    externalFactors?: string
  }>>({})

  // 日付詳細ダイアログの編集モード
  const [isEditingEventInfo, setIsEditingEventInfo] = useState(false)
  const [editingEventInfo, setEditingEventInfo] = useState("")
  const [editingExternalFactors, setEditingExternalFactors] = useState("")

  // 重み付け設定の状態管理（AI予測値のデフォルト）
  const [weightOccupancy, setWeightOccupancy] = useState(40) // 稼働率
  const [weightAdr, setWeightAdr] = useState(40) // ADR
  const [weightCompetitor, setWeightCompetitor] = useState(20) // 競合価格追従
  // デフォルト値（AI予測値）
  const defaultWeightOccupancy = 40
  const defaultWeightAdr = 40
  const defaultWeightCompetitor = 20
  // ダイアログの開閉状態
  const [isWeightDialogOpen, setIsWeightDialogOpen] = useState(false)

  const generateMonthData = (monthOffset: number) => {
    // targetMonthを基準に計算
    const [targetYearStr, targetMonthStr] = targetMonth.split("-")
    const targetYear = Number.parseInt(targetYearStr, 10)
    const targetMonthNum = Number.parseInt(targetMonthStr, 10)
    const baseDate = new Date(targetYear, targetMonthNum - 1, 1)
    baseDate.setMonth(baseDate.getMonth() + monthOffset)
    const month = baseDate.getMonth() + 1
    const year = baseDate.getFullYear()
    const daysInMonth = new Date(year, month, 0).getDate()

    return Array.from({ length: daysInMonth }, (_, i) => {
      const date = i + 1
      const dayOfWeek = new Date(year, month - 1, date).getDay()
      const dayNames = ["日", "月", "火", "水", "木", "金", "土"]
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

      // 需要予測を5段階（A、B、C、D、E）で生成
      // A: 最高需要、B: 高需要、C: 中需要、D: 低需要、E: 最低需要
      const demandLevels = ["A", "B", "C", "D", "E"]
      let demand: string
      if (isWeekend) {
        // 週末はAまたはB
        demand = Math.random() > 0.3 ? "A" : "B"
      } else {
        // 平日はB、C、D、Eをランダムに
        const rand = Math.random()
        if (rand > 0.7) demand = "B"
        else if (rand > 0.4) demand = "C"
        else if (rand > 0.15) demand = "D"
        else demand = "E"
      }

      return {
        date: `${month}/${date}`,
        dateNum: date,
        day: dayNames[dayOfWeek],
        dayOfWeek,
        current: isWeekend ? 22000 + Math.random() * 4000 : 15000 + Math.random() * 3000,
        recommended: isWeekend ? 24000 + Math.random() * 4000 : 16000 + Math.random() * 3500,
        demand,
        status: isWeekend ? "increase" : "normal",
        occupancy: isWeekend ? 85 + Math.random() * 10 : 65 + Math.random() * 15,
        month,
        year,
        // For calendar grid view
        price1P: Math.round(isWeekend ? 25000 + Math.random() * 5000 : 20000 + Math.random() * 5000),
        price2P: Math.round(isWeekend ? 36000 + Math.random() * 8000 : 30000 + Math.random() * 6000),
        price3P: Math.round(isWeekend ? 48000 + Math.random() * 10000 : 40000 + Math.random() * 8000),
        // 利用人数平均を削除し、RevPARを追加
        revParCurrent: Math.round((isWeekend ? 22000 + Math.random() * 4000 : 15000 + Math.random() * 3000) * (isWeekend ? 0.85 + Math.random() * 0.1 : 0.65 + Math.random() * 0.15)),
        revParRecommended: Math.round((isWeekend ? 24000 + Math.random() * 4000 : 16000 + Math.random() * 3500) * (isWeekend ? 0.88 + Math.random() * 0.05 : 0.75 + Math.random() * 0.1)),
      }
    })
  }

  // Generate calendar grid data for a month
  const generateCalendarGridData = (monthOffset: number, selectedMonth?: string, isGridMode?: boolean) => {
    let baseDate: Date
    if (selectedMonth && isGridMode) {
      const [yearStr, monthStr] = selectedMonth.split("-")
      baseDate = new Date(Number.parseInt(yearStr), Number.parseInt(monthStr) - 1, 1)
    } else {
      // targetMonthを基準に計算
      const [targetYearStr, targetMonthStr] = targetMonth.split("-")
      const targetYear = Number.parseInt(targetYearStr, 10)
      const targetMonthNum = Number.parseInt(targetMonthStr, 10)
      baseDate = new Date(targetYear, targetMonthNum - 1, 1)
      baseDate.setMonth(baseDate.getMonth() + monthOffset)
    }
    const month = baseDate.getMonth() + 1
    const year = baseDate.getFullYear()

    // Get first day of month and days in month
    const firstDay = new Date(year, month - 1, 1)
    const lastDay = new Date(year, month, 0)
    const daysInMonth = lastDay.getDate()
    const startDayOfWeek = firstDay.getDay() // 0 = Sunday

    // Get previous month's last days if needed
    const prevMonth = new Date(year, month - 1, 0)
    const prevMonthDays = prevMonth.getDate()

    // Get next month's first days if needed
    const weeks = Math.ceil((daysInMonth + startDayOfWeek) / 7)

    const calendarDays: Array<{
      date: number
      month: number
      year: number
      dayOfWeek: number
      isCurrentMonth: boolean
      isSunday: boolean
      isSaturday: boolean
      price1P?: number
      price2P?: number
      price3P?: number
      holiday?: string
      eventInfo?: string
      externalFactors?: string
    }> = []

    // Add previous month's days
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const date = prevMonthDays - i
      calendarDays.push({
        date,
        month: month - 1,
        year: month === 1 ? year - 1 : year,
        dayOfWeek: (7 + (startDayOfWeek - (startDayOfWeek - i))) % 7,
        isCurrentMonth: false,
        isSunday: (startDayOfWeek - i) % 7 === 0,
        isSaturday: (startDayOfWeek - i) % 7 === 6,
      })
    }

    // Generate prices for all days based on day of week pattern
    // First 5 days establish the pattern, then repeat similar pattern based on weekday/weekend
    const dayPricePattern: { [key: number]: { base1P: number; base2P: number; base3P: number } } = {}

    // Generate base prices for first 5 days to establish pattern
    for (let date = 1; date <= Math.min(5, daysInMonth); date++) {
      const dayOfWeek = (startDayOfWeek + date - 1) % 7
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
      if (!dayPricePattern[dayOfWeek]) {
        dayPricePattern[dayOfWeek] = {
          base1P: Math.round(isWeekend ? 25250 + Math.random() * 1000 : 20000 + Math.random() * 2000),
          base2P: Math.round(isWeekend ? 36180 + Math.random() * 2000 : 30000 + Math.random() * 3000),
          base3P: Math.round(isWeekend ? 48200 + Math.random() * 3000 : 40000 + Math.random() * 4000),
        }
      }
    }

    // Add current month's days with prices - all days show prices using the pattern
    for (let date = 1; date <= daysInMonth; date++) {
      const dayOfWeek = (startDayOfWeek + date - 1) % 7
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

      // Use pattern based on day of week, or generate new if not in first 5 days pattern
      let prices
      if (dayPricePattern[dayOfWeek]) {
        prices = dayPricePattern[dayOfWeek]
      } else {
        // For days not in first 5, use weekday/weekend pattern
        prices = {
          base1P: Math.round(isWeekend ? 25250 + Math.random() * 1000 : 20000 + Math.random() * 2000),
          base2P: Math.round(isWeekend ? 36180 + Math.random() * 2000 : 30000 + Math.random() * 3000),
          base3P: Math.round(isWeekend ? 48200 + Math.random() * 3000 : 40000 + Math.random() * 4000),
        }
      }

      // イベント情報を取得
      const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`
      const savedInfo = eventInfoMap[dateKey]

      calendarDays.push({
        date,
        month,
        year,
        dayOfWeek,
        isCurrentMonth: true,
        isSunday: dayOfWeek === 0,
        isSaturday: dayOfWeek === 6,
        price1P: prices.base1P,
        price2P: prices.base2P,
        price3P: prices.base3P,
        holiday: date === 29 && month === 4 ? "昭和の日" :
          date === 3 && month === 5 ? "憲法記念日" :
            date === 4 && month === 5 ? "みどりの日" :
              date === 5 && month === 5 ? "こどもの日" : undefined,
        eventInfo: savedInfo?.eventInfo,
        externalFactors: savedInfo?.externalFactors,
      })
    }

    // Add next month's days to fill the grid
    const remainingDays = weeks * 7 - calendarDays.length
    for (let date = 1; date <= remainingDays; date++) {
      const dayOfWeek = (calendarDays.length + date - 1) % 7
      calendarDays.push({
        date,
        month: month + 1,
        year: month === 12 ? year + 1 : year,
        dayOfWeek,
        isCurrentMonth: false,
        isSunday: dayOfWeek === 0,
        isSaturday: dayOfWeek === 6,
      })
    }

    return { calendarDays, weeks, month, year }
  }

  const monthsToDisplay = Number.parseInt(displayMonths)
  // targetMonthをパースして基準日を取得
  const [targetYearStr, targetMonthStr] = targetMonth.split("-")
  const targetYear = Number.parseInt(targetYearStr, 10)
  const targetMonthNum = Number.parseInt(targetMonthStr, 10)
  const baseDate = new Date(targetYear, targetMonthNum - 1, 1)

  const allMonthsData = Array.from({ length: monthsToDisplay }, (_, i) => {
    const displayDate = new Date(baseDate)
    displayDate.setMonth(displayDate.getMonth() + i)
    return {
      monthOffset: i,
      data: generateMonthData(i),
      displayDate,
    }
  })

  // Generate detailed information for a selected date
  const getDateDetails = (date: number, month: number, year: number) => {
    const dayOfWeek = new Date(year, month - 1, date).getDay()
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

    // Generate sample prices based on day type
    const base1P = isWeekend ? 25250 : 20000
    const base2P = isWeekend ? 36180 : 30000
    const base3P = isWeekend ? 48200 : 40000

    // Standard single prices
    const standardSingle1P = isWeekend ? 25250 : 22000
    const standardSingle2P = isWeekend ? 31250 : 28000

    // Moderate twin prices
    const moderateTwin1P = 28000
    const moderateTwin2P = 36180

    // Triple prices
    const triple1P = 31000
    const triple2P = 42000
    const triple3P = 48200

    // Generate occupancy prediction (88% mentioned, but vary slightly)
    const occupancy = isWeekend ? 88 + Math.floor(Math.random() * 5) : 75 + Math.floor(Math.random() * 10)

    // 保存されたイベント情報を取得
    const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`
    const savedInfo = eventInfoMap[dateKey]

    return {
      standardSingle: {
        price1P: standardSingle1P,
        price2P: standardSingle2P,
      },
      moderateTwin: {
        price1P: moderateTwin1P,
        price2P: moderateTwin2P,
      },
      triple: {
        price1P: triple1P,
        price2P: triple2P,
        price3P: triple3P,
      },
      occupancy,
      eventInfo: savedInfo?.eventInfo || null,
      externalFactors: savedInfo?.externalFactors || null,
      dateKey,
    }
  }

  const PricingTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">{payload[0].payload.date}</p>
          <div className="space-y-1">
            {payload.map((entry: any, index: number) => (
              <p key={index} className="text-xs flex items-center gap-2">
                <span className="w-3 h-0.5" style={{ backgroundColor: entry.color }}></span>
                <span>
                  {entry.name}:{" "}
                  {entry.name.includes("価格")
                    ? `¥${Math.round(entry.value).toLocaleString()}`
                    : entry.name.includes("利用人数")
                      ? `${entry.value.toFixed(1)}人`
                      : `${Math.round(entry.value)}%`}
                </span>
              </p>
            ))}
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold text-balance">ダイナミックプライシング</h2>
        <p className="text-sm text-muted-foreground mt-1">需要予測に基づく最適価格設定</p>
      </div>

      {/* AI解説セクション - 一番上に配置 */}
      <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <span className="text-xl">🤖</span>
            AI価格最適化の提案
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2 text-sm leading-relaxed">
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2 flex-shrink-0" />
              <p>
                週末の需要が高まる見込みです。金曜日から日曜日にかけて段階的な価格引き上げを推奨します（平均+12%の増収見込み）。
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2 flex-shrink-0" />
              <p>
                平日の稼働率向上のため、月曜日から木曜日の価格を5%引き下げることで、稼働率を15%向上できる見込みです。
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--chart-2)] mt-2 flex-shrink-0" />
              <p>
                競合ホテルの価格動向を監視中です。現在の価格設定は市場平均より2.5%高く、品質優位性を考慮すると適正範囲内です。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 価格設定パラメータとサマリーを1つのCardに統合 */}
      <Card>
        <CardContent className="py-2.5 px-3">
          {/* 着地予測表題 */}
          <h3 className="text-lg font-semibold mb-2.5">着地予測</h3>
          
          {/* フィルターコントロール */}
          <div className="flex items-center gap-3 flex-wrap mb-2.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="display-months" className="text-xs whitespace-nowrap">表示月数</Label>
              <Select value={displayMonths} onValueChange={setDisplayMonths}>
                <SelectTrigger id="display-months" className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1ヶ月</SelectItem>
                  <SelectItem value="2">2ヶ月</SelectItem>
                  <SelectItem value="3">3ヶ月</SelectItem>
                  <SelectItem value="4">4ヶ月</SelectItem>
                  <SelectItem value="6">6ヶ月</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <Label htmlFor="room-type" className="text-xs whitespace-nowrap">部屋タイプ</Label>
              <Select value={roomType} onValueChange={setRoomType}>
                <SelectTrigger id="room-type" className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全タイプ</SelectItem>
                  <SelectItem value="standard">スタンダード</SelectItem>
                  <SelectItem value="deluxe">デラックス</SelectItem>
                  <SelectItem value="suite">スイート</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <Label htmlFor="strategy" className="text-xs whitespace-nowrap">価格戦略</Label>
              <Select value={priceStrategy} onValueChange={setPriceStrategy}>
                <SelectTrigger id="strategy" className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aggressive">収益性重視（ADR重視）</SelectItem>
                  <SelectItem value="balanced">バランス型</SelectItem>
                  <SelectItem value="conservative">売上重視（稼働重視）</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 価格戦略の重み付け設定ボタン */}
            <Dialog open={isWeightDialogOpen} onOpenChange={setIsWeightDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-2">
                  <Edit2 className="w-3 h-3" />
                  重み付け設定
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[550px]">
                <DialogHeader>
                  <DialogTitle className="text-lg font-semibold">価格戦略の重み付け設定</DialogTitle>
                  <DialogDescription className="text-sm">
                    各要素の重視度を設定してください。AI予測値に戻すこともできます。
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-6 py-4">
                  {/* 稼働率とADRのプログレスバー（合計100%） */}
                  <div className="space-y-3 p-4 bg-muted/50 rounded-lg border">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <Label className="text-sm font-semibold">1. 稼働率とADRのバランス</Label>
                        <div className="flex items-center gap-2 px-2 py-1 bg-background rounded-md border">
                          <span className="text-xs font-medium text-muted-foreground">合計</span>
                          <span className="text-sm font-bold">{weightOccupancy + weightAdr}%</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 px-2">
                        <div className="flex flex-col items-center gap-2 min-w-[90px]">
                          <Label className="text-xs font-medium text-muted-foreground">稼働率</Label>
                          <div className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/20 rounded-md border border-blue-200 dark:border-blue-800">
                            <span className="text-base font-bold text-blue-700 dark:text-blue-300">{weightOccupancy}</span>
                            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">%</span>
                          </div>
                        </div>
                        <div className="flex-1">
                          <Slider
                            value={[weightOccupancy]}
                            onValueChange={(value) => {
                              setWeightOccupancy(value[0])
                              setWeightAdr(100 - value[0])
                            }}
                            min={0}
                            max={100}
                            step={1}
                            className="w-full"
                          />
                        </div>
                        <div className="flex flex-col items-center gap-2 min-w-[90px]">
                          <Label className="text-xs font-medium text-muted-foreground">ADR</Label>
                          <div className="flex items-center gap-1 px-3 py-1.5 bg-green-50 dark:bg-green-950/20 rounded-md border border-green-200 dark:border-green-800">
                            <span className="text-base font-bold text-green-700 dark:text-green-300">{weightAdr}</span>
                            <span className="text-xs font-medium text-green-600 dark:text-green-400">%</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 競合価格追従のプログレスバー */}
                  <div className="space-y-3 p-4 bg-muted/50 rounded-lg border">
                    <div className="flex justify-between items-center mb-2">
                      <Label className="text-sm font-semibold">2. 競合価格追従</Label>
                      <div className="flex items-center gap-1 px-3 py-1.5 bg-purple-50 dark:bg-purple-950/20 rounded-md border border-purple-200 dark:border-purple-800">
                        <span className="text-base font-bold text-purple-700 dark:text-purple-300">{weightCompetitor}</span>
                        <span className="text-xs font-medium text-purple-600 dark:text-purple-400">%</span>
                      </div>
                    </div>
                    <Slider
                      value={[weightCompetitor]}
                      onValueChange={(value) => setWeightCompetitor(value[0])}
                      min={0}
                      max={100}
                      step={1}
                    />
                  </div>

                  {/* ボタン群 */}
                  <div className="pt-4 border-t flex items-center justify-between gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => {
                        setWeightOccupancy(defaultWeightOccupancy)
                        setWeightAdr(defaultWeightAdr)
                        setWeightCompetitor(defaultWeightCompetitor)
                        toast.success("AI予測値にリセットしました", {
                          description: `稼働率: ${defaultWeightOccupancy}%, ADR: ${defaultWeightAdr}%, 競合価格追従: ${defaultWeightCompetitor}%`,
                        })
                      }}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      AI予測値
                    </Button>
                    <Button
                      size="sm"
                      className="gap-2"
                      onClick={() => {
                        // 設定を保存する処理
                        toast.success("重み付け設定を保存しました", {
                          description: `稼働率: ${weightOccupancy}%, ADR: ${weightAdr}%, 競合価格追従: ${weightCompetitor}%`,
                          duration: 3000,
                        })
                        // 少し遅延させてからダイアログを閉じる
                        setTimeout(() => {
                          setIsWeightDialogOpen(false)
                        }, 500)
                      }}
                    >
                      <Save className="w-4 h-4" />
                      設定を保存
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* サマリーカードを横並びに */}
          <div className="grid grid-cols-4 gap-3 border-t pt-2.5">
            <div className="flex flex-col">
              <p className="text-xs text-muted-foreground mb-0.5">現在のADR</p>
              <div className="text-lg font-semibold mb-0.5">¥18,250</div>
              <div className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-[color:var(--positive)]" />
                <span className="text-xs text-[color:var(--positive)]">AI予測: +2.1% vs 1週間前</span>
              </div>
            </div>

            <div className="flex flex-col">
              <p className="text-xs text-muted-foreground mb-0.5">月間着地シミュレーションADR</p>
              <div className="text-lg font-semibold mb-0.5">¥19,500</div>
              <Badge variant="secondary" className="text-xs w-fit">
                AI予測: +6.8% 上昇
              </Badge>
            </div>

            <div className="flex flex-col">
              <p className="text-xs text-muted-foreground mb-0.5">現在のRevPAR</p>
              <div className="text-lg font-semibold mb-0.5">¥14,600</div>
              <div className="text-xs text-muted-foreground">稼働率: 80.0%</div>
            </div>

            <div className="flex flex-col">
              <p className="text-xs text-muted-foreground mb-0.5">着地予想RevPAR</p>
              <div className="text-lg font-semibold mb-0.5">¥16,575</div>
              <div className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-[color:var(--positive)]" />
                <span className="text-xs text-[color:var(--positive)]">+13.5% (稼働率 85.0%)</span>
              </div>
            </div>
          </div>

          {/* 区切り線 */}
          <div className="border-t my-4"></div>

          {/* 日別価格カレンダーセクション */}
          {allMonthsData.map(({ monthOffset, data, displayDate }) => {
            // displayDateが有効な日付か確認し、無効な場合は再計算
            let validDisplayDate = displayDate
            if (!displayDate || isNaN(displayDate.getTime())) {
              const [targetYearStr, targetMonthStr] = targetMonth.split("-")
              const targetYear = Number.parseInt(targetYearStr, 10)
              const targetMonthNum = Number.parseInt(targetMonthStr, 10)
              validDisplayDate = new Date(targetYear, targetMonthNum - 1 + monthOffset, 1)
            }
            const monthValue = `${validDisplayDate.getFullYear()}-${String(validDisplayDate.getMonth() + 1).padStart(2, '0')}`
            const calendarGridData = generateCalendarGridData(monthOffset, selectedCalendarMonth, calendarViewMode === "grid")

            return (
              <div key={monthOffset} className="space-y-3">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold">日別価格カレンダー</h3>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={calendarViewMode === "table" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCalendarViewMode("table")}
                    >
                      <Table2 className="w-4 h-4 mr-2" />
                      ADRテーブル
                    </Button>
                    <Button
                      variant={calendarViewMode === "grid" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCalendarViewMode("grid")}
                    >
                      <Calendar className="w-4 h-4 mr-2" />
                      販売価格カレンダー
                    </Button>
                  </div>
                </div>
                <div className="space-y-3">
                {calendarViewMode === "table" ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 px-4 font-medium">日付</th>
                          <th className="text-left py-3 px-4 font-medium">曜日</th>
                          <th className="text-right py-3 px-4 font-medium">現在ADR</th>
                          <th className="text-right py-3 px-4 font-medium">推奨ADR</th>
                          <th className="text-center py-3 px-4 font-medium">
                            <TooltipProvider>
                              <UITooltip>
                                <TooltipTrigger asChild>
                                  <span className="flex items-center justify-center gap-1 cursor-help">
                                    料金ランク
                                    <Info className="w-3.5 h-3.5 text-muted-foreground" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs">
                                  <p className="text-xs">推奨ADRに最も近い料金表の価格ランク（R01〜R65）を表示します。料金表の価格と推奨ADRの差も確認できます。</p>
                                </TooltipContent>
                              </UITooltip>
                            </TooltipProvider>
                          </th>
                          <th className="text-right py-3 px-4 font-medium">稼働率予測</th>
                          <th className="text-right py-3 px-4 font-medium">需要予測</th>
                          <th className="text-center py-3 px-4 font-medium">ステータス</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.map((row) => {
                          // 推奨ADRから料金ランクを計算
                          const priceRank = findPriceRank(row.recommended, '1P')
                          
                          return (
                            <tr
                              key={row.date}
                              className="border-b hover:bg-muted/50 cursor-pointer transition-colors"
                              onClick={() => {
                                setSelectedRowForAnalysis({
                                  date: row.date,
                                  day: row.day,
                                  current: row.current,
                                  recommended: row.recommended,
                                  demand: row.demand,
                                  occupancy: row.occupancy,
                                  status: row.status,
                                  month: row.month,
                                  year: row.year,
                                  dateNum: row.dateNum,
                                })
                              }}
                            >
                              <td className="py-3 px-4 font-medium">{row.date}</td>
                              <td className="py-3 px-4">{row.day}</td>
                              <td className="text-right py-3 px-4">¥{Math.round(row.current).toLocaleString()}</td>
                              <td className="text-right py-3 px-4 font-semibold">
                                ¥{Math.round(row.recommended).toLocaleString()}
                              </td>
                              <td className="text-center py-3 px-4">
                                <TooltipProvider>
                                  <UITooltip>
                                    <TooltipTrigger asChild>
                                      <div className="flex flex-col items-center gap-0.5">
                                        <Badge className={`${getRankBadgeColor(priceRank.rank)} text-xs font-bold px-2`}>
                                          {priceRank.label}
                                        </Badge>
                                        <span className="text-[10px] text-muted-foreground">
                                          ¥{priceRank.exactPrice.toLocaleString()}
                                        </span>
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs">
                                      <div className="text-xs space-y-1">
                                        <p><strong>料金ランク:</strong> {priceRank.label} (ランク {priceRank.rank}/65)</p>
                                        <p><strong>料金表価格:</strong> ¥{priceRank.exactPrice.toLocaleString()}</p>
                                        <p><strong>推奨ADRとの差:</strong> {priceRank.diff > 0 ? '+' : ''}{Math.round(priceRank.diff).toLocaleString()}円 ({priceRank.diffPercent > 0 ? '+' : ''}{priceRank.diffPercent.toFixed(1)}%)</p>
                                      </div>
                                    </TooltipContent>
                                  </UITooltip>
                                </TooltipProvider>
                              </td>
                              <td className="text-right py-3 px-4">{Math.round(row.occupancy)}%</td>
                              <td className="text-right py-3 px-4">
                                <Badge
                                  variant={
                                    row.demand === "A" ? "default" :
                                    row.demand === "B" ? "default" :
                                    row.demand === "C" ? "secondary" :
                                    row.demand === "D" ? "outline" : "outline"
                                  }
                                  className={
                                    row.demand === "A" ? "bg-blue-600 text-white" :
                                    row.demand === "B" ? "bg-blue-400 text-white" :
                                    row.demand === "C" ? "bg-gray-300 text-gray-800" :
                                    row.demand === "D" ? "bg-orange-200 text-orange-800" :
                                    "bg-red-200 text-red-800"
                                  }
                                >
                                  {row.demand}
                                </Badge>
                              </td>
                              <td className="text-center py-3 px-4">
                                {row.status === "increase" && <Badge variant="secondary">値上推奨</Badge>}
                                {row.status === "normal" && <Badge variant="outline">適正</Badge>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="inline-block min-w-full">
                      {/* Calendar Header */}
                      <div className="grid grid-cols-7 gap-px border-b mb-1">
                        {["日", "月", "火", "水", "木", "金", "土"].map((day) => (
                          <div key={day} className="text-center py-2 text-sm font-medium">
                            {day}
                          </div>
                        ))}
                      </div>
                      {/* Calendar Grid */}
                      <div className="grid grid-cols-7 gap-px border">
                        {calendarGridData.calendarDays.map((day, index) => {
                          return (
                            <div
                              key={`${day.year}-${day.month}-${day.date}-${index}`}
                              onClick={() => {
                                if (day.isCurrentMonth && day.price1P) {
                                  setSelectedDate({
                                    date: day.date,
                                    month: day.month,
                                    year: day.year,
                                    price1P: day.price1P,
                                    price2P: day.price2P,
                                    price3P: day.price3P,
                                  })
                                }
                              }}
                              className={`
                                min-h-[100px] p-2 text-xs relative
                                ${day.isCurrentMonth ? "" : "opacity-30"}
                                ${day.isSunday || day.holiday ? "bg-red-50 dark:bg-red-950/20" : day.isSaturday ? "bg-blue-50 dark:bg-blue-950/20" : ""}
                                border-r border-b
                                ${day.isCurrentMonth && day.price1P ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}
                              `}
                            >
                              {/* Date number */}
                              <div
                                className={`
                                  font-medium mb-1 inline-flex items-center justify-center
                                  ${day.isSunday || day.holiday ? "text-red-600 dark:text-red-400" : day.isSaturday ? "text-blue-600 dark:text-blue-400" : ""}
                                `}
                              >
                                {day.isCurrentMonth ? (
                                  day.month === 5 && day.date === 1 && day.year === 2025
                                    ? "5月1日"
                                    : day.date
                                ) : day.date}
                              </div>

                              {/* Holiday label */}
                              {day.holiday && (
                                <div className="text-pink-600 text-[10px] mb-1 font-medium">{day.holiday}</div>
                              )}

                              {/* Event info indicator */}
                              {day.isCurrentMonth && (day.eventInfo || day.externalFactors) && (
                                <div className="mb-1">
                                  <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                                    {(day.eventInfo ? "イベント" : "") + (day.eventInfo && day.externalFactors ? "・" : "") + (day.externalFactors ? "要因" : "")}
                                  </Badge>
                                </div>
                              )}

                              {/* Price information - show for all current month days */}
                              {day.isCurrentMonth && day.price1P && (
                                <div className="space-y-0.5 text-[10px] leading-tight mt-1">
                                  <div>1P-{day.price1P.toLocaleString()}</div>
                                  <div>2P-{day.price2P?.toLocaleString()}</div>
                                  <div>3P-{day.price3P?.toLocaleString()}</div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* 価格推移グラフ */}
                <div className="mt-6 pt-6 border-t">
                  <h3 className="text-base font-semibold mb-3">価格推移グラフ</h3>
                  <div className="space-y-3">
                  <div className="flex items-center gap-3 text-xs flex-wrap">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-0.5 bg-blue-600"></div>
                      <span>現在ADR</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-0.5 bg-green-600"></div>
                      <span>推奨ADR</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-orange-200 rounded"></div>
                      <span>稼働率</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-0.5 bg-purple-600 border-dashed border-b"></div>
                      <span>現在RevPAR</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-0.5 bg-pink-600 border-dashed border-b"></div>
                      <span>推奨RevPAR</span>
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={250}>
                    <ComposedChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 11 }}
                        stroke="currentColor"
                        opacity={0.5}
                        tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 11 }}
                        stroke="currentColor"
                        opacity={0.5}
                        tickFormatter={(value) => `${value}%`}
                      />
                      <Tooltip content={<PricingTooltip />} />
                      <Legend wrapperStyle={{ fontSize: "11px" }} />
                      <Bar yAxisId="right" dataKey="occupancy" fill="#fed7aa" opacity={0.3} name="稼働率" />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="current"
                        stroke="#2563eb"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        name="現在ADR"
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="recommended"
                        stroke="#16a34a"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        name="推奨ADR"
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="revParCurrent"
                        stroke="#9333ea"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={{ r: 3 }}
                        name="現在RevPAR"
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="revParRecommended"
                        stroke="#db2777"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={{ r: 3 }}
                        name="推奨RevPAR"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        </CardContent>
      </Card>


      {/* Date Details Dialog */}
      <Dialog open={selectedDate !== null} onOpenChange={(open) => {
        if (!open) {
          setSelectedDate(null)
          setIsEditingEventInfo(false)
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedDate && (() => {
            const details = getDateDetails(selectedDate.date, selectedDate.month, selectedDate.year)
            const dayNames = ["日", "月", "火", "水", "木", "金", "土"]
            const dayOfWeek = new Date(selectedDate.year, selectedDate.month - 1, selectedDate.date).getDay()
            const dateString = `${selectedDate.year}年${selectedDate.month}月${selectedDate.date}日（${dayNames[dayOfWeek]}）`

            // 編集モード開始時に現在の値を設定
            const handleEditStart = () => {
              setEditingEventInfo(details.eventInfo || "")
              setEditingExternalFactors(details.externalFactors || "")
              setIsEditingEventInfo(true)
            }

            // 保存処理
            const handleSave = () => {
              const dateKey = details.dateKey
              setEventInfoMap(prev => ({
                ...prev,
                [dateKey]: {
                  eventInfo: editingEventInfo || undefined,
                  externalFactors: editingExternalFactors || undefined,
                }
              }))
              setIsEditingEventInfo(false)
            }

            return (
              <>
                <DialogHeader>
                  <DialogTitle>{dateString} の詳細情報</DialogTitle>
                  <DialogDescription>
                    該当日の基本的な代表的な部屋タイプの利用人数別料金が表示されます
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 mt-4">
                  {/* Room Type Prices */}
                  <div className="space-y-4">
                    {(() => {
                      // 各部屋タイプの料金ランクを計算
                      const singleRank = findPriceRank(details.standardSingle.price1P, '1P')
                      const twinRank = findPriceRank(details.moderateTwin.price1P, '1P')
                      const tripleRank = findPriceRank(details.triple.price1P, '1P')
                      
                      return (
                        <>
                          <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-base">部屋タイプ別標準販売価格（料金ランク）</h3>
                          </div>

                          {/* 料金ランク説明 */}
                          <div className="bg-muted/50 rounded-lg p-3 text-sm">
                            <div className="flex items-center gap-2 mb-2">
                              <Info className="w-4 h-4 text-muted-foreground" />
                              <span className="font-medium">料金ランクとは</span>
                            </div>
                            <p className="text-muted-foreground text-xs">
                              料金表は65段階のランク（R01〜R65）で構成されています。AIが予測した推奨価格に最も近いランクが表示されます。
                            </p>
                            <div className="flex flex-wrap gap-2 mt-2">
                              <Badge className="bg-blue-500 text-white text-[10px]">R01-R13: 低価格帯</Badge>
                              <Badge className="bg-cyan-500 text-white text-[10px]">R14-R26</Badge>
                              <Badge className="bg-green-500 text-white text-[10px]">R27-R39: 中価格帯</Badge>
                              <Badge className="bg-yellow-500 text-black text-[10px]">R40-R52</Badge>
                              <Badge className="bg-red-500 text-white text-[10px]">R53-R65: 高価格帯</Badge>
                            </div>
                          </div>

                          {/* Standard Single */}
                          <div className="border rounded-lg p-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="font-medium">スタンダードシングル</div>
                              <Badge className={`${getRankBadgeColor(singleRank.rank)} text-xs font-bold`}>
                                {singleRank.label}
                              </Badge>
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>1名料金：¥{details.standardSingle.price1P.toLocaleString()}</div>
                              <div>2名料金：¥{details.standardSingle.price2P.toLocaleString()}</div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              料金表価格: ¥{singleRank.exactPrice.toLocaleString()} (差額: {singleRank.diff > 0 ? '+' : ''}{Math.round(singleRank.diff).toLocaleString()}円)
                            </div>
                          </div>

                          {/* Moderate Twin */}
                          <div className="border rounded-lg p-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="font-medium">モデレートツイン</div>
                              <Badge className={`${getRankBadgeColor(twinRank.rank)} text-xs font-bold`}>
                                {twinRank.label}
                              </Badge>
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>1名料金：¥{details.moderateTwin.price1P.toLocaleString()}</div>
                              <div>2名料金：¥{details.moderateTwin.price2P.toLocaleString()}</div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              料金表価格: ¥{twinRank.exactPrice.toLocaleString()} (差額: {twinRank.diff > 0 ? '+' : ''}{Math.round(twinRank.diff).toLocaleString()}円)
                            </div>
                          </div>

                          {/* Triple */}
                          <div className="border rounded-lg p-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="font-medium">トリプル</div>
                              <Badge className={`${getRankBadgeColor(tripleRank.rank)} text-xs font-bold`}>
                                {tripleRank.label}
                              </Badge>
                            </div>
                            <div className="grid grid-cols-3 gap-4 text-sm">
                              <div>1名料金：¥{details.triple.price1P.toLocaleString()}</div>
                              <div>2名料金：¥{details.triple.price2P.toLocaleString()}</div>
                              <div>3名料金：¥{details.triple.price3P.toLocaleString()}</div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              料金表価格: ¥{tripleRank.exactPrice.toLocaleString()} (差額: {tripleRank.diff > 0 ? '+' : ''}{Math.round(tripleRank.diff).toLocaleString()}円)
                            </div>
                          </div>
                        </>
                      )
                    })()}
                  </div>

                  {/* Event Info and External Factors Section */}
                  <div className="space-y-3 border-t pt-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-base">イベント情報・外部要因情報</h3>
                      {!isEditingEventInfo && (
                        <Button variant="outline" size="sm" onClick={handleEditStart} className="gap-2">
                          <Edit2 className="w-4 h-4" />
                          編集
                        </Button>
                      )}
                    </div>

                    {isEditingEventInfo ? (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="event-info">イベント情報</Label>
                          <Textarea
                            id="event-info"
                            placeholder="例：○○ホールで○○コンサート予定です"
                            value={editingEventInfo}
                            onChange={(e) => setEditingEventInfo(e.target.value)}
                            rows={3}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="external-factors">外部要因情報</Label>
                          <Textarea
                            id="external-factors"
                            placeholder="例：天候、交通機関の遅延、その他の要因"
                            value={editingExternalFactors}
                            onChange={(e) => setEditingExternalFactors(e.target.value)}
                            rows={3}
                          />
                        </div>

                        <div className="flex gap-2">
                          <Button onClick={handleSave} className="gap-2">
                            <Save className="w-4 h-4" />
                            保存
                          </Button>
                          <Button variant="outline" onClick={() => setIsEditingEventInfo(false)}>
                            キャンセル
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 text-sm">
                        {details.eventInfo && (
                          <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                            <div className="font-medium mb-1">イベント情報</div>
                            <div className="text-muted-foreground">{details.eventInfo}</div>
                          </div>
                        )}
                        {details.externalFactors && (
                          <div className="p-3 bg-orange-50 dark:bg-orange-950/20 rounded-lg">
                            <div className="font-medium mb-1">外部要因情報</div>
                            <div className="text-muted-foreground">{details.externalFactors}</div>
                          </div>
                        )}
                        {!details.eventInfo && !details.externalFactors && (
                          <div className="text-muted-foreground text-sm">イベント情報・外部要因情報は未設定です</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Comments Section */}
                  <div className="space-y-3 border-t pt-4">
                    <h3 className="font-semibold text-base">■コメント</h3>
                    <ul className="space-y-2 text-sm list-disc list-inside text-muted-foreground">
                      <li>この料金で稼働率予測{details.occupancy}%で見込んでいます</li>
                      {details.eventInfo && (
                        <li>イベント情報として{details.eventInfo}</li>
                      )}
                      {details.externalFactors && (
                        <li>外部要因として{details.externalFactors}</li>
                      )}
                    </ul>
                  </div>
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* AI Analysis Dialog */}
      {selectedRowForAnalysis && (
        <Dialog open={selectedRowForAnalysis !== null} onOpenChange={(open) => !open && setSelectedRowForAnalysis(null)}>
          <DialogContent className="!max-w-[60vw] sm:!max-w-[60vw] max-h-[90vh] overflow-y-auto w-full">
            {(() => {
              const row = selectedRowForAnalysis
              const priceDiff = row.recommended - row.current
              const priceDiffPercent = ((priceDiff / row.current) * 100).toFixed(1)
              const isWeekend = row.day === "土" || row.day === "日"

              // Generate AI insights based on the data
              const insights: Array<{ type: string; title: string; content: string }> = []

              if (row.demand === "A" || row.demand === "B") {
                insights.push({
                  type: "positive",
                  title: "需要予測が高い",
                  content: `${row.date}（${row.day}）は需要予測が「${row.demand}」となっています。競合ホテルの予約状況も好調で、価格競争力が高い状態です。`,
                })
              }

              if (row.status === "increase") {
                insights.push({
                  type: "positive",
                  title: "値上げ推奨",
                  content: `現在の価格¥${Math.round(row.current).toLocaleString()}から推奨価格¥${Math.round(row.recommended).toLocaleString()}へ${priceDiffPercent}%の値上げを推奨します。稼働率予測${Math.round(row.occupancy)}%を維持したまま、収益を最大化できます。`,
                })
              }

              if ((row.demand === "D" || row.demand === "E") && row.occupancy < 70) {
                insights.push({
                  type: "negative",
                  title: "需要と稼働率が低い",
                  content: `需要予測が「${row.demand}」で、稼働率予測も${Math.round(row.occupancy)}%と低水準です。価格を${Math.abs(parseFloat(priceDiffPercent)) > 0 ? `${Math.abs(parseFloat(priceDiffPercent))}%` : "5%"}引き下げることで、稼働率を15-20%向上できる可能性があります。`,
                })
              }

              if (isWeekend && row.occupancy > 85) {
                insights.push({
                  type: "chart-2",
                  title: "週末の高稼働率",
                  content: `週末（${row.day}）でありながら稼働率予測${Math.round(row.occupancy)}%と高水準です。さらに価格を最適化することで、収益を最大化できる可能性があります。`,
                })
              }

              // Competitive analysis - 未来の価格予測に基づく分析のみ
              const competitorPrice = row.current * (isWeekend ? 0.95 : 1.05)
              const marketPosition = row.current > competitorPrice ? "市場平均より高め" : "市場平均より低め"

              insights.push({
                type: "chart-2",
                title: "競合分析（AI予測）",
                content: `AI予測では、周辺ホテルの平均価格は約¥${Math.round(competitorPrice).toLocaleString()}で、現在の価格設定は${marketPosition}です。${marketPosition.includes("高め") ? "品質優位性がある場合は適正範囲内" : "さらに値上げの余地がある可能性"}があります。`,
              })

              // Calendar-style visualization
              const weekDays = ["日", "月", "火", "水", "木", "金", "土"]
              const calendarWeek: Array<{
                date: number
                month: number
                day: string
                isSelected: boolean
                isWeekend: boolean
                estimatedPrice: number
                estimatedOccupancy: number
              }> = []

              // Generate surrounding days for context
              for (let i = -3; i <= 3; i++) {
                const targetDate = new Date(row.year, row.month - 1, row.dateNum + i)
                const weekDay = weekDays[targetDate.getDay()]
                const isSelected = i === 0
                const isWeekendDay = weekDay === "土" || weekDay === "日"

                calendarWeek.push({
                  date: targetDate.getDate(),
                  month: targetDate.getMonth() + 1,
                  day: weekDay,
                  isSelected,
                  isWeekend: isWeekendDay,
                  estimatedPrice: isWeekendDay
                    ? Math.round(22000 + Math.random() * 4000)
                    : Math.round(15000 + Math.random() * 3000),
                  estimatedOccupancy: isWeekendDay
                    ? Math.round(85 + Math.random() * 10)
                    : Math.round(65 + Math.random() * 15),
                })
              }

              return (
                <>
                  <DialogHeader>
                    <DialogTitle>
                      {row.year}年{row.month}月{row.dateNum}日（{row.day}）のAI分析
                    </DialogTitle>
                    <DialogDescription>
                      需要予測、競合分析、価格最適化の提案を表示します
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-6 mt-4">
                    {/* Calendar-style week view */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">週間価格推移（該当日を中心）</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <div className="grid grid-cols-7 gap-3 min-w-fit">
                            {calendarWeek.map((day, index) => (
                              <div
                                key={index}
                                className={`
                                p-3 border rounded-lg text-center min-w-[90px] flex-shrink-0
                                ${day.isSelected ? "ring-2 ring-primary bg-primary/5" : ""}
                                ${day.isWeekend ? "bg-blue-50" : ""}
                              `}
                              >
                                <div className="text-xs text-muted-foreground mb-1.5">{day.day}</div>
                                <div className={`text-base font-semibold mb-2 ${day.isSelected ? "text-primary" : ""}`}>
                                  {day.date}
                                </div>
                                <div className="text-xs text-muted-foreground mb-1 break-words">
                                  ¥{day.estimatedPrice.toLocaleString()}
                                </div>
                                <div className="text-xs text-muted-foreground break-words">
                                  {day.estimatedOccupancy}%
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Key Metrics */}
                    {(() => {
                      const recommendedRank = findPriceRank(row.recommended, '1P')
                      const currentRank = findPriceRank(row.current, '1P')
                      
                      return (
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                          <Card>
                            <CardHeader className="pb-3">
                              <CardTitle className="text-sm font-medium text-muted-foreground">現在価格</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="text-2xl font-semibold">¥{Math.round(row.current).toLocaleString()}</div>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge className={`${getRankBadgeColor(currentRank.rank)} text-xs`}>
                                  {currentRank.label}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  (¥{currentRank.exactPrice.toLocaleString()})
                                </span>
                              </div>
                            </CardContent>
                          </Card>

                          <Card className="border-primary/50 bg-primary/5">
                            <CardHeader className="pb-3">
                              <CardTitle className="text-sm font-medium text-primary">推奨価格 & 料金ランク</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="text-2xl font-semibold text-primary">¥{Math.round(row.recommended).toLocaleString()}</div>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge className={`${getRankBadgeColor(recommendedRank.rank)} text-sm font-bold`}>
                                  {recommendedRank.label}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  (¥{recommendedRank.exactPrice.toLocaleString()})
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                料金表との差: {recommendedRank.diff > 0 ? '+' : ''}{Math.round(recommendedRank.diff).toLocaleString()}円
                              </div>
                            </CardContent>
                          </Card>

                          <Card>
                            <CardHeader className="pb-3">
                              <CardTitle className="text-sm font-medium text-muted-foreground">稼働率予測</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="text-2xl font-semibold">{Math.round(row.occupancy)}%</div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {row.occupancy >= 90 ? "満室に近い" : row.occupancy >= 80 ? "高稼働率" : row.occupancy >= 70 ? "中稼働率" : "低稼働率"}
                              </div>
                            </CardContent>
                          </Card>

                          <Card>
                            <CardHeader className="pb-3">
                              <CardTitle className="text-sm font-medium text-muted-foreground">需要予測</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="text-2xl font-semibold">
                                <Badge
                                  variant={
                                    row.demand === "A" ? "default" :
                                    row.demand === "B" ? "default" :
                                    row.demand === "C" ? "secondary" :
                                    row.demand === "D" ? "outline" : "outline"
                                  }
                                  className={
                                    row.demand === "A" ? "bg-blue-600 text-white text-lg px-3 py-1" :
                                    row.demand === "B" ? "bg-blue-400 text-white text-lg px-3 py-1" :
                                    row.demand === "C" ? "bg-gray-300 text-gray-800 text-lg px-3 py-1" :
                                    row.demand === "D" ? "bg-orange-200 text-orange-800 text-lg px-3 py-1" :
                                    "bg-red-200 text-red-800 text-lg px-3 py-1"
                                  }
                                >
                                  {row.demand}
                                </Badge>
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {row.demand === "A" ? "需要が非常に高い" :
                                 row.demand === "B" ? "需要が高い" :
                                 row.demand === "C" ? "需要は平均的" :
                                 row.demand === "D" ? "需要が低い" : "需要が非常に低い"}
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      )
                    })()}

                    {/* AI Insights */}
                    <Card className="border-l-4 border-l-primary">
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <AlertCircle className="w-5 h-5" />
                          AI分析インサイト
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {insights.map((insight, index) => (
                          <div key={index} className="flex items-start gap-3">
                            <div className={`w-2 h-2 rounded-full mt-2 ${insight.type === "positive" ? "bg-[color:var(--positive)]" :
                              insight.type === "negative" ? "bg-[color:var(--negative)]" :
                                "bg-[color:var(--chart-2)]"
                              }`} />
                            <div className="flex-1">
                              <div className="font-medium text-sm mb-1">{insight.title}</div>
                              <p className="text-sm leading-relaxed text-muted-foreground">{insight.content}</p>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>

                    {/* Recommended Actions */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">推奨アクション</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {row.status === "increase" && (
                          <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg">
                            <TrendingUp className="w-4 h-4 text-blue-600 mt-0.5" />
                            <div className="flex-1">
                              <div className="font-medium text-sm mb-1">価格引き上げを実施</div>
                              <div className="text-xs text-muted-foreground">
                                推奨価格¥{Math.round(row.recommended).toLocaleString()}に更新することで、
                                収益を約{priceDiffPercent}%向上できます。
                              </div>
                            </div>
                          </div>
                        )}

                        {(row.demand === "D" || row.demand === "E") && (
                          <div className="flex items-start gap-2 p-3 bg-yellow-50 rounded-lg">
                            <TrendingDown className="w-4 h-4 text-yellow-600 mt-0.5" />
                            <div className="flex-1">
                              <div className="font-medium text-sm mb-1">需要喚起施策を検討</div>
                              <div className="text-xs text-muted-foreground">
                                平日限定プランや早期割引の導入により、需要を喚起できる可能性があります。
                              </div>
                            </div>
                          </div>
                        )}

                        {(row.demand === "A" || row.demand === "B") && row.occupancy > 85 && (
                          <div className="flex items-start gap-2 p-3 bg-green-50 rounded-lg">
                            <AlertCircle className="w-4 h-4 text-green-600 mt-0.5" />
                            <div className="flex-1">
                              <div className="font-medium text-sm mb-1">満室に近い状態</div>
                              <div className="text-xs text-muted-foreground">
                                高需要のため、さらなる価格最適化により収益最大化が可能です。
                              </div>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </>
              )
            })()}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
