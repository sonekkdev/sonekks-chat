import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Conversation,
  ConversationSummary,
  ModelLevel,
  ProviderId,
  PublicSettings
} from '../../shared/types'
import { ApprovalBar } from './components/ApprovalBar'
import { Composer } from './components/Composer'
import { Header } from './components/Header'
import { MessageList } from './components/MessageList'
import { SettingsModal } from './components/SettingsModal'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { IconAlert, IconCheck } from './lib/icons'
import type { PendingAttachment, ViewMessage } from './types'

const MAX_ATTACHMENTS = 6
const MAX_IMAGE = 8 * 1024 * 1024
const MAX_TEXT = 300 * 1024

function toView(conversation: Conversation): ViewMessage[] {
  return conversation.messages.map((message) => {
    if (message.role === 'user') {
      return {
        id: message.id,
        role: 'user',
        text: message.text,
        tools: [],
        attachments: (message.attachments ?? []).map((attachment) => ({
          name: attachment.name,
          size: attachment.size,
          kind: attachment.kind
        }))
      }
    }
    return {
      id: message.id,
      role: 'assistant',
      text: message.text,
      tools: message.tools.map((tool) => ({
        ...tool,
        status: tool.isError ? (tool.output?.startsWith('The user denied') ? 'denied' : 'error') : 'done'
      })),
      usage: message.usage,
      costUsd: message.costUsd,
      model: message.model
    }
  })
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error(`could not read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

export default function App() {
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ViewMessage[]>([])
  const [live, setLive] = useState<ViewMessage | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [approval, setApproval] = useState<{ callId: string; name: string; preview: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [agentMode, setAgentMode] = useState(true)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<PendingAttachment[]>([])
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('sonekk.theme') as 'dark' | 'light') ?? 'dark'
  )
  const [maximized, setMaximized] = useState(false)

  const activeIdRef = useRef<string | null>(null)
  const booted = useRef(false)

  const openConversation = useCallback(async (id: string) => {
    activeIdRef.current = id
    setActiveId(id)
    setApproval(null)
    setLive(null)
    setPending([])
    const conversation = await window.sonekk.conversations.get(id)
    setMessages(conversation ? toView(conversation) : [])
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('sonekk.theme', theme)
  }, [theme])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 7000)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (booted.current) return
    booted.current = true

    void (async () => {
      const loaded = await window.sonekk.settings.get()
      setSettings(loaded)

      let list = await window.sonekk.conversations.list()
      if (!list.length) {
        const created = await window.sonekk.conversations.create()
        list = await window.sonekk.conversations.list()
        activeIdRef.current = created.id
        setActiveId(created.id)
        setMessages([])
      } else {
        activeIdRef.current = list[0].id
        setActiveId(list[0].id)
        const conversation = await window.sonekk.conversations.get(list[0].id)
        setMessages(conversation ? toView(conversation) : [])
      }
      setConversations(list)
    })()
  }, [])

  useEffect(() => {
    const off = window.sonekk.agent.onEvent((event) => {
      if (event.type === 'window-state') {
        setMaximized(event.maximized)
        return
      }

      if (event.type === 'done') {
        void window.sonekk.conversations.list().then(setConversations)
      }
      if (event.conversationId !== activeIdRef.current) return

      switch (event.type) {
        case 'start':
          setStreaming(true)
          setApproval(null)
          setLive({ id: event.messageId, role: 'assistant', text: '', tools: [] })
          break
        case 'delta':
          setLive((prev) =>
            prev
              ? { ...prev, text: prev.text + event.text }
              : { id: event.messageId, role: 'assistant', text: event.text, tools: [] }
          )
          break
        case 'tool':
          setLive((prev) => {
            if (!prev) return prev
            const exists = prev.tools.some((tool) => tool.id === event.call.id)
            const tools = exists
              ? prev.tools.map((tool) => (tool.id === event.call.id ? { ...tool, status: event.status } : tool))
              : [...prev.tools, { ...event.call, status: event.status }]
            return { ...prev, tools }
          })
          break
        case 'tool-output':
          setLive((prev) =>
            prev
              ? {
                  ...prev,
                  tools: prev.tools.map((tool) =>
                    tool.id === event.callId
                      ? { ...tool, output: event.output, isError: event.isError, status: event.status }
                      : tool
                  )
                }
              : prev
          )
          break
        case 'approval':
          setApproval({ callId: event.call.id, name: event.call.name, preview: event.preview })
          break
        case 'usage':
          setLive((prev) => (prev ? { ...prev, usage: event.usage, costUsd: event.costUsd } : prev))
          break
        case 'notice':
          setNotice(event.message)
          break
        case 'done':
          setMessages(toView(event.conversation))
          setLive(null)
          setStreaming(false)
          setApproval(null)
          break
        case 'error':
          setError(event.message)
          setStreaming(false)
          setApproval(null)
          setLive(null)
          break
        case 'aborted':
          setStreaming(false)
          setApproval(null)
          setLive(null)
          break
      }
    })
    return off
  }, [])

  const addFiles = useCallback(async (files: File[]) => {
    const room = MAX_ATTACHMENTS - pending.length
    if (room <= 0) {
      setNotice(`Up to ${MAX_ATTACHMENTS} attachments per message`)
      return
    }
    const next: PendingAttachment[] = []
    for (const file of files.slice(0, room)) {
      const isImage = file.type.startsWith('image/')
      const limit = isImage ? MAX_IMAGE : MAX_TEXT
      if (file.size > limit) {
        setNotice(`${file.name} is too large (max ${isImage ? '8 MB' : '300 KB'})`)
        continue
      }
      try {
        const data = isImage ? (await readFile(file)).split(',')[1] ?? '' : await file.text()
        next.push({
          id: crypto.randomUUID(),
          name: file.name,
          mime: file.type || (isImage ? 'image/png' : 'text/plain'),
          size: file.size,
          kind: isImage ? 'image' : 'text',
          data
        })
      } catch {
        setNotice(`Could not read ${file.name}`)
      }
    }
    if (next.length) setPending((prev) => [...prev, ...next].slice(0, MAX_ATTACHMENTS))
  }, [pending.length])

  const newChat = useCallback(async () => {
    const created = await window.sonekk.conversations.create()
    activeIdRef.current = created.id
    setActiveId(created.id)
    setMessages([])
    setLive(null)
    setStreaming(false)
    setApproval(null)
    setPending([])
    setConversations(await window.sonekk.conversations.list())
  }, [])

  const deleteConversation = useCallback(
    async (id: string) => {
      const list = await window.sonekk.conversations.remove(id)
      setConversations(list)
      if (id !== activeIdRef.current) return
      if (list.length) await openConversation(list[0].id)
      else await newChat()
    },
    [newChat, openConversation]
  )

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if ((!trimmed && !pending.length) || streaming) return

      let id = activeIdRef.current
      if (!id) {
        const created = await window.sonekk.conversations.create()
        id = created.id
        activeIdRef.current = id
        setActiveId(id)
        setConversations(await window.sonekk.conversations.list())
      }

      const outgoing = pending.map((attachment) => ({
        name: attachment.name,
        mime: attachment.mime,
        size: attachment.size,
        kind: attachment.kind,
        data: attachment.data
      }))

      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          role: 'user',
          text: trimmed,
          tools: [],
          attachments: pending.map((attachment) => ({
            name: attachment.name,
            size: attachment.size,
            kind: attachment.kind
          }))
        }
      ])
      setInput('')
      setPending([])
      setError(null)
      setStreaming(true)
      setLive(null)
      window.sonekk.agent.send({ conversationId: id, text: trimmed, agentMode, attachments: outgoing })
    },
    [agentMode, pending, streaming]
  )

  const changeLevel = useCallback((level: ModelLevel) => {
    setSettings((prev) => (prev ? { ...prev, level } : prev))
    void window.sonekk.settings.save({ level })
  }, [])

  const changeProvider = useCallback((provider: ProviderId) => {
    setSettings((prev) => (prev ? { ...prev, provider } : prev))
    void window.sonekk.settings.save({ provider })
  }, [])

  const totals = useMemo(() => {
    let input = 0
    let output = 0
    let cost = 0
    for (const message of messages) {
      if (message.role !== 'assistant' || !message.usage) continue
      input += message.usage.inputTokens
      output += message.usage.outputTokens
      cost += message.costUsd ?? 0
    }
    if (live) {
      if (live.usage) {
        input += live.usage.inputTokens
        output += live.usage.outputTokens
        cost += live.costUsd ?? 0
      } else {
        output += Math.round(live.text.length / 4)
      }
    }
    return { tokens: input + output, cost }
  }, [messages, live])

  if (!settings) {
    return (
      <div className="boot">
        <div className="spinner" />
      </div>
    )
  }

  const title = conversations.find((c) => c.id === activeId)?.title ?? 'New chat'
  const model = settings.providers[settings.provider].model
  const providerLabel =
    settings.provider === 'anthropic'
      ? 'Claude'
      : settings.provider === 'deepseek'
        ? 'DeepSeek'
        : settings.provider === 'google'
          ? 'Gemini'
          : 'OpenRouter'
  const workspaceName = settings.workspace.split(/[\\/]/).filter(Boolean).pop() ?? 'workspace'
  const subtitle = [
    `${agentMode ? 'Agent' : 'Chat'} mode`,
    workspaceName,
    settings.freeMode ? 'free models' : '',
    settings.tokenSaver ? 'token saver' : ''
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="app">
      <TitleBar theme={theme} maximized={maximized} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />

      <div className="body">
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          workspace={settings.workspace}
          onSelect={(id) => void openConversation(id)}
          onNew={() => void newChat()}
          onDelete={(id) => void deleteConversation(id)}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <main className="main">
          <div className="aurora" aria-hidden="true">
            <span className="blob b1" />
            <span className="blob b2" />
            <span className="blob b3" />
          </div>
          <Header
            title={title}
            subtitle={subtitle}
            provider={settings.provider}
            model={settings.freeMode ? 'free model pool' : model}
            tokens={totals.tokens}
            cost={totals.cost}
            freeMode={settings.freeMode}
            onProviderChange={changeProvider}
            onOpenSettings={() => setSettingsOpen(true)}
          />

          <MessageList
            messages={messages}
            live={live}
            streaming={streaming}
            agentMode={agentMode}
            needsKey={!settings.freeMode && !settings.providers[settings.provider].hasKey}
            providerLabel={providerLabel}
            onSuggestion={(text) => void send(text)}
            onOpenSettings={() => setSettingsOpen(true)}
          />

          {error ? (
            <div className="error-toast" onClick={() => setError(null)} title="Click to dismiss">
              <IconAlert size={15} />
              <span>{error}</span>
            </div>
          ) : null}

          {notice ? (
            <div className="notice-toast" onClick={() => setNotice(null)} title="Click to dismiss">
              <IconCheck size={15} />
              <span>{notice}</span>
            </div>
          ) : null}

          {approval ? (
            <ApprovalBar
              name={approval.name}
              preview={approval.preview}
              onAllow={() => {
                window.sonekk.agent.approve(approval.callId, true)
                setApproval(null)
              }}
              onDeny={() => {
                window.sonekk.agent.approve(approval.callId, false)
                setApproval(null)
              }}
            />
          ) : null}

          <Composer
            value={input}
            onChange={setInput}
            onSend={() => void send(input)}
            streaming={streaming}
            onStop={() => activeId && window.sonekk.agent.abort(activeId)}
            agentMode={agentMode}
            onAgentModeChange={setAgentMode}
            level={settings.level}
            onLevelChange={changeLevel}
            attachments={pending}
            onAddFiles={(files) => void addFiles(files)}
            onRemoveAttachment={(id) => setPending((prev) => prev.filter((item) => item.id !== id))}
            inputTokens={totals.tokens}
          />
        </main>
      </div>

      {settingsOpen ? (
        <SettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onChanged={(next) => setSettings(next)}
        />
      ) : null}
    </div>
  )
}
