import type { ModelLevel, ProviderId, Usage } from '../shared/types'

/**
 * USD per 1M tokens. Estimates only: providers change prices and aliases often,
 * so these are deliberately coarse and matched by longest-prefix-first order.
 */
const PRICES: Array<{ prefix: string; input: number; output: number }> = [
  // Anthropic (specific variants first — matching is startsWith)
  { prefix: 'claude-fable-5-1', input: 10, output: 50 },
  { prefix: 'claude-fable-5', input: 10, output: 50 },
  { prefix: 'claude-mythos-5-1', input: 10, output: 50 },
  { prefix: 'claude-opus-5-5', input: 4, output: 20 },
  { prefix: 'claude-opus-5', input: 5, output: 25 },
  { prefix: 'claude-opus-4-8', input: 5, output: 25 },
  { prefix: 'claude-opus-4-7', input: 5, output: 25 },
  { prefix: 'claude-opus-4-6', input: 5, output: 25 },
  { prefix: 'claude-opus-4-5', input: 5, output: 25 },
  { prefix: 'claude-opus-4', input: 15, output: 75 },
  { prefix: 'claude-sonnet-5-5', input: 2, output: 10 },
  { prefix: 'claude-sonnet-5', input: 3, output: 15 },
  { prefix: 'claude-sonnet-4', input: 3, output: 15 },
  { prefix: 'claude-haiku-5-5', input: 0.1, output: 0.5 },
  { prefix: 'claude-haiku-4-5', input: 1, output: 5 },
  { prefix: 'claude-haiku-4', input: 1, output: 5 },
  // DeepSeek (peak cache-miss rates; off-peak is roughly half)
  { prefix: 'deepseek-v4-pro', input: 1.32, output: 3.96 },
  { prefix: 'deepseek-flash', input: 0.3, output: 1.2 },
  { prefix: 'deepseek-v4-flash', input: 0.3, output: 1.2 },
  { prefix: 'deepseek-chat', input: 0.28, output: 0.42 },
  { prefix: 'deepseek-reasoner', input: 0.28, output: 0.42 },
  // Google
  { prefix: 'gemini-4-argon', input: 2, output: 10 },
  { prefix: 'gemini-3.8-flash', input: 0.75, output: 3.75 },
  { prefix: 'gemini-3.7-flash', input: 0.75, output: 3.75 },
  { prefix: 'gemini-3.6-flash', input: 0.75, output: 3.75 },
  { prefix: 'gemini-3.5-flash-lite', input: 0.3, output: 2.5 },
  { prefix: 'gemini-3.5-flash', input: 1.5, output: 9 },
  { prefix: 'gemini-3.1-flash-lite', input: 0.25, output: 1.5 },
  { prefix: 'gemini-3.1-pro', input: 2, output: 12 },
  { prefix: 'gemini-3-pro', input: 2, output: 12 },
  { prefix: 'gemini-3', input: 0.5, output: 3 },
  { prefix: 'gemini-2.5-pro', input: 1.25, output: 10 },
  { prefix: 'gemini-2.5-flash-lite', input: 0.1, output: 0.4 },
  { prefix: 'gemini-2.5-flash', input: 0.3, output: 2.5 },
  { prefix: 'gemini-2.0-flash', input: 0.1, output: 0.4 },
  { prefix: 'gemini-omni', input: 1.5, output: 9 },
  // OpenAI-compatible leftovers
  { prefix: 'gpt-5', input: 1.25, output: 10 },
  { prefix: 'gpt-4.1', input: 2, output: 8 }
]

export function priceFor(model: string): { input: number; output: number } | null {
  const m = model.toLowerCase()
  const row = PRICES.find((p) => m.startsWith(p.prefix))
  return row ? { input: row.input, output: row.output } : null
}

export function costOf(model: string, usage: Usage): number {
  if (model.includes(':free')) return 0
  const price = priceFor(model)
  if (!price) return 0
  return (usage.inputTokens / 1e6) * price.input + (usage.outputTokens / 1e6) * price.output
}

export interface LevelPlan {
  maxTokens: number
  /** Anthropic extended-thinking budget (4.5 and older only). */
  thinkingBudget?: number
  /** Anthropic `output_config.effort` (4.6 and newer). */
  effort?: 'low' | 'medium' | 'high'
  /** Gemini 3 / 4 thinking level. */
  thinkingLevel?: 'low' | 'medium' | 'high'
  /** Gemini 2.5 thinking budget. */
  geminiBudget?: number
  /** OpenAI-compatible reasoning effort. */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
}

/** Claude 4.6+ and 5.x run adaptive thinking and reject manual budgets. */
function isAdaptiveClaude(model: string): boolean {
  const match = /claude-[a-z]+-(\d+)(?:-(\d+))?/.exec(model.toLowerCase())
  if (!match) return false
  const major = Number(match[1])
  const minor = match[2] ? Number(match[2]) : 0
  return major >= 5 || (major === 4 && minor >= 6)
}

/**
 * One knob the user understands ("Fast ... Max") mapped to each provider's
 * native quality/budget controls.
 */
export function planFor(provider: ProviderId, model: string, level: ModelLevel): LevelPlan {
  if (provider === 'anthropic') {
    const adaptive = isAdaptiveClaude(model)
    if (adaptive) {
      // effort is the documented lever; max_tokens is a hard cap on thinking + text.
      switch (level) {
        case 'fast':
          return { maxTokens: 4096, effort: 'low' }
        case 'default':
          return { maxTokens: 8192, effort: 'medium' }
        case 'high':
          return { maxTokens: 16000, effort: 'high' }
        case 'max':
          return { maxTokens: 32000, effort: 'high' }
      }
    }
    switch (level) {
      case 'fast':
        return { maxTokens: 2048 }
      case 'default':
        return { maxTokens: 4096 }
      case 'high':
        return { maxTokens: 8192, thinkingBudget: 4096 }
      case 'max':
        return { maxTokens: 16000, thinkingBudget: 12000 }
    }
  }

  if (provider === 'google') {
    const modern = /gemini-(3|4)/.test(model)
    const lite = /lite/i.test(model)
    if (modern) {
      switch (level) {
        case 'fast':
          return { maxTokens: 4096, thinkingLevel: 'low' }
        case 'default':
          return { maxTokens: 8192, thinkingLevel: 'medium' }
        case 'high':
          return { maxTokens: 16384, thinkingLevel: 'high' }
        case 'max':
          return { maxTokens: 32768, thinkingLevel: 'high' }
      }
    }
    switch (level) {
      case 'fast':
        return { maxTokens: 2048, geminiBudget: 0 }
      case 'default':
        return { maxTokens: 4096, geminiBudget: 1024 }
      case 'high':
        return { maxTokens: 8192, geminiBudget: 8192 }
      case 'max':
        return { maxTokens: 16384, geminiBudget: lite ? 8192 : 24576 }
    }
  }

  // OpenAI-compatible (DeepSeek, OpenAI)
  const effortCapable = /^(o\d|gpt-5|gpt-4\.1|gpt-4o)/i.test(model)
  const reasoningEffort = ({ fast: 'minimal', default: 'low', high: 'medium', max: 'high' } as const)[level]
  const maxTokens = { fast: 2048, default: 4096, high: 8192, max: 16384 }[level]
  return { maxTokens, reasoningEffort: effortCapable ? reasoningEffort : undefined }
}
