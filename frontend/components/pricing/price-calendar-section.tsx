"use client"

// 日別価格カレンダー（テーブル／タイプ別人数別カレンダー）と 個人団体別 オンハンド状況
// （U-15 で pricing-tab.tsx から分割）。GET /pricing/calendar の実データを表示する。
// 2026-10 の画面修正（DP02）で、オペレーターが価格を決める表として 予算・現在・AI の推奨を並べた。
// 結果（ADR・稼働率・売上）と想定との差異は 分析 > 日別パフォーマンス へ移した。

import { useMemo, useState } from "react"
import { Calendar, Info, Table2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useWeekend } from "@/hooks/use-weekend"
import {
  demandBadgeClass,
  eventsOnDate,
  getRankBadgeColor,
  holidayNameOf,
  specialDayNameOf,
  type MonthCalendar,
} from "@/components/pricing/pricing-constants"
import { DAY_NAMES, monthLabel as monthLabelOf } from "@/lib/date"
import { formatPercent as pct, formatYen as yen } from "@/lib/format"
import { DayTypeBadge, DayTypeHelp } from "@/components/pricing/day-type"
import { OnHandChart } from "@/components/pricing/on-hand-chart"
import type { PricingCalendarDay } from "@/lib/api"
import type { Event as HotelEvent } from "@shared/types"

interface PriceCalendarSectionProps {
  monthData: MonthCalendar
  /** 客室数（月計の稼働率に使う） */
  totalRooms: number | null
  /** 日別分析から遷移してきた日（該当行を強調してスクロールする） */
  highlightedDate: string | null
  /** 当月の登録済みイベント（GET /events — #80） */
  events: HotelEvent[]
  /** テーブル行のクリックでAI分析ダイアログを開く */
  onSelectRowForAnalysis: (day: PricingCalendarDay) => void
  /** カレンダーのセルクリックで詳細ダイアログを開く */
  onSelectDay: (day: PricingCalendarDay) => void
}

/** 月計（予算・現在・AI の想定）。純関数 */
export function summarizeCalendar(days: PricingCalendarDay[], totalRooms: number | null) {
  const sum = (values: Array<number | null>) => {
    const valid = values.filter((v): v is number => v != null)
    return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) : null
  }
  const capacity = totalRooms != null && totalRooms > 0 ? totalRooms * days.length : null
  const occ = (rooms: number | null) => (rooms != null && capacity ? rooms / capacity : null)
  const adr = (revenue: number | null, rooms: number | null) => (revenue != null && rooms ? revenue / rooms : null)

  const budgetRooms = sum(days.map((d) => d.budgetRooms))
  const budgetRevenue = sum(days.map((d) => d.budgetRevenue))
  const onHandRooms = sum(days.map((d) => d.onHandRooms))
  // 現在ADR は売上の分かる日だけで出す（先の日の予約の売上は PMS 連携後）
  const withRevenue = days.filter((d) => d.currentRevenue != null && d.onHandRooms != null)
  const currentRevenue = sum(days.map((d) => d.currentRevenue))
  const aiRooms = totalRooms != null ? sum(days.map((d) => (d.predictedOccupancy != null ? Math.round(d.predictedOccupancy * totalRooms) : null))) : null
  const expectedRevenue = sum(days.map((d) => d.expectedRevenue))
  return {
    budgetAdr: adr(budgetRevenue, budgetRooms) ?? days.find((d) => d.budgetAdr != null)?.budgetAdr ?? null,
    currentAdr: adr(sum(withRevenue.map((d) => d.currentRevenue)), sum(withRevenue.map((d) => d.onHandRooms))),
    expectedAdr: adr(expectedRevenue, aiRooms),
    budgetOccupancy: occ(budgetRooms),
    currentOccupancy: occ(onHandRooms),
    predictedOccupancy: occ(aiRooms),
    budgetRevenue,
    currentRevenue,
    expectedRevenue,
  }
}

function HeaderHelp({ label, help, align = "right" }: { label: string; help: string; align?: "right" | "center" }) {
  return (
    <TooltipProvider>
      <UITooltip>
        <TooltipTrigger asChild>
          <span className={`flex cursor-help items-center gap-1 ${align === "right" ? "justify-end" : "justify-center"}`}>
            {label}
            <Info className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs">{help}</p>
        </TooltipContent>
      </UITooltip>
    </TooltipProvider>
  )
}

export function PriceCalendarSection({
  monthData,
  totalRooms,
  highlightedDate,
  events,
  onSelectRowForAnalysis,
  onSelectDay,
}: PriceCalendarSectionProps) {
  const { isWeekendDow } = useWeekend()
  const [calendarViewMode, setCalendarViewMode] = useState<"table" | "grid">("table")

  const days = monthData.calendar
  const summary = useMemo(() => summarizeCalendar(days, totalRooms), [days, totalRooms])
  const hasPending = days.some((d) => d.onHandAdr == null && d.actualAdr == null)

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
          <p className="text-xs text-muted-foreground">
            オペレーターが予算・現在の予約・AIの推奨を見比べ、シミュレーションも含めて価格を決める表です。行をクリックすると日のAI分析（日のタイプの推移）を開きます。
            結果と想定との差異は「分析 &gt; 日別パフォーマンス」で確認できます。
          </p>
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
                    <th className="text-left py-2 px-2 font-medium whitespace-nowrap">日付</th>
                    <th className="text-left py-2 px-2 font-medium">曜日</th>
                    <th className="text-center py-2 px-2 font-medium whitespace-nowrap">
                      <DayTypeHelp />
                    </th>
                    <th className="text-center py-2 px-2 font-medium">
                      <HeaderHelp align="center" label="アラート" help="AI の需要予測による需要水準のアラート（A: 需要が非常に高い 〜 E: 需要が非常に低い）です。" />
                    </th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap bg-muted/40">予算ADR</th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap">
                      <HeaderHelp label="現在ADR" help="結果の出た日は実績ADR、先の日は予約（オンハンド）のADRです。予約の単価は PMS 連携後に入ります。" />
                    </th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap">推奨ADR</th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap bg-muted/40">予算稼働率</th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap">
                      <HeaderHelp label="現在稼働率" help="結果の出た日は実績、先の日は今の予約室数（オンハンド）÷ 客室数です。" />
                    </th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap">稼働率予測（AI）</th>
                    <th className="text-center py-2 px-2 font-medium whitespace-nowrap">
                      現在料金ランク
                      <span className="block text-[10px] font-normal text-muted-foreground">（サイトコントローラー）</span>
                    </th>
                    <th className="text-center py-2 px-2 font-medium whitespace-nowrap">推奨料金ランク</th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap bg-muted/40">
                      <HeaderHelp label="予算売上" help="月次予算を前年同曜日の販売室数の比で日に配った値です（予算ADRは月の値）。" />
                    </th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap">現在売上</th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap">
                      <HeaderHelp label="想定売上" help="AI の予測稼働率 × 客室数 × 推奨（予測）ADR です。" />
                    </th>
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
                          <DayTypeBadge
                            dayType={day.dayType}
                            expectedOccupancy={day.dayTypeExpectedOccupancy}
                            paceRatio={day.dayTypePaceRatio}
                          />
                        </td>
                        <td className="text-center py-2 px-2">
                          {day.demandLevel ? (
                            <Badge className={`${demandBadgeClass(day.demandLevel)} text-xs`}>{day.demandLevel}</Badge>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="text-right py-2 px-2 bg-muted/40 tabular-nums">{yen(day.budgetAdr)}</td>
                        <td className={`text-right py-2 px-2 tabular-nums ${isActualDay ? "font-medium" : ""}`}>{yen(day.onHandAdr)}</td>
                        <td className="text-right py-2 px-2 font-semibold tabular-nums">{yen(day.predictedAdr)}</td>
                        <td className="text-right py-2 px-2 bg-muted/40 tabular-nums">{pct(day.budgetOccupancy)}</td>
                        <td className={`text-right py-2 px-2 tabular-nums ${isActualDay ? "font-medium" : ""}`}>{pct(day.currentOccupancy)}</td>
                        <td className="text-right py-2 px-2 tabular-nums">{pct(day.predictedOccupancy)}</td>
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
                        <td className="text-right py-2 px-2 bg-muted/40 tabular-nums">{yen(day.budgetRevenue)}</td>
                        <td className={`text-right py-2 px-2 tabular-nums ${isActualDay ? "font-medium" : ""}`}>{yen(day.currentRevenue)}</td>
                        <td className="text-right py-2 px-2 tabular-nums">{yen(day.expectedRevenue)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-medium">
                    <td className="py-2 px-2" colSpan={4}>
                      月計
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">（ADRは売上÷室数、稼働率は月の客室数に対して）</span>
                    </td>
                    <td className="text-right py-2 px-2 bg-muted/40 tabular-nums">{yen(summary.budgetAdr)}</td>
                    <td className="text-right py-2 px-2 tabular-nums">{yen(summary.currentAdr)}</td>
                    <td className="text-right py-2 px-2 tabular-nums">{yen(summary.expectedAdr)}</td>
                    <td className="text-right py-2 px-2 bg-muted/40 tabular-nums">{pct(summary.budgetOccupancy)}</td>
                    <td className="text-right py-2 px-2 tabular-nums">{pct(summary.currentOccupancy)}</td>
                    <td className="text-right py-2 px-2 tabular-nums">{pct(summary.predictedOccupancy)}</td>
                    <td className="py-2 px-2" colSpan={2}></td>
                    <td className="text-right py-2 px-2 bg-muted/40 tabular-nums">{yen(summary.budgetRevenue)}</td>
                    <td className="text-right py-2 px-2 tabular-nums">{yen(summary.currentRevenue)}</td>
                    <td className="text-right py-2 px-2 tabular-nums">{yen(summary.expectedRevenue)}</td>
                  </tr>
                </tfoot>
              </table>
              {hasPending && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  「-」の現在ADR・現在売上は、予約の単価・売上を PMS から受け取れるようになってから表示します（今は結果の出た日だけ）。
                </p>
              )}
            </div>
          ) : (
            <PriceGrid
              year={monthData.year}
              month={monthData.month}
              days={days}
              events={events}
              onSelectDay={onSelectDay}
            />
          )}

          {/* 個人団体別 オンハンド状況（DP04。以前の価格推移グラフを置き換え） */}
          {days.length > 0 && (
            <div className="mt-6 pt-6 border-t">
              <OnHandChart days={days} totalRooms={totalRooms} />
            </div>
          )}
        </div>
  )
}

function PriceGrid({
  year,
  month,
  days,
  events,
  onSelectDay,
}: {
  year: number
  month: number
  days: PricingCalendarDay[]
  events: HotelEvent[]
  onSelectDay: (day: PricingCalendarDay) => void
}) {
  const { isWeekendDow } = useWeekend()
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])
  const firstDay = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const startDayOfWeek = firstDay.getDay()
  const prevMonthDays = new Date(year, month - 1, 0).getDate()
  const weeks = Math.ceil((daysInMonth + startDayOfWeek) / 7)

  // 料金ランクの人数別料金をそのまま表示する。部屋タイプ別の料金はマスタが無いため出さない
  // （以前は架空の係数を掛けた「デラックス」「スイート」の料金を表示していた — #80）
  const priceOf = (base: number | null | undefined): string => (base == null ? "-" : base.toLocaleString())

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
      <p className="text-[10px] text-muted-foreground">
        推奨料金ランクの人数別料金です（部屋タイプ別の料金は部屋タイプのマスタ登録後に対応します）
      </p>


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
              const dayEvents = cell.isCurrentMonth
                ? eventsOnDate(events, `${year}-${String(month).padStart(2, "0")}-${String(cell.date).padStart(2, "0")}`)
                : []
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

                  {dayEvents.length > 0 && (
                    <div className="mb-1">
                      <Badge
                        variant="secondary"
                        className="text-[9px] px-1 py-0 h-4"
                        title={dayEvents.map((ev) => ev.name).join("、")}
                      >
                        イベント{dayEvents.length > 1 ? ` ${dayEvents.length}件` : ""}
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
