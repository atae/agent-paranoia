// Pasted images/video protocol (client/src/media.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'url'

const M = fileURLToPath(new URL('../../client/src/media.js', import.meta.url))
let n = 0
const fresh = async () => (await import(`file://${M}?${n++}`))

const fakeFile = (size, type, name = 'shot.png') => {
  const bytes = new Uint8Array(size).map((_, i) => i % 239)
  return { name, size, type, bytes, slice: (s, e) => new Blob([bytes.slice(s, e)]) }
}

function receiver(Media) {
  const log = { started: [], done: [], errors: [], progress: [] }
  const handlers = {
    onStart: m => log.started.push(m),
    onProgress: (id, p) => log.progress.push(p),
    onComplete: m => log.done.push(m),
    onError: (id, msg) => log.errors.push(msg),
  }
  return { log, feed: d => Media.handleIncoming(d, handlers) }
}

test('a pasted image arrives intact with its type', async () => {
  const { Media } = await fresh()
  const { Media: Peer } = await fresh()
  const r = receiver(Peer)
  const f = fakeFile(200_000, 'image/png')
  const progress = []
  await Media.send(Media.newId(), f, async d => r.feed(d), p => progress.push(p))
  assert.equal(r.log.done.length, 1)
  const blob = r.log.done[0].blob
  assert.equal(blob.type, 'image/png')
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), f.bytes)
  assert.equal(progress.at(-1), 100)
  assert.ok(r.log.progress.every(p => p < 100))
})

test('only common image/video formats go inline, up to 100 MB', async () => {
  const { Media, MEDIA_MAX_BYTES } = await fresh()
  assert.ok(Media.isInline({ type: 'image/gif', size: 10 }))
  assert.ok(Media.isInline({ type: 'video/mp4', size: MEDIA_MAX_BYTES }))
  assert.ok(!Media.isInline({ type: 'video/mp4', size: MEDIA_MAX_BYTES + 1 }))
  assert.ok(!Media.isInline({ type: 'image/svg+xml', size: 10 }), 'SVG can carry scripts')
  assert.ok(!Media.isInline({ type: 'text/html', size: 10 }))
  assert.ok(!Media.isInline({ type: '', size: 10 }))
})

test('the receiver refuses disallowed types and oversized announcements', async () => {
  const { Media } = await fresh()
  const r = receiver(Media)
  r.feed(JSON.stringify({ type: 'media-start', id: 'a', name: 'x.svg', mime: 'image/svg+xml', size: 10 }))
  r.feed(JSON.stringify({ type: 'media-start', id: 'b', name: 'x.mp4', mime: 'video/mp4', size: 200 * 1024 * 1024 }))
  r.feed(new ArrayBuffer(10))
  assert.equal(r.log.started.length, 0)
  assert.equal(r.log.progress.length, 0)
})

test('sending more than announced is cut off', async () => {
  const { Media } = await fresh()
  const r = receiver(Media)
  r.feed(JSON.stringify({ type: 'media-start', id: 'c', name: 'a.png', mime: 'image/png', size: 100 }))
  r.feed(new ArrayBuffer(5_000_000))
  assert.match(r.log.errors[0], /more data/)
  r.feed(JSON.stringify({ type: 'media-end', id: 'c' }))
  assert.equal(r.log.done.length, 0)
})

test('a truncated item fails instead of showing half an image', async () => {
  const { Media } = await fresh()
  const r = receiver(Media)
  r.feed(JSON.stringify({ type: 'media-start', id: 'd', name: 'a.png', mime: 'image/png', size: 100 }))
  r.feed(new ArrayBuffer(40))
  r.feed(JSON.stringify({ type: 'media-end', id: 'd' }))
  assert.deepEqual(r.log.errors, ['incomplete'])
  assert.equal(r.log.done.length, 0)
})
