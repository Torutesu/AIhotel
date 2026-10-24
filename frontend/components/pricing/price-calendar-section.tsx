"use client"

// 日別価格カレンダー（テーブル表示）と オンハンド状況（U-15 で pricing-tab.tsx から分割）。
// GET /pricing/calendar の実データを表示する。
// 2026-10 の画面修正（DP02）で、オペレーターが価格を決める表として 予算・現在・AI の推奨を並べた。
// 結果（ADR・稼働率・売上）と想定との差異は 分析 > 日別パフォーマンス へ移した。
// 2026-10-24 の画面修正: 「タイプ別人数別カレンダー」を外してテーブル表示ひとつにし、現在・推奨料金ランクの上に
// タイプの切り替え（ALL ＋ 各部屋タイプ）を置いた。タイプを選ぶとそのタイプの数値（予算はタイプ別に持たないので「-」）。

import { useMemo } from "react"
import { Info } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ErrorState } from "@/components/error-state"
import { useWeekend } from "@/hooks/use-weekend"
import {
  demandBadgeClass,
  getRankBadgeColor,
  holidayNameOf,
  saleOpenStatus,
  specialDayNameOf,
  type MonthCalendar,
} from "@/components/pricing/pricing-constants"
import { DAY_NAMES, monthLabel as monthLabelOf, parseDateStr } from "@/lib/date"
import { formatPercent as pct, formatYen as yen } from "@/lib/format"
import { DayTypeBadge, DayTypeHelp } from "@/components/pricing/day-type"
import { OnHandChart } from "@/components/pricing/on-hand-chart"
import type { PricingCalendarDay } from "@/lib/api"

/** タイプ切り替えの「ALL」（全タイプの合計。今までの表示） */
export const ALL_ROOM_TYPES = "ALL"

/** タイプ切り替え（現在・推奨料金ランクの上 — 2026-10-24） */
export interface RoomTypeSwitch {
  /** 選べる部屋タイプ（ALL は別に必ず出す） */
  options: Array<{ id: string; name: string }>
  /** 選んでいるタイプ（ALL_ROOM_TYPES か部屋タイプの ID） */
  value: string
  onChange: (value: string) => void
  /** 選んだタイプの月のデータ（ALL のときは使わない） */
  data: MonthCalendar | null
  loading: boolean
  error: string | null
  onRetry: () => void
}

interface PriceCalendarSectionProps {
  /** ALL（全タイプの合計）の月のデータ。オンハンド状況のグラフは常に ALL */
  monthData: MonthCalendar
  /** 客室数（月計の稼働率に使う） */
  totalRooms: number | null
  /** 日別分析から遷移してきた日（該当行を強調してスクロールする） */
  highlightedDate: string | null
  /** テーブル行のクリックでAI分析ダイアログを開く */
  onSelectRowForAnalysis: (day: PricingCalendarDay) => void
  /** 販売開始: 宿泊日の何日前（ホテル設定。未設定は null — 2026-10 PDF b04） */
  saleOpenDaysBefore?: number | null
  /** タイプ切り替え。渡さなければ ALL だけ */
  roomTypeSwitch?: RoomTypeSwitch
}

/**
 * 月計（予算・現在・AI の想定）。純関数。
 * 稼働率は値のある日の室数 ÷（客室数 × 値のある日数）で出す（値の欠けた日を 0室と数えると月計が低く出る）。
 * ADR は売上と室数の両方が分かる日だけで出す
 */
export function summarizeCalendar(days: PricingCalendarDay[], totalRooms: number | null) {
  const sum = (values: Array<number | null>) => {
    const valid = values.filter((v): v is number => v != null)
    return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) : null
  }
  const occ = (values: Array<number | null>) => {
    const valid = values.filter((v): v is number => v != null)
    if (valid.length === 0 || totalRooms == null || totalRooms <= 0) return null
    return valid.reduce((a, b) => a + b, 0) / (totalRooms * valid.length)
  }
  /** 売上・室数の両方が分かる日だけで ADR を出す */
  const adrOf = (pairs: Array<[number | null, number | null]>) => {
    const valid = pairs.filter((p): p is [number, number] => p[0] != null && p[1] != null)
    const rooms = valid.reduce((a, [, r]) => a + r, 0)
    return rooms > 0 ? valid.reduce((a, [rev]) => a + rev, 0) / rooms : null
  }
  const aiRoomsOf = (d: PricingCalendarDay) =>
    totalRooms != null && d.predictedOccupancy != null ? Math.round(d.predictedOccupancy * totalRooms) : null

  const budgetRevenue = sum(days.map((d) => d.budgetRevenue))
  return {
    budgetAdr: adrOf(days.map((d) => [d.budgetRevenue, d.budgetRooms])) ?? days.find((d) => d.budgetAdr != null)?.budgetAdr ?? null,
    // 現在ADR は売上の分かる日だけで出す（先の日の予約の売上は PMS 連携後）
    currentAdr: adrOf(days.map((d) => [d.currentRevenue, d.onHandRooms])),
    expectedAdr: adrOf(days.map((d) => [d.expectedRevenue, aiRoomsOf(d)])),
    budgetOccupancy: occ(days.map((d) => d.budgetRooms)),
    currentOccupancy: occ(days.map((d) => d.onHandRooms)),
    predictedOccupancy: occ(days.map(aiRoomsOf)),
    budgetRevenue,
    currentRevenue: sum(days.map((d) => d.currentRevenue)),
    expectedRevenue: sum(days.map((d) => d.expectedRevenue)),
  }
}

/** 表示月の販売開始の状況（宿泊日の N日前に販売開始 — ホテル設定） */
function SaleOpenNote({ year, month, daysBefore }: { year: number; month: number; daysBefore: number | null }) {
  const status = saleOpenStatus(year, month, daysBefore)
  if (!status) return null
  const md = (d: Date) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
  const text =
    status.state === "open"
      ? "この月は全日販売中です。"
      : status.state === "before"
        ? `この月は ${md(status.firstOpen)} から順に販売開始します（月末の宿泊分は ${md(status.lastOpen)}）。`
        : `この月は ${status.openedThrough ? `${status.openedThrough.getMonth() + 1}/${status.openedThrough.getDate()} の宿泊分まで` : "一部を"}販売中です。`
  return (
    <p className="text-xs text-muted-foreground" data-testid="sale-open-note">
      販売開始は宿泊日の {daysBefore}日前（ホテル設定）。{text}
    </p>
  )
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

/** 表の列数（日付〜想定売上）。タイプ切り替えの行・読み込み中の行の幅に使う */
const COLUMN_COUNT = 15

export function PriceCalendarSection({
  monthData,
  totalRooms,
  highlightedDate,
  onSelectRowForAnalysis,
  saleOpenDaysBefore = null,
  roomTypeSwitch,
}: PriceCalendarSectionProps) {
  const { isWeekendDow } = useWeekend()

  const selectedType = roomTypeSwitch && roomTypeSwitch.value !== ALL_ROOM_TYPES
    ? roomTypeSwitch.options.find((t) => t.id === roomTypeSwitch.value) ?? null
    : null
  const typeData = selectedType ? roomTypeSwitch?.data ?? null : null
  const typeLoading = selectedType != null && (roomTypeSwitch?.loading ?? false)
  const typeError = selectedType != null ? roomTypeSwitch?.error ?? null : null
  // 表はタイプを選べばそのタイプ、ALL なら全タイプの合計
  const days = selectedType ? (typeData?.calendar ?? []) : monthData.calendar
  const tableRooms = selectedType ? (typeData?.totalRooms ?? null) : totalRooms
  const summary = useMemo(() => summarizeCalendar(days, tableRooms), [days, tableRooms])
  const hasPending = days.some((d) => d.onHandAdr == null && d.actualAdr == null)
  // タイプ別の先の日の予約は PMS／サイトコントローラー連携まで無い
  const typeOnHandPending = selectedType != null && days.some((d) => d.onHandRooms == null && d.actualAdr == null)

  return (
        <div key={`${monthData.year}-${monthData.month}`} className="space-y-3">
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <h3 className="text-base font-semibold">
              日別価格カレンダー（{monthLabelOf(monthData.year, monthData.month)}{selectedType ? `・${selectedType.name}` : ""}）
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            オペレーターが予算・現在の予約・AIの推奨を見比べ、価格を決める表です。行をクリックすると日のAI分析（日のタイプの推移・その日のシミュレーション）を開きます。
            結果と想定との差異は「分析 &gt; 日別パフォーマンス」で確認できます。
            {selectedType
              ? `数値は「${selectedType.name}」（${typeData?.totalRooms ?? "-"}室）の値です。予算はタイプ別には持たないため「-」で表示します。料金ランクは全タイプ共通の段階です。`
              : "数値は全タイプの合計（ALL）、料金ランクは基準の部屋タイプ（1名料金）のランクです。料金ランクの上の「タイプ」で部屋タイプ別に切り替えられます。"}
          </p>
          <SaleOpenNote year={monthData.year} month={monthData.month} daysBefore={saleOpenDaysBefore} />
          <p className="text-xs text-muted-foreground mb-2">
            曜日欄の色: <span className="text-negative font-medium">祝日</span> / <span className="text-warning font-medium">特日（お盆・年末年始等）</span>
            。特日はAIが候補を提示し、オペレーターがマスタ設定画面で修正できます。
          </p>

          {monthData.calendar.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">この月のデータがありません。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  {roomTypeSwitch && (
                    // タイプの切り替えは 現在料金ランク・推奨料金ランク の上に置く（サイトコントローラーのタイプ別のランク）
                    <tr>
                      <th colSpan={10} aria-hidden className="p-0" />
                      <th colSpan={2} className="px-2 pt-2 pb-1 font-normal">
                        <div className="flex items-center justify-center gap-1.5">
                          <Label htmlFor="calendar-room-type" className="whitespace-nowrap text-[11px]">
                            タイプ
                          </Label>
                          <Select value={roomTypeSwitch.value} onValueChange={roomTypeSwitch.onChange}>
                            <SelectTrigger id="calendar-room-type" className="h-7 w-40 text-xs" data-testid="calendar-room-type">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={ALL_ROOM_TYPES}>ALL</SelectItem>
                              {roomTypeSwitch.options.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </th>
                      <th colSpan={COLUMN_COUNT - 12} aria-hidden className="p-0" />
                    </tr>
                  )}
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 font-medium whitespace-nowrap">日付</th>
                    <th className="text-left py-2 px-2 font-medium whitespace-nowrap">曜日</th>
                    <th className="text-center py-2 px-2 font-medium whitespace-nowrap">
                      <DayTypeHelp />
                    </th>
                    <th className="text-center py-2 px-2 font-medium whitespace-nowrap">
                      <HeaderHelp align="center" label="アラート" help="AI の需要予測による需要水準のアラート（A: 需要が非常に高い 〜 E: 需要が非常に低い）です。" />
                    </th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap bg-muted/40">予算ADR</th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap">
                      <HeaderHelp label="現在ADR" help="結果の出た日は実績ADR、先の日は予約（オンハンド）のADRです。予約の単価は PMS 連携後に入ります。" />
                    </th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap">推奨ADR</th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap bg-muted/40">予算稼働率</th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap">
                      <HeaderHelp label="現在稼働率" help="結果の出た日は実績、先の日は今の予約室数（オンハンド）÷ 客室数（タイプ別はそのタイプの室数）です。" />
                    </th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap">
                      <HeaderHelp
                        label="稼働率予測（AI）"
                        help="AI の予測稼働率です。タイプ別は、ホテル全体の予測を過去90日のタイプ別の販売構成（室数の比）で配った値です。"
                      />
                    </th>
                    <th className="text-center py-2 px-2 font-medium whitespace-nowrap">
                      現在料金ランク
                      <span className="block text-[10px] font-normal text-muted-foreground">（サイトコントローラー）</span>
                    </th>
                    <th className="text-center py-2 px-2 font-medium whitespace-nowrap">
                      <HeaderHelp
                        label="推奨料金ランク"
                        align="center"
                        help="AI が推奨する料金ランクです。料金ランクは全タイプ共通の段階で、ALL は基準の部屋タイプ（1名料金）のランクです。"
                      />
                    </th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap bg-muted/40">
                      <HeaderHelp label="予算売上" help="月次予算を前年同曜日の販売室数の比で日に配った値です（予算ADRは月の値）。タイプ別の予算は持たないため、タイプを選ぶと「-」です。" />
                    </th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap">現在売上</th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap">
                      <HeaderHelp
                        label="想定売上"
                        help="AI の予測稼働率 × 客室数 × 推奨（予測）ADR です。タイプ別の推奨ADRは、ホテル全体の予測ADRに過去90日のタイプ別の単価の比を掛けた値です。"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {typeLoading ? (
                    <tr>
                      <td colSpan={COLUMN_COUNT} className="py-3">
                        <Skeleton className="h-64 w-full" />
                      </td>
                    </tr>
                  ) : typeError ? (
                    <tr>
                      <td colSpan={COLUMN_COUNT} className="py-3">
                        <ErrorState message={typeError} onRetry={roomTypeSwitch?.onRetry} />
                      </td>
                    </tr>
                  ) : (
                    days.map((day) => {
                    const [, , dayNum] = day.date.split("-")
                    const dateObj = parseDateStr(day.date)
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
                          <DayTypeBadge dayType={day.dayType} model={day.dayTypeModel} typicalOccupancy={day.dayTypeTypicalOccupancy} />
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
                  })
                  )}
                </tbody>
                {!typeLoading && !typeError && (
                  <tfoot>
                    <tr className="border-t-2 font-medium">
                      <td className="py-2 px-2" colSpan={4}>
                        月計
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                          （ADRは売上÷室数、稼働率は月の{selectedType ? "タイプの室数" : "客室数"}に対して）
                        </span>
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
                )}
              </table>
              {!typeLoading && !typeError && hasPending && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  「-」の現在ADR・現在売上は、予約の単価・売上を PMS から受け取れるようになってから表示します（今は結果の出た日だけ）。
                </p>
              )}
              {!typeLoading && !typeError && typeOnHandPending && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  タイプ別の先の日の予約（現在稼働率・現在ADR・現在売上）は、PMS／サイトコントローラー連携後に表示します。結果の出た日はタイプ別の実績です。
                </p>
              )}
            </div>
          )}

          {/* オンハンド状況（DP04。以前の価格推移グラフを置き換え）。タイプの切り替えは表だけで、グラフは ALL */}
          {monthData.calendar.length > 0 && (
            <div className="mt-6 pt-6 border-t">
              <OnHandChart days={monthData.calendar} totalRooms={totalRooms} />
            </div>
          )}
        </div>
  )
}
