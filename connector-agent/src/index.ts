import type { ClaimedJob, LincolnDefinition, NehoppsDefinition } from '@hotel-revenue-system/shared/types'
import { loadConfig, loadDeviceToken, saveDeviceToken } from './config.js'
import { BackendClient, NetworkError } from './api.js'
import { Spool } from './spool.js'
import { LincolnExecutor } from './executors/lincoln.js'
import { NehoppsExecutor } from './executors/nehopps.js'
import type { ExecOutcome } from './executors/types.js'
import { sanitizeJson } from './sanitize.js'

// コネクタエージェント本体（設計書 §2, §7, §10）。
// クライアントPCに常駐し、外向きHTTPSのみで backend のジョブキューをポーリングする。
//
// 使い方:
//   ペアリング（初回のみ）: pnpm --filter @hotel-revenue-system/connector-agent start pair <コード>
//   常駐実行:              pnpm --filter @hotel-revenue-system/connector-agent start run
//   1サイクルのみ（検証用）: pnpm --filter @hotel-revenue-system/connector-agent start once

const config = loadConfig()

function log(message: string, extra?: unknown): void {
  const line = `[${new Date().toISOString()}] ${message}`
  if (extra !== undefined) console.log(line, extra)
  else console.log(line)
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pair(code: string): Promise<void> {
  const client = new BackendClient(config, null)
  const result = await client.pair(code)
  saveDeviceToken(config.dataDir, result.deviceToken)
  log(`デバイス登録完了: ${result.device.name}（hotelId: ${result.device.hotelId}）`)
  log(`トークンを ${config.dataDir} に保存しました。以後 'run' で常駐実行できます`)
}

/** ExecOutcome を結果報告＋証跡としてスプールに積む（送信は flush が担う） */
function spoolOutcome(spool: Spool, job: ClaimedJob, outcome: ExecOutcome): void {
  // 証跡（サニタイズ済みのみ。§12）
  const artifacts: Array<{ kind: string; contentType: string; data: Buffer | string }> = []
  const evidenceKind =
    outcome.status === 'FAILED' ? 'FAILURE_EVIDENCE' : job.direction === 'READ' ? 'READ_RAW' : 'POST_WRITE'
  if (outcome.evidence?.html) {
    artifacts.push({ kind: evidenceKind, contentType: 'text/html', data: outcome.evidence.html })
  }
  if (outcome.evidence?.screenshotPng && outcome.status === 'FAILED') {
    artifacts.push({ kind: 'FAILURE_EVIDENCE', contentType: 'image/png', data: outcome.evidence.screenshotPng })
  }
  if (outcome.preWriteItems) {
    // 書き込み直前の現在値 = ロールバックの根拠（§13.2）
    artifacts.push({
      kind: 'PRE_WRITE',
      contentType: 'application/json',
      data: sanitizeJson(JSON.stringify({ capturedAt: new Date().toISOString(), items: outcome.preWriteItems })),
    })
  }
  for (const artifact of artifacts) {
    spool.enqueue({
      kind: 'artifact',
      jobId: job.id,
      body: {
        kind: artifact.kind,
        contentType: artifact.contentType,
        dataBase64: Buffer.isBuffer(artifact.data)
          ? artifact.data.toString('base64')
          : Buffer.from(artifact.data, 'utf8').toString('base64'),
        capturedAt: outcome.evidence?.capturedAt ?? new Date().toISOString(),
        sanitized: true,
      },
    })
  }

  // 結果報告は証跡の後に積む（backend側でジョブが終局した後に証跡が拒否されないよう先送り）
  spool.enqueue({
    kind: 'result',
    jobId: job.id,
    body:
      outcome.status === 'DONE'
        ? {
            status: 'DONE',
            ...(outcome.readData ? { readData: outcome.readData } : {}),
            ...(outcome.writeVerification ? { writeVerification: outcome.writeVerification } : {}),
          }
        : { status: 'FAILED', errorCode: outcome.errorCode, errorMessage: outcome.errorMessage },
  })
}

async function runLoop(once: boolean): Promise<void> {
  const token = loadDeviceToken(config.dataDir)
  if (!token) {
    throw new Error(`デバイストークンがありません。先に 'pair <コード>' を実行してください（${config.dataDir}）`)
  }
  const client = new BackendClient(config, token)
  const spool = new Spool(config.dataDir)
  const lincoln = new LincolnExecutor(
    config.dataDir,
    process.env.CONNECTOR_LINCOLN_USER && process.env.CONNECTOR_LINCOLN_PASSWORD
      ? { user: process.env.CONNECTOR_LINCOLN_USER, password: process.env.CONNECTOR_LINCOLN_PASSWORD }
      : null,
    process.env.CONNECTOR_HEADLESS === 'true'
  )
  const nehopps = new NehoppsExecutor()

  // heartbeat（デッドマン検知 §14.1 の生存信号）。失敗しても実行は続ける
  const heartbeatTimer = setInterval(() => {
    client.heartbeat().catch((error) => log(`heartbeat失敗: ${String(error)}`))
  }, config.heartbeatIntervalMs)
  heartbeatTimer.unref()

  log(`エージェント起動（backend: ${config.backendUrl}, poll: ${config.pollIntervalMs}ms）`)
  let networkBackoffMs = config.pollIntervalMs

  for (;;) {
    try {
      await spool.flush(client)

      const job = await client.claimJob()
      networkBackoffMs = config.pollIntervalMs // 通信成功でバックオフをリセット

      if (job) {
        log(`ジョブ受領: ${job.id} ${job.target} ${job.direction}${job.dryRun ? ' (dry-run)' : ''}`)
        const definition = await client.getDefinition(job.target)
        const outcome: ExecOutcome =
          job.target === 'LINCOLN'
            ? await lincoln.execute(job, definition as LincolnDefinition)
            : await nehopps.execute(job, definition as NehoppsDefinition)
        spoolOutcome(spool, job, outcome)
        await spool.flush(client)
        log(
          outcome.status === 'DONE'
            ? `ジョブ完了: ${job.id}`
            : `ジョブ失敗: ${job.id} [${outcome.errorCode}] ${outcome.errorMessage}`
        )
        if (once) break
        continue // ジョブがあった直後は待たずに次をポーリング
      }

      if (once) break
      await sleep(config.pollIntervalMs)
    } catch (error) {
      if (error instanceof NetworkError) {
        // ネット断: 指数バックオフ（上限5分）。復帰後に殺到しない（§10.3）
        networkBackoffMs = Math.min(networkBackoffMs * 2, 5 * 60 * 1000)
        log(`backend接続不可。${Math.round(networkBackoffMs / 1000)}秒後に再試行します`)
        if (once) throw error
        await sleep(networkBackoffMs)
      } else {
        log(`ループ内エラー: ${String(error)}`)
        if (once) throw error
        await sleep(config.pollIntervalMs)
      }
    }
  }

  clearInterval(heartbeatTimer)
  await lincoln.close()
}

const [, , command, ...args] = process.argv
try {
  switch (command) {
    case 'pair': {
      if (!args[0]) throw new Error('使い方: pair <ペアリングコード>')
      await pair(args[0])
      break
    }
    case 'once':
      await runLoop(true)
      break
    case 'run':
    case undefined:
      await runLoop(false)
      break
    default:
      throw new Error(`不明なコマンドです: ${command}（pair / run / once）`)
  }
} catch (error) {
  console.error(String(error))
  process.exitCode = 1
}
