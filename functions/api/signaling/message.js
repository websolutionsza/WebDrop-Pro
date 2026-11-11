// ============================================================================
// POST /api/signaling/message
// Write a signaling message (SDP offer, SDP answer, or ICE candidate).
// The sender specifies the recipient via to_peer_id; the recipient polls
// /api/signaling/poll to fetch unconsumed messages addressed to them.
// ============================================================================
import { getSql } from '../../_lib/db.js';
import { json, error, handleOptions, safe } from '../../_lib/response.js';
import { validateSession } from '../../_lib/auth.js';

const MAX_PAYLOAD_SIZE = 32768; // 32 KB - SDP offers can be large with many ICE candidates
const ALLOWED_TYPES = ['offer', 'answer', 'ice'];

async function handler({ env, request }) {
  let body;
  try { body = await request.json(); }
  catch { return error('Invalid JSON body', 400); }

  const sessionCode = body?.session_code;
  const fromPeerId = body?.from_peer_id;
  const toPeerId = body?.to_peer_id;
  const messageType = body?.message_type;
  const payload = body?.payload;

  if (!sessionCode || !fromPeerId || !toPeerId || !messageType || typeof payload !== 'string') {
    return error('Missing required fields.', 400);
  }
  if (!ALLOWED_TYPES.includes(messageType)) {
    return error('Invalid message_type. Must be offer, answer, or ice.', 400);
  }
  if (payload.length > MAX_PAYLOAD_SIZE) {
    return error('Payload too large. Max 32KB per signaling message.', 413);
  }

  const sql = getSql(env);
  const validation = await validateSession(sql, sessionCode, fromPeerId);
  if (!validation.valid) {
    return error('Session validation failed: ' + validation.reason, 403);
  }
  // Verify the recipient is also a participant.
  const session = validation.session;
  if (toPeerId !== session.creator_peer_id && toPeerId !== session.joiner_peer_id) {
    return error('Recipient is not a participant in this session.', 403);
  }

  try {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const result = await sql`
      INSERT INTO signaling_messages
        (session_code, from_peer_id, to_peer_id, message_type, payload, created_at, expires_at)
      VALUES
        (${sessionCode}, ${fromPeerId}, ${toPeerId}, ${messageType}, ${payload}, NOW(), ${expiresAt})
      RETURNING id
    `;
    return json({ ok: true, id: result[0].id });
  } catch (e) {
    console.error('Signaling write error:', e.message);
    return error('Failed to write signaling message.', 500);
  }
}

export const onRequestPost = safe(handler);
export const onRequestOptions = handleOptions;
