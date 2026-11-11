// ============================================================================
// GET /api/history?peer_id=XXXX
// Returns recent transfer history (last 24 hours) for the given peer_id.
// Used by the temporary transfer history UI panel.
// ============================================================================
import { getSql } from '../../_lib/db.js';
import { json, error, handleOptions, safe } from '../../_lib/response.js';
import { cleanupExpired } from '../../_lib/cleanup.js';

async function handler({ env, request }) {
  const url = new URL(request.url);
  const peerId = url.searchParams.get('peer_id');

  if (!peerId || !/^[a-z0-9]{32}$/.test(peerId)) {
    return error('Invalid or missing peer_id.', 400);
  }

  const sql = getSql(env);
  await cleanupExpired(sql);

  try {
    const rows = await sql`
      SELECT session_code, direction, peer_label, file_count,
             total_bytes, file_names, completed_at
      FROM transfer_history
      WHERE peer_id = ${peerId}
        AND expires_at > NOW()
      ORDER BY completed_at DESC
      LIMIT 20
    `;
    return json({ ok: true, history: rows });
  } catch (e) {
    console.error('History fetch error:', e.message);
    return error('Database temporarily unavailable.', 503);
  }
}

export const onRequestGet = safe(handler);
export const onRequestOptions = handleOptions;
