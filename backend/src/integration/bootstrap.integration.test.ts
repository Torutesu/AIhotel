import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

// 環境の立ち上げ用（job create-platform-admin / job seed-demo）の統合テスト。
// DATABASE_URL が無ければスキップし、専用のメールアドレス（プレフィクス bstest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const EMAIL = 'bstest-platform@example.com'
const TENANT_USER = 'bstest-admin@example.com'
const TENANT = 'bstest-tenant'

describeIntegration('環境の立ち上げ（運営アカウント・デモデータ）', () => {
  let prisma: PrismaClient
  let service: typeof import('../services/bootstrapService.js')

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { email: { startsWith: 'bstest' } }, select: { id: true } })
    await prisma.refreshToken.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } })
    await prisma.user.deleteMany({ where: { email: { startsWith: 'bstest' } } })
    await prisma.tenant.deleteMany({ where: { id: TENANT } })
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    service = await import('../services/bootstrapService.js')
    await cleanup()
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  it('運営アカウントを推測できないパスワードで作り、初回ログインで変更させる。再実行するとパスワードを発行し直す', async () => {
    const first = await service.createOrResetPlatformAdminService(` ${EMAIL.toUpperCase()} `)
    expect(first.created).toBe(true)
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })
    expect(user).toMatchObject({ role: 'PLATFORM_ADMIN', tenantId: null, mustChangePassword: true })
    expect(await bcrypt.compare(first.password, user.password)).toBe(true)
    expect(first.password).not.toBe('Admin1234')

    const second = await service.createOrResetPlatformAdminService(EMAIL)
    expect(second.created).toBe(false)
    const updated = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })
    expect(await bcrypt.compare(first.password, updated.password)).toBe(false)
    expect(await bcrypt.compare(second.password, updated.password)).toBe(true)
  })

  it('運営以外のアカウントには触れない', async () => {
    await prisma.tenant.create({ data: { id: TENANT, code: TENANT, name: TENANT } })
    await prisma.user.create({ data: { email: TENANT_USER, password: 'x', name: 'x', role: 'ADMIN', tenantId: TENANT } })
    await expect(service.createOrResetPlatformAdminService(TENANT_USER)).rejects.toThrow('運営以外')
    expect((await prisma.user.findUniqueOrThrow({ where: { email: TENANT_USER } })).role).toBe('ADMIN')
  })

  it('デモデータの投入は何度実行しても既存アカウントのパスワードを変えない', async () => {
    await service.seedDemoTenantService()
    const before = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@demo-hotel.example.com' } })
    const { createdUsers } = await service.seedDemoTenantService()
    expect(createdUsers).toEqual([])
    const after = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@demo-hotel.example.com' } })
    expect(after.password).toBe(before.password)
    expect(await prisma.dailyData.count({ where: { hotelId: service.DEMO_HOTEL_ID } })).toBeGreaterThan(80)
  })
})
