// 会場ページからのイベント抽出（docs/外部要因設計.md §3 #3 b）— DB・ネットワーク非依存の純粋部分。
// HTML → テキスト化、Claude に渡すスキーマとプロンプト、抽出結果の正規化。
// SDK の zodOutputFormat は zod v4 の型を要求する（zod 3.25+ に同梱の zod/v4 を使う。他モジュールは v3 のまま）
import { z } from 'zod/v4'

export const ExtractedEventSchema = z.object({
  name: z.string().describe('イベント名（公演名・大会名・展示会名など）'),
  startDate: z.string().describe('開始日 YYYY-MM-DD'),
  endDate: z.string().describe('終了日 YYYY-MM-DD（1日のみなら開始日と同じ）'),
  type: z.enum(['concert', 'sports', 'conference', 'festival', 'exhibition', 'other']),
  expectedAttendance: z.number().nullable().describe('見込み来場者数。不明なら null'),
  confidence: z.enum(['high', 'medium', 'low']).describe('日付と名称の確からしさ'),
})

export const ExtractionResultSchema = z.object({
  events: z.array(ExtractedEventSchema),
  notes: z.string().nullable().describe('ページの構造や抽出できなかった情報についての注記。無ければ null'),
})

export type ExtractedEvent = z.infer<typeof ExtractedEventSchema>
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>

export const MAX_PAGE_TEXT_CHARS = 60_000

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }

/**
 * HTML を抽出用のプレーンテキストにする。script/style/nav 等を除去し、ブロック要素は改行に置き換える
 */
export function htmlToText(html: string): { text: string; truncated: boolean } {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|table|dd|dt)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  s = s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t　]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
  const truncated = s.length > MAX_PAGE_TEXT_CHARS
  return { text: truncated ? s.slice(0, MAX_PAGE_TEXT_CHARS) : s, truncated }
}

export const EXTRACTION_SYSTEM_PROMPT = `あなたはホテルのレベニューマネジメント担当を支援するアシスタントです。
イベント会場の公式ページのテキストから、宿泊需要に影響しうるイベント（公演・試合・大会・展示会・学会・フェスなど）を抽出します。

- 日付は必ず YYYY-MM-DD にしてください。年が書かれていない場合は「基準日」から最も自然な年を補ってください（基準日より前の日付は原則として翌年扱い）。
- 複数日開催は startDate/endDate で表し、日程が飛び飛びなら別のイベントとして分けてください。
- 来場者数が書かれていなければ null にしてください。推測で数値を入れないでください。
- 日付や名称が曖昧な場合は confidence を low にしてください。
- 抽出できない・過去のイベントしか無い場合は events を空配列にし、notes に理由を書いてください。`

export function buildExtractionUserMessage(params: { venueName: string; url: string; asOfDate: string; pageText: string }): string {
  return `会場: ${params.venueName}
URL: ${params.url}
基準日: ${params.asOfDate}

--- ページ本文 ---
${params.pageText}`
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 抽出結果を検証して、基準日以降のイベントだけを日付順に返す
 */
export function normalizeExtractedEvents(result: ExtractionResult, asOfDate: string): ExtractedEvent[] {
  return result.events
    .filter((e) => ISO_DATE.test(e.startDate) && ISO_DATE.test(e.endDate) && e.startDate <= e.endDate && e.endDate >= asOfDate)
    .map((e) => ({ ...e, name: e.name.trim().slice(0, 200) }))
    .filter((e) => e.name.length > 0)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
}
