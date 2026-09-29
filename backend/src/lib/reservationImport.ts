// 予約明細CSV → プロダクトの実績データへの変換（現地テスト用・Phase 4 の前段）。
//
// 明日の現地テスト時点では実際の列名が分からないため、
// 「列名 → 意味」の対応表（マッピング）を外から渡す設計にしている。
// 現地でCSVの列が判明したら JSON を1つ書くだけで取込が通る。
//
// DB は触らない純粋関数のみを置く（永続化は services/importService.ts）。
// ここを純粋にしてあるのは、実ファイルが無い状態でもテストで挙動を固定できるようにするため。

import { z } from 'zod'
import { dateOnly } from './date.js'

// ======================================
// マッピング定義
// ======================================

/**
 * 列マッピング。値はCSVのヘッダー名をそのまま書く。
 *
 * 宿泊日の指定は次のどちらか:
 *   - `stayDate`: 1泊1行で出力されるCSV（そのまま使う）
 *   - `checkInDate` + `nights`: 1予約1行で泊数を持つCSV（泊数分に展開する）
 */
export const reservationMappingSchema = z
  .object({
    stayDate: z.string().min(1).optional(),
    checkInDate: z.string().min(1).optional(),
    nights: z.string().min(1).optional(),
    /** 室数。列が無い場合は1行1室として扱う */
    rooms: z.string().min(1).optional(),
    guests: z.string().min(1).optional(),
    /** 室料（税サ・食事を含まない室料が望ましい。含む場合は取込後に注記が必要） */
    revenue: z.string().min(1).optional(),
    /** revenue が1予約の総額なら 'per-stay'、1泊あたりなら 'per-night'（既定） */
    revenueScope: z.enum(['per-night', 'per-stay']).default('per-night'),
    /** 予約受付日（A2）。無い場合はブッキングカーブを作れない */
    bookedAt: z.string().min(1).optional(),
    /** 取消日（A3） */
    cancelledAt: z.string().min(1).optional(),
    /** 予約ステータス列と、キャンセルを意味する値（取消日が無いCSV向け） */
    status: z.string().min(1).optional(),
    cancelStatusValues: z.array(z.string().min(1)).default([]),
    /** 販売先（A6）。OtaChannelData.channel になる */
    channel: z.string().min(1).optional(),
    /** CSV上の販売先名 → プロダクト側のチャネル名（例 {"じゃらんnet":"じゃらん"}） */
    channelAliases: z.record(z.string()).default({}),
    /** 室タイプ。値は RoomType.code と突き合わせる */
    roomTypeCode: z.string().min(1).optional(),
  })
  .refine((m) => Boolean(m.stayDate) || Boolean(m.checkInDate), {
    message: 'stayDate か checkInDate のどちらかは必須です',
  })

export type ReservationMapping = z.infer<typeof reservationMappingSchema>

// ======================================
// 正規化
// ======================================

/** 1宿泊日ぶんに展開済みの予約レコード */
export interface ReservationRecord {
  /** 宿泊日（date-only） */
  stayDate: Date
  rooms: number
  guests: number | null
  /** その宿泊日ぶんの室料 */
  revenue: number | null
  channel: string | null
  roomTypeCode: string | null
  /** 予約受付日（date-only）。CSVに列が無ければ null */
  bookedOn: Date | null
  /** 取消日（date-only）。キャンセルされていなければ null */
  cancelledOn: Date | null
}

export interface NormalizeResult {
  records: ReservationRecord[]
  /** 取り込めなかった行（行番号は1始まり・ヘッダーを除いた番号） */
  skipped: { row: number; reason: string }[]
  /** キャンセルと判定した行数（レコードには残るが実績集計からは除く） */
  cancelledRows: number
  /** 泊数展開で増えた宿泊日数 */
  expandedNights: number
}

/** 「1,234」「¥12,000」「12000円」などを数値にする。空なら null */
export function parseAmount(raw: string | undefined): number | null {
  if (raw == null) return null
  const cleaned = raw.replace(/[,\s¥￥円]/g, '')
  if (cleaned === '' || cleaned === '-') return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/**
 * 日付文字列を date-only の Date にする。
 * `2026/09/15`・`2026-09-15 14:30`・`20260915`・`2026年9月15日` を受け付ける。
 * 時刻部分は捨てる（日単位より細かい粒度は現在の受け皿に無い）。
 *
 * タイムゾーン変換はしない: CSVの日付はJSTの暦日そのものなので、
 * そのまま暦日として扱わないと1日ずれる。
 */
export function parseCalendarDate(raw: string | undefined): Date | null {
  if (!raw) return null
  const text = raw.trim()
  if (text === '') return null

  const ymd = text.match(/^(\d{4})[/\-年.](\d{1,2})[/\-月.](\d{1,2})/)
  if (ymd) {
    const [, y, m, d] = ymd
    return dateOnly(new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))))
  }

  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact) {
    const [, y, m, d] = compact
    return dateOnly(new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))))
  }

  return null
}

/** 日数差（b - a）を日単位で返す */
export function diffInDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

/**
 * CSVのレコード列を ReservationRecord[] に正規化する。
 * 1予約1行（泊数付き）のCSVは宿泊日ごとの行に展開する。
 */
export function normalizeReservations(
  rows: Record<string, string>[],
  mapping: ReservationMapping
): NormalizeResult {
  const records: ReservationRecord[] = []
  const skipped: { row: number; reason: string }[] = []
  let cancelledRows = 0
  let expandedNights = 0

  rows.forEach((row, index) => {
    const rowNumber = index + 1

    const firstDate = parseCalendarDate(
      mapping.stayDate ? row[mapping.stayDate] : row[mapping.checkInDate as string]
    )
    if (!firstDate) {
      skipped.push({ row: rowNumber, reason: '宿泊日（またはチェックイン日）が読めない' })
      return
    }

    const rooms = mapping.rooms ? (parseAmount(row[mapping.rooms]) ?? 0) : 1
    if (rooms <= 0) {
      skipped.push({ row: rowNumber, reason: '室数が0または負の値' })
      return
    }

    const cancelledOn = mapping.cancelledAt ? parseCalendarDate(row[mapping.cancelledAt]) : null
    const statusValue = mapping.status ? row[mapping.status] : undefined
    const cancelledByStatus =
      statusValue != null && mapping.cancelStatusValues.includes(statusValue.trim())
    if (cancelledOn || cancelledByStatus) cancelledRows++

    const nights = mapping.stayDate ? 1 : Math.max(1, Math.round(parseAmount(row[mapping.nights ?? '']) ?? 1))
    if (nights > 1) expandedNights += nights - 1

    const totalRevenue = mapping.revenue ? parseAmount(row[mapping.revenue]) : null
    const revenuePerNight =
      totalRevenue == null ? null : mapping.revenueScope === 'per-stay' ? totalRevenue / nights : totalRevenue

    const guests = mapping.guests ? parseAmount(row[mapping.guests]) : null
    const rawChannel = mapping.channel ? row[mapping.channel]?.trim() : undefined
    const channel = rawChannel ? (mapping.channelAliases[rawChannel] ?? rawChannel) : null
    const roomTypeCode = mapping.roomTypeCode ? row[mapping.roomTypeCode]?.trim() || null : null

    for (let night = 0; night < nights; night++) {
      const stayDate = new Date(firstDate)
      stayDate.setUTCDate(stayDate.getUTCDate() + night)
      records.push({
        stayDate,
        rooms,
        guests,
        revenue: revenuePerNight,
        channel,
        roomTypeCode,
        bookedOn: mapping.bookedAt ? parseCalendarDate(row[mapping.bookedAt]) : null,
        // ステータスだけでキャンセルが分かる場合は日付が無いので、
        // 「いつキャンセルされたか不明」を表す番兵として宿泊日を使う
        // （カーブ復元では bookedOn <= 時点 < cancelledOn で判定するため、
        //  宿泊日まではブッキング済みとして数えられる）
        cancelledOn: cancelledOn ?? (cancelledByStatus ? stayDate : null),
      })
    }
  })

  return { records, skipped, cancelledRows, expandedNights }
}

// ======================================
// 集計
// ======================================

const dateKey = (d: Date) => d.toISOString().slice(0, 10)

/** キャンセルを除いた実績のみを対象にする */
function activeRecords(records: ReservationRecord[]): ReservationRecord[] {
  return records.filter((r) => r.cancelledOn == null)
}

export interface DailyAggregate {
  date: Date
  soldRooms: number
  guests: number | null
  totalRevenue: number | null
  adr: number | null
  occupancy: number | null
  revPar: number | null
}

/**
 * 日別実績（DailyData 相当）。
 * occupancy / revPar は販売可能室数（totalRooms）が分かる場合のみ算出する。
 */
export function aggregateDaily(records: ReservationRecord[], totalRooms?: number): DailyAggregate[] {
  const buckets = new Map<string, { date: Date; rooms: number; guests: number; hasGuests: boolean; revenue: number; hasRevenue: boolean }>()

  for (const record of activeRecords(records)) {
    const key = dateKey(record.stayDate)
    const bucket = buckets.get(key) ?? {
      date: record.stayDate,
      rooms: 0,
      guests: 0,
      hasGuests: false,
      revenue: 0,
      hasRevenue: false,
    }
    bucket.rooms += record.rooms
    if (record.guests != null) {
      bucket.guests += record.guests
      bucket.hasGuests = true
    }
    if (record.revenue != null) {
      bucket.revenue += record.revenue
      bucket.hasRevenue = true
    }
    buckets.set(key, bucket)
  }

  return [...buckets.values()]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((bucket) => {
      const totalRevenue = bucket.hasRevenue ? Math.round(bucket.revenue) : null
      const adr = totalRevenue != null && bucket.rooms > 0 ? Math.round(totalRevenue / bucket.rooms) : null
      const occupancy =
        totalRooms && totalRooms > 0 ? Math.round((bucket.rooms / totalRooms) * 1000) / 10 : null
      const revPar =
        totalRevenue != null && totalRooms && totalRooms > 0 ? Math.round(totalRevenue / totalRooms) : null
      return {
        date: bucket.date,
        soldRooms: bucket.rooms,
        guests: bucket.hasGuests ? bucket.guests : null,
        totalRevenue,
        adr,
        occupancy,
        revPar,
      }
    })
}

export interface ChannelAggregate {
  date: Date
  channel: string
  roomsSold: number
  revenue: number | null
  adr: number | null
}

/** チャネル別日次実績（OtaChannelData 相当）。販売先列が無いCSVでは空になる */
export function aggregateByChannel(records: ReservationRecord[]): ChannelAggregate[] {
  const buckets = new Map<string, { date: Date; channel: string; rooms: number; revenue: number; hasRevenue: boolean }>()

  for (const record of activeRecords(records)) {
    if (!record.channel) continue
    const key = `${dateKey(record.stayDate)}|${record.channel}`
    const bucket = buckets.get(key) ?? {
      date: record.stayDate,
      channel: record.channel,
      rooms: 0,
      revenue: 0,
      hasRevenue: false,
    }
    bucket.rooms += record.rooms
    if (record.revenue != null) {
      bucket.revenue += record.revenue
      bucket.hasRevenue = true
    }
    buckets.set(key, bucket)
  }

  return [...buckets.values()]
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.channel.localeCompare(b.channel))
    .map((bucket) => {
      const revenue = bucket.hasRevenue ? Math.round(bucket.revenue) : null
      return {
        date: bucket.date,
        channel: bucket.channel,
        roomsSold: bucket.rooms,
        revenue,
        adr: revenue != null && bucket.rooms > 0 ? Math.round(revenue / bucket.rooms) : null,
      }
    })
}

export interface RoomTypeAggregate {
  date: Date
  roomTypeCode: string
  soldRooms: number
  revenue: number | null
}

/** 客室タイプ別日次実績（DailyRoomData 相当） */
export function aggregateByRoomType(records: ReservationRecord[]): RoomTypeAggregate[] {
  const buckets = new Map<string, { date: Date; roomTypeCode: string; rooms: number; revenue: number; hasRevenue: boolean }>()

  for (const record of activeRecords(records)) {
    if (!record.roomTypeCode) continue
    const key = `${dateKey(record.stayDate)}|${record.roomTypeCode}`
    const bucket = buckets.get(key) ?? {
      date: record.stayDate,
      roomTypeCode: record.roomTypeCode,
      rooms: 0,
      revenue: 0,
      hasRevenue: false,
    }
    bucket.rooms += record.rooms
    if (record.revenue != null) {
      bucket.revenue += record.revenue
      bucket.hasRevenue = true
    }
    buckets.set(key, bucket)
  }

  return [...buckets.values()]
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.roomTypeCode.localeCompare(b.roomTypeCode))
    .map((bucket) => ({
      date: bucket.date,
      roomTypeCode: bucket.roomTypeCode,
      soldRooms: bucket.rooms,
      revenue: bucket.hasRevenue ? Math.round(bucket.revenue) : null,
    }))
}

export interface CurvePoint {
  stayDate: Date
  daysBefore: number
  roomsBooked: number
}

/**
 * 予約受付日（A2）からブッキングカーブを遡って再構成する（Issue #24 E2）。
 *
 * 「宿泊日の N 日前時点で何室積み上がっていたか」を、
 *   bookedOn <= 時点  かつ  （取消なし または 取消日 > 時点）
 * の室数を数えることで求める。
 *
 * asOf（＝データを取得した日）より未来の時点は実測不能なので出力しない。
 * 受付日が無いレコードは数えられないため、結果は空になる。
 */
export function reconstructBookingCurve(
  records: ReservationRecord[],
  options: { asOf: Date; maxDaysBefore?: number }
): CurvePoint[] {
  const maxDaysBefore = options.maxDaysBefore ?? 120
  const byStayDate = new Map<string, ReservationRecord[]>()

  for (const record of records) {
    if (!record.bookedOn) continue
    const key = dateKey(record.stayDate)
    const list = byStayDate.get(key) ?? []
    list.push(record)
    byStayDate.set(key, list)
  }

  const points: CurvePoint[] = []

  for (const list of byStayDate.values()) {
    const stayDate = list[0].stayDate
    for (let daysBefore = maxDaysBefore; daysBefore >= 0; daysBefore--) {
      const asOfPoint = new Date(stayDate)
      asOfPoint.setUTCDate(asOfPoint.getUTCDate() - daysBefore)
      // 未来の時点は分からない
      if (asOfPoint.getTime() > options.asOf.getTime()) continue

      const roomsBooked = list.reduce((sum, record) => {
        if (!record.bookedOn || record.bookedOn.getTime() > asOfPoint.getTime()) return sum
        if (record.cancelledOn && record.cancelledOn.getTime() <= asOfPoint.getTime()) return sum
        return sum + record.rooms
      }, 0)

      // 予約が1件も入っていない期間の行は作らない（DBを無意味に膨らませない）
      if (roomsBooked === 0) continue
      points.push({ stayDate, daysBefore, roomsBooked })
    }
  }

  return points.sort(
    (a, b) => a.stayDate.getTime() - b.stayDate.getTime() || b.daysBefore - a.daysBefore
  )
}

// ======================================
// 施設・取得元の分離（同じテナント内の施設取り違えと、取得元同士の上書きを防ぐ）
// ======================================

/** 取込が書き込む先。DailyData / DailyRoomData / OtaChannelData / BookingCurveData に対応 */
export const IMPORT_TARGETS = ['daily', 'roomType', 'channel', 'curve'] as const
export type ImportTarget = (typeof IMPORT_TARGETS)[number]

export class ImportTargetConflictError extends Error {
  constructor(public readonly conflicts: { target: ImportTarget; source: string }[]) {
    super(
      `書き込み先が他の取得元と重なっています: ${conflicts
        .map((c) => `${c.target}（${c.source} が担当）`)
        .join(', ')}`
    )
  }
}

/**
 * 取得元の書き込み先を決める。
 *
 * 同じホテルに TL-リンカーン と NEHOPS の両方を繋ぐと、どちらも同じ日別実績を
 * 書こうとして後勝ちになる。そこで「1つの書き込み先を担当する取得元は1つだけ」とし、
 * 重なる指定は保存時に拒否する。
 *
 * - requested を省略した場合は、他の取得元が担当していない書き込み先をすべて受け持つ
 *   （TLだけ先に繋いだ段階ではTLが全部を担当し、画面が実データで埋まる）
 * - 2つ目の取得元を足すときは、先に1つ目の担当を減らしてから割り当てる必要がある
 *   ＝どちらを正とするかを必ず人が決める
 */
export function resolveImportTargets(
  requested: readonly ImportTarget[] | undefined,
  claimedByOthers: { source: string; targets: readonly ImportTarget[] }[]
): ImportTarget[] {
  const owner = new Map<ImportTarget, string>()
  for (const other of claimedByOthers) {
    for (const target of other.targets) owner.set(target, other.source)
  }

  if (!requested) {
    const free = IMPORT_TARGETS.filter((t) => !owner.has(t))
    if (free.length === 0) {
      throw new ImportTargetConflictError(
        IMPORT_TARGETS.map((t) => ({ target: t, source: owner.get(t) as string }))
      )
    }
    return [...free]
  }

  const conflicts = requested
    .filter((t) => owner.has(t))
    .map((t) => ({ target: t, source: owner.get(t) as string }))
  if (conflicts.length > 0) throw new ImportTargetConflictError(conflicts)

  // 並びを固定しておく（保存値の比較・表示を安定させる）
  return IMPORT_TARGETS.filter((t) => requested.includes(t))
}

export interface FacilityCheckResult {
  ok: boolean
  /** 照合列そのものがCSVに無い */
  missingColumn: boolean
  /** 許可されていない値と、その行数 */
  unexpected: { value: string; rows: number }[]
  /** 照合した行数 */
  checkedRows: number
}

/**
 * CSVが「このホテルの」データかを施設コード（または施設名）の列で照合する。
 *
 * 1行でも許可外の値があればファイルごと不合格にする（fail closed）。
 * 他施設の実績が混ざる事故は、取り込めない事故より取り返しがつかないため。
 * 取り込めなかった場合は取込履歴に失敗として残り、欠損検知のアラートで気づける。
 *
 * チェーンで1つのTLアカウントが複数施設を管理していると、1本のCSVに複数施設の
 * 行が入ることがある。その場合も許可外の施設が1行でもあれば取り込まない。
 */
export function checkFacility(
  rows: Record<string, string>[],
  column: string,
  allowedValues: readonly string[]
): FacilityCheckResult {
  if (rows.length > 0 && !(column in rows[0])) {
    return { ok: false, missingColumn: true, unexpected: [], checkedRows: 0 }
  }

  const allowed = new Set(allowedValues.map((v) => v.trim()))
  const counts = new Map<string, number>()
  for (const row of rows) {
    const value = (row[column] ?? '').trim()
    if (allowed.has(value)) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  const unexpected = [...counts.entries()]
    .map(([value, count]) => ({ value: value === '' ? '（空欄）' : value, rows: count }))
    .sort((a, b) => b.rows - a.rows)

  return { ok: unexpected.length === 0, missingColumn: false, unexpected, checkedRows: rows.length }
}
