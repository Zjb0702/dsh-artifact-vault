// Smoke test for the pure host helpers: `node test/logic.mjs`.
//
// Paths are built with node:path from a per-platform base so this suite runs on
// Windows, macOS and Linux alike; the only platform-specific assertion states
// the documented difference (pathKey folds case on win32 only).
import assert from 'node:assert/strict'
import path from 'node:path'

import { extractToolPaths } from '../lib/extract.js'
import { folderArea, formatBytes, groupKeyOf, normalizeStem, pathKey, sessionFolderName, shortSessionId } from '../lib/util.js'

const base = process.platform === 'win32' ? 'D:\\work\\proj' : '/work/proj'
const out = path.join(base, 'out')
const cwd = base

// --- version stems -------------------------------------------------------
assert.equal(normalizeStem('方案-v2'), '方案')
assert.equal(normalizeStem('report_final'), 'report')
assert.equal(normalizeStem('deck（3）'), 'deck')
assert.equal(normalizeStem('20240101-draft'), '20240101')
assert.equal(normalizeStem('data'), 'data')

// Same directory + normalized stem + extension groups together.
const a = groupKeyOf(path.join(out, '方案 v1.docx'))
const b = groupKeyOf(path.join(out, '方案 v2.docx'))
const c = groupKeyOf(path.join(out, '方案 v2.pdf'))
assert.equal(a, b, 'versions of one document share a group')
assert.notEqual(a, c, 'a different extension is a different group')

// pathKey folds case on Windows (case-insensitive filesystem) and preserves it
// elsewhere; asserting the documented behaviour keeps the suite portable.
const upperKey = pathKey(path.join(base, 'A.md'))
const lowerKey = pathKey(path.join(base, 'a.md'))
if (process.platform === 'win32') {
  assert.equal(upperKey, lowerKey, 'win32 folds path case')
} else {
  assert.notEqual(upperKey, lowerKey, 'posix keeps path case')
}

assert.equal(formatBytes(0), '0 B')
assert.equal(formatBytes(1536), '1.5 KB')

// --- tool-call extraction ------------------------------------------------
const written = path.join(out, 'a.md')
const write = extractToolPaths(
  { name: 'write', arguments: JSON.stringify({ file_path: written, content: 'x' }) },
  { cwd },
)
assert.equal(write.length, 1)
assert.equal(write[0].raw, written)

const present = extractToolPaths(
  {
    name: 'present',
    arguments: {
      files: [
        { path: path.join(base, 'deck.pptx'), description: '客户版' },
        path.join(base, 'report.xlsx'),
      ],
    },
  },
  { cwd },
)
assert.equal(present.length, 2)
assert.ok(present.every((entry) => entry.declared === true))
assert.equal(present[0].label, '客户版')

const patched = path.join(base, 'old.ts')
const patch = extractToolPaths(
  {
    name: 'apply_patch',
    arguments: {
      patch: `*** Begin Patch\n*** Add File: src/new.ts\n+hello\n*** Update File: ${patched}\n*** End Patch`,
    },
  },
  { cwd },
)
assert.deepEqual(patch.map((entry) => entry.raw).sort(), ['src/new.ts', patched].sort())

const shell = extractToolPaths(
  { name: 'bash', arguments: { command: 'python build.py > out/report.txt && cp out/report.txt /tmp/final.txt' } },
  { cwd },
)
assert.deepEqual(shell.map((entry) => entry.raw).sort(), ['/tmp/final.txt', 'out/report.txt'])
assert.ok(shell.every((entry) => entry.conf === 'low'))

// Content-only arguments must not look like paths.
const noisy = extractToolPaths(
  { name: 'write', arguments: { file_path: written, content: 'see https://example.com and ./relative' } },
  { cwd },
)
assert.equal(noisy.length, 1)

// --- per-session workspace ids -------------------------------------------
const short = shortSessionId('session-9c1f0e2a-77aa-4c76-9a1e-0f0a1b2c3d4e')
assert.match(short, /^[a-z2-9]{8}$/u, 'the short id is 8 typeable characters')
assert.equal(shortSessionId('session-9c1f0e2a-77aa-4c76-9a1e-0f0a1b2c3d4e'), short, 'and stable for the same session')
assert.notEqual(shortSessionId('another-session'), short, 'different sessions never collide here')
assert.equal(shortSessionId('session-x', 10).length, 10)
assert.match(sessionFolderName(Date.UTC(2026, 10, 18, 12), short), /^\d{8}-[a-z2-9]{8}$/u, 'date prefix + short id')

const folder = path.join(base, 'sessions', '20261118-a1b2c3d4')
assert.equal(folderArea(path.join(base, 'elsewhere', 'a.md'), folder), 'outside')
assert.equal(folderArea(path.join(folder, 'stray.txt'), folder), 'loose')
assert.equal(folderArea(path.join(folder, 'tools', 'probe.py'), folder), 'tools')
assert.equal(folderArea(path.join(folder, 'Artifacts', 'deck.pptx'), folder), 'artifacts', 'compartment names match case-insensitively')

console.log('artifact-vault logic: OK', {
  platform: process.platform,
  base,
  groups: [a, b, c].map((key) => key.split('|').pop()),
  present: present.map((entry) => entry.raw),
  patch: patch.map((entry) => entry.raw),
  shell: shell.map((entry) => entry.raw),
})
