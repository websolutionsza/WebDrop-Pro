/**
 * Cloudflare Pages Function — /api/session
 * Secure serverless proxy for WebDrop Pro QR pairing sessions.
 * Secrets are read ONLY from context.env. They never reach the browser.
 *
 * Contract:
 *   POST { op:"create",  id }  -> insert pending session
 *   POST { op:"connect", id }  -> mark session connected
 *   GET  ?id=<sessionId>       -> read session row
 *   GET  ?debug=1              -> diagnostics (which REST base works)
 */

const TABLE = 'device_sessions';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS
    }
  });
}

// Candidate REST bases, tried in order. Override with env.POSTBASE_REST_PATH.
function getBases(env) {
  const base = String(env.POSTBASE_URL || '').replace(/\/+$/, '');
  if (!base) return [];
  if (env.POSTBASE_REST_PATH && String(env.POSTBASE_REST_PATH).trim()) {
    return [base + String(env.POSTBASE_REST_PATH).replace(/\/+$/, '')];
  }
  return [
    base + '/rest/v1',
    base + '/api/rest/v1',
    base + '/api/v1',
    base + '/v1',
    base + '/rest',
    base + '/api',
    base
  ];
}

function headersFor(env, extra) {
  const key = env.POSTBASE_ANON_KEY || '';
  const h = {
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (env.POSTBASE_PROJECT_ID) h['x-project-id'] = env.POSTBASE_PROJECT_ID;
  return Object.assign(h, extra || {});
}

let _cachedBase = null;

async function tableRequest(env, method, query, body) {
  const bases = _cachedBase ? [_cachedBase] : getBases(env);
  const tried = [];

  for (const base of bases) {
    const url = base + '/' + TABLE + (query || '');
    let res, text;
    try {
      res = await fetch(url, {
        method,
        headers: headersFor(env, body ? { 'Prefer': 'return=representation' } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      text = await res.text();
    } catch (e) {
      tried.push({ url, error: String((e && e.message) || e) });
      continue;
    }
    tried.push({ url, status: res.status });

    // 404 / 405 on a candidate means wrong path — try the next one.
    if ((res.status === 404 || res.status === 405) && !_cachedBase) continue;

    _cachedBase = base;
    return { ok: res.ok, status: res.status, text, url, tried };
  }

  return { ok: false, status: 0, text: '', url: null, tried };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // ---- diagnostics ----
  if (url.searchParams.get('debug') === '1') {
    const bases = getBases(env);
    const probes = [];
    for (const base of bases) {
      const probeUrl = base + '/' + TABLE + '?limit=1';
      try {
        const res = await fetch(probeUrl, { method: 'GET', headers: headersFor(env) });
        const text = await res.text();
        probes.push({
          url: probeUrl,
          status: res.status,
          ok: res.ok,
          bodyPreview: text.slice(0, 300)
        });
      } catch (e) {
        probes.push({ url: probeUrl, error: String((e && e.message) || e) });
      }
    }
    return json({
      config: {
        POSTBASE_URL: env.POSTBASE_URL ? 'set' : 'MISSING',
        POSTBASE_ANON_KEY: env.POSTBASE_ANON_KEY ? 'set' : 'MISSING',
        POSTBASE_PROJECT_ID: env.POSTBASE_PROJECT_ID ? 'set' : 'MISSING',
        POSTBASE_REST_PATH: env.POSTBASE_REST_PATH || '(auto-detect)'
      },
      candidateBases: bases,
      probes,
      cachedBase: _cachedBase
    });
  }

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing id parameter' }, 400);

  const res = await tableRequest(env, 'GET', '?id=eq.' + encodeURIComponent(id) + '&limit=1');
  if (!res.ok) {
    return json({
      error: 'Upstream query failed',
      status: res.status,
      detail: res.text.slice(0, 500),
      tried: res.tried
    }, 502);
  }

  let rows;
  try { rows = JSON.parse(res.text); } catch { rows = []; }
  const row = Array.isArray(rows) ? rows[0] : rows;
  return json({ ok: true, session: row || null });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  const op = body && body.op;
  const id = body && body.id;
  if (!op) return json({ error: 'Missing op' }, 400);
  if (!id) return json({ error: 'Missing id' }, 400);

  if (op === 'create') {
    const res = await tableRequest(env, 'POST', '', {
      id,
      status: 'pending',
      user_id: null,
      created_at: new Date().toISOString()
    });
    if (!res.ok) {
      return json({
        error: 'Create failed',
        status: res.status,
        detail: res.text.slice(0, 500),
        tried: res.tried
      }, 502);
    }
    return json({ ok: true, id, url: res.url });
  }

  if (op === 'connect') {
    const res = await tableRequest(env, 'PATCH', '?id=eq.' + encodeURIComponent(id), {
      status: 'connected'
    });
    if (!res.ok) {
      return json({
        error: 'Update failed',
        status: res.status,
        detail: res.text.slice(0, 500),
        tried: res.tried
      }, 502);
    }
    return json({ ok: true });
  }

  return json({ error: 'Unknown op: ' + op }, 400);
}
