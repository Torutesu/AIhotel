import { Router, type Router as ExpressRouter } from 'express'
import { getHotels, getHotelById } from '../controllers/hotelsController.js'

export const hotelsRouter: ExpressRouter = Router()

// GET /api/v1/hotels
hotelsRouter.get('/', getHotels)

// GET /api/v1/hotels/:id
hotelsRouter.get('/:id', getHotelById)

