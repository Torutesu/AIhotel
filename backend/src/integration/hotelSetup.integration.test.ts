import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import ExcelJS from 'exceljs'
import { addUtcDays, todayJst } from '../lib/date.js'

// 初期設定（#13）の統合テスト: ホテルタイプ・マーケットの保存と、初期設定の進み具合。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス sutest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'sutest'
const TENANT = `${PREFIX}-tenant`
const OTHER_TENANT = `${PREFIX}-tenant-b`
const HOTEL = `${PREFIX}-hotel`
const NEW_HOTEL = `${PREFIX}-hotel-new`
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
    await prisma.hotel.create({ data: { id: NEW_HOTEL, tenantId: TENANT, name: '系列の新ホテル', totalRooms: 10 } })
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

  describe('連携先の記録（#13）', () => {
    it('種別ごとに1件で、保存し直すと更新になる。削除できる。他テナントは 403', async () => {
      const put = (body: object, key = 'admin') =>
        request(app).put('/api/v1/settings/integrations').set(auth(key)).send({ hotelId: HOTEL, ...body })
      expect((await put({ kind: 'PMS', product: 'NEHOPS', status: 'PLANNED' })).status).toBe(200)
      const updated = await put({ kind: 'PMS', product: 'NEHOPS', connectionMethod: 'Windows端末からCSV', status: 'TESTING' })
      expect(updated.body.data).toMatchObject({ status: 'TESTING', connectionMethod: 'Windows端末からCSV' })
      await put({ kind: 'SITE_CONTROLLER', product: 'TLリンカーン', status: 'PLANNED' })

      const list = await request(app).get('/api/v1/settings/integrations').query({ hotelId: HOTEL }).set(auth('admin'))
      expect(list.body.data.map((i: { kind: string }) => i.kind)).toEqual(['PMS', 'SITE_CONTROLLER'])

      expect((await put({ kind: 'PMS', product: 'x', status: 'PLANNED' }, 'other')).status).toBe(403)
      const del = await request(app).delete('/api/v1/settings/integrations/SITE_CONTROLLER').query({ hotelId: HOTEL }).set(auth('admin'))
      expect(del.status).toBe(200)
    })
  })

  describe('設定の複製（#13）', () => {
    it('既存ホテルから部屋タイプ・料金ランク・価格戦略を複製でき、2回目は既にあるので 400', async () => {
      await prisma.pricingStrategyConfig.create({
        data: { tenantId: TENANT, hotelId: HOTEL, weightOccupancy: 50, weightAdr: 50, weightCompetitor: 0, minRank: 2 },
      })
      const body = { hotelId: NEW_HOTEL, sourceHotelId: HOTEL, items: ['roomTypes', 'priceRanks', 'strategy'] }
      const res = await request(app).post('/api/v1/settings/copy-from').set(auth('admin')).send(body)
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.data.copied).toEqual({ roomTypes: 2, priceRanks: 5, strategy: 1 })
      expect(await prisma.pricingStrategyConfig.findUnique({ where: { hotelId: NEW_HOTEL } })).toMatchObject({ weightAdr: 50, minRank: 2 })

      const again = await request(app).post('/api/v1/settings/copy-from').set(auth('admin')).send(body)
      expect(again.status).toBe(400)
      expect(again.body.error).toContain('部屋タイプ・料金ランク・価格戦略')
    })

    it('他テナントのホテルからは複製できない', async () => {
      const res = await request(app)
        .post('/api/v1/settings/copy-from')
        .set(auth('other'))
        .send({ hotelId: NEW_HOTEL, sourceHotelId: HOTEL, items: ['roomTypes'] })
      expect(res.status).toBe(403)
    })
  })

  describe('初期設定シート（Excel — #13）', () => {
    async function download(hotelId: string) {
      const res = await request(app)
        .get(`/api/v1/hotels/${hotelId}/setup-workbook`)
        .set(auth('admin'))
        .buffer(true)
        .parse((r, done) => {
          const chunks: Buffer[] = []
          r.on('data', (c: Buffer) => chunks.push(c))
          r.on('end', () => done(null, Buffer.concat(chunks)))
        })
      expect(res.status).toBe(200)
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(res.body as unknown as ArrayBuffer)
      return wb
    }
    const upload = async (hotelId: string, wb: ExcelJS.Workbook, dryRun = false) =>
      request(app)
        .post(`/api/v1/hotels/${hotelId}/setup-workbook`)
        .set(auth('admin'))
        .send({ dryRun, fileBase64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64') })

    it('現在の設定が埋まったシートを出力し、書き換えて取り込むと差分が反映される', async () => {
      const wb = await download(HOTEL)
      expect(wb.getWorksheet('部屋タイプ')!.rowCount).toBe(3) // 見出し + 2件
      expect(wb.getWorksheet('基本情報')!.getRow(4).getCell(2).value).toBe('旅館')

      wb.getWorksheet('基本情報')!.getRow(4).getCell(2).value = 'リゾートホテル'
      wb.getWorksheet('料金ランク')!.addRow([6, 'R6', 30000, 54000])
      wb.getWorksheet('予算')!.addRow([2030, 1, 1_000_000, 300, 20000, 85.5])

      const dry = await upload(HOTEL, wb, true)
      expect(dry.status, JSON.stringify(dry.body)).toBe(200)
      expect(dry.body.data).toMatchObject({ dryRun: true, priceRanks: { created: 1, updated: 5 }, budgets: { created: 1, updated: 0 } })
      expect((await prisma.hotel.findUniqueOrThrow({ where: { id: HOTEL } })).hotelType).toBe('RYOKAN')

      const res = await upload(HOTEL, wb)
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect((await prisma.hotel.findUniqueOrThrow({ where: { id: HOTEL } })).hotelType).toBe('RESORT')
      expect(await prisma.priceRank.count({ where: { hotelId: HOTEL, isActive: true } })).toBe(6)
      const budget = await prisma.monthlyBudget.findFirstOrThrow({ where: { hotelId: HOTEL, year: 2030, month: 1 } })
      expect(budget.budgetOccupancy).toBeCloseTo(0.855)
    })

    it('不正な行があればシート名と行番号つきで 400 になり、何も書き込まない', async () => {
      const wb = await download(NEW_HOTEL)
      wb.getWorksheet('部屋タイプ')!.addRow(['BAD CODE', '', 0, 1])
      wb.getWorksheet('競合')!.addRow(['競合X', '', '', 'not-a-url'])
      const before = await prisma.competitor.count({ where: { hotelId: NEW_HOTEL } })
      const res = await upload(NEW_HOTEL, wb)
      expect(res.status).toBe(400)
      const fields = res.body.errors.map((e: { field: string }) => e.field)
      expect(fields).toContain('部屋タイプ!4')
      expect(fields).toContain('競合!2')
      expect(await prisma.competitor.count({ where: { hotelId: NEW_HOTEL } })).toBe(before)
    })

    it('Excel でないファイルは 400', async () => {
      const res = await request(app)
        .post(`/api/v1/hotels/${HOTEL}/setup-workbook`)
        .set(auth('admin'))
        .send({ fileBase64: Buffer.from('hello').toString('base64') })
      expect(res.status).toBe(400)
    })
  })
})
