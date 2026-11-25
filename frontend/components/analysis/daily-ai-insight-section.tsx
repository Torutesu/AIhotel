"use client"

// 分析タブ冒頭のAIインサイト（U-15 で daily-analysis-tab.tsx から分割。D-13 で Claude API の実データに — analysis-insights.tsx）
// 2026-10 PDF c分析01実績推移1: アナリティクスとしてのコメントに特化し、ほかのインサイト（ダッシュボードの AI まとめ・
// アラート）と重複させない。部屋タイプ・利用人数・チャネル・日のタイプなどのセグメントにかかるインサイトを出す。

import { MessageSquareText } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AnalysisInsightsBody } from "@/components/analysis/analysis-insights"
import { useTargetPeriod, type AnalysisSectionProps } from "@/components/analysis/section-props"

/** 分析タブ冒頭のAIインサイトカード（セグメント別の分析コメント） */
export function DailyAiInsightSection(props: AnalysisSectionProps) {
  const { targetPeriod } = useTargetPeriod(props)
  return (
    /* 月全体の進捗・個別日の対応指示はダッシュボードの AI まとめ・アラートが担当。ここはセグメント別の分析だけ */
    <Card className="border-border bg-card" data-testid="analysis-insights">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <MessageSquareText className="h-5 w-5 shrink-0" aria-hidden="true" />
          分析インサイト
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          部屋タイプ・利用人数・チャネル・日のタイプなど、セグメントごとの傾向に絞ったコメントです（月全体の進捗はダッシュボードのAIまとめ、個別日の対応指示はアラートをご確認ください）
        </p>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <AnalysisInsightsBody period={targetPeriod} pick={(i) => i.segments.length}>
          {(insights) => (
            <ul className="space-y-2 text-sm leading-relaxed">
              {insights.segments.map((insight) => (
                <li key={insight.segment} className="flex items-start gap-3">
                  <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground" aria-hidden />
                  <p>
                    <span className="mr-1.5 rounded bg-background px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{insight.segment}</span>
                    {insight.text}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </AnalysisInsightsBody>
      </CardContent>
    </Card>
  )
}

// 日別パフォーマンス（対象月セレクタ＋サマリー＋日別テーブル）は
// components/analysis/daily-performance-section.tsx へ移設し、実データ
// （GET /dashboard/kpi の summary / dailyTrend）に接続した（U-7 / U-15）。
export { DailyPerformanceSection } from "@/components/analysis/daily-performance-section"