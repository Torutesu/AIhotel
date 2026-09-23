import { prisma } from '../lib/prisma.js'
import { ConflictError, NotFoundError } from '../middlewares/errorHandler.js'
import type { CreateTenantInput, UpdateTenantInput } from '../lib/validators.js'

// テナント（顧客企業）の管理（#81）。運営（PLATFORM_ADMIN）専用 API から呼ぶ。
// Tenant はテナント分離の最上位なので tenantId を持たない。

export interface TenantSummary {
  id: string
  name: string
  code: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  hotelCount: number
  userCount: number
}

/** テナント一覧（有効なホテル数・ユーザー数つき） */
export async function listTenantsService(): Promise<TenantSummary[]> {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      _count: {
        select: {
          hotels: { where: { isActive: true } },
          users: { where: { isActive: true } },
        },
      },
    },
  })
  return tenants.map(({ _count, ...tenant }) => ({
    ...tenant,
    hotelCount: _count.hotels,
    userCount: _count.users,
  }))
}

export async function createTenantService(input: CreateTenantInput) {
  const existing = await prisma.tenant.findUnique({ where: { code: input.code } })
  if (existing) throw new ConflictError(`コード「${input.code}」のテナントは既に登録されています`)
  return prisma.tenant.create({ data: { name: input.name, code: input.code } })
}

/**
 * テナントの名称変更・契約停止／再開。
 * 停止したら所属ユーザーのリフレッシュトークンを消す（アクセストークンは
 * authenticate がテナントの状態を毎リクエスト確認するので、次のリクエストから 401 になる — #78）
 */
export async function updateTenantService(id: string, input: UpdateTenantInput) {
  const before = await prisma.tenant.findUnique({ where: { id } })
  if (!before) throw new NotFoundError('テナント')

  const after = await prisma.$transaction(async (tx) => {
    const updated = await tx.tenant.update({ where: { id }, data: input })
    if (input.isActive === false) {
      await tx.refreshToken.deleteMany({ where: { tenantId: id } })
    }
    return updated
  })
  return { before, after }
}
