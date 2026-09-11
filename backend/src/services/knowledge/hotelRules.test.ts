import { describe, it, expect } from 'vitest'
import { parseHotelRules, summarizeRulesForPrompt } from './hotelRules.js'

const md = `# デモホテル東京 個社MD

## ホテル概要
丸の内のビジネスホテル。

## ルール
最小ランク: 8
最大ランク: ３６
最低価格: 9,800円
最大変動幅: 3
競合ポジション: +5%
除外競合: 競合ホテルC, 競合ホテルD
需要レベルA: 下げない。満室が見えたら1段上げる
需要レベルE: 最低価格を割らない範囲で需要喚起
団体: 10室以上は個別判断
- 効かない要因: 天候, 学校休暇
- 効く要因: 連休
自動採用: オフ
禁止: 前年同日より2段以上下げない
謎のキー: 値
これは形式が違う

## 競合の扱い
競合Aは追従する。
`

describe('parseHotelRules', () => {
  it('ルール節を固定語彙で解釈し、全角や単位を吸収する', () => {
    const r = parseHotelRules(md)
    expect(r.found).toBe(true)
    expect(r.rules.minRank).toBe(8)
    expect(r.rules.maxRank).toBe(36)
    expect(r.rules.minPrice).toBe(9800)
    expect(r.rules.maxDailyRankChange).toBe(3)
    expect(r.rules.competitorPositionPct).toBe(5)
    expect(r.rules.excludedCompetitors).toEqual(['競合ホテルC', '競合ホテルD'])
    expect(r.rules.levelPolicies.A).toContain('下げない')
    expect(r.rules.levelPolicies.E).toContain('需要喚起')
    expect(r.rules.groupPolicy).toBe('10室以上は個別判断')
    expect(r.rules.disabledFactorGroups).toEqual(['weather', 'school'])
    expect(r.rules.enabledFactorGroups).toEqual(['holiday'])
    expect(r.rules.autoAdopt).toBe(false)
    expect(r.rules.prohibitions).toEqual(['前年同日より2段以上下げない'])
  })

  it('解釈できない行はエラーとして残す（黙って無視しない）', () => {
    const r = parseHotelRules(md)
    expect(r.errors.map((e) => e.reason)).toEqual(expect.arrayContaining([expect.stringContaining('不明なキー'), expect.stringContaining('形式')]))
    expect(r.errors.find((e) => e.reason.includes('不明なキー'))?.line).toBeGreaterThan(0)
  })

  it('ルール節が無ければ found=false で空のルールを返す', () => {
    const r = parseHotelRules('# タイトル\n\n## 概要\n文章だけ')
    expect(r.found).toBe(false)
    expect(r.rules.excludedCompetitors).toEqual([])
    expect(r.errors).toHaveLength(0)
  })

  it('矛盾（最小>最大、効く/効かないの重複）を検出する', () => {
    const r = parseHotelRules('## ルール\n最小ランク: 30\n最大ランク: 10\n効かない要因: 天候\n効く要因: 天候')
    expect(r.errors.map((e) => e.reason)).toEqual(expect.arrayContaining([expect.stringContaining('超えて'), expect.stringContaining('矛盾')]))
  })

  it('不明な要因名はエラーにし、使える語を示す', () => {
    const r = parseHotelRules('## ルール\n効かない要因: 星占い')
    expect(r.errors[0].reason).toContain('星占い')
    expect(r.errors[0].reason).toContain('天候')
  })
})

describe('summarizeRulesForPrompt', () => {
  it('数字と方針だけを1行に要約する', () => {
    const s = summarizeRulesForPrompt(parseHotelRules(md).rules)
    expect(s).toContain('ランク範囲 R8〜R36')
    expect(s).toContain('最低価格 9,800円')
    expect(s).toContain('除外競合: 競合ホテルC・競合ホテルD')
    expect(s).toContain('効かない要因（係数固定0）: 天候・学校休暇')
    expect(summarizeRulesForPrompt(null)).toBe('')
  })
})
