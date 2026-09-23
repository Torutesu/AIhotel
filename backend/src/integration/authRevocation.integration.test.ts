import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

// 無効化・降格・テナント停止の即時反映と、アカウント単位のロックアウト（#78）の統合テスト。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス rtest）で検証する。
// 各テストの前にユーザーとテナントの状態を初期値へ戻す。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'rtest'
const TENANT = `${PREFIX}-tenant`
const HOTEL = `${PREFIX}-hotel`
const PASSWORD = 'Test1234'
const MANAGER_EMAIL = `${PREFIX}-manager@example.com`

describeIntegration('無効化・降格・テナント停止の即時反映（#78）', () => {
  let app: Express
  let prisma: PrismaClient

  async function cleanup() {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: PREFIX } },
      select: { id: true },
    })
    await prisma.auditLog.deleteMany({
      where: { OR: [{ tenantId: TENANT }, { userId: { in: users.map((u) => u.id) } }] },
    })
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
    await prisma.tenant.deleteMany({ where: { id: TENANT } })
  }

  async function login() {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: MANAGER_EMAIL, password: PASSWORD })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body.data.tokens as { accessToken: string; refreshToken: string }
  }

  function getMe(accessToken: string) {
    return request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`)
  }

  beforeAll(async () => {
    const appModule = await import('../app.js')
    app = appModule.app as unknown as Express
    prisma = new PrismaClient()

    await cleanup()
    await prisma.tenant.create({ data: { id: TENANT, code: TENANT, name: '失効テストテナント' } })
    await prisma.hotel.create({
      data: { id: HOTEL, tenantId: TENANT, name: '失効テストホテル', totalRooms: 50 },
    })
    await prisma.user.create({
      data: {
        email: MANAGER_EMAIL,
        password: await bcrypt.hash(PASSWORD, 10),
        name: '失効テストマネージャー',
        role: 'MANAGER',
        tenantId: TENANT,
        hotelId: HOTEL,
      },
    })
  })

  beforeEach(async () => {
    await prisma.tenant.update({ where: { id: TENANT }, data: { isActive: true } })
    await prisma.user.update({
      where: { email: MANAGER_EMAIL },
      data: { isActive: true, role: 'MANAGER', failedLoginCount: 0, lockedUntil: null },
    })
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  it('無効化した直後から、発行済みのアクセストークンが 401 になる', async () => {
    const { accessToken } = await login()
    expect((await getMe(accessToken)).status).toBe(200)

    await prisma.user.update({ where: { email: MANAGER_EMAIL }, data: { isActive: false } })

    expect((await getMe(accessToken)).status).toBe(401)
  })

  it('降格した直後から、発行済みのアクセストークンでも降格後の権限になる', async () => {
    const { accessToken } = await login()
    const updateStrategy = () =>
      request(app)
        .put('/api/v1/pricing/strategy')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ hotelId: HOTEL, weightOccupancy: 50, weightAdr: 30, weightCompetitor: 20 })

    expect((await updateStrategy()).status).toBe(200)

    await prisma.user.update({ where: { email: MANAGER_EMAIL }, data: { role: 'OPERATOR' } })

    expect((await updateStrategy()).status).toBe(403)
  })

  it('テナントを停止すると、アクセストークン・リフレッシュ・ログインのすべてが失敗する', async () => {
    const { accessToken, refreshToken } = await login()

    await prisma.tenant.update({ where: { id: TENANT }, data: { isActive: false } })

    expect((await getMe(accessToken)).status).toBe(401)

    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken })
    expect(refreshed.status).toBe(401)

    const loggedIn = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: MANAGER_EMAIL, password: PASSWORD })
    expect(loggedIn.status).toBe(401)
    // 停止中であることは漏らさず、通常の失敗と同じ文言にする
    expect(loggedIn.body.error).toBe('メールアドレスまたはパスワードが正しくありません')
  })

  describe('アカウント単位のロックアウト', () => {
    function attempt(password: string) {
      return request(app).post('/api/v1/auth/login').send({ email: MANAGER_EMAIL, password })
    }

    it('5回連続で失敗するとロックされ、正しいパスワードでも同じ文言で失敗する', async () => {
      for (let i = 0; i < 5; i++) {
        expect((await attempt('WrongPass1')).status).toBe(401)
      }

      const res = await attempt(PASSWORD)
      expect(res.status).toBe(401)
      expect(res.body.error).toBe('メールアドレスまたはパスワードが正しくありません')

      const user = await prisma.user.findUniqueOrThrow({ where: { email: MANAGER_EMAIL } })
      expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now())
      const locked = await prisma.auditLog.findFirst({
        where: { userId: user.id, action: 'ACCOUNT_LOCKED' },
      })
      expect(locked).not.toBeNull()
    })

    it('上限未満の失敗は成功ログインで数え直しになる', async () => {
      for (let i = 0; i < 4; i++) {
        expect((await attempt('WrongPass1')).status).toBe(401)
      }
      expect((await attempt(PASSWORD)).status).toBe(200)
      for (let i = 0; i < 4; i++) {
        expect((await attempt('WrongPass1')).status).toBe(401)
      }
      // 通算8回失敗しているが、成功で数え直しているのでロックされていない
      expect((await attempt(PASSWORD)).status).toBe(200)
    })

    it('ロックの期限が過ぎれば正しいパスワードでログインできる', async () => {
      await prisma.user.update({
        where: { email: MANAGER_EMAIL },
        data: { lockedUntil: new Date(Date.now() - 1_000) },
      })
      expect((await attempt(PASSWORD)).status).toBe(200)
    })
  })
})
