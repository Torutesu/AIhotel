import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { parsePriceRankSheet, parseDailyActualSheet, parseOtaChannelSheet } from './importService.js'

// Excel取込のパースロジック（DB非依存の純粋処理）のテスト。
// exceljs でワークシートを組み立てて直接パーサーに渡す。

function buildSheet(headers: readonly string[], rows: unknown[][]): ExcelJS.Worksheet {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('test')
  sheet.addRow([...headers])
  for (const row of rows) sheet.addRow(row)
  return sheet
}

const PRICE_RANK_HEADERS = ['ランク', 'ラベル', '1名料金', '2名料金', '3名料金', '4名料金']
const DAILY_HEADERS = ['日付', '販売室数', 'ADR', '売上', '宿泊者数', '稼働率(%)', '備考']

describe('parsePriceRankSheet', () => {
  it('正常な行をパースする（3名・4名料金は空欄可）', () => {
    const sheet = buildSheet(PRICE_RANK_HEADERS, [
      [1, 'R01', 6500, 9100, 11700, null],
      [2, 'R02', 7100, 9900, null, null],
    ])
    const { rows, errors } = parsePriceRankSheet(sheet)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ rank: 1, label: 'R01', price1P: 6500, price3P: 11700, price4P: null })
    expect(rows[1]).toMatchObject({ rank: 2, price3P: null })
  })

  it('ヘッダーが一致しないファイルは拒否する', () => {
    const sheet = buildSheet(['Rank', 'Label', 'P1', 'P2', 'P3', 'P4'], [[1, 'R01', 6500, 9100, null, null]])
    expect(() => parsePriceRankSheet(sheet)).toThrowError(/ヘッダーが一致しません/)
  })

  it('ランク41以上・重複ランクは行エラーになる', () => {
    const sheet = buildSheet(PRICE_RANK_HEADERS, [
      [41, 'R41', 6500, 9100, null, null],
      [1, 'R01', 6500, 9100, null, null],
      [1, 'R01x', 7000, 9500, null, null],
    ])
    const { rows, errors } = parsePriceRankSheet(sheet)
    expect(rows).toHaveLength(1)
    expect(errors).toHaveLength(2)
    expect(errors[0].row).toBe(2) // ランク41
    expect(errors[1].message).toContain('重複')
  })

  it('数値として解釈できないセルは行エラーになる', () => {
    const sheet = buildSheet(PRICE_RANK_HEADERS, [[1, 'R01', 'abc', 9100, null, null]])
    const { errors } = parsePriceRankSheet(sheet)
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('数値として解釈できない')
  })

  it('空行はスキップし、取り込める行がなければエラーを返す', () => {
    const sheet = buildSheet(PRICE_RANK_HEADERS, [[null, null, null, null, null, null]])
    const { rows, errors } = parsePriceRankSheet(sheet)
    expect(rows).toHaveLength(0)
    expect(errors[0].message).toContain('取り込める行がありません')
  })

  it('カンマ・円記号付きの金額文字列も受け付ける', () => {
    const sheet = buildSheet(PRICE_RANK_HEADERS, [[1, 'R01', '¥6,500', '9,100', null, null]])
    const { rows, errors } = parsePriceRankSheet(sheet)
    expect(errors).toEqual([])
    expect(rows[0]).toMatchObject({ price1P: 6500, price2P: 9100 })
  })
})

describe('parseDailyActualSheet', () => {
  it('日付セル・文字列日付の両方をUTC日付としてパースする', () => {
    const sheet = buildSheet(DAILY_HEADERS, [
      [new Date(Date.UTC(2026, 7, 1)), 165, 18200, 3003000, 220, 82.5, 'メモ'],
      ['2026-08-02', 150, null, null, null, null, null],
      ['2026/08/03', null, null, null, null, 90, null],
    ])
    const { rows, errors } = parseDailyActualSheet(sheet)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(3)
    expect(rows[0].date.toISOString().slice(0, 10)).toBe('2026-08-01')
    expect(rows[1].date.toISOString().slice(0, 10)).toBe('2026-08-02')
    expect(rows[2].date.toISOString().slice(0, 10)).toBe('2026-08-03')
  })

  it('稼働率は%表記（82.5）を0〜1に正規化し、小数表記（0.825）はそのまま扱う', () => {
    const sheet = buildSheet(DAILY_HEADERS, [
      ['2026-08-01', null, null, null, null, 82.5, null],
      ['2026-08-02', null, null, null, null, 0.825, null],
    ])
    const { rows, errors } = parseDailyActualSheet(sheet)
    expect(errors).toEqual([])
    expect(rows[0].occupancy).toBeCloseTo(0.825, 5)
    expect(rows[1].occupancy).toBeCloseTo(0.825, 5)
  })

  it('日付が不正な行・実績値が全て空欄の行はエラーになる', () => {
    const sheet = buildSheet(DAILY_HEADERS, [
      ['8月1日', 100, null, null, null, null, null],
      ['2026-08-02', null, null, null, null, null, 'メモだけ'],
    ])
    const { rows, errors } = parseDailyActualSheet(sheet)
    expect(rows).toHaveLength(0)
    expect(errors).toHaveLength(2)
    expect(errors[0].message).toContain('日付の形式が不正')
    expect(errors[1].message).toContain('いずれかを入力')
  })

  it('同一日付の重複行はエラーになる', () => {
    const sheet = buildSheet(DAILY_HEADERS, [
      ['2026-08-01', 100, null, null, null, null, null],
      ['2026-08-01', 120, null, null, null, null, null],
    ])
    const { rows, errors } = parseDailyActualSheet(sheet)
    expect(rows).toHaveLength(1)
    expect(errors[0].message).toContain('重複')
  })

  it('ヘッダーが一致しないファイルは拒否する', () => {
    const sheet = buildSheet(['Date', 'Rooms', 'ADR', 'Rev', 'Guests', 'Occ', 'Note'], [])
    expect(() => parseDailyActualSheet(sheet)).toThrowError(/ヘッダーが一致しません/)
  })
})

const OTA_HEADERS = ['日付', 'チャネル', '販売室数', 'ADR', '売上', 'キャンペーン(1=あり)']

describe('parseOtaChannelSheet', () => {
  it('正常な行をパースし、キャンペーンフラグの各表記（1・○・空欄）を解釈する', () => {
    const sheet = buildSheet(OTA_HEADERS, [
      ['2026-08-01', '楽天トラベル', 45, 17800, 801000, 1],
      ['2026-08-01', '公式サイト', 30, 19200, null, '○'],
      ['2026-08-01', 'じゃらん', 25, null, 430000, null],
    ])
    const { rows, errors } = parseOtaChannelSheet(sheet)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ channel: '楽天トラベル', roomsSold: 45, campaignFlag: true })
    expect(rows[1].campaignFlag).toBe(true)
    expect(rows[2].campaignFlag).toBe(false)
  })

  it('同一の日付×チャネルの重複行はエラーになる', () => {
    const sheet = buildSheet(OTA_HEADERS, [
      ['2026-08-01', '楽天トラベル', 45, null, null, null],
      ['2026-08-01', '楽天トラベル', 50, null, null, null],
    ])
    const { rows, errors } = parseOtaChannelSheet(sheet)
    expect(rows).toHaveLength(1)
    expect(errors[0].message).toContain('重複')
  })

  it('チャネル空欄・実績値なしの行はエラーになる', () => {
    const sheet = buildSheet(OTA_HEADERS, [
      ['2026-08-01', null, 45, null, null, null],
      ['2026-08-02', '一休', null, null, null, null],
    ])
    const { rows, errors } = parseOtaChannelSheet(sheet)
    expect(rows).toHaveLength(0)
    expect(errors).toHaveLength(2)
    expect(errors[0].message).toContain('チャネルは必須')
    expect(errors[1].message).toContain('いずれかを入力')
  })

  it('ヘッダーが一致しないファイルは拒否する', () => {
    const sheet = buildSheet(['Date', 'Channel', 'Rooms', 'ADR', 'Rev', 'Camp'], [])
    expect(() => parseOtaChannelSheet(sheet)).toThrowError(/ヘッダーが一致しません/)
  })
})
