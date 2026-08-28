import { prisma } from '../lib/prisma.js'
import { NotFoundError, ConflictError } from '../middlewares/errorHandler.js'
import type { CreateRoomTypeInput, UpdateRoomTypeInput } from '../lib/validators.js'

// 客室タイプの個別編集。CSV一括投入（SAAS_ONBOARDING.md Step 3）だけだと
// 1タイプの室数を直すのにCSVを作り直すことになるため、単体のCRUDも提供する。

export async function listRoomTypesService(hotelId: string, includeInactive = false) {
  return prisma.roomType.findMany({
    where: { hotelId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  })
}

export async function createRoomTypeService(input: CreateRoomTypeInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const existing = await prisma.roomType.findFirst({
    where: { hotelId: input.hotelId, code: input.code },
  })
  if (existing) {
    throw new ConflictError(`客室タイプ「${input.code}」は既に登録されています`)
  }

  return prisma.roomType.create({
    data: { ...input, tenantId: hotel.tenantId },
  })
}

export async function updateRoomTypeService(
  id: string,
  hotelId: string,
  data: UpdateRoomTypeInput
) {
  // hotelId 条件を含めることでテナント越え更新を防ぐ（RLSと二重の防御）
  const result = await prisma.roomType.updateMany({ where: { id, hotelId }, data })
  if (result.count === 0) throw new NotFoundError('客室タイプ')
  return prisma.roomType.findUnique({ where: { id } })
}

/** 論理削除。実績データ（DailyRoomData）が参照するため物理削除はしない */
export async function deactivateRoomTypeService(id: string, hotelId: string) {
  const result = await prisma.roomType.updateMany({
    where: { id, hotelId },
    data: { isActive: false },
  })
  if (result.count === 0) throw new NotFoundError('客室タイプ')
}
