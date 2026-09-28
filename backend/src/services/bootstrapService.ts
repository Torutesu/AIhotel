import { prisma } from '../lib/prisma.js'
import { hashPassword } from '../lib/auth.js'
import { DEFAULT_WEEKEND_DAYS, todayJst } from '../lib/date.js'
import { generateTemporaryPassword } from './usersService.js'
import { populateDemoHotelData } from './demoDataService.js'

// 検証・本番環境の立ち上げ用（コンテナの `job create-platform-admin` / `job seed-demo` から呼ぶ）。
//
// prisma/seed.ts は開発用で、パスワードが公開されている運営アカウント（platform@example.com / Admin1234）を作る。
// 公開 URL の環境で使うと誰でも運営として入れてしまうため、ここでは推測できないパスワードを発行し、
// 初回ログインで変更を強制する（#89 の mustChangePassword）。

/**
 * 運営（PLATFORM_ADMIN）アカウントを作る。既にあればパスワードを発行し直す（運営以外のロールのアカウントには触れない）。
 * 発行したパスワードは戻り値で1回だけ返す
 */
export async function createOrResetPlatformAdminService(
  email: string,
  name = '運営'
): Promise<{ created: boolean; password: string }> {
  const normalized = email.trim().toLowerCase()
  const existing = await prisma.user.findUnique({ where: { email: normalized } })
  if (existing && existing.role !== 'PLATFORM_ADMIN') {
    throw new Error(`${normalized} は運営以外のアカウントとして使われています`)
  }
  const password = generateTemporaryPassword()
  const passwordHash = await hashPassword(password)
  if (existing) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: existing.id },
        data: { password: passwordHash, mustChangePassword: true, isActive: true, failedLoginCount: 0, lockedUntil: null },
      }),
      prisma.refreshToken.deleteMany({ where: { userId: existing.id } }),
    ])
    return { created: false, password }
  }
  await prisma.user.create({
    data: {
      email: normalized,
      name,
      role: 'PLATFORM_ADMIN',
      password: passwordHash,
      mustChangePassword: true,
      tenantId: null,
      hotelId: null,
    },
  })
  return { created: true, password }
}

export const DEMO_TENANT_CODE = 'demo-tenant'
export const DEMO_HOTEL_ID = 'demo-hotel-001'
const DEMO_USERS = [
  { email: 'admin@demo-hotel.example.com', name: '管理者', role: 'ADMIN' as const },
  { email: 'manager@demo-hotel.example.com', name: 'レベニューマネージャー', role: 'MANAGER' as const },
  { email: 'operator@demo-hotel.example.com', name: 'フロント担当', role: 'OPERATOR' as const },
]

/**
 * デモテナント（デモホテルとデモデータ、管理者・マネージャー・オペレーターの3アカウント）を作る。
 * デモデータは毎回今日を基準に作り直す。アカウントは無ければ作り、そのときだけパスワードを返す（既存のパスワードは変えない）
 */
export async function seedDemoTenantService(now: Date = new Date()): Promise<{
  createdUsers: Array<{ email: string; role: string; password: string }>
}> {
  const tenant = await prisma.tenant.upsert({
    where: { code: DEMO_TENANT_CODE },
    update: {},
    create: { code: DEMO_TENANT_CODE, name: 'デモテナント' },
  })
  const market = { hotelType: 'FULL_SERVICE' as const, prefectureCode: '13', municipalityCode: '131016', marketArea: '丸の内' }
  const hotel = await prisma.hotel.upsert({
    where: { id: DEMO_HOTEL_ID },
    update: { tenantId: tenant.id, ...market },
    create: {
      id: DEMO_HOTEL_ID,
      tenantId: tenant.id,
      ...market,
      name: 'デモホテル東京',
      address: '東京都千代田区丸の内1-1-1',
      totalRooms: 200,
      weekendDays: [...DEFAULT_WEEKEND_DAYS],
    },
  })

  const createdUsers: Array<{ email: string; role: string; password: string }> = []
  for (const u of DEMO_USERS) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } })
    if (existing) continue
    const password = generateTemporaryPassword()
    await prisma.user.create({
      data: { ...u, password: await hashPassword(password), tenantId: tenant.id, hotelId: hotel.id },
    })
    createdUsers.push({ email: u.email, role: u.role, password })
  }

  await populateDemoHotelData(prisma, { tenantId: tenant.id, hotelId: hotel.id, today: todayJst(now) })
  return { createdUsers }
}
