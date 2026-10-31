import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { existsSync, readFileSync, statSync } from 'node:fs'
import * as path from 'node:path'

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'run_command',
    description:
      'Run a PowerShell command on the local Windows machine and return stdout/stderr. Use it to inspect the system, run builds, git, npm, scripts. Prefer non-interactive commands that terminate on their own.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'PowerShell command line to execute.' },
        cwd: { type: 'string', description: 'Working directory relative to the workspace root. Defaults to the root.' },
        timeout_ms: { type: 'integer', description: 'Hard timeout in milliseconds (default 60000, max 300000).' }
      },
      required: ['command']
    }
  },
  {
    name: 'read_file',
    description: 'Read a text file from the workspace. Returns raw content, optionally a 1-based line range.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root.' },
        start_line: { type: 'integer', description: 'First line to return (1-based, inclusive).' },
        end_line: { type: 'integer', description: 'Last line to return (1-based, inclusive).' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a text file in the workspace, creating parent directories as needed.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root.' },
        content: { type: 'string', description: 'Full file content to write.' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description:
      'Replace an exact string in a workspace file. old_string must match byte-for-byte exactly once unless replace_all is true.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root.' },
        old_string: { type: 'string', description: 'Exact existing text to replace.' },
        new_string: { type: 'string', description: 'Replacement text.' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence.' }
      },
      required: ['path', 'old_string', 'new_string']
    }
  },
  {
    name: 'list_dir',
    description: 'List a directory tree in the workspace. Skips noise folders such as node_modules and .git.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory relative to the workspace root. Defaults to the root.' },
        depth: { type: 'integer', description: 'Recursion depth, 1-4 (default 2).' }
      }
    }
  },
  {
    name: 'search_files',
    description: 'Search file contents in the workspace with a regular expression. Returns path:line matches.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'JavaScript regular expression, matched per line.' },
        path: { type: 'string', description: 'Directory to search, relative to the workspace root.' },
        glob: { type: 'string', description: 'Optional filename filter, e.g. "*.ts" or "*.{ts,tsx}".' },
        max_results: { type: 'integer', description: 'Maximum matches to return (default 80).' }
      },
      required: ['pattern']
    }
  }
]

export const READ_ONLY = new Set(['read_file', 'list_dir', 'search_files'])

const MAX_OUTPUT = 30000
const MAX_READ = 120000
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'target', '.next', '.venv', 'venv', '__pycache__', '.idea', '.cache'])

export interface ToolResult {
  output: string
  isError: boolean
}

function truncate(text: string, limit = MAX_OUTPUT): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n\n[... truncated ${text.length - limit} characters]`
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.length) throw new Error(`missing string field "${field}"`)
  return value
}

function asInt(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : fallback
}

function resolveInside(root: string, rel: string): string {
  const abs = path.resolve(root, rel)
  const normalizedRoot = path.resolve(root)
  if (abs !== normalizedRoot && !abs.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`path "${rel}" resolves outside the workspace root`)
  }
  return abs
}

function globToRegExp(glob: string): RegExp {
  let out = '^'
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += '.*'
        i++
      } else {
        out += '[^/\\\\]*'
      }
    } else if (ch === '?') {
      out += '.'
    } else if (ch === '{') {
      const end = glob.indexOf('}', i)
      if (end > i) {
        out += `(${glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`
        i = end
      } else {
        out += '\\{'
      }
    } else {
      out += ch.replace(/[.+^$()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(out + '$', 'i')
}

function isBinary(buffer: Buffer): boolean {
  const end = Math.min(buffer.length, 4096)
  for (let i = 0; i < end; i++) if (buffer[i] === 0) return true
  return false
}

async function runCommand(input: Record<string, unknown>, root: string, signal: AbortSignal): Promise<ToolResult> {
  const command = asString(input.command, 'command')
  const cwd = input.cwd ? resolveInside(root, String(input.cwd)) : root
  const timeout = Math.min(Math.max(asInt(input.timeout_ms, 60000), 1000), 300000)

  if (!existsSync(cwd)) return { output: `working directory does not exist: ${cwd}`, isError: true }

  return new Promise<ToolResult>((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd,
      windowsHide: true,
      env: { ...process.env, TERM: 'dumb' }
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const finish = (result: ToolResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(result)
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeout)

    const onAbort = (): void => {
      child.kill()
      finish({ output: 'Command aborted by the user.', isError: true })
    }
    signal.addEventListener('abort', onAbort)

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString('utf8')
      if (stdout.length > MAX_OUTPUT * 2) stdout = stdout.slice(-MAX_OUTPUT * 2)
    })
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf8')
      if (stderr.length > MAX_OUTPUT * 2) stderr = stderr.slice(-MAX_OUTPUT * 2)
    })
    child.on('error', (err) => finish({ output: err.message, isError: true }))
    child.on('close', (code) => {
      const parts: string[] = []
      if (stdout.trim()) parts.push(stdout.trimEnd())
      if (stderr.trim()) parts.push(`[stderr]\n${stderr.trimEnd()}`)
      if (!parts.length) parts.push('(no output)')
      if (timedOut) parts.push(`[timed out after ${timeout} ms]`)
      parts.push(`[exit code ${code ?? 'unknown'}]`)
      finish({ output: truncate(parts.join('\n\n')), isError: code !== 0 || timedOut })
    })
  })
}

async function readFile(input: Record<string, unknown>, root: string): Promise<ToolResult> {
  const abs = resolveInside(root, asString(input.path, 'path'))
  const stat = await fs.stat(abs)
  if (stat.isDirectory()) return { output: `${input.path} is a directory; use list_dir`, isError: true }
  if (stat.size > 4 * 1024 * 1024) return { output: `file is too large to read (${stat.size} bytes)`, isError: true }
  const raw = await fs.readFile(abs, 'utf8')
  if (isBinary(Buffer.from(raw.slice(0, 512)))) return { output: `${input.path} looks binary`, isError: true }

  const lines = raw.split(/\r?\n/)
  const start = Math.max(asInt(input.start_line, 1), 1)
  const end = input.end_line ? Math.min(asInt(input.end_line, lines.length), lines.length) : lines.length
  const slice = lines.slice(start - 1, end).join('\n')
  const header = `# ${input.path} (lines ${start}-${end} of ${lines.length})${start > 1 || end < lines.length ? '' : ''}\n`
  return { output: truncate(header + slice, MAX_READ), isError: false }
}

async function writeFile(input: Record<string, unknown>, root: string): Promise<ToolResult> {
  const rel = asString(input.path, 'path')
  const abs = resolveInside(root, rel)
  const content = typeof input.content === 'string' ? input.content : ''
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, 'utf8')
  const lines = content.split(/\r?\n/).length
  return { output: `wrote ${lines} lines (${Buffer.byteLength(content, 'utf8')} bytes) to ${rel}`, isError: false }
}

async function editFile(input: Record<string, unknown>, root: string): Promise<ToolResult> {
  const rel = asString(input.path, 'path')
  const abs = resolveInside(root, rel)
  const oldString = asString(input.old_string, 'old_string')
  const newString = typeof input.new_string === 'string' ? input.new_string : ''
  const replaceAll = input.replace_all === true
  const raw = await fs.readFile(abs, 'utf8')

  const count = raw.split(oldString).length - 1
  if (count === 0) return { output: 'old_string was not found in the file', isError: true }
  if (count > 1 && !replaceAll) {
    return { output: `old_string matched ${count} times; add more context or set replace_all`, isError: true }
  }
  const next = replaceAll ? raw.split(oldString).join(newString) : raw.replace(oldString, newString)
  await fs.writeFile(abs, next, 'utf8')
  return { output: `patched ${rel} (${count} replacement${count === 1 ? '' : 's'})`, isError: false }
}

async function listDir(input: Record<string, unknown>, root: string): Promise<ToolResult> {
  const rel = input.path ? String(input.path) : '.'
  const abs = resolveInside(root, rel)
  const depth = Math.min(Math.max(asInt(input.depth, 2), 1), 4)
  const lines: string[] = []

  const walk = async (dir: string, prefix: string, level: number): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) {
        lines.push(`${prefix}${entry.name}/`)
        continue
      }
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`)
        if (level < depth) await walk(full, prefix + '  ', level + 1)
      } else {
        let size = ''
        try {
          size = ` (${(await fs.stat(full)).size}b)`
        } catch {
          /* ignore */
        }
        lines.push(`${prefix}${entry.name}${size}`)
      }
      if (lines.length > 600) return
    }
  }

  await walk(abs, '', 1)
  return { output: truncate(`${rel === '.' ? '.' : rel}/\n${lines.join('\n')}`), isError: false }
}

async function searchFiles(input: Record<string, unknown>, root: string, signal: AbortSignal): Promise<ToolResult> {
  const pattern = asString(input.pattern, 'pattern')
  let regex: RegExp
  try {
    regex = new RegExp(pattern, 'g')
  } catch (err) {
    return { output: `invalid pattern: ${(err as Error).message}`, isError: true }
  }
  const baseRel = input.path ? String(input.path) : '.'
  const base = resolveInside(root, baseRel)
  const glob = input.glob ? globToRegExp(String(input.glob)) : null
  const max = Math.min(Math.max(asInt(input.max_results, 80), 1), 400)
  const matches: string[] = []
  let scanned = 0

  const walk = async (dir: string): Promise<void> => {
    if (matches.length >= max || signal.aborted) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (matches.length >= max || signal.aborted) return
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(full)
        continue
      }
      if (glob && !glob.test(entry.name)) continue
      scan(entry.name, full)
    }
  }

  const scan = (name: string, full: string): void => {
    if (++scanned > 4000) return
    let buffer: Buffer
    try {
      const stat = statSync(full)
      if (stat.size > 2 * 1024 * 1024) return
      buffer = readFileSync(full)
    } catch {
      return
    }
    if (isBinary(buffer)) return
    const text = buffer.toString('utf8')
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length && matches.length < max; i++) {
      regex.lastIndex = 0
      if (regex.test(lines[i])) {
        matches.push(`${path.relative(root, full).replace(/\\/g, '/')}:${i + 1}: ${lines[i].trim().slice(0, 220)}`)
      }
    }
  }

  await walk(base)
  if (!matches.length) return { output: 'no matches', isError: false }
  return { output: truncate(matches.join('\n')), isError: false }
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  root: string,
  signal: AbortSignal
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'run_command':
        return await runCommand(input, root, signal)
      case 'read_file':
        return await readFile(input, root)
      case 'write_file':
        return await writeFile(input, root)
      case 'edit_file':
        return await editFile(input, root)
      case 'list_dir':
        return await listDir(input, root)
      case 'search_files':
        return await searchFiles(input, root, signal)
      default:
        return { output: `unknown tool: ${name}`, isError: true }
    }
  } catch (err) {
    return { output: (err as Error).message, isError: true }
  }
}

export function previewToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'run_command':
      return String(input.command ?? '')
    case 'write_file':
      return `${input.path} — ${Buffer.byteLength(String(input.content ?? ''), 'utf8')} bytes`
    case 'edit_file':
      return `${input.path} — replace ${Buffer.byteLength(String(input.old_string ?? ''), 'utf8')} bytes`
    case 'read_file':
    case 'list_dir':
    case 'search_files':
      return String(input.path ?? '.')
    default:
      return ''
  }
}
