import { Router, type Router as ExpressRouter } from 'express'
import { getAnalysisData, getCrossAnalysisSettings } from '../controllers/analysisController.js'

export const analysisRouter: ExpressRouter = Router()

// GET /api/v1/analysis
analysisRouter.get('/', getAnalysisData)

// GET /api/v1/analysis/cross-settings
analysisRouter.get('/cross-settings', getCrossAnalysisSettings)

