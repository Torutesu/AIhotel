// 外部需要動向の要因（気候・インバウンド・イベント・アクセス・新規ホテル）の型と表示名（2026-10）。
// 要因ごとの行（サンプル）は ai-summary-tab.tsx に置いている。

import type { CsvValue } from "@/lib/csv-export"

/** 本番想定のダミーKPI（デモ用） */
export type FactorKpi = { label: string; value: string; hint?: string }

export type ExternalFactorRow = {
  name: string
  status: string
  trend: string
  note: string
  kpis?: FactorKpi[]
}

export const FACTOR_STATUS_LABELS: Record<string, string> = { positive: "好調", warning: "注意", normal: "通常" }
export const FACTOR_TREND_LABELS: Record<string, string> = { up: "上昇", down: "下降", neutral: "横ばい" }

/** 一覧の CSV。指標1つにつき1行（指標の無い要因は1行）。外部要因データは未取り込みなので、どの行にも「サンプル」と書く */
export function factorsToCsvRows(category: string, factors: ExternalFactorRow[]): CsvValue[][] {
  const rows: CsvValue[][] = [["データ", "区分", "項目", "状況", "傾向", "内容", "指標", "値", "補足"]]
  for (const f of factors) {
    const base = ["サンプル", category, f.name, FACTOR_STATUS_LABELS[f.status] ?? f.status, FACTOR_TREND_LABELS[f.trend] ?? f.trend, f.note]
    if (!f.kpis || f.kpis.length === 0) rows.push([...base, "", "", ""])
    else for (const k of f.kpis) rows.push([...base, k.label, k.value, k.hint ?? ""])
  }
  return rows
}
