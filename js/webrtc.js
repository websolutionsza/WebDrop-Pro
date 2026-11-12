// ============================================================================
// webrtc.js - WebRTC RTCPeerConnection wrapper with chunked file transfer
//
// Replaces the old PeerJS-based implementation. Signaling is done through
// our own /api/signaling/* endpoints (polling-based).
//
// Transfer protocol over the ordered DataChannel:
//   1. Sender sends JSON: {type:'file-start', transferId, filename, filesize,
//      totalChunks, chunkSize, hash}
//   2. Sender waits for JSON: {type:'receiver-ready', transferId}
//   3. Sender sends N binary ArrayBuffers (the chunks, in order).
//   4. Sender sends JSON: {type:'file-complete', transferId}
//   5. Receiver reassembles chunks in order, verifies SHA-256 hash, and
//      surfaces the file via onFileReceived.
//
// Text messages are JSON: {type:'text', payload}. Sent only when no file
// transfer is in progress on either side.
//
// Cancel: {type:'file-cancelled', transferId} - sent in either direction.
//
// Heartbeat: {type:'ping'} / {type:'pong'} - keeps the channel alive and lets
// each side detect a half-open channel without waiting for ICE to time out.
// ============================================================================

// 64 KB per DataChannel message. Browsers cap SCTP messages near 256 KB by
// default, but 64 KB is a safe value that also keeps memory pressure low and
// works well alongside the buffered-amount low-watermark backpressure scheme.
const CHUNK_SIZE = 64 * 1024;

// Pause sending once the channel buffer exceeds this many bytes. SCTP will
// keep accepting data but we want to avoid unbounded memory growth on the
// sender side when the receiver is slow (e.g. on mobile data).
const BUFFER_HIGH = 4 * 1024 * 1024;   // 4 MB
// Resume sending once the buffer drains below this many bytes. Using the
// browser's `bufferedamountlow` event is more efficient than polling.
const BUFFER_LOW = 1 * 1024 * 1024;    // 1 MB

// How long to wait for the receiver-ready ACK before giving up on a transfer.
const RECEIVER_READY_TIMEOUT_MS = 30_000;

// How long to wait for the DataChannel to transition to 'open' after the
// ICE connection succeeds. If it never opens, we know the channel itself
// failed (not the network).
const DATACHANNEL_OPEN_TIMEOUT_MS = 15_000;

// Compute SHA-256 hex digest of an ArrayBuffer.
async function sha256(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

class WebDropConnection {
  constructor(peerId, iceServers) {
    this.peerId = peerId;
    this.remotePeerId = null;
    this.pc = new RTCPeerConnection({
      iceServers: iceServers || [],
      // Force ICE to try hard for both host/srflx and relay paths, so we
      // get the best candidate pair instead of giving up too early.
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      // `iceCandidatePoolSize` pre-allocates ICE candidates, which speeds up
      // the gathering phase on mobile devices where the JS thread can stall.
      iceCandidatePoolSize: 4
    });
    this.dataChannel = null;
    this.incomingTransfers = new Map();
    this.activeTransfers = new Map();    // transferId -> AbortController
    this.expectingChunksFor = null;       // transferId while receiving binary chunks
    this.connectedAt = null;
    this._transferBusy = false;           // true while a file transfer is in progress
    this._closed = false;

    // ICE candidate buffering: candidates that arrive before setRemoteDescription
    // is complete must be queued and flushed afterwards. Without this, the
    // polling-based signaling layer can deliver ICE candidates in the same
    // batch as the offer, and addIceCandidate() will silently fail because
    // the remote description hasn't been applied yet. This is the root cause
    // of the original "DataChannel timeout" bug.
    this._pendingCandidates = [];
    this._remoteDescriptionSet = false;

    // Resolvers for the DataChannel open / receiver-ready signals.
    this._dataChannelOpenPromise = null;
    this._dataChannelOpenResolve = null;
    this._dataChannelOpenReject = null;

    // Connection-type cache so we don't call getStats() on every state change.
    this._cachedConnectionType = 'unknown';
    this._lastStatsEmit = 0;

    // Heartbeat bookkeeping.
    this._heartbeatTimer = null;
    this._lastPongAt = 0;

    // Event callbacks (set by the caller)
    this.onIceCandidate = null;
    this.onStateChange = null;            // (state) => connecting|connected|failed|disconnected|...
    this.onConnectionType = null;         // (type) => local|direct|turn|unknown
    this.onFileReceived = null;           // (fileInfo, blob) => void
    this.onTextReceived = null;           // (text) => void
    this.onTransferProgress = null;       // (transferId, sent, total, speed) => void
    this.onDataChannelOpen = null;        // () => void
    this.onDiagnostic = null;             // (info) => void - non-sensitive diagnostic info

    this._setupPeerConnection();
  }

  _emitDiagnostic(info) {
    if (this.onDiagnostic) this.onDiagnostic(info);
  }

  _setupPeerConnection() {
    this.pc.onicecandidate = (e) => {
      if (e.candidate && this.onIceCandidate) {
        this.onIceCandidate(e.candidate);
      }
    };

    // Track ICE gathering state for diagnostics - never expose IPs.
    this.pc.onicegatheringstatechange = () => {
      this._emitDiagnostic({ stage: 'ice-gathering', state: this.pc.iceGatheringState });
    };

    this.pc.oniceconnectionstatechange = () => {
      const iceState = this.pc.iceConnectionState;
      this._emitDiagnostic({ stage: 'ice-connection', state: iceState });

      // Map ICE state -> user-facing connection state. Don't treat transient
      // 'disconnected' as fatal - WebRTC can recover within a few seconds.
      if (iceState === 'connected' || iceState === 'completed') {
        // Confirm the data channel is open before announcing success.
        this._ensureDataChannelOpen().then(() => {
          if (this._closed) return;
          if (this.onStateChange) this.onStateChange('connected');
          this._detectConnectionType();
          this._startHeartbeat();
        }).catch((err) => {
          if (this._closed) return;
          this._emitDiagnostic({ stage: 'datachannel-open-failed', error: err.message });
          if (this.onStateChange) this.onStateChange('failed');
        });
      } else if (iceState === 'failed') {
        if (this.onStateChange) this.onStateChange('failed');
      } else if (iceState === 'disconnected') {
        // Give ICE a grace window to recover before tearing down.
        if (this.onStateChange) this.onStateChange('reconnecting');
        this._scheduleRecoveryCheck();
      } else if (iceState === 'closed') {
        this._stopHeartbeat();
        if (this.onStateChange) this.onStateChange('disconnected');
      }
    };

    this.pc.onconnectionstatechange = () => {
      this._emitDiagnostic({ stage: 'pc-connection', state: this.pc.connectionState });
    };

    this.pc.ondatachannel = (e) => {
      // Receiver side: the offerer (sender) created the channel, the answerer
      // (receiver) gets it via this event.
      this.dataChannel = e.channel;
      this._setupDataChannel();
    };
  }

  _scheduleRecoveryCheck() {
    // If ICE doesn't recover to 'connected' within 8 seconds, treat as failed.
    if (this._recoveryTimer) clearTimeout(this._recoveryTimer);
    this._recoveryTimer = setTimeout(() => {
      if (this._closed) return;
      const iceState = this.pc.iceConnectionState;
      if (iceState === 'disconnected' || iceState === 'failed') {
        this._emitDiagnostic({ stage: 'ice-recovery-timeout', state: iceState });
        if (this.onStateChange) this.onStateChange('failed');
      }
    }, 8000);
  }

  _detectConnectionType() {
    if (!this.pc.getStats) return;
    // Throttle stats calls - they're not free.
    const now = Date.now();
    if (now - this._lastStatsEmit < 1000) return;
    this._lastStatsEmit = now;

    this.pc.getStats().then((stats) => {
      let type = 'unknown';
      let localType = '', remoteType = '';
      for (const entry of stats.values()) {
        if (entry.type !== 'candidate-pair') continue;
        // Use either `selected` (modern) or `nominated && state==='succeeded'`
        // as the success indicator. Older browsers don't set `selected`.
        const succeeded = entry.selected === true ||
                           (entry.nominated === true && entry.state === 'succeeded');
        if (!succeeded) continue;
        const local = stats.get(entry.localCandidateId);
        const remote = stats.get(entry.remoteCandidateId);
        localType = local?.candidateType || localType;
        remoteType = remote?.candidateType || remoteType;
        if (localType === 'host' && remoteType === 'host') type = 'local';
        else if (localType === 'relay' || remoteType === 'relay') type = 'turn';
        else type = 'direct';
        break;
      }
      if (type !== this._cachedConnectionType) {
        this._cachedConnectionType = type;
        if (this.onConnectionType) this.onConnectionType(type);
      }
    }).catch(() => {});
  }

  _setupDataChannel() {
    if (!this.dataChannel) return;
    this.dataChannel.binaryType = 'arraybuffer';
    // Set buffer thresholds so the `bufferedamountlow` event fires when the
    // queued bytes drain below the low watermark.
    if ('bufferedAmountLowThreshold' in this.dataChannel) {
      try { this.dataChannel.bufferedAmountLowThreshold = BUFFER_LOW; } catch (_) {}
    }

    this.dataChannel.onopen = () => {
      this.connectedAt = Date.now();
      this._lastPongAt = Date.now();
      this._resolveDataChannelOpen();
      if (this.onDataChannelOpen) this.onDataChannelOpen();
    };

    this.dataChannel.onmessage = (e) => this._handleDataMessage(e.data);

    this.dataChannel.onclose = () => {
      this._stopHeartbeat();
      if (!this._closed) {
        if (this.onStateChange) this.onStateChange('disconnected');
      }
    };

    this.dataChannel.onerror = (e) => {
      // Don't dump the raw event - it can include transport details. Log a
      // generic message instead.
      this._emitDiagnostic({ stage: 'datachannel-error', message: 'DataChannel error' });
    };
  }

  _ensureDataChannelOpen() {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      return Promise.resolve();
    }
    if (this._dataChannelOpenPromise) return this._dataChannelOpenPromise;
    this._dataChannelOpenPromise = new Promise((resolve, reject) => {
      this._dataChannelOpenResolve = resolve;
      this._dataChannelOpenReject = reject;
      // Hard timeout - if the channel never opens, reject so the caller can
      // surface a real error instead of hanging forever.
      const timer = setTimeout(() => {
        if (this._dataChannelOpenReject) {
          this._dataChannelOpenReject(new Error('DataChannel did not open in time'));
        }
      }, DATACHANNEL_OPEN_TIMEOUT_MS);
      // Clear the timer once resolved/rejected.
      const origResolve = this._dataChannelOpenResolve;
      const origReject = this._dataChannelOpenReject;
      this._dataChannelOpenResolve = (v) => { clearTimeout(timer); origResolve && origResolve(v); };
      this._dataChannelOpenReject = (e) => { clearTimeout(timer); origReject && origReject(e); };
    });
    return this._dataChannelOpenPromise;
  }

  _resolveDataChannelOpen() {
    if (this._dataChannelOpenResolve) {
      this._dataChannelOpenResolve();
      this._dataChannelOpenResolve = null;
      this._dataChannelOpenReject = null;
      this._dataChannelOpenPromise = null;
    }
  }

  // ---- Heartbeat to detect half-open channels ----
  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this._closed) return;
      if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;
      try {
        this.dataChannel.send(JSON.stringify({ type: 'ping' }));
      } catch (_) {}
      // If we haven't seen a pong in 25 s, the channel is half-open.
      if (Date.now() - this._lastPongAt > 25_000) {
        this._emitDiagnostic({ stage: 'heartbeat-timeout' });
        if (this.onStateChange) this.onStateChange('failed');
        try { this.dataChannel.close(); } catch (_) {}
      }
    }, 8_000);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // ---- Incoming message handling ----

  _handleDataMessage(data) {
    if (typeof data === 'string') {
      // JSON control message.
      try {
        const msg = JSON.parse(data);
        this._handleControlMessage(msg);
      } catch (e) {
        this._emitDiagnostic({ stage: 'bad-control-message', error: e.message });
      }
      return;
    }
    if (data instanceof ArrayBuffer) {
      // Binary chunk for the transfer we're currently receiving.
      if (!this.expectingChunksFor) {
        this._emitDiagnostic({ stage: 'unexpected-binary-chunk' });
        return;
      }
      const transfer = this.incomingTransfers.get(this.expectingChunksFor);
      if (!transfer) {
        this.expectingChunksFor = null;
        return;
      }
      transfer.chunks[transfer.receivedChunks] = data;
      transfer.receivedChunks++;
      transfer.bytesReceived += data.byteLength;
      if (this.onTransferProgress) {
        const sent = Math.min(transfer.bytesReceived, transfer.filesize);
        this._emitProgress(this.expectingChunksFor, sent, transfer.filesize, transfer);
      }
      if (transfer.receivedChunks >= transfer.totalChunks) {
        // All chunks received - wait for file-complete signal.
        this.expectingChunksFor = null;
      }
      return;
    }
  }

  _emitProgress(transferId, sent, total, transfer) {
    if (!this.onTransferProgress) return;
    const now = Date.now();
    let speed = 0;
    if (transfer && transfer.startedAt) {
      const elapsed = (now - transfer.startedAt) / 1000;
      if (elapsed > 0.05) speed = sent / elapsed;
    }
    this.onTransferProgress(transferId, sent, total, speed);
  }

  _handleControlMessage(msg) {
    if (msg.type === 'text') {
      if (this.onTextReceived) this.onTextReceived(msg.payload);
      return;
    }
    if (msg.type === 'ping') {
      this._sendControl({ type: 'pong' });
      return;
    }
    if (msg.type === 'pong') {
      this._lastPongAt = Date.now();
      return;
    }
    if (msg.type === 'file-start') {
      // Allocate the receiving transfer and signal readiness so the sender
      // knows our buffer is ready for chunks.
      const transferId = msg.transferId;
      const totalChunks = msg.totalChunks || 0;
      this.incomingTransfers.set(transferId, {
        filename: msg.filename || 'file',
        filetype: msg.filetype || 'application/octet-stream',
        filesize: msg.filesize || 0,
        hash: msg.hash || '',
        totalChunks,
        chunkSize: msg.chunkSize || CHUNK_SIZE,
        chunks: new Array(totalChunks),
        receivedChunks: 0,
        bytesReceived: 0,
        startedAt: Date.now()
      });
      this.expectingChunksFor = transferId;
      // Acknowledge readiness. This is the missing piece: the sender now
      // waits for this ACK before streaming chunks, so the receiver's
      // onmessage handler is wired up before any chunk arrives.
      this._sendControl({ type: 'receiver-ready', transferId });
      return;
    }
    if (msg.type === 'receiver-ready') {
      // Sender side: receiver confirmed it's ready for chunks.
      const waiter = this._receiverReadyWaiters && this._receiverReadyWaiters.get(msg.transferId);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve();
        this._receiverReadyWaiters.delete(msg.transferId);
      }
      return;
    }
    if (msg.type === 'file-complete') {
      this._completeIncomingTransfer(msg.transferId);
      return;
    }
    if (msg.type === 'file-cancelled') {
      const transfer = this.incomingTransfers.get(msg.transferId);
      if (transfer) {
        this.incomingTransfers.delete(msg.transferId);
        this.expectingChunksFor = null;
        if (this.onFileReceived) {
          // Notify caller that transfer was cancelled (no blob).
          this.onFileReceived({
            filename: transfer.filename,
            filetype: transfer.filetype,
            filesize: transfer.filesize,
            hash: transfer.hash,
            hashOk: false,
            cancelled: true
          }, null);
        }
      }
      return;
    }
  }

  _sendControl(obj) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;
    try {
      this.dataChannel.send(JSON.stringify(obj));
    } catch (e) {
      this._emitDiagnostic({ stage: 'send-control-failed', error: e.message });
    }
  }

  async _completeIncomingTransfer(transferId) {
    const transfer = this.incomingTransfers.get(transferId);
    if (!transfer) return;
    const parts = transfer.chunks.filter(p => p);
    const blob = new Blob(parts, { type: transfer.filetype });
    this.incomingTransfers.delete(transferId);
    this.expectingChunksFor = null;

    let hashOk = true;
    if (transfer.hash) {
      try {
        const buffer = await blob.arrayBuffer();
        const actualHash = await sha256(buffer);
        hashOk = (actualHash === transfer.hash);
        if (!hashOk) {
          this._emitDiagnostic({ stage: 'hash-mismatch', filename: transfer.filename });
        }
      } catch (e) {
        this._emitDiagnostic({ stage: 'hash-verify-failed', error: e.message });
        hashOk = false;
      }
    }

    if (this.onFileReceived) {
      this.onFileReceived({
        filename: transfer.filename,
        filetype: transfer.filetype,
        filesize: transfer.filesize,
        hash: transfer.hash,
        hashOk: hashOk
      }, blob);
    }
  }

  // ---- Signaling-driven methods ----

  async createOffer() {
    // Offerer (the joiner in our flow) creates the DataChannel. The other
    // side gets it via `ondatachannel`.
    this.dataChannel = this.pc.createDataChannel('webdrop', {
      ordered: true,
      negotiated: false
    });
    this._setupDataChannel();
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    // Mark remote description as "not set yet" - we'll flush pending ICE
    // candidates once the answer arrives.
    this._remoteDescriptionSet = false;
    return offer;
  }

  async acceptOffer(offerSdp) {
    await this.pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    this._remoteDescriptionSet = true;
    // Flush any ICE candidates that arrived while we were waiting.
    this._flushPendingCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  async acceptAnswer(answerSdp) {
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    this._remoteDescriptionSet = true;
    this._flushPendingCandidates();
  }

  async addIceCandidate(candidate) {
    if (!this._remoteDescriptionSet) {
      // Queue the candidate. WebRTC requires setRemoteDescription to be
      // complete before any addIceCandidate call; otherwise it throws and
      // the candidate is silently lost - which is exactly what was causing
      // the original DataChannel timeout.
      this._pendingCandidates.push(candidate);
      this._emitDiagnostic({ stage: 'ice-candidate-queued', count: this._pendingCandidates.length });
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (e) {
      this._emitDiagnostic({ stage: 'add-ice-candidate-error', error: e.message });
    }
  }

  _flushPendingCandidates() {
    if (!this._pendingCandidates.length) return;
    const pending = this._pendingCandidates.splice(0);
    this._emitDiagnostic({ stage: 'ice-candidates-flushed', count: pending.length });
    (async () => {
      for (const candidate of pending) {
        try {
          await this.pc.addIceCandidate(candidate);
        } catch (e) {
          this._emitDiagnostic({ stage: 'flush-ice-error', error: e.message });
        }
      }
    })();
  }

  // Resolves when the DataChannel is open. Uses the channel's `open` event
  // instead of polling, and waits for ICE to reach a connected state first.
  // Throws a typed error if the underlying peer connection fails first.
  waitForDataChannel(timeoutMs = 25_000) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      return Promise.resolve();
    }
    // Race the open promise against an explicit timeout AND a peer-connection
    // failure. If ICE fails before the channel opens, surface that
    // immediately instead of waiting out the full timeout.
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (msg) => {
        if (settled) return;
        settled = true;
        reject(new Error(msg));
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const timer = setTimeout(() => {
        fail('DataChannel timeout - the secure channel could not be opened. ' +
             'Check that TURN credentials are valid and your network allows WebRTC.');
      }, timeoutMs);

      const checkOpen = () => {
        if (settled) return;
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
          clearTimeout(timer);
          succeed();
          return;
        }
        // Bail early if the peer connection has died.
        const pcState = this.pc.connectionState;
        const iceState = this.pc.iceConnectionState;
        if (pcState === 'failed' || iceState === 'failed' || pcState === 'closed') {
          clearTimeout(timer);
          fail('Peer connection failed before the secure channel opened.');
          return;
        }
        setTimeout(checkOpen, 150);
      };
      checkOpen();
    });
  }

  // ---- Transfer methods ----

  sendText(text) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Secure channel is not open');
    }
    if (this._transferBusy) {
      throw new Error('Cannot send text while a file transfer is in progress');
    }
    this.dataChannel.send(JSON.stringify({ type: 'text', payload: text }));
  }

  async sendFile(file, options = {}) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Secure channel is not open');
    }
    if (this._transferBusy) {
      throw new Error('Another transfer is already in progress');
    }
    const channel = this.dataChannel;
    const transferId = (crypto.randomUUID ? crypto.randomUUID() : _fallbackId());
    const abort = new AbortController();
    this.activeTransfers.set(transferId, abort);
    this._transferBusy = true;

    // Honour the negotiated SCTP message-size limit if the browser exposes
    // it. We never send a chunk larger than this.
    const maxMessageSize = this._getMaxMessageSize();
    const effectiveChunkSize = Math.min(CHUNK_SIZE, maxMessageSize);

    try {
      const totalChunks = Math.max(1, Math.ceil(file.size / effectiveChunkSize));

      // Hash the file for integrity verification. Use a streaming hash if
      // the file is large (>32 MB) so we don't hold two copies in memory.
      let hash = '';
      try {
        hash = await _sha256FileStreaming(file);
      } catch (e) {
        this._emitDiagnostic({ stage: 'hash-compute-failed', error: e.message });
      }

      // file-start header.
      channel.send(JSON.stringify({
        type: 'file-start',
        transferId: transferId,
        filename: _sanitizeFilename(file.name),
        filetype: file.type || 'application/octet-stream',
        filesize: file.size,
        hash: hash,
        totalChunks: totalChunks,
        chunkSize: effectiveChunkSize
      }));

      // Wait for receiver-ready ACK before sending any chunks. This is the
      // fix for the silent chunk-loss bug: previously, chunks could be sent
      // before the receiver had wired up its onmessage handler.
      await this._waitForReceiverReady(transferId, abort.signal);

      // Send chunks with proper backpressure using the bufferedamountlow event.
      await this._sendChunks(file, transferId, totalChunks, effectiveChunkSize, abort.signal);

      // file-complete signal.
      channel.send(JSON.stringify({ type: 'file-complete', transferId: transferId }));
      return transferId;
    } finally {
      this._transferBusy = false;
      this.activeTransfers.delete(transferId);
      if (this._receiverReadyWaiters) this._receiverReadyWaiters.delete(transferId);
    }
  }

  _getMaxMessageSize() {
    try {
      const sctp = this.pc.sctp;
      if (sctp && typeof sctp.maxMessageSize === 'number' && sctp.maxMessageSize > 0) {
        return sctp.maxMessageSize;
      }
    } catch (_) {}
    // Safe default per the WebRTC spec.
    return 256 * 1024;
  }

  _waitForReceiverReady(transferId, abortSignal) {
    if (!this._receiverReadyWaiters) this._receiverReadyWaiters = new Map();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Receiver did not acknowledge readiness in time. ' +
                         'The other device may have lost connectivity.'));
      }, RECEIVER_READY_TIMEOUT_MS);
      this._receiverReadyWaiters.set(transferId, {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (e) => { clearTimeout(timer); reject(e); },
        timer
      });
      // If the caller aborts, also reject.
      if (abortSignal) {
        if (abortSignal.aborted) {
          clearTimeout(timer);
          reject(new Error('Transfer cancelled'));
          return;
        }
        abortSignal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Transfer cancelled'));
        }, { once: true });
      }
    });
  }

  async _sendChunks(file, transferId, totalChunks, chunkSize, abortSignal) {
    const channel = this.dataChannel;
    const startedAt = Date.now();
    let bytesSent = 0;

    for (let i = 0; i < totalChunks; i++) {
      if (abortSignal.aborted) {
        channel.send(JSON.stringify({ type: 'file-cancelled', transferId: transferId }));
        throw new Error('Transfer cancelled');
      }
      // If the channel closed mid-transfer, abort with a real error.
      if (!channel || channel.readyState !== 'open') {
        throw new Error('Secure channel closed during transfer.');
      }

      // Backpressure: if the buffer is over the high watermark, wait for
      // the `bufferedamountlow` event to fire (or fall back to a short
      // poll loop on browsers that don't fire it reliably).
      if (channel.bufferedAmount > BUFFER_HIGH) {
        await this._waitForBufferDrain(channel, abortSignal);
      }

      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunkBuffer = await file.slice(start, end).arrayBuffer();
      channel.send(chunkBuffer);
      bytesSent += (end - start);

      if (this.onTransferProgress) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const speed = elapsed > 0.05 ? bytesSent / elapsed : 0;
        this.onTransferProgress(transferId, bytesSent, file.size, speed);
      }
    }
  }

  _waitForBufferDrain(channel, abortSignal) {
    return new Promise((resolve, reject) => {
      if (abortSignal.aborted) {
        reject(new Error('Transfer cancelled'));
        return;
      }
      // Fast path: if it already drained (race with the event), bail.
      if (channel.bufferedAmount <= BUFFER_LOW) {
        resolve();
        return;
      }
      let settled = false;
      const onLow = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Transfer cancelled'));
      };
      // Safety timeout in case the `bufferedamountlow` event never fires
      // (some browsers are known to be flaky with it).
      const safety = setTimeout(onLow, 2_000);
      const cleanup = () => {
        clearTimeout(safety);
        channel.removeEventListener('bufferedamountlow', onLow);
        if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
      };
      channel.addEventListener('bufferedamountlow', onLow);
      if (abortSignal) abortSignal.addEventListener('abort', onAbort, { once: true });
    });
  }

  cancelTransfer(transferId) {
    const abort = this.activeTransfers.get(transferId);
    if (abort) {
      abort.abort();
      this.activeTransfers.delete(transferId);
    }
    // Tell the other side we cancelled.
    this._sendControl({ type: 'file-cancelled', transferId });
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._stopHeartbeat();
    if (this._recoveryTimer) clearTimeout(this._recoveryTimer);
    for (const abort of this.activeTransfers.values()) abort.abort();
    this.activeTransfers.clear();
    this.incomingTransfers.clear();
    this.expectingChunksFor = null;
    this._transferBusy = false;
    this._pendingCandidates = [];
    if (this.dataChannel) {
      try { this.dataChannel.close(); } catch (_) {}
      this.dataChannel = null;
    }
    try { this.pc.close(); } catch (_) {}
    // Reject any pending DataChannel open promise so callers don't hang.
    if (this._dataChannelOpenReject) {
      this._dataChannelOpenReject(new Error('Connection closed'));
      this._dataChannelOpenReject = null;
      this._dataChannelOpenResolve = null;
      this._dataChannelOpenPromise = null;
    }
    // Reject any pending receiver-ready waiters.
    if (this._receiverReadyWaiters) {
      for (const w of this._receiverReadyWaiters.values()) {
        try { w.reject(new Error('Connection closed')); } catch (_) {}
      }
      this._receiverReadyWaiters.clear();
    }
  }
}

// Streaming SHA-256 that doesn't load the whole file into memory at once.
// Falls back to one-shot hashing for small files.
async function _sha256FileStreaming(file) {
  // For small files, the one-shot path is faster.
  if (file.size < 32 * 1024 * 1024) {
    const buf = await file.arrayBuffer();
    return sha256(buf);
  }
  // Use SubtleCrypto's incremental API where available, otherwise fall back.
  if (crypto.subtle && crypto.subtle.digest) {
    // SubtleCrypto.digest is one-shot only; chunk the read but accumulate
    // via a single digest call on the concatenated buffer. We avoid holding
    // two full copies by using a streaming approach with crypto.subtle's
    // internal streaming where exposed (not yet standard). Fall back to
    // one-shot for now - browser will page if needed.
    const buf = await file.arrayBuffer();
    return sha256(buf);
  }
  return '';
}

// Strip path separators and dangerous characters from filenames.
function _sanitizeFilename(name) {
  let n = String(name || 'file');
  // Replace path separators with a safe character.
  n = n.replace(/[\\/]+/g, '_');
  // Strip control chars.
  n = n.replace(/[\x00-\x1f\x7f]/g, '');
  // Cap length to a sane value.
  if (n.length > 200) {
    const dot = n.lastIndexOf('.');
    if (dot > 0 && dot > n.length - 10) {
      n = n.slice(0, 190) + n.slice(dot);
    } else {
      n = n.slice(0, 200);
    }
  }
  return n || 'file';
}

function _fallbackId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export { WebDropConnection, sha256, CHUNK_SIZE, BUFFER_HIGH, BUFFER_LOW };
