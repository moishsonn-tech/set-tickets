'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   SET data layer. One interface (DB.*), two backends:
   - LIVE: Supabase (config.js filled in) — pricing/inventory enforced by place_order() in SQL.
   - DEMO: this browser's localStorage, seeded with sample events — the same rules run here in JS.
   Event shape everywhere: {id, slug, status, ...publicData, secrets?:{password, ticketPasswords}}  (promo codes live box-office wide: promos)
   Money is integer cents.
   ════════════════════════════════════════════════════════════════════════════ */
const CFG = window.SET_CONFIG || {};
const LIVE = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase);
const sb = LIVE ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randCode = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => CODE_CHARS[b % 32]).join('');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + randCode(16).toLowerCase());
const shortId = p => p + randCode(6).toLowerCase();
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;


/* ── Permissions: every team member holds an explicit list of permission keys ("group.key"), optionally
   limited to some events. Templates are just named starting lists — editing a member's checkboxes never
   changes the template. 'v' marks a view-only key (what the "View only" group setting grants).
   The box office owner and platform super admins always hold every permission. ── */
const PERMS = [
  ['events', 'Events', [['view', 'View events', 'v'], ['edit', 'Edit events'], ['create', 'Create events'], ['publish', 'Publish / unpublish'], ['settings', 'Edit event settings']]],
  ['seating', 'Seating', [['view', 'View seating chart', 'v'], ['edit', 'Edit seating chart'], ['block', 'Block seats'], ['unblock', 'Unblock seats'], ['move', 'Move customers between seats'], ['assign', 'Change seat assignments']]],
  ['tickets', 'Tickets & pricing', [['view', 'View ticket types', 'v'], ['create', 'Create ticket types'], ['edit', 'Edit ticket types'], ['pricing', 'Change pricing'], ['comps', 'Create complimentary tickets'], ['discounts', 'Create discount codes'], ['discountsEdit', 'Edit discount codes'], ['tracking', 'Manage tracking codes']]],
  ['orders', 'Orders', [['view', 'View orders', 'v'], ['edit', 'Edit orders'], ['cancel', 'Cancel orders'], ['cancelTicket', 'Cancel individual tickets'], ['resend', 'Resend tickets'], ['customer', 'Change customer information'], ['seats', 'Change seats'], ['refund', 'Issue refunds'], ['override', 'Override normal order restrictions']]],
  ['customers', 'Customer data', [['names', 'View customer names', 'v'], ['emails', 'View email addresses', 'v'], ['phones', 'View phone numbers', 'v'], ['profiles', 'View full customer profiles', 'v'], ['export', 'Export customer information']]],
  ['finance', 'Sales & finance', [['totals', 'View ticket sales totals', 'v'], ['reports', 'View financial reports', 'v'], ['fees', 'View fees', 'v'], ['processing', 'View payment processing information', 'v'], ['payouts', 'View payouts', 'v'], ['export', 'Export financial reports']]],
  ['door', 'Event-day access', [['scan', 'Scan tickets'], ['checkin', 'Check customers in'], ['undo', 'Undo check-in'], ['override', 'Override scanner warnings'], ['attendees', 'View attendee lists', 'v'], ['devices', 'Manage scanner devices'], ['staff', 'Manage door staff']]],
  ['comms', 'Communication', [['email', 'Send customer emails'], ['notify', 'Send event notifications'], ['lists', 'Access attendee mailing lists', 'v']]],
  ['admin', 'Administration', [['invite', 'Invite team members'], ['remove', 'Remove team members'], ['perms', 'Edit team permissions'], ['integrations', 'Access integrations'], ['api', 'Access API settings'], ['payments', 'Access payment settings'], ['settings', 'Access box office settings']]],
];
const ALL_PERMS = PERMS.flatMap(([g, , ks]) => ks.map(k => g + '.' + k[0]));
const groupPerms = (g, viewOnly) => PERMS.find(x => x[0] === g)[2].filter(k => !viewOnly || k[2] === 'v').map(k => g + '.' + k[0]);
const DEFAULT_TEMPLATES = [
  { id: 'full', name: 'Full administrator', perms: ALL_PERMS },
  { id: 'event_manager', name: 'Event manager', perms: [...groupPerms('events'), ...groupPerms('seating'), ...groupPerms('tickets'), ...groupPerms('door'), 'orders.view', 'customers.names', 'finance.totals', 'comms.notify'] },
  { id: 'customer_service', name: 'Customer service', perms: ['events.view', 'seating.view', 'seating.move', 'seating.assign', 'tickets.view', 'orders.view', 'orders.edit', 'orders.cancel', 'orders.cancelTicket', 'orders.resend', 'orders.customer', 'orders.seats', 'orders.refund', ...groupPerms('customers', true), 'door.attendees', 'comms.email'] },
  { id: 'door_staff', name: 'Door staff', perms: ['events.view', 'seating.view', 'customers.names', 'door.scan', 'door.checkin', 'door.undo', 'door.override', 'door.attendees'] },
  { id: 'scanner', name: 'Scanner staff', perms: ['events.view', 'door.scan', 'door.checkin'] },
  { id: 'finance', name: 'Finance', perms: ['events.view', 'tickets.view', 'orders.view', 'customers.names', ...groupPerms('finance')] },
  { id: 'marketing', name: 'Marketing', perms: ['events.view', 'tickets.view', 'tickets.discounts', 'tickets.discountsEdit', 'tickets.tracking', 'customers.names', 'customers.emails', 'customers.export', 'finance.totals', ...groupPerms('comms')] },
];
// member = {email, perms:[], events:'all'|[eventId], owner?, support?}; eventId optional (checks event scope too)
const hasPerm = (m, key, eventId) => !!m && (m.owner || m.support || (m.perms || []).includes(key)) && (!eventId || m.owner || m.support || m.events === 'all' || (m.events || []).includes(eventId));
const BO_STATUS = { pending: 'Awaiting approval', active: 'Active', suspended: 'Suspended', deactivated: 'Deactivated' };
const DEFAULT_PLATFORM = { name: 'SET', publicRegistration: false, feePct: 1, feeFixed: 25, feePayer: 'organizer', plans: 'Per-ticket platform fee only — no subscription.', admins: ['moishsonn@gmail.com'] };
const DEFAULT_BRANDING = { logo: '', banner: '', ink: '#020a16', accent: '#f4cd5e', font: 'Anton', tagline: '', phone: '', website: '', instagram: '', facebook: '', tiktok: '', x: '',
  refundPolicy: '', privacyPolicy: '', domain: '' };
const FONTS = ['Anton', 'Bebas Neue', 'Oswald', 'Playfair Display', 'DM Serif Display', 'Montserrat'];

/* ── Authenticator-app codes (TOTP, RFC 6238) — used by DEMO mode 2FA; LIVE uses Supabase MFA. ── */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32enc = bytes => { let bits = '', out = ''; for (const b of bytes) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]; return out; };
const b32dec = s => { let bits = ''; for (const c of String(s).toUpperCase()) { const v = B32.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, '0'); } return new Uint8Array((bits.match(/.{8}/g) || []).map(b => parseInt(b, 2))); };
async function totp(secret, step = Math.floor(Date.now() / 30000)) {
  const key = await crypto.subtle.importKey('raw', b32dec(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new ArrayBuffer(8); new DataView(msg).setUint32(4, step);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg)), o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}
async function totpOk(secret, code) { const s = Math.floor(Date.now() / 30000); for (const d of [-1, 0, 1]) if (await totp(secret, s + d) === String(code).replace(/\s/g, '')) return true; return false; }
const DEFAULT_SETTINGS = {
  name: 'SET Tickets', currency: 'USD', feePct: 0, feeFixed: 0, feeMode: 'buyer', taxPct: 0,
  terms: 'All sales are final. Tickets are non-refundable except if the event is cancelled. Event schedule and line-up subject to change.',
  payments: { card: true, offline: true, door: true }, donations: true, pixels: { ga4: '', meta: '', tiktok: '' },
  contactEmail: '', reminderHours: 24, require2fa: false,
  // Stage 5: who pays card processing, tax on fees, what checkout asks for, and questions asked on every order
  passProcessing: false, taxOnFees: false, questions: [],
  checkout: { phone: 'optional', address: 'off', promo: true, optIn: true, note: '', thanks: '' },
};

/* ── Payments (Stage 5): one gateway interface, many processors ──
   A box office connects its OWN processor account (bo.gateway = {provider, account, status, test}); money goes straight to it and the
   platform fee rides along as an application fee. Every processor plugs into the same three steps — create a payment for an order,
   confirm it from the processor's webhook, refund — so adding one never touches checkout, orders or tickets. `adapter: true` = the
   server-side adapter is written (supabase/functions/payments/providers/); the others are listed so a box office can ask for them. */
const GATEWAYS = {
  stripe: { name: 'Stripe', methods: ['Card', 'Apple Pay', 'Google Pay', 'Link'], pct: 2.9, fixed: 30, adapter: true, how: 'Stripe Connect — you sign in to (or create) your own Stripe account; payouts go straight to it' },
  square: { name: 'Square', methods: ['Card', 'Apple Pay', 'Google Pay'], pct: 2.9, fixed: 30, how: 'Square OAuth' },
  paypal: { name: 'PayPal / Braintree', methods: ['Card', 'PayPal', 'Venmo', 'Apple Pay', 'Google Pay'], pct: 3.49, fixed: 49, how: 'PayPal partner onboarding' },
  authorizenet: { name: 'Authorize.net', methods: ['Card'], pct: 2.9, fixed: 30, how: 'API login ID + transaction key, stored server-side' },
  custom: { name: 'Another processor', methods: ['Card'], pct: 0, fixed: 0, how: 'Any processor with a payments API — a new adapter file, nothing else changes' },
  demo: { name: 'Demo test processor', methods: ['Card', 'Apple Pay', 'Google Pay'], pct: 2.9, fixed: 30, adapter: true, test: true, how: 'Built in for the demo — no real money moves' },
};
const PAY_MINUTES = 15;  // a card checkout keeps its seats / tickets this long while the buyer pays
// demo test cards (the same numbers Stripe publishes for test mode)
const TEST_CARDS = { '4242424242424242': '', '5555555555554444': '', '4000000000000002': 'Your card was declined.', '4000000000009995': 'Your card has insufficient funds.',
  '4000000000000069': 'Your card has expired.', '4000000000000127': 'Your card\'s security code is incorrect.', '4000000000000119': 'An error occurred while processing your card. Try again in a little bit.' };
const luhn = n => { let s = 0; for (let i = 0; i < n.length; i++) { let d = +n[n.length - 1 - i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } s += d; } return n.length >= 12 && s % 10 === 0; };
const cardBrand = n => /^4/.test(n) ? 'Visa' : /^(5[1-5]|2[2-7])/.test(n) ? 'Mastercard' : /^3[47]/.test(n) ? 'Amex' : /^6/.test(n) ? 'Discover' : 'Card';
const optNum = (v, d) => v === undefined || v === null || v === '' ? d : +v || 0;
// the platform's own fee for one box office (super admin may override per box office) and who pays it
const platformFeeFor = (plat, bo) => ({ pct: optNum(bo?.platformFee?.pct, +plat?.feePct || 0), fixed: optNum(bo?.platformFee?.fixed, +plat?.feeFixed || 0),
  payer: bo?.platformFee?.payer || plat?.feePayer || 'organizer' });
// everything quote() needs to price a cart for one box office: its settings + the platform fee + its processor's card rate
function pricingSettings(bo, plat) {
  const g = bo?.gateway, gw = GATEWAYS[g?.provider];
  return { ...DEFAULT_SETTINGS, ...(bo?.settings || {}), platform: platformFeeFor(plat, bo),
    card: { pct: gw ? optNum(g.pct, gw.pct) : 0, fixed: gw ? optNum(g.fixed, gw.fixed) : 0, pass: !!bo?.settings?.passProcessing } };
}
const cardReady = bo => !!bo?.gateway && bo.gateway.status === 'connected' && !!GATEWAYS[bo.gateway.provider];

/* ── Pricing (Stage 4): the one pricing engine — display everywhere, authoritative in DEMO; SQL price_cart() mirrors it line for line.
   A ticket's price = its showtime price (slotPrices) or base price, replaced by the active price phase (early bird, a scheduled change,
   or "the first N sold"), then by a quantity break when that is lower. Staff may override the price on a manual order (tickets.pricing).
   Lines: ticket {face = normal price, unit = charged before the promo code} · bundle {one combined price, tts = a ticket type per ticket}
   · addon. A promo code adds per-unit discounts (discs / feeDiscs) so every ticket can carry its own discount. ── */
const cents = v => Math.max(0, Math.round(+v || 0));
const inWindow = (from, until, now) => (!from || new Date(from) <= now) && (!until || new Date(until) > now);
// split a whole number of cents over weights, exactly (no cent lost to rounding)
function spread(total, weights) {
  const w = weights.map(x => Math.max(0, +x || 0)), W = w.reduce((a, b) => a + b, 0) || 0, n = w.length;
  if (!n) return [];
  const out = w.map(x => W ? Math.floor(total * x / W) : Math.floor(total / n)); let left = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % n) if (W === 0 || w[i] > 0) { out[i]++; left--; }
  return out;
}
const listPrice = (tt, slotId) => tt ? cents(slotId && tt.slotPrices?.[slotId] !== undefined && tt.slotPrices[slotId] !== '' && tt.slotPrices[slotId] !== null ? tt.slotPrices[slotId] : tt.price) : 0;
// the price phase selling right now (sold = tickets of this type already sold)
const activePhase = (tt, sold, now) => (tt.phases || []).find(p => inWindow(p.from, p.until, now) && !(+p.upTo > 0 && sold >= +p.upTo)) || null;
// price of each of n units, given how many are already sold and how many of this type the order holds (for quantity breaks)
function ttPrices(tt, slotId, sold, n, inOrder, now) {
  const br = (tt.breaks || []).filter(b => +b.min > 1 && inOrder >= +b.min).sort((a, b) => +b.min - +a.min)[0], adm = +tt.admits || 1;
  return Array.from({ length: n }, (_, k) => {
    const ph = activePhase(tt, sold + k * adm, now); let price = ph ? cents(ph.price) : listPrice(tt, slotId), label = ph ? ph.label || 'Special price' : '';
    if (br && cents(br.price) < price) { price = cents(br.price); label = `${br.min}+ price`; }
    return { price, label };
  });
}
// one bundle = parts [{ticketTypeIds, qty}] + addons [{addonId, qty}]; positions = the allowed ticket types for each ticket in ONE bundle
const bundlePositions = b => (b?.parts || []).flatMap(p => Array.from({ length: Math.max(0, +p.qty || 0) }, () => p.ticketTypeIds || []));
// the ticket type of every ticket in a bundle line: seated → each seat's price level; general admission → the buyer's pick (default the first allowed)
function bundleTicketTypes(ev, b, it) {
  const pos = bundlePositions(b), n = pos.length, seated = ev.seating?.enabled;
  return Array.from({ length: (+it.qty || 0) * n }, (_, i) => seated ? ev.seating.index?.[(it.seats || [])[i]] || '' : (it.picks || [])[i % n] || pos[i % n][0] || '');
}
// promo targeting: [] = any. scope = which kinds of thing it discounts.
const anyOf = (list, v) => !(list || []).length || list.map(String).includes(String(v));
function quote(cart, events, settings, promo, o = {}) {
  const now = o.now || new Date(), byEv = id => events.find(e => e.id === id), lines = [], seen = {};
  const feeOf = (unit, tickets) => unit > 0 && settings.feeMode === 'buyer' ? Math.round(unit * (+settings.feePct || 0) / 100) + tickets * (+settings.feeFixed || 0) : 0;
  for (const it of cart.items || []) {
    const ev = byEv(it.eventId); if (!ev || !(+it.qty >= 1)) continue;
    const slot = it.slotId ? (ev.timeSlots || []).find(s => s.id === it.slotId) : null;
    const base = { eventId: ev.id, eventName: ev.name, slotId: it.slotId || null, slotStart: slot?.start || null, currency: ev.currency || settings.currency };
    if (it.bundleId) {
      const b = (ev.bundles || []).find(x => x.id === it.bundleId); if (!b) continue;
      const tts = bundleTicketTypes(ev, b, it), tfaces = tts.map(id => listPrice(ev.ticketTypes.find(t => t.id === id), it.slotId));
      const adds = (b.addons || []).map(a => { const ad = (ev.addons || []).find(x => x.id === a.addonId); return ad ? { addonId: ad.id, name: ad.name, qty: Math.max(1, +a.qty || 1), face: cents(ad.price) } : null; }).filter(Boolean);
      const unit = cents(b.price), per = bundlePositions(b).length, uf = feeOf(unit, Math.max(1, per));
      lines.push({ kind: 'bundle', ...base, bundleId: b.id, name: b.name, qty: +it.qty, unit, face: unit, perCopy: per, tts, tfaces, addons: adds,
        value: tfaces.reduce((a, x) => a + x, 0) + +it.qty * adds.reduce((a, x) => a + x.face * x.qty, 0), seats: it.seats || [], admits: 1, unitFee: uf, fee: +it.qty * uf });
      continue;
    }
    const tt = (ev.ticketTypes || []).find(t => t.id === it.ticketTypeId); if (!tt) continue;
    const k = ev.id + '|' + tt.id, adm = +tt.admits || 1, sold = (o.avail?.[ev.id]?.tt?.[tt.id] || 0) + (seen[k] || 0);
    const inOrder = (cart.items || []).filter(x => x.eventId === ev.id && x.ticketTypeId === tt.id && !x.bundleId).reduce((a, x) => a + (+x.qty || 0), 0);
    const prices = ttPrices(tt, it.slotId, sold, +it.qty, inOrder, now); seen[k] = (seen[k] || 0) + +it.qty * adm;
    const ovr = !!o.manual && it.price !== undefined && it.price !== null && it.price !== '';
    for (let i = 0; i < prices.length;) {  // a phase can end inside one order: one line per run of equal prices
      let j = i; while (j < prices.length && prices[j].price === prices[i].price && prices[j].label === prices[i].label) j++;
      const face = prices[i].price, unit = ovr ? cents(it.price) : face, uf = feeOf(unit, 1);
      lines.push({ kind: 'ticket', ...base, ticketTypeId: tt.id, name: tt.name, seats: (it.seats || []).slice(i * adm, j * adm), qty: j - i, unit, face,
        ...(prices[i].label ? { phase: prices[i].label } : {}), ...(ovr ? { override: true } : {}), admits: adm, unitFee: uf, fee: (j - i) * uf });
      i = j;
    }
  }
  for (const a of cart.addons || []) {
    const ev = byEv(a.eventId), ad = (ev?.addons || []).find(x => x.id === a.addonId);
    if (!ad || !(+a.qty >= 1)) continue;
    lines.push({ kind: 'addon', eventId: ev.id, eventName: ev.name, addonId: ad.id, name: ad.name, qty: +a.qty, unit: cents(ad.price), face: cents(ad.price), unitFee: 0, fee: 0 });
  }
  const subtotal = lines.reduce((a, l) => a + l.unit * l.qty, 0), promoErr = promo ? applyPromo(lines, promo, events, subtotal) : '';
  const disc = lines.reduce((a, l) => a + (l.disc || 0), 0), feeDisc = lines.reduce((a, l) => a + (l.feeDisc || 0), 0);
  const fee = lines.reduce((a, l) => a + l.fee, 0) - feeDisc, donation = Math.max(0, Math.round(+cart.donation || 0));
  // Stage 5 money breakdown, each part stored separately on the order:
  // platform fee (the platform's cut — the organizer pays it from the payout, or the buyer pays it as a "service fee"),
  // tax (on tickets + products after discounts, plus fees when the box office taxes fees), card processing (the processor's cut,
  // passed to the buyer only when the box office chooses to).
  const pf = settings.platform || { pct: 0, fixed: 0, payer: 'organizer' }, paidTickets = lines.reduce((a, l) => a + (l.unit > 0 ? l.kind === 'ticket' ? l.qty : l.kind === 'bundle' ? l.qty * l.perCopy : 0 : 0), 0);
  const platformFee = subtotal - disc > 0 ? Math.round((subtotal - disc) * (+pf.pct || 0) / 100) + paidTickets * (+pf.fixed || 0) : 0;
  const serviceFee = pf.payer === 'buyer' ? platformFee : 0;
  const tax = Math.round((subtotal - disc + (settings.taxOnFees ? fee + serviceFee : 0)) * (+settings.taxPct || 0) / 100);
  const pre = subtotal - disc + fee + serviceFee + tax + donation, card = settings.card || { pct: 0, fixed: 0, pass: false };
  const processingFee = o.method === 'card' && pre > 0 ? Math.round(pre * (+card.pct || 0) / 100) + (+card.fixed || 0) : 0, processing = card.pass ? processingFee : 0;
  const sumKind = k => lines.filter(l => k.includes(l.kind)).reduce((a, l) => a + l.unit * l.qty, 0);
  return { lines, subtotal, ticketsTotal: sumKind(['ticket', 'bundle']), addonsTotal: sumKind(['addon']), discount: disc, feeDiscount: feeDisc, fee, serviceFee, tax, donation,
    processing, processingFee, platformFee, total: pre + processing, promoErr,
    faceValue: lines.reduce((a, l) => a + (l.kind === 'bundle' ? l.value : l.face * l.qty), 0), currency: lines.find(l => l.currency)?.currency || settings.currency };
}
// Promo code conditions + per-unit discounts. Returns '' or why the code can't be used on this cart.
// type: pct | fixed (off each discounted item) | order (off the order, shared out) · on: tickets (the price) | fee (booking fee) | both
function applyPromo(lines, p, events, subtotal) {
  const scope = p.scope?.length ? p.scope : ['tickets', 'bundles'], units = [];
  const tickets = lines.reduce((a, l) => a + (l.kind === 'ticket' ? l.qty * l.admits : l.kind === 'bundle' ? l.qty * l.perCopy : 0), 0);
  if (+p.minQty > 0 && tickets < +p.minQty) return `Code ${p.code} needs at least ${p.minQty} tickets in the order`;
  if (+p.maxQty > 0 && tickets > +p.maxQty) return `Code ${p.code} is only for orders of up to ${p.maxQty} tickets`;
  if (+p.minSpend > 0 && subtotal < +p.minSpend) return `Code ${p.code} needs a minimum purchase of $${(+p.minSpend / 100).toFixed(2)}`;
  for (const l of lines) {
    if (!anyOf(p.eventIds, l.eventId)) continue;
    if (l.kind !== 'addon' && (p.slotIds || []).length && !(p.slotIds || []).includes(l.slotId)) continue;
    const ev = events.find(e => e.id === l.eventId);
    for (let u = 0; u < l.qty; u++) {
      if (l.kind === 'ticket') {
        const area = l.seats[u * l.admits] ? ev?.seating?.meta?.[l.seats[u * l.admits]]?.[0] || '' : '';
        if (!scope.includes('tickets') || !anyOf(p.ticketTypeIds, l.ticketTypeId) || !anyOf(p.prices, l.unit) || !anyOf(p.areas, area)) continue;
      } else if (l.kind === 'bundle') { if (!scope.includes('bundles') || !anyOf(p.bundleIds, l.bundleId)) continue; }
      else if (!scope.includes('addons') || !anyOf(p.addonIds, l.addonId)) continue;
      units.push({ l, u, price: l.unit, fee: l.unitFee || 0, tickets: l.kind === 'ticket' ? 1 : l.kind === 'bundle' ? l.perCopy : 0 });
    }
  }
  if (!units.length) return `Code ${p.code} doesn't apply to anything in your cart`;
  units.sort((a, b) => b.price - a.price);  // the most expensive items get the discount first
  let n = 0, nt = 0;
  const take = units.filter(x => { if ((+p.maxItems > 0 && n >= +p.maxItems) || (x.tickets && +p.maxTickets > 0 && nt + x.tickets > +p.maxTickets)) return false; n++; nt += x.tickets; return true; });
  if (!take.length) return `Code ${p.code} doesn't apply to anything in your cart`;
  const on = p.on || 'tickets', amt = +p.amount || 0;
  if (p.type === 'order') {
    const D = Math.min(cents(amt), on === 'fee' ? 0 : take.reduce((a, x) => a + x.price, 0)), ds = spread(D, take.map(x => x.price));
    const F = on === 'tickets' ? 0 : Math.min(cents(amt) - D, take.reduce((a, x) => a + x.fee, 0)), fs = spread(F, take.map(x => x.fee));
    take.forEach((x, i) => { x.d = ds[i]; x.fd = fs[i]; });
  } else for (const x of take) {
    if (p.type === 'pct') { const r = Math.min(100, Math.max(0, amt)); x.d = on === 'fee' ? 0 : Math.round(x.price * r / 100); x.fd = on === 'tickets' ? 0 : Math.round(x.fee * r / 100); }
    else { const a = cents(amt); x.d = on === 'fee' ? 0 : Math.min(a, x.price); x.fd = on === 'fee' ? Math.min(a, x.fee) : on === 'both' ? Math.min(a - x.d, x.fee) : 0; }
  }
  for (const x of take) {
    const l = x.l; l.discs ||= Array(l.qty).fill(0); l.feeDiscs ||= Array(l.qty).fill(0);
    l.discs[x.u] += x.d; l.feeDiscs[x.u] += x.fd; l.disc = (l.disc || 0) + x.d; l.feeDisc = (l.feeDisc || 0) + x.fd;
  }
  return '';
}
// usage limits that need order history (checked when the order is placed; the client can't see other people's orders)
function promoUsable(p, code, orders, email, now = new Date()) {
  if (!p || p.active === false) return 'That code is not valid';
  if (p.startsAt && new Date(p.startsAt) > now) return `Code ${p.code} isn't active yet`;
  if (p.expires && new Date(p.expires) <= now) return `Code ${p.code} has expired`;
  const used = orders.filter(o => orderCounts(o) && o.data.promo?.id === p.id);
  if (+p.maxUses > 0 && used.length >= +p.maxUses) return `Code ${p.code} has been fully used`;
  if ((p.codes || []).includes(String(code).toUpperCase()) && used.some(o => String(o.data.code).toUpperCase() === String(code).toUpperCase())) return `Code ${String(code).toUpperCase()} has already been used`;
  if (email && +p.perCustomer > 0 && used.filter(o => o.buyer_email === email.toLowerCase()).length >= +p.perCustomer) return `You've already used code ${p.code}`;
  return '';
}
const trackingUsable = (t, eventIds, orders, now = new Date()) => !!t && t.active !== false && inWindow(t.startsAt, t.expires, now)
  && (!(t.eventIds || []).length || eventIds.some(id => t.eventIds.includes(id)))
  && !(+t.maxUses > 0 && orders.filter(o => o.box_office_id === t.box_office_id && orderCounts(o) && o.data.tracking === t.code).length >= +t.maxUses);
// what a buyer's browser may know about a promo: the targeting it needs to show the discount, never the limits or the other unique codes
const publicPromo = (p, code) => { const { codes, note, maxUses, perCustomer, created_at, created_by, box_office_id, ...pub } = p; return { ...pub, code: String(code).trim().toUpperCase() }; };
// products a buyer can add right now, given what's in their selection (ticket types + seat areas)
function addonOpen(ad, now = new Date()) { return inWindow(ad.salesStart, ad.salesEnd, now) && !ad.hidden; }
function addonAllowed(ev, ad, tts, areas) {
  return (!(ad.ticketTypeIds || []).length || ad.ticketTypeIds.some(id => tts.includes(id))) && (!(ad.areas || []).length || ad.areas.some(a => areas.includes(a)));
}

/* ── Checkout questions (Stage 5) ──
   scope: order (box office Settings — once per order) · event (once per event in the cart) · ticket (once per ticket / person).
   type: text · select · checkbox · date · terms / waiver (must be ticked when required) · signature (typed full name, or a drawn PNG). */
const Q_TYPES = [['text', 'Text'], ['select', 'Dropdown'], ['checkbox', 'Checkbox'], ['date', 'Date'], ['terms', 'Terms to accept'], ['waiver', 'Waiver'], ['signature', 'Signature']];
const Q_SCOPES = [['event', 'Once per event'], ['ticket', 'Once per ticket / person']];
function answerErr(q, v) {
  const t = q.type || 'text', empty = v === undefined || v === null || v === '' || v === false;
  if (empty) return q.required ? (t === 'terms' || t === 'waiver' ? `Please accept: ${q.label}` : t === 'signature' ? `Please sign: ${q.label}` : `Please answer: ${q.label}`) : '';
  if (t === 'select' && !String(q.options || '').split(',').map(x => x.trim()).includes(String(v))) return `Choose an option for: ${q.label}`;
  if (t === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return `Enter a date for: ${q.label}`;
  if (t === 'signature' && (String(v).length > 200000 || (String(v).startsWith('data:') && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v)) || String(v).trim().length < 2)) return `Please sign: ${q.label}`;
  if (String(v).length > 2000 && t !== 'signature') return `Answer too long: ${q.label}`;
  return '';
}
// every required answer present and well formed. tickets = {eventId: number of tickets} for per-ticket questions.
function checkAnswers(orderQs, events, answers = {}, tAnswers = {}, tickets = {}) {
  for (const q of orderQs || []) { const e = answerErr(q, answers[q.id]); if (e) return e; }
  for (const ev of events) for (const q of ev.questions || []) {
    if (q.scope === 'ticket') { for (let i = 0; i < (tickets[ev.id] || 0); i++) { const e = answerErr(q, (tAnswers[q.id] || [])[i]); if (e) return e + ` (ticket ${i + 1}, ${ev.name})`; } }
    else { const e = answerErr(q, answers[q.id]); if (e) return e + ` (${ev.name})`; }
  }
  return '';
}

/* ── What a listing shows (Stage 5): on sale · few left · sold out · coming soon · sales closed ── */
function ticketsLeft(ev, av) {
  if (!av) return null;
  const caps = [], vis = (ev.ticketTypes || []).filter(t => !t.hidden && !t.adminOnly);
  if (+ev.capacity > 0) caps.push([+ev.capacity - av.total, +ev.capacity]);
  if (vis.length && vis.every(t => +t.qty > 0)) caps.push([vis.reduce((a, t) => a + Math.max(0, +t.qty - (av.tt[t.id] || 0)), 0), vis.reduce((a, t) => a + +t.qty, 0)]);
  if (ev.seating?.enabled && !(ev.timeSlots || []).length) { const all = Object.keys(ev.seating.index || {}).length, off = new Set([...(av.seats || []), ...(av.off || [])].filter(k => k.startsWith('|'))).size; if (all) caps.push([all - off, all]); }
  if (!caps.length) return null;
  const c = caps.sort((a, b) => a[0] - b[0])[0]; return { left: Math.max(0, c[0]), of: c[1] };
}
function saleState(ev, av, now = Date.now()) {
  if (ev.salesStart && new Date(ev.salesStart) > now) return 'soon';
  if (ev.salesEnd && new Date(ev.salesEnd) < now) return 'closed';
  const t = ticketsLeft(ev, av); if (!t) return 'onsale';
  return t.left <= 0 ? 'soldout' : t.left <= Math.max(5, Math.ceil(t.of * .1)) ? 'low' : 'onsale';
}

/* ── Order states (Stage 5). Tickets exist only once an order is paid (or deliberately issued by staff).
   awaiting_payment = a card checkout in progress: holds its seats / stock until expires_at, then becomes expired (released).
   pending = "pay later / at the door" reservation the box office allowed: holds stock with no tickets until staff mark it paid. ── */
const ORDER_STATUS = { paid: 'Paid', pending: 'Reserved — unpaid', awaiting_payment: 'Awaiting payment', expired: 'Checkout expired', cancelled: 'Cancelled', refunded: 'Refunded' };
const reservedOrder = (o, now = Date.now()) => o.status === 'pending' || (o.status === 'awaiting_payment' && new Date(o.expires_at) > now);
const orderCounts = o => o.status === 'paid' || reservedOrder(o);   // uses stock, promo uses and tracking uses
// one entry per admitted ticket an order line will become: ticket type + seat (bundle lines: one per ticket inside)
const lineUnits = l => l.kind === 'ticket' ? Array.from({ length: l.qty * (l.admits || 1) }, (_, i) => ({ tt: l.ticketTypeId, seat: l.seats?.[i] || null }))
  : l.kind === 'bundle' ? (l.tts || []).map((tt, i) => ({ tt, seat: l.seats?.[i] || null })) : [];

/* availability from a ticket list (DEMO) — same shape as the SQL availability() */
// seats: sold "slot|seat" keys; off: seats nobody else can buy right now (blocked, held, unavailable, in someone else's checkout).
// ad / bd: products and bundles already sold (from live orders; bundle products count against the product's stock)
function availabilityFrom(tickets, eventId, statuses = [], token = '', orders = []) {
  const a = { tt: {}, slots: {}, seats: [], total: 0, off: [], ad: {}, bd: {} };
  for (const o of orders) if (orderCounts(o)) for (const l of o.data.lines || []) {
    if (l.eventId !== eventId) continue;
    if (l.kind === 'addon') a.ad[l.addonId] = (a.ad[l.addonId] || 0) + l.qty;
    if (l.kind === 'bundle') { a.bd[l.bundleId] = (a.bd[l.bundleId] || 0) + l.qty; for (const x of l.addons || []) a.ad[x.addonId] = (a.ad[x.addonId] || 0) + x.qty * l.qty; }
    if (o.status !== 'paid') for (const u of lineUnits(l)) {  // reserved, not yet ticketed: still off the shelf
      a.total++; a.tt[u.tt] = (a.tt[u.tt] || 0) + 1; if (l.slotId) a.slots[l.slotId] = (a.slots[l.slotId] || 0) + 1; if (u.seat) a.seats.push((l.slotId || '') + '|' + u.seat);
    }
  }
  for (const t of tickets) {
    if (t.event_id !== eventId || t.status !== 'valid') continue;
    a.total++; a.tt[t.ticket_type_id] = (a.tt[t.ticket_type_id] || 0) + 1;
    if (t.slot_id) a.slots[t.slot_id] = (a.slots[t.slot_id] || 0) + 1;
    if (t.seat) a.seats.push((t.slot_id || '') + '|' + t.seat);
  }
  const now = Date.now();
  for (const r of statuses) if (r.event_id === eventId && !(r.status === 'checkout' && (new Date(r.expires_at) <= now || (token && r.token === token)))) a.off.push((r.slot_id || '') + '|' + r.seat);
  return a;
}
// seats a buyer can't pick for one showtime ('' rows apply to every showtime)
const offSeats = (av, slotId) => { const out = new Set(); for (const k of [...(av?.seats || []), ...(av?.off || [])]) { const i = k.indexOf('|'), sl = k.slice(0, i); if (!sl || sl === (slotId || '')) out.add(k.slice(i + 1)); } return out; };


/* ── Events: lifecycle, visibility, showtimes, sellout value (Stage 2). Shared by buyer pages, back office and DEMO checks. ──
   status: draft | published | cancelled, plus archived:true (hidden everywhere, records kept).
   visibility: public (listed) | link (direct link only) | hidden (off the public site, team/manual sales only).
   publishAt / salesStart / salesEnd: scheduled go-live, sales opening and closing.
   timeSlots = showtimes: {id, start, end?, capacity, label?, hidden?, unavailable?, soldOut?} */
const VISIBILITY = { public: 'Public — listed on the box office', link: 'Direct link only — not listed', hidden: 'Hidden — off the public site' };
const WAITLIST_MODES = { off: 'Off', soldout: 'Only when sold out', presale: 'Before tickets go on sale, and when sold out', always: 'Always shown' };
function normEvent(ev) {
  if (!ev) return ev;
  if (ev.visibility === 'private' || !ev.visibility) ev.visibility = ev.visibility === 'private' ? 'link' : 'public';
  if (!ev.waitlistMode) ev.waitlistMode = ev.waitlist === false ? 'off' : 'soldout';
  ev.contact ||= { name: '', email: '', phone: '' };
  return ev;
}
// On sale to the public right now? (published, not archived, past its scheduled publish time, not hidden)
const eventLive = (ev, now = Date.now()) => ev.status === 'published' && !ev.archived && ev.visibility !== 'hidden' && (!ev.publishAt || new Date(ev.publishAt) <= now);
const eventListed = (ev, now) => eventLive(ev, now) && ev.visibility === 'public';
const salesOpen = (ev, now = Date.now()) => (!ev.salesStart || new Date(ev.salesStart) <= now) && (!ev.salesEnd || new Date(ev.salesEnd) > now) && !ev.salesPaused;
function slotState(s, av) {
  if (s.hidden) return 'hidden'; if (s.unavailable) return 'unavailable'; if (s.soldOut) return 'soldout';
  return +s.capacity > 0 && (av?.slots?.[s.id] || 0) >= +s.capacity ? 'soldout' : 'open';
}
// Maximum revenue if everything sellable sells, at face value — and what's already sold/comped against it.
// tickets: this event's tickets (any status); statuses: seat_status rows; orders give what was actually collected.
// Seated events also get byArea (Eli Step 3 §11): seats, price, sold, available, blocked, comped, potential, actual, remaining.
function sellout(ev, tickets = [], statuses = [], orders = []) {
  const visible = (ev.timeSlots || []).filter(s => !s.hidden && !s.unavailable), shows = Math.max(1, visible.length);
  const tts = ev.ticketTypes || [], price = t => +t.price || 0, valid = tickets.filter(t => t.event_id === ev.id && t.status === 'valid');
  const soldBy = id => valid.filter(t => t.ticket_type_id === id), unitOf = t => price(t) / Math.max(1, +t.admits || 1);
  const byTT = [], byArea = []; let total = 0, estimate = false, unknown = false;
  if (ev.seating?.enabled) {
    const ttById = Object.fromEntries(tts.map(t => [t.id, t])), A = {}, cap = {};
    const paid = t => { const o = orders.find(x => x.id === t.order_id); if (!o || o.status !== 'paid' || o.data.comp) return 0;
      const l = o.data.lines.find(x => x.kind === 'ticket' && x.ticketTypeId === t.ticket_type_id && x.eventId === ev.id); const unit = +l?.unit || 0;
      return Math.round(unit * (1 - (+o.data.discount || 0) / Math.max(1, +o.data.subtotal || 0))); };
    for (const sl of visible.length ? visible : [{ id: '' }]) {
      for (const { p, state, t } of seatStates(ev, { tickets, statuses, orders, slotId: sl.id }).values()) {
        const r = A[p.area] ||= { name: p.area, seats: 0, prices: new Set(), sold: 0, available: 0, blocked: 0, held: 0, comped: 0, unavailable: 0, potential: 0, actual: 0, remaining: 0 };
        const pr = p.tt ? price(ttById[p.tt] || {}) : 0; r.seats++; if (p.tt) r.prices.add(pr);
        if (state === 'sold') { r.sold++; if (t) r.actual += paid(t); } else if (state === 'comp') r.comped++;
        else if (state === 'blocked') r.blocked++; else if (state === 'unavailable') r.unavailable++;
        else if (state === 'held' || state === 'checkout') r.held++; else r.available++;
        if (!['blocked', 'unavailable'].includes(state)) { r.potential += pr; if (p.tt) cap[p.tt] = (cap[p.tt] || 0) + 1; }
        if (['available', 'held', 'checkout'].includes(state)) r.remaining += pr;
      }
    }
    byArea.push(...Object.values(A).map(r => ({ ...r, prices: [...r.prices].sort((a, b) => a - b) })));
    for (const t of tts) byTT.push({ tt: t, capacity: cap[t.id] || 0, potential: (cap[t.id] || 0) * price(t) });
  } else {
    const cap = (ev.timeSlots || []).length ? sum2(visible, s => +s.capacity) : +ev.capacity || 0;
    let left = cap;
    for (const t of tts.filter(t => +t.qty > 0)) { const n = cap ? Math.min(+t.qty, left) : +t.qty; left = Math.max(0, left - n); byTT.push({ tt: t, capacity: n, potential: n * unitOf(t) }); }
    const open = tts.filter(t => !(+t.qty > 0)), main = open.find(t => !t.hidden) || open[0];
    for (const t of open) { if (t === main && cap) { estimate = true; byTT.push({ tt: t, capacity: left, potential: left * unitOf(t) }); } else { if (!cap) unknown = true; byTT.push({ tt: t, capacity: null, potential: 0 }); } }
  }
  byTT.forEach(r => { const s = soldBy(r.tt.id); r.sold = s.length; r.soldValue = s.length * unitOf(r.tt); });
  total = sum2(byTT, r => r.potential);
  const soldValue = sum2(byTT, r => r.soldValue);
  return { total, byTT, byArea, soldValue, remaining: Math.max(0, total - soldValue), pct: total ? soldValue / total : 0, estimate, unknown, shows };
}
const sum2 = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);
// A copy of an event's set-up with fresh ids — no orders, tickets, codes or schedule state carry over.
function cloneEventStructure(src) {
  const ev = clone(src), ttMap = {};
  ev.ticketTypes = (ev.ticketTypes || []).map(t => { const n = shortId('tt_'); ttMap[t.id] = n; return { ...t, id: n }; });
  (ev.seating?.sections || []).forEach(x => { x.id = shortId('sec_'); x.ticketTypeId = ttMap[x.ticketTypeId] || ''; });
  if (ev.seating?.prices) ev.seating.prices = Object.fromEntries(Object.entries(ev.seating.prices).map(([k, v]) => [k, ttMap[v] || '']));
  if (ev.seating?.index) ev.seating.index = Object.fromEntries(Object.entries(ev.seating.index).map(([k, v]) => [k, ttMap[v] || '']));
  const sec = ev.secrets || {};
  ev.secrets = { password: sec.password || '', ticketPasswords: Object.fromEntries(Object.entries(sec.ticketPasswords || {}).map(([k, v]) => [ttMap[k], v])) };
  const slMap = {}, adMap = {}, tts = ids => (ids || []).map(i => ttMap[i]).filter(Boolean);
  ev.timeSlots = (ev.timeSlots || []).map(x => { const n = shortId('ts_'); slMap[x.id] = n; return { ...x, id: n }; });
  ev.ticketTypes.forEach(t => { if (t.slotPrices) t.slotPrices = Object.fromEntries(Object.entries(t.slotPrices).filter(([k]) => slMap[k]).map(([k, v]) => [slMap[k], v])); });
  ev.addons = (ev.addons || []).map(a => { const n = shortId('ad_'); adMap[a.id] = n; return { ...a, id: n, ticketTypeIds: tts(a.ticketTypeIds) }; });
  ev.bundles = (ev.bundles || []).map(b => ({ ...b, id: shortId('bd_'), parts: (b.parts || []).map(x => ({ ...x, ticketTypeIds: tts(x.ticketTypeIds) })), addons: (b.addons || []).filter(x => adMap[x.addonId]).map(x => ({ ...x, addonId: adMap[x.addonId] })) }));
  ev.upsells = (ev.upsells || []).filter(u => adMap[u.addonId]).map(u => ({ ...u, id: shortId('up_'), addonId: adMap[u.addonId], ticketTypeIds: tts(u.ticketTypeIds) }));
  ev.questions = (ev.questions || []).map(q => ({ ...q, id: shortId('q_') }));
  delete ev.archived; delete ev.publishAt; delete ev.salesStart; delete ev.salesEnd; delete ev.salesPaused; delete ev.hasPassword;
  return Object.assign(ev, { id: uid(), status: 'draft', created_at: nowIso() });
}
// Templates keep the set-up plus time of day and length; dates, showtimes and discount codes are chosen per event.
function eventToTemplate(ev, name) {
  const e = cloneEventStructure(ev), st = new Date(ev.start), mins = ev.end ? Math.round((new Date(ev.end) - st) / 6e4) : 180;
  for (const k of ['id', 'slug', 'status', 'created_at', 'start', 'end', 'box_office_id', 'image']) delete e[k];
  e.timeSlots = []; e.secrets.password = ''; e.ticketTypes.forEach(t => delete t.slotPrices);
  return { id: shortId('etpl_'), name: name || ev.name, created_at: nowIso(), at: [st.getHours(), st.getMinutes()], minutes: mins, event: e };
}
function eventFromTemplate(tpl, dayIso) {
  const e = cloneEventStructure(tpl.event), d = dayIso ? new Date(dayIso) : new Date(Date.now() + 30 * 864e5);
  d.setHours(tpl.at?.[0] ?? 20, tpl.at?.[1] ?? 0, 0, 0);
  if (e.seating?.enabled) Object.assign(e.seating, seatDerive(e.seating));
  return Object.assign(e, { name: e.name || tpl.name, slug: 'new-event-' + randCode(4).toLowerCase(), start: d.toISOString(), end: new Date(d.getTime() + (tpl.minutes || 180) * 6e4).toISOString(), timeSlots: [] });
}

/* ── Seat maps (Stage 3) ──────────────────────────────────────────────────────────
   seating = {enabled, stage:{x,y,w,h,label}, sections:[...], levels:[{id,name}], bg:{src,x,y,w,opacity,public},
              prices:{seatId:ttId}, areas:{seatId:area}, labels:{seatId:label}, removed:[seatId], noSingles, venueId, venueName,
              index, meta, rows (DERIVED on save by seatDerive — the server checks against these)}
   section = {id, code, name, area?, level?, kind:'rows'|'table'|'booth'|'ga', x, y, rot, ticketTypeId, gap?, rowGap?,
              rows, seatsPerRow, rowSeats:[n per row], rowStart:'A', rowLabels:'AA,BB', seatStart, numbering:'seq'|'odd'|'even', reverse, curve(0-100)
              | seats (table, booth) | capacity, w, h (ga — standing area sold as numbered spots)}
   Seat ids are "<code>-<row><num>" (rows) or "<code>-<num>" (tables, booths, standing spots). Blocks, holds and
   "unavailable" are NOT in the event — they are seat_status rows, so changing them never rewrites the layout. */
const SEAT = 26, ROWH = 30, ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ', GA_MAX = 2000;
function rowLabel(start, i) {
  if (/^\d+$/.test(String(start))) return String(+start + i);
  let k = Math.max(0, ROW_LETTERS.indexOf(String(start || 'A').toUpperCase())) + i, out = '';
  do { out = ROW_LETTERS[k % 24] + out; k = Math.floor(k / 24) - 1; } while (k >= 0);
  return out;
}
const secRowLabel = (sec, r) => String(sec.rowLabels || '').split(',').map(x => x.trim().toUpperCase())[r] || rowLabel(sec.rowStart || 'A', r);
// seat number k (0-based from the left, or right if reversed): 1,2,3… or odd/even house numbering
function seatNum(sec, i, n) {
  const k = sec.reverse ? n - 1 - i : i, s = Math.max(0, Math.round(+sec.seatStart || 1));
  if (sec.numbering !== 'odd' && sec.numbering !== 'even') return s + k;
  const first = (s % 2 === 1) === (sec.numbering === 'odd') ? s : s + 1; return first + 2 * k;
}
const secKind = sec => ['table', 'booth', 'ga'].includes(sec.kind) ? sec.kind : 'rows';
function seatLayout(st) {
  const seats = [], secs = [], removed = new Set(st?.removed || []), areas = st?.areas || {}, labels = st?.labels || {}, lv0 = st?.levels?.[0]?.id || '';
  for (const sec of st?.sections || []) {
    const local = [], rowsOrder = {}, kind = secKind(sec), gap = Math.max(16, Math.min(60, +sec.gap || SEAT)), rg = Math.max(20, Math.min(80, +sec.rowGap || ROWH));
    let R = 0, box = null;
    if (kind === 'table') {
      const n = Math.max(1, Math.min(40, +sec.seats || 8)); R = Math.max(26, n * gap / (2 * Math.PI) - 4);
      for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / n; local.push({ id: `${sec.code}-${i + 1}`, x: Math.cos(a) * (R + 15), y: Math.sin(a) * (R + 15), row: '', num: i + 1, r: 0, i }); }
    } else if (kind === 'booth') {  // a bench each side of a long table
      const n = Math.max(2, Math.min(24, +sec.seats || 6)), top = Math.ceil(n / 2), W = (top - 1) * gap;
      box = { x: -14, y: 13, w: W + 28, h: 30 };
      for (let i = 0; i < n; i++) { const b = i >= top, j = b ? i - top : i; local.push({ id: `${sec.code}-${i + 1}`, x: j * gap, y: b ? 56 : 0, row: '', num: i + 1, r: 0, i }); }
    } else if (kind === 'ga') {  // standing / unreserved area: numbered spots, bought by quantity, never drawn one by one
      const n = Math.max(1, Math.min(GA_MAX, +sec.capacity || 100)), w = Math.max(80, +sec.w || 220), h = Math.max(50, +sec.h || 120);
      box = { x: 0, y: 0, w, h };
      for (let i = 0; i < n; i++) local.push({ id: `${sec.code}-${i + 1}`, x: w / 2, y: h / 2, row: '', num: i + 1, r: 0, i, ga: true });
    } else {
      const rows = Math.max(1, Math.min(60, +sec.rows || 1)), per = Math.max(1, Math.min(80, +sec.seatsPerRow || 10));
      const counts = Array.from({ length: rows }, (_, r) => Math.max(1, Math.min(80, +(sec.rowSeats || [])[r] || per)));
      const M = Math.max(...counts), W = (M - 1) * gap, bend = (+sec.curve || 0) / 100 * W * .22;
      counts.forEach((n, r) => {
        const label = secRowLabel(sec, r), off = (M - n) * gap / 2, order = rowsOrder[label] = [];
        for (let i = 0; i < n; i++) { const x = off + i * gap, t = W ? (x - W / 2) / (W / 2) : 0, num = seatNum(sec, i, n), id = `${sec.code}-${label}${num}`;
          order.push(removed.has(id) ? null : id); local.push({ id, x, y: r * rg - bend * t * t, row: label, num, r, i }); }
      });
    }
    const xs = local.map(p => p.x).concat(box ? [box.x, box.x + box.w] : []), ys = local.map(p => p.y).concat(box ? [box.y, box.y + box.h] : []);
    const g = { sec, kind, level: sec.level || lv0, local: [], all: local, rowsOrder, R, box, minx: Math.min(...xs), maxx: Math.max(...xs), miny: Math.min(...ys), maxy: Math.max(...ys) };
    g.cx = (g.minx + g.maxx) / 2; g.cy = (g.miny + g.maxy) / 2;
    const a = (+sec.rot || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    for (const p of local) {
      const dx = p.x - g.cx, dy = p.y - g.cy;
      p.gx = (+sec.x || 0) + g.cx + dx * c - dy * sn; p.gy = (+sec.y || 0) + g.cy + dx * sn + dy * c;
      p.sec = sec; p.tt = (kind === 'ga' ? '' : (st.prices || {})[p.id]) || sec.ticketTypeId || '';
      p.area = areas[p.id] || sec.area || sec.name || sec.code; p.label = kind === 'ga' ? '' : labels[p.id] || String(p.num); p.level = g.level;
      p.removed = removed.has(p.id);
      if (!p.removed) { seats.push(p); g.local.push(p); }
    }
    secs.push(g);
  }
  const L = { seats, secs, lv0 }; L.bounds = boundsOf(L, null, st?.stage); return L;
}
// Drawing bounds for one level (null = everything).
function boundsOf(L, level, stage) {
  const xs = [], ys = [];
  for (const g of L.secs) {
    if (level != null && g.level !== level) continue;
    const a = (+g.sec.rot || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    for (const [px, py] of [[g.minx, g.miny], [g.maxx, g.miny], [g.minx, g.maxy], [g.maxx, g.maxy]]) {
      const dx = px - g.cx, dy = py - g.cy; xs.push((+g.sec.x || 0) + g.cx + dx * c - dy * sn); ys.push((+g.sec.y || 0) + g.cy + dx * sn + dy * c);
    }
  }
  if (stage && (level == null || level === (stage.level || L.lv0 || ''))) { xs.push(+stage.x, +stage.x + +stage.w); ys.push(+stage.y, +stage.y + +stage.h); }
  return xs.length ? { x0: Math.min(...xs) - 30, x1: Math.max(...xs) + 30, y0: Math.min(...ys) - 44, y1: Math.max(...ys) + 24 } : { x0: -200, x1: 200, y0: -150, y1: 150 };
}
// What the server checks against: price per seat (index), what goes on the ticket (meta: [area, row, seat]),
// and row order for the single-seat gap rule (rows: "SEC|A" → [seatId | null for a removed seat]).
function seatDerive(st) {
  const L = seatLayout(st), index = {}, meta = {}, rows = {};
  for (const p of L.seats) { if (p.tt) index[p.id] = p.tt; meta[p.id] = [p.area, p.row, p.label]; }
  for (const g of L.secs) for (const [r, ids] of Object.entries(g.rowsOrder)) rows[g.sec.code + '|' + r] = ids;
  return { index, meta, rows };
}
const seatIndex = st => seatDerive(st).index;
// Seat IDs come from row labels and seat numbers, so renaming rows / renumbering seats re-keys them. Carry each seat's
// overrides (price, area, label, removed) to its new ID by position. rowMap: old row index → new (-1 = row deleted).
function remapSeatKeys(st, secId, mutate, rowMap = r => r) {
  const one = () => { const sec = st.sections.find(x => x.id === secId); return sec ? seatLayout({ sections: [sec] }).secs[0].all : []; };
  const before = one(); mutate(); const after = new Map(one().map(p => [p.r + ':' + p.i, p.id])), ren = new Map();
  for (const p of before) { const r2 = rowMap(p.r), id2 = r2 < 0 ? null : after.get(r2 + ':' + p.i) || null; if (id2 !== p.id) ren.set(p.id, id2); }
  if (!ren.size) return;
  for (const k of ['prices', 'areas', 'labels']) { if (!st[k]) continue; const out = {};
    for (const [id, v] of Object.entries(st[k])) if (!ren.has(id)) out[id] ??= v; else if (ren.get(id)) out[ren.get(id)] = v;
    st[k] = out; }
  if (st.removed) st.removed = [...new Set(st.removed.map(id => ren.has(id) ? ren.get(id) : id).filter(Boolean))];
}
// drop per-seat overrides for seats that no longer exist on the map
function pruneSeatKeys(st) {
  const ids = new Set(seatLayout(st).secs.flatMap(g => g.all.map(p => p.id)));
  for (const k of ['prices', 'areas', 'labels']) if (st[k]) st[k] = Object.fromEntries(Object.entries(st[k]).filter(([id]) => ids.has(id)));
  if (st.removed) st.removed = st.removed.filter(id => ids.has(id));
}
// Ticket Type / Area, Row and Seat — kept separate on every ticket (Eli: never one combined label).
function seatInfo(ev, id, t) {
  if (t?.area !== undefined && t.area !== null) return { area: t.area, row: t.row || '', seat: t.seat_label || '' };
  const m = ev?.seating?.meta?.[id]; return m ? { area: m[0], row: m[1], seat: m[2] } : { area: '', row: '', seat: id || '' };
}

// Venue chart <-> event. A chart keeps the layout plus named price tiers; attaching it to an event copies it and maps
// each tier to the event's ticket type of the same name (creating it if missing).
const CHART_KEYS = ['stage', 'sections', 'levels', 'bg', 'prices', 'areas', 'labels', 'removed'];
function eventToVenue(ev, name, id) {
  const se = ev.seating || {}, used = new Set(seatLayout(se).seats.map(p => p.tt).filter(Boolean));
  return { id: id || shortId('ven_'), name: name || ev.venue || 'Venue', address: ev.address || '', updated_at: nowIso(), updated_by: DB._actor || 'system',
    chart: clone(Object.fromEntries(CHART_KEYS.filter(k => se[k] !== undefined).map(k => [k, se[k]]))),
    tiers: (ev.ticketTypes || []).filter(t => used.has(t.id)).map(t => ({ id: t.id, name: t.name, price: +t.price || 0 })) };
}
function venueToEvent(v, ev) {
  const map = {}, ticketTypes = clone(ev.ticketTypes || []);
  for (const t of v.tiers || []) {
    let x = ticketTypes.find(y => y.name.trim().toLowerCase() === t.name.trim().toLowerCase());
    if (!x) ticketTypes.push(x = { id: shortId('tt_'), name: t.name, price: +t.price || 0, qty: 0, min: 1, max: 10, admits: 1, desc: '', hidden: false });
    map[t.id] = x.id;
  }
  const ch = clone(v.chart || {}); (ch.sections || []).forEach(x => { x.ticketTypeId = map[x.ticketTypeId] || ''; });
  ch.prices = Object.fromEntries(Object.entries(ch.prices || {}).map(([k, id]) => [k, map[id] || '']).filter(([, id]) => id));
  const seating = { ...(ev.seating || {}), ...ch, enabled: true, venueId: v.id, venueName: v.name };
  return { ticketTypes, seating: Object.assign(seating, seatDerive(seating)) };
}

/* ── Seat statuses (Stage 3) ──
   seat_status rows: {id, box_office_id, event_id, slot_id ('' = every showtime), seat, status, note, by, at, expires_at?, token?}
   status: 'checkout' (a buyer's 10-minute hold) | 'held' (staff hold) | 'blocked' | 'unavailable'.
   A seat's state = a valid ticket (sold / comp) > unavailable > blocked > held > checkout > no price (unavailable) > available. */
const SEAT_STATES = { available: 'Available', sold: 'Sold', checkout: 'In checkout', held: 'Held', blocked: 'Blocked', unavailable: 'Unavailable', comp: 'Complimentary' };
const STATUS_RANK = { unavailable: 4, blocked: 3, held: 2, checkout: 1 };
const HOLD_MINUTES = 10;
function activeStatuses(statuses, eventId, slotId = '', now = Date.now()) {
  const m = new Map();
  for (const r of statuses || []) {
    if (r.event_id !== eventId || (r.slot_id || '') !== '' && (r.slot_id || '') !== (slotId || '')) continue;
    if (r.status === 'checkout' && new Date(r.expires_at) <= now) continue;
    const cur = m.get(r.seat); if (!cur || STATUS_RANK[r.status] > STATUS_RANK[cur.status]) m.set(r.seat, r);
  }
  return m;
}
// state of every seat on the map for one showtime. token = this buyer's checkout hold (counts as theirs, not taken).
function seatStates(ev, { tickets = [], statuses = [], orders = [], slotId = '', token = '' } = {}) {
  const out = new Map(), L = seatLayout(ev.seating), act = activeStatuses(statuses, ev.id, slotId), byTk = new Map(), ordById = new Map(orders.map(o => [o.id, o]));
  for (const t of tickets) if (t.event_id === ev.id && t.status === 'valid' && t.seat && (t.slot_id || '') === (slotId || '')) byTk.set(t.seat, t);
  const resv = new Map();  // seats in unpaid orders: a card checkout in progress shows as "in checkout", a pay-later reservation as sold
  for (const o of orders) if (o.status !== 'paid' && reservedOrder(o)) for (const l of o.data.lines || []) if (l.eventId === ev.id && (l.slotId || '') === (slotId || '')) for (const u of lineUnits(l)) if (u.seat) resv.set(u.seat, o);
  for (const p of L.seats) {
    const t = byTk.get(p.id), s = act.get(p.id), r = !t && resv.get(p.id), o = t ? ordById.get(t.order_id) : r;
    const state = t ? (t.comp || o?.data?.comp ? 'comp' : 'sold') : r ? (r.status === 'pending' ? 'sold' : 'checkout') : s && !(s.status === 'checkout' && token && s.token === token) ? s.status : !p.tt ? 'unavailable' : 'available';
    out.set(p.id, { p, state, t, s: s || null, o: o || null });
  }
  return out;
}
// Single-seat gap rule: seats this selection would leave stranded alone in a row (already-stranded seats don't count).
function singleGaps(ev, isFree, chosen) {
  const pick = new Set(chosen), bad = [];
  for (const ids of Object.values(ev.seating?.rows || {})) {
    if (!ids.some(id => pick.has(id))) continue;
    const before = ids.map(id => !!id && isFree(id)), after = ids.map((id, i) => before[i] && !pick.has(id));
    const alone = (f, i) => f[i] && !f[i - 1] && !f[i + 1];
    ids.forEach((id, i) => { if (alone(after, i) && !alone(before, i)) bad.push(id); });
  }
  return bad;
}

/* ════════════ DEMO backend (localStorage) ════════════ */
const DEMO_KEY = 'set_demo_v9';
const Demo = {
  st: null,
  load() {
    try { this._raw = localStorage.getItem(DEMO_KEY); this.st = JSON.parse(this._raw); } catch (e) { this.st = null; }
    if (!this.st || !this.st.boxOffices) { this.st = seedDemo(); this.save(); }
    return this.st;
  },
  // Pick up changes another tab made (e.g. an admin removed this person) — what a real server would see.
  fresh() { let raw = null; try { raw = localStorage.getItem(DEMO_KEY); } catch (e) { } if (raw && raw !== this._raw) { this.st = JSON.parse(raw); this._raw = raw; } return this.st || this.load(); },
  save() { try { this._raw = JSON.stringify(this.st); localStorage.setItem(DEMO_KEY, this._raw); } catch (e) { console.warn('demo save failed', e); } },
  reset() { localStorage.removeItem(DEMO_KEY); return this.load(); },
};

// A typed code is a promo code (or one of its bulk unique codes) or a tracking code — one namespace per box office.
function findCode(st, boId, code) {
  const c = String(code || '').trim().toUpperCase(); if (!c) return null;
  const promo = (st.promos || []).find(p => p.box_office_id === boId && (String(p.code).toUpperCase() === c || (p.codes || []).includes(c)));
  if (promo) return { promo };
  const tracking = (st.tracking || []).find(t => t.box_office_id === boId && String(t.code).toUpperCase() === c);
  return tracking ? { tracking } : null;
}
// codes are unique per box office across promo codes, their bulk unique codes and tracking codes
function codeClash(st, code, extra, selfId) {
  const all = [code, ...extra];
  if (all.some(c => !/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(c))) throw new Error('Codes are 3–32 letters, numbers, - or _');
  if (new Set(all).size !== all.length) throw new Error('The same code appears twice');
  for (const c of all) { const f = findCode(st, DB._bo, c); if (f && (f.promo || f.tracking).id !== selfId) throw new Error(`Code ${c} is already in use`); }
}

// "Stalls centre · Row A · Seat 12" from the saved ticket meta (data layer has no layout renderer)
const seatText = (ev, id) => { const m = ev?.seating?.meta?.[id]; return m ? [m[0], m[1] && 'Row ' + m[1], m[2] && 'Seat ' + m[2]].filter(Boolean).join(' · ') : id; };
const money_ = c => '$' + (Math.round(+c || 0) / 100).toFixed(2);
// Per-seat history (Eli Step 3 §9). action: sold | comp | cancelled | blocked | unblocked | held | released | unavailable | available | moved | price | area
function seatLog(ev, slotId, seat, action, detail, o = {}) {
  const st = Demo.st; (st.seatLog ||= []).unshift({ id: uid(), at: nowIso(), box_office_id: ev.box_office_id, event_id: ev.id, slot_id: slotId || '', seat, action, detail: detail || '',
    by: o.by || DB._actor || 'system', ref: o.ref || null, discount: o.discount || null });
  if (st.seatLog.length > 40000) st.seatLog.length = 40000;
}
// price and seating-area changes per seat, for the seat history (layout saves from the builder)
function logSeatEdits(prev, row) {
  const pi = prev.seating.index || {}, ni = row.seating.index || {}, pm = prev.seating.meta || {}, nm = row.seating.meta || {}, tn = (e, id) => (e.ticketTypes || []).find(t => t.id === id)?.name || 'not for sale';
  const ids = [...new Set([...Object.keys(pi), ...Object.keys(ni)])].filter(id => nm[id] && pm[id]);
  for (const id of ids) {
    if (pi[id] !== ni[id]) seatLog(row, '', id, 'price', `Price level ${tn(prev, pi[id])} → ${tn(row, ni[id])}`);
    if (pm[id][0] !== nm[id][0]) seatLog(row, '', id, 'area', `Seating area ${pm[id][0]} → ${nm[id][0]}`);
  }
}
const gapMsg = (ev, gaps) => `Please don't leave a single empty seat next to your selection (${gaps.map(g => seatText(ev, g)).join('; ')}). Move over one seat, or include it.`;
function demoPlaceOrder(p, asTeam) {
  const st = Demo.st, manual = p.payment === 'manual', now = new Date();
  if (manual && !asTeam) throw new Error('not allowed');
  expireOrders(st);
  // the same checkout submitted twice (double click, retry, flaky network) returns the first order — never a second one
  const again = p.attempt && st.orders.find(o => o.attempt_key === p.attempt && o.buyer_email === String(p.buyer?.email || '').trim().toLowerCase() && orderCounts(o));
  if (again) return { id: again.id, key: again.access_key, ref: again.ref, status: again.status, expires_at: again.expires_at, total: again.data.total, again: true };
  if (!String(p.buyer?.name || '').trim()) throw new Error('Name is required');
  if (!EMAIL_RE.test(p.buyer?.email || '')) throw new Error('A valid email is required');
  const items = p.items || [], addons = (p.addons || []).filter(a => +a.qty >= 1);
  if (!items.length && !addons.length) throw new Error('Your cart is empty');
  let bo = null;
  const pending = { tt: {}, slots: {}, seats: [], total: {}, bd: {}, ad: {} }, evIds = [], avs = {}, mine = {};  // mine: ticket types + seat areas in this order, per event
  const evOf = id => {
    const ev = st.events.find(e => e.id === id && (e.status === 'published' || manual));
    if (!ev) throw new Error('Event is not on sale');
    const b = st.boxOffices.find(x => x.id === ev.box_office_id);
    if (!b || (b.status !== 'active' && !manual)) throw new Error('This box office is not selling tickets right now');
    if (bo && bo !== b) throw new Error('One order can only hold one organizer\'s events');
    bo = b;
    if (!evIds.includes(ev.id)) {
      evIds.push(ev.id); avs[ev.id] = availabilityFrom(st.tickets, ev.id, [], '', st.orders); mine[ev.id] = { tts: [], areas: [] };
      if (!manual) {
        normEvent(ev);
        if (!eventLive(ev)) throw new Error('Event is not on sale');
        if (ev.salesStart && new Date(ev.salesStart) > now) throw new Error('Tickets go on sale ' + new Date(ev.salesStart).toLocaleString());
        if (ev.salesEnd && new Date(ev.salesEnd) < now) throw new Error('Sales have ended');
        if (ev.secrets?.password && (p.unlock?.[ev.id] || '') !== ev.secrets.password) throw new Error('This event needs a password');
      }
    }
    return ev;
  };
  // inventory, capacity, showtime and seat checks for n tickets of one type (a bundle checks each of its ticket types)
  const checkTickets = (ev, it, tt, n, seats) => {
    if (!tt) throw new Error('Unknown ticket type');
    const av = avs[ev.id], adm = n * (+tt.admits || 1), k = ev.id + tt.id;
    pending.tt[k] = (pending.tt[k] || 0) + adm; pending.total[ev.id] = (pending.total[ev.id] || 0) + adm;
    if (+tt.qty > 0 && (av.tt[tt.id] || 0) + pending.tt[k] > +tt.qty) throw new Error(`Only ${Math.max(+tt.qty - (av.tt[tt.id] || 0), 0)} ${tt.name} left`);
    if (+ev.capacity > 0 && av.total + pending.total[ev.id] > +ev.capacity) throw new Error('Event is sold out');
    if (ev.timeSlots?.length) {
      const slot = ev.timeSlots.find(s => s.id === it.slotId); if (!slot) throw new Error('Pick a time slot');
      if (!manual && (slot.hidden || slot.unavailable || slot.soldOut)) throw new Error('That showtime is not available');
      const sk = ev.id + slot.id; pending.slots[sk] = (pending.slots[sk] || 0) + n;
      if (+slot.capacity > 0 && (av.slots[slot.id] || 0) + pending.slots[sk] > +slot.capacity) throw new Error('That time slot is full');
    }
    mine[ev.id].tts.push(tt.id);
    if (!ev.seating?.enabled) return;
    if (seats.length !== n) throw new Error(`Pick ${n} seat(s)`);
    const act = activeStatuses(st.seatStatus, ev.id, it.slotId || '');
    for (const s of seats) {
      const key = (it.slotId || '') + '|' + s, h = act.get(s);
      if (!ev.seating.index?.[s]) throw new Error(`${seatText(ev, s)} is unavailable`);
      if (ev.seating.index[s] !== tt.id) throw new Error(`${seatText(ev, s)} isn't a ${tt.name} seat`);
      if (av.seats.includes(key) || pending.seats.includes(ev.id + key)) throw new Error(`${seatText(ev, s)} was just taken`);
      // staff may sell a seat they're holding; nobody sells a blocked/unavailable seat or one in another buyer's checkout
      if (h && !(h.status === 'checkout' && p.holdToken && h.token === p.holdToken) && !(manual && h.status === 'held'))
        throw new Error(h.status === 'checkout' ? `${seatText(ev, s)} is being held by another buyer — try again in a few minutes` : `${seatText(ev, s)} is unavailable`);
      pending.seats.push(ev.id + key); mine[ev.id].areas.push(ev.seating.meta?.[s]?.[0] || '');
    }
  };
  for (const it of items) {
    const ev = evOf(it.eventId), sec = ev.secrets || {}, pw = p.unlock?.[ev.id] || '';
    if (asTeam && !hasPerm(asTeam, 'orders.edit', ev.id)) throw new Error('You don\'t have permission to create orders for ' + ev.name);
    if (!(+it.qty >= 1)) throw new Error('Bad quantity');
    if (it.price !== undefined && it.price !== null && it.price !== '') {  // manual price override
      if (!manual) throw new Error('not allowed');
      if (!hasPerm(asTeam, 'tickets.pricing', ev.id)) throw new Error('You don\'t have permission to change ticket prices');
    }
    if (it.bundleId) {
      const b = (ev.bundles || []).find(x => x.id === it.bundleId); if (!b) throw new Error('Unknown bundle');
      if (!manual) {
        if (b.hidden || !inWindow(b.salesStart, b.salesEnd, now)) throw new Error(b.name + ' is not on sale right now');
        if (+b.max > 0 && +it.qty > +b.max) throw new Error(`Maximum ${b.max} × ${b.name} per order`);
      }
      const av = avs[ev.id]; pending.bd[b.id] = (pending.bd[b.id] || 0) + +it.qty;
      if (+b.qty > 0 && (av.bd[b.id] || 0) + pending.bd[b.id] > +b.qty) throw new Error(`Only ${Math.max(0, +b.qty - (av.bd[b.id] || 0))} ${b.name} left`);
      const pos = bundlePositions(b), tts = bundleTicketTypes(ev, b, it);
      if (ev.seating?.enabled && (it.seats || []).length !== tts.length) throw new Error(`Pick ${tts.length} seat(s) for ${b.name}`);
      tts.forEach((id, i) => { if (!pos[i % pos.length].includes(id)) throw new Error(`${b.name} can't include ${ev.seating?.enabled ? seatText(ev, it.seats[i]) : 'that ticket type'}`); });
      for (const id of new Set(tts)) checkTickets(ev, it, ev.ticketTypes.find(t => t.id === id), tts.filter(x => x === id).length, (it.seats || []).filter((_, i) => tts[i] === id));
      for (const x of b.addons || []) { const k = ev.id + '|' + x.addonId; pending.ad[k] = (pending.ad[k] || 0) + Math.max(1, +x.qty || 1) * +it.qty; }
    } else {
      const tt = ev.ticketTypes.find(t => t.id === it.ticketTypeId); if (!tt) throw new Error('Unknown ticket type');
      if (!manual) {
        if (tt.adminOnly) throw new Error(tt.name + ' is sold by the box office only');
        if (sec.ticketPasswords?.[tt.id] && pw !== sec.ticketPasswords[tt.id]) throw new Error(tt.name + ' is locked');
        if (tt.salesStart && new Date(tt.salesStart) > now) throw new Error(tt.name + ' is not on sale yet');
        if (tt.salesEnd && new Date(tt.salesEnd) < now) throw new Error(tt.name + ' sales have ended');
        if (+it.qty < (+tt.min || 1)) throw new Error(`Minimum ${tt.min} for ${tt.name}`);
        if (+tt.max > 0 && +it.qty > +tt.max) throw new Error(`Maximum ${tt.max} for ${tt.name}`);
      }
      checkTickets(ev, it, tt, +it.qty, it.seats || []);
    }
    if (ev.seating?.enabled && ev.seating.noSingles && !manual) {
      const av = avs[ev.id], act = activeStatuses(st.seatStatus, ev.id, it.slotId || '');
      const all = pending.seats.filter(k => k.startsWith(ev.id + (it.slotId || '') + '|')).map(k => k.split('|')[1]);
      const taken = new Set(av.seats.filter(k => k.startsWith((it.slotId || '') + '|')).map(k => k.split('|')[1]));
      const gaps = singleGaps(ev, id => !!ev.seating.index[id] && !taken.has(id) && !(act.get(id) && !(act.get(id).status === 'checkout' && act.get(id).token === p.holdToken)), [...new Set(all)]);
      if (gaps.length) throw new Error(gapMsg(ev, gaps));
    }
  }
  // products: on sale, sold with the right tickets / seats unless standalone, per-order limit, stock (bundled products count too)
  for (const a of addons) {
    const withTickets = items.some(i => i.eventId === a.eventId), ev = evOf(a.eventId), ad = (ev.addons || []).find(x => x.id === a.addonId);
    if (!ad) throw new Error('Unknown add-on');
    if (!manual) {
      if (!addonOpen(ad, now)) throw new Error(ad.name + ' is not on sale right now');
      if (!ad.standalone && !withTickets) throw new Error(ad.name + ' can only be bought with a ticket');
      if (withTickets && !addonAllowed(ev, ad, mine[ev.id].tts, mine[ev.id].areas)) throw new Error(`${ad.name} is only available with ${[...(ad.ticketTypeIds || []).map(id => ev.ticketTypes.find(t => t.id === id)?.name), ...(ad.areas || [])].filter(Boolean).join(' / ')} tickets`);
      if (!withTickets && ((ad.ticketTypeIds || []).length || (ad.areas || []).length)) throw new Error(ad.name + ' can only be bought with a ticket');
      if (+ad.max > 0 && +a.qty > +ad.max) throw new Error(`Maximum ${ad.max} × ${ad.name} per order`);
    }
    const k = ev.id + '|' + ad.id; pending.ad[k] = (pending.ad[k] || 0) + +a.qty;
  }
  for (const [k, n] of Object.entries(pending.ad)) {
    const [evId, id] = k.split('|'), ev = st.events.find(e => e.id === evId), ad = (ev.addons || []).find(x => x.id === id), sold = avs[evId].ad[id] || 0;
    if (!ad) throw new Error('Unknown add-on');
    if (+ad.qty > 0 && sold + n > +ad.qty) throw new Error(`Only ${Math.max(0, +ad.qty - sold)} ${ad.name} left`);
  }
  // promo / tracking code — one box office, one code namespace
  const email = p.buyer.email.trim().toLowerCase();
  let promo = null, tracking = null;
  if (p.code && !p.comp) {
    const f = findCode(st, bo.id, p.code);
    if (f?.promo) { const e = promoUsable(f.promo, p.code, st.orders, email, now); if (e) throw new Error(e); promo = publicPromo(f.promo, p.code); }
    else if (f?.tracking && trackingUsable(f.tracking, evIds, st.orders, now)) tracking = f.tracking.code;
    else throw new Error('That code is not valid');
  }
  if (!tracking && p.tracking) { const f = findCode(st, bo.id, p.tracking); if (f?.tracking && trackingUsable(f.tracking, evIds, st.orders, now)) tracking = f.tracking.code; }  // a stale link never blocks a sale
  const set = pricingSettings(bo, st.platform);
  const q = quote({ items, addons, donation: p.donation }, st.events, set, promo, { avail: avs, manual, now, method: p.payment });
  if (promo && q.promoErr) throw new Error(q.promoErr);
  // checkout questions: once per order (box office), once per event, once per ticket
  const perEv = {}; q.lines.forEach(l => { perEv[l.eventId] = (perEv[l.eventId] || 0) + lineUnits(l).length; });
  if (!manual) { const e = checkAnswers(set.questions, evIds.map(id => st.events.find(x => x.id === id)), p.answers || {}, p.ticketAnswers || {}, perEv); if (e) throw new Error(e); }
  if (p.comp) {  // complimentary: keeps the real ticket type and face value, collects $0
    if (!manual) throw new Error('not allowed');
    for (const id of evIds) if (!hasPerm(asTeam, 'tickets.comps', id)) throw new Error('You don\'t have permission to issue complimentary tickets');
    q.lines.forEach(l => Object.assign(l, { unit: 0, fee: 0, unitFee: 0, comp: true }));
    Object.assign(q, { subtotal: 0, ticketsTotal: 0, addonsTotal: 0, discount: 0, feeDiscount: 0, fee: 0, serviceFee: 0, tax: 0, donation: 0, processing: 0, processingFee: 0, platformFee: 0, total: 0 });
  }
  // how it's paid: free and staff orders are paid now; a card checkout waits for the processor; pay-later reserves without tickets
  if (q.total > 0 && !manual) {
    if (p.payment === 'card') { if (set.payments?.card === false || !cardReady(bo)) throw new Error('Card payments are not set up for this box office yet'); }
    else if (p.payment === 'offline') { if (set.payments?.offline === false) throw new Error('Pay later is not available for this box office'); }
    else throw new Error('Choose a payment method');
  }
  const status = q.total === 0 || manual ? 'paid' : p.payment === 'card' ? 'awaiting_payment' : 'pending';
  let ref; do { ref = 'SET-' + randCode(6); } while (st.orders.some(o => o.ref === ref));
  const order = { id: uid(), box_office_id: bo.id, ref, access_key: uid(), status, buyer_email: email, event_ids: evIds, created_at: now.toISOString(),
    attempt_key: p.attempt || null, expires_at: status === 'awaiting_payment' ? new Date(now.getTime() + PAY_MINUTES * 6e4).toISOString() : null,
    payment: status === 'awaiting_payment' ? { provider: bo.gateway.provider, test: !!bo.gateway.test, attempts: [] } : null,
    data: { buyer: p.buyer, lines: q.lines, subtotal: q.subtotal, ticketsTotal: q.ticketsTotal, addonsTotal: q.addonsTotal, discount: q.discount, feeDiscount: q.feeDiscount,
      fee: q.fee, serviceFee: q.serviceFee, tax: q.tax, donation: q.donation, processing: q.processing, processingFee: q.processingFee, total: q.total, refunded: 0, faceValue: q.faceValue,
      code: promo?.code || null, promo: promo ? { id: promo.id, code: findCode(st, bo.id, promo.code).promo.code } : null, tracking,
      payment: q.total === 0 ? 'free' : p.payment, answers: p.answers || {}, ticketAnswers: p.ticketAnswers || {}, optIn: !!p.optIn, source: p.source || null, currency: q.currency,
      platformFee: q.platformFee, ...(p.comp ? { comp: true } : {}) } };
  st.orders.push(order);
  // the order now holds its seats itself (paid → tickets; unpaid → reserved until paid or expired), so this buyer's seat holds go
  for (const l of q.lines) if (l.seats?.length) st.seatStatus = (st.seatStatus || []).filter(r => !(r.event_id === l.eventId && l.seats.includes(r.seat) && [l.slotId || '', ''].includes(r.slot_id || '') && (r.status === 'checkout' || (manual && r.status === 'held'))));
  if (p.holdToken) st.seatStatus = (st.seatStatus || []).filter(r => !(r.status === 'checkout' && r.token === p.holdToken));
  if (status === 'paid') issueOrderTickets(st, order, { manual, by: asTeam?.email || DB._actor || email });
  Demo.save();
  const res = { id: order.id, key: order.access_key, ref, status, expires_at: order.expires_at, total: q.total };
  if (status === 'awaiting_payment' && p.card) { const r = demoCharge(st, order, p.card); Demo.save(); if (r.error) throw new Error(r.error); res.status = 'paid'; }  // demo shortcut: place + pay in one call
  return res;
}
// Paid → tickets. Every ticket keeps: real ticket type, face value, amount collected, its discount + code, comp, tracking code, products,
// package, and its own checkout answers. Runs once per order (placing a free/staff order, the processor confirming, or staff marking paid).
function issueOrderTickets(st, order, o = {}) {
  if (st.tickets.some(t => t.order_id === order.id)) return;
  const d = order.data, comp = !!d.comp, tracking = d.tracking || null, code = d.code || null, by = o.by || order.buyer_email, idx = {};
  const extras = evId => d.lines.filter(l => l.eventId === evId && l.kind === 'addon').map(l => `${l.name} × ${l.qty}`);
  const tAns = evId => { const i = idx[evId] = (idx[evId] ?? -1) + 1, ev = st.events.find(e => e.id === evId), out = {};
    for (const q of ev?.questions || []) if (q.scope === 'ticket' && d.ticketAnswers?.[q.id]?.[i] !== undefined) out[q.id] = d.ticketAnswers[q.id][i]; return out; };
  const issue = (l, ttId, seat, face, paid, discount, more = {}) => {
    const ev = st.events.find(e => e.id === l.eventId), inf = seat ? seatInfo(ev, seat) : null;
    st.tickets.push({ id: uid(), box_office_id: order.box_office_id, order_id: order.id, event_id: l.eventId, ticket_type_id: ttId, slot_id: l.slotId || null,
      seat, ...(inf ? { area: inf.area, row: inf.row, seat_label: inf.seat } : {}), comp, face, paid, discount, promo: discount > 0 ? code : null, tracking,
      bundle: null, extras: extras(l.eventId), price_override: !!l.override, answers: tAns(l.eventId), ...more, code: randCode(10), holder: d.buyer.name, status: 'valid', checked_in_at: null });
    if (seat) seatLog(ev, l.slotId, seat, comp ? 'comp' : 'sold', `${comp ? 'Complimentary ticket issued' : 'Sold'} to ${d.buyer.name}${discount > 0 ? ` · discount ${code}` : ''}${more.bundle ? ` · ${more.bundle.name}` : ''} · ${money_(comp ? face : paid)}`, { ref: order.ref, by, discount: discount > 0 ? code : null });
  };
  for (const l of d.lines) {
    if (l.kind === 'ticket') for (let u = 0; u < l.qty; u++) {
      const dd = l.discs?.[u] || 0, fs = spread(l.face, Array(l.admits).fill(1)), ps = spread(l.unit - dd, Array(l.admits).fill(1)), ds = spread(dd, Array(l.admits).fill(1));
      for (let j = 0; j < l.admits; j++) issue(l, l.ticketTypeId, l.seats[u * l.admits + j] || null, fs[j], ps[j], ds[j]);
    }
    if (l.kind === 'bundle') for (let c = 0; c < l.qty; c++) {  // the bundle price is shared over its tickets and products by their normal prices
      const n = l.perCopy, tf = l.tfaces.slice(c * n, c * n + n), w = [...tf, ...l.addons.map(a => a.face * a.qty)], dd = l.discs?.[c] || 0;
      const ps = spread(l.unit - dd, w), ds = spread(dd, w);
      for (let j = 0; j < n; j++) issue(l, l.tts[c * n + j], l.seats[c * n + j] || null, tf[j], ps[j], ds[j],
        { bundle: { id: l.bundleId, name: l.name, n: c + 1 }, extras: [...extras(l.eventId), ...l.addons.map(a => `${a.name} × ${a.qty} (in ${l.name})`)] });
    }
  }
  // ONE confirmation email per order, with every ticket (queued here; delivery is wired in Stage 8)
  if (!(st.outbox ||= []).some(m => m.order_id === order.id && m.kind === 'confirmation'))
    st.outbox.push({ id: uid(), box_office_id: order.box_office_id, order_id: order.id, kind: 'confirmation', to: order.buyer_email, at: nowIso(), status: 'queued' });
}
// The demo processor: Stripe's published test card numbers behave like Stripe test mode. Never stores the card — only brand + last 4.
function demoCharge(st, order, card = {}) {
  if (order.status === 'paid') return { status: 'paid', already: true };   // a second click / retry after success never charges twice
  if (order.status !== 'awaiting_payment' || new Date(order.expires_at) <= Date.now()) { expireOrders(st); return { error: 'This checkout has expired and its seats were released. Please start again.' }; }
  const atts = order.payment.attempts;
  if (atts.length >= 8) return { error: 'Too many payment attempts on this order. Please start again.' };
  let err = '', last4 = '', brand = card.wallet === 'apple_pay' ? 'Apple Pay' : card.wallet === 'google_pay' ? 'Google Pay' : '';
  if (!card.wallet) {
    const n = String(card.number || '').replace(/\D/g, ''), [mm, yy] = String(card.exp || '').split('/').map(x => +x);
    last4 = n.slice(-4); brand = cardBrand(n);
    if (!luhn(n)) err = 'Your card number is invalid.';
    else if (!(mm >= 1 && mm <= 12) || new Date(2000 + yy, mm) <= new Date()) err = 'Your card\'s expiration date is invalid.';
    else if (!/^\d{3,4}$/.test(String(card.cvc || ''))) err = 'Your card\'s security code is invalid.';
    else if (!(n in TEST_CARDS)) err = 'Demo mode only accepts test cards — use 4242 4242 4242 4242.';
    else err = TEST_CARDS[n];
  }
  atts.push({ at: nowIso(), ok: !err, method: card.wallet || 'card', brand, last4, error: err || null });
  if (err) return { error: err };
  confirmPayment(st, order, { provider: 'demo', ref: 'pi_demo_' + randCode(12).toLowerCase(), method: card.wallet || 'card', brand, last4, fee: order.data.processingFee });
  return { status: 'paid' };
}
// The processor says the money arrived. Idempotent. A payment that lands after the checkout expired still gets its tickets if every seat /
// ticket is still free; otherwise it is refunded automatically (never two buyers for one seat). → 'issued' | 'already' | 'refunded'
function confirmPayment(st, order, pay) {
  if (order.status === 'paid') return 'already';
  const late = !reservedOrder(order);
  if (late) {
    const clash = order.data.lines.some(l => { const av = availabilityFrom(st.tickets, l.eventId, [], '', st.orders.filter(o => o.id !== order.id)), ev = st.events.find(e => e.id === l.eventId);
      return lineUnits(l).some(u => (u.seat && av.seats.includes((l.slotId || '') + '|' + u.seat)) || (u.tt && +ev?.ticketTypes.find(t => t.id === u.tt)?.qty > 0 && (av.tt[u.tt] || 0) + 1 > +ev.ticketTypes.find(t => t.id === u.tt).qty)); });
    if (clash || ['cancelled', 'refunded'].includes(order.status)) {
      Object.assign(order, { status: 'refunded', payment: { ...order.payment, ...pay, refundedAt: nowIso(), note: 'Paid after the checkout expired and the seats were gone — refunded automatically' } });
      order.data.refunded = order.data.total; return 'refunded';
    }
  }
  Object.assign(order, { status: 'paid', paid_at: nowIso(), payment: { ...(order.payment || {}), ...pay } });
  if (pay.fee != null) order.data.processingFee = pay.fee;
  issueOrderTickets(st, order, { by: order.buyer_email });
  return 'issued';
}
// Card checkouts that ran out of time: release their seats / stock (logged on each seat).
function expireOrders(st, now = Date.now()) {
  let n = 0;
  for (const o of st.orders || []) if (o.status === 'awaiting_payment' && new Date(o.expires_at) <= now) {
    o.status = 'expired'; n++;
    for (const l of o.data.lines || []) for (const u of lineUnits(l)) if (u.seat) { const ev = st.events.find(e => e.id === l.eventId); if (ev) seatLog(ev, l.slotId, u.seat, 'released', `Checkout ${o.ref} expired unpaid — seat released`, { ref: o.ref, by: 'system' }); }
  }
  return n;
}
// what a buyer may see of their own order: never the platform's cut, the processor's cut or payment internals
function buyerOrder(o) {
  const { access_key, attempt_key, payment, ...order } = clone(o), { platformFee, processingFee, ...data } = order.data;
  return { ...order, data, paidWith: payment?.last4 ? `${payment.brand} •••• ${payment.last4}` : payment?.brand || null, failures: (payment?.attempts || []).filter(a => !a.ok).length };
}

const rowToEvent = r => ({ ...(r.data || {}), id: r.id, box_office_id: r.box_office_id, slug: r.slug, status: r.status, created_at: r.created_at, ...(r.secrets ? { secrets: r.secrets } : {}) });
const eventToRow = ev => { const { id, box_office_id, slug, status, secrets, created_at, ...data } = ev; return { id, box_office_id, slug, status, data, secrets: secrets || {}, updated_at: new Date().toISOString() }; };
const clone = o => JSON.parse(JSON.stringify(o));
const publicEvent = ev => { const { secrets, ...rest } = clone(ev); return rest; };
const publicBo = b => ({ id: b.id, slug: b.slug, name: b.name, status: b.status, branding: { ...DEFAULT_BRANDING, ...b.branding }, settings: { ...DEFAULT_SETTINGS, ...b.settings, name: b.name },
  gateway: b.gateway ? { provider: b.gateway.provider, status: b.gateway.status, test: !!b.gateway.test } : null, platformFee: b.platformFee || b.platform_fee || null });
// demo customer passwords: PBKDF2-SHA256, salted (LIVE: Supabase Auth stores them)
async function pwHash(pw, salt) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pw || '')), 'PBKDF2', false, ['deriveBits']);
  return b32enc(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, k, 256)));
}
async function must(p) { const { data, error } = await p; if (error) throw new Error(error.message); return data; }
const nowIso = () => new Date().toISOString();
// page views → {total, unique, today, last10m, bySrc}; hits = [[ms, visitor, src]]
function viewStats(v) {
  const hits = v?.hits || [], day0 = new Date().setHours(0, 0, 0, 0), bySrc = {};
  const byRef = {}; hits.forEach(h => { const k = h[2] || 'direct'; bySrc[k] = (bySrc[k] || 0) + 1; if (h[3]) { const r = byRef[h[3]] ||= { views: 0, v: new Set() }; r.views++; r.v.add(h[1]); } });
  return { total: hits.length, unique: new Set(hits.map(h => h[1])).size, today: hits.filter(h => h[0] >= day0).length, last10m: new Set(hits.filter(h => h[0] >= Date.now() - 6e5).map(h => h[1])).size, bySrc,
    byRef: Object.fromEntries(Object.entries(byRef).map(([k, r]) => [k, { views: r.views, unique: r.v.size }])) };
}
const MONEY_KEYS = ['subtotal', 'ticketsTotal', 'addonsTotal', 'discount', 'feeDiscount', 'fee', 'serviceFee', 'tax', 'donation', 'processing', 'processingFee', 'refunded', 'total', 'faceValue', 'platformFee'], LINE_MONEY = ['face', 'value', 'tfaces', 'discs', 'feeDiscs', 'disc', 'feeDisc', 'fee', 'unitFee'];
const maskEmail = e => String(e || '').replace(/^(.)[^@]*@(.)[^.]*(\..+)$/, '$1•••@$2•••$3');

/* ── DEMO "server": every organizer write passes need(), the same checks the SQL policies make in LIVE. ── */
function audit(kind, summary, o = {}) {
  const st = Demo.st; (st.audit ||= []).unshift({ id: uid(), at: nowIso(), actor: DB._actor || 'system', box_office_id: o.bo !== undefined ? o.bo : DB._bo || null,
    kind, summary, target: o.target || null, before: o.before ?? null, after: o.after ?? null });
  if (st.audit.length > 5000) st.audit.length = 5000;
}
function memberFor(st, email, boId) {
  const bo = st.boxOffices.find(b => b.id === boId); if (!bo) return null;
  const m = st.members.find(x => x.box_office_id === boId && x.email === email && x.status === 'active');
  return m ? { ...m, owner: bo.owner === email } : null;
}
function need(key, eventId) {
  if (LIVE) return null;  // LIVE: row-level security in Postgres is the gate
  const st = Demo.fresh(), email = DB._actor, bo = st.boxOffices.find(b => b.id === DB._bo);
  const me = DB._support && st.platform.admins.includes(email) ? { email, support: true } : memberFor(st, email, DB._bo);
  if (!me || !bo) throw Object.assign(new Error('Your access to this box office was removed.'), { revoked: true });
  if (bo.status !== 'active' && !me.support) throw Object.assign(new Error('This box office is ' + BO_STATUS[bo.status].toLowerCase() + '.'), { revoked: true });
  if (key && !hasPerm(me, key, eventId)) throw new Error('You don\'t have permission to do that (' + key + ')');
  return me;
}
const needSuper = () => { if (LIVE) return; if (!Demo.fresh().platform.admins.includes(DB._actor)) throw new Error('Platform super admins only'); };
function startDemoSession(email) {
  const st = Demo.st, s = { id: uid(), email, ua: navigator.userAgent.replace(/^Mozilla\/5\.0 \(([^)]*)\).*?(\w+)\/[\d.]+$/, '$1 · $2').slice(0, 90), created_at: nowIso(), last_seen: nowIso(), revoked: false };
  st.sessions = (st.sessions || []).filter(x => !x.revoked).concat(s); sessionStorage.setItem('set_demo_sid', s.id);
  DB._actor = email; audit('auth.login', 'Signed in', { bo: null }); Demo.save(); return { email, sid: s.id };
}
const EVENT_TRACKED = [['name', 'Name'], ['status', 'Status'], ['archived', 'Archived'], ['start', 'Start'], ['end', 'End'], ['allDay', 'All day'], ['venue', 'Venue'], ['address', 'Address'],
  ['online', 'Online'], ['capacity', 'Capacity'], ['visibility', 'Visibility'], ['publishAt', 'Scheduled publish'], ['salesStart', 'Sales open'], ['salesEnd', 'Sales close'],
  ['waitlistMode', 'Waitlist'], ['currency', 'Currency'], ['contact', 'Event contact'], ['policies', 'Policies']];
const priceSig = e => JSON.stringify([(e.ticketTypes || []).map(t => [t.id, +t.price || 0, t.phases || [], t.breaks || [], t.slotPrices || {}]), (e.addons || []).map(a => [a.id, +a.price || 0]), (e.bundles || []).map(b => [b.id, +b.price || 0])]);
const showtimeSig = s => [s.start, s.capacity, s.hidden ? 'hidden' : '', s.unavailable ? 'unavailable' : '', s.soldOut ? 'sold out' : ''].filter(x => x !== '').join(' · ');
function eventDiff(a, b) {
  const out = [], j = v => JSON.stringify(v ?? '');
  for (const [k, l] of EVENT_TRACKED) if (j(a?.[k]) !== j(b?.[k])) out.push([l, a?.[k] ?? '', b?.[k] ?? '']);
  const tt = e => Object.fromEntries((e?.ticketTypes || []).map(t => [t.id, t]));
  const ta = tt(a), tb = tt(b);
  for (const id of new Set([...Object.keys(ta), ...Object.keys(tb)])) {
    const x = ta[id], y = tb[id], n = (y || x).name;
    if (!x || !y) { out.push(['Ticket type · ' + n, x ? 'existed' : '', y ? 'added' : 'removed']); continue; }
    if (x.price !== y.price) out.push(['Price · ' + n, x.price, y.price]);
    if (+x.qty !== +y.qty) out.push(['Quantity · ' + n, x.qty, y.qty]);
    for (const k of ['name', 'hidden', 'adminOnly', 'group', 'salesStart', 'salesEnd', 'min', 'max']) if (j(x[k]) !== j(y[k])) out.push([`Ticket setting · ${n} · ${k}`, x[k] ?? '', y[k] ?? '']);
    for (const [k, l] of [['phases', 'price phases'], ['breaks', 'quantity pricing'], ['slotPrices', 'showtime prices']]) if (j(x[k] || null) !== j(y[k] || null)) out.push([`Pricing rule · ${n} · ${l}`, 'previous', 'changed']);
  }
  const named = (l, k) => (l || []).map(x => x.name + (k ? ' ' + money_(x[k]) : '')).join(', ');
  for (const [k, l] of [['addons', 'Products'], ['bundles', 'Bundles'], ['upsells', 'Upsells']]) if (j(a?.[k] || []) !== j(b?.[k] || []))
    out.push([l, k === 'upsells' ? (a?.[k] || []).length + ' offers' : named(a?.[k], 'price'), k === 'upsells' ? (b?.[k] || []).length + ' offers' : named(b?.[k], 'price')]);
  const sa = Object.fromEntries((a?.timeSlots || []).map(s => [s.id, showtimeSig(s)])), sb = Object.fromEntries((b?.timeSlots || []).map(s => [s.id, showtimeSig(s)]));
  for (const id of new Set([...Object.keys(sa), ...Object.keys(sb)])) if (sa[id] !== sb[id]) out.push(['Showtime', sa[id] || '(new)', sb[id] || '(removed)']);
  const sa2 = a?.seating || {}, sb2 = b?.seating || {}, changedKeys = (x, y) => [...new Set([...Object.keys(x || {}), ...Object.keys(y || {})])].filter(k => (x || {})[k] !== (y || {})[k]).length;
  if (!!sa2.enabled !== !!sb2.enabled) out.push(['Reserved seating', sa2.enabled ? 'on' : 'off', sb2.enabled ? 'on' : 'off']);
  if (j(sa2.sections) !== j(sb2.sections) || j(sa2.stage) !== j(sb2.stage) || j(sa2.levels) !== j(sb2.levels) || j(sa2.removed) !== j(sb2.removed) || j(sa2.labels) !== j(sb2.labels)) out.push(['Seating map', 'changed', '']);
  if (j(sa2.index) !== j(sb2.index)) out.push(['Seat prices', '', changedKeys(sa2.index, sb2.index) + ' seats changed']);
  if (j(sa2.areas) !== j(sb2.areas)) out.push(['Seating areas', '', changedKeys(sa2.areas, sb2.areas) + ' seats changed']);
  if (!!sa2.noSingles !== !!sb2.noSingles) out.push(['Single-seat gap rule', sa2.noSingles ? 'on' : 'off', sb2.noSingles ? 'on' : 'off']);
  if (!!a?.secrets?.password !== !!b?.secrets?.password) out.push(['Password', a?.secrets?.password ? 'on' : 'off', b?.secrets?.password ? 'on' : 'off']);
  return out.map(d => d[0] === 'Seating map' ? [d[0], 'previous layout', 'new layout'] : d);
}

const DB = {
  live: LIVE, _actor: null, _bo: null, _support: false,
  async init() {
    if (!LIVE) {
      const st = Demo.load(), act = new Set(st.boxOffices.filter(b => b.status === 'active').map(b => b.id));
      return { settings: { ...DEFAULT_SETTINGS }, events: st.events.map(normEvent).filter(e => eventListed(e) && act.has(e.box_office_id)).map(publicEvent),
        bos: st.boxOffices.filter(b => act.has(b.id)).map(publicBo), platform: { name: st.platform.name, publicRegistration: st.platform.publicRegistration, feePct: st.platform.feePct, feeFixed: st.platform.feeFixed, feePayer: st.platform.feePayer || 'organizer' } };
    }
    const [plat, bos, evs] = await Promise.all([must(sb.from('platform_public').select('*').maybeSingle()),
      must(sb.from('box_offices').select('id,slug,name,status,branding,settings,gateway,platform_fee').eq('status', 'active')),
      must(sb.from('events').select('id,box_office_id,slug,status,data,created_at').eq('status', 'published'))]);
    return { settings: { ...DEFAULT_SETTINGS }, events: evs.map(rowToEvent).map(normEvent), bos: bos.map(publicBo), platform: { ...DEFAULT_PLATFORM, ...(plat || {}) } };
  },
  // ── auth: email one-time code, then an authenticator-app code when 2FA is on ──
  async session() {
    if (!LIVE) {
      const sid = sessionStorage.getItem('set_demo_sid'), st = Demo.fresh(), s = (st.sessions || []).find(x => x.id === sid && !x.revoked);
      if (!s) return null; s.last_seen = nowIso(); Demo.save(); DB._actor = s.email; return { email: s.email, sid };
    }
    const { data } = await sb.auth.getSession(); if (!data.session) return null;
    const aal = (await sb.auth.mfa.getAuthenticatorAssuranceLevel()).data;
    DB._actor = data.session.user.email; return { email: data.session.user.email, mfa: aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2' };
  },
  async sendCode(email) {
    if (!LIVE) return;
    await must(sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname + '#/admin' } }));
  },
  async verifyCode(email, code) {
    email = email.trim().toLowerCase();
    if (!LIVE) { const st = Demo.fresh(); if (st.mfa?.[email]) return { email, mfa: true }; return startDemoSession(email); }
    await must(sb.auth.verifyOtp({ email, token: code, type: 'email' }));
    return this.session();
  },
  async verifyMfa(email, code) {
    email = email.trim().toLowerCase();
    if (!LIVE) {
      const st = Demo.fresh(), lk = (st.locks ||= {})[email] || { fails: 0, until: 0 };
      if (lk.until > Date.now()) throw new Error(`Too many attempts — try again in ${Math.ceil((lk.until - Date.now()) / 60000)} min`);
      if (!(await totpOk(st.mfa[email].secret, code))) {
        lk.fails++; if (lk.fails >= 5) { lk.until = Date.now() + 5 * 60000; lk.fails = 0; }
        st.locks[email] = lk; DB._actor = email; audit('auth.mfa_failed', 'Wrong two-factor code', { bo: null }); Demo.save();
        throw new Error('That code isn\'t right');
      }
      delete st.locks[email]; return startDemoSession(email);
    }
    const f = (await must(sb.auth.mfa.listFactors())).totp?.[0]; if (!f) throw new Error('No authenticator registered');
    await must(sb.auth.mfa.challengeAndVerify({ factorId: f.id, code: String(code).trim() })); return this.session();
  },
  async signOut() {
    if (!LIVE) { const st = Demo.fresh(), s = (st.sessions || []).find(x => x.id === sessionStorage.getItem('set_demo_sid')); if (s) { s.revoked = true; audit('auth.logout', 'Signed out', { bo: null }); Demo.save(); } sessionStorage.removeItem('set_demo_sid'); }
    else await sb.auth.signOut();
    DB._actor = DB._bo = null; DB._support = false;
  },
  async mfaStatus(email) {
    if (!LIVE) return !!Demo.fresh().mfa?.[email];
    return !!(await must(sb.auth.mfa.listFactors())).totp?.some(f => f.status === 'verified');
  },
  async mfaEnroll(email) {
    if (!LIVE) { const secret = b32enc(crypto.getRandomValues(new Uint8Array(20))); return { secret, uri: `otpauth://totp/SET:${encodeURIComponent(email)}?secret=${secret}&issuer=SET&digits=6&period=30` }; }
    const d = await must(sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'SET ' + new Date().toISOString().slice(0, 16) }));
    return { secret: d.totp.secret, uri: d.totp.uri, factorId: d.id };
  },
  async mfaConfirm(email, enr, code) {
    if (!LIVE) { if (!(await totpOk(enr.secret, code))) throw new Error('That code isn\'t right — check the time on your phone'); const st = Demo.fresh(); (st.mfa ||= {})[email] = { secret: enr.secret, at: nowIso() }; audit('security.mfa_on', 'Turned on two-factor sign-in', { bo: null }); Demo.save(); return; }
    await must(sb.auth.mfa.challengeAndVerify({ factorId: enr.factorId, code: String(code).trim() }));
  },
  async mfaDisable(email, code) {
    if (!LIVE) { const st = Demo.fresh(); if (!(await totpOk(st.mfa[email].secret, code))) throw new Error('That code isn\'t right'); delete st.mfa[email]; audit('security.mfa_off', 'Turned off two-factor sign-in', { bo: null }); Demo.save(); return; }
    for (const f of (await must(sb.auth.mfa.listFactors())).totp || []) await must(sb.auth.mfa.unenroll({ factorId: f.id }));
  },
  async sessions(email) { if (!LIVE) return clone((Demo.fresh().sessions || []).filter(s => s.email === email && !s.revoked)); return null; },
  async revokeSession(id) { if (!LIVE) { const st = Demo.fresh(), s = st.sessions.find(x => x.id === id && x.email === DB._actor); if (s) { s.revoked = true; audit('security.session_revoked', 'Signed out a device', { bo: null }); Demo.save(); } } },
  async revokeOtherSessions() {
    if (!LIVE) { const st = Demo.fresh(), me = sessionStorage.getItem('set_demo_sid'); st.sessions.forEach(s => { if (s.email === DB._actor && s.id !== me) s.revoked = true; }); audit('security.session_revoked', 'Signed out all other devices', { bo: null }); Demo.save(); return; }
    await must(sb.auth.signOut({ scope: 'others' }));
  },
  // ── organizer data: everything is scoped to ONE box office and to the events this member may see ──
  async loadAdmin(email, boId, support = false) {
    email = email.toLowerCase(); DB._actor = email;
    if (LIVE) {
      const r = await must(sb.rpc('admin_load', { p_bo: boId || null, p_support: support })); r.events = (r.events || []).map(rowToEvent);
      if (r.bo) r.bo = { ...r.bo, platformFee: r.bo.platform_fee || null, templates: r.bo.templates?.length ? r.bo.templates : DEFAULT_TEMPLATES, branding: { ...DEFAULT_BRANDING, ...r.bo.branding }, settings: { ...DEFAULT_SETTINGS, ...r.bo.settings, name: r.bo.name } };
      DB._bo = r.bo?.id || null; DB._support = !!r.me?.support; return r;
    }
    const st = Demo.fresh(), isSuper = st.platform.admins.includes(email);
    if (expireOrders(st)) Demo.save();
    let mine = st.members.filter(m => m.email === email && m.status === 'active');
    if (!mine.length && !isSuper) {  // demo convenience: a new email gets an admin seat on the first sample box office
      const bo = st.boxOffices[0]; mine = [{ id: uid(), box_office_id: bo.id, email, name: email.split('@')[0], perms: [...ALL_PERMS], template: 'full', events: 'all', status: 'active', created_at: nowIso(), added_by: 'demo' }];
      st.members.push(mine[0]); Demo.save();
    }
    const bos = st.boxOffices.filter(b => mine.some(m => m.box_office_id === b.id)).map(b => ({ id: b.id, name: b.name, slug: b.slug, status: b.status }));
    let bo = support && isSuper ? st.boxOffices.find(b => b.id === boId) : null;
    const me = bo ? { email, name: 'Platform support', support: true, perms: [...ALL_PERMS], events: 'all' } : null;
    if (me) { DB._bo = bo.id; audit('support.access', 'Platform support opened this box office'); Demo.save(); }  // every support visit is on the record
    if (!bo) bo = st.boxOffices.find(b => b.id === (bos.find(x => x.id === boId) || bos[0])?.id);
    DB._bo = bo?.id || null; DB._support = !!me;
    if (!bo) return { super: isSuper, bos, bo: null, me: null };
    const m = me || memberFor(st, email, bo.id);
    if (bo.status !== 'active' && !m.support) return { super: isSuper, bos, bo: publicBo(bo), me: m, blocked: bo.status };
    if (bo.settings?.require2fa && !m.support && !st.mfa?.[email])  // nothing leaves the "server" until 2FA is set up
      return { super: isSuper, bos, me: m, needs2fa: true, bo: publicBo(bo), events: [], orders: [], tickets: [], waitlist: [], team: [m], broadcasts: [], audit: [], seatStatus: [], seatLog: [], promos: [], tracking: [], outbox: [] };
    const P = k => hasPerm(m, k);
    const events = st.events.filter(e => e.box_office_id === bo.id && (m.owner || m.support || m.events === 'all' || (m.events || []).includes(e.id)));
    const evIds = new Set(events.map(e => e.id));
    const seeOrders = P('orders.view') || P('finance.totals') || P('finance.reports') || P('comms.lists') || P('customers.profiles');
    events.forEach(normEvent);
    const orders = seeOrders ? clone(st.orders.filter(o => o.box_office_id === bo.id && o.event_ids.some(id => evIds.has(id)))) : [];
    const tickets = clone(st.tickets.filter(t => evIds.has(t.event_id)));
    // Customer-data and money permissions are applied here, before data leaves the "server".
    if (!P('customers.names')) { orders.forEach(o => o.data.buyer.name = 'Guest'); tickets.forEach(t => t.holder = 'Guest'); }
    if (!P('customers.emails')) orders.forEach(o => { o.buyer_email = maskEmail(o.buyer_email); o.data.buyer.email = o.buyer_email; });
    if (!P('customers.phones')) orders.forEach(o => { if (o.data.buyer.phone) o.data.buyer.phone = '•••'; });
    if (!P('finance.processing')) orders.forEach(o => { if (o.payment) o.payment = { provider: o.payment.provider }; delete o.data.processingFee; });
    if (!P('finance.fees')) orders.forEach(o => delete o.data.platformFee);
    if (!P('finance.totals')) {
      orders.forEach(o => { for (const k of MONEY_KEYS) o.data[k] = null; o.data.lines.forEach(l => { for (const k of LINE_MONEY) delete l[k]; l.unit = null; }); });
      tickets.forEach(t => { t.face = t.paid = t.discount = null; });
    }
    const full = clone({ ...bo, templates: bo.templates?.length ? bo.templates : DEFAULT_TEMPLATES });
    return { super: isSuper, bos, me: m, bo: { ...full, branding: { ...DEFAULT_BRANDING, ...full.branding }, settings: { ...DEFAULT_SETTINGS, ...full.settings, name: bo.name } },
      events: clone(events), orders, tickets,
      waitlist: P('orders.view') || P('comms.lists') ? clone(st.waitlist.filter(w => evIds.has(w.event_id))) : [],
      team: P('admin.invite') || P('admin.perms') || P('admin.remove') ? clone(st.members.filter(x => x.box_office_id === bo.id && x.status === 'active')).map(x => ({ ...x, owner: x.email === bo.owner })) : [{ ...m }],
      broadcasts: P('comms.email') || P('comms.notify') ? clone(st.broadcasts.filter(b => evIds.has(b.event_id))) : [],
      audit: clone(st.audit.filter(a => a.box_office_id === bo.id && (P('admin.perms') || a.actor === email || (a.target && hasPerm(m, 'events.edit', a.target)))).slice(0, 1500)),
      views: Object.fromEntries([...evIds].map(id => [id, viewStats(st.views?.[id])])),
      seatStatus: clone((st.seatStatus || []).filter(r => evIds.has(r.event_id))).map(({ token, ...r }) => r),  // buyers' hold tokens never leave the server
      seatLog: P('seating.view') ? clone((st.seatLog || []).filter(r => evIds.has(r.event_id)).slice(0, 8000)) : [],
      promos: P('tickets.discounts') || P('tickets.discountsEdit') || P('finance.reports') ? clone((st.promos || []).filter(x => x.box_office_id === bo.id)) : [],
      tracking: P('tickets.tracking') || P('finance.reports') ? clone((st.tracking || []).filter(x => x.box_office_id === bo.id)) : [],
      outbox: P('orders.view') ? clone((st.outbox || []).filter(x => x.box_office_id === bo.id)) : [] };
  },
  async stillAllowed() { if (LIVE) return true; try { need(); return true; } catch (e) { return !e.revoked; } },
  async saveEvent(ev) {
    if (!LIVE) {
      const st = Demo.st, i = st.events.findIndex(e => e.id === ev.id), prev = i >= 0 ? st.events[i] : null;
      need(prev ? 'events.edit' : 'events.create', prev ? ev.id : null);
      if (prev && prev.status !== ev.status) need('events.publish', ev.id);
      if (prev && priceSig(prev) !== priceSig(ev)) need('tickets.pricing', ev.id);  // prices, price rules, product and bundle prices
      if (prev && prev.box_office_id !== DB._bo) throw new Error('not allowed');
      const row = clone({ ...ev, box_office_id: DB._bo }), diff = eventDiff(prev, row);
      if (prev && row.seating?.enabled) {  // a layout edit can never delete a seat somebody holds a ticket for
        const lost = st.tickets.filter(t => t.event_id === ev.id && t.status === 'valid' && t.seat && !row.seating.meta?.[t.seat]);
        if (lost.length) throw new Error(`${lost.length} sold seat${lost.length === 1 ? '' : 's'} would disappear from the map (${[...new Set(lost.map(t => t.seat))].slice(0, 4).join(', ')}). Move those customers first, or block the seats instead.`);
        if (prev.seating?.enabled) logSeatEdits(prev, row);
      }
      if (i >= 0) st.events[i] = row; else st.events.push(row);
      if (prev && !!prev.archived !== !!row.archived) need('events.publish', ev.id);
      if (!prev) audit('event.created', 'Created event “' + row.name + '”', { target: row.id });
      else if (diff.length) audit('event.updated', 'Updated “' + row.name + '”: ' + [...new Set(diff.map(d => d[0].split(' · ')[0]))].join(', '), { target: row.id, before: Object.fromEntries(diff.map(d => [d[0], d[1]])), after: Object.fromEntries(diff.map(d => [d[0], d[2]])) });
      Demo.save(); return row;
    }
    const row = eventToRow({ ...ev, box_office_id: ev.box_office_id || DB._bo }); if (!row.id) delete row.id;
    return rowToEvent(await must(sb.from('events').upsert(row).select().single()));
  },
  async deleteEvent(id) {
    if (!LIVE) {
      const st = Demo.st, ev = st.events.find(e => e.id === id); need('events.publish', id);
      if (st.orders.some(o => o.event_ids.includes(id))) throw new Error('This event has orders — cancel it instead, so its sales history is kept');
      st.events = st.events.filter(e => e.id !== id); st.tickets = st.tickets.filter(t => t.event_id !== id); audit('event.deleted', 'Deleted draft “' + ev.name + '”'); Demo.save(); return;
    }
    await must(sb.from('events').delete().eq('id', id));
  },
  async saveBoxOffice(patch) {
    if (!LIVE) {
      const st = Demo.st, bo = st.boxOffices.find(b => b.id === DB._bo); need('admin.settings');
      const changed = Object.keys(patch).filter(k => JSON.stringify(bo[k]) !== JSON.stringify(patch[k]));
      Object.assign(bo, clone(patch)); if (patch.name) bo.settings = { ...bo.settings, name: patch.name };
      if (changed.length) audit('settings.updated', 'Changed box office ' + changed.join(', ')); Demo.save(); return clone(bo);
    }
    return must(sb.from('box_offices').update(patch).eq('id', DB._bo).select().single());
  },
  async saveTemplates(templates) {
    if (!LIVE) { const st = Demo.st, bo = st.boxOffices.find(b => b.id === DB._bo); need('admin.perms'); bo.templates = clone(templates); audit('team.templates', 'Edited permission templates'); Demo.save(); return; }
    await must(sb.from('box_offices').update({ templates }).eq('id', DB._bo));
  },
  async setOrderStatus(id, status) {
    const cancel = ['cancelled', 'refunded'].includes(status);
    if (!LIVE) {
      const o = Demo.st.orders.find(x => x.id === id && x.box_office_id === DB._bo); if (!o) throw new Error('Order not found');
      need({ refunded: 'orders.refund', cancelled: 'orders.cancel' }[status] || 'orders.edit', o.event_ids[0]);
      const was = o.status; o.status = status;
      if (status === 'paid' && was !== 'paid') { o.paid_at = nowIso(); o.payment = { ...(o.payment || {}), markedPaidBy: DB._actor }; issueOrderTickets(Demo.st, o, { manual: true, by: DB._actor }); }  // staff confirm the money arrived
      if (status === 'refunded') o.data.refunded = o.data.total;
      if (cancel) Demo.st.tickets.forEach(t => { if (t.order_id !== id) return;
        if (t.status === 'valid' && t.seat) seatLog(Demo.st.events.find(e => e.id === t.event_id), t.slot_id, t.seat, 'cancelled', `Order ${o.ref} ${status} — seat released`, { ref: o.ref });
        t.status = 'cancelled'; });
      audit('order.' + status, `Order ${o.ref}: ${was} → ${status}`, { target: o.event_ids[0], before: { status: was }, after: { status } }); Demo.save(); return;
    }
    await must(sb.from('orders').update({ status }).eq('id', id));
    if (cancel) await must(sb.from('tickets').update({ status: 'cancelled' }).eq('order_id', id));
  },
  // eventId (optional): the event being scanned — a valid ticket for another event is rejected, not checked in.
  async checkin(code, undo = false, eventId = null) {
    if (!LIVE) {
      const t = Demo.st.tickets.find(x => x.code === String(code).trim().toUpperCase() && x.box_office_id === DB._bo);
      if (!t) { need('door.scan'); return { result: 'unknown' }; }   // another box office's ticket looks exactly like a fake one
      need(undo ? 'door.undo' : 'door.checkin', t.event_id);
      if (t.status !== 'valid') return { result: 'cancelled', ticket: clone(t) };
      if (eventId && t.event_id !== eventId) return { result: 'wrong_event', ticket: clone(t) };
      const was = t.checked_in_at; t.checked_in_at = undo ? null : (t.checked_in_at || nowIso());
      if (undo) audit('door.undo', 'Undid check-in for ticket ' + t.code, { target: t.event_id }); Demo.save();
      return { result: undo ? 'undone' : was ? 'already' : 'ok', ticket: clone(t) };
    }
    return must(sb.rpc('checkin', { p_code: code, p_undo: undo, p_event: eventId }));
  },
  // ── team ──
  async saveMember(m) {
    if (!LIVE) {
      const st = Demo.st, bo = st.boxOffices.find(b => b.id === DB._bo), prev = st.members.find(x => x.box_office_id === bo.id && x.email === m.email && x.status === 'active');
      const me = need(prev ? 'admin.perms' : 'admin.invite');
      if (prev && bo.owner === m.email) throw new Error('The owner always has full access');
      if (prev && prev.email === DB._actor && !me.support) throw new Error('You can\'t change your own permissions');
      const extra = (m.perms || []).filter(k => !hasPerm(me, k));
      if (extra.length) throw new Error('You can only grant permissions you have yourself');
      const row = { id: prev?.id || uid(), box_office_id: bo.id, email: m.email, name: m.name || prev?.name || '', perms: [...new Set(m.perms)].filter(k => ALL_PERMS.includes(k)),
        template: m.template || null, events: m.events === 'all' ? 'all' : [...(m.events || [])].filter(id => st.events.some(e => e.id === id && e.box_office_id === bo.id)),
        status: 'active', created_at: prev?.created_at || nowIso(), added_by: prev?.added_by || DB._actor };
      const before = prev && { perms: prev.perms, events: prev.events };
      if (prev) Object.assign(prev, row); else st.members.push(row);
      if (!prev) audit('team.invited', `Invited ${row.email} (${row.perms.length} permissions)`, { after: { perms: row.perms, events: row.events } });
      else {
        const add = row.perms.filter(k => !before.perms.includes(k)), rm = before.perms.filter(k => !row.perms.includes(k)), evChg = JSON.stringify(before.events) !== JSON.stringify(row.events);
        if (add.length || rm.length || evChg) audit('team.permissions', `Changed ${row.email}: ` + [add.length && '+' + add.length + ' granted', rm.length && '−' + rm.length + ' removed', evChg && 'event access changed'].filter(Boolean).join(', '),
          { before, after: { perms: row.perms, events: row.events } });
      }
      Demo.save(); return clone(row);
    }
    const all = m.events === 'all';
    return must(sb.from('members').upsert({ box_office_id: DB._bo, email: m.email, name: m.name, perms: m.perms, template: m.template || null, all_events: all, event_ids: all ? [] : m.events, status: 'active' }, { onConflict: 'box_office_id,email' }).select().single());
  },
  async removeMember(email) {
    if (!LIVE) {
      const st = Demo.st, bo = st.boxOffices.find(b => b.id === DB._bo); need('admin.remove');
      if (bo.owner === email) throw new Error('Transfer ownership before removing the owner');
      const m = st.members.find(x => x.box_office_id === bo.id && x.email === email && x.status === 'active'); if (!m) return;
      m.status = 'removed'; m.removed_at = nowIso(); m.removed_by = DB._actor;
      audit('team.removed', 'Removed ' + email + ' — access revoked immediately', { before: { perms: m.perms } }); Demo.save(); return;
    }
    await must(sb.from('members').update({ status: 'removed' }).eq('box_office_id', DB._bo).eq('email', email));
  },
  async transferOwnership(email) {
    if (!LIVE) {
      const st = Demo.fresh(), bo = st.boxOffices.find(b => b.id === DB._bo), me = need();
      if (bo.owner !== DB._actor && !me.support) throw new Error('Only the current owner can transfer ownership');
      const m = st.members.find(x => x.box_office_id === bo.id && x.email === email && x.status === 'active'); if (!m) throw new Error('Pick an active team member');
      const was = bo.owner; bo.owner = email; m.perms = [...ALL_PERMS]; m.template = 'full'; m.events = 'all';
      audit('team.owner', `Ownership transferred from ${was} to ${email}`, { before: { owner: was }, after: { owner: email } }); Demo.save(); return;
    }
    await must(sb.rpc('transfer_ownership', { p_bo: DB._bo, p_email: email }));
  },
  // ── events (Stage 2) ──
  async eventBySlug(slug) {   // direct-link-only events aren't in the public list; fetch one by its link
    if (!LIVE) { const st = Demo.fresh(), act = new Set(st.boxOffices.filter(b => b.status === 'active').map(b => b.id)); const e = st.events.find(x => x.slug === slug); return e && act.has(e.box_office_id) && eventLive(normEvent(e)) ? publicEvent(e) : null; }
    const r = await must(sb.rpc('event_by_slug', { p_slug: slug })); return r ? normEvent(rowToEvent(r)) : null;
  },
  async trackView(eventId, src, ref) {  // ref = tracking code from a ?ref= link
    let vid = ''; try { vid = localStorage.getItem('set_vid') || uid(); localStorage.setItem('set_vid', vid); } catch (e) { vid = uid(); }
    ref = String(ref || '').trim().toUpperCase().slice(0, 40);
    if (!LIVE) { const st = Demo.st, v = ((st.views ||= {})[eventId] ||= { hits: [] }); v.hits.push([Date.now(), vid.slice(0, 8), src || '', ...(ref ? [ref] : [])]); if (v.hits.length > 20000) v.hits.splice(0, 5000); Demo.save(); return; }
    sb.rpc('track_view', { p_event: eventId, p_visitor: vid, p_src: src || null, p_ref: ref || null }).then(() => { }, () => { });
  },
  async saveEventTemplates(list) {
    if (!LIVE) { need('events.create'); const bo = Demo.st.boxOffices.find(b => b.id === DB._bo); bo.eventTemplates = clone(list); audit('event.templates', 'Edited event templates'); Demo.save(); return; }
    await must(sb.rpc('save_event_templates', { p_bo: DB._bo, p: list }));
  },
  async notifyWaitlist(eventId, message) {
    if (!LIVE) {
      need('comms.notify', eventId); const st = Demo.st, list = st.waitlist.filter(w => w.event_id === eventId && !w.notified_at), at = nowIso();
      list.forEach(w => w.notified_at = at);
      st.broadcasts.push({ id: uid(), box_office_id: DB._bo, event_id: eventId, subject: 'Tickets available', body: message, recipients: list.length, created_by: DB._actor, created_at: at, kind: 'waitlist' });
      audit('comms.waitlist', `Notified ${list.length} people on the waitlist`, { target: eventId }); Demo.save(); return list.length;
    }
    return must(sb.rpc('notify_waitlist', { p_event: eventId, p_message: message }));
  },
  async log(kind, summary) { if (!LIVE) { audit(kind, summary); Demo.save(); return; } await sb.from('audit_log').insert({ actor: DB._actor, box_office_id: DB._bo, kind, summary }); },
  async addBroadcast(b) {
    if (!LIVE) { need('comms.email', b.event_id); const row = { id: uid(), created_at: nowIso(), ...b }; Demo.st.broadcasts.push(row); audit('comms.broadcast', 'Sent “' + b.subject + '” to ' + b.recipients); Demo.save(); return row; }
    return must(sb.from('broadcasts').insert({ ...b, box_office_id: DB._bo }).select().single());
  },
  // ── platform super admin ──
  async loadPlatform() {
    if (LIVE) { const r = await must(sb.rpc('platform_overview')); r.bos.forEach(b => b.platformFee = b.platform_fee || null); return r; }
    needSuper(); const st = Demo.st;
    const bos = st.boxOffices.map(b => {
      const os = st.orders.filter(o => o.box_office_id === b.id && ['paid', 'pending'].includes(o.status));
      return { ...clone(b), stats: { events: st.events.filter(e => e.box_office_id === b.id).length, orders: os.length,
        gross: os.reduce((t, o) => t + (+o.data.total || 0), 0), platformFees: os.reduce((t, o) => t + (+o.data.platformFee || 0), 0),
        tickets: st.tickets.filter(t => t.box_office_id === b.id && t.status === 'valid').length,
        staff: st.members.filter(m => m.box_office_id === b.id && m.status === 'active').length,
        lastSale: os.map(o => o.created_at).sort().pop() || null } };
    });
    return { platform: clone(st.platform), bos, audit: clone(st.audit.slice(0, 600)),
      orders: clone(st.orders.map(o => ({ box_office_id: o.box_office_id, status: o.status, created_at: o.created_at, total: o.data.total, platformFee: o.data.platformFee || 0 }))) };
  },
  async savePlatform(p) {
    if (!LIVE) { needSuper(); const st = Demo.st; st.platform = { ...st.platform, ...clone(p), admins: [...new Set((p.admins || st.platform.admins).map(e => e.trim().toLowerCase()).filter(Boolean))] }; if (!st.platform.admins.includes(DB._actor)) st.platform.admins.push(DB._actor); audit('platform.settings', 'Changed platform settings', { bo: null }); Demo.save(); return clone(st.platform); }
    await must(sb.rpc('platform_save', { p }));
  },
  async createBoxOffice({ name, slug, ownerEmail, ownerName }, pending = false) {
    if (!name?.trim()) throw new Error('Enter the box office name'); if (!EMAIL_RE.test(ownerEmail || '')) throw new Error('Enter the owner\'s email');
    if (LIVE) return must(sb.rpc(pending ? 'register_box_office' : 'create_box_office', { p_name: name, p_slug: slug, p_owner: ownerEmail, p_owner_name: ownerName || '' }));
    const st = Demo.fresh(); if (!pending) needSuper(); else if (!st.platform.publicRegistration) throw new Error('Registration is closed');
    slug = slugify(slug || name); if (st.boxOffices.some(b => b.slug === slug)) slug += '-' + randCode(3).toLowerCase();
    const email = ownerEmail.trim().toLowerCase(), bo = { id: uid(), slug, name: name.trim(), status: pending ? 'pending' : 'active', owner: email, created_at: nowIso(), created_by: pending ? 'self-registration' : DB._actor,
      branding: { ...DEFAULT_BRANDING }, settings: { ...DEFAULT_SETTINGS, name: name.trim(), contactEmail: email }, templates: clone(DEFAULT_TEMPLATES) };
    st.boxOffices.push(bo); st.members.push({ id: uid(), box_office_id: bo.id, email, name: ownerName || email.split('@')[0], perms: [...ALL_PERMS], template: 'full', events: 'all', status: 'active', created_at: nowIso(), added_by: bo.created_by });
    audit(pending ? 'platform.registered' : 'platform.created', (pending ? 'Registration request: ' : 'Created box office ') + bo.name, { bo: bo.id }); Demo.save(); return clone(bo);
  },
  async setBoxOfficeStatus(id, status) {
    if (LIVE) return must(sb.rpc('set_box_office_status', { p_bo: id, p_status: status }));
    needSuper(); const bo = Demo.st.boxOffices.find(b => b.id === id), was = bo.status; bo.status = status;
    audit('platform.status', `${bo.name}: ${BO_STATUS[was]} → ${BO_STATUS[status]}`, { bo: id, before: { status: was }, after: { status } }); Demo.save();
  },
  async deleteBoxOffice(id) {
    if (LIVE) return must(sb.rpc('delete_box_office', { p_bo: id }));
    needSuper(); const st = Demo.st, bo = st.boxOffices.find(b => b.id === id);
    if (bo.status !== 'deactivated') throw new Error('Deactivate the box office first');
    if (st.orders.some(o => o.box_office_id === id)) throw new Error('It has order history — it stays deactivated so its records are kept');
    st.boxOffices = st.boxOffices.filter(b => b.id !== id); st.events = st.events.filter(e => e.box_office_id !== id); st.members = st.members.filter(m => m.box_office_id !== id);
    audit('platform.deleted', 'Permanently deleted box office ' + bo.name, { bo: null }); Demo.save();
  },
  // ── buyer-facing ──
  async availability(eventId) {
    if (!LIVE) { const st = Demo.fresh(); if (expireOrders(st)) Demo.save(); return availabilityFrom(st.tickets, eventId, st.seatStatus, this.holdToken(), st.orders); }
    return must(sb.rpc('availability', { p_event: eventId, p_token: this.holdToken() }));
  },
  // This browser's checkout-hold id: seats picked here are held for HOLD_MINUTES while the buyer checks out.
  holdToken() { try { let t = localStorage.getItem('set_hold'); if (!t) localStorage.setItem('set_hold', t = uid()); return t; } catch (e) { return this._ht ||= uid(); } },
  async holdSeats(eventId, slotId, seats) {
    const token = this.holdToken();
    if (LIVE) return must(sb.rpc('hold_seats', { p_event: eventId, p_slot: slotId || '', p_seats: seats, p_token: token }));
    const st = Demo.fresh(), ev = st.events.find(e => e.id === eventId);
    if (!ev || !eventLive(normEvent(ev))) throw new Error('Event is not on sale');
    if (!ev.seating?.enabled) return null;
    if (seats.length > 10) throw new Error('Maximum 10 seats per order');
    const states = seatStates(ev, { tickets: st.tickets, statuses: st.seatStatus, orders: st.orders, slotId, token });
    for (const id of seats) { const x = states.get(id); if (!x || x.state !== 'available') throw new Error(x?.state === 'checkout' ? `${seatText(ev, id)} is being held by another buyer — try again in a few minutes` : `${seatText(ev, id)} is no longer available`); }
    if (ev.seating.noSingles) { const g = singleGaps(ev, id => states.get(id)?.state === 'available', seats); if (g.length) throw new Error(gapMsg(ev, g)); }
    const expires = new Date(Date.now() + HOLD_MINUTES * 6e4).toISOString();
    st.seatStatus = (st.seatStatus || []).filter(r => !(r.status === 'checkout' && r.token === token && r.event_id === eventId)).concat(
      seats.map(seat => ({ id: uid(), box_office_id: ev.box_office_id, event_id: eventId, slot_id: slotId || '', seat, status: 'checkout', note: '', by: 'buyer', at: nowIso(), expires_at: expires, token })));
    Demo.save(); return { expires };
  },
  async releaseSeats(eventId) {
    const token = this.holdToken();
    if (LIVE) return must(sb.rpc('release_seats', { p_event: eventId, p_token: token }));
    const st = Demo.fresh(); st.seatStatus = (st.seatStatus || []).filter(r => !(r.status === 'checkout' && r.token === token && (!eventId || r.event_id === eventId))); Demo.save();
  },
  // Staff seat management (Eli Step 3 §10) — any number of seats in one go. slotId '' = every showtime.
  // action: block | unblock | hold | release | unavailable | available | price {ttId} | area {area} | move {to}
  async seatAction(eventId, slotId, action, seats, o = {}) {
    if (LIVE) return must(sb.rpc('seat_action', { p_event: eventId, p_slot: slotId || '', p_action: action, p_seats: seats, p: o }));
    const PERM = { block: 'seating.block', hold: 'seating.block', unblock: 'seating.unblock', release: 'seating.unblock', unavailable: 'seating.edit', available: 'seating.edit', price: 'seating.edit', area: 'seating.edit', move: 'seating.move' };
    if (!PERM[action]) throw new Error('Unknown seat action');
    need(PERM[action], eventId); if (action === 'price') need('tickets.pricing', eventId);
    const st = Demo.st, ev = st.events.find(e => e.id === eventId && e.box_office_id === DB._bo); if (!ev?.seating?.enabled) throw new Error('Event not found');
    seats = [...new Set(seats)].filter(id => ev.seating.meta?.[id]); if (!seats.length) throw new Error('Select at least one seat');
    const slot = slotId || '', scope = slot ? 'this showtime' : (ev.timeSlots || []).length ? 'every showtime' : '', st2 = st.seatStatus ||= [];
    const label = { block: 'Blocked', hold: 'Held', unavailable: 'Made unavailable', unblock: 'Unblocked', release: 'Released', available: 'Made available' };
    if (['block', 'hold', 'unavailable'].includes(action)) {
      const status = action === 'hold' ? 'held' : action === 'block' ? 'blocked' : 'unavailable';
      st.seatStatus = st2.filter(r => !(r.event_id === eventId && (r.slot_id || '') === slot && seats.includes(r.seat) && r.status !== 'checkout'));
      for (const seat of seats) { st.seatStatus.push({ id: uid(), box_office_id: ev.box_office_id, event_id: eventId, slot_id: slot, seat, status, note: String(o.note || '').slice(0, 200), by: DB._actor, at: nowIso() });
        seatLog(ev, slot, seat, status === 'held' ? 'held' : status, [label[action], scope && 'for ' + scope, o.note && '— ' + o.note].filter(Boolean).join(' ')); }
    } else if (['unblock', 'release', 'available'].includes(action)) {
      const kinds = { unblock: ['blocked'], release: ['held', 'checkout'], available: ['unavailable'] }[action];
      st.seatStatus = st2.filter(r => !(r.event_id === eventId && seats.includes(r.seat) && kinds.includes(r.status) && (r.slot_id === '' || (r.slot_id || '') === slot)));
      for (const seat of seats) if (st2.some(r => r.event_id === eventId && r.seat === seat && kinds.includes(r.status) && (r.slot_id === '' || (r.slot_id || '') === slot))) seatLog(ev, slot, seat, action === 'release' ? 'released' : action, label[action]);
    } else if (action === 'price' || action === 'area') {
      const se = ev.seating, L = seatLayout(se), byId = new Map(L.seats.map(p => [p.id, p]));
      if (action === 'price' && o.ttId && !ev.ticketTypes.some(t => t.id === o.ttId)) throw new Error('Unknown price level');
      const before = clone(ev);
      for (const id of seats) { const p = byId.get(id); if (!p) continue;
        if (action === 'price') { if (!o.ttId || o.ttId === p.sec.ticketTypeId) delete (se.prices ||= {})[id]; else (se.prices ||= {})[id] = o.ttId; }
        else { const a = String(o.area || '').trim().slice(0, 60); if (!a || a === (p.sec.area || p.sec.name)) delete (se.areas ||= {})[id]; else (se.areas ||= {})[id] = a; } }
      Object.assign(se, seatDerive(se)); logSeatEdits(before, ev);
    } else if (action === 'move') {
      const to = o.to, from = seats[0], t = st.tickets.find(x => x.event_id === eventId && x.status === 'valid' && x.seat === from && (x.slot_id || '') === slot);
      if (!t) throw new Error('That seat has no ticket to move'); if (!ev.seating.meta?.[to]) throw new Error('Choose the new seat');
      const x = seatStates(ev, { tickets: st.tickets, statuses: st.seatStatus, slotId: slot }).get(to);
      if (!x || !['available', 'held'].includes(x.state)) throw new Error(`${seatText(ev, to)} isn't free`);
      if (ev.seating.index[to] !== t.ticket_type_id) throw new Error('That seat is a different price level — changing price (upgrade / downgrade) comes with order editing in Stage 6');
      const ord = st.orders.find(z => z.id === t.order_id), inf = seatInfo(ev, to);
      Object.assign(t, { seat: to, area: inf.area, row: inf.row, seat_label: inf.seat });
      ord?.data.lines.forEach(l => { if (l.eventId === eventId && l.seats?.includes(from)) l.seats = l.seats.map(z => z === from ? to : z); });
      st.seatStatus = st.seatStatus.filter(r => !(r.event_id === eventId && r.seat === to && r.status === 'held' && [slot, ''].includes(r.slot_id || '')));
      seatLog(ev, slot, from, 'moved', `${t.holder} moved to ${seatText(ev, to)} — seat released`, { ref: ord?.ref }); seatLog(ev, slot, to, 'moved', `${t.holder} moved here from ${seatText(ev, from)}`, { ref: ord?.ref });
    }
    audit('seats.' + action, `${{ price: 'Changed price of', area: 'Changed seating area of', move: 'Moved a customer from' }[action] || label[action]} ${action === 'move' ? seatText(ev, seats[0]) + ' to ' + seatText(ev, o.to) : seats.length + ' seat' + (seats.length === 1 ? '' : 's')}${scope ? ' (' + scope + ')' : ''} — ${ev.name}`, { target: eventId });
    Demo.save();
  },
  // Master venue charts: a library on the box office. Attaching one to an event copies it, so later edits never touch other events.
  // ── Promo + tracking codes (Stage 4): box-office wide, targeted by event / showtime / ticket type / area / price / product / bundle ──
  async savePromo(pr) {
    if (LIVE) return must(sb.rpc('save_promo', { p_bo: DB._bo, p: pr }));
    const st = Demo.st, list = st.promos ||= [], i = list.findIndex(x => x.id === pr.id && x.box_office_id === DB._bo);
    need(i >= 0 ? 'tickets.discountsEdit' : 'tickets.discounts');
    const row = clone({ ...pr, box_office_id: DB._bo, code: String(pr.code || '').trim().toUpperCase(), codes: [...new Set((pr.codes || []).map(c => String(c).trim().toUpperCase()).filter(Boolean))] });
    codeClash(st, row.code, row.codes, row.id);
    if (!['pct', 'fixed', 'order'].includes(row.type)) throw new Error('Choose a discount type');
    if (row.type === 'pct' && !(+row.amount > 0 && +row.amount <= 100)) throw new Error('Percent must be between 1 and 100');
    if (row.type !== 'pct' && !(+row.amount > 0)) throw new Error('Enter the discount amount');
    if (i >= 0) { row.created_at = list[i].created_at; row.created_by = list[i].created_by; list[i] = row; } else { row.created_at = nowIso(); row.created_by = DB._actor; list.push(row); }
    audit(i >= 0 ? 'promo.updated' : 'promo.created', `${i >= 0 ? 'Updated' : 'Created'} promo code ${row.code}${row.codes.length ? ` (+${row.codes.length} unique codes)` : ''}`); Demo.save(); return clone(row);
  },
  async deletePromo(id) {
    if (LIVE) return must(sb.rpc('delete_promo', { p_bo: DB._bo, p_id: id }));
    const st = Demo.st, pr = (st.promos || []).find(x => x.id === id && x.box_office_id === DB._bo); need('tickets.discountsEdit'); if (!pr) return;
    if (st.orders.some(o => o.data.promo?.id === id)) throw new Error('This code has been used — switch it off instead, so its report is kept');
    st.promos = st.promos.filter(x => x !== pr); audit('promo.deleted', 'Deleted promo code ' + pr.code); Demo.save();
  },
  async saveTracking(t) {
    if (LIVE) return must(sb.rpc('save_tracking', { p_bo: DB._bo, p: t }));
    const st = Demo.st, list = st.tracking ||= [], i = list.findIndex(x => x.id === t.id && x.box_office_id === DB._bo); need('tickets.tracking');
    const row = clone({ ...t, box_office_id: DB._bo, code: String(t.code || '').trim().toUpperCase() }); codeClash(st, row.code, [], row.id);
    if (!String(row.name || '').trim()) throw new Error('Who or what is this code for?');
    if (i >= 0) { row.created_at = list[i].created_at; list[i] = row; } else { row.created_at = nowIso(); list.push(row); }
    audit(i >= 0 ? 'tracking.updated' : 'tracking.created', `${i >= 0 ? 'Updated' : 'Created'} tracking code ${row.code} (${row.name})`); Demo.save(); return clone(row);
  },
  async deleteTracking(id) {
    if (LIVE) return must(sb.rpc('delete_tracking', { p_bo: DB._bo, p_id: id }));
    const st = Demo.st, t = (st.tracking || []).find(x => x.id === id && x.box_office_id === DB._bo); need('tickets.tracking'); if (!t) return;
    if (st.orders.some(o => o.box_office_id === DB._bo && o.data.tracking === t.code)) throw new Error('This code has orders — switch it off instead, so its report is kept');
    st.tracking = st.tracking.filter(x => x !== t); audit('tracking.deleted', 'Deleted tracking code ' + t.code); Demo.save();
  },
  async saveVenues(list) {
    if (!LIVE) { need('seating.edit'); const bo = Demo.st.boxOffices.find(b => b.id === DB._bo), was = (bo.venues || []).length; bo.venues = clone(list);
      audit('venues.saved', list.length === was ? 'Edited venue charts' : list.length > was ? 'Added a venue chart' : 'Deleted a venue chart'); Demo.save(); return; }
    await must(sb.rpc('save_venues', { p_bo: DB._bo, p: list }));
  },
  // A code typed at checkout: {kind:'promo', ...targeting} | {kind:'promo', error} | {kind:'tracking', code} | null
  async checkCode(eventIds, code) {
    if (!LIVE) {
      const st = Demo.fresh(), ev = st.events.find(e => eventIds.includes(e.id)); if (!ev) return null;
      const f = findCode(st, ev.box_office_id, code); if (!f) return null;
      if (f.promo) { const e = promoUsable(f.promo, code, st.orders, ''); return e ? { kind: 'promo', error: e } : { kind: 'promo', ...publicPromo(f.promo, code) }; }
      return trackingUsable(f.tracking, eventIds, st.orders) ? { kind: 'tracking', code: f.tracking.code } : null;
    }
    return must(sb.rpc('check_code', { p_events: eventIds, p_code: code }));
  },
  async unlock(eventId, password) {
    if (!LIVE) {
      const sec = Demo.st.events.find(e => e.id === eventId)?.secrets || {};
      return { event: !!sec.password && sec.password === password, ticketTypes: Object.entries(sec.ticketPasswords || {}).filter(([, v]) => v && v === password).map(([k]) => k) };
    }
    return must(sb.rpc('unlock', { p_event: eventId, p_password: password }));
  },
  async joinWaitlist(eventId, name, email, phone = '') {
    if (!String(name).trim()) throw new Error('Enter your name');
    if (!EMAIL_RE.test(email)) throw new Error('Enter a valid email');
    if (!LIVE) {
      const st = Demo.st, ev = st.events.find(e => e.id === eventId);
      if (!ev || normEvent(ev).waitlistMode === 'off') throw new Error('This event has no waitlist');
      if (st.waitlist.some(w => w.event_id === eventId && w.email === email.toLowerCase())) return;
      st.waitlist.push({ id: uid(), box_office_id: ev.box_office_id, event_id: eventId, name: name.trim(), email: email.toLowerCase(), phone: String(phone).trim().slice(0, 40), created_at: nowIso() }); Demo.save(); return;
    }
    await must(sb.rpc('join_waitlist', { p_event: eventId, p_name: name, p_email: email, p_phone: phone }));
  },
  async placeOrder(payload, asTeam = false) {
    if (!LIVE) return demoPlaceOrder(clone(payload), asTeam ? need('orders.edit') : null);
    return must(sb.rpc('place_order', { p: payload }));
  },
  // ── Payments (Stage 5). DEMO: the built-in test processor. LIVE: the box office's processor through the `payments` Edge Function
  //    (Stripe: a PaymentIntent on the box office's own Stripe account; the processor's webhook confirms the order and issues tickets).
  async payOrder(id, key, card) {
    if (LIVE) throw new Error('Card details go straight to the processor\'s secure form');
    const st = Demo.fresh(), o = st.orders.find(x => x.id === id && x.access_key === key); if (!o) throw new Error('Order not found');
    const r = demoCharge(st, o, card); Demo.save(); if (r.error) throw new Error(r.error); return r;
  },
  async startPayment(id, key) {   // LIVE: {provider, publishableKey, account, clientSecret}
    if (!LIVE) { const o = Demo.fresh().orders.find(x => x.id === id && x.access_key === key); if (!o) throw new Error('Order not found'); return { provider: 'demo', expires_at: o.expires_at, total: o.data.total }; }
    const { data, error } = await sb.functions.invoke('payments', { body: { action: 'intent', order: id, key } }); if (error || data?.error) throw new Error(data?.error || error.message); return data;
  },
  async cancelCheckout(id, key) {  // the buyer gives up: seats go back on sale now instead of when the timer runs out
    if (LIVE) return must(sb.rpc('cancel_checkout', { p_id: id, p_key: key }));
    const st = Demo.fresh(), o = st.orders.find(x => x.id === id && x.access_key === key);
    if (o?.status === 'awaiting_payment') { o.expires_at = nowIso(); expireOrders(st); Demo.save(); }
  },
  async connectGateway(provider, test = true) {
    if (LIVE) { const { data, error } = await sb.functions.invoke('payments', { body: { action: 'connect', bo: DB._bo, provider, return: location.href } }); if (error || data?.error) throw new Error(data?.error || error.message); return data; }
    need('admin.payments'); const st = Demo.st, bo = st.boxOffices.find(b => b.id === DB._bo), gw = GATEWAYS[provider];
    if (!gw) throw new Error('Unknown processor');
    if (!gw.adapter) throw new Error(`${gw.name} isn't wired in yet — its adapter goes in supabase/functions/payments/providers/. Stripe works today.`);
    const before = bo.gateway || null; bo.gateway = { provider, account: (provider === 'demo' ? 'demo_' : 'acct_demo_') + randCode(10).toLowerCase(), status: 'connected', test: !!test, connected_at: nowIso() };
    audit('settings.payments', `Connected ${gw.name}${test ? ' (test mode)' : ''}`, { before, after: bo.gateway }); Demo.save(); return { gateway: clone(bo.gateway) };
  },
  async disconnectGateway() {
    if (LIVE) return must(sb.rpc('disconnect_gateway', { p_bo: DB._bo }));
    need('admin.payments'); const bo = Demo.st.boxOffices.find(b => b.id === DB._bo), before = bo.gateway; bo.gateway = null;
    audit('settings.payments', `Disconnected ${GATEWAYS[before?.provider]?.name || 'payment processor'}`, { before, after: null }); Demo.save();
  },
  async setPlatformFee(boId, fee) {  // super admin: this box office's platform fee (blank = platform default) and who pays it
    if (LIVE) return must(sb.rpc('set_platform_fee', { p_bo: boId, p: fee }));
    needSuper(); const b = Demo.st.boxOffices.find(x => x.id === boId), before = b.platformFee || null; b.platformFee = fee;
    audit('platform.fee', `Platform fee for ${b.name}: ${fee ? `${fee.pct === '' ? 'default %' : fee.pct + '%'} + ${fee.fixed === '' ? 'default' : money_(fee.fixed)} per ticket, paid by ${fee.payer || 'default'}` : 'platform default'}`, { before, after: fee, bo: b.id }); Demo.save();
  },
  // ── Customer accounts (Stage 5): optional — guest checkout always works. A wallet of the buyer's own orders + tickets, a profile and a password.
  //    No refunds, cancellations, seat changes or transfers from here: those stay with the box office.
  async custSession() {
    if (LIVE) { const { data } = await sb.auth.getSession(); const u = data.session?.user; return u ? { email: u.email, name: u.user_metadata?.name || '', phone: u.user_metadata?.phone || '' } : null; }
    const e = sessionStorage.getItem('set_cust'), c = e && (Demo.fresh().customers || []).find(x => x.email === e); return c ? { email: c.email, name: c.name, phone: c.phone || '' } : null;
  },
  async custSignUp({ name, email, password }) {
    email = String(email || '').trim().toLowerCase(); name = String(name || '').trim();
    if (!name) throw new Error('Please enter your name'); if (!EMAIL_RE.test(email)) throw new Error('Please enter a valid email');
    if (String(password || '').length < 8) throw new Error('Use at least 8 characters for your password');
    if (LIVE) { const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: location.origin + location.pathname + '#/account' } }); if (error) throw new Error(error.message); return { confirm: !data.session }; }
    const st = Demo.fresh(); st.customers ||= [];
    if (st.customers.some(c => c.email === email)) throw new Error('There\'s already an account for that email — sign in instead');
    const salt = randCode(16); st.customers.push({ email, name, phone: '', salt, hash: await pwHash(password, salt), created_at: nowIso() }); Demo.save();
    sessionStorage.setItem('set_cust', email); return { confirm: false };
  },
  async custSignIn(email, password) {
    email = String(email || '').trim().toLowerCase();
    if (LIVE) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw new Error('Wrong email or password'); return; }
    const c = (Demo.fresh().customers || []).find(x => x.email === email);
    if (!c || c.hash !== await pwHash(password, c.salt)) throw new Error('Wrong email or password');
    sessionStorage.setItem('set_cust', email);
  },
  async custSignOut() { if (LIVE) await sb.auth.signOut(); else sessionStorage.removeItem('set_cust'); },
  async custForgot(email) {   // LIVE: Supabase emails a reset link. DEMO: nothing is sent.
    if (LIVE) { const { error } = await sb.auth.resetPasswordForEmail(String(email).trim(), { redirectTo: location.origin + location.pathname + '#/account/password' }); if (error) throw new Error(error.message); }
  },
  async myOrders() {   // only orders bought with this account's email — by anyone signed in as that (verified) email
    if (LIVE) return must(sb.rpc('my_orders'));
    const me = await this.custSession(); if (!me) throw new Error('Please sign in');
    const st = Demo.fresh(); if (expireOrders(st)) Demo.save();
    const os = st.orders.filter(o => o.buyer_email === me.email && o.status !== 'expired');
    return { orders: os.map(o => ({ ...buyerOrder(o), key: o.access_key })), tickets: clone(st.tickets.filter(t => os.some(o => o.id === t.order_id))) };
  },
  async saveProfile({ name, phone }) {
    if (LIVE) { const { error } = await sb.auth.updateUser({ data: { name, phone } }); if (error) throw new Error(error.message); return; }
    const me = await this.custSession(); if (!me) throw new Error('Please sign in');
    if (!String(name || '').trim()) throw new Error('Please enter your name');
    Object.assign(Demo.st.customers.find(c => c.email === me.email), { name: String(name).trim(), phone: String(phone || '').trim() }); Demo.save();
  },
  async changePassword(current, next) {
    if (String(next || '').length < 8) throw new Error('Use at least 8 characters for your new password');
    if (LIVE) { const { error } = await sb.auth.updateUser({ password: next }); if (error) throw new Error(error.message); return; }
    const me = await this.custSession(); if (!me) throw new Error('Please sign in');
    const c = Demo.st.customers.find(x => x.email === me.email); if (c.hash !== await pwHash(current, c.salt)) throw new Error('Your current password is wrong');
    c.salt = randCode(16); c.hash = await pwHash(next, c.salt); Demo.save();
  },
  async getOrder(id, key) {
    if (!LIVE) {
      const st = Demo.fresh(); if (expireOrders(st)) Demo.save();
      const o = st.orders.find(x => x.id === id && x.access_key === key); if (!o) return null;
      return { order: buyerOrder(o), tickets: clone(st.tickets.filter(t => t.order_id === id)) };
    }
    return must(sb.rpc('get_order', { p_id: id, p_key: key }));
  },
  async lookupOrder(ref, email) {
    if (!LIVE) { const o = Demo.st.orders.find(x => x.ref.toUpperCase() === ref.trim().toUpperCase() && x.buyer_email === email.trim().toLowerCase()); return o ? { id: o.id, key: o.access_key } : null; }
    return must(sb.rpc('lookup_order', { p_ref: ref, p_email: email }));
  },
  demoReset() { if (!LIVE) Demo.reset(); },
};

/* ════════════ Sample data (DEMO only) ════════════ */
function seedDemo() {
  const day = (d, h = 20, m = 0) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.toISOString(); };
  const tt = (name, price, qty, extra = {}) => ({ id: shortId('tt_'), name, price, qty, min: 1, max: 10, admits: 1, desc: '', hidden: false, ...extra });
  const prod = (name, price, qty, extra = {}) => ({ id: shortId('ad_'), name, price, qty, max: 0, desc: '', category: 'Other', salesStart: '', salesEnd: '', ticketTypeIds: [], areas: [], standalone: false, ...extra });
  const base = { capacity: 0, timezone: 'America/New_York', currency: 'USD', visibility: 'public', online: false, onlineUrl: '', image: '', allDay: false,
    timeSlots: [], seating: { enabled: false }, addons: [], questions: [], waitlistMode: 'soldout', emails: { confirmation: '', reminders: [] },
    contact: { name: '', email: '', phone: '' }, policies: '', instructions: '' };
  const mk = (o) => ({ ...base, id: uid(), status: 'published', created_at: day(-30), secrets: { password: '', ticketPasswords: {} }, ...o });

  const vipTT = tt('Premium', 10000, 0, { desc: 'Front centre, rows A–C', max: 8, group: 'Reserved seating' });
  const stallsTT = tt('Stalls', 6500, 0, { desc: 'Ground floor', group: 'Reserved seating', breaks: [{ min: 6, price: 5500 }] });
  const circleTT = tt('Circle', 4500, 0, { desc: 'Raised rows J–L', group: 'Reserved seating', phases: [{ id: shortId('ph_'), label: 'Early bird', price: 3900, from: '', until: day(12, 23, 59), upTo: 0 }] });
  const ev1 = mk({ slug: 'winter-orchestra-gala', name: 'Winter Orchestra Gala', category: 'Concert',
    summary: 'A full symphony orchestra with guest soloists.', start: day(41, 19, 30), end: day(41, 22, 0), doors: '6:45 PM',
    venue: 'Grand Lyric Theatre', address: '1500 Broadway, New York, NY 10036',
    description: 'An evening of seasonal favourites performed by a 60-piece orchestra and guest soloists.\n\nDoors open 6:45 PM. The performance begins promptly at 7:30 PM. Seats are reserved — pick yours on the seat map.',
    ticketTypes: [vipTT, stallsTT, circleTT],
    seating: { enabled: true, stage: { x: -170, y: -120, w: 340, h: 46, label: 'STAGE' }, prices: {},
      levels: [{ id: 'L1', name: 'Stalls (ground floor)' }, { id: 'L2', name: 'Circle (upstairs)' }],
      sections: [
        { id: shortId('sec_'), code: 'LFT', name: 'Stalls left', kind: 'rows', x: -365, y: 18, rot: 9, rows: 8, seatsPerRow: 6, rowStart: 'A', ticketTypeId: stallsTT.id },
        { id: shortId('sec_'), code: 'CEN', name: 'Stalls centre', kind: 'rows', x: -169, y: 0, rot: 0, rows: 8, seatsPerRow: 14, rowSeats: [12, 13, 14], rowStart: 'A', curve: 25, ticketTypeId: stallsTT.id },
        { id: shortId('sec_'), code: 'RGT', name: 'Stalls right', kind: 'rows', x: 235, y: 18, rot: -9, rows: 8, seatsPerRow: 6, rowStart: 'A', ticketTypeId: stallsTT.id },
        { id: shortId('sec_'), code: 'CIR', name: 'Circle', level: 'L2', kind: 'rows', x: -299, y: 40, rot: 0, rows: 3, seatsPerRow: 24, rowStart: 'J', curve: 40, ticketTypeId: circleTT.id },
      ] },
    addons: [prod('Printed programme', 800, 0, { category: 'Merchandise', standalone: true }), prod('Parking pass', 2500, 150, { category: 'Parking', max: 2, desc: 'Garage on W 47th St, all evening' }),
      prod('Pre-show dinner', 5500, 80, { category: 'Dinner', desc: 'Three courses in the Lyric Room, 5:30 PM' }), prod('Meet the soloists', 4500, 20, { category: 'Meet & greet', max: 2, desc: 'After the show, backstage' })],
    questions: [{ id: shortId('q_'), label: 'How did you hear about us?', type: 'select', options: 'Instagram, Email, Friend, Poster, Other', required: false }] });
  { const [, park, dinner, meet] = ev1.addons; meet.areas = ['Premium centre'];
    ev1.bundles = [{ id: shortId('bd_'), name: 'Premium + dinner', desc: 'A Premium seat and the pre-show dinner — save $10', price: 14500, qty: 40, max: 4, parts: [{ ticketTypeIds: [vipTT.id], qty: 1 }], addons: [{ addonId: dinner.id, qty: 1 }] },
      { id: shortId('bd_'), name: 'Date night', desc: 'Two Stalls or Circle seats + parking', price: 13500, qty: 0, max: 2, parts: [{ ticketTypeIds: [stallsTT.id, circleTT.id], qty: 2 }], addons: [{ addonId: park.id, qty: 1 }] }];
    ev1.upsells = [{ id: shortId('up_'), addonId: dinner.id, text: 'Make a night of it — dinner before the show', ticketTypeIds: [vipTT.id], areas: [], prices: [], minQty: 1, perTicket: true },
      { id: shortId('up_'), addonId: meet.id, text: 'Front-row guests can meet the soloists', ticketTypeIds: [], areas: ['Premium centre'], prices: [], minQty: 1, perTicket: false },
      { id: shortId('up_'), addonId: park.id, text: 'Driving in? Reserve parking', ticketTypeIds: [stallsTT.id], areas: [], prices: [], minQty: 2, perTicket: false }]; }
  // Premium = front three rows of the centre block (per-seat price + area overrides).
  ev1.seating.areas = {}; const L1 = seatLayout(ev1.seating); L1.seats.filter(p => p.sec.code === 'CEN' && ['A', 'B', 'C'].includes(p.row)).forEach(p => { ev1.seating.prices[p.id] = vipTT.id; });
  L1.seats.filter(p => p.sec.code === 'CEN' && ['A', 'B', 'C'].includes(p.row)).forEach(p => { ev1.seating.areas[p.id] = 'Premium centre'; });
  Object.assign(ev1.seating, seatDerive(ev1.seating));
  const ev2 = mk({ slug: 'neon-nights-live', name: 'Neon Nights Live', category: 'Live music', start: day(0, 20, 0), end: day(0, 23, 30), doors: '7:00 PM',
    summary: 'Tonight — three bands, one stage.', venue: 'The Warehouse', address: '210 Kent Ave, Brooklyn, NY 11249', audience: '18+ · ID required',
    description: 'Three of the city\'s best live acts on one stage. Standing room, full bar.\n\nPhoto ID required at the door.',
    capacity: 450, ticketTypes: [tt('General admission', 3500, 380), tt('Early entry', 5500, 60, { desc: 'Doors 30 minutes early' }), tt('Group of 5', 15000, 30, { admits: 5, desc: 'Admits five — save $25', max: 4, group: 'Groups' }),
      tt('VIP table', 60000, 5, { hidden: true, desc: 'Reserved table for 6 with bottle service', max: 1, group: 'VIP' }), tt('Artist guest list', 0, 20, { adminOnly: true, desc: 'Issued by the box office' })],
    addons: [prod('Parking', 1500, 40, { category: 'Parking' }), prod('Tour T-shirt', 2500, 0, { category: 'Merchandise', standalone: true })] });
  ev2.bundles = [{ id: shortId('bd_'), name: 'Ticket + parking', desc: 'General admission and a parking spot', price: 4500, qty: 30, max: 4, parts: [{ ticketTypeIds: [ev2.ticketTypes[0].id], qty: 1 }], addons: [{ addonId: ev2.addons[0].id, qty: 1 }] }];
  ev2.secrets.ticketPasswords[ev2.ticketTypes[3].id] = 'VIPACCESS';
  const ev3 = mk({ slug: 'city-food-festival', name: 'City Food & Wine Festival', category: 'Food & drink',
    summary: 'Two tasting sessions, 40 vendors.', start: day(18, 12, 0), end: day(18, 20, 0), venue: 'Pier 36', address: '299 South St, New York, NY 10002',
    description: 'Taste your way through 40 local restaurants, bakeries and wineries. Choose your session at checkout. Unlimited tastings included.',
    ticketTypes: [tt('Tasting pass', 4900, 0), tt('Designated driver', 1900, 0, { desc: 'Food only — no alcohol' })], addons: [prod('Park admission', 1200, 0, { category: 'Park admission', desc: 'Day entry to Pier Park rides' })],
    timeSlots: [{ id: shortId('ts_'), start: day(18, 12, 0), capacity: 250 }, { id: shortId('ts_'), start: day(18, 16, 30), capacity: 250 }] });
  const ev4 = mk({ slug: 'founders-summit', name: 'Founders Summit 2026', category: 'Conference', start: day(27, 9, 0), end: day(27, 17, 30),
    summary: 'A one-day conference for early-stage founders.', venue: 'Hudson Conference Center', address: '75 Hudson Yards, New York, NY 10001',
    description: 'Talks, workshops and investor office hours. Lunch and coffee included.', capacity: 300,
    ticketTypes: [tt('Standard', 19900, 0), tt('Student', 4900, 60, { desc: 'Valid student ID required' })],
    questions: [{ id: shortId('q_'), label: 'Company name', type: 'text', required: true, scope: 'event' }, { id: shortId('q_'), label: 'Attendee name (for the badge)', type: 'text', required: true, scope: 'ticket' },
      { id: shortId('q_'), label: 'Dietary requirements', type: 'select', options: 'None, Vegetarian, Vegan, Gluten-free, Kosher, Halal', required: false, scope: 'ticket' },
      { id: shortId('q_'), label: 'I agree to the Founders Summit code of conduct', type: 'terms', text: 'Be respectful. No harassment of any kind. Organizers may remove anyone who breaks this code, without a refund.', required: true, scope: 'event' }] });
  const ev5 = mk({ slug: 'kids-science-show', name: 'Big Bang Science Show', category: 'Family', start: day(55, 11, 0), end: day(55, 17, 0),
    summary: 'Hourly hands-on science shows for kids.', venue: 'Discovery Hall', address: '2900 Campus Rd, Brooklyn, NY 11210', audience: 'Ages 4+',
    description: 'Explosions, slime and liquid nitrogen — hourly 45-minute shows from 11 AM to 4 PM. Under 2s free (no ticket needed).',
    ticketTypes: [tt('Adult', 2000, 0), tt('Child (2–12)', 1500, 0), tt('Family 4-pack', 6000, 0, { admits: 4, group: 'Groups' })],
    timeSlots: [11, 12, 13, 14, 15, 16].map(h => ({ id: shortId('ts_'), start: day(55, h, 0), capacity: 180 })),
    questions: [{ id: shortId('q_'), label: 'Activity & photo waiver', type: 'waiver', required: true, scope: 'event',
      text: 'Shows include loud bangs, fog and cold materials handled by our presenters. Children must stay with an adult. Photos taken in the hall may be used on our website and social media.' },
      { id: shortId('q_'), label: 'Parent / guardian signature', type: 'signature', required: true, scope: 'event' }] });
  const ev6 = mk({ slug: 'comedy-night', name: 'Late Night Comedy Club', category: 'Comedy', status: 'draft', start: day(70, 21, 0), end: day(70, 23, 0),
    summary: 'Five comics, one mic.', venue: 'TBA', address: '', description: 'Line-up coming soon.', ticketTypes: [tt('General', 2500, 120)] });
  // Two independent box offices (plus one registration waiting for approval) to show data separation.
  const boSet = name => ({ ...DEFAULT_SETTINGS, name, feePct: 3, feeFixed: 99 });
  const bo1 = { id: uid(), slug: 'skyline-live', name: 'Skyline Live', status: 'active', owner: 'moishsonn@gmail.com', created_at: day(-60), created_by: 'platform',
    branding: { ...DEFAULT_BRANDING, tagline: 'Concerts and live music across New York', website: 'https://example.com', instagram: 'skylinelive' },
    settings: { ...boSet('Skyline Live'), contactEmail: 'help@skyline.example', questions: [{ id: 'q_access', label: 'Accessibility needs (optional)', type: 'text', required: false, scope: 'order' }],
      checkout: { ...DEFAULT_SETTINGS.checkout, note: 'Tickets are sent to your email right after payment. Questions? help@skyline.example' } }, templates: clone(DEFAULT_TEMPLATES),
    gateway: { provider: 'demo', account: 'demo_skyline', status: 'connected', test: true, connected_at: day(-59) } };
  const bo2 = { id: uid(), slug: 'harbor-arts', name: 'Harbor Arts Center', status: 'active', owner: 'director@harborarts.example', created_at: day(-45), created_by: 'platform',
    branding: { ...DEFAULT_BRANDING, ink: '#0f3a33', accent: '#7fd3b4', font: 'Playfair Display', tagline: 'Festivals, talks and family days on the waterfront' },
    settings: { ...boSet('Harbor Arts Center'), contactEmail: 'boxoffice@harborarts.example', taxPct: 8.875, checkout: { ...DEFAULT_SETTINGS.checkout, address: 'optional' } }, templates: clone(DEFAULT_TEMPLATES),
    gateway: { provider: 'demo', account: 'demo_harbor', status: 'connected', test: true, connected_at: day(-44) } };
  const bo3 = { id: uid(), slug: 'northside-comedy', name: 'Northside Comedy Collective', status: 'pending', owner: 'hello@northside.example', created_at: day(-1), created_by: 'self-registration',
    branding: { ...DEFAULT_BRANDING }, settings: boSet('Northside Comedy Collective'), templates: clone(DEFAULT_TEMPLATES) };
  [ev1, ev2, ev6].forEach(e => e.box_office_id = bo1.id); [ev3, ev4, ev5].forEach(e => e.box_office_id = bo2.id);
  ev1.contact = { name: 'Front of house', email: 'gala@skyline.example', phone: '(212) 555-0142' };
  ev1.policies = 'No refunds within 7 days of the performance. Latecomers are seated at a suitable break.';
  ev1.instructions = 'Bring your ticket QR on your phone. Coat check is on the lower level.';
  ev1.page = { video: '', sponsors: [{ name: 'Lyric Bank', url: 'https://example.com' }, { name: 'Hudson Foundation', url: 'https://example.com' }],
    blocks: [{ id: 'blk1', title: 'The programme', text: 'Tchaikovsky — The Nutcracker Suite\nVivaldi — Winter (The Four Seasons)\nHolst — Jupiter\nInterval of 20 minutes.' }], hide: {}, checkoutNote: 'Premium centre seats include a welcome drink.' };
  ev3.timeSlots.push({ id: shortId('ts_'), start: day(18, 19, 30), capacity: 120, label: 'Late tasting (private)', hidden: true });
  ev5.timeSlots[5].unavailable = true; ev5.timeSlots[0].soldOut = true; ev5.allDay = false; ev3.waitlistMode = 'always';
  ev3.ticketTypes[0].slotPrices = { [ev3.timeSlots[1].id]: 5900 };  // the evening session costs more
  ev3.bundles = [{ id: shortId('bd_'), name: 'Tasting pass + park admission', desc: 'Festival entry and a day at Pier Park — save $6', price: 5500, qty: 0, max: 6, parts: [{ ticketTypeIds: [ev3.ticketTypes[0].id], qty: 1 }], addons: [{ addonId: ev3.addons[0].id, qty: 1 }] }];
  ev5.bundles = [{ id: shortId('bd_'), name: 'Family package', desc: '2 adults + 2 children — save $15', price: 5500, qty: 0, max: 2, parts: [{ ticketTypeIds: [ev5.ticketTypes[0].id], qty: 2 }, { ticketTypeIds: [ev5.ticketTypes[1].id], qty: 2 }], addons: [] }];
  const ev7 = mk({ slug: 'spring-jazz-brunch', name: 'Spring Jazz Brunch', category: 'Live music', start: day(64, 11, 30), end: day(64, 14, 0), venue: 'Skyline Roof',
    address: '22 W 32nd St, New York, NY 10001', summary: 'Live trio, brunch buffet, city views.', description: 'A relaxed late-morning set from the Skyline house trio with a brunch buffet.',
    publishAt: day(5, 10, 0), salesStart: day(7, 10, 0), waitlistMode: 'presale', capacity: 140,
    ticketTypes: [tt('Brunch + music', 8500, 120), tt('Music only (bar)', 3500, 20)] });
  const events = [ev1, ev2, ev3, ev4, ev5, ev6, ev7]; ev7.box_office_id = bo1.id;
  bo1.eventTemplates = [
    eventToTemplate(ev2, 'Standard Concert'), eventToTemplate(ev1, 'Reserved Seating Event'),
    eventToTemplate({ ...ev2, name: 'General Admission Event', ticketTypes: [tt('General admission', 3000, 0)], capacity: 300 }, 'General Admission Event'),
    eventToTemplate({ ...ev1, name: "Women's Show", audience: 'Women & girls only' }, "Women's Show"),
    eventToTemplate({ ...ev2, name: 'Dinner Concert', ticketTypes: [tt('Dinner + show', 12500, 0)], capacity: 160,
      seating: { enabled: true, stage: { x: -150, y: -140, w: 300, h: 40, label: 'STAGE' }, prices: {}, sections: Array.from({ length: 12 }, (_, i) => ({ id: shortId('sec_'), code: 'T' + (i + 1), name: 'Table ' + (i + 1), area: 'Dinner tables', kind: 'table', seats: 10, x: -260 + (i % 4) * 170, y: -20 + Math.floor(i / 4) * 150, rot: 0, ticketTypeId: '' })) } }, 'Dinner Concert')];
  { const dc = bo1.eventTemplates[4].event; dc.seating.sections.forEach(x => x.ticketTypeId = dc.ticketTypes[0].id); }
  const tpl = id => DEFAULT_TEMPLATES.find(t => t.id === id).perms;
  const mem = (bo, email, name, template, evs = 'all') => ({ id: uid(), box_office_id: bo.id, email, name, perms: [...tpl(template)], template, events: evs, status: 'active', created_at: day(-40), added_by: bo.owner });
  const members = [
    mem(bo1, 'moishsonn@gmail.com', 'Owner', 'full'), mem(bo1, 'manager@skyline.example', 'Dana Price', 'event_manager', [ev1.id]),
    mem(bo1, 'support@skyline.example', 'Ravi Shah', 'customer_service'), mem(bo1, 'finance@skyline.example', 'Lena Ortiz', 'finance'),
    mem(bo1, 'door@example.com', 'Door staff', 'door_staff', [ev2.id]), mem(bo1, 'scanner@example.com', 'Scanner phone', 'scanner'),
    mem(bo2, 'director@harborarts.example', 'Harbor director', 'full'), mem(bo2, 'moishsonn@gmail.com', 'Owner (guest)', 'event_manager'),
    mem(bo3, 'hello@northside.example', 'Northside owner', 'full')];

  // A few weeks of realistic sales so the dashboard has something to show.
  Demo.st = { platform: clone(DEFAULT_PLATFORM), boxOffices: [bo1, bo2, bo3], members, events, orders: [], tickets: [], waitlist: [], broadcasts: [],
    audit: [], sessions: [], mfa: {}, locks: {} };
  // Promo + tracking codes (Stage 4) — box-office wide, each targeted.
  const promo = (bo, code, o) => ({ id: shortId('pr_'), box_office_id: bo.id, code, active: true, note: '', type: 'pct', amount: 10, on: 'tickets', scope: ['tickets', 'bundles'],
    eventIds: [], slotIds: [], ticketTypeIds: [], areas: [], prices: [], addonIds: [], bundleIds: [], startsAt: '', expires: '', maxUses: 0, perCustomer: 0, maxItems: 0, maxTickets: 0,
    minSpend: 0, minQty: 0, maxQty: 0, codes: [], created_at: day(-35), created_by: bo.owner, ...o });
  const sunday = (() => { const x = new Date(); x.setDate(x.getDate() + ((7 - x.getDay()) % 7 || 7)); x.setHours(10, 0, 0, 0); return x.toISOString(); })();
  Demo.st.promos = [
    promo(bo1, 'EARLYBIRD', { amount: 15, eventIds: [ev1.id], maxUses: 100, expires: day(20), note: 'Season announcement email' }),
    promo(bo1, 'BINAH15', { amount: 15, eventIds: [ev1.id], prices: [10000], maxTickets: 4, maxUses: 100, expires: sunday, note: 'Partner organisation — $100 seats only' }),
    promo(bo1, 'WELCOME10', { type: 'order', amount: 1000, eventIds: [ev2.id], perCustomer: 1, note: 'First-time buyers' }),
    promo(bo1, 'NOFEES', { type: 'pct', amount: 100, on: 'fee', minQty: 4, note: 'Booking fee waived on 4+ tickets' }),
    promo(bo1, 'PRESS', { type: 'pct', amount: 100, eventIds: [ev1.id], maxTickets: 2, maxItems: 2, note: 'Single-use press codes', codes: Array.from({ length: 12 }, () => 'PRESS-' + randCode(5)) }),
    promo(bo1, 'PARKFREE', { type: 'pct', amount: 100, scope: ['addons'], addonIds: [ev1.addons[1].id], maxItems: 1, minSpend: 20000, note: 'Free parking on orders over $200' }),
    promo(bo2, 'FAMILY5', { type: 'fixed', amount: 500, eventIds: [ev5.id], ticketTypeIds: [ev5.ticketTypes[1].id], note: '$5 off each child ticket' })];
  const trk = (bo, code, name, kind, o = {}) => ({ id: shortId('tr_'), box_office_id: bo.id, code, name, kind, active: true, eventIds: [], startsAt: '', expires: '', maxUses: 0, created_at: day(-30), ...o });
  Demo.st.tracking = [trk(bo1, 'ALEX', 'Alex Rivera', 'Promoter'), trk(bo1, 'RADIO101', 'City Radio 101 morning show', 'Campaign', { expires: day(30) }),
    trk(bo1, 'HOTELPARTNER', 'Midtown Grand Hotel concierge', 'Partner', { eventIds: [ev1.id] }), trk(bo2, 'FOODBLOG', 'Eat the City blog', 'Affiliate')];
  const codeFor = { [ev1.id]: ['EARLYBIRD', 'BINAH15'], [ev2.id]: ['WELCOME10'] }, refFor = { [bo1.id]: ['ALEX', 'RADIO101', 'HOTELPARTNER'], [bo2.id]: ['FOODBLOG'] };
  // Seat statuses on the gala: camera positions blocked, a family hold, a broken seat (Stage 3).
  const sst = (seat, status, note) => ({ id: uid(), box_office_id: bo1.id, event_id: ev1.id, slot_id: '', seat, status, note, by: 'moishsonn@gmail.com', at: day(-6, 11) });
  Demo.st.seatStatus = [sst('CEN-A1', 'blocked', 'Camera position'), sst('CEN-A12', 'blocked', 'Camera position'), sst('CIR-K1', 'blocked', 'Sound desk'), sst('CIR-K24', 'blocked', 'Sound desk'),
    sst('CEN-E7', 'held', 'Artist family'), sst('CEN-E8', 'held', 'Artist family'), sst('LFT-H6', 'unavailable', 'Broken seat — repair booked')];
  Demo.st.seatLog = Demo.st.seatStatus.map(r => ({ id: uid(), at: r.at, box_office_id: bo1.id, event_id: ev1.id, slot_id: '', seat: r.seat, action: r.status, detail: { blocked: 'Blocked', held: 'Held', unavailable: 'Made unavailable' }[r.status] + ' — ' + r.note, by: r.by, ref: null }));
  const first = ['Alex', 'Jordan', 'Sam', 'Maya', 'Chris', 'Priya', 'Daniel', 'Emma', 'Luis', 'Grace', 'Noah', 'Aisha', 'Ben', 'Chloe', 'Omar', 'Zoe'];
  const last = ['Carter', 'Nguyen', 'Patel', 'Rivera', 'Kim', 'Brooks', 'Cohen', 'Okafor', 'Silva', 'Hughes', 'Morgan', 'Reyes'];
  let n = 0; const rnd = a => a[Math.floor(Math.random() * a.length)], card = { number: '4242424242424242', exp: '12/34', cvc: '123' };
  const qAns = ev => Object.fromEntries((ev.questions || []).filter(q => q.scope !== 'ticket').map(q => [q.id, q.type === 'terms' || q.type === 'waiver' ? true : q.type === 'signature' ? 'Sample Parent' : q.type === 'select' ? q.options.split(',')[0].trim() : 'Sample Co']));
  const tAns = (ev, k) => Object.fromEntries((ev.questions || []).filter(q => q.scope === 'ticket').map(q => [q.id, Array.from({ length: k }, () => q.type === 'select' ? 'None' : rnd(first) + ' ' + rnd(last))]));
  for (const ev of events.filter(e => e.status === 'published')) {
    const count = ev === ev1 ? 46 : ev === ev2 ? 60 : 24;
    for (let i = 0; i < count; i++) {
      const name = rnd(first) + ' ' + rnd(last), email = name.toLowerCase().replace(' ', '.') + (n++) + '@example.com';
      const t = rnd(ev.ticketTypes.filter(x => !x.hidden && !x.adminOnly)), qty = t.admits > 1 ? 1 : 1 + Math.floor(Math.random() * 3);
      if (t === vipTT && Math.random() < .55) continue;  // keep some Premium seats for the demo
      const item = { eventId: ev.id, ticketTypeId: t.id, qty, slotId: ev.timeSlots.length ? rnd(ev.timeSlots).id : null };
      if (ev.seating.enabled) {
        const off = offSeats(availabilityFrom(Demo.st.tickets, ev.id, Demo.st.seatStatus, '', Demo.st.orders), ''), free = Object.keys(ev.seating.index).filter(id => ev.seating.index[id] === t.id && !off.has(id));
        const at = Math.floor(Math.random() * Math.max(1, free.length - qty)), seats = free.slice(at, at + qty);
        if (seats.length !== qty) continue; item.seats = seats;
      }
      try {
        const adds = (ev.addons || []).filter(a => !a.ticketTypeIds?.length && !a.areas?.length && Math.random() < .15).map(a => ({ eventId: ev.id, addonId: a.id, qty: 1 }));
        const r = demoPlaceOrder({ buyer: { name, email, phone: '' }, items: [item], addons: adds, payment: Math.random() < .85 ? 'card' : 'offline', card, optIn: Math.random() < .6, answers: qAns(ev), ticketAnswers: tAns(ev, qty * (t.admits || 1)),
          code: Math.random() < .14 ? rnd(codeFor[ev.id] || ['']) : '', tracking: Math.random() < .18 ? rnd(refFor[ev.box_office_id] || ['']) : '', source: rnd(['', '', 'instagram', 'facebook', 'newsletter']) }, { owner: true });
        const o = Demo.st.orders.find(x => x.id === r.id); o.created_at = day(-Math.floor(Math.random() * 28), 8 + Math.floor(Math.random() * 14), Math.floor(Math.random() * 60)); if (o.paid_at) o.paid_at = o.created_at;
        if (o.status === 'paid' && Math.random() < .04) { o.status = 'refunded'; o.data.refunded = o.data.total; Demo.st.tickets.forEach(t => { if (t.order_id === o.id) { if (t.seat) seatLog(ev, t.slot_id, t.seat, 'cancelled', `Order ${o.ref} refunded — seat released`, { ref: o.ref, by: 'moishsonn@gmail.com' }); t.status = 'cancelled'; } }); }
      } catch (e) { /* sold out etc. — skip */ }
    }
  }
  { // two complimentary press seats on the gala
    const off = offSeats(availabilityFrom(Demo.st.tickets, ev1.id, Demo.st.seatStatus, '', Demo.st.orders), ''), free = Object.keys(ev1.seating.index).filter(id => ev1.seating.index[id] === stallsTT.id && !off.has(id)).slice(-2);
    try { demoPlaceOrder({ buyer: { name: 'City Arts Review', email: 'press@example.com', phone: '' }, items: [{ eventId: ev1.id, ticketTypeId: stallsTT.id, qty: 2, seats: free }], addons: [], payment: 'manual', comp: true, source: 'box office' }, { owner: true, email: 'moishsonn@gmail.com' }); } catch (e) { }
  }
  { // a few bundle sales
    const buy = (ev, it, extra = {}) => { try { const r = demoPlaceOrder({ buyer: { name: rnd(first) + ' ' + rnd(last), email: `bundle${n++}@example.com`, phone: '' }, items: [{ eventId: ev.id, ...it }], addons: [], payment: 'card', card, answers: qAns(ev), ...extra }, { owner: true });
      const o = Demo.st.orders.find(x => x.id === r.id); o.created_at = o.paid_at = day(-Math.floor(Math.random() * 20), 9 + Math.floor(Math.random() * 12)); } catch (e) { } };
    for (let i = 0; i < 4; i++) buy(ev2, { bundleId: ev2.bundles[0].id, qty: 1 + (i % 2) });
    for (let i = 0; i < 3; i++) buy(ev5, { bundleId: ev5.bundles[0].id, qty: 1, slotId: ev5.timeSlots[1 + i].id });
    for (let i = 0; i < 2; i++) { const off = offSeats(availabilityFrom(Demo.st.tickets, ev1.id, Demo.st.seatStatus, '', Demo.st.orders), ''), seat = Object.keys(ev1.seating.index).filter(id => ev1.seating.index[id] === vipTT.id && !off.has(id))[3 + i * 4];
      if (seat) buy(ev1, { bundleId: ev1.bundles[0].id, qty: 1, seats: [seat] }, i ? { tracking: 'HOTELPARTNER' } : {}); }
  }
  { // a sample customer account: one upcoming order tonight, one festival order, one pay-later reservation
    Demo.st.customers = [{ email: 'maya@example.com', name: 'Maya Patel', phone: '(917) 555-0188', salt: 'SEEDSALTDEMO2026', hash: 'OAHNUKE7C6R6FZSZF5WLK4F6KZFWUDTRLBPIOBEJG2EFNHMGODT', created_at: day(-12) }];
    const me = { name: 'Maya Patel', email: 'maya@example.com', phone: '(917) 555-0188' };
    try { demoPlaceOrder({ buyer: me, items: [{ eventId: ev2.id, ticketTypeId: ev2.ticketTypes[0].id, qty: 2 }], addons: [], payment: 'card', card }, null); } catch (e) { }
    try { demoPlaceOrder({ buyer: me, items: [{ eventId: ev3.id, ticketTypeId: ev3.ticketTypes[0].id, qty: 1, slotId: ev3.timeSlots[0].id }], addons: [], payment: 'offline' }, null); } catch (e) { }
  }
  ev1.seating.noSingles = true;  // switched on after the sample sales
  bo1.venues = [eventToVenue(ev1, 'Grand Lyric Theatre'), eventToVenue(bo1.eventTemplates[4].event, 'Skyline Roof — dinner layout')];
  bo1.venues[1].address = ev7.address; ev1.seating.venueId = bo1.venues[0].id; ev1.seating.venueName = bo1.venues[0].name;
  // ev2 is tonight: doors are open and some guests are already in (for the scanner app).
  Demo.st.tickets.filter(t => t.event_id === ev2.id && t.status === 'valid').forEach(t => { if (Math.random() < .4) t.checked_in_at = new Date(Date.now() - Math.pow(Math.random(), .6) * 110 * 6e4).toISOString(); });
  Demo.st.audit.push({ id: uid(), at: day(-1, 9, 12), actor: 'hello@northside.example', box_office_id: bo3.id, kind: 'platform.registered', summary: 'Registration request: ' + bo3.name, before: null, after: null },
    ...members.filter(m => m.box_office_id !== bo3.id && m.email !== m.added_by).map(m => ({ id: uid(), at: m.created_at, actor: m.added_by, box_office_id: m.box_office_id, kind: 'team.invited', summary: `Invited ${m.email} (${m.perms.length} permissions)`, before: null, after: null })));
  // Page views so conversion rates mean something: ~8–15 visits per order, from the same channels.
  Demo.st.views = {};
  for (const ev of events.filter(e => e.status === 'published')) {
    const n = Demo.st.orders.filter(o => o.event_ids.includes(ev.id)).length * (8 + Math.floor(Math.random() * 7)) + 40, hits = [], pool = Array.from({ length: Math.ceil(n * .7) }, () => randCode(6).toLowerCase());
    for (let i = 0; i < n; i++) { const ref = Math.random() < .2 ? rnd(refFor[ev.box_office_id] || ['']) : ''; hits.push([Date.now() - Math.pow(Math.random(), 1.6) * 28 * 864e5, rnd(pool), rnd(['', '', '', 'instagram', 'facebook', 'newsletter', 'whatsapp']), ...(ref ? [ref] : [])]); }
    hits.push(...Array.from({ length: 4 + Math.floor(Math.random() * 6) }, () => [Date.now() - Math.random() * 5e5, randCode(6).toLowerCase(), '']));
    Demo.st.views[ev.id] = { hits: hits.sort((a, b) => a[0] - b[0]) };
  }
  Demo.st.waitlist.push({ id: uid(), box_office_id: bo2.id, event_id: ev3.id, name: 'Jamie Fox', email: 'jamie@example.com', created_at: day(-1) });
  return Demo.st;
}
