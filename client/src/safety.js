// Safety code: proves nobody (not even a compromised server) is sitting in
// the middle of the connection.
//
// Each browser's encryption key is identified by a DTLS fingerprint, and the
// fingerprints are exchanged through the server. A malicious server could
// swap them and relay everything, decrypting in the middle. Then each side
// would see a different fingerprint for "the other person".
//
// So both sides derive a short code from the two fingerprints they actually
// ended up using. Same code on both screens = same keys = no one in between.
// People compare it out loud (or anywhere outside this app).
//
// A plain hash of the fingerprints isn't enough with a short code: an
// attacker could generate throwaway keys until both sides' codes happened to
// match. To stop that, the code also mixes in a random number from each side,
// exchanged with a commitment (one side sends a hash of its number first,
// and only reveals the number after seeing the other's). The keys are fixed
// before this exchange starts, so an attacker gets one blind guess per call:
// about 1 in a billion for a 5-emoji code. ZRTP uses the same idea.
//
// Messages (sent over the chat channel):
//   committer → sas-commit { h }   h = SHA-256(nonce)
//   responder → sas-nonce  { n }
//   committer → sas-reveal { n }   responder checks SHA-256(n) === h

const CODE_SYMBOLS = 5   // 6 bits each → 30 bits

// 64 easy-to-say, unambiguous emoji, with names for reading out loud.
export const EMOJI = [
  ['🐶', 'dog', '犬'], ['🐱', 'cat', '猫'], ['🐭', 'mouse', 'ネズミ'], ['🐰', 'rabbit', 'ウサギ'],
  ['🦊', 'fox', 'キツネ'], ['🐻', 'bear', 'クマ'], ['🐼', 'panda', 'パンダ'], ['🐨', 'koala', 'コアラ'],
  ['🐯', 'tiger', 'トラ'], ['🦁', 'lion', 'ライオン'], ['🐮', 'cow', 'ウシ'], ['🐷', 'pig', 'ブタ'],
  ['🐸', 'frog', 'カエル'], ['🐵', 'monkey', 'サル'], ['🐔', 'chicken', 'ニワトリ'], ['🐧', 'penguin', 'ペンギン'],
  ['🦉', 'owl', 'フクロウ'], ['🐢', 'turtle', 'カメ'], ['🐍', 'snake', 'ヘビ'], ['🐙', 'octopus', 'タコ'],
  ['🦀', 'crab', 'カニ'], ['🐳', 'whale', 'クジラ'], ['🐝', 'bee', 'ハチ'], ['🦋', 'butterfly', 'チョウ'],
  ['🌵', 'cactus', 'サボテン'], ['🌲', 'tree', '木'], ['🌻', 'sunflower', 'ひまわり'], ['🍄', 'mushroom', 'キノコ'],
  ['🍎', 'apple', 'りんご'], ['🍌', 'banana', 'バナナ'], ['🍇', 'grapes', 'ぶどう'], ['🍓', 'strawberry', 'いちご'],
  ['🍋', 'lemon', 'レモン'], ['🍉', 'watermelon', 'スイカ'], ['🌽', 'corn', 'とうもろこし'], ['🥕', 'carrot', 'にんじん'],
  ['🍕', 'pizza', 'ピザ'], ['🍩', 'donut', 'ドーナツ'], ['🍪', 'cookie', 'クッキー'], ['🎂', 'cake', 'ケーキ'],
  ['☕', 'coffee', 'コーヒー'], ['🍙', 'rice ball', 'おにぎり'], ['⚽', 'soccer ball', 'サッカーボール'], ['🎸', 'guitar', 'ギター'],
  ['🎈', 'balloon', '風船'], ['🎁', 'gift', 'プレゼント'], ['🔑', 'key', '鍵'], ['🔔', 'bell', 'ベル'],
  ['💡', 'light bulb', '電球'], ['📚', 'books', '本'], ['✂️', 'scissors', 'はさみ'], ['⏰', 'clock', '時計'],
  ['🚀', 'rocket', 'ロケット'], ['🚗', 'car', '車'], ['🚲', 'bicycle', '自転車'], ['⛵', 'sailboat', 'ヨット'],
  ['✈️', 'airplane', '飛行機'], ['⚓', 'anchor', 'いかり'], ['🌙', 'moon', '月'], ['⭐', 'star', '星'],
  ['☀️', 'sun', '太陽'], ['🌈', 'rainbow', '虹'], ['❄️', 'snowflake', '雪'], ['🔥', 'fire', '火'],
]

const HEX64 = /^[0-9a-f]{64}$/

const subtle = () => globalThis.crypto?.subtle

export function safetyCodeSupported() {
  return !!subtle()
}

async function sha256Hex(text) {
  const buf = await subtle().digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function randomHex() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('')
}

// "a=fingerprint:sha-256 AB:CD:…" → "sha-256 AB:CD:…" (first one in the SDP).
export function fingerprintFromSdp(sdp) {
  const m = /^a=fingerprint:(\S+) ([0-9A-Fa-f:]+)\s*$/m.exec(sdp || '')
  return m ? `${m[1].toLowerCase()} ${m[2].toUpperCase()}` : null
}

async function deriveCode(localFp, remoteFp, committerNonce, responderNonce) {
  const fps = [localFp, remoteFp].sort().join('\n')
  const hex = await sha256Hex(`agent-paranoia-sas-v1\n${fps}\n${committerNonce}\n${responderNonce}`)
  const bits = parseInt(hex.slice(0, 8), 16)   // 32 bits, we use the top 30
  const symbols = []
  for (let i = 0; i < CODE_SYMBOLS; i++) symbols.push(EMOJI[(bits >>> (26 - 6 * i)) & 63])
  return symbols.map(([emoji, en, jp]) => ({ emoji, en, jp }))
}

// role: 'committer' (the side that made the offer) or 'responder'.
// send(message) delivers a message to the other side.
// Returns { start(), handle(message) → true if it was a safety message, result: Promise<code> }.
// result rejects with a SafetyProtocolError if the other side cheats.
export class SafetyProtocolError extends Error {}

export function createSafetyCheck({ role, localFp, remoteFp, send }) {
  let resolve, reject
  const result = new Promise((res, rej) => { resolve = res; reject = rej })
  let done = false
  const finish = p => p.then(code => { done = true; resolve(code) }, err => { done = true; reject(err) })

  let myNonce = null
  let theirCommit = null
  let committed = false

  return {
    result,

    async start() {
      if (!localFp || !remoteFp) {
        done = true
        reject(new Error('fingerprints unavailable'))
        return
      }
      if (role !== 'committer') return
      myNonce = randomHex()
      committed = true
      send({ type: 'sas-commit', h: await sha256Hex(myNonce) })
    },

    handle(msg) {
      if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('sas-')) return false
      if (done) return true

      if (role === 'committer') {
        // Only the responder's nonce is expected, once, after we've committed.
        if (msg.type !== 'sas-nonce' || !committed || !HEX64.test(msg.n ?? '')) return true
        committed = false
        send({ type: 'sas-reveal', n: myNonce })
        finish(deriveCode(localFp, remoteFp, myNonce, msg.n))
        return true
      }

      // Responder
      if (msg.type === 'sas-commit' && theirCommit === null && HEX64.test(msg.h ?? '')) {
        theirCommit = msg.h
        myNonce = randomHex()
        send({ type: 'sas-nonce', n: myNonce })
      } else if (msg.type === 'sas-reveal' && theirCommit !== null && myNonce !== null) {
        const revealed = HEX64.test(msg.n ?? '') ? msg.n : ''
        finish(sha256Hex(revealed).then(h => {
          if (h !== theirCommit) throw new SafetyProtocolError('the other side broke the safety check protocol')
          return deriveCode(localFp, remoteFp, revealed, myNonce)
        }))
      }
      return true
    },
  }
}
