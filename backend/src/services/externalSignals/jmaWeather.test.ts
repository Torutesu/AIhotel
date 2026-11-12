import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseJmaForecast, weatherAreaCodeForPrefecture } from './jmaWeather.js'
import { weatherClassOf } from '../dayTypeService.js'

// 気象庁の予報 JSON（2026-11-12 17時発表の東京都 — 実データを保存したもの）を日ごとの天気にする（D-13）
const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/jma-130000.json', import.meta.url), 'utf8'))

describe('parseJmaForecast', () => {
  const parsed = parseJmaForecast(fixture)

  it('週間予報の7日分に、短期予報の重なる日の天気・降水確率（6時間ごとの最大）を上書きする', () => {
    expect(parsed.reportedAt.toISOString()).toBe('2026-11-12T08:00:00.000Z')
    expect(parsed.days.map((d) => d.date)).toEqual([
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
    ])
    const tomorrow = parsed.days[1]
    expect(tomorrow).toMatchObject({ weatherCode: '211', weatherText: 'くもり 昼前 から 晴れ', pop: 10 })
    // 週間予報だけの日: 降水確率・信頼度・気温
    expect(parsed.days[4]).toMatchObject({ date: '2026-11-16', weatherCode: '201', pop: 30, reliability: 'A', tempMax: 20, tempMin: 12 })
  })

  it('形式が違えば例外にする', () => {
    expect(() => parseJmaForecast({})).toThrow()
  })
})

describe('予報区・天気の大分類', () => {
  it('都道府県コードから府県予報区を決める（北海道・鹿児島・沖縄は道庁・県庁のある地方）', () => {
    expect(weatherAreaCodeForPrefecture('13')).toBe('130000')
    expect(weatherAreaCodeForPrefecture('01')).toBe('016000')
    expect(weatherAreaCodeForPrefecture('47')).toBe('471000')
    expect(weatherAreaCodeForPrefecture('48')).toBeNull()
    expect(weatherAreaCodeForPrefecture(null)).toBeNull()
  })

  it('天気コードの先頭の桁で晴れ・くもり・雨・雪に分ける', () => {
    expect(weatherClassOf('101')).toBe(1)
    expect(weatherClassOf('313')).toBe(3)
    expect(weatherClassOf('')).toBeNull()
  })
})
