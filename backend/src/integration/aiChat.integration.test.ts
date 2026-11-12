import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import type { MessagesClient } from '../services/externalSignals/agent/collect.js'

// AI チャット（D-13）の統合テスト。Claude API には繋がず、偽のクライアントで答えの組み立てを確かめる。
// HTTP では入力の検証・テナント分離・キー未設定の 503 を確かめる。DATABASE_URL が無ければスキップ（プレフィクス chtest）

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeIntegration = hasDatabase ? describe : describe.skip

const PREFIX = 'chtest'
const TENANT_A = `${PREFIX}-tenant-a`
const TENANT_B = `${PREFIX}-tenant-b`
const HOTEL_A = `${PREFIX}-hotel-a`
const HOTEL_B = `${PREFIX}-hotel-b`
const PASSWORD = 'Test1234'

describeIntegration('AI チャット（D-13）', () => {
  let app: Express
  let prisma: PrismaClient
  let answerChat: typeof import('../services/aiChat.js').answerChat
  let operatorToken = ''

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } })
    await prisma.auditLog.deleteMany({ where: { OR: [{ tenantId: { in: [TENANT_A, TENANT_B] } }, { userId: { in: users.map((u) => u.id) } }] } })
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } })
  }

  beforeAll(async () => {
    app = (await import('../app.js')).app as unknown as Express
    ;({ answerChat } = await import('../services/aiChat.js'))
    prisma = new PrismaClient()
    await cleanup()
    for (const [tenantId, hotelId] of [
      [TENANT_A, HOTEL_A],
      [TENANT_B, HOTEL_B],
    ] as const) {
      await prisma.tenant.create({ data: { id: tenantId, code: tenantId, name: tenantId } })
      await prisma.hotel.create({ data: { id: hotelId, tenantId, name: `チャットテストホテル ${hotelId}`, totalRooms: 50 } })
    }
    await prisma.user.create({
      data: { email: `${PREFIX}-operator@example.com`, password: await bcrypt.hash(PASSWORD, 10), name: 'チャットテスト', role: 'OPERATOR', tenantId: TENANT_A, hotelId: HOTEL_A },
    })
    const res = await request(app).post('/api/v1/auth/login').send({ email: `${PREFIX}-operator@example.com`, password: PASSWORD })
    operatorToken = res.body.data.tokens.accessToken
  })

  afterAll(async () => {
    if (!prisma) return
    await cleanup()
    await prisma.$disconnect()
  })

  const post = (body: object) => request(app).post('/api/v1/chat').set('Authorization', `Bearer ${operatorToken}`).send(body)

  it('ホテルの事実の束をシステムプロンプトに入れ、会話をそのまま渡して答えを返す', async () => {
    const calls: Array<{ system: Array<{ text: string; cache_control?: unknown }>; messages: unknown[] }> = []
    const client: MessagesClient = {
      create: (async (params: (typeof calls)[number]) => {
        calls.push(params)
        return { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '今月の予算はまだ登録されていません。' }], usage: { input_tokens: 1, output_tokens: 1 } }
      }) as unknown as MessagesClient['create'],
    }
    const messages = [
      { role: 'user' as const, content: 'こんにちは' },
      { role: 'assistant' as const, content: 'ご質問をどうぞ' },
      { role: 'user' as const, content: '今月の予算は？' },
    ]
    const result = await answerChat(client, { hotelId: HOTEL_A, messages })
    expect(result.reply).toBe('今月の予算はまだ登録されていません。')
    expect(calls[0].messages).toEqual(messages)
    expect(calls[0].system[1].text).toContain(`チャットテストホテル ${HOTEL_A}`)
    expect(calls[0].system[1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('入力を検証し、ほかのテナントのホテルには答えない', async () => {
    expect((await post({ hotelId: HOTEL_A, messages: [] })).status).toBe(400)
    expect((await post({ hotelId: HOTEL_A, messages: [{ role: 'assistant', content: 'x' }] })).status).toBe(400)
    expect((await post({ hotelId: HOTEL_A, messages: [{ role: 'user', content: 'x'.repeat(2001) }] })).status).toBe(400)
    expect((await post({ hotelId: HOTEL_B, messages: [{ role: 'user', content: '予算は？' }] })).status).toBe(403)
    expect((await request(app).post('/api/v1/chat').send({ hotelId: HOTEL_A, messages: [{ role: 'user', content: 'x' }] })).status).toBe(401)
  })

  it.skipIf(Boolean(process.env.ANTHROPIC_API_KEY))('Claude API のキーが無ければ 503 で、使えないことを伝える', async () => {
    const res = await post({ hotelId: HOTEL_A, messages: [{ role: 'user', content: '予算は？' }] })
    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({ success: false })
    expect(res.body.error).toContain('AI チャットは使えません')
  })
})
