import { config } from '../lib/config.js'
import { logger } from '../utils/logger.js'
import { disconnectDatabase } from '../services/healthService.js'
import { createOrResetPlatformAdminService } from '../services/bootstrapService.js'

// 運営（PLATFORM_ADMIN）アカウントの作成・パスワードの再発行。コンテナでは `job create-platform-admin`。
// BOOTSTRAP_ADMIN_EMAIL のアカウントを作り（既にあればパスワードを発行し直し）、パスワードを標準出力に1回だけ出す。
// 初回ログインでパスワードの変更を求められる。ジョブのログは見終わったら消すか、閲覧できる人を限ること。

async function main(): Promise<number> {
  if (!config.BOOTSTRAP_ADMIN_EMAIL) {
    logger.error('BOOTSTRAP_ADMIN_EMAIL を設定してから実行してください')
    return 64
  }
  const { created, password } = await createOrResetPlatformAdminService(config.BOOTSTRAP_ADMIN_EMAIL)
  // パスワードは pino の redact を通さず、ここでだけ出す（ログの検索には残さない想定の1行）
  process.stdout.write(
    `\n運営アカウントを${created ? '作成' : '再発行'}しました\n` +
      `  メールアドレス: ${config.BOOTSTRAP_ADMIN_EMAIL}\n` +
      `  パスワード: ${password}\n` +
      '  （初回ログインで新しいパスワードの設定を求められます）\n\n'
  )
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    logger.error({ err: error }, '運営アカウントの作成に失敗しました')
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase()
  })
