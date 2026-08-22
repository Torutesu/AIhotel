import { prisma } from '../lib/prisma.js'
import { config } from '../lib/config.js'
import { logger } from '../utils/logger.js'
import type { OpsSeverity } from '../lib/connectorPolicy.js'

// 開発側通知（Ops Alerting — docs/コネクタ連携設計.md §14）。
// 無人運転の成立条件は「取得・反映が止まったことを開発側が確実に・すぐ知れること」。
// 通知の一次宛先は開発側（Slack Webhook）で、テナントUIの Alert は補助表示。
// hotel × 事象種別で dedupe し、クールダウンで鳴りっぱなしを防ぐ（§14.4）。

export type { OpsSeverity }

export interface OpsEvent {
  tenantId: string
  hotelId: string
  eventKey: string // 例: AUTH_FAILED / STALE_READ_12H / ALL_DEVICES_DOWN / VERIFY_MISMATCH
  severity: OpsSeverity
  title: string
  message: string
  jobId?: string
}

// 深刻度別クールダウン（同一事象の再通知間隔）。状態変化（回復・悪化）時は別途通知する
export const NOTIFY_COOLDOWN_MS: Record<OpsSeverity, number> = {
  SEV1: 60 * 60 * 1000, // 1時間
  SEV2: 6 * 60 * 60 * 1000, // 6時間
  SEV3: 24 * 60 * 60 * 1000, // 日次ダイジェスト相当
}

/**
 * 通知を送るべきか判定する純関数（テスト対象）。
 * - 初回発火・回復後の再発火は必ず送る
 * - 継続中の同一事象はクールダウン内なら抑制する
 */
export function shouldNotify(
  prev: { lastNotifiedAt: Date | null; resolvedAt: Date | null } | null,
  severity: OpsSeverity,
  now: Date
): boolean {
  if (!prev) return true // 初回
  if (prev.resolvedAt) return true // 一度回復した後の再発
  if (!prev.lastNotifiedAt) return true
  return now.getTime() - prev.lastNotifiedAt.getTime() >= NOTIFY_COOLDOWN_MS[severity]
}

async function sendToChannels(payload: {
  severity: OpsSeverity
  title: string
  lines: string[]
}): Promise<void> {
  // 構造化ログには常に出す（通知経路が死んでいても痕跡を残す — §14.4）
  const logFn = payload.severity === 'SEV1' ? logger.error : logger.warn
  logFn.call(logger, { opsAlert: payload }, `[OpsAlert ${payload.severity}] ${payload.title}`)

  if (!config.OPS_SLACK_WEBHOOK_URL) return
  try {
    const res = await fetch(config.OPS_SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `[${payload.severity}] ${payload.title}\n${payload.lines.join('\n')}`,
      }),
    })
    if (!res.ok) {
      logger.error({ status: res.status }, 'Slack通知の送信に失敗しました（次回スイープで再通知されます）')
    }
  } catch (error) {
    logger.error({ err: error }, 'Slack通知の送信に失敗しました（次回スイープで再通知されます）')
  }
}

/**
 * 開発側に事象を通知する。dedupe状態（OpsAlertState）を更新し、
 * クールダウン判定を通った場合のみ実送信する。
 */
export async function notifyOps(event: OpsEvent): Promise<void> {
  const now = new Date()
  const prev = await prisma.opsAlertState.findUnique({
    where: { hotelId_eventKey: { hotelId: event.hotelId, eventKey: event.eventKey } },
  })

  const willSend = shouldNotify(prev, event.severity, now)

  if (prev) {
    await prisma.opsAlertState.update({
      where: { id: prev.id },
      data: {
        severity: event.severity,
        lastFiredAt: now,
        fireCount: { increment: 1 },
        // 回復済みだった事象の再発はアクティブ状態に戻す
        resolvedAt: null,
        ...(willSend ? { lastNotifiedAt: now } : {}),
        ...(prev.resolvedAt ? { firstFiredAt: now, fireCount: 1 } : {}),
      },
    })
  } else {
    await prisma.opsAlertState.create({
      data: {
        tenantId: event.tenantId,
        hotelId: event.hotelId,
        eventKey: event.eventKey,
        severity: event.severity,
        firstFiredAt: now,
        lastFiredAt: now,
        lastNotifiedAt: willSend ? now : null,
      },
    })
  }

  // テナントUIの Alert（補助表示）。SEV3 はダッシュボードに出さない
  if (willSend && event.severity !== 'SEV3') {
    try {
      await prisma.alert.create({
        data: {
          tenantId: event.tenantId,
          hotelId: event.hotelId,
          severity: event.severity === 'SEV1' ? 'RED' : 'YELLOW',
          level: event.severity === 'SEV1' ? 5 : 4,
          title: `[連携] ${event.title}`,
          message: event.message,
        },
      })
    } catch (error) {
      logger.error({ err: error }, '連携AlertのDB記録に失敗しました')
    }
  }

  if (willSend) {
    await sendToChannels({
      severity: event.severity,
      title: event.title,
      lines: [
        event.message,
        `hotelId: ${event.hotelId} / event: ${event.eventKey}`,
        ...(event.jobId ? [`jobId: ${event.jobId}`] : []),
      ],
    })
  }
}

/**
 * 事象の回復を記録し、解決通知を送る（§14.4 —「直ったかどうか分からない」を残さない）。
 * アクティブな同一事象が無ければ何もしない。
 */
export async function resolveOps(hotelId: string, eventKey: string, message: string): Promise<void> {
  const now = new Date()
  const prev = await prisma.opsAlertState.findUnique({
    where: { hotelId_eventKey: { hotelId, eventKey } },
  })
  if (!prev || prev.resolvedAt) return

  await prisma.opsAlertState.update({
    where: { id: prev.id },
    data: { resolvedAt: now, lastNotifiedAt: now },
  })

  if (prev.severity !== 'SEV3') {
    await sendToChannels({
      severity: prev.severity as OpsSeverity,
      title: `回復: ${eventKey}`,
      lines: [message, `hotelId: ${hotelId}`],
    })
  }
}
