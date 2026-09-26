import { parseArgs } from 'node:util'
import { logger } from '../utils/logger.js'
import { disconnectDatabase } from '../services/healthService.js'
import { createPlatformAdminService } from '../services/authService.js'
import { sendTemporaryPasswordMail } from '../services/accountMailService.js'
import { createPlatformAdminSchema } from '../lib/validators.js'

// 最初の運営（PLATFORM_ADMIN）を作る1回限りのジョブ（R-2-5）。
//
//   コンテナ: job create-platform-admin --email ops@example.com --name "運営 太郎"
//   開発時:   pnpm --filter backend job:create-platform-admin --email ... --name ...
//
// 一時パスワードを発行し、初回ログインで変更を求める。MAIL_DRIVER=smtp なら本人にメールで届け、
// 標準出力には出さない。メールが無効・失敗なら標準出力に1回だけ表示する（ログ基盤に残る点に注意。
// 初回ログインで必ず変わるので、ログに残った値は使えなくなる）。
// 2人目以降の運営は、画面（ユーザー管理）から運営が作る。

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' } },
    strict: true,
  })
  const parsed = createPlatformAdminSchema.safeParse(values)
  if (!parsed.success) {
    const details = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
    console.error(`[create-platform-admin] 使い方: --email <メールアドレス> --name <名前>（${details}）`)
    return 64
  }

  const { user, temporaryPassword } = await createPlatformAdminService(parsed.data)
  const emailSent = await sendTemporaryPasswordMail({
    kind: 'invite',
    to: user.email,
    name: user.name,
    temporaryPassword,
  })

  logger.info({ userId: user.id, email: user.email, emailSent }, '運営（PLATFORM_ADMIN）を作成しました')
  if (!emailSent) {
    // 一時パスワードはロガーに渡さない（構造化ログの転送先に項目として残らないようにする）
    console.log(`一時パスワード（初回ログインで変更を求められます）: ${temporaryPassword}`)
  }
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[create-platform-admin] 作成できませんでした: ${message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase()
  })
