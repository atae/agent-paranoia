// Saving received files straight into a folder the user picked, so large
// files stream to disk instead of sitting in memory. Uses the File System
// Access API (Chrome/Edge on desktop). Elsewhere, or with no folder chosen,
// the app falls back to holding the file in memory until the user clicks Save.

const DB_NAME = 'agent-paranoia'
const STORE = 'settings'
const KEY = 'downloadDir'

let _dir = null   // FileSystemDirectoryHandle, cached so permission prompts stay within the click

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function dbOp(mode, fn) {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req?.result)
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

// Names come from the other peer, so treat them as untrusted: no path
// separators, no characters Windows rejects, no leading dots or trailing spaces.
export function sanitizeFileName(name) {
  let clean = String(name)
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, 200)
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(clean)) clean = `_${clean}`
  return clean || 'download'
}

function withSuffix(name, n) {
  if (n === 0) return name
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`
}

export const Downloads = {
  supported: typeof window.showDirectoryPicker === 'function',

  async init() {
    if (!this.supported) return
    try { _dir = (await dbOp('readonly', s => s.get(KEY))) || null } catch { _dir = null }
  },

  folderName() {
    return _dir?.name ?? null
  },

  async chooseFolder() {
    const dir = await window.showDirectoryPicker({ id: 'agent-paranoia-downloads', mode: 'readwrite' })
    await dbOp('readwrite', s => s.put(dir, KEY))
    _dir = dir
    return dir.name
  },

  async clearFolder() {
    _dir = null
    try { await dbOp('readwrite', s => s.delete(KEY)) } catch {}
  },

  // Opens a new file in the chosen folder for writing. Must be called from a
  // click (e.g. Accept) because the browser may ask for permission again after
  // a reload. Never overwrites: picks "name (1).ext" etc. if the name is taken.
  async openWritable(name) {
    if (!_dir) throw new Error('No download folder set')
    const opts = { mode: 'readwrite' }
    if (await _dir.queryPermission(opts) !== 'granted' &&
        await _dir.requestPermission(opts) !== 'granted') {
      throw new Error('Permission to the download folder was denied')
    }
    const base = sanitizeFileName(name)
    for (let n = 0; n < 1000; n++) {
      const candidate = withSuffix(base, n)
      try {
        await _dir.getFileHandle(candidate)
        continue   // exists
      } catch (e) {
        if (e.name !== 'NotFoundError') throw e
      }
      const handle = await _dir.getFileHandle(candidate, { create: true })
      return { writable: await handle.createWritable(), savedAs: candidate }
    }
    throw new Error('Could not find a free file name')
  },
}
