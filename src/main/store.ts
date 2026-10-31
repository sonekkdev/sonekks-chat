import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  Conversation,
  ConversationSummary,
  ModelLevel,
  ProviderId,
  PublicSettings,
  SettingsPatch
} from '../shared/types'

interface StoredProvider {
  model: string
  baseUrl: string
  keyCipher?: string
  keyPlain?: string
}

interface StoredSettings {
  provider: ProviderId
  level: ModelLevel
  providers: Record<ProviderId, StoredProvider>
  workspace: string
  autoApproveReads: boolean
  tokenSaver: boolean
  freeMode: boolean
}

const PROVIDERS: ProviderId[] = ['anthropic', 'deepseek', 'google', 'openrouter']

let dir = ''
let settingsPath = ''
let conversationsPath = ''

let settings: StoredSettings
let conversations: Conversation[] = []

function defaults(): StoredSettings {
  return {
    provider: 'anthropic',
    level: 'default',
    providers: {
      anthropic: { model: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com' },
      deepseek: { model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' },
      google: { model: 'gemini-3.8-flash', baseUrl: 'https://generativelanguage.googleapis.com' },
      openrouter: { model: 'deepseek/deepseek-chat-v3.1:free', baseUrl: 'https://openrouter.ai/api/v1' }
    },
    workspace: join(app.getPath('home'), 'SonekksChatWorkspace'),
    autoApproveReads: true,
    tokenSaver: false,
    freeMode: false
  }
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
}

export function initStore(): void {
  dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  settingsPath = join(dir, 'settings.json')
  conversationsPath = join(dir, 'conversations.json')

  const loaded = readJson<Partial<StoredSettings>>(settingsPath, {})
  const base = defaults()
  settings = {
    ...base,
    ...loaded,
    providers: {
      anthropic: { ...base.providers.anthropic, ...loaded.providers?.anthropic },
      deepseek: { ...base.providers.deepseek, ...loaded.providers?.deepseek },
      google: { ...base.providers.google, ...loaded.providers?.google },
      openrouter: { ...base.providers.openrouter, ...loaded.providers?.openrouter }
    }
  }
  conversations = readJson<Conversation[]>(conversationsPath, [])
}

export function publicSettings(): PublicSettings {
  const providers = {} as PublicSettings['providers']
  for (const id of PROVIDERS) {
    const p = settings.providers[id]
    const key = readKey(id)
    providers[id] = {
      model: p.model,
      baseUrl: p.baseUrl,
      hasKey: Boolean(key),
      keyHint: key ? `...${key.slice(-4)}` : null
    }
  }
  return {
    provider: settings.provider,
    level: settings.level,
    providers,
    workspace: settings.workspace,
    autoApproveReads: settings.autoApproveReads,
    tokenSaver: settings.tokenSaver,
    freeMode: settings.freeMode
  }
}

export function saveSettings(patch: SettingsPatch): PublicSettings {
  if (patch.provider) settings.provider = patch.provider
  if (patch.level) settings.level = patch.level
  if (patch.workspace) settings.workspace = patch.workspace
  if (typeof patch.autoApproveReads === 'boolean') settings.autoApproveReads = patch.autoApproveReads
  if (typeof patch.tokenSaver === 'boolean') settings.tokenSaver = patch.tokenSaver
  if (typeof patch.freeMode === 'boolean') settings.freeMode = patch.freeMode
  if (patch.providers) {
    for (const id of PROVIDERS) {
      const next = patch.providers[id]
      if (!next) continue
      if (typeof next.model === 'string' && next.model.trim()) {
        settings.providers[id].model = next.model.trim()
      }
      if (typeof next.baseUrl === 'string' && next.baseUrl.trim()) {
        settings.providers[id].baseUrl = next.baseUrl.trim().replace(/\/+$/, '')
      }
    }
  }
  persistSettings()
  return publicSettings()
}

export function setApiKey(provider: ProviderId, key: string): PublicSettings {
  const trimmed = key.trim()
  const target = settings.providers[provider]
  delete target.keyCipher
  delete target.keyPlain
  if (trimmed) {
    if (safeStorage.isEncryptionAvailable()) {
      target.keyCipher = safeStorage.encryptString(trimmed).toString('base64')
    } else {
      target.keyPlain = trimmed
    }
  }
  persistSettings()
  return publicSettings()
}

export function readKey(provider: ProviderId): string | null {
  const p = settings.providers[provider]
  if (p.keyCipher) {
    try {
      return safeStorage.decryptString(Buffer.from(p.keyCipher, 'base64'))
    } catch {
      return null
    }
  }
  return p.keyPlain ?? null
}

export function activeProvider(): ProviderId {
  return settings.provider
}

export function activeModel(provider: ProviderId): string {
  return settings.providers[provider].model
}

export function activeBaseUrl(provider: ProviderId): string {
  return settings.providers[provider].baseUrl
}

export function activeLevel(): ModelLevel {
  return settings.level
}

export function workspace(): string {
  if (!existsSync(settings.workspace)) {
    try {
      mkdirSync(settings.workspace, { recursive: true })
    } catch {
      /* fall through: tools report the error */
    }
  }
  return settings.workspace
}

export function autoApproveReads(): boolean {
  return settings.autoApproveReads
}

export function tokenSaver(): boolean {
  return settings.tokenSaver
}

export function freeModeEnabled(): boolean {
  return settings.freeMode
}

function persistSettings(): void {
  writeJson(settingsPath, settings)
}

function persistConversations(): void {
  writeJson(conversationsPath, conversations)
}

export function listConversations(): ConversationSummary[] {
  return conversations
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, provider: c.provider }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getConversation(id: string): Conversation | null {
  return conversations.find((c) => c.id === id) ?? null
}

export function createConversation(provider: ProviderId, level: ModelLevel): Conversation {
  const now = Date.now()
  const conv: Conversation = {
    id: randomUUID(),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    provider,
    level,
    messages: []
  }
  conversations.push(conv)
  persistConversations()
  return conv
}

export function deleteConversation(id: string): void {
  conversations = conversations.filter((c) => c.id !== id)
  persistConversations()
}

export function renameConversation(id: string, title: string): void {
  const conv = getConversation(id)
  if (!conv) return
  conv.title = title.trim() || 'Untitled'
  persistConversations()
}

export function saveConversation(conv: Conversation): void {
  conv.updatedAt = Date.now()
  if (conv.title === 'New chat') {
    const first = conv.messages.find((m) => m.role === 'user')
    if (first && first.role === 'user') {
      conv.title = first.text.replace(/\s+/g, ' ').slice(0, 52) || 'New chat'
    }
  }
  persistConversations()
}
