import ExcelJS from 'exceljs'
import type { HotelType } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { BadRequestError, NotFoundError } from '../middlewares/errorHandler.js'
import { MAX_COMPETITORS } from './settingsService.js'

// 初期設定の一括投入（#13）。1ホテル分の設定を1つの Excel ファイル（ヒアリングシート）でやり取りする。
//
// - テンプレートは現在の設定を埋めた状態で出力する（新規ホテルなら空のまま）。埋め直して取り込めば差分だけが変わる
// - 取り込みは全シートを検証してから1トランザクションで書く。1か所でも不正なら何も書き込まない（#82 と同じ方針）
// - 行を削除しても既存の設定は消さない（誤って行を消したときに設定が失われないため）。消すときは設定タブで行う

const SHEETS = {
  guide: '説明',
  basic: '基本情報',
  roomTypes: '部屋タイプ',
  priceRanks: '料金ランク',
  competitors: '競合',
  budgets: '予算',
} as const

const HOTEL_TYPE_BY_LABEL: Record<string, HotelType> = {
  総合型ホテル: 'FULL_SERVICE',
  宿泊特化: 'LIMITED_SERVICE',
  リゾートホテル: 'RESORT',
  旅館: 'RYOKAN',
}
const LABEL_BY_HOTEL_TYPE = Object.fromEntries(Object.entries(HOTEL_TYPE_BY_LABEL).map(([k, v]) => [v, k])) as Record<
  HotelType,
  string
>

const OTA_COLUMNS = [
  ['rakuten', '楽天トラベル'],
  ['jalan', 'じゃらん'],
  ['ikkyu', '一休.com'],
  ['expedia', 'Expedia'],
  ['agoda', 'Agoda'],
  ['booking', 'Booking.com'],
  ['tripcom', 'Trip.com'],
  ['official', '公式サイト'],
] as const

const BASIC_ROWS = ['ホテル名', '総客室数', 'ホテルタイプ', '都道府県コード', '市区町村コード', '観光エリア'] as const

// ======================================
// テンプレートの出力
// ======================================

export async function buildSetupWorkbookService(hotelId: string): Promise<{ buffer: Buffer; hotelName: string }> {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const now = new Date()
  const [roomTypes, priceRanks, competitors, budgets] = await Promise.all([
    prisma.roomType.findMany({ where: { hotelId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
    prisma.priceRank.findMany({ where: { hotelId, isActive: true }, orderBy: { rank: 'asc' } }),
    prisma.competitor.findMany({ where: { hotelId, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.monthlyBudget.findMany({
      where: { hotelId, year: { gte: now.getUTCFullYear() } },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    }),
  ])

  const wb = new ExcelJS.Workbook()
  const guide = wb.addWorksheet(SHEETS.guide)
  guide.getColumn(1).width = 100
  ;[
    `${hotel.name} の初期設定シート`,
    '',
    '・各シートの2行目以降に入力してください。1行目（見出し）は変更しないでください',
    '・入力済みの行は現在の設定です。書き換えて取り込むと、その内容に更新されます',
    '・行を削除しても設定は消えません。削除は設定タブから行ってください',
    `・ホテルタイプは「${Object.keys(HOTEL_TYPE_BY_LABEL).join('」「')}」のいずれか`,
    '・都道府県コードは01〜47（例: 東京都=13）、市区町村コードは全国地方公共団体コードの6桁（任意）',
    '・部屋タイプの室数の合計は総客室数と一致させてください',
    `・料金ランクは1〜40、競合は最大${MAX_COMPETITORS}社`,
    '・予算の稼働率は % で入力してください（例: 85.5）',
  ].forEach((text) => guide.addRow([text]))

  const basic = wb.addWorksheet(SHEETS.basic)
  basic.columns = [
    { header: '項目', width: 20 },
    { header: '値', width: 40 },
  ]
  const basicValues: Record<(typeof BASIC_ROWS)[number], string | number> = {
    ホテル名: hotel.name,
    総客室数: hotel.totalRooms,
    ホテルタイプ: hotel.hotelType ? LABEL_BY_HOTEL_TYPE[hotel.hotelType] : '',
    都道府県コード: hotel.prefectureCode ?? '',
    市区町村コード: hotel.municipalityCode ?? '',
    観光エリア: hotel.marketArea ?? '',
  }
  BASIC_ROWS.forEach((key) => basic.addRow([key, basicValues[key]]))

  const rt = wb.addWorksheet(SHEETS.roomTypes)
  rt.columns = ['コード', '名称', '定員', '室数'].map((header) => ({ header, width: 16 }))
  roomTypes.forEach((r) => rt.addRow([r.code, r.name, r.capacity, r.count]))

  const pr = wb.addWorksheet(SHEETS.priceRanks)
  pr.columns = ['ランク', 'ラベル', '1名料金', '2名料金', '3名料金', '4名料金'].map((header) => ({ header, width: 12 }))
  priceRanks.forEach((r) => pr.addRow([r.rank, r.label, r.price1P, r.price2P, r.price3P, r.price4P]))

  const cp = wb.addWorksheet(SHEETS.competitors)
  cp.columns = [
    { header: '競合ホテル名', width: 24 },
    { header: 'カテゴリ', width: 12 },
    { header: '住所', width: 30 },
    ...OTA_COLUMNS.map(([, label]) => ({ header: `${label} URL`, width: 30 })),
  ]
  competitors.forEach((c) => {
    const urls = (c.otaUrls ?? {}) as Record<string, string | null>
    cp.addRow([c.name, c.category, c.address, ...OTA_COLUMNS.map(([key]) => urls[key] ?? null)])
  })

  const bg = wb.addWorksheet(SHEETS.budgets)
  bg.columns = ['年', '月', '売上予算', '販売室数予算', 'ADR予算', '稼働率予算(%)'].map((header) => ({ header, width: 14 }))
  budgets.forEach((b) =>
    bg.addRow([
      b.year,
      b.month,
      b.budgetRevenue,
      b.budgetRooms,
      b.budgetAdr,
      b.budgetOccupancy == null ? null : Math.round(b.budgetOccupancy * 1000) / 10,
    ])
  )

  for (const sheet of [basic, rt, pr, cp, bg]) sheet.getRow(1).font = { bold: true }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  return { buffer, hotelName: hotel.name }
}

// ======================================
// 取り込み
// ======================================

type FieldError = { field: string; message: string }

/** セルの値を文字列に（数式は計算結果、リッチテキストは連結、ハイパーリンクは表示文字列） */
export function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue)
    if ('richText' in value) return value.richText.map((t) => t.text).join('')
    if ('text' in value) return String(value.text)
    if ('hyperlink' in value) return String(value.hyperlink)
    if (value instanceof Date) return value.toISOString().slice(0, 10)
  }
  return String(value).trim()
}

/** 数値に。空欄は null、数値でなければ NaN（桁区切りのカンマ・円記号は無視） */
export function cellNumber(value: ExcelJS.CellValue): number | null {
  const text = cellText(value).replace(/[,¥￥\s]/g, '')
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : NaN
}

function dataRows(sheet: ExcelJS.Worksheet | undefined): Array<{ rowNumber: number; cells: ExcelJS.CellValue[] }> {
  if (!sheet) return []
  const rows: Array<{ rowNumber: number; cells: ExcelJS.CellValue[] }> = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    // row.values は 1 始まり（[0] は常に空）
    const cells = (row.values as ExcelJS.CellValue[]).slice(1)
    if (cells.every((c) => cellText(c) === '')) return
    rows.push({ rowNumber, cells })
  })
  return rows
}

export interface SetupWorkbookContent {
  basic: {
    name?: string
    totalRooms?: number
    hotelType?: HotelType | null
    prefectureCode?: string | null
    municipalityCode?: string | null
    marketArea?: string | null
  }
  roomTypes: Array<{ code: string; name: string; capacity: number; count: number }>
  priceRanks: Array<{ rank: number; label: string; price1P: number; price2P: number; price3P: number | null; price4P: number | null }>
  competitors: Array<{ name: string; category: string | null; address: string | null; otaUrls: Record<string, string | null> }>
  budgets: Array<{
    year: number
    month: number
    budgetRevenue: number | null
    budgetRooms: number | null
    budgetAdr: number | null
    budgetOccupancy: number | null
  }>
}

/** ワークブックを読み、形式を検証する（純関数に近い。DB は見ない）。field は「シート名!行番号」 */
export function parseSetupWorkbook(wb: ExcelJS.Workbook): { content: SetupWorkbookContent; errors: FieldError[] } {
  const errors: FieldError[] = []
  const err = (sheet: string, row: number, message: string) => errors.push({ field: `${sheet}!${row}`, message })
  const isInt = (n: number | null): n is number => n !== null && Number.isInteger(n)
  const content: SetupWorkbookContent = { basic: {}, roomTypes: [], priceRanks: [], competitors: [], budgets: [] }

  // 基本情報（項目, 値 の縦持ち）
  for (const { rowNumber, cells } of dataRows(wb.getWorksheet(SHEETS.basic))) {
    const key = cellText(cells[0])
    const raw = cells[1]
    const text = cellText(raw)
    switch (key) {
      case 'ホテル名':
        if (text === '' || text.length > 200) err(SHEETS.basic, rowNumber, 'ホテル名は1〜200文字で入力してください')
        else content.basic.name = text
        break
      case '総客室数': {
        const n = cellNumber(raw)
        if (!isInt(n) || n < 1) err(SHEETS.basic, rowNumber, '総客室数は1以上の整数で入力してください')
        else content.basic.totalRooms = n
        break
      }
      case 'ホテルタイプ':
        if (text === '') content.basic.hotelType = null
        else if (!HOTEL_TYPE_BY_LABEL[text]) err(SHEETS.basic, rowNumber, `ホテルタイプは「${Object.keys(HOTEL_TYPE_BY_LABEL).join('」「')}」のいずれかです`)
        else content.basic.hotelType = HOTEL_TYPE_BY_LABEL[text]
        break
      case '都道府県コード': {
        const code = text === '' ? '' : text.padStart(2, '0')
        if (code !== '' && !/^(0[1-9]|[1-3][0-9]|4[0-7])$/.test(code)) err(SHEETS.basic, rowNumber, '都道府県コードは01〜47で入力してください')
        else content.basic.prefectureCode = code || null
        break
      }
      case '市区町村コード': {
        const code = text === '' ? '' : text.padStart(6, '0')
        if (code !== '' && !/^\d{6}$/.test(code)) err(SHEETS.basic, rowNumber, '市区町村コードは6桁の数字で入力してください')
        else content.basic.municipalityCode = code || null
        break
      }
      case '観光エリア':
        if (text.length > 100) err(SHEETS.basic, rowNumber, '観光エリアは100文字以内で入力してください')
        else content.basic.marketArea = text || null
        break
      default:
        err(SHEETS.basic, rowNumber, `項目「${key}」は取り込めません（${BASIC_ROWS.join('・')}）`)
    }
  }
  const { prefectureCode, municipalityCode } = content.basic
  if (prefectureCode && municipalityCode && !municipalityCode.startsWith(prefectureCode)) {
    errors.push({ field: `${SHEETS.basic}!市区町村コード`, message: '市区町村コードの先頭2桁が都道府県コードと一致しません' })
  }

  // 部屋タイプ（コード, 名称, 定員, 室数）
  const seenCodes = new Map<string, number>()
  for (const { rowNumber, cells } of dataRows(wb.getWorksheet(SHEETS.roomTypes))) {
    const code = cellText(cells[0]).toUpperCase()
    const name = cellText(cells[1])
    const capacity = cellNumber(cells[2])
    const count = cellNumber(cells[3])
    const problems: string[] = []
    if (!/^[A-Z0-9_-]{1,30}$/.test(code)) problems.push('コードは英数字・ハイフン・アンダースコアの30文字以内')
    if (name === '' || name.length > 100) problems.push('名称は1〜100文字')
    if (!isInt(capacity) || capacity < 1 || capacity > 20) problems.push('定員は1〜20の整数')
    if (!isInt(count) || count < 1) problems.push('室数は1以上の整数')
    const first = seenCodes.get(code)
    if (first !== undefined) problems.push(`コード ${code} が ${first} 行目と重複しています`)
    else seenCodes.set(code, rowNumber)
    if (problems.length > 0) err(SHEETS.roomTypes, rowNumber, problems.join('／'))
    else content.roomTypes.push({ code, name, capacity: capacity!, count: count! })
  }

  // 料金ランク（ランク, ラベル, 1〜4名料金）
  const seenRanks = new Map<number, number>()
  for (const { rowNumber, cells } of dataRows(wb.getWorksheet(SHEETS.priceRanks))) {
    const rank = cellNumber(cells[0])
    const label = cellText(cells[1])
    const prices = [2, 3, 4, 5].map((i) => cellNumber(cells[i]))
    const problems: string[] = []
    if (!isInt(rank) || rank < 1 || rank > 40) problems.push('ランクは1〜40の整数')
    if (label === '' || label.length > 10) problems.push('ラベルは1〜10文字')
    if (!isInt(prices[0]) || prices[0] < 0) problems.push('1名料金は0以上の整数（必須）')
    if (!isInt(prices[1]) || prices[1] < 0) problems.push('2名料金は0以上の整数（必須）')
    if (prices.slice(2).some((p) => p !== null && (!isInt(p) || p < 0))) problems.push('3名・4名料金は0以上の整数（空欄は未設定）')
    if (isInt(rank)) {
      const first = seenRanks.get(rank)
      if (first !== undefined) problems.push(`ランク ${rank} が ${first} 行目と重複しています`)
      else seenRanks.set(rank, rowNumber)
    }
    if (problems.length > 0) err(SHEETS.priceRanks, rowNumber, problems.join('／'))
    else content.priceRanks.push({ rank: rank!, label, price1P: prices[0]!, price2P: prices[1]!, price3P: prices[2], price4P: prices[3] })
  }

  // 競合（競合ホテル名, カテゴリ, 住所, 各 URL）
  const seenNames = new Map<string, number>()
  for (const { rowNumber, cells } of dataRows(wb.getWorksheet(SHEETS.competitors))) {
    const name = cellText(cells[0])
    const category = cellText(cells[1])
    const address = cellText(cells[2])
    const problems: string[] = []
    if (name === '' || name.length > 200) problems.push('競合ホテル名は1〜200文字')
    if (category.length > 50) problems.push('カテゴリは50文字以内')
    if (address.length > 500) problems.push('住所は500文字以内')
    const otaUrls: Record<string, string | null> = {}
    OTA_COLUMNS.forEach(([key, label], i) => {
      const url = cellText(cells[3 + i])
      if (url !== '' && (!/^https?:\/\/\S+$/.test(url) || url.length > 500)) problems.push(`${label} の URL が不正です`)
      otaUrls[key] = url || null
    })
    const first = seenNames.get(name)
    if (first !== undefined) problems.push(`「${name}」が ${first} 行目と重複しています`)
    else seenNames.set(name, rowNumber)
    if (problems.length > 0) err(SHEETS.competitors, rowNumber, problems.join('／'))
    else content.competitors.push({ name, category: category || null, address: address || null, otaUrls })
  }

  // 予算（年, 月, 売上, 室数, ADR, 稼働率%）
  const seenMonths = new Map<string, number>()
  for (const { rowNumber, cells } of dataRows(wb.getWorksheet(SHEETS.budgets))) {
    const [year, month, revenue, rooms, adr, occupancyPct] = [0, 1, 2, 3, 4, 5].map((i) => cellNumber(cells[i]))
    const problems: string[] = []
    if (!isInt(year) || year < 2020 || year > 2100) problems.push('年は2020〜2100')
    if (!isInt(month) || month < 1 || month > 12) problems.push('月は1〜12')
    if ([revenue, adr].some((v) => v !== null && (Number.isNaN(v) || v < 0))) problems.push('売上・ADRは0以上の数値')
    if (rooms !== null && (!isInt(rooms) || rooms < 0)) problems.push('販売室数は0以上の整数')
    if (occupancyPct !== null && (Number.isNaN(occupancyPct) || occupancyPct < 0 || occupancyPct > 100)) problems.push('稼働率は0〜100（%）')
    const key = `${year}-${month}`
    const first = seenMonths.get(key)
    if (first !== undefined) problems.push(`${year}年${month}月が ${first} 行目と重複しています`)
    else seenMonths.set(key, rowNumber)
    if (problems.length > 0) err(SHEETS.budgets, rowNumber, problems.join('／'))
    else
      content.budgets.push({
        year: year!,
        month: month!,
        budgetRevenue: revenue,
        budgetRooms: rooms,
        budgetAdr: adr,
        budgetOccupancy: occupancyPct === null ? null : Math.round(occupancyPct * 10) / 1000,
      })
  }

  return { content, errors }
}

type Counts = { created: number; updated: number }

export interface SetupImportResult {
  dryRun: boolean
  tenantId: string
  basicUpdated: boolean
  roomTypes: Counts
  priceRanks: Counts
  competitors: Counts
  budgets: Counts
}

export async function importSetupWorkbookService(input: {
  hotelId: string
  fileBase64: string
  dryRun?: boolean
}): Promise<SetupImportResult> {
  const hotel = await prisma.hotel.findFirst({ where: { id: input.hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(Buffer.from(input.fileBase64, 'base64') as unknown as ArrayBuffer)
  } catch {
    throw new BadRequestError('Excel ファイル（.xlsx）として読み込めませんでした')
  }
  const { content, errors } = parseSetupWorkbook(wb)

  const [roomTypes, priceRanks, competitors, budgets] = await Promise.all([
    prisma.roomType.findMany({ where: { hotelId: hotel.id }, select: { code: true, isActive: true } }),
    prisma.priceRank.findMany({ where: { hotelId: hotel.id }, select: { rank: true, isActive: true } }),
    prisma.competitor.findMany({ where: { hotelId: hotel.id }, select: { id: true, name: true, isActive: true } }),
    prisma.monthlyBudget.findMany({ where: { hotelId: hotel.id }, select: { year: true, month: true } }),
  ])

  // 競合の上限（F-SET-03）は、取り込み後に有効になる件数で判定する
  const activeNames = new Set(competitors.filter((c) => c.isActive).map((c) => c.name))
  const afterImport = new Set([...activeNames, ...content.competitors.map((c) => c.name)])
  if (afterImport.size > MAX_COMPETITORS) {
    errors.push({
      field: `${SHEETS.competitors}!全体`,
      message: `取り込むと競合が ${afterImport.size} 社になります（最大${MAX_COMPETITORS}社）。不要な競合を設定タブで削除してください`,
    })
  }
  if (errors.length > 0) {
    throw new BadRequestError('取り込めない箇所があります。何も取り込んでいません', errors)
  }

  const count = <T>(items: T[], exists: (item: T) => boolean): Counts => {
    const updated = items.filter(exists).length
    return { created: items.length - updated, updated }
  }
  const roomCodes = new Set(roomTypes.map((r) => r.code))
  const rankSet = new Set(priceRanks.map((r) => r.rank))
  const competitorByName = new Map(competitors.map((c) => [c.name, c]))
  const budgetKeys = new Set(budgets.map((b) => `${b.year}-${b.month}`))

  const result: SetupImportResult = {
    dryRun: Boolean(input.dryRun),
    tenantId: hotel.tenantId,
    basicUpdated: Object.keys(content.basic).length > 0,
    roomTypes: count(content.roomTypes, (r) => roomCodes.has(r.code)),
    priceRanks: count(content.priceRanks, (r) => rankSet.has(r.rank)),
    competitors: count(content.competitors, (c) => competitorByName.has(c.name)),
    budgets: count(content.budgets, (b) => budgetKeys.has(`${b.year}-${b.month}`)),
  }
  if (input.dryRun) return result

  const tenantId = hotel.tenantId
  const hotelId = hotel.id
  await prisma.$transaction(
    async (tx) => {
      if (result.basicUpdated) await tx.hotel.update({ where: { id: hotelId }, data: content.basic })
      for (const r of content.roomTypes) {
        await tx.roomType.upsert({
          where: { hotelId_code: { hotelId, code: r.code } },
          update: { name: r.name, capacity: r.capacity, count: r.count, isActive: true },
          create: { tenantId, hotelId, ...r },
        })
      }
      for (const r of content.priceRanks) {
        await tx.priceRank.upsert({
          where: { hotelId_rank: { hotelId, rank: r.rank } },
          update: { label: r.label, price1P: r.price1P, price2P: r.price2P, price3P: r.price3P, price4P: r.price4P, isActive: true },
          create: { tenantId, hotelId, ...r },
        })
      }
      for (const c of content.competitors) {
        const existing = competitorByName.get(c.name)
        if (existing) {
          await tx.competitor.update({
            where: { id: existing.id },
            data: { category: c.category, address: c.address, otaUrls: c.otaUrls, isActive: true },
          })
        } else {
          await tx.competitor.create({ data: { tenantId, hotelId, ...c } })
        }
      }
      for (const b of content.budgets) {
        const { year, month, ...values } = b
        await tx.monthlyBudget.upsert({
          where: { hotelId_year_month: { hotelId, year, month } },
          update: values,
          create: { tenantId, hotelId, year, month, ...values },
        })
      }
    },
    { timeout: 60_000 }
  )
  return result
}
