import { useState } from 'react'
import type { ViewTool } from '../types'
import { IconChevron, IconFile, IconFolder, IconSearch, IconTerminal } from '../lib/icons'

function toolIcon(name: string) {
  switch (name) {
    case 'run_command':
      return <IconTerminal size={14} />
    case 'list_dir':
      return <IconFolder size={14} />
    case 'search_files':
      return <IconSearch size={14} />
    default:
      return <IconFile size={14} />
  }
}

const STATUS_LABEL: Record<ViewTool['status'], string> = {
  awaiting: 'Needs approval',
  running: 'Running',
  done: 'Done',
  error: 'Failed',
  denied: 'Denied'
}

function preview(tool: ViewTool): string {
  const input = tool.input ?? {}
  if (typeof input.command === 'string') return input.command
  if (typeof input.path === 'string') return input.path
  return Object.keys(input).join(', ')
}

export function ToolCard({ tool }: { tool: ViewTool }) {
  const [open, setOpen] = useState(tool.status === 'error' || tool.status === 'awaiting')

  return (
    <div className={`tool tool-${tool.status}`}>
      <button className="tool-head" onClick={() => setOpen((v) => !v)}>
        <span className="tool-icon">{toolIcon(tool.name)}</span>
        <span className="tool-name">{tool.name}</span>
        <span className="tool-preview">{preview(tool)}</span>
        <span className={`tool-status s-${tool.status}`}>
          <span className="dot" />
          {STATUS_LABEL[tool.status]}
        </span>
        <span className={`tool-chevron${open ? ' open' : ''}`}>
          <IconChevron size={14} />
        </span>
      </button>

      {open ? (
        <div className="tool-body">
          <div className="tool-section-label">Input</div>
          <pre className="tool-code">{JSON.stringify(tool.input, null, 2)}</pre>
          {tool.output !== undefined ? (
            <>
              <div className="tool-section-label">Output</div>
              <pre className="tool-code">{tool.output}</pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
