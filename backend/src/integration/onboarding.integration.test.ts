import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

// 新規テナント・ホテルの立ち上げ（#81）の統合テスト。
// 運営がテナントと最初の ADMIN を作り、その ADMIN がホテルと部屋タイプを登録するまでを通す。
// DATABASE_URL が無ければスキップし、専用のメールアドレス・テナントコード（プレフィクス otest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'otest'
const PASSWORD = 'Test1234'
const EXISTING_TENANT = `${PREFIX}-existing`
const EXISTING_HOTEL = `${PREFIX}-existing-hotel`
const EMAILS = {
  platform: `${PREFIX}-platform@example.com`,
  existingAdmin: `${PREFIX}-existing-admin@example.com`,
  existingOperator: `${PREFIX}-existing-operator@example.com`,
  newAdmin: `${PREFIX}-new-admin@example.com`,
  sneaky: `${PREFIX}-sneaky@example.com`,
}

describeIntegration('新規テナント・ホテルの立ち上げ（#81）', () => {
  let app: Express
  let prisma: PrismaClient
  const tokens: Record<string, string> = {}
  let newTenantId = ''
  let newHotelId = ''
  let roomTypeId = ''

  async function login(email: string) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD })
    expect(res.status, `${email}: ${JSON.stringify(res.body)}`).toBe(200)
    return res.body.data.tokens.accessToken as string
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

  async function cleanup() {
    const tenants = await prisma.tenant.findMany({
      where: { code: { startsWith: PREFIX } },
      select: { id: true },
    })
    const users = await prisma.user.findMany({
      where: { email: { startsWith: PREFIX } },
      select: { id: true },
    })
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { tenantId: { in: tenants.map((t) => t.id) } },
          { userId: { in: users.map((u) => u.id) } },
        ],
      },
    })
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
    await prisma.tenant.deleteMany({ where: { code: { startsWith: PREFIX } } })
  }

  beforeAll(async () => {
    const appModule = await import('../app.js')
    app = appModule.app as unknown as Express
    prisma = new PrismaClient()
    await cleanup()

    const password = await bcrypt.hash(PASSWORD, 10)
    await prisma.tenant.create({ data: { id: EXISTING_TENANT, code: EXISTING_TENANT, name: '既存テナント' } })
    await prisma.hotel.create({
      data: { id: EXISTING_HOTEL, tenantId: EXISTING_TENANT, name: '既存ホテル', totalRooms: 30 },
    })
    await prisma.user.createMany({
      data: [
        { email: EMAILS.platform, password, name: '運営', role: 'PLATFORM_ADMIN' },
        { email: EMAILS.existingAdmin, password, name: '既存管理者', role: 'ADMIN', tenantId: EXISTING_TENANT },
        {
          email: EMAILS.existingOperator,
          password,
          name: '既存オペレーター',
          role: 'OPERATOR',
          tenantId: EXISTING_TENANT,
          hotelId: EXISTING_HOTEL,
        },
      ],
    })

    tokens.platform = await login(EMAILS.platform)
    tokens.existingAdmin = await login(EMAILS.existingAdmin)
    tokens.existingOperator = await login(EMAILS.existingOperator)
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  describe('テナント管理は運営だけ', () => {
    it('テナント管理者（ADMIN）は一覧も作成もできない', async () => {
      const list = await request(app).get('/api/v1/platform/tenants').set(auth(tokens.existingAdmin))
      expect(list.status).toBe(403)
      const created = await request(app)
        .post('/api/v1/platform/tenants')
        .set(auth(tokens.existingAdmin))
        .send({ name: '勝手なテナント', code: `${PREFIX}-sneaky` })
      expect(created.status).toBe(403)
    })

    it('運営はテナントを作成でき、同じコードは 409 になる', async () => {
      const res = await request(app)
        .post('/api/v1/platform/tenants')
        .set(auth(tokens.platform))
        .send({ name: '新規テナント', code: `${PREFIX}-NEW` })
      expect(res.status, JSON.stringify(res.body)).toBe(201)
      expect(res.body.data.code).toBe(`${PREFIX}-new`)
      newTenantId = res.body.data.id

      const dup = await request(app)
        .post('/api/v1/platform/tenants')
        .set(auth(tokens.platform))
        .send({ name: '重複', code: `${PREFIX}-new` })
      expect(dup.status).toBe(409)

      const list = await request(app).get('/api/v1/platform/tenants').set(auth(tokens.platform))
      const row = list.body.data.find((t: { id: string }) => t.id === newTenantId)
      expect(row).toMatchObject({ hotelCount: 0, userCount: 0, isActive: true })
    })
  })

  describe('最初の ADMIN の作成', () => {
    it('テナント側のロールは tenantId を指定してユーザーを作れない', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .set(auth(tokens.existingAdmin))
        .send({ email: EMAILS.sneaky, password: PASSWORD, name: '越境', role: 'ADMIN', tenantId: newTenantId })
      expect(res.status).toBe(403)
    })

    it('運営は、ホテルがまだ無いテナントに ADMIN を作れる', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .set(auth(tokens.platform))
        .send({ email: EMAILS.newAdmin, password: PASSWORD, name: '新テナント管理者', role: 'ADMIN', tenantId: newTenantId })
      expect(res.status, JSON.stringify(res.body)).toBe(201)
      expect(res.body.data.tenantId).toBe(newTenantId)
      tokens.newAdmin = await login(EMAILS.newAdmin)
    })

    it('ホテルが0件の ADMIN は、自テナントにホテルを作れる', async () => {
      const empty = await request(app).get('/api/v1/hotels').set(auth(tokens.newAdmin))
      expect(empty.body.data).toEqual([])

      const res = await request(app)
        .post('/api/v1/hotels')
        .set(auth(tokens.newAdmin))
        .send({ name: '新ホテル', totalRooms: 80 })
      expect(res.status, JSON.stringify(res.body)).toBe(201)
      expect(res.body.data.tenantId).toBe(newTenantId)
      newHotelId = res.body.data.id
    })
  })

  describe('部屋タイプ', () => {
    it('ADMIN は部屋タイプを登録でき、コードは大文字に揃い、重複は 409', async () => {
      const res = await request(app)
        .post('/api/v1/settings/room-types')
        .set(auth(tokens.newAdmin))
        .send({ hotelId: newHotelId, name: 'スタンダードツイン', code: 'std_twin', capacity: 2, count: 40 })
      expect(res.status, JSON.stringify(res.body)).toBe(201)
      expect(res.body.data.code).toBe('STD_TWIN')
      roomTypeId = res.body.data.id

      const dup = await request(app)
        .post('/api/v1/settings/room-types')
        .set(auth(tokens.newAdmin))
        .send({ hotelId: newHotelId, name: '重複', code: 'STD_TWIN', capacity: 2, count: 1 })
      expect(dup.status).toBe(409)
    })

    it('他テナントのユーザーは参照も変更もできない', async () => {
      const list = await request(app)
        .get('/api/v1/settings/room-types')
        .query({ hotelId: newHotelId })
        .set(auth(tokens.existingAdmin))
      expect(list.status).toBe(403)

      const update = await request(app)
        .put(`/api/v1/settings/room-types/${roomTypeId}`)
        .query({ hotelId: EXISTING_HOTEL })
        .set(auth(tokens.existingAdmin))
        .send({ count: 1 })
      // 自テナントのホテルIDで他テナントの部屋タイプを指すと、存在しない扱い
      expect(update.status).toBe(404)
    })

    it('オペレーターは登録できない', async () => {
      const res = await request(app)
        .post('/api/v1/settings/room-types')
        .set(auth(tokens.existingOperator))
        .send({ hotelId: EXISTING_HOTEL, name: 'x', code: 'X', capacity: 1, count: 1 })
      expect(res.status).toBe(403)
    })

    it('削除した部屋タイプと同じコードで登録し直すと復活する', async () => {
      const del = await request(app)
        .delete(`/api/v1/settings/room-types/${roomTypeId}`)
        .query({ hotelId: newHotelId })
        .set(auth(tokens.newAdmin))
      expect(del.status).toBe(200)

      const list = await request(app)
        .get('/api/v1/settings/room-types')
        .query({ hotelId: newHotelId })
        .set(auth(tokens.newAdmin))
      expect(list.body.data).toEqual([])

      const again = await request(app)
        .post('/api/v1/settings/room-types')
        .set(auth(tokens.newAdmin))
        .send({ hotelId: newHotelId, name: 'ツイン（改装後）', code: 'STD_TWIN', capacity: 3, count: 38 })
      expect(again.status).toBe(201)
      expect(again.body.data.id).toBe(roomTypeId)
      expect(again.body.data).toMatchObject({ name: 'ツイン（改装後）', capacity: 3, isActive: true })
    })
  })

  describe('契約停止', () => {
    it('運営がテナントを停止すると所属ユーザーは 401、再開すると使える', async () => {
      const stop = await request(app)
        .put(`/api/v1/platform/tenants/${newTenantId}`)
        .set(auth(tokens.platform))
        .send({ isActive: false })
      expect(stop.status).toBe(200)
      expect(await prisma.refreshToken.count({ where: { tenantId: newTenantId } })).toBe(0)

      const blocked = await request(app).get('/api/v1/hotels').set(auth(tokens.newAdmin))
      expect(blocked.status).toBe(401)

      await request(app)
        .put(`/api/v1/platform/tenants/${newTenantId}`)
        .set(auth(tokens.platform))
        .send({ isActive: true })
      const resumed = await request(app).get('/api/v1/hotels').set(auth(tokens.newAdmin))
      expect(resumed.status).toBe(200)
    })
  })
})
