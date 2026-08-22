import * as fs from 'node:fs'
import * as path from 'node:path'

// エージェント設定。クライアントPCの環境変数 or agent-config.json から読む。
// デバイストークンは backend に預けない設計（設計書 §12）のため、
// ペアリング時にローカルの token ファイルへ保存する。
// TODO(Phase C): Windows資格情報マネージャー（DPAPI）保存へ移行する

export interface AgentConfig {
  backendUrl: string
  dataDir: string
  pollIntervalMs: number
  heartbeatIntervalMs: number
  agentVersion: string
}

const DEFAULTS = {
  pollIntervalMs: 15_000,
  heartbeatIntervalMs: 60_000,
}

export function loadConfig(): AgentConfig {
  const backendUrl = process.env.CONNECTOR_BACKEND_URL
  if (!backendUrl) {
    throw new Error('CONNECTOR_BACKEND_URL を設定してください（例: https://api.example.com）')
  }
  const dataDir = path.resolve(process.env.CONNECTOR_DATA_DIR ?? '.agent-data')
  fs.mkdirSync(dataDir, { recursive: true })
  return {
    backendUrl: backendUrl.replace(/\/$/, ''),
    dataDir,
    pollIntervalMs: Number(process.env.CONNECTOR_POLL_INTERVAL_MS ?? DEFAULTS.pollIntervalMs),
    heartbeatIntervalMs: Number(process.env.CONNECTOR_HEARTBEAT_INTERVAL_MS ?? DEFAULTS.heartbeatIntervalMs),
    agentVersion: '0.1.0',
  }
}

const TOKEN_FILE = 'device-token'

export function loadDeviceToken(dataDir: string): string | null {
  const p = path.join(dataDir, TOKEN_FILE)
  if (!fs.existsSync(p)) return null
  const token = fs.readFileSync(p, 'utf8').trim()
  return token.length > 0 ? token : null
}

export function saveDeviceToken(dataDir: string, token: string): void {
  const p = path.join(dataDir, TOKEN_FILE)
  fs.writeFileSync(p, token, { mode: 0o600 })
}
