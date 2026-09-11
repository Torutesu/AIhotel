// アラートの遷移先解決（F-4）
//
// バックエンドのアラートは `linkTab` に画面名を持つが、その値（例 'daily'）は
// shared の `Tab` と 1:1 ではない。日別分析は「分析」タブの「実績推移」ビューに
// 統合されているため、そのままタブIDとして扱うと該当タブが存在せず画面が空白になる。
// 変換表で解決し、未知の値は遷移させない（リンク自体を表示しない）。

import type { Tab } from "@shared/types"

/** 分析タブ内のサブビュー（analysis-tab.tsx の ANALYSIS_VIEWS と対応） */
export type AnalysisView = "performance" | "composition" | "booking" | "competitor" | "free"

export interface AlertLinkTarget {
  tab: Tab
  /** tab === 'analysis' のときに開くサブビュー */
  analysisView?: AnalysisView
  /** リンクに表示する日本語ラベル */
  label: string
}

const ALERT_LINK_MAP: Record<string, AlertLinkTarget> = {
  // 旧「日別分析」タブは分析タブの「実績推移」ビューへ統合済み
  daily: { tab: "analysis", analysisView: "performance", label: "日別分析へ" },
  analysis: { tab: "analysis", label: "各種分析へ" },
  pricing: { tab: "pricing", label: "料金設定へ" },
  dashboard: { tab: "dashboard", label: "ダッシュボードへ" },
  settings: { tab: "settings", label: "設定へ" },
}

/** `linkTab` を実際に遷移できる画面へ解決する。未知・未設定は null（遷移しない）。 */
export function resolveAlertLink(linkTab: string | null | undefined): AlertLinkTarget | null {
  if (!linkTab) return null
  return ALERT_LINK_MAP[linkTab] ?? null
}
