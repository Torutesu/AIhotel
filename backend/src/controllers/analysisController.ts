import { Request, Response } from 'express'
import { getAnalysisDataService, getCrossAnalysisSettingsService } from '../services/analysisService.js'
import type { ApiResponse } from '@hotel-revenue-system/shared/types'

export const getAnalysisData = async (req: Request, res: Response) => {
  try {
    const { period, type } = req.query
    const analysisData = await getAnalysisDataService(
      period as string | undefined,
      type as string | undefined
    )
    const response: ApiResponse<typeof analysisData> = {
      success: true,
      data: analysisData,
    }
    res.json(response)
  } catch (error) {
    const response: ApiResponse<never> = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
    res.status(500).json(response)
  }
}

export const getCrossAnalysisSettings = async (_req: Request, res: Response) => {
  try {
    const settings = await getCrossAnalysisSettingsService()
    const response: ApiResponse<typeof settings> = {
      success: true,
      data: settings,
    }
    res.json(response)
  } catch (error) {
    const response: ApiResponse<never> = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
    res.status(500).json(response)
  }
}

