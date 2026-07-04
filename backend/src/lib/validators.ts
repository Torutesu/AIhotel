import { z } from 'zod'

// ======================================
// Common Validators
// ======================================

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const dateRangeSchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
}).refine(data => data.startDate <= data.endDate, {
  message: '開始日は終了日以前である必要があります',
})

export const idParamSchema = z.object({
  id: z.string().cuid(),
})

// ======================================
// Auth Validators
// ======================================

export const loginSchema = z.object({
  email: z.string().email('有効なメールアドレスを入力してください'),
  // パスワード強度は登録時に強制する。ログイン時は空でないことのみ検証する
  password: z.string().min(1, 'パスワードは必須です'),
})

export const registerSchema = z.object({
  email: z.string().email('有効なメールアドレスを入力してください'),
  password: z.string()
    .min(8, 'パスワードは8文字以上である必要があります')
    .regex(/[A-Z]/, '大文字を含める必要があります')
    .regex(/[a-z]/, '小文字を含める必要があります')
    .regex(/[0-9]/, '数字を含める必要があります'),
  name: z.string().min(1, '名前は必須です').max(100),
  role: z.enum(['ADMIN', 'MANAGER', 'OPERATOR']).optional(),
  hotelId: z.string().cuid().optional(),
})

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'リフレッシュトークンは必須です'),
})

// ======================================
// Hotel Validators
// ======================================

export const createHotelSchema = z.object({
  name: z.string().min(1, 'ホテル名は必須です').max(200),
  address: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  totalRooms: z.number().int().min(1, '部屋数は1以上である必要があります'),
})

export const updateHotelSchema = createHotelSchema.partial()

// ======================================
// Room Type Validators
// ======================================

export const createRoomTypeSchema = z.object({
  hotelId: z.string().cuid(),
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(50).regex(/^[A-Z0-9_]+$/, 'コードは大文字英数字とアンダースコアのみ使用可能です'),
  capacity: z.number().int().min(1).max(10),
  count: z.number().int().min(0),
  sortOrder: z.number().int().default(0),
})

export const updateRoomTypeSchema = createRoomTypeSchema.omit({ hotelId: true }).partial()

// ======================================
// Price Rank Validators
// ======================================

export const createPriceRankSchema = z.object({
  hotelId: z.string().cuid(),
  rank: z.number().int().min(1).max(100),
  label: z.string().min(1).max(10),
  price1P: z.number().int().min(0),
  price2P: z.number().int().min(0),
  price3P: z.number().int().min(0).optional(),
  price4P: z.number().int().min(0).optional(),
})

export const updatePriceRankSchema = createPriceRankSchema.omit({ hotelId: true, rank: true }).partial()

// ======================================
// Daily Data Validators
// ======================================

export const createDailyDataSchema = z.object({
  hotelId: z.string().cuid(),
  date: z.coerce.date(),
  occupancy: z.number().min(0).max(1).optional(),
  adr: z.number().min(0).optional(),
  revPar: z.number().min(0).optional(),
  totalRevenue: z.number().min(0).optional(),
  soldRooms: z.number().int().min(0).optional(),
  guests: z.number().int().min(0).optional(),
  budgetOccupancy: z.number().min(0).max(1).optional(),
  budgetAdr: z.number().min(0).optional(),
  budgetRevenue: z.number().min(0).optional(),
  isHoliday: z.boolean().default(false),
  holidayName: z.string().max(100).optional(),
  eventInfo: z.string().max(1000).optional(),
  externalFactors: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
})

export const updateDailyDataSchema = createDailyDataSchema.omit({ hotelId: true, date: true }).partial()

export const bulkUpdateDailyDataSchema = z.object({
  data: z.array(createDailyDataSchema).min(1).max(365),
})

// ======================================
// Campaign Validators
// ======================================

const campaignBaseSchema = z.object({
  hotelId: z.string().cuid(),
  name: z.string().min(1).max(200),
  channel: z.string().min(1).max(100),
  source: z.enum(['ota', 'manual']).default('manual'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  description: z.string().max(2000).optional(),
  targetRooms: z.number().int().min(0).optional(),
})

export const createCampaignSchema = campaignBaseSchema.refine(data => data.startDate <= data.endDate, {
  message: '開始日は終了日以前である必要があります',
})

export const updateCampaignSchema = campaignBaseSchema.omit({ hotelId: true }).partial()

// ======================================
// Event Validators
// ======================================

const eventBaseSchema = z.object({
  hotelId: z.string().cuid(),
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(50),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  location: z.string().max(200).optional(),
  expectedImpact: z.enum(['high', 'medium', 'low']).optional(),
  description: z.string().max(2000).optional(),
})

export const createEventSchema = eventBaseSchema.refine(data => data.startDate <= data.endDate, {
  message: '開始日は終了日以前である必要があります',
})

export const updateEventSchema = eventBaseSchema.omit({ hotelId: true }).partial()

// ======================================
// Query Validators
// ======================================

export const dailyDataQuerySchema = z.object({
  hotelId: z.string().cuid(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  ...paginationSchema.shape,
})

export const pricingQuerySchema = z.object({
  hotelId: z.string().cuid(),
  date: z.coerce.date().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
})

// ======================================
// Type Exports
// ======================================

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type CreateHotelInput = z.infer<typeof createHotelSchema>
export type UpdateHotelInput = z.infer<typeof updateHotelSchema>
export type CreateRoomTypeInput = z.infer<typeof createRoomTypeSchema>
export type UpdateRoomTypeInput = z.infer<typeof updateRoomTypeSchema>
export type CreateDailyDataInput = z.infer<typeof createDailyDataSchema>
export type UpdateDailyDataInput = z.infer<typeof updateDailyDataSchema>
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>
export type CreateEventInput = z.infer<typeof createEventSchema>
export type UpdateEventInput = z.infer<typeof updateEventSchema>
export type PaginationInput = z.infer<typeof paginationSchema>
export type DateRangeInput = z.infer<typeof dateRangeSchema>
