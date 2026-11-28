import { expect,it } from 'vitest'
import { groupProductionUsage } from './production-usage'
import type { UsageReport } from '@shared/types'
it('groups across hotels without losing event counts or inventing personal identity',()=>{
 const report:UsageReport={source:'customer',startedAt:null,accounts:[1,2,3].map((n)=>({id:String(n),userId:n<3?'user-a':'user-b',userName:n<3?'A':'B',tenantId:'tenant',tenantName:'Customer',agencyId:'agency',agencyName:'Agency',name:String(n),days:[{day:'2026-11-28',counts:{view_analysis:n},lastAt:`2026-11-28T0${n}:00:00Z`}]}))}
 expect(groupProductionUsage(report,'user').accounts).toHaveLength(2)
 expect(groupProductionUsage(report,'user').accounts[0].days[0].counts.view_analysis).toBe(3)
 expect(groupProductionUsage(report,'agency').accounts[0].days[0].counts.view_analysis).toBe(6)
 expect(groupProductionUsage(report,'customer').accounts[0].name).toBe('Customer')
})
