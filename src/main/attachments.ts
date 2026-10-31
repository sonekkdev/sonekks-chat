import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Attachment, IncomingAttachment, ResolvedAttachment } from '../shared/types'

const MAX_TEXT = 200_000

function dir(): string {
  const path = join(app.getPath('userData'), 'attachments')
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
  return path
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)
}

export function storeAttachment(input: IncomingAttachment): Attachment {
  const id = randomUUID()
  if (input.kind === 'image') {
    const ext = extname(input.name) || '.png'
    const file = join(dir(), `${id}${ext}`)
    writeFileSync(file, Buffer.from(input.data, 'base64'))
    return { id, name: input.name, mime: input.mime, kind: 'image', size: input.size, path: file }
  }
  const text = input.data.slice(0, MAX_TEXT)
  return { id, name: input.name, mime: input.mime, kind: 'text', size: input.size, text }
}

export function resolveAttachment(attachment: Attachment): ResolvedAttachment | null {
  if (attachment.kind === 'image') {
    if (!attachment.path || !existsSync(attachment.path)) return null
    try {
      return {
        name: attachment.name,
        mime: attachment.mime,
        kind: 'image',
        data: readFileSync(attachment.path).toString('base64')
      }
    } catch {
      return null
    }
  }
  return { name: attachment.name, mime: attachment.mime, kind: 'text', data: attachment.text ?? '' }
}
