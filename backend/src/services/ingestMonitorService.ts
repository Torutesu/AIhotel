import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { BadRequestError, NotFoundError } from '../middlewares/errorHandler.js'
import { validateConnectorConfig } from '../lib/ingestConnectors.js'
import type { UpsertIngestSchedulesInput } from '../lib/validators.js'

// ======================================
// 取込の自動連携モニタリング（F-ING-01 — 仕様書Ⅲ章3.2/3.4）
//
// 設計方針: 取得側（クローラ / SC連携 / 手動アップロード）が何であっても、
// システム側は「期待した時刻までにデータが届いたか」だけを監視する。
// これにより取得手段が確定していなくても自動運用の監視を先に立ち上げられる
// （docs/pms-ingest-design.md §A-0）。
// ======================================

export type IngestFreshness = 'OK' | 'WAITING' | 'LATE' | 'NEVER' | 'FAILED'

export interface IngestSourceStatus {
  source: string
  profileId: string | null
  enabled: boolean
  /** 期待到着時刻 HH:MM（timeZone基準） */
  expectedAt: string
  /** expectedAt を解釈するタイムゾーン */
  timeZone: string
  /** 自動取得の方式。null は「外部からのpush待ち（監視のみ）」 */
  connector: string | null
  /** 直近にコネクタを実行した時刻 */
  lastRunAt: string | null
  graceMinutes: number
  status: IngestFreshness
  lastSuccessAt: string | null
  lastAttemptAt: string | null
  lastError: string | null
  /** 未着と判定した理由（UI表示用） */
  message: string
}

const DEFAULT_TIME_ZONE = 'Asia/Tokyo'

/**
 * 指定タイムゾーンのUTCオフセット(ms)。
 * サーバのローカル時刻（コンテナはUTC）に判定を依存させないため自前で求める。
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number.parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10)

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  )
  // ミリ秒はformatToPartsに含まれないので切り落として比較する
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/** now と同じ「現地の日付」の HH:MM を表す瞬間（UTC基準のDate）を返す */
export function zonedTodayAt(now: Date, hhmm: string, timeZone: string = DEFAULT_TIME_ZONE): Date {
  const [h, m] = hhmm.split(':').map((v) => Number.parseInt(v, 10))
  const offset = zoneOffsetMs(now, timeZone)

  // オフセットを足すと「現地の壁時計」をUTCフィールドとして読めるようになる
  const local = new Date(now.getTime() + offset)
  const wallClock = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    h || 0,
    m || 0,
    0,
    0
  )

  // 目的の瞬間のオフセットが now と違う（夏時間の切替を跨ぐ）場合は取り直す
  let instant = wallClock - offset
  const offsetAtTarget = zoneOffsetMs(new Date(instant), timeZone)
  if (offsetAtTarget !== offset) instant = wallClock - offsetAtTarget

  return new Date(instant)
}

/**
 * 期待時刻・猶予・最終成功時刻から鮮度を判定する。純関数（テスト対象）。
 *
 * 期待時刻は「ホテル現地時間」なので、サーバのローカル時刻ではなく
 * スケジュールの timeZone で解釈する。
 *
 * - 最終成功が「本日の期待時刻」以降 → OK
 * - まだ期待時刻＋猶予を過ぎていない → WAITING
 * - 過ぎているのに本日分が未着 → LATE（一度も成功が無ければ NEVER）
 * - 直近の試行が失敗で終わっている → FAILED
 */
export function evaluateFreshness(params: {
  now: Date
  expectedAt: string
  timeZone?: string
  graceMinutes: number
  lastSuccessAt: Date | null
  lastAttemptAt: Date | null
  lastAttemptFailed: boolean
}): { status: IngestFreshness; message: string } {
  const { now, expectedAt, graceMinutes, lastSuccessAt, lastAttemptAt, lastAttemptFailed } = params

  const expected = zonedTodayAt(now, expectedAt, params.timeZone ?? DEFAULT_TIME_ZONE)
  const deadline = new Date(expected.getTime() + graceMinutes * 60_000)

  if (lastSuccessAt && lastSuccessAt >= expected) {
    return { status: 'OK', message: `本日 ${expectedAt} 以降に取込済み` }
  }

  // 期限内に失敗している場合は、未着より先に失敗を知らせる
  if (lastAttemptFailed && lastAttemptAt && lastAttemptAt >= expected) {
    return { status: 'FAILED', message: '直近の取込が失敗しています' }
  }

  if (now < deadline) {
    return {
      status: 'WAITING',
      message: `${expectedAt}（猶予${graceMinutes}分）までの到着待ち`,
    }
  }

  if (!lastSuccessAt) {
    return { status: 'NEVER', message: 'まだ一度も取り込まれていません' }
  }

  return {
    status: 'LATE',
    message: `本日分が未着（最終取込: ${formatInZone(lastSuccessAt, params.timeZone ?? DEFAULT_TIME_ZONE)}）`,
  }
}

/** 現地時間で "YYYY-MM-DD HH:MM" 表示（UTC表記でユーザを混乱させないため） */
function formatInZone(date: Date, timeZone: string): string {
  const shifted = new Date(date.getTime() + zoneOffsetMs(date, timeZone))
  return shifted.toISOString().slice(0, 16).replace('T', ' ')
}

/**
 * 取込状況の一覧（監視画面・アラート判定用）
 */
export async function getIngestStatusService(hotelId: string, now = new Date()) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const schedules = await prisma.ingestSchedule.findMany({
    where: { hotelId },
    orderBy: { source: 'asc' },
  })

  const sources = schedules.length > 0 ? schedules.map((s) => s.source) : []
  const logs =
    sources.length > 0
      ? await prisma.ingestLog.findMany({
          where: { hotelId, source: { in: sources } },
          orderBy: { createdAt: 'desc' },
          take: 200,
        })
      : []

  const items: IngestSourceStatus[] = schedules.map((schedule) => {
    const sourceLogs = logs.filter((l) => l.source === schedule.source)
    const lastAttempt = sourceLogs[0] ?? null
    const lastSuccess = sourceLogs.find((l) => l.status === 'SUCCESS') ?? null

    const { status, message } = schedule.enabled
      ? evaluateFreshness({
          now,
          expectedAt: schedule.expectedAt,
          timeZone: schedule.timeZone,
          graceMinutes: schedule.graceMinutes,
          lastSuccessAt: lastSuccess?.finishedAt ?? lastSuccess?.createdAt ?? null,
          lastAttemptAt: lastAttempt?.finishedAt ?? lastAttempt?.createdAt ?? null,
          lastAttemptFailed: lastAttempt?.status === 'FAILED',
        })
      : { status: 'OK' as IngestFreshness, message: '監視は無効です' }

    return {
      source: schedule.source,
      profileId: schedule.profileId,
      enabled: schedule.enabled,
      expectedAt: schedule.expectedAt,
      timeZone: schedule.timeZone,
      connector: schedule.connector,
      lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
      graceMinutes: schedule.graceMinutes,
      status,
      lastSuccessAt: (lastSuccess?.finishedAt ?? lastSuccess?.createdAt)?.toISOString() ?? null,
      lastAttemptAt: (lastAttempt?.finishedAt ?? lastAttempt?.createdAt)?.toISOString() ?? null,
      lastError: lastAttempt?.status === 'FAILED' ? lastAttempt.error : null,
      message,
    }
  })

  return {
    hotelId,
    checkedAt: now.toISOString(),
    /** 1件でも未着・失敗があるか（ダッシュボードのバッジ用） */
    hasProblem: items.some((i) => i.status === 'LATE' || i.status === 'NEVER' || i.status === 'FAILED'),
    items,
  }
}

/**
 * 取込スケジュールの一括設定（MANAGER以上・監査対象）
 */
export async function upsertIngestSchedulesService(input: UpsertIngestSchedulesInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  // 方式ごとの設定は保存前に検証する（実行時まで誤りに気づけないと未着として現れてしまう）
  for (const item of input.items) {
    if (!item.connector) continue
    try {
      validateConnectorConfig(item.connector, item.connectorConfig ?? {})
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new BadRequestError(`${item.source} の取得設定が不正です: ${detail}`)
    }
  }

  const results = await prisma.$transaction(
    input.items.map((item) =>
      prisma.ingestSchedule.upsert({
        where: { hotelId_source: { hotelId: input.hotelId, source: item.source } },
        create: {
          tenantId: hotel.tenantId,
          hotelId: input.hotelId,
          source: item.source,
          profileId: item.profileId ?? null,
          expectedAt: item.expectedAt,
          timeZone: item.timeZone ?? DEFAULT_TIME_ZONE,
          graceMinutes: item.graceMinutes ?? 60,
          enabled: item.enabled ?? true,
          connector: item.connector ?? null,
          connectorConfig: (item.connectorConfig ?? Prisma.DbNull) as Prisma.InputJsonValue,
        },
        update: {
          profileId: item.profileId ?? null,
          expectedAt: item.expectedAt,
          timeZone: item.timeZone ?? DEFAULT_TIME_ZONE,
          graceMinutes: item.graceMinutes ?? 60,
          enabled: item.enabled ?? true,
          connector: item.connector ?? null,
          connectorConfig: (item.connectorConfig ?? Prisma.DbNull) as Prisma.InputJsonValue,
        },
      })
    )
  )

  return { upserted: results.length, tenantId: hotel.tenantId }
}
