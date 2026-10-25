// Safety code protocol (client/src/safety.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'url'

const P = fileURLToPath(new URL('../../client/src/safety.js', import.meta.url))
const { createSafetyCheck, fingerprintFromSdp, EMOJI, SafetyProtocolError } = await import(`file://${P}`)

const fp = c => `sha-256 ${Array.from({ length: 32 }, () => c).join(':')}`
const A = fp('AA'), B = fp('BB'), M1 = fp('11'), M2 = fp('22')
const tick = () => new Promise(r => setImmediate(r))
const flush = async () => { for (let i = 0; i < 10; i++) await tick() }
const codeStr = code => code.map(s => s.emoji).join('')

// Two checks wired together; `wire(from, msg)` can tamper with traffic.
function pair({ aFps, bFps, wire = (from, msg) => msg }) {
  let a, b
  a = createSafetyCheck({ role: 'committer', localFp: aFps[0], remoteFp: aFps[1],
    send: m => { const x = wire('a', m); if (x) setImmediate(() => b.handle(x)) } })
  b = createSafetyCheck({ role: 'responder', localFp: bFps[0], remoteFp: bFps[1],
    send: m => { const x = wire('b', m); if (x) setImmediate(() => a.handle(x)) } })
  return { a, b }
}

test('emoji list: 64 distinct symbols with distinct names', () => {
  assert.equal(EMOJI.length, 64)
  assert.equal(new Set(EMOJI.map(e => e[0])).size, 64)
  assert.equal(new Set(EMOJI.map(e => e[1])).size, 64)
  assert.equal(new Set(EMOJI.map(e => e[2])).size, 64)
})

test('honest connection: both sides see the same 5-emoji code', async () => {
  const { a, b } = pair({ aFps: [A, B], bFps: [B, A] })
  await a.start(); await b.start()
  const [ca, cb] = await Promise.all([a.result, b.result])
  assert.equal(ca.length, 5)
  assert.equal(codeStr(ca), codeStr(cb))
  assert.ok(ca[0].en && ca[0].jp)
})

test('codes differ between calls (fresh randomness each time)', async () => {
  const seen = new Set()
  for (let i = 0; i < 5; i++) {
    const { a, b } = pair({ aFps: [A, B], bFps: [B, A] })
    await a.start(); await b.start()
    seen.add(codeStr(await a.result))
  }
  assert.ok(seen.size > 1)
})

test('man in the middle relaying messages: codes do not match', async () => {
  // A is really talking to the attacker's key M1, B to M2.
  const { a, b } = pair({ aFps: [A, M1], bFps: [B, M2] })
  await a.start(); await b.start()
  const [ca, cb] = await Promise.all([a.result, b.result])
  assert.notEqual(codeStr(ca), codeStr(cb))
})

test('man in the middle running its own exchange on each side: codes do not match', async () => {
  // Attacker is the responder towards A and the committer towards B.
  const toA = createSafetyCheck({ role: 'responder', localFp: M1, remoteFp: A, send: m => setImmediate(() => a.handle(m)) })
  const toB = createSafetyCheck({ role: 'committer', localFp: M2, remoteFp: B, send: m => setImmediate(() => b.handle(m)) })
  const a = createSafetyCheck({ role: 'committer', localFp: A, remoteFp: M1, send: m => setImmediate(() => toA.handle(m)) })
  const b = createSafetyCheck({ role: 'responder', localFp: B, remoteFp: M2, send: m => setImmediate(() => toB.handle(m)) })
  await toB.start(); await a.start()
  const [ca, cb] = await Promise.all([a.result, b.result])
  assert.notEqual(codeStr(ca), codeStr(cb))
})

test('a reveal that does not match the commitment is treated as an attack', async () => {
  const { a, b } = pair({
    aFps: [A, B], bFps: [B, A],
    wire: (from, msg) => msg.type === 'sas-reveal' ? { ...msg, n: 'f'.repeat(64) } : msg,
  })
  await a.start()
  await assert.rejects(b.result, SafetyProtocolError)
})

test('out-of-order and malformed messages are ignored', async () => {
  const sent = []
  const r = createSafetyCheck({ role: 'responder', localFp: B, remoteFp: A, send: m => sent.push(m) })
  r.handle({ type: 'sas-reveal', n: 'a'.repeat(64) })    // reveal before any commit
  r.handle({ type: 'sas-commit', h: 'not hex' })
  await flush()
  assert.equal(sent.length, 0)
  assert.equal(r.handle({ text: 'hello' }), false, 'normal chat messages are not swallowed')

  const c = createSafetyCheck({ role: 'committer', localFp: A, remoteFp: B, send: m => sent.push(m) })
  c.handle({ type: 'sas-nonce', n: 'b'.repeat(64) })     // nonce before we committed
  assert.equal(sent.length, 0)
})

test('reads the DTLS fingerprint out of an SDP', () => {
  const sdp = 'v=0\r\na=ice-ufrag:x\r\na=fingerprint:SHA-256 ab:cd:EF\r\na=setup:actpass\r\n'
  assert.equal(fingerprintFromSdp(sdp), 'sha-256 AB:CD:EF')
  assert.equal(fingerprintFromSdp('v=0\r\n'), null)
})
