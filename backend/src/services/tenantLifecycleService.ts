import { prisma, runWithRlsBypass, runWithTenant } from '../lib/prisma.js'
import { NotFoundError, BadRequestError } from '../middlewares/errorHandler.js'

// テナントの解約処理（データの書き出しと削除）。
// 契約終了時にデータを返す／消す手段がないと、契約書に「返却・消去する」と
// 書けない。提供側ADMIN専用の操作。

/**
 * テナントの全データを書き出す（返却用）。
 * 認証情報（パスワード・トークン）は返さない。
 */
export async function exportTenantDataService(tenantId: string) {
  const tenant = await runWithRlsBypass(() =>
    prisma.tenant.findUnique({ where: { id: tenantId } })
  )
  if (!tenant) throw new NotFoundError('テナント')

  // テナントコンテキスト内で読むことで、取り違えても他社データが混ざらない
  return runWithTenant(tenantId, async () => {
    const [
      hotels,
      users,
      roomTypes,
      priceRanks,
      pricingStrategyConfigs,
      dailyData,
      dailyRoomData,
      monthlyBudgets,
      competitors,
      competitorPriceData,
      events,
      campaigns,
      groupBookings,
      otaChannelData,
      reviewScores,
      kpiSnapshots,
      auditLogs,
    ] = await Promise.all([
      prisma.hotel.findMany(),
      // パスワードを含めない
      prisma.user.findMany({
        select: { id: true, email: true, name: true, role: true, hotelId: true, isActive: true, createdAt: true },
      }),
      prisma.roomType.findMany(),
      prisma.priceRank.findMany(),
      prisma.pricingStrategyConfig.findMany(),
      prisma.dailyData.findMany(),
      prisma.dailyRoomData.findMany(),
      prisma.monthlyBudget.findMany(),
      prisma.competitor.findMany(),
      prisma.competitorPriceData.findMany(),
      prisma.event.findMany(),
      prisma.campaign.findMany(),
      prisma.groupBooking.findMany(),
      prisma.otaChannelData.findMany(),
      prisma.reviewScore.findMany(),
      prisma.kpiSnapshot.findMany(),
      prisma.auditLog.findMany(),
    ])

    return {
      exportedAt: new Date().toISOString(),
      tenant: { id: tenant.id, name: tenant.name, code: tenant.code, createdAt: tenant.createdAt },
      hotels,
      users,
      roomTypes,
      priceRanks,
      pricingStrategyConfigs,
      dailyData,
      dailyRoomData,
      monthlyBudgets,
      competitors,
      competitorPriceData,
      events,
      campaigns,
      groupBookings,
      otaChannelData,
      reviewScores,
      kpiSnapshots,
      auditLogs,
    }
  })
}

/**
 * テナントを無効化する（解約の第一段階）。
 * ログインとトークン更新が即座に拒否され、掃除ジョブの対象からも外れる。
 * データは残るため、この時点なら復旧できる。
 */
export async function deactivateTenantService(tenantId: string) {
  const tenant = await runWithRlsBypass(async () => {
    const found = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!found) throw new NotFoundError('テナント')
    await prisma.tenant.update({ where: { id: tenantId }, data: { isActive: false } })
    // 既存セッションを即座に無効化する
    await prisma.refreshToken.deleteMany({ where: { tenantId } })
    return found
  })
  return { id: tenant.id, name: tenant.name, code: tenant.code, isActive: false }
}

/**
 * テナントを完全に削除する（解約の第二段階・取り消し不可）。
 *
 * 事故を防ぐため、以下をすべて満たす場合のみ実行する:
 *  - 事前に無効化されていること（いきなり削除できない）
 *  - 確認のためテナントコードを正確に入力していること
 *
 * 関連データは Prisma のカスケード削除で消える。
 */
export async function deleteTenantService(tenantId: string, confirmationCode: string) {
  return runWithRlsBypass(async () => {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundError('テナント')

    if (tenant.isActive) {
      throw new BadRequestError(
        '有効なテナントは削除できません。先に無効化して、返却データの書き出しを済ませてください'
      )
    }
    if (confirmationCode !== tenant.code) {
      throw new BadRequestError('確認のためテナントコードを正確に入力してください')
    }

    // AuditLog と User の tenantId は onDelete: SetNull のため、先に明示的に削除する
    await prisma.auditLog.deleteMany({ where: { tenantId } })
    await prisma.userToken.deleteMany({ where: { tenantId } })
    await prisma.refreshToken.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { tenantId } })
    await prisma.tenant.delete({ where: { id: tenantId } })

    return { deleted: true, code: tenant.code, name: tenant.name }
  })
}
