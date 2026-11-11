// ============================================================================
// db.js - Neon PostgreSQL connection helper
// Uses the Neon serverless driver (HTTP-based, no persistent TCP connections)
// which is designed for edge runtimes like Cloudflare Workers/Pages.
// ============================================================================
import { neon } from '@neondatabase/serverless';

// Cache the sql tagged-template function per DATABASE_URL so we don't
// re-initialise on every request within the same isolate.
let cachedSql = null;
let cachedUrl = null;

export function getSql(env) {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not configured');
  }
  if (!cachedSql || cachedUrl !== url) {
    cachedSql = neon(url);
    cachedUrl = url;
  }
  return cachedSql;
}

// Check if the database is reachable. Used by the frontend to display
// "backend temporarily unavailable" without crashing the UI.
export async function pingDatabase(env) {
  try {
    const sql = getSql(env);
    await sql`SELECT 1`;
    return true;
  } catch (e) {
    console.error('Database ping failed:', e.message);
    return false;
  }
}
