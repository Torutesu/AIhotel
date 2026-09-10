// 知識ベースのプロセス内シングルトン（起動時に読み込み、ADMIN が再読込できる）
import { resolve } from 'node:path'
import { config } from '../../lib/config.js'
import { logger } from '../../utils/logger.js'
import { KnowledgeIndex, loadKnowledgeDir, type KnowledgeChunk, type KnowledgeHit } from './knowledgeBase.js'

const index = new KnowledgeIndex()
let loadedFrom: string | null = null
let loadedAt: Date | null = null

export function knowledgeDir(): string {
  return resolve(process.cwd(), config.KNOWLEDGE_DIR)
}

export function reloadKnowledge(): { dir: string; chunks: number; documents: number } {
  const dir = knowledgeDir()
  const chunks = loadKnowledgeDir(dir)
  index.load(chunks)
  loadedFrom = dir
  loadedAt = new Date()
  const documents = new Set(chunks.map((c) => c.file)).size
  if (chunks.length === 0) logger.warn({ dir }, '知識ベースが空です（docs/knowledge に Markdown を置くか KNOWLEDGE_DIR を設定してください）')
  else logger.info({ dir, chunks: chunks.length, documents }, '知識ベースを読み込みました')
  return { dir, chunks: chunks.length, documents }
}

export function searchKnowledge(query: string, k = 5): KnowledgeHit[] {
  if (!loadedAt) reloadKnowledge()
  return index.search(query, k)
}

export function getKnowledgeChunk(id: string): KnowledgeChunk | undefined {
  if (!loadedAt) reloadKnowledge()
  return index.get(id)
}

export function knowledgeStatus(): { dir: string | null; loadedAt: string | null; chunks: number; documents: Array<{ file: string; title: string; sections: number }> } {
  if (!loadedAt) reloadKnowledge()
  const byFile = new Map<string, { title: string; sections: number }>()
  for (const c of index.all()) {
    const e = byFile.get(c.file) ?? { title: c.docTitle, sections: 0 }
    e.sections++
    byFile.set(c.file, e)
  }
  return {
    dir: loadedFrom,
    loadedAt: loadedAt?.toISOString() ?? null,
    chunks: index.size,
    documents: [...byFile].map(([file, v]) => ({ file, ...v })),
  }
}
