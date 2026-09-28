import { PrismaClient, UserRole } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { DEFAULT_WEEKEND_DAYS, todayJst } from '../src/lib/date.js'
import { populateDemoHotelData } from '../src/services/demoDataService.js'

const prisma = new PrismaClient()

const TENANT_CODE = 'demo-tenant'
const HOTEL_ID = 'demo-hotel-001'

/**
 * 本番では走らせない（R-2-6）。seed は全員共通のパスワード（Admin1234）のデモアカウントを作るため、
 * 本番の DB に入ると誰でもログインできてしまう。本番のデモデータは `job seed-demo`（推測できないパスワード）で作る
 */
function refuseInProduction() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NODE_ENV=production では seed を実行できません（共通パスワードのデモアカウントが作られるため）。' +
        'デモデータは `job seed-demo`、運営アカウントは `job create-platform-admin` で作ってください'
    )
  }
}

async function main() {
  refuseInProduction()
  console.log('🌱 Seeding database...')

  // 1. Tenant
  const tenant = await prisma.tenant.upsert({
    where: { code: TENANT_CODE },
    update: {},
    create: {
      code: TENANT_CODE,
      name: 'デモテナント（藤田観光想定）',
    },
  })
  console.log(`✅ Tenant: ${tenant.name}`)

  // 2. Hotel
  const DEMO_HOTEL_MARKET = {
    hotelType: 'FULL_SERVICE' as const,
    prefectureCode: '13',
    municipalityCode: '131016', // 千代田区
    marketArea: '丸の内',
  }
  const hotel = await prisma.hotel.upsert({
    where: { id: HOTEL_ID },
    // ホテルタイプとマーケット（#13）は既存のデモ環境にも入れる（未設定だと初期設定のチェックリストが出続けるため）
    update: { tenantId: tenant.id, ...DEMO_HOTEL_MARKET },
    create: {
      id: HOTEL_ID,
      tenantId: tenant.id,
      ...DEMO_HOTEL_MARKET,
      name: 'デモホテル東京',
      address: '東京都千代田区丸の内1-1-1',
      phone: '03-1234-5678',
      email: 'info@demo-hotel.example.com',
      totalRooms: 200,
      weekendDays: [...DEFAULT_WEEKEND_DAYS], // 金・土
    },
  })
  console.log(`✅ Hotel: ${hotel.name}`)

  // 5. Users（要件定義書 §5: 運営 / 管理者 / マネージャー / オペレーター）
  //
  // デモの3アカウントはすべてテナント所属（ADMIN もテナント管理者であり
  // 他テナントには一切アクセスできない — #62）。
  // 運営（PLATFORM_ADMIN）は tenantId / hotelId を持たない別枠のアカウントとして作る。
  const hashedPassword = await bcrypt.hash('Admin1234', 12)
  const users = [
    { email: 'admin@demo-hotel.example.com', name: '管理者', role: UserRole.ADMIN },
    { email: 'manager@demo-hotel.example.com', name: 'レベニューマネージャー', role: UserRole.MANAGER },
    { email: 'operator@demo-hotel.example.com', name: 'フロント担当', role: UserRole.OPERATOR },
  ]
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { tenantId: tenant.id, hotelId: hotel.id, role: u.role },
      create: {
        ...u,
        password: hashedPassword,
        tenantId: tenant.id,
        hotelId: hotel.id,
      },
    })
  }

  // 運営アカウント（PLATFORM_ADMIN）。テナントに属さないため tenantId / hotelId は null
  const PLATFORM_ADMIN_EMAIL = 'platform@example.com'
  await prisma.user.upsert({
    where: { email: PLATFORM_ADMIN_EMAIL },
    update: { tenantId: null, hotelId: null, role: UserRole.PLATFORM_ADMIN },
    create: {
      email: PLATFORM_ADMIN_EMAIL,
      name: '運営',
      role: UserRole.PLATFORM_ADMIN,
      password: hashedPassword,
      tenantId: null,
      hotelId: null,
    },
  })
  console.log(`✅ Users: ${users.length + 1} (password: Admin1234)`)

  // 6〜14. 部屋タイプ・料金ランク・実績・予測・競合・予算・アラート等（トライアルの発行と共用）
  await populateDemoHotelData(prisma, { tenantId: tenant.id, hotelId: hotel.id, today: todayJst() })
  console.log('✅ Demo hotel data (room types, price ranks, daily data, forecasts, competitors, budgets, alerts, reviews)')

  console.log('✨ Seeding completed!')
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
