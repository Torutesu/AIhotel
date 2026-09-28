import { randomBytes } from 'node:crypto'
import type { TrialKind } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { config } from '../lib/config.js'
import { hashPassword } from '../lib/auth.js'
import { DEFAULT_WEEKEND_DAYS, todayJst } from '../lib/date.js'
import { BadRequestError, ConflictError, NotFoundError } from '../middlewares/errorHandler.js'
import { generateTemporaryPassword } from './usersService.js'
import { populateDemoHotelData } from './demoDataService.js'
import { logger } from '../utils/logger.js'

// トライアル（デモ）アカウントの管理。運営（PLATFORM_ADMIN）専用 API から呼ぶ。
//
// 販売店・営業先ホテルに渡すため、トライアル1件ごとに専用のテナントとデモホテル（デモデータ入り）を作る。
// テナントが分かれているので、触られても他のトライアルや本番の顧客には影響しない（#62 のテナント分離そのまま）。
// 期限（Tenant.trialExpiresAt）を過ぎるとログイン・API 利用ができなくなる（authService.isTrialExpired）。
// 期限から TRIAL_RETENTION_DAYS 日たったテナントは日次バッチが削除する（延長の依頼に備えてすぐには消さない）。

export const TRIAL_DEFAULT_DAYS = 30
export const TRIAL_MAX_DAYS = 90
export const TRIAL_RETENTION_DAYS = 30

const DAY_MS = 86_400_000

export type TrialStatus = 'ACTIVE' | 'EXPIRED' | 'SUSPENDED'

export interface TrialSummary {
  id: string
  name: string
  kind: TrialKind
  note: string | null
  status: TrialStatus
  expiresAt: string
  /** 残り日数（切り上げ）。期限切れなら 0 */
  daysLeft: number
  /** 期限切れのとき、自動削除される日時 */
  purgeAt: string | null
  loginEmail: string | null
  lastLoginAt: string | null
  createdAt: string
}

type TrialTenantRow = {
  id: string
  name: string
  isActive: boolean
  trialKind: TrialKind | null
  trialExpiresAt: Date | null
  trialNote: string | null
  createdAt: Date
  users: Array<{ email: string; lastLoginAt: Date | null }>
}

export function toTrialSummary(tenant: TrialTenantRow, now: Date = new Date()): TrialSummary {
  const expiresAt = tenant.trialExpiresAt as Date
  const expired = expiresAt <= now
  const status: TrialStatus = !tenant.isActive ? 'SUSPENDED' : expired ? 'EXPIRED' : 'ACTIVE'
  // 最終ログインは、所属ユーザーのうち最も新しいもの
  const lastLoginAt = tenant.users
    .map((u) => u.lastLoginAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime())[0]
  return {
    id: tenant.id,
    name: tenant.name,
    kind: tenant.trialKind as TrialKind,
    note: tenant.trialNote,
    status,
    expiresAt: expiresAt.toISOString(),
    daysLeft: expired ? 0 : Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS),
    purgeAt: expired ? new Date(expiresAt.getTime() + TRIAL_RETENTION_DAYS * DAY_MS).toISOString() : null,
    loginEmail: tenant.users[0]?.email ?? null,
    lastLoginAt: lastLoginAt?.toISOString() ?? null,
    createdAt: tenant.createdAt.toISOString(),
  }
}

const TRIAL_SELECT = {
  id: true,
  name: true,
  isActive: true,
  trialKind: true,
  trialExpiresAt: true,
  trialNote: true,
  createdAt: true,
  // 発行時に作る管理者ユーザーを先頭にする（ログイン ID として表示する）
  users: { select: { email: true, lastLoginAt: true }, orderBy: { createdAt: 'asc' as const } },
}

async function findTrial(id: string) {
  const tenant = await prisma.tenant.findFirst({ where: { id, trialKind: { not: null } }, select: TRIAL_SELECT })
  if (!tenant) throw new NotFoundError('トライアル')
  return tenant
}

/** トライアルの一覧（期限の近い順） */
export async function listTrialsService(now: Date = new Date()): Promise<TrialSummary[]> {
  const tenants = await prisma.tenant.findMany({
    where: { trialKind: { not: null } },
    select: TRIAL_SELECT,
    orderBy: { trialExpiresAt: 'asc' },
  })
  return tenants.map((t) => toTrialSummary(t, now))
}

export interface CreateTrialInput {
  name: string
  kind: TrialKind
  days?: number
  note?: string | null
  /** 省略すると trial-xxxxxx@TRIAL_LOGIN_DOMAIN を自動で作る */
  loginEmail?: string
}

/**
 * トライアルの発行。専用のテナント・デモホテル・管理者ユーザー（ログイン用）を作り、デモデータを入れる。
 * パスワードはこの戻り値で1回だけ返す（DB にはハッシュしか残らない）
 */
export async function createTrialService(
  input: CreateTrialInput,
  now: Date = new Date()
): Promise<{ trial: TrialSummary; password: string }> {
  const days = input.days ?? TRIAL_DEFAULT_DAYS
  const suffix = randomBytes(4).toString('hex')
  const code = `trial-${suffix}`
  const loginEmail = input.loginEmail ?? `trial-${suffix}@${config.TRIAL_LOGIN_DOMAIN}`

  if (await prisma.user.findUnique({ where: { email: loginEmail } })) {
    throw new ConflictError('このログイン ID は既に使われています')
  }

  const password = generateTemporaryPassword()
  const passwordHash = await hashPassword(password)

  const { tenantId, hotelId } = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        code,
        name: input.name,
        trialKind: input.kind,
        trialExpiresAt: new Date(now.getTime() + days * DAY_MS),
        trialNote: input.note ?? null,
      },
    })
    const hotel = await tx.hotel.create({
      data: {
        tenantId: tenant.id,
        name: 'デモホテル東京',
        address: '東京都千代田区丸の内1-1-1',
        totalRooms: 200,
        weekendDays: [...DEFAULT_WEEKEND_DAYS],
        hotelType: 'FULL_SERVICE',
        prefectureCode: '13',
        municipalityCode: '131016',
        marketArea: '丸の内',
      },
    })
    await tx.user.create({
      data: {
        email: loginEmail,
        password: passwordHash,
        name: input.name,
        role: 'ADMIN',
        tenantId: tenant.id,
        hotelId: hotel.id,
      },
    })
    return { tenantId: tenant.id, hotelId: hotel.id }
  })

  // デモデータは件数が多いのでトランザクションの外で入れる。失敗したらテナントごと消して、やり直せるようにする
  try {
    await populateDemoHotelData(prisma, { tenantId, hotelId, today: todayJst(now) })
  } catch (error) {
    logger.error({ tenantId, err: error }, 'トライアルのデモデータの作成に失敗したため、発行を取り消します')
    await deleteTenantCompletely(tenantId)
    throw error
  }

  return { trial: toTrialSummary(await findTrial(tenantId), now), password }
}

export interface UpdateTrialInput {
  name?: string
  note?: string | null
  /** false で停止（期限内でも使えなくする）、true で再開 */
  isActive?: boolean
  /** 期限を延ばす日数。期限切れなら今日から数える */
  extendDays?: number
}

export async function updateTrialService(
  id: string,
  input: UpdateTrialInput,
  now: Date = new Date()
): Promise<{ before: TrialSummary; after: TrialSummary }> {
  const current = await findTrial(id)
  const before = toTrialSummary(current, now)

  let trialExpiresAt: Date | undefined
  if (input.extendDays !== undefined) {
    const base = Math.max(now.getTime(), (current.trialExpiresAt as Date).getTime())
    trialExpiresAt = new Date(base + input.extendDays * DAY_MS)
    if (trialExpiresAt.getTime() - now.getTime() > TRIAL_MAX_DAYS * DAY_MS) {
      throw new BadRequestError(`期限は今日から${TRIAL_MAX_DAYS}日以内にしてください`)
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.note !== undefined && { trialNote: input.note }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(trialExpiresAt && { trialExpiresAt }),
      },
    })
    // 停止したら、ログイン中の端末もすぐに切る
    if (input.isActive === false) await tx.refreshToken.deleteMany({ where: { tenantId: id } })
  })
  return { before, after: toTrialSummary(await findTrial(id), now) }
}

/** ログイン用パスワードの再発行。新しいパスワードはこの戻り値で1回だけ返す */
export async function resetTrialPasswordService(id: string): Promise<{ trial: TrialSummary; password: string }> {
  await findTrial(id)
  const user = await prisma.user.findFirst({ where: { tenantId: id }, orderBy: { createdAt: 'asc' } })
  if (!user) throw new NotFoundError('トライアルのログインユーザー')

  const password = generateTemporaryPassword()
  const passwordHash = await hashPassword(password)
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { password: passwordHash, failedLoginCount: 0, lockedUntil: null, isActive: true },
    }),
    prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
  ])
  return { trial: toTrialSummary(await findTrial(id)), password }
}

/**
 * テナントとその中身をすべて消す。ユーザー・リフレッシュトークン・監査ログはテナントの削除に連動しないため先に消し、
 * 残り（ホテル・実績・予測など）はテナントの削除に連動して消える（onDelete: Cascade）
 */
async function deleteTenantCompletely(tenantId: string): Promise<void> {
  await prisma.$transaction([
    prisma.refreshToken.deleteMany({ where: { tenantId } }),
    prisma.auditLog.deleteMany({ where: { tenantId } }),
    prisma.user.deleteMany({ where: { tenantId } }),
    prisma.tenant.delete({ where: { id: tenantId } }),
  ])
}

export async function deleteTrialService(id: string): Promise<TrialSummary> {
  const trial = toTrialSummary(await findTrial(id))
  await deleteTenantCompletely(id)
  return trial
}

/** 期限から TRIAL_RETENTION_DAYS 日たったトライアルを削除する（日次バッチ） */
export async function purgeExpiredTrialsService(now: Date = new Date()): Promise<{ deleted: number }> {
  const threshold = new Date(now.getTime() - TRIAL_RETENTION_DAYS * DAY_MS)
  const stale = await prisma.tenant.findMany({
    where: { trialKind: { not: null }, trialExpiresAt: { lt: threshold } },
    select: { id: true },
  })
  for (const { id } of stale) await deleteTenantCompletely(id)
  return { deleted: stale.length }
}
