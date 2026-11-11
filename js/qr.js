// ============================================================================
// qr.js - QR code generation and scanning helpers
//
// Generation uses the qrcodejs library (loaded via CDN script tag in HTML).
// Scanning uses html5-qrcode (loaded via CDN script tag in HTML).
// Both are accessed via the global window.QRCode and window.Html5Qrcode.
//
// The QR code contains only the session_code and a join URL - never any
// credentials, file contents, or private backend information.
// ============================================================================

// Generate a QR code into a DOM container.
// Returns nothing; the QR is rendered into the container.
function generateQR(text, container) {
  if (!window.QRCode) {
    throw new Error('QRCode library not loaded');
  }
  container.innerHTML = '';
  new window.QRCode(container, {
    text: text,
    width: 200,
    height: 200,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: window.QRCode.CorrectLevel.M
  });
}

// Build the QR payload. Contains only public info: the join URL and
// session code. A scanner visits the URL which triggers the join flow.
function buildQRPayload(sessionCode, baseUrl) {
  const url = baseUrl + '/?join=' + sessionCode;
  return JSON.stringify({
    type: 'webdrop',
    version: 1,
    url: url,
    code: sessionCode
  });
}

// QR scanner wrapper using html5-qrcode.
class QRScanner {
  constructor(containerId) {
    this.containerId = containerId;
    this.html5QrCode = null;
    this.scanning = false;
  }

  async start(onScan, onError) {
    if (!window.Html5Qrcode) {
      if (onError) onError(new Error('QR scanner library not loaded'));
      return;
    }
    if (this.scanning) return;
    this.scanning = true;

    const config = {
      fps: 10,
      qrbox: { width: 240, height: 240 },
      aspectRatio: 1.0,
      rememberLastUsedCamera: true
    };

    const onSuccess = (decodedText) => {
      if (onScan) onScan(decodedText);
    };
    const onFailure = () => {
      // Continuous scanning errors are normal - ignored.
    };

    try {
      this.html5QrCode = new window.Html5Qrcode(this.containerId);
      // Try rear camera first, fall back to default.
      try {
        await this.html5QrCode.start(
          { facingMode: { exact: 'environment' } },
          config,
          onSuccess,
          onFailure
        );
      } catch (firstErr) {
        const cameras = await window.Html5Qrcode.getCameras();
        if (!cameras || !cameras.length) throw new Error('No camera found');
        const rear = cameras.find(c => /back|rear|environment/i.test(c.label));
        const camId = (rear || cameras[0]).id;
        await this.html5QrCode.start(camId, config, onSuccess, onFailure);
      }
    } catch (e) {
      this.scanning = false;
      if (onError) onError(e);
    }
  }

  async stop() {
    if (!this.html5QrCode || !this.scanning) return;
    try {
      await this.html5QrCode.stop();
      await this.html5QrCode.clear();
    } catch (_) {}
    this.scanning = false;
    this.html5QrCode = null;
  }
}

// Parse a scanned QR payload. Returns { url, code } or null if invalid.
function parseQRPayload(text) {
  if (!text) return null;
  // Try JSON first (our format).
  try {
    const data = JSON.parse(text);
    if (data.type === 'webdrop' && data.code && /^[A-Z0-9]{12}$/.test(data.code)) {
      return { url: data.url, code: data.code };
    }
  } catch (_) {}
  // Fallback: plain 12-char code.
  const cleaned = String(text).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z0-9]{12}$/.test(cleaned)) {
    return { url: null, code: cleaned };
  }
  // Fallback: URL with ?join=CODE
  try {
    const u = new URL(text);
    const joinCode = u.searchParams.get('join');
    if (joinCode && /^[A-Z0-9]{12}$/.test(joinCode.toUpperCase())) {
      return { url: u.origin + u.pathname, code: joinCode.toUpperCase() };
    }
  } catch (_) {}
  return null;
}

export { generateQR, buildQRPayload, QRScanner, parseQRPayload };
