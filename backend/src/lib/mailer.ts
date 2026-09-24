import nodemailer, { type Transporter } from 'nodemailer'
import { config } from './config.js'

// メール送信の抽象化層（#89, #21）。
//
// storage.ts と同じ思想で、送り方（SMTP・送信しない・テスト用のメモリ）を config で差し替える。
// 呼び出し側（services/accountMailService.ts）は Mailer インターフェースだけに依存する。
// クラウド固有のメール API（SES・SendGrid 等の SDK）は使わず、どこでも使える SMTP に統一する（#21 の推奨）。

export interface MailMessage {
  to: string
  subject: string
  text: string
}

export interface Mailer {
  /** 送信できる設定かどうか。false なら呼び出し側は画面で伝えるなどの代替手段を取る */
  readonly enabled: boolean
  send(message: MailMessage): Promise<void>
}

/** 送信しない（既定）。send を呼ぶのは呼び出し側の誤りなので投げる */
class DisabledMailer implements Mailer {
  readonly enabled = false
  async send(): Promise<void> {
    throw new Error('メール送信が設定されていません（MAIL_DRIVER=none）')
  }
}

/** 送信内容をプロセス内に貯めるだけ（テスト用。本番では config が拒否する） */
export class MemoryMailer implements Mailer {
  readonly enabled = true
  readonly sent: MailMessage[] = []
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message)
  }
}

type SmtpTransport = Pick<Transporter, 'sendMail'>

export class SmtpMailer implements Mailer {
  readonly enabled = true
  constructor(
    private readonly transport: SmtpTransport,
    private readonly from: string
  ) {}

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text })
  }
}

function createMailer(): Mailer {
  switch (config.MAIL_DRIVER) {
    case 'none':
      return new DisabledMailer()
    case 'memory':
      return new MemoryMailer()
    case 'smtp': {
      // 必須項目は config の superRefine で検証済み
      const transport = nodemailer.createTransport({
        host: config.SMTP_HOST!,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS! } } : {}),
      })
      return new SmtpMailer(transport, config.MAIL_FROM!)
    }
    default: {
      const exhaustiveCheck: never = config.MAIL_DRIVER
      throw new Error(`未対応の MAIL_DRIVER です: ${exhaustiveCheck}`)
    }
  }
}

export const mailer: Mailer = createMailer()
