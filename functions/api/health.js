// ============================================================================
// GET /api/health
// Lightweight diagnostic endpoint. Used by the frontend to surface a clear
// "backend available" / "backend unavailable" state and to identify which
// TURN provider is configured. NEVER returns credentials or DB connection
// strings - only booleans and config flags that are safe to show the user.
// ============================================================================
import { json, handleOptions, safe } from '../_lib/response.js';
import { pingDatabase } from '../_lib/db.js';

async function handler({ env }) {
  const hasDb = !!env.DATABASE_URL;
  const hasTurnStatic = !!(env.TURN_USERNAME && env.TURN_PASSWORD);
  const hasTurnEphemeral = !!(env.METERED_APP_ID && env.METERED_SECRET_KEY);
  const turnProvider = env.TURN_PROVIDER ||
    (hasTurnEphemeral ? 'metered-ephemeral' :
     hasTurnStatic ? 'metered-static' : 'none');

  let dbOk = false;
  if (hasDb) {
    dbOk = await pingDatabase(env);
  }

  return json({
    ok: true,
    time: new Date().toISOString(),
    database: {
      configured: hasDb,
      reachable: dbOk
    },
    turn: {
      configured: hasTurnStatic || hasTurnEphemeral,
      provider: turnProvider,
      mode: hasTurnEphemeral ? 'ephemeral' : (hasTurnStatic ? 'static' : 'none')
    }
  });
}

export const onRequestGet = safe(handler);
export const onRequestOptions = handleOptions;
