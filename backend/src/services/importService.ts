import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { parseCsvWithHeader } from '../lib/csv.js'
import { ApiError, NotFoundError, BadRequestError } from '../middlewares/errorHandler.js'
import type { CsvImportInput } from '../lib/validators.js'

// CSV一括インポート（SAAS_ONBOARDING.md Step 3）。
// ヒアリングシート（スプレッドシート）からの転記を廃止するためのAPI。
// 方針: 全行をバリデーションしてエラーがあれば1件も取り込まない（all-or-nothing）。
// 部分取り込みは「どこまで入ったか」の確認工数が発生するため採用しない。

interface RowError {
  field: string
  message: string
}

const MAX_LISTED_ERRORS = 20

// 空文字は「未入力」として undefined 扱いにする共通ヘルパー
const optionalNumber = (schema: z.ZodType<number>) =>
  z.preprocess((v) => (v === '' ? undefined : Number(v)), schema.optional())

const requiredNumber = (schema: z.ZodType<number>) =>
  z.preprocess((v) => (v === '' ? undefined : Number(v)), schema)

// 日付は YYYY-MM-DD / YYYY/MM/DD を受け付け、UTC 0時に正規化する（DB は @db.Date）
const csvDateSchema = z.string().transform((value, ctx) => {
  const normalized = value.trim().replace(/\//g, '-')
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '日付は YYYY-MM-DD 形式で入力してください' })
    return z.NEVER
  }
  const [y, m, d] = normalized.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '存在しない日付です' })
    return z.NEVER
  }
  return date
})

// ---- 行スキーマ（CSVの列名 = スキーマのキー） ----

const roomTypeRowSchema = z.object({
  code: z.string().min(1, 'code は必須です').max(50)
    .regex(/^[A-Z0-9_]+$/, 'code は大文字英数字とアンダースコアのみ使用可能です'),
  name: z.string().min(1, 'name は必須です').max(100),
  capacity: requiredNumber(z.number().int().min(1).max(10)),
  count: requiredNumber(z.number().int().min(0)),
  sortOrder: optionalNumber(z.number().int()),
})

const budgetRowSchema = z.object({
  year: requiredNumber(z.number().int().min(2020).max(2100)),
  month: requiredNumber(z.number().int().min(1).max(12)),
  budgetRevenue: optionalNumber(z.number().min(0)),
  budgetRooms: optionalNumber(z.number().int().min(0)),
  budgetAdr: optionalNumber(z.number().min(0)),
  budgetOccupancy: optionalNumber(z.number().min(0).max(1)),
  budgetGuests: optionalNumber(z.number().int().min(0)),
  lastYearRevenue: optionalNumber(z.number().min(0)),
  lastYearRooms: optionalNumber(z.number().int().min(0)),
  lastYearAdr: optionalNumber(z.number().min(0)),
  lastYearOccupancy: optionalNumber(z.number().min(0).max(1)),
  lastYearGuests: optionalNumber(z.number().int().min(0)),
})

const dailyDataRowSchema = z.object({
  date: csvDateSchema,
  occupancy: optionalNumber(z.number().min(0).max(1, 'occupancy は 0〜1 で入力してください（例 0.78）')),
  adr: optionalNumber(z.number().min(0)),
  revPar: optionalNumber(z.number().min(0)),
  totalRevenue: optionalNumber(z.number().min(0)),
  soldRooms: optionalNumber(z.number().int().min(0)),
  guests: optionalNumber(z.number().int().min(0)),
})

// ---- 共通処理 ----

interface ImportDef<T> {
  rowSchema: z.ZodType<T, z.ZodTypeDef, unknown>
  requiredColumns: string[]
  maxRows: number
  rowLabel: string
}

function parseRows<T>(csv: string, def: ImportDef<T>): T[] {
  const { header, records } = parseCsvWithHeader(csv)
  if (records.length === 0) {
    throw new BadRequestError('CSVにデータ行がありません（1行目はヘッダーとして扱われます）')
  }
  const missing = def.requiredColumns.filter((c) => !header.includes(c))
  if (missing.length > 0) {
    throw new BadRequestError(`CSVのヘッダーに必須列がありません: ${missing.join(', ')}`)
  }
  if (records.length > def.maxRows) {
    throw new BadRequestError(`${def.rowLabel}は一度に最大${def.maxRows}行までです（${records.length}行検出）`)
  }

  const rows: T[] = []
  const errors: RowError[] = []
  for (const record of records) {
    const parsed = def.rowSchema.safeParse(record.values)
    if (parsed.success) {
      rows.push(parsed.data)
    } else {
      for (const issue of parsed.error.errors) {
        errors.push({ field: `${record.line}行目 ${issue.path.join('.')}`, message: issue.message })
      }
    }
  }
  if (errors.length > 0) {
    throw new ApiError(
      400,
      `CSVに${errors.length}件のエラーがあります。修正して再実行してください（取り込みは行っていません）`,
      errors.slice(0, MAX_LISTED_ERRORS)
    )
  }
  return rows
}

function assertUnique<T>(rows: T[], keyFn: (row: T) => string, label: string) {
  const seen = new Set<string>()
  for (const row of rows) {
    const key = keyFn(row)
    if (seen.has(key)) {
      throw new BadRequestError(`CSV内で${label}が重複しています: ${key}`)
    }
    seen.add(key)
  }
}

async function findHotelOrThrow(hotelId: string) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')
  return hotel
}

// ---- インポート本体 ----

/**
 * 客室タイプCSVインポート。列: code,name,capacity,count,sortOrder(任意)
 * (hotelId, code) で upsert する（既存コードは上書き、新規コードは追加）
 */
export async function importRoomTypesService(input: CsvImportInput) {
  const hotel = await findHotelOrThrow(input.hotelId)
  const rows = parseRows(input.csv, {
    rowSchema: roomTypeRowSchema,
    requiredColumns: ['code', 'name', 'capacity', 'count'],
    maxRows: 100,
    rowLabel: '客室タイプ',
  })
  assertUnique(rows, (r) => r.code, 'code')

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const data = {
        name: row.name,
        capacity: row.capacity,
        count: row.count,
        sortOrder: row.sortOrder ?? i + 1,
        isActive: true,
      }
      await tx.roomType.upsert({
        where: { hotelId_code: { hotelId: hotel.id, code: row.code } },
        update: data,
        create: { ...data, code: row.code, hotelId: hotel.id, tenantId: hotel.tenantId },
      })
    }
  })
  return { imported: rows.length }
}

/**
 * 月次予算・前年実績CSVインポート。列: year,month と budget系・lastYear系（金額系は任意）
 * (hotelId, year, month) で upsert する
 */
export async function importMonthlyBudgetsService(input: CsvImportInput) {
  const hotel = await findHotelOrThrow(input.hotelId)
  const rows = parseRows(input.csv, {
    rowSchema: budgetRowSchema,
    requiredColumns: ['year', 'month'],
    maxRows: 240, // 20年分
    rowLabel: '月次予算',
  })
  assertUnique(rows, (r) => `${r.year}-${r.month}`, 'year/month')

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const { year, month, ...values } = row
      await tx.monthlyBudget.upsert({
        where: { hotelId_year_month: { hotelId: hotel.id, year, month } },
        update: values,
        create: { ...values, year, month, hotelId: hotel.id, tenantId: hotel.tenantId },
      })
    }
  })
  return { imported: rows.length }
}

/**
 * 過去日次実績CSVインポート（データ移行用）。列: date,occupancy,adr,revPar,totalRevenue,soldRooms,guests
 * (hotelId, date) で upsert する
 */
export async function importDailyDataService(input: CsvImportInput) {
  const hotel = await findHotelOrThrow(input.hotelId)
  const rows = parseRows(input.csv, {
    rowSchema: dailyDataRowSchema,
    requiredColumns: ['date'],
    maxRows: 1100, // 約3年分
    rowLabel: '日次実績',
  })
  assertUnique(rows, (r) => r.date.toISOString().slice(0, 10), 'date')

  await prisma.$transaction(
    async (tx) => {
      for (const row of rows) {
        const { date, ...values } = row
        await tx.dailyData.upsert({
          where: { hotelId_date: { hotelId: hotel.id, date } },
          update: values,
          create: { ...values, date, hotelId: hotel.id, tenantId: hotel.tenantId },
        })
      }
    },
    // 過去データ移行は行数が多いためタイムアウトを緩める
    { timeout: 60_000 }
  )
  return { imported: rows.length }
}
