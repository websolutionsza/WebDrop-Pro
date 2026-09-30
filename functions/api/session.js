/**
 * Cloudflare Pages Function — /api/session
 * Secure serverless proxy for WebDrop Pro QR pairing sessions.
 * Secrets are read ONLY from context.env. They never reach the browser.
 *
 * POST { op: "create",  id }  -> inserts a pending session row
 * POST { op: "connect", id }  -> marks a session as connected
 * GET  ?id=<sessionId>        -> returns the session row
 */

const TABLE = 'device_sessions';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS
    }
  });
}

function assertConfig(env) {
  if (!env.POSTBASE_URL || !env.POSTBASE_ANON_KEY) {
    return 'Server not configured: missing POSTBASE_URL or POSTBASE_ANON_KEY';
  }
  return null;
}

function restEndpoint(env, query = '') {
  const base = String(env.POSTBASE_URL).replace(/\/+$/, '');
  const path = (env.POSTBASE_REST_PATH || '/rest/v1').replace(/\/+$/, '');
  return `${base}${path}/${TABLE}${query}`;
}

function upstreamHeaders(env, extra = {}) {
  const h = {
    'apikey': env.POSTBASE_ANON_KEY,
    'Authorization': `Bearer ${env.POSTBASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (env.POSTBASE_PROJECT_ID) {
    h['x-project-id'] = env.POSTBASE_PROJECT_ID;
  }
  return Object.assign(h, extra);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const cfgErr = assertConfig(env);
  if (cfgErr) return json({ error: cfgErr }, 500);

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing id parameter' }, 400);

  try {
    const res = await fetch(
      restEndpoint(env, `?id=eq.${encodeURIComponent(id)}&limit=1`),
      { method: 'GET', headers: upstreamHeaders(env) }
    );

    const text = await res.text();
    if (!res.ok) {
      return json({ error: 'Upstream query failed', status: res.status, detail: text }, 502);
    }

    let rows;
    try { rows = JSON.parse(text); } catch { rows = []; }
    const row = Array.isArray(rows) ? rows[0] : rows;

    return json({ ok: true, session: row || null });
  } catch (err) {
    return json({ error: 'Upstream unreachable', detail: String(err && err.message || err) }, 502);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cfgErr = assertConfig(env);
  if (cfgErr) return json({ error: cfgErr }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const op = body && body.op;
  const id = body && body.id;

  if (!op) return json({ error: 'Missing op' }, 400);
  if (!id) return json({ error: 'Missing id' }, 400);

  try {
    if (op === 'create') {
      const res = await fetch(restEndpoint(env), {
        method: 'POST',
        headers: upstreamHeaders(env, { 'Prefer': 'return=representation' }),
        body: JSON.stringify({
          id,
          status: 'pending',
          user_id: null,
          created_at: new Date().toISOString()
        })
      });

      const text = await res.text();
      if (!res.ok) {
        return json({ error: 'Create failed', status: res.status, detail: text }, 502);
      }
      return json({ ok: true, id });
    }

    if (op === 'connect') {
      const res = await fetch(
        restEndpoint(env, `?id=eq.${encodeURIComponent(id)}`),
        {
          method: 'PATCH',
          headers: upstreamHeaders(env, { 'Prefer': 'return=minimal' }),
          body: JSON.stringify({ status: 'connected' })
        }
      );

      const text = await res.text();
      if (!res.ok) {
        return json({ error: 'Update failed', status: res.status, detail: text }, 502);
      }
      return json({ ok: true });
    }

    return json({ error: 'Unknown op: ' + op }, 400);
  } catch (err) {
    return json({ error: 'Upstream error', detail: String(err && err.message || err) }, 502);
  }
}
