import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { MAX_REQUEST_BYTES, chatRequestSchema } from './schema.js'

export { chatRequestSchema } from './schema.js'
export type { ParsedChatRequest } from './schema.js'

export function validateChatRequest(req: Request, res: Response, next: NextFunction) {
  const contentLength = Number(req.headers['content-length'] ?? 0)
  if (contentLength > MAX_REQUEST_BYTES) {
    return res.status(413).json({ error: 'Request body is too large.' })
  }

  try {
    req.body = chatRequestSchema.parse(req.body)
    next()
  } catch (error) {
    if (error instanceof ZodError) {
      const firstIssue = error.issues[0]
      return res.status(400).json({
        error: firstIssue?.message ?? 'Invalid request payload.',
      })
    }

    return res.status(500).json({ error: 'Something went wrong while validating the request.' })
  }
}
