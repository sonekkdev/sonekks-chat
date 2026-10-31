import type { ProviderId, TestResult } from '../shared/types'
import { activeBaseUrl, activeModel, readKey } from './store'

/** 64x64 solid red square, used to prove the endpoint is a vision-capable model. */
const VISION_PROBE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAe0lEQVR4nO3PUQkAIBTAwBfFAPZvYSdD+HEIgwW4zVn764YLGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLXjsAhW7kQBybswlAAAAAElFTkSuQmCC'

const TIMEOUT_MS = 25000

async function request(url: string, init: RequestInit): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const text = await res.text()
    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {
      /* keep raw */
    }
    if (!res.ok) {
      const detail = json?.error?.message ?? json?.error ?? text.slice(0, 300)
      throw new Error(`${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

function anthropicHeaders(key: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01'
  }
}

/** Live model catalogue from the provider, so the UI never hardcodes a stale list. */
export async function listModels(provider: ProviderId): Promise<string[]> {
  const key = readKey(provider)
  const base = activeBaseUrl(provider)

  try {
    if (provider === 'openrouter') {
      const json = await request('https://openrouter.ai/api/v1/models', {})
      return (json?.data ?? []).map((m: any) => String(m.id ?? '')).filter(Boolean)
    }
    if (!key) return []
    if (provider === 'anthropic') {
      const json = await request(`${base}/v1/models?limit=1000`, { headers: anthropicHeaders(key) })
      return (json?.data ?? []).map((m: any) => m.id).filter(Boolean)
    }
    if (provider === 'google') {
      const json = await request(`${base}/v1beta/models?key=${encodeURIComponent(key)}`, {})
      return (json?.models ?? [])
        .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m: any) => String(m.name ?? '').replace(/^models\//, ''))
        .filter(Boolean)
    }
    const json = await request(`${base}/models`, { headers: { authorization: `Bearer ${key}` } })
    return (json?.data ?? []).map((m: any) => m.id).filter(Boolean)
  } catch {
    return []
  }
}

async function verifyDeepSeek(base: string, key: string, model: string, started: number): Promise<TestResult> {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` }

  const text = await request(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Answer with the single word: ok' }]
    })
  })
  const echoed = text?.model ?? model

  let vision = false
  let visionNote = ''
  try {
    const result = await request(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What single color fills this image? Reply with one word.' },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${VISION_PROBE_PNG}` } }
            ]
          }
        ]
      })
    })
    const answer = String(result?.choices?.[0]?.message?.content ?? '').toLowerCase()
    vision = answer.includes('red')
    if (!vision) visionNote = ` · answered "${answer.slice(0, 20)}"`
  } catch (err) {
    visionNote = ` · image rejected (${(err as Error).message.slice(0, 60)})`
  }

  const listed = await listModels('deepseek')
  const inList = listed.length ? listed.includes(model) : undefined
  const latencyMs = Date.now() - started

  const bits = [echoed, vision ? 'vision ✓ → V4.1-Flash class' : 'no vision → not V4.1 Flash']
  if (echoed !== model) bits.push(`server reports ${echoed}`)
  if (inList === false) bits.push('not in model list')
  bits.push(`${latencyMs} ms`)

  return {
    ok: vision,
    message: bits.join(' · ') + visionNote,
    details: { model: echoed, latencyMs, vision, listed: inList }
  }
}

export async function verifyProvider(provider: ProviderId): Promise<TestResult> {
  const key = readKey(provider)
  if (!key) return { ok: false, message: 'No API key saved.' }
  const model = activeModel(provider)
  const base = activeBaseUrl(provider)
  const started = Date.now()

  try {
    if (provider === 'deepseek') return await verifyDeepSeek(base, key, model, started)

    if (provider === 'openrouter') {
      const json = await request(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Answer with the single word: ok' }]
        })
      })
      const echoed = json?.model ?? model
      const latencyMs = Date.now() - started
      return {
        ok: true,
        message: `${echoed} · replied in ${latencyMs} ms`,
        details: { model: echoed, latencyMs }
      }
    }

    if (provider === 'anthropic') {
      const json = await request(`${base}/v1/messages`, {
        method: 'POST',
        headers: anthropicHeaders(key),
        body: JSON.stringify({
          model,
          max_tokens: 32,
          messages: [{ role: 'user', content: 'Answer with the single word: ok' }]
        })
      })
      const echoed = json?.model ?? model
      const latencyMs = Date.now() - started
      return {
        ok: true,
        message: `${echoed} · replied in ${latencyMs} ms`,
        details: { model: echoed, latencyMs }
      }
    }

    const json = await request(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Answer with the single word: ok' }] }],
        generationConfig: { maxOutputTokens: 16 }
      })
    })
    const echoed = json?.modelVersion ?? model
    const latencyMs = Date.now() - started
    return {
      ok: true,
      message: `${echoed} · replied in ${latencyMs} ms`,
      details: { model: echoed, latencyMs }
    }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
