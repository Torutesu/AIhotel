import type { ClaimedJob, NehoppsDefinition } from '@hotel-revenue-system/shared/types'
import type { ExecOutcome } from './types.js'

// ねほっぷす（ネイティブWindows）実行器。
// UIA調査（connector-agent/README.md）の結果を受けて FlaUI 製CLIを同梱し、
// 定義の cli 設定に従って子プロセスとして呼び出す設計（設計書 §3.2）。
// CLIが確定するまでは UNSUPPORTED を返し、ジョブは終局FAILEDになる（実装済みと偽らない）。

export class NehoppsExecutor {
  async execute(_job: ClaimedJob, def: NehoppsDefinition): Promise<ExecOutcome> {
    if (!def.cli) {
      return {
        status: 'FAILED',
        errorCode: 'UNSUPPORTED',
        errorMessage: 'ねほっぷすの操作定義が未確定です（UIA調査の完了待ち — connector-agent/README.md）',
      }
    }
    // TODO(Phase C): FlaUI CLI（nehopps-writer.exe）を spawn し、
    // ジョブpayloadをJSONで渡して結果を受け取る。書き込み後は表示値の読み返し検証を行う
    return {
      status: 'FAILED',
      errorCode: 'UNSUPPORTED',
      errorMessage: 'ねほっぷすCLI連携は未実装です（Phase C）',
    }
  }
}
