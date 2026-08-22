import { describe, it, expect } from 'vitest'
import { parseCsv, parseCsvWithHeader } from './csv.js'

describe('parseCsv', () => {
  it('カンマ区切りの行をパースする', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('CRLF・末尾改行なし・空行に対応する', () => {
    expect(parseCsv('a,b\r\n1,2\r\n\r\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('ダブルクォート囲みとカンマ・改行・""エスケープに対応する', () => {
    expect(parseCsv('"a,1","say ""hi""","line1\nline2"')).toEqual([
      ['a,1', 'say "hi"', 'line1\nline2'],
    ])
  })

  it('先頭のUTF-8 BOMを除去する（Excel出力対応）', () => {
    expect(parseCsv('﻿code,name\nSTD,スタンダード')).toEqual([
      ['code', 'name'],
      ['STD', 'スタンダード'],
    ])
  })
})

describe('parseCsvWithHeader', () => {
  it('ヘッダー名をキーにしたレコードを返す', () => {
    const { header, records } = parseCsvWithHeader('code,name,count\nSTD,シングル,80\nTWN,ツイン,50')
    expect(header).toEqual(['code', 'name', 'count'])
    expect(records).toEqual([
      { values: { code: 'STD', name: 'シングル', count: '80' }, line: 2 },
      { values: { code: 'TWN', name: 'ツイン', count: '50' }, line: 3 },
    ])
  })

  it('列が足りない行は空文字で埋め、値はtrimする', () => {
    const { records } = parseCsvWithHeader('a,b\n 1 ')
    expect(records[0].values).toEqual({ a: '1', b: '' })
  })

  it('空文字列は空の結果を返す', () => {
    expect(parseCsvWithHeader('')).toEqual({ header: [], records: [] })
  })
})
