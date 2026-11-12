// ============================================================================
// GET /api/session/lookup?code=1234
// Resolves a 4-digit Easy P2P short code to the full 12-char session_code
// and the creator's peer_id. Used by the receiver in Easy P2P mode.
//
// Security:
//   - 4-digit codes have only 10,000 possibilities, so we rate-limit by IP.
//   - Max 5 lookup attempts per IP per 5-minute window.
//   - Exceeding the limit returns 429.
//   - Old pairing_attempts rows are cleaned up lazily.
//   - The short_code itself is NOT a security credential - it's a discovery
//     mechanism. The actual session security comes from the 12-char
//     session_code and the WebRTC DTLS encryption.
// ============================================================================
import { getSql } from '../../_lib/db.js';
import { json, error, handleOptions, safe } from '../../_lib/response.js';
import { cleanupExpired } from '../../_lib/cleanup.js';

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 5;

async function handler({ env, request }) {
  const url = new URL(request.url);
  const shortCode = url.searchParams.get('code');

  // Validate: exactly 4 digits.
  if (!shortCode || !/^[0-9]{4}$/.test(shortCode)) {
    return error('Invalid code. Must be exactly 4 digits.', 400);
  }

  // Get client IP for rate limiting. Cloudflare provides this header.
  const clientIp = request.headers.get('CF-Connecting-IP') ||
                   request.headers.get('X-Forwarded-For') ||
                   'unknown';

  const sql = getSql(env);

  // Lazy cleanup of old pairing attempts.
  try {
    await sql`DELETE FROM pairing_attempts WHERE attempted_at < NOW() - INTERVAL '10 minutes'`;
  } catch (_) { /* table may not exist yet */ }
  await cleanupExpired(sql);

  // Rate limiting: count recent attempts from this IP.
  let attemptCount = 0;
  try {
    const rows = await sql`
      SELECT COUNT(*)::int AS cnt
      FROM pairing_attempts
      WHERE source_ip = ${clientIp}
        AND attempted_at > NOW() - INTERVAL '${sql(WINDOW_MINUTES)} minutes'
    `;
    attemptCount = rows[0]?.cnt || 0;
  } catch (e) {
    console.error('Rate limit check failed:', e.message);
    // If the pairing_attempts table doesn't exist, skip rate limiting
    // rather than blocking all lookups. The migration should be applied.
  }

  // Record this attempt (even if we're about to reject - the attempt counts).
  try {
    await sql`
      INSERT INTO pairing_attempts (source_ip, short_code)
      VALUES (${clientIp}, ${shortCode})
    `;
  } catch (_) { /* ignore */ }

  if (attemptCount >= MAX_ATTEMPTS) {
    return json({
      ok: false,
      error: 'Too many attempts. Please wait a few minutes and try again.',
      retry_after_seconds: WINDOW_MINUTES * 60
    }, 429);
  }

  // Look up the session by short_code.
  try {
    const rows = await sql`
      SELECT session_code, creator_peer_id, status, expires_at
      FROM transfer_sessions
      WHERE short_code = ${shortCode}
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (!rows.length) {
      return json({
        ok: false,
        error: 'No active session found with that code. Check the code and try again.',
        attempts_remaining: Math.max(0, MAX_ATTEMPTS - attemptCount - 1)
      }, 404);
    }
    const session = rows[0];
    // Only allow lookup if the session is still waiting for a joiner.
    if (session.status !== 'waiting') {
      return json({
        ok: false,
        error: 'This session is already being used or has ended.',
        attempts_remaining: Math.max(0, MAX_ATTEMPTS - attemptCount - 1)
      }, 409);
    }
    return json({
      ok: true,
      session_code: session.session_code,
      creator_peer_id: session.creator_peer_id,
      expires_at: session.expires_at,
      attempts_remaining: MAX_ATTEMPTS
    });
  } catch (e) {
    console.error('Session lookup error:', e.message);
    return error('Database temporarily unavailable.', 503);
  }
}

export const onRequestGet = safe(handler);
export const onRequestOptions = handleOptions;
