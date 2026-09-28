import { logger } from '../utils/logger.js'
import { disconnectDatabase } from '../services/healthService.js'
import { seedDemoTenantService } from '../services/bootstrapService.js'

// 検証環境へのデモデータの投入。コンテナでは `job seed-demo`。
// デモテナント・デモホテル・3アカウント（管理者・マネージャー・オペレーター）を作り、デモデータを今日基準で作り直す。
// 新しく作ったアカウントのパスワードだけを標準出力に出す（既存のアカウントのパスワードは変えない）。
// 運営アカウントは作らない（job create-platform-admin を使う）。

seedDemoTenantService()
  .then(({ createdUsers }) => {
    const lines = createdUsers.map((u) => `  ${u.role.padEnd(8)} ${u.email}  パスワード: ${u.password}`)
    process.stdout.write(
      '\nデモデータを投入しました\n' +
        (lines.length > 0 ? `新しく作ったアカウント:\n${lines.join('\n')}\n\n` : 'アカウントは作成済みのため変更していません\n\n')
    )
    process.exitCode = 0
  })
  .catch((error) => {
    logger.error({ err: error }, 'デモデータの投入に失敗しました')
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase()
  })
