import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  ChatMessage,
  Conversation,
  IncomingAttachment,
  ToolCallRecord,
  Usage,
  WireMessage
} from '../shared/types'
import { resolveAttachment, storeAttachment } from './attachments'
import { buildCandidates, type Candidate } from './free'
import { costOf } from './pricing'
import { streamFor, ProviderError } from './providers'
import { executeTool, previewToolCall, READ_ONLY, TOOL_DEFS } from './tools'
import {
  activeLevel,
  activeProvider,
  freeModeEnabled,
  getConversation,
  saveConversation,
  tokenSaver,
  workspace
} from './store'

const MAX_STEPS = 16
const MAX_HISTORY = 40
const SAVER_HISTORY = 8
const SAVER_TOKENS = 2048
const SAVER_TOOL_OUTPUT = 3000

export interface RunOptions {
  conversationId: string
  text: string
  agentMode: boolean
  attachments: IncomingAttachment[]
  emit: (event: AgentEvent) => void
  requestApproval: (call: ToolCallRecord) => Promise<boolean>
  signal: AbortSignal
}

function systemPrompt(agentMode: boolean, level: string, saver: boolean, free: boolean): string {
  const root = workspace()
  const lines = [
    "You are Sonekks Chat, a desktop AI assistant running locally on the user's Windows machine.",
    `Current date: ${new Date().toISOString().slice(0, 10)}.`,
    `Platform: Windows (win32). Workspace root: ${root}`,
    `Quality level: ${level}.`,
    saver ? 'Token saver is ON: be concise, skip restating the question, prefer short code and short answers.' : '',
    free ? 'You are running on a free-tier model: keep responses tight and avoid unnecessary long outputs.' : '',
    '',
    agentMode
      ? [
          'You are in AGENT MODE: you can inspect and change the machine with the provided tools.',
          'Rules:',
          '- Use tools instead of guessing about the local system.',
          '- All paths are relative to the workspace root unless absolute and inside it.',
          '- run_command uses PowerShell. Keep commands short and non-interactive.',
          '- Read a file before editing it; edit_file needs an exact, unique old_string.',
          '- After acting, verify when practical, then report the result in one or two sentences.',
          '- Never claim success you did not observe in tool output.',
          '- If a command fails, read the error and adapt; do not repeat the identical failing command.'
        ].join('\n')
      : [
          'You are in CHAT MODE: answer questions and write code in the message.',
          "You cannot read or modify the user's files right now. If a task needs local access, say that agent mode is required."
        ].join('\n')
  ]
  return lines.filter(Boolean).join('\n')
}

function trim(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[truncated]`
}

function toWire(messages: ChatMessage[], saver: boolean): WireMessage[] {
  const out: WireMessage[] = []
  const history = saver ? messages.slice(-SAVER_HISTORY) : messages.slice(-MAX_HISTORY)

  for (const message of history) {
    if (message.role === 'user') {
      const attachments = (message.attachments ?? [])
        .map(resolveAttachment)
        .filter((attachment): attachment is NonNullable<typeof attachment> => Boolean(attachment))
        .map((attachment) =>
          saver && attachment.kind === 'text' ? { ...attachment, data: trim(attachment.data, 4000) } : attachment
        )
      out.push({ role: 'user', text: message.text, attachments })
    } else {
      const tools = saver
        ? message.tools.map((tool) => ({ ...tool, output: trim(tool.output ?? '', SAVER_TOOL_OUTPUT) }))
        : message.tools
      out.push({ role: 'assistant', text: message.text, tools })
    }
  }
  return out
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ProviderError) {
    if ([429, 402, 401, 403, 500, 502, 503, 504].includes(err.status)) return true
  }
  const message = (err as Error)?.message ?? ''
  return /rate.?limit|quota|credits|insufficient|too many requests|overloaded/i.test(message)
}

function shortError(err: unknown): string {
  const message = (err as Error)?.message ?? 'error'
  return message.replace(/^[A-Za-z]+ \d{3}: /, '').slice(0, 80)
}

export async function runTurn(opts: RunOptions): Promise<void> {
  const conv = getConversation(opts.conversationId)
  if (!conv) {
    opts.emit({ type: 'error', conversationId: opts.conversationId, message: 'Conversation not found.' })
    return
  }

  const saver = tokenSaver()
  const free = freeModeEnabled()
  const candidates = await buildCandidates(free)

  if (!candidates.length) {
    opts.emit({
      type: 'error',
      conversationId: conv.id,
      message: free
        ? 'Free mode is on but no free models are reachable. Add an OpenRouter key (free models) or a Google key in Settings.'
        : `No API key saved for ${activeProvider()}. Open Settings and add one.`
    })
    opts.emit({ type: 'done', conversationId: conv.id, conversation: conv })
    return
  }

  const attachments = opts.attachments.map(storeAttachment)
  const userMessage: ChatMessage = {
    id: randomUUID(),
    role: 'user',
    text: opts.text,
    attachments: attachments.length ? attachments : undefined
  }
  conv.messages.push(userMessage)
  saveConversation(conv)

  const level = activeLevel()
  const system = systemPrompt(opts.agentMode, level, saver, free)
  const tools = opts.agentMode ? TOOL_DEFS : []
  let candidateIndex = 0

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (opts.signal.aborted) throw new DOMException('aborted', 'AbortError')

      const messageId = randomUUID()
      opts.emit({ type: 'start', conversationId: conv.id, messageId })

      let text = ''
      let usage: Usage = { inputTokens: 0, outputTokens: 0 }
      const toolCalls: ToolCallRecord[] = []
      let finished = false

      while (!finished) {
        const candidate: Candidate = candidates[Math.min(candidateIndex, candidates.length - 1)]
        const partial = Boolean(text || toolCalls.length)

        try {
          for await (const event of streamFor(candidate.provider)({
            provider: candidate.provider,
            model: candidate.model,
            apiKey: candidate.apiKey,
            baseUrl: candidate.baseUrl,
            level,
            system,
            messages: toWire(conv.messages, saver),
            tools,
            signal: opts.signal,
            maxTokens: saver ? SAVER_TOKENS : undefined
          })) {
            switch (event.type) {
              case 'text':
                text += event.text
                opts.emit({ type: 'delta', conversationId: conv.id, messageId, text: event.text })
                break
              case 'tool_use': {
                const record: ToolCallRecord = {
                  id: event.call.id,
                  name: event.call.name,
                  input: event.call.input
                }
                toolCalls.push(record)
                opts.emit({ type: 'tool', conversationId: conv.id, messageId, call: record, status: 'awaiting' })
                break
              }
              case 'usage':
                usage = {
                  inputTokens: Math.max(usage.inputTokens, event.usage.inputTokens),
                  outputTokens: Math.max(usage.outputTokens, event.usage.outputTokens)
                }
                break
              case 'thinking':
              case 'done':
                break
            }
          }
          finished = true
        } catch (err) {
          const aborted = (err as Error)?.name === 'AbortError'
          if (aborted || partial || !isRetryable(err)) throw err
          if (candidateIndex >= candidates.length - 1) throw err

          const next = candidates[candidateIndex + 1]
          opts.emit({
            type: 'notice',
            conversationId: conv.id,
            message: `${candidate.model} is limited (${shortError(err)}) — switching to ${next.model}`,
            level: 'warn'
          })
          candidateIndex++
        }
      }

      const chosen = candidates[Math.min(candidateIndex, candidates.length - 1)]
      const cost = costOf(chosen.model, usage)
      const assistantMessage: ChatMessage = {
        id: messageId,
        role: 'assistant',
        text,
        tools: toolCalls,
        usage,
        costUsd: cost,
        model: chosen.model,
        provider: chosen.provider
      }
      conv.messages.push(assistantMessage)
      saveConversation(conv)
      opts.emit({ type: 'usage', conversationId: conv.id, messageId, usage, costUsd: cost })

      if (!toolCalls.length) break

      for (const call of toolCalls) {
        if (opts.signal.aborted) throw new DOMException('aborted', 'AbortError')

        const needsApproval = !READ_ONLY.has(call.name)
        let approved = true
        if (needsApproval) {
          opts.emit({
            type: 'approval',
            conversationId: conv.id,
            call,
            preview: previewToolCall(call.name, call.input)
          })
          approved = await opts.requestApproval(call)
        }

        if (!approved) {
          call.output = 'The user denied this action.'
          call.isError = true
          opts.emit({
            type: 'tool-output',
            conversationId: conv.id,
            messageId,
            callId: call.id,
            output: call.output,
            isError: true,
            status: 'denied'
          })
          saveConversation(conv)
          continue
        }

        opts.emit({ type: 'tool', conversationId: conv.id, messageId, call, status: 'running' })
        const result = await executeTool(call.name, call.input, workspace(), opts.signal)
        call.output = result.output
        call.isError = result.isError
        saveConversation(conv)
        opts.emit({
          type: 'tool-output',
          conversationId: conv.id,
          messageId,
          callId: call.id,
          output: result.output,
          isError: result.isError,
          status: result.isError ? 'error' : 'done'
        })
      }
    }

    opts.emit({ type: 'done', conversationId: conv.id, conversation: conv })
  } catch (err) {
    const error = err as Error
    if (error.name === 'AbortError') {
      opts.emit({ type: 'aborted', conversationId: conv.id })
      opts.emit({ type: 'done', conversationId: conv.id, conversation: conv })
      return
    }
    opts.emit({ type: 'error', conversationId: conv.id, message: error.message || 'Unknown error' })
    opts.emit({ type: 'done', conversationId: conv.id, conversation: conv })
  }
}

export function conversationOrNull(id: string): Conversation | null {
  return getConversation(id)
}
