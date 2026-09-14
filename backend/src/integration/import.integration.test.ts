import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

// 予約明細CSV取込 API の統合テスト（#6 / #18）。
// 無人運用で端末から定期送信される経路なので、認可・テナント境界・冪等性を固定する。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス itest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

// api.integration.test.ts が 'itest' を使っているため、別のプレフィクスにする
// （同じプレフィクスだと片方の cleanup がもう片方のフィクスチャを消してしまう）
const PREFIX = 'imptest'
const TENANT_A = `${PREFIX}-tenant-a`
const TENANT_B = `${PREFIX}-tenant-b`
const HOTEL_A = `${PREFIX}-hotel-a`
const HOTEL_B = `${PREFIX}-hotel-b`
const ROOM_TYPE_CODE = 'STD_SINGLE'
const PASSWORD = 'Test1234'

const EMAILS = {
  operator: `${PREFIX}-operator@example.com`,
  manager: `${PREFIX}-manager@example.com`,
  otherTenantManager: `${PREFIX}-manager-b@example.com`,
}

const MAPPING = {
  checkInDate: 'チェックイン',
  nights: '泊数',
  rooms: '室数',
  guests: '人数',
  revenue: '合計金額',
  revenueScope: 'per-stay' as const,
  bookedAt: '予約受付日',
  cancelledAt: '取消日',
  status: 'ステータス',
  cancelStatusValues: ['取消'],
  channel: '販売先',
  channelAliases: { じゃらんnet: 'じゃらん' },
  roomTypeCode: '室タイプコード',
}

// TL-リンカーンの出力を模したCSV（Shift_JIS・CRLF・引用符付きの金額）
const CSV_ROWS = [
  '予約番号,販売先,チェックイン,泊数,室数,人数,合計金額,予約受付日,取消日,ステータス,室タイプコード',
  `R001,じゃらんnet,2026/09/10,2,1,2,"30,000",2026/09/01,,確定,${ROOM_TYPE_CODE}`,
  `R002,楽天トラベル,2026/09/10,1,2,4,"26,000",2026/09/05,,確定,${ROOM_TYPE_CODE}`,
  `R003,楽天トラベル,2026/09/11,1,1,1,"12,000",2026/09/06,2026/09/08,取消,${ROOM_TYPE_CODE}`,
]
const csvBuffer = Buffer.from(`${CSV_ROWS.join('\r\n')}\r\n`, 'utf8')

describeIntegration('予約明細CSV取込 API（#6 / #18）', () => {
  let app: Express
  let prisma: PrismaClient
  const tokens: Record<string, string> = {}

  async function login(email: string) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD })
    expect(res.status, `${email} のログインに失敗: ${JSON.stringify(res.body)}`).toBe(200)
    return res.body.data.tokens.accessToken as string
  }

  function postCsv(token: string, query: string, body: Buffer = csvBuffer) {
    return request(app)
      .post(`/api/v1/import/reservations?${query}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/csv')
      .send(body)
  }

  async function cleanup() {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: PREFIX } },
      select: { id: true },
    })
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ tenantId: { in: [TENANT_A, TENANT_B] } }, { userId: { in: users.map((u) => u.id) } }],
      },
    })
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } })
  }

  beforeAll(async () => {
    const appModule = await import('../app.js')
    app = appModule.app as unknown as Express
    prisma = new PrismaClient()

    await cleanup()

    const password = await bcrypt.hash(PASSWORD, 10)
    for (const [tenantId, hotelId, suffix] of [
      [TENANT_A, HOTEL_A, 'A'],
      [TENANT_B, HOTEL_B, 'B'],
    ] as const) {
      await prisma.tenant.create({
        data: { id: tenantId, code: tenantId, name: `取込テストテナント${suffix}` },
      })
      await prisma.hotel.create({
        data: { id: hotelId, tenantId, name: `取込テストホテル${suffix}`, totalRooms: 100 },
      })
      await prisma.roomType.create({
        data: {
          tenantId,
          hotelId,
          name: 'スタンダードシングル',
          code: ROOM_TYPE_CODE,
          capacity: 1,
          count: 50,
        },
      })
    }

    await prisma.user.createMany({
      data: [
        {
          email: EMAILS.operator,
          password,
          name: '取込テストオペレーター',
          role: 'OPERATOR',
          tenantId: TENANT_A,
          hotelId: HOTEL_A,
        },
        {
          email: EMAILS.manager,
          password,
          name: '取込テストマネージャー',
          role: 'MANAGER',
          tenantId: TENANT_A,
          hotelId: HOTEL_A,
        },
        {
          email: EMAILS.otherTenantManager,
          password,
          name: '別テナントマネージャー',
          role: 'MANAGER',
          tenantId: TENANT_B,
          hotelId: HOTEL_B,
        },
      ],
    })

    tokens.operator = await login(EMAILS.operator)
    tokens.manager = await login(EMAILS.manager)
    tokens.otherTenantManager = await login(EMAILS.otherTenantManager)

    // 列マッピングは UTF-8 のCSVで検証する（Shift_JIS の復号は lib/csv.test.ts で固定）
    const saved = await request(app)
      .put('/api/v1/import/mapping')
      .set('Authorization', `Bearer ${tokens.manager}`)
      .send({ hotelId: HOTEL_A, source: 'tl-lincoln', encoding: 'utf8', delimiter: ',', mapping: MAPPING })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('認証なしでは取込できない', async () => {
    const res = await request(app)
      .post(`/api/v1/import/reservations?hotelId=${HOTEL_A}`)
      .set('Content-Type', 'text/csv')
      .send(csvBuffer)
    expect(res.status).toBe(401)
  })

  it('OPERATOR は取込できない（実績の書き込みは MANAGER 以上）', async () => {
    const res = await postCsv(tokens.operator, `hotelId=${HOTEL_A}`)
    expect(res.status).toBe(403)
  })

  it('他テナントのホテルには取込できない（#62）', async () => {
    const res = await postCsv(tokens.otherTenantManager, `hotelId=${HOTEL_A}`)
    expect(res.status).toBe(403)

    const runs = await prisma.importRun.count({ where: { hotelId: HOTEL_A, tenantId: TENANT_B } })
    expect(runs).toBe(0)
  })

  it('列マッピングが無い取得元は 404（端末の設定ミスを取り違えない）', async () => {
    const res = await postCsv(tokens.manager, `hotelId=${HOTEL_A}&source=nehops`)
    expect(res.status).toBe(404)
  })

  it('CSV以外の Content-Type は 400', async () => {
    const res = await request(app)
      .post(`/api/v1/import/reservations?hotelId=${HOTEL_A}`)
      .set('Authorization', `Bearer ${tokens.manager}`)
      .send({ csv: 'これはCSVではない' })
    expect(res.status).toBe(400)
  })

  it('dry-run は集計だけ返し、実績を書き込まない', async () => {
    const res = await postCsv(tokens.manager, `hotelId=${HOTEL_A}&asOf=2026-09-14&dryRun=true`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.data.dryRun).toBe(true)
    expect(res.body.data.summary.written).toBe(false)
    expect(res.body.data.summary.dailyRows).toBe(2)

    const written = await prisma.dailyData.count({ where: { hotelId: HOTEL_A } })
    expect(written).toBe(0)

    // dry-run も履歴には残る（何を試したか追えるようにする）
    const run = await prisma.importRun.findFirst({
      where: { hotelId: HOTEL_A, dryRun: true },
      orderBy: { startedAt: 'desc' },
    })
    expect(run?.status).toBe('success')
  })

  it('取込するとキャンセルを除いた実績・チャネル別・カーブが作られる', async () => {
    const res = await postCsv(
      tokens.manager,
      `hotelId=${HOTEL_A}&asOf=2026-09-14&fileName=tl_export.csv`
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.data.summary.written).toBe(true)
    expect(res.body.data.cancelledRows).toBe(1)

    // 9/10: R001 1室（30,000の半分=15,000）+ R002 2室 26,000
    const first = await prisma.dailyData.findFirst({
      where: { hotelId: HOTEL_A, date: new Date('2026-09-10T00:00:00.000Z') },
    })
    expect(first?.soldRooms).toBe(3)
    expect(first?.totalRevenue).toBe(41000)

    // 9/11: R001 の2泊目のみ（R003 はキャンセル）
    const second = await prisma.dailyData.findFirst({
      where: { hotelId: HOTEL_A, date: new Date('2026-09-11T00:00:00.000Z') },
    })
    expect(second?.soldRooms).toBe(1)

    // 販売先の別名が変換されている
    const channels = await prisma.otaChannelData.findMany({
      where: { hotelId: HOTEL_A },
      select: { channel: true },
      distinct: ['channel'],
      orderBy: { channel: 'asc' },
    })
    expect(channels.map((c) => c.channel)).toEqual(['じゃらん', '楽天トラベル'])

    // 予約受付日からブッキングカーブが復元されている
    const curve = await prisma.bookingCurveData.findMany({
      where: { hotelId: HOTEL_A, stayDate: new Date('2026-09-10T00:00:00.000Z') },
      orderBy: { daysBefore: 'desc' },
    })
    expect(curve.length).toBeGreaterThan(0)
    expect(curve.at(-1)?.roomsBooked).toBe(3)

    // 取込結果が履歴に記録されている
    const run = await prisma.importRun.findFirst({
      where: { hotelId: HOTEL_A, dryRun: false },
      orderBy: { startedAt: 'desc' },
    })
    expect(run).toMatchObject({ status: 'success', fileName: 'tl_export.csv', rowCount: 3 })
  })

  it('同じCSVを再送しても実績は増えず、重複として報告される（冪等）', async () => {
    const before = await prisma.dailyData.count({ where: { hotelId: HOTEL_A } })
    const res = await postCsv(tokens.manager, `hotelId=${HOTEL_A}&asOf=2026-09-14`)

    expect(res.status).toBe(200)
    expect(res.body.data.duplicateOfRunId).not.toBeNull()
    expect(await prisma.dailyData.count({ where: { hotelId: HOTEL_A } })).toBe(before)
  })

  it('壊れたCSVは 400 で、失敗が履歴に残る（無人運用では失敗の記録が重要）', async () => {
    const res = await postCsv(tokens.manager, `hotelId=${HOTEL_A}`, Buffer.from('列が1つだけ\n値\n', 'utf8'))
    expect(res.status).toBe(400)

    const run = await prisma.importRun.findFirst({
      where: { hotelId: HOTEL_A, status: 'failed' },
      orderBy: { startedAt: 'desc' },
    })
    expect(run?.errorMessage).toContain('列を1つしか認識できませんでした')
  })

  it('取込履歴は自テナントのホテルしか読めない', async () => {
    const own = await request(app)
      .get(`/api/v1/import/runs?hotelId=${HOTEL_A}&limit=5`)
      .set('Authorization', `Bearer ${tokens.manager}`)
    expect(own.status).toBe(200)
    expect(own.body.data.length).toBeGreaterThan(0)

    const other = await request(app)
      .get(`/api/v1/import/runs?hotelId=${HOTEL_A}`)
      .set('Authorization', `Bearer ${tokens.otherTenantManager}`)
    expect(other.status).toBe(403)
  })
})
