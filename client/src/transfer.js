const CHUNK_SIZE = 64 * 1024

// Protocol (JSON strings on the file channel, binary chunks in between):
//   sender   → file-meta   { id, name, size, totalChunks }
//   receiver → file-accept { id }  or  file-reject { id }
//   sender   → <chunks…>  then  file-end { id }
// Nothing is sent until the receiver accepts, so a peer can't push data
// (or a huge file) at you without asking.

// Sender side: the offer waiting for an answer.
let _pendingOffer = null   // { id, resolve }
let _nextId = 1

// Receiver side: the accepted transfer currently arriving.
// Written either to a disk stream (writable) or collected in memory (chunks).
let _incoming = null

// Rolling transfer rate over the last couple of seconds. Measuring between
// single chunks is useless here: chunks are queued and delivered in bursts a
// millisecond apart, which swings the number between KB/s and hundreds of MB/s.
const SPEED_WINDOW_MS = 2000
const SPEED_MIN_SPAN_MS = 300

function speedMeter() {
  const samples = []
  return function sample(bytes) {
    const t = performance.now()
    samples.push({ t, bytes })
    while (samples.length > 2 && t - samples[1].t > SPEED_WINDOW_MS) samples.shift()
    const first = samples[0]
    const span = t - first.t
    // Not enough history yet: report no speed rather than a wild guess.
    return span >= SPEED_MIN_SPAN_MS ? (bytes - first.bytes) / (span / 1000) : 0
  }
}

function newId() {
  return `${Date.now().toString(36)}-${_nextId++}`
}

function isValidMeta(msg) {
  return typeof msg.id === 'string' &&
    typeof msg.name === 'string' && msg.name.length > 0 &&
    Number.isSafeInteger(msg.size) && msg.size >= 0 &&
    Number.isSafeInteger(msg.totalChunks) && msg.totalChunks >= 0
}

function abortIncoming() {
  const inc = _incoming
  _incoming = null
  if (!inc) return
  inc.failed = true
  // Discards the partial file; it never appears in the folder.
  inc.writable?.abort().catch(() => {})
}

export const Transfer = {
  // Resolves to 'sent' or 'declined'. Throws if the peer disconnects first.
  // getBuffered() returns bytes queued in the channel but not yet sent, so
  // progress and speed reflect what actually left, not what was queued.
  async sendFile(file, send, onProgress, getBuffered = () => 0) {
    const id = newId()
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

    const answer = new Promise(resolve => { _pendingOffer = { id, resolve } })
    await send(JSON.stringify({ type: 'file-meta', id, name: file.name, size: file.size, totalChunks }))
    const result = await answer
    if (result === 'declined') return 'declined'
    if (result !== 'accepted') throw new Error('Peer disconnected')

    const meter = speedMeter()
    const started = performance.now()
    let queued = 0

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const chunk = await file.slice(start, start + CHUNK_SIZE).arrayBuffer()
      await send(chunk)
      queued += chunk.byteLength
      if (i === totalChunks - 1) break

      const sent = Math.max(0, queued - getBuffered())
      onProgress({
        fileName: file.name,
        // Never report 100 before the end — the UI treats 100 as "done".
        percent: Math.min(99, Math.round(sent / file.size * 100)),
        bytesTransferred: sent,
        totalBytes: file.size,
        speed: meter(sent)
      })
    }

    await send(JSON.stringify({ type: 'file-end', id }))
    // Wait for the queue to actually drain before calling it sent.
    while (getBuffered() > 0) {
      const sent = Math.max(0, queued - getBuffered())
      onProgress({
        fileName: file.name,
        percent: Math.min(99, Math.round(sent / file.size * 100)),
        bytesTransferred: sent,
        totalBytes: file.size,
        speed: meter(sent)
      })
      await new Promise(r => setTimeout(r, 100))
    }
    const seconds = (performance.now() - started) / 1000
    onProgress({
      fileName: file.name,
      percent: 100,
      bytesTransferred: file.size,
      totalBytes: file.size,
      // Final figure is the true average for the whole file.
      speed: seconds > 0 ? file.size / seconds : 0
    })
    return 'sent'
  },

  // Receiver accepted an offer. writable is a FileSystemWritableFileStream when
  // saving to a folder, or null to collect the file in memory.
  accept(meta, { writable = null, savedAs = null } = {}, send) {
    _incoming = {
      id: meta.id,
      name: meta.name,
      size: meta.size,
      writable,
      savedAs,
      chunks: writable ? null : [],
      writeChain: Promise.resolve(),
      failed: false,
      bytesReceived: 0,
      started: performance.now(),
      meter: speedMeter()
    }
    send(JSON.stringify({ type: 'file-accept', id: meta.id }))
  },

  decline(meta, send) {
    send(JSON.stringify({ type: 'file-reject', id: meta.id }))
  },

  isReceiving() {
    return _incoming !== null
  },

  // Called when the peer connection ends: unblocks a sender waiting for an
  // answer and throws away any half-received file.
  reset() {
    _pendingOffer?.resolve('cancelled')
    _pendingOffer = null
    abortIncoming()
  },

  // handlers: { onOffer(meta), onProgress(p), onComplete(result), onError(fileName, message) }
  handleIncoming(data, handlers) {
    if (typeof data === 'string') {
      let msg
      try { msg = JSON.parse(data) } catch { return }

      if (msg.type === 'file-accept' || msg.type === 'file-reject') {
        if (_pendingOffer && _pendingOffer.id === msg.id) {
          _pendingOffer.resolve(msg.type === 'file-accept' ? 'accepted' : 'declined')
          _pendingOffer = null
        }
        return
      }

      if (msg.type === 'file-meta') {
        // One transfer at a time; ignore malformed or overlapping offers.
        if (_incoming || !isValidMeta(msg)) return
        handlers.onOffer({ id: msg.id, name: msg.name, size: msg.size })
        return
      }

      if (msg.type === 'file-end') {
        const inc = _incoming
        if (!inc || inc.id !== msg.id || inc.failed) return
        _incoming = null
        const seconds = (performance.now() - inc.started) / 1000
        const speed = seconds > 0 ? inc.size / seconds : 0
        if (inc.bytesReceived !== inc.size) {
          inc.writable?.abort().catch(() => {})
          handlers.onError(inc.name, `incomplete (${inc.bytesReceived} of ${inc.size} bytes)`)
          return
        }
        if (inc.writable) {
          inc.writeChain
            .then(() => inc.writable.close())
            .then(() => { if (!inc.failed) handlers.onComplete({ fileName: inc.name, savedAs: inc.savedAs, speed }) })
            .catch(e => {
              inc.writable.abort().catch(() => {})
              handlers.onError(inc.name, e.message)
            })
        } else {
          handlers.onComplete({ fileName: inc.name, blob: new Blob(inc.chunks), speed })
        }
      }
      return
    }

    // Raw ArrayBuffer chunk — only for an offer we accepted.
    const inc = _incoming
    if (!inc || inc.failed) return

    if (inc.bytesReceived + data.byteLength > inc.size) {
      // More data than announced: refuse it rather than grow without limit.
      abortIncoming()
      handlers.onError(inc.name, 'peer sent more data than announced')
      return
    }

    inc.bytesReceived += data.byteLength
    if (inc.writable) {
      inc.writeChain = inc.writeChain.then(() => inc.failed ? undefined : inc.writable.write(data))
      inc.writeChain.catch(e => {
        if (inc.failed) return
        if (_incoming === inc) _incoming = null
        inc.failed = true
        inc.writable.abort().catch(() => {})
        handlers.onError(inc.name, `could not write to disk: ${e.message}`)
      })
    } else {
      inc.chunks.push(data)
    }

    handlers.onProgress({
      fileName: inc.name,
      // 100 is reserved for completion (after file-end).
      percent: Math.min(99, Math.round(inc.bytesReceived / inc.size * 100)),
      bytesTransferred: inc.bytesReceived,
      totalBytes: inc.size,
      speed: inc.meter(inc.bytesReceived)
    })
  }
}
