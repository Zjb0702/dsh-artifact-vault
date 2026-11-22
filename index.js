// Artifact Vault — host half.
//
// Attributes workspace files to the DSH session that produced them by replaying
// each session log (sessionQuery / sessionPersistence), groups same-named files
// into versioned artifacts, keeps a small derived index under $DSH_HOME, and
// serves the panel over same-origin loopback routes.
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { extractToolPaths } from './lib/extract.js'
import {
  clip, displayName, expandUser, extOf, folderArea, formatBytes, groupKeyOf, isInside,
  kindOf, pathKey, readJson, sessionFolderName, shortSessionId, writeJsonAtomic,
} from './lib/util.js'

const PKG_NAME = 'dsh-artifact-vault'
const ROUTE_BASE = '/api/dsh-artifact-vault'
const MOUNT_FLAG = Symbol.for('dsh.artifact-vault.mounted')

export const name = 'artifact-vault'
// `connection` supplies requestRejection(): the Host/Origin fence defeats DNS
// rebinding and cross-site calls, and the login-token cookie authenticates the
// browser caller. Without it, any page open in the user's browser could POST
// to our loopback routes and recycle/purge files behind the user's back.
export const inject = ['webServer', 'connection']

const DEFAULTS = {
  enabled: true,
  autoScan: true,
  scanIntervalMinutes: 10,
  maxScanPerBatch: 6,
  includeSubagents: true,
  roots: [],
  maxUntrackedDepth: 4,
  maxUntrackedFiles: 6000,
  hashMaxBytes: 268435456,
  // Per-session workspaces: every session gets `sessions/<yyyyMMdd>-<id8>/`
  // with English `tools/` and `artifacts/` compartments, and a live agent's
  // working directory is moved into it. Set sessionFolders:false to keep the
  // old single flat project directory.
  sessionFolders: true,
  sessionsDirName: 'sessions',
  toolsDirName: 'tools',
  artifactsDirName: 'artifacts',
  sessionFolderRoot: '',
  autoAdoptSessions: true,
  // 0 means "this activation": only sessions created after the bundle mounts are
  // moved automatically; older ones wait for the panel's explicit opt-in.
  adoptSessionsCreatedAfter: 0,
  skipSessionIds: [],
  keepBaseWritable: true,
  promptRule: true,
  // Recycle bin: the manifest stays under $DSH_HOME, but the bytes are staged
  // on the SAME drive as the source file so `rename` is instant and needs no
  // free space. Cross-drive copy (the old behaviour) fails with ENOSPC when a
  // large artifact lands on a nearly-full home volume.
  trashOnSourceDrive: true,
  trashDirName: '.dsh-artifact-vault-trash',
  // Dependency checkouts and tool caches only: an output folder named out/,
  // dist/ or build/ often holds the deliverables this panel exists to find, so
  // it is walked (and sized) rather than hidden.
  ignoreDirs: [
    'node_modules', '.git', '.hg', '.svn', '__pycache__', '.venv', 'venv', '.cache',
    '.next', '.nuxt', '.turbo', '.tox', 'vendor', '.idea', '.vscode', '.gradle', '.m2',
    '.pytest_cache', '.mypy_cache',
    // OS metadata directories, so a macOS or Windows workspace does not report
    // its own filesystem bookkeeping as untracked artifacts.
    '.spotlight-v100', '.trashes', '.fseventsd', '.documentrevisions-v100',
    '$recycle.bin', 'system volume information',
  ],
}

// Registered as a system-prompt section so every session writes its throwaway
// scripts and its deliverables into the two compartments instead of the shared
// project root.
const WORKSPACE_RULE = `## 会话工作区
每个会话在项目目录下的 \`sessions/<日期>-<会话ID>/\` 中拥有独立工作区，工作区内有两个英文命名的子目录：
- \`tools/\`：本次会话运行期间编写的临时脚本、探测代码、一次性命令脚本。
- \`artifacts/\`：交付给用户的产物（文档、表格、演示、图片、数据、压缩包）。

约定：临时脚本写入 \`tools/\`，交付产物写入 \`artifacts/\`，不要在工作区根目录或共享项目目录留下散落文件；若当前工作目录已经是这类工作区文件夹，用相对路径即可。`

const INDEX_VERSION = 1

// Per-OS filesystem bookkeeping: never an artifact, never worth listing.
const JUNK_FILE_NAMES = new Set([
  '.ds_store', 'thumbs.db', 'ehthumbs.db', 'desktop.ini', '.localized',
  'icon\r', '.spotlight-v100', '.fseventsd',
])

function isLoopback(req) {
  const address = req?.socket?.remoteAddress ?? ''
  return address === '' || address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function writeJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readBody(req, limit = 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  const parsed = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('request body must be a JSON object')
  return parsed
}

function queryParam(url, key) {
  const value = url.searchParams.get(key)
  return value === null ? undefined : value
}

function asList(value) {
  return Array.isArray(value) ? value : []
}

function safeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function newestFirst(a, b) {
  return Number(b?.createdAt ?? 0) - Number(a?.createdAt ?? 0)
}

function emptyIndex() {
  return {
    version: INDEX_VERSION,
    updatedAt: 0,
    sessions: {},
    trash: [],
    files: {},
  }
}

/**
 * Create the vault service: index state, scanning, derived views, and the
 * destructive operations the routes expose.
 */
function createVault(ctx, config) {
  const settings = { ...DEFAULTS, ...(config ?? {}) }
  const dshHome = safeString(settings.dshHome) || process.env.DSH_HOME || path.join(homedir(), '.dsh')
  const dataDir = path.join(dshHome, 'artifact-vault')
  const indexFile = path.join(dataDir, 'index.json')
  const trashDir = path.join(dataDir, 'trash')
  const home = homedir()

  const index = emptyIndex()
  let loaded = false
  let saving = null
  let saveTimer = null
  let scanning = null
  let refreshing = null

  const service = { index, settings, dataDir, indexFile, trashDir }

  // ---- per-session workspaces -------------------------------------------------

  /** Session ids already pointed at their folder during this process. */
  const adopted = new Set()

  function sessionsDirName() {
    return safeString(settings.sessionsDirName) || 'sessions'
  }

  function toolsDirName() {
    return safeString(settings.toolsDirName) || 'tools'
  }

  function artifactsDirName() {
    return safeString(settings.artifactsDirName) || 'artifacts'
  }

  function isSessionWorkspace(dir) {
    return /^\d{8}-[a-z2-9]{6,12}$/u.test(path.basename(String(dir ?? '')))
  }

  /** Project directory the session workspace belongs to. */
  function baseDirectoryFor(entry) {
    const configured = safeString(settings.sessionFolderRoot)
    if (configured) return path.resolve(expandUser(configured, home))
    const cwd = safeString(entry?.cwd)
    if (cwd) {
      const resolved = path.resolve(expandUser(cwd, home))
      // A session adopted earlier already sits in its own folder.
      if (!isSessionWorkspace(resolved)) return resolved
      return path.dirname(path.dirname(resolved))
    }
    return rootsForScan()[0] ?? process.cwd()
  }

  function workspaceIdOf(entry) {
    return safeString(entry?.shortId) || shortSessionId(entry?.id)
  }

  /** Absolute folder for one session; remembers the computed shape on the entry. */
  function folderOf(entry) {
    if (safeString(entry?.folder)) return entry.folder
    const shortId = workspaceIdOf(entry)
    const folder = path.join(baseDirectoryFor(entry), sessionsDirName(), sessionFolderName(entry?.createdAt, shortId))
    entry.shortId = shortId
    entry.folder = folder
    return folder
  }

  async function ensureSessionFolder(entry, { create = true } = {}) {
    if (!settings.sessionFolders || !entry) return null
    const folder = folderOf(entry)
    if (!create) return folder
    const tools = path.join(folder, toolsDirName())
    const artifacts = path.join(folder, artifactsDirName())
    if (!existsSync(tools) || !existsSync(artifacts)) {
      await mkdir(tools, { recursive: true })
      await mkdir(artifacts, { recursive: true })
      scheduleSave()
    }
    return folder
  }

  function workspaceInfo(entry) {
    if (!settings.sessionFolders || !entry) return null
    const folder = folderOf(entry)
    return {
      folder,
      shortId: workspaceIdOf(entry),
      toolsDir: path.join(folder, toolsDirName()),
      artifactsDir: path.join(folder, artifactsDirName()),
      exists: existsSync(folder),
      adopted: Boolean(entry.adoptedAt) || (entry.folder != null && pathKey(entry.cwd ?? '') === pathKey(entry.folder)),
    }
  }

  function shouldAdopt(entry) {
    if (!settings.sessionFolders) return false
    if (settings.autoAdoptSessions === false && entry?.wantFolder !== true) return false
    if (!entry?.id) return false
    if (entry.origin === 'subagent') return false
    if (asList(settings.skipSessionIds).includes(entry.id)) return false
    // A session that was already running has a cwd its processes still rely on;
    // only sessions created after this activation move automatically. The panel
    // can still opt an older session in explicitly (wantFolder).
    const floor = Number(settings.adoptSessionsCreatedAfter) || Number(settings.activatedAt) || 0
    if (floor > 0 && Number(entry.createdAt ?? 0) < floor && entry.wantFolder !== true) return false
    return true
  }

  /**
   * Point one live Agent at its own workspace folder. The session cwd is also
   * the sandbox write boundary, so the project directory is granted back:
   * harness file tools keep reaching shared files while everything the session
   * writes has one obvious home.
   */
  async function adoptAgent(agent) {
    const id = String(agent?.id ?? '')
    if (id === '' || !settings.sessionFolders) return null
    if (adopted.has(id)) return index.sessions[id]?.folder ?? null
    let entry = index.sessions[id]
    const session = sessions()?.get?.(id)
    if (!entry) {
      const record = (await corpus()).find((candidate) => candidate.id === id)
      entry = {
        id,
        createdAt: Number(session?.header?.createdAt ?? record?.createdAt ?? Date.now()),
        cwd: session?.header?.cwd ?? record?.cwd,
        parentSession: session?.header?.parentSession ?? record?.parentSession,
        origin: session?.header?.origin ?? record?.origin,
        agentPreset: session?.header?.agentPreset ?? record?.agentPreset,
        writes: [],
        manual: [],
      }
      index.sessions[id] = entry
    }
    if (!shouldAdopt(entry)) return null
    const folder = await ensureSessionFolder(entry)
    if (!folder) return null
    const wd = ctx.get('workingDirectory', false)
    if (typeof wd?.set !== 'function') return folder
    const current = typeof wd.get === 'function' && session ? safeString(wd.get(session)) : ''
    if (current) {
      if (pathKey(current) === pathKey(folder) || isInside(folder, current)) {
        adopted.add(id)
        entry.cwd = current
        entry.folder = folder
        entry.shortId = workspaceIdOf(entry)
        entry.adoptedAt = entry.adoptedAt ?? Date.now()
        save()
        return folder
      }
    }
    try {
      await wd.set(agent, folder)
    } catch (error) {
      ctx.logger?.warn?.(`[artifact-vault] workspace switch failed for ${id}: ${error?.message ?? error}`)
      return folder
    }
    adopted.add(id)
    if (settings.keepBaseWritable !== false && session) grantBaseWritable(session, baseDirectoryFor(entry))
    entry.cwd = folder
    entry.folder = folder
    entry.shortId = workspaceIdOf(entry)
    entry.adoptedAt = Date.now()
    scheduleSave()
    return folder
  }

  function grantBaseWritable(session, base) {
    try {
      const policy = ctx.get('sandboxPolicy', false)
      if (typeof policy?.registerWritableRoot !== 'function') return
      policy.registerWritableRoot(session, base)
    } catch (error) {
      ctx.logger?.warn?.(`[artifact-vault] base grant failed: ${error?.message ?? error}`)
    }
  }

  /** Mark sessions for workspace adoption; the switch itself happens on the next step. */
  async function adopt({ sessionId = '', all = false } = {}) {
    await load()
    const targets = all || !sessionId
      ? Object.keys(index.sessions)
      : [sessionId]
    let marked = 0
    for (const id of targets) {
      const entry = index.sessions[id]
      if (!entry) continue
      if (all && rootIdOf(id) !== id) continue
      entry.wantFolder = true
      await ensureSessionFolder(entry).catch(() => null)
      marked += 1
    }
    if (marked > 0) await flushSave()
    return { marked }
  }

  /**
   * Move workspace files into the recycle bin. `area` narrows to one
   * compartment (tools first, then artifacts); without it only the session
   * workspace is touched, never the shared project directory.
   */
  async function cleanup({ sessionId = '', area = '', all = false } = {}) {
    await load()
    const ids = all || !sessionId
      ? Object.keys(index.sessions).filter((id) => rootIdOf(id) === id)
      : [sessionId]
    const wanted = safeString(area)
    const seen = new Set()
    let moved = 0
    let bytes = 0
    let skipped = 0
    for (const id of ids) {
      const entry = index.sessions[id]
      if (!entry) continue
      const workspace = workspaceInfo(entry)
      if (!workspace) continue
      const merged = aggregateOf(membersOf(id))
      for (const item of merged.values()) {
        const itemArea = folderArea(item.p, workspace.folder)
        if (wanted && itemArea !== wanted) continue
        if (!wanted && itemArea === 'outside') continue
        const key = pathKey(item.p)
        if (seen.has(key)) continue
        seen.add(key)
        const info = await stat(item.p).catch(() => null)
        if (!info?.isFile()) {
          skipped += 1
          continue
        }
        const trashId = randomUUID()
        try {
          const { destination } = await stageTrashEntry(trashId, item.p, path.basename(item.p))
          index.trash.unshift({
            id: trashId,
            kind: 'file',
            p: item.p,
            size: info.size,
            at: Date.now(),
            sessionId: id,
            area: itemArea,
            staged: destination,
          })
          delete index.files[key]
          moved += 1
          bytes += info.size
        } catch (error) {
          ctx.logger?.warn?.(`[artifact-vault] cleanup failed for ${item.p}: ${error?.message ?? error}`)
          skipped += 1
        }
      }
    }
    if (moved > 0) await flushSave()
    return { moved, bytes, skipped, area: wanted || 'workspace' }
  }

  /**
   * A session that no longer exists in the store and no longer has a log was
   * deleted in DSH; only then does its whole workspace folder go to the bin.
   * Memory (the session log) is never touched here — the panel only ever moves
   * files inside a session workspace.
   */
  async function reconcileDeleted() {
    await load()
    // Only the complete logical corpus can prove a session is gone; the
    // in-memory fallback lists live sessions only and would look like a
    // mass deletion.
    if (typeof ctx.get('sessionQuery', false)?.listSessions !== 'function') return { removed: [] }
    const persistence = ctx.get('sessionPersistence', false)
    if (typeof persistence?.stat !== 'function') return { removed: [] }
    const records = await corpus()
    const known = new Set(records.map((record) => record.id))
    const removed = []
    for (const [id, entry] of Object.entries(index.sessions)) {
      if (known.has(id)) continue
      if (entry.error) continue
      if (typeof persistence?.stat === 'function') {
        let stored = false
        try {
          stored = Boolean(await persistence.stat(id))
        } catch {
          stored = false
        }
        if (stored) continue
      }
      if (entry.folder && existsSync(entry.folder)) {
        const trashId = randomUUID()
        try {
          const { destination } = await stageTrashEntry(trashId, entry.folder, path.basename(entry.folder))
          index.trash.unshift({
            id: trashId,
            kind: 'folder',
            p: entry.folder,
            size: asList(entry.writes).reduce((sum, write) => sum + Number(index.files[write.key]?.size ?? 0), 0),
            at: Date.now(),
            sessionId: id,
            reason: 'session-deleted',
            staged: destination,
          })
          removed.push({ id, folder: entry.folder })
        } catch (error) {
          ctx.logger?.warn?.(`[artifact-vault] folder cleanup failed for ${id}: ${error?.message ?? error}`)
          continue
        }
      }
      for (const write of asList(entry.writes)) delete index.files[write.key]
      delete index.sessions[id]
    }
    if (removed.length > 0) await flushSave()
    return { removed }
  }

  async function load() {
    if (loaded) return
    loaded = true
    const stored = await readJson(indexFile, null)
    if (stored && typeof stored === 'object' && stored.version === INDEX_VERSION) {
      index.sessions = stored.sessions && typeof stored.sessions === 'object' ? stored.sessions : {}
      index.trash = asList(stored.trash)
      index.files = stored.files && typeof stored.files === 'object' ? stored.files : {}
      index.updatedAt = Number(stored.updatedAt ?? 0)
    }
    return service
  }

  function scheduleSave() {
    if (saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flushSave()
      // eslint-disable-next-line no-unused-vars
    }, 400)
  }

  async function flushSave() {
    if (saving) return saving
    index.updatedAt = Date.now()
    saving = (async () => {
      try {
        await writeJsonAtomic(indexFile, {
          version: INDEX_VERSION,
          updatedAt: index.updatedAt,
          sessions: index.sessions,
          trash: index.trash,
          files: index.files,
        })
      } catch (error) {
        ctx.logger?.warn?.(`[artifact-vault] save failed: ${error?.message ?? error}`)
      } finally {
        saving = null
      }
    })()
    return saving
  }

  function save() {
    scheduleSave()
    return Promise.resolve()
  }

  function sessions() {
    try {
      return ctx.get('sessions', false)
    } catch {
      return undefined
    }
  }

  /** Cheap (no log read) corpus of every known session, newest first. */
  async function corpus() {
    const query = ctx.get('sessionQuery', false)
    if (typeof query?.listSessions === 'function') {
      try {
        const records = await query.listSessions()
        return asList(records).map((record) => ({
          id: String(record?.header?.id ?? record?.id ?? ''),
          createdAt: Number(record?.header?.createdAt ?? record?.createdAt ?? 0),
          cwd: record?.header?.cwd ?? record?.cwd,
          parentSession: record?.header?.parentSession ?? record?.parentSession,
          origin: record?.header?.origin ?? record?.origin,
          agentPreset: record?.header?.agentPreset ?? record?.agentPreset,
          live: Boolean(record?.live),
          persisted: Boolean(record?.persisted),
        })).filter((record) => record.id !== '')
      } catch (error) {
        ctx.logger?.warn?.(`[artifact-vault] listSessions failed: ${error?.message ?? error}`)
      }
    }
    const store = sessions()
    if (typeof store?.list === 'function') {
      try {
        return store.list().map((session) => ({
          id: String(session?.header?.id ?? session?.id ?? ''),
          createdAt: Number(session?.header?.createdAt ?? 0),
          cwd: session?.header?.cwd,
          parentSession: session?.header?.parentSession,
          origin: session?.header?.origin,
          agentPreset: session?.header?.agentPreset,
          live: true,
          persisted: true,
        })).filter((record) => record.id !== '')
      } catch {
        /* fall through */
      }
    }
    const persistence = ctx.get('sessionPersistence', false)
    if (typeof persistence?.list === 'function') {
      try {
        return (await persistence.list()).map((snapshot) => ({
          id: String(snapshot?.header?.id ?? ''),
          createdAt: Number(snapshot?.header?.createdAt ?? 0),
          cwd: snapshot?.header?.cwd,
          parentSession: snapshot?.header?.parentSession,
          origin: snapshot?.header?.origin,
          agentPreset: snapshot?.header?.agentPreset,
          live: false,
          persisted: true,
        })).filter((record) => record.id !== '')
      } catch {
        /* fall through */
      }
    }
    return []
  }

  /** revision map id → {revision, eventCount, sizeBytes} without reading logs. */
  async function revisionMap() {
    const map = new Map()
    const persistence = ctx.get('sessionPersistence', false)
    if (typeof persistence?.list !== 'function') return map
    try {
      for (const snapshot of await persistence.list()) {
        const id = String(snapshot?.header?.id ?? '')
        if (id === '') continue
        map.set(id, {
          revision: typeof snapshot?.revision === 'string' ? snapshot.revision : String(snapshot?.revision ?? ''),
          eventCount: Number(snapshot?.eventCount ?? 0),
          sizeBytes: Number(snapshot?.sizeBytes ?? 0),
        })
      }
    } catch {
      /* revisions are an optimization */
    }
    return map
  }

  /** Full replay-validated log for one session, via whichever service exists. */
  async function readSessionLog(id) {
    const query = ctx.get('sessionQuery', false)
    if (typeof query?.readSession === 'function') {
      const snapshot = await query.readSession(id)
      if (snapshot && Array.isArray(snapshot.events)) return { header: snapshot.session, events: snapshot.events }
    }
    const persistence = ctx.get('sessionPersistence', false)
    if (typeof persistence?.open === 'function') {
      const handle = await persistence.open(id, 'read')
      try {
        const result = await handle.read()
        return { header: handle.header, events: asList(result?.events) }
      } finally {
        await handle.close?.().catch?.(() => {})
      }
    }
    const store = sessions()
    const live = store?.get?.(id)
    if (live) return { header: live.header, events: asList(live.ownEvents?.()) }
    throw new Error(`session ${id} is not readable`)
  }

  function isIgnoredPath(absPath) {
    if (isInside(dataDir, absPath)) return true
    if (isTrashStaging(absPath)) return true
    const normalized = absPath.split(path.sep).join('/')
    if (normalized.includes('/.artifact-vault/')) return true
    // Filesystem bookkeeping is never an artifact, whichever OS wrote it.
    if (JUNK_FILE_NAMES.has(path.basename(absPath).toLowerCase())) return true
    // `ignoreDirs` is a walking heuristic for the untracked scan: a path a
    // session actually wrote stays visible even inside build/ or dist/, because
    // the attribution came from the log, not from guessing directories.
    return false
  }

  /** Resolve a tool-provided path against the session cwd. */
  function resolveCandidate(raw, cwd) {
    let text = String(raw ?? '').trim()
    if (text === '') return undefined
    text = text.replace(/^["'`](.*)["'`]$/su, '$1').trim()
    if (text === '' || /[\r\n]/u.test(text)) return undefined
    // Code punctuation means the token came out of a script, not a path argument.
    if (/[{};|`]/u.test(text)) return undefined
    if (/^(?:https?|data|file):/iu.test(text)) return undefined
    text = expandUser(text, home)
    let abs
    try {
      abs = path.isAbsolute(text) ? path.normalize(text) : path.resolve(cwd ?? process.cwd(), text)
    } catch {
      return undefined
    }
    if (abs.length > 1024) return undefined
    return abs
  }

  /**
   * The durable title is the last `session/title` record in the log. A fresh
   * session has none until the title provider runs, so its opening user message
   * is the readable fallback — never the id.
   */
  function titleFromEvents(events) {
    let titled = null
    for (const event of events) {
      if (event?.type !== 'session/title') continue
      const text = safeString(event?.data?.title).trim()
      if (text !== '') titled = text
    }
    if (titled) return titled
    for (const event of events) {
      if (event?.type !== 'user/message') continue
      const content = event?.data?.message?.content
      const text = typeof content === 'string'
        ? content
        : asList(content).map((block) => (block?.type === 'text' ? safeString(block.text) : '')).join(' ')
      const cleaned = text.replace(/\s+/gu, ' ').trim()
      if (cleaned !== '') return clip(cleaned, 40)
    }
    return null
  }

  async function scanOne(record) {
    const existing = index.sessions[record.id]
    const manual = asList(existing?.manual)
    const title = existing?.title ?? null
    let header = null
    let events = []
    try {
      const log = await readSessionLog(record.id)
      header = log.header
      events = log.events
    } catch (error) {
      index.sessions[record.id] = {
        ...(existing ?? {}),
        id: record.id,
        createdAt: record.createdAt,
        cwd: record.cwd,
        parentSession: record.parentSession,
        origin: record.origin,
        agentPreset: record.agentPreset,
        title,
        manual,
        scannedAt: Date.now(),
        revision: null,
        error: clip(error?.message ?? String(error), 200),
        writes: asList(existing?.writes),
      }
      save()
      return
    }
    // A session that moved into its workspace keeps writing relative paths, but
    // its header still reports the directory it started in. The authoritative
    // value is the live working directory; for a finished session the folder it
    // was adopted into is what its relative paths referred to.
    let cwd = header?.cwd ?? record.cwd ?? process.cwd()
    const liveSession = sessions()?.get?.(record.id)
    if (liveSession) {
      const wd = ctx.get('workingDirectory', false)
      try {
        const current = typeof wd?.get === 'function' ? wd.get(liveSession) : ''
        if (typeof current === 'string' && current !== '') cwd = current
      } catch {
        // Keep the header value when the session service cannot answer.
      }
    } else if (existing?.adoptedAt && existing?.folder) {
      cwd = existing.folder
    }
    const failedCalls = new Set()
    let turns = 0
    let lastTime = Number(header?.createdAt ?? 0)
    for (const event of events) {
      if (event?.type === 'turn/start') turns += 1
      if (event?.type === 'tool/result') {
        const callId = event?.data?.message?.toolCallId
        if (callId && (event?.data?.error !== undefined || event?.data?.message?.isError === true)) failedCalls.add(String(callId))
      }
      const time = Number(event?.time ?? 0)
      if (time > lastTime) lastTime = time
    }

    /** @type {Map<string, any>} */
    const aggregate = new Map()
    for (const event of events) {
      if (event?.type !== 'tool/call') continue
      const callId = String(event?.data?.callId ?? '')
      if (callId !== '' && failedCalls.has(callId)) continue
      const toolName = String(event?.data?.name ?? '')
      const candidates = extractToolPaths({ name: toolName, arguments: event?.data?.arguments }, { cwd, home })
      for (const candidate of candidates) {
        const abs = resolveCandidate(candidate.raw, cwd)
        if (!abs || isIgnoredPath(abs)) continue
        const key = pathKey(abs)
        const previous = aggregate.get(key)
        if (previous) {
          previous.lastTime = Math.max(previous.lastTime, Number(event?.time ?? 0))
          previous.count += 1
          if (candidate.declared) {
            previous.declared = true
            previous.label = candidate.label ?? previous.label
          }
          if (candidate.conf === 'high') previous.conf = 'high'
          continue
        }
        aggregate.set(key, {
          p: abs,
          key,
          firstTime: Number(event?.time ?? 0),
          lastTime: Number(event?.time ?? 0),
          count: 1,
          tool: toolName,
          conf: candidate.conf,
          declared: Boolean(candidate.declared),
          label: candidate.label,
        })
      }
    }

    // A path that no longer exists and carries no artifact extension is noise
    // (failed writes, mktemp probes); everything else stays visible as "missing".
    const writes = []
    for (const entry of aggregate.values()) {
      const exists = await stat(entry.p).then((s) => s.isFile()).catch(() => false)
      // A vanished path is a real deletion only when the log was explicit about
      // writing it; shell guesses would otherwise flood the list with paths that
      // never existed.
      if (!exists && !(entry.conf === 'high' || entry.declared)) continue
      writes.push({ ...entry, exists })
    }
    writes.sort((a, b) => a.firstTime - b.firstTime)

    index.sessions[record.id] = {
      id: record.id,
      createdAt: record.createdAt,
      cwd,
      parentSession: record.parentSession ?? header?.parentSession,
      origin: record.origin ?? header?.origin,
      agentPreset: record.agentPreset ?? header?.agentPreset,
      title: titleFromEvents(events) ?? title,
      revision: null,
      scannedAt: Date.now(),
      eventCount: events.length,
      turns,
      lastTime,
      writes,
      manual,
      // Workspace adoption is state about the session, not something the log can
      // reproduce; a rescan must not forget the folder it was moved into.
      folder: existing?.folder ?? null,
      shortId: existing?.shortId ?? null,
      adoptedAt: existing?.adoptedAt ?? null,
      wantFolder: existing?.wantFolder === true,
    }
    save()
    // Indexing a session creates its workspace even before any agent runs in it,
    // so the id in the panel always resolves to a real folder on disk.
    if (settings.sessionFolders) {
      try {
        await ensureSessionFolder(index.sessions[record.id])
      } catch (error) {
        ctx.logger?.warn?.(`[artifact-vault] workspace folder failed for ${record.id}: ${error?.message ?? error}`)
      }
    }
  }

  /**
   * The stat cache is keyed by every path ever resolved, including shell tokens
   * that turned out not to be artifacts. Keeping it aligned with the writes the
   * index still references bounds the file and lets stale guesses disappear.
   */
  function pruneFilesCache() {
    const referenced = new Set()
    for (const entry of Object.values(index.sessions)) {
      for (const write of entry.writes ?? []) referenced.add(write.key)
      for (const manual of entry.manual ?? []) referenced.add(manual.key)
    }
    for (const key of Object.keys(index.files)) {
      if (!referenced.has(key)) delete index.files[key]
    }
  }

  async function scanNow({ max = settings.maxScanPerBatch, force = false, budgetMs = 20000 } = {}) {
    if (scanning) return scanning
    scanning = (async () => {
      await load()
      const records = await corpus()
      const revisions = await revisionMap()
      const cachedTitles = index.sessions
      const candidates = records
        .map((record) => ({ ...record, writeTime: Number(cachedTitles[record.id]?.lastTime ?? record.createdAt) }))
        .sort(newestFirst)
      const todo = candidates.filter((record) => {
        const cached = index.sessions[record.id]
        if (!cached) return true
        if (force) return true
        const revision = revisions.get(record.id)
        if (revision && cached.revision && revision.revision === cached.revision) return false
        if (revision && cached.revision && revision.revision !== cached.revision) return true
        return Date.now() - Number(cached.scannedAt ?? 0) > 10 * 60_000
      })
      const started = Date.now()
      let scanned = 0
      for (const record of todo) {
        if (scanned >= max) break
        if (scanned > 0 && Date.now() - started > budgetMs) break
        await scanOne(record)
        const revision = revisions.get(record.id)
        if (revision && index.sessions[record.id]) index.sessions[record.id].revision = revision.revision
        if (revision && index.sessions[record.id]) {
          index.sessions[record.id].logBytes = revision.sizeBytes
          index.sessions[record.id].logEvents = revision.eventCount
        }
        scanned += 1
      }
      pruneFilesCache()
      // Deleting a session in DSH is the one event that removes its whole
      // workspace; nothing in the log announces it, so reconcile on every scan.
      if (settings.sessionFolders && settings.reconcileDeleted !== false) {
        try {
          await reconcileDeleted()
        } catch (error) {
          ctx.logger?.warn?.(`[artifact-vault] reconcile failed: ${error?.message ?? error}`)
        }
      }
      await flushSave()
      return { scanned, remaining: Math.max(0, todo.length - scanned), pending: todo.length, total: records.length }
    })().finally(() => {
      scanning = null
    })
    return scanning
  }

  /** Refresh cached size/mtime for the given paths, at most once every 5 minutes. */
  function touchStats(paths, { force = false } = {}) {
    const now = Date.now()
    const pending = []
    for (const abs of paths) {
      const key = pathKey(abs)
      const cached = index.files[key]
      if (!force && cached && now - Number(cached.at ?? 0) < 5 * 60_000) continue
      pending.push({ abs, key })
    }
    if (pending.length === 0) return Promise.resolve(0)
    if (refreshing) return refreshing
    refreshing = (async () => {
      let updated = 0
      for (const { abs, key } of pending) {
        try {
          const info = await stat(abs)
          index.files[key] = { size: info.size, mtimeMs: info.mtimeMs, at: now, existing: info.isFile() }
          updated += 1
        } catch {
          index.files[key] = { size: 0, mtimeMs: 0, at: now, existing: false }
        }
      }
      if (updated > 0) save()
      return updated
    })().finally(() => {
      refreshing = null
    })
    return refreshing
  }

  function statOf(abs) {
    const cached = index.files[pathKey(abs)]
    if (!cached) return { size: 0, mtimeMs: 0, known: false, existing: true }
    return { size: Number(cached.size ?? 0), mtimeMs: Number(cached.mtimeMs ?? 0), known: true, existing: cached.existing !== false }
  }

  function rootIdOf(id) {
    let current = id
    const seen = new Set()
    for (let depth = 0; depth < 32; depth += 1) {
      const entry = index.sessions[current]
      if (!entry) return current
      const parent = entry.parentSession
      if (!parent || seen.has(parent)) return current
      seen.add(parent)
      current = parent
    }
    return current
  }

  function membersOf(id) {
    if (!settings.includeSubagents) return [id]
    const root = rootIdOf(id)
    const members = [root]
    for (const [candidateId, entry] of Object.entries(index.sessions)) {
      if (candidateId === root) continue
      if (rootIdOf(candidateId) === root) members.push(candidateId)
    }
    return members
  }

  /** Merge writes from a session and its subagent descendants by path. */
  function aggregateOf(ids) {
    const merged = new Map()
    for (const id of ids) {
      const entry = index.sessions[id]
      if (!entry) continue
      for (const write of asList(entry.writes)) {
        const key = write.key ?? pathKey(write.p)
        const previous = merged.get(key)
        if (previous) {
          previous.sessions.add(id)
          previous.firstTime = Math.min(previous.firstTime, Number(write.firstTime ?? 0))
          previous.lastTime = Math.max(previous.lastTime, Number(write.lastTime ?? 0))
          previous.count += Number(write.count ?? 1)
          if (write.declared) {
            previous.declared = true
            previous.label = write.label ?? previous.label
          }
          if (write.conf === 'high') previous.conf = 'high'
          continue
        }
        merged.set(key, {
          p: write.p,
          key,
          firstTime: Number(write.firstTime ?? 0),
          lastTime: Number(write.lastTime ?? 0),
          count: Number(write.count ?? 1),
          tool: write.tool,
          conf: write.conf ?? 'high',
          declared: Boolean(write.declared),
          label: write.label,
          sessions: new Set([id]),
        })
      }
      for (const manual of asList(entry.manual)) {
        const key = manual.key ?? pathKey(manual.p)
        merged.set(key, {
          p: manual.p,
          key,
          firstTime: Number(manual.at ?? 0),
          lastTime: Number(manual.at ?? 0),
          count: 1,
          tool: 'manual',
          conf: 'high',
          declared: true,
          label: manual.label,
          manual: true,
          sessions: new Set([id]),
        })
      }
    }
    return merged
  }

  function rootsForScan() {
    const configured = asList(settings.roots).filter((root) => typeof root === 'string' && root.trim() !== '')
    if (configured.length > 0) return configured.map((root) => path.resolve(expandUser(root, home)))
    const roots = new Set()
    for (const [id, entry] of Object.entries(index.sessions)) {
      if (rootIdOf(id) !== id) continue
      if (entry.cwd && !isInside(dataDir, entry.cwd)) roots.add(path.resolve(entry.cwd))
    }
    return [...roots]
  }

  async function overview({ fresh = false } = {}) {
    await load()
    const roots = rootsForScan()
    const allPaths = new Set()
    const rows = []
    for (const [id, entry] of Object.entries(index.sessions)) {
      if (rootIdOf(id) !== id) continue
      const members = membersOf(id)
      const merged = aggregateOf(members)
      for (const item of merged.values()) allPaths.add(item.p)
      rows.push({ id, entry, merged, members })
    }
    if (fresh) await touchStats([...allPaths], { force: true })
    else void touchStats([...allPaths])

    const sessionsOut = rows.map(({ id, entry, merged, members }) => {
      const workspace = workspaceInfo(entry)
      const areas = {
        tools: { count: 0, bytes: 0 },
        artifacts: { count: 0, bytes: 0 },
        loose: { count: 0, bytes: 0 },
        outside: { count: 0, bytes: 0 },
      }
      let bytes = 0
      let missing = 0
      let declared = 0
      for (const item of merged.values()) {
        const info = statOf(item.p)
        bytes += info.size
        if (info.known && info.existing === false) missing += 1
        if (item.declared) declared += 1
        const area = workspace ? folderArea(item.p, workspace.folder) : 'outside'
        const bucket = areas[area] ?? areas.outside
        bucket.count += 1
        bucket.bytes += info.size
      }
      return {
        id,
        shortId: workspace?.shortId ?? null,
        folder: workspace?.folder ?? null,
        workspace,
        areas,
        title: entry.title ?? null,
        createdAt: Number(entry.createdAt ?? 0),
        lastActivity: Number(entry.lastTime ?? entry.scannedAt ?? entry.createdAt ?? 0),
        cwd: entry.cwd ?? null,
        agentPreset: entry.agentPreset ?? null,
        artifacts: merged.size,
        bytes,
        missing,
        declared,
        subagents: Math.max(0, members.length - 1),
        logBytes: Number(entry.logBytes ?? 0),
        live: Boolean(sessions()?.get?.(id)),
        scannedAt: Number(entry.scannedAt ?? 0),
        error: entry.error ?? null,
      }
    }).sort((a, b) => b.lastActivity - a.lastActivity)

    const totals = sessionsOut.reduce((acc, row) => {
      acc.sessions += 1
      acc.artifacts += row.artifacts
      acc.bytes += row.bytes
      acc.missing += row.missing
      acc.declared += row.declared
      acc.toolsBytes += row.areas.tools.bytes
      acc.artifactsBytes += row.areas.artifacts.bytes
      acc.looseBytes += row.areas.loose.bytes
      return acc
    }, { sessions: 0, artifacts: 0, bytes: 0, missing: 0, declared: 0, toolsBytes: 0, artifactsBytes: 0, looseBytes: 0 })
    totals.trashBytes = index.trash.reduce((sum, item) => sum + Number(item.size ?? 0), 0)
    totals.trashCount = index.trash.length

    return {
      roots,
      sessions: sessionsOut,
      totals,
      trash: index.trash.slice(0, 200).map((item) => ({
        id: item.id,
        kind: item.kind ?? 'file',
        path: item.p,
        display: displayName(item.p, roots),
        size: Number(item.size ?? 0),
        at: Number(item.at ?? 0),
        sessionId: item.sessionId ?? null,
        area: item.area ?? null,
        reason: item.reason ?? null,
        staged: item.staged ?? null,
      })),
      indexUpdatedAt: index.updatedAt,
      scanning: Boolean(scanning),
    }
  }

  async function sessionDetail(id, { fresh = false } = {}) {
    await load()
    let entry = index.sessions[id]
    if (!entry) {
      const record = (await corpus()).find((candidate) => candidate.id === id)
      if (!record) return undefined
      await scanOne(record)
      entry = index.sessions[id]
      if (!entry) return undefined
    }
    if (!entry.title) {
      try {
        const query = ctx.get('sessionQuery', false)
        if (typeof query?.readTitle === 'function') {
          const snapshot = await query.readTitle(id)
          // SessionTitleSnapshot.title is the string itself.
          if (typeof snapshot?.title === 'string' && snapshot.title.trim() !== '') {
            entry.title = snapshot.title.trim()
            save()
          }
        }
      } catch {
        /* title is cosmetic */
      }
    }
    const workspace = workspaceInfo(entry)
    const areas = {
      tools: { count: 0, bytes: 0 },
      artifacts: { count: 0, bytes: 0 },
      loose: { count: 0, bytes: 0 },
      outside: { count: 0, bytes: 0 },
    }
    const members = membersOf(id)
    const merged = aggregateOf(members)
    const roots = rootsForScan()
    if (fresh) await touchStats([...merged.values()].map((item) => item.p), { force: true })
    else void touchStats([...merged.values()].map((item) => item.p))

    const groups = new Map()
    for (const item of merged.values()) {
      const groupKey = groupKeyOf(item.p)
      const info = statOf(item.p)
      const area = workspace ? folderArea(item.p, workspace.folder) : 'outside'
      const areaBucket = areas[area] ?? areas.outside
      areaBucket.count += 1
      areaBucket.bytes += info.size
      const lastActivity = Number(entry.lastTime ?? 0)
      const status = []
      if (info.known && info.existing === false) status.push('missing')
      else if (info.mtimeMs > 0 && lastActivity > 0 && info.mtimeMs > lastActivity + 3000) status.push('modified')
      if (item.declared) status.push('declared')
      if (item.manual) status.push('manual')
      if (item.conf === 'low') status.push('inferred')
      const version = {
        path: item.p,
        display: displayName(item.p, roots),
        name: path.basename(item.p),
        area,
        size: info.size,
        mtimeMs: info.mtimeMs,
        exists: info.existing !== false,
        known: info.known,
        time: item.lastTime,
        firstTime: item.firstTime,
        tool: item.tool,
        conf: item.conf,
        declared: item.declared,
        label: item.label ?? null,
        writtenBy: [...item.sessions],
        status,
      }
      const bucket = groups.get(groupKey)
      if (bucket) bucket.versions.push(version)
      else {
        groups.set(groupKey, {
          key: groupKey,
          name: path.basename(item.p, path.extname(item.p)),
          ext: extOf(item.p),
          kind: kindOf(item.p),
          dir: path.dirname(item.p),
          area,
          versions: [version],
          declared: false,
          label: null,
        })
      }
      const group = groups.get(groupKey)
      if (item.declared) {
        group.declared = true
        group.label = item.label ?? group.label
      }
    }

    const list = [...groups.values()].map((group) => {
      group.versions.sort((a, b) => a.firstTime - b.firstTime || a.mtimeMs - b.mtimeMs)
      group.versions = group.versions.map((version, position) => ({ ...version, version: position + 1 }))
      group.bytes = group.versions.reduce((sum, version) => sum + Number(version.size ?? 0), 0)
      group.latest = group.versions[group.versions.length - 1]
      group.lastTime = group.latest?.time ?? 0
      return group
    }).sort((a, b) => Number(b.lastTime) - Number(a.lastTime))

    return {
      session: {
        id,
        shortId: workspace?.shortId ?? null,
        folder: workspace?.folder ?? null,
        workspace,
        title: entry.title ?? null,
        createdAt: Number(entry.createdAt ?? 0),
        cwd: entry.cwd ?? null,
        agentPreset: entry.agentPreset ?? null,
        parentSession: entry.parentSession ?? null,
        subagents: Math.max(0, members.length - 1),
        turns: Number(entry.turns ?? 0),
        eventCount: Number(entry.eventCount ?? 0),
        logBytes: Number(entry.logBytes ?? 0),
        scannedAt: Number(entry.scannedAt ?? 0),
        live: Boolean(sessions()?.get?.(id)),
        error: entry.error ?? null,
      },
      groups: list,
      areas,
      totals: {
        groups: list.length,
        versions: list.reduce((sum, group) => sum + group.versions.length, 0),
        bytes: list.reduce((sum, group) => sum + group.bytes, 0),
        declared: list.filter((group) => group.declared).length,
      },
      roots,
    }
  }

  async function walkRoots({ includeTracked = false } = {}) {
    const roots = rootsForScan()
    const tracked = new Set()
    for (const entry of Object.values(index.sessions)) {
      for (const write of asList(entry.writes)) tracked.add(write.key ?? pathKey(write.p))
      for (const manual of asList(entry.manual)) tracked.add(manual.key ?? pathKey(manual.p))
    }
    const depthLimit = Math.max(1, Number(settings.maxUntrackedDepth ?? 4))
    const fileLimit = Math.max(100, Number(settings.maxUntrackedFiles ?? 6000))
    const ignoreDirs = new Set(asList(settings.ignoreDirs).filter(Boolean).map((dir) => String(dir).toLowerCase()))
    const files = []
    const startedAt = Date.now()
    for (const root of roots) {
      if (files.length >= fileLimit || Date.now() - startedAt > 8000) break
      const queue = [{ dir: root, depth: 0 }]
      while (queue.length > 0) {
        if (files.length >= fileLimit || Date.now() - startedAt > 8000) break
        const { dir, depth } = queue.shift()
        let entries
        try {
          entries = await readdir(dir, { withFileTypes: true })
        } catch {
          continue
        }
        for (const dirent of entries) {
          const abs = path.join(dir, dirent.name)
          if (isIgnoredPath(abs)) continue
          if (dirent.isSymbolicLink()) continue
          if (dirent.isDirectory()) {
            if (depth + 1 <= depthLimit && !ignoreDirs.has(dirent.name.toLowerCase())) queue.push({ dir: abs, depth: depth + 1 })
            continue
          }
          if (!dirent.isFile()) continue
          const isTracked = tracked.has(pathKey(abs))
          if (isTracked && !includeTracked) continue
          let info
          try {
            info = await stat(abs)
          } catch {
            continue
          }
          files.push({
            path: abs,
            display: displayName(abs, roots),
            size: info.size,
            mtimeMs: info.mtimeMs,
            kind: kindOf(abs),
            ext: extOf(abs),
            root,
            depth,
            tracked: isTracked,
          })
          if (files.length >= fileLimit) break
        }
      }
    }
    return { roots, files, tracked }
  }

  async function untracked() {
    await load()
    const { roots, files } = await walkRoots()
    const groups = new Map()
    for (const file of files) {
      const relative = displayName(file.path, roots)
      const segments = relative.split('/')
      const bucketName = segments.length > 1 ? segments[0] : '（根目录散落文件）'
      // The bucket's real directory, so the UI can offer "delete this folder"
      // instead of asking the user to tick 128 rows one by one.
      const bucketDir = segments.length > 1 ? path.join(file.root, segments[0]) : file.root
      const bucket = groups.get(bucketName) ?? {
        label: bucketName,
        dir: bucketDir,
        deletable: segments.length > 1,
        files: [],
        bytes: 0,
        count: 0,
      }
      bucket.files.push(file)
      bucket.bytes += file.size
      bucket.count += 1
      groups.set(bucketName, bucket)
    }
    const list = [...groups.values()]
      .map((group) => {
        group.files.sort((a, b) => b.size - a.size)
        return group
      })
      .sort((a, b) => b.bytes - a.bytes)
    return {
      roots,
      groups: list,
      totals: {
        files: files.length,
        bytes: files.reduce((sum, file) => sum + file.size, 0),
        groups: list.length,
      },
    }
  }

  /**
   * Trash many paths in one call — the untracked view's checkbox selection.
   * Each item goes through the same per-path staging as `trash`, so a partial
   * failure leaves the successful ones recyclable instead of losing the batch.
   */
  async function trashMany({ paths = [], sessionId } = {}) {
    const results = []
    let moved = 0
    let bytes = 0
    for (const rawPath of asList(paths).slice(0, 5000)) {
      try {
        const result = await trash({ path: rawPath, sessionId })
        const entry = index.trash.find((item) => item.id === result.id)
        moved += 1
        bytes += Number(entry?.size ?? 0)
        results.push({ path: rawPath, ok: true, id: result.id })
      } catch (error) {
        results.push({ path: rawPath, ok: false, error: error?.message ?? String(error) })
      }
    }
    return { moved, bytes, failed: results.filter((item) => !item.ok).length, results }
  }

  async function hashFile(abs) {
    const key = pathKey(abs)
    const cached = index.files[key]
    const info = await stat(abs)
    if (cached?.hash && cached.hashMtimeMs === info.mtimeMs && cached.hashSize === info.size) return cached.hash
    const digest = await new Promise((resolve, reject) => {
      const hash = createHash('sha256')
      const stream = createReadStream(abs)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('error', reject)
      stream.on('end', () => resolve(hash.digest('hex')))
    })
    index.files[key] = { ...(index.files[key] ?? {}), size: info.size, mtimeMs: info.mtimeMs, at: Date.now(), existing: true, hash: digest, hashMtimeMs: info.mtimeMs, hashSize: info.size }
    return digest
  }

  async function duplicates({ includeUntracked = false } = {}) {
    await load()
    const candidates = new Map()
    for (const [id, entry] of Object.entries(index.sessions)) {
      for (const write of asList(entry.writes)) {
        const key = write.key ?? pathKey(write.p)
        const bucket = candidates.get(key) ?? { path: write.p, sessions: new Set() }
        bucket.sessions.add(rootIdOf(id))
        candidates.set(key, bucket)
      }
    }
    if (includeUntracked) {
      const { files } = await walkRoots()
      for (const file of files) {
        const key = pathKey(file.path)
        if (!candidates.has(key)) candidates.set(key, { path: file.path, sessions: new Set() })
      }
    }
    const bySize = new Map()
    for (const [key, entry] of candidates) {
      let info
      try {
        info = await stat(entry.path)
      } catch {
        continue
      }
      if (!info.isFile() || info.size <= 0 || info.size > Number(settings.hashMaxBytes ?? DEFAULTS.hashMaxBytes)) continue
      const bucket = bySize.get(info.size) ?? []
      bucket.push({ path: entry.path, size: info.size, sessions: [...entry.sessions], key })
      bySize.set(info.size, bucket)
    }
    const groups = []
    let hashed = 0
    // Hashing is the expensive half of this view: an untracked walk over a
    // multi-gigabyte workspace must stop early rather than stall the request.
    let budget = 512 * 1024 * 1024
    for (const bucket of bySize.values()) {
      if (bucket.length < 2) continue
      const byHash = new Map()
      for (const file of bucket) {
        if (budget <= 0 || hashed >= 4000) break
        try {
          const hash = await hashFile(file.path)
          budget -= file.size
          hashed += 1
          const list = byHash.get(hash) ?? []
          list.push(file)
          byHash.set(hash, list)
        } catch {
          /* unreadable file is not a duplicate candidate */
        }
      }
      for (const [hash, files] of byHash) {
        if (files.length < 2) continue
        groups.push({
          hash,
          size: files[0].size,
          wasted: files[0].size * (files.length - 1),
          files: files.map((file) => ({
            path: file.path,
            display: displayName(file.path, rootsForScan()),
            sessions: file.sessions,
          })),
        })
      }
    }
    groups.sort((a, b) => b.wasted - a.wasted)
    save()
    return {
      groups: groups.slice(0, 200),
      totals: {
        groups: groups.length,
        wasted: groups.reduce((sum, group) => sum + group.wasted, 0),
        hashed,
      },
    }
  }

  async function declare({ sessionId, path: rawPath, label, note }) {
    await load()
    const sessionEntry = sessionId ? index.sessions[sessionId] : undefined
    const cwd = sessionEntry?.cwd ?? process.cwd()
    const abs = resolveCandidate(rawPath, cwd)
    if (!abs) throw new Error('invalid path')
    const roots = rootsForScan()
    const tracked = [...roots].some((root) => isInside(root, abs)) || Object.values(index.sessions).some((entry) => asList(entry.writes).some((write) => write.key === pathKey(abs)))
    if (!tracked) throw new Error('path is outside the managed roots and was never produced by a session')
    const info = await stat(abs).catch(() => undefined)
    if (!info?.isFile()) throw new Error('not a regular file')
    const targetId = sessionId && index.sessions[sessionId] ? sessionId : rootIdOfForPath(abs)
    if (!targetId) throw new Error('no session to attach this artifact to')
    const entry = index.sessions[targetId] ?? (index.sessions[targetId] = {
      id: targetId,
      createdAt: 0,
      cwd,
      title: null,
      manual: [],
      writes: [],
      scannedAt: 0,
    })
    entry.manual = asList(entry.manual).filter((item) => pathKey(item.p) !== pathKey(abs))
    entry.manual.push({
      p: abs,
      key: pathKey(abs),
      at: Date.now(),
      label: safeString(label) || undefined,
      note: safeString(note) || undefined,
    })
    await flushSave()
    return { ok: true, sessionId: targetId, path: abs }
  }

  function rootIdOfForPath(abs) {
    const key = pathKey(abs)
    for (const [id, entry] of Object.entries(index.sessions)) {
      if (asList(entry.writes).some((write) => (write.key ?? pathKey(write.p)) === key)) return rootIdOf(id)
    }
    return undefined
  }

  /**
   * Where the BYTES of a trashed entry live. The manifest (index.json) stays
   * under $DSH_HOME, but a large file is staged on the SOURCE drive so that
   * `rename` is an instant metadata operation needing no extra free space.
   * A cross-drive copy used to fail with ENOSPC when an 8 GB artifact on D:
   * was trashed into a nearly-full C: home volume.
   */
  /** True when an absolute path sits inside any same-drive trash staging dir. */
  function isTrashStaging(absPath) {
    const name = safeString(settings.trashDirName) || '.dsh-artifact-vault-trash'
    return String(absPath ?? '').split(path.sep).join('/').split('/').includes(name)
  }

  function trashBaseFor(sourceAbs) {
    if (settings.trashOnSourceDrive === false) return trashDir
    for (const root of rootsForScan()) {
      if (isInside(root, sourceAbs)) {
        return path.join(root, safeString(settings.trashDirName) || '.dsh-artifact-vault-trash')
      }
    }
    // Not under a managed root: stage on the source volume itself, still a
    // pure rename with no cross-drive copy.
    const parsed = path.parse(path.resolve(sourceAbs))
    if (parsed.root) return path.join(parsed.root, safeString(settings.trashDirName) || '.dsh-artifact-vault-trash')
    return trashDir
  }

  /** Move one file/folder into the recycle bin; returns the real staged path. */
  async function stageTrashEntry(id, sourceAbs, basename) {
    const base = trashBaseFor(sourceAbs)
    const dir = path.join(base, id)
    await mkdir(dir, { recursive: true })
    const destination = path.join(dir, basename)
    await moveFile(sourceAbs, destination)
    return { dir, destination }
  }

  /** Old entries have no `.staged`; they still live under the Home trash dir. */
  function stagedFileOf(entry) {
    if (entry?.staged) return entry.staged
    return path.join(trashDir, entry.id, path.basename(entry.p ?? ''))
  }

  function stagedDirOf(entry) {
    if (entry?.staged) return path.dirname(entry.staged)
    return path.join(trashDir, entry?.id ?? '')
  }

  /**
   * The index lives under the DSH home while the workspace can sit on another
   * drive, so a rename across devices fails with EXDEV; the copy path makes the
   * recycle bin work in both directions.
   */
  async function moveFile(from, to) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      if (error?.code !== 'EXDEV') throw error
    }
    await copyFile(from, to)
    await unlink(from)
  }

  async function assertManaged(abs) {
    const roots = rootsForScan()
    if (roots.some((root) => isInside(root, abs))) return
    const tracked = Object.values(index.sessions).some((entry) => asList(entry.writes).some((write) => (write.key ?? pathKey(write.p)) === pathKey(abs)))
    if (!tracked) throw new Error('path is outside the managed roots')
  }

  /** Recursively sum real on-disk bytes under a path (files only). */
  async function dirSize(abs) {
    let total = 0
    const stack = [abs]
    while (stack.length > 0) {
      const current = stack.pop()
      let entries
      try {
        entries = await readdir(current, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        const child = path.join(current, entry.name)
        if (entry.isDirectory()) stack.push(child)
        else if (entry.isFile()) {
          const info = await stat(child).catch(() => null)
          if (info) total += info.size
        }
      }
    }
    return total
  }

  /**
   * Trash a file OR a whole folder. Folders are staged with one rename on the
   * same drive, so deleting a session's tool folder costs no extra space and
   * keeps every file restorable as one unit. `kind` marks the entry so the UI
   * can render it distinctly.
   */
  async function trash({ path: rawPath, sessionId, kind } = {}) {
    const abs = path.resolve(String(rawPath ?? ''))
    if (!abs) throw new Error('invalid path')
    await assertManaged(abs)
    if (isInside(trashDir, abs) || isTrashStaging(abs)) throw new Error('already in the recycle bin')
    const info = await stat(abs).catch(() => undefined)
    if (!info) throw new Error('path does not exist')
    // Never let a user trash the session workspace root itself by accident:
    // that would remove the folder the panel uses to attribute everything.
    const isRootWorkspace = isSessionWorkspace(abs)
    const entryKind = kind === 'folder' || (info.isDirectory() && !isRootWorkspace) ? 'folder' : info.isDirectory() ? 'folder' : 'file'
    if (info.isDirectory() && isRootWorkspace) {
      // Allowed only via the explicit cleanup/reconcile paths, never the single
      // file-level trash action; keep the workspace but trash its contents.
      throw new Error('请使用“清理”按分区删除会话工作区内容，或删除整个会话')
    }
    const size = info.isDirectory() ? await dirSize(abs) : info.size
    const id = randomUUID()
    const { destination } = await stageTrashEntry(id, abs, path.basename(abs))
    index.trash.unshift({
      id, kind: entryKind, p: abs, size, mtimeMs: info.mtimeMs, at: Date.now(),
      sessionId: sessionId ?? null, staged: destination,
    })
    if (index.trash.length > 5000) index.trash.length = 5000
    if (info.isFile()) delete index.files[pathKey(abs)]
    await flushSave()
    return { ok: true, id, kind: entryKind }
  }

  /**
   * Recycle-bin listing used by the dedicated route. Each item carries its
   * real size and staged location; a missing staged file is marked so the UI
   * can show it instead of crashing the whole panel.
   */
  async function listTrash({ sort = 'at', order = 'desc' } = {}) {
    await load()
    const roots = rootsForScan()
    const items = []
    for (const item of index.trash) {
      const staged = stagedFileOf(item)
      let present = false
      let actualSize = 0
      let mtime = 0
      try {
        const st = await stat(staged)
        present = true
        actualSize = item.kind === 'folder' ? await dirSize(staged) : st.size
        mtime = st.mtimeMs
      } catch {
        present = false
      }
      items.push({
        id: item.id,
        kind: item.kind ?? 'file',
        path: item.p,
        display: displayName(item.p, roots),
        size: present ? actualSize : Number(item.size ?? 0),
        mtimeMs: mtime || Number(item.mtimeMs ?? 0),
        at: Number(item.at ?? 0),
        sessionId: item.sessionId ?? null,
        area: item.area ?? null,
        reason: item.reason ?? null,
        staged,
        present,
      })
    }
    const field = ['at', 'mtimeMs', 'size', 'display'].includes(sort) ? sort : 'at'
    const direction = order === 'asc' ? 1 : -1
    items.sort((a, b) => {
      const left = field === 'display' ? String(a[field] ?? '') : Number(a[field] ?? 0)
      const right = field === 'display' ? String(b[field] ?? '') : Number(b[field] ?? 0)
      return (left < right ? -1 : left > right ? 1 : 0) * direction
    })
    return {
      items,
      totals: {
        count: items.length,
        bytes: items.reduce((sum, item) => sum + Number(item.size ?? 0), 0),
        files: items.filter((item) => item.kind === 'file').length,
        folders: items.filter((item) => item.kind === 'folder').length,
      },
    }
  }

  async function restore({ id }) {
    const entry = index.trash.find((item) => item.id === id)
    if (!entry) throw new Error('trash entry not found')
    const source = stagedFileOf(entry)
    if (!existsSync(source)) throw new Error('回收项文件已丢失，无法还原')
    const exists = await stat(entry.p).then(() => true).catch(() => false)
    if (exists) throw new Error('original path already exists')
    await mkdir(path.dirname(entry.p), { recursive: true })
    await moveFile(source, entry.p)
    index.trash = index.trash.filter((item) => item.id !== id)
    await rm(stagedDirOf(entry), { recursive: true, force: true }).catch(() => {})
    await flushSave()
    return { ok: true, path: entry.p, kind: entry.kind ?? 'file' }
  }

  async function purge({ id } = {}) {
    if (id) {
      const entry = index.trash.find((item) => item.id === id)
      if (!entry) throw new Error('trash entry not found')
      await rm(stagedDirOf(entry), { recursive: true, force: true })
      index.trash = index.trash.filter((item) => item.id !== id)
    } else {
      for (const entry of index.trash) {
        await rm(stagedDirOf(entry), { recursive: true, force: true }).catch(() => {})
      }
      index.trash = []
    }
    await flushSave()
    return { ok: true, remaining: index.trash.length }
  }

  async function downloadPath(rawPath) {
    const abs = path.resolve(String(rawPath ?? ''))
    await assertManaged(abs)
    const info = await stat(abs)
    if (!info.isFile()) throw new Error('not a regular file')
    return { abs, info }
  }

  async function refreshAll() {
    const paths = new Set()
    for (const entry of Object.values(index.sessions)) {
      for (const write of asList(entry.writes)) paths.add(write.p)
      for (const manual of asList(entry.manual)) paths.add(manual.p)
    }
    await touchStats([...paths], { force: true })
    await flushSave()
    return { ok: true, files: paths.size }
  }

  // ---------------------------------------------------------------------------
  // C-drive (DSH home) usage analysis & safe cleanup
  //
  // The DSH app is installed on D:, but its *home* (~/.dsh) is on C:. Session
  // logs, plugin caches and projection caches all accumulate there. Nothing in
  // here touches workspace artifacts, tool scripts, or live session logs.
  // ---------------------------------------------------------------------------

  const CLEANABLE_CACHE_DIRS = [
    { id: 'rea-cache', rel: 'plugins/rea-bundle/cache', label: 'REA 下载缓存', reason: '可重新下载的 zip/jar 安装包', fileOnly: true },
    { id: 'projcache', rel: 'storages/session_projcache', label: '会话投影缓存', reason: '可从会话日志重建的派生缓存', dir: true },
  ]

  function isHomeOnC() {
    return /^[a-zA-Z]:[\\/]/u.test(dshHome) && dshHome[0].toUpperCase() === 'C'
  }

  /** Sum bytes of files directly inside a directory (optionally recursive). */
  async function folderBytes(abs, recursive = true) {
    if (!recursive) {
      let total = 0
      const entries = await readdir(abs, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const info = await stat(path.join(abs, entry.name)).catch(() => null)
        if (info) total += info.size
      }
      return total
    }
    return dirSize(abs)
  }

  /** List stale session log directories whose session no longer exists anywhere. */
  async function staleSessionLogs() {
    await load()
    const records = await corpus()
    const known = new Set(records.map((record) => record.id))
    const persistence = ctx.get('sessionPersistence', false)
    const result = []
    const sessionsRoot = path.join(dshHome, 'sessions')
    const projects = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => [])
    for (const project of projects) {
      if (!project.isDirectory()) continue
      const projectDir = path.join(sessionsRoot, project.name)
      const entries = await readdir(projectDir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const match = /^session-(.+)$/u.exec(entry.name)
        if (!match) continue
        const id = `session-${match[1]}`
        if (known.has(id)) continue
        let stored = false
        if (typeof persistence?.stat === 'function') {
          try {
            stored = Boolean(await persistence.stat(id))
          } catch {
            stored = false
          }
        }
        if (stored) continue
        const dir = path.join(projectDir, entry.name)
        const size = await dirSize(dir)
        const files = await readdir(dir).catch(() => [])
        result.push({ kind: 'session-log', id, path: dir, size, files, label: `已删除会话日志 ${match[1].slice(0, 12)}` })
      }
    }
    return result
  }

  /** Full C-drive usage breakdown + a conservative, clearly scoped clean plan. */
  async function cDriveUsage() {
    await load()
    const categories = []
    for (const name of ['sessions', 'plugins', 'profiles', 'storages', 'attachments', 'dsh-runtimes', 'electron', 'skills']) {
      const abs = path.join(dshHome, name)
      const size = await folderBytes(abs)
      categories.push({ id: name, label: name, path: abs, size, bytes: size })
    }
    const stale = await staleSessionLogs()
    const plans = []
    for (const item of stale) {
      plans.push({ id: `session:${item.id}`, kind: 'session-log', label: item.label, path: item.path, size: item.size, impact: '已删除会话的日志目录；会话不存在，无工作台产物', reversible: false })
    }
    for (const cache of CLEANABLE_CACHE_DIRS) {
      const abs = path.join(dshHome, cache.rel)
      let entries = []
      if (cache.dir) {
        entries = (await readdir(abs, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isFile()).map((entry) => path.join(abs, entry.name))
      } else {
        entries = (await readdir(abs, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isFile()).map((entry) => path.join(abs, entry.name))
      }
      let size = 0
      for (const file of entries) {
        const info = await stat(file).catch(() => null)
        if (info) size += info.size
      }
      if (size > 0) {
        plans.push({ id: cache.id, kind: 'cache', label: cache.label, path: abs, size, files: entries.length, impact: cache.reason, reversible: false })
      }
    }
    return {
      home: dshHome,
      homeOnC: isHomeOnC(),
      categories: categories.sort((a, b) => b.size - a.size),
      plans,
      totals: {
        homeBytes: categories.reduce((sum, cat) => sum + cat.size, 0),
        reclaimable: plans.reduce((sum, plan) => sum + plan.size, 0),
        staleSessions: stale.length,
      },
      generatedAt: Date.now(),
    }
  }

  /** Execute a previously-previewed clean plan, with explicit ids only. */
  async function cDriveClean({ ids = [] } = {}) {
    const usage = await cDriveUsage()
    const allowed = new Map(usage.plans.map((plan) => [plan.id, plan]))
    let freed = 0
    const done = []
    for (const id of ids) {
      const plan = allowed.get(id)
      if (!plan) throw new Error(`不允许清理: ${id}`)
      if (plan.kind === 'session-log') {
        await rm(plan.path, { recursive: true, force: true })
      } else if (plan.kind === 'cache') {
        const entries = (await readdir(plan.path, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isFile())
        for (const entry of entries) await rm(path.join(plan.path, entry.name), { force: true })
      }
      freed += plan.size
      done.push({ id, path: plan.path, freed: plan.size })
    }
    return { ok: true, freed, done }
  }

  Object.assign(service, {
    load, save, flushSave, scanNow, overview, sessionDetail, untracked, duplicates,
    declare, trash, trashMany, restore, purge, downloadPath, refreshAll, corpus, rootsForScan,
    isIgnoredPath, settings, dataDir, indexFile, trashDir, statOf,
    listTrash, dirSize, cDriveUsage, cDriveClean,
    // per-session workspaces
    adoptAgent, adopt, cleanup, reconcileDeleted, workspaceInfo, ensureSessionFolder,
    folderOf, workspaceRule: WORKSPACE_RULE,
  })
  return service
}

/** Make the routes; every route enforces the connection fence + loopback + method. */
function makeRoutes(ctx, service) {
  // The composition's connection service owns the security boundary. Its
  // requestRejection() checks Host/Origin (blocking DNS rebinding and CSRF from
  // any page the user has open) and requires an authenticated browser peer.
  // It returns a status code to reject with, or undefined to admit. Look it up
  // defensively so headless tests without a live Cordis graph still work.
  const connection = ctx?.connection ?? (typeof ctx?.get === 'function' ? ctx.get('connection', false) : undefined)
  const requestRejection = typeof connection?.requestRejection === 'function'
    ? (req) => connection.requestRejection(req)
    : () => undefined

  const guard = (req, res, method) => {
    // DSH's own access check first: untrusted or unauthenticated callers never
    // reach any file operation. The loopback test stays as defence in depth.
    const rejection = requestRejection(req)
    if (rejection !== undefined) {
      writeJson(res, Number(rejection) || 403, { error: 'forbidden: untrusted or unauthenticated request' })
      return false
    }
    if (!isLoopback(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback only' })
      return false
    }
    if (method && req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }
  const fail = (res, error) => writeJson(res, 400, { error: error?.message ?? String(error) })

  return [
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/health`,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        writeJson(res, 200, { ok: true, dataDir: service.dataDir, roots: service.rootsForScan() })
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/overview`,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const payload = await service.overview({ fresh: queryParam(url, 'fresh') === '1' })
          writeJson(res, 200, payload)
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/session`,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const id = queryParam(url, 'id')
          if (!id) throw new Error('id is required')
          const payload = await service.sessionDetail(id, { fresh: queryParam(url, 'fresh') === '1' })
          if (!payload) throw new Error('session not found')
          writeJson(res, 200, payload)
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/scan`,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readBody(req)
          const result = await service.scanNow({
            max: Number(body.max ?? service.settings.maxScanPerBatch) || service.settings.maxScanPerBatch,
            force: body.force === true,
          })
          writeJson(res, 200, result)
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/untracked`,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          writeJson(res, 200, await service.untracked())
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/duplicates`,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          writeJson(res, 200, await service.duplicates({ includeUntracked: queryParam(url, 'untracked') === '1' }))
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/declare`,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readBody(req)
          if (typeof body.path !== 'string' || body.path.trim() === '') throw new Error('path is required')
          writeJson(res, 200, await service.declare({
            sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
            path: body.path,
            label: typeof body.label === 'string' ? body.label : undefined,
            note: typeof body.note === 'string' ? body.note : undefined,
          }))
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/trash`,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readBody(req)
          if (typeof body.path !== 'string' || body.path.trim() === '') throw new Error('path is required')
          writeJson(res, 200, await service.trash({
            path: body.path,
            sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
            kind: body.kind === 'folder' ? 'folder' : undefined,
          }))
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/trash-many`,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readBody(req)
          writeJson(res, 200, await service.trashMany({
            paths: asList(body.paths).filter((item) => typeof item === 'string' && item.trim() !== ''),
            sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
          }))
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/trash-list`,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          writeJson(res, 200, await service.listTrash({
            sort: queryParam(url, 'sort') ?? 'at',
            order: queryParam(url, 'order') ?? 'desc',
          }))
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/c-drive-usage`,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          writeJson(res, 200, await service.cDriveUsage())
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/c-drive-clean`,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readBody(req)
          writeJson(res, 200, await service.cDriveClean({ ids: asList(body.ids) }))
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/restore`,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readBody(req)
          if (typeof body.id !== 'string') throw new Error('id is required')
          writeJson(res, 200, await service.restore({ id: body.id }))
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/purge`,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readBody(req)
          writeJson(res, 200, await service.purge({ id: typeof body.id === 'string' ? body.id : undefined }))
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/refresh`,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          writeJson(res, 200, await service.refreshAll())
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/folder`,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const id = queryParam(url, 'id')
          if (!id) throw new Error('id is required')
          const detail = await service.sessionDetail(id)
          if (!detail) throw new Error('session not found')
          writeJson(res, 200, {
            session: detail.session,
            workspace: detail.session.workspace ?? null,
            areas: detail.areas ?? null,
          })
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/adopt`,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readBody(req)
          writeJson(res, 200, await service.adopt({
            sessionId: typeof body.sessionId === 'string' ? body.sessionId : '',
            all: body.all === true,
          }))
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/cleanup`,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readBody(req)
          const area = typeof body.area === 'string' ? body.area : ''
          if (area !== '' && !['tools', 'artifacts', 'loose'].includes(area)) {
            throw new Error('area must be tools, artifacts or loose')
          }
          writeJson(res, 200, await service.cleanup({
            sessionId: typeof body.sessionId === 'string' ? body.sessionId : '',
            area,
            all: body.all === true,
          }))
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/reconcile`,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          writeJson(res, 200, await service.reconcileDeleted())
        } catch (error) {
          fail(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_BASE}/file`,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const rawPath = queryParam(url, 'path')
          if (!rawPath) throw new Error('path is required')
          const { abs, info } = await service.downloadPath(rawPath)
          const name = path.basename(abs)
          res.writeHead(200, {
            'content-type': 'application/octet-stream',
            'content-length': info.size,
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
            'cache-control': 'no-store',
          })
          createReadStream(abs).pipe(res)
        } catch (error) {
          writeJson(res, 404, { error: error?.message ?? String(error) })
        }
      },
    },
  ]
}

function registerTool(ctx, service) {
  const tools = ctx.get('tools', false)
  if (typeof tools?.register !== 'function') return () => {}
  try {
    return tools.register({
      name: 'artifact_declare',
      description:
        'Declare a workspace file as this session\'s deliverable artifact. The Artifact Vault panel groups declared artifacts first, shows their label/version, and never deletes them silently. Use it for final outputs the user will look for later (documents, slides, decks, spreadsheets, images, archives).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path, or a path relative to the session workspace.' },
          label: { type: 'string', description: 'Short human label shown in the panel, e.g. "客户版方案".' },
          note: { type: 'string', description: 'Optional note about this artifact.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            path: { type: 'string' },
            sessionId: { type: 'string' },
          },
        },
        render(args, value) {
          const path = typeof value?.path === 'string' ? value.path : String(args?.path ?? '')
          return [{ type: 'text', text: value?.ok ? `Declared artifact: ${path}` : `Artifact declaration failed: ${path}` }]
        },
      },
      async execute(args, exec) {
        const sessionId = String(exec?.agent?.id ?? '')
        const result = await service.declare({
          sessionId: sessionId === '' ? undefined : sessionId,
          path: String(args?.path ?? ''),
          label: typeof args?.label === 'string' ? args.label : undefined,
          note: typeof args?.note === 'string' ? args.note : undefined,
        })
        return { ok: result.ok, path: result.path, sessionId: result.sessionId }
      },
    })
  } catch (error) {
    ctx.logger?.warn?.(`[artifact-vault] tool registration failed: ${error?.message ?? error}`)
    return () => {}
  }
}

export function apply(ctx, config) {
  if (globalThis[MOUNT_FLAG]) return
  globalThis[MOUNT_FLAG] = true

  // `activatedAt` is the safety floor for automatic adoption: a session that
  // already existed keeps its working directory until the user opts in.
  const service = createVault(ctx, { ...config, activatedAt: Date.now() })
  let timer
  let bootTimer

  ctx.effect(() => {
    const routes = makeRoutes(ctx, service)
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* already released */
        }
      }
    }
  }, 'artifact-vault: routes')

  ctx.effect(() => {
    const dispose = registerTool(ctx, service)
    return () => dispose()
  }, 'artifact-vault: tool')

  // Every entered agent gets its own workspace folder. `agent/created` covers
  // the normal path; `agent/pre-step` is the safety net for an agent that was
  // already running when the bundle activated (the switch is memoized).
  ctx.effect(() => {
    if (service.settings.sessionFolders === false) return () => {}
    const disposers = []
    const onCreated = (payload) => {
      const agent = payload?.agent ?? payload
      void service.adoptAgent(agent).catch((error) => {
        ctx.logger?.warn?.(`[artifact-vault] adopt failed: ${error?.message ?? error}`)
      })
    }
    disposers.push(ctx.on('agent/created', onCreated))
    disposers.push(ctx.on('agent/pre-step', async (payload, next) => {
      try {
        await service.adoptAgent(payload?.agent)
      } catch {
        /* a directory problem must never break the turn */
      }
      return next()
    }))
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* already released */
        }
      }
    }
  }, 'artifact-vault: session workspaces')

  // Tell the model where its own files belong, so tools/ and artifacts/ fill up
  // without the user having to repeat the convention every session.
  ctx.effect(() => {
    if (service.settings.sessionFolders === false || service.settings.promptRule === false) return () => {}
    const prompt = ctx.get('systemPrompt', false)
    if (typeof prompt?.section !== 'function') return () => {}
    try {
      return prompt.section({
        name: 'artifact-vault.session-workspace',
        order: 1000,
        text: WORKSPACE_RULE,
      })
    } catch (error) {
      ctx.logger?.warn?.(`[artifact-vault] prompt rule failed: ${error?.message ?? error}`)
      return () => {}
    }
  }, 'artifact-vault: prompt rule')

  if (service.settings.autoScan !== false) {
    bootTimer = setTimeout(() => {
      void service.load().then(() => service.scanNow({ max: 25, budgetMs: 45000 })).catch((error) => {
        ctx.logger?.warn?.(`[artifact-vault] initial scan failed: ${error?.message ?? error}`)
      })
    }, 6000)
    const minutes = Math.max(1, Number(service.settings.scanIntervalMinutes ?? 10))
    timer = setInterval(() => {
      void service.scanNow({ max: 20, budgetMs: 30000 }).catch(() => {})
    }, minutes * 60_000)
  }

  ctx.effect(() => () => {
    if (timer !== undefined) clearInterval(timer)
    if (bootTimer !== undefined) clearTimeout(bootTimer)
    void service.flushSave()
    globalThis[MOUNT_FLAG] = false
  }, 'artifact-vault: timers')
}

// Runtime options come from the bundle's patch row or from a manual install
// config; see DEFAULTS above and docs/DETAIL.md.
export const meta = { name: PKG_NAME, routes: ROUTE_BASE }

/** Test seam: the headless suite builds a vault without a live Cordis graph. */
export const __internals = { createVault, makeRoutes, ROUTE_BASE, WORKSPACE_RULE }
