import { expect, test, webkit } from '@playwright/test'

test('agency usage: charts, evidence-based summaries, filtering and mobile detail',async({page,browser})=>{
  await page.goto('/operations?section=usage')
  await page.getByLabel('メールアドレス',{exact:true}).fill('owner@example.test')
  await page.getByLabel('パスワード',{exact:true}).fill('local-e2e-owner-pass')
  await page.getByRole('button',{name:'ログイン',exact:true}).click()
  await expect(page.getByRole('heading',{name:'活用状況',exact:true})).toBeVisible()
  const agency=(await(await page.request.post('/api/demo/operations/agencies',{data:{name:'表示確認用の代理店',email:'usage-reader@example.test'}})).json()).data
  const issue=async(name:string,agencyId?:string)=>(await(await page.request.post('/api/demo/trials',{data:{name,kind:'PROSPECT_HOTEL',agencyId}})).json()).data.trial
  const a=await issue('サンプル：青葉ホテル',agency.account.id)
  const b=await issue('サンプル：港ホテル',agency.account.id)
  await issue('サンプル：未開始ホテル',agency.account.id)
  await issue('他社の非公開ホテル')
  // Synthetic history only in the isolated in-memory fixture, never on production.
  const now=Date.now(), day=(n:number)=>new Date(now-n*86400000+9*3600000).toISOString().slice(0,10)
  const command=async(data:unknown[])=>(await(await page.request.post('http://127.0.0.1:4199',{headers:{authorization:'Bearer local-e2e-only'},data})).json()).result
  const before=await command(['GET','usage:startedAt'])
  if(before)await command(['EVAL',"if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET',KEYS[1],ARGV[2]); return 1",1,'usage:startedAt',before,new Date(now-40*86400000).toISOString()])
  else await command(['SET','usage:startedAt',new Date(now-40*86400000).toISOString(),'NX'])
  const rows=Array.from({length:25},(_,i)=>{
    const at=new Date(now-(24-i)*86400000).toISOString()
    return {day:day(24-i),counts:{view_dashboard:4+i%3,view_analysis:2+i%5,view_pricing:i%4,view_reports:i%3,chat_completed:i%2,pricing_saved:i%3===0?1:0},lastAt:at,lastByEvent:{view_analysis:at,...(i%2?{chat_completed:at}:{})},events:[{event:'view_analysis',at},...(i%2?[{event:'chat_completed',at}]:[])]}
  })
  await command(['SET',`usage:trial:${a.id}`,JSON.stringify(rows),'NX'])
  await command(['SET',`usage:trial:${b.id}`,JSON.stringify([{day:day(10),counts:{view_pricing:4,view_dashboard:2},lastAt:new Date(now-10*86400000).toISOString()}]),'NX'])
  const raw = await command(['HGETALL','demo:trials']) as string[]
  for (const [id, daysAgo] of [[a.id,0],[b.id,10]] as const) {
    const index=raw.indexOf(id)
    const record=JSON.parse(raw[index+1])
    record.createdAt=new Date(now-40*86400000).toISOString()
    record.lastLoginAt=new Date(now-daysAgo*86400000).toISOString()
    await command(['HSET','demo:trials',id,JSON.stringify(record)])
  }
  const context=await browser.newContext({viewport:{width:1440,height:1450}})
  const agent=await context.newPage()
  await agent.goto('http://localhost:3100/operations?section=usage')
  await agent.getByLabel('メールアドレス',{exact:true}).fill(agency.account.email)
  await agent.getByLabel('パスワード',{exact:true}).fill(agency.password)
  await agent.getByRole('button',{name:'ログイン',exact:true}).click()
  await expect(agent.getByRole('heading',{name:'利用記録から分かること'})).toBeVisible()
  await expect(agent.getByText('他社の非公開ホテル')).toHaveCount(0)
  await expect(agent.getByRole('button',{name:'代理店管理',exact:true})).toHaveCount(0)
  await expect(agent.locator('.recharts-bar-rectangle').first()).toBeVisible()
  await agent.mouse.move(0,0)
  await agent.screenshot({path:'test-results/agency-usage-desktop.png',fullPage:false})
  await agent.getByLabel('利用状況で絞り込む').selectOption('followup')
  await expect(agent.getByRole('button',{name:/サンプル：青葉ホテル/})).toHaveCount(0)
  await expect(agent.getByRole('button',{name:/サンプル：港ホテル/})).toBeVisible()
  await agent.getByLabel('利用状況で絞り込む').selectOption('all')
  await agent.getByRole('button',{name:/サンプル：青葉ホテル/}).click()
  const detail=agent.getByRole('dialog')
  await expect(detail.getByRole('heading',{name:'この顧客の利用傾向'})).toBeVisible()
  await expect(detail.getByRole('heading',{name:'最近の操作'})).toBeVisible()
  await detail.screenshot({path:'test-results/agency-usage-detail-desktop.png'})
  await agent.keyboard.press('Escape')
  await expect(detail).toHaveCount(0)
  const safari=await webkit.launch({executablePath:webkit.executablePath()})
  try{
    const mobile=await safari.newContext({storageState:await context.storageState(),viewport:{width:375,height:812}})
    const phone=await mobile.newPage()
    for(const theme of ['light','dark']){
      await phone.addInitScript(t=>localStorage.setItem('theme',t),theme)
      await phone.goto('http://localhost:3100/operations?section=usage')
      await expect(phone.locator('.recharts-bar-rectangle').first()).toBeVisible()
      expect(await phone.evaluate(()=>document.documentElement.scrollWidth)).toBe(375)
      await phone.screenshot({path:`test-results/agency-usage-${theme}-mobile.png`,fullPage:true})
      for(const period of [7,90,30]){await phone.getByRole('button',{name:`直近${period}日`,exact:true}).click();await expect(phone.getByRole('button',{name:`直近${period}日`,exact:true})).toHaveAttribute('aria-pressed','true')}
      await phone.getByRole('button',{name:/サンプル：青葉ホテル/}).click()
      const modal=phone.getByRole('dialog')
      await expect(modal).toBeVisible()
      expect(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
      await modal.screenshot({path:`test-results/agency-usage-detail-${theme}-mobile.png`})
      await modal.getByRole('button',{name:'詳細を閉じる',exact:true}).click()
      await expect(modal).toHaveCount(0)
    }
  }finally{await safari.close();await context.close()}
})
