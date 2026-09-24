import { config } from '../lib/config.js'
import { mailer, type Mailer } from '../lib/mailer.js'
import { logger } from '../utils/logger.js'

// アカウント運用のメール（#89）。招待（新規ユーザーの一時パスワード）と、管理者による一時パスワードの再発行。
//
// 一時パスワードは次回ログイン時に変更を強制される（User.mustChangePassword）ので、
// メールに載るのは「最初の1回だけ使える」値。リンク方式のリセット（公開エンドポイント）は作らない —
// AGENTS.md が公開を認めているのは /auth/login・/auth/refresh・ヘルスチェックだけのため。

export type TemporaryPasswordMailKind = 'invite' | 'reset'

export interface TemporaryPasswordMail {
  kind: TemporaryPasswordMailKind
  to: string
  name: string
  temporaryPassword: string
}

export function buildTemporaryPasswordMail(
  mail: TemporaryPasswordMail,
  loginUrl: string
): { subject: string; text: string } {
  const intro =
    mail.kind === 'invite'
      ? 'AIレベニュー管理システムのアカウントが作成されました。'
      : '管理者があなたのアカウントの一時パスワードを発行しました。以前のパスワードと、ログイン中の端末のセッションは無効になっています。'
  const subject =
    mail.kind === 'invite'
      ? '【AIレベニュー管理】アカウントのご案内'
      : '【AIレベニュー管理】一時パスワードのお知らせ'
  const text = [
    `${mail.name} 様`,
    '',
    intro,
    '',
    `ログイン画面: ${loginUrl}`,
    `メールアドレス: ${mail.to}`,
    `一時パスワード: ${mail.temporaryPassword}`,
    '',
    'ログインすると新しいパスワードの設定を求められます。',
    'お心当たりのない場合は、このメールを破棄し、所属先の管理者にお知らせください。',
  ].join('\n')
  return { subject, text }
}

/**
 * 一時パスワードをメールで本人に送る。送れたら true。
 * メール送信が無効、または送信に失敗したときは false を返し、呼び出し側は一時パスワードを
 * 画面で管理者に1回だけ見せる（従来どおりの代替手段）。失敗で操作全体を失敗にはしない。
 */
export async function sendTemporaryPasswordMail(
  mail: TemporaryPasswordMail,
  deps: { mailer?: Mailer; loginUrl?: string } = {}
): Promise<boolean> {
  const m = deps.mailer ?? mailer
  if (!m.enabled) return false
  const { subject, text } = buildTemporaryPasswordMail(mail, deps.loginUrl ?? config.appPublicUrl)
  try {
    await m.send({ to: mail.to, subject, text })
    return true
  } catch (error) {
    // 本文（一時パスワード）はログに出さない
    logger.warn(
      { kind: mail.kind, to: mail.to, err: error instanceof Error ? error.message : String(error) },
      '一時パスワードのメール送信に失敗しました（画面での伝達に切り替えます）'
    )
    return false
  }
}
