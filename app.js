'use strict';
/* SET — SING Entertainment Tickets. Vanilla JS, no build (owner's starter-kit style):
   global S state → render() rebuilds #app via innerHTML → delegated data-action handlers →
   data-bind inputs write into S without re-rendering. esc() on ALL interpolation. */

// ── Utilities ─────────────────────────────────────────────────────────────────
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);
const money = (c, cur) => c == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || S.settings.currency || 'USD', minimumFractionDigits: (c % 100) ? 2 : 0 }).format((+c || 0) / 100);
const D = iso => iso ? new Date(iso) : null;
const fmtDate = (iso, o = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) => iso ? D(iso).toLocaleDateString('en-US', o) : '';
const fmtTime = iso => iso ? D(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
const fmtDT = iso => iso ? fmtDate(iso, { month: 'short', day: 'numeric' }) + ', ' + fmtTime(iso) : '—';
const pad = n => String(n).padStart(2, '0');
const toLocalInput = iso => { if (!iso) return ''; const d = D(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 60) || 'event';
const sum = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);
const ago = iso => { const s = (Date.now() - D(iso)) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
const getPath = (o, p) => p.split('.').reduce((x, k) => x == null ? x : x[k], o);
const setPath = (o, p, v) => { const k = p.split('.'); const last = k.pop(); const t = k.reduce((x, key, i) => (x[key] ??= (/^\d+$/.test(k[i + 1] ?? last) ? [] : {})), o); t[last] = v; };
const shareUrl = (slug, src) => location.origin + location.pathname + '#/e/' + slug + (src ? '?src=' + encodeURIComponent(src) : '');

function toast(msg, bad) { const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg; $('#toast').append(t); setTimeout(() => t.remove(), 3600); }
function download(name, text, type = 'text/csv') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function csv(rows) { return rows.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n'); }
function ics(ev) {
  const f = iso => D(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SET Tickets//EN', 'BEGIN:VEVENT', 'UID:' + ev.id + '@set', 'DTSTAMP:' + f(new Date().toISOString()),
    'DTSTART:' + f(ev.start), 'DTEND:' + f(ev.end || ev.start), 'SUMMARY:' + ev.name, 'LOCATION:' + [ev.venue, ev.address].filter(Boolean).join(', '),
    'URL:' + shareUrl(ev.slug), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

const ICON = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  ticket: '<path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z"/><path d="M14 5v14" stroke-dasharray="2 2"/>',
  cart: '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  mega: '<path d="M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1zM17 8a5 5 0 0 1 0 8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  team: '<circle cx="12" cy="7" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>', ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.4v.2"/>',
  bolt: '<path d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12z"/>', sound: '<path d="M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>', mute: '<path d="M11 5L6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6"/>',
  brush: '<path d="M14.5 3.5l6 6L11 19l-6-6z"/><path d="M5 13l-2 8 8-2"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>',
  wifi: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/>', keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
};
const ic = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
let LOGO = '<b style="font-family:var(--display);font-size:28px">set</b>';
const logo = () => LOGO;
// Event artwork: the organizer's image, or a generated typographic poster (no stock photos).
const safeUrl = u => /^https:\/\/[^\s'"()\\<>]+$/.test(u || '') ? u : '';
const ART = ['#13294b', '#3b1238', '#0f3a33', '#4a1a12', '#24224f', '#3a300c'];
const artBg = ev => { const u = safeUrl(ev.image); if (u) return `background-image:url('${u}')`;
  const h = [...(ev.name || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return `background:radial-gradient(110% 80% at 88% 8%,rgba(244,205,94,.28),transparent 55%),linear-gradient(155deg,${ART[h % ART.length]},#020a16 78%)`; };
const artTitle = (ev, cls = 'art-t') => safeUrl(ev.image) ? '' : `<div class="${cls}">${esc(ev.name)}</div>`;

// ── State (single source of truth) ────────────────────────────────────────────
const S = {
  route: { page: 'home', params: [] }, settings: { ...DEFAULT_SETTINGS }, events: [], loading: true,
  home: { view: 'list', cat: 'All', q: '', month: null },
  avail: {}, sel: null, cart: loadCart(), co: { name: '', email: '', phone: '', answers: {}, optIn: false, terms: false, payment: '', code: '', disc: null, busy: false, err: '' },
  bos: [], bo: null, platform: { ...DEFAULT_PLATFORM }, plat: null,  // public box offices · box office in context · platform (public part) · super-admin data
  user: null, adm: null, draft: null, dirty: false,
  ui: { q: '', ev: '', status: '', picked: {}, attEv: '', repEv: '', login: { email: '', code: '', sent: false, totp: '' } },
  sc: { evId: '', tab: 'scan', last: null, q: '', filter: 'all', recent: [], sound: true, queue: [], err: '' },  // door scanner app
};
function loadCart() { try { return JSON.parse(localStorage.getItem('set_cart')) || { items: [], addons: [], donation: 0, unlock: {} }; } catch (e) { return { items: [], addons: [], donation: 0, unlock: {} }; } }
function saveCart() { try { localStorage.setItem('set_cart', JSON.stringify(S.cart)); } catch (e) { } }
const cartCount = () => sum(S.cart.items, i => i.qty);
const evById = id => S.events.find(e => e.id === id) || S.adm?.events.find(e => e.id === id);
// The box office whose settings and branding apply to this page — buyers see the organizer's brand, not the platform's.
const boOf = ev => ev && (S.bos.find(b => b.id === ev.box_office_id) || (S.adm?.bo?.id === ev.box_office_id ? S.adm.bo : null));
const cartBo = () => boOf(evById(S.cart.items[0]?.eventId));
function setContext() {
  const r = S.route, evSlug = ['e', 'embed'].includes(r.page) && r.params[0];
  const bo = ['admin', 'scan'].includes(r.page) ? S.adm?.bo : r.page === 'b' ? S.bos.find(b => b.slug === r.params[0])
    : evSlug ? boOf(S.events.find(e => e.slug === evSlug) || S.adm?.events.find(e => e.slug === evSlug))
    : r.page === 'cart' ? cartBo() : r.page === 'order' ? S.bos.find(b => b.id === S.order?.order?.box_office_id) : null;
  S.bo = bo || null;
  S.settings = bo ? { ...DEFAULT_SETTINGS, ...bo.settings, name: bo.name } : { ...DEFAULT_SETTINGS, name: S.platform.name + ' Tickets' };
  applyTheme(['admin', 'scan', 'platform'].includes(r.page) ? null : bo?.branding);
}
const HEX = /^#[0-9a-f]{6}$/i;
const shade = (hex, t) => '#' + [1, 3, 5].map(i => { const c = parseInt(hex.substr(i, 2), 16); return Math.round(c + (255 - c) * t).toString(16).padStart(2, '0'); }).join('');
const inkOn = hex => { if (!HEX.test(hex || '')) return '#2a2006'; const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16)); return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1d1a10' : '#ffffff'; };
const _fonts = new Set(['Anton']);
function loadFont(f) { if (!FONTS.includes(f) || _fonts.has(f)) return; _fonts.add(f); const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=' + f.replace(/ /g, '+') + '&display=swap'; document.head.append(l); }
function applyTheme(br) {
  const st = document.documentElement.style;
  ['--ink', '--ink-2', '--ink-3', '--accent', '--accent-ink', '--display'].forEach(k => st.removeProperty(k));
  if (!br) return;
  if (HEX.test(br.ink || '') && br.ink.toLowerCase() !== DEFAULT_BRANDING.ink) { st.setProperty('--ink', br.ink); st.setProperty('--ink-2', shade(br.ink, .07)); st.setProperty('--ink-3', shade(br.ink, .14)); }
  if (HEX.test(br.accent || '') && br.accent.toLowerCase() !== DEFAULT_BRANDING.accent) { st.setProperty('--accent', br.accent); st.setProperty('--accent-ink', inkOn(br.accent)); }
  if (br.font && br.font !== 'Anton' && FONTS.includes(br.font)) { loadFont(br.font); st.setProperty('--display', `'${br.font}','Anton',sans-serif`); }
}
const can = (key, eventId) => hasPerm(S.adm?.me, key, eventId);  // UI convenience only — the data layer / RLS re-checks every write

// ── Router ───────────────────────────────────────────────────────────────────
function parseRoute() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const src = new URLSearchParams(qs || '').get('src'); if (src) sessionStorage.setItem('set_src', src);
  if (parts[0] === 'admin') return { page: 'admin', sub: parts[1] || 'dashboard', params: parts.slice(2) };
  if (parts[0] === 'platform') return { page: 'platform', params: parts.slice(1) };
  return { page: parts[0] || 'home', params: parts.slice(1) };
}
async function onRoute() {
  const next = parseRoute();
  if (next.page !== 'scan') camStop();
  S.route = next;
  document.body.classList.toggle('embed', S.route.page === 'embed');
  document.body.classList.toggle('scan-mode', S.route.page === 'scan');
  const r = S.route;
  if (r.page === 'e' || r.page === 'embed') {
    let ev = S.events.find(e => e.slug === r.params[0]) || S.adm?.events.find(e => e.slug === r.params[0]);
    if (!ev && !S._fetched?.[r.params[0]]) { (S._fetched ||= {})[r.params[0]] = 1; DB.eventBySlug(r.params[0]).then(e => { if (e) { S.events.push(e); onRoute(); } }).catch(() => { }); }
    if (ev && eventLive(ev) && !/preview=1/.test(location.hash) && S._viewed !== ev.id + location.hash) { S._viewed = ev.id + location.hash; DB.trackView(ev.id, sessionStorage.getItem('set_src')); }
    if (ev && S.sel?.eventId !== ev.id) S.sel = { eventId: ev.id, qty: {}, slotId: '', seats: [], addons: {}, unlocked: { event: false, tts: [] }, pw: '' };
    if (ev) refreshAvail(ev.id);
  }
  if (r.page === 'order') loadOrder(r.params[0], r.params[1]);
  if (r.page === 'platform' && r.params[0] !== S._platSub) { S._platSub = r.params[0]; S.plat = null; }  // fresh numbers on each platform page
  setContext();
  if (r.page === 'admin' && r.sub === 'event') { const ev = S.adm?.events.find(e => e.id === r.params[0]); if (ev && S.draft?.id !== ev.id) { S.draft = JSON.parse(JSON.stringify(ev)); S.dirty = false; } }
  render(); if (!location.hash.includes('#/admin/event/')) window.scrollTo(0, 0);
}
async function refreshAvail(id) { try { S.avail[id] = await DB.availability(id); render(); } catch (e) { console.warn(e); } }
window.addEventListener('hashchange', onRoute);
window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

// ── Render (preserves focus/caret across innerHTML rebuilds) ───────────────────
function render() {
  const a = document.activeElement, key = a && (a.dataset.bind || a.dataset.input || a.id), pos = a && a.selectionStart;
  const r = S.route;
  let html;
  if (S.loading) html = `<div class="empty" style="padding-top:30vh"><div style="height:60px;color:var(--ink);display:inline-block">${logo()}</div></div>`;
  else if (r.page === 'admin') html = AdminShell();
  else if (r.page === 'scan') html = ScanApp();
  else if (r.page === 'platform') html = PlatformShell();
  else html = PubShell();
  $('#app').innerHTML = html;
  if (key) { const el = document.querySelector(`[data-bind="${CSS.escape(key)}"],[data-input="${CSS.escape(key)}"],#${CSS.escape(key)}`); if (el && el !== document.activeElement) { el.focus(); try { if (pos != null) el.setSelectionRange(pos, pos); } catch (e) { } } }
  hydrate();
}
function hydrate() {
  document.querySelectorAll('[data-qr]').forEach(el => { if (!el.childElementCount && window.QRCode) new QRCode(el, { text: el.dataset.qr, width: 300, height: 300, colorDark: '#020a16', correctLevel: QRCode.CorrectLevel.M }); });
  if (S.route.page === 'home') startHeroCanvas();
  if (S.route.page === 'scan') camMount();
}

// ══════════════════════════════════════════════════════════════════════════════
//  PUBLIC BOX OFFICE
// ══════════════════════════════════════════════════════════════════════════════
function PubShell() {
  const r = S.route, solid = !['home', 'e', 'b'].includes(r.page);
  const body = { home: Home, e: EventPage, embed: EventPage, cart: Checkout, order: OrderPage, tickets: FindTickets, b: BoxOfficePage, register: Register }[r.page] || NotFound;
  const bo = S.bo, brandLogo = bo && safeUrl(bo.branding.logo);
  return `
  <nav class="pub-nav ${solid ? 'solid' : ''}">
    ${bo ? `<a href="#/b/${esc(bo.slug)}" class="logo bo-brand" aria-label="${esc(bo.name)}">${brandLogo ? `<img src="${esc(brandLogo)}" alt="">` : `<span class="bo-word">${esc(bo.name)}</span>`}<small>Tickets by SET</small></a>`
      : `<a href="#/" class="logo" aria-label="SET home">${logo()}<small>SING Entertainment Tickets</small></a>`}
    <div class="links">
      <a class="btn glass btn-sm hide-sm" href="#/tickets">${ic('ticket', 15)} My tickets</a>
      <a class="btn glass btn-sm hide-sm" href="${S.platform.publicRegistration ? '#/register' : '#/admin'}">Sell tickets</a>
      <a class="btn btn-accent btn-sm" href="#/cart">${ic('cart', 15)} Cart ${cartCount() ? `<span class="cart-dot">${cartCount()}</span>` : ''}</a>
    </div>
  </nav>
  ${body()}
  <footer class="pub-foot"><div class="container">
    <div class="row" style="gap:16px"><div class="logo">${logo()}</div><span class="small">© ${new Date().getFullYear()} ${esc(S.settings.name)} · Secure checkout</span></div>
    <div><a href="#/tickets">Find my tickets</a>${S.settings.contactEmail ? `<a href="mailto:${esc(S.settings.contactEmail)}">Contact</a>` : ''}<a href="#/scan">Scanner app</a><a href="#/admin">Organizer login</a></div>
  </div></footer>`;
}
const NotFound = () => `<div class="container section"><div class="empty"><div class="display">Page not found</div><a class="btn btn-dark" href="#/">Back to events</a></div></div>`;

function priceFrom(ev) {
  const p = (ev.ticketTypes || []).filter(t => !t.hidden).map(t => +t.price);
  if (!p.length) return ''; const lo = Math.min(...p);
  return lo === 0 ? 'Free' : 'From ' + money(lo, ev.currency);
}
function soldOut(ev, av) {
  if (!av) return false;
  if (+ev.capacity > 0 && av.total >= +ev.capacity) return true;
  const vis = (ev.ticketTypes || []).filter(t => !t.hidden);
  return vis.length > 0 && vis.every(t => +t.qty > 0 && (av.tt[t.id] || 0) >= +t.qty);
}
function listedEvents() {
  const now = Date.now() - 6 * 3600e3;
  return S.events.filter(e => eventListed(e) && D(e.end || e.start) >= now).sort((a, b) => D(a.start) - D(b.start));
}

function Home() {
  const h = S.home, all = listedEvents();
  const cats = ['All', ...new Set(all.map(e => e.category).filter(Boolean))];
  const q = h.q.trim().toLowerCase();
  const evs = all.filter(e => (h.cat === 'All' || e.category === h.cat) && (!q || [e.name, e.venue, e.address, e.category, e.summary].join(' ').toLowerCase().includes(q)));
  const marq = ['Reserved seating', 'Timed entry', 'Discount codes', 'QR e-tickets', 'Door scanner app', 'Waitlists', 'Embeddable checkout', 'Team permissions', 'Sales reports'];
  const feats = [['cal', 'Every kind of event', 'One-off shows, multi-day festivals, timed entry slots and recurring sessions.'],
    ['ticket', 'Reserved seating', 'Draw your room, price it by section, and let buyers pick their own seats.'],
    ['cart', 'Checkout that converts', 'Bundles, add-ons, discount codes, donations and custom questions.'],
    ['scan', 'Door scanner app', 'Any phone becomes a scanner. Works offline, flags duplicates instantly.'],
    ['chart', 'Live reporting', 'Revenue by event, ticket type and channel. Export everything to CSV.'],
    ['users', 'Built for teams', 'Admins, event managers, box office and door staff — each with the right access.']];
  return `
  <header class="hero">
    <canvas id="heroCanvas" aria-hidden="true"></canvas><div class="glow"></div>
    <div class="hero-inner">
      <div class="mark">${logo()}</div>
      <h1>Sell tickets. <em>Fill every seat.</em></h1>
      <p class="lede">Ticketing for concerts, conferences, festivals and everything in between — a beautiful box office, instant QR e-tickets and a door scanner app.</p>
      <div class="row wrap" style="margin-top:30px"><a class="btn btn-accent btn-lg" href="#events">Find events <span class="arr">→</span></a><a class="btn glass btn-lg" href="#/admin">Start selling</a></div>
    </div>
  </header>
  <div class="deck">
    <div class="marquee"><div class="track">${[...marq, ...marq].map(m => `<span>${esc(m)}</span>`).join('')}</div></div>
    <div class="container section" id="events">
      <div class="section-head">
        <div><div class="eyebrow dash">On sale now</div><h2 style="margin-top:8px">Upcoming events</h2></div>
        <div class="row wrap"><input class="inp pill-inp" data-input="homeq" placeholder="Search events or venues…" value="${esc(h.q)}">
        <div class="tabs"><button class="${h.view === 'list' ? 'on' : ''}" data-action="homeView" data-v="list">Grid</button><button class="${h.view === 'cal' ? 'on' : ''}" data-action="homeView" data-v="cal">Calendar</button></div></div>
      </div>
      <div class="cat-row">${cats.map(c => `<button class="${h.cat === c ? 'on' : ''}" data-action="homeCat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      ${h.view === 'cal' ? Calendar(evs) : evs.length ? `<div class="ev-grid">${evs.map(EvCard).join('')}</div>` : `<div class="empty"><div class="display">No events found</div><p>Try a different search or category.</p></div>`}
    </div>
    <div class="container section">
      <div class="section-head"><div><div class="eyebrow dash">For organizers</div><h2 style="margin-top:8px">Everything you need to sell out</h2></div><a class="btn btn-dark" href="#/admin">Open the box office →</a></div>
      <div class="feat-grid">${feats.map(([i, t, d]) => `<div class="feat"><span class="feat-ic">${ic(i, 20)}</span><h3>${t}</h3><p>${d}</p></div>`).join('')}</div>
    </div>
    <div class="container" style="padding-bottom:60px">
      <div class="promo">
        <div class="promo-copy">
          <div class="eyebrow dash" style="color:var(--mut)">Door scanner app</div>
          <h2>Scan tickets from any phone</h2>
          <ul class="ticks"><li>Instant green / amber / red — valid, already used, wrong event</li><li>Keeps scanning when the Wi-Fi drops, syncs when it's back</li><li>Guest search, live arrivals and Bluetooth scanner support</li><li>No app store — add it to the home screen in one tap</li></ul>
          <a class="btn btn-accent btn-lg" href="#/scan">Try the scanner <span class="arr">→</span></a>
        </div>
        <div class="mock-phone" aria-hidden="true"><div class="mock-screen">
          <div class="sc-result ok mock"><div class="sc-res-icon">${ic('check', 54)}</div><div class="sc-res-t">Valid ticket</div><div class="sc-res-name">Maya Patel</div><div class="sc-res-meta">Stalls · Seat F12</div><div class="sc-res-note">212 of 412 checked in</div></div>
        </div></div>
      </div>
    </div>
  </div>`;
}
function EvCard(ev) {
  const d = D(ev.start), av = S.avail[ev.id]; if (!av) refreshAvailOnce(ev.id);
  const out = soldOut(ev, av);
  return `<a class="ev-card" href="#/e/${esc(ev.slug)}">
    <div class="ev-img" style="${artBg(ev)}">${artTitle(ev)}
      <div class="chips">${out ? '<span class="chip bad">Sold out</span>' : ''}${ev.category ? `<span class="chip gold">${esc(ev.category)}</span>` : ''}</div>
      <div class="datebadge"><div class="m">${esc(fmtDate(ev.start, { month: 'short' }))}</div><div class="d">${d.getDate()}</div></div>
    </div>
    <div class="ev-body"><h3>${esc(ev.name)}</h3>
      <div class="meta">${esc(fmtDate(ev.start, { weekday: 'long' }))} · ${esc(fmtTime(ev.start))}</div>
      <div class="meta">${esc(ev.venue || (ev.online ? 'Online event' : ''))}</div>
      <div class="foot"><span class="price">${esc(priceFrom(ev))}</span><span class="btn btn-dark btn-sm">${out ? 'Join waitlist' : 'Tickets'} →</span></div>
    </div></a>`;
}
const _availReq = new Set();
function refreshAvailOnce(id) { if (_availReq.has(id)) return; _availReq.add(id); refreshAvail(id); }
function Calendar(evs) {
  const base = S.home.month ? new Date(S.home.month) : (evs[0] ? D(evs[0].start) : new Date());
  const m0 = new Date(base.getFullYear(), base.getMonth(), 1), start = new Date(m0); start.setDate(1 - m0.getDay());
  const cells = []; const today = new Date().toDateString();
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const todays = evs.filter(e => D(e.start).toDateString() === d.toDateString());
    cells.push(`<div class="cal-cell ${d.getMonth() !== m0.getMonth() ? 'out' : ''} ${d.toDateString() === today ? 'today' : ''}"><span class="n">${d.getDate()}</span>
      ${todays.map(e => `<a class="cal-ev" href="#/e/${esc(e.slug)}" title="${esc(e.name)}">${esc(fmtTime(e.start))} ${esc(e.name)}</a>`).join('')}</div>`);
  }
  return `<div class="cal"><div class="cal-head"><button class="icon-btn" data-action="calMove" data-v="-1" aria-label="Previous month">‹</button>
    <b>${esc(m0.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))}</b><button class="icon-btn" data-action="calMove" data-v="1" aria-label="Next month">›</button></div>
    <div class="cal-grid">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="dow">${d}</div>`).join('')}${cells.join('')}</div></div>`;
}

// ── Event page ────────────────────────────────────────────────────────────────
function EventPage() {
  const ev = S.events.find(e => e.slug === S.route.params[0]) || S.adm?.events.find(e => e.slug === S.route.params[0]);
  if (!ev) return NotFound();
  const sel = S.sel, av = S.avail[ev.id];
  const preview = !eventLive(ev), shows = (ev.timeSlots || []).filter(s => !s.hidden), multiDay = new Set(shows.map(s => fmtDate(s.start))).size > 1;
  const contact = ev.contact?.email || ev.contact?.phone ? ev.contact : { email: S.settings.contactEmail };
  return `
  <section class="ev-hero"><div class="bg" style="${artBg(ev)}"></div>
    <div class="inner">
      <div>
        ${preview ? `<span class="chip warn" style="margin-bottom:14px">Preview — ${ev.archived ? 'archived' : ev.status !== 'published' ? 'not published' : ev.visibility === 'hidden' ? 'hidden from the public' : 'publishes ' + esc(fmtDT(ev.publishAt))}</span>` : ''}
        <div class="eyebrow" style="color:var(--accent)">${esc(ev.category || 'Event')}${ev.audience ? ' · ' + esc(ev.audience) : ''}</div>
        <h1 style="margin-top:10px">${esc(ev.name)}</h1>
        <div class="facts">
          <div>${ic('cal')} ${multiDay ? `${shows.length} dates · ${esc(fmtDate(shows[0].start, { month: 'short', day: 'numeric' }))} – ${esc(fmtDate(shows[shows.length - 1].start, { month: 'short', day: 'numeric', year: 'numeric' }))}` : esc(fmtDate(ev.start, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</div>
          <div>${ic('clock')} ${ev.allDay ? 'All day' : shows.length > 1 ? `${shows.length} showtimes` : esc(fmtTime(ev.start)) + (ev.end ? ' – ' + esc(fmtTime(ev.end)) : '')}${ev.doors ? ' · Doors ' + esc(ev.doors) : ''}</div>
          <div>${ic('pin')} ${ev.online ? 'Online event' : esc([ev.venue, ev.address].filter(Boolean).join(' · '))}</div>
        </div>
        <div class="row wrap" style="margin-top:22px">
          <button class="btn glass btn-sm" data-action="ics" data-id="${ev.id}">${ic('cal', 14)} Add to calendar</button>
          <a class="btn glass btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(ev.name + ' ' + shareUrl(ev.slug))}">Share on WhatsApp</a>
          <button class="btn glass btn-sm" data-action="copyLink" data-v="${esc(shareUrl(ev.slug))}">Copy link</button>
        </div>
      </div>
      <div class="poster hide-sm" style="${artBg(ev)}">${artTitle(ev, 'art-t lg')}</div>
    </div>
  </section>
  <div class="container"><div class="ev-layout">
    <div>
      ${ev.seating?.enabled && sel && (!ev.timeSlots?.length || sel.slotId) && !(ev.hasPassword && !sel.unlocked.event) ? BuyerSeatMap(ev, av, sel) : ''}
      <div class="eyebrow dash" ${ev.seating?.enabled ? 'style="margin-top:28px"' : ''}>About this event</div>
      <p class="ev-desc" style="margin-top:14px">${esc(ev.description || ev.summary || '')}</p>
      ${ev.instructions ? `<div class="sep" style="margin:28px 0"></div><div class="eyebrow dash">Good to know</div><p class="ev-desc" style="margin-top:12px">${esc(ev.instructions)}</p>` : ''}
      ${ev.policies ? `<div class="sep" style="margin:28px 0"></div><div class="eyebrow dash">Event policies</div><p class="ev-desc small" style="margin-top:12px">${esc(ev.policies)}</p>` : ''}
      ${contact?.email || contact?.phone ? `<div class="sep" style="margin:28px 0"></div><div class="eyebrow dash">Questions?</div><p style="margin-top:10px">${contact.name ? esc(contact.name) + '<br>' : ''}${contact.email ? `<a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a>` : ''}${contact.phone ? (contact.email ? ' · ' : '') + esc(contact.phone) : ''}</p>` : ''}
      ${!ev.online && ev.address ? `<div class="sep" style="margin:28px 0"></div><div class="eyebrow dash">Venue</div>
        <p style="margin-top:10px"><b>${esc(ev.venue)}</b><br><span class="muted">${esc(ev.address)}</span></p>
        <div class="map"><iframe loading="lazy" title="Map" src="https://maps.google.com/maps?q=${encodeURIComponent(ev.address)}&output=embed"></iframe></div>` : ''}
    </div>
    <aside class="ticket-panel"><div class="card">${TicketPanel(ev, sel, av)}</div></aside>
  </div></div>`;
}
function TicketPanel(ev, sel, av) {
  if (!sel) return '';
  const pwNeeded = ev.hasPassword && !sel.unlocked.event;
  if (pwNeeded) return `<h3>${ic('lock', 16)} Password required</h3><p class="muted small" style="margin:6px 0 14px">This event is private. Enter the password you were given.</p>
    <div class="field"><input class="inp" type="password" data-input="pw" value="${esc(sel.pw)}" placeholder="Password"></div><button class="btn btn-dark btn-block" data-action="unlock">Unlock</button>`;
  if (!av) return '<p class="muted">Loading tickets…</p>';
  const now = new Date();
  if (ev.salesEnd && D(ev.salesEnd) < now) return '<h3>Sales have ended</h3><p class="muted small">Tickets are no longer available online.</p>';
  if (ev.salesStart && D(ev.salesStart) > now) return `<span class="chip info">Coming soon</span><h3 style="margin-top:10px">Tickets go on sale ${esc(fmtDT(ev.salesStart))}</h3>${['presale', 'always'].includes(ev.waitlistMode) ? '<div class="sep"></div>' + Waitlist(ev, 'presale') : ''}`;
  const shown = (ev.timeSlots || []).filter(s => !s.hidden);
  if (soldOut(ev, av) || (shown.length && shown.every(s => slotState(s, av) !== 'open'))) return Waitlist(ev, 'soldout');
  const onMap = new Set(Object.values(ev.seating?.index || {}));
  const tts = ev.ticketTypes.filter(t => (!t.hidden || sel.unlocked.tts.includes(t.id)) && (!ev.seating?.enabled || onMap.has(t.id)));
  const hasLocked = ev.ticketTypes.some(t => t.hidden && t.locked && !sel.unlocked.tts.includes(t.id));
  const seated = ev.seating?.enabled;
  const slotOK = !ev.timeSlots?.length || sel.slotId;
  const tierOf = id => ev.seating?.index?.[id];
  const seatCount = tt => sel.seats.filter(s => tierOf(s) === tt.id).length;
  const takenNow = new Set((av.seats || []).filter(k => k.startsWith((sel.slotId || '') + '|')).map(k => k.split('|')[1]));
  const left = t => seated ? Object.keys(ev.seating.index || {}).filter(id => tierOf(id) === t.id && !takenNow.has(id)).length
    : +t.qty > 0 ? Math.max(0, +t.qty - (av.tt[t.id] || 0)) : Infinity;
  const evLeft = +ev.capacity > 0 ? Math.max(0, +ev.capacity - av.total) : Infinity;
  const total = sum(tts, t => (seated ? seatCount(t) : (sel.qty[t.id] || 0)) * t.price) + sum(ev.addons || [], a => (sel.addons[a.id] || 0) * a.price);
  const count = seated ? sel.seats.length : sum(Object.values(sel.qty), x => x);
  return `
    <div class="between"><h3>Tickets</h3>${ev.capacity && evLeft < 50 ? `<span class="chip warn">${evLeft} left</span>` : ''}</div>
    ${shown.length ? `<div class="eyebrow" style="margin:14px 0 8px">1 · Choose a ${new Set(shown.map(s => fmtDate(s.start))).size > 1 ? 'date & time' : 'time'}</div><div class="slot-list">${shown.slice().sort((a, b) => D(a.start) - D(b.start)).map(s => {
      const st = slotState(s, av), l = +s.capacity > 0 ? +s.capacity - (av.slots[s.id] || 0) : 99;
      return `<button class="slot ${sel.slotId === s.id ? 'on' : ''}" ${st !== 'open' ? 'disabled' : ''} data-action="pickSlot" data-id="${s.id}"><b>${esc(fmtTime(s.start))}</b>${st === 'soldout' ? 'Sold out' : st === 'unavailable' ? 'Unavailable' : esc(fmtDate(s.start, { month: 'short', day: 'numeric' })) + (l < 20 ? ' · ' + l + ' left' : '')}${s.label ? `<small>${esc(s.label)}</small>` : ''}</button>`; }).join('')}</div>
      <div class="eyebrow" style="margin:18px 0 8px">2 · Choose tickets</div>` : '<div style="height:12px"></div>'}
    ${seated ? (slotOK ? (sel.seats.length ? `<div class="seat-chips">${sel.seats.map(id => `<button class="chip" data-action="pickSeat" data-v="${esc(id)}" title="Remove">${esc(seatName(ev, id, true))} ✕</button>`).join('')}</div>` : '<p class="small muted" style="margin-bottom:10px">Choose seats on the map.</p>') : '<p class="muted small">Pick a time to see seats.</p>') : ''}
    <div style="${slotOK ? '' : 'opacity:.45;pointer-events:none'}">
    ${tts.map(t => {
      const q = seated ? seatCount(t) : (sel.qty[t.id] || 0), l = Math.min(left(t), evLeft), max = Math.min(+t.max || 10, l === Infinity ? 99 : Math.floor(l / (+t.admits || 1)));
      const notYet = t.salesStart && D(t.salesStart) > now, ended = t.salesEnd && D(t.salesEnd) < now;
      return `<div class="tt ${q ? 'sel' : ''}"><div><div class="name">${esc(t.name)}</div>
        <div class="desc">${money(t.price, ev.currency)}${t.desc ? ' · ' + esc(t.desc) : ''}${l !== Infinity && l < 25 && l > 0 ? ` · <b style="color:var(--warn)">${l} left</b>` : ''}</div></div>
        ${notYet ? `<span class="chip">On sale ${esc(fmtDate(t.salesStart, { month: 'short', day: 'numeric' }))}</span>` : ended ? '<span class="chip">Ended</span>' : l <= 0 ? '<span class="chip bad">Sold out</span>'
          : seated ? `<b class="tnum">${q}</b>` : `<div class="qty"><button data-action="qty" data-id="${t.id}" data-d="-1" ${q <= 0 ? 'disabled' : ''} aria-label="Fewer">−</button><span class="tnum">${q}</span><button data-action="qty" data-id="${t.id}" data-d="1" data-max="${max}" data-min="${+t.min || 1}" ${q >= max ? 'disabled' : ''} aria-label="More">+</button></div>`}
      </div>`; }).join('')}
    ${(ev.addons || []).length ? `<div class="eyebrow" style="margin:18px 0 8px">Add-ons</div>${ev.addons.map(a => `<div class="tt"><div><div class="name">${esc(a.name)}</div><div class="desc">${money(a.price, ev.currency)}</div></div>
      <div class="qty"><button data-action="addon" data-id="${a.id}" data-d="-1" ${!(sel.addons[a.id] > 0) ? 'disabled' : ''}>−</button><span>${sel.addons[a.id] || 0}</span><button data-action="addon" data-id="${a.id}" data-d="1">+</button></div></div>`).join('')}` : ''}
    </div>
    ${hasLocked ? `<details style="margin-top:14px"><summary class="small muted" style="cursor:pointer">Have an access code?</summary><div class="row" style="margin-top:8px"><input class="inp" data-input="pw" value="${esc(sel.pw)}" placeholder="Access code"><button class="btn btn-ghost" data-action="unlock">Apply</button></div></details>` : ''}
    <div class="sep"></div>
    <div class="between" style="margin-bottom:12px"><span class="muted">${count} ticket${count === 1 ? '' : 's'}</span><b style="font-size:18px">${money(total, ev.currency)}</b></div>
    <button class="btn btn-accent btn-lg btn-block" data-action="addToCart" ${count ? '' : 'disabled'}>Get tickets <span class="arr">→</span></button>
    <p class="small muted" style="text-align:center;margin-top:10px">Booking fees and tax shown at checkout.</p>
    ${ev.waitlistMode === 'always' ? `<details style="margin-top:14px"><summary class="small muted" style="cursor:pointer">Can't find what you want? Join the waitlist</summary><div style="margin-top:10px">${Waitlist(ev, 'always')}</div></details>` : ''}`;
}
const TIER_COLORS = ['#020a16', '#2f66b2', '#7a5aa6', '#1f8a5b', '#b35c34', '#0e7490', '#9d174d', '#4d7c0f'];
const tierColor = (ev, ttId) => { const i = ev.ticketTypes.findIndex(t => t.id === ttId); return i < 0 ? '#c9c5ba' : TIER_COLORS[i % TIER_COLORS.length]; };
const _layoutMemo = new WeakMap();
const layoutOf = st => { const k = JSON.stringify([st.sections, st.prices, st.stage]); const m = _layoutMemo.get(st); if (m && m.k === k) return m.L; const L = seatLayout(st); _layoutMemo.set(st, { k, L }); return L; };
// "Stalls centre · Row A · Seat 12" (long) or "Stalls centre A12" (short)
function seatName(ev, id, short) {
  const p = ev?.seating?.sections && layoutOf(ev.seating).seats.find(x => x.id === id); if (!p) return id || '';
  if (p.sec.kind === 'table') return short ? `${p.sec.name} · ${p.num}` : `${p.sec.name} · Seat ${p.num}`;
  return short ? `${p.sec.name} ${p.row}${p.num}` : `${p.sec.name} · Row ${p.row} · Seat ${p.num}`;
}
// One SVG renderer for buyers (mode '') and the designer (mode 'move' | 'paint' | 'block').
function SeatCanvas(ev, o = {}) {
  const st = ev.seating, L = layoutOf(st), b = L.bounds, pad = 24, design = !!o.mode;
  const blocked = new Set(st.blocked || []), taken = o.taken || new Set(), mine = new Set(o.mine || []), sold = o.sold || new Set();
  const stg = st.stage;
  const vb = `${b.x0 - pad} ${b.y0 - pad} ${b.x1 - b.x0 + 2 * pad} ${b.y1 - b.y0 + 2 * pad}`;
  return `<svg class="sm ${design ? 'sm-design sm-' + o.mode : ''}" viewBox="${vb}" preserveAspectRatio="xMidYMin meet" role="img" aria-label="Seating map">
    ${stg ? `<g class="sm-stage ${design ? 'drag' : ''}" data-stage="1" transform="translate(${+stg.x} ${+stg.y})"><rect width="${+stg.w}" height="${+stg.h}" rx="12"/><text x="${stg.w / 2}" y="${stg.h / 2 + 5}">${esc(stg.label || 'STAGE')}</text></g>` : ''}
    ${L.secs.map(g => { const sec = g.sec, on = o.selected === sec.id;
      const rows = sec.kind === 'table' ? '' : [...new Set(g.local.map(p => p.row))].map(r => { const rs = g.local.filter(p => p.row === r), f = rs.reduce((a, p) => p.x < a.x ? p : a, rs[0]), l = rs.reduce((a, p) => p.x > a.x ? p : a, rs[0]);
        return `<text class="sm-row" data-row="${sec.id}|${esc(r)}" x="${f.x - 20}" y="${f.y + 4}">${esc(r)}</text><text class="sm-row" data-row="${sec.id}|${esc(r)}" x="${l.x + 20}" y="${l.y + 4}">${esc(r)}</text>`; }).join('');
      return `<g class="sm-sec ${on ? 'on' : ''}" data-sec="${sec.id}" transform="translate(${+sec.x || 0} ${+sec.y || 0}) rotate(${+sec.rot || 0} ${g.cx} ${g.cy})">
        ${design ? `<rect class="sm-hit" x="${g.minx - 32}" y="${g.miny - 40}" width="${g.maxx - g.minx + 64}" height="${g.maxy - g.miny + 58}" rx="14"/>` : ''}
        <text class="sm-name" x="${g.cx}" y="${g.miny - 22}">${esc(sec.name)}</text>
        ${sec.kind === 'table' ? `<circle class="sm-table" cx="0" cy="0" r="${g.R}"/>` : rows}
        ${g.local.map(p => {
          const isB = blocked.has(p.id), isT = taken.has(p.id) || (design && sold.has(p.id)), isM = mine.has(p.id), t = ev.ticketTypes.find(x => x.id === p.tt);
          const fill = isB ? 'none' : isT && !design ? '#d7d4cb' : tierColor(ev, p.tt);
          const buy = !design && !isB && !isT && t;
          return `<circle class="st ${isB ? 'blk' : ''} ${isT ? 'tkn' : ''} ${isM ? 'mine' : ''} ${!t ? 'nop' : ''}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="10.5" fill="${fill}" data-seat="${esc(p.id)}" ${buy ? `data-action="pickSeat" data-v="${esc(p.id)}"` : ''}><title>${esc(seatName(ev, p.id))}${t ? ' — ' + esc(t.name) + ' ' + money(t.price, ev.currency) : ' — not for sale'}${isT ? ' (sold)' : isB ? ' (blocked)' : ''}</title></circle>${sec.kind === 'table' || isB ? '' : `<text class="sm-num" x="${p.x.toFixed(1)}" y="${(p.y + 3.5).toFixed(1)}">${p.num}</text>`}`;
        }).join('')}</g>`; }).join('')}
  </svg>`;
}
function BuyerSeatMap(ev, av, sel) {
  const taken = new Set((av?.seats || []).filter(k => k.startsWith((sel?.slotId || '') + '|')).map(k => k.split('|')[1]));
  const used = [...new Set(Object.values(ev.seating.index || {}))], z = S.ui.zoom || 1;
  return `<div class="card sm-buy"><div class="between wrap" style="margin-bottom:10px"><div><div class="eyebrow dash">Choose your seats</div><p class="small muted" style="margin-top:4px">Tap seats to select them. Tap again to remove.</p></div>
      <div class="row"><button class="icon-btn" data-action="zoom" data-d="-1" aria-label="Zoom out">−</button><button class="icon-btn" data-action="zoom" data-d="1" aria-label="Zoom in">+</button></div></div>
    <div class="sm-scroll"><div style="width:${z * 100}%">${SeatCanvas(ev, { taken, mine: sel?.seats })}</div></div>
    <div class="legend">${ev.ticketTypes.filter(t => used.includes(t.id)).map(t => `<span><i style="background:${tierColor(ev, t.id)}"></i>${esc(t.name)} ${money(t.price, ev.currency)}</span>`).join('')}
      <span><i style="background:#d7d4cb"></i>Sold</span><span><i style="background:var(--accent);box-shadow:0 0 0 2px var(--ink)"></i>Your seats</span></div></div>`;
}
function Waitlist(ev, why) {
  if (ev.waitlistMode === 'off' || (why === 'presale' && !['presale', 'always'].includes(ev.waitlistMode))) return why === 'soldout' ? '<h3>Sold out</h3><p class="muted small">This event is sold out.</p>' : '';
  const w = S.ui.wl || {};
  if (w.done === ev.id) return `<h3>You're on the list</h3><p class="muted small" style="margin-top:6px">We'll let you know as soon as tickets are available.</p>`;
  return `${why === 'soldout' ? '<span class="chip bad">Sold out</span>' : ''}<h3 style="margin-top:10px">${why === 'presale' ? 'Get notified' : 'Join the waitlist'}</h3><p class="muted small" style="margin:4px 0 14px">${why === 'presale' ? 'Hear the moment tickets go on sale.' : 'Be first to hear if tickets free up.'}</p>
    <div class="field"><input class="inp" data-input="wlName" placeholder="Your name" value="${esc(w.name || '')}"></div>
    <div class="field"><input class="inp" type="email" data-input="wlEmail" placeholder="Email" value="${esc(w.email || '')}"></div>
    <div class="field"><input class="inp" type="tel" data-input="wlPhone" placeholder="Mobile (optional)" value="${esc(w.phone || '')}"></div>
    <button class="btn btn-dark btn-block" data-action="joinWaitlist" data-id="${ev.id}">Join waitlist</button>`;
}

// ── Cart & checkout ───────────────────────────────────────────────────────────
function cartQuote() { const bo = cartBo(); return quote(S.cart, S.events.concat(S.adm?.events || []), bo ? { ...DEFAULT_SETTINGS, ...bo.settings } : S.settings, S.co.disc); }
function Checkout() {
  const q = cartQuote(), co = S.co, set = S.settings;
  const evIds = [...new Set(S.cart.items.map(i => i.eventId))], evs = evIds.map(evById).filter(Boolean);
  if (!q.lines.length) return `<div class="container section"><div class="empty"><div class="display">Your cart is empty</div><p style="margin-bottom:18px">Find something great to go to.</p><a class="btn btn-accent" href="#/">Browse events <span class="arr">→</span></a></div></div>`;
  const questions = evs.flatMap(e => (e.questions || []).map(qq => ({ ...qq, ev: e })));
  const payOpts = [
    set.payments?.card !== false && { v: 'card', t: 'Credit / debit card', d: DB.live ? 'Card payments are not connected yet' : 'Demo mode — no charge, order is marked paid', off: DB.live },
    set.payments?.offline !== false && { v: 'offline', t: 'Pay later / at the door', d: 'Reserve now; your order stays pending until paid' },
  ].filter(Boolean);
  if (!co.payment) co.payment = (payOpts.find(p => !p.off) || {}).v || '';
  return `<div class="container"><div class="checkout">
    <div>
      <a href="javascript:history.back()" class="small muted" style="text-decoration:none">← Keep shopping</a>
      <h1 class="display" style="font-size:44px;margin:10px 0 22px">Checkout</h1>
      <div class="card stack">
        <div class="eyebrow dash">Your details</div>
        <div class="grid2"><div><label class="fl">Full name *</label><input class="inp" data-bind="co.name" autocomplete="name" value="${esc(co.name)}"></div>
          <div><label class="fl">Email *</label><input class="inp" type="email" data-bind="co.email" autocomplete="email" value="${esc(co.email)}"></div></div>
        <div class="grid2"><div><label class="fl">Mobile (for text reminders)</label><input class="inp" type="tel" data-bind="co.phone" autocomplete="tel" value="${esc(co.phone)}"></div><div></div></div>
        ${questions.map(qq => `<div><label class="fl">${esc(qq.label)}${qq.required ? ' *' : ''} <span class="muted">· ${esc(qq.ev.name)}</span></label>${qq.type === 'select'
          ? `<select class="inp" data-bind="co.answers.${qq.id}"><option value="">Choose…</option>${String(qq.options || '').split(',').map(o => o.trim()).filter(Boolean).map(o => `<option ${co.answers[qq.id] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
          : qq.type === 'checkbox' ? `<label class="check"><input type="checkbox" data-bind="co.answers.${qq.id}" ${co.answers[qq.id] ? 'checked' : ''}> Yes</label>`
          : `<input class="inp" data-bind="co.answers.${qq.id}" value="${esc(co.answers[qq.id] || '')}">`}</div>`).join('')}
      </div>
      ${set.donations ? `<div class="card" style="margin-top:16px"><div class="eyebrow dash">Add a donation</div><p class="small muted" style="margin:6px 0 12px">Support ${esc(set.name)}'s community programs. No fees are charged on donations.</p>
        <div class="row wrap">${[0, 1800, 3600, 10000].map(v => `<button class="btn ${+S.cart.donation === v ? 'btn-dark' : 'btn-ghost'} btn-sm" data-action="donate" data-v="${v}">${v ? money(v) : 'None'}</button>`).join('')}</div></div>` : ''}
      <div class="card" style="margin-top:16px"><div class="eyebrow dash" style="margin-bottom:12px">Payment</div>
        ${payOpts.map(p => `<label class="pay-opt ${co.payment === p.v ? 'on' : ''} ${p.off ? 'off' : ''}"><input type="radio" name="pay" ${p.off ? 'disabled' : ''} ${co.payment === p.v ? 'checked' : ''} data-action="pay" data-v="${p.v}"><div><b>${esc(p.t)}</b><div class="small muted">${esc(p.d)}</div></div></label>`).join('')}
        <div class="sep"></div>
        <label class="check"><input type="checkbox" data-bind="co.terms" ${co.terms ? 'checked' : ''}> <span>I agree to the <a href="#" data-action="showTerms">terms & conditions</a>.</span></label>
        <label class="check" style="margin-top:8px"><input type="checkbox" data-bind="co.optIn" ${co.optIn ? 'checked' : ''}> <span>Email me about future ${esc(set.name)} events.</span></label>
      </div>
    </div>
    <aside class="ticket-panel"><div class="card">
      <h3>Order summary</h3>
      ${evs.map(ev => `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)"><div class="between"><b>${esc(ev.name)}</b><button class="icon-btn" style="width:26px;height:26px" data-action="removeEv" data-id="${ev.id}" aria-label="Remove">${ic('x', 13)}</button></div>
        <div class="small muted">${esc(fmtDT(ev.start))} · ${esc(ev.venue || '')}</div>
        ${q.lines.filter(l => l.eventId === ev.id).map(l => `<div class="sum-line"><span>${l.qty} × ${esc(l.name)}${l.slotStart ? ` <span class="muted">@ ${esc(fmtTime(l.slotStart))}</span>` : ''}${l.seats?.length ? `<br><span class="small muted">${esc(l.seats.map(x => seatName(ev, x, true)).join(', '))}</span>` : ''}</span><span class="tnum">${money(l.unit * l.qty, q.currency)}</span></div>`).join('')}</div>`).join('')}
      <div class="sep"></div>
      ${co.disc ? `<div class="between small"><span class="chip ok">${esc(co.disc.code)}</span><a href="#" data-action="removeCode" class="small">Remove</a></div>`
        : `<div class="row"><input class="inp" data-bind="co.code" placeholder="Discount or voucher code" value="${esc(co.code)}"><button class="btn btn-ghost" data-action="applyCode">Apply</button></div>`}
      <div style="margin-top:12px">
        <div class="sum-line"><span class="muted">Subtotal</span><span class="tnum">${money(q.subtotal, q.currency)}</span></div>
        ${q.discount ? `<div class="sum-line" style="color:var(--ok)"><span>Discount</span><span class="tnum">−${money(q.discount, q.currency)}</span></div>` : ''}
        ${q.fee ? `<div class="sum-line"><span class="muted">Booking fee</span><span class="tnum">${money(q.fee, q.currency)}</span></div>` : ''}
        ${q.tax ? `<div class="sum-line"><span class="muted">Tax</span><span class="tnum">${money(q.tax, q.currency)}</span></div>` : ''}
        ${q.donation ? `<div class="sum-line"><span class="muted">Donation</span><span class="tnum">${money(q.donation, q.currency)}</span></div>` : ''}
        <div class="sum-line total"><span>Total</span><span class="tnum">${money(q.total, q.currency)}</span></div>
      </div>
      ${co.err ? `<div class="banner" style="background:var(--bad-bg);color:var(--bad);margin:12px 0 0">${esc(co.err)}</div>` : ''}
      <button class="btn btn-accent btn-lg btn-block" style="margin-top:16px" data-action="placeOrder" ${co.busy ? 'disabled' : ''}>${co.busy ? 'Placing order…' : q.total ? (co.payment === 'offline' ? 'Reserve tickets' : 'Pay ' + money(q.total, q.currency)) : 'Get free tickets'} <span class="arr">→</span></button>
      <p class="small muted" style="text-align:center;margin-top:10px">${ic('lock', 12)} Secure checkout · Tickets emailed instantly</p>
    </div></aside>
  </div></div>`;
}

// ── Order confirmation + e-tickets ───────────────────────────────────────────
async function loadOrder(id, key) {
  if (S.order?.order?.id === id) return;
  S.order = { loading: true };
  try { S.order = (await DB.getOrder(id, key)) || { missing: true }; } catch (e) { S.order = { missing: true, err: e.message }; }
  setContext(); render();
}
function OrderPage() {
  const o = S.order;
  if (!o || o.loading) return '<div class="container section"><p class="muted">Loading your order…</p></div>';
  if (o.missing) return `<div class="container section"><div class="empty"><div class="display">Order not found</div><p>Check your link, or <a href="#/tickets">look up your tickets</a>.</p></div></div>`;
  const ord = o.order, d = ord.data, cur = d.currency;
  return `<div class="container" style="padding:36px 28px 60px;max-width:900px">
    <div class="no-print">
      <span class="chip ${ord.status === 'paid' ? 'ok' : ord.status === 'pending' ? 'warn' : 'bad'}">${ord.status === 'pending' ? 'Reserved — payment due' : esc(ord.status)}</span>
      <h1 class="display" style="font-size:48px;margin:12px 0 6px">${ord.status === 'cancelled' || ord.status === 'refunded' ? 'Order ' + esc(ord.status) : 'You\'re going!'}</h1>
      <p class="muted">Order <b>${esc(ord.ref)}</b> · confirmation sent to <b>${esc(ord.buyer_email)}</b></p>
      <div class="row wrap" style="margin:18px 0 26px">
        <button class="btn btn-dark" data-action="print">Download / print tickets</button>
        ${[...new Set(d.lines.map(l => l.eventId))].map(id => evById(id) ? `<button class="btn btn-ghost" data-action="ics" data-id="${id}">${ic('cal', 14)} Add ${esc(evById(id).name)} to calendar</button>` : '').join('')}
        <button class="btn btn-ghost" data-action="resendMine">Email my tickets again</button>
      </div>
    </div>
    ${o.tickets.filter(t => t.status === 'valid').map(t => {
      const l = d.lines.find(x => x.kind === 'ticket' && x.ticketTypeId === t.ticket_type_id && x.eventId === t.event_id) || {}, ev = evById(t.event_id) || { name: l.eventName };
      return `<div class="e-ticket"><div class="l"><div class="logo">${logo()}</div>
        <div class="eyebrow" style="color:var(--accent)">${esc(l.name || 'Ticket')}${(l.admits > 1) ? ' · admits 1 of ' + l.admits : ''}</div>
        <h3 style="margin-top:6px">${esc(ev.name)}</h3>
        <div class="kv"><div><div class="k">Date</div><div class="v">${esc(fmtDate(t.slot_id ? l.slotStart : ev.start, { month: 'short', day: 'numeric', year: 'numeric' }))}</div></div>
          <div><div class="k">Time</div><div class="v">${esc(fmtTime(t.slot_id ? l.slotStart : ev.start))}</div></div>
          <div><div class="k">${t.seat ? 'Seat' : 'Entry'}</div><div class="v">${esc(t.seat ? seatName(ev, t.seat, true) : 'General')}</div></div>
          <div><div class="k">Name</div><div class="v">${esc(t.holder)}</div></div>
          <div style="grid-column:span 2"><div class="k">Venue</div><div class="v">${esc(ev.venue || '')}</div></div></div>
      </div><div class="r"><div class="qr" data-qr="${esc(t.code)}"></div><div class="code">${esc(t.code)}</div><div class="small muted">${t.checked_in_at ? 'Checked in ' + esc(fmtDT(t.checked_in_at)) : 'Show at the door'}</div></div></div>`;
    }).join('')}
    <div class="card no-print" style="margin-top:20px"><h3>Receipt</h3>
      ${d.lines.map(l => `<div class="sum-line"><span>${l.qty} × ${esc(l.name)} <span class="muted">${esc(l.eventName || '')}</span></span><span class="tnum">${money(l.unit * l.qty, cur)}</span></div>`).join('')}
      ${d.discount ? `<div class="sum-line"><span>Discount (${esc(d.code)})</span><span>−${money(d.discount, cur)}</span></div>` : ''}
      ${d.fee ? `<div class="sum-line"><span>Booking fee</span><span>${money(d.fee, cur)}</span></div>` : ''}${d.tax ? `<div class="sum-line"><span>Tax</span><span>${money(d.tax, cur)}</span></div>` : ''}
      ${d.donation ? `<div class="sum-line"><span>Donation</span><span>${money(d.donation, cur)}</span></div>` : ''}
      <div class="sum-line total"><span>Total</span><span>${money(d.total, cur)}</span></div>
      <p class="small muted" style="margin-top:12px">Bookmark this page — it's your ticket wallet. Need help? ${esc(S.settings.contactEmail)}</p></div>
  </div>`;
}
function FindTickets() {
  const f = S.ui.find || {};
  return `<div class="container" style="max-width:520px;padding:60px 28px"><h1 class="display" style="font-size:44px">Find my tickets</h1>
    <p class="muted" style="margin:6px 0 22px">Enter your order number and the email you used at checkout.</p>
    <div class="card"><div class="field"><label class="fl">Order number</label><input class="inp" data-input="findRef" placeholder="SET-XXXXXX" value="${esc(f.ref || '')}"></div>
    <div class="field"><label class="fl">Email</label><input class="inp" type="email" data-input="findEmail" value="${esc(f.email || '')}"></div>
    ${f.err ? `<p style="color:var(--bad);margin-bottom:10px" class="small">${esc(f.err)}</p>` : ''}
    <button class="btn btn-accent btn-block" data-action="findOrder">Show my tickets <span class="arr">→</span></button></div></div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  ORGANIZER BACK OFFICE
// ══════════════════════════════════════════════════════════════════════════════
const NAV = [
  ['dashboard', 'Dashboard', 'home'], ['events', 'Events', 'cal', 'events.view'], ['orders', 'Orders', 'cart', 'orders.view'], ['attendees', 'Door list', 'users', 'door.attendees'],
  ['checkin', 'Scanner app', 'scan', 'door.scan'], ['reports', 'Reports', 'chart', 'finance.reports'], ['marketing', 'Marketing', 'mega', 'comms.email'],
  ['team', 'Team', 'team', 'admin.invite|admin.perms|admin.remove'], ['branding', 'Branding', 'brush', 'admin.settings'], ['settings', 'Settings', 'gear', 'admin.settings'], ['security', 'My security', 'lock'],
];
const navOk = n => !n[3] || n[3].split('|').some(k => can(k));
const meLabel = m => m.support ? 'Platform support' : m.owner ? 'Owner' : (tplName(m.template) && (S.adm.bo.templates.find(t => t.id === m.template).perms.length === m.perms.length) ? tplName(m.template) : 'Custom access');
function AdminShell() {
  if (!S.user || S.user.mfa) return Login();
  if (!S.adm) return `<div class="empty" style="padding-top:30vh">Loading…</div>`;
  if (!S.adm.bo) return S.adm.super ? (setTimeout(() => { location.hash = '#/platform'; }), '') : Gate('No box office yet', `${esc(S.user.email)} isn't on any box office team. Ask an owner to invite you.`);
  if (S.adm.blocked) return Gate(S.adm.bo.name + ' is ' + BO_STATUS[S.adm.blocked].toLowerCase(), S.adm.blocked === 'pending' ? 'The platform team is reviewing this box office. You\'ll get an email when it\'s approved.' : 'Event pages and checkout are offline and staff access is paused. Contact the platform team.');
  const sub = S.route.sub, page = { dashboard: Dashboard, events: EventsList, event: EventEditor, orders: Orders, attendees: Attendees, checkin: CheckIn, reports: Reports, marketing: Marketing, team: Team, branding: Branding, settings: Settings, security: Security }[sub] || Dashboard;
  const allowed = NAV.filter(navOk), navKey = sub === 'event' ? 'events' : sub, entry = NAV.find(n => n[0] === navKey);
  const body = S.adm.needs2fa && sub !== 'security' ? Gate2fa() : entry && !navOk(entry) ? `<div class="empty"><div class="display" style="font-size:28px">No access</div><p class="muted" style="margin-top:8px">You don't have permission to open ${esc(entry[1])}. Ask a box office admin.</p></div>` : page();
  return `<div class="admin">
    <aside class="side"><a class="logo" href="#/admin">${logo()}<small>Box office</small></a>
      ${S.adm.bos.length > 1 || S.adm.super ? `<select class="inp bo-pick" data-action-change="switchBo" aria-label="Box office">${(S.adm.me.support && !S.adm.bos.some(b => b.id === S.adm.bo.id) ? [{ id: S.adm.bo.id, name: S.adm.bo.name + ' (support)' }] : []).concat(S.adm.bos).map(b => `<option value="${b.id}" ${b.id === S.adm.bo.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>` : `<div class="bo-name">${esc(S.adm.bo.name)}</div>`}
      <div class="grp">Manage</div>
      ${allowed.map(([k, t, i]) => `<a class="nav ${navKey === k ? 'on' : ''}" href="#/admin/${k}">${ic(i)}${t}</a>`).join('')}
      <div class="grp">Box office</div><a class="nav" href="#/b/${esc(S.adm.bo.slug)}" target="_blank">${ic('ext')}View public page</a>${S.adm.super ? `<a class="nav" href="#/platform">${ic('shield')}Platform admin</a>` : ''}
      <div class="me"><div style="color:#fff;font-weight:600">${esc(S.adm.me.name || S.user.email)}</div><div class="muted">${esc(meLabel(S.adm.me))}</div>
        <a href="#" data-action="signOut" style="color:var(--accent);font-size:12px;display:inline-block;margin-top:6px">Sign out</a></div>
    </aside>
    <main class="main">${S.adm.me.support ? `<div class="banner warn" style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><span><b>Support access</b> to ${esc(S.adm.bo.name)} — every action is recorded in their activity log.</span><button class="btn btn-dark btn-sm" data-action="exitSupport">Exit support</button></div>` : ''}${!DB.live ? `<div class="banner info">Demo mode — data is stored in this browser only. Connect Supabase in <code>config.js</code> to go live.</div>` : ''}${body}</main>
    <nav class="mob-nav">${allowed.slice(0, 5).map(([k, t, i]) => `<a class="${navKey === k ? 'on' : ''}" href="#/admin/${k}">${ic(i)}${t}</a>`).join('')}</nav>
  </div>`;
}
const Gate = (title, msg) => `<div style="min-height:100vh;display:grid;place-items:center;background:var(--ink);padding:20px"><div class="card" style="width:min(460px,100%)"><div style="height:40px;margin-bottom:18px">${logo()}</div>
  <h1 class="display" style="font-size:28px">${esc(title)}</h1><p class="muted" style="margin:8px 0 18px">${msg}</p><div class="row wrap">${S.adm?.super ? '<a class="btn btn-dark" href="#/platform">Platform admin</a>' : ''}<button class="btn btn-ghost" data-action="signOut">Sign out</button></div></div></div>`;
const Gate2fa = () => `<div class="card" style="max-width:520px"><h3>Two-factor sign-in required</h3><p class="muted small" style="margin:6px 0 14px">${esc(S.adm.bo.name)} requires everyone on the team to use an authenticator app. It takes a minute.</p><a class="btn btn-accent" href="#/admin/security">Set it up</a></div>`;
const DEMO_PEOPLE = [['moishsonn@gmail.com', 'Platform owner', 'Super admin + owns Skyline Live'], ['manager@skyline.example', 'Event manager', 'Only the Orchestra Gala'], ['support@skyline.example', 'Customer service', 'Orders & refunds'],
  ['finance@skyline.example', 'Finance', 'Reports only, no editing'], ['door@example.com', 'Door staff', 'Tonight\'s show only'], ['director@harborarts.example', 'Another box office', 'Harbor Arts — can\'t see Skyline']];
function Login(title = 'Organizer sign in', sub = 'explore the back office') {
  const l = S.ui.login, mfa = S.user?.mfa || l.mfa;
  return `<div style="min-height:100vh;display:grid;place-items:center;background:var(--ink);padding:20px">
    <div class="card" style="width:min(440px,100%)"><div style="height:44px;margin-bottom:18px">${logo()}</div>
      <h1 class="display" style="font-size:32px">${mfa ? 'Two-factor code' : esc(title)}</h1>
      <p class="muted" style="margin:6px 0 20px">${mfa ? 'Open your authenticator app and enter the 6-digit code for SET.' : DB.live ? 'We\'ll email you a one-time code.' : `Demo mode: enter any email to ${esc(sub)}, or pick a sample person below.`}</p>
      ${mfa ? `<div class="field"><label class="fl">Authenticator code</label><input class="inp" data-input="loginTotp" inputmode="numeric" maxlength="6" value="${esc(l.totp || '')}" autocomplete="one-time-code"></div>`
        : `<div class="field"><label class="fl">Work email</label><input class="inp" type="email" data-input="loginEmail" value="${esc(l.email)}" autocomplete="email"></div>
      ${l.sent ? `<div class="field"><label class="fl">6-digit code</label><input class="inp" data-input="loginCode" inputmode="numeric" value="${esc(l.code)}" autocomplete="one-time-code"></div>` : ''}`}
      ${l.err ? `<p class="small" style="color:var(--bad);margin-bottom:10px">${esc(l.err)}</p>` : ''}
      <button class="btn btn-accent btn-block btn-lg" data-action="${mfa ? 'loginMfa' : 'login'}">${mfa ? 'Verify' : l.sent || !DB.live ? 'Sign in' : 'Email me a code'} <span class="arr">→</span></button>
      ${!DB.live && !mfa ? `<div class="sep"></div><div class="eyebrow" style="margin-bottom:8px">Try as…</div><div class="demo-people">${DEMO_PEOPLE.map(([e, t, d]) => `<button class="demo-p" data-action="demoAs" data-v="${esc(e)}"><b>${esc(t)}</b><span>${esc(d)}</span></button>`).join('')}</div>` : ''}
      <p class="small" style="margin-top:16px;text-align:center"><a href="#/" class="muted">← Back to the box office</a>${mfa ? ' · <a href="#" class="muted" data-action="signOut">Use another account</a>' : ''}</p></div></div>`;
}
const head = (title, sub, actions = '') => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="row wrap">${actions}</div></div>`;
const liveOrders = () => S.adm.orders.filter(o => ['paid', 'pending'].includes(o.status));
const evStats = ev => {
  const tk = S.adm.tickets.filter(t => t.event_id === ev.id && t.status === 'valid');
  const cap = +ev.capacity || (ev.seating?.enabled ? Object.keys(ev.seating.index || {}).length : 0) || sum(ev.ticketTypes || [], t => +t.qty) || sum(ev.timeSlots || [], s => +s.capacity);
  const rev = sum(liveOrders().filter(o => o.event_ids.includes(ev.id)), o => sum(o.data.lines.filter(l => l.eventId === ev.id), l => l.unit * l.qty));
  return { sold: tk.length, cap, rev, checked: tk.filter(t => t.checked_in_at).length };
};
function barChart(data, fmt) {
  const W = 700, H = 200, max = Math.max(1, ...data.map(d => d.v)), bw = W / data.length;
  return `<svg class="chart" viewBox="0 0 ${W} ${H + 20}" preserveAspectRatio="none" role="img">${data.map((d, i) => {
    const h = Math.max(d.v ? 3 : 0, d.v / max * H);
    return `<rect class="b" x="${i * bw + 2}" y="${H - h}" width="${bw - 4}" height="${h}" rx="3"><title>${esc(d.label)}: ${esc(fmt(d.v))}</title></rect>${i % Math.ceil(data.length / 7) === 0 ? `<text x="${i * bw + bw / 2}" y="${H + 14}" text-anchor="middle">${esc(d.short)}</text>` : ''}`;
  }).join('')}</svg>`;
}
function dailySeries(orders, days, val) {
  const out = []; for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const n = new Date(d); n.setDate(d.getDate() + 1);
    out.push({ label: fmtDate(d.toISOString(), { month: 'short', day: 'numeric' }), short: fmtDate(d.toISOString(), { month: 'numeric', day: 'numeric' }), v: sum(orders.filter(o => D(o.created_at) >= d && D(o.created_at) < n), val) });
  } return out;
}
function Dashboard() {
  const os = liveOrders(), since = Date.now() - 30 * 864e5, recent = os.filter(o => D(o.created_at) >= since);
  const upcoming = S.adm.events.filter(e => e.status !== 'cancelled' && D(e.end || e.start) >= Date.now()).sort((a, b) => D(a.start) - D(b.start));
  const sold = S.adm.tickets.filter(t => t.status === 'valid').length, pend = os.filter(o => o.status === 'pending'), fin = can('finance.totals');
  return head(`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}`, esc(fmtDate(new Date().toISOString(), { weekday: 'long', month: 'long', day: 'numeric' })),
    can('events.create') ? `<a class="btn btn-accent" href="#" data-action="newEvent">${ic('plus', 15)} New event</a>` : '') + `
  <div class="kpis">
    ${fin ? `<div class="kpi dark"><div class="eyebrow">Revenue · 30 days</div><div class="v">${money(sum(recent, o => o.data.total))}</div><div class="d" style="color:var(--mut)">${money(sum(os, o => o.data.total))} all time</div></div>` : `<div class="kpi dark"><div class="eyebrow">Checked in today</div><div class="v">${S.adm.tickets.filter(t => t.checked_in_at && D(t.checked_in_at) >= new Date().setHours(0, 0, 0, 0)).length}</div><div class="d" style="color:var(--mut)">across your events</div></div>`}
    <div class="kpi"><div class="eyebrow">Tickets sold</div><div class="v">${sold.toLocaleString()}</div><div class="d">${S.adm.tickets.filter(t => t.status === 'valid' && D(S.adm.orders.find(o => o.id === t.order_id)?.created_at) >= Date.now() - 7 * 864e5).length} this week</div></div>
    <div class="kpi"><div class="eyebrow">Orders</div><div class="v">${os.length}</div><div class="d">${pend.length ? `<span style="color:var(--warn)">${pend.length} awaiting payment</span>` : 'All paid'}</div></div>
    <div class="kpi"><div class="eyebrow">Upcoming events</div><div class="v">${upcoming.filter(e => e.status === 'published').length}</div><div class="d">${upcoming.filter(e => e.status === 'draft').length} drafts</div></div>
  </div>
  <div class="cols">
    ${fin ? `<div class="card"><div class="between"><div><h3>Sales</h3><div class="small muted">Gross revenue, last 28 days</div></div>${can('finance.reports') ? '<a class="btn btn-ghost btn-sm" href="#/admin/reports">Reports →</a>' : ''}</div>
      ${barChart(dailySeries(os, 28, o => o.data.total), v => money(v))}</div>` : `<div class="card"><h3>Your access</h3><p class="small muted" style="margin-top:6px">${esc(meLabel(S.adm.me))} · ${eventsLabel(S.adm.me)}</p><p class="small muted" style="margin-top:8px">Sales figures are hidden for your role.</p></div>`}
    <div class="card"><div class="between" style="margin-bottom:10px"><h3>Latest orders</h3><a class="small" href="#/admin/orders">View all</a></div>
      ${S.adm.orders.slice().sort((a, b) => D(b.created_at) - D(a.created_at)).slice(0, 6).map(o => `<div class="between" style="padding:9px 0;border-bottom:1px solid var(--line);cursor:pointer" data-action="openOrder" data-id="${o.id}">
        <div><b>${esc(o.data.buyer.name)}</b><div class="small muted">${esc(o.data.lines[0]?.eventName || '')} · ${esc(ago(o.created_at))}</div></div><div style="text-align:right"><b class="tnum">${money(o.data.total, o.data.currency)}</b><div>${statusChip(o.status)}</div></div></div>`).join('') || '<p class="muted">No orders yet.</p>'}
    </div>
  </div>
  <div class="card" style="margin-top:18px;padding:0"><div style="padding:18px 22px 6px" class="between"><h3>Upcoming events</h3><a class="small" href="#/admin/events">All events</a></div>
    <div style="overflow:auto"><table class="tbl"><thead><tr><th>Event</th><th>Date</th><th>Status</th><th style="width:220px">Sold</th><th>Revenue</th></tr></thead><tbody>
    ${upcoming.map(e => { const s = evStats(e); return `<tr class="click" data-action="go" data-v="#/admin/event/${e.id}/details"><td><b>${esc(e.name)}</b><div class="small muted">${esc(e.venue || '')}</div></td><td>${esc(fmtDT(e.start))}</td><td>${evChip(e)}</td>
      <td><div class="between small"><span>${s.sold}${s.cap ? ' / ' + s.cap : ''}</span><span class="muted">${s.cap ? Math.round(s.sold / s.cap * 100) + '%' : ''}</span></div><div class="bar"><i style="width:${s.cap ? Math.min(100, s.sold / s.cap * 100) : 0}%"></i></div></td><td class="tnum">${money(s.rev)}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">No upcoming events.</td></tr>'}
    </tbody></table></div></div>`;
}
const statusChip = s => `<span class="chip ${{ paid: 'ok', pending: 'warn', cancelled: 'bad', refunded: 'bad' }[s] || ''}">${esc(s)}</span>`;

// ── Events (Stage 2): list, templates, overview, showtimes, waitlist, team, history ─────────────
const evChip = e => e.archived ? '<span class="chip">Archived</span>' : e.status === 'cancelled' ? '<span class="chip bad">Cancelled</span>' : e.status === 'draft' ? '<span class="chip">Draft</span>'
  : e.publishAt && D(e.publishAt) > Date.now() ? `<span class="chip info">Publishes ${esc(fmtDate(e.publishAt, { month: 'short', day: 'numeric' }))}</span>`
  : e.visibility === 'hidden' ? '<span class="chip warn">Hidden</span>' : e.visibility === 'link' ? '<span class="chip info">Link only</span>'
  : e.salesStart && D(e.salesStart) > Date.now() ? `<span class="chip info">Sales open ${esc(fmtDate(e.salesStart, { month: 'short', day: 'numeric' }))}</span>` : '<span class="chip ok">On sale</span>';
const EV_FILTERS = [['upcoming', 'Upcoming'], ['drafts', 'Drafts'], ['past', 'Past'], ['archived', 'Archived'], ['templates', 'Templates']];
function EventsList() {
  const f = S.ui.evf || 'upcoming', q = S.ui.q.toLowerCase(), now = Date.now() - 6 * 3600e3;
  const pick = { upcoming: e => !e.archived && e.status !== 'draft' && D(e.end || e.start) >= now, drafts: e => !e.archived && e.status === 'draft', past: e => !e.archived && e.status !== 'draft' && D(e.end || e.start) < now, archived: e => e.archived }[f];
  const evs = f === 'templates' ? [] : S.adm.events.filter(e => pick(e) && (!q || e.name.toLowerCase().includes(q))).sort((a, b) => (f === 'past' || f === 'archived' ? -1 : 1) * (D(a.start) - D(b.start)));
  const count = k => k === 'templates' ? (S.adm.bo.eventTemplates || []).length : S.adm.events.filter({ upcoming: e => !e.archived && e.status !== 'draft' && D(e.end || e.start) >= now, drafts: e => !e.archived && e.status === 'draft', past: e => !e.archived && e.status !== 'draft' && D(e.end || e.start) < now, archived: e => e.archived }[k]).length;
  return head('Events', `${S.adm.events.filter(e => !e.archived).length} events`, can('events.create') ? `<button class="btn btn-accent" data-action="newEvent">${ic('plus', 15)} New event</button>` : '') + `
  <div class="toolbar"><div class="tabs">${EV_FILTERS.map(([k, t]) => `<button class="${f === k ? 'on' : ''}" data-action="evFilter" data-v="${k}">${t} <span class="muted">${count(k)}</span></button>`).join('')}</div>
    ${f !== 'templates' ? `<input class="inp" data-input="q" placeholder="Search events…" value="${esc(S.ui.q)}">` : ''}</div>
  ${f === 'templates' ? EventTemplates() : `<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Event</th><th>Date</th><th>Status</th><th>Sold</th><th>${can('finance.totals') ? 'Revenue' : ''}</th><th></th></tr></thead><tbody>
  ${evs.map(e => { const s = evStats(e), n = (e.timeSlots || []).filter(x => !x.hidden).length; return `<tr class="click" data-action="go" data-v="#/admin/event/${e.id}/overview">
    <td style="width:66px"><div class="thumb" style="${artBg(e)}"></div></td>
    <td><b>${esc(e.name)}</b><div class="small muted">${esc(e.online ? 'Online' : e.venue || '')}</div></td><td>${esc(e.allDay ? fmtDate(e.start, { month: 'short', day: 'numeric', year: 'numeric' }) : fmtDT(e.start))}${n > 1 ? `<div class="small muted">${n} showtimes</div>` : ''}</td><td>${evChip(e)}</td>
    <td class="tnum">${s.sold}${s.cap ? ' / ' + s.cap : ''}</td><td class="tnum">${can('finance.totals') ? money(s.rev) : ''}</td>
    <td style="white-space:nowrap" data-stop="1"><a class="btn btn-ghost btn-sm" href="#/e/${esc(e.slug)}" target="_blank">View</a> ${can('events.create') ? `<button class="btn btn-ghost btn-sm" data-action="dupEvent" data-id="${e.id}">Duplicate</button>` : ''}</td></tr>`; }).join('') || `<tr><td colspan="7" class="empty">No ${esc(EV_FILTERS.find(x => x[0] === f)[1].toLowerCase())} events.</td></tr>`}
  </tbody></table></div>`}`;
}
function EventTemplates() {
  const list = S.adm.bo.eventTemplates || [];
  return `<p class="muted" style="margin:-4px 0 16px;max-width:680px">A template keeps an event's set-up — ticket types, prices, seating map, add-ons, questions, emails and policies — but never its orders, dates or discount codes. Save one from any event's editor.</p>
  <div class="tpl-grid">${list.map(t => { const e = t.event; return `<div class="card"><h3>${esc(t.name)}</h3>
    <p class="small muted" style="margin:6px 0 12px">${esc(e.ticketTypes.map(x => x.name + ' ' + money(x.price)).join(' · '))}${e.seating?.enabled ? ' · reserved seating' : ''}${e.audience ? ' · ' + esc(e.audience) : ''}<br>${pad(t.at?.[0] ?? 20)}:${pad(t.at?.[1] ?? 0)} · ${Math.round((t.minutes || 180) / 6) / 10} h</p>
    ${can('events.create') ? `<button class="btn btn-accent btn-sm" data-action="fromTemplate" data-v="${t.id}">Create event</button> <button class="btn btn-ghost btn-sm" data-action="rmEvTemplate" data-v="${t.id}">Delete</button>` : ''}</div>`; }).join('') || '<p class="muted">No templates yet.</p>'}</div>`;
}
function NewEventModal() {
  const list = S.adm.bo.eventTemplates || [];
  modal('New event', `<div class="new-ev"><button class="item-card" data-action="blankEvent"><b>Blank event</b><span class="small muted">Start from scratch</span></button>
    ${list.map(t => `<button class="item-card" data-action="fromTemplate" data-v="${t.id}"><b>${esc(t.name)}</b><span class="small muted">${esc(t.event.ticketTypes.length)} ticket types${t.event.seating?.enabled ? ' · seating map' : ''}</span></button>`).join('')}</div>`);
}
const ETABS = [['overview', 'Overview'], ['details', 'Details'], ['tickets', 'Tickets'], ['schedule', 'Showtimes'], ['seating', 'Seating'], ['checkout', 'Checkout'], ['discounts', 'Discounts'],
  ['emails', 'Emails'], ['waitlist', 'Waitlist'], ['team', 'Team'], ['history', 'History'], ['share', 'Share & embed']];
function EventEditor() {
  const ev = S.draft; if (!ev) return '<p class="muted">Event not found.</p>';
  const tab = S.route.params[1] || 'overview', ro = !can('events.edit', ev.id), pub = can('events.publish', ev.id);
  const body = { overview: EdOverview, details: EdDetails, tickets: EdTickets, schedule: EdSchedule, seating: EdSeating, checkout: EdCheckout, discounts: EdDiscounts, emails: EdEmails, waitlist: EdWaitlist, team: EdTeam, history: EdHistory, share: EdShare }[tab] || EdOverview;
  const live = ['overview', 'team', 'history', 'waitlist'].includes(tab);  // these tabs act immediately, not through "Save changes"
  return `<a href="#/admin/events" class="small muted" style="text-decoration:none">← Events</a>
  ${head(esc(ev.name || 'Untitled event'), `${evChip(ev)} ${S.dirty ? '<span class="chip warn">Unsaved changes</span>' : ''}`,
    `<a class="btn btn-ghost" href="#/e/${esc(ev.slug)}?preview=1" target="_blank">Preview</a>
    ${can('events.create') ? '<button class="btn btn-ghost" data-action="saveTemplate">Save as template</button>' : ''}
    ${pub && !ev.archived ? (ev.status === 'published' ? '<button class="btn btn-ghost" data-action="setStatus" data-v="draft">Unpublish</button>' : ev.status === 'draft' ? '<button class="btn btn-dark" data-action="setStatus" data-v="published">Publish</button>' : '') : ''}
    ${ro ? '' : `<button class="btn btn-accent" data-action="saveEvent" ${S.dirty ? '' : 'disabled'}>Save changes</button>`}`)}
  <nav class="etabs">${ETABS.map(([k, t]) => `<a class="${tab === k ? 'on' : ''}" href="#/admin/event/${ev.id}/${k}">${t}</a>`).join('')}</nav>
  ${live ? body(ev) : `<fieldset ${ro ? 'disabled' : ''} style="border:0">${body(ev)}</fieldset>`}`;
}
function EdOverview(ev) {
  const saved = S.adm.events.find(e => e.id === ev.id) || ev, tks = S.adm.tickets.filter(t => t.event_id === ev.id), valid = tks.filter(t => t.status === 'valid');
  const so = sellout(saved, tks), fin = can('finance.totals'), v = S.adm.views?.[ev.id] || { total: 0, unique: 0, today: 0, last10m: 0, bySrc: {} };
  const os = S.adm.orders.filter(o => o.event_ids.includes(ev.id) && ['paid', 'pending'].includes(o.status));
  const paidOrders = new Set(os.filter(o => o.status === 'paid' && !o.data.comp).map(o => o.id)), compOrders = new Set(os.filter(o => o.data.comp).map(o => o.id));
  const collected = sum(os.filter(o => o.status === 'paid'), o => sum(o.data.lines.filter(l => l.eventId === ev.id), l => l.unit * l.qty) - (o.data.discount || 0) * (sum(o.data.lines.filter(l => l.eventId === ev.id), l => l.unit * l.qty) / Math.max(1, o.data.subtotal)));
  const s = evStats(saved), blocked = (saved.seating?.enabled ? (saved.seating.blocked || []).length : 0) * so.shows;
  const pct = x => (x * 100).toFixed(x && x < .1 ? 1 : 0) + '%';
  const kpi = (l, val, d = '', dark) => `<div class="kpi ${dark ? 'dark' : ''}"><div class="eyebrow">${l}</div><div class="v">${val}</div>${d ? `<div class="d" ${dark ? 'style="color:var(--mut)"' : ''}>${d}</div>` : ''}</div>`;
  const slots = (saved.timeSlots || []);
  return `${fin ? `<div class="eyebrow dash" style="margin:4px 0 12px">Sellout value</div>
  <div class="kpis">${kpi('Potential sellout revenue', so.unknown && !so.total ? '—' : money(so.total), so.unknown ? 'Set a capacity or ticket limits to complete this' : so.estimate ? 'Unlimited ticket types counted up to capacity' : `${so.shows > 1 ? so.shows + ' showtimes · ' : ''}face value`, true)}
    ${kpi('Sold (face value)', money(so.soldValue), so.total ? pct(so.pct) + ' of potential' : '')}${kpi('Remaining potential', money(so.remaining))}${kpi('Collected', money(Math.round(collected)), 'paid orders, after discounts')}</div>
  <div class="bar big" style="margin:-4px 0 22px"><i style="width:${Math.min(100, so.pct * 100)}%"></i></div>
  <div class="cols"><div class="card" style="padding:0"><div style="padding:16px 20px 4px"><h3>By ticket type</h3></div><table class="tbl"><thead><tr><th>Ticket</th><th>Price</th><th>Inventory</th><th>Sold</th><th>Potential</th><th>Remaining</th></tr></thead><tbody>
    ${so.byTT.map(r => `<tr><td>${esc(r.tt.name)}${r.tt.hidden ? ' <span class="chip">hidden</span>' : ''}</td><td class="tnum">${money(r.tt.price)}</td><td class="tnum">${r.capacity == null ? '∞' : r.capacity}</td><td class="tnum">${r.sold}</td><td class="tnum">${money(r.potential)}</td><td class="tnum">${money(Math.max(0, r.potential - r.soldValue))}</td></tr>`).join('')}</tbody></table></div>
  ${so.bySec.length ? `<div class="card" style="padding:0"><div style="padding:16px 20px 4px"><h3>By seating section</h3></div><table class="tbl"><thead><tr><th>Section</th><th>Seats</th><th>Sold</th><th>Blocked</th><th>Potential</th><th>Remaining</th></tr></thead><tbody>
    ${so.bySec.map(r => `<tr><td>${esc(r.name)}</td><td class="tnum">${r.seats}</td><td class="tnum">${r.sold}</td><td class="tnum">${r.blocked}</td><td class="tnum">${money(r.potential)}</td><td class="tnum">${money(Math.max(0, r.potential - r.soldValue))}</td></tr>`).join('')}</tbody></table></div>` : `<div class="card"><h3>How this is calculated</h3><p class="small muted" style="margin-top:6px">Every sellable ticket × its price, per showtime. It updates by itself when prices, quantities, showtimes, seats or blocks change, and as tickets sell. Comps use up inventory but count at $0 collected.</p></div>`}</div>` : ''}
  <div class="eyebrow dash" style="margin:22px 0 12px">Performance</div>
  <div class="kpis">${kpi('Page views', v.total.toLocaleString(), `${v.unique.toLocaleString()} unique · ${v.today} today`)}${kpi('Viewing now', v.last10m, 'last 10 minutes')}
    ${kpi('Conversion', v.unique ? pct(os.length / v.unique) : '—', `${os.length} orders from ${v.unique} visitors`)}${kpi('Tickets issued', valid.length, `${valid.filter(t => paidOrders.has(t.order_id)).length} paid · ${valid.filter(t => compOrders.has(t.order_id)).length} comp`)}</div>
  <div class="kpis">${kpi('Remaining capacity', s.cap ? Math.max(0, s.cap - s.sold) : '∞', s.cap ? `of ${s.cap}` : 'no limit set')}${kpi('Blocked seats', blocked)}${kpi('Checked in', s.checked, valid.length ? pct(s.checked / valid.length) : '')}${fin ? kpi('Revenue to date', money(s.rev)) : kpi('Waitlist', S.adm.waitlist.filter(w => w.event_id === ev.id).length)}</div>
  <div class="cols">${slots.length ? `<div class="card" style="padding:0"><div style="padding:16px 20px 4px"><h3>By showtime</h3></div><table class="tbl"><thead><tr><th>Showtime</th><th>Status</th><th>Sold</th><th>Capacity</th><th>Checked in</th>${fin ? '<th>Revenue</th>' : ''}</tr></thead><tbody>
    ${slots.map(sl => { const st = valid.filter(t => t.slot_id === sl.id), state = slotState(sl, availabilityFrom(tks, ev.id)); const rev = sum(os, o => sum(o.data.lines.filter(l => l.eventId === ev.id && l.slotId === sl.id), l => l.unit * l.qty));
      return `<tr><td>${esc(fmtDT(sl.start))}${sl.label ? `<div class="small muted">${esc(sl.label)}</div>` : ''}</td><td>${SLOT_CHIP[state]}</td><td class="tnum">${st.length}</td><td class="tnum">${+sl.capacity || '∞'}</td><td class="tnum">${st.filter(t => t.checked_in_at).length}</td>${fin ? `<td class="tnum">${money(rev)}</td>` : ''}</tr>`; }).join('')}
    <tr><td><b>All showtimes</b></td><td></td><td class="tnum"><b>${valid.length}</b></td><td class="tnum">${sum(slots, x => +x.capacity) || '∞'}</td><td class="tnum">${s.checked}</td>${fin ? `<td class="tnum"><b>${money(s.rev)}</b></td>` : ''}</tr></tbody></table></div>` : ''}
    <div class="card"><h3>Traffic sources</h3><div class="small muted" style="margin-bottom:10px">Page views by tracking link (?src=)</div>${Object.entries(v.bySrc).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="between small" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(k)}</span><b class="tnum">${n}</b></div>`).join('') || '<p class="muted small">No views yet.</p>'}</div></div>`;
}
const SLOT_CHIP = { open: '<span class="chip ok">On sale</span>', soldout: '<span class="chip bad">Sold out</span>', unavailable: '<span class="chip warn">Unavailable</span>', hidden: '<span class="chip">Hidden</span>' };
function EdDetails(ev) {
  const vis = Object.entries(VISIBILITY);
  return `<div class="cols"><div class="stack"><div class="card">
    ${inp('name', 'Event name')}
    <div class="grid2">${inp('slug', 'URL', { hint: esc(shareUrl(ev.slug)) })}${inp('category', 'Category', { ph: 'Concert, Kumzitz, Family…' })}</div>
    ${inp('summary', 'Short summary')}
    ${inp('description', 'Description', { t: 'area' })}
    ${inp('image', 'Image / banner URL', { ph: 'https://…', hint: 'Use a 16:10 photo or poster, at least 1200px wide.' })}
    <div class="grid2">${inp('audience', 'Audience note', { ph: 'e.g. Men & boys only' })}${inp('doors', 'Doors open', { ph: '7:00 PM' })}</div></div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Event contact</div><p class="small muted" style="margin:-4px 0 12px">Shown on the event page. Leave blank to use the box office's contact details.</p>
      <div class="grid3">${inp('contact.name', 'Name')}${inp('contact.email', 'Email')}${inp('contact.phone', 'Phone')}</div></div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Policies & instructions</div>
      ${inp('policies', 'Event-specific policies', { t: 'area', ph: 'e.g. No refunds within 7 days. Strollers not permitted.' })}
      ${inp('instructions', 'Attendee instructions', { t: 'area', ph: 'Parking, entrance, dress code, what to bring…' })}</div>
  </div><div class="stack">
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">When</div>
      ${chk('allDay', 'All-day event')}<div style="height:10px"></div>
      ${ev.allDay ? `<div class="grid2">${inp('start', 'Starts', { t: 'dt' })}${inp('end', 'Ends', { t: 'dt' })}</div>` : `${inp('start', 'Starts', { t: 'dt' })}${inp('end', 'Ends', { t: 'dt' })}`}
      ${sel('timezone', 'Time zone', [['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Los_Angeles', 'Pacific'], ['Europe/London', 'London'], ['Asia/Jerusalem', 'Israel']])}
      ${(ev.timeSlots || []).length ? `<p class="small muted">This event has ${ev.timeSlots.length} showtimes — manage them on the <a href="#/admin/event/${ev.id}/schedule">Showtimes</a> tab.</p>` : ''}</div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Where</div>
      ${chk('online', 'Online / virtual event')}<div style="height:10px"></div>
      ${ev.online ? inp('onlineUrl', 'Joining link (shown to ticket holders only)', { ph: 'https://zoom.us/…' }) : inp('venue', 'Venue') + inp('address', 'Address')}</div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Capacity & visibility</div>
      ${inp('capacity', 'Total capacity', { t: 'int', hint: '0 = limited only by ticket quantities / showtimes' })}
      ${sel('visibility', 'Who can see it', vis)}
      ${inp('secrets.password', 'Password or access code', { hint: 'Optional. Buyers must enter it to see tickets.' })}
      ${sel('currency', 'Currency', [['USD', 'USD $'], ['GBP', 'GBP £'], ['EUR', 'EUR €'], ['ILS', 'ILS ₪'], ['CAD', 'CAD $']])}</div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Schedule</div>
      ${inp('publishAt', 'Publish automatically at', { t: 'dt', hint: 'Optional. The event stays off the public site until then (it still needs to be Published).' })}
      ${inp('salesStart', 'Ticket sales open', { t: 'dt', hint: 'Before this, the page shows when sales open (and the waitlist, if on).' })}
      ${inp('salesEnd', 'Ticket sales close', { t: 'dt', hint: 'Leave blank to sell until the event starts.' })}</div>
    ${can('events.publish', ev.id) ? `<div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Status</div><div class="row wrap">
      ${ev.status !== 'cancelled' ? '<button type="button" class="btn btn-ghost btn-sm" data-action="setStatus" data-v="cancelled">Cancel event</button>' : '<button type="button" class="btn btn-ghost btn-sm" data-action="setStatus" data-v="draft">Restore as draft</button>'}
      <button type="button" class="btn btn-ghost btn-sm" data-action="archiveEvent">${ev.archived ? 'Unarchive' : 'Archive'}</button>
      <button type="button" class="btn btn-danger btn-sm" data-action="deleteEvent">Delete</button></div>
      <p class="small muted" style="margin-top:10px">Archive hides a finished event everywhere but keeps every order and report. Delete only works for events that never had orders.</p></div>` : ''}
  </div></div>`;
}
function EdSchedule(ev) {
  const g = S.ui.gen || (S.ui.gen = { mode: 'weekly', from: toLocalInput(ev.start).slice(0, 10), until: '', count: 8, days: [new Date(ev.start).getDay()], times: toLocalInput(ev.start).slice(11, 16), cap: +ev.capacity || 100, every: 60, to: '17:00' });
  const av = availabilityFrom(S.adm.tickets, ev.id), slots = (ev.timeSlots || []).map((s, i) => ({ s, i })).sort((a, b) => D(a.s.start) - D(b.s.start));
  const flag = (i, k, t) => `<label class="check small" style="white-space:nowrap"><input type="checkbox" data-bind="draft.timeSlots.${i}.${k}" data-t="bool" ${ev.timeSlots[i][k] ? 'checked' : ''}> <span>${t}</span></label>`;
  return `<div class="cols" style="grid-template-columns:1.5fr 1fr;align-items:start"><div class="card"><div class="between" style="margin-bottom:6px"><h3>Showtimes</h3><button type="button" class="btn btn-ghost btn-sm" data-action="addSlot">${ic('plus', 14)} Add one</button></div>
    <p class="small muted" style="margin-bottom:14px">One event, many dates or times. Buyers pick a showtime; each has its own capacity (and its own seats on a seating map). Leave empty for a single-time event. Changing one showtime never changes the others.</p>
    ${slots.map(({ s, i }) => { const n = av.slots[s.id] || 0; return `<div class="slot-row ${s.hidden ? 'dim' : ''}"><div class="row" style="gap:8px;flex-wrap:wrap">${inp(`timeSlots.${i}.start`, '', { t: 'dt', cls: 'grow' })}<div style="width:110px">${inp(`timeSlots.${i}.capacity`, '', { t: 'int', ph: 'Capacity' })}</div>
      <div style="flex:1;min-width:140px">${inp(`timeSlots.${i}.label`, '', { ph: 'Label (optional)' })}</div>${SLOT_CHIP[slotState(s, av)]}<span class="chip">${n} sold</span>
      <button type="button" class="icon-btn" data-action="delSlot" data-i="${i}" ${n ? 'disabled title="Has tickets — hide or mark unavailable instead"' : 'title="Remove"'}>${ic('x', 14)}</button></div>
      <div class="row" style="gap:16px;margin-top:6px">${flag(i, 'hidden', 'Hide')}${flag(i, 'unavailable', 'Unavailable')}${flag(i, 'soldOut', 'Mark sold out')}</div></div>`; }).join('') || '<p class="muted">No showtimes — this is a single-time event.</p>'}
  </div><div class="card"><h3>Add showtimes in bulk</h3><div class="tabs" style="margin:10px 0 14px">${[['daily', 'Daily'], ['weekly', 'Weekly'], ['custom', 'Custom dates'], ['interval', 'Timed entry']].map(([k, t]) => `<button type="button" class="${g.mode === k ? 'on' : ''}" data-action="genMode" data-v="${k}">${t}</button>`).join('')}</div>
    ${g.mode === 'custom' ? `<div class="field"><label class="fl">Dates</label><textarea class="inp" data-input="gen.dates" placeholder="2026-12-24, 2026-12-25, 2026-12-31">${esc(g.dates || '')}</textarea><div class="small muted" style="margin-top:4px">Comma or line separated (YYYY-MM-DD)</div></div>`
      : `<div class="grid2"><div class="field"><label class="fl">${g.mode === 'interval' ? 'Date' : 'Starting'}</label><input class="inp" type="date" data-input="gen.from" value="${esc(g.from)}"></div>
        ${g.mode === 'interval' ? '' : `<div class="field"><label class="fl">Until (or count)</label><input class="inp" type="date" data-input="gen.until" value="${esc(g.until)}"></div>`}</div>`}
    ${g.mode === 'weekly' ? `<div class="field"><label class="fl">On</label><div class="row wrap" style="gap:6px">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => `<button type="button" class="chip ${g.days.includes(i) ? 'info' : ''}" style="cursor:pointer;border:0" data-action="genDay" data-v="${i}">${d}</button>`).join('')}</div></div>` : ''}
    ${g.mode === 'interval' ? `<div class="grid3"><div class="field"><label class="fl">From</label><input class="inp" type="time" data-input="gen.times" value="${esc(g.times)}"></div><div class="field"><label class="fl">Until</label><input class="inp" type="time" data-input="gen.to" value="${esc(g.to)}"></div><div class="field"><label class="fl">Every (min)</label><input class="inp" type="number" data-input="gen.every" value="${esc(g.every)}"></div></div>`
      : `<div class="field"><label class="fl">Times each day</label><input class="inp" data-input="gen.times" value="${esc(g.times)}" placeholder="14:00, 19:30"><div class="small muted" style="margin-top:4px">Several shows a day? List each time.</div></div>`}
    <div class="grid2">${g.mode === 'daily' || g.mode === 'weekly' ? `<div class="field"><label class="fl">Max showtimes</label><input class="inp" type="number" data-input="gen.count" value="${esc(g.count)}"></div>` : ''}<div class="field"><label class="fl">Capacity each</label><input class="inp" type="number" data-input="gen.cap" value="${esc(g.cap)}"></div></div>
    <button type="button" class="btn btn-dark btn-block" data-action="genSlots">Add showtimes</button><p class="small muted" style="margin-top:8px">Duplicates of existing showtimes are skipped. Save changes afterwards.</p></div></div>`;
}
function EdWaitlist(ev) {
  const wl = S.adm.waitlist.filter(w => w.event_id === ev.id).sort((a, b) => D(a.created_at) - D(b.created_at)), waiting = wl.filter(w => !w.notified_at);
  return `<div class="cols" style="align-items:start"><div class="card"><h3>Waitlist settings</h3>
    <fieldset ${can('events.edit', ev.id) ? '' : 'disabled'} style="border:0">${sel('waitlistMode', 'When to offer it', Object.entries(WAITLIST_MODES))}</fieldset>
    <p class="small muted">We collect name, email and phone. Save changes after switching. “Always shown” lets you open it whenever you like — even while tickets are on sale.</p>
    ${S.dirty ? '<button class="btn btn-accent btn-sm" data-action="saveEvent">Save changes</button>' : ''}
    ${can('comms.notify', ev.id) ? `<div class="sep"></div><h3>Notify the waitlist</h3><p class="small muted" style="margin:4px 0 10px">Tell the ${waiting.length} people still waiting that tickets are available. Each person is notified once.</p>
      <textarea class="inp" data-input="wlMsg" placeholder="Good news — more tickets for ${esc(ev.name)} are now on sale: ${esc(shareUrl(ev.slug, 'waitlist'))}">${esc(S.ui.wlMsg || '')}</textarea>
      <button class="btn btn-dark" style="margin-top:10px" data-action="notifyWL" ${waiting.length ? '' : 'disabled'}>Notify ${waiting.length}</button>
      <p class="small muted" style="margin-top:8px">${DB.live ? 'Email delivery is connected in Stage 8; until then this records the notice.' : 'Demo: recorded, not emailed.'}</p>` : ''}</div>
  <div class="card" style="padding:0"><div class="between" style="padding:16px 20px 8px"><h3>${wl.length} on the waitlist</h3>${wl.length && can('customers.export') ? `<button class="btn btn-ghost btn-sm" data-action="exportWL" data-id="${ev.id}">Export CSV</button>` : ''}</div>
    <table class="tbl"><thead><tr><th>Name</th><th>Contact</th><th>Joined</th><th>Notified</th></tr></thead><tbody>
    ${wl.map(w => `<tr><td><b>${esc(w.name || '—')}</b></td><td class="small">${esc(w.email)}${w.phone ? '<br>' + esc(w.phone) : ''}</td><td class="small muted">${esc(fmtDT(w.created_at))}</td><td class="small">${w.notified_at ? esc(ago(w.notified_at)) : '<span class="muted">waiting</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nobody yet.</td></tr>'}</tbody></table></div></div>`;
}
function EdTeam(ev) {
  const team = S.adm.team.slice().sort((a, b) => (b.owner - a.owner) || (a.name || a.email).localeCompare(b.name || b.email)), edit = can('admin.perms');
  const has = m => m.owner || m.events === 'all' || (m.events || []).includes(ev.id);
  return `<p class="muted" style="margin:-4px 0 16px;max-width:680px">Who on the team can work on this event. What they can <i>do</i> is set by their permissions on the <a href="#/admin/team">Team</a> page; here you choose whether this event is included.</p>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Member</th><th>Permissions</th><th>Access to this event</th></tr></thead><tbody>
  ${team.map(m => `<tr><td><b>${esc(m.name || m.email)}</b><div class="small muted">${esc(m.email)}</div></td><td>${accessLabel(m)}</td><td>
    ${m.owner ? '<span class="chip ok">Always (owner)</span>' : m.events === 'all' ? `<span class="chip ok">Yes — all events</span>${edit && m.email !== S.adm.me.email ? ` <button class="btn btn-ghost btn-sm" data-action="evAccess" data-v="${esc(m.email)}" data-on="0">Limit to other events</button>` : ''}`
      : has(m) ? `<span class="chip ok">Yes</span>${edit && m.email !== S.adm.me.email ? ` <button class="btn btn-ghost btn-sm" data-action="evAccess" data-v="${esc(m.email)}" data-on="0">Remove</button>` : ''}`
      : `<span class="chip">No</span>${edit && m.email !== S.adm.me.email ? ` <button class="btn btn-ghost btn-sm" data-action="evAccess" data-v="${esc(m.email)}" data-on="1">Add to this event</button>` : ''}`}</td></tr>`).join('')}</tbody></table></div>
  ${!edit ? '<p class="small muted" style="margin-top:10px">You need “Edit team permissions” to change access.</p>' : ''}`;
}
function EdHistory(ev) {
  const list = (S.adm.audit || []).filter(a => a.target === ev.id);
  return `<p class="muted" style="margin:-4px 0 16px">Every change to this event — dates, venue, capacity, status, visibility, ticket settings and prices, showtimes and seating — with who made it and the before/after values.</p>${AuditTable(list)}`;
}

// ── Event editor ─────────────────────────────────────────────────────────────
const inp = (path, label, o = {}) => {
  const v = getPath(S.draft, path), t = o.t || 'text';
  const val = t === 'money' ? (v == null || v === '' ? '' : (+v / 100).toFixed(2).replace(/\.00$/, '')) : t === 'dt' ? toLocalInput(v) : (v ?? '');
  const type = t === 'money' || t === 'int' || t === 'num' ? 'number' : t === 'dt' ? 'datetime-local' : t;
  return `<div class="field ${o.cls || ''}">${label ? `<label class="fl">${label}</label>` : ''}${t === 'area'
    ? `<textarea class="inp" data-bind="draft.${path}" ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} ${o.ro ? 'readonly' : ''}>${esc(val)}</textarea>`
    : `<input class="inp" type="${type}" data-bind="draft.${path}" data-t="${t}" value="${esc(val)}" ${t === 'money' ? 'step="0.01" min="0"' : t === 'int' ? 'step="1" min="0"' : ''} ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} ${o.ro ? 'readonly' : ''}>`}${o.hint ? `<div class="small muted" style="margin-top:4px">${o.hint}</div>` : ''}</div>`;
};
const chk = (path, label) => `<label class="check"><input type="checkbox" data-bind="draft.${path}" data-t="bool" ${getPath(S.draft, path) ? 'checked' : ''}> <span>${label}</span></label>`;
const sel = (path, label, opts) => `<div class="field">${label ? `<label class="fl">${label}</label>` : ''}<select class="inp" data-bind="draft.${path}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(getPath(S.draft, path) ?? '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;

function EdTickets(ev) {
  const sold = evStats(ev), av = availabilityFrom(S.adm.tickets, ev.id);
  return `<div class="between" style="margin-bottom:14px"><p class="muted">${sold.sold} sold. Ticket types, prices, limits and sale windows.</p><button type="button" class="btn btn-dark btn-sm" data-action="addTT">${ic('plus', 14)} Add ticket type</button></div>
  ${ev.ticketTypes.map((t, i) => `<div class="item-card"><div class="between" style="margin-bottom:10px"><div class="row"><b>${esc(t.name || 'Ticket')}</b><span class="chip">${av.tt[t.id] || 0} sold</span>${t.hidden ? '<span class="chip info">Hidden</span>' : ''}</div>
    <div class="row"><button type="button" class="icon-btn" data-action="moveTT" data-i="${i}" data-d="-1" aria-label="Move up">↑</button><button type="button" class="icon-btn" data-action="delTT" data-i="${i}" aria-label="Remove">${ic('x', 14)}</button></div></div>
    <div class="grid3">${inp(`ticketTypes.${i}.name`, 'Name')}${inp(`ticketTypes.${i}.price`, 'Price', { t: 'money' })}${inp(`ticketTypes.${i}.qty`, 'Quantity', { t: 'int', hint: '0 = unlimited' })}</div>
    <div class="grid3">${inp(`ticketTypes.${i}.min`, 'Min per order', { t: 'int' })}${inp(`ticketTypes.${i}.max`, 'Max per order', { t: 'int' })}${inp(`ticketTypes.${i}.admits`, 'Admits (bundle size)', { t: 'int' })}</div>
    ${inp(`ticketTypes.${i}.desc`, 'Description')}
    <div class="grid3">${inp(`ticketTypes.${i}.salesStart`, 'On sale from', { t: 'dt' })}${inp(`ticketTypes.${i}.salesEnd`, 'Off sale at', { t: 'dt' })}${inp(`secrets.ticketPasswords.${t.id}`, 'Access code', { hint: 'Hidden types appear only with this code' })}</div>
    ${chk(`ticketTypes.${i}.hidden`, 'Hidden — only visible with the access code')}
  </div>`).join('')}`;
}
function soldSeatIds(ev) { return S.adm.tickets.filter(t => t.event_id === ev.id && t.status === 'valid' && t.seat).map(t => t.seat); }
function EdSeating(ev) {
  const st = ev.seating || (ev.seating = { enabled: false });
  if (!st.enabled) return `<div class="card"><div class="sm-intro">${ic('ticket', 28)}<div><h3>Reserved seating</h3><p class="muted">Build your room — sections, rows and tables — then assign prices. Buyers pick their exact seats on a map.</p>
    <div style="margin-top:14px">${chk('seating.enabled', '<b>Turn on reserved seating for this event</b>')}</div></div></div></div>`;
  st.sections ||= []; st.prices ||= {}; st.blocked ||= []; st.stage ||= { x: -150, y: -120, w: 300, h: 46, label: 'STAGE' };
  const L = layoutOf(st), mode = S.ui.smMode || 'move', sold = new Set(soldSeatIds(ev));
  const i = st.sections.findIndex(x => x.id === S.ui.smSel), sec = st.sections[i];
  const counts = {}; L.seats.forEach(p => { if (!st.blocked.includes(p.id)) counts[p.tt || ''] = (counts[p.tt || ''] || 0) + 1; });
  const hint = { move: 'Drag sections and the stage to arrange your room. Click a section to edit it.', paint: 'Pick a price, then click or drag across seats. Click a row letter to price the whole row.', block: 'Click or drag across seats to block them (pillars, sound desk, holds). Click again to unblock.' }[mode];
  return `<div class="sm-wrap">
    <div class="card sm-main">
      <div class="sm-toolbar">
        <div class="tabs">${[['move', 'Arrange'], ['paint', 'Assign prices'], ['block', 'Block seats']].map(([k, t]) => `<button type="button" class="${mode === k ? 'on' : ''}" data-action="smMode" data-v="${k}">${t}</button>`).join('')}</div>
        <div class="row wrap"><button type="button" class="btn btn-ghost btn-sm" data-action="smAdd" data-v="rows">${ic('plus', 14)} Seated section</button><button type="button" class="btn btn-ghost btn-sm" data-action="smAdd" data-v="table">${ic('plus', 14)} Table</button></div>
      </div>
      ${mode === 'paint' ? `<div class="sm-palette">${ev.ticketTypes.map(t => `<button type="button" class="${(S.ui.smPaint ?? ev.ticketTypes[0]?.id) === t.id ? 'on' : ''}" data-action="smPaint" data-v="${t.id}"><i style="background:${tierColor(ev, t.id)}"></i>${esc(t.name)} · ${money(t.price, ev.currency)}</button>`).join('')}
        <button type="button" class="${S.ui.smPaint === '' ? 'on' : ''}" data-action="smPaint" data-v=""><i style="background:#fff;border:1.5px dashed #999"></i>Section default</button>
        <a class="small" href="#/admin/event/${ev.id}/tickets">Add a price level →</a></div>` : ''}
      <p class="small muted" style="margin:8px 0 6px">${hint}</p>
      ${st.sections.length ? `<div class="sm-canvas">${SeatCanvas(ev, { mode, selected: S.ui.smSel, sold })}</div>` : `<div class="sm-empty"><h3>Start from a layout</h3><p class="muted small" style="margin:4px 0 16px">You can change everything afterwards.</p><div class="sm-tpls">
        ${[['theatre', 'Theatre', 'Centre + side stalls and a curved circle'], ['banquet', 'Banquet', '12 round tables of 10'], ['hall', 'Hall', 'One block of straight rows']].map(([k, t, d]) => `<button type="button" class="sm-tpl" data-action="smTemplate" data-v="${k}"><b>${t}</b><span>${d}</span></button>`).join('')}
        <button type="button" class="sm-tpl" data-action="smAdd" data-v="rows"><b>Blank</b><span>Add sections yourself</span></button></div></div>`}
      <div class="legend" style="margin-top:12px">${ev.ticketTypes.filter(t => counts[t.id]).map(t => `<span><i style="background:${tierColor(ev, t.id)}"></i>${esc(t.name)} ${money(t.price, ev.currency)} · <b>${counts[t.id]}</b> seats</span>`).join('')}
        ${counts[''] ? `<span style="color:var(--warn)"><i style="background:#c9c5ba"></i>${counts['']} seats have no price (not sold)</span>` : ''}${st.blocked.length ? `<span><i style="border:1.5px dashed #999"></i>${st.blocked.length} blocked</span>` : ''}${sold.size ? `<span><i style="background:#d7d4cb"></i>${sold.size} sold</span>` : ''}</div>
    </div>
    <div class="card sm-panel">${sec ? SectionPanel(ev, sec, i, sold) : `
      <h3>Room</h3><p class="small muted" style="margin:4px 0 14px">${L.seats.length - st.blocked.length} sellable seats in ${st.sections.length} section${st.sections.length === 1 ? '' : 's'}.</p>
      ${inp('seating.stage.label', 'Stage label')}<div class="grid2">${inp('seating.stage.w', 'Stage width', { t: 'int' })}${inp('seating.stage.h', 'Stage depth', { t: 'int' })}</div>
      <div class="sep"></div><div class="eyebrow" style="margin-bottom:8px">Sections</div>
      ${st.sections.map(x => `<button type="button" class="sm-li" data-action="smSel" data-id="${x.id}"><i style="background:${tierColor(ev, x.ticketTypeId)}"></i><b>${esc(x.name)}</b><span>${esc(x.code)} · ${layoutOf(st).seats.filter(p => p.sec.id === x.id).length} seats</span></button>`).join('') || '<p class="small muted">No sections yet.</p>'}
      <div class="sep"></div>${chk('seating.enabled', 'Reserved seating on')}`}
    </div></div>`;
}
function SectionPanel(ev, sec, i, sold) {
  const P = `seating.sections.${i}`, hasSold = [...sold].some(id => id.startsWith(sec.code + '-'));
  const overrides = Object.keys(ev.seating.prices || {}).filter(k => k.startsWith(sec.code + '-')).length;
  const rows = Math.max(1, +sec.rows || 1);
  return `<div class="between"><button type="button" class="small muted sm-backlink" data-action="smDeselect">← Room</button><div class="row"><button type="button" class="btn btn-ghost btn-sm" data-action="smDup">Duplicate</button><button type="button" class="btn btn-danger btn-sm" data-action="smDel">Delete</button></div></div>
    <h3 style="margin:12px 0 12px">${esc(sec.name)}</h3>
    <div class="grid2">${inp(`${P}.name`, 'Section name')}${inp(`${P}.code`, 'Code', { ro: hasSold, hint: hasSold ? 'Locked — seats sold' : 'Prefix on seat IDs' })}</div>
    ${sel(`${P}.ticketTypeId`, 'Price for this section', [['', '— not for sale —'], ...ev.ticketTypes.map(t => [t.id, `${t.name} · ${money(t.price, ev.currency)}`])])}
    ${overrides ? `<div class="banner info" style="display:flex;justify-content:space-between;align-items:center">${overrides} seats have their own price<button type="button" class="btn btn-ghost btn-sm" data-action="smClearPrices">Reset</button></div>` : ''}
    ${sec.kind === 'table' ? inp(`${P}.seats`, 'Seats at table', { t: 'int' }) : `
      <div class="grid2">${inp(`${P}.rows`, 'Rows', { t: 'int' })}${inp(`${P}.seatsPerRow`, 'Seats per row', { t: 'int' })}</div>
      <div class="grid2">${inp(`${P}.rowStart`, 'First row', { hint: 'A, or 1 for numbers' })}<div class="field"><label class="fl">Seat numbers</label>${chk(`${P}.reverse`, 'Right to left')}</div></div>
      <div class="field"><label class="fl">Curve <span class="muted">${+sec.curve || 0}%</span></label><input type="range" min="0" max="100" step="5" data-bind="draft.${P}.curve" data-t="int" value="${+sec.curve || 0}" class="range"></div>
      <details class="sm-rows"${sec.rowSeats?.some(Boolean) ? ' open' : ''}><summary>Seats in each row</summary><p class="small muted" style="margin:6px 0 8px">Make rows shorter or longer. Blank = ${+sec.seatsPerRow || 10}.</p>
        <div class="sm-rowgrid">${Array.from({ length: rows }, (_, r) => `<label><span>${esc(rowLabel(sec.rowStart || 'A', r))}</span><input class="inp" type="number" min="1" data-bind="draft.${P}.rowSeats.${r}" data-t="int" value="${(sec.rowSeats || [])[r] || ''}" placeholder="${+sec.seatsPerRow || 10}"></label>`).join('')}</div>
        ${sec.rowSeats?.some(Boolean) ? '<button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px" data-action="smEqualRows">Make all rows equal</button>' : ''}</details>`}
    <div class="field" style="margin-top:12px"><label class="fl">Rotate <span class="muted">${+sec.rot || 0}°</span></label><input type="range" min="-45" max="45" step="1" data-bind="draft.${P}.rot" data-t="int" value="${+sec.rot || 0}" class="range"></div>`;
}
function nextCode(prefix) { const used = new Set(S.draft.seating.sections.map(x => x.code)); let n = 1; while (used.has(prefix + n)) n++; return prefix + n; }
function addSection(kind) {
  const st = S.draft.seating, b = st.sections.length ? layoutOf(st).bounds : { y1: -40, x0: 0 };
  const sec = kind === 'table'
    ? { id: shortId('sec_'), code: nextCode('T'), name: 'Table ' + nextCode('T').slice(1), kind: 'table', seats: 10, x: 0, y: b.y1 + 70, rot: 0, ticketTypeId: S.draft.ticketTypes[0]?.id || '' }
    : { id: shortId('sec_'), code: nextCode('S'), name: 'Section ' + (st.sections.length + 1), kind: 'rows', rows: 5, seatsPerRow: 10, rowStart: 'A', curve: 0, x: -117, y: b.y1 + 60, rot: 0, ticketTypeId: S.draft.ticketTypes[0]?.id || '' };
  st.sections.push(sec); S.ui.smSel = sec.id; S.ui.smMode = 'move'; dirty(); render();
}
function applySeatTemplate(k) {
  const st = S.draft.seating, T = S.draft.ticketTypes, t = n => (T[n] || T[T.length - 1] || {}).id || '', id = () => shortId('sec_');
  st.prices = {}; st.blocked = []; st.stage = { x: -170, y: -120, w: 340, h: 46, label: 'STAGE' };
  if (k === 'theatre') st.sections = [
    { id: id(), code: 'LFT', name: 'Stalls left', kind: 'rows', x: -365, y: 18, rot: 9, rows: 8, seatsPerRow: 6, rowStart: 'A', ticketTypeId: t(1) },
    { id: id(), code: 'CEN', name: 'Stalls centre', kind: 'rows', x: -169, y: 0, rot: 0, rows: 8, seatsPerRow: 14, rowStart: 'A', curve: 25, ticketTypeId: t(0) },
    { id: id(), code: 'RGT', name: 'Stalls right', kind: 'rows', x: 235, y: 18, rot: -9, rows: 8, seatsPerRow: 6, rowStart: 'A', ticketTypeId: t(1) },
    { id: id(), code: 'CIR', name: 'Circle', kind: 'rows', x: -299, y: 320, rot: 0, rows: 3, seatsPerRow: 24, rowStart: 'J', curve: 40, ticketTypeId: t(2) }];
  if (k === 'banquet') { st.stage = { x: -200, y: -150, w: 400, h: 46, label: 'STAGE' }; st.sections = Array.from({ length: 12 }, (_, n) => ({ id: id(), code: 'T' + (n + 1), name: 'Table ' + (n + 1), kind: 'table', seats: 10, x: -330 + (n % 4) * 220, y: Math.floor(n / 4) * 200, rot: 0, ticketTypeId: n < 4 ? t(0) : t(1) })); }
  if (k === 'hall') st.sections = [{ id: id(), code: 'H', name: 'Hall', kind: 'rows', x: -247, y: 0, rot: 0, rows: 12, seatsPerRow: 20, rowStart: 'A', ticketTypeId: t(0) }];
  S.ui.smSel = ''; dirty(); render();
}
// Designer pointer interactions: drag sections/stage (Arrange), paint/block seats by click or drag.
let SM = null;
function svgPt(svg, e) { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }
function smApply(el) {
  const st = S.draft.seating, id = el.dataset.seat;
  if (SM.kind === 'block') { const b = new Set(st.blocked); SM.val ? b.add(id) : b.delete(id); st.blocked = [...b]; el.classList.toggle('blk', SM.val); el.setAttribute('fill', SM.val ? 'none' : el.dataset.fill || el.getAttribute('fill')); }
  else { const p = layoutOf(st).seats.find(x => x.id === id); if (!SM.val || SM.val === p?.sec.ticketTypeId) delete st.prices[id]; else st.prices[id] = SM.val; el.setAttribute('fill', tierColor(S.draft, SM.val || p?.sec.ticketTypeId)); }
  SM.changed = true;
}
document.addEventListener('pointerdown', e => {
  const svg = e.target.closest?.('svg.sm-design'); if (!svg || !S.draft) return;
  const mode = S.ui.smMode || 'move', st = S.draft.seating;
  if (mode === 'move') {
    const secEl = e.target.closest('[data-sec]'), stgEl = e.target.closest('[data-stage]');
    const target = secEl ? st.sections.find(x => x.id === secEl.dataset.sec) : stgEl ? st.stage : null;
    if (!target) { if (S.ui.smSel) { S.ui.smSel = ''; render(); } return; }
    const p = svgPt(svg, e); SM = { kind: 'drag', svg, el: secEl || stgEl, target, sx: p.x, sy: p.y, ox: +target.x || 0, oy: +target.y || 0, moved: false, secId: secEl?.dataset.sec || '' };
    e.preventDefault(); return;
  }
  const rowEl = e.target.closest('[data-row]');
  if (rowEl) { const [secId, row] = rowEl.dataset.row.split('|'); const ids = layoutOf(st).seats.filter(p => p.sec.id === secId && p.row === row).map(p => p.id);
    SM = { kind: mode, val: mode === 'block' ? !ids.every(x => st.blocked.includes(x)) : (S.ui.smPaint ?? S.draft.ticketTypes[0]?.id ?? '') };
    ids.forEach(x => { const el = svg.querySelector(`[data-seat="${CSS.escape(x)}"]`); if (el) smApply(el); }); SM = null; dirty(); render(); return; }
  const seatEl = e.target.closest('[data-seat]'); if (!seatEl) return;
  SM = { kind: mode, svg, val: mode === 'block' ? !st.blocked.includes(seatEl.dataset.seat) : (S.ui.smPaint ?? S.draft.ticketTypes[0]?.id ?? '') };
  smApply(seatEl); e.preventDefault();
});
document.addEventListener('pointermove', e => {
  if (!SM) return;
  if (SM.kind === 'drag') {
    const p = svgPt(SM.svg, e), dx = p.x - SM.sx, dy = p.y - SM.sy;
    if (!SM.moved && Math.abs(dx) + Math.abs(dy) < 4) return; SM.moved = true;
    SM.target.x = Math.round((SM.ox + dx) / 5) * 5; SM.target.y = Math.round((SM.oy + dy) / 5) * 5;
    SM.el.setAttribute('transform', SM.el.getAttribute('transform').replace(/translate\([^)]*\)/, `translate(${SM.target.x} ${SM.target.y})`));
    return;
  }
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-seat]');
  if (el && SM.svg.contains(el)) smApply(el);
});
document.addEventListener('pointerup', () => {
  if (!SM) return; const m = SM; SM = null;
  if (m.kind === 'drag') { if (m.moved) dirty(); else S.ui.smSel = m.secId; render(); }
  else if (m.changed) { dirty(); render(); }
});
function EdCheckout(ev) {
  return `<div class="cols"><div class="card"><div class="between" style="margin-bottom:10px"><h3>Checkout questions</h3><button type="button" class="btn btn-ghost btn-sm" data-action="addQ">${ic('plus', 14)} Add question</button></div>
    <p class="small muted" style="margin-bottom:12px">Collected once per order. Answers appear on orders and exports.</p>
    ${(ev.questions || []).map((q, i) => `<div class="item-card"><div class="grid2">${inp(`questions.${i}.label`, 'Question')}${sel(`questions.${i}.type`, 'Type', [['text', 'Text'], ['select', 'Dropdown'], ['checkbox', 'Checkbox']])}</div>
      ${q.type === 'select' ? inp(`questions.${i}.options`, 'Options (comma-separated)') : ''}<div class="between">${chk(`questions.${i}.required`, 'Required')}<button type="button" class="btn btn-ghost btn-sm" data-action="delQ" data-i="${i}">Remove</button></div></div>`).join('') || '<p class="muted">No questions.</p>'}
  </div><div class="card"><div class="between" style="margin-bottom:10px"><h3>Add-ons & merchandise</h3><button type="button" class="btn btn-ghost btn-sm" data-action="addAddon">${ic('plus', 14)} Add product</button></div>
    <p class="small muted" style="margin-bottom:12px">Programs, parking, merch — sold alongside tickets.</p>
    ${(ev.addons || []).map((a, i) => `<div class="item-card"><div class="grid2">${inp(`addons.${i}.name`, 'Product')}${inp(`addons.${i}.price`, 'Price', { t: 'money' })}</div><button type="button" class="btn btn-ghost btn-sm" data-action="delAddon" data-i="${i}">Remove</button></div>`).join('') || '<p class="muted">No add-ons.</p>'}
  </div></div>`;
}
function EdDiscounts(ev) {
  const ds = ev.secrets.discounts || (ev.secrets.discounts = []);
  const used = c => S.adm.orders.filter(o => ['paid', 'pending'].includes(o.status) && o.event_ids.includes(ev.id) && (o.data.code || '').toUpperCase() === String(c).toUpperCase());
  return `<div class="between" style="margin-bottom:14px"><p class="muted">Discount and voucher codes. Codes are never visible to buyers until they type them.</p><button type="button" class="btn btn-dark btn-sm" data-action="addDisc">${ic('plus', 14)} New code</button></div>
  ${ds.map((d, i) => { const u = used(d.code); return `<div class="item-card"><div class="between" style="margin-bottom:10px"><div class="row"><b class="tnum" style="letter-spacing:.06em">${esc(d.code)}</b><span class="chip">${u.length}${+d.limit ? ' / ' + d.limit : ''} used</span><span class="chip ok">${money(sum(u, o => o.data.discount))} given</span></div><button type="button" class="icon-btn" data-action="delDisc" data-i="${i}">${ic('x', 14)}</button></div>
    <div class="grid3">${inp(`secrets.discounts.${i}.code`, 'Code')}${sel(`secrets.discounts.${i}.type`, 'Type', [['pct', 'Percent off'], ['fixed', 'Amount off']])}${d.type === 'pct' ? inp(`secrets.discounts.${i}.amount`, 'Percent', { t: 'num' }) : inp(`secrets.discounts.${i}.amount`, 'Amount', { t: 'money' })}</div>
    <div class="grid3">${inp(`secrets.discounts.${i}.limit`, 'Max uses', { t: 'int', hint: '0 = unlimited' })}${inp(`secrets.discounts.${i}.expires`, 'Expires', { t: 'dt' })}<div class="field"><label class="fl">Applies to</label>${ev.ticketTypes.map(t => `<label class="check small"><input type="checkbox" data-action="discTT" data-i="${i}" data-id="${t.id}" ${(d.ticketTypeIds || []).includes(t.id) ? 'checked' : ''}> ${esc(t.name)}</label>`).join('')}<div class="small muted">None checked = all</div></div></div></div>`; }).join('') || '<div class="card empty">No codes yet.</div>'}`;
}
function EdEmails(ev) {
  const wl = S.adm.waitlist.filter(w => w.event_id === ev.id), holders = new Set(S.adm.tickets.filter(t => t.event_id === ev.id && t.status === 'valid').map(t => S.adm.orders.find(o => o.id === t.order_id)?.buyer_email));
  const b = S.ui.bc || (S.ui.bc = { subject: '', body: '' });
  return `<div class="cols"><div class="stack">
    <div class="card"><h3>Order confirmation</h3><p class="small muted" style="margin-bottom:10px">Extra message included in every confirmation email for this event.</p>${inp('emails.confirmation', '', { t: 'area', ph: 'e.g. Parking is on 38th St. Please arrive 20 minutes early.' })}</div>
    <div class="card"><h3>Email ticket holders</h3><p class="small muted" style="margin-bottom:12px">Send an update to all ${holders.size} buyers for this event.</p>
      <div class="field"><input class="inp" data-input="bc.subject" placeholder="Subject" value="${esc(b.subject)}"></div><div class="field"><textarea class="inp" data-input="bc.body" placeholder="Message">${esc(b.body)}</textarea></div>
      <button type="button" class="btn btn-dark" data-action="broadcast" data-n="${holders.size}">Send to ${holders.size} buyers</button>
      ${S.adm.broadcasts.filter(x => x.event_id === ev.id).map(x => `<div class="small muted" style="margin-top:10px">“${esc(x.subject)}” · ${x.recipients} recipients · ${esc(ago(x.created_at))}</div>`).join('')}</div>
    <div class="card"><div class="between"><h3>Automatic reminders</h3><button type="button" class="btn btn-ghost btn-sm" data-action="addRem">${ic('plus', 14)} Add</button></div>
      ${(ev.emails?.reminders || []).map((r, i) => `<div class="item-card" style="margin-top:10px"><div class="grid2">${inp(`emails.reminders.${i}.hoursBefore`, 'Hours before start', { t: 'int' })}${sel(`emails.reminders.${i}.channel`, 'Channel', [['email', 'Email'], ['sms', 'Text message'], ['whatsapp', 'WhatsApp']])}</div>${inp(`emails.reminders.${i}.body`, 'Message', { t: 'area' })}<button type="button" class="btn btn-ghost btn-sm" data-action="delRem" data-i="${i}">Remove</button></div>`).join('') || '<p class="small muted" style="margin-top:8px">No reminders scheduled.</p>'}</div>
  </div></div>`;
}
function EdShare(ev) {
  const url = shareUrl(ev.slug), embed = location.origin + location.pathname + '#/embed/' + ev.slug;
  return `<div class="cols"><div class="stack">
    <div class="card"><h3>Event link</h3><div class="row" style="margin-top:10px"><input class="inp" readonly value="${esc(url)}"><button type="button" class="btn btn-dark" data-action="copyLink" data-v="${esc(url)}">Copy</button></div>
      <div class="row wrap" style="margin-top:12px"><a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(ev.name + ' ' + url)}">WhatsApp</a>
      <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}">Facebook</a>
      <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(ev.name)}">X</a>
      <a class="btn btn-ghost btn-sm" href="mailto:?subject=${encodeURIComponent(ev.name)}&body=${encodeURIComponent(url)}">Email</a></div></div>
    <div class="card"><h3>Embed on your website</h3><p class="small muted" style="margin:4px 0 10px">Paste into any website builder (Webflow, Wix, Squarespace, WordPress) as an HTML/embed block. Full checkout inside your site.</p>
      <pre class="code">&lt;iframe src="${esc(embed)}" style="width:100%;min-height:900px;border:0" title="${esc(ev.name)} tickets"&gt;&lt;/iframe&gt;</pre>
      <p class="small muted" style="margin:12px 0 8px">Or a "Buy tickets" button:</p><pre class="code">&lt;a href="${esc(url)}" style="background:#f4cd5e;color:#2a2006;padding:14px 26px;border-radius:999px;font-weight:700;text-decoration:none"&gt;Buy tickets&lt;/a&gt;</pre></div>
    <div class="card"><h3>Tracking links</h3><p class="small muted" style="margin:4px 0 10px">Tag links per channel — Reports shows sales by source.</p>
      ${['instagram', 'whatsapp', 'newsletter', 'poster'].map(s => `<div class="row" style="margin-bottom:6px"><span class="chip" style="width:96px;justify-content:center">${s}</span><input class="inp" readonly value="${esc(shareUrl(ev.slug, s))}"></div>`).join('')}</div>
  </div><div class="card" style="text-align:center"><h3>Event QR code</h3><p class="small muted" style="margin-bottom:16px">For posters and flyers.</p><div class="qr" style="display:inline-block" data-qr="${esc(shareUrl(ev.slug, 'poster'))}"></div>
    <div style="margin-top:14px"><button type="button" class="btn btn-ghost btn-sm" data-action="print">Print</button></div></div></div>`;
}

// ── Orders ───────────────────────────────────────────────────────────────────
function filteredOrders() {
  const q = S.ui.q.trim().toLowerCase();
  return S.adm.orders.filter(o => (!S.ui.ev || o.event_ids.includes(S.ui.ev)) && (!S.ui.status || o.status === S.ui.status)
    && (!q || [o.ref, o.data.buyer.name, o.buyer_email, o.data.buyer.phone].join(' ').toLowerCase().includes(q))).sort((a, b) => D(b.created_at) - D(a.created_at));
}
const evOptions = (cur, all = 'All events') => `<option value="">${all}</option>${S.adm.events.slice().sort((a, b) => D(b.start) - D(a.start)).map(e => `<option value="${e.id}" ${cur === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}`;
function Orders() {
  const os = filteredOrders(), picked = Object.keys(S.ui.picked).filter(k => S.ui.picked[k]);
  return head('Orders', `${os.length} orders · ${money(sum(os.filter(o => ['paid', 'pending'].includes(o.status)), o => o.data.total))}`,
    `${can('customers.export') ? '<button class="btn btn-ghost" data-action="exportOrders">Export CSV</button>' : ''}${can('orders.edit') ? `<button class="btn btn-accent" data-action="manualOrder">${ic('plus', 15)} Manual order</button>` : ''}`) + `
  <div class="toolbar"><input class="inp" data-input="q" placeholder="Search name, email, order #…" value="${esc(S.ui.q)}">
    <select class="inp" data-input="ev">${evOptions(S.ui.ev)}</select>
    <select class="inp" data-input="status"><option value="">Any status</option>${['paid', 'pending', 'cancelled', 'refunded'].map(s => `<option ${S.ui.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    ${picked.length && can('orders.refund') ? `<button class="btn btn-danger btn-sm" data-action="bulkCancel">Cancel & refund ${picked.length} selected</button>` : ''}</div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:30px"></th><th>Order</th><th>Buyer</th><th>Event</th><th>Tickets</th><th>Total</th><th>Status</th><th>Placed</th></tr></thead><tbody>
  ${os.slice(0, 300).map(o => `<tr class="click" data-action="openOrder" data-id="${o.id}"><td data-stop="1"><input type="checkbox" data-action="pick" data-id="${o.id}" ${S.ui.picked[o.id] ? 'checked' : ''}></td>
    <td class="tnum"><b>${esc(o.ref)}</b></td><td>${esc(o.data.buyer.name)}<div class="small muted">${esc(o.buyer_email)}</div></td>
    <td>${esc([...new Set(o.data.lines.map(l => l.eventName).filter(Boolean))].join(', '))}</td><td class="tnum">${sum(o.data.lines.filter(l => l.kind === 'ticket'), l => l.qty * l.admits)}</td>
    <td class="tnum">${money(o.data.total, o.data.currency)}</td><td>${statusChip(o.status)}</td><td class="small muted">${esc(fmtDT(o.created_at))}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No orders match.</td></tr>'}
  </tbody></table></div>`;
}
function OrderModal(id) {
  const o = S.adm.orders.find(x => x.id === id); if (!o) return;
  const d = o.data, tks = S.adm.tickets.filter(t => t.order_id === id), qs = o.event_ids.flatMap(e => evById(e)?.questions || []);
  modal(`Order ${esc(o.ref)}`, `<div class="between"><div><b style="font-size:16px">${esc(d.buyer.name)}</b><div class="muted small">${esc(o.buyer_email)}${d.buyer.phone ? ' · ' + esc(d.buyer.phone) : ''}</div></div>${statusChip(o.status)}</div>
    <div class="small muted" style="margin-top:6px">${esc(fmtDT(o.created_at))} · ${esc(d.payment)}${d.source ? ' · source: ' + esc(d.source) : ''}${d.optIn ? ' · opted in to marketing' : ''}</div>
    <div class="sep"></div>${d.lines.map(l => `<div class="sum-line"><span>${l.qty} × ${esc(l.name)} <span class="muted">${esc(l.eventName || '')}${l.slotStart ? ' @ ' + esc(fmtTime(l.slotStart)) : ''}</span></span><span>${money(l.unit == null ? null : l.unit * l.qty, d.currency)}</span></div>`).join('')}
    ${d.discount ? `<div class="sum-line"><span>Discount ${esc(d.code)}</span><span>−${money(d.discount, d.currency)}</span></div>` : ''}${d.fee ? `<div class="sum-line"><span>Fees</span><span>${money(d.fee, d.currency)}</span></div>` : ''}${d.tax ? `<div class="sum-line"><span>Tax</span><span>${money(d.tax, d.currency)}</span></div>` : ''}${d.donation ? `<div class="sum-line"><span>Donation</span><span>${money(d.donation, d.currency)}</span></div>` : ''}
    <div class="sum-line total"><span>Total</span><span>${money(d.total, d.currency)}</span></div>
    ${qs.length ? `<div class="sep"></div>${qs.map(q => `<div class="small"><span class="muted">${esc(q.label)}:</span> ${esc(d.answers?.[q.id] === true ? 'Yes' : d.answers?.[q.id] || '—')}</div>`).join('')}` : ''}
    <div class="sep"></div><div class="eyebrow" style="margin-bottom:8px">Tickets</div>
    ${tks.map(t => `<div class="between small" style="padding:6px 0;border-bottom:1px solid var(--line)"><span class="tnum"><b>${esc(t.code)}</b> ${t.seat ? '· ' + esc(seatName(evById(t.event_id), t.seat, true)) : ''}</span><span>${t.status !== 'valid' ? '<span class="chip bad">void</span>' : t.checked_in_at ? '<span class="chip ok">in ' + esc(fmtTime(t.checked_in_at)) + '</span>' : '<span class="chip">not in</span>'}</span></div>`).join('')}`,
    `<a class="btn btn-ghost btn-sm" target="_blank" href="#/order/${o.id}/${o.access_key || ''}">Buyer's page</a>
     <button class="btn btn-ghost btn-sm" data-action="resend" data-id="${o.id}">Resend tickets</button>
     ${can('orders.edit', o.event_ids[0]) && o.status === 'pending' ? `<button class="btn btn-dark btn-sm" data-action="orderStatus" data-id="${o.id}" data-v="paid">Mark paid</button>` : ''}
     ${can(o.status === 'paid' ? 'orders.refund' : 'orders.cancel', o.event_ids[0]) && ['paid', 'pending'].includes(o.status) ? `<button class="btn btn-danger btn-sm" data-action="orderStatus" data-id="${o.id}" data-v="${o.status === 'paid' ? 'refunded' : 'cancelled'}">${o.status === 'paid' ? 'Refund & cancel' : 'Cancel'}</button>` : ''}`);
}
function ManualOrderModal() {
  const m = S.ui.mo || (S.ui.mo = { ev: S.adm.events[0]?.id, tt: '', qty: 1, slot: '', name: '', email: '', status: 'paid' });
  const ev = S.adm.events.find(e => e.id === m.ev);
  modal('Manual order', `<p class="small muted" style="margin-bottom:14px">Comp tickets, phone sales or box-office cash. Seats are assigned automatically for seated events.</p>
    <div class="field"><label class="fl">Event</label><select class="inp" data-input="mo.ev" data-rerender="1">${evOptions(m.ev, 'Choose…')}</select></div>
    ${ev ? `<div class="grid2"><div class="field"><label class="fl">Ticket type</label><select class="inp" data-input="mo.tt">${ev.ticketTypes.map(t => `<option value="${t.id}" ${m.tt === t.id ? 'selected' : ''}>${esc(t.name)} — ${money(t.price)}</option>`).join('')}</select></div>
      <div class="field"><label class="fl">Quantity</label><input class="inp" type="number" min="1" data-input="mo.qty" value="${esc(m.qty)}"></div></div>
      ${ev.timeSlots?.length ? `<div class="field"><label class="fl">Time slot</label><select class="inp" data-input="mo.slot">${ev.timeSlots.map(s => `<option value="${s.id}" ${m.slot === s.id ? 'selected' : ''}>${esc(fmtDT(s.start))}</option>`).join('')}</select></div>` : ''}` : ''}
    <div class="grid2"><div class="field"><label class="fl">Buyer name</label><input class="inp" data-input="mo.name" value="${esc(m.name)}"></div><div class="field"><label class="fl">Buyer email</label><input class="inp" data-input="mo.email" value="${esc(m.email)}"></div></div>
    ${ev && can('tickets.comps', ev.id) ? `<label class="check"><input type="checkbox" data-action="moComp" ${m.comp ? 'checked' : ''}> <span>Complimentary — issue free, keep the real ticket type and its face value for reporting</span></label>` : ''}`,
    `<button class="btn btn-ghost" data-action="closeModal">Cancel</button><button class="btn btn-accent" data-action="saveManual">Create order</button>`);
}
function Attendees() {
  const evId = S.ui.attEv || S.adm.events.filter(e => e.status === 'published').sort((a, b) => D(a.start) - D(b.start)).find(e => D(e.start) > Date.now())?.id || S.adm.events[0]?.id;
  S.ui.attEv = evId; const ev = evById(evId); const q = S.ui.q.trim().toLowerCase();
  const tks = S.adm.tickets.filter(t => t.event_id === evId && t.status === 'valid').map(t => ({ t, o: S.adm.orders.find(o => o.id === t.order_id), tt: ev?.ticketTypes.find(x => x.id === t.ticket_type_id), slot: ev?.timeSlots?.find(s => s.id === t.slot_id) }))
    .filter(r => !q || [r.t.holder, r.t.code, r.o?.ref, r.o?.buyer_email, r.t.seat].join(' ').toLowerCase().includes(q)).sort((a, b) => (a.t.holder || '').localeCompare(b.t.holder || ''));
  const inn = tks.filter(r => r.t.checked_in_at).length;
  return head('Door list', ev ? `${esc(ev.name)} · ${inn} of ${tks.length} checked in` : '', `<button class="btn btn-ghost" data-action="print">Print door list</button><button class="btn btn-ghost" data-action="exportAtt">Export CSV</button>`) + `
  <div class="toolbar no-print"><select class="inp" data-input="attEv">${evOptions(evId, 'Choose event')}</select><input class="inp" data-input="q" placeholder="Search name, code, seat…" value="${esc(S.ui.q)}"></div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Ticket</th><th>Seat / time</th><th>Code</th><th>Order</th><th>Checked in</th></tr></thead><tbody>
  ${tks.map(({ t, o, tt, slot }) => `<tr><td><b>${esc(t.holder)}</b><div class="small muted">${esc(o?.buyer_email || '')}</div></td><td>${esc(tt?.name || '')}</td><td>${esc(t.seat ? seatName(ev, t.seat, true) : (slot ? fmtTime(slot.start) : '—'))}</td><td class="tnum">${esc(t.code)}</td><td class="tnum">${esc(o?.ref || '')}${o?.status === 'pending' ? ' <span class="chip warn">unpaid</span>' : ''}</td>
    <td>${can(t.checked_in_at ? 'door.undo' : 'door.checkin', t.event_id) ? `<button class="btn btn-sm ${t.checked_in_at ? 'btn-dark' : 'btn-ghost'}" data-action="toggleIn" data-v="${esc(t.code)}" data-undo="${t.checked_in_at ? 1 : 0}">${t.checked_in_at ? '✓ ' + esc(fmtTime(t.checked_in_at)) : 'Check in'}</button>` : (t.checked_in_at ? '✓' : '')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No tickets yet.</td></tr>'}
  </tbody></table></div>`;
}
function CheckIn() {
  const url = location.origin + location.pathname + '#/scan';
  const evs = S.adm.events.filter(e => e.status === 'published' && D(e.end || e.start) >= Date.now() - 12 * 3600e3).sort((a, b) => D(a.start) - D(b.start));
  return head('Scanner app', 'Check guests in at the door from any phone — no app store needed.', `<a class="btn btn-accent" href="#/scan" target="_blank">Open scanner ${ic('ext', 14)}</a>`) + `
  <div class="cols"><div class="stack">
    <div class="card"><div class="row" style="gap:22px;align-items:flex-start;flex-wrap:wrap"><div class="qr qr-sm" data-qr="${esc(url)}"></div>
      <div style="flex:1;min-width:220px"><h3>Put it on your door staff's phones</h3><ol class="steps"><li>Scan this code with the phone's camera.</li><li>Sign in with an email on the <a href="#/admin/team">Team</a> page.</li><li>Tap <b>Share → Add to Home Screen</b> — it opens full-screen like a native app.</li></ol>
      <p class="small muted">Scans with the phone camera, Bluetooth/USB barcode scanners, or typed codes. Keeps working when the venue Wi-Fi drops and syncs when it's back.</p></div></div></div>
    <div class="card" style="padding:0"><div style="padding:18px 22px 8px"><h3>Live door status</h3></div><div style="overflow:auto"><table class="tbl"><thead><tr><th>Event</th><th>Starts</th><th style="width:40%">Checked in</th></tr></thead><tbody>
      ${evs.map(e => { const st = checkStats(e.id); return `<tr><td><b>${esc(e.name)}</b></td><td class="small">${esc(fmtDT(e.start))}</td><td><div class="between small"><span>${st.inn} / ${st.total}</span><span class="muted">${st.total ? Math.round(st.inn / st.total * 100) : 0}%</span></div><div class="bar"><i style="width:${st.total ? st.inn / st.total * 100 : 0}%;background:var(--accent)"></i></div></td></tr>`; }).join('') || '<tr><td colspan="3" class="muted">No upcoming events.</td></tr>'}
    </tbody></table></div></div>
  </div><div><div class="phone"><iframe src="${esc(location.pathname)}#/scan" title="Scanner app preview" allow="camera"></iframe></div><p class="small muted" style="text-align:center;margin-top:10px">Live preview — this is the real app.</p></div></div>`;
}
async function doCheckin(code, undo) {
  try { const r = await DB.checkin(code, undo); applyTicket(r); render(); } catch (e) { toast(e.message, true); }
}
function applyTicket(r) { if (!r?.ticket) return; const t = S.adm.tickets.find(x => x.id === r.ticket.id); if (t) t.checked_in_at = r.ticket.checked_in_at; }
const checkStats = evId => { const tk = S.adm.tickets.filter(t => t.event_id === evId && t.status === 'valid'); return { tk, total: tk.length, inn: tk.filter(t => t.checked_in_at).length }; };

// ══════════════════════════════════════════════════════════════════════════════
//  DOOR SCANNER APP  (#/scan — phone-first, installable, works offline)
// ══════════════════════════════════════════════════════════════════════════════
function ScanApp() {
  if (!S.user || S.user.mfa || !S.adm) return Login('Door staff sign in', 'start scanning tickets');
  if (!S.adm.bo || S.adm.blocked) return AdminShell();
  if (S.adm.needs2fa) return Gate('Two-factor required', 'Set up two-factor sign-in in the back office (My security) before scanning.');
  if (!can('door.scan')) return Gate('No scanner access', 'Ask a box office admin to give you the “Scan tickets” permission.');
  const ev = S.adm.events.find(e => e.id === S.sc.evId);
  return `<div class="sc">${ev ? ScanEvent(ev) : ScanPick()}</div>${S.sc.last ? ScanResult(S.sc.last) : ''}`;
}
function ScanPick() {
  const today = new Date().toDateString();
  const evs = S.adm.events.filter(e => e.status === 'published' && D(e.end || e.start) >= Date.now() - 12 * 3600e3).sort((a, b) => D(a.start) - D(b.start));
  return `<header class="sc-top"><div class="sc-logo">${logo()}</div><span class="sc-badge">Scanner</span><span style="flex:1"></span><a href="#/admin" class="sc-link">Box office</a></header>
  <div class="sc-pad"><div class="sc-eyebrow">Choose an event</div><h1 class="sc-h">Who's coming in?</h1>
  ${evs.map(e => { const st = checkStats(e.id), tonight = D(e.start).toDateString() === today;
    return `<button class="sc-ev" data-action="scPick" data-id="${e.id}"><div class="sc-ev-art" style="${artBg(e)}"></div><div class="sc-ev-body">
      <div class="row" style="gap:6px">${tonight ? '<span class="chip gold">Tonight</span>' : ''}<span class="sc-dim">${esc(fmtDT(e.start))}</span></div>
      <b>${esc(e.name)}</b><span class="sc-dim">${esc(e.venue || '')}</span>
      <div class="sc-bar"><i style="width:${st.total ? st.inn / st.total * 100 : 0}%"></i></div><span class="sc-dim">${st.inn} of ${st.total} checked in</span></div><span class="sc-chev">›</span></button>`; }).join('') || '<p class="sc-dim">No upcoming events.</p>'}
  </div><div class="sc-foot"><span>${esc(S.user.email)}</span><a href="#" data-action="signOut">Sign out</a></div>`;
}
function ScanEvent(ev) {
  const st = checkStats(ev.id), tab = S.sc.tab, on = navigator.onLine;
  return `<header class="sc-top"><button class="sc-back" data-action="scBack" aria-label="All events">‹</button>
    <div class="sc-title"><b>${esc(ev.name)}</b><span>${esc(fmtTime(ev.start))}${ev.venue ? ' · ' + esc(ev.venue) : ''}</span></div>
    <span class="sc-net ${on ? '' : 'off'}">${ic('wifi', 13)} ${on ? 'Online' : 'Offline'}${S.sc.queue.length ? ' · ' + S.sc.queue.length + ' queued' : ''}</span></header>
  <div class="sc-count"><div><span class="n">${st.inn}</span><span class="d"> / ${st.total} checked in</span></div><span class="d">${st.total - st.inn} to come</span></div>
  <div class="sc-progress"><i style="width:${st.total ? st.inn / st.total * 100 : 0}%"></i></div>
  <main class="sc-body">${tab === 'guests' ? ScanGuests(ev, st) : tab === 'stats' ? ScanStats(ev, st) : ScanCam()}</main>
  <nav class="sc-tabs">${[['scan', 'Scan', 'scan'], ['guests', 'Guests', 'users'], ['stats', 'Stats', 'chart']].map(([k, t, i]) => `<button class="${tab === k ? 'on' : ''}" data-action="scTab" data-v="${k}">${ic(i, 21)}<span>${t}</span></button>`).join('')}</nav>`;
}
function ScanCam() {
  const live = !!CAM.stream;
  return `<div class="sc-cam">${live ? '<div id="camSlot" class="sc-slot"></div>' : `<div class="sc-cam-off"><div class="sc-cam-ic">${ic('scan', 44)}</div><p>Point the camera at the QR code on a ticket</p>
      <button class="btn btn-accent btn-lg" data-action="scCam">Start scanning</button>${S.sc.err ? `<p class="sc-err">${esc(S.sc.err)}</p>` : ''}</div>`}
    <div class="sc-frame ${live ? 'live' : ''}"><i></i><i></i><i></i><i></i>${live ? '<span class="sc-line"></span>' : ''}</div></div>
  <div class="sc-tools">
    <button class="sc-tool" data-action="scManual">${ic('keyboard', 20)}<span>Enter code</span></button>
    <button class="sc-tool ${CAM.torch ? 'on' : ''}" data-action="scTorch" ${live ? '' : 'disabled'}>${ic('bolt', 20)}<span>Torch</span></button>
    <button class="sc-tool ${S.sc.sound ? 'on' : ''}" data-action="scSound">${ic(S.sc.sound ? 'sound' : 'mute', 20)}<span>Sound</span></button></div>
  ${S.sc.recent.length ? `<div class="sc-recent"><div class="sc-eyebrow">Recent</div>${S.sc.recent.slice(0, 5).map(r => `<div class="sc-rec"><span class="dot ${resKind(r.result)}"></span><b>${esc(r.ticket?.holder || r.code)}</b><span class="sc-dim">${esc(RES_TITLE[r.result])} · ${esc(fmtTime(new Date(r.at).toISOString()))}</span></div>`).join('')}</div>` : ''}`;
}
const RES_TITLE = { ok: 'Valid ticket', already: 'Already checked in', unknown: 'Not a valid ticket', cancelled: 'Ticket cancelled', wrong_event: 'Wrong event', undone: 'Check-in undone' };
const resKind = r => r === 'ok' ? 'ok' : r === 'already' ? 'warn' : r === 'undone' ? 'info' : 'bad';
function ScanResult(r) {
  const kind = resKind(r.result), t = r.ticket, ev = t && evById(t.event_id), tt = ev?.ticketTypes.find(x => x.id === t.ticket_type_id);
  const o = t && S.adm.orders.find(x => x.id === t.order_id), slot = t?.slot_id && ev?.timeSlots?.find(s => s.id === t.slot_id);
  return `<div class="sc-result ${kind}" data-action="scDismiss" role="alert"><div class="sc-res-icon">${ic(kind === 'ok' ? 'check' : kind === 'bad' ? 'x' : 'alert', 58)}</div>
    <div class="sc-res-t">${esc(RES_TITLE[r.result])}</div>
    ${t ? `<div class="sc-res-name">${esc(t.holder)}</div><div class="sc-res-meta">${esc(tt?.name || '')}${t.seat ? ' · ' + esc(seatName(ev, t.seat, true)) : ''}${slot ? ' · ' + esc(fmtTime(slot.start)) : ''}</div><div class="sc-res-code">${esc(t.code)}${o ? ' · ' + esc(o.ref) : ''}</div>` : `<div class="sc-res-code">${esc(r.code || '')}</div>`}
    ${r.result === 'already' ? `<div class="sc-res-note">First scanned at ${esc(fmtTime(t.checked_in_at))}</div>` : ''}
    ${r.result === 'wrong_event' && ev ? `<div class="sc-res-note">This ticket is for ${esc(ev.name)} · ${esc(fmtDT(ev.start))}</div>` : ''}
    ${r.result === 'ok' && o?.status === 'pending' ? `<div class="sc-res-note">Unpaid order — collect ${money(o.data.total, o.data.currency)}</div>` : ''}
    ${r.offline ? '<div class="sc-res-note">Saved offline — syncs when back online</div>' : ''}
    <div class="sc-res-actions">${r.result === 'ok' ? `<button class="btn glass" data-action="scUndo" data-v="${esc(t.code)}">Undo</button>` : ''}<button class="btn sc-next" data-action="scDismiss">Next scan</button></div></div>`;
}
function ScanGuests(ev, st) {
  const q = S.sc.q.trim().toLowerCase(), f = S.sc.filter;
  const rows = st.tk.filter(t => (f === 'all' || (f === 'in') === !!t.checked_in_at) && (!q || [t.holder, t.code, t.seat, S.adm.orders.find(o => o.id === t.order_id)?.buyer_email].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => (a.holder || '').localeCompare(b.holder || ''));
  return `<div class="sc-pad"><div class="sc-search">${ic('search', 17)}<input data-input="sc.q" placeholder="Search name, code, seat…" value="${esc(S.sc.q)}" autocomplete="off"></div>
    <div class="sc-chips">${[['all', 'All ' + st.total], ['out', 'Not in ' + (st.total - st.inn)], ['in', 'In ' + st.inn]].map(([k, t]) => `<button class="${f === k ? 'on' : ''}" data-action="scFilter" data-v="${k}">${t}</button>`).join('')}</div>
    ${rows.slice(0, 250).map(t => { const tt = ev.ticketTypes.find(x => x.id === t.ticket_type_id);
      return `<div class="sc-guest"><div><b>${esc(t.holder)}</b><span>${esc(tt?.name || '')}${t.seat ? ' · ' + esc(seatName(ev, t.seat, true)) : ''} · ${esc(t.code)}</span></div>
        <button class="sc-tick ${t.checked_in_at ? 'on' : ''}" data-action="scToggle" data-v="${esc(t.code)}" data-undo="${t.checked_in_at ? 1 : 0}">${t.checked_in_at ? ic('check', 15) + ' ' + esc(fmtTime(t.checked_in_at)) : 'Check in'}</button></div>`; }).join('') || '<p class="sc-dim" style="padding:20px 0">No guests match.</p>'}</div>`;
}
function ScanStats(ev, st) {
  const pct = st.total ? st.inn / st.total : 0, R = 70, C = 2 * Math.PI * R;
  const byTT = ev.ticketTypes.map(t => { const a = st.tk.filter(x => x.ticket_type_id === t.id); return { t, n: a.length, i: a.filter(x => x.checked_in_at).length }; }).filter(x => x.n);
  const now = Date.now(), bins = Array.from({ length: 12 }, (_, i) => ({ from: now - (12 - i) * 15 * 6e4, v: 0 }));
  st.tk.forEach(t => { if (!t.checked_in_at) return; const ts = D(t.checked_in_at).getTime(), b = bins.find(b => ts >= b.from && ts < b.from + 15 * 6e4); if (b) b.v++; });
  const mx = Math.max(1, ...bins.map(b => b.v));
  return `<div class="sc-pad">
    <div class="sc-ring"><svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="${R}" class="trk"/><circle cx="90" cy="90" r="${R}" class="val" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"/></svg><div><b>${Math.round(pct * 100)}%</b><span>checked in</span></div></div>
    <div class="sc-kpis"><div><b>${st.inn}</b><span>In</span></div><div><b>${st.total - st.inn}</b><span>To come</span></div><div><b>${st.total}</b><span>Tickets</span></div></div>
    <div class="sc-card"><div class="sc-eyebrow">Arrivals · last 3 hours</div><div class="sc-arr">${bins.map(b => `<i style="height:${Math.max(4, b.v / mx * 100)}%" title="${b.v} in"></i>`).join('')}</div>
      <div class="between sc-dim" style="font-size:11px;margin-top:6px"><span>${esc(fmtTime(new Date(bins[0].from).toISOString()))}</span><span>Now</span></div></div>
    <div class="sc-card"><div class="sc-eyebrow">By ticket type</div>${byTT.map(x => `<div style="margin-top:12px"><div class="between"><span>${esc(x.t.name)}</span><span class="sc-dim">${x.i} / ${x.n}</span></div><div class="sc-bar"><i style="width:${x.i / x.n * 100}%"></i></div></div>`).join('') || '<p class="sc-dim">No tickets sold yet.</p>'}</div></div>`;
}

// Camera: one persistent <video> that survives re-renders (moved into #camSlot after each render).
const CAM = { video: null, stream: null, raf: 0, last: '', at: 0, torch: false, canvas: null };
async function camStart() {
  if (CAM.stream) return;
  try {
    CAM.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } });
    if (!CAM.video) { CAM.video = document.createElement('video'); CAM.video.setAttribute('playsinline', ''); CAM.video.muted = true; }
    CAM.video.srcObject = CAM.stream; S.sc.err = ''; render(); await CAM.video.play().catch(() => { }); camLoop();
  } catch (e) { CAM.stream = null; S.sc.err = e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in your browser settings, or enter codes by hand.' : 'Camera unavailable: ' + e.message; render(); }
}
function camMount() { const slot = $('#camSlot'); if (slot && CAM.video && CAM.video.parentNode !== slot) { slot.append(CAM.video); CAM.video.play().catch(() => { }); } }
function camStop() { if (CAM.stream) CAM.stream.getTracks().forEach(t => t.stop()); CAM.stream = null; CAM.torch = false; cancelAnimationFrame(CAM.raf); }
function camLoop() {
  const v = CAM.video, c = CAM.canvas || (CAM.canvas = document.createElement('canvas')), ctx = c.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (!CAM.stream) return;
    if (v.readyState >= 2 && window.jsQR && !S.sc.last && S.sc.tab === 'scan') {
      const w = Math.min(640, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth); c.width = w; c.height = h; ctx.drawImage(v, 0, 0, w, h);
      const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      if (r?.data && (r.data !== CAM.last || Date.now() - CAM.at > 3000)) { CAM.last = r.data; CAM.at = Date.now(); scanCheck(r.data); }
    }
    CAM.raf = requestAnimationFrame(tick);
  };
  tick();
}
let _resTimer = 0;
async function scanCheck(code, undo = false, quiet = false) {
  code = String(code).trim().toUpperCase(); if (!code) return;
  let r;
  try { if (DB.live && !navigator.onLine) throw new TypeError('offline'); r = await DB.checkin(code, undo, S.sc.evId || null); }
  catch (e) { if (!(e instanceof TypeError)) return toast(e.message, true); r = localCheckin(code, undo); }   // network down → validate locally, queue
  applyTicket(r); r.code = code; r.at = Date.now();
  S.sc.recent.unshift(r); S.sc.recent.length = Math.min(S.sc.recent.length, 30); feedback(r.result);
  if (quiet) { toast((r.ticket?.holder || code) + ' — ' + RES_TITLE[r.result], resKind(r.result) === 'bad'); return render(); }
  S.sc.last = r; render();
  clearTimeout(_resTimer); _resTimer = setTimeout(() => { if (S.sc.last === r) { S.sc.last = null; render(); } }, r.result === 'ok' ? 1700 : 3800);
}
function localCheckin(code, undo) {
  const t = S.adm.tickets.find(x => x.code === code);
  if (!t) return { result: 'unknown', offline: true };
  if (t.status !== 'valid') return { result: 'cancelled', ticket: { ...t }, offline: true };
  if (S.sc.evId && t.event_id !== S.sc.evId) return { result: 'wrong_event', ticket: { ...t }, offline: true };
  const was = t.checked_in_at;
  if (!was || undo) { S.sc.queue.push({ code, undo }); saveQueue(); }
  return { result: undo ? 'undone' : was ? 'already' : 'ok', ticket: { ...t, checked_in_at: undo ? null : (was || new Date().toISOString()) }, offline: true };
}
function loadQueue() { try { return JSON.parse(localStorage.getItem('set_scan_queue')) || []; } catch (e) { return []; } }
function saveQueue() { try { localStorage.setItem('set_scan_queue', JSON.stringify(S.sc.queue)); } catch (e) { } }
async function flushQueue() {
  while (S.sc.queue.length && navigator.onLine) { const q = S.sc.queue[0]; try { await DB.checkin(q.code, q.undo); S.sc.queue.shift(); saveQueue(); } catch (e) { break; } }
  if (S.route.page === 'scan') render();
}
window.addEventListener('online', flushQueue);
window.addEventListener('offline', () => { if (S.route.page === 'scan') render(); });
function feedback(kind) {
  if (navigator.vibrate) navigator.vibrate(kind === 'ok' ? 60 : [80, 60, 80]);
  if (!S.sc.sound) return;
  try {
    const a = feedback.ctx || (feedback.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const tone = (f, t0, d) => { const o = a.createOscillator(), g = a.createGain(); o.frequency.value = f; g.gain.setValueAtTime(.16, a.currentTime + t0); g.gain.exponentialRampToValueAtTime(.001, a.currentTime + t0 + d); o.connect(g).connect(a.destination); o.start(a.currentTime + t0); o.stop(a.currentTime + t0 + d); };
    if (kind === 'ok') tone(1320, 0, .12); else if (kind === 'already') { tone(700, 0, .1); tone(700, .15, .1); } else tone(220, 0, .32);
  } catch (e) { }
}
// Bluetooth/USB barcode scanners type the code fast and press Enter ("keyboard wedge").
const _wedge = { buf: '', t: 0 };
document.addEventListener('keydown', e => {
  if (S.route.page !== 'scan' || !S.sc.evId || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
  const now = Date.now(); if (now - _wedge.t > 80) _wedge.buf = ''; _wedge.t = now;
  if (e.key === 'Enter') { if (_wedge.buf.length >= 6) scanCheck(_wedge.buf); _wedge.buf = ''; } else if (e.key.length === 1) _wedge.buf += e.key;
});

// ── Reports ──────────────────────────────────────────────────────────────────
function Reports() {
  const os = liveOrders(), evId = S.ui.repEv, ev = evById(evId);
  const scoped = evId ? os.filter(o => o.event_ids.includes(evId)) : os;
  const rows = S.adm.events.map(e => { const eo = os.filter(o => o.event_ids.includes(e.id)), s = evStats(e);
    return { e, s, orders: eo.length, disc: sum(eo, o => o.data.discount), fees: sum(eo, o => o.data.fee), don: sum(eo, o => o.data.donation), unpaid: sum(eo.filter(o => o.status === 'pending'), o => o.data.total) }; }).sort((a, b) => b.s.rev - a.s.rev);
  const src = {}; scoped.forEach(o => { const k = o.data.source || 'direct'; src[k] = (src[k] || 0) + o.data.total; });
  const tot = Object.values(src).reduce((a, b) => a + b, 0) || 1;
  const heat = {}; S.adm.tickets.filter(t => t.status === 'valid' && t.slot_id && (!evId || t.event_id === evId)).forEach(t => { const s = evById(t.event_id)?.timeSlots?.find(x => x.id === t.slot_id); if (!s) return; const d = D(s.start); const k = d.getDay() + '-' + d.getHours(); heat[k] = (heat[k] || 0) + 1; });
  const hours = [...new Set(Object.keys(heat).map(k => +k.split('-')[1]))].sort((a, b) => a - b), hmax = Math.max(1, ...Object.values(heat));
  return head('Reports', 'Revenue, ticket sales and channels', `<select class="inp" style="width:auto;border-radius:999px" data-input="repEv">${evOptions(evId)}</select><button class="btn btn-ghost" data-action="exportReport">Export CSV</button>`) + `
  <div class="kpis"><div class="kpi dark"><div class="eyebrow">Gross</div><div class="v">${money(sum(scoped, o => o.data.total))}</div></div>
    <div class="kpi"><div class="eyebrow">Ticket revenue</div><div class="v">${money(sum(scoped, o => o.data.subtotal - o.data.discount))}</div></div>
    <div class="kpi"><div class="eyebrow">Booking fees</div><div class="v">${money(sum(scoped, o => o.data.fee))}</div></div>
    <div class="kpi"><div class="eyebrow">Avg order</div><div class="v">${money(scoped.length ? sum(scoped, o => o.data.total) / scoped.length : 0)}</div></div></div>
  <div class="cols"><div class="card"><h3>Daily sales</h3><div class="small muted">Last 28 days</div>${barChart(dailySeries(scoped, 28, o => o.data.total), v => money(v))}</div>
  <div class="card"><h3>Sales by source</h3><div class="small muted" style="margin-bottom:12px">From tracking links (?src=)</div>${Object.entries(src).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div style="margin-bottom:10px"><div class="between small"><b>${esc(k)}</b><span>${money(v)}</span></div><div class="bar"><i style="width:${v / tot * 100}%"></i></div></div>`).join('') || '<p class="muted">No sales yet.</p>'}</div></div>
  ${ev ? `<div class="card" style="margin-top:18px"><h3>${esc(ev.name)} · by ticket type</h3><table class="tbl" style="margin-top:8px"><thead><tr><th>Ticket</th><th>Price</th><th>Sold</th><th>Remaining</th><th>Revenue</th></tr></thead><tbody>
    ${ev.ticketTypes.map(t => { const ls = scoped.flatMap(o => o.data.lines.filter(l => l.ticketTypeId === t.id && l.eventId === ev.id)); const n = sum(ls, l => l.qty * l.admits);
      return `<tr><td>${esc(t.name)}</td><td>${money(t.price)}</td><td class="tnum">${n}</td><td class="tnum">${+t.qty ? Math.max(0, t.qty - n) : '∞'}</td><td class="tnum">${money(sum(ls, l => l.qty * l.unit))}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
  ${hours.length ? `<div class="card" style="margin-top:18px"><h3>Time-slot heat map</h3><div class="small muted" style="margin-bottom:12px">Tickets per slot — busiest and quietest times</div><div style="overflow:auto"><table class="heat" style="border-spacing:4px;border-collapse:separate"><tr><td></td>${hours.map(h => `<td class="small muted">${h % 12 || 12}${h < 12 ? 'a' : 'p'}</td>`).join('')}</tr>
    ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, di) => `<tr><td class="small muted">${d}</td>${hours.map(h => { const v = heat[di + '-' + h] || 0; return `<td style="background:rgba(2,10,22,${v ? .08 + v / hmax * .85 : .03});color:${v / hmax > .5 ? '#fff' : 'var(--text)'}">${v || ''}</td>`; }).join('')}</tr>`).join('')}</table></div></div>` : ''}
  <div class="tbl-wrap" style="margin-top:18px"><table class="tbl"><thead><tr><th>Event</th><th>Date</th><th>Orders</th><th>Tickets</th><th>Discounts</th><th>Fees</th><th>Donations</th><th>Unpaid</th><th>Ticket revenue</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${esc(r.e.name)}</b></td><td class="small">${esc(fmtDate(r.e.start, { month: 'short', day: 'numeric', year: 'numeric' }))}</td><td class="tnum">${r.orders}</td><td class="tnum">${r.s.sold}</td><td class="tnum">${money(r.disc)}</td><td class="tnum">${money(r.fees)}</td><td class="tnum">${money(r.don)}</td><td class="tnum">${r.unpaid ? `<span style="color:var(--warn)">${money(r.unpaid)}</span>` : '—'}</td><td class="tnum"><b>${money(r.s.rev)}</b></td></tr>`).join('')}</tbody></table></div>`;
}

// ── Marketing, team, settings ────────────────────────────────────────────────
function Marketing() {
  const opted = [...new Map(S.adm.orders.filter(o => o.data.optIn).map(o => [o.buyer_email, o])).values()];
  const codes = S.adm.events.flatMap(e => (e.secrets?.discounts || []).map(d => ({ d, e })));
  return head('Marketing', 'Audience, codes and promotion') + `
  <div class="kpis"><div class="kpi"><div class="eyebrow">Opted-in contacts</div><div class="v">${opted.length}</div></div><div class="kpi"><div class="eyebrow">All buyers</div><div class="v">${new Set(S.adm.orders.map(o => o.buyer_email)).size}</div></div>
    <div class="kpi"><div class="eyebrow">Active codes</div><div class="v">${codes.length}</div></div><div class="kpi"><div class="eyebrow">Waitlist</div><div class="v">${S.adm.waitlist.length}</div></div></div>
  <div class="cols"><div class="card"><div class="between"><h3>Mailing list</h3><button class="btn btn-ghost btn-sm" data-action="exportOptIn">Export for Mailchimp</button></div><p class="small muted" style="margin:4px 0 12px">Buyers who ticked “email me about future events”.</p>
    ${opted.slice(0, 12).map(o => `<div class="between small" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(o.data.buyer.name)}</span><span class="muted">${esc(o.buyer_email)}</span></div>`).join('') || '<p class="muted">No contacts yet.</p>'}</div>
  <div class="card"><h3>Discount codes</h3><p class="small muted" style="margin:4px 0 12px">Manage codes inside each event.</p>${codes.map(({ d, e }) => `<a class="between small" style="padding:7px 0;border-bottom:1px solid var(--line);text-decoration:none" href="#/admin/event/${e.id}/discounts"><b class="tnum">${esc(d.code)}</b><span class="muted">${d.type === 'pct' ? esc(d.amount) + '% off' : money(d.amount) + ' off'} · ${esc(e.name)}</span></a>`).join('') || '<p class="muted">No codes.</p>'}</div></div>
  <div class="card" style="margin-top:18px"><h3>Tracking pixels</h3><p class="small muted" style="margin:4px 0 0">Set Google Analytics 4 and Meta Pixel IDs in <a href="#/admin/settings">Settings</a>; they load on every public page.</p></div>`;
}
// ── Team & permissions ───────────────────────────────────────────────────────
const tplName = id => (S.adm.bo.templates || []).find(t => t.id === id)?.name;
function accessLabel(m) {
  if (m.owner) return '<span class="chip ok">Owner · everything</span>';
  const t = (S.adm.bo.templates || []).find(x => x.id === m.template), same = t && t.perms.length === m.perms.length && t.perms.every(k => m.perms.includes(k));
  return same ? `<span class="chip info">${esc(t.name)}</span>` : `<span class="chip">Custom · ${m.perms.length} permissions</span>`;
}
const eventsLabel = m => m.owner || m.events === 'all' ? 'All events' : !m.events.length ? '<span style="color:var(--bad)">No events</span>' : m.events.map(id => esc(evById(id)?.name || 'Removed event')).join(', ');
const TEAM_TABS = [['members', 'Members'], ['templates', 'Permission templates'], ['activity', 'Activity log']];
function Team() {
  const tab = S.route.params[0] || 'members';
  if (tab === 'member' || tab === 'template') return PermEditor(tab, S.route.params[1]);
  const body = { members: TeamMembers, templates: TeamTemplates, activity: ActivityLog }[tab] || TeamMembers;
  return head('Team', 'Who can get into ' + esc(S.adm.bo.name) + ' — and exactly what they can do') +
    `<nav class="etabs" style="margin-bottom:18px">${TEAM_TABS.map(([k, t]) => `<a class="${tab === k ? 'on' : ''}" href="#/admin/team/${k}">${t}</a>`).join('')}</nav>` + body();
}
function EventPicker(path, sel) {
  const all = sel === 'all';
  return `<div class="field"><label class="fl">Event access</label>
    <label class="check" style="margin-bottom:6px"><input type="radio" name="${path}" data-action="evScope" data-p="${path}" data-v="all" ${all ? 'checked' : ''}> <span>All events, including future ones</span></label>
    <label class="check" style="margin-bottom:6px"><input type="radio" name="${path}" data-action="evScope" data-p="${path}" data-v="some" ${!all ? 'checked' : ''}> <span>Only selected events</span></label>
    ${!all ? `<div class="perm-evs">${S.adm.events.slice().sort((a, b) => D(a.start) - D(b.start)).map(e => `<label class="check"><input type="checkbox" data-action="evPick" data-p="${path}" data-v="${e.id}" ${sel.includes(e.id) ? 'checked' : ''}> <span>${esc(e.name)} <span class="muted small">${esc(fmtDate(e.start, { month: 'short', day: 'numeric' }))}</span></span></label>`).join('') || '<p class="small muted">No events yet.</p>'}</div>` : ''}</div>`;
}
function TeamMembers() {
  const t = S.ui.inv || (S.ui.inv = { email: '', name: '', template: 'door_staff', events: 'all' }), me = S.adm.me;
  const others = S.adm.team.filter(m => !m.owner && m.email !== me.email);
  return `<div class="cols"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Member</th><th>Access</th><th>Events</th><th></th></tr></thead><tbody>
    ${S.adm.team.slice().sort((a, b) => (b.owner - a.owner) || a.email.localeCompare(b.email)).map(m => `<tr><td><b>${esc(m.name || '—')}</b><div class="small muted">${esc(m.email)}</div></td><td>${accessLabel(m)}</td><td class="small">${eventsLabel(m)}</td>
    <td style="white-space:nowrap;text-align:right">${m.email === me.email ? '<span class="chip">You</span>' : m.owner ? '' :
      `${can('admin.perms') ? `<a class="btn btn-ghost btn-sm" href="#/admin/team/member/${encodeURIComponent(m.email)}">Permissions</a>` : ''} ${can('admin.remove') ? `<button class="btn btn-ghost btn-sm" data-action="rmMember" data-v="${esc(m.email)}">Remove</button>` : ''}`}</td></tr>`).join('')}</tbody></table></div>
  <div class="stack">${can('admin.invite') ? `<div class="card"><h3>Invite a team member</h3><p class="small muted" style="margin-bottom:12px">They sign in with this email. Fine-tune their permissions after inviting.</p>
    <div class="field"><label class="fl">Name</label><input class="inp" data-input="inv.name" value="${esc(t.name)}"></div><div class="field"><label class="fl">Email</label><input class="inp" type="email" data-input="inv.email" value="${esc(t.email)}"></div>
    <div class="field"><label class="fl">Starting permissions</label><select class="inp" data-input="inv.template">${S.adm.bo.templates.map(x => `<option value="${x.id}" ${t.template === x.id ? 'selected' : ''}>${esc(x.name)} (${x.perms.length})</option>`).join('')}</select></div>
    ${EventPicker('inv', t.events)}
    <button class="btn btn-accent btn-block" data-action="addMember">Send invite</button></div>` : ''}
    ${me.owner || me.support ? `<div class="card"><h3>Transfer ownership</h3><p class="small muted" style="margin:4px 0 12px">The owner always has every permission and can't be removed. You'll stay on the team with full access.</p>
      <select class="inp" data-input="xferTo"><option value="">Choose a member…</option>${others.map(m => `<option value="${esc(m.email)}" ${S.ui.xferTo === m.email ? 'selected' : ''}>${esc(m.name || m.email)}</option>`).join('')}</select>
      <button class="btn btn-ghost btn-block" style="margin-top:10px" data-action="transferOwner">Transfer ownership</button></div>` : ''}</div></div>`;
}
function TeamTemplates() {
  return `<p class="muted" style="margin:-4px 0 16px;max-width:640px">Templates are starting points. Changing a template doesn't change people already invited with it — edit their permissions individually.</p>
  <div class="tpl-grid">${S.adm.bo.templates.map(t => `<div class="card"><div class="between"><h3>${esc(t.name)}</h3><span class="chip">${t.perms.length}</span></div>
    <p class="small muted" style="margin:6px 0 12px">${PERMS.filter(([g]) => t.perms.some(k => k.startsWith(g + '.'))).map(([, l]) => l).join(' · ') || 'No permissions'}</p>
    ${can('admin.perms') ? `<a class="btn btn-ghost btn-sm" href="#/admin/team/template/${t.id}">Edit</a>${t.id !== 'full' ? ` <button class="btn btn-ghost btn-sm" data-action="rmTemplate" data-v="${t.id}">Delete</button>` : ''}` : ''}</div>`).join('')}
    ${can('admin.perms') ? `<button class="card tpl-new" data-action="newTemplate">${ic('plus', 18)} New template</button>` : ''}</div>`;
}
function permLevel(g, perms) {
  const all = groupPerms(g), views = groupPerms(g, true), have = all.filter(k => perms.includes(k));
  return !have.length ? 'none' : have.length === all.length ? 'manage' : views.length && have.length === views.length && views.every(k => have.includes(k)) ? 'view' : 'custom';
}
function PermMatrix(perms, ro) {
  return `<div class="perm-grid">${PERMS.map(([g, label, ks]) => { const lvl = permLevel(g, perms), hasView = ks.some(k => k[2]);
    return `<div class="card perm-g"><div class="between" style="gap:8px;flex-wrap:wrap"><h3>${label}</h3>
      <div class="tabs">${[['none', 'No access'], ...(hasView ? [['view', 'View only']] : []), ['manage', 'Manage']].map(([v, t]) => `<button type="button" class="${lvl === v ? 'on' : ''}" data-action="permLvl" data-g="${g}" data-v="${v}" ${ro ? 'disabled' : ''}>${t}</button>`).join('')}</div></div>
      ${lvl === 'custom' ? '<div class="small muted" style="margin-top:6px">Custom selection</div>' : ''}
      <div class="perm-list">${ks.map(([k, t, v]) => `<label class="check"><input type="checkbox" data-action="permKey" data-v="${g}.${k}" ${perms.includes(g + '.' + k) ? 'checked' : ''} ${ro ? 'disabled' : ''}> <span>${t}${v ? ' <span class="muted small">· view</span>' : ''}</span></label>`).join('')}</div></div>`; }).join('')}</div>`;
}
function PermEditor(kind, id) {
  const key = kind + ':' + id;
  if (S.ui.pe?.key !== key) {
    const src = kind === 'member' ? S.adm.team.find(m => m.email === id) : id === 'new' ? { id: shortId('tpl_'), name: 'New template', perms: [] } : S.adm.bo.templates.find(t => t.id === id);
    if (!src) return `<div class="empty">Not found. <a href="#/admin/team">Back to team</a></div>`;
    S.ui.pe = { key, kind, obj: JSON.parse(JSON.stringify(src)), dirty: false };
  }
  const pe = S.ui.pe, o = pe.obj, ro = !can('admin.perms');
  const title = kind === 'member' ? esc(o.name || o.email) : 'Template';
  return head(title, kind === 'member' ? esc(o.email) : 'A reusable starting set of permissions',
    `<a class="btn btn-ghost" href="#/admin/team/${kind === 'member' ? 'members' : 'templates'}">Back</a>${ro ? '' : `<button class="btn btn-accent" data-action="savePerms" ${pe.dirty ? '' : 'disabled'}>Save changes</button>`}`) + `
  <div class="cols" style="grid-template-columns:320px 1fr;align-items:start"><div class="stack">
    <div class="card">${kind === 'template' ? `<div class="field"><label class="fl">Template name</label><input class="inp" data-bind="ui.pe.obj.name" value="${esc(o.name)}" ${ro || o.id === 'full' ? 'disabled' : ''}></div>` :
      `<div class="field"><label class="fl">Start from a template</label><select class="inp" data-action-change="applyTpl" ${ro ? 'disabled' : ''}><option value="">Choose…</option>${S.adm.bo.templates.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
        <div class="small muted" style="margin-top:4px">Replaces the checkboxes below; you can still adjust them.</div></div>${EventPicker('pe', o.events)}`}
      <div class="sep"></div><div class="small"><b>${o.perms.length}</b> of ${ALL_PERMS.length} permissions</div>
      ${pe.dirty ? '<div class="small" style="color:var(--warn);margin-top:6px">Unsaved changes</div>' : ''}</div>
    ${kind === 'member' ? `<div class="card small muted">Changes apply the moment you save — if they're signed in, they lose access right away. Every change is recorded in the <a href="#/admin/team/activity">activity log</a>.</div>` : ''}
  </div>${PermMatrix(o.perms, ro || o.id === 'full')}</div>`;
}
const AUDIT_KINDS = [['', 'All activity'], ['auth', 'Sign-ins'], ['team', 'Team & permissions'], ['security', 'Security'], ['event', 'Events'], ['order', 'Orders'], ['door', 'Door'], ['settings', 'Settings'], ['platform', 'Platform'], ['support', 'Support access']];
function auditRows(list) {
  const f = S.ui.af || {}, q = (f.q || '').toLowerCase();
  return list.filter(a => (!f.kind || a.kind.startsWith(f.kind)) && (!f.who || a.actor === f.who) && (!q || (a.summary + ' ' + a.actor).toLowerCase().includes(q)));
}
function AuditTable(rows, showBo) {
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Who</th>${showBo ? '<th>Box office</th>' : ''}<th>What</th><th></th></tr></thead><tbody>
    ${rows.slice(0, 300).map(a => `<tr><td class="small" style="white-space:nowrap">${esc(fmtDT(a.at))}</td><td class="small">${esc(a.actor)}</td>${showBo ? `<td class="small">${esc(S.plat?.bos.find(b => b.id === a.box_office_id)?.name || '—')}</td>` : ''}
      <td>${esc(a.summary)}<div class="small muted">${esc(a.kind)}</div></td><td>${a.before || a.after ? `<button class="btn btn-ghost btn-sm" data-action="auditDiff" data-id="${a.id}">Details</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nothing recorded yet.</td></tr>'}</tbody></table></div>`;
}
function AuditFilters(list) {
  const f = S.ui.af || (S.ui.af = {}), who = [...new Set(list.map(a => a.actor))].sort();
  return `<div class="toolbar"><select class="inp" data-input="af.kind" data-rr="1">${AUDIT_KINDS.map(([k, t]) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <select class="inp" data-input="af.who" data-rr="1"><option value="">Everyone</option>${who.map(w => `<option ${f.who === w ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select>
    <input class="inp" data-input="af.q" data-rr="1" placeholder="Search…" value="${esc(f.q || '')}"><button class="btn btn-ghost btn-sm" data-action="exportAudit">Export CSV</button></div>`;
}
function ActivityLog() {
  const list = S.adm.audit || [];
  return `${!can('admin.perms') ? '<p class="small muted" style="margin-bottom:12px">Showing your own activity. Admins with “Edit team permissions” see everyone\'s.</p>' : ''}${AuditFilters(list)}${AuditTable(auditRows(list))}`;
}

// ── Branding (per box office) ───────────────────────────────────────────────
function Branding() {
  const b = S.ui.brand || (S.ui.brand = JSON.parse(JSON.stringify({ name: S.adm.bo.name, slug: S.adm.bo.slug, branding: S.adm.bo.branding, settings: { contactEmail: S.adm.bo.settings.contactEmail, terms: S.adm.bo.settings.terms } })));
  const f = (path, label, t = 'text', hint = '') => `<div class="field"><label class="fl">${label}</label><input class="inp" type="${t}" data-bind="ui.brand.${path}" value="${esc(getPath(b, path) ?? '')}">${hint ? `<div class="small muted" style="margin-top:4px">${hint}</div>` : ''}</div>`;
  const ta = (path, label, hint = '') => `<div class="field"><label class="fl">${label}</label><textarea class="inp" data-bind="ui.brand.${path}">${esc(getPath(b, path) ?? '')}</textarea>${hint ? `<div class="small muted" style="margin-top:4px">${hint}</div>` : ''}</div>`;
  const br = b.branding, url = location.origin + location.pathname + '#/b/' + b.slug;
  loadFont(br.font);
  return head('Branding', 'How your box office looks to buyers', `<a class="btn btn-ghost" href="#/b/${esc(b.slug)}" target="_blank">View public page ${ic('ext', 14)}</a><button class="btn btn-accent" data-action="saveBrand">Save branding</button>`) + `
  <div class="cols"><div class="stack">
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Identity</div><div class="grid2">${f('name', 'Box office name')}${f('branding.tagline', 'Tagline')}</div>
      ${f('branding.logo', 'Logo image URL', 'url', 'https:// link to a PNG or SVG, ideally on a transparent background')}${f('branding.banner', 'Header / banner image URL', 'url', 'Wide image shown at the top of your box office page')}
      <div class="grid3"><div class="field"><label class="fl">Main colour</label><input class="inp" type="color" data-bind="ui.brand.branding.ink" value="${esc(br.ink)}"></div>
        <div class="field"><label class="fl">Accent colour</label><input class="inp" type="color" data-bind="ui.brand.branding.accent" value="${esc(br.accent)}"></div>
        <div class="field"><label class="fl">Headline font</label><select class="inp" data-bind="ui.brand.branding.font">${FONTS.map(x => `<option ${br.font === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div></div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Contact & social</div><div class="grid2">${f('settings.contactEmail', 'Customer service email', 'email')}${f('branding.phone', 'Phone')}${f('branding.website', 'Website', 'url')}${f('branding.instagram', 'Instagram handle')}${f('branding.facebook', 'Facebook page URL', 'url')}${f('branding.tiktok', 'TikTok handle')}</div></div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Policies</div>${ta('settings.terms', 'Terms & conditions', 'Buyers must accept these at checkout')}${ta('branding.refundPolicy', 'Refund policy')}${ta('branding.privacyPolicy', 'Privacy policy')}</div>
  </div><div class="stack">
    <div class="card" style="padding:0;overflow:hidden"><div style="padding:14px 18px" class="eyebrow">Preview</div>${BrandPreview(b)}</div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Web address</div>
      <div class="field"><label class="fl">Branded link (works now)</label><div class="row"><input class="inp" readonly value="${esc(url)}"><button class="btn btn-ghost btn-sm" data-action="copyLink" data-v="${esc(url)}">Copy</button></div></div>
      ${f('slug', 'Link name', 'text', 'Lowercase letters, numbers and dashes')}
      ${f('branding.domain', 'Custom domain', 'text', 'e.g. tickets.yourvenue.com — point a CNAME record at the platform. Connecting custom domains needs the production hosting (planned for Stage 10); it is saved now and shown as not yet connected.')}
      ${br.domain ? `<span class="chip warn">Not connected yet</span>` : ''}</div>
  </div></div>`;
}
function BrandPreview(b) {
  const br = b.branding, ink = br.ink || '#020a16', acc = br.accent || '#f4cd5e';
  return `<div style="background:${esc(ink)};color:#fff;padding:22px 20px;${safeUrl(br.banner) ? `background-image:linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.6)),url('${safeUrl(br.banner)}');background-size:cover;background-position:center` : ''}">
    ${safeUrl(br.logo) ? `<img src="${esc(safeUrl(br.logo))}" alt="" style="height:36px;margin-bottom:10px">` : ''}
    <div style="font-family:'${esc(br.font)}',var(--display);font-size:30px;line-height:1.05;text-transform:uppercase">${esc(b.name)}</div>
    <div style="opacity:.8;font-size:13px;margin-top:4px">${esc(br.tagline || '')}</div>
    <span style="display:inline-block;margin-top:14px;background:${esc(acc)};color:${inkOn(acc)};padding:8px 16px;border-radius:999px;font-weight:700;font-size:13px">Get tickets</span></div>`;
}

// ── My security (every signed-in person) ─────────────────────────────────────
function Security() {
  const sec = S.ui.sec || (S.ui.sec = { loaded: false });
  if (!sec.loaded) { sec.loaded = true; Promise.all([DB.mfaStatus(S.user.email), DB.sessions(S.user.email)]).then(([mfa, ss]) => { Object.assign(sec, { mfa, sessions: ss }); render(); }).catch(e => toast(e.message, true)); }
  const sid = sessionStorage.getItem('set_demo_sid');
  return head('My security', esc(S.user.email)) + `<div class="cols"><div class="stack">
    <div class="card"><div class="between"><h3>Two-factor sign-in</h3>${sec.mfa ? '<span class="chip ok">On</span>' : '<span class="chip">Off</span>'}</div>
      <p class="small muted" style="margin:6px 0 14px">After the email code, you'll also enter a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy…). ${S.adm.bo?.settings?.require2fa ? '<b>This box office requires it.</b>' : ''}</p>
      ${sec.enr ? `<div class="mfa-setup"><div data-qr="${esc(sec.enr.uri)}" class="mfa-qr"></div><div><p class="small">1. Scan this with your authenticator app<br>2. Enter the 6-digit code it shows</p>
          <p class="small muted" style="margin:8px 0">Can't scan? Key: <code style="word-break:break-all">${esc(sec.enr.secret)}</code></p>
          <div class="row"><input class="inp" id="mfaCode" inputmode="numeric" maxlength="6" placeholder="123456" style="max-width:140px"><button class="btn btn-accent" data-action="mfaConfirm">Turn on</button></div></div></div>`
        : sec.mfa ? `<div class="row"><input class="inp" id="mfaCode" inputmode="numeric" maxlength="6" placeholder="Current code" style="max-width:160px"><button class="btn btn-ghost" data-action="mfaOff">Turn off</button></div>`
        : `<button class="btn btn-accent" data-action="mfaStart">Set up two-factor</button>`}</div>
    <div class="card"><h3>Password & account recovery</h3><p class="small muted" style="margin-top:6px">There are no passwords to steal or forget: each sign-in sends a fresh one-time code to your email, so “reset password” is simply signing in again. If you lose your authenticator phone, the box office owner or platform support can reset your two-factor after confirming who you are.</p></div>
  </div><div class="stack"><div class="card"><div class="between"><h3>Signed-in devices</h3>${sec.sessions?.length > 1 || DB.live ? `<button class="btn btn-ghost btn-sm" data-action="revokeOthers">Sign out all other devices</button>` : ''}</div>
    ${sec.sessions ? sec.sessions.map(s => `<div class="between small" style="padding:9px 0;border-bottom:1px solid var(--line)"><div><b>${esc(s.ua || 'Browser')}</b>${s.id === sid ? ' <span class="chip ok">This device</span>' : ''}<div class="muted">Signed in ${esc(fmtDT(s.created_at))} · active ${esc(ago(s.last_seen))}</div></div>${s.id !== sid ? `<button class="btn btn-ghost btn-sm" data-action="revokeSess" data-v="${s.id}">Sign out</button>` : ''}</div>`).join('')
      : DB.live ? '<p class="small muted">Signing out other devices ends every session except this one.</p>' : '<p class="small muted">Loading…</p>'}</div>
    <div class="card"><h3>My recent activity</h3>${(S.adm.audit || []).filter(a => a.actor === S.user.email).slice(0, 8).map(a => `<div class="between small" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(a.summary)}</span><span class="muted">${esc(ago(a.at))}</span></div>`).join('') || '<p class="small muted">Nothing yet.</p>'}</div></div></div>`;
}

function Settings() {
  const s = S.ui.set || (S.ui.set = JSON.parse(JSON.stringify(S.adm.bo.settings)));
  const f = (path, label, t = 'text', hint = '') => { const v = getPath(s, path); const val = t === 'money' ? (+v / 100 || 0) : v ?? '';
    return `<div class="field"><label class="fl">${label}</label><input class="inp" type="${t === 'money' || t === 'num' ? 'number' : t}" ${t === 'money' ? 'step="0.01"' : ''} data-bind="set.${path}" data-t="${t}" value="${esc(val)}">${hint ? `<div class="small muted" style="margin-top:4px">${hint}</div>` : ''}</div>`; };
  const c = (path, label) => `<label class="check" style="margin-bottom:8px"><input type="checkbox" data-bind="set.${path}" data-t="bool" ${getPath(s, path) ? 'checked' : ''}> <span>${label}</span></label>`;
  return head('Settings', esc(S.adm.bo.name) + ' — fees, payments and security', `<button class="btn btn-accent" data-action="saveSettings">Save settings</button>`) + `
  <div class="cols"><div class="stack">
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Box office</div>
      <div class="field"><label class="fl">Default currency</label><select class="inp" data-bind="set.currency">${['USD', 'GBP', 'EUR', 'ILS', 'CAD'].map(x => `<option ${s.currency === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <p class="small muted">Name, logo, colours, contact details and policies are on the <a href="#/admin/branding">Branding</a> page.</p></div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Fees & tax</div><div class="grid3">${f('feePct', 'Booking fee %', 'num')}${f('feeFixed', 'Booking fee per ticket', 'money')}${f('taxPct', 'Sales tax %', 'num')}</div>
      <div class="field"><label class="fl">Who pays the booking fee?</label><select class="inp" data-bind="set.feeMode"><option value="buyer" ${s.feeMode === 'buyer' ? 'selected' : ''}>Buyer (added at checkout)</option><option value="absorb" ${s.feeMode === 'absorb' ? 'selected' : ''}>We absorb it</option></select></div>
      ${c('donations', 'Offer a donation at checkout')}</div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Staff security</div>${c('require2fa', 'Require two-factor sign-in for everyone on this team')}
      <p class="small muted">People without it are asked to set it up before they can see anything. <a href="#/admin/security">Set up yours</a>.</p></div>
  </div><div class="stack">
    ${can('admin.payments') ? `<div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Payments</div>
      <div class="item-card"><div class="between"><b>Stripe — cards, Apple Pay, Google Pay</b><span class="chip ${DB.live ? 'warn' : 'info'}">${DB.live ? 'Not connected' : 'Demo'}</span></div><p class="small muted" style="margin-top:6px">Each box office connects its own payment account, so payouts go straight to you. Other processors plug into the same slot (Stage 5).</p></div>
      <div style="margin-top:12px">${c('payments.card', 'Accept card payments')}${c('payments.offline', 'Allow “pay later / at the door” reservations')}</div></div>` : ''}
    ${can('admin.integrations') ? `<div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Tracking</div>${f('pixels.ga4', 'Google Analytics 4 ID', 'text', 'e.g. G-XXXXXXX')}${f('pixels.meta', 'Meta Pixel ID')}</div>` : ''}
    ${can('admin.api') ? `<div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Developers</div><p class="small muted">REST API + RPCs via Supabase: <code>place_order</code>, <code>availability</code>, <code>checkin</code>. Access follows the same box office and permission rules. Webhooks arrive in Stage 8.</p>
      ${!DB.live ? `<div class="sep"></div><button class="btn btn-danger btn-sm" data-action="demoReset">Reset demo data</button>` : ''}</div>` : ''}
  </div></div>`;
}

// ── Modal ───────────────────────────────────────────────────────────────────
function modal(title, body, foot) {
  $('#modal').innerHTML = `<div class="modal-bg" data-action="closeModal" data-self="1"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-h"><h3>${title}</h3><button class="icon-btn" data-action="closeModal" aria-label="Close">${ic('x', 15)}</button></div><div class="modal-b">${body}</div>${foot ? `<div class="modal-f">${foot}</div>` : ''}</div></div>`;
}
const closeModal = () => { $('#modal').innerHTML = ''; };

// ══════════════════════════════════════════════════════════════════════════════
//  PLATFORM SUPER ADMIN  (#/platform) — separate from every box office's back office
// ══════════════════════════════════════════════════════════════════════════════
const PNAV = [['overview', 'Overview', 'home'], ['boxoffices', 'Box offices', 'cal'], ['activity', 'Activity log', 'chart'], ['settings', 'Platform settings', 'gear']];
function PlatformShell() {
  if (!S.user || S.user.mfa) return Login('Platform sign in', 'open the platform dashboard');
  if (!S.adm?.super) return `<div class="empty" style="padding-top:20vh"><div class="display" style="font-size:32px">Super admins only</div><p class="muted" style="margin:10px 0 18px">${esc(S.user.email)} isn't a platform administrator.</p><a class="btn btn-dark" href="#/admin">Go to my box office</a></div>`;
  if (!S.plat) { DB.loadPlatform().then(p => { S.plat = p; render(); }).catch(e => toast(e.message, true)); return `<div class="empty" style="padding-top:30vh">Loading…</div>`; }
  const sub = S.route.params[0] || 'overview', page = { overview: POverview, boxoffices: PBoxOffices, activity: PActivity, settings: PSettings }[sub] || POverview;
  return `<div class="admin plat">
    <aside class="side"><a class="logo" href="#/platform">${logo()}<small>Platform admin</small></a><div class="grp">Platform</div>
      ${PNAV.map(([k, t, i]) => `<a class="nav ${sub === k ? 'on' : ''}" href="#/platform/${k}">${ic(i)}${t}</a>`).join('')}
      <div class="grp">Switch</div>${S.adm.bo ? `<a class="nav" href="#/admin">${ic('ticket')}My box office</a>` : ''}<a class="nav" href="#/" target="_blank">${ic('ext')}Public site</a>
      <div class="me"><div style="color:#fff;font-weight:600">${esc(S.user.email)}</div><div class="muted">Super admin</div><a href="#" data-action="signOut" style="color:var(--accent);font-size:12px;display:inline-block;margin-top:6px">Sign out</a></div></aside>
    <main class="main">${!DB.live ? `<div class="banner info">Demo mode — data is stored in this browser only.</div>` : ''}${page()}</main>
    <nav class="mob-nav">${PNAV.map(([k, t, i]) => `<a class="${sub === k ? 'on' : ''}" href="#/platform/${k}">${ic(i)}${t.split(' ')[0]}</a>`).join('')}</nav></div>`;
}
const boChip = s => `<span class="chip ${{ active: 'ok', pending: 'warn', suspended: 'bad', deactivated: '' }[s]}">${esc(BO_STATUS[s])}</span>`;
function POverview() {
  const P = S.plat, live = P.orders.filter(o => ['paid', 'pending'].includes(o.status)), since = Date.now() - 30 * 864e5;
  const by = s => P.bos.filter(b => b.status === s).length, pend = P.bos.filter(b => b.status === 'pending');
  return head('Platform overview', `${P.bos.length} box offices · ${esc(P.platform.name)}`, `<button class="btn btn-accent" data-action="newBo">${ic('plus', 15)} New box office</button>`) + `
  ${pend.length ? `<div class="banner warn" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><span><b>${pend.length} waiting for approval:</b> ${pend.map(b => esc(b.name)).join(', ')}</span><a class="btn btn-dark btn-sm" href="#/platform/boxoffices">Review</a></div>` : ''}
  <div class="kpis"><div class="kpi dark"><div class="eyebrow">Processing volume</div><div class="v">${money(sum(live, o => o.total))}</div><div class="d" style="color:var(--mut)">${money(sum(live.filter(o => D(o.created_at) >= since), o => o.total))} last 30 days</div></div>
    <div class="kpi"><div class="eyebrow">Platform fees earned</div><div class="v">${money(sum(live, o => o.platformFee))}</div><div class="d">${esc(P.platform.feePct)}% + ${money(P.platform.feeFixed)} / paid ticket</div></div>
    <div class="kpi"><div class="eyebrow">Tickets sold</div><div class="v">${sum(P.bos, b => b.stats.tickets).toLocaleString()}</div><div class="d">${live.length} orders</div></div>
    <div class="kpi"><div class="eyebrow">Box offices</div><div class="v">${by('active')}</div><div class="d">${by('pending')} pending · ${by('suspended')} suspended · ${sum(P.bos, b => b.stats.staff)} staff</div></div></div>
  <div class="cols"><div class="card"><h3>Platform sales</h3><div class="small muted">Gross across every box office, last 28 days</div>${barChart(dailySeries(live.map(o => ({ ...o, data: { total: o.total } })), 28, o => o.data.total), v => money(v))}</div>
    <div class="card"><h3>System health</h3>${[['Website & event pages', 'ok'], ['Checkout', 'ok'], ['Scanner sync', 'ok'], ['Database', DB.live ? 'ok' : 'demo'], ['Card payments (Stripe)', 'off'], ['Email delivery', 'off'], ['SMS', 'off']].map(([n, s]) =>
      `<div class="between small" style="padding:7px 0;border-bottom:1px solid var(--line)"><span>${n}</span>${s === 'ok' ? '<span class="chip ok">Operational</span>' : s === 'demo' ? '<span class="chip info">Demo (browser)</span>' : '<span class="chip">Not connected</span>'}</div>`).join('')}
      <p class="small muted" style="margin-top:10px">Full monitoring and incident history arrive with Stage 10.</p></div></div>
  <div class="card" style="margin-top:18px"><div class="between" style="margin-bottom:8px"><h3>Latest platform activity</h3><a class="small" href="#/platform/activity">All activity</a></div>
    ${P.audit.slice(0, 8).map(a => `<div class="between small" style="padding:7px 0;border-bottom:1px solid var(--line)"><span><b>${esc(a.actor)}</b> · ${esc(a.summary)}</span><span class="muted">${esc(ago(a.at))}</span></div>`).join('')}</div>`;
}
function PBoxOffices() {
  const P = S.plat;
  return head('Box offices', 'Create, approve, suspend and support organizer accounts', `<button class="btn btn-accent" data-action="newBo">${ic('plus', 15)} New box office</button>`) + `
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Box office</th><th>Status</th><th>Owner</th><th>Events</th><th>Sales</th><th>Fees earned</th><th>Staff</th><th></th></tr></thead><tbody>
  ${P.bos.slice().sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0) || a.name.localeCompare(b.name)).map(b => `<tr><td><b>${esc(b.name)}</b><div class="small muted">/b/${esc(b.slug)} · since ${esc(fmtDate(b.created_at, { month: 'short', year: 'numeric' }))}${b.created_by === 'self-registration' ? ' · self-registered' : ''}</div></td>
    <td>${boChip(b.status)}</td><td class="small">${esc(b.owner)}</td><td class="tnum">${b.stats.events}</td><td class="tnum">${money(b.stats.gross)}<div class="small muted">${b.stats.orders} orders</div></td><td class="tnum">${money(b.stats.platformFees)}</td><td class="tnum">${b.stats.staff}</td>
    <td style="white-space:nowrap;text-align:right">${b.status === 'pending' ? `<button class="btn btn-accent btn-sm" data-action="boStatus" data-id="${b.id}" data-v="active">Approve</button> <button class="btn btn-ghost btn-sm" data-action="boStatus" data-id="${b.id}" data-v="deactivated">Decline</button>`
      : b.status === 'active' ? `<button class="btn btn-ghost btn-sm" data-action="support" data-id="${b.id}">Open (support)</button> <button class="btn btn-ghost btn-sm" data-action="boStatus" data-id="${b.id}" data-v="suspended">Suspend</button>`
      : b.status === 'suspended' ? `<button class="btn btn-dark btn-sm" data-action="boStatus" data-id="${b.id}" data-v="active">Reactivate</button> <button class="btn btn-ghost btn-sm" data-action="boStatus" data-id="${b.id}" data-v="deactivated">Deactivate</button>`
      : `<button class="btn btn-ghost btn-sm" data-action="boStatus" data-id="${b.id}" data-v="active">Reactivate</button> ${b.stats.orders ? '<span class="small muted" title="Has sales history">records kept</span>' : `<button class="btn btn-danger btn-sm" data-action="boDelete" data-id="${b.id}">Delete…</button>`}`}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="cols" style="margin-top:18px"><div class="card small"><h3>What each status means</h3><p class="muted" style="margin-top:6px"><b>Suspended</b> — event pages and checkout go offline and staff can't sign in; nothing is deleted. <b>Deactivated</b> — closed for good, all records kept and still exportable. <b>Delete</b> is separate and only possible for a deactivated box office that never sold a ticket, so order and financial history can't be erased by accident.</p></div>
  <div class="card small"><h3>Support access</h3><p class="muted" style="margin-top:6px">“Open (support)” lets you into an organizer's back office with full access to troubleshoot. It's shown to you as a banner and every visit is written to that box office's activity log.</p></div></div>`;
}
function NewBoModal() {
  const f = S.ui.nb || (S.ui.nb = { name: '', slug: '', ownerEmail: '', ownerName: '' });
  modal('New box office', `<p class="small muted" style="margin-bottom:14px">Box offices you create are approved straight away. The owner signs in with their email and gets full access.</p>
    <div class="field"><label class="fl">Box office name</label><input class="inp" data-input="nb.name" value="${esc(f.name)}"></div>
    <div class="field"><label class="fl">Link name (optional)</label><input class="inp" data-input="nb.slug" placeholder="my-venue" value="${esc(f.slug)}"></div>
    <div class="grid2"><div class="field"><label class="fl">Owner name</label><input class="inp" data-input="nb.ownerName" value="${esc(f.ownerName)}"></div><div class="field"><label class="fl">Owner email</label><input class="inp" type="email" data-input="nb.ownerEmail" value="${esc(f.ownerEmail)}"></div></div>`,
    `<button class="btn btn-ghost" data-action="closeModal">Cancel</button><button class="btn btn-accent" data-action="createBo">Create box office</button>`);
}
function PActivity() {
  return head('Activity log', 'Every sign-in, permission change and admin action across the platform') + AuditFilters(S.plat.audit) + AuditTable(auditRows(S.plat.audit), true);
}
function PSettings() {
  const f = S.ui.ps || (S.ui.ps = JSON.parse(JSON.stringify({ ...S.plat.platform, adminsText: S.plat.platform.admins.join(', ') })));
  return head('Platform settings', 'Applies to every box office', `<button class="btn btn-accent" data-action="savePlatform">Save</button>`) + `
  <div class="cols"><div class="stack"><div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Registration</div>
      <label class="check" style="margin-bottom:8px"><input type="checkbox" data-bind="ui.ps.publicRegistration" data-t="bool" ${f.publicRegistration ? 'checked' : ''}> <span>Allow organizers to register a box office themselves at <code>#/register</code></span></label>
      <p class="small muted">Off at launch. Even when on, every new box office waits for a super admin's approval before it can sell.</p></div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Platform fees</div><div class="grid2">
      <div class="field"><label class="fl">Percent of ticket sales</label><input class="inp" type="number" step="0.1" data-bind="ui.ps.feePct" data-t="num" value="${esc(f.feePct)}"></div>
      <div class="field"><label class="fl">Per paid ticket</label><input class="inp" type="number" step="0.01" data-bind="ui.ps.feeFixed" data-t="money" value="${esc(+f.feeFixed / 100)}"></div></div>
      <p class="small muted">Recorded on each new order and deducted from the organizer's payout — buyers don't see it. Box offices set their own booking fees separately.</p>
      <div class="field"><label class="fl">Subscription / service pricing</label><textarea class="inp" data-bind="ui.ps.plans">${esc(f.plans || '')}</textarea></div></div></div>
  <div class="stack"><div class="card"><div class="eyebrow dash" style="margin-bottom:12px">General</div><div class="field"><label class="fl">Platform name</label><input class="inp" data-bind="ui.ps.name" value="${esc(f.name)}"></div>
    <div class="field"><label class="fl">Super admins</label><input class="inp" data-bind="ui.ps.adminsText" value="${esc(f.adminsText)}"><div class="small muted" style="margin-top:4px">Comma-separated emails. Super admins can see and manage every box office.</div></div></div></div></div>`;
}

// ── Public: a box office's own page, and self-registration ──────────────────────
function BoxOfficePage() {
  const bo = S.bos.find(b => b.slug === S.route.params[0]); if (!bo) return NotFound();
  const br = bo.branding, evs = listedEvents().filter(e => e.box_office_id === bo.id);
  const soc = [['website', br.website, br.website], ['instagram', br.instagram, br.instagram && 'https://instagram.com/' + br.instagram.replace(/^@/, '')], ['facebook', br.facebook, br.facebook], ['tiktok', br.tiktok, br.tiktok && 'https://tiktok.com/@' + br.tiktok.replace(/^@/, '')]].filter(x => safeUrl(x[2]));
  return `<header class="bo-hero" style="${safeUrl(br.banner) ? `background-image:linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.7)),url('${safeUrl(br.banner)}')` : ''}"><div class="container">
      ${safeUrl(br.logo) ? `<img class="bo-logo" src="${esc(safeUrl(br.logo))}" alt="${esc(bo.name)}">` : ''}<h1 class="display">${esc(bo.name)}</h1>${br.tagline ? `<p>${esc(br.tagline)}</p>` : ''}
      ${soc.length ? `<div class="row wrap" style="margin-top:14px">${soc.map(([k, , u]) => `<a class="btn glass btn-sm" href="${esc(u)}" target="_blank" rel="noopener">${k[0].toUpperCase() + k.slice(1)}</a>`).join('')}</div>` : ''}</div></header>
    <section class="container section"><div class="eyebrow dash" style="margin-bottom:16px">Upcoming events</div>
      ${evs.length ? `<div class="ev-grid">${evs.map(EvCard).join('')}</div>` : '<div class="empty">No events on sale right now — check back soon.</div>'}</section>
    <section class="container section" style="padding-top:0"><div class="cols"><div class="card"><h3>Contact</h3><p class="small" style="margin-top:6px">${bo.settings.contactEmail ? `<a href="mailto:${esc(bo.settings.contactEmail)}">${esc(bo.settings.contactEmail)}</a>` : ''}${br.phone ? '<br>' + esc(br.phone) : ''}</p></div>
      <div class="card"><h3>Policies</h3><p class="small" style="margin-top:6px"><a href="#" data-action="showPolicy" data-v="terms">Terms</a>${br.refundPolicy ? ' · <a href="#" data-action="showPolicy" data-v="refundPolicy">Refunds</a>' : ''}${br.privacyPolicy ? ' · <a href="#" data-action="showPolicy" data-v="privacyPolicy">Privacy</a>' : ''}</p></div></div></section>`;
}
function Register() {
  const f = S.ui.reg || (S.ui.reg = { name: '', ownerName: '', ownerEmail: '', done: false });
  if (!S.platform.publicRegistration) return `<div class="container section"><div class="empty"><div class="display" style="font-size:34px">Invitation only</div><p class="muted" style="margin:10px 0 18px">New box offices are set up by the platform team. Get in touch and we'll create yours.</p><a class="btn btn-dark" href="#/">Back to events</a></div></div>`;
  if (f.done) return `<div class="container section"><div class="empty"><div class="display" style="font-size:34px">Request received</div><p class="muted" style="margin:10px 0 18px">We'll review <b>${esc(f.name)}</b> and email ${esc(f.ownerEmail)} once it's approved.</p></div></div>`;
  return `<div class="container section" style="max-width:520px"><div class="card"><h1 class="display" style="font-size:32px">Start selling tickets</h1><p class="muted" style="margin:6px 0 18px">Tell us about your organization. Every new box office is reviewed before it goes live.</p>
    <div class="field"><label class="fl">Organization name</label><input class="inp" data-input="reg.name" value="${esc(f.name)}"></div>
    <div class="grid2"><div class="field"><label class="fl">Your name</label><input class="inp" data-input="reg.ownerName" value="${esc(f.ownerName)}"></div><div class="field"><label class="fl">Work email</label><input class="inp" type="email" data-input="reg.ownerEmail" value="${esc(f.ownerEmail)}"></div></div>
    <button class="btn btn-accent btn-block btn-lg" data-action="register">Request a box office</button></div></div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  ACTIONS
// ══════════════════════════════════════════════════════════════════════════════
const dirty = () => { S.dirty = true; const b = $('[data-action="saveEvent"]'); if (b) b.disabled = false; };
const newTT = () => ({ id: shortId('tt_'), name: 'General admission', price: 0, qty: 0, min: 1, max: 10, admits: 1, desc: '', hidden: false });
function upsertLocal(list, item, key = 'id') { const i = list.findIndex(x => x[key] === item[key]); if (i >= 0) list[i] = item; else list.push(item); }
async function persistEvent(ev) {
  // Public "locked" flags so buyers see a password prompt; the passwords stay in secrets.
  ev.hasPassword = !!ev.secrets?.password;
  ev.ticketTypes.forEach(t => { t.locked = !!ev.secrets?.ticketPasswords?.[t.id]; });
  if (ev.seating?.enabled) {
    const codes = (ev.seating.sections || []).map(x => String(x.code || '').trim().toUpperCase());
    if (codes.some(c => !/^[A-Z0-9]{1,6}$/.test(c))) throw new Error('Section codes must be 1–6 letters or numbers');
    if (new Set(codes).size !== codes.length) throw new Error('Two sections share the same code');
    ev.seating.sections.forEach((x, i) => x.code = codes[i]);
    ev.seating.index = seatIndex(ev.seating);
    if (!Object.keys(ev.seating.index).length) throw new Error('The seating map has no seats with a price');
  }
  const saved = await DB.saveEvent(ev);
  upsertLocal(S.adm.events, JSON.parse(JSON.stringify(saved)));
  S.events = S.events.filter(e => e.id !== saved.id); if (eventLive(normEvent(saved))) { const { secrets, ...pub } = saved; S.events.push({ ...pub, hasPassword: !!secrets?.password, ticketTypes: pub.ticketTypes.map(t => ({ ...t, locked: !!secrets?.ticketPasswords?.[t.id] })) }); }
  return saved;
}
const A = {
  go: el => { location.hash = el.dataset.v; },
  homeView: el => { S.home.view = el.dataset.v; render(); },
  homeCat: el => { S.home.cat = el.dataset.v; render(); },
  calMove: el => { const b = S.home.month ? new Date(S.home.month) : new Date(listedEvents()[0]?.start || Date.now()); b.setDate(1); b.setMonth(b.getMonth() + +el.dataset.v); S.home.month = b.toISOString(); render(); },
  ics: el => { const ev = evById(el.dataset.id); download(slugify(ev.name) + '.ics', ics(ev), 'text/calendar'); },
  copyLink: async el => { try { await navigator.clipboard.writeText(el.dataset.v); toast('Link copied'); } catch (e) { toast(el.dataset.v); } },
  print: () => window.print(),
  pickSlot: el => { S.sel.slotId = el.dataset.id; S.sel.seats = []; render(); },
  qty: el => { const q = S.sel.qty, id = el.dataset.id, d = +el.dataset.d, cur = q[id] || 0;
    let n = cur + d; if (d > 0 && cur === 0) n = Math.max(1, +el.dataset.min || 1); if (d < 0 && n < (+(S.events.find(e => e.id === S.sel.eventId)?.ticketTypes.find(t => t.id === id)?.min) || 1)) n = 0;
    q[id] = Math.max(0, Math.min(n, +el.dataset.max || 99)); render(); },
  addon: el => { const a = S.sel.addons; a[el.dataset.id] = Math.max(0, (a[el.dataset.id] || 0) + +el.dataset.d); render(); },
  pickSeat: el => { const s = el.dataset.v, a = S.sel.seats; const i = a.indexOf(s); if (i >= 0) a.splice(i, 1); else if (a.length < 10) a.push(s); else toast('Maximum 10 seats per order'); render(); },
  unlock: async () => { const ev = evById(S.sel.eventId); try { const r = await DB.unlock(ev.id, S.sel.pw); if (r?.event || r?.ticketTypes?.length) { S.sel.unlocked = { event: S.sel.unlocked.event || r.event, tts: [...S.sel.unlocked.tts, ...(r.ticketTypes || [])] }; S.cart.unlock[ev.id] = S.sel.pw; saveCart(); toast('Unlocked'); } else toast('That code isn\'t valid', true); render(); } catch (e) { toast(e.message, true); } },
  addToCart: () => {
    const ev = evById(S.sel.eventId), sel = S.sel;
    const items = ev.seating?.enabled
      ? ev.ticketTypes.map(t => ({ eventId: ev.id, ticketTypeId: t.id, slotId: sel.slotId || null, seats: sel.seats.filter(s => ev.seating.index?.[s] === t.id) })).filter(i => i.seats.length).map(i => ({ ...i, qty: i.seats.length }))
      : Object.entries(sel.qty).filter(([, q]) => q > 0).map(([id, q]) => ({ eventId: ev.id, ticketTypeId: id, slotId: sel.slotId || null, qty: q, seats: [] }));
    if (S.cart.items.some(i => boOf(evById(i.eventId))?.id !== ev.box_office_id)) { S.cart = { items: [], addons: [], donation: 0, unlock: {} }; S.co.disc = null; toast('Your cart had another organizer\'s tickets — it now holds just this event'); }
    S.cart.items = S.cart.items.filter(i => i.eventId !== ev.id).concat(items);
    S.cart.addons = S.cart.addons.filter(a => a.eventId !== ev.id).concat(Object.entries(sel.addons).filter(([, q]) => q > 0).map(([id, q]) => ({ eventId: ev.id, addonId: id, qty: q })));
    if (sel.pw) S.cart.unlock[ev.id] = sel.pw;
    saveCart(); location.hash = S.route.page === 'embed' ? '#/cart?embed' : '#/cart';
  },
  removeEv: el => { S.cart.items = S.cart.items.filter(i => i.eventId !== el.dataset.id); S.cart.addons = S.cart.addons.filter(i => i.eventId !== el.dataset.id); saveCart(); render(); },
  donate: el => { S.cart.donation = +el.dataset.v; saveCart(); render(); },
  pay: el => { S.co.payment = el.dataset.v; render(); },
  showTerms: () => modal('Terms & conditions', `<p style="white-space:pre-line">${esc(S.settings.terms)}</p>`),
  applyCode: async () => { const code = S.co.code.trim(); if (!code) return; for (const id of new Set(S.cart.items.map(i => i.eventId))) { const d = await DB.checkDiscount(id, code).catch(() => null); if (d) { S.co.disc = d; S.co.err = ''; toast('Code applied'); return render(); } } toast('That code isn\'t valid', true); },
  removeCode: () => { S.co.disc = null; S.co.code = ''; render(); },
  placeOrder: async () => {
    const co = S.co; co.err = '';
    if (!co.name.trim() || !EMAIL_RE.test(co.email)) co.err = 'Please enter your name and a valid email.';
    else if (!co.terms) co.err = 'Please accept the terms & conditions.';
    const qs = [...new Set(S.cart.items.map(i => i.eventId))].flatMap(id => evById(id)?.questions || []).filter(q => q.required && !co.answers[q.id]);
    if (!co.err && qs.length) co.err = 'Please answer: ' + qs.map(q => q.label).join(', ');
    if (co.err) return render();
    co.busy = true; render();
    try {
      const q = cartQuote();
      const r = await DB.placeOrder({ buyer: { name: co.name.trim(), email: co.email.trim(), phone: co.phone.trim() }, items: S.cart.items, addons: S.cart.addons, code: co.disc?.code || '',
        donation: S.cart.donation || 0, payment: q.total === 0 ? 'free' : co.payment, answers: co.answers, optIn: co.optIn, source: sessionStorage.getItem('set_src') || null, unlock: S.cart.unlock });
      S.cart = { items: [], addons: [], donation: 0, unlock: {} }; saveCart();
      S.co = { ...S.co, busy: false, disc: null, code: '', answers: {}, terms: false };
      S.avail = {}; _availReq.clear(); S.order = null;
      if (S.adm) await reloadAdmin();
      location.hash = '#/order/' + r.id + '/' + r.key;
    } catch (e) { co.busy = false; co.err = e.message; render(); }
  },
  resendMine: () => toast(DB.live ? 'Email delivery is not connected yet — save this page.' : 'Demo mode: email sending is off. Your tickets are on this page.'),
  findOrder: async () => { const f = S.ui.find || {}; try { const r = await DB.lookupOrder(f.ref || '', f.email || ''); if (r) location.hash = '#/order/' + r.id + '/' + r.key; else { f.err = 'No order matches that number and email.'; S.ui.find = f; render(); } } catch (e) { toast(e.message, true); } },
  joinWaitlist: async el => { const w = S.ui.wl || {}; try { await DB.joinWaitlist(el.dataset.id, w.name || '', w.email || '', w.phone || ''); S.ui.wl = { done: el.dataset.id }; render(); } catch (e) { toast(e.message, true); } },
  // ── admin ──
  login: async () => {
    const l = S.ui.login; l.err = '';
    if (!EMAIL_RE.test(l.email)) { l.err = 'Enter a valid email'; return render(); }
    try {
      if (DB.live && !l.sent) { await DB.sendCode(l.email); l.sent = true; toast('Code sent — check your email'); return render(); }
      const r = await DB.verifyCode(l.email, l.code.trim());
      if (r?.mfa) { l.mfa = true; l.totp = ''; S.user = DB.live ? r : null; return render(); }
      S.user = r; await afterLogin();
    } catch (e) { l.err = e.message; S.user = null; S.adm = null; render(); }
  },
  loginMfa: async () => {
    const l = S.ui.login; l.err = '';
    try { S.user = await DB.verifyMfa(l.email || S.user?.email, (l.totp || '').trim()); l.mfa = false; await afterLogin(); }
    catch (e) { l.err = e.message; render(); }
  },
  demoAs: el => { S.ui.login.email = el.dataset.v; A.login(); },
  signOut: async () => { await DB.signOut(); S.user = null; S.adm = null; S.plat = null; S.ui.login = { email: '', code: '', sent: false, totp: '' }; S.ui.sec = null; location.hash = '#/'; },
  exitSupport: async () => { S.ui.support = null; await reloadAdmin(); location.hash = '#/platform/boxoffices'; },
  support: async el => { try { S.ui.support = el.dataset.id; await reloadAdmin(el.dataset.id); location.hash = '#/admin/dashboard'; } catch (e) { toast(e.message, true); } },
  // ── team & permissions ──
  evScope: el => { const o = el.dataset.p === 'pe' ? S.ui.pe.obj : S.ui.inv; o.events = el.dataset.v === 'all' ? 'all' : (Array.isArray(o.events) ? o.events : []); if (el.dataset.p === 'pe') S.ui.pe.dirty = true; render(); },
  evPick: el => { const o = el.dataset.p === 'pe' ? S.ui.pe.obj : S.ui.inv, a = o.events; const i = a.indexOf(el.dataset.v); if (i >= 0) a.splice(i, 1); else a.push(el.dataset.v); if (el.dataset.p === 'pe') S.ui.pe.dirty = true; render(); },
  permLvl: el => { const pe = S.ui.pe, g = el.dataset.g; pe.obj.perms = pe.obj.perms.filter(k => !k.startsWith(g + '.')).concat(el.dataset.v === 'none' ? [] : groupPerms(g, el.dataset.v === 'view')); pe.dirty = true; render(); },
  permKey: el => { const pe = S.ui.pe, k = el.dataset.v; pe.obj.perms = pe.obj.perms.includes(k) ? pe.obj.perms.filter(x => x !== k) : pe.obj.perms.concat(k); pe.dirty = true; render(); },
  savePerms: async () => {
    const pe = S.ui.pe;
    try {
      if (pe.kind === 'member') { const m = await DB.saveMember(pe.obj); upsertLocal(S.adm.team, { ...m }, 'email'); }
      else { const list = S.adm.bo.templates.slice(); upsertLocal(list, pe.obj); await DB.saveTemplates(list); S.adm.bo.templates = list; }
      pe.dirty = false; await reloadAdmin(); toast('Saved'); S.ui.pe = null; location.hash = '#/admin/team/' + (pe.kind === 'member' ? 'members' : 'templates');
    } catch (e) { toast(e.message, true); }
  },
  newTemplate: () => { S.ui.pe = null; location.hash = '#/admin/team/template/new'; },
  rmTemplate: async el => { if (!confirmIn('Delete this template? People already using it keep their permissions.')) return; const list = S.adm.bo.templates.filter(t => t.id !== el.dataset.v); try { await DB.saveTemplates(list); S.adm.bo.templates = list; render(); } catch (e) { toast(e.message, true); } },
  addMember: async () => {
    const t = S.ui.inv; if (!EMAIL_RE.test(t.email || '')) return toast('Enter a valid email', true);
    if (t.events !== 'all' && !t.events.length) return toast('Pick at least one event, or choose “All events”', true);
    const tpl = S.adm.bo.templates.find(x => x.id === t.template);
    try { await DB.saveMember({ email: t.email.trim().toLowerCase(), name: (t.name || '').trim(), perms: tpl.perms, template: tpl.id, events: t.events }); S.ui.inv = null; await reloadAdmin(); toast('Invited — they can sign in with that email now'); render(); } catch (e) { toast(e.message, true); }
  },
  rmMember: async el => { if (!confirmIn('Remove ' + el.dataset.v + '? They lose access immediately, on every device.')) return; try { await DB.removeMember(el.dataset.v); await reloadAdmin(); toast('Access removed'); render(); } catch (e) { toast(e.message, true); } },
  transferOwner: async () => { const e = S.ui.xferTo; if (!e) return toast('Choose who becomes the owner', true); if (!confirmIn(`Make ${e} the owner of ${S.adm.bo.name}?`)) return; try { await DB.transferOwnership(e); S.ui.xferTo = ''; await reloadAdmin(); toast('Ownership transferred'); render(); } catch (err) { toast(err.message, true); } },
  auditDiff: el => { const a = (S.plat?.audit || []).concat(S.adm?.audit || []).find(x => x.id === el.dataset.id); if (!a) return;
    const fmt = v => typeof v === 'object' && v ? Object.entries(v).map(([k, x]) => `<div><span class="muted">${esc(k)}:</span> ${esc(Array.isArray(x) ? x.join(', ') : typeof x === 'object' ? JSON.stringify(x) : x)}</div>`).join('') : esc(v ?? '—');
    modal('Change details', `<p class="small muted">${esc(fmtDT(a.at))} · ${esc(a.actor)}</p><p style="margin:6px 0 14px">${esc(a.summary)}</p><div class="grid2"><div class="card small" style="word-break:break-word"><div class="eyebrow" style="margin-bottom:6px">Before</div>${fmt(a.before)}</div><div class="card small" style="word-break:break-word"><div class="eyebrow" style="margin-bottom:6px">After</div>${fmt(a.after)}</div></div>`); },
  exportAudit: () => { const list = auditRows(S.route.page === 'platform' ? S.plat.audit : S.adm.audit); download('activity-log.csv', csv([['When', 'Who', 'Box office', 'Type', 'What'], ...list.map(a => [a.at, a.actor, a.box_office_id || '', a.kind, a.summary])])); DB.log('export.audit', 'Exported the activity log'); },
  // ── branding & settings ──
  saveBrand: async () => {
    const b = S.ui.brand; b.slug = slugify(b.slug || b.name);
    for (const k of ['logo', 'banner', 'website', 'facebook']) if (b.branding[k] && !safeUrl(b.branding[k])) return toast('Links must start with https://', true);
    if (S.bos.some(x => x.slug === b.slug && x.id !== S.adm.bo.id)) return toast('That link name is taken', true);
    try { await DB.saveBoxOffice({ name: b.name.trim() || S.adm.bo.name, slug: b.slug, branding: b.branding, settings: { ...S.adm.bo.settings, ...b.settings } }); await refreshPublic(); await reloadAdmin(); S.ui.brand = null; toast('Branding saved'); render(); } catch (e) { toast(e.message, true); }
  },
  saveSettings: async () => { try { await DB.saveBoxOffice({ settings: { ...S.adm.bo.settings, ...JSON.parse(JSON.stringify(S.ui.set)) } }); await refreshPublic(); await reloadAdmin(); S.ui.set = null; setContext(); loadPixels(); toast('Settings saved'); render(); } catch (e) { toast(e.message, true); } },
  showPolicy: el => { const k = el.dataset.v, bo = S.bo; modal({ terms: 'Terms & conditions', refundPolicy: 'Refund policy', privacyPolicy: 'Privacy policy' }[k], `<p style="white-space:pre-line">${esc(k === 'terms' ? S.settings.terms : bo?.branding[k] || '')}</p>`); },
  // ── my security ──
  mfaStart: async () => { try { S.ui.sec.enr = await DB.mfaEnroll(S.user.email); render(); } catch (e) { toast(e.message, true); } },
  mfaConfirm: async () => { try { await DB.mfaConfirm(S.user.email, S.ui.sec.enr, $('#mfaCode').value); S.ui.sec = null; await reloadAdmin(); toast('Two-factor sign-in is on'); render(); } catch (e) { toast(e.message, true); } },
  mfaOff: async () => { try { await DB.mfaDisable(S.user.email, $('#mfaCode').value); S.ui.sec = null; await reloadAdmin(); toast('Two-factor sign-in is off'); render(); } catch (e) { toast(e.message, true); } },
  revokeSess: async el => { await DB.revokeSession(el.dataset.v); S.ui.sec = null; toast('That device is signed out'); render(); },
  revokeOthers: async () => { try { await DB.revokeOtherSessions(); S.ui.sec = null; toast('Signed out everywhere else'); render(); } catch (e) { toast(e.message, true); } },
  // ── platform ──
  newBo: () => { S.ui.nb = null; NewBoModal(); },
  createBo: async () => { try { const bo = await DB.createBoxOffice(S.ui.nb); closeModal(); S.ui.nb = null; S.plat = null; await refreshPublic(); toast(bo.name + ' created'); render(); } catch (e) { toast(e.message, true); } },
  boStatus: async el => {
    const v = el.dataset.v, b = S.plat.bos.find(x => x.id === el.dataset.id), verb = { active: b.status === 'pending' ? 'Approve' : 'Reactivate', suspended: 'Suspend', deactivated: b.status === 'pending' ? 'Decline' : 'Deactivate' }[v];
    if (v !== 'active' && !confirmIn(`${verb} ${b.name}? ${v === 'suspended' ? 'Their event pages, checkout and staff access go offline until reactivated.' : 'Their pages go offline; all records are kept.'}`)) return;
    try { await DB.setBoxOfficeStatus(b.id, v); S.plat = null; await refreshPublic(); toast(`${b.name}: ${BO_STATUS[v]}`); render(); } catch (e) { toast(e.message, true); }
  },
  boDelete: async el => { const b = S.plat.bos.find(x => x.id === el.dataset.id); const typed = window.prompt(`Permanently delete ${b.name}? This can't be undone. Type the box office name to confirm.`); if (typed?.trim() !== b.name) return toast('Not deleted'); try { await DB.deleteBoxOffice(b.id); S.plat = null; toast('Deleted'); render(); } catch (e) { toast(e.message, true); } },
  savePlatform: async () => { const f = S.ui.ps; try { await DB.savePlatform({ name: f.name, publicRegistration: !!f.publicRegistration, feePct: +f.feePct || 0, feeFixed: +f.feeFixed || 0, plans: f.plans, admins: f.adminsText.split(',') }); S.ui.ps = null; S.plat = null; await refreshPublic(); toast('Platform settings saved'); render(); } catch (e) { toast(e.message, true); } },
  register: async () => { const f = S.ui.reg; try { await DB.createBoxOffice({ name: f.name, ownerEmail: f.ownerEmail, ownerName: f.ownerName }, true); f.done = true; render(); } catch (e) { toast(e.message, true); } },
  newEvent: () => { if ((S.adm.bo.eventTemplates || []).length) NewEventModal(); else A.blankEvent(); },
  blankEvent: async () => {
    closeModal(); const start = new Date(Date.now() + 30 * 864e5); start.setHours(20, 0, 0, 0); const end = new Date(start.getTime() + 3 * 3600e3);
    const ev = { id: uid(), slug: 'new-event-' + randCode(4).toLowerCase(), status: 'draft', name: 'New event', category: 'Concert', summary: '', description: '', image: '', venue: '', address: '', audience: '', doors: '',
      start: start.toISOString(), end: end.toISOString(), timezone: 'America/New_York', currency: S.settings.currency, capacity: 0, visibility: 'public', online: false, onlineUrl: '',
      ticketTypes: [newTT()], timeSlots: [], seating: { enabled: false }, addons: [], questions: [], waitlistMode: 'soldout', emails: { confirmation: '', reminders: [] }, created_at: new Date().toISOString(),
      allDay: false, contact: { name: '', email: '', phone: '' }, policies: '', instructions: '',
      secrets: { password: '', ticketPasswords: {}, discounts: [] } };
    try { const s = await persistEvent(ev); location.hash = '#/admin/event/' + s.id + '/details'; } catch (e) { toast(e.message, true); }
  },
  dupEvent: async el => {
    const src = S.adm.events.find(e => e.id === el.dataset.id), ev = cloneEventStructure(src);
    Object.assign(ev, { name: src.name + ' (copy)', slug: src.slug + '-' + randCode(3).toLowerCase() });
    try { const s = await persistEvent(ev); toast('Duplicated as a draft'); location.hash = '#/admin/event/' + s.id + '/details'; } catch (e) { toast(e.message, true); }
  },
  fromTemplate: async el => {
    const t = S.adm.bo.eventTemplates.find(x => x.id === el.dataset.v); closeModal();
    const ev = eventFromTemplate(t); if (ev.seating?.enabled) ev.seating.index = seatIndex(ev.seating);
    try { const s = await persistEvent(ev); toast('Created from “' + t.name + '” — set the date and publish'); location.hash = '#/admin/event/' + s.id + '/details'; } catch (e) { toast(e.message, true); }
  },
  saveTemplate: async () => {
    const name = window.prompt('Template name', S.draft.name); if (!name?.trim()) return;
    const list = (S.adm.bo.eventTemplates || []).concat(eventToTemplate(S.draft, name.trim()));
    try { await DB.saveEventTemplates(list); S.adm.bo.eventTemplates = list; toast('Saved as template “' + name.trim() + '”'); } catch (e) { toast(e.message, true); }
  },
  rmEvTemplate: async el => { if (!confirmIn('Delete this template? Events made from it are not affected.')) return; const list = S.adm.bo.eventTemplates.filter(t => t.id !== el.dataset.v); try { await DB.saveEventTemplates(list); S.adm.bo.eventTemplates = list; render(); } catch (e) { toast(e.message, true); } },
  evFilter: el => { S.ui.evf = el.dataset.v; render(); },
  archiveEvent: async () => { S.draft.archived = !S.draft.archived; await A.saveEvent(); },
  notifyWL: async () => { const ev = S.draft; try { const n = await DB.notifyWaitlist(ev.id, S.ui.wlMsg || `Tickets for ${ev.name} are available: ${shareUrl(ev.slug, 'waitlist')}`); S.ui.wlMsg = ''; await reloadAdmin(); toast(`Notified ${n} ${n === 1 ? 'person' : 'people'}`); render(); } catch (e) { toast(e.message, true); } },
  evAccess: async el => {
    const m = JSON.parse(JSON.stringify(S.adm.team.find(x => x.email === el.dataset.v))), id = S.draft.id;
    if (el.dataset.on === '1') m.events = [...new Set([...(m.events === 'all' ? [] : m.events), id])];
    else m.events = (m.events === 'all' ? S.adm.events.map(e => e.id) : m.events).filter(x => x !== id);
    try { await DB.saveMember(m); await reloadAdmin(); toast('Access updated'); render(); } catch (e) { toast(e.message, true); }
  },
  moComp: el => { S.ui.mo.comp = el.checked; },
  genMode: el => { S.ui.gen.mode = el.dataset.v; render(); },
  genDay: el => { const d = S.ui.gen.days, v = +el.dataset.v, i = d.indexOf(v); if (i >= 0) d.splice(i, 1); else d.push(v); render(); },
  saveEvent: async () => {
    const ev = S.draft; ev.slug = slugify(ev.slug || ev.name);
    if (S.adm.events.some(e => e.slug === ev.slug && e.id !== ev.id)) return toast('Another event already uses that URL', true);
    if (!ev.ticketTypes.length) return toast('Add at least one ticket type', true);
    try { const s = await persistEvent(ev); S.draft = JSON.parse(JSON.stringify(s)); S.dirty = false; await reloadAdmin(); toast('Saved'); render(); } catch (e) { toast(e.message, true); }
  },
  setStatus: async el => { if (el.dataset.v === 'cancelled' && !confirmIn('Cancel this event? It will be removed from sale.')) return; S.draft.status = el.dataset.v; await A.saveEvent(); },
  deleteEvent: async () => {
    if (S.adm.tickets.some(t => t.event_id === S.draft.id && t.status === 'valid')) return toast('This event has sold tickets — cancel it instead', true);
    if (!confirmIn('Delete this event permanently?')) return;
    try { await DB.deleteEvent(S.draft.id); S.adm.events = S.adm.events.filter(e => e.id !== S.draft.id); S.events = S.events.filter(e => e.id !== S.draft.id); S.dirty = false; S.draft = null; location.hash = '#/admin/events'; } catch (e) { toast(e.message, true); }
  },
  addTT: () => { S.draft.ticketTypes.push(newTT()); dirty(); render(); },
  delTT: el => { const t = S.draft.ticketTypes[+el.dataset.i]; if (S.adm.tickets.some(x => x.ticket_type_id === t.id && x.status === 'valid')) return toast('Tickets of this type are sold — hide it instead', true); S.draft.ticketTypes.splice(+el.dataset.i, 1); dirty(); render(); },
  moveTT: el => { const a = S.draft.ticketTypes, i = +el.dataset.i; if (i > 0) { [a[i - 1], a[i]] = [a[i], a[i - 1]]; dirty(); render(); } },
  addSlot: () => { (S.draft.timeSlots ||= []).push({ id: shortId('ts_'), start: S.draft.start, capacity: +S.draft.capacity || 100 }); dirty(); render(); },
  delSlot: el => { const s = S.draft.timeSlots[+el.dataset.i]; if (S.adm.tickets.some(t => t.slot_id === s.id)) return toast('This showtime has tickets — hide it or mark it unavailable instead', true); S.draft.timeSlots.splice(+el.dataset.i, 1); dirty(); render(); },
  genSlots: () => {
    const g = S.ui.gen, ev = S.draft, have = new Set((ev.timeSlots || []).map(s => D(s.start).getTime())), out = [];
    const at = (day, hm) => { const [h, m] = String(hm).trim().split(':').map(Number); if (isNaN(h)) return null; const d = new Date(day + 'T00:00'); d.setHours(h, m || 0, 0, 0); return d; };
    const times = String(g.times || '').split(/[,\s]+/).filter(Boolean);
    let days = [];
    if (g.mode === 'custom') days = String(g.dates || '').split(/[\s,]+/).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
    else if (g.mode === 'interval') days = [g.from];
    else { const d = new Date(g.from + 'T00:00'), end = g.until ? new Date(g.until + 'T23:59') : null, max = Math.min(+g.count || 50, 366);
      for (let i = 0; i < 730 && days.length < max && (!end || d <= end); i++, d.setDate(d.getDate() + 1)) if (g.mode === 'daily' || g.days.includes(d.getDay())) days.push(toLocalInput(d.toISOString()).slice(0, 10)); }
    for (const day of days) {
      if (g.mode === 'interval') { const a = at(day, g.times), b = at(day, g.to); for (let t = a; a && b && t <= b; t = new Date(t.getTime() + Math.max(5, +g.every || 60) * 6e4)) out.push(t); }
      else times.forEach(t => { const d = at(day, t); if (d) out.push(d); });
    }
    const fresh = out.filter(d => !have.has(d.getTime()));
    if (!fresh.length) return toast(out.length ? 'Those showtimes already exist' : 'Nothing to add — check the dates and times', true);
    if (fresh.length > 400) return toast('That would add ' + fresh.length + ' showtimes — narrow the range', true);
    (ev.timeSlots ||= []).push(...fresh.map(d => ({ id: shortId('ts_'), start: d.toISOString(), capacity: +g.cap || 0 })));
    ev.timeSlots.sort((a, b) => D(a.start) - D(b.start)); dirty(); toast(`Added ${fresh.length} showtime${fresh.length === 1 ? '' : 's'} — save to keep them`); render();
  },
  zoom: el => { S.ui.zoom = Math.max(1, Math.min(3, (S.ui.zoom || 1) + (+el.dataset.d) * .5)); render(); },
  smMode: el => { S.ui.smMode = el.dataset.v; render(); },
  smPaint: el => { S.ui.smPaint = el.dataset.v; render(); },
  smTemplate: el => { applySeatTemplate(el.dataset.v); },
  smAdd: el => { addSection(el.dataset.v); },
  smDup: () => { const st = S.draft.seating, src = st.sections.find(x => x.id === S.ui.smSel); if (!src) return;
    const c = { ...JSON.parse(JSON.stringify(src)), id: shortId('sec_'), code: nextCode(src.kind === 'table' ? 'T' : 'S'), name: src.name + ' copy', x: (+src.x || 0) + 40, y: (+src.y || 0) + 40 };
    st.sections.push(c); S.ui.smSel = c.id; dirty(); render(); },
  smDel: () => { const st = S.draft.seating, sec = st.sections.find(x => x.id === S.ui.smSel); if (!sec) return;
    if (soldSeatIds(S.draft).some(id => id.startsWith(sec.code + '-'))) return toast('Seats in this section are sold — block them instead', true);
    st.sections = st.sections.filter(x => x !== sec); Object.keys(st.prices || {}).forEach(k => { if (k.startsWith(sec.code + '-')) delete st.prices[k]; });
    S.ui.smSel = ''; dirty(); render(); },
  smClearPrices: () => { const st = S.draft.seating, sec = st.sections.find(x => x.id === S.ui.smSel); Object.keys(st.prices || {}).forEach(k => { if (k.startsWith(sec.code + '-')) delete st.prices[k]; }); dirty(); render(); },
  smDeselect: () => { S.ui.smSel = ''; render(); },
  smSel: el => { S.ui.smSel = el.dataset.id; S.ui.smMode = 'move'; render(); },
  smEqualRows: () => { const sec = S.draft.seating.sections.find(x => x.id === S.ui.smSel); delete sec.rowSeats; dirty(); render(); },
  addQ: () => { (S.draft.questions ||= []).push({ id: shortId('q_'), label: 'New question', type: 'text', options: '', required: false }); dirty(); render(); },
  delQ: el => { S.draft.questions.splice(+el.dataset.i, 1); dirty(); render(); },
  addAddon: () => { (S.draft.addons ||= []).push({ id: shortId('ad_'), name: 'New product', price: 1000, qty: 0 }); dirty(); render(); },
  delAddon: el => { S.draft.addons.splice(+el.dataset.i, 1); dirty(); render(); },
  addDisc: () => { S.draft.secrets.discounts.push({ id: shortId('dc_'), code: randCode(8), type: 'pct', amount: 10, limit: 0, expires: '', ticketTypeIds: [] }); dirty(); render(); },
  delDisc: el => { S.draft.secrets.discounts.splice(+el.dataset.i, 1); dirty(); render(); },
  discTT: el => { const d = S.draft.secrets.discounts[+el.dataset.i]; d.ticketTypeIds = (d.ticketTypeIds || []).filter(x => x !== el.dataset.id); if (el.checked) d.ticketTypeIds.push(el.dataset.id); dirty(); },
  addRem: () => { (S.draft.emails.reminders ||= []).push({ hoursBefore: S.settings.reminderHours || 24, channel: 'email', body: 'See you soon! Doors open at ' + (S.draft.doors || 'the listed time') + '.' }); dirty(); render(); },
  delRem: el => { S.draft.emails.reminders.splice(+el.dataset.i, 1); dirty(); render(); },
  broadcast: async el => { const b = S.ui.bc; if (!b.subject.trim() || !b.body.trim()) return toast('Add a subject and message', true);
    try { const row = await DB.addBroadcast({ event_id: S.draft.id, subject: b.subject, body: b.body, recipients: +el.dataset.n, created_by: S.user.email }); S.adm.broadcasts.push(row); S.ui.bc = { subject: '', body: '' };
      toast('Queued for ' + el.dataset.n + ' buyers — sending is off until email is connected'); render(); } catch (e) { toast(e.message, true); } },
  exportWL: el => { download('waitlist.csv', csv([['Name', 'Email', 'Phone', 'Joined', 'Notified'], ...S.adm.waitlist.filter(w => w.event_id === el.dataset.id).map(w => [w.name, w.email, w.phone || '', w.created_at, w.notified_at || ''])])); DB.log('export.waitlist', 'Exported the waitlist'); },
  openOrder: el => OrderModal(el.dataset.id),
  pick: el => { S.ui.picked[el.dataset.id] = el.checked; render(); },
  orderStatus: async el => { if (['cancelled', 'refunded'].includes(el.dataset.v) && !confirmIn('Cancel this order and void its tickets?' + (el.dataset.v === 'refunded' ? ' Refund the card in Stripe.' : ''))) return;
    try { await DB.setOrderStatus(el.dataset.id, el.dataset.v); await reloadAdmin(); toast('Order ' + el.dataset.v); OrderModal(el.dataset.id); render(); } catch (e) { toast(e.message, true); } },
  bulkCancel: async () => { const ids = Object.keys(S.ui.picked).filter(k => S.ui.picked[k]); if (!confirmIn(`Cancel ${ids.length} orders and void their tickets?`)) return;
    for (const id of ids) { const o = S.adm.orders.find(x => x.id === id); if (o && ['paid', 'pending'].includes(o.status)) await DB.setOrderStatus(id, o.status === 'paid' ? 'refunded' : 'cancelled'); }
    S.ui.picked = {}; await reloadAdmin(); toast(ids.length + ' orders cancelled'); render(); },
  resend: () => toast(DB.live ? 'Email delivery is not connected yet.' : 'Demo mode: email sending is off.'),
  manualOrder: () => { S.ui.mo = null; ManualOrderModal(); },
  saveManual: async () => {
    const m = S.ui.mo, ev = S.adm.events.find(e => e.id === m.ev); if (!ev) return;
    const tt = m.tt || ev.ticketTypes[0].id, qty = Math.max(1, +m.qty || 1), slot = ev.timeSlots?.length ? (m.slot || ev.timeSlots[0].id) : null;
    let seats = [];
    if (ev.seating?.enabled) { const av = availabilityFrom(S.adm.tickets, ev.id);
      seats = Object.keys(ev.seating.index || {}).filter(id => ev.seating.index[id] === tt && !av.seats.includes((slot || '') + '|' + id)).slice(0, qty);
      if (seats.length < qty) return toast('Not enough free seats in that tier', true); }
    try { await DB.placeOrder({ buyer: { name: m.name, email: m.email, phone: '' }, items: [{ eventId: ev.id, ticketTypeId: tt, qty, slotId: slot, seats }], addons: [], payment: 'manual', comp: !!m.comp, source: 'box office' }, true);
      closeModal(); await reloadAdmin(); toast('Order created'); render(); } catch (e) { toast(e.message, true); }
  },
  exportOrders: () => download('orders.csv', csv([['Order', 'Placed', 'Status', 'Name', 'Email', 'Phone', 'Events', 'Tickets', 'Subtotal', 'Discount', 'Code', 'Fees', 'Tax', 'Donation', 'Total', 'Payment', 'Source', 'Marketing opt-in'],
    ...filteredOrders().map(o => { const d = o.data; return [o.ref, o.created_at, o.status, d.buyer.name, o.buyer_email, d.buyer.phone, [...new Set(d.lines.map(l => l.eventName))].join('; '), d.lines.filter(l => l.kind === 'ticket').map(l => l.qty + 'x ' + l.name).join('; '),
      d.subtotal / 100, d.discount / 100, d.code || '', d.fee / 100, d.tax / 100, d.donation / 100, d.total / 100, d.payment, d.source || '', d.optIn ? 'yes' : 'no']; })])),
  exportAtt: () => { const ev = evById(S.ui.attEv); download(slugify(ev?.name || 'attendees') + '-door-list.csv', csv([['Name', 'Email', 'Ticket', 'Seat', 'Time slot', 'Code', 'Order', 'Checked in'],
    ...S.adm.tickets.filter(t => t.event_id === S.ui.attEv && t.status === 'valid').map(t => { const o = S.adm.orders.find(x => x.id === t.order_id); return [t.holder, o?.buyer_email, ev.ticketTypes.find(x => x.id === t.ticket_type_id)?.name, t.seat || '', t.slot_id ? fmtDT(ev.timeSlots.find(s => s.id === t.slot_id)?.start) : '', t.code, o?.ref, t.checked_in_at || '']; })])); },
  exportReport: () => download('sales-report.csv', csv([['Event', 'Date', 'Tickets sold', 'Ticket revenue'], ...S.adm.events.map(e => { const s = evStats(e); return [e.name, e.start, s.sold, s.rev / 100]; })])),
  exportOptIn: () => download('mailing-list.csv', csv([['Email Address', 'First Name', 'Last Name'], ...[...new Map(S.adm.orders.filter(o => o.data.optIn).map(o => [o.buyer_email, o])).values()].map(o => { const [f, ...l] = o.data.buyer.name.split(' '); return [o.buyer_email, f, l.join(' ')]; })])),
  toggleIn: el => doCheckin(el.dataset.v, el.dataset.undo === '1'),
  scPick: el => { S.sc.evId = el.dataset.id; S.sc.tab = 'scan'; S.sc.q = ''; try { localStorage.setItem('set_scan_ev', S.sc.evId); } catch (e) { } render(); },
  scBack: () => { S.sc.evId = ''; camStop(); render(); },
  scTab: el => { S.sc.tab = el.dataset.v; render(); },
  scCam: () => camStart(),
  scDismiss: (el, e) => { if (e.target.closest('[data-action="scUndo"]')) return; S.sc.last = null; render(); },
  scUndo: el => scanCheck(el.dataset.v, true),
  scToggle: el => scanCheck(el.dataset.v, el.dataset.undo === '1', true),
  scFilter: el => { S.sc.filter = el.dataset.v; render(); },
  scSound: () => { S.sc.sound = !S.sc.sound; render(); },
  scTorch: async () => { try { await CAM.stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: !CAM.torch }] }); CAM.torch = !CAM.torch; render(); } catch (e) { toast('Torch isn\'t supported on this device', true); } },
  scManual: () => modal('Enter ticket code', `<input class="inp" id="scCode" placeholder="e.g. 7KQ2M9XHPA" autocomplete="off" style="text-transform:uppercase;font-size:20px;letter-spacing:.12em;text-align:center">`, `<button class="btn btn-ghost" data-action="closeModal">Cancel</button><button class="btn btn-accent" data-action="scManualGo">Check in</button>`) || setTimeout(() => $('#scCode')?.focus(), 50),
  scManualGo: () => { const v = $('#scCode')?.value; closeModal(); if (v) scanCheck(v); },
  demoReset: async () => { if (!confirmIn('Reset all demo data?')) return; DB.demoReset(); await boot(); toast('Demo data reset'); },
  closeModal: (el, e) => { if (el.dataset.self && e.target !== el) return; closeModal(); },
};
const confirmIn = msg => window.confirm(msg);
const CHANGE = {
  switchBo: async el => { try { S.ui.support = null; S.ui.set = S.ui.brand = S.ui.pe = null; await reloadAdmin(el.value); location.hash = '#/admin/dashboard'; setContext(); render(); } catch (e) { toast(e.message, true); } },
  applyTpl: el => { const t = S.adm.bo.templates.find(x => x.id === el.value); if (!t) return; S.ui.pe.obj.perms = [...t.perms]; S.ui.pe.obj.template = t.id; S.ui.pe.dirty = true; render(); },
};

// Delegated events
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  if (e.target.closest('[data-stop]') && el.tagName === 'TR') return;
  const fn = A[el.dataset.action]; if (!fn) return;
  if (el.tagName === 'A' || el.tagName === 'BUTTON') e.preventDefault();
  fn(el, e);
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.bind) {
    const [root, ...rest] = el.dataset.bind.split('.'), path = rest.join('.'), t = el.dataset.t;
    let v = t === 'bool' ? el.checked : el.value;
    if (t === 'money') v = el.value === '' ? 0 : Math.round(parseFloat(el.value) * 100);
    else if (t === 'int') v = el.value === '' ? 0 : parseInt(el.value, 10);
    else if (t === 'num') v = el.value === '' ? 0 : parseFloat(el.value);
    else if (t === 'dt') v = el.value ? new Date(el.value).toISOString() : '';
    else if (t === 'list') v = el.value.split(',').map(x => x.trim()).filter(Boolean).map(Number);
    const target = root === 'draft' ? S.draft : root === 'co' ? S.co : root === 'set' ? S.ui.set : root === 'ui' ? S.ui : null;
    if (!target) return;
    setPath(target, path, v);
    if (root === 'ui' && path.startsWith('pe.')) { S.ui.pe.dirty = true; const b = $('[data-action="savePerms"]'); if (b) b.disabled = false; }
    if (root === 'ui' && path.startsWith('brand.branding.') && el.type !== 'text' && el.type !== 'url') { render(); return; }
    if (root === 'draft') { dirty(); if (path === 'name' && S.draft.status === 'draft' && /^new-event-/.test(S.draft.slug)) S.draft.slug = slugify(v); }
    if (el.type === 'checkbox' || el.tagName === 'SELECT' || path.startsWith('seating.')) render();
    return;
  }
  if (el.dataset.input) {
    const k = el.dataset.input, v = el.value;
    if (k === 'homeq') S.home.q = v; else if (k === 'pw') S.sel.pw = v;
    else if (k === 'wlName' || k === 'wlEmail' || k === 'wlPhone') (S.ui.wl ||= {})[{ wlName: 'name', wlEmail: 'email', wlPhone: 'phone' }[k]] = v;
    else if (k === 'findRef' || k === 'findEmail') (S.ui.find ||= {})[k === 'findRef' ? 'ref' : 'email'] = v;
    else if (k === 'loginEmail') S.ui.login.email = v; else if (k === 'loginCode') S.ui.login.code = v; else if (k === 'loginTotp') S.ui.login.totp = v;
    else if (k === 'sc.q') { S.sc.q = v; return render(); }
    else if (k.includes('.')) { const [a, b] = k.split('.'); (S.ui[a] ||= {})[b] = v; if (a === 'mo' && el.dataset.rerender) ManualOrderModal(); if (el.dataset.rr || (a === 'inv' && b === 'template')) render(); return; }
    else S.ui[k] = v;
    if (['homeq', 'q', 'ev', 'status', 'attEv', 'repEv'].includes(k)) render();
  }
});
document.addEventListener('change', e => { const el = e.target; const fn = CHANGE[el.dataset.actionChange]; if (fn) fn(el); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter' && e.target.id === 'scCode') A.scManualGo();
  if (e.key === 'Enter' && ['loginEmail', 'loginCode'].includes(e.target.dataset.input)) A.login();
  if (e.key === 'Enter' && e.target.dataset.input === 'loginTotp') A.loginMfa();
  if (e.key === 'Enter' && e.target.id === 'mfaCode') (S.ui.sec?.enr ? A.mfaConfirm : A.mfaOff)();
});

// ── Ambient hero canvas (style kit: one ambient layer, honors reduced motion) ──
let _heroRaf = 0;
function startHeroCanvas() {
  const c = $('#heroCanvas'); if (!c || c._on) return; c._on = true;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = c.getContext('2d'); cancelAnimationFrame(_heroRaf);
  const draw = t => {
    if (!document.body.contains(c)) return;
    const w = c.width = c.offsetWidth * devicePixelRatio, h = c.height = c.offsetHeight * devicePixelRatio;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath(); ctx.strokeStyle = `rgba(244,205,94,${.05 + i * .018})`; ctx.lineWidth = 1.2 * devicePixelRatio;
      for (let x = 0; x <= w; x += 8) { const y = h * .55 + Math.sin(x / (180 + i * 40) + t / (2400 - i * 200) + i) * (40 + i * 14) * devicePixelRatio + Math.sin(x / 90 + t / 900) * 6; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    }
    _heroRaf = requestAnimationFrame(draw);
  };
  _heroRaf = requestAnimationFrame(draw);
}

// ── Tracking pixels (GA4 / Meta) on public pages ─────────────────────────────
let _pixels = false;
function loadPixels() {
  const p = S.settings.pixels || {}; if (_pixels || location.hash.startsWith('#/admin')) return;
  if (/^G-[A-Z0-9]+$/.test(p.ga4 || '')) { _pixels = true; const s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + p.ga4; document.head.append(s);
    window.dataLayer = window.dataLayer || []; window.gtag = function () { dataLayer.push(arguments); }; gtag('js', new Date()); gtag('config', p.ga4); }
  if (/^\d+$/.test(p.meta || '')) { _pixels = true; const s = document.createElement('img'); s.src = `https://www.facebook.com/tr?id=${p.meta}&ev=PageView&noscript=1`; s.width = s.height = 1; s.style.display = 'none'; document.body.append(s); }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
// Which box office to open: support visit > last one used > first membership. The data layer decides what's allowed.
async function reloadAdmin(boId) {
  let last = null; try { last = localStorage.getItem('set_bo:' + S.user.email); } catch (e) { }
  const id = boId || S.ui.support || S.adm?.bo?.id || last, support = !!S.ui.support && id === S.ui.support;
  const a = await DB.loadAdmin(S.user.email, id, support); S.adm = a;
  if (a.bo && !support) try { localStorage.setItem('set_bo:' + S.user.email, a.bo.id); } catch (e) { }
  if (S.draft) { const fresh = a.events?.find(e => e.id === S.draft.id); if (fresh && !S.dirty) S.draft = JSON.parse(JSON.stringify(fresh)); }
}
async function afterLogin() {
  await reloadAdmin(); S.ui.login = { email: '', code: '', sent: false, totp: '' };
  if (!S.adm.bo && S.adm.super && S.route.page === 'admin') location.hash = '#/platform';
  setContext(); render();
}
async function refreshPublic() {
  const { events, bos, platform } = await DB.init();
  S.bos = bos || []; S.platform = { ...DEFAULT_PLATFORM, ...platform };
  // Buyers see "locked" flags, never the passwords themselves.
  S.events = events.map(e => { const { secrets, ...pub } = e; return { ...pub, hasPassword: !!(secrets?.password || pub.hasPassword), ticketTypes: (pub.ticketTypes || []).map(t => ({ ...t, locked: !!(secrets?.ticketPasswords?.[t.id] || t.locked) })) }; });
  if (!DB.live) { const raw = Demo.st.events; S.events.forEach(e => { const r = raw.find(x => x.id === e.id); e.hasPassword = !!r?.secrets?.password; e.ticketTypes.forEach(t => t.locked = !!r?.secrets?.ticketPasswords?.[t.id]); }); }
}
// Removed or suspended staff lose access right away: every write is re-checked, and open screens re-check every 20s.
setInterval(async () => {
  if (!S.adm?.bo || !['admin', 'scan'].includes(S.route.page)) return;
  const sess = await DB.session().catch(() => null), ok = sess && await DB.stillAllowed();
  if (!ok) { S.user = sess; S.adm = null; toast(sess ? 'Your access to this box office was changed' : 'You were signed out', true); if (sess) await reloadAdmin().catch(() => { }); render(); }
}, 20000);
async function boot() {
  try {
    LOGO = (await (await fetch('set-logo.svg')).text()).replace('<svg ', '<svg class="set-logo" role="img" aria-label="SET" ');
  } catch (e) { }
  try {
    await refreshPublic();
    S.user = await DB.session();
    if (S.user && !S.user.mfa) await reloadAdmin().catch(e => { S.user = null; toast(e.message, true); });
  } catch (e) { console.error(e); toast('Could not load events: ' + e.message, true); }
  S.sc.queue = loadQueue(); try { S.sc.evId = localStorage.getItem('set_scan_ev') || ''; } catch (e) { }
  S.loading = false; loadPixels(); onRoute(); flushQueue();
}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
boot();
