export type ProviderId = 'anthropic' | 'deepseek' | 'google' | 'openrouter'

export type ModelLevel = 'fast' | 'default' | 'high' | 'max'

export interface Usage {
  inputTokens: number
  outputTokens: number
}

export interface ToolCallRecord {
  id: string
  name: string
  input: Record<string, unknown>
  output?: string
  isError?: boolean
}

export interface Attachment {
  id: string
  name: string
  mime: string
  kind: 'image' | 'text'
  size: number
  /** Absolute path for image attachments (content is re-read per request). */
  path?: string
  /** Inline text for text attachments. */
  text?: string
}

export interface IncomingAttachment {
  name: string
  mime: string
  size: number
  kind: 'image' | 'text'
  data: string
}

/** Attachment content resolved for a provider request. */
export interface ResolvedAttachment {
  name: string
  mime: string
  kind: 'image' | 'text'
  /** base64 for images, raw utf8 text for text files */
  data: string
}

export type WireMessage =
  | { role: 'user'; text: string; attachments: ResolvedAttachment[] }
  | { role: 'assistant'; text: string; tools: ToolCallRecord[] }

export type ChatMessage =
  | { id: string; role: 'user'; text: string; attachments?: Attachment[] }
  | {
      id: string
      role: 'assistant'
      text: string
      tools: ToolCallRecord[]
      usage?: Usage
      costUsd?: number
      model?: string
      provider?: ProviderId
    }

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  provider: ProviderId
  level: ModelLevel
  messages: ChatMessage[]
}

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
  provider: ProviderId
}

export interface ProviderPublic {
  model: string
  baseUrl: string
  hasKey: boolean
  keyHint: string | null
}

export interface PublicSettings {
  provider: ProviderId
  level: ModelLevel
  providers: Record<ProviderId, ProviderPublic>
  workspace: string
  autoApproveReads: boolean
  tokenSaver: boolean
  freeMode: boolean
}

export interface SettingsPatch {
  provider?: ProviderId
  level?: ModelLevel
  providers?: Partial<Record<ProviderId, { model?: string; baseUrl?: string }>>
  workspace?: string
  autoApproveReads?: boolean
  tokenSaver?: boolean
  freeMode?: boolean
}

export type ToolStatus = 'awaiting' | 'running' | 'done' | 'error' | 'denied'

export type AgentEvent =
  | { type: 'start'; conversationId: string; messageId: string }
  | { type: 'delta'; conversationId: string; messageId: string; text: string }
  | { type: 'tool'; conversationId: string; messageId: string; call: ToolCallRecord; status: ToolStatus }
  | {
      type: 'tool-output'
      conversationId: string
      messageId: string
      callId: string
      output: string
      isError: boolean
      status: ToolStatus
    }
  | { type: 'approval'; conversationId: string; call: ToolCallRecord; preview: string }
  | { type: 'usage'; conversationId: string; messageId: string; usage: Usage; costUsd: number }
  | { type: 'notice'; conversationId: string; message: string; level: 'info' | 'warn' }
  | { type: 'done'; conversationId: string; conversation: Conversation }
  | { type: 'error'; conversationId: string; message: string }
  | { type: 'aborted'; conversationId: string }

export interface SendRequest {
  conversationId: string
  text: string
  agentMode: boolean
  attachments?: IncomingAttachment[]
}

export interface TestResult {
  ok: boolean
  message: string
  details?: {
    model?: string
    latencyMs?: number
    vision?: boolean
    listed?: boolean
  }
}
