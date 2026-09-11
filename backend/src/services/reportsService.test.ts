import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = {
  hotel: { findUnique: vi.fn() },
  dailyData: { findMany: vi.fn(), aggregate: vi.fn() },
  monthlyBudget: { findUnique: vi.fn() },
}

const storageMock = {
  put: vi.fn(),
  get: vi.fn(),
  exists: vi.fn(),
}

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../lib/storage.js', () => ({ storage: storageMock }))

const { getMonthlyReportService } = await import('./reportsService.js')

const hotel = {
  id: 'hotel-1',
  name: 'テストホテル',
  totalRooms: 100,
  weekendDays: [5, 6],
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

function setDataRevision(count: number, updatedAt: Date) {
  prismaMock.dailyData.aggregate.mockResolvedValue({
    _count: { _all: count },
    _max: { updatedAt },
  })
}

describe('getMonthlyReportService キャッシュ', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.hotel.findUnique.mockResolvedValue(hotel)
    prismaMock.dailyData.findMany.mockResolvedValue([])
    prismaMock.monthlyBudget.findUnique.mockResolvedValue(null)
    storageMock.exists.mockResolvedValue(false)
    storageMock.put.mockResolvedValue(undefined)
  })

  it('元データが変わらなければ同じキーでキャッシュを返す', async () => {
    setDataRevision(10, new Date('2026-06-10T00:00:00Z'))

    await getMonthlyReportService('hotel-1', 2026, 6, 'excel')
    const firstKey = storageMock.put.mock.calls[0][0] as string

    storageMock.exists.mockResolvedValue(true)
    storageMock.get.mockResolvedValue(Buffer.from('cached'))
    const second = await getMonthlyReportService('hotel-1', 2026, 6, 'excel')

    expect(storageMock.exists).toHaveBeenLastCalledWith(firstKey)
    expect(second.buffer.toString()).toBe('cached')
    expect(storageMock.put).toHaveBeenCalledTimes(1)
  })

  it('元データが更新されると別キーになり再生成する（古いレポートを返さない）', async () => {
    setDataRevision(10, new Date('2026-06-10T00:00:00Z'))
    await getMonthlyReportService('hotel-1', 2026, 6, 'excel')
    const firstKey = storageMock.put.mock.calls[0][0] as string

    // 実績が1日ぶん追加された
    setDataRevision(11, new Date('2026-06-11T00:00:00Z'))
    await getMonthlyReportService('hotel-1', 2026, 6, 'excel')
    const secondKey = storageMock.put.mock.calls[1][0] as string

    expect(secondKey).not.toBe(firstKey)
    expect(storageMock.put).toHaveBeenCalledTimes(2)
  })

  it('予算の更新でもキャッシュが無効化される', async () => {
    setDataRevision(10, new Date('2026-06-10T00:00:00Z'))
    await getMonthlyReportService('hotel-1', 2026, 6, 'excel')
    const firstKey = storageMock.put.mock.calls[0][0] as string

    prismaMock.monthlyBudget.findUnique.mockResolvedValue({
      budgetRevenue: 1_000_000,
      lastYearRevenue: null,
      updatedAt: new Date('2026-06-12T00:00:00Z'),
    })
    await getMonthlyReportService('hotel-1', 2026, 6, 'excel')
    const secondKey = storageMock.put.mock.calls[1][0] as string

    expect(secondKey).not.toBe(firstKey)
  })
})
