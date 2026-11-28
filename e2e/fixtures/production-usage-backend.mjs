import { createRequire } from 'node:module'
const require=createRequire(new URL('../../backend/package.json',import.meta.url))
const {PrismaClient}=require('@prisma/client')
const database=new URL(process.env.DATABASE_URL??'')
if(!['localhost','127.0.0.1'].includes(database.hostname)||database.pathname!=='/revest_usage_20261128_test')throw Error('Use the isolated local usage test database only')
const db=new PrismaClient(),prefix='usage-browser-'
async function cleanup(){await db.auditLog.deleteMany({where:{tenantId:{startsWith:prefix}}});await db.user.deleteMany({where:{id:{startsWith:prefix}}});await db.hotel.deleteMany({where:{id:{startsWith:prefix}}});await db.tenant.deleteMany({where:{id:{startsWith:prefix}}})}
await cleanup()
for(const name of ['a','b']){
 await db.tenant.create({data:{id:prefix+name,code:prefix+name,name:name==='a'?'本番確認用顧客A':'他社の顧客B'}})
 await db.hotel.create({data:{id:prefix+'hotel-'+name,tenantId:prefix+name,name:'確認用ホテル'+name,totalRooms:10}})
 for(const index of [1,2]){
  const id=prefix+name+index
  await db.user.create({data:{id,email:id+'@example.test',name:name==='a'?'担当者'+index:'他社担当者',password:'not-a-login-account',role:'OPERATOR',tenantId:prefix+name,hotelId:prefix+'hotel-'+name}})
  if(index===1)for(let day=0;day<10;day++)for(const event of ['view_analysis','chat_completed'])await db.auditLog.create({data:{tenantId:prefix+name,userId:id,entityId:prefix+'hotel-'+name,action:'USAGE',entity:'Usage:'+event,createdAt:new Date(Date.now()-day*86400000)}})
 }
}
const {app}=await import('../../backend/dist/app.js')
const server=app.listen(3101,'127.0.0.1')
async function close(){server.close();await cleanup();await db.$disconnect();process.exit(0)}
process.on('SIGTERM',close);process.on('SIGINT',close)
