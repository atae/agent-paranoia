const PAGE_TITLE = document.title

// ── DOM refs ──────────────────────────────────────────────────────────────
const nameModal      = document.getElementById('nameModal')
const nameInput      = document.getElementById('nameInput')
const nameDisplayEl  = document.getElementById('nameDisplay')

const views = {
  home:    document.getElementById('viewHome'),
  lobby:   document.getElementById('viewLobby'),
  session: document.getElementById('viewSession'),
}

const roomCodeEl         = document.getElementById('roomCode')
const copyBtn            = document.getElementById('copyBtn')
const peerStatusEl       = document.getElementById('peerStatus')
const messagesEl         = document.getElementById('messages')
const chatInputEl        = document.getElementById('chatInput')
const sendBtnEl          = document.getElementById('sendBtn')
const dropzone           = document.getElementById('dropzone')
const sendQueueEl        = document.getElementById('sendQueue')
const receiveAreaEl      = document.getElementById('receiveArea')
const settingsModal      = document.getElementById('settingsModal')
const folderValueEl      = document.getElementById('folderValue')
const folderActionsEl    = document.getElementById('folderActions')
const clearFolderBtn     = document.getElementById('clearFolderBtn')
const offerModal         = document.getElementById('offerModal')
const serverBanner       = document.getElementById('serverBanner')
const leaveBtn           = document.getElementById('leaveBtn')
const safetyBar          = document.getElementById('safetyBar')

const PROGRESS_INTERVAL_MS = 250

// ── Translations ──────────────────────────────────────────────────────────
const TX = {
  createRoom:      { en: 'Create Room',                   jp: '部屋を作成' },
  or:              { en: 'or',                            jp: 'または' },
  join:            { en: 'Join',                          jp: '参加' },
  shareCode:       { en: 'Share this code with your peer:', jp: 'このコードを相手に共有:' },
  copy:            { en: 'Copy',                          jp: 'コピー' },
  copied:          { en: 'Copied!',                       jp: 'コピー完了！' },
  waitingPeer:     { en: 'Waiting for peer…',             jp: '接続待ち中…' },
  back:            { en: '← Back',                       jp: '← 戻る' },
  chat:            { en: 'Chat',                          jp: 'チャット' },
  send:            { en: 'Send',                          jp: '送信' },
  displayName:     { en: 'Display name',                  jp: '表示名' },
  ok:              { en: 'OK',                            jp: 'OK' },
  msgPlaceholder:  { en: 'Type a message…',               jp: 'メッセージを入力…' },
  namePlaceholder: { en: 'e.g. Alex',                     jp: '例: アレックス' },
  dropText:        { en: 'Drop a file here or ',          jp: 'ここにファイルをドロップ または ' },
  browse:          { en: 'browse',                        jp: '参照' },
  youAre:          { en: 'You are:',                      jp: '名前:' },
  change:          { en: 'change',                        jp: '変更' },
  waitingStatus:   { en: '● Waiting for peer',            jp: '● 接続待ち' },
  disconnected:    { en: '● Peer disconnected',           jp: '● 切断されました' },
  connected:       { en: 'Connected',                     jp: '接続済み' },
  connectedTo:     { en: 'Connected to',                  jp: 'と接続中' },
  queued:          { en: 'Queued',                        jp: '待機中' },
  sending:         { en: 'Sending',                       jp: '送信中' },
  sent:            { en: 'Sent',                          jp: '送信完了' },
  errorLabel:      { en: 'Error',                         jp: 'エラー' },
  receiving:       { en: 'Receiving',                     jp: '受信中' },
  received:        { en: 'Received',                      jp: '受信完了' },
  stalled:         { en: 'Stalled',                       jp: '停止' },
  save:            { en: '[Save]',                        jp: '[保存]' },
  settings:        { en: 'Settings',                      jp: '設定' },
  downloadFolder:  { en: 'Download folder',               jp: '保存先フォルダ' },
  folderNotSet:    { en: 'Not set. Received files stay in memory until you click [Save], so very large files can crash the tab.',
                     jp: '未設定。受信したファイルは[保存]を押すまでメモリに保持されるため、大きなファイルではタブがクラッシュすることがあります。' },
  folderUnsupported: { en: "This browser can't save straight to a folder (Chrome and Edge can). Received files stay in memory until you click [Save].",
                     jp: 'このブラウザはフォルダへの直接保存に対応していません（Chrome・Edgeは対応）。受信したファイルは[保存]を押すまでメモリに保持されます。' },
  chooseFolder:    { en: 'Choose folder…',                jp: 'フォルダを選択…' },
  changeFolder:    { en: 'Change folder…',                jp: 'フォルダを変更…' },
  clearFolder:     { en: 'Clear',                         jp: 'クリア' },
  close:           { en: 'Close',                         jp: '閉じる' },
  incomingFile:    { en: 'Incoming file',                 jp: 'ファイル受信' },
  yourPeer:        { en: 'Your peer',                     jp: '相手' },
  saveTo:          { en: 'Will be saved to:',             jp: '保存先:' },
  saveToMemory:    { en: 'Kept in memory until you click [Save].', jp: '[保存]を押すまでメモリに保持されます。' },
  memoryWarn:      { en: 'This is a large file and no download folder is set, so it will be held in memory and may crash the tab. Set a folder in Settings to save it straight to disk.',
                     jp: '大きなファイルですが保存先フォルダが未設定のため、メモリに保持されタブがクラッシュする可能性があります。設定でフォルダを指定すると直接ディスクに保存できます。' },
  accept:          { en: 'Accept',                        jp: '受け取る' },
  decline:         { en: 'Decline',                       jp: '断る' },
  declined:        { en: 'Declined',                      jp: '受け取り拒否' },
  saved:           { en: 'Saved',                         jp: '保存完了' },
  failed:          { en: 'Failed',                        jp: '失敗' },
  awaitingAccept:  { en: 'Waiting for them to accept',    jp: '相手の承認待ち' },
  leave:           { en: 'Leave',                         jp: '退出' },
  leaveTitle:      { en: 'Leave and wipe this session (press Esc 3 times)', jp: '退出してこのセッションを消去（Escを3回）' },
  serverOffline:   { en: 'Server offline: you can\'t create or join rooms until it\'s back.',
                     jp: 'サーバーがオフラインです。復旧するまで部屋の作成・参加はできません。' },
  serverOfflineInCall: { en: 'Server offline: this call keeps working, but don\'t reload the page.',
                     jp: 'サーバーがオフラインです。通話は継続しますが、ページを再読み込みしないでください。' },
  sendingMedia:    { en: 'sending',                       jp: '送信中' },
  receivingMedia:  { en: 'receiving',                     jp: '受信中' },
  mediaFailed:     { en: 'failed',                        jp: '失敗' },
  safetyCode:      { en: 'Safety code',                   jp: '安全確認コード' },
  safetyWorking:   { en: 'Safety code: working…',         jp: '安全確認コード：計算中…' },
  safetyMatch:     { en: 'They match',                    jp: '一致した' },
  safetyNoMatch:   { en: "They don't match",              jp: '一致しない' },
  safetyVerified:  { en: '✓ Safety code verified',        jp: '✓ 安全確認コード照合済み' },
  safetyWarnTitle: { en: '⚠ Possible interception',       jp: '⚠ 傍受の可能性' },
  safetyMismatch:  { en: "Your codes don't match. Someone may be intercepting this connection. Don't send anything sensitive: leave and start a new room.",
                     jp: 'コードが一致しません。この接続が傍受されている可能性があります。大事な内容は送らず、退出して新しい部屋を作ってください。' },
  safetyProtocol:  { en: 'The safety check failed because the other side broke its rules. Treat this connection as compromised: leave and start a new room.',
                     jp: '相手側が手順を守らなかったため、安全確認に失敗しました。この接続は危険とみなし、退出して新しい部屋を作ってください。' },
  leaveNow:        { en: 'Leave now',                     jp: '今すぐ退出' },
  safetyNeedsHttps:{ en: 'Safety code unavailable: it needs the page to be opened over HTTPS.',
                     jp: '安全確認コードを利用できません（HTTPSで開く必要があります）。' },
  safetyNoReply:   { en: "Safety code unavailable: the other side didn't respond (an older version of the app?).",
                     jp: '安全確認コードを利用できません。相手から応答がありません（古いバージョンの可能性）。' },
  theOtherPerson:  { en: 'the other person',              jp: '相手' },
}

// Above this size, warn before holding a file in memory.
const MEMORY_WARN_BYTES = 500 * 1024 ** 2

function t(key) {
  const lang = document.body.classList.contains('jp') ? 'jp' : 'en'
  return TX[key]?.[lang] ?? key
}

function applyTranslations() {
  document.getElementById('createBtn').textContent              = t('createRoom')
  document.querySelector('.or-divider').textContent             = t('or')
  document.getElementById('joinBtn').textContent                = t('join')
  document.querySelector('#viewLobby .muted').textContent       = t('shareCode')
  copyBtn.textContent                                           = t('copy')
  document.querySelector('.lobby-waiting .muted').textContent   = t('waitingPeer')
  document.getElementById('cancelLobbyBtn').textContent         = t('back')
  document.querySelector('.panel-header > span').textContent    = t('chat')
  sendBtnEl.textContent                                         = t('send')
  document.querySelector('label[for="nameInput"]').textContent  = t('displayName')
  document.getElementById('nameSubmit').textContent             = t('ok')
  chatInputEl.placeholder                                       = t('msgPlaceholder')
  nameInput.placeholder                                         = t('namePlaceholder')
  document.getElementById('dropText').textContent               = t('dropText')
  document.getElementById('browseLabel').textContent            = t('browse')
  peerStatusEl.textContent = peerStatusLabel(_peerState, _peerName)
  if (_localName) renderNameDisplay()
  document.getElementById('settingsBtn').textContent      = t('settings')
  document.getElementById('settingsTitle').textContent    = t('settings')
  document.getElementById('folderLabel').textContent      = t('downloadFolder')
  clearFolderBtn.textContent                              = t('clearFolder')
  document.getElementById('closeSettingsBtn').textContent = t('close')
  document.getElementById('offerTitle').textContent       = t('incomingFile')
  document.getElementById('acceptBtn').textContent        = t('accept')
  document.getElementById('declineBtn').textContent       = t('decline')
  leaveBtn.textContent = t('leave')
  leaveBtn.title = t('leaveTitle')
  renderFolder()
  renderServerBanner()
  renderSafety()
}

// ── State ─────────────────────────────────────────────────────────────────
let _cbs = {}
let _localName = localStorage.getItem('displayName') || ''
let _roomId = null
let _lastSendUpdate = 0
let _lastRecvUpdate = 0
let _peerState = 'waiting'
let _peerName  = null
let _folderName = null
let _folderSupported = false
let _offerResolve = null   // pending answer for the open incoming-file dialog
let _serverOnline = true
let _safety = { state: 'hidden', code: null, peer: null }
let _bannerTimer = null
const _mediaItems = new Map()   // key → { el, captionEl, mediaEl, name }
const _objectUrls = new Set()   // revoked when the session is wiped

// Send items: array of { fileName, state, el, labelEl, progressEl }
// state: 'queued' | 'active' | 'done' | 'error'
const _sendItems = []
let _recvItem = null   // current receive progress element

// ── Helpers ───────────────────────────────────────────────────────────────
function peerStatusLabel(state, peerName) {
  const jp = document.body.classList.contains('jp')
  if (state === 'connected') {
    return peerName
      ? `● ${jp ? `${peerName} ${t('connectedTo')}` : `${t('connectedTo')} ${peerName}`}`
      : `● ${t('connected')}`
  }
  return { waiting: t('waitingStatus'), disconnected: t('disconnected') }[state] ?? state
}

function renderFolder() {
  const chooseBtn = document.getElementById('chooseFolderBtn')
  folderActionsEl.hidden = !_folderSupported
  clearFolderBtn.hidden = !_folderName
  chooseBtn.textContent = t(_folderName ? 'changeFolder' : 'chooseFolder')
  folderValueEl.classList.toggle('unset', !_folderName)
  folderValueEl.textContent = !_folderSupported ? t('folderUnsupported')
    : _folderName ? `📁 ${_folderName}` : t('folderNotSet')
}

function renderServerBanner() {
  serverBanner.hidden = _serverOnline
  if (_serverOnline) return
  serverBanner.textContent = t(!views.session.hidden && _peerState === 'connected' ? 'serverOfflineInCall' : 'serverOffline')
}

function compareHint(peer) {
  const jp = document.body.classList.contains('jp')
  const who = peer || t('theOtherPerson')
  return jp
    ? `${who}と、このアプリ以外の方法（通話・対面・別のメッセンジャー）でコードを読み合わせてください。両方の画面が同じなら、間に誰もいません。`
    : `Read this out to ${who} outside this app: on a call, in person, or in another messenger. If both screens show the same code, nobody is in the middle.`
}

function renderSafety() {
  const { state, code, peer } = _safety
  const jp = document.body.classList.contains('jp')
  safetyBar.hidden = state === 'hidden'
  if (state === 'hidden') return
  const $ = id => document.getElementById(id)
  const emoji = code ? code.map(s => s.emoji).join(' ') : ''
  const words = code ? code.map(s => jp ? s.jp : s.en).join(jp ? '・' : ' · ') : ''
  const show = (el, on) => { el.hidden = !on }

  safetyBar.className = 'safety-bar' +
    (state === 'verified' ? ' verified' : state === 'mismatch' || state === 'failed' ? ' danger' : state === 'ready' ? '' : ' muted')
  $('safetyTitle').textContent = {
    working: t('safetyWorking'), ready: t('safetyCode'), verified: t('safetyVerified'),
    mismatch: t('safetyWarnTitle'), failed: t('safetyWarnTitle'),
    https: t('safetyNeedsHttps'), noreply: t('safetyNoReply'),
  }[state]
  $('safetyEmoji').textContent = state === 'ready' || state === 'verified' || state === 'mismatch' ? emoji : ''
  $('safetyWords').textContent = state === 'ready' ? words : ''
  $('safetyText').textContent =
    state === 'ready' ? compareHint(peer) :
    state === 'mismatch' ? t('safetyMismatch') :
    state === 'failed' ? t('safetyProtocol') : ''
  show($('safetyWords'), state === 'ready')
  show($('safetyText'), ['ready', 'mismatch', 'failed'].includes(state))
  show($('safetyActions'), ['ready', 'mismatch', 'failed'].includes(state))
  show($('safetyMatchBtn'), state === 'ready')
  show($('safetyMismatchBtn'), state === 'ready')
  show($('safetyLeaveBtn'), state === 'mismatch' || state === 'failed')
  $('safetyMatchBtn').textContent = t('safetyMatch')
  $('safetyMismatchBtn').textContent = t('safetyNoMatch')
  $('safetyLeaveBtn').textContent = t('leaveNow')
}

function setSafety(state, extra = {}) {
  _safety = { ..._safety, ...extra, state }
  renderSafety()
}

function trackUrl(blob) {
  const url = URL.createObjectURL(blob)
  _objectUrls.add(url)
  return url
}

function mediaCaption(item, text) {
  item.captionEl.textContent = text
}

function answerOffer(accepted) {
  const resolve = _offerResolve
  _offerResolve = null
  offerModal.hidden = true
  resolve?.(accepted)
}

function speedSuffix(speed) {
  const s = fmtSpeed(speed)
  return s ? ` @ ${s}` : ''
}

function setView(name) {
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name
}

function renderNameDisplay() {
  nameDisplayEl.textContent = `${t('youAre')} ${_localName} · `
  const a = document.createElement('a')
  a.textContent = t('change')
  a.href = '#'
  a.addEventListener('click', e => {
    e.preventDefault()
    nameInput.value = _localName
    nameModal.style.display = 'flex'
    nameInput.select()
  })
  nameDisplayEl.appendChild(a)
}

function applyName(raw) {
  _localName = raw.trim() || 'Anonymous'
  localStorage.setItem('displayName', _localName)
  nameModal.style.display = 'none'
  renderNameDisplay()
  _cbs.onNameChanged?.(_localName)
}

function fmt(bytes) {
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3)  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function fmtSpeed(bps) {
  if (!bps || bps < 1)    return ''
  if (bps < 1024)         return `${bps.toFixed(0)} B/s`
  if (bps < 1024 ** 2)    return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1024 ** 2).toFixed(1)} MB/s`
}

function makeSendItem(fileName, state) {
  const el = document.createElement('div')
  el.className = `transfer-item ${state}`
  const labelEl = document.createElement('div')
  labelEl.className = 't-label'
  const progressEl = document.createElement('progress')
  progressEl.max = 100
  progressEl.value = 0
  el.append(labelEl, progressEl)
  sendQueueEl.appendChild(el)
  const item = { fileName, state, el, labelEl, progressEl }
  _sendItems.push(item)
  return item
}

function findActiveSend(fileName) {
  return _sendItems.find(i => i.fileName === fileName && (i.state === 'queued' || i.state === 'active'))
}

// ── Public API ────────────────────────────────────────────────────────────
export const UI = {
  init(callbacks) {
    _cbs = callbacks

    // Theme toggle
    const themeToggle = document.getElementById('themeToggle')
    if (localStorage.getItem('theme') === 'jp') {
      document.body.classList.add('jp')
      themeToggle.textContent = '英語'
      applyTranslations()
    }
    themeToggle.addEventListener('click', () => {
      const jp = document.body.classList.toggle('jp')
      themeToggle.textContent = jp ? '英語' : '日本語'
      localStorage.setItem('theme', jp ? 'jp' : 'default')
      applyTranslations()
    })

    // Name modal
    if (_localName) {
      nameModal.style.display = 'none'
      renderNameDisplay()
    } else {
      nameInput.focus()
    }
    document.getElementById('nameSubmit').addEventListener('click', () => applyName(nameInput.value))
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyName(nameInput.value) })

    // Home buttons
    document.getElementById('createBtn').addEventListener('click', () => _cbs.onCreateRoom?.())
    const joinAction = () => {
      const raw = document.getElementById('roomInput').value.replace(/-/g, '').trim()
      if (raw) _cbs.onJoinRoom?.(raw)
    }
    document.getElementById('joinBtn').addEventListener('click', joinAction)
    const roomInput = document.getElementById('roomInput')
    roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinAction() })
    roomInput.addEventListener('input', e => {
      const digits = e.target.value.replace(/-/g, '').toUpperCase().slice(0, 6)
      e.target.value = digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits
    })

    // Lobby back
    document.getElementById('cancelLobbyBtn').addEventListener('click', () => _cbs.onCancelLobby?.())

    // Lobby copy
    copyBtn.addEventListener('click', () => {
      if (!_roomId) return
      navigator.clipboard.writeText(_roomId).then(() => {
        copyBtn.textContent = t('copied')
        setTimeout(() => { copyBtn.textContent = t('copy') }, 2000)
      })
    })

    // Chat
    const sendMessage = () => {
      const text = chatInputEl.value.trim()
      if (!text) return
      _cbs.onSendMessage?.(text)
      chatInputEl.value = ''
    }
    sendBtnEl.addEventListener('click', sendMessage)
    chatInputEl.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage() })

    // Export
    document.getElementById('exportTxtBtn').addEventListener('click',  () => _cbs.onExport?.('txt'))
    document.getElementById('exportJsonBtn').addEventListener('click', () => _cbs.onExport?.('json'))
    document.getElementById('exportHtmlBtn').addEventListener('click', () => _cbs.onExport?.('html'))

    // File drop / browse
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('over') })
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'))
    dropzone.addEventListener('drop', e => {
      e.preventDefault()
      dropzone.classList.remove('over')
      for (const file of e.dataTransfer.files) _cbs.onSendFile?.(file)
    })
    dropzone.addEventListener('click', () => document.getElementById('fileInput').click())

    // Settings
    document.getElementById('settingsBtn').addEventListener('click', () => {
      renderFolder()
      settingsModal.hidden = false
    })
    const closeSettings = () => { settingsModal.hidden = true }
    document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings)
    settingsModal.addEventListener('click', e => { if (e.target === settingsModal) closeSettings() })
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !settingsModal.hidden) closeSettings() })
    document.getElementById('chooseFolderBtn').addEventListener('click', () => _cbs.onChooseFolder?.())
    clearFolderBtn.addEventListener('click', () => _cbs.onClearFolder?.())

    // Safety code buttons
    document.getElementById('safetyMatchBtn').addEventListener('click', () => setSafety('verified'))
    document.getElementById('safetyMismatchBtn').addEventListener('click', () => setSafety('mismatch'))
    document.getElementById('safetyLeaveBtn').addEventListener('click', () => _cbs.onLeave?.())

    // Leave (wipes the session). Esc three times within a second does the
    // same from anywhere — enough that it never happens by accident.
    leaveBtn.addEventListener('click', () => _cbs.onLeave?.())
    let escPresses = []
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || e.repeat) return
      const now = Date.now()
      escPresses = escPresses.filter(t => now - t < 1000)
      escPresses.push(now)
      if (escPresses.length >= 3 && views.home.hidden) {
        escPresses = []
        _cbs.onLeave?.()
      }
    })

    // Paste or drop images/videos into the chat.
    const sendPasted = files => { if (files.length && !chatInputEl.disabled) _cbs.onPasteFiles?.(files) }
    document.addEventListener('paste', e => {
      if (views.session.hidden) return
      const files = [...(e.clipboardData?.files ?? [])]
      if (!files.length) return
      e.preventDefault()
      sendPasted(files)
    })
    const chatPanel = document.querySelector('.chat-panel')
    chatPanel.addEventListener('dragover', e => { e.preventDefault() })
    chatPanel.addEventListener('drop', e => {
      e.preventDefault()
      sendPasted([...e.dataTransfer.files])
    })

    // Incoming file dialog (no click-outside dismiss: it needs an answer)
    document.getElementById('acceptBtn').addEventListener('click', () => answerOffer(true))
    document.getElementById('declineBtn').addEventListener('click', () => answerOffer(false))
    document.getElementById('fileInput').addEventListener('change', e => {
      const file = e.target.files[0]
      if (file) _cbs.onSendFile?.(file)
      e.target.value = ''
    })
  },

  getLocalName() { return _localName },

  // Wipe all session state so stale messages/status/queue from a previous
  // connection don't bleed into the new one.
  resetSession() {
    _lastSendUpdate = 0
    _lastRecvUpdate = 0
    _peerState = 'waiting'
    _peerName  = null
    peerStatusEl.textContent = t('waitingStatus')
    peerStatusEl.className = 'status-dot waiting'
    chatInputEl.disabled = true
    sendBtnEl.disabled = true
    dropzone.classList.remove('disabled')
    messagesEl.textContent = ''
    sendQueueEl.textContent = ''
    receiveAreaEl.textContent = ''
    _sendItems.length = 0
    _recvItem = null
    _mediaItems.clear()
    setSafety('hidden', { code: null, peer: null })
    for (const url of _objectUrls) URL.revokeObjectURL(url)
    _objectUrls.clear()
    document.getElementById('roomInput').value = ''
    offerModal.hidden = true
    settingsModal.hidden = true
    document.title = PAGE_TITLE
  },

  showHome()          { setView('home'); renderServerBanner() },
  showLobby(roomId)   {
    _roomId = roomId
    roomCodeEl.textContent = roomId.slice(0, 3) + '-' + roomId.slice(3)
    copyBtn.textContent = t('copy')
    setView('lobby')
  },
  showSession()       { setView('session'); renderServerBanner() },

  setPeerStatus(state, peerName) {
    _peerState = state
    _peerName  = peerName ?? null
    peerStatusEl.textContent = peerStatusLabel(state, peerName)
    peerStatusEl.className = `status-dot ${state}`

    const on = state === 'connected'
    renderServerBanner()
    chatInputEl.disabled = !on
    sendBtnEl.disabled   = !on
    dropzone.classList.toggle('disabled', !on)

    if (state === 'disconnected') {
      for (const item of _sendItems) {
        if (item.state === 'active') item.labelEl.textContent = `${t('stalled')}: ${item.fileName}`
      }
      if (_recvItem) _recvItem.labelEl.textContent = `${t('stalled')}: ${_recvItem.fileName ?? '…'}`
    }
  },

  addMessage(msg) {
    const div = document.createElement('div')
    div.className = `msg ${msg.from}`
    const ts = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const who = msg.from === 'me' ? (_localName || 'You') : (msg.displayName || 'Them')

    const whoSpan = document.createElement('span')
    whoSpan.className = 'who'
    whoSpan.textContent = who

    const tsSpan = document.createElement('span')
    tsSpan.className = 'ts'
    tsSpan.textContent = ts

    div.append(whoSpan, ' ', tsSpan, ': ', msg.text)
    messagesEl.appendChild(div)
    messagesEl.scrollTop = messagesEl.scrollHeight
  },

  // Called when a file is added to the queue but sending hasn't started yet
  fileQueued(fileName) {
    const item = makeSendItem(fileName, 'queued')
    item.labelEl.textContent = `${t('queued')}: ${fileName}`
  },

  // Called just before Transfer.sendFile begins for this file
  fileStarted(fileName) {
    let item = findActiveSend(fileName)
    if (!item) item = makeSendItem(fileName, 'active')
    item.state = 'active'
    item.el.className = 'transfer-item'
    item.progressEl.value = 0
    item.labelEl.textContent = `${t('awaitingAccept')}: ${fileName}…`
  },

  updateSendProgress({ fileName, percent, bytesTransferred, totalBytes, speed }) {
    const item = findActiveSend(fileName)
    if (!item) return
    const now = Date.now()
    if (percent < 100 && now - _lastSendUpdate < PROGRESS_INTERVAL_MS) return
    _lastSendUpdate = now
    item.progressEl.value = percent
    if (percent === 100) {
      item.state = 'done'
      item.el.className = 'transfer-item done'
      item.labelEl.textContent = `${t('sent')}: ${fileName}${speed ? ` (avg ${fmtSpeed(speed)})` : ''}`
      if (!_recvItem) document.title = PAGE_TITLE
    } else {
      item.labelEl.textContent =
        `${t('sending')}: ${fileName} — ${percent}% (${fmt(bytesTransferred)} / ${fmt(totalBytes)})${speedSuffix(speed)}`
      if (!_recvItem) document.title = `↑ ${percent}% — ${PAGE_TITLE}`
    }
  },

  fileFailed(fileName, errMsg) {
    const item = findActiveSend(fileName)
    if (!item) return
    item.state = 'error'
    item.el.className = 'transfer-item error'
    item.labelEl.textContent = `${t('errorLabel')}: ${fileName} — ${errMsg}`
    if (!_recvItem) document.title = PAGE_TITLE
  },

  updateRecvProgress({ fileName, percent, bytesTransferred, totalBytes, speed }) {
    const now = Date.now()
    const throttled = percent < 100 && now - _lastRecvUpdate < PROGRESS_INTERVAL_MS
    if (!_recvItem) {
      const el = document.createElement('div')
      el.className = 'transfer-item'
      const labelEl = document.createElement('div')
      labelEl.className = 't-label'
      const progressEl = document.createElement('progress')
      progressEl.max = 100
      progressEl.value = 0
      el.append(labelEl, progressEl)
      receiveAreaEl.appendChild(el)
      _recvItem = { fileName, el, labelEl, progressEl }
    }
    if (throttled) return
    _lastRecvUpdate = now
    _recvItem.progressEl.value = percent
    _recvItem.labelEl.textContent =
      `${t('receiving')}: ${fileName} — ${percent}% (${fmt(bytesTransferred)} / ${fmt(totalBytes)})${speedSuffix(speed)}`
    document.title = `↓ ${percent}% — ${PAGE_TITLE}`
  },

  recvComplete({ fileName, blob, savedAs, speed }) {
    document.title = PAGE_TITLE
    if (!_recvItem) {
      // Empty files finish without any progress updates; give them a row too.
      UI.updateRecvProgress({ fileName, percent: 0, bytesTransferred: 0, totalBytes: 0, speed: 0 })
    }
    _recvItem.el.className = 'transfer-item done'
    _recvItem.progressEl.value = 100
    const avg = fmtSpeed(speed)
    const avgText = avg ? ` (avg ${avg})` : ''

    const nameSpan = document.createElement('span')
    if (savedAs) {
      // Already written to the chosen folder; nothing left to click.
      nameSpan.textContent = `${t('saved')}: ${_folderName ? `${_folderName}/` : ''}${savedAs}${avgText}`
    } else {
      const url = trackUrl(blob)
      nameSpan.textContent = `${t('received')}: ${fileName}${avgText}`
      const saveLink = document.createElement('a')
      saveLink.href = url
      saveLink.download = fileName
      saveLink.textContent = ` ${t('save')}`
      saveLink.style.marginLeft = '8px'
      nameSpan.appendChild(saveLink)
    }
    _recvItem.labelEl.replaceChildren(nameSpan)
    _recvItem = null
  },

  recvFailed(fileName, errMsg) {
    document.title = PAGE_TITLE
    if (!_recvItem) return
    _recvItem.el.className = 'transfer-item error'
    _recvItem.labelEl.textContent = `${t('failed')}: ${fileName} — ${errMsg}`
    _recvItem = null
  },

  fileDeclined(fileName) {
    const item = findActiveSend(fileName)
    if (!item) return
    item.state = 'error'
    item.el.className = 'transfer-item error'
    item.labelEl.textContent = `${t('declined')}: ${fileName}`
    if (!_recvItem) document.title = PAGE_TITLE
  },

  setDownloadFolder(name, supported) {
    _folderName = name
    _folderSupported = supported
    renderFolder()
  },

  // Shows the incoming-file dialog. Resolves true (accept) or false (decline).
  showOffer({ name, size, from }) {
    answerOffer(false)   // never stack dialogs
    const jp = document.body.classList.contains('jp')
    const who = from || t('yourPeer')
    document.getElementById('offerFrom').textContent =
      jp ? `${who}からファイルが届いています:` : `${who} wants to send you:`
    document.getElementById('offerFile').textContent = `${name} (${fmt(size)})`
    document.getElementById('offerDest').textContent =
      _folderName ? `${t('saveTo')} 📁 ${_folderName}` : t('saveToMemory')
    const warnEl = document.getElementById('offerWarn')
    warnEl.hidden = !!_folderName || size < MEMORY_WARN_BYTES
    warnEl.textContent = t('memoryWarn')
    offerModal.hidden = false
    document.getElementById('acceptBtn').focus()
    return new Promise(resolve => { _offerResolve = resolve })
  },

  // Peer left while the dialog was open.
  closeOffer() {
    answerOffer(false)
  },


  setServerOnline(online) {
    // Brief blips (e.g. leaving a room reconnects the socket) shouldn't flash a banner.
    clearTimeout(_bannerTimer)
    if (online) {
      _serverOnline = true
      renderServerBanner()
    } else {
      _bannerTimer = setTimeout(() => { _serverOnline = false; renderServerBanner() }, 1500)
    }
  },

  // A pasted/dropped image or video, ours ('me') or theirs ('them').
  // For our own, pass the file so it shows immediately.
  mediaStarted({ key, from, displayName, name, size, file }) {
    const div = document.createElement('div')
    div.className = `msg ${from}`
    const whoSpan = document.createElement('span')
    whoSpan.className = 'who'
    whoSpan.textContent = from === 'me' ? (_localName || 'You') : (displayName || 'Them')
    const tsSpan = document.createElement('span')
    tsSpan.className = 'ts'
    tsSpan.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const mediaEl = document.createElement('span')
    mediaEl.className = 'media'
    const captionEl = document.createElement('span')
    captionEl.className = 'media-caption'
    div.append(whoSpan, ' ', tsSpan, ':', mediaEl, captionEl)
    messagesEl.appendChild(div)
    const item = { el: div, captionEl, mediaEl, name, size }
    _mediaItems.set(key, item)
    mediaCaption(item, `${name} (${fmt(size)}) — ${t(from === 'me' ? 'sendingMedia' : 'receivingMedia')} 0%`)
    if (file) UI.mediaShow(key, file)
    messagesEl.scrollTop = messagesEl.scrollHeight
  },

  mediaProgress(key, percent) {
    const item = _mediaItems.get(key)
    if (!item) return
    const from = item.el.classList.contains('me') ? 'sendingMedia' : 'receivingMedia'
    mediaCaption(item, `${item.name} (${fmt(item.size)}) — ${t(from)} ${percent}%`)
  },

  // Show the media element (blob is the received data, or our own file).
  mediaShow(key, blob) {
    const item = _mediaItems.get(key)
    if (!item) return
    const url = trackUrl(blob)
    const isVideo = blob.type.startsWith('video/')
    const el = document.createElement(isVideo ? 'video' : 'img')
    el.src = url
    if (isVideo) { el.controls = true; el.preload = 'metadata'; el.playsInline = true }
    else el.alt = item.name
    // Click to enlarge in place (never opens the blob in a new tab).
    if (!isVideo) el.addEventListener('click', () => item.mediaEl.classList.toggle('expanded'))
    el.addEventListener('load', () => { messagesEl.scrollTop = messagesEl.scrollHeight }, { once: true })
    item.mediaEl.replaceChildren(el)
    item.url = url
  },

  mediaDone(key) {
    const item = _mediaItems.get(key)
    if (!item) return
    item.captionEl.textContent = `${item.name} (${fmt(item.size)})`
    if (item.url) {
      const save = document.createElement('a')
      save.href = item.url
      save.download = item.name
      save.textContent = t('save')
      item.captionEl.append(' ', save)
    }
  },

  mediaFailed(key, message) {
    const item = _mediaItems.get(key)
    if (!item) return
    item.el.classList.add('media-failed')
    item.mediaEl.replaceChildren()
    mediaCaption(item, `${item.name} — ${t('mediaFailed')}: ${message}`)
  },


  // Safety code panel: 'working' → 'ready' (code shown) → 'verified' / 'mismatch';
  // 'failed' if the other side cheats; 'https' / 'noreply' when unavailable.
  safetyWorking()            { setSafety('working', { code: null }) },
  safetyReady(code, peer)    { setSafety('ready', { code, peer }) },
  safetyFailed()             { setSafety('failed') },
  safetyUnavailable(reason)  { setSafety(reason === 'https' ? 'https' : 'noreply') },

}
