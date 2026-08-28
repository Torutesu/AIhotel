import nodemailer, { type Transporter } from 'nodemailer'
import { config } from './config.js'
import { logger } from '../utils/logger.js'

// メール送信の抽象化（SAAS_DECISIONS.md D-04）。
//
// 特定のメール配信サービスに依存しないよう SMTP で実装する。
// Resend / Brevo / Amazon SES / Mailgun など主要サービスはすべて SMTP を提供しており、
// 無料枠を使い切った場合や条件が変わった場合も、環境変数の差し替えだけで移行できる。
//
// ドライバ:
//   log  … 送信せずログに出力するだけ（ローカル開発。アカウント登録が不要）
//   smtp … 実際に送信する（本番・ステージング）

export interface MailMessage {
  to: string
  subject: string
  /** プレーンテキスト本文。HTMLメールは配信到達率とメンテ性の都合で当面採用しない */
  text: string
}

interface MailDriver {
  send(message: MailMessage): Promise<void>
}

/** 送信せずログに出力する。ローカル開発と自動テスト用 */
class LogMailDriver implements MailDriver {
  async send(message: MailMessage): Promise<void> {
    logger.info(
      { to: message.to, subject: message.subject, body: message.text },
      '[MAIL_DRIVER=log] メールを送信したものとして扱います（実際には送信していません）'
    )
  }
}

class SmtpMailDriver implements MailDriver {
  private transporter: Transporter

  constructor() {
    if (!config.SMTP_HOST) {
      // 設定不備のまま起動させない（フォールバック禁止の方針に従う）
      throw new Error('MAIL_DRIVER=smtp には SMTP_HOST が必要です')
    }
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      // 465 は接続時からTLS、587 は STARTTLS で暗号化する
      secure: config.SMTP_PORT === 465,
      auth:
        config.SMTP_USER && config.SMTP_PASSWORD
          ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
          : undefined,
    })
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: config.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
    })
  }
}

let driver: MailDriver | null = null

function getDriver(): MailDriver {
  if (!driver) {
    driver = config.MAIL_DRIVER === 'smtp' ? new SmtpMailDriver() : new LogMailDriver()
  }
  return driver
}

/**
 * メールを送信する。
 * 送信失敗は呼び出し元に伝播させる（招待メールが届かないまま
 * 「送信しました」と表示するのを避けるため）。
 */
export async function sendMail(message: MailMessage): Promise<void> {
  await getDriver().send(message)
}
