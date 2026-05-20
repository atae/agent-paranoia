import { io } from '/socket.io/socket.io.esm.min.js'

let socket = null
let _serverUrl = null
const _handlers = []   // replayed onto fresh socket after reset()

export const Signaling = {
  connect(serverUrl) {
    _serverUrl = serverUrl
    socket = io(serverUrl)
  },

  // Disconnect and get a fresh socket (e.g. user cancels the lobby).
  // Replays all registered handlers so callers don't need to re-register.
  reset() {
    socket.disconnect()
    socket = io(_serverUrl)
    for (const { event, handler } of _handlers) socket.on(event, handler)
  },

  createRoom(displayName = null) {
    socket.emit('create-room', { displayName })
  },

  joinRoom(roomId, displayName = null) {
    socket.emit('join-room', { roomId, displayName })
  },

  sendOffer(roomId, offer) {
    socket.emit('offer', { roomId, offer })
  },

  sendAnswer(roomId, answer) {
    socket.emit('answer', { roomId, answer })
  },

  sendIceCandidate(roomId, candidate) {
    socket.emit('ice-candidate', { roomId, candidate })
  },

  on(event, handler) {
    _handlers.push({ event, handler })
    socket.on(event, handler)
  },
}
