"use client"

// 分析タブのインサイト（D-13 で実データに）。日次バッチが Claude API で当月の集計から作る
// （AiComment の section = analysis-insights、content は {year, month, segments, composition, leadTime} の JSON）。
// 分析インサイト・需要構成インサイト・リードタイム分析インサイトの3枚が同じものを読む。
// インサイトは当月についてだけ作るので、別の月を見ているときは文章を出さずにそう書く（別の月の文章を見せない）。

import type { ReactNode } from "react"

import { ErrorState } from "@/components/error-state"
import { formatGeneratedAt } from "@/components/pricing/ai-pricing-proposals"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type AiSummary } from "@/lib/api"

export const INSIGHT_SEGMENTS = ["部屋タイプ", "利用人数", "チャネル", "日のタイプ"] as const
export type InsightSegment = (typeof INSIGHT_SEGMENTS)[number]

export interface AnalysisInsights {
  year: number
  month: number
  segments: Array<{ segment: InsightSegment; text: string }>
  composition: string[]
  leadTime: string[]
}

const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string")

/** 保存されたインサイト（JSON）を読む。読めなければ null */
export function parseAnalysisInsights(content: string | null | undefined): AnalysisInsights | null {
  if (!content) return null
  try {
    const v = JSON.parse(content) as Partial<AnalysisInsights>
    if (typeof v.year !== "number" || typeof v.month !== "number") return null
    const segments = Array.isArray(v.segments)
      ? v.segments.filter(
          (s): s is AnalysisInsights["segments"][number] =>
            typeof s === "object" && s !== null && INSIGHT_SEGMENTS.includes(s.segment) && typeof s.text === "string",
        )
      : []
    return {
      year: v.year,
      month: v.month,
      segments,
      composition: isStringList(v.composition) ? v.composition : [],
      leadTime: isStringList(v.leadTime) ? v.leadTime : [],
    }
  } catch {
    return null
  }
}

/** 分析タブのインサイトを読み、選んでいる月のものか確かめて、読み込み・エラー・未作成・別の月を出し分ける */
export function AnalysisInsightsBody({
  period,
  pick,
  children,
}: {
  /** 選んでいる対象月（YYYY-MM） */
  period: string
  /** そのカードで出す部分が空かどうか */
  pick: (insights: AnalysisInsights) => number
  children: (insights: AnalysisInsights, generatedAt: string) => ReactNode
}) {
  const { hotelId } = useAuth()
  const query = useApiQuery<AiSummary | null>(
    hotelId ? () => api.aiSummary(hotelId, "analysis-insights") : null,
    [hotelId],
    "AI のインサイトの取得に失敗しました",
  )
  if (query.loading) return <p className="text-sm text-muted-foreground">読み込み中…</p>
  if (query.error) return <ErrorState message={query.error} onRetry={query.reload} />
  const insights = parseAnalysisInsights(query.data?.content)
  if (!insights || !query.data) {
    return <p className="text-sm text-muted-foreground">まだ AI のインサイトがありません。日次バッチが毎朝、当月の集計をもとに作ります。</p>
  }
  const insightPeriod = `${insights.year}-${String(insights.month).padStart(2, "0")}`
  if (insightPeriod !== period) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="insight-other-month">
        AI のインサイトは当月（{insights.year}年{insights.month}月）について毎朝作ります。対象月を当月にすると表示されます。
      </p>
    )
  }
  if (pick(insights) === 0) {
    return <p className="text-sm text-muted-foreground">この切り口について、AI が書けるだけの集計がまだありません（予約明細・チャネル別・部屋タイプ別の取り込み後に作ります）。</p>
  }
  return (
    <>
      {children(insights, query.data.generatedAt)}
      <p className="text-[10px] text-muted-foreground">{formatGeneratedAt(query.data.generatedAt)} に AI が当月の集計から作成</p>
    </>
  )
}
