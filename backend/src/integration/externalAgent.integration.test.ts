import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { addUtcDays, todayJst } from '../lib/date.js'
import type { MessagesClient } from '../services/externalSignals/agent/collect.js'

// 外部要因エージェント（D-13）の統合テスト。Claude API には繋がず、決まった応答を返す偽のクライアントを差し込む。
// DATABASE_URL が無ければスキップし、専用テナント（プレフィクス eatest）で検証する。

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'eatest'
const TENANT = `${PREFIX}-tenant`
const HOTEL = `${PREFIX}-hotel`
const OTHER_TENANT = `${PREFIX}-tenant-b`

const today = todayJst()
const iso = (d: Date) => d.toISOString().slice(0, 10)
const usage = { input_tokens: 1000, output_tokens: 200, server_tool_use: { web_search_requests: 2 } }

/** 1回目は検索の途中で止まり（pause_turn）、2回目で submit_findings を呼ぶ偽のクライアント */
function fakeClient(findings: unknown, calls: unknown[] = []): MessagesClient {
  let n = 0
  return {
    create: (async (params: unknown) => {
      calls.push(params)
      n++
      if (n === 1) return { model: 'claude-opus-5-5', stop_reason: 'pause_turn', content: [{ type: 'text', text: '検索中' }], usage }
      return {
        model: 'claude-opus-5-5',
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'submit_findings', input: findings }],
        usage,
      }
    }) as unknown as MessagesClient['create'],
  }
}

describeIntegration('外部要因エージェント（D-13）', () => {
  let prisma: PrismaClient
  let runAgentForHotel: typeof import('../services/externalSignals/agent/step.js').runAgentForHotel
  let listActiveHotelsForJobService: typeof import('../services/hotelsService.js').listActiveHotelsForJobService
  const concertDay = addUtcDays(today, 40)
  const manualDay = addUtcDays(today, 50)

  const findings = {
    events: [
      {
        name: 'ドームツアー東京公演',
        type: 'concert',
        startDate: iso(concertDay),
        endDate: iso(addUtcDays(concertDay, 1)),
        location: '東京ドーム',
        expectedImpact: 'high',
        description: '2日間で約10万人',
        sourceUrl: 'https://example.com/tour',
        excludeFromHistory: false,
      },
      // 人が登録済みのイベントと同じ名前・同じ日 → 上書きしない
      {
        name: '花火大会',
        type: 'festival',
        startDate: iso(manualDay),
        endDate: iso(manualDay),
        location: null,
        expectedImpact: 'low',
        description: 'エージェントの見立て',
        sourceUrl: null,
        excludeFromHistory: false,
      },
      // 日付の形が違う → 捨てる
      { name: '壊れた行', type: 'other', startDate: '来月', endDate: '来月', location: null, expectedImpact: 'low', description: '', sourceUrl: null, excludeFromHistory: false },
      // 過去の台風 → 特殊日として登録
      {
        name: '台風10号',
        type: 'weather',
        startDate: iso(addUtcDays(today, -10)),
        endDate: iso(addUtcDays(today, -8)),
        location: null,
        expectedImpact: 'high',
        description: '計画運休',
        sourceUrl: 'https://example.com/typhoon',
        excludeFromHistory: true,
      },
    ],
    newHotelOpenings: [
      {
        name: '新ホテル',
        openingDate: iso(addUtcDays(today, 200)),
        rooms: 250,
        category: 'ビジネス',
        location: '駅前',
        distanceKm: 0.8,
        expectedImpact: 'medium',
        notes: '',
        sourceUrl: 'https://example.com/new',
      },
    ],
    marketSignals: [
      {
        kind: 'access',
        title: '羽田〜台北線の増便',
        summary: '冬ダイヤで週7便増',
        periodStart: iso(addUtcDays(today, 30)),
        periodEnd: iso(addUtcDays(today, 150)),
        direction: 'up',
        magnitude: 'medium',
        sourceUrl: 'https://example.com/flight',
      },
    ],
  }

  let app: Express
  const tokens: Record<string, string> = {}

  async function cleanup() {
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: [TENANT, OTHER_TENANT] } } })
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER_TENANT] } } })
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    app = (await import('../app.js')).app as unknown as Express
    ;({ runAgentForHotel } = await import('../services/externalSignals/agent/step.js'))
    ;({ listActiveHotelsForJobService } = await import('../services/hotelsService.js'))
    await cleanup()
    await prisma.tenant.create({ data: { id: TENANT, code: TENANT, name: TENANT } })
    await prisma.tenant.create({ data: { id: OTHER_TENANT, code: OTHER_TENANT, name: OTHER_TENANT } })
    await prisma.hotel.create({
      data: { id: HOTEL, tenantId: TENANT, name: 'テストホテル', address: '東京都文京区', prefectureCode: '13', totalRooms: 100 },
    })
    await prisma.event.create({
      data: { tenantId: TENANT, hotelId: HOTEL, name: '花火大会', type: 'festival', startDate: manualDay, endDate: manualDay, expectedImpact: 'high' },
    })
    const password = await bcrypt.hash('Test1234', 10)
    await prisma.user.createMany({
      data: [
        { email: `${PREFIX}-operator@example.com`, password, name: 'o', role: 'OPERATOR', tenantId: TENANT, hotelId: HOTEL },
        { email: `${PREFIX}-other@example.com`, password, name: 'x', role: 'ADMIN', tenantId: OTHER_TENANT },
      ],
    })
    for (const key of ['operator', 'other']) {
      const res = await request(app).post('/api/v1/auth/login').send({ email: `${PREFIX}-${key}@example.com`, password: 'Test1234' })
      tokens[key] = res.body.data.tokens.accessToken
    }
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  it('検索の一時停止を続けさせ、提出された結果を保存する。人の登録は上書きせず、形の違う行は捨てる', async () => {
    const hotel = (await listActiveHotelsForJobService()).find((h) => h.id === HOTEL)!
    const calls: unknown[] = []
    expect(await runAgentForHotel(fakeClient(findings, calls), hotel)).toBe('succeeded')
    expect(calls).toHaveLength(2)
    // 2回目のリクエストは1回目の応答（pause_turn）を続ける
    const second = calls[1] as { messages: Array<{ role: string }>; fallbacks: unknown; model: string }
    expect(second.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(second.fallbacks).toBe('default')

    const events = await prisma.event.findMany({ where: { hotelId: HOTEL }, orderBy: { startDate: 'asc' } })
    expect(events.map((e) => [e.name, e.source])).toEqual([
      ['台風10号', 'agent'],
      ['ドームツアー東京公演', 'agent'],
      ['花火大会', 'manual'],
    ])
    expect(events[0].excludeFromHistory).toBe(true)
    expect(events.find((e) => e.name === '花火大会')?.expectedImpact).toBe('high')
    expect(await prisma.newHotelOpening.count({ where: { hotelId: HOTEL, source: 'agent' } })).toBe(1)
    expect(await prisma.marketSignal.count({ where: { hotelId: HOTEL } })).toBe(1)

    const run = await prisma.externalAgentRun.findFirstOrThrow({ where: { hotelId: HOTEL } })
    expect(run).toMatchObject({ status: 'succeeded', webSearches: 4, inputTokens: 2000, eventsSaved: 2, openingsSaved: 1, signalsSaved: 1 })
  })

  it('集め直しの間隔の中なら呼ばない。間隔を過ぎたらエージェントの行を上書きする', async () => {
    const hotel = (await listActiveHotelsForJobService()).find((h) => h.id === HOTEL)!
    const calls: unknown[] = []
    expect(await runAgentForHotel(fakeClient(findings, calls), hotel)).toBe('skipped')
    expect(calls).toHaveLength(0)

    const later = addUtcDays(new Date(), 8)
    const updated = { ...findings, events: [{ ...findings.events[0], expectedImpact: 'medium' }] }
    expect(await runAgentForHotel(fakeClient(updated), hotel, later)).toBe('succeeded')
    const concert = await prisma.event.findFirstOrThrow({ where: { hotelId: HOTEL, name: 'ドームツアー東京公演' } })
    expect(concert.expectedImpact).toBe('medium')
    // 前回あって今回無い行は消さない
    expect(await prisma.event.count({ where: { hotelId: HOTEL, name: '台風10号' } })).toBe(1)
  })

  it('submit_findings を呼ばずに終われば失敗として記録する', async () => {
    const hotel = (await listActiveHotelsForJobService()).find((h) => h.id === HOTEL)!
    const silent: MessagesClient = {
      create: (async () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '見つかりませんでした' }], usage })) as unknown as MessagesClient['create'],
    }
    await prisma.externalAgentRun.deleteMany({ where: { hotelId: HOTEL } })
    expect(await runAgentForHotel(silent, hotel)).toBe('failed')
    const run = await prisma.externalAgentRun.findFirstOrThrow({ where: { hotelId: HOTEL } })
    expect(run.status).toBe('failed')
    expect(run.errorMessage).toContain('submit_findings')
  })

  it('月別需要指数と取得状況を返す（他テナントは 403、未認証は 401）', async () => {
    const get = (path: string, key?: string) => {
      const r = request(app).get(path)
      return key ? r.set('Authorization', `Bearer ${tokens[key]}`) : r
    }
    expect((await get(`/api/v1/external-signals/demand-index?hotelId=${HOTEL}`)).status).toBe(401)
    expect((await get(`/api/v1/external-signals/demand-index?hotelId=${HOTEL}`, 'other')).status).toBe(403)
    expect((await get(`/api/v1/external-signals/demand-index?hotelId=${HOTEL}&months=13`, 'operator')).status).toBe(400)

    const res = await get(`/api/v1/external-signals/demand-index?hotelId=${HOTEL}&months=3`, 'operator')
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.data.months).toHaveLength(3)
    const all = res.body.data.months.flatMap((m: { events: Array<{ name: string }> }) => m.events.map((e) => e.name))
    expect(all).toContain('ドームツアー東京公演')

    const status = await get(`/api/v1/external-signals/status?hotelId=${HOTEL}`, 'operator')
    expect(status.status).toBe(200)
    expect(status.body.data.agent.recentRuns.length).toBeGreaterThan(0)
    expect(status.body.data.holidays.knownThrough).toBeGreaterThanOrEqual(2027)
  })

  it('要因カードに市場の動きを種類ごとに出し、週別の見通しを8週分返す', async () => {
    const res = await request(app).get(`/api/v1/external-signals/factors?hotelId=${HOTEL}`).set('Authorization', `Bearer ${tokens.operator}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const access = res.body.data.categories.access
    expect(access[0]).toMatchObject({ name: '羽田〜台北線の増便', status: 'positive', trend: 'up', source: 'agent', sourceUrl: 'https://example.com/flight' })
    expect(access[0].kpis.map((k: { label: string }) => k.label)).toContain('稼働率予測への補正')
    expect(res.body.data.weekly).toHaveLength(8)
    expect(res.body.data.hasAgentSignals).toBe(true)
    const other = await request(app).get(`/api/v1/external-signals/factors?hotelId=${HOTEL}`).set('Authorization', `Bearer ${tokens.other}`)
    expect(other.status).toBe(403)
  })
})
