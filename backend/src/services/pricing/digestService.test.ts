import { describe, it, expect } from 'vitest'
import { summarizeFactors } from './digestService.js'

describe('summarizeFactors', () => {
  it('base を除き影響の大きい順に最大3件を日本語で要約する', () => {
    const { summary, top } = summarizeFactors([
      { key: 'base', label: '基準', pt: 0.66 },
      { key: 'pace', label: '予約ペース', pt: 0.06 },
      { key: 'holiday:within_long', label: '3連休以上の中日', pt: 0.12 },
      { key: 'weather:rain_lead0_3', label: '雨予報（直前）', pt: -0.04 },
      { key: 'school:summer', label: '夏休み', pt: 0.03 },
    ])
    expect(top.map((f) => f.key)).toEqual(['holiday:within_long', 'pace', 'weather:rain_lead0_3'])
    expect(summary).toBe('3連休以上の中日 +12pt、予約ペース +6pt、雨予報（直前） −4pt')
  })

  it('要因が無ければ基準どおりと表現する', () => {
    expect(summarizeFactors([{ key: 'base', label: '基準', pt: 0.7 }]).summary).toBe('基準どおり（特別な要因なし）')
  })
})
