import { randomBytes } from 'node:crypto'
import type { AgentDevice, AgentDeviceRole } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { hashToken } from '../lib/auth.js'
import { NotFoundError, UnauthorizedError, BadRequestError } from '../middlewares/errorHandler.js'

// コネクタエージェントのデバイス管理（docs/コネクタ連携設計.md §5, §12）。
// トークン・ペアリングコードはいずれも SHA-256 ハッシュのみDB保存する（hashToken() 踏襲）。

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000 // ペアリングコードは10分有効・1回限り
const HEARTBEAT_UPDATE_THROTTLE_MS = 30 * 1000

/**
 * ペアリングコードを発行する（ADMIN/MANAGER が管理UIから実行）。
 * 生のコードはこのレスポンスでのみ返り、以後取得できない。
 */
export async function issuePairingCode(input: {
  hotelId: string
  deviceName: string
  deviceRole?: AgentDeviceRole
  createdById: string
}) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  // 32桁hex — 総当たりに耐える十分なエントロピー（128bit）
  const rawCode = randomBytes(16).toString('hex')
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS)

  await prisma.agentPairingCode.create({
    data: {
      tenantId: hotel.tenantId,
      hotelId: input.hotelId,
      codeHash: hashToken(rawCode),
      deviceName: input.deviceName,
      deviceRole: input.deviceRole ?? 'PRIMARY',
      expiresAt,
      createdById: input.createdById,
    },
  })

  return { code: rawCode, expiresAt }
}

/**
 * ペアリングコードをデバイストークンに交換する（エージェント初回セットアップ）。
 * 生のトークンはこのレスポンスでのみ返る。
 */
export async function pairDevice(rawCode: string, agentVersion?: string) {
  const codeHash = hashToken(rawCode)
  const now = new Date()

  // 使用済みマークを先に原子的に行い、同一コードの二重交換を防ぐ
  const claimed = await prisma.agentPairingCode.updateMany({
    where: { codeHash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  })
  if (claimed.count === 0) {
    throw new UnauthorizedError('ペアリングコードが無効か期限切れです')
  }
  const code = await prisma.agentPairingCode.findUnique({ where: { codeHash } })
  if (!code) throw new UnauthorizedError('ペアリングコードが無効です')

  const rawToken = randomBytes(32).toString('hex')
  const device = await prisma.agentDevice.create({
    data: {
      tenantId: code.tenantId,
      hotelId: code.hotelId,
      name: code.deviceName,
      role: code.deviceRole,
      tokenHash: hashToken(rawToken),
      tokenRotatedAt: now,
      agentVersion: agentVersion ?? null,
      lastSeenAt: now,
    },
  })

  return {
    deviceToken: rawToken,
    device: { id: device.id, hotelId: device.hotelId, name: device.name, role: device.role },
  }
}

/**
 * デバイストークンから有効なデバイスを引く（deviceAuth ミドルウェア用）。
 * 失効（revokedAt）・無効化済みは認証失敗として扱う。
 */
export async function findActiveDeviceByToken(rawToken: string): Promise<AgentDevice | null> {
  const device = await prisma.agentDevice.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  })
  if (!device || !device.isActive || device.revokedAt) return null
  return device
}

/**
 * lastSeenAt を更新する（デッドマン検知 §14.1 の基準）。
 * 毎リクエストのUPDATEを避けるため短時間の連続更新はスロットルする。
 */
export async function touchDevice(device: AgentDevice, agentVersion?: string): Promise<void> {
  const now = Date.now()
  if (
    device.lastSeenAt &&
    now - device.lastSeenAt.getTime() < HEARTBEAT_UPDATE_THROTTLE_MS &&
    (!agentVersion || agentVersion === device.agentVersion)
  ) {
    return
  }
  await prisma.agentDevice.updateMany({
    where: { id: device.id },
    data: { lastSeenAt: new Date(), ...(agentVersion ? { agentVersion } : {}) },
  })
}

/**
 * デバイス即時失効（kill switch — §12）。以後のリクエストは401になる。
 */
export async function revokeDevice(deviceId: string, hotelId: string) {
  // hotelId 条件でテナント越え失効を防ぐ
  const result = await prisma.agentDevice.updateMany({
    where: { id: deviceId, hotelId, revokedAt: null },
    data: { revokedAt: new Date(), isActive: false },
  })
  if (result.count === 0) throw new NotFoundError('デバイス')
  return prisma.agentDevice.findUnique({
    where: { id: deviceId },
    select: { id: true, tenantId: true, hotelId: true, name: true, revokedAt: true },
  })
}

/**
 * ホテルのデバイス一覧（連携ステータス表示用）
 */
export async function listDevices(hotelId: string) {
  return prisma.agentDevice.findMany({
    where: { hotelId },
    select: {
      id: true,
      name: true,
      role: true,
      agentVersion: true,
      lastSeenAt: true,
      isActive: true,
      revokedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })
}

/**
 * デバイストークンのローテーション（§12 — 90日運用）。
 * エージェントが現行トークンで認証済みの状態で呼び、新トークンに差し替える。
 */
export async function rotateDeviceToken(deviceId: string) {
  const device = await prisma.agentDevice.findUnique({ where: { id: deviceId } })
  if (!device || !device.isActive || device.revokedAt) {
    throw new BadRequestError('ローテーション対象のデバイスが無効です')
  }
  const rawToken = randomBytes(32).toString('hex')
  await prisma.agentDevice.update({
    where: { id: deviceId },
    data: { tokenHash: hashToken(rawToken), tokenRotatedAt: new Date() },
  })
  return { deviceToken: rawToken }
}
