// Security regression: every HTTP route must pass DSH's connection.requestRejection()
// gate before any handler logic runs. Without it, any page open in the user's
// browser could CSRF-POST to our loopback routes and recycle/purge their files.
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const { __internals } = await import(pathToFileURL(path.join(here, '..', 'index.js')).href)
const { makeRoutes, ROUTE_BASE } = __internals

function fakeResponse() {
  return {
    status: null,
    body: null,
    writeHead(status) { this.status = status; return this },
    end(body) { this.body = body ?? ''; return this },
  }
}

const loopbackReq = (method = 'GET') => ({
  method,
  url: `${ROUTE_BASE}/health`,
  socket: { remoteAddress: '127.0.0.1' },
})

// Minimal service: health route only reads these two fields.
const service = { dataDir: '/tmp/vault', rootsForScan: () => [] }

// --- 1. inject declares the connection dependency ---
const mod = await import(pathToFileURL(path.join(here, '..', 'index.js')).href)
assert.ok(mod.inject.includes('connection'), 'inject must include connection')

// --- 2. A rejection status propagates as the HTTP status, handler not reached ---
let rejectStatus = 403
const rejectingCtx = { connection: { requestRejection: () => rejectStatus } }
const routes = makeRoutes(rejectingCtx, service)
const health = routes.find((r) => r.path === `${ROUTE_BASE}/health`)
assert.ok(health, 'health route registered')

let res = fakeResponse()
await health.handler(loopbackReq('GET'), res)
assert.equal(res.status, 403, '403 rejection must become HTTP 403')
assert.match(res.body, /untrusted or unauthenticated/, 'error body explains rejection')

rejectStatus = 401
res = fakeResponse()
await health.handler(loopbackReq('GET'), res)
assert.equal(res.status, 401, '401 rejection must be preserved')

// A mutating route must also be gated (this is the CSRF scenario).
const trash = routes.find((r) => r.path === `${ROUTE_BASE}/trash`)
assert.ok(trash, 'trash route registered')
res = fakeResponse()
await trash.handler(loopbackReq('POST'), res)
assert.equal(res.status, 401, 'POST /trash must be gated too (current rejectStatus = 401)')
assert.match(res.body, /untrusted or unauthenticated/)

// --- 3. undefined admission lets the real handler run ---
const admittingCtx = { connection: { requestRejection: () => undefined } }
const admittedRoutes = makeRoutes(admittingCtx, service)
const admittedHealth = admittedRoutes.find((r) => r.path === `${ROUTE_BASE}/health`)
res = fakeResponse()
await admittedHealth.handler(loopbackReq('GET'), res)
assert.equal(res.status, 200, 'admitted request reaches handler (HTTP 200)')
assert.match(res.body, /"ok":true/, 'handler produced its normal payload')

// --- 4. No connection service at all (headless) still admits, no crash ---
const headlessRoutes = makeRoutes({}, service)
const headlessHealth = headlessRoutes.find((r) => r.path === `${ROUTE_BASE}/health`)
res = fakeResponse()
await headlessHealth.handler(loopbackReq('GET'), res)
assert.equal(res.status, 200, 'headless context without connection does not crash')

console.log('security-smoke: PASS (requestRejection gate enforced on all routes)')
