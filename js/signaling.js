// ============================================================================
// signaling.js - polling-based WebRTC signaling client
// Talks to the /api/signaling/* Cloudflare Functions. Polls every 1 second
// for new messages addressed to this peer during connection setup.
// ============================================================================

class SignalingClient {
  constructor(peerId, sessionCode) {
    this.peerId = peerId;
    this.sessionCode = sessionCode;
    this.pollIntervalMs = 1000;
    this.pollTimer = null;
    this.consumedIds = [];
    this.onMessage = null;     // callback(message)
    this.onSessionError = null; // callback(reason)
    this.polling = false;
  }

  // Write a signaling message to the database.
  async writeMessage(toPeerId, messageType, payload) {
    const res = await fetch('/api/signaling/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_code: this.sessionCode,
        from_peer_id: this.peerId,
        to_peer_id: toPeerId,
        message_type: messageType,
        payload: typeof payload === 'string' ? payload : JSON.stringify(payload)
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Signaling write failed');
    return data.id;
  }

  // Fetch unconsumed messages addressed to this peer.
  async pollOnce() {
    const url = `/api/signaling/poll?peer_id=${encodeURIComponent(this.peerId)}&session_code=${encodeURIComponent(this.sessionCode)}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Poll failed');
    return data;
  }

  // Mark consumed messages so they aren't returned again.
  async markConsumed(ids) {
    if (!ids || !ids.length) return;
    await fetch('/api/signaling/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peer_id: this.peerId, ids: ids })
    });
  }

  // Start the polling loop. Calls onMessage for each new message.
  startPolling() {
    if (this.polling) return;
    this.polling = true;

    const tick = async () => {
      if (!this.polling) return;
      try {
        const data = await this.pollOnce();
        if (!data.ok) {
          if (this.onSessionError) this.onSessionError(data.reason);
          this.stopPolling();
          return;
        }
        const messages = data.messages || [];
        const idsToConsume = [];
        for (const msg of messages) {
          idsToConsume.push(msg.id);
          if (this.onMessage) this.onMessage(msg);
        }
        // Mark consumed asynchronously - don't block the next poll.
        if (idsToConsume.length) this.markConsumed(idsToConsume);
      } catch (e) {
        console.error('Poll error:', e.message);
        // Network error - keep trying, don't stop polling.
      }
      if (this.polling) {
        this.pollTimer = setTimeout(tick, this.pollIntervalMs);
      }
    };
    tick();
  }

  stopPolling() {
    this.polling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

// Helper: generate a random 32-char lowercase alphanumeric peer_id.
function generatePeerId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const values = new Uint8Array(32);
  crypto.getRandomValues(values);
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars[values[i] % chars.length];
  }
  return out;
}

// Helper: generate a random 12-char uppercase alphanumeric session_code.
function generateSessionCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const values = new Uint8Array(12);
  crypto.getRandomValues(values);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += chars[values[i] % chars.length];
  }
  return out;
}

// Format a session code with hyphens for display: K7M3-X9P2-QR8T
function formatSessionCode(code) {
  return code.replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');
}

// Strip hyphens/spaces from a manually entered code.
function cleanSessionCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

export { SignalingClient, generatePeerId, generateSessionCode, formatSessionCode, cleanSessionCode };
