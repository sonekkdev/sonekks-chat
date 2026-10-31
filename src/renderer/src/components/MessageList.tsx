import { useEffect, useRef } from 'react'
import type { ViewMessage } from '../types'
import { IconBolt, IconKey } from '../lib/icons'
import { MessageItem } from './MessageItem'

interface Props {
  messages: ViewMessage[]
  live: ViewMessage | null
  streaming: boolean
  agentMode: boolean
  needsKey: boolean
  providerLabel: string
  onSuggestion: (text: string) => void
  onOpenSettings: () => void
}

const SUGGESTIONS = [
  { title: 'Inspect my workspace', prompt: 'List the files in my workspace and tell me what this project is.' },
  { title: 'System check', prompt: 'Check my Windows version, CPU and free disk space, then summarize.' },
  { title: 'Write a script', prompt: 'Write a PowerShell script that finds files larger than 100 MB in my workspace.' },
  { title: 'Explain code', prompt: 'I will paste some code. Explain what it does and point out bugs.' }
]

export function MessageList({
  messages,
  live,
  streaming,
  agentMode,
  needsKey,
  providerLabel,
  onSuggestion,
  onOpenSettings
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = (): void => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages, live?.text, live?.tools.length])

  const empty = messages.length === 0 && !live

  return (
    <div className="chat-scroll" ref={scrollRef}>
      <div className="chat-inner">
        {empty ? (
          <div className="empty">
            <div className="empty-mark">
              <IconBolt size={22} />
            </div>
            <h1>What should we do?</h1>
            <p>
              {agentMode
                ? 'Agent mode is on. Sonekks Chat can read, write and run commands inside your workspace.'
                : 'Chat mode. Ask anything. Switch to Agent when you want Sonekks Chat to act on this PC.'}
            </p>
            {needsKey ? (
              <button className="callout" onClick={onOpenSettings}>
                <IconKey size={15} />
                Add your {providerLabel} API key to start
                <span className="callout-arrow">Open settings</span>
              </button>
            ) : null}
            <div className="suggestions">
              {SUGGESTIONS.map((item) => (
                <button key={item.title} className="suggestion" onClick={() => onSuggestion(item.prompt)}>
                  <span>{item.title}</span>
                  <small>{item.prompt}</small>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <MessageItem key={message.id} message={message} />
            ))}
            {live ? <MessageItem key={live.id} message={live} streaming={streaming} /> : null}
          </>
        )}
      </div>
    </div>
  )
}
