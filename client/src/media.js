// Images and short videos pasted or dropped into the chat. They travel on
// their own data channel so they show up right away instead of waiting
// behind a big file transfer, and they don't need an Accept click.
//
// Protocol on the media channel:
//   media-start { id, name, mime, size }   then binary chunks   then media-end { id }

export const MEDIA_MAX_BYTES = 100 * 1024 * 1024
const CHUNK_SIZE = 64 * 1024

// Formats that display inline. SVG is deliberately excluded: it can carry
// scripts, and opening a blob: SVG in a new tab would run them on this page's
// origin. Anything else is sent as a normal file with an Accept prompt.
export const MEDIA_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/ogg',
])

let _nextId = 1
let _incoming = null   // { id, name, mime, size, chunks, received }

function isValidStart(msg) {
  return typeof msg.id === 'string' && msg.id.length <= 64 &&
    typeof msg.name === 'string' && msg.name.length <= 500 &&
    MEDIA_TYPES.has(msg.mime) &&
    Number.isSafeInteger(msg.size) && msg.size >= 0 && msg.size <= MEDIA_MAX_BYTES
}

export const Media = {
  // True if this file can go inline in chat; otherwise send it as a file.
  isInline(file) {
    return MEDIA_TYPES.has(file.type) && file.size <= MEDIA_MAX_BYTES
  },

  newId() {
    return `${Date.now().toString(36)}-${_nextId++}`
  },

  // getBuffered() lets progress reflect bytes actually sent, not just queued.
  async send(id, file, send, onProgress, getBuffered = () => 0) {
    await send(JSON.stringify({ type: 'media-start', id, name: file.name, mime: file.type, size: file.size }))
    let queued = 0
    for (let start = 0; start < file.size; start += CHUNK_SIZE) {
      const chunk = await file.slice(start, start + CHUNK_SIZE).arrayBuffer()
      await send(chunk)
      queued += chunk.byteLength
      onProgress(Math.min(99, Math.round(Math.max(0, queued - getBuffered()) / file.size * 100)))
    }
    await send(JSON.stringify({ type: 'media-end', id }))
    onProgress(100)
  },

  reset() {
    _incoming = null
  },

  // handlers: { onStart({ id, name, mime, size }), onProgress(id, percent),
  //             onComplete({ id, name, mime, blob }), onError(id, message) }
  handleIncoming(data, handlers) {
    if (typeof data === 'string') {
      let msg
      try { msg = JSON.parse(data) } catch { return }

      if (msg.type === 'media-start') {
        if (_incoming) {
          handlers.onError(_incoming.id, 'interrupted')
          _incoming = null
        }
        if (!isValidStart(msg)) return
        _incoming = { id: msg.id, name: msg.name, mime: msg.mime, size: msg.size, chunks: [], received: 0 }
        handlers.onStart({ id: msg.id, name: msg.name, mime: msg.mime, size: msg.size })
        return
      }

      if (msg.type === 'media-end') {
        const inc = _incoming
        if (!inc || inc.id !== msg.id) return
        _incoming = null
        if (inc.received !== inc.size) {
          handlers.onError(inc.id, 'incomplete')
          return
        }
        handlers.onComplete({ id: inc.id, name: inc.name, mime: inc.mime, blob: new Blob(inc.chunks, { type: inc.mime }) })
      }
      return
    }

    const inc = _incoming
    if (!inc) return
    if (inc.received + data.byteLength > inc.size) {
      // More than announced: drop it rather than grow past the limit.
      _incoming = null
      handlers.onError(inc.id, 'peer sent more data than announced')
      return
    }
    inc.chunks.push(data)
    inc.received += data.byteLength
    handlers.onProgress(inc.id, Math.min(99, Math.round(inc.received / inc.size * 100)))
  },
}
