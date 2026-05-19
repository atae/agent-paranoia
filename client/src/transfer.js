const CHUNK_SIZE = 64 * 1024

// State for the currently incoming transfer (one at a time — ordered DataChannel)
let _incoming = null

export const Transfer = {
  async sendFile(file, sendChunkFn, onProgress) {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
    const startTime = Date.now()

    await sendChunkFn(JSON.stringify({
      type: 'file-meta',
      name: file.name,
      size: file.size,
      totalChunks
    }))

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const chunk = await file.slice(start, start + CHUNK_SIZE).arrayBuffer()
      await sendChunkFn(chunk)

      const bytesTransferred = Math.min((i + 1) * CHUNK_SIZE, file.size)
      const isLast = i === totalChunks - 1
      const elapsed = (Date.now() - startTime) / 1000
      const speed = elapsed > 0 ? bytesTransferred / elapsed : 0

      onProgress({
        fileName: file.name,
        // Only report exactly 100 on the final chunk — Math.round alone can hit
        // 100 for the last few chunks of a file that doesn't divide evenly,
        // which causes the UI to create multiple completion items.
        percent: isLast ? 100 : Math.min(99, Math.round(bytesTransferred / file.size * 100)),
        bytesTransferred,
        totalBytes: file.size,
        speed
      })
    }

    await sendChunkFn(JSON.stringify({ type: 'file-end', name: file.name }))
  },

  handleIncoming(data, onProgress, onComplete) {
    if (typeof data === 'string') {
      const msg = JSON.parse(data)

      if (msg.type === 'file-meta') {
        _incoming = {
          name: msg.name,
          size: msg.size,
          totalChunks: msg.totalChunks,
          chunks: [],
          bytesReceived: 0,
          startTime: Date.now()
        }
      } else if (msg.type === 'file-end' && _incoming) {
        const blob = new Blob(_incoming.chunks)
        onComplete({ fileName: _incoming.name, blob })
        _incoming = null
      }
    } else {
      // Raw ArrayBuffer chunk
      if (!_incoming) return
      _incoming.chunks.push(data)
      _incoming.bytesReceived += data.byteLength

      const elapsed = (Date.now() - _incoming.startTime) / 1000
      const speed = elapsed > 0 ? _incoming.bytesReceived / elapsed : 0

      onProgress({
        fileName: _incoming.name,
        percent: Math.round(_incoming.bytesReceived / _incoming.size * 100),
        bytesTransferred: _incoming.bytesReceived,
        totalBytes: _incoming.size,
        speed
      })
    }
  }
}
