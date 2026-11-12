// ============================================================================
// signaling.js - polling-based WebRTC signaling client
// Talks to the /api/signaling/* Cloudflare Functions. Polls every 1 second
// for new messages addressed to this peer during connection setup.
//
// IMPORTANT: messages are delivered to onMessage serially. The WebRTC
// handshake is order-sensitive (offer must be applied before ICE candidates),
// and the polling layer can return multiple messages per response. We
// therefore await onMessage() for each message so that an async handler in
// app.js can fully apply the offer before we hand it the next ICE candidate.
// Without this, ICE candidates that arrived in the same poll batch as the
// offer were being applied before setRemoteDescription() finished, and the
// browser silently dropped them - the root cause of the original
// "DataChannel timeout" bug.
// ============================================================================

class SignalingClient {
  constructor(peerId, sessionCode) {
    this.peerId = peerId;
    this.sessionCode = sessionCode;
    // Adaptive polling: start fast (300ms) during setup, slow down to 1.5s
    // once the connection is established. The signalling layer only needs
    // to be quick during the SDP / ICE exchange - afterwards the DataChannel
    // itself carries all traffic.
    this.pollIntervalFastMs = 300;
    this.pollIntervalSlowMs = 1500;
    this.pollIntervalMs = this.pollIntervalFastMs;
    this.pollTimer = null;
    this.consumedIds = [];
    this.onMessage = null;     // async callback(message)
    this.onSessionError = null; // callback(reason)
    this.polling = false;
    this._inflight = false;    // prevents overlapping polls
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

  // Slow down polling once the WebRTC connection is established - the
  // DataChannel carries everything from then on, so we only need the
  // polling layer to stay alive in case of a reconnect.
  setSlowPolling() {
    this.pollIntervalMs = this.pollIntervalSlowMs;
  }

  // Start the polling loop. Calls onMessage for each new message, serially.
  startPolling() {
    if (this.polling) return;
    this.polling = true;

    const tick = async () => {
      if (!this.polling) return;
      // Don't overlap polls - if a previous poll is still in flight, wait.
      if (this._inflight) {
        if (this.polling) this.pollTimer = setTimeout(tick, 200);
        return;
      }
      this._inflight = true;
      try {
        const data = await this.pollOnce();
        if (!data.ok) {
          if (this.onSessionError) this.onSessionError(data.reason);
          this.stopPolling();
          this._inflight = false;
          return;
        }
        const messages = data.messages || [];
        const idsToConsume = [];
        for (const msg of messages) {
          idsToConsume.push(msg.id);
          // Await each message handler so the offer/answer handshake runs
          // to completion before we deliver the next ICE candidate. This
          // is the fix for the dropped-candidate race condition.
          if (this.onMessage) {
            try {
              await this.onMessage(msg);
            } catch (e) {
              console.error('Signaling message handler error:', e.message);
            }
          }
        }
        // Mark consumed asynchronously - don't block the next poll.
        if (idsToConsume.length) this.markConsumed(idsToConsume);
      } catch (e) {
        console.error('Poll error:', e.message);
        // Network error - keep trying, don't stop polling.
      } finally {
        this._inflight = false;
      }
      if (this.polling) {
        this.pollTimer = setTimeout(tick, this.pollIntervalMs);
      }
    };
    tick();
  }

  stopPolling() {
    this.polling = false;
    this._inflight = false;
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
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0,O,1,I)
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
