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
          <p className="max-h-60 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
            {summary.content}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">この月のAIまとめはまだ生成されていません。</p>
        )}
      </CardContent>
    </Card>
  )
}
