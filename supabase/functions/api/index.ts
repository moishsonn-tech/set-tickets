// @ts-nocheck — plain JavaScript (Deno runs it as TypeScript).
/* SET read-only API for a box office's own systems. Deploy: supabase functions deploy api --no-verify-jwt
   A box office creates a key in Marketing → Integrations → API keys (shown once; only its SHA-256 is stored) and calls:
     GET /functions/v1/api/v1/events | orders | tickets | customers | seating | checkins | products | finance | reports   ?since=<ISO time>&limit=<1-500>
     Authorization: Bearer set_live_…
   Each key carries scopes (events:read, orders:read, … reports:read) and is limited to 120 calls a minute. Stage 10: a scope only works while the
   person who created the key still has the matching permission in that box office (api_auth re-checks it on every call).
   Writes and real-time notifications go the other way: webhooks (Marketing → Integrations). */
const env = Deno.env.toObject();
const SCOPE = { events: 'events:read', orders: 'orders:read', tickets: 'tickets:read', customers: 'customers:read', seating: 'seating:read', checkins: 'checkins:read',
  products: 'products:read', finance: 'finance:read', reports: 'reports:read' };
async function rpc(fn, args) {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', body: JSON.stringify(args),
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' } });
  const t = await r.text(), j = t ? JSON.parse(t) : null; if (!r.ok) throw new Error(j?.message || 'database error'); return j;
}
const out = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');

Deno.serve(async req => {
  try {
    if (req.method !== 'GET') return out({ error: 'read-only API: use GET' }, 405);
    const url = new URL(req.url), res = url.pathname.split('/').filter(Boolean).pop(), key = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!/^set_live_[0-9a-f]{40}$/.test(key)) return out({ error: 'missing or malformed API key' }, 401);
    const k = await rpc('api_auth', { p_hash: await sha256(key) }); if (!k) return out({ error: 'invalid or revoked API key' }, 401);
    if (k.limited) return out({ error: 'rate limit: 120 requests a minute' }, 429);
    if (!SCOPE[res]) return out({ error: 'unknown resource — use /v1/' + Object.keys(SCOPE).join(', /v1/') }, 404);
    if (!k.scopes.includes(SCOPE[res])) return out({ error: `this key may not read ${res}` }, 403);
    const since = url.searchParams.get('since'), limit = +url.searchParams.get('limit') || 100;
    if (since && isNaN(Date.parse(since))) return out({ error: 'since must be an ISO date/time' }, 400);
    const data = await rpc('api_read', { p_bo: k.box_office_id, p_resource: res, p_since: since || null, p_limit: limit });
    return out({ data, count: data.length, next_since: data.length ? data[data.length - 1].created_at || data[data.length - 1].issued_at || null : null });
  } catch (e) { console.error(e); return out({ error: 'server error' }, 500); }
});
