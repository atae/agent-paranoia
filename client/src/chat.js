const messages = []

// crypto.randomUUID() requires a secure context (HTTPS/localhost) so it fails
// when loaded over plain HTTP from a LAN IP. getRandomValues works everywhere.
function uuid() {
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  )
}

// Used in HTML export to prevent XSS from user-supplied display names and text.
// chat.js has no DOM access, so we do this with string replacement rather than
// the createTextNode trick.
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export const Chat = {
  // timestamp and displayName are optional — used when storing received messages
  // to preserve the sender's original values rather than generating new ones.
  addMessage(from, text, { displayName = null, timestamp = null } = {}) {
    const message = {
      id: uuid(),
      from,
      displayName: displayName || from,
      text,
      timestamp: timestamp ?? Date.now()
    }
    messages.push(message)
    return message
  },

  getMessages() {
    return messages
  },

  exportTxt() {
    return messages.map(m => {
      const who = m.from === 'me' ? 'You' : (m.displayName || 'Them')
      return `[${fmtTime(m.timestamp)}] ${who}: ${m.text}`
    }).join('\n')
  },

  exportJson() {
    return JSON.stringify(messages, null, 2)
  },

  exportHtml() {
    const sessionDate = messages.length
      ? new Date(messages[0].timestamp).toLocaleDateString()
      : new Date().toLocaleDateString()

    const rows = messages.map(m => {
      const who = m.from === 'me' ? 'You' : escapeHtml(m.displayName || 'Them')
      const text = escapeHtml(m.text)
      const cls = m.from === 'me' ? 'me' : 'them'
      return `  <div class="msg ${cls}"><span class="who">${who}</span> <span class="ts">${fmtTime(m.timestamp)}</span>: ${text}</div>`
    }).join('\n')

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Agent Paranoia — Chat ${sessionDate}</title>
  <style>
    body { font-family: monospace; padding: 20px; max-width: 600px; }
    h1 { font-size: 1rem; margin-bottom: 4px; }
    .date { color: #888; font-size: 0.85rem; margin-bottom: 16px; }
    .msg { margin-bottom: 6px; line-height: 1.5; }
    .ts { color: #888; font-size: 0.85em; }
    .me .who { color: #1a7a1a; }
    .them .who { color: #00b; }
  </style>
</head>
<body>
  <h1>Agent Paranoia</h1>
  <div class="date">${sessionDate}</div>
${rows}
</body>
</html>`
  }
}
