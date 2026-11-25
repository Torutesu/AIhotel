import { describe, expect, it } from 'vitest'
import { mockChatReply } from './demo-chat'
describe('デモチャットの機能・データ境界', () => {
  it.each(['稼働率', 'ADR', '料金', '予約', '予算', '来月', 'レポート', 'こんにちは'])('実データの分析結果と誤認させない: %s', q => {
    expect(mockChatReply(q)).toContain('実際のホテルデータを分析した結果ではありません')
  })
  it('公開デモでできないレポート出力と未提供機能を明示する', () => {
    const text = mockChatReply('レポート')
    expect(text).toContain('現在の公開デモでは出力できません')
    expect(text).toContain('四半期レポート・CSV出力・自動配信は提供していません')
  })
})
