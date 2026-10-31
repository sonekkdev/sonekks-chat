import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ModelLevel } from '../../../shared/types'
import type { PendingAttachment } from '../types'
import { IconBolt, IconFile, IconPaperclip, IconSend, IconStop, IconX } from '../lib/icons'
import { LevelPicker } from './LevelPicker'
import { fmtTokens } from '../lib/format'

interface Props {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  streaming: boolean
  onStop: () => void
  agentMode: boolean
  onAgentModeChange: (on: boolean) => void
  level: ModelLevel
  onLevelChange: (level: ModelLevel) => void
  attachments: PendingAttachment[]
  onAddFiles: (files: File[]) => void
  onRemoveAttachment: (id: string) => void
  inputTokens: number
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function Composer({
  value,
  onChange,
  onSend,
  streaming,
  onStop,
  agentMode,
  onAgentModeChange,
  level,
  onLevelChange,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  inputTokens
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [value])

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const canSend = Boolean(value.trim() || attachments.length)

  return (
    <div className="composer-wrap">
      <div
        className={`composer${dragging ? ' dropping' : ''}${value.trim() || attachments.length ? ' has-content' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          onAddFiles(Array.from(event.dataTransfer.files))
        }}
      >
        {attachments.length ? (
          <div className="attach-row">
            {attachments.map((attachment) => (
              <span key={attachment.id} className="attach-chip">
                <IconFile size={12} />
                <span className="attach-name">{attachment.name}</span>
                <span className="attach-size">{humanSize(attachment.size)}</span>
                <button onClick={() => onRemoveAttachment(attachment.id)} title="Remove">
                  <IconX size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <textarea
          ref={ref}
          rows={1}
          value={value}
          placeholder={agentMode ? 'Ask anything, attach files, or tell Sonekks Chat what to do on this PC…' : 'Ask anything…'}
          onChange={(event) => onChange(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length) {
              event.preventDefault()
              onAddFiles(files)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (canSend) onSend()
            }
          }}
        />

        <div className="composer-row">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files) onAddFiles(Array.from(event.target.files))
              event.target.value = ''
            }}
          />
          <button className="attach-btn" onClick={() => fileRef.current?.click()} title="Attach files or images">
            <IconPaperclip size={15} />
          </button>

          <div className="mode-switch" style={{ '--mode': agentMode ? 1 : 0 } as CSSProperties}>
            <span className="mode-thumb" aria-hidden="true" />
            <button className={!agentMode ? 'on' : ''} onClick={() => onAgentModeChange(false)}>
              Chat
            </button>
            <button className={agentMode ? 'on' : ''} onClick={() => onAgentModeChange(true)}>
              <IconBolt size={12} />
              Agent
            </button>
          </div>

          <LevelPicker level={level} onChange={onLevelChange} />

          <div className="composer-spacer" />

          {streaming ? (
            <>
              <span className="live-tokens">~{fmtTokens(inputTokens)}</span>
              <button className="send stop" onClick={onStop} title="Stop generating">
                <IconStop size={15} />
              </button>
            </>
          ) : (
            <button className="send" onClick={onSend} disabled={!canSend} title="Send">
              <IconSend size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="composer-hint">
        Enter to send · Shift+Enter for a new line · drop or paste files
        {agentMode ? ' · actions ask for approval' : ''}
      </div>
    </div>
  )
}
