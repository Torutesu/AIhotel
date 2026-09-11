"use client"

// ダイナミックプライシングタブ（U-15 で各セクションを components/pricing/* へ分割したコンテナ）
//
// 実データ: GET /pricing/calendar・GET/PUT /pricing/strategy・GET /pricing/simulation・
//           POST /pricing/recompute・/events 一式
// サンプル表示: AI価格最適化の提案（Claude API未実装）、部屋タイプの選択肢（マスタ未実装）

import { useCallback, useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorCard } from "@/components/error-state"
import { SampleDataNotice } from "@/components/sample-data-notice"
import { LabeledMonthPicker } from "@/components/month-picker"
import { usePeriod } from "@/components/app-state-provider"
import { useAuth } from "@/components/auth-provider"

import { StrategyWeightsCard } from "@/components/pricing/strategy-weights-card"
import { LandingForecastSummary } from "@/components/pricing/landing-forecast-summary"
import { PriceCalendarSection } from "@/components/pricing/price-calendar-section"
import { EventListCard } from "@/components/pricing/event-list-card"
import { DayDetailDialog, type DayNote } from "@/components/pricing/day-detail-dialog"
import { DayAnalysisDialog } from "@/components/pricing/day-analysis-dialog"
import {
  AI_PRICING_PROPOSALS,
  PROPOSAL_LEVEL_STYLE,
  ROOM_TYPES,
  ROOM_TYPE_GROUPS,
  type MonthCalendar,
} from "@/components/pricing/pricing-constants"

import { api, ApiClientError, type PricingCalendarDay } from "@/lib/api"
import { monthRange, toDateStr } from "@/lib/date"
import { average } from "@/lib/format"

interface PricingTabProps {
  /** 日別分析から遷移してきた際に開く対象日 */
  focusDate?: Date | null
  /** 対象日への遷移処理が完了したことを親に伝える */
  onFocusDateHandled?: () => void
}

export function PricingTab({ focusDate, onFocusDateHandled }: PricingTabProps = {}) {
  const { hotelId } = useAuth()
  // 対象年月は全タブ共有（URL の ?year=&month= と同期 — U-8）
  const { year: selectedYear, month: selectedMonth, periodMonth, setPeriodMonth } = usePeriod()

  // 日別分析から遷移してきた日（該当行をハイライトする）
  const [highlightedDate, setHighlightedDate] = useState<string | null>(
    focusDate ? toDateStr(focusDate) : null,
  )
  const [roomType, setRoomType] = useState("all")

  const [monthsData, setMonthsData] = useState<MonthCalendar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedDay, setSelectedDay] = useState<PricingCalendarDay | null>(null)
  const [selectedRowForAnalysis, setSelectedRowForAnalysis] = useState<PricingCalendarDay | null>(
    null,
  )

  // 日別のイベント情報・外部要因メモ（日単位の自由記述を保存するAPIが未整備のため画面内の一時メモ）
  const [eventInfoMap, setEventInfoMap] = useState<Record<string, DayNote>>({})

  // 日別分析から日付付きで遷移してきたら該当行をハイライトする（対象月の切り替えは呼び出し側が行う）
  useEffect(() => {
    if (!focusDate) return
    setHighlightedDate(toDateStr(focusDate))
    onFocusDateHandled?.()
  }, [focusDate, onFocusDateHandled])

  const range = useMemo(() => monthRange(selectedYear, selectedMonth), [selectedYear, selectedMonth])

  const loadData = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      const calendar = await api.pricingCalendar(hotelId, selectedYear, selectedMonth)
      setMonthsData([{ year: calendar.year, month: calendar.month, calendar: calendar.calendar }])
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "データの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId, selectedYear, selectedMonth])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 現在値（実績が確定した日のみを集計した実データ）。
  // 着地予測は GET /pricing/simulation（LandingForecastSummary）が担当し、ここでは算出しない（U-2）。
  const currentPerformance = useMemo(() => {
    const actualDays = monthsData.flatMap((m) => m.calendar).filter((d) => d.actualAdr != null)
    return {
      adr: average(actualDays.map((d) => d.actualAdr)),
      occupancy: average(actualDays.map((d) => d.actualOccupancy)),
      revPar: average(
        actualDays.map((d) =>
          d.actualAdr != null && d.actualOccupancy != null ? d.actualAdr * d.actualOccupancy : null,
        ),
      ),
    }
  }, [monthsData])

  const saveDayNote = useCallback((date: string, note: DayNote) => {
    setEventInfoMap((prev) => ({ ...prev, [date]: note }))
  }, [])

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
        <ErrorCard message={error} onRetry={loadData} />
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-balance text-2xl font-semibold">ダイナミックプライシング</h2>
        <p className="mt-1 text-sm text-muted-foreground">需要予測に基づく最適価格設定</p>
      </div>

      {/* AI価格最適化の提案（Claude API未実装のため固定文のサンプル — U-7） */}
      <Card className="border-[color:var(--cyan-edge)]/40 bg-[color:var(--sky-wash)]/25">
        <CardHeader className="pb-1">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <span className="text-xl" aria-hidden>
              🤖
            </span>
            AI価格最適化の提案
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <SampleDataNotice detail="Claude APIによるAIコメント生成が未実装のため、以下は固定文のサンプルです。" />
          <div className="space-y-2 text-sm leading-relaxed">
            {AI_PRICING_PROPOSALS.map((proposal, index) => {
              const style = PROPOSAL_LEVEL_STYLE[proposal.level]
              return (
                <div key={index} className="flex items-start gap-3">
                  <Badge className={`${style.className} mt-0.5 flex-shrink-0 px-1.5 text-[10px]`}>
                    {style.label}
                  </Badge>
                  <p>{proposal.text}</p>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* 価格戦略の重み付け（U-1 — GET/PUT /pricing/strategy） */}
      <StrategyWeightsCard />

      <Card>
        <CardContent className="px-3 py-2.5">
          {/* フィルターコントロール（表示は1か月のみ・表示月を選択） */}
          <div className="mb-2.5 flex flex-wrap items-center gap-3">
            <LabeledMonthPicker
              id="pricing-period"
              label="表示月"
              value={periodMonth}
              onChange={setPeriodMonth}
            />

            <div className="flex items-center gap-1.5">
              <Label htmlFor="room-type" className="whitespace-nowrap text-xs">
                部屋タイプ
              </Label>
              <Select value={roomType} onValueChange={setRoomType}>
                <SelectTrigger id="room-type" className="h-8 w-48 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全タイプ</SelectItem>
                  <SelectGroup>
                    <SelectLabel>部屋タイプ</SelectLabel>
                    {ROOM_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>部屋タイプグループ</SelectLabel>
                    {ROOM_TYPE_GROUPS.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 着地予測（U-2 — GET /pricing/simulation / POST /pricing/recompute） */}
          <LandingForecastSummary
            year={selectedYear}
            month={selectedMonth}
            current={currentPerformance}
            currentLoading={loading}
            onRecomputed={loadData}
          />

          <div className="my-4 border-t"></div>

          {loading ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            monthsData.map((monthData) => (
              <PriceCalendarSection
                key={`${monthData.year}-${monthData.month}`}
                monthData={monthData}
                highlightedDate={highlightedDate}
                eventInfoMap={eventInfoMap}
                onSelectRowForAnalysis={setSelectedRowForAnalysis}
                onSelectDay={setSelectedDay}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* 当月のイベント情報（実API接続 — F-DP-07） */}
      <EventListCard startDate={range.startDate} endDate={range.endDate} />

      <DayDetailDialog
        day={selectedDay}
        info={selectedDay ? eventInfoMap[selectedDay.date] : undefined}
        onClose={() => setSelectedDay(null)}
        onSaveInfo={saveDayNote}
      />

      <DayAnalysisDialog
        day={selectedRowForAnalysis}
        days={monthsData[0]?.calendar ?? []}
        onClose={() => setSelectedRowForAnalysis(null)}
      />
    </div>
  )
}
