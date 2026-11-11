// ============================================================================
// cleanup.js - lazy cleanup of expired rows
// Runs on every session/signaling/history request so we don't need a cron.
// Uses the expires_at indexes we created in the migration.
// ============================================================================
export async function cleanupExpired(sql) {
  try {
    await sql`DELETE FROM transfer_sessions WHERE expires_at < NOW()`;
    await sql`DELETE FROM signaling_messages WHERE expires_at < NOW()`;
    await sql`DELETE FROM transfer_history WHERE expires_at < NOW()`;
  } catch (e) {
    // Cleanup is best-effort - don't fail the actual request if cleanup fails.
    console.error('Cleanup failed:', e.message);
  }
}
