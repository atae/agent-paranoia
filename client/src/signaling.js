import { io } from '/socket.io/socket.io.esm.min.js'

let socket = null

export const Signaling = {
  connect(serverUrl) {
    socket = io(serverUrl)
  },

  createRoom() {
    socket.emit('create-room')
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
    socket.on(event, handler)
  }
}
