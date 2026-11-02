'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   SET data layer. One interface (DB.*), two backends:
   - LIVE: Supabase (config.js filled in) — pricing/inventory enforced by place_order() in SQL.
   - DEMO: this browser's localStorage, seeded with sample events — the same rules run here in JS.
   Event shape everywhere: {id, slug, status, ...publicData, secrets?:{password, ticketPasswords, discounts}}
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
  ['tickets', 'Tickets & pricing', [['view', 'View ticket types', 'v'], ['create', 'Create ticket types'], ['edit', 'Edit ticket types'], ['pricing', 'Change pricing'], ['comps', 'Create complimentary tickets'], ['discounts', 'Create discount codes'], ['discountsEdit', 'Edit discount codes']]],
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
  { id: 'marketing', name: 'Marketing', perms: ['events.view', 'tickets.view', 'tickets.discounts', 'tickets.discountsEdit', 'customers.names', 'customers.emails', 'customers.export', 'finance.totals', ...groupPerms('comms')] },
];
// member = {email, perms:[], events:'all'|[eventId], owner?, support?}; eventId optional (checks event scope too)
const hasPerm = (m, key, eventId) => !!m && (m.owner || m.support || (m.perms || []).includes(key)) && (!eventId || m.owner || m.support || m.events === 'all' || (m.events || []).includes(eventId));
const BO_STATUS = { pending: 'Awaiting approval', active: 'Active', suspended: 'Suspended', deactivated: 'Deactivated' };
const DEFAULT_PLATFORM = { name: 'SET', publicRegistration: false, feePct: 1, feeFixed: 25, plans: 'Per-ticket platform fee only — no subscription.', admins: ['moishsonn@gmail.com'] };
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
};

/* ── Pricing: the one quote function (display everywhere; authoritative in DEMO mode). ── */
function quote(cart, events, settings, discount) {
  const lines = [], byEv = id => events.find(e => e.id === id);
  let subtotal = 0, fee = 0, eligible = 0;
  for (const it of cart.items) {
    const ev = byEv(it.eventId); if (!ev) continue;
    const tt = (ev.ticketTypes || []).find(t => t.id === it.ticketTypeId); if (!tt) continue;
    const unit = +tt.price || 0;
    subtotal += unit * it.qty;
    if (unit > 0 && settings.feeMode === 'buyer') fee += it.qty * (Math.round(unit * (+settings.feePct || 0) / 100) + (+settings.feeFixed || 0));
    if (discount && (!discount.ticketTypeIds?.length || discount.ticketTypeIds.includes(tt.id))) eligible += unit * it.qty;
    const slot = it.slotId ? (ev.timeSlots || []).find(s => s.id === it.slotId) : null;
    lines.push({ kind: 'ticket', eventId: ev.id, eventName: ev.name, ticketTypeId: tt.id, name: tt.name, slotId: it.slotId || null,
      slotStart: slot?.start || null, seats: it.seats || [], qty: it.qty, unit, admits: +tt.admits || 1, currency: ev.currency || settings.currency });
  }
  for (const a of cart.addons || []) {
    const ev = byEv(a.eventId); const ad = (ev?.addons || []).find(x => x.id === a.addonId);
    if (!ad || a.qty < 1) continue;
    subtotal += (+ad.price || 0) * a.qty;
    lines.push({ kind: 'addon', eventId: ev.id, addonId: ad.id, name: ad.name, qty: a.qty, unit: +ad.price || 0 });
  }
  const disc = !discount ? 0 : discount.type === 'pct' ? Math.round(eligible * discount.amount / 100) : Math.min(+discount.amount, eligible);
  const tax = Math.round((subtotal - disc) * (+settings.taxPct || 0) / 100);
  const donation = Math.max(0, Math.round(+cart.donation || 0));
  return { lines, subtotal, discount: disc, fee, tax, donation, total: subtotal - disc + fee + tax + donation,
    currency: lines.find(l => l.currency)?.currency || settings.currency };
}

/* availability from a ticket list (DEMO) — same shape as the SQL availability() */
function availabilityFrom(tickets, eventId) {
  const a = { tt: {}, slots: {}, seats: [], total: 0 };
  for (const t of tickets) {
    if (t.event_id !== eventId || t.status !== 'valid') continue;
    a.total++; a.tt[t.ticket_type_id] = (a.tt[t.ticket_type_id] || 0) + 1;
    if (t.slot_id) a.slots[t.slot_id] = (a.slots[t.slot_id] || 0) + 1;
    if (t.seat) a.seats.push((t.slot_id || '') + '|' + t.seat);
  }
  return a;
}

/* ── Seat maps ───────────────────────────────────────────────────────────────────
   seating = {enabled, stage:{x,y,w,h,label}, sections:[...], prices:{seatId:ttId}, blocked:[seatId], index:{seatId:ttId}}
   section = {id, code, name, kind:'rows'|'table', x, y, rot, ticketTypeId,
              rows, seatsPerRow, rowSeats:[n per row], rowStart:'A', reverse, curve(0-100)  |  seats (table)}
   Seat ids are "<code>-<row><num>" (rows) or "<code>-<num>" (tables). `index` is DERIVED on save from the
   layout (the server checks each seat is sold as its own ticket type) — sections/prices stay the source. */
const SEAT = 26, ROWH = 30, ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function rowLabel(start, i) {
  if (/^\d+$/.test(String(start))) return String(+start + i);
  let k = Math.max(0, ROW_LETTERS.indexOf(String(start || 'A').toUpperCase())) + i, out = '';
  do { out = ROW_LETTERS[k % 24] + out; k = Math.floor(k / 24) - 1; } while (k >= 0);
  return out;
}
function seatLayout(st) {
  const seats = [], secs = [];
  for (const sec of st?.sections || []) {
    const local = []; let R = 0;
    if (sec.kind === 'table') {
      const n = Math.max(1, Math.min(40, +sec.seats || 8)); R = Math.max(26, n * SEAT / (2 * Math.PI) - 4);
      for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / n; local.push({ id: `${sec.code}-${i + 1}`, x: Math.cos(a) * (R + 15), y: Math.sin(a) * (R + 15), row: '', num: i + 1 }); }
    } else {
      const rows = Math.max(1, Math.min(60, +sec.rows || 1)), per = Math.max(1, Math.min(80, +sec.seatsPerRow || 10));
      const counts = Array.from({ length: rows }, (_, r) => Math.max(1, Math.min(80, +(sec.rowSeats || [])[r] || per)));
      const M = Math.max(...counts), W = (M - 1) * SEAT, bend = (+sec.curve || 0) / 100 * W * .22;
      counts.forEach((n, r) => {
        const label = rowLabel(sec.rowStart || 'A', r), off = (M - n) * SEAT / 2;
        for (let i = 0; i < n; i++) { const x = off + i * SEAT, t = W ? (x - W / 2) / (W / 2) : 0, num = sec.reverse ? n - i : i + 1;
          local.push({ id: `${sec.code}-${label}${num}`, x, y: r * ROWH - bend * t * t, row: label, num }); }
      });
    }
    const xs = local.map(p => p.x), ys = local.map(p => p.y);
    const g = { sec, local, R, minx: Math.min(...xs), maxx: Math.max(...xs), miny: Math.min(...ys), maxy: Math.max(...ys) };
    g.cx = (g.minx + g.maxx) / 2; g.cy = (g.miny + g.maxy) / 2;
    const a = (+sec.rot || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    for (const p of local) {
      const dx = p.x - g.cx, dy = p.y - g.cy;
      p.gx = (+sec.x || 0) + g.cx + dx * c - dy * sn; p.gy = (+sec.y || 0) + g.cy + dx * sn + dy * c;
      p.sec = sec; p.tt = (st.prices || {})[p.id] || sec.ticketTypeId || '';
      seats.push(p);
    }
    secs.push(g);
  }
  const st0 = st?.stage, xs = seats.map(p => p.gx), ys = seats.map(p => p.gy);
  if (st0) { xs.push(+st0.x, +st0.x + +st0.w); ys.push(+st0.y, +st0.y + +st0.h); }
  const bounds = xs.length ? { x0: Math.min(...xs) - 20, x1: Math.max(...xs) + 20, y0: Math.min(...ys) - 40, y1: Math.max(...ys) + 20 } : { x0: -200, x1: 200, y0: -150, y1: 150 };
  return { seats, secs, bounds };
}
const seatIndex = st => { const b = new Set(st.blocked || []); return Object.fromEntries(seatLayout(st).seats.filter(p => p.tt && !b.has(p.id)).map(p => [p.id, p.tt])); };

/* ════════════ DEMO backend (localStorage) ════════════ */
const DEMO_KEY = 'set_demo_v5';
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

function findDiscount(ev, code, orders) {
  const d = (ev.secrets?.discounts || []).find(x => x.code.toUpperCase() === String(code).trim().toUpperCase());
  if (!d) return null;
  if (d.expires && new Date(d.expires) < new Date()) return null;
  const used = orders.filter(o => ['paid', 'pending'].includes(o.status) && o.event_ids.includes(ev.id) && (o.data.code || '').toUpperCase() === d.code.toUpperCase()).length;
  if (+d.limit > 0 && used >= +d.limit) return null;
  const { limit, ...pub } = d; return pub;
}

function demoPlaceOrder(p, asTeam) {
  const st = Demo.st, manual = p.payment === 'manual';
  if (manual && !asTeam) throw new Error('not allowed');
  if (!String(p.buyer?.name || '').trim()) throw new Error('Name is required');
  if (!EMAIL_RE.test(p.buyer?.email || '')) throw new Error('A valid email is required');
  let disc = null, bo = null;
  const pending = { tt: {}, slots: {}, seats: [], total: {} };
  for (const it of p.items) {
    const ev = st.events.find(e => e.id === it.eventId && (e.status === 'published' || manual));
    if (!ev) throw new Error('Event is not on sale');
    const b = st.boxOffices.find(x => x.id === ev.box_office_id);
    if (!b || (b.status !== 'active' && !manual)) throw new Error('This box office is not selling tickets right now');
    if (bo && bo !== b) throw new Error('One order can only hold one organizer\'s events');
    bo = b;
    if (asTeam && !hasPerm(asTeam, 'orders.edit', ev.id)) throw new Error('You don\'t have permission to create orders for ' + ev.name);
    const tt = ev.ticketTypes.find(t => t.id === it.ticketTypeId); if (!tt) throw new Error('Unknown ticket type');
    const pw = p.unlock?.[ev.id] || '', sec = ev.secrets || {}, now = new Date();
    if (!(it.qty >= 1)) throw new Error('Bad quantity');
    if (!manual) {
      if (sec.password && pw !== sec.password) throw new Error('This event needs a password');
      if (sec.ticketPasswords?.[tt.id] && pw !== sec.ticketPasswords[tt.id]) throw new Error(tt.name + ' is locked');
      if (tt.salesStart && new Date(tt.salesStart) > now) throw new Error(tt.name + ' is not on sale yet');
      if (tt.salesEnd && new Date(tt.salesEnd) < now) throw new Error(tt.name + ' sales have ended');
      if (ev.salesEnd && new Date(ev.salesEnd) < now) throw new Error('Sales have ended');
      if (it.qty < (+tt.min || 1)) throw new Error(`Minimum ${tt.min} for ${tt.name}`);
      if (+tt.max > 0 && it.qty > +tt.max) throw new Error(`Maximum ${tt.max} for ${tt.name}`);
    }
    const av = availabilityFrom(st.tickets, ev.id), adm = it.qty * (+tt.admits || 1);
    const k = ev.id + tt.id; pending.tt[k] = (pending.tt[k] || 0) + adm; pending.total[ev.id] = (pending.total[ev.id] || 0) + adm;
    if (+tt.qty > 0 && (av.tt[tt.id] || 0) + pending.tt[k] > +tt.qty) throw new Error(`Only ${Math.max(+tt.qty - (av.tt[tt.id] || 0), 0)} ${tt.name} left`);
    if (+ev.capacity > 0 && av.total + pending.total[ev.id] > +ev.capacity) throw new Error('Event is sold out');
    if (ev.timeSlots?.length) {
      const slot = ev.timeSlots.find(s => s.id === it.slotId); if (!slot) throw new Error('Pick a time slot');
      const sk = ev.id + slot.id; pending.slots[sk] = (pending.slots[sk] || 0) + it.qty;
      if (+slot.capacity > 0 && (av.slots[slot.id] || 0) + pending.slots[sk] > +slot.capacity) throw new Error('That time slot is full');
    }
    if (ev.seating?.enabled) {
      if ((it.seats || []).length !== it.qty) throw new Error(`Pick ${it.qty} seat(s)`);
      for (const s of it.seats) {
        const key = (it.slotId || '') + '|' + s;
        if ((ev.seating.blocked || []).includes(s) || !ev.seating.index?.[s]) throw new Error(`Seat ${s} is unavailable`);
        if (ev.seating.index[s] !== tt.id) throw new Error(`Seat ${s} isn't a ${tt.name} seat`);
        if (av.seats.includes(key) || pending.seats.includes(ev.id + key)) throw new Error(`Seat ${s} was just taken`);
        pending.seats.push(ev.id + key);
      }
    }
    if (p.code && !disc) disc = findDiscount(ev, p.code, st.orders);
  }
  for (const a of p.addons || []) if (!p.items.some(i => i.eventId === a.eventId)) throw new Error('Unknown add-on');
  if (!p.items.length) throw new Error('Your cart is empty');
  if (p.code && !disc) throw new Error('That discount code is not valid');
  const q = quote({ items: p.items, addons: p.addons, donation: p.donation }, st.events, bo.settings, disc);
  const plat = st.platform, nTk = q.lines.filter(l => l.kind === 'ticket' && l.unit > 0).reduce((t, l) => t + l.qty, 0);
  const platformFee = q.subtotal - q.discount > 0 ? Math.round((q.subtotal - q.discount) * (+plat.feePct || 0) / 100) + nTk * (+plat.feeFixed || 0) : 0;
  if (q.total > 0 && !manual && !['offline', 'card'].includes(p.payment)) throw new Error('Choose a payment method');
  const status = (q.total === 0 || manual || p.payment === 'card') ? 'paid' : 'pending';
  let ref; do { ref = 'SET-' + randCode(6); } while (st.orders.some(o => o.ref === ref));
  const order = { id: uid(), box_office_id: bo.id, ref, access_key: uid(), status, buyer_email: p.buyer.email.trim().toLowerCase(),
    event_ids: [...new Set(p.items.map(i => i.eventId))], created_at: new Date().toISOString(),
    data: { buyer: p.buyer, lines: q.lines, subtotal: q.subtotal, discount: q.discount, fee: q.fee, tax: q.tax, donation: q.donation,
      total: q.total, code: disc?.code || null, payment: q.total === 0 ? 'free' : p.payment, answers: p.answers || {}, optIn: !!p.optIn,
      source: p.source || null, currency: q.currency, platformFee } };
  st.orders.push(order);
  for (const l of q.lines.filter(l => l.kind === 'ticket'))
    for (let i = 0; i < l.qty * l.admits; i++)
      st.tickets.push({ id: uid(), box_office_id: bo.id, order_id: order.id, event_id: l.eventId, ticket_type_id: l.ticketTypeId, slot_id: l.slotId || null,
        seat: l.seats[i] || null, code: randCode(10), holder: p.buyer.name, status: 'valid', checked_in_at: null });
  Demo.save();
  return { id: order.id, key: order.access_key, ref };
}

const rowToEvent = r => ({ ...(r.data || {}), id: r.id, box_office_id: r.box_office_id, slug: r.slug, status: r.status, created_at: r.created_at, ...(r.secrets ? { secrets: r.secrets } : {}) });
const eventToRow = ev => { const { id, box_office_id, slug, status, secrets, created_at, ...data } = ev; return { id, box_office_id, slug, status, data, secrets: secrets || {}, updated_at: new Date().toISOString() }; };
const clone = o => JSON.parse(JSON.stringify(o));
const publicEvent = ev => { const { secrets, ...rest } = clone(ev); return rest; };
const publicBo = b => ({ id: b.id, slug: b.slug, name: b.name, status: b.status, branding: { ...DEFAULT_BRANDING, ...b.branding }, settings: { ...DEFAULT_SETTINGS, ...b.settings, name: b.name } });
async function must(p) { const { data, error } = await p; if (error) throw new Error(error.message); return data; }
const nowIso = () => new Date().toISOString();
const maskEmail = e => String(e || '').replace(/^(.)[^@]*@(.)[^.]*(\..+)$/, '$1•••@$2•••$3');

/* ── DEMO "server": every organizer write passes need(), the same checks the SQL policies make in LIVE. ── */
function audit(kind, summary, o = {}) {
  const st = Demo.st; (st.audit ||= []).unshift({ id: uid(), at: nowIso(), actor: DB._actor || 'system', box_office_id: o.bo !== undefined ? o.bo : DB._bo || null,
    kind, summary, before: o.before ?? null, after: o.after ?? null });
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
const EVENT_TRACKED = [['name', 'Name'], ['status', 'Status'], ['start', 'Start'], ['end', 'End'], ['venue', 'Venue'], ['capacity', 'Capacity'], ['visibility', 'Visibility']];
function eventDiff(a, b) {
  const out = []; for (const [k, l] of EVENT_TRACKED) if (JSON.stringify(a?.[k] ?? '') !== JSON.stringify(b?.[k] ?? '')) out.push([l, a?.[k] ?? '', b?.[k] ?? '']);
  const price = e => Object.fromEntries((e?.ticketTypes || []).map(t => [t.name, t.price]));
  const pa = price(a), pb = price(b); for (const n of new Set([...Object.keys(pa), ...Object.keys(pb)])) if (pa[n] !== pb[n]) out.push(['Price · ' + n, pa[n] ?? '', pb[n] ?? '']);
  return out;
}

const DB = {
  live: LIVE, _actor: null, _bo: null, _support: false,
  async init() {
    if (!LIVE) {
      const st = Demo.load(), act = new Set(st.boxOffices.filter(b => b.status === 'active').map(b => b.id));
      return { settings: { ...DEFAULT_SETTINGS }, events: st.events.filter(e => e.status === 'published' && act.has(e.box_office_id)).map(publicEvent),
        bos: st.boxOffices.filter(b => act.has(b.id)).map(publicBo), platform: { name: st.platform.name, publicRegistration: st.platform.publicRegistration } };
    }
    const [plat, bos, evs] = await Promise.all([must(sb.from('platform_public').select('*').maybeSingle()),
      must(sb.from('box_offices').select('id,slug,name,status,branding,settings').eq('status', 'active')),
      must(sb.from('events').select('id,box_office_id,slug,status,data,created_at').eq('status', 'published'))]);
    return { settings: { ...DEFAULT_SETTINGS }, events: evs.map(rowToEvent), bos: bos.map(publicBo), platform: { ...DEFAULT_PLATFORM, ...(plat || {}) } };
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
      if (r.bo) r.bo = { ...r.bo, templates: r.bo.templates?.length ? r.bo.templates : DEFAULT_TEMPLATES, branding: { ...DEFAULT_BRANDING, ...r.bo.branding }, settings: { ...DEFAULT_SETTINGS, ...r.bo.settings, name: r.bo.name } };
      DB._bo = r.bo?.id || null; DB._support = !!r.me?.support; return r;
    }
    const st = Demo.fresh(), isSuper = st.platform.admins.includes(email);
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
      return { super: isSuper, bos, me: m, needs2fa: true, bo: publicBo(bo), events: [], orders: [], tickets: [], waitlist: [], team: [m], broadcasts: [], audit: [] };
    const P = k => hasPerm(m, k);
    const events = st.events.filter(e => e.box_office_id === bo.id && (m.owner || m.support || m.events === 'all' || (m.events || []).includes(e.id)));
    const evIds = new Set(events.map(e => e.id));
    const seeOrders = P('orders.view') || P('finance.totals') || P('finance.reports') || P('comms.lists') || P('customers.profiles');
    const orders = seeOrders ? clone(st.orders.filter(o => o.box_office_id === bo.id && o.event_ids.some(id => evIds.has(id)))) : [];
    const tickets = clone(st.tickets.filter(t => evIds.has(t.event_id)));
    // Customer-data and money permissions are applied here, before data leaves the "server".
    if (!P('customers.names')) { orders.forEach(o => o.data.buyer.name = 'Guest'); tickets.forEach(t => t.holder = 'Guest'); }
    if (!P('customers.emails')) orders.forEach(o => { o.buyer_email = maskEmail(o.buyer_email); o.data.buyer.email = o.buyer_email; });
    if (!P('customers.phones')) orders.forEach(o => { if (o.data.buyer.phone) o.data.buyer.phone = '•••'; });
    if (!P('finance.totals')) orders.forEach(o => { for (const k of ['subtotal', 'discount', 'fee', 'tax', 'donation', 'total', 'platformFee']) o.data[k] = null; o.data.lines.forEach(l => l.unit = null); });
    const full = clone({ ...bo, templates: bo.templates?.length ? bo.templates : DEFAULT_TEMPLATES });
    return { super: isSuper, bos, me: m, bo: { ...full, branding: { ...DEFAULT_BRANDING, ...full.branding }, settings: { ...DEFAULT_SETTINGS, ...full.settings, name: bo.name } },
      events: clone(events), orders, tickets,
      waitlist: P('orders.view') || P('comms.lists') ? clone(st.waitlist.filter(w => evIds.has(w.event_id))) : [],
      team: P('admin.invite') || P('admin.perms') || P('admin.remove') ? clone(st.members.filter(x => x.box_office_id === bo.id && x.status === 'active')).map(x => ({ ...x, owner: x.email === bo.owner })) : [{ ...m }],
      broadcasts: P('comms.email') || P('comms.notify') ? clone(st.broadcasts.filter(b => evIds.has(b.event_id))) : [],
      audit: P('admin.perms') ? clone(st.audit.filter(a => a.box_office_id === bo.id).slice(0, 800)) : clone(st.audit.filter(a => a.box_office_id === bo.id && a.actor === email).slice(0, 200)) };
  },
  async stillAllowed() { if (LIVE) return true; try { need(); return true; } catch (e) { return !e.revoked; } },
  async saveEvent(ev) {
    if (!LIVE) {
      const st = Demo.st, i = st.events.findIndex(e => e.id === ev.id), prev = i >= 0 ? st.events[i] : null;
      need(prev ? 'events.edit' : 'events.create', prev ? ev.id : null);
      if (prev && prev.status !== ev.status) need('events.publish', ev.id);
      if (prev && prev.box_office_id !== DB._bo) throw new Error('not allowed');
      const row = clone({ ...ev, box_office_id: DB._bo }), diff = eventDiff(prev, row);
      if (i >= 0) st.events[i] = row; else st.events.push(row);
      if (!prev) audit('event.created', 'Created event “' + row.name + '”');
      else if (diff.length) audit('event.updated', 'Updated “' + row.name + '”: ' + diff.map(d => d[0]).join(', '), { before: Object.fromEntries(diff.map(d => [d[0], d[1]])), after: Object.fromEntries(diff.map(d => [d[0], d[2]])) });
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
      if (cancel) Demo.st.tickets.forEach(t => { if (t.order_id === id) t.status = 'cancelled'; });
      audit('order.' + status, `Order ${o.ref}: ${was} → ${status}`, { before: { status: was }, after: { status } }); Demo.save(); return;
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
      if (undo) audit('door.undo', 'Undid check-in for ticket ' + t.code); Demo.save();
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
  async log(kind, summary) { if (!LIVE) { audit(kind, summary); Demo.save(); return; } await sb.from('audit_log').insert({ actor: DB._actor, box_office_id: DB._bo, kind, summary }); },
  async addBroadcast(b) {
    if (!LIVE) { need('comms.email', b.event_id); const row = { id: uid(), created_at: nowIso(), ...b }; Demo.st.broadcasts.push(row); audit('comms.broadcast', 'Sent “' + b.subject + '” to ' + b.recipients); Demo.save(); return row; }
    return must(sb.from('broadcasts').insert({ ...b, box_office_id: DB._bo }).select().single());
  },
  // ── platform super admin ──
  async loadPlatform() {
    if (LIVE) return must(sb.rpc('platform_overview'));
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
    if (!LIVE) return availabilityFrom(Demo.st.tickets, eventId);
    return must(sb.rpc('availability', { p_event: eventId }));
  },
  async checkDiscount(eventId, code) {
    if (!LIVE) { const ev = Demo.st.events.find(e => e.id === eventId); return ev ? findDiscount(ev, code, Demo.st.orders) : null; }
    return must(sb.rpc('check_discount', { p_event: eventId, p_code: code }));
  },
  async unlock(eventId, password) {
    if (!LIVE) {
      const sec = Demo.st.events.find(e => e.id === eventId)?.secrets || {};
      return { event: !!sec.password && sec.password === password, ticketTypes: Object.entries(sec.ticketPasswords || {}).filter(([, v]) => v && v === password).map(([k]) => k) };
    }
    return must(sb.rpc('unlock', { p_event: eventId, p_password: password }));
  },
  async joinWaitlist(eventId, name, email) {
    if (!EMAIL_RE.test(email)) throw new Error('Enter a valid email');
    if (!LIVE) { Demo.st.waitlist.push({ id: uid(), box_office_id: Demo.st.events.find(e => e.id === eventId)?.box_office_id, event_id: eventId, name, email: email.toLowerCase(), created_at: new Date().toISOString() }); Demo.save(); return; }
    await must(sb.rpc('join_waitlist', { p_event: eventId, p_name: name, p_email: email }));
  },
  async placeOrder(payload, asTeam = false) {
    if (!LIVE) return demoPlaceOrder(clone(payload), asTeam ? need('orders.edit') : null);
    return must(sb.rpc('place_order', { p: payload }));
  },
  async getOrder(id, key) {
    if (!LIVE) {
      const o = Demo.st.orders.find(x => x.id === id && x.access_key === key); if (!o) return null;
      const { access_key, ...order } = clone(o); return { order, tickets: clone(Demo.st.tickets.filter(t => t.order_id === id)) };
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
  const base = { capacity: 0, timezone: 'America/New_York', currency: 'USD', visibility: 'public', online: false, onlineUrl: '', image: '',
    timeSlots: [], seating: { enabled: false }, addons: [], questions: [], waitlist: true, emails: { confirmation: '', reminders: [] } };
  const mk = (o) => ({ ...base, id: uid(), status: 'published', created_at: day(-30), secrets: { password: '', ticketPasswords: {}, discounts: [] }, ...o });

  const vipTT = tt('Premium', 12000, 0, { desc: 'Front centre, rows A–C', max: 8 });
  const stallsTT = tt('Stalls', 6500, 0, { desc: 'Ground floor' });
  const circleTT = tt('Circle', 4500, 0, { desc: 'Raised rows J–L' });
  const ev1 = mk({ slug: 'winter-orchestra-gala', name: 'Winter Orchestra Gala', category: 'Concert',
    summary: 'A full symphony orchestra with guest soloists.', start: day(41, 19, 30), end: day(41, 22, 0), doors: '6:45 PM',
    venue: 'Grand Lyric Theatre', address: '1500 Broadway, New York, NY 10036',
    description: 'An evening of seasonal favourites performed by a 60-piece orchestra and guest soloists.\n\nDoors open 6:45 PM. The performance begins promptly at 7:30 PM. Seats are reserved — pick yours on the seat map.',
    ticketTypes: [vipTT, stallsTT, circleTT],
    seating: { enabled: true, stage: { x: -170, y: -120, w: 340, h: 46, label: 'STAGE' }, blocked: ['CEN-A1', 'CEN-A14', 'CIR-K1', 'CIR-K24'], prices: {},
      sections: [
        { id: shortId('sec_'), code: 'LFT', name: 'Stalls left', kind: 'rows', x: -365, y: 18, rot: 9, rows: 8, seatsPerRow: 6, rowStart: 'A', ticketTypeId: stallsTT.id },
        { id: shortId('sec_'), code: 'CEN', name: 'Stalls centre', kind: 'rows', x: -169, y: 0, rot: 0, rows: 8, seatsPerRow: 14, rowSeats: [12, 13, 14], rowStart: 'A', curve: 25, ticketTypeId: stallsTT.id },
        { id: shortId('sec_'), code: 'RGT', name: 'Stalls right', kind: 'rows', x: 235, y: 18, rot: -9, rows: 8, seatsPerRow: 6, rowStart: 'A', ticketTypeId: stallsTT.id },
        { id: shortId('sec_'), code: 'CIR', name: 'Circle', kind: 'rows', x: -299, y: 320, rot: 0, rows: 3, seatsPerRow: 24, rowStart: 'J', curve: 40, ticketTypeId: circleTT.id },
      ] },
    addons: [{ id: shortId('ad_'), name: 'Printed programme', price: 800, qty: 0 }, { id: shortId('ad_'), name: 'Parking pass', price: 2500, qty: 150 }],
    questions: [{ id: shortId('q_'), label: 'How did you hear about us?', type: 'select', options: 'Instagram, Email, Friend, Poster, Other', required: false }],
    secrets: { password: '', ticketPasswords: {}, discounts: [{ id: shortId('dc_'), code: 'EARLYBIRD', type: 'pct', amount: 15, limit: 100, expires: day(20), ticketTypeIds: [] }] } });
  // Premium = front three rows of the centre block (per-seat price overrides).
  const L1 = seatLayout(ev1.seating); L1.seats.filter(p => p.sec.code === 'CEN' && ['A', 'B', 'C'].includes(p.row)).forEach(p => { ev1.seating.prices[p.id] = vipTT.id; });
  ev1.seating.index = seatIndex(ev1.seating);
  const ev2 = mk({ slug: 'neon-nights-live', name: 'Neon Nights Live', category: 'Live music', start: day(0, 20, 0), end: day(0, 23, 30), doors: '7:00 PM',
    summary: 'Tonight — three bands, one stage.', venue: 'The Warehouse', address: '210 Kent Ave, Brooklyn, NY 11249', audience: '18+ · ID required',
    description: 'Three of the city\'s best live acts on one stage. Standing room, full bar.\n\nPhoto ID required at the door.',
    capacity: 450, ticketTypes: [tt('General admission', 3500, 380), tt('Early entry', 5500, 60, { desc: 'Doors 30 minutes early' }), tt('Group of 5', 15000, 30, { admits: 5, desc: 'Admits five — save $25', max: 4 }),
      tt('VIP table', 60000, 5, { hidden: true, desc: 'Reserved table for 6 with bottle service', max: 1 })],
    secrets: { password: '', ticketPasswords: {}, discounts: [{ id: shortId('dc_'), code: 'WELCOME10', type: 'fixed', amount: 1000, limit: 0, expires: '', ticketTypeIds: [] }] } });
  ev2.secrets.ticketPasswords[ev2.ticketTypes[3].id] = 'VIPACCESS';
  const ev3 = mk({ slug: 'city-food-festival', name: 'City Food & Wine Festival', category: 'Food & drink',
    summary: 'Two tasting sessions, 40 vendors.', start: day(18, 12, 0), end: day(18, 20, 0), venue: 'Pier 36', address: '299 South St, New York, NY 10002',
    description: 'Taste your way through 40 local restaurants, bakeries and wineries. Choose your session at checkout. Unlimited tastings included.',
    ticketTypes: [tt('Tasting pass', 4900, 0), tt('Designated driver', 1900, 0, { desc: 'Food only — no alcohol' })],
    timeSlots: [{ id: shortId('ts_'), start: day(18, 12, 0), capacity: 250 }, { id: shortId('ts_'), start: day(18, 16, 30), capacity: 250 }] });
  const ev4 = mk({ slug: 'founders-summit', name: 'Founders Summit 2026', category: 'Conference', start: day(27, 9, 0), end: day(27, 17, 30),
    summary: 'A one-day conference for early-stage founders.', venue: 'Hudson Conference Center', address: '75 Hudson Yards, New York, NY 10001',
    description: 'Talks, workshops and investor office hours. Lunch and coffee included.', capacity: 300,
    ticketTypes: [tt('Standard', 19900, 0), tt('Student', 4900, 60, { desc: 'Valid student ID required' })],
    questions: [{ id: shortId('q_'), label: 'Company name', type: 'text', required: true }, { id: shortId('q_'), label: 'Dietary requirements', type: 'select', options: 'None, Vegetarian, Vegan, Gluten-free, Kosher, Halal', required: false }] });
  const ev5 = mk({ slug: 'kids-science-show', name: 'Big Bang Science Show', category: 'Family', start: day(55, 11, 0), end: day(55, 17, 0),
    summary: 'Hourly hands-on science shows for kids.', venue: 'Discovery Hall', address: '2900 Campus Rd, Brooklyn, NY 11210', audience: 'Ages 4+',
    description: 'Explosions, slime and liquid nitrogen — hourly 45-minute shows from 11 AM to 4 PM. Under 2s free (no ticket needed).',
    ticketTypes: [tt('Adult', 2000, 0), tt('Child (2–12)', 1500, 0), tt('Family 4-pack', 6000, 0, { admits: 4 })],
    timeSlots: [11, 12, 13, 14, 15, 16].map(h => ({ id: shortId('ts_'), start: day(55, h, 0), capacity: 180 })) });
  const ev6 = mk({ slug: 'comedy-night', name: 'Late Night Comedy Club', category: 'Comedy', status: 'draft', start: day(70, 21, 0), end: day(70, 23, 0),
    summary: 'Five comics, one mic.', venue: 'TBA', address: '', description: 'Line-up coming soon.', ticketTypes: [tt('General', 2500, 120)] });
  // Two independent box offices (plus one registration waiting for approval) to show data separation.
  const boSet = name => ({ ...DEFAULT_SETTINGS, name, feePct: 3, feeFixed: 99 });
  const bo1 = { id: uid(), slug: 'skyline-live', name: 'Skyline Live', status: 'active', owner: 'moishsonn@gmail.com', created_at: day(-60), created_by: 'platform',
    branding: { ...DEFAULT_BRANDING, tagline: 'Concerts and live music across New York', website: 'https://example.com', instagram: 'skylinelive' },
    settings: { ...boSet('Skyline Live'), contactEmail: 'help@skyline.example' }, templates: clone(DEFAULT_TEMPLATES) };
  const bo2 = { id: uid(), slug: 'harbor-arts', name: 'Harbor Arts Center', status: 'active', owner: 'director@harborarts.example', created_at: day(-45), created_by: 'platform',
    branding: { ...DEFAULT_BRANDING, ink: '#0f3a33', accent: '#7fd3b4', font: 'Playfair Display', tagline: 'Festivals, talks and family days on the waterfront' },
    settings: { ...boSet('Harbor Arts Center'), contactEmail: 'boxoffice@harborarts.example', taxPct: 8.875 }, templates: clone(DEFAULT_TEMPLATES) };
  const bo3 = { id: uid(), slug: 'northside-comedy', name: 'Northside Comedy Collective', status: 'pending', owner: 'hello@northside.example', created_at: day(-1), created_by: 'self-registration',
    branding: { ...DEFAULT_BRANDING }, settings: boSet('Northside Comedy Collective'), templates: clone(DEFAULT_TEMPLATES) };
  [ev1, ev2, ev6].forEach(e => e.box_office_id = bo1.id); [ev3, ev4, ev5].forEach(e => e.box_office_id = bo2.id);
  const events = [ev1, ev2, ev3, ev4, ev5, ev6];
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
  const first = ['Alex', 'Jordan', 'Sam', 'Maya', 'Chris', 'Priya', 'Daniel', 'Emma', 'Luis', 'Grace', 'Noah', 'Aisha', 'Ben', 'Chloe', 'Omar', 'Zoe'];
  const last = ['Carter', 'Nguyen', 'Patel', 'Rivera', 'Kim', 'Brooks', 'Cohen', 'Okafor', 'Silva', 'Hughes', 'Morgan', 'Reyes'];
  let n = 0; const rnd = a => a[Math.floor(Math.random() * a.length)];
  for (const ev of events.filter(e => e.status === 'published')) {
    const count = ev === ev1 ? 46 : ev === ev2 ? 60 : 24;
    for (let i = 0; i < count; i++) {
      const name = rnd(first) + ' ' + rnd(last), email = name.toLowerCase().replace(' ', '.') + (n++) + '@example.com';
      const t = rnd(ev.ticketTypes.filter(x => !x.hidden)), qty = t.admits > 1 ? 1 : 1 + Math.floor(Math.random() * 3);
      const item = { eventId: ev.id, ticketTypeId: t.id, qty, slotId: ev.timeSlots.length ? rnd(ev.timeSlots).id : null };
      if (ev.seating.enabled) {
        const av = availabilityFrom(Demo.st.tickets, ev.id), free = Object.keys(ev.seating.index).filter(id => ev.seating.index[id] === t.id && !av.seats.includes('|' + id));
        const at = Math.floor(Math.random() * Math.max(1, free.length - qty)), seats = free.slice(at, at + qty);
        if (seats.length !== qty) continue; item.seats = seats;
      }
      try {
        const r = demoPlaceOrder({ buyer: { name, email, phone: '' }, items: [item], addons: [], payment: Math.random() < .85 ? 'card' : 'offline', optIn: Math.random() < .6,
          code: Math.random() < .12 ? (ev.secrets.discounts[0]?.code || '') : '', source: rnd(['', '', 'instagram', 'facebook', 'newsletter']) }, { owner: true });
        const o = Demo.st.orders.find(x => x.id === r.id); o.created_at = day(-Math.floor(Math.random() * 28), 8 + Math.floor(Math.random() * 14), Math.floor(Math.random() * 60));
        if (Math.random() < .04) { o.status = 'refunded'; Demo.st.tickets.forEach(t => { if (t.order_id === o.id) t.status = 'cancelled'; }); }
      } catch (e) { /* sold out etc. — skip */ }
    }
  }
  // ev2 is tonight: doors are open and some guests are already in (for the scanner app).
  Demo.st.tickets.filter(t => t.event_id === ev2.id && t.status === 'valid').forEach(t => { if (Math.random() < .4) t.checked_in_at = new Date(Date.now() - Math.pow(Math.random(), .6) * 110 * 6e4).toISOString(); });
  Demo.st.audit.push({ id: uid(), at: day(-1, 9, 12), actor: 'hello@northside.example', box_office_id: bo3.id, kind: 'platform.registered', summary: 'Registration request: ' + bo3.name, before: null, after: null },
    ...members.filter(m => m.box_office_id !== bo3.id && m.email !== m.added_by).map(m => ({ id: uid(), at: m.created_at, actor: m.added_by, box_office_id: m.box_office_id, kind: 'team.invited', summary: `Invited ${m.email} (${m.perms.length} permissions)`, before: null, after: null })));
  Demo.st.waitlist.push({ id: uid(), box_office_id: bo2.id, event_id: ev3.id, name: 'Jamie Fox', email: 'jamie@example.com', created_at: day(-1) });
  return Demo.st;
}
