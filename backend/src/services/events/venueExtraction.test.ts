import { describe, it, expect } from 'vitest'
import { htmlToText, normalizeExtractedEvents, MAX_PAGE_TEXT_CHARS } from './venueExtraction.js'

describe('htmlToText', () => {
  it('script/style を除去し、ブロック要素を改行にし、実体参照を戻す', () => {
    const html = `<html><head><style>.a{}</style><script>var x=1</script></head><body>
      <h1>イベント &amp; 公演</h1><ul><li>11/8(土) ライブ</li><li>11/9(日)&nbsp;ライブ</li></ul></body></html>`
    const { text, truncated } = htmlToText(html)
    expect(truncated).toBe(false)
    expect(text).toBe('イベント & 公演\n11/8(土) ライブ\n11/9(日) ライブ')
  })

  it('長すぎるページは切り詰めて truncated=true を返す', () => {
    const { text, truncated } = htmlToText('<p>' + 'あ'.repeat(MAX_PAGE_TEXT_CHARS + 10) + '</p>')
    expect(truncated).toBe(true)
    expect(text.length).toBe(MAX_PAGE_TEXT_CHARS)
  })
})

describe('normalizeExtractedEvents', () => {
  it('不正な日付・過去のイベントを除き、日付順に返す', () => {
    const out = normalizeExtractedEvents(
      {
        events: [
          { name: 'B', startDate: '2026-12-01', endDate: '2026-12-02', type: 'concert', expectedAttendance: null, confidence: 'high' },
          { name: 'A', startDate: '2026-10-01', endDate: '2026-10-01', type: 'sports', expectedAttendance: 40000, confidence: 'medium' },
          { name: 'past', startDate: '2026-01-01', endDate: '2026-01-02', type: 'other', expectedAttendance: null, confidence: 'high' },
          { name: 'bad', startDate: '2026/10/01', endDate: '2026-10-01', type: 'other', expectedAttendance: null, confidence: 'low' },
          { name: 'reversed', startDate: '2026-10-05', endDate: '2026-10-01', type: 'other', expectedAttendance: null, confidence: 'low' },
        ],
        notes: null,
      },
      '2026-09-07'
    )
    expect(out.map((e) => e.name)).toEqual(['A', 'B'])
  })
})
