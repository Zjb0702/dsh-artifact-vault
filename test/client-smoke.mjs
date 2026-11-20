// Headless smoke test for the Client half.
//
// It does not render React; it checks the parts a broken bundle fails first:
// the loader handshake, the factory contract, the declared inject list, the
// locale registration, and every slot registration (name / id / order).
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = await readFile(path.join(here, '..', 'client.js'), 'utf8')

// --- a fake document so the CSS injector can run --------------------------
const styles = []
const fakeDocument = {
  head: { appendChild: (node) => { styles.push(node); return node } },
  createElement: (tag) => ({ tag, textContent: '', dataset: {}, setAttribute() {}, removed: false, remove() {} }),
  querySelector: () => null,
}

// --- a tiny React stand-in ------------------------------------------------
const passthroughHook = (value) => value
const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useCallback: (fn) => passthroughHook(fn),
  useRef: (initial) => ({ current: initial }),
  Fragment: Symbol('Fragment'),
}

// --- capture the module the loader asks us to build ----------------------
let definition = null
const fakeWindow = { __ModuleLoader__: { load: (input) => { definition = input } } }

const run = new Function('window', 'document', `${source}\n`)
run(fakeWindow, fakeDocument)

assert.ok(definition, 'client.js never called window.__ModuleLoader__.load')
// Read the manifest instead of hardcoding: the loader id MUST track the
// package name, so a rename shows up here as a failure rather than in the UI.
const manifest = JSON.parse(await readFile(path.join(here, '..', 'package.json'), 'utf8'))
assert.equal(definition.id, manifest.name, 'loader id must equal the package name in package.json')

const moduleExports = definition.factory((specifier) => {
  assert.equal(specifier, 'react', `the client half must only require react (asked for ${specifier})`)
  return React
})

assert.equal(typeof moduleExports.apply, 'function', 'factory must export apply(ctx)')
assert.deepEqual(moduleExports.inject, ['slots', 'locale'], 'inject must request exactly slots and locale')

// --- drive apply() with a recording ctx ----------------------------------
const registrations = []
const locales = []
const effects = []
const ctx = {
  get: (key) => {
    if (key === 'locale') return { register: (...args) => { locales.push(args); return () => {} } }
    throw new Error(`unexpected ctx.get(${key})`)
  },
  effect: (fn, label) => { effects.push(label); const cleanup = fn(); return cleanup },
  slots: {
    inject: (slotName, callback) => {
      assert.equal(typeof callback, 'function', 'slots.inject needs a callback')
      const entry = { slotName, options: undefined, component: undefined }
      registrations.push(entry)
      entry.disposer = callback()
      return () => {}
    },
    register: (options, component) => {
      const entry = registrations[registrations.length - 1]
      assert.ok(entry, 'slots.register ran before slots.inject')
      entry.options = options
      entry.component = component
      return () => {}
    },
  },
}

moduleExports.apply(ctx)

const byName = new Map(registrations.map((entry) => [entry.options?.name, entry]))

assert.equal(byName.size, 2, `expected exactly 2 slot registrations, saw ${[...byName.keys()].join(', ')}`)
for (const forbidden of ['sidebar.panellist', 'main', 'settings.general.item', 'settings.action']) {
  assert.ok(!byName.has(forbidden), `the UI now belongs to settings.section, so ${forbidden} must not be registered`)
}

const section = byName.get('settings.section')
assert.ok(section, 'a settings.section registration is required (the UI lives inside Settings)')
assert.equal(section.options.id, 'artifact-vault')
assert.equal(section.options.order, 47)
assert.equal(typeof section.component, 'function', 'settings.section needs a component')
assert.equal(typeof section.options.label, 'function', 'label must be a thunk so locale changes re-project')
assert.equal(section.options.label(), '产物管家', 'the zh label comes from the local dictionary when no locale service answers')

const icon = byName.get('settings.section.icon')
assert.ok(icon, 'the nav icon is addressed by the section id and needs its own registration')
assert.equal(icon.options.id, 'artifact-vault', 'icon id must match the settings.section id')
assert.equal(typeof icon.component, 'function')

assert.equal(locales.length, 2, 'both dictionaries register')
assert.deepEqual(locales.map(([ns, locale]) => [ns, locale]), [['artifact-vault', 'zh'], ['artifact-vault', 'en']])
assert.ok(effects.includes('artifact-vault: locale'), 'locale registration runs inside ctx.effect')

assert.equal(styles.length, 1, 'the stylesheet is injected exactly once')
assert.match(styles[0].textContent, /\.av-root\{/, 'the stylesheet carries the page styles')
assert.match(styles[0].textContent, /--dsw-alias-/, 'styles must consume theme tokens instead of hard-coded colors')

console.log('client smoke test passed: loader handshake, inject list, settings.section + icon, locale, styles')
