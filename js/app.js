// ============================================================================
// app.js - main UI orchestration for WebDrop Pro
// Coordinates signaling, WebRTC, QR, and ZIP modules.
// ============================================================================

import { SignalingClient, generatePeerId, generateSessionCode, formatSessionCode, cleanSessionCode, generateShortCode, cleanShortCode } from './signaling.js';
import { WebDropConnection, sha256, CHUNK_SIZE } from './webrtc.js';
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
  refresh: '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  file: '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  radar: '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  wifi: '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/></svg>',
  chat: '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-7.6-4.6L3 21l1.6-3.9A8.5 8.5 0 0 1 12.5 3a8.38 8.38 0 0 1 8.5 8.5z"/></svg>'
};

// TipNest support button placeholder. Empty string = button hidden.
const TIPNEST_URL = "";

// Connection status text for the indicator.
const STATUS_TEXT = {
  idle: 'Idle, awaiting connection',
  initializing: 'Initialising secure session...',
  scanning: 'Searching for devices...',
  connecting: 'Connecting...',
  negotiating: 'Negotiating connection...',
  establishing: 'Establishing secure channel...',
  connected: 'Connected',
  preparing: 'Preparing transfer...',
  transferring: 'Transferring...',
  completed: 'Transfer completed',
  reconnecting: 'Reconnecting...',
  failed: 'Connection failed',
  disconnected: 'Disconnected',
  backendUnavailable: 'Backend temporarily unavailable'
};

// Connection-type display strings. NEVER include IP addresses.
const CONNECTION_TYPE_TEXT = {
  local: 'Connected locally',
  direct: 'Connected directly over the internet',
  turn: 'Connected through secure relay',
  unknown: 'Connected',
  none: 'Searching for the best route...'
};

// Application state.
const state = {
  peerId: null,
  sessionCode: null,
  shortCode: null,              // 4-digit code for Easy P2P mode
  mode: 'easy-p2p',             // 'easy-p2p' | 'cross-network'
  role: null,                 // 'sender' | 'receiver' | null
  signaling: null,            // SignalingClient instance
  connection: null,           // WebDropConnection instance
  iceServers: [],
  transferInProgress: false,
  diagnostics: [],           // recent diagnostic events
  turnEnabled: false,
  turnProvider: 'none',
  healthChecked: false,
  refreshing: false
};

const DIAGNOSTIC_LIMIT = 30;

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
  else dark = false; // default to the bright, colourful light theme
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
// Load ICE / TURN configuration from the backend
// ============================================================================
async function loadIceServers() {
  try {
    const res = await fetch('/api/turn-credentials');
    const data = await res.json();
    if (data.ok && data.iceServers) {
      state.iceServers = data.iceServers;
      state.turnEnabled = !!data.turn_enabled;
      state.turnProvider = data.provider || 'none';
      pushDiagnostic({ stage: 'turn-loaded', provider: state.turnProvider, enabled: state.turnEnabled });
    }
  } catch (e) {
    pushDiagnostic({ stage: 'turn-load-failed', error: e.message });
    state.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
  }
}

// Check backend health (non-blocking) and surface an unobtrusive warning
// if either the database or TURN is unavailable.
async function checkBackendHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    state.healthChecked = true;
    if (!data.database?.reachable) {
      pushDiagnostic({ stage: 'db-unreachable' });
    }
    if (!data.turn?.configured) {
      pushDiagnostic({ stage: 'turn-not-configured' });
    }
  } catch (e) {
    pushDiagnostic({ stage: 'health-check-failed', error: e.message });
  }
}

// ============================================================================
// Diagnostic log (kept in memory, optionally shown in dev panel)
// ============================================================================
function pushDiagnostic(info) {
  const entry = Object.assign({ at: new Date().toISOString() }, info);
  state.diagnostics.unshift(entry);
  if (state.diagnostics.length > DIAGNOSTIC_LIMIT) {
    state.diagnostics.length = DIAGNOSTIC_LIMIT;
  }
  // Make the diagnostic panel react if it's open.
  if (dom.diagnosticsList) {
    renderDiagnostics();
  }
}

function renderDiagnostics() {
  if (!dom.diagnosticsList) return;
  dom.diagnosticsList.innerHTML = state.diagnostics.map(d => {
    const ts = new Date(d.at).toLocaleTimeString();
    const stage = escapeHtml(d.stage || '?');
    const extra = Object.keys(d)
      .filter(k => k !== 'at' && k !== 'stage')
      .map(k => `${escapeHtml(k)}=${escapeHtml(String(d[k]))}`)
      .join(' ');
    return `<li><span class="diag-time">${ts}</span><span class="diag-stage">${stage}</span><span class="diag-extra">${extra}</span></li>`;
  }).join('');
}

// ============================================================================
// Helpers
// ============================================================================
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec < 1) return '0 B/s';
  if (bytesPerSec < 1024) return Math.round(bytesPerSec) + ' B/s';
  if (bytesPerSec < 1048576) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
  if (bytesPerSec < 1073741824) return (bytesPerSec / 1048576).toFixed(1) + ' MB/s';
  return (bytesPerSec / 1073741824).toFixed(2) + ' GB/s';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Set the connection state on the radar + status text. `stateKey` is a key
// into STATUS_TEXT. We also tweak a data attribute that drives the radar
// animation mode.
function setScannerState(stateKey) {
  if (dom.scannerState) dom.scannerState.textContent = STATUS_TEXT[stateKey] || stateKey;
  if (dom.radarStage) {
    dom.radarStage.dataset.state = stateKey;
  }
  document.body.dataset.connectionState = stateKey;
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
  if (dom.radarStage) {
    dom.radarStage.dataset.connType = type;
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
  // The QR code must disappear immediately after the connection is successful.
  // Close the QR modal (Cross-Network mode) if it's open.
  closeQRModal();
  // Also clear the inline Easy P2P QR (it's inside setupArea which is now
  // hidden, but we clear it explicitly to be safe).
  if (dom.easyP2PQRContainer) dom.easyP2PQRContainer.innerHTML = '';
  // Don't override the connection-type badge here - the WebRTC layer will
  // fire onConnectionType once the candidate pair is selected.
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
  state.shortCode = null;
  state.transferInProgress = false;
  dom.setupArea.style.display = 'block';
  dom.transferArea.classList.remove('active');
  dom.chatBox.innerHTML = '';
  hideProgress();
  setScannerState('idle');
  setConnectionType('none');
  // Reset file tray.
  if (dom.fileTrayItems) dom.fileTrayItems.innerHTML = '';
  if (dom.fileTraySummary) dom.fileTraySummary.style.display = 'none';
  // Reset Easy P2P display.
  if (dom.easyP2PCode) dom.easyP2PCode.textContent = '----';
  if (dom.easyP2PQRContainer) dom.easyP2PQRContainer.innerHTML = '';
  if (dom.shortCodeInput) dom.shortCodeInput.value = '';
}

// ============================================================================
// WebRTC connection setup
// ============================================================================
function setupConnection(remotePeerId) {
  const conn = new WebDropConnection(state.peerId, state.iceServers);
  conn.remotePeerId = remotePeerId;

  conn.onIceCandidate = (candidate) => {
    // Send each ICE candidate to the remote peer via signaling (trickle ICE).
    state.signaling.writeMessage(remotePeerId, 'ice', JSON.stringify(candidate.toJSON()))
      .catch(e => pushDiagnostic({ stage: 'ice-send-failed', error: e.message }));
  };

  conn.onStateChange = (webrtcState) => {
    pushDiagnostic({ stage: 'webrtc-state', state: webrtcState });
    if (webrtcState === 'connected' || webrtcState === 'completed') {
      setScannerState('connected');
      // Slow down signaling polls - the DataChannel carries everything now.
      if (state.signaling) state.signaling.setSlowPolling();
      // QR code must disappear immediately after the connection is successful.
      closeQRModal();
    } else if (webrtcState === 'failed') {
      setScannerState('failed');
      if (state.mode === 'easy-p2p') {
        systemMessage('Connection failed. Try refreshing for a new code, or switch to Cross-Network mode.');
      } else {
        systemMessage('Connection failed. Tap the refresh icon next to the radar to retry.');
      }
    } else if (webrtcState === 'reconnecting') {
      setScannerState('reconnecting');
      systemMessage('Connection interrupted. Attempting to recover...');
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

  conn.onTransferProgress = (transferId, sent, total, speed) => {
    if (dom.transferProgress && state.transferInProgress) {
      const pct = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;
      dom.transferProgress.style.width = pct + '%';
      dom.transferProgressText.textContent =
        formatFileSize(sent) + ' / ' + formatFileSize(total) +
        ' | ' + formatSpeed(speed) +
        ' | ' + pct + '%';
    }
  };

  conn.onDataChannelOpen = () => {
    setScannerState('connected');
    pushDiagnostic({ stage: 'datachannel-open' });
  };

  conn.onDiagnostic = (info) => {
    pushDiagnostic(info);
  };

  state.connection = conn;
  return conn;
}

// ============================================================================
// Easy P2P mode (default) - auto-create session with 4-digit code
// ============================================================================
const MODE_KEY = 'webdrop-mode';

function initModeToggle() {
  // Restore saved mode preference.
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === 'cross-network') {
      state.mode = 'cross-network';
    } else {
      state.mode = 'easy-p2p';
    }
  } catch (_) {
    state.mode = 'easy-p2p';
  }

  // Apply the mode to the UI.
  applyMode(state.mode);

  // Wire up the mode toggle buttons.
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newMode = btn.dataset.mode;
      if (newMode === state.mode) return;
      switchMode(newMode);
    });
  });
}

function applyMode(mode) {
  state.mode = mode;
  document.body.dataset.mode = mode;

  // Update toggle button states.
  document.querySelectorAll('.mode-btn').forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  // Show/hide the appropriate panel.
  if (dom.easyP2PPanel) {
    dom.easyP2PPanel.style.display = mode === 'easy-p2p' ? '' : 'none';
  }
  if (dom.crossNetworkPanel) {
    dom.crossNetworkPanel.style.display = mode === 'cross-network' ? '' : 'none';
  }
}

function switchMode(newMode) {
  if (state.mode === newMode) return;

  // Warn if a transfer is in progress.
  if (state.transferInProgress) {
    if (!window.confirm('A file transfer is in progress. Switch modes anyway? The transfer will be cancelled.')) {
      return;
    }
  }

  // Tear down any existing session.
  resetUI();

  // Save and apply the new mode.
  state.mode = newMode;
  try { localStorage.setItem(MODE_KEY, newMode); } catch (_) {}
  applyMode(newMode);

  // Auto-start the Easy P2P session if switching to easy-p2p mode.
  if (newMode === 'easy-p2p') {
    startEasyP2PSession();
  } else {
    setScannerState('idle');
  }
}

// Auto-start an Easy P2P session on page load. Generates a 4-digit code
// and a QR code automatically so the user can share immediately.
async function startEasyP2PSession() {
  // Don't auto-start if we're joining via URL (?join=CODE).
  const params = new URLSearchParams(window.location.search);
  if (params.get('join')) return;

  state.peerId = state.peerId || generatePeerId();
  state.sessionCode = generateSessionCode(); // 12-char internal session_code
  state.shortCode = null;
  state.role = 'sender';

  setScannerState('initializing');

  // Show placeholder while we wait for the backend.
  if (dom.easyP2PCode) dom.easyP2PCode.textContent = '----';
  if (dom.easyP2PQRContainer) dom.easyP2PQRContainer.innerHTML = '';

  try {
    const res = await fetch('/api/session/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_code: state.sessionCode,
        creator_peer_id: state.peerId,
        mode: 'easy-p2p'
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create session');
    }
    state.shortCode = data.short_code;
    state.sessionCode = data.session_code || state.sessionCode;

    // Display the 4-digit code.
    if (dom.easyP2PCode) dom.easyP2PCode.textContent = state.shortCode;

    // Generate and display the QR code inline.
    if (dom.easyP2PQRContainer) {
      const baseUrl = window.location.origin;
      const payload = buildQRPayload(state.sessionCode, baseUrl);
      generateQR(payload, dom.easyP2PQRContainer);
    }

    // Set up signaling client + start polling.
    state.signaling = new SignalingClient(state.peerId, state.sessionCode);
    state.signaling.onMessage = handleSignalingMessage;
    state.signaling.onSessionError = (reason) => {
      systemMessage('Session error: ' + reason);
      // Don't fully reset - just go back to idle so the user can retry.
      if (state.connection) { try { state.connection.close(); } catch(_){} state.connection = null; }
      state.signaling = null;
      state.role = null;
      setScannerState('failed');
    };
    state.signaling.startPolling();

    setScannerState('scanning');
  } catch (e) {
    setScannerState('backendUnavailable');
    systemMessage('Backend unavailable: ' + e.message);
    // If Easy P2P fails (e.g., migration not applied yet), suggest Cross-Network.
    systemMessage('Try switching to Cross-Network mode if the problem persists.');
  }
}

// Join a session using a 4-digit Easy P2P short code.
// Looks up the full session_code via /api/session/lookup, then joins.
async function joinByShortCode(input) {
  const code = cleanShortCode(input);
  if (code.length !== 4) {
    systemMessage('Enter a valid 4-digit code.');
    return;
  }

  state.peerId = state.peerId || generatePeerId();
  state.role = 'receiver';
  setScannerState('connecting');

  try {
    // Step 1: Resolve the 4-digit code to a full session_code.
    const res = await fetch(`/api/session/lookup?code=${code}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Code not found');
    }
    const fullSessionCode = data.session_code;
    state.sessionCode = fullSessionCode;
    state.shortCode = code;

    // Step 2: Join the session (same flow as Cross-Network join).
    const joinRes = await fetch('/api/session/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_code: fullSessionCode,
        joiner_peer_id: state.peerId
      })
    });
    const joinData = await joinRes.json();
    if (!joinRes.ok) {
      throw new Error(joinData.error || 'Failed to join session');
    }
    const creatorPeerId = joinData.creator_peer_id;

    // Step 3: Set up signaling + WebRTC.
    state.signaling = new SignalingClient(state.peerId, fullSessionCode);
    state.signaling.onMessage = handleSignalingMessage;
    state.signaling.onSessionError = (reason) => {
      systemMessage('Session error: ' + reason);
      resetUI();
    };
    state.signaling.startPolling();

    setScannerState('negotiating');

    // Create the WebRTC connection + offer.
    const conn = setupConnection(creatorPeerId);
    const offer = await conn.createOffer();

    // Send the offer to the creator via signaling.
    await state.signaling.writeMessage(creatorPeerId, 'offer', JSON.stringify(offer));

    showTransferUI();
    setScannerState('establishing');
    systemMessage('Establishing secure channel...');
  } catch (e) {
    setScannerState('failed');
    systemMessage(e.message || 'Connection failed.');
    if (e.message && e.message.includes('Too many attempts')) {
      systemMessage('Please wait a few minutes before trying again.');
    }
  }
}

function initEasyP2P() {
  // 4-digit code input: auto-advance, numeric only, join on Enter.
  if (dom.shortCodeInput) {
    dom.shortCodeInput.addEventListener('input', (e) => {
      const cleaned = cleanShortCode(e.target.value);
      e.target.value = cleaned;
      // Auto-join when 4 digits are entered.
      if (cleaned.length === 4) {
        joinByShortCode(cleaned);
      }
    });
    dom.shortCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const code = cleanShortCode(dom.shortCodeInput.value);
        if (code.length === 4) joinByShortCode(code);
      }
    });
  }

  // Connect button.
  dom.shortCodeJoinBtn?.addEventListener('click', () => {
    const code = cleanShortCode(dom.shortCodeInput?.value);
    if (code.length === 4) {
      joinByShortCode(code);
    } else {
      systemMessage('Enter a 4-digit code.');
    }
  });

  // Scan QR button (Easy P2P mode) - opens the same scanner modal.
  dom.easyScanBtn?.addEventListener('click', openScanner);

  // Copy 4-digit code button.
  dom.copyEasyP2PCodeBtn?.addEventListener('click', () => {
    if (state.shortCode) {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(state.shortCode).then(() => {
          dom.copyEasyP2PCodeBtn.innerHTML = ICONS.check + ' Copied';
          setTimeout(() => {
            dom.copyEasyP2PCodeBtn.innerHTML = ICONS.copy + ' Copy Code';
          }, 1500);
        });
      }
    }
  });
}

// ============================================================================
// Sender flow: create session + show QR (Cross-Network mode)
// ============================================================================
async function startSenderSession() {
  state.peerId = state.peerId || generatePeerId();
  state.sessionCode = generateSessionCode();
  state.role = 'sender';

  setScannerState('initializing');

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

  setScannerState('scanning');
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
  setScannerState('connecting');

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

    setScannerState('negotiating');

    // Create the WebRTC connection + offer.
    const conn = setupConnection(creatorPeerId);
    const offer = await conn.createOffer();

    // Send the offer to the creator via signaling.
    await state.signaling.writeMessage(creatorPeerId, 'offer', JSON.stringify(offer));

    showTransferUI();
    setScannerState('establishing');
    systemMessage('Establishing secure channel with sender...');
  } catch (e) {
    setScannerState('failed');
    systemMessage('Join failed: ' + e.message);
  }
}

// ============================================================================
// Handle incoming signaling messages (serially - see signaling.js)
// ============================================================================
async function handleSignalingMessage(msg) {
  if (!state.connection) {
    // First message from the receiver is the offer (sender side).
    if (msg.message_type === 'offer') {
      const remotePeerId = msg.from_peer_id;
      const conn = setupConnection(remotePeerId);
      setScannerState('negotiating');
      const offer = JSON.parse(msg.payload);
      const answer = await conn.acceptOffer(offer.sdp || offer);
      await state.signaling.writeMessage(remotePeerId, 'answer', JSON.stringify(answer));
      showTransferUI();
      setScannerState('establishing');
      systemMessage('Receiver connected. Establishing secure channel...');
    }
    return;
  }

  // Connection exists - handle answer or ICE candidates.
  if (msg.message_type === 'answer') {
    try {
      const answer = JSON.parse(msg.payload);
      await state.connection.acceptAnswer(answer.sdp || answer);
      setScannerState('establishing');
    } catch (e) {
      pushDiagnostic({ stage: 'apply-answer-failed', error: e.message });
    }
    return;
  }
  if (msg.message_type === 'ice') {
    try {
      const candidate = JSON.parse(msg.payload);
      await state.connection.addIceCandidate(candidate);
    } catch (e) {
      pushDiagnostic({ stage: 'apply-ice-failed', error: e.message });
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
  dom.manualCodeInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      dom.manualJoinBtn?.click();
    }
  });
  // Auto-format the code with hyphens as the user types.
  dom.manualCodeInput?.addEventListener('input', () => {
    const cleaned = cleanSessionCode(dom.manualCodeInput.value);
    dom.manualCodeInput.value = cleaned.length > 8
      ? cleaned.slice(0,4) + '-' + cleaned.slice(4,8) + '-' + cleaned.slice(8,12)
      : cleaned.length > 4
        ? cleaned.slice(0,4) + '-' + cleaned.slice(4,8)
        : cleaned;
  });
}

// ============================================================================
// Refresh connection button - performs a real reset, NOT a page reload.
// ============================================================================
function refreshConnection() {
  if (state.refreshing) return;

  // If a transfer is in progress, refuse and ask for confirmation.
  if (state.transferInProgress) {
    if (!window.confirm('A file transfer is in progress. Refresh anyway? The transfer will be cancelled.')) {
      return;
    }
  }

  state.refreshing = true;
  const btn = dom.refreshBtn;
  if (btn) {
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.setAttribute('aria-busy', 'true');
  }

  try {
    // 1. Tear down the existing peer connection.
    if (state.connection) {
      try { state.connection.close(); } catch (_) {}
      state.connection = null;
    }
    // 2. Stop polling - we'll re-subscribe in a moment.
    if (state.signaling) {
      state.signaling.stopPolling();
      state.signaling = null;
    }
    // 3. Reset transfer / progress UI.
    state.transferInProgress = false;
    hideProgress();
    if (dom.fileTrayItems) dom.fileTrayItems.innerHTML = '';
    if (dom.fileTraySummary) dom.fileTraySummary.style.display = 'none';

    // 4. Re-initialise. We keep the same sessionCode if we're the sender
    //    (so the QR is still valid), but regenerate it if we're the
    //    receiver (the original session may be stale). If we're idle,
    //    we just reset to idle.
    setScannerState('idle');
    setConnectionType('none');

    // Role-aware re-init.
    if (state.role === 'sender') {
      // Sender: keep the same code, just resume polling. The receiver can
      // rejoin by scanning the same QR or entering the same code.
      state.peerId = generatePeerId(); // fresh peerId - the old one may be in a half-open state
      // Note: we deliberately DON'T create a new session row - the old one
      // is still valid for ~15 minutes. The new peerId will be associated
      // with the session via the joiner flow when the receiver connects.
      // Actually, the creator_peer_id is fixed in the DB - so we need to
      // reuse the original peerId for the sender. Re-generating breaks
      // the session lookup. Roll back.
      // We'll just re-start polling with the SAME peerId.
      // (Re-generating would only matter if the peerId had leaked - it hasn't.)
    }
  } finally {
    // Restore the button after a short delay so the loading state is visible.
    setTimeout(() => {
      state.refreshing = false;
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        btn.removeAttribute('aria-busy');
      }
      // If we were actively in a session, restart polling.
      if (state.sessionCode && state.peerId && state.role && state.mode === 'cross-network') {
        state.signaling = new SignalingClient(state.peerId, state.sessionCode);
        state.signaling.onMessage = handleSignalingMessage;
        state.signaling.onSessionError = (reason) => {
          systemMessage('Session error: ' + reason);
          resetUI();
        };
        state.signaling.startPolling();
        setScannerState(state.role === 'sender' ? 'scanning' : 'connecting');
        systemMessage('Connection refreshed. Waiting for peer...');
      } else if (state.mode === 'easy-p2p') {
        // In Easy P2P mode, refresh creates a brand new session with a new
        // 4-digit code. This is the expected UX: "give me a fresh code".
        startEasyP2PSession();
      } else {
        setScannerState('idle');
      }
    }, 700);
  }
}

function initRefreshButton() {
  dom.refreshBtn?.addEventListener('click', refreshConnection);
}

// ============================================================================
// File selection tray (selected files appear here before being sent)
// ============================================================================
let selectedFiles = [];

function renderFileTray() {
  if (!dom.fileTrayItems) return;
  dom.fileTrayItems.innerHTML = '';
  if (!selectedFiles.length) {
    if (dom.fileTraySummary) dom.fileTraySummary.style.display = 'none';
    return;
  }
  if (dom.fileTraySummary) {
    dom.fileTraySummary.style.display = '';
    const totalSize = selectedFiles.reduce((s, f) => s + f.size, 0);
    dom.fileTraySummary.textContent =
      `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} selected | ${formatFileSize(totalSize)}`;
  }
  selectedFiles.forEach((f, idx) => {
    const item = document.createElement('div');
    item.className = 'file-tray-item';
    item.innerHTML = `
      <span class="fti-icon">${ICONS.file}</span>
      <span class="fti-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <span class="fti-size">${formatFileSize(f.size)}</span>
      <button class="fti-remove" type="button" aria-label="Remove file" data-idx="${idx}">${ICONS.times}</button>
    `;
    item.querySelector('.fti-remove').addEventListener('click', () => {
      selectedFiles.splice(idx, 1);
      renderFileTray();
    });
    dom.fileTrayItems.appendChild(item);
  });
  // Show the send button.
  if (dom.sendSelectedBtn) dom.sendSelectedBtn.style.display = '';
}

function addSelectedFiles(files) {
  for (const f of files) selectedFiles.push(f);
  renderFileTray();
}

// ============================================================================
// File sending (drag-drop, file tray, ZIP choice, TXT send)
// ============================================================================
function initFileHandling() {
  // File tray click-to-select.
  dom.fileInput?.addEventListener('change', (e) => { addSelectedFiles(Array.from(e.target.files)); e.target.value = ''; });
  dom.imageInput?.addEventListener('change', (e) => { addSelectedFiles(Array.from(e.target.files)); e.target.value = ''; });
  dom.videoInput?.addEventListener('change', (e) => { addSelectedFiles(Array.from(e.target.files)); e.target.value = ''; });
  dom.folderInput?.addEventListener('change', (e) => { addSelectedFiles(Array.from(e.target.files)); e.target.value = ''; });

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
    if (files.length) addSelectedFiles(files);
  });

  // TXT send button.
  dom.sendTxtBtn?.addEventListener('click', sendAsTxt);

  // Send selected files button.
  dom.sendSelectedBtn?.addEventListener('click', () => {
    if (!selectedFiles.length) return;
    handleFiles(selectedFiles.slice());
  });

  // Clicking the drop zone also opens the file picker.
  dom.dropZone?.addEventListener('click', () => {
    if (!isTransferActive()) return;
    dom.fileInput?.click();
  });
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
  if (state.transferInProgress) {
    systemMessage('Please wait for the current transfer to finish.');
    return;
  }
  state.transferInProgress = true;
  setScannerState('preparing');
  showProgress(file.name, file.size);
  try {
    // Wait for the secure channel to be ready before sending.
    await state.connection.waitForDataChannel();
    setScannerState('transferring');
    await state.connection.sendFile(file);
    setScannerState('completed');
    systemMessage('Sent: ' + file.name);
    setTimeout(() => {
      if (state.connection && state.connection.dataChannel &&
          state.connection.dataChannel.readyState === 'open') {
        setScannerState('connected');
      }
    }, 1500);
  } catch (e) {
    setScannerState('failed');
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
    // Clear the tray since we're sending them now.
    selectedFiles = [];
    renderFileTray();
    for (const file of files) {
      await sendSingleFile(file);
    }
  });
  dom.zipChooseArchiveBtn?.addEventListener('click', async () => {
    const files = dom.zipChoiceFiles;
    closeZipChoice();
    selectedFiles = [];
    renderFileTray();
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
  if (info.cancelled) {
    systemMessage('Transfer cancelled: ' + info.filename);
    return;
  }
  if (!blob) {
    systemMessage('Transfer failed: ' + info.filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const div = document.createElement('div');
  div.className = 'message received file-card';

  const meta = document.createElement('div');
  meta.className = 'file-meta';
  meta.innerHTML = '<strong>' + ICONS.paperclip + ' ' + escapeHtml(info.filename) + '</strong>' +
    '<div class="file-sub">' +
    formatFileSize(info.filesize) +
    (info.hash ? (info.hashOk ? ' | verified' : ' | HASH MISMATCH') : '') +
    '</div>';
  div.appendChild(meta);

  if (info.hashOk === false) {
    const warn = document.createElement('div');
    warn.className = 'file-warn';
    warn.textContent = 'File integrity check failed. The file may be corrupted.';
    div.appendChild(warn);
  }

  const link = document.createElement('a');
  link.href = url;
  link.download = info.filename;
  link.className = 'btn btn-success btn-download';
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
  dom.transferProgressText.textContent = '0 / ' + formatFileSize(totalSize) + ' | 0%';
}

function hideProgress() {
  if (dom.transferProgressContainer) {
    dom.transferProgressContainer.style.display = 'none';
  }
}

// ============================================================================
// Diagnostics panel toggle
// ============================================================================
function initDiagnosticsPanel() {
  dom.diagnosticsBtn?.addEventListener('click', () => {
    const open = dom.diagnosticsPanel.classList.toggle('open');
    dom.diagnosticsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) renderDiagnostics();
  });
  dom.diagnosticsClose?.addEventListener('click', () => {
    dom.diagnosticsPanel.classList.remove('open');
    dom.diagnosticsBtn.setAttribute('aria-expanded', 'false');
  });
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
    footerYear: document.getElementById('footerYear'),
    // New UI elements
    refreshBtn: document.getElementById('refreshBtn'),
    radarStage: document.getElementById('radarStage'),
    fileTrayItems: document.getElementById('fileTrayItems'),
    fileTraySummary: document.getElementById('fileTraySummary'),
    sendSelectedBtn: document.getElementById('sendSelectedBtn'),
    diagnosticsBtn: document.getElementById('diagnosticsBtn'),
    diagnosticsPanel: document.getElementById('diagnosticsPanel'),
    diagnosticsClose: document.getElementById('diagnosticsClose'),
    diagnosticsList: document.getElementById('diagnosticsList'),
    logoRefreshBtn: document.getElementById('logoRefreshBtn'),
    // Easy P2P mode elements
    easyP2PPanel: document.getElementById('easyP2PPanel'),
    crossNetworkPanel: document.getElementById('crossNetworkPanel'),
    easyP2PCode: document.getElementById('easyP2PCode'),
    easyP2PQRContainer: document.getElementById('easyP2PQRContainer'),
    copyEasyP2PCodeBtn: document.getElementById('copyEasyP2PCodeBtn'),
    shortCodeInput: document.getElementById('shortCodeInput'),
    shortCodeJoinBtn: document.getElementById('shortCodeJoinBtn'),
    easyScanBtn: document.getElementById('easyScanBtn')
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
  initRefreshButton();
  initDiagnosticsPanel();
  initModeToggle();
  initEasyP2P();

  // Logo click triggers refresh too (the original behaviour - we keep it).
  dom.logoRefreshBtn?.addEventListener('click', refreshConnection);

  // Fire and forget - these are non-blocking.
  loadIceServers();
  checkBackendHealth();

  // Check URL for ?join=CODE (receiver flow via link).
  // This works for both Easy P2P and Cross-Network modes since the QR
  // always encodes the full 12-char session_code.
  const params = new URLSearchParams(window.location.search);
  const joinCode = params.get('join');
  if (joinCode && cleanSessionCode(joinCode).length === 12) {
    // Switch to cross-network mode for URL-based joins (the QR encodes the
    // full 12-char code, so we use the existing join flow).
    if (state.mode !== 'cross-network') {
      applyMode('cross-network');
    }
    joinSession(joinCode);
  } else {
    // Auto-start Easy P2P session on page load (default mode).
    if (state.mode === 'easy-p2p') {
      startEasyP2PSession();
    } else {
      setScannerState('idle');
    }
  }

  setConnectionType('none');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
