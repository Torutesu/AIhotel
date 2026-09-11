import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

// リフレッシュトークンの回転・再利用検知の統合テスト（#49-4）。
//
// api.integration.test.ts と同じ方針で、DATABASE_URL が無ければスキップし、
// 専用のテナント・ユーザー（プレフィクス rtest）を作って検証する。
// 他の統合テストと同時に走っても干渉しないよう、プレフィクスを分けている。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'rtest'
const TENANT = `${PREFIX}-tenant`
const HOTEL = `${PREFIX}-hotel`
const EMAIL = `${PREFIX}-manager@example.com`
const PASSWORD = 'Test1234'

describeIntegration('リフレッシュトークンの回転と再利用検知（#49-4）', () => {
  let app: Express
  let prisma: PrismaClient
  let userId = ''

  async function login() {
    const res = await request(app).post('/api/v1/auth/login').send({ email: EMAIL, password: PASSWORD })
    expect(res.status, `ログインに失敗: ${JSON.stringify(res.body)}`).toBe(200)
    return res.body.data.tokens as { accessToken: string; refreshToken: string }
  }

  async function refresh(refreshToken: string) {
    return request(app).post('/api/v1/auth/refresh').send({ refreshToken })
  }

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

  beforeAll(async () => {
    const appModule = await import('../app.js')
    app = appModule.app as unknown as Express
    prisma = new PrismaClient()

    await cleanup()

    await prisma.tenant.create({ data: { id: TENANT, code: TENANT, name: '回転テストテナント' } })
    await prisma.hotel.create({
      data: { id: HOTEL, tenantId: TENANT, name: '回転テストホテル', totalRooms: 50 },
    })
    const user = await prisma.user.create({
      data: {
        email: EMAIL,
        password: await bcrypt.hash(PASSWORD, 10),
        name: '回転テストマネージャー',
        role: 'MANAGER',
        tenantId: TENANT,
        hotelId: HOTEL,
      },
    })
    userId = user.id
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('リフレッシュすると新しいトークンが発行され、旧トークンは失効済みとして残る', async () => {
    const first = await login()

    const res = await refresh(first.refreshToken)
    expect(res.status).toBe(200)
    const rotated = res.body.data.tokens as { refreshToken: string }
    expect(rotated.refreshToken).not.toBe(first.refreshToken)

    // 旧トークンの行は削除されず revokedAt が入る（再利用検知のため）
    const rows = await prisma.refreshToken.findMany({
      where: { userId },
      select: { revokedAt: true },
      orderBy: { createdAt: 'asc' },
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].revokedAt).not.toBeNull()
    expect(rows[1].revokedAt).toBeNull()

    // 新しいトークンはそのまま使える
    const second = await refresh(rotated.refreshToken)
    expect(second.status).toBe(200)
  })

  it('失効済みトークンを再提示すると 401 になり、当該ユーザーの全トークンが失効する', async () => {
    const session = await login()
    const other = await login() // 別端末のセッション

    const rotated = await refresh(session.refreshToken)
    expect(rotated.status).toBe(200)

    // 盗用は通常「しばらく経ってから」再生される。回転直後の再提示は正規利用者の
    // 競合として扱う猶予があるため、猶予を過ぎた状況を作ってから再提示する
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    })

    // 盗まれた旧トークンを再提示
    const reused = await refresh(session.refreshToken)
    expect(reused.status).toBe(401)
    expect(reused.body).toMatchObject({ success: false })

    // 再利用検知後は、回転で得た新トークンも別端末のトークンも使えない
    const rotatedToken = rotated.body.data.tokens.refreshToken as string
    expect((await refresh(rotatedToken)).status).toBe(401)
    expect((await refresh(other.refreshToken)).status).toBe(401)
    expect(await prisma.refreshToken.count({ where: { userId } })).toBe(0)

    // 監査ログに残る
    const audit = await prisma.auditLog.findFirst({
      where: { userId, action: 'TOKEN_REUSE_DETECTED' },
    })
    expect(audit).not.toBeNull()

    // 再ログインは通常どおりできる
    expect((await login()).refreshToken).toBeTruthy()
  })

  it('同じトークンで同時にリフレッシュしても発行されるのは1ペアだけ', async () => {
    await prisma.refreshToken.deleteMany({ where: { userId } })
    const session = await login()

    const [a, b] = await Promise.all([refresh(session.refreshToken), refresh(session.refreshToken)])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 401])

    // 成功した1本ぶんだけが有効なトークンとして残る（失効済みの旧トークンを除く）
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(1)
  })

  it('回転直後の再提示（タブ競合）では他端末のセッションを切らない', async () => {
    await prisma.refreshToken.deleteMany({ where: { userId } })
    // 直前のテストが残した再利用検知ログと区別するため、ここで一度消す
    await prisma.auditLog.deleteMany({ where: { userId, action: 'TOKEN_REUSE_DETECTED' } })
    const session = await login()
    const other = await login() // 別端末のセッション

    const rotated = await refresh(session.refreshToken)
    expect(rotated.status).toBe(200)

    // 猶予時間内の再提示: 401 にはなるが、他のトークンは失効させない
    expect((await refresh(session.refreshToken)).status).toBe(401)
    expect((await refresh(other.refreshToken)).status).toBe(200)

    const audit = await prisma.auditLog.count({
      where: { userId, action: 'TOKEN_REUSE_DETECTED' },
    })
    expect(audit).toBe(0)
  })

  it('期限切れトークンは日次バッチの一括削除で消える', async () => {
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.refreshToken.create({
      data: {
        tokenHash: `${PREFIX}-expired-hash`,
        userId,
        tenantId: TENANT,
        expiresAt: new Date(Date.now() - 60_000),
      },
    })

    const { purgeExpiredRefreshTokensService } = await import('../services/authService.js')
    const { deleted } = await purgeExpiredRefreshTokensService()

    expect(deleted).toBeGreaterThanOrEqual(1)
    expect(
      await prisma.refreshToken.count({ where: { tokenHash: `${PREFIX}-expired-hash` } })
    ).toBe(0)
  })
})
