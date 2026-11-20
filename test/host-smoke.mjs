// Headless test for the Host half: builds a real vault over a temporary
// workspace and drives the same service methods the routes call.
//
// The session log is faked with the exact shapes the Host contracts document:
// `tool/call` carries {turn, step, callId, name, arguments}; events carry a
// `time`; `turn/start` marks a turn.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import os from 'node:os'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const { __internals } = await import(pathToFileURL(path.join(here, '..', 'index.js')).href)
const { shortSessionId } = await import(pathToFileURL(path.join(here, '..', 'lib', 'util.js')).href)
const { createVault } = __internals

const root = await mkdtemp(path.join(os.tmpdir(), 'artifact-vault-'))
const home = path.join(root, 'home')
const work = path.join(root, 'work')
await mkdir(path.join(work, 'out'), { recursive: true })
await mkdir(home, { recursive: true })

const T0 = 1_700_000_000_000
const sessionId = 'session-alpha'

// Three versions of one logical artifact + one unrelated file.
await writeFile(path.join(work, 'out', 'report-v1.txt'), 'first draft\n')
await writeFile(path.join(work, 'out', 'report-v2.txt'), 'second draft, longer\n')
await writeFile(path.join(work, 'out', 'report_final.txt'), 'the shipped version\n')
await writeFile(path.join(work, 'notes.md'), '# notes\n')

const header = { version: 1, id: sessionId, createdAt: T0, cwd: work, isSeeded: false }
const liveSession = { id: sessionId, header }
const wdCalls = []
const grants = []
const events = [
  { type: 'turn/start', data: { turn: 1 }, time: T0 },
  // The durable title the panel must show instead of the id.
  { type: 'session/title', data: { title: '客户方案修订', messageSeqs: [1], source: 'provider' }, time: T0 + 500 },
  {
    type: 'tool/call',
    data: { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: JSON.stringify({ file_path: path.join(work, 'out', 'report-v1.txt'), content: 'first draft\n' }) },
    time: T0 + 1_000,
  },
  {
    type: 'tool/call',
    data: { turn: 1, step: 2, callId: 'c2', name: 'write', arguments: JSON.stringify({ file_path: 'out/report-v2.txt', content: 'second draft, longer\n' }) },
    time: T0 + 2_000,
  },
  {
    type: 'tool/call',
    data: { turn: 1, step: 3, callId: 'c3', name: 'present', arguments: JSON.stringify({ files: [{ path: path.join(work, 'out', 'report_final.txt'), description: '客户版' }] }) },
    time: T0 + 3_000,
  },
  { type: 'tool/result', data: { turn: 1, step: 3, message: { toolCallId: 'c3' } }, time: T0 + 3_100 },
  // A failed write must contribute no artifact.
  {
    type: 'tool/call',
    data: { turn: 1, step: 4, callId: 'c4', name: 'write', arguments: JSON.stringify({ file_path: path.join(work, 'exploded.txt') }) },
    time: T0 + 4_000,
  },
  { type: 'tool/result', data: { turn: 1, step: 4, message: { toolCallId: 'c4', isError: true } }, time: T0 + 4_100 },
  { type: 'turn/end', data: { turn: 1, reason: 'done' }, time: T0 + 5_000 },
]

const records = [{ header, live: false, persisted: true }]
const revisions = [{ header, revision: 8, eventCount: events.length, sizeBytes: 4096 }]

const ctx = {
  logger: { warn() {} },
  get(key) {
    if (key === 'sessionQuery') {
      return {
        listSessions: async () => records,
        readSession: async (id) => (id === sessionId ? { session: header, inheritedEventCount: 0, events } : undefined),
        readTitle: async () => undefined,
      }
    }
    if (key === 'sessionPersistence') {
      return { list: async () => revisions, stat: async () => undefined }
    }
    if (key === 'sessions') return { list: () => [liveSession], get: (id) => (id === sessionId ? liveSession : undefined) }
    if (key === 'workingDirectory') {
      return {
        get: () => liveSession.cwd ?? work,
        set: async (agent, dir) => {
          wdCalls.push({ agent: agent?.id ?? null, dir })
          liveSession.cwd = dir
          return dir
        },
      }
    }
    if (key === 'sandboxPolicy') {
      return {
        registerWritableRoot: (session, dir) => {
          grants.push({ session: session?.id ?? null, dir })
          return () => {}
        },
      }
    }
    if (key === 'tools') return null
    return undefined
  },
}

const vault = createVault(ctx, { dshHome: home, roots: [work], autoScan: false })
await vault.load()

const scan = await vault.scanNow({ force: true, max: 5 })
assert.equal(scan.scanned, 1, 'the one indexed session is scanned')
assert.equal(scan.pending, 1, 'one session was queued for scanning')
assert.equal(scan.remaining, 0, 'and the whole queue drained')

// --- overview ------------------------------------------------------------
const overview = await vault.overview({ fresh: true })
assert.equal(overview.totals.sessions, 1)
assert.equal(overview.totals.artifacts, 3, 'three written files; the failed write contributes nothing')
assert.equal(overview.sessions[0].artifacts, 3)
assert.deepEqual(overview.roots.map((entry) => path.resolve(entry)), [path.resolve(work)].map((entry) => path.resolve(entry)))
assert.equal(overview.scanning, false)
assert.equal(overview.sessions[0].title, '客户方案修订', 'the panel shows the durable title, never the bare id')
assert.equal(overview.sessions[0].shortId, shortSessionId(sessionId), 'a stable pseudo-random id names the folder')
assert.match(overview.sessions[0].workspace.folder, /[\\/]\d{8}-[a-z2-9]{8}$/u)
assert.equal(existsSync(overview.sessions[0].workspace.toolsDir), true, 'indexing creates tools/')
assert.equal(existsSync(overview.sessions[0].workspace.artifactsDir), true, 'indexing creates artifacts/')

// --- version grouping ----------------------------------------------------
const detail = await vault.sessionDetail(sessionId, { fresh: true })
assert.equal(detail.groups.length, 1, 'report-v1 / report-v2 / report_final collapse into one group')
const group = detail.groups[0]
assert.equal(group.versions.length, 3)
assert.deepEqual(group.versions.map((version) => version.name), ['report-v1.txt', 'report-v2.txt', 'report_final.txt'], 'versions are ordered by first write')
assert.deepEqual(group.versions.map((version) => version.status.includes('declared')), [false, false, true], 'present() marks the declared version')
assert.equal(group.declared, true)
assert.equal(group.label, '客户版', 'the present() description becomes the group label')
assert.equal(group.latest.path, group.versions[2].path, 'the newest version is the latest one')
assert.equal(detail.totals.versions, 3)

// --- missing files stay visible -----------------------------------------
await rm(path.join(work, 'out', 'report-v1.txt'))
const afterDelete = await vault.sessionDetail(sessionId, { fresh: true })
const version1 = afterDelete.groups[0].versions.find((version) => version.name === 'report-v1.txt')
assert.ok(version1, 'a deleted artifact is still listed')
assert.equal(version1.exists, false)
assert.ok(version1.status.includes('missing'), 'and is marked missing')
assert.ok(afterDelete.totals.bytes > 0, 'size totals ignore the missing file')

// --- recycle bin ---------------------------------------------------------
const target = path.join(work, 'out', 'report-v2.txt')
const trashed = await vault.trash({ path: target, sessionId })
assert.equal(trashed.ok, true)
await assert.rejects(() => stat(target), 'the file leaves its original location')
const overviewAfterTrash = await vault.overview({ fresh: true })
assert.equal(overviewAfterTrash.totals.trashCount, 1)
assert.ok(overviewAfterTrash.totals.trashBytes > 0)
const trashId = overviewAfterTrash.trash[0].id

// ENOSPC fix: the BYTES go to a staging dir on the SOURCE drive, so `rename`
// is instant and needs no free space on the (possibly full) home volume.
const trashEntry = overviewAfterTrash.trash[0]
const stagingBase = path.join(work, '.dsh-artifact-vault-trash')
assert.ok(trashEntry.staged, 'the manifest records where the bytes were staged')
assert.ok(trashEntry.staged.startsWith(stagingBase), 'bytes are staged under the source root, not the home volume')
assert.equal(existsSync(path.join(home, 'artifact-vault', 'trash', trashId)), false, 'the home trash dir holds no bytes for this entry')
assert.equal((await stat(trashEntry.staged)).isFile(), true, 'the staged file is intact after trashing')

const restored = await vault.restore({ id: trashId })
assert.equal(restored.ok, true)
assert.equal((await stat(target)).isFile(), true, 'restore puts the file back')
assert.equal((await vault.overview({})).totals.trashCount, 0)

// --- declare through the service (what the agent tool calls) -------------
const declared = await vault.declare({ sessionId, path: path.join(work, 'notes.md'), label: '会议纪要' })
assert.equal(declared.ok, true)
const withManual = await vault.sessionDetail(sessionId, { fresh: true })
const notesGroup = withManual.groups.find((entry) => entry.name.endsWith('notes'))
assert.ok(notesGroup, 'a declared file outside any write history still shows up')
assert.equal(notesGroup.versions[0].status.includes('declared'), true)
assert.ok(notesGroup.versions[0].status.includes('manual'), true)

// --- untracked + duplicates ---------------------------------------------
await writeFile(path.join(work, 'out', 'stray.txt'), 'nobody wrote this\n')
const untracked = await vault.untracked()
const stray = untracked.groups.flatMap((entry) => entry.files).find((file) => path.basename(file.path) === 'stray.txt')
assert.ok(stray, 'untracked() reports a file no session wrote')

await writeFile(path.join(work, 'out', 'copy-of-report.txt'), 'the shipped version\n')
const duplicates = await vault.duplicates({ includeUntracked: true })
assert.ok(duplicates.totals.groups >= 1, 'byte-identical files group together')
assert.ok(duplicates.totals.wasted > 0)

// --- per-session workspace adoption -------------------------------------
const adopted = await vault.adoptAgent({ id: sessionId })
assert.equal(adopted, overview.sessions[0].workspace.folder, 'adoption points the agent at its own folder')
assert.equal(wdCalls.length, 1, 'the working directory is switched once')
assert.equal(wdCalls[0].dir, adopted)
assert.deepEqual(grants.map((entry) => entry.dir), [path.resolve(work)], 'the project root stays writable for shared files')
assert.equal(await vault.adoptAgent({ id: sessionId }), adopted, 'a second call is a no-op')

const toolsFile = path.join(adopted, 'tools', 'probe.py')
const artifactFile = path.join(adopted, 'artifacts', 'proposal.md')
await writeFile(toolsFile, 'print(1)\n')
await writeFile(artifactFile, '# proposal\n')
await vault.declare({ sessionId, path: toolsFile })
await vault.declare({ sessionId, path: artifactFile })
const withAreas = await vault.sessionDetail(sessionId, { fresh: true })
assert.equal(withAreas.areas.tools.count, 1, 'the tools compartment knows its files')
assert.equal(withAreas.areas.artifacts.count, 1, 'and so does the artifacts compartment')

// Cleanup removes throwaway scripts before deliverables.
const cleanedTools = await vault.cleanup({ sessionId, area: 'tools' })
assert.equal(cleanedTools.moved, 1, 'the tools compartment is cleaned first')
await assert.rejects(() => stat(toolsFile))
assert.equal((await stat(artifactFile)).isFile(), true, 'artifacts survive a tools cleanup')
const cleanedArtifacts = await vault.cleanup({ sessionId, area: 'artifacts' })
assert.equal(cleanedArtifacts.moved, 1)
await assert.rejects(() => stat(artifactFile))
assert.equal(existsSync(adopted), true, 'cleanup keeps the workspace folder itself')

// --- the index survives a reload ----------------------------------------
await vault.flushSave()
const stored = JSON.parse(await readFile(path.join(home, 'artifact-vault', 'index.json'), 'utf8'))
assert.equal(stored.version, 1)
assert.ok(stored.sessions[sessionId], 'the session entry is persisted')
assert.ok(Array.isArray(stored.sessions[sessionId].writes) && stored.sessions[sessionId].writes.length > 0)

const reloaded = createVault(ctx, { dshHome: home, roots: [work] })
await reloaded.load()
const reloadedOverview = await reloaded.overview({})
assert.equal(reloadedOverview.totals.sessions, 1, 'a fresh vault reads the persisted index')

// --- a session deleted in DSH takes its whole folder ---------------------
records.length = 0
const reconciliation = await reloaded.reconcileDeleted()
assert.equal(reconciliation.removed.length, 1, 'only a session absent from store and log counts as deleted')
assert.equal(existsSync(adopted), false, 'its workspace folder leaves the project directory')
const folderTrash = (await reloaded.overview({})).trash.find((entry) => entry.kind === 'folder')
assert.ok(folderTrash, 'the folder waits in the recycle bin instead of vanishing')
assert.equal(folderTrash.reason, 'session-deleted')
assert.equal((await reloaded.overview({})).sessions.length, 0)

await rm(root, { recursive: true, force: true })
console.log('host smoke test passed: scan, titles, workspace folders, adoption, area cleanup, session deletion, grouping, missing, recycle bin, declare, untracked, duplicates, persistence')
