// 知識ベース（docs/knowledge/*.md）の読み込み・チャンク化・検索。DB 非依存。
//
// - 見出し（## / ###）ごとに1チャンク。引用は「ドキュメント名 › 見出し」で返す
// - 検索は日本語向けに文字バイグラム＋英数トークンで重み付け（章が100を超えたら埋め込み検索に切替）
// - テナント共通の基礎だけを置く。ホテル固有の判断は設定・イベント・採否理由に入れる（README 参照）
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

export interface KnowledgeChunk {
  /** 例: 03-価格戦略#ガードレール */
  id: string
  file: string
  docTitle: string
  heading: string
  /** ドキュメント名 › 見出し（引用表示用） */
  path: string
  text: string
}

export interface KnowledgeHit {
  chunk: KnowledgeChunk
  score: number
}

/** Markdown を見出し単位のチャンクに分割する（純粋関数） */
export function chunkMarkdown(file: string, markdown: string): KnowledgeChunk[] {
  const lines = markdown.split(/\r?\n/)
  let docTitle = basename(file, '.md')
  const chunks: KnowledgeChunk[] = []
  let heading: string | null = null
  let buf: string[] = []
  const flush = () => {
    const text = buf.join('\n').trim()
    if (heading && text) {
      chunks.push({ id: `${basename(file, '.md')}#${heading}`, file, docTitle, heading, path: `${docTitle} › ${heading}`, text })
    }
    buf = []
  }
  for (const line of lines) {
    const h1 = /^#\s+(.+)$/.exec(line)
    const h = /^#{2,3}\s+(.+)$/.exec(line)
    if (h1 && heading == null && chunks.length === 0) {
      docTitle = h1[1].trim()
      continue
    }
    if (h) {
      flush()
      heading = h[1].trim()
      continue
    }
    buf.push(line)
  }
  flush()
  return chunks
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s、。，．,.!?！？「」『』（）()\[\]【】:：;；・/／\-—–]+/g, ' ').trim()
}

/** 日本語は文字バイグラム、英数字は単語トークン */
export function tokenize(s: string): string[] {
  const out: string[] = []
  for (const word of normalize(s).split(' ')) {
    if (!word) continue
    if (/^[a-z0-9_%.+-]+$/.test(word)) {
      out.push(word)
      continue
    }
    const chars = [...word]
    if (chars.length === 1) out.push(word)
    for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1])
  }
  return out
}

export class KnowledgeIndex {
  private chunks: KnowledgeChunk[] = []
  private df = new Map<string, number>()
  private tokensByChunk: Map<string, number>[] = []

  constructor(chunks: KnowledgeChunk[] = []) {
    this.load(chunks)
  }

  load(chunks: KnowledgeChunk[]): void {
    this.chunks = chunks
    this.df = new Map()
    this.tokensByChunk = chunks.map((c) => {
      const counts = new Map<string, number>()
      for (const t of tokenize(`${c.heading} ${c.heading} ${c.text}`)) counts.set(t, (counts.get(t) ?? 0) + 1)
      for (const t of counts.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1)
      return counts
    })
  }

  get size(): number {
    return this.chunks.length
  }

  all(): KnowledgeChunk[] {
    return this.chunks
  }

  get(id: string): KnowledgeChunk | undefined {
    return this.chunks.find((c) => c.id === id)
  }

  /** TF-IDF 風のスコアで上位 k 件。スコア 0 は返さない */
  search(query: string, k = 5): KnowledgeHit[] {
    const q = tokenize(query)
    if (q.length === 0 || this.chunks.length === 0) return []
    const n = this.chunks.length
    const hits: KnowledgeHit[] = []
    this.tokensByChunk.forEach((counts, i) => {
      let score = 0
      for (const t of new Set(q)) {
        const tf = counts.get(t)
        if (!tf) continue
        const idf = Math.log(1 + n / (this.df.get(t) ?? 1))
        score += (1 + Math.log(tf)) * idf
      }
      if (score > 0) hits.push({ chunk: this.chunks[i], score })
    })
    return hits.sort((a, b) => b.score - a.score).slice(0, k)
  }
}

/** ディレクトリ内の *.md を読み込む（README.md は除外）。無ければ空 */
export function loadKnowledgeDir(dir: string): KnowledgeChunk[] {
  if (!existsSync(dir)) return []
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .sort()
  return files.flatMap((f) => chunkMarkdown(f, readFileSync(join(dir, f), 'utf8')))
}
