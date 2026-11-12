import { prisma } from '../lib/prisma.js'
import { config } from '../lib/config.js'
import { hashPassword } from '../lib/auth.js'
import { DEFAULT_WEEKEND_DAYS } from '../lib/date.js'
import { ConflictError } from '../middlewares/errorHandler.js'
import { logger } from '../utils/logger.js'
import { generateTemporaryPassword } from './usersService.js'
import { runWeatherForHotels } from './externalSignals/jmaWeather.js'
import type { ProvisionTenantInput } from '../lib/validators.js'

// 新しいテナントの立ち上げ（D-13 / R-3-8）。運営が1回の呼び出しでテナント・最初のホテル・テナント管理者を作る。
// 3つは1つのトランザクションで作り、途中で失敗したら何も残さない（これまでは別々の呼び出しで半端な状態が残り得た）。
// 管理者には一時パスワードを発行し、初回ログインで変更を強制する（メールで送れなければ運営の画面に1回だけ返す）。
// 作ったあと、そのホテルの天気だけはすぐ取る（外部要因エージェントは次の日次の外部要因ジョブで動く）。
// マスタ（部屋タイプ・料金ランク・競合・予算）はテナント管理者が初期設定シートで入れる（docs/運用手順書.md）。

export interface ProvisionResult {
  tenant: { id: string; name: string; code: string }
  hotel: { id: string; name: string }
  admin: { id: string; email: string; name: string }
  temporaryPassword: string
}

export async function provisionTenantService(input: ProvisionTenantInput): Promise<ProvisionResult> {
  const [codeTaken, emailTaken] = await Promise.all([
    prisma.tenant.findUnique({ where: { code: input.tenant.code }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: input.admin.email }, select: { id: true } }),
  ])
  if (codeTaken) throw new ConflictError('このテナントコードは既に使われています')
  // 他テナントの存在を推測させない文言にする（R-3-3）
  if (emailTaken) throw new ConflictError('このメールアドレスは登録できません')

  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await hashPassword(temporaryPassword)
  const { hotel: hotelInput } = input

  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name: input.tenant.name, code: input.tenant.code } })
    const hotel = await tx.hotel.create({
      data: {
        tenantId: tenant.id,
        name: hotelInput.name,
        totalRooms: hotelInput.totalRooms,
        address: hotelInput.address,
        phone: hotelInput.phone,
        email: hotelInput.email,
        hotelType: hotelInput.hotelType ?? null,
        prefectureCode: hotelInput.prefectureCode ?? null,
        municipalityCode: hotelInput.municipalityCode ?? null,
        marketArea: hotelInput.marketArea ?? null,
        weekendDays: hotelInput.weekendDays ?? [...DEFAULT_WEEKEND_DAYS],
        saleOpenDaysBefore: hotelInput.saleOpenDaysBefore ?? null,
        weatherAreaCode: hotelInput.weatherAreaCode ?? null,
        openedOn: hotelInput.openedOn ?? null,
      },
    })
    // 管理者はテナント全体を見る（ホテルには所属させない — #79 の「ホテル所属の利用者」とは別）
    const admin = await tx.user.create({
      data: {
        email: input.admin.email,
        name: input.admin.name,
        password: passwordHash,
        role: 'ADMIN',
        tenantId: tenant.id,
        mustChangePassword: true,
      },
    })
    return {
      tenant: { id: tenant.id, name: tenant.name, code: tenant.code },
      hotel: { id: hotel.id, name: hotel.name, tenantId: tenant.id, prefectureCode: hotel.prefectureCode, weatherAreaCode: hotel.weatherAreaCode },
      admin: { id: admin.id, email: admin.email, name: admin.name },
    }
  })

  // 天気は失敗しても立ち上げを失敗にしない（翌日の外部要因ジョブで取り直す）。テストでは外に出ない
  if (config.NODE_ENV !== 'test') try {
    await runWeatherForHotels([{ id: result.hotel.id, tenantId: result.hotel.tenantId, prefectureCode: result.hotel.prefectureCode, weatherAreaCode: result.hotel.weatherAreaCode }])
  } catch (error) {
    logger.warn({ hotelId: result.hotel.id, err: error }, '立ち上げ直後の天気の取得に失敗しました（日次の外部要因ジョブで取り直します）')
  }

  return { tenant: result.tenant, hotel: { id: result.hotel.id, name: result.hotel.name }, admin: result.admin, temporaryPassword }
}
