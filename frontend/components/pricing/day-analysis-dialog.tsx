"use client"

// 日別のAI分析ダイアログ（U-15 で pricing-tab.tsx から分割）
// 表示している内容はすべてカレンダーAPIの実データから導出した説明文。

import { AlertCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  demandBadgeClass,
  demandDescription,
  getRankBadgeColor,
} from "@/components/pricing/pricing-constants"
import { DAY_NAMES } from "@/lib/date"
import { formatPercent as pct, formatSignedYen as signedYen, formatYen as yen } from "@/lib/format"
import type { PricingCalendarDay } from "@/lib/api"

interface DayAnalysisDialogProps {
  /** 選択中の日。null ならダイアログを閉じる */
  day: PricingCalendarDay | null
  /** 周辺日を並べるための同月分のカレンダー */
  days: PricingCalendarDay[]
  onClose: () => void
}

export function DayAnalysisDialog({ day: selectedDay, days, onClose }: DayAnalysisDialogProps) {
  if (!selectedDay) return null

  return (
          <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto w-full sm:!max-w-[90vw] lg:!max-w-[60vw]">
        {(() => {
          const day = selectedDay
          const [y, m, d] = day.date.split("-").map(Number)
          const dow = new Date(day.date).getDay()
          const dayIdx = days.findIndex((x) => x.date === day.date)
          const neighborStart = Math.max(0, dayIdx - 3)
          const neighbors = days.slice(neighborStart, dayIdx + 4)

          const insights: Array<{ type: string; title: string; content: string }> = []

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
              <DialogHeader>
                <DialogTitle>
                  {y}年{m}月{d}日（{DAY_NAMES[dow]}）のAI分析
                </DialogTitle>
                <DialogDescription>需要アラート・競合分析・価格最適化の提案を表示します</DialogDescription>
              </DialogHeader>

              <div className="space-y-6 mt-4">
                {neighbors.length > 1 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base font-medium">周辺日の推奨価格・稼働率予測</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <div className="grid grid-flow-col auto-cols-[90px] gap-3 min-w-fit">
                          {neighbors.map((n) => {
                            const [, , nd] = n.date.split("-")
                            const ndow = new Date(n.date).getDay()
                            const isSelected = n.date === day.date
                            return (
                              <div
                                key={n.date}
                                className={`p-3 border rounded-lg text-center ${isSelected ? "ring-2 ring-primary bg-primary/5" : ""}`}
                              >
                                <div className="text-xs text-muted-foreground mb-1.5">{DAY_NAMES[ndow]}</div>
                                <div className={`text-base font-semibold mb-2 ${isSelected ? "text-primary" : ""}`}>{Number(nd)}</div>
                                <div className="text-xs text-muted-foreground mb-1 break-words">{yen(n.recommendedPrice)}</div>
                                <div className="text-xs text-muted-foreground break-words">{pct(n.predictedOccupancy)}</div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

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
