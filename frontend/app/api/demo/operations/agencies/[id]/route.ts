import type { NextRequest } from 'next/server'
import { handle, ok, readJson } from '@/lib/demo-trials/server/http'
import { updateAgency } from '@/lib/demo-trials/server/operations'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) { return handle(request, { admin: true }, async (kv, actor) => ok(await updateAgency(kv, actor, (await context.params).id, await readJson(request)))) }
