"use client"

// 日別のAI分析ダイアログ（U-15 で pricing-tab.tsx から分割。2026-10 の画面修正 PDF b01・b03、xlsx DP03 で作り直し）。
//   - 見出しの横に、今の日のタイプ・優先モデルと 90日前のタイプ
//   - 日のタイプと優先モデル（推移、AI が作った同じ区分の型）
//   - この日のブッキングカーブ・ADR推移（合計／タイプ別／利用人数別。初期値は合計）
//   - 同じタイプの日（参考に5日。前後の日付ではなく、日のタイプが同じ傾向の日）
//   - AI インサイト（この日だけの外部要因 = イベント・天候を項目別に、型の見立て、競合・実績）
//   - 日単位のシミュレーション（優先モデル・料金ランクを変えたときの見込み。先の日だけ。保存しない）
// 表示はカレンダー API と GET /pricing/day-insight・/pricing/day-simulation の実データから導出した説明文。

import { AlertCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { demandBadgeClass, demandDescription, getRankBadgeColor } from "@/components/pricing/pricing-constants"
import { DayModelBadge, DayTypeBadge, leadLabel } from "@/components/pricing/day-type"
import {
  buildDayTypeInsights,
  buildExternalFactors,
  DayCurveSection,
  DaySimulationSection,
  DayTypeSection,
  SimilarDaysSection,
  type DayInsightItem,
} from "@/components/pricing/day-analysis-sections"
import { useApiQuery } from "@/hooks/use-api-query"
import { DAY_NAMES, parseDateStr, todayJstStr } from "@/lib/date"
import { formatPercent as pct, formatSignedYen as signedYen, formatYen as yen } from "@/lib/format"
import { api, type DayInsight, type PriceRank, type PricingCalendarDay } from "@/lib/api"

interface DayAnalysisDialogProps {
  /** 選択中の日。null ならダイアログを閉じる */
  day: PricingCalendarDay | null
  onClose: () => void
}

export function DayAnalysisDialog({ day: selectedDay, onClose }: DayAnalysisDialogProps) {
  if (!selectedDay) return null
  return <DayAnalysisContent day={selectedDay} onClose={onClose} />
}

/** 競合・実績・アラートの見立て（カレンダーの値から） */
export function buildCalendarInsights(day: PricingCalendarDay): DayInsightItem[] {
  const items: DayInsightItem[] = []
  const date = parseDateStr(day.date)
  const label = `${date.getMonth() + 1}月${date.getDate()}日（${DAY_NAMES[date.getDay()]}）`
  if (day.demandLevel === "A" || day.demandLevel === "B") {
    items.push({
      type: "positive",
      title: "需要水準が高い",
      content: `${label}はアラートが「${day.demandLevel}」です。稼働率予測${pct(day.predictedOccupancy)}を踏まえ、価格競争力を維持しつつ収益最大化が狙えます。`,
    })
  }
  if (day.demandLevel === "D" || day.demandLevel === "E") {
    items.push({
      type: "negative",
      title: "需要と稼働率が低い",
      content: `アラートが「${day.demandLevel}」で、稼働率予測も${pct(day.predictedOccupancy)}と低水準です。料金ランクの引き下げや需要喚起策の検討を推奨します。`,
    })
  }
  if (day.competitorMedianPrice != null) {
    const median = day.competitorMedianPrice
    const diff = (day.recommendedPrice ?? 0) - median
    const diffPercent = median > 0 ? (diff / median) * 100 : 0
    items.push({
      type: "info",
      title: "競合分析",
      content: `競合ホテルの価格水準（中央値）は${yen(median)}で、推奨価格は${diff >= 0 ? "+" : ""}${diffPercent.toFixed(1)}%（${diff >= 0 ? "高め" : "低め"}）です。`,
    })
  }
  if (day.actualAdr != null && day.actualOccupancy != null) {
    const adrDiff = day.predictedAdr != null ? day.actualAdr - day.predictedAdr : null
    items.push({
      type: "info",
      title: "実績データ",
      content:
        `実績ADRは${yen(day.actualAdr)}、実績稼働率は${pct(day.actualOccupancy)}でした。` +
        (adrDiff != null ? `推奨ADRとの差異は${signedYen(adrDiff)}で、AIの学習・コメント材料として蓄積されます。` : ""),
    })
  }
  return items
}

const DOT_CLASS: Record<DayInsightItem["type"], string> = {
  positive: "bg-[color:var(--positive)]",
  negative: "bg-[color:var(--negative)]",
  info: "bg-[color:var(--chart-2)]",
}

function DayAnalysisContent({ day, onClose }: { day: PricingCalendarDay; onClose: () => void }) {
  const { hotelId } = useAuth()
  const date = parseDateStr(day.date)
  // 日単位のシミュレーションの API は日本時間の今日より前を受け付けないので、同じ基準で「結果の出た日」を決める
  const isPast = day.date < todayJstStr()
  const { data: insight, loading, error, reload } = useApiQuery<DayInsight>(
    hotelId ? () => api.dayInsight(hotelId, day.date) : null,
    [hotelId, day.date],
    "日の分析の取得に失敗しました",
  )
  const { data: ranks } = useApiQuery<PriceRank[]>(hotelId && !isPast ? () => api.priceRanks(hotelId) : null, [hotelId, isPast], "料金ランクの取得に失敗しました")

  // 推移のいちばん古い時点（ふつうは90日前）
  const oldestHistory = day.dayTypeHistory[0] ?? null
  const insights = [...buildDayTypeInsights(insight ?? null), ...buildCalendarInsights(day)]
  const externalFactors = buildExternalFactors(insight ?? null)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] w-full overflow-y-auto sm:!max-w-[90vw] lg:!max-w-[64vw]">
        <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
          <DialogHeader>
            <DialogTitle>
              {date.getFullYear()}年{date.getMonth() + 1}月{date.getDate()}日（{DAY_NAMES[date.getDay()]}）のAI分析
            </DialogTitle>
            <DialogDescription>日のタイプ・予約の入り方・外部要因・シミュレーションを表示します</DialogDescription>
          </DialogHeader>
          {/* 日のタイプと優先モデル、90日前（推移のいちばん古い時点）のタイプ（DP03 — 見出しの横に置く） */}
          <div className="flex items-center gap-2 rounded-md border px-3 py-1.5" data-testid="day-type-header">
            <span className="text-xs text-muted-foreground">日のタイプ</span>
            <DayTypeBadge dayType={day.dayType} model={day.dayTypeModel} typicalOccupancy={day.dayTypeTypicalOccupancy} />
            <DayModelBadge model={day.dayTypeModel} />
            {oldestHistory && (
              <>
                <span className="text-xs text-muted-foreground">{leadLabel(oldestHistory.daysBefore)}</span>
                <DayTypeBadge dayType={oldestHistory.dayType} />
              </>
            )}
          </div>
        </div>

        <div className="mt-4 space-y-6">
          {loading ? (
            <Skeleton className="h-[160px] w-full" />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : insight ? (
            <DayTypeSection insight={insight} isPast={isPast} />
          ) : null}

          <DayCurveSection date={day.date} insight={insight ?? null} />

          {insight && <SimilarDaysSection insight={insight} />}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card className="border-primary/50 bg-primary/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-primary">推奨価格 & 料金ランク</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold text-primary">{yen(day.recommendedPrice)}</div>
                <div className="mt-1 flex items-center gap-2">
                  {day.rankLabel && <Badge className={`${getRankBadgeColor(day.recommendedRank ?? 0)} text-sm font-bold`}>{day.rankLabel}</Badge>}
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
                  <Badge className={`${demandBadgeClass(day.demandLevel)} px-3 py-1 text-lg`}>{day.demandLevel}</Badge>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
                <div className="mt-1 text-xs text-muted-foreground">{demandDescription(day.demandLevel)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">競合価格水準（中央値）</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{yen(day.competitorMedianPrice)}</div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-l-4 border-l-primary">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-medium">
                <AlertCircle className="h-5 w-5" />
                AI分析インサイト
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div data-testid="external-factors">
                <p className="mb-1.5 text-sm font-medium">この日の外部要因</p>
                <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {externalFactors.map((f) => (
                    <div key={f.label} className="rounded-md border px-3 py-2">
                      <dt className="text-xs text-muted-foreground">{f.label}</dt>
                      {f.items.map((item) => (
                        <dd key={item} className="text-sm">
                          {item}
                        </dd>
                      ))}
                    </div>
                  ))}
                </dl>
              </div>
              {insights.map((insight, index) => (
                <div key={index} className="flex items-start gap-3">
                  <div className={`mt-2 h-2 w-2 rounded-full ${DOT_CLASS[insight.type]}`} />
                  <div className="flex-1">
                    <div className="mb-1 text-sm font-medium">{insight.title}</div>
                    <p className="text-sm leading-relaxed text-muted-foreground">{insight.content}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {isPast ? (
            <p className="text-xs text-muted-foreground">結果の出た日のため、シミュレーションはありません。</p>
          ) : (
            <DaySimulationSection date={day.date} ranks={ranks ?? []} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
