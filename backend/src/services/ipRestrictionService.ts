import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { BadRequestError, NotFoundError } from '../middlewares/errorHandler.js'
import { isIpAllowed, normalizeIp, readAllowlist, type IpAllowEntry } from '../lib/ipAllowlist.js'

// テナントの IP 制限（#12）。設定するのはテナントの管理者（ADMIN）。
//
// 締め出し防止: 制限を有効にして保存するとき、保存している本人のアクセス元 IP が許可リストに入っていなければ 400 にする。
// それでも締め出されたとき（アクセス元 IP が変わった等）は、運営が /platform から制限を解除する（運用手順書 §7.2）。

export interface IpRestrictionSettings {
  enabled: boolean
  entries: IpAllowEntry[]
  /** この API を呼んだ本人のアクセス元 IP（許可リストに追加しやすくするため） */
  currentIp: string | null
}

export async function getIpRestrictionService(tenantId: string, clientIp: string | undefined): Promise<IpRestrictionSettings> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { ipRestrictionEnabled: true, ipAllowlist: true },
  })
  if (!tenant) throw new NotFoundError('テナント')
  return { enabled: tenant.ipRestrictionEnabled, entries: readAllowlist(tenant.ipAllowlist), currentIp: normalizeIp(clientIp) }
}

export async function updateIpRestrictionService(
  tenantId: string,
  input: { enabled: boolean; entries: IpAllowEntry[] },
  clientIp: string | undefined
): Promise<{ before: IpRestrictionSettings; after: IpRestrictionSettings }> {
  const before = await getIpRestrictionService(tenantId, clientIp)
  if (input.enabled && input.entries.length === 0) {
    throw new BadRequestError('IP 制限を有効にするには、許可するアドレスを1件以上登録してください')
  }
  if (input.enabled && !isIpAllowed(clientIp, input.entries)) {
    throw new BadRequestError(
      `今のアクセス元（${normalizeIp(clientIp) ?? '不明'}）が許可リストに入っていません。このまま保存すると、あなた自身がログインできなくなります`
    )
  }
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { ipRestrictionEnabled: input.enabled, ipAllowlist: input.entries as unknown as Prisma.InputJsonValue },
  })
  return { before, after: await getIpRestrictionService(tenantId, clientIp) }
}

/** 運営による IP 制限の解除（締め出されたテナントの復旧用）。許可リストは残す */
export async function disableIpRestrictionByPlatformService(tenantId: string): Promise<{ wasEnabled: boolean }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { ipRestrictionEnabled: true } })
  if (!tenant) throw new NotFoundError('テナント')
  await prisma.tenant.update({ where: { id: tenantId }, data: { ipRestrictionEnabled: false } })
  return { wasEnabled: tenant.ipRestrictionEnabled }
}
