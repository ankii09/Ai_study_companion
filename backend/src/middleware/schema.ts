import { z } from 'zod'

const MAX_MESSAGES = 30
const MAX_MESSAGE_LENGTH = 4000

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
})

const taskSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  notes: z.string().max(500).optional().default(''),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().default(null),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  status: z.enum(['todo', 'in_progress', 'done']).default('todo'),
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
})

const contextSchema = z.object({
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeZone: z.string().min(1).max(80),
  concise: z.boolean().optional(),
})

export const MAX_REQUEST_BYTES = 1024 * 1024

export const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(MAX_MESSAGES),
  tasks: z.array(taskSchema).max(100).optional().default([]),
  context: contextSchema.optional(),
}).strict()

export type ParsedChatRequest = z.infer<typeof chatRequestSchema>
