import { createHmac } from 'node:crypto'
import type { ProductionUsageTenant, UsageReport } from '@shared/types'
import type { OperationsIdentity } from '@/lib/operations-types'
import { DemoTrialError } from '../core'
import type { DemoKv } from './kv'
import { listAgencies, requirePlatform, validateAgency } from './operations'

const OWNERS='operations:production-tenant-owners'
async function backend<T>(path:'report'|'tenants', actor:OperationsIdentity, tenantIds?:string[]):Promise<T> {
  const key=process.env.OPERATIONS_USAGE_KEY, url=process.env.OPERATIONS_USAGE_BACKEND_URL
  if(!key || key.length<32 || !url) throw new DemoTrialError(503,'本番顧客の計測サーバーは未接続です。運営担当者が接続設定を行うと表示されます。')
  const target=new URL(`/api/v1/operations-usage/${path}`,url)
  if(target.protocol!=='https:' && !['localhost','127.0.0.1'].includes(target.hostname)) throw new DemoTrialError(503,'本番計測サーバーの接続設定を確認してください')
  const body=JSON.stringify({actorId:actor.id,role:actor.role,...(actor.role==='AGENCY'?{tenantIds:tenantIds??[]}: {})})
  const time=String(Date.now())
  const signature=createHmac('sha256',key).update(`${time}\nPOST\n${target.pathname}\n${body}`).digest('hex')
  let response:Response
  try {response=await fetch(target,{method:'POST',headers:{'content-type':'application/json','x-usage-time':time,'x-usage-signature':signature},body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)})}
  catch {throw new DemoTrialError(502,'本番計測サーバーに接続できませんでした。再試行してください。')}
  const result=await response.json().catch(()=>null)
  if(!response.ok||!result?.success)throw new DemoTrialError(502,'本番の利用状況を取得できませんでした。運営担当者に接続設定の確認を依頼してください。')
  return result.data as T
}
export async function productionUsage(kv:DemoKv,actor:OperationsIdentity) {
  const owners=await kv.hgetall(OWNERS)
  const tenantIds=Object.keys(owners).filter(id=>owners[id]===actor.id)
  const report=await backend<UsageReport>('report',actor,tenantIds)
  const agencies=actor.role==='PLATFORM_ADMIN'?await listAgencies(kv,actor):[]
  // Defense in depth: never pass an unassigned row to the agency browser.
  report.accounts=report.accounts.filter(a=>actor.role==='PLATFORM_ADMIN'||(a.tenantId&&owners[a.tenantId]===actor.id)).map(a=>({...a,agencyId:owners[a.tenantId??'']||null,agencyName:actor.role==='AGENCY'?actor.name:agencies.find(g=>g.id===owners[a.tenantId??''])?.name??'未割り当て'}))
  return report
}
export async function productionTenants(kv:DemoKv,actor:OperationsIdentity) {
  requirePlatform(actor)
  const [tenants,owners]=await Promise.all([backend<ProductionUsageTenant[]>('tenants',actor),kv.hgetall(OWNERS)])
  return tenants.map(t=>({...t,agencyId:owners[t.id]||null}))
}
export async function assignProductionTenant(kv:DemoKv,actor:OperationsIdentity,input:Record<string,unknown>) {
  requirePlatform(actor)
  if(typeof input.tenantId!=='string'||!input.tenantId||input.tenantId.length>200)throw new DemoTrialError(400,'顧客を選択してください')
  const agencyId=await validateAgency(kv,input.agencyId)
  if(!(await backend<ProductionUsageTenant[]>('tenants',actor)).some(t=>t.id===input.tenantId))throw new DemoTrialError(404,'本番顧客が見つかりません')
  await kv.hset(OWNERS,input.tenantId,agencyId??'')
  return {tenantId:input.tenantId,agencyId}
}
