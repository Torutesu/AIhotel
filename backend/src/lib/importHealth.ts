// 取込の鮮度判定（無人運用の監視 — #6）。
//
// 端末やスケジューラが止まっても誰も気づかない、が無人運用でいちばん怖い失敗なので、
// 「最後に取り込めたのはいつか」「前日分が入っているか」を判定してアラートの材料にする。
// DB を触らない純粋関数にしてテストで固定する。

export type ImportFreshnessStatus =
  /** 想定どおり取り込めている */
  | 'ok'
  /** まだ一度も取り込まれていない（セットアップ前。アラートにはしない） */
  | 'never-imported'
  /** 取り込み自体は動いているが、前日分の実績が無い */
  | 'missing-previous-day'
  /** 一定時間、取り込みが成功していない（端末・スケジューラの停止を疑う） */
  | 'stale'

export interface ImportFreshnessInput {
  /** 前日（JST）の日別実績が入っているか */
  hasPreviousDayData: boolean
  /** 直近で成功した取込の時刻。一度も無ければ null */
  lastSuccessAt: Date | null
  /** 判定時刻 */
  now: Date
  /** これ以上取込が無ければ停止と見なす時間（既定36時間 = 日次運用で1回飛んでも検知できる） */
  staleHours?: number
}

export interface ImportFreshnessResult {
  status: ImportFreshnessStatus
  /** アラートの本文に使う説明 */
  message: string
  /** 最後の成功からの経過時間（未取込なら null） */
  hoursSinceLastSuccess: number | null
}

export const DEFAULT_STALE_HOURS = 36

export function evaluateImportFreshness(input: ImportFreshnessInput): ImportFreshnessResult {
  const staleHours = input.staleHours ?? DEFAULT_STALE_HOURS

  if (!input.lastSuccessAt) {
    return {
      status: 'never-imported',
      message: '取込が一度も実行されていません',
      hoursSinceLastSuccess: null,
    }
  }

  const hoursSinceLastSuccess =
    Math.round(((input.now.getTime() - input.lastSuccessAt.getTime()) / 3_600_000) * 10) / 10

  if (hoursSinceLastSuccess > staleHours) {
    return {
      status: 'stale',
      message: `最後に取り込めたのは ${hoursSinceLastSuccess} 時間前です（${staleHours} 時間以上、取込が成功していません）`,
      hoursSinceLastSuccess,
    }
  }

  if (!input.hasPreviousDayData) {
    return {
      status: 'missing-previous-day',
      message: '取込は動いていますが、前日分の日別実績が入っていません',
      hoursSinceLastSuccess,
    }
  }

  return { status: 'ok', message: '前日分まで取り込めています', hoursSinceLastSuccess }
}
