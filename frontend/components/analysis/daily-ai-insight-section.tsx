"use client"

// 分析タブ冒頭のAIインサイト（U-15 で daily-analysis-tab.tsx から分割）
// Claude API によるコメント生成が未実装のため固定文のサンプル表示。
// 2026-10 PDF c分析01実績推移1: アナリティクスとしてのコメントに特化し、ほかのインサイト（ダッシュボードの AI まとめ・
// アラート）と重複させない。部屋タイプ・利用人数・チャネル・日のタイプなどのセグメントにかかるインサイトを出す。

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SampleDataNotice } from "@/components/sample-data-notice"

/** セグメント別のインサイト（サンプル）。切り口ごとに1つ */
const SAMPLE_INSIGHTS: Array<{ segment: string; color: string; text: string }> = [
  {
    segment: "部屋タイプ",
    color: "var(--positive)",
    text: "ツインの販売比率が前年同月より6ポイント高く、ADRもダブルを¥2,100上回っています。週末はツインから先に埋まるため、ツインの料金ランクを1段上げる余地があります。",
  },
  {
    segment: "利用人数",
    color: "var(--chart-2)",
    text: "2名利用が全体の58%で、1名利用は平日に偏っています（平日の1名比率 46%）。平日は1名料金、週末は2名料金の見直しが効きやすい構成です。",
  },
  {
    segment: "チャネル",
    color: "var(--chart-4)",
    text: "楽天トラベルの予約が早い時期（61日前より前）に集中し、直前の予約は自社サイトとじゃらんが中心です。直前の値上げは自社サイト・じゃらん経由の単価に効きます。",
  },
  {
    segment: "日のタイプ",
    color: "var(--negative)",
    text: "平日B型の日は稼働率が平日A型より12ポイント低い一方、ADRの差は¥900にとどまります。平日B型は稼働を優先する設定にすると売上の上積みが見込めます。",
  },
]

/** 分析タブ冒頭のAIインサイトカード（セグメント別の分析コメント） */
export function DailyAiInsightSection() {
  return (
    /* 月全体の進捗・個別日の対応指示はダッシュボードの AI まとめ・アラートが担当。ここはセグメント別の分析だけ */
    <Card className="bg-[color:var(--sky-wash)]/25 border-[color:var(--cyan-edge)]/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <span className="text-xl" aria-hidden>
            🤖
          </span>
          分析インサイト
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          部屋タイプ・利用人数・チャネル・日のタイプなど、セグメントごとの傾向に絞ったコメントです（月全体の進捗はダッシュボードのAIまとめ、個別日の対応指示はアラートをご確認ください）
        </p>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <SampleDataNotice detail="Claude APIによるAIコメント生成が未実装のため、以下は固定文のサンプルです。" />
        <ul className="space-y-2 text-sm leading-relaxed">
          {SAMPLE_INSIGHTS.map((insight) => (
            <li key={insight.segment} className="flex items-start gap-3">
              <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: insight.color }} aria-hidden />
              <p>
                <span className="mr-1.5 rounded bg-background px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{insight.segment}</span>
                {insight.text}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

// 日別パフォーマンス（対象月セレクタ＋サマリー＋日別テーブル）は
// components/analysis/daily-performance-section.tsx へ移設し、実データ
// （GET /dashboard/kpi の summary / dailyTrend）に接続した（U-7 / U-15）。
export { DailyPerformanceSection } from "@/components/analysis/daily-performance-section"