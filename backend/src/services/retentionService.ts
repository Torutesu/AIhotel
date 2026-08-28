import { AlertStatus } from '@prisma/client'
import { prisma, runWithRlsBypass, runWithTenant } from '../lib/prisma.js'
import { logger } from '../utils/logger.js'

// データ保持期間にもとづく掃除（SAAS_DECISIONS.md D-06）。
//
// 保持期間はテナントごとに設定できる（顧客ごとに内部統制の要求が異なるため）。
// 期限切れトークンだけはテナント設定によらず即座に削除する（残す理由がないため）。
//
// 定期実行は外部のスケジューラ（cron / Cloud Scheduler 等）から
// `pnpm --filter backend db:cleanup` を呼ぶ想定。ジョブ基盤には依存しない。

export interface TenantCleanupResult {
  tenantId: string
  tenantName: string
  auditLogs: number
  alerts: number
  aiComments: number
  kpiSnapshots: number
  dailyData: number
}

export interface CleanupResult {
  expiredRefreshTokens: number
  expiredUserTokens: number
  tenants: TenantCleanupResult[]
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

/**
 * 期限切れの認証トークンを削除する。
 * 保持しても使えないデータなので、テナント設定によらず一律で消す。
 */
async function cleanupExpiredTokens(): Promise<{ refreshTokens: number; userTokens: number }> {
  return runWithRlsBypass(async () => {
    const now = new Date()
    const refreshTokens = await prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: now } },
    })
    // 招待・リセットトークンは、期限切れか使用済みのものを消す
    const userTokens = await prisma.userToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
    })
    return { refreshTokens: refreshTokens.count, userTokens: userTokens.count }
  })
}

/**
 * 1テナント分の掃除。テナントコンテキスト内で実行するため、
 * 万一条件を誤っても他テナントのデータには触れられない（D-01）。
 */
async function cleanupTenant(tenant: {
  id: string
  name: string
  auditLogRetentionDays: number
  operationalDataRetentionDays: number
  dailyDataRetentionDays: number | null
}): Promise<TenantCleanupResult> {
  return runWithTenant(tenant.id, async () => {
    const auditCutoff = daysAgo(tenant.auditLogRetentionDays)
    const operationalCutoff = daysAgo(tenant.operationalDataRetentionDays)

    const auditLogs = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: auditCutoff } },
    })

    // 未対応のアラートは古くても残す（対応漏れを消してしまわないため）
    const alerts = await prisma.alert.deleteMany({
      where: { createdAt: { lt: operationalCutoff }, status: AlertStatus.RESOLVED },
    })
    const aiComments = await prisma.aiComment.deleteMany({
      where: { createdAt: { lt: operationalCutoff } },
    })
    const kpiSnapshots = await prisma.kpiSnapshot.deleteMany({
      where: { createdAt: { lt: operationalCutoff } },
    })

    // 日次実績は収益の元帳にあたるため、明示的に日数を設定したテナントのみ削除する
    let dailyData = 0
    if (tenant.dailyDataRetentionDays != null) {
      const result = await prisma.dailyData.deleteMany({
        where: { date: { lt: daysAgo(tenant.dailyDataRetentionDays) } },
      })
      dailyData = result.count
    }

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      auditLogs: auditLogs.count,
      alerts: alerts.count,
      aiComments: aiComments.count,
      kpiSnapshots: kpiSnapshots.count,
      dailyData,
    }
  })
}

/** 全テナントの掃除を実行する */
export async function runRetentionCleanup(): Promise<CleanupResult> {
  const tokens = await cleanupExpiredTokens()

  const tenants = await runWithRlsBypass(() =>
    prisma.tenant.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        auditLogRetentionDays: true,
        operationalDataRetentionDays: true,
        dailyDataRetentionDays: true,
      },
    })
  )

  const results: TenantCleanupResult[] = []
  for (const tenant of tenants) {
    try {
      results.push(await cleanupTenant(tenant))
    } catch (error) {
      // 1テナントの失敗で全体を止めない
      logger.error({ err: error, tenantId: tenant.id }, 'テナントの掃除に失敗しました')
    }
  }

  return {
    expiredRefreshTokens: tokens.refreshTokens,
    expiredUserTokens: tokens.userTokens,
    tenants: results,
  }
}
