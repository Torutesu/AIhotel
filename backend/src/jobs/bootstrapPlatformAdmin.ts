import { config } from '../lib/config.js'
import { logger } from '../utils/logger.js'
import { disconnectDatabase } from '../services/healthService.js'
import { bootstrapPlatformAdminService } from '../services/usersService.js'

// 本番の最初の運営（PLATFORM_ADMIN）アカウントを作る 1 回きりのジョブ（docs/deploy-runbook.md §3-4）。
//
//   BOOTSTRAP_PLATFORM_ADMIN_EMAIL=... BOOTSTRAP_PLATFORM_ADMIN_PASSWORD=... \
//     node dist/jobs/bootstrapPlatformAdmin.js
//
// seed（デモアカウント・既知パスワード）は本番に投入しないため、空の DB に最初の運営を作る経路が
// これ以外に無い。冪等: 運営が既に 1 人でもいれば何もせず終了コード 0。入力不正・重複メールは
// 終了コード 1。パスワードはログにもレスポンスにも出さない。

async function main(): Promise<number> {
  const email = config.BOOTSTRAP_PLATFORM_ADMIN_EMAIL
  const password = config.BOOTSTRAP_PLATFORM_ADMIN_PASSWORD
  if (!email || !password) {
    logger.error(
      'BOOTSTRAP_PLATFORM_ADMIN_EMAIL と BOOTSTRAP_PLATFORM_ADMIN_PASSWORD を環境変数で渡してください'
    )
    return 1
  }
  const result = await bootstrapPlatformAdminService({
    email,
    password,
    name: config.BOOTSTRAP_PLATFORM_ADMIN_NAME,
  })
  if (result.created) {
    logger.info({ userId: result.user.id, email: result.user.email }, '運営アカウントを作成しました')
  } else {
    logger.info(
      { existingPlatformAdmins: result.existingPlatformAdmins },
      '運営アカウントは既に存在するため何もしませんでした'
    )
  }
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
