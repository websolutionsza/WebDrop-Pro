const TABLE = 'device_sessions';

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

// Helper to call the Postbase /api/db/query endpoint with the correct format
async function queryPostbase(env, operation, table, filters, data) {
    const base = String(env.POSTBASE_URL || '').replace(/\/+$/, '');
    const url = `${base}/api/db/query`;

    const body = {
        operation: operation,
        table: table
    };

    if (filters && filters.length > 0) {
        body.filters = filters;
    }

    if (data) {
        body.data = data;
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: headersFor(env),
        body: JSON.stringify(body)
    });
    
    const text = await res.text();
    let result;
    try { result = JSON.parse(text); } catch { result = { raw: text }; }
    
    return { ok: res.ok, status: res.status, data: result };
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
    // Debug mode to test the connection
    if (url.searchParams.get('debug') === '3') {
        const result = await queryPostbase(env, 'select', TABLE, [], null);
        return json({
            note: 'Testing /api/db/query with a select operation',
            url: `${String(env.POSTBASE_URL || '').replace(/\/+$/, '')}/api/db/query`,
            status: result.status,
            ok: result.ok,
            response: result.data
        });
    }

    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'Missing id parameter' }, 400);

    const result = await queryPostbase(env, 'select', TABLE, [
        { column: 'id', operator: 'eq', value: id }
    ], null);

    if (!result.ok) {
      return json({ error: 'Database query failed', detail: result.data }, 502);
    }
    
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
      const result = await queryPostbase(env, 'insert', TABLE, null, {
        id: id,
        status: 'pending',
        user_id: null,
        created_at: new Date().toISOString()
      });

      if (!result.ok) {
        return json({ error: 'Create failed', detail: result.data }, 502);
      }
      return json({ ok: true, id: id, created: result.data });
    }

    if (op === 'connect') {
      const result = await queryPostbase(env, 'update', TABLE, [
        { column: 'id', operator: 'eq', value: id }
      ], {
        status: 'connected'
      });

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
