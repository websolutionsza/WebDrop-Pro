// ============================================================================
// response.js - HTTP response helpers shared by all Functions
// ============================================================================
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '600',
  'Vary': 'Origin'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY'
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
      ...SECURITY_HEADERS,
      ...extraHeaders
    }
  });
}

export function error(message, status = 400) {
  return json({ error: message }, status);
}

export function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, ...SECURITY_HEADERS }
  });
}

// Wrap an async handler so exceptions don't leak stack traces to the client.
export function safe(fn) {
  return async (ctx) => {
    try {
      return await fn(ctx);
    } catch (e) {
      console.error('Unhandled error:', e);
      return error('Internal server error', 500);
    }
  };
}
