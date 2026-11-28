import type { NextRequest } from 'next/server'
import { handle, ok, readJson } from '@/lib/demo-trials/server/http'
import { requirePlatform, validateAgency } from '@/lib/demo-trials/server/operations'
import { assignTrial } from '@/lib/demo-trials/server/service'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(request, { admin: true }, async (kv, actor) => {
    requirePlatform(actor)
    return ok(await assignTrial(kv, (await context.params).id, await validateAgency(kv, (await readJson(request)).agencyId)))
  })
}
