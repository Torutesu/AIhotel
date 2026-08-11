import { describe, it, expect } from 'vitest'
import { mapRow, applyTransform, extractSegmentBlock } from './fileIngestService.js'
import { parseCsv } from '../lib/tabularParser.js'
import { findProfile, detectPiiColumns, INGEST_PROFILES } from '../lib/ingestProfiles.js'
import { ingestNightRowSchema, fileIngestSchema } from '../lib/validators.js'

// 新宿ワシントン実績CSV（HG2025年CSV.zip / CSV202501HG.xlsx）の実際の1行。
// 列名・値はDriveの実データそのまま。
const HG_SOURCE_ROW: Record<string, unknown> = {
  棟コード: 'MAIN',
  計上日: new Date('2025-01-01T00:00:00Z'),
  曜日: '4',
  料金タイプ: 'DMN',
  Rタイプ: 'スタンダードダブル',
  部屋タイプ: 'DMN',
  タイプ: 'ダブル',
  室数: 1,
  男人数: 2,
  女人数: 0,
  子供人数: 0,
  人数計: 2,
  室料NET: 27456,
  サービス: 2744,
  サ込み: 30.2,
  ADR: 27456,
  パッケージコード: 'RDA7D',
  個人団体区分: 'I',
  エージェントコード: 'DAI',
  地域コード: 'GBR',
  'Market(市場)コード': 'IFF',
  ブロック: null,
  チェックイン日: new Date('2024-12-21T00:00:00Z'),
  チェックアウト日: new Date('2025-01-02T00:00:00Z'),
  デイユースフラグ: '0',
  'COMP/HU区分': null,
  泊数: 12,
  リードタイム: 11,
}

describe('applyTransform', () => {
  it('日付を Date に正規化する（スラッシュ区切りも受ける）', () => {
    expect(applyTransform('2025-01-01', 'date')).toBeInstanceOf(Date)
    expect((applyTransform('2025/1/5', 'date') as Date).toISOString().slice(0, 10)).toBe('2025-01-05')
    expect(applyTransform('', 'date')).toBeUndefined()
  })

  it('カンマ・空白・通貨記号つきの数値を扱う', () => {
    expect(applyTransform('1,234', 'number')).toBe(1234)
    expect(applyTransform(' ¥27,456 ', 'number')).toBe(27456)
    expect(applyTransform('', 'number')).toBeUndefined()
    expect(applyTransform('abc', 'number')).toBeUndefined()
  })

  it('0/1フラグをbooleanにする', () => {
    expect(applyTransform('1', 'flag01')).toBe(true)
    expect(applyTransform('0', 'flag01')).toBe(false)
    expect(applyTransform('○', 'flag01')).toBe(true)
  })

  it('既定は文字列trim。空文字はundefinedにする（任意項目を落とすため）', () => {
    expect(applyTransform('  MAIN  ', undefined)).toBe('MAIN')
    expect(applyTransform('   ', undefined)).toBeUndefined()
  })
})

describe('mapRow（HGプロファイル）', () => {
  const profile = findProfile('hg-nights')!
  const dataset = profile.datasets.nights!

  it('実データ1行を共通項目へ写像し、zodスキーマを通る', () => {
    const mapped = mapRow(HG_SOURCE_ROW, dataset)
    const parsed = ingestNightRowSchema.safeParse(mapped)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    expect(parsed.data.roomTypeCode).toBe('DMN')
    expect(parsed.data.rooms).toBe(1)
    expect(parsed.data.guests).toBe(2)
    expect(parsed.data.roomRevenue).toBe(27456)
    expect(parsed.data.serviceFee).toBe(2744)
    expect(parsed.data.agentCode).toBe('DAI')
    expect(parsed.data.regionCode).toBe('GBR')
    expect(parsed.data.marketCode).toBe('IFF')
    expect(parsed.data.individualGroupType).toBe('I')
    expect(parsed.data.buildingCode).toBe('MAIN')
    expect(parsed.data.isDayUse).toBe(false)
    expect(parsed.data.stayDate.toISOString().slice(0, 10)).toBe('2025-01-01')
  })

  it('男女子の人数を guestsDetail に入れ子で格納する', () => {
    const mapped = mapRow(HG_SOURCE_ROW, dataset) as { guestsDetail?: Record<string, number> }
    expect(mapped.guestsDetail).toEqual({ male: 2, female: 0, child: 0 })
  })

  it('計算列（ADR・泊数・リードタイム）は取り込まない', () => {
    const mapped = mapRow(HG_SOURCE_ROW, dataset)
    expect(mapped).not.toHaveProperty('adr')
    expect(mapped).not.toHaveProperty('nights')
    expect(mapped).not.toHaveProperty('leadTime')
    // 二重定義を避ける意図をプロファイル側にも明記してある
    expect(dataset.ignoredColumns).toContain('ADR')
    expect(dataset.ignoredColumns).toContain('リードタイム')
  })

  it('空セルの任意項目は落として通す（PMSによって欠ける列があるため）', () => {
    const sparse = { ...HG_SOURCE_ROW, エージェントコード: null, 地域コード: '' }
    const parsed = ingestNightRowSchema.safeParse(mapRow(sparse, dataset))
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.agentCode).toBeUndefined()
      expect(parsed.data.regionCode).toBeUndefined()
    }
  })

  it('必須列（部屋タイプ）が欠けた行は弾く', () => {
    const broken = { ...HG_SOURCE_ROW, 部屋タイプ: null }
    expect(ingestNightRowSchema.safeParse(mapRow(broken, dataset)).success).toBe(false)
  })
})

describe('parseCsv', () => {
  it('引用符・カンマ・改行を含むCSVを正しく分解する', () => {
    const csv = 'a,b,c\n1,"x,y",3\r\n4,"改行\n入り",6\n'
    expect(parseCsv(csv)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x,y', '3'],
      ['4', '改行\n入り', '6'],
    ])
  })

  it('二重引用符のエスケープを解く', () => {
    expect(parseCsv('a\n"He said ""hi"""')).toEqual([['a'], ['He said "hi"']])
  })

  it('BOMを除去する', () => {
    expect(parseCsv('﻿計上日,室数\n2025-01-01,1')).toEqual([
      ['計上日', '室数'],
      ['2025-01-01', '1'],
    ])
  })

  it('末尾に改行が無くても最終行を落とさない', () => {
    expect(parseCsv('a,b\n1,2')).toHaveLength(2)
  })
})

describe('detectPiiColumns（個人情報の二次防御）', () => {
  it('氏名・住所・電話・予約番号を検出する', () => {
    const detected = detectPiiColumns([
      '計上日',
      '室数',
      '氏名',
      '住所',
      '電話番号',
      '予約番号',
      'メールアドレス',
    ])
    expect(detected).toEqual(['氏名', '住所', '電話番号', '予約番号', 'メールアドレス'])
  })

  it('通常の業務列は検出しない（誤検知で取込が止まらないこと）', () => {
    expect(detectPiiColumns(Object.keys(HG_SOURCE_ROW))).toEqual([])
  })
})

describe('fileIngestSchema', () => {
  const base = {
    hotelId: 'demo-hotel-001',
    profileId: 'hg-nights',
    fileName: 'CSV202501HG.xlsx',
    contentBase64: 'UEsDBBQ=',
  }

  it('実績（nights）は capturedDate なしで受け付ける', () => {
    expect(fileIngestSchema.safeParse({ ...base, dataset: 'nights' }).success).toBe(true)
  })

  it('オンハンド予約は capturedDate が必須', () => {
    expect(fileIngestSchema.safeParse({ ...base, dataset: 'reservations' }).success).toBe(false)
    expect(
      fileIngestSchema.safeParse({
        ...base,
        dataset: 'reservations',
        capturedDate: '2026-08-11',
      }).success
    ).toBe(true)
  })

  it('dryRunなら capturedDate なしでも検証できる', () => {
    expect(
      fileIngestSchema.safeParse({ ...base, dataset: 'inventory', dryRun: true }).success
    ).toBe(true)
  })

  it('未知のdatasetを拒否する', () => {
    expect(fileIngestSchema.safeParse({ ...base, dataset: 'unknown' }).success).toBe(false)
  })
})

describe('組み込みプロファイル', () => {
  it('プロファイルIDが一意で、対応datasetを申告している', () => {
    const ids = INGEST_PROFILES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of INGEST_PROFILES) {
      expect(Object.keys(p.datasets).length).toBeGreaterThan(0)
    }
  })

  it('CSV版とExcel版で同じマッピングを共有している（列名の二重管理を避ける）', () => {
    const excel = findProfile('hg-nights')!.datasets.nights!
    const csv = findProfile('hg-nights-csv')!.datasets.nights!
    expect(csv.map).toEqual(excel.map)
  })
})

describe('extractSegmentBlock（コードマスターの自動取込）', () => {
  // 「コードマスター7」シートは3つの表が横並びで、ブロックごとに行数が違う
  const sheetRows = [
    { MC: 'BF', 名称: '団体･AGT･募集外人', MC集約: '06 BF', 地域コード: '01HK', 地域名称: '001 北海道', 分割１: '801 国内', AGTCD: 'ADD', AGT名: 'ｱﾀﾞﾂｱｰｽﾞｼﾞｬﾊﾟﾝ', 種別3: '02 FIT欧米' },
    { MC: 'BJ', 名称: '団体･AGT･募集邦人', MC集約: '05 BJ', 地域コード: '02AM', 地域名称: '002 青森県', 分割１: '801 国内', AGTCD: 'AGD', AGT名: 'AGODA', 種別3: '03 海外ネット' },
    // マーケットと地域は尽きたが、エージェントはまだ続く行
    { MC: null, 名称: null, MC集約: null, 地域コード: '', 地域名称: '', AGTCD: 'BKG', AGT名: 'BOOKING.COM', 種別3: '03 海外ネット' },
  ]

  it('コード列が空の行はそのブロックでは無視する（ブロック長の違いを吸収）', () => {
    const markets = extractSegmentBlock(sheetRows, {
      kind: 'MARKET',
      codeColumn: 'MC',
      nameColumn: '名称',
      aggregateColumn: 'MC集約',
    })
    expect(markets).toHaveLength(2)
    expect(markets[0]).toEqual({ code: 'BF', name: '団体･AGT･募集外人', aggregateCode: '06 BF' })
  })

  it('他ブロックが尽きても最後まで拾う', () => {
    const agents = extractSegmentBlock(sheetRows, {
      kind: 'AGENT',
      codeColumn: 'AGTCD',
      nameColumn: 'AGT名',
      aggregateColumn: '種別3',
    })
    expect(agents.map((a) => a.code)).toEqual(['ADD', 'AGD', 'BKG'])
  })

  it('補助列を attributes に格納する', () => {
    const regions = extractSegmentBlock(sheetRows, {
      kind: 'REGION',
      codeColumn: '地域コード',
      nameColumn: '地域名称',
      attributeColumns: ['分割１'],
    })
    expect(regions[0].attributes).toEqual({ 分割１: '801 国内' })
  })

  it('同じコードが複数行に出ても1件にまとめる', () => {
    const dup = [...sheetRows, { MC: 'BF', 名称: '重複', MC集約: 'X' }]
    expect(extractSegmentBlock(dup, { kind: 'MARKET', codeColumn: 'MC', nameColumn: '名称' })).toHaveLength(2)
  })

  it('名称が空のコードはコードを表示名にする（分析側で落とさないため）', () => {
    const noName = [{ MC: 'ZZ', 名称: null }]
    expect(extractSegmentBlock(noName, { kind: 'MARKET', codeColumn: 'MC', nameColumn: '名称' })[0]).toEqual({
      code: 'ZZ',
      name: 'ZZ',
    })
  })
})
