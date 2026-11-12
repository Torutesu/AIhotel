import { prisma } from '../lib/prisma.js'
import { addUtcDays, todayJst } from '../lib/date.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import { loadDayTypeModel } from './dayTypeService.js'
import { MIN_PATTERN_HISTORY } from './forecast/dayPattern.js'
import { MIN_OWN_HISTORY_DAYS } from './forecast/coldStart.js'
import { COMPETITOR_PRICE_MAX_AGE_HOURS } from './forecast/strategyWeighting.js'
import { weatherAreaCodeForPrefecture } from './externalSignals/jmaWeather.js'

// 予測の準備状況（D-13）。「このホテルで AI のどの機能が、どこまで働いているか」を返す。
// 初期設定のチェックリスト（setupStatusService — 設定が揃ったか）とは別に、データがたまるにつれて働く機能を見せる。
// 新規開業・導入直後のホテルは coldStart → learning → full と進む。画面の注記・運営の立ち上げの確認に使う。

export type ReadinessMode = 'coldStart' | 'learning' | 'full'
export type CapabilityStatus = 'active' | 'limited' | 'inactive'

export interface Capability {
  key: string
  label: string
  status: CapabilityStatus
  detail: string
}

const FULL_HISTORY_DAYS = 300

export async function getForecastReadinessService(hotelId: string) {
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, isActive: true },
    select: { hotelType: true, openedOn: true, prefectureCode: true, weatherAreaCode: true },
  })
  if (!hotel) throw new NotFoundError('ホテル')
  const today = todayJst()
  const [historyDays, model, lastYearCurveDays, weather, agentRun, agentEnabledRuns, freshCompetitors, competitors] = await Promise.all([
    prisma.dailyData.count({ where: { hotelId, date: { gte: addUtcDays(today, -400), lt: today }, occupancy: { not: null } } }),
    loadDayTypeModel(hotelId, today),
    prisma.bookingCurveData.groupBy({
      by: ['stayDate'],
      where: { hotelId, stayDate: { gte: addUtcDays(today, -400), lt: addUtcDays(today, -300) } },
    }),
    prisma.weatherForecast.findFirst({ where: { hotelId }, orderBy: { reportedAt: 'desc' }, select: { reportedAt: true } }),
    prisma.externalAgentRun.findFirst({ where: { hotelId, status: 'succeeded' }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
    prisma.externalAgentRun.count({ where: { hotelId } }),
    prisma.competitorPriceData.count({
      where: {
        competitor: { hotelId, isActive: true },
        date: { gte: today },
        observedAt: { gte: new Date(Date.now() - COMPETITOR_PRICE_MAX_AGE_HOURS * 3600_000) },
      },
    }),
    prisma.competitor.count({ where: { hotelId, isActive: true } }),
  ])

  const clusteredDays = model.paceClustering.clusters.reduce((a, c) => a + c.days, 0)
  const typeCount = model.types.length
  const weatherArea = hotel.weatherAreaCode ?? weatherAreaCodeForPrefecture(hotel.prefectureCode)

  const capabilities: Capability[] = [
    {
      key: 'baseline',
      label: '基準の予測（同曜日平均・前年比較）',
      status: historyDays >= FULL_HISTORY_DAYS ? 'active' : historyDays >= MIN_OWN_HISTORY_DAYS ? 'limited' : 'inactive',
      detail:
        historyDays >= MIN_OWN_HISTORY_DAYS
          ? `実績 ${historyDays} 日分で予測しています${historyDays < FULL_HISTORY_DAYS ? '（前年比較はまだ一部の日だけ）' : ''}`
          : hotel.hotelType
            ? `実績が ${historyDays} 日分のため、ホテルタイプの典型的な予約の入り方で補っています`
            : `実績が ${historyDays} 日分です。ホテルタイプを設定すると、典型的な予約の入り方で補えます`,
    },
    {
      key: 'similarDays',
      label: '似た日の着地（背景と入り方が近い過去の日）',
      status: historyDays >= FULL_HISTORY_DAYS ? 'active' : historyDays >= MIN_PATTERN_HISTORY ? 'limited' : 'inactive',
      detail:
        historyDays >= MIN_PATTERN_HISTORY
          ? `過去 ${historyDays} 日から似た日を探しています${historyDays < FULL_HISTORY_DAYS ? '（季節をひと回りするまでは同じ季節の日が少ない）' : ''}`
          : `過去の実績が ${MIN_PATTERN_HISTORY} 日分たまると使い始めます`,
    },
    {
      key: 'paceClusters',
      label: 'ピックアップ型（リードタイム別の入り方）',
      status: model.paceClustering.clusters.length >= 2 ? 'active' : 'inactive',
      detail:
        model.paceClustering.clusters.length >= 2
          ? `${clusteredDays} 日分の予約の入り方を ${model.paceClustering.clusters.length} 型に分けています`
          : '180日前から当日までの予約の記録がそろった日が足りません（過去の予約積上の取り込みで早く使えます）',
    },
    {
      key: 'dayTypes',
      label: '日のタイプ（着地の稼働×単価）',
      status: typeCount >= 6 ? 'active' : typeCount > 0 ? 'limited' : 'inactive',
      detail: typeCount > 0 ? `${typeCount} 型（${[...new Set(model.types.map((t) => t.name))].join('・')}）` : '過去の結果が足りないため、型を作れていません',
    },
    {
      key: 'lastYearPace',
      label: '前年同曜日と比べた予約のペース',
      status: lastYearCurveDays.length >= 30 ? 'active' : lastYearCurveDays.length > 0 ? 'limited' : 'inactive',
      detail:
        lastYearCurveDays.length > 0
          ? `前年の予約の記録が ${lastYearCurveDays.length} 日分あります`
          : '前年の予約の記録がありません（過去の予約積上を取り込むと使えます）',
    },
    {
      key: 'competitors',
      label: '競合価格',
      status: freshCompetitors > 0 ? 'active' : competitors > 0 ? 'limited' : 'inactive',
      detail:
        freshCompetitors > 0
          ? `${COMPETITOR_PRICE_MAX_AGE_HOURS} 時間以内の競合価格が ${freshCompetitors} 件あります`
          : competitors > 0
            ? `競合は登録済みですが、${COMPETITOR_PRICE_MAX_AGE_HOURS} 時間以内の価格がありません（推奨から外れます）`
            : '競合が登録されていません',
    },
    {
      key: 'weather',
      label: '天気（気象庁）',
      status: weather && weather.reportedAt.getTime() > Date.now() - 2 * 86_400_000 ? 'active' : weatherArea ? 'limited' : 'inactive',
      detail: weather
        ? `最後の予報: ${weather.reportedAt.toISOString().slice(0, 16).replace('T', ' ')}（UTC）`
        : weatherArea
          ? `予報区 ${weatherArea}。次の外部要因ジョブで取ります`
          : '都道府県か予報区を設定すると取れます',
    },
    {
      key: 'externalAgent',
      label: '外部要因エージェント（イベント・新規ホテル・市場の動き）',
      status: agentRun ? 'active' : agentEnabledRuns > 0 ? 'limited' : 'inactive',
      detail: agentRun
        ? `最後に集めた日: ${agentRun.startedAt.toISOString().slice(0, 10)}`
        : agentEnabledRuns > 0
          ? 'まだ集められていません（実行記録の失敗理由を確認してください）'
          : 'まだ動いていません（API キーの設定後、次の外部要因ジョブで動きます）',
    },
  ]

  const mode: ReadinessMode =
    historyDays < MIN_OWN_HISTORY_DAYS ? 'coldStart' : historyDays < FULL_HISTORY_DAYS || model.paceClustering.clusters.length < 2 ? 'learning' : 'full'
  return {
    hotelId,
    mode,
    /** 画面の注記にそのまま出す */
    summary:
      mode === 'coldStart'
        ? '実績がまだ少ないため、ホテルタイプの典型と今の予約から予測しています。予測は参考値です'
        : mode === 'learning'
          ? '実績がたまりつつあります。季節をひと回りするまでは、一部の機能が限られた材料で動いています'
          : '必要な材料がそろっています',
    historyDays,
    openedOn: hotel.openedOn?.toISOString().slice(0, 10) ?? null,
    capabilities,
  }
}
