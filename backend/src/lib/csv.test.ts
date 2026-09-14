import { describe, it, expect } from 'vitest'
import { parseCsv, toRecords } from './csv.js'

describe('parseCsv', () => {
  it('引用符の中のカンマ・改行・エスケープされた引用符を保持する', () => {
    const text = '日付,備考\r\n2026-09-15,"団体, 30名\n（""仮"" 押さえ）"\r\n'
    expect(parseCsv(text)).toEqual([
      ['日付', '備考'],
      ['2026-09-15', '団体, 30名\n（"仮" 押さえ）'],
    ])
  })

  it('CRLF・LF・末尾の空行が混在しても行がずれない', () => {
    expect(parseCsv('a,b\r\n1,2\n3,4\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('先頭のBOMを取り除く', () => {
    expect(parseCsv('﻿宿泊日,室数\n2026-09-15,2\n')[0]).toEqual(['宿泊日', '室数'])
  })

  it('タブ区切りも扱える', () => {
    expect(parseCsv('a\tb\n1\t2\n', '\t')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('空のセルは空文字として残す（列がずれないため）', () => {
    expect(parseCsv('a,b,c\n1,,3\n')[1]).toEqual(['1', '', '3'])
  })
})

describe('toRecords', () => {
  it('ヘッダーを列名にして前後の空白を落とす', () => {
    const { headers, records } = toRecords([
      [' 宿泊日 ', '室数'],
      [' 2026-09-15 ', ' 2 '],
    ])
    expect(headers).toEqual(['宿泊日', '室数'])
    expect(records).toEqual([{ 宿泊日: '2026-09-15', 室数: '2' }])
  })

  it('同名の列は #2 を付けて区別する（黙って上書きしない）', () => {
    const { headers } = toRecords([['料金', '料金', '料金']])
    expect(headers).toEqual(['料金', '料金#2', '料金#3'])
  })

  it('列名が空のときは位置で名前を付ける', () => {
    const { headers } = toRecords([['宿泊日', '']])
    expect(headers).toEqual(['宿泊日', '列2'])
  })
})
