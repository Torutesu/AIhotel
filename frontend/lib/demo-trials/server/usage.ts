import type { OperationsIdentity } from "@/lib/operations-types"
import type { UsageDay, UsageEvent, UsageReport } from '@shared/types/usage'
import type { DemoKv } from './kv'
import { listTrials, trialSession } from './service'
import { DemoTrialError } from '../core'
import { USAGE_EVENTS } from '@shared/types/usage'

// Retain only dates, operation timestamps and fixed feature identifiers. Never retain prompts, answers or entered values.
export async function recordUsage(kv: DemoKv, cookie: string | undefined, event: unknown, now = Date.now()) {
  const session = await trialSession(kv, cookie, now)
  if (!session.active) throw new DemoTrialError(401, 'ログインしてください')
  if (typeof event !== 'string' || !USAGE_EVENTS.includes(event as UsageEvent)) throw new DemoTrialError(400, '対象の操作が正しくありません')
  const id = cookie!.split('.')[0] // identity is taken only from the verified signed cookie
  const window = Math.floor(now / 60000)
  if (await kv.incrWithTtl(`usage:limit:${id}:${window}`, 120) > 120) throw new DemoTrialError(429, 'しばらくしてからお試しください')
  const key = `usage:trial:${id}`
  const at = new Date(now).toISOString()
  const day = new Date(now + 9 * 3600000).toISOString().slice(0, 10)
  await kv.setIfAbsent('usage:startedAt', at)
  await kv.setIfAbsent(key, '[]')
  for (let attempt = 0; attempt < 10; attempt++) {
    const before = await kv.get(key) ?? '[]'
    const cutoff = new Date(now - 89 * 86400000 + 9 * 3600000).toISOString().slice(0, 10)
    const days = (JSON.parse(before) as UsageDay[]).filter(d => d.day >= cutoff)
    let row = days.find(d => d.day === day)
    if (!row) { row = { day, counts: {}, lastAt: at }; days.push(row) }
    row.counts[event as UsageEvent] = (row.counts[event as UsageEvent] ?? 0) + 1
    if (row.lastAt < at) row.lastAt = at
    row.lastByEvent ??= {}
    if (!row.lastByEvent[event as UsageEvent] || row.lastByEvent[event as UsageEvent]! < at) row.lastByEvent[event as UsageEvent] = at
    row.events = [...(row.events ?? []), { event: event as UsageEvent, at }].sort((a,b)=>a.at.localeCompare(b.at)).slice(-30)
    if (await kv.compareAndSet(key, before, JSON.stringify(days))) return
  }
  throw new DemoTrialError(503, '計測を保存できませんでした')
}
export async function usageReport(kv: DemoKv, actor?: OperationsIdentity): Promise<UsageReport> {
  const trials = await listTrials(kv, Date.now(), actor)
  return { source: 'trial', generatedAt: new Date().toISOString(), startedAt: await kv.get('usage:startedAt'), accounts: await Promise.all(trials.map(async t => ({ id: t.id, name: t.name, email: t.loginEmail, lastLoginAt: t.lastLoginAt, expiresAt: t.expiresAt, status: t.status, days: (JSON.parse(await kv.get(`usage:trial:${t.id}`) ?? '[]') as UsageDay[]).filter(d => d.day >= new Date(Date.now() - 89 * 86400000 + 9 * 3600000).toISOString().slice(0,10)) }))) }
}
