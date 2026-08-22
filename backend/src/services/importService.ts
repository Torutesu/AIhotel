import ExcelJS from 'exceljs'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { NotFoundError, BadRequestError } from '../middlewares/errorHandler.js'
import { recomputeForecastService } from './forecast/forecastService.js'
import type { CreateImportInput, ImportType } from '../lib/validators.js'

// Excel手動アップロードによるデータ取込（ランク表・日次実績）。
// PMS連携（Phase 4）が入るまでの主要なデータ反映経路のため、
// 行単位で検証し、1行でもエラーがあれば全行を反映しない（オール・オア・ナッシング）。
// 取込結果は ImportJob として記録し、履歴をUIから確認できるようにする。

const MAX_PRICE_RANKS = 40 // F-SET-02
const MAX_DAILY_ROWS = 500 // 約330日先を見るレベニュー運用＋余裕分
const IMPORT_TX_TIMEOUT_MS = 60_000

export interface ImportRowError {
  row: number
  message: string
}

export interface ImportResult {
  jobId: string
  type: ImportType
  fileName: string
  status: 'completed' | 'failed'
  rowCount: number
  createdCount: number
  updatedCount: number
  errorCount: number
  errors: ImportRowError[]
  /** 日次実績取込後にAI予測の再計算まで反映できたか */
  forecastRecomputed: boolean
}

// ======================================
// 列定義（テンプレート生成と取込パースで共通利用）
// ======================================

const PRICE_RANK_HEADERS = ['ランク', 'ラベル', '1名料金', '2名料金', '3名料金', '4名料金'] as const
const DAILY_ACTUAL_HEADERS = ['日付', '販売室数', 'ADR', '売上', '宿泊者数', '稼働率(%)', '備考'] as const
const OTA_CHANNEL_HEADERS = ['日付', 'チャネル', '販売室数', 'ADR', '売上', 'キャンペーン(1=あり)'] as const
const MAX_OTA_ROWS = 3000 // 約330日×主要OTAチャネル数＋余裕分

const priceRankRowSchema = z.object({
  rank: z.number().int('ランクは整数で入力してください').min(1).max(MAX_PRICE_RANKS, `ランクは最大${MAX_PRICE_RANKS}段階です`),
  label: z.string().min(1, 'ラベルは必須です').max(10, 'ラベルは10文字以内です'),
  price1P: z.number().min(0, '1名料金は0以上で入力してください'),
  price2P: z.number().min(0, '2名料金は0以上で入力してください'),
  price3P: z.number().min(0).nullable(),
  price4P: z.number().min(0).nullable(),
})

const dailyActualRowSchema = z
  .object({
    date: z.date({ invalid_type_error: '日付の形式が不正です（例: 2026-08-22）' }),
    soldRooms: z.number().int('販売室数は整数で入力してください').min(0).nullable(),
    adr: z.number().min(0).nullable(),
    totalRevenue: z.number().min(0).nullable(),
    guests: z.number().int('宿泊者数は整数で入力してください').min(0).nullable(),
    occupancy: z.number().min(0).max(1, '稼働率は0〜100%の範囲で入力してください').nullable(),
    notes: z.string().max(2000).nullable(),
  })
  .refine(
    (r) => r.soldRooms != null || r.adr != null || r.totalRevenue != null || r.guests != null || r.occupancy != null,
    { message: '実績値（販売室数・ADR・売上・宿泊者数・稼働率）のいずれかを入力してください' }
  )

const otaChannelRowSchema = z
  .object({
    date: z.date({ invalid_type_error: '日付の形式が不正です（例: 2026-08-22）' }),
    channel: z.string().min(1, 'チャネルは必須です').max(100),
    roomsSold: z.number().int('販売室数は整数で入力してください').min(0).nullable(),
    adr: z.number().min(0).nullable(),
    revenue: z.number().min(0).nullable(),
    campaignFlag: z.boolean(),
  })
  .refine((r) => r.roomsSold != null || r.adr != null || r.revenue != null, {
    message: '実績値（販売室数・ADR・売上）のいずれかを入力してください',
  })

// ======================================
// セル値の変換ヘルパー（exceljs のセルは数値・文字列・日付・数式結果など多形）
// ======================================

type CellValue = ExcelJS.CellValue

function unwrapCell(value: CellValue): CellValue {
  if (value != null && typeof value === 'object') {
    if ('result' in value) return (value.result ?? null) as CellValue // 数式セルは計算結果を使う
    if ('richText' in value) return value.richText.map((r) => r.text).join('')
    if ('text' in value) return value.text as CellValue // ハイパーリンク
  }
  return value
}

function cellToString(value: CellValue): string | null {
  const v = unwrapCell(value)
  if (v == null) return null
  const s = typeof v === 'string' ? v.trim() : String(v).trim()
  return s.length > 0 ? s : null
}

function cellToNumber(value: CellValue): number | null | undefined {
  const v = unwrapCell(value)
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,¥\s%]/g, ''))
    return Number.isFinite(n) ? n : undefined // undefined = 数値として解釈不能
  }
  return undefined
}

function cellToDate(value: CellValue): Date | null | undefined {
  const v = unwrapCell(value)
  if (v == null || v === '') return null
  if (v instanceof Date) {
    return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()))
  }
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/)
    if (!m) return undefined
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    return Number.isNaN(d.getTime()) ? undefined : d
  }
  return undefined
}

/** キャンペーンフラグ: 1・○・true・はい を「あり」とみなす（空欄=なし） */
function cellToBoolean(value: CellValue): boolean {
  const s = cellToString(value)
  if (s == null) return false
  return ['1', '○', '〇', 'true', 'TRUE', 'はい', 'あり'].includes(s)
}

/** 稼働率: 1より大きい値は%表記（85 → 0.85）とみなす */
function normalizeOccupancy(value: number | null): number | null {
  if (value == null) return null
  return value > 1 ? Math.round(value * 10) / 1000 : value
}

function zodMessages(error: z.ZodError): string {
  return error.errors.map((e) => e.message).join(' / ')
}

// ======================================
// テンプレート生成
// ======================================

/**
 * 取込用Excelテンプレートを生成する（1シート目=入力欄、2シート目=記入説明）
 */
export async function generateImportTemplateService(
  hotelId: string,
  type: ImportType
): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const workbook = new ExcelJS.Workbook()

  if (type === 'price_ranks') {
    const sheet = workbook.addWorksheet('ランク表')
    sheet.addRow([...PRICE_RANK_HEADERS])
    sheet.getRow(1).font = { bold: true }
    sheet.columns.forEach((c) => (c.width = 12))

    // 既存のランク表をそのまま出力し、編集して再アップロードできるようにする
    const ranks = await prisma.priceRank.findMany({
      where: { hotelId, isActive: true },
      orderBy: { rank: 'asc' },
    })
    if (ranks.length > 0) {
      for (const r of ranks) {
        sheet.addRow([r.rank, r.label, r.price1P, r.price2P, r.price3P ?? '', r.price4P ?? ''])
      }
    } else {
      sheet.addRow([1, 'R01', 6500, 9100, 11700, ''])
      sheet.addRow([2, 'R02', 7100, 9900, 12800, ''])
    }

    const guide = workbook.addWorksheet('記入方法')
    guide.addRows([
      ['ランク表テンプレートの記入方法'],
      ['・1行目のヘッダーは変更しないでください'],
      [`・ランクは1〜${MAX_PRICE_RANKS}の整数。同じランクが既にある場合は上書き更新されます`],
      ['・3名料金・4名料金は空欄可'],
      ['・アップロード時に全行を検証し、エラーが1件でもあれば反映されません'],
    ])
    guide.getColumn(1).width = 70
  } else if (type === 'ota_channel') {
    const sheet = workbook.addWorksheet('OTAチャネル実績')
    sheet.addRow([...OTA_CHANNEL_HEADERS])
    sheet.getRow(1).font = { bold: true }
    sheet.columns.forEach((c) => (c.width = 16))

    const today = new Date()
    const sample = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
      .toISOString()
      .slice(0, 10)
    sheet.addRow([sample, '楽天トラベル', 45, 17800, 801000, 1])
    sheet.addRow([sample, '公式サイト', 30, 19200, 576000, ''])

    const guide = workbook.addWorksheet('記入方法')
    guide.addRows([
      ['OTAチャネル実績テンプレートの記入方法'],
      ['・1行目のヘッダーは変更しないでください'],
      ['・日付は YYYY-MM-DD 形式または日付セル。同じ日付×チャネルの既存データは上書き更新されます'],
      ['・チャネル名は自由入力（例: 楽天トラベル、じゃらん、一休、Expedia、Agoda、公式サイト）'],
      ['・キャンペーン列は参画日に 1（または○）を入力。空欄=なし'],
      ['・ADRが空欄の場合は売上÷販売室数から自動計算します'],
      [`・一度に取り込めるのは${MAX_OTA_ROWS}行までです`],
      ['・アップロード時に全行を検証し、エラーが1件でもあれば反映されません'],
    ])
    guide.getColumn(1).width = 70
  } else {
    const sheet = workbook.addWorksheet('日次実績')
    sheet.addRow([...DAILY_ACTUAL_HEADERS])
    sheet.getRow(1).font = { bold: true }
    sheet.columns.forEach((c) => (c.width = 14))
    sheet.getColumn(7).width = 30

    const today = new Date()
    const sample = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
    sheet.addRow([sample.toISOString().slice(0, 10), 165, 18200, 3003000, 220, 82.5, ''])

    const guide = workbook.addWorksheet('記入方法')
    guide.addRows([
      ['日次実績テンプレートの記入方法'],
      ['・1行目のヘッダーは変更しないでください'],
      ['・日付は YYYY-MM-DD 形式または日付セル。既存の同日データは上書き更新されます'],
      ['・稼働率は%（例: 82.5）で入力。空欄の場合は販売室数÷総客室数から自動計算します'],
      ['・ADRが空欄の場合は売上÷販売室数から自動計算します'],
      ['・実績値の列（販売室数〜稼働率）はいずれか1つ以上を入力してください'],
      [`・一度に取り込めるのは${MAX_DAILY_ROWS}行までです`],
      ['・アップロード時に全行を検証し、エラーが1件でもあれば反映されません'],
    ])
    guide.getColumn(1).width = 70
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  const filename = `${type}_template.xlsx`
  return {
    buffer,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename,
  }
}

// ======================================
// 取込本体
// ======================================

interface ParsedPriceRankRow {
  rank: number
  label: string
  price1P: number
  price2P: number
  price3P: number | null
  price4P: number | null
}

interface ParsedDailyActualRow {
  date: Date
  soldRooms: number | null
  adr: number | null
  totalRevenue: number | null
  guests: number | null
  occupancy: number | null
  notes: string | null
}

interface ParsedOtaChannelRow {
  date: Date
  channel: string
  roomsSold: number | null
  adr: number | null
  revenue: number | null
  campaignFlag: boolean
}

function assertHeaderMatches(
  sheet: ExcelJS.Worksheet,
  expected: readonly string[]
): void {
  const headerRow = sheet.getRow(1)
  // 必須列（備考等の任意列を除く先頭列）が一致しているかを確認し、列ズレ取込を防ぐ
  for (let i = 0; i < Math.min(2, expected.length); i++) {
    const actual = cellToString(headerRow.getCell(i + 1).value)
    if (actual !== expected[i]) {
      throw new BadRequestError(
        `テンプレートのヘッダーが一致しません（1行目${i + 1}列目に「${expected[i]}」が必要です）。テンプレートをダウンロードして使用してください`
      )
    }
  }
}

function isRowEmpty(row: ExcelJS.Row, columnCount: number): boolean {
  for (let i = 1; i <= columnCount; i++) {
    if (cellToString(row.getCell(i).value) != null) return false
  }
  return true
}

export function parsePriceRankSheet(sheet: ExcelJS.Worksheet): { rows: ParsedPriceRankRow[]; errors: ImportRowError[] } {
  assertHeaderMatches(sheet, PRICE_RANK_HEADERS)
  const rows: ParsedPriceRankRow[] = []
  const errors: ImportRowError[] = []
  const seenRanks = new Set<number>()

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || isRowEmpty(row, PRICE_RANK_HEADERS.length)) return

    const numbers = [1, 3, 4, 5, 6].map((col) => cellToNumber(row.getCell(col).value))
    if (numbers.some((n) => n === undefined)) {
      errors.push({ row: rowNumber, message: '数値として解釈できないセルがあります' })
      return
    }
    const [rank, price1P, price2P, price3P, price4P] = numbers as (number | null)[]

    const parsed = priceRankRowSchema.safeParse({
      rank,
      label: cellToString(row.getCell(2).value) ?? '',
      price1P,
      price2P,
      price3P,
      price4P,
    })
    if (!parsed.success) {
      errors.push({ row: rowNumber, message: zodMessages(parsed.error) })
      return
    }
    if (seenRanks.has(parsed.data.rank)) {
      errors.push({ row: rowNumber, message: `ランク${parsed.data.rank}が重複しています` })
      return
    }
    seenRanks.add(parsed.data.rank)
    rows.push({
      ...parsed.data,
      price1P: Math.round(parsed.data.price1P),
      price2P: Math.round(parsed.data.price2P),
      price3P: parsed.data.price3P != null ? Math.round(parsed.data.price3P) : null,
      price4P: parsed.data.price4P != null ? Math.round(parsed.data.price4P) : null,
    })
  })

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ row: 2, message: '取り込める行がありません' })
  }
  if (rows.length > MAX_PRICE_RANKS) {
    errors.push({ row: 1, message: `料金ランクは最大${MAX_PRICE_RANKS}段階までです` })
  }
  return { rows, errors }
}

export function parseDailyActualSheet(sheet: ExcelJS.Worksheet): { rows: ParsedDailyActualRow[]; errors: ImportRowError[] } {
  assertHeaderMatches(sheet, DAILY_ACTUAL_HEADERS)
  const rows: ParsedDailyActualRow[] = []
  const errors: ImportRowError[] = []
  const seenDates = new Set<string>()

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || isRowEmpty(row, DAILY_ACTUAL_HEADERS.length)) return

    const date = cellToDate(row.getCell(1).value)
    if (date === undefined) {
      errors.push({ row: rowNumber, message: '日付の形式が不正です（例: 2026-08-22）' })
      return
    }
    const numbers = [2, 3, 4, 5, 6].map((col) => cellToNumber(row.getCell(col).value))
    if (numbers.some((n) => n === undefined)) {
      errors.push({ row: rowNumber, message: '数値として解釈できないセルがあります' })
      return
    }
    const [soldRooms, adr, totalRevenue, guests, occupancyRaw] = numbers as (number | null)[]

    const parsed = dailyActualRowSchema.safeParse({
      date,
      soldRooms,
      adr,
      totalRevenue,
      guests,
      occupancy: normalizeOccupancy(occupancyRaw),
      notes: cellToString(row.getCell(7).value),
    })
    if (!parsed.success) {
      errors.push({ row: rowNumber, message: zodMessages(parsed.error) })
      return
    }
    const key = parsed.data.date.toISOString().slice(0, 10)
    if (seenDates.has(key)) {
      errors.push({ row: rowNumber, message: `日付${key}が重複しています` })
      return
    }
    seenDates.add(key)
    rows.push(parsed.data)
  })

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ row: 2, message: '取り込める行がありません' })
  }
  if (rows.length > MAX_DAILY_ROWS) {
    errors.push({ row: 1, message: `一度に取り込めるのは${MAX_DAILY_ROWS}行までです` })
  }
  return { rows, errors }
}

export function parseOtaChannelSheet(sheet: ExcelJS.Worksheet): { rows: ParsedOtaChannelRow[]; errors: ImportRowError[] } {
  assertHeaderMatches(sheet, OTA_CHANNEL_HEADERS)
  const rows: ParsedOtaChannelRow[] = []
  const errors: ImportRowError[] = []
  const seenKeys = new Set<string>()

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || isRowEmpty(row, OTA_CHANNEL_HEADERS.length)) return

    const date = cellToDate(row.getCell(1).value)
    if (date === undefined || date === null) {
      errors.push({ row: rowNumber, message: '日付の形式が不正です（例: 2026-08-22）' })
      return
    }
    const numbers = [3, 4, 5].map((col) => cellToNumber(row.getCell(col).value))
    if (numbers.some((n) => n === undefined)) {
      errors.push({ row: rowNumber, message: '数値として解釈できないセルがあります' })
      return
    }
    const [roomsSold, adr, revenue] = numbers as (number | null)[]

    const parsed = otaChannelRowSchema.safeParse({
      date,
      channel: cellToString(row.getCell(2).value) ?? '',
      roomsSold,
      adr,
      revenue,
      campaignFlag: cellToBoolean(row.getCell(6).value),
    })
    if (!parsed.success) {
      errors.push({ row: rowNumber, message: zodMessages(parsed.error) })
      return
    }
    const key = `${parsed.data.date.toISOString().slice(0, 10)}|${parsed.data.channel}`
    if (seenKeys.has(key)) {
      errors.push({ row: rowNumber, message: `日付×チャネル（${key.replace('|', ' / ')}）が重複しています` })
      return
    }
    seenKeys.add(key)
    rows.push(parsed.data)
  })

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ row: 2, message: '取り込める行がありません' })
  }
  if (rows.length > MAX_OTA_ROWS) {
    errors.push({ row: 1, message: `一度に取り込めるのは${MAX_OTA_ROWS}行までです` })
  }
  return { rows, errors }
}

/**
 * Excelファイルを取り込みDBへ反映する。
 * 全行検証 → エラーが1件でもあれば反映せず ImportJob(failed) を記録して返す。
 * 成功時はトランザクションでアップサートし、日次実績の場合はAI予測を再計算する。
 */
export async function createImportService(
  input: CreateImportInput,
  createdByUserId: string
): Promise<ImportResult> {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const buffer = Buffer.from(input.fileBase64, 'base64')
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(arrayBuffer)
  } catch {
    throw new BadRequestError('Excelファイルとして読み込めませんでした（.xlsx形式のみ対応しています）')
  }
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new BadRequestError('ワークシートが見つかりません')

  const { rows, errors } =
    input.type === 'price_ranks'
      ? parsePriceRankSheet(sheet)
      : input.type === 'ota_channel'
        ? parseOtaChannelSheet(sheet)
        : parseDailyActualSheet(sheet)
  const rowCount = rows.length + errors.length

  if (errors.length > 0) {
    const job = await prisma.importJob.create({
      data: {
        hotelId: hotel.id,
        tenantId: hotel.tenantId,
        type: input.type,
        fileName: input.fileName,
        status: 'failed',
        rowCount,
        errorCount: errors.length,
        errors: JSON.parse(JSON.stringify(errors)),
        createdByUserId,
      },
    })
    return {
      jobId: job.id,
      type: input.type,
      fileName: input.fileName,
      status: 'failed',
      rowCount,
      createdCount: 0,
      updatedCount: 0,
      errorCount: errors.length,
      errors,
      forecastRecomputed: false,
    }
  }

  let createdCount = 0
  let updatedCount = 0

  if (input.type === 'price_ranks') {
    await prisma.$transaction(
      async (tx) => {
        for (const r of rows as ParsedPriceRankRow[]) {
          const existing = await tx.priceRank.findUnique({
            where: { hotelId_rank: { hotelId: hotel.id, rank: r.rank } },
            select: { id: true },
          })
          await tx.priceRank.upsert({
            where: { hotelId_rank: { hotelId: hotel.id, rank: r.rank } },
            update: {
              label: r.label,
              price1P: r.price1P,
              price2P: r.price2P,
              price3P: r.price3P,
              price4P: r.price4P,
              isActive: true,
            },
            create: {
              hotelId: hotel.id,
              tenantId: hotel.tenantId,
              rank: r.rank,
              label: r.label,
              price1P: r.price1P,
              price2P: r.price2P,
              price3P: r.price3P,
              price4P: r.price4P,
            },
          })
          if (existing) updatedCount++
          else createdCount++
        }
      },
      { timeout: IMPORT_TX_TIMEOUT_MS }
    )
  } else if (input.type === 'ota_channel') {
    await prisma.$transaction(
      async (tx) => {
        for (const r of rows as ParsedOtaChannelRow[]) {
          // ADR・売上は入力値から相互に導出する
          const adr =
            r.adr ??
            (r.revenue != null && r.roomsSold != null && r.roomsSold > 0
              ? Math.round(r.revenue / r.roomsSold)
              : null)
          const revenue = r.revenue ?? (adr != null && r.roomsSold != null ? adr * r.roomsSold : null)

          const data = { roomsSold: r.roomsSold, adr, revenue, campaignFlag: r.campaignFlag }
          const where = {
            hotelId_date_channel: { hotelId: hotel.id, date: r.date, channel: r.channel },
          }
          const existing = await tx.otaChannelData.findUnique({ where, select: { id: true } })
          await tx.otaChannelData.upsert({
            where,
            update: data,
            create: { hotelId: hotel.id, tenantId: hotel.tenantId, date: r.date, channel: r.channel, ...data },
          })
          if (existing) updatedCount++
          else createdCount++
        }
      },
      { timeout: IMPORT_TX_TIMEOUT_MS }
    )
  } else {
    await prisma.$transaction(
      async (tx) => {
        for (const r of rows as ParsedDailyActualRow[]) {
          // 空欄の指標は入力値から導出する（稼働率=販売室数÷総客室数、ADR=売上÷販売室数 等）
          const occupancy =
            r.occupancy ??
            (r.soldRooms != null && hotel.totalRooms > 0
              ? Math.round((r.soldRooms / hotel.totalRooms) * 1000) / 1000
              : null)
          const adr =
            r.adr ??
            (r.totalRevenue != null && r.soldRooms != null && r.soldRooms > 0
              ? Math.round(r.totalRevenue / r.soldRooms)
              : null)
          const totalRevenue =
            r.totalRevenue ?? (adr != null && r.soldRooms != null ? adr * r.soldRooms : null)
          const revPar =
            totalRevenue != null && hotel.totalRooms > 0
              ? Math.round(totalRevenue / hotel.totalRooms)
              : null

          const data = {
            occupancy,
            adr,
            totalRevenue,
            revPar,
            soldRooms: r.soldRooms,
            guests: r.guests,
            ...(r.notes != null && { notes: r.notes }),
          }
          const existing = await tx.dailyData.findUnique({
            where: { hotelId_date: { hotelId: hotel.id, date: r.date } },
            select: { id: true },
          })
          await tx.dailyData.upsert({
            where: { hotelId_date: { hotelId: hotel.id, date: r.date } },
            update: data,
            create: { hotelId: hotel.id, tenantId: hotel.tenantId, date: r.date, ...data },
          })
          if (existing) updatedCount++
          else createdCount++
        }
      },
      { timeout: IMPORT_TX_TIMEOUT_MS }
    )
  }

  // 実績・ランク表の反映後にAI予測を再計算し、アップロード内容を推奨価格へ反映する
  // （OTAチャネル実績は現在の予測入力に含まれないため再計算しない）。
  // 再計算の失敗で取込自体を巻き戻さない（取込は完了済み・予測は次回再計算で追いつく）
  let forecastRecomputed = false
  if (input.type !== 'ota_channel') {
    try {
      await recomputeForecastService(hotel.id)
      forecastRecomputed = true
    } catch {
      forecastRecomputed = false
    }
  }

  const job = await prisma.importJob.create({
    data: {
      hotelId: hotel.id,
      tenantId: hotel.tenantId,
      type: input.type,
      fileName: input.fileName,
      status: 'completed',
      rowCount,
      createdCount,
      updatedCount,
      createdByUserId,
    },
  })

  return {
    jobId: job.id,
    type: input.type,
    fileName: input.fileName,
    status: 'completed',
    rowCount,
    createdCount,
    updatedCount,
    errorCount: 0,
    errors: [],
    forecastRecomputed,
  }
}

/**
 * 取込履歴一覧（新しい順）
 */
export async function getImportJobsService(hotelId: string, limit: number) {
  return prisma.importJob.findMany({
    where: { hotelId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}
