import type { NextRequest } from 'next/server'
import { handle, ok, readJson } from '@/lib/demo-trials/server/http'
import { DemoTrialError } from '@/lib/demo-trials/core'
import { usageReport } from '@/lib/demo-trials/server/usage'
import { listTrials } from '@/lib/demo-trials/server/service'
import { listCustomers, saveCustomer } from '@/lib/demo-trials/server/operations'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) { return handle(request, { admin: true }, async (kv, actor) => ok(await saveCustomer(kv, actor, await readJson(request), (await context.params).id))) }

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(request, { admin: true }, async (kv, actor) => {
    const id = (await context.params).id
    const customer = (await listCustomers(kv, actor)).find(c => c.id === id)
    if (!customer) throw new DemoTrialError(404, '顧客が見つかりません')
    const trials = (await listTrials(kv, Date.now(), actor)).filter(t => customer.trialIds?.includes(t.id) && (t.agencyId ?? null) === customer.agencyId)
    const report = await usageReport(kv, actor)
    return ok({ customer, trials, report: { ...report, accounts: report.accounts.filter(a => trials.some(t => t.id === a.id)) } })
  })
}
