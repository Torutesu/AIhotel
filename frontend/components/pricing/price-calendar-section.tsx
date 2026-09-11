"use client"

// 日別価格カレンダー（テーブル／タイプ別人数別カレンダー）と価格推移グラフ
// （U-15 で pricing-tab.tsx から分割）。GET /pricing/calendar の実データを表示する。

import { useMemo, useState } from "react"
import { Calendar, Info, Table2 } from "lucide-react"
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Bar,
  ComposedChart,
  Legend,
} from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useWeekend } from "@/hooks/use-weekend"
import {
  ROOM_TYPES,
  demandBadgeClass,
  getRankBadgeColor,
  holidayNameOf,
  specialDayNameOf,
  type MonthCalendar,
} from "@/components/pricing/pricing-constants"
import { DAY_NAMES, monthLabel as monthLabelOf } from "@/lib/date"
import {
  formatPercent as pct,
  formatSignedPt as signedPt,
  formatSignedYen as signedYen,
  formatYen as yen,
} from "@/lib/format"
import { toNumber, type ChartTooltipEntry, type ChartTooltipProps } from "@/lib/chart-tooltip"
import type { PricingCalendarDay } from "@/lib/api"

interface PriceCalendarSectionProps {
  monthData: MonthCalendar
  /** 日別分析から遷移してきた日（該当行を強調してスクロールする） */
  highlightedDate: string | null
  /** 日別メモ（イベント情報・外部要因） */
  eventInfoMap: Record<string, { eventInfo?: string; externalFactors?: string }>
  /** テーブル行のクリックでAI分析ダイアログを開く */
  onSelectRowForAnalysis: (day: PricingCalendarDay) => void
  /** カレンダーのセルクリックで詳細ダイアログを開く */
  onSelectDay: (day: PricingCalendarDay) => void
}

/** 価格推移グラフのツールチップ */
function PricingTooltip({ active, payload }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-lg border border-border bg-background p-3 shadow-lg">
      <p className="mb-2 text-sm font-medium">{payload[0].payload?.date}</p>
      <div className="space-y-1">
        {payload.map((entry: ChartTooltipEntry, index: number) => {
          const name = String(entry.name ?? "")
          const value = toNumber(entry.value)
          return (
            <p key={index} className="flex items-center gap-2 text-xs">
              <span className="h-0.5 w-3" style={{ backgroundColor: entry.color }}></span>
              <span>
                {name}:{" "}
                {name.includes("価格") || name.includes("ADR")
                  ? `¥${Math.round(value).toLocaleString()}`
                  : `${Math.round(value)}%`}
              </span>
            </p>
          )
        })}
      </div>
    </div>
  )
}

export function PriceCalendarSection({
  monthData,
  highlightedDate,
  eventInfoMap,
  onSelectRowForAnalysis,
  onSelectDay,
}: PriceCalendarSectionProps) {
  const { isWeekendDow } = useWeekend()
  const [calendarViewMode, setCalendarViewMode] = useState<"table" | "grid">("table")
  // タイプ別人数別カレンダーの表示タイプ（全タイプ表示なし。デフォルトはマスタの先頭タイプ）
  const [gridRoomType, setGridRoomType] = useState(ROOM_TYPES[0].value)

  const days = monthData.calendar
  const chartData = useMemo(
    () =>
      days.map((d) => {
        const [, , dayNum] = d.date.split("-")
        return {
          date: `${monthData.month}/${Number(dayNum)}`,
          actualAdr: d.actualAdr,
          predictedAdr: d.predictedAdr,
          predictedOccupancy:
            d.predictedOccupancy != null ? Math.round(d.predictedOccupancy * 1000) / 10 : null,
        }
      }),
    [days, monthData.month],
  )

  return (
        <div key={`${monthData.year}-${monthData.month}`} className="space-y-3">
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <h3 className="text-base font-semibold">
              日別価格カレンダー（{monthLabelOf(monthData.year, monthData.month)}）
            </h3>
            <div className="flex items-center gap-2">
              <Button
                variant={calendarViewMode === "table" ? "default" : "outline"}
                size="sm"
                onClick={() => setCalendarViewMode("table")}
              >
                <Table2 className="w-4 h-4 mr-2" />
                テーブル表示
              </Button>
              <Button
                variant={calendarViewMode === "grid" ? "default" : "outline"}
                size="sm"
                onClick={() => setCalendarViewMode("grid")}
              >
                <Calendar className="w-4 h-4 mr-2" />
                タイプ別人数別カレンダー
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            曜日欄の色: <span className="text-negative font-medium">祝日</span> / <span className="text-warning font-medium">特日（お盆・年末年始等）</span>
            。特日はAIが候補を提示し、オペレーターがマスタ設定画面で修正できます。
          </p>

          {days.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">この月のデータがありません。</p>
          ) : calendarViewMode === "table" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 font-medium">日付</th>
                    <th className="text-left py-2 px-2 font-medium">曜日</th>
                    <th className="text-center py-2 px-2 font-medium">
                      <TooltipProvider>
                        <UITooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center justify-center gap-1 cursor-help">
                              アラート
                              <Info className="w-3.5 h-3.5 text-muted-foreground" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p className="text-xs">需要水準のアラート（A: 需要が非常に高い 〜 E: 需要が非常に低い）です。</p>
                          </TooltipContent>
                        </UITooltip>
                      </TooltipProvider>
                    </th>
                    <th className="text-right py-2 px-2 font-medium">現在ADR</th>
                    <th className="text-right py-2 px-2 font-medium">推奨ADR（AI）</th>
                    <th className="text-right py-2 px-2 font-medium">稼働率予測（AI）</th>
                    <th className="text-center py-2 px-2 font-medium">
                      現在料金ランク
                      <span className="block text-[10px] font-normal text-muted-foreground">（サイトコントローラー）</span>
                    </th>
                    <th className="text-center py-2 px-2 font-medium">推奨料金ランク（AI）</th>
                    <th className="text-right py-2 px-2 font-medium">ADR結果</th>
                    <th className="text-right py-2 px-2 font-medium">稼働率結果</th>
                    <th className="text-right py-2 px-2 font-medium">
                      <TooltipProvider>
                        <UITooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center justify-end gap-1 cursor-help">
                              推奨ADR差異
                              <Info className="w-3.5 h-3.5 text-muted-foreground" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p className="text-xs">実績と推奨値の差異です。AIの学習およびAIコメント（良かった・悪かった等）の材料になります。</p>
                          </TooltipContent>
                        </UITooltip>
                      </TooltipProvider>
                    </th>
                    <th className="text-right py-2 px-2 font-medium">推奨稼働率差異</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => {
                    const [, , dayNum] = day.date.split("-")
                    const dateObj = new Date(day.date)
                    const dow = dateObj.getDay()
                    const holiday = holidayNameOf(dateObj)
                    const special = specialDayNameOf(dateObj)
                    const isActualDay = day.actualAdr != null
                    // 現在ADRは実績（actualAdr）のみ。未確定日はサイトコントローラー未連携のため「-」
                    const currentAdr = day.actualAdr
                    const adrDiff = day.actualAdr != null && day.predictedAdr != null ? day.actualAdr - day.predictedAdr : null
                    const occDiff =
                      day.actualOccupancy != null && day.predictedOccupancy != null
                        ? day.actualOccupancy - day.predictedOccupancy
                        : null
                    // 特日 > 祝日 > 週末（Hotel.weekendDays）の順で色付け（色のみで表現、特日は別色）
                    const dayColorClass = special
                      ? "text-warning font-semibold"
                      : holiday
                        ? "text-negative font-semibold"
                        : isWeekendDow(dow)
                          ? "text-primary font-medium"
                          : ""
                    return (
                      <tr
                        key={day.date}
                        // 日別分析から遷移してきた日は、行を強調して画面内へスクロールする
                        ref={
                          day.date === highlightedDate
                            ? (el) => el?.scrollIntoView({ block: "center" })
                            : undefined
                        }
                        // 行クリックはキーボードからも実行できるようにする（U-14）
                        role="button"
                        tabIndex={0}
                        aria-label={`${monthData.month}月${Number(dayNum)}日のAI分析を開く`}
                        onClick={() => onSelectRowForAnalysis(day)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            onSelectRowForAnalysis(day)
                          }
                        }}
                        className={`border-b hover:bg-muted/50 cursor-pointer transition-colors focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                          day.date === highlightedDate ? "bg-primary/10 ring-1 ring-primary/40" : ""
                        }`}
                      >
                        <td className="py-2 px-2 font-medium">
                          {monthData.month}/{Number(dayNum)}
                        </td>
                        <td className={`py-2 px-2 ${dayColorClass}`}>
                          {DAY_NAMES[dow]}
                          {(special || holiday) && (
                            <span className="block text-[9px] leading-tight">{special ?? holiday}</span>
                          )}
                        </td>
                        <td className="text-center py-2 px-2">
                          {day.demandLevel ? (
                            <Badge className={`${demandBadgeClass(day.demandLevel)} text-xs`}>{day.demandLevel}</Badge>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="text-right py-2 px-2">{yen(currentAdr)}</td>
                        <td className="text-right py-2 px-2 font-semibold">{yen(day.predictedAdr)}</td>
                        <td className="text-right py-2 px-2">{pct(day.predictedOccupancy)}</td>
                        {/* サイトコントローラー連携が未実装のため、現在ランクは取得元が無い（U-7） */}
                        <td className="text-center py-2 px-2">
                          <span className="text-muted-foreground text-[10px]">未連携</span>
                        </td>
                        <td className="text-center py-2 px-2">
                          {day.rankLabel ? (
                            <Badge className={`${getRankBadgeColor(day.recommendedRank ?? 0)} text-xs font-bold px-2`}>
                              {day.rankLabel}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </td>
                        {/* 結果・差異は実績に変わった日のみ数値を表示 */}
                        <td className="text-right py-2 px-2">{isActualDay ? yen(day.actualAdr) : "-"}</td>
                        <td className="text-right py-2 px-2">{isActualDay ? pct(day.actualOccupancy) : "-"}</td>
                        <td
                          className={`text-right py-2 px-2 ${
                            adrDiff == null ? "" : adrDiff >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"
                          }`}
                        >
                          {adrDiff != null ? signedYen(adrDiff) : "-"}
                        </td>
                        <td
                          className={`text-right py-2 px-2 ${
                            occDiff == null ? "" : occDiff >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"
                          }`}
                        >
                          {occDiff != null ? signedPt(occDiff) : "-"}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <PriceGrid
              year={monthData.year}
              month={monthData.month}
              days={days}
              eventInfoMap={eventInfoMap}
              roomType={gridRoomType}
              onRoomTypeChange={setGridRoomType}
              onSelectDay={onSelectDay}
            />
          )}

          {/* 価格推移グラフ */}
          <div className="mt-6 pt-6 border-t">
            <h3 className="text-base font-semibold mb-3">価格推移グラフ</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-xs flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-0.5 bg-positive"></div>
                  <span>実績ADR</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-0.5 bg-[color:var(--chart-2)]"></div>
                  <span>AI予測ADR</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-warning/40 rounded"></div>
                  <span>稼働率予測</span>
                </div>
              </div>

              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
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
                  <Bar yAxisId="right" dataKey="predictedOccupancy" fill="#fed7aa" opacity={0.5} name="稼働率予測" />
                  <Line yAxisId="left" type="monotone" dataKey="actualAdr" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} name="実績ADR" connectNulls={false} />
                  <Line yAxisId="left" type="monotone" dataKey="predictedAdr" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} name="AI予測ADR" connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
  )
}

function PriceGrid({
  year,
  month,
  days,
  eventInfoMap,
  roomType,
  onRoomTypeChange,
  onSelectDay,
}: {
  year: number
  month: number
  days: PricingCalendarDay[]
  eventInfoMap: Record<string, { eventInfo?: string; externalFactors?: string }>
  roomType: string
  onRoomTypeChange: (value: string) => void
  onSelectDay: (day: PricingCalendarDay) => void
}) {
  const { isWeekendDow } = useWeekend()
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])
  const firstDay = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const startDayOfWeek = firstDay.getDay()
  const prevMonthDays = new Date(year, month - 1, 0).getDate()
  const weeks = Math.ceil((daysInMonth + startDayOfWeek) / 7)

  const selectedType = ROOM_TYPES.find((t) => t.value === roomType) ?? ROOM_TYPES[0]
  const priceOf = (base: number | null | undefined): string => {
    if (base == null) return "-"
    return Math.round(base * selectedType.priceFactor).toLocaleString()
  }

  const cells: Array<{ date: number; isCurrentMonth: boolean; dayOfWeek: number; data?: PricingCalendarDay }> = []

  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    cells.push({ date: prevMonthDays - i, isCurrentMonth: false, dayOfWeek: (i + 7 - startDayOfWeek) % 7 })
  }
  for (let date = 1; date <= daysInMonth; date++) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`
    const dow = (startDayOfWeek + date - 1) % 7
    cells.push({ date, isCurrentMonth: true, dayOfWeek: dow, data: byDate.get(key) })
  }
  const remaining = weeks * 7 - cells.length
  for (let date = 1; date <= remaining; date++) {
    cells.push({ date, isCurrentMonth: false, dayOfWeek: (cells.length) % 7 })
  }

  return (
    <div className="space-y-2">
      {/* 表示タイプ選択（全タイプ表示なし。デフォルトはマスタ先頭のタイプ。ランクは利用人数にかかわらず共通） */}
      <div className="flex items-center gap-1.5">
        <Label htmlFor="grid-room-type" className="text-xs whitespace-nowrap">表示タイプ</Label>
        <Select value={roomType} onValueChange={onRoomTypeChange}>
          <SelectTrigger id="grid-room-type" className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROOM_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[10px] text-muted-foreground ml-2">料金ランクは利用人数にかかわらず共通です</span>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          <div className="grid grid-cols-7 gap-px border-b mb-1">
            {DAY_NAMES.map((day) => (
              <div key={day} className="text-center py-2 text-sm font-medium">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px border">
            {cells.map((cell, index) => {
              const key = `${year}-${String(month).padStart(2, "0")}-${String(cell.date).padStart(2, "0")}-${index}`
              const info = cell.isCurrentMonth
                ? eventInfoMap[`${year}-${String(month).padStart(2, "0")}-${String(cell.date).padStart(2, "0")}`]
                : undefined
              return (
                <div
                  key={key}
                  // 日セルはクリックで詳細を開くため、キーボードからも操作できるようにする（U-14）
                  role={cell.isCurrentMonth && cell.data ? "button" : undefined}
                  tabIndex={cell.isCurrentMonth && cell.data ? 0 : undefined}
                  aria-label={
                    cell.isCurrentMonth && cell.data
                      ? `${month}月${cell.date}日の詳細を開く`
                      : undefined
                  }
                  onClick={() => cell.isCurrentMonth && cell.data && onSelectDay(cell.data)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && cell.isCurrentMonth && cell.data) {
                      e.preventDefault()
                      onSelectDay(cell.data)
                    }
                  }}
                  className={`
                    min-h-[110px] p-2 text-xs relative
                    ${cell.isCurrentMonth ? "" : "opacity-30"}
                    ${isWeekendDow(cell.dayOfWeek) ? "bg-primary/5" : ""}
                    border-r border-b
                    ${cell.isCurrentMonth && cell.data ? "cursor-pointer hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" : ""}
                  `}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div
                      className={`font-medium inline-flex items-center justify-center ${
                        isWeekendDow(cell.dayOfWeek) ? "text-primary" : ""
                      }`}
                    >
                      {cell.date}
                    </div>
                    {cell.isCurrentMonth && cell.data?.rankLabel && (
                      <Badge className={`${getRankBadgeColor(cell.data.recommendedRank ?? 0)} text-[9px] font-bold px-1 py-0 h-4`}>
                        {cell.data.rankLabel}
                      </Badge>
                    )}
                  </div>

                  {info && (info.eventInfo || info.externalFactors) && (
                    <div className="mb-1">
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                        {(info.eventInfo ? "イベント" : "") + (info.eventInfo && info.externalFactors ? "・" : "") + (info.externalFactors ? "要因" : "")}
                      </Badge>
                    </div>
                  )}

                  {cell.isCurrentMonth && cell.data ? (
                    <div className="space-y-0.5 text-[10px] leading-tight mt-1">
                      <div>1名-{priceOf(cell.data.price1P)}</div>
                      <div>2名-{priceOf(cell.data.price2P)}</div>
                      <div>3名-{priceOf(cell.data.price3P)}</div>
                    </div>
                  ) : cell.isCurrentMonth ? (
                    <div className="text-[10px] text-muted-foreground mt-1">データなし</div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
