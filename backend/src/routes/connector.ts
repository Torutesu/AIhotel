import { Router, type Router as ExpressRouter } from 'express'
import rateLimit from 'express-rate-limit'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { authenticateDevice } from '../middlewares/deviceAuth.js'
import { validate } from '../middlewares/validate.js'
import {
  pairDeviceSchema,
  heartbeatSchema,
  jobResultSchema,
  jobArtifactSchema,
  definitionsQuerySchema,
  issuePairingCodeSchema,
  createSyncJobSchema,
  writeFreezeSchema,
  listSyncJobsQuerySchema,
} from '../lib/validators.js'
import {
  pairDevice,
  heartbeat,
  claimJob,
  extendLease,
  reportResult,
  uploadArtifact,
  getDefinitions,
  rotateToken,
} from '../controllers/connectorController.js'
import {
  createPairingCode,
  getDevices,
  revokeDeviceHandler,
  getStatus,
  getJobs,
  createJob,
  setFreeze,
} from '../controllers/connectorAdminController.js'

// コネクタ連携ルート（docs/コネクタ連携設計.md §5）。
// デバイス系（エージェントが呼ぶ・デバイストークン認証）と
// 管理系（人が呼ぶ・ユーザーJWT認証）の2系統を持つ。

// ======================================
// デバイス系: /api/v1/connector/*
// ======================================

export const connectorDeviceRouter: ExpressRouter = Router()

// ペアリングはワンタイムコード認証（/auth/login と同様の公開例外）。
// 総当たり対策として厳しめのレート制限を敷く
const pairLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'ペアリング試行の上限に達しました。しばらくしてから再度お試しください。' },
  standardHeaders: true,
  legacyHeaders: false,
})

connectorDeviceRouter.post('/devices/pair', pairLimiter, validate(pairDeviceSchema), pairDevice)

// 以降は全てデバイストークン認証必須
connectorDeviceRouter.post('/heartbeat', authenticateDevice, validate(heartbeatSchema), heartbeat)
connectorDeviceRouter.get('/jobs/next', authenticateDevice, claimJob)
connectorDeviceRouter.post('/jobs/:id/lease', authenticateDevice, extendLease)
connectorDeviceRouter.post('/jobs/:id/result', authenticateDevice, validate(jobResultSchema), reportResult)
connectorDeviceRouter.post('/jobs/:id/artifacts', authenticateDevice, validate(jobArtifactSchema), uploadArtifact)
connectorDeviceRouter.get('/definitions', authenticateDevice, validate(definitionsQuerySchema, 'query'), getDefinitions)
connectorDeviceRouter.post('/devices/rotate-token', authenticateDevice, rotateToken)

// ======================================
// 管理系: /api/v1/connector/hotels/:hotelId/*
// ======================================

export const connectorAdminRouter: ExpressRouter = Router()

connectorAdminRouter.use(authenticate)

connectorAdminRouter.post(
  '/hotels/:hotelId/pairing-codes',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.params.hotelId),
  validate(issuePairingCodeSchema),
  createPairingCode
)

connectorAdminRouter.get(
  '/hotels/:hotelId/devices',
  requireHotelAccess((req) => req.params.hotelId),
  getDevices
)

// デバイス失効（kill switch）はADMIN専用（§5）
connectorAdminRouter.post(
  '/hotels/:hotelId/devices/:deviceId/revoke',
  requireRole('ADMIN'),
  requireHotelAccess((req) => req.params.hotelId),
  revokeDeviceHandler
)

connectorAdminRouter.get(
  '/hotels/:hotelId/status',
  requireHotelAccess((req) => req.params.hotelId),
  getStatus
)

connectorAdminRouter.get(
  '/hotels/:hotelId/jobs',
  requireHotelAccess((req) => req.params.hotelId),
  validate(listSyncJobsQuerySchema, 'query'),
  getJobs
)

connectorAdminRouter.post(
  '/hotels/:hotelId/jobs',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.params.hotelId),
  validate(createSyncJobSchema),
  createJob
)

connectorAdminRouter.post(
  '/hotels/:hotelId/freeze',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.params.hotelId),
  validate(writeFreezeSchema),
  setFreeze
)
