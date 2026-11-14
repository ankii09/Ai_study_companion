import { GoogleGenAI, ThinkingLevel, Type, type FunctionDeclaration } from '@google/genai'
import { env } from '../config/env.js'
import type { ChatMessage } from '../types/chat.js'
import type { ChatContext, Task } from '../types/tasks.js'
import { applyTaskTool, formatTaskSnapshot } from './task-engine.js'

export const DEFAULT_SYSTEM_PROMPT = `You are My AI, a helpful personal assistant with a real task manager.
Give clear, accurate, useful answers in complete sentences.
If you are uncertain, say so. Do not invent facts.
Do not reply with a single word unless the user clearly asked for that.
Be concise unless the user requests more detail.

Task manager rules:
- The user has a live task list. When they ask to add, change, complete, reopen, delete, or review tasks, you MUST use the task tools. Never claim you changed a task without a successful tool result.
- Use the exact task ids from the snapshot. Do not invent ids.
- If more than one task could match, ask a clarifying question instead of guessing.
- Convert relative dates such as today, tomorrow, or Friday into YYYY-MM-DD using the provided local date.
- After tools run, confirm only the changes that actually succeeded.`

export type ChatStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'snapshot'; tasks: Task[] }

export class AiServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 502) {
    super(message)
    this.name = 'AiServiceError'
    this.statusCode = statusCode
  }
}

function getTemporaryProviderStatus(error: unknown): number {
  if (typeof error === 'object' && error !== null) {
    if ('statusCode' in error) {
      const statusCode = error.statusCode
      if (statusCode === 429 || statusCode === 503 || statusCode === 504) return statusCode
    }
    if ('status' in error) {
      const status = error.status
      if (status === 429 || status === 503 || status === 504) return status
    }
    if ('lastError' in error) return getTemporaryProviderStatus(error.lastError)
  }

  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === 'service_unavailable' || error.code === 'overloaded') return 503
    if (error.code === 'rate_limit_exceeded' || error.code === 'RESOURCE_EXHAUSTED') return 429
  }

  return 0
}

type GeminiContent = {
  role: 'user' | 'model'
  parts: Array<Record<string, unknown>>
}

function toGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = []

  for (const message of messages) {
    if (message.role === 'system') continue
    const role = message.role === 'assistant' ? 'model' : 'user'
    const last = contents[contents.length - 1]
    if (last?.role === role) {
      const firstPart = last.parts[0]
      if (firstPart && typeof firstPart.text === 'string') {
        firstPart.text += `\n\n${message.content}`
      } else {
        last.parts.push({ text: message.content })
      }
    } else {
      contents.push({ role, parts: [{ text: message.content }] })
    }
  }

  if (contents[0]?.role === 'model') {
    contents.unshift({ role: 'user', parts: [{ text: 'Hello' }] })
  }

  return contents
}

function extractText(response: unknown): string {
  if (typeof response !== 'object' || response === null) return ''
  const candidate = (response as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>
  }).candidates?.[0]?.content?.parts

  if (Array.isArray(candidate)) {
    return candidate
      .filter((part) => !part.thought && typeof part.text === 'string')
      .map((part) => part.text ?? '')
      .join('')
  }

  const text = (response as { text?: unknown }).text
  return typeof text === 'string' ? text : ''
}

function extractChunkText(chunk: unknown): string {
  const fromParts = extractText(chunk)
  if (fromParts) return fromParts
  if (typeof chunk === 'object' && chunk !== null && 'text' in chunk) {
    const text = (chunk as { text?: unknown }).text
    if (typeof text === 'string') return text
  }
  return ''
}

function mergeFunctionCalls(current: FunctionCall[], incoming: FunctionCall[]): FunctionCall[] {
  const next = [...current]
  for (const call of incoming) {
    const key = `${call.name ?? ''}:${JSON.stringify(call.args ?? {})}:${call.id ?? ''}`
    const exists = next.some((item) => `${item.name ?? ''}:${JSON.stringify(item.args ?? {})}:${item.id ?? ''}` === key)
    if (!exists) next.push(call)
  }
  return next
}

function generationConfig(systemPrompt: string, abortSignal?: AbortSignal, withTools = false) {
  return {
    systemInstruction: systemPrompt,
    maxOutputTokens: 8192,
    temperature: 0.7,
    thinkingConfig: {
      thinkingLevel: 'minimal',
    },
    ...(withTools ? { tools: [{ functionDeclarations: taskToolDeclarations }] } : {}),
    ...(abortSignal ? { abortSignal } : {}),
  }
}

const taskToolDeclarations: FunctionDeclaration[] = [
  {
    name: 'create_task',
    description: 'Create a new task in the user task list.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Short task title' },
        notes: { type: Type.STRING, description: 'Optional details' },
        dueDate: { type: Type.STRING, description: 'Due date as YYYY-MM-DD, or empty' },
        priority: { type: Type.STRING, description: 'low, medium, or high' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'Update an existing task. Identify it by id when possible.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: 'Existing task id' },
        title: { type: Type.STRING, description: 'Current title, used to find the task if id is missing' },
        newTitle: { type: Type.STRING, description: 'Replacement title' },
        notes: { type: Type.STRING, description: 'Replacement notes' },
        dueDate: { type: Type.STRING, description: 'YYYY-MM-DD, or none to clear' },
        priority: { type: Type.STRING, description: 'low, medium, or high' },
        status: { type: Type.STRING, description: 'todo, in_progress, or done' },
      },
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as done.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        title: { type: Type.STRING },
      },
    },
  },
  {
    name: 'reopen_task',
    description: 'Mark a completed task as todo again.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        title: { type: Type.STRING },
      },
    },
  },
  {
    name: 'delete_task',
    description: 'Permanently delete a task.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        title: { type: Type.STRING },
      },
    },
  },
  {
    name: 'list_tasks',
    description: 'Read the current task list, optionally filtered.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        status: { type: Type.STRING, description: 'todo, in_progress, or done' },
        dueDate: { type: Type.STRING, description: 'YYYY-MM-DD' },
      },
    },
  },
]

function weekdayName(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return ''
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}

function buildSystemPrompt(context?: ChatContext, tasks: Task[] = []): string {
  const lines = [DEFAULT_SYSTEM_PROMPT]
  if (context?.concise) {
    lines.push('The user prefers shorter, direct answers.')
  }
  if (context?.today) {
    lines.push(`Local date for the user: ${context.today} (${weekdayName(context.today)}). Time zone: ${context.timeZone || 'unknown'}.`)
  }
  lines.push(`Current tasks:\n${formatTaskSnapshot(tasks)}`)
  return lines.join('\n\n')
}

let googleClient: GoogleGenAI | null = null
let googleClientKey = ''

function getGoogleClient(): GoogleGenAI {
  if (!googleClient || googleClientKey !== env.aiApiKey) {
    googleClient = new GoogleGenAI({ apiKey: env.aiApiKey })
    googleClientKey = env.aiApiKey
  }
  return googleClient
}

type FunctionCall = {
  name?: string
  args?: Record<string, unknown>
  id?: string
}

function getFunctionCalls(response: unknown): FunctionCall[] {
  if (typeof response !== 'object' || response === null) return []
  const direct = (response as { functionCalls?: FunctionCall[] }).functionCalls
  if (Array.isArray(direct) && direct.length > 0) return direct

  const parts = (response as {
    candidates?: Array<{ content?: { parts?: Array<{ functionCall?: FunctionCall }> } }>
  }).candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return []
  return parts.map((part) => part.functionCall).filter((call): call is FunctionCall => Boolean(call?.name))
}

function getModelParts(response: unknown): Array<Record<string, unknown>> | null {
  const parts = (response as {
    candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>
  }).candidates?.[0]?.content?.parts
  return Array.isArray(parts) && parts.length > 0 ? parts : null
}

function modelCandidates(): string[] {
  const extras = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest']
  return [env.aiModel, ...extras.filter((model) => model !== env.aiModel)]
}

function isInvalidModelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /not found|invalid model|unknown model|does not exist|not supported/i.test(message)
}

function isThinkingConfigError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /thinking[_ ]?(config|level|budget)/i.test(message)
}

type GenerateArgs = {
  contents: GeminiContent[]
  systemPrompt: string
  abortSignal?: AbortSignal
}

async function openChatStream(args: GenerateArgs, model: string) {
  const client = getGoogleClient()

  for (const withThinking of [true, false]) {
    try {
      return await client.models.generateContentStream({
        model,
        contents: args.contents,
        config: {
          systemInstruction: args.systemPrompt,
          maxOutputTokens: 2048,
          temperature: 0.7,
          tools: [{ functionDeclarations: taskToolDeclarations }],
          ...(withThinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } } : {}),
          ...(args.abortSignal ? { abortSignal: args.abortSignal } : {}),
        },
      })
    } catch (error) {
      if (withThinking && isThinkingConfigError(error)) continue
      throw error
    }
  }

  throw new Error('Gemini request failed.')
}

async function* streamWithModelFallback(args: GenerateArgs): AsyncGenerator<unknown> {
  let lastError: unknown

  for (const model of modelCandidates()) {
    let receivedChunk = false
    try {
      const stream = await openChatStream(args, model)
      for await (const chunk of stream) {
        receivedChunk = true
        yield chunk
      }
      return
    } catch (error) {
      lastError = error
      if (receivedChunk || (!isInvalidModelError(error) && getTemporaryProviderStatus(error) !== 503)) {
        throw error
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Gemini request failed.')
}

export async function* generateChatResponse(
  messages: ChatMessage[],
  abortSignal?: AbortSignal,
  options: { tasks?: Task[]; context?: ChatContext } = {},
): AsyncGenerator<ChatStreamEvent> {
  if (!env.aiApiKey) {
    throw new AiServiceError('AI_API_KEY is missing. Add it in Vercel Environment Variables (or backend/.env locally).', 500)
  }

  const extraSystem = messages.filter((message) => message.role === 'system').map((message) => message.content)
  let tasks = [...(options.tasks ?? [])]
  const originalJson = JSON.stringify(tasks)
  const systemPrompt = [buildSystemPrompt(options.context, tasks), ...extraSystem].filter(Boolean).join('\n\n')
  const contents = toGeminiContents(messages)

  if (contents.length === 0) {
    throw new AiServiceError('Send at least one user message.', 400)
  }

  try {
    let rounds = 0
    let streamedText = false

    while (rounds < 6) {
      if (abortSignal?.aborted) return
      rounds += 1

      const stream = streamWithModelFallback({ contents, systemPrompt, abortSignal })
      let functionCalls: FunctionCall[] = []
      let modelParts: Array<Record<string, unknown>> | null = null
      let mode: 'unknown' | 'tools' | 'text' = 'unknown'

      for await (const chunk of stream) {
        if (abortSignal?.aborted) return
        const calls = getFunctionCalls(chunk)
        if (calls.length > 0) {
          mode = 'tools'
          functionCalls = calls
        }
        const parts = getModelParts(chunk)
        if (parts) modelParts = parts
        if (mode === 'tools') continue
        const text = extractChunkText(chunk)
        if (!text) continue
        mode = 'text'
        streamedText = true
        yield { type: 'text', delta: text }
      }

      if (functionCalls.length > 0) {
        contents.push({
          role: 'model',
          parts: modelParts ?? functionCalls.map((call) => ({ functionCall: call })),
        })
        contents.push({
          role: 'user',
          parts: functionCalls.map((call) => {
            const applied = applyTaskTool(tasks, call.name ?? '', call.args ?? {})
            tasks = applied.tasks
            return {
              functionResponse: {
                name: call.name,
                id: call.id,
                response: applied.result,
              },
            }
          }),
        })
        continue
      }

      break
    }

    if (abortSignal?.aborted) return
    if (!streamedText) {
      throw new AiServiceError('The AI service returned an empty response. Please try again.', 502)
    }

    if (JSON.stringify(tasks) !== originalJson) {
      yield { type: 'snapshot', tasks }
    }
  } catch (error) {
    if (error instanceof AiServiceError) throw error
    if (abortSignal?.aborted) return

    const providerStatus = getTemporaryProviderStatus(error)
    if (providerStatus === 429) {
      throw new AiServiceError('Gemini API rate limit or quota reached. Wait a little and try again, or check your Google AI Studio quota.', 429)
    }
    if (providerStatus === 503 || providerStatus === 504) {
      throw new AiServiceError('Gemini is temporarily busy. Please try again shortly.', providerStatus)
    }
    if (error instanceof Error && /timeout|aborted|abort/i.test(error.message)) {
      throw new AiServiceError('Gemini took too long to respond. Please try again.', 504)
    }

    const detail = error instanceof Error ? error.message : 'Unknown AI provider error'
    throw new AiServiceError(`Gemini rejected the request. Check AI_API_KEY and AI_MODEL (${env.aiModel}). ${detail}`, 400)
  }
}
