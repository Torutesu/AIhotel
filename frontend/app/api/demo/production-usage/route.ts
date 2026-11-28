import type { NextRequest } from 'next/server'
import { handle, ok, readJson } from '@/lib/demo-trials/server/http'
import { assignProductionTenant, productionTenants, productionUsage } from '@/lib/demo-trials/server/production-usage'
export const dynamic='force-dynamic'
export const runtime='nodejs'
export async function GET(request:NextRequest) {return handle(request,{admin:true},async(kv,actor)=>ok(request.nextUrl.searchParams.get('view')==='tenants'?await productionTenants(kv,actor):await productionUsage(kv,actor)))}
export async function PUT(request:NextRequest) {return handle(request,{admin:true},async(kv,actor)=>ok(await assignProductionTenant(kv,actor,await readJson(request))))}
