import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import type { UsageReport, UsageEventType as UsageEvent, UsageAccount } from '@hotel-revenue-system/shared/types'

export async function getProductionUsageTenantsService() {
  return prisma.tenant.findMany({ where: { trialKind: null }, select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } })
}

/** Undefined = platform scope. [] = no assigned customers, never all customers. */
export async function getUsageReportService(tenantIds?: string[], now = new Date()): Promise<UsageReport> {
  const empty: UsageReport = { source:'customer', generatedAt:now.toISOString(), startedAt:null, accounts:[] }
  if (tenantIds?.length === 0) return empty
  const tenantScope = tenantIds ? { in: tenantIds } : undefined
  const hotels = await prisma.hotel.findMany({ where: { tenantId: tenantScope, tenant: { trialKind: null } }, select: { id:true, name:true, tenantId:true, isActive:true, tenant: { select: { name:true, isActive:true } } } })
  if (!hotels.length) return empty
  const allowed = [...new Set(hotels.map(h=>h.tenantId))]
  const users = await prisma.user.findMany({where:{tenantId:{in:allowed},role:{not:'PLATFORM_ADMIN'}},select:{id:true,tenantId:true,hotelId:true,name:true,email:true,role:true,isActive:true,lastLoginAt:true,createdAt:true}})
  // Match event tenant AND hotel; user identity is the server-authenticated audit userId.
  const rows = await prisma.$queryRaw<Array<{hotelId:string;userId:string|null;day:string;event:string;count:bigint;lastAt:Date}>>(Prisma.sql`
    SELECT h.id AS "hotelId", a."userId", to_char(a."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo','YYYY-MM-DD') AS day,
      substring(a.entity from 7) AS event, count(*) AS count, max(a."createdAt") AS "lastAt"
    FROM "AuditLog" a JOIN "Hotel" h ON a."entityId"=h.id AND a."tenantId"=h."tenantId"
    WHERE a.action='USAGE' AND a.entity LIKE 'Usage:%' AND a."tenantId" IN (${Prisma.join(allowed)})
      AND h.id IN (${Prisma.join(hotels.map(h=>h.id))}) AND a."createdAt">=${new Date(now.getTime()+9*3600000-89*86400000).toISOString().slice(0,10)+'T00:00:00+09:00'}::timestamptz
      AND a."createdAt"<=${now}
    GROUP BY h.id,a."userId",day,a.entity
  `)
  const accounts:UsageAccount[]=[]
  for(const hotel of hotels) {
    const members=users.filter(u=>u.tenantId===hotel.tenantId && (!u.hotelId||u.hotelId===hotel.id||rows.some(r=>r.hotelId===hotel.id&&r.userId===u.id)))
    for(const user of members) {
      const days:UsageAccount['days']=[]
      for(const row of rows.filter(r=>r.hotelId===hotel.id&&r.userId===user.id)) {
        let day=days.find(d=>d.day===row.day)
        const at=row.lastAt.toISOString()
        if(!day){day={day:row.day,counts:{},lastAt:at,lastByEvent:{}};days.push(day)}
        day.counts[row.event as UsageEvent]=Number(row.count)
        day.lastByEvent![row.event as UsageEvent]=at
        if(day.lastAt<at)day.lastAt=at
      }
      accounts.push({id:`${hotel.id}:${user.id}`,userId:user.id,userName:user.name,userRole:user.role,email:user.email,tenantId:hotel.tenantId,tenantName:hotel.tenant.name,hotelId:hotel.id,hotelName:hotel.name,name:`${user.name} / ${hotel.name}`,createdAt:user.createdAt.toISOString(),lastLoginAt:user.lastLoginAt?.toISOString()??null,status:user.isActive&&hotel.isActive&&hotel.tenant.isActive?'ACTIVE':'SUSPENDED',days})
    }
  }
  // Preserve unattributable historical totals without attaching them to a different person.
  for (const hotel of hotels) {
    const missing=rows.filter(r=>r.hotelId===hotel.id&&!users.some(u=>u.id===r.userId&&u.tenantId===hotel.tenantId))
    if(!missing.length)continue
    const days:UsageAccount['days']=[]
    for(const row of missing){let day=days.find(d=>d.day===row.day);const at=row.lastAt.toISOString();if(!day){day={day:row.day,counts:{},lastAt:at,lastByEvent:{}};days.push(day)}day.counts[row.event as UsageEvent]=(day.counts[row.event as UsageEvent]??0)+Number(row.count);if((day.lastByEvent![row.event as UsageEvent]??'')<at)day.lastByEvent![row.event as UsageEvent]=at;if(day.lastAt<at)day.lastAt=at}
    accounts.push({id:`${hotel.id}:unattributed`,name:'利用者を特定できない過去の記録',tenantId:hotel.tenantId,tenantName:hotel.tenant.name,hotelId:hotel.id,hotelName:hotel.name,status:'SUSPENDED',days})
  }
  const first=await prisma.auditLog.findFirst({where:{action:'USAGE',entity:{startsWith:'Usage:'},tenantId:{in:allowed},entityId:{in:hotels.map(h=>h.id)}},orderBy:{createdAt:'asc'},select:{createdAt:true}})
  return {...empty,startedAt:first?.createdAt.toISOString()??null,accounts}
}
