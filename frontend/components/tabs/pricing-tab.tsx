"use client"

// ダイナミックプライシングタブ（U-15 で各セクションを components/pricing/* へ分割したコンテナ）
//
// 実データ: GET /pricing/calendar・GET/PUT /pricing/strategy・GET /pricing/simulation・
//           POST /pricing/recompute・GET /events（登録・取り込みは外部需要動向 — 2026-10）
// サンプル表示: AI価格最適化の提案（Claude API未実装）

import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorCard } from "@/components/error-state"
import { SampleDataNotice } from "@/components/sample-data-notice"
import { LabeledMonthPicker } from "@/components/month-picker"
import { useAppState, usePeriod } from "@/components/app-state-provider"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"

import { LandingForecastSummary } from "@/components/pricing/landing-forecast-summary"
import { PriceCalendarSection } from "@/components/pricing/price-calendar-section"
import { EventListCard } from "@/components/pricing/event-list-card"
import { DayDetailDialog } from "@/components/pricing/day-detail-dialog"
import { DayAnalysisDialog } from "@/components/pricing/day-analysis-dialog"
import {
  AI_PRICING_PROPOSALS,
  PROPOSAL_LEVEL_STYLE,
  eventsOnDate,
  type MonthCalendar,
} from "@/components/pricing/pricing-constants"

import { api, type PricingCalendarDay } from "@/lib/api"
import type { Event as HotelEvent } from "@shared/types"
import { monthRange, toDateStr } from "@/lib/date"
import { average } from "@/lib/format"

interface PricingTabProps {
  /** 日別分析から遷移してきた際に開く対象日 */
  focusDate?: Date | null
  /** 対象日への遷移処理が完了したことを親に伝える */
  onFocusDateHandled?: () => void
}

export function PricingTab({ focusDate, onFocusDateHandled }: PricingTabProps = {}) {
  const { hotelId, hotel } = useAuth()
  const { setTab } = useAppState()
  // 対象年月は全タブ共有（URL の ?year=&month= と同期 — U-8）
  const { year: selectedYear, month: selectedMonth, periodMonth, setPeriodMonth } = usePeriod()

  // 日別分析から遷移してきた日（該当行をハイライトする）
  const [highlightedDate, setHighlightedDate] = useState<string | null>(
    focusDate ? toDateStr(focusDate) : null,
  )


  const [selectedDay, setSelectedDay] = useState<PricingCalendarDay | null>(null)
  const [selectedRowForAnalysis, setSelectedRowForAnalysis] = useState<PricingCalendarDay | null>(
    null,
  )


  // 日別分析から日付付きで遷移してきたら該当行をハイライトする（対象月の切り替えは呼び出し側が行う）
  useEffect(() => {
    if (!focusDate) return
    setHighlightedDate(toDateStr(focusDate))
    onFocusDateHandled?.()
  }, [focusDate, onFocusDateHandled])

  const range = useMemo(() => monthRange(selectedYear, selectedMonth), [selectedYear, selectedMonth])

  // ホテル・年月を切り替えた直後に前の条件のレスポンスが遅れて返っても使わない（#91）
  const {
    data: calendarData,
    loading,
    error,
    reload: loadData,
  } = useApiQuery<MonthCalendar>(
    hotelId
      ? async () => {
          const calendar = await api.pricingCalendar(hotelId, selectedYear, selectedMonth)
          return { year: calendar.year, month: calendar.month, totalRooms: calendar.totalRooms, calendar: calendar.calendar }
        }
      : null,
    [hotelId, selectedYear, selectedMonth],
    "データの取得に失敗しました",
  )
  const monthsData = useMemo(() => (calendarData ? [calendarData] : []), [calendarData])

  // 当月の登録済みイベント。一覧カード・カレンダー・日別詳細で同じデータを使う（#80）
  const {
    data: eventsData,
    loading: eventsLoading,
    error: eventsError,
    reload: loadEvents,
  } = useApiQuery<HotelEvent[]>(
    hotelId ? () => api.events(hotelId, range.startDate, range.endDate) : null,
    [hotelId, range.startDate, range.endDate],
    "イベント情報の取得に失敗しました",
  )
  const events = useMemo(() => eventsData ?? [], [eventsData])

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

      {/* 価格戦略の重み付け・推奨の調整・価格の幅・固定期間は、ヒアリングで決める初期値として設定画面へ移した（2026-10 PDF b01） */}
      <p className="text-xs text-muted-foreground">
        価格戦略の重み付け・推奨の調整（価格の幅・推奨を固定する期間）は、ヒアリング内容に応じた初期値として
        <Button variant="link" className="h-auto px-1 py-0 text-xs" onClick={() => setTab("settings")}>
          設定画面の「価格戦略の初期値」
        </Button>
        で設定します。日ごとの優先モデル（稼働優先・単価優先）は日のタイプで AI が割り当て、行をクリックした日のAI分析で確認・試算できます。
      </p>

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
                totalRooms={monthData.totalRooms ?? hotel?.totalRooms ?? null}
                saleOpenDaysBefore={hotel?.saleOpenDaysBefore ?? null}
                highlightedDate={highlightedDate}
                events={events}
                onSelectRowForAnalysis={setSelectedRowForAnalysis}
                onSelectDay={setSelectedDay}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* 当月のイベント情報（参照のみ。登録・取り込みは外部需要動向 — 2026-10） */}
      <EventListCard
        events={events}
        loading={eventsLoading}
        error={eventsError}
        onReload={loadEvents}
        onManage={() => setTab("ai-summary")}
      />

      <DayDetailDialog
        day={selectedDay}
        events={selectedDay ? eventsOnDate(events, selectedDay.date) : []}
        onClose={() => setSelectedDay(null)}
      />

      <DayAnalysisDialog day={selectedRowForAnalysis} onClose={() => setSelectedRowForAnalysis(null)} />
    </div>
  )
}
