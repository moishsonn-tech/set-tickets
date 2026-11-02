// @ts-nocheck — plain JavaScript (Deno runs it as TypeScript).
/* Stripe adapter: Stripe Connect "direct charges". The box office's own (Express) Stripe account takes the payment — cards, Apple Pay,
   Google Pay and Link through the Payment Element — and the platform's fee is taken as an application fee.
   Secrets (Supabase → Edge Functions → Secrets): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PUBLISHABLE_KEY. */
const API = 'https://api.stripe.com/v1/';
const form = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => {
  const key = pre ? `${pre}[${k}]` : k;
  return v && typeof v === 'object' ? form(v, key) : v === undefined || v === null ? [] : [`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`];
}).join('&');
async function call(env, method, path, body, o = {}) {
  const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded',
    ...(o.account ? { 'Stripe-Account': o.account } : {}), ...(o.idem ? { 'Idempotency-Key': o.idem } : {}) }, body: body ? form(body) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || 'Stripe error ' + r.status); return j;
}
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
function safeEq(a, b) { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }

export default {
  name: 'Stripe',
  async createPayment({ order, account, platformFee, env }) {
    // one PaymentIntent per order: retries / reloads reuse it (Idempotency-Key), so a buyer can never be charged twice for one order
    const pi = await call(env, 'POST', 'payment_intents', {
      amount: order.data.total, currency: String(order.data.currency || 'usd').toLowerCase(),
      automatic_payment_methods: { enabled: true }, application_fee_amount: platformFee || undefined,
      receipt_email: order.buyer_email, description: 'Order ' + order.ref, metadata: { order_id: order.id, ref: order.ref, box_office_id: order.box_office_id },
    }, { account: account.account, idem: 'set-order-' + order.id });
    return { clientSecret: pi.client_secret, publishableKey: env.STRIPE_PUBLISHABLE_KEY, account: account.account, ref: pi.id };
  },
  async parseWebhook(req, raw, env) {
    const sig = req.headers.get('stripe-signature') || '', parts = Object.fromEntries(sig.split(',').map(x => x.split('=')));
    if (!parts.t || !parts.v1 || Math.abs(Date.now() / 1000 - +parts.t) > 300) throw new Error('bad signature');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(parts.t + '.' + raw)));
    if (!sig.split(',').some(x => x.startsWith('v1=') && safeEq(x.slice(3), mac))) throw new Error('bad signature');
    const ev = JSON.parse(raw), o = ev.data?.object || {};
    if (ev.type === 'account.updated') return { type: 'account', account: o.id, ready: !!o.charges_enabled, test: !ev.livemode };
    if (!o.metadata?.order_id) return null;
    if (ev.type === 'payment_intent.succeeded') {
      // the processor's own fee, from the charge's balance transaction (on the connected account)
      let fee = null, method = o.payment_method_types?.[0] || 'card', brand = '', last4 = '';
      try {
        const ch = await call(env, 'GET', `charges/${o.latest_charge}?expand[]=balance_transaction`, null, { account: ev.account });
        fee = ch.balance_transaction?.fee ?? null; const pm = ch.payment_method_details || {}; method = pm.card?.wallet?.type || pm.type || method;
        brand = pm.card?.wallet?.type === 'apple_pay' ? 'Apple Pay' : pm.card?.wallet?.type === 'google_pay' ? 'Google Pay' : (pm.card?.brand || '').replace(/^./, c => c.toUpperCase()); last4 = pm.card?.last4 || '';
      } catch (e) { /* fee stays the estimate */ }
      return { type: 'succeeded', orderId: o.metadata.order_id, ref: o.id, amount: o.amount_received, fee, method, brand, last4, account: ev.account };
    }
    if (ev.type === 'payment_intent.payment_failed') return { type: 'failed', orderId: o.metadata.order_id, ref: o.id, error: o.last_payment_error?.message || 'Payment failed' };
    return null;
  },
  async refund({ ref, account, env }) {
    return call(env, 'POST', 'refunds', { payment_intent: ref, refund_application_fee: true, reverse_transfer: undefined }, { account, idem: 'set-refund-' + ref });
  },
  async connect({ boxOffice, account, returnUrl, env }) {
    const acct = account?.account || (await call(env, 'POST', 'accounts', { type: 'express', metadata: { box_office_id: boxOffice.id }, business_profile: { name: boxOffice.name } })).id;
    const link = await call(env, 'POST', 'account_links', { account: acct, refresh_url: returnUrl, return_url: returnUrl, type: 'account_onboarding' });
    return { url: link.url, account: acct };
  },
};
