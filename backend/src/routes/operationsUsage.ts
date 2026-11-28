import { Router, type Router as ExpressRouter } from 'express'
import { authenticate } from '../middlewares/operationsUsageAuth.js'
import { validate } from '../middlewares/validate.js'
import { operationsUsageScopeSchema } from '../lib/validators.js'
import { getOperationsUsage, getProductionUsageTenants } from '../controllers/usageController.js'
export const operationsUsageRouter: ExpressRouter = Router()
operationsUsageRouter.use(authenticate, validate(operationsUsageScopeSchema))
operationsUsageRouter.post('/report', getOperationsUsage)
operationsUsageRouter.post('/tenants', getProductionUsageTenants)
