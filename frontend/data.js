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

const ROLES = { admin: 'Admin', event_manager: 'Event manager', order_manager: 'Order manager', overview: 'Overview' };
const DEFAULT_SETTINGS = {
  name: 'SET Tickets', currency: 'USD', feePct: 0, feeFixed: 0, feeMode: 'buyer', taxPct: 0,
  terms: 'All sales are final. Tickets are non-refundable except if the event is cancelled. Event schedule and line-up subject to change.',
  payments: { card: true, offline: true, door: true }, donations: true, pixels: { ga4: '', meta: '', tiktok: '' },
  contactEmail: '', reminderHours: 24,
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
const DEMO_KEY = 'set_demo_v4';
const Demo = {
  st: null,
  load() {
    try { this.st = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch (e) { this.st = null; }
    if (!this.st || !this.st.events) { this.st = seedDemo(); this.save(); }
    return this.st;
  },
  save() { try { localStorage.setItem(DEMO_KEY, JSON.stringify(this.st)); } catch (e) { console.warn('demo save failed', e); } },
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
  let disc = null;
  const pending = { tt: {}, slots: {}, seats: [], total: {} };
  for (const it of p.items) {
    const ev = st.events.find(e => e.id === it.eventId && (e.status === 'published' || manual));
    if (!ev) throw new Error('Event is not on sale');
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
  const q = quote({ items: p.items, addons: p.addons, donation: p.donation }, st.events, st.settings, disc);
  if (q.total > 0 && !manual && !['offline', 'card'].includes(p.payment)) throw new Error('Choose a payment method');
  const status = (q.total === 0 || manual || p.payment === 'card') ? 'paid' : 'pending';
  let ref; do { ref = 'SET-' + randCode(6); } while (st.orders.some(o => o.ref === ref));
  const order = { id: uid(), ref, access_key: uid(), status, buyer_email: p.buyer.email.trim().toLowerCase(),
    event_ids: [...new Set(p.items.map(i => i.eventId))], created_at: new Date().toISOString(),
    data: { buyer: p.buyer, lines: q.lines, subtotal: q.subtotal, discount: q.discount, fee: q.fee, tax: q.tax, donation: q.donation,
      total: q.total, code: disc?.code || null, payment: q.total === 0 ? 'free' : p.payment, answers: p.answers || {}, optIn: !!p.optIn,
      source: p.source || null, currency: q.currency } };
  st.orders.push(order);
  for (const l of q.lines.filter(l => l.kind === 'ticket'))
    for (let i = 0; i < l.qty * l.admits; i++)
      st.tickets.push({ id: uid(), order_id: order.id, event_id: l.eventId, ticket_type_id: l.ticketTypeId, slot_id: l.slotId || null,
        seat: l.seats[i] || null, code: randCode(10), holder: p.buyer.name, status: 'valid', checked_in_at: null });
  Demo.save();
  return { id: order.id, key: order.access_key, ref };
}

const rowToEvent = r => ({ ...(r.data || {}), id: r.id, slug: r.slug, status: r.status, created_at: r.created_at, ...(r.secrets ? { secrets: r.secrets } : {}) });
const eventToRow = ev => { const { id, slug, status, secrets, created_at, ...data } = ev; return { id, slug, status, data, secrets: secrets || {}, updated_at: new Date().toISOString() }; };
const clone = o => JSON.parse(JSON.stringify(o));
const publicEvent = ev => { const { secrets, ...rest } = clone(ev); return rest; };
async function must(p) { const { data, error } = await p; if (error) throw new Error(error.message); return data; }

const DB = {
  live: LIVE,
  async init() {
    if (!LIVE) { const st = Demo.load(); return { settings: { ...DEFAULT_SETTINGS, ...st.settings }, events: st.events.filter(e => e.status === 'published').map(publicEvent) }; }
    const [set, evs] = await Promise.all([must(sb.from('settings').select('data').eq('id', 1).maybeSingle()),
      must(sb.from('events').select('id,slug,status,data,created_at').eq('status', 'published'))]);
    return { settings: { ...DEFAULT_SETTINGS, ...(set?.data || {}) }, events: evs.map(rowToEvent) };
  },
  // ── auth ──
  async session() {
    if (!LIVE) { const e = sessionStorage.getItem('set_demo_user'); return e ? { email: e } : null; }
    const { data } = await sb.auth.getSession(); return data.session ? { email: data.session.user.email } : null;
  },
  async sendCode(email) {
    if (!LIVE) return;
    await must(sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname + '#/admin' } }));
  },
  async verifyCode(email, code) {
    if (!LIVE) { sessionStorage.setItem('set_demo_user', email); return { email }; }
    await must(sb.auth.verifyOtp({ email, token: code, type: 'email' })); return { email };
  },
  async signOut() { if (!LIVE) sessionStorage.removeItem('set_demo_user'); else await sb.auth.signOut(); },
  // ── organizer data ──
  async loadAdmin(email) {
    if (!LIVE) {
      const st = Demo.st; let me = st.team.find(t => t.email === email.toLowerCase());
      if (!me) { me = { email: email.toLowerCase(), role: 'admin', name: email.split('@')[0] }; st.team.push(me); Demo.save(); } // demo: anyone may try the organizer side
      return { me, ...clone({ events: st.events, orders: st.orders, tickets: st.tickets, waitlist: st.waitlist, team: st.team, broadcasts: st.broadcasts }) };
    }
    const team = await must(sb.from('team').select('*'));
    const me = team.find(t => t.email.toLowerCase() === email.toLowerCase());
    if (!me) throw new Error('This email is not on the SET team. Ask an admin to add you.');
    const [events, orders, tickets, waitlist, broadcasts] = await Promise.all(['events', 'orders', 'tickets', 'waitlist', 'broadcasts']
      .map(t => must(sb.from(t).select('*').limit(10000))));
    return { me, team, events: events.map(rowToEvent), orders, tickets, waitlist, broadcasts };
  },
  async saveEvent(ev) {
    if (!LIVE) { const st = Demo.st, i = st.events.findIndex(e => e.id === ev.id); if (i >= 0) st.events[i] = clone(ev); else st.events.push(clone(ev)); Demo.save(); return ev; }
    const row = eventToRow(ev); if (!row.id) delete row.id;
    return rowToEvent(await must(sb.from('events').upsert(row).select().single()));
  },
  async deleteEvent(id) {
    if (!LIVE) { const st = Demo.st; st.events = st.events.filter(e => e.id !== id); st.tickets = st.tickets.filter(t => t.event_id !== id); Demo.save(); return; }
    await must(sb.from('events').delete().eq('id', id));
  },
  async saveSettings(s) {
    if (!LIVE) { Demo.st.settings = clone(s); Demo.save(); return; }
    await must(sb.from('settings').update({ data: s }).eq('id', 1));
  },
  async setOrderStatus(id, status) {
    const cancel = ['cancelled', 'refunded'].includes(status);
    if (!LIVE) {
      const o = Demo.st.orders.find(x => x.id === id); o.status = status;
      if (cancel) Demo.st.tickets.forEach(t => { if (t.order_id === id) t.status = 'cancelled'; });
      Demo.save(); return;
    }
    await must(sb.from('orders').update({ status }).eq('id', id));
    if (cancel) await must(sb.from('tickets').update({ status: 'cancelled' }).eq('order_id', id));
  },
  // eventId (optional): the event being scanned — a valid ticket for another event is rejected, not checked in.
  async checkin(code, undo = false, eventId = null) {
    if (!LIVE) {
      const t = Demo.st.tickets.find(x => x.code === String(code).trim().toUpperCase());
      if (!t) return { result: 'unknown' };
      if (t.status !== 'valid') return { result: 'cancelled', ticket: clone(t) };
      if (eventId && t.event_id !== eventId) return { result: 'wrong_event', ticket: clone(t) };
      const was = t.checked_in_at; t.checked_in_at = undo ? null : (t.checked_in_at || new Date().toISOString()); Demo.save();
      return { result: undo ? 'undone' : was ? 'already' : 'ok', ticket: clone(t) };
    }
    return must(sb.rpc('checkin', { p_code: code, p_undo: undo, p_event: eventId }));
  },
  async saveTeam(member, remove = false) {
    if (!LIVE) { const st = Demo.st; st.team = st.team.filter(t => t.email !== member.email); if (!remove) st.team.push(member); Demo.save(); return; }
    if (remove) await must(sb.from('team').delete().eq('email', member.email)); else await must(sb.from('team').upsert(member));
  },
  async addBroadcast(b) {
    if (!LIVE) { const row = { id: uid(), created_at: new Date().toISOString(), ...b }; Demo.st.broadcasts.push(row); Demo.save(); return row; }
    return must(sb.from('broadcasts').insert(b).select().single());
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
    if (!LIVE) { Demo.st.waitlist.push({ id: uid(), event_id: eventId, name, email: email.toLowerCase(), created_at: new Date().toISOString() }); Demo.save(); return; }
    await must(sb.rpc('join_waitlist', { p_event: eventId, p_name: name, p_email: email }));
  },
  async placeOrder(payload, asTeam = false) {
    if (!LIVE) return demoPlaceOrder(clone(payload), asTeam);
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
  const events = [ev1, ev2, ev3, ev4, ev5, ev6];

  // A few weeks of realistic sales so the dashboard has something to show.
  Demo.st = { settings: { ...DEFAULT_SETTINGS, feePct: 3, feeFixed: 99 }, events, orders: [], tickets: [], waitlist: [], broadcasts: [],
    team: [{ email: 'moishsonn@gmail.com', role: 'admin', name: 'Owner' }, { email: 'door@example.com', role: 'order_manager', name: 'Door staff' }] };
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
          code: Math.random() < .12 ? (ev.secrets.discounts[0]?.code || '') : '', source: rnd(['', '', 'instagram', 'facebook', 'newsletter']) }, true);
        const o = Demo.st.orders.find(x => x.id === r.id); o.created_at = day(-Math.floor(Math.random() * 28), 8 + Math.floor(Math.random() * 14), Math.floor(Math.random() * 60));
        if (Math.random() < .04) { o.status = 'refunded'; Demo.st.tickets.forEach(t => { if (t.order_id === o.id) t.status = 'cancelled'; }); }
      } catch (e) { /* sold out etc. — skip */ }
    }
  }
  // ev2 is tonight: doors are open and some guests are already in (for the scanner app).
  Demo.st.tickets.filter(t => t.event_id === ev2.id && t.status === 'valid').forEach(t => { if (Math.random() < .4) t.checked_in_at = new Date(Date.now() - Math.pow(Math.random(), .6) * 110 * 6e4).toISOString(); });
  Demo.st.waitlist.push({ id: uid(), event_id: ev3.id, name: 'Jamie Fox', email: 'jamie@example.com', created_at: day(-1) });
  return Demo.st;
}
