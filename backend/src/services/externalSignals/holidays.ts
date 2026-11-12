import { config } from '../../lib/config.js'
import { storage } from '../../lib/storage.js'
import { holidaysKnownThrough, parseCabinetOfficeHolidayCsv, registerHolidays } from '../../lib/jpHolidays.js'
import { logger } from '../../utils/logger.js'
import { fetchWithTimeout } from './http.js'

// 祝日（内閣府「国民の祝日」CSV — D-13）。外部要因ジョブが取得してストレージに保存し、
// サーバー・ジョブの起動時にストレージから読み直す。同梱の一覧（lib/jpHolidaysData.ts）より新しい年だけが足される。

export const HOLIDAYS_STORAGE_KEY = 'reference/jp-holidays.csv'

/** 内閣府から取り直してストレージに保存する。足した件数と一覧の最後の年を返す */
export async function refreshHolidays(): Promise<{ added: number; knownThrough: number }> {
  const res = await fetchWithTimeout(config.CAO_HOLIDAYS_URL)
  if (!res.ok) throw new Error(`内閣府の祝日 CSV を取得できませんでした（HTTP ${res.status}）`)
  const text = new TextDecoder('shift_jis').decode(await res.arrayBuffer())
  const rows = parseCabinetOfficeHolidayCsv(text)
  if (rows.length < 100) throw new Error(`内閣府の祝日 CSV の行が少なすぎます（${rows.length} 件）。形式が変わった可能性があります`)
  await storage.put(HOLIDAYS_STORAGE_KEY, Buffer.from(text, 'utf8'), 'text/csv; charset=utf-8')
  return { added: registerHolidays(rows), knownThrough: holidaysKnownThrough() }
}

/** ストレージに保存した祝日を読む（無ければ何もしない）。起動時に呼ぶ。失敗しても同梱の一覧で動く */
export async function loadStoredHolidays(): Promise<void> {
  try {
    if (!(await storage.exists(HOLIDAYS_STORAGE_KEY))) return
    const text = (await storage.get(HOLIDAYS_STORAGE_KEY)).toString('utf8')
    const added = registerHolidays(parseCabinetOfficeHolidayCsv(text))
    if (added > 0) logger.info({ added, knownThrough: holidaysKnownThrough() }, '保存済みの祝日を読み込みました')
  } catch (error) {
    logger.warn({ err: error }, '保存済みの祝日を読み込めませんでした（同梱の一覧で動きます）')
  }
}
