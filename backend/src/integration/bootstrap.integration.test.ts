import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { addUtcDays, todayJst } from '../lib/date.js'

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

  it('デモのアラート・AI解説は当月だけでなく先々（翌月以降）も知らせる（2026-10-23 の画面修正 a01）', async () => {
    // デモデータは今日を基準に作る（他のテストも同じデモホテルを使うため、日付は固定しない）
    await service.seedDemoTenantService()
    const today = todayJst()
    const currentMonth = today.toISOString().slice(0, 7)

    const shown = await prisma.alert.findMany({ where: { hotelId: service.DEMO_HOTEL_ID, level: { gte: 4 } } })
    // 直近（1週間以内）の注意点と、翌月以降の注意点の両方がある
    expect(shown.some((a) => a.targetDate && a.targetDate >= today && a.targetDate < addUtcDays(today, 7))).toBe(true)
    const upcoming = shown.filter((a) => a.targetDate && a.targetDate.toISOString().slice(0, 7) > currentMonth)
    expect(upcoming.length).toBeGreaterThanOrEqual(2)
    // 月単位のアラートは ":yyyy-MM" の ruleKey で月を表し、日次バッチの自動判定の名前と重ならない
    const monthly = upcoming.find((a) => a.ruleKey)
    expect(monthly?.ruleKey).toBe(`DEMO_WEEKDAY_PACE:${monthly?.targetDate?.toISOString().slice(0, 7)}`)
    // 週末はホテルの設定で変わるため、曜日を決め打ちした「月〜木」は書かない
    expect(shown.every((a) => !a.message.includes('月〜木'))).toBe(true)

    const comment = await prisma.aiComment.findFirstOrThrow({ where: { hotelId: service.DEMO_HOTEL_ID, section: 'dashboard-summary' } })
    const lines = comment.content.split('\n')
    expect(lines.map((l) => l.slice(0, 4))).toEqual(['【当月】', '【先々】'])
  })
})
