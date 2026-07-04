import { Request, Response } from 'express'
import type { ApiResponse } from '@hotel-revenue-system/shared/types'

export const notFoundHandler = (req: Request, res: Response) => {
  const response: ApiResponse<never> = {
    success: false,
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  }
  
  res.status(404).json(response)
}

