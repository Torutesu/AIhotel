import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import type { ChatInput } from '../lib/validators.js'
import { answerChatService } from '../services/aiChat.js'

/**
 * AI チャット（D-13）
 * POST /api/v1/chat  { hotelId, messages: [{ role, content }] }
 */
export const postChat = asyncHandler(async (req: Request, res: Response) => {
  const { reply } = await answerChatService(req.body as ChatInput)
  sendSuccess(res, { reply })
})
