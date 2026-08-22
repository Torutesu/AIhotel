import type {
  ReadResultData,
  SyncErrorCode,
  SyncPriceRankItem,
  WriteVerification,
} from '@hotel-revenue-system/shared/types'

// 実行器の共通戻り値。index.ts がこれを結果報告＋証跡アップロードに変換する

export interface ExecEvidence {
  /** sanitize.ts でマスク済みのHTMLスナップショット */
  html?: string
  screenshotPng?: Buffer
  capturedAt: string
}

export type ExecOutcome =
  | {
      status: 'DONE'
      readData?: ReadResultData
      writeVerification?: WriteVerification
      evidence?: ExecEvidence
      /** 書き込み直前の現在値（PRE_WRITEスナップショット＝ロールバックの根拠 — §13.2） */
      preWriteItems?: SyncPriceRankItem[]
    }
  | {
      status: 'FAILED'
      errorCode: SyncErrorCode
      errorMessage: string
      evidence?: ExecEvidence
      preWriteItems?: SyncPriceRankItem[]
    }
