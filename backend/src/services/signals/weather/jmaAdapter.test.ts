import { describe, it, expect } from 'vitest'
import { parseJmaForecast, isRainyJmaCode, type JmaForecastResponse } from './jmaAdapter.js'
import fixture from './__fixtures__/jma-130000.json'

// フィクスチャは 2026-09-07 17:00 発表の東京都（130000）予報を東京地方・東京に絞ったもの
const response = fixture as unknown as JmaForecastResponse

describe('parseJmaForecast', () => {
  it('短期3日＋週間予報を日別に統合し、日付順に返す', () => {
    const result = parseJmaForecast(response, '130010')
    expect(result.reportDatetime).toBe('2026-09-07T17:00:00+09:00')
    expect(result.fallbackAreaCode).toBeNull()
    const dates = result.days.map((d) => d.date)
    expect(dates[0]).toBe('2026-09-07')
    expect(dates).toEqual([...dates].sort())
    // 9/7〜9/14 の8日分
    expect(dates).toHaveLength(8)
  })

  it('短期予報の天気コードと6時間ごとの降水確率の最大値が優先される', () => {
    const result = parseJmaForecast(response, '130010')
    const d8 = result.days.find((d) => d.date === '2026-09-08')!
    expect(d8.weatherCode).toBe('203') // 短期側
    expect(d8.rainProbability).toBe(50) // 9/8 の 00-06/06-12/12-18 の最大 = 50
    // 週間側は初日の気温が空欄なので短期側（00時=最低23, 09時=最高29）で埋まる
    expect(d8.tempMin).toBe(23)
    expect(d8.tempMax).toBe(29)
    // 週間側の気温
    const d9 = result.days.find((d) => d.date === '2026-09-09')!
    expect(d9.tempMax).toBe(33)
    expect(d9.tempMin).toBe(22)
  })

  it('週間予報のみの日は信頼度と降水確率を持つ', () => {
    const result = parseJmaForecast(response, '130010')
    const d10 = result.days.find((d) => d.date === '2026-09-10')!
    expect(d10.weatherCode).toBe('203')
    expect(d10.rainProbability).toBe(70)
    expect(d10.reliability).toBe('B')
    expect(d10.isRainy).toBe(true) // 降水確率 70% ≥ 60
  })

  it('要求した区域コードがなければ先頭区域にフォールバックし、その旨を返す', () => {
    const result = parseJmaForecast(response, '130999')
    expect(result.fallbackAreaCode).toBe('130010')
    expect(result.days.length).toBeGreaterThan(0)
  })
})

describe('isRainyJmaCode', () => {
  it('百の位が 3（雨）または 4（雪）なら雨天扱い', () => {
    expect(isRainyJmaCode('300')).toBe(true)
    expect(isRainyJmaCode('402')).toBe(true)
    expect(isRainyJmaCode('203')).toBe(false) // 曇時々雨は主天気が曇
    expect(isRainyJmaCode('100')).toBe(false)
  })
})
