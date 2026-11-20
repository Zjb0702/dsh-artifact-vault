// Tool-call → artifact extraction. Pure functions: the caller resolves paths
// against the session cwd and filters with fs. Kept dependency-free so the
// rules can be unit-tested.
import { expandUser, extOf, isArtifactExt, looksLikePath } from './util.js'

/** Tools that only ever name the file they write. */
const STRICT_WRITE_TOOLS = new Set([
  'write', 'write_file', 'create_file', 'edit', 'multi_edit', 'str_replace_editor',
  'notebook_edit', 'apply_patch', 'patch_file', 'save_file', 'create_directory',
  'office_docx_create', 'office_docx_edit', 'office_pptx_create', 'office_pptx_edit',
  'office_xlsx_create', 'office_xlsx_edit', 'office_render', 'office_convert', 'office_recalculate',
  'ppt_create', 'ppt_edit', 'ppt_render', 'ppt_data', 'dsh_ppt', 'docx_create', 'xlsx_create',
  'pptx_create', 'generate_image', 'image_gen', 'text_to_image', 'export_data',
])

/** Anything whose name starts with one of these is treated as a writer. */
const WRITER_PREFIX = /^(?:write|edit|create|save|export|generate|render|convert|apply|patch|compile|build|download|dump|upload|publish|package|archive)_/u

const PATH_KEYS = new Set([
  'file_path', 'filepath', 'filePath', 'path', 'paths', 'filename', 'file_name', 'fileName',
  'notebook_path', 'notebookPath', 'output_path', 'outputPath', 'output', 'out', 'dst', 'dest',
  'destination', 'target', 'target_path', 'targetPath', 'save_path', 'savePath', 'source_path',
  'src', 'from', 'to', 'output_file', 'outputFile', 'dir', 'directory', 'folder', 'cwd',
  'deckPath', 'pptxPath', 'docxPath', 'xlsxPath', 'outDir', 'outputDir', 'outdir',
])

/** Values that contain prose/code rather than file names; never scanned. */
const SKIP_KEYS = new Set([
  'content', 'text', 'new_string', 'old_string', 'oldtext', 'newtext', 'patch', 'input', 'code',
  'source', 'body', 'diff', 'command', 'script', 'instructions', 'description', 'message',
  'prompt', 'query', 'url', 'href', 'note', 'notes', 'summary', 'title', 'label', 'css', 'html',
  'markdown', 'md', 'template', 'caption',
])

const SHELL_TOOLS = new Set(['bash', 'sh', 'shell', 'exec', 'exec_command', 'run_command', 'pwsh', 'powershell', 'cmd', 'terminal', 'bash_exec', 'run_code'])

/** Tools that only ever READ a path: touching it is not producing it. */
const READ_ONLY_TOOLS = new Set([
  'read', 'read_file', 'readfile', 'cat', 'view', 'open_file', 'openfile', 'sed', 'awk', 'head',
  'tail', 'wc', 'diff', 'grep', 'rg', 'search', 'find', 'fd', 'glob', 'ls', 'dir', 'list',
  'list_files', 'list_directory', 'listdir', 'tree', 'stat', 'file', 'file_info', 'strings',
  'hexdump', 'xxd', 'md5sum', 'sha256sum', 'shasum', 'codegraph', 'session_search',
  'session_event_search', 'cache_search', 'web_search', 'web_fetch', 'research',
])

/**
 * A shell token that survived quoting is still not a path if it carries code
 * punctuation: `> {console.log` out of a heredoc must not become an artifact.
 */
const NOT_A_PATH = /[\s{};|`'"()<>*?\[\]]/u

/** Shell redirects and copy/move destinations (low confidence, fs-verified later). */
function extractShellPaths(command) {
  const text = String(command ?? '')
  if (text === '') return []
  const found = []
  const push = (raw) => {
    const value = String(raw ?? '').replace(/^["']|["']$/gu, '').trim()
    if (value === '' || value === '/dev/null' || value === 'nul' || value.startsWith('&')) return
    if (/^\d*[<>]$/u.test(value)) return
    if (NOT_A_PATH.test(value)) return
    // A shell token with no separator is more often a bare word (`> log.txt`
    // inside a heredoc, `2> console.log`) than a real relative path.
    if (!value.includes('/') && !value.includes('\\')) return
    found.push({ raw: value, conf: 'low' })
  }
  const redirect = />>?\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s;&|<>()]+)/gu
  for (const match of text.matchAll(redirect)) push(match[1])
  const tee = /\btee\s+(?:-a\s+)?("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s;&|]+)/gu
  for (const match of text.matchAll(tee)) push(match[1])
  const copyMove = /\b(cp|mv|install|ln)\s+(?:-[a-zA-Z]+\s+)*(?:[^\s;&|]+\s+)+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s;&|]+)/gu
  for (const match of text.matchAll(copyMove)) {
    const candidate = match[2]
    if (candidate === undefined) continue
    if (candidate.startsWith('-')) continue
    push(candidate)
  }
  const outputFlag = /\s(?:-o|--output(?:-dir)?|-out)\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s;&|]+)/gu
  for (const match of text.matchAll(outputFlag)) push(match[1])
  return found
}

/** Parse apply_patch style envelopes. */
function extractPatchPaths(text) {
  const found = []
  const pattern = /^\*\*\*\s*(?:Add|Update|Delete|Move to)\s+File:\s*(.+)$/gmu
  for (const match of String(text ?? '').matchAll(pattern)) {
    const raw = match[1].trim()
    if (raw !== '') found.push({ raw, conf: 'high' })
  }
  const movePattern = /^\*\*\*\s*Move to:\s*(.+)$/gmu
  for (const match of String(text ?? '').matchAll(movePattern)) {
    const raw = match[1].trim()
    if (raw !== '') found.push({ raw, conf: 'high' })
  }
  return found
}

function pathLikeKey(key) {
  if (PATH_KEYS.has(key)) return true
  return false
}

function collect(value, out, depth, insidePathKey) {
  if (value === null || value === undefined) return
  if (typeof value === 'string') {
    const text = value.trim()
    if (text === '' || text.length > 1024) return
    if (NOT_A_PATH.test(text)) return
    if (!looksLikePath(text)) return
    if (insidePathKey) out.push({ raw: text, conf: 'high' })
    else if (isArtifactExt(text.split('?')[0].split('.').pop() ?? '')) out.push({ raw: text, conf: 'high' })
    return
  }
  if (Array.isArray(value)) {
    if (depth > 3) return
    for (const item of value) collect(item, out, depth + 1, insidePathKey)
    return
  }
  if (typeof value !== 'object') return
  if (depth > 3) return
  for (const [key, child] of Object.entries(value)) {
    const lower = String(key).toLowerCase()
    if (SKIP_KEYS.has(lower)) continue
    collect(child, out, depth + 1, pathLikeKey(key) || pathLikeKey(lower))
  }
}

/**
 * Extract the file paths one tool call may have produced.
 * @param {{name?: string, arguments?: unknown}} call
 * @param {{cwd?: string, home?: string}} options
 * @returns {{raw: string, conf: 'high'|'low', declared?: boolean, label?: string, via: string}[]}
 */
export function extractToolPaths(call, options = {}) {
  const name = String(call?.name ?? '')
  const lowerName = name.toLowerCase()
  if (READ_ONLY_TOOLS.has(lowerName)) return []
  const home = options.home ?? ''
  let args = call?.arguments
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      args = undefined
    }
  }
  if (args === null || typeof args !== 'object') {
    if (SHELL_TOOLS.has(lowerName) && typeof call?.arguments === 'string') {
      return extractShellPaths(call.arguments).map((entry) => ({ ...entry, via: name }))
    }
    return []
  }

  const out = []

  if (SHELL_TOOLS.has(lowerName)) {
    const command = args.command ?? args.cmd ?? args.script ?? args.input ?? args.code
    if (typeof command === 'string') {
      for (const entry of extractShellPaths(command)) out.push({ ...entry, via: name })
    }
    return out
  }

  if (lowerName === 'present') {
    const files = Array.isArray(args.files) ? args.files : Array.isArray(args.paths) ? args.paths : []
    for (const entry of files) {
      if (typeof entry === 'string') {
        out.push({ raw: entry, conf: 'high', declared: true, via: name })
        continue
      }
      if (entry === null || typeof entry !== 'object') continue
      const raw = entry.path ?? entry.file ?? entry.file_path ?? entry.name
      if (typeof raw !== 'string') continue
      const label = typeof entry.description === 'string' ? entry.description : typeof entry.title === 'string' ? entry.title : undefined
      out.push({ raw, conf: 'high', declared: true, label, via: name })
    }
    if (typeof args.path === 'string') out.push({ raw: args.path, conf: 'high', declared: true, via: name })
    return out
  }

  if (lowerName === 'apply_patch' || lowerName === 'patch_file' || lowerName === 'patch') {
    for (const key of ['patch', 'input', 'patchText', 'text', 'diff']) {
      if (typeof args[key] === 'string') {
        for (const entry of extractPatchPaths(args[key])) out.push({ ...entry, via: name })
      }
    }
    collect(args, out, 0, false)
    return dedupe(out, name)
  }

  const strict = STRICT_WRITE_TOOLS.has(lowerName) || WRITER_PREFIX.test(lowerName)
  collect(args, out, 0, false)
  if (strict) {
    // Inside a known writer every path-shaped string is fair game.
    for (const entry of out) entry.conf = 'high'
  } else {
    // Unknown tool: only keep strings that look like real artifacts on disk.
    const filtered = out.filter((entry) => {
      const cleaned = expandUser(entry.raw, home).replace(/^["']|["']$/gu, '')
      if (NOT_A_PATH.test(cleaned)) return false
      const ext = cleaned.split(/[\\/]/u).pop()?.split('.').pop() ?? ''
      return isArtifactExt(ext)
    })
    out.length = 0
    out.push(...filtered)
  }
  return dedupe(out, name)
}

function dedupe(entries, via) {
  const seen = new Set()
  const out = []
  for (const entry of entries) {
    const key = String(entry.raw).trim().toLowerCase()
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push({ ...entry, via: entry.via ?? via })
  }
  return out
}
