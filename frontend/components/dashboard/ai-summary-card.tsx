"use client"

// ダッシュボードのAI解説（U-15 で dashboard-tab.tsx から分割）
// GET /dashboard/ai-summary の実データ（現在は seed の AiComment）。

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { AiSummary } from "@/lib/api"

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
            <p className="max-h-60 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
              {summary.content}
            </p>
            {/* 表示している月ではなく、最新の1件を出している（対象月との対応づけは Claude API の導入時 — #92） */}
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
