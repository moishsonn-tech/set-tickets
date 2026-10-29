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
  name: 'SING Entertainment', currency: 'USD', feePct: 0, feeFixed: 0, feeMode: 'buyer', taxPct: 0,
  terms: 'All sales are final. Tickets are non-refundable except if the event is cancelled. Event schedule and line-up subject to change.',
  payments: { card: true, offline: true, door: true }, donations: true, pixels: { ga4: '', meta: '', tiktok: '' },
  contactEmail: 'info@singentertainment.net', reminderHours: 24,
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

/* ════════════ DEMO backend (localStorage) ════════════ */
const DEMO_KEY = 'set_demo_v1';
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
        if ((ev.seating.blocked || []).includes(s)) throw new Error(`Seat ${s} is unavailable`);
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
  async checkin(code, undo = false) {
    if (!LIVE) {
      const t = Demo.st.tickets.find(x => x.code === String(code).trim().toUpperCase());
      if (!t) return { result: 'unknown' };
      if (t.status !== 'valid') return { result: 'cancelled', ticket: clone(t) };
      const was = t.checked_in_at; t.checked_in_at = undo ? null : (t.checked_in_at || new Date().toISOString()); Demo.save();
      return { result: undo ? 'undone' : was ? 'already' : 'ok', ticket: clone(t) };
    }
    return must(sb.rpc('checkin', { p_code: code, p_undo: undo }));
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
  const IMG = 'https://cdn.prod.website-files.com/66f304c478ed3ab1f7a42667/';
  const day = (d, h = 20, m = 0) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.toISOString(); };
  const tt = (name, price, qty, extra = {}) => ({ id: shortId('tt_'), name, price, qty, min: 1, max: 10, admits: 1, desc: '', hidden: false, ...extra });
  const base = { capacity: 0, timezone: 'America/New_York', currency: 'USD', visibility: 'public', online: false, onlineUrl: '',
    timeSlots: [], seating: { enabled: false }, addons: [], questions: [], waitlist: true, emails: { confirmation: '', reminders: [] } };
  const mk = (o) => ({ ...base, id: uid(), status: 'published', created_at: day(-30), secrets: { password: '', ticketPasswords: {}, discounts: [] }, ...o });

  const vipTT = tt('VIP — front rows', 18000, 0, { desc: 'Reserved seat in rows A–C + meet & greet', max: 8 });
  const orchTT = tt('Orchestra', 9500, 0, { desc: 'Reserved seat, rows D–H' });
  const balTT = tt('Balcony', 6500, 0, { desc: 'Reserved seat, rows J–L' });
  const ev1 = mk({ slug: 'chanukah-spectacular', name: 'Chanukah Spectacular 2026', category: 'Concert', image: IMG + '68cca51d73608f02f8c8f6b0_Concert%2054-61_Marcus%20Tour.jpg',
    summary: 'A night of lights, music and simcha with full orchestra.', start: day(41, 19, 30), end: day(41, 22, 30), doors: '6:45 PM',
    venue: 'Kings Theatre', address: '1027 Flatbush Ave, Brooklyn, NY 11226', audience: 'Mixed seating',
    description: 'Celebrate Chanukah with SING Entertainment\'s biggest production of the year — a full orchestra, choir and special guests on one stage.\n\nDoors open 6:45 PM. Show starts promptly at 7:30 PM. Seats are reserved — pick yours on the seat map.',
    ticketTypes: [vipTT, orchTT, balTT],
    seating: { enabled: true, rows: 'ABCDEFGHJKL', cols: 16, aisleAfter: [4, 12], tiers: { A: vipTT.id, B: vipTT.id, C: vipTT.id, D: orchTT.id, E: orchTT.id, F: orchTT.id, G: orchTT.id, H: orchTT.id, J: balTT.id, K: balTT.id, L: balTT.id }, blocked: ['A1', 'A16', 'L1', 'L16'] },
    addons: [{ id: shortId('ad_'), name: 'Official event program', price: 1000, qty: 0 }, { id: shortId('ad_'), name: 'Parking pass', price: 2500, qty: 150 }],
    questions: [{ id: shortId('q_'), label: 'How did you hear about us?', type: 'select', options: 'Instagram, WhatsApp, Friend, Poster, Other', required: false }],
    secrets: { password: '', ticketPasswords: {}, discounts: [{ id: shortId('dc_'), code: 'EARLYLIGHT', type: 'pct', amount: 15, limit: 100, expires: day(20), ticketTypeIds: [] }] } });
  const ev2 = mk({ slug: 'higia-hazman', name: 'Higia Hazman', category: 'Concert', image: 'https://cdn.prod.website-files.com/66f304c478ed3ab1f7a42640/6ac3dadab4be9c40f29d6891_PHOTO-2026-10-04-20-11-26.jpg',
    summary: 'Shmili Landau & Sruly Green — one night only.', start: day(9, 20, 45), end: day(9, 22, 45), doors: '8:00 PM',
    venue: 'Sterling Hall', address: '1247 38th St, Brooklyn, NY 11218', audience: 'Men & boys only',
    description: 'The time has come! Sruly Green and Shmili Landau together on one stage for a night of energetic music and dancing.\n\nStreet parking available. Food and drinks for purchase.',
    capacity: 450, ticketTypes: [tt('General admission', 5000, 380), tt('Premium standing', 9000, 60, { desc: 'Closest to the stage' }), tt('Group of 5', 20000, 30, { admits: 5, desc: 'Admits five — save $50', max: 4 }),
      tt('Sponsor table', 150000, 5, { hidden: true, desc: 'Table for 10 with name recognition', max: 1 })],
    secrets: { password: '', ticketPasswords: {}, discounts: [{ id: shortId('dc_'), code: 'SING10', type: 'fixed', amount: 1000, limit: 0, expires: '', ticketTypeIds: [] }] } });
  ev2.secrets.ticketPasswords[ev2.ticketTypes[3].id] = 'SPONSOR';
  const ev3 = mk({ slug: 'kumzitz-under-the-stars', name: 'Kumzitz Under the Stars', category: 'Kumzitz', image: IMG + '67ef54fc9eafe28f85828bdd_Baruch_Kumzitz%20Alive%20Tour%20dates.png',
    summary: 'An intimate acoustic kumzitz — two seatings.', start: day(18, 19, 0), end: day(18, 23, 0), venue: 'The Loft at Ateres', address: '1 Ateres Ave, Lakewood, NJ 08701', audience: 'Mixed',
    description: 'Two intimate seatings of acoustic kumzitz. Choose your seating time at checkout. Light refreshments included.',
    ticketTypes: [tt('Adult', 3600, 0), tt('Student', 1800, 0, { desc: 'Valid student ID required at the door' })],
    timeSlots: [{ id: shortId('ts_'), start: day(18, 19, 0), capacity: 120 }, { id: shortId('ts_'), start: day(18, 21, 30), capacity: 120 }] });
  const ev4 = mk({ slug: 'womens-night-riverside', name: 'A Riverside Experience', category: 'Women only', image: IMG + '67c5ebc62b9b9090feffb23b_women%20web.png',
    summary: 'A women\'s show by the water.', start: day(27, 19, 30), end: day(27, 22, 0), venue: 'Riverside Pavilion', address: '500 Riverside Dr, New York, NY 10027', audience: 'Women & girls only',
    description: 'An evening concert for women and girls with a full live band.', capacity: 300,
    ticketTypes: [tt('General admission', 4500, 0), tt('Front section', 7500, 60)], questions: [{ id: shortId('q_'), label: 'Seating preference', type: 'select', options: 'With my group, Anywhere', required: false }] });
  const ev5 = mk({ slug: 'chol-hamoed-family', name: 'Chol Hamoed Family Show', category: 'Family', image: IMG + '67c5eb22812ae23644d08f5c_family%20web.png',
    summary: 'Hourly family shows all afternoon.', start: day(55, 11, 0), end: day(55, 17, 0), venue: 'Brooklyn Center Stage', address: '2900 Campus Rd, Brooklyn, NY 11210', audience: 'Families',
    description: 'Fun for the whole family — hourly 45-minute shows from 11 AM to 4 PM. Kids under 2 free (no ticket needed).',
    ticketTypes: [tt('Adult', 2500, 0), tt('Child (2–12)', 1500, 0), tt('Family 4-pack', 7000, 0, { admits: 4 })],
    timeSlots: [11, 12, 13, 14, 15, 16].map(h => ({ id: shortId('ts_'), start: day(55, h, 0), capacity: 180 })) });
  const ev6 = mk({ slug: 'hatzalah-gala', name: 'Hatzalah Benefit Concert', category: 'Benefit', status: 'draft', image: IMG + '67cd1a5abca3340026c8e9e0_Concert%2035_Hatzalah.jpg',
    summary: 'Annual benefit concert.', start: day(70, 19, 0), end: day(70, 22, 0), venue: 'TBA', address: '', description: 'Details coming soon.', ticketTypes: [tt('General', 7500, 500)] });
  const events = [ev1, ev2, ev3, ev4, ev5, ev6];

  // A few weeks of realistic sales so the dashboard has something to show.
  Demo.st = { settings: { ...DEFAULT_SETTINGS, feePct: 3, feeFixed: 99 }, events, orders: [], tickets: [], waitlist: [], broadcasts: [],
    team: [{ email: 'moishsonn@gmail.com', role: 'admin', name: 'Owner' }, { email: 'door@singentertainment.net', role: 'order_manager', name: 'Door staff' }] };
  const first = ['Yossi', 'Chaim', 'Rivka', 'Sara', 'Moshe', 'Leah', 'Dovid', 'Esti', 'Shmuel', 'Malky', 'Avi', 'Chani', 'Eli', 'Miri', 'Benny', 'Tzippy'];
  const last = ['Klein', 'Weiss', 'Friedman', 'Schwartz', 'Rosen', 'Katz', 'Gold', 'Stern', 'Berger', 'Adler', 'Green', 'Levy'];
  let n = 0; const rnd = a => a[Math.floor(Math.random() * a.length)];
  for (const ev of events.filter(e => e.status === 'published')) {
    const count = ev === ev1 ? 46 : ev === ev2 ? 60 : 24;
    for (let i = 0; i < count; i++) {
      const name = rnd(first) + ' ' + rnd(last), email = name.toLowerCase().replace(' ', '.') + (n++) + '@example.com';
      const t = rnd(ev.ticketTypes.filter(x => !x.hidden)), qty = t.admits > 1 ? 1 : 1 + Math.floor(Math.random() * 3);
      const item = { eventId: ev.id, ticketTypeId: t.id, qty, slotId: ev.timeSlots.length ? rnd(ev.timeSlots).id : null };
      if (ev.seating.enabled) {
        const av = availabilityFrom(Demo.st.tickets, ev.id), rows = Object.keys(ev.seating.tiers).filter(r => ev.seating.tiers[r] === t.id), seats = [];
        outer: for (const r of rows.sort(() => Math.random() - .5)) for (let c = 1 + Math.floor(Math.random() * 10); c <= ev.seating.cols; c++) {
          const s = r + c; if (!av.seats.includes('|' + s) && !ev.seating.blocked.includes(s)) seats.push(s); else seats.length = 0;
          if (seats.length === qty) break outer;
        }
        if (seats.length !== qty) continue; item.seats = seats;
      }
      try {
        const r = demoPlaceOrder({ buyer: { name, email, phone: '' }, items: [item], addons: [], payment: Math.random() < .85 ? 'card' : 'offline', optIn: Math.random() < .6,
          code: Math.random() < .12 ? (ev.secrets.discounts[0]?.code || '') : '', source: rnd(['', '', 'instagram', 'whatsapp', 'newsletter']) }, true);
        const o = Demo.st.orders.find(x => x.id === r.id); o.created_at = day(-Math.floor(Math.random() * 28), 8 + Math.floor(Math.random() * 14), Math.floor(Math.random() * 60));
        if (Math.random() < .04) { o.status = 'refunded'; Demo.st.tickets.forEach(t => { if (t.order_id === o.id) t.status = 'cancelled'; }); }
      } catch (e) { /* sold out etc. — skip */ }
    }
  }
  Demo.st.waitlist.push({ id: uid(), event_id: ev2.id, name: 'Shloimy Kahan', email: 'shloimy@example.com', created_at: day(-1) });
  return Demo.st;
}
