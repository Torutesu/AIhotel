import type { UsageEvent, UsageReport } from '@shared/types/usage'
import { isDemoModeEnabled, rawRequest } from './client'
export async function trackUsage(event: UsageEvent, hotelId: string) {
  try {
    if (isDemoModeEnabled()) {
      await fetch('/api/demo/usage', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }), keepalive: true })
    } else {
      await rawRequest('/api/v1/usage', { method: 'POST', body: JSON.stringify({ event, hotelId }) })
    }
  } catch { /* Analytics must never interrupt the hotel workflow. */ }
}
export async function getUsageReport(): Promise<UsageReport> {
  if (!isDemoModeEnabled()) return rawRequest('/api/v1/platform/usage')
  const response = await fetch('/api/demo/usage', { cache: 'no-store', credentials: 'same-origin' })
  const result = await response.json()
  if (!response.ok || !result.success) throw new Error('活用状況を取得できませんでした')
  return result.data
}
