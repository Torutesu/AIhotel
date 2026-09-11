import { describe, it, expect } from 'vitest'
import { collectCitations, summarizeAction, buildSystemPrompt } from './chatService.js'
import { CHAT_TOOLS, toolsForRole, findTool } from './chatTools.js'
import { toolInputJsonSchema } from '../llm/toolSchema.js'
import { renderSummary } from './aiSummaryService.js'

describe('chatTools', () => {
  it('全ツールの入力スキーマが JSON Schema に変換できる', () => {
    for (const t of CHAT_TOOLS) {
      const js = toolInputJsonSchema(t)
      expect(js.type).toBe('object')
      expect(js.$schema).toBeUndefined()
      expect(/^[a-z0-9_]+$/.test(t.name)).toBe(true)
    }
  })

  it('OPERATOR は読み取りとイベント登録だけ、MANAGER は係数調整や採否も使える', () => {
    const op = toolsForRole('OPERATOR').map((t) => t.name)
    expect(op).toContain('get_pricing_overview')
    expect(op).toContain('register_event')
    expect(op).not.toContain('record_decision')
    expect(op).not.toContain('adjust_factor')
    expect(toolsForRole('MANAGER').map((t) => t.name)).toContain('adjust_factor')
    expect(() => findTool('adjust_factor', 'OPERATOR')).toThrow(/権限/)
    expect(() => findTool('no_such_tool', 'ADMIN')).toThrow(/不明/)
  })
})

describe('collectCitations', () => {
  const calls = [
    {
      name: 'search_knowledge',
      ok: true,
      input: {},
      output: [
        { id: 'a#x', path: '価格戦略 › ガードレール', text: '' },
        { id: 'b#y', path: '需要予測 › ペースの見方', text: '' },
      ],
    },
    { name: 'get_daily_digest', ok: true, input: {}, output: {} },
  ]
  it('回答本文で触れた章だけを出典にする', () => {
    expect(collectCitations(calls, '…出典: 価格戦略 › ガードレール')).toEqual([{ id: 'a#x', path: '価格戦略 › ガードレール' }])
  })
  it('本文に無ければ検索結果すべてを出典にする', () => {
    expect(collectCitations(calls, '短い回答')).toHaveLength(2)
  })
})

describe('summarizeAction / buildSystemPrompt / renderSummary', () => {
  it('操作を日本語で要約する', () => {
    expect(
      summarizeAction({ name: 'record_decision', ok: true, input: {}, output: { date: '2026-09-20', appliedRank: 29, recommendedRank: 25, adopted: false } })
    ).toContain('上書き')
    expect(summarizeAction({ name: 'adjust_factor', ok: false, input: {}, output: { error: 'x' } })).toContain('失敗')
  })
  it('システムプロンプトにホテル名・重み・権限が入る', () => {
    const p = buildSystemPrompt({
      hotelName: 'デモ',
      today: '2026-09-10',
      totalRooms: 200,
      weights: { weightOccupancy: 40, weightAdr: 40, weightCompetitor: 20 },
      role: 'OPERATOR',
      digestLine: 'x',
    })
    expect(p).toContain('デモ')
    expect(p).toContain('稼働率 40%')
    expect(p).toContain('OPERATOR')
  })
  it('まとめをテキストに整形する', () => {
    const t = renderSummary({ headline: '結論', highlights: ['a'], actions: ['b'], caveats: [], citations: ['X › Y'] })
    expect(t).toContain('【注目】')
    expect(t).toContain('出典: X › Y')
  })
})
