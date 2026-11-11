// ============================================================================
// auth.js - anonymous session validation
// No user accounts. Authorization is based on knowing the session_code AND
// being one of the two peer_ids assigned to that session.
// ============================================================================
import { getSql } from './db.js';

// Validate that a session exists, isn't expired, and that the caller is a
// participant. Returns { valid, session?, reason? }.
export async function validateSession(sql, sessionCode, peerId) {
  if (!sessionCode || !/^[A-Z0-9]{12}$/.test(sessionCode)) {
    return { valid: false, reason: 'invalid_code' };
  }
  const rows = await sql`
    SELECT session_code, status, creator_peer_id, joiner_peer_id, expires_at
    FROM transfer_sessions
    WHERE session_code = ${sessionCode}
    LIMIT 1
  `;
  if (!rows.length) return { valid: false, reason: 'not_found' };

  const session = rows[0];
  if (new Date(session.expires_at).getTime() < Date.now()) {
    return { valid: false, reason: 'expired', session };
  }
  if (session.status === 'cancelled' || session.status === 'expired') {
    return { valid: false, reason: session.status, session };
  }
  if (peerId) {
    const isParticipant = peerId === session.creator_peer_id || peerId === session.joiner_peer_id;
    if (!isParticipant) return { valid: false, reason: 'not_participant', session };
  }
  return { valid: true, session };
}
