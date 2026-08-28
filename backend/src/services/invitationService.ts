import { randomBytes } from 'node:crypto'
import { UserTokenType, type UserRole } from '@prisma/client'
import { prisma, runWithRlsBypass } from '../lib/prisma.js'
import { hashPassword, hashToken } from '../lib/auth.js'
import { config } from '../lib/config.js'
import { sendMail } from '../lib/mailer.js'
import { ApiError } from '../middlewares/errorHandler.js'
import { writeAuditLog } from './auditService.js'

// 招待メールとパスワードリセット（SAAS_DECISIONS.md D-04）。
//
// 初期パスワードを人づてに渡す運用をやめ、本人がリンクから設定する方式にする。
// トークンは生の値を保存せず SHA-256 ハッシュのみを持ち、有効期限と使い捨てを強制する。

/** 招待の有効期限。導入時のやり取りに余裕を持たせる */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** パスワードリセットの有効期限。短く保つ */
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000
/** 同一メールに対して一度に処理するアカウント数の上限（兼務者対策） */
const MAX_ACCOUNTS_PER_EMAIL = 5

interface RequestContext {
  ipAddress?: string
  userAgent?: string
  host?: string
}

/** 生トークンとその保存用ハッシュ */
function createToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url')
  return { raw, hash: hashToken(raw) }
}

/**
 * 招待・リセットのリンク先URLを組み立てる。
 * サブドメイン運用（D-08）ではテナント固有のURLにする
 */
function buildAppUrl(path: string, tenantCode?: string | null): string {
  if (tenantCode && config.APP_BASE_DOMAIN) {
    return `https://${tenantCode}.${config.APP_BASE_DOMAIN}${path}`
  }
  const base = config.APP_PUBLIC_URL || config.FRONTEND_URL
  return `${base.replace(/\/$/, '')}${path}`
}

/**
 * ユーザーを招待する（ADMIN / MANAGER）。
 * パスワードは発行せず、本人がリンクから設定する。
 */
export async function inviteUserService(
  input: { email: string; name: string; role: UserRole; hotelId: string },
  invitedBy: { userId: string },
  ctx?: RequestContext
) {
  const hotel = await prisma.hotel.findUnique({
    where: { id: input.hotelId },
    include: { tenant: { select: { code: true, name: true } } },
  })
  if (!hotel) {
    throw new ApiError(400, '指定されたホテルが見つかりません')
  }

  // メールはテナント単位で一意（D-02）
  const existing = await prisma.user.findFirst({
    where: { email: input.email, tenantId: hotel.tenantId },
  })
  if (existing) {
    throw new ApiError(409, 'このメールアドレスは既にこの組織で登録されています')
  }

  // 本人がリンクから設定するまでログインできないよう、誰も知らないパスワードを入れておく
  const unusablePassword = await hashPassword(randomBytes(32).toString('base64url'))
  const { raw, hash } = createToken()

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        tenantId: hotel.tenantId,
        hotelId: hotel.id,
        email: input.email,
        name: input.name,
        role: input.role,
        password: unusablePassword,
      },
    })
    await tx.userToken.create({
      data: {
        tenantId: hotel.tenantId,
        userId: created.id,
        type: UserTokenType.INVITATION,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
    })
    return created
  })

  const url = buildAppUrl(`/invite?token=${raw}`, hotel.tenant.code)
  await sendMail({
    to: input.email,
    subject: `【${hotel.tenant.name}】レベニュー管理システムへの招待`,
    text:
      `${input.name} 様\n\n` +
      `${hotel.tenant.name}（${hotel.name}）のレベニュー管理システムに招待されました。\n` +
      `以下のリンクからパスワードを設定してご利用ください。\n\n` +
      `${url}\n\n` +
      `このリンクは7日間有効です。期限が切れた場合は管理者に再招待を依頼してください。\n` +
      `心当たりがない場合はこのメールを破棄してください。\n`,
  })

  await writeAuditLog({
    tenantId: hotel.tenantId,
    userId: invitedBy.userId,
    action: 'CREATE',
    entity: 'User',
    entityId: user.id,
    newValue: { email: user.email, name: user.name, role: user.role, invited: true },
    ipAddress: ctx?.ipAddress,
    userAgent: ctx?.userAgent,
  })

  const { password: _, ...safeUser } = user
  return safeUser
}

/** 有効なトークンを取り出す（期限切れ・使用済みは拒否） */
async function consumableToken(rawToken: string, type: UserTokenType) {
  const token = await prisma.userToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: { include: { tenant: { select: { isActive: true } } } } },
  })
  if (!token || token.type !== type || token.usedAt || token.expiresAt < new Date()) {
    throw new ApiError(400, 'リンクが無効か、有効期限が切れています。再度お手続きください')
  }
  if (!token.user.isActive || (token.user.tenant && !token.user.tenant.isActive)) {
    throw new ApiError(400, 'このアカウントは利用できません。管理者にお問い合わせください')
  }
  return token
}

/** パスワードを設定し、トークンを使用済みにして既存セッションを無効化する */
async function applyNewPassword(tokenId: string, userId: string, newPassword: string) {
  const hashed = await hashPassword(newPassword)
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { password: hashed } })
    await tx.userToken.update({ where: { id: tokenId }, data: { usedAt: new Date() } })
    // パスワード変更時は既存のログインセッションをすべて無効化する
    await tx.refreshToken.deleteMany({ where: { userId } })
    // 未使用の招待・リセットトークンも無効化する
    await tx.userToken.updateMany({
      where: { userId, usedAt: null, id: { not: tokenId } },
      data: { usedAt: new Date() },
    })
  })
}

/**
 * 招待を受諾してパスワードを設定する（未認証で呼ばれる）。
 * テナントが確定していないため、この経路のみテナント横断で動作する（D-01 の狭い例外）。
 */
export async function acceptInvitationService(
  rawToken: string,
  password: string,
  ctx?: RequestContext
) {
  return runWithRlsBypass(async () => {
    const token = await consumableToken(rawToken, UserTokenType.INVITATION)
    await applyNewPassword(token.id, token.userId, password)

    await writeAuditLog({
      tenantId: token.tenantId,
      userId: token.userId,
      action: 'UPDATE',
      entity: 'User',
      entityId: token.userId,
      newValue: { passwordSet: true, via: 'invitation' },
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })
    return { email: token.user.email }
  })
}

/**
 * パスワードリセットを要求する（未認証）。
 * アカウントの有無を推測させないため、結果にかかわらず常に成功として返す。
 */
export async function requestPasswordResetService(email: string, ctx?: RequestContext) {
  await runWithRlsBypass(async () => {
    // 兼務者は複数テナントに同じメールを持ちうるため、該当する全アカウントに送る。
    // メール本文で組織名を示すことで、本人がどれか判断できるようにする
    const users = await prisma.user.findMany({
      where: { email, isActive: true },
      include: { tenant: { select: { code: true, name: true, isActive: true } } },
      take: MAX_ACCOUNTS_PER_EMAIL,
    })

    for (const user of users) {
      if (user.tenant && !user.tenant.isActive) continue
      const { raw, hash } = createToken()
      await prisma.userToken.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          type: UserTokenType.PASSWORD_RESET,
          tokenHash: hash,
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      })
      const orgName = user.tenant?.name ?? 'システム管理'
      const url = buildAppUrl(`/reset-password?token=${raw}`, user.tenant?.code)
      await sendMail({
        to: email,
        subject: `【${orgName}】パスワード再設定のご案内`,
        text:
          `${user.name} 様\n\n` +
          `${orgName}のレベニュー管理システムでパスワード再設定が要求されました。\n` +
          `以下のリンクから新しいパスワードを設定してください。\n\n` +
          `${url}\n\n` +
          `このリンクは1時間有効です。\n` +
          `心当たりがない場合はこのメールを破棄してください。パスワードは変更されません。\n`,
      })
    }

    if (users.length === 0) {
      // 存在しないアドレスへの要求。応答は成功と区別できないようにしつつ、記録は残す
      logRequestForUnknownEmail(email, ctx)
    }
  })
}

function logRequestForUnknownEmail(email: string, ctx?: RequestContext) {
  void writeAuditLog({
    action: 'UPDATE',
    entity: 'User',
    newValue: { passwordResetRequestedForUnknownEmail: email },
    ipAddress: ctx?.ipAddress,
    userAgent: ctx?.userAgent,
  })
}

/** リセットトークンで新しいパスワードを設定する（未認証） */
export async function resetPasswordService(
  rawToken: string,
  password: string,
  ctx?: RequestContext
) {
  return runWithRlsBypass(async () => {
    const token = await consumableToken(rawToken, UserTokenType.PASSWORD_RESET)
    await applyNewPassword(token.id, token.userId, password)

    await writeAuditLog({
      tenantId: token.tenantId,
      userId: token.userId,
      action: 'UPDATE',
      entity: 'User',
      entityId: token.userId,
      newValue: { passwordSet: true, via: 'password-reset' },
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })
    return { email: token.user.email }
  })
}
