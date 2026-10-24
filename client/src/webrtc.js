// Replaced at startup by WebRTC.configure() with the server's /config.json,
// which comes from the STUN_URLS env var on the server.
let ICE_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
}

let _pc = null
let _chatChannel = null
let _fileChannel = null
let _signaling = null
let _roomId = null
let _onChatMessage = null
let _onFileChunk = null
let _onConnectionChange = null

// Stored resolve for a sendFileChunk call that's waiting on backpressure.
// onclose/onerror unblocks it so Transfer.sendFile doesn't hang forever.
let _pendingChunkResolve = null
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
  if (_fileChannel) {
    _fileChannel.onopen = null
    _fileChannel.onclose = null
    _fileChannel.onerror = null
    _fileChannel.onmessage = null
  }
  if (_pc) {
    _pc.onicecandidate = null
    _pc.oniceconnectionstatechange = null
    _pc.close()
  }
  _pc = null
  _chatChannel = null
  _fileChannel = null
  unblockPendingChunk()
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

function attachFile(channel) {
  _fileChannel = channel
  _fileChannel.binaryType = 'arraybuffer'
  channel.onopen  = () => console.log('[file] opened — readyState:', channel.readyState, 'id:', channel.id)
  channel.onclose = () => {
    console.log('[file] closed')
    unblockPendingChunk()
  }
  channel.onerror = (e) => {
    console.error('[file] error:', e)
    unblockPendingChunk()
  }
  channel.onmessage = ({ data }) => _onFileChunk(data)
}

function unblockPendingChunk() {
  const r = _pendingChunkResolve
  _pendingChunkResolve = null
  r?.()
}

export const WebRTC = {
  configure(config) {
    if (config?.iceServers?.length) ICE_CONFIG = { iceServers: config.iceServers }
    console.log('[webrtc] ICE servers:', JSON.stringify(ICE_CONFIG.iceServers))
  },

  init(signaling, roomId, onChatMessage, onFileChunk, onConnectionChange) {
    // Tear down any previous connection first so orphaned channels can't fire
    // stale onclose events into the new session.
    _teardown()

    _signaling = signaling
    _roomId = roomId
    _onChatMessage = onChatMessage
    _onFileChunk = onFileChunk
    _onConnectionChange = onConnectionChange

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
    attachFile(_pc.createDataChannel('file', { ordered: true, negotiated: true, id: 1 }))

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

  // Returns a Promise so Transfer.sendFile can await each chunk and respect backpressure.
  // If the channel closes while waiting for buffer to drain, the promise resolves
  // immediately (via unblockPendingChunk) so the send loop exits rather than hanging.
  // MAX_BUFFER is 8 MB — well below Chrome's hard 16 MB limit — so a 64 KB chunk
  // can never tip the buffer over the browser's threshold between our check and send().
  sendFileChunk(chunk) {
    return new Promise(resolve => {
      if (!_fileChannel || _fileChannel.readyState !== 'open') { resolve(); return }

      const MAX_BUFFER = 8 * 1024 * 1024
      if (_fileChannel.bufferedAmount > MAX_BUFFER) {
        _fileChannel.bufferedAmountLowThreshold = MAX_BUFFER / 2
        _pendingChunkResolve = resolve
        _fileChannel.onbufferedamountlow = () => {
          _fileChannel.onbufferedamountlow = null
          const r = _pendingChunkResolve
          _pendingChunkResolve = null
          try {
            if (_fileChannel.readyState === 'open') _fileChannel.send(chunk)
          } catch (e) {
            console.error('[file] send error after drain:', e)
          }
          r?.()
        }
      } else {
        try {
          _fileChannel.send(chunk)
        } catch (e) {
          console.error('[file] send error:', e)
        }
        resolve()
      }
    })
  },

  close() {
    _teardown()
  }
}
