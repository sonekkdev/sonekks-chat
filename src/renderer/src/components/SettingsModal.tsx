import { useEffect, useMemo, useState } from 'react'
import type { ProviderId, PublicSettings } from '../../../shared/types'
import { MODELS, labelFor } from '../../../shared/catalog'
import { IconCheck, IconKey, IconX } from '../lib/icons'

interface Props {
  settings: PublicSettings
  onClose: () => void
  onChanged: (settings: PublicSettings) => void
}

const META: Record<ProviderId, { label: string; hint: string; placeholder: string; keysUrl: string }> = {
  anthropic: {
    label: 'Anthropic',
    hint: 'Claude models',
    placeholder: 'claude-sonnet-5-5',
    keysUrl: 'https://console.anthropic.com/settings/keys'
  },
  deepseek: {
    label: 'DeepSeek',
    hint: 'OpenAI-compatible',
    placeholder: 'deepseek-flash',
    keysUrl: 'https://platform.deepseek.com/api_keys'
  },
  google: {
    label: 'Google',
    hint: 'Gemini API',
    placeholder: 'gemini-3.8-flash',
    keysUrl: 'https://aistudio.google.com/apikey'
  },
  openrouter: {
    label: 'OpenRouter',
    hint: 'free model pool',
    placeholder: 'deepseek/deepseek-chat-v3.1:free',
    keysUrl: 'https://openrouter.ai/keys'
  }
}

const ORDER: ProviderId[] = ['anthropic', 'deepseek', 'google', 'openrouter']

function ProviderCard({
  id,
  info,
  active,
  onActivate,
  onChanged
}: {
  id: ProviderId
  info: PublicSettings['providers'][ProviderId]
  active: boolean
  onActivate: () => void
  onChanged: (settings: PublicSettings) => void
}) {
  const meta = META[id]
  const [key, setKey] = useState('')
  const [reveal, setReveal] = useState(false)
  const [model, setModel] = useState(info.model)
  const [baseUrl, setBaseUrl] = useState(info.baseUrl)
  const [liveModels, setLiveModels] = useState<string[]>([])
  const [customModel, setCustomModel] = useState(false)
  const [saved, setSaved] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const modelOptions = useMemo(() => {
    const catalogIds = MODELS[id].map((entry) => entry.id)
    const extra = liveModels.filter((item) => !catalogIds.includes(item)).sort()
    const ids = [...catalogIds, ...extra]
    if (info.model && !ids.includes(info.model)) ids.unshift(info.model)
    return ids
  }, [id, liveModels, info.model])

  useEffect(() => {
    if (!info.hasKey) return
    let alive = true
    void window.sonekk.settings.models(id).then((list) => {
      if (alive && list.length) setLiveModels(list)
    })
    return () => {
      alive = false
    }
  }, [id, info.hasKey])

  const persistModel = async (nextModel: string, nextBase: string): Promise<void> => {
    if (nextModel === info.model && nextBase === info.baseUrl) return
    const next = await window.sonekk.settings.save({ providers: { [id]: { model: nextModel, baseUrl: nextBase } } })
    onChanged(next)
    setSaved(true)
    setTimeout(() => setSaved(false), 1400)
  }

  const saveKey = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = await window.sonekk.settings.setKey(id, key)
      onChanged(next)
      setKey('')
      setSaved(true)
      setTest(null)
      setTimeout(() => setSaved(false), 1400)
    } finally {
      setBusy(false)
    }
  }

  const runTest = async (): Promise<void> => {
    setBusy(true)
    setTest(null)
    try {
      setTest(await window.sonekk.settings.test(id))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`provider-card${active ? ' active' : ''}`}>
      <div className="provider-head">
        <div className="provider-title">
          <span className={`provider-dot p-${id}`} />
          <span className="provider-name">{meta.label}</span>
          <span className="provider-hint">{meta.hint}</span>
          {active ? <span className="badge">active</span> : null}
        </div>
        {!active ? (
          <button className="btn tiny" onClick={onActivate}>
            Use
          </button>
        ) : null}
      </div>

      <div className="field-row">
        <label className="field grow">
          <span className="field-label">
            <IconKey size={12} /> API key
            {info.hasKey ? <em className="ok">saved {info.keyHint}</em> : null}
          </span>
          <div className="key-row">
            <input
              type={reveal ? 'text' : 'password'}
              value={key}
              spellCheck={false}
              autoComplete="off"
              placeholder={info.hasKey ? 'Replace stored key…' : 'Paste your API key'}
              onChange={(event) => setKey(event.target.value)}
            />
            <button className="btn tiny ghost" onClick={() => setReveal((v) => !v)} type="button">
              {reveal ? 'Hide' : 'Show'}
            </button>
            <button className="btn tiny" onClick={saveKey} disabled={!key.trim() || busy} type="button">
              Save
            </button>
          </div>
        </label>
      </div>

      <div className="field-row">
        <label className="field grow">
          <span className="field-label">Model</span>
          <select
            className="model-select"
            value={customModel ? '__custom' : model}
            onChange={(event) => {
              const value = event.target.value
              if (value === '__custom') {
                setCustomModel(true)
                return
              }
              setCustomModel(false)
              setModel(value)
              void persistModel(value, baseUrl)
            }}
          >
            {modelOptions.map((optionId) => (
              <option key={optionId} value={optionId}>
                {labelFor(id, optionId)}
              </option>
            ))}
            <option value="__custom">Custom model ID…</option>
          </select>
        </label>
        <label className="field grow">
          <span className="field-label">Base URL</span>
          <input
            value={baseUrl}
            spellCheck={false}
            onChange={(event) => setBaseUrl(event.target.value)}
            onBlur={() => void persistModel(model, baseUrl)}
          />
        </label>
      </div>

      {customModel ? (
        <div className="field-row">
          <label className="field grow">
            <span className="field-label">Custom model ID</span>
            <input
              value={model}
              spellCheck={false}
              placeholder={meta.placeholder}
              onChange={(event) => setModel(event.target.value)}
              onBlur={() => void persistModel(model, baseUrl)}
            />
          </label>
        </div>
      ) : null}

      <div className="provider-foot">
        <button className="btn tiny ghost" onClick={() => void window.sonekk.shell.openExternal(meta.keysUrl)} type="button">
          Get a key
        </button>
        <button className="btn tiny" onClick={runTest} disabled={!info.hasKey || busy} type="button">
          Verify
        </button>
        {saved ? (
          <span className="inline-ok">
            <IconCheck size={13} /> Saved
          </span>
        ) : null}
        {test ? (
          <span className={`inline-test ${test.ok ? 'ok' : 'bad'}`} title={test.message}>
            {test.ok ? <IconCheck size={13} /> : <IconX size={13} />}
            {test.message.slice(0, 140)}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function SettingsModal({ settings, onClose, onChanged }: Props) {
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal settings" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h2>Settings</h2>
            <p className="modal-sub">Keys are encrypted with the Windows credential store and never leave this PC.</p>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">
            <IconX size={16} />
          </button>
        </div>

        <div className="modal-body">
          <section className="setting-section">
            <h3>Workspace</h3>
            <p className="setting-desc">Sonekks Chat can only touch files inside this folder.</p>
            <div className="row">
              <code className="path">{settings.workspace}</code>
              <button
                className="btn tiny"
                onClick={async () => {
                  const picked = await window.sonekk.settings.pickFolder()
                  if (!picked) return
                  onChanged(await window.sonekk.settings.save({ workspace: picked }))
                }}
              >
                Change
              </button>
              <button className="btn tiny ghost" onClick={() => window.sonekk.shell.openWorkspace()}>
                Open
              </button>
            </div>
          </section>

          <section className="setting-section">
            <h3>Permissions</h3>
            <label className="toggle-row">
              <div>
                <div className="toggle-title">Auto-approve read-only tools</div>
                <div className="toggle-desc">Reading, listing and searching files run without asking. Writes and commands always ask.</div>
              </div>
              <input
                type="checkbox"
                checked={settings.autoApproveReads}
                onChange={async (event) =>
                  onChanged(await window.sonekk.settings.save({ autoApproveReads: event.target.checked }))
                }
              />
            </label>
          </section>

          <section className="setting-section">
            <h3>Cost control</h3>
            <p className="setting-desc">Two switches that cut spend, at some cost in depth.</p>

            <label className="toggle-row">
              <div>
                <div className="toggle-title">Token saver</div>
                <div className="toggle-desc">
                  Keeps only the last 4 turns of context, caps each reply at ~2k tokens and trims tool output. Biggest
                  saving on long agent runs.
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.tokenSaver}
                onChange={async (event) =>
                  onChanged(await window.sonekk.settings.save({ tokenSaver: event.target.checked }))
                }
              />
            </label>

            <label className="toggle-row stacked">
              <div>
                <div className="toggle-title">
                  Free mode <span className="badge">auto</span>
                </div>
                <div className="toggle-desc">
                  Uses only zero-cost models: OpenRouter <code>:free</code> models (needs an OpenRouter key) and Gemini
                  free-tier models. When one hits a rate or credit limit, the next is tried automatically. Your paid
                  provider is ignored while this is on.
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.freeMode}
                onChange={async (event) =>
                  onChanged(await window.sonekk.settings.save({ freeMode: event.target.checked }))
                }
              />
            </label>
          </section>

          <section className="setting-section">
            <h3>Providers</h3>
            <p className="setting-desc">Use one key or several and switch from the header at any time.</p>
            <div className="provider-list">
              {ORDER.map((id) => (
                <ProviderCard
                  key={id}
                  id={id}
                  info={settings.providers[id]}
                  active={settings.provider === id}
                  onActivate={async () => onChanged(await window.sonekk.settings.save({ provider: id }))}
                  onChanged={onChanged}
                />
              ))}
            </div>
          </section>

          <p className="fineprint">
            Cost figures are estimates from a built-in price table and may differ from your invoice. Level controls the
            provider's reasoning budget and max output tokens.
          </p>
        </div>
      </div>
    </div>
  )
}
