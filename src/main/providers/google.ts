import type { WireMessage } from '../../shared/types'
import { planFor } from '../pricing'
import type { StreamEvent, StreamFn } from './types'
import { assertOk, readSse } from './types'

function toSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema
  const input = schema as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === 'additionalProperties' || key === '$schema') continue
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, sub]) => [name, toSchema(sub)])
      )
    } else if (key === 'items') {
      out.items = toSchema(value)
    } else if (key === 'type' && typeof value === 'string') {
      out.type = value.toUpperCase()
    } else {
      out[key] = value
    }
  }
  return out
}

function toContents(messages: WireMessage[]): unknown[] {
  const out: any[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      const parts: any[] = []
      const text = [
        message.text,
        ...message.attachments
          .filter((attachment) => attachment.kind === 'text')
          .map((attachment) => `\n\n--- Attached file: ${attachment.name} ---\n\`\`\`\n${attachment.data}\n\`\`\``)
      ].join('')
      if (text.trim()) parts.push({ text })
      for (const attachment of message.attachments) {
        if (attachment.kind !== 'image') continue
        parts.push({ inlineData: { mimeType: attachment.mime, data: attachment.data } })
      }
      if (!parts.length) parts.push({ text: '(empty message)' })
      out.push({ role: 'user', parts })
      continue
    }

    const parts: any[] = []
    if (message.text.trim()) parts.push({ text: message.text })
    for (const tool of message.tools) {
      parts.push({ functionCall: { name: tool.name, args: tool.input ?? {} } })
    }
    if (!parts.length) parts.push({ text: '(no content)' })
    out.push({ role: 'model', parts })
    if (message.tools.length) {
      out.push({
        role: 'user',
        parts: message.tools.map((tool) => ({
          functionResponse: {
            name: tool.name,
            response: { result: tool.output ?? '(no output)' }
          }
        }))
      })
    }
  }
  return out
}

export const streamGoogle: StreamFn = async function* streamGoogle(req): AsyncGenerator<StreamEvent> {
  const plan = planFor('google', req.model, req.level)

  const generationConfig: Record<string, unknown> = { maxOutputTokens: req.maxTokens ?? plan.maxTokens }
  if (plan.thinkingLevel) {
    generationConfig.thinkingConfig = { thinkingLevel: plan.thinkingLevel }
  } else if (plan.geminiBudget != null) {
    generationConfig.thinkingConfig = { thinkingBudget: plan.geminiBudget }
  }

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: toContents(req.messages),
    generationConfig
  }
  if (req.tools.length) {
    body.tools = [
      {
        functionDeclarations: req.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: toSchema(tool.parameters)
        }))
      }
    ]
  }

  const url = `${req.baseUrl}/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(req.apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: req.signal
  })
  await assertOk(res, 'Google')

  let stopReason = 'STOP'
  let callIndex = 0
  let usage = { inputTokens: 0, outputTokens: 0 }

  for await (const data of readSse(res)) {
    let event: any
    try {
      event = JSON.parse(data)
    } catch {
      continue
    }

    if (event.error) throw new Error(event.error.message ?? 'Google stream error')

    if (event.usageMetadata) {
      usage = {
        inputTokens: event.usageMetadata.promptTokenCount ?? usage.inputTokens,
        outputTokens: event.usageMetadata.candidatesTokenCount ?? usage.outputTokens
      }
      yield { type: 'usage', usage }
    }

    const candidate = event.candidates?.[0]
    if (!candidate) continue
    if (candidate.finishReason) stopReason = candidate.finishReason

    for (const part of candidate.content?.parts ?? []) {
      if (part.functionCall) {
        yield {
          type: 'tool_use',
          call: {
            id: `g_${callIndex++}_${Math.random().toString(36).slice(2, 8)}`,
            name: part.functionCall.name,
            input: part.functionCall.args ?? {}
          }
        }
      } else if (typeof part.text === 'string' && part.text) {
        yield { type: part.thought ? 'thinking' : 'text', text: part.text }
      }
    }
  }

  yield { type: 'done', stopReason }
}
