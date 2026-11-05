// @ts-nocheck — plain JavaScript (Deno runs it as TypeScript).
/* SET payments Edge Function. Deploy:  supabase functions deploy payments --no-verify-jwt   (webhooks carry no Supabase login)
   Secrets:  supabase secrets set STRIPE_SECRET_KEY=… STRIPE_WEBHOOK_SECRET=… STRIPE_PUBLISHABLE_KEY=… APP_ORIGINS=https://your-site
   SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase. Nothing secret ever reaches the browser.

   POST {action:'intent', order, key}          buyer: start paying for an order (the order id + its secret key prove it's theirs)
   POST {action:'connect', bo, provider, return}  staff with admin.payments: connect the box office's own processor account
   POST {action:'order', order, op, p}            staff: an order change that refunds the card (Stage 6). Runs order_action() AS the caller, so
                                                  their permissions apply, then refunds each 'processing' refund at the processor (retries any stuck one)
   POST {action:'installment', order, key}       buyer: pay the next installment of a payment plan → {clientSecret …}; the webhook records it
   POST ?webhook=stripe                           the processor: payment succeeded / failed, account ready  → confirm_payment() issues tickets;
                                                  disputes → record_dispute(); payouts → record_payout(); every charge / refund → record_processor_tx() */
import { PROVIDERS } from './providers/index.ts';

const env = Deno.env.toObject();
const ORIGINS = String(env.APP_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
const cors = req => { const o = req.headers.get('origin') || ''; return ORIGINS.includes(o) ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Vary': 'Origin' } : {}; };
const json = (req, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } });
// PostgREST with the service role (server-side only)
async function db(path, o = {}) {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, { method: o.method || 'GET', body: o.body ? JSON.stringify(o.body) : undefined,
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json', Prefer: o.prefer || 'return=representation' } });
  const t = await r.text(), j = t ? JSON.parse(t) : null; if (!r.ok) throw new Error(j?.message || 'database error ' + r.status); return j;
}
const rpc = (fn, args) => db('rpc/' + fn, { method: 'POST', body: args });
const one = async path => (await db(path))?.[0] || null;
// who is calling (staff actions): the Supabase session token → email
async function caller(req) {
  const r = await fetch(env.SUPABASE_URL + '/auth/v1/user', { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: req.headers.get('authorization') || '' } });
  return r.ok ? String((await r.json()).email || '').toLowerCase() : '';
}
async function canManagePayments(email, boId) {
  if (!email) return false;
  const bo = await one(`box_offices?id=eq.${boId}&select=owner`); if (bo?.owner === email) return true;
  if (await one(`platform_admins?email=eq.${encodeURIComponent(email)}&select=email`)) return true;
  const m = await one(`members?box_office_id=eq.${boId}&email=eq.${encodeURIComponent(email)}&status=eq.active&select=perms`);
  return !!m?.perms?.includes('admin.payments');
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const url = new URL(req.url), hook = url.searchParams.get('webhook');
  try {
    if (hook) {   // ── processor → us ──
      const p = PROVIDERS[hook]; if (!p) return new Response('unknown processor', { status: 404 });
      const raw = await req.text(), ev = await p.parseWebhook(req, raw, env);
      if (!ev) return new Response('ignored');
      if (ev.type === 'account') {
        const acc = await one(`payment_accounts?account=eq.${encodeURIComponent(ev.account)}&select=box_office_id`); if (!acc) return new Response('unknown account');
        await db(`payment_accounts?box_office_id=eq.${acc.box_office_id}`, { method: 'PATCH', body: { status: ev.ready ? 'connected' : 'pending', test: ev.test, updated_at: new Date().toISOString() } });
        await db(`box_offices?id=eq.${acc.box_office_id}`, { method: 'PATCH', body: { gateway: { provider: hook, status: ev.ready ? 'connected' : 'pending', test: ev.test } } });
        return new Response('ok');
      }
      if (ev.type === 'dispute') { await rpc('record_dispute', { p: { ...ev, provider: hook } }); return new Response('ok'); }
      if (ev.type === 'payout') { await rpc('record_payout', { p: { ...ev, provider: hook } }); return new Response('ok'); }
      if (ev.type === 'failed') { await rpc('record_payment_attempt', { p_order: ev.orderId, p: { ok: false, provider: hook, ref: ev.ref, error: ev.error } }); return new Response('ok'); }
      // succeeded: the database issues the tickets (once). Paid too late for seats that are gone, or the wrong amount → refund now.
      // §5 a later installment of a payment plan is its own payment: pay_installment() records it (the last one issues the tickets)
      const res = ev.installment != null
        ? await rpc('pay_installment', { p_order: ev.orderId, p: { provider: hook, ref: ev.ref, amount: ev.amount, method: ev.method, brand: ev.brand, last4: ev.last4 }, p_by: null })
        : await rpc('confirm_payment', { p_order: ev.orderId, p: { provider: hook, ref: ev.ref, amount: ev.amount, method: ev.method, brand: ev.brand, last4: ev.last4, ...(ev.fee != null ? { fee: ev.fee } : {}) } });
      // the processor's own record of the charge (Stage 9 reconciliation), whatever happened to the order
      await rpc('record_processor_tx', { p: { id: ev.charge || ev.ref, payment: ev.ref, type: 'charge', amount: ev.amount, fee: ev.fee ?? 0, app_fee: ev.appFee || 0, provider: hook, account: ev.account } });
      if (res === 'refund' || res === 'mismatch') {
        const x = await p.refund({ ref: ev.ref, account: ev.account, env });
        await rpc('record_processor_tx', { p: { id: x.id, payment: ev.ref, type: 'refund', amount: -ev.amount, provider: hook, account: ev.account } });
      }
      return new Response('ok');
    }
    const body = await req.json().catch(() => ({}));
    if (body.action === 'intent') {   // ── buyer: pay for this order ──
      const order = await one(`orders?id=eq.${encodeURIComponent(body.order)}&access_key=eq.${encodeURIComponent(body.key)}&select=*`);
      if (!order) return json(req, { error: 'Order not found' }, 404);
      if (order.status === 'paid') return json(req, { paid: true });
      if (order.status !== 'awaiting_payment' || new Date(order.expires_at) <= new Date()) return json(req, { error: 'This checkout has expired and its seats were released. Please start again.' }, 409);
      const account = await one(`payment_accounts?box_office_id=eq.${order.box_office_id}&status=eq.connected&select=*`);
      const p = account && PROVIDERS[account.provider]; if (!p) return json(req, { error: 'Card payments are not set up for this box office yet' }, 409);
      const due = order.data.plan ? +order.data.plan.schedule[0].amount : order.data.total;   // §5 a payment plan's first charge is its deposit (it carries the platform fee)
      const r = await p.createPayment({ order, account, platformFee: Math.max(0, +order.data.platformFee || 0), env, amount: due });
      return json(req, { provider: account.provider, test: account.test, expires_at: order.expires_at, total: due, currency: order.data.currency, ...r });
    }
    if (body.action === 'installment') {   // ── buyer: pay the next installment of a payment plan (§5) ──
      const order = await one(`orders?id=eq.${encodeURIComponent(body.order)}&access_key=eq.${encodeURIComponent(body.key)}&select=*`);
      if (!order) return json(req, { error: 'Order not found' }, 404);
      const x = order.status === 'pending' && (order.data.plan?.schedule || []).find(s => !s.paid_at);
      if (!x) return json(req, { error: 'Nothing is due on this order' }, 409);
      const account = await one(`payment_accounts?box_office_id=eq.${order.box_office_id}&status=eq.connected&select=*`);
      const p = account && PROVIDERS[account.provider]; if (!p) return json(req, { error: 'Card payments are not set up for this box office yet' }, 409);
      const r = await p.createPayment({ order, account, platformFee: 0, env, amount: +x.amount, installment: x.n });
      return json(req, { provider: account.provider, test: account.test, total: +x.amount, currency: order.data.currency, installment: x.n, ...r });
    }
    if (body.action === 'connect') {  // ── staff: connect this box office's own processor account ──
      if (!(await canManagePayments(await caller(req), body.bo))) return json(req, { error: 'You don\'t have permission to change payment settings' }, 403);
      const p = PROVIDERS[body.provider]; if (!p) return json(req, { error: 'That processor isn\'t wired in yet' }, 400);
      const bo = await one(`box_offices?id=eq.${body.bo}&select=id,name`), account = await one(`payment_accounts?box_office_id=eq.${body.bo}&select=*`);
      const back = ORIGINS.some(o => String(body.return || '').startsWith(o)) ? body.return : ORIGINS[0];
      const r = await p.connect({ boxOffice: bo, account: account?.provider === body.provider ? account : null, returnUrl: back, env });
      await db('payment_accounts', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { box_office_id: bo.id, provider: body.provider, account: r.account, status: 'pending', test: String(env.STRIPE_SECRET_KEY || '').startsWith('sk_test'), updated_at: new Date().toISOString() } });
      return json(req, { url: r.url });
    }
    if (body.action === 'order') {  // ── staff: change an order, then refund the card at the box office's processor ──
      const r = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/order_action', { method: 'POST', body: JSON.stringify({ p_order: body.order, p_action: body.op, p: body.p || {} }),
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: req.headers.get('authorization') || '', 'Content-Type': 'application/json' } });
      const res = await r.json().catch(() => ({})); if (!r.ok) return json(req, { error: res?.message || 'Could not change the order' }, 400);
      const order = await one(`orders?id=eq.${encodeURIComponent(body.order)}&select=*`), account = order && await one(`payment_accounts?box_office_id=eq.${order.box_office_id}&select=*`);
      for (const rf of (order?.data?.refunds || []).filter(x => x.status === 'processing')) {
        const p = PROVIDERS[rf.provider]; let out;
        try {
          if (!p || !account || account.provider !== rf.provider) throw new Error('The processor that took this payment is not connected');
          // a payment-plan refund is split over the installments paid by card (rf.parts); each part has its own idempotency key, so a retry
          // after a part failed only sends what is still owed
          const parts = rf.parts || [{ payment: rf.payment, amount: rf.amount }], ids = [];
          for (const [i, pt] of parts.entries()) {
            try {
              const x = await p.refund({ ref: pt.payment, amount: pt.amount, account: account.account, idem: 'set-refund-' + rf.id + (i ? '-' + i : ''), env });   // one refund id → never refunded twice
              ids.push(x.id);
              await rpc('record_processor_tx', { p: { id: x.id, payment: pt.payment, type: 'refund', amount: -pt.amount, provider: rf.provider, account: account.account } });
            } catch (e) { if (ids.length) { out = { ok: false, partial: true, error: String(e.message || e) }; break; } throw e; }
          }
          out ||= { ok: true, ref: ids.join(',') };
        } catch (e) { out = { ok: false, error: String(e.message || e) }; }
        await rpc('finish_refund', { p_order: order.id, p_refund: rf.id, p: out });
        if (res.refund?.id === rf.id) res.refund = { ...res.refund, status: out.ok ? 'done' : 'failed', error: out.error || null };
      }
      return json(req, res);
    }
    return json(req, { error: 'Unknown action' }, 400);
  } catch (e) {
    console.error(e);
    return hook ? new Response('error', { status: 400 }) : json(req, { error: 'Payment service error' }, 500);
  }
});
