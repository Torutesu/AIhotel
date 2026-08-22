import { prisma } from '../lib/prisma.js'
import { config } from '../lib/config.js'
import { storage } from '../lib/storage.js'
import { logger } from '../utils/logger.js'
import { decideLeaseExpiry, evaluateHotelHealth, shouldScheduleRead } from '../lib/connectorPolicy.js'
import { applyFailureDecision, createSyncJob } from './connectorJobService.js'
import { notifyOps, resolveOps } from './opsNotifierService.js'

// デッドマン方式の定期スイープ（docs/コネクタ連携設計.md §14.1）。
// heartbeat途絶・鮮度SLO超過・リース切れは「報告が来ないこと自体が異常」なので、
// エージェントからのイベントではなくサーバー側の走査でしか検知できない。
// 「取得ができなくなった」の検知はこのスイープが本体であり、エージェントの生存に依存しない。

/**
 * スイープ1回分。cron/setInterval から呼ばれるほか、テスト・手動実行も可能。
 */
export async function runSweepOnce(now: Date = new Date()): Promise<{
  reclaimedLeases: number
  cancelledExpired: number
  hotelsEvaluated: number
  scheduledReads: number
  snapshotsPurged: number
}> {
  const reclaimedLeases = await reclaimExpiredLeases(now)
  const cancelledExpired = await cancelExpiredJobs(now)
  const hotelsEvaluated = await evaluateAllHotels(now)
  const scheduledReads = await scheduleReadJobs(now)
  const snapshotsPurged = await purgeExpiredSnapshots(now)
  return { reclaimedLeases, cancelledExpired, hotelsEvaluated, scheduledReads, snapshotsPurged }
}

/** リース期限切れRUNNINGジョブの回収（§10.4 リース方式） */
async function reclaimExpiredLeases(now: Date): Promise<number> {
  const expired = await prisma.syncJob.findMany({
    where: { status: 'RUNNING', leaseExpiresAt: { lt: now } },
  })
  for (const job of expired) {
    const decision = decideLeaseExpiry({
      direction: job.direction,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
    })
    await applyFailureDecision(job, decision, 'LEASE_EXPIRED', 'リース期限内に結果報告がありませんでした')
    logger.warn({ jobId: job.id, direction: job.direction, next: decision.nextStatus }, 'リース切れジョブを回収しました')
  }
  return expired.length
}

/** 期限切れPENDINGジョブのキャンセル（陳腐化した価格を書かない — §4 expiresAt） */
async function cancelExpiredJobs(now: Date): Promise<number> {
  const result = await prisma.syncJob.updateMany({
    where: { status: 'PENDING', expiresAt: { lt: now } },
    data: { status: 'CANCELLED', errorCode: 'EXPIRED', finishedAt: now },
  })
  return result.count
}

/** ホテルごとの健全性評価（鮮度SLO・全デバイス途絶・READ連続失敗） */
async function evaluateAllHotels(now: Date): Promise<number> {
  // 連携が構成されているホテル = HotelSyncState かデバイスが存在するホテル
  const states = await prisma.hotelSyncState.findMany()
  const devices = await prisma.agentDevice.findMany({
    where: { revokedAt: null, isActive: true },
    select: { hotelId: true, tenantId: true, lastSeenAt: true },
  })

  const hotelIds = new Set<string>([...states.map((s) => s.hotelId), ...devices.map((d) => d.hotelId)])
  const stateByHotel = new Map(states.map((s) => [s.hotelId, s]))

  for (const hotelId of hotelIds) {
    const state = stateByHotel.get(hotelId)
    const hotelDevices = devices.filter((d) => d.hotelId === hotelId)
    const tenantId = state?.tenantId ?? hotelDevices[0]?.tenantId
    if (!tenantId) continue

    const health = evaluateHotelHealth({
      now,
      lastSuccessfulReadAt: state?.lastSuccessfulReadAt ?? null,
      consecutiveReadFails: state?.consecutiveReadFails ?? 0,
      deviceLastSeenAts: hotelDevices.map((d) => d.lastSeenAt),
    })

    for (const directive of health.fire) {
      await notifyOps({
        tenantId,
        hotelId,
        eventKey: directive.eventKey,
        severity: directive.severity,
        title: directive.title,
        message: `最終取得成功: ${state?.lastSuccessfulReadAt?.toISOString() ?? 'なし'}`,
      })
    }
    for (const eventKey of health.resolve) {
      await resolveOps(hotelId, eventKey, '状態が正常範囲に回復しました')
    }
  }
  return hotelIds.size
}

/**
 * 定期READジョブの自動生成（無人運転の心臓部 — §2, §14.1）。
 * エージェントが稼働しているホテルに対し、鮮度が readIntervalMinutes を超えたら
 * READジョブを生成する。失敗が続く場合は READ_RESCHEDULE_COOLDOWN_MS を空けて
 * 対象システムへのアクセス頻度を抑える（ブロック誘発の予防）。
 */
async function scheduleReadJobs(now: Date): Promise<number> {
  // 対象 = アクティブなデバイスが1台以上あるホテル（エージェント未導入は対象外）
  const devices = await prisma.agentDevice.findMany({
    where: { revokedAt: null, isActive: true },
    select: { hotelId: true },
    distinct: ['hotelId'],
  })

  let scheduled = 0
  for (const { hotelId } of devices) {
    const [state, openReadJob, lastReadJob] = await Promise.all([
      prisma.hotelSyncState.findUnique({ where: { hotelId } }),
      prisma.syncJob.findFirst({
        where: { hotelId, direction: 'READ', status: { in: ['PENDING', 'RUNNING'] } },
        select: { id: true },
      }),
      prisma.syncJob.findFirst({
        where: { hotelId, direction: 'READ' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ])

    const due = shouldScheduleRead({
      now,
      autoReadEnabled: state?.autoReadEnabled ?? true,
      readIntervalMinutes: state?.readIntervalMinutes ?? 360,
      lastSuccessfulReadAt: state?.lastSuccessfulReadAt ?? null,
      hasOpenReadJob: openReadJob !== null,
      lastReadJobCreatedAt: lastReadJob?.createdAt ?? null,
    })
    if (!due) continue

    try {
      // 現状の定常READ対象はリンカーンのみ（ねほっぷすのREADは反映確認用で定常取得しない — §1）
      const job = await createSyncJob({
        hotelId,
        target: 'LINCOLN',
        direction: 'READ',
        payload: { kind: 'PRICE_RANKS' },
      })
      scheduled += 1
      logger.info({ hotelId, jobId: job.id }, '定期READジョブを生成しました')
    } catch (error) {
      logger.error({ err: error, hotelId }, '定期READジョブの生成に失敗しました')
    }
  }
  return scheduled
}

/** 保持期限切れスナップショットの削除（§4 deleteAfter） */
async function purgeExpiredSnapshots(now: Date): Promise<number> {
  const expired = await prisma.syncSnapshot.findMany({
    where: { deleteAfter: { lt: now } },
    select: { id: true, storageKey: true },
    take: 200, // 1回のスイープでの削除上限（長時間ロックを避ける）
  })
  for (const snap of expired) {
    try {
      await storage.delete(snap.storageKey)
      await prisma.syncSnapshot.delete({ where: { id: snap.id } })
    } catch (error) {
      logger.error({ err: error, snapshotId: snap.id }, 'スナップショットの削除に失敗しました')
    }
  }
  return expired.length
}

let sweepTimer: NodeJS.Timeout | null = null

/**
 * スイープスケジューラを開始する（index.ts から呼ぶ）。
 * CONNECTOR_SWEEP_ENABLED=true のときのみ動作する。
 */
export function startSweepScheduler(): void {
  if (!config.connectorSweepEnabled) {
    logger.info('コネクタスイープは無効です（CONNECTOR_SWEEP_ENABLED=false）')
    return
  }
  const run = () => {
    runSweepOnce().catch((error) => {
      logger.error({ err: error }, 'コネクタスイープの実行に失敗しました')
    })
  }
  run()
  sweepTimer = setInterval(run, config.CONNECTOR_SWEEP_INTERVAL_MS)
  sweepTimer.unref() // スイープがプロセス終了を妨げないようにする
  logger.info({ intervalMs: config.CONNECTOR_SWEEP_INTERVAL_MS }, 'コネクタスイープを開始しました')
}

export function stopSweepScheduler(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
}
