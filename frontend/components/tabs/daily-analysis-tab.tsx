"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { CalendarIcon, TrendingUp, TrendingDown, BarChart3, Settings } from "lucide-react"
import { SegmentCrossAnalysisSettings } from "@/components/segment-cross-analysis-settings"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, Area, AreaChart, Cell } from "recharts"
import { AlertTriangle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export function DailyAnalysisTab() {
  const [targetMonth, setTargetMonth] = useState("2025-04")
  const [viewMode, setViewMode] = useState<"table" | "segment-settings">("table")
  const [selectedDateForCurve, setSelectedDateForCurve] = useState<string | null>(null)
  const [selectedOccupancies, setSelectedOccupancies] = useState<number[]>([1])
  const [selectedCompetitors, setSelectedCompetitors] = useState<string[]>(["Aホテル"])

  // 現在の日付を取得（過去/未来判定用）
  const today = new Date()
  const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  // 日付が過去かどうかを判定する関数
  const isPastDate = (dateStr: string, monthStr: string) => {
    const [month, day] = dateStr.split("/").map(Number)
    const [year, monthNum] = monthStr.split("-").map(Number)
    const rowDate = new Date(year, monthNum - 1, day)
    const rowDateOnly = new Date(rowDate.getFullYear(), rowDate.getMonth(), rowDate.getDate())
    return rowDateOnly < todayDateOnly
  }

  // ブッキングカーブデータ生成（月単位）
  const bookingCurveData = useMemo(() => {
    if (!selectedDateForCurve) return []

    // 選択された日付に対するブッキングカーブデータ
    // 宿泊日の何ヶ月前に予約が入ったかを示す（月単位表示）
    // X軸が右肩上がりになるように、過去から現在へ並べる
    const monthlyData = [
      { monthsBefore: 6, label: "6ヶ月前", bookings: 500, cumulative: 2000 },
      { monthsBefore: 5, label: "5ヶ月前", bookings: 800, cumulative: 4000 },
      { monthsBefore: 4, label: "4ヶ月前", bookings: 1200, cumulative: 7000 },
      { monthsBefore: 3, label: "3ヶ月前", bookings: 2000, cumulative: 12000 },
      { monthsBefore: 2, label: "2ヶ月前", bookings: 3500, cumulative: 20000 },
      { monthsBefore: 1, label: "1ヶ月前", bookings: 5000, cumulative: 28000 },
      { monthsBefore: 0, label: "当月", bookings: 2000, cumulative: 30000 },
    ]

    return monthlyData.map((item) => ({
      monthsBefore: item.monthsBefore,
      label: item.label,
      bookings: item.bookings,
      cumulative: item.cumulative,
    }))
  }, [selectedDateForCurve])

  const BookingCurveTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">{payload[0].payload.label}</p>
          <div className="space-y-1">
            {payload.map((entry: any, index: number) => (
              <p key={index} className="text-xs flex items-center gap-2">
                <span className="w-3 h-0.5" style={{ backgroundColor: entry.color }}></span>
                <span>
                  {entry.name}: {entry.value}室
                </span>
              </p>
            ))}
          </div>
        </div>
      )
    }
    return null
  }

  // 競合比較データ生成（複数の人数とホテルに対応）
  const competitorComparisonData = useMemo(() => {
    const dailyData = [
      { date: "4/1", day: "火", ourPrice: 17200, competitorPrice: 16800 },
      { date: "4/2", day: "水", ourPrice: 16800, competitorPrice: 16500 },
      { date: "4/3", day: "木", ourPrice: 17500, competitorPrice: 17000 },
      { date: "4/4", day: "金", ourPrice: 21500, competitorPrice: 21000 },
      { date: "4/5", day: "土", ourPrice: 26500, competitorPrice: 25800 },
      { date: "4/6", day: "日", ourPrice: 23800, competitorPrice: 23200 },
      { date: "4/7", day: "月", ourPrice: 16200, competitorPrice: 15800 },
      { date: "4/8", day: "火", ourPrice: 16500, competitorPrice: 16200 },
      { date: "4/9", day: "水", ourPrice: 16000, competitorPrice: 15700 },
      { date: "4/10", day: "木", ourPrice: 17000, competitorPrice: 16800 },
      { date: "4/11", day: "金", ourPrice: 20500, competitorPrice: 20000 },
      { date: "4/12", day: "土", ourPrice: 25000, competitorPrice: 24500 },
      { date: "4/13", day: "日", ourPrice: 22500, competitorPrice: 22000 },
      { date: "4/14", day: "月", ourPrice: 14800, competitorPrice: 14500 },
    ]

    const getPrice = (base: number, occ: number) => {
      if (occ === 1) return base;
      if (occ === 2) return Math.round(base * 1.8 / 100) * 100; // 2 people ~1.8x
      if (occ === 3) return Math.round(base * 2.4 / 100) * 100; // 3 people ~2.4x
      // 4名以上は3.0xで統一
      if (occ >= 4) return Math.round(base * 3.0 / 100) * 100; // 4名以上 ~3.0x
      return base;
    };

    // 各日付に対して、選択された人数とホテルの組み合わせでデータを生成
    return dailyData.map((item) => {
      const hotelA_base = Math.round(item.competitorPrice * 1.02 / 100) * 100;
      const hotelB_base = Math.round(item.competitorPrice * 0.95 / 100) * 100;
      const hotelC_base = Math.round(item.competitorPrice * 0.98 / 100) * 100;

      const result: any = {
        date: item.date,
        day: item.day,
      };

      // 選択された各人数に対して当ホテルの価格を追加
      selectedOccupancies.forEach(occ => {
        result[`ourPrice_${occ}名`] = getPrice(item.ourPrice, occ);
      });

      // 選択された各競合ホテルと人数の組み合わせで価格を追加
      selectedCompetitors.forEach(competitor => {
        const basePrice = competitor === "Aホテル" ? hotelA_base :
          competitor === "Bホテル" ? hotelB_base : hotelC_base;
        
        selectedOccupancies.forEach(occ => {
          const key = `${competitor}_${occ}名`;
          result[key] = getPrice(basePrice, occ);
        });
      });

      return result;
    })
  }, [targetMonth, selectedOccupancies, selectedCompetitors])

  const CompetitorTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">{data.date} ({data.day})</p>
          <div className="space-y-1">
            {payload.map((entry: any, index: number) => (
              <p key={index} className="text-xs flex items-center gap-2">
                <span className="w-3 h-0.5" style={{ backgroundColor: entry.color }}></span>
                <span>
                  {entry.name}: ¥{entry.value.toLocaleString()}
                </span>
              </p>
            ))}
          </div>
        </div>
      )
    }
    return null
  }


  // セグメント別クロス分析設定表示の場合
  if (viewMode === "segment-settings") {
    return (
      <div className="p-4">
        <div className="mb-4 flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setViewMode("table")} className="gap-2">
            <BarChart3 className="w-4 h-4" />
            日別分析に戻る
          </Button>
        </div>
        <SegmentCrossAnalysisSettings
          onSave={(settings) => {
            // 設定を保存し、基本分析に反映する処理
            console.log("Settings saved:", settings)
            // 実際の実装では、ここでAPIを呼び出して設定を保存
            // 例: await saveSegmentAnalysisSettings(settings)

            // 保存成功後、設定画面に留まる（ユーザーがさらに調整できるように）
            // または、必要に応じて日別分析画面に戻る
            // setViewMode("table")
          }}
        />
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-balance">日別分析</h2>
          <p className="text-sm text-muted-foreground mt-1">日次パフォーマンスの詳細分析</p>
        </div>
        <Button onClick={() => setViewMode("segment-settings")} variant="outline" size="sm" className="gap-2">
          <Settings className="w-4 h-4" />
          セグメント別クロス分析設定
        </Button>
      </div>

      {/* AI解説セクション - 一番上に配置 */}
      <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <span className="text-xl">🤖</span>
            日別分析インサイト
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2 text-sm leading-relaxed">
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2 flex-shrink-0" />
              <p>
                週末（金・土）の稼働率は平均95.6%と非常に高く、ADRも¥23,300と好調です。この傾向は今後も継続する見込みです。
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--negative)] mt-2 flex-shrink-0" />
              <p>
                月曜日の稼働率が56.7%と最も低く、改善の余地があります。曜日限定のプランの導入を検討してください。
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--chart-2)] mt-2 flex-shrink-0" />
              <p>
                4月5日と12日の土曜日は満室を達成しており、需要が非常に高い状態です。さらなる価格最適化の機会があります。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ControlsとSummaryを1つのCardに統合 */}
      <Card>
        <CardContent className="py-2.5 px-3">
          {/* フィルターコントロール */}
          <div className="flex items-center gap-3 flex-wrap mb-2.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="target-month-daily" className="text-xs whitespace-nowrap">対象月</Label>
              <Select value={targetMonth} onValueChange={setTargetMonth}>
                <SelectTrigger id="target-month-daily" className="h-8 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2025-02">2025年2月</SelectItem>
                  <SelectItem value="2025-03">2025年3月</SelectItem>
                  <SelectItem value="2025-04">2025年4月</SelectItem>
                  <SelectItem value="2025-05">2025年5月</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <Label htmlFor="view-mode" className="text-xs whitespace-nowrap">表示形式</Label>
              <Select
                value="table"
                onValueChange={(value) => {
                  if (value === "table" || value === "segment-settings") {
                    setViewMode(value)
                  }
                }}
              >
                <SelectTrigger id="view-mode" className="h-8 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="table">テーブル表示</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* サマリーカードを横並びに */}
          <div className="grid grid-cols-4 gap-3 border-t pt-2.5">
            <div className="flex flex-col">
              <p className="text-xs text-muted-foreground mb-0.5">月間平均ADR</p>
              <div className="text-lg font-semibold mb-0.5">¥18,250</div>
              <div className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-[color:var(--positive)]" />
                <span className="text-xs text-[color:var(--positive)]">+3.2% vs 前月</span>
              </div>
            </div>

            <div className="flex flex-col">
              <p className="text-xs text-muted-foreground mb-0.5">月間平均稼働率</p>
              <div className="text-lg font-semibold mb-0.5">82.5%</div>
              <div className="flex items-center gap-1">
                <TrendingDown className="w-3 h-3 text-[color:var(--negative)]" />
                <span className="text-xs text-[color:var(--negative)]">-1.8% vs 前月</span>
              </div>
            </div>

            <div className="flex flex-col">
              <p className="text-xs text-muted-foreground mb-0.5">最高ADR日</p>
              <div className="text-lg font-semibold mb-0.5">¥26,500</div>
              <p className="text-xs text-muted-foreground">4月5日（土）</p>
            </div>

            <div className="flex flex-col">
              <p className="text-xs text-muted-foreground mb-0.5">最低ADR日</p>
              <div className="text-lg font-semibold mb-0.5">¥14,800</div>
              <p className="text-xs text-muted-foreground">4月14日（月）</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Daily Performance Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">日別パフォーマンス（2025年4月）</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-medium">日付</th>
                  <th className="text-left py-2 px-2 font-medium">曜日</th>
                  <th className="text-right py-2 px-2 font-medium">販売室数</th>
                  <th className="text-right py-2 px-2 font-medium">稼働率</th>
                  <th className="text-right py-2 px-2 font-medium">ADR</th>
                  <th className="text-right py-2 px-2 font-medium">RevPAR</th>
                  <th className="text-right py-2 px-2 font-medium">室料売上</th>
                  <th className="text-center py-2 px-2 font-medium">前年比</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    date: "4/1",
                    day: "火",
                    rooms: 22000,
                    occ: 73.3,
                    occAi: 75.0,
                    adr: 17200,
                    adrAi: 17500,
                    revpar: 12607,
                    revparAi: 13125,
                    revenue: 378400000,
                    revenueAi: 385000000,
                    yoy: 5.2,
                  },
                  {
                    date: "4/2",
                    day: "水",
                    rooms: 20000,
                    occ: 66.7,
                    occAi: 68.0,
                    adr: 16800,
                    adrAi: 17000,
                    revpar: 11206,
                    revparAi: 11560,
                    revenue: 336000000,
                    revenueAi: 340000000,
                    yoy: 3.8,
                  },
                  {
                    date: "4/3",
                    day: "木",
                    rooms: 24000,
                    occ: 80.0,
                    occAi: 82.0,
                    adr: 17500,
                    adrAi: 17800,
                    revpar: 14000,
                    revparAi: 14596,
                    revenue: 420000000,
                    revenueAi: 427200000,
                    yoy: 8.5,
                  },
                  {
                    date: "4/4",
                    day: "金",
                    rooms: 28000,
                    occ: 93.3,
                    occAi: 95.0,
                    adr: 21500,
                    adrAi: 22000,
                    revpar: 20067,
                    revparAi: 20900,
                    revenue: 602000000,
                    revenueAi: 616000000,
                    yoy: 12.3,
                  },
                  {
                    date: "4/5",
                    day: "土",
                    rooms: 30000,
                    occ: 100.0,
                    occAi: 100.0,
                    adr: 26500,
                    adrAi: 27000,
                    revpar: 26500,
                    revparAi: 27000,
                    revenue: 795000000,
                    revenueAi: 810000000,
                    yoy: 18.7,
                  },
                  {
                    date: "4/6",
                    day: "日",
                    rooms: 29000,
                    occ: 96.7,
                    occAi: 98.0,
                    adr: 23800,
                    adrAi: 24200,
                    revpar: 23013,
                    revparAi: 23716,
                    revenue: 690200000,
                    revenueAi: 701800000,
                    yoy: 15.2,
                  },
                  { 
                    date: "4/7", 
                    day: "月", 
                    rooms: 18000, 
                    occ: 60.0, 
                    occAi: 62.0,
                    adr: 16200, 
                    adrAi: 16500,
                    revpar: 9720, 
                    revparAi: 10230,
                    revenue: 291600000, 
                    revenueAi: 297000000,
                    yoy: 2.1 
                  },
                  {
                    date: "4/8",
                    day: "火",
                    rooms: 21000,
                    occ: 70.0,
                    occAi: 72.0,
                    adr: 16500,
                    adrAi: 16800,
                    revpar: 11550,
                    revparAi: 12096,
                    revenue: 346500000,
                    revenueAi: 352800000,
                    yoy: 4.5,
                  },
                  {
                    date: "4/9",
                    day: "水",
                    rooms: 19000,
                    occ: 63.3,
                    occAi: 65.0,
                    adr: 16000,
                    adrAi: 16200,
                    revpar: 10133,
                    revparAi: 10530,
                    revenue: 304000000,
                    revenueAi: 307800000,
                    yoy: 1.8,
                  },
                  {
                    date: "4/10",
                    day: "木",
                    rooms: 23000,
                    occ: 76.7,
                    occAi: 78.0,
                    adr: 17000,
                    adrAi: 17300,
                    revpar: 13033,
                    revparAi: 13494,
                    revenue: 391000000,
                    revenueAi: 397900000,
                    yoy: 6.9,
                  },
                  {
                    date: "4/11",
                    day: "金",
                    rooms: 27000,
                    occ: 90.0,
                    occAi: 92.0,
                    adr: 20500,
                    adrAi: 21000,
                    revpar: 18450,
                    revparAi: 19320,
                    revenue: 553500000,
                    revenueAi: 567000000,
                    yoy: 10.8,
                  },
                  {
                    date: "4/12",
                    day: "土",
                    rooms: 30000,
                    occ: 100.0,
                    occAi: 100.0,
                    adr: 25000,
                    adrAi: 25500,
                    revpar: 25000,
                    revparAi: 25500,
                    revenue: 750000000,
                    revenueAi: 765000000,
                    yoy: 16.4,
                  },
                  {
                    date: "4/13",
                    day: "日",
                    rooms: 28000,
                    occ: 93.3,
                    occAi: 95.0,
                    adr: 22500,
                    adrAi: 23000,
                    revpar: 21000,
                    revparAi: 21850,
                    revenue: 630000000,
                    revenueAi: 644000000,
                    yoy: 13.5,
                  },
                  {
                    date: "4/14",
                    day: "月",
                    rooms: 16000,
                    occ: 53.3,
                    occAi: 55.0,
                    adr: 14800,
                    adrAi: 15000,
                    revpar: 7893,
                    revparAi: 8250,
                    revenue: 236800000,
                    revenueAi: 240000000,
                    yoy: -2.3,
                  },
                ].map((row) => {
                  const isPast = isPastDate(row.date, targetMonth)
                  return (
                    <tr
                      key={row.date}
                      className={`border-b hover:bg-muted/50 cursor-pointer ${isPast ? "opacity-60" : ""}`}
                      onClick={() => setSelectedDateForCurve(`${targetMonth.split("-")[0]}年${targetMonth.split("-")[1]}月${row.date}`)}
                    >
                      <td className={`py-2 px-2 font-medium ${selectedDateForCurve?.includes(row.date) ? "bg-blue-100 dark:bg-blue-900" : ""}`}>{row.date}</td>
                      <td className="py-2 px-2">
                        <Badge variant={row.day === "土" || row.day === "日" ? "default" : "outline"} className="text-xs">{row.day}</Badge>
                      </td>
                      <td className="text-right py-2 px-2">{row.rooms}室</td>
                      <td className="text-right py-2 px-2">
                        {isPast ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[color:var(--muted-foreground)] text-[10px]">実績: {row.occ.toFixed(1)}%</span>
                            <span className="text-[color:var(--muted-foreground)] text-[10px]">AI推奨: {row.occAi.toFixed(1)}%</span>
                          </div>
                        ) : (
                          <span
                            className={
                              row.occAi >= 90
                                ? "text-[color:var(--positive)] font-medium"
                                : row.occAi < 70
                                  ? "text-[color:var(--negative)]"
                                  : ""
                            }
                          >
                            {row.occAi.toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="text-right py-2 px-2">
                        {isPast ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[color:var(--muted-foreground)] text-[10px]">実績: ¥{row.adr.toLocaleString()}</span>
                            <span className="text-[color:var(--muted-foreground)] text-[10px]">AI推奨: ¥{row.adrAi.toLocaleString()}</span>
                          </div>
                        ) : (
                          <>¥{row.adrAi.toLocaleString()}</>
                        )}
                      </td>
                      <td className="text-right py-2 px-2">
                        {isPast ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[color:var(--muted-foreground)] text-[10px]">実績: ¥{row.revpar.toLocaleString()}</span>
                            <span className="text-[color:var(--muted-foreground)] text-[10px]">AI推奨: ¥{row.revparAi.toLocaleString()}</span>
                          </div>
                        ) : (
                          <>¥{row.revparAi.toLocaleString()}</>
                        )}
                      </td>
                      <td className="text-right py-2 px-2 font-medium">
                        {isPast ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[color:var(--muted-foreground)] text-[10px]">実績: ¥{row.revenue.toLocaleString()}</span>
                            <span className="text-[color:var(--muted-foreground)] text-[10px]">AI推奨: ¥{row.revenueAi.toLocaleString()}</span>
                          </div>
                        ) : (
                          <>¥{row.revenueAi.toLocaleString()}</>
                        )}
                      </td>
                      <td className="text-center py-2 px-2">
                        {isPast ? (
                          <span className={row.yoy >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"}>
                            {row.yoy >= 0 ? "+" : ""}
                            {row.yoy.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-[color:var(--muted-foreground)]">-</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="border-t-2">
                <tr className="bg-muted/30">
                  <td className="py-2 px-2 font-semibold" colSpan={2}>
                    合計 / 平均
                  </td>
                  <td className="text-right py-2 px-2 font-semibold">335,000室</td>
                  <td className="text-right py-2 px-2 font-semibold">79.8%</td>
                  <td className="text-right py-2 px-2 font-semibold">¥19,107</td>
                  <td className="text-right py-2 px-2 font-semibold">¥15,248</td>
                  <td className="text-right py-2 px-2 font-semibold">¥6,405,000,000</td>
                  <td className="text-center py-2 px-2 font-semibold text-[color:var(--positive)]">+8.4%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Booking Curve Graph */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">ブッキングカーブグラフ（月単位）</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {selectedDateForCurve ? `${selectedDateForCurve}の予約状況` : "日付を選択してブッキングカーブを表示"}
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          {selectedDateForCurve && bookingCurveData.length > 0 ? (
            <div className="space-y-4">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={bookingCurveData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                  <XAxis
                    dataKey="monthsBefore"
                    tick={{ fontSize: 11 }}
                    stroke="currentColor"
                    opacity={0.5}
                    reversed={true}
                    type="number"
                    domain={[0, 6]}
                    label={{ value: '宿泊日からの月数', position: 'insideBottom', offset: -5, style: { textAnchor: 'middle', fontSize: 12 } }}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="currentColor"
                    opacity={0.5}
                    domain={[0, 32000]}
                    label={{ value: '予約室数', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 12 } }}
                  />
                  <Tooltip content={<BookingCurveTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  <Line
                    type="monotone"
                    dataKey="cumulative"
                    stroke="#2563eb"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    name="累積予約室数"
                  />
                  <Line
                    type="monotone"
                    dataKey="bookings"
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="当月予約室数"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-muted-foreground">
              上のテーブルから日付をクリックしてブッキングカーブを表示してください
            </div>
          )}
        </CardContent>
      </Card>

      {/* Day of Week Analysis */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">曜日別パフォーマンス分析</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-medium">曜日</th>
                  <th className="text-right py-2 px-2 font-medium">平均稼働率</th>
                  <th className="text-right py-2 px-2 font-medium">平均ADR</th>
                  <th className="text-right py-2 px-2 font-medium">平均RevPAR</th>
                  <th className="text-right py-2 px-2 font-medium">前年比</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { day: "月曜日", occ: 56.7, adr: 15500, revpar: 8807, yoy: -0.1 },
                  { day: "火曜日", occ: 71.7, adr: 16900, revpar: 12117, yoy: 4.9 },
                  { day: "水曜日", occ: 65.0, adr: 16400, revpar: 10660, yoy: 2.8 },
                  { day: "木曜日", occ: 78.4, adr: 17250, revpar: 13517, yoy: 7.7 },
                  { day: "金曜日", occ: 91.7, adr: 21000, revpar: 19258, yoy: 11.6 },
                  { day: "土曜日", occ: 100.0, adr: 25750, revpar: 25750, yoy: 17.6 },
                  { day: "日曜日", occ: 95.0, adr: 23150, revpar: 21993, yoy: 14.4 },
                ].map((row) => (
                  <tr key={row.day} className="border-b hover:bg-muted/50">
                    <td className="py-2 px-2 font-medium">{row.day}</td>
                    <td className="text-right py-2 px-2">{row.occ.toFixed(1)}%</td>
                    <td className="text-right py-2 px-2">¥{row.adr.toLocaleString()}</td>
                    <td className="text-right py-2 px-2">¥{row.revpar.toLocaleString()}</td>
                    <td className="text-right py-2 px-2">
                      <span className={row.yoy >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"}>
                        {row.yoy >= 0 ? "+" : ""}
                        {row.yoy.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Competitor Comparison Section */}
      <Card className="border-l-4 border-l-orange-500">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              競合ホテルとの価格比較分析
            </CardTitle>
            <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">利用人数:</Label>
                <div className="flex items-center gap-3 flex-wrap">
                  {[1, 2, 3].map((occ) => (
                    <div key={occ} className="flex items-center gap-1.5">
                      <Checkbox
                        id={`occupancy-${occ}`}
                        checked={selectedOccupancies.includes(occ)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedOccupancies([...selectedOccupancies, occ].sort())
                          } else {
                            const newOccupancies = selectedOccupancies.filter(o => o !== occ)
                            // 少なくとも1つは選択されている必要がある
                            if (newOccupancies.length > 0) {
                              setSelectedOccupancies(newOccupancies)
                            }
                          }
                        }}
                      />
                      <Label htmlFor={`occupancy-${occ}`} className="text-xs cursor-pointer">
                        {occ}名利用
                      </Label>
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <Checkbox
                      id="occupancy-4plus"
                      checked={selectedOccupancies.some(o => o >= 4)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          // 4名以上を選択（4として扱う）
                          if (!selectedOccupancies.includes(4)) {
                            setSelectedOccupancies([...selectedOccupancies, 4].sort())
                          }
                        } else {
                          // 4名以上を削除
                          setSelectedOccupancies(selectedOccupancies.filter(o => o < 4))
                        }
                      }}
                    />
                    <Label htmlFor="occupancy-4plus" className="text-xs cursor-pointer">
                      4名以上
                    </Label>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">比較ホテル:</Label>
                <div className="flex items-center gap-3">
                  {["Aホテル", "Bホテル", "Cホテル"].map((hotel) => (
                    <div key={hotel} className="flex items-center gap-1.5">
                      <Checkbox
                        id={`competitor-${hotel}`}
                        checked={selectedCompetitors.includes(hotel)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedCompetitors([...selectedCompetitors, hotel])
                          } else {
                            const newCompetitors = selectedCompetitors.filter(h => h !== hotel)
                            // 少なくとも1つは選択されている必要がある
                            if (newCompetitors.length > 0) {
                              setSelectedCompetitors(newCompetitors)
                            }
                          }
                        }}
                      />
                      <Label htmlFor={`competitor-${hotel}`} className="text-xs cursor-pointer">
                        {hotel}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {/* 注意事項アラート */}
          <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle className="text-sm font-semibold text-amber-900 dark:text-amber-100">データ取り扱いに関する注意事項</AlertTitle>
            <AlertDescription className="text-xs text-amber-800 dark:text-amber-200 mt-1 space-y-1">
              <p>• 競合データは参考値であり、実際の価格設定には複数の要因（立地、設備、サービス品質等）を総合的に考慮してください。</p>
              <p>• データソース: OTA公開価格の平均値（サンプル数: 5-8ホテル）</p>
              <p>• データ取得日時: {new Date().toLocaleString("ja-JP")}</p>
              <p>• 誤った情報による混乱を避けるため、運用面で慎重な対応をお願いします。</p>
            </AlertDescription>
          </Alert>

          {/* サマリーカード - ホテルごとに行を分けて表示 */}
          <div className="space-y-3">
            {selectedCompetitors.map(competitor => (
              <div key={competitor} className="space-y-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold">{competitor}</h4>
                  <div className="flex-1 border-t border-border"></div>
                </div>
                <div className="flex gap-3 flex-wrap">
                  {selectedOccupancies.map(occ => {
                    const ourAvg = competitorComparisonData.reduce((sum, d) => sum + (d[`ourPrice_${occ}名`] || 0), 0) / competitorComparisonData.length;
                    const compAvg = competitorComparisonData.reduce((sum, d) => sum + (d[`${competitor}_${occ}名`] || 0), 0) / competitorComparisonData.length;
                    const diff = ourAvg - compAvg;
                    const diffPercent = (diff / compAvg) * 100;
                    
                    return (
                      <Card key={`${competitor}-${occ}`} className="min-w-[200px] flex-1 max-w-[250px]">
                        <CardContent className="py-2.5 px-3">
                          <p className="text-xs text-muted-foreground mb-1">{occ >= 4 ? "4名以上" : `${occ}名`}</p>
                          <div className="text-lg font-semibold mb-0.5">
                            ¥{Math.round(ourAvg).toLocaleString()} / ¥{Math.round(compAvg).toLocaleString()}
                          </div>
                          <div className={`text-sm font-medium ${diff >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"}`}>
                            {diff >= 0 ? "+" : ""}¥{Math.abs(Math.round(diff)).toLocaleString()} ({diff >= 0 ? "+" : ""}{diffPercent.toFixed(1)}%)
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">当ホテル / {competitor}</p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* 日別価格推移グラフ - 複数の人数とホテルに対応 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">日別価格推移比較</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={competitorComparisonData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <defs>
                    {selectedOccupancies.map((occ, idx) => (
                      <linearGradient key={`our-${occ}`} id={`colorOurPrice_${occ}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={idx === 0 ? "#2563eb" : idx === 1 ? "#10b981" : "#8b5cf6"} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={idx === 0 ? "#2563eb" : idx === 1 ? "#10b981" : "#8b5cf6"} stopOpacity={0} />
                    </linearGradient>
                    ))}
                    {selectedCompetitors.flatMap((comp, compIdx) =>
                      selectedOccupancies.map((occ, occIdx) => (
                        <linearGradient key={`comp-${comp}-${occ}`} id={`colorCompetitorPrice_${comp}_${occ}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={compIdx === 0 ? "#ef4444" : compIdx === 1 ? "#f59e0b" : "#ec4899"} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={compIdx === 0 ? "#ef4444" : compIdx === 1 ? "#f59e0b" : "#ec4899"} stopOpacity={0} />
                    </linearGradient>
                      ))
                    )}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    stroke="currentColor"
                    opacity={0.5}
                    label={{ value: '日付', position: 'insideBottom', offset: -5, style: { textAnchor: 'middle', fontSize: 11 } }}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    stroke="currentColor"
                    opacity={0.5}
                    tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                    label={{ value: '価格', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 11 } }}
                  />
                  <Tooltip content={<CompetitorTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  {selectedOccupancies.map((occ, idx) => (
                  <Area
                      key={`our-${occ}`}
                    type="monotone"
                      dataKey={`ourPrice_${occ}名`}
                      stroke={idx === 0 ? "#2563eb" : idx === 1 ? "#10b981" : "#8b5cf6"}
                    strokeWidth={2}
                    fillOpacity={1}
                      fill={`url(#colorOurPrice_${occ})`}
                      name={`当ホテル (${occ >= 4 ? "4名以上" : `${occ}名`})`}
                  />
                  ))}
                  {selectedCompetitors.flatMap((comp, compIdx) =>
                    selectedOccupancies.map((occ, occIdx) => (
                  <Area
                        key={`comp-${comp}-${occ}`}
                    type="monotone"
                        dataKey={`${comp}_${occ}名`}
                        stroke={compIdx === 0 ? "#ef4444" : compIdx === 1 ? "#f59e0b" : "#ec4899"}
                    strokeWidth={2}
                    fillOpacity={1}
                        fill={`url(#colorCompetitorPrice_${comp}_${occ})`}
                        name={`${comp} (${occ >= 4 ? "4名以上" : `${occ}名`})`}
                        strokeDasharray={occIdx > 0 ? "5 5" : undefined}
                  />
                    ))
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* 価格差の可視化 - 複数の組み合わせに対応 */}
          {selectedOccupancies.flatMap(occ =>
            selectedCompetitors.map(competitor => {
              const priceDiffData = competitorComparisonData.map(d => ({
                ...d,
                priceDifference: (d[`ourPrice_${occ}名`] || 0) - (d[`${competitor}_${occ}名`] || 0)
              }));
              
              return (
                <Card key={`diff-${competitor}-${occ}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">価格差の可視化</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">当ホテルと{competitor}の価格差 ({occ >= 4 ? "4名以上" : `${occ}名`})</p>
            </CardHeader>
            <CardContent className="pt-0">
              <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={priceDiffData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    stroke="currentColor"
                    opacity={0.5}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    stroke="currentColor"
                    opacity={0.5}
                    tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                    label={{ value: '価格差', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 11 } }}
                  />
                  <Tooltip content={<CompetitorTooltip />} />
                  <Bar
                    dataKey="priceDifference"
                    radius={[4, 4, 0, 0]}
                    name="価格差"
                  >
                          {priceDiffData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.priceDifference >= 0 ? "#2563eb" : "#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
              );
            })
          )}

          {/* 曜日別競合価格比較テーブル - 複数の人数とホテルに対応 */}
          {selectedOccupancies.map(occ => {
            const weekdayData = [
                      { day: "月曜日", ourPrice: 15500, competitorPrice: 15200 },
                      { day: "火曜日", ourPrice: 16900, competitorPrice: 16500 },
                      { day: "水曜日", ourPrice: 16400, competitorPrice: 16000 },
                      { day: "木曜日", ourPrice: 17250, competitorPrice: 16800 },
                      { day: "金曜日", ourPrice: 21000, competitorPrice: 20500 },
                      { day: "土曜日", ourPrice: 25750, competitorPrice: 25200 },
                      { day: "日曜日", ourPrice: 23150, competitorPrice: 22800 },
            ];

                      const getPrice = (base: number, occ: number) => {
                        if (occ === 1) return base;
                        if (occ === 2) return Math.round(base * 1.8 / 100) * 100;
              if (occ === 3) return Math.round(base * 2.4 / 100) * 100;
              // 4名以上は3.0xで統一
              if (occ >= 4) return Math.round(base * 3.0 / 100) * 100;
              return base;
            };

            const adjustedCompBase = (base: number, competitor: string) => {
              if (competitor === "Bホテル") return base * 0.95;
              if (competitor === "Cホテル") return base * 0.98;
              return base * 1.02;
            };

            return (
              <Card key={`table-${occ}`}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">曜日別競合価格比較 ({occ >= 4 ? "4名以上" : `${occ}名`})</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-2 font-medium">曜日</th>
                          <th className="text-right py-2 px-2 font-medium">当ホテル</th>
                          {selectedCompetitors.map(competitor => (
                            <>
                              <th key={`${competitor}-price`} className="text-right py-2 px-2 font-medium">{competitor}</th>
                              <th key={`${competitor}-diff`} className="text-right py-2 px-2 font-medium">価格差</th>
                              <th key={`${competitor}-percent`} className="text-right py-2 px-2 font-medium">差額率</th>
                            </>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {weekdayData.map((row) => {
                          const ourPrice = getPrice(row.ourPrice, occ);
                          
                      return (
                        <tr key={row.day} className="border-b hover:bg-muted/50">
                          <td className="py-2 px-2 font-medium">{row.day}</td>
                              <td className="text-right py-2 px-2 font-medium">¥{ourPrice.toLocaleString()}</td>
                              {selectedCompetitors.map(competitor => {
                                const compPrice = getPrice(adjustedCompBase(row.competitorPrice, competitor), occ);
                                const diff = ourPrice - compPrice;
                                const diffPercent = ((diff / compPrice) * 100).toFixed(1);
                                
                                return (
                                  <>
                                    <td key={`${competitor}-${row.day}-price`} className="text-right py-2 px-2">¥{compPrice.toLocaleString()}</td>
                                    <td key={`${competitor}-${row.day}-diff`} className={`text-right py-2 px-2 font-medium ${diff >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"}`}>
                            {diff >= 0 ? "+" : ""}¥{Math.abs(diff).toLocaleString()}
                          </td>
                                    <td key={`${competitor}-${row.day}-percent`} className={`text-right py-2 px-2 ${diff >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"}`}>
                            {diff >= 0 ? "+" : ""}{diffPercent}%
                          </td>
                                  </>
                                );
                              })}
                        </tr>
                          );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
            );
          })}
        </CardContent>
      </Card>

    </div>
  )
}
