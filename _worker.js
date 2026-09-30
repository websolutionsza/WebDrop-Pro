const TABLE = 'device_sessions';

/*
  WebDrop Pro — hardened Cloudflare Worker

  Required Worker variables/secrets:
    POSTBASE_URL
    POSTBASE_ANON_KEY
    POSTBASE_PROJECT_ID

  Optional:
    ALLOWED_ORIGIN
    DEBUG_TOKEN

  Optional Cloudflare Rate Limiting bindings:
    SESSION_CREATE_LIMITER
    SESSION_READ_LIMITER
    SESSION_CONNECT_LIMITER
*/

const MAX_BODY_BYTES = 4096;
const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeOrigin(value) {
  try {
    return new URL(String(value || '')).origin;
  } catch {
    return '';
  }
}

function getAllowedOrigin(request, env) {
  const configured = normalizeOrigin(env.ALLOWED_ORIGIN);

  // If ALLOWED_ORIGIN isn't configured, only allow the same
  // origin that is serving this Worker.
  return configured || new URL(request.url).origin;
}

function isOriginAllowed(request, env) {
  const origin = request.headers.get('Origin');

  // Normal same-origin fetches may not require an Origin header.
  if (origin) {
    const allowed = getAllowedOrigin(request, env);

    if (normalizeOrigin(origin) !== allowed) {
      return false;
    }
  }

  // Extra browser-side CSRF protection.
  const fetchSite = request.headers.get('Sec-Fetch-Site');

  if (fetchSite === 'cross-site' && !origin) {
    return false;
  }

  return true;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = getAllowedOrigin(request, env);

  const headers = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Debug-Token',
    'Access-Control-Max-Age': '600'
  };

  if (origin && normalizeOrigin(origin) === allowed) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY'
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...securityHeaders(),
      ...extraHeaders
    }
  });
}

function errorResponse(request, env, status, message) {
  return json(
    { error: message },
    status,
    corsHeaders(request, env)
  );
}

function headersFor(env, extra) {
  const key = String(env.POSTBASE_ANON_KEY || '');

  const h = {
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  if (env.POSTBASE_PROJECT_ID) {
    h['x-project-id'] = String(env.POSTBASE_PROJECT_ID);
  }

  return Object.assign(h, extra || {});
}

function validatePostbaseConfig(env) {
  const base = String(env.POSTBASE_URL || '').trim();
  const key = String(env.POSTBASE_ANON_KEY || '').trim();

  if (!base || !key) {
    return false;
  }

  try {
    const u = new URL(base);

    // Only allow HTTPS Postbase endpoints.
    if (u.protocol !== 'https:') {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

async function queryPostbase(env, operation, table, filters, data) {
  if (!validatePostbaseConfig(env)) {
    return {
      ok: false,
      status: 500,
      data: { error: 'Server database configuration is invalid.' }
    };
  }

  const base = String(env.POSTBASE_URL).replace(/\/+$/, '');
  const url = `${base}/api/db/query`;

  const body = {
    operation,
    table
  };

  if (filters && filters.length > 0) {
    body.filters = filters;
  }

  if (data !== undefined && data !== null) {
    body.data = data;
  }

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 10000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: headersFor(env),
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const text = await res.text();

    let result;

    try {
      result = JSON.parse(text);
    } catch {
      result = {
        raw: String(text || '').slice(0, 1000)
      };
    }

    return {
      ok: res.ok,
      status: res.status,
      data: result
    };
  } catch (error) {
    console.error('Postbase request failed:', error);

    return {
      ok: false,
      status: 504,
      data: {
        error: 'Database service unavailable.'
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

/*
  Optional Cloudflare Worker Rate Limiting binding.

  If the binding isn't installed yet, the Worker still functions.
  Once you add the bindings, the limits become active.
*/
async function checkRateLimit(env, bindingName, key) {
  const limiter = env[bindingName];

  if (!limiter || typeof limiter.limit !== 'function') {
    return true;
  }

  try {
    const result = await limiter.limit({
      key: String(key)
    });

    return result.success === true;
  } catch (error) {
    console.error(`Rate limiter ${bindingName} failed:`, error);

    // Fail closed when a configured limiter itself fails.
    return false;
  }
}

function getClientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    'unknown'
  );
}

function validateSessionId(id) {
  return typeof id === 'string' &&
    SESSION_ID_RE.test(id.trim());
}

async function readJsonBody(request) {
  const contentLength = request.headers.get('Content-Length');

  if (
    contentLength &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_BODY_BYTES
  ) {
    return {
      ok: false,
      error: 'Request body too large.'
    };
  }

  const contentType = String(
    request.headers.get('Content-Type') || ''
  ).toLowerCase();

  if (!contentType.startsWith('application/json')) {
    return {
      ok: false,
      error: 'Content-Type must be application/json.'
    };
  }

  const text = await request.text();

  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return {
      ok: false,
      error: 'Request body too large.'
    };
  }

  try {
    return {
      ok: true,
      data: JSON.parse(text)
    };
  } catch {
    return {
      ok: false,
      error: 'Invalid JSON body.'
    };
  }
}

function sanitizeSessionRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  return {
    id: typeof row.id === 'string'
      ? row.id
      : null,

    status:
      row.status === 'connected'
        ? 'connected'
        : 'pending',

    created_at:
      typeof row.created_at === 'string'
        ? row.created_at
        : null
  };
}

/*
  Sessions are temporary pairing records.
  A QR session older than 15 minutes is treated as expired
  for GET requests.
*/
function sessionExpired(createdAt) {
  if (!createdAt) {
    return true;
  }

  const timestamp = Date.parse(createdAt);

  if (!Number.isFinite(timestamp)) {
    return true;
  }

  return Date.now() - timestamp > 15 * 60 * 1000;
}

async function handleDebug(request, env) {
  /*
    Debugging is disabled unless DEBUG_TOKEN exists.

    The browser/frontend never calls this route.
    To use it manually, send:

      X-Debug-Token: <your secret>
  */

  const debugToken = String(env.DEBUG_TOKEN || '');

  if (!debugToken) {
    return errorResponse(request, env, 404, 'Not found');
  }

  const suppliedToken = String(
    request.headers.get('X-Debug-Token') || ''
  );

  if (!suppliedToken || suppliedToken !== debugToken) {
    return errorResponse(request, env, 404, 'Not found');
  }

  const result = await queryPostbase(
    env,
    'select',
    TABLE,
    [
      {
        column: 'id',
        operator: 'eq',
        value: '00000000-0000-4000-8000-000000000000'
      }
    ],
    null
  );

  return json(
    {
      ok: result.ok,
      status: result.status,
      databaseReachable: result.ok,
      note: 'Debug query executed successfully.'
    },
    result.ok ? 200 : 502,
    corsHeaders(request, env)
  );
}

async function handleSession(request, env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  /*
    CORS / origin protection
  */
  if (!isOriginAllowed(request, env)) {
    return errorResponse(
      request,
      env,
      403,
      'Origin not allowed.'
    );
  }

  /*
    OPTIONS / CORS preflight
  */
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...securityHeaders(),
        ...corsHeaders(request, env)
      }
    });
  }

  /*
    Disabled debug endpoint by default.
  */
  if (
    method === 'GET' &&
    url.searchParams.get('debug') === '3'
  ) {
    return handleDebug(request, env);
  }

  /*
    GET /api/session?id=<uuid>
  */
  if (method === 'GET') {
    const id = String(
      url.searchParams.get('id') || ''
    ).trim();

    if (!validateSessionId(id)) {
      return errorResponse(
        request,
        env,
        400,
        'Invalid session id.'
      );
    }

    /*
      The frontend polls every 1.5 seconds.
      120/min therefore leaves plenty of normal headroom.
    */
    const allowed = await checkRateLimit(
      env,
      'SESSION_READ_LIMITER',
      `read:${id}`
    );

    if (!allowed) {
      return errorResponse(
        request,
        env,
        429,
        'Too many requests.'
      );
    }

    const result = await queryPostbase(
      env,
      'select',
      TABLE,
      [
        {
          column: 'id',
          operator: 'eq',
          value: id
        }
      ],
      null
    );

    if (!result.ok) {
      console.error(
        'Session GET database failure:',
        result.status
      );

      /*
        Do NOT expose Postbase's raw error response.
      */
      return errorResponse(
        request,
        env,
        502,
        'Database query failed.'
      );
    }

    const row =
      result.data &&
      Array.isArray(result.data.data)
        ? result.data.data[0]
        : null;

    if (!row) {
      return json(
        {
          ok: true,
          session: null
        },
        200,
        corsHeaders(request, env)
      );
    }

    /*
      Expired sessions are hidden from clients.
    */
    if (sessionExpired(row.created_at)) {
      return json(
        {
          ok: true,
          session: null
        },
        200,
        corsHeaders(request, env)
      );
    }

    return json(
      {
        ok: true,
        session: sanitizeSessionRow(row)
      },
      200,
      corsHeaders(request, env)
    );
  }

  /*
    POST /api/session
    {
      "op": "create",
      "id": "<uuid>"
    }

    or

    {
      "op": "connect",
      "id": "<uuid>"
    }
  */
  if (method === 'POST') {
    const bodyResult = await readJsonBody(request);

    if (!bodyResult.ok) {
      return errorResponse(
        request,
        env,
        400,
        bodyResult.error
      );
    }

    const body = bodyResult.data;

    const op = body && body.op;
    const id = body && body.id;

    if (typeof op !== 'string') {
      return errorResponse(
        request,
        env,
        400,
        'Missing op.'
      );
    }

    if (!validateSessionId(id)) {
      return errorResponse(
        request,
        env,
        400,
        'Invalid session id.'
      );
    }

    /*
      CREATE
    */
    if (op === 'create') {
      const allowed = await checkRateLimit(
        env,
        'SESSION_CREATE_LIMITER',
        `create:${getClientIp(request)}`
      );

      if (!allowed) {
        return errorResponse(
          request,
          env,
          429,
          'Too many session creations. Please slow down.'
        );
      }

      const result = await queryPostbase(
        env,
        'insert',
        TABLE,
        null,
        {
          id,
          status: 'pending',
          user_id: null,
          created_at: new Date().toISOString()
        }
      );

      if (!result.ok) {
        console.error(
          'Session create failed:',
          result.status
        );

        /*
          Don't expose Postbase internals.
        */
        return errorResponse(
          request,
          env,
          502,
          'Create failed.'
        );
      }

      return json(
        {
          ok: true,
          id
        },
        200,
        corsHeaders(request, env)
      );
    }

    /*
      CONNECT
    */
    if (op === 'connect') {
      const allowed = await checkRateLimit(
        env,
        'SESSION_CONNECT_LIMITER',
        `connect:${id}`
      );

      if (!allowed) {
        return errorResponse(
          request,
          env,
          429,
          'Too many connection attempts.'
        );
      }

      const result = await queryPostbase(
        env,
        'update',
        TABLE,
        [
          {
            column: 'id',
            operator: 'eq',
            value: id
          }
        ],
        {
          status: 'connected'
        }
      );

      if (!result.ok) {
        console.error(
          'Session connect failed:',
          result.status
        );

        return errorResponse(
          request,
          env,
          502,
          'Update failed.'
        );
      }

      return json(
        {
          ok: true
        },
        200,
        corsHeaders(request, env)
      );
    }

    return errorResponse(
      request,
      env,
      400,
      'Unknown operation.'
    );
  }

  return errorResponse(
    request,
    env,
    405,
    'Method not allowed.'
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /*
      API endpoint
    */
    if (
      url.pathname === '/api/session' ||
      url.pathname === '/api/session/'
    ) {
      return handleSession(request, env);
    }

    /*
      Everything else remains your static website.
    */
    return env.ASSETS.fetch(request);
  }
};
