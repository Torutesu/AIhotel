import type { Prisma } from '@prisma/client'

// 競合×宿泊日の代表値（CompetitorPriceData）を観測値（CompetitorRateObservation）から作る（#9 段階B）。
//
// 1. 取得元ごとに最新の観測値だけを使う
// 2. 最も新しい観測から REPRESENTATIVE_WINDOW_HOURS より古い取得元は外す（ある取得元の取得が止まったとき、
//    古い値が最安値として残り続けないようにする）
// 3. 人数ごとの最安値。全取得元が満室なら満室
// 推奨に使うかどうか（取得から48時間以内か）は、推奨の計算側（strategyWeighting）が observedAt で判定する。

export const REPRESENTATIVE_WINDOW_HOURS = 48

export interface ObservationLike {
  source: string
  price1P: number | null
  price2P: number | null
  price3P: number | null
  soldOut: boolean
  observedAt: Date
}

export interface Representative {
  price1P: number | null
  price2P: number | null
  price3P: number | null
  soldOut: boolean
  observedAt: Date
  sources: string[]
}

const minOrNull = (values: Array<number | null>): number | null => {
  const present = values.filter((v): v is number => v != null)
  return present.length > 0 ? Math.min(...present) : null
}

/** 観測値の集まりから代表値を作る（純関数）。観測値が無ければ null */
export function buildRepresentative(observations: ObservationLike[]): Representative | null {
  if (observations.length === 0) return null
  const latestBySource = new Map<string, ObservationLike>()
  for (const o of observations) {
    const current = latestBySource.get(o.source)
    if (!current || o.observedAt > current.observedAt) latestBySource.set(o.source, o)
  }
  const latest = [...latestBySource.values()]
  const newest = Math.max(...latest.map((o) => o.observedAt.getTime()))
  const recent = latest.filter((o) => newest - o.observedAt.getTime() <= REPRESENTATIVE_WINDOW_HOURS * 3_600_000)

  return {
    price1P: minOrNull(recent.map((o) => o.price1P)),
    price2P: minOrNull(recent.map((o) => o.price2P)),
    price3P: minOrNull(recent.map((o) => o.price3P)),
    soldOut: recent.every((o) => o.soldOut),
    observedAt: new Date(newest),
    sources: recent.map((o) => o.source).sort(),
  }
}

/** 代表値の変化（変動の監視 — monitoring.ts が使う）。前の代表値があった行だけ */
export interface RepresentativeChange {
  competitorId: string
  stayDate: Date
  before: { price1P: number | null; price2P: number | null; soldOut: boolean }
  after: { price1P: number | null; price2P: number | null; soldOut: boolean }
}

/**
 * 指定した競合×宿泊日の代表値を作り直す（トランザクションの中で呼ぶ）。
 * 新規作成した件数・更新した件数と、前の代表値からの変化を返す
 */
export async function rebuildRepresentatives(
  tx: Prisma.TransactionClient,
  tenantId: string,
  keys: Array<{ competitorId: string; stayDate: Date }>
): Promise<{ created: number; updated: number; changes: RepresentativeChange[] }> {
  let created = 0
  let updated = 0
  const changes: RepresentativeChange[] = []
  const unique = [...new Map(keys.map((k) => [`${k.competitorId}|${k.stayDate.getTime()}`, k])).values()]
  for (const { competitorId, stayDate } of unique) {
    const observations = await tx.competitorRateObservation.findMany({
      where: { competitorId, stayDate },
      orderBy: { observedAt: 'desc' },
      // 取得元の数（最大9）×直近の数回ぶんあれば足りる
      take: 50,
    })
    const rep = buildRepresentative(observations)
    if (!rep) continue
    const values = {
      price1P: rep.price1P,
      price2P: rep.price2P,
      price3P: rep.price3P,
      soldOut: rep.soldOut,
      observedAt: rep.observedAt,
      dataSource: rep.sources.join('+'),
      reliability: null,
    }
    const existing = await tx.competitorPriceData.findUnique({ where: { competitorId_date: { competitorId, date: stayDate } } })
    if (existing) {
      await tx.competitorPriceData.update({ where: { id: existing.id }, data: values })
      updated++
      changes.push({
        competitorId,
        stayDate,
        before: { price1P: existing.price1P, price2P: existing.price2P, soldOut: existing.soldOut },
        after: { price1P: rep.price1P, price2P: rep.price2P, soldOut: rep.soldOut },
      })
    } else {
      await tx.competitorPriceData.create({ data: { tenantId, competitorId, date: stayDate, ...values } })
      created++
    }
  }
  return { created, updated, changes }
}
