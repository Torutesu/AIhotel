export const USAGE_EVENTS = ['view_dashboard', 'view_pricing', 'view_analysis', 'view_reports', 'view_ai-summary', 'view_settings', 'pricing_saved', 'report_exported', 'chat_completed', 'chat_sent', 'chat_failed', 'chat_retried'] as const
export type UsageEvent = typeof USAGE_EVENTS[number]
export const USAGE_LABELS: Record<UsageEvent, string> = {
  view_dashboard: 'ダッシュボード閲覧', view_pricing: '料金設定閲覧', view_analysis: '分析閲覧', view_reports: 'レポート閲覧', 'view_ai-summary': '外部需要閲覧', view_settings: '設定閲覧',
  chat_sent: 'チャット送信', chat_failed: 'チャット回答失敗', chat_retried: 'チャット再試行',
  pricing_saved: '料金ランク保存完了', report_exported: 'レポート出力完了', chat_completed: 'チャット回答完了',
}
export type { UsageDay, UsageAccount, UsageReport } from './index'
