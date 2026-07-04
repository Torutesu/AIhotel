import { Request, Response } from 'express'
import { getPricingDataService, updatePricingService } from '../services/pricingService.js'
import type { ApiResponse, PriceData } from '@hotel-revenue-system/shared/types'

export const getPricingData = async (req: Request, res: Response) => {
  try {
    const { date } = req.params
    const pricingData = await getPricingDataService(date)
    const response: ApiResponse<typeof pricingData> = {
      success: true,
      data: pricingData,
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

export const updatePricing = async (req: Request, res: Response) => {
  try {
    const pricingData: PriceData = req.body
    const updated = await updatePricingService(pricingData)
    const response: ApiResponse<typeof updated> = {
      success: true,
      data: updated,
      message: 'Pricing updated successfully',
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

