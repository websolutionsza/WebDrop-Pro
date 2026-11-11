// ============================================================================
// app.js - main UI orchestration for WebDrop Pro
// Coordinates signaling, WebRTC, QR, and ZIP modules.
// ============================================================================

import { SignalingClient, generatePeerId, generateSessionCode, formatSessionCode, cleanSessionCode } from './signaling.js';
import { WebDropConnection, sha256 } from './webrtc.js';
import { generateQR, buildQRPayload, QRScanner, parseQRPayload } from './qr.js';
import { createZip } from './zip.js';

// Inline SVG icons (no Font Awesome, no Lucide library).
const ICONS = {
  sun: '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
  moon: '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  copy: '<svg class="svg-icon sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  check: '<svg class="svg-icon sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
  download: '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
  paperclip: '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11l-9.5 9.5a5 5 0 0 1-7.1-7.1l9.5-9.5a3.5 3.5 0 0 1 5 5l-9.5 9.5a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>',
  times: '<svg class="svg-icon sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  file: '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>'
};

// TipNest support button placeholder. Empty string = button hidden.
// Set this to your TipNest URL when TipNest is ready.
const TIPNEST_URL = "";

// Connection status text for the indicator.
const STATUS_TEXT = {
  idle: 'Idle, awaiting connection',
  scanning: 'Scanning for peers...',
  connecting: 'Connecting...',
  connected: 'Connected',
  disconnected: 'Disconnected',
  failed: 'Connection failed',
  backendUnavailable: 'Backend temporarily unavailable'
};

const CONNECTION_TYPE_TEXT = {
  local: 'Local network connection',
  direct: 'Direct internet P2P',
  turn: 'TURN-relayed connection',
  unknown: 'Connected'
};

// Application state.
const state = {
  peerId: null,
  sessionCode: null,
  role: null,                 // 'sender' | 'receiver' | null
  signaling: null,            // SignalingClient instance
  connection: null,           // WebDropConnection instance
  iceServers: [],
  transferInProgress: false
};

// DOM references (populated on DOMContentLoaded).
let dom = {};

// ============================================================================
// Theme toggle (light/dark, persisted in localStorage)
// ============================================================================
const THEME_KEY = 'webdrop-theme';

function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const btn = dom.themeToggle;
  if (btn) {
    btn.innerHTML = dark ? ICONS.sun : ICONS.moon;
    btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  }
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (_) {}
  let dark;
  if (saved === 'dark') dark = true;
  else if (saved === 'light') dark = false;
  else dark = true; // default to dark utilitarian
  applyTheme(dark);
  dom.themeToggle?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = !current;
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next ? 'dark' : 'light'); } catch (_) {}
  });
}

// ============================================================================
// Device name + avatar
// ============================================================================
const DEVICE_KEY = 'webdrop-deviceName';

function initDeviceName() {
  let saved = null;
  try { saved = localStorage.getItem(DEVICE_KEY); } catch (_) {}
  if (saved) dom.deviceNameInput.value = saved;
  updateAvatar();
  dom.deviceNameInput.addEventListener('input', updateAvatar);
  dom.deviceNameInput.addEventListener('change', () => {
    try { localStorage.setItem(DEVICE_KEY, dom.deviceNameInput.value.trim() || 'My Device'); } catch (_) {}
  });
}

function updateAvatar() {
  const name = (dom.deviceNameInput.value || 'Device').trim();
  const initials = name.split(/\s+/).map(w => w[0] || '').join('').toUpperCase().slice(0, 2);
  dom.avatarDisplay.textContent = initials || 'DV';
}

// ============================================================================
// Cookie consent
// ============================================================================
function initCookieConsent() {
  try {
    if (localStorage.getItem('cookiesAccepted') === 'true') {
      dom.cookieConsent.classList.add('hidden');
    }
  } catch (_) {}
  dom.acceptCookiesBtn.addEventListener('click', () => {
    try { localStorage.setItem('cookiesAccepted', 'true'); } catch (_) {}
    dom.cookieConsent.classList.add('hidden');
  });
}

// ============================================================================
// Load TURN credentials from the backend (served via Cloudflare Function)
// ============================================================================
async function loadIceServers() {
  try {
    const res = await fetch('/api/turn-credentials');
    const data = await res.json();
    if (data.ok && data.iceServers) {
      state.iceServers = data.iceServers;
    }
  } catch (e) {
    console.warn('TURN credentials fetch failed, using STUN only:', e.message);
    state.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
  }
}

// ============================================================================
// Helpers
// ============================================================================
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(1) + ' GB';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function setScannerState(stateKey) {
  if (dom.scannerState) dom.scannerState.textContent = STATUS_TEXT[stateKey] || stateKey;
}

function setConnectionType(type) {
  const text = CONNECTION_TYPE_TEXT[type] || CONNECTION_TYPE_TEXT.unknown;
  if (dom.connectionType) {
    dom.connectionType.textContent = text;
    dom.connectionType.dataset.type = type;
  }
  if (dom.connectionTypeTransfer) {
    dom.connectionTypeTransfer.textContent = text;
    dom.connectionTypeTransfer.dataset.type = type;
  }
}

// ============================================================================
// Chat message helpers
// ============================================================================
function addMessage(sender, text, type) {
  const div = document.createElement('div');
  div.className = 'message ' + type;
  if (type === 'system') {
    div.textContent = text;
  } else {
    const header = document.createElement('div');
    header.className = 'message-header';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'message-sender';
    nameSpan.textContent = sender + ':';
    header.appendChild(nameSpan);
    if (type === 'received') {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-msg-btn';
      copyBtn.type = 'button';
      copyBtn.innerHTML = ICONS.copy;
      copyBtn.setAttribute('aria-label', 'Copy message text');
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const doCopy = () => {
          copyBtn.innerHTML = ICONS.check;
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.innerHTML = ICONS.copy;
            copyBtn.classList.remove('copied');
          }, 1500);
        };
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(doCopy).catch(doCopy);
        } else {
          doCopy();
        }
      });
      header.appendChild(copyBtn);
    }
    div.appendChild(header);
    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = text;
    div.appendChild(content);
  }
  dom.chatBox.appendChild(div);
  dom.chatBox.scrollTop = dom.chatBox.scrollHeight;
}

function systemMessage(text) {
  addMessage('System', text, 'system');
}

// ============================================================================
// Transfer UI show/hide
// ============================================================================
function showTransferUI() {
  dom.setupArea.style.display = 'none';
  dom.transferArea.classList.add('active');
  dom.chatBox.innerHTML = '';
  setScannerState('connected');
}

function resetUI() {
  if (state.connection) {
    try { state.connection.close(); } catch (_) {}
    state.connection = null;
  }
  if (state.signaling) {
    state.signaling.stopPolling();
    state.signaling = null;
  }
  state.role = null;
  state.sessionCode = null;
  dom.setupArea.style.display = 'block';
  dom.transferArea.classList.remove('active');
  dom.chatBox.innerHTML = '';
  setScannerState('idle');
  setConnectionType('unknown');
}

// ============================================================================
// WebRTC connection setup
// ============================================================================
function setupConnection(remotePeerId) {
  const conn = new WebDropConnection(state.peerId, state.iceServers);
  conn.remotePeerId = remotePeerId;

  conn.onIceCandidate = (candidate) => {
    // Send each ICE candidate to the remote peer via signaling.
    state.signaling.writeMessage(remotePeerId, 'ice', JSON.stringify(candidate.toJSON()));
  };

  conn.onStateChange = (webrtcState) => {
    if (webrtcState === 'connected' || webrtcState === 'completed') {
      setScannerState('connected');
    } else if (webrtcState === 'failed') {
      setScannerState('failed');
      systemMessage('Connection failed. Try refreshing.');
    } else if (webrtcState === 'disconnected') {
      setScannerState('disconnected');
      systemMessage('Connection closed.');
    }
  };

  conn.onConnectionType = (type) => {
    setConnectionType(type);
  };

  conn.onFileReceived = (info, blob) => {
    showReceivedFile(info, blob);
  };

  conn.onTextReceived = (text) => {
    addMessage('Peer', text, 'received');
  };

  conn.onTransferProgress = (transferId, sent, total) => {
    // Update progress UI if visible.
    if (dom.transferProgress && state.transferInProgress) {
      const pct = total > 0 ? Math.round((sent / total) * 100) : 0;
      dom.transferProgress.style.width = pct + '%';
      dom.transferProgressText.textContent = formatFileSize(sent) + ' / ' + formatFileSize(total);
    }
  };

  conn.onDataChannelOpen = () => {
    setScannerState('connected');
  };

  state.connection = conn;
  return conn;
}

// ============================================================================
// Sender flow: create session + show QR
// ============================================================================
async function startSenderSession() {
  state.peerId = state.peerId || generatePeerId();
  state.sessionCode = generateSessionCode();
  state.role = 'sender';

  setScannerState('scanning');

  // Create session in Neon.
  try {
    const res = await fetch('/api/session/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_code: state.sessionCode,
        creator_peer_id: state.peerId
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create session');
    }
  } catch (e) {
    setScannerState('backendUnavailable');
    systemMessage('Backend unavailable: ' + e.message);
    return;
  }

  // Set up signaling client + start polling.
  state.signaling = new SignalingClient(state.peerId, state.sessionCode);
  state.signaling.onMessage = handleSignalingMessage;
  state.signaling.onSessionError = (reason) => {
    systemMessage('Session error: ' + reason);
    resetUI();
  };
  state.signaling.startPolling();

  // Show QR modal.
  showQRModal();
}

// ============================================================================
// Receiver flow: join session via code
// ============================================================================
async function joinSession(sessionCode) {
  const code = cleanSessionCode(sessionCode);
  if (code.length !== 12) {
    systemMessage('Invalid session code. Must be 12 characters.');
    return;
  }

  state.peerId = state.peerId || generatePeerId();
  state.sessionCode = code;
  state.role = 'receiver';
  setScannerState('scanning');

  // Join the session in Neon.
  try {
    const res = await fetch('/api/session/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_code: code,
        joiner_peer_id: state.peerId
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to join session');
    }
    // We now know the creator's peer_id.
    const creatorPeerId = data.creator_peer_id;

    // Set up signaling + connection.
    state.signaling = new SignalingClient(state.peerId, code);
    state.signaling.onMessage = handleSignalingMessage;
    state.signaling.onSessionError = (reason) => {
      systemMessage('Session error: ' + reason);
      resetUI();
    };
    state.signaling.startPolling();

    // Create the WebRTC connection + offer.
    const conn = setupConnection(creatorPeerId);
    const offer = await conn.createOffer();

    // Send the offer to the creator via signaling.
    await state.signaling.writeMessage(creatorPeerId, 'offer', JSON.stringify(offer));

    showTransferUI();
    systemMessage('Connecting to sender...');
  } catch (e) {
    setScannerState('failed');
    systemMessage('Join failed: ' + e.message);
  }
}

// ============================================================================
// Handle incoming signaling messages
// ============================================================================
async function handleSignalingMessage(msg) {
  if (!state.connection) {
    // First message from the receiver is the offer (sender side).
    if (msg.message_type === 'offer') {
      const creatorPeerId = state.sessionCode ? state.peerId : null;
      const remotePeerId = msg.from_peer_id;
      const conn = setupConnection(remotePeerId);
      const offer = JSON.parse(msg.payload);
      const answer = await conn.acceptOffer(offer.sdp || offer);
      await state.signaling.writeMessage(remotePeerId, 'answer', JSON.stringify(answer));
      showTransferUI();
      systemMessage('Receiver connected. Establishing P2P link...');
    }
    return;
  }

  // Connection exists - handle answer or ICE candidates.
  if (msg.message_type === 'answer') {
    try {
      const answer = JSON.parse(msg.payload);
      await state.connection.acceptAnswer(answer.sdp || answer);
    } catch (e) {
      console.error('Failed to apply answer:', e);
    }
    return;
  }
  if (msg.message_type === 'ice') {
    try {
      const candidate = JSON.parse(msg.payload);
      await state.connection.addIceCandidate(candidate);
    } catch (e) {
      console.error('Failed to add ICE candidate:', e);
    }
    return;
  }
}

// ============================================================================
// QR modal (generation + scanning)
// ============================================================================
function showQRModal() {
  const baseUrl = window.location.origin;
  const payload = buildQRPayload(state.sessionCode, baseUrl);
  generateQR(payload, dom.qrCodeContainer);
  dom.qrStatus.textContent = 'Waiting for receiver to scan...';
  dom.qrModalOverlay.classList.add('open');

  // Display the human-readable code for manual entry.
  if (dom.qrSessionCode) {
    dom.qrSessionCode.textContent = formatSessionCode(state.sessionCode);
  }
}

function closeQRModal() {
  dom.qrModalOverlay.classList.remove('open');
}

function initQRModal() {
  dom.qrModalClose?.addEventListener('click', closeQRModal);
  dom.qrModalOverlay?.addEventListener('click', (e) => {
    if (e.target === dom.qrModalOverlay) closeQRModal();
  });
}

// ============================================================================
// QR Scanner modal
// ============================================================================
let qrScanner = null;

async function openScanner() {
  dom.scannerModalOverlay.classList.add('open');
  if (!qrScanner) {
    qrScanner = new QRScanner('qrScannerVideo');
  }
  await qrScanner.start(
    (decodedText) => {
      const parsed = parseQRPayload(decodedText);
      if (!parsed) {
        dom.qrScanError.textContent = 'Invalid QR code.';
        return;
      }
      qrScanner.stop();
      dom.scannerModalOverlay.classList.remove('open');
      joinSession(parsed.code);
    },
    (err) => {
      dom.qrScanError.innerHTML = '<strong>Camera could not be opened.</strong><br>' +
        escapeHtml(err.message || '') + '<br><br>Make sure HTTPS is enabled and camera permission granted.';
    }
  );
}

function closeScanner() {
  if (qrScanner) qrScanner.stop();
  dom.scannerModalOverlay.classList.remove('open');
}

// ============================================================================
// Manual code entry
// ============================================================================
function initManualEntry() {
  dom.manualJoinBtn?.addEventListener('click', () => {
    const code = dom.manualCodeInput.value;
    if (cleanSessionCode(code).length === 12) {
      joinSession(code);
    } else {
      systemMessage('Enter a valid 12-character code.');
    }
  });
}

// ============================================================================
// File sending (drag-drop, file tray, ZIP choice, TXT send)
// ============================================================================
function initFileHandling() {
  // File tray click-to-select.
  dom.fileInput?.addEventListener('change', (e) => handleFiles(e.target.files));
  dom.imageInput?.addEventListener('change', (e) => handleFiles(e.target.files));
  dom.videoInput?.addEventListener('change', (e) => handleFiles(e.target.files));
  dom.folderInput?.addEventListener('change', (e) => handleFiles(e.target.files));

  // Drag and drop on the whole window (only when transfer area is active).
  let dragCounter = 0;
  window.addEventListener('dragenter', (e) => {
    if (!isTransferActive()) return;
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCounter++;
    dom.dropZone.classList.add('is-dragging');
  });
  window.addEventListener('dragover', (e) => {
    if (!isTransferActive()) return;
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!isTransferActive()) return;
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) dom.dropZone.classList.remove('is-dragging');
  });
  window.addEventListener('drop', async (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCounter = 0;
    dom.dropZone.classList.remove('is-dragging');
    if (!isTransferActive()) {
      systemMessage('Connect to a peer first to drop files.');
      return;
    }
    const files = await collectDroppedFiles(e.dataTransfer);
    if (files.length) handleFiles(files);
  });

  // TXT send button.
  dom.sendTxtBtn?.addEventListener('click', sendAsTxt);
}

function isFileDrag(e) {
  if (!e.dataTransfer) return false;
  const types = e.dataTransfer.types || [];
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'Files') return true;
  }
  return false;
}

function isTransferActive() {
  return dom.transferArea && dom.transferArea.classList.contains('active');
}

async function collectDroppedFiles(dt) {
  const files = [];
  const items = dt.items;
  if (items && items.length && items[0].webkitGetAsEntry) {
    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    for (const entry of entries) {
      const entryFiles = await collectEntryFiles(entry);
      files.push(...entryFiles);
    }
  } else if (dt.files && dt.files.length) {
    for (const f of dt.files) files.push(f);
  }
  return files;
}

function collectEntryFiles(entry, prefix = '') {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((f) => {
        try {
          Object.defineProperty(f, 'webkitRelativePath', {
            value: prefix + entry.name,
            writable: false
          });
        } catch (_) {}
        resolve([f]);
      }, () => resolve([]));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      const readBatch = () => {
        reader.readEntries(async (batch) => {
          if (!batch.length) {
            const nested = await Promise.all(
              all.map(child => collectEntryFiles(child, prefix + entry.name + '/'))
            );
            resolve(nested.flat());
          } else {
            all.push(...batch);
            readBatch();
          }
        }, () => resolve([]));
      };
      readBatch();
    } else {
      resolve([]);
    }
  });
}

async function handleFiles(fileList) {
  if (!state.connection || !fileList || !fileList.length) return;
  const files = Array.from(fileList);
  if (files.length > 1) {
    showZipChoice(files);
  } else {
    await sendSingleFile(files[0]);
  }
}

async function sendSingleFile(file) {
  if (!state.connection) return;
  state.transferInProgress = true;
  showProgress(file.name, file.size);
  try {
    await state.connection.waitForDataChannel();
    await state.connection.sendFile(file);
    systemMessage('Sent: ' + file.name);
  } catch (e) {
    systemMessage('Error sending ' + file.name + ': ' + e.message);
  } finally {
    state.transferInProgress = false;
    hideProgress();
  }
}

// ============================================================================
// ZIP choice modal
// ============================================================================
function showZipChoice(files) {
  dom.zipChoiceFiles = files;
  if (dom.zipChoiceSubtitle) {
    dom.zipChoiceSubtitle.textContent = 'You selected ' + files.length +
      ' files. How would you like to send them?';
  }
  dom.zipChoiceOverlay.classList.add('open');
}

function closeZipChoice() {
  dom.zipChoiceOverlay.classList.remove('open');
  dom.zipChoiceFiles = null;
}

function initZipChoice() {
  dom.zipChoiceClose?.addEventListener('click', closeZipChoice);
  dom.zipCancelBtn?.addEventListener('click', closeZipChoice);
  dom.zipChoiceOverlay?.addEventListener('click', (e) => {
    if (e.target === dom.zipChoiceOverlay) closeZipChoice();
  });
  dom.zipChooseIndivBtn?.addEventListener('click', async () => {
    const files = dom.zipChoiceFiles;
    closeZipChoice();
    for (const file of files) {
      await sendSingleFile(file);
    }
  });
  dom.zipChooseArchiveBtn?.addEventListener('click', async () => {
    const files = dom.zipChoiceFiles;
    closeZipChoice();
    try {
      systemMessage('Creating ZIP archive...');
      const zipFile = await createZip(files);
      await sendSingleFile(zipFile);
    } catch (e) {
      systemMessage('ZIP creation failed: ' + e.message);
    }
  });
}

// ============================================================================
// Text messaging + TXT file send
// ============================================================================
function initMessaging() {
  dom.sendBtn?.addEventListener('click', sendMessage);
  dom.msgInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
}

function sendMessage() {
  const text = dom.msgInput.value.trim();
  if (!text || !state.connection) return;
  try {
    state.connection.sendText(text);
    addMessage('Me', text, 'sent');
    dom.msgInput.value = '';
  } catch (e) {
    systemMessage(e.message);
  }
}

async function sendAsTxt() {
  const text = dom.msgInput.value;
  if (!text || !state.connection) return;
  const filename = 'shared-text-' + Date.now() + '.txt';
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const file = new File([blob], filename, { type: 'text/plain;charset=utf-8' });
  dom.msgInput.value = '';
  await sendSingleFile(file);
}

// ============================================================================
// Received file display
// ============================================================================
function showReceivedFile(info, blob) {
  const url = URL.createObjectURL(blob);
  const div = document.createElement('div');
  div.className = 'message received';

  const meta = document.createElement('div');
  meta.innerHTML = '<strong>' + ICONS.paperclip + ' ' + escapeHtml(info.filename) + '</strong>' +
    '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">' +
    formatFileSize(info.filesize) +
    (info.hash ? (info.hashOk ? ' | verified' : ' | HASH MISMATCH') : '') +
    '</div>';
  div.appendChild(meta);

  if (info.hashOk === false) {
    const warn = document.createElement('div');
    warn.style.cssText = 'color:var(--danger);font-size:0.8rem;margin-top:4px;';
    warn.textContent = 'File integrity check failed. The file may be corrupted.';
    div.appendChild(warn);
  }

  const link = document.createElement('a');
  link.href = url;
  link.download = info.filename;
  link.className = 'btn btn-success';
  link.style.cssText = 'margin-top:8px;padding:6px 12px;font-size:0.8rem;display:inline-flex;align-items:center;gap:6px;';
  link.innerHTML = ICONS.download + ' Download';
  div.appendChild(link);

  if ((info.filetype || '').startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url;
    img.className = 'file-preview';
    img.style.maxHeight = '160px';
    div.appendChild(img);
  } else if ((info.filetype || '').startsWith('video/')) {
    const vid = document.createElement('video');
    vid.src = url;
    vid.controls = true;
    vid.className = 'file-preview';
    vid.style.maxHeight = '160px';
    div.appendChild(vid);
  }

  dom.chatBox.appendChild(div);
  dom.chatBox.scrollTop = dom.chatBox.scrollHeight;

  // Revoke blob URL after 5 minutes to free memory.
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 300000);
}

// ============================================================================
// Transfer progress UI
// ============================================================================
function showProgress(filename, totalSize) {
  if (!dom.transferProgressContainer) return;
  dom.transferProgressContainer.style.display = 'block';
  dom.transferProgressFilename.textContent = filename;
  dom.transferProgress.style.width = '0%';
  dom.transferProgressText.textContent = '0 / ' + formatFileSize(totalSize);
}

function hideProgress() {
  if (dom.transferProgressContainer) {
    dom.transferProgressContainer.style.display = 'none';
  }
}

// ============================================================================
// TipNest support button
// ============================================================================
function initTipNest() {
  if (!dom.tipNestBtn) return;
  if (TIPNEST_URL && TIPNEST_URL.length > 0) {
    dom.tipNestBtn.href = TIPNEST_URL;
    dom.tipNestBtn.target = '_blank';
    dom.tipNestBtn.rel = 'noopener';
    dom.tipNestBtn.style.display = '';
  } else {
    dom.tipNestBtn.style.display = 'none';
  }
}

// ============================================================================
// Connection action buttons
// ============================================================================
function initActionButtons() {
  dom.disconnectBtn?.addEventListener('click', () => {
    resetUI();
    systemMessage('Disconnected.');
  });
  dom.qrOpenBtn?.addEventListener('click', startSenderSession);
  dom.scanOpenBtn?.addEventListener('click', openScanner);
  dom.scannerClose?.addEventListener('click', closeScanner);
  dom.scannerModalOverlay?.addEventListener('click', (e) => {
    if (e.target === dom.scannerModalOverlay) closeScanner();
  });

  // Copy session code from QR modal.
  dom.copyCodeBtn?.addEventListener('click', () => {
    if (state.sessionCode) {
      const text = formatSessionCode(state.sessionCode);
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          dom.copyCodeBtn.innerHTML = ICONS.check;
          setTimeout(() => { dom.copyCodeBtn.innerHTML = ICONS.copy; }, 1500);
        });
      }
    }
  });

  // Check URL for ?join=CODE (receiver flow via link).
  const params = new URLSearchParams(window.location.search);
  const joinCode = params.get('join');
  if (joinCode && cleanSessionCode(joinCode).length === 12) {
    joinSession(joinCode);
  }
}

// ============================================================================
// Init
// ============================================================================
function collectDomRefs() {
  dom = {
    themeToggle: document.getElementById('themeToggle'),
    deviceNameInput: document.getElementById('deviceNameInput'),
    avatarDisplay: document.getElementById('avatarDisplay'),
    cookieConsent: document.getElementById('cookieConsent'),
    acceptCookiesBtn: document.getElementById('acceptCookiesBtn'),
    setupArea: document.getElementById('setupArea'),
    transferArea: document.getElementById('transferArea'),
    scannerState: document.getElementById('scannerState'),
    connectionType: document.getElementById('connectionType'),
    connectionTypeTransfer: document.getElementById('connectionTypeTransfer'),
    disconnectBtn: document.getElementById('disconnectBtn'),
    qrOpenBtn: document.getElementById('qrOpenBtn'),
    scanOpenBtn: document.getElementById('scanOpenBtn'),
    qrModalOverlay: document.getElementById('qrModalOverlay'),
    qrModalClose: document.getElementById('qrModalClose'),
    qrCodeContainer: document.getElementById('qrCodeContainer'),
    qrStatus: document.getElementById('qrStatus'),
    qrSessionCode: document.getElementById('qrSessionCode'),
    copyCodeBtn: document.getElementById('copyCodeBtn'),
    scannerModalOverlay: document.getElementById('scannerModalOverlay'),
    scannerClose: document.getElementById('scannerClose'),
    qrScanError: document.getElementById('qrScanError'),
    manualCodeInput: document.getElementById('manualCodeInput'),
    manualJoinBtn: document.getElementById('manualJoinBtn'),
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    imageInput: document.getElementById('imageInput'),
    videoInput: document.getElementById('videoInput'),
    folderInput: document.getElementById('folderInput'),
    zipChoiceOverlay: document.getElementById('zipChoiceOverlay'),
    zipChoiceClose: document.getElementById('zipChoiceClose'),
    zipCancelBtn: document.getElementById('zipCancelBtn'),
    zipChooseIndivBtn: document.getElementById('zipChooseIndivBtn'),
    zipChooseArchiveBtn: document.getElementById('zipChooseArchiveBtn'),
    zipChoiceSubtitle: document.getElementById('zipChoiceSubtitle'),
    chatBox: document.getElementById('chatBox'),
    msgInput: document.getElementById('msgInput'),
    sendBtn: document.getElementById('sendBtn'),
    sendTxtBtn: document.getElementById('sendTxtBtn'),
    transferProgressContainer: document.getElementById('transferProgressContainer'),
    transferProgress: document.getElementById('transferProgress'),
    transferProgressFilename: document.getElementById('transferProgressFilename'),
    transferProgressText: document.getElementById('transferProgressText'),
    tipNestBtn: document.getElementById('tipNestBtn'),
    footerYear: document.getElementById('footerYear')
  };
  dom.zipChoiceFiles = null;
}

function init() {
  collectDomRefs();
  if (dom.footerYear) dom.footerYear.textContent = new Date().getFullYear();

  state.peerId = generatePeerId();

  initTheme();
  initDeviceName();
  initCookieConsent();
  initActionButtons();
  initQRModal();
  initManualEntry();
  initFileHandling();
  initZipChoice();
  initMessaging();
  initTipNest();

  loadIceServers();
  setScannerState('idle');
  setConnectionType('unknown');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
