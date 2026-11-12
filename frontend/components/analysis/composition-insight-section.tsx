"use client"

// 需要構成インサイト（2026-10 PDF c分析02「インサイトは需要構成すべてにかかるコメントを」）。
// チャネル・部屋タイプ・利用人数をまたいだコメント。D-13 で Claude API の実データに（analysis-insights.tsx）。

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AnalysisInsightsBody } from "@/components/analysis/analysis-insights"
import { useTargetPeriod, type AnalysisSectionProps } from "@/components/analysis/section-props"

export function CompositionInsightSection(props: AnalysisSectionProps) {
  const { targetPeriod } = useTargetPeriod(props)
  return (
    <Card className="bg-[color:var(--sky-wash)]/25 border-[color:var(--cyan-edge)]/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <span className="text-xl" aria-hidden>
            🤖
          </span>
          需要構成インサイト
        </CardTitle>
        <p className="text-xs text-muted-foreground">チャネル・部屋タイプ・利用人数をまたいだ需要構成全体へのコメントです</p>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <AnalysisInsightsBody period={targetPeriod} pick={(i) => i.composition.length}>
          {(insights) => (
            <ul className="space-y-2 text-sm leading-relaxed">
              {insights.composition.map((text) => (
                <li key={text} className="flex items-start gap-3">
                  <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-[color:var(--chart-1)]" aria-hidden />
                  <p>{text}</p>
                </li>
              ))}
            </ul>
          )}
        </AnalysisInsightsBody>
      </CardContent>
    </Card>
  )
}
