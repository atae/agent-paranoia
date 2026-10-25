import http from 'http'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { Server } from 'socket.io'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = path.resolve(__dirname, '..', 'client')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
}

const MAX_ROOMS = 10
const ROOM_TTL_MS = 5 * 60 * 1000
// No 0/O or 1/I, so codes are easy to read out loud. 32^6 ≈ 1 billion codes.
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ROOM_ID_LENGTH = 6
const MAX_NAME_LENGTH = 20

// Brute-force protection for room codes. Behind a proxy every connection
// looks like it comes from 127.0.0.1, so limits are per socket and global
// rather than per IP.
const SOCKET_FAILED_JOINS = 5          // wrong codes per socket per window → disconnected
const GLOBAL_FAILED_JOINS = 50         // wrong codes across everyone per window → joins paused
const FAILED_JOIN_WINDOW_MS = 60 * 1000

function generateRoomId(rooms) {
  for (;;) {
    let id = ''
    for (let i = 0; i < ROOM_ID_LENGTH; i++) id += ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)]
    if (!rooms.has(id)) return id
  }
}

function cleanName(name) {
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, MAX_NAME_LENGTH) : null
}

function recentCount(timestamps, now) {
  while (timestamps.length && now - timestamps[0] > FAILED_JOIN_WINDOW_MS) timestamps.shift()
  return timestamps.length
}

// options: { stunUrls: string[], allowedOrigins: string[], log: console-like }
export function createApp({ stunUrls = [], allowedOrigins = [], log = console } = {}) {
  const clientConfig = JSON.stringify({ iceServers: stunUrls.length ? [{ urls: stunUrls }] : [] })
  const extraOriginHosts = allowedOrigins.map(o => {
    try { return new URL(o).host } catch { return o }
  })

  const server = http.createServer((req, res) => {
    const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0]

    if (urlPath === '/config.json') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(clientConfig)
      return
    }
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

  const io = new Server(server, {
    // Browsers don't apply CORS to WebSockets, so without this any website a
    // user visits could open a socket to this server through their browser.
    // Requests with no Origin (non-browser tools) aren't that threat.
    allowRequest(req, callback) {
      const origin = req.headers.origin
      if (!origin) return callback(null, true)
      let originHost
      try { originHost = new URL(origin).host } catch { return callback('bad origin', false) }
      const forwardedHost = req.headers['x-forwarded-host']?.split(',')[0].trim()
      const allowed = [req.headers.host, forwardedHost, ...extraOriginHosts].filter(Boolean)
      if (allowed.includes(originHost)) return callback(null, true)
      log.warn(`Rejected connection from origin ${origin}. If that is your own address, add it to ALLOWED_ORIGINS.`)
      callback('origin not allowed', false)
    },
  })

  // rooms.get(roomId) = {
  //   peers:   socket ids currently in the room (max 2)
  //   members: every socket id that has been in it, allowed to rejoin
  //   locked:  true once two people have been in it; no newcomers after that
  // }
  const rooms = new Map()
  const globalFailedJoins = []
  let globalPauseWarned = false

  io.on('connection', (socket) => {
    let currentRoomId = null
    const failedJoins = []

    function inRoom(roomId) {
      return roomId === currentRoomId && !!rooms.get(roomId)?.peers.includes(socket.id)
    }

    // A socket belongs to at most one room. Before creating or joining another,
    // leave the current one; otherwise the old room keeps a ghost entry for this
    // socket that disconnect never cleans up, and it reports "Room is full" forever.
    function leaveCurrentRoom() {
      if (!currentRoomId) return
      const roomId = currentRoomId
      currentRoomId = null
      socket.leave(roomId)
      const room = rooms.get(roomId)
      if (!room) return
      room.peers = room.peers.filter(id => id !== socket.id)
      if (room.peers.length === 0) {
        rooms.delete(roomId)
      } else {
        socket.to(roomId).emit('peer-left')
      }
    }

    function failJoin(message) {
      const now = Date.now()
      failedJoins.push(now)
      globalFailedJoins.push(now)
      if (recentCount(failedJoins, now) >= SOCKET_FAILED_JOINS) {
        socket.emit('room-error', { message: 'Too many wrong codes. Wait a minute, then reload the page.' })
        socket.disconnect(true)
        return
      }
      socket.emit('room-error', { message })
    }

    socket.on('create-room', ({ displayName } = {}) => {
      leaveCurrentRoom()
      if (rooms.size >= MAX_ROOMS) {
        socket.emit('room-error', { message: 'Server is full' })
        return
      }
      const roomId = generateRoomId(rooms)
      rooms.set(roomId, {
        peers: [socket.id],
        members: new Set([socket.id]),
        locked: false,
        creatorDisplayName: cleanName(displayName),
      })
      currentRoomId = roomId
      socket.join(roomId)
      socket.emit('room-created', { roomId })

      // Stale room cleanup — if second peer never arrives
      setTimeout(() => {
        const room = rooms.get(roomId)
        if (room && !room.locked && room.peers.length < 2) {
          rooms.delete(roomId)
        }
      }, ROOM_TTL_MS).unref()
    })

    socket.on('join-room', ({ roomId, displayName } = {}) => {
      // If someone is guessing codes, stop all joins for a minute rather than
      // let a guess land. Annoying under attack, but never a hijack.
      if (recentCount(globalFailedJoins, Date.now()) >= GLOBAL_FAILED_JOINS) {
        if (!globalPauseWarned) log.warn('Many wrong room codes in the last minute: pausing joins.')
        globalPauseWarned = true
        socket.emit('room-error', { message: 'Too many attempts on this server. Try again in a minute.' })
        return
      }
      globalPauseWarned = false

      const target = typeof roomId === 'string' ? rooms.get(roomId.toUpperCase()) : undefined
      if (!target) return failJoin('Room not found')
      roomId = roomId.toUpperCase()

      // Codes are single-use: once two people have been in a room, only
      // they can come back. Anyone else needs a new room.
      if (target.locked && !target.members.has(socket.id)) {
        return failJoin('This room code has already been used. Ask for a new one.')
      }
      // Don't count this socket itself, so retrying a join that failed to
      // connect re-joins cleanly instead of hitting "Room is full".
      if (target.peers.filter(id => id !== socket.id).length >= 2) {
        socket.emit('room-error', { message: 'Room is full' })
        return
      }
      // Leaving first means a retry of the same room notifies the creator
      // (peer-left, then peer-joined), which makes them send a fresh offer.
      leaveCurrentRoom()
      const room = rooms.get(roomId)
      if (!room) {
        socket.emit('room-error', { message: 'Room not found' })
        return
      }
      room.peers.push(socket.id)
      room.members.add(socket.id)
      if (room.peers.length === 2) room.locked = true
      currentRoomId = roomId
      socket.join(roomId)
      socket.emit('room-joined', { roomId, creatorDisplayName: room.creatorDisplayName })
      // Relay joiner's display name so creator can show "Incoming from [name]"
      socket.to(roomId).emit('peer-joined', { displayName: cleanName(displayName) })
    })

    // Handshake messages are only relayed between the two people actually in
    // the room. Without this check, anyone who knew a code could inject a
    // forged offer or answer and take over the connection.
    socket.on('offer', ({ roomId, offer } = {}) => {
      if (inRoom(roomId)) socket.to(roomId).emit('offer', { offer })
    })

    socket.on('answer', ({ roomId, answer } = {}) => {
      if (inRoom(roomId)) socket.to(roomId).emit('answer', { answer })
    })

    socket.on('ice-candidate', ({ roomId, candidate } = {}) => {
      if (inRoom(roomId)) socket.to(roomId).emit('ice-candidate', { candidate })
    })

    socket.on('disconnect', leaveCurrentRoom)
  })

  return { server, io, rooms }
}
