import { existsSync } from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'

if (!process.env.VERCEL) {
  const candidates = [
    path.resolve(process.cwd(), 'backend/.env'),
    path.resolve(process.cwd(), '.env'),
  ]
  for (const file of candidates) {
    if (existsSync(file)) dotenv.config({ path: file, override: false })
  }
}

dotenv.config({ override: false })

const defaultAiModel = 'gemini-3.8-flash'
const legacyAiModel = 'gemini-2.5-flash'

function normalizeAiModel(value: string | undefined): string {
  const compact = value?.trim().replace(/^models\//i, '').toLowerCase().replace(/\s+/g, '-') ?? ''
  if (!compact) return defaultAiModel
  if (compact === legacyAiModel || compact === 'gemini-2.0-flash' || compact === 'gemini-2.5-flash-lite') {
    console.warn(`AI_MODEL=${compact} is no longer the default; switching to ${defaultAiModel}.`)
    return defaultAiModel
  }
  return compact
}

function readApiKey(): string {
  return process.env.AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || ''
}

type EnvConfig = {
  port: number
  frontendUrl: string
  aiApiKey: string
  aiModel: string
}

const portValue = Number(process.env.PORT ?? '3001')

export const env: EnvConfig = {
  port: Number.isFinite(portValue) && portValue > 0 ? portValue : 3001,
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  aiApiKey: readApiKey(),
  aiModel: normalizeAiModel(process.env.AI_MODEL),
}
