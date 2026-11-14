import { localTimeZone, localToday, type Task } from './tasks'

export type ApiChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatHandlers = {
  onChunk: (chunk: string) => void
  onTasks?: (tasks: Task[]) => void
}

function resolveApiBase(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host.endsWith('vercel.app') || host === 'localhost' || host === '127.0.0.1') return ''
  }
  return (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')
}

const apiBaseUrl = resolveApiBase()

type StreamEvent =
  | { type: 'text'; delta?: string }
  | { type: 'snapshot'; tasks?: Task[] }

function parseEvent(line: string): StreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as StreamEvent
  } catch {
    return { type: 'text', delta: trimmed }
  }
}

export async function sendChatMessage(
  messages: ApiChatMessage[],
  onChunkOrHandlers: ((chunk: string) => void) | ChatHandlers,
  signal?: AbortSignal,
  extras: { tasks?: Task[]; concise?: boolean } = {},
): Promise<string> {
  const handlers: ChatHandlers = typeof onChunkOrHandlers === 'function'
    ? { onChunk: onChunkOrHandlers }
    : onChunkOrHandlers

  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        tasks: extras.tasks ?? [],
        context: {
          today: localToday(),
          timeZone: localTimeZone(),
          concise: extras.concise ?? false,
        },
      }),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Unable to connect to the AI server.')
  }

  if (!response.ok) {
    let message = 'Something went wrong. Please try again.'

    try {
      const errorBody = await response.json() as { error?: string }
      if (typeof errorBody.error === 'string' && errorBody.error.trim()) {
        message = errorBody.error
      }
    } catch {
      message = response.status === 0 ? 'Unable to connect to the AI server.' : 'Something went wrong. Please try again.'
    }

    throw new Error(message)
  }

  if (!response.body) {
    throw new Error('Unable to connect to the AI server.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''

  const consume = (chunk: string, emitPartialText: boolean) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const event = parseEvent(line)
      if (!event) continue
      if (event.type === 'snapshot' && Array.isArray(event.tasks)) {
        handlers.onTasks?.(event.tasks)
        continue
      }
      if (event.type === 'text' && event.delta) {
        fullText += event.delta
        handlers.onChunk(event.delta)
      }
    }

    if (emitPartialText && buffer && !buffer.includes('{')) {
      fullText += buffer
      handlers.onChunk(buffer)
      buffer = ''
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      consume(decoder.decode(), true)
      break
    }
    consume(decoder.decode(value, { stream: true }), false)
  }

  if (!fullText.trim()) {
    throw new Error('The AI service returned an empty response.')
  }

  return fullText
}
