import type {
  AgentEvent,
  Conversation,
  ConversationSummary,
  ProviderId,
  PublicSettings,
  SendRequest,
  SettingsPatch,
  TestResult
} from './types'

export type AgentStreamEvent = AgentEvent | { type: 'window-state'; maximized: boolean }

export interface SonekkApi {
  settings: {
    get(): Promise<PublicSettings>
    save(patch: SettingsPatch): Promise<PublicSettings>
    setKey(provider: ProviderId, key: string): Promise<PublicSettings>
    test(provider: ProviderId): Promise<TestResult>
    models(provider: ProviderId): Promise<string[]>
    pickFolder(): Promise<string | null>
  }
  conversations: {
    list(): Promise<ConversationSummary[]>
    get(id: string): Promise<Conversation | null>
    create(): Promise<Conversation>
    remove(id: string): Promise<ConversationSummary[]>
    rename(id: string, title: string): Promise<ConversationSummary[]>
  }
  agent: {
    send(request: SendRequest): void
    abort(conversationId: string): void
    approve(callId: string, approved: boolean): void
    onEvent(handler: (event: AgentStreamEvent) => void): () => void
  }
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
  }
  shell: {
    openWorkspace(): Promise<void>
    openExternal(url: string): Promise<void>
  }
}
