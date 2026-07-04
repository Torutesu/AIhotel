import { Router, type Router as ExpressRouter } from 'express'
import { getPricingData, updatePricing } from '../controllers/pricingController.js'

export const pricingRouter: ExpressRouter = Router()

// GET /api/v1/pricing
pricingRouter.get('/', getPricingData)

// POST /api/v1/pricing
pricingRouter.post('/', updatePricing)

// GET /api/v1/pricing/:date
pricingRouter.get('/:date', getPricingData)

