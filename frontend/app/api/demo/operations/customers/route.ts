import type { NextRequest } from 'next/server'
import { handle, ok, readJson } from '@/lib/demo-trials/server/http'
import { listCustomers, saveCustomer } from '@/lib/demo-trials/server/operations'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function GET(request: NextRequest) { return handle(request, { admin: true }, async (kv, actor) => ok(await listCustomers(kv, actor))) }
export async function POST(request: NextRequest) { return handle(request, { admin: true }, async (kv, actor) => ok(await saveCustomer(kv, actor, await readJson(request)), 201)) }
