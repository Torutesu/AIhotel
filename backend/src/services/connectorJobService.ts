import { createHash } from 'node:crypto'
import type { AgentDevice, Prisma, SyncJob } from '@prisma/client'
import type {
  ClaimedJob,
  ReadJobPayload,
  ReadResultData,
  SyncErrorCode,
  SyncPriceRankItem,
  SyncTarget,
  WriteJobPayload,
  WriteVerification,
} from '@hotel-revenue-system/shared/types'
import { prisma } from '../lib/prisma.js'
import { storage } from '../lib/storage.js'
import { logger } from '../utils/logger.js'
import { NotFoundError, BadRequestError, ConflictError } from '../middlewares/errorHandler.js'
import { checkWriteGuardrails, DEFAULT_GUARDRAILS } from '../lib/guardrails.js'
import {
  JOB_LEASE_MS,
  READ_MAX_ATTEMPTS,
  WRITE_MAX_ATTEMPTS,
  SNAPSHOT_RETENTION_MS,
  decideFailureHandling,
  type FailureDecision,
} from '../lib/connectorPolicy.js'
import { notifyOps, resolveOps } from './opsNotifierService.js'

// コネクタジョブキュー（docs/コネクタ連携設計.md §4, §5, §10）。
// Pull型: エージェントがクレームし、リース期限内に結果を報告する。
// WRITEの安全装置（ガードレール・凍結・NEEDS_REVIEW）はここで一元的に適用する。

// ======================================
// ジョブ生成
// ======================================

export interface CreateSyncJobInput {
  hotelId: string
  target: SyncTarget
  direction: 'READ' | 'WRITE'
  payload: ReadJobPayload | WriteJobPayload
  dryRun?: boolean
  priority?: number
  expiresAt?: Date
  requestedById?: string
}

function payloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16)
}

/**
 * 同期ジョブを作成する。定常運用ではスケジューラ/価格確定ロジックが呼び、
 * 手動作成（再実行・臨時READ）は管理APIから呼ばれる。
 * 同一内容のジョブが未完了で存在する場合は新規作成せずそれを返す（冪等）。
 */
export async function createSyncJob(input: CreateSyncJobInput): Promise<SyncJob> {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  if (input.direction === 'WRITE') {
    const state = await prisma.hotelSyncState.findUnique({ where: { hotelId: input.hotelId } })
    if (state?.writeFrozen) {
      throw new ConflictError(
        `このホテルの自動書き込みは凍結中です${state.writeFrozenReason ? `（${state.writeFrozenReason}）` : ''}`
      )
    }

    const writePayload = input.payload as WriteJobPayload
    if (writePayload.kind !== 'PRICE_RANKS' || !Array.isArray(writePayload.items)) {
      throw new BadRequestError('WRITEジョブのpayloadが不正です')
    }

    // ガードレール検査（§15）— 現在値はシステムが把握している PriceRank を基準にする
    const currentRanks = await prisma.priceRank.findMany({
      where: { hotelId: input.hotelId, isActive: true },
    })
    const currentByRank = new Map<number, SyncPriceRankItem>(
      currentRanks.map((r) => [
        r.rank,
        { rank: r.rank, label: r.label, price1P: r.price1P, price2P: r.price2P, price3P: r.price3P, price4P: r.price4P },
      ])
    )
    const guard = checkWriteGuardrails(writePayload.items, currentByRank, DEFAULT_GUARDRAILS)
    if (!guard.ok) {
      await notifyOps({
        tenantId: hotel.tenantId,
        hotelId: input.hotelId,
        eventKey: 'GUARDRAIL_VIOLATION',
        severity: 'SEV1',
        title: 'ガードレール違反の書き込みジョブ生成をブロックしました',
        message: guard.violations.map((v) => `rank=${v.rank ?? '-'} ${v.field ?? ''}: ${v.reason}`).join(' / '),
      })
      throw new BadRequestError(
        'ガードレール違反のため書き込みジョブを作成できません',
        guard.violations.map((v) => ({ field: `rank:${v.rank ?? '-'}${v.field ? `.${v.field}` : ''}`, message: v.reason }))
      )
    }

    // エージェントが書き込み直前に前提値照合できるよう現在値を payload に埋め込む（§11 同時操作競合）
    writePayload.expectedCurrent = writePayload.items
      .map((item) => currentByRank.get(item.rank))
      .filter((v): v is SyncPriceRankItem => v !== undefined)
  }

  const idempotencyKey = `${input.direction}:${input.target}:${input.hotelId}:${payloadHash(input.payload)}`

  const existing = await prisma.syncJob.findUnique({ where: { idempotencyKey } })
  if (existing && ['PENDING', 'RUNNING'].includes(existing.status)) {
    return existing
  }
  if (existing) {
    // 完了済みの同一キーは再実行として新キーを振る（タイムスタンプ付与）
    return prisma.syncJob.create({
      data: buildJobData(input, hotel.tenantId, `${idempotencyKey}:${Date.now()}`),
    })
  }
  return prisma.syncJob.create({ data: buildJobData(input, hotel.tenantId, idempotencyKey) })
}

function buildJobData(
  input: CreateSyncJobInput,
  tenantId: string,
  idempotencyKey: string
): Prisma.SyncJobUncheckedCreateInput {
  return {
    tenantId,
    hotelId: input.hotelId,
    target: input.target,
    direction: input.direction,
    idempotencyKey,
    payload: input.payload as unknown as Prisma.InputJsonValue,
    dryRun: input.dryRun ?? false,
    priority: input.priority ?? 0,
    maxAttempts: input.direction === 'WRITE' ? WRITE_MAX_ATTEMPTS : READ_MAX_ATTEMPTS,
    expiresAt: input.expiresAt ?? null,
    requestedById: input.requestedById ?? null,
  }
}

// ======================================
// クレーム（リース方式） / リース延長
// ======================================

/**
 * デバイスに次のジョブを1件割り当てる。リース付きRUNNINGへ原子的に遷移させ、
 * 二重実行を構造的に防ぐ。割当対象が無ければ null。
 */
export async function claimNextJob(device: AgentDevice): Promise<ClaimedJob | null> {
  const now = new Date()
  const state = await prisma.hotelSyncState.findUnique({ where: { hotelId: device.hotelId } })

  // 最大3回試行（同時クレームの競合対策）
  for (let i = 0; i < 3; i++) {
    const candidate = await prisma.syncJob.findFirst({
      where: {
        hotelId: device.hotelId,
        status: 'PENDING',
        OR: [{ notBefore: null }, { notBefore: { lte: now } }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
        // 凍結中はWRITEを配らない（READは継続 — §13.6）
        ...(state?.writeFrozen ? { direction: 'READ' as const } : {}),
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    })
    if (!candidate) return null

    const leaseExpiresAt = new Date(now.getTime() + JOB_LEASE_MS)
    const claimed = await prisma.syncJob.updateMany({
      where: { id: candidate.id, status: 'PENDING' },
      data: {
        status: 'RUNNING',
        deviceId: device.id,
        leaseExpiresAt,
        attemptCount: { increment: 1 },
        startedAt: now,
      },
    })
    if (claimed.count === 1) {
      return {
        id: candidate.id,
        target: candidate.target,
        direction: candidate.direction,
        payload: candidate.payload as unknown as ReadJobPayload | WriteJobPayload,
        dryRun: candidate.dryRun,
        attemptCount: candidate.attemptCount + 1,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
      }
    }
  }
  return null
}

/**
 * 実行中ジョブのリースを延長する（長時間ジョブ用）
 */
export async function extendJobLease(jobId: string, device: AgentDevice): Promise<Date> {
  const leaseExpiresAt = new Date(Date.now() + JOB_LEASE_MS)
  const result = await prisma.syncJob.updateMany({
    where: { id: jobId, deviceId: device.id, hotelId: device.hotelId, status: 'RUNNING' },
    data: { leaseExpiresAt },
  })
  if (result.count === 0) throw new NotFoundError('実行中のジョブ')
  return leaseExpiresAt
}

// ======================================
// 結果報告
// ======================================

export interface JobResultInput {
  status: 'DONE' | 'FAILED' | 'NEEDS_REVIEW'
  errorCode?: SyncErrorCode
  errorMessage?: string
  readData?: ReadResultData
  writeVerification?: WriteVerification
}

/**
 * ジョブの実行結果を受理する。
 * READ成功はPriceRankへのupsert（取込）まで行い、失敗は connectorPolicy の判断に従って
 * リトライ／終局化／凍結／開発側通知を行う。
 */
export async function reportJobResult(
  jobId: string,
  device: AgentDevice,
  input: JobResultInput
): Promise<{ status: string }> {
  const job = await prisma.syncJob.findFirst({
    where: { id: jobId, hotelId: device.hotelId, deviceId: device.id, status: 'RUNNING' },
  })
  if (!job) throw new NotFoundError('実行中のジョブ')

  if (input.status === 'DONE') {
    if (job.direction === 'READ') {
      if (!input.readData) throw new BadRequestError('READ結果にはreadDataが必要です')
      await ingestReadResult(job, input.readData)
    } else {
      await completeWriteJob(job, input.writeVerification)
    }
    return { status: 'DONE' }
  }

  // FAILED / NEEDS_REVIEW
  const errorCode: SyncErrorCode = input.errorCode ?? 'UNKNOWN'
  const decision: FailureDecision =
    input.status === 'NEEDS_REVIEW'
      ? {
          nextStatus: 'NEEDS_REVIEW',
          freezeWrites: job.direction === 'WRITE',
          notify: {
            eventKey: errorCode,
            severity: 'SEV1',
            title: 'エージェントが自動続行不能と判断しました（開発側対応が必要）',
          },
        }
      : decideFailureHandling({
          direction: job.direction,
          errorCode,
          attemptCount: job.attemptCount,
          maxAttempts: job.maxAttempts,
        })

  await applyFailureDecision(job, decision, errorCode, input.errorMessage)
  return { status: decision.nextStatus }
}

async function ingestReadResult(job: SyncJob, readData: ReadResultData): Promise<void> {
  const capturedAt = new Date(readData.capturedAt)

  await prisma.$transaction(async (tx) => {
    for (const item of readData.items) {
      await tx.priceRank.upsert({
        where: { hotelId_rank: { hotelId: job.hotelId, rank: item.rank } },
        create: {
          tenantId: job.tenantId,
          hotelId: job.hotelId,
          rank: item.rank,
          label: item.label ?? `R${String(item.rank).padStart(2, '0')}`,
          price1P: item.price1P,
          price2P: item.price2P,
          price3P: item.price3P ?? null,
          price4P: item.price4P ?? null,
        },
        update: {
          ...(item.label ? { label: item.label } : {}),
          price1P: item.price1P,
          price2P: item.price2P,
          price3P: item.price3P ?? null,
          price4P: item.price4P ?? null,
          isActive: true,
        },
      })
    }

    await tx.hotelSyncState.upsert({
      where: { hotelId: job.hotelId },
      create: {
        tenantId: job.tenantId,
        hotelId: job.hotelId,
        lastSuccessfulReadAt: capturedAt,
        consecutiveReadFails: 0,
      },
      update: { lastSuccessfulReadAt: capturedAt, consecutiveReadFails: 0 },
    })

    await tx.syncJob.update({
      where: { id: job.id },
      data: {
        status: 'DONE',
        finishedAt: new Date(),
        result: {
          ingestedItems: readData.items.length,
          capturedAt: readData.capturedAt,
        } as unknown as Prisma.InputJsonValue,
      },
    })
  })

  // 取得が回復したので関連する停止系事象を解決通知する（§14.4）
  for (const eventKey of ['STALE_READ_12H', 'STALE_READ_24H', 'READ_FAILING', 'SELECTOR_MISMATCH']) {
    await resolveOps(job.hotelId, eventKey, '料金ランクの取得が回復しました')
  }
}

async function completeWriteJob(job: SyncJob, verification?: WriteVerification): Promise<void> {
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.syncJob.update({
      where: { id: job.id },
      data: {
        status: 'DONE',
        finishedAt: now,
        result: (verification ?? null) as unknown as Prisma.InputJsonValue,
      },
    })
    if (!job.dryRun) {
      await tx.hotelSyncState.upsert({
        where: { hotelId: job.hotelId },
        create: { tenantId: job.tenantId, hotelId: job.hotelId, lastSuccessfulWriteAt: now },
        update: { lastSuccessfulWriteAt: now },
      })
    }
  })
  await resolveOps(job.hotelId, 'VERIFY_MISMATCH', '書き込みが検証込みで成功しました')
  await resolveOps(job.hotelId, 'WRITE_LEASE_EXPIRED', '書き込みが検証込みで成功しました')
}

/**
 * 失敗判断（connectorPolicy）を適用する。スイープのリース回収からも使う。
 */
export async function applyFailureDecision(
  job: SyncJob,
  decision: FailureDecision,
  errorCode: string,
  errorMessage?: string
): Promise<void> {
  const now = new Date()
  await prisma.syncJob.update({
    where: { id: job.id },
    data: {
      status: decision.nextStatus,
      errorCode,
      errorMessage: errorMessage ?? null,
      ...(decision.nextStatus === 'PENDING'
        ? {
            deviceId: null,
            leaseExpiresAt: null,
            notBefore: new Date(now.getTime() + (decision.retryDelayMs ?? 60_000)),
          }
        : { finishedAt: now }),
    },
  })

  // READの終局失敗は連続失敗カウントを進める（デッドマン検知 §14 の入力）
  if (job.direction === 'READ' && ['FAILED', 'NEEDS_REVIEW'].includes(decision.nextStatus)) {
    await prisma.hotelSyncState.upsert({
      where: { hotelId: job.hotelId },
      create: { tenantId: job.tenantId, hotelId: job.hotelId, consecutiveReadFails: 1 },
      update: { consecutiveReadFails: { increment: 1 } },
    })
  }

  if (decision.freezeWrites) {
    await setWriteFrozen(job.hotelId, job.tenantId, true, `自動凍結: ${errorCode}（job ${job.id}）`)
  }

  if (decision.notify) {
    await notifyOps({
      tenantId: job.tenantId,
      hotelId: job.hotelId,
      eventKey: decision.notify.eventKey,
      severity: decision.notify.severity,
      title: decision.notify.title,
      message: errorMessage ?? errorCode,
      jobId: job.id,
    })
  }
}

// ======================================
// 凍結スイッチ / 状態参照
// ======================================

/**
 * 凍結スイッチの手動操作（管理APIから）。ホテル存在確認と tenantId 解決を含む。
 */
export async function setWriteFrozenForHotel(
  hotelId: string,
  frozen: boolean,
  reason?: string
): Promise<{ tenantId: string }> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { tenantId: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  await setWriteFrozen(hotelId, hotel.tenantId, frozen, reason)
  return { tenantId: hotel.tenantId }
}

export async function setWriteFrozen(
  hotelId: string,
  tenantId: string,
  frozen: boolean,
  reason?: string
): Promise<void> {
  await prisma.hotelSyncState.upsert({
    where: { hotelId },
    create: { tenantId, hotelId, writeFrozen: frozen, writeFrozenReason: frozen ? (reason ?? null) : null },
    update: { writeFrozen: frozen, writeFrozenReason: frozen ? (reason ?? null) : null },
  })
  logger.info({ hotelId, frozen, reason }, frozen ? '自動WRITEを凍結しました' : '自動WRITEの凍結を解除しました')
}

/**
 * 連携ステータス（管理UI「連携ステータス」ウィジェット用 — §14）
 */
export async function getSyncStatus(hotelId: string) {
  const [state, devices, recentJobs, openAlerts] = await Promise.all([
    prisma.hotelSyncState.findUnique({ where: { hotelId } }),
    prisma.agentDevice.findMany({
      where: { hotelId, revokedAt: null },
      select: { id: true, name: true, role: true, lastSeenAt: true, isActive: true, agentVersion: true },
    }),
    prisma.syncJob.findMany({
      where: { hotelId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        target: true,
        direction: true,
        status: true,
        errorCode: true,
        attemptCount: true,
        dryRun: true,
        createdAt: true,
        finishedAt: true,
      },
    }),
    prisma.opsAlertState.findMany({
      where: { hotelId, resolvedAt: null },
      select: { eventKey: true, severity: true, firstFiredAt: true, fireCount: true },
    }),
  ])
  return { state, devices, recentJobs, openAlerts }
}

export async function listSyncJobs(hotelId: string, filter: { status?: string; limit?: number }) {
  return prisma.syncJob.findMany({
    where: {
      hotelId,
      ...(filter.status ? { status: filter.status as SyncJob['status'] } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: filter.limit ?? 50,
  })
}

// ======================================
// 証跡スナップショット（§13）
// ======================================

export interface ArtifactInput {
  kind: 'READ_RAW' | 'PRE_WRITE' | 'POST_WRITE' | 'FAILURE_EVIDENCE'
  contentType: string
  dataBase64: string
  capturedAt: string
  /** エージェント側でCookie等をマスク済みであることの宣言。false は受理しない（§12） */
  sanitized: true
}

export async function saveJobArtifact(jobId: string, device: AgentDevice, input: ArtifactInput) {
  const job = await prisma.syncJob.findFirst({
    where: { id: jobId, hotelId: device.hotelId },
  })
  if (!job) throw new NotFoundError('ジョブ')

  const data = Buffer.from(input.dataBase64, 'base64')
  const ext = input.contentType === 'image/png' ? 'png' : input.contentType === 'application/json' ? 'json' : 'html'
  const storageKey = `connector/${device.hotelId}/${jobId}/${input.kind}-${Date.now()}.${ext}`
  await storage.put(storageKey, data, input.contentType)

  const capturedAt = new Date(input.capturedAt)
  const retention = SNAPSHOT_RETENTION_MS[input.kind] ?? SNAPSHOT_RETENTION_MS.READ_RAW
  return prisma.syncSnapshot.create({
    data: {
      tenantId: job.tenantId,
      hotelId: job.hotelId,
      jobId: job.id,
      target: job.target,
      kind: input.kind,
      storageKey,
      contentType: input.contentType,
      contentHash: createHash('sha256').update(data).digest('hex'),
      sanitized: true,
      capturedAt,
      deleteAfter: new Date(capturedAt.getTime() + retention),
    },
    select: { id: true, storageKey: true, kind: true },
  })
}
