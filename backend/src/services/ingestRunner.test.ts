import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { capturedDateFromFileName, datasetForSource, localDateString } from './ingestRunnerService.js'
import {
  fetchFromLocalDir,
  archiveLocalFile,
  resolveInboxPath,
  sha256,
  httpsConfigSchema,
} from '../lib/ingestConnectors.js'
import { config } from '../lib/config.js'

// 自動取込（人手のアップロードに頼らずバックエンドが取りに行く経路）の単体検証。
// docs/pms-ingest-design.md §A-3

const created: string[] = []
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** INGEST_INBOX_DIR 配下に一時サブディレクトリを作り、その相対名を返す */
async function makeInbox(): Promise<string> {
  const root = path.resolve(config.INGEST_INBOX_DIR)
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(path.join(root, 'test-'))
  created.push(dir)
  return path.basename(dir)
}

describe('datasetForSource', () => {
  it('source名から取込種別を判定する', () => {
    expect(datasetForSource('pms-nights')).toBe('nights')
    expect(datasetForSource('pms-reservations')).toBe('reservations')
    expect(datasetForSource('pms-inventory')).toBe('inventory')
    expect(datasetForSource('segments')).toBe('segments')
    expect(datasetForSource('sc-unknown')).toBeNull()
  })
})

describe('capturedDateFromFileName', () => {
  it('YYYY-MM-DD / YYYYMMDD のどちらでも断面日を読む', () => {
    expect(capturedDateFromFileName('onhand_2026-08-11.csv')).toBe('2026-08-11')
    expect(capturedDateFromFileName('ONHAND20260811.xlsx')).toBe('2026-08-11')
  })

  it('日付を含まないファイル名では null（呼び出し側が現地日付にフォールバックする）', () => {
    expect(capturedDateFromFileName('onhand.csv')).toBeNull()
    // 年月までのファイル名（月次の実績ファイル）を日付と誤読しない
    expect(capturedDateFromFileName('CSV202501HG.xlsx')).toBeNull()
    // 月・日としてありえない数字は採用しない
    expect(capturedDateFromFileName('id20269999.csv')).toBeNull()
  })
})

describe('localDateString', () => {
  it('サーバがUTCでも現地日付を返す', () => {
    // 2026-08-11 22:00 UTC は東京では翌日
    expect(localDateString(new Date('2026-08-11T22:00:00Z'), 'Asia/Tokyo')).toBe('2026-08-12')
    expect(localDateString(new Date('2026-08-11T22:00:00Z'), 'UTC')).toBe('2026-08-11')
  })
})

describe('resolveInboxPath（パストラバーサル対策）', () => {
  it('INGEST_INBOX_DIR の外を指す設定を拒否する', () => {
    expect(() => resolveInboxPath('../../etc')).toThrow(/不正/)
    expect(() => resolveInboxPath('/etc')).toThrow(/不正/)
  })

  it('配下のサブディレクトリは許可する', () => {
    expect(resolveInboxPath('pms/nights')).toBe(
      path.resolve(config.INGEST_INBOX_DIR, 'pms/nights')
    )
  })
})

describe('fetchFromLocalDir（監視ディレクトリ）', () => {
  it('未作成のディレクトリは「まだ届いていない」として空を返す（起動直後にエラーを出さない）', async () => {
    await expect(fetchFromLocalDir({ directory: 'not-created-yet' })).resolves.toEqual([])
  })

  it('パターンに合うファイルだけを内容ハッシュ付きで拾う', async () => {
    const inbox = await makeInbox()
    const dir = resolveInboxPath(inbox)
    await writeFile(path.join(dir, 'CSV202501HG.csv'), '計上日,室数\n2025-01-01,1\n')
    await writeFile(path.join(dir, 'readme.txt'), 'ignore me')
    await writeFile(path.join(dir, '.hidden.csv'), 'ignore me too')

    const files = await fetchFromLocalDir({ directory: inbox, filePattern: '\\.csv$' })
    expect(files.map((f) => f.fileName)).toEqual(['CSV202501HG.csv'])
    expect(files[0].checksum).toBe(sha256(files[0].content))
  })

  it('取込済みファイルを .processed へ退避する（走査対象が増え続けないように）', async () => {
    const inbox = await makeInbox()
    const dir = resolveInboxPath(inbox)
    const target = path.join(dir, 'done.csv')
    await writeFile(target, 'a\n1\n')

    await archiveLocalFile(target)

    expect(await readdir(dir)).toEqual(['.processed'])
    expect(await readdir(path.join(dir, '.processed'))).toEqual(['done.csv'])
  })
})

describe('httpsConfigSchema', () => {
  it('平文HTTPを拒否する', () => {
    const base = { fileName: 'report.csv' }
    expect(httpsConfigSchema.safeParse({ ...base, url: 'http://example.com/a.csv' }).success).toBe(
      false
    )
    expect(httpsConfigSchema.safeParse({ ...base, url: 'https://example.com/a.csv' }).success).toBe(
      true
    )
  })

  it('資格情報は secretRef（キー名）で持ち、値そのものは設定に入れない', () => {
    const parsed = httpsConfigSchema.parse({
      url: 'https://example.com/a.csv',
      fileName: 'a.csv',
      secretRef: 'tl-lincoln',
    })
    expect(parsed.secretRef).toBe('tl-lincoln')
    expect(parsed).not.toHaveProperty('token')
  })
})
