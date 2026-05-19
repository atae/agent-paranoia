# Agent Paranoia — Implementation Guide
> P2P encrypted file transfer and chat over WebRTC, self-hosted on a Raspberry Pi via Headscale.
> Handoff spec for Claude Code. Read this fully before writing any code.

---

## Project Overview

A self-hosted, private, browser-native P2P file transfer and chat application. No frameworks. No database. No file storage on server. Built to be extended to small group (mesh) sessions later.

**Core principles:**
- Privacy first — files and messages never touch the server (except TURN fallback)
- No installs for either party — pure browser
- No accounts, no stored data
- Vanilla JS only — no React, no Svelte, no build step

---

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Vanilla JS + HTML + CSS | No framework, no bundler |
| Signaling | Node.js + Socket.io | Lightweight, stateless |
| STUN | Coturn in STUN-only mode on Pi | Self-hosted, no Google dependency |
| Hardware | Raspberry Pi 4 (on-prem) | You own it, no cloud involved |
| Network | Headscale on Pi | Self-hosted WireGuard coordination, no Tailscale/Cloudflare |

---

## Folder Structure

```
/
├── client/
│   ├── index.html
│   ├── style.css
│   └── src/
│       ├── main.js          # entry point, bootstraps app
│       ├── signaling.js     # socket.io client, room join/leave
│       ├── webrtc.js        # RTCPeerConnection, ICE, DataChannel setup
│       ├── transfer.js      # file chunking, reassembly, progress tracking
│       ├── chat.js          # message send/receive, export
│       └── ui.js            # all DOM manipulation lives here
│
└── server/
    ├── signaling.js         # socket.io server, room logic
    └── package.json
```

**Rule:** No module imports DOM directly except `ui.js`. All other modules are pure logic and emit events or call callbacks.

---

## Signaling Server (`server/signaling.js`)

### Responsibilities
- Create rooms with a short random ID (6 chars, alphanumeric)
- Allow a second peer to join a room
- Relay WebRTC offer, answer, and ICE candidates between peers
- Notify peers when the other disconnects
- Reject third peers attempting to join a full room

### Socket events (server listens)

| Event | Payload | Action |
|---|---|---|
| `create-room` | none | Generate room ID, join socket to room, emit `room-created` |
| `join-room` | `{ roomId }` | If room exists and has 1 peer, join and emit `peer-joined` to both. If full or missing, emit `room-error` |
| `offer` | `{ roomId, offer }` | Relay offer to other peer in room |
| `answer` | `{ roomId, answer }` | Relay answer to other peer in room |
| `ice-candidate` | `{ roomId, candidate }` | Relay ICE candidate to other peer |
| `disconnect` | none | Emit `peer-left` to remaining peer in room, clean up room if empty |

### Socket events (server emits)

| Event | Payload | recipient |
|---|---|---|
| `room-created` | `{ roomId }` | creator |
| `room-joined` | `{ roomId }` | joiner |
| `peer-joined` | none | creator (triggers offer creation) |
| `peer-left` | none | remaining peer |
| `room-error` | `{ message }` | joiner |

### Room state shape
```javascript
// in-memory only, no persistence needed
const rooms = new Map();
// rooms.get(roomId) = { peers: [socketId, socketId?] }
```

### Notes
- Rooms are destroyed when both peers leave
- No authentication at this stage — room ID is the shared secret
- Keep the server stateless beyond the rooms Map

---

## WebRTC Module (`client/src/webrtc.js`)

### ICE config
```javascript
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:YOUR_PI_HEADSCALE_IP:3478' } // self-hosted coturn STUN-only
  ]
};
```

### DataChannels
Create two separate named channels:

| Channel | Label | Options |
|---|---|---|
| Chat | `"chat"` | `{ ordered: true }` |
| File transfer | `"file"` | `{ ordered: true }` |

Using two channels keeps chat responsive during large file transfers.

### Connection flow
1. Creator waits for `peer-joined` signal
2. Creator creates offer → sends via signaling
3. Joiner receives offer → creates answer → sends via signaling
4. Both exchange ICE candidates as they arrive (trickle ICE)
5. On `datachannel` open → notify ui.js that connection is ready

### Exported interface
```javascript
export const WebRTC = {
  init(signalingClient, onChatMessage, onFileChunk, onConnectionChange),
  createOffer(),
  handleOffer(offer),
  handleAnswer(answer),
  handleIceCandidate(candidate),
  sendChat(message),      // sends over chat DataChannel
  sendFileChunk(chunk),   // sends over file DataChannel
  close()
};
```

---

## File Transfer Module (`client/src/transfer.js`)

### Chunking
- Chunk size: `64 * 1024` (64KB) — safe for DataChannel buffer
- Before sending chunks, send a metadata message on the file channel:
```javascript
// JSON string
{
  type: 'file-meta',
  name: 'filename.zip',
  size: 104857600,  // bytes
  totalChunks: 1639
}
```
- Then send raw ArrayBuffer chunks sequentially
- After last chunk, send:
```javascript
{ type: 'file-end', name: 'filename.zip' }
```

### Receiving
- On `file-meta`: store metadata, initialise chunk buffer
- On ArrayBuffer message: push to buffer, update progress
- On `file-end`: reassemble via `Blob`, trigger download via object URL

### Progress
- Emit progress events that `ui.js` listens to: `{ fileName, percent, bytesTransferred, totalBytes }`
- Track send-side progress by chunk index
- Track receive-side progress by bytes received

### Exported interface
```javascript
export const Transfer = {
  sendFile(file, sendChunkFn, onProgress),
  handleIncoming(data, onProgress, onComplete)
};
```

---

## Chat Module (`client/src/chat.js`)

### Display name
- Prompt for a display name on first load — simple modal, one text input
- Store in `localStorage` as `displayName` — the one intentional exception to the no-persistence rule since it's just a preference, not sensitive data
- Send display name as part of the signaling handshake so the other peer sees it before accepting a connection
- Show "Incoming connection from **Alex**" rather than "Incoming connection from a peer"
- Allow changing display name in a settings panel

### Message shape
```javascript
{
  id: crypto.randomUUID(),
  from: 'me' | 'them',
  displayName: 'Alex',
  text: 'message content',
  timestamp: Date.now()
}
```

### Storage
- Keep all messages in a module-level array `const messages = []`
- No localStorage, no indexedDB — session only

### Export formats
Implement all three:

**As .txt**
```
[10:32 AM] You: hey
[10:32 AM] Them: hi!
```

**As .json**
```json
[{ "from": "me", "text": "hey", "timestamp": 1234567890 }]
```

**As .html**
- Full self-contained HTML file
- Inline the CSS so it renders without any external files
- Match the visual style of the app chat UI
- Include session date in the title

### Disconnect prompt
When `peer-left` is received and messages.length > 0:
- Show a non-blocking banner: "Your peer disconnected. Save chat before closing?"
- Buttons: "Save as HTML" | "Dismiss"

### Exported interface
```javascript
export const Chat = {
  addMessage(from, text),
  exportTxt(),
  exportJson(),
  exportHtml(),
  getMessages()
};
```

---

## UI Module (`client/src/ui.js`)

### Views (single page, show/hide sections)
1. **Home** — "Create room" button + "Join room" input + button
2. **Lobby** — show room code + copy button + waiting spinner
3. **Session** — chat panel + file drop zone + peer status indicator

### Peer status indicator
Simple colored dot + text:
- 🟡 Waiting for peer
- 🟢 Connected
- 🔴 Peer disconnected

### File transfer UX
- Drag-and-drop zone in session view
- Also a click-to-browse fallback
- Progress bar per file (support queuing multiple files)
- Show filename, size, and % complete
- On receive side: show incoming file name + progress + "Save file" button on completion

### Chat UX
- Simple message list, auto-scroll to bottom
- Input box + send on Enter
- Timestamps on each message
- Export button in chat header (dropdown: txt / json / html)

### Room code UX
- Display as large readable text in lobby
- One-click copy to clipboard
- Consider splitting into groups: `ABC-123` format for readability

---

## main.js (Entry Point)

Bootstraps everything in order:
1. Import and init `signaling.js` (connect to server)
2. Import `webrtc.js`, `transfer.js`, `chat.js`, `ui.js`
3. Wire signaling events → webrtc handlers
4. Wire webrtc callbacks → chat/transfer handlers
5. Wire ui events → signaling/webrtc/transfer actions

This is the only file that knows about all modules. Everything else is isolated.

---

## Signaling Client (`client/src/signaling.js`)

Simple wrapper around Socket.io client:

```javascript
export const Signaling = {
  connect(serverUrl),
  createRoom(),
  joinRoom(roomId),
  sendOffer(roomId, offer),
  sendAnswer(roomId, answer),
  sendIceCandidate(roomId, candidate),
  on(event, handler)   // thin wrapper for socket.on
};
```

---

## Local Development Phases

Run through these phases in order. Don't set up Headscale or move to the Pi until the previous phase is fully working.

### Phase 1 — Localhost only
No Headscale, no Coturn, no Pi. Just prove the app works.

```bash
# Terminal 1 — signaling server
cd server && node signaling.js

# Browser — open two tabs at:
http://localhost:8080
```

- Two tabs on the same machine connect via localhost
- No WireGuard, no network config
- Use this phase for all of Steps 1-7 in the build order
- ICE config can point to Google STUN temporarily just to get moving:
```javascript
const ICE_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
}
```

**Exit criteria:** Full app works end to end in two local tabs including file transfer, chat, export, and display names.

---

### Phase 2 — Local machine + Headscale
Still on your local machine, but now testing real network paths with a friend.

- Install Headscale on your local machine
- Add one friend to your Headscale network
- Update ICE config to point at your self-hosted Coturn
- Friend connects to your signaling server via Headscale IP
- Test a real file transfer over the network

**Exit criteria:** At least one successful transfer with a real remote peer over Headscale. Chat and export confirmed working.

---

### Phase 3 — Raspberry Pi (production)
Move everything to the Pi for always-on availability.

```bash
# On your Pi
git clone https://github.com/YOU/agentparanoia
cd agentparanoia
cp .env.example .env
# Edit .env with Pi's Headscale IP
npm install
pm2 start server/signaling.js --name agentparanoia
```

- Copy your Headscale config to the Pi
- Move Coturn to the Pi
- Your local machine is no longer needed for the app to run
- Friends connect the same way as Phase 2, just to the Pi's Headscale IP instead

**Exit criteria:** Full app running on Pi, accessible to all Headscale peers, your local machine can be off.

---

### Raspberry Pi setup
```bash
# Install Raspberry Pi OS Lite (headless)
# Harden SSH immediately
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no
# Set: Port 2222 (or any non-standard port)

# Firewall — only allow WireGuard and SSH
sudo apt install ufw
sudo ufw allow 2222/tcp   # SSH
sudo ufw allow 41641/udp  # Headscale/WireGuard
sudo ufw enable
```

### Headscale (WireGuard coordination)
```bash
# Install Headscale on your Pi
curl -fsSL https://github.com/juanfont/headscale/releases/latest \
  -o headscale
chmod +x headscale
sudo mv headscale /usr/local/bin/

# Configure and start
sudo headscale serve

# Create your network and add friends
headscale users create mynetwork
headscale preauthkeys create --user mynetwork
# Share the preauth key with friends — they use it with the Tailscale client
# pointing to your Pi as the control server
```

### Friends setup (one time)
```bash
# Friends install Tailscale client but point it at your Headscale server
tailscale up --login-server=http://YOUR_PI_HEADSCALE_IP:8080
# Use the preauth key you generated
```

### Coturn in STUN-only mode
```bash
sudo apt install coturn

# Edit /etc/turnserver.conf — STUN only, no TURN relay
# no-auth
# no-turn
# listening-port=3478
# realm=local

sudo systemctl enable coturn
sudo systemctl start coturn
sudo ufw allow 3478/udp
```

### Signaling server
```bash
# On your Pi
npm install
pm2 start server/signaling.js --name webrtc-signal
# Signaling server only listens on Headscale internal network (100.x.x.x)
# Never exposed to public internet
```

### Frontend
```bash
# Serve static files directly from Pi — only accessible within Headscale network
npx serve client/ -l 8081
# Friends access via http://YOUR_PI_HEADSCALE_IP:8081
```

---

## Extension Points (for later)

These are intentional gaps to fill in future versions:

**Group/mesh support**
- `webrtc.js` — replace single `RTCPeerConnection` with a `Map` of connections keyed by peer socket ID
- `signaling.js` server — increase room peer limit, broadcast ICE/offer/answer to all peers not just "the other one"
- `chat.js` — add `from` identity beyond just 'me'/'them' (use socket ID or a chosen display name)
- `transfer.js` — add a target peer ID to file-meta so multi-peer sessions know who a file is for

**Transfer resume**
For very large files (5GB+) where a mid-transfer disconnect is genuinely painful. Requires:
- SHA-256 file identity hash generated before sending
- Chunk manifest with index + checksum per chunk
- localStorage transfer state on both sides (received chunk map)
- Resume handshake — receiver sends received manifest, sender diffs and sends missing chunks only
- Out-of-order reassembly (sparse buffer indexed by chunk position rather than append)
- Fallback behavior for: file changed between sessions, localStorage cleared, resume handshake itself dropping
Not worth building in v1 — connection drops are rare enough that restarting is acceptable. Revisit when transfers routinely exceed 5GB.

---

## What NOT to build yet
- User accounts or auth
- Message persistence or database
- Push notifications
- TURN authentication UI (hardcode credentials for now)
- Mobile-specific UI optimizations
- Group/mesh connections

---

## Security Hardening

These should be addressed before considering the project shippable. Ordered by effort.

### Low effort — do these first

**TLS on signaling server**
Run nginx in front of the Node server, terminate SSL there. Use Let's Encrypt via certbot. Clients connect via `wss://` not `ws://`. Without this, signaling messages are plaintext on the network, which undermines DTLS fingerprint integrity.
```nginx
server {
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem;

    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

**Sanitize display names**
Before inserting any user-provided string into the chat HTML export, sanitize it. A display name of `<script>alert(1)</script>` is a stored XSS vector in the exported HTML file.
```javascript
function sanitize(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
```
Apply to display names and message content before rendering or exporting.

**Rate limit room creation**
Prevent a Headscale peer from spamming room creation and exhausting server memory.
```javascript
import rateLimit from 'express-rate-limit'
const limiter = rateLimit({ windowMs: 60_000, max: 20 })
app.use(limiter)
```

**Stale room cleanup**
Rooms where only one peer joined and the second never arrived should be cleaned up after a timeout.
```javascript
// In signaling.js — after room creation
setTimeout(() => {
  if (rooms.get(roomId)?.peers.length < 2) {
    rooms.delete(roomId)
  }
}, 5 * 60 * 1000) // 5 minutes
```

**Pi full disk encryption**
Enable at OS install time using Raspberry Pi Imager's advanced options. Cannot be added after the fact without reinstalling. Protects against physical access to the Pi.

### Medium effort — do these before open sourcing

**Backpressure handling in transfer.js**
Monitor `bufferedAmount` on the file DataChannel. Pause sending chunks when the buffer is full, resume when it drains. Without this, large transfers on slow connections will silently corrupt or crash.
```javascript
const MAX_BUFFER = 256 * 1024 // 256KB
function sendNextChunk() {
  if (dataChannel.bufferedAmount > MAX_BUFFER) {
    dataChannel.onbufferedamountlow = () => {
      dataChannel.onbufferedamountlow = null
      sendNextChunk()
    }
    dataChannel.bufferedAmountLowThreshold = MAX_BUFFER / 2
    return
  }
  // send chunk
}
```

**Per-chunk checksums**
Add a simple checksum (CRC32 or even just chunk index + byte length) to detect silent corruption during reassembly. Especially important if you later extend to unreliable DataChannels.

**Connection timeout handling**
If ICE negotiation doesn't complete within 30 seconds, surface an error to the user rather than hanging silently.
```javascript
const iceTimeout = setTimeout(() => {
  if (pc.iceConnectionState !== 'connected') {
    onConnectionChange('failed')
    pc.close()
  }
}, 30_000)

pc.oniceconnectionstatechange = () => {
  if (pc.iceConnectionState === 'connected') clearTimeout(iceTimeout)
}
```

### Ongoing — operational security

- Keep Coturn updated — it has a history of CVEs, check releases periodically
- Rotate Headscale preauth keys after friends have joined — don't leave open keys active
- Review Pi SSH access logs occasionally — `sudo journalctl -u ssh`
- Keep Raspberry Pi OS updated — `sudo apt update && sudo apt upgrade` monthly

---

### Before publishing
- [ ] Audit all config files for hardcoded IPs, credentials, or personal info
- [ ] Add `.gitignore` covering `.env`, any generated keys, and Headscale config
- [ ] Move all environment-specific values to a `.env.example` with placeholder values
- [ ] Review git history for accidentally committed secrets (`git log -p`)
- [ ] Strip any personal display names or test room codes from code

### License
- **AGPL** recommended — anyone who modifies and hosts it must also open source their changes. Prevents someone quietly stripping zero-log guarantees and hosting a logging version. Fits the privacy ethos of the project.

### README structure
1. **Agent Paranoia** — one paragraph, lead with the privacy angle
2. Architecture diagram — full stack visually
3. Threat model — what it protects against and honest gaps (builds trust)
4. Prerequisites — Raspberry Pi, Headscale already running, WireGuard clients
5. Installation — step by step
6. Friend onboarding — dedicated section
7. Extending it — group mesh, TURN, display names
8. Contributing

### Repo
- GitHub slug: `agentparanoia`
- Suggested domain: `agentparanoia.app` (check availability before committing)

---

## Friend Self-Hosting Guide

Once your instance is working, a friend wanting their own independent setup needs:

### Prerequisites (their responsibility)
- A Raspberry Pi 4 (or any always-on Linux machine)
- A domain name (optional but nice)
- Basic comfort with SSH and terminal

### What they clone and run
```bash
git clone https://github.com/YOU/agentparanoia
cd YOUR_REPO
cp .env.example .env
# Edit .env with their Pi's Headscale IP and STUN port
npm install
pm2 start server/signaling.js
```

### What they set up independently
- Their own Headscale instance (separate network, you have no access)
- Their own Coturn in STUN-only mode
- Their own friend group added to their Headscale network

### Key point — networks are fully isolated
Your Headscale network and theirs are completely separate:
- You cannot see their connections
- They cannot see yours
- No shared infrastructure after the code is cloned
- Each instance is fully sovereign

### Realistic setup time for a technical friend
- Headscale already running: **~30 minutes**
- Starting from scratch: **half a day**

### What makes this easier once open sourced
A good `install.sh` script could automate most of the Pi setup — coturn config, pm2, firewall rules. Worth adding after your first instance is stable.

---

## Build Order & Checkpoints

**Critical instruction for Claude Code: implement one step at a time. Stop at each checkpoint and wait for the human to test and confirm before proceeding. Do not scaffold ahead. Do not write code for future steps.**

---

### Step 1 — Signaling server + two-tab handshake
**Build:**
- `server/signaling.js` — room creation, join, offer/answer/ICE relay, disconnect handling
- `client/test.html` — minimal two-tab test page, no UI polish

**Checkpoint:** Open two browser tabs. Tab 1 creates a room. Tab 2 joins it. Console confirms DataChannel opens on both sides. Stop here.

---

### Step 2 — Text chat over DataChannel
**Build:**
- `client/src/chat.js` — message send/receive, in-memory store
- `client/src/webrtc.js` — chat DataChannel setup
- Minimal chat UI in `test.html` — input box, message list, no styling

**Checkpoint:** Type a message in tab 1, it appears in tab 2 and vice versa. Timestamps correct. Stop here.

---

### Step 3 — File transfer
**Build:**
- `client/src/transfer.js` — chunking, metadata message, reassembly, progress events
- `client/src/webrtc.js` — file DataChannel setup (separate from chat)
- File input in `test.html` — drag and drop + browse button

**Checkpoint:** Send a file from tab 1. Tab 2 receives it, reassembles correctly, triggers download. Test with a small file (1MB) and a large file (500MB+). Stop here.

---

### Step 4 — Progress tracking
**Build:**
- Progress events wired from `transfer.js` to a basic progress bar in `test.html`
- Both send-side and receive-side progress displayed

**Checkpoint:** Progress bar updates smoothly during a large file transfer. Percent and bytes shown correctly on both sides. Stop here.

---

### Step 5 — Chat export
**Build:**
- `chat.js` export functions — `.txt`, `.json`, `.html`
- Export buttons in `test.html`
- Disconnect prompt — "Save chat before closing?" banner when peer leaves and messages exist

**Checkpoint:** Send a few messages, export all three formats, verify each looks correct. Disconnect a peer, confirm the banner appears. Stop here.

---

### Step 6 — Display names
**Build:**
- Name prompt modal on first load
- `localStorage` persistence for display name
- Name sent during signaling handshake
- "Incoming connection from **[name]**" shown before accepting
- Name shown on each chat message

**Checkpoint:** Set different names in each tab. Confirm names appear correctly on connection and in chat. Stop here.

---

### Step 7 — Full UI
**Build:**
- `client/index.html` — replace test.html with real UI
- `client/style.css` — full styling
- `client/src/ui.js` — all DOM logic
- Three views: Home, Lobby, Session
- Peer status indicator, room code display, copy button
- File queue with per-file progress bars

**Checkpoint:** Full flow works end to end with real UI. Both peers can send files and chat. Export works. Disconnect prompt works. Stop here.

---

### Step 8 — Hardening
**Build:**
- Verify zero `console.log` calls that record IPs, room IDs, or peer info in signaling server
- Confirm no sensitive data in localStorage beyond display name
- Test peer disconnect mid-transfer — graceful error, no crash
- Test DataChannel backpressure on very large files

**Checkpoint:** All edge cases handled cleanly. Signaling server logs nothing sensitive. Stop here — ship it.

---

## First task for Claude Code
> Read this entire spec before writing any code. Then implement Step 1 only: the signaling server (`server/signaling.js`) and a minimal test client (`client/test.html`) that opens two tabs, creates/joins a room, and confirms the DataChannel opens successfully between them. No UI polish. No other modules. Stop and wait after Step 1 is complete.
