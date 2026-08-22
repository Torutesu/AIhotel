import { prisma } from '../lib/prisma.js'
import { logger } from '../utils/logger.js'

export interface AuditLogEntry {
  tenantId?: string | null
  userId?: string | null
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'IMPORT' | 'LOGIN' | 'LOGOUT'
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
    logger.error({ err: error, entry: { action: entry.action, entity: entry.entity } }, '監査ログの書き込みに失敗しました')
  }
}
