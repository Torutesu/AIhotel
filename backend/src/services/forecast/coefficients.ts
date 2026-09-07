// ホテル別の学習済み係数（FactorCoefficient）を初期値とマージして読み込む
import { prisma } from '../../lib/prisma.js'
import { coefficientsWithDefaults } from './factorDefaults.js'

export async function loadCoefficientMap(hotelId: string): Promise<Map<string, number>> {
  const rows = await prisma.factorCoefficient.findMany({
    where: { hotelId },
    select: { factorKey: true, value: true },
  })
  return coefficientsWithDefaults(rows.map((r) => [r.factorKey, r.value] as const))
}
