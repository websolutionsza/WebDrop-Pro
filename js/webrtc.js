// ============================================================================
// webrtc.js - WebRTC RTCPeerConnection wrapper with chunked file transfer
//
// Replaces the old PeerJS-based implementation. Signaling is done through
// our own /api/signaling/* endpoints (polling-based).
//
// Transfer protocol over the ordered DataChannel:
//   1. Sender sends JSON: {type:'file-start', transferId, filename, filesize,
//      totalChunks, hash}
//   2. Sender sends N binary ArrayBuffers (the chunks, in order). No other
//      messages are interleaved during a transfer.
//   3. Sender sends JSON: {type:'file-complete', transferId}
//   4. Receiver reassembles chunks in order, verifies SHA-256 hash, and
//      surfaces the file via onFileReceived.
//
// Text messages are JSON: {type:'text', payload}. Sent only when no file
// transfer is in progress on either side.
// ============================================================================

const CHUNK_SIZE = 64 * 1024;        // 64KB per DataChannel message
const BUFFER_HIGH = 1 * 1024 * 1024; // pause when buffered > 1MB
const BUFFER_LOW = 256 * 1024;       // resume when buffered < 256KB

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
    this.pc = new RTCPeerConnection({ iceServers });
    this.dataChannel = null;
    this.incomingTransfers = new Map();
    this.activeTransfers = new Map();    // transferId -> AbortController
    this.expectingChunksFor = null;       // transferId while receiving binary chunks
    this.connectedAt = null;
    this._transferBusy = false;           // true while a file transfer is in progress

    // Event callbacks (set by the caller)
    this.onIceCandidate = null;
    this.onStateChange = null;            // (state) => connecting|connected|failed|disconnected
    this.onConnectionType = null;         // (type) => local|direct|turn|unknown
    this.onFileReceived = null;           // (fileInfo, blob) => void
    this.onTextReceived = null;           // (text) => void
    this.onTransferProgress = null;       // (transferId, sent, total) => void
    this.onDataChannelOpen = null;        // () => void

    this._setupPeerConnection();
  }

  _setupPeerConnection() {
    this.pc.onicecandidate = (e) => {
      if (e.candidate && this.onIceCandidate) {
        this.onIceCandidate(e.candidate);
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      if (this.onStateChange) this.onStateChange(state);
      this._detectConnectionType();
    };

    this.pc.ondatachannel = (e) => {
      this.dataChannel = e.channel;
      this._setupDataChannel();
    };
  }

  _detectConnectionType() {
    if (!this.pc.getStats) return;
    this.pc.getStats().then((stats) => {
      let type = 'unknown';
      for (const entry of stats.values()) {
        if (entry.type === 'candidate-pair' && entry.state === 'succeeded' && entry.selected) {
          const local = stats.get(entry.localCandidateId);
          const remote = stats.get(entry.remoteCandidateId);
          const lt = local?.candidateType || '';
          const rt = remote?.candidateType || '';
          if (lt === 'host' && rt === 'host') type = 'local';
          else if (lt === 'relay' || rt === 'relay') type = 'turn';
          else type = 'direct';
          break;
        }
      }
      if (this.onConnectionType) this.onConnectionType(type);
    }).catch(() => {});
  }

  _setupDataChannel() {
    this.dataChannel.binaryType = 'arraybuffer';

    this.dataChannel.onopen = () => {
      this.connectedAt = Date.now();
      if (this.onDataChannelOpen) this.onDataChannelOpen();
    };

    this.dataChannel.onmessage = (e) => this._handleDataMessage(e.data);

    this.dataChannel.onclose = () => {
      if (this.onStateChange) this.onStateChange('disconnected');
    };

    this.dataChannel.onerror = (e) => {
      console.error('DataChannel error:', e);
    };
  }

  _handleDataMessage(data) {
    if (typeof data === 'string') {
      // JSON control message.
      try {
        const msg = JSON.parse(data);
        this._handleControlMessage(msg);
      } catch (e) {
        console.error('Bad control message:', e.message);
      }
      return;
    }
    if (data instanceof ArrayBuffer) {
      // Binary chunk for the transfer we're currently receiving.
      if (!this.expectingChunksFor) {
        console.warn('Unexpected binary chunk (no transfer in progress)');
        return;
      }
      const transfer = this.incomingTransfers.get(this.expectingChunksFor);
      if (!transfer) {
        this.expectingChunksFor = null;
        return;
      }
      transfer.chunks[transfer.receivedChunks] = data;
      transfer.receivedChunks++;
      if (this.onTransferProgress) {
        this.onTransferProgress(
          this.expectingChunksFor,
          transfer.receivedChunks * CHUNK_SIZE,
          transfer.filesize
        );
      }
      if (transfer.receivedChunks >= transfer.totalChunks) {
        // All chunks received - wait for file-complete signal.
        this.expectingChunksFor = null;
      }
      return;
    }
  }

  _handleControlMessage(msg) {
    if (msg.type === 'text') {
      if (this.onTextReceived) this.onTextReceived(msg.payload);
      return;
    }
    if (msg.type === 'file-start') {
      this.incomingTransfers.set(msg.transferId, {
        filename: msg.filename || 'file',
        filetype: msg.filetype || 'application/octet-stream',
        filesize: msg.filesize || 0,
        hash: msg.hash || '',
        totalChunks: msg.totalChunks || 0,
        chunks: new Array(msg.totalChunks || 0),
        receivedChunks: 0
      });
      this.expectingChunksFor = msg.transferId;
      return;
    }
    if (msg.type === 'file-complete') {
      this._completeIncomingTransfer(msg.transferId);
      return;
    }
    if (msg.type === 'file-cancelled') {
      this.incomingTransfers.delete(msg.transferId);
      this.expectingChunksFor = null;
      return;
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
          console.error('Hash mismatch for', transfer.filename);
        }
      } catch (e) {
        console.error('Hash verification failed:', e.message);
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
    this.dataChannel = this.pc.createDataChannel('webdrop', {
      ordered: true,
      negotiated: false
    });
    this._setupDataChannel();
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async acceptOffer(offerSdp) {
    await this.pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  async acceptAnswer(answerSdp) {
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  }

  async addIceCandidate(candidate) {
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (e) {
      console.warn('addIceCandidate error:', e.message);
    }
  }

  waitForDataChannel(timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        resolve();
        return;
      }
      const timer = setTimeout(() => reject(new Error('DataChannel timeout')), timeoutMs);
      const checkOpen = () => {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
          clearTimeout(timer);
          resolve();
        } else {
          setTimeout(checkOpen, 100);
        }
      };
      checkOpen();
    });
  }

  // ---- Transfer methods ----

  sendText(text) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel not open');
    }
    if (this._transferBusy) {
      throw new Error('Cannot send text while a file transfer is in progress');
    }
    this.dataChannel.send(JSON.stringify({ type: 'text', payload: text }));
  }

  async sendFile(file, options = {}) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel not open');
    }
    if (this._transferBusy) {
      throw new Error('Another transfer is already in progress');
    }
    const channel = this.dataChannel;
    const transferId = (crypto.randomUUID ? crypto.randomUUID() : _fallbackId());
    const abort = new AbortController();
    this.activeTransfers.set(transferId, abort);
    this._transferBusy = true;

    try {
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

      // Hash the file for integrity verification.
      let hash = '';
      try {
        const buffer = await file.arrayBuffer();
        hash = await sha256(buffer);
      } catch (e) {
        console.warn('Hash computation failed:', e.message);
      }

      // file-start header.
      channel.send(JSON.stringify({
        type: 'file-start',
        transferId: transferId,
        filename: file.name,
        filetype: file.type || 'application/octet-stream',
        filesize: file.size,
        hash: hash,
        totalChunks: totalChunks
      }));

      // Send chunks with backpressure.
      for (let i = 0; i < totalChunks; i++) {
        if (abort.signal.aborted) {
          channel.send(JSON.stringify({ type: 'file-cancelled', transferId: transferId }));
          throw new Error('Transfer cancelled');
        }
        while (channel.bufferedAmount > BUFFER_HIGH) {
          await new Promise(r => setTimeout(r, 10));
        }
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunkBuffer = await file.slice(start, end).arrayBuffer();
        channel.send(chunkBuffer);
        if (this.onTransferProgress) {
          this.onTransferProgress(transferId, Math.min(end, file.size), file.size);
        }
      }

      // file-complete signal.
      channel.send(JSON.stringify({ type: 'file-complete', transferId: transferId }));
      return transferId;
    } finally {
      this._transferBusy = false;
      this.activeTransfers.delete(transferId);
    }
  }

  cancelTransfer(transferId) {
    const abort = this.activeTransfers.get(transferId);
    if (abort) {
      abort.abort();
      this.activeTransfers.delete(transferId);
    }
  }

  close() {
    for (const abort of this.activeTransfers.values()) abort.abort();
    this.activeTransfers.clear();
    this.incomingTransfers.clear();
    this.expectingChunksFor = null;
    this._transferBusy = false;
    if (this.dataChannel) {
      try { this.dataChannel.close(); } catch (_) {}
    }
    try { this.pc.close(); } catch (_) {}
  }
}

function _fallbackId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export { WebDropConnection, sha256, CHUNK_SIZE };
