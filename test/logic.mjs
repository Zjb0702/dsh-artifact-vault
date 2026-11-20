// Smoke test for the pure host helpers: `node test/logic.mjs`.
import assert from 'node:assert/strict'

import { extractToolPaths } from '../lib/extract.js'
import { folderArea, formatBytes, groupKeyOf, normalizeStem, pathKey, sessionFolderName, shortSessionId } from '../lib/util.js'

const cwd = 'D:\\work\\proj'

// --- version stems -------------------------------------------------------
assert.equal(normalizeStem('方案-v2'), '方案')
assert.equal(normalizeStem('report_final'), 'report')
assert.equal(normalizeStem('deck（3）'), 'deck')
assert.equal(normalizeStem('20240101-draft'), '20240101')
assert.equal(normalizeStem('data'), 'data')

// Same directory + normalized stem + extension groups together.
const a = groupKeyOf('D:\\work\\proj\\out\\方案 v1.docx')
const b = groupKeyOf('D:\\work\\proj\\out\\方案 v2.docx')
const c = groupKeyOf('D:\\work\\proj\\out\\方案 v2.pdf')
assert.equal(a, b, 'versions of one document share a group')
assert.notEqual(a, c, 'a different extension is a different group')

assert.equal(pathKey('D:\\Work\\PROJ\\A.md'), pathKey('d:/work/proj/a.md'))
assert.equal(formatBytes(0), '0 B')
assert.equal(formatBytes(1536), '1.5 KB')

// --- tool-call extraction ------------------------------------------------
const write = extractToolPaths(
  { name: 'write', arguments: JSON.stringify({ file_path: 'D:\\work\\proj\\out\\a.md', content: 'x' }) },
  { cwd },
)
assert.equal(write.length, 1)
assert.equal(write[0].raw, 'D:\\work\\proj\\out\\a.md')
assert.equal(write[0].conf, 'high')

const relative = extractToolPaths({ name: 'edit', arguments: { path: 'out\\b.md' } }, { cwd })
assert.equal(relative.length, 1)
assert.equal(relative[0].raw, 'out\\b.md')

const present = extractToolPaths(
  {
    name: 'present',
    arguments: {
      files: [
        { path: 'C:\\Users\\me\\Desktop\\deck.pptx', description: '客户版' },
        'D:\\work\\proj\\report.xlsx',
      ],
    },
  },
  { cwd },
)
assert.equal(present.length, 2)
assert.ok(present.every((entry) => entry.declared === true))
assert.equal(present[0].label, '客户版')

const patch = extractToolPaths(
  {
    name: 'apply_patch',
    arguments: {
      patch: '*** Begin Patch\n*** Add File: src/new.ts\n+hello\n*** Update File: D:\\work\\proj\\old.ts\n*** End Patch',
    },
  },
  { cwd },
)
assert.deepEqual(patch.map((entry) => entry.raw).sort(), ['D:\\work\\proj\\old.ts', 'src/new.ts'])

const shell = extractToolPaths(
  { name: 'bash', arguments: { command: 'python build.py > out/report.txt && cp out/report.txt /tmp/final.txt' } },
  { cwd },
)
assert.deepEqual(shell.map((entry) => entry.raw).sort(), ['/tmp/final.txt', 'out/report.txt'])
assert.ok(shell.every((entry) => entry.conf === 'low'))

// Content-only arguments must not look like paths.
const noisy = extractToolPaths(
  { name: 'write', arguments: { file_path: 'D:\\work\\proj\\out\\a.md', content: 'see https://example.com and ./relative' } },
  { cwd },
)
assert.equal(noisy.length, 1)

// --- per-session workspace ids -------------------------------------------
const short = shortSessionId('session-9c1f0e2a-77aa-4c76-9a1e-0f0a1b2c3d4e')
assert.match(short, /^[a-z2-9]{8}$/u, 'the short id is 8 typeable characters')
assert.equal(shortSessionId('session-9c1f0e2a-77aa-4c76-9a1e-0f0a1b2c3d4e'), short, 'and stable for the same session')
assert.notEqual(shortSessionId('another-session'), short, 'different sessions never collide here')
assert.equal(shortSessionId('session-x', 10).length, 10)
assert.match(sessionFolderName(Date.UTC(2026, 10, 18, 12), short), /^2026111\d-[a-z2-9]{8}$/u, 'date prefix + short id')

const folder = 'D:\\work\\proj\\sessions\\20261118-a1b2c3d4'
assert.equal(folderArea('D:\\work\\proj\\elsewhere\\a.md', folder), 'outside')
assert.equal(folderArea(`${folder}\\stray.txt`, folder), 'loose')
assert.equal(folderArea(`${folder}\\tools\\probe.py`, folder), 'tools')
assert.equal(folderArea(`${folder}\\Artifacts\\deck.pptx`, folder), 'artifacts', 'compartment names match case-insensitively')

console.log('artifact-vault logic: OK', {
  groups: [a, b, c].map((key) => key.split('|').pop()),
  write: write[0].raw,
  present: present.map((entry) => entry.raw),
  patch: patch.map((entry) => entry.raw),
  shell: shell.map((entry) => entry.raw),
})
