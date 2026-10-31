import { useMemo, useState } from 'react'
import type { ViewMessage } from '../types'
import { fmtCost, fmtTokens } from '../lib/format'
import { renderMarkdown } from '../lib/md'
import { IconCheck, IconCopy, IconFile, IconSpark } from '../lib/icons'
import { ToolCard } from './ToolCard'

interface Props {
  message: ViewMessage
  streaming?: boolean
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function MessageItem({ message, streaming }: Props) {
  const [copied, setCopied] = useState(false)

  const html = useMemo(
    () => (message.role === 'assistant' && message.text ? renderMarkdown(message.text) : ''),
    [message.role, message.text]
  )

  if (message.role === 'user') {
    return (
      <div className="msg user">
        <div className="bubble">
          {message.attachments?.length ? (
            <div className="bubble-attachments">
              {message.attachments.map((attachment, index) => (
                <span key={`${attachment.name}-${index}`} className="attach-chip small">
                  <IconFile size={12} />
                  <span className="attach-name">{attachment.name}</span>
                  <span className="attach-size">{humanSize(attachment.size)}</span>
                </span>
              ))}
            </div>
          ) : null}
          {message.text ? <div className="bubble-text">{message.text}</div> : null}
        </div>
      </div>
    )
  }

  const tokens = (message.usage?.inputTokens ?? 0) + (message.usage?.outputTokens ?? 0)

  return (
    <div className={`msg assistant${streaming ? ' generating' : ''}`}>
      <div className="avatar">
        <IconSpark size={14} />
      </div>
      <div className="msg-main">
        <div className="msg-name">
          Sonekks Chat
          {message.model ? <span className="msg-model">{message.model}</span> : null}
          {message.text && !streaming ? (
            <button
              className="copy-btn"
              title="Copy reply"
              onClick={() => {
                void navigator.clipboard.writeText(message.text)
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              }}
            >
              {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
            </button>
          ) : null}
        </div>

        {message.text ? (
          <div
            className="prose"
            onClick={(event) => {
              const anchor = (event.target as HTMLElement).closest('a')
              if (anchor?.href) {
                event.preventDefault()
                void window.sonekk.shell.openExternal(anchor.href)
              }
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : null}

        {streaming && !message.text ? (
          <div className="thinking-dots">
            <span />
            <span />
            <span />
          </div>
        ) : null}
        {streaming && message.text ? <span className="caret" /> : null}

        {message.tools.length > 0 ? (
          <div className="tool-stack">
            {message.tools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        ) : null}

        {message.usage && tokens > 0 ? (
          <div className="msg-meta" title="Tokens used and estimated cost for this step">
            <span>{fmtTokens(message.usage.inputTokens)} in</span>
            <span className="sep">·</span>
            <span>{fmtTokens(message.usage.outputTokens)} out</span>
            <span className="sep">·</span>
            <span>{fmtCost(message.costUsd ?? 0)}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
