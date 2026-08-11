import { BadRequestError } from '../middlewares/errorHandler.js'
import {
  findProfile,
  detectPiiColumns,
  INGEST_PROFILES,
  type IngestDataset,
  type DatasetProfile,
  type TransformSpec,
} from '../lib/ingestProfiles.js'
import { parseTabularFile } from '../lib/tabularParser.js'
import {
  ingestNightRowSchema,
  ingestReservationRowSchema,
  ingestInventoryRowSchema,
} from '../lib/validators.js'
import {
  ingestNightsService,
  ingestReservationsService,
  ingestInventoryService,
} from './ingestService.js'
import type { FileIngestInput } from '../lib/validators.js'

// ======================================
// ファイル取込（F-ING-01 — docs/pms-ingest-design.md §A-2④, §5）
//
// 取得手段（RPA / ネイティブ自動化 / SC連携 / 手動アップロード）が何であれ、
// 「ファイルさえ手に入れば以降は共通」にするための入口。
// PMSの提供形態が確定していなくても本番運用を始められるようにする狙い。
// ======================================

/** 1リクエストで受け付ける最大行数（zod側の上限と揃える） */
const MAX_ROWS = 40_000
/** エラー報告は先頭N件までに絞る（レスポンス肥大の防止） */
const MAX_REPORTED_ERRORS = 20

export interface FileIngestRowError {
  /** ファイル上の行番号（ヘッダ行を1とした実データの位置） */
  row: number
  field?: string
  message: string
}

export interface FileIngestResult {
  profileId: string
  dataset: IngestDataset
  fileName: string
  totalRows: number
  acceptedRows: number
  rejectedRows: number
  errors: FileIngestRowError[]
  /** ファイルに存在したがプロファイルで使っていない列（マッピング漏れの検知用） */
  unmappedColumns: string[]
  /** プロファイルが期待するのにファイルに無かった列 */
  missingColumns: string[]
  ingest?: unknown
}

// ---- 値の変換 ----

function toDate(value: unknown): Date | undefined {
  if (value == null || value === '') return undefined
  if (value instanceof Date) return value
  if (typeof value === 'number') {
    // Excelのシリアル値（1900年基準。exceljsは通常Dateで返すため保険）
    const ms = Math.round((value - 25569) * 86_400_000)
    return new Date(ms)
  }
  const text = String(value).trim().replace(/\//g, '-')
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function toNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const text = String(value).replace(/[,\s¥]/g, '')
  if (text === '') return undefined
  const n = Number(text)
  return Number.isFinite(n) ? n : undefined
}

function toFlag(value: unknown): boolean | undefined {
  if (value == null || value === '') return undefined
  if (typeof value === 'boolean') return value
  const text = String(value).trim().toLowerCase()
  if (['1', 'true', 'y', 'yes', '○'].includes(text)) return true
  if (['0', 'false', 'n', 'no', '', '×'].includes(text)) return false
  return undefined
}

export function applyTransform(value: unknown, spec: TransformSpec | undefined): unknown {
  switch (spec) {
    case 'date':
      return toDate(value)
    case 'number':
      return toNumber(value)
    case 'integer': {
      const n = toNumber(value)
      return n == null ? undefined : Math.round(n)
    }
    case 'flag01':
      return toFlag(value)
    case 'trim':
    case undefined: {
      if (value == null) return undefined
      if (typeof value === 'string') {
        const t = value.trim()
        return t === '' ? undefined : t
      }
      return value
    }
    default:
      return value
  }
}

/** ドット区切りのキーで入れ子オブジェクトに値を置く */
function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  if (value === undefined) return
  const parts = path.split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    if (typeof cursor[key] !== 'object' || cursor[key] == null) cursor[key] = {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[parts[parts.length - 1]] = value
}

/**
 * 1行をプロファイルに従って共通項目へ写像する。純関数（テスト対象）。
 */
export function mapRow(
  source: Record<string, unknown>,
  dataset: DatasetProfile
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {}
  for (const [target, column] of Object.entries(dataset.map)) {
    const raw = source[column]
    const value = applyTransform(raw, dataset.transforms?.[target])
    setPath(mapped, target, value)
  }
  return mapped
}

const ROW_SCHEMAS = {
  nights: ingestNightRowSchema,
  reservations: ingestReservationRowSchema,
  inventory: ingestInventoryRowSchema,
} as const

/**
 * ファイルを取り込み、既存の取込サービスへ流す。
 * dryRun=true なら検証だけ行い、DBには書き込まない（導入時のマッピング確認用）。
 */
export async function ingestFileService(input: FileIngestInput, userId?: string) {
  const profile = findProfile(input.profileId)
  if (!profile) throw new BadRequestError(`不明な取込プロファイルです: ${input.profileId}`)

  const datasetProfile = profile.datasets[input.dataset]
  if (!datasetProfile) {
    throw new BadRequestError(
      `プロファイル「${profile.id}」は ${input.dataset} に対応していません`
    )
  }

  const buffer = Buffer.from(input.contentBase64, 'base64')
  if (buffer.length === 0) throw new BadRequestError('ファイルが空です')

  const { headers, rows } = await parseTabularFile(buffer, profile)

  // 個人情報カラムの二次防御（仕様書Ⅲ章3.3）。検出したら取り込まない
  const pii = detectPiiColumns(headers)
  if (pii.length > 0) {
    throw new BadRequestError(
      `個人情報と思われる列が含まれています（${pii.join(', ')}）。PMS側の出力設定で除外してください`
    )
  }

  if (rows.length === 0) throw new BadRequestError('データ行がありません')
  if (rows.length > MAX_ROWS) {
    throw new BadRequestError(
      `1回に取り込める行数は${MAX_ROWS.toLocaleString()}行までです（${rows.length.toLocaleString()}行）。期間を分けて取り込んでください`
    )
  }

  // マッピングの健全性チェック（列名変更の早期検知 — 設計 §8-3）
  const mappedColumns = new Set(Object.values(datasetProfile.map))
  const ignored = new Set(datasetProfile.ignoredColumns ?? [])
  const missingColumns = [...mappedColumns].filter((c) => !headers.includes(c))
  const unmappedColumns = headers.filter((h) => !mappedColumns.has(h) && !ignored.has(h))

  const schema = ROW_SCHEMAS[input.dataset]
  const validRows: unknown[] = []
  const errors: FileIngestRowError[] = []

  for (const [index, source] of rows.entries()) {
    const mapped = mapRow(source, datasetProfile)
    const parsed = schema.safeParse(mapped)
    if (parsed.success) {
      validRows.push(parsed.data)
    } else if (errors.length < MAX_REPORTED_ERRORS) {
      const issue = parsed.error.issues[0]
      errors.push({
        // ヘッダ行の次を1行目として数える
        row: index + 1,
        field: issue.path.join('.') || undefined,
        message: issue.message,
      })
    }
  }

  const result: FileIngestResult = {
    profileId: profile.id,
    dataset: input.dataset,
    fileName: input.fileName,
    totalRows: rows.length,
    acceptedRows: validRows.length,
    rejectedRows: rows.length - validRows.length,
    errors,
    unmappedColumns,
    missingColumns,
  }

  if (input.dryRun) return result
  if (validRows.length === 0) {
    throw new BadRequestError(
      `取り込める行がありませんでした。列マッピングを確認してください（不足列: ${missingColumns.join(', ') || 'なし'}）`
    )
  }

  // 既存の取込サービスへ受け渡す（冪等・全量置換・IngestLog記録は既存実装が担う）
  if (input.dataset === 'nights') {
    result.ingest = await ingestNightsService(
      { hotelId: input.hotelId, rows: validRows as never },
      userId
    )
  } else if (input.dataset === 'reservations') {
    if (!input.capturedDate) {
      throw new BadRequestError('オンハンド予約の取込には capturedDate（断面の取得日）が必要です')
    }
    result.ingest = await ingestReservationsService(
      { hotelId: input.hotelId, capturedDate: input.capturedDate, rows: validRows as never },
      userId
    )
  } else {
    if (!input.capturedDate) {
      throw new BadRequestError('残室の取込には capturedDate（断面の取得日）が必要です')
    }
    result.ingest = await ingestInventoryService(
      { hotelId: input.hotelId, capturedDate: input.capturedDate, rows: validRows as never },
      userId
    )
  }

  return result
}

/** 取込プロファイル一覧（管理画面の選択肢用） */
export function listIngestProfiles() {
  return INGEST_PROFILES.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    format: p.format,
    encoding: p.encoding ?? 'utf8',
    datasets: Object.keys(p.datasets) as IngestDataset[],
    notes: p.notes,
  }))
}
