import type { ProviderId, ToolCallRecord, ToolStatus, Usage } from '../../shared/types'

export interface ViewTool extends ToolCallRecord {
  status: ToolStatus
}

export interface ViewAttachment {
  name: string
  size: number
  kind: 'image' | 'text'
}

export interface ViewMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools: ViewTool[]
  attachments?: ViewAttachment[]
  usage?: Usage
  costUsd?: number
  model?: string
}

export interface PendingAttachment {
  id: string
  name: string
  mime: string
  size: number
  kind: 'image' | 'text'
  data: string
}

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: 'Claude',
  deepseek: 'DeepSeek',
  google: 'Gemini',
  openrouter: 'OpenRouter'
}
