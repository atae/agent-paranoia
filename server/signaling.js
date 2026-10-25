import { createApp } from './app.js'

const PORT = process.env.PORT || 7654
// Set HOST=127.0.0.1 when a reverse proxy (e.g. Tailscale Serve) sits in front,
// so the plain-HTTP port isn't reachable from the LAN.
// Unset = all interfaces (IPv4 and IPv6).
const HOST = process.env.HOST || undefined

const list = value => (value || '').split(',').map(s => s.trim()).filter(Boolean)

// STUN servers handed to clients, e.g. STUN_URLS=stun:hako.example.ts.net:3478
// Comma-separated. Deliberately no third-party default: if unset, clients get
// no STUN server and only peers on the same network can connect.
const stunUrls = list(process.env.STUN_URLS)
if (!stunUrls.length) {
  console.warn('STUN_URLS is not set: peers on different networks will not be able to connect.')
}

// Extra page origins allowed to connect, if the server sees a different Host
// than the one in the browser's address bar (unusual proxy setups).
const allowedOrigins = list(process.env.ALLOWED_ORIGINS)

const { server } = createApp({ stunUrls, allowedOrigins })

server.listen(PORT, HOST, () => {
  console.log(`Agent Paranoia signaling server running on ${HOST ?? 'all interfaces'}, port ${PORT}`)
})
