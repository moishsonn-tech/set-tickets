// @ts-nocheck — plain JavaScript (Deno runs it as TypeScript).
/* SET messaging Edge Function — delivers the outbox (email + text) and the integration deliveries (webhooks, CRMs, Meta Conversions API).
   Deploy:  supabase functions deploy messaging --no-verify-jwt    (the scheduler and the providers' webhooks carry no Supabase login)
   Secrets: supabase secrets set CRON_SECRET=<long random> APP_URL=https://your-site/ MAIL_FROM="SET Tickets <tickets@your-domain>"
              EMAIL_PROVIDER=resend RESEND_API_KEY=… RESEND_WEBHOOK_SECRET=…
              SMS_PROVIDER=twilio TWILIO_ACCOUNT_SID=… TWILIO_AUTH_TOKEN=… TWILIO_FROM=+1… (or TWILIO_MESSAGING_SERVICE_SID=…)
            SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase. No key ever reaches the browser.

   POST {action:'run'}  + header x-cron-secret   every minute (pg_cron + pg_net, see SETUP.md): marketing_tick(), then send due messages and deliveries
   POST ?unsubscribe=<token>                     one-click unsubscribe (List-Unsubscribe-Post) from a mail client
   POST ?inbound=twilio                          texts people send back: STOP / START
   POST ?events=resend                           delivery events: hard bounces and spam complaints suppress the address
   Nothing is sent while EMAIL_LIVE is not "1" — rows are marked failed "sending is switched off" instead (safe test mode). */
import '../_shared/mailtpl.js';
import { EMAIL, SMS, CRM, META_CAPI, WEBHOOK, Err } from './providers/index.ts';

const env = Deno.env.toObject(), MailTpl = globalThis.MailTpl;
async function rpc(fn, args) {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', body: JSON.stringify(args || {}),
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' } });
  const t = await r.text(), j = t ? JSON.parse(t) : null; if (!r.ok) throw new Error(j?.message || 'database error ' + r.status); return j;
}
const same = (a, b) => { a = String(a || ''); b = String(b || ''); if (!a || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const fnUrl = () => env.SUPABASE_URL + '/functions/v1/messaging';
// Stage 10: a box office with a verified sending domain (Settings → Sending domain) sends from its own address
const fromFor = bo => { const m = /^(.*?)\s*<(.+)>$/.exec(env.MAIL_FROM || ''), name = String(bo?.mail?.fromName || bo?.name || (m ? m[1] : 'SET')).replace(/["<>\r\n]/g, '').slice(0, 60);
  const own = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(bo?.mailDomain || '') ? 'tickets@' + bo.mailDomain : null, addr = own || (m ? m[2] : env.MAIL_FROM);
  return `${name} <${addr}>`; };
const replyTo = bo => /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(bo?.mail?.replyTo || '') ? bo.mail.replyTo : undefined;

async function sendOne({ msg: m, ctx }) {
  const out = MailTpl.render(m, ctx, { appUrl: env.APP_URL });
  if (env.EMAIL_LIVE !== '1') return rpc('outbox_result', { p_id: m.id, p_ok: false, p_provider: 'off', p_provider_id: null, p_error: 'sending is switched off (EMAIL_LIVE is not 1)', p_permanent: true });
  try {
    let id;
    if (m.channel === 'sms') {
      const p = SMS[env.SMS_PROVIDER || 'twilio']; if (!p) throw new Err('no text-message provider configured', true);
      id = (await p.send({ to: m.to, body: out.sms }, env)).id;
    } else {
      const p = EMAIL[env.EMAIL_PROVIDER || 'resend']; if (!p) throw new Err('no email provider configured', true);
      const headers = m.category === 'marketing' && ctx.contact?.token ? { 'List-Unsubscribe': `<${fnUrl()}?unsubscribe=${ctx.contact.token}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined;
      id = (await p.send({ to: m.to, from: fromFor(ctx.bo), replyTo: replyTo(ctx.bo), subject: out.subject, html: out.html, text: out.text, headers, idem: 'set-msg-' + m.id }, env)).id;
    }
    await rpc('outbox_result', { p_id: m.id, p_ok: true, p_provider: m.channel === 'sms' ? env.SMS_PROVIDER || 'twilio' : env.EMAIL_PROVIDER || 'resend', p_provider_id: id, p_error: null, p_permanent: false });
  } catch (e) {
    await rpc('outbox_result', { p_id: m.id, p_ok: false, p_provider: m.channel, p_provider_id: null, p_error: String(e.message || e), p_permanent: !!e.permanent });
  }
}
async function deliverOne({ delivery: d, integration: g, contact }) {
  try {
    let res;
    if (g.kind === 'webhook') res = await WEBHOOK.send({ integration: g, payload: d.payload });
    else if (g.kind === 'meta_capi') res = await META_CAPI.send({ integration: g, payload: d.payload });
    else if (CRM[g.kind]) {
      if (!contact) res = 'no contact to sync';
      else if (g.config.who !== 'all' && !(contact.email_optin && !contact.unsub_email_at && !contact.suppressed)) res = 'skipped — not opted in';
      else res = await CRM[g.kind].sync({ integration: g, contact, payload: d.payload }, env);
    } else throw new Err('unknown integration', true);
    await rpc('delivery_result', { p_id: d.id, p_ok: true, p_response: String(res), p_permanent: false });
  } catch (e) { await rpc('delivery_result', { p_id: d.id, p_ok: false, p_response: String(e.message || e), p_permanent: !!e.permanent }); }
}
async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await fn(q.shift()); })); }

Deno.serve(async req => {
  const url = new URL(req.url);
  try {
    if (url.searchParams.has('unsubscribe')) {   // one click from the mail client's own "Unsubscribe" button
      await rpc('unsubscribe', { p_token: url.searchParams.get('unsubscribe'), p: { email: false } }).catch(() => null);
      return new Response('You are unsubscribed.', { headers: { 'Content-Type': 'text/plain' } });
    }
    if (url.searchParams.get('inbound')) {
      const p = SMS[url.searchParams.get('inbound')], raw = await req.text(); if (!p) return new Response('unknown', { status: 404 });
      const m = await p.inbound(req, raw, fnUrl() + url.search, env); if (!m) return new Response('bad signature', { status: 403 });
      await rpc('inbound_sms', { p_from: m.from, p_body: m.body });
      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
    }
    if (url.searchParams.get('events')) {
      const p = EMAIL[url.searchParams.get('events')], raw = await req.text(); if (!p?.events) return new Response('unknown', { status: 404 });
      const list = await p.events(req, raw, env); if (!list) return new Response('bad signature', { status: 403 });
      for (const e of list) if (e.id && e.type !== 'delivered') await rpc('mail_event', { p_provider_id: e.id, p_type: e.type });
      return new Response('ok');
    }
    const body = await req.json().catch(() => ({}));
    if (body.action === 'run') {
      if (!env.CRON_SECRET || !same(req.headers.get('x-cron-secret'), env.CRON_SECRET)) return new Response('forbidden', { status: 403 });
      const queued = await rpc('marketing_tick');
      const msgs = await rpc('claim_outbox', { p_limit: 100 }); await pool(msgs, 6, sendOne);
      const dels = await rpc('claim_deliveries', { p_limit: 100 }); await pool(dels, 6, deliverOne);
      return Response.json({ queued, sent: msgs.length, delivered: dels.length });
    }
    return new Response('unknown action', { status: 400 });
  } catch (e) { console.error(e); return new Response('error', { status: 500 }); }
});
