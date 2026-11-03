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
  ['finance', 'Sales & finance', [['totals', 'View ticket sales totals', 'v'], ['reports', 'View financial reports', 'v'], ['fees', 'View fees', 'v'], ['processing', 'View payment processing information', 'v'], ['payouts', 'View payouts', 'v'], ['export', 'Export financial reports'], ['expenses', 'Enter event expenses']]],
  ['door', 'Event-day access', [['scan', 'Scan tickets'], ['checkin', 'Check customers in'], ['undo', 'Undo check-in'], ['override', 'Override scanner warnings'], ['search', 'Look up guests at the door (name, email, phone, order)'], ['log', 'View scan history', 'v'], ['attendees', 'View attendee lists', 'v'], ['devices', 'Manage scanner devices'], ['staff', 'Manage door staff']]],
  ['comms', 'Communication', [['email', 'Send customer emails'], ['notify', 'Send event notifications'], ['lists', 'Access attendee mailing lists', 'v'], ['marketing', 'Send marketing campaigns'], ['sms', 'Send text messages'], ['automations', 'Manage automations'], ['consent', 'Manage consent, suppression & customer tags']]],
  ['admin', 'Administration', [['invite', 'Invite team members'], ['remove', 'Remove team members'], ['perms', 'Edit team permissions'], ['integrations', 'Access integrations'], ['api', 'Access API settings'], ['payments', 'Access payment settings'], ['settings', 'Access box office settings']]],
];
const ALL_PERMS = PERMS.flatMap(([g, , ks]) => ks.map(k => g + '.' + k[0]));
const groupPerms = (g, viewOnly) => PERMS.find(x => x[0] === g)[2].filter(k => !viewOnly || k[2] === 'v').map(k => g + '.' + k[0]);
const DEFAULT_TEMPLATES = [
  { id: 'full', name: 'Full administrator', perms: ALL_PERMS },
  { id: 'event_manager', name: 'Event manager', perms: [...groupPerms('events'), ...groupPerms('seating'), ...groupPerms('tickets'), ...groupPerms('door'), 'orders.view', 'customers.names', 'finance.totals', 'comms.notify'] },
  { id: 'customer_service', name: 'Customer service', perms: ['events.view', 'seating.view', 'seating.move', 'seating.assign', 'tickets.view', 'orders.view', 'orders.edit', 'orders.cancel', 'orders.cancelTicket', 'orders.resend', 'orders.customer', 'orders.seats', 'orders.refund', ...groupPerms('customers', true), 'door.attendees', 'comms.email'] },
  { id: 'door_staff', name: 'Door staff', perms: ['events.view', 'seating.view', 'customers.names', 'door.scan', 'door.checkin', 'door.undo', 'door.override', 'door.search', 'door.log', 'door.attendees'] },
  // Scanner staff: scan, see valid / seat / basic totals — nothing else (no back office, no customer or money data).
  { id: 'scanner', name: 'Scanner staff', perms: ['door.scan', 'door.checkin'] },
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
  payments: { card: true, offline: true, door: true }, donations: true, pixels: { ga4: '', meta: '', tiktok: '', consent: false }, mail: { fromName: '', replyTo: '' },
  contactEmail: '', reminderHours: 24, require2fa: false,
  // Stage 5: who pays card processing, tax on fees, what checkout asks for, and questions asked on every order
  passProcessing: false, taxOnFees: false, questions: [],
  checkout: { phone: 'optional', address: 'off', promo: true, optIn: true, smsOptIn: true, note: '', thanks: '' },
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
  const credit = Math.min(Math.max(0, Math.round(+o.credit || 0)), pre), owed = pre - credit;   // Stage 6: account / event credit pays first
  const processingFee = o.method === 'card' && owed > 0 ? Math.round(owed * (+card.pct || 0) / 100) + (+card.fixed || 0) : 0, processing = card.pass ? processingFee : 0;
  const sumKind = k => lines.filter(l => k.includes(l.kind)).reduce((a, l) => a + l.unit * l.qty, 0);
  return { lines, subtotal, ticketsTotal: sumKind(['ticket', 'bundle']), addonsTotal: sumKind(['addon']), discount: disc, feeDiscount: feeDisc, fee, serviceFee, tax, donation,
    processing, processingFee, platformFee, credit, total: owed + processing, promoErr,
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
    if (l.kind === 'addon') a.ad[l.addonId] = (a.ad[l.addonId] || 0) + l.qty - (l.removed || 0);
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
// The section's own name on the ticket ("Table 5", "Box 4", "Couch 3") — on by default for tables and booths, opt-in for rows
// (boxes, pods, couches drawn as a row). Left out when it would just repeat the area.
const secUnit = (sec, kind, area) => { const on = sec.showName ?? (kind === 'table' || kind === 'booth'), n = String(sec.name || '').trim(); return on && kind !== 'ga' && n && n !== area ? n : ''; };
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
      p.unit = secUnit(sec, kind, p.area); p.tRow = sec.hideRow ? '' : p.row;   // tRow = the row printed on the ticket (boxes / couches can leave it off)
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
// What the server checks against: price per seat (index), what goes on the ticket (meta: [area, row, seat, unit]),
// and row order for the single-seat gap rule (rows: "SEC|A" → [seatId | null for a removed seat]).
function seatDerive(st) {
  const L = seatLayout(st), index = {}, meta = {}, rows = {};
  for (const p of L.seats) { if (p.tt) index[p.id] = p.tt; meta[p.id] = p.unit ? [p.area, p.tRow, p.label, p.unit] : [p.area, p.tRow, p.label]; }
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
  if (t?.area !== undefined && t.area !== null) return { area: t.area, row: t.row || '', seat: t.seat_label || '', unit: t.unit || '' };
  const m = ev?.seating?.meta?.[id]; return m ? { area: m[0], row: m[1], seat: m[2], unit: m[3] || '' } : { area: '', row: '', seat: id || '', unit: '' };
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
const DEMO_KEY = 'set_demo_v13';
const Demo = {
  st: null,
  load() {
    try { this._raw = localStorage.getItem(DEMO_KEY); this.st = JSON.parse(this._raw); } catch (e) { this.st = null; }
    if (!this.st || !this.st.boxOffices) { this.st = seedDemo(); this.save(); }
    return this.st;
  },
  // Pick up changes another tab made (e.g. an admin removed this person) — what a real server would see.
  // Updated in place, so an action that already holds Demo.st (and then checks permissions) keeps writing to the live copy.
  fresh() {
    let raw = null; try { raw = localStorage.getItem(DEMO_KEY); } catch (e) { }
    if (raw && raw !== this._raw) { const n = JSON.parse(raw); if (this.st) { for (const k of Object.keys(this.st)) if (!(k in n)) delete this.st[k]; Object.assign(this.st, n); } else this.st = n; this._raw = raw; }
    return this.st || this.load();
  },
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
const seatText = (ev, id) => { const m = ev?.seating?.meta?.[id]; return m ? [m[0], m[3], m[1] && 'Row ' + m[1], m[2] && 'Seat ' + m[2]].filter(Boolean).join(' · ') : id; };
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
  const qOpts = { avail: avs, manual, now, method: p.payment };
  let q = quote({ items, addons, donation: p.donation }, st.events, set, promo, qOpts);
  if (promo && q.promoErr) throw new Error(q.promoErr);
  // credit (Stage 6): a credit code, the signed-in customer's own account credit, or one a staff member picks on a manual order
  let credit = null;
  if ((p.credit || p.creditId) && !p.comp) {
    const cs = (st.credits || []).filter(c => c.box_office_id === bo.id), cst = c => creditState(c, st.orders, now);
    if (p.creditId) { if (!manual) throw new Error('not allowed'); credit = cs.find(c => c.id === p.creditId); }
    else if (p.credit === 'account') {
      if (sessionStorage.getItem('set_cust') !== email) throw new Error('Sign in with this email to use your account credit');
      credit = cs.filter(c => c.email === email && !creditProblem(c, cst(c), evIds)).sort((a, b) => cst(b).remaining - cst(a).remaining)[0];
      if (!credit) throw new Error('You have no credit that can be used on this order');
    } else credit = cs.find(c => c.code === String(p.credit).trim().toUpperCase());
    const why = creditProblem(credit, credit && cst(credit), evIds); if (why) throw new Error(why);
    q = quote({ items, addons, donation: p.donation }, st.events, set, promo, { ...qOpts, credit: Math.min(cst(credit).remaining, credit.event_id ? eventPortion(q, credit.event_id) : Infinity) });
  }
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
    attempt_key: p.attempt || null, paid_at: status === 'paid' ? now.toISOString() : null, expires_at: status === 'awaiting_payment' ? new Date(now.getTime() + PAY_MINUTES * 6e4).toISOString() : null,
    payment: status === 'awaiting_payment' ? { provider: bo.gateway.provider, test: !!bo.gateway.test, attempts: [] }
      : manual && q.total > 0 ? { provider: 'manual', method: PAY_METHODS[p.payMethod] ? p.payMethod : 'other', ref: String(p.payRef || '').slice(0, 80), by: asTeam?.email || DB._actor } : null,
    data: { buyer: p.buyer, lines: q.lines, subtotal: q.subtotal, ticketsTotal: q.ticketsTotal, addonsTotal: q.addonsTotal, discount: q.discount, feeDiscount: q.feeDiscount,
      fee: q.fee, serviceFee: q.serviceFee, tax: q.tax, donation: q.donation, processing: q.processing, processingFee: q.processingFee, total: q.total, refunded: 0, faceValue: q.faceValue,
      code: promo?.code || null, promo: promo ? { id: promo.id, code: findCode(st, bo.id, promo.code).promo.code } : null, tracking,
      payment: q.total === 0 ? (q.credit ? 'credit' : 'free') : p.payment, credit: credit && q.credit ? { id: credit.id, code: credit.code, amount: q.credit } : null, answers: p.answers || {}, ticketAnswers: p.ticketAnswers || {}, optIn: !!p.optIn, smsOptIn: !!p.smsOptIn && !!normPhone(p.buyer?.phone), source: p.source || null, utm: cleanUtm(p.utm), currency: q.currency,
      platformFee: q.platformFee, ...(p.comp ? { comp: true } : {}) } };
  st.orders.push(order);
  emitEvent(st, bo.id, 'order.created', hookOrder(st, order));
  if (status === 'pending') orderContact(st, order);
  // the order now holds its seats itself (paid → tickets; unpaid → reserved until paid or expired), so this buyer's seat holds go
  for (const l of q.lines) if (l.seats?.length) st.seatStatus = (st.seatStatus || []).filter(r => !(r.event_id === l.eventId && l.seats.includes(r.seat) && [l.slotId || '', ''].includes(r.slot_id || '') && (r.status === 'checkout' || (manual && r.status === 'held'))));
  if (p.holdToken) st.seatStatus = (st.seatStatus || []).filter(r => !(r.status === 'checkout' && r.token === p.holdToken));
  if (status === 'paid') issueOrderTickets(st, order, { manual, by: asTeam?.email || DB._actor || email });
  if (manual && p.send === false) (st.outbox || []).forEach(m => { if (m.order_id === order.id && m.kind === 'confirmation') m.status = 'not sent (staff choice)'; });
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
      seat, ...(inf ? { area: inf.area, row: inf.row, seat_label: inf.seat, unit: inf.unit || null } : {}), comp, face, paid, discount, promo: discount > 0 ? code : null, tracking,
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
  allocTicketMoney(order, st.tickets.filter(t => t.order_id === order.id));   // Stage 9: each ticket's booking fee, tax and processing share
  // ONE confirmation email per order, with every ticket (the sender delivers it; transactional — never held back for marketing consent)
  if (!(st.outbox ||= []).some(m => m.order_id === order.id && m.kind === 'confirmation')) queueMail(st, order, 'confirmation', '', '', 'system');
  orderContact(st, order);
  const hk = hookOrder(st, order), ctx = orderCtx(st, order);
  emitEvent(st, order.box_office_id, 'ticket.issued', { order_ref: order.ref, tickets: hk.tickets });
  emitEvent(st, order.box_office_id, 'payment.completed', hk, ctx);
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
// the demo processor's own ledger of what it charged, refunded and took back (LIVE: processor_tx, written by the payments Edge Function)
function procTx(st, o, r) {
  (st.procTx ||= []).push({ id: r.id, box_office_id: o.box_office_id, provider: 'demo', payment: o.payment?.ref || null, type: r.type, amount: r.amount, fee: r.fee || 0, app_fee: r.app_fee || 0,
    at: r.at || nowIso(), payout_id: null, order_id: o.id });
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
  if (pay.provider === 'demo') procTx(st, order, { type: 'charge', id: 'ch_demo_' + randCode(12).toLowerCase(), amount: order.data.total, fee: order.data.processingFee || 0, app_fee: order.data.platformFee || 0 });
  issueOrderTickets(st, order, { by: order.buyer_email });
  return 'issued';
}
// Card checkouts that ran out of time: release their seats / stock (logged on each seat).
function expireOrders(st, now = Date.now()) {
  let n = 0;
  for (const o of st.orders || []) if (o.status === 'awaiting_payment' && new Date(o.expires_at) <= now) {
    o.status = 'expired'; n++;
    for (const l of o.data.lines || []) for (const u of lineUnits(l)) if (u.seat) { const ev = st.events.find(e => e.id === l.eventId); if (ev) seatLog(ev, l.slotId, u.seat, 'released', `Checkout ${o.ref} expired unpaid — seat released`, { ref: o.ref, by: 'system' }); }
    emitEvent(st, o.box_office_id, 'cart.expired', hookOrder(st, o), { ...orderCtx(st, o, []), eventId: o.event_ids[0] });
  }
  return n;
}
// what a buyer may see of their own order: never the platform's cut, the processor's cut or payment internals
function buyerOrder(o) {
  const { access_key, attempt_key, payment, ...order } = clone(o), { platformFee, processingFee, refunds, charges, ...data } = order.data;
  data.refunds = (refunds || []).map(r => ({ at: r.at, amount: r.amount, to: r.to, credit: r.credit || null, status: r.status }));   // never staff names or processor ids
  data.charges = (charges || []).map(c => ({ at: c.at, amount: c.amount, method: c.method, reason: c.reason }));
  return { ...order, data, paidWith: payment?.last4 ? `${payment.brand} •••• ${payment.last4}` : payment?.brand || null, failures: (payment?.attempts || []).filter(a => !a.ok).length };
}

/* ════════════ Orders & customers (Stage 6) ════════════
   Nothing important is overwritten. A seat / ticket type / showtime change voids the old ticket (status 'replaced', replaced_by → the new
   one) and issues a new ticket with a new code. Refunds (data.refunds), extra payments (data.charges), balance due (data.due) and credits
   are appended to the order. Every change is a row in the order's change log (orderLog / SQL order_log): original and new ticket, seat
   and price, the difference, what was refunded / credited / collected, who did it, when and why. Staff never write orders or tickets
   directly — every change goes through orderAction() (DEMO) / order_action() (SQL), which checks permissions first. */
const REFUND_TO = { original: 'Original payment method', credit: 'Account credit (any event)', eventCredit: 'Credit for one future event', cash: 'Cash', other: 'Other — recorded only' };
const PAY_METHODS = { cash: 'Cash', terminal: 'Card terminal', check: 'Check', transfer: 'Bank transfer', other: 'Other' };
const UPGRADE_SETTLE = { collect: 'Collect the difference now', due: 'Add it to the balance due', waive: 'No charge' };
const DOWNGRADE_SETTLE = { refund: 'Refund the difference', credit: 'Account credit', eventCredit: 'Future-event credit', none: 'No refund' };
const SEAT_AFTER_CANCEL = { release: 'Release the seats for sale', hold: 'Keep the seats held', block: 'Keep the seats blocked' };
const wasPaid = o => !!o.paid_at || ['paid', 'refunded'].includes(o.status);
// what an order took in and gave back. refundable = money that can still go back (refunds and credits both come out of it)
function orderMoney(o) {
  const d = o.data || {}, extra = d.extraPaid || 0, collected = (wasPaid(o) ? d.total || 0 : 0) + extra, refunded = d.refunded || 0, credited = d.credited || 0, fees = (d.fee || 0) + (d.serviceFee || 0);
  const chargedBack = (d.chargebacks || []).filter(c => c.status !== 'won').reduce((a, c) => a + (c.amount || 0), 0);   // Stage 9: the bank took it back
  return { collected, extra, refunded, credited, chargedBack, due: d.due || 0, creditUsed: d.credit && !d.credit.restored ? d.credit.amount || 0 : 0, net: collected - refunded - chargedBack,
    refundable: Math.max(0, collected - refunded - credited - chargedBack), fees, feesLeft: Math.max(0, fees - (d.refundedFees || 0)) };
}
// How much a refund request comes to. mode: full | tickets (+ their share of the booking fee when fees) | fees | percent | amount
function refundPlan(o, tickets, p = {}) {
  const m = orderMoney(o), mine = tickets.filter(t => t.order_id === o.id && t.status !== 'replaced'), per = {};
  const left = t => Math.max(0, (t.paid || 0) - (t.refunded || 0));
  let amount = 0, fees = 0;
  if (p.mode === 'full') { amount = m.refundable; fees = m.feesLeft; mine.forEach(t => { if (left(t)) per[t.id] = left(t); }); }
  else if (p.mode === 'tickets') {
    const sel = mine.filter(t => (p.tickets || []).includes(t.id)); if (!sel.length) throw new Error('Choose the tickets to refund');
    sel.forEach(t => { per[t.id] = left(t); amount += left(t); });
    if (p.fees) { fees = Math.min(m.feesLeft, Math.round(m.fees * sel.length / Math.max(1, mine.length))); amount += fees; }
  } else if (p.mode === 'fees') { fees = amount = m.feesLeft; }
  else if (p.mode === 'percent') { const pct = +p.pct; if (!(pct > 0 && pct <= 100)) throw new Error('Enter a percentage between 1 and 100'); amount = Math.round(m.refundable * pct / 100); }
  else if (p.mode === 'amount') { amount = cents(p.amount); if (amount > m.refundable) throw new Error(`You can refund at most ${money_(m.refundable)} on this order`); }
  else throw new Error('Choose how much to refund');
  amount = Math.min(amount, m.refundable);
  if (!(amount > 0)) throw new Error(m.refundable ? 'Enter an amount to refund' : 'Nothing left to refund on this order');
  return { amount, fees: Math.min(fees, amount), per };
}
// Credits (account credit / future-event credit / a credit code for guests). Remaining = amount − what orders and staff applied; revoking zeroes it.
function creditUses(c, orders) {
  return [...orders.filter(o => o.data?.credit?.id === c.id && !o.data.credit.restored && (orderCounts(o) || wasPaid(o)))
    .map(o => ({ ref: o.ref, order_id: o.id, amount: o.data.credit.amount, events: o.event_ids, at: o.created_at })), ...(c.applied || []).map(x => ({ ...x, manual: true }))];
}
function creditState(c, orders, now = Date.now()) {
  const uses = creditUses(c, orders), used = uses.reduce((a, x) => a + (x.amount || 0), 0), remaining = c.revoked_at ? 0 : Math.max(0, c.amount - used);
  return { uses, used, remaining, status: c.revoked_at ? 'revoked' : remaining <= 0 ? 'used' : c.expires && new Date(c.expires) <= now ? 'expired' : 'active' };
}
const creditProblem = (c, s, eventIds) => !c ? 'That credit code is not valid' : s.status === 'revoked' ? 'That credit was cancelled' : s.status === 'expired' ? 'That credit has expired'
  : s.status === 'used' ? 'That credit has been used up' : c.event_id && !eventIds.includes(c.event_id) ? 'That credit is for a different event' : '';
// the part of a priced cart a credit for one event may pay for
const eventPortion = (q, evId) => q.lines.filter(l => l.eventId === evId).reduce((a, l) => a + l.unit * l.qty - (l.disc || 0) + (l.fee || 0) - (l.feeDisc || 0), 0);
// "Dinner × 2" strings on an event's tickets, from the order's product lines (after products were added or removed)
const orderExtras = (o, evId) => o.data.lines.filter(l => l.eventId === evId && l.kind === 'addon' && l.qty - (l.removed || 0) > 0).map(l => `${l.name} × ${l.qty - (l.removed || 0)}`);

/* ════════════ Reports, money & reconciliation (Stage 9) ════════════
   Every money figure comes from what the orders and tickets stored — nothing is recalculated from today's prices. finItems() turns each paid
   order into items: one per ticket (face value, collected, discount, comp, booking fee, tax, card processing, refund, credit — the ticket's own
   fields), one per product line, the products inside a package, and one "order" item holding what isn't any single ticket's (donations,
   card fees passed on, credit used, later order changes, refunds / credits not tied to a ticket, chargebacks, the platform fee). The items of
   an order always add up to exactly what the order collected, so every filter, total and export reconciles. */
const CB_STATUS = { open: 'Open — the bank is holding the money', won: 'Won — money returned', lost: 'Lost' };
const PAY_LABEL = { card: 'Card', apple_pay: 'Apple Pay', google_pay: 'Google Pay', cash: 'Cash', terminal: 'Card terminal', check: 'Check', transfer: 'Bank transfer', other: 'Other (offline)',
  offline: 'Pay later (marked paid)', free: 'Free', comp: 'Complimentary', credit: 'Paid with credit' };
const OFFLINE_PAY = ['cash', 'terminal', 'check', 'transfer', 'other', 'offline'];
const EXPENSE_CATS = ['Venue', 'AV', 'Security', 'Marketing', 'Talent', 'Staffing', 'Food', 'Transportation', 'Insurance', 'Other'];
const emptyFin = () => ({ eventId: '', slotId: '', from: '', to: '', ttId: '', area: '', price: '', promo: '', tracking: '', addonId: '', bundleId: '', method: '', customer: '' });
const FIN_SUM = ['tface', 'pface', 'comp', 'discount', 'savings', 'fees', 'tax', 'donation', 'cardFee', 'creditUsed', 'changes', 'collected', 'refunds', 'credits', 'chargebacks', 'processing', 'platform',
  'offline', 'ticketRev', 'productRev', 'bundleRev', 'sold', 'comps', 'refundedTickets'];
const localDay = iso => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function payMethodOf(o) {
  const d = o.data || {}, p = o.payment || {};
  if (d.comp) return 'comp';
  if (p.provider === 'manual') return PAY_LABEL[p.method] ? p.method : 'other';
  if (p.markedPaidBy) return PAY_LABEL[p.method] && p.method !== 'card' ? p.method : 'offline';
  if (p.provider) return ['apple_pay', 'google_pay'].includes(p.method) ? p.method : 'card';
  return d.payment === 'credit' ? 'credit' : d.payment === 'offline' ? 'offline' : 'free';
}
const chargebacksOf = o => (o.data?.chargebacks || []).filter(c => c.status !== 'won').reduce((a, c) => a + (c.amount || 0), 0);
// each ticket's share of the order's booking fee (+ the platform's service fee when the buyer pays it), sales tax and card processing cost.
// Set once when the tickets are issued; products and donations keep the rest on the order. Mirrors SQL alloc_ticket_money().
function allocTicketMoney(order, tks) {
  const d = order.data, adds = d.lines.filter(l => l.kind === 'addon').map(l => Math.max(0, l.unit * l.qty - (l.disc || 0))), pw = tks.map(t => t.paid || 0);
  const fees = spread((d.fee || 0) + (d.serviceFee || 0), pw), tax = spread(d.tax || 0, [...pw, ...adds]);
  const proc = spread(d.processingFee || 0, [...pw.map((x, i) => x + fees[i] + tax[i]), ...adds.map((x, j) => x + tax[tks.length + j]), d.donation || 0]);
  tks.forEach((t, i) => Object.assign(t, { fee: fees[i] || 0, tax: tax[i] || 0, proc: proc[i] || 0, credited: t.credited || 0 }));
}
// the items of every paid order (see the block comment). x = {orders, tickets}
function finItems(x) {
  const out = [], byOrder = {};
  for (const t of x.tickets) if (t.status !== 'replaced') (byOrder[t.order_id] ||= []).push(t);
  for (const o of x.orders) {
    if (!wasPaid(o)) continue;
    const d = o.data, m = orderMoney(o), method = payMethodOf(o), day = localDay(o.paid_at || o.created_at), base = { orderId: o.id, ref: o.ref, method, day, promo: d.code || '', tracking: d.tracking || '', email: o.buyer_email };
    const tks = byOrder[o.id] || [], made = [];
    for (const t of tks) {
      const paid = t.paid || 0, fee = t.fee || 0, tax = t.tax || 0, cred = t.credited || 0, comp = !!t.comp;
      made.push({ ...base, kind: 'ticket', eventId: t.event_id, slotId: t.slot_id || '', ttId: t.ticket_type_id, area: t.area || '', price: t.face || 0, bundleId: t.bundle?.id || '', addonId: '', ticket: t,
        promo: t.promo || '', tface: comp ? 0 : t.face || 0, comp: comp ? t.face || 0 : 0, discount: comp ? 0 : t.discount || 0, savings: comp ? 0 : (t.face || 0) - paid - (t.discount || 0),
        fees: fee, tax, collected: paid + fee + tax, refunds: (t.refunded || 0) - cred, credits: cred, processing: t.proc || 0, ticketRev: paid, bundleRev: t.bundle ? paid : 0,
        sold: t.status === 'valid' ? 1 : 0, comps: comp && t.status === 'valid' ? 1 : 0, refundedTickets: t.refunded > 0 ? 1 : 0 });
    }
    const extra = [];   // products, and the products' share of package prices
    for (const l of d.lines) {
      if (l.kind === 'addon') extra.push({ ...base, kind: 'addon', eventId: l.eventId, addonId: l.addonId, name: l.name, qty: l.qty - (l.removed || 0), pface: l.face * l.qty, discount: l.disc || 0, paid: l.unit * l.qty - (l.disc || 0) });
      if (l.kind === 'bundle') {
        const mine = made.filter(i => i.bundleId === l.bundleId && i.eventId === l.eventId), lineDisc = l.disc || 0, paid = l.unit * l.qty - lineDisc - mine.reduce((a, i) => a + i.ticketRev, 0);
        const pface = l.qty * (l.addons || []).reduce((a, x) => a + x.face * x.qty, 0), disc = Math.max(0, lineDisc - mine.reduce((a, i) => a + i.discount, 0));
        if (pface || paid) extra.push({ ...base, kind: 'bundleExtra', eventId: l.eventId, bundleId: l.bundleId, addonId: '', name: l.name, pface, discount: disc, paid, bundle: true });
      }
    }
    const tTax = made.reduce((a, i) => a + i.tax, 0), tProc = made.reduce((a, i) => a + i.processing, 0);
    const xTax = spread(Math.max(0, (d.tax || 0) - tTax), extra.map(e => e.paid)), xProc = spread(Math.max(0, (d.processingFee || 0) - tProc), [...extra.map((e, j) => e.paid + (extra.length ? xTax[j] : 0)), d.donation || 0]);
    extra.forEach((e, j) => { const tax = xTax[j] || 0; Object.assign(e, { savings: e.pface - e.paid - e.discount, tax, collected: e.paid + tax, processing: xProc[j] || 0, productRev: e.paid, bundleRev: e.bundle ? e.paid : 0 }); made.push(e); });
    const S = k => made.reduce((a, i) => a + (i[k] || 0), 0), credUsed = m.creditUsed;
    const rest = { ...base, kind: 'order', eventId: o.event_ids[0], slotId: '', ttId: '', area: '', price: '', bundleId: '', addonId: '',
      fees: (d.fee || 0) + (d.serviceFee || 0) - S('fees'), tax: extra.length ? 0 : (d.tax || 0) - tTax, donation: d.donation || 0, cardFee: d.processing || 0, creditUsed: -credUsed,
      refunds: (d.refunded || 0) - S('refunds'), credits: (d.credited || 0) - S('credits'), chargebacks: chargebacksOf(o), processing: (d.processingFee || 0) - S('processing'),
      platform: d.platformFee || 0, offline: (OFFLINE_PAY.includes(method) ? d.total || 0 : 0) + (d.charges || []).reduce((a, c) => a + (c.amount || 0), 0) };
    rest.collected = m.collected - S('collected');
    rest.changes = rest.collected - rest.fees - rest.tax - rest.donation - rest.cardFee - rest.creditUsed;   // later charges, upgrades, removed products…
    out.push(...made, rest);
  }
  return out;
}
const finItemLevel = f => !!(f.slotId || f.ttId || f.area || (f.price !== '' && f.price != null) || f.bundleId || f.addonId);
function finMatch(i, f) {
  if (f.eventId && i.eventId !== f.eventId) return false;
  if (f.from && i.day < f.from) return false; if (f.to && i.day > f.to) return false;
  if (f.promo && String(i.promo).toUpperCase() !== String(f.promo).toUpperCase()) return false;
  if (f.tracking && i.tracking !== f.tracking) return false;
  if (f.method && i.method !== f.method) return false;
  if (f.customer && !String(i.email || '').includes(String(f.customer).trim().toLowerCase())) return false;
  if (!finItemLevel(f)) return true;
  if (f.addonId) return i.kind === 'addon' && i.addonId === f.addonId;
  if (f.bundleId) return (i.kind === 'ticket' || i.kind === 'bundleExtra') && i.bundleId === f.bundleId && (!f.slotId || i.slotId === f.slotId);
  return i.kind === 'ticket' && (!f.slotId || i.slotId === f.slotId) && (!f.ttId || i.ttId === f.ttId) && (!f.area || i.area === f.area) && (f.price === '' || f.price == null || i.price === +f.price);
}
function finTotals(items) {
  const t = Object.fromEntries(FIN_SUM.map(k => [k, 0])), orders = new Set();
  for (const i of items) { for (const k of FIN_SUM) t[k] += i[k] || 0; orders.add(i.orderId); }
  t.orders = orders.size;
  t.net = t.collected - t.refunds - t.credits - t.chargebacks - t.processing;   // Eli's "Net collected"
  t.netBo = t.net - t.platform;                                                // what the box office keeps after the platform's fee
  t.gross = t.tface; t.revenue = t.collected - t.tax;                           // sales tax is owed to the state, not revenue
  return t;
}
// The whole report for one set of filters: totals, potential sellout, unpaid / failed payments, and grouping by any dimension.
// x = {events, orders, tickets, statuses, expenses, expenseFinal}
function finReport(x, f = {}) {
  f = { ...emptyFin(), ...f };
  const all = x._items || (x._items = finItems(x)), items = all.filter(i => finMatch(i, f)), t = finTotals(items), partial = finItemLevel(f);
  const evs = x.events.filter(e => !f.eventId || e.id === f.eventId);
  let potential = 0, remaining = 0;
  for (const e of evs) {
    const so = sellout(e, x.tickets, x.statuses || [], x.orders);
    const row = f.ttId ? so.byTT.find(r => r.tt.id === f.ttId) : null, ar = f.area ? so.byArea.find(r => r.name === f.area) : null;
    if (f.ttId) { if (row) { potential += row.potential; remaining += Math.max(0, row.potential - row.soldValue); } }
    else if (f.area) { if (ar) { potential += ar.potential; remaining += ar.remaining; } }
    else { potential += so.total; remaining += so.remaining; }
  }
  const om = o => (!f.eventId || o.event_ids.includes(f.eventId)) && (!f.from || localDay(o.created_at) >= f.from) && (!f.to || localDay(o.created_at) <= f.to)
    && (!f.promo || String(o.data.code || '').toUpperCase() === String(f.promo).toUpperCase()) && (!f.tracking || o.data.tracking === f.tracking) && (!f.customer || o.buyer_email.includes(String(f.customer).trim().toLowerCase()));
  const unpaid = x.orders.filter(o => o.status === 'pending' && om(o)), failedOs = x.orders.filter(o => om(o) && (o.payment?.attempts || []).some(a => !a.ok));
  const exp = (x.expenses || []).filter(e => evs.some(v => v.id === e.event_id)), expenses = exp.reduce((a, e) => a + (e.amount || 0), 0);
  const final = evs.length > 0 && evs.every(e => x.expenseFinal?.[e.id]);
  const profit = t.revenue - t.refunds - t.credits - t.chargebacks - t.processing - t.platform - expenses;
  return { f, items, totals: { ...t, potential, remaining, unpaid: unpaid.reduce((a, o) => a + (o.data.total || 0), 0), unpaidOrders: unpaid.length,
    failedPayments: failedOs.reduce((a, o) => a + o.payment.attempts.filter(z => !z.ok).length, 0), failedOrders: failedOs.length, failedUnpaid: failedOs.filter(o => !wasPaid(o)).length,
    expenses, profit, profitFinal: final }, partial, expenses: exp };
}
// group a report's items: key = event | day | month | method | tt | area | promo | tracking | product | bundle | slot
function finGroup(rep, key, label = k => k) {
  const g = {};
  for (const i of rep.items) {
    const k = key === 'event' ? i.eventId : key === 'day' ? i.day : key === 'month' ? i.day.slice(0, 7) : key === 'method' ? i.method : key === 'tt' ? (i.kind === 'ticket' ? i.ttId : '') : key === 'area' ? (i.kind === 'ticket' ? i.area : '')
      : key === 'promo' ? i.promo : key === 'tracking' ? i.tracking : key === 'product' ? (i.kind === 'addon' ? i.addonId : '') : key === 'bundle' ? i.bundleId : key === 'slot' ? (i.kind === 'ticket' ? i.slotId : '') : '';
    if (!k && !['event', 'day', 'month', 'method'].includes(key)) continue;
    (g[k] ||= []).push(i);
  }
  return Object.entries(g).map(([k, list]) => ({ key: k, label: label(k), ...finTotals(list) }));
}
// Each ticket's financial history (Eli Step 9 §4), straight from the ticket.
const ticketFin = t => ({ face: t.face || 0, paid: t.paid || 0, discount: t.discount || 0, promo: t.promo || '', comp: !!t.comp, fee: t.fee || 0, tax: t.tax || 0, proc: t.proc || 0,
  refund: (t.refunded || 0) - (t.credited || 0), credit: t.credited || 0, net: (t.paid || 0) + (t.fee || 0) + (t.tax || 0) - (t.proc || 0) - (t.refunded || 0) });

/* ── Payouts & reconciliation ──
   SET's side: what each card payment should have done at the processor (charge, its fee, the platform's application fee, refunds to the card,
   chargebacks). The processor's side: its own transactions (procTx — written by the processor: the demo processor here, the payments Edge
   Function's webhooks LIVE) or a report exported from the processor and imported. Matched by the processor's payment id. */
function platformTx(orders) {
  const out = {};
  for (const o of orders) {
    const p = o.payment || {}; if (!p.ref || p.provider === 'manual' || !wasPaid(o)) continue;
    const refunds = (o.data.refunds || []).filter(r => r.to === 'original' && r.status === 'done' && (r.provider || r.payment)).reduce((a, r) => a + r.amount, 0);
    out[p.ref] = { ref: p.ref, orderId: o.id, orderRef: o.ref, eventId: o.event_ids[0], day: localDay(o.paid_at || o.created_at), charged: o.data.total || 0, fee: o.data.processingFee || 0,
      app: o.data.platformFee || 0, refunded: refunds, disputed: chargebacksOf(o) };
  }
  return out;
}
function processorSide(tx) {
  const out = {};
  for (const r of tx) {
    const k = r.payment || r.id, s = out[k] ||= { ref: k, charged: 0, fee: 0, app: 0, refunded: 0, disputed: 0, day: r.at ? localDay(r.at) : '', payouts: new Set() };
    if (r.type === 'charge') { s.charged += r.amount; s.fee += r.fee || 0; s.app += r.app_fee || 0; if (r.at) s.day = localDay(r.at); }
    else if (r.type === 'refund') s.refunded += -r.amount;
    else if (r.type === 'dispute') s.disputed += -r.amount;
    else if (r.type === 'dispute_won') s.disputed -= r.amount;
    if (r.payout_id) s.payouts.add(r.payout_id);
  }
  return out;
}
const RECON_FIELDS = [['charged', 'Charged'], ['fee', 'Processing fee'], ['app', 'Platform fee'], ['refunded', 'Refunded'], ['disputed', 'Chargebacks']];
function reconcile(orders, tx, f = {}) {
  const P = platformTx(orders), Q = processorSide(tx), rows = [];
  for (const k of new Set([...Object.keys(P), ...Object.keys(Q)])) {
    const a = P[k], b = Q[k], diffs = a && b ? RECON_FIELDS.filter(([z]) => (a[z] || 0) !== (b[z] || 0)).map(([z, l]) => ({ field: z, label: l, set: a[z] || 0, processor: b[z] || 0 })) : [];
    const status = !a ? 'not in SET' : !b ? 'missing at processor' : diffs.length ? 'different' : 'matched';
    const net = s => s ? s.charged - s.fee - s.app - s.refunded - s.disputed : 0;
    rows.push({ ref: k, status, diffs, set: a || null, processor: b || null, eventId: a?.eventId || '', day: a?.day || b?.day || '', orderRef: a?.orderRef || '', setNet: net(a), procNet: net(b), diff: net(b) - net(a) });
  }
  const sel = rows.filter(r => (!f.eventId || r.eventId === f.eventId) && (!f.from || r.day >= f.from) && (!f.to || r.day <= f.to));
  const by = key => { const g = {}; for (const r of sel) { const z = g[r[key] || '—'] ||= { key: r[key] || '—', setNet: 0, procNet: 0, diff: 0, issues: 0, n: 0 }; z.setNet += r.setNet; z.procNet += r.procNet; z.diff += r.diff; z.n++; if (r.status !== 'matched') z.issues++; }
    return Object.values(g).sort((p, q) => String(q.key).localeCompare(String(p.key))); };
  return { rows: sel, byEvent: by('eventId'), byDay: by('day'), issues: sel.filter(r => r.status !== 'matched'),
    totals: { setNet: sel.reduce((a, r) => a + r.setNet, 0), procNet: sel.reduce((a, r) => a + r.procNet, 0), diff: sel.reduce((a, r) => a + r.diff, 0) } };
}
function payoutSummary(payouts, tx) {
  const sum = st => payouts.filter(p => st.includes(p.status)).reduce((a, p) => a + p.amount, 0);
  const unpaidTx = tx.filter(r => !r.payout_id), pending = unpaidTx.reduce((a, r) => a + (r.amount - (r.fee || 0) - (r.app_fee || 0)), 0);
  return { processed: tx.filter(r => r.type === 'charge').reduce((a, r) => a + r.amount, 0), completed: sum(['paid']), inTransit: sum(['pending', 'in_transit']), failed: sum(['failed', 'canceled']),
    failedN: payouts.filter(p => ['failed', 'canceled'].includes(p.status)).length, pending: pending + sum(['pending', 'in_transit']), notYetPaidOut: pending };
}
// A processor's own export (Stripe "Balance transactions" / "Payments" CSV, or any CSV with reference + amount columns) → procTx rows.
function parseProcessorCsv(text) {
  const rows = parseCsv(text); if (rows.length < 2) throw new Error('That file has no rows');
  const H = rows[0].map(h => h.trim().toLowerCase()), col = (...names) => { for (const n of names) { const i = H.indexOf(n); if (i >= 0) return i; } return -1; };
  const iRef = col('paymentintent id', 'payment_intent', 'payment intent', 'source', 'charge id', 'reference', 'transaction id', 'id'), iAmt = col('amount', 'gross'), iFee = col('fee', 'fees');
  const iType = col('type', 'reporting category', 'reporting_category'), iAt = col('created (utc)', 'created', 'date', 'available on (utc)'), iRefunded = col('amount refunded', 'refunded amount');
  if (iRef < 0 || iAmt < 0) throw new Error('Couldn\'t find a reference column and an amount column in that file');
  const c = v => Math.round(parseFloat(String(v || '0').replace(/[$,\s]/g, '')) * 100) || 0, out = [];
  for (const r of rows.slice(1)) {
    if (!r[iRef]) continue;
    const type = String(r[iType] || 'charge').toLowerCase(), amount = c(r[iAmt]), at = r[iAt] ? new Date(r[iAt].replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(r[iAt]) ? '' : 'Z')).toISOString() : null;
    const kind = /refund/.test(type) ? 'refund' : /dispute|chargeback/.test(type) ? 'dispute' : /payout|transfer|adjust/.test(type) ? null : 'charge';
    if (!kind) continue;
    out.push({ id: 'imp_' + out.length, payment: r[iRef].trim(), type: kind, amount: kind === 'charge' ? Math.abs(amount) : -Math.abs(amount), fee: iFee >= 0 ? Math.abs(c(r[iFee])) : 0, at });
    if (kind === 'charge' && iRefunded >= 0 && c(r[iRefunded])) out.push({ id: 'imp_' + out.length, payment: r[iRef].trim(), type: 'refund', amount: -Math.abs(c(r[iRefunded])), fee: 0, at });
  }
  return out;
}
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
// Expense rows from a spreadsheet: date, category, description, amount (any order; headers matched by name)
function parseExpenseCsv(text) {
  const rows = parseCsv(text); if (rows.length < 2) throw new Error('That file has no rows');
  const H = rows[0].map(h => h.trim().toLowerCase()), at = n => H.findIndex(h => h.includes(n));
  const iAmt = at('amount'), iCat = at('categ'), iDesc = Math.max(at('desc'), at('item')), iDate = at('date'), iVen = at('vendor');
  if (iAmt < 0) throw new Error('Add an "Amount" column');
  return rows.slice(1).map(r => ({ amount: Math.round(parseFloat(String(r[iAmt] || '').replace(/[$,\s]/g, '')) * 100) || 0, category: EXPENSE_CATS.find(c => c.toLowerCase() === String(r[iCat] || '').trim().toLowerCase()) || 'Other',
    description: String(r[iDesc] ?? '').trim().slice(0, 200), vendor: iVen >= 0 ? String(r[iVen] || '').trim().slice(0, 120) : '', date: iDate >= 0 && r[iDate] ? String(r[iDate]).trim().slice(0, 10) : '' })).filter(r => r.amount > 0);
}

/* ── Accounting (QuickBooks / Xero / any ledger) ── a daily journal from the report: every day balances (debits = credits).
   Direct sync needs an OAuth app with Intuit / Xero (ACCOUNTING_PROVIDERS); until then the journal imports into either. */
const ACCOUNTS = [['clearing', 'Processor clearing / undeposited funds', '1200'], ['tickets', 'Ticket sales', '4000'], ['products', 'Product & add-on sales', '4010'], ['fees', 'Booking fee income', '4020'],
  ['donations', 'Donations', '4030'], ['cardFees', 'Card fees recovered', '4040'], ['changes', 'Order changes & adjustments', '4050'], ['tax', 'Sales tax payable', '2200'], ['credit', 'Customer credit (liability)', '2300'],
  ['refunds', 'Refunds', '4900'], ['chargebacks', 'Chargebacks', '6010'], ['processing', 'Card processing fees', '6000'], ['platform', 'Ticketing platform fees', '6020']];
const ACCOUNTING_PROVIDERS = [['quickbooks', 'QuickBooks Online', 'Needs an Intuit Developer app (OAuth) — then daily journals post automatically'], ['xero', 'Xero', 'Needs a Xero app (OAuth) — then daily journals post automatically'],
  ['api', 'Any other system', 'Read-only API keys + signed webhooks (Marketing → Integrations), or the journal / exports below']];
function journal(rep, accounts = {}) {
  const A = k => accounts[k] || ACCOUNTS.find(a => a[0] === k)[1], days = finGroup(rep, 'day').sort((a, b) => a.key.localeCompare(b.key)), out = [];
  for (const d of days) {
    const L = (acct, dr, cr, memo) => { const v = dr - cr; if (v) out.push({ date: d.key, account: A(acct), key: acct, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0, memo }); };
    L('clearing', d.collected, 0, 'Collected'); L('credit', -d.creditUsed, 0, 'Customer credit used');
    L('tickets', 0, d.ticketRev, 'Tickets'); L('products', 0, d.productRev, 'Products & package extras');
    L('fees', 0, d.fees, 'Booking fees'); L('tax', 0, d.tax, 'Sales tax'); L('donations', 0, d.donation, 'Donations'); L('cardFees', 0, d.cardFee, 'Card fees paid by buyers'); L('changes', 0, d.changes, 'Order changes');
    L('refunds', d.refunds, 0, 'Refunds to customers'); L('clearing', 0, d.refunds, 'Refunds paid out');
    L('refunds', d.credits, 0, 'Refunded as credit'); L('credit', 0, d.credits, 'Credit issued');
    L('chargebacks', d.chargebacks, 0, 'Chargebacks'); L('clearing', 0, d.chargebacks, 'Chargebacks');
    L('processing', d.processing, 0, 'Card processing'); L('clearing', 0, d.processing, 'Card processing');
    L('platform', d.platform, 0, 'Platform fees'); L('clearing', 0, d.platform, 'Platform fees');
  }
  return out;
}

/* ── DEMO server side of orderAction() ── */
function issueCreditRow(st, boId, c) {
  const email = String(c.email || '').trim().toLowerCase(), amount = cents(c.amount);
  if (!EMAIL_RE.test(email)) throw new Error('The credit needs the customer\'s email');
  if (!(amount > 0)) throw new Error('Enter a credit amount');
  if (c.eventId && !st.events.some(e => e.id === c.eventId && e.box_office_id === boId)) throw new Error('Unknown event');
  let code; do { code = 'CR-' + randCode(8); } while ((st.credits ||= []).some(x => x.code === code));
  const row = { id: uid(), box_office_id: boId, code, email, name: String(c.name || '').slice(0, 120), amount, event_id: c.eventId || null, expires: c.expires || null,
    source_order: c.order?.id || null, source_ref: c.order?.ref || null, note: String(c.note || '').slice(0, 300), issued_by: c.by, issued_at: nowIso(), revoked_at: null, revoked_by: null, applied: [] };
  st.credits.push(row); return row;
}
function applyRefund(st, o, plan, p, by) {
  const d = o.data, to = p.to || 'original';
  if (!REFUND_TO[to]) throw new Error('Choose where the refund goes');
  const r = { id: uid(), at: nowIso(), by, amount: plan.amount, fees: plan.fees, to, note: String(p.note || '').slice(0, 300), per: plan.per, status: 'done', ref: null };
  if (to === 'credit' || to === 'eventCredit') {
    if (to === 'eventCredit' && !p.creditEvent) throw new Error('Choose the event the credit is for');
    const c = issueCreditRow(st, o.box_office_id, { email: o.buyer_email, name: d.buyer.name, amount: plan.amount, eventId: to === 'eventCredit' ? p.creditEvent : null, expires: p.creditExpires || null, order: o, note: r.note || 'Refunded as credit', by });
    r.credit = c.code; d.credited = (d.credited || 0) + plan.amount;
  } else {
    // the processor refunds the card: DEMO's test processor at once; LIVE the payments Edge Function (order_action leaves it 'processing')
    if (to === 'original' && o.payment?.ref) { r.provider = o.payment.provider; r.ref = 're_demo_' + randCode(12).toLowerCase(); }
    d.refunded = (d.refunded || 0) + plan.amount;
  }
  d.refundedFees = (d.refundedFees || 0) + plan.fees;
  for (const [id, v] of Object.entries(plan.per)) { const t = st.tickets.find(x => x.id === id); if (t) { t.refunded = (t.refunded || 0) + v; if (r.credit) t.credited = (t.credited || 0) + v; } }
  (d.refunds ||= []).push(r);
  if (r.provider === 'demo') procTx(st, o, { type: 'refund', id: r.ref, amount: -r.amount });
  return r;
}
const refundText = r => `${money_(r.amount)} ${r.to === 'credit' || r.to === 'eventCredit' ? `as credit ${r.credit}` : 'to ' + REFUND_TO[r.to].toLowerCase()}`;
// all tickets voided and no products left → the order is cancelled (refunded when everything collected went back)
function settleOrderStatus(st, o) {
  if (st.tickets.some(t => t.order_id === o.id && t.status === 'valid') || o.data.lines.some(l => l.kind === 'addon' && l.qty - (l.removed || 0) > 0)) return;
  const m = orderMoney(o); o.status = m.collected > 0 && m.refunded + m.credited >= m.collected ? 'refunded' : 'cancelled';
}
// Move / upgrade / downgrade / change type, section or showtime — one ticket or many. Old ticket → 'replaced'; a new ticket is issued.
// Price: same type + same showtime price keeps what was paid; otherwise the new type's current price (minus the same discount), or a staff
// override. The net difference is settled once: upgrades collect | due | waive, downgrades refund | credit | eventCredit | none.
// what a changed ticket costs: same type + same showtime price keeps what was paid; else the new type's current price (phases count) minus
// the same discount; a staff override wins. diff = new − paid (comps stay at $0). Used by the order screen's preview and by the server.
function changePrice(ev, t, tt, slot, sold, now, override) {
  const oldTT = ev.ticketTypes.find(z => z.id === t.ticket_type_id), same = tt.id === t.ticket_type_id && listPrice(tt, slot) === listPrice(oldTT, t.slot_id);
  const ovr = override !== undefined && override !== null && override !== '', face = same ? t.face : ttPrices(tt, slot, sold || 0, 1, 1, now || new Date())[0].price;
  const newPaid = t.comp ? 0 : ovr ? cents(override) : same ? t.paid : Math.max(0, face - (t.discount || 0));
  return { face, newPaid, diff: t.comp ? 0 : newPaid - (t.paid || 0) };
}
function changeOrderTickets(st, o, p, by, inventory = false) {
  const items = (p.changes || []).filter(c => c && c.ticket), d = o.data, now = new Date();
  if (!items.length) throw new Error('Choose at least one ticket to change');
  if (o.status !== 'paid') throw new Error('Only paid orders can be changed');
  const vacate = new Set(items.map(c => c.ticket)), plan = [], states = {};
  const stateOf = (ev, slot, seat) => (states[ev.id + '|' + slot] ||= seatStates(ev, { tickets: st.tickets, statuses: st.seatStatus, orders: st.orders, slotId: slot })).get(seat);
  for (const c of items) {
    const t = st.tickets.find(x => x.id === c.ticket && x.order_id === o.id);
    if (!t || t.status !== 'valid') throw new Error('That ticket is no longer valid — reload the order');
    const ev = st.events.find(e => e.id === t.event_id), seated = !!ev.seating?.enabled;
    const slot = c.slotId !== undefined ? c.slotId || null : t.slot_id || null;
    if ((ev.timeSlots || []).length && !ev.timeSlots.some(s => s.id === slot)) throw new Error('Choose a showtime');
    const seat = seated ? (c.seat !== undefined ? c.seat || null : t.seat) : null;
    if (seated && !ev.seating.meta?.[seat]) throw new Error('Choose the new seat');
    const ttId = seated ? ev.seating.index?.[seat] : c.ticketTypeId || t.ticket_type_id, tt = ev.ticketTypes.find(x => x.id === ttId);
    if (!tt) throw new Error(seated ? `${seatText(ev, seat)} is not for sale` : 'Unknown ticket type');
    const ovr = c.price !== undefined && c.price !== null && c.price !== '';
    if (seat === t.seat && slot === (t.slot_id || null) && tt.id === t.ticket_type_id && !ovr) throw new Error(`Ticket ${t.code}: nothing to change`);
    plan.push({ t, ev, tt, seat, slot, ovr, c });
  }
  // seats must be free — or vacated by this same change; staff may use held seats; never blocked / unavailable / in someone's checkout
  const chosen = new Set();
  for (const x of plan) if (x.seat) {
    const k = x.ev.id + '|' + (x.slot || '') + '|' + x.seat; if (chosen.has(k)) throw new Error(`${seatText(x.ev, x.seat)} is chosen twice`); chosen.add(k);
    const s = stateOf(x.ev, x.slot || '', x.seat);
    if (!s || !(s.state === 'available' || s.state === 'held' || (s.t && vacate.has(s.t.id)))) throw new Error(`${seatText(x.ev, x.seat)} isn't free (${(SEAT_STATES[s?.state] || 'unavailable').toLowerCase()})`);
  }
  // ticket-type stock and showtime capacity, net of the tickets this change gives back
  const avs = {}, av = ev => avs[ev.id] ||= availabilityFrom(st.tickets, ev.id, [], '', st.orders);
  for (const ev of new Set(plan.map(x => x.ev))) {
    for (const tt of ev.ticketTypes) { const add = plan.filter(x => x.ev === ev && x.tt.id === tt.id).length - plan.filter(x => x.ev === ev && x.t.ticket_type_id === tt.id).length;
      if (add > 0 && +tt.qty > 0 && (av(ev).tt[tt.id] || 0) + add > +tt.qty) throw new Error(`Only ${Math.max(0, +tt.qty - (av(ev).tt[tt.id] || 0))} ${tt.name} left`); }
    for (const s of ev.timeSlots || []) { const add = plan.filter(x => x.ev === ev && x.slot === s.id).length - plan.filter(x => x.ev === ev && x.t.slot_id === s.id).length;
      if (add > 0 && +s.capacity > 0 && (av(ev).slots[s.id] || 0) + add > +s.capacity) throw new Error('That showtime is full'); }
  }
  if (plan.some(x => x.ovr) && !inventory) need('tickets.pricing', o.event_ids[0]);
  for (const x of plan) Object.assign(x, changePrice(x.ev, x.t, x.tt, x.slot, av(x.ev).tt[x.tt.id] || 0, now, x.ovr ? x.c.price : null));
  const net = plan.reduce((a, x) => a + x.diff, 0), m = orderMoney(o);
  if (inventory && net) throw new Error('That seat is a different price level — use Change seats on the order to upgrade or downgrade');
  if (net > 0 && !UPGRADE_SETTLE[p.settle]) throw new Error(`Choose how to handle the ${money_(net)} difference`);
  if (net < 0 && !DOWNGRADE_SETTLE[p.downgrade]) throw new Error(`Choose what to do with the ${money_(-net)} difference`);
  if (net > 0 && p.settle === 'collect') { need('orders.edit', o.event_ids[0]); if (!PAY_METHODS[p.method]) throw new Error('Choose how the difference was paid'); }
  if (net < 0 && p.downgrade !== 'none') { need('orders.refund', o.event_ids[0]); if (-net > m.refundable) throw new Error(`Only ${money_(m.refundable)} can still be refunded on this order`); }
  const keepPaid = (net > 0 && p.settle === 'waive') || (net < 0 && p.downgrade === 'none'), rows = [];
  for (const x of plan) {
    const t = x.t, inf = x.seat ? seatInfo(x.ev, x.seat) : null, paid = keepPaid ? t.paid : x.newPaid;
    const nt = { ...clone(t), id: uid(), ticket_type_id: x.tt.id, slot_id: x.slot, seat: x.seat, area: inf?.area ?? null, row: inf?.row ?? null, seat_label: inf?.seat ?? null, unit: inf?.unit || null,
      face: x.face, paid, discount: t.comp ? 0 : x.ovr ? Math.max(0, x.face - paid) : (t.discount || 0) + (keepPaid && x.diff > 0 ? x.diff : 0), price_override: x.ovr || !!t.price_override,
      refunded: 0, credited: 0, code: randCode(10), status: 'valid', replaces: t.id, issued_at: nowIso() };
    delete nt.replaced_by; delete nt.changed_at;
    Object.assign(t, { status: 'replaced', replaced_by: nt.id, changed_at: nowIso() }); st.tickets.push(nt);
    const from = t.seat ? seatText(x.ev, t.seat) : x.ev.ticketTypes.find(z => z.id === t.ticket_type_id)?.name, to = x.seat ? seatText(x.ev, x.seat) : x.tt.name;
    const kind = x.diff > 0 ? 'upgrade' : x.diff < 0 ? 'downgrade' : 'move', slotTxt = s => s ? ' · ' + new Date(x.ev.timeSlots.find(z => z.id === s)?.start).toLocaleString() : '';
    if (t.seat && (t.seat !== x.seat || (t.slot_id || null) !== x.slot)) seatLog(x.ev, t.slot_id, t.seat, 'moved', `${t.holder} moved to ${to}${x.slot !== (t.slot_id || null) ? slotTxt(x.slot) : ''} — seat released`, { ref: o.ref, by });
    if (x.seat) {
      st.seatStatus = (st.seatStatus || []).filter(r => !(r.event_id === x.ev.id && r.seat === x.seat && r.status === 'held' && [x.slot || '', ''].includes(r.slot_id || '')));
      if (t.seat !== x.seat || (t.slot_id || null) !== x.slot) seatLog(x.ev, x.slot, x.seat, 'moved', `${t.holder} moved here from ${from}${kind !== 'move' ? ` · ${kind} ${money_(Math.abs(x.diff))}` : ''}`, { ref: o.ref, by });
    }
    rows.push({ kind, diff: x.diff, from: { ticket: t.code, type: x.ev.ticketTypes.find(z => z.id === t.ticket_type_id)?.name || '', seat: t.seat ? seatText(x.ev, t.seat) : null, slot: t.slot_id || null, face: t.face, paid: t.paid },
      to: { ticket: nt.code, type: x.tt.name, seat: x.seat ? seatText(x.ev, x.seat) : null, slot: x.slot, face: nt.face, paid: nt.paid } });
  }
  const out = { net, tickets: rows }, note = p.note;
  if (net > 0 && p.settle === 'collect') { const ch = { id: uid(), at: nowIso(), by, amount: net, method: p.method, ref: String(p.ref || '').slice(0, 80), reason: 'Upgrade difference' }; (d.charges ||= []).push(ch); d.extraPaid = (d.extraPaid || 0) + net; out.charge = ch; }
  if (net > 0 && p.settle === 'due') { d.due = (d.due || 0) + net; out.due = net; }
  if (net < 0 && p.downgrade === 'refund') out.refund = applyRefund(st, o, { amount: -net, fees: 0, per: {} }, { to: p.to || 'original', note }, by);
  if (net < 0 && ['credit', 'eventCredit'].includes(p.downgrade)) out.refund = applyRefund(st, o, { amount: -net, fees: 0, per: {} }, { to: p.downgrade, creditEvent: p.creditEvent || o.event_ids[0], creditExpires: p.creditExpires, note }, by);
  out.settle = net > 0 ? p.settle : net < 0 ? p.downgrade : null;
  return out;
}
function cancelOrderTickets(st, o, p, by) {
  const live = st.tickets.filter(t => t.order_id === o.id && t.status === 'valid'), all = !!p.all, list = all ? live : live.filter(t => (p.tickets || []).includes(t.id));
  const seatMode = p.seat || 'release';
  if (!SEAT_AFTER_CANCEL[seatMode]) throw new Error('Choose what happens to the seats');
  if (!list.length && !all) throw new Error('Choose the tickets to cancel');
  for (const t of list) {
    Object.assign(t, { status: 'cancelled', cancelled_at: nowIso() });
    if (!t.seat) continue;
    const ev = st.events.find(e => e.id === t.event_id);
    if (seatMode === 'release') seatLog(ev, t.slot_id, t.seat, 'cancelled', `Ticket ${t.code} cancelled (order ${o.ref}) — seat released`, { ref: o.ref, by });
    else {
      const status = seatMode === 'hold' ? 'held' : 'blocked';
      st.seatStatus = (st.seatStatus || []).filter(r => !(r.event_id === ev.id && r.seat === t.seat && (r.slot_id || '') === (t.slot_id || '') && r.status !== 'checkout'));
      st.seatStatus.push({ id: uid(), box_office_id: o.box_office_id, event_id: ev.id, slot_id: t.slot_id || '', seat: t.seat, status, note: `Kept from cancelled order ${o.ref}`, by, at: nowIso() });
      seatLog(ev, t.slot_id, t.seat, status, `Ticket ${t.code} cancelled (order ${o.ref}) — seat kept ${status}`, { ref: o.ref, by });
    }
  }
  if (all) o.data.lines.forEach(l => { if (l.kind === 'addon') l.removed = l.qty; });
  return list;
}
function demoOrderAction(id, action, p = {}) {
  const st = Demo.st; expireOrders(st);
  const o = st.orders.find(x => x.id === id && x.box_office_id === DB._bo); if (!o) throw new Error('Order not found');
  const ev0 = o.event_ids[0], d = o.data, by = DB._actor, live = () => st.tickets.filter(t => t.order_id === o.id && t.status === 'valid');
  const log = (kind, summary, data = {}, before = null, after = null) => {
    (st.orderLog ||= []).unshift({ id: uid(), at: nowIso(), box_office_id: o.box_office_id, order_id: o.id, ref: o.ref, event_id: ev0, kind, summary, by, note: String(p.note || '').slice(0, 500), data, before, after });
    audit('order.' + kind, `Order ${o.ref}: ${summary}`, { target: ev0, before, after });
  };
  const notify = (kind, subject, body) => { if (p.notify !== false) return queueMail(st, o, kind, subject, body, by); };
  const paidOnly = () => { if (o.status !== 'paid') throw new Error('Only paid orders can be changed'); };
  const settle = (amount, what) => {   // money for something added to the order: collect now | balance due | waive
    if (!amount) return '';
    if (p.settle === 'collect') { if (!PAY_METHODS[p.method]) throw new Error('Choose how it was paid'); (d.charges ||= []).push({ id: uid(), at: nowIso(), by, amount, method: p.method, ref: String(p.ref || '').slice(0, 80), reason: what }); d.extraPaid = (d.extraPaid || 0) + amount; return ` · ${money_(amount)} collected (${PAY_METHODS[p.method]})`; }
    if (p.settle === 'due') { d.due = (d.due || 0) + amount; return ` · ${money_(amount)} added to the balance due`; }
    if (p.settle === 'waive') return ' · no charge';
    throw new Error(`Choose how the ${money_(amount)} is paid`);
  };
  let res = {};
  switch (action) {
    case 'status': {  // the old one-click buttons: paid → mark paid · cancelled → cancel everything, release seats · refunded → full refund + cancel
      if (p.status === 'paid') return demoOrderAction(id, 'markPaid', p);
      if (p.status === 'cancelled') return demoOrderAction(id, ['pending', 'awaiting_payment'].includes(o.status) ? 'cancelUnpaid' : 'cancel', { all: true, seat: 'release', ...p });
      if (p.status === 'refunded') return demoOrderAction(id, 'refund', { mode: 'full', to: 'original', cancel: true, ...p });
      throw new Error('Unknown status');
    }
    case 'markPaid': {
      need('orders.edit', ev0); if (!['pending', 'awaiting_payment'].includes(o.status)) throw new Error('This order is not waiting for payment');
      const was = o.status; Object.assign(o, { status: 'paid', paid_at: nowIso(), payment: { ...(o.payment || {}), markedPaidBy: by, method: PAY_METHODS[p.method] ? p.method : o.payment?.method } });
      issueOrderTickets(st, o, { manual: true, by }); log('paid', `marked paid (${was} → paid)${PAY_METHODS[p.method] ? ' · ' + PAY_METHODS[p.method] : ''} — tickets issued`, {}, { status: was }, { status: 'paid' }); break;
    }
    case 'cancelUnpaid': {
      need('orders.cancel', ev0); if (!['pending', 'awaiting_payment'].includes(o.status)) throw new Error('This order is not an unpaid reservation');
      const was = o.status; o.status = 'cancelled';
      for (const l of d.lines) for (const u of lineUnits(l)) if (u.seat) seatLog(st.events.find(e => e.id === l.eventId), l.slotId, u.seat, 'released', `Reservation ${o.ref} cancelled — seat released`, { ref: o.ref, by });
      log('cancelled', 'unpaid reservation cancelled — seats released', {}, { status: was }, { status: 'cancelled' }); break;
    }
    case 'change': {
      need('orders.seats', ev0); paidOnly();
      res = changeOrderTickets(st, o, p, by);
      const r = res.tickets, s = r.map(x => `${x.from.seat || x.from.type} → ${x.to.seat || x.to.type}`).join('; ');
      log('change', `${r.length === 1 ? 'changed 1 ticket' : `changed ${r.length} tickets`}: ${s}${res.net > 0 ? ` · upgrade ${money_(res.net)} — ${UPGRADE_SETTLE[res.settle].toLowerCase()}` : res.net < 0 ? ` · downgrade ${money_(-res.net)} — ${DOWNGRADE_SETTLE[res.settle].toLowerCase()}${res.refund ? ' (' + refundText(res.refund) + ')' : ''}` : ''}`, res);
      notify('updated', 'Your updated tickets', 'Your tickets have changed. Your new tickets are attached — the old ones no longer work.');
      emitEvent(st, o.box_office_id, 'seat.changed', { order_ref: o.ref, email: o.buyer_email, changes: r.map(x => ({ from: x.from, to: x.to })), net: res.net }); break;
    }
    case 'cancel': {
      const all = !!p.all || (p.tickets || []).length >= live().length && live().every(t => p.tickets.includes(t.id));
      need(all ? 'orders.cancel' : 'orders.cancelTicket', ev0); if (p.refund) need('orders.refund', ev0); paidOnly();
      const plan = p.refund ? refundPlan(o, st.tickets, { ...p.refund, mode: p.refund.mode || 'tickets', tickets: all ? live().map(t => t.id) : p.tickets }) : null;
      const list = cancelOrderTickets(st, o, { ...p, all }, by);
      const r = plan ? applyRefund(st, o, plan, { ...p.refund, note: p.note }, by) : null;
      settleOrderStatus(st, o);
      log('cancel', `${all ? 'order cancelled' : `cancelled ${list.length} ticket${list.length === 1 ? '' : 's'}`} (${list.map(t => t.code).join(', ') || 'products'}) — ${SEAT_AFTER_CANCEL[p.seat || 'release'].toLowerCase()}${r ? ' · refunded ' + refundText(r) : ' · no refund'}`,
        { tickets: list.map(t => t.code), seat: p.seat || 'release', refund: r }, null, { status: o.status });
      notify('cancelled', all ? 'Your order was cancelled' : 'Some of your tickets were cancelled', r ? `A refund of ${money_(r.amount)} has been issued.` : '');
      emitEvent(st, o.box_office_id, 'ticket.cancelled', { order_ref: o.ref, email: o.buyer_email, tickets: list.map(t => t.id), all }, { ...orderCtx(st, o, list), key: o.id + ':c' + (st.orderLog || []).length });
      if (r) emitEvent(st, o.box_office_id, 'refund.issued', { order_ref: o.ref, email: o.buyer_email, amount: r.amount, to: r.to }, { ...orderCtx(st, o, list), key: o.id + ':r' + (st.orderLog || []).length });
      res = { cancelled: list.length, refund: r }; break;
    }
    case 'refund': {
      need('orders.refund', ev0); if (!wasPaid(o)) throw new Error('Nothing has been paid on this order');
      if (p.cancel && ['full', 'tickets'].includes(p.mode)) need(p.mode === 'full' ? 'orders.cancel' : 'orders.cancelTicket', ev0);
      const plan = refundPlan(o, st.tickets, p), r = applyRefund(st, o, plan, p, by);
      let gone = [];
      if (p.cancel && o.status === 'paid' && ['full', 'tickets'].includes(p.mode)) { gone = cancelOrderTickets(st, o, { all: p.mode === 'full', tickets: p.mode === 'tickets' ? p.tickets : [], seat: p.seat || 'release' }, by); settleOrderStatus(st, o); }
      log('refund', `refunded ${refundText(r)}${{ full: ' (everything left)', tickets: ` (${Object.keys(plan.per).length} ticket${Object.keys(plan.per).length === 1 ? '' : 's'}${plan.fees ? ' + booking fee' : ''})`, fees: ' (booking fee)', percent: ` (${+p.pct}%)`, amount: '' }[p.mode]}${gone.length ? ` · ${gone.length} ticket${gone.length === 1 ? '' : 's'} cancelled` : p.cancel ? '' : ' · tickets kept'}`,
        { refund: r, cancelled: gone.map(t => t.code) }, null, { status: o.status });
      notify('refund', 'Your refund', `We've issued a refund of ${money_(r.amount)}${r.credit ? ` as credit — use code ${r.credit} on your next order` : ''}.`);
      emitEvent(st, o.box_office_id, 'refund.issued', { order_ref: o.ref, email: o.buyer_email, amount: r.amount, to: r.to }, { ...orderCtx(st, o), key: o.id + ':r' + (st.orderLog || []).length });
      if (gone.length) emitEvent(st, o.box_office_id, 'ticket.cancelled', { order_ref: o.ref, email: o.buyer_email, tickets: gone.map(t => t.id), all: p.mode === 'full' }, { ...orderCtx(st, o, gone), key: o.id + ':c' + (st.orderLog || []).length });
      res = { refund: r }; break;
    }
    case 'collect': {  // record money received later (balance due, extra charge)
      need('orders.edit', ev0); const amount = cents(p.amount); if (!(amount > 0)) throw new Error('Enter the amount received');
      if (!PAY_METHODS[p.method]) throw new Error('Choose how it was paid');
      (d.charges ||= []).push({ id: uid(), at: nowIso(), by, amount, method: p.method, ref: String(p.ref || '').slice(0, 80), reason: String(p.reason || 'Payment received').slice(0, 120) });
      d.extraPaid = (d.extraPaid || 0) + amount; d.due = Math.max(0, (d.due || 0) - amount);
      log('payment', `${money_(amount)} received (${PAY_METHODS[p.method]})${p.ref ? ' · ref ' + p.ref : ''}`, { amount, method: p.method }); break;
    }
    case 'addAddon': {
      need('orders.edit', ev0); paidOnly();
      const ev = st.events.find(e => e.id === (p.eventId || ev0) && o.event_ids.includes(e.id)), ad = (ev?.addons || []).find(x => x.id === p.addonId), qty = Math.floor(+p.qty || 0);
      if (!ad) throw new Error('Choose a product'); if (!(qty >= 1)) throw new Error('Enter a quantity');
      const sold = availabilityFrom(st.tickets, ev.id, [], '', st.orders).ad[ad.id] || 0;
      if (+ad.qty > 0 && sold + qty > +ad.qty) throw new Error(`Only ${Math.max(0, +ad.qty - sold)} ${ad.name} left`);
      const waive = p.settle === 'waive', unit = waive ? 0 : cents(ad.price), txt = settle(cents(ad.price) * qty * (waive ? 0 : 1), 'Added ' + ad.name);
      d.lines.push({ kind: 'addon', eventId: ev.id, eventName: ev.name, addonId: ad.id, name: ad.name, qty, unit, face: cents(ad.price), unitFee: 0, fee: 0, added: nowIso(), by, ...(waive ? { waived: true } : {}) });
      live().filter(t => t.event_id === ev.id).forEach(t => { t.extras = orderExtras(o, ev.id); });
      log('addon', `added ${ad.name} × ${qty}${waive ? ' · no charge' : txt}`, { addonId: ad.id, qty, amount: unit * qty }); break;
    }
    case 'removeAddon': {
      need('orders.edit', ev0); paidOnly();
      const l = d.lines[+p.line], qty = Math.floor(+p.qty || 0);
      if (!l || l.kind !== 'addon') throw new Error('Choose a product'); if (!(qty >= 1) || qty > l.qty - (l.removed || 0)) throw new Error('Enter how many to remove');
      const amount = Math.min(l.unit * qty, orderMoney(o).refundable); let r = null;
      if (p.refund && amount > 0) { need('orders.refund', ev0); r = applyRefund(st, o, { amount, fees: 0, per: {} }, { to: p.to || 'original', creditEvent: p.creditEvent, note: p.note }, by); }
      l.removed = (l.removed || 0) + qty;
      live().filter(t => t.event_id === l.eventId).forEach(t => { t.extras = orderExtras(o, l.eventId); });
      settleOrderStatus(st, o);
      log('addon', `removed ${l.name} × ${qty}${r ? ' · refunded ' + refundText(r) : ' · no refund'}`, { addonId: l.addonId, qty, refund: r }); break;
    }
    case 'customer': {
      need('orders.customer', ev0);
      const name = String(p.name ?? d.buyer.name).trim(), email = String(p.email ?? o.buyer_email).trim().toLowerCase(), phone = String(p.phone ?? d.buyer.phone ?? '').trim();
      if (!name) throw new Error('Name is required'); if (!EMAIL_RE.test(email)) throw new Error('A valid email is required');
      const before = { name: d.buyer.name, email: o.buyer_email, phone: d.buyer.phone || '' }, after = { name, email, phone };
      if (JSON.stringify(before) === JSON.stringify(after)) throw new Error('Nothing changed');
      d.buyer = { ...d.buyer, name, email, phone }; o.buyer_email = email;
      log('customer', 'customer details changed: ' + Object.keys(after).filter(k => before[k] !== after[k]).join(', '), {}, before, after); break;
    }
    case 'holder': {  // put a ticket in someone else's name (a transfer the box office makes)
      need('orders.customer', ev0);
      const t = live().find(x => x.id === p.ticket), name = String(p.name || '').trim().slice(0, 120); if (!t) throw new Error('That ticket is no longer valid'); if (!name) throw new Error('Enter the new name');
      const before = t.holder; t.holder = name; log('holder', `ticket ${t.code} now in the name of ${name} (was ${before})`, { ticket: t.code }, { holder: before }, { holder: name }); break;
    }
    case 'chargeback': {  // Stage 9: a card dispute — the bank takes the money back while it decides (LIVE the processor's webhook records these too)
      need('orders.refund', ev0); const list = d.chargebacks ||= [];
      if (p.id) {
        const c = list.find(x => x.id === p.id); if (!c) throw new Error('Chargeback not found'); if (!CB_STATUS[p.status] || p.status === 'open') throw new Error('Choose won or lost');
        if (c.status !== 'open') throw new Error('That chargeback is already closed');
        c.status = p.status; c.closed_at = nowIso(); c.closed_by = by;
        if (p.status === 'won' && o.payment?.provider === 'demo') procTx(st, o, { type: 'dispute_won', id: 'du_demo_' + randCode(10).toLowerCase(), amount: c.amount });
        log('chargeback', `Chargeback ${p.status} — ${money_(c.amount)}${p.status === 'won' ? ' returned' : ' lost'}`, { amount: c.amount, status: p.status }); break;
      }
      if (!wasPaid(o)) throw new Error('Only paid orders can have a chargeback');
      const amount = cents(p.amount), m = orderMoney(o); if (!(amount > 0)) throw new Error('Enter the disputed amount');
      if (amount > m.collected - m.refunded - m.chargedBack) throw new Error(`At most ${money_(Math.max(0, m.collected - m.refunded - m.chargedBack))} can be disputed on this order`);
      const c = { id: uid(), at: nowIso(), by, amount, status: 'open', reason: String(p.reason || '').slice(0, 120), ref: String(p.ref || '').slice(0, 80) };
      list.push(c); if (o.payment?.provider === 'demo') procTx(st, o, { type: 'dispute', id: 'dp_demo_' + randCode(10).toLowerCase(), amount: -amount });
      log('chargeback', `Chargeback opened — ${money_(amount)}${c.reason ? ' · ' + c.reason : ''}`, { amount }); break;
    }
    case 'note': { need('orders.edit', ev0); const body = String(p.body || '').trim(); if (!body) throw new Error('Write a note'); log('note', body.slice(0, 500)); break; }
    case 'message': {
      need('comms.email', ev0); const subject = String(p.subject || '').trim(), body = String(p.body || '').trim();
      if (!subject || !body) throw new Error('Add a subject and a message');
      const m = queueMail(st, o, 'message', subject, body, by); log('message', `message queued for ${o.buyer_email}: “${subject.slice(0, 80)}”`, { outbox: m.id }); break;
    }
    case 'reissue': {  // same seat / type, new QR code: the old code stops working at the door at once (lost phone, forwarded screenshot)
      need('orders.edit', ev0); paidOnly();
      const ids = p.tickets?.length ? new Set(p.tickets) : null, list = live().filter(t => !ids || ids.has(t.id));
      if (!list.length) throw new Error('Choose the tickets to reissue');
      const pairs = list.map(t => { const nt = { ...clone(t), id: uid(), code: randCode(10), status: 'valid', replaces: t.id, issued_at: nowIso() }; delete nt.replaced_by; delete nt.changed_at;
        Object.assign(t, { status: 'replaced', replaced_by: nt.id, changed_at: nowIso() }); st.tickets.push(nt); return [t.code, nt.code]; });
      log('reissue', `reissued ${pairs.length} ticket${pairs.length === 1 ? '' : 's'} with new QR codes (${pairs.map(([a, b]) => a + ' → ' + b).join(', ')}) — the old codes no longer scan`, { pairs });
      notify('tickets', 'Your updated tickets', 'Your tickets were reissued with new QR codes. Please use these — the old ones no longer work at the door.');
      res = { codes: pairs.map(x => x[1]) }; break;
    }
    case 'resend': {
      need('orders.resend', ev0); if (!live().length && p.kind !== 'confirmation') throw new Error('This order has no valid tickets');
      const k = p.kind === 'confirmation' ? 'confirmation_copy' : 'tickets';
      const m = queueMail(st, o, k, k === 'tickets' ? 'Your tickets' : 'Your order confirmation', '', by); log('resend', `${k === 'tickets' ? 'tickets' : 'confirmation email'} re-sent to ${o.buyer_email}`, { outbox: m.id }); break;
    }
    default: throw new Error('Unknown order action');
  }
  return { ...res, status: o.status };
}
// Credits outside an order: issue a goodwill / future-event credit, revoke what's left, or apply one to an order's balance due.
function demoCreditAction(action, p = {}) {
  const st = Demo.st, by = DB._actor;
  if (action === 'issue') {
    need('orders.refund'); const o = p.order ? st.orders.find(x => x.id === p.order && x.box_office_id === DB._bo) : null;
    const c = issueCreditRow(st, DB._bo, { email: p.email || o?.buyer_email, name: p.name || o?.data.buyer.name, amount: p.amount, eventId: p.eventId || null, expires: p.expires || null, order: o, note: p.note, by });
    audit('credit.issued', `Issued ${money_(c.amount)} credit ${c.code} to ${c.email}${c.event_id ? ' for ' + st.events.find(e => e.id === c.event_id)?.name : ''}`, { target: c.event_id || o?.event_ids[0] });
    if (o) (st.orderLog ||= []).unshift({ id: uid(), at: nowIso(), box_office_id: o.box_office_id, order_id: o.id, ref: o.ref, event_id: o.event_ids[0], kind: 'credit', summary: `credit ${c.code} issued: ${money_(c.amount)}`, by, note: String(p.note || ''), data: { credit: c.code } });
    return clone(c);
  }
  const c = (st.credits || []).find(x => x.id === p.id && x.box_office_id === DB._bo); if (!c) throw new Error('Credit not found');
  need('orders.refund');
  if (action === 'revoke') {
    if (c.revoked_at) throw new Error('Already revoked'); const s = creditState(c, st.orders);
    Object.assign(c, { revoked_at: nowIso(), revoked_by: by, revoke_note: String(p.note || '').slice(0, 300) });
    audit('credit.revoked', `Revoked credit ${c.code} (${money_(s.remaining)} unused)`); return clone(c);
  }
  if (action === 'apply') {  // staff use a customer's credit to pay an order's balance due
    const o = st.orders.find(x => x.id === p.order && x.box_office_id === DB._bo); if (!o) throw new Error('Order not found');
    const s = creditState(c, st.orders), why = creditProblem(c, s, o.event_ids); if (why) throw new Error(why);
    const amount = Math.min(cents(p.amount) || s.remaining, s.remaining, o.data.due || 0); if (!(amount > 0)) throw new Error('This order has no balance due');
    c.applied.push({ order_id: o.id, ref: o.ref, amount, events: o.event_ids, at: nowIso(), by });
    (o.data.charges ||= []).push({ id: uid(), at: nowIso(), by, amount, method: 'credit', ref: c.code, reason: 'Credit applied' }); o.data.due -= amount;
    (st.orderLog ||= []).unshift({ id: uid(), at: nowIso(), box_office_id: o.box_office_id, order_id: o.id, ref: o.ref, event_id: o.event_ids[0], kind: 'payment', summary: `credit ${c.code} applied: ${money_(amount)}`, by, note: '', data: { credit: c.code, amount } });
    audit('credit.applied', `Applied ${money_(amount)} of credit ${c.code} to order ${o.ref}`, { target: o.event_ids[0] }); return clone(c);
  }
  throw new Error('Unknown credit action');
}
// Live event activity (Eli Step 6 §9). presence = {visitor: {at, cart, carted, conv}} from DB.ping(); summarised the same way as SQL admin_load.
function presenceStats(pres, now = Date.now()) {
  const P = Object.values(pres || {}), on = P.filter(x => now - x.at < 120e3);
  const converted = P.filter(x => x.conv).length, abandoned = P.filter(x => x.carted && !x.conv && now - x.at > 30 * 6e4).length;
  return { now: on.length, carts: on.filter(x => x.cart > 0).length, cartTickets: on.reduce((a, x) => a + (x.cart > 0 ? x.cart : 0), 0), carted: P.filter(x => x.carted).length, converted, abandoned };
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
  ['waitlistMode', 'Waitlist'], ['currency', 'Currency'], ['contact', 'Event contact'], ['policies', 'Policies'], ['entrances', 'Entrances']];
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

// ── Door / scanning (Stage 7) ─────────────────────────────────────────────────
// A ticket's QR holds only its random code. Every scan is checked by the "server" (DEMO: here; LIVE: checkin()), logged in
// scanLog / scan_log, and answered with doorTicket(): where the guest belongs — never money, email or phone.
const SCAN_RESULTS = ['ok', 'already', 'undone', 'unknown', 'cancelled', 'refunded', 'replaced', 'wrong_event', 'wrong_slot', 'wrong_entrance', 'inactive', 'device_off'];
function doorTicket(st, t, P) {
  const ev = st.events.find(e => e.id === t.event_id), tt = ev?.ticketTypes.find(x => x.id === t.ticket_type_id), o = st.orders.find(x => x.id === t.order_id);
  const sibs = st.tickets.filter(x => x.order_id === t.order_id && x.status === 'valid'), sp = t.seat ? seatInfo(ev, t.seat, t) : null, slot = t.slot_id && (ev?.timeSlots || []).find(x => x.id === t.slot_id);
  return { id: t.id, code: t.code, event_id: t.event_id, event_name: ev?.name || '', event_start: ev?.start || null, slot_id: t.slot_id || null, slot_start: slot?.start || null,
    ticket_type_id: t.ticket_type_id, type: tt?.name || '', admits: Math.max(1, +tt?.admits || 1), seat: t.seat || null, area: sp?.area ?? null, row: sp?.row ?? null, seat_label: sp?.seat ?? null, unit: sp?.unit || null,
    holder: P('customers.names') ? t.holder : 'Guest', comp: !!t.comp, status: t.status, checked_in_at: t.checked_in_at || null, checkin: t.checkin || null,
    order_id: t.order_id, order_ref: o?.ref || '', of: sibs.length, no: sibs.indexOf(t) + 1, due: (o?.data?.due || 0) > 0 };
}
// An entrance can be limited to ticket types and/or seating areas (e.g. "Box seat entrance" → area Boxes). No limits = everyone.
const entranceTakes = (en, t) => !en || ((!en.ticketTypeIds?.length || en.ticketTypeIds.includes(t.ticket_type_id)) && (!en.areas?.length || en.areas.includes(t.area || '')));
const doorStats = (tks, ev) => {
  const v = tks.filter(t => t.status === 'valid'), inn = v.filter(t => t.checked_in_at), byEntrance = {};
  for (const t of inn) { const k = t.checkin?.entrance || ''; byEntrance[k] = (byEntrance[k] || 0) + 1; }
  return { total: v.length, inn: inn.length, left: v.length - inn.length, pct: v.length ? Math.round(inn.length / v.length * 100) : 0, byEntrance,
    bySlot: Object.fromEntries((ev?.timeSlots || []).map(s => [s.id, { total: v.filter(t => t.slot_id === s.id).length, inn: inn.filter(t => t.slot_id === s.id).length }])) };
};
function demoCheckin(code, undo, eventId, o) {
  const st = Demo.fresh(), me = need('door.scan'), P = k => hasPerm(me, k, eventId || undefined), c = String(code || '').trim().toUpperCase().slice(0, 64);
  const dev = scanDevice(st, o), ev = eventId && st.events.find(e => e.id === eventId && e.box_office_id === DB._bo);
  const en = ev && o.entrance ? (ev.entrances || []).find(x => x.id === o.entrance) : null;
  const t = c && st.tickets.find(x => x.code === c && x.box_office_id === DB._bo);   // another box office's ticket looks exactly like a fake one
  const done = (result, extra = {}) => {
    (st.scanLog ||= []).unshift({ id: uid(), at: nowIso(), box_office_id: DB._bo, event_id: eventId || t?.event_id || null, slot_id: o.slot || null, ticket_id: t?.id || null, code: c,
      result, entrance: en?.name || '', device: dev?.id || '', device_name: dev?.name || '', by: DB._actor, manual: !!o.manual, override: !!extra.override });
    if (st.scanLog.length > 20000) st.scanLog.length = 20000;
    Demo.save();
    const tk = !t ? null : result === 'wrong_event' ? (x => ({ code: x.code, event_id: x.event_id, event_name: x.event_name, event_start: x.event_start, slot_start: x.slot_start }))(doorTicket(st, t, () => false)) : doorTicket(st, t, P);
    return { result, ticket: tk, ...extra };
  };
  if (dev?.disabled) return done('device_off');
  if (!t) return done('unknown');
  if (eventId && t.event_id !== eventId) { need('door.checkin', eventId); return done('wrong_event'); }   // says which event it is for, nothing more
  need(undo ? 'door.undo' : 'door.checkin', t.event_id);
  if (t.status === 'replaced') return done('replaced');
  if (t.status !== 'valid') return done(t.refunded > 0 ? 'refunded' : 'cancelled');
  if (o.slot && t.slot_id && t.slot_id !== o.slot) return done('wrong_slot');
  const ord = st.orders.find(x => x.id === t.order_id), tev = st.events.find(e => e.id === t.event_id);
  if (!ord || !['paid', 'refunded'].includes(ord.status) || tev?.archived) return done('inactive');
  if (undo) { const was = t.checked_in_at; t.checked_in_at = null; t.checkin = null; if (was) audit('door.undo', 'Undid check-in for ticket ' + t.code, { target: t.event_id }); return done('undone'); }
  if (t.checked_in_at) return done('already', { first: { at: t.checked_in_at, ...(t.checkin || {}) } });
  let override = false;
  if (en && !entranceTakes(en, { ...t, area: t.area ?? seatInfo(tev, t.seat).area })) {
    if (!o.override) return done('wrong_entrance', { entrances: (tev.entrances || []).filter(x => entranceTakes(x, { ...t, area: t.area ?? seatInfo(tev, t.seat).area })).map(x => x.name) });
    need('door.override', t.event_id); override = true;
  }
  t.checked_in_at = nowIso(); t.checkin = { entrance: en?.name || '', device: dev?.id || '', device_name: dev?.name || '', by: DB._actor, manual: !!o.manual };
  emitEvent(st, ord.box_office_id, 'customer.checked_in', { ticket_id: t.id, event_id: t.event_id, order_ref: ord.ref, email: ord.buyer_email, entrance: en?.name || '', at: t.checked_in_at },
    { ...orderCtx(st, ord, [t]), key: t.id });
  return done('ok', override ? { override } : {});
}
// Each phone / tablet / handheld that scans is a device: named by its user, seen by admins, can be switched off if lost.
function scanDevice(st, o) {
  const id = String(o.device || '').slice(0, 40); if (!id) return null;
  const list = st.devices ||= []; let d = list.find(x => x.id === id && x.box_office_id === DB._bo);
  if (!d) { d = { id, box_office_id: DB._bo, name: String(o.deviceName || 'Scanner').slice(0, 60), first_seen: nowIso(), scans: 0, disabled: false }; list.push(d); }
  else if (o.deviceName && !d.renamed) d.name = String(o.deviceName).slice(0, 60);
  d.last_seen = nowIso(); d.last_by = DB._actor; d.entrance = o.entranceName || d.entrance || ''; d.scans++;
  return d;
}
const guestMatch = (st, t, q, digits) => { const o = st.orders.find(x => x.id === t.order_id);
  return [t.holder, t.code, o?.ref, o?.buyer_email, o?.data?.buyer?.name].some(v => String(v || '').toLowerCase().includes(q))
    || (digits.length >= 4 && String(o?.data?.buyer?.phone || '').replace(/\D/g, '').includes(digits)); };

/* ════════════ Messages, marketing & automation (Stage 8) ════════════
   ONE outbox for everything the platform sends (st.outbox / SQL outbox): confirmations, resends, updated tickets, refunds, staff messages,
   reminders, event updates, campaigns, waitlist notices, automation emails / texts and staff notifications. A row is queued with a send_at;
   the sender delivers it when due after re-checking consent (sendGate): transactional mail (tickets, order changes, event information) goes
   to every buyer unless the address bounced or was suppressed; marketing needs a recorded opt-in and no unsubscribe; texts need a mobile
   number and no STOP. DEMO: demoDeliver() marks rows sent in this browser — nothing leaves it. LIVE: the `messaging` Edge Function claims
   due rows (claim_outbox), renders them with mailtpl.js and sends through Resend / the SMS provider.
   Consent + tags live on `contacts` (one per box office + email); every consent change is a `consentLog` row.
   emitEvent() is the one place outside systems hear about things: matching webhooks / CRM connections get a `deliveries` row, and the same
   call runs matching automations (Trigger → Conditions → Actions). Time-based triggers run in marketingTick(). */
const MSG_KINDS = {
  confirmation: ['Order confirmation', 'transactional'], confirmation_copy: ['Confirmation (resent)', 'transactional'], tickets: ['Tickets resent', 'transactional'],
  updated: ['Updated tickets', 'transactional'], cancelled: ['Cancellation', 'transactional'], refund: ['Refund', 'transactional'], credit: ['Credit issued', 'transactional'],
  message: ['Message from the box office', 'transactional'], reminder: ['Event reminder', 'transactional'], update: ['Event update', 'transactional'],
  waitlist: ['Waitlist notice', 'transactional'], followup: ['After the event', 'transactional'], campaign: ['Campaign', 'marketing'], automation: ['Automation', 'transactional'],
  staff: ['Staff notification', 'staff'] };
const MSG_STATUS = { queued: 'Queued', sending: 'Sending', sent: 'Sent', failed: 'Failed', suppressed: 'Not sent — no consent', cancelled: 'Cancelled', 'not sent (staff choice)': 'Not sent (staff choice)' };
const MSG_VARS = [['first_name', 'First name'], ['name', 'Full name'], ['event', 'Event name'], ['date', 'Event date'], ['time', 'Start time'], ['venue', 'Venue'], ['doors', 'Doors open'],
  ['order_ref', 'Order number'], ['tickets_link', 'Link to their tickets'], ['event_link', 'Event page link'], ['box_office', 'Box office name'], ['promo_code', 'Promo code (automation)'], ['link', 'Your link (automation)']];
const HOOK_EVENTS = { 'order.created': 'Order created', 'payment.completed': 'Payment completed', 'ticket.issued': 'Ticket issued', 'ticket.cancelled': 'Ticket cancelled',
  'refund.issued': 'Refund issued', 'seat.changed': 'Seat changed', 'cart.expired': 'Cart expired', 'waitlist.signup': 'Waitlist signup', 'customer.checked_in': 'Customer checked in', 'event.updated': 'Event updated' };
const AUTO_TRIGGERS = { 'ticket.purchased': 'Ticket purchased', 'ticket.cancelled': 'Ticket cancelled', 'refund.issued': 'Refund issued', 'waitlist.joined': 'Customer added to waitlist',
  'event.approaching': 'Event approaching', 'checked_in': 'Customer checked in', 'no_show': 'Customer did not attend', 'cart.abandoned': 'Cart abandoned (checkout left unpaid)',
  'promo.used': 'Promo code used', 'event.ended': 'Event ended' };
const TRIGGER_OF = { 'payment.completed': ['ticket.purchased', 'promo.used'], 'ticket.cancelled': ['ticket.cancelled'], 'refund.issued': ['refund.issued'], 'waitlist.signup': ['waitlist.joined'],
  'customer.checked_in': ['checked_in'], 'cart.expired': ['cart.abandoned'] };
const TIMED_TRIGGERS = ['event.approaching', 'event.ended', 'no_show'];
const AUTO_ACTIONS = { email: 'Send email', sms: 'Send text message', tag: 'Add customer tag', untag: 'Remove customer tag', staff: 'Notify staff', webhook: 'Trigger webhook', crm: 'Send to connected CRM' };
const TIMING = { now: 'Right away', before: 'Hours before the event starts', after: 'Hours after the event ends', delay: 'Hours after the trigger' };
// box office connections. Secrets (API keys, tokens, webhook signing secrets) are write-only: stored server-side, never sent back to the browser.
const INTEGRATIONS = {
  webhook: { name: 'Webhook', crm: false, fields: [['url', 'Endpoint URL (https://…)']], secret: '', blurb: 'Signed JSON POSTs to your own system for the events you choose.' },
  mailchimp: { name: 'Mailchimp', crm: true, fields: [['dc', 'Data center (e.g. us21)'], ['list', 'Audience ID']], secret: 'API key', blurb: 'Adds buyers to an audience with their tags.' },
  hubspot: { name: 'HubSpot', crm: true, fields: [], secret: 'Private app access token', blurb: 'Creates / updates contacts with purchase details.' },
  activecampaign: { name: 'ActiveCampaign', crm: true, fields: [['url', 'API URL (https://you.api-us1.com)'], ['list', 'List ID']], secret: 'API key', blurb: 'Syncs contacts and tags to a list.' },
  constantcontact: { name: 'Constant Contact', crm: true, fields: [['list', 'List ID']], secret: 'Access token', blurb: 'Adds opted-in buyers to a contact list.' },
  meta_capi: { name: 'Meta Conversions API', crm: false, fields: [['pixel', 'Pixel ID'], ['test', 'Test event code (optional)']], secret: 'Access token', blurb: 'Sends purchases to Meta from the server (works with ad blockers; matched with the browser pixel).' },
};
const API_SCOPES = { 'events:read': 'Events & ticket types', 'orders:read': 'Orders', 'tickets:read': 'Tickets & check-ins', 'customers:read': 'Customers & consent' };
const SEG_STATUS = { any: 'Everyone', buyers: 'Has bought tickets', optedIn: 'Opted in to marketing email', smsOptIn: 'Opted in to marketing texts', account: 'Has a customer account',
  refunded: 'Had a refund', credit: 'Has credit', waitlist: 'On a waitlist', unsubscribed: 'Unsubscribed / suppressed' };
const emptySeg = () => ({ eventIds: [], ticketTypeIds: [], areas: [], from: '', to: '', promo: '', tracking: '', checkin: 'any', status: 'any', tags: [] });
const normPhone = p => { const s = String(p || '').trim(), d = s.replace(/\D/g, ''); if (d.length < 7) return ''; return s.startsWith('+') ? '+' + d : d.length === 10 ? '+1' + d : d.length === 11 && d[0] === '1' ? '+' + d : '+' + d; };
// only https URLs on public hosts (no localhost / private IP literals) — the Edge Function re-checks the resolved address before every POST
function publicUrl(u) {
  let x; try { x = new URL(String(u || '').trim()); } catch (e) { return ''; }
  if (x.protocol !== 'https:' || x.username || x.password) return '';
  const h = x.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.') && !h.includes(':')) return '';
  if (/^(0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) || /^\d+$/.test(h) || h.includes(':') && /^(::1?|f[cd]|fe80)/.test(h)) return '';
  return x.toString();
}

/* ── contacts & consent ── */
function contactOf(st, boId, email, make = true) {
  email = String(email || '').trim().toLowerCase(); if (!EMAIL_RE.test(email)) return null;
  let c = (st.contacts ||= []).find(x => x.box_office_id === boId && x.email === email);
  if (!c && make) st.contacts.push(c = { id: uid(), box_office_id: boId, email, name: '', phone: '', email_optin: false, email_optin_at: null, email_optin_src: '', sms_optin: false, sms_optin_at: null,
    sms_optin_src: '', unsub_email_at: null, unsub_sms_at: null, suppressed: null, suppressed_at: null, tags: [], token: randCode(24), created_at: nowIso(), updated_at: nowIso() });
  return c;
}
// action: optin | optout (email marketing) · sms_optin | sms_optout (STOP — no texts at all) | sms_start · suppress | unsuppress (email, all mail) · tag | untag
function consentChange(st, c, action, source, by, extra = '') {
  const at = nowIso();
  switch (action) {
    case 'optin': Object.assign(c, { email_optin: true, email_optin_at: at, email_optin_src: source, unsub_email_at: null }); break;
    case 'optout': if (!c.email_optin && c.unsub_email_at) return false; Object.assign(c, { email_optin: false, unsub_email_at: at }); break;
    case 'sms_optin': if (!c.phone) throw new Error('No mobile number on file'); Object.assign(c, { sms_optin: true, sms_optin_at: at, sms_optin_src: source, unsub_sms_at: null }); break;
    case 'sms_optout': if (c.unsub_sms_at) return false; Object.assign(c, { sms_optin: false, unsub_sms_at: at }); break;
    case 'sms_start': if (!c.unsub_sms_at) return false; c.unsub_sms_at = null; break;
    case 'suppress': Object.assign(c, { suppressed: ['bounced', 'complaint'].includes(extra) ? extra : 'manual', suppressed_at: at }); break;
    case 'unsuppress': if (!c.suppressed) return false; Object.assign(c, { suppressed: null, suppressed_at: null }); break;
    default: throw new Error('Unknown consent change');
  }
  c.updated_at = at;
  (st.consentLog ||= []).unshift({ id: uid(), box_office_id: c.box_office_id, email: c.email, action: action === 'suppress' ? 'suppress:' + c.suppressed : action, source: String(source || '').slice(0, 160), by: by || 'system', at });
  return true;
}
const tagsOf = s => [...new Set(String(s || '').split(',').map(x => x.trim().slice(0, 40)).filter(Boolean))];
function tagContact(c, tags, on) { const t = tagsOf(Array.isArray(tags) ? tags.join(',') : tags); c.tags = on ? [...new Set([...(c.tags || []), ...t])] : (c.tags || []).filter(x => !t.includes(x)); c.updated_at = nowIso(); }
// an order's buyer → their contact (name / phone kept fresh) + the consent they gave at checkout
function orderContact(st, o) {
  const c = contactOf(st, o.box_office_id, o.buyer_email); if (!c) return null;
  const b = o.data.buyer || {}, src = `checkout · order ${o.ref}`;
  if (b.name) c.name = String(b.name).slice(0, 120); if (normPhone(b.phone)) c.phone = normPhone(b.phone);
  if (o.data.optIn && !c.email_optin) consentChange(st, c, 'optin', src, o.buyer_email);
  if (o.data.smsOptIn && c.phone && !c.sms_optin) consentChange(st, c, 'sms_optin', src, o.buyer_email);
  return c;
}
// may this message go to this person? '' = yes, otherwise the reason it is held back
function sendGate(c, channel, category, to) {
  if (category === 'staff') return '';
  if (channel === 'sms') {
    if (!to) return 'no mobile number';
    if (c?.unsub_sms_at) return 'replied STOP to texts';
    if (category === 'marketing' && !c?.sms_optin) return 'not opted in to marketing texts';
    return '';
  }
  if (c?.suppressed) return `address suppressed (${c.suppressed})`;
  if (category === 'marketing' && !(c?.email_optin && !c.unsub_email_at)) return c?.unsub_email_at ? 'unsubscribed from marketing' : 'not opted in to marketing email';
  return '';
}

/* ── the outbox ── */
function queueMsg(st, m) {
  const kind = m.kind || 'message', row = { id: uid(), box_office_id: m.box_office_id, order_id: null, event_id: null, kind, channel: 'email', category: MSG_KINDS[kind]?.[1] || 'transactional',
    to: '', email: '', subject: '', body: '', by: 'system', at: nowIso(), send_at: null, status: 'queued', attempts: 0, error: '', provider: '', provider_id: '', sent_at: null,
    campaign_id: null, automation_id: null, dedupe: null, require_valid: false, ...m };
  row.subject = String(row.subject || '').slice(0, 200); row.body = String(row.body || '').slice(0, 5000); row.send_at ||= row.at;
  if (row.channel === 'email') row.to = String(row.to || row.email).toLowerCase(); else row.to = normPhone(row.to);
  row.email = String(row.email || (row.channel === 'email' ? row.to : '')).toLowerCase();
  if (row.dedupe && (st.outbox ||= []).some(x => x.dedupe === row.dedupe)) return null;
  (st.outbox ||= []).push(row); return row;
}
function queueMail(st, o, kind, subject, body, by) {
  return queueMsg(st, { box_office_id: o.box_office_id, order_id: o.id, event_id: o.event_ids?.[0] || null, kind, to: o.buyer_email, email: o.buyer_email, subject, body, by });
}
// why a due row must not go out now: { cancel } = no longer relevant (order cancelled) · otherwise held back for consent
function outboxBlock(st, m) {
  if (m.require_valid && m.order_id && !st.tickets.some(t => t.order_id === m.order_id && t.status === 'valid' && (!m.event_id || t.event_id === m.event_id)))
    return { cancel: true, text: 'the order has no valid tickets any more' };
  const c = (st.contacts || []).find(x => x.box_office_id === m.box_office_id && x.email === m.email), why = sendGate(c, m.channel || 'email', m.category || 'transactional', m.to);
  return why ? { text: why } : null;
}
// DEMO sender: due rows become 'sent' (provider 'demo' — nothing leaves this browser); webhook / CRM deliveries are recorded, not posted
function demoDeliver(st, now = Date.now()) {
  let n = 0;
  for (const m of st.outbox || []) {
    if (m.status !== 'queued' || new Date(m.send_at || m.at) > now) continue;
    const b = outboxBlock(st, m); m.attempts = (m.attempts || 0) + 1; n++;
    if (b) Object.assign(m, { status: b.cancel ? 'cancelled' : 'suppressed', error: b.text });
    else Object.assign(m, { status: 'sent', sent_at: new Date(now).toISOString(), provider: 'demo', provider_id: 'demo_' + randCode(10).toLowerCase(), error: '' });
  }
  for (const d of st.deliveries || []) if (d.status === 'queued') Object.assign(d, { status: 'delivered', attempts: 1, done_at: new Date(now).toISOString(), response: 'demo mode — recorded, not posted' });
  return n;
}

/* ── segments: who matches a filter. x = { orders, tickets, contacts, waitlist, credits, accounts } (admin data or the demo store) ── */
function segmentPeople(x, f = {}, boId) {
  f = { ...emptySeg(), ...f }; const by = new Map(), inBo = r => !boId || r.box_office_id === boId;
  const person = (email, name, phone) => { email = String(email || '').toLowerCase(); let p = by.get(email); if (!p) by.set(email, p = { email, name: name || '', phone: normPhone(phone), orders: [], tickets: [], waitlist: [], spent: 0 }); if (name && !p.name) p.name = name; if (!p.phone && normPhone(phone)) p.phone = normPhone(phone); return p; };
  const counted = o => o.status !== 'expired' && o.status !== 'awaiting_payment';
  const tkFilter = f.eventIds.length || f.ticketTypeIds.length || f.areas.length || f.checkin !== 'any', ordFilter = f.from || f.to || f.promo || f.tracking;
  const ordOk = o => (!f.from || new Date(o.created_at) >= new Date(f.from)) && (!f.to || new Date(o.created_at) <= new Date(f.to + (f.to.length <= 10 ? 'T23:59:59' : '')))
    && (!f.promo || String(o.data.code || '').toUpperCase() === f.promo.toUpperCase()) && (!f.tracking || String(o.data.tracking || '').toUpperCase() === f.tracking.toUpperCase());
  const tkOk = t => t.status === 'valid' && (!f.eventIds.length || f.eventIds.includes(t.event_id)) && (!f.ticketTypeIds.length || f.ticketTypeIds.includes(t.ticket_type_id))
    && (!f.areas.length || f.areas.includes(t.area)) && (f.checkin === 'any' || (f.checkin === 'in') === !!t.checked_in_at);
  const ords = (x.orders || []).filter(o => inBo(o) && counted(o)), tByOrder = new Map();
  for (const t of x.tickets || []) if (inBo(t)) (tByOrder.get(t.order_id) || tByOrder.set(t.order_id, []).get(t.order_id)).push(t);
  for (const o of ords) {
    const p = person(o.buyer_email, o.data.buyer?.name, o.data.buyer?.phone), tks = tByOrder.get(o.id) || [];
    p.orders.push(o); p.spent += (wasPaid(o) ? o.data.total || 0 : 0) - (o.data.refunded || 0);
    if (ordOk(o)) p.tickets.push(...tks.filter(tkOk)), p._ordOk = true;
  }
  for (const w of x.waitlist || []) if (inBo(w)) person(w.email, w.name, w.phone).waitlist.push(w);
  for (const c of x.contacts || []) if (inBo(c)) { const p = person(c.email, c.name, c.phone); p.contact = c; }
  const credit = new Set((x.credits || []).filter(c => inBo(c) && !c.revoked_at && (c.status ? c.status === 'active' : true)).map(c => c.email)), accts = new Set(x.accounts || []);
  return [...by.values()].filter(p => {
    const c = p.contact;
    if (f.status === 'waitlist') { if (!p.waitlist.some(w => !f.eventIds.length || f.eventIds.includes(w.event_id))) return false; }
    else {
      if (tkFilter && !p.tickets.length) return false;
      if (!tkFilter && ordFilter && !p._ordOk) return false;
      if (f.status === 'buyers' && !p.orders.length) return false;
    }
    if (f.status === 'optedIn' && !(c?.email_optin && !c.unsub_email_at && !c.suppressed)) return false;
    if (f.status === 'smsOptIn' && !(c?.sms_optin && !c.unsub_sms_at && p.phone)) return false;
    if (f.status === 'account' && !accts.has(p.email)) return false;
    if (f.status === 'refunded' && !p.orders.some(o => (o.data.refunded || 0) + (o.data.credited || 0) > 0)) return false;
    if (f.status === 'credit' && !credit.has(p.email)) return false;
    if (f.status === 'unsubscribed' && !(c?.unsub_email_at || c?.suppressed || c?.unsub_sms_at)) return false;
    if (f.tags.length && !f.tags.every(t => (c?.tags || []).includes(t))) return false;
    if (!p.orders.length && !p.waitlist.length && (tkFilter || ordFilter)) return false;
    return true;
  }).map(p => { const { _ordOk, ...r } = p; if (!r.name && r.contact?.name) r.name = r.contact.name; if (!r.phone && r.contact?.phone) r.phone = r.contact.phone; return r; });
}
const segLabel = (f, evName = id => id) => { f = { ...emptySeg(), ...f }; const parts = [];
  if (f.status !== 'any') parts.push(SEG_STATUS[f.status]); if (f.eventIds.length) parts.push(f.eventIds.map(evName).join(' / ')); if (f.ticketTypeIds.length) parts.push(f.ticketTypeIds.length + ' ticket type(s)');
  if (f.areas.length) parts.push(f.areas.join(' / ')); if (f.from || f.to) parts.push(`bought ${f.from || '…'} – ${f.to || '…'}`); if (f.promo) parts.push('code ' + f.promo); if (f.tracking) parts.push('ref ' + f.tracking);
  if (f.checkin !== 'any') parts.push(f.checkin === 'in' ? 'checked in' : 'not checked in'); if (f.tags.length) parts.push('tagged ' + f.tags.join(', '));
  return parts.join(' · ') || 'Everyone'; };

/* ── events out: webhooks, CRM syncs, automations ── */
function emitEvent(st, boId, type, data, ctx) {
  const at = nowIso(), id = 'evt_' + randCode(14).toLowerCase(), crmType = ['payment.completed', 'waitlist.signup'].includes(type);
  for (const ig of (st.integrations || []).filter(x => x.box_office_id === boId && x.active)) {
    const want = ig.kind === 'webhook' ? (ig.config.events || []).includes(type) : INTEGRATIONS[ig.kind]?.crm ? crmType : ig.kind === 'meta_capi' ? type === 'payment.completed' : false;
    if (want) (st.deliveries ||= []).unshift({ id: uid(), box_office_id: boId, integration_id: ig.id, kind: ig.kind, event: type, event_id: id, payload: { id, type, created: at, data }, status: 'queued', attempts: 0, created_at: at, response: '' });
  }
  if (ctx) for (const trig of TRIGGER_OF[type] || []) for (const a of (st.automations || []).filter(x => x.box_office_id === boId && x.enabled && x.trigger.type === trig)) {
    if (trig === 'promo.used' && !ctx.promo) continue;
    runAutomation(st, a, ctx, `${type}:${ctx.key || id}`);
  }
}
// the payload outside systems get for an order: no access key, payment internals or platform money
const hookOrder = (st, o) => ({ id: o.id, ref: o.ref, status: o.status, email: o.buyer_email, name: o.data.buyer?.name || '', phone: o.data.buyer?.phone || '', total: o.data.total, currency: o.data.currency || 'USD',
  promo: o.data.code || null, tracking: o.data.tracking || null, utm: o.data.utm || null, created_at: o.created_at, paid_at: o.paid_at || null, event_ids: o.event_ids,
  tickets: st.tickets.filter(t => t.order_id === o.id).map(t => ({ id: t.id, code_last4: String(t.code).slice(-4), event_id: t.event_id, ticket_type_id: t.ticket_type_id, area: t.area || null, row: t.row || null, seat: t.seat_label || null, status: t.status, face: t.face, paid: t.paid })) });
const orderCtx = (st, o, tks) => ({ email: o.buyer_email, name: o.data.buyer?.name || '', phone: o.data.buyer?.phone || '', order_id: o.id, ref: o.ref, promo: o.data.code || '', key: o.id,
  tickets: (tks || st.tickets.filter(t => t.order_id === o.id && t.status === 'valid')).map(t => ({ event_id: t.event_id, slot_id: t.slot_id || '', ticket_type_id: t.ticket_type_id, area: t.area || '', face: t.face, checked_in_at: t.checked_in_at })),
  eventIds: o.event_ids });
// conditions: events, ticket types, seating areas, price levels (face value), how many matching tickets, promo code, customer tags
function autoTickets(a, ctx) {
  const c = a.cond || {};
  return (ctx.tickets || []).filter(t => (!c.eventIds?.length || c.eventIds.includes(t.event_id)) && (!c.ticketTypeIds?.length || c.ticketTypeIds.includes(t.ticket_type_id))
    && (!c.areas?.length || c.areas.includes(t.area)) && (!c.prices?.length || c.prices.includes(t.face)));
}
function autoMatch(st, a, ctx) {
  const c = a.cond || {}, tkCond = c.ticketTypeIds?.length || c.areas?.length || c.prices?.length || c.minQty > 0;
  if (c.promo && String(ctx.promo || '').toUpperCase() !== String(c.promo).toUpperCase()) return null;
  if (c.tags?.length) { const k = (st.contacts || []).find(x => x.box_office_id === a.box_office_id && x.email === ctx.email); if (!c.tags.every(t => (k?.tags || []).includes(t))) return null; }
  if (!ctx.tickets?.length) return tkCond || (c.eventIds?.length && !(ctx.eventIds || []).some(id => c.eventIds.includes(id))) ? null : [];
  const tks = autoTickets(a, ctx);
  return tks.length && tks.length >= (c.minQty || 1) ? tks : null;
}
const evStart = (ev, slotId) => new Date(ev.timeSlots?.find(s => s.id === slotId)?.start || ev.start).getTime();
const evEnd = (ev, slotId) => { const s = ev.timeSlots?.find(x => x.id === slotId); return new Date(s?.end || (s ? s.start : ev.end) || evStart(ev, slotId) + 3 * 36e5).getTime(); };
function runAutomation(st, a, ctx, key) {
  const tks = autoMatch(st, a, ctx); if (!tks) return 0;
  const runs = (st.autoRuns ||= {}); if (runs[a.id + '|' + key]) return 0; runs[a.id + '|' + key] = nowIso();
  const evId = tks[0]?.event_id || ctx.eventId || ctx.eventIds?.[0] || null, ev = evId && st.events.find(e => e.id === evId), slot = tks[0]?.slot_id || '';
  const H = (+a.timing?.hours || 0) * 36e5, now = Date.now();
  const sendAt = a.timing?.mode === 'before' && ev ? Math.max(now, evStart(ev, slot) - H) : a.timing?.mode === 'after' && ev ? Math.max(now, evEnd(ev, slot) + H) : a.timing?.mode === 'delay' ? now + H : now;
  const ticketBased = ['ticket.purchased', 'promo.used', 'event.approaching', 'event.ended', 'checked_in'].includes(a.trigger.type);
  const c = contactOf(st, a.box_office_id, ctx.email);
  if (c) { if (ctx.name && !c.name) c.name = ctx.name; if (!c.phone && normPhone(ctx.phone)) c.phone = normPhone(ctx.phone); }
  const fill = s => String(s || '').replace(/\{\{\s*event\s*\}\}/g, ev?.name || '').replace(/\{\{\s*promo_code\s*\}\}/g, a.promo || '');
  for (const x of a.actions || []) {
    const base = { box_office_id: a.box_office_id, order_id: ctx.order_id || null, event_id: evId, automation_id: a.id, by: 'automation: ' + a.name, send_at: new Date(sendAt).toISOString(),
      require_valid: ticketBased && !!ctx.order_id, dedupe: `auto:${a.id}:${key}:${x.type}:${(a.actions || []).indexOf(x)}`, kind: a.kind || 'automation', vars: { promo_code: a.promo || '', link: x.link || '' } };
    if (x.type === 'email') queueMsg(st, { ...base, channel: 'email', category: x.category || 'transactional', to: ctx.email, email: ctx.email, subject: x.subject, body: x.body });
    else if (x.type === 'sms') queueMsg(st, { ...base, channel: 'sms', category: x.category || 'transactional', to: c?.phone || ctx.phone, email: ctx.email, body: x.body });
    else if (x.type === 'staff') { if (EMAIL_RE.test(x.to || '')) queueMsg(st, { ...base, kind: 'staff', category: 'staff', require_valid: false, to: x.to, email: x.to, subject: x.subject || `Automation “${a.name}”`,
      body: `${x.body ? x.body + '\n\n' : ''}${ctx.name || ''} <${ctx.email}>${ctx.ref ? ' · order ' + ctx.ref : ''}${ev ? ' · ' + ev.name : ''}` }); }
    else if ((x.type === 'tag' || x.type === 'untag') && c) tagContact(c, fill(x.tag), x.type === 'tag');
    else if (x.type === 'webhook' || x.type === 'crm') {
      const ig = (st.integrations || []).find(i => i.id === x.integrationId && i.box_office_id === a.box_office_id && i.active);
      if (ig) (st.deliveries ||= []).unshift({ id: uid(), box_office_id: a.box_office_id, integration_id: ig.id, kind: ig.kind, event: 'automation', event_id: 'evt_' + randCode(14).toLowerCase(),
        payload: { type: 'automation', automation: a.name, trigger: a.trigger.type, created: nowIso(), data: { email: ctx.email, name: ctx.name, phone: ctx.phone || '', order_ref: ctx.ref || null, event_id: evId, tags: c?.tags || [] } }, status: 'queued', attempts: 0, created_at: nowIso(), response: '' });
    }
  }
  a.runs = (a.runs || 0) + 1; a.last_run = nowIso();
  return 1;
}
// time-based work, run every minute by the scheduler (LIVE: marketing_tick() via pg_cron; DEMO: on every back-office load):
// event reminders set on the event, and automations triggered by an event approaching / ending / a no-show
function marketingTick(st, now = Date.now()) {
  let n = 0;
  const holders = ev => { const by = new Map(); for (const t of st.tickets) if (t.event_id === ev.id && t.status === 'valid') { const k = t.order_id + '|' + (t.slot_id || ''); (by.get(k) || by.set(k, []).get(k)).push(t); } return by; };
  for (const ev of st.events) {
    if (ev.status !== 'published' || ev.archived) continue;
    const autos = (st.automations || []).filter(a => a.box_office_id === ev.box_office_id && a.enabled && TIMED_TRIGGERS.includes(a.trigger.type)), rems = ev.emails?.reminders || [];
    if (!autos.length && !rems.length) continue;
    for (const [k, tks] of holders(ev)) {
      const [oid, slot] = k.split('|'), o = st.orders.find(x => x.id === oid); if (!o) continue;
      const start = evStart(ev, slot), end = evEnd(ev, slot);
      rems.forEach((r, i) => {   // the event's own reminders (Event → Emails)
        const at = start - (+r.hoursBefore || 0) * 36e5; if (now < at || now >= start) return;
        const ch = r.channel === 'email' ? ['email'] : r.channel === 'both' ? ['email', 'sms'] : ['sms'];
        for (const c of ch) if (queueMsg(st, { box_office_id: o.box_office_id, order_id: o.id, event_id: ev.id, kind: 'reminder', channel: c, to: c === 'email' ? o.buyer_email : o.data.buyer?.phone, email: o.buyer_email,
          subject: `Reminder: {{event}} — {{date}}`, body: r.body || '', require_valid: true, dedupe: `rem:${ev.id}:${slot}:${i}:${o.id}:${c}` })) n++;
      });
      for (const a of autos) {
        if (a.std === 'pre' && rems.length) continue;   // an event with its own reminders uses those instead of the standard one
        const H = (+a.trigger.hours || 0) * 36e5, fire = a.trigger.type === 'event.approaching' ? start - H : end + H;
        if (now < fire || (a.trigger.type === 'event.approaching' ? now >= start : now >= fire + 2 * 864e5)) continue;
        const live = tks.filter(t => a.trigger.type !== 'no_show' || !t.checked_in_at);
        if (a.trigger.type === 'no_show' && (live.length < tks.length || !live.length)) continue;   // nobody from this order came in
        n += runAutomation(st, a, { ...orderCtx(st, o, live), eventId: ev.id }, `${a.trigger.type}:${ev.id}:${slot}:${o.id}`);
      }
    }
  }
  return n;
}
// the standard workflows (Eli Step 8 §7) every box office starts with — ordinary automations, so they can be edited or switched off
function stdAutomations(bo) {
  const A = (std, name, trigger, timing, actions, o = {}) => ({ id: 'au_' + std + '_' + bo.id, box_office_id: bo.id, std, name, enabled: true, trigger, cond: { eventIds: [], ticketTypeIds: [], areas: [], prices: [], minQty: 0, promo: '', tags: [] },
    timing, actions, runs: 0, last_run: null, created_at: nowIso(), ...o });
  return [
    A('purchase', 'Purchase', { type: 'ticket.purchased' }, { mode: 'now', hours: 0 }, [{ type: 'tag', tag: 'Attendee: {{event}}' }]),
    A('pre', 'Pre-event reminder', { type: 'event.approaching', hours: 24 }, { mode: 'now', hours: 0 }, [{ type: 'email', category: 'transactional', subject: 'Coming up: {{event}} — {{date}}',
      body: 'Hi {{first_name}},\n\n{{event}} is coming up on {{date}} at {{time}} — {{venue}}. Doors open {{doors}}.\n\nYour tickets: {{tickets_link}}\n\nSee you there!' }], { kind: 'reminder' }),
    A('post', 'Post-event thank you', { type: 'event.ended', hours: 12 }, { mode: 'now', hours: 0 }, [{ type: 'email', category: 'transactional', subject: 'Thanks for coming to {{event}}',
      body: 'Hi {{first_name}},\n\nThank you for joining us at {{event}}. We would love to hear how it went — it takes a minute: {{link}}', link: '' }], { kind: 'followup' }),
    A('offer', 'Next-event offer', { type: 'event.ended', hours: 48 }, { mode: 'now', hours: 0 }, [{ type: 'email', category: 'marketing', subject: 'A thank-you offer for your next night out',
      body: 'Hi {{first_name}},\n\nAs a thank-you for coming to {{event}}, use code {{promo_code}} on your next order.' }], { kind: 'followup', enabled: false, promo: '' }),
  ];
}
// the automation as a sentence, for lists
function autoSentence(a, evName = id => id) {
  const t = AUTO_TRIGGERS[a.trigger.type] + (TIMED_TRIGGERS.includes(a.trigger.type) ? ` (${a.trigger.hours || 0} h ${a.trigger.type === 'event.approaching' ? 'before' : 'after'})` : '');
  const c = a.cond || {}, cs = [c.eventIds?.length && c.eventIds.map(evName).join(' / '), c.ticketTypeIds?.length && c.ticketTypeIds.length + ' ticket type(s)', c.areas?.length && c.areas.join(' / '),
    c.prices?.length && c.prices.map(money_).join(' / ') + ' seats', c.minQty > 0 && c.minQty + '+ tickets', c.promo && 'code ' + c.promo, c.tags?.length && 'tagged ' + c.tags.join(', ')].filter(Boolean);
  const w = a.timing?.mode === 'before' ? `${a.timing.hours} h before the event` : a.timing?.mode === 'after' ? `${a.timing.hours} h after the event` : a.timing?.mode === 'delay' ? `${a.timing.hours} h later` : '';
  return { when: t, cond: cs.join(' · '), then: (a.actions || []).map(x => AUTO_ACTIONS[x.type] + (x.type === 'tag' || x.type === 'untag' ? ` “${x.tag}”` : '')).join(' + ') + (w ? ' · ' + w : '') };
}
// API keys: the key is shown once; only its SHA-256 is stored
async function sha256hex(s) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); }
// UTM tags (utm_source / medium / campaign / content / term) a buyer arrived with, kept for the session and stored on the order
const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'];
const cleanUtm = u => { if (!u || typeof u !== 'object') return null; const o = {}; for (const k of UTM_KEYS) if (u[k]) o[k] = String(u[k]).trim().slice(0, 80); return Object.keys(o).length ? o : null; };

/* ── DEMO server side of the Stage 8 calls (LIVE: the matching SQL functions) ── */
const anyPerm = (keys, eventId) => { let err; for (const k of keys) { try { return need(k, eventId); } catch (e) { err = e; } } throw err; };
const scopedTo = (me, evIds) => { if (me.owner || me.support || me.events === 'all') return; if (!evIds.length || evIds.some(id => !(me.events || []).includes(id))) throw new Error('You can only message the ticket holders of your own events'); };
const demoPeopleFor = (st, boId, f) => segmentPeople({ orders: st.orders, tickets: st.tickets, contacts: st.contacts, waitlist: st.waitlist, credits: st.credits, accounts: (st.customers || []).map(c => c.email) }, f, boId);
const demoPeople = (st, f) => segmentPeople({ orders: st.orders, tickets: st.tickets, contacts: st.contacts, waitlist: st.waitlist, credits: st.credits, accounts: (st.customers || []).map(c => c.email) }, f, DB._bo);
function demoSendCampaign(c) {
  const st = Demo.st, f = { ...emptySeg(), ...(c.filter || {}) }, cat = c.category === 'transactional' ? 'transactional' : 'marketing';
  const ch = ['email', 'sms', 'both'].includes(c.channel) ? c.channel : 'email', chans = ch === 'both' ? ['email', 'sms'] : [ch];
  f.eventIds = (f.eventIds || []).filter(id => st.events.some(e => e.id === id && e.box_office_id === DB._bo));
  let me;
  if (cat === 'transactional') {   // an event update: only to the ticket holders of the chosen events
    if (!f.eventIds.length) throw new Error('An event update goes to the ticket holders of an event — choose the event');
    f.eventIds.forEach(id => { me = anyPerm(['comms.email', 'comms.notify'], id); }); f.status = 'buyers';
  } else { me = need('comms.marketing'); scopedTo(me, f.eventIds); f.eventIds.forEach(id => need('comms.marketing', id)); }
  if (chans.includes('sms')) need('comms.sms');
  const subject = String(c.subject || '').trim(), body = String(c.body || '').trim();
  if (chans.includes('email') && !subject) throw new Error('Add a subject'); if (!body) throw new Error('Write the message');
  if (chans.includes('sms') && body.length > 480 && ch === 'sms') throw new Error('Keep a text message under 480 characters');
  const now = Date.now(), at = c.sendAt ? new Date(c.sendAt).getTime() : now;
  if (!(at >= now - 6e4) || at > now + 366 * 864e5) throw new Error('Choose a send time in the future (within a year)');
  const people = demoPeople(st, f), row = { id: uid(), box_office_id: DB._bo, event_id: f.eventIds[0] || null, kind: cat === 'transactional' ? 'update' : 'campaign', name: String(c.name || subject || body).slice(0, 120),
    subject: subject.slice(0, 200), body: body.slice(0, 5000), channel: ch, category: cat, filter: f, send_at: new Date(at).toISOString(), status: at > now + 6e4 ? 'scheduled' : 'sent',
    recipients: people.length, queued: 0, skipped: {}, created_by: DB._actor, created_at: nowIso() };
  for (const p of people) for (const chn of chans) {
    const to = chn === 'email' ? p.email : p.phone, why = sendGate(p.contact, chn, cat, to);
    if (why) { row.skipped[why] = (row.skipped[why] || 0) + 1; continue; }
    if (queueMsg(st, { box_office_id: DB._bo, event_id: row.event_id, kind: row.kind, channel: chn, category: cat, to, email: p.email, subject: row.subject, body: row.body, by: DB._actor,
      send_at: row.send_at, campaign_id: row.id, dedupe: `cmp:${row.id}:${p.email}:${chn}` })) row.queued++;
  }
  st.broadcasts.push(row);
  audit('comms.campaign', `${row.status === 'scheduled' ? 'Scheduled' : 'Sent'} ${cat === 'transactional' ? 'event update' : 'campaign'} “${row.name}” (${chans.join(' + ')}) to ${row.queued} — ${segLabel(f, id => st.events.find(e => e.id === id)?.name || id)}`, { target: row.event_id });
  if (row.status === 'sent') demoDeliver(st);
  return clone(row);
}
function cleanAutomation(st, a) {
  const T = a.trigger?.type; if (!AUTO_TRIGGERS[T]) throw new Error('Choose a trigger');
  const hrs = v => Math.max(0, Math.min(720, Math.round(+v || 0))), arr = v => (Array.isArray(v) ? v : []).map(x => String(x).slice(0, 80)).slice(0, 50);
  const name = String(a.name || '').trim().slice(0, 80); if (!name) throw new Error('Name the automation');
  const ig = id => (st.integrations || []).find(i => i.id === id && i.box_office_id === DB._bo);
  const actions = (a.actions || []).slice(0, 8).map(x => {
    if (!AUTO_ACTIONS[x.type]) throw new Error('Unknown action');
    const r = { type: x.type };
    if (x.type === 'email' || x.type === 'sms') {
      r.category = x.category === 'marketing' ? 'marketing' : 'transactional'; r.body = String(x.body || '').trim().slice(0, x.type === 'sms' ? 480 : 5000);
      if (x.type === 'email') { r.subject = String(x.subject || '').trim().slice(0, 200); if (!r.subject) throw new Error('Give the email a subject'); }
      if (!r.body) throw new Error('Write the message'); if (x.link) r.link = publicUrl(x.link) || '';
    }
    if (x.type === 'tag' || x.type === 'untag') { r.tag = String(x.tag || '').trim().slice(0, 40); if (!r.tag) throw new Error('Name the tag'); }
    if (x.type === 'staff') { r.to = String(x.to || '').trim().toLowerCase(); if (!EMAIL_RE.test(r.to)) throw new Error('Enter the staff email to notify'); r.subject = String(x.subject || '').slice(0, 200); r.body = String(x.body || '').slice(0, 2000); }
    if (x.type === 'webhook' || x.type === 'crm') { const g = ig(x.integrationId); if (!g || (x.type === 'webhook') !== (g.kind === 'webhook') || (x.type === 'crm' && !INTEGRATIONS[g.kind]?.crm)) throw new Error(x.type === 'webhook' ? 'Choose a webhook (set one up under Integrations)' : 'Choose a connected CRM'); r.integrationId = g.id; }
    return r;
  });
  if (!actions.length) throw new Error('Add at least one action');
  const c = a.cond || {};
  return { name, enabled: a.enabled !== false, trigger: { type: T, hours: TIMED_TRIGGERS.includes(T) ? hrs(a.trigger.hours) : 0 },
    cond: { eventIds: arr(c.eventIds), ticketTypeIds: arr(c.ticketTypeIds), areas: arr(c.areas), prices: (c.prices || []).map(x => Math.round(+x)).filter(x => x >= 0).slice(0, 20),
      minQty: Math.max(0, Math.min(100, Math.round(+c.minQty || 0))), promo: String(c.promo || '').trim().toUpperCase().slice(0, 40), tags: arr(c.tags) },
    timing: { mode: TIMING[a.timing?.mode] ? a.timing.mode : 'now', hours: hrs(a.timing?.hours) }, actions, promo: String(a.promo || '').trim().toUpperCase().slice(0, 40) };
}
function demoSaveIntegration(ig, secret) {
  const st = Demo.st, def = INTEGRATIONS[ig.kind]; need('admin.integrations'); if (!def) throw new Error('Unknown integration');
  const prev = ig.id ? (st.integrations || []).find(x => x.id === ig.id && x.box_office_id === DB._bo) : null; if (ig.id && !prev) throw new Error('Integration not found');
  if (prev && prev.kind !== ig.kind) throw new Error('Integration not found');
  const config = {}; for (const [k] of def.fields) config[k] = String(ig.config?.[k] || '').trim().slice(0, 300);
  if (ig.kind === 'webhook' || ig.kind === 'activecampaign') { config.url = publicUrl(config.url); if (!config.url) throw new Error('Use an https:// address on a public host'); }
  if (ig.kind === 'webhook') { config.events = (ig.config?.events || []).filter(e => HOOK_EVENTS[e]); if (!config.events.length) throw new Error('Choose at least one event to send'); }
  if (ig.kind === 'mailchimp' && !/^[a-z]{2,4}\d{1,3}$/.test(config.dc)) throw new Error('The Mailchimp data center looks like “us21” (the end of your API key)');
  if (ig.kind === 'meta_capi' && !/^\d{6,20}$/.test(config.pixel)) throw new Error('Enter your Meta Pixel ID (numbers only)');
  if (def.crm) config.who = ig.config?.who === 'all' ? 'all' : 'optedIn';
  const sec = st.secrets ||= {}, row = prev || { id: uid(), box_office_id: DB._bo, kind: ig.kind, created_at: nowIso(), created_by: DB._actor, last_at: null, last_error: '' };
  Object.assign(row, { name: String(ig.name || def.name).trim().slice(0, 80) || def.name, active: ig.active !== false, config });
  let shown = null;
  if (ig.kind === 'webhook' && !sec[row.id]) { shown = 'whsec_' + randCode(32).toLowerCase(); sec[row.id] = shown; }
  else if (secret) sec[row.id] = String(secret).trim().slice(0, 400);
  if (def.secret && !sec[row.id]) throw new Error(`Paste the ${def.secret}`);
  row.secret_set = !!sec[row.id]; row.secret_hint = sec[row.id] ? '…' + sec[row.id].slice(-4) : '';
  if (!prev) (st.integrations ||= []).push(row);
  audit('admin.integrations', `${prev ? 'Updated' : 'Connected'} ${def.name} “${row.name}”`);
  return { ...clone(row), secret: shown };
}
function demoContactAction(email, action, p = {}) {
  const st = Demo.st; need('comms.consent');
  const c = contactOf(st, DB._bo, email); if (!c) throw new Error('Enter a valid email');
  if (action === 'tag' || action === 'untag') { tagContact(c, p.tags || p.tag, action === 'tag'); audit('comms.tags', `${action === 'tag' ? 'Tagged' : 'Untagged'} ${c.email}: ${tagsOf(p.tags || p.tag).join(', ')}`); return clone(c); }
  if (action === 'phone') { const ph = normPhone(p.phone); if (p.phone && !ph) throw new Error('Enter a mobile number with country code'); c.phone = ph; if (!ph) c.sms_optin = false; return clone(c); }
  const src = String(p.source || '').trim();
  if ((action === 'optin' || action === 'sms_optin') && !src) throw new Error('Say how the customer gave consent (e.g. “signed up at the door”)');
  consentChange(st, c, action, 'staff: ' + (src || p.reason || 'box office'), DB._actor, p.reason);
  audit('comms.consent', `${{ optin: 'Recorded email opt-in', optout: 'Unsubscribed', sms_optin: 'Recorded text opt-in', sms_optout: 'Stopped texts', sms_start: 'Allowed texts again', suppress: 'Suppressed', unsuppress: 'Removed suppression' }[action]} for ${c.email}${src ? ' — ' + src : ''}`);
  return clone(c);
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
    if (expireOrders(st) + marketingTick(st) + demoDeliver(st)) Demo.save();   // the demo's stand-in for the every-minute scheduler
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
      return { super: isSuper, bos, me: m, needs2fa: true, bo: publicBo(bo), events: [], orders: [], tickets: [], waitlist: [], team: [m], broadcasts: [], audit: [], seatStatus: [], seatLog: [], promos: [], tracking: [], outbox: [], orderLog: [], credits: [], custNotes: [], accounts: [], live: {}, contacts: [], consentLog: [], automations: [], integrations: [], deliveries: [], apiKeys: [] };
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
      tickets.forEach(t => { t.face = t.paid = t.discount = t.refunded = t.fee = t.tax = t.proc = t.credited = null; });
    }
    if (!P('finance.processing')) tickets.forEach(t => { t.proc = null; });
    // door-only staff (scanner): a ticket is just where the guest belongs — no answers, codes used or purchases
    if (!P('orders.view') && !P('door.attendees')) tickets.forEach(t => { t.answers = {}; t.promo = t.tracking = t.bundle = null; t.extras = []; t.price_override = false; });
    const full = clone({ ...bo, templates: bo.templates?.length ? bo.templates : DEFAULT_TEMPLATES });
    const seeAud = P('comms.lists') || P('customers.profiles') || P('comms.marketing') || P('comms.consent');
    const mask = r => { if (!P('customers.emails')) { if (r.email) r.email = maskEmail(r.email); if (r.channel !== 'sms' && r.to) r.to = maskEmail(r.to); }
      if (!P('customers.phones')) { if (r.phone) r.phone = '•••'; if (r.channel === 'sms' && r.to) r.to = '•••'; } return r; };
    return { super: isSuper, bos, me: m, bo: { ...full, branding: { ...DEFAULT_BRANDING, ...full.branding }, settings: { ...DEFAULT_SETTINGS, ...full.settings, name: bo.name } },
      events: clone(events), orders, tickets,
      waitlist: P('orders.view') || P('comms.lists') ? clone(st.waitlist.filter(w => evIds.has(w.event_id))) : [],
      team: P('admin.invite') || P('admin.perms') || P('admin.remove') ? clone(st.members.filter(x => x.box_office_id === bo.id && x.status === 'active')).map(x => ({ ...x, owner: x.email === bo.owner })) : [{ ...m }],
      broadcasts: P('comms.email') || P('comms.notify') || P('comms.marketing') ? clone(st.broadcasts.filter(b => b.box_office_id === bo.id && (!b.event_id || evIds.has(b.event_id)))) : [],
      audit: clone(st.audit.filter(a => a.box_office_id === bo.id && (P('admin.perms') || a.actor === email || (a.target && hasPerm(m, 'events.edit', a.target)))).slice(0, 1500)),
      views: Object.fromEntries([...evIds].map(id => [id, viewStats(st.views?.[id])])),
      seatStatus: clone((st.seatStatus || []).filter(r => evIds.has(r.event_id))).map(({ token, ...r }) => r),  // buyers' hold tokens never leave the server
      seatLog: P('seating.view') ? clone((st.seatLog || []).filter(r => evIds.has(r.event_id)).slice(0, 8000)) : [],
      promos: P('tickets.discounts') || P('tickets.discountsEdit') || P('finance.reports') ? clone((st.promos || []).filter(x => x.box_office_id === bo.id)) : [],
      tracking: P('tickets.tracking') || P('finance.reports') ? clone((st.tracking || []).filter(x => x.box_office_id === bo.id)) : [],
      outbox: P('orders.view') || P('comms.email') || P('comms.marketing') || P('comms.lists') ? clone((st.outbox || []).filter(x => x.box_office_id === bo.id).slice(-6000)).map(mask) : [],
      // Stage 8: contacts (consent + tags; the unsubscribe token stays on the server), consent history, automations, connections, API keys
      contacts: seeAud ? clone((st.contacts || []).filter(x => x.box_office_id === bo.id)).map(({ token, ...c }) => mask(c)) : [],
      consentLog: seeAud ? clone((st.consentLog || []).filter(x => x.box_office_id === bo.id).slice(0, 3000)).map(mask) : [],
      automations: P('comms.automations') || P('comms.lists') ? clone((st.automations || []).filter(x => x.box_office_id === bo.id)) : [],
      integrations: P('admin.integrations') || P('comms.automations') ? clone((st.integrations || []).filter(x => x.box_office_id === bo.id)) : [],
      deliveries: P('admin.integrations') ? clone((st.deliveries || []).filter(x => x.box_office_id === bo.id).slice(0, 500)) : [],
      apiKeys: P('admin.api') ? clone((st.apiKeys || []).filter(x => x.box_office_id === bo.id)).map(({ hash, ...k }) => k) : [],
      // Stage 6: every order's change history, credits, notes on customers, who has a customer account, live event activity
      orderLog: P('orders.view') ? clone((st.orderLog || []).filter(x => x.box_office_id === bo.id && evIds.has(x.event_id)).slice(0, 5000)) : [],
      credits: P('orders.view') || P('customers.profiles') ? clone((st.credits || []).filter(x => x.box_office_id === bo.id)).map(c => ({ ...c, ...creditState(c, st.orders) })) : [],
      custNotes: P('customers.profiles') ? clone((st.custNotes || []).filter(x => x.box_office_id === bo.id)) : [],
      accounts: P('customers.profiles') ? (st.customers || []).map(c => c.email).filter(e => orders.some(o => o.buyer_email === e)) : [],
      live: Object.fromEntries([...evIds].map(id => [id, presenceStats(st.presence?.[id])])),
      // Stage 9: event expenses (+ which events have all their expenses in), the processor's payouts and its own transaction ledger
      expenses: P('finance.reports') || P('finance.expenses') ? clone((st.expenses || []).filter(x => x.box_office_id === bo.id && evIds.has(x.event_id))) : [],
      expenseFinal: P('finance.reports') || P('finance.expenses') ? clone(Object.fromEntries(Object.entries(st.expenseFinal || {}).filter(([k]) => evIds.has(k)))) : {},
      payouts: P('finance.payouts') ? clone((st.payouts || []).filter(x => x.box_office_id === bo.id)) : [],
      procTx: P('finance.payouts') ? clone((st.procTx || []).filter(x => x.box_office_id === bo.id)) : [] };
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
      if (prev && diff.length && row.status === 'published') emitEvent(st, DB._bo, 'event.updated', { event_id: row.id, name: row.name, start: row.start, venue: row.venue || '', changed: [...new Set(diff.map(d => d[0].split(' · ')[0]))] });
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
  async setOrderStatus(id, status) { return this.orderAction(id, 'status', { status }); },
  // Every staff change to an order (Eli Step 6): change | cancel | refund | collect | addAddon | removeAddon | customer | holder | note | message |
  // resend | markPaid | cancelUnpaid | status. LIVE: refunds to the card go through the payments Edge Function (it calls order_action as you,
  // then refunds at the processor); everything else is the order_action() RPC. Tables are never written directly.
  async orderAction(id, action, p = {}) {
    // Demo.fresh() first: another tab (a second scanner) may have written since — acting on a stale copy would overwrite its changes
    if (!LIVE) { Demo.fresh(); try { return demoOrderAction(id, action, p); } finally { Demo.save(); } }
    const viaProcessor = (action === 'refund' && (p.to || 'original') === 'original') || (action === 'status' && p.status === 'refunded')
      || (action === 'cancel' && p.refund && (p.refund.to || 'original') === 'original') || (action === 'change' && p.downgrade === 'refund' && (p.to || 'original') === 'original')
      || (action === 'removeAddon' && p.refund && (p.to || 'original') === 'original');
    if (viaProcessor) { const { data, error } = await sb.functions.invoke('payments', { body: { action: 'order', order: id, op: action, p } }); if (error || data?.error) throw new Error(data?.error || error.message); return data; }
    return must(sb.rpc('order_action', { p_order: id, p_action: action, p }));
  },
  async creditAction(action, p = {}) {
    if (!LIVE) { Demo.fresh(); try { return demoCreditAction(action, p); } finally { Demo.save(); } }
    return must(sb.rpc('credit_action', { p_bo: DB._bo, p_action: action, p }));
  },
  async customerNote(email, body) {
    email = String(email || '').trim().toLowerCase(); body = String(body || '').trim(); if (!body) throw new Error('Write a note');
    if (!LIVE) { need('customers.profiles'); const n = { id: uid(), box_office_id: DB._bo, email, body: body.slice(0, 1000), by: DB._actor, at: nowIso() }; (Demo.st.custNotes ||= []).unshift(n); Demo.save(); return clone(n); }
    return must(sb.rpc('customer_note', { p_bo: DB._bo, p_email: email, p_body: body }));
  },
  // buyer side: a credit code typed at checkout → what it's worth (never whose it is)
  async checkCredit(boId, code) {
    if (!LIVE) { const st = Demo.fresh(), c = (st.credits || []).find(x => x.box_office_id === boId && x.code === String(code || '').trim().toUpperCase()), s = c && creditState(c, st.orders);
      return c ? { code: c.code, remaining: s.remaining, status: s.status, event_id: c.event_id, expires: c.expires } : null; }
    return must(sb.rpc('check_credit', { p_bo: boId, p_code: code }));
  },
  async myCredits() {   // the signed-in customer's credits (automatic at checkout, shown in the account)
    if (LIVE) return must(sb.rpc('my_credits'));
    const me = await this.custSession(); if (!me) return [];
    const st = Demo.fresh(); return (st.credits || []).filter(c => c.email === me.email).map(c => { const s = creditState(c, st.orders); return { code: c.code, box_office_id: c.box_office_id, amount: c.amount, remaining: s.remaining, status: s.status, event_id: c.event_id, expires: c.expires, issued_at: c.issued_at }; });
  },
  // live activity: this visitor is on an event page (cart = tickets of this event in their cart; converted = they just ordered)
  ping(eventId, cart = 0, converted = false) {
    let vid = ''; try { vid = localStorage.getItem('set_vid') || uid(); localStorage.setItem('set_vid', vid); } catch (e) { vid = this._vid ||= uid(); }
    if (!LIVE) { const st = Demo.fresh(), m = ((st.presence ||= {})[eventId] ||= {}), x = m[vid.slice(0, 8)] ||= { at: 0, cart: 0, carted: 0, conv: 0 };
      x.at = Date.now(); x.cart = Math.max(0, Math.min(99, +cart || 0)); if (x.cart && !x.carted) x.carted = x.at; if (converted) x.conv = x.at; Demo.save(); return; }
    sb.rpc('presence_ping', { p_event: eventId, p_visitor: vid, p_cart: Math.max(0, Math.min(99, +cart || 0)), p_converted: !!converted }).then(() => { }, () => { });
  },
  // Scan / check in one ticket. eventId = the event being scanned (a ticket for another event is rejected, not checked in).
  // o: {slot, entrance (id), entranceName, device, deviceName, manual, override}. → {result (SCAN_RESULTS), ticket (doorTicket), first?, entrances?}
  async checkin(code, undo = false, eventId = null, o = {}) {
    if (!LIVE) return demoCheckin(code, undo, eventId, o);
    return must(sb.rpc('checkin', { p_code: code, p_undo: undo, p_event: eventId, p: o }));
  },
  // What every scanner polls: the event's tickets as the door sees them (cancel / move / upgrade / reissue show up within seconds).
  async doorSync(eventId, since = null) {
    if (!LIVE) {
      const st = Demo.fresh(), me = need('door.scan', eventId), P = k => hasPerm(me, k, eventId), ev = st.events.find(e => e.id === eventId && e.box_office_id === DB._bo);
      if (!ev) throw new Error('Event not found');
      const tks = st.tickets.filter(t => t.event_id === eventId);
      return { tickets: tks.filter(t => t.status === 'valid' || t.changed_at || t.cancelled_at).map(t => doorTicket(st, t, P)), stats: doorStats(tks, ev), at: nowIso() };
    }
    return must(sb.rpc('door_sync', { p_event: eventId, p_since: since }));   // LIVE: only tickets changed since the last pull
  },
  // Manual look-up when a QR won't scan: name, email, phone, order number or ticket number. Returns door info only (no email / phone).
  async doorSearch(eventId, q) {
    q = String(q || '').trim().toLowerCase().slice(0, 80); if (q.length < 2) return [];
    if (!LIVE) {
      const st = Demo.fresh(), me = need('door.search', eventId), P = k => hasPerm(me, k, eventId), digits = q.replace(/\D/g, '');
      return st.tickets.filter(t => t.event_id === eventId && t.box_office_id === DB._bo && t.status === 'valid' && guestMatch(st, t, q, digits)).slice(0, 50).map(t => doorTicket(st, t, P));
    }
    return must(sb.rpc('door_search', { p_event: eventId, p_q: q }));
  },
  // Event-day log: every scan, duplicate and invalid attempt, with device, employee and entrance.
  async doorLog(eventId) {
    if (!LIVE) { need('door.log', eventId); return clone((Demo.fresh().scanLog || []).filter(r => r.box_office_id === DB._bo && r.event_id === eventId).slice(0, 3000)); }
    return must(sb.rpc('door_log', { p_event: eventId }));
  },
  async devices() {
    if (!LIVE) { need('door.devices'); return clone((Demo.fresh().devices || []).filter(d => d.box_office_id === DB._bo)); }
    return must(sb.rpc('scan_devices_list', { p_bo: DB._bo }));
  },
  // rename | disable | enable | forget
  async deviceAction(id, action, name = '') {
    if (!LIVE) {
      const st = Demo.fresh(); need('door.devices'); const d = (st.devices || []).find(x => x.id === id && x.box_office_id === DB._bo); if (!d) throw new Error('Device not found');
      if (action === 'rename') { const n = String(name).trim().slice(0, 60); if (!n) throw new Error('Enter a name'); d.name = n; d.renamed = true; }
      else if (action === 'disable' || action === 'enable') d.disabled = action === 'disable';
      else if (action === 'forget') st.devices = st.devices.filter(x => x !== d);
      else throw new Error('Unknown device action');
      audit('door.device', `Scanner device “${d.name}”: ${action === 'rename' ? 'renamed' : action === 'forget' ? 'removed' : action + 'd'}`); Demo.save(); return;
    }
    return must(sb.rpc('scan_device_action', { p_bo: DB._bo, p_id: id, p_action: action, p_name: name }));
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
      const ev = st.events.find(e => e.id === eventId), bc = { id: uid(), box_office_id: DB._bo, event_id: eventId, subject: 'Tickets available', body: message, recipients: list.length, queued: list.length, channel: 'email', category: 'transactional', status: 'sent', created_by: DB._actor, created_at: at, send_at: at, kind: 'waitlist', name: 'Waitlist: ' + (ev?.name || '') };
      list.forEach(w => { w.notified_at = at; queueMsg(st, { box_office_id: DB._bo, event_id: eventId, kind: 'waitlist', to: w.email, email: w.email, subject: 'Tickets are available: {{event}}', body: message, by: DB._actor, campaign_id: bc.id }); });
      st.broadcasts.push(bc); demoDeliver(st);
      audit('comms.waitlist', `Notified ${list.length} people on the waitlist`, { target: eventId }); Demo.save(); return list.length;
    }
    return must(sb.rpc('notify_waitlist', { p_event: eventId, p_message: message }));
  },
  async log(kind, summary) { if (!LIVE) { audit(kind, summary); Demo.save(); return; } await sb.from('audit_log').insert({ actor: DB._actor, box_office_id: DB._bo, kind, summary }); },
  /* ── Stage 8: messages, marketing, automation, integrations ── */
  // DEMO: what the every-minute scheduler does (time-based automations + reminders, then deliver due messages). LIVE: pg_cron + the messaging Edge Function do it.
  async runSender() { if (LIVE) return null; const st = Demo.fresh(), queued = marketingTick(st), sent = demoDeliver(st); Demo.save(); return { queued, sent }; },
  async sendCampaign(c) {
    if (!LIVE) { Demo.fresh(); try { return demoSendCampaign(c); } finally { Demo.save(); } }
    return must(sb.rpc('send_campaign', { p_bo: DB._bo, p: c }));
  },
  async campaignAction(id, action) {   // cancel a scheduled campaign: its queued messages are cancelled
    if (!LIVE) {
      const st = Demo.fresh(), b = st.broadcasts.find(x => x.id === id && x.box_office_id === DB._bo); if (!b) throw new Error('Campaign not found');
      b.category === 'transactional' ? b.event_id && anyPerm(['comms.email', 'comms.notify'], b.event_id) : need('comms.marketing');
      if (action !== 'cancel') throw new Error('Unknown action'); if (b.status !== 'scheduled') throw new Error('Only a scheduled campaign can be cancelled');
      let n = 0; (st.outbox || []).forEach(m => { if (m.campaign_id === id && m.status === 'queued') { m.status = 'cancelled'; m.error = 'campaign cancelled'; n++; } });
      b.status = 'cancelled'; b.cancelled_by = DB._actor; b.cancelled_at = nowIso(); audit('comms.campaign', `Cancelled scheduled campaign “${b.name}” (${n} messages)`); Demo.save(); return clone(b);
    }
    return must(sb.rpc('campaign_action', { p_bo: DB._bo, p_id: id, p_action: action }));
  },
  async previewSegment(f) {   // how many people a filter reaches, before sending — LIVE counts on the server (the browser may not see everyone)
    if (!LIVE) { need('comms.lists'); const people = demoPeople(Demo.fresh(), { ...emptySeg(), ...f }); return { count: people.length, email: people.filter(p => !sendGate(p.contact, 'email', 'marketing', p.email)).length, sms: people.filter(p => !sendGate(p.contact, 'sms', 'marketing', p.phone)).length, phones: people.filter(p => p.phone).length }; }
    return must(sb.rpc('segment_count', { p_bo: DB._bo, f }));
  },
  async saveSegments(list) {
    const clean = (list || []).slice(0, 100).map(x => ({ id: String(x.id || shortId('sg_')).slice(0, 40), name: String(x.name || '').trim().slice(0, 80) || 'Segment', filter: { ...emptySeg(), ...x.filter } }));
    if (!LIVE) { need('comms.lists'); const bo = Demo.st.boxOffices.find(b => b.id === DB._bo); bo.segments = clean; audit('comms.segments', 'Saved audience segments'); Demo.save(); return clean; }
    await must(sb.rpc('save_segments', { p_bo: DB._bo, p: clean })); return clean;
  },
  async saveAutomation(a) {
    if (!LIVE) {
      const st = Demo.fresh(); need('comms.automations'); const clean = cleanAutomation(st, a);
      if (clean.actions.some(x => x.type === 'sms')) need('comms.sms'); if (clean.actions.some(x => x.category === 'marketing')) need('comms.marketing');
      let row = a.id && (st.automations || []).find(x => x.id === a.id && x.box_office_id === DB._bo);
      if (a.id && !row) throw new Error('Automation not found');
      if (!row) (st.automations ||= []).push(row = { id: shortId('au_'), box_office_id: DB._bo, std: '', runs: 0, last_run: null, created_at: nowIso(), created_by: DB._actor });
      Object.assign(row, clean, { kind: row.std === 'pre' ? 'reminder' : ['post', 'offer'].includes(row.std) ? 'followup' : 'automation', updated_at: nowIso() });
      audit('comms.automation', `Saved automation “${row.name}”${row.enabled ? '' : ' (off)'}`); Demo.save(); return clone(row);
    }
    return must(sb.rpc('save_automation', { p_bo: DB._bo, p: a }));
  },
  async deleteAutomation(id) {
    if (!LIVE) { const st = Demo.fresh(); need('comms.automations'); const a = (st.automations || []).find(x => x.id === id && x.box_office_id === DB._bo); if (!a) throw new Error('Automation not found');
      st.automations = st.automations.filter(x => x !== a); (st.outbox || []).forEach(m => { if (m.automation_id === id && m.status === 'queued') { m.status = 'cancelled'; m.error = 'automation deleted'; } });
      audit('comms.automation', `Deleted automation “${a.name}”`); Demo.save(); return; }
    await must(sb.rpc('delete_automation', { p_bo: DB._bo, p_id: id }));
  },
  async saveIntegration(ig, secret) {
    if (!LIVE) { Demo.fresh(); try { return demoSaveIntegration(ig, secret); } finally { Demo.save(); } }
    return must(sb.rpc('save_integration', { p_bo: DB._bo, p: ig, p_secret: secret || null }));
  },
  async deleteIntegration(id) {
    if (!LIVE) { const st = Demo.fresh(); need('admin.integrations'); const g = (st.integrations || []).find(x => x.id === id && x.box_office_id === DB._bo); if (!g) throw new Error('Integration not found');
      st.integrations = st.integrations.filter(x => x !== g); delete (st.secrets || {})[id]; (st.deliveries || []).forEach(d => { if (d.integration_id === id && d.status === 'queued') d.status = 'cancelled'; });
      audit('admin.integrations', `Disconnected ${INTEGRATIONS[g.kind].name} “${g.name}”`); Demo.save(); return; }
    await must(sb.rpc('delete_integration', { p_bo: DB._bo, p_id: id }));
  },
  async testIntegration(id) {   // a 'ping' delivery to check the connection
    if (!LIVE) { const st = Demo.fresh(); need('admin.integrations'); const g = (st.integrations || []).find(x => x.id === id && x.box_office_id === DB._bo); if (!g) throw new Error('Integration not found');
      const d = { id: uid(), box_office_id: DB._bo, integration_id: g.id, kind: g.kind, event: 'ping', event_id: 'evt_' + randCode(14).toLowerCase(), payload: { type: 'ping', created: nowIso(), data: { box_office: st.boxOffices.find(b => b.id === DB._bo)?.name } }, status: 'queued', attempts: 0, created_at: nowIso(), response: '' };
      (st.deliveries ||= []).unshift(d); demoDeliver(st); Demo.save(); return clone(d); }
    return must(sb.rpc('test_integration', { p_bo: DB._bo, p_id: id }));
  },
  async contactAction(email, action, p = {}) {
    if (!LIVE) { Demo.fresh(); try { const { token, ...c } = demoContactAction(email, action, p); return c; } finally { Demo.save(); } }
    return must(sb.rpc('contact_action', { p_bo: DB._bo, p_email: email, p_action: action, p }));
  },
  async outboxAction(id, action) {   // retry a failed / held message · cancel a queued one
    if (!LIVE) {
      const st = Demo.fresh(), m = (st.outbox || []).find(x => x.id === id && x.box_office_id === DB._bo); if (!m) throw new Error('Message not found');
      m.order_id ? need('orders.resend', m.event_id || undefined) : anyPerm(['comms.email', 'comms.marketing']);
      if (action === 'cancel') { if (m.status !== 'queued') throw new Error('Only a queued message can be cancelled'); Object.assign(m, { status: 'cancelled', error: 'cancelled by ' + DB._actor }); }
      else if (action === 'retry') { if (!['failed', 'suppressed'].includes(m.status)) throw new Error('Only a failed or held message can be retried'); Object.assign(m, { status: 'queued', send_at: nowIso(), error: '' }); demoDeliver(st); }
      else throw new Error('Unknown action');
      Demo.save(); return clone(m);
    }
    return must(sb.rpc('outbox_action', { p_bo: DB._bo, p_id: id, p_action: action }));
  },
  async createApiKey(name, scopes) {
    const sc = (scopes || []).filter(x => API_SCOPES[x]); if (!sc.length) throw new Error('Choose what the key may read');
    if (!LIVE) {
      const st = Demo.fresh(); need('admin.api'); const key = 'set_live_' + [...crypto.getRandomValues(new Uint8Array(20))].map(b => b.toString(16).padStart(2, '0')).join(''), row = { id: uid(), box_office_id: DB._bo, name: String(name || 'API key').trim().slice(0, 80) || 'API key',
        prefix: key.slice(0, 13), hash: await sha256hex(key), scopes: sc, created_at: nowIso(), created_by: DB._actor, last_used_at: null, revoked_at: null };
      (st.apiKeys ||= []).push(row); audit('admin.api', `Created API key “${row.name}” (${sc.join(', ')})`); Demo.save(); const { hash, ...k } = row; return { ...clone(k), key };
    }
    return must(sb.rpc('create_api_key', { p_bo: DB._bo, p_name: name, p_scopes: sc }));
  },
  async revokeApiKey(id) {
    if (!LIVE) { const st = Demo.fresh(); need('admin.api'); const k = (st.apiKeys || []).find(x => x.id === id && x.box_office_id === DB._bo); if (!k) throw new Error('Key not found'); k.revoked_at = nowIso(); k.revoked_by = DB._actor; audit('admin.api', `Revoked API key “${k.name}”`); Demo.save(); return; }
    await must(sb.rpc('revoke_api_key', { p_bo: DB._bo, p_id: id }));
  },
  // the unsubscribe / preferences page a marketing email links to (#/unsubscribe/<token>) — anyone holding the link, no sign-in
  async unsubInfo(token) {
    if (!LIVE) { const st = Demo.fresh(), c = (st.contacts || []).find(x => x.token === String(token || '')); if (!c) return null; const bo = st.boxOffices.find(b => b.id === c.box_office_id);
      return { box_office: bo?.name || '', email: maskEmail(c.email), email_on: !!(c.email_optin && !c.unsub_email_at), sms_on: !!(c.sms_optin && !c.unsub_sms_at), has_phone: !!c.phone, sms_stopped: !!c.unsub_sms_at }; }
    return must(sb.rpc('unsub_info', { p_token: token }));
  },
  async unsubscribe(token, prefs) {
    if (!LIVE) { const st = Demo.fresh(), c = (st.contacts || []).find(x => x.token === String(token || '')); if (!c) throw new Error('This link is not valid any more');
      if (prefs.email === false) consentChange(st, c, 'optout', 'unsubscribe link', c.email); else if (prefs.email === true && !(c.email_optin && !c.unsub_email_at)) consentChange(st, c, 'optin', 'preferences page', c.email);
      if (prefs.sms === false && !c.unsub_sms_at && c.phone) consentChange(st, c, 'sms_optout', 'unsubscribe link', c.email); else if (prefs.sms === true && c.phone && !(c.sms_optin && !c.unsub_sms_at)) consentChange(st, c, 'sms_optin', 'preferences page', c.email);
      Demo.save(); return this.unsubInfo(token); }
    return must(sb.rpc('unsubscribe', { p_token: token, p: prefs }));
  },
  // ── Stage 9: event expenses, full data exports ──
  async saveExpense(e) {
    const row = { id: e.id || null, event_id: e.event_id, category: EXPENSE_CATS.includes(e.category) ? e.category : 'Other', description: String(e.description || '').trim().slice(0, 200),
      vendor: String(e.vendor || '').trim().slice(0, 120), amount: cents(e.amount), date: String(e.date || '').slice(0, 10) };
    if (!(row.amount > 0)) throw new Error('Enter the expense amount');
    if (LIVE) return must(sb.rpc('save_expense', { p_bo: DB._bo, p: row }));
    const st = Demo.fresh(); need('finance.expenses', row.event_id);
    if (!st.events.some(x => x.id === row.event_id && x.box_office_id === DB._bo)) throw new Error('Unknown event');
    const list = st.expenses ||= [], prev = row.id && list.find(x => x.id === row.id && x.box_office_id === DB._bo);
    if (row.id && !prev) throw new Error('Expense not found');
    const out = prev ? Object.assign(prev, row, { updated_at: nowIso(), updated_by: DB._actor }) : (list.push({ ...row, id: uid(), box_office_id: DB._bo, by: DB._actor, at: nowIso() }), list[list.length - 1]);
    audit('finance.expense', `${prev ? 'Changed' : 'Added'} expense: ${row.category}${row.description ? ' — ' + row.description : ''} ${money_(row.amount)}`, { target: row.event_id }); Demo.save(); return clone(out);
  },
  async deleteExpense(id) {
    if (LIVE) return must(sb.rpc('delete_expense', { p_bo: DB._bo, p_id: id }));
    const st = Demo.fresh(), e = (st.expenses || []).find(x => x.id === id && x.box_office_id === DB._bo); if (!e) throw new Error('Expense not found');
    need('finance.expenses', e.event_id); st.expenses = st.expenses.filter(x => x !== e);
    audit('finance.expense', `Deleted expense: ${e.category}${e.description ? ' — ' + e.description : ''} ${money_(e.amount)}`, { target: e.event_id }); Demo.save();
  },
  async importExpenses(eventId, rows) {
    if (!rows?.length) throw new Error('No expenses to import');
    if (LIVE) return must(sb.rpc('import_expenses', { p_bo: DB._bo, p_event: eventId, p: rows }));
    const st = Demo.fresh(); need('finance.expenses', eventId); if (!st.events.some(x => x.id === eventId && x.box_office_id === DB._bo)) throw new Error('Unknown event');
    for (const r of rows) { if (!(cents(r.amount) > 0)) throw new Error('Every expense needs an amount'); (st.expenses ||= []).push({ id: uid(), box_office_id: DB._bo, event_id: eventId, category: EXPENSE_CATS.includes(r.category) ? r.category : 'Other',
      description: String(r.description || '').slice(0, 200), vendor: String(r.vendor || '').slice(0, 120), amount: cents(r.amount), date: String(r.date || '').slice(0, 10), by: DB._actor, at: nowIso(), imported: true }); }
    audit('finance.expense', `Imported ${rows.length} expense${rows.length === 1 ? '' : 's'}`, { target: eventId }); Demo.save(); return rows.length;
  },
  async setExpensesFinal(eventId, final) {
    if (LIVE) return must(sb.rpc('set_expenses_final', { p_bo: DB._bo, p_event: eventId, p_final: !!final }));
    const st = Demo.fresh(); need('finance.expenses', eventId); st.expenseFinal ||= {};
    if (final) st.expenseFinal[eventId] = { by: DB._actor, at: nowIso() }; else delete st.expenseFinal[eventId];
    audit('finance.expense', final ? 'Marked all expenses entered — profit is final' : 'Profit marked estimated again (more expenses to come)', { target: eventId }); Demo.save();
  },
  // Everything a box office owns, unmasked — for its owner (always, even while suspended), staff holding both export permissions, or a
  // platform super admin. The organizer never depends on the platform to get its records out. LIVE: export_box_office().
  async exportAll(boId) {
    if (LIVE) return must(sb.rpc('export_box_office', { p_bo: boId }));
    const st = Demo.fresh(), bo = st.boxOffices.find(b => b.id === boId); if (!bo) throw new Error('Box office not found');
    const m = memberFor(st, DB._actor, bo.id), sup = st.platform.admins.includes(DB._actor);
    if (!sup && !(m && (m.owner || (hasPerm(m, 'finance.export') && hasPerm(m, 'customers.export'))))) throw new Error('Only the owner (or staff who can export both customer and financial data) can download everything');
    const of = k => clone((st[k] || []).filter(x => x.box_office_id === bo.id)), evIds = new Set(st.events.filter(e => e.box_office_id === bo.id).map(e => e.id));
    const prev = DB._bo; DB._bo = bo.id; audit('data.export', 'Downloaded all of the box office\'s data'); DB._bo = prev; Demo.save();
    return { exported_at: nowIso(), box_office: clone({ ...bo, secrets: undefined }), events: of('events'), orders: of('orders').map(({ access_key, attempt_key, ...o }) => o), tickets: of('tickets'),
      credits: of('credits'), order_log: of('orderLog'), contacts: of('contacts').map(({ token, ...c }) => c), consent_log: of('consentLog'), promos: of('promos'), tracking: of('tracking'),
      waitlist: clone((st.waitlist || []).filter(w => evIds.has(w.event_id))), scan_log: clone((st.scanLog || []).filter(r => evIds.has(r.event_id))), seat_log: clone((st.seatLog || []).filter(r => evIds.has(r.event_id))),
      expenses: of('expenses'), payouts: of('payouts'), processor_tx: of('procTx'), outbox: of('outbox').map(({ vars, ...m2 }) => m2), audit: of('audit'),
      members: of('members').map(({ id, email, name, template, perms, events, status }) => ({ id, email, name, template, perms, events, status })),
      views: Object.fromEntries([...evIds].map(id => [id, viewStats(st.views?.[id])])) };
  },
  // Platform-wide (super admins only): every box office, its team size, sales, platform fees and payouts — never card details.
  async platformExport() {
    if (LIVE) return must(sb.rpc('platform_export'));
    needSuper(); const st = Demo.fresh(); audit('data.export', 'Downloaded platform-wide data', { bo: null }); Demo.save();
    return { exported_at: nowIso(), platform: clone(st.platform), box_offices: st.boxOffices.map(b => ({ id: b.id, name: b.name, slug: b.slug, status: b.status, owner: b.owner, created_at: b.created_at, platform_fee: b.platformFee || null })),
      members: st.members.map(({ box_office_id, email, name, template, status }) => ({ box_office_id, email, name, template, status })),
      events: st.events.map(e => ({ id: e.id, box_office_id: e.box_office_id, name: e.name, start: e.start, status: e.status })),
      orders: st.orders.map(o => ({ id: o.id, box_office_id: o.box_office_id, ref: o.ref, status: o.status, created_at: o.created_at, paid_at: o.paid_at, events: o.event_ids, method: payMethodOf(o),
        total: o.data.total || 0, tax: o.data.tax || 0, fee: o.data.fee || 0, platform_fee: o.data.platformFee || 0, processing_fee: o.data.processingFee || 0, refunded: o.data.refunded || 0, credited: o.data.credited || 0, chargebacks: chargebacksOf(o) })),
      payouts: clone(st.payouts || []) };
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
    } else if (action === 'move') {   // same price level only; upgrades / downgrades go through the order (price difference)
      const to = o.to, from = seats[0], t = st.tickets.find(x => x.event_id === eventId && x.status === 'valid' && x.seat === from && (x.slot_id || '') === slot);
      if (!t) throw new Error('That seat has no ticket to move'); if (!ev.seating.meta?.[to]) throw new Error('Choose the new seat');
      if (ev.seating.index[to] !== t.ticket_type_id) throw new Error('That seat is a different price level — use Change seats on the order to upgrade or downgrade');
      const ord = st.orders.find(z => z.id === t.order_id), r = changeOrderTickets(st, ord, { changes: [{ ticket: t.id, seat: to }] }, DB._actor, true);
      (st.orderLog ||= []).unshift({ id: uid(), at: nowIso(), box_office_id: ord.box_office_id, order_id: ord.id, ref: ord.ref, event_id: eventId, kind: 'change', summary: `moved from ${seatText(ev, from)} to ${seatText(ev, to)} (seat inventory)`, by: DB._actor, note: String(o.note || ''), data: r });
      queueMail(st, ord, 'updated', 'Your updated tickets', 'Your seat has changed. Your new ticket is attached — the old one no longer works.', DB._actor);
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
      const w = { id: uid(), box_office_id: ev.box_office_id, event_id: eventId, name: name.trim(), email: email.toLowerCase(), phone: String(phone).trim().slice(0, 40), created_at: nowIso() }; st.waitlist.push(w);
      const c = contactOf(st, ev.box_office_id, w.email); if (!c.name) c.name = w.name.slice(0, 120); if (!c.phone && normPhone(w.phone)) c.phone = normPhone(w.phone);
      emitEvent(st, ev.box_office_id, 'waitlist.signup', { event_id: eventId, name: w.name, email: w.email, phone: w.phone }, { email: w.email, name: w.name, phone: w.phone, tickets: [], eventIds: [eventId], eventId, key: w.id });
      Demo.save(); return;
    }
    await must(sb.rpc('join_waitlist', { p_event: eventId, p_name: name, p_email: email, p_phone: phone }));
  },
  async placeOrder(payload, asTeam = false) {
    if (!LIVE) { Demo.fresh(); return demoPlaceOrder(clone(payload), asTeam ? need('orders.edit') : null); }
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
    return { orders: os.map(o => ({ ...buyerOrder(o), key: o.access_key })), tickets: clone(st.tickets.filter(t => t.status !== 'replaced' && os.some(o => o.id === t.order_id))) };
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
      return { order: buyerOrder(o), tickets: clone(st.tickets.filter(t => t.order_id === id && t.status !== 'replaced')) };
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
        // side boxes upstairs: the box name goes on the ticket, no row ("Boxes · Box 1 · Seat 2")
        ...[1, 2].map(n => ({ id: shortId('sec_'), code: 'BX' + n, name: 'Box ' + n, area: 'Boxes', level: 'L2', kind: 'rows', x: n === 1 ? -390 : 330, y: -40, rot: n === 1 ? 20 : -20, rows: 1, seatsPerRow: 4,
          rowStart: 'A', hideRow: true, showName: true, ticketTypeId: circleTT.id })),
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
  ev1.entrances = [{ id: 'en_main', name: 'Main entrance', ticketTypeIds: [], areas: [] }, { id: 'en_circle', name: 'Circle entrance', ticketTypeIds: [], areas: ['Circle'] },
    { id: 'en_box', name: 'Box seat entrance', ticketTypeIds: [], areas: ['Boxes'] }];
  const ev2 = mk({ slug: 'neon-nights-live', name: 'Neon Nights Live', category: 'Live music', start: day(0, 20, 0), end: day(0, 23, 30), doors: '7:00 PM',
    summary: 'Tonight — three bands, one stage.', venue: 'The Warehouse', address: '210 Kent Ave, Brooklyn, NY 11249', audience: '18+ · ID required',
    description: 'Three of the city\'s best live acts on one stage. Standing room, full bar.\n\nPhoto ID required at the door.',
    capacity: 450, ticketTypes: [tt('General admission', 3500, 380), tt('Early entry', 5500, 60, { desc: 'Doors 30 minutes early' }), tt('Group of 5', 15000, 30, { admits: 5, desc: 'Admits five — save $25', max: 4, group: 'Groups' }),
      tt('VIP table', 60000, 5, { hidden: true, desc: 'Reserved table for 6 with bottle service', max: 1, group: 'VIP' }), tt('Artist guest list', 0, 20, { adminOnly: true, desc: 'Issued by the box office' })],
    addons: [prod('Parking', 1500, 40, { category: 'Parking' }), prod('Tour T-shirt', 2500, 0, { category: 'Merchandise', standalone: true })] });
  ev2.bundles = [{ id: shortId('bd_'), name: 'Ticket + parking', desc: 'General admission and a parking spot', price: 4500, qty: 30, max: 4, parts: [{ ticketTypeIds: [ev2.ticketTypes[0].id], qty: 1 }], addons: [{ addonId: ev2.addons[0].id, qty: 1 }] }];
  ev2.secrets.ticketPasswords[ev2.ticketTypes[3].id] = 'VIPACCESS';
  // Stage 7: doors. The VIP door only takes VIP tables and early entry; the main door takes everyone.
  ev2.entrances = [{ id: 'en_main', name: 'Main entrance', ticketTypeIds: [], areas: [] }, { id: 'en_vip', name: 'VIP entrance', ticketTypeIds: [ev2.ticketTypes[1].id, ev2.ticketTypes[3].id, ev2.ticketTypes[4].id], areas: [] }];
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
    mem(bo1, 'support@skyline.example', 'Ravi Shah', 'customer_service'), mem(bo1, 'finance@skyline.example', 'Lena Ortiz', 'finance'), mem(bo1, 'marketing@skyline.example', 'Mia Chen', 'marketing'),
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
  { // Stage 6 sample history: an upgrade paid at the box office, a one-ticket refund, a ticket turned into future-event credit, goodwill credit, notes
    const A = DB._actor, B = DB._bo; DB._actor = bo1.owner; DB._bo = bo1.id;
    try {
      const tk = o => Demo.st.tickets.filter(t => t.order_id === o.id && t.status === 'valid');
      const plain = Demo.st.orders.filter(o => o.event_ids[0] === ev1.id && o.status === 'paid' && !o.data.comp && !o.data.code && tk(o).length && !tk(o).some(t => t.bundle));
      const up = plain.find(o => tk(o).length === 1 && tk(o)[0].ticket_type_id === stallsTT.id);
      const prem = [...seatStates(ev1, { tickets: Demo.st.tickets, statuses: Demo.st.seatStatus, orders: Demo.st.orders }).values()].filter(x => x.state === 'available' && x.p.tt === vipTT.id).map(x => x.p.id);
      if (up && prem.length) demoOrderAction(up.id, 'change', { changes: [{ ticket: tk(up)[0].id, seat: prem[prem.length - 1] }], settle: 'collect', method: 'terminal', note: 'Asked for a better view at the box office' });
      const two = plain.filter(o => o !== up && tk(o).length >= 2);
      if (two[0]) demoOrderAction(two[0].id, 'refund', { mode: 'tickets', tickets: [tk(two[0])[0].id], fees: true, to: 'original', cancel: true, seat: 'release', note: 'One guest can no longer come' });
      if (two[1]) demoOrderAction(two[1].id, 'cancel', { tickets: [tk(two[1])[1].id], seat: 'release', refund: { mode: 'tickets', to: 'eventCredit', creditEvent: ev7.id }, note: 'Coming to the jazz brunch instead' });
      if (two[2]) demoOrderAction(two[2].id, 'note', { body: 'Called to check step-free access — seats are on the aisle.' });
      demoCreditAction('issue', { email: 'maya@example.com', name: 'Maya Patel', amount: 2500, expires: day(180), note: 'Sorry about the late doors at Neon Nights' });
      Demo.st.custNotes = [{ id: uid(), box_office_id: bo1.id, email: 'maya@example.com', body: 'Regular — prefers aisle seats. Happy to hear about presales.', by: bo1.owner, at: day(-3, 15) }];
    } catch (e) { console.warn('Stage 6 sample data', e); }
    DB._actor = A; DB._bo = B;
  }
  ev1.seating.noSingles = true;  // switched on after the sample sales
  bo1.venues = [eventToVenue(ev1, 'Grand Lyric Theatre'), eventToVenue(bo1.eventTemplates[4].event, 'Skyline Roof — dinner layout')];
  bo1.venues[1].address = ev7.address; ev1.seating.venueId = bo1.venues[0].id; ev1.seating.venueName = bo1.venues[0].name;
  // ev2 is tonight: doors are open and some guests are already in (for the scanner app).
  // Two phones and a venue tablet are scanning at two doors; the scan log has the check-ins plus a few duplicate / invalid attempts.
  { const devs = [['dev_door1', 'Door phone 1', 'Main entrance', 'door@example.com'], ['dev_door2', 'Door phone 2', 'Main entrance', 'scanner@example.com'], ['dev_vip', 'VIP tablet', 'VIP entrance', 'door@example.com']];
    Demo.st.devices = devs.map(([id, name, entrance, by]) => ({ id, box_office_id: bo1.id, name, entrance, first_seen: day(0, 18, 40), last_seen: nowIso(), last_by: by, scans: 0, disabled: false, renamed: true }));
    const log = Demo.st.scanLog = [], vipIds = new Set(ev2.entrances[1].ticketTypeIds);
    const add = (at, t, result, d, extra = {}) => { const dv = Demo.st.devices.find(x => x.id === d[0]); dv.scans++;
      log.push({ id: uid(), at, box_office_id: bo1.id, event_id: ev2.id, slot_id: null, ticket_id: t?.id || null, code: t?.code || extra.code, result, entrance: d[2], device: d[0], device_name: d[1], by: d[3], manual: !!extra.manual, override: false }); };
    Demo.st.tickets.filter(t => t.event_id === ev2.id && t.status === 'valid').forEach(t => { if (Math.random() >= .4) return;
      const d = vipIds.has(t.ticket_type_id) && Math.random() < .8 ? devs[2] : rnd(devs.slice(0, 2)), manual = Math.random() < .05;
      t.checked_in_at = new Date(Date.now() - Math.pow(Math.random(), .6) * 110 * 6e4).toISOString();
      t.checkin = { entrance: d[2], device: d[0], device_name: d[1], by: d[3], manual }; add(t.checked_in_at, t, 'ok', d, { manual });
      if (Math.random() < .06) add(new Date(Date.parse(t.checked_in_at) + 4 * 6e4).toISOString(), t, 'already', d); });
    for (const code of ['X7Q2PLM9KA', 'HELLO12345']) add(new Date(Date.now() - Math.random() * 60 * 6e4).toISOString(), null, 'unknown', devs[0], { code });
    const gone = Demo.st.tickets.find(t => t.event_id === ev2.id && t.status === 'cancelled'); if (gone) add(new Date(Date.now() - 20 * 6e4).toISOString(), gone, gone.refunded > 0 ? 'refunded' : 'cancelled', devs[1]);
    log.sort((a, b) => b.at < a.at ? -1 : 1); }
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
  // checkouts people started and never paid (expired), and two buyers holding gala seats while they choose right now
  for (const ev of [ev1, ev2]) for (let i = 0; i < 4; i++) try {
    const t = ev.ticketTypes.find(x => !x.hidden && !x.adminOnly), open = ev.seating?.enabled ? [...seatStates(ev, { tickets: Demo.st.tickets, statuses: Demo.st.seatStatus, orders: Demo.st.orders }).values()].filter(x => x.state === 'available' && x.p.tt === t.id) : [];
    const seats = open.length ? [open[open.length - 1 - i].p.id] : [];
    const r = demoPlaceOrder({ buyer: { name: rnd(first) + ' ' + rnd(last), email: `left${n++}@example.com`, phone: '' }, items: [{ eventId: ev.id, ticketTypeId: t.id, qty: 1, seats }], addons: [], payment: 'card', answers: qAns(ev), ticketAnswers: tAns(ev, 1) }, null);
    const o = Demo.st.orders.find(x => x.id === r.id); o.created_at = day(-Math.floor(Math.random() * 20), 10 + i); o.expires_at = o.created_at; o.status = 'expired';
  } catch (e) { }
  { const L = [...seatStates(ev1, { tickets: Demo.st.tickets, statuses: Demo.st.seatStatus, orders: Demo.st.orders }).values()].filter(x => x.state === 'available' && x.p.tt === circleTT.id).slice(0, 3);
    L.forEach((x, i) => Demo.st.seatStatus.push({ id: uid(), box_office_id: bo1.id, event_id: ev1.id, slot_id: '', seat: x.p.id, status: 'checkout', note: '', by: 'buyer', at: new Date().toISOString(), expires_at: new Date(Date.now() + (4 + i * 2) * 6e4).toISOString(), token: 'seed-hold-' + (i < 2 ? 1 : 2) })); }
  // live activity: who is on each event page now, carts in progress, and earlier carts that ended in an order or were abandoned
  Demo.st.presence = {};
  for (const ev of events.filter(e => e.status === 'published')) {
    const m = Demo.st.presence[ev.id] = {}, n = Demo.st.orders.filter(o => o.event_ids.includes(ev.id)).length, past = () => Date.now() - (1 + Math.random() * 20) * 864e5;
    for (let i = 0; i < Math.round(n * .6); i++) { const at = past(); m[randCode(8).toLowerCase()] = { at, cart: 0, carted: at - 3e5, conv: at }; }
    for (let i = 0; i < Math.round(n * .35); i++) { const at = past(); m[randCode(8).toLowerCase()] = { at, cart: 1 + Math.floor(Math.random() * 3), carted: at - 2e5, conv: 0 }; }
    const live = ev === ev2 ? 9 + Math.floor(Math.random() * 6) : Math.floor(Math.random() * 4);
    for (let i = 0; i < live; i++) { const at = Date.now() - Math.random() * 9e4, cart = Math.random() < .4 ? 1 + Math.floor(Math.random() * 4) : 0; m[randCode(8).toLowerCase()] = { at, cart, carted: cart ? at - 6e4 : 0, conv: 0 }; }
  }
  // Stage 8: what the sample box offices have sent so far, who consented (and when), standard workflows + a few custom automations,
  // a sent and a scheduled campaign, saved segments, connections and an API key. Message history is back-dated to the orders.
  { const UT = { newsletter: { source: 'newsletter', medium: 'email', campaign: 'winter-launch' }, instagram: { source: 'instagram', medium: 'social', campaign: 'gala-reels' }, facebook: { source: 'facebook', medium: 'paid', campaign: 'winter-launch' } };
    for (const o of Demo.st.orders) if (UT[o.data.source] && Math.random() < .7) o.data.utm = { ...UT[o.data.source] }; }
  { const st = Demo.st, O = id => st.orders.find(o => o.id === id), firstOrder = c => st.orders.filter(o => o.buyer_email === c.email && o.box_office_id === c.box_office_id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
    for (const m of st.outbox || []) if (m.status === 'queued') { const o = O(m.order_id), at = o?.paid_at && new Date(o.paid_at) < new Date(o.created_at) ? o.created_at : o?.paid_at || o?.created_at || m.at;
      Object.assign(m, { at, send_at: at, sent_at: at, status: 'sent', provider: 'demo', provider_id: 'demo_' + randCode(10).toLowerCase(), attempts: 1 }); }
    let i = 0;
    for (const c of st.contacts || []) {
      const o = firstOrder(c), at = o?.created_at || day(-20); c.created_at = at; if (c.email_optin) c.email_optin_at = at;
      if (i % 3 === 0) { c.phone = '+1555' + String(2000000 + i * 7919).slice(-7); if (i % 2 === 0) { c.sms_optin = true; c.sms_optin_at = at; c.sms_optin_src = 'checkout · order ' + (o?.ref || ''); } }
      if (i % 17 === 5 && c.email_optin) { c.email_optin = false; c.unsub_email_at = day(-3); (st.consentLog ||= []).unshift({ id: uid(), box_office_id: c.box_office_id, email: c.email, action: 'optout', source: 'unsubscribe link', by: c.email, at: c.unsub_email_at }); }
      if (i === 11) { c.suppressed = 'bounced'; c.suppressed_at = day(-6); (st.consentLog ||= []).unshift({ id: uid(), box_office_id: c.box_office_id, email: c.email, action: 'suppress:bounced', source: 'email provider: hard bounce', by: 'system', at: c.suppressed_at }); }
      if (i % 9 === 2) c.tags = ['VIP']; if (c.email === 'press@example.com') c.tags = ['Press'];
      i++;
    }
    for (const r of st.consentLog || []) if (r.source.startsWith('checkout')) { const c = st.contacts.find(x => x.email === r.email && x.box_office_id === r.box_office_id); if (c?.email_optin_at) r.at = c.email_optin_at; }
    st.automations = [bo1, bo2].flatMap(stdAutomations);
    st.automations.find(a => a.box_office_id === bo1.id && a.std === 'post').actions[0].link = 'https://forms.example.com/skyline-feedback';
    const au = (bo, name, trigger, cond, timing, actions) => ({ id: shortId('au_'), box_office_id: bo.id, std: '', kind: 'automation', name, enabled: true, trigger, cond: { eventIds: [], ticketTypeIds: [], areas: [], prices: [], minQty: 0, promo: '', tags: [], ...cond },
      timing, actions, runs: 0, last_run: null, created_at: day(-12), created_by: bo.owner });
    st.automations.push(
      au(bo1, 'VIP arrival instructions', { type: 'ticket.purchased' }, { eventIds: [ev1.id], ticketTypeIds: [vipTT.id] }, { mode: 'before', hours: 48 }, [
        { type: 'email', category: 'transactional', subject: 'Your Premium evening at {{event}}', body: 'Hi {{first_name}},\n\nYour Premium seats include the members’ bar from {{doors}}. Use the Stage Door entrance on 8th Ave and show your tickets: {{tickets_link}}' },
        { type: 'sms', category: 'transactional', body: '{{event}} {{date}}: Premium guests use the Stage Door on 8th Ave from {{doors}}. Tickets: {{tickets_link}}' }, { type: 'tag', tag: 'VIP' }]),
      au(bo1, 'Parking for 2+ Stalls', { type: 'ticket.purchased' }, { eventIds: [ev1.id], ticketTypeIds: [stallsTT.id], minQty: 2 }, { mode: 'delay', hours: 1 }, [
        { type: 'email', category: 'transactional', subject: 'Parking near {{venue}}', body: 'Hi {{first_name}}, the closest garage to {{venue}} is on 39th St. Pre-book a space from the event page: {{event_link}}' }]),
      au(bo1, 'Come back to your seats', { type: 'cart.abandoned' }, {}, { mode: 'delay', hours: 1 }, [
        { type: 'email', category: 'marketing', subject: 'Still thinking about {{event}}?', body: 'Hi {{first_name}}, your seats were released, but tickets for {{event}} are still on sale: {{event_link}}' }]),
      au(bo1, 'Large order alert', { type: 'ticket.purchased' }, { minQty: 8 }, { mode: 'now', hours: 0 }, [{ type: 'staff', to: bo1.owner, subject: 'Large order', body: 'Someone just bought 8 or more tickets.' }]));
    // a campaign sent ten days ago and one scheduled for next week
    const sentAt = day(-10, 11), b1 = { id: uid(), box_office_id: bo1.id, event_id: null, kind: 'campaign', name: 'Winter season announcement', subject: 'Winter at Skyline Live — first look',
      body: 'Hi {{first_name}},\n\nThe winter season is here: the Winter Orchestra Gala, Neon Nights Live and more. Early-bird prices end soon: {{event_link}}', channel: 'email', category: 'marketing',
      filter: { ...emptySeg(), status: 'optedIn' }, send_at: sentAt, status: 'sent', recipients: 0, queued: 0, skipped: {}, created_by: bo1.owner, created_at: sentAt };
    for (const p of demoPeopleFor(st, bo1.id, b1.filter)) { const why = sendGate(p.contact, 'email', 'marketing', p.email); if (why) { b1.skipped[why] = (b1.skipped[why] || 0) + 1; continue; }
      queueMsg(st, { box_office_id: bo1.id, kind: 'campaign', category: 'marketing', to: p.email, email: p.email, subject: b1.subject, body: b1.body, by: bo1.owner, at: sentAt, send_at: sentAt, campaign_id: b1.id, status: 'sent', sent_at: sentAt, provider: 'demo', attempts: 1 }); b1.queued++; }
    b1.recipients = b1.queued + Object.values(b1.skipped).reduce((a, x) => a + x, 0);
    const nextAt = day(6, 10), b2 = { ...b1, id: uid(), name: 'Gala: last seats in the Circle', subject: 'Last Circle seats for the Winter Orchestra Gala', body: 'Hi {{first_name}}, only a few Circle seats are left for {{event}} on {{date}}: {{event_link}}',
      event_id: ev1.id, filter: { ...emptySeg(), status: 'optedIn', tags: [] }, send_at: nextAt, status: 'scheduled', queued: 0, skipped: {}, created_at: day(-1) };
    for (const p of demoPeopleFor(st, bo1.id, b2.filter)) { if (sendGate(p.contact, 'email', 'marketing', p.email)) continue; queueMsg(st, { box_office_id: bo1.id, event_id: ev1.id, kind: 'campaign', category: 'marketing', to: p.email, email: p.email, subject: b2.subject, body: b2.body, by: bo1.owner, send_at: nextAt, campaign_id: b2.id }); b2.queued++; }
    b2.recipients = b2.queued; st.broadcasts.push(b1, b2);
    bo1.segments = [{ id: 'sg_gala', name: 'Gala buyers not checked in', filter: { ...emptySeg(), eventIds: [ev1.id], checkin: 'out' } }, { id: 'sg_vip', name: 'VIP-tagged, opted in', filter: { ...emptySeg(), status: 'optedIn', tags: ['VIP'] } }];
    st.secrets = {};
    const ig = (bo, kind, name, config, secret) => { const r = { id: uid(), box_office_id: bo.id, kind, name, active: true, config, created_at: day(-14), created_by: bo.owner, last_at: day(-1), last_error: '', secret_set: true, secret_hint: '…' + secret.slice(-4) }; st.secrets[r.id] = secret; return r; };
    st.integrations = [ig(bo1, 'webhook', 'Ticketing data warehouse', { url: 'https://hooks.example.com/set/skyline', events: ['payment.completed', 'ticket.cancelled', 'refund.issued', 'customer.checked_in'] }, 'whsec_' + randCode(32).toLowerCase()),
      ig(bo1, 'mailchimp', 'Skyline newsletter', { dc: 'us21', list: 'a1b2c3d4e5', who: 'optedIn' }, 'demo-' + randCode(20).toLowerCase() + '-us21')];
    st.deliveries = st.orders.filter(o => o.box_office_id === bo1.id && wasPaid(o)).slice(-6).map(o => ({ id: uid(), box_office_id: bo1.id, integration_id: st.integrations[0].id, kind: 'webhook', event: 'payment.completed', event_id: 'evt_' + randCode(14).toLowerCase(),
      payload: { type: 'payment.completed', created: o.paid_at, data: hookOrder(st, o) }, status: 'delivered', attempts: 1, created_at: o.paid_at, done_at: o.paid_at, response: '200 OK' }));
    st.apiKeys = [{ id: uid(), box_office_id: bo1.id, name: 'Website event listing', prefix: 'set_live_7k2m', hash: '0'.repeat(64), scopes: ['events:read'], created_at: day(-20), created_by: bo1.owner, last_used_at: day(0, 9), revoked_at: null }];
  }
  // Stage 9: sample refunds keep their per-ticket amounts; the demo processor's ledger is dated like the orders; daily payouts arrive two days
  // later (the last two days aren't paid out yet); the gala's expenses so far (profit still estimated); one open chargeback.
  { const st = Demo.st, O = id => st.orders.find(o => o.id === id);
    for (const o of st.orders) if (o.status === 'refunded' && !(o.data.refunds || []).length) {
      const tks = st.tickets.filter(t => t.order_id === o.id), ref = o.payment?.provider === 'demo' ? 're_demo_' + randCode(12).toLowerCase() : null;
      tks.forEach(t => { t.refunded = t.paid || 0; });
      o.data.refunds = [{ id: uid(), at: o.created_at, by: bo1.owner, amount: o.data.total, fees: (o.data.fee || 0) + (o.data.serviceFee || 0), to: 'original', note: '', per: Object.fromEntries(tks.map(t => [t.id, t.paid || 0])),
        status: 'done', ref, provider: o.payment?.provider || null }];
      o.data.refundedFees = (o.data.fee || 0) + (o.data.serviceFee || 0);
      if (ref) procTx(st, o, { type: 'refund', id: ref, amount: -o.data.total, at: o.created_at });
    }
    for (const r of st.procTx || []) { const o = O(r.order_id); if (o && r.type === 'charge') r.at = o.paid_at || o.created_at; }
    const cut = Date.now() - 2 * 864e5, groups = {};
    for (const r of st.procTx || []) if (new Date(r.at) < cut) (groups[r.box_office_id + '|' + localDay(r.at)] ||= []).push(r);
    st.payouts = Object.entries(groups).map(([k, rs]) => {
      const [boId, dayS] = k.split('|'), arr = new Date(dayS + 'T12:00:00'), id = 'po_demo_' + randCode(10).toLowerCase(); arr.setDate(arr.getDate() + 2); rs.forEach(r => { r.payout_id = id; });
      return { id, box_office_id: boId, provider: 'demo', amount: rs.reduce((a, r) => a + r.amount - (r.fee || 0) - (r.app_fee || 0), 0), status: arr <= new Date() ? 'paid' : 'in_transit',
        created_at: new Date(dayS + 'T23:59:00').toISOString(), arrival_at: arr.toISOString(), tx: rs.length };
    });
    const cbO = st.orders.find(o => o.box_office_id === bo1.id && o.status === 'paid' && o.payment?.provider === 'demo' && o.event_ids[0] === ev2.id && !o.data.refunds?.length);
    if (cbO) { const c = { id: uid(), at: day(-3, 15), by: 'processor', amount: cbO.data.total, status: 'open', reason: 'Customer says they did not make this purchase', ref: 'dp_demo_' + randCode(10).toLowerCase() };
      cbO.data.chargebacks = [c]; procTx(st, cbO, { type: 'dispute', id: c.ref, amount: -c.amount, at: c.at });
      (st.orderLog ||= []).unshift({ id: uid(), at: c.at, box_office_id: cbO.box_office_id, order_id: cbO.id, ref: cbO.ref, event_id: cbO.event_ids[0], kind: 'chargeback', summary: `Chargeback opened — ${money_(c.amount)} · ${c.reason}`, by: 'processor', note: '', data: { amount: c.amount }, before: null, after: null }); }
    st.expenses = [['Venue', 'Hall rental & house staff', 150000], ['Talent', 'Orchestra fee', 120000], ['AV', 'Sound & lighting', 30000], ['Security', 'Door & floor security', 15000],
      ['Marketing', 'Social ads', 20000], ['Insurance', 'Event liability cover', 6000]]
      .map(([category, description, amount], i) => ({ id: uid(), box_office_id: bo1.id, event_id: ev1.id, category, description, vendor: '', amount, date: localDay(day(-24 + i * 3)), by: bo1.owner, at: day(-24 + i * 3) }));
    st.expenseFinal = {};
  }
  return Demo.st;
}
