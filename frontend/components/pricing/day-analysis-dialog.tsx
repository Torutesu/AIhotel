"use client"

// 日別のAI分析ダイアログ（U-15 で pricing-tab.tsx から分割）
// 表示している内容はすべてカレンダーAPIの実データから導出した説明文。
// 2026-10 の画面修正（DP03）: 日のタイプとその推移（90日前 → 現在）を足し、
// 周辺日は前後2日ずつの5日を、月をまたいでも表示する（前後の月は必要なときだけ取得する）。

import { useMemo } from "react"
import { AlertCircle, ArrowRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/components/auth-provider"
import {
  demandBadgeClass,
  demandDescription,
  getRankBadgeColor,
} from "@/components/pricing/pricing-constants"
import { DayTypeBadge, DayTypeHelp, describeDayType, leadLabel } from "@/components/pricing/day-type"
import { useApiQuery } from "@/hooks/use-api-query"
import { DAY_NAMES, toDateStr } from "@/lib/date"
import { formatPercent as pct, formatSignedYen as signedYen, formatYen as yen } from "@/lib/format"
import { api, type PricingCalendarDay } from "@/lib/api"

/** 周辺日として並べる日数（前後2日ずつ） */
export const NEIGHBOR_RADIUS = 2

/** 選んだ日の前後 NEIGHBOR_RADIUS 日の日付（"yyyy-MM-dd"。月をまたぐ） */
export function neighborDates(date: string, radius = NEIGHBOR_RADIUS): string[] {
  const [y, m, d] = date.split("-").map(Number)
  return Array.from({ length: radius * 2 + 1 }, (_, i) => toDateStr(new Date(y, m - 1, d - radius + i)))
}

/** 前後の月のうち、周辺日のために取得が要る月（{ year, month } の配列） */
export function adjacentMonthsNeeded(date: string, radius = NEIGHBOR_RADIUS): Array<{ year: number; month: number }> {
  const month = date.slice(0, 7)
  const months = new Set(neighborDates(date, radius).map((d) => d.slice(0, 7)).filter((m) => m !== month))
  return [...months].map((m) => ({ year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) }))
}

/** 英字の差（A=0 … E=4）。日のタイプとアラートのずれを見る */
function gradeIndex(letter: string | null | undefined): number | null {
  if (!letter) return null
  const i = "ABCDE".indexOf(letter[0])
  return i < 0 ? null : i
}

interface DayAnalysisDialogProps {
  /** 選択中の日。null ならダイアログを閉じる */
  day: PricingCalendarDay | null
  /** 周辺日を並べるための同月分のカレンダー */
  days: PricingCalendarDay[]
  onClose: () => void
}

export function DayAnalysisDialog({ day: selectedDay, days, onClose }: DayAnalysisDialogProps) {
  if (!selectedDay) return null
  return <DayAnalysisContent day={selectedDay} days={days} onClose={onClose} />
}

function DayAnalysisContent({ day: selectedDay, days, onClose }: { day: PricingCalendarDay; days: PricingCalendarDay[]; onClose: () => void }) {
  const { hotelId } = useAuth()
  const needed = useMemo(() => adjacentMonthsNeeded(selectedDay.date), [selectedDay.date])
  const neededKey = needed.map((m) => `${m.year}-${m.month}`).join(",")
  const { data: adjacentDays, loading: adjacentLoading } = useApiQuery<PricingCalendarDay[]>(
    hotelId && needed.length > 0
      ? async () => (await Promise.all(needed.map((m) => api.pricingCalendar(hotelId, m.year, m.month)))).flatMap((c) => c.calendar)
      : null,
    [hotelId, neededKey],
    "前後の月のカレンダーの取得に失敗しました",
  )
  const neighbors = useMemo(() => {
    const byDate = new Map([...(adjacentDays ?? []), ...days].map((d) => [d.date, d]))
    return neighborDates(selectedDay.date).map((date) => ({ date, data: byDate.get(date) ?? null }))
  }, [adjacentDays, days, selectedDay.date])

  return (
          <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto w-full sm:!max-w-[90vw] lg:!max-w-[60vw]">
        {(() => {
          const day = selectedDay
          const [y, m, d] = day.date.split("-").map(Number)
          const dow = new Date(day.date).getDay()
          const insights: Array<{ type: string; title: string; content: string }> = []
          // 推移のいちばん古い時点（ふつうは90日前）
          const oldestHistory = day.dayTypeHistory[0] ?? null

          // 日のタイプ（予約の実数から見た見込み）とアラート（AI の予測）のずれ・ペース
          const typeGrade = gradeIndex(day.dayType)
          const alertGrade = gradeIndex(day.demandLevel)
          if (typeGrade != null && alertGrade != null && Math.abs(typeGrade - alertGrade) >= 1) {
            insights.push({
              type: typeGrade < alertGrade ? "positive" : "negative",
              title: "予約の実数とAIの予測がずれています",
              content: `日のタイプは「${day.dayType}」（予約から見た着地見込み${pct(day.dayTypeExpectedOccupancy)}）、アラートは「${day.demandLevel}」です。${
                typeGrade < alertGrade
                  ? "予約が予測より強く入っています。推奨ランクの引き上げや価格の幅の下限を上げることを検討してください。"
                  : "予約が予測ほど入っていません。価格の幅の上限を下げる・販促を行うなどの手当てを検討してください。"
              }`,
            })
          }
          const pace = day.dayType?.[1]
          if (pace === "4" || pace === "5") {
            insights.push({
              type: "negative",
              title: "前年より予約の入りが遅れています",
              content: `前年同曜日の同じ時点と比べて${day.dayTypePaceRatio != null ? `${day.dayTypePaceRatio.toFixed(2)}倍` : "遅れた"}ペースです（${describeDayType(day.dayType)}）。`,
            })
          } else if (pace === "1") {
            insights.push({
              type: "positive",
              title: "前年より予約が大きく先行しています",
              content: `前年同曜日の同じ時点と比べて${day.dayTypePaceRatio != null ? `${day.dayTypePaceRatio.toFixed(2)}倍` : "速い"}ペースです。売り切れる前に単価を上げる余地があります。`,
            })
          }

          if (day.demandLevel === "A" || day.demandLevel === "B") {
            insights.push({
              type: "positive",
              title: "需要水準が高い",
              content: `${m}月${d}日（${DAY_NAMES[dow]}）はアラートが「${day.demandLevel}」です。稼働率予測${pct(day.predictedOccupancy)}を踏まえ、価格競争力を維持しつつ収益最大化が狙えます。`,
            })
          }
          if (day.demandLevel === "D" || day.demandLevel === "E") {
            insights.push({
              type: "negative",
              title: "需要と稼働率が低い",
              content: `アラートが「${day.demandLevel}」で、稼働率予測も${pct(day.predictedOccupancy)}と低水準です。料金ランクの引き下げや需要喚起策の検討を推奨します。`,
            })
          }
          if (day.competitorMedianPrice != null) {
            const median = day.competitorMedianPrice
            const diff = (day.recommendedPrice ?? 0) - median
            const diffPercent = median > 0 ? (diff / median) * 100 : 0
            insights.push({
              type: "chart-2",
              title: "競合分析",
              content: `競合ホテルの価格水準（中央値）は${yen(median)}で、推奨価格は${diff >= 0 ? "+" : ""}${diffPercent.toFixed(1)}%（${diff >= 0 ? "高め" : "低め"}）です。`,
            })
          }
          if (day.actualAdr != null && day.actualOccupancy != null) {
            const adrDiff = day.predictedAdr != null ? day.actualAdr - day.predictedAdr : null
            insights.push({
              type: "chart-2",
              title: "実績データ",
              content:
                `本日までの実績ADRは${yen(day.actualAdr)}、実績稼働率は${pct(day.actualOccupancy)}でした。` +
                (adrDiff != null ? `推奨ADRとの差異は${signedYen(adrDiff)}で、AIの学習・コメント材料として蓄積されます。` : ""),
            })
          }

          return (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
                <DialogHeader>
                  <DialogTitle>
                    {y}年{m}月{d}日（{DAY_NAMES[dow]}）のAI分析
                  </DialogTitle>
                  <DialogDescription>需要アラート・競合分析・価格最適化の提案を表示します</DialogDescription>
                </DialogHeader>
                {/* 日のタイプと、90日前（推移のいちばん古い時点）のタイプ（DP03 — 見出しの横に置く） */}
                <div className="flex items-center gap-2 rounded-md border px-3 py-1.5" data-testid="day-type-header">
                  <span className="text-xs text-muted-foreground">日のタイプ</span>
                  <DayTypeBadge dayType={day.dayType} expectedOccupancy={day.dayTypeExpectedOccupancy} paceRatio={day.dayTypePaceRatio} />
                  {oldestHistory && (
                    <>
                      <span className="text-xs text-muted-foreground">{leadLabel(oldestHistory.daysBefore)}</span>
                      <DayTypeBadge dayType={oldestHistory.dayType} paceRatio={oldestHistory.paceRatio} />
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-6 mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base font-medium">周辺日の推奨価格・稼働率予測</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <div className="grid min-w-fit grid-flow-col auto-cols-[96px] gap-3">
                        {neighbors.map(({ date, data: n }) => {
                          const [ny, nm, nd] = date.split("-").map(Number)
                          const ndow = new Date(ny, nm - 1, nd).getDay()
                          const isSelected = date === day.date
                          const otherMonth = nm !== m
                          return (
                            <div
                              key={date}
                              data-testid="neighbor-day"
                              className={`rounded-lg border p-3 text-center ${isSelected ? "bg-primary/5 ring-2 ring-primary" : ""} ${otherMonth ? "bg-muted/30" : ""}`}
                            >
                              <div className="mb-1.5 text-xs text-muted-foreground">{DAY_NAMES[ndow]}</div>
                              <div className={`mb-1 text-base font-semibold ${isSelected ? "text-primary" : ""}`}>
                                {otherMonth ? `${nm}/${nd}` : nd}
                              </div>
                              {n ? (
                                <>
                                  <div className="mb-1">
                                    <DayTypeBadge dayType={n.dayType} />
                                  </div>
                                  <div className="mb-1 break-words text-xs text-muted-foreground">{yen(n.recommendedPrice)}</div>
                                  <div className="break-words text-xs text-muted-foreground">{pct(n.predictedOccupancy)}</div>
                                </>
                              ) : adjacentLoading && otherMonth ? (
                                <Skeleton className="mx-auto mt-2 h-8 w-14" />
                              ) : (
                                <div className="text-[10px] text-muted-foreground">データなし</div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium">
                      <DayTypeHelp label="日のタイプとその推移" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <DayTypeBadge
                        dayType={day.dayType}
                        expectedOccupancy={day.dayTypeExpectedOccupancy}
                        paceRatio={day.dayTypePaceRatio}
                        size="lg"
                      />
                      <div className="text-sm">
                        <p className="font-medium">{describeDayType(day.dayType)}</p>
                        <p className="text-xs text-muted-foreground">
                          着地見込み {pct(day.dayTypeExpectedOccupancy)}
                          {day.dayTypePaceRatio != null && `・前年同曜日の ${day.dayTypePaceRatio.toFixed(2)}倍のペース`}
                          {day.onHandRooms != null && `・今の予約 ${day.onHandRooms.toLocaleString()}室`}
                        </p>
                      </div>
                    </div>
                    {day.dayTypeHistory.length > 0 ? (
                      <ol className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="日のタイプの推移">
                        {day.dayTypeHistory.map((h) => (
                          <li key={h.daysBefore} className="flex items-center gap-1.5">
                            <span className="flex flex-col items-center rounded-md border px-2 py-1">
                              <span className="text-[10px] text-muted-foreground">{leadLabel(h.daysBefore)}</span>
                              <DayTypeBadge dayType={h.dayType} paceRatio={h.paceRatio} />
                            </span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
                          </li>
                        ))}
                        <li className="flex flex-col items-center rounded-md border border-primary/50 bg-primary/5 px-2 py-1">
                          <span className="text-[10px] text-primary">{day.actualAdr != null ? "結果" : "現在"}</span>
                          <DayTypeBadge dayType={day.dayType} />
                        </li>
                      </ol>
                    ) : (
                      <p className="text-xs text-muted-foreground">90日前より後に予約の記録が始まった日のため、推移はまだありません。</p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      「-」は、その時点の予約の記録（毎日の取り込み）が無い残日数です。
                    </p>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Card className="border-primary/50 bg-primary/5">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-primary">推奨価格 & 料金ランク</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-semibold text-primary">{yen(day.recommendedPrice)}</div>
                      <div className="flex items-center gap-2 mt-1">
                        {day.rankLabel && (
                          <Badge className={`${getRankBadgeColor(day.recommendedRank ?? 0)} text-sm font-bold`}>{day.rankLabel}</Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-muted-foreground">稼働率予測</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-semibold">{pct(day.predictedOccupancy)}</div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-muted-foreground">アラート</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {day.demandLevel ? (
                        <Badge className={`${demandBadgeClass(day.demandLevel)} text-lg px-3 py-1`}>{day.demandLevel}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                      <div className="text-xs text-muted-foreground mt-1">{demandDescription(day.demandLevel)}</div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        競合価格水準（中央値）
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-semibold">{yen(day.competitorMedianPrice)}</div>
                    </CardContent>
                  </Card>
                </div>

                {insights.length > 0 && (
                  <Card className="border-l-4 border-l-primary">
                    <CardHeader>
                      <CardTitle className="text-base font-medium flex items-center gap-2">
                        <AlertCircle className="w-5 h-5" />
                        AI分析インサイト
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {insights.map((insight, index) => (
                        <div key={index} className="flex items-start gap-3">
                          <div
                            className={`w-2 h-2 rounded-full mt-2 ${
                              insight.type === "positive"
                                ? "bg-[color:var(--positive)]"
                                : insight.type === "negative"
                                  ? "bg-[color:var(--negative)]"
                                  : "bg-[color:var(--chart-2)]"
                            }`}
                          />
                          <div className="flex-1">
                            <div className="font-medium text-sm mb-1">{insight.title}</div>
                            <p className="text-sm leading-relaxed text-muted-foreground">{insight.content}</p>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            </>
          )
        })()}
      </DialogContent>
    </Dialog>
  )
}
