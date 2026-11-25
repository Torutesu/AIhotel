import { prisma } from '../lib/prisma.js'
import type { UsageReport, UsageEventType as UsageEvent } from '@hotel-revenue-system/shared/types'

export async function getUsageReportService(): Promise<UsageReport> {
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; day: string; event: string; count: bigint; lastAt: Date }>>`
    SELECT h.id, (t.name || ' / ' || h.name) AS name,
      to_char(a."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') AS day,
      substring(a.entity from 7) AS event, count(*) AS count, max(a."createdAt") AS "lastAt"
    FROM "AuditLog" a JOIN "Hotel" h ON a."entityId" = h.id AND a."tenantId" = h."tenantId"
    JOIN "Tenant" t ON t.id = h."tenantId"
    WHERE a.action = 'USAGE' AND a.entity LIKE 'Usage:%' AND a."createdAt" >= NOW() - INTERVAL '90 days'
    GROUP BY h.id, h.name, t.name, day, a.entity
  `
  const hotels = await prisma.hotel.findMany({ select: { id: true, name: true, tenant: { select: { name: true } } } })
  const first = await prisma.auditLog.findFirst({ where: { action: 'USAGE', entity: { startsWith: 'Usage:' } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } })
  return { source: 'customer', generatedAt: new Date().toISOString(), startedAt: first?.createdAt.toISOString() ?? null, accounts: hotels.map(h => {
    const days: UsageReport['accounts'][number]['days'] = []
    for (const r of rows.filter(r => r.id === h.id)) {
      let d = days.find(d => d.day === r.day)
      if (!d) { d = { day: r.day, counts: {}, lastAt: r.lastAt.toISOString() }; days.push(d) }
      d.counts[r.event as UsageEvent] = Number(r.count)
      d.lastByEvent ??= {}
      d.lastByEvent[r.event as UsageEvent] = r.lastAt.toISOString()
      if (d.lastAt < r.lastAt.toISOString()) d.lastAt = r.lastAt.toISOString()
    }
    return { id: h.id, name: `${h.tenant.name} / ${h.name}`, days }
  }) }
}
