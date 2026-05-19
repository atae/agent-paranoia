import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Server } from 'socket.io'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = path.resolve(__dirname, '..', 'client')
const PORT = 7654

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
}

const server = http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/test.html' : req.url.split('?')[0]
  const resolved = path.resolve(path.join(CLIENT_DIR, urlPath))

  // Prevent path traversal outside client dir
  if (!resolved.startsWith(CLIENT_DIR + path.sep) && resolved !== CLIENT_DIR) {
    res.writeHead(403)
    res.end()
    return
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end()
      return
    }
    const ext = path.extname(resolved)
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' })
    res.end(data)
  })
})

const io = new Server(server)

// rooms.get(roomId) = { peers: [socketId, socketId?] }
const rooms = new Map()

function generateRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

io.on('connection', (socket) => {
  let currentRoomId = null

  socket.on('create-room', () => {
    const roomId = generateRoomId()
    rooms.set(roomId, { peers: [socket.id] })
    currentRoomId = roomId
    socket.join(roomId)
    socket.emit('room-created', { roomId })

    // Stale room cleanup — if second peer never arrives
    setTimeout(() => {
      const room = rooms.get(roomId)
      if (room && room.peers.length < 2) {
        rooms.delete(roomId)
      }
    }, 5 * 60 * 1000)
  })

  socket.on('join-room', ({ roomId, displayName }) => {
    const room = rooms.get(roomId)
    if (!room) {
      socket.emit('room-error', { message: 'Room not found' })
      return
    }
    if (room.peers.length >= 2) {
      socket.emit('room-error', { message: 'Room is full' })
      return
    }
    room.peers.push(socket.id)
    currentRoomId = roomId
    socket.join(roomId)
    socket.emit('room-joined', { roomId })
    // Relay display name so creator can show "Incoming from [name]"
    socket.to(roomId).emit('peer-joined', { displayName: displayName || null })
  })

  socket.on('offer', ({ roomId, offer }) => {
    socket.to(roomId).emit('offer', { offer })
  })

  socket.on('answer', ({ roomId, answer }) => {
    socket.to(roomId).emit('answer', { answer })
  })

  socket.on('ice-candidate', ({ roomId, candidate }) => {
    socket.to(roomId).emit('ice-candidate', { candidate })
  })

  socket.on('disconnect', () => {
    if (!currentRoomId) return
    const room = rooms.get(currentRoomId)
    if (!room) return
    room.peers = room.peers.filter(id => id !== socket.id)
    if (room.peers.length === 0) {
      rooms.delete(currentRoomId)
    } else {
      socket.to(currentRoomId).emit('peer-left')
    }
  })
})

server.listen(PORT, () => {
  console.log(`Agent Paranoia signaling server running at http://localhost:${PORT}`)
})
