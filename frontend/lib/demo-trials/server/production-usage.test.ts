import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { memoryKv } from './kv'
import { productionUsage, productionTenants, assignProductionTenant } from './production-usage'
import { adminLogin } from './service'
import { createAgency, platformIdentity } from './operations'
const platform=platformIdentity(),agent={id:'agency-a',name:'Agency A',email:'a@example.test',role:'AGENCY' as const}
const key='local-production-usage-test-key-123456789'
let kv=memoryKv()
const fetchMock=vi.fn()
beforeEach(()=>{kv=memoryKv();vi.stubEnv('OPERATIONS_USAGE_KEY',key);vi.stubEnv('OPERATIONS_USAGE_BACKEND_URL','http://localhost:3101');vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset()})
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
describe('production usage BFF boundaries',()=>{
 it('derives agency scope from server assignments and filters out-of-scope backend rows',async()=>{
  await kv.hset('operations:production-tenant-owners','tenant-a',agent.id)
  await kv.hset('operations:production-tenant-owners','tenant-b','agency-b')
  fetchMock.mockImplementation(async(url:URL,init:RequestInit)=>{
   const body=String(init.body),headers=init.headers as Record<string,string>
   expect(JSON.parse(body)).toEqual({actorId:agent.id,role:'AGENCY',tenantIds:['tenant-a']})
   expect(headers['x-usage-signature']).toBe(createHmac('sha256',key).update(`${headers['x-usage-time']}\nPOST\n${url.pathname}\n${body}`).digest('hex'))
   return Response.json({success:true,data:{source:'customer',startedAt:null,accounts:[{id:'a',tenantId:'tenant-a',name:'A',days:[]},{id:'b',tenantId:'tenant-b',name:'B',days:[]}]}})
  })
  const report=await productionUsage(kv,agent)
  expect(report.accounts.map(a=>a.id)).toEqual(['a'])
  expect(report.accounts[0].agencyName).toBe('Agency A')
  await kv.hset('operations:production-tenant-owners','tenant-a','agency-b')
  fetchMock.mockResolvedValue(Response.json({success:true,data:{source:'customer',startedAt:null,accounts:[]}}))
  await productionUsage(kv,agent)
  expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).tenantIds).toEqual([])
 })
 it('only platform can list or assign customers and only known tenants are accepted',async()=>{
  await expect(productionTenants(kv,agent)).rejects.toMatchObject({status:403})
  await expect(assignProductionTenant(kv,agent,{tenantId:'a'})).rejects.toMatchObject({status:403})
  await adminLogin(kv,'test-owner-password',null)
  const agency=await createAgency(kv,platform,{name:'A',email:'agency@example.test'})
  fetchMock.mockImplementation(async()=>Response.json({success:true,data:[{id:'tenant-a',name:'A',isActive:true}]}))
  await expect(assignProductionTenant(kv,platform,{tenantId:'unknown',agencyId:agency.account.id})).rejects.toMatchObject({status:404})
  await assignProductionTenant(kv,platform,{tenantId:'tenant-a',agencyId:agency.account.id})
  expect((await productionTenants(kv,platform))[0].agencyId).toBe(agency.account.id)
 })
 it('fails visibly without backend configuration; never returns demo data',async()=>{
  vi.stubEnv('OPERATIONS_USAGE_KEY','')
  await expect(productionUsage(kv,platform)).rejects.toMatchObject({status:503})
  expect(fetchMock).not.toHaveBeenCalled()
 })
})
