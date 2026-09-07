import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import type { CreateVenueInput, UpdateVenueInput } from '../../lib/validators.js'
import { estimateDemandPressure, estimateEventImpact } from './eventImpact.js'

export async function getVenuesService(hotelId: string) {
  const [hotel, venues] = await Promise.all([
    prisma.hotel.findUnique({ where: { id: hotelId }, select: { totalRooms: true } }),
    prisma.venue.findMany({ where: { hotelId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
  ])
  if (!hotel) throw new NotFoundError('ホテル')
  return venues.map((v) => ({
    ...v,
    // 会場だけから見た影響度の目安（イベントの来場者数が分かればそれで上書きされる）
    estimatedImpact: estimateEventImpact({ capacity: v.capacity, distanceKm: v.distanceKm, totalRooms: hotel.totalRooms }),
    demandPressure: estimateDemandPressure({ capacity: v.capacity, distanceKm: v.distanceKm, totalRooms: hotel.totalRooms }),
  }))
}

export async function createVenueService(input: CreateVenueInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId }, select: { tenantId: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  return prisma.venue.create({ data: { ...input, tenantId: hotel.tenantId } })
}

export async function updateVenueService(id: string, hotelId: string, data: UpdateVenueInput) {
  const result = await prisma.venue.updateMany({ where: { id, hotelId }, data })
  if (result.count === 0) throw new NotFoundError('会場')
  return prisma.venue.findUnique({ where: { id } })
}

export async function deleteVenueService(id: string, hotelId: string) {
  const result = await prisma.venue.deleteMany({ where: { id, hotelId } })
  if (result.count === 0) throw new NotFoundError('会場')
}
