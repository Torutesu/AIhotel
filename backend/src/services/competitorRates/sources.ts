import type { CompetitorRateSource } from './types.js'

// 登録済みの取得元（#9 段階B）。
//
// まだ1つも登録していない。サイトごとの取得処理は、対象の競合の URL（初期設定で登録 — #13）が揃ってから、
// 1サイトずつ types.ts の約束に沿って実装し、ここに足す。登録が無い間、取得ジョブは何もせずに終わり、
// 競合価格は CSV の取り込み（POST /imports/competitor-prices）で入れる。
export const competitorRateSources: CompetitorRateSource[] = []
