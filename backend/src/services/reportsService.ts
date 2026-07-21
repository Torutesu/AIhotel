import { fileURLToPath } from 'url'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { prisma } from '../lib/prisma.js'
import { storage } from '../lib/storage.js'
import { NotFoundError } from '../middlewares/errorHandler.js'

// 月次レポート生成（F-REP-01: Excel / F-REP-02: PDF）。
// DailyData / MonthlyBudget / MonthlyLandingSimulation を集計し、
// KPIサマリー + 日別明細のレポートを生成して storage 経由で保存する。

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

// pdfkit のデフォルトフォントは日本語グリフを内蔵していないため（豆腐化する）、
// Noto Sans JP（OFLライセンス）を埋め込む。dist ビルド後も同じ相対位置に
// assets/ が来るよう import.meta.url から解決する（rootDir=src, outDir=dist で
// ディレクトリ構造が一致するため dev/prod どちらでも backend/assets を指す）
const FONT_PATH = fileURLToPath(new URL('../../assets/fonts/NotoSansJP-Regular.ttf', import.meta.url))

function monthRange(year: number, month: number): { start: Date; end: Date; daysInMonth: number } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
  }
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

interface DailyReportRow {
  date: string
  dayOfWeek: string
  isWeekend: boolean
  isHoliday: boolean
  occupancy: number | null
  adr: number | null
  revPar: number | null
  totalRevenue: number | null
  soldRooms: number | null
  guests: number | null
}

interface MonthlyReportData {
  hotelId: string
  hotelName: string
  year: number
  month: number
  totalRooms: number
  summary: {
    roomRevenue: number
    soldRooms: number
    adr: number
    occupancyRate: number
    revPar: number
    guests: number
    daysWithActuals: number
    budgetRevenue: number | null
    budgetRatio: number | null
    lastYearRevenue: number | null
    lastYearRatio: number | null
  }
  dailyRows: DailyReportRow[]
}

/**
 * 月次レポートの元データを集計する（Excel/PDF共通）
 */
async function buildMonthlyReportData(hotelId: string, year: number, month: number): Promise<MonthlyReportData> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const { start, end, daysInMonth } = monthRange(year, month)
  const weekendDays = Array.isArray(hotel.weekendDays) ? (hotel.weekendDays as number[]) : [5, 6]

  const [dailyData, budget] = await Promise.all([
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: start, lt: end } },
      orderBy: { date: 'asc' },
    }),
    prisma.monthlyBudget.findUnique({
      where: { hotelId_year_month: { hotelId, year, month } },
    }),
  ])

  const byDate = new Map(dailyData.map((d) => [toDateKey(d.date), d]))

  const dailyRows: DailyReportRow[] = []
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(Date.UTC(year, month - 1, day))
    const key = toDateKey(date)
    const row = byDate.get(key)
    const dow = date.getUTCDay()
    dailyRows.push({
      date: key,
      dayOfWeek: WEEKDAY_LABELS[dow],
      isWeekend: weekendDays.includes(dow),
      isHoliday: row?.isHoliday ?? false,
      occupancy: row?.occupancy ?? null,
      adr: row?.adr ?? null,
      revPar: row?.revPar ?? null,
      totalRevenue: row?.totalRevenue ?? null,
      soldRooms: row?.soldRooms ?? null,
      guests: row?.guests ?? null,
    })
  }

  const actualDays = dailyData.filter((d) => d.totalRevenue != null)
  const totalRevenue = actualDays.reduce((sum, d) => sum + (d.totalRevenue ?? 0), 0)
  const soldRooms = actualDays.reduce((sum, d) => sum + (d.soldRooms ?? 0), 0)
  const guests = actualDays.reduce((sum, d) => sum + (d.guests ?? 0), 0)
  const roomNights = hotel.totalRooms * actualDays.length
  const adr = soldRooms > 0 ? totalRevenue / soldRooms : 0
  const occupancyRate = roomNights > 0 ? soldRooms / roomNights : 0
  const revPar = roomNights > 0 ? totalRevenue / roomNights : 0

  return {
    hotelId,
    hotelName: hotel.name,
    year,
    month,
    totalRooms: hotel.totalRooms,
    summary: {
      roomRevenue: Math.round(totalRevenue),
      soldRooms,
      adr: Math.round(adr),
      occupancyRate: Math.round(occupancyRate * 1000) / 1000,
      revPar: Math.round(revPar),
      guests,
      daysWithActuals: actualDays.length,
      budgetRevenue: budget?.budgetRevenue ?? null,
      budgetRatio:
        budget?.budgetRevenue && budget.budgetRevenue > 0
          ? Math.round((totalRevenue / budget.budgetRevenue) * 1000) / 1000
          : null,
      lastYearRevenue: budget?.lastYearRevenue ?? null,
      lastYearRatio:
        budget?.lastYearRevenue && budget.lastYearRevenue > 0
          ? Math.round((totalRevenue / budget.lastYearRevenue) * 1000) / 1000
          : null,
    },
    dailyRows,
  }
}

function formatPercent(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 1000) / 10}%`
}

/**
 * Excel（.xlsx）レポート生成（F-REP-01）
 * シート構成: KPIサマリー + 日別明細表
 */
async function generateExcelReport(data: MonthlyReportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'AI Revenue Management System'
  workbook.created = new Date()

  const summarySheet = workbook.addWorksheet('KPIサマリー')
  summarySheet.columns = [
    { header: '項目', key: 'label', width: 24 },
    { header: '値', key: 'value', width: 20 },
  ]
  summarySheet.getRow(1).font = { bold: true }
  summarySheet.addRows([
    { label: 'ホテル', value: data.hotelName },
    { label: '対象年月', value: `${data.year}年${data.month}月` },
    { label: '売上（室料）', value: data.summary.roomRevenue },
    { label: '販売室数', value: data.summary.soldRooms },
    { label: 'ADR', value: data.summary.adr },
    { label: '稼働率', value: formatPercent(data.summary.occupancyRate) },
    { label: 'RevPAR', value: data.summary.revPar },
    { label: '宿泊人数', value: data.summary.guests },
    { label: '予算売上', value: data.summary.budgetRevenue ?? '—' },
    { label: '予算比', value: formatPercent(data.summary.budgetRatio) },
    { label: '前年売上', value: data.summary.lastYearRevenue ?? '—' },
    { label: '前年比', value: formatPercent(data.summary.lastYearRatio) },
    { label: '実績日数', value: data.summary.daysWithActuals },
  ])

  const dailySheet = workbook.addWorksheet('日別明細')
  dailySheet.columns = [
    { header: '日付', key: 'date', width: 12 },
    { header: '曜日', key: 'dayOfWeek', width: 6 },
    { header: '週末', key: 'isWeekend', width: 6 },
    { header: '祝日', key: 'isHoliday', width: 6 },
    { header: '稼働率', key: 'occupancy', width: 10 },
    { header: 'ADR', key: 'adr', width: 10 },
    { header: 'RevPAR', key: 'revPar', width: 10 },
    { header: '売上', key: 'totalRevenue', width: 12 },
    { header: '販売室数', key: 'soldRooms', width: 10 },
    { header: '宿泊人数', key: 'guests', width: 10 },
  ]
  dailySheet.getRow(1).font = { bold: true }
  for (const row of data.dailyRows) {
    dailySheet.addRow({
      date: row.date,
      dayOfWeek: row.dayOfWeek,
      isWeekend: row.isWeekend ? '○' : '',
      isHoliday: row.isHoliday ? '○' : '',
      occupancy: row.occupancy != null ? formatPercent(row.occupancy) : '—',
      adr: row.adr ?? '—',
      revPar: row.revPar ?? '—',
      totalRevenue: row.totalRevenue ?? '—',
      soldRooms: row.soldRooms ?? '—',
      guests: row.guests ?? '—',
    })
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * PDF レポート生成（F-REP-02）。日本語表示のため Noto Sans JP を埋め込む。
 */
async function generatePdfReport(data: MonthlyReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.registerFont('NotoSansJP', FONT_PATH)
    doc.font('NotoSansJP')

    doc.fontSize(18).text(`月次レポート ${data.year}年${data.month}月`, { align: 'left' })
    doc.fontSize(12).text(data.hotelName)
    doc.moveDown()

    doc.fontSize(14).text('KPIサマリー')
    doc.moveDown(0.5)
    doc.fontSize(10)
    const summaryLines: Array<[string, string]> = [
      ['売上（室料）', `${data.summary.roomRevenue.toLocaleString()} 円`],
      ['販売室数', `${data.summary.soldRooms.toLocaleString()} 室`],
      ['ADR', `${data.summary.adr.toLocaleString()} 円`],
      ['稼働率', formatPercent(data.summary.occupancyRate)],
      ['RevPAR', `${data.summary.revPar.toLocaleString()} 円`],
      ['宿泊人数', `${data.summary.guests.toLocaleString()} 人`],
      ['予算売上', data.summary.budgetRevenue != null ? `${Math.round(data.summary.budgetRevenue).toLocaleString()} 円` : '—'],
      ['予算比', formatPercent(data.summary.budgetRatio)],
      ['前年売上', data.summary.lastYearRevenue != null ? `${Math.round(data.summary.lastYearRevenue).toLocaleString()} 円` : '—'],
      ['前年比', formatPercent(data.summary.lastYearRatio)],
    ]
    for (const [label, value] of summaryLines) {
      doc.text(`${label}: ${value}`)
    }

    doc.moveDown()
    doc.fontSize(14).text('日別明細')
    doc.moveDown(0.5)
    doc.fontSize(8)

    const columns = ['日付', '曜日', '週末', '祝日', '稼働率', 'ADR', 'RevPAR', '売上', '販売室数', '宿泊人数']
    const columnWidths = [55, 30, 30, 30, 45, 50, 50, 65, 50, 50]
    const startX = doc.page.margins.left
    const pageBottom = doc.page.height - doc.page.margins.bottom

    function drawHeaderRow(y: number): number {
      let x = startX
      doc.font('NotoSansJP').fontSize(8)
      columns.forEach((col, i) => {
        doc.text(col, x, y, { width: columnWidths[i] })
        x += columnWidths[i]
      })
      return y + 14
    }

    let y = drawHeaderRow(doc.y)

    for (const row of data.dailyRows) {
      if (y > pageBottom - 14) {
        doc.addPage()
        y = drawHeaderRow(doc.page.margins.top)
      }
      const cells = [
        row.date,
        row.dayOfWeek,
        row.isWeekend ? '○' : '',
        row.isHoliday ? '○' : '',
        row.occupancy != null ? formatPercent(row.occupancy) : '—',
        row.adr != null ? row.adr.toLocaleString() : '—',
        row.revPar != null ? row.revPar.toLocaleString() : '—',
        row.totalRevenue != null ? row.totalRevenue.toLocaleString() : '—',
        row.soldRooms != null ? row.soldRooms.toLocaleString() : '—',
        row.guests != null ? row.guests.toLocaleString() : '—',
      ]
      let x = startX
      cells.forEach((cell, i) => {
        doc.text(cell, x, y, { width: columnWidths[i] })
        x += columnWidths[i]
      })
      y += 13
    }

    doc.end()
  })
}

function reportStorageKey(hotelId: string, year: number, month: number, format: 'pdf' | 'excel'): string {
  const ext = format === 'excel' ? 'xlsx' : 'pdf'
  return `reports/${hotelId}/${year}-${month}.${ext}`
}

/**
 * 月次レポートを取得する。storage に既存キャッシュがあればそれを返し、
 * なければ集計・生成して storage に保存してから返す。
 */
export async function getMonthlyReportService(
  hotelId: string,
  year: number,
  month: number,
  format: 'pdf' | 'excel'
): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const key = reportStorageKey(hotelId, year, month, format)
  const contentType =
    format === 'excel'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf'
  const filename = `monthly-report-${hotelId}-${year}-${String(month).padStart(2, '0')}.${format === 'excel' ? 'xlsx' : 'pdf'}`

  if (await storage.exists(key)) {
    const buffer = await storage.get(key)
    return { buffer, contentType, filename }
  }

  const data = await buildMonthlyReportData(hotelId, year, month)
  const buffer = format === 'excel' ? await generateExcelReport(data) : await generatePdfReport(data)
  await storage.put(key, buffer, contentType)

  return { buffer, contentType, filename }
}
