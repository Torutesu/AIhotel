"use client"

// 需要構成インサイト（2026-10 PDF c分析02「インサイトは需要構成すべてにかかるコメントを」）。
// チャネル・部屋タイプ・利用人数をまたいだコメント。Claude API によるコメント生成が未実装のため固定文のサンプル表示。

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SampleDataNotice } from "@/components/sample-data-notice"

const SAMPLE_INSIGHTS = [
  "公式サイトと楽天トラベルで室料売上の約半分を占めます。上位2チャネルの前年同月比はともにプラスで、伸びの中心は公式サイトです。",
  "ツイン系の部屋タイプは2名利用の比率が高く、ADRもシングルより約¥4,000高い水準です。2名利用の増加がツインの売上を押し上げています。",
  "一休は販売室数の構成比は1割未満ですが、ADRが最も高いチャネルです。高単価の部屋タイプ（デラックスツイン）の販売先として効いています。",
]

export function CompositionInsightSection() {
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
        <SampleDataNotice detail="Claude APIによるAIコメント生成が未実装のため、以下は固定文のサンプルです。" />
        <ul className="space-y-2 text-sm leading-relaxed">
          {SAMPLE_INSIGHTS.map((text) => (
            <li key={text} className="flex items-start gap-3">
              <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-[color:var(--chart-1)]" aria-hidden />
              <p>{text}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
