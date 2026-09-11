"use client"

// 分析タブ冒頭のAIインサイト（U-15 で daily-analysis-tab.tsx から分割）
// Claude API によるコメント生成が未実装のため固定文のサンプル表示。

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SampleDataNotice } from "@/components/sample-data-notice"

/** 分析タブ冒頭のAIインサイトカード（月全体の傾向・進捗コメント） */
export function DailyAiInsightSection() {
  return (
    /* AI解説セクション - 月全体の傾向・進捗に対するコメント（個別日への対応指示はダッシュボードのアラートが担当） */
    <Card className="bg-[color:var(--sky-wash)]/25 border-[color:var(--cyan-edge)]/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <span className="text-xl" aria-hidden>
            🤖
          </span>
          分析インサイト
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          月全体の傾向・需要・予算進捗・前年進捗に対するコメントです（個別日へのピンポイントの対応指示はダッシュボードのアラートをご確認ください）
        </p>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <SampleDataNotice detail="Claude APIによるAIコメント生成が未実装のため、以下は固定文のサンプルです。" />
        <div className="space-y-2 text-sm leading-relaxed">
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2 flex-shrink-0" />
            <p>
              月全体の需要は堅調で、予算進捗は累計101.8%・前年進捗は+8.4%と上回るペースです。桜シーズンのレジャー需要と近隣イベント開催が背景にあります。
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-[color:var(--chart-2)] mt-2 flex-shrink-0" />
            <p>
              強い日は土曜日（4月5日・12日は満室）を中心とした週末で、稼働率は平均95.6%・ADRは¥23,300と好調です。この傾向は月末まで継続する見込みです。
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-[color:var(--negative)] mt-2 flex-shrink-0" />
            <p>
              弱い日は月曜日（平均稼働率56.7%）で、月全体の押し下げ要因になっています。前年同月も同様の傾向があり、平日需要の底上げが今月の課題です。
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// 日別パフォーマンス（対象月セレクタ＋サマリー＋日別テーブル）は
// components/analysis/daily-performance-section.tsx へ移設し、実データ
// （GET /dashboard/kpi の summary / dailyTrend）に接続した（U-7 / U-15）。
export { DailyPerformanceSection } from "@/components/analysis/daily-performance-section"