// 予約明細CSVの調査・取込CLI（現地テスト用）。
//
//   1) 列を調べる（DB不要・マッピング不要）
//      pnpm --filter backend import:reservations -- --file ./予約明細.csv --inspect
//
//   2) 変換結果を確認する（DBは読むだけ・書き込まない）
//      pnpm --filter backend import:reservations -- --file ./予約明細.csv \
//        --mapping ./mapping.json --hotel-id <hotelId>
//
//   3) 実際に取り込む（--write を明示したときだけ書き込む）
//      pnpm --filter backend import:reservations -- --file ./予約明細.csv \
//        --mapping ./mapping.json --hotel-id <hotelId> --write
//
// 既定が dry-run なのは、現地で出したCSVをその場で流し込んで
// seed データや既存実績を意図せず上書きするのを防ぐため。

import { readFileSync } from 'node:fs'
import { decodeCsv, parseCsv, toRecords } from '../lib/csv.js'
import { todayJst } from '../lib/date.js'
import {
  normalizeReservations,
  parseCalendarDate,
  reservationMappingSchema,
} from '../lib/reservationImport.js'

interface CliOptions {
  file: string
  mapping?: string
  hotelId?: string
  encoding: string
  delimiter: string
  asOf: Date
  maxDaysBefore: number
  inspect: boolean
  write: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const get = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const has = (name: string) => argv.includes(`--${name}`)

  const file = get('file')
  if (!file) {
    throw new Error('--file <CSVのパス> を指定してください')
  }

  const asOfRaw = get('as-of')
  const asOf = asOfRaw ? parseCalendarDate(asOfRaw) : todayJst()
  if (!asOf) throw new Error('--as-of は YYYY-MM-DD で指定してください')

  const delimiterRaw = get('delimiter') ?? ','
  return {
    file,
    mapping: get('mapping'),
    hotelId: get('hotel-id'),
    encoding: get('encoding') ?? 'cp932',
    delimiter: delimiterRaw === 'tab' ? '\t' : delimiterRaw,
    asOf,
    maxDaysBefore: Number(get('max-days-before') ?? 120),
    inspect: has('inspect'),
    write: has('write'),
  }
}

/** 列ごとの中身を要約する（現地で列の意味を判断するための材料） */
function inspect(headers: string[], records: Record<string, string>[]): void {
  console.log(`\n行数: ${records.length}（ヘッダーを除く） / 列数: ${headers.length}\n`)
  console.log('No. 列名 | 空率 | サンプル')
  console.log('-'.repeat(80))

  headers.forEach((header, index) => {
    const values = records.map((r) => r[header]).filter((v) => v !== '')
    const emptyRate = records.length === 0 ? 0 : Math.round(((records.length - values.length) / records.length) * 100)
    const samples = [...new Set(values)].slice(0, 3).join(' / ')
    console.log(`${String(index + 1).padStart(3)} ${header} | 空 ${emptyRate}% | ${samples}`)
  })

  // 日付として読める列は期間も出す（A5 の遡及可能期間の確認に使う）
  console.log('\n日付として解釈できた列の期間:')
  let found = false
  for (const header of headers) {
    const dates = records
      .map((r) => parseCalendarDate(r[header]))
      .filter((d): d is Date => d != null)
      .map((d) => d.getTime())
    if (dates.length < Math.max(1, records.length * 0.5)) continue
    found = true
    const min = new Date(Math.min(...dates)).toISOString().slice(0, 10)
    const max = new Date(Math.max(...dates)).toISOString().slice(0, 10)
    console.log(`  ${header}: ${min} 〜 ${max}`)
  }
  if (!found) console.log('  （なし）')

  console.log(
    '\n次の列があるかを確認する: 宿泊日/チェックイン日・泊数・室数・人数・室料・' +
      '予約受付日(A2)・取消日またはステータス(A3)・団体区分(A4)・販売先(A6)・室タイプ'
  )
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  const text = decodeCsv(readFileSync(options.file), options.encoding)
  const { headers, records } = toRecords(parseCsv(text, options.delimiter))

  if (headers.length <= 1) {
    console.warn(
      '⚠ 列が1つしか取れていない。--delimiter tab や --encoding utf8 を試すこと'
    )
  }

  if (options.inspect || !options.mapping) {
    inspect(headers, records)
    if (!options.mapping) {
      console.log('\n（--mapping を渡すと集計結果のプレビューまで進む）')
    }
    return
  }

  const mapping = reservationMappingSchema.parse(
    JSON.parse(readFileSync(options.mapping, 'utf8'))
  )

  // マッピングに書いた列名がCSVに存在するかを先に確かめる（typoの早期検出）
  const mappedColumns = Object.entries(mapping)
    .filter(([key, value]) => typeof value === 'string' && key !== 'revenueScope')
    .map(([, value]) => value as string)
  const missing = mappedColumns.filter((column) => !headers.includes(column))
  if (missing.length > 0) {
    throw new Error(`マッピングの列がCSVに見つからない: ${missing.join(', ')}`)
  }

  const normalized = normalizeReservations(records, mapping)
  console.log(`\n正規化: ${normalized.records.length}行（宿泊日単位に展開後）`)
  console.log(`  泊数展開で増えた行: ${normalized.expandedNights}`)
  console.log(`  キャンセル判定: ${normalized.cancelledRows}行（実績集計から除外）`)
  if (normalized.skipped.length > 0) {
    console.log(`  取り込めなかった行: ${normalized.skipped.length}`)
    normalized.skipped.slice(0, 5).forEach((s) => console.log(`    行${s.row}: ${s.reason}`))
  }
  if (!mapping.bookedAt) {
    console.log('  ⚠ bookedAt（予約受付日）が未指定 — ブッキングカーブは作られない（A2）')
  }

  if (!options.hotelId) {
    console.log('\n--hotel-id が無いため集計プレビューまでで終了する')
    return
  }

  const { importReservationDataService } = await import('../services/importService.js')
  const summary = await importReservationDataService({
    hotelId: options.hotelId,
    records: normalized.records,
    asOf: options.asOf,
    maxDaysBefore: options.maxDaysBefore,
    dryRun: !options.write,
  })

  console.log(`\n対象ホテル: ${summary.hotel.name}（総客室数 ${summary.hotel.totalRooms}）`)
  console.log(`宿泊日の範囲: ${summary.stayDateFrom ?? '-'} 〜 ${summary.stayDateTo ?? '-'}`)
  console.log(`日別実績(DailyData): ${summary.dailyRows}日`)
  console.log(`客室タイプ別(DailyRoomData): ${summary.roomTypeRows}行`)
  console.log(`チャネル別(OtaChannelData): ${summary.channelRows}行 — ${summary.channels.join(', ') || 'なし'}`)
  console.log(`ブッキングカーブ(BookingCurveData): ${summary.curveRows}点`)
  if (summary.unknownRoomTypeCodes.length > 0) {
    console.log(
      `⚠ RoomType.code に無い室タイプ: ${summary.unknownRoomTypeCodes.join(', ')}（取り込まない）`
    )
  }
  console.log(summary.written ? '\n✅ 書き込み完了' : '\nℹ️ dry-run（--write を付けると書き込む）')

  const { disconnectDatabase } = await import('../services/healthService.js')
  await disconnectDatabase()
}

main().catch((error) => {
  console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
