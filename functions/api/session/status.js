// ============================================================================
// GET /api/session/status?code=XXXX
// Lightweight status check used by both peers to track session lifecycle.
// ============================================================================
import { getSql } from '../../_lib/db.js';
import { json, error, handleOptions, safe } from '../../_lib/response.js';

async function handler({ env, request }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code || !/^[A-Z0-9]{12}$/.test(code)) {
    return error('Invalid or missing code parameter.', 400);
  }

  const sql = getSql(env);
  try {
    const rows = await sql`
      SELECT session_code, status, creator_peer_id, joiner_peer_id,
             created_at, expires_at, completed_at, transfer_summary
      FROM transfer_sessions
      WHERE session_code = ${code}
      LIMIT 1
    `;
    if (!rows.length) return json({ ok: true, session: null });
    return json({ ok: true, session: rows[0] });
  } catch (e) {
    console.error('Session status error:', e.message);
    return error('Database temporarily unavailable.', 503);
  }
}

export const onRequestGet = safe(handler);
export const onRequestOptions = handleOptions;
