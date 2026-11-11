// ============================================================================
// POST /api/signaling/consume
// Mark signaling messages as consumed (soft delete) so they aren't returned
// again on the next poll. The client sends an array of message IDs.
// ============================================================================
import { getSql } from '../../_lib/db.js';
import { json, error, handleOptions, safe } from '../../_lib/response.js';

async function handler({ env, request }) {
  let body;
  try { body = await request.json(); }
  catch { return error('Invalid JSON body', 400); }

  const ids = body?.ids;
  const peerId = body?.peer_id;

  if (!Array.isArray(ids) || !ids.length) {
    return error('ids must be a non-empty array.', 400);
  }
  if (!peerId || !/^[a-z0-9]{32}$/.test(peerId)) {
    return error('Invalid peer_id.', 400);
  }
  // Prevent mass-consume attacks - cap at 50 per request.
  if (ids.length > 50) {
    return error('Too many ids in one request. Max 50.', 400);
  }

  // Validate each id is a UUID.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const id of ids) {
    if (typeof id !== 'string' || !uuidRe.test(id)) {
      return error('Invalid message id: ' + id, 400);
    }
  }

  const sql = getSql(env);
  try {
    // Only mark consumed if the message is addressed to this peer.
    // This prevents one peer from consuming the other's messages.
    await sql`
      UPDATE signaling_messages
      SET consumed = TRUE
      WHERE id = ANY(${sql(ids)}::uuid[])
        AND to_peer_id = ${peerId}
    `;
    return json({ ok: true });
  } catch (e) {
    console.error('Signaling consume error:', e.message);
    return error('Failed to mark messages consumed.', 500);
  }
}

export const onRequestPost = safe(handler);
export const onRequestOptions = handleOptions;
