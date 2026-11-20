// Pure helpers shared by the host half: path keys, artifact grouping, sizes,
// and crash-safe JSON persistence. No Cordis / DSH imports here on purpose so
// this module can be unit-tested with plain node.
import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'

/** Comparison key for a path: absolute and case-folded on Windows. */
export function pathKey(p) {
  const resolved = path.resolve(String(p))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** Expand a leading `~` to the current user's home directory. */
export function expandUser(p, home) {
  const text = String(p ?? '').trim()
  if (text === '~') return home
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(home, text.slice(2))
  return text
}

/** Whether `child` is `parent` itself or lives below it. */
export function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

// Ambiguous glyphs (0/o, 1/l/i) are excluded so a folder name can be typed
// back from memory or a screenshot without guessing.
const SESSION_ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/**
 * Stable short id for one Session: a digest of the durable session id, in the
 * same 8-character shape the user asked for, so the workspace folder can be
 * found from the id printed in the panel without any lookup table.
 */
export function shortSessionId(sessionId, length = 8) {
  const digest = createHash('sha256').update(String(sessionId ?? '')).digest()
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += SESSION_ID_ALPHABET[digest[i] % SESSION_ID_ALPHABET.length]
  }
  return out
}

/** `20261118-a1b2c3d4`: local creation date plus the short session id. */
export function sessionFolderName(createdAt, shortId) {
  const date = new Date(Number(createdAt) || Date.now())
  const y = String(date.getFullYear())
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}-${shortId}`
}

/**
 * Which compartment of a session workspace a path belongs to:
 * `tools` (script written during the run), `artifacts` (deliverable),
 * `loose` (a file dropped in the workspace root), or `outside`.
 */
export function folderArea(absPath, folder) {
  if (!folder) return 'outside'
  if (!isInside(folder, absPath)) return 'outside'
  const rel = path.relative(path.resolve(folder), path.resolve(absPath))
  if (rel === '') return 'loose'
  const top = rel.split(path.sep)[0].toLowerCase()
  if (top === 'tools') return 'tools'
  if (top === 'artifacts') return 'artifacts'
  return 'loose'
}

/** Relative display form when the file lives inside a known root. */
export function displayName(abs, roots = []) {
  for (const root of roots) {
    if (!root) continue
    if (isInside(root, abs)) {
      const rel = path.relative(path.resolve(root), path.resolve(abs))
      return rel === '' ? path.basename(abs) : rel.split(path.sep).join('/')
    }
  }
  return abs.split(path.sep).join('/')
}

/** Size in a compact human form. */
export function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let index = 0
  let size = bytes
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size >= 100 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`
}

const SUFFIX_PATTERNS = [
  /[\s._-]*[\(\[（]\s*\d+\s*[\)\]）]$/u,
  /[\s._-]*(?:v|ver|version|版本|第)\s*\d+(?:[._-]\d+)*\s*(?:版)?$/iu,
  /[\s._-]*(?:final|finale|done|draft|copy|backup|bak|latest|旧版|新版|最新|最终|定稿|草稿|备份|副本|修改版|修订版|更新版|增强版|精简版|完整版|正式版)(?:[\s._-]*\d+)?(?:版)?$/iu,
  /[\s._-]*20\d{6}(?:[\s._-]?\d{4,6})?$/u,
  /[\s._-]*20\d{2}[-_.年]\d{1,2}[-_.月]\d{1,2}日?$/u,
]

/**
 * Strip version-ish suffixes from a file stem so `report`, `report_v2` and
 * `report-最终版` collapse into one logical artifact name.
 */
export function normalizeStem(input) {
  const original = String(input)
  let stem = original.trim()
  for (let round = 0; round < 8; round += 1) {
    let changed = false
    for (const pattern of SUFFIX_PATTERNS) {
      const next = stem.replace(pattern, '').trim()
      // Never consume the whole stem: a bare date or `v2` file keeps the last
      // meaningful piece instead of collapsing back to the raw name.
      if (next === stem || next === '') continue
      stem = next
      changed = true
    }
    if (!changed) break
  }
  return stem === '' ? original : stem
}

/** Stable identity of one logical artifact (directory + normalized stem + extension). */
export function groupKeyOf(absPath) {
  const dir = path.dirname(path.resolve(absPath))
  const base = path.basename(absPath)
  const ext = path.extname(base)
  const stem = ext === '' ? base : base.slice(0, base.length - ext.length)
  return `${pathKey(dir)}|${normalizeStem(stem).toLowerCase()}|${ext.toLowerCase()}`
}

/** Extension without the dot, lowercased. */
export function extOf(absPath) {
  return path.extname(absPath).replace(/^\./u, '').toLowerCase()
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const DOC_EXT = new Set(['md', 'txt', 'docx', 'doc', 'pdf', 'rtf', 'odt'])
const SHEET_EXT = new Set(['xlsx', 'xls', 'csv', 'tsv', 'ods'])
const SLIDE_EXT = new Set(['pptx', 'ppt', 'key', 'odp'])
const CODE_EXT = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'h', 'cc', 'cpp', 'cs',
  'rb', 'php', 'sh', 'bash', 'ps1', 'bat', 'lua', 'kt', 'swift', 'scala', 'vue', 'svelte',
])
const DATA_EXT = new Set(['json', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm', 'css', 'sql', 'ini', 'cfg', 'conf', 'log'])
const ARCHIVE_EXT = new Set(['zip', 'tar', 'gz', 'tgz', '7z', 'rar', 'xz', 'bz2', 'zst', 'qcow2', 'img', 'iso', 'exe', 'dll', 'so', 'dylib', 'wasm', 'bin'])

export function isArtifactExt(ext) {
  const e = String(ext).toLowerCase()
  return IMAGE_EXT.has(e) || DOC_EXT.has(e) || SHEET_EXT.has(e) || SLIDE_EXT.has(e) || CODE_EXT.has(e) || DATA_EXT.has(e) || ARCHIVE_EXT.has(e)
}

/** Coarse kind used by the UI for icons and filters. */
export function kindOf(absPath) {
  const e = extOf(absPath)
  if (IMAGE_EXT.has(e)) return 'image'
  if (DOC_EXT.has(e)) return 'doc'
  if (SHEET_EXT.has(e)) return 'sheet'
  if (SLIDE_EXT.has(e)) return 'slide'
  if (CODE_EXT.has(e)) return 'code'
  if (DATA_EXT.has(e)) return 'data'
  if (ARCHIVE_EXT.has(e)) return 'archive'
  return 'other'
}

/** Whether a raw string plausibly names a file path (not a URL, not prose). */
export function looksLikePath(value) {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (text === '' || text.length > 1024) return false
  if (/^(?:https?|file|data|ftp):/iu.test(text)) return false
  if (/[\r\n\t]/u.test(text)) return false
  return /^(?:[a-zA-Z]:[\\/]|\\\\|\/|\.{1,2}[\\/]|~[\\/])/u.test(text) || /[\\/]/u.test(text)
}

export async function readJson(file, fallback) {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

/** Atomic JSON write: temp file in the same directory, then rename. */
export async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 1)}\n`, 'utf8')
  try {
    await rename(temp, file)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}

/** Cap a string for display in JSON payloads. */
export function clip(text, max = 300) {
  const value = String(text ?? '')
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/** Sort newest first by a timestamp field, tolerant of missing values. */
export function byNewest(field) {
  return (a, b) => {
    const left = Number(a?.[field] ?? 0)
    const right = Number(b?.[field] ?? 0)
    return right - left
  }
}
