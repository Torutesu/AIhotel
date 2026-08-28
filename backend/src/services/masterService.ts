import { prisma } from '../lib/prisma.js'
import { NotFoundError, ConflictError } from '../middlewares/errorHandler.js'
import {
  DEFAULT_OTA_CHANNELS,
  DEFAULT_REVIEW_SOURCES,
  type MasterSeed,
} from '../lib/tenantMasters.js'
import type { Prisma } from '@prisma/client'

// テナント別マスタ（SAAS_DECISIONS.md D-10）。
// 実績テーブル側は文字列のまま保持し、このマスタは
// 「そのテナントで使ってよい値の登録簿」として画面の選択肢と入力検証に使う。
//
// OtaChannel と ReviewSource は同じ形だが、Prisma のデリゲートは共用体にすると
// 呼び出せないため、種別ごとに明示的に分岐する。

export type MasterKind = 'ota-channel' | 'review-source'

export interface MasterRow {
  id: string
  code: string
  name: string
  sortOrder: number
  isActive: boolean
}

interface MasterInput {
  code: string
  name: string
  sortOrder?: number
  isActive?: boolean
}

const LABELS: Record<MasterKind, string> = {
  'ota-channel': 'OTAチャネル',
  'review-source': 'レビューソース',
}

const ORDER_BY = [{ sortOrder: 'asc' as const }, { code: 'asc' as const }]

export async function listMastersService(
  kind: MasterKind,
  includeInactive = false
): Promise<MasterRow[]> {
  const where = includeInactive ? {} : { isActive: true }
  return kind === 'ota-channel'
    ? prisma.otaChannel.findMany({ where, orderBy: ORDER_BY })
    : prisma.reviewSource.findMany({ where, orderBy: ORDER_BY })
}

async function findByCode(kind: MasterKind, code: string) {
  return kind === 'ota-channel'
    ? prisma.otaChannel.findFirst({ where: { code } })
    : prisma.reviewSource.findFirst({ where: { code } })
}

export async function createMasterService(
  kind: MasterKind,
  input: MasterInput
): Promise<MasterRow> {
  // tenantId はコンテキストで決まるが、create には明示が必要なため自テナントを引く
  const tenant = await prisma.tenant.findFirst({ select: { id: true } })
  if (!tenant) throw new NotFoundError('テナント')

  if (await findByCode(kind, input.code)) {
    throw new ConflictError(`${LABELS[kind]}「${input.code}」は既に登録されています`)
  }

  const data = {
    tenantId: tenant.id,
    code: input.code,
    name: input.name,
    sortOrder: input.sortOrder ?? 0,
    isActive: input.isActive ?? true,
  }
  return kind === 'ota-channel'
    ? prisma.otaChannel.create({ data })
    : prisma.reviewSource.create({ data })
}

export async function updateMasterService(
  kind: MasterKind,
  id: string,
  data: Partial<Omit<MasterInput, 'code'>>
): Promise<MasterRow> {
  // RLS により他テナントの行は見えないため、id 指定だけで安全に更新できる
  const result =
    kind === 'ota-channel'
      ? await prisma.otaChannel.updateMany({ where: { id }, data })
      : await prisma.reviewSource.updateMany({ where: { id }, data })
  if (result.count === 0) throw new NotFoundError(LABELS[kind])

  const updated =
    kind === 'ota-channel'
      ? await prisma.otaChannel.findFirst({ where: { id } })
      : await prisma.reviewSource.findFirst({ where: { id } })
  if (!updated) throw new NotFoundError(LABELS[kind])
  return updated
}

/** 論理削除。実績データ側は文字列で残るため物理削除はしない */
export async function deactivateMasterService(kind: MasterKind, id: string): Promise<void> {
  const result =
    kind === 'ota-channel'
      ? await prisma.otaChannel.updateMany({ where: { id }, data: { isActive: false } })
      : await prisma.reviewSource.updateMany({ where: { id }, data: { isActive: false } })
  if (result.count === 0) throw new NotFoundError(LABELS[kind])
}

/**
 * テナント作成時に既定のマスタを投入する（D-10）。
 * 初期設定の項目を増やさないため、プロビジョニングの中で自動的に呼ぶ。
 */
export async function seedDefaultMasters(tx: Prisma.TransactionClient, tenantId: string) {
  const toRow = (seed: MasterSeed) => ({ ...seed, tenantId })
  await tx.otaChannel.createMany({ data: DEFAULT_OTA_CHANNELS.map(toRow) })
  await tx.reviewSource.createMany({ data: DEFAULT_REVIEW_SOURCES.map(toRow) })
  return {
    otaChannels: DEFAULT_OTA_CHANNELS.length,
    reviewSources: DEFAULT_REVIEW_SOURCES.length,
  }
}
