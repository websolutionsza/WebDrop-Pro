// ============================================================================
// GET /api/turn-credentials
// Returns the ICE server configuration for the WebRTC RTCPeerConnection.
//
// Architecture:
//   - STUN: Google's public STUN servers (free, no credentials needed).
//   - TURN: Metered TURN service. We support two credential modes:
//       1. Static credentials (TURN_USERNAME + TURN_PASSWORD) configured
//          directly in the Cloudflare Pages environment.
//       2. Ephemeral credentials via the Metered REST API, minted with
//          METERED_APP_ID and METERED_SECRET_KEY. Ephemeral credentials are
//          time-limited (default 1 hour) and are cached at the edge to avoid
//          minting a new pair on every request.
//
// The frontend only ever receives ready-to-use RTCIceServer objects - the
// Metered secret key never leaves this Function.
//
// Reference: https://www.metered.ca/docs/turn-server-service/creating-turn-credentials/
// ============================================================================

import { json, error, handleOptions, safe } from '../_lib/response.js';

// Edge cache for ephemeral credentials. Lives for the lifetime of the
// Cloudflare isolate - typically a few hundred requests. Refreshed 60s
// before the credential actually expires so we never hand out a token
// that's already expired by the time the client uses it.
let cachedEphemeral = null; // { username, password, expiresAt }
const EMBEDDED_TTL_SECONDS = 3600;       // 1 hour
const EARLY_REFRESH_SECONDS = 60;       // refresh 60s before expiry

// Cache the static configuration too so we don't rebuild the array on every
// request - small win, but avoids an allocation per poll.
let cachedStatic = null;

async function handler({ env }) {
  const staticUsername = env.TURN_USERNAME;
  const staticPassword = env.TURN_PASSWORD;
  const meteredAppId = env.METERED_APP_ID;
  const meteredSecret = env.METERED_SECRET_KEY;
  const turnDomain = env.TURN_DOMAIN || 'turn.metered.ca';
  const provider = env.TURN_PROVIDER || (meteredAppId ? 'metered-ephemeral' : (staticUsername ? 'metered-static' : 'none'));

  // Build the base list of STUN servers. Google STUN is free and reliable.
  const stunServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ];

  // ---- Mode 1: ephemeral Metered credentials (preferred when configured) ----
  if (meteredAppId && meteredSecret) {
    try {
      const creds = await getEphemeralCredentials(env, meteredAppId, meteredSecret);
      if (creds) {
        return json({
          ok: true,
          iceServers: [
            ...stunServers,
            {
              // Metered recommends advertising UDP + TCP + TLS variants on the
              // same server entry so the browser tries them in order until
              // one works.
              urls: [
                `turn:${turnDomain}:80?transport=udp`,
                `turn:${turnDomain}:80?transport=tcp`,
                `turn:${turnDomain}:443?transport=udp`,
                `turn:${turnDomain}:443?transport=tcp`,
                `turns:${turnDomain}:443`
              ],
              username: creds.username,
              credential: creds.password
            }
          ],
          turn_enabled: true,
          provider,
          credential_mode: 'ephemeral',
          // Tell the client when to refresh. We keep this in the response so
          // the frontend can re-fetch well before expiry.
          expires_in: Math.max(0, Math.floor((creds.expiresAt - Date.now()) / 1000))
        });
      }
    } catch (e) {
      console.error('Ephemeral credential fetch failed:', e.message);
      // Fall through to static creds or STUN-only.
    }
  }

  // ---- Mode 2: static Metered credentials ----
  if (staticUsername && staticPassword) {
    if (!cachedStatic) {
      cachedStatic = {
        // Static credentials: refresh hourly. If the operator rotates them,
        // we'll pick up the new value within an hour.
        expiresAt: Date.now() + EMBEDDED_TTL_SECONDS * 1000,
        username: staticUsername,
        password: staticPassword
      };
    }
    // If the cached static creds look stale (e.g. they were rotated), refresh.
    if (cachedStatic.username !== staticUsername || cachedStatic.password !== staticPassword) {
      cachedStatic = {
        expiresAt: Date.now() + EMBEDDED_TTL_SECONDS * 1000,
        username: staticUsername,
        password: staticPassword
      };
    }
    return json({
      ok: true,
      iceServers: [
        ...stunServers,
        {
          urls: [
            `turn:${turnDomain}:80?transport=udp`,
            `turn:${turnDomain}:80?transport=tcp`,
            `turn:${turnDomain}:443?transport=udp`,
            `turn:${turnDomain}:443?transport=tcp`,
            `turns:${turnDomain}:443`
          ],
          username: cachedStatic.username,
          credential: cachedStatic.password
        }
      ],
      turn_enabled: true,
      provider,
      credential_mode: 'static'
    });
  }

  // ---- Mode 3: no TURN configured - STUN only. Cross-network behind strict
  // NAT will fail in this mode, but same-network and direct-internet paths
  // still work. We're explicit about it in the response so the frontend can
  // surface a clear diagnostic to the user. ----
  return json({
    ok: true,
    iceServers: stunServers,
    turn_enabled: false,
    provider: 'none',
    credential_mode: 'none'
  });
}

// Fetch (and cache) ephemeral TURN credentials from the Metered REST API.
// Endpoint: POST https://www.metered.ca/api/turn/token
//   { "seconds": 3600 } with HTTP Basic auth (appId:secret)
// Returns: { username, password, expireAt }
async function getEphemeralCredentials(env, appId, secret) {
  const now = Date.now();
  if (cachedEphemeral && cachedEphemeral.expiresAt - now > EARLY_REFRESH_SECONDS * 1000) {
    return cachedEphemeral;
  }
  // Use a fixed TTL. Metered caps this at 1 hour for the ephemeral API.
  const ttl = EMBEDDED_TTL_SECONDS;
  const url = `https://www.metered.ca/api/turn/token?seconds=${ttl}`;
  const auth = btoa(`${appId}:${secret}`);
  const controller = new AbortController();
  // Hard cap on the credential-fetch call so a slow Metered API can't hang
  // the whole /api/turn-credentials response.
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Metered API ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    // Metered returns { username, password, expireAt? } - normalise.
    const username = data.username;
    const password = data.password;
    if (!username || !password) {
      throw new Error('Metered response missing username/password');
    }
    // Parse expiry. The username itself encodes the expiry as a unix timestamp
    // (format: "timestamp:userId"). We trust the server's expireAt if present,
    // otherwise fall back to (now + ttl).
    let expiresAt = now + ttl * 1000;
    if (data.expireAt) {
      const parsed = Date.parse(data.expireAt);
      if (!isNaN(parsed)) expiresAt = parsed;
    } else if (typeof username === 'string') {
      const colon = username.indexOf(':');
      if (colon > 0) {
        const ts = Number(username.slice(0, colon));
        if (ts > 0) expiresAt = ts * 1000;
      }
    }
    cachedEphemeral = { username, password, expiresAt };
    return cachedEphemeral;
  } finally {
    clearTimeout(timeout);
  }
}

export const onRequestGet = safe(handler);
export const onRequestOptions = handleOptions;
