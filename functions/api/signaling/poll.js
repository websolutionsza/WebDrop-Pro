// ============================================================================
// GET /api/signaling/poll?peer_id=XXXX&session_code=YYYY
// Fetch unconsumed signaling messages addressed to peer_id.
// The frontend calls this every ~1 second during connection setup.
// ============================================================================
import { getSql } from '../../_lib/db.js';
import { json, error, handleOptions, safe } from '../../_lib/response.js';
import { validateSession } from '../../_lib/auth.js';

async function handler({ env, request }) {
  const url = new URL(request.url);
  const peerId = url.searchParams.get('peer_id');
  const sessionCode = url.searchParams.get('session_code');

  if (!peerId || !/^[a-z0-9]{32}$/.test(peerId)) {
    return error('Invalid or missing peer_id.', 400);
  }
  if (!sessionCode || !/^[A-Z0-9]{12}$/.test(sessionCode)) {
    return error('Invalid or missing session_code.', 400);
  }

  const sql = getSql(env);
  const validation = await validateSession(sql, sessionCode, peerId);
  if (!validation.valid && validation.reason !== 'not_participant') {
    // If session expired or doesn't exist, tell the client to stop polling.
    return json({ ok: false, reason: validation.reason, messages: [] });
  }

  try {
    const messages = await sql`
      SELECT id, message_type, payload, from_peer_id, created_at
      FROM signaling_messages
      WHERE to_peer_id = ${peerId}
        AND session_code = ${sessionCode}
        AND consumed = FALSE
        AND expires_at > NOW()
      ORDER BY created_at ASC
      LIMIT 50
    `;
    return json({ ok: true, messages });
  } catch (e) {
    console.error('Signaling poll error:', e.message);
    return error('Database temporarily unavailable.', 503);
  }
}

export const onRequestGet = safe(handler);
export const onRequestOptions = handleOptions;
