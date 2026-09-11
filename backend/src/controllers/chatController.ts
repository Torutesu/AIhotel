import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { sendChatMessageService, listConversationsService, getConversationService, describeChatTools } from '../services/chat/chatService.js'

/** POST /api/v1/chat/messages — 発話を送り、ツール実行込みの応答を得る */
export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, conversationId, content, llmProvider, llmModel } = req.body as {
    hotelId: string
    conversationId?: string
    content: string
    llmProvider?: 'anthropic' | 'openai'
    llmModel?: string
  }
  const reply = await sendChatMessageService({
    hotelId,
    tenantId: req.user!.tenantId ?? '',
    userId: req.user!.userId,
    role: req.user!.role,
    conversationId,
    content,
    llmOverride: { provider: llmProvider, model: llmModel },
  })
  sendSuccess(res, reply)
})

/** GET /api/v1/chat/conversations?hotelId= */
export const listConversations = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  sendSuccess(res, await listConversationsService(hotelId, req.user!.userId, req.user!.role))
})

/** GET /api/v1/chat/conversations/:id?hotelId= */
export const getConversation = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  sendSuccess(res, await getConversationService(req.params.id, hotelId, req.user!.userId, req.user!.role))
})

/** GET /api/v1/chat/tools — このユーザーがチャットから使える操作 */
export const listTools = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, describeChatTools(req.user!.role))
})
