// ============================================================================
// POST /api/session/create
// Sender creates a new transfer session. Generates no database rows for
// signaling - those are written on demand by /api/signaling/*.
//
// Supports two modes:
//   - 'cross-network' (default): 12-char session_code, 15-min expiry.
//     Used by the advanced Cross-Network connection mode.
//   - 'easy-p2p': 12-char session_code (internal) + 4-digit short_code
//     (for easy verbal/QR sharing). 5-min expiry for security.
//     Used by the default Easy P2P connection mode.
// ============================================================================
import { getSql } from '../../_lib/db.js';
import { json, error, handleOptions, safe } from '../../_lib/response.js';
import { cleanupExpired } from '../../_lib/cleanup.js';

// Allowed modes.
const VALID_MODES = ['cross-network', 'easy-p2p'];

async function handler({ env, request }) {
  let body;
  try { body = await request.json(); }
  catch { return error('Invalid JSON body', 400); }

  const sessionCode = body?.session_code;
  const creatorPeerId = body?.creator_peer_id;
  const mode = body?.mode || 'cross-network';

  // Validate session_code: 12 uppercase alphanumeric chars (A-Z, 0-9)
  if (!sessionCode || !/^[A-Z0-9]{12}$/.test(sessionCode)) {
    return error('Invalid session_code. Must be 12 uppercase alphanumeric characters.', 400);
  }
  // Validate creator_peer_id: 32 lowercase alphanumeric chars
  if (!creatorPeerId || !/^[a-z0-9]{32}$/.test(creatorPeerId)) {
    return error('Invalid creator_peer_id.', 400);
  }
  if (!VALID_MODES.includes(mode)) {
    return error('Invalid mode. Must be "cross-network" or "easy-p2p".', 400);
  }

  const sql = getSql(env);

  // Best-effort lazy cleanup on every write request.
  await cleanupExpired(sql);
  // Also clean up old pairing attempts.
  try {
    await sql`DELETE FROM pairing_attempts WHERE attempted_at < NOW() - INTERVAL '10 minutes'`;
  } catch (_) { /* table may not exist yet - ignore */ }

  // Expiry: Easy P2P sessions expire faster (5 min) since 4-digit codes
  // have low entropy and should be short-lived. Cross-Network sessions
  // keep the original 15-minute window.
  const expiryMinutes = mode === 'easy-p2p' ? 5 : 15;
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();

  // Generate a unique 4-digit short_code for Easy P2P mode.
  let shortCode = null;
  if (mode === 'easy-p2p') {
    shortCode = await generateUniqueShortCode(sql);
    if (!shortCode) {
      return error('Could not generate a unique pairing code. Please try again.', 503);
    }
  }

  try {
    const result = await sql`
      INSERT INTO transfer_sessions (session_code, short_code, status, creator_peer_id, created_at, expires_at)
      VALUES (${sessionCode}, ${shortCode}, 'waiting', ${creatorPeerId}, NOW(), ${expiresAt})
      ON CONFLICT (session_code) DO NOTHING
      RETURNING session_code, short_code
    `;
    if (!result.length) {
      // Collision on session_code - extremely rare with 36^12 space.
      return error('Session code collision. Please generate a new code and retry.', 409);
    }
    return json({
      ok: true,
      session_code: sessionCode,
      short_code: shortCode,
      mode: mode,
      expires_at: expiresAt
    });
  } catch (e) {
    console.error('Session create error:', e.message);
    if (e.message.includes('connection') || e.message.includes('ECONN')) {
      return error('Database temporarily unavailable. Please try again.', 503);
    }
    return error('Failed to create session.', 500);
  }
}

// Generate a random 4-digit code and verify it's not already in use by
// an active (non-expired, non-completed) session. Retry up to 8 times.
async function generateUniqueShortCode(sql) {
  for (let i = 0; i < 8; i++) {
    const candidate = _randomDigits(4);
    try {
      const existing = await sql`
        SELECT 1 FROM transfer_sessions
        WHERE short_code = ${candidate}
          AND status IN ('waiting', 'joining')
          AND expires_at > NOW()
        LIMIT 1
      `;
      if (!existing.length) {
        return candidate;
      }
    } catch (e) {
      // If the short_code column doesn't exist yet (migration not applied),
      // bail out gracefully. The frontend will fall back to Cross-Network mode.
      console.error('Short code uniqueness check failed:', e.message);
      return null;
    }
  }
  return null;
}

function _randomDigits(len) {
  const digits = '0123456789';
  const values = new Uint8Array(len);
  crypto.getRandomValues(values);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += digits[values[i] % digits.length];
  }
  return out;
}

export const onRequestPost = safe(handler);
export const onRequestOptions = handleOptions;
