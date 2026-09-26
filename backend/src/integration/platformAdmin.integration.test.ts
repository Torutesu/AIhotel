import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { PrismaClient } from '@prisma/client'

// 最初の運営（PLATFORM_ADMIN）を作るジョブの中身（R-2-5）の統合テスト。
// DATABASE_URL が無ければスキップする。メールアドレスのプレフィクス patest で作って消す。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'patest'
const EMAIL = `${PREFIX}-ops@example.com`

describeIntegration('最初の運営を作る（R-2-5）', () => {
  let app: Express
  let prisma: PrismaClient
  let createPlatformAdminService: typeof import('../services/authService.js').createPlatformAdminService

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } })
    const ids = users.map((u) => u.id)
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { entityId: { in: ids } }] } })
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
  }

  beforeAll(async () => {
    app = (await import('../app.js')).app as unknown as Express
    ;({ createPlatformAdminService } = await import('../services/authService.js'))
    prisma = new PrismaClient()
    await cleanup()
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  it('テナントに属さない運営を、一時パスワードと変更必須の状態で作る', async () => {
    const { user, temporaryPassword } = await createPlatformAdminService({ email: EMAIL, name: '運営テスト' })

    expect(user.role).toBe('PLATFORM_ADMIN')
    expect(user.tenantId).toBeNull()
    expect(user.hotelId).toBeNull()
    expect(user.mustChangePassword).toBe(true)
    expect(user).not.toHaveProperty('password')

    // 一時パスワードでログインでき、変更を求められる
    const login = await request(app).post('/api/v1/auth/login').send({ email: EMAIL, password: temporaryPassword })
    expect(login.status, JSON.stringify(login.body)).toBe(200)
    expect(login.body.data.user.role).toBe('PLATFORM_ADMIN')
    expect(login.body.data.user.mustChangePassword).toBe(true)

    // 作成は監査ログに残り、一時パスワードは残さない
    const log = await prisma.auditLog.findFirst({ where: { entity: 'User', entityId: user.id, action: 'CREATE' } })
    expect(log).not.toBeNull()
    expect(JSON.stringify(log?.newValue)).not.toContain(temporaryPassword)
  })

  it('同じメールアドレスではもう作れない（409）', async () => {
    await expect(createPlatformAdminService({ email: EMAIL, name: '二重作成' })).rejects.toMatchObject({
      statusCode: 409,
    })
  })
})
