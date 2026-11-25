import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { usageEventSchema } from '../lib/validators.js'
import { recordUsage } from '../controllers/usageController.js'
export const usageRouter: ExpressRouter = Router()
// Personal activity telemetry, available to every hotel role; no business data mutation.
usageRouter.post('/', authenticate, validate(usageEventSchema), requireHotelAccess(req => req.body?.hotelId), recordUsage)
