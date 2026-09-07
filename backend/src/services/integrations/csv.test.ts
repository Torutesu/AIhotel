import { describe, it, expect } from 'vitest'
import { parseCsv } from './csv.js'

describe('parseCsv', () => {
  it('ヘッダ行をキーにし、クォート・改行・BOM を扱う', () => {
    const rows = parseCsv('﻿stayDate,roomsBooked,note\r\n2026-10-01,120,"a, b"\n2026-10-02,130,"x""y"\n\n')
    expect(rows).toEqual([
      { stayDate: '2026-10-01', roomsBooked: '120', note: 'a, b' },
      { stayDate: '2026-10-02', roomsBooked: '130', note: 'x"y' },
    ])
  })
  it('空文字は空配列', () => {
    expect(parseCsv('')).toEqual([])
  })
})
