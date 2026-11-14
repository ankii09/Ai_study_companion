import { Router } from 'express'
import { env } from '../config/env.js'

export const healthRouter = Router()

healthRouter.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'ai-backend',
    aiConfigured: Boolean(env.aiApiKey),
  })
})
