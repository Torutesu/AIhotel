import { describe, it, expect, vi } from 'vitest'
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { S3CompatibleStorage } from './storage.js'

// S3 互換の保存（#21）。実際の S3 には繋がず、送るコマンドの中身を確かめる

function fakeClient(handler: (command: unknown) => unknown) {
  return { send: vi.fn(async (command: unknown) => handler(command)) }
}

describe('S3CompatibleStorage (#21)', () => {
  it('put はバケット・接頭辞付きのキー・Content-Type を送る', async () => {
    const client = fakeClient(() => ({}))
    const storage = new S3CompatibleStorage(client as never, 'bucket-a', 'prod/')
    await storage.put('reports/h1/2026-9.pdf', Buffer.from('x'), 'application/pdf')
    const command = client.send.mock.calls[0][0] as PutObjectCommand
    expect(command).toBeInstanceOf(PutObjectCommand)
    expect(command.input).toMatchObject({ Bucket: 'bucket-a', Key: 'prod/reports/h1/2026-9.pdf', ContentType: 'application/pdf' })
  })

  it('get は本文をバッファで返す', async () => {
    const client = fakeClient(() => ({ Body: { transformToByteArray: async () => new Uint8Array([104, 105]) } }))
    const storage = new S3CompatibleStorage(client as never, 'bucket-a')
    expect((await storage.get('a/b')).toString()).toBe('hi')
    expect(client.send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand)
  })

  it('exists は 404 なら false、それ以外のエラーは投げる', async () => {
    const notFound = Object.assign(new Error('NotFound'), { $metadata: { httpStatusCode: 404 } })
    const forbidden = Object.assign(new Error('Forbidden'), { $metadata: { httpStatusCode: 403 } })
    const storage = (err?: Error) =>
      new S3CompatibleStorage(fakeClient(() => { if (err) throw err; return {} }) as never, 'b')
    const ok = fakeClient(() => ({}))
    expect(await new S3CompatibleStorage(ok as never, 'b').exists('a')).toBe(true)
    expect(ok.send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand)
    expect(await storage(notFound).exists('a')).toBe(false)
    await expect(storage(forbidden).exists('a')).rejects.toThrow('Forbidden')
  })

  it('親ディレクトリの参照や先頭のスラッシュを含むキーは拒否する', async () => {
    const client = fakeClient(() => ({}))
    const storage = new S3CompatibleStorage(client as never, 'b')
    await expect(storage.put('../x', Buffer.from(''), 'text/plain')).rejects.toThrow('不正なストレージキー')
    await expect(storage.put('/x', Buffer.from(''), 'text/plain')).rejects.toThrow('不正なストレージキー')
    expect(client.send).not.toHaveBeenCalled()
  })
})
