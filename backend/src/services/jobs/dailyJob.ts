// 日次ジョブ（docs/外部要因設計.md §4）。クラウド非依存のため Node 内の軽量スケジューラで開始し、
// 将来外部ジョブ基盤に移す場合もこのファイルだけ差し替えればよい。
//
//   04:00 JST  外部シグナル取り込み（天候）→ 需要予測・価格決定（365日）→ 前日実績で学習
//
// 各ステップの失敗は次のホテル・次のステップを止めず、Alert（黄・レベル3）として記録する。
import { prisma } from '../../lib/prisma.js'
import { config } from '../../lib/config.js'
import { logger } from '../../utils/logger.js'
import { ingestWeatherSignalsService } from '../signals/signalService.js'
import { recomputeForecastService } from '../forecast/forecastService.js'
import { learnFromActualsService } from '../forecast/learningService.js'
import { trainModelService } from '../forecast/modelService.js'
import { autoAdoptService } from '../pricing/decisionService.js'

const FORECAST_HORIZON_DAYS = 365

export interface DailyJobHotelResult {
  hotelId: string
  hotelName: string
  weather: { ok: boolean; detail: string }
  forecast: { ok: boolean; detail: string }
  learning: { ok: boolean; detail: string }
  autoAdopt: { ok: boolean; detail: string }
}

export interface DailyJobResult {
  startedAt: string
  finishedAt: string
  hotels: DailyJobHotelResult[]
}

async function recordFailureAlert(hotelId: string, tenantId: string, title: string, message: string): Promise<void> {
  try {
    await prisma.alert.create({
      data: { hotelId, tenantId, severity: 'YELLOW', level: 3, title, message, linkTab: 'pricing' },
    })
  } catch (err) {
    logger.error({ err, hotelId }, 'ジョブ失敗アラートの記録に失敗しました')
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 1ホテル分の日次処理
 */
export async function runDailyJobForHotelService(hotelId: string, asOfDate?: Date): Promise<DailyJobHotelResult> {
  const hotel = await prisma.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { id: true, tenantId: true, name: true } })
  const result: DailyJobHotelResult = {
    hotelId,
    hotelName: hotel.name,
    weather: { ok: false, detail: '' },
    forecast: { ok: false, detail: '' },
    learning: { ok: false, detail: '' },
    autoAdopt: { ok: false, detail: '' },
  }

  try {
    const w = await ingestWeatherSignalsService(hotelId)
    result.weather = {
      ok: true,
      detail: `気象庁 ${w.jma?.count ?? 0}件${w.openMeteo ? `、Open-Meteo ${w.openMeteo.count}件` : ''}${w.skipped.length ? `（${w.skipped.join(' / ')}）` : ''}`,
    }
  } catch (err) {
    result.weather = { ok: false, detail: errorMessage(err) }
    logger.warn({ err, hotelId }, '天候シグナルの取り込みに失敗しました（予測は天候なしで続行）')
    await recordFailureAlert(hotelId, hotel.tenantId, '天候予報の取り込みに失敗', `${errorMessage(err)}。予測は天候要因なしで計算しました。ホテル設定の気象庁コードを確認してください。`)
  }

  try {
    const start = asOfDate ?? new Date()
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + FORECAST_HORIZON_DAYS)
    const f = await recomputeForecastService(hotelId, start, end, undefined, asOfDate)
    result.forecast = { ok: true, detail: `${f.count}件（${f.modelVersion}、基準日 ${f.asOfDate}）` }
  } catch (err) {
    result.forecast = { ok: false, detail: errorMessage(err) }
    logger.error({ err, hotelId }, '需要予測の再計算に失敗しました')
    await recordFailureAlert(hotelId, hotel.tenantId, 'AI推奨価格の更新に失敗', `${errorMessage(err)}。前回の推奨値が表示されています。`)
  }

  try {
    const l = await learnFromActualsService(hotelId, asOfDate)
    // チャレンジャー（ridge-v1）も毎日再学習しておき、比較・昇格に備える
    const t = await trainModelService(hotelId)
    result.learning = { ok: true, detail: `${l.samples}件の実績で ${l.updates.length} 係数を更新、ridge-v1 を ${t.samples}件で学習` }
  } catch (err) {
    result.learning = { ok: false, detail: errorMessage(err) }
    logger.error({ err, hotelId }, '係数の学習に失敗しました')
  }

  try {
    const a = await autoAdoptService(hotelId, asOfDate)
    result.autoAdopt = { ok: true, detail: a.enabled ? `${a.adopted}件を自動採用（候補 ${a.candidates}件）` : '無効' }
  } catch (err) {
    result.autoAdopt = { ok: false, detail: errorMessage(err) }
    logger.error({ err, hotelId }, '自動採用に失敗しました')
  }

  return result
}

/**
 * 全アクティブホテル（または指定ホテル）の日次処理
 */
export async function runDailyJobService(hotelId?: string, asOfDate?: Date): Promise<DailyJobResult> {
  const startedAt = new Date()
  const hotels = await prisma.hotel.findMany({
    where: hotelId ? { id: hotelId } : { isActive: true },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  const results: DailyJobHotelResult[] = []
  for (const h of hotels) {
    results.push(await runDailyJobForHotelService(h.id, asOfDate))
  }
  const finishedAt = new Date()
  logger.info({ hotels: results.length, ms: finishedAt.getTime() - startedAt.getTime() }, '日次ジョブが完了しました')
  return { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), hotels: results }
}

const JST_OFFSET_MS = 9 * 3_600_000

/** 次回の実行時刻（JST の DAILY_JOB_HOUR_JST 時 0 分）までのミリ秒 */
export function msUntilNextRun(now: Date, hourJst: number): number {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS)
  const next = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate(), hourJst, 0, 0))
  if (next.getTime() <= jstNow.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  return next.getTime() - jstNow.getTime()
}

let timer: NodeJS.Timeout | null = null

/**
 * DAILY_JOB_ENABLED=true のときだけ起動する。多重起動を避けるため1プロセス1タイマー
 */
export function startDailyJobScheduler(): void {
  if (!config.DAILY_JOB_ENABLED || timer) return
  const schedule = () => {
    const delay = msUntilNextRun(new Date(), config.DAILY_JOB_HOUR_JST)
    timer = setTimeout(async () => {
      try {
        await runDailyJobService()
      } catch (err) {
        logger.error({ err }, '日次ジョブが異常終了しました')
      } finally {
        schedule()
      }
    }, delay)
    timer.unref()
    logger.info({ nextRunInMinutes: Math.round(delay / 60_000), hourJst: config.DAILY_JOB_HOUR_JST }, '日次ジョブをスケジュールしました')
  }
  schedule()
}

export function stopDailyJobScheduler(): void {
  if (timer) clearTimeout(timer)
  timer = null
}
