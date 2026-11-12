"use client"

// AI総合予測コメント（D-13 で実データに）。日次バッチが Claude API で作る外部需要の総合コメント（AiComment の section = external-outlook）。
// 【総合見通し】【注意事項】【推奨アクション】の段落を、見出しを太字にして出す。まだ作られていなければそう書く。

import { Sparkles } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ErrorState } from "@/components/error-state"
import { formatGeneratedAt } from "@/components/pricing/ai-pricing-proposals"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type AiSummary } from "@/lib/api"

/** 「【見出し】本文」の段落に分ける */
export function splitSections(content: string): Array<{ heading: string | null; body: string }> {
  return content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^【([^】]+)】\s*(.*)$/)
      return m ? { heading: m[1], body: m[2] } : { heading: null, body: line }
    })
}

export function AiOutlookCard({ hotelId }: { hotelId: string | null }) {
  const query = useApiQuery<AiSummary | null>(hotelId ? () => api.aiSummary(hotelId, "external-outlook") : null, [hotelId], "AI のコメントの取得に失敗しました")
  return (
    <Card className="border-[color:var(--cyan-edge)]/40 bg-[color:var(--sky-wash)]/25" data-testid="ai-outlook">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden />
          AI総合予測コメント
          {query.data && (
            <span className="text-xs font-normal text-muted-foreground">（{formatGeneratedAt(query.data.generatedAt)} に AI が作成）</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {query.loading ? (
          <p className="text-sm text-muted-foreground">読み込み中…</p>
        ) : query.error ? (
          <ErrorState message={query.error} onRetry={query.reload} />
        ) : !query.data ? (
          <p className="text-sm text-muted-foreground">まだ AI のコメントがありません。日次バッチが毎朝、外部要因と需要予測をもとに作ります。</p>
        ) : (
          <div className="space-y-4 text-sm leading-relaxed">
            {splitSections(query.data.content).map((s, i) => (
              <p key={i}>
                {s.heading && (
                  <>
                    <strong>【{s.heading}】</strong>
                    <br />
                  </>
                )}
                {s.body}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
