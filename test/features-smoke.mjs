// Focused tests for the new features: whole-folder trash, recycle-bin
// listing with sorting, and C-drive usage/cleanup (with a fake ~/.dsh).
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, rm, stat, readdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import os from 'node:os'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const { __internals } = await import(pathToFileURL(path.join(here, '..', 'index.js')).href)
const { createVault } = __internals

const root = await mkdtemp(path.join(os.tmpdir(), 'artifact-vault-features-'))
const home = path.join(root, 'home')
const work = path.join(root, 'work')
await mkdir(home, { recursive: true })
await mkdir(work, { recursive: true })

const T0 = 1_700_000_000_000
const header = { version: 1, id: 'session-feat', createdAt: T0, cwd: work, isSeeded: false }
const records = [{ header, live: false, persisted: true }]
const revisions = [{ header, revision: 12, eventCount: 2, sizeBytes: 1024 }]
const ctx = {
  logger: { warn() {} },
  get(key) {
    if (key === 'sessionQuery') return {
      listSessions: async () => records,
      readSession: async (id) => (id === header.id ? { session: header, inheritedEventCount: 0, events: [{ type: 'turn/start', data: { turn: 1 }, time: T0 }] } : undefined),
      readTitle: async () => undefined,
    }
    if (key === 'sessionPersistence') return { list: async () => revisions, stat: async () => undefined }
    if (key === 'sessions') return { list: () => [], get: () => undefined }
    if (key === 'tools') return null
    return undefined
  },
}

const vault = createVault(ctx, { dshHome: home, roots: [work], autoScan: false })
await vault.load()
await vault.scanNow({ force: true, max: 5 })

// --- whole-folder trash ---------------------------------------------------
const folder = path.join(work, 'out', 'nested')
await mkdir(folder, { recursive: true })
await writeFile(path.join(folder, 'a.txt'), 'aaa')
await writeFile(path.join(folder, 'b.txt'), 'bbbb')
await vault.declare({ sessionId: header.id, path: path.join(folder, 'a.txt') })
await vault.declare({ sessionId: header.id, path: path.join(folder, 'b.txt') })

const trashed = await vault.trash({ path: folder, sessionId: header.id, kind: 'folder' })
assert.equal(trashed.ok, true)
assert.equal(trashed.kind, 'folder', 'the trash records the entry as a folder')
assert.equal(existsSync(folder), false, 'the folder leaves its original path')

const listed = await vault.listTrash({ sort: 'size', order: 'desc' })
assert.equal(listed.items.some((item) => item.kind === 'folder'), true, 'recycle-bin listing shows the folder')
assert.equal(listed.totals.folders >= 1, true)
const folderEntry = listed.items.find((item) => item.kind === 'folder')
assert.equal(folderEntry.present, true, 'the staged folder exists')
assert.equal(folderEntry.size, 7, 'size is the sum of the folder bytes')
const ascending = await vault.listTrash({ sort: 'size', order: 'asc' })
assert.ok(ascending.items[0].size <= ascending.items[ascending.items.length - 1].size, 'ascending sort is applied')

// restore the whole folder
const restored = await vault.restore({ id: folderEntry.id })
assert.equal(restored.ok, true)
assert.equal(existsSync(path.join(folder, 'a.txt')), true, 'restore brings the whole folder back')
assert.equal((await vault.listTrash({})).items.some((item) => item.id === folderEntry.id), false, 'and clears the manifest entry')

// --- untracked buckets expose a deletable dir + batch delete --------------
const strayDir = path.join(work, 'bulk-folder')
await mkdir(strayDir, { recursive: true })
for (let i = 0; i < 5; i += 1) await writeFile(path.join(strayDir, `f${i}.bin`), `data-${i}`)
const untracked = await vault.untracked()
const bucket = untracked.groups.find((group) => group.label === 'bulk-folder')
assert.ok(bucket, 'the untracked view groups by folder')
assert.equal(bucket.dir, strayDir, 'each bucket carries its real directory for whole-folder delete')
assert.equal(bucket.deletable, true, 'a nested bucket is deletable as a folder')
assert.equal(bucket.count, 5)

// Batch delete only two of them, leaving the rest.
const two = bucket.files.slice(0, 2).map((file) => file.path)
const batch = await vault.trashMany({ paths: two })
assert.equal(batch.moved, 2, 'trash-many recycles the selected files')
assert.equal(batch.failed, 0)
assert.equal(existsSync(two[0]), false)
assert.equal(existsSync(path.join(strayDir, 'f4.bin')), true, 'unselected files stay put')

// The rest go as one folder.
const folderResult = await vault.trash({ path: strayDir, kind: 'folder' })
assert.equal(folderResult.kind, 'folder')
assert.equal(existsSync(strayDir), false, 'whole-folder delete removes the directory itself')
assert.equal((await vault.listTrash({})).items.some((item) => item.display.includes('bulk-folder')), true)

// A bad id in the batch is reported, not thrown.
const mixed = await vault.trashMany({ paths: [path.join(work, 'does-not-exist.bin')] })
assert.equal(mixed.failed, 1, 'a missing path fails individually instead of aborting the batch')

// --- C-drive usage + safe cleanup ----------------------------------------
// Fake a ~/.dsh layout: a stale session log, a live session log, and a cache.
const homeSessions = path.join(home, 'sessions', '--project--')
const staleId = 'session-gone-123'
const stale = path.join(homeSessions, staleId)
await mkdir(stale, { recursive: true })
await writeFile(path.join(stale, 'session.v4.jsonl.zstd'), 'stale-log')
const liveSid = 'session-live'
const liveDir = path.join(homeSessions, liveSid)
await mkdir(liveDir, { recursive: true })
await writeFile(path.join(liveDir, 'session.v4.jsonl.zstd'), 'live-log')
records.push({ header: { ...header, id: liveSid }, live: true, persisted: true })
const cacheDir = path.join(home, 'plugins', 'rea-bundle', 'cache')
await mkdir(cacheDir, { recursive: true })
await writeFile(path.join(cacheDir, 'big.zip'), 'cached-zip')

const usage = await vault.cDriveUsage()
assert.equal(usage.homeOnC, home[0].toUpperCase() === 'C', 'homeOnC reflects the real drive of the fake home')
assert.equal(usage.categories.some((cat) => cat.id === 'sessions'), true, 'usage shows the sessions category')
const planIds = usage.plans.map((plan) => plan.id)
assert.equal(planIds.some((id) => id === 'rea-cache'), true, 'the rea cache is a cleanup plan')
assert.equal(planIds.some((id) => id === `session:${staleId}`), true, 'the stale session log is a cleanup plan')
assert.equal(planIds.some((id) => id === `session:${liveSid}`), false, 'a live session log is NEVER a cleanup plan')

const cleaned = await vault.cDriveClean({ ids: ['rea-cache'] })
assert.equal(cleaned.ok, true)
assert.equal(existsSync(path.join(cacheDir, 'big.zip')), false, 'the selected cache is removed')
assert.equal(existsSync(path.join(liveDir, 'session.v4.jsonl.zstd')), true, 'the live session log is untouched')
assert.equal(existsSync(work), true, 'the workspace root is untouched')

await assert.rejects(() => vault.cDriveClean({ ids: [`session:${liveSid}`] }), 'cleaning a non-plan id is refused')

await rm(root, { recursive: true, force: true })
console.log('feature smoke test passed: folder trash, sorted recycle bin, restore folder, C-drive usage plan, safe cache cleanup')
