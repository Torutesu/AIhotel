import { Request, Response } from 'express'
import { getHotelsService, getHotelByIdService } from '../services/hotelsService.js'
import type { ApiResponse } from '@hotel-revenue-system/shared/types'

export const getHotels = async (_req: Request, res: Response) => {
  try {
    const hotels = await getHotelsService()
    const response: ApiResponse<typeof hotels> = {
      success: true,
      data: hotels,
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

export const getHotelById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const hotel = await getHotelByIdService(id)
    
    if (!hotel) {
      const response: ApiResponse<never> = {
        success: false,
        error: 'Hotel not found',
      }
      return res.status(404).json(response)
    }

    const response: ApiResponse<typeof hotel> = {
      success: true,
      data: hotel,
    }
    return res.json(response)
  } catch (error) {
    const response: ApiResponse<never> = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
    return res.status(500).json(response)
  }
}

