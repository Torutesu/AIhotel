// アラートの遷移先解決（F-4）
//
// バックエンドのアラートは `linkTab` に画面名を持つが、その値（例 'daily'）は
// shared の `Tab` と 1:1 ではない。日別分析は「分析」タブの「実績推移」ビューに
// 統合されているため、そのままタブIDとして扱うと該当タブが存在せず画面が空白になる。
// 変換表で解決し、未知の値は遷移させない（リンク自体を表示しない）。

import type { Tab } from "@shared/types"

/** 分析タブ内のサブビュー（analysis-tab.tsx の ANALYSIS_VIEWS と対応） */
export type AnalysisView = "performance" | "composition" | "booking" | "competitor" | "ota" | "free"

export interface AlertLinkTarget {
  tab: Tab
  /** tab === 'analysis' のときに開くサブビュー */
  analysisView?: AnalysisView
  /** リンクに表示する日本語ラベル */
  label: string
  /** 遷移先で開く対象年月（"yyyy-MM"）。アラートの対象日・対象月から決める（先々のアラートを今月で開かない） */
  periodMonth?: string
  /** 料金設定で強調する日（"yyyy-MM-dd"）。月単位のアラートには無い */
  focusDate?: string
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

/**
 * 月単位のアラートか。ruleKey が ":yyyy-MM" で終わるもの（着地予測の予算未達 `LANDING_BELOW_BUDGET:2026-11` など）。
 * 対象日はその月の1日になっているため、特定の日として見せない
 */
export function isMonthLevelAlert(ruleKey: string | null | undefined): boolean {
  return /:\d{4}-\d{2}$/.test(ruleKey ?? "")
}

/** 対象年月を持つ画面（ここへは対象日・対象月の年月で遷移する） */
const PERIOD_TABS: Tab[] = ["dashboard", "pricing", "analysis"]

/**
 * アラートの遷移先に対象年月と強調する日を足す（純関数）。
 * targetDate は API の日付（UTC 0時の ISO 文字列）かデモの "yyyy-MM-dd" なので、先頭10文字で日付を決める
 */
export function alertLinkFor(alert: { linkTab: string | null; targetDate: string | null; ruleKey?: string | null }): AlertLinkTarget | null {
  const link = resolveAlertLink(alert.linkTab)
  if (!link || !alert.targetDate || !PERIOD_TABS.includes(link.tab)) return link
  const date = alert.targetDate.slice(0, 10)
  return {
    ...link,
    periodMonth: date.slice(0, 7),
    ...(link.tab === "pricing" && !isMonthLevelAlert(alert.ruleKey) ? { focusDate: date } : {}),
  }
}
