import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import type { UpdatePreferencesInput } from '../lib/validators.js'

// 利用者ごとの画面表示設定（#51-2）。
//
// 従来はブラウザの localStorage にのみ保存していたため、端末やブラウザを変えると
// 設定が失われていた。ここでサーバに保存し、どの端末からでも同じ表示になるようにする。
//
// 保存単位は (userId, hotelId)。表示設定は利用者ごとの好みであり、
// 同じホテルの他の利用者に影響しない（＝テナント共有設定ではない）。

/** ダッシュボードKPI進捗表で選択できる指標（F-DASH-01）。フロントエンドの並び順と一致させる */
export const DASHBOARD_KPI_KEYS = [
  'roomRevenue',
  'soldRooms',
  'adr',
  'occupancyRate',
  'revPar',
  'guests',
  'dor',
  'guestUnitPrice',
] as const

export type DashboardKpiKey = (typeof DASHBOARD_KPI_KEYS)[number]

export interface DashboardPreference {
  /** 「販売サイト別実績」セクションを表示するか */
  showTopSitesSection: boolean
  /** KPI進捗表に表示する指標。空にはできない（空なら既定値に戻す） */
  kpiItems: DashboardKpiKey[]
}

export interface UserPreferences {
  hotelId: string
  dashboard: DashboardPreference
}

const DEFAULT_DASHBOARD: DashboardPreference = {
  showTopSitesSection: false,
  kpiItems: [...DASHBOARD_KPI_KEYS],
}

/**
 * DB の Json 列を型付きの設定に正規化する。
 *
 * Json 列は過去バージョンの形・手動更新・キー追加前の行など想定外の値を含み得るため、
 * 読み出し側で必ず既定値へフォールバックする（画面が壊れるのを防ぐ）。
 */
function normalizeDashboard(value: unknown): DashboardPreference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...DEFAULT_DASHBOARD }
  }
  const raw = value as Record<string, unknown>

  const kpiItems = Array.isArray(raw.kpiItems)
    ? DASHBOARD_KPI_KEYS.filter((key) => (raw.kpiItems as unknown[]).includes(key))
    : []

  return {
    showTopSitesSection: raw.showTopSitesSection === true,
    kpiItems: kpiItems.length > 0 ? kpiItems : [...DEFAULT_DASHBOARD.kpiItems],
  }
}

async function getHotelTenantId(hotelId: string): Promise<string> {
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, isActive: true },
    select: { tenantId: true },
  })
  if (!hotel) throw new NotFoundError('ホテル')
  return hotel.tenantId
}

/**
 * 表示設定の取得。未保存なら既定値を返す（行は作らない）。
 */
export async function getPreferencesService(
  userId: string,
  hotelId: string
): Promise<UserPreferences> {
  const preference = await prisma.userPreference.findUnique({
    where: { userId_hotelId: { userId, hotelId } },
    select: { dashboard: true },
  })

  return {
    hotelId,
    dashboard: normalizeDashboard(preference?.dashboard),
  }
}

/**
 * 表示設定の保存（upsert）。
 *
 * 呼び出し元は自分自身の userId しか渡せない（controller で req.user から取る）ため、
 * 他人の設定を書き換える経路は存在しない。tenantId はホテルから引くので、
 * 他テナントのホテルIDを指定しても requireHotelAccess で先に弾かれる。
 */
export async function updatePreferencesService(
  userId: string,
  input: UpdatePreferencesInput
): Promise<UserPreferences> {
  const tenantId = await getHotelTenantId(input.hotelId)
  // Json 列へ渡すため、zod 検証済みの値を Prisma の InputJsonValue に合わせて扱う
  const dashboard = normalizeDashboard(input.dashboard) as unknown as Prisma.InputJsonObject

  const saved = await prisma.userPreference.upsert({
    where: { userId_hotelId: { userId, hotelId: input.hotelId } },
    create: {
      userId,
      hotelId: input.hotelId,
      tenantId,
      dashboard,
    },
    update: { dashboard },
    select: { dashboard: true },
  })

  return {
    hotelId: input.hotelId,
    dashboard: normalizeDashboard(saved.dashboard),
  }
}
