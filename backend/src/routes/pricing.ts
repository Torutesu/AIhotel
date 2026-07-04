import { Router, type Router as ExpressRouter } from 'express'
import { authenticate } from '../middlewares/auth.js'
import { getPricingData, updatePricing } from '../controllers/pricingController.js'

export const pricingRouter: ExpressRouter = Router()

// 全エンドポイント認証必須（C-2）
pricingRouter.use(authenticate)

// GET /api/v1/pricing
pricingRouter.get('/', getPricingData)

// POST /api/v1/pricing
pricingRouter.post('/', updatePricing)

// GET /api/v1/pricing/:date
pricingRouter.get('/:date', getPricingData)

