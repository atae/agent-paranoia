// File transfer protocol (client/src/transfer.js), run in Node with two
// simulated peers connected by an in-memory channel.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'url'

const T = fileURLToPath(new URL('../../client/src/transfer.js', import.meta.url))
const fresh = async tag => (await import(`file://${T}?${tag}`)).Transfer

// Two peers with separate module state, connected by an async "channel".
async function pair(tag) {
  const A = await fresh(tag + 'a'), B = await fresh(tag + 'b')
  const log = { offers: [], done: [], errors: [], recvProgress: [] }
  let bHandlers, aHandlers
  const deliver = (to, handlers, d) => new Promise(r => setImmediate(() => { to.handleIncoming(d, handlers()); r() }))
  const aSend = d => deliver(B, () => bHandlers, d)
  const bSend = d => deliver(A, () => aHandlers, d)
  aHandlers = { onOffer(){}, onProgress(){}, onComplete(){}, onError(){} }
  bHandlers = {
    onOffer: m => log.offers.push(m),
    onProgress: p => log.recvProgress.push(p),
    onComplete: r => log.done.push(r),
    onError: (n, m) => log.errors.push(m),
  }
  return { A, B, aSend, bSend, log }
}
const file = (size, name = 'f.bin') => {
  const bytes = new Uint8Array(size).map((_, i) => i % 251)
  return { name, size, bytes, slice: (s, e) => new Blob([bytes.slice(s, e)]) }
}
const tick = () => new Promise(r => setTimeout(r, 20))
const fakeWritable = () => { const w = { parts: [], closed: false, aborted: false,
  write: async d => { w.parts.push(new Uint8Array(d)) }, close: async () => { w.closed = true }, abort: async () => { w.aborted = true } }; return w }

test('Accept into memory: bytes arrive intact; sender progress ends at 100', async () => {
  const { A, B, aSend, bSend, log } = await pair('m')
  const f = file(200_000); const prog = []
  const p = A.sendFile(f, aSend, x => prog.push(x))
  await tick(); assert.equal(log.offers.length, 1); assert.equal(log.offers[0].size, 200_000)
  B.accept(log.offers[0], {}, bSend)
  assert.equal(await p, 'sent'); await tick()
  const got = new Uint8Array(await log.done[0].blob.arrayBuffer())
  assert.deepEqual(got, f.bytes); assert.equal(prog.at(-1).percent, 100)
  assert.ok(prog.slice(0, -1).every(x => x.percent < 100), 'no early 100')
  assert.ok(log.recvProgress.every(x => x.percent < 100))
})

test('Accept to disk: written in order and closed, nothing kept in memory', async () => {
  const { A, B, aSend, bSend, log } = await pair('d')
  const f = file(300_000); const w = fakeWritable()
  const p = A.sendFile(f, aSend, () => {})
  await tick(); B.accept(log.offers[0], { writable: w, savedAs: 'f (1).bin' }, bSend)
  await p; await tick()
  const joined = Uint8Array.from(w.parts.flatMap(x => [...x]))
  assert.deepEqual(joined, f.bytes); assert.ok(w.closed)
  assert.equal(log.done[0].savedAs, 'f (1).bin'); assert.equal(log.done[0].blob, undefined)
})

test("Decline: sender gets 'declined', receiver gets no data", async () => {
  const { A, B, aSend, bSend, log } = await pair('x')
  const p = A.sendFile(file(100_000), aSend, () => {})
  await tick(); B.decline(log.offers[0], bSend)
  assert.equal(await p, 'declined'); await tick()
  assert.equal(log.done.length, 0); assert.equal(B.isReceiving(), false)
})

test('Chunks before accepting are dropped', async () => {
  const { B, log } = await pair('u')
  B.handleIncoming(new ArrayBuffer(1000), { onOffer(){}, onProgress: p => log.recvProgress.push(p), onComplete(){}, onError(){} })
  assert.equal(log.recvProgress.length, 0)
})

test('Peer sends more than announced: transfer aborted, disk file discarded', async () => {
  const { B, bSend, log } = await pair('o')
  const h = { onOffer: m => log.offers.push(m), onProgress(){}, onComplete: r => log.done.push(r), onError: (n, m) => log.errors.push(m) }
  B.handleIncoming(JSON.stringify({ type: 'file-meta', id: 'z', name: 'tiny', size: 10, totalChunks: 1 }), h)
  const w = fakeWritable(); B.accept(log.offers[0], { writable: w, savedAs: 'tiny' }, () => {})
  B.handleIncoming(new ArrayBuffer(10_000_000), h)
  assert.match(log.errors[0], /more data/); assert.ok(w.aborted); assert.equal(B.isReceiving(), false)
})

test('Malformed offers ignored', async () => {
  const { B, log } = await pair('b')
  const h = { onOffer: m => log.offers.push(m), onProgress(){}, onComplete(){}, onError(){} }
  for (const bad of [{ type: 'file-meta' }, { type: 'file-meta', id: 'a', name: 'x', size: -1, totalChunks: 0 },
    { type: 'file-meta', id: 'a', name: 'x', size: 1e300, totalChunks: 0 }]) B.handleIncoming(JSON.stringify(bad), h)
  B.handleIncoming('not json', h)
  assert.equal(log.offers.length, 0)
})

test('Disconnect while waiting for answer: sender throws; partial receive aborted', async () => {
  const { A, B, aSend, bSend, log } = await pair('r')
  const p = A.sendFile(file(100_000), aSend, () => {})
  await tick(); A.reset()
  await assert.rejects(p, /disconnected/)
  const w = fakeWritable(); B.accept(log.offers[0], { writable: w }, () => {})
  B.handleIncoming(new ArrayBuffer(100), { onOffer(){}, onProgress(){}, onComplete(){}, onError(){} })
  B.reset(); await tick(); assert.ok(w.aborted); assert.equal(B.isReceiving(), false)
})

test('Empty file', async () => {
  const { A, B, aSend, bSend, log } = await pair('e')
  const p = A.sendFile(file(0, 'empty.txt'), aSend, () => {})
  await tick(); B.accept(log.offers[0], {}, bSend); await p; await tick()
  assert.equal(log.done[0].blob.size, 0)
})

test('Speed is a smoothed rate, not per-chunk spikes', async () => {
  const { A, B, aSend, bSend, log } = await pair('s')
  // Simulate a 2 MB/s link: each 64 KB chunk takes ~32 ms.
  const slowSend = async d => { if (typeof d !== 'string') await new Promise(r => setTimeout(r, 32)); return aSend(d) }
  const prog = []
  const p = A.sendFile(file(64 * 1024 * 40), slowSend, x => prog.push(x))
  await tick(); B.accept(log.offers[0], {}, bSend); await p
  const speeds = prog.map(x => x.speed).filter(Boolean).map(s => s / 1024 / 1024)
  const lo = Math.min(...speeds), hi = Math.max(...speeds)
  assert.ok(lo > 1.4 && hi < 2.6)
})
