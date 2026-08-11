import { prisma } from '../lib/prisma.js'
import { logger } from '../utils/logger.js'
import { findProfile } from '../lib/ingestProfiles.js'
import {
  fetchByConnector,
  archiveLocalFile,
  type FetchedFile,
  type IngestConnectorKindValue,
} from '../lib/ingestConnectors.js'
import { ingestFileService } from './fileIngestService.js'
import type { IngestDataset } from '../lib/ingestProfiles.js'

// ======================================
// 自動取込ランナー（docs/pms-ingest-design.md §A-3）
//
// 「人がアップロードする」ではなく「バックエンドが取りに行く」ための実行部。
// 取得方式の差は lib/ingestConnectors.ts に、列名の差は取込プロファイルに閉じてあるので、
// ここは方式もPMSの種類も知らずに、取得 → 重複判定 → 既存の取込サービスへ委譲、だけを行う。
// ======================================

export type RunOutcome = 'INGESTED' | 'SKIPPED_DUPLICATE' | 'NOTHING_TO_FETCH' | 'PUSH_ONLY' | 'FAILED'

export interface RunFileResult {
  fileName: string
  origin: string
  outcome: RunOutcome
  rowCount?: number
  message?: string
}

export interface RunScheduleResult {
  source: string
  outcome: RunOutcome
  files: RunFileResult[]
  message?: string
}

/** ファイル名から断面日（capturedDate）を読む。YYYY-MM-DD / YYYYMMDD の両方に対応 */
export function capturedDateFromFileName(fileName: string): string | null {
  const hyphen = fileName.match(/(20\d{2})-(\d{2})-(\d{2})/)
  if (hyphen) return `${hyphen[1]}-${hyphen[2]}-${hyphen[3]}`
  const compact = fileName.match(/(20\d{2})(\d{2})(\d{2})/)
  if (compact) {
    const [, y, m, d] = compact
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}-${m}-${d}`
    }
  }
  return null
}

/** 現地日付（YYYY-MM-DD）。断面日をサーバのタイムゾーンでずらさないため */
export function localDateString(now: Date, timeZone: string): string {
  // en-CA のロケール表記が YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(now)
}

/**
 * 同じ内容のファイルを既に取り込んでいるか。
 * 監視ディレクトリを繰り返し走査しても二重計上しないための歯止め。
 */
async function isAlreadyIngested(
  hotelId: string,
  source: string,
  checksum: string
): Promise<boolean> {
  const existing = await prisma.ingestLog.findFirst({
    where: { hotelId, source, checksum, status: { in: ['SUCCESS', 'PARTIAL'] } },
    select: { id: true },
  })
  return existing !== null
}

/** 失敗も必ずログに残す（仕様書Ⅲ章3.5）。ここで握りつぶすと未着検知が誤ってOKになる */
async function logFailure(params: {
  tenantId: string
  hotelId: string
  source: string
  startedAt: Date
  file?: FetchedFile
  error: string
}): Promise<void> {
  try {
    await prisma.ingestLog.create({
      data: {
        tenantId: params.tenantId,
        hotelId: params.hotelId,
        source: params.source,
        status: 'FAILED',
        startedAt: params.startedAt,
        finishedAt: new Date(),
        error: params.error.slice(0, 1000),
        origin: params.file?.origin ?? null,
        checksum: params.file?.checksum ?? null,
      },
    })
  } catch {
    // ログ書き込みの失敗で実行そのものを落とさない
  }
}

/** IngestSchedule.source から取り込む dataset を決める（source は命名規約で dataset を含む） */
export function datasetForSource(source: string): IngestDataset | null {
  if (source.endsWith('nights')) return 'nights'
  if (source.endsWith('reservations')) return 'reservations'
  if (source.endsWith('inventory')) return 'inventory'
  if (source.endsWith('segments')) return 'segments'
  return null
}

type ScheduleRow = {
  id: string
  tenantId: string
  hotelId: string
  source: string
  profileId: string | null
  timeZone: string
  connector: IngestConnectorKindValue | null
  connectorConfig: unknown
}

/**
 * スケジュール1件を実行する。
 * connector が無い（push型）の場合は何もしない ― 監視だけを行う相手も同じ枠で扱えるようにするため。
 */
export async function runScheduleService(
  schedule: ScheduleRow,
  now = new Date()
): Promise<RunScheduleResult> {
  if (!schedule.connector) {
    return {
      source: schedule.source,
      outcome: 'PUSH_ONLY',
      files: [],
      message: '取得は外部から（取込API/手動アップロード）。監視のみ行います',
    }
  }

  const startedAt = new Date()
  const dataset = datasetForSource(schedule.source)
  if (!dataset || !schedule.profileId || !findProfile(schedule.profileId)) {
    const message = !dataset
      ? `source「${schedule.source}」から取込種別を判定できません`
      : `取込プロファイルが未設定または不明です（${schedule.profileId ?? '未設定'}）`
    await logFailure({ ...schedule, startedAt, error: message })
    return { source: schedule.source, outcome: 'FAILED', files: [], message }
  }

  let fetched: FetchedFile[]
  try {
    fetched = await fetchByConnector(schedule.connector, schedule.connectorConfig)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await logFailure({ ...schedule, startedAt, error: `取得に失敗: ${message}` })
    return { source: schedule.source, outcome: 'FAILED', files: [], message }
  }

  if (fetched.length === 0) {
    return { source: schedule.source, outcome: 'NOTHING_TO_FETCH', files: [] }
  }

  const files: RunFileResult[] = []
  for (const file of fetched) {
    if (await isAlreadyIngested(schedule.hotelId, schedule.source, file.checksum)) {
      // 同じ内容なら退避だけして次へ（監視ディレクトリが溜まり続けないように）
      if (schedule.connector === 'LOCAL_DIR') await archiveLocalFile(file.origin).catch(() => {})
      files.push({
        fileName: file.fileName,
        origin: file.origin,
        outcome: 'SKIPPED_DUPLICATE',
        message: '同じ内容を取込済みのためスキップしました',
      })
      continue
    }

    const fileStartedAt = new Date()
    try {
      const result = await ingestFileService(
        {
          hotelId: schedule.hotelId,
          profileId: schedule.profileId,
          dataset,
          fileName: file.fileName,
          contentBase64: file.content.toString('base64'),
          // 断面データはファイル名の日付を優先し、無ければ現地日付を使う
          capturedDate:
            dataset === 'reservations' || dataset === 'inventory'
              ? new Date(
                  `${capturedDateFromFileName(file.fileName) ?? localDateString(now, schedule.timeZone)}T00:00:00.000Z`
                )
              : undefined,
          dryRun: false,
        },
        undefined,
        { origin: file.origin, checksum: file.checksum }
      )

      if (schedule.connector === 'LOCAL_DIR') await archiveLocalFile(file.origin).catch(() => {})
      files.push({
        fileName: file.fileName,
        origin: file.origin,
        outcome: 'INGESTED',
        rowCount: result.acceptedRows,
        message:
          result.rejectedRows > 0 ? `${result.rejectedRows}行を取り込めませんでした` : undefined,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await logFailure({ ...schedule, startedAt: fileStartedAt, file, error: message })
      // 1ファイルの失敗で残りを止めない（1日分だけ壊れたファイルが混ざることがある）
      files.push({ fileName: file.fileName, origin: file.origin, outcome: 'FAILED', message })
    }
  }

  const outcome: RunOutcome = files.some((f) => f.outcome === 'INGESTED')
    ? 'INGESTED'
    : files.some((f) => f.outcome === 'FAILED')
      ? 'FAILED'
      : 'SKIPPED_DUPLICATE'

  return { source: schedule.source, outcome, files }
}

/**
 * 自動取得の対象スケジュールを実行する。
 * hotelId 省略時は全ホテル（スケジューラからの定期実行）。
 */
export async function runIngestConnectorsService(params: {
  hotelId?: string
  source?: string
  now?: Date
}): Promise<{ ranAt: string; results: RunScheduleResult[] }> {
  const now = params.now ?? new Date()
  const schedules = await prisma.ingestSchedule.findMany({
    where: {
      enabled: true,
      connector: { not: null },
      ...(params.hotelId ? { hotelId: params.hotelId } : {}),
      ...(params.source ? { source: params.source } : {}),
    },
    orderBy: [{ hotelId: 'asc' }, { source: 'asc' }],
  })

  const results: RunScheduleResult[] = []
  for (const schedule of schedules) {
    const result = await runScheduleService(schedule as ScheduleRow, now)
    results.push(result)
    await prisma.ingestSchedule
      .update({ where: { id: schedule.id }, data: { lastRunAt: new Date() } })
      .catch(() => {})
  }

  const ingested = results.filter((r) => r.outcome === 'INGESTED').length
  const failed = results.filter((r) => r.outcome === 'FAILED').length
  if (ingested > 0 || failed > 0) {
    logger.info({ ingested, failed, total: results.length }, '自動取込を実行しました')
  }

  return { ranAt: now.toISOString(), results }
}
