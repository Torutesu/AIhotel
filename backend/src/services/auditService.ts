import { prisma } from '../lib/prisma.js'
import { logger } from '../utils/logger.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import type { AuditLogQuery } from '../lib/validators.js'

export interface AuditLogEntry {
  tenantId?: string | null
  userId?: string | null
  action:
    | 'CREATE'
    | 'UPDATE'
    | 'DELETE'
    | 'LOGIN'
    | 'LOGOUT'
    | 'LOGIN_FAILED'
    // リフレッシュトークンの再利用検知（#49-4）。全トークン失効を伴う
    | 'TOKEN_REUSE_DETECTED'
    // 連続失敗によるアカウントのロック（#78）
    | 'ACCOUNT_LOCKED'
    // 本人によるパスワード変更・管理者による一時パスワードの発行（#89）。パスワード自体は記録しない
    | 'PASSWORD_CHANGED'
    | 'PASSWORD_RESET'
  entity: string
  entityId?: string | null
  oldValue?: unknown
  newValue?: unknown
  ipAddress?: string
  userAgent?: string
}

/**
 * 監査ログを書き込む（要件定義書 §6 監査性）。
 * 監査ログの失敗で本処理を失敗させないため、エラーはログ出力に留める。
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: entry.tenantId ?? null,
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        oldValue: entry.oldValue === undefined ? undefined : JSON.parse(JSON.stringify(entry.oldValue)),
        newValue: entry.newValue === undefined ? undefined : JSON.parse(JSON.stringify(entry.newValue)),
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    })
  } catch (error) {
    // 監査ログの失敗で本処理を失敗させないが、握り潰さず必ず warn として残す（S-6）
    logger.warn(
      {
        err: error,
        entry: {
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          tenantId: entry.tenantId ?? null,
          userId: entry.userId ?? null,
        },
      },
      '監査ログの書き込みに失敗しました'
    )
  }
}

/**
 * 監査ログの閲覧（#89）。指定したホテルが属するテナントのログだけを新しい順に返す。
 *
 * テナントの管理者が操作履歴・ログイン失敗・ロック・トークン再利用の検知を確認するためのもの。
 * 監査ログはテナント単位で書いているので、ホテル単位ではなくテナント単位で絞る
 * （ホテルに紐づかない操作 — ユーザー管理など — も見えるようにする）。
 * ページネーションは (createdAt, id) の降順に対するカーソル方式。
 */
export async function listAuditLogsService(query: AuditLogQuery) {
  const hotel = await prisma.hotel.findFirst({
    where: { id: query.hotelId, isActive: true },
    select: { tenantId: true },
  })
  if (!hotel) throw new NotFoundError('ホテル')

  const createdAt: { gte?: Date; lt?: Date } = {}
  if (query.from) createdAt.gte = new Date(`${query.from}T00:00:00+09:00`)
  if (query.to) {
    const end = new Date(`${query.to}T00:00:00+09:00`)
    end.setUTCDate(end.getUTCDate() + 1)
    createdAt.lt = end
  }

  const rows = await prisma.auditLog.findMany({
    where: {
      tenantId: hotel.tenantId,
      ...(query.action && { action: query.action }),
      ...((query.from || query.to) && { createdAt }),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
    include: { user: { select: { name: true, email: true } } },
  })

  const hasMore = rows.length > query.limit
  const items = hasMore ? rows.slice(0, query.limit) : rows
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null }
}
