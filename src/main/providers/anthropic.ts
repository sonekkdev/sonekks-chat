import type { WireMessage } from '../../shared/types'
import { planFor } from '../pricing'
import type { StreamEvent, StreamFn } from './types'
import { assertOk, readSse } from './types'

interface Block {
  id: string
  name: string
  json: string
}

function textAttachments(m: Extract<WireMessage, { role: 'user' }>): string {
  const parts = [m.text]
  for (const attachment of m.attachments) {
    if (attachment.kind !== 'text') continue
    parts.push(`\n\n--- Attached file: ${attachment.name} ---\n\`\`\`\n${attachment.data}\n\`\`\``)
  }
  return parts.join('')
}

function toMessages(messages: WireMessage[]): unknown[] {
  const out: unknown[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      const blocks: unknown[] = []
      const text = textAttachments(message)
      if (text.trim()) blocks.push({ type: 'text', text })
      for (const attachment of message.attachments) {
        if (attachment.kind !== 'image') continue
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: attachment.mime, data: attachment.data }
        })
      }
      if (!blocks.length) blocks.push({ type: 'text', text: '(empty message)' })
      out.push({ role: 'user', content: blocks })
      continue
    }

    const content: unknown[] = []
    if (message.text.trim()) content.push({ type: 'text', text: message.text })
    for (const tool of message.tools) {
      content.push({ type: 'tool_use', id: tool.id, name: tool.name, input: tool.input })
    }
    if (!content.length) content.push({ type: 'text', text: '(no content)' })
    out.push({ role: 'assistant', content })
    if (message.tools.length) {
      out.push({
        role: 'user',
        content: message.tools.map((tool) => ({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: tool.output ?? '(no output)',
          is_error: Boolean(tool.isError)
        }))
      })
    }
  }
  return out
}

export const streamAnthropic: StreamFn = async function* streamAnthropic(req): AsyncGenerator<StreamEvent> {
  const plan = planFor('anthropic', req.model, req.level)
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? plan.maxTokens,
    system: req.system,
    messages: toMessages(req.messages),
    stream: true
  }
  if (req.tools.length) {
    body.tools = req.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }))
  }
  if (plan.thinkingBudget) {
    body.thinking = { type: 'enabled', budget_tokens: plan.thinkingBudget }
    body.max_tokens = Math.max(Number(body.max_tokens), plan.thinkingBudget + 2048)
  }
  if (plan.effort) {
    body.output_config = { effort: plan.effort }
  }

  const res = await fetch(`${req.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': req.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body),
    signal: req.signal
  })
  await assertOk(res, 'Anthropic')

  const blocks = new Map<number, Block>()
  let inputTokens = 0
  let outputTokens = 0
  let stopReason = 'end_turn'

  for await (const data of readSse(res)) {
    let event: any
    try {
      event = JSON.parse(data)
    } catch {
      continue
    }

    switch (event.type) {
      case 'message_start': {
        const usage = event.message?.usage ?? {}
        inputTokens =
          (usage.input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0)
        outputTokens = usage.output_tokens ?? 0
        yield { type: 'usage', usage: { inputTokens, outputTokens } }
        break
      }
      case 'content_block_start': {
        const block = event.content_block
        if (block?.type === 'tool_use') {
          blocks.set(event.index, { id: block.id, name: block.name, json: '' })
        }
        break
      }
      case 'content_block_delta': {
        const delta = event.delta
        if (delta?.type === 'text_delta' && delta.text) {
          yield { type: 'text', text: delta.text }
        } else if (delta?.type === 'thinking_delta' && delta.thinking) {
          yield { type: 'thinking', text: delta.thinking }
        } else if (delta?.type === 'input_json_delta') {
          const block = blocks.get(event.index)
          if (block) block.json += delta.partial_json ?? ''
        }
        break
      }
      case 'content_block_stop': {
        const block = blocks.get(event.index)
        if (block) {
          let input: Record<string, unknown> = {}
          if (block.json.trim()) {
            try {
              input = JSON.parse(block.json)
            } catch {
              input = {}
            }
          }
          blocks.delete(event.index)
          yield { type: 'tool_use', call: { id: block.id, name: block.name, input } }
        }
        break
      }
      case 'message_delta': {
        if (event.delta?.stop_reason) stopReason = event.delta.stop_reason
        if (event.usage?.output_tokens != null) {
          outputTokens = Math.max(outputTokens, event.usage.output_tokens)
          yield { type: 'usage', usage: { inputTokens, outputTokens } }
        }
        break
      }
      case 'error': {
        throw new Error(event.error?.message ?? 'Anthropic stream error')
      }
    }
  }

  yield { type: 'done', stopReason }
}
