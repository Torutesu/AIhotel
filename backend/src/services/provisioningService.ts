import { prisma } from '../lib/prisma.js'
import { hashPassword } from '../lib/auth.js'
import { NotFoundError, ConflictError } from '../middlewares/errorHandler.js'
import { seedDefaultMasters } from './masterService.js'
import type {
  ProvisionTenantInput,
  GeneratePriceRanksInput,
  PriceRankGenerationParams,
} from '../lib/validators.js'

// テナントプロビジョニング（SAAS_ONBOARDING.md Step 1）と
// 料金ランク自動生成（同 Step 2）。デモ用の prisma/seed.ts とはコードパスを分離する。

// 作成済みユーザーからパスワードを返さないための select
const userPublicSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  tenantId: true,
  hotelId: true,
  isActive: true,
  createdAt: true,
} as const

export interface GeneratedPriceRankRow {
  rank: number
  label: string
  price1P: number
  price2P: number
  price3P: number
  price4P?: number
}

/**
 * 下限〜上限価格の線形補間で料金ランク行を生成する（純粋関数）。
 * seed.ts の `6500 + ratio * 23500` を一般化したもの。
 */
export function generatePriceRankRows(params: PriceRankGenerationParams): GeneratedPriceRankRow[] {
  const { count, minPrice1P, maxPrice1P, multiplier2P, multiplier3P, multiplier4P, roundTo } = params
  const roundPrice = (value: number) => Math.round(value / roundTo) * roundTo

  const rows: GeneratedPriceRankRow[] = []
  for (let rank = 1; rank <= count; rank++) {
    // count=1 のときは下限価格のみ（ゼロ除算回避）
    const ratio = count === 1 ? 0 : (rank - 1) / (count - 1)
    const price1P = roundPrice(minPrice1P + ratio * (maxPrice1P - minPrice1P))
    rows.push({
      rank,
      label: `R${String(rank).padStart(2, '0')}`,
      price1P,
      price2P: roundPrice(price1P * multiplier2P),
      price3P: roundPrice(price1P * multiplier3P),
      ...(multiplier4P !== undefined && { price4P: roundPrice(price1P * multiplier4P) }),
    })
  }
  return rows
}

/**
 * テナント一括プロビジョニング（ADMIN専用）。
 * Tenant + Hotel + 初期User + PricingStrategyConfig（デフォルト40/40/20）を
 * 1トランザクションで作成する。priceRanks 指定時は料金ランクも同時生成。
 */
export async function provisionTenantService(input: ProvisionTenantInput) {
  const existingTenant = await prisma.tenant.findUnique({
    where: { code: input.tenant.code },
  })
  if (existingTenant) {
    throw new ConflictError(`テナントコード「${input.tenant.code}」は既に使用されています`)
  }

  // メールはテナント単位で一意（D-02）。ここで作るのは新規テナントなので
  // 既存ユーザーとの衝突は起こらない。バッチ内の重複は zod スキーマで検証済み

  // bcrypt はコストが高いためトランザクション外でハッシュ化する
  const hashedPasswords = await Promise.all(input.users.map((u) => hashPassword(u.password)))

  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { name: input.tenant.name, code: input.tenant.code },
    })

    const hotel = await tx.hotel.create({
      data: {
        tenantId: tenant.id,
        name: input.hotel.name,
        address: input.hotel.address,
        phone: input.hotel.phone,
        email: input.hotel.email,
        totalRooms: input.hotel.totalRooms,
        ...(input.hotel.weekendDays && { weekendDays: input.hotel.weekendDays }),
      },
    })

    // 価格戦略の重みは schema.prisma のデフォルト（40/40/20）に任せる
    const pricingStrategyConfig = await tx.pricingStrategyConfig.create({
      data: { tenantId: tenant.id, hotelId: hotel.id },
    })

    const users = []
    for (let i = 0; i < input.users.length; i++) {
      const u = input.users[i]
      users.push(
        await tx.user.create({
          data: {
            tenantId: tenant.id,
            hotelId: hotel.id,
            email: u.email,
            password: hashedPasswords[i],
            name: u.name,
            role: u.role,
          },
          select: userPublicSelect,
        })
      )
    }

    // OTAチャネル・レビューソースの既定値を投入する（D-10）。
    // 初期設定の項目を増やさないため、独自チャネルを持つ顧客だけが後から編集すればよい
    const masters = await seedDefaultMasters(tx, tenant.id)

    let priceRankCount = 0
    if (input.priceRanks) {
      const rows = generatePriceRankRows(input.priceRanks)
      await tx.priceRank.createMany({
        data: rows.map((row) => ({ ...row, tenantId: tenant.id, hotelId: hotel.id })),
      })
      priceRankCount = rows.length
    }

    return { tenant, hotel, pricingStrategyConfig, users, priceRankCount, masters }
  })
}

/**
 * 料金ランク40段階の自動生成（F-SET-02 / SAAS_ONBOARDING.md Step 2）。
 * 既存ランクがあるホテルには replaceExisting=true を明示しない限り上書きしない。
 */
export async function generatePriceRanksService(input: GeneratePriceRanksInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const existingCount = await prisma.priceRank.count({ where: { hotelId: input.hotelId } })
  if (existingCount > 0 && !input.replaceExisting) {
    throw new ConflictError(
      `既に料金ランクが${existingCount}件存在します。置き換える場合は replaceExisting を指定してください`
    )
  }

  const rows = generatePriceRankRows(input)

  return prisma.$transaction(async (tx) => {
    await tx.priceRank.deleteMany({ where: { hotelId: input.hotelId } })
    await tx.priceRank.createMany({
      data: rows.map((row) => ({ ...row, tenantId: hotel.tenantId, hotelId: input.hotelId })),
    })
    return tx.priceRank.findMany({
      where: { hotelId: input.hotelId },
      orderBy: { rank: 'asc' },
    })
  })
}
