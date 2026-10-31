import { useRef, useState, type CSSProperties } from 'react'
import type { ModelLevel } from '../../../shared/types'

const LEVELS = [
  { id: 'fast', label: 'Low', hint: 'Minimal reasoning — fastest and cheapest' },
  { id: 'default', label: 'Medium', hint: 'Balanced reasoning and cost' },
  { id: 'high', label: 'High', hint: 'Deeper reasoning, slower replies' },
  { id: 'max', label: 'Ultra', hint: 'Maximum reasoning budget' }
] as const

interface Props {
  level: ModelLevel
  onChange: (level: ModelLevel) => void
}

export function LevelPicker({ level, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const index = Math.max(0, LEVELS.findIndex((item) => item.id === level))
  const active = LEVELS[index]

  const pick = (clientX: number): void => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(0.9999, Math.max(0, (clientX - rect.left) / rect.width))
    const next = LEVELS[Math.floor(ratio * LEVELS.length)].id
    if (next !== level) onChange(next)
  }

  return (
    <div
      ref={ref}
      className={`level${dragging ? ' dragging' : ''}`}
      data-level={level}
      role="slider"
      tabIndex={0}
      aria-label="Reasoning effort"
      aria-valuemin={0}
      aria-valuemax={LEVELS.length - 1}
      aria-valuenow={index}
      aria-valuetext={active.label}
      title={active.hint}
      style={{ '--p': `${((index + 1) / LEVELS.length) * 100}%` } as CSSProperties}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
        pick(event.clientX)
      }}
      onPointerMove={(event) => {
        if (dragging) pick(event.clientX)
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault()
          onChange(LEVELS[Math.min(LEVELS.length - 1, index + 1)].id)
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault()
          onChange(LEVELS[Math.max(0, index - 1)].id)
        }
      }}
    >
      <span className="level-fill" aria-hidden="true" />
      <span className="level-knob" aria-hidden="true" key={level} />
      {LEVELS.map((item) => (
        <span key={item.id} className={`level-label${item.id === level ? ' on' : ''}`}>
          {item.label}
        </span>
      ))}
    </div>
  )
}
