import { Router, type Router as ExpressRouter } from 'express'
import { authenticate } from '../middlewares/auth.js'
import { getAnalysisData, getCrossAnalysisSettings } from '../controllers/analysisController.js'

export const analysisRouter: ExpressRouter = Router()

// 全エンドポイント認証必須（C-2）
analysisRouter.use(authenticate)

// GET /api/v1/analysis
analysisRouter.get('/', getAnalysisData)

// GET /api/v1/analysis/cross-settings
analysisRouter.get('/cross-settings', getCrossAnalysisSettings)

