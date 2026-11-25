import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { memoryKv } from './kv'
import { createAgency, agencyLogin, operationsSession, platformIdentity, listAgencies, updateAgency, saveCustomer, listCustomers } from './operations'
import { adminLogin, createTrial, listTrials, trialLoginInfo, updateTrial, resetTrialPassword, deleteTrial, assignTrial, trialLogin } from './service'
import { recordUsage, usageReport } from './usage'
let kv=memoryKv()
vi.mock('./kv', async original => ({...await original<typeof import('./kv')>(),kvConfigFromEnv:()=>({}),upstashKv:()=>kv}))
import { GET as getTrial, PUT as putTrial, DELETE as removeTrial } from '@/app/api/demo/trials/[id]/route'
import { POST as reset } from '@/app/api/demo/trials/[id]/reset-password/route'
import { PUT as assign } from '@/app/api/demo/trials/[id]/assignment/route'
import { GET as getUsage } from '@/app/api/demo/usage/route'
import { GET as getAgencies } from '@/app/api/demo/operations/agencies/route'
import { GET as getCustomers } from '@/app/api/demo/operations/customers/route'
import { PUT as editCustomer } from '@/app/api/demo/operations/customers/[id]/route'
const owner=platformIdentity()
async function setup() {
 await adminLogin(kv,'test-owner-password',null)
 const a=await createAgency(kv,owner,{name:'Agency A',email:'a@example.test'})
 const b=await createAgency(kv,owner,{name:'Agency B',email:'b@example.test'})
 return {a,b,aa:await agencyLogin(kv,a.account.email,a.password,null),bb:await agencyLogin(kv,b.account.email,b.password,null)}
}
describe('operations agency isolation',()=>{
 beforeEach(()=>{kv=memoryKv();vi.stubEnv('NEXT_PUBLIC_DEMO_MODE','true');vi.stubEnv('NEXT_PUBLIC_DEMO_ADMIN_CONSOLE','true');vi.stubEnv('DEMO_ADMIN_EMAIL','owner@example.test');vi.stubEnv('DEMO_TRIAL_CREDENTIALS_KEY','e'.repeat(64));vi.stubEnv('DEMO_PUBLIC_URL','https://public.example.test')})
 it('scope is server identity; platform sees all, agencies only owned trials and usage',async()=>{
  const {aa,bb}=await setup()
  const input={name:'Customer A',kind:'PROSPECT_HOTEL' as const}
  const a=await createTrial(kv,input,Date.now(),aa.identity,bb.identity.id)
  const b=await createTrial(kv,{...input,name:'Customer B'},Date.now(),bb.identity)
  const legacy=await createTrial(kv,{...input,name:'Unassigned'})
  expect(a.trial.agencyId).toBe(aa.identity.id)
  const login=await trialLogin(kv,a.trial.loginEmail!,a.password,null)
  await recordUsage(kv,login!.cookie,'view_analysis')
  expect((await listTrials(kv,Date.now(),aa.identity)).map(t=>t.id)).toEqual([a.trial.id])
  expect((await listTrials(kv,Date.now(),owner))).toHaveLength(3)
  expect((await usageReport(kv,aa.identity)).accounts.map(t=>t.id)).toEqual([a.trial.id])
  for(const other of [b.trial,legacy.trial]) {
   await expect(trialLoginInfo(kv,other.id,Date.now(),aa.identity)).rejects.toMatchObject({status:404})
   await expect(updateTrial(kv,other.id,{isActive:false},Date.now(),aa.identity)).rejects.toMatchObject({status:404})
   await expect(resetTrialPassword(kv,other.id,Date.now(),aa.identity)).rejects.toMatchObject({status:404})
   await expect(deleteTrial(kv,other.id,aa.identity)).rejects.toMatchObject({status:404})
  }
  await assignTrial(kv,a.trial.id,bb.identity.id)
  expect(await listTrials(kv,Date.now(),aa.identity)).toEqual([])
  expect((await usageReport(kv,aa.identity)).accounts).toEqual([])
 })
 it('revokes signed sessions immediately on stop and reset; cannot forge or escalate',async()=>{
  const {a,aa}=await setup()
  expect((await operationsSession(kv,aa.cookie))?.role).toBe('AGENCY')
  expect(await operationsSession(kv,aa.cookie+'x')).toBeNull()
  expect(await operationsSession(kv,aa.cookie.replace(a.account.id,'platform'))).toBeNull()
  await expect(listAgencies(kv,aa.identity)).rejects.toMatchObject({status:403})
  await updateAgency(kv,owner,a.account.id,{active:false})
  expect(await operationsSession(kv,aa.cookie)).toBeNull()
  await expect(agencyLogin(kv,a.account.email,a.password,null)).rejects.toMatchObject({status:401})
  await updateAgency(kv,owner,a.account.id,{active:true})
  expect(await operationsSession(kv,aa.cookie)).toBeNull()
  const current=await agencyLogin(kv,a.account.email,a.password,null)
  const changed=await updateAgency(kv,owner,a.account.id,{resetPassword:true})
  expect(await operationsSession(kv,current.cookie)).toBeNull()
  await expect(agencyLogin(kv,a.account.email,a.password,null)).rejects.toMatchObject({status:401})
  expect((await agencyLogin(kv,a.account.email,changed.password!,null)).identity.role).toBe('AGENCY')
 })
 it('customer assignments cannot be changed by agencies or retrieved across scope',async()=>{
  const {aa,bb}=await setup()
  const customer=await saveCustomer(kv,aa.identity,{name:'A',agencyId:bb.identity.id})
  expect(customer.agencyId).toBe(aa.identity.id)
  expect(await listCustomers(kv,bb.identity)).toEqual([])
  await expect(saveCustomer(kv,bb.identity,{name:'Stolen'},customer.id)).rejects.toMatchObject({status:404})
  await saveCustomer(kv,owner,{agencyId:bb.identity.id},customer.id)
  expect(await listCustomers(kv,aa.identity)).toEqual([])
  expect((await listCustomers(kv,bb.identity))[0].id).toBe(customer.id)
 })
 it('enforces boundaries in all HTTP handlers, including credentials, mutations and external deployments',async()=>{
  const {aa,bb}=await setup()
  const b=await createTrial(kv,{name:'Secret B',kind:'DEALER'},Date.now(),bb.identity)
  const c=await saveCustomer(kv,bb.identity,{name:'Secret company'})
  const req=(method='GET',body?:object)=>new NextRequest('https://ops.example.test/api/demo/test',{method,headers:{cookie:`demo_admin=${aa.cookie}`},...(body?{body:JSON.stringify(body)}:{})})
  const ctx={params:Promise.resolve({id:b.trial.id})}
  expect((await getTrial(req(),ctx)).status).toBe(404)
  expect((await putTrial(req('PUT',{name:'Hacked'}),ctx)).status).toBe(404)
  expect((await removeTrial(req('DELETE'),ctx)).status).toBe(404)
  expect((await reset(req('POST'),ctx)).status).toBe(404)
  expect((await assign(req('PUT',{agencyId:aa.identity.id}),ctx)).status).toBe(403)
  expect((await getAgencies(req())).status).toBe(403)
  expect((await (await getCustomers(req())).json()).data).toEqual([])
  expect((await editCustomer(req('PUT',{name:'hack'}),{params:Promise.resolve({id:c.id})})).status).toBe(404)
  expect((await (await getUsage(req())).json()).data.accounts).toEqual([])
  vi.stubEnv('NEXT_PUBLIC_DEMO_ADMIN_CONSOLE','false')
  expect((await getUsage(req())).status).toBe(403)
  expect((await getCustomers(req())).status).toBe(403)
  expect((await getTrial(req(),ctx)).status).toBe(403)
 })
 it('does not return secrets in account lists; prevents duplicate normalized logins',async()=>{
  await setup()
  expect(JSON.stringify(await listAgencies(kv,owner))).not.toMatch(/password|signingKey/)
  await expect(createAgency(kv,owner,{name:'Again',email:' A@example.test '})).rejects.toMatchObject({status:409})
 })
})
