import { IconMinus, IconMoon, IconSquare, IconSun, IconX } from '../lib/icons'

interface Props {
  theme: 'dark' | 'light'
  maximized: boolean
  onToggleTheme: () => void
}

export function TitleBar({ theme, maximized, onToggleTheme }: Props) {
  return (
    <div className="titlebar" onDoubleClick={() => window.sonekk.window.toggleMaximize()}>
      <div className="brand">
        <span className="brand-mark">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3.2" fill="currentColor" />
            <ellipse cx="12" cy="12" rx="9" ry="4.2" stroke="currentColor" strokeWidth="1.6" transform="rotate(-28 12 12)" />
          </svg>
        </span>
        <span className="brand-name">Sonekks Chat</span>
      </div>

      <div className="titlebar-drag" />

      <button className="icon-btn titlebar-theme" onClick={onToggleTheme} title="Toggle theme">
        {theme === 'dark' ? <IconSun size={15} /> : <IconMoon size={15} />}
      </button>

      <div className="win-controls">
        <button className="win-btn" onClick={() => window.sonekk.window.minimize()} title="Minimize">
          <IconMinus size={15} />
        </button>
        <button className="win-btn" onClick={() => window.sonekk.window.toggleMaximize()} title="Maximize">
          {maximized ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="8" y="4" width="12" height="12" rx="1.5" />
              <path d="M16 16v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h3" />
            </svg>
          ) : (
            <IconSquare size={14} />
          )}
        </button>
        <button className="win-btn danger" onClick={() => window.sonekk.window.close()} title="Close">
          <IconX size={15} />
        </button>
      </div>
    </div>
  )
}
