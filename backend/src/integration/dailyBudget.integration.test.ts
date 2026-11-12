import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { addUtcDays, todayJst } from '../lib/date.js'

// 日別の予算（D-13）の統合テスト。登録・解除の権限と監査ログ、料金カレンダーで登録した日が優先されること。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス dbtest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'dbtest'
const TENANT = `${PREFIX}-tenant`
const OTHER_TENANT = `${PREFIX}-tenant-b`
const HOTEL = `${PREFIX}-hotel`
const PASSWORD = 'Test1234'

describeIntegration('日別の予算（D-13）', () => {
  let app: Express
  let prisma: PrismaClient
  const tokens: Record<string, string> = {}
  // 来月（3か月以内なので、登録の無い日は AI の予測か前年同曜日で配られる）
  const today = todayJst()
  const next = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1))
  const year = next.getUTCFullYear()
  const month = next.getUTCMonth() + 1
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const day1 = iso(next)
  const day2 = iso(addUtcDays(next, 1))

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } })
    await prisma.auditLog.deleteMany({
      where: { OR: [{ tenantId: { in: [TENANT, OTHER_TENANT] } }, { userId: { in: users.map((u) => u.id) } }] },
    })
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER_TENANT] } } })
  }

  beforeAll(async () => {
    app = (await import('../app.js')).app as unknown as Express
    prisma = new PrismaClient()
    await cleanup()
    const password = await bcrypt.hash(PASSWORD, 10)
    await prisma.tenant.create({ data: { id: TENANT, code: TENANT, name: TENANT } })
    await prisma.tenant.create({ data: { id: OTHER_TENANT, code: OTHER_TENANT, name: OTHER_TENANT } })
    await prisma.hotel.create({ data: { id: HOTEL, tenantId: TENANT, name: HOTEL, totalRooms: 100 } })
    await prisma.monthlyBudget.create({
      data: { tenantId: TENANT, hotelId: HOTEL, year, month, budgetRooms: 1500, budgetRevenue: 22_500_000 },
    })
    await prisma.user.createMany({
      data: [
        { email: `${PREFIX}-manager@example.com`, password, name: 'm', role: 'MANAGER', tenantId: TENANT, hotelId: HOTEL },
        { email: `${PREFIX}-operator@example.com`, password, name: 'o', role: 'OPERATOR', tenantId: TENANT, hotelId: HOTEL },
        { email: `${PREFIX}-other@example.com`, password, name: 'x', role: 'ADMIN', tenantId: OTHER_TENANT },
      ],
    })
    for (const key of ['manager', 'operator', 'other']) {
      const res = await request(app).post('/api/v1/auth/login').send({ email: `${PREFIX}-${key}@example.com`, password: PASSWORD })
      tokens[key] = res.body.data.tokens.accessToken
    }
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  const put = (key: string, body: object) =>
    request(app).put('/api/v1/settings/daily-budgets').set('Authorization', `Bearer ${tokens[key]}`).send(body)

  it('MANAGER 以上だけが登録でき、他テナントは 403。同じ日の重複は 400', async () => {
    const body = { hotelId: HOTEL, days: [{ date: day1, budgetRooms: 90, budgetRevenue: 1_800_000 }] }
    expect((await put('operator', body)).status).toBe(403)
    expect((await put('other', body)).status).toBe(403)
    const dup = await put('manager', { hotelId: HOTEL, days: [body.days[0], body.days[0]] })
    expect(dup.status).toBe(400)
    const ok = await put('manager', { ...body, days: [...body.days, { date: day2, budgetRooms: 40, budgetRevenue: null }] })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.data).toEqual({ saved: 2, cleared: 0 })
    expect(await prisma.auditLog.count({ where: { tenantId: TENANT, entity: 'DailyBudget' } })).toBe(1)
  })

  it('料金カレンダーでは登録した日の値を使い、残りの日に月の予算の残りを配る', async () => {
    const res = await request(app)
      .get(`/api/v1/pricing/calendar?hotelId=${HOTEL}&year=${year}&month=${month}`)
      .set('Authorization', `Bearer ${tokens.operator}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const days = res.body.data.calendar
    const first = days.find((d: { date: string }) => d.date === day1)
    expect(first).toMatchObject({ budgetRooms: 90, budgetRevenue: 1_800_000, budgetSource: 'imported' })
    const others = days.filter((d: { date: string }) => d.date !== day1 && d.date !== day2)
    expect(others.every((d: { budgetSource: string }) => d.budgetSource === 'lastYear' || d.budgetSource === 'ai')).toBe(true)
    // 月の予算 1,500室 − 登録 130室 を残りの日に配る
    const total = days.reduce((a: number, d: { budgetRooms: number | null }) => a + (d.budgetRooms ?? 0), 0)
    expect(total).toBe(1500)
  })

  it('室数・売上の両方を null にすると登録を消す', async () => {
    const res = await put('manager', { hotelId: HOTEL, days: [{ date: day2, budgetRooms: null, budgetRevenue: null }] })
    expect(res.body.data).toEqual({ saved: 0, cleared: 1 })
    const list = await request(app)
      .get(`/api/v1/settings/daily-budgets?hotelId=${HOTEL}&year=${year}&month=${month}`)
      .set('Authorization', `Bearer ${tokens.operator}`)
    expect(list.body.data.map((d: { date: string }) => d.date)).toEqual([day1])
  })
})
