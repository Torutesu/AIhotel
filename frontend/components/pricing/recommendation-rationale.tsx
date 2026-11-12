"use client"

// AI 推奨の根拠（#24 E4・D-11）。以前は日別の詳細情報ダイアログ（タイプ別人数別カレンダーのセルから開く）にあった。
// 2026-10-24 にカレンダー表示を外したため、表の行から開く 日のAI分析 に移した。

import type { RecommendationRationale } from "@/lib/api"


const FACTOR_LABELS: Record<RecommendationRationale["factors"][number]["key"], string> = {
  occupancy: "稼働率",
  adr: "ADR",
  competitor: "競合価格",
}

const EXCLUDED_REASONS: Record<RecommendationRationale["excluded"][number]["reason"], string> = {
  no_data: "データが無いため使っていません",
  stale: "取得から48時間を超えて古いため使っていません",
  zero_weight: "重みが0%のため使っていません",
}

const GUARDRAIL_LABELS: Record<RecommendationRationale["guardrails"][number]["key"], string> = {
  minRank: "推奨ランクの下限",
  maxRank: "推奨ランクの上限",
  periodMinRank: "期間で決めた価格の幅（下限）",
  periodMaxRank: "期間で決めた価格の幅（上限）",
  maxDailyChange: "1回の変動幅",
  hysteresis: "据え置き（前回との差が小さい）",
}

const ADJUSTMENT_LABELS: Record<RecommendationRationale["adjustments"][number]["key"], string> = {
  event: "イベント",
  weekend: "週末",
  pace: "予約の入り方",
  otbFloor: "予約済みの室数",
}

/** 予約の入り方（D-11）の材料を一文にする。材料が無ければ null */
export function paceNote(rationale: RecommendationRationale): string | null {
  const pace = rationale.adjustments.find((a) => a.key === "pace" || a.key === "otbFloor")
  const input = pace?.input
  if (!pace || !input) return null
  const lead = typeof input.leadDays === "number" ? `残り${input.leadDays}日で` : ""
  const otb = typeof input.otbRooms === "number" ? `${input.otbRooms}室` : null
  if (pace.key === "otbFloor") {
    return otb ? `${lead}すでに${otb}の予約があるため、それを下回る稼働率は予測していません。` : null
  }
  const lastYear = typeof input.lastYearOtbRooms === "number" ? `${input.lastYearOtbRooms}室` : null
  const ratio = typeof input.ratio === "number" ? `${Math.round(input.ratio * 100)}%` : null
  if (!otb || !lastYear || !ratio) return null
  return `${lead}${otb}の予約（前年同曜日の同じ時点は${lastYear}、ペース${ratio}）。宿泊日が近いほど予約の入り方を重く見ます。`
}

/** 推奨理由（#24 E4）。なぜこのランクを推奨したかを、観点ごとのランクと重みで示す */
export function RationaleSection({ rationale }: { rationale: RecommendationRationale }) {
  return (
    <div className="space-y-2 border-t pt-3 text-sm">
      <div className="font-medium">推奨の根拠</div>
      <ul className="space-y-1">
        {rationale.factors.map((f) => (
          <li key={f.key} className="flex flex-wrap justify-between gap-2">
            <span>{FACTOR_LABELS[f.key]}から見たランク：{f.rank}</span>
            <span className="tabular-nums text-muted-foreground">重み {f.weight}%</span>
          </li>
        ))}
        {rationale.excluded.map((e) => (
          <li key={e.key} className="text-xs text-muted-foreground">
            {FACTOR_LABELS[e.key]}：{EXCLUDED_REASONS[e.reason]}
          </li>
        ))}
      </ul>
      {rationale.adjustments.length > 0 && (
        <p className="text-xs text-muted-foreground">
          稼働率予測の補正：
          {rationale.adjustments
            .map((a) => `${ADJUSTMENT_LABELS[a.key]} ${a.impact > 0 ? "+" : ""}${Math.round(a.impact * 100)}pt`)
            .join("、")}
        </p>
      )}
      {paceNote(rationale) && <p className="text-xs text-muted-foreground">{paceNote(rationale)}</p>}
      {rationale.guardrails.length > 0 && (
        <p className="text-xs text-muted-foreground">
          調整：
          {rationale.guardrails.map((g) => `${GUARDRAIL_LABELS[g.key]}でランク${g.from}→${g.to}`).join("、")}
        </p>
      )}
    </div>
  )
}
