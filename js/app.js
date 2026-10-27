/* ============================================================================
   WebDrop Pro | application logic
   - Preserves the /api/session Postbase contract (create / connect / get)
   - Adds: clickable logo refresh, drag-and-drop transfer, inline SVG icons
   - Removes: fake peer count simulation (scanner now reports real state only)
   - Uses inline SVG icons everywhere (no Font Awesome, no Lucide library)
   - No em dashes in any interface copy
   ============================================================================ */

(function () {
  'use strict';

  /* ---------- 0. Inline SVG icon library (no icon fonts) ---------- */
  const ICONS = {
    sun: '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
    moon: '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    copy: '<svg class="svg-icon sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg class="svg-icon sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
    paperclip: '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11l-9.5 9.5a5 5 0 0 1-7.1-7.1l9.5-9.5a3.5 3.5 0 0 1 5 5l-9.5 9.5a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>',
    download: '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
    times: '<svg class="svg-icon sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    file: '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>'
  };

  /* ========================================================================
     1. Secure session API
     Contract preserved exactly. Server-side secret stays in /api/session.
     ======================================================================== */
  const SESSION_ENDPOINT = '/api/session';

  async function apiCreateSession(sessionId) {
    const res = await fetch(SESSION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'create', id: sessionId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Create failed');
    return data;
  }

  async function apiGetSession(sessionId) {
    const res = await fetch(
      SESSION_ENDPOINT + '?id=' + encodeURIComponent(sessionId),
      { method: 'GET', headers: { 'Accept': 'application/json' } }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Query failed');
    return data;
  }

  async function apiMarkConnected(sessionId) {
    const res = await fetch(SESSION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'connect', id: sessionId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Update failed');
    return data;
  }

  /* ========================================================================
     2. i18n
     ======================================================================== */
  const i18n = {
    en: {
      deviceId: 'Your Device ID', active: 'Active', networkScanner: 'Network Scanner',
      connect: 'Connect', ready: 'Ready to connect',
      connectedTo: 'Connected to', disconnect: 'Disconnect',
      sendDocument: 'Send Document', sendImages: 'Send Images',
      sendVideo: 'Send Video', sendFolder: 'Send Folder',
      secureChat: 'Secure Chat',
      dropTitle: 'Drop files to transfer',
      dropSubtitle: 'Drag files, images, or folders anywhere into this window to send them over the secure P2P link.',
      scannerIdle: 'Idle, awaiting connection',
      scannerScanning: 'Scanning for peers...',
      scannerConnected: '1 peer connected',
      systemConnected: 'Secure connection established',
      systemClosed: 'Connection closed',
      systemSending: 'Sending {name}...',
      systemSent: 'Sent: {name}',
      systemFolder: 'Sending folder: {name} ({count} files)',
      systemFolderSent: 'Folder sent: {name}',
      systemError: 'Error sending {name}',
      fileDownload: 'Download', connecting: 'Connecting...',
      connected: 'Connected successfully', failed: 'Connection failed',
      pastedTextAttached: 'Pasted text saved as {name}',
      removeAttachment: 'Remove attachment',
      qrWaiting: 'Waiting for scan...', qrConnecting: 'Connecting via QR...',
      qrConnected: 'Connected! You can close this.', qrError: 'Error: {msg}',
      qrRefresh: 'Refresh QR', qrScan: 'Scan QR', qrShowQR: 'Show my QR'
    },
    es: {
      deviceId: 'Tu ID de dispositivo', active: 'Activo', networkScanner: 'Escáner de red',
      connect: 'Conectar', ready: 'Listo para conectar',
      connectedTo: 'Conectado a', disconnect: 'Desconectar',
      sendDocument: 'Enviar documento', sendImages: 'Enviar imágenes',
      sendVideo: 'Enviar video', sendFolder: 'Enviar carpeta',
      secureChat: 'Chat seguro',
      dropTitle: 'Suelta archivos para transferir',
      dropSubtitle: 'Arrastra archivos, imágenes o carpetas a esta ventana para enviarlos por el enlace P2P seguro.',
      scannerIdle: 'Inactivo, esperando conexión',
      scannerScanning: 'Buscando pares...',
      scannerConnected: '1 par conectado',
      systemConnected: 'Conexión segura establecida',
      systemClosed: 'Conexión cerrada',
      systemSending: 'Enviando {name}...',
      systemSent: 'Enviado: {name}',
      systemFolder: 'Enviando carpeta: {name} ({count} archivos)',
      systemFolderSent: 'Carpeta enviada: {name}',
      systemError: 'Error al enviar {name}',
      fileDownload: 'Descargar', connecting: 'Conectando...',
      connected: 'Conectado exitosamente', failed: 'Conexión fallida',
      pastedTextAttached: 'Texto pegado guardado como {name}',
      removeAttachment: 'Quitar adjunto',
      qrWaiting: 'Esperando escaneo...', qrConnecting: 'Conectando vía QR...',
      qrConnected: '¡Conectado! Puedes cerrar.', qrError: 'Error: {msg}',
      qrRefresh: 'Refrescar QR', qrScan: 'Escanear QR', qrShowQR: 'Mostrar mi QR'
    },
    fr: {
      deviceId: 'Votre ID d\'appareil', active: 'Actif', networkScanner: 'Scanner réseau',
      connect: 'Connecter', ready: 'Prêt à connecter',
      connectedTo: 'Connecté à', disconnect: 'Déconnecter',
      sendDocument: 'Envoyer un document', sendImages: 'Envoyer des images',
      sendVideo: 'Envoyer une vidéo', sendFolder: 'Envoyer un dossier',
      secureChat: 'Chat sécurisé',
      dropTitle: 'Déposez des fichiers à transférer',
      dropSubtitle: 'Glissez des fichiers, images ou dossiers dans cette fenêtre pour les envoyer via le lien P2P sécurisé.',
      scannerIdle: 'Inactif, en attente de connexion',
      scannerScanning: 'Recherche de pairs...',
      scannerConnected: '1 pair connecté',
      systemConnected: 'Connexion sécurisée établie',
      systemClosed: 'Connexion fermée',
      systemSending: 'Envoi de {name}...',
      systemSent: 'Envoyé : {name}',
      systemFolder: 'Envoi du dossier : {name} ({count} fichiers)',
      systemFolderSent: 'Dossier envoyé : {name}',
      systemError: 'Erreur lors de l\'envoi de {name}',
      fileDownload: 'Télécharger', connecting: 'Connexion...',
      connected: 'Connecté avec succès', failed: 'Échec de la connexion',
      pastedTextAttached: 'Texte collé enregistré comme {name}',
      removeAttachment: 'Supprimer la pièce jointe',
      qrWaiting: 'En attente de scan...', qrConnecting: 'Connexion via QR...',
      qrConnected: 'Connecté ! Vous pouvez fermer.', qrError: 'Erreur : {msg}',
      qrRefresh: 'Rafraîchir QR', qrScan: 'Scanner QR', qrShowQR: 'Afficher mon QR'
    },
    de: {
      deviceId: 'Ihre Geräte-ID', active: 'Aktiv', networkScanner: 'Netzwerk-Scanner',
      connect: 'Verbinden', ready: 'Bereit zum Verbinden',
      connectedTo: 'Verbunden mit', disconnect: 'Trennen',
      sendDocument: 'Dokument senden', sendImages: 'Bilder senden',
      sendVideo: 'Video senden', sendFolder: 'Ordner senden',
      secureChat: 'Sicherer Chat',
      dropTitle: 'Dateien zum Übertragen ablegen',
      dropSubtitle: 'Ziehen Sie Dateien, Bilder oder Ordner in dieses Fenster, um sie über die sichere P2P-Verbindung zu senden.',
      scannerIdle: 'Inaktiv, warte auf Verbindung',
      scannerScanning: 'Suche nach Peers...',
      scannerConnected: '1 Peer verbunden',
      systemConnected: 'Sichere Verbindung hergestellt',
      systemClosed: 'Verbindung geschlossen',
      systemSending: 'Sende {name}...',
      systemSent: 'Gesendet: {name}',
      systemFolder: 'Sende Ordner: {name} ({count} Dateien)',
      systemFolderSent: 'Ordner gesendet: {name}',
      systemError: 'Fehler beim Senden von {name}',
      fileDownload: 'Herunterladen', connecting: 'Verbinde...',
      connected: 'Erfolgreich verbunden', failed: 'Verbindung fehlgeschlagen',
      pastedTextAttached: 'Eingefügter Text als {name} gespeichert',
      removeAttachment: 'Anhang entfernen',
      qrWaiting: 'Warte auf Scan...', qrConnecting: 'Verbinde via QR...',
      qrConnected: 'Verbunden! Sie können schließen.', qrError: 'Fehler: {msg}',
      qrRefresh: 'QR aktualisieren', qrScan: 'QR scannen', qrShowQR: 'Mein QR anzeigen'
    },
    pt: {
      deviceId: 'Seu ID de dispositivo', active: 'Ativo', networkScanner: 'Scanner de rede',
      connect: 'Conectar', ready: 'Pronto para conectar',
      connectedTo: 'Conectado a', disconnect: 'Desconectar',
      sendDocument: 'Enviar documento', sendImages: 'Enviar imagens',
      sendVideo: 'Enviar vídeo', sendFolder: 'Enviar pasta',
      secureChat: 'Chat seguro',
      dropTitle: 'Solte arquivos para transferir',
      dropSubtitle: 'Arraste arquivos, imagens ou pastas para esta janela para enviá-los pelo link P2P seguro.',
      scannerIdle: 'Inativo, aguardando conexão',
      scannerScanning: 'Procurando pares...',
      scannerConnected: '1 par conectado',
      systemConnected: 'Conexão segura estabelecida',
      systemClosed: 'Conexão encerrada',
      systemSending: 'Enviando {name}...',
      systemSent: 'Enviado: {name}',
      systemFolder: 'Enviando pasta: {name} ({count} arquivos)',
      systemFolderSent: 'Pasta enviada: {name}',
      systemError: 'Erro ao enviar {name}',
      fileDownload: 'Baixar', connecting: 'Conectando...',
      connected: 'Conectado com sucesso', failed: 'Falha na conexão',
      pastedTextAttached: 'Texto colado salvo como {name}',
      removeAttachment: 'Remover anexo',
      qrWaiting: 'Aguardando escaneamento...', qrConnecting: 'Conectando via QR...',
      qrConnected: 'Conectado! Você pode fechar.', qrError: 'Erro: {msg}',
      qrRefresh: 'Atualizar QR', qrScan: 'Escanear QR', qrShowQR: 'Mostrar meu QR'
    },
    zh: {
      deviceId: '您的设备ID', active: '活跃', networkScanner: '网络扫描仪',
      connect: '连接', ready: '准备连接',
      connectedTo: '已连接到', disconnect: '断开连接',
      sendDocument: '发送文档', sendImages: '发送图片',
      sendVideo: '发送视频', sendFolder: '发送文件夹',
      secureChat: '安全聊天',
      dropTitle: '拖放文件以传输',
      dropSubtitle: '将文件、图片或文件夹拖到此窗口任意位置，通过安全 P2P 链接发送。',
      scannerIdle: '空闲，等待连接',
      scannerScanning: '正在扫描对端...',
      scannerConnected: '已连接 1 个对端',
      systemConnected: '安全连接已建立',
      systemClosed: '连接已关闭',
      systemSending: '正在发送 {name}...',
      systemSent: '已发送：{name}',
      systemFolder: '正在发送文件夹：{name}（{count} 个文件）',
      systemFolderSent: '文件夹已发送：{name}',
      systemError: '发送 {name} 时出错',
      fileDownload: '下载', connecting: '连接中...',
      connected: '连接成功', failed: '连接失败',
      pastedTextAttached: '粘贴的文本已保存为 {name}',
      removeAttachment: '删除附件',
      qrWaiting: '等待扫描...', qrConnecting: '通过QR连接中...',
      qrConnected: '已连接！您可以关闭此窗口。', qrError: '错误：{msg}',
      qrRefresh: '刷新QR', qrScan: '扫描QR', qrShowQR: '显示我的QR'
    }
  };

  let currentLang = 'en';

  function t(key, vars) {
    let str = (i18n[currentLang] && i18n[currentLang][key]) || i18n.en[key] || key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
      }
    }
    return str;
  }

  function updateUI() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
    const ph = document.getElementById('targetId');
    if (ph) ph.placeholder = t('connect') + ' ID...';
    const msgPh = document.getElementById('msgInput');
    if (msgPh) msgPh.placeholder = t('secureChat') + '...';
    const st = document.getElementById('statusText');
    if (st && !st.dataset.custom) st.textContent = t('ready');
    const scannerState = document.getElementById('scannerState');
    if (scannerState && conn && conn.open) {
      scannerState.textContent = t('scannerConnected');
    } else if (scannerState) {
      scannerState.textContent = t('scannerIdle');
    }
  }

  /* ========================================================================
     3. Theme (uses inline SVG icons, no Font Awesome)
     ======================================================================== */
  const themeToggle = document.getElementById('themeToggle');
  const app = document.getElementById('app');
  let dark = false;

  function setTheme(darkMode) {
    dark = darkMode;
    app.setAttribute('data-theme', dark ? 'dark' : 'light');
    if (themeToggle) themeToggle.innerHTML = dark ? ICONS.sun : ICONS.moon;
    try { localStorage.setItem('webdrop-theme', dark ? 'dark' : 'light'); } catch (_) {}
  }

  (function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('webdrop-theme'); } catch (_) {}
    if (saved === 'dark') setTheme(true);
    else if (saved === 'light') setTheme(false);
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) setTheme(true);
    else setTheme(true); // default to dark utilitarian aesthetic
  })();

  themeToggle.addEventListener('click', () => setTheme(!dark));

  /* ========================================================================
     4. Footer year, device name, avatar
     ======================================================================== */
  document.getElementById('footerYear').textContent = new Date().getFullYear();

  const deviceNameInput = document.getElementById('deviceNameInput');
  const avatarDisplay = document.getElementById('avatarDisplay');

  function updateAvatar() {
    const name = (deviceNameInput.value || 'Device').trim();
    const initials = name.split(/\s+/).map(w => w[0] || '').join('').toUpperCase().slice(0, 2);
    avatarDisplay.textContent = initials || 'DV';
  }
  deviceNameInput.addEventListener('input', updateAvatar);

  (function loadDeviceName() {
    let saved = null;
    try { saved = localStorage.getItem('webdrop-deviceName'); } catch (_) {}
    if (saved) {
      deviceNameInput.value = saved;
      updateAvatar();
    }
  })();
  deviceNameInput.addEventListener('change', function () {
    try { localStorage.setItem('webdrop-deviceName', this.value.trim() || 'My Device'); } catch (_) {}
    updateAvatar();
  });

  document.getElementById('langSelect').addEventListener('change', function () {
    currentLang = this.value;
    updateUI();
  });

  /* ========================================================================
     5. Cookie consent
     ======================================================================== */
  const cookieConsent = document.getElementById('cookieConsent');
  const acceptCookiesBtn = document.getElementById('acceptCookiesBtn');
  try {
    if (localStorage.getItem('cookiesAccepted') === 'true') {
      cookieConsent.classList.add('hidden');
    }
  } catch (_) {}
  acceptCookiesBtn.addEventListener('click', function () {
    try { localStorage.setItem('cookiesAccepted', 'true'); } catch (_) {}
    cookieConsent.classList.add('hidden');
  });

  /* ========================================================================
     6. DOM references
     ======================================================================== */
  const myIdDisplay     = document.getElementById('myIdDisplay');
  const copyIdBtn       = document.getElementById('copyIdBtn');
  const targetIdInput   = document.getElementById('targetId');
  const connectBtn      = document.getElementById('connectBtn');
  const disconnectBtn   = document.getElementById('disconnectBtn');
  const statusText      = document.getElementById('statusText');
  const setupArea       = document.getElementById('setupArea');
  const transferArea    = document.getElementById('transferArea');
  const peerIdDisplay   = document.getElementById('peerIdDisplay');
  const chatBox         = document.getElementById('chatBox');
  const msgInput        = document.getElementById('msgInput');
  const sendBtn         = document.getElementById('sendBtn');
  const fileInput       = document.getElementById('fileInput');
  const imageInput      = document.getElementById('imageInput');
  const videoInput      = document.getElementById('videoInput');
  const folderInput     = document.getElementById('folderInput');
  const refreshBtn      = document.getElementById('refreshBtn');
  const logoRefreshBtn  = document.getElementById('logoRefreshBtn');
  const scannerRing     = document.getElementById('scannerRing');
  const scannerState    = document.getElementById('scannerState');
  const dropZone        = document.getElementById('dropZone');
  const dropChooseFiles = document.getElementById('dropChooseFiles');
  const dropChooseFolder= document.getElementById('dropChooseFolder');
  const dropFileInput   = document.getElementById('dropFileInput');
  const dropFolderInput = document.getElementById('dropFolderInput');

  let pendingAttachments = [];
  const PASTE_CHAR_THRESHOLD = 300;
  let peer = null;
  let conn = null;
  let myId = '';
  let isRefreshing = false;

  /* ========================================================================
     7. Helpers
     ======================================================================== */
  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

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
        copyBtn.title = 'Copy text';
        copyBtn.setAttribute('aria-label', 'Copy message text');
        copyBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          const textToCopy = text;
          const doCopy = function () {
            copyBtn.innerHTML = ICONS.check;
            copyBtn.classList.add('copied');
            setTimeout(() => {
              copyBtn.innerHTML = ICONS.copy;
              copyBtn.classList.remove('copied');
            }, 1500);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(textToCopy).then(doCopy).catch(fallbackCopy);
          } else {
            fallbackCopy();
          }
          function fallbackCopy() {
            const ta = document.createElement('textarea');
            ta.value = textToCopy;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (_) {}
            ta.remove();
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
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  function systemMessage(key, vars) {
    addMessage('System', t(key, vars), 'system');
  }

  function resetUI() {
    conn = null;
    setupArea.style.display = 'block';
    transferArea.classList.remove('active');
    targetIdInput.value = '';
    statusText.textContent = t('ready');
    statusText.dataset.custom = 'false';
    statusText.style.color = '';
    chatBox.innerHTML = '';
    pendingAttachments = [];
    renderPendingAttachments();
    updateScannerState('idle');
    clearPeerBlip();
  }

  function showTransferUI(peerId) {
    setupArea.style.display = 'none';
    transferArea.classList.add('active');
    peerIdDisplay.textContent = peerId;
    chatBox.innerHTML = '';
    updateScannerState('connected');
    showPeerBlip();
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  function renderPendingAttachments() {
    const container = document.getElementById('pendingAttachments');
    container.innerHTML = '';
    pendingAttachments.forEach((file, index) => {
      const badge = document.createElement('div');
      badge.className = 'pending-attachment';
      const iconSpan = document.createElement('span');
      iconSpan.innerHTML = ICONS.file;
      badge.appendChild(iconSpan);
      const info = document.createElement('div');
      info.className = 'pending-attachment-info';
      const nameEl = document.createElement('div');
      nameEl.className = 'pending-attachment-name';
      nameEl.textContent = file.name;
      nameEl.title = file.name;
      info.appendChild(nameEl);
      const sizeEl = document.createElement('div');
      sizeEl.className = 'pending-attachment-size';
      sizeEl.textContent = formatFileSize(file.size);
      info.appendChild(sizeEl);
      badge.appendChild(info);
      const removeBtn = document.createElement('button');
      removeBtn.className = 'pending-attachment-remove';
      removeBtn.type = 'button';
      removeBtn.title = t('removeAttachment');
      removeBtn.setAttribute('aria-label', t('removeAttachment'));
      removeBtn.innerHTML = ICONS.times;
      removeBtn.addEventListener('click', function () {
        pendingAttachments.splice(index, 1);
        renderPendingAttachments();
      });
      badge.appendChild(removeBtn);
      container.appendChild(badge);
    });
  }

  msgInput.addEventListener('paste', function (e) {
    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;
    const pastedText = clipboardData.getData('text');
    if (!pastedText) return;
    const charCount = pastedText.length;
    const lineCount = pastedText.split(/\r\n|\r|\n/).length;
    if (charCount > PASTE_CHAR_THRESHOLD || lineCount > 1) {
      e.preventDefault();
      const timestamp = Date.now();
      const filename = 'shared-text-' + timestamp + '.txt';
      const blob = new Blob([pastedText], { type: 'text/plain;charset=utf-8' });
      const file = new File([blob], filename, { type: 'text/plain;charset=utf-8' });
      pendingAttachments.push(file);
      renderPendingAttachments();
      systemMessage('pastedTextAttached', { name: filename });
    }
  });

  /* ========================================================================
     8. Scanner - honest state only, no fake peer counts
     ======================================================================== */
  function updateScannerState(state) {
    if (!scannerState) return;
    if (state === 'connected') {
      scannerState.textContent = t('scannerConnected');
    } else if (state === 'scanning') {
      scannerState.textContent = t('scannerScanning');
    } else {
      scannerState.textContent = t('scannerIdle');
    }
  }

  function showPeerBlip() {
    if (!scannerRing) return;
    let blip = scannerRing.querySelector('.scanner-peer');
    if (!blip) {
      blip = document.createElement('span');
      blip.className = 'scanner-peer';
      blip.setAttribute('aria-hidden', 'true');
      blip.style.left = '50%';
      blip.style.top = '50%';
      scannerRing.appendChild(blip);
    }
  }

  function clearPeerBlip() {
    if (!scannerRing) return;
    scannerRing.querySelectorAll('.scanner-peer').forEach(el => el.remove());
  }

  /* ========================================================================
     9. Refresh connection (logo button + standalone refresh button)
     ======================================================================== */
  function refreshConnection() {
    if (isRefreshing) return;
    isRefreshing = true;

    // Spinning feedback on both the logo button and the standalone refresh button
    if (logoRefreshBtn) {
      logoRefreshBtn.classList.add('spinning');
      logoRefreshBtn.disabled = true;
    }
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.classList.add('spinning');
    }
    updateScannerState('scanning');

    if (conn) {
      try { conn.close(); } catch (_) {}
      conn = null;
    }
    if (peer) {
      try { peer.destroy(); } catch (_) {}
      peer = null;
    }
    resetUI();

    setTimeout(() => {
      initPeer();
      updateScannerState('idle');
      setTimeout(() => {
        if (logoRefreshBtn) {
          logoRefreshBtn.classList.remove('spinning');
          logoRefreshBtn.disabled = false;
        }
        if (refreshBtn) {
          refreshBtn.classList.remove('spinning');
          refreshBtn.disabled = false;
        }
        isRefreshing = false;
      }, 400);
    }, 350);
  }

  if (refreshBtn) refreshBtn.addEventListener('click', refreshConnection);
  if (logoRefreshBtn) logoRefreshBtn.addEventListener('click', refreshConnection);

  /* ========================================================================
     10. PeerJS init
     ======================================================================== */
  function initPeer() {
    myId = Math.floor(1000 + Math.random() * 9000).toString();
    myIdDisplay.textContent = myId;

    peer = new Peer(myId, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    peer.on('open', (id) => {
      console.log('Peer open with ID:', id);
      statusText.textContent = t('ready');
    });

    peer.on('connection', (incoming) => {
      console.log('Incoming connection from:', incoming.peer);
      if (conn) {
        console.warn('Already have a connection, rejecting incoming.');
        incoming.close();
        return;
      }
      conn = incoming;
      conn.on('open', () => {
        console.log('Incoming connection opened from', conn.peer);
        showTransferUI(conn.peer);
        systemMessage('systemConnected');
        closeQRModal();
      });
      conn.on('data', (data) => handleIncomingData(data));
      conn.on('close', () => {
        systemMessage('systemClosed');
        resetUI();
      });
      conn.on('error', (err) => {
        console.error('conn error:', err);
        statusText.textContent = t('failed');
        statusText.style.color = 'var(--danger)';
      });
    });

    peer.on('error', (err) => {
      console.error('peer error:', err);
      if (err.type === 'unavailable-id') {
        myId = Math.floor(1000 + Math.random() * 9000).toString();
        myIdDisplay.textContent = myId;
        try { peer.destroy(); } catch (_) {}
        initPeer();
      } else {
        statusText.textContent = t('failed');
        statusText.style.color = 'var(--danger)';
      }
    });
  }

  /* ========================================================================
     11. connectToPeer
     ======================================================================== */
  async function connectToPeer(targetId) {
    console.log('connectToPeer called with:', targetId);

    if (!targetId || !targetId.trim()) {
      console.warn('connectToPeer: invalid targetId');
      statusText.textContent = t('failed');
      statusText.style.color = 'var(--danger)';
      return;
    }

    targetId = targetId.trim();
    updateScannerState('scanning');

    if (!peer || !peer.id) {
      console.log('Local peer not ready. Waiting...');
      let waited = 0;
      while ((!peer || !peer.id) && waited < 5000) {
        await new Promise(resolve => setTimeout(resolve, 200));
        waited += 200;
      }
      if (!peer || !peer.id) {
        console.error('PeerJS not ready after waiting');
        statusText.textContent = t('failed');
        statusText.style.color = 'var(--danger)';
        updateScannerState('idle');
        return;
      }
    }

    try {
      if (conn && conn.open && conn.peer === targetId) {
        console.log('Already connected to', targetId);
        showTransferUI(conn.peer);
        statusText.textContent = t('connected');
        return;
      }
    } catch (e) {
      console.warn('Error checking existing conn:', e);
    }

    if (conn) {
      try { conn.close(); } catch (e) { /* ignore */ }
      conn = null;
    }

    statusText.innerHTML = '<span class="loading"></span> ' + t('connecting');
    statusText.dataset.custom = 'true';
    statusText.style.color = '';

    try {
      const newConn = peer.connect(targetId, { reliable: true });
      conn = newConn;

      newConn.on('open', () => {
        console.log('PeerJS connection opened:', conn.peer);
        showTransferUI(conn.peer);
        systemMessage('systemConnected');
        statusText.textContent = t('connected');
        statusText.dataset.custom = 'false';
      });

      newConn.on('data', (data) => handleIncomingData(data));

      newConn.on('close', () => {
        console.log('Connection closed with', targetId);
        systemMessage('systemClosed');
        resetUI();
      });

      newConn.on('error', (err) => {
        console.error('PeerJS connection error:', err);
        statusText.textContent = t('failed');
        statusText.style.color = 'var(--danger)';
        conn = null;
        updateScannerState('idle');
      });

    } catch (err) {
      console.error('connectToPeer threw:', err);
      statusText.textContent = t('failed');
      statusText.style.color = 'var(--danger)';
      conn = null;
      updateScannerState('idle');
    }
  }

  /* ========================================================================
     12. File transfer (chunked)
     ======================================================================== */
  const incomingTransfers = new Map();

  function waitForConnectionOpen(connection, timeout = 15000) {
    return new Promise((resolve, reject) => {
      if (!connection) return reject(new Error('No active connection.'));
      if (connection.open) return resolve();
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const onOpen = () => finish(resolve);
      const onError = (err) => finish(reject, err || new Error('Connection error.'));
      const onClose = () => finish(reject, new Error('Connection closed before transfer.'));
      const timer = setTimeout(() => finish(reject, new Error('Connection timeout.')), timeout);
      connection.on('open', onOpen);
      connection.on('error', onError);
      connection.on('close', onClose);
    });
  }

  function handleIncomingData(data) {
    if (!data) return;
    if (data.type === 'text') {
      addMessage('Peer', data.payload, 'received');
      return;
    }
    if (data.type === 'file-start') {
      incomingTransfers.set(data.transferId, {
        filename: data.filename || 'file',
        filetype: data.filetype || 'application/octet-stream',
        filesize: data.filesize || 0,
        totalChunks: data.totalChunks || 0,
        chunks: new Array(data.totalChunks || 0),
        receivedChunks: 0,
        metadata: data.metadata || {}
      });
      return;
    }
    if (data.type === 'file-chunk') {
      receiveFileChunk(data);
      return;
    }
    if (data.type === 'file' || data.type === 'file-complete') {
      receiveFile(data);
      return;
    }
  }

  function receiveFileChunk(data) {
    const transfer = incomingTransfers.get(data.transferId);
    if (!transfer) return;
    if (!transfer.chunks[data.chunkIndex]) {
      transfer.chunks[data.chunkIndex] = data.payload;
      transfer.receivedChunks += 1;
    }
    if (transfer.receivedChunks >= transfer.totalChunks) {
      const parts = transfer.chunks.map(part =>
        part instanceof ArrayBuffer ? part : new Uint8Array(part).buffer
      );
      const blob = new Blob(parts, { type: transfer.filetype });
      incomingTransfers.delete(data.transferId);
      showReceivedBlob(blob, transfer.filename, transfer.filetype, transfer.filesize);
    }
  }

  function receiveFile(data) {
    const payload = data.payload;
    if (payload instanceof ArrayBuffer) {
      const blob = new Blob([payload], { type: data.filetype || 'application/octet-stream' });
      showReceivedBlob(blob, data.filename || 'file', data.filetype, data.filesize);
      return;
    }
    if (typeof payload !== 'string') return;
    if (payload.startsWith('data:')) {
      fetch(payload)
        .then(res => res.blob())
        .then(blob => showReceivedBlob(blob, data.filename || 'file', data.filetype, data.filesize))
        .catch(err => {
          console.error('Failed to decode file:', err);
          systemMessage('systemError', { name: data.filename || 'file' });
        });
    }
  }

  function showReceivedBlob(blob, filename, filetype, filesize) {
    const url = URL.createObjectURL(blob);
    const mimeType = blob.type || filetype || 'application/octet-stream';
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message received';

    const info = document.createElement('div');
    info.innerHTML = '<strong>' + ICONS.paperclip + ' ' + escapeHtml(filename) + '</strong>';
    if (filesize) {
      const size = formatFileSize(filesize);
      info.innerHTML += '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">' + size + '</div>';
    }
    msgDiv.appendChild(info);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.className = 'btn btn-success';
    link.style.cssText = 'margin-top:8px;padding:6px 12px;font-size:0.8rem;display:inline-flex;align-items:center;gap:6px;';
    link.innerHTML = ICONS.download + ' ' + escapeHtml(t('fileDownload'));
    msgDiv.appendChild(link);

    if (mimeType.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = url;
      img.className = 'file-preview';
      img.style.maxHeight = '160px';
      msgDiv.appendChild(img);
    } else if (mimeType.startsWith('video/')) {
      const vid = document.createElement('video');
      vid.src = url;
      vid.controls = true;
      vid.className = 'file-preview';
      vid.style.maxHeight = '160px';
      msgDiv.appendChild(vid);
    }
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  async function sendFile(file, metadata) {
    if (!conn) {
      systemMessage('systemError', { name: file.name });
      return;
    }
    try {
      await waitForConnectionOpen(conn);
      const CHUNK_SIZE = 48 * 1024;
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      const transferId = generateUUID();
      const sendName = (metadata && (metadata.relativePath || metadata.filename)) || file.name;

      conn.send({
        type: 'file-start',
        transferId,
        filename: sendName,
        filetype: file.type || 'application/octet-stream',
        filesize: file.size,
        totalChunks,
        metadata: metadata || {}
      });

      for (let index = 0; index < totalChunks; index++) {
        const start = index * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const buffer = await file.slice(start, end).arrayBuffer();
        conn.send({
          type: 'file-chunk',
          transferId,
          chunkIndex: index,
          totalChunks,
          payload: buffer
        });
        if (index % 8 === 0) {
          await new Promise(resolve => setTimeout(resolve, 8));
        }
      }

      conn.send({ type: 'file-complete', transferId });
      systemMessage('systemSent', { name: sendName });
    } catch (err) {
      console.error('File transfer error:', err);
      systemMessage('systemError', { name: file.name });
    }
  }

  function handleFiles(files, label) {
    if (!conn || !files || !files.length) return;
    const list = Array.from(files);
    for (const file of list) {
      systemMessage('systemSending', { name: file.name });
      sendFile(file, { label: label || 'file' });
    }
  }

  fileInput.addEventListener('change', function (e) {
    handleFiles(e.target.files, 'document');
    this.value = '';
  });
  imageInput.addEventListener('change', function (e) {
    handleFiles(e.target.files, 'image');
    this.value = '';
  });
  videoInput.addEventListener('change', function (e) {
    handleFiles(e.target.files, 'video');
    this.value = '';
  });
  folderInput.addEventListener('change', async function (e) {
    const files = Array.from(e.target.files || []);
    if (!files.length || !conn) return;
    const folderName = (files[0].webkitRelativePath || files[0].name).split('/')[0];
    systemMessage('systemFolder', { name: folderName, count: files.length });
    try {
      await waitForConnectionOpen(conn);
      for (const file of files) {
        await sendFile(file, { folder: true, relativePath: file.webkitRelativePath || file.name });
      }
      systemMessage('systemFolderSent', { name: folderName });
    } catch (err) {
      console.error('Folder transfer error:', err);
      systemMessage('systemError', { name: folderName });
    } finally {
      this.value = '';
    }
  });

  // Drop zone alternate triggers
  if (dropChooseFiles) {
    dropChooseFiles.addEventListener('click', () => dropFileInput && dropFileInput.click());
  }
  if (dropChooseFolder) {
    dropChooseFolder.addEventListener('click', () => dropFolderInput && dropFolderInput.click());
  }
  if (dropFileInput) {
    dropFileInput.addEventListener('change', function (e) {
      handleFiles(e.target.files, 'document');
      this.value = '';
    });
  }
  if (dropFolderInput) {
    dropFolderInput.addEventListener('change', async function (e) {
      const files = Array.from(e.target.files || []);
      if (!files.length || !conn) return;
      const folderName = (files[0].webkitRelativePath || files[0].name).split('/')[0];
      systemMessage('systemFolder', { name: folderName, count: files.length });
      try {
        await waitForConnectionOpen(conn);
        for (const file of files) {
          await sendFile(file, { folder: true, relativePath: file.webkitRelativePath || file.name });
        }
        systemMessage('systemFolderSent', { name: folderName });
      } catch (err) {
        console.error('Folder transfer error:', err);
        systemMessage('systemError', { name: folderName });
      } finally {
        this.value = '';
      }
    });
  }

  /* ========================================================================
     13. Drag and drop - drop zone + whole window support
     ======================================================================== */
  let dragCounter = 0;

  function isTransferActive() {
    return transferArea && transferArea.classList.contains('active');
  }

  function highlightDropZone(on) {
    if (dropZone) dropZone.classList.toggle('is-dragging', on);
  }

  // Window-level drag tracking. Always preventDefault for file drags so the
  // browser does not navigate to the dropped file.
  function isFileDrag(e) {
    if (!e.dataTransfer) return false;
    const types = e.dataTransfer.types || [];
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true;
    }
    return false;
  }

  function notifyNoPeerForDrop() {
    if (!statusText) return;
    const prev = statusText.textContent;
    const wasCustom = statusText.dataset.custom === 'true';
    statusText.textContent = 'Connect to a peer first to drop files';
    statusText.dataset.custom = 'true';
    statusText.style.color = 'var(--warning)';
    setTimeout(() => {
      if (statusText.dataset.custom === 'true') {
        statusText.textContent = wasCustom ? prev : t('ready');
        statusText.dataset.custom = wasCustom ? 'true' : 'false';
        statusText.style.color = '';
      }
    }, 2600);
  }

  window.addEventListener('dragenter', function (e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (isTransferActive()) {
      dragCounter += 1;
      highlightDropZone(true);
    }
  });

  window.addEventListener('dragover', function (e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('dragleave', function (e) {
    if (!isFileDrag(e)) return;
    if (!isTransferActive()) return;
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) highlightDropZone(false);
  });

  window.addEventListener('drop', async function (e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCounter = 0;
    highlightDropZone(false);

    if (!isTransferActive()) {
      notifyNoPeerForDrop();
      return;
    }

    const dt = e.dataTransfer;
    if (!dt) return;
    const items = dt.items;
    const files = [];

    // Try to use DataTransferItemList (preserves webkitRelativePath for folders)
    if (items && items.length && typeof DataTransferItem !== 'undefined' && items[0].webkitGetAsEntry) {
      const entries = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
        if (entry) entries.push(entry);
      }
      if (entries.length) {
        for (const entry of entries) {
          const entryFiles = await collectEntryFiles(entry);
          for (const f of entryFiles) files.push(f);
        }
        if (files.length) {
          await sendDroppedFiles(files);
          return;
        }
      }
    }

    // Fallback: plain FileList
    if (dt.files && dt.files.length) {
      for (const f of dt.files) files.push(f);
      if (files.length) await sendDroppedFiles(files);
    }
  });

  function readEntryPromise(entry) {
    return new Promise((resolve) => entry.file(resolve, () => resolve(null)));
  }

  function readEntriesPromise(dirReader) {
    return new Promise((resolve) => dirReader.readEntries(resolve, () => resolve([])));
  }

  async function collectEntryFiles(entry, pathPrefix) {
    pathPrefix = pathPrefix || '';
    const out = [];
    if (entry.isFile) {
      const file = await readEntryPromise(entry);
      if (file) {
        // Synthetic webkitRelativePath for downstream metadata
        try {
          Object.defineProperty(file, 'webkitRelativePath', {
            value: pathPrefix + file.name,
            writable: false,
            configurable: false
          });
        } catch (_) {}
        out.push(file);
      }
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let allEntries = [];
      let batch = await readEntriesPromise(reader);
      while (batch.length) {
        allEntries = allEntries.concat(batch);
        batch = await readEntriesPromise(reader);
      }
      for (const child of allEntries) {
        const nested = await collectEntryFiles(child, pathPrefix + entry.name + '/');
        for (const f of nested) out.push(f);
      }
    }
    return out;
  }

  async function sendDroppedFiles(files) {
    if (!conn) {
      systemMessage('systemError', { name: files.length + ' file(s)' });
      return;
    }
    const hasFolder = files.some(f => f.webkitRelativePath && f.webkitRelativePath.indexOf('/') > -1);
    if (hasFolder) {
      const folderName = (files.find(f => f.webkitRelativePath) || files[0]).webkitRelativePath.split('/')[0];
      systemMessage('systemFolder', { name: folderName, count: files.length });
      try {
        await waitForConnectionOpen(conn);
        for (const file of files) {
          await sendFile(file, { folder: true, relativePath: file.webkitRelativePath || file.name });
        }
        systemMessage('systemFolderSent', { name: folderName });
      } catch (err) {
        console.error('Drop folder transfer error:', err);
        systemMessage('systemError', { name: folderName });
      }
    } else {
      for (const file of files) {
        systemMessage('systemSending', { name: file.name });
        await sendFile(file, { label: 'drag-drop' });
      }
    }
  }

  // Also forward drops directly onto the drop zone to the same handler
  if (dropZone) {
    dropZone.addEventListener('drop', function (e) {
      // Handled by window-level listener above; just prevent bubbling side effects
      e.stopPropagation();
    });
  }

  /* ========================================================================
     14. Send message
     ======================================================================== */
  function sendMessage() {
    const text = msgInput.value.trim();
    if ((!text && pendingAttachments.length === 0) || !conn) return;
    for (const file of pendingAttachments) {
      systemMessage('systemSending', { name: file.name });
      sendFile(file, { label: 'pasted-text', source: 'paste-intercept' });
    }
    if (text) {
      conn.send({ type: 'text', payload: text });
      addMessage('Me', text, 'sent');
    }
    pendingAttachments = [];
    renderPendingAttachments();
    msgInput.value = '';
  }

  sendBtn.addEventListener('click', sendMessage);
  msgInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  connectBtn.addEventListener('click', function () {
    const target = targetIdInput.value.trim();
    if (target) connectToPeer(target);
  });

  disconnectBtn.addEventListener('click', function () {
    if (conn) {
      try { conn.close(); } catch (_) {}
      resetUI();
      systemMessage('systemClosed');
    }
  });

  copyIdBtn.addEventListener('click', function () {
    const id = myIdDisplay.textContent;
    const btn = this;
    function showCopied() {
      const original = btn.innerHTML;
      btn.innerHTML = ICONS.check;
      setTimeout(() => { btn.innerHTML = original; }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(id).then(showCopied).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = id;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        ta.remove();
        showCopied();
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = id;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      ta.remove();
      showCopied();
    }
  });

  /* ========================================================================
     15. QR modal logic (Postbase-backed pairing preserved)
     ======================================================================== */
  const qrModalOverlay       = document.getElementById('qrModalOverlay');
  const qrModalClose         = document.getElementById('qrModalClose');
  const qrOpenBtn            = document.getElementById('qrOpenBtn');
  const qrRefreshBtn         = document.getElementById('qrRefreshBtn');
  const qrToggleScanBtn      = document.getElementById('qrToggleScanBtn');
  const qrStatus             = document.getElementById('qrStatus');
  const qrCodeContainer     = document.getElementById('qrCodeContainer');
  const qrScannerContainer   = document.getElementById('qrScannerContainer');
  const qrScanError          = document.getElementById('qrScanError');
  const qrChoiceView         = document.getElementById('qrChoiceView');
  const qrChooseShowBtn      = document.getElementById('qrChooseShowBtn');
  const qrChooseScanBtn      = document.getElementById('qrChooseScanBtn');
  const qrDisplayArea        = document.getElementById('qrDisplayArea');
  const qrScannerView        = document.getElementById('qrScannerView');
  const qrBackToChoicesBtn   = document.getElementById('qrBackToChoicesBtn');
  const qrBackFromScannerBtn = document.getElementById('qrBackFromScannerBtn');
  const qrModalTitle         = document.getElementById('qrModalTitle');

  let activeSessionId = null;
  let activeSubscription = null;
  let qrCodeInstance = null;
  let html5QrCode = null;
  let scannerActive = false;
  let isQrGenerating = false;

  function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async function generateQRSession() {
    if (isQrGenerating) return;
    isQrGenerating = true;
    qrStatus.textContent = t('qrConnecting') + '...';
    qrScanError.textContent = '';

    const sessionId = generateUUID();
    const desktopPeerId = myId;

    try {
      // Postbase-backed create - exact contract preserved
      await apiCreateSession(sessionId);
      activeSessionId = sessionId;

      const qrData = JSON.stringify({ sessionId: sessionId, peerId: desktopPeerId });

      qrCodeContainer.innerHTML = '';
      qrCodeInstance = new QRCode(qrCodeContainer, {
        text: qrData,
        width: 200,
        height: 200,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });

      qrStatus.textContent = t('qrWaiting');
      qrStatus.dataset.manual = 'true';
      qrStatus.style.color = '';

      if (activeSubscription) {
        clearInterval(activeSubscription);
        activeSubscription = null;
      }

      activeSubscription = setInterval(async () => {
        try {
          // Postbase-backed read - exact contract preserved
          const data = await apiGetSession(sessionId);
          const row = data && data.session;
          if (row && row.status === 'connected') {
            qrStatus.textContent = t('qrConnected');
            qrStatus.style.color = 'var(--success)';
            clearInterval(activeSubscription);
            activeSubscription = null;
            setTimeout(() => { closeQRModal(); }, 1500);
          }
        } catch (pollError) {
          console.warn('Session poll error:', pollError);
        }
      }, 1500);

    } catch (err) {
      console.error('QR session error:', err);
      qrStatus.textContent = t('qrError', { msg: err.message || 'Unknown' });
      qrStatus.style.color = 'var(--danger)';
    } finally {
      isQrGenerating = false;
    }
  }

  function refreshQR() {
    if (activeSubscription) {
      clearInterval(activeSubscription);
      activeSubscription = null;
    }
    activeSessionId = null;
    qrStatus.style.color = '';
    qrScanError.textContent = '';
    generateQRSession();
  }

  function closeQRModal() {
    qrModalOverlay.classList.remove('open');
    stopScanner();
    if (activeSubscription) {
      clearInterval(activeSubscription);
      activeSubscription = null;
    }
    qrScanError.textContent = '';
    qrStatus.style.color = '';
    qrChoiceView.style.display = 'flex';
    qrDisplayArea.style.display = 'none';
    qrScannerView.style.display = 'none';
    if (conn && conn.open) {
      showTransferUI(conn.peer);
    }
  }

  function openQRModal() {
    qrModalOverlay.classList.add('open');
    showQRChoices();
  }

  function showQRChoices() {
    stopScanner();
    qrChoiceView.style.display = 'flex';
    qrDisplayArea.style.display = 'none';
    qrScannerView.style.display = 'none';
    qrScanError.textContent = '';
    qrStatus.style.color = '';
    qrModalTitle.textContent = 'Connect via QR';
  }

  async function showMyQR() {
    stopScanner();
    qrChoiceView.style.display = 'none';
    qrScannerView.style.display = 'none';
    qrDisplayArea.style.display = 'flex';
    qrScanError.textContent = '';
    qrStatus.style.color = '';
    qrModalTitle.textContent = 'Show my QR';

    if (activeSessionId) {
      if (activeSubscription) {
        clearInterval(activeSubscription);
        activeSubscription = null;
      }
      activeSessionId = null;
    }
    await generateQRSession();
  }

  async function startScannerMode() {
    stopScanner();
    qrChoiceView.style.display = 'none';
    qrDisplayArea.style.display = 'none';
    qrScannerView.style.display = 'block';
    qrScanError.textContent = '';
    qrModalTitle.textContent = 'Scan QR Code';

    try {
      if (!window.Html5Qrcode) {
        throw new Error('QR scanner library failed to load.');
      }
      html5QrCode = new Html5Qrcode('qrScannerContainer');
      const config = {
        fps: 10,
        qrbox: { width: 240, height: 240 },
        aspectRatio: 1.0,
        rememberLastUsedCamera: true
      };
      await html5QrCode.start(
        { facingMode: { exact: 'environment' } },
        config,
        onScanSuccess,
        onScanError
      );
      scannerActive = true;
    } catch (firstErr) {
      console.warn('Rear camera failed, trying default:', firstErr);
      try {
        if (html5QrCode) {
          try { await html5QrCode.clear(); } catch (_) {}
        }
        html5QrCode = new Html5Qrcode('qrScannerContainer');
        const config = {
          fps: 10,
          qrbox: { width: 240, height: 240 },
          aspectRatio: 1.0,
          rememberLastUsedCamera: true
        };
        const cameras = await Html5Qrcode.getCameras();
        if (!cameras || !cameras.length) {
          throw new Error('No camera found.');
        }
        const rear = cameras.find(c => /back|rear|environment/i.test(c.label));
        const cameraId = (rear || cameras[0]).id;
        await html5QrCode.start(cameraId, config, onScanSuccess, onScanError);
        scannerActive = true;
      } catch (secondErr) {
        console.error('Camera start failed:', secondErr);
        const message = (secondErr && secondErr.message) || (firstErr && firstErr.message) || 'Unable to open camera.';
        qrScanError.innerHTML = '<strong>Camera could not be opened.</strong><br>' +
          escapeHtml(message) + '<br><br>Make sure HTTPS is enabled and camera permission granted.';
        scannerActive = false;
      }
    }
  }

  async function stopScanner() {
    if (html5QrCode) {
      try {
        if (scannerActive) {
          await html5QrCode.stop();
        }
      } catch (_) {}
      try { await html5QrCode.clear(); } catch (_) {}
      html5QrCode = null;
    }
    scannerActive = false;
  }

  async function onScanSuccess(decodedText) {
    console.log('QR decoded:', decodedText);

    await stopScanner();

    let peerId = null;
    let sessionId = null;

    try {
      const data = JSON.parse(decodedText);
      peerId = data.peerId || data.targetPeerId || null;
      sessionId = data.sessionId || null;
    } catch (e) {
      const plain = String(decodedText || '').trim();
      if (/^[A-Za-z0-9\-_]{2,64}$/.test(plain)) peerId = plain;
    }

    console.log('QR target peer ID:', peerId);
    console.log('QR session ID:', sessionId);

    qrStatus.textContent = t('qrConnecting');
    qrScanError.textContent = '';

    if (!peerId) {
      qrScanError.textContent = 'Invalid QR data. Missing peer ID.';
      console.error('Invalid QR, no peerId found.');
      return;
    }

    try {
      if (!peer || !peer.id) {
        console.log('Peer not ready, waiting...');
        let waited = 0;
        while ((!peer || !peer.id) && waited < 5000) {
          await new Promise(resolve => setTimeout(resolve, 200));
          waited += 200;
        }
      }
      if (!peer || !peer.id) {
        throw new Error('PeerJS is not ready. Refresh and try again.');
      }

      connectToPeer(peerId);

      const start = Date.now();
      const timeout = 15000;

      (function waitForConnection() {
        if (conn && conn.open) {
          console.log('Connection opened after QR scan, peer:', conn.peer);
          qrStatus.textContent = t('qrConnected');
          qrStatus.style.color = 'var(--success)';

          // Postbase-backed connect - exact contract preserved
          if (sessionId) {
            apiMarkConnected(sessionId)
              .then(() => console.log('Session marked as connected'))
              .catch(e => console.warn('Session update failed:', e));
          }

          setTimeout(() => { closeQRModal(); }, 700);
          return;
        }
        if (Date.now() - start > timeout) {
          qrScanError.textContent = 'Connection timed out. Try scanning again.';
          console.error('QR connection timed out for peerId', peerId);
          return;
        }
        setTimeout(waitForConnection, 200);
      })();

    } catch (err) {
      console.error('QR connection error:', err);
      qrScanError.textContent = 'Connection failed: ' + (err.message || err);
    }
  }

  function onScanError() {
    // Continuous scanning errors are ignored
  }

  qrOpenBtn.addEventListener('click', openQRModal);
  qrModalClose.addEventListener('click', closeQRModal);
  qrRefreshBtn.addEventListener('click', showMyQR);
  qrChooseShowBtn.addEventListener('click', showMyQR);
  qrChooseScanBtn.addEventListener('click', startScannerMode);
  qrToggleScanBtn.addEventListener('click', startScannerMode);
  qrBackToChoicesBtn.addEventListener('click', showQRChoices);
  qrBackFromScannerBtn.addEventListener('click', showQRChoices);

  qrModalOverlay.addEventListener('click', function (e) {
    if (e.target === this) closeQRModal();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.keyCode === 27) {
      if (qrModalOverlay.classList.contains('open')) {
        closeQRModal();
      }
    }
  });

  /* ========================================================================
     16. Init
     ======================================================================== */
  initPeer();
  updateUI();
  updateScannerState('idle');

  // Public hooks (kept for parity with original)
  window.__webdropQR = {
    openQRModal: openQRModal,
    closeQRModal: closeQRModal,
    refreshQR: refreshQR,
    connectToPeer: connectToPeer,
    refreshConnection: refreshConnection
  };
})();
