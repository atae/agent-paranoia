// Set at startup by WebRTC.configure() from the server's /config.json, which
// comes from the STUN_URLS env var. No third-party default: without STUN only
// peers on the same network can connect.
let ICE_CONFIG = { iceServers: [] }

let _pc = null
let _chatChannel = null
let _fileChannel = null
let _mediaChannel = null   // pasted images/video, separate so neither chat nor big files block it
let _signaling = null
let _roomId = null
let _onChatMessage = null
let _onFileChunk = null
let _onMediaChunk = null
let _onConnectionChange = null

// Stored resolve per channel for a send that's waiting on backpressure.
// onclose/onerror unblocks it so a send loop doesn't hang forever.
const _pendingResolves = new Map()
let _iceTimeout = null

// Null out all event handlers and close the current PC without firing any
// callbacks into the application. Called before creating a new connection and
// when the caller explicitly closes one.
function _teardown() {
  clearTimeout(_iceTimeout)
  _iceTimeout = null
  if (_chatChannel) {
    _chatChannel.onopen = null
    _chatChannel.onclose = null
    _chatChannel.onerror = null
    _chatChannel.onmessage = null
  }
  for (const ch of [_fileChannel, _mediaChannel]) {
    if (!ch) continue
    ch.onopen = null
    ch.onclose = null
    ch.onerror = null
    ch.onmessage = null
    ch.onbufferedamountlow = null
  }
  if (_pc) {
    _pc.onicecandidate = null
    _pc.oniceconnectionstatechange = null
    _pc.close()
  }
  _pc = null
  _chatChannel = null
  _fileChannel = null
  _mediaChannel = null
  unblockAll()
}

function attachChat(channel) {
  _chatChannel = channel
  channel.onopen = () => {
    console.log('[chat] opened — readyState:', channel.readyState, 'id:', channel.id)
    _onConnectionChange('connected')
  }
  channel.onclose = () => {
    console.log('[chat] closed')
    _onConnectionChange('disconnected')
  }
  channel.onerror = (e) => console.error('[chat] error:', e)
  channel.onmessage = ({ data }) => {
    console.log('[chat] message received, type:', typeof data, 'length:', data?.length)
    try {
      _onChatMessage(JSON.parse(data))
    } catch (e) {
      console.error('[chat] parse/handler error:', e, 'raw data:', data)
    }
  }
}

function attachBinary(channel, label, onData) {
  channel.binaryType = 'arraybuffer'
  channel.onopen  = () => console.log(`[${label}] opened — readyState:`, channel.readyState, 'id:', channel.id)
  channel.onclose = () => {
    console.log(`[${label}] closed`)
    unblock(channel)
  }
  channel.onerror = (e) => {
    console.error(`[${label}] error:`, e)
    unblock(channel)
  }
  channel.onmessage = ({ data }) => onData(data)
  return channel
}

function unblock(channel) {
  const r = _pendingResolves.get(channel)
  _pendingResolves.delete(channel)
  r?.()
}

function unblockAll() {
  for (const r of _pendingResolves.values()) r()
  _pendingResolves.clear()
}

// Returns a Promise so send loops can await each chunk and respect backpressure.
// If the channel closes while waiting for buffer to drain, the promise resolves
// immediately (via unblock) so the loop exits rather than hanging.
// MAX_BUFFER is 8 MB — well below Chrome's hard 16 MB limit — so a 64 KB chunk
// can never tip the buffer over the browser's threshold between our check and send().
function sendWithBackpressure(channel, chunk, label) {
  return new Promise(resolve => {
    if (!channel || channel.readyState !== 'open') { resolve(); return }

    const MAX_BUFFER = 8 * 1024 * 1024
    if (channel.bufferedAmount > MAX_BUFFER) {
      channel.bufferedAmountLowThreshold = MAX_BUFFER / 2
      _pendingResolves.set(channel, resolve)
      channel.onbufferedamountlow = () => {
        channel.onbufferedamountlow = null
        const r = _pendingResolves.get(channel)
        _pendingResolves.delete(channel)
        try {
          if (channel.readyState === 'open') channel.send(chunk)
        } catch (e) {
          console.error(`[${label}] send error after drain:`, e)
        }
        r?.()
      }
    } else {
      try {
        channel.send(chunk)
      } catch (e) {
        console.error(`[${label}] send error:`, e)
      }
      resolve()
    }
  })
}

export const WebRTC = {
  configure(config) {
    if (Array.isArray(config?.iceServers)) ICE_CONFIG = { iceServers: config.iceServers }
    console.log('[webrtc] ICE servers:', JSON.stringify(ICE_CONFIG.iceServers))
  },

  init(signaling, roomId, onChatMessage, onFileChunk, onConnectionChange, onMediaChunk) {
    // Tear down any previous connection first so orphaned channels can't fire
    // stale onclose events into the new session.
    _teardown()

    _signaling = signaling
    _roomId = roomId
    _onChatMessage = onChatMessage
    _onFileChunk = onFileChunk
    _onConnectionChange = onConnectionChange
    _onMediaChunk = onMediaChunk

    _pc = new RTCPeerConnection(ICE_CONFIG)

    _pc.onicecandidate = ({ candidate }) => {
      if (candidate) _signaling.sendIceCandidate(_roomId, candidate)
    }

    _iceTimeout = setTimeout(() => {
      if (_pc && _pc.iceConnectionState !== 'connected') {
        _onConnectionChange('failed')
        _teardown()
      }
    }, 30_000)

    _pc.oniceconnectionstatechange = () => {
      const s = _pc.iceConnectionState
      console.log('[ice] state:', s)
      if (s === 'connected') { clearTimeout(_iceTimeout); _iceTimeout = null }
      // 'disconnected' is transient and self-recovers; 'failed'/'closed' are terminal.
      if (s === 'failed' || s === 'closed') {
        _teardown()
        _onConnectionChange(s)
      }
    }

    // Out-of-band negotiated channels: both peers create matching IDs independently.
    // This avoids the asymmetric ondatachannel timing problem on real networks.
    attachChat(_pc.createDataChannel('chat', { ordered: true, negotiated: true, id: 0 }))
    _fileChannel = attachBinary(_pc.createDataChannel('file', { ordered: true, negotiated: true, id: 1 }), 'file', d => _onFileChunk(d))
    _mediaChannel = attachBinary(_pc.createDataChannel('media', { ordered: true, negotiated: true, id: 2 }), 'media', d => _onMediaChunk?.(d))

    console.log('[webrtc] init complete — chat readyState:', _chatChannel.readyState, '| file readyState:', _fileChannel.readyState)
  },

  async createOffer() {
    const offer = await _pc.createOffer()
    await _pc.setLocalDescription(offer)
    _signaling.sendOffer(_roomId, offer)
  },

  async handleOffer(offer) {
    await _pc.setRemoteDescription(offer)
    const answer = await _pc.createAnswer()
    await _pc.setLocalDescription(answer)
    _signaling.sendAnswer(_roomId, answer)
  },

  async handleAnswer(answer) {
    await _pc.setRemoteDescription(answer)
  },

  async handleIceCandidate(candidate) {
    if (_pc && candidate) await _pc.addIceCandidate(candidate)
  },

  sendChat(message) {
    const state = _chatChannel?.readyState
    console.log('[chat] sendChat — readyState:', state)
    if (state === 'open') {
      try {
        _chatChannel.send(JSON.stringify(message))
      } catch (e) {
        console.error('[chat] send error:', e)
      }
    }
  },

  sendFileChunk(chunk) {
    return sendWithBackpressure(_fileChannel, chunk, 'file')
  },

  sendMediaChunk(chunk) {
    return sendWithBackpressure(_mediaChannel, chunk, 'media')
  },

  // Bytes queued on the file channel but not yet handed to the network.
  fileBufferedAmount() {
    return _fileChannel?.readyState === 'open' ? _fileChannel.bufferedAmount : 0
  },

  mediaBufferedAmount() {
    return _mediaChannel?.readyState === 'open' ? _mediaChannel.bufferedAmount : 0
  },

  close() {
    _teardown()
  }
}
