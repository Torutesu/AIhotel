import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

// 統合テスト（N-8）。実DBに対して src/app.ts の Express アプリをそのまま叩く。
//
// DATABASE_URL が無い環境（型チェックと単体テストだけを回す CI ジョブ・手元）では
// describe.skip でまるごとスキップする。app.ts / prisma の import 自体が
// DB 接続を要求するため、静的 import ではなく beforeAll 内の動的 import にしている。
//
// テストデータは seed に依存せず専用のテナント2つ（itest-tenant-a / b）を作る。
// これによりデモデータを壊さず、テナント越えアクセスの検証もできる。

const DATABASE_URL = process.env.DATABASE_URL
const hasDatabase = Boolean(DATABASE_URL)

if (!hasDatabase) {
  console.info(
    '[integration] DATABASE_URL が未設定のため統合テストをスキップします。' +
      '実行する場合は DATABASE_URL を設定してください（例: postgresql://postgres:password@localhost:5432/hotel_revenue_dev?schema=public）'
  )
}

const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'itest'
const TENANT_A = `${PREFIX}-tenant-a`
const TENANT_B = `${PREFIX}-tenant-b`
const HOTEL_A = `${PREFIX}-hotel-a`
const HOTEL_B = `${PREFIX}-hotel-b`
const ALERT_ID = `${PREFIX}-alert-a`
/** テナントB側の料金ランク（テナントAのADMINが触れないことの検証用 — #62） */
const PRICE_RANK_B = `${PREFIX}-rank-b`
const PASSWORD = 'Test1234'

const EMAILS = {
  /**
   * テナントA のテナント管理者（#62 以降 ADMIN はテナント内最上位であり
   * テナント横断はできない）。hotelId は持たずテナントA の全ホテルを見る
   */
  admin: `${PREFIX}-admin@example.com`,
  /** 運営（PLATFORM_ADMIN）。tenantId / hotelId を持たない唯一のテナント横断ロール（#62） */
  platformAdmin: `${PREFIX}-platform-admin@example.com`,
  manager: `${PREFIX}-manager@example.com`,
  operator: `${PREFIX}-operator@example.com`,
  /** hotelId を持たないテナント統括マネージャー（N-6） */
  tenantManager: `${PREFIX}-tenant-manager@example.com`,
  /** 別テナントの MANAGER（テナント越えアクセスの検証用） */
  otherTenantManager: `${PREFIX}-manager-b@example.com`,
  /** MANAGER による登録テストで作られるユーザー */
  created: `${PREFIX}-created@example.com`,
}

describeIntegration('API 統合テスト', () => {
  let app: Express
  let prisma: PrismaClient
  const tokens: Record<string, string> = {}
  let refreshTokenOfManager = ''
  let managerUserId = ''
  let operatorUserId = ''
  let adminUserId = ''

  async function login(email: string) {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
    expect(res.status, `${email} のログインに失敗: ${JSON.stringify(res.body)}`).toBe(200)
    return res.body.data as {
      user: { id: string }
      tokens: { accessToken: string; refreshToken: string }
    }
  }

  async function cleanup() {
    // AuditLog.tenantId は onDelete 指定が無く（= Restrict）テナント削除を阻むため先に消す。
    // ADMIN のログイン監査は tenantId が null なので userId 側でも拾う
    const users = await prisma.user.findMany({
      where: { email: { startsWith: PREFIX } },
      select: { id: true },
    })
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { tenantId: { in: [TENANT_A, TENANT_B] } },
          { userId: { in: users.map((u) => u.id) } },
        ],
      },
    })
    // User→RefreshToken は Cascade なのでユーザー削除で一緒に消える
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
    // Hotel 以下（予算・競合・アラート等）は Tenant の onDelete: Cascade で消える
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
        data: { id: tenantId, code: tenantId, name: `統合テストテナント${suffix}` },
      })
      await prisma.hotel.create({
        data: { id: hotelId, tenantId, name: `統合テストホテル${suffix}`, totalRooms: 100 },
      })
    }

    await prisma.user.createMany({
      data: [
        // 運営（PLATFORM_ADMIN）だけがテナント横断のため tenantId / hotelId を持たない（#62）
        { email: EMAILS.platformAdmin, password, name: '統合テスト運営', role: 'PLATFORM_ADMIN' },
        // ADMIN はテナントA のテナント管理者。hotelId は持たずテナントA 内の全ホテルを見る
        {
          email: EMAILS.admin,
          password,
          name: '統合テストテナント管理者',
          role: 'ADMIN',
          tenantId: TENANT_A,
        },
        {
          email: EMAILS.manager,
          password,
          name: '統合テストマネージャー',
          role: 'MANAGER',
          tenantId: TENANT_A,
          hotelId: HOTEL_A,
        },
        {
          email: EMAILS.operator,
          password,
          name: '統合テストオペレーター',
          role: 'OPERATOR',
          tenantId: TENANT_A,
          hotelId: HOTEL_A,
        },
        {
          email: EMAILS.tenantManager,
          password,
          name: '統合テスト統括マネージャー',
          role: 'MANAGER',
          tenantId: TENANT_A,
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

    // テナントB 側の料金ランク（テナントA の ADMIN が更新・削除できないことの検証用 — #62）
    await prisma.priceRank.create({
      data: {
        id: PRICE_RANK_B,
        tenantId: TENANT_B,
        hotelId: HOTEL_B,
        rank: 1,
        label: 'B01',
        price1P: 10_000,
        price2P: 14_000,
      },
    })

    await prisma.alert.create({
      data: {
        id: ALERT_ID,
        tenantId: TENANT_A,
        hotelId: HOTEL_A,
        severity: 'YELLOW',
        level: 4,
        title: '統合テスト用アラート',
        message: '統合テスト用のメッセージ',
      },
    })

    // AI 予測を1件入れておく（着地シミュレーションが予測日を積み上げられるように）
    await prisma.aiPriceRecommendation.create({
      data: {
        tenantId: TENANT_A,
        hotelId: HOTEL_A,
        date: new Date(Date.UTC(2030, 0, 15)),
        predictedOccupancy: 0.8,
        predictedAdr: 15000,
        recommendedRank: 20,
        recommendedPrice: 15000,
        demandLevel: 'B',
        modelVersion: 'integration-test',
      },
    })

    // 口コミ評価点（N-7 と同じ形のデータ。seed の実行有無に依存しないよう自前で用意する）
    await prisma.reviewScore.createMany({
      data: [
        {
          tenantId: TENANT_A,
          hotelId: HOTEL_A,
          source: 'rakuten',
          score: 4.3,
          reviewCount: 100,
          capturedAt: new Date(Date.UTC(2030, 0, 1)),
        },
        {
          tenantId: TENANT_A,
          hotelId: HOTEL_A,
          source: 'jalan',
          score: 4.1,
          reviewCount: 80,
          capturedAt: new Date(Date.UTC(2030, 0, 1)),
        },
      ],
    })

    const admin = await login(EMAILS.admin)
    tokens.admin = admin.tokens.accessToken
    adminUserId = admin.user.id

    const platformAdmin = await login(EMAILS.platformAdmin)
    tokens.platformAdmin = platformAdmin.tokens.accessToken

    const manager = await login(EMAILS.manager)
    tokens.manager = manager.tokens.accessToken
    refreshTokenOfManager = manager.tokens.refreshToken
    managerUserId = manager.user.id

    const operator = await login(EMAILS.operator)
    tokens.operator = operator.tokens.accessToken
    operatorUserId = operator.user.id

    const tenantManager = await login(EMAILS.tenantManager)
    tokens.tenantManager = tenantManager.tokens.accessToken

    const otherManager = await login(EMAILS.otherTenantManager)
    tokens.otherManager = otherManager.tokens.accessToken
  }, 60_000)

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  // ======================================
  // 認証（S-1 / C-2）
  // ======================================

  describe('認証', () => {
    it('ログインしたトークンで /auth/me が自分の情報を返す', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.manager}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.email).toBe(EMAILS.manager)
      expect(res.body.data.password).toBeUndefined()
    })

    it('誤ったパスワードは 401 になり、理由を区別できるメッセージを返さない（S-8）', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: EMAILS.manager, password: 'WrongPass1234' })

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
      expect(res.body.error).toContain('メールアドレスまたはパスワード')
    })

    it('未認証のリクエストは 401', async () => {
      const res = await request(app).get(`/api/v1/dashboard/kpi?hotelId=${HOTEL_A}&year=2030&month=1`)

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
    })

    it('メールアドレスの大文字小文字を区別せずログインできる（#44）', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: EMAILS.manager.toUpperCase(), password: PASSWORD })

      expect(res.status, JSON.stringify(res.body)).toBe(200)
      // 保存されている（正規化済みの）メールアドレスが返る
      expect(res.body.data.user.email).toBe(EMAILS.manager)
    })

    it('大文字混じりで登録してもメールアドレスは小文字で保存される（#44）', async () => {
      const mixedCase = `${PREFIX}-MixedCase@Example.COM`
      const res = await request(app)
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({
          email: mixedCase,
          password: 'Created1234',
          name: '大文字混じり登録',
          role: 'OPERATOR',
          hotelId: HOTEL_A,
        })

      expect(res.status, JSON.stringify(res.body)).toBe(201)
      expect(res.body.data.email).toBe(mixedCase.toLowerCase())

      // 同じアドレスを別の大小文字で再登録しようとしても重複として弾かれる
      const duplicate = await request(app)
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({
          email: mixedCase.toLowerCase(),
          password: 'Created1234',
          name: '重複登録',
          role: 'OPERATOR',
          hotelId: HOTEL_A,
        })
      expect(duplicate.status).toBe(409)

      // 登録した大小文字のままでもログインできる
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: mixedCase, password: 'Created1234' })
      expect(login.status, JSON.stringify(login.body)).toBe(200)
    })

    it('リフレッシュトークンを Bearer に使うと 401（S-1）', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${refreshTokenOfManager}`)

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
    })
  })

  // ======================================
  // テナント分離・ロール（C-3 / N-6）
  // ======================================

  describe('テナント分離とロール', () => {
    it('他テナントのホテルへのアクセスは 403', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/kpi?hotelId=${HOTEL_B}&year=2030&month=1`)
        .set('Authorization', `Bearer ${tokens.manager}`)

      expect(res.status).toBe(403)
      expect(res.body.success).toBe(false)
    })

    it('hotelId が null の MANAGER は自テナントのホテルにアクセスできる（N-6）', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/kpi?hotelId=${HOTEL_A}&year=2030&month=1`)
        .set('Authorization', `Bearer ${tokens.tenantManager}`)

      expect(res.status).toBe(200)
      expect(res.body.data.hotelId).toBe(HOTEL_A)
    })

    it('hotelId が null の MANAGER でもテナント越えは 403（N-6）', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/kpi?hotelId=${HOTEL_B}&year=2030&month=1`)
        .set('Authorization', `Bearer ${tokens.tenantManager}`)

      expect(res.status).toBe(403)
    })

    it('GET /hotels は自テナントのホテルだけを返す', async () => {
      const res = await request(app)
        .get('/api/v1/hotels')
        .set('Authorization', `Bearer ${tokens.tenantManager}`)

      expect(res.status).toBe(200)
      const ids = (res.body.data as Array<{ id: string }>).map((h) => h.id)
      expect(ids).toContain(HOTEL_A)
      expect(ids).not.toContain(HOTEL_B)
    })

    it('OPERATOR は更新系（予算の一括更新）を実行できない', async () => {
      const res = await request(app)
        .put('/api/v1/settings/budgets')
        .set('Authorization', `Bearer ${tokens.operator}`)
        .send({ hotelId: HOTEL_A, year: 2030, months: [{ month: 1, budgetRevenue: 1 }] })

      expect(res.status).toBe(403)
      expect(res.body.success).toBe(false)
    })
  })

  // ======================================
  // #62 運営（PLATFORM_ADMIN）とテナント管理者（ADMIN）の境界
  //
  // ADMIN はテナント内最上位だが、テナント境界は MANAGER / OPERATOR と完全に同じ。
  // テナントを越えられるのは運営（PLATFORM_ADMIN）だけ。
  // ======================================

  describe('テナント境界: ADMIN と運営（#62）', () => {
    describe('テナントA の ADMIN は他テナントに一切アクセスできない', () => {
      it('GET /hotels/:id（他テナントのホテル）は 403', async () => {
        const res = await request(app)
          .get(`/api/v1/hotels/${HOTEL_B}`)
          .set('Authorization', `Bearer ${tokens.admin}`)

        expect(res.status).toBe(403)
        expect(res.body.success).toBe(false)
      })

      it('GET /dashboard/kpi（他テナントのホテル）は 403', async () => {
        const res = await request(app)
          .get(`/api/v1/dashboard/kpi?hotelId=${HOTEL_B}&year=2030&month=1`)
          .set('Authorization', `Bearer ${tokens.admin}`)

        expect(res.status).toBe(403)
      })

      it('POST /settings/price-ranks（他テナントのホテル）は 403', async () => {
        const res = await request(app)
          .post('/api/v1/settings/price-ranks')
          .set('Authorization', `Bearer ${tokens.admin}`)
          .send({ hotelId: HOTEL_B, rank: 30, label: 'X30', price1P: 1000, price2P: 2000 })

        expect(res.status).toBe(403)
        // 実際に書き込まれていないこと
        const leaked = await prisma.priceRank.findFirst({
          where: { hotelId: HOTEL_B, rank: 30 },
        })
        expect(leaked).toBeNull()
      })

      it('PUT /settings/price-ranks/:id（他テナントのホテル）は 403', async () => {
        const res = await request(app)
          .put(`/api/v1/settings/price-ranks/${PRICE_RANK_B}?hotelId=${HOTEL_B}`)
          .set('Authorization', `Bearer ${tokens.admin}`)
          .send({ label: '乗っ取り' })

        expect(res.status).toBe(403)
        const row = await prisma.priceRank.findUnique({ where: { id: PRICE_RANK_B } })
        expect(row?.label).toBe('B01')
      })

      it('DELETE /settings/price-ranks/:id（他テナントのホテル）は 403', async () => {
        const res = await request(app)
          .delete(`/api/v1/settings/price-ranks/${PRICE_RANK_B}?hotelId=${HOTEL_B}`)
          .set('Authorization', `Bearer ${tokens.admin}`)

        expect(res.status).toBe(403)
        const row = await prisma.priceRank.findUnique({ where: { id: PRICE_RANK_B } })
        expect(row).not.toBeNull()
      })

      it('PUT /settings/hotel/:id（他テナントのホテル）は 403', async () => {
        const res = await request(app)
          .put(`/api/v1/settings/hotel/${HOTEL_B}`)
          .set('Authorization', `Bearer ${tokens.admin}`)
          .send({ name: '乗っ取りホテル' })

        expect(res.status).toBe(403)
        const hotel = await prisma.hotel.findUnique({ where: { id: HOTEL_B } })
        expect(hotel?.name).toBe('統合テストホテルB')
      })

      it('PUT /hotels/:id（他テナントのホテル）は 403', async () => {
        const res = await request(app)
          .put(`/api/v1/hotels/${HOTEL_B}`)
          .set('Authorization', `Bearer ${tokens.admin}`)
          .send({ name: '乗っ取りホテル' })

        expect(res.status).toBe(403)
      })

      it('DELETE /hotels/:id（他テナントのホテル）は 403', async () => {
        const res = await request(app)
          .delete(`/api/v1/hotels/${HOTEL_B}`)
          .set('Authorization', `Bearer ${tokens.admin}`)

        expect(res.status).toBe(403)
        const hotel = await prisma.hotel.findUnique({ where: { id: HOTEL_B } })
        expect(hotel?.isActive).toBe(true)
      })

      // #52: 他テナントのホテルIDを送っても「見つからない」と同じ 400 にする
      it('POST /auth/register（他テナントのホテル）は 400 で、ユーザーは作られない', async () => {
        const email = `${PREFIX}-admin-cross@example.com`
        const res = await request(app)
          .post('/api/v1/auth/register')
          .set('Authorization', `Bearer ${tokens.admin}`)
          .send({
            email,
            password: 'Created1234',
            name: 'ADMINテナント越え',
            role: 'OPERATOR',
            hotelId: HOTEL_B,
          })

        expect(res.status).toBe(400)
        expect(res.body.error).toContain('指定されたホテルが見つかりません')
        expect(await prisma.user.findUnique({ where: { email } })).toBeNull()
      })

      it('PUT /users/:id（他テナントのユーザー）は 404（存在を漏らさない）', async () => {
        const other = await prisma.user.findUnique({
          where: { email: EMAILS.otherTenantManager },
        })
        const res = await request(app)
          .put(`/api/v1/users/${other!.id}`)
          .set('Authorization', `Bearer ${tokens.admin}`)
          .send({ name: '乗っ取り' })

        expect(res.status).toBe(404)
        const after = await prisma.user.findUnique({ where: { id: other!.id } })
        expect(after?.name).toBe('別テナントマネージャー')
      })

      it('GET /users（他テナントのホテル）は 403', async () => {
        const res = await request(app)
          .get(`/api/v1/users?hotelId=${HOTEL_B}`)
          .set('Authorization', `Bearer ${tokens.admin}`)

        expect(res.status).toBe(403)
      })

      it('GET /hotels は自テナントのホテルだけを返す', async () => {
        const res = await request(app)
          .get('/api/v1/hotels')
          .set('Authorization', `Bearer ${tokens.admin}`)

        expect(res.status).toBe(200)
        const ids = (res.body.data as Array<{ id: string }>).map((h) => h.id)
        expect(ids).toContain(HOTEL_A)
        expect(ids).not.toContain(HOTEL_B)
      })
    })

    describe('ADMIN は自テナント内では最上位として操作できる', () => {
      it('自テナントのホテルの設定を変更できる', async () => {
        const res = await request(app)
          .put(`/api/v1/settings/hotel/${HOTEL_A}`)
          .set('Authorization', `Bearer ${tokens.admin}`)
          .send({ name: '統合テストホテルA' })

        expect(res.status).toBe(200)
        expect(res.body.data.name).toBe('統合テストホテルA')
      })

      it('POST /hotels は tenantId を送らなくても自テナントに作られる', async () => {
        const res = await request(app)
          .post('/api/v1/hotels')
          .set('Authorization', `Bearer ${tokens.admin}`)
          .send({ name: `${PREFIX}-admin作成ホテル`, totalRooms: 30 })

        expect(res.status).toBe(201)
        expect(res.body.data.tenantId).toBe(TENANT_A)
      })

      it('POST /hotels で他テナントを指定すると 403（テナント指定は運営のみ）', async () => {
        const res = await request(app)
          .post('/api/v1/hotels')
          .set('Authorization', `Bearer ${tokens.admin}`)
          .send({ tenantId: TENANT_B, name: `${PREFIX}-越境ホテル`, totalRooms: 10 })

        expect(res.status).toBe(403)
        const leaked = await prisma.hotel.findFirst({
          where: { tenantId: TENANT_B, name: `${PREFIX}-越境ホテル` },
        })
        expect(leaked).toBeNull()
      })

      it('自テナントを明示的に指定しても 403（tenantId を送れるのは運営だけ）', async () => {
        const res = await request(app)
          .post('/api/v1/hotels')
          .set('Authorization', `Bearer ${tokens.admin}`)
          .send({ tenantId: TENANT_A, name: `${PREFIX}-自テナント明示`, totalRooms: 10 })

        expect(res.status).toBe(403)
      })
    })

    describe('運営ロールの付与はテナント側からできない', () => {
      it('ADMIN は PLATFORM_ADMIN ユーザーを作成できない（403）', async () => {
        const email = `${PREFIX}-admin-makes-platform@example.com`
        const res = await request(app)
          .post('/api/v1/auth/register')
          .set('Authorization', `Bearer ${tokens.admin}`)
          .send({
            email,
            password: 'Created1234',
            name: '運営を名乗る',
            role: 'PLATFORM_ADMIN',
            hotelId: HOTEL_A,
          })

        expect(res.status).toBe(403)
        expect(await prisma.user.findUnique({ where: { email } })).toBeNull()
      })

      it('ADMIN は既存ユーザーを PLATFORM_ADMIN に昇格できない（403）', async () => {
        const res = await request(app)
          .put(`/api/v1/users/${operatorUserId}`)
          .set('Authorization', `Bearer ${tokens.admin}`)
          .send({ role: 'PLATFORM_ADMIN' })

        expect(res.status).toBe(403)
        const after = await prisma.user.findUnique({ where: { id: operatorUserId } })
        expect(after?.role).not.toBe('PLATFORM_ADMIN')
      })

      it('MANAGER も PLATFORM_ADMIN に昇格できない（403）', async () => {
        const res = await request(app)
          .put(`/api/v1/users/${operatorUserId}`)
          .set('Authorization', `Bearer ${tokens.manager}`)
          .send({ role: 'PLATFORM_ADMIN' })

        expect(res.status).toBe(403)
      })
    })

    describe('運営（PLATFORM_ADMIN）はテナントを越えられる', () => {
      it('GET /hotels は全テナントのホテルを返す', async () => {
        const res = await request(app)
          .get('/api/v1/hotels')
          .set('Authorization', `Bearer ${tokens.platformAdmin}`)

        expect(res.status).toBe(200)
        const ids = (res.body.data as Array<{ id: string }>).map((h) => h.id)
        expect(ids).toContain(HOTEL_A)
        expect(ids).toContain(HOTEL_B)
      })

      it('ADMIN が読めない他テナントのホテルを参照できる', async () => {
        const res = await request(app)
          .get(`/api/v1/hotels/${HOTEL_B}`)
          .set('Authorization', `Bearer ${tokens.platformAdmin}`)

        expect(res.status).toBe(200)
        expect(res.body.data.id).toBe(HOTEL_B)
      })

      it('両テナントの KPI を参照できる', async () => {
        for (const hotelId of [HOTEL_A, HOTEL_B]) {
          const res = await request(app)
            .get(`/api/v1/dashboard/kpi?hotelId=${hotelId}&year=2030&month=1`)
            .set('Authorization', `Bearer ${tokens.platformAdmin}`)

          expect(res.status, `hotelId=${hotelId}`).toBe(200)
          expect(res.body.data.hotelId).toBe(hotelId)
        }
      })

      it('存在しないホテルは 404（バイパスしても存在確認は行う）', async () => {
        const res = await request(app)
          .get(`/api/v1/hotels/${PREFIX}-no-such-hotel`)
          .set('Authorization', `Bearer ${tokens.platformAdmin}`)

        expect(res.status).toBe(404)
      })

      it('tenantId を指定して任意のテナントにホテルを作成できる', async () => {
        const res = await request(app)
          .post('/api/v1/hotels')
          .set('Authorization', `Bearer ${tokens.platformAdmin}`)
          .send({ tenantId: TENANT_B, name: `${PREFIX}-運営作成ホテル`, totalRooms: 20 })

        expect(res.status).toBe(201)
        expect(res.body.data.tenantId).toBe(TENANT_B)
      })

      it('tenantId を省略すると 400（運営は自分のテナントを持たない）', async () => {
        const res = await request(app)
          .post('/api/v1/hotels')
          .set('Authorization', `Bearer ${tokens.platformAdmin}`)
          .send({ name: `${PREFIX}-テナント未指定`, totalRooms: 20 })

        expect(res.status).toBe(400)
      })

      it('PLATFORM_ADMIN ユーザーを作成できる', async () => {
        const email = `${PREFIX}-platform-created@example.com`
        const res = await request(app)
          .post('/api/v1/auth/register')
          .set('Authorization', `Bearer ${tokens.platformAdmin}`)
          .send({ email, password: 'Created1234', name: '新しい運営', role: 'PLATFORM_ADMIN' })

        expect(res.status).toBe(201)
        expect(res.body.data.role).toBe('PLATFORM_ADMIN')
        expect(res.body.data.tenantId).toBeNull()
      })

      it('ADMIN ユーザーのロールを変更できる（テナント条件なしで到達できる）', async () => {
        const other = await prisma.user.findUnique({
          where: { email: EMAILS.otherTenantManager },
        })
        const res = await request(app)
          .put(`/api/v1/users/${other!.id}`)
          .set('Authorization', `Bearer ${tokens.platformAdmin}`)
          .send({ name: '別テナントマネージャー（運営が改名）' })

        expect(res.status).toBe(200)

        // 後続テストのために名前を戻す
        await prisma.user.update({
          where: { id: other!.id },
          data: { name: '別テナントマネージャー' },
        })
      })
    })

    describe('既存のロールマトリクスは維持される', () => {
      it('OPERATOR は料金ランクを作成できない（403）', async () => {
        const res = await request(app)
          .post('/api/v1/settings/price-ranks')
          .set('Authorization', `Bearer ${tokens.operator}`)
          .send({ hotelId: HOTEL_A, rank: 38, label: 'R38', price1P: 1000, price2P: 2000 })

        expect(res.status).toBe(403)
      })

      it('OPERATOR はホテルを作成できない（403）', async () => {
        const res = await request(app)
          .post('/api/v1/hotels')
          .set('Authorization', `Bearer ${tokens.operator}`)
          .send({ name: `${PREFIX}-operator作成`, totalRooms: 10 })

        expect(res.status).toBe(403)
      })

      it('MANAGER は自テナント内なら料金ランクを作成できる（201）', async () => {
        const res = await request(app)
          .post('/api/v1/settings/price-ranks')
          .set('Authorization', `Bearer ${tokens.manager}`)
          .send({ hotelId: HOTEL_A, rank: 36, label: 'R36', price1P: 1000, price2P: 2000 })

        expect(res.status).toBe(201)
      })

      it('MANAGER はホテルを作成できない（403・ADMIN 以上のみ）', async () => {
        const res = await request(app)
          .post('/api/v1/hotels')
          .set('Authorization', `Bearer ${tokens.manager}`)
          .send({ name: `${PREFIX}-manager作成`, totalRooms: 10 })

        expect(res.status).toBe(403)
      })

      it('自分自身のロールは ADMIN でも変更できない（400）', async () => {
        const res = await request(app)
          .put(`/api/v1/users/${adminUserId}`)
          .set('Authorization', `Bearer ${tokens.admin}`)
          .send({ role: 'OPERATOR' })

        expect(res.status).toBe(400)
        expect(res.body.error).toContain('自分自身')
      })
    })
  })

  // ======================================
  // N-1 予算
  // ======================================

  describe('月次予算（N-1）', () => {
    it('MANAGER の一括更新が反映され、監査ログが残る', async () => {
      const before = await prisma.auditLog.count({
        where: { entity: 'MonthlyBudget', tenantId: TENANT_A },
      })

      const res = await request(app)
        .put('/api/v1/settings/budgets')
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({
          hotelId: HOTEL_A,
          year: 2030,
          months: [
            { month: 1, budgetRevenue: 30_000_000, budgetAdr: 15_000, budgetOccupancy: 0.8 },
            { month: 2, budgetRevenue: 28_000_000, budgetAdr: 14_500, budgetOccupancy: 0.75 },
          ],
        })

      expect(res.status).toBe(200)
      expect(res.body.data.months).toHaveLength(12)
      expect(res.body.data.months[0].budget.budgetRevenue).toBe(30_000_000)
      // 予算室数は「客室数 × 予算稼働率 × 月日数」で補完される（100室 × 0.8 × 31日）
      expect(res.body.data.months[0].budget.budgetRooms).toBe(2480)

      const after = await prisma.auditLog.count({
        where: { entity: 'MonthlyBudget', tenantId: TENANT_A },
      })
      expect(after).toBe(before + 1)

      const log = await prisma.auditLog.findFirst({
        where: { entity: 'MonthlyBudget', tenantId: TENANT_A },
        orderBy: { createdAt: 'desc' },
      })
      expect(log?.action).toBe('UPDATE')
      expect(log?.userId).toBe(managerUserId)
      expect(log?.oldValue).not.toBeNull()
    })

    it('未登録の月も budget: null で12か月ぶん返す', async () => {
      const res = await request(app)
        .get(`/api/v1/settings/budgets?hotelId=${HOTEL_A}&year=2031`)
        .set('Authorization', `Bearer ${tokens.manager}`)

      expect(res.status).toBe(200)
      expect(res.body.data.months).toHaveLength(12)
      expect(res.body.data.months.every((m: { budget: unknown }) => m.budget === null)).toBe(true)
    })

    it('同じ月を重複して送ると 400', async () => {
      const res = await request(app)
        .put('/api/v1/settings/budgets')
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({
          hotelId: HOTEL_A,
          year: 2030,
          months: [{ month: 3, budgetRevenue: 1 }, { month: 3, budgetRevenue: 2 }],
        })

      expect(res.status).toBe(400)
    })
  })

  // ======================================
  // N-2 競合ホテル
  // ======================================

  describe('競合ホテル（N-2）', () => {
    it('作成・一覧・更新・削除が通り、削除後は一覧から消える', async () => {
      const created = await request(app)
        .post('/api/v1/settings/competitors')
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({
          hotelId: HOTEL_A,
          name: '統合テスト競合',
          category: '同カテゴリ',
          otaUrls: { rakuten: 'https://example.com/rakuten', jalan: null },
        })

      expect(created.status).toBe(201)
      expect(created.body.data.name).toBe('統合テスト競合')
      expect(created.body.data.otaUrls.rakuten).toBe('https://example.com/rakuten')
      const id = created.body.data.id as string

      const list = await request(app)
        .get(`/api/v1/settings/competitors?hotelId=${HOTEL_A}`)
        .set('Authorization', `Bearer ${tokens.operator}`)
      expect(list.status).toBe(200)
      expect(list.body.data.map((c: { id: string }) => c.id)).toContain(id)

      const updated = await request(app)
        .put(`/api/v1/settings/competitors/${id}?hotelId=${HOTEL_A}`)
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ name: '統合テスト競合（改名）' })
      expect(updated.status).toBe(200)
      expect(updated.body.data.name).toBe('統合テスト競合（改名）')

      const deleted = await request(app)
        .delete(`/api/v1/settings/competitors/${id}?hotelId=${HOTEL_A}`)
        .set('Authorization', `Bearer ${tokens.manager}`)
      expect(deleted.status).toBe(200)

      const after = await request(app)
        .get(`/api/v1/settings/competitors?hotelId=${HOTEL_A}`)
        .set('Authorization', `Bearer ${tokens.manager}`)
      expect(after.body.data.map((c: { id: string }) => c.id)).not.toContain(id)

      // 論理削除なので行自体は残る
      const row = await prisma.competitor.findUnique({ where: { id } })
      expect(row?.isActive).toBe(false)
    })

    it('6社目の登録は 400（上限5社）', async () => {
      const ids: string[] = []
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/v1/settings/competitors')
          .set('Authorization', `Bearer ${tokens.manager}`)
          .send({ hotelId: HOTEL_A, name: `上限テスト${i}` })
        expect(res.status).toBe(201)
        ids.push(res.body.data.id)
      }

      const over = await request(app)
        .post('/api/v1/settings/competitors')
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ hotelId: HOTEL_A, name: '6社目' })
      expect(over.status).toBe(400)
      expect(over.body.error).toContain('最大5件')

      for (const id of ids) {
        await request(app)
          .delete(`/api/v1/settings/competitors/${id}?hotelId=${HOTEL_A}`)
          .set('Authorization', `Bearer ${tokens.manager}`)
      }
    })

    it('OTA URL が URL 形式でなければ 400', async () => {
      const res = await request(app)
        .post('/api/v1/settings/competitors')
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ hotelId: HOTEL_A, name: 'URL不正', otaUrls: { rakuten: 'not-a-url' } })

      expect(res.status).toBe(400)
    })
  })

  // ======================================
  // N-3 ユーザー管理
  // ======================================

  describe('ユーザー管理（N-3）', () => {
    it('MANAGER は自テナントのユーザー一覧を取得できる', async () => {
      const res = await request(app)
        .get(`/api/v1/users?hotelId=${HOTEL_A}`)
        .set('Authorization', `Bearer ${tokens.manager}`)

      expect(res.status).toBe(200)
      const emails = (res.body.data as Array<{ email: string }>).map((u) => u.email)
      expect(emails).toContain(EMAILS.manager)
      // hotelId が null のテナント統括ユーザーも含まれる
      expect(emails).toContain(EMAILS.tenantManager)
      // 別テナントのユーザーは含まれない
      expect(emails).not.toContain(EMAILS.otherTenantManager)
    })

    it('OPERATOR はユーザー一覧を取得できない', async () => {
      const res = await request(app)
        .get(`/api/v1/users?hotelId=${HOTEL_A}`)
        .set('Authorization', `Bearer ${tokens.operator}`)

      expect(res.status).toBe(403)
    })

    it('MANAGER が他ユーザーの名前を更新でき、oldValue つきの監査ログが残る', async () => {
      const res = await request(app)
        .put(`/api/v1/users/${operatorUserId}`)
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ name: '統合テストオペレーター（改名）' })

      expect(res.status).toBe(200)
      expect(res.body.data.name).toBe('統合テストオペレーター（改名）')

      const log = await prisma.auditLog.findFirst({
        where: { entity: 'User', entityId: operatorUserId, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
      })
      expect(log).not.toBeNull()
      expect((log?.oldValue as { name: string }).name).toBe('統合テストオペレーター')
    })

    it('自分自身を無効化できない（400）', async () => {
      const res = await request(app)
        .put(`/api/v1/users/${managerUserId}`)
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ isActive: false })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('自分自身')
    })

    it('自分自身のロールを変更できない（400）', async () => {
      const res = await request(app)
        .put(`/api/v1/users/${managerUserId}`)
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ role: 'OPERATOR' })

      expect(res.status).toBe(400)
    })

    it('MANAGER は ADMIN ロールを付与できない（403）', async () => {
      const res = await request(app)
        .put(`/api/v1/users/${operatorUserId}`)
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ role: 'ADMIN' })

      expect(res.status).toBe(403)
    })

    it('MANAGER は他テナントのユーザーを更新できない（404）', async () => {
      const other = await prisma.user.findUnique({ where: { email: EMAILS.otherTenantManager } })
      const res = await request(app)
        .put(`/api/v1/users/${other!.id}`)
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ name: '乗っ取り' })

      expect(res.status).toBe(404)
    })

    it('MANAGER は自テナント内にユーザーを登録できる（tenantId は hotelId から導出される）', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({
          email: EMAILS.created,
          password: 'Created1234',
          name: '統合テスト新規ユーザー',
          role: 'OPERATOR',
          hotelId: HOTEL_A,
        })

      expect(res.status).toBe(201)
      expect(res.body.data.tenantId).toBe(TENANT_A)
      expect(res.body.data.password).toBeUndefined()
    })

    // #52: 他テナントのホテルIDを送っても「見つからない」と同じ 400 にして、
    // そのホテルが存在するかどうかを判別できないようにする
    it('MANAGER は他テナントのホテルにユーザーを登録できない（400・存在を漏らさない）', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({
          email: `${PREFIX}-cross@example.com`,
          password: 'Created1234',
          name: 'テナント越え',
          role: 'OPERATOR',
          hotelId: HOTEL_B,
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('指定されたホテルが見つかりません')
      // ユーザーが作られていないこと（テナントB に紛れ込まない）
      const leaked = await prisma.user.findUnique({
        where: { email: `${PREFIX}-cross@example.com` },
      })
      expect(leaked).toBeNull()
    })

    it('OPERATOR はユーザー登録できない（403）', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .set('Authorization', `Bearer ${tokens.operator}`)
        .send({
          email: `${PREFIX}-byoperator@example.com`,
          password: 'Created1234',
          name: 'オペレーター作成',
          hotelId: HOTEL_A,
        })

      expect(res.status).toBe(403)
    })
  })

  // ======================================
  // N-4 アラート状態遷移
  // ======================================

  describe('アラート状態遷移（N-4）', () => {
    it('OPERATOR は確認済み（ACKNOWLEDGED）にできる', async () => {
      const res = await request(app)
        .patch(`/api/v1/dashboard/alerts/${ALERT_ID}`)
        .set('Authorization', `Bearer ${tokens.operator}`)
        .send({ hotelId: HOTEL_A, status: 'ACKNOWLEDGED' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('ACKNOWLEDGED')
    })

    it('OPERATOR は解決済み（RESOLVED）にできない（403）', async () => {
      const res = await request(app)
        .patch(`/api/v1/dashboard/alerts/${ALERT_ID}`)
        .set('Authorization', `Bearer ${tokens.operator}`)
        .send({ hotelId: HOTEL_A, status: 'RESOLVED' })

      expect(res.status).toBe(403)
    })

    it('MANAGER は解決済みにでき、resolvedAt と監査ログが記録される', async () => {
      const res = await request(app)
        .patch(`/api/v1/dashboard/alerts/${ALERT_ID}`)
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ hotelId: HOTEL_A, status: 'RESOLVED' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('RESOLVED')
      expect(res.body.data.resolvedAt).not.toBeNull()

      const log = await prisma.auditLog.findFirst({
        where: { entity: 'Alert', entityId: ALERT_ID, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
      })
      expect((log?.newValue as { status: string }).status).toBe('RESOLVED')
    })

    it('解決済みを確認済みに戻すことはできない（400）', async () => {
      const res = await request(app)
        .patch(`/api/v1/dashboard/alerts/${ALERT_ID}`)
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ hotelId: HOTEL_A, status: 'ACKNOWLEDGED' })

      expect(res.status).toBe(400)
    })

    it('未知のステータスは 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/dashboard/alerts/${ALERT_ID}`)
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ hotelId: HOTEL_A, status: 'OPEN' })

      expect(res.status).toBe(400)
    })
  })

  // ======================================
  // N-5 スナップショット・着地シミュレーション
  // ======================================

  describe('スナップショットと着地シミュレーション（N-5）', () => {
    it('KPI スナップショットを保存でき、同日に再実行しても行が増えない（冪等）', async () => {
      const first = await request(app)
        .post('/api/v1/dashboard/kpi/snapshot')
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ hotelId: HOTEL_A, year: 2030, month: 1 })

      expect(first.status).toBe(201)
      expect(first.body.data.targetYear).toBe(2030)

      const second = await request(app)
        .post('/api/v1/dashboard/kpi/snapshot')
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ hotelId: HOTEL_A, year: 2030, month: 1 })
      expect(second.status).toBe(201)
      expect(second.body.data.id).toBe(first.body.data.id)

      const count = await prisma.kpiSnapshot.count({
        where: { hotelId: HOTEL_A, targetYear: 2030, targetMonth: 1 },
      })
      expect(count).toBe(1)

      // 比較APIから読めるようになる（F-DASH-04）
      const comparison = await request(app)
        .get(`/api/v1/dashboard/kpi/comparison?hotelId=${HOTEL_A}&year=2030&month=1`)
        .set('Authorization', `Bearer ${tokens.manager}`)
      expect(comparison.status).toBe(200)
      expect(comparison.body.data).toHaveLength(1)
    })

    it('OPERATOR はスナップショットを取得できない（403）', async () => {
      const res = await request(app)
        .post('/api/v1/dashboard/kpi/snapshot')
        .set('Authorization', `Bearer ${tokens.operator}`)
        .send({ hotelId: HOTEL_A, year: 2030, month: 1 })

      expect(res.status).toBe(403)
    })

    it('着地シミュレーションを再計算すると AI 予測から着地値が入る', async () => {
      const res = await request(app)
        .post('/api/v1/pricing/simulation/recompute')
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ hotelId: HOTEL_A, year: 2030, month: 1 })

      expect(res.status).toBe(200)
      expect(res.body.data.predictedDays).toBe(1)
      // 100室 × 予測稼働率 0.8 = 80室、予測ADR 15,000 → 1,200,000
      expect(res.body.data.simulation.projectedRooms).toBe(80)
      expect(res.body.data.simulation.projectedRevenue).toBe(1_200_000)
      expect(res.body.data.simulation.projectedAdr).toBe(15_000)

      const read = await request(app)
        .get(`/api/v1/pricing/simulation?hotelId=${HOTEL_A}&year=2030&month=1`)
        .set('Authorization', `Bearer ${tokens.manager}`)
      expect(read.status).toBe(200)
      expect(read.body.data.simulation.projectedRooms).toBe(80)
    })

    it('OPERATOR は着地シミュレーションを再計算できない（403）', async () => {
      const res = await request(app)
        .post('/api/v1/pricing/simulation/recompute')
        .set('Authorization', `Bearer ${tokens.operator}`)
        .send({ hotelId: HOTEL_A, year: 2030, month: 1 })

      expect(res.status).toBe(403)
    })
  })

  // ======================================
  // N-7 口コミ
  // ======================================

  describe('口コミ評価点（N-7）', () => {
    it('GET /analysis/reviews が OTA ソース別の評価点を返す', async () => {
      const res = await request(app)
        .get(`/api/v1/analysis/reviews?hotelId=${HOTEL_A}`)
        .set('Authorization', `Bearer ${tokens.manager}`)

      expect(res.status).toBe(200)
      const sources = (res.body.data as Array<{ source: string; score: number }>).map(
        (r) => r.source
      )
      expect(sources).toContain('rakuten')
      expect(sources).toContain('jalan')
    })

    it('他テナントのホテルの口コミは参照できない（403）', async () => {
      const res = await request(app)
        .get(`/api/v1/analysis/reviews?hotelId=${HOTEL_A}`)
        .set('Authorization', `Bearer ${tokens.otherManager}`)

      expect(res.status).toBe(403)
    })
  })

  describe('料金ランクの未設定価格（レビュー指摘 R-2）', () => {
    it('3名・4名を null で保存でき、0 に化けない', async () => {
      const created = await request(app)
        .post('/api/v1/settings/price-ranks')
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ hotelId: HOTEL_A, rank: 37, label: 'R37', price1P: 5000, price2P: 7000 })

      expect(created.status).toBe(201)
      expect(created.body.data.price3P).toBeNull()
      expect(created.body.data.price4P).toBeNull()

      // 値に触れずに label だけ更新しても null のまま
      const renamed = await request(app)
        .put(`/api/v1/settings/price-ranks/${created.body.data.id}?hotelId=${HOTEL_A}`)
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ label: 'R37b' })

      expect(renamed.status).toBe(200)
      expect(renamed.body.data.price3P).toBeNull()

      // 明示的に null を送ると設定済みの値をクリアできる
      const set = await request(app)
        .put(`/api/v1/settings/price-ranks/${created.body.data.id}?hotelId=${HOTEL_A}`)
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ price3P: 9000 })
      expect(set.body.data.price3P).toBe(9000)

      const cleared = await request(app)
        .put(`/api/v1/settings/price-ranks/${created.body.data.id}?hotelId=${HOTEL_A}`)
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ price3P: null })

      expect(cleared.status).toBe(200)
      expect(cleared.body.data.price3P).toBeNull()
    })
  })

  describe('hotelId の型検証（レビュー指摘 R-1）', () => {
    it('hotelId を配列で渡すと 400（認可判定に配列が流れ込まない）', async () => {
      const res = await request(app)
        .get(`/api/v1/settings/price-ranks?hotelId=${HOTEL_A}&hotelId=${HOTEL_A}`)
        .set('Authorization', `Bearer ${tokens.manager}`)

      expect(res.status).toBe(400)
    })

    it('hotelId をオブジェクトで渡すと 400', async () => {
      const res = await request(app)
        .get(`/api/v1/settings/price-ranks?hotelId[id]=${HOTEL_A}`)
        .set('Authorization', `Bearer ${tokens.manager}`)

      expect(res.status).toBe(400)
    })

    it('body の hotelId が配列でも他ホテルへ書き込めない', async () => {
      const res = await request(app)
        .post('/api/v1/settings/price-ranks')
        .set('Authorization', `Bearer ${tokens.manager}`)
        .send({ hotelId: [HOTEL_A, HOTEL_B], rank: 39, label: 'R39', price1P: 1000, price2P: 2000 })

      expect(res.status).toBe(400)
    })
  })
})
