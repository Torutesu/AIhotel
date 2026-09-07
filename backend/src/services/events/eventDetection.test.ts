import { describe, it, expect } from 'vitest'
import { computeResiduals, detectEventCandidates } from './eventDetection.js'

function d(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m - 1, day))
}

// 2025-10-01〜2025-12-15 を稼働 0.7 で埋め、指定日だけ上振れさせる
function history(spikes: Record<string, number>) {
  const out = []
  for (let t = d(2025, 10, 1); t <= d(2025, 12, 15); t = new Date(t.getTime() + 86_400_000)) {
    const key = t.toISOString().slice(0, 10)
    out.push({ date: t, occupancy: spikes[key] ?? 0.7 })
  }
  return out
}

describe('computeResiduals', () => {
  it('同曜日の前後4週の中央値を期待値にする', () => {
    const r = computeResiduals(history({ '2025-11-05': 0.95 }))
    const spike = r.find((x) => x.date.toISOString().startsWith('2025-11-05'))!
    expect(spike.residualPt).toBeCloseTo(0.25, 6)
    const normal = r.find((x) => x.date.toISOString().startsWith('2025-11-06'))!
    expect(normal.residualPt).toBeCloseTo(0, 6)
  })
})

describe('detectEventCandidates', () => {
  it('連続するスパイク日を1つの候補にまとめ、翌年の候補日を提案する', () => {
    const c = detectEventCandidates(history({ '2025-11-08': 0.95, '2025-11-09': 0.9 }), [])
    expect(c).toHaveLength(1)
    expect(c[0].observedStart.toISOString().slice(0, 10)).toBe('2025-11-08')
    expect(c[0].observedEnd.toISOString().slice(0, 10)).toBe('2025-11-09')
    expect(c[0].suggestedSameDate.start.toISOString().slice(0, 10)).toBe('2026-11-08')
    expect(c[0].suggestedSameWeekday.start.toISOString().slice(0, 10)).toBe('2026-11-07') // 364日後（土曜→土曜）
    expect(c[0].suggestedImpact).toBe('medium')
  })

  it('登録済みイベントで説明できる日は候補にしない', () => {
    const c = detectEventCandidates(history({ '2025-11-08': 0.95 }), [{ startDate: d(2025, 11, 8), endDate: d(2025, 11, 8) }])
    expect(c).toHaveLength(0)
  })

  it('祝日要因で説明できる上振れは候補にしない（2025-11-23 勤労感謝の日の前夜 11/22 土）', () => {
    // 11/22（土）は祝日を含む3連休の中（翌日 11/23 も休み）→ holiday:within_long +12pt が期待値に入る
    const c = detectEventCandidates(history({ '2025-11-22': 0.83 }), [])
    expect(c).toHaveLength(0)
  })
})
