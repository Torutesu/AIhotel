import { runRetentionCleanup } from '../services/retentionService.js'
import { logger } from '../utils/logger.js'

// データ保持期間にもとづく掃除の実行スクリプト（SAAS_DECISIONS.md D-06）。
//
// 外部スケジューラ（cron / Cloud Scheduler 等）から1日1回程度呼ぶ想定:
//   pnpm --filter backend db:cleanup
//
// ジョブ基盤やクラウド固有のサービスには依存しない。

async function main() {
  const startedAt = Date.now()
  const result = await runRetentionCleanup()

  const totals = result.tenants.reduce(
    (acc, t) => ({
      auditLogs: acc.auditLogs + t.auditLogs,
      alerts: acc.alerts + t.alerts,
      aiComments: acc.aiComments + t.aiComments,
      kpiSnapshots: acc.kpiSnapshots + t.kpiSnapshots,
      dailyData: acc.dailyData + t.dailyData,
    }),
    { auditLogs: 0, alerts: 0, aiComments: 0, kpiSnapshots: 0, dailyData: 0 }
  )

  logger.info(
    {
      durationMs: Date.now() - startedAt,
      tenants: result.tenants.length,
      expiredRefreshTokens: result.expiredRefreshTokens,
      expiredUserTokens: result.expiredUserTokens,
      ...totals,
    },
    'データ保持期間にもとづく掃除が完了しました'
  )
}

main()
  .catch((error) => {
    logger.fatal({ err: error }, 'データ掃除に失敗しました')
    process.exit(1)
  })
  .then(() => process.exit(0))
