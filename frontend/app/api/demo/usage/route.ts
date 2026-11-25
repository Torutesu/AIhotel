import type { NextRequest } from 'next/server'
import { handle, ok, readJson, TRIAL_COOKIE } from '@/lib/demo-trials/server/http'
import { recordUsage, usageReport } from '@/lib/demo-trials/server/usage'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function GET(request: NextRequest) {
  return handle(request, { admin: true }, async kv => ok(await usageReport(kv)))
}
export async function POST(request: NextRequest) {
  return handle(request, {}, async kv => {
    const { event } = await readJson(request)
    await recordUsage(kv, request.cookies.get(TRIAL_COOKIE)?.value, event)
    return ok(null)
  })
}
