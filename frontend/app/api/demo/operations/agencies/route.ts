import type { NextRequest } from 'next/server'
import { handle, ok, readJson } from '@/lib/demo-trials/server/http'
import { createAgency, listAgencies } from '@/lib/demo-trials/server/operations'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function GET(request: NextRequest) { return handle(request, { admin: true }, async (kv, actor) => ok(await listAgencies(kv, actor))) }
export async function POST(request: NextRequest) { return handle(request, { admin: true }, async (kv, actor) => ok(await createAgency(kv, actor, await readJson(request)), 201)) }
