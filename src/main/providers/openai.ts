import type { WireMessage } from '../../shared/types'
import { planFor } from '../pricing'
import type { StreamEvent, StreamFn } from './types'
import { assertOk, readSse } from './types'

interface PartialCall {
  id: string
  name: string
  args: string
}

function toMessages(system: string, messages: WireMessage[]): unknown[] {
  const out: any[] = [{ role: 'system', content: system }]

  for (const message of messages) {
    if (message.role === 'user') {
      const text = [
        message.text,
        ...message.attachments
          .filter((attachment) => attachment.kind === 'text')
          .map((attachment) => `\n\n--- Attached file: ${attachment.name} ---\n\`\`\`\n${attachment.data}\n\`\`\``)
      ].join('')
      const images = message.attachments.filter((attachment) => attachment.kind === 'image')

      if (!images.length) {
        out.push({ role: 'user', content: text || '(empty message)' })
      } else {
        out.push({
          role: 'user',
          content: [
            { type: 'text', text: text || '(image attached)' },
            ...images.map((image) => ({
              type: 'image_url',
              image_url: { url: `data:${image.mime};base64,${image.data}` }
            }))
          ]
        })
      }
      continue
    }

    const entry: any = { role: 'assistant', content: message.text || null }
    if (message.tools.length) {
      entry.tool_calls = message.tools.map((tool) => ({
        id: tool.id,
        type: 'function',
        function: { name: tool.name, arguments: JSON.stringify(tool.input ?? {}) }
      }))
    }
    out.push(entry)
    for (const tool of message.tools) {
      out.push({ role: 'tool', tool_call_id: tool.id, content: tool.output ?? '(no output)' })
    }
  }
  return out
}

export const streamOpenAi: StreamFn = async function* streamOpenAi(req): AsyncGenerator<StreamEvent> {
  const plan = planFor(req.provider, req.model, req.level)
  const body: Record<string, unknown> = {
    model: req.model,
    messages: toMessages(req.system, req.messages),
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: req.maxTokens ?? plan.maxTokens
  }
  if (req.tools.length) {
    body.tools = req.tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters }
    }))
    body.tool_choice = 'auto'
  }
  if (plan.reasoningEffort) body.reasoning_effort = plan.reasoningEffort

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${req.apiKey}`
  }
  if (req.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://sonekk.local'
    headers['X-Title'] = 'Sonekks Chat'
  }

  const res = await fetch(`${req.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: req.signal
  })
  await assertOk(res, 'Provider')

  const calls = new Map<number, PartialCall>()
  let stopReason = 'stop'
  let usage = { inputTokens: 0, outputTokens: 0 }

  for await (const data of readSse(res)) {
    let event: any
    try {
      event = JSON.parse(data)
    } catch {
      continue
    }

    if (event.error) throw new Error(event.error.message ?? 'Provider stream error')

    if (event.usage) {
      usage = {
        inputTokens: event.usage.prompt_tokens ?? usage.inputTokens,
        outputTokens: event.usage.completion_tokens ?? usage.outputTokens
      }
      yield { type: 'usage', usage }
    }

    const choice = event.choices?.[0]
    if (!choice) continue
    const delta = choice.delta ?? {}

    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      yield { type: 'thinking', text: delta.reasoning_content }
    }
    if (typeof delta.content === 'string' && delta.content) {
      yield { type: 'text', text: delta.content }
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const part of delta.tool_calls) {
        const index = typeof part.index === 'number' ? part.index : 0
        const current = calls.get(index) ?? { id: '', name: '', args: '' }
        if (part.id) current.id = part.id
        if (part.function?.name) current.name += part.function.name
        if (part.function?.arguments) current.args += part.function.arguments
        calls.set(index, current)
      }
    }
    if (choice.finish_reason) stopReason = choice.finish_reason
  }

  for (const [index, call] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
    let input: Record<string, unknown> = {}
    if (call.args.trim()) {
      try {
        input = JSON.parse(call.args)
      } catch {
        input = { _raw: call.args }
      }
    }
    yield {
      type: 'tool_use',
      call: { id: call.id || `call_${index}_${Date.now()}`, name: call.name, input }
    }
  }

  yield { type: 'done', stopReason }
}
