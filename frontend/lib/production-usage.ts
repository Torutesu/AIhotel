import type { UsageAccount, UsageDay, UsageReport } from '@shared/types'
import { USAGE_EVENTS } from '@shared/types/usage'
export type UsageGrouping='customer'|'user'|'agency'
export function groupProductionUsage(report:UsageReport, grouping:UsageGrouping):UsageReport {
 const groups=new Map<string,UsageAccount>()
 for(const row of report.accounts) {
  const id=grouping==='user'?(row.userId??row.id):grouping==='agency'?(row.agencyId??'unassigned'):(row.tenantId??row.id)
  let group=groups.get(id)
  if(!group){group={id,name:grouping==='user'?(row.userName??row.name):grouping==='agency'?(row.agencyName??'未割り当て'):(row.tenantName??row.name),days:[],...(grouping==='user'?{email:row.email,tenantName:row.tenantName,userRole:row.userRole,lastLoginAt:row.lastLoginAt,createdAt:row.createdAt}:{}),status:row.status};groups.set(id,group)}
  if(row.status==='ACTIVE')group.status='ACTIVE'
  if(grouping==='user'&&row.lastLoginAt&&(group.lastLoginAt??'')<row.lastLoginAt)group.lastLoginAt=row.lastLoginAt
  for(const day of row.days) {
   let current=group.days.find(d=>d.day===day.day)
   if(!current){current={day:day.day,counts:{},lastAt:day.lastAt,lastByEvent:{}};group.days.push(current)}
   for(const event of USAGE_EVENTS){current.counts[event]=(current.counts[event]??0)+(day.counts[event]??0);const at=day.lastByEvent?.[event];if(at&&(!current.lastByEvent?.[event]||current.lastByEvent[event]!<at))current.lastByEvent![event]=at}
   if(current.lastAt<day.lastAt)current.lastAt=day.lastAt
  }
 }
 return {...report,accounts:[...groups.values()].map(a=>({...a,days:a.days.sort((x:UsageDay,y:UsageDay)=>x.day.localeCompare(y.day))}))}
}
