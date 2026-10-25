// Signaling server behaviour, including the room lifecycle bugs found in
// practice and a randomized test that checks room bookkeeping never drifts.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { io as connect } from 'socket.io-client'
import { createApp } from '../app.js'

const quietLog = { warn() {}, log() {} }
let app, url
const sockets = []

before(async () => {
  app = createApp({ log: quietLog })
  await new Promise(r => app.server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${app.server.address().port}`
})

after(async () => {
  for (const s of sockets) s.disconnect()
  app.io.close()
})

function client(opts = {}) {
  const s = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false, ...opts })
  sockets.push(s)
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s))
    s.once('connect_error', reject)
  })
}

const next = (s, event, ms = 1000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms)
  s.once(event, d => { clearTimeout(t); resolve(d) })
})
// Resolves true if the event does NOT arrive within ms.
const silent = (s, event, ms = 150) => new Promise(resolve => {
  const h = () => { clearTimeout(t); resolve(false) }
  const t = setTimeout(() => { s.off(event, h); resolve(true) }, ms)
  s.once(event, h)
})
const create = async s => { const p = next(s, 'room-created'); s.emit('create-room', {}); return (await p).roomId }
const join = async (s, roomId) => {
  const p = Promise.race([next(s, 'room-joined').then(() => 'joined'), next(s, 'room-error').then(e => e.message)])
  s.emit('join-room', { roomId })
  return p
}
const gone = s => new Promise(r => { s.once('disconnect', r); s.disconnect() })
const settle = (ms = 40) => new Promise(r => setTimeout(r, ms))

test('room codes are 6 unambiguous characters from a crypto source', async () => {
  const s = await client()
  const seen = new Set()
  for (let i = 0; i < 20; i++) {
    const id = await create(s)
    assert.match(id, /^[A-HJ-NP-Z2-9]{6}$/)
    seen.add(id)
  }
  assert.equal(seen.size, 20)
  await gone(s)
})

test('two people can pair up; a third is turned away', async () => {
  const [a, b, c] = await Promise.all([client(), client(), client()])
  const id = await create(a)
  const joined = next(a, 'peer-joined')
  assert.equal(await join(b, id), 'joined')
  await joined
  assert.equal(await join(c, id), 'This room code has already been used. Ask for a new one.')
  await Promise.all([a, b, c].map(gone))
})

test('lowercase codes work', async () => {
  const [a, b] = await Promise.all([client(), client()])
  const id = await create(a)
  assert.equal(await join(b, id.toLowerCase()), 'joined')
  await Promise.all([a, b].map(gone))
})

test('regression: switching rooms then refreshing leaves no ghost behind', async () => {
  const [a, f] = await Promise.all([client(), client()])
  const x = await create(a)
  await join(f, x)
  await create(f)                // friend makes another room without refreshing
  await gone(f)                  // then refreshes
  await settle()
  for (const room of app.rooms.values()) assert.ok(!room.peers.includes(f.id), 'dead socket still listed')
  assert.deepEqual(app.rooms.get(x).peers, [a.id])
  await gone(a)
})

test('retrying a join from the same tab works, and the creator gets a fresh handshake', async () => {
  const [a, b] = await Promise.all([client(), client()])
  const id = await create(a)
  await join(b, id)
  const left = next(a, 'peer-left'), rejoined = next(a, 'peer-joined')
  assert.equal(await join(b, id), 'joined')
  await left; await rejoined
  assert.equal(app.rooms.get(id).peers.length, 2)
  await Promise.all([a, b].map(gone))
})

test('used codes are single-use: after someone leaves, a newcomer cannot take their place', async () => {
  const [a, b] = await Promise.all([client(), client()])
  const id = await create(a)
  await join(b, id)
  await gone(b)
  await settle()
  const c = await client()
  assert.match(await join(c, id), /already been used/)
  await Promise.all([a, c].map(gone))
})

test('handshake messages only reach the room, and only from its members', async () => {
  const [a, b, outsider] = await Promise.all([client(), client(), client()])
  const id = await create(a)
  await join(b, id)
  // Outsider who knows the code tries to inject a forged answer.
  const noAnswer = silent(a, 'answer')
  outsider.emit('answer', { roomId: id, answer: { type: 'answer', sdp: 'forged' } })
  assert.ok(await noAnswer, 'forged answer was relayed')
  // Real member's offer gets through.
  const offer = next(b, 'offer')
  a.emit('offer', { roomId: id, offer: { type: 'offer', sdp: 'real' } })
  assert.equal((await offer).offer.sdp, 'real')
  // A member can't relay into a different room either.
  const [c, d] = await Promise.all([client(), client()])
  const other = await create(c)
  await join(d, other)
  const noCross = silent(c, 'ice-candidate')
  a.emit('ice-candidate', { roomId: other, candidate: {} })
  assert.ok(await noCross)
  await Promise.all([a, b, outsider, c, d].map(gone))
})

test('websocket connections from another website are refused', async () => {
  await assert.rejects(client({ extraHeaders: { origin: 'https://evil.example' } }))
  const host = new URL(url).host
  const ok = await client({ extraHeaders: { origin: `http://${host}` } })
  assert.ok(ok.connected)
  await gone(ok)
})

test('guessing codes: a socket is cut off after 5 wrong codes', async () => {
  const s = await client()
  for (let i = 0; i < 4; i++) assert.equal(await join(s, 'ZZZZZZ'), 'Room not found')
  const dropped = next(s, 'disconnect')
  assert.match(await join(s, 'ZZZZZZ'), /Too many wrong codes/)
  await dropped
})

test('guessing codes across many sockets pauses all joins', async () => {
  const [a, b] = await Promise.all([client(), client()])
  const id = await create(a)
  // 50 wrong codes from 10 sockets (each cut off at 5). The previous test
  // already added 5 to the global count.
  for (let i = 0; i < 10; i++) {
    const s = await client()
    for (let j = 0; j < 5; j++) await join(s, 'ZZZZZZ')
  }
  assert.match(await join(b, id), /Try again in a minute/)
  await Promise.all([a, b].map(gone))
})

test('randomized: room bookkeeping stays consistent', async () => {
  // Start from a fresh server so the rate limits from earlier tests don't apply.
  const fresh = createApp({ log: quietLog })
  await new Promise(r => fresh.server.listen(0, '127.0.0.1', r))
  const freshUrl = `http://127.0.0.1:${fresh.server.address().port}`
  const mk = () => new Promise(resolve => {
    const s = connect(freshUrl, { transports: ['websocket'], forceNew: true, reconnection: false })
    s.once('connect', () => resolve(s))
  })
  let seed = 42
  const rand = n => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n }

  const tabs = await Promise.all(Array.from({ length: 6 }, mk))
  try {
  for (let step = 0; step < 300; step++) {
    const i = rand(tabs.length), s = tabs[i]
    const roomIds = [...fresh.rooms.keys()]
    switch (rand(4)) {
      case 0: s.emit('create-room', {}); break
      case 1: if (roomIds.length) s.emit('join-room', { roomId: roomIds[rand(roomIds.length)] }); break
      case 2: s.emit('join-room', { roomId: roomIds.length ? roomIds[rand(roomIds.length)] : 'NOPE22' }); break
      case 3: s.disconnect(); tabs[i] = await mk(); break   // tab refresh
    }
    await settle(5)

    const live = fresh.io.sockets.sockets
    const where = new Map()
    for (const [id, room] of fresh.rooms) {
      assert.ok(room.peers.length >= 1 && room.peers.length <= 2, `room ${id} has ${room.peers.length} peers`)
      for (const p of room.peers) {
        assert.ok(live.has(p), `step ${step}: room ${id} lists a disconnected socket`)
        assert.ok(!where.has(p), `step ${step}: socket in two rooms (${where.get(p)}, ${id})`)
        where.set(p, id)
      }
    }
    assert.ok(fresh.rooms.size <= 10)
  }
  } finally {
    // Close everything even when an assertion fails, so a failure can't hang the run.
    for (const s of tabs) s.disconnect()
    fresh.io.close()
  }
})
