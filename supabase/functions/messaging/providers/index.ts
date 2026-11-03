// @ts-nocheck — plain JavaScript (Deno runs it as TypeScript); kept annotation-free so any JS engine can syntax-check it.
/* Message + integration adapters. Each one is a small object; adding a provider = one entry here. Secrets come from Supabase secrets
   (env) for the platform's own senders, and from the box office's integration row (server-side only) for their CRMs.

   EMAIL[name].send({ to, from, replyTo, subject, html, text, headers }, env)  → { id }   throws Err(msg, permanent)
   SMS[name].send({ to, body }, env)                                           → { id }
   SMS[name].inbound(req, raw, url, env)                                       → { from, body } | null   (verifies the provider's signature)
   EMAIL[name].events(req, raw, env)                                           → [{ id, type: 'bounced' | 'complaint' | 'delivered' }] | null
   CRM[kind].sync({ integration, contact, payload }, env)                      → short response text
   META_CAPI.send(...) / WEBHOOK.send(...)                                     → short response text */
export class Err extends Error { constructor(m, permanent = false) { super(m); this.permanent = permanent; } }
const ok = async (r, what) => { const t = await r.text(); if (!r.ok) throw new Err(`${what} ${r.status}: ${t.slice(0, 200)}`, r.status >= 400 && r.status < 500 && r.status !== 429); return t; };
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
async function hmac(alg, key, msg, out = 'hex') {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: alg }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, enc.encode(msg)); return out === 'hex' ? hex(s) : btoa(String.fromCharCode(...new Uint8Array(s)));
}
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(String(s || '').trim().toLowerCase())));
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

export const EMAIL = {
  resend: {
    async send(m, env) {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': m.idem },
        body: JSON.stringify({ from: m.from, to: [m.to], reply_to: m.replyTo || undefined, subject: m.subject, html: m.html, text: m.text, headers: m.headers }) });
      return { id: JSON.parse(await ok(r, 'Resend')).id };
    },
    // Resend signs webhooks with Svix: svix-id, svix-timestamp, svix-signature = "v1,<base64 HMAC-SHA256 of id.timestamp.body>"
    async events(req, raw, env) {
      const id = req.headers.get('svix-id') || '', ts = req.headers.get('svix-timestamp') || '', sig = req.headers.get('svix-signature') || '';
      if (!env.RESEND_WEBHOOK_SECRET || !id || Math.abs(Date.now() / 1000 - +ts) > 300) return null;
      const key = Uint8Array.from(atob(env.RESEND_WEBHOOK_SECRET.replace(/^whsec_/, '')), c => c.charCodeAt(0));
      const want = await hmac('SHA-256', key, `${id}.${ts}.${raw}`, 'b64');
      if (!sig.split(' ').some(s => same(s.replace(/^v1,/, ''), want))) return null;
      const e = JSON.parse(raw), type = { 'email.bounced': 'bounced', 'email.complained': 'complaint', 'email.delivered': 'delivered' }[e.type];
      return type ? [{ id: e.data?.email_id, type }] : [];
    },
  },
};
export const SMS = {
  twilio: {
    async send(m, env) {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, { method: 'POST',
        headers: { Authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: m.to, Body: m.body, ...(env.TWILIO_MESSAGING_SERVICE_SID ? { MessagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID } : { From: env.TWILIO_FROM }) }) });
      return { id: JSON.parse(await ok(r, 'Twilio')).sid };
    },
    // X-Twilio-Signature = base64 HMAC-SHA1(auth token, full URL + each POST param name+value sorted by name)
    async inbound(req, raw, url, env) {
      const p = new URLSearchParams(raw), s = url + [...p.keys()].sort().map(k => k + p.get(k)).join('');
      if (!env.TWILIO_AUTH_TOKEN || !same(await hmac('SHA-1', env.TWILIO_AUTH_TOKEN, s, 'b64'), req.headers.get('x-twilio-signature') || '')) return null;
      return { from: p.get('From') || '', body: p.get('Body') || '' };
    },
  },
};
// CRMs: upsert the contact with its tags. Only opted-in contacts unless the box office chose "all buyers" (then as non-marketing contacts).
const nameParts = n => { const [f, ...l] = String(n || '').trim().split(/\s+/); return [f || '', l.join(' ')]; };
export const CRM = {
  mailchimp: { async sync({ integration: g, contact: c }) {
    const [f, l] = nameParts(c.name);   // the member endpoint takes the email address itself in place of its MD5 hash
    const base = `https://${g.config.dc}.api.mailchimp.com/3.0/lists/${encodeURIComponent(g.config.list)}/members/${encodeURIComponent(c.email)}`, auth = { Authorization: 'Basic ' + btoa('set:' + g.secret), 'Content-Type': 'application/json' };
    const subscribed = c.email_optin && !c.unsub_email_at && !c.suppressed;
    await ok(await fetch(base, { method: 'PUT', headers: auth, body: JSON.stringify({ email_address: c.email, status_if_new: subscribed ? 'subscribed' : 'transactional', ...(subscribed ? {} : c.unsub_email_at ? { status: 'unsubscribed' } : {}), merge_fields: { FNAME: f, LNAME: l } }) }), 'Mailchimp');
    if (c.tags?.length) await ok(await fetch(base + '/tags', { method: 'POST', headers: auth, body: JSON.stringify({ tags: c.tags.map(name => ({ name, status: 'active' })) }) }), 'Mailchimp tags');
    return 'synced';
  } },
  hubspot: { async sync({ integration: g, contact: c }) {
    const [f, l] = nameParts(c.name);
    await ok(await fetch('https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert', { method: 'POST', headers: { Authorization: 'Bearer ' + g.secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: [{ idProperty: 'email', id: c.email, properties: { email: c.email, firstname: f, lastname: l, phone: c.phone || '' } }] }) }), 'HubSpot');
    return 'synced';
  } },
  activecampaign: { async sync({ integration: g, contact: c }) {
    const [f, l] = nameParts(c.name), H = { 'Api-Token': g.secret, 'Content-Type': 'application/json' };
    const r = JSON.parse(await ok(await fetch(g.config.url.replace(/\/$/, '') + '/api/3/contact/sync', { method: 'POST', headers: H, body: JSON.stringify({ contact: { email: c.email, firstName: f, lastName: l, phone: c.phone || '' } }) }), 'ActiveCampaign'));
    if (g.config.list && r.contact?.id) await ok(await fetch(g.config.url.replace(/\/$/, '') + '/api/3/contactLists', { method: 'POST', headers: H,
      body: JSON.stringify({ contactList: { list: g.config.list, contact: r.contact.id, status: c.email_optin && !c.unsub_email_at ? 1 : 2 } }) }), 'ActiveCampaign list');
    return 'synced';
  } },
  constantcontact: { async sync({ integration: g, contact: c }) {
    const [f, l] = nameParts(c.name);
    await ok(await fetch('https://api.cc.email/v3/contacts/sign_up_form', { method: 'POST', headers: { Authorization: 'Bearer ' + g.secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_address: c.email, first_name: f, last_name: l, list_memberships: [g.config.list] }) }), 'Constant Contact');
    return 'synced';
  } },
};
// Meta Conversions API: the purchase, matched to the browser pixel by event_id = order id (Meta de-duplicates); email / phone are hashed
export const META_CAPI = { async send({ integration: g, payload }) {
  const o = payload.data || {}, user = { em: [await sha256(o.email)], ...(o.phone ? { ph: [await sha256(String(o.phone).replace(/\D/g, ''))] } : {}) };
  const body = { data: [{ event_name: 'Purchase', event_time: Math.floor(new Date(o.paid_at || Date.now()).getTime() / 1000), event_id: o.id, action_source: 'website', user_data: user,
    custom_data: { currency: o.currency || 'USD', value: (o.total || 0) / 100, order_id: o.ref, num_items: (o.tickets || []).length } }], ...(g.config.test ? { test_event_code: g.config.test } : {}) };
  return (await ok(await fetch(`https://graph.facebook.com/v19.0/${g.config.pixel}/events?access_token=${encodeURIComponent(g.secret)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'Meta')).slice(0, 120);
} };
// Webhooks: POST the JSON, signed — SET-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>. The resolved address must be public.
const PRIVATE = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1?$/, /^f[cd]/i, /^fe80/i, /^::ffff:/i];
export async function publicHost(u) {
  const x = new URL(u); if (x.protocol !== 'https:') return false;
  if (/^[\d.]+$/.test(x.hostname) || x.hostname.includes(':')) return !PRIVATE.some(r => r.test(x.hostname));
  const ips = [...await Deno.resolveDns(x.hostname, 'A').catch(() => []), ...await Deno.resolveDns(x.hostname, 'AAAA').catch(() => [])];
  return ips.length > 0 && !ips.some(ip => PRIVATE.some(r => r.test(ip)));
}
export const WEBHOOK = { async send({ integration: g, payload }) {
  if (!(await publicHost(g.config.url))) throw new Err('the webhook address is not a public https host', true);
  const body = JSON.stringify(payload), t = Math.floor(Date.now() / 1000), sig = await hmac('SHA-256', g.secret, `${t}.${body}`);
  const r = await fetch(g.config.url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', 'User-Agent': 'SET-Webhooks/1', 'SET-Signature': `t=${t},v1=${sig}`, 'SET-Event': payload.type, 'SET-Delivery': payload.id || '' }, body });
  if (r.status >= 300 && r.status < 400) throw new Err('the webhook redirected — not followed', true);
  await ok(r, 'Webhook'); return String(r.status);
} };
