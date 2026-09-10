import { describe, it, expect } from 'vitest'
import { chunkMarkdown, tokenize, KnowledgeIndex } from './knowledgeBase.js'

const md = `# 価格戦略とランク運用

## ガードレール
1日の最大変動幅は、予測の外れによる乱高下を防ぐ。最小ランクはブランド価値の下限。

## 推奨の採否
推奨を採用しない場合は理由を残す。理由は次回の学習材料になる。

### 補足
「なんとなく」の上書きは学習を汚す。
`

describe('chunkMarkdown', () => {
  it('先頭の # をドキュメント名にし、## / ### ごとにチャンク化する', () => {
    const chunks = chunkMarkdown('03-価格戦略.md', md)
    expect(chunks.map((c) => c.heading)).toEqual(['ガードレール', '推奨の採否', '補足'])
    expect(chunks[0].docTitle).toBe('価格戦略とランク運用')
    expect(chunks[0].path).toBe('価格戦略とランク運用 › ガードレール')
    expect(chunks[0].id).toBe('03-価格戦略#ガードレール')
    expect(chunks[1].text).toContain('理由を残す')
  })
})

describe('tokenize', () => {
  it('日本語は文字バイグラム、英数字は単語にする', () => {
    expect(tokenize('RevPAR 最大化')).toEqual(['revpar', '最大', '大化'])
  })
})

describe('KnowledgeIndex.search', () => {
  it('問い合わせに関係する章を上位に返し、無関係なら空', () => {
    const idx = new KnowledgeIndex(chunkMarkdown('03-価格戦略.md', md))
    const hits = idx.search('推奨を採用しないときはどうする？')
    expect(hits[0].chunk.heading).toBe('推奨の採否')
    expect(idx.search('xyzabc')).toHaveLength(0)
  })

  it('見出しの一致を重く見る', () => {
    const idx = new KnowledgeIndex(chunkMarkdown('03-価格戦略.md', md))
    expect(idx.search('ガードレール')[0].chunk.heading).toBe('ガードレール')
  })
})
