const TABLE = 'device_sessions';

// The project ID from your Postbase instance
const PROJECT_ID = '7933361d-a2da-4747-b5f0-7fdc8c85253d';

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept'
    }
  });
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

// New function to call the Postbase /api/db/query endpoint
async function queryPostbase(env, sql, params) {
    const base = String(env.POSTBASE_URL || '').replace(/\/+$/, '');
    const url = `${base}/api/db/query`;

    const res = await fetch(url, {
        method: 'POST',
        headers: headersFor(env),
        body: JSON.stringify({ query: sql, params: params })
    });
    
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    
    return { ok: res.ok, status: res.status, data: data };
}

async function handleSession(request, env) {
  const url = new URL(request.url);
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept'
    }});
  }

  if (method === 'GET') {
    // New debug mode to test the correct endpoint
    if (url.searchParams.get('debug') === '2') {
        const testSql = 'SELECT 1 as test';
        const result = await queryPostbase(env, testSql, []);
        return json({
            note: 'Testing the /api/db/query endpoint',
            url: `${String(env.POSTBASE_URL || '').replace(/\/+$/, '')}/api/db/query`,
            status: result.status,
            ok: result.ok,
            response: result.data
        });
    }

    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'Missing id parameter' }, 400);

    const sql = `SELECT * FROM ${TABLE} WHERE id = $1 LIMIT 1`;
    const result = await queryPostbase(env, sql, [id]);

    if (!result.ok) {
      return json({ error: 'Database query failed', detail: result.data }, 502);
    }
    
    // Postbase returns results in a `data` array
    const row = result.data && result.data.data ? result.data.data[0] : null;
    return json({ ok: true, session: row || null });
  }

  if (method === 'POST') {
    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid JSON body' }, 400); }

    const op = body && body.op;
    const id = body && body.id;
    if (!op) return json({ error: 'Missing op' }, 400);
    if (!id) return json({ error: 'Missing id' }, 400);

    if (op === 'create') {
      const sql = `INSERT INTO ${TABLE} (id, status, user_id, created_at) VALUES ($1, $2, $3, $4) RETURNING *`;
      const params = [id, 'pending', null, new Date().toISOString()];
      const result = await queryPostbase(env, sql, params);

      if (!result.ok) {
        return json({ error: 'Create failed', detail: result.data }, 502);
      }
      return json({ ok: true, id: id, created: result.data });
    }

    if (op === 'connect') {
      const sql = `UPDATE ${TABLE} SET status = $1 WHERE id = $2`;
      const params = ['connected', id];
      const result = await queryPostbase(env, sql, params);

      if (!result.ok) {
        return json({ error: 'Update failed', detail: result.data }, 502);
      }
      return json({ ok: true });
    }

    return json({ error: 'Unknown op: ' + op }, 400);
  }

  return json({ error: 'Method not allowed' }, 405);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/session' || url.pathname === '/api/session/') {
      return handleSession(request, env);
    }

    // Serve everything else as static assets (your website)
    return env.ASSETS.fetch(request);
  }
};
