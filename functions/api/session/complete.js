// ============================================================================
// POST /api/session/complete
// Called by either peer when the transfer finishes. Writes a transfer_history
// row (no file contents - just metadata) and marks the session as completed.
// ============================================================================
import { getSql } from '../../_lib/db.js';
import { json, error, handleOptions, safe } from '../../_lib/response.js';
import { validateSession } from '../../_lib/auth.js';
import { cleanupExpired } from '../../_lib/cleanup.js';

async function handler({ env, request }) {
  let body;
  try { body = await request.json(); }
  catch { return error('Invalid JSON body', 400); }

  const sessionCode = body?.session_code;
  const peerId = body?.peer_id;
  const direction = body?.direction;        // 'sent' or 'received'
  const peerLabel = body?.peer_label;
  const fileCount = body?.file_count;
  const totalBytes = body?.total_bytes;
  const fileNames = body?.file_names;        // array of {name, size, hash}

  if (!sessionCode || !peerId || !direction) {
    return error('Missing required fields.', 400);
  }
  if (!['sent', 'received'].includes(direction)) {
    return error('Invalid direction.', 400);
  }
  if (typeof fileCount !== 'number' || typeof totalBytes !== 'number') {
    return error('file_count and total_bytes must be numbers.', 400);
  }
  if (!Array.isArray(fileNames)) {
    return error('file_names must be an array.', 400);
  }

  const sql = getSql(env);
  await cleanupExpired(sql);

  const validation = await validateSession(sql, sessionCode, peerId);
  if (!validation.valid) {
    return error('Session validation failed: ' + validation.reason, 403);
  }

  try {
    // Mark session complete (only if not already).
    await sql`
      UPDATE transfer_sessions
      SET status = 'completed',
          completed_at = NOW()
      WHERE session_code = ${sessionCode}
        AND status != 'completed'
    `;

    // Write history row. Expires in 24 hours.
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await sql`
      INSERT INTO transfer_history
        (session_code, peer_id, direction, peer_label, file_count,
         total_bytes, file_names, completed_at, expires_at)
      VALUES
        (${sessionCode}, ${peerId}, ${direction}, ${peerLabel || 'Unknown'},
         ${fileCount}, ${totalBytes}, ${JSON.stringify(fileNames)},
         NOW(), ${expiresAt})
    `;

    return json({ ok: true });
  } catch (e) {
    console.error('Session complete error:', e.message);
    return error('Failed to record transfer.', 500);
  }
}

export const onRequestPost = safe(handler);
export const onRequestOptions = handleOptions;
