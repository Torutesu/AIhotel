import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// テナント分離（RLS）が実際のDBで機能していることを検証する（SAAS_DECISIONS.md D-01）。
//
// このテストは実在の PostgreSQL を必要とし、かつ
// 「superuser でも BYPASSRLS でもないロール」で接続していなければ意味を持たない
// （superuser は RLS を素通りするため、テストが常に成功してしまう）。
//
// 実行方法:
//   RLS_TEST_DATABASE_URL="postgresql://app_user:<pass>@host:5432/db?schema=public" pnpm test
// 未設定の場合はスキップする（DBのないCIでも他のテストを止めない）。

const testDatabaseUrl = process.env.RLS_TEST_DATABASE_URL

type PrismaModule = typeof import('./prisma.js')

const suffix = Math.random().toString(36).slice(2, 8)
const TENANT_A = `rlstest-a-${suffix}`
const TENANT_B = `rlstest-b-${suffix}`
const HOTEL_A = `rlshotel-a-${suffix}`
const HOTEL_B = `rlshotel-b-${suffix}`

describe.skipIf(!testDatabaseUrl)('Row Level Security によるテナント分離', () => {
  let mod: PrismaModule

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl
    mod = await import('./prisma.js')

    // 前提の確認: 接続ロールが RLS を素通りしていないこと。
    // ここが false でないと、以降の検証はすべて無意味になる
    const [role] = await mod.runWithRlsBypass(() =>
      mod.prisma.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
      `
    )
    expect(role.rolsuper, '接続ロールが superuser では RLS が効かない').toBe(false)
    expect(role.rolbypassrls, '接続ロールに BYPASSRLS があると RLS が効かない').toBe(false)

    // 2テナント分のデータを用意する（横断が必要なのでbypassで投入）
    await mod.runWithRlsBypass(async () => {
      for (const [tenantId, hotelId, name] of [
        [TENANT_A, HOTEL_A, 'アルファ東京'],
        [TENANT_B, HOTEL_B, 'ベータ大阪'],
      ]) {
        await mod.prisma.tenant.create({
          data: { id: tenantId, name: `${name}の運営会社`, code: tenantId },
        })
        await mod.prisma.hotel.create({
          data: { id: hotelId, tenantId, name, totalRooms: 100 },
        })
        await mod.prisma.dailyData.create({
          data: { tenantId, hotelId, date: new Date('2026-08-01'), totalRevenue: 1_000_000 },
        })
      }
    })
  })

  afterAll(async () => {
    if (!mod) return
    await mod.runWithRlsBypass(async () => {
      await mod.prisma.dailyData.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } })
      await mod.prisma.hotel.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } })
      await mod.prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } })
    })
  })

  it('自テナントのホテルだけが見える', async () => {
    const hotels = await mod.runWithTenant(TENANT_A, () =>
      mod.prisma.hotel.findMany({ where: { id: { in: [HOTEL_A, HOTEL_B] } } })
    )
    expect(hotels.map((h) => h.id)).toEqual([HOTEL_A])
  })

  it('他テナントのIDを直接指定しても取得できない', async () => {
    const hotel = await mod.runWithTenant(TENANT_A, () =>
      mod.prisma.hotel.findUnique({ where: { id: HOTEL_B } })
    )
    expect(hotel).toBeNull()
  })

  it('集計クエリにも他テナントの数値が混ざらない', async () => {
    const result = await mod.runWithTenant(TENANT_A, () =>
      mod.prisma.dailyData.aggregate({ _sum: { totalRevenue: true }, _count: true })
    )
    expect(result._count).toBe(1)
    expect(result._sum.totalRevenue).toBe(1_000_000)
  })

  it('テナントコンテキスト外では何も見えない（設定し忘れは0件になる）', async () => {
    const count = await mod.prisma.hotel.count({ where: { id: { in: [HOTEL_A, HOTEL_B] } } })
    expect(count).toBe(0)
  })

  it('他テナントのIDでレコードを作成できない', async () => {
    await expect(
      mod.runWithTenant(TENANT_A, () =>
        mod.prisma.hotel.create({
          data: { tenantId: TENANT_B, name: '紛れ込ませたホテル', totalRooms: 1 },
        })
      )
    ).rejects.toThrow()
  })

  it('他テナントのレコードを更新・削除できない', async () => {
    const updated = await mod.runWithTenant(TENANT_A, () =>
      mod.prisma.hotel.updateMany({ where: { id: HOTEL_B }, data: { name: '乗っ取り' } })
    )
    expect(updated.count).toBe(0)

    const deleted = await mod.runWithTenant(TENANT_A, () =>
      mod.prisma.dailyData.deleteMany({ where: { tenantId: TENANT_B } })
    )
    expect(deleted.count).toBe(0)
  })

  it('テナント一覧に他社が現れない（顧客企業名の流出防止）', async () => {
    const tenants = await mod.runWithTenant(TENANT_A, () =>
      mod.prisma.tenant.findMany({ where: { id: { in: [TENANT_A, TENANT_B] } } })
    )
    expect(tenants.map((t) => t.id)).toEqual([TENANT_A])
  })

  it('コンテキストは他テナントの処理に漏れない（接続の使い回し対策）', async () => {
    const a = await mod.runWithTenant(TENANT_A, () => mod.prisma.hotel.count())
    const b = await mod.runWithTenant(TENANT_B, () => mod.prisma.hotel.count())
    const afterContext = await mod.prisma.hotel.count()
    expect([a, b, afterContext]).toEqual([1, 1, 0])
  })

  it('提供側ADMIN（bypass）は横断できる', async () => {
    const hotels = await mod.runWithRlsBypass(() =>
      mod.prisma.hotel.findMany({ where: { id: { in: [HOTEL_A, HOTEL_B] } } })
    )
    expect(hotels).toHaveLength(2)
  })
})
