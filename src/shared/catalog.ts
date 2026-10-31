import type { ProviderId } from './types'

export interface ModelEntry {
  id: string
  label: string
}

/**
 * Curated catalogue shown before (and alongside) the provider's live /models list.
 * Newest first. IDs are the exact strings sent to the API.
 */
export const MODELS: Record<ProviderId, ModelEntry[]> = {
  anthropic: [
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    { id: 'claude-fable-5', label: 'Claude Fable 5' },
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (deprecated)' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }
  ],
  deepseek: [
    { id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (alias)' },
    { id: 'deepseek-chat', label: 'DeepSeek Chat (legacy)' },
    { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner (legacy)' }
  ],
  google: [
    { id: 'gemini-4-argon', label: 'Gemini 4 Argon' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
    { id: 'gemini-omni-1.1-flash', label: 'Gemini Omni Flash' }
  ],
  openrouter: [
    { id: 'deepseek/deepseek-chat-v3.1:free', label: 'DeepSeek Chat (free)' },
    { id: 'google/gemini-2.0-flash-exp:free', label: 'Gemini 2.0 Flash (free)' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (free)' },
    { id: 'qwen/qwen3-235b-a22b:free', label: 'Qwen3 235B (free)' },
    { id: 'mistralai/mistral-small-3.2-24b-instruct:free', label: 'Mistral Small 3.2 (free)' }
  ]
}

export function labelFor(provider: ProviderId, id: string): string {
  const entry = MODELS[provider].find((m) => m.id === id)
  return entry ? `${entry.label} — ${entry.id}` : id
}
