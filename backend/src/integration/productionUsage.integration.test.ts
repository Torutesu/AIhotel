import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createHmac } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import type { Express } from 'express'
const suite=process.env.DATABASE_URL?describe:describe.skip
const prefix='usageprod-test-',key='local-test-usage-key-not-for-production-12345'
suite('production usage: authenticated identities and scoped real DB aggregation',()=>{
 let db:PrismaClient,app:Express,token:string
 beforeAll(async()=>{
  vi.stubEnv('OPERATIONS_USAGE_KEY',key)
  app=(await import('../app.js')).app
  db=new PrismaClient()
  for(const name of ['a','b','trial']) {
   await db.tenant.create({data:{id:prefix+name,code:prefix+name,name:'Company '+name,...(name==='trial'?{trialKind:'PROSPECT_HOTEL' as const}:{})}})
   await db.hotel.create({data:{id:prefix+'hotel-'+name,tenantId:prefix+name,name:'Hotel '+name,totalRooms:10}})
   for(const index of [1,2])await db.user.create({data:{id:prefix+name+index,email:prefix+name+index+'@example.test',name:'User '+name+index,password:'not-used-in-test',role:'OPERATOR',tenantId:prefix+name,hotelId:prefix+'hotel-'+name}})
  }
  token=(await import('../lib/auth.js')).generateAccessToken({id:prefix+'a1',email:prefix+'a1@example.test',role:'OPERATOR',tenantId:prefix+'a',hotelId:prefix+'hotel-a'})
 })
 afterAll(async()=>{if(!db)return;await db.auditLog.deleteMany({where:{tenantId:{startsWith:prefix}}});await db.user.deleteMany({where:{id:{startsWith:prefix}}});await db.hotel.deleteMany({where:{id:{startsWith:prefix}}});await db.tenant.deleteMany({where:{id:{startsWith:prefix}}});await db.$disconnect();vi.unstubAllEnvs()})
 const signed=(scope:Record<string,unknown>,path='/api/v1/operations-usage/report',time=String(Date.now()))=>request(app).post(path).set('x-usage-time',time).set('x-usage-signature',createHmac('sha256',key).update(`${time}\nPOST\n${path}\n${JSON.stringify(scope)}`).digest('hex')).send(scope)
 it('takes user identity from authentication and rejects another tenant hotel',async()=>{
  expect((await request(app).post('/api/v1/usage').set('Authorization',`Bearer ${token}`).send({hotelId:prefix+'hotel-a',event:'view_analysis',userId:prefix+'b1'})).status).toBe(200)
  const row=await db.auditLog.findFirst({where:{tenantId:prefix+'a',action:'USAGE'}})
  expect(row?.userId).toBe(prefix+'a1')
  expect((await request(app).post('/api/v1/usage').set('Authorization',`Bearer ${token}`).send({hotelId:prefix+'hotel-b',event:'view_analysis'})).status).toBe(403)
 })
 it('counts per person, includes zero-usage users, and excludes trials and other agencies',async()=>{
  for(const name of ['a','b','trial'])await db.auditLog.create({data:{tenantId:prefix+name,userId:prefix+name+'1',action:'USAGE',entity:'Usage:chat_completed',entityId:prefix+'hotel-'+name}})
  const res=await signed({actorId:'agency-a',role:'AGENCY',tenantIds:[prefix+'a']})
  expect(res.status,JSON.stringify(res.body)).toBe(200)
  expect(res.body.data.accounts).toHaveLength(2)
  expect(res.body.data.accounts.every((a:{tenantId:string})=>a.tenantId===prefix+'a')).toBe(true)
  expect(res.body.data.accounts.find((a:{userId:string})=>a.userId===prefix+'a1').days[0].counts).toEqual({view_analysis:1,chat_completed:1})
  expect(res.body.data.accounts.find((a:{userId:string})=>a.userId===prefix+'a2').days).toEqual([])
  const all=await signed({actorId:'platform',role:'PLATFORM_ADMIN'})
  expect(all.body.data.accounts.some((a:{tenantId:string})=>a.tenantId===prefix+'trial')).toBe(false)
  expect((await signed({actorId:'agency-a',role:'AGENCY',tenantIds:[]})).body.data.accounts).toEqual([])
 })
 it('rejects unsigned requests, stale signatures and unscoped agency requests',async()=>{
  expect((await request(app).post('/api/v1/operations-usage/report').send({role:'PLATFORM_ADMIN'})).status).toBe(401)
  expect((await signed({actorId:'a',role:'AGENCY'},undefined,String(Date.now()-60000))).status).toBe(401)
  expect((await signed({actorId:'a',role:'AGENCY'})).status).toBe(400)
  expect((await signed({actorId:'a',role:'AGENCY',tenantIds:[]},'/api/v1/operations-usage/tenants')).status).toBe(403)
  expect((await request(app).get('/api/v1/platform/usage').set('Authorization',`Bearer ${token}`)).status).toBe(403)
 })
})
