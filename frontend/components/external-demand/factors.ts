// 外部需要動向の要因（気候・インバウンド・アクセス）の型と表示名（2026-10、D-13 で実データに）。
// 要因の行は GET /external-signals/factors（天気は気象庁、ほかは外部要因エージェントが集めた市場の動き）。

import type { CsvValue } from "@/lib/csv-export"
import type { ExternalFactor } from "@/lib/api"

export type FactorKpi = { label: string; value: string; hint?: string }

export type ExternalFactorRow = Pick<ExternalFactor, "name" | "status" | "trend" | "note"> & {
  kpis?: FactorKpi[]
  source?: ExternalFactor["source"]
  sourceUrl?: string | null
}

export const FACTOR_STATUS_LABELS: Record<string, string> = { positive: "追い風", warning: "注意", normal: "通常" }
export const FACTOR_TREND_LABELS: Record<string, string> = { up: "上向き", down: "下向き", neutral: "横ばい" }
export const FACTOR_SOURCE_LABELS: Record<string, string> = { agent: "AI収集", jma: "気象庁" }

/** 一覧の CSV。指標1つにつき1行（指標の無い要因は1行）。出どころ（AI収集・気象庁）と根拠の URL を付ける */
export function factorsToCsvRows(category: string, factors: ExternalFactorRow[]): CsvValue[][] {
  const rows: CsvValue[][] = [["出どころ", "区分", "項目", "状況", "傾向", "内容", "指標", "値", "補足", "根拠のURL"]]
  for (const f of factors) {
    const base = [
      FACTOR_SOURCE_LABELS[f.source ?? ""] ?? "",
      category,
      f.name,
      FACTOR_STATUS_LABELS[f.status] ?? f.status,
      FACTOR_TREND_LABELS[f.trend] ?? f.trend,
      f.note,
    ]
    const url = f.sourceUrl ?? ""
    if (!f.kpis || f.kpis.length === 0) rows.push([...base, "", "", "", url])
    else for (const k of f.kpis) rows.push([...base, k.label, k.value, k.hint ?? "", url])
  }
  return rows
}
