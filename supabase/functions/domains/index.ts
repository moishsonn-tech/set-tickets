// @ts-nocheck — plain JavaScript (Deno runs it as TypeScript).
/* SET domains (Stage 10): checks a box office's custom domain and its email sending domain. Deploy: supabase functions deploy domains
   Secrets: RESEND_API_KEY (sending domains), SUPABASE_SERVICE_ROLE_KEY / SUPABASE_URL (set by Supabase). Called by the signed-in staff member:
     { action: 'site_verify', bo }  → looks up _set-verify.<host> TXT + the CNAME with DNS-over-HTTPS → domain_result(site)
     { action: 'mail_add', bo, domain } → creates the domain at Resend, stores its SPF / DKIM / bounce records (+ a DMARC suggestion)
     { action: 'mail_verify', bo } → asks Resend to verify, stores the status
   The caller must have admin.settings on that box office (checked with their own token through has_perm). */
const env = Deno.env.toObject();
// CORS: only the app's own origins (APP_ORIGINS, comma-separated — the same secret the payments function uses)
const ORIGINS = String(env.APP_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
let cors = {};
const setCors = req => { const o = req.headers.get('origin') || ''; cors = ORIGINS.includes(o) ? { 'Access-Control-Allow-Origin': o, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } : {}; };
const out = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
async function rest(path, body, auth) {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
    headers: { apikey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + (auth || env.SUPABASE_SERVICE_ROLE_KEY), 'Content-Type': 'application/json' } });
  const t = await r.text(), j = t ? JSON.parse(t) : null; if (!r.ok) throw new Error(j?.message || 'database error'); return j;
}
const doh = async (name, type) => { const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } }); const j = await r.json(); return (j.Answer || []).map(a => String(a.data).replace(/^"|"$/g, '').replace(/\.$/, '')); };
const resend = async (path, method = 'GET', body) => { const r = await fetch('https://api.resend.com' + path, { method, headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || 'Resend error ' + r.status); return j; };

Deno.serve(async req => {
  setCors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { action, bo, domain } = await req.json(), user = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!/^[0-9a-f-]{36}$/.test(bo || '')) return out({ error: 'bad request' }, 400);
    if (!(await rest('rpc/has_perm', { p_bo: bo, p_perm: 'admin.settings' }, user))) return out({ error: 'You don\'t have permission to do that' }, 403);
    const [b] = await rest(`box_offices?id=eq.${bo}&select=domain,mail_domain,name`), plat = (await rest('platform_settings?id=eq.1&select=data'))[0]?.data || {};
    if (action === 'site_verify') {
      const d = b?.domain; if (!d?.host) return out({ error: 'Add the domain first' }, 400);
      const txt = await doh('_set-verify.' + d.host, 'TXT'), cname = await doh(d.host, 'CNAME');
      const ok = txt.includes('set-verify=' + d.token) && cname.some(c => c === plat.domainTarget);
      const res = { status: ok ? 'verified' : 'pending', found: { txt, cname } }; await rest('rpc/domain_result', { p_bo: bo, p_kind: 'site', p: res }); return out({ ...d, ...res });
    }
    if (action === 'mail_add') {
      if (!env.RESEND_API_KEY) return out({ error: 'Email sending is not connected yet (RESEND_API_KEY)' }, 400);
      if (!domain) { await rest('rpc/domain_result', { p_bo: bo, p_kind: 'mail', p: { domain: null, status: 'removed' } }); return out({}); }
      if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return out({ error: 'Enter a domain like yourvenue.com' }, 400);
      const r = await resend('/domains', 'POST', { name: domain });
      const records = (r.records || []).map(x => ({ type: x.type, name: x.name.includes(domain) ? x.name : x.name + '.' + domain, value: x.priority ? `${x.priority} ${x.value}` : x.value, purpose: x.record, status: x.status }))
        .concat([{ type: 'TXT', name: '_dmarc.' + domain, value: 'v=DMARC1; p=none; rua=mailto:dmarc@' + domain, purpose: 'DMARC' }]);
      const res = { domain, provider_id: r.id, status: r.status === 'verified' ? 'verified' : 'pending', records }; await rest('rpc/domain_result', { p_bo: bo, p_kind: 'mail', p: res }); return out(res);
    }
    if (action === 'mail_verify') {
      const m = b?.mail_domain; if (!m?.provider_id) return out({ error: 'Add the sending domain first' }, 400);
      await resend(`/domains/${m.provider_id}/verify`, 'POST'); const r = await resend(`/domains/${m.provider_id}`);
      const res = { status: r.status === 'verified' ? 'verified' : 'pending', records: (m.records || []).map(x => ({ ...x, status: (r.records || []).find(y => y.record === x.purpose)?.status || x.status })) };
      await rest('rpc/domain_result', { p_bo: bo, p_kind: 'mail', p: res }); return out({ ...m, ...res });
    }
    return out({ error: 'unknown action' }, 400);
  } catch (e) { console.error(e); try { await rest('rpc/log_error', { p_source: 'function', p_where: 'api', p_message: 'domains: ' + e.message }); } catch (x) { } return out({ error: e.message }, 500); }
});
