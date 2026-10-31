import type { ProviderId } from '../../../shared/types'
import { PROVIDER_LABEL } from '../types'
import { fmtCost, fmtTokens } from '../lib/format'
import { IconSettings } from '../lib/icons'

interface Props {
  title: string
  subtitle: string
  provider: ProviderId
  model: string
  tokens: number
  cost: number
  freeMode: boolean
  onProviderChange: (provider: ProviderId) => void
  onOpenSettings: () => void
}

export function Header({
  title,
  subtitle,
  provider,
  model,
  tokens,
  cost,
  freeMode,
  onProviderChange,
  onOpenSettings
}: Props) {
  return (
    <header className="header">
      <div className="header-title">
        <span className="header-name">{title}</span>
        <span className="header-sub">{subtitle}</span>
      </div>

      <div className="header-right">
        <div className="counter" title={`${tokens.toLocaleString()} tokens this conversation`}>
          <span className="counter-label">tokens</span>
          <span className="counter-value">{fmtTokens(tokens)}</span>
        </div>
        <div className="counter" title={`Estimated spend for this conversation: ${cost.toFixed(6)} USD`}>
          <span className="counter-label">cost</span>
          <span className="counter-value">{fmtCost(cost)}</span>
        </div>

        {freeMode ? <span className="free-badge" title="Free mode: auto-switches between free models">free</span> : null}

        <div className={`provider-chip p-${provider}`} title={`Model: ${model}`}>
          <span className="provider-dot" />
          <select
            value={provider}
            onChange={(event) => onProviderChange(event.target.value as ProviderId)}
            aria-label="Provider"
            disabled={freeMode}
          >
            {(Object.keys(PROVIDER_LABEL) as ProviderId[]).map((id) => (
              <option key={id} value={id}>
                {PROVIDER_LABEL[id]}
              </option>
            ))}
          </select>
        </div>

        <button className="icon-btn" onClick={onOpenSettings} title="Settings">
          <IconSettings size={16} />
        </button>
      </div>
    </header>
  )
}
