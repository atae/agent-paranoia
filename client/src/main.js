import { Signaling } from '/src/signaling.js'
import { WebRTC }    from '/src/webrtc.js'
import { Chat }      from '/src/chat.js'
import { Transfer }  from '/src/transfer.js'
import { UI }        from '/src/ui.js'
import { Downloads } from '/src/downloads.js'

// ── State ─────────────────────────────────────────────────────────────────
let roomId = null
let peerDisplayName = null
let transferInProgress = false
const fileQueue = []
let activeSend = false

// ── Helpers ───────────────────────────────────────────────────────────────
function download(content, filename, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function exportDate() {
  return new Date().toISOString().slice(0, 10)
}

// ── File queue ────────────────────────────────────────────────────────────
async function processQueue() {
  if (activeSend || fileQueue.length === 0) return
  activeSend = true
  const file = fileQueue.shift()

  UI.fileStarted(file.name)

  try {
    const result = await Transfer.sendFile(
      file,
      chunk => WebRTC.sendFileChunk(chunk),
      progress => UI.updateSendProgress(progress),
      () => WebRTC.fileBufferedAmount(),
    )
    if (result === 'declined') UI.fileDeclined(file.name)
  } catch (err) {
    UI.fileFailed(file.name, err.message)
  } finally {
    activeSend = false
    transferInProgress = fileQueue.length > 0
    processQueue()
  }
}

function enqueueFile(file) {
  fileQueue.push(file)
  transferInProgress = true
  if (activeSend || fileQueue.length > 1) UI.fileQueued(file.name)
  processQueue()
}

// ── WebRTC callbacks ──────────────────────────────────────────────────────
function onChatMessage(msg) {
  const stored = Chat.addMessage('them', msg.text, {
    displayName: msg.displayName,
    timestamp: msg.timestamp,
  })
  UI.addMessage(stored)
}

const sendControl = msg => WebRTC.sendFileChunk(msg)

// Peer offered a file: ask, then open a file in the download folder (if set)
// or fall back to collecting it in memory.
async function onFileOffer(meta) {
  const accepted = await UI.showOffer({ ...meta, from: peerDisplayName })
  if (!accepted) {
    Transfer.decline(meta, sendControl)
    return
  }
  let target = {}
  if (Downloads.folderName()) {
    try {
      target = await Downloads.openWritable(meta.name)
    } catch (err) {
      console.warn('[downloads] falling back to memory:', err)
    }
  }
  Transfer.accept(meta, target, sendControl)
}

function onFileChunk(data) {
  Transfer.handleIncoming(data, {
    onOffer:    meta     => onFileOffer(meta),
    onProgress: progress => UI.updateRecvProgress(progress),
    onComplete: result   => UI.recvComplete(result),
    onError:    (name, message) => UI.recvFailed(name, message),
  })
}

// Connection gone: unblock a waiting sender, drop half-received files,
// and close any open accept dialog.
function endTransfers() {
  fileQueue.length = 0
  transferInProgress = false
  Transfer.reset()
  UI.closeOffer()
}

function onConnectionChange(state) {
  if (state === 'connected') {
    UI.showSession()
    UI.setPeerStatus('connected', peerDisplayName)
  } else {
    // Without this, a join that never connects looks like nothing happened.
    if (state === 'failed') alert("Couldn't connect to the other person. Check that you're both on Tailscale and try joining again.")
    UI.setPeerStatus('disconnected', null)
    endTransfers()
  }
}

// ── UI callbacks ──────────────────────────────────────────────────────────
UI.init({
  onCancelLobby() {
    roomId = null
    peerDisplayName = null
    WebRTC.close()
    Signaling.reset()
    UI.showHome()
  },

  onCreateRoom() {
    Signaling.createRoom(UI.getLocalName() || null)
  },

  onJoinRoom(id) {
    Signaling.joinRoom(id, UI.getLocalName() || null)
  },

  onSendMessage(text) {
    const msg = Chat.addMessage('me', text, { displayName: UI.getLocalName() || null })
    WebRTC.sendChat(msg)
    UI.addMessage(msg)
  },

  onSendFile(file) {
    enqueueFile(file)
  },

  async onChooseFolder() {
    try {
      UI.setDownloadFolder(await Downloads.chooseFolder(), Downloads.supported)
    } catch (err) {
      if (err.name !== 'AbortError') alert(`Couldn't use that folder: ${err.message}`)
    }
  },

  async onClearFolder() {
    await Downloads.clearFolder()
    UI.setDownloadFolder(null, Downloads.supported)
  },

  onExport(format) {
    if (format === 'txt') {
      const txt = Chat.exportTxt()
      if (txt) download(txt, `chat-${exportDate()}.txt`, 'text/plain')
    } else if (format === 'json') {
      if (Chat.getMessages().length === 0) return
      download(Chat.exportJson(), `chat-${exportDate()}.json`, 'application/json')
    } else if (format === 'html') {
      if (Chat.getMessages().length === 0) return
      download(Chat.exportHtml(), `chat-${exportDate()}.html`, 'text/html')
    }
  },
})

// Warn before unload during active transfer
window.addEventListener('beforeunload', e => {
  if (transferInProgress || Transfer.isReceiving()) { e.preventDefault(); e.returnValue = '' }
})

// ── Signaling ─────────────────────────────────────────────────────────────
// Load STUN settings before connecting so no peer connection uses the defaults.
try {
  WebRTC.configure(await (await fetch('/config.json', { cache: 'no-store' })).json())
} catch (e) {
  console.warn('[config] could not load /config.json; no STUN server, so only same-network peers can connect', e)
}
await Downloads.init()
UI.setDownloadFolder(Downloads.folderName(), Downloads.supported)
Signaling.connect(window.location.origin)

Signaling.on('room-created', ({ roomId: id }) => {
  roomId = id
  UI.showLobby(id)
})

Signaling.on('peer-joined', async ({ displayName }) => {
  peerDisplayName = displayName || null
  Chat.clear()
  UI.resetSession()
  WebRTC.init(Signaling, roomId, onChatMessage, onFileChunk, onConnectionChange)
  await WebRTC.createOffer()
})

Signaling.on('room-joined', ({ roomId: id, creatorDisplayName }) => {
  roomId = id
  peerDisplayName = creatorDisplayName || null
  Chat.clear()
  UI.resetSession()
  WebRTC.init(Signaling, roomId, onChatMessage, onFileChunk, onConnectionChange)
})

Signaling.on('room-error', ({ message }) => {
  alert(`Room error: ${message}`)
})

Signaling.on('offer', async ({ offer }) => {
  await WebRTC.handleOffer(offer)
})

Signaling.on('answer', async ({ answer }) => {
  await WebRTC.handleAnswer(answer)
})

Signaling.on('ice-candidate', async ({ candidate }) => {
  await WebRTC.handleIceCandidate(candidate)
})

Signaling.on('peer-left', () => {
  UI.setPeerStatus('disconnected', null)
  endTransfers()
})
