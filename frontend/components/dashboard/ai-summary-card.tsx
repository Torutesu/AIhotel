"use client"

// ダッシュボードのAI解説（U-15 で dashboard-tab.tsx から分割）
// GET /dashboard/ai-summary の実データ（現在は seed の AiComment）。
// 当月だけでなく先々（翌月以降）の見通しも知らせる（PDF a01）。本文の行頭の【当月】【先々】は見出しとして表示する。

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { AiSummary } from "@/lib/api"

/** 本文を段落に分け、行頭の【…】を見出しとして取り出す（純関数） */
export function splitSummaryParagraphs(content: string): Array<{ heading: string | null; text: string }> {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const m = /^【([^】]+)】\s*(.*)$/.exec(line)
      return m ? { heading: m[1], text: m[2] } : { heading: null, text: line }
    })
}

interface AiSummaryCardProps {
  summary: AiSummary | null
  loading: boolean
}

export function AiSummaryCard({ summary, loading }: AiSummaryCardProps) {
  return (
    <Card className="border-[color:var(--cyan-edge)]/40 bg-[color:var(--sky-wash)]/25">
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <span className="text-xl" aria-hidden>
            🤖
          </span>
          AI解説
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : summary?.content ? (
          <>
            {/* 当月・先々の2段がスマホ幅でも枠内スクロールにならない高さ。長い解説だけ枠内でスクロールする */}
            <div className="max-h-96 space-y-2 overflow-y-auto text-sm leading-relaxed">
              {splitSummaryParagraphs(summary.content).map((p, i) => (
                <p key={i} className="whitespace-pre-wrap">
                  {p.heading && <span className="font-semibold">【{p.heading}】</span>}
                  {p.text}
                </p>
              ))}
            </div>
            {/* 対象年月に連動させず、最新の1件を出す（当月と先々をまとめて知らせる — PDF a01） */}
            <p className="mt-2 text-xs text-muted-foreground">
              最新の解説（生成日時: {new Date(summary.generatedAt).toLocaleString("ja-JP")}）
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">AI解説はまだ生成されていません。</p>
        )}
      </CardContent>
    </Card>
  )
}
