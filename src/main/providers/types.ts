import type { ModelLevel, ProviderId, Usage, WireMessage } from '../../shared/types'
import type { ToolDef } from '../tools'

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; call: ToolCall }
  | { type: 'usage'; usage: Usage }
  | { type: 'done'; stopReason: string }

export interface StreamRequest {
  provider: ProviderId
  model: string
  apiKey: string
  baseUrl: string
  level: ModelLevel
  system: string
  messages: WireMessage[]
  tools: ToolDef[]
  signal: AbortSignal
  maxTokens?: number
}

export type StreamFn = (req: StreamRequest) => AsyncGenerator<StreamEvent>

export async function* readSse(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new Error('provider returned an empty body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const data = raw
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
        if (data && data !== '[DONE]') yield data
      }
    }
  } finally {
    reader.cancel().catch(() => undefined)
  }
}

export class ProviderError extends Error {
  status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
  }
}

export async function assertOk(res: Response, provider: string): Promise<void> {
  if (res.ok) return
  let detail = ''
  try {
    detail = await res.text()
  } catch {
    /* ignore */
  }
  let message = detail.slice(0, 800)
  try {
    const parsed = JSON.parse(detail)
    const err = parsed?.error
    if (err) message = typeof err === 'string' ? err : err.message || JSON.stringify(err).slice(0, 500)
  } catch {
    /* keep raw text */
  }
  throw new ProviderError(`${provider} ${res.status}: ${message || res.statusText}`, res.status)
}
