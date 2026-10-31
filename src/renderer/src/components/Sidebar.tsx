import { useState } from 'react'
import type { ConversationSummary } from '../../../shared/types'
import { relTime } from '../lib/format'
import { IconPlus, IconSettings, IconTrash } from '../lib/icons'

interface Props {
  conversations: ConversationSummary[]
  activeId: string | null
  workspace: string
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onOpenSettings: () => void
}

export function Sidebar({ conversations, activeId, workspace, onSelect, onNew, onDelete, onOpenSettings }: Props) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  return (
    <aside className="sidebar">
      <button className="new-chat" onClick={onNew}>
        <IconPlus size={15} />
        New chat
      </button>

      <div className="sidebar-label">Recent</div>

      <nav className="conv-list">
        {conversations.length === 0 ? <div className="conv-empty">No conversations yet</div> : null}
        {conversations.map((conv) => {
          const isActive = conv.id === activeId
          const isPending = pendingDelete === conv.id
          return (
            <div
              key={conv.id}
              className={`conv-item${isActive ? ' active' : ''}`}
              onClick={() => {
                if (isPending) return
                onSelect(conv.id)
              }}
            >
              <span className="conv-title">{conv.title}</span>
              {isPending ? (
                <span className="conv-confirm" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="conv-mini danger"
                    onClick={() => {
                      onDelete(conv.id)
                      setPendingDelete(null)
                    }}
                  >
                    Delete
                  </button>
                  <button className="conv-mini" onClick={() => setPendingDelete(null)}>
                    Keep
                  </button>
                </span>
              ) : (
                <>
                  <span className="conv-time">{relTime(conv.updatedAt)}</span>
                  <button
                    className="conv-del"
                    title="Delete conversation"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPendingDelete(conv.id)
                    }}
                  >
                    <IconTrash size={13} />
                  </button>
                </>
              )}
            </div>
          )
        })}
      </nav>

      <div className="sidebar-foot">
        <button className="workspace-chip" onClick={() => window.sonekk.shell.openWorkspace()} title={workspace}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          <span>{workspace.split(/[\\/]/).filter(Boolean).pop() ?? 'workspace'}</span>
        </button>
        <button className="icon-btn" onClick={onOpenSettings} title="Settings">
          <IconSettings size={16} />
        </button>
      </div>
    </aside>
  )
}
