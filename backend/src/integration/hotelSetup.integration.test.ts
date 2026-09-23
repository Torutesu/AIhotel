import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { addUtcDays, todayJst } from '../lib/date.js'

// 初期設定（#13）の統合テスト: ホテルタイプ・マーケットの保存と、初期設定の進み具合。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス sutest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'sutest'
const TENANT = `${PREFIX}-tenant`
const OTHER_TENANT = `${PREFIX}-tenant-b`
const HOTEL = `${PREFIX}-hotel`
const PASSWORD = 'Test1234'

describeIntegration('初期設定（#13）', () => {
  let app: Express
  let prisma: PrismaClient
  const tokens: Record<string, string> = {}
  const today = todayJst()

  const auth = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` })
  const status = async (key = 'admin') => {
    const res = await request(app).get(`/api/v1/hotels/${HOTEL}/setup-status`).set(auth(key))
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body.data as { ready: boolean; items: Array<{ key: string; done: boolean; required: boolean; detail: string | null }> }
  }
  const item = (s: Awaited<ReturnType<typeof status>>, key: string) => s.items.find((i) => i.key === key)!

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } })
    await prisma.auditLog.deleteMany({
      where: { OR: [{ tenantId: { in: [TENANT, OTHER_TENANT] } }, { userId: { in: users.map((u) => u.id) } }] },
    })
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER_TENANT] } } })
  }

  beforeAll(async () => {
    const appModule = await import('../app.js')
    app = appModule.app as unknown as Express
    prisma = new PrismaClient()
    await cleanup()

    const password = await bcrypt.hash(PASSWORD, 10)
    await prisma.tenant.create({ data: { id: TENANT, code: TENANT, name: TENANT } })
    await prisma.tenant.create({ data: { id: OTHER_TENANT, code: OTHER_TENANT, name: OTHER_TENANT } })
    await prisma.hotel.create({ data: { id: HOTEL, tenantId: TENANT, name: '初期設定ホテル', totalRooms: 10 } })
    await prisma.user.createMany({
      data: [
        { email: `${PREFIX}-admin@example.com`, password, name: 'a', role: 'ADMIN', tenantId: TENANT },
        { email: `${PREFIX}-other@example.com`, password, name: 'b', role: 'ADMIN', tenantId: OTHER_TENANT },
      ],
    })
    for (const key of ['admin', 'other']) {
      const res = await request(app).post('/api/v1/auth/login').send({ email: `${PREFIX}-${key}@example.com`, password: PASSWORD })
      tokens[key] = res.body.data.tokens.accessToken
    }
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  it('作成直後は必須項目が未完了で ready=false。予算は任意項目', async () => {
    const s = await status()
    expect(s.ready).toBe(false)
    expect(item(s, 'basic')).toMatchObject({ done: false, detail: 'ホテルタイプ・都道府県が未設定です' })
    expect(item(s, 'roomTypes').detail).toBe('部屋タイプが登録されていません')
    expect(item(s, 'budget').required).toBe(false)
  })

  it('他テナントの管理者は 403', async () => {
    const res = await request(app).get(`/api/v1/hotels/${HOTEL}/setup-status`).set(auth('other'))
    expect(res.status).toBe(403)
  })

  it('ホテルタイプとマーケットを保存できる。市区町村コードが都道府県と食い違えば 400', async () => {
    const bad = await request(app)
      .put(`/api/v1/settings/hotel/${HOTEL}`)
      .set(auth('admin'))
      .send({ prefectureCode: '13', municipalityCode: '271004' })
    expect(bad.status).toBe(400)

    const res = await request(app)
      .put(`/api/v1/settings/hotel/${HOTEL}`)
      .set(auth('admin'))
      .send({ hotelType: 'RYOKAN', prefectureCode: '13', municipalityCode: '131016', marketArea: '丸の内' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.data).toMatchObject({ hotelType: 'RYOKAN', prefectureCode: '13', marketArea: '丸の内' })
    expect(item(await status(), 'basic').done).toBe(true)
  })

  it('必須項目を揃えると ready=true になる', async () => {
    // 部屋タイプ: 合計が総客室数と一致しないと未完了
    await prisma.roomType.create({ data: { tenantId: TENANT, hotelId: HOTEL, name: 'S', code: 'S', capacity: 1, count: 6 } })
    expect(item(await status(), 'roomTypes').detail).toContain('合計 6 が総客室数 10 と一致しません')
    await prisma.roomType.create({ data: { tenantId: TENANT, hotelId: HOTEL, name: 'T', code: 'T', capacity: 2, count: 4 } })

    await prisma.priceRank.createMany({
      data: [1, 2, 3, 4, 5].map((rank) => ({ tenantId: TENANT, hotelId: HOTEL, rank, label: `R${rank}`, price1P: rank * 5000, price2P: rank * 9000 })),
    })
    await prisma.competitor.createMany({
      data: [1, 2, 3].map((n) => ({ tenantId: TENANT, hotelId: HOTEL, name: `競合${n}` })),
    })
    await prisma.dailyData.createMany({
      data: Array.from({ length: 300 }, (_, i) => ({
        tenantId: TENANT,
        hotelId: HOTEL,
        date: addUtcDays(today, -(i + 1)),
        soldRooms: 5,
        totalRevenue: 50_000,
      })),
    })
    await prisma.user.create({
      data: { email: `${PREFIX}-op@example.com`, password: 'x', name: 'o', role: 'OPERATOR', tenantId: TENANT, hotelId: HOTEL },
    })

    const s = await status()
    expect(s.items.filter((i) => i.required && !i.done)).toEqual([])
    expect(s.ready).toBe(true)
    // 予算は任意なので、未登録でも ready に影響しない
    expect(item(s, 'budget').done).toBe(false)
  })
})
