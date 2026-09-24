import { describe, it, expect, vi } from 'vitest'
import { MemoryMailer, SmtpMailer, type Mailer } from '../lib/mailer.js'
import { buildTemporaryPasswordMail, sendTemporaryPasswordMail } from './accountMailService.js'

// 招待・一時パスワードのメール（#89）。実際の SMTP には繋がない

const MAIL = { kind: 'invite' as const, to: 'new@example.com', name: '新人 太郎', temporaryPassword: 'Abcdefgh2345' }

describe('buildTemporaryPasswordMail', () => {
  it('招待と再発行で件名を分け、ログイン URL・アドレス・一時パスワードを載せる', () => {
    const invite = buildTemporaryPasswordMail(MAIL, 'https://app.example.com')
    expect(invite.subject).toContain('アカウントのご案内')
    expect(invite.text).toContain('https://app.example.com')
    expect(invite.text).toContain('new@example.com')
    expect(invite.text).toContain('Abcdefgh2345')

    const reset = buildTemporaryPasswordMail({ ...MAIL, kind: 'reset' }, 'https://app.example.com')
    expect(reset.subject).toContain('一時パスワード')
    expect(reset.text).toContain('セッションは無効')
  })
})

describe('sendTemporaryPasswordMail', () => {
  it('送信できたら true を返し、本人宛てに送る', async () => {
    const mailer = new MemoryMailer()
    expect(await sendTemporaryPasswordMail(MAIL, { mailer, loginUrl: 'https://app.example.com' })).toBe(true)
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0].to).toBe('new@example.com')
  })

  it('メール送信が無効なら送らずに false', async () => {
    const send = vi.fn()
    const disabled: Mailer = { enabled: false, send }
    expect(await sendTemporaryPasswordMail(MAIL, { mailer: disabled })).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('送信に失敗しても投げずに false（画面での伝達に切り替える）', async () => {
    const failing: Mailer = { enabled: true, send: vi.fn().mockRejectedValue(new Error('SMTP down')) }
    expect(await sendTemporaryPasswordMail(MAIL, { mailer: failing })).toBe(false)
  })
})

describe('SmtpMailer', () => {
  it('差出人を付けてトランスポートに渡す', async () => {
    const sendMail = vi.fn().mockResolvedValue({})
    await new SmtpMailer({ sendMail } as never, 'AI <no-reply@example.com>').send({
      to: 'a@example.com',
      subject: 's',
      text: 't',
    })
    expect(sendMail).toHaveBeenCalledWith({ from: 'AI <no-reply@example.com>', to: 'a@example.com', subject: 's', text: 't' })
  })
})
