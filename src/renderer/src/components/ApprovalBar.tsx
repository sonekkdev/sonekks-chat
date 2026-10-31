import { IconAlert } from '../lib/icons'

interface Props {
  name: string
  preview: string
  onAllow: () => void
  onDeny: () => void
}

export function ApprovalBar({ name, preview, onAllow, onDeny }: Props) {
  return (
    <div className="approval">
      <div className="approval-icon">
        <IconAlert size={16} />
      </div>
      <div className="approval-body">
        <div className="approval-title">
          Sonekks Chat wants to run <b>{name}</b>
        </div>
        <code className="approval-preview">{preview}</code>
      </div>
      <div className="approval-actions">
        <button className="btn ghost" onClick={onDeny}>
          Deny
        </button>
        <button className="btn primary" onClick={onAllow}>
          Allow
        </button>
      </div>
    </div>
  )
}
