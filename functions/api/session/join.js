// ============================================================================
// POST /api/session/join
// Receiver looks up a session by code and joins it. Returns the creator's
// peer_id so the receiver knows who to signal.
// ============================================================================
import { getSql } from '../../_lib/db.js';
import { json, error, handleOptions, safe } from '../../_lib/response.js';
import { cleanupExpired } from '../../_lib/cleanup.js';

async function handler({ env, request }) {
  let body;
  try { body = await request.json(); }
  catch { return error('Invalid JSON body', 400); }

  const sessionCode = body?.session_code;
  const joinerPeerId = body?.joiner_peer_id;

  if (!sessionCode || !/^[A-Z0-9]{12}$/.test(sessionCode)) {
    return error('Invalid session_code.', 400);
  }
  if (!joinerPeerId || !/^[a-z0-9]{32}$/.test(joinerPeerId)) {
    return error('Invalid joiner_peer_id.', 400);
  }

  const sql = getSql(env);
  await cleanupExpired(sql);

  try {
    // Atomically: only allow join if status is 'waiting' and not expired.
    // This prevents two receivers from joining the same session.
    const result = await sql`
      UPDATE transfer_sessions
      SET status = 'joining',
          joiner_peer_id = ${joinerPeerId}
      WHERE session_code = ${sessionCode}
        AND status = 'waiting'
        AND expires_at > NOW()
      RETURNING creator_peer_id, expires_at
    `;

    if (!result.length) {
      // Either session doesn't exist, already joined, or expired.
      const check = await sql`
        SELECT status, expires_at FROM transfer_sessions
        WHERE session_code = ${sessionCode} LIMIT 1
      `;
      if (!check.length) return error('Session not found.', 404);
      const row = check[0];
      if (new Date(row.expires_at).getTime() < Date.now()) {
        return error('Session has expired.', 410);
      }
      if (row.status === 'joining' || row.status === 'connected') {
        return error('Session already joined by another device.', 409);
      }
      return error('Session is not in a joinable state.', 409);
    }

    return json({
      ok: true,
      session_code: sessionCode,
      creator_peer_id: result[0].creator_peer_id,
      expires_at: result[0].expires_at
    });
  } catch (e) {
    console.error('Session join error:', e.message);
    return error('Database temporarily unavailable.', 503);
  }
}

export const onRequestPost = safe(handler);
export const onRequestOptions = handleOptions;
