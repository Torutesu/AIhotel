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
  // 同じテナントの全ホテルに触れるアカウント。取込には使えないことを確かめる
  tenantWideManager: `${PREFIX}-tenant-manager@example.com`,
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
        {
          email: EMAILS.tenantWideManager,
          password,
          name: 'テナント統括マネージャー',
          role: 'MANAGER',
          tenantId: TENANT_A,
          hotelId: null,
        },
      ],
    })

    tokens.operator = await login(EMAILS.operator)
    tokens.manager = await login(EMAILS.manager)
    tokens.otherTenantManager = await login(EMAILS.otherTenantManager)
    tokens.tenantWideManager = await login(EMAILS.tenantWideManager)

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

  // ======================================
  // 施設・取得元の分離（他の施設の実績と混ざらないこと）
  // ======================================

  it('テナント全体を扱うアカウントでは投入できない（端末の設定ミスで別施設に書き込ませない）', async () => {
    const res = await postCsv(tokens.tenantWideManager, `hotelId=${HOTEL_A}`)
    expect(res.status).toBe(403)
    expect(res.body.error).toContain('ホテルに固定された取込用アカウント')
  })

  it('2つ目の取得元は、既存の取得元と書き込み先が重なると保存できない', async () => {
    // tl-lincoln が全書き込み先を担当している状態で nehops を足そうとする
    const res = await request(app)
      .put('/api/v1/import/mapping')
      .set('Authorization', `Bearer ${tokens.manager}`)
      .send({ hotelId: HOTEL_A, source: 'nehops', encoding: 'utf8', mapping: MAPPING })
    expect(res.status).toBe(409)
  })

  it('書き込み先を分ければ両方の取得元を繋げられ、互いの実績を上書きしない', async () => {
    // TL は チャネル別・カーブ だけを担当する
    const tl = await request(app)
      .put('/api/v1/import/mapping')
      .set('Authorization', `Bearer ${tokens.manager}`)
      .send({
        hotelId: HOTEL_A,
        source: 'tl-lincoln',
        encoding: 'utf8',
        mapping: MAPPING,
        targets: ['channel', 'curve'],
      })
    expect(tl.status, JSON.stringify(tl.body)).toBe(200)
    expect(tl.body.data.targets).toEqual(['channel', 'curve'])

    // NEHOPS は 日別・客室タイプ別 を担当し、施設コードで照合する
    const nehops = await request(app)
      .put('/api/v1/import/mapping')
      .set('Authorization', `Bearer ${tokens.manager}`)
      .send({
        hotelId: HOTEL_A,
        source: 'nehops',
        encoding: 'utf8',
        mapping: MAPPING,
        facilityColumn: '施設コード',
        facilityValues: ['H-A'],
      })
    expect(nehops.status, JSON.stringify(nehops.body)).toBe(200)
    expect(nehops.body.data.targets).toEqual(['daily', 'roomType'])

    // TLが既に書いた 9/10 の実績（3室）を、NEHOPS の値（5室）で上書きする
    const nehopsCsv = Buffer.from(
      [
        `施設コード,${CSV_ROWS[0]}`,
        `H-A,N001,直販,2026/09/10,1,5,8,"75,000",2026/08/30,,確定,${ROOM_TYPE_CODE}`,
      ].join('\r\n') + '\r\n',
      'utf8'
    )
    const byNehops = await postCsv(tokens.manager, `hotelId=${HOTEL_A}&source=nehops&asOf=2026-09-14`, nehopsCsv)
    expect(byNehops.status, JSON.stringify(byNehops.body)).toBe(200)
    expect(byNehops.body.data.summary.targets).toEqual(['daily', 'roomType'])

    const dailyAfterNehops = await prisma.dailyData.findFirst({
      where: { hotelId: HOTEL_A, date: new Date('2026-09-10T00:00:00.000Z') },
    })
    expect(dailyAfterNehops?.soldRooms).toBe(5)

    // その後 TL を取り込み直しても、担当外の日別実績は書き換わらない
    const byTl = await postCsv(tokens.manager, `hotelId=${HOTEL_A}&source=tl-lincoln&asOf=2026-09-14`)
    expect(byTl.status, JSON.stringify(byTl.body)).toBe(200)
    expect(byTl.body.data.summary.targets).toEqual(['channel', 'curve'])

    const dailyAfterTl = await prisma.dailyData.findFirst({
      where: { hotelId: HOTEL_A, date: new Date('2026-09-10T00:00:00.000Z') },
    })
    expect(dailyAfterTl?.soldRooms).toBe(5)

    // 担当を取り合う指定は拒否される
    const steal = await request(app)
      .put('/api/v1/import/mapping')
      .set('Authorization', `Bearer ${tokens.manager}`)
      .send({ hotelId: HOTEL_A, source: 'nehops', encoding: 'utf8', mapping: MAPPING, targets: ['channel'] })
    expect(steal.status).toBe(409)
  })

  it('他施設の行が1行でも混ざったCSVはファイルごと取り込まず、失敗として記録する', async () => {
    const before = await prisma.dailyData.findFirst({
      where: { hotelId: HOTEL_A, date: new Date('2026-09-11T00:00:00.000Z') },
      select: { soldRooms: true },
    })

    const mixed = Buffer.from(
      [
        `施設コード,${CSV_ROWS[0]}`,
        `H-A,N101,直販,2026/09/11,1,1,1,"10,000",2026/09/01,,確定,${ROOM_TYPE_CODE}`,
        `H-B,N102,直販,2026/09/11,1,9,9,"90,000",2026/09/01,,確定,${ROOM_TYPE_CODE}`,
      ].join('\r\n') + '\r\n',
      'utf8'
    )
    const res = await postCsv(tokens.manager, `hotelId=${HOTEL_A}&source=nehops&fileName=mixed.csv`, mixed)
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('このホテル以外の施設のデータが含まれている')
    expect(res.body.error).toContain('H-B（1行）')

    // H-A の行も含めて何も書かれていない
    const after = await prisma.dailyData.findFirst({
      where: { hotelId: HOTEL_A, date: new Date('2026-09-11T00:00:00.000Z') },
      select: { soldRooms: true },
    })
    expect(after?.soldRooms).toBe(before?.soldRooms)

    const run = await prisma.importRun.findFirst({
      where: { hotelId: HOTEL_A, source: 'nehops', fileName: 'mixed.csv' },
    })
    expect(run?.status).toBe('failed')
  })

  it('施設照合の列が無いCSV（別の画面・別の出力）は取り込まない', async () => {
    const res = await postCsv(tokens.manager, `hotelId=${HOTEL_A}&source=nehops`)
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('施設照合の列「施設コード」がCSVにありません')
  })

  it('施設照合が未設定の取得元は、取り込めるが警告を返す', async () => {
    const res = await postCsv(tokens.manager, `hotelId=${HOTEL_A}&source=tl-lincoln&dryRun=true`)
    expect(res.status).toBe(200)
    expect(res.body.data.warnings.join('\n')).toContain('施設の照合が未設定です')
  })
})
