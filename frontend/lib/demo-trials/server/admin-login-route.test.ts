import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { memoryKv } from './kv'
let kv = memoryKv()
vi.mock('./kv', async original => ({ ...await original<typeof import('./kv')>(), kvConfigFromEnv: () => ({}), upstashKv: () => kv }))
import { POST, GET } from '@/app/api/demo/admin/session/route'
const request = (email: string) => new NextRequest('https://example.test/api/demo/admin/session', { method: 'POST', body: JSON.stringify({ email, password: 'test-owner-password' }) })
describe('server operations login', () => {
  beforeEach(() => { kv=memoryKv();vi.stubEnv('NEXT_PUBLIC_DEMO_MODE','true');vi.stubEnv('NEXT_PUBLIC_DEMO_ADMIN_CONSOLE','true');vi.stubEnv('DEMO_ADMIN_EMAIL','owner@example.test') })
  it('issues and restores the verified platform identity', async()=>{
    const response=await POST(request(' OWNER@example.test '))
    expect(response.status).toBe(200)
    expect((await response.json()).data.identity.role).toBe('PLATFORM_ADMIN')
    const cookie=response.cookies.get('demo_admin')!.value
    expect((await GET(new NextRequest('https://example.test/api/demo/admin/session',{headers:{cookie:`demo_admin=${cookie}`}}))).status).toBe(200)
  })
  it('rejects missing and expired cookies instead of trusting the browser role',async()=>{
    expect((await GET(new NextRequest('https://example.test/api/demo/admin/session'))).status).toBe(401)
    expect((await GET(new NextRequest('https://example.test/api/demo/admin/session',{headers:{cookie:'demo_admin=1.fake'}}))).status).toBe(401)
  })
  it('rejects unknown logins without issuing a cookie',async()=>{const response=await POST(request('unknown@example.test'));expect(response.status).toBe(401);expect(response.cookies.get('demo_admin')).toBeUndefined()})
  it('fails closed without configuration and on external builds',async()=>{vi.stubEnv('DEMO_ADMIN_EMAIL','');expect((await POST(request('owner@example.test'))).status).toBe(503);vi.stubEnv('NEXT_PUBLIC_DEMO_ADMIN_CONSOLE','false');expect((await POST(request('owner@example.test'))).status).toBe(403)})
})
