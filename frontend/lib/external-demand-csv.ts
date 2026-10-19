// 外部需要動向の規定フォーム（CSV）— イベントと周辺の新規ホテル（2026-10）。
// 一覧の CSV 出力と同じ列にしてあるので、出力したファイルを直してそのまま取り込める。
// 見出しは日本語名・英語名のどちらでもよく、列の順番は問わない。値の妥当性はバックエンドも検証する。

import { normalizeDate, parseNumber, readCsvTable, type CsvParseError } from "@/lib/csv"
import type { CsvValue } from "@/lib/csv-export"
import type { EventImportRow, ImpactLevel, NewHotelInput, NewHotelOpening } from "@/lib/api"
import type { Event as HotelEvent } from "@shared/types"

/** イベントの種別（コードと表示名。event-dialog の選択肢と同じ） */
export const EVENT_TYPES: Array<{ value: string; label: string }> = [
  { value: "concert", label: "コンサート" },
  { value: "sports", label: "スポーツ" },
  { value: "conference", label: "カンファレンス" },
  { value: "festival", label: "祭り・催事" },
  { value: "holiday", label: "年末年始・大型連休" },
  { value: "weather", label: "台風・災害" },
  { value: "other", label: "その他" },
]

const IMPACT_LABELS: Record<ImpactLevel, string> = { high: "高", medium: "中", low: "低" }
const TRUE_VALUES = ["○", "◯", "1", "true", "yes", "はい", "対象"]
const FALSE_VALUES = ["", "×", "0", "false", "no", "いいえ", "-"]

function parseImpact(value: string): ImpactLevel | null | undefined {
  const v = value.trim().toLowerCase()
  if (v === "") return undefined
  if (["高", "high", "大"].includes(v)) return "high"
  if (["中", "medium", "中程度"].includes(v)) return "medium"
  if (["低", "low", "小"].includes(v)) return "low"
  return null
}

function parseFlag(value: string): boolean | null {
  const v = value.trim().toLowerCase()
  if (TRUE_VALUES.includes(v)) return true
  if (FALSE_VALUES.includes(v)) return false
  return null
}

function parseEventType(value: string): string | null {
  const v = value.trim()
  const found = EVENT_TYPES.find((t) => t.value === v.toLowerCase() || t.label === v)
  return found ? found.value : null
}

export function eventTypeLabelOf(value: string): string {
  return EVENT_TYPES.find((t) => t.value === value)?.label ?? value
}

export function impactLabelOf(value: string | null | undefined): string {
  return value && value in IMPACT_LABELS ? IMPACT_LABELS[value as ImpactLevel] : ""
}

const dateKey = (value: Date | string) => (typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10))

// ---- イベント ----

export const EVENT_CSV_HEADER = ["イベント名", "種別", "開始日", "終了日", "開催場所", "影響度", "特殊日", "説明"]

export const EVENT_CSV_TEMPLATE =
  EVENT_CSV_HEADER.join(",") +
  "\n" +
  "市民花火大会,祭り・催事,2026-11-08,2026-11-08,河川敷,高,,雨天時は翌日\n" +
  "国際医学会,カンファレンス,2026-11-15,2026-11-17,国際会議場,高,,参加者 約3000人\n" +
  "年末年始,年末年始・大型連休,2026-12-29,2027-01-03,,高,○,特殊日は予測の基準から外す\n"

const EVENT_ALIASES = {
  name: ["name", "イベント名"],
  type: ["type", "種別"],
  startDate: ["startdate", "開始日"],
  endDate: ["enddate", "終了日"],
  location: ["location", "開催場所"],
  expectedImpact: ["expectedimpact", "影響度"],
  excludeFromHistory: ["excludefromhistory", "特殊日"],
  description: ["description", "説明"],
}

export function parseEventCsv(text: string): { rows: EventImportRow[]; errors: CsvParseError[] } {
  const table = readCsvTable(text, EVENT_ALIASES, ["name", "type", "startDate"])
  if (table.errors.length > 0) return { rows: [], errors: table.errors }
  const { index } = table
  const cell = (cells: string[], i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "")
  const rows: EventImportRow[] = []
  const errors: CsvParseError[] = []
  for (const { line, cells } of table.lines) {
    const name = cell(cells, index.name)
    const type = parseEventType(cell(cells, index.type))
    const startDate = normalizeDate(cell(cells, index.startDate))
    const endRaw = cell(cells, index.endDate)
    const endDate = endRaw === "" ? startDate : normalizeDate(endRaw)
    const impact = parseImpact(cell(cells, index.expectedImpact))
    const special = parseFlag(cell(cells, index.excludeFromHistory))

    const problems: string[] = []
    if (!name) problems.push("イベント名を入力してください")
    if (name.length > 200) problems.push("イベント名は200文字以内で入力してください")
    if (!type) problems.push(`種別は ${EVENT_TYPES.map((t) => t.label).join("・")} のいずれかで入力してください`)
    if (!startDate) problems.push("開始日は YYYY-MM-DD または YYYY/M/D 形式で入力してください")
    if (!endDate) problems.push("終了日は YYYY-MM-DD または YYYY/M/D 形式で入力してください")
    if (startDate && endDate && startDate > endDate) problems.push("終了日は開始日以降にしてください")
    if (impact === null) problems.push("影響度は 高・中・低 のいずれかで入力してください")
    if (special === null) problems.push("特殊日は ○ か空欄で入力してください")
    if (problems.length > 0) {
      errors.push({ line, message: problems.join("／") })
      continue
    }
    const location = cell(cells, index.location)
    const description = cell(cells, index.description)
    rows.push({
      name,
      type: type!,
      startDate: startDate!,
      endDate: endDate!,
      ...(location && { location }),
      ...(impact && { expectedImpact: impact }),
      ...(description && { description }),
      excludeFromHistory: special ?? false,
    })
  }
  return { rows, errors }
}

/** 一覧の CSV（取り込みの規定フォームと同じ列） */
export function eventsToCsvRows(events: HotelEvent[]): CsvValue[][] {
  return [
    EVENT_CSV_HEADER,
    ...events.map((e) => [
      e.name,
      eventTypeLabelOf(e.type),
      dateKey(e.startDate),
      dateKey(e.endDate),
      e.location ?? "",
      impactLabelOf(e.expectedImpact),
      Boolean(e.excludeFromHistory),
      e.description ?? "",
    ]),
  ]
}

// ---- 周辺の新規ホテル ----

export const NEW_HOTEL_CSV_HEADER = ["ホテル名", "開業日", "客室数", "カテゴリ", "所在地", "距離(km)", "影響度", "メモ"]

export const NEW_HOTEL_CSV_TEMPLATE =
  NEW_HOTEL_CSV_HEADER.join(",") +
  "\n" +
  "ステーションホテル新館,2026-12-01,220,ビジネス,駅北口,0.4,高,同価格帯\n" +
  "グランドリゾート湾岸,2027-03-15,310,リゾート,湾岸エリア,3.2,中,\n"

const NEW_HOTEL_ALIASES = {
  name: ["name", "ホテル名"],
  openingDate: ["openingdate", "開業日"],
  rooms: ["rooms", "客室数"],
  category: ["category", "カテゴリ"],
  location: ["location", "所在地"],
  distanceKm: ["distancekm", "距離(km)", "距離（km）", "距離"],
  expectedImpact: ["expectedimpact", "影響度"],
  notes: ["notes", "メモ"],
}

export function parseNewHotelCsv(text: string): { rows: NewHotelInput[]; errors: CsvParseError[] } {
  const table = readCsvTable(text, NEW_HOTEL_ALIASES, ["name", "openingDate"])
  if (table.errors.length > 0) return { rows: [], errors: table.errors }
  const { index } = table
  const cell = (cells: string[], i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "")
  const rows: NewHotelInput[] = []
  const errors: CsvParseError[] = []
  for (const { line, cells } of table.lines) {
    const name = cell(cells, index.name)
    const openingDate = normalizeDate(cell(cells, index.openingDate))
    const rooms = parseNumber(cell(cells, index.rooms))
    const distanceKm = parseNumber(cell(cells, index.distanceKm))
    const impact = parseImpact(cell(cells, index.expectedImpact))

    const problems: string[] = []
    if (!name) problems.push("ホテル名を入力してください")
    if (!openingDate) problems.push("開業日は YYYY-MM-DD または YYYY/M/D 形式で入力してください")
    if (rooms !== null && (Number.isNaN(rooms) || !Number.isInteger(rooms) || rooms < 1)) problems.push("客室数は1以上の整数で入力してください")
    if (distanceKm !== null && (Number.isNaN(distanceKm) || distanceKm < 0)) problems.push("距離は0以上の数値（km）で入力してください")
    if (impact === null) problems.push("影響度は 高・中・低 のいずれかで入力してください")
    if (problems.length > 0) {
      errors.push({ line, message: problems.join("／") })
      continue
    }
    rows.push({
      name,
      openingDate: openingDate!,
      rooms,
      category: cell(cells, index.category) || null,
      location: cell(cells, index.location) || null,
      distanceKm,
      expectedImpact: impact ?? null,
      notes: cell(cells, index.notes) || null,
    })
  }
  return { rows, errors }
}

export function newHotelsToCsvRows(hotels: NewHotelOpening[]): CsvValue[][] {
  return [
    NEW_HOTEL_CSV_HEADER,
    ...hotels.map((h) => [
      h.name,
      h.openingDate.slice(0, 10),
      h.rooms,
      h.category ?? "",
      h.location ?? "",
      h.distanceKm,
      impactLabelOf(h.expectedImpact),
      h.notes ?? "",
    ]),
  ]
}
