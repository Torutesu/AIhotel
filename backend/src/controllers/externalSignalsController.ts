import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { getDemandIndexService, getExternalSignalsStatusService } from '../services/externalSignals/demandIndex.js'
import { getExternalFactorsService } from '../services/externalSignals/factorsService.js'

// 外部要因（D-13）。参照のみ（取得は job external-signals）

/** GET /api/v1/external-signals/demand-index?hotelId=&months= */
export const getDemandIndex = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, months } = req.query as unknown as { hotelId: string; months: number }
  sendSuccess(res, await getDemandIndexService(hotelId, months))
})

/** GET /api/v1/external-signals/status?hotelId= */
export const getExternalSignalsStatus = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  sendSuccess(res, await getExternalSignalsStatusService(hotelId))
})

/** GET /api/v1/external-signals/factors?hotelId= — 要因カード（気候・インバウンド・アクセス）と週別の見通し */
export const getExternalFactors = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  sendSuccess(res, await getExternalFactorsService(hotelId))
})
