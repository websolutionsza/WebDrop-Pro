// ============================================================================
// POST /api/session/create
// Sender creates a new transfer session. Generates no database rows for
// signaling - those are written on demand by /api/signaling/*.
// ============================================================================
import { getSql } from '../../_lib/db.js';
import { json, error, handleOptions, safe } from '../../_lib/response.js';
import { cleanupExpired } from '../../_lib/cleanup.js';

async function handler({ env, request }) {
  let body;
  try { body = await request.json(); }
  catch { return error('Invalid JSON body', 400); }

  const sessionCode = body?.session_code;
  const creatorPeerId = body?.creator_peer_id;

  // Validate session_code: 12 uppercase alphanumeric chars (A-Z, 0-9)
  if (!sessionCode || !/^[A-Z0-9]{12}$/.test(sessionCode)) {
    return error('Invalid session_code. Must be 12 uppercase alphanumeric characters.', 400);
  }
  // Validate creator_peer_id: 32 lowercase alphanumeric chars
  if (!creatorPeerId || !/^[a-z0-9]{32}$/.test(creatorPeerId)) {
    return error('Invalid creator_peer_id.', 400);
  }

  const sql = getSql(env);

  // Best-effort lazy cleanup on every write request.
  await cleanupExpired(sql);

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  try {
    const result = await sql`
      INSERT INTO transfer_sessions (session_code, status, creator_peer_id, created_at, expires_at)
      VALUES (${sessionCode}, 'waiting', ${creatorPeerId}, NOW(), ${expiresAt})
      ON CONFLICT (session_code) DO NOTHING
      RETURNING session_code
    `;
    if (!result.length) {
      // Collision - extremely rare with 36^12 space, but possible.
      return error('Session code collision. Please generate a new code and retry.', 409);
    }
    return json({
      ok: true,
      session_code: sessionCode,
      expires_at: expiresAt
    });
  } catch (e) {
    console.error('Session create error:', e.message);
    // If the database is unavailable (Neon scaled to zero wake-up failure,
    // quota exhaustion, etc.), surface a clear error to the caller.
    if (e.message.includes('connection') || e.message.includes('ECONN')) {
      return error('Database temporarily unavailable. Please try again.', 503);
    }
    return error('Failed to create session.', 500);
  }
}

export const onRequestPost = safe(handler);
export const onRequestOptions = handleOptions;
