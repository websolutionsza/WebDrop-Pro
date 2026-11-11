// ============================================================================
// GET /api/turn-credentials
// Returns TURN server configuration for the WebRTC RTCPeerConnection.
//
// Architecture note: the TURN credentials are stored as Cloudflare secrets
// (TURN_USERNAME, TURN_PASSWORD) and served via this Function so they never
// appear in the frontend bundle. In a future upgrade we can replace this
// with a call to the Metered REST API to mint ephemeral credentials.
// ============================================================================
import { json, error, handleOptions, safe } from '../_lib/response.js';

async function handler({ env }) {
  const username = env.TURN_USERNAME;
  const password = env.TURN_PASSWORD;
  const provider = env.TURN_PROVIDER || 'metered-static';

  if (!username || !password) {
    // TURN is optional - if not configured, return empty servers.
    // The WebRTC connection will still try STUN-only.
    return json({
      ok: true,
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ],
      turn_enabled: false
    });
  }

  // Metered TURN servers - UDP and TCP variants for firewall traversal.
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: [
        'turn:turn.metered.ca:80',
        'turn:turn.metered.ca:80?transport=tcp',
        'turns:turn.metered.ca:443'
      ],
      username: username,
      credential: password
    }
  ];

  return json({
    ok: true,
    iceServers: iceServers,
    turn_enabled: true,
    provider: provider
  });
}

export const onRequestGet = safe(handler);
export const onRequestOptions = handleOptions;
