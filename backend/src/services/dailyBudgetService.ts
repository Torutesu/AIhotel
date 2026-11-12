import { prisma } from '../lib/prisma.js'
import { monthRange } from '../lib/date.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import type { UpsertDailyBudgetsInput } from '../lib/validators.js'

// 日別の予算（D-13）。日の予算を持つ施設が登録する。登録した日は月次予算の日割りより優先する（dayContextService.ts）

const iso = (d: Date) => d.toISOString().slice(0, 10)

export async function getDailyBudgetsService(hotelId: string, year: number, month: number) {
  const { start, end } = monthRange(year, month)
  const rows = await prisma.dailyBudget.findMany({
    where: { hotelId, date: { gte: start, lt: end } },
    orderBy: { date: 'asc' },
    select: { date: true, budgetRooms: true, budgetRevenue: true },
  })
  return rows.map((r) => ({ ...r, date: iso(r.date) }))
}

export async function upsertDailyBudgetsService(input: UpsertDailyBudgetsInput) {
  const hotel = await prisma.hotel.findFirst({ where: { id: input.hotelId, isActive: true }, select: { tenantId: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const dates = input.days.map((d) => d.date)
  return prisma.$transaction(async (tx) => {
    const before = await tx.dailyBudget.findMany({
      where: { hotelId: input.hotelId, date: { in: dates } },
      select: { date: true, budgetRooms: true, budgetRevenue: true },
    })
    let saved = 0
    let cleared = 0
    for (const day of input.days) {
      const key = { hotelId_date: { hotelId: input.hotelId, date: day.date } }
      if (day.budgetRooms == null && day.budgetRevenue == null) {
        cleared += (await tx.dailyBudget.deleteMany({ where: { hotelId: input.hotelId, date: day.date } })).count
        continue
      }
      const data = { budgetRooms: day.budgetRooms, budgetRevenue: day.budgetRevenue }
      await tx.dailyBudget.upsert({
        where: key,
        create: { ...data, tenantId: hotel.tenantId, hotelId: input.hotelId, date: day.date },
        update: data,
      })
      saved++
    }
    return {
      tenantId: hotel.tenantId,
      before: before.map((b) => ({ ...b, date: iso(b.date) })),
      result: { saved, cleared },
    }
  })
}
