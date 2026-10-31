import type { ProviderId } from '../shared/types'
import { activeBaseUrl, activeModel, activeProvider, readKey } from './store'

export const GOOGLE_FREE = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite'
]

let cache: { at: number; models: string[] } = { at: 0, models: [] }

/** OpenRouter publishes its catalogue publicly; `:free` entries cost nothing. */
export async function openRouterFreeModels(): Promise<string[]> {
  if (Date.now() - cache.at < 10 * 60_000 && cache.models.length) return cache.models
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal: controller.signal })
    if (!res.ok) return cache.models
    const json: any = await res.json()
    const models = (json?.data ?? [])
      .map((m: any) => String(m.id ?? ''))
      .filter((id: string) => id.endsWith(':free'))
      .sort()
    if (models.length) cache = { at: Date.now(), models }
    return models
  } catch {
    return cache.models
  } finally {
    clearTimeout(timer)
  }
}

export interface Candidate {
  provider: ProviderId
  model: string
  apiKey: string
  baseUrl: string
}

/**
 * Ordered list of models to try. In free mode only zero-cost models are used;
 * on a rate/credit limit the caller advances to the next entry.
 */
export async function buildCandidates(freeMode: boolean): Promise<Candidate[]> {
  if (!freeMode) {
    const provider = activeProvider()
    const key = readKey(provider)
    return key ? [{ provider, model: activeModel(provider), apiKey: key, baseUrl: activeBaseUrl(provider) }] : []
  }

  const list: Candidate[] = []

  const openRouterKey = readKey('openrouter')
  if (openRouterKey) {
    const models = await openRouterFreeModels()
    for (const model of models.slice(0, 8)) {
      list.push({
        provider: 'openrouter',
        model,
        apiKey: openRouterKey,
        baseUrl: activeBaseUrl('openrouter')
      })
    }
  }

  const googleKey = readKey('google')
  if (googleKey) {
    for (const model of GOOGLE_FREE) {
      list.push({ provider: 'google', model, apiKey: googleKey, baseUrl: activeBaseUrl('google') })
    }
  }

  return list
}
