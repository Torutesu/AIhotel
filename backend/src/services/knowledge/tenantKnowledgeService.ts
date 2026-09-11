// 個社MD（KnowledgeDocument）の管理・ルール反映・テナント別検索（docs/外部要因設計.md §7）。
//
// 優先順位: 個社の制約（ルール節） > 学習済み係数 > 汎用MDの既定。
// 検索は個社＋汎用を合算し、個社のスコアを優先。出典には【個社】/【汎用】のラベルを付ける。
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { BadRequestError, NotFoundError } from '../../middlewares/errorHandler.js'
import { logger } from '../../utils/logger.js'
import { chunkMarkdown, KnowledgeIndex, type KnowledgeChunk, type KnowledgeHit } from './knowledgeBase.js'
import { searchKnowledge as searchGlobalKnowledge } from './knowledgeService.js'
import { parseHotelRules, summarizeRulesForPrompt, FACTOR_GROUP_PREFIX, FACTOR_GROUP_LABELS, type HotelRules, type RuleParseError } from './hotelRules.js'
import { FACTOR_DEFAULTS } from '../forecast/factorDefaults.js'
import { recomputeForecastService } from '../forecast/forecastService.js'

export type KnowledgeScope = 'tenant' | 'global'

export interface ScopedKnowledgeHit extends KnowledgeHit {
  scope: KnowledgeScope
  /** 引用表示用: 【個社】ドキュメント名 › 見出し */
  label: string
}

const TENANT_BOOST = 1.5

// ---------- テナント別インデックス（メモリキャッシュ。保存時に無効化）
const tenantIndexes = new Map<string, { index: KnowledgeIndex; hotelIds: string; loadedAt: number }>()

function invalidateTenantIndex(tenantId: string): void {
  for (const key of [...tenantIndexes.keys()]) if (key.startsWith(`${tenantId}:`)) tenantIndexes.delete(key)
}

async function tenantIndexFor(tenantId: string, hotelId: string | null): Promise<KnowledgeIndex> {
  const key = `${tenantId}:${hotelId ?? '*'}`
  const cached = tenantIndexes.get(key)
  if (cached && Date.now() - cached.loadedAt < 10 * 60_000) return cached.index
  const docs = await prisma.knowledgeDocument.findMany({
    where: { tenantId, isActive: true, OR: [{ hotelId: null }, ...(hotelId ? [{ hotelId }] : [])] },
    select: { id: true, title: true, body: true },
    orderBy: { updatedAt: 'desc' },
  })
  const chunks: KnowledgeChunk[] = docs.flatMap((d) => chunkMarkdown(`doc:${d.id}`, d.body).map((c) => ({ ...c, id: `doc:${d.id}#${c.heading}`, docTitle: d.title, path: `${d.title} › ${c.heading}` })))
  const index = new KnowledgeIndex(chunks)
  tenantIndexes.set(key, { index, hotelIds: hotelId ?? '*', loadedAt: Date.now() })
  return index
}

/**
 * 個社＋汎用の合算検索。個社を優先（スコア ×1.5）し、出典ラベルを付ける
 */
export async function searchAllKnowledge(scope: { tenantId: string; hotelId: string | null }, query: string, k = 5): Promise<ScopedKnowledgeHit[]> {
  const tenantIndex = await tenantIndexFor(scope.tenantId, scope.hotelId)
  const tenantHits: ScopedKnowledgeHit[] = tenantIndex.search(query, k).map((h) => ({ ...h, score: h.score * TENANT_BOOST, scope: 'tenant', label: `【個社】${h.chunk.path}` }))
  const globalHits: ScopedKnowledgeHit[] = searchGlobalKnowledge(query, k).map((h) => ({ ...h, scope: 'global', label: `【汎用】${h.chunk.path}` }))
  return [...tenantHits, ...globalHits].sort((a, b) => b.score - a.score).slice(0, k)
}

// ---------- ルールの反映

export interface ApplyRulesResult {
  hotelIds: string[]
  strategyUpdates: Record<string, unknown>
  excludedCompetitors: string[]
  competitorsNotFound: string[]
  lockedFactorKeys: string[]
  unlockedFactorKeys: string[]
  recomputedDays: number
}

function factorKeysForGroups(groups: string[]): string[] {
  const prefixes = groups.map((g) => FACTOR_GROUP_PREFIX[g as keyof typeof FACTOR_GROUP_PREFIX]).filter(Boolean)
  return Object.keys(FACTOR_DEFAULTS).filter((k) => prefixes.some((p) => k.startsWith(p)))
}

/**
 * 解釈済みルールを対象ホテルの設定に反映する。
 * 対象: 文書に hotelId があればそのホテル、無ければテナントの全アクティブホテル
 */
export async function applyHotelRulesService(tenantId: string, hotelId: string | null, rules: HotelRules): Promise<ApplyRulesResult> {
  const hotels = await prisma.hotel.findMany({ where: hotelId ? { id: hotelId, tenantId } : { tenantId, isActive: true }, select: { id: true } })
  if (hotels.length === 0) throw new NotFoundError('対象ホテル')

  const result: ApplyRulesResult = { hotelIds: hotels.map((h) => h.id), strategyUpdates: {}, excludedCompetitors: [], competitorsNotFound: [], lockedFactorKeys: [], unlockedFactorKeys: [], recomputedDays: 0 }
  const lockKeys = factorKeysForGroups(rules.disabledFactorGroups)

  for (const hotel of hotels) {
    // ---- ガードレール（指定された項目だけ更新）
    const update: Prisma.PricingStrategyConfigUncheckedUpdateInput = {}
    if (rules.minRank != null) update.minRank = rules.minRank
    if (rules.maxRank != null) update.maxRank = rules.maxRank
    if (rules.maxDailyRankChange != null) update.maxDailyRankChange = rules.maxDailyRankChange
    if (rules.competitorPositionPct != null) update.competitorPositionPct = rules.competitorPositionPct
    if (rules.autoAdopt != null) update.autoAdopt = rules.autoAdopt
    if (rules.minPrice != null) {
      // 最低価格 → その価格以上で最も低いランク
      const ranks = await prisma.priceRank.findMany({ where: { hotelId: hotel.id, isActive: true }, orderBy: { rank: 'asc' }, select: { rank: true, price1P: true } })
      const floor = ranks.find((r) => r.price1P >= rules.minPrice!)
      if (!floor) throw new BadRequestError(`最低価格 ${rules.minPrice.toLocaleString('ja-JP')}円 以上のランクがランク表にありません`)
      update.minRank = Math.max(rules.minRank ?? 1, floor.rank)
    }
    if (Object.keys(update).length > 0) {
      await prisma.pricingStrategyConfig.upsert({
        where: { hotelId: hotel.id },
        update,
        create: { hotelId: hotel.id, tenantId, ...(update as object) },
      })
      result.strategyUpdates = { ...result.strategyUpdates, ...(update as Record<string, unknown>) }
    }

    // ---- 除外競合（名前の部分一致。列挙されなかった競合は除外解除）
    const competitors = await prisma.competitor.findMany({ where: { hotelId: hotel.id }, select: { id: true, name: true } })
    const matched = new Set<string>()
    for (const name of rules.excludedCompetitors) {
      const hits = competitors.filter((c) => c.name.includes(name) || name.includes(c.name))
      if (hits.length === 0) result.competitorsNotFound.push(name)
      for (const h of hits) matched.add(h.id)
    }
    for (const c of competitors) {
      await prisma.competitor.update({ where: { id: c.id }, data: { excludedFromPricing: matched.has(c.id) } })
      if (matched.has(c.id) && !result.excludedCompetitors.includes(c.name)) result.excludedCompetitors.push(c.name)
    }

    // ---- 効かない要因（係数を 0 に固定）。以前固定されていて今回外れたものは初期値に戻して解除
    const locked = await prisma.factorCoefficient.findMany({ where: { hotelId: hotel.id, locked: true }, select: { factorKey: true } })
    for (const row of locked) {
      if (!lockKeys.includes(row.factorKey)) {
        await prisma.factorCoefficient.update({ where: { hotelId_factorKey: { hotelId: hotel.id, factorKey: row.factorKey } }, data: { locked: false, value: FACTOR_DEFAULTS[row.factorKey] ?? 0, sampleSize: 0 } })
        if (!result.unlockedFactorKeys.includes(row.factorKey)) result.unlockedFactorKeys.push(row.factorKey)
      }
    }
    for (const key of lockKeys) {
      await prisma.factorCoefficient.upsert({
        where: { hotelId_factorKey: { hotelId: hotel.id, factorKey: key } },
        update: { value: 0, locked: true },
        create: { hotelId: hotel.id, tenantId, factorKey: key, value: 0, locked: true },
      })
      if (!result.lockedFactorKeys.includes(key)) result.lockedFactorKeys.push(key)
    }

    const f = await recomputeForecastService(hotel.id)
    result.recomputedDays += f.count
  }
  return result
}

// ---------- CRUD

export interface SaveKnowledgeDocumentInput {
  tenantId: string
  hotelId: string | null
  title: string
  body: string
  userId: string
}

export interface SavedKnowledgeDocument {
  document: { id: string; tenantId: string; hotelId: string | null; title: string; version: number; rules: HotelRules | null; rulesErrors: RuleParseError[]; rulesAppliedAt: Date | null; updatedAt: Date }
  applied: ApplyRulesResult | null
  rulesFound: boolean
}

async function assertHotelInTenant(tenantId: string, hotelId: string | null): Promise<void> {
  if (!hotelId) return
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, tenantId }, select: { id: true } })
  if (!hotel) throw new NotFoundError('ホテル')
}

/**
 * 個社MDを作成／更新し、ルール節を解釈して反映する。エラー行があってもドキュメントは保存する
 * （引用には使える）が、ルールは反映しない
 */
export async function saveKnowledgeDocumentService(input: SaveKnowledgeDocumentInput, documentId?: string): Promise<SavedKnowledgeDocument> {
  await assertHotelInTenant(input.tenantId, input.hotelId)
  const parsed = parseHotelRules(input.body)
  const rulesOk = parsed.found && parsed.errors.length === 0

  let doc
  if (documentId) {
    const existing = await prisma.knowledgeDocument.findFirst({ where: { id: documentId, tenantId: input.tenantId } })
    if (!existing) throw new NotFoundError('個社MD')
    doc = await prisma.$transaction(async (tx) => {
      await tx.knowledgeDocumentRevision.create({
        data: { tenantId: input.tenantId, documentId: existing.id, version: existing.version, body: existing.body, rules: existing.rules ?? undefined, createdByUserId: existing.updatedByUserId },
      })
      return tx.knowledgeDocument.update({
        where: { id: existing.id },
        data: {
          hotelId: input.hotelId,
          title: input.title,
          body: input.body,
          version: existing.version + 1,
          rules: rulesOk ? (parsed.rules as unknown as Prisma.InputJsonValue) : existing.rules ?? undefined,
          rulesErrors: parsed.errors as unknown as Prisma.InputJsonValue,
          updatedByUserId: input.userId,
        },
      })
    })
  } else {
    doc = await prisma.knowledgeDocument.create({
      data: {
        tenantId: input.tenantId,
        hotelId: input.hotelId,
        title: input.title,
        body: input.body,
        rules: rulesOk ? (parsed.rules as unknown as Prisma.InputJsonValue) : undefined,
        rulesErrors: parsed.errors as unknown as Prisma.InputJsonValue,
        updatedByUserId: input.userId,
      },
    })
  }
  invalidateTenantIndex(input.tenantId)

  let applied: ApplyRulesResult | null = null
  if (rulesOk) {
    applied = await applyHotelRulesService(input.tenantId, input.hotelId, parsed.rules)
    doc = await prisma.knowledgeDocument.update({ where: { id: doc.id }, data: { rulesAppliedAt: new Date() } })
  } else if (parsed.found) {
    logger.warn({ documentId: doc.id, errors: parsed.errors.length }, '個社MDのルール節に解釈できない行があるため反映しませんでした')
  }

  return {
    document: {
      id: doc.id,
      tenantId: doc.tenantId,
      hotelId: doc.hotelId,
      title: doc.title,
      version: doc.version,
      rules: (doc.rules as unknown as HotelRules | null) ?? null,
      rulesErrors: parsed.errors,
      rulesAppliedAt: doc.rulesAppliedAt,
      updatedAt: doc.updatedAt,
    },
    applied,
    rulesFound: parsed.found,
  }
}

export async function listKnowledgeDocumentsService(tenantId: string, hotelId: string) {
  return prisma.knowledgeDocument.findMany({
    where: { tenantId, OR: [{ hotelId: null }, { hotelId }] },
    orderBy: [{ hotelId: 'asc' }, { updatedAt: 'desc' }],
    select: { id: true, hotelId: true, title: true, version: true, rules: true, rulesErrors: true, rulesAppliedAt: true, isActive: true, updatedAt: true, updatedByUserId: true },
  })
}

export async function getKnowledgeDocumentService(id: string, tenantId: string) {
  const doc = await prisma.knowledgeDocument.findFirst({
    where: { id, tenantId },
    include: { revisions: { orderBy: { version: 'desc' }, take: 10, select: { version: true, createdAt: true, createdByUserId: true } } },
  })
  if (!doc) throw new NotFoundError('個社MD')
  return doc
}

export async function deleteKnowledgeDocumentService(id: string, tenantId: string): Promise<void> {
  const r = await prisma.knowledgeDocument.deleteMany({ where: { id, tenantId } })
  if (r.count === 0) throw new NotFoundError('個社MD')
  invalidateTenantIndex(tenantId)
}

/**
 * チャット・AIまとめ用: このホテルに効く個社ルールの要約と文書名
 */
export async function getTenantKnowledgeContextService(tenantId: string, hotelId: string): Promise<{ rulesSummary: string; documentTitles: string[]; rules: HotelRules | null }> {
  const docs = await prisma.knowledgeDocument.findMany({
    where: { tenantId, isActive: true, OR: [{ hotelId: null }, { hotelId }] },
    orderBy: [{ hotelId: 'desc' }, { updatedAt: 'desc' }], // ホテル専用を先に
    select: { title: true, rules: true, hotelId: true },
  })
  // ホテル専用のルールを優先し、無ければテナント共通
  const withRules = docs.find((d) => d.rules && d.hotelId === hotelId) ?? docs.find((d) => d.rules)
  const rules = (withRules?.rules as unknown as HotelRules | null) ?? null
  return { rulesSummary: summarizeRulesForPrompt(rules), documentTitles: docs.map((d) => d.title), rules }
}

export { FACTOR_GROUP_LABELS }
