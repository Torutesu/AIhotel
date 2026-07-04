import { PrismaClient, UserRole } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // 1. Create demo hotel
  const hotel = await prisma.hotel.upsert({
    where: { id: 'demo-hotel-001' },
    update: {},
    create: {
      id: 'demo-hotel-001',
      name: 'デモホテル東京',
      address: '東京都千代田区丸の内1-1-1',
      phone: '03-1234-5678',
      email: 'info@demo-hotel.example.com',
      totalRooms: 200,
    },
  })
  console.log(`✅ Created hotel: ${hotel.name}`)

  // 2. Create room types
  const roomTypes = [
    { code: 'STD_SINGLE', name: 'スタンダードシングル', capacity: 1, count: 80, sortOrder: 1 },
    { code: 'STD_DOUBLE', name: 'スタンダードダブル', capacity: 2, count: 40, sortOrder: 2 },
    { code: 'MOD_TWIN', name: 'モデレートツイン', capacity: 2, count: 50, sortOrder: 3 },
    { code: 'DLX_TWIN', name: 'デラックスツイン', capacity: 2, count: 20, sortOrder: 4 },
    { code: 'TRIPLE', name: 'トリプル', capacity: 3, count: 10, sortOrder: 5 },
  ]

  for (const rt of roomTypes) {
    await prisma.roomType.upsert({
      where: { hotelId_code: { hotelId: hotel.id, code: rt.code } },
      update: {},
      create: {
        hotelId: hotel.id,
        ...rt,
      },
    })
  }
  console.log(`✅ Created ${roomTypes.length} room types`)

  // 3. Create price ranks (65 levels)
  const priceRanks = []
  for (let i = 1; i <= 65; i++) {
    const ratio = (i - 1) / 64
    const base1P = Math.round(6500 + ratio * 23500) // 6,500 ~ 30,000
    priceRanks.push({
      hotelId: hotel.id,
      rank: i,
      label: `R${String(i).padStart(2, '0')}`,
      price1P: base1P,
      price2P: Math.round(base1P * 1.4),
      price3P: Math.round(base1P * 1.8),
    })
  }

  for (const pr of priceRanks) {
    await prisma.priceRank.upsert({
      where: { hotelId_rank: { hotelId: pr.hotelId, rank: pr.rank } },
      update: {},
      create: pr,
    })
  }
  console.log(`✅ Created ${priceRanks.length} price ranks`)

  // 4. Create admin user
  const hashedPassword = await bcrypt.hash('admin123', 12)
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@demo-hotel.example.com' },
    update: {},
    create: {
      email: 'admin@demo-hotel.example.com',
      password: hashedPassword,
      name: '管理者',
      role: UserRole.ADMIN,
      hotelId: hotel.id,
    },
  })
  console.log(`✅ Created admin user: ${adminUser.email}`)

  // 5. Create staff user
  const staffUser = await prisma.user.upsert({
    where: { email: 'staff@demo-hotel.example.com' },
    update: {},
    create: {
      email: 'staff@demo-hotel.example.com',
      password: hashedPassword,
      name: 'スタッフ',
      role: UserRole.STAFF,
      hotelId: hotel.id,
    },
  })
  console.log(`✅ Created staff user: ${staffUser.email}`)

  // 6. Create competitors
  const competitors = [
    { name: '競合ホテルA', category: '同カテゴリ' },
    { name: '競合ホテルB', category: '同カテゴリ' },
    { name: '競合ホテルC', category: '上位カテゴリ' },
  ]

  for (const comp of competitors) {
    await prisma.competitor.create({
      data: {
        hotelId: hotel.id,
        ...comp,
      },
    })
  }
  console.log(`✅ Created ${competitors.length} competitors`)

  // 7. Create sample campaigns
  const campaigns = [
    {
      name: '楽天スーパーSALE',
      channel: '楽天トラベル',
      source: 'ota',
      startDate: new Date('2025-03-01'),
      endDate: new Date('2025-03-15'),
      targetRooms: 500,
    },
    {
      name: '春の早期予約キャンペーン',
      channel: '公式サイト',
      source: 'manual',
      startDate: new Date('2025-02-01'),
      endDate: new Date('2025-04-30'),
      targetRooms: 200,
    },
  ]

  for (const camp of campaigns) {
    await prisma.campaign.create({
      data: {
        hotelId: hotel.id,
        ...camp,
      },
    })
  }
  console.log(`✅ Created ${campaigns.length} campaigns`)

  // 8. Create sample events
  const events = [
    {
      name: '東京マラソン',
      type: 'sports',
      startDate: new Date('2025-03-02'),
      endDate: new Date('2025-03-02'),
      location: '東京都心',
      expectedImpact: 'high',
    },
    {
      name: '桜シーズン',
      type: 'seasonal',
      startDate: new Date('2025-03-20'),
      endDate: new Date('2025-04-10'),
      expectedImpact: 'high',
    },
  ]

  for (const event of events) {
    await prisma.event.create({
      data: {
        hotelId: hotel.id,
        ...event,
      },
    })
  }
  console.log(`✅ Created ${events.length} events`)

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
