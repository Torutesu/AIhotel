import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

// ホテルに所属する利用者のユーザー管理を自ホテルに限定する（#79）。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス hstest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'hstest'
const TENANT = `${PREFIX}-tenant`
const HOTEL_1 = `${PREFIX}-hotel-1`
const HOTEL_2 = `${PREFIX}-hotel-2`
const PASSWORD = 'Test1234'
const EMAILS = {
  manager1: `${PREFIX}-manager1@example.com`,
  operator1: `${PREFIX}-operator1@example.com`,
  operator2: `${PREFIX}-operator2@example.com`,
  tenantManager: `${PREFIX}-tenant-manager@example.com`,
}

describeIntegration('ホテル所属の利用者のユーザー管理（#79）', () => {
  let app: Express
  let prisma: PrismaClient
  const tokens: Record<string, string> = {}
  const ids: Record<string, string> = {}
  const auth = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` })

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } })
    await prisma.auditLog.deleteMany({
      where: { OR: [{ tenantId: TENANT }, { userId: { in: users.map((u) => u.id) } }] },
    })
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
    await prisma.tenant.deleteMany({ where: { id: TENANT } })
  }

  beforeAll(async () => {
    const appModule = await import('../app.js')
    app = appModule.app as unknown as Express
    prisma = new PrismaClient()
    await cleanup()

    await prisma.tenant.create({ data: { id: TENANT, code: TENANT, name: 'ホテル単位テスト' } })
    for (const id of [HOTEL_1, HOTEL_2]) {
      await prisma.hotel.create({ data: { id, tenantId: TENANT, name: id, totalRooms: 30 } })
    }
    const password = await bcrypt.hash(PASSWORD, 10)
    await prisma.user.createMany({
      data: [
        { email: EMAILS.manager1, password, name: 'ホテル1マネージャー', role: 'MANAGER', tenantId: TENANT, hotelId: HOTEL_1 },
        { email: EMAILS.operator1, password, name: 'ホテル1オペレーター', role: 'OPERATOR', tenantId: TENANT, hotelId: HOTEL_1 },
        { email: EMAILS.operator2, password, name: 'ホテル2オペレーター', role: 'OPERATOR', tenantId: TENANT, hotelId: HOTEL_2 },
        { email: EMAILS.tenantManager, password, name: '統括マネージャー', role: 'MANAGER', tenantId: TENANT },
      ],
    })
    for (const [key, email] of Object.entries(EMAILS)) {
      const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD })
      tokens[key] = res.body.data.tokens.accessToken
      ids[key] = res.body.data.user.id
    }
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  it('一覧には自ホテルのユーザーだけが出る（他ホテル・テナント統括は出ない）', async () => {
    const res = await request(app).get('/api/v1/users').query({ hotelId: HOTEL_1 }).set(auth('manager1'))
    expect(res.status).toBe(200)
    const emails = res.body.data.map((u: { email: string }) => u.email).sort()
    expect(emails).toEqual([EMAILS.manager1, EMAILS.operator1].sort())
  })

  it('他ホテルのユーザーとテナント統括ユーザーは、更新も一時パスワードの発行も存在しない扱い（404）', async () => {
    for (const target of ['operator2', 'tenantManager']) {
      const update = await request(app).put(`/api/v1/users/${ids[target]}`).set(auth('manager1')).send({ name: '変更' })
      expect(update.status, target).toBe(404)
      const reset = await request(app).post(`/api/v1/users/${ids[target]}/reset-password`).set(auth('manager1'))
      expect(reset.status, target).toBe(404)
    }
  })

  it('自ホテルのユーザーは従来どおり操作できる', async () => {
    const res = await request(app).put(`/api/v1/users/${ids.operator1}`).set(auth('manager1')).send({ name: '名前を変更' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
  })

  it('他ホテルへのユーザー作成は 403、自ホテルへは作れる', async () => {
    const other = await request(app)
      .post('/api/v1/auth/register')
      .set(auth('manager1'))
      .send({ email: `${PREFIX}-new2@example.com`, password: PASSWORD, name: 'x', role: 'OPERATOR', hotelId: HOTEL_2 })
    expect(other.status).toBe(403)

    const own = await request(app)
      .post('/api/v1/auth/register')
      .set(auth('manager1'))
      .send({ email: `${PREFIX}-new1@example.com`, password: PASSWORD, name: 'y', role: 'OPERATOR', hotelId: HOTEL_1 })
    expect(own.status, JSON.stringify(own.body)).toBe(201)
  })

  it('テナント統括のマネージャーはテナント内の全ホテルのユーザーを扱える', async () => {
    const list = await request(app).get('/api/v1/users').query({ hotelId: HOTEL_1 }).set(auth('tenantManager'))
    expect(list.body.data.map((u: { email: string }) => u.email)).toContain(EMAILS.operator2)
    const update = await request(app).put(`/api/v1/users/${ids.operator2}`).set(auth('tenantManager')).send({ name: 'ホテル2担当' })
    expect(update.status).toBe(200)
  })
})
