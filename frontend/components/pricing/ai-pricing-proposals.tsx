"use client"

// AI価格最適化の提案（D-13 で実データに）。日次バッチが Claude API で作る提案（AiComment の section = pricing、
// content は {level, text} の配列の JSON）を出す。まだ作られていなければそう書く（固定文のサンプルは出さない）。

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ErrorState } from "@/components/error-state"
import { PROPOSAL_LEVEL_STYLE } from "@/components/pricing/pricing-constants"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type AiSummary } from "@/lib/api"

export type PricingProposal = { level: "high" | "medium" | "low"; text: string }

/** 保存された提案（JSON の配列）を読む。読めなければ空 */
export function parseProposals(content: string | null | undefined): PricingProposal[] {
  if (!content) return []
  try {
    const value: unknown = JSON.parse(content)
    if (!Array.isArray(value)) return []
    return value.filter(
      (p): p is PricingProposal =>
        typeof p === "object" && p !== null && ["high", "medium", "low"].includes((p as PricingProposal).level) && typeof (p as PricingProposal).text === "string",
    )
  } catch {
    return []
  }
}

export function formatGeneratedAt(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

export function AiPricingProposals({ hotelId }: { hotelId: string | null }) {
  const query = useApiQuery<AiSummary | null>(hotelId ? () => api.aiSummary(hotelId, "pricing") : null, [hotelId], "AI の提案の取得に失敗しました")
  const proposals = parseProposals(query.data?.content)
  return (
    <Card className="border-[color:var(--cyan-edge)]/40 bg-[color:var(--sky-wash)]/25" data-testid="ai-pricing-proposals">
      <CardHeader className="pb-1">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base font-medium">
          <span className="text-xl" aria-hidden>
            🤖
          </span>
          AI価格最適化の提案
          {query.data && (
            <span className="text-xs font-normal text-muted-foreground">（{formatGeneratedAt(query.data.generatedAt)} に AI が作成）</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {query.loading ? (
          <p className="text-sm text-muted-foreground">読み込み中…</p>
        ) : query.error ? (
          <ErrorState message={query.error} onRetry={query.reload} />
        ) : proposals.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだ AI の提案がありません。日次バッチが毎朝、需要予測・予算・アラートをもとに作ります。</p>
        ) : (
          <div className="space-y-2 text-sm leading-relaxed">
            {proposals.map((proposal, index) => {
              const style = PROPOSAL_LEVEL_STYLE[proposal.level]
              return (
                <div key={index} className="flex items-start gap-3">
                  <Badge className={`${style.className} mt-0.5 flex-shrink-0 px-1.5 text-[10px]`}>{style.label}</Badge>
                  <p>{proposal.text}</p>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
