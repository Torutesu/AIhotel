import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'

// 最初の運営アカウント作成（docs/deploy-runbook.md §3-4）の統合テスト。
// 他の統合テストと同じく DATABASE_URL が無ければスキップする。
const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const EMAIL = 'itest-bootstrap-admin@example.com'
const PASSWORD = 'Bootstrap1234'

describeIntegration('bootstrapPlatformAdminService', () => {
  const prisma = new PrismaClient()
  let service: typeof import('../services/usersService.js')
  let existingBefore = 0

  beforeAll(async () => {
    service = await import('../services/usersService.js')
    await prisma.user.deleteMany({ where: { email: EMAIL } })
    existingBefore = await prisma.user.count({ where: { role: 'PLATFORM_ADMIN' } })
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } })
    await prisma.$disconnect()
  })

  it('creates the first platform admin only when none exists, and never twice', async () => {
    const first = await service.bootstrapPlatformAdminService({
      email: EMAIL.toUpperCase(),
      password: PASSWORD,
      name: '運営',
    })
    if (existingBefore > 0) {
      // seed 済みの DB（CI の database ジョブ）: 既に運営がいるので何も作らない
      expect(first).toEqual({ created: false, existingPlatformAdmins: existingBefore })
      expect(await prisma.user.findUnique({ where: { email: EMAIL } })).toBeNull()
      return
    }
    expect(first.created).toBe(true)
    if (!first.created) return
    expect(first.user.role).toBe('PLATFORM_ADMIN')
    expect(first.user.tenantId).toBeNull()
    expect(first.user.email).toBe(EMAIL)
    expect('password' in first.user).toBe(false)

    const second = await service.bootstrapPlatformAdminService({
      email: 'another-' + EMAIL,
      password: PASSWORD,
      name: '運営',
    })
    expect(second).toEqual({ created: false, existingPlatformAdmins: 1 })
  })

  it('rejects a password that the register API would reject', async () => {
    await expect(
      service.bootstrapPlatformAdminService({ email: EMAIL, password: 'short', name: '運営' })
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})
