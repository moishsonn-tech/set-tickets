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
// CSV for spreadsheets. A text cell starting with = + - @ tab or CR would run as a formula in Excel / Sheets ("CSV injection"), so it gets
// a leading apostrophe; real numbers (negative amounts too) stay numbers.
const csvCell = v => { let s = String(v ?? ''); if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function csv(rows) { return rows.map(r => r.map(csvCell).join(',')).join('\n'); }
function ics(ev) {
  const f = iso => D(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SET Tickets//EN', 'BEGIN:VEVENT', 'UID:' + ev.id + '@set', 'DTSTAMP:' + f(new Date().toISOString()),
    'DTSTART:' + f(ev.start), 'DTEND:' + f(ev.end || ev.start), 'SUMMARY:' + ev.name, 'LOCATION:' + [ev.venue, ev.address].filter(Boolean).join(', '),
    'URL:' + shareUrl(ev.slug), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

const ICON = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>', flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>', pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
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
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
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
  home: { view: 'list', cat: 'All', q: '', when: '', month: null },
  avail: {}, sel: null, cart: loadCart(), co: { name: '', email: '', phone: '', address: '', answers: {}, tanswers: {}, optIn: false, terms: false, payment: '', code: '', disc: null, busy: false, err: '', pay: null, attempt: null },
  cust: null,  // signed-in customer account (optional — guest checkout always works)
  queue: {}, domainBo: null,   // Stage 10: waiting-room state per event · the box office this custom domain belongs to
  bos: [], bo: null, platform: { ...DEFAULT_PLATFORM }, plat: null,  // public box offices · box office in context · platform (public part) · super-admin data
  user: null, adm: null, draft: null, dirty: false,
  ui: { q: '', ev: '', status: '', picked: {}, attEv: '', repEv: '', login: { email: '', code: '', sent: false, totp: '' } },
  sc: { evId: '', tab: 'scan', last: null, q: '', filter: 'all', recent: [], sound: true, queue: [], err: '', entrance: null, slot: null, pick: null },  // door scanner app (entrance / slot null = not chosen yet)
};
function loadCart() { const blank = { items: [], addons: [], gifts: [], passes: [], donation: 0, unlock: {} }; try { return { ...blank, ...(JSON.parse(localStorage.getItem('set_cart')) || {}) }; } catch (e) { return blank; } }
function saveCart() { try { localStorage.setItem('set_cart', JSON.stringify(S.cart)); } catch (e) { } if (!S.loading) setTimeout(presencePing); }
const cartCount = () => sum(S.cart.items, i => i.qty);
const evById = id => S.events.find(e => e.id === id) || S.adm?.events.find(e => e.id === id);
// The box office whose settings and branding apply to this page — buyers see the organizer's brand, not the platform's.
const boOf = ev => ev && (S.bos.find(b => b.id === ev.box_office_id) || (S.adm?.bo?.id === ev.box_office_id ? S.adm.bo : null));
const cartBo = () => boOf(evById((S.cart.items[0] || S.cart.addons[0])?.eventId)) || ((S.cart.gifts || []).length || (S.cart.passes || []).length ? S.bos.find(b => b.id === S.cart.boId) : null);
function setContext() {
  const r = S.route, evSlug = ['e', 'embed'].includes(r.page) && r.params[0];
  const bo = ['admin', 'scan'].includes(r.page) ? S.adm?.bo : r.page === 'b' ? S.bos.find(b => b.slug === r.params[0])
    : evSlug ? boOf(S.events.find(e => e.slug === evSlug) || S.adm?.events.find(e => e.slug === evSlug))
    : r.page === 'cart' ? cartBo() : r.page === 'order' ? S.bos.find(b => b.id === S.order?.order?.box_office_id) : null;
  S.bo = bo || null;
  S.settings = bo ? { ...DEFAULT_SETTINGS, ...bo.settings, name: bo.name } : { ...DEFAULT_SETTINGS, name: S.platform.name + ' Tickets' };
  const ev = evSlug && (S.events.find(e => e.slug === evSlug) || S.adm?.events.find(e => e.slug === evSlug)), pg = ev?.page || {};
  applyTheme(['admin', 'scan', 'platform'].includes(r.page) ? null : { ...(bo?.branding || {}), ...(HEX.test(pg.accent || '') ? { accent: pg.accent } : {}), ...(HEX.test(pg.ink || '') ? { ink: pg.ink } : {}) });
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
  const qp = new URLSearchParams(qs || ''), src = qp.get('src'), ref = qp.get('ref');
  // UTM tags (from the hash link or the page URL) stay with the visit and go on the order; utm_source also counts as the traffic source
  const sp = new URLSearchParams(location.search), utm = {}; for (const k of UTM_KEYS) { const v = qp.get('utm_' + k) || sp.get('utm_' + k); if (v) utm[k] = v.slice(0, 80); }
  if (Object.keys(utm).length) { try { sessionStorage.setItem('set_utm', JSON.stringify(utm)); } catch (e) { } if (!src && utm.source) sessionStorage.setItem('set_src', utm.source.toLowerCase().slice(0, 60)); }
  if (src) sessionStorage.setItem('set_src', src);
  if (ref) sessionStorage.setItem('set_ref', ref.trim().toUpperCase().slice(0, 40));  // tracking / referral code link
  if (parts[0] === 'admin') return { page: 'admin', sub: parts[1] || 'dashboard', params: parts.slice(2) };
  if (parts[0] === 'platform') return { page: 'platform', params: parts.slice(1) };
  if (!parts[0] && S.domainBo) return { page: 'b', params: [S.domainBo] };   // a box office's own domain opens on its own page
  return { page: parts[0] || 'home', params: parts.slice(1) };
}
async function onRoute() {
  const next = parseRoute();
  if (next.page !== 'scan') camStop();
  S.route = next;
  document.body.classList.toggle('embed', ['embed', 'embed-list'].includes(S.route.page) || (S.route.page === 'cart' && /embed/.test(location.hash)) || (S.route.page === 'order' && sessionStorage.getItem('set_embed') === '1'));
  if (S.route.page === 'embed' || S.route.page === 'embed-list') sessionStorage.setItem('set_embed', '1'); else if (['e', 'home', 'b'].includes(S.route.page)) sessionStorage.removeItem('set_embed');
  document.body.classList.toggle('scan-mode', S.route.page === 'scan');
  const r = S.route;
  if (r.page === 'e' || r.page === 'embed') {
    let ev = S.events.find(e => e.slug === r.params[0]) || S.adm?.events.find(e => e.slug === r.params[0]);
    if (!ev && !S._fetched?.[r.params[0]]) { (S._fetched ||= {})[r.params[0]] = 1; DB.eventBySlug(r.params[0]).then(e => { if (e) { S.events.push(e); onRoute(); } }).catch(() => { }); }
    if (ev && eventLive(ev) && !/preview=1/.test(location.hash) && S._viewed !== ev.id + location.hash) { S._viewed = ev.id + location.hash; DB.trackView(ev.id, sessionStorage.getItem('set_src'), sessionStorage.getItem('set_ref')); pix('ViewContent', { name: ev.name, id: ev.id }); DB.ping(ev.id, cartTicketsFor(ev.id)); }
    if (ev && S.sel?.eventId !== ev.id) S.sel = { eventId: ev.id, qty: {}, slotId: '', seats: [], addons: {}, bundles: {}, picks: {}, unlocked: { event: false, tts: [] }, pw: '' };
    if (ev) refreshAvail(ev.id);
  }
  if (r.page === 'order') loadOrder(r.params[0], r.params[1]);
  if (r.page === 'unsubscribe' && S._unsubTok !== r.params[0]) { S._unsubTok = r.params[0]; S.unsub = null;
    DB.unsubInfo(r.params[0]).then(u => { S.unsub = u || { error: 'This preferences link is not valid any more.' }; S.ui.unsub = { email: !!u?.email_on, sms: !!u?.sms_on }; render(); }).catch(e => { S.unsub = { error: e.message }; render(); }); }
  if (r.page === 'account') { S.wallet = null; if (r.params[0] === 'password') S.ui.wtab = 'profile'; }
  if (r.page === 'cart') cartEventIds().forEach(id => { if (!S.avail[id]) refreshAvail(id); });  // price phases + product stock
  if (r.page === 'platform' && r.params[0] !== S._platSub) { S._platSub = r.params[0]; S.plat = null; }  // fresh numbers on each platform page
  setContext();
  if (r.page === 'admin' && r.sub === 'venues' && r.params[0]) { const v = (S.adm?.bo?.venues || []).find(x => x.id === r.params[0]); if (v && S.draft?._venue !== v.id) { S.draft = venueDraft(v); S.dirty = false; S.ui.smSel = ''; S.ui.smMulti = []; S.ui.smSeats = []; } }
  if (r.page === 'admin' && r.sub === 'promos' && ['code', 'ref'].includes(r.params[0]) && S.adm && S.draft?._pid !== r.params[1]) {
    const kind = r.params[0] === 'code' ? 'promo' : 'tracking', found = (kind === 'promo' ? S.adm.promos : S.adm.tracking || []).find(x => x.id === r.params[1]);
    S.draft = found ? { ...JSON.parse(JSON.stringify(found)), _kind: kind } : kind === 'promo' ? { ...newPromo(S.ui.promoEv), _kind: 'promo' } : { _kind: 'tracking', id: shortId('tr_'), code: '', name: '', kind: 'Promoter', active: true, eventIds: [], startsAt: '', expires: '', maxUses: 0 };
    S.draft._pid = r.params[1]; S.dirty = false; S.ui.promoEv = null;
  }
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
  if (document.body.classList.contains('embed') && window.parent !== window) requestAnimationFrame(() => window.parent.postMessage({ setTickets: 'height', h: document.documentElement.scrollHeight }, '*'));   // §10 embed.js sizes the frame
  if (key) { const el = document.querySelector(`[data-bind="${CSS.escape(key)}"],[data-input="${CSS.escape(key)}"],#${CSS.escape(key)}`); if (el && el !== document.activeElement) { el.focus(); try { if (pos != null) el.setSelectionRange(pos, pos); } catch (e) { } } }
  hydrate();
}
function hydrate() {
  document.querySelectorAll('[data-qr]').forEach(el => { if (!el.childElementCount && window.QRCode) new QRCode(el, { text: el.dataset.qr, width: 300, height: 300, colorDark: '#020a16', correctLevel: QRCode.CorrectLevel.M }); });
  if (S.route.page === 'home') startHeroCanvas();
  if (S.route.page === 'cart') { sigMount(); if (S.co.pay?.clientSecret && !$('#payEl')?.childElementCount) mountStripe(S.co.pay).catch(e => { S.co.err = e.message; render(); }); }
  if (S.route.page === 'scan') camMount();
}

// ══════════════════════════════════════════════════════════════════════════════
//  PUBLIC BOX OFFICE
// ══════════════════════════════════════════════════════════════════════════════
function PubShell() {
  const r = S.route, solid = !['home', 'e', 'b'].includes(r.page);
  const body = { gift: GiftPage, member: MemberPage, 'embed-list': EmbedList, home: Home, e: EventPage, embed: EventPage, cart: Checkout, order: OrderPage, tickets: FindTickets, b: BoxOfficePage, register: Register, account: Account, unsubscribe: Unsubscribe }[r.page] || NotFound;
  const bo = S.bo, brandLogo = bo && safeUrl(bo.branding.logo);
  return `
  <nav class="pub-nav ${solid ? 'solid' : ''}">
    ${bo ? `<a href="#/b/${esc(bo.slug)}" class="logo bo-brand" aria-label="${esc(bo.name)}">${brandLogo ? `<img src="${esc(brandLogo)}" alt="">` : `<span class="bo-word">${esc(bo.name)}</span>`}<small>Tickets by SET</small></a>`
      : `<a href="#/" class="logo" aria-label="SET home">${logo()}<small>SING Entertainment Tickets</small></a>`}
    <div class="links">
      <a class="btn glass btn-sm hide-sm" href="#/account">${ic('ticket', 15)} ${S.cust ? 'My account' : 'My tickets'}</a>
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
const soldOut = (ev, av) => saleState(ev, av) === 'soldout';
const SALE_CHIP = { soldout: '<span class="chip bad">Sold out</span>', low: '<span class="chip warn">Few left</span>', soon: '<span class="chip info">Coming soon</span>', closed: '<span class="chip">Sales closed</span>' };
// search + category + date filters, shared by the platform home page and each box office's own page
const WHEN = [['', 'Any date'], ['week', 'Next 7 days'], ['month', 'Next 30 days'], ['later', 'Later']];
function filterEvents(all) {
  const h = S.home, q = h.q.trim().toLowerCase(), now = Date.now(), d = e => D(e.start) - now;
  return all.filter(e => (h.cat === 'All' || e.category === h.cat) && (!q || [e.name, e.venue, e.address, e.category, e.summary].join(' ').toLowerCase().includes(q))
    && (!h.when || (h.when === 'week' ? d(e) <= 7 * 864e5 : h.when === 'month' ? d(e) <= 30 * 864e5 : d(e) > 30 * 864e5)));
}
const EventFilters = all => `<div class="row wrap ev-filters"><input class="inp pill-inp" data-input="homeq" placeholder="Search events or venues…" value="${esc(S.home.q)}">
  <select class="inp pill-inp" data-input="homeWhen" aria-label="When">${WHEN.map(([v, t]) => `<option value="${v}" ${S.home.when === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
  <div class="cat-row">${['All', ...new Set(all.map(e => e.category).filter(Boolean))].map(c => `<button class="${S.home.cat === c ? 'on' : ''}" data-action="homeCat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
function listedEvents() {
  const now = Date.now() - 6 * 3600e3;
  return S.events.filter(e => eventListed(e) && D(e.end || e.start) >= now).sort((a, b) => D(a.start) - D(b.start));
}

function Home() {
  const h = S.home, all = listedEvents(), evs = filterEvents(all);
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
        <div class="tabs"><button class="${h.view === 'list' ? 'on' : ''}" data-action="homeView" data-v="list">Grid</button><button class="${h.view === 'cal' ? 'on' : ''}" data-action="homeView" data-v="cal">Calendar</button></div>
      </div>
      ${EventFilters(all)}
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
  const st = saleState(ev, av), out = st === 'soldout';
  return `<a class="ev-card" href="#/e/${esc(ev.slug)}">
    <div class="ev-img" style="${artBg(ev)}">${artTitle(ev)}
      <div class="chips">${SALE_CHIP[st] || ''}${ev.category ? `<span class="chip gold">${esc(ev.category)}</span>` : ''}</div>
      <div class="datebadge"><div class="m">${esc(fmtDate(ev.start, { month: 'short' }))}</div><div class="d">${d.getDate()}</div></div>
    </div>
    <div class="ev-body"><h3>${esc(ev.name)}</h3>
      <div class="meta">${esc(fmtDate(ev.start, { weekday: 'long' }))} · ${esc(fmtTime(ev.start))}</div>
      <div class="meta">${esc(ev.venue || (ev.online ? 'Online event' : ''))}</div>
      <div class="foot"><span class="price">${esc(priceFrom(ev))}</span><span class="btn btn-dark btn-sm">${out ? 'Join waitlist' : st === 'soon' ? 'Details' : 'Tickets'} →</span></div>
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
  if (S.route.page === 'embed' && /compact=1/.test(location.hash)) return CompactWidget(ev);   // §10 just the ticket selector
  const sel = S.sel, av = S.avail[ev.id];
  const preview = !eventLive(ev), shows = (ev.timeSlots || []).filter(s => !s.hidden), multiDay = new Set(shows.map(s => fmtDate(s.start))).size > 1;
  const contact = ev.contact?.email || ev.contact?.phone ? ev.contact : { email: S.settings.contactEmail };
  // Stage 10: an emergency control (paused / maintenance) or the waiting room replaces the ticket panel
  const stop = !preview && controlBlock(ev, 'sales'), gate = stop ? `<h3>${ev.controls?.maintenance ? 'Back soon' : 'Sales paused'}</h3><p class="muted small" style="margin-top:8px">${esc(stop)}</p>`
    : !preview && ev.queue?.on ? WaitingRoom(ev) : '';
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
          <button class="btn glass btn-sm" data-action="contactOrg" data-id="${ev.id}">${ic('mail', 14)} Contact organizer</button>
        </div>
      </div>
      <div class="poster hide-sm" style="${artBg(ev)}">${artTitle(ev, 'art-t lg')}</div>
    </div>
  </section>
  <div class="container"><div class="ev-layout">
    <div>
      ${!gate && ev.seating?.enabled && sel && (!ev.timeSlots?.length || sel.slotId) && !(ev.hasPassword && !sel.unlocked.event) ? BuyerSeatMap(ev, av, sel) : ''}
      ${EventSections(ev, contact)}
    </div>
    <aside class="ticket-panel"><div class="card">${gate || TicketPanel(ev, sel, av)}</div></aside>
  </div></div>`;
}
// ── Waiting room (Stage 10): in line → a steady stream is let in; once admitted the normal ticket panel shows for the pass's time ──
function WaitingRoom(ev) {
  const q = S.queue[ev.id];
  if (!q) { queueTick(ev.id); return `<h3>Joining the line…</h3>`; }
  if (q.error) return `<h3>Waiting room</h3><p class="small" style="color:var(--bad);margin-top:8px">${esc(q.error)}</p><button class="btn btn-ghost btn-sm" style="margin-top:10px" data-action="queueRetry" data-id="${ev.id}">Try again</button>`;
  if (q.admitted) return '';
  setTimeout(() => queueTick(ev.id), 3000);
  return `<div class="eyebrow dash">Waiting room</div><h3 style="margin-top:10px">You're in line</h3>
    <p class="small muted" style="margin:6px 0 14px">${esc(q.message || 'Lots of people want tickets right now. We let buyers in a few at a time so everyone gets a fair go.')} Keep this page open — you won't lose your place.</p>
    <div class="q-pos"><div class="display">${q.position}</div><div class="small muted">${q.position === 1 ? 'You\'re next' : 'people ahead of you: ' + (q.position - 1)}</div></div>
    <div class="q-bar"><span style="width:${Math.round((q.progress || 0) * 100)}%"></span></div>
    <p class="small muted" style="margin-top:8px">Estimated entry ${esc(fmtTime(q.admit))} · ${q.waiting} in line</p>`;
}
const _qBusy = {};
async function queueTick(id) {
  if (_qBusy[id] || S.route.page !== 'e') return; _qBusy[id] = 1;
  try { const was = S.queue[id]?.admitted; S.queue[id] = await DB.queueStatus(id); if (S.queue[id].admitted && !was) toast('It\'s your turn — tickets are open for you'); }
  catch (e) { S.queue[id] = { error: e.message }; } finally { _qBusy[id] = 0; }
  render();
}
// ── Event page sections (Stage 5): each one shows when it has content and the organizer hasn't switched it off (ev.page.hide) ──
const PAGE_SECTIONS = [['about', 'About this event'], ['video', 'Video'], ['gallery', 'Photo gallery'], ['blocks', 'Custom text blocks'], ['instructions', 'Good to know'],
  ['policies', 'Event policies'], ['sponsors', 'Sponsors'], ['contact', 'Questions / contact'], ['venue', 'Venue & map']];
// only YouTube / Vimeo, rebuilt from the video id — never an arbitrary URL in an iframe
function videoEmbed(u) {
  const s = String(u || ''), yt = s.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/), vm = s.match(/vimeo\.com\/(?:video\/)?(\d{6,12})/);
  return yt ? 'https://www.youtube-nocookie.com/embed/' + yt[1] : vm ? 'https://player.vimeo.com/video/' + vm[1] : '';
}
function EventSections(ev, contact) {
  const pg = ev.page || {}, on = k => !pg.hide?.[k], sec = (title, body, first) => `${first ? '' : '<div class="sep" style="margin:28px 0"></div>'}<div class="eyebrow dash">${esc(title)}</div>${body}`;
  const out = [], vid = videoEmbed(pg.video), gal = (pg.gallery || []).map(safeUrl).filter(Boolean), spons = (pg.sponsors || []).filter(x => x.name || safeUrl(x.logo));
  if (on('about') && (ev.description || ev.summary)) out.push(['About this event', `<p class="ev-desc" style="margin-top:14px">${esc(ev.description || ev.summary)}</p>`]);
  if (on('video') && vid) out.push(['Video', `<div class="ev-video"><iframe loading="lazy" title="Event video" src="${esc(vid)}" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`]);
  if (on('gallery') && gal.length) out.push(['Photos', `<div class="ev-gallery">${gal.map(u => `<img loading="lazy" src="${esc(u)}" alt="">`).join('')}</div>`]);
  if (on('blocks')) for (const b of pg.blocks || []) if (b.title || b.text) out.push([b.title || 'More', `<p class="ev-desc" style="margin-top:12px">${esc(b.text || '')}</p>`]);
  if (on('instructions') && ev.instructions) out.push(['Good to know', `<p class="ev-desc" style="margin-top:12px">${esc(ev.instructions)}</p>`]);
  if (on('policies') && ev.policies) out.push(['Event policies', `<p class="ev-desc small" style="margin-top:12px">${esc(ev.policies)}</p>`]);
  if (on('sponsors') && spons.length) out.push(['Sponsors', `<div class="sponsors">${spons.map(x => { const u = safeUrl(x.url), inner = safeUrl(x.logo) ? `<img src="${esc(safeUrl(x.logo))}" alt="${esc(x.name || '')}">` : `<b>${esc(x.name)}</b>`;
    return u ? `<a href="${esc(u)}" target="_blank" rel="noopener sponsored">${inner}</a>` : `<span>${inner}</span>`; }).join('')}</div>`]);
  if (on('contact') && (contact?.email || contact?.phone)) out.push(['Questions?', `<p style="margin-top:10px">${contact.name ? esc(contact.name) + '<br>' : ''}${contact.email ? `<a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a>` : ''}${contact.phone ? (contact.email ? ' · ' : '') + esc(contact.phone) : ''}</p>`]);
  if (on('venue') && !ev.online && ev.address) out.push(['Venue', `<p style="margin-top:10px"><b>${esc(ev.venue)}</b><br><span class="muted">${esc(ev.address)}</span></p>
    <div class="map"><iframe loading="lazy" title="Map" src="https://maps.google.com/maps?q=${encodeURIComponent(ev.address)}&output=embed"></iframe></div>`]);
  return out.map(([t, b], i) => sec(t, b, i === 0 && !ev.seating?.enabled)).join('');
}
// The buyer's selection as cart lines. Bundles take their seats first (each bundle ticket needs a seat of an allowed price level).
function selCart(ev, sel) {
  const items = [], pool = [...sel.seats], seated = ev.seating?.enabled, slotId = sel.slotId || null; let err = '';
  for (const b of ev.bundles || []) {
    const n = sel.bundles?.[b.id] || 0; if (!n) continue;
    const pos = bundlePositions(b);
    if (seated) {
      const seats = [];
      for (let c = 0; c < n && !err; c++) for (const allowed of pos) {
        const i = pool.findIndex(s => allowed.includes(ev.seating.index?.[s]));
        if (i < 0) { err = `Pick ${n * pos.length} seat${n * pos.length === 1 ? '' : 's'} on the map for ${n} × ${b.name} (${[...new Set(pos.flat())].map(id => ev.ticketTypes.find(t => t.id === id)?.name).filter(Boolean).join(' or ')})`; break; }
        seats.push(pool.splice(i, 1)[0]);
      }
      if (!err) items.push({ eventId: ev.id, bundleId: b.id, qty: n, slotId, seats });
    } else {
      const pk = sel.picks?.[b.id] || [];
      items.push({ eventId: ev.id, bundleId: b.id, qty: n, slotId, seats: [], picks: (b.parts || []).flatMap((p, i) => Array.from({ length: +p.qty || 0 }, () => pk[i] || (p.ticketTypeIds || [])[0] || '')) });
    }
  }
  if (seated) ev.ticketTypes.forEach(t => { const seats = pool.filter(s => ev.seating.index?.[s] === t.id); if (seats.length) items.push({ eventId: ev.id, ticketTypeId: t.id, slotId, qty: seats.length, seats }); });
  else Object.entries(sel.qty).filter(([, q]) => q > 0).forEach(([id, q]) => items.push({ eventId: ev.id, ticketTypeId: id, slotId, qty: q, seats: [] }));
  const addons = Object.entries(sel.addons).filter(([, q]) => q > 0).map(([id, q]) => ({ eventId: ev.id, addonId: id, qty: q }));
  return { items, addons, err };
}
const evSettings = ev => { const bo = boOf(ev); return bo ? { ...DEFAULT_SETTINGS, ...bo.settings } : S.settings; };
// ticket types + seat areas a cart holds for one event (for product rules and upsell triggers)
function cartMix(ev, lines) {
  const ls = lines.filter(l => l.eventId === ev.id), tts = [], areas = [], prices = []; let tickets = 0;
  for (const l of ls) {
    if (l.kind === 'ticket') { tts.push(l.ticketTypeId); prices.push(l.face); tickets += l.qty * l.admits; }
    if (l.kind === 'bundle') { tts.push(...l.tts); prices.push(...l.tfaces); tickets += l.qty * l.perCopy; }
    for (const s of l.seats || []) areas.push(ev.seating?.meta?.[s]?.[0] || '');
  }
  return { tts, areas, prices, tickets };
}
// "Early bird · until Nov 12" / "40 left at this price" / "6+ for $55 each"
function priceNote(ev, t, slotId, av) {
  const sold = av?.tt?.[t.id] || 0, st0 = startOf(ev, slotId), ph = activePhase(t, sold, new Date(), st0), pk = !ph && peakRule(t, st0, ev.timezone), out = [];
  if (pk) out.push(`<b>${esc(pk.label || 'Peak price')}</b> for this showtime`);
  if (t.memberOnly) out.push('<b>Members only</b> — enter your membership code at checkout');
  if (ph) out.push(`<b>${esc(ph.label || 'Special price')}</b>${ph.until ? ' · until ' + esc(fmtDate(ph.until, { month: 'short', day: 'numeric' })) : ''}${+ph.upTo > 0 ? ` · ${Math.max(0, +ph.upTo - sold)} left at this price` : ''}`);
  for (const b of (t.breaks || []).filter(b => +b.min > 1).sort((a, b) => a.min - b.min)) out.push(`${b.min}+ for ${money(b.price, ev.currency)} each`);
  return out.join(' · ');
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
  const tts = ev.ticketTypes.filter(t => !t.adminOnly && (!t.hidden || sel.unlocked.tts.includes(t.id)) && (!ev.seating?.enabled || onMap.has(t.id)));
  const hasLocked = ev.ticketTypes.some(t => t.hidden && t.locked && !sel.unlocked.tts.includes(t.id));
  const seated = ev.seating?.enabled, slotOK = !ev.timeSlots?.length || sel.slotId;
  const takenNow = offSeats(av, sel.slotId);
  const left = t => seated ? Object.keys(ev.seating.index || {}).filter(id => ev.seating.index[id] === t.id && !takenNow.has(id)).length
    : +t.qty > 0 ? Math.max(0, +t.qty - (av.tt[t.id] || 0)) : Infinity;
  const evLeft = +ev.capacity > 0 ? Math.max(0, +ev.capacity - av.total) : Infinity;
  const sc = selCart(ev, sel), q = quote(sc, [ev], evSettings(ev), null, { avail: { [ev.id]: av } }), mix = cartMix(ev, q.lines);
  const inTT = id => sum(q.lines.filter(l => l.kind === 'ticket' && l.ticketTypeId === id), l => l.qty);
  const bundles = (ev.bundles || []).filter(b => !b.hidden && inWindow(b.salesStart, b.salesEnd, now) && bundlePositions(b).every(p => p.some(id => tts.some(t => t.id === id))));
  const prods = (ev.addons || []).filter(a => addonOpen(a, now) && (a.standalone || addonAllowed(ev, a, mix.tts, mix.areas)) && !(((a.ticketTypeIds || []).length || (a.areas || []).length) && !mix.tickets));
  const groups = [...new Set(tts.map(t => t.group || ''))];
  const ttRow = t => {
    const qn = seated ? inTT(t.id) : (sel.qty[t.id] || 0), l = Math.min(left(t), evLeft), max = Math.min(+t.max || 10, l === Infinity ? 99 : Math.floor(l / (+t.admits || 1)));
    const notYet = t.salesStart && D(t.salesStart) > now, ended = t.salesEnd && D(t.salesEnd) < now, unit = ttPrices(t, sel.slotId, av.tt[t.id] || 0, 1, 1, now, startOf(ev, sel.slotId), ev.timezone)[0].price, list = listPrice(t, sel.slotId), note = priceNote(ev, t, sel.slotId, av);
    return `<div class="tt ${qn ? 'sel' : ''}"><div><div class="name">${esc(t.name)}</div>
      <div class="desc">${unit < list ? `<s class="muted">${money(list, ev.currency)}</s> ` : ''}${unit ? money(unit, ev.currency) : 'Free'}${t.desc ? ' · ' + esc(t.desc) : ''}${l !== Infinity && l < 25 && l > 0 ? ` · <b style="color:var(--warn)">${l} left</b>` : ''}</div>
      ${note ? `<div class="desc price-note">${note}</div>` : ''}</div>
      ${notYet ? `<span class="chip">On sale ${esc(fmtDate(t.salesStart, { month: 'short', day: 'numeric' }))}</span>` : ended ? '<span class="chip">Ended</span>' : l <= 0 ? '<span class="chip bad">Sold out</span>'
        : seated ? `<b class="tnum">${qn}</b>` : `<div class="qty"><button data-action="qty" data-id="${t.id}" data-d="-1" ${qn <= 0 ? 'disabled' : ''} aria-label="Fewer">−</button><span class="tnum">${qn}</span><button data-action="qty" data-id="${t.id}" data-d="1" data-max="${max}" data-min="${+t.min || 1}" ${qn >= max ? 'disabled' : ''} aria-label="More">+</button></div>`}
    </div>`; };
  const bLeft = b => +b.qty > 0 ? Math.max(0, +b.qty - (av.bd?.[b.id] || 0)) : Infinity;
  const worth = b => sum(bundlePositions(b), p => listPrice(ev.ticketTypes.find(t => t.id === p[0]), sel.slotId)) + sum(b.addons || [], x => (+x.qty || 1) * (+(ev.addons || []).find(a => a.id === x.addonId)?.price || 0));
  const count = mix.tickets + sum(q.lines.filter(l => l.kind === 'addon'), l => l.qty);
  return `
    <div class="between"><h3>Tickets</h3>${ev.capacity && evLeft < 50 ? `<span class="chip warn">${evLeft} left</span>` : ''}</div>
    ${shown.length ? `<div class="eyebrow" style="margin:14px 0 8px">1 · Choose a ${new Set(shown.map(s => fmtDate(s.start))).size > 1 ? 'date & time' : 'time'}</div><div class="slot-list">${shown.slice().sort((a, b) => D(a.start) - D(b.start)).map(s => {
      const st = slotState(s, av), l = +s.capacity > 0 ? +s.capacity - (av.slots[s.id] || 0) : 99;
      return `<button class="slot ${sel.slotId === s.id ? 'on' : ''}" ${st !== 'open' ? 'disabled' : ''} data-action="pickSlot" data-id="${s.id}"><b>${esc(fmtTime(s.start))}</b>${st === 'soldout' ? 'Sold out' : st === 'unavailable' ? 'Unavailable' : esc(fmtDate(s.start, { month: 'short', day: 'numeric' })) + (l < 20 ? ' · ' + l + ' left' : '')}${s.label ? `<small>${esc(s.label)}</small>` : ''}</button>`; }).join('')}</div>
      <div class="eyebrow" style="margin:18px 0 8px">2 · Choose tickets</div>` : '<div style="height:12px"></div>'}
    ${seated ? (slotOK ? (sel.seats.length ? `<div class="seat-chips">${sel.seats.map(id => `<button class="chip" data-action="pickSeat" data-v="${esc(id)}" title="Remove">${esc(seatName(ev, id, true))} ✕</button>`).join('')}</div>` : '<p class="small muted" style="margin-bottom:10px">Choose seats on the map.</p>') : '<p class="muted small">Pick a time to see seats.</p>') : ''}
    <div style="${slotOK ? '' : 'opacity:.45;pointer-events:none'}">
    ${groups.map(g => `${g && groups.length > 1 ? `<div class="tt-group">${esc(g)}</div>` : ''}${tts.filter(t => (t.group || '') === g).map(ttRow).join('')}`).join('')}
    ${bundles.length ? `<div class="eyebrow" style="margin:18px 0 8px">Packages</div>${bundles.map(b => { const n = sel.bundles?.[b.id] || 0, bl = bLeft(b), w = worth(b), mx = Math.min(+b.max || 10, bl === Infinity ? 10 : bl);
      return `<div class="tt bundle ${n ? 'sel' : ''}"><div><div class="name">${esc(b.name)}</div>
        <div class="desc">${money(b.price, ev.currency)}${w > +b.price ? ` · <span class="save">save ${money(w - b.price, ev.currency)}</span>` : ''}${bl !== Infinity && bl < 20 && bl > 0 ? ` · <b style="color:var(--warn)">${bl} left</b>` : ''}</div>
        <div class="desc">${esc(b.desc || bundleSummary(ev, b))}</div>
        ${!seated && n ? (b.parts || []).map((p, i) => (p.ticketTypeIds || []).length > 1 ? `<select class="inp inp-sm" data-action-change="bPick" data-id="${b.id}" data-i="${i}">${p.ticketTypeIds.map(id => `<option value="${id}" ${(sel.picks?.[b.id] || [])[i] === id ? 'selected' : ''}>${esc(ev.ticketTypes.find(t => t.id === id)?.name || '')}</option>`).join('')}</select>` : '').join('') : ''}
        ${seated && n ? `<div class="desc">Uses ${n * bundlePositions(b).length} of the seats you pick on the map.</div>` : ''}</div>
        ${bl <= 0 ? '<span class="chip bad">Sold out</span>' : `<div class="qty"><button data-action="bqty" data-id="${b.id}" data-d="-1" ${n <= 0 ? 'disabled' : ''} aria-label="Fewer">−</button><span class="tnum">${n}</span><button data-action="bqty" data-id="${b.id}" data-d="1" data-max="${mx}" ${n >= mx ? 'disabled' : ''} aria-label="More">+</button></div>`}</div>`; }).join('')}` : ''}
    ${prods.length ? `<div class="eyebrow" style="margin:18px 0 8px">Add-ons</div>${prods.map(a => { const al = +a.qty > 0 ? Math.max(0, +a.qty - (av.ad?.[a.id] || 0)) : Infinity, n = sel.addons[a.id] || 0, mx = Math.min(+a.max || 99, al === Infinity ? 99 : al);
      return `<div class="tt"><div><div class="name">${esc(a.name)}</div><div class="desc">${money(a.price, ev.currency)}${a.desc ? ' · ' + esc(a.desc) : ''}${al !== Infinity && al < 20 && al > 0 ? ` · <b style="color:var(--warn)">${al} left</b>` : ''}</div></div>
      ${al <= 0 ? '<span class="chip bad">Sold out</span>' : `<div class="qty"><button data-action="addon" data-id="${a.id}" data-d="-1" ${!(n > 0) ? 'disabled' : ''} aria-label="Fewer">−</button><span>${n}</span><button data-action="addon" data-id="${a.id}" data-d="1" data-max="${mx}" ${n >= mx ? 'disabled' : ''} aria-label="More">+</button></div>`}</div>`; }).join('')}` : ''}
    </div>
    ${hasLocked ? `<details style="margin-top:14px"><summary class="small muted" style="cursor:pointer">Have an access code?</summary><div class="row" style="margin-top:8px"><input class="inp" data-input="pw" value="${esc(sel.pw)}" placeholder="Access code"><button class="btn btn-ghost" data-action="unlock">Apply</button></div></details>` : ''}
    <div class="sep"></div>
    ${sc.err || ruleErr(ev, orderTTCounts(ev, sc.items)) ? `<p class="small" style="color:var(--warn);margin-bottom:10px">${esc(sc.err || ruleErr(ev, orderTTCounts(ev, sc.items)))}</p>` : ''}
    <div class="between" style="margin-bottom:12px"><span class="muted">${mix.tickets} ticket${mix.tickets === 1 ? '' : 's'}${count > mix.tickets ? ` + ${count - mix.tickets} add-on${count - mix.tickets === 1 ? '' : 's'}` : ''}</span><b style="font-size:18px">${money(q.subtotal, ev.currency)}</b></div>
    <button class="btn btn-accent btn-lg btn-block" data-action="addToCart" ${count && !sc.err && !ruleErr(ev, orderTTCounts(ev, sc.items)) ? '' : 'disabled'}>Get tickets <span class="arr">→</span></button>
    <p class="small muted" style="text-align:center;margin-top:10px">Booking fees and tax shown at checkout.</p>
    ${ev.waitlistMode === 'always' ? `<details style="margin-top:14px"><summary class="small muted" style="cursor:pointer">Can't find what you want? Join the waitlist</summary><div style="margin-top:10px">${Waitlist(ev, 'always')}</div></details>` : ''}`;
}
const bundleSummary = (ev, b) => [...(b.parts || []).map(p => `${p.qty} × ${(p.ticketTypeIds || []).map(id => ev.ticketTypes.find(t => t.id === id)?.name).filter(Boolean).join(' or ')}`),
  ...(b.addons || []).map(x => `${+x.qty || 1} × ${(ev.addons || []).find(a => a.id === x.addonId)?.name || 'product'}`)].join(' + ');
const TIER_COLORS = ['#020a16', '#2f66b2', '#7a5aa6', '#1f8a5b', '#b35c34', '#0e7490', '#9d174d', '#4d7c0f'];
const tierColor = (ev, ttId) => { const i = ev.ticketTypes.findIndex(t => t.id === ttId); return i < 0 ? '#c9c5ba' : TIER_COLORS[i % TIER_COLORS.length]; };
// back-office seat state colours (available seats keep their price colour)
const STATE_COLORS = { sold: '#4b5361', comp: '#9b7fd4', checkout: '#e0a23a', held: '#f08a24', blocked: '#ffffff', unavailable: '#e4e1d8' };
const _layoutMemo = new WeakMap();
const layoutOf = st => { const k = JSON.stringify([st.sections, st.prices, st.stage, st.levels, st.removed, st.labels, st.areas]); const m = _layoutMemo.get(st); if (m && m.k === k) return m.L;
  const L = seatLayout(st); L.byId = new Map(L.seats.map(p => [p.id, p])); _layoutMemo.set(st, { k, L }); return L; };
// Area / Row / Seat — from the ticket when it has them (what was sold), else from the map.
function seatParts(ev, id, t) {
  if (t?.area != null) return { area: t.area, row: t.row || '', seat: t.seat_label || '', unit: t.unit || '' };
  const p = ev?.seating?.sections && layoutOf(ev.seating).byId.get(id); if (p) return { area: p.area, row: p.tRow ?? p.row, seat: p.label, unit: p.unit || '' };
  return seatInfo(ev, id, t);
}
// "Stalls centre · Row A · Seat 12" (long) or "Stalls centre A12" (short)
function seatName(ev, id, short, t) {
  const i = seatParts(ev, id, t); if (!i.area && !i.row && !i.unit) return i.seat || id || '';
  if (short) return i.unit ? [i.unit, i.seat && 'Seat ' + i.seat].filter(Boolean).join(' ') : [i.area, i.row ? i.row + i.seat : i.seat].filter(Boolean).join(' ');   // "Box 2 Seat 1" · "Stalls left E6"
  return [i.area, i.unit, i.row && 'Row ' + i.row, i.seat && 'Seat ' + i.seat].filter(Boolean).join(' · ');
}
// "Table 5" → ['Table', '5'] · "Box 4" → ['Box', '4'] · "The Loft" → ['Section', 'The Loft']
const unitParts = u => { const m = /^(.*\D)\s+(\S*\d\S*)$/.exec(String(u).trim()); return m ? [m[1], m[2]] : ['Section', u]; };
// Only the seating details that apply, as the door sees them: ["ORCHESTRA LEFT", "ROW A — SEAT 12"] · ["BOXES", "BOX 4 — SEAT 2"] · ["STANDING"]
function seatLines(i) {
  const second = [i.unit, i.row && 'Row ' + i.row, i.seat && 'Seat ' + i.seat].filter(Boolean).join(' — ');
  return [i.area, second].filter(Boolean);
}
const levelsOf = st => st?.levels?.length ? st.levels : [{ id: '', name: 'Main floor' }];
// One SVG renderer for buyers (mode ''), the builder ('move' | 'paint' | 'seats') and the inventory ('inv').
// o: {level, off:Set (buyer: can't pick), mine:Set, selected:Set(section ids), seatSel:Set, states:Map (inv), filter (inv state), ghosts (show removed seats)}
function SeatCanvas(ev, o = {}) {
  const st = ev.seating, L = layoutOf(st), lv = o.level ?? L.lv0, b = boundsOf(L, lv, st.stage), pad = 24, design = !!o.mode, inv = o.mode === 'inv';
  const off = o.off || new Set(), mine = new Set(o.mine || []), seatSel = o.seatSel || new Set(), selSecs = o.selected || new Set(), stg = st.stage;
  const stageHere = stg && (stg.level || L.lv0 || '') === lv, bg = st.bg?.src && (design || st.bg.public) && (st.bg.level || L.lv0 || '') === lv ? st.bg : null;
  const vb = `${b.x0 - pad} ${b.y0 - pad} ${b.x1 - b.x0 + 2 * pad} ${b.y1 - b.y0 + 2 * pad}`;
  const ttOf = id => ev.ticketTypes.find(x => x.id === id);
  return `<svg class="sm ${design ? 'sm-design sm-' + o.mode : ''}" viewBox="${vb}" preserveAspectRatio="xMidYMin meet" role="img" aria-label="Seating map">
    ${bg ? `<image class="sm-bg" href="${esc(bg.src)}" x="${+bg.x || 0}" y="${+bg.y || 0}" width="${+bg.w || 800}" opacity="${bg.opacity ?? .35}" preserveAspectRatio="xMinYMin meet"/>` : ''}
    ${stageHere ? `<g class="sm-stage ${o.mode === 'move' ? 'drag' : ''}" data-stage="1" transform="translate(${+stg.x} ${+stg.y})"><rect width="${+stg.w}" height="${+stg.h}" rx="12"/><text x="${stg.w / 2}" y="${stg.h / 2 + 5}">${esc(stg.label || 'STAGE')}</text></g>` : ''}
    ${L.secs.filter(g => g.level === lv).map(g => { const sec = g.sec, on = selSecs.has(sec.id);
      const rows = g.kind !== 'rows' ? '' : [...new Set(g.all.map(p => p.row))].map(r => { const rs = g.all.filter(p => p.row === r), f = rs.reduce((a, p) => p.x < a.x ? p : a, rs[0]), l = rs.reduce((a, p) => p.x > a.x ? p : a, rs[0]);
        return `<text class="sm-row" data-row="${sec.id}|${esc(r)}" x="${f.x - 20}" y="${f.y + 4}">${esc(r)}</text><text class="sm-row" data-row="${sec.id}|${esc(r)}" x="${l.x + 20}" y="${l.y + 4}">${esc(r)}</text>`; }).join('');
      let ga = '';
      if (g.kind === 'ga') {
        const spots = g.local, t = ttOf(sec.ticketTypeId), bx = g.box;
        const free = inv ? spots.filter(p => o.states?.get(p.id)?.state === 'available').length : spots.filter(p => !off.has(p.id) && !mine.has(p.id)).length, picked = spots.filter(p => mine.has(p.id)).length;
        const buy = !design && !o.preview && t && free > 0, selN = spots.filter(p => seatSel.has(p.id)).length;
        ga = `<rect class="sm-ga ${buy ? 'buy' : ''} ${selN ? 'sel' : ''}" x="${bx.x}" y="${bx.y}" width="${bx.w}" height="${bx.h}" rx="12" fill="${t ? tierColor(ev, t.id) : '#c9c5ba'}" ${buy ? `data-action="pickGa" data-v="${esc(sec.code)}"` : ''} data-ga="${sec.id}"><title>${esc(g.local[0]?.area || sec.name)}${t ? ' — ' + esc(t.name) + ' ' + money(t.price, ev.currency) : ''}</title></rect>
          <text class="sm-ga-t" x="${bx.x + bx.w / 2}" y="${bx.y + bx.h / 2 - 2}">${esc(sec.name)}</text><text class="sm-ga-n" x="${bx.x + bx.w / 2}" y="${bx.y + bx.h / 2 + 15}">${inv ? `${spots.length - free} / ${spots.length} taken` : picked ? `${picked} selected · ${free} left` : free ? `${free} left · tap to add` : 'Sold out'}</text>`;
      }
      return `<g class="sm-sec ${on ? 'on' : ''}" data-sec="${sec.id}" transform="translate(${+sec.x || 0} ${+sec.y || 0}) rotate(${+sec.rot || 0} ${g.cx} ${g.cy})">
        ${design ? `<rect class="sm-hit" x="${g.minx - 32}" y="${g.miny - 40}" width="${g.maxx - g.minx + 64}" height="${g.maxy - g.miny + 58}" rx="14"/>` : ''}
        <text class="sm-name" ${inv || o.mode === 'seats' ? `data-secname="${sec.id}"` : ''} x="${g.cx}" y="${g.miny - 22}">${esc(sec.name)}</text>
        ${g.kind === 'table' ? `<circle class="sm-table" cx="0" cy="0" r="${g.R}"/>` : g.kind === 'booth' ? `<rect class="sm-table" x="${g.box.x}" y="${g.box.y}" width="${g.box.w}" height="${g.box.h}" rx="8"/>` : g.kind === 'ga' ? ga : rows}
        ${g.kind === 'ga' ? '' : (o.ghosts ? g.all : g.local).map(p => {
          if (p.removed) return `<circle class="st rm ${seatSel.has(p.id) ? 'sel' : ''}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="10.5" data-seat="${esc(p.id)}"><title>${esc(p.id)} — removed (click to select, then Restore)</title></circle>`;
          const t = ttOf(p.tt), x = inv ? o.states?.get(p.id) : null, isOff = off.has(p.id), isM = mine.has(p.id), sel = seatSel.has(p.id);
          let fill = tierColor(ev, p.tt), cls = '';
          if (inv) { if (x.state !== 'available') fill = STATE_COLORS[x.state]; cls = 'inv-' + x.state + (o.filter && !(o.filter === x.state || (o.filter === 'discount' && x.o?.data?.code) || (o.filter === 'released' && o.released?.has(p.id))) ? ' dim' : ''); }
          else if (!design && (isOff || !t)) { fill = '#d7d4cb'; cls = 'tkn'; }
          const buy = !design && !o.preview && !isOff && t;
          const tip = `${seatName(ev, p.id)}${t ? ' — ' + t.name + ' ' + money(t.price, ev.currency) : ' — not for sale'}${inv ? ' · ' + SEAT_STATES[x.state] + (x.t ? ' · ' + x.t.holder : '') + (x.s?.note ? ' · ' + x.s.note : '') : isOff ? ' (unavailable)' : ''}`;
          return `<circle class="st ${cls} ${isM ? 'mine' : ''} ${sel ? 'sel' : ''} ${!t ? 'nop' : ''}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="10.5" fill="${fill}" data-seat="${esc(p.id)}" ${buy ? `data-action="pickSeat" data-v="${esc(p.id)}"` : ''}><title>${esc(tip)}</title></circle>${g.kind === 'table' ? '' : `<text class="sm-num" x="${p.x.toFixed(1)}" y="${(p.y + 3.5).toFixed(1)}">${esc(p.label)}</text>`}`;
        }).join('')}</g>`; }).join('')}
  </svg>`;
}
function LevelTabs(st, cur, action) {
  const lv = levelsOf(st); if (lv.length < 2) return '';
  return `<div class="tabs sm-levels">${lv.map(l => `<button type="button" class="${cur === l.id ? 'on' : ''}" data-action="${action}" data-v="${esc(l.id)}">${esc(l.name)}</button>`).join('')}</div>`;
}
function BuyerSeatMap(ev, av, sel, preview) {
  const off = offSeats(av, sel?.slotId), used = [...new Set(Object.values(ev.seating.index || {}))], z = S.ui.zoom || 1;
  const lvs = levelsOf(ev.seating), lv = lvs.some(l => l.id === S.ui.bLevel) ? S.ui.bLevel : lvs[0].id;
  const mineOn = id => (sel?.seats || []).filter(s => (layoutOf(ev.seating).byId.get(s)?.level ?? '') === id).length;
  return `<div class="card sm-buy"><div class="between wrap" style="margin-bottom:10px"><div><div class="eyebrow dash">Choose your seats</div><p class="small muted" style="margin-top:4px">Tap seats to select them. Tap again to remove.</p></div>
      <div class="row"><button class="icon-btn" data-action="zoom" data-d="-1" aria-label="Zoom out">−</button><button class="icon-btn" data-action="zoom" data-d="1" aria-label="Zoom in">+</button></div></div>
    ${lvs.length > 1 ? `<div class="tabs sm-levels">${lvs.map(l => `<button type="button" class="${lv === l.id ? 'on' : ''}" data-action="bLevel" data-v="${esc(l.id)}">${esc(l.name)}${mineOn(l.id) ? ` · ${mineOn(l.id)}` : ''}</button>`).join('')}</div>` : ''}
    <div class="sm-scroll"><div style="width:${z * 100}%">${SeatCanvas(ev, { off, mine: sel?.seats, level: lv, preview })}</div></div>
    <div class="legend">${ev.ticketTypes.filter(t => used.includes(t.id)).map(t => `<span><i style="background:${tierColor(ev, t.id)}"></i>${esc(t.name)} ${money(t.price, ev.currency)}</span>`).join('')}
      <span><i style="background:#d7d4cb"></i>Unavailable</span><span><i style="background:var(--accent);box-shadow:0 0 0 2px var(--ink)"></i>Your seats</span></div>
    ${ev.seating.noSingles ? '<p class="small muted" style="margin-top:8px">Please don\'t leave a single empty seat between your seats and the next ones.</p>' : ''}</div>`;
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
function cartQuote() {
  const bo = cartBo(), evs = S.events.concat(S.adm?.events || []), set = bo ? pricingSettings(bo, S.platform) : S.settings, o = { avail: S.avail, method: S.co.payment, pass: S.co.pass || null };
  const q = quote(S.cart, evs, set, S.co.disc, o), c = coCredit(); if (!c) return q;
  return quote(S.cart, evs, set, S.co.disc, { ...o, credit: Math.min(c.remaining, c.event_id ? eventPortion(q, c.event_id) : Infinity) });
}
// the credit this checkout will use: a typed credit code, or (signed in) the account's best credit for these events
function coCredit() {
  const ids = cartEventIds(), ok = c => c && c.status === 'active' && c.remaining > 0 && (!c.event_id || ids.includes(c.event_id)) && (!cartBo() || !c.box_office_id || c.box_office_id === cartBo().id);
  if (S.co.credit) return ok(S.co.credit) ? S.co.credit : null;
  return S.co.useAcct && S.cust ? (S.myCredits || []).filter(ok).sort((a, b) => b.remaining - a.remaining)[0] || null : null;
}
const cartEventIds = () => [...new Set([...S.cart.items, ...S.cart.addons].map(i => i.eventId))];
// smart add-ons: an offer shows when the cart matches its trigger (ticket type, seating area, price level, quantity) and the product isn't in it yet
function upsellsFor(q) {
  const out = [];
  for (const id of cartEventIds()) {
    const ev = evById(id); if (!ev) continue;
    const mix = cartMix(ev, q.lines), av = S.avail[ev.id];
    for (const u of ev.upsells || []) {
      const ad = (ev.addons || []).find(a => a.id === u.addonId);
      if (!ad || !addonOpen(ad) || S.cart.addons.some(a => a.eventId === ev.id && a.addonId === ad.id) || (+ad.qty > 0 && av && (av.ad?.[ad.id] || 0) >= +ad.qty)) continue;
      const hitTT = !(u.ticketTypeIds || []).length || u.ticketTypeIds.some(t => mix.tts.includes(t)), hitArea = !(u.areas || []).length || u.areas.some(a => mix.areas.includes(a));
      const hitPrice = !(u.prices || []).length || u.prices.some(p => mix.prices.includes(+p));
      if (!mix.tickets || !hitTT || !hitArea || !hitPrice || mix.tickets < (+u.minQty || 1) || !addonAllowed(ev, ad, mix.tts, mix.areas) || out.some(o => o.ad.id === ad.id)) continue;
      const n = u.perTicket ? mix.tts.filter(t => !(u.ticketTypeIds || []).length || u.ticketTypeIds.includes(t)).length : 1;
      out.push({ ev, u, ad, n: Math.max(1, Math.min(n, +ad.max || 99)) });
    }
  }
  return out;
}
function Checkout() {
  const co = S.co, set = S.settings, bo = cartBo();
  if (co.pay) return PaymentStep();
  const q = cartQuote(), ups = upsellsFor(q), ref = co.tracking || sessionStorage.getItem('set_ref') || '';
  const evIds = cartEventIds(), evs = evIds.map(evById).filter(Boolean), ck = checkoutFor(set, evs);   // Stage 10: the strictest of the box office's and each event's form
  co.t0 ||= Date.now();
  const stopped = evs.map(e => controlBlock(e, 'checkout')).find(Boolean), pols = policiesFor(bo, evs), optFees = evs.flatMap(e => (e.fees?.extra || []).filter(x => x.optional).map(x => ({ ...x, ev: e })));
  if (!q.lines.length) return `<div class="container section"><div class="empty"><div class="display">Your cart is empty</div><p style="margin-bottom:18px">Find something great to go to.</p><a class="btn btn-accent" href="#/">Browse events <span class="arr">→</span></a></div></div>`;
  const card = cardReady(bo, S.platform) && set.payments?.card !== false, gw = GATEWAYS[bo?.gateway?.provider];
  const payOpts = [
    set.payments?.card !== false && { v: 'card', t: 'Card, Apple Pay or Google Pay', d: card ? `Secure payment by ${gw.name}${bo.gateway.test ? ' · test mode, no real charge' : ''}` : cardOffWhy(bo, S.platform), off: !card },
    set.payments?.offline !== false && { v: 'offline', t: 'Pay later / at the door', d: 'Reserve now. Your tickets are issued once the box office has your payment.' },
  ].filter(Boolean);
  if (!co.payment || payOpts.find(p => p.v === co.payment)?.off) co.payment = (payOpts.find(p => !p.off) || {}).v || '';
  const perEv = ticketsPerEvent(q), orderQs = set.questions || [];
  const field = (k, label, o = {}) => `<div><label class="fl">${label}${o.req ? ' *' : ''}</label><input class="inp" ${o.type ? `type="${o.type}"` : ''} data-bind="co.${k}" ${k === 'phone' ? 'data-action-change="rr"' : ''} ${o.ac ? `autocomplete="${o.ac}"` : ''} value="${esc(getPath(co, k) || '')}"></div>`;
  return `<div class="container"><div class="checkout">
    <div>
      <a href="javascript:history.back()" class="small muted" style="text-decoration:none">← Keep shopping</a>
      <h1 class="display" style="font-size:44px;margin:10px 0 6px">Checkout</h1>
      <ol class="co-steps"><li class="done">Tickets</li><li class="done">Add-ons</li><li class="on">Your details</li><li>Pay</li><li>Tickets</li></ol>
      ${Object.values(S.cart.holds || {}).some(Boolean) ? `<div class="banner info hold-banner">${ic('lock', 14)} <span data-hold="${esc(Object.values(S.cart.holds).filter(Boolean).sort()[0])}">${holdText(Object.values(S.cart.holds).filter(Boolean).sort()[0])}</span></div>` : ''}
      ${ck.note ? `<div class="banner info">${esc(ck.note)}</div>` : ''}${evs.filter(e => e.page?.checkoutNote).map(e => `<div class="banner info"><b>${esc(e.name)}:</b> ${esc(e.page.checkoutNote)}</div>`).join('')}
      ${S.cust ? `<p class="small muted" style="margin-bottom:10px">Signed in as <b>${esc(S.cust.email)}</b> — these tickets will be in <a href="#/account">your account</a>.</p>`
        : `<p class="small muted" style="margin-bottom:10px">No account needed. <a href="#/account">Sign in</a> if you have one.</p>`}
      <div class="card stack">
        <div class="eyebrow dash">Your details</div>
        <div class="grid2">${field('name', 'Full name', { req: 1, ac: 'name' })}${field('email', 'Email', { req: 1, type: 'email', ac: 'email' })}</div>
        ${ck.phone !== 'off' || ck.address !== 'off' ? `<div class="grid2">${ck.phone !== 'off' ? field('phone', 'Mobile', { req: ck.phone === 'required', type: 'tel', ac: 'tel' }) : ''}${ck.address !== 'off' ? field('address', 'Address', { req: ck.address === 'required', ac: 'street-address' }) : ''}</div>` : ''}
        ${orderQs.map(qq => QField(qq, `answers.${qq.id}`)).join('')}
      </div>
      ${evs.filter(e => (e.questions || []).length).map(e => `<div class="card stack" style="margin-top:16px"><div class="eyebrow dash">${esc(e.name)}</div>
        ${e.questions.filter(qq => qq.scope !== 'ticket').map(qq => QField(qq, `answers.${qq.id}`)).join('')}
        ${Array.from({ length: e.questions.some(qq => qq.scope === 'ticket') ? perEv[e.id] || 0 : 0 }, (_, i) => `<div class="tq"><div class="small"><b>Ticket ${i + 1}</b></div>
          ${e.questions.filter(qq => qq.scope === 'ticket').map(qq => QField(qq, `tanswers.${qq.id}.${i}`)).join('')}</div>`).join('')}</div>`).join('')}
      ${optFees.length ? `<div class="card" style="margin-top:16px"><div class="eyebrow dash" style="margin-bottom:10px">Optional extras</div>${optFees.map(x => `<label class="check" style="margin-bottom:6px"><input type="checkbox" data-action="optFee" data-v="${esc(x.id)}" ${(S.cart.optFees || []).includes(x.id) ? 'checked' : ''}> <span>${esc(x.name)} <span class="muted">· ${esc([x.pct ? x.pct + '%' : '', x.fixed ? money(x.fixed) + (x.per === 'order' ? ' per order' : ' per ticket') : ''].filter(Boolean).join(' + '))}</span></span></label>`).join('')}</div>` : ''}
      ${donationOn(set, evs) ? `<div class="card" style="margin-top:16px"><div class="eyebrow dash">Add a donation</div><p class="small muted" style="margin:6px 0 12px">${donationPurpose(set, evs) ? 'Support the ' + esc(donationPurpose(set, evs)) : `Support ${esc(set.name)}'s community programs`}. No fees are charged on donations.</p>
        <div class="row wrap">${[0, ...(set.donationAmounts?.length ? set.donationAmounts : DEFAULT_SETTINGS.donationAmounts)].map(v => `<button class="btn ${+S.cart.donation === v && !co.donCustom ? 'btn-dark' : 'btn-ghost'} btn-sm" data-action="donate" data-v="${v}">${v ? money(v) : 'None'}</button>`).join('')}
          ${set.donationCustom !== false ? `<input class="inp" style="width:120px" type="number" min="0" step="1" placeholder="Other $" value="${co.donCustom ? esc(S.cart.donation / 100) : ''}" data-action-change="donateCustom" aria-label="Other donation amount">` : ''}</div></div>` : ''}
      <div class="card" style="margin-top:16px"><div class="eyebrow dash" style="margin-bottom:12px">Payment</div>
        ${payOpts.map(p => `<label class="pay-opt ${co.payment === p.v ? 'on' : ''} ${p.off ? 'off' : ''}"><input type="radio" name="pay" ${p.off ? 'disabled' : ''} ${co.payment === p.v ? 'checked' : ''} data-action="pay" data-v="${p.v}"><div><b>${esc(p.t)}</b><div class="small muted">${esc(p.d)}</div></div></label>`).join('') || '<p class="small muted">This box office isn\'t taking payments online right now.</p>'}
        ${PlanOffer(q, set, evs)}
        <div class="sep"></div>
        <label class="check"><input type="checkbox" data-bind="co.terms" ${co.terms ? 'checked' : ''}> <span>I agree to the ${pols.length ? pols.map((p, i) => `<a href="#" data-action="showPolicy2" data-i="${i}">${esc(evs.length > 1 ? p.title : POLICY_KINDS[p.kind])}</a>`).join(', ') : 'terms'}.</span></label>
        <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" data-bind="co.hp" value="">
        ${ck.optIn !== false ? `<label class="check" style="margin-top:8px"><input type="checkbox" data-bind="co.optIn" ${co.optIn ? 'checked' : ''}> <span>Email me about future ${esc(set.name)} events.</span></label>` : ''}
        ${ck.smsOptIn !== false && ck.phone !== 'off' && normPhone(co.phone) ? `<label class="check" style="margin-top:8px"><input type="checkbox" data-bind="co.smsOptIn" ${co.smsOptIn ? 'checked' : ''}> <span>Text me news and offers from ${esc(set.name)}. Msg &amp; data rates may apply; reply STOP to opt out.</span></label>` : ''}
      </div>
    </div>
    <aside class="ticket-panel"><div class="card">
      <h3>Order summary</h3>
      ${evs.map(ev => `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)"><div class="between"><b>${esc(ev.name)}</b><button class="icon-btn" style="width:26px;height:26px" data-action="removeEv" data-id="${ev.id}" aria-label="Remove">${ic('x', 13)}</button></div>
        <div class="small muted">${esc(fmtDT(ev.start))} · ${esc(ev.venue || '')}</div>
        ${q.lines.filter(l => l.eventId === ev.id).map(l => SumLine(ev, l, q.currency)).join('')}</div>`).join('')}
      ${[['gifts', 'gift'], ['passes', 'pass']].map(([k, kind]) => q.lines.filter(l => l.kind === kind).map((l, i) => `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)"><div class="between"><b>${kind === 'gift' ? 'Gift card' : 'Membership'}</b><button class="icon-btn" style="width:26px;height:26px" data-action="delGP" data-k="${k}" data-i="${i}" aria-label="Remove">${ic('x', 13)}</button></div>
        ${SumLine(null, l, q.currency)}${l.gift ? `<div class="small muted">${esc(l.gift.toEmail ? 'For ' + (l.gift.to || l.gift.toEmail) + ' · emailed to ' + l.gift.toEmail : 'Emailed to you')}</div>` : ''}</div>`).join('')).join('')}
      ${ups.length ? `<div class="upsells">${ups.map(x => `<div class="upsell"><div><div class="small"><b>${esc(x.u.text || 'Add ' + x.ad.name)}</b></div><div class="small muted">${x.n} × ${esc(x.ad.name)} · ${money(x.ad.price * x.n, q.currency)}</div></div>
        <button class="btn btn-dark btn-sm" data-action="addUpsell" data-id="${x.ev.id}" data-v="${x.ad.id}" data-q="${x.n}">Add</button></div>`).join('')}</div>` : ''}
      <div class="sep"></div>
      ${co.disc ? `<div class="between small"><span class="chip ok">${esc(co.disc.code)}</span><a href="#" data-action="removeCode" class="small">Remove</a></div>${q.promoErr ? `<p class="small" style="color:var(--warn);margin-top:6px">${esc(q.promoErr)}</p>` : ''}`
        : ck.promo !== false ? `<div class="row"><input class="inp" data-bind="co.code" placeholder="Promo or referral code" value="${esc(co.code)}"><button class="btn btn-ghost" data-action="applyCode">Apply</button></div>` : ''}
      ${ref ? `<div class="between small" style="margin-top:8px"><span class="muted">Referral code <b class="tnum">${esc(ref)}</b></span><a href="#" data-action="removeRef" class="small">Remove</a></div>` : ''}
      ${CreditBox()}${PassBox(q)}
      ${Breakdown(q, co.disc?.code)}
      ${co.err || stopped ? `<div class="banner" style="background:var(--bad-bg);color:var(--bad);margin:12px 0 0">${esc(stopped || co.err)}</div>` : ''}
      <button class="btn btn-accent btn-lg btn-block" style="margin-top:16px" data-action="placeOrder" ${co.busy || stopped || (q.total && !co.payment) ? 'disabled' : ''}>${co.busy ? 'One moment…' : q.total ? (co.payment === 'offline' ? 'Reserve tickets' : 'Continue to payment') : 'Get free tickets'} <span class="arr">→</span></button>
      <p class="small muted" style="text-align:center;margin-top:10px">${ic('lock', 12)} ${q.total && co.payment === 'card' ? 'You\'ll see the exact total before you pay' : 'Secure checkout'} · tickets only after payment</p>
    </div></aside>
  </div></div>`;
}
// credit at checkout (Stage 6): signed-in customers get theirs offered automatically; guests type the credit code they were given
function CreditBox() {
  const co = S.co, mine = S.cust ? (S.myCredits || []).filter(c => c.status === 'active' && c.remaining > 0 && (!cartBo() || c.box_office_id === cartBo().id)) : [];
  if (S.cust && !S.myCredits && !S._credReq) { S._credReq = 1; DB.myCredits().then(r => { S.myCredits = r; if (r.some(c => c.status === 'active')) S.co.useAcct = true; render(); }).catch(() => { }); }
  if (co.credit) return `<div class="between small" style="margin-top:8px"><span class="chip ok">Credit ${esc(co.credit.code)} · ${money(co.credit.remaining)} left</span><a href="#" data-action="removeCredit" class="small">Remove</a></div>`;
  return `${mine.length ? `<label class="check small" style="margin-top:8px"><input type="checkbox" data-bind="co.useAcct" ${co.useAcct ? 'checked' : ''}> <span>Use my credit (${money(mine.reduce((a, c) => Math.max(a, c.remaining), 0))} available)</span></label>` : ''}
    ${co.creditOpen ? `<div class="row" style="margin-top:8px"><input class="inp" data-bind="co.creditCode" placeholder="Credit code, e.g. CR-…" value="${esc(co.creditCode || '')}"><button class="btn btn-ghost" data-action="applyCredit">Apply</button></div>`
      : `<a href="#" class="small" style="display:inline-block;margin-top:8px" data-action="openCredit">Have a credit code?</a>`}`;
}
const ticketsPerEvent = q => q.lines.reduce((m, l) => (m[l.eventId] = (m[l.eventId] || 0) + lineUnits(l).length, m), {});
// The money, every part on its own line (Eli's example: Tickets $300 · Booking fee $12 · Sales tax $8.50 · Discount −$30 · Total $290.50)
function Breakdown(q, code) {
  const row = (t, v, cls = '') => v ? `<div class="sum-line ${cls}"><span${cls ? '' : ' class="muted"'}>${t}</span><span class="tnum">${v < 0 ? '−' + money(-v, q.currency) : money(v, q.currency)}</span></div>` : '';
  return `<div class="breakdown" style="margin-top:12px">
    ${row('Tickets', q.ticketsTotal)}${row('Products & add-ons', q.addonsTotal)}${row('Gift cards', q.giftsTotal)}${row('Memberships & passes', q.passesTotal)}
    ${row('Booking fee', (q.fee || 0) + (q.feeDiscount || 0))}${row('Service fee', q.serviceFee)}${(q.otherFees || []).map(x => row(esc(x.name), x.amount)).join('')}${row('Sales tax', q.tax)}
    ${q.passDiscount ? `<div class="sum-line" style="color:var(--ok)"><span>Membership / pass</span><span class="tnum">−${money(q.passDiscount, q.currency)}</span></div>` : ''}
    ${q.discount - (q.passDiscount || 0) + q.feeDiscount ? `<div class="sum-line" style="color:var(--ok)"><span>Discount${code ? ' · ' + esc(code) : ''}</span><span class="tnum">−${money(q.discount - (q.passDiscount || 0) + q.feeDiscount, q.currency)}</span></div>` : ''}
    ${row('Card processing', q.processing)}${row('Donation', q.donation)}${q.credit ? `<div class="sum-line" style="color:var(--ok)"><span>Credit applied</span><span class="tnum">−${money(q.credit, q.currency)}</span></div>` : ''}${q.refunded ? row('Refunded', -q.refunded) : ''}
    <div class="sum-line total"><span>Total</span><span class="tnum">${money(q.total, q.currency)}</span></div></div>`;
}
// one checkout question. path is under S.co ("answers.<id>" or "tanswers.<id>.<ticket>")
function QField(q, path) {
  const v = getPath(S.co, path), bind = `data-bind="co.${path}"`, t = q.type || 'text', req = q.required ? ' *' : '';
  if (t === 'checkbox') return `<label class="check"><input type="checkbox" ${bind} data-t="bool" ${v ? 'checked' : ''}> <span>${esc(q.label)}${req}</span></label>`;
  if (t === 'terms' || t === 'waiver') return `<div class="q-terms">${q.text ? `<div class="q-text ${t === 'waiver' ? 'waiver' : ''}">${esc(q.text)}</div>` : ''}<label class="check"><input type="checkbox" ${bind} data-t="bool" ${v ? 'checked' : ''}> <span>${t === 'waiver' ? 'I have read and accept: ' : ''}${esc(q.label)}${req}</span></label></div>`;
  const lab = `<label class="fl">${esc(q.label)}${req}</label>`;
  if (t === 'select') return `<div>${lab}<select class="inp" ${bind}><option value="">Choose…</option>${String(q.options || '').split(',').map(o => o.trim()).filter(Boolean).map(o => `<option ${v === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  if (t === 'date') return `<div>${lab}<input class="inp" type="date" ${bind} value="${esc(v || '')}"></div>`;
  if (t === 'signature') return `<div>${lab}<div class="sig"><canvas class="sig-pad" width="560" height="140" data-sig="${esc(path)}" aria-label="Sign here"></canvas>
    <div class="between small"><span class="muted">Sign with your finger or mouse — or type your full name:</span><a href="#" data-action="sigClear" data-v="${esc(path)}">Clear</a></div>
    <input class="inp" placeholder="Type your full name to sign" ${bind} value="${esc(String(v || '').startsWith('data:') ? '' : v || '')}"></div></div>`;
  return `<div>${lab}<input class="inp" ${bind} value="${esc(v || '')}"></div>`;
}
// ── Payment (Stage 5): the order is placed (seats / stock reserved, NO tickets yet), then paid through the box office's processor ──
function PaymentStep() {
  const co = S.co, p = co.pay, cur = p.currency || S.settings.currency, demo = p.provider === 'demo', expired = D(p.expires_at) <= Date.now();
  return `<div class="container"><div class="pay-wrap">
    <ol class="co-steps"><li class="done">Tickets</li><li class="done">Add-ons</li><li class="done">Your details</li><li class="on">Pay</li><li>Tickets</li></ol>
    <div class="card pay-card">
      <div class="between"><div><div class="eyebrow">Order ${esc(p.ref)}</div><h2 style="margin-top:4px">Pay ${money(p.total, cur)}</h2>${p.plan ? '<div class="small muted">Deposit for your payment plan</div>' : p.installment ? '<div class="small muted">Next payment of your plan</div>' : ''}</div>${p.test ? '<span class="chip info">Test mode</span>' : ''}</div>
      <div class="banner ${expired ? 'bad' : 'info'}" style="margin:14px 0">${ic('lock', 14)} <span data-pay="${esc(p.expires_at)}">${payText(p.expires_at)}</span></div>
      ${expired ? `<p class="small">Nothing was charged. Your selection is still in your cart.</p><button class="btn btn-accent btn-block" data-action="payRestart">Start again</button>` : demo ? `
        <div class="wallets"><button class="btn btn-dark wallet" data-action="payWallet" data-v="apple_pay" ${co.busy ? 'disabled' : ''}>Apple Pay</button><button class="btn btn-ghost wallet" data-action="payWallet" data-v="google_pay" ${co.busy ? 'disabled' : ''}>Google Pay</button></div>
        <div class="or"><span>or pay by card</span></div>
        <div class="field"><label class="fl">Card number</label><input class="inp tnum" inputmode="numeric" autocomplete="cc-number" placeholder="1234 1234 1234 1234" data-bind="co.card.number" value="${esc(co.card?.number || '')}"></div>
        <div class="grid2"><div class="field"><label class="fl">Expiry</label><input class="inp tnum" autocomplete="cc-exp" placeholder="MM/YY" data-bind="co.card.exp" value="${esc(co.card?.exp || '')}"></div>
          <div class="field"><label class="fl">Security code</label><input class="inp tnum" inputmode="numeric" autocomplete="cc-csc" placeholder="CVC" data-bind="co.card.cvc" value="${esc(co.card?.cvc || '')}"></div></div>
        <p class="small muted">Demo processor: use <b class="tnum">4242 4242 4242 4242</b> (any future date, any CVC). <b class="tnum">4000 0000 0000 0002</b> is declined, <b class="tnum">4000 0000 0000 9995</b> has insufficient funds.</p>`
        : `<div id="payEl" class="pay-el"></div>`}
      ${co.err ? `<div class="banner" style="background:var(--bad-bg);color:var(--bad);margin:12px 0 0">${esc(co.err)}</div>` : ''}
      ${expired ? '' : `<button class="btn btn-accent btn-lg btn-block" style="margin-top:16px" data-action="payCard" ${co.busy ? 'disabled' : ''}>${co.busy ? 'Processing…' : 'Pay ' + money(p.total, cur)} <span class="arr">→</span></button>
        <div class="between small" style="margin-top:12px"><span class="muted">${ic('lock', 12)} Card details go straight to the processor — we never see or store them.</span><a href="#" data-action="payCancel">Cancel</a></div>`}
    </div>
    <p class="small muted" style="text-align:center;margin-top:14px">Your tickets are issued the moment the payment is confirmed — never before, and you're never charged twice for one order.</p>
  </div></div>`;
}
function payText(exp) { const ms = D(exp) - Date.now(); if (ms <= 0) return 'Time ran out — your seats were released.';
  return `Your seats and tickets are reserved for ${Math.floor(ms / 6e4)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')} while you pay`; }
setInterval(() => document.querySelectorAll('[data-pay]').forEach(el => { const was = el.textContent.startsWith('Time'); el.textContent = payText(el.dataset.pay); if (!was && el.textContent.startsWith('Time')) render(); }), 1000);
// Stripe (LIVE): the Payment Element shows card + Apple Pay + Google Pay + Link from the box office's own Stripe account
const STRIPE = { js: null, el: null, els: null, secret: '' };
async function mountStripe(p) {
  if (!window.Stripe) await new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'https://js.stripe.com/v3/'; sc.onload = ok; sc.onerror = () => no(new Error('Couldn\'t load the payment form')); document.head.append(sc); });
  const host = $('#payEl'); if (!host) return;
  if (STRIPE.secret !== p.clientSecret) { STRIPE.js = window.Stripe(p.publishableKey, { stripeAccount: p.account }); STRIPE.els = STRIPE.js.elements({ clientSecret: p.clientSecret }); STRIPE.el = STRIPE.els.create('payment'); STRIPE.secret = p.clientSecret; }
  if (!host.childElementCount) { try { STRIPE.el.unmount(); } catch (e) { } STRIPE.el.mount(host); }
}
// one order-summary line: tickets (with their price phase, seats and discount), packages (with what's inside) and add-ons
function SumLine(ev, l, cur) {
  const inside = l.kind === 'bundle' ? [...Object.entries(l.tts.reduce((m, id) => (m[id] = (m[id] || 0) + 1, m), {})).map(([id, n]) => `${n} × ${ev?.ticketTypes?.find(t => t.id === id)?.name || 'ticket'}`), ...l.addons.map(a => `${a.qty * l.qty} × ${a.name}`)].join(', ') : '';
  return `<div class="sum-line"><span>${l.qty} × ${esc(l.name)}${l.slotStart ? ` <span class="muted">@ ${esc(fmtTime(l.slotStart))}</span>` : ''}${l.phase ? ` <span class="chip mini">${esc(l.phase)}</span>` : ''}
    ${inside ? `<br><span class="small muted">${esc(inside)}${l.value > l.unit * l.qty ? ` · save ${money(l.value - l.unit * l.qty, cur)}` : ''}</span>` : ''}
    ${l.seats?.length ? `<br><span class="small muted">${esc(l.seats.map(x => seatName(ev, x, true)).join(', '))}</span>` : ''}
    ${l.disc || l.feeDisc ? `<br><span class="small" style="color:var(--ok)">−${money((l.disc || 0) + (l.feeDisc || 0), cur)} ${l.passDisc && l.passDisc >= (l.disc || 0) ? 'with your pass' : 'with code'}</span>` : ''}
    ${l.kind === 'addon' && S.route.page === 'cart' ? ` <a href="#" class="small muted" data-action="delAddonLine" data-id="${l.eventId}" data-v="${l.addonId}">remove</a>` : ''}</span><span class="tnum">${money(l.unit * l.qty, cur)}</span></div>`;
}
function holdText(exp) { const ms = D(exp) - Date.now(); if (ms <= 0) return 'Your seat hold has ended — the seats are yours if nobody else has taken them. Complete your order now.';
  const m = Math.floor(ms / 6e4), sec = Math.floor(ms / 1000) % 60; return `Your seats are held for you for ${m}:${String(sec).padStart(2, '0')}`; }
setInterval(() => document.querySelectorAll('[data-hold]').forEach(el => { el.textContent = holdText(el.dataset.hold); }), 1000);

// per-ticket answers as arrays {questionId: [ticket 1, ticket 2, …]}
const tAnswers = () => Object.fromEntries(Object.entries(S.co.tanswers || {}).map(([k, v]) => [k, Object.keys(v).reduce((a, i) => (a[+i] = v[i], a), [])]));
async function startPay(r) {
  const co = S.co; co.busy = false;
  try {
    const pay = await DB.startPayment(r.id, r.key);
    if (pay.paid) return checkoutDone(r);
    co.pay = { ...r, ...pay, provider: pay.provider, expires_at: pay.expires_at || r.expires_at, total: pay.total ?? r.total };
    try { localStorage.setItem('set_pay', JSON.stringify({ id: r.id, key: r.key, ref: r.ref })); } catch (e) { }
  } catch (e) { co.err = e.message; }
  render();
}
async function payWith(card) {
  const co = S.co, p = co.pay; if (!p || co.busy) return;
  co.busy = true; co.err = ''; render();
  try {
    if (p.provider === 'demo') await DB.payOrder(p.id, p.key, card);
    else {   // processor's own form; then wait for its webhook to confirm (that is what issues the tickets)
      const { error } = await STRIPE.js.confirmPayment({ elements: STRIPE.els, redirect: 'if_required', confirmParams: { return_url: location.origin + location.pathname + '#/order/' + p.id + '/' + p.key } });
      if (error) throw new Error(error.message);
      for (let i = 0; i < 30; i++) { const o = await DB.getOrder(p.id, p.key); if (o?.order?.status === 'paid') break; await new Promise(r => setTimeout(r, 1000)); }
    }
    co.card = null; checkoutDone(p);
  } catch (e) { co.busy = false; co.err = e.message; S.avail = {}; render(); }
}
function endPay() { S.co = { ...S.co, pay: null, busy: false, err: '', attempt: null, card: null }; try { localStorage.removeItem('set_pay'); } catch (e) { } render(); }
async function checkoutDone(r) {
  pix('Purchase', { value: r.total || 0, currency: S.settings.currency || 'USD', id: r.id, ref: r.ref, n: S.cart.items.reduce((a, i) => a + (+i.qty || 0), 0) });
  cartEventIds().forEach(id => DB.ping(id, 0, true));   // live activity: this visitor's cart became an order
  S.cart = { items: [], addons: [], gifts: [], passes: [], donation: 0, unlock: {} }; saveCart(); S.co.credit = null; S.co.pass = null; S.co.plan = false; S.co.creditCode = ''; S.co.useAcct = false; S.myCredits = null; S._credReq = 0;
  S.co = { ...S.co, busy: false, disc: null, code: '', tracking: '', answers: {}, tanswers: {}, terms: false, pay: null, attempt: null, card: null, err: '' };
  try { localStorage.removeItem('set_pay'); } catch (e) { }
  S.avail = {}; _availReq.clear(); S.order = null;
  if (S.adm) await reloadAdmin();
  location.hash = '#/order/' + r.id + '/' + r.key;
}
// signature pads: draw with a finger / mouse; the PNG is the answer
function sigMount() {
  document.querySelectorAll('canvas[data-sig]').forEach(c => {
    if (c._on) return; c._on = true;
    const ctx = c.getContext('2d'), v = getPath(S.co, c.dataset.sig); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.strokeStyle = '#020a16';
    if (String(v || '').startsWith('data:image/png')) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0); im.src = v; }
    let down = false; const pt = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
    c.addEventListener('pointerdown', e => { down = true; c.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pt(e)); });
    c.addEventListener('pointermove', e => { if (down) { ctx.lineTo(...pt(e)); ctx.stroke(); } });
    c.addEventListener('pointerup', () => { if (!down) return; down = false; setPath(S.co, c.dataset.sig, c.toDataURL('image/png')); const t = c.parentNode.querySelector('input'); if (t) t.value = ''; });
  });
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
  const ord = o.order, d = ord.data, cur = d.currency, self = o.self || {}, xs = OrderPageExtras(o), byEv = id => self.byEvent?.[id] || {};
  return `<div class="container" style="padding:36px 28px 60px;max-width:900px">
    <div class="no-print">
      <span class="chip ${ord.status === 'paid' ? 'ok' : ['pending', 'awaiting_payment'].includes(ord.status) ? 'warn' : 'bad'}">${esc(ORDER_STATUS[ord.status] || ord.status)}</span>
      <h1 class="display" style="font-size:48px;margin:12px 0 6px">${{ paid: 'You\'re going!', pending: d.plan ? 'On a payment plan' : 'Reserved', awaiting_payment: 'Payment not finished', expired: 'Checkout expired', cancelled: 'Order cancelled', refunded: 'Order refunded' }[ord.status] || esc(ord.status)}</h1>
      <p class="muted">Order <b>${esc(ord.ref)}</b>${ord.status === 'paid' ? ` · confirmation sent to <b>${esc(ord.buyer_email)}</b>` : ''}${ord.paidWith ? ` · paid with ${esc(ord.paidWith)}` : ''}</p>
      ${ord.status === 'pending' && !d.plan ? `<div class="banner info" style="margin-top:14px">Your tickets are held for you. They're issued here and emailed as soon as ${esc(S.settings.name)} receives your payment.</div>` : ''}
      ${ord.status === 'awaiting_payment' ? `<div class="banner info" style="margin-top:14px">This order isn't paid yet, so no tickets were issued. <a href="#/cart" data-action="resumePay">Finish paying</a> before the time runs out.</div>` : ''}
      ${ord.status === 'expired' ? `<div class="banner" style="margin-top:14px">The payment wasn't completed in time, so nothing was charged and the seats were released.</div>` : ''}
      ${S.settings.checkout?.thanks && ord.status === 'paid' ? `<p style="margin-top:12px">${esc(S.settings.checkout.thanks)}</p>` : ''}
      <div class="row wrap" style="margin:18px 0 26px"><button class="btn btn-ghost" data-action="contactOrg" data-id="${esc(ord.event_ids?.[0] || '')}" data-ref="${esc(ord.ref)}">${ic('mail', 14)} Contact organizer</button>
        ${o.tickets.some(t => t.status === 'valid') && self.download ? '<button class="btn btn-dark" data-action="print">Download PDF / print tickets</button>' : ''}
        ${[...new Set(d.lines.map(l => l.eventId))].map(id => evById(id) ? `<button class="btn btn-ghost" data-action="ics" data-id="${id}">${ic('cal', 14)} Add ${esc(evById(id).name)} to calendar</button>` : '').join('')}
        ${ord.status === 'paid' && self.resend ? '<button class="btn btn-ghost" data-action="selfResend">Email my tickets again</button>' : ''}
      </div>
    </div>
    ${xs.planCard}
    ${o.tickets.filter(t => t.status === 'valid').map(t => {
      const l = { ...d.lines.find(x => x.eventId === t.event_id && (x.ticketTypeId === t.ticket_type_id || (x.kind === 'bundle' && x.bundleId === t.bundle?.id))) }, ev = evById(t.event_id) || { name: l.eventName };
      const tt = (ev.ticketTypes || []).find(x => x.id === t.ticket_type_id) || { name: l.name, admits: l.admits };
      l.name = tt.name; l.slotStart = (ev.timeSlots || []).find(x => x.id === t.slot_id)?.start || l.slotStart;
      return `<div class="e-ticket"><div class="l"><div class="logo">${logo()}</div>
        <div class="eyebrow" style="color:var(--accent)">${esc(tt.name || 'Ticket')}${(+tt.admits > 1) ? ' · admits 1 of ' + tt.admits : ''}${t.bundle ? ' · ' + esc(t.bundle.name) : ''}${t.comp ? ' · Complimentary' : ''}</div>
        <h3 style="margin-top:6px">${esc(ev.name)}</h3>
        <div class="kv"><div><div class="k">Date</div><div class="v">${esc(fmtDate(t.slot_id ? l.slotStart : ev.start, { month: 'short', day: 'numeric', year: 'numeric' }))}</div></div>
          <div><div class="k">Time</div><div class="v">${esc(fmtTime(t.slot_id ? l.slotStart : ev.start))}</div></div>
          ${t.seat ? (sp => `<div class="seat3">${[['Ticket type / Area', sp.area && sp.area !== l.name ? `${l.name || ''} · ${sp.area}` : sp.area || l.name || ''],
              ...(sp.unit ? [unitParts(sp.unit)] : []), ...(sp.row ? [['Row', sp.row]] : []), ...(sp.seat ? [['Seat', sp.seat]] : [])].map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>`)(seatParts(ev, t.seat, t))
            : `<div><div class="k">Entry</div><div class="v">General admission</div></div>`}
          <div><div class="k">Name</div><div class="v">${esc(t.holder)}</div></div>
          <div><div class="k">Order</div><div class="v">${esc(ord.ref)}${(n => n > 1 ? ` · ticket ${o.tickets.filter(x => x.status === 'valid').indexOf(t) + 1} of ${n}` : '')(o.tickets.filter(x => x.status === 'valid').length)}</div></div>
          <div style="grid-column:span 2"><div class="k">Venue</div><div class="v">${esc([ev.venue, ev.address].filter(Boolean).join(' · '))}</div></div></div>
        ${ord.status === 'paid' && !t.checked_in_at && (byEv(t.event_id).download || byEv(t.event_id).rename || byEv(t.event_id).transfer) ? `<div class="row wrap no-print tk-actions">${byEv(t.event_id).download ? `<button class="btn btn-dark btn-sm" data-action="walletAdd" data-v="apple" data-id="${t.id}">Add to Apple Wallet</button><button class="btn btn-ghost btn-sm" data-action="walletAdd" data-v="google" data-id="${t.id}">Save to Google Wallet</button>` : ''}
          ${byEv(t.event_id).rename ? `<a href="#" class="small" data-action="selfRename" data-id="${t.id}">Change name</a>` : ''}${byEv(t.event_id).transfer ? `<a href="#" class="small" data-action="selfTransfer" data-id="${t.id}">Transfer</a>` : ''}</div>` : ''}
      </div><div class="r"><div class="qr" data-qr="${esc(t.code)}"></div><div class="code">${esc(t.code)}</div><div class="small muted">${t.checked_in_at ? 'Checked in ' + esc(fmtDT(t.checked_in_at)) : 'Show at the door'}</div></div></div>`;
    }).join('')}
    ${xs.vouchers}${xs.bought}${xs.requests}
    <div class="card no-print" style="margin-top:20px"><h3>Receipt</h3>
      ${d.lines.map(l => SumLine(evById(l.eventId), l, cur)).join('')}
      ${Breakdown({ ...d, ticketsTotal: d.ticketsTotal ?? d.subtotal, currency: cur }, d.code)}
      <p class="small muted" style="margin-top:12px">Bookmark this page — it's your ticket wallet. Need help? ${esc(S.settings.contactEmail)}</p></div>
    ${!S.cust && ['paid', 'pending'].includes(ord.status) ? `<div class="card no-print save-acct" style="margin-top:16px"><h3>Save your tickets</h3>
      <p class="small muted" style="margin:6px 0 12px">Create a free account with <b>${esc(ord.buyer_email)}</b> to find these and future tickets in one place. Optional — your tickets already work.</p>
      <div class="row"><input class="inp" type="password" autocomplete="new-password" placeholder="Choose a password (8+ characters)" data-input="saveAcct.pw"><button class="btn btn-dark" data-action="saveTickets">Create account</button></div></div>` : ''}
  </div>`;
}
// ── Customer account (Stage 5): optional. A secure ticket wallet + purchase history, a profile and a password.
//    Refunds, cancellations, seat changes, upgrades and transfers stay with the box office.
function Account() {
  if (!S.cust) return AccountAuth();
  const w = S.wallet;
  if (!w) { S.wallet = { loading: true }; Promise.all([DB.myOrders(), DB.myCredits().catch(() => [])]).then(([r, c]) => { S.wallet = { ...r, credits: c }; render(); }).catch(e => { S.wallet = { err: e.message }; render(); }); }
  if (!w || w.loading) return '<div class="container section"><p class="muted">Loading your tickets…</p></div>';
  const tab = S.ui.wtab || 'upcoming', now = Date.now() - 6 * 3600e3, evOf = id => evById(id) || { name: (w.orders.flatMap(o => o.data.lines).find(l => l.eventId === id) || {}).eventName || 'Event' };
  // one card per order + event, with its valid tickets
  const groups = (w.orders || []).flatMap(o => [...new Set(o.data.lines.map(l => l.eventId))].map(id => ({ o, ev: evOf(id), id, tks: (w.tickets || []).filter(t => t.order_id === o.id && t.event_id === id && t.status === 'valid') })))
    .filter(g => g.tks.length || ['pending', 'awaiting_payment'].includes(g.o.status));
  const when = g => D(g.tks[0]?.slot_id ? (g.ev.timeSlots || []).find(x => x.id === g.tks[0].slot_id)?.start || g.ev.start : g.ev.start);
  const up = groups.filter(g => !g.ev.start || when(g) >= now).sort((a, b) => when(a) - when(b)), past = groups.filter(g => g.ev.start && when(g) < now).sort((a, b) => when(b) - when(a));
  const card = g => `<a class="wallet-card" href="#/order/${esc(g.o.id)}/${esc(g.o.key)}"><div class="ev-img sm" style="${artBg(g.ev)}"></div><div style="flex:1;min-width:0"><b>${esc(g.ev.name)}</b>
    <div class="small muted">${g.ev.start ? esc(fmtDT(when(g).toISOString())) : ''}${g.ev.venue ? ' · ' + esc(g.ev.venue) : ''}</div>
    <div class="small">${g.tks.length ? `${g.tks.length} ticket${g.tks.length === 1 ? '' : 's'}${g.tks.some(t => t.seat) ? ' · ' + esc(g.tks.filter(t => t.seat).map(t => seatName(g.ev, t.seat, true, t)).join(', ')) : ''}` : `<span class="chip warn">${esc(ORDER_STATUS[g.o.status])}</span>`} · ${esc(g.o.ref)}</div></div><span class="btn btn-dark btn-sm">Open</span></a>`;
  const tabs = [['upcoming', `Upcoming (${up.length})`], ['past', 'Past'], ['orders', 'Orders'], ['profile', 'Profile']];
  const p = { name: S.ui.prof?.name ?? S.cust.name, phone: S.ui.prof?.phone ?? S.cust.phone };
  return `<div class="container" style="max-width:860px;padding:40px 20px 60px">
    <div class="between wrap"><div><h1 class="display" style="font-size:44px">My account</h1><p class="muted">${esc(S.cust.name || '')} · ${esc(S.cust.email)}</p></div><button class="btn btn-ghost btn-sm" data-action="custOut">Sign out</button></div>
    <div class="tabs" style="margin:20px 0">${tabs.map(([k, t]) => `<button class="${tab === k ? 'on' : ''}" data-action="custTab" data-v="${k}">${t}</button>`).join('')}</div>
    ${w.err ? `<div class="banner bad">${esc(w.err)}</div>` : ''}
    ${(w.credits || []).filter(c => c.status === 'active').map(c => `<div class="banner info">You have <b>${money(c.remaining)}</b> credit${c.event_id ? ' for ' + esc(evById(c.event_id)?.name || 'an event') : ''} — it's applied automatically at checkout (code <code>${esc(c.code)}</code>${c.expires ? ', expires ' + esc(fmtDate(c.expires, { month: 'short', day: 'numeric', year: 'numeric' })) : ''}).</div>`).join('')}
    ${tab === 'upcoming' ? (up.map(card).join('') || '<div class="empty">No upcoming tickets. <a href="#/">Find an event</a>.</div>')
      : tab === 'past' ? (past.map(card).join('') || '<div class="empty">No past events yet.</div>')
      : tab === 'orders' ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Order</th><th>Placed</th><th>Events</th><th>Total</th><th>Status</th></tr></thead><tbody>
          ${(w.orders || []).map(o => `<tr class="click" data-action="go" data-v="#/order/${esc(o.id)}/${esc(o.key)}"><td class="tnum"><b>${esc(o.ref)}</b></td><td class="small">${esc(fmtDT(o.created_at))}</td>
            <td>${esc([...new Set(o.data.lines.map(l => l.eventName))].join(', '))}</td><td class="tnum">${money(o.data.total, o.data.currency)}</td><td>${esc(ORDER_STATUS[o.status] || o.status)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No orders yet.</td></tr>'}</tbody></table></div>`
      : `<div class="cols"><div class="card"><h3>Profile</h3><div class="field"><label class="fl">Name</label><input class="inp" data-input="prof.name" value="${esc(p.name)}"></div>
          <div class="field"><label class="fl">Mobile</label><input class="inp" type="tel" data-input="prof.phone" value="${esc(p.phone)}"></div>
          <div class="field"><label class="fl">Email</label><input class="inp" readonly value="${esc(S.cust.email)}"><div class="small muted" style="margin-top:4px">Your tickets are matched to this email.</div></div>
          <button class="btn btn-accent" data-action="saveProfile">Save</button></div>
        <div class="card"><h3>Change password</h3><div class="field"><label class="fl">Current password</label><input class="inp" type="password" autocomplete="current-password" data-input="pw.cur"></div>
          <div class="field"><label class="fl">New password</label><input class="inp" type="password" autocomplete="new-password" data-input="pw.next"></div><button class="btn btn-dark" data-action="changePw">Change password</button></div></div>`}
    <p class="small muted" style="margin-top:24px">Need to change, move or refund an order? Contact the box office — those changes are handled by the organizer.</p>
  </div>`;
}
function AccountAuth() {
  const f = S.ui.ca || (S.ui.ca = { mode: 'in' }), m = f.mode;
  return `<div class="container" style="max-width:480px;padding:60px 20px"><h1 class="display" style="font-size:44px">${m === 'up' ? 'Create account' : m === 'forgot' ? 'Reset password' : 'Sign in'}</h1>
    <p class="muted" style="margin:6px 0 20px">${m === 'up' ? 'Optional — keep all your tickets in one place. You never need an account to buy.' : 'See your upcoming tickets, past orders and receipts.'}</p>
    <div class="card">${f.sent ? `<p>${m === 'forgot' ? 'If there\'s an account for that email, a reset link is on its way.' : 'Check your email to confirm your account, then sign in.'}</p>` : `
      ${m === 'up' ? `<div class="field"><label class="fl">Name</label><input class="inp" autocomplete="name" data-input="ca.name" value="${esc(f.name || '')}"></div>` : ''}
      <div class="field"><label class="fl">Email</label><input class="inp" type="email" autocomplete="email" data-input="ca.email" value="${esc(f.email || '')}"></div>
      ${m !== 'forgot' ? `<div class="field"><label class="fl">Password</label><input class="inp" type="password" autocomplete="${m === 'up' ? 'new-password' : 'current-password'}" data-input="ca.pw"></div>` : ''}
      ${f.err ? `<p class="small" style="color:var(--bad);margin-bottom:10px">${esc(f.err)}</p>` : ''}
      <button class="btn btn-accent btn-block" data-action="custAuth">${m === 'up' ? 'Create account' : m === 'forgot' ? (DB.live ? 'Email me a reset link' : 'Reset (demo: nothing is sent)') : 'Sign in'}</button>`}
      <div class="small" style="margin-top:14px;display:flex;gap:14px;flex-wrap:wrap">${m !== 'in' ? '<a href="#" data-action="custMode" data-v="in">Sign in</a>' : ''}${m !== 'up' ? '<a href="#" data-action="custMode" data-v="up">Create an account</a>' : ''}${m === 'in' ? '<a href="#" data-action="custMode" data-v="forgot">Forgot password?</a>' : ''}<a href="#/tickets">Find tickets with an order number</a></div></div>
    ${DB.live ? '' : '<p class="small muted" style="margin-top:14px">Demo account: <b>maya@example.com</b> / <b>tickets123</b></p>'}</div>`;
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
  ['dashboard', 'Dashboard', 'home'], ['events', 'Events', 'cal', 'events.view'], ['venues', 'Venues', 'pin', 'seating.view'], ['orders', 'Orders', 'cart', 'orders.view'], ['customers', 'Customers', 'users', 'customers.profiles'], ['passes', 'Gift cards & passes', 'tag', 'orders.view|orders.gifts'], ['pos', 'Door sales', 'cart', 'door.sell'], ['promos', 'Promotions', 'tag', 'tickets.discounts|tickets.discountsEdit|tickets.tracking|finance.reports'], ['attendees', 'Door list', 'users', 'door.attendees'],
  ['checkin', 'Scanner app', 'scan', 'door.scan'], ['reports', 'Reports', 'chart', 'finance.reports'], ['marketing', 'Marketing', 'mega', 'comms.email|comms.marketing|comms.lists|comms.automations|admin.integrations|admin.api'],
  ['team', 'Team', 'team', 'admin.invite|admin.perms|admin.remove'], ['branding', 'Branding', 'brush', 'admin.settings'], ['settings', 'Settings', 'gear', 'admin.settings'], ['security', 'My security', 'lock'],
];
const navOk = n => !n[3] || n[3].split('|').some(k => can(k));
// door-only staff (the Scanner staff template): the back office is just a way into the scanner — no dashboards, sales or customers
const scannerOnly = () => can('door.scan') && !NAV.some(n => n[3] && n[0] !== 'checkin' && navOk(n));
const ScannerHome = () => `<div class="empty" style="padding-top:12vh"><div class="display" style="font-size:30px">Your access is the scanner</div><p class="muted" style="margin:8px auto 18px;max-width:42ch">You can scan tickets, see whether they're valid, where the guest sits and the check-in totals.</p><a class="btn btn-accent btn-lg" href="#/scan">Open the scanner →</a></div>`;
const meLabel = m => m.support ? 'Platform support' : m.owner ? 'Owner' : (tplName(m.template) && (S.adm.bo.templates.find(t => t.id === m.template).perms.length === m.perms.length) ? tplName(m.template) : 'Custom access');
function AdminShell() {
  if (!S.user || S.user.mfa) return Login();
  if (!S.adm) return `<div class="empty" style="padding-top:30vh">Loading…</div>`;
  if (!S.adm.bo) return S.adm.super ? (setTimeout(() => { location.hash = '#/platform'; }), '') : Gate('No box office yet', `${esc(S.user.email)} isn't on any box office team. Ask an owner to invite you.`);
  if (S.adm.blocked) return Gate(S.adm.bo.name + ' is ' + BO_STATUS[S.adm.blocked].toLowerCase(), S.adm.blocked === 'pending' ? 'The platform team is reviewing this box office. You\'ll get an email when it\'s approved.' : 'Event pages and checkout are offline and staff access is paused. Contact the platform team.' + (S.adm.me?.owner ? '<br><br>Your records are still yours: <a href="#" data-action="gateXp">download all of your data</a>.' : ''));
  const sub = S.route.sub, page = { pos: Pos, passes: Passes, dashboard: Dashboard, events: EventsList, event: EventEditor, venues: Venues, orders: Orders, customers: Customers, promos: Promos, attendees: Attendees, checkin: CheckIn, reports: Reports, marketing: Marketing, team: Team, branding: Branding, settings: Settings, security: Security }[sub] || Dashboard;
  const allowed = NAV.filter(navOk), navKey = sub === 'event' ? 'events' : sub, entry = NAV.find(n => n[0] === navKey);
  const body = S.adm.needs2fa && sub !== 'security' ? Gate2fa() : entry && !navOk(entry) ? `<div class="empty"><div class="display" style="font-size:28px">No access</div><p class="muted" style="margin-top:8px">You don't have permission to open ${esc(entry[1])}. Ask a box office admin.</p></div>` : scannerOnly() && (sub || 'dashboard') === 'dashboard' ? ScannerHome() : page();
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
  ['finance@skyline.example', 'Finance', 'Reports only, no editing'], ['marketing@skyline.example', 'Marketing', 'Campaigns, automations, audience'], ['door@example.com', 'Door staff', 'Tonight\'s show only'], ['director@harborarts.example', 'Another box office', 'Harbor Arts — can\'t see Skyline']];
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
    can('events.create') ? `<a class="btn btn-accent" href="#" data-action="newEvent">${ic('plus', 15)} New event</a>` : '') + Onboarding() + `
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
const statusChip = s => `<span class="chip ${{ paid: 'ok', pending: 'warn', awaiting_payment: 'info', cancelled: 'bad', refunded: 'bad' }[s] || ''}">${esc(ORDER_STATUS[s] || s)}</span>`;

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
const ETABS = [['overview', 'Overview'], ['live', 'Live activity'], ['details', 'Details'], ['tickets', 'Tickets & pricing'], ['products', 'Products & packages'], ['schedule', 'Showtimes'], ['seating', 'Seating'], ['inventory', 'Seat inventory'], ['checkout', 'Page & checkout'], ['controls', 'Controls & fees'], ['discounts', 'Promo codes'],
  ['door', 'Door & check-in'], ['emails', 'Emails'], ['waitlist', 'Waitlist'], ['team', 'Team'], ['report', 'Full report'], ['history', 'History'], ['share', 'Share & embed']];
function EventEditor() {
  const ev = S.draft; if (!ev) return '<p class="muted">Event not found.</p>';
  const tab = S.route.params[1] || 'overview', ro = !can('events.edit', ev.id), pub = can('events.publish', ev.id);
  const body = { overview: EdOverview, live: EdLive, details: EdDetails, tickets: EdTickets, products: EdProducts, schedule: EdSchedule, seating: EdSeating, inventory: EdInventory, checkout: EdCheckout, controls: EdControls, discounts: EdDiscounts, door: EdDoor, emails: EdEmails, waitlist: EdWaitlist, team: EdTeam, report: EdReport, history: EdHistory, share: EdShare }[tab] || EdOverview;
  const live = ['overview', 'live', 'team', 'history', 'waitlist', 'inventory', 'discounts', 'door', 'report'].includes(tab);
  const auto = autosaved(ev.id);   // Stage 10: unsaved edits survive a closed tab or a crash  // these tabs act immediately, not through "Save changes"
  return `<a href="#/admin/events" class="small muted" style="text-decoration:none">← Events</a>
  ${head(esc(ev.name || 'Untitled event'), `${evChip(ev)} ${S.dirty ? '<span class="chip warn">Unsaved changes</span>' : ''}`,
    `<a class="btn btn-ghost" href="#/e/${esc(ev.slug)}?preview=1" target="_blank">Preview</a>
    ${can('events.create') ? '<button class="btn btn-ghost" data-action="saveTemplate">Save as template</button>' : ''}
    ${pub && !ev.archived ? (ev.status === 'published' ? '<button class="btn btn-ghost" data-action="setStatus" data-v="draft">Unpublish</button>' : ev.status === 'draft' ? '<button class="btn btn-dark" data-action="setStatus" data-v="published">Publish</button>' : '') : ''}
    ${ro ? '' : `<button class="btn btn-accent" data-action="saveEvent" ${S.dirty ? '' : 'disabled'}>Save changes</button>`}`)}
  ${auto && !S.dirty ? `<div class="banner info" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span>Unsaved changes from ${esc(fmtDT(auto.at))} were kept on this device.</span><button class="btn btn-dark btn-sm" data-action="autoRestore">Restore them</button><button class="btn btn-ghost btn-sm" data-action="autoDiscard">Discard</button></div>` : ''}
  <nav class="etabs">${ETABS.map(([k, t]) => `<a class="${tab === k ? 'on' : ''}" href="#/admin/event/${ev.id}/${k}">${t}</a>`).join('')}</nav>
  ${live ? body(ev) : `<fieldset ${ro ? 'disabled' : ''} style="border:0">${body(ev)}</fieldset>`}`;
}
// ── Door & check-in (Stage 7): live totals, entrances (optionally limited to ticket types / areas), event-day scan history ──
const SCAN_FILTERS = { all: ['All scans', () => true], ok: ['Check-ins', r => r.result === 'ok'], dup: ['Duplicates', r => r.result === 'already'], bad: ['Invalid', r => !['ok', 'already', 'undone'].includes(r.result)] };
function EdDoor(ev) {
  const ro = !can('events.edit', ev.id), saved = evById(ev.id) || ev, st = checkStats(ev.id), by = byEntrance(saved, st.tk), slots = saved.timeSlots || [];
  const areas = [...new Set(Object.values(saved.seating?.enabled ? saved.seating.meta || {} : {}).map(m => m[0]).filter(Boolean))];
  const lg = S.ui.dlog?.ev === ev.id ? S.ui.dlog : null, logOk = can('door.log', ev.id);
  if (logOk && !lg) { S.ui.dlog = { ev: ev.id, loading: true, f: 'all' }; DB.doorLog(ev.id).then(r => { if (S.ui.dlog?.ev === ev.id) { S.ui.dlog.rows = r; S.ui.dlog.loading = false; render(); } }).catch(e => { S.ui.dlog = { ev: ev.id, err: e.message, f: 'all' }; render(); }); }
  const rows = (lg?.rows || []).filter(SCAN_FILTERS[lg?.f || 'all'][1]), tk = id => S.adm.tickets.find(t => t.id === id);
  const kpi = (l, v, d = '') => `<div class="kpi"><div class="eyebrow">${l}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
  const chk = (i, k, v, on, label) => `<label class="chip-check ${on ? 'on' : ''}"><input type="checkbox" data-action="enPick" data-i="${i}" data-k="${k}" data-v="${esc(v)}" ${on ? 'checked' : ''} ${ro ? 'disabled' : ''}> ${esc(label)}</label>`;
  const vs = (S.adm.vouchers || []).filter(v => v.event_id === ev.id && v.status !== 'void'), vby = [...new Set(vs.map(v => v.name))].map(n => [n, vs.filter(v => v.name === n)]);
  return `${vby.length ? `<div class="card" style="margin-bottom:14px"><h3>Product vouchers</h3><p class="small muted" style="margin:2px 0 8px">Scanned at the bar, parking or merch stand — separately from the tickets.</p>${vby.map(([n, l]) => `<div class="between small line"><span>${esc(n)}</span><span class="tnum">${l.filter(v => v.status === 'redeemed').length} of ${l.length} redeemed</span></div>`).join('')}</div>` : ''}<div class="kpis">${kpi('Tickets', st.total.toLocaleString())}${kpi('Scanned in', st.inn.toLocaleString())}${kpi('Remaining', (st.total - st.inn).toLocaleString())}${kpi('Checked in', (st.total ? Math.round(st.inn / st.total * 100) : 0) + '%')}</div>
  <div class="cols"><div class="card" style="padding:0"><div style="padding:16px 20px 4px"><h3>By entrance</h3></div><table class="tbl"><thead><tr><th>Entrance</th><th>Takes</th><th>Checked in</th></tr></thead><tbody>
    ${by.map(x => `<tr><td><b>${esc(x.name)}</b></td><td class="small muted">${x.en ? esc([...(x.en.ticketTypeIds || []).map(id => saved.ticketTypes.find(t => t.id === id)?.name).filter(Boolean), ...(x.en.areas || [])].join(', ') || 'Everyone') : '—'}</td><td class="tnum">${x.n}</td></tr>`).join('') || '<tr><td colspan="3" class="muted small">No entrances set up — every scanner accepts every ticket.</td></tr>'}</tbody></table></div>
    ${slots.length ? `<div class="card" style="padding:0"><div style="padding:16px 20px 4px"><h3>By showtime</h3></div><table class="tbl"><thead><tr><th>Showtime</th><th>Checked in</th></tr></thead><tbody>
      ${slots.map(sl => { const x = checkStats(ev.id, sl.id); return `<tr><td>${esc(fmtDT(sl.start))}${sl.label ? ' · ' + esc(sl.label) : ''}</td><td class="tnum">${x.inn} / ${x.total}</td></tr>`; }).join('')}</tbody></table></div>` : `<div class="card"><h3>How scanning works</h3><p class="small muted" style="margin-top:6px">Each QR code holds only a random ticket code — no names, emails or payment details. Every scan is checked by the server, so a ticket can only get in once even with many phones scanning. Cancelled, refunded and replaced tickets are rejected at once.</p></div>`}</div>
  <div class="card" style="margin-top:16px"><div class="between"><h3>Entrances</h3>${ro ? '' : '<button class="btn btn-ghost btn-sm" data-action="enAdd">Add entrance</button>'}</div>
    <p class="small muted" style="margin:4px 0 12px">Door staff pick their entrance when they open the scanner. Limit an entrance to some ticket types or seating areas and it warns when a guest is at the wrong door (staff with “Override scanner warnings” can let them in anyway). Save with “Save changes”.</p>
    ${(ev.entrances || []).map((en, i) => `<div class="en-row"><div class="row" style="gap:8px"><input class="inp" data-input="entr:${i}:name" value="${esc(en.name)}" placeholder="e.g. VIP entrance" ${ro ? 'disabled' : ''} style="max-width:260px">${ro ? '' : `<button class="btn btn-ghost btn-sm" data-action="enDel" data-i="${i}">Remove</button>`}</div>
      <div class="small muted" style="margin:8px 0 4px">Only these ticket types <span class="muted">(none ticked = all)</span></div><div class="row wrap" style="gap:6px">${ev.ticketTypes.map(t => chk(i, 'ticketTypeIds', t.id, (en.ticketTypeIds || []).includes(t.id), t.name)).join('')}</div>
      ${areas.length ? `<div class="small muted" style="margin:8px 0 4px">Only these seating areas</div><div class="row wrap" style="gap:6px">${areas.map(a => chk(i, 'areas', a, (en.areas || []).includes(a), a)).join('')}</div>` : ''}</div>`).join('') || '<p class="small muted">No entrances yet.</p>'}</div>
  ${logOk ? `<div class="card" style="padding:0;margin-top:16px"><div class="between wrap" style="padding:16px 20px 8px;gap:8px"><h3>Scan history</h3><div class="row wrap">${Object.entries(SCAN_FILTERS).map(([k, [l, f]]) => `<button class="btn btn-sm ${(lg?.f || 'all') === k ? 'btn-dark' : 'btn-ghost'}" data-action="dlogF" data-v="${k}">${l} ${(lg?.rows || []).filter(f).length}</button>`).join('')}
      <button class="btn btn-ghost btn-sm" data-action="dlogRefresh">Refresh</button><button class="btn btn-ghost btn-sm" data-action="dlogCsv">Export CSV</button></div></div>
    <div class="tbl-wrap" style="border:0;box-shadow:none;border-radius:0;max-height:560px;overflow:auto"><table class="tbl"><thead><tr><th>Time</th><th>Result</th><th>Ticket</th><th>Guest / seat</th><th>Entrance</th><th>Device</th><th>Staff</th></tr></thead><tbody>
    ${lg?.loading ? '<tr><td colspan="7" class="muted small">Loading…</td></tr>' : lg?.err ? `<tr><td colspan="7" class="small" style="color:var(--bad)">${esc(lg.err)}</td></tr>` : rows.slice(0, 500).map(r => { const t = tk(r.ticket_id);
      return `<tr><td class="small tnum">${esc(fmtTime(r.at))}</td><td><span class="chip mini ${resKind(r.result)}">${esc(RES_TITLE[r.result] || r.result)}</span>${r.manual ? ' <span class="chip mini">manual</span>' : ''}${r.override ? ' <span class="chip warn mini">override</span>' : ''}</td>
        <td class="tnum small">${esc(r.code || '')}</td><td class="small">${t ? esc(t.holder || '') + (t.seat ? '<div class="muted">' + esc(seatName(saved, t.seat, false, t)) + '</div>' : '') : '<span class="muted">—</span>'}</td>
        <td class="small">${esc(r.entrance || '—')}</td><td class="small">${esc(r.device_name || '—')}</td><td class="small">${esc(r.by || '')}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted small">No scans yet.</td></tr>'}
    </tbody></table></div></div>` : ''}`;
}
function EdOverview(ev) {
  const saved = S.adm.events.find(e => e.id === ev.id) || ev, tks = S.adm.tickets.filter(t => t.event_id === ev.id), valid = tks.filter(t => t.status === 'valid');
  const so = sellout(saved, tks, S.adm.seatStatus, S.adm.orders), fin = can('finance.totals'), v = S.adm.views?.[ev.id] || { total: 0, unique: 0, today: 0, last10m: 0, bySrc: {} };
  const os = S.adm.orders.filter(o => o.event_ids.includes(ev.id) && ['paid', 'pending'].includes(o.status));
  const paidOrders = new Set(os.filter(o => o.status === 'paid' && !o.data.comp).map(o => o.id)), compOrders = new Set(os.filter(o => o.data.comp).map(o => o.id));
  const collected = sum(os.filter(o => o.status === 'paid'), o => sum(o.data.lines.filter(l => l.eventId === ev.id), l => l.unit * l.qty) - (o.data.discount || 0) * (sum(o.data.lines.filter(l => l.eventId === ev.id), l => l.unit * l.qty) / Math.max(1, o.data.subtotal)));
  const s = evStats(saved), blocked = sum(so.byArea, r => r.blocked);
  const pct = x => (x * 100).toFixed(x && x < .1 ? 1 : 0) + '%';
  const kpi = (l, val, d = '', dark) => `<div class="kpi ${dark ? 'dark' : ''}"><div class="eyebrow">${l}</div><div class="v">${val}</div>${d ? `<div class="d" ${dark ? 'style="color:var(--mut)"' : ''}>${d}</div>` : ''}</div>`;
  const slots = (saved.timeSlots || []);
  const fr = can('finance.reports') ? finReport(finX(), { eventId: ev.id }) : null;
  return `${fr ? `<div class="between wrap" style="gap:8px;margin:4px 0 12px"><div class="eyebrow dash">Financial dashboard</div><div class="row wrap"><a class="btn btn-ghost btn-sm" href="#/admin/reports" data-action="repOpenEvent" data-id="${ev.id}">Full report →</a>${can('finance.export') ? `<button class="btn btn-ghost btn-sm" data-action="xpEventId" data-id="${ev.id}">Export everything for this event</button>` : ''}</div></div>
  <div class="cols" style="margin-bottom:18px">${FinDash(fr.totals, { title: 'Money for this event' })}<div class="card"><h3>Profit</h3><div class="sum-line"><span>Revenue <span class="small muted">excl. sales tax</span></span><span class="tnum">${money(fr.totals.revenue)}</span></div>
    <div class="sum-line"><span>Refunds, chargebacks & processing</span><span class="tnum">−${money(fr.totals.refunds + fr.totals.credits + fr.totals.chargebacks + fr.totals.processing + fr.totals.platform)}</span></div><div class="sum-line"><span>Expenses</span><span class="tnum">−${money(fr.totals.expenses)}</span></div>
    <div class="sum-line total"><span>${fr.totals.profitFinal ? 'Event profit' : 'Estimated profit'}</span><span class="tnum">${money(fr.totals.profit)}</span></div>${can('finance.reports') ? `<a class="small" href="#/admin/reports/profit" data-action="repProfit" data-id="${ev.id}">Expenses & profit →</a>` : ''}</div></div>` : ''}
  ${fin ? `<div class="eyebrow dash" style="margin:4px 0 12px">Sellout value</div>
  <div class="kpis">${kpi('Potential sellout revenue', so.unknown && !so.total ? '—' : money(so.total), so.unknown ? 'Set a capacity or ticket limits to complete this' : so.estimate ? 'Unlimited ticket types counted up to capacity' : `${so.shows > 1 ? so.shows + ' showtimes · ' : ''}face value`, true)}
    ${kpi('Sold (face value)', money(so.soldValue), so.total ? pct(so.pct) + ' of potential' : '')}${kpi('Remaining potential', money(so.remaining))}${kpi('Collected', money(Math.round(collected)), 'paid orders, after discounts')}</div>
  <div class="bar big" style="margin:-4px 0 22px"><i style="width:${Math.min(100, so.pct * 100)}%"></i></div>
  <div class="cols"><div class="card" style="padding:0"><div style="padding:16px 20px 4px"><h3>By ticket type</h3></div><table class="tbl"><thead><tr><th>Ticket</th><th>Price</th><th>Inventory</th><th>Sold</th><th>Potential</th><th>Remaining</th></tr></thead><tbody>
    ${so.byTT.map(r => `<tr><td>${esc(r.tt.name)}${r.tt.hidden ? ' <span class="chip">hidden</span>' : ''}</td><td class="tnum">${money(r.tt.price)}</td><td class="tnum">${r.capacity == null ? '∞' : r.capacity}</td><td class="tnum">${r.sold}</td><td class="tnum">${money(r.potential)}</td><td class="tnum">${money(Math.max(0, r.potential - r.soldValue))}</td></tr>`).join('')}</tbody></table></div>
  ${`<div class="card"><h3>How this is calculated</h3><p class="small muted" style="margin-top:6px">Every sellable ticket × its price, per showtime. It updates by itself when prices, quantities, showtimes, seats or blocks change, and as tickets sell. Comps use up inventory but count at $0 collected.</p></div>`}</div>
  ${so.byArea.length ? `<div class="card" style="padding:0;margin-top:16px"><div class="between" style="padding:16px 20px 4px"><h3>By seating area</h3>${can('seating.view', ev.id) ? `<a class="small" href="#/admin/event/${ev.id}/inventory">Seat inventory →</a>` : ''}</div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Area</th><th>Seats</th><th>Price</th><th>Sold</th><th>Available</th><th>Blocked</th><th>Comped</th><th>Potential</th><th>Actual</th><th>Remaining</th></tr></thead><tbody>
    ${so.byArea.map(r => `<tr><td><b>${esc(r.name)}</b></td><td class="tnum">${r.seats}</td><td class="tnum">${r.prices.length ? r.prices.map(p => money(p)).join(' / ') : '—'}</td><td class="tnum">${r.sold}</td><td class="tnum">${r.available}${r.held ? `<div class="small muted">+${r.held} held</div>` : ''}</td><td class="tnum">${r.blocked}${r.unavailable ? `<div class="small muted">+${r.unavailable} unavail.</div>` : ''}</td><td class="tnum">${r.comped}</td><td class="tnum">${money(r.potential)}</td><td class="tnum">${money(r.actual)}</td><td class="tnum">${money(r.remaining)}</td></tr>`).join('')}
    <tr><td><b>All areas</b></td>${['seats'].map(k => `<td class="tnum"><b>${sum(so.byArea, r => r[k])}</b></td>`).join('')}<td></td>${['sold', 'available', 'blocked', 'comped'].map(k => `<td class="tnum"><b>${sum(so.byArea, r => r[k])}</b></td>`).join('')}${['potential', 'actual', 'remaining'].map(k => `<td class="tnum"><b>${money(sum(so.byArea, r => r[k]))}</b></td>`).join('')}</tr></tbody></table></div>
    <p class="small muted" style="padding:10px 20px 16px">Potential = every seat not blocked or unavailable at its price${so.shows > 1 ? `, × ${so.shows} showtimes` : ''}. Actual = what paid orders collected for those seats after discounts. Remaining = seats still available or held.</p></div>` : ''}` : ''}
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
      <div class="grid3">${inp('contact.name', 'Name')}${inp('contact.email', 'Email')}${inp('contact.phone', 'Phone')}</div>
      ${inp('contact.team', 'Customer-service team', { ph: 'e.g. Festival guest services', hint: '“Contact organizer” messages for this event go to this email / team (else the box office).' })}</div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Policies & instructions</div>
      ${inp('policies', 'Event-specific policies', { t: 'area', ph: 'e.g. No refunds within 7 days. Strollers not permitted.' })}
      ${inp('instructions', 'Attendee instructions', { t: 'area', ph: 'Parking, entrance, dress code, what to bring…' })}
      <p class="small muted" style="margin:6px 0 10px">This event's own terms / refund / privacy policy replace the box office's for its buyers. Buyers accept every policy at checkout and the version they accepted is kept on the order.</p>
      ${inp('terms', 'Terms & conditions (this event)', { t: 'area', ph: 'Blank = the box office terms' })}${inp('refundPolicy', 'Refund policy (this event)', { t: 'area', ph: 'Blank = the box office refund policy' })}${inp('privacyPolicy', 'Privacy policy (this event)', { t: 'area', ph: 'Blank = the box office privacy policy' })}</div>
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
// ── Seat inventory (Eli Step 3 §7–10): live counts, click a count to see its seats, bulk actions, per-seat history ──
const invLevel = st => { const l = levelsOf(st); return l.some(x => x.id === S.ui.iv?.level) ? S.ui.iv.level : l[0].id; };
const INV_KPIS = [['total', 'Total seats'], ['available', 'Available'], ['sold', 'Sold'], ['checkout', 'In checkout'], ['held', 'Held'], ['blocked', 'Blocked'], ['unavailable', 'Unavailable'], ['comp', 'Complimentary'], ['discount', 'Discount-code sales'], ['released', 'Cancelled / released']];
const SEAT_ACTION_LABEL = { sold: 'Sold', comp: 'Comp issued', cancelled: 'Cancelled', blocked: 'Blocked', unblock: 'Unblocked', held: 'Held', released: 'Released', unavailable: 'Unavailable', available: 'Available', moved: 'Moved', price: 'Price changed', area: 'Area changed' };
function invData(ev) {
  const slots = (ev.timeSlots || []).slice().sort((a, b) => D(a.start) - D(b.start)), iv = S.ui.iv ||= {};
  const slot = slots.length ? (slots.some(x => x.id === iv.slot) ? iv.slot : slots[0].id) : '';
  const states = seatStates(ev, { tickets: S.adm.tickets, statuses: S.adm.seatStatus, orders: S.adm.orders, slotId: slot });
  const released = new Set((S.adm.seatLog || []).filter(r => r.event_id === ev.id && r.action === 'cancelled' && [slot, ''].includes(r.slot_id || '')).map(r => r.seat).filter(id => states.get(id)?.state === 'available'));
  const match = (id, x, f) => !f || f === 'total' || (f === 'discount' ? (x.state === 'sold' && !!x.o?.data?.code) : f === 'released' ? released.has(id) : x.state === f);
  const counts = Object.fromEntries(INV_KPIS.map(([k]) => [k, [...states].filter(([id, x]) => match(id, x, k)).length]));
  return { slots, slot, states, released, counts, match };
}
function EdInventory(ev) {
  const saved = S.adm.events.find(e => e.id === ev.id);
  if (!saved?.seating?.enabled) return `<div class="card"><h3>No seating chart yet</h3><p class="muted small" style="margin-top:6px">Turn on reserved seating in the <a href="#/admin/event/${ev.id}/seating">Seating</a> tab and save, then manage individual seats here.</p></div>`;
  const d = invData(saved), iv = S.ui.iv, f = iv.filter || '', lv = invLevel(saved.seating), sel = new Set(S.ui.invSel || []), L = layoutOf(saved.seating);
  const selIds = [...sel].filter(id => d.states.has(id)), one = selIds.length === 1 ? d.states.get(selIds[0]) : null;
  const ok = k => can(k, ev.id), showList = f && f !== 'total' ? [...d.states].filter(([id, x]) => d.match(id, x, f)) : selIds.length > 1 ? selIds.map(id => [id, d.states.get(id)]) : [];
  const slotName = id => { const x = d.slots.find(z => z.id === id); return x ? fmtDT(x.start) : 'every showtime'; };
  return `${S.dirty ? '<div class="banner warn">You have unsaved changes in the editor. Save them before changing prices or seating areas here.</div>' : ''}
  <div class="card inv-head"><div class="between wrap">
    <div><h3>Live seat inventory</h3><p class="small muted" style="margin-top:2px">Exact counts right now${d.slots.length ? ' for one showtime' : ''}. Click a count to see exactly which seats it includes.</p></div>
    ${d.slots.length ? `<select class="inp inp-sm" data-input="iv.slot" data-rr="1">${d.slots.map(x => `<option value="${x.id}" ${x.id === d.slot ? 'selected' : ''}>${esc(fmtDT(x.start))}${x.label ? ' · ' + esc(x.label) : ''}</option>`).join('')}</select>` : ''}</div>
    <div class="inv-kpis">${INV_KPIS.map(([k, l]) => `<button type="button" class="inv-k ${f === k ? 'on' : ''}" data-action="invFilter" data-v="${k}"><i style="background:${k === 'available' || k === 'total' || k === 'discount' || k === 'released' ? 'var(--line-2)' : STATE_COLORS[k]};${k === 'blocked' ? 'box-shadow:inset 0 0 0 1.5px #555' : ''}"></i><span>${l}</span><b class="tnum">${d.counts[k]}</b></button>`).join('')}
      <div class="inv-k dark"><span>Remaining sellable</span><b class="tnum">${d.counts.available}</b></div></div></div>
  <div class="sm-wrap" style="margin-top:16px">
    <div class="card sm-main">
      ${LevelTabs(saved.seating, lv, 'invLevel')}
      <p class="small muted" style="margin:0 0 6px">${S.ui.invMove ? `<b style="color:var(--ink)">Moving ${esc(seatName(saved, S.ui.invMove))}</b> — click the new seat. <a href="#" data-action="invMoveCancel">Cancel</a>` : 'Click seats to select them, drag a box over empty space to select many, or click a row letter or section name to select it all. No limit on how many.'}</p>
      <div class="sm-canvas">${SeatCanvas(saved, { mode: 'inv', level: lv, states: d.states, filter: f === 'total' ? '' : f, seatSel: sel, released: d.released })}</div>
      <div class="legend">${Object.entries(SEAT_STATES).filter(([k]) => k !== 'available').map(([k, l]) => `<span><i style="background:${STATE_COLORS[k]};${k === 'blocked' ? 'box-shadow:inset 0 0 0 1.5px #555' : ''}"></i>${l}</span>`).join('')}<span><i style="background:${TIER_COLORS[0]}"></i>Available (price colour)</span></div>
    </div>
    <div class="card sm-panel">
      ${selIds.length ? `<div class="between"><b>${selIds.length} seat${selIds.length === 1 ? '' : 's'} selected</b><button type="button" class="btn btn-ghost btn-sm" data-action="invClear">Clear</button></div>
        ${d.slots.length ? `<div class="field" style="margin-top:10px"><label class="fl">Apply to</label><select class="inp inp-sm" data-input="iv.scope"><option value="">This showtime only</option><option value="all" ${iv.scope === 'all' ? 'selected' : ''}>Every showtime</option></select></div>` : ''}
        <div class="inv-acts">
          ${ok('seating.block') ? `<button type="button" class="btn btn-dark btn-sm" data-action="invDo" data-v="block">Block</button>` : ''}${ok('seating.unblock') ? `<button type="button" class="btn btn-ghost btn-sm" data-action="invDo" data-v="unblock">Unblock</button>` : ''}
          ${ok('seating.edit') ? `<button type="button" class="btn btn-ghost btn-sm" data-action="invDo" data-v="unavailable">Make unavailable</button><button type="button" class="btn btn-ghost btn-sm" data-action="invDo" data-v="available">Make available</button>` : ''}</div>
        ${ok('seating.block') || ok('seating.unblock') ? `<div class="field"><label class="fl">Hold for someone</label><div class="row">${ok('seating.block') ? `<input class="inp inp-sm" data-input="iv.note" placeholder="Note, e.g. Artist family" value="${esc(iv.note || '')}"><button type="button" class="btn btn-ghost btn-sm" data-action="invDo" data-v="hold">Hold</button>` : ''}${ok('seating.unblock') ? '<button type="button" class="btn btn-ghost btn-sm" data-action="invDo" data-v="release">Release</button>' : ''}</div></div>` : ''}
        ${ok('seating.edit') && ok('tickets.pricing') ? `<div class="field"><label class="fl">Change price</label><div class="row"><select class="inp inp-sm" data-input="iv.tt"><option value="">Section default</option>${saved.ticketTypes.map(t => `<option value="${t.id}" ${iv.tt === t.id ? 'selected' : ''}>${esc(t.name)} · ${money(t.price, saved.currency)}</option>`).join('')}</select><button type="button" class="btn btn-ghost btn-sm" data-action="invDo" data-v="price">Set</button></div></div>` : ''}
        ${ok('seating.edit') ? `<div class="field"><label class="fl">Change seating area</label><div class="row"><input class="inp inp-sm" data-input="iv.area" placeholder="e.g. Orchestra Left" value="${esc(iv.area || '')}"><button type="button" class="btn btn-ghost btn-sm" data-action="invDo" data-v="area">Set</button></div></div>` : ''}
        ${one && one.t && ok('seating.move') ? `<button type="button" class="btn btn-ghost btn-sm" data-action="invMove" data-v="${esc(selIds[0])}">Move this customer to another seat…</button>` : ''}
        <div class="sep"></div>` : `<p class="small muted">Select seats on the map to block, hold, release or re-price them — one seat, a row, a section or hundreds at once.</p>${f && f !== 'total' && d.counts[f] ? `<button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px" data-action="invSelAll">Select all ${d.counts[f]} ${esc(INV_KPIS.find(k => k[0] === f)[1].toLowerCase())}</button>` : ''}<div class="sep"></div>`}
      ${one ? SeatDetail(saved, selIds[0], one, d.slot) : ''}
    </div></div>
  ${showList.length ? `<div class="card" style="padding:0;margin-top:16px"><div class="between" style="padding:16px 20px 4px"><h3>${f && f !== 'total' ? esc(INV_KPIS.find(k => k[0] === f)[1]) : 'Selected seats'} · ${showList.length}</h3><button type="button" class="btn btn-ghost btn-sm" data-action="invExport">Export CSV</button></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Seat</th><th>Area</th><th>Row</th><th>Seat</th><th>Status</th><th>Customer / note</th><th>Order</th><th>By</th><th>When</th></tr></thead><tbody>
    ${showList.slice(0, 400).map(([id, x]) => { const sp = seatParts(saved, id, x.t); return `<tr class="click" data-action="invPick" data-v="${esc(id)}"><td class="tnum">${esc(id)}</td><td>${esc(sp.area)}</td><td>${esc(sp.row || '—')}</td><td>${esc(sp.seat || '—')}</td><td><span class="chip inv-${x.state}">${SEAT_STATES[x.state]}</span>${x.o?.data?.code ? ` <span class="chip">${esc(x.o.data.code)}</span>` : ''}</td>
      <td>${esc(x.t?.holder || x.s?.note || '')}${x.s?.status === 'checkout' ? ' <span class="small muted">until ' + esc(fmtTime(x.s.expires_at)) + '</span>' : ''}</td><td class="tnum">${esc(x.o?.ref || '')}</td><td class="small">${esc(x.s?.by || '')}</td><td class="small muted">${esc(x.s ? ago(x.s.at) : x.o ? ago(x.o.created_at) : '')}</td></tr>`; }).join('')}
    </tbody></table></div>${showList.length > 400 ? `<p class="small muted" style="padding:10px 20px">Showing 400 of ${showList.length} — export for the full list.</p>` : ''}</div>` : ''}`;
  function SeatDetail(ev, id, x, slot) {
    const log = (S.adm.seatLog || []).filter(r => r.event_id === ev.id && r.seat === id && [slot, ''].includes(r.slot_id || ''));
    const sp = seatParts(ev, id, x.t), tt = ev.ticketTypes.find(t => t.id === L.byId.get(id)?.tt);
    return `<div class="seat3 inv-seat"><div><div class="k">Area</div><div class="v">${esc(sp.area)}</div></div><div><div class="k">Row</div><div class="v">${esc(sp.row || '—')}</div></div><div><div class="k">Seat</div><div class="v">${esc(sp.seat || '—')}</div></div></div>
      <p class="small" style="margin:8px 0"><span class="chip inv-${x.state}">${SEAT_STATES[x.state]}</span> ${tt ? esc(tt.name) + ' · ' + money(tt.price, ev.currency) : 'no price'}${x.s ? ` · ${x.s.slot_id ? 'this showtime' : d.slots.length ? 'every showtime' : ''}${x.s.note ? ' · ' + esc(x.s.note) : ''}` : ''}</p>
      ${x.t ? `<p class="small" style="margin-bottom:8px"><b>${esc(x.t.holder)}</b> · ticket ${esc(x.t.code)}${x.o ? ` · <a href="#" data-action="openOrder" data-id="${x.o.id}">order ${esc(x.o.ref)}</a>` : ''}${x.o?.data?.code ? ' · code ' + esc(x.o.data.code) : ''}</p>` : ''}
      <div class="eyebrow" style="margin:12px 0 6px">Seat history</div>
      ${log.length ? `<div class="seat-log">${log.map(r => `<div><span class="chip">${esc(SEAT_ACTION_LABEL[r.action] || r.action)}</span><div><div class="small">${esc(r.detail)}${r.ref ? ' · ' + esc(r.ref) : ''}</div><div class="small muted">${esc(r.by)} · ${esc(fmtDT(r.at))}${r.slot_id && !slot ? '' : r.slot_id ? ' · ' + esc(slotName(r.slot_id)) : ''}</div></div></div>`).join('')}</div>` : '<p class="small muted">Nothing has happened to this seat yet.</p>'}`;
  }
}
// ── Venue library: master seating charts that events copy ──
function venueDraft(v) {
  return { id: 'venue-' + v.id, _venue: v.id, name: v.name, address: v.address || '', venue: v.name, currency: S.adm.bo.settings.currency,
    ticketTypes: (v.tiers || []).map(t => ({ ...t })), seating: { ...JSON.parse(JSON.stringify(v.chart || {})), enabled: true } };
}
function Venues() {
  if (S.route.params[0]) return VenueEditor();
  const list = S.adm.bo.venues || [], edit = can('seating.edit');
  return `${head('Venues', '', edit ? '<button class="btn btn-accent" data-action="newVenue">New venue chart</button>' : '')}
  <p class="muted" style="margin:-4px 0 18px;max-width:720px">Master seating charts for the venues you use. Attach one to an event from the event's Seating tab: the event gets its own copy, so changes for one event never change the master or future events.</p>
  ${list.length ? `<div class="ven-grid">${list.map(v => { const pe = venueDraft(v), L = layoutOf(pe.seating), used = S.adm.events.filter(e => e.seating?.venueId === v.id).length;
    return `<div class="card ven-card"><div class="ven-pv">${pe.seating.sections?.length ? SeatCanvas(pe, { preview: true }) : '<div class="muted small" style="padding:40px;text-align:center">Empty chart</div>'}</div>
      <h3>${esc(v.name)}</h3><p class="small muted">${esc(v.address || '')}</p>
      <p class="small" style="margin:8px 0">${L.seats.length} seats · ${(v.chart?.sections || []).length} sections${(v.chart?.levels || []).length > 1 ? ' · ' + v.chart.levels.length + ' levels' : ''} · used by ${used} event${used === 1 ? '' : 's'}</p>
      <div class="legend" style="margin:0 0 12px">${(v.tiers || []).map((t, i) => `<span><i style="background:${TIER_COLORS[i % TIER_COLORS.length]}"></i>${esc(t.name)} ${money(t.price)}</span>`).join('')}</div>
      <div class="row wrap">${edit ? `<a class="btn btn-dark btn-sm" href="#/admin/venues/${v.id}">Edit chart</a><button class="btn btn-ghost btn-sm" data-action="dupVenue" data-v="${v.id}">Duplicate</button><button class="btn btn-ghost btn-sm" data-action="delVenue" data-v="${v.id}">Delete</button>` : `<a class="btn btn-ghost btn-sm" href="#/admin/venues/${v.id}">View</a>`}</div></div>`; }).join('')}</div>`
    : `<div class="empty"><div class="display" style="font-size:28px">No venue charts yet</div><p class="muted" style="margin-top:8px">Create one here, or open any seated event and choose “Save to venue library”.</p></div>`}`;
}
function VenueEditor() {
  const ev = S.draft; if (!ev?._venue) return '<p class="muted">Venue chart not found. <a href="#/admin/venues">Back to venues</a></p>';
  const ro = !can('seating.edit');
  return `<a href="#/admin/venues" class="small muted" style="text-decoration:none">← Venues</a>
  ${head(esc(ev.name || 'Venue chart'), `<span class="chip">Master chart</span> ${S.dirty ? '<span class="chip warn">Unsaved changes</span>' : ''}`, ro ? '' : `<button class="btn btn-accent" data-action="saveVenue" ${S.dirty ? '' : 'disabled'}>Save chart</button>`)}
  <fieldset ${ro ? 'disabled' : ''} style="border:0">
  <div class="cols" style="margin-bottom:16px"><div class="card"><div class="grid2">${inp('name', 'Venue name')}${inp('address', 'Address')}</div>
    <p class="small muted">Saving updates this master chart only. Events that already use it keep their own copy.</p></div>
    <div class="card"><div class="between" style="margin-bottom:8px"><h3>Price tiers</h3><button type="button" class="btn btn-ghost btn-sm" data-action="addTier">${ic('plus', 13)} Tier</button></div>
      <p class="small muted" style="margin-bottom:10px">When the chart is attached to an event, each tier becomes (or matches by name) one of the event's ticket types.</p>
      ${ev.ticketTypes.map((t, i) => `<div class="row" style="margin-bottom:6px"><i class="tier-dot" style="background:${tierColor(ev, t.id)}"></i>${inp(`ticketTypes.${i}.name`, '', { cls: 'grow' })}${inp(`ticketTypes.${i}.price`, '', { t: 'money' })}<button type="button" class="btn btn-ghost btn-sm" data-action="delTier" data-i="${i}">Remove</button></div>`).join('')}</div></div>
  ${EdSeating(ev)}</fieldset>`;
}
function EdHistory(ev) {
  const list = (S.adm.audit || []).filter(a => a.target === ev.id);
  return `${VersionsCard(ev.id, 'restoreVersion')}<p class="muted" style="margin:16px 0">Every change to this event — dates, venue, capacity, status, visibility, ticket settings and prices, showtimes and seating, emergency controls — with who made it and the before/after values.</p>${AuditTable(list)}`;
}
// autosave (Stage 10): the event editor keeps unsaved edits on this device every few seconds
const AUTO_KEY = id => 'set_autosave_' + id;
function autosaved(id) { try { const a = JSON.parse(localStorage.getItem(AUTO_KEY(id)) || 'null'); return a && a.by === S.user?.email ? a : null; } catch (e) { return null; } }
let _autoT = 0;
function autosave() { clearTimeout(_autoT); _autoT = setTimeout(() => { if (S.dirty && S.draft?.id) try { localStorage.setItem(AUTO_KEY(S.draft.id), JSON.stringify({ at: new Date().toISOString(), by: S.user?.email, draft: { ...S.draft, seating: S.draft.seating ? { ...S.draft.seating, bg: undefined } : S.draft.seating } })); } catch (e) { } }, 1500); }

// ── Event editor ─────────────────────────────────────────────────────────────
const inp = (path, label, o = {}) => {
  const v = getPath(S.draft, path), t = o.t || 'text';
  const val = t === 'money' || t === 'moneyOpt' ? (v == null || v === '' ? '' : (+v / 100).toFixed(2).replace(/\.00$/, '')) : t === 'dt' ? toLocalInput(v) : (v ?? '');
  const type = t === 'money' || t === 'moneyOpt' || t === 'int' || t === 'num' ? 'number' : t === 'dt' ? 'datetime-local' : t;
  return `<div class="field ${o.cls || ''}">${label ? `<label class="fl">${label}</label>` : ''}${t === 'area'
    ? `<textarea class="inp" data-bind="draft.${path}" ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} ${o.ro ? 'readonly' : ''}>${esc(val)}</textarea>`
    : `<input class="inp" type="${type}" data-bind="draft.${path}" data-t="${t}" value="${esc(val)}" ${t === 'money' || t === 'moneyOpt' ? 'step="0.01" min="0"' : t === 'int' ? 'step="1" min="0"' : ''} ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} ${o.ro ? 'readonly' : ''}>`}${o.hint ? `<div class="small muted" style="margin-top:4px">${o.hint}</div>` : ''}</div>`;
};
const chk = (path, label) => `<label class="check"><input type="checkbox" data-bind="draft.${path}" data-t="bool" ${getPath(S.draft, path) ? 'checked' : ''}> <span>${label}</span></label>`;
const sel = (path, label, opts) => `<div class="field">${label ? `<label class="fl">${label}</label>` : ''}<select class="inp" data-bind="draft.${path}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(getPath(S.draft, path) ?? '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;

function soldSeatIds(ev) { return S.adm.tickets.filter(t => t.event_id === ev.id && t.status === 'valid' && t.seat).map(t => t.seat); }
const smMulti = () => new Set(S.ui.smMulti?.length ? S.ui.smMulti : S.ui.smSel ? [S.ui.smSel] : []);
const smLevel = st => { const l = levelsOf(st); return l.some(x => x.id === S.ui.smLevel) ? S.ui.smLevel : l[0].id; };
// The builder edits S.draft — an event, or a venue chart (draft._venue) with its price tiers as ticketTypes.
function EdSeating(ev) {
  const st = ev.seating || (ev.seating = { enabled: false }), venue = !!ev._venue;
  if (!st.enabled) return `<div class="card"><div class="sm-intro">${ic('ticket', 28)}<div><h3>Reserved seating</h3><p class="muted">Build your room — sections, rows, tables, booths and standing areas — then assign prices. Buyers pick their exact seats on a map.</p>
    <div style="margin-top:14px">${chk('seating.enabled', '<b>Turn on reserved seating for this event</b>')}</div>
    ${(S.adm.bo.venues || []).length ? `<p class="small muted" style="margin-top:12px">Or start from one of your venue charts:</p><div class="row wrap" style="margin-top:6px">${S.adm.bo.venues.map(v => `<button type="button" class="btn btn-ghost btn-sm" data-action="loadVenue" data-v="${v.id}">${esc(v.name)}</button>`).join('')}</div>` : ''}</div></div></div>`;
  st.sections ||= []; st.prices ||= {}; st.stage ||= { x: -150, y: -120, w: 300, h: 46, label: 'STAGE' };
  const L = layoutOf(st), mode = S.ui.smMode || 'move', sold = new Set(venue ? [] : soldSeatIds(ev)), lv = smLevel(st), multi = smMulti();
  const i = st.sections.findIndex(x => x.id === S.ui.smSel), sec = st.sections[i], seatSel = new Set(S.ui.smSeats || []);
  const counts = {}; L.seats.forEach(p => { counts[p.tt || ''] = (counts[p.tt || ''] || 0) + 1; });
  const hint = { move: 'Drag sections and the stage to arrange the room. Click a section to edit it; Shift-click to select several and move or edit them together.', paint: 'Pick a price, then click or drag across seats. Click a row letter to price the whole row.', seats: 'Click or drag across seats (or drag a box on empty space) to select them — then remove them, restore them, rename them or change their seating area. Click a row letter or section name to select it all.' }[mode];
  const ven = (S.adm.bo.venues || []).find(v => v.id === st.venueId);
  const panel = mode === 'seats' && seatSel.size ? SeatsPanel(ev, seatSel) : multi.size > 1 ? MultiPanel(ev, multi) : sec ? SectionPanel(ev, sec, i, sold) : RoomPanel(ev, L, lv);
  return `${venue ? '' : `<div class="card sm-venue"><div><b>${ven ? 'Venue chart: ' + esc(ven.name) : st.venueName ? 'Copied from venue chart “' + esc(st.venueName) + '”' : 'This event\'s own seating chart'}</b>
      <div class="small muted">${ven || st.venueName ? 'This is the event\'s own copy — changes here never touch the master chart or other events.' : 'Save it to your venue library to reuse it for future events.'}</div></div>
      <div class="row wrap">${(S.adm.bo.venues || []).length ? `<select class="inp inp-sm" data-input="venPick">${S.adm.bo.venues.map(v => `<option value="${v.id}" ${(S.ui.venPick || st.venueId) === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select><button type="button" class="btn btn-ghost btn-sm" data-action="loadVenue">Load chart</button>` : ''}
        ${can('seating.edit') ? '<button type="button" class="btn btn-ghost btn-sm" data-action="saveToVenue">Save to venue library</button>' : ''}<button type="button" class="btn btn-dark btn-sm" data-action="smPreview">Customer preview</button></div></div>`}
  <div class="sm-wrap">
    <div class="card sm-main">
      <div class="sm-toolbar">
        <div class="tabs">${[['move', 'Arrange'], ['paint', 'Assign prices'], ['seats', 'Edit seats']].map(([k, t]) => `<button type="button" class="${mode === k ? 'on' : ''}" data-action="smMode" data-v="${k}">${t}</button>`).join('')}</div>
        <div class="row wrap">${[['rows', 'Seated section'], ['table', 'Table'], ['booth', 'Booth'], ['ga', 'Standing area']].map(([k, t]) => `<button type="button" class="btn btn-ghost btn-sm" data-action="smAdd" data-v="${k}">${ic('plus', 14)} ${t}</button>`).join('')}</div>
      </div>
      ${levelsOf(st).length > 1 ? LevelTabs(st, lv, 'smLevel') : ''}
      ${mode === 'paint' ? `<div class="sm-palette">${ev.ticketTypes.map(t => `<button type="button" class="${(S.ui.smPaint ?? ev.ticketTypes[0]?.id) === t.id ? 'on' : ''}" data-action="smPaint" data-v="${t.id}"><i style="background:${tierColor(ev, t.id)}"></i>${esc(t.name)} · ${money(t.price, ev.currency)}</button>`).join('')}
        <button type="button" class="${S.ui.smPaint === '' ? 'on' : ''}" data-action="smPaint" data-v=""><i style="background:#fff;border:1.5px dashed #999"></i>Section default</button>
        ${venue ? '' : `<a class="small" href="#/admin/event/${ev.id}/tickets">Add a price level →</a>`}</div>` : ''}
      <p class="small muted" style="margin:8px 0 6px">${hint}</p>
      ${st.sections.length ? `<div class="sm-canvas">${SeatCanvas(ev, { mode, level: lv, selected: multi, sold, seatSel, ghosts: mode === 'seats' })}</div>` : `<div class="sm-empty"><h3>Start from a layout</h3><p class="muted small" style="margin:4px 0 16px">You can change everything afterwards.</p><div class="sm-tpls">
        ${[['theatre', 'Theatre', 'Centre + side stalls and a curved circle'], ['banquet', 'Banquet', '12 round tables of 10'], ['hall', 'Hall', 'One block of straight rows'], ['club', 'Club', 'Standing floor, booths and a balcony']].map(([k, t, d]) => `<button type="button" class="sm-tpl" data-action="smTemplate" data-v="${k}"><b>${t}</b><span>${d}</span></button>`).join('')}
        <button type="button" class="sm-tpl" data-action="smAdd" data-v="rows"><b>Blank</b><span>Add sections yourself</span></button></div></div>`}
      <div class="legend" style="margin-top:12px">${ev.ticketTypes.filter(t => counts[t.id]).map(t => `<span><i style="background:${tierColor(ev, t.id)}"></i>${esc(t.name)} ${money(t.price, ev.currency)} · <b>${counts[t.id]}</b> seats</span>`).join('')}
        ${counts[''] ? `<span style="color:var(--warn)"><i style="background:#c9c5ba"></i>${counts['']} seats have no price (not sold)</span>` : ''}${(st.removed || []).length ? `<span><i style="border:1.5px dashed #999"></i>${st.removed.length} removed</span>` : ''}${sold.size ? `<span><i style="background:#fff;box-shadow:0 0 0 2px var(--ink) inset"></i>${sold.size} sold</span>` : ''}</div>
    </div>
    <div class="card sm-panel">${panel}</div></div>`;
}
function RoomPanel(ev, L, lv) {
  const st = ev.seating, lvs = st.levels || [];
  return `<h3>Room</h3><p class="small muted" style="margin:4px 0 14px">${L.seats.length} seats in ${st.sections.length} section${st.sections.length === 1 ? '' : 's'}${lvs.length > 1 ? ` on ${lvs.length} levels` : ''}.</p>
    ${inp('seating.stage.label', 'Stage label')}<div class="grid2">${inp('seating.stage.w', 'Stage width', { t: 'int' })}${inp('seating.stage.h', 'Stage depth', { t: 'int' })}</div>
    <div class="sep"></div><div class="between" style="margin-bottom:8px"><div class="eyebrow">Floors / levels</div><button type="button" class="btn btn-ghost btn-sm" data-action="smAddLevel">${ic('plus', 13)} Level</button></div>
    ${lvs.length ? lvs.map((l, k) => `<div class="row" style="margin-bottom:6px"><input class="inp inp-sm" data-bind="draft.seating.levels.${k}.name" value="${esc(l.name)}"><button type="button" class="btn btn-ghost btn-sm" data-action="smDelLevel" data-i="${k}" ${lvs.length < 2 ? 'disabled' : ''}>Remove</button></div>`).join('') : '<p class="small muted">One level. Add a level for a balcony, mezzanine or second floor.</p>'}
    <div class="sep"></div><div class="eyebrow" style="margin-bottom:8px">Venue map image</div>
    ${st.bg?.src ? `<p class="small muted" style="margin-bottom:8px">Shown under the seats so you can build over it.</p>
      <div class="grid2">${inp('seating.bg.w', 'Width', { t: 'int' })}<div class="field"><label class="fl">Opacity</label><input type="range" class="range" min="0.05" max="1" step="0.05" data-bind="draft.seating.bg.opacity" data-t="num" value="${st.bg.opacity ?? .35}"></div></div>
      <div class="grid2">${inp('seating.bg.x', 'Left', { t: 'num' })}${inp('seating.bg.y', 'Top', { t: 'num' })}</div>
      ${chk('seating.bg.public', 'Show it to buyers too')}<button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px" data-action="smBgRemove">Remove image</button>`
      : `<p class="small muted" style="margin-bottom:8px">Upload a floor plan or venue photo and trace your sections over it.</p><input type="file" accept="image/*" class="inp" data-action-change="smBg">`}
    <div class="sep"></div><div class="eyebrow" style="margin-bottom:8px">Sections</div>
    ${st.sections.filter(x => (x.level || L.lv0) === lv).map(x => `<button type="button" class="sm-li" data-action="smSel" data-id="${x.id}"><i style="background:${tierColor(ev, x.ticketTypeId)}"></i><b>${esc(x.name)}</b><span>${esc(x.code)} · ${secKind(x) === 'ga' ? (+x.capacity || 100) + ' standing' : L.seats.filter(p => p.sec.id === x.id).length + ' seats'}</span></button>`).join('') || '<p class="small muted">No sections on this level yet.</p>'}
    ${ev._venue ? '' : `<div class="sep"></div>${chk('seating.noSingles', 'Don\'t let buyers leave a single empty seat')}<div style="margin-top:6px">${chk('seating.enabled', 'Reserved seating on')}</div>`}`;
}
function SectionPanel(ev, sec, i, sold) {
  const P = `seating.sections.${i}`, hasSold = [...sold].some(id => id.startsWith(sec.code + '-')), kind = secKind(sec), st = ev.seating;
  const overrides = Object.keys(st.prices || {}).filter(k => k.startsWith(sec.code + '-')).length, rows = Math.max(1, +sec.rows || 1);
  const lvs = st.levels || [], clip = S.ui.rowClip;
  return `<div class="between"><button type="button" class="small muted sm-backlink" data-action="smDeselect">← Room</button><div class="row"><button type="button" class="btn btn-ghost btn-sm" data-action="smDup">Duplicate</button><button type="button" class="btn btn-ghost btn-sm" data-action="smMirror">Mirror</button><button type="button" class="btn btn-danger btn-sm" data-action="smDel">Delete</button></div></div>
    <h3 style="margin:12px 0 12px">${esc(sec.name)} <span class="chip">${{ rows: 'Seated rows', table: 'Table', booth: 'Booth', ga: 'Standing area' }[kind]}</span></h3>
    <div class="grid2">${inp(`${P}.name`, 'Section name')}${inp(`${P}.code`, 'Code', { ro: hasSold, hint: hasSold ? 'Locked — seats sold' : 'Prefix on seat IDs' })}</div>
    <div class="grid2">${inp(`${P}.area`, 'Seating area', { ph: sec.name, hint: 'Printed on tickets. Blank = section name.' })}${lvs.length > 1 ? sel(`${P}.level`, 'Level', lvs.map(l => [l.id, l.name])) : '<div></div>'}</div>
    ${kind !== 'ga' ? `<div class="row wrap" style="gap:16px;margin:-4px 0 10px"><label class="check"><input type="checkbox" data-bind="draft.${P}.showName" data-t="bool" ${(sec.showName ?? (kind === 'table' || kind === 'booth')) ? 'checked' : ''}> <span>Print “${esc(sec.name || 'section name')}” on tickets <span class="muted">(table, box, couch, pod…)</span></span></label>
      ${kind === 'rows' ? chk(`${P}.hideRow`, 'No row on tickets <span class="muted">(boxes, couches)</span>') : ''}</div>` : ''}
    ${sel(`${P}.ticketTypeId`, 'Price for this section', [['', '— not for sale —'], ...ev.ticketTypes.map(t => [t.id, `${t.name} · ${money(t.price, ev.currency)}`])])}
    ${overrides ? `<div class="banner info" style="display:flex;justify-content:space-between;align-items:center">${overrides} seats have their own price<button type="button" class="btn btn-ghost btn-sm" data-action="smClearPrices">Reset</button></div>` : ''}
    ${kind === 'ga' ? `<div class="grid3">${inp(`${P}.capacity`, 'Capacity', { t: 'int', hint: 'Max ' + GA_MAX })}${inp(`${P}.w`, 'Width', { t: 'int' })}${inp(`${P}.h`, 'Depth', { t: 'int' })}</div>`
    : kind !== 'rows' ? `${inp(`${P}.seats`, kind === 'booth' ? 'Seats in booth' : 'Seats at table', { t: 'int' })}${spacing(P, sec, false)}` : `
      <div class="grid2">${inp(`${P}.rows`, 'Rows', { t: 'int' })}${inp(`${P}.seatsPerRow`, 'Seats per row', { t: 'int' })}</div>
      <div class="grid2">${inp(`${P}.rowStart`, 'First row', { hint: 'A, or 1 for numbers' })}${inp(`${P}.rowLabels`, 'Custom row labels', { ph: 'AA, BB, CC', hint: 'Comma-separated, front to back' })}</div>
      <div class="grid3">${inp(`${P}.seatStart`, 'First seat no.', { t: 'int', ph: '1' })}${sel(`${P}.numbering`, 'Numbering', [['seq', '1, 2, 3…'], ['odd', 'Odd only'], ['even', 'Even only']])}<div class="field"><label class="fl">Direction</label>${chk(`${P}.reverse`, 'Right to left')}</div></div>
      <div class="field"><label class="fl">Curve <span class="muted">${+sec.curve || 0}%</span></label><input type="range" min="0" max="100" step="5" data-bind="draft.${P}.curve" data-t="int" value="${+sec.curve || 0}" class="range"></div>
      ${spacing(P, sec, true)}
      <details class="sm-rows"${S.ui.rowsOpen ? ' open' : ''} data-action="rowsOpen"><summary>Rows — length, copy, paste, delete</summary><p class="small muted" style="margin:6px 0 8px">Seats in each row (blank = ${+sec.seatsPerRow || 10}).</p>
        <div class="sm-rowlist">${Array.from({ length: rows }, (_, r) => `<div class="sm-rowline"><span>${esc(secRowLabel(sec, r))}</span><input class="inp" type="number" min="1" data-bind="draft.${P}.rowSeats.${r}" data-t="int" value="${(sec.rowSeats || [])[r] || ''}" placeholder="${+sec.seatsPerRow || 10}">
          <button type="button" class="icon-btn" title="Duplicate row" data-action="rowDup" data-i="${r}" ${hasSold ? 'disabled' : ''}>⧉</button><button type="button" class="icon-btn" title="Copy row" data-action="rowCopy" data-i="${r}">⎘</button><button type="button" class="icon-btn" title="Delete row" data-action="rowDel" data-i="${r}" ${hasSold || rows < 2 ? 'disabled' : ''}>✕</button></div>`).join('')}</div>
        <div class="row wrap" style="margin-top:8px">${clip ? `<button type="button" class="btn btn-ghost btn-sm" data-action="rowPaste">Paste row (${clip} seats) at the back</button>` : ''}${sec.rowSeats?.some(Boolean) ? '<button type="button" class="btn btn-ghost btn-sm" data-action="smEqualRows">Make all rows equal</button>' : ''}</div></details>`}
    <div class="field" style="margin-top:12px"><label class="fl">Rotate <span class="muted">${+sec.rot || 0}°</span></label><input type="range" min="-180" max="180" step="1" data-bind="draft.${P}.rot" data-t="int" value="${+sec.rot || 0}" class="range"></div>
    <div class="row wrap">${kind === 'rows' ? '<button type="button" class="btn btn-ghost btn-sm" data-action="smStraighten">Straighten</button>' : ''}${kind !== 'ga' ? '<button type="button" class="btn btn-ghost btn-sm" data-action="smEven">Even spacing</button>' : ''}</div>`;
}
const spacing = (P, sec, rows) => `<div class="grid2"><div class="field"><label class="fl">Seat spacing <span class="muted">${+sec.gap || SEAT}</span></label><input type="range" min="18" max="50" step="1" data-bind="draft.${P}.gap" data-t="int" value="${+sec.gap || SEAT}" class="range"></div>
  ${rows ? `<div class="field"><label class="fl">Row spacing <span class="muted">${+sec.rowGap || ROWH}</span></label><input type="range" min="22" max="70" step="1" data-bind="draft.${P}.rowGap" data-t="int" value="${+sec.rowGap || ROWH}" class="range"></div>` : '<div></div>'}</div>`;
function MultiPanel(ev, multi) {
  const secs = ev.seating.sections.filter(x => multi.has(x.id)), lvs = ev.seating.levels || [];
  return `<div class="between"><button type="button" class="small muted sm-backlink" data-action="smDeselect">← Room</button><span class="chip">${secs.length} sections</span></div>
    <h3 style="margin:12px 0 4px">Edit ${secs.length} sections together</h3><p class="small muted" style="margin-bottom:12px">${esc(secs.map(x => x.name).join(', '))}. Drag any of them to move them all.</p>
    <div class="field"><label class="fl">Price</label><select class="inp" data-input="mpTT"><option value="">— keep —</option>${ev.ticketTypes.map(t => `<option value="${t.id}">${esc(t.name)} · ${money(t.price, ev.currency)}</option>`).join('')}<option value="none">— not for sale —</option></select></div>
    <div class="field"><label class="fl">Seating area</label><input class="inp" data-input="mpArea" placeholder="e.g. Orchestra Left — blank keeps each section's"></div>
    ${lvs.length > 1 ? `<div class="field"><label class="fl">Level</label><select class="inp" data-input="mpLevel"><option value="">— keep —</option>${lvs.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}</select></div>` : ''}
    <button type="button" class="btn btn-dark btn-sm" data-action="mpApply">Apply to all ${secs.length}</button>
    <div class="sep"></div><div class="row wrap"><button type="button" class="btn btn-ghost btn-sm" data-action="smStraighten">Straighten</button><button type="button" class="btn btn-ghost btn-sm" data-action="smEven">Even spacing</button><button type="button" class="btn btn-ghost btn-sm" data-action="smDup">Duplicate</button><button type="button" class="btn btn-ghost btn-sm" data-action="smMirror">Mirror</button><button type="button" class="btn btn-danger btn-sm" data-action="smDel">Delete</button></div>`;
}
function SeatsPanel(ev, seatSel) {
  const st = ev.seating, L = layoutOf(st), ids = [...seatSel], rm = new Set(st.removed || []), nRm = ids.filter(x => rm.has(x)).length, one = ids.length === 1 ? ids[0] : null, p = one && L.byId.get(one);
  return `<div class="between"><button type="button" class="small muted sm-backlink" data-action="smSeatsClear">← Clear selection</button><span class="chip">${ids.length} seat${ids.length === 1 ? '' : 's'}</span></div>
    <h3 style="margin:12px 0 4px">${one ? esc(p ? seatName(ev, one) : one + ' (removed)') : ids.length + ' seats selected'}</h3>
    <p class="small muted" style="margin-bottom:12px">${nRm ? nRm + ' removed · ' : ''}${ids.length - nRm} on the map</p>
    <div class="row wrap">${ids.length - nRm ? '<button type="button" class="btn btn-ghost btn-sm" data-action="seatsRemove">Remove from map</button>' : ''}${nRm ? '<button type="button" class="btn btn-ghost btn-sm" data-action="seatsRestore">Restore</button>' : ''}</div>
    <div class="sep"></div>
    <div class="field"><label class="fl">Seating area</label><div class="row"><input class="inp" data-input="spArea" placeholder="${esc(p?.area || 'e.g. Orchestra Left')}"><button type="button" class="btn btn-ghost btn-sm" data-action="seatsArea">Set</button></div><div class="small muted" style="margin-top:4px">Blank resets to the section's area.</div></div>
    <div class="field"><label class="fl">Price</label><div class="row"><select class="inp" data-input="spTT"><option value="">Section default</option>${ev.ticketTypes.map(t => `<option value="${t.id}">${esc(t.name)} · ${money(t.price, ev.currency)}</option>`).join('')}</select><button type="button" class="btn btn-ghost btn-sm" data-action="seatsPrice">Set</button></div></div>
    ${one && p && secKind(p.sec) !== 'ga' ? `<div class="field"><label class="fl">Seat label</label><div class="row"><input class="inp" data-input="spLabel" placeholder="${esc(String(p.num))}" value="${esc((st.labels || {})[one] || '')}"><button type="button" class="btn btn-ghost btn-sm" data-action="seatsLabel">Set</button></div><div class="small muted" style="margin-top:4px">What's printed as the seat number, e.g. 12A. The seat keeps its ID.</div></div>` : ''}`;
}
function nextCode(prefix) { const used = new Set(S.draft.seating.sections.map(x => x.code)); let n = 1; while (used.has(prefix + n)) n++; return prefix + n; }
function addSection(kind) {
  const st = S.draft.seating, lv = smLevel(st), L = layoutOf(st), b = st.sections.length ? boundsOf(L, lv, st.stage) : { y1: -40, x0: 0 }, tt = S.draft.ticketTypes[0]?.id || '';
  const base = { id: shortId('sec_'), x: kind === 'rows' ? -117 : 0, y: b.y1 + 70, rot: 0, ticketTypeId: tt, ...(st.levels?.length ? { level: lv } : {}) };
  const code = nextCode({ table: 'T', booth: 'B', ga: 'GA' }[kind] || 'S');
  const sec = kind === 'table' ? { ...base, code, name: 'Table ' + code.slice(1), kind, seats: 10 }
    : kind === 'booth' ? { ...base, code, name: 'Booth ' + code.slice(1), kind, seats: 6 }
    : kind === 'ga' ? { ...base, code, name: 'Standing floor', kind, capacity: 150, w: 260, h: 130, x: -130 }
    : { ...base, code, name: 'Section ' + (st.sections.length + 1), kind: 'rows', rows: 5, seatsPerRow: 10, rowStart: 'A', curve: 0 };
  st.sections.push(sec); S.ui.smSel = sec.id; S.ui.smMulti = [sec.id]; S.ui.smMode = 'move'; dirty(); render();
}
function applySeatTemplate(k) {
  const st = S.draft.seating, T = S.draft.ticketTypes, t = n => (T[n] || T[T.length - 1] || {}).id || '', id = () => shortId('sec_');
  st.prices = {}; st.areas = {}; st.removed = []; st.labels = {}; delete st.levels; st.stage = { x: -170, y: -120, w: 340, h: 46, label: 'STAGE' };
  if (k === 'theatre') st.sections = [
    { id: id(), code: 'LFT', name: 'Stalls left', kind: 'rows', x: -365, y: 18, rot: 9, rows: 8, seatsPerRow: 6, rowStart: 'A', ticketTypeId: t(1) },
    { id: id(), code: 'CEN', name: 'Stalls centre', kind: 'rows', x: -169, y: 0, rot: 0, rows: 8, seatsPerRow: 14, rowStart: 'A', curve: 25, ticketTypeId: t(0) },
    { id: id(), code: 'RGT', name: 'Stalls right', kind: 'rows', x: 235, y: 18, rot: -9, rows: 8, seatsPerRow: 6, rowStart: 'A', ticketTypeId: t(1) },
    { id: id(), code: 'CIR', name: 'Circle', kind: 'rows', x: -299, y: 320, rot: 0, rows: 3, seatsPerRow: 24, rowStart: 'J', curve: 40, ticketTypeId: t(2) }];
  if (k === 'banquet') { st.stage = { x: -200, y: -150, w: 400, h: 46, label: 'STAGE' }; st.sections = Array.from({ length: 12 }, (_, n) => ({ id: id(), code: 'T' + (n + 1), name: 'Table ' + (n + 1), kind: 'table', seats: 10, x: -330 + (n % 4) * 220, y: Math.floor(n / 4) * 200, rot: 0, ticketTypeId: n < 4 ? t(0) : t(1) })); }
  if (k === 'hall') st.sections = [{ id: id(), code: 'H', name: 'Hall', kind: 'rows', x: -247, y: 0, rot: 0, rows: 12, seatsPerRow: 20, rowStart: 'A', ticketTypeId: t(0) }];
  if (k === 'club') { st.levels = [{ id: 'L1', name: 'Main floor' }, { id: 'L2', name: 'Balcony' }]; st.sections = [
    { id: id(), code: 'GA', name: 'Standing floor', kind: 'ga', capacity: 300, w: 340, h: 170, x: -170, y: 0, rot: 0, level: 'L1', ticketTypeId: t(0) },
    ...[0, 1, 2].map(n => ({ id: id(), code: 'B' + (n + 1), name: 'Booth ' + (n + 1), kind: 'booth', seats: 6, x: -330, y: 10 + n * 85, rot: 90, level: 'L1', ticketTypeId: t(1) })),
    ...[0, 1, 2].map(n => ({ id: id(), code: 'B' + (n + 4), name: 'Booth ' + (n + 4), kind: 'booth', seats: 6, x: 280, y: 10 + n * 85, rot: -90, level: 'L1', ticketTypeId: t(1) })),
    { id: id(), code: 'BAL', name: 'Balcony', kind: 'rows', x: -260, y: 0, rot: 0, rows: 4, seatsPerRow: 20, rowStart: 'A', curve: 30, level: 'L2', ticketTypeId: t(2) }]; }
  S.ui.smSel = ''; S.ui.smMulti = []; dirty(); render();
}
// selection helpers shared by the builder ("Edit seats") and the inventory
function seatsInBox(L, lv, a, b, all) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return L.secs.filter(g => g.level === lv && g.kind !== 'ga').flatMap(g => (all ? g.all : g.local).filter(p => p.gx >= x0 && p.gx <= x1 && p.gy >= y0 && p.gy <= y1).map(p => p.id));
}
const rowIds = (L, secId, row, all) => L.secs.find(g => g.sec.id === secId)?.[all ? 'all' : 'local'].filter(p => p.row === row).map(p => p.id) || [];
const secIds = (L, secId, all) => L.secs.find(g => g.sec.id === secId)?.[all ? 'all' : 'local'].map(p => p.id) || [];
// Designer + inventory pointer interactions.
let SM = null;
function svgPt(svg, e) { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }
function smApply(el) {
  const st = S.draft.seating, id = el.dataset.seat;
  if (SM.kind === 'select') { const set = SM.set; SM.val ? set.add(id) : set.delete(id); el.classList.toggle('sel', SM.val); }
  else { const p = layoutOf(st).byId.get(id); if (!p) return; if (!SM.val || SM.val === p.sec.ticketTypeId) delete st.prices[id]; else st.prices[id] = SM.val; el.setAttribute('fill', tierColor(S.draft, SM.val || p.sec.ticketTypeId)); }
  SM.changed = true;
}
// which seat list a selection gesture edits: the builder's (S.ui.smSeats) or the inventory's (S.ui.invSel)
const selTarget = svg => svg.classList.contains('sm-inv') ? 'invSel' : 'smSeats';
document.addEventListener('pointerdown', e => {
  const svg = e.target.closest?.('svg.sm-design'); if (!svg || !S.draft) return;
  const inv = svg.classList.contains('sm-inv'), mode = inv ? 'select' : S.ui.smMode || 'move';
  const ev = inv ? S.adm.events.find(x => x.id === S.draft.id) : S.draft, st = ev.seating, L = layoutOf(st);
  if (mode === 'move') {
    const secEl = e.target.closest('[data-sec]'), stgEl = e.target.closest('[data-stage]');
    if (!secEl && !stgEl) { if (S.ui.smSel || S.ui.smMulti?.length) { S.ui.smSel = ''; S.ui.smMulti = []; render(); } return; }
    const p = svgPt(svg, e);
    if (stgEl) { SM = { kind: 'drag', svg, items: [{ el: stgEl, t: st.stage, ox: +st.stage.x || 0, oy: +st.stage.y || 0 }], sx: p.x, sy: p.y, moved: false, secId: '' }; e.preventDefault(); return; }
    const id = secEl.dataset.sec; let multi = smMulti();
    if (e.shiftKey) { multi.has(id) ? multi.delete(id) : multi.add(id); S.ui.smMulti = [...multi]; S.ui.smSel = multi.size === 1 ? [...multi][0] : ''; render(); return; }
    if (!multi.has(id)) multi = new Set([id]);
    const items = [...multi].map(sid => ({ el: svg.querySelector(`[data-sec="${sid}"]`), t: st.sections.find(x => x.id === sid) })).filter(x => x.el && x.t).map(x => ({ ...x, ox: +x.t.x || 0, oy: +x.t.y || 0 }));
    SM = { kind: 'drag', svg, items, sx: p.x, sy: p.y, moved: false, secId: id, multi: [...multi] }; e.preventDefault(); return;
  }
  if (inv && S.ui.invMove) { const seatEl = e.target.closest('[data-seat]'); if (seatEl) { A.invMoveTo(seatEl.dataset.seat); e.preventDefault(); } return; }
  const key = mode === 'paint' ? null : selTarget(svg), set = key ? new Set(S.ui[key] || []) : null, ghosts = !inv;
  const rowEl = e.target.closest('[data-row]'), nameEl = e.target.closest('[data-secname]'), gaEl = e.target.closest('[data-ga]');
  if (rowEl || nameEl || gaEl) {
    const ids = rowEl ? rowIds(L, ...rowEl.dataset.row.split('|'), ghosts && mode !== 'paint') : secIds(L, (nameEl || gaEl).dataset.secname || (nameEl || gaEl).dataset.ga, ghosts && mode !== 'paint');
    if (mode === 'paint') { SM = { kind: 'paint', val: S.ui.smPaint ?? S.draft.ticketTypes[0]?.id ?? '' }; ids.forEach(x => { const el = svg.querySelector(`[data-seat="${CSS.escape(x)}"]`); if (el) smApply(el); else { const p = L.byId.get(x); if (p) { if (!SM.val || SM.val === p.sec.ticketTypeId) delete st.prices[x]; else st.prices[x] = SM.val; } } }); SM = null; dirty(); render(); return; }
    const on = !ids.every(x => set.has(x)); ids.forEach(x => on ? set.add(x) : set.delete(x)); S.ui[key] = [...set]; render(); return;
  }
  const seatEl = e.target.closest('[data-seat]');
  if (!seatEl) { if (mode === 'paint') return; const p = svgPt(svg, e); SM = { kind: 'box', svg, key, set, a: p, L, lv: inv ? invLevel(st) : smLevel(st), all: !inv, add: e.shiftKey || e.metaKey }; e.preventDefault(); return; }
  if (mode === 'paint') SM = { kind: 'paint', svg, val: S.ui.smPaint ?? S.draft.ticketTypes[0]?.id ?? '' };
  else SM = { kind: 'select', svg, key, set, val: !set.has(seatEl.dataset.seat) };
  smApply(seatEl); e.preventDefault();
});
document.addEventListener('pointermove', e => {
  if (!SM) return;
  if (SM.kind === 'drag') {
    const p = svgPt(SM.svg, e), dx = p.x - SM.sx, dy = p.y - SM.sy;
    if (!SM.moved && Math.abs(dx) + Math.abs(dy) < 4) return; SM.moved = true;
    for (const it of SM.items) { it.t.x = Math.round((it.ox + dx) / 5) * 5; it.t.y = Math.round((it.oy + dy) / 5) * 5;
      it.el.setAttribute('transform', it.el.getAttribute('transform').replace(/translate\([^)]*\)/, `translate(${it.t.x} ${it.t.y})`)); }
    return;
  }
  if (SM.kind === 'box') {
    const p = svgPt(SM.svg, e); SM.b = p; let r = SM.svg.querySelector('.sm-box');
    if (!r) { r = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); r.setAttribute('class', 'sm-box'); SM.svg.appendChild(r); }
    r.setAttribute('x', Math.min(SM.a.x, p.x)); r.setAttribute('y', Math.min(SM.a.y, p.y)); r.setAttribute('width', Math.abs(p.x - SM.a.x)); r.setAttribute('height', Math.abs(p.y - SM.a.y));
    return;
  }
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-seat]');
  if (el && SM.svg.contains(el)) smApply(el);
});
document.addEventListener('pointerup', () => {
  if (!SM) return; const m = SM; SM = null;
  if (m.kind === 'drag') { if (m.moved) dirty(); else if (m.secId) { S.ui.smSel = m.secId; S.ui.smMulti = [m.secId]; } render(); }
  else if (m.kind === 'box') {
    if (m.b) { const ids = seatsInBox(m.L, m.lv, m.a, m.b, m.all), set = m.add ? m.set : new Set(); ids.forEach(x => set.add(x)); S.ui[m.key] = [...set]; }
    else if (!m.add) S.ui[m.key] = [];
    render();
  }
  else if (m.kind === 'select') { S.ui[m.key] = [...m.set]; render(); }
  else if (m.changed) { dirty(); render(); }
});
function EdCheckout(ev) {
  const pg = ev.page || {}, hidden = k => !!pg.hide?.[k];
  return `<div class="cols"><div class="stack">
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Event page</div>
      <p class="small muted" style="margin:-4px 0 12px">Flyer / image, description, instructions and policies are on the <a href="#/admin/event/${ev.id}/details">Details</a> tab. Turn any section off here.</p>
      <div class="sec-toggles">${PAGE_SECTIONS.map(([k, t]) => `<label class="check"><input type="checkbox" data-action="pgSection" data-v="${k}" ${hidden(k) ? '' : 'checked'}> <span>${t}</span></label>`).join('')}</div>
      ${inp('page.video', 'Video (YouTube or Vimeo link)', { ph: 'https://www.youtube.com/watch?v=…', hint: pg.video && !videoEmbed(pg.video) ? '<span style="color:var(--bad)">Only YouTube and Vimeo links can be embedded.</span>' : '' })}
      <div class="field"><label class="fl">Photo gallery (one https:// image link per line)</label><textarea class="inp" data-input="pgGallery" data-rr="0">${esc((pg.gallery || []).join('\n'))}</textarea></div>
      <div class="grid2"><div class="field"><label class="fl">Page accent colour</label><input class="inp" type="color" data-bind="draft.page.accent" value="${esc(pg.accent || S.adm.bo.branding.accent || '#f4cd5e')}"></div>
        <div class="field"><label class="fl">Page main colour</label><input class="inp" type="color" data-bind="draft.page.ink" value="${esc(pg.ink || S.adm.bo.branding.ink || '#020a16')}"></div></div>
      ${pg.accent || pg.ink ? '<button type="button" class="btn btn-ghost btn-sm" data-action="pgColorsReset">Use the box office colours</button>' : '<p class="small muted">Uses the box office colours until you pick different ones.</p>'}
    </div>
    <div class="card"><div class="between" style="margin-bottom:10px"><h3>Custom text blocks</h3><button type="button" class="btn btn-ghost btn-sm" data-action="pgAdd" data-v="blocks">${ic('plus', 14)} Add block</button></div>
      ${(pg.blocks || []).map((b, i) => `<div class="item-card">${inp(`page.blocks.${i}.title`, 'Heading')}${inp(`page.blocks.${i}.text`, 'Text', { t: 'area' })}<button type="button" class="btn btn-ghost btn-sm" data-action="pgDel" data-v="blocks" data-i="${i}">Remove</button></div>`).join('') || '<p class="small muted">Programme, line-up, FAQs, menus — anything you want on the page.</p>'}</div>
    <div class="card"><div class="between" style="margin-bottom:10px"><h3>Sponsors</h3><button type="button" class="btn btn-ghost btn-sm" data-action="pgAdd" data-v="sponsors">${ic('plus', 14)} Add sponsor</button></div>
      ${(pg.sponsors || []).map((x, i) => `<div class="item-card"><div class="grid3">${inp(`page.sponsors.${i}.name`, 'Name')}${inp(`page.sponsors.${i}.logo`, 'Logo URL', { ph: 'https://…' })}${inp(`page.sponsors.${i}.url`, 'Link', { ph: 'https://…' })}</div><button type="button" class="btn btn-ghost btn-sm" data-action="pgDel" data-v="sponsors" data-i="${i}">Remove</button></div>`).join('') || '<p class="small muted">No sponsors.</p>'}</div>
  </div><div class="stack">
    <div class="card">${inp('page.checkoutNote', 'Note shown at checkout for this event', { t: 'area', ph: 'e.g. Premium seats include a welcome drink.' })}</div>
    <div class="card">${QEditor('draft', 'questions', ev.questions || [], Q_SCOPES)}</div>
    <div class="card"><h3>Products & packages</h3><p class="small muted" style="margin-top:6px">Add-ons, packages and checkout offers have their own tab.</p><a class="btn btn-ghost btn-sm" style="margin-top:12px" href="#/admin/event/${ev.id}/products">Open Products & packages</a></div>
  </div></div>`;
}
// checkout questions editor for an event (draft.questions) or the whole box office (set.questions — asked once per order)
function QEditor(root, path, list, scopes) {
  const obj = root === 'draft' ? S.draft : S.ui.set, b = (i, k) => `data-bind="${root}.${path}.${i}.${k}"`;
  return `<div class="between" style="margin-bottom:10px"><h3>${root === 'draft' ? 'Checkout questions' : 'Questions on every order'}</h3><button type="button" class="btn btn-ghost btn-sm" data-action="addQ" data-v="${root}">${ic('plus', 14)} Add question</button></div>
    <p class="small muted" style="margin-bottom:12px">${root === 'draft' ? 'Asked once per event, or once for every ticket (e.g. each attendee\'s name). Answers are on orders, tickets and exports.' : 'Asked once per order, whatever is in the cart.'}</p>
    ${list.map((q, i) => `<div class="item-card"><div class="grid2"><div class="field"><label class="fl">Question</label><input class="inp" ${b(i, 'label')} value="${esc(q.label || '')}"></div>
      <div class="field"><label class="fl">Type</label><select class="inp" ${b(i, 'type')}>${Q_TYPES.map(([v, t]) => `<option value="${v}" ${(q.type || 'text') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
      ${q.type === 'select' ? `<div class="field"><label class="fl">Options (comma-separated)</label><input class="inp" ${b(i, 'options')} value="${esc(q.options || '')}"></div>` : ''}
      ${q.type === 'terms' || q.type === 'waiver' ? `<div class="field"><label class="fl">${q.type === 'waiver' ? 'Waiver text' : 'Terms text'}</label><textarea class="inp" ${b(i, 'text')}>${esc(q.text || '')}</textarea></div>` : ''}
      <div class="between wrap">${scopes.length ? `<select class="inp" style="max-width:240px" ${b(i, 'scope')}>${scopes.map(([v, t]) => `<option value="${v}" ${(q.scope || 'event') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>` : ''}
        <label class="check"><input type="checkbox" ${b(i, 'required')} data-t="bool" ${q.required ? 'checked' : ''}> <span>Required</span></label>
        <button type="button" class="btn btn-ghost btn-sm" data-action="delQ" data-v="${root}" data-i="${i}">Remove</button></div></div>`).join('') || '<p class="muted">No questions.</p>'}`;
}
// ── Ticket types, pricing rules, products, bundles, upsells (Stage 4) ───────
// tick boxes that add / remove a value in an array on the draft (targeting lists). [] = "any".
const tog = (path, v, label, num) => { const on = (getPath(S.draft, path) || []).map(String).includes(String(v));
  return `<label class="check small tog"><input type="checkbox" data-action="togList" data-path="${esc(path)}" data-v="${esc(v)}" ${num ? 'data-num="1"' : ''} ${on ? 'checked' : ''}> <span>${label}</span></label>`; };
const evAreas = ev => [...new Set(Object.values(ev.seating?.enabled ? ev.seating.meta || {} : {}).map(m => m[0]).filter(Boolean))].sort();
const PRODUCT_CATS = ['Park admission', 'Parking', 'Dinner', 'Food', 'Merchandise', 'Meet & greet', 'VIP upgrade', 'Transportation', 'Other'];
const TT_ACCESS = [['public', 'Everyone'], ['code', 'Only with an access code'], ['members', 'Members only (membership / pass holders)'], ['admin', 'Box office only (not sold online)']];
function EdTickets(ev) {
  const sold = evStats(ev), av = availabilityFrom(S.adm.tickets, ev.id), slots = ev.timeSlots || [];
  return `<div class="between" style="margin-bottom:14px"><p class="muted">${sold.sold} sold. Ticket types, prices, price rules, limits and sale windows. Free tickets are simply priced at $0.</p><button type="button" class="btn btn-dark btn-sm" data-action="addTT">${ic('plus', 14)} Add ticket type</button></div>
  ${ev.ticketTypes.map((t, i) => { const rules = (t.phases || []).length + (t.breaks || []).length + Object.values(t.slotPrices || {}).filter(v => v !== '' && v != null).length, P = `ticketTypes.${i}`;
    return `<div class="item-card"><div class="between" style="margin-bottom:10px"><div class="row wrap"><b>${esc(t.name || 'Ticket')}</b><span class="chip">${av.tt[t.id] || 0} sold</span>${t.adminOnly ? '<span class="chip warn">Box office only</span>' : t.hidden ? '<span class="chip info">Access code</span>' : ''}${t.group ? `<span class="chip">${esc(t.group)}</span>` : ''}${rules ? `<span class="chip ok">${rules} price rule${rules === 1 ? '' : 's'}</span>` : ''}</div>
    <div class="row"><button type="button" class="icon-btn" data-action="moveTT" data-i="${i}" data-d="-1" aria-label="Move up">↑</button><button type="button" class="icon-btn" data-action="delTT" data-i="${i}" aria-label="Remove">${ic('x', 14)}</button></div></div>
    <div class="grid3">${inp(`${P}.name`, 'Name')}${inp(`${P}.price`, 'Price', { t: 'money' })}${inp(`${P}.qty`, 'Inventory', { t: 'int', hint: '0 = unlimited' })}</div>
    <div class="grid3">${inp(`${P}.min`, 'Min per order', { t: 'int' })}${inp(`${P}.max`, 'Max per order', { t: 'int' })}${inp(`${P}.admits`, 'Admits (group ticket)', { t: 'int' })}</div>
    <div class="grid3">${inp(`${P}.group`, 'Ticket group', { ph: 'e.g. VIP, Family, Groups', hint: 'Buyers see types under this heading' })}
      <div class="field"><label class="fl">Who can buy</label><select class="inp" data-action-change="ttAccess" data-i="${i}">${TT_ACCESS.map(([v, l]) => `<option value="${v}" ${(t.adminOnly ? 'admin' : t.hidden ? 'code' : t.memberOnly ? 'members' : 'public') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${t.hidden && !t.adminOnly ? inp(`secrets.ticketPasswords.${t.id}`, 'Access code', { hint: 'Buyers unlock this type with the code' }) : inp(`${P}.desc`, 'Description')}</div>
    ${t.hidden && !t.adminOnly ? inp(`${P}.desc`, 'Description') : ''}
    ${t.memberOnly ? `<div class="targets"><div class="fl">Which memberships unlock it <span class="muted">(none = any)</span></div>${(S.adm.bo.settings.passPlans || []).map(pl => tog(`${P}.memberPlans`, pl.id, esc(pl.name))).join('') || '<span class="small muted">Add membership plans in Settings first.</span>'}</div>` : ''}
    <div class="grid2">${inp(`${P}.salesStart`, 'On sale from', { t: 'dt' })}${inp(`${P}.salesEnd`, 'Off sale at', { t: 'dt' })}</div>
    <details class="rules" ${rules || S.ui.rulesOpen === t.id ? 'open' : ''}><summary>Pricing rules — early bird, scheduled changes, price after N sold, group prices${slots.length ? ', showtime prices' : ''}</summary>
      <div class="small muted" style="margin:8px 0">Price phases run top to bottom: the first one that's in its dates and under its sold limit sets the price; after the last, the base price applies.</div>
      ${(t.phases || []).map((ph, k) => `<div class="rule-row">${inp(`${P}.phases.${k}.label`, k ? '' : 'Phase', { ph: 'Early bird' })}${inp(`${P}.phases.${k}.price`, k ? '' : 'Price', { t: 'money' })}${inp(`${P}.phases.${k}.from`, k ? '' : 'From', { t: 'dt' })}${inp(`${P}.phases.${k}.until`, k ? '' : 'Until', { t: 'dt' })}${inp(`${P}.phases.${k}.upTo`, k ? '' : 'Until N sold', { t: 'int', ph: '0 = no limit' })}${inp(`${P}.phases.${k}.hoursBefore`, k ? '' : 'Last N hours only', { t: 'int', ph: 'last-minute' })}<button type="button" class="icon-btn" data-action="delRule" data-path="${P}.phases" data-i="${k}" aria-label="Remove">${ic('x', 13)}</button></div>`).join('')}
      <button type="button" class="btn btn-ghost btn-sm" data-action="addRule" data-path="${P}.phases" data-id="${t.id}">${ic('plus', 13)} Price phase</button>
      <div class="sep" style="margin:12px 0"></div>
      ${(t.breaks || []).map((b, k) => `<div class="rule-row two">${inp(`${P}.breaks.${k}.min`, k ? '' : 'Buy at least', { t: 'int' })}${inp(`${P}.breaks.${k}.price`, k ? '' : 'Price each', { t: 'money' })}<button type="button" class="icon-btn" data-action="delRule" data-path="${P}.breaks" data-i="${k}" aria-label="Remove">${ic('x', 13)}</button></div>`).join('')}
      <button type="button" class="btn btn-ghost btn-sm" data-action="addRule" data-path="${P}.breaks" data-id="${t.id}">${ic('plus', 13)} Group / quantity price</button>
      <div class="sep" style="margin:12px 0"></div><div class="small muted" style="margin-bottom:6px">Peak / off-peak — a different price for showtimes on these days and times (${esc(ev.timezone || 'event time')})</div>
      ${(t.peak || []).map((r, k) => `<div class="rule-box"><div class="rule-row">${inp(`${P}.peak.${k}.label`, k ? '' : 'Label', { ph: 'Weekend evening' })}${inp(`${P}.peak.${k}.price`, k ? '' : 'Price', { t: 'money' })}${inp(`${P}.peak.${k}.from`, k ? '' : 'From', { t: 'time' })}${inp(`${P}.peak.${k}.to`, k ? '' : 'To', { t: 'time' })}<div></div><button type="button" class="icon-btn" data-action="delRule" data-path="${P}.peak" data-i="${k}" aria-label="Remove">${ic('x', 13)}</button></div>
        <div class="targets">${WEEKDAYS.map((d, n) => tog(`${P}.peak.${k}.days`, n, d, true)).join('')}<span class="small muted">none = every day</span></div></div>`).join('')}
      <button type="button" class="btn btn-ghost btn-sm" data-action="addRule" data-path="${P}.peak" data-id="${t.id}">${ic('plus', 13)} Peak / off-peak price</button>
      ${slots.length ? `<div class="sep" style="margin:12px 0"></div><div class="small muted" style="margin-bottom:6px">Showtime prices (blank = base price)</div><div class="grid3">${slots.map(s => inp(`${P}.slotPrices.${s.id}`, esc(fmtDT(s.start)), { t: 'moneyOpt' })).join('')}</div>` : ''}
    </details>
  </div>`; }).join('')}
  ${RulesEditor(ev)}`;
}
function EdProducts(ev) {
  const av = availabilityFrom(S.adm.tickets, ev.id, [], '', S.adm.orders), areas = evAreas(ev), ads = ev.addons || [], bds = ev.bundles || [], ups = ev.upsells || [];
  const prices = [...new Set(ev.ticketTypes.map(t => +t.price).filter(Boolean))].sort((a, b) => b - a);
  const adName = id => ads.find(a => a.id === id)?.name || '?';
  const worth = b => sum(bundlePositions(b), p => +ev.ticketTypes.find(t => t.id === p[0])?.price || 0) + sum(b.addons || [], x => (+x.qty || 1) * (+ads.find(a => a.id === x.addonId)?.price || 0));
  return `<div class="between" style="margin-bottom:12px"><div><h3>Products & add-ons</h3><p class="small muted">Sold right in the ticket panel — parking, dinner, merch, park admission, meet & greet, upgrades.</p></div><button type="button" class="btn btn-dark btn-sm" data-action="addAddon">${ic('plus', 14)} Add product</button></div>
  ${ads.map((a, i) => { const P = `addons.${i}`; return `<div class="item-card"><div class="between" style="margin-bottom:10px"><div class="row wrap"><b>${esc(a.name)}</b><span class="chip">${av.ad[a.id] || 0}${+a.qty ? ' / ' + a.qty : ''} sold</span>${a.standalone ? '<span class="chip info">Standalone</span>' : ''}${a.hidden ? '<span class="chip">Hidden</span>' : ''}</div><button type="button" class="icon-btn" data-action="delAddon" data-i="${i}" aria-label="Remove">${ic('x', 14)}</button></div>
    <div class="grid3">${inp(`${P}.name`, 'Product')}${inp(`${P}.price`, 'Price', { t: 'money' })}${sel(`${P}.category`, 'Category', PRODUCT_CATS.map(c => [c, c]))}</div>
    <div class="grid3">${inp(`${P}.qty`, 'Inventory', { t: 'int', hint: '0 = unlimited' })}${inp(`${P}.max`, 'Max per order', { t: 'int', hint: '0 = no limit' })}${inp(`${P}.desc`, 'Description')}</div>
    <div class="grid2">${inp(`${P}.salesStart`, 'On sale from', { t: 'dt' })}${inp(`${P}.salesEnd`, 'Off sale at', { t: 'dt' })}</div>
    <div class="row wrap">${chk(`${P}.standalone`, 'Can be bought on its own, without a ticket')}${chk(`${P}.hidden`, 'Hidden — only inside packages and offers')}${chk(`${P}.redeemable`, 'Own QR code — scanned and redeemed at the event (parking, drinks, merch pickup…)')}</div>
    <div class="targets"><div class="fl">Only with these ticket types <span class="muted">(none = any)</span></div>${ev.ticketTypes.map(t => tog(`${P}.ticketTypeIds`, t.id, esc(t.name))).join('')}</div>
    ${areas.length ? `<div class="targets"><div class="fl">Only with seats in <span class="muted">(none = any)</span></div>${areas.map(x => tog(`${P}.areas`, x, esc(x))).join('')}</div>` : ''}
  </div>`; }).join('') || '<div class="card empty">No products yet.</div>'}

  <div class="between" style="margin:26px 0 12px"><div><h3>Packages (bundles)</h3><p class="small muted">One combined price for tickets + products, with its own inventory. Each ticket in a package still counts against its ticket type.</p></div><button type="button" class="btn btn-dark btn-sm" data-action="addBundle">${ic('plus', 14)} Add package</button></div>
  ${bds.map((b, i) => { const P = `bundles.${i}`, w = worth(b); return `<div class="item-card"><div class="between" style="margin-bottom:10px"><div class="row wrap"><b>${esc(b.name)}</b><span class="chip">${av.bd[b.id] || 0}${+b.qty ? ' / ' + b.qty : ''} sold</span>${w > +b.price ? `<span class="chip ok">saves ${money(w - b.price)} vs ${money(w)}</span>` : ''}</div><button type="button" class="icon-btn" data-action="delBundle" data-i="${i}" aria-label="Remove">${ic('x', 14)}</button></div>
    <div class="grid3">${inp(`${P}.name`, 'Package')}${inp(`${P}.price`, 'Package price', { t: 'money' })}${inp(`${P}.qty`, 'Inventory', { t: 'int', hint: '0 = unlimited' })}</div>
    <div class="grid3">${inp(`${P}.max`, 'Max per order', { t: 'int' })}${inp(`${P}.salesStart`, 'On sale from', { t: 'dt' })}${inp(`${P}.salesEnd`, 'Off sale at', { t: 'dt' })}</div>
    ${inp(`${P}.desc`, 'Description', { ph: bundleSummary(ev, b) })}
    <div class="fl" style="margin-top:6px">Tickets in the package</div>
    ${(b.parts || []).map((p, k) => `<div class="part"><div style="width:90px">${inp(`${P}.parts.${k}.qty`, '', { t: 'int' })}</div><div class="targets" style="flex:1;margin:0"><span class="small muted">× any of</span> ${ev.ticketTypes.map(t => tog(`${P}.parts.${k}.ticketTypeIds`, t.id, esc(t.name))).join('')}</div><button type="button" class="icon-btn" data-action="delRule" data-path="${P}.parts" data-i="${k}" aria-label="Remove">${ic('x', 13)}</button></div>`).join('')}
    <button type="button" class="btn btn-ghost btn-sm" data-action="addRule" data-path="${P}.parts">${ic('plus', 13)} Tickets</button>
    <div class="fl" style="margin-top:12px">Products in the package</div>
    ${(b.addons || []).map((x, k) => `<div class="part"><div style="width:90px">${inp(`${P}.addons.${k}.qty`, '', { t: 'int' })}</div><div style="flex:1">${sel(`${P}.addons.${k}.addonId`, '', ads.map(a => [a.id, a.name]))}</div><button type="button" class="icon-btn" data-action="delRule" data-path="${P}.addons" data-i="${k}" aria-label="Remove">${ic('x', 13)}</button></div>`).join('')}
    ${ads.length ? `<button type="button" class="btn btn-ghost btn-sm" data-action="addRule" data-path="${P}.addons">${ic('plus', 13)} Product</button>` : '<p class="small muted">Add a product above to include it.</p>'}
    <div style="margin-top:10px">${chk(`${P}.hidden`, 'Hidden from buyers')}</div>
  </div>`; }).join('') || '<div class="card empty">No packages yet.</div>'}

  <div class="between" style="margin:26px 0 12px"><div><h3>Checkout offers (upsells)</h3><p class="small muted">Offer a product at checkout when the cart matches — e.g. VIP → dinner, Orchestra → parking.</p></div><button type="button" class="btn btn-dark btn-sm" data-action="addUpsellRule" ${ads.length ? '' : 'disabled'}>${ic('plus', 14)} Add offer</button></div>
  ${ups.map((u, i) => { const P = `upsells.${i}`; return `<div class="item-card"><div class="between" style="margin-bottom:10px"><b>Offer ${esc(adName(u.addonId))}</b><button type="button" class="icon-btn" data-action="delUpsellRule" data-i="${i}" aria-label="Remove">${ic('x', 14)}</button></div>
    <div class="grid2">${sel(`${P}.addonId`, 'Product', ads.map(a => [a.id, `${a.name} — ${money(a.price)}`]))}${inp(`${P}.text`, 'Headline', { ph: 'Make a night of it — add dinner' })}</div>
    <div class="grid2">${inp(`${P}.minQty`, 'When buying at least', { t: 'int', hint: 'tickets' })}<div class="field"><label class="fl">Quantity offered</label>${chk(`${P}.perTicket`, 'One per matching ticket')}</div></div>
    <div class="targets"><div class="fl">When the cart has <span class="muted">(none = any)</span></div>${ev.ticketTypes.map(t => tog(`${P}.ticketTypeIds`, t.id, esc(t.name))).join('')}</div>
    ${areas.length ? `<div class="targets"><div class="fl">…seats in</div>${areas.map(x => tog(`${P}.areas`, x, esc(x))).join('')}</div>` : ''}
    ${prices.length > 1 ? `<div class="targets"><div class="fl">…price level</div>${prices.map(p => tog(`${P}.prices`, p, money(p), true)).join('')}</div>` : ''}
  </div>`; }).join('') || `<div class="card empty">${ads.length ? 'No offers yet.' : 'Add a product first.'}</div>`}
  <p class="small muted" style="margin-top:10px">Products, packages and offers are saved with the event.</p>`;
}
// codes that touch this event (codes themselves live box-office wide on the Promotions page)
function EdDiscounts(ev) {
  const list = (S.adm.promos || []).filter(p => !(p.eventIds || []).length || p.eventIds.includes(ev.id));
  return `<div class="between" style="margin-bottom:14px"><p class="muted">Promo codes that apply to this event. Codes are managed for the whole box office on <a href="#/admin/promos">Promotions</a>, where each one can target events, showtimes, ticket types, seating areas, price levels, products and packages.</p>
    ${can('tickets.discounts') ? `<button type="button" class="btn btn-dark btn-sm" data-action="newPromo" data-ev="${ev.id}">${ic('plus', 14)} New code for this event</button>` : ''}</div>
  ${PromoTable(list)}`;
}

// ── Promotions: promo codes + tracking codes, with their reports ───────────
const PROMO_TYPES = [['pct', 'Percent off'], ['fixed', 'Amount off each item'], ['order', 'Amount off the order']];
const promoLabel = p => `${p.type === 'pct' ? (+p.amount === 100 ? '100% off' : `${+p.amount}% off`) : p.type === 'fixed' ? money(p.amount) + ' off each' : money(p.amount) + ' off order'}${p.on === 'fee' ? ' booking fee' : p.on === 'both' ? ' price + fee' : ''}`;
function promoState(p, st) {
  const now = new Date();
  if (p.active === false) return '<span class="chip">Off</span>';
  if (p.startsAt && D(p.startsAt) > now) return '<span class="chip info">Scheduled</span>';
  if (p.expires && D(p.expires) <= now) return '<span class="chip">Expired</span>';
  if (+p.maxUses && st.orders >= +p.maxUses) return '<span class="chip warn">Used up</span>';
  return '<span class="chip ok">Active</span>';
}
function promoStats(p) {
  const os = S.adm.orders.filter(o => o.data.promo?.id === p.id && ['paid', 'pending'].includes(o.status)), ids = new Set(os.map(o => o.id));
  const tks = S.adm.tickets.filter(t => ids.has(t.order_id) && t.status === 'valid'), where = {}, cust = {};
  for (const t of tks.filter(t => t.discount > 0)) { const ev = evById(t.event_id), k = `${ev?.name || 'Event'} · ${t.area || ev?.ticketTypes.find(x => x.id === t.ticket_type_id)?.name || ''}`; const w = where[k] ||= { tickets: 0, discount: 0 }; w.tickets++; w.discount += t.discount; }
  for (const o of os) { const c = cust[o.buyer_email] ||= { name: o.data.buyer.name, email: o.buyer_email, orders: 0, discount: 0 }; c.orders++; c.discount += (o.data.discount || 0) + (o.data.feeDiscount || 0); }
  return { orders: os.length, uses: sum(os, o => sum(o.data.lines, l => (l.discs || []).filter((d, i) => d > 0 || (l.feeDiscs || [])[i] > 0).length)), tickets: tks.length, discountedTickets: tks.filter(t => t.discount > 0).length,
    original: sum(os, o => o.data.faceValue ?? o.data.subtotal), discounted: sum(os, o => (o.data.discount || 0) + (o.data.feeDiscount || 0)), revenue: sum(os.filter(o => o.status === 'paid'), o => o.data.total),
    customers: Object.values(cust).sort((a, b) => b.orders - a.orders), where: Object.entries(where).sort((a, b) => b[1].tickets - a[1].tickets),
    usedCodes: new Set(os.map(o => String(o.data.code).toUpperCase())).size };
}
function PromoTable(list) {
  if (!list.length) return '<div class="card empty">No codes yet.</div>';
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Discount</th><th>Applies to</th><th>Status</th><th>Uses</th><th>Orders</th><th>Tickets</th><th>Discounted</th><th>Revenue</th></tr></thead><tbody>
    ${list.map(p => { const s = promoStats(p); return `<tr class="click" data-action="go" data-v="#/admin/promos/code/${p.id}"><td><b class="tnum" style="letter-spacing:.05em">${esc(p.code)}</b>${(p.codes || []).length ? `<div class="small muted">+ ${p.codes.length} unique codes</div>` : ''}${p.note ? `<div class="small muted">${esc(p.note)}</div>` : ''}</td>
      <td>${esc(promoLabel(p))}</td><td class="small">${esc(promoTargets(p))}</td><td>${promoState(p, s)}</td><td class="tnum">${s.uses}</td><td class="tnum">${s.orders}${+p.maxUses ? ' / ' + p.maxUses : ''}</td><td class="tnum">${s.tickets}</td><td class="tnum">${money(s.discounted)}</td><td class="tnum">${money(s.revenue)}</td></tr>`; }).join('')}</tbody></table></div>`;
}
function promoTargets(p) {
  const evs = (p.eventIds || []).map(id => evById(id)?.name).filter(Boolean), tts = (p.ticketTypeIds || []).map(id => S.adm.events.flatMap(e => e.ticketTypes).find(t => t.id === id)?.name).filter(Boolean);
  const scope = p.scope?.length ? p.scope : ['tickets', 'bundles'];
  return [evs.length ? evs.join(', ') : 'All events', (p.slotIds || []).length ? p.slotIds.length + ' showtime(s)' : '', tts.join(', '), (p.areas || []).join(', '),
    (p.prices || []).length ? p.prices.map(x => money(x)).join(' / ') + ' seats' : '', scope.length === 3 ? 'tickets, packages & add-ons' : scope.map(x => ({ tickets: 'tickets', bundles: 'packages', addons: 'add-ons' })[x]).join(' & '),
    +p.maxTickets ? `max ${p.maxTickets} tickets/order` : ''].filter(Boolean).join(' · ');
}
function trackStats(t) {
  const os = S.adm.orders.filter(o => o.data.tracking === t.code && ['paid', 'pending'].includes(o.status)), ids = new Set(os.map(o => o.id));
  const evs = S.adm.events.filter(e => !(t.eventIds || []).length || t.eventIds.includes(e.id));
  const views = sum(evs, e => S.adm.views?.[e.id]?.byRef?.[t.code]?.views || 0), unique = sum(evs, e => S.adm.views?.[e.id]?.byRef?.[t.code]?.unique || 0);
  const byEv = evs.map(e => ({ e, views: S.adm.views?.[e.id]?.byRef?.[t.code]?.views || 0, orders: os.filter(o => o.event_ids.includes(e.id)).length, tickets: S.adm.tickets.filter(x => ids.has(x.order_id) && x.event_id === e.id && x.status === 'valid').length,
    revenue: sum(os.filter(o => o.status === 'paid'), o => sum(o.data.lines.filter(l => l.eventId === e.id), l => l.unit * l.qty - (l.disc || 0))) })).filter(r => r.views || r.orders);
  return { views, unique, orders: os.length, uses: os.length, tickets: S.adm.tickets.filter(x => ids.has(x.order_id) && x.status === 'valid').length,
    revenue: sum(os.filter(o => o.status === 'paid'), o => o.data.total), conv: unique ? os.length / unique : 0, byEv };
}
const trackUrl = (t, ev) => location.origin + location.pathname + (ev ? '#/e/' + ev.slug : '#/b/' + S.adm.bo.slug) + '?ref=' + encodeURIComponent(t.code);
function Promos() {
  const r = S.route.params;
  if (r[0] === 'code' && S.draft?._kind === 'promo') return PromoEditor(S.draft);
  if (r[0] === 'ref' && S.draft?._kind === 'tracking') return TrackingEditor(S.draft);
  const tab = r[0] === 'tracking' ? 'tracking' : 'codes', canP = can('tickets.discounts'), canT = can('tickets.tracking');
  return head('Promotions', 'Promo codes and tracking codes for every event in this box office',
    tab === 'codes' ? (canP ? `<button class="btn btn-accent" data-action="newPromo">${ic('plus', 14)} New promo code</button>` : '') : (canT ? `<button class="btn btn-accent" data-action="newTracking">${ic('plus', 14)} New tracking code</button>` : ''))
  + `<nav class="etabs"><a class="${tab === 'codes' ? 'on' : ''}" href="#/admin/promos">Promo codes</a><a class="${tab === 'tracking' ? 'on' : ''}" href="#/admin/promos/tracking">Tracking codes</a></nav>`
  + (tab === 'codes' ? `${(() => { const all = S.adm.promos || [], st = all.map(promoStats); return `<div class="kpis"><div class="kpi dark"><div class="eyebrow">Discounted</div><div class="v">${money(sum(st, s => s.discounted))}</div><div class="d" style="color:var(--mut)">across ${sum(st, s => s.orders)} orders</div></div>
      <div class="kpi"><div class="eyebrow">Revenue with codes</div><div class="v">${money(sum(st, s => s.revenue))}</div></div><div class="kpi"><div class="eyebrow">Tickets sold with codes</div><div class="v">${sum(st, s => s.tickets)}</div></div><div class="kpi"><div class="eyebrow">Codes</div><div class="v">${all.length}</div></div></div>`; })()}
      ${PromoTable(S.adm.promos || [])}`
    : `<p class="muted" style="margin-bottom:14px">Give promoters, partners, affiliates, sponsors and campaigns their own link (<code>?ref=CODE</code>) or code. Tracking codes don't give a discount — they credit sales.</p>
      ${(S.adm.tracking || []).length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Assigned to</th><th>Events</th><th>Status</th><th>Link views</th><th>Orders</th><th>Tickets</th><th>Revenue</th><th>Conversion</th></tr></thead><tbody>
      ${S.adm.tracking.map(t => { const s = trackStats(t), off = t.active === false || (t.expires && D(t.expires) <= new Date()) || (+t.maxUses && s.uses >= +t.maxUses);
        return `<tr class="click" data-action="go" data-v="#/admin/promos/ref/${t.id}"><td><b class="tnum">${esc(t.code)}</b></td><td>${esc(t.name)}<div class="small muted">${esc(t.kind || '')}</div></td><td class="small">${(t.eventIds || []).length ? esc(t.eventIds.map(id => evById(id)?.name).filter(Boolean).join(', ')) : 'All events'}</td>
          <td>${off ? '<span class="chip">Off</span>' : '<span class="chip ok">Active</span>'}</td><td class="tnum">${s.views}</td><td class="tnum">${s.orders}${+t.maxUses ? ' / ' + t.maxUses : ''}</td><td class="tnum">${s.tickets}</td><td class="tnum">${money(s.revenue)}</td><td class="tnum">${s.unique ? (s.conv * 100).toFixed(1) + '%' : '—'}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="card empty">No tracking codes yet.</div>'}`);
}
function PromoEditor(p) {
  const evs = S.adm.events.slice().sort((a, b) => D(b.start) - D(a.start)), on = (p.eventIds || []).length ? evs.filter(e => p.eventIds.includes(e.id)) : evs;
  const saved = (S.adm.promos || []).find(x => x.id === p.id), ro = !can(saved ? 'tickets.discountsEdit' : 'tickets.discounts'), scope = p.scope?.length ? p.scope : ['tickets', 'bundles'];
  const areas = [...new Set(on.flatMap(evAreas))].sort(), prices = [...new Set(on.flatMap(e => e.ticketTypes.map(t => +t.price)).filter(Boolean))].sort((a, b) => b - a);
  const s = saved ? promoStats(saved) : null;
  return `<a href="#/admin/promos" class="small muted" style="text-decoration:none">← Promotions</a>
  ${head(saved ? esc(saved.code) : 'New promo code', saved ? `${promoState(saved, s)} <span class="muted small">${esc(promoLabel(saved))}</span>` : '',
    `${saved && can('tickets.discountsEdit') ? '<button class="btn btn-ghost" data-action="delPromo">Delete</button>' : ''}${ro ? '' : `<button class="btn btn-accent" data-action="savePromo" ${S.dirty || !saved ? '' : 'disabled'}>Save code</button>`}`)}
  <div class="promo-grid"><fieldset ${ro ? 'disabled' : ''} style="border:0;min-width:0">
    <div class="card stack"><div class="grid3">${inp('code', 'Code', { ph: 'BINAH15' })}${inp('note', 'Internal note', { ph: 'Who it is for' })}<div class="field"><label class="fl">Status</label>${chk('active', 'Active')}</div></div>
      <div class="grid3">${sel('type', 'Discount', PROMO_TYPES)}${p.type === 'pct' ? inp('amount', 'Percent', { t: 'num', hint: '100 = free' }) : inp('amount', 'Amount', { t: 'money' })}${sel('on', 'Takes the discount off', [['tickets', 'Ticket price'], ['fee', 'Booking fee'], ['both', 'Price and booking fee']])}</div>
      <div class="targets"><div class="fl">Discounts</div>${tog('scope', 'tickets', 'Tickets')}${tog('scope', 'bundles', 'Packages')}${tog('scope', 'addons', 'Products / add-ons')}</div></div>
    <div class="card stack" style="margin-top:14px"><h3>Valid for <span class="small muted" style="font-weight:400">— nothing ticked = all</span></h3>
      <div class="targets"><div class="fl">Events</div>${evs.map(e => tog('eventIds', e.id, esc(e.name))).join('')}</div>
      ${on.some(e => (e.timeSlots || []).length) ? `<div class="targets"><div class="fl">Showtimes</div>${on.flatMap(e => (e.timeSlots || []).map(sl => tog('slotIds', sl.id, `${esc(e.name)} · ${esc(fmtDT(sl.start))}`))).join('')}</div>` : ''}
      ${scope.includes('tickets') ? `<div class="targets"><div class="fl">Ticket types</div>${on.flatMap(e => e.ticketTypes.map(t => tog('ticketTypeIds', t.id, `${on.length > 1 ? esc(e.name) + ' · ' : ''}${esc(t.name)}`))).join('')}</div>
      ${areas.length ? `<div class="targets"><div class="fl">Seating areas</div>${areas.map(a => tog('areas', a, esc(a))).join('')}</div>` : ''}
      ${prices.length ? `<div class="targets"><div class="fl">Price levels</div>${prices.map(x => tog('prices', x, money(x), true)).join('')}</div>` : ''}` : ''}
      ${scope.includes('addons') ? `<div class="targets"><div class="fl">Products</div>${on.flatMap(e => (e.addons || []).map(a => tog('addonIds', a.id, `${on.length > 1 ? esc(e.name) + ' · ' : ''}${esc(a.name)}`))).join('') || '<span class="small muted">These events have no products.</span>'}</div>` : ''}
      ${scope.includes('bundles') ? `<div class="targets"><div class="fl">Packages</div>${on.flatMap(e => (e.bundles || []).map(b => tog('bundleIds', b.id, `${on.length > 1 ? esc(e.name) + ' · ' : ''}${esc(b.name)}`))).join('') || '<span class="small muted">These events have no packages.</span>'}</div>` : ''}</div>
    <div class="card stack" style="margin-top:14px"><h3>Rules</h3>
      <div class="grid2">${inp('startsAt', 'Starts', { t: 'dt' })}${inp('expires', 'Expires', { t: 'dt' })}</div>
      <div class="grid3">${inp('maxUses', 'Max total uses (orders)', { t: 'int', hint: '0 = unlimited · 1 = one-time code' })}${inp('perCustomer', 'Max uses per customer', { t: 'int' })}${inp('maxItems', 'Max discounted items per order', { t: 'int' })}</div>
      <div class="grid3">${inp('maxTickets', 'Max discounted tickets per order', { t: 'int' })}${inp('minSpend', 'Minimum purchase', { t: 'money' })}${inp('minQty', 'Minimum tickets in order', { t: 'int' })}</div>
      <div class="grid3">${inp('maxQty', 'Maximum tickets in order', { t: 'int', hint: '0 = no limit' })}</div></div>
    <div class="card stack" style="margin-top:14px"><h3>Bulk unique codes</h3><p class="small muted">Each unique code works once, on top of the rules above — for guest lists, press or partner allocations.</p>
      <div class="row wrap"><input class="inp" style="max-width:110px" type="number" min="1" max="5000" data-input="genN" value="${esc(S.ui.genN || 25)}" aria-label="How many"><input class="inp" style="max-width:180px" data-input="genPre" value="${esc(S.ui.genPre ?? p.code ?? '')}" placeholder="Prefix" aria-label="Prefix"><button type="button" class="btn btn-ghost" data-action="genCodes">Generate</button>
        ${(p.codes || []).length ? `<button type="button" class="btn btn-ghost" data-action="exportCodes">Download ${p.codes.length} codes</button><button type="button" class="btn btn-ghost" data-action="clearCodes">Clear unused</button>` : ''}</div>
      ${(p.codes || []).length ? `<div class="small muted">${p.codes.length} unique codes · ${s ? s.usedCodes : 0} used · e.g. ${esc(p.codes.slice(0, 3).join(', '))}</div>` : ''}</div>
  </fieldset>
  <div>${s ? PromoReport(s) : '<div class="card"><h3>Report</h3><p class="small muted">Uses, orders, tickets, discount given and revenue appear here once the code is saved and used.</p></div>'}</div></div>`;
}
function PromoReport(s) {
  return `<div class="card"><h3>Report</h3><div class="kv-grid">${[['Uses', s.uses], ['Orders', s.orders], ['Tickets sold', s.tickets], ['Tickets discounted', s.discountedTickets], ['Original value', money(s.original)], ['Discounted', money(s.discounted)], ['Revenue collected', money(s.revenue)], ['Customers', s.customers.length]]
    .map(([k, v]) => `<div><div class="eyebrow">${k}</div><div class="v tnum">${v}</div></div>`).join('')}</div>
    ${s.where.length ? `<div class="fl" style="margin-top:14px">Where it was used</div>${s.where.slice(0, 12).map(([k, w]) => `<div class="between small line"><span>${esc(k)}</span><span class="tnum">${w.tickets} · −${money(w.discount)}</span></div>`).join('')}` : ''}
    ${s.customers.length ? `<div class="fl" style="margin-top:14px">Customers</div>${s.customers.slice(0, 15).map(c => `<div class="between small line"><span>${esc(c.name)} <span class="muted">${esc(c.email)}</span></span><span class="tnum">${c.orders} · −${money(c.discount)}</span></div>`).join('')}${s.customers.length > 15 ? `<div class="small muted">+ ${s.customers.length - 15} more</div>` : ''}` : ''}</div>`;
}
function TrackingEditor(t) {
  const evs = S.adm.events.slice().sort((a, b) => D(b.start) - D(a.start)), saved = (S.adm.tracking || []).find(x => x.id === t.id), ro = !can('tickets.tracking'), s = saved ? trackStats(saved) : null;
  const targets = (t.eventIds || []).length ? evs.filter(e => t.eventIds.includes(e.id)) : [];
  return `<a href="#/admin/promos/tracking" class="small muted" style="text-decoration:none">← Tracking codes</a>
  ${head(saved ? esc(saved.code) : 'New tracking code', saved ? esc(saved.name) : '', `${saved && !ro ? '<button class="btn btn-ghost" data-action="delTracking">Delete</button>' : ''}${ro ? '' : `<button class="btn btn-accent" data-action="saveTracking" ${S.dirty || !saved ? '' : 'disabled'}>Save code</button>`}`)}
  <div class="promo-grid"><fieldset ${ro ? 'disabled' : ''} style="border:0;min-width:0">
    <div class="card stack"><div class="grid3">${inp('code', 'Code', { ph: 'ALEX' })}${inp('name', 'Person or campaign')}${sel('kind', 'Type', ['Promoter', 'Partner', 'Affiliate', 'Sponsor', 'Campaign'].map(x => [x, x]))}</div>
      <div class="grid3">${inp('startsAt', 'Starts', { t: 'dt' })}${inp('expires', 'Expires', { t: 'dt' })}${inp('maxUses', 'Usage limit (orders)', { t: 'int', hint: '0 = unlimited' })}</div>
      ${chk('active', 'Active')}
      <div class="targets"><div class="fl">Events <span class="muted">(none = all)</span></div>${evs.map(e => tog('eventIds', e.id, esc(e.name))).join('')}</div></div>
    ${saved ? `<div class="card stack" style="margin-top:14px"><h3>Links to share</h3>${(targets.length ? targets : [null]).map(e => `<div class="row"><input class="inp" readonly value="${esc(trackUrl(saved, e))}"><button type="button" class="btn btn-ghost" data-action="copyLink" data-v="${esc(trackUrl(saved, e))}">Copy</button></div>`).join('')}
      <p class="small muted">Buyers can also type <b>${esc(saved.code)}</b> in the code box at checkout.</p></div>` : ''}
  </fieldset>
  <div>${s ? `<div class="card"><h3>Report</h3><div class="kv-grid">${[['Link views', s.views], ['Unique visitors', s.unique], ['Orders', s.orders], ['Tickets sold', s.tickets], ['Revenue', money(s.revenue)], ['Conversion', s.unique ? (s.conv * 100).toFixed(1) + '%' : '—'], ['Code uses', s.uses]]
      .map(([k, v]) => `<div><div class="eyebrow">${k}</div><div class="v tnum">${v}</div></div>`).join('')}</div>
      ${s.byEv.length ? `<div class="fl" style="margin-top:14px">By event</div>${s.byEv.map(r => `<div class="between small line"><span>${esc(r.e.name)}</span><span class="tnum">${r.views} views · ${r.orders} orders · ${money(r.revenue)}</span></div>`).join('')}` : ''}</div>` : ''}</div></div>`;
}
const newPromo = evId => ({ _kind: 'promo', id: shortId('pr_'), code: '', active: true, note: '', type: 'pct', amount: 10, on: 'tickets', scope: ['tickets', 'bundles'], eventIds: evId ? [evId] : [], slotIds: [], ticketTypeIds: [], areas: [], prices: [],
  addonIds: [], bundleIds: [], startsAt: '', expires: '', maxUses: 0, perCustomer: 0, maxItems: 0, maxTickets: 0, minSpend: 0, minQty: 0, maxQty: 0, codes: [] });
function EdEmails(ev) {
  const holders = new Set(S.adm.tickets.filter(t => t.event_id === ev.id && t.status === 'valid').map(t => S.adm.orders.find(o => o.id === t.order_id)?.buyer_email).filter(Boolean));
  const b = S.ui.bc?.ev === ev.id ? S.ui.bc : (S.ui.bc = { ev: ev.id, subject: '', body: '', channel: 'email', sendAt: '' }), past = (S.adm.broadcasts || []).filter(x => x.event_id === ev.id);
  const sms = can('comms.sms'), auto = (S.adm.automations || []).filter(a => a.enabled && TIMED_TRIGGERS.includes(a.trigger.type)).map(a => a.name), rems = ev.emails?.reminders || [];
  return `<div class="cols"><div class="stack">
    <div class="card"><div class="between"><h3>Order confirmation</h3><button type="button" class="btn btn-ghost btn-sm" data-action="confPreview">Preview</button></div><p class="small muted" style="margin-bottom:10px">This event's own confirmation email. Blank fields use the standard wording.</p>
      ${inp('emails.confirm.subject', 'Subject', { ph: 'Your tickets — {{event}}' })}${inp('emails.confirm.header', 'Header', { ph: 'See you there!' })}
      ${inp('emails.confirmation', 'Custom message', { t: 'area', ph: 'e.g. Parking is on 38th St. Please arrive 20 minutes early.' })}
      ${inp('emails.confirm.instructions', 'Ticket instructions', { t: 'area', ph: 'Show the QR code at the door…' })}${inp('emails.confirm.venue', 'Venue instructions', { t: 'area' })}
      ${inp('emails.confirm.sponsor', 'Sponsor message', { ph: 'Presented with…' })}${inp('emails.confirm.contact', 'Contact information', { ph: 'Questions? Reply to this email.' })}
      ${chk('emails.confirm.policies', 'Include this event\'s policies')}
      <p class="small muted" style="margin-top:6px">Sent from ${S.adm.bo.mailDomain?.status === 'verified' ? `your own domain <b>${esc(S.adm.bo.mailDomain.domain)}</b>` : 'the platform\'s domain under your box office\'s name (verify a sending domain in Settings to use your own)'}.</p></div>
    <div class="card"><h3>Message ticket holders</h3><p class="small muted" style="margin-bottom:12px">Venue changes, door times, last-minute news — to all ${holders.size} buyers with valid tickets. Goes to everyone with a ticket, opted in or not, so keep it to event information.</p>
      ${sms ? `<div class="field"><select class="inp" data-bind="ui.bc.channel">${[['email', 'Email'], ['sms', 'Text message'], ['both', 'Email + text']].map(([k, l]) => `<option value="${k}" ${b.channel === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
      ${b.channel !== 'sms' ? `<div class="field"><input class="inp" data-bind="ui.bc.subject" placeholder="Subject" value="${esc(b.subject)}"></div>` : ''}<div class="field"><textarea class="inp" data-bind="ui.bc.body" placeholder="Message — {{first_name}}, {{event}}, {{date}}, {{tickets_link}} work here">${esc(b.body)}</textarea></div>
      <div class="field"><label class="fl">Send at (optional)</label><input class="inp" type="datetime-local" data-bind="ui.bc.sendAt" value="${esc(b.sendAt)}"></div>
      <button type="button" class="btn btn-dark" data-action="broadcast">${b.sendAt ? 'Schedule' : 'Send'} to ${holders.size} ticket holders</button>
      ${past.map(x => `<div class="small muted" style="margin-top:10px">“${esc(x.name || x.subject)}” · ${esc(x.channel === 'both' ? 'email + text' : x.channel || 'email')} · ${x.queued ?? x.recipients} sent${x.status === 'scheduled' ? ' · scheduled ' + esc(fmtDT(x.send_at)) : ' · ' + esc(ago(x.send_at || x.created_at))}</div>`).join('')}</div>
    <div class="card"><div class="between"><h3>Automatic reminders</h3><button type="button" class="btn btn-ghost btn-sm" data-action="addRem">${ic('plus', 14)} Add</button></div>
      <p class="small muted" style="margin-top:4px">${rems.length ? 'This event uses its own reminders instead of the standard pre-event reminder.' : `None set here — the box office's workflows apply${auto.length ? ': ' + esc(auto.join(', ')) : ''}.`}</p>
      ${rems.map((r, i) => `<div class="item-card" style="margin-top:10px"><div class="grid2">${inp(`emails.reminders.${i}.hoursBefore`, 'Hours before start', { t: 'int' })}${sel(`emails.reminders.${i}.channel`, 'Send as', [['email', 'Email'], ['sms', 'Text message'], ['both', 'Email + text']])}</div>${inp(`emails.reminders.${i}.body`, 'Message', { t: 'area' })}<button type="button" class="btn btn-ghost btn-sm" data-action="delRem" data-i="${i}">Remove</button></div>`).join('')}</div>
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
    <div class="card"><h3>Widgets for your website</h3><p class="small muted" style="margin:4px 0 10px">Load <code>embed.js</code> once, then use any of these — checkout stays on your site.</p>
      <pre class="code">&lt;script src="${esc(location.origin + location.pathname.replace(/index\.html$/, ''))}embed.js" async&gt;&lt;/script&gt;
&lt;a href="${esc(url)}" data-set-tickets="${esc(ev.slug)}"&gt;Buy tickets&lt;/a&gt;
&lt;div data-set-widget="tickets" data-event="${esc(ev.slug)}"&gt;&lt;/div&gt;
&lt;div data-set-widget="event" data-event="${esc(ev.slug)}"&gt;&lt;/div&gt;</pre></div>
    <div class="card"><h3>Tracking links</h3><p class="small muted" style="margin:4px 0 10px">Tag links per channel — Reports shows sales by source.</p>
      ${['instagram', 'whatsapp', 'newsletter', 'poster'].map(s => `<div class="row" style="margin-bottom:6px"><span class="chip" style="width:96px;justify-content:center">${s}</span><input class="inp" readonly value="${esc(shareUrl(ev.slug, s))}"></div>`).join('')}</div>
  </div><div class="card" style="text-align:center"><h3>Event QR code</h3><p class="small muted" style="margin-bottom:16px">For posters and flyers.</p><div class="qr" style="display:inline-block" data-qr="${esc(shareUrl(ev.slug, 'poster'))}"></div>
    <div style="margin-top:14px"><button type="button" class="btn btn-ghost btn-sm" data-action="print">Print</button></div></div></div>`;
}

// ── Orders ───────────────────────────────────────────────────────────────────
// ── Orders (Stage 6): search, the full order page, ticket / seat changes, cancellations, refunds, credits, communication ──
// Order search: every word must match somewhere — name, email, phone, order #, transaction id, ticket code, event, ticket type / area, row,
// seat, promo, tracking or credit code. Field words narrow it: row:F seat:12 area:balcony type:premium ticket:7KQ2M9XHPA code:BINAH15
const OSEARCH = { row: t => t.row, seat: t => t.seat_label || t.seat, area: t => t.area, ticket: t => t.code, type: t => evById(t.event_id)?.ticketTypes.find(x => x.id === t.ticket_type_id)?.name };
function filteredOrders() {
  const words = S.ui.q.trim().toLowerCase().split(/\s+/).filter(Boolean), by = {};
  if (words.length) S.adm.tickets.forEach(t => (by[t.order_id] ||= []).push(t));
  return S.adm.orders.filter(o => {
    if ((S.ui.ev && !o.event_ids.includes(S.ui.ev)) || (S.ui.status && (S.ui.status === 'flagged' ? !(o.data.flags || []).length || o.data.review : o.status !== S.ui.status))) return false;
    if (!words.length) return true;
    const d = o.data, tks = by[o.id] || [];
    const hay = [o.ref, d.buyer.name, o.buyer_email, d.buyer.phone, String(d.buyer.phone || '').replace(/\D/g, ''), o.payment?.ref, d.code, d.tracking, d.credit?.code, ...(d.refunds || []).map(r => [r.credit, r.ref].join(' ')),
      ...(d.charges || []).map(c => c.ref), ...d.lines.map(l => l.eventName + ' ' + l.name),
      ...tks.flatMap(t => [t.code, t.holder, t.area, t.row && 'row ' + t.row, t.seat_label, t.seat, OSEARCH.type(t), t.promo, t.tracking])].filter(Boolean).join(' · ').toLowerCase();
    const field = words.map(w => w.match(/^(row|seat|area|ticket|type):(.+)$/)).filter(Boolean);   // ticket fields: all on the SAME ticket (row:F seat:12)
    return words.every(w => {
      const m = w.match(/^(row|seat|area|ticket|type|code):(.+)$/); if (!m) return hay.includes(w);
      return m[1] !== 'code' || [d.code, d.tracking, d.credit?.code].some(x => String(x || '').toLowerCase() === m[2]);
    }) && (!field.length || tks.some(t => field.every(m => { const v = String(OSEARCH[m[1]](t) || '').toLowerCase(); return ['area', 'type'].includes(m[1]) ? v.includes(m[2]) : v === m[2]; })));
  }).sort((a, b) => D(b.created_at) - D(a.created_at));
}
const evOptions = (cur, all = 'All events') => `<option value="">${all}</option>${S.adm.events.slice().sort((a, b) => D(b.start) - D(a.start)).map(e => `<option value="${e.id}" ${cur === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}`;
function Orders() {
  if (S.route.params[0] === 'new') return ManualOrder();
  if (S.route.params[0]) return OrderView(S.route.params[0]);
  const os = filteredOrders(), picked = Object.keys(S.ui.picked).filter(k => S.ui.picked[k]);
  return head('Orders', `${os.length} orders · ${money(sum(os.filter(o => ['paid', 'pending'].includes(o.status)), o => orderMoney(o).net || (o.status === 'pending' ? o.data.total : 0)))}`,
    `${can('customers.export') ? '<button class="btn btn-ghost" data-action="exportOrders">Export CSV</button>' : ''}${can('orders.edit') ? `<button class="btn btn-accent" data-action="manualOrder">${ic('plus', 15)} Manual order</button>` : ''}`) + `
  <div class="toolbar"><input class="inp" style="min-width:320px;flex:1" data-input="q" placeholder="Search name, email, phone, order #, ticket code, seat, row, promo or referral code…" value="${esc(S.ui.q)}">
    <select class="inp" data-input="ev">${evOptions(S.ui.ev)}</select>
    <select class="inp" data-input="status"><option value="">Any status</option>${Object.entries(ORDER_STATUS).map(([k, t]) => `<option value="${k}" ${S.ui.status === k ? 'selected' : ''}>${t}</option>`).join('')}<option value="flagged" ${S.ui.status === 'flagged' ? 'selected' : ''}>Flagged for review (${S.adm.orders.filter(o => (o.data.flags || []).length && !o.data.review).length})</option></select>
    ${picked.length && can('orders.refund') ? `<button class="btn btn-danger btn-sm" data-action="bulkCancel">Cancel & refund ${picked.length} selected</button>` : ''}</div>
  <p class="small muted" style="margin:-6px 0 12px">Narrow by ticket: <code>row:F</code> <code>seat:12</code> <code>area:balcony</code> <code>type:premium</code> <code>ticket:CODE</code> <code>code:BINAH15</code> — or paste a payment / transaction id.</p>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:30px"></th><th>Order</th><th>Buyer</th><th>Event</th><th>Tickets</th><th>Total</th><th>Status</th><th>Placed</th></tr></thead><tbody>
  ${os.slice(0, 300).map(o => { const m = orderMoney(o); return `<tr class="click" data-action="openOrder" data-id="${o.id}"><td data-stop="1"><input type="checkbox" data-action="pick" data-id="${o.id}" ${S.ui.picked[o.id] ? 'checked' : ''}></td>
    <td class="tnum"><b>${esc(o.ref)}</b></td><td>${esc(o.data.buyer.name)}<div class="small muted">${esc(o.buyer_email)}</div></td>
    <td>${esc([...new Set(o.data.lines.map(l => l.eventName).filter(Boolean))].join(', '))}</td><td class="tnum">${S.adm.tickets.filter(t => t.order_id === o.id && t.status === 'valid').length || sum(o.data.lines.filter(l => l.kind === 'ticket'), l => l.qty * l.admits)}</td>
    <td class="tnum">${money(o.data.total, o.data.currency)}${m.refunded || m.credited ? `<div class="small" style="color:var(--bad)">−${money(m.refunded + m.credited, o.data.currency)}</div>` : ''}${m.due ? `<div class="small" style="color:var(--warn)">${money(m.due, o.data.currency)} due</div>` : ''}</td><td>${statusChip(o.status)}</td><td class="small muted">${esc(fmtDT(o.created_at))}</td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">No orders match.</td></tr>'}
  </tbody></table></div>`;
}
const OrderModal = id => { location.hash = '#/admin/orders/' + id; };   // the order is a full page now
const TK_CHIP = { valid: '', cancelled: '<span class="chip bad mini">cancelled</span>', replaced: '<span class="chip mini">replaced</span>' };
const tkType = t => evById(t.event_id)?.ticketTypes.find(x => x.id === t.ticket_type_id)?.name || 'Ticket';
const tkWhere = t => { const ev = evById(t.event_id), slot = t.slot_id && ev?.timeSlots?.find(s => s.id === t.slot_id); return [t.seat ? seatName(ev, t.seat, true, t) : '', slot ? fmtDT(slot.start) : ''].filter(Boolean).join(' · ') || 'General admission'; };
const LOG_ICON = { chargeback: '!', reissue: '⟲', change: '⇄', cancel: '✕', refund: '↩', payment: '＋', addon: '＋', customer: '✎', holder: '✎', note: '✎', message: '✉', resend: '✉', paid: '✓', cancelled: '✕', credit: '★', placed: '•' };
function orderTimeline(o) {
  const rows = (S.adm.orderLog || []).filter(x => x.order_id === o.id).map(x => ({ at: x.at, kind: x.kind, text: x.summary, by: x.by, note: x.kind === 'note' ? '' : x.note }));
  rows.push({ at: o.created_at, kind: 'placed', text: `order placed — ${o.data.payment === 'manual' ? 'staff order' : o.data.payment}${o.data.comp ? ' · complimentary' : ''}`, by: o.data.payment === 'manual' ? '' : o.buyer_email });
  if (o.paid_at && o.paid_at !== o.created_at && !rows.some(r => r.kind === 'paid')) rows.push({ at: o.paid_at, kind: 'paid', text: 'payment confirmed — tickets issued', by: '' });
  return rows.sort((a, b) => D(b.at) - D(a.at));
}
function OrderView(id) {
  const o = S.adm.orders.find(x => x.id === id);
  if (!o) return `<a href="#/admin/orders" class="small muted" style="text-decoration:none">← Orders</a><div class="empty">Order not found.</div>`;
  if (S.ui.oid !== id) { S.ui.oid = id; S.ui.op = null; S.ui.osel = {}; S.ui.cb = null; }
  const d = o.data, cur = d.currency, ev0 = o.event_ids[0], m = orderMoney(o), fin = can('finance.totals'), all = S.adm.tickets.filter(t => t.order_id === id);
  const shown = S.ui.oAll ? all : all.filter(t => t.status !== 'replaced'), live = all.filter(t => t.status === 'valid'), sel = live.filter(t => S.ui.osel[t.id]), paid = o.status === 'paid';
  const pay = o.payment, mails = (S.adm.outbox || []).filter(x => x.order_id === o.id).sort((a, b) => D(b.at) - D(a.at)), notes = (S.adm.orderLog || []).filter(x => x.order_id === o.id && x.kind === 'note');
  const qs = [...(S.adm.bo.settings.questions || []), ...o.event_ids.flatMap(e => (evById(e)?.questions || []).filter(q => q.scope !== 'ticket'))];
  const ans = (q, v) => q.type === 'signature' && String(v || '').startsWith('data:image/png') ? `<img class="sig-img" src="${esc(v)}" alt="signature">` : esc(v === true ? (q.type === 'terms' || q.type === 'waiver' ? 'Accepted' : 'Yes') : v || '—');
  const btn = (kind, label, perm, cls = 'btn-ghost', extra = '') => can(perm, ev0) ? `<button class="btn ${cls} btn-sm" data-action="opOpen" data-v="${kind}" ${extra}>${label}</button>` : '';
  const prods = d.lines.map((l, i) => ({ l, i })).filter(x => x.l.kind === 'addon');
  const cust = S.adm.accounts?.includes(o.buyer_email);
  return `<a href="#/admin/orders" class="small muted" style="text-decoration:none">← Orders</a>
  ${head(`Order ${esc(o.ref)}`, `${statusChip(o.status)} <span class="muted small">placed ${esc(fmtDT(o.created_at))}${d.source ? ' · source ' + esc(d.source) : ''}${d.tracking ? ' · referral ' + esc(d.tracking) : ''}</span>`,
    `<a class="btn btn-ghost btn-sm" target="_blank" href="#/order/${o.id}/${o.access_key || ''}">Buyer's page</a>
     <button class="btn btn-ghost btn-sm" data-action="emailPv" data-id="${o.id}">Confirmation email</button>
     ${live.length && can('orders.resend', ev0) ? `<button class="btn btn-ghost btn-sm" data-action="opGo" data-v="resend" data-k="tickets">Resend tickets</button>` : ''}
     ${btn('message', 'Message customer', 'comms.email')}
     ${['pending', 'awaiting_payment'].includes(o.status) ? (d.plan && planPaid(d.plan) ? btn('installment', 'Record installment', 'orders.edit', 'btn-dark') : btn('markPaid', 'Mark paid & issue tickets', 'orders.edit', 'btn-dark')) + btn('cancelUnpaid', 'Cancel reservation', 'orders.cancel', 'btn-danger') : ''}`)}
  ${S.ui.op ? OpPanel(o, sel, live) : ''}
  <div class="ord-grid"><div class="stack">
    <div class="card" style="padding:0"><div class="between wrap" style="padding:16px 20px 8px;gap:8px"><h3>Tickets <span class="muted small">${live.length} valid${all.length > live.length ? ` · ${all.length - live.length} cancelled / replaced` : ''}</span></h3>
      <div class="row wrap">${all.some(t => t.status === 'replaced') ? `<label class="check small"><input type="checkbox" data-action="oAll" ${S.ui.oAll ? 'checked' : ''}> <span>Show replaced tickets</span></label>` : ''}
        ${paid && live.length ? `${btn('change', sel.length ? `Change ${sel.length} selected` : 'Change seats / tickets', 'orders.seats', 'btn-dark', sel.length ? '' : 'data-all="1"')}${btn('cancel', sel.length ? `Cancel ${sel.length} selected` : 'Cancel tickets', sel.length && sel.length < live.length ? 'orders.cancelTicket' : 'orders.cancel', 'btn-ghost', sel.length ? '' : 'data-all="1"')}${btn('reissue', sel.length ? `Reissue ${sel.length} selected` : 'Reissue tickets', 'orders.edit', 'btn-ghost', sel.length ? '' : 'data-all="1"')}` : ''}</div></div>
      <div class="tbl-wrap" style="border:0;box-shadow:none;border-radius:0"><table class="tbl"><thead><tr><th style="width:30px">${paid && live.length ? `<input type="checkbox" data-action="oSelAll" ${sel.length === live.length && live.length ? 'checked' : ''} aria-label="Select all">` : ''}</th><th>Ticket</th><th>Type / area</th><th>Seat / showtime</th><th>Holder</th>${fin ? '<th>Face</th><th>Paid</th>' : ''}<th>Status</th></tr></thead><tbody>
      ${shown.map(t => `<tr class="${t.status !== 'valid' ? 'dimrow' : ''}"><td>${t.status === 'valid' && paid ? `<input type="checkbox" data-action="oSel" data-id="${t.id}" ${S.ui.osel[t.id] ? 'checked' : ''}>` : ''}</td>
        <td class="tnum"><b>${esc(t.code)}</b>${t.replaces ? `<div class="small muted">replaces ${esc(all.find(x => x.id === t.replaces)?.code || '')}</div>` : ''}${t.status === 'replaced' ? `<div class="small muted">→ ${esc(all.find(x => x.id === t.replaced_by)?.code || '')}</div>` : ''}</td>
        <td>${esc(tkType(t))}${t.area && t.area !== tkType(t) ? `<div class="small muted">${esc(t.area)}</div>` : ''}${t.comp ? ' <span class="chip info mini">comp</span>' : ''}${t.bundle ? ` <span class="chip mini">${esc(t.bundle.name)}</span>` : ''}${t.price_override ? ' <span class="chip warn mini">price override</span>' : ''}</td>
        <td class="small">${esc(tkWhere(t))}</td>
        <td class="small">${esc(t.holder || '')}${t.status === 'valid' && can('orders.customer', ev0) ? ` <a href="#" class="small" data-action="opOpen" data-v="holder" data-id="${t.id}">rename</a>` : ''}</td>
        ${fin ? `<td class="tnum small">${money(t.face, cur)}</td><td class="tnum small">${money(t.paid, cur)}${t.discount ? `<div class="muted">−${money(t.discount, cur)} ${esc(t.promo || '')}</div>` : ''}${t.fee || t.tax ? `<div class="muted">+${money((t.fee || 0) + (t.tax || 0), cur)} fee & tax</div>` : ''}${t.refunded ? `<div style="color:var(--bad)">${t.credited ? `credited ${money(t.credited, cur)}` : `refunded ${money(t.refunded, cur)}`}</div>` : ''}</td>` : ''}
        <td>${t.status !== 'valid' ? TK_CHIP[t.status] : t.checked_in_at ? `<span class="chip ok mini">in ${esc(fmtTime(t.checked_in_at))}</span>` : '<span class="chip mini">not in</span>'}</td></tr>`).join('') || `<tr><td colspan="8" class="muted small" style="padding:14px 20px">${o.status === 'pending' || o.status === 'awaiting_payment' ? 'No tickets yet — they are issued once the payment is confirmed.' : 'No tickets.'}</td></tr>`}
      </tbody></table></div></div>
    <div class="card"><div class="between"><h3>Products & add-ons</h3>${paid ? btn('addAddon', 'Add product', 'orders.edit') : ''}</div>
      ${prods.map(({ l, i }) => { const left = l.qty - (l.removed || 0); return `<div class="between small line"><span>${l.qty} × ${esc(l.name)} <span class="muted">· ${esc(l.eventName || '')}${l.added ? ' · added ' + esc(fmtDT(l.added)) : ''}${l.waived ? ' · no charge' : ''}${l.removed ? ` · ${l.removed} removed` : ''}</span></span>
        <span class="row">${fin ? `<span class="tnum">${money(l.unit * left, cur)}</span>` : ''}${paid && left > 0 && can('orders.edit', ev0) ? `<a href="#" class="small" data-action="opOpen" data-v="removeAddon" data-id="${i}">remove</a>` : ''}</span></div>`; }).join('') || '<p class="small muted" style="margin-top:6px">No products on this order.</p>'}</div>
    <div class="card"><h3>History</h3><p class="small muted" style="margin:2px 0 10px">Every change, in order — nothing is overwritten.</p>
      <div class="tl">${orderTimeline(o).map(r => `<div class="tl-row"><span class="tl-i">${LOG_ICON[r.kind] || '•'}</span><div><div class="small">${esc(r.text.charAt(0).toUpperCase() + r.text.slice(1))}</div>
        <div class="small muted">${esc(fmtDT(r.at))}${r.by ? ' · ' + esc(r.by) : ''}${r.note ? ' · “' + esc(r.note) + '”' : ''}</div></div></div>`).join('')}</div></div>
  </div><div class="stack">
    ${FlagsCard(o)}
    ${PoliciesCard(o)}<div class="card"><div class="between"><h3>Customer</h3>${btn('customer', 'Edit', 'orders.customer')}</div>
      <div style="margin-top:6px"><b>${esc(d.buyer.name)}</b><div class="small muted">${esc(o.buyer_email)}${d.buyer.phone ? ' · ' + esc(d.buyer.phone) : ''}</div>${d.buyer.address ? `<div class="small muted">${esc(d.buyer.address)}</div>` : ''}</div>
      <div class="small muted" style="margin-top:6px">${cust ? '<span class="chip ok mini">has an account</span>' : 'Guest checkout'}${d.optIn ? ' · opted in to marketing' : ''}</div>
      ${can('customers.profiles') ? `<a class="small" href="#/admin/customers/${encodeURIComponent(o.buyer_email)}">Customer profile →</a>` : ''}</div>
    ${d.total == null ? '' : `<div class="card"><div class="between"><h3>Money</h3><div class="row">${wasPaid(o) ? btn('refund', 'Refund', 'orders.refund', 'btn-ghost') : ''}${btn('collect', 'Record payment', 'orders.edit')}</div></div>
      ${d.lines.map(l => l.unit == null ? '' : SumLine(evById(l.eventId), l, cur)).join('')}
      ${Breakdown({ ...d, ticketsTotal: d.ticketsTotal ?? d.subtotal, refunded: 0 }, d.code)}
      ${(d.charges || []).map(c => `<div class="sum-line small"><span class="muted">${esc(c.reason || 'Payment')} · ${esc(PAY_METHODS[c.method] || (c.method === 'credit' ? 'credit ' + c.ref : c.method))} · ${esc(fmtDT(c.at))}</span><span class="tnum">+${money(c.amount, cur)}</span></div>`).join('')}
      ${(d.refunds || []).map(r => `<div class="sum-line small" style="color:var(--bad)"><span>Refund ${r.status === 'processing' ? '<span class="chip warn mini">processing</span>' : r.status === 'failed' ? '<span class="chip bad mini">failed</span>' : ''} · ${esc(r.credit ? 'credit ' + r.credit : REFUND_TO[r.to])} · ${esc(fmtDT(r.at))}${r.ref ? ` · <code>${esc(r.ref)}</code>` : ''}</span><span class="tnum">−${money(r.amount, cur)}</span></div>`).join('')}
      <div class="sep"></div>
      <div class="sum-line"><span class="muted">Collected</span><span class="tnum">${money(m.collected, cur)}</span></div>
      ${m.refunded ? `<div class="sum-line"><span class="muted">Refunded</span><span class="tnum">−${money(m.refunded, cur)}</span></div>` : ''}${m.credited ? `<div class="sum-line"><span class="muted">Given back as credit</span><span class="tnum">−${money(m.credited, cur)}</span></div>` : ''}
      ${m.chargedBack ? `<div class="sum-line"><span class="muted">Chargebacks</span><span class="tnum">−${money(m.chargedBack, cur)}</span></div>` : ''}
      <div class="sum-line total"><span>Net</span><span class="tnum">${money(m.collected - m.refunded - m.credited - m.chargedBack, cur)}</span></div>
      ${m.due ? `<div class="banner warn" style="margin:10px 0 0">Balance due: <b>${money(m.due, cur)}</b>${btn('collect', 'Record payment', 'orders.edit', 'btn-dark')}</div>` : ''}
      ${d.platformFee != null || d.processingFee != null ? `<div class="small muted" style="margin-top:6px">Kept by others: ${d.platformFee != null ? `platform fee ${money(d.platformFee, cur)}` : ''}${d.processingFee != null ? ` · card processing ${money(d.processingFee, cur)}` : ''}</div>` : ''}</div>`}
    ${pay ? `<div class="card"><h3>Payment</h3><div class="small" style="margin-top:6px">${esc(GATEWAYS[pay.provider]?.name || pay.provider || d.payment || '')}${pay.test ? ' (test)' : ''}${pay.ref ? ` · transaction <code>${esc(pay.ref)}</code>` : ''}${pay.last4 ? ` · ${esc(pay.brand)} •••• ${esc(pay.last4)}` : pay.brand ? ' · ' + esc(pay.brand) : ''}${pay.markedPaidBy ? ' · marked paid by ' + esc(pay.markedPaidBy) : ''}${o.paid_at ? ' · ' + esc(fmtDT(o.paid_at)) : ''}</div>
      ${(pay.attempts || []).filter(a => !a.ok).map(a => `<div class="small" style="color:var(--bad)">${esc(fmtDT(a.at))} · ${esc(a.brand || a.method || '')} ${a.last4 ? '•••• ' + esc(a.last4) : ''} — ${esc(a.error || 'failed')}</div>`).join('')}${pay.note ? `<div class="small" style="color:var(--warn)">${esc(pay.note)}</div>` : ''}
      ${o.status === 'awaiting_payment' ? `<div class="small muted" style="margin-top:6px">Card checkout in progress — seats held until ${esc(fmtTime(o.expires_at))}. No tickets until the payment is confirmed.</div>` : ''}
      ${o.status === 'pending' ? `<div class="small muted" style="margin-top:6px">Pay-later reservation: no tickets yet. “Mark paid” issues them and sends the confirmation.</div>` : ''}</div>` : ''}
    ${OrderExtras(o)}
    ${(d.chargebacks || []).length || (wasPaid(o) && pay?.provider && pay.provider !== 'manual' && can('orders.refund', ev0)) ? `<div class="card"><div class="between"><h3>Chargebacks</h3>${wasPaid(o) && can('orders.refund', ev0) && !S.ui.cb ? '<button class="btn btn-ghost btn-sm" data-action="cbOpen">Record chargeback</button>' : ''}</div>
      ${(d.chargebacks || []).map(c => `<div class="between small line"><span>${esc(fmtDT(c.at))} · ${money(c.amount, cur)}${c.reason ? ' · ' + esc(c.reason) : ''}${c.ref ? ` · <code>${esc(c.ref)}</code>` : ''}<div class="muted">${esc(CB_STATUS[c.status])}${c.closed_at ? ' · ' + esc(fmtDT(c.closed_at)) : ''}</div></span>
        ${c.status === 'open' && can('orders.refund', ev0) ? `<span class="row"><button class="btn btn-ghost btn-sm" data-action="cbClose" data-id="${c.id}" data-v="won">Won</button><button class="btn btn-ghost btn-sm" data-action="cbClose" data-id="${c.id}" data-v="lost">Lost</button></span>` : `<span class="chip mini ${c.status === 'won' ? 'ok' : c.status === 'lost' ? 'bad' : 'warn'}">${esc(c.status)}</span>`}</div>`).join('') || '<p class="small muted" style="margin-top:6px">None. The processor reports disputes automatically; record one here if it told you another way.</p>'}
      ${S.ui.cb ? `<div class="sep"></div>${opRow('Disputed amount ($)', `<input class="inp" inputmode="decimal" data-input="cb.amount" value="${esc(S.ui.cb.amount)}">`)}${opRow('Reason', `<input class="inp" data-input="cb.reason" value="${esc(S.ui.cb.reason)}" placeholder="e.g. fraudulent, product not received">`)}${opRow('Processor dispute id (optional)', `<input class="inp" data-input="cb.ref" value="${esc(S.ui.cb.ref)}">`)}
        <div class="row"><button class="btn btn-dark btn-sm" data-action="cbAdd">Record</button><button class="btn btn-ghost btn-sm" data-action="cbCancel">Cancel</button></div>` : ''}</div>` : ''}
    ${d.credit ? `<div class="card"><h3>Credit used</h3><div class="small" style="margin-top:6px"><code>${esc(d.credit.code)}</code> · ${money(d.credit.amount, cur)}${d.credit.restored ? ' · returned to the credit' : ''}</div></div>` : ''}
    ${qs.length ? `<div class="card"><h3>Checkout answers</h3>${qs.map(q => `<div class="small" style="margin-top:6px"><span class="muted">${esc(q.label)}:</span> ${ans(q, d.answers?.[q.id])}</div>`).join('')}</div>` : ''}
    <div class="card"><h3>Internal notes</h3><p class="small muted" style="margin:2px 0 8px">Only your team sees these.</p>
      ${notes.map(n => `<div class="note-row"><div class="small">${esc(n.summary)}</div><div class="small muted">${esc(n.by)} · ${esc(fmtDT(n.at))}</div></div>`).join('')}
      ${can('orders.edit', ev0) ? `<textarea class="inp" rows="2" data-input="onote" placeholder="Add a note…">${esc(S.ui.onote || '')}</textarea><button class="btn btn-ghost btn-sm" style="margin-top:6px" data-action="opGo" data-v="note">Add note</button>` : ''}</div>
    <div class="card"><h3>Communications</h3><p class="small muted" style="margin:2px 0 8px">Every email to this customer about this order${DB.live ? '' : ' (queued — sending switches on in Stage 8)'}.</p>
      ${mails.map(x => `<div class="between small line click" data-action="msgOpen" data-id="${x.id}"><span><b>${esc(x.kind === 'message' && x.subject ? x.subject : kindLabel(x))}</b>${x.kind === 'message' && x.body ? `<div class="muted">${esc(x.body.slice(0, 120))}</div>` : ''}<div class="muted">${esc(fmtDT(x.sent_at || x.send_at || x.at))} · ${esc(x.to)}</div></span>${msgChip(x)}</div>`).join('')}
  </div></div>`;
}
// The action panel at the top of the order page. S.ui.op = {kind, ...fields}; everything re-renders as you choose.
const opRow = (label, inner) => `<div class="field"><label class="fl">${label}</label>${inner}</div>`;
const opSel = (path, opts, cur) => `<select class="inp" data-bind="ui.op.${path}">${Object.entries(opts).map(([k, t]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
const opMoney = (key, val, ph = '') => `<input class="inp" type="number" min="0" step="0.01" data-input="op.${key}" data-rr="1" value="${esc(val ?? '')}" placeholder="${esc(ph)}">`;
const opText = (key, val, ph = '', rr = '') => `<input class="inp" data-input="op.${key}" ${rr ? 'data-rr="1"' : ''} value="${esc(val ?? '')}" placeholder="${esc(ph)}">`;
const opDollars = v => v === undefined || v === null || String(v).trim() === '' ? null : Math.round(parseFloat(v) * 100);
const refundToOpts = o => ({ original: o.payment?.ref ? `Original payment (${o.payment.last4 ? o.payment.brand + ' •••• ' + o.payment.last4 : GATEWAYS[o.payment.provider]?.name || 'card'})` : 'Original payment method', credit: REFUND_TO.credit, eventCredit: REFUND_TO.eventCredit, cash: REFUND_TO.cash, other: REFUND_TO.other });
const futureEvents = () => S.adm.events.filter(e => e.status !== 'cancelled' && !e.archived && D(e.end || e.start) > Date.now());
const creditOpts = (op, prefix = '') => `<div class="grid2">${opRow('Credit for', `<select class="inp" data-bind="ui.op.${prefix}creditEvent">${futureEvents().map(e => `<option value="${e.id}" ${(op[prefix + 'creditEvent'] || op._ev) === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>`)}
  ${opRow('Expires (optional)', `<input class="inp" type="date" data-bind="ui.op.${prefix}creditExpires" value="${esc(op[prefix + 'creditExpires'] || '')}">`)}</div>`;
// the change panel: what each selected ticket becomes, the price difference, and how it's settled
function changeRows(o, op, live) {
  const now = new Date();
  return (op.tickets || []).map(id => {
    const t = live.find(x => x.id === id); if (!t) return null;
    const ev = evById(t.event_id), c = op.map[id] || {}, slot = c.slotId !== undefined ? c.slotId || null : t.slot_id || null, seated = !!ev.seating?.enabled;
    const seat = seated ? c.seat || t.seat : null, ttId = seated ? ev.seating.index?.[seat] : c.ticketTypeId || t.ticket_type_id, tt = ev.ticketTypes.find(x => x.id === ttId);
    const sold = availabilityFrom(S.adm.tickets, ev.id, [], '', S.adm.orders).tt[ttId] || 0;
    const pr = tt ? changePrice(ev, t, tt, slot, sold, now, c.price) : null;
    const changed = tt && (seat !== t.seat || slot !== (t.slot_id || null) || tt.id !== t.ticket_type_id || (c.price !== undefined && c.price !== null && c.price !== ''));
    return { t, ev, c, slot, seat, tt, pr, changed, seated };
  }).filter(Boolean);
}
function OpPanel(o, sel, live) {
  const op = S.ui.op, cur = o.data.currency, m = orderMoney(o), close = `<button class="btn btn-ghost" data-action="opClose">Close</button>`;
  const go = (label, cls = 'btn-accent', dis = false) => `<button class="btn ${cls}" data-action="opGo" data-v="${op.kind}" ${dis ? 'disabled' : ''}>${label}</button>`;
  const note = `${opRow('Reason / note (kept in the history)', `<input class="inp" data-input="op.note" value="${esc(op.note || '')}" placeholder="e.g. customer asked at the box office">`)}`;
  const tell = `<label class="check"><input type="checkbox" data-bind="ui.op.notify" ${op.notify !== false ? 'checked' : ''}> <span>Email the customer${op.kind === 'change' ? ' their updated tickets' : ''}</span></label>`;
  let title = '', body = '', foot = '';
  if (op.kind === 'change') {
    const rows = changeRows(o, op, live), net = rows.reduce((a, r) => a + (r.changed && r.pr ? r.pr.diff : 0), 0), cur0 = rows.find(r => r.t.id === op.cur) || rows.find(r => r.seated && !r.c.seat) || rows[0];
    const curEv = cur0?.ev, slot = cur0?.slot;
    let map = '';
    if (cur0?.seated) {   // pick the new seat on the map: sold, blocked, unavailable and other buyers' checkouts are greyed out; held seats can be used by staff
      const vac = new Set(rows.filter(r => r.ev === curEv && (r.t.slot_id || null) === slot).map(r => r.t.seat)), av = availabilityFrom(S.adm.tickets, curEv.id, S.adm.seatStatus.filter(r => r.status !== 'held'), '', S.adm.orders);
      const off = new Set([...offSeats(av, slot)].filter(s => !vac.has(s)));
      rows.filter(r => r.ev === curEv && r.slot === slot && r.c.seat && r !== cur0).forEach(r => off.add(r.c.seat));
      const lvs = levelsOf(curEv.seating), lv = lvs.some(l => l.id === op.level) ? op.level : (layoutOf(curEv.seating).byId.get(cur0.seat)?.level ?? lvs[0].id);
      map = `<div class="op-map"><div class="small" style="margin-bottom:6px">Choose the new seat for <b>${esc(cur0.t.code)}</b> (now ${esc(seatName(curEv, cur0.t.seat, true, cur0.t))}) — tap a seat.</div>
        ${lvs.length > 1 ? `<div class="tabs sm-levels">${lvs.map(l => `<button type="button" class="${lv === l.id ? 'on' : ''}" data-action="opLevel" data-v="${esc(l.id)}">${esc(l.name)}</button>`).join('')}</div>` : ''}
        <div class="sm-scroll">${SeatCanvas(curEv, { off, mine: [cur0.c.seat || cur0.t.seat], level: lv })}</div>
        <div class="legend">${curEv.ticketTypes.filter(t => Object.values(curEv.seating.index || {}).includes(t.id)).map(t => `<span><i style="background:${tierColor(curEv, t.id)}"></i>${esc(t.name)} ${money(t.price, curEv.currency)}</span>`).join('')}<span><i style="background:#d7d4cb"></i>Taken / unavailable</span></div></div>`;
    }
    title = `Change ${rows.length} ticket${rows.length === 1 ? '' : 's'}`;
    body = `<div class="tbl-wrap" style="box-shadow:none"><table class="tbl"><thead><tr><th>Ticket</th><th>Now</th><th>Change to</th>${can('tickets.pricing', o.event_ids[0]) ? '<th>Price override</th>' : ''}<th>Old</th><th>New</th><th>Difference</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="${r === cur0 && r.seated ? 'op-cur' : ''}"><td class="tnum"><b>${esc(r.t.code)}</b></td><td class="small">${esc(tkType(r.t))}<div class="muted">${esc(tkWhere(r.t))}</div></td>
        <td class="small">${r.seated ? `<a href="#" data-action="opCur" data-id="${r.t.id}">${r.c.seat ? esc(seatName(r.ev, r.c.seat, true)) + ` · ${esc(r.tt?.name || 'not for sale')}` : 'pick a seat ↓'}</a>`
          : `<select class="inp inp-sm" data-bind="ui.op.map.${r.t.id}.ticketTypeId">${r.ev.ticketTypes.map(x => `<option value="${x.id}" ${(r.c.ticketTypeId || r.t.ticket_type_id) === x.id ? 'selected' : ''}>${esc(x.name)} — ${money(listPrice(x, r.slot), cur)}</option>`).join('')}</select>`}
          ${(r.ev.timeSlots || []).length ? `<select class="inp inp-sm" style="margin-top:4px" data-bind="ui.op.map.${r.t.id}.slotId">${r.ev.timeSlots.map(s => `<option value="${s.id}" ${r.slot === s.id ? 'selected' : ''}>${esc(fmtDT(s.start))}</option>`).join('')}</select>` : ''}</td>
        ${can('tickets.pricing', o.event_ids[0]) ? `<td><input class="inp inp-sm" style="width:90px" type="number" min="0" step="0.01" data-action-change="opPrice" data-id="${r.t.id}" value="${r.c.price != null && r.c.price !== '' ? (r.c.price / 100).toFixed(2) : ''}" placeholder="auto"></td>` : ''}
        <td class="tnum small">${money(r.t.paid, cur)}</td><td class="tnum small">${r.changed && r.pr ? money(r.pr.newPaid, cur) : '—'}</td>
        <td class="tnum small">${r.changed && r.pr ? (r.pr.diff > 0 ? `<b style="color:var(--warn)">+${money(r.pr.diff, cur)}</b>` : r.pr.diff < 0 ? `<b style="color:var(--ok)">−${money(-r.pr.diff, cur)}</b>` : '$0') : '—'}</td></tr>`).join('')}</tbody></table></div>
      ${map}
      <div class="op-sum">${net > 0 ? `Amount due: <b>${money(net, cur)}</b>` : net < 0 ? `Difference to give back: <b>${money(-net, cur)}</b>` : 'No price difference.'}</div>
      ${net > 0 ? `<div class="grid2">${opRow('Upgrade difference', opSel('settle', UPGRADE_SETTLE, op.settle))}${op.settle === 'collect' ? opRow('Paid by', opSel('method', PAY_METHODS, op.method)) : ''}</div>` : ''}
      ${net < 0 ? `<div class="grid2">${opRow('Downgrade difference', opSel('downgrade', DOWNGRADE_SETTLE, op.downgrade))}${op.downgrade === 'refund' ? opRow('Refund to', opSel('to', { original: refundToOpts(o).original, cash: 'Cash', other: REFUND_TO.other }, op.to)) : ''}</div>${op.downgrade === 'eventCredit' ? creditOpts(op) : ''}` : ''}
      ${note}${tell}`;
    S.ui.op._net = net; S.ui.op._ready = rows.every(r => r.changed && r.tt);
    foot = go(net > 0 ? `Change & ${op.settle === 'collect' ? 'collect ' + money(net, cur) : op.settle === 'due' ? 'add ' + money(net, cur) + ' due' : 'waive ' + money(net, cur)}` : net < 0 ? `Change & ${{ refund: 'refund', credit: 'credit', eventCredit: 'credit', none: 'keep' }[op.downgrade]} ${money(-net, cur)}` : 'Change tickets', 'btn-accent', !S.ui.op._ready);
  } else if (op.kind === 'cancel') {
    const ids = op.all ? live.map(t => t.id) : op.tickets || [], refund = op.refundMode && op.refundMode !== 'none';
    let plan = null, err = ''; if (refund) try { plan = refundPlan(o, S.adm.tickets, { mode: op.refundMode === 'full' ? 'full' : 'tickets', tickets: ids, fees: op.refundMode === 'ticketsFees' }); } catch (e) { err = e.message; }
    title = op.all ? 'Cancel the whole order' : `Cancel ${ids.length} ticket${ids.length === 1 ? '' : 's'}`;
    body = `<p class="small muted" style="margin-bottom:10px">${ids.map(id => esc(live.find(t => t.id === id)?.code || '')).join(', ')}${op.all && o.data.lines.some(l => l.kind === 'addon') ? ' · and every product on the order' : ''}</p>
      <div class="grid2">${opRow('Seats', opSel('seat', SEAT_AFTER_CANCEL, op.seat || 'release'))}${can('orders.refund', o.event_ids[0]) && wasPaid(o) ? opRow('Refund', opSel('refundMode', { none: 'Cancel without refund', tickets: 'Refund the ticket price', ticketsFees: 'Refund ticket price + booking fee', ...(op.all ? { full: 'Refund everything left on the order' } : {}) }, op.refundMode || 'none')) : ''}</div>
      ${refund ? `<div class="grid2">${opRow('Refund to', opSel('to', refundToOpts(o), op.to || 'original'))}</div>${op.to === 'eventCredit' ? creditOpts(op) : ''}<div class="op-sum">${err ? `<span style="color:var(--bad)">${esc(err)}</span>` : `Refund: <b>${money(plan.amount, cur)}</b>`}</div>` : ''}
      ${note}${tell}`;
    foot = go(refund && plan ? `Cancel & refund ${money(plan.amount, cur)}` : 'Cancel tickets', 'btn-danger', refund && !plan);
  } else if (op.kind === 'refund') {
    let plan = null, err = '';
    try { plan = refundPlan(o, S.adm.tickets, { mode: op.mode, tickets: Object.keys(S.ui.osel).filter(k => S.ui.osel[k]), fees: op.fees, pct: op.pct, amount: opDollars(op.amount) }); } catch (e) { err = e.message; }
    title = 'Refund';
    body = `<p class="small muted" style="margin-bottom:10px">${money(m.refundable, cur)} can still be refunded${m.refunded || m.credited ? ` (${money(m.refunded + m.credited, cur)} already given back)` : ''}.</p>
      <div class="grid2">${opRow('How much', opSel('mode', { full: 'Full refund (everything left)', tickets: 'Selected tickets — ticket price', fees: 'Booking fee only', percent: 'A percentage', amount: 'A specific amount' }, op.mode))}
        ${op.mode === 'percent' ? opRow('Percent', `<input class="inp" type="number" min="1" max="100" data-input="op.pct" data-rr="1" value="${esc(op.pct || '')}" placeholder="e.g. 50">`) : op.mode === 'amount' ? opRow('Amount ($)', opMoney('amount', op.amount, '0.00')) : op.mode === 'tickets' ? opRow('Booking fee', `<label class="check"><input type="checkbox" data-bind="ui.op.fees" ${op.fees ? 'checked' : ''}> <span>Refund their booking fee too</span></label>`) : ''}</div>
      ${op.mode === 'tickets' ? `<p class="small muted">Tick the tickets in the list below. ${Object.keys(S.ui.osel).filter(k => S.ui.osel[k]).length} selected.</p>` : ''}
      <div class="grid2">${opRow('Refund to', opSel('to', refundToOpts(o), op.to || 'original'))}
        ${['full', 'tickets'].includes(op.mode) && o.status === 'paid' ? opRow('Tickets', `<label class="check"><input type="checkbox" data-bind="ui.op.cancel" ${op.cancel ? 'checked' : ''}> <span>Also cancel ${op.mode === 'full' ? 'all tickets' : 'the refunded tickets'}</span></label><div class="small muted">Leave unticked to refund without cancelling.</div>`) : ''}</div>
      ${op.cancel && ['full', 'tickets'].includes(op.mode) ? `<div class="grid2">${opRow('Seats', opSel('seat', SEAT_AFTER_CANCEL, op.seat || 'release'))}</div>` : ''}
      ${op.to === 'eventCredit' ? creditOpts(op) : ''}
      <div class="op-sum">${err ? `<span style="color:var(--bad)">${esc(err)}</span>` : `Refund: <b>${money(plan.amount, cur)}</b>${plan.fees ? ` <span class="muted small">(incl. ${money(plan.fees, cur)} booking fee)</span>` : ''} ${['credit', 'eventCredit'].includes(op.to) ? '— issued as a credit code' : op.to === 'original' && o.payment?.ref ? '— back to the card' : ''}`}</div>
      ${note}${tell}`;
    foot = go(plan ? `Refund ${money(plan.amount, cur)}` : 'Refund', 'btn-danger', !plan);
  } else if (op.kind === 'collect') {
    title = 'Record a payment';
    body = `<div class="grid2">${opRow('Amount ($)', opMoney('amount', op.amount, m.due ? (m.due / 100).toFixed(2) : '0.00'))}${opRow('Paid by', opSel('method', PAY_METHODS, op.method))}</div>
      <div class="grid2">${opRow('Reference (optional)', opText('ref', op.ref, 'receipt / check no.'))}${opRow('For', opText('reason', op.reason, m.due ? 'Balance due' : 'Payment received'))}</div>
      ${m.due && (S.adm.credits || []).some(c => c.email === o.buyer_email && c.status === 'active') && can('orders.refund') ? `<p class="small">This customer has credit — <a href="#/admin/customers/${encodeURIComponent(o.buyer_email)}">apply it from their profile</a>.</p>` : ''}${note}`;
    foot = go('Record payment');
  } else if (op.kind === 'addAddon') {
    const ev = evById(op.eventId || o.event_ids[0]), ad = (ev?.addons || []).find(a => a.id === op.addonId) || ev?.addons?.[0], qty = Math.max(1, +op.qty || 1);
    title = 'Add a product';
    body = `${o.event_ids.length > 1 ? opRow('Event', `<select class="inp" data-bind="ui.op.eventId">${o.event_ids.map(id => `<option value="${id}" ${ev?.id === id ? 'selected' : ''}>${esc(evById(id)?.name || '')}</option>`).join('')}</select>`) : ''}
      ${(ev?.addons || []).length ? `<div class="grid2">${opRow('Product', `<select class="inp" data-bind="ui.op.addonId">${ev.addons.map(a => `<option value="${a.id}" ${ad?.id === a.id ? 'selected' : ''}>${esc(a.name)} — ${money(a.price, cur)}</option>`).join('')}</select>`)}${opRow('Quantity', `<input class="inp" type="number" min="1" data-input="op.qty" data-rr="1" value="${esc(op.qty || 1)}">`)}</div>
      <div class="grid2">${opRow(`Charge ${money(cents(ad?.price) * qty, cur)}`, opSel('settle', UPGRADE_SETTLE, op.settle))}${op.settle === 'collect' ? opRow('Paid by', opSel('method', PAY_METHODS, op.method)) : ''}</div>${note}` : '<p class="small muted">This event has no products.</p>'}`;
    foot = (ev?.addons || []).length ? go('Add product') : '';
  } else if (op.kind === 'removeAddon') {
    const l = o.data.lines[+op.line], left = l ? l.qty - (l.removed || 0) : 0, qty = Math.min(left, Math.max(1, +op.qty || left));
    title = 'Remove a product';
    body = l ? `<p class="small" style="margin-bottom:10px">${l.qty} × ${esc(l.name)}${l.removed ? ` (${l.removed} already removed)` : ''}</p>
      <div class="grid2">${opRow('How many', `<input class="inp" type="number" min="1" max="${left}" data-input="op.qty" data-rr="1" value="${esc(qty)}">`)}${can('orders.refund', o.event_ids[0]) && wasPaid(o) && l.unit ? opRow('Refund', opSel('refund', { '': 'No refund', original: 'Refund to the original payment', credit: 'Refund as account credit', cash: 'Refund in cash' }, op.refund || '')) : ''}</div>
      ${op.refund ? `<div class="op-sum">Refund: <b>${money(Math.min(l.unit * qty, m.refundable), cur)}</b></div>` : ''}${note}` : '';
    foot = go('Remove', 'btn-danger');
  } else if (op.kind === 'customer') {
    title = 'Edit customer details';
    body = `<div class="grid2">${opRow('Name', opText('name', op.name))}${opRow('Email', opText('email', op.email))}</div><div class="grid2">${opRow('Phone', opText('phone', op.phone))}</div>
      <p class="small muted">The change is kept in the order history with the old details.</p>${note}`;
    foot = go('Save details');
  } else if (op.kind === 'holder') {
    const t = live.find(x => x.id === op.ticket);
    title = `Ticket ${esc(t?.code || '')} — holder`;
    body = `${opRow('Name on the ticket', opText('name', op.name, 'New guest name'))}<p class="small muted">Use this when a ticket is passed to someone else. The ticket code stays the same.</p>${note}`;
    foot = go('Save');
  } else if (op.kind === 'message') {
    title = `Message ${esc(o.data.buyer.name)}`;
    body = `${opRow('Subject', opText('subject', op.subject, 'About your order ' + o.ref))}${opRow('Message', `<textarea class="inp" rows="4" data-input="op.body">${esc(op.body || '')}</textarea>`)}<p class="small muted">Sent to ${esc(o.buyer_email)} and kept on the order.</p>`;
    foot = go('Send message');
  } else if (op.kind === 'markPaid') {
    title = 'Mark paid & issue tickets';
    body = `<div class="grid2">${opRow('Paid by', opSel('method', PAY_METHODS, op.method))}${opRow('Date received', `<input class="inp" type="date" data-bind="ui.op.date" value="${esc(op.date || '')}">`)}</div>
      <div class="grid2">${opRow('Reference', opText('ref', op.ref, 'receipt / check no. / Zelle id'))}${opRow('Payment notes', opText('notes', op.notes, ''))}</div><p class="small muted">The tickets are issued now and the confirmation email is queued.</p>${note}`;
    foot = go('Mark paid', 'btn-dark');
  } else if (op.kind === 'installment') {
    const x = planNext(o.data.plan);
    title = `Record ${x ? esc(x.label.toLowerCase()) + ' — ' + money(x.amount, o.data.currency) : 'installment'}`;
    body = `<div class="grid2">${opRow('Paid by', opSel('method', PAY_METHODS, op.method))}${opRow('Reference', opText('ref', op.ref, ''))}</div><p class="small muted">${planNext(o.data.plan) && o.data.plan.schedule.filter(y => !y.paid_at).length === 1 ? 'This is the last payment — the tickets are issued now.' : 'The seats stay held; the tickets come with the last payment.'}</p>${note}`;
    foot = go('Record payment', 'btn-dark');
  } else if (op.kind === 'reissue') {
    const tks = live.filter(t => op.tickets.includes(t.id));
    title = `Reissue ${tks.length} ticket${tks.length === 1 ? '' : 's'}`;
    body = `<p class="small">${tks.map(t => `<b>${esc(t.code)}</b>`).join(', ')} get new QR codes. Same seat, type and price. <b>The old codes stop working at the door immediately</b> — use this for a lost phone or a forwarded screenshot.</p>${tell}${note}`;
    foot = go('Reissue with new codes', 'btn-dark');
  } else if (op.kind === 'cancelUnpaid') {
    const paidSoFar = planPaid(o.data.plan);
    title = 'Cancel this reservation'; body = paidSoFar ? `<p class="small">${money(paidSoFar, o.data.currency)} of the payment plan was paid. The seats and stock go back on sale.</p>${opRow('What was paid', opSel('keep', { credit: 'Give it back as account credit', keep: 'Keep it (non-refundable deposit)' }, op.keep))}${note}`
      : `<p class="small">Nothing was paid, so there's nothing to refund. The seats and stock go back on sale.</p>${note}`; foot = go('Cancel reservation', 'btn-danger');
  }
  return `<div class="card op-card"><div class="between"><h3>${title}</h3><button class="icon-btn" data-action="opClose" aria-label="Close">${ic('x', 14)}</button></div><div class="stack" style="margin-top:12px">${body}</div><div class="row wrap" style="margin-top:14px;justify-content:flex-end">${close}${foot}</div></div>`;
}
// the server call for the open panel
function opPayload(o) {
  const op = S.ui.op, sel = Object.keys(S.ui.osel).filter(k => S.ui.osel[k]), note = op.note || '', notify = op.notify !== false;
  switch (op.kind) {
    case 'change': return { changes: op.tickets.map(id => ({ ticket: id, ...op.map[id] })), settle: op.settle, method: op.method, downgrade: op.downgrade, to: op.to, creditEvent: op.creditEvent || op._ev, creditExpires: op.creditExpires ? new Date(op.creditExpires + 'T23:59').toISOString() : null, note, notify };
    case 'cancel': { const r = op.refundMode && op.refundMode !== 'none'; return { all: !!op.all, tickets: op.all ? [] : op.tickets, seat: op.seat || 'release', note, notify,
      refund: r ? { mode: op.refundMode === 'full' ? 'full' : 'tickets', fees: op.refundMode === 'ticketsFees', to: op.to || 'original', creditEvent: op.creditEvent || op._ev, creditExpires: op.creditExpires ? new Date(op.creditExpires + 'T23:59').toISOString() : null } : null }; }
    case 'refund': return { mode: op.mode, tickets: sel, fees: !!op.fees, pct: op.pct, amount: opDollars(op.amount), to: op.to || 'original', cancel: !!op.cancel, seat: op.seat || 'release', creditEvent: op.creditEvent || op._ev, creditExpires: op.creditExpires ? new Date(op.creditExpires + 'T23:59').toISOString() : null, note, notify };
    case 'collect': return { amount: opDollars(op.amount) ?? orderMoney(o).due, method: op.method, ref: op.ref, reason: op.reason || (orderMoney(o).due ? 'Balance due' : 'Payment received'), note };
    case 'addAddon': { const ev = evById(op.eventId || o.event_ids[0]); return { eventId: ev?.id, addonId: op.addonId || ev?.addons?.[0]?.id, qty: Math.max(1, +op.qty || 1), settle: op.settle, method: op.method, note }; }
    case 'removeAddon': { const l = o.data.lines[+op.line]; return { line: +op.line, qty: Math.min(l.qty - (l.removed || 0), Math.max(1, +op.qty || l.qty - (l.removed || 0))), refund: !!op.refund, to: op.refund || 'original', note }; }
    case 'customer': return { name: op.name, email: op.email, phone: op.phone, note };
    case 'holder': return { ticket: op.ticket, name: op.name, note };
    case 'message': return { subject: op.subject || 'About your order ' + o.ref, body: op.body };
    case 'markPaid': return { method: op.method, date: op.date || '', ref: op.ref, notes: op.notes, note };
    case 'installment': return { method: op.method, ref: op.ref, note };
    case 'cancelUnpaid': return { keep: op.keep, note };
    case 'reissue': return { tickets: op.tickets, note, notify };
    default: return { note };
  }
}
const OP_DONE = { change: 'Tickets changed — new tickets issued', cancel: 'Cancelled', refund: 'Refund issued', collect: 'Payment recorded', addAddon: 'Product added', removeAddon: 'Product removed', customer: 'Customer details saved',
  holder: 'Holder changed', reissue: 'Reissued — the old codes no longer scan', message: 'Message queued', markPaid: 'Marked paid — tickets issued', cancelUnpaid: 'Reservation cancelled', note: 'Note added', resend: 'Tickets re-sent', installment: 'Installment recorded' };

// ── Customers (Stage 6 §7): one record per email across all of this box office's orders ──
function customerIndex() {
  const by = {};
  for (const o of S.adm.orders) { if (o.status === 'expired') continue; const c = by[o.buyer_email] ||= { email: o.buyer_email, name: o.data.buyer.name, phone: o.data.buyer.phone || '', orders: [], last: o.created_at };
    c.orders.push(o); if (D(o.created_at) >= D(c.last)) { c.last = o.created_at; c.name = o.data.buyer.name; c.phone = o.data.buyer.phone || c.phone; } }
  for (const cr of S.adm.credits || []) by[cr.email] ||= { email: cr.email, name: cr.name, phone: '', orders: [], last: cr.issued_at };
  return Object.values(by).map(c => { const ids = new Set(c.orders.map(o => o.id)), tks = S.adm.tickets.filter(t => ids.has(t.order_id) && t.status !== 'replaced');
    return { ...c, tickets: tks, spent: sum(c.orders, o => orderMoney(o).net), refunds: sum(c.orders, o => orderMoney(o).refunded + orderMoney(o).credited), credit: sum((S.adm.credits || []).filter(x => x.email === c.email && x.status === 'active'), x => x.remaining), account: (S.adm.accounts || []).includes(c.email) }; });
}
function Customers() {
  if (S.route.params[0] === '~inbox') return CustomerInbox();
  if (S.route.params[0] === '~banned') return CustomerBans();
  if (S.route.params[0]) return CustomerView(S.route.params[0]);
  const q = String(S.ui.cq || '').trim().toLowerCase(), all = customerIndex(), list = all.filter(c => !q || [c.name, c.email, c.phone].join(' ').toLowerCase().includes(q)).sort((a, b) => D(b.last) - D(a.last));
  return head('Customers', `${all.length} customers · ${all.filter(c => c.account).length} with an account`, (navOk(NAV.find(n => n[0] === 'marketing')) ? '<a class="btn btn-ghost" href="#/admin/marketing/audience">Segment & export</a>' : '') + (can('customers.export') ? '<button class="btn btn-ghost" data-action="exportCustomers">Export CSV</button>' : '')) + `
  ${CustomersTabs('list')}<div class="toolbar"><input class="inp" style="flex:1" data-input="cq" data-rr="1" placeholder="Search name, email or phone…" value="${esc(S.ui.cq || '')}"></div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Customer</th><th>Orders</th><th>Tickets</th><th>Spent</th><th>Refunds</th><th>Credit</th><th>Marketing</th><th>Account</th><th>Last order</th></tr></thead><tbody>
  ${list.slice(0, 400).map(c => `<tr class="click" data-action="go" data-v="#/admin/customers/${encodeURIComponent(c.email)}"><td><b>${esc(c.name)}</b><div class="small muted">${esc(c.email)}${c.phone ? ' · ' + esc(c.phone) : ''}</div></td>
    <td class="tnum">${c.orders.length}</td><td class="tnum">${c.tickets.filter(t => t.status === 'valid').length}</td><td class="tnum">${money(c.spent)}</td><td class="tnum">${c.refunds ? money(c.refunds) : '—'}</td><td class="tnum">${c.credit ? `<span class="chip ok mini">${money(c.credit)}</span>` : '—'}</td><td>${consentChips(contactFor(c.email), c.phone)}</td>
    <td>${c.account ? '<span class="chip ok mini">yes</span>' : '<span class="muted small">guest</span>'}</td><td class="small muted">${esc(fmtDT(c.last))}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">No customers match.</td></tr>'}</tbody></table></div>`;
}
function CustomerView(email) {
  const c = customerIndex().find(x => x.email === email);
  if (!c) return `<a href="#/admin/customers" class="small muted" style="text-decoration:none">← Customers</a><div class="empty">Customer not found.</div>`;
  const now = Date.now(), valid = c.tickets.filter(t => t.status === 'valid'), when = t => D(evById(t.event_id)?.timeSlots?.find(s => s.id === t.slot_id)?.start || evById(t.event_id)?.start);
  const upcoming = valid.filter(t => when(t) >= now).sort((a, b) => when(a) - when(b)), past = c.tickets.filter(t => when(t) < now || t.status !== 'valid');
  const credits = (S.adm.credits || []).filter(x => x.email === email), notes = (S.adm.custNotes || []).filter(n => n.email === email);
  const codes = [...new Set(c.orders.map(o => o.data.code).filter(Boolean))], refs = [...new Set(c.orders.map(o => o.data.tracking).filter(Boolean))];
  const prods = {}; c.orders.forEach(o => o.data.lines.filter(l => l.kind === 'addon').forEach(l => { prods[l.name] = (prods[l.name] || 0) + l.qty - (l.removed || 0); }));
  const comps = c.tickets.filter(t => t.comp && t.status === 'valid').length, tkRow = t => `<div class="between small line"><span><b>${esc(evById(t.event_id)?.name || '')}</b> · ${esc(tkType(t))}<div class="muted">${esc(tkWhere(t))} · ${esc(t.code)}</div></span>
    <span>${TK_CHIP[t.status] || (t.checked_in_at ? '<span class="chip ok mini">checked in</span>' : '')} <a href="#/admin/orders/${t.order_id}" class="small">order</a></span></div>`;
  const kpi = (l, v, d = '') => `<div class="kpi"><div class="eyebrow">${l}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
  const cu = S.ui.cust?.email === email ? S.ui.cust : (S.ui.cust = { email, amount: '', eventId: '', expires: '', note: '' });
  return `<a href="#/admin/customers" class="small muted" style="text-decoration:none">← Customers</a>
  ${head(esc(c.name), `${esc(c.email)}${c.phone ? ' · ' + esc(c.phone) : ''} · ${c.account ? '<span class="chip ok mini">customer account</span>' : '<span class="chip mini">guest — no account</span>'}${(S.adm.bans || []).some(b => b.email === email && !b.removed_at) ? ' <span class="chip bad mini">banned</span>' : ''}`,
    can('customers.ban') && !(S.adm.bans || []).some(b => b.email === email && !b.removed_at) ? `<button class="btn btn-ghost" data-action="banAsk" data-v="${esc(email)}">Ban from buying…</button>` : '')}
  <div class="kpis">${kpi('Total spent', money(c.spent), `${c.orders.length} order${c.orders.length === 1 ? '' : 's'}`)}${kpi('Tickets', valid.length, `${upcoming.length} upcoming · ${comps} comp`)}${kpi('Refunds', money(c.refunds))}${kpi('Credit balance', money(c.credit), `${credits.length} credit${credits.length === 1 ? '' : 's'}`)}</div>
  <div class="ord-grid"><div class="stack">
    <div class="card"><h3>Upcoming events & current tickets</h3>${upcoming.map(tkRow).join('') || '<p class="small muted" style="margin-top:6px">No upcoming tickets.</p>'}</div>
    <div class="card" style="padding:0"><div style="padding:16px 20px 6px"><h3>Order history</h3></div><table class="tbl"><thead><tr><th>Order</th><th>Event</th><th>Status</th><th>Total</th><th>Refunded</th><th>Placed</th></tr></thead><tbody>
      ${c.orders.slice().sort((a, b) => D(b.created_at) - D(a.created_at)).map(o => { const m = orderMoney(o); return `<tr class="click" data-action="openOrder" data-id="${o.id}"><td class="tnum"><b>${esc(o.ref)}</b></td><td class="small">${esc([...new Set(o.data.lines.map(l => l.eventName))].join(', '))}</td><td>${statusChip(o.status)}</td><td class="tnum">${money(o.data.total, o.data.currency)}</td><td class="tnum">${m.refunded + m.credited ? money(m.refunded + m.credited) : '—'}</td><td class="small muted">${esc(fmtDT(o.created_at))}</td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">No orders.</td></tr>'}</tbody></table></div>
    <div class="card"><h3>Past & cancelled tickets</h3>${past.slice(0, 60).map(tkRow).join('') || '<p class="small muted" style="margin-top:6px">None.</p>'}</div>
  </div><div class="stack">
    <div class="card"><h3>Credits</h3>${credits.map(x => `<div class="line"><div class="between small"><span><code>${esc(x.code)}</code> · ${money(x.amount)}${x.event_id ? ' · for ' + esc(evById(x.event_id)?.name || 'an event') : ' · any event'}</span><span class="chip mini ${x.status === 'active' ? 'ok' : x.status === 'revoked' ? 'bad' : ''}">${esc(x.status)}</span></div>
        <div class="small muted">${money(x.remaining)} left · ${money(x.used)} used${x.uses.length ? ' on ' + x.uses.map(u => esc(u.ref)).join(', ') : ''} · issued ${esc(fmtDT(x.issued_at))} by ${esc(x.issued_by || '')}${x.source_ref ? ' from ' + esc(x.source_ref) : ''}${x.expires ? ' · expires ' + esc(fmtDate(x.expires, { month: 'short', day: 'numeric', year: 'numeric' })) : ''}${x.revoked_at ? ' · revoked by ' + esc(x.revoked_by) : ''}</div>
        ${x.status === 'active' && can('orders.refund') ? `<div class="row" style="margin-top:4px">${c.orders.some(o => o.data.due) ? `<button class="btn btn-ghost btn-sm" data-action="creditApply" data-id="${x.id}">Apply to balance due</button>` : ''}<button class="btn btn-ghost btn-sm" data-action="creditRevoke" data-id="${x.id}">Revoke</button></div>` : ''}</div>`).join('') || '<p class="small muted" style="margin-top:6px">No credits.</p>'}
      ${can('orders.refund') ? `<div class="sep"></div><div class="fl">Issue credit</div><div class="grid2"><input class="inp" type="number" min="0" step="0.01" data-input="cust.amount" value="${esc(cu.amount)}" placeholder="Amount $">
        <select class="inp" data-input="cust.eventId"><option value="">Any event</option>${futureEvents().map(e => `<option value="${e.id}" ${cu.eventId === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></div>
        <div class="grid2" style="margin-top:8px"><input class="inp" type="date" data-input="cust.expires" value="${esc(cu.expires)}" title="Expires (optional)"><input class="inp" data-input="cust.note" value="${esc(cu.note)}" placeholder="Reason"></div>
        <button class="btn btn-dark btn-sm" style="margin-top:8px" data-action="creditIssue">Issue credit</button>` : ''}</div>
    <div class="card"><h3>Internal notes</h3>${notes.map(n => `<div class="note-row"><div class="small">${esc(n.body)}</div><div class="small muted">${esc(n.by)} · ${esc(fmtDT(n.at))}</div></div>`).join('') || '<p class="small muted" style="margin:6px 0">No notes yet.</p>'}
      <textarea class="inp" rows="2" data-input="cnote" placeholder="Add a note about this customer…">${esc(S.ui.cnote || '')}</textarea><button class="btn btn-ghost btn-sm" style="margin-top:6px" data-action="custNote" data-v="${esc(email)}">Add note</button></div>
    ${CustomerConsent(email, contactFor(email), c.phone)}
    <div class="card"><h3>Codes & products</h3>
      <div class="small" style="margin-top:6px"><span class="muted">First came from:</span> ${(() => { const o = c.orders.slice().sort((a, b) => D(a.created_at) - D(b.created_at))[0]; const u = o?.data.utm; return o ? esc(u ? [u.source, u.medium, u.campaign].filter(Boolean).join(' / ') : o.data.tracking ? 'ref ' + o.data.tracking : o.data.source || 'direct') : '—'; })()}</div>
      <div class="small" style="margin-top:6px"><span class="muted">Events attended:</span> ${(() => { const ids = [...new Set(c.tickets.filter(t => t.checked_in_at).map(t => t.event_id))]; return ids.length ? ids.map(id => esc(evName(id))).join(', ') : '—'; })()}</div>
      <div class="small" style="margin-top:6px"><span class="muted">Promo codes used:</span> ${codes.map(x => `<span class="chip mini">${esc(x)}</span>`).join(' ') || '—'}</div>
      <div class="small" style="margin-top:6px"><span class="muted">Referral / tracking codes:</span> ${refs.map(x => `<span class="chip mini">${esc(x)}</span>`).join(' ') || '—'}</div>
      <div class="small" style="margin-top:6px"><span class="muted">Products bought:</span> ${Object.entries(prods).filter(([, n]) => n > 0).map(([k, n]) => `${esc(k)} × ${n}`).join(', ') || '—'}</div>
      <div class="small" style="margin-top:6px"><span class="muted">Complimentary tickets:</span> ${comps || '—'}</div></div>
  </div></div>`;
}

// ── Live event activity (Stage 6 §9): people on the page now, carts, seats tied up in checkout vs sold, conversion, sources ──
function liveData(ev) {
  const now = Date.now(), L = S.adm.live?.[ev.id] || { now: 0, carts: 0, cartTickets: 0, carted: 0, converted: 0, abandoned: 0 }, v = S.adm.views?.[ev.id] || { total: 0, unique: 0, today: 0, last10m: 0, bySrc: {} };
  const os = S.adm.orders.filter(o => o.event_ids.includes(ev.id)), checkouts = os.filter(o => o.status === 'awaiting_payment' && D(o.expires_at) > now);
  const holds = (S.adm.seatStatus || []).filter(r => r.event_id === ev.id && r.status === 'checkout' && D(r.expires_at) > now).length;
  const inCheckout = sum(checkouts, o => sum(o.data.lines.filter(l => l.eventId === ev.id), l => lineUnits(l).filter(u => u.seat).length));
  const sold = S.adm.tickets.filter(t => t.event_id === ev.id && t.status === 'valid').length, done = os.filter(o => wasPaid(o) || o.status === 'pending');
  const started = os.filter(o => o.data.payment !== 'manual' && D(o.created_at) >= now - 30 * 864e5), completed = started.filter(o => wasPaid(o) || o.status === 'pending');
  const sales = {}; done.forEach(o => { const k = o.data.tracking ? 'ref: ' + o.data.tracking : o.data.source || 'direct'; (sales[k] ||= { orders: 0, rev: 0 }).orders++; sales[k].rev += sum(o.data.lines.filter(l => l.eventId === ev.id), l => l.unit * l.qty - (l.disc || 0)); });
  return { L, v, checkouts, holds, inCheckout, sold, started, completed, sales, last10: done.filter(o => D(o.paid_at || o.created_at) >= now - 6e5).length, today: done.filter(o => D(o.paid_at || o.created_at) >= new Date().setHours(0, 0, 0, 0)).length,
    feed: os.filter(o => o.status !== 'expired').sort((a, b) => D(b.created_at) - D(a.created_at)).slice(0, 10) };
}
function EdLive(ev) {
  const x = liveData(ev), L = x.L, pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—', fin = can('finance.totals');
  const kpi = (l, val, d = '', dark) => `<div class="kpi ${dark ? 'dark' : ''}"><div class="eyebrow">${l}</div><div class="v">${val}</div>${d ? `<div class="d" ${dark ? 'style="color:var(--mut)"' : ''}>${d}</div>` : ''}</div>`;
  const tied = x.holds + x.inCheckout, cap = Math.max(1, x.sold + tied);
  return `<div class="between" style="margin:4px 0 12px"><div class="eyebrow dash">Live right now</div><span class="small muted"><span class="live-dot"></span> updates every 15 seconds · ${esc(fmtTime(new Date().toISOString()))}</span></div>
  <div class="kpis">${kpi('Viewing now', L.now, 'people on the event page', true)}${kpi('Active carts', L.carts, `${L.cartTickets} ticket${L.cartTickets === 1 ? '' : 's'} in carts`)}${kpi('Seats held in checkout', tied, `${x.checkouts.length} checkout${x.checkouts.length === 1 ? '' : 's'} paying now`)}${kpi('Orders · last 10 min', x.last10, `${x.today} today`)}</div>
  <div class="kpis">${kpi('Views today', x.v.today.toLocaleString(), `${x.v.total.toLocaleString()} total · ${x.v.unique.toLocaleString()} unique visitors`)}${kpi('Cart abandonment', L.abandoned, `${pct(L.abandoned, L.abandoned + L.converted)} of carts`)}${kpi('Checkout conversion', pct(x.completed.length, x.started.length), `${x.completed.length} of ${x.started.length} checkouts · 30 days`)}${kpi('Visitor → order', pct(L.converted, x.v.unique), `${L.converted} visitors ordered`)}</div>
  <div class="card" style="margin-bottom:16px"><h3>Seats: tied up in checkout vs sold</h3><div class="stackbar" style="margin-top:10px"><i class="s-sold" style="width:${x.sold / cap * 100}%"></i><i class="s-tied" style="width:${tied / cap * 100}%"></i></div>
    <div class="legend" style="margin-top:8px"><span><i style="background:var(--ink)"></i>Sold / issued ${x.sold}</span><span><i style="background:#e8a33d"></i>In checkout right now ${tied}${x.holds ? ` (${x.holds} held while choosing, ${x.inCheckout} paying)` : ''}</span></div></div>
  <div class="cols"><div class="card"><h3>Live sales</h3>${x.feed.map(o => `<div class="between small line click" data-action="openOrder" data-id="${o.id}"><span><b>${esc(o.data.buyer.name)}</b> · ${sum(o.data.lines.filter(l => l.eventId === ev.id), l => lineUnits(l).length)} ticket(s)<div class="muted">${esc(ago(o.created_at))}${o.data.tracking ? ' · ref ' + esc(o.data.tracking) : o.data.source ? ' · ' + esc(o.data.source) : ''}</div></span><span>${statusChip(o.status)}</span></div>`).join('') || '<p class="small muted">No orders yet.</p>'}</div>
    <div class="stack"><div class="card"><h3>Traffic sources</h3>${Object.entries(x.v.bySrc || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="between small line"><span>${esc(k)}</span><b class="tnum">${n}</b></div>`).join('') || '<p class="small muted">No views yet.</p>'}</div>
      <div class="card"><h3>Sales by source</h3>${Object.entries(x.sales).sort((a, b) => b[1].orders - a[1].orders).map(([k, s]) => `<div class="between small line"><span>${esc(k)}</span><span class="tnum">${s.orders} order${s.orders === 1 ? '' : 's'}${fin ? ' · ' + money(s.rev) : ''}</span></div>`).join('') || '<p class="small muted">No sales yet.</p>'}</div></div></div>`;
}
// seats staff can't use right now: sold / reserved, blocked, unavailable, in a buyer's checkout (held seats are fine for staff)
const staffOff = (ev, slot) => offSeats(availabilityFrom(S.adm.tickets, ev.id, S.adm.seatStatus.filter(r => r.status !== 'held'), '', S.adm.orders), slot);
function adminPickSeat(seat) {
  if (S.ui.op?.kind === 'change') {
    const o = S.adm.orders.find(x => x.id === S.ui.oid), rows = changeRows(o, S.ui.op, S.adm.tickets.filter(t => t.order_id === o.id && t.status === 'valid'));
    const cur = rows.find(r => r.t.id === S.ui.op.cur) || rows.find(r => r.seated && !r.c.seat) || rows[0]; if (!cur) return;
    S.ui.op.map[cur.t.id] = { ...(S.ui.op.map[cur.t.id] || {}), seat };
    const next = rows.find(r => r.seated && r !== cur && !S.ui.op.map[r.t.id]?.seat); S.ui.op.cur = next ? next.t.id : cur.t.id;
    return render();
  }
  if (S.ui.mo && S.route.params[0] === 'new') { const a = S.ui.mo.seats, i = a.indexOf(seat); if (i >= 0) a.splice(i, 1); else a.push(seat); render(); }
}
function adminPickGa(code) {   // a standing area on a seated map: take its next free spot
  const o = S.ui.op?.kind === 'change' && S.adm.orders.find(x => x.id === S.ui.oid);
  const row = o && changeRows(o, S.ui.op, S.adm.tickets.filter(t => t.order_id === o.id && t.status === 'valid')).find(r => r.t.id === S.ui.op.cur || r.seated);
  const ev = row ? row.ev : evById(S.ui.mo?.ev); if (!ev) return;
  const slot = row ? row.slot : ev.timeSlots?.length ? S.ui.mo.slot || ev.timeSlots[0].id : null, off = staffOff(ev, slot), taken = new Set(row ? Object.values(S.ui.op.map).map(x => x.seat) : S.ui.mo.seats);
  const spot = layoutOf(ev.seating).secs.find(g => g.sec.code === code)?.local.find(p => p.tt && !off.has(p.id) && !taken.has(p.id));
  if (!spot) return toast('No free spots left there', true);
  adminPickSeat(spot.id);
}
// ── Manual / admin orders (Stage 6 §6): exact seats, comps, price override, promo code, products, offline payment + method, send now or not ──
function ManualOrder() {
  const m = S.ui.mo ||= { ev: S.adm.events.filter(e => e.status === 'published')[0]?.id || S.adm.events[0]?.id, tt: '', qty: 1, slot: '', seats: [], adds: {}, name: '', email: '', phone: '', pay: 'cash', ref: '', send: true, code: '', price: '', comp: false, credit: '' };
  const ev = evById(m.ev), seated = !!ev?.seating?.enabled, slot = ev?.timeSlots?.length ? m.slot || ev.timeSlots[0].id : null;
  const tt = ev && (ev.ticketTypes.find(t => t.id === m.tt) || ev.ticketTypes[0]), cur = ev?.currency;
  let map = '', q = null, err = '';
  if (ev && seated) {
    const off = staffOff(ev, slot), lvs = levelsOf(ev.seating), lv = lvs.some(l => l.id === m.level) ? m.level : lvs[0].id;
    map = `<div class="card"><div class="between"><h3>Seats</h3><span class="small muted">${m.seats.length} selected — tap seats to add or remove · held seats can be sold by staff</span></div>
      ${lvs.length > 1 ? `<div class="tabs sm-levels">${lvs.map(l => `<button type="button" class="${lv === l.id ? 'on' : ''}" data-action="moLevel" data-v="${esc(l.id)}">${esc(l.name)}</button>`).join('')}</div>` : ''}
      <div class="sm-scroll">${SeatCanvas(ev, { off, mine: m.seats, level: lv })}</div>
      <div class="legend">${ev.ticketTypes.filter(t => Object.values(ev.seating.index || {}).includes(t.id)).map(t => `<span><i style="background:${tierColor(ev, t.id)}"></i>${esc(t.name)} ${money(t.price, cur)}</span>`).join('')}</div></div>`;
  }
  const items = ev ? seated ? [...new Set(m.seats.map(s => ev.seating.index[s]))].map(id => ({ eventId: ev.id, ticketTypeId: id, qty: m.seats.filter(s => ev.seating.index[s] === id).length, slotId: slot, seats: m.seats.filter(s => ev.seating.index[s] === id) }))
    : tt ? [{ eventId: ev.id, ticketTypeId: tt.id, qty: Math.max(1, +m.qty || 1), slotId: slot }] : [] : [];
  const price = !m.comp && String(m.price ?? '').trim() !== '' ? Math.round(parseFloat(m.price) * 100) : undefined;
  if (price !== undefined) items.forEach(i => { i.price = price; });
  const addons = Object.entries(m.adds || {}).filter(([, n]) => +n > 0).map(([id, n]) => ({ eventId: ev.id, addonId: id, qty: +n }));
  if (ev && (items.length || addons.length)) try { q = quote({ items, addons }, S.adm.events, pricingSettings(S.adm.bo, S.platform), null, { manual: true, avail: { [ev.id]: availabilityFrom(S.adm.tickets, ev.id, [], '', S.adm.orders) } }); } catch (e) { err = e.message; }
  const credits = (S.adm.credits || []).filter(c => c.email === String(m.email || '').trim().toLowerCase() && c.status === 'active' && (!c.event_id || c.event_id === ev?.id));
  S.ui.moItems = { items, addons };
  return `${m.pos ? head('Door sales', 'Sell at the door — cash, card or other. Tickets are issued at once and the seats leave the map immediately.') : `<a href="#/admin/orders" class="small muted" style="text-decoration:none">← Orders</a>${head('New manual order', 'Phone sales, box-office sales and complimentary tickets')}`}
  <div class="ord-grid"><div class="stack">
    <div class="card"><div class="grid2">${opRow('Event', `<select class="inp" data-input="mo.ev" data-rr="1">${evOptions(m.ev, 'Choose…')}</select>`)}
      ${ev?.timeSlots?.length ? opRow('Showtime', `<select class="inp" data-input="mo.slot" data-rr="1">${ev.timeSlots.map(s => `<option value="${s.id}" ${slot === s.id ? 'selected' : ''}>${esc(fmtDT(s.start))}</option>`).join('')}</select>`) : ''}</div>
      ${ev && !seated ? `<div class="grid2">${opRow('Ticket type', `<select class="inp" data-input="mo.tt" data-rr="1">${ev.ticketTypes.map(t => `<option value="${t.id}" ${tt?.id === t.id ? 'selected' : ''}>${esc(t.name)} — ${money(t.price, cur)}${t.adminOnly ? ' (box office only)' : ''}</option>`).join('')}</select>`)}${opRow('Quantity', `<input class="inp" type="number" min="1" data-input="mo.qty" data-rr="1" value="${esc(m.qty)}">`)}</div>` : ''}
      ${(ev?.addons || []).length ? `<div class="fl" style="margin-top:6px">Products & add-ons</div>${ev.addons.map(a => `<div class="between small line"><span>${esc(a.name)} · ${money(a.price, cur)}</span><input class="inp inp-sm" style="width:80px" type="number" min="0" data-action-change="moAdd" data-id="${a.id}" value="${esc(m.adds?.[a.id] || '')}" placeholder="0"></div>`).join('')}` : ''}</div>
    ${map}
  </div><div class="stack">
    <div class="card"><h3>Customer</h3><div class="field"><label class="fl">Name</label><input class="inp" data-input="mo.name" value="${esc(m.name)}"></div>
      <div class="grid2"><div class="field"><label class="fl">Email</label><input class="inp" data-input="mo.email" data-rr="1" value="${esc(m.email)}"></div><div class="field"><label class="fl">Phone</label><input class="inp" data-input="mo.phone" value="${esc(m.phone)}"></div></div></div>
    <div class="card"><h3>Price & payment</h3>
      ${ev && can('tickets.comps', ev.id) ? `<label class="check"><input type="checkbox" data-bind="ui.mo.comp" ${m.comp ? 'checked' : ''}> <span>Complimentary — free, keeps the real ticket type and face value</span></label>` : ''}
      ${!m.comp && ev && can('tickets.pricing', ev.id) ? opRow('Price override (each ticket)', `<input class="inp" type="number" min="0" step="0.01" data-input="mo.price" data-rr="1" value="${esc(m.price ?? '')}" placeholder="Normal price">`) : ''}
      ${!m.comp ? `<div class="grid2">${opRow('Promo code', `<input class="inp" data-input="mo.code" value="${esc(m.code)}" placeholder="optional">`)}${credits.length ? opRow('Use credit', `<select class="inp" data-input="mo.credit" data-rr="1"><option value="">No</option>${credits.map(c => `<option value="${c.id}" ${m.credit === c.id ? 'selected' : ''}>${esc(c.code)} · ${money(c.remaining)} left</option>`).join('')}</select>`) : ''}</div>
        ${m.pos ? PosPayment(m, q) : `<div class="grid2">${opRow('Paid by', `<select class="inp" data-input="mo.pay" data-rr="1">${Object.entries(PAY_METHODS).map(([k, t]) => `<option value="${k}" ${m.pay === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}${opRow('Payment reference', `<input class="inp" data-input="mo.ref" value="${esc(m.ref)}" placeholder="receipt / check no. / Zelle id">`)}</div>
        <div class="grid2">${opRow('Payment', `<select class="inp" data-input="mo.unpaid" data-rr="1"><option value="" ${!m.unpaid ? 'selected' : ''}>Paid now — issue tickets</option><option value="1" ${m.unpaid ? 'selected' : ''}>Unpaid (invoice) — hold seats, tickets when marked paid</option></select>`)}${opRow(m.unpaid ? 'Invoice date' : 'Date received', `<input class="inp" type="date" data-input="mo.date" value="${esc(m.date || localDay(new Date().toISOString()))}">`)}</div>
        ${opRow('Payment notes', `<input class="inp" data-input="mo.notes" value="${esc(m.notes || '')}" placeholder="e.g. paid by the company, net 30">`)}`}` : ''}
      ${q ? Breakdown(m.comp ? { ...q, ticketsTotal: 0, addonsTotal: 0, fee: 0, feeDiscount: 0, serviceFee: 0, tax: 0, discount: 0, total: 0 } : q, '') : `<p class="small muted">${esc(err || (seated ? 'Pick seats on the map.' : 'Choose tickets.'))}</p>`}
      ${m.pos ? `<div class="field" style="margin-top:10px"><label class="fl">Tickets</label><div class="seg">${[['print', 'Print / show'], ['email', 'Email'], ['text', 'Text'], ['none', 'None']].map(([k, t]) => `<button type="button" class="${m.deliver === k ? 'on' : ''}" data-action="moDeliver" data-v="${k}">${t}</button>`).join('')}</div></div>
        <button class="btn btn-accent btn-block btn-lg" style="margin-top:12px" data-action="posSell" ${q ? '' : 'disabled'}>${m.pay === 'card' && !m.comp ? 'Charge card' : 'Complete sale'}${q ? ' — ' + money(m.comp ? 0 : q.total, cur) : ''}</button>`
      : `<label class="check" style="margin-top:10px"><input type="checkbox" data-bind="ui.mo.send" ${m.send !== false ? 'checked' : ''}> <span>Send the tickets to the customer now</span></label>
      <button class="btn btn-accent btn-block" style="margin-top:12px" data-action="saveManual" ${q ? '' : 'disabled'}>Create order</button>`}</div>
  </div></div>`;
}
// The order confirmation: ONE email per order with every ticket and its Area / Row / Seat, plus one PDF of all tickets.
// the confirmation email exactly as the sender renders it (mailtpl.js): one email per order with every ticket
function OrderEmail(o) { return msgPreview({ kind: 'confirmation', channel: 'email', category: 'transactional', order_id: o.id, event_id: o.event_ids[0], email: o.buyer_email, to: o.buyer_email }); }
function Attendees() {
  const evId = S.ui.attEv || S.adm.events.filter(e => e.status === 'published').sort((a, b) => D(a.start) - D(b.start)).find(e => D(e.start) > Date.now())?.id || S.adm.events[0]?.id;
  S.ui.attEv = evId; const ev = evById(evId); const q = S.ui.q.trim().toLowerCase();
  const tks = S.adm.tickets.filter(t => t.event_id === evId && t.status === 'valid').map(t => ({ t, o: S.adm.orders.find(o => o.id === t.order_id), tt: ev?.ticketTypes.find(x => x.id === t.ticket_type_id), slot: ev?.timeSlots?.find(s => s.id === t.slot_id) }))
    .filter(r => !q || [r.t.holder, r.t.code, r.o?.ref, r.o?.buyer_email, r.t.seat].join(' ').toLowerCase().includes(q)).sort((a, b) => (a.t.holder || '').localeCompare(b.t.holder || ''));
  const inn = tks.filter(r => r.t.checked_in_at).length;
  return head('Door list', ev ? `${esc(ev.name)} · ${inn} of ${tks.length} checked in` : '', `<button class="btn btn-ghost" data-action="print">Print door list</button><button class="btn btn-ghost" data-action="exportAtt">Export CSV</button>`) + `
  <div class="toolbar no-print"><select class="inp" data-input="attEv">${evOptions(evId, 'Choose event')}</select><input class="inp" data-input="q" placeholder="Search name, code, seat…" value="${esc(S.ui.q)}"></div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Ticket</th><th>Seat / time</th><th>Code</th><th>Order</th><th>Checked in</th></tr></thead><tbody>
  ${tks.map(({ t, o, tt, slot }) => `<tr><td><b>${esc(t.holder)}</b><div class="small muted">${esc(o?.buyer_email || '')}</div></td><td>${esc(tt?.name || '')}</td><td>${esc(t.seat ? seatName(ev, t.seat, false, t) : (slot ? fmtTime(slot.start) : '—'))}</td><td class="tnum">${esc(t.code)}</td><td class="tnum">${esc(o?.ref || '')}${o?.status === 'pending' ? ' <span class="chip warn">unpaid</span>' : ''}</td>
    <td>${can(t.checked_in_at ? 'door.undo' : 'door.checkin', t.event_id) ? `<button class="btn btn-sm ${t.checked_in_at ? 'btn-dark' : 'btn-ghost'}" data-action="toggleIn" data-v="${esc(t.code)}" data-undo="${t.checked_in_at ? 1 : 0}">${t.checked_in_at ? '✓ ' + esc(fmtTime(t.checked_in_at)) : 'Check in'}</button>` : (t.checked_in_at ? '✓' : '')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No tickets yet.</td></tr>'}
  </tbody></table></div>`;
}
function CheckIn() {
  const url = location.origin + location.pathname + '#/scan';
  const evs = S.adm.events.filter(e => e.status === 'published' && D(e.end || e.start) >= Date.now() - 12 * 3600e3).sort((a, b) => D(a.start) - D(b.start));
  if (can('door.devices') && !S.ui.devs) { S.ui.devs = { loading: true }; DB.devices().then(r => { S.ui.devs = { list: r }; render(); }).catch(e => { S.ui.devs = { err: e.message }; render(); }); }
  const dv = S.ui.devs;
  return head('Scanner app', 'Check guests in at the door from any phone — no app store needed.', `<a class="btn btn-accent" href="#/scan" target="_blank">Open scanner ${ic('ext', 14)}</a>`) + `
  <div class="cols"><div class="stack">
    <div class="card"><div class="row" style="gap:22px;align-items:flex-start;flex-wrap:wrap"><div class="qr qr-sm" data-qr="${esc(url)}"></div>
      <div style="flex:1;min-width:220px"><h3>Put it on your door staff's phones</h3><ol class="steps"><li>Scan this code with the phone's camera.</li><li>Sign in with an email on the <a href="#/admin/team">Team</a> page (the <b>Scanner staff</b> template can only scan).</li><li>Pick the event, the entrance and a name for the device.</li><li>Tap <b>Share → Add to Home Screen</b> — it opens full-screen like a native app.</li></ol>
      <p class="small muted">Any number of phones, tablets or handheld scanners can scan the same event at once — they stay in sync, so a ticket is only let in once. Bluetooth/USB barcode scanners and typed codes work too, and it keeps working when the venue Wi-Fi drops.</p></div></div></div>
    <div class="card" style="padding:0"><div style="padding:18px 22px 8px"><h3>Live door status</h3></div><div style="overflow:auto"><table class="tbl"><thead><tr><th>Event</th><th>Starts</th><th style="width:40%">Checked in</th></tr></thead><tbody>
      ${evs.map(e => { const st = checkStats(e.id), by = byEntrance(e, st.tk); return `<tr><td><b>${esc(e.name)}</b>${can('door.log', e.id) ? `<div class="small"><a href="#/admin/event/${e.id}/door">Door & scan history →</a></div>` : ''}</td><td class="small">${esc(fmtDT(e.start))}</td><td><div class="between small"><span>${st.inn} / ${st.total}</span><span class="muted">${st.total ? Math.round(st.inn / st.total * 100) : 0}%</span></div><div class="bar"><i style="width:${st.total ? st.inn / st.total * 100 : 0}%;background:var(--accent)"></i></div>
        ${by.length > 1 ? `<div class="small muted" style="margin-top:4px">${by.map(x => `${esc(x.name)} ${x.n}`).join(' · ')}</div>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="3" class="muted">No upcoming events.</td></tr>'}
    </tbody></table></div></div>
    ${can('door.devices') ? `<div class="card" style="padding:0"><div style="padding:18px 22px 4px"><h3>Scanner devices</h3><p class="small muted" style="margin-top:4px">Every phone, tablet or handheld that has scanned for this box office. Switch one off if it's lost — it stops accepting tickets at once.</p></div>
      <div class="tbl-wrap" style="border:0;box-shadow:none;border-radius:0"><table class="tbl"><thead><tr><th>Device</th><th>Entrance</th><th>Last used</th><th>Scans</th><th>Status</th><th></th></tr></thead><tbody>
      ${dv?.loading ? '<tr><td colspan="6" class="muted small">Loading…</td></tr>' : dv?.err ? `<tr><td colspan="6" class="small" style="color:var(--bad)">${esc(dv.err)}</td></tr>`
        : (dv?.list || []).sort((a, b) => D(b.last_seen) - D(a.last_seen)).map(d => `<tr class="${d.disabled ? 'dimrow' : ''}"><td style="white-space:nowrap">${S.ui.devEdit === d.id ? `<div class="row"><input class="inp" data-input="devName" value="${esc(S.ui.devName ?? d.name)}" style="max-width:180px"><button class="btn btn-dark btn-sm" data-action="devSave" data-id="${esc(d.id)}">Save</button></div>` : `<b>${esc(d.name)}</b>`}</td>
          <td class="small">${esc(d.entrance || '—')}</td><td class="small">${esc(fmtDT(d.last_seen))}<div class="muted">${esc(d.last_by || '')}</div></td><td class="tnum">${d.scans || 0}</td>
          <td>${d.disabled ? '<span class="chip bad mini">switched off</span>' : '<span class="chip ok mini">active</span>'}</td>
          <td><div class="row" style="justify-content:flex-end;gap:6px;flex-wrap:nowrap">${S.ui.devEdit === d.id ? '' : `<button class="btn btn-ghost btn-sm" data-action="devEdit" data-id="${esc(d.id)}">Rename</button>`}<button class="btn btn-ghost btn-sm" data-action="devToggle" data-id="${esc(d.id)}" data-v="${d.disabled ? 'enable' : 'disable'}">${d.disabled ? 'Switch on' : 'Switch off'}</button><button class="btn btn-ghost btn-sm" data-action="devForget" data-id="${esc(d.id)}">Remove</button></div></td></tr>`).join('') || '<tr><td colspan="6" class="muted small">No devices yet — they appear here after their first scan.</td></tr>'}
      </tbody></table></div></div>` : ''}
  </div><div><div class="phone"><iframe src="${esc(location.pathname)}#/scan" title="Scanner app preview" allow="camera"></iframe></div><p class="small muted" style="text-align:center;margin-top:10px">Live preview — this is the real app.</p></div></div>`;
}
async function doCheckin(code, undo) {
  try { const r = await DB.checkin(code, undo, null, { manual: true, device: 'backoffice', deviceName: 'Back office' }); applyTicket(r); render(); } catch (e) { toast(e.message, true); }
}
function applyTicket(r) { if (!r?.ticket?.id) return; const t = S.adm.tickets.find(x => x.id === r.ticket.id); if (t) { t.checked_in_at = r.ticket.checked_in_at; t.checkin = r.ticket.checkin; } }
const checkStats = (evId, slot) => { const tk = S.adm.tickets.filter(t => t.event_id === evId && t.status === 'valid' && (!slot || t.slot_id === slot)); return { tk, total: tk.length, inn: tk.filter(t => t.checked_in_at).length }; };
// checked-in counts per entrance (+ scans made before entrances were set up / by the back office)
const byEntrance = (ev, tk) => { const c = {}; tk.filter(t => t.checked_in_at).forEach(t => { const k = t.checkin?.entrance || ''; c[k] = (c[k] || 0) + 1; });
  return [...(ev.entrances || []).map(e => ({ name: e.name, n: c[e.name] || 0, en: e })), ...Object.keys(c).filter(k => !(ev.entrances || []).some(e => e.name === k)).map(k => ({ name: k || 'No entrance', n: c[k] }))]; };
// What the scanner shows for a ticket — the server's door view, or (offline / back office) the same fields from local data.
function doorView(t) {
  if (!t) return null; const ev = evById(t.event_id), tt = ev?.ticketTypes.find(x => x.id === t.ticket_type_id), o = S.adm.orders.find(x => x.id === t.order_id);
  const sibs = S.adm.tickets.filter(x => x.order_id === t.order_id && x.status === 'valid'), sp = t.seat && t.area == null ? seatParts(ev, t.seat, t) : null;
  return { ...t, type: t.type || tt?.name || '', admits: t.admits || Math.max(1, +tt?.admits || 1), event_name: t.event_name || ev?.name || '', event_start: t.event_start || ev?.start,
    slot_start: t.slot_start || (t.slot_id && ev?.timeSlots?.find(x => x.id === t.slot_id)?.start) || null, order_ref: t.order_ref || o?.ref || '',
    of: t.of ?? sibs.length, no: t.no ?? sibs.indexOf(t) + 1, ...(sp ? { area: sp.area, row: sp.row, seat_label: sp.seat, unit: sp.unit } : {}) };
}

// ══════════════════════════════════════════════════════════════════════════════
//  DOOR SCANNER APP  (#/scan — phone-first, installable, works offline)
// ══════════════════════════════════════════════════════════════════════════════
// This device: a random id + a name staff choose ("Door phone 1"). Admins see it on the Scanner app page and can switch it off.
function scanDev() {
  let d = null; try { d = JSON.parse(localStorage.getItem('set_scan_device')); } catch (e) { }
  if (!d?.id) { const ua = navigator.userAgent, kind = /iPad|Tablet/i.test(ua) ? 'Tablet' : /iPhone|Android|Mobile/i.test(ua) ? 'Phone' : 'Scanner';
    d = { id: 'dev_' + randCode(12).toLowerCase(), name: kind + ' ' + randCode(3) }; try { localStorage.setItem('set_scan_device', JSON.stringify(d)); } catch (e) { S.sc._dev = d; } }
  return S.sc._dev || d;
}
const scanEntrance = ev => (ev?.entrances || []).find(e => e.id === S.sc.entrance) || null;
const scanOpts = (extra = {}) => { const d = scanDev(), en = scanEntrance(evById(S.sc.evId)); return { slot: S.sc.slot || null, entrance: en?.id || null, entranceName: en?.name || '', device: d.id, deviceName: d.name, ...extra }; };
function saveScanCtx() { try { localStorage.setItem('set_scan_ctx', JSON.stringify({ evId: S.sc.evId, entrance: S.sc.entrance, slot: S.sc.slot })); } catch (e) { } }
// the showtime on now / next (timed-entry events)
const nearSlot = ev => { const sl = (ev.timeSlots || []).filter(s => !s.hidden); if (!sl.length) return ''; const now = Date.now();
  return (sl.filter(s => D(s.start) - now < 45 * 6e4).sort((a, b) => D(b.start) - D(a.start))[0] || sl.slice().sort((a, b) => D(a.start) - D(b.start))[0]).id; };
function ScanApp() {
  if (!S.user || S.user.mfa || !S.adm) return Login('Door staff sign in', 'start scanning tickets');
  if (!S.adm.bo || S.adm.blocked) return AdminShell();
  if (S.adm.needs2fa) return Gate('Two-factor required', 'Set up two-factor sign-in in the back office (My security) before scanning.');
  if (!can('door.scan')) return Gate('No scanner access', 'Ask a box office admin to give you the “Scan tickets” permission.');
  const ev = S.adm.events.find(e => e.id === S.sc.evId);
  const setup = ev && (S.sc.setup || (ev.entrances?.length && S.sc.entrance == null) || (ev.timeSlots?.length && S.sc.slot == null));
  return `<div class="sc">${!ev ? ScanPick() : setup ? ScanSetup(ev) : ScanEvent(ev)}</div>${S.sc.last ? ScanResult(S.sc.last) : ''}`;
}
function ScanPick() {
  const today = new Date().toDateString();
  const evs = S.adm.events.filter(e => e.status === 'published' && D(e.end || e.start) >= Date.now() - 12 * 3600e3).sort((a, b) => D(a.start) - D(b.start));
  return `<header class="sc-top"><div class="sc-logo">${logo()}</div><span class="sc-badge">Scanner</span><span style="flex:1"></span>${can('events.view') ? '<a href="#/admin" class="sc-link">Box office</a>' : ''}</header>
  <div class="sc-pad"><div class="sc-eyebrow">Choose an event</div><h1 class="sc-h">Who's coming in?</h1>
  ${evs.map(e => { const st = checkStats(e.id), tonight = D(e.start).toDateString() === today;
    return `<button class="sc-ev" data-action="scPick" data-id="${e.id}"><div class="sc-ev-art" style="${artBg(e)}"></div><div class="sc-ev-body">
      <div class="row" style="gap:6px">${tonight ? '<span class="chip gold">Tonight</span>' : ''}<span class="sc-dim">${esc(fmtDT(e.start))}</span></div>
      <b>${esc(e.name)}</b><span class="sc-dim">${esc(e.venue || '')}</span>
      <div class="sc-bar"><i style="width:${st.total ? st.inn / st.total * 100 : 0}%"></i></div><span class="sc-dim">${st.inn} of ${st.total} checked in</span></div><span class="sc-chev">›</span></button>`; }).join('') || '<p class="sc-dim">No upcoming events.</p>'}
  </div><div class="sc-foot"><span>${esc(S.user.email)} · ${esc(scanDev().name)}</span><a href="#" data-action="signOut">Sign out</a></div>`;
}
// Once per event on this device: which door, which showtime, what the device is called.
function ScanSetup(ev) {
  const pk = S.sc.pick ||= { entrance: S.sc.entrance ?? (ev.entrances?.[0]?.id || ''), slot: S.sc.slot ?? nearSlot(ev), name: scanDev().name };
  const opt = (k, v, label, sub = '') => `<button class="sc-opt ${pk[k] === v ? 'on' : ''}" data-action="scSet" data-k="${k}" data-v="${esc(v)}"><b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</button>`;
  const takes = en => [...(en.ticketTypeIds || []).map(id => ev.ticketTypes.find(t => t.id === id)?.name).filter(Boolean), ...(en.areas || [])].join(', ');
  return `<header class="sc-top"><button class="sc-back" data-action="scBack" aria-label="All events">‹</button><div class="sc-title"><b>${esc(ev.name)}</b><span>${esc(fmtDT(ev.start))}</span></div></header>
  <div class="sc-pad"><div class="sc-eyebrow">Set up this scanner</div><h1 class="sc-h">Where are you scanning?</h1>
    ${ev.entrances?.length ? `<div class="sc-eyebrow" style="margin-top:6px">Entrance</div><div class="sc-opts">${ev.entrances.map(en => opt('entrance', en.id, en.name, takes(en) ? 'Only ' + takes(en) : 'Everyone')).join('')}${opt('entrance', '', 'Not at a specific entrance', 'Accept every ticket')}</div>` : ''}
    ${ev.timeSlots?.length ? `<div class="sc-eyebrow" style="margin-top:16px">Showtime</div><div class="sc-opts">${ev.timeSlots.map(s => opt('slot', s.id, fmtTime(s.start), s.label || fmtDate(s.start, { weekday: 'short', month: 'short', day: 'numeric' }))).join('')}${opt('slot', '', 'All showtimes', 'Don\'t check the time')}</div>` : ''}
    <div class="sc-eyebrow" style="margin-top:16px">This device</div><div class="sc-search"><input data-input="sc.devName" value="${esc(pk.name)}" placeholder="e.g. Door phone 1" maxlength="60" autocomplete="off"></div>
    <p class="sc-dim" style="font-size:12px;margin-top:6px">Shown in the scan history so the box office knows which phone let each guest in.</p>
    <button class="btn btn-accent btn-lg btn-block" style="margin-top:20px" data-action="scSetupDone">Start scanning</button></div>`;
}
function ScanEvent(ev) {
  const st = checkStats(ev.id, S.sc.slot), tab = S.sc.tab, on = navigator.onLine, en = scanEntrance(ev), slot = S.sc.slot && ev.timeSlots?.find(s => s.id === S.sc.slot);
  return `<header class="sc-top"><button class="sc-back" data-action="scBack" aria-label="All events">‹</button>
    <div class="sc-title"><b>${esc(ev.name)}</b><span>${esc(slot ? fmtTime(slot.start) + ' showtime' : fmtTime(ev.start))}${en ? ' · ' + esc(en.name) : ev.venue ? ' · ' + esc(ev.venue) : ''}</span></div>
    <span class="sc-net ${on ? '' : 'off'}">${ic('wifi', 13)} ${on ? 'Online' : 'Offline'}${S.sc.queue.length ? ' · ' + S.sc.queue.length + ' queued' : ''}</span>
    <button class="sc-gear" data-action="scSetup" aria-label="Scanner settings">${ic('gear', 18)}</button></header>
  <div class="sc-count"><div><span class="n">${st.inn.toLocaleString()}</span><span class="d"> / ${st.total.toLocaleString()} checked in</span></div><span class="d">${(st.total - st.inn).toLocaleString()} to come · ${st.total ? Math.round(st.inn / st.total * 100) : 0}%</span></div>
  <div class="sc-progress"><i style="width:${st.total ? st.inn / st.total * 100 : 0}%"></i></div>
  <main class="sc-body">${tab === 'guests' ? ScanGuests(ev, st) : tab === 'stats' ? ScanStats(ev, st) : ScanCam()}</main>
  <nav class="sc-tabs">${[['scan', 'Scan', 'scan'], ['guests', 'Find guest', 'search'], ['stats', 'Totals', 'chart']].map(([k, t, i]) => `<button class="${tab === k ? 'on' : ''}" data-action="scTab" data-v="${k}">${ic(i, 21)}<span>${t}</span></button>`).join('')}</nav>`;
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
// [title, colour] for every answer the server can give
const RES = { ok: ['Valid', 'ok'], already: ['Already scanned', 'warn'], undone: ['Check-in undone', 'info'], paused: ['Scanning stopped', 'bad'], unknown: ['Invalid QR code', 'bad'], cancelled: ['Ticket cancelled', 'bad'],
  refunded: ['Ticket refunded', 'bad'], replaced: ['Replaced ticket', 'bad'], wrong_event: ['Wrong event', 'bad'], wrong_slot: ['Wrong showtime', 'bad'], wrong_entrance: ['Wrong entrance', 'warn'],
  inactive: ['Ticket not active', 'bad'], device_off: ['Scanner switched off', 'bad'], item_ok: ['Redeemed', 'ok'], item_used: ['Already redeemed', 'warn'], item_void: ['Voucher not valid', 'bad'] };
const RES_TITLE = Object.fromEntries(Object.entries(RES).map(([k, v]) => [k, v[0]]));
const resKind = r => RES[r]?.[1] || 'bad';
function ScanResult(r) {
  if (r.item) return ScanItem(r);   // §11 a product voucher (parking, drink, merchandise …)
  const kind = resKind(r.result), t = doorView(r.ticket), show = t && !['unknown', 'wrong_event', 'device_off'].includes(r.result);
  const sp = t?.seat ? { area: t.area || '', row: t.row || '', seat: t.seat_label || '', unit: t.unit || '' } : null, lines = sp ? seatLines(sp) : t ? [t.type || 'General admission'] : [];
  const f = r.first || {}, note = {
    already: `First scanned at ${fmtTime(f.at || t?.checked_in_at)}${f.entrance ? ' · ' + f.entrance : ''}${f.device_name ? ' · ' + f.device_name : ''}`,
    replaced: 'This ticket was reissued, so this QR code no longer works. Ask the guest for their updated ticket (it was emailed to them).',
    cancelled: 'This ticket was cancelled and can\'t be used.', refunded: 'This ticket was refunded and can\'t be used.',
    wrong_event: t ? `This ticket is for ${t.event_name} · ${fmtDT(t.slot_start || t.event_start)}` : '',
    wrong_slot: t?.slot_start ? `This ticket is for the ${fmtTime(t.slot_start)} showtime (${fmtDate(t.slot_start, { weekday: 'short', month: 'short', day: 'numeric' })})` : '',
    wrong_entrance: r.entrances?.length ? 'Send this guest to the ' + r.entrances.join(' or ') : 'This entrance doesn\'t take this ticket',
    inactive: 'The order isn\'t paid or the event is closed — send the guest to the box office.',
    unknown: 'Not a ticket for this box office. Check the code, or look the guest up under Find guest.',
    device_off: 'An admin switched this scanner off. Ask a manager to switch it back on.' }[r.result];
  return `<div class="sc-result ${kind}" ${r.result === 'wrong_entrance' ? '' : 'data-action="scDismiss"'} role="alert"><div class="sc-res-icon">${ic(kind === 'ok' ? 'check' : kind === 'bad' ? 'x' : 'alert', 50)}</div>
    <div class="sc-res-t">${esc(RES_TITLE[r.result])}</div>
    ${show ? `${sp ? `<div class="sc-res-type">${esc(t.type)}${t.comp ? ' · Comp' : ''}</div>` : ''}<div class="sc-seat">${lines.map(l => `<div>${esc(l)}</div>`).join('')}</div>
      ${t.admits > 1 ? `<div class="sc-res-type">Admits ${t.admits}</div>` : ''}<div class="sc-res-name">${esc(t.holder || '')}</div>
      <div class="sc-res-code">${esc(t.code)}${t.order_ref ? ' · ' + esc(t.order_ref) : ''}${t.of > 1 ? ` · <span style="white-space:nowrap">ticket ${t.no} of ${t.of}</span>` : ''}</div>` : `<div class="sc-res-code">${esc(r.code || '')}</div>`}
    ${note ? `<div class="sc-res-note">${esc(note)}</div>` : ''}
    ${r.result === 'ok' && t?.due ? '<div class="sc-res-note">Balance due on this order — ask the guest to see the box office</div>' : ''}
    ${r.override ? '<div class="sc-res-note">Let in here by override</div>' : ''}
    ${r.offline ? '<div class="sc-res-note">Saved offline — syncs when back online</div>' : ''}
    <div class="sc-res-actions">${r.result === 'ok' && can('door.undo', t?.event_id) ? `<button class="btn glass" data-action="scUndo" data-v="${esc(t.code)}">Undo</button>` : ''}${r.result === 'wrong_entrance' && can('door.override', t?.event_id) ? `<button class="btn glass" data-action="scOverride" data-v="${esc(t.code)}">Let in anyway</button>` : ''}<button class="btn sc-next" data-action="scDismiss">Next scan</button></div></div>`;
}
// Find a guest whose QR won't scan: by name, email, phone, order number or ticket number. Staff with “Look up guests” search the
// server (email / phone / order); everyone else searches the names, codes and seats already on the phone.
function ScanGuests(ev, st) {
  const q = S.sc.q.trim().toLowerCase(), f = S.sc.filter, deep = can('door.search', ev.id) && q.length >= 2;
  if (deep && S.sc.foundQ !== q) scanSearch(ev.id, q);
  const ref = t => doorView(t).order_ref, hit = t => !q || [t.holder, t.code, ref(t), t.seat && seatName(ev, t.seat, true, t)].join(' ').toLowerCase().includes(q);
  const found = deep && S.sc.foundQ === q ? (S.sc.found || []).map(x => S.adm.tickets.find(t => t.id === x.id) || x) : [];
  const rows = [...new Map([...found, ...st.tk.filter(hit)].map(t => [t.id, t])).values()].filter(t => t.status === 'valid' && (f === 'all' || (f === 'in') === !!t.checked_in_at))
    .sort((a, b) => (a.holder || '').localeCompare(b.holder || ''));
  return `<div class="sc-pad"><div class="sc-search">${ic('search', 17)}<input data-input="sc.q" placeholder="${can('door.search', ev.id) ? 'Name, email, phone, order or ticket no.' : 'Name, ticket code or seat'}" value="${esc(S.sc.q)}" autocomplete="off"></div>
    <div class="sc-chips">${[['all', 'All ' + st.total], ['out', 'Not in ' + (st.total - st.inn)], ['in', 'In ' + st.inn]].map(([k, t]) => `<button class="${f === k ? 'on' : ''}" data-action="scFilter" data-v="${k}">${t}</button>`).join('')}</div>
    ${rows.slice(0, 250).map(t => { const v = doorView(t);
      return `<div class="sc-guest"><div><b>${esc(t.holder)}</b><span>${esc(v.type)}${t.seat ? ' · ' + esc(seatName(ev, t.seat, true, t)) : ''} · ${esc(t.code)}${v.order_ref ? ' · ' + esc(v.order_ref) : ''}</span></div>
        ${can(t.checked_in_at ? 'door.undo' : 'door.checkin', ev.id) || !t.checked_in_at ? `<button class="sc-tick ${t.checked_in_at ? 'on' : ''}" data-action="scToggle" data-v="${esc(t.code)}" data-undo="${t.checked_in_at ? 1 : 0}">${t.checked_in_at ? ic('check', 15) + ' ' + esc(fmtTime(t.checked_in_at)) : 'Check in'}</button>` : `<span class="sc-tick on">${ic('check', 15)} ${esc(fmtTime(t.checked_in_at))}</span>`}</div>`; }).join('') || `<p class="sc-dim" style="padding:20px 0">${deep && S.sc.foundQ === q && !S.sc.found ? 'Searching…' : 'No guests match.'}</p>`}</div>`;
}
let _srch = 0;
function scanSearch(evId, q) {
  S.sc.foundQ = q; S.sc.found = null; clearTimeout(_srch);
  _srch = setTimeout(async () => { try { const r = await DB.doorSearch(evId, q); if (S.sc.foundQ === q) { S.sc.found = r; mergeDoor(r); render(); } } catch (e) { S.sc.found = []; render(); } }, 220);
}
function ScanStats(ev, st) {
  const pct = st.total ? st.inn / st.total : 0, R = 70, C = 2 * Math.PI * R;
  const byTT = ev.ticketTypes.map(t => { const a = st.tk.filter(x => x.ticket_type_id === t.id); return { t, n: a.length, i: a.filter(x => x.checked_in_at).length }; }).filter(x => x.n);
  const now = Date.now(), bins = Array.from({ length: 12 }, (_, i) => ({ from: now - (12 - i) * 15 * 6e4, v: 0 }));
  st.tk.forEach(t => { if (!t.checked_in_at) return; const ts = D(t.checked_in_at).getTime(), b = bins.find(b => ts >= b.from && ts < b.from + 15 * 6e4); if (b) b.v++; });
  const mx = Math.max(1, ...bins.map(b => b.v)), ents = byEntrance(ev, st.tk);
  return `<div class="sc-pad">
    <div class="sc-ring"><svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="${R}" class="trk"/><circle cx="90" cy="90" r="${R}" class="val" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"/></svg><div><b>${Math.round(pct * 100)}%</b><span>checked in</span></div></div>
    <div class="sc-kpis"><div><b>${st.total.toLocaleString()}</b><span>Tickets</span></div><div><b>${st.inn.toLocaleString()}</b><span>Scanned in</span></div><div><b>${(st.total - st.inn).toLocaleString()}</b><span>Remaining</span></div></div>
    ${ents.length ? `<div class="sc-card"><div class="sc-eyebrow">By entrance</div>${ents.map(x => `<div class="between" style="margin-top:10px"><span>${esc(x.name)}</span><b>${x.n}</b></div>`).join('')}</div>` : ''}
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
async function scanCheck(code, undo = false, quiet = false, extra = {}) {
  code = String(code).trim().toUpperCase(); if (!code) return;
  const o = scanOpts(extra);
  let r;
  try { if (DB.live && !navigator.onLine) throw new TypeError('offline'); r = await DB.checkin(code, undo, S.sc.evId || null, o); }
  catch (e) { if (!(e instanceof TypeError)) return toast(e.message, true); r = localCheckin(code, undo, o); }   // network down → validate locally, queue
  applyTicket(r); r.code = code; r.at = Date.now();
  S.sc.recent.unshift(r); S.sc.recent.length = Math.min(S.sc.recent.length, 30); feedback(resKind(r.result) === 'ok' ? 'ok' : r.result === 'already' ? 'already' : 'bad');
  if (quiet) { toast((r.ticket?.holder || code) + ' — ' + RES_TITLE[r.result], resKind(r.result) === 'bad'); return render(); }
  S.sc.last = r; render();
  clearTimeout(_resTimer); if (r.result !== 'wrong_entrance') _resTimer = setTimeout(() => { if (S.sc.last === r) { S.sc.last = null; render(); } }, r.result === 'ok' ? 1700 : 3800);
}
// Offline: the same checks against what this phone last synced; check-ins queue and go to the server when the network is back.
function localCheckin(code, undo, o) {
  const t = S.adm.tickets.find(x => x.code === code), ev = evById(S.sc.evId), en = scanEntrance(ev), res = (result, more = {}) => ({ result, ticket: t ? { ...t } : null, offline: true, ...more });
  if (!t) return { result: 'unknown', offline: true };
  if (S.sc.evId && t.event_id !== S.sc.evId) return res('wrong_event');
  if (t.status === 'replaced') return res('replaced');
  if (t.status !== 'valid') return res(t.refunded > 0 ? 'refunded' : 'cancelled');
  if (S.sc.slot && t.slot_id && t.slot_id !== S.sc.slot) return res('wrong_slot');
  const tk = { ...t, area: doorView(t).area };
  if (!undo && !t.checked_in_at && en && !entranceTakes(en, tk) && !o.override) return res('wrong_entrance', { entrances: (ev.entrances || []).filter(x => entranceTakes(x, tk)).map(x => x.name) });
  const was = t.checked_in_at;
  if (!was || undo) { S.sc.queue.push({ code, undo, ev: S.sc.evId, o }); saveQueue(); }
  if (was && !undo) return res('already', { first: { at: was, ...(t.checkin || {}) } });
  return res(undo ? 'undone' : 'ok', { ticket: { ...t, checked_in_at: undo ? null : new Date().toISOString(), checkin: undo ? null : { entrance: o.entranceName, device: o.device, device_name: o.deviceName, by: S.user?.email } } });
}
function loadQueue() { try { return JSON.parse(localStorage.getItem('set_scan_queue')) || []; } catch (e) { return []; } }
function saveQueue() { try { localStorage.setItem('set_scan_queue', JSON.stringify(S.sc.queue)); } catch (e) { } }
async function flushQueue() {
  while (S.sc.queue.length && navigator.onLine) { const q = S.sc.queue[0]; try { await DB.checkin(q.code, q.undo, q.ev || null, q.o || {}); S.sc.queue.shift(); saveQueue(); } catch (e) { break; } }
  if (S.route.page === 'scan') render();
}
window.addEventListener('online', flushQueue);
window.addEventListener('offline', () => { if (S.route.page === 'scan') render(); });
// Every scanner pulls the event's tickets every few seconds, so a cancel, seat move, upgrade or reissue in the back office — or a check-in on
// another phone — shows up here almost at once. (The scan itself is always decided by the server, so this only keeps the screen current.)
const DOOR_KEYS = ['status', 'checked_in_at', 'checkin', 'seat', 'area', 'row', 'seat_label', 'unit', 'ticket_type_id', 'slot_id', 'holder', 'code'];
function mergeDoor(list) {
  let changed = false; const by = new Map(S.adm.tickets.map(t => [t.id, t]));
  for (const x of list || []) {
    const t = by.get(x.id); if (!t) { S.adm.tickets.push({ ...x, box_office_id: S.adm.bo.id }); changed = true; continue; }
    for (const k of DOOR_KEYS) if (JSON.stringify(t[k] ?? null) !== JSON.stringify(x[k] ?? null)) { t[k] = x[k] ?? null; changed = true; }
  }
  return changed;
}
async function doorTick() {
  if (S.route.page !== 'scan' || !S.sc.evId || !S.adm?.bo || document.hidden || (DB.live && !navigator.onLine) || S.sc.syncing) return;
  S.sc.syncing = true;
  const ev = S.sc.evId, since = S.sc.syncEv === ev ? S.sc.syncAt : null;
  try { const r = await DB.doorSync(ev, since); if (S.sc.evId !== ev) return; S.sc.syncEv = ev; S.sc.syncAt = r.at; if (mergeDoor(r.tickets)) render(); } catch (e) { } finally { S.sc.syncing = false; }
}
setInterval(doorTick, 4000);
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

// ── Reports, money & exports (Stage 9) ───────────────────────────────────────
// Every figure comes from finReport() in data.js (the orders' and tickets' own stored money). The server already masked what this person
// may not see (money, fees, processing, customer details), so a report or export can never show more than the back office does.
const REP_TABS = [['overview', 'Overview', 'finance.reports'], ['events', 'Events', 'finance.reports'], ['payouts', 'Payouts & reconciliation', 'finance.payouts'], ['profit', 'Profitability', 'finance.reports|finance.expenses'],
  ['exports', 'Export center', 'finance.export|customers.export'], ['accounting', 'Accounting', 'finance.export']];
const tabOk = t => t[2].split('|').some(k => can(k));
const finX = () => S.adm._fin || (S.adm._fin = { events: S.adm.events, orders: S.adm.orders, tickets: S.adm.tickets, statuses: S.adm.seatStatus || [], expenses: S.adm.expenses || [], expenseFinal: S.adm.expenseFinal || {} });
const repF = () => (S.ui.rep ||= emptyFin());
const finRep = (f = repF()) => finReport(finX(), f);
const $$ = c => c == null || c === '' ? '' : Math.round(c) / 100;
const pctTxt = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—';
const ttName = (evId, id) => evById(evId)?.ticketTypes.find(t => t.id === id)?.name || id;
const addonName = id => { for (const e of S.adm.events) { const a = (e.addons || []).find(x => x.id === id); if (a) return a.name; } return id; };
const bundleName = id => { for (const e of S.adm.events) { const b = (e.bundles || []).find(x => x.id === id); if (b) return b.name; } return id; };
const slotName = (evId, id) => { const s = evById(evId)?.timeSlots?.find(x => x.id === id); return s ? fmtDT(s.start) : id; };
function FinFilters(keys = ['eventId', 'slotId', 'from', 'to', 'ttId', 'area', 'price', 'promo', 'tracking', 'addonId', 'bundleId', 'method']) {
  const f = repF(), ev = evById(f.eventId), sel = (k, label, opts) => keys.includes(k) && opts.length ? `<label class="ff"><span>${label}</span><select class="inp" data-action-change="repSet" data-k="${k}"><option value="">All</option>${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(f[k]) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>` : '';
  const evs = ev ? [ev] : S.adm.events, areas = [...new Set(evs.flatMap(e => e.seating?.enabled ? Object.values(e.seating.meta || {}).map(m => m[0]).filter(Boolean) : []))].sort();
  const prices = [...new Set(evs.flatMap(e => e.ticketTypes.map(t => +t.price || 0)))].sort((a, b) => a - b);
  return `<div class="fin-filters">
    <label class="ff"><span>Event</span><select class="inp" data-action-change="repSet" data-k="eventId">${evOptions(f.eventId)}</select></label>
    ${sel('slotId', 'Showtime', (ev?.timeSlots || []).map(s => [s.id, fmtDT(s.start)]))}
    ${keys.includes('from') ? `<label class="ff"><span>From</span><input class="inp" type="date" value="${esc(f.from)}" data-action-change="repSet" data-k="from"></label><label class="ff"><span>To</span><input class="inp" type="date" value="${esc(f.to)}" data-action-change="repSet" data-k="to"></label>` : ''}
    ${sel('ttId', 'Ticket type', ev ? ev.ticketTypes.map(t => [t.id, t.name]) : [])}
    ${sel('area', 'Seating area', areas.map(a => [a, a]))}
    ${sel('price', 'Price level', prices.map(p => [p, money(p)]))}
    ${sel('promo', 'Promo code', (S.adm.promos || []).map(p => [p.code, p.code]))}
    ${sel('tracking', 'Tracking code', (S.adm.tracking || []).map(t => [t.code, t.code + (t.name ? ' — ' + t.name : '')]))}
    ${sel('addonId', 'Product', evs.flatMap(e => (e.addons || []).map(a => [a.id, a.name + (ev ? '' : ' · ' + e.name)])))}
    ${sel('bundleId', 'Package', evs.flatMap(e => (e.bundles || []).map(b => [b.id, b.name + (ev ? '' : ' · ' + e.name)])))}
    ${sel('method', 'Payment method', Object.entries(PAY_LABEL))}
    ${keys.includes('customer') ? `<label class="ff"><span>Customer email</span><input class="inp" value="${esc(f.customer)}" placeholder="name@…" data-action-change="repSet" data-k="customer"></label>` : ''}
    ${Object.entries(f).some(([k, v]) => v !== '' && keys.concat('eventId').includes(k)) ? `<button class="btn btn-ghost btn-sm" data-action="repClear">Clear filters</button>` : ''}</div>`;
}
// Eli's event financial dashboard (Step 9 §3), for any filter: from potential sellout down to what the box office keeps.
function FinDash(t, o = {}) {
  const proc = can('finance.processing'), plat = can('finance.fees'), L = (label, v, cls = '', note = '') => `<div class="sum-line ${cls}"><span>${label}${note ? ` <span class="small muted">${note}</span>` : ''}</span><span class="tnum">${v}</span></div>`;
  const neg = c => c ? '−' + money(c) : money(0), opt = (label, c, sign = '') => c ? L(label, (sign === '-' ? '−' : c < 0 ? '−' : '') + money(Math.abs(c))) : '';
  return `<div class="card fin-dash"><div class="between"><h3>${esc(o.title || 'Financial summary')}</h3>${o.partial ? '<span class="chip mini warn">tickets / products matching the filter only</span>' : ''}</div>
    ${o.potential === false ? '' : L('Potential sellout revenue', money(t.potential), 'muted-line', `remaining ${money(t.remaining)}`)}
    <div class="sep"></div>
    ${L('Gross ticket value sold', money(t.tface))}${opt('Products & add-ons', t.pface)}${opt('Memberships & passes sold', t.passRev)}${opt('Gift cards sold', t.giftSold)}
    ${L('Discounts', neg(t.discount))}${opt('Package savings & price overrides', t.savings, t.savings > 0 ? '-' : '')}
    ${L('Complimentary ticket value', money(t.comp), 'muted-line', `${t.comps} comp ticket${t.comps === 1 ? '' : 's'} — not collected`)}
    ${L('Booking fees collected', money(t.fees))}${L('Sales tax', money(t.tax))}
    ${opt('Other fees (facility, levies…)', t.otherFee)}${opt('Donations', t.donation)}${opt('Card fees paid by buyers', t.cardFee)}${opt('Paid with credit', -t.creditUsed, '-')}${opt('Order changes & adjustments', t.changes)}
    ${L('Collected', money(t.collected), 'sub')}
    ${L('Refunds', neg(t.refunds))}${opt('Refunded as credit', t.credits, '-')}${opt('Chargebacks', t.chargebacks, '-')}
    ${proc ? L('Processing fees', neg(t.processing)) : L('Processing fees', '<span class="muted">hidden</span>')}
    ${L(proc ? 'Net collected' : 'Net (before card processing)', money(t.net), 'total')}
    ${o.partial ? '' : plat ? `${opt('Platform fee', t.platform, '-')}${t.platform ? L('Net to the box office', money(t.netBo), 'sub') : ''}` : ''}
    <div class="small muted" style="margin-top:10px">${t.orders} order${t.orders === 1 ? '' : 's'} · ${t.sold} ticket${t.sold === 1 ? '' : 's'} valid${t.offline ? ` · ${money(t.offline)} paid offline / manually` : ''}${t.unpaid ? ` · <span style="color:var(--warn)">${money(t.unpaid)} unpaid (${t.unpaidOrders} pay-later)</span>` : ''}${t.failedPayments ? ` · ${t.failedPayments} failed payment attempt${t.failedPayments === 1 ? '' : 's'}` : ''}</div></div>`;
}
const FIN_COLS = [['orders', 'Orders', 0], ['sold', 'Tickets', 0], ['tface', 'Gross', 1], ['discount', 'Discounts', 1], ['fees', 'Fees', 1], ['tax', 'Tax', 1], ['collected', 'Collected', 1], ['refunds', 'Refunds', 1], ['net', 'Net', 1]];
const BY_DIMS = [['event', 'Event'], ['day', 'Day'], ['month', 'Month'], ['tt', 'Ticket type'], ['area', 'Seating area'], ['slot', 'Showtime'], ['promo', 'Promo code'], ['tracking', 'Tracking code'], ['product', 'Product'], ['bundle', 'Package'], ['method', 'Payment method']];
function dimLabel(dim, rep) {
  const ev = evById(rep.f.eventId);
  return { event: k => evById(k)?.name || 'Other', tt: k => ev ? ttName(ev.id, k) : (S.adm.events.map(e => e.ticketTypes.find(t => t.id === k) && e.name + ' · ' + e.ticketTypes.find(t => t.id === k).name).find(Boolean) || k),
    slot: k => { const e = S.adm.events.find(x => (x.timeSlots || []).some(s => s.id === k)); return e ? slotName(e.id, k) + (ev ? '' : ' · ' + e.name) : k; },
    product: addonName, bundle: bundleName, method: k => PAY_LABEL[k] || k, day: k => fmtDate(k + 'T12:00', { weekday: 'short', month: 'short', day: 'numeric' }), month: k => fmtDate(k + '-15T12:00', { month: 'long', year: 'numeric' }) }[dim] || (k => k);
}
function finGroupRows(rep, dim) { const rows = finGroup(rep, dim, dimLabel(dim, rep)); return ['day', 'month'].includes(dim) ? rows.sort((a, b) => b.key.localeCompare(a.key)) : rows.sort((a, b) => b.collected - a.collected); }
function FinTable(rows, first = 'Name') {
  const tot = finTotals([]); for (const r of rows) for (const [k] of FIN_COLS) tot[k] += r[k] || 0;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(first)}</th>${FIN_COLS.map(c => `<th class="r">${c[1]}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.label)}</td>${FIN_COLS.map(([k, , m]) => `<td class="tnum r">${m ? money(r[k]) : r[k]}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${FIN_COLS.length + 1}" class="muted small">Nothing matches these filters.</td></tr>`}
    ${rows.length > 1 ? `<tr class="tot"><td><b>Total</b></td>${FIN_COLS.map(([k, , m]) => `<td class="tnum r"><b>${m ? money(tot[k]) : tot[k]}</b></td>`).join('')}</tr>` : ''}</tbody></table></div>`;
}
function Reports() {
  const tabs = REP_TABS.filter(tabOk), tab = tabs.find(t => t[0] === S.route.params[0])?.[0] || tabs[0]?.[0] || 'overview';
  const body = { overview: RepOverview, events: RepEvents, payouts: RepPayouts, profit: RepProfit, exports: RepExports, accounting: RepAccounting }[tab]();
  return head('Reports', 'Sales, money, payouts, profit and exports — from every order and ticket') + `<nav class="etabs">${tabs.map(([k, l]) => `<a class="${tab === k ? 'on' : ''}" href="#/admin/reports${k === 'overview' ? '' : '/' + k}">${l}</a>`).join('')}</nav>` + body;
}
function RepOverview() {
  const rep = finRep(), t = rep.totals, f = rep.f, ev = evById(f.eventId), dim = S.ui.repBy || (ev ? 'tt' : 'event');
  const days = {}; rep.items.forEach(i => { days[i.day] = (days[i.day] || 0) + i.collected; });
  const series = []; for (let i = 27; i >= 0; i--) { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i); const k = localDay(d.toISOString()); series.push({ label: fmtDate(d.toISOString(), { month: 'short', day: 'numeric' }), short: fmtDate(d.toISOString(), { month: 'numeric', day: 'numeric' }), v: days[k] || 0 }); }
  const meth = finGroupRows(rep, 'method'), mtot = sum(meth, r => r.collected) || 1;
  return FinFilters() + `
  <div class="kpis"><div class="kpi dark"><div class="eyebrow">Collected</div><div class="v">${money(t.collected)}</div><div class="d" style="color:var(--mut)">${t.orders} orders</div></div>
    <div class="kpi"><div class="eyebrow">${can('finance.processing') ? 'Net collected' : 'Net before processing'}</div><div class="v">${money(t.net)}</div><div class="d">after refunds${can('finance.processing') ? ' & processing' : ''}</div></div>
    <div class="kpi"><div class="eyebrow">Tickets sold</div><div class="v">${t.sold.toLocaleString()}</div><div class="d">${t.comps} comps · gross ${money(t.tface)}</div></div>
    <div class="kpi"><div class="eyebrow">Remaining potential</div><div class="v">${money(t.remaining)}</div><div class="d">of ${money(t.potential)} sellout</div></div></div>
  <div class="cols"><div>${FinDash(t, { title: ev ? ev.name + ' — financial dashboard' : 'Financial summary', partial: rep.partial })}</div>
    <div class="stack"><div class="card"><h3>Collected per day</h3><div class="small muted">Last 28 days · hover a bar for the amount</div>${barChart(series, v => money(v))}</div>
      <div class="card"><h3>By payment method</h3><div class="small muted" style="margin-bottom:12px">Card, wallets, cash and other offline payments</div>${meth.map(r => `<div style="margin-bottom:10px"><div class="between small"><b>${esc(r.label)}</b><span class="tnum">${money(r.collected)} · ${r.orders} order${r.orders === 1 ? '' : 's'}</span></div><div class="bar"><i style="width:${Math.max(0, r.collected) / mtot * 100}%"></i></div></div>`).join('') || '<p class="muted small">No sales yet.</p>'}</div></div></div>
  <div class="card" style="margin-top:18px;padding:0"><div class="between wrap" style="padding:16px 20px 8px;gap:8px"><h3>Breakdown</h3><label class="ff inline"><span>Group by</span><select class="inp" data-action-change="repBy">${BY_DIMS.map(([k, l]) => `<option value="${k}" ${dim === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    ${['tt', 'area', 'slot', 'product', 'bundle'].includes(dim) ? `<p class="small muted" style="padding:0 20px">${dim === 'product' ? 'Products only' : dim === 'bundle' ? 'Package tickets and products only' : 'Tickets only'} — donations, fees not tied to a ticket and later order changes stay in the totals above.</p>` : ''}
    ${FinTable(finGroupRows(rep, dim), BY_DIMS.find(d => d[0] === dim)[1])}</div>`;
}
function RepEvents() {
  const x = finX(), rows = S.adm.events.slice().sort((a, b) => D(b.start) - D(a.start)).map(e => { const r = finReport(x, { eventId: e.id }); return { e, t: r.totals }; });
  return `<p class="small muted" style="margin:0 0 12px">Every event at a glance. Profit is <b>estimated</b> until all of an event's expenses are entered (Profitability tab).</p>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Event</th><th>Date</th><th class="r">Potential</th><th class="r">Gross sold</th><th class="r">Collected</th><th class="r">Refunds</th><th class="r">Net</th><th class="r">Expenses</th><th class="r">Profit</th><th class="r">Remaining</th></tr></thead><tbody>
    ${rows.map(({ e, t }) => `<tr class="click" data-action="repOpenEvent" data-id="${e.id}"><td><b>${esc(e.name)}</b></td><td class="small">${esc(fmtDate(e.start, { month: 'short', day: 'numeric', year: 'numeric' }))}</td><td class="tnum r">${money(t.potential)}</td><td class="tnum r">${money(t.tface)}</td>
      <td class="tnum r">${money(t.collected)}</td><td class="tnum r">${t.refunds + t.credits ? '−' + money(t.refunds + t.credits) : '—'}</td><td class="tnum r"><b>${money(t.net)}</b></td><td class="tnum r">${t.expenses ? money(t.expenses) : '—'}</td>
      <td class="tnum r" style="color:${t.profit < 0 ? 'var(--bad)' : 'inherit'}">${money(t.profit)}${t.profitFinal ? '' : ' <span class="chip mini">est.</span>'}</td><td class="tnum r">${money(t.remaining)}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">No events yet.</td></tr>'}</tbody></table></div>`;
}
function RepPayouts() {
  if (!can('finance.payouts')) return '<p class="muted">You need the “View payouts” permission.</p>';
  const f = repF(), tx = S.ui.recImport?.rows || S.adm.procTx || [], rec = reconcile(S.adm.orders, tx, f), ps = payoutSummary(S.adm.payouts || [], S.adm.procTx || []), rep = finRep({ ...emptyFin(), eventId: f.eventId, from: f.from, to: f.to });
  const cbs = S.adm.orders.filter(o => (o.data.chargebacks || []).length && (!f.eventId || o.event_ids.includes(f.eventId))), failed = S.adm.orders.filter(o => (o.payment?.attempts || []).some(a => !a.ok) && (!f.eventId || o.event_ids.includes(f.eventId)));
  const kpi = (l, v, d = '') => `<div class="kpi"><div class="eyebrow">${l}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`, src = S.ui.recImport ? `imported file “${esc(S.ui.recImport.name)}” (${tx.length} rows)` : 'the processor’s own transaction record';
  const ST = { matched: 'ok', different: 'bad', 'missing at processor': 'warn', 'not in SET': 'warn' }, showAll = S.ui.recAll;
  return FinFilters(['eventId', 'from', 'to']) + `
  <div class="kpis">${kpi('Total processed', money(ps.processed), 'card & wallet payments')}${kpi('Pending payouts', money(ps.pending), `${money(ps.notYetPaidOut)} not paid out yet · ${money(ps.inTransit)} on the way`)}
    ${kpi('Completed payouts', money(ps.completed), `${(S.adm.payouts || []).filter(p => p.status === 'paid').length} payouts`)}${kpi('Failed payments', failed.reduce((a, o) => a + o.payment.attempts.filter(z => !z.ok).length, 0), `${ps.failedN ? ps.failedN + ' failed payout(s) · ' : ''}${failed.length} order${failed.length === 1 ? '' : 's'}`)}</div>
  <div class="kpis">${kpi('Refunds', money(rep.totals.refunds + rep.totals.credits), `${money(rep.totals.credits)} as credit`)}${kpi('Chargebacks', money(rep.totals.chargebacks), `${cbs.length} disputed order${cbs.length === 1 ? '' : 's'}`)}
    ${kpi('Expected from processor', money(rec.totals.setNet), 'SET’s records')}${kpi('Difference', `<span style="color:${rec.totals.diff ? 'var(--bad)' : 'inherit'}">${money(rec.totals.diff)}</span>`, `${rec.issues.length} transaction${rec.issues.length === 1 ? '' : 's'} to check`)}</div>
  <div class="card"><div class="between wrap" style="gap:10px"><div><h3>Reconciliation</h3><div class="small muted">SET’s orders, refunds and chargebacks compared with ${src}, matched by the processor’s transaction id.</div></div>
    <div class="row wrap"><label class="btn btn-ghost btn-sm" style="cursor:pointer">Import processor report (CSV)<input type="file" accept=".csv,text/csv" data-action-change="recFile" hidden></label>${S.ui.recImport ? '<button class="btn btn-ghost btn-sm" data-action="recClear">Use the processor ledger</button>' : ''}
      ${can('finance.export') ? '<button class="btn btn-ghost btn-sm" data-action="xp" data-k="recon" data-fmt="csv">Export</button>' : ''}</div></div>
    <div class="cols" style="margin-top:12px">${['byEvent', 'byDay'].map(k => `<div><div class="fl">${k === 'byEvent' ? 'By event' : 'By date'}</div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${k === 'byEvent' ? 'Event' : 'Date'}</th><th class="r">SET</th><th class="r">Processor</th><th class="r">Difference</th></tr></thead><tbody>
      ${rec[k].slice(0, 14).map(r => `<tr><td class="small">${esc(k === 'byEvent' ? evById(r.key)?.name || '—' : r.key)}${r.issues ? ` <span class="chip mini bad">${r.issues}</span>` : ''}</td><td class="tnum r small">${money(r.setNet)}</td><td class="tnum r small">${money(r.procNet)}</td><td class="tnum r small" style="color:${r.diff ? 'var(--bad)' : 'inherit'}">${r.diff ? money(r.diff) : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted small">No card payments.</td></tr>'}</tbody></table></div>${rec[k].length > 14 ? `<p class="small muted" style="margin-top:6px">Latest 14 of ${rec[k].length} — Export for all.</p>` : ''}</div>`).join('')}</div>
    <div class="between" style="margin-top:14px"><div class="fl">${showAll ? 'All transactions' : 'Needs attention'}</div><label class="check small"><input type="checkbox" data-action="recAll" ${showAll ? 'checked' : ''}> <span>Show matched too</span></label></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Transaction</th><th>Order</th><th>Date</th><th>Status</th><th>What differs</th><th class="r">SET net</th><th class="r">Processor net</th></tr></thead><tbody>
      ${(showAll ? rec.rows : rec.issues).slice(0, 300).map(r => `<tr><td class="small"><code>${esc(r.ref)}</code></td><td class="small">${r.orderRef ? `<a href="#/admin/orders/${esc(r.set.orderId)}">${esc(r.orderRef)}</a>` : '—'}</td><td class="small">${esc(r.day)}</td><td><span class="chip mini ${ST[r.status]}">${esc(r.status)}</span></td>
        <td class="small">${r.diffs.map(d => `${esc(d.label)}: SET ${money(d.set)} · processor ${money(d.processor)}`).join('<br>') || '—'}</td><td class="tnum r small">${money(r.setNet)}</td><td class="tnum r small">${money(r.procNet)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted small">Everything matches.</td></tr>'}</tbody></table></div></div>
  <div class="cols" style="margin-top:18px"><div class="card" style="padding:0"><div style="padding:16px 20px 4px"><h3>Payouts</h3><div class="small muted">Money the processor sent to your bank account</div></div><div class="tbl-wrap" style="border:0;box-shadow:none"><table class="tbl"><thead><tr><th>Payout</th><th>Arrives</th><th>Status</th><th class="r">Amount</th></tr></thead><tbody>
      ${(S.adm.payouts || []).slice().sort((a, b) => D(b.arrival_at) - D(a.arrival_at)).slice(0, 60).map(p => `<tr><td class="small"><code>${esc(p.id)}</code></td><td class="small">${esc(fmtDate(p.arrival_at, { month: 'short', day: 'numeric', year: 'numeric' }))}</td><td><span class="chip mini ${p.status === 'paid' ? 'ok' : ['failed', 'canceled'].includes(p.status) ? 'bad' : 'info'}">${esc(p.status.replace('_', ' '))}</span></td><td class="tnum r">${money(p.amount)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted small">No payouts yet.</td></tr>'}</tbody></table></div></div>
    <div class="stack"><div class="card"><h3>Chargebacks</h3>${cbs.flatMap(o => o.data.chargebacks.map(c => `<div class="between small line"><span><a href="#/admin/orders/${o.id}">${esc(o.ref)}</a> · ${esc(fmtDT(c.at))}${c.reason ? ' · ' + esc(c.reason) : ''}</span><span class="row"><span class="chip mini ${c.status === 'won' ? 'ok' : c.status === 'lost' ? 'bad' : 'warn'}">${esc(c.status)}</span><span class="tnum">${money(c.amount)}</span></span></div>`)).join('') || '<p class="small muted">None.</p>'}</div>
      <div class="card"><h3>Failed payments</h3>${failed.slice(0, 30).map(o => { const fa = o.payment.attempts.filter(a => !a.ok); return `<div class="between small line"><span><a href="#/admin/orders/${o.id}">${esc(o.ref)}</a> · ${esc(fa[fa.length - 1].error || 'failed')}</span><span class="muted">${fa.length}× · ${esc(o.status === 'paid' ? 'paid on retry' : o.status.replace('_', ' '))}</span></div>`; }).join('') || '<p class="small muted">None.</p>'}</div></div></div>`;
}
function RepProfit() {
  const f = repF(), x = finX(), ev = evById(f.eventId) || S.adm.events.find(e => (S.adm.expenses || []).some(z => z.event_id === e.id)) || S.adm.events.map(e => [e, finReport(x, { eventId: e.id }).totals.collected]).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!ev) return '<p class="muted">No events yet.</p>';
  const rep = finReport(finX(), { eventId: ev.id }), t = rep.totals, edit = can('finance.expenses', ev.id), ex = rep.expenses.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))), dr = S.ui.exp ||= { category: 'Venue', description: '', amount: '', date: '', vendor: '' };
  const byCat = EXPENSE_CATS.map(c => [c, sum(ex.filter(e => e.category === c), e => e.amount)]).filter(z => z[1]), neg = c => c ? '−' + money(c) : '—', L = (l, v, cls = '') => `<div class="sum-line ${cls}"><span>${l}</span><span class="tnum">${v}</span></div>`;
  return `<div class="fin-filters"><label class="ff"><span>Event</span><select class="inp" data-action-change="repSet" data-k="eventId">${evOptions(ev.id, 'Choose an event')}</select></label></div>
  <div class="cols"><div class="card"><div class="between"><h3>${esc(ev.name)}</h3>${t.profitFinal ? '<span class="chip ok mini">final — all expenses entered</span>' : '<span class="chip warn mini">estimated profit</span>'}</div>
    ${L('Revenue <span class="small muted">collected, excluding sales tax</span>', money(t.revenue))}${L('Refunds & credits', neg(t.refunds + t.credits))}${t.chargebacks ? L('Chargebacks', neg(t.chargebacks)) : ''}
    ${L('Processing & ticketing costs <span class="small muted">card processing + platform fee</span>', can('finance.processing') ? neg(t.processing + t.platform) : '<span class="muted">hidden</span>')}${L('Event expenses', neg(t.expenses))}
    ${L(t.profitFinal ? 'Event profit' : 'Estimated event profit', `<span style="color:${t.profit < 0 ? 'var(--bad)' : 'inherit'}">${money(t.profit)}</span>`, 'total')}
    <p class="small muted" style="margin-top:8px">${t.profitFinal ? `Marked complete by ${esc(S.adm.expenseFinal[ev.id].by)} on ${esc(fmtDT(S.adm.expenseFinal[ev.id].at))}.` : 'This is an estimate until every expense is in — tick the box below when it is.'}</p>
    ${edit ? `<label class="check small" style="margin-top:6px"><input type="checkbox" data-action="expFinal" data-id="${ev.id}" ${t.profitFinal ? 'checked' : ''}> <span>All of this event’s expenses are entered</span></label>` : ''}
    ${byCat.length ? `<div class="sep"></div><div class="fl">By category</div>${byCat.map(([c, v]) => `<div class="between small line"><span>${esc(c)}</span><span class="tnum">${money(v)}</span></div>`).join('')}` : ''}</div>
  <div class="card" style="padding:0"><div class="between wrap" style="padding:16px 20px 8px;gap:8px"><h3>Expenses</h3>${edit ? `<label class="btn btn-ghost btn-sm" style="cursor:pointer">Import CSV<input type="file" accept=".csv,text/csv" data-action-change="expFile" data-id="${ev.id}" hidden></label>` : ''}</div>
    ${edit ? `<div class="exp-form"><select class="inp" data-input="exp.category" aria-label="Category">${EXPENSE_CATS.map(c => `<option ${dr.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select><input class="inp" type="date" data-input="exp.date" value="${esc(dr.date)}" aria-label="Date"><input class="inp" inputmode="decimal" data-input="exp.amount" placeholder="Amount $" value="${esc(dr.amount)}">
      <input class="inp wide" data-input="exp.description" placeholder="Description" value="${esc(dr.description)}"><input class="inp" data-input="exp.vendor" placeholder="Vendor (optional)" value="${esc(dr.vendor)}">
      <button class="btn btn-dark btn-sm" data-action="expAdd" data-id="${ev.id}">Add</button></div><p class="small muted" style="padding:0 20px">CSV columns: Date, Category, Description, Vendor, Amount.</p>` : ''}
    <div class="tbl-wrap" style="border:0;box-shadow:none"><table class="tbl"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th class="r">Amount</th><th></th></tr></thead><tbody>
      ${ex.map(e => `<tr><td class="small">${esc(e.date || '—')}</td><td>${esc(e.category)}</td><td class="small">${esc(e.description)}${e.vendor ? `<div class="muted">${esc(e.vendor)}</div>` : ''}${e.imported ? ' <span class="chip mini">imported</span>' : ''}</td><td class="tnum r">${money(e.amount)}</td><td>${edit ? `<a href="#" class="small" data-action="expDel" data-id="${e.id}">delete</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted small">No expenses yet.</td></tr>'}
      ${ex.length ? `<tr class="tot"><td colspan="3"><b>Total</b></td><td class="tnum r"><b>${money(t.expenses)}</b></td><td></td></tr>` : ''}</tbody></table></div></div></div>`;
}

/* ── Export center ── each export is a table built from the loaded (already permission-masked) data; CSV or Excel (Xlsx in xlsx.js). */
const ownsData = () => S.adm.me.owner || S.adm.me.support || (can('finance.export') && can('customers.export'));
const tkFlat = t => { const ev = evById(t.event_id), sp = t.seat && ev ? seatParts(ev, t.seat, t) : {}; return { ev, sp, tt: ev?.ticketTypes.find(x => x.id === t.ticket_type_id)?.name || '' }; };
const orderOf = id => S.adm.orders.find(o => o.id === id);
function xpRows(k, rep) {
  const items = rep.items, oids = new Set(items.map(i => i.orderId)), os = S.adm.orders.filter(o => oids.has(o.id)), tks = items.filter(i => i.kind === 'ticket').map(i => i.ticket);
  const evf = rep.f.eventId, inEv = o => !evf || o.event_ids.includes(evf);
  const T = {
    summary: () => { const t = rep.totals; return [['Line', 'Amount'], ['Potential sellout revenue', $$(t.potential)], ['Remaining potential', $$(t.remaining)], ['Gross ticket value sold', $$(t.tface)], ['Products & add-ons (face)', $$(t.pface)], ['Discounts', -$$(t.discount)], ['Package savings & price overrides', -$$(t.savings)],
      ['Complimentary ticket value (not collected)', $$(t.comp)], ['Booking fees', $$(t.fees)], ['Sales tax', $$(t.tax)], ['Donations', $$(t.donation)], ['Card fees paid by buyers', $$(t.cardFee)], ['Paid with credit', $$(t.creditUsed)], ['Order changes & adjustments', $$(t.changes)],
      ['Collected', $$(t.collected)], ['Refunds', -$$(t.refunds)], ['Refunded as credit', -$$(t.credits)], ['Chargebacks', -$$(t.chargebacks)], ['Processing fees', -$$(t.processing)], ['Net collected', $$(t.net)], ['Platform fee', -$$(t.platform)], ['Net to the box office', $$(t.netBo)],
      ['Ticket revenue', $$(t.ticketRev)], ['Product revenue', $$(t.productRev)], ['Package revenue', $$(t.bundleRev)], ['Offline / manual payments', $$(t.offline)], ['Unpaid (pay later)', $$(t.unpaid)], ['Failed payment attempts', t.failedPayments],
      ['Event expenses', $$(t.expenses)], [t.profitFinal ? 'Event profit' : 'Estimated event profit', $$(t.profit)], ['Orders', t.orders], ['Tickets valid', t.sold], ['Comp tickets', t.comps]]; },
    byEvent: () => [['Event', ...FIN_COLS.map(c => c[1])], ...finGroupRows(rep, 'event').map(r => [r.label, ...FIN_COLS.map(([c, , m]) => m ? $$(r[c]) : r[c])])],
    byDay: () => [['Date', ...FIN_COLS.map(c => c[1])], ...finGroupRows(rep, 'day').map(r => [r.key, ...FIN_COLS.map(([c, , m]) => m ? $$(r[c]) : r[c])])],
    orders: () => [['Order', 'Placed', 'Paid', 'Status', 'Name', 'Email', 'Phone', 'Events', 'Tickets & packages', 'Products', 'Face value', 'Subtotal', 'Discount', 'Promo code', 'Tracking code', 'Booking fees', 'Sales tax', 'Donation', 'Card fee (buyer)', 'Credit used', 'Total', 'Extra collected', 'Refunded', 'Credited', 'Chargebacks', 'Processing fee', 'Platform fee', 'Net', 'Payment method', 'Transaction id', 'Source', 'UTM campaign', 'Marketing opt-in'],
      ...os.map(o => { const d = o.data, m = orderMoney(o); return [o.ref, o.created_at, o.paid_at || '', o.status, d.buyer.name, o.buyer_email, d.buyer.phone || '', [...new Set(d.lines.map(l => l.eventName))].join('; '), d.lines.filter(l => l.kind !== 'addon').map(l => l.qty + 'x ' + l.name).join('; '),
        d.lines.filter(l => l.kind === 'addon').map(l => l.qty + 'x ' + l.name).join('; '), $$(d.faceValue), $$(d.subtotal), $$(d.discount), d.code || '', d.tracking || '', $$((d.fee || 0) + (d.serviceFee || 0)), $$(d.tax), $$(d.donation), $$(d.processing), $$(m.creditUsed), $$(d.total), $$(m.extra), $$(m.refunded), $$(m.credited), $$(m.chargedBack),
        $$(d.processingFee), $$(d.platformFee), $$(m.net - m.credited - (d.processingFee || 0)), PAY_LABEL[payMethodOf(o)], o.payment?.ref || '', d.source || '', d.utm?.campaign || '', d.optIn ? 'yes' : 'no']; })],
    tickets: () => [['Ticket', 'Order', 'Status', 'Event', 'Showtime', 'Ticket type', 'Area', 'Table / box', 'Row', 'Seat', 'Holder', 'Face value', 'Paid', 'Discount', 'Promo code', 'Complimentary', 'Booking fee', 'Sales tax', 'Processing fee', 'Refunded', 'Credited', 'Net', 'Tracking code', 'Package', 'Products', 'Price override', 'Checked in'],
      ...tks.map(t => { const { ev, sp, tt } = tkFlat(t), o = orderOf(t.order_id), n = ticketFin(t); return [t.code, o?.ref, t.status, ev?.name, t.slot_id ? slotName(t.event_id, t.slot_id) : '', tt, sp.area || t.area || '', sp.unit || '', sp.row || '', sp.seat || '', t.holder,
        $$(t.face), $$(t.paid), $$(t.discount), t.promo || '', t.comp ? 'yes' : '', $$(t.fee), $$(t.tax), $$(t.proc), $$(n.refund), $$(n.credit), t.paid == null ? '' : $$(n.net), t.tracking || o?.data.tracking || '', t.bundle?.name || '', (t.extras || []).join('; '), t.price_override ? 'yes' : '', t.checked_in_at || '']; })],
    seats: () => { const ev = evById(evf); if (!ev?.seating?.enabled) return [['Seat ID', 'Note'], ['', 'Choose a reserved-seating event']];
      const st = seatStates(ev, { tickets: S.adm.tickets, statuses: S.adm.seatStatus || [], orders: S.adm.orders, slotId: rep.f.slotId || '' });
      return [['Seat ID', 'Area', 'Row', 'Seat', 'Status', 'Price level', 'Customer', 'Order', 'Ticket'], ...[...st.values()].map(({ p, state, t }) => { const o = t && orderOf(t.order_id); return [p.id, p.area, p.row, p.label || p.num, state, ttName(ev.id, p.tt), t?.holder || '', o?.ref || '', t?.code || '']; })]; },
    checkins: () => [['Ticket', 'Order', 'Event', 'Holder', 'Ticket type', 'Seat', 'Checked in', 'Entrance', 'Device', 'By', 'Manual', 'Override'],
      ...S.adm.tickets.filter(t => t.status === 'valid' && (!evf || t.event_id === evf) && oids.has(t.order_id)).map(t => { const { ev, sp, tt } = tkFlat(t), c = t.checkin || {}; return [t.code, orderOf(t.order_id)?.ref, ev?.name, t.holder, tt, [sp.area, sp.unit, sp.row && 'Row ' + sp.row, sp.seat].filter(Boolean).join(' '), t.checked_in_at || '', c.entrance || '', c.device || '', c.by || '', c.manual ? 'yes' : '', c.override ? 'yes' : '']; })],
    products: () => [['Order', 'Event', 'Product', 'Qty', 'Removed', 'Unit price', 'Discount', 'Paid', 'Promo code'], ...items.filter(i => i.kind === 'addon' || i.kind === 'bundleExtra').map(i => [i.ref, evById(i.eventId)?.name, i.name + (i.kind === 'bundleExtra' ? ' (in package)' : ''), i.qty ?? '', i.kind === 'addon' ? (orderOf(i.orderId).data.lines.find(l => l.kind === 'addon' && l.addonId === i.addonId)?.removed || 0) : '', i.kind === 'addon' ? $$(i.pface / Math.max(1, orderOf(i.orderId).data.lines.find(l => l.kind === 'addon' && l.addonId === i.addonId)?.qty || 1)) : '', $$(i.discount), $$(i.productRev), i.promo])],
    refunds: () => [['Order', 'Date', 'Amount', 'Booking fees in it', 'Where', 'Credit code', 'Status', 'Processor refund id', 'By', 'Note'], ...os.filter(inEv).flatMap(o => (o.data.refunds || []).map(r => [o.ref, r.at, $$(r.amount), $$(r.fees), REFUND_TO[r.to] || r.to, r.credit || '', r.status, r.ref || '', r.by || '', r.note || '']))],
    credits: () => [['Code', 'Customer', 'Amount', 'Used', 'Remaining', 'Status', 'For event', 'Expires', 'From order', 'Issued by', 'Issued'], ...(S.adm.credits || []).filter(c => (!evf || c.event_id === evf || os.some(o => o.id === c.source_order)) && (!rep.f.customer || c.email.includes(rep.f.customer.toLowerCase()))).map(c => [c.code, c.email, $$(c.amount), $$(c.used), $$(c.remaining), c.status, c.event_id ? evById(c.event_id)?.name || '' : 'any', c.expires || '', c.source_ref || '', c.issued_by, c.issued_at])],
    chargebacks: () => [['Order', 'Opened', 'Amount', 'Status', 'Reason', 'Processor id', 'Closed'], ...os.flatMap(o => (o.data.chargebacks || []).map(c => [o.ref, c.at, $$(c.amount), c.status, c.reason || '', c.ref || '', c.closed_at || '']))],
    payments: () => [['Order', 'Date', 'Method', 'Processor', 'Transaction id', 'Card', 'Amount', 'Processing fee', 'Failed attempts', 'Status'], ...os.flatMap(o => [[o.ref, o.paid_at || o.created_at, PAY_LABEL[payMethodOf(o)], o.payment?.provider || '', o.payment?.ref || '', o.payment?.last4 ? o.payment.brand + ' •••• ' + o.payment.last4 : o.payment?.brand || '', $$(o.data.total), $$(o.data.processingFee), (o.payment?.attempts || []).filter(a => !a.ok).length, o.status],
      ...(o.data.charges || []).map(c => [o.ref, c.at, PAY_METHODS[c.method] || c.method, 'manual', c.ref || '', '', $$(c.amount), '', '', c.reason || 'later payment'])])],
    traffic: () => { const evs = evf ? [evById(evf)] : S.adm.events; return [['Event', 'Source', 'Page views', 'Orders', 'Tickets', 'Collected', 'Conversion (orders / views)'], ...evs.flatMap(e => { const v = S.adm.views?.[e.id] || { bySrc: {} }, srcs = new Set([...Object.keys(v.bySrc || {}), ...items.filter(i => i.eventId === e.id).map(i => orderOf(i.orderId)?.data.source || 'direct')]);
      return [...srcs].map(s => { const its = items.filter(i => i.eventId === e.id && (orderOf(i.orderId)?.data.source || 'direct') === s), t = finTotals(its), views = v.bySrc?.[s] || 0; return [e.name, s, views, t.orders, t.sold, $$(t.collected), views ? Math.round(t.orders / views * 1000) / 10 + '%' : '']; }); })]; },
    history: () => [['When', 'Order', 'Change', 'By', 'Note', 'Before', 'After'], ...(S.adm.orderLog || []).filter(r => oids.has(r.order_id)).map(r => [r.at, r.ref, r.summary, r.by, r.note || '', r.before ? JSON.stringify(r.before) : '', r.after ? JSON.stringify(r.after) : ''])],
    customers: () => { const g = {}; for (const o of os) { const c = g[o.buyer_email] ||= { name: o.data.buyer.name, email: o.buyer_email, phone: o.data.buyer.phone || '', orders: 0, tickets: 0, collected: 0, refunds: 0, first: o.created_at, last: o.created_at, optIn: false }; c.orders++; c.optIn ||= !!o.data.optIn; c.first = c.first < o.created_at ? c.first : o.created_at; c.last = c.last > o.created_at ? c.last : o.created_at; }
      for (const i of items) { const c = g[i.email]; if (!c) continue; c.tickets += i.sold || 0; c.collected += i.collected; c.refunds += i.refunds + i.credits; }
      return [['Name', 'Email', 'Phone', 'Orders', 'Tickets', 'Collected', 'Refunds & credits', 'First order', 'Last order', 'Marketing opt-in'], ...Object.values(g).map(c => [c.name, c.email, c.phone, c.orders, c.tickets, $$(c.collected), $$(c.refunds), c.first, c.last, c.optIn ? 'yes' : 'no'])]; },
    payouts: () => [['Payout', 'Created', 'Arrives', 'Status', 'Amount', 'Transactions'], ...(S.adm.payouts || []).map(p => [p.id, p.created_at, p.arrival_at, p.status, $$(p.amount), p.tx ?? ''])],
    expenses: () => [['Event', 'Date', 'Category', 'Description', 'Vendor', 'Amount'], ...(S.adm.expenses || []).filter(e => !evf || e.event_id === evf).map(e => [evById(e.event_id)?.name, e.date, e.category, e.description, e.vendor || '', $$(e.amount)])],
    recon: () => { const r = reconcile(S.adm.orders, S.ui.recImport?.rows || S.adm.procTx || [], rep.f); return [['Transaction', 'Order', 'Date', 'Status', 'SET net', 'Processor net', 'Difference', 'What differs'], ...r.rows.map(x => [x.ref, x.orderRef, x.day, x.status, $$(x.setNet), $$(x.procNet), $$(x.diff), x.diffs.map(d => `${d.label}: SET ${$$(d.set)} / processor ${$$(d.processor)}`).join('; ')])]; },
    journal: () => [['Date', 'Account', 'Debit', 'Credit', 'Memo'], ...journal(rep, S.adm.bo.settings?.accounting?.accounts).map(j => [j.date, j.account, $$(j.debit) || '', $$(j.credit) || '', j.memo])],
  };
  return T[k]();
}
// [key, label, permission, what it is]
const XP_SETS = [['summary', 'Financial summary', 'finance.export', 'Every line of the financial dashboard'], ['byEvent', 'Sales by event', 'finance.export', 'One row per event'], ['byDay', 'Sales by day', 'finance.export', 'One row per day'],
  ['orders', 'Orders', 'finance.export', 'Every order with its full money breakdown'], ['tickets', 'Tickets (financial history)', 'finance.export', 'Face, paid, discount, fees, tax, processing, refunds, credits, net — per ticket'],
  ['customers', 'Customers', 'customers.export', 'Buyers in this selection with what they spent'], ['products', 'Products & add-ons', 'finance.export', 'Every product line'], ['payments', 'Payments & transaction ids', 'finance.export', 'Method, processor, transaction id, fees, failed attempts'],
  ['refunds', 'Refunds', 'finance.export', 'Every refund, where it went'], ['credits', 'Credits', 'finance.export', 'Credits issued, used and left'], ['chargebacks', 'Chargebacks', 'finance.export', 'Disputed payments'],
  ['checkins', 'Check-ins', 'finance.export', 'Who came in, when and where'], ['seats', 'Seat status', 'finance.export', 'Every seat of the event (choose an event)'], ['traffic', 'Traffic & conversion', 'finance.export', 'Page views, sources and conversion'],
  ['history', 'Order history', 'finance.export', 'Every change made to these orders'], ['payouts', 'Payouts', 'finance.payouts', 'From the processor'], ['expenses', 'Event expenses', 'finance.export', 'Entered or imported costs'],
  ['recon', 'Reconciliation', 'finance.payouts', 'SET vs the processor, per transaction'], ['journal', 'Accounting journal', 'finance.export', 'Daily balanced journal (debits = credits)']];
const xpOk = s => can(s[2]);
const EVENT_SHEETS = ['summary', 'orders', 'tickets', 'seats', 'checkins', 'products', 'payments', 'refunds', 'credits', 'chargebacks', 'traffic', 'history', 'expenses', 'customers', 'byDay'];
function RepExports() {
  const rep = finRep(), ev = evById(rep.f.eventId), sets = XP_SETS.filter(xpOk);
  return FinFilters(['eventId', 'slotId', 'from', 'to', 'ttId', 'area', 'price', 'promo', 'tracking', 'addonId', 'bundleId', 'method', 'customer']) + `
  <p class="small muted" style="margin:-4px 0 14px">${rep.totals.orders} order${rep.totals.orders === 1 ? '' : 's'} match these filters. Every export uses them. Money is in ${esc(S.adm.bo.settings.currency || 'USD')}, as plain numbers.</p>
  ${ev && can('finance.export') ? `<div class="card hl" style="margin-bottom:16px"><div class="between wrap" style="gap:10px"><div><h3>Export everything for this event</h3><div class="small muted">${esc(ev.name)} — orders, tickets, customers, seats, check-ins, products, payments, refunds, credits, chargebacks, traffic, order history, expenses and the financial breakdown in one file.</div></div>
    <div class="row"><button class="btn btn-accent btn-sm" data-action="xpEvent" data-fmt="xlsx">Excel workbook</button><button class="btn btn-ghost btn-sm" data-action="xpEvent" data-fmt="zip">CSV files (.zip)</button></div></div></div>` : ''}
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Export</th><th>What’s in it</th><th></th></tr></thead><tbody>
    ${sets.map(([k, l, , d]) => `<tr><td><b>${esc(l)}</b></td><td class="small muted">${esc(d)}</td><td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" data-action="xp" data-k="${k}" data-fmt="csv">CSV</button> <button class="btn btn-ghost btn-sm" data-action="xp" data-k="${k}" data-fmt="xlsx">Excel</button></td></tr>`).join('')}
    ${can('finance.export') ? `<tr><td><b>All of the above</b></td><td class="small muted">One Excel workbook, a sheet per export</td><td><button class="btn btn-dark btn-sm" data-action="xpAll">Excel</button></td></tr>` : ''}</tbody></table></div>
  <div class="card" style="margin-top:18px"><h3>Your data belongs to you</h3><p class="small muted" style="margin:6px 0 12px">${esc(S.adm.bo.name)} can always download its complete records — every event, order, ticket, customer, payment, refund and change — without asking the platform. ${ownsData() ? '' : 'The owner (or someone who can export both customer and financial data) can download everything.'}</p>
    ${ownsData() ? `<div class="row wrap"><button class="btn btn-ghost btn-sm" data-action="xpOwn" data-fmt="xlsx">Download all our data (Excel)</button><button class="btn btn-ghost btn-sm" data-action="xpOwn" data-fmt="json">Complete data (JSON)</button></div>` : ''}</div>`;
}
function RepAccounting() {
  const acc = S.ui.acct ||= clone(S.adm.bo.settings?.accounting?.accounts || {}), rep = finRep(), j = journal(rep, S.adm.bo.settings?.accounting?.accounts), edit = can('admin.settings');
  const dr = sum(j, x => x.debit), cr = sum(j, x => x.credit);
  return FinFilters(['eventId', 'from', 'to', 'method']) + `
  <div class="cols"><div class="card"><h3>Connect your accounting system</h3><p class="small muted" style="margin:6px 0 10px">SET builds a balanced journal for every day of sales. Import it into your books today; direct sync plugs into the same journal.</p>
    ${ACCOUNTING_PROVIDERS.map(([k, n, d]) => `<div class="between small line"><span><b>${esc(n)}</b><div class="muted">${esc(d)}</div></span><span class="chip mini">${k === 'api' ? 'available' : 'not connected'}</span></div>`).join('')}
    <div class="sep"></div><div class="fl">Download the journal for these filters</div><div class="row wrap"><button class="btn btn-ghost btn-sm" data-action="xpJournal" data-v="quickbooks">QuickBooks Online (.csv)</button><button class="btn btn-ghost btn-sm" data-action="xpJournal" data-v="xero">Xero manual journal (.csv)</button><button class="btn btn-ghost btn-sm" data-action="xp" data-k="journal" data-fmt="xlsx">Excel</button></div>
    <p class="small muted" style="margin-top:8px">${j.length} lines · debits ${money(dr)} = credits ${money(cr)}${dr === cr ? ' ✓' : ' — not balanced'}</p></div>
  <div class="card"><div class="between"><h3>Account names</h3>${edit ? '<button class="btn btn-dark btn-sm" data-action="acctSave">Save</button>' : ''}</div><p class="small muted" style="margin:6px 0 10px">Match each line to an account in your chart of accounts (Xero uses the code).</p>
    ${ACCOUNTS.map(([k, n, code]) => `<div class="acct-row"><span class="small">${esc(n)}</span><input class="inp" ${edit ? '' : 'disabled'} data-input="acct.${k}" value="${esc(acc[k] || '')}" placeholder="${esc(n)}"><input class="inp" ${edit ? '' : 'disabled'} data-input="acct.${k}_code" value="${esc(acc[k + '_code'] || '')}" placeholder="${esc(code)}"></div>`).join('')}</div></div>
  <div class="card" style="margin-top:18px;padding:0"><div style="padding:16px 20px 4px"><h3>Journal preview</h3></div><div class="tbl-wrap" style="border:0;box-shadow:none"><table class="tbl"><thead><tr><th>Date</th><th>Account</th><th class="r">Debit</th><th class="r">Credit</th><th>Memo</th></tr></thead><tbody>
    ${j.slice(-60).reverse().map(x => `<tr><td class="small">${esc(x.date)}</td><td class="small">${esc(x.account)}</td><td class="tnum r small">${x.debit ? money(x.debit) : ''}</td><td class="tnum r small">${x.credit ? money(x.credit) : ''}</td><td class="small muted">${esc(x.memo)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted small">No sales in this period.</td></tr>'}</tbody></table></div></div>`;
}
const fileStamp = () => localDay(new Date().toISOString());
function xpDownload(name, sheets, fmt) {
  if (fmt === 'csv') return download(name + '.csv', csv(sheets[0].rows));
  if (fmt === 'zip') return download(name + '.zip', Xlsx.zip(sheets.map(s => ({ name: slugify(s.name) + '.csv', data: '﻿' + csv(s.rows) }))), 'application/zip');
  download(name + '.xlsx', Xlsx.xlsx(sheets), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
// the raw tables of exportAll() → one sheet each (nested values as JSON text)
function ownSheets(d) {
  const flat = v => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v;
  return Object.entries(d).filter(([, v]) => Array.isArray(v)).map(([k, rows]) => { const cols = [...new Set(rows.flatMap(r => Object.keys(r || {})))]; return { name: k.replace(/_/g, ' '), rows: [cols, ...rows.map(r => cols.map(c => flat(r[c])))] }; })
    .concat([{ name: 'box office', rows: [['field', 'value'], ...Object.entries(d.box_office || {}).map(([k, v]) => [k, flat(v)])] }]);
}

// ── Marketing, team, settings ────────────────────────────────────────────────
// ── Marketing, messages & automation (Stage 8) ───────────────────────────────
// One outbox (S.adm.outbox) for everything sent; campaigns are S.adm.broadcasts; consent + tags on S.adm.contacts; segments = filters.
const MK_TABS = [['overview', 'Overview'], ['campaigns', 'Campaigns'], ['automations', 'Automations'], ['audience', 'Audience'], ['messages', 'Messages'], ['tracking', 'Tracking'], ['integrations', 'Integrations']];
const admPeople = f => segmentPeople({ orders: S.adm.orders, tickets: S.adm.tickets, contacts: S.adm.contacts, waitlist: S.adm.waitlist, credits: S.adm.credits, accounts: S.adm.accounts }, f);
const contactFor = email => (S.adm.contacts || []).find(c => c.email === email);
const evName = id => evById(id)?.name || 'an event';
const MSG_CHIP = { queued: 'info', sending: 'info', sent: 'ok', failed: 'bad', suppressed: 'warn', cancelled: '', 'not sent (staff choice)': '' };
const msgChip = m => `<span class="chip mini ${MSG_CHIP[m.status] ?? ''}">${esc(m.status === 'queued' && D(m.send_at || m.at) > Date.now() + 6e4 ? 'scheduled ' + fmtDT(m.send_at) : MSG_STATUS[m.status] || m.status)}</span>`;
const kindLabel = m => (MSG_KINDS[m.kind]?.[0] || m.kind) + (m.channel === 'sms' ? ' · text' : '');
function consentChips(c, phone) {
  const e = !c ? '<span class="chip mini">no consent recorded</span>' : c.suppressed ? `<span class="chip mini bad">suppressed · ${esc(c.suppressed)}</span>` : c.email_optin && !c.unsub_email_at ? '<span class="chip mini ok">email ✓</span>'
    : c.unsub_email_at ? '<span class="chip mini warn">unsubscribed</span>' : '<span class="chip mini">email: no opt-in</span>';
  const s = c?.unsub_sms_at ? '<span class="chip mini warn">texts: STOP</span>' : c?.sms_optin ? '<span class="chip mini ok">texts ✓</span>' : (c?.phone || phone) ? '<span class="chip mini">texts: service only</span>' : '';
  return e + ' ' + s;
}
// the render context for a message, from what the back office already holds (LIVE: the server builds the same with msg_context())
function msgCtx(m) {
  const o = m.order_id && S.adm.orders.find(x => x.id === m.order_id) || m._order, evOf = id => m._event?.id === id ? m._event : evById(id), ev = evOf(m.event_id || o?.event_ids?.[0]), bo = S.adm.bo, c = contactFor(m.email);
  const tks = o ? S.adm.tickets.filter(t => t.order_id === o.id && t.status === 'valid').map(t => { const e = evById(t.event_id), tt = e?.ticketTypes.find(x => x.id === t.ticket_type_id), sp = t.seat && e ? seatParts(e, t.seat, t) : null;
    return { id: t.id, event_id: t.event_id, slot_id: t.slot_id, type: tt?.name || 'Ticket', area: sp?.area || t.area || '', row: sp?.row || t.row || '', seat: sp?.seat || t.seat_label || '', unit: t.unit || '', code: t.code }; }) : [];
  return { bo: { name: bo.name, slug: bo.slug, branding: bo.branding, mail: bo.settings?.mail, mailDomain: bo.mailDomain?.status === 'verified' ? bo.mailDomain.domain : null }, event: ev ? { ...ev } : null, tickets: tks, contact: { name: c?.name || '', token: c ? 'preview-token' : '' },
    order: o ? { id: o.id, key: 'private-key', ref: o.ref, buyer: o.data.buyer, events: [...new Set(o.data.lines.map(l => l.eventId))].map(evOf).filter(Boolean).map(e => ({ id: e.id, name: e.name, start: e.start, venue: e.venue, address: e.address, confirmation: e.emails?.confirmation,
      email: e.emails?.confirm || null, policies: e.policies || '', contact: e.contact || null })) } : null };
}
function msgPreview(m) {
  const r = MailTpl.render(m, msgCtx(m), { appUrl: location.origin + location.pathname });
  return m.channel === 'sms' ? `<div class="sms-pv">${esc(r.sms)}</div><p class="small muted" style="margin-top:8px">${r.sms.length} characters · ${Math.ceil(r.sms.length / 153) || 1} SMS segment(s)</p>`
    : `<div class="small muted" style="margin-bottom:6px">Subject: <b>${esc(r.subject)}</b></div><iframe class="mail-pv" sandbox title="Email preview" srcdoc="${esc(r.html)}"></iframe>`;
}
function Marketing() {
  const tab = MK_TABS.some(t => t[0] === S.route.params[0]) ? S.route.params[0] : 'overview';
  const body = { overview: MkOverview, campaigns: MkCampaigns, automations: MkAutomations, audience: MkAudience, messages: MkMessages, tracking: MkTracking, integrations: MkIntegrations }[tab]();
  return head('Marketing', 'Emails, texts, automations, audience, tracking and integrations', !DB.live && can('comms.email') ? `<button class="btn btn-ghost" data-action="runSender" title="Demo: what the every-minute sender does">${ic('mega', 14)} Run sender now</button>` : '')
    + `<nav class="etabs">${MK_TABS.map(([k, l]) => `<a class="${tab === k ? 'on' : ''}" href="#/admin/marketing${k === 'overview' ? '' : '/' + k}">${l}</a>`).join('')}</nav>` + body;
}
function MkOverview() {
  const cs = S.adm.contacts || [], ob = S.adm.outbox || [], d30 = Date.now() - 30 * 864e5, kpi = (l, v, d = '') => `<div class="kpi"><div class="eyebrow">${l}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
  const sent = ob.filter(m => m.status === 'sent' && D(m.sent_at) >= d30), sched = ob.filter(m => m.status === 'queued' && D(m.send_at) > Date.now() + 6e4), failed = ob.filter(m => m.status === 'failed');
  return `<div class="kpis">${kpi('Contacts', cs.length, `${cs.filter(c => c.email_optin && !c.unsub_email_at && !c.suppressed).length} opted in to email`)}${kpi('Text opt-ins', cs.filter(c => c.sms_optin && !c.unsub_sms_at).length, `${cs.filter(c => c.phone).length} with a mobile number`)}
    ${kpi('Sent · 30 days', sent.length, `${sent.filter(m => m.category === 'marketing').length} marketing · ${sent.filter(m => m.channel === 'sms').length} texts`)}${kpi('Scheduled', sched.length, failed.length ? `<span style="color:var(--bad)">${failed.length} failed</span>` : 'none failed')}</div>
  <div class="cols"><div class="card"><div class="between"><h3>Recent campaigns</h3><a class="small" href="#/admin/marketing/campaigns">All campaigns →</a></div>${CampaignRows((S.adm.broadcasts || []).slice().sort((a, b) => D(b.send_at || b.created_at) - D(a.send_at || a.created_at)).slice(0, 5))}</div>
    <div class="card"><div class="between"><h3>Automations</h3><a class="small" href="#/admin/marketing/automations">Manage →</a></div>${(S.adm.automations || []).map(a => { const s = autoSentence(a, evName);
      return `<div class="line small"><div class="between"><b>${esc(a.name)}</b>${a.enabled ? '<span class="chip ok mini">on</span>' : '<span class="chip mini">off</span>'}</div><div class="muted">${esc(s.when)}${s.cond ? ' · ' + esc(s.cond) : ''} → ${esc(s.then)}</div></div>`; }).join('') || '<p class="small muted">None yet.</p>'}</div></div>
  <div class="card" style="margin-top:16px"><h3>How sending works</h3><p class="small muted" style="margin-top:6px">Every message — confirmations, ticket changes, reminders, campaigns, automation emails and texts — goes through one outbox. Just before sending, consent is checked again:
    ticket and order emails go to every buyer (unless the address bounced or was suppressed); <b>marketing</b> needs a recorded opt-in and no unsubscribe; texts need a mobile number and no STOP reply, and marketing texts their own opt-in.
    ${DB.live ? 'The sender runs every minute (Resend for email, the text provider for SMS).' : '<b>Demo mode:</b> messages are marked “sent” in this browser — nothing actually leaves it.'}</p></div>`;
}
function CampaignRows(list) {
  const ob = S.adm.outbox || [];
  return list.map(b => { const ms = ob.filter(m => m.campaign_id === b.id), st = k => ms.filter(m => m.status === k).length, sk = Object.values(b.skipped || {}).reduce((a, x) => a + x, 0);
    return `<div class="line small"><div class="between"><span><b>${esc(b.name || b.subject)}</b> <span class="chip mini ${b.category === 'marketing' ? 'info' : ''}">${b.kind === 'waitlist' ? 'waitlist' : b.category === 'marketing' ? 'marketing' : 'event update'}</span> <span class="muted">${esc(b.channel === 'both' ? 'email + text' : b.channel === 'sms' ? 'text' : 'email')}</span></span>
      <span>${b.status === 'scheduled' ? `<span class="chip info mini">scheduled ${esc(fmtDT(b.send_at))}</span>` : b.status === 'cancelled' ? '<span class="chip mini">cancelled</span>' : `<span class="chip ok mini">sent ${esc(ago(b.send_at || b.created_at))}</span>`}</span></div>
      <div class="muted">${b.event_id ? esc(evName(b.event_id)) + ' · ' : ''}${esc(segLabel(b.filter || {}, evName))} · ${b.recipients ?? 0} matched · ${b.queued ?? ms.length} queued${sk ? ` · ${sk} held back (${esc(Object.entries(b.skipped).map(([k, n]) => n + ' ' + k).join(', '))})` : ''}
        ${ms.length ? ` · ${st('sent')} sent${st('failed') ? `, <span style="color:var(--bad)">${st('failed')} failed</span>` : ''}${st('suppressed') ? `, ${st('suppressed')} held` : ''}` : ''}</div>
      ${b.status === 'scheduled' && (b.category === 'marketing' ? can('comms.marketing') : can('comms.email')) ? `<button class="btn btn-ghost btn-sm" style="margin-top:4px" data-action="cmpCancel" data-id="${b.id}">Cancel</button>` : ''}</div>`; }).join('') || '<p class="small muted" style="margin-top:6px">Nothing sent yet.</p>';
}
// the audience filter, used by campaigns, the audience page and the customer list. p = the S.ui key holding { filter }
function SegEditor(p, opt = {}) {
  const f = S.ui[p].filter, evs = S.adm.events.filter(e => !e.archived || f.eventIds.includes(e.id)), chosen = f.eventIds.length ? evs.filter(e => f.eventIds.includes(e.id)) : evs;
  const tts = chosen.flatMap(e => e.ticketTypes.map(t => ({ id: t.id, name: t.name + (f.eventIds.length === 1 ? '' : ' · ' + e.name) })));
  const areas = [...new Set(S.adm.tickets.filter(t => t.area && chosen.some(e => e.id === t.event_id)).map(t => t.area))].sort();
  const tog = (k, v, label) => `<button type="button" class="chip-btn ${f[k].includes(v) ? 'on' : ''}" data-action="segTog" data-p="${p}" data-k="${k}" data-v="${esc(v)}">${esc(label)}</button>`;
  const ro = !!opt.transactional;
  return `<div class="seg">
    ${ro ? '' : `<div class="field"><label class="fl">Who</label><select class="inp" data-action-change="segVal" data-p="${p}" data-k="status">${Object.entries(SEG_STATUS).map(([k, l]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`}
    <div class="field"><label class="fl">Event${ro ? ' — ticket holders of' : 's (bought tickets for any of)'}</label><div class="chips">${evs.map(e => tog('eventIds', e.id, e.name)).join('') || '<span class="small muted">No events</span>'}</div></div>
    ${tts.length ? `<details ${f.ticketTypeIds.length || f.areas.length ? 'open' : ''}><summary class="small">Ticket type & seating area</summary><div class="field" style="margin-top:8px"><label class="fl">Ticket types</label><div class="chips">${tts.slice(0, 40).map(t => tog('ticketTypeIds', t.id, t.name)).join('')}</div></div>
      ${areas.length ? `<div class="field"><label class="fl">Seating areas</label><div class="chips">${areas.map(a => tog('areas', a, a)).join('')}</div></div>` : ''}</details>` : ''}
    <details ${f.from || f.to || f.promo || f.tracking || f.checkin !== 'any' || f.tags.length ? 'open' : ''}><summary class="small">Purchase date, codes, check-in, tags</summary>
      <div class="grid2" style="margin-top:8px"><div class="field"><label class="fl">Bought from</label><input class="inp" type="date" data-action-change="segVal" data-p="${p}" data-k="from" value="${esc(f.from)}"></div>
        <div class="field"><label class="fl">Bought until</label><input class="inp" type="date" data-action-change="segVal" data-p="${p}" data-k="to" value="${esc(f.to)}"></div>
        <div class="field"><label class="fl">Promo code used</label><select class="inp" data-action-change="segVal" data-p="${p}" data-k="promo"><option value="">Any</option>${(S.adm.promos || []).map(x => `<option ${f.promo === x.code ? 'selected' : ''}>${esc(x.code)}</option>`).join('')}</select></div>
        <div class="field"><label class="fl">Tracking / referral code</label><select class="inp" data-action-change="segVal" data-p="${p}" data-k="tracking"><option value="">Any</option>${(S.adm.tracking || []).map(x => `<option ${f.tracking === x.code ? 'selected' : ''}>${esc(x.code)}</option>`).join('')}</select></div>
        <div class="field"><label class="fl">Checked in</label><select class="inp" data-action-change="segVal" data-p="${p}" data-k="checkin">${[['any', 'Either'], ['in', 'Checked in'], ['out', 'Not checked in']].map(([k, l]) => `<option value="${k}" ${f.checkin === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        ${ro ? '' : `<div class="field"><label class="fl">Customer tags</label><input class="inp" data-action-change="segVal" data-p="${p}" data-k="tags" value="${esc(f.tags.join(', '))}" placeholder="e.g. VIP, Press"></div>`}</div></details>
  </div>`;
}
const newCampaign = (o = {}) => ({ name: '', channel: 'email', category: 'marketing', subject: '', body: '', sendAt: '', segId: '', filter: { ...emptySeg(), status: 'optedIn' }, ...o });
function MkCampaigns() {
  const c = S.ui.cmp ||= newCampaign(), people = admPeople(c.category === 'transactional' ? { ...c.filter, status: 'buyers' } : c.filter), cat = c.category;
  const chans = c.channel === 'both' ? ['email', 'sms'] : [c.channel], reach = ch => people.filter(p => !sendGate(p.contact, ch, cat, ch === 'email' ? p.email : p.phone)).length;
  const canSend = cat === 'marketing' ? can('comms.marketing') : can('comms.email') || can('comms.notify'), segs = S.adm.bo.segments || [];
  const sample = people[0], pm = { kind: cat === 'marketing' ? 'campaign' : 'update', channel: chans[0], category: cat, subject: c.subject, body: c.body, email: sample?.email || '' };
  return `<div class="cols"><div class="card"><h3>New ${cat === 'marketing' ? 'campaign' : 'event update'}</h3>
    <div class="grid2" style="margin-top:10px"><div class="field"><label class="fl">Type</label><select class="inp" data-bind="ui.cmp.category"><option value="marketing" ${cat === 'marketing' ? 'selected' : ''}>Marketing — opted-in contacts only</option>
      <option value="transactional" ${cat === 'transactional' ? 'selected' : ''}>Event update — ticket holders (venue change, doors, last-minute news)</option></select></div>
      <div class="field"><label class="fl">Send as</label><select class="inp" data-bind="ui.cmp.channel">${[['email', 'Email'], ['sms', 'Text message'], ['both', 'Email + text']].filter(([k]) => k === 'email' || can('comms.sms')).map(([k, l]) => `<option value="${k}" ${c.channel === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    ${cat === 'marketing' && segs.length ? `<div class="field"><label class="fl">Saved segment</label><select class="inp" data-action-change="cmpSeg"><option value="">Custom audience…</option>${segs.map(s => `<option value="${s.id}" ${c.segId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>` : ''}
    ${SegEditor('cmp', { transactional: cat === 'transactional' })}
    <div class="reach"><b>${people.length}</b> ${people.length === 1 ? 'person matches' : 'people match'} · ${chans.map(ch => `<b>${reach(ch)}</b> can get ${ch === 'email' ? 'this email' : 'this text'}`).join(' · ')}
      ${cat === 'marketing' ? '<div class="small muted">Marketing only reaches people who opted in and haven’t unsubscribed.</div>' : '<div class="small muted">Event updates go to every ticket holder of the chosen event(s) — keep them to event information, not promotion.</div>'}</div>
    ${chans.includes('email') ? `<div class="field"><label class="fl">Subject</label><input class="inp" data-bind="ui.cmp.subject" value="${esc(c.subject)}" placeholder="e.g. Doors now open at 6:30"></div>` : ''}
    <div class="field"><label class="fl">Message</label><textarea class="inp" rows="7" data-bind="ui.cmp.body" placeholder="Hi {{first_name}}, …">${esc(c.body)}</textarea>
      <div class="small muted" style="margin-top:4px">Personalise with ${MSG_VARS.slice(0, 11).map(([k, l]) => `<code title="${esc(l)}">{{${k}}}</code>`).join(' ')}${c.channel !== 'email' ? ' · Texts: keep it short; “Reply STOP to opt out” is added to marketing texts.' : ''}</div></div>
    <div class="grid2"><div class="field"><label class="fl">When</label><input class="inp" type="datetime-local" data-bind="ui.cmp.sendAt" value="${esc(c.sendAt)}"><div class="small muted" style="margin-top:4px">Leave empty to send now.</div></div>
      <div class="field"><label class="fl">Internal name (optional)</label><input class="inp" data-bind="ui.cmp.name" value="${esc(c.name)}"></div></div>
    <div class="row wrap">${canSend ? `<button class="btn btn-accent" data-action="cmpSend">${c.sendAt ? 'Schedule' : 'Send now'} to ${chans.map(reach).reduce((a, b) => Math.max(a, b), 0)}</button>` : '<span class="small muted">You don’t have permission to send this.</span>'}
      <button class="btn btn-ghost" data-action="cmpPreview" ${c.body ? '' : 'disabled'}>Preview</button></div>
    ${c.body && sample ? `<div class="sep"></div><div class="fl">Preview for ${esc(sample.name || sample.email)}</div>${msgPreview(pm)}` : ''}</div>
  <div class="card"><h3>Campaigns & updates</h3>${CampaignRows((S.adm.broadcasts || []).slice().sort((a, b) => D(b.send_at || b.created_at) - D(a.send_at || a.created_at)))}</div></div>`;
}
const newAuto = () => ({ name: '', enabled: true, trigger: { type: 'ticket.purchased', hours: 24 }, cond: { eventIds: [], ticketTypeIds: [], areas: [], prices: [], minQty: 0, promo: '', tags: [] }, timing: { mode: 'now', hours: 0 }, actions: [{ type: 'email', category: 'transactional', subject: '', body: '' }], promo: '' });
function MkAutomations() {
  if (S.ui.au) return AutoEditor(S.ui.au);
  const all = S.adm.automations || [], std = all.filter(a => a.std), mine = all.filter(a => !a.std), ed = can('comms.automations');
  const row = a => { const s = autoSentence(a, evName); return `<div class="item-card" style="margin-top:10px"><div class="between"><b>${esc(a.name)}</b><span class="row">${ed ? `<label class="switch-sm"><input type="checkbox" data-action="auToggle" data-id="${a.id}" ${a.enabled ? 'checked' : ''}> ${a.enabled ? 'On' : 'Off'}</label>
      <button class="btn btn-ghost btn-sm" data-action="auEdit" data-id="${a.id}">Edit</button>${a.std ? '' : `<button class="btn btn-ghost btn-sm" data-action="auDel" data-id="${a.id}">Delete</button>`}` : a.enabled ? '<span class="chip ok mini">on</span>' : '<span class="chip mini">off</span>'}</span></div>
    <div class="auto-flow small"><span><i>When</i> ${esc(s.when)}</span>${s.cond ? `<span><i>If</i> ${esc(s.cond)}</span>` : ''}<span><i>Then</i> ${esc(s.then)}</span></div>
    <div class="small muted">${a.runs ? `Ran ${a.runs} time${a.runs === 1 ? '' : 's'} · last ${esc(ago(a.last_run))}` : 'Hasn’t run yet'}${a.std === 'purchase' ? ' · Plus, always: the order confirmation email (built in), purchase analytics, and tracking pixels on the order page (Meta Conversions API too when connected).' : ''}${a.std === 'pre' ? ' · Events with their own reminders (Event → Emails) use those instead.' : ''}</div></div>`; };
  return `<div class="cols"><div><div class="between"><h3>Standard workflows</h3></div><p class="small muted">Purchase → confirmation, audience, analytics, pixels · 24 h before → reminder with the ticket link · after the event → thank you, feedback, optional next-event offer.</p>${std.map(row).join('')}</div>
    <div><div class="between"><h3>Your automations</h3>${ed ? `<button class="btn btn-accent btn-sm" data-action="auNew">${ic('plus', 14)} New automation</button>` : ''}</div><p class="small muted">Trigger → conditions → actions. Example: when someone buys VIP, 48 hours before the event, send VIP instructions by email and text.</p>${mine.map(row).join('') || '<p class="small muted" style="margin-top:10px">None yet.</p>'}</div></div>`;
}
function AutoEditor(a) {
  const T = a.trigger.type, timed = TIMED_TRIGGERS.includes(T), c = a.cond, evs = S.adm.events.filter(e => !e.archived), chosen = c.eventIds.length ? evs.filter(e => c.eventIds.includes(e.id)) : evs;
  const tog = (k, v, label) => `<button type="button" class="chip-btn ${c[k].includes(v) ? 'on' : ''}" data-action="auTog" data-k="${k}" data-v="${esc(v)}">${esc(label)}</button>`;
  const prices = [...new Set(chosen.flatMap(e => e.ticketTypes.map(t => +t.price || 0)))].sort((x, y) => x - y), areas = [...new Set(S.adm.tickets.filter(t => t.area && chosen.some(e => e.id === t.event_id)).map(t => t.area))].sort();
  const igs = S.adm.integrations || [], act = (x, i) => { const f = (k, l, ph = '', area) => area ? `<div class="field"><label class="fl">${l}</label><textarea class="inp" rows="4" data-bind="ui.au.actions.${i}.${k}" placeholder="${esc(ph)}">${esc(x[k] || '')}</textarea></div>` : `<div class="field"><label class="fl">${l}</label><input class="inp" data-bind="ui.au.actions.${i}.${k}" value="${esc(x[k] || '')}" placeholder="${esc(ph)}"></div>`;
    return `<div class="item-card" style="margin-top:10px"><div class="between"><b class="small">${i + 1}. ${AUTO_ACTIONS[x.type]}</b><button class="btn btn-ghost btn-sm" data-action="auActDel" data-i="${i}">Remove</button></div>
      ${x.type === 'email' || x.type === 'sms' ? `<div class="field"><label class="fl">Kind</label><select class="inp" data-bind="ui.au.actions.${i}.category"><option value="transactional" ${x.category !== 'marketing' ? 'selected' : ''}>Event / ticket information — every buyer</option><option value="marketing" ${x.category === 'marketing' ? 'selected' : ''}>Marketing — opted-in only</option></select></div>
        ${x.type === 'email' ? f('subject', 'Subject') : ''}${f('body', 'Message', 'Hi {{first_name}}, …', true)}${x.type === 'email' ? f('link', 'Link for {{link}} (optional — e.g. a feedback form)', 'https://…') : ''}` : ''}
      ${x.type === 'tag' || x.type === 'untag' ? f('tag', 'Tag', 'e.g. VIP or Attendee: {{event}}') : ''}
      ${x.type === 'staff' ? f('to', 'Staff email', 'name@your-box-office.com') + f('subject', 'Subject') + f('body', 'Note', '', true) : ''}
      ${x.type === 'webhook' || x.type === 'crm' ? `<div class="field"><label class="fl">${x.type === 'webhook' ? 'Webhook' : 'CRM'}</label><select class="inp" data-bind="ui.au.actions.${i}.integrationId"><option value="">Choose…</option>${igs.filter(g => x.type === 'webhook' ? g.kind === 'webhook' : INTEGRATIONS[g.kind]?.crm).map(g => `<option value="${g.id}" ${x.integrationId === g.id ? 'selected' : ''}>${esc(g.name)} · ${esc(INTEGRATIONS[g.kind].name)}</option>`).join('')}</select>${igs.length ? '' : '<div class="small muted" style="margin-top:4px">Connect one under Integrations first.</div>'}</div>` : ''}</div>`; };
  return `<a href="#/admin/marketing/automations" class="small muted" data-action="auCancel" style="text-decoration:none">← Automations</a>${head(a.id ? esc(a.name) : 'New automation', 'Trigger → conditions → actions', `<button class="btn btn-ghost" data-action="auCancel">Cancel</button><button class="btn btn-accent" data-action="auSave">Save automation</button>`)}
  <div class="cols"><div class="stack"><div class="card"><div class="field"><label class="fl">Name</label><input class="inp" data-bind="ui.au.name" value="${esc(a.name)}" placeholder="e.g. VIP arrival instructions"></div>
      <label class="check"><input type="checkbox" data-bind="ui.au.enabled" data-t="bool" ${a.enabled ? 'checked' : ''}> <span>On</span></label></div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:10px">1 · Trigger</div><div class="grid2"><div class="field"><label class="fl">When</label><select class="inp" data-bind="ui.au.trigger.type" ${a.std ? 'disabled' : ''}>${Object.entries(AUTO_TRIGGERS).map(([k, l]) => `<option value="${k}" ${T === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${timed ? `<div class="field"><label class="fl">Hours ${T === 'event.approaching' ? 'before it starts' : 'after it ends'}</label><input class="inp" type="number" min="0" max="720" data-bind="ui.au.trigger.hours" data-t="int" value="${+a.trigger.hours || 0}"></div>` : ''}</div>
      ${T === 'cart.abandoned' ? '<p class="small muted">A card checkout left unpaid until its timer ran out (the buyer gave their email).</p>' : T === 'no_show' ? '<p class="small muted">Nobody on the order checked in by the end of the event.</p>' : ''}</div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:10px">2 · Conditions <span class="muted" style="text-transform:none;letter-spacing:0">(all optional)</span></div>
      <div class="field"><label class="fl">Events</label><div class="chips">${evs.map(e => tog('eventIds', e.id, e.name)).join('')}</div></div>
      <div class="field"><label class="fl">Ticket types</label><div class="chips">${chosen.flatMap(e => e.ticketTypes.map(t => tog('ticketTypeIds', t.id, t.name + (chosen.length > 1 ? ' · ' + e.name : '')))).slice(0, 40).join('')}</div></div>
      ${areas.length ? `<div class="field"><label class="fl">Seating areas</label><div class="chips">${areas.map(x => tog('areas', x, x)).join('')}</div></div>` : ''}
      ${prices.length ? `<div class="field"><label class="fl">Price levels</label><div class="chips">${prices.map(x => `<button type="button" class="chip-btn ${c.prices.includes(x) ? 'on' : ''}" data-action="auTog" data-k="prices" data-v="${x}" data-num="1">${money(x)}</button>`).join('')}</div></div>` : ''}
      <div class="grid3"><div class="field"><label class="fl">At least … tickets</label><input class="inp" type="number" min="0" data-bind="ui.au.cond.minQty" data-t="int" value="${+c.minQty || 0}"></div>
        <div class="field"><label class="fl">Promo code</label><select class="inp" data-bind="ui.au.cond.promo"><option value="">Any / none</option>${(S.adm.promos || []).map(x => `<option ${c.promo === x.code ? 'selected' : ''}>${esc(x.code)}</option>`).join('')}</select></div>
        <div class="field"><label class="fl">Customer has tags</label><input class="inp" data-action-change="auTags" value="${esc(c.tags.join(', '))}" placeholder="VIP"></div></div></div></div>
  <div class="stack"><div class="card"><div class="eyebrow dash" style="margin-bottom:10px">3 · Actions</div>
      <div class="grid2"><div class="field"><label class="fl">Send</label><select class="inp" data-bind="ui.au.timing.mode">${Object.entries(TIMING).map(([k, l]) => `<option value="${k}" ${a.timing.mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        ${a.timing.mode !== 'now' ? `<div class="field"><label class="fl">Hours</label><input class="inp" type="number" min="0" max="720" data-bind="ui.au.timing.hours" data-t="int" value="${+a.timing.hours || 0}"></div>` : ''}</div>
      ${a.std === 'offer' ? `<div class="field"><label class="fl">Promo code for {{promo_code}}</label><select class="inp" data-bind="ui.au.promo"><option value="">Choose…</option>${(S.adm.promos || []).map(x => `<option ${a.promo === x.code ? 'selected' : ''}>${esc(x.code)}</option>`).join('')}</select></div>` : ''}
      ${a.actions.map(act).join('')}
      <div class="row wrap" style="margin-top:12px">${Object.entries(AUTO_ACTIONS).filter(([k]) => k !== 'sms' || can('comms.sms')).map(([k, l]) => `<button class="btn btn-ghost btn-sm" data-action="auActAdd" data-v="${k}">${ic('plus', 12)} ${l}</button>`).join('')}</div>
      <p class="small muted" style="margin-top:10px">Placeholders: ${MSG_VARS.map(([k, l]) => `<code title="${esc(l)}">{{${k}}}</code>`).join(' ')}</p></div></div></div>`;
}
function MkAudience() {
  const au = S.ui.aud ||= { filter: emptySeg(), name: '' }, people = admPeople(au.filter), cs = S.adm.contacts || [], segs = S.adm.bo.segments || [];
  const sup = cs.filter(c => c.suppressed || c.unsub_email_at || c.unsub_sms_at), log = (S.adm.consentLog || []).slice(0, 60);
  const kpi = (l, v, d = '') => `<div class="kpi"><div class="eyebrow">${l}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
  return `<div class="kpis">${kpi('Contacts', cs.length)}${kpi('Email opt-ins', cs.filter(c => c.email_optin && !c.unsub_email_at && !c.suppressed).length)}${kpi('Text opt-ins', cs.filter(c => c.sms_optin && !c.unsub_sms_at).length)}${kpi('Unsubscribed / suppressed', sup.length)}</div>
  <div class="cols"><div class="card"><h3>Segment</h3>${segs.length ? `<div class="chips" style="margin:8px 0">${segs.map(s => `<button class="chip-btn" data-action="segLoad" data-id="${s.id}">${esc(s.name)}</button>`).join('')}</div>` : ''}${SegEditor('aud')}
      <div class="reach"><b>${people.length}</b> people · ${people.filter(p => !sendGate(p.contact, 'email', 'marketing', p.email)).length} reachable by marketing email · ${people.filter(p => !sendGate(p.contact, 'sms', 'marketing', p.phone)).length} by marketing text</div>
      <div class="row wrap">${can('customers.export') ? '<button class="btn btn-ghost btn-sm" data-action="audExport">Export CSV</button>' : ''}${can('comms.lists') ? `<input class="inp inp-sm" style="width:200px" data-input="aud.name" value="${esc(au.name)}" placeholder="Segment name"><button class="btn btn-ghost btn-sm" data-action="segSave">Save segment</button>` : ''}
        ${can('comms.marketing') ? '<button class="btn btn-dark btn-sm" data-action="segCampaign">Email this segment</button>' : ''}</div>
      ${segs.length && can('comms.lists') ? `<div class="small muted" style="margin-top:10px">Saved: ${segs.map(s => `${esc(s.name)} <a href="#" data-action="segDel" data-id="${s.id}" title="Delete">×</a>`).join(' · ')}</div>` : ''}</div>
    <div class="card" style="padding:0"><div class="tbl-wrap" style="border:0;box-shadow:none"><table class="tbl"><thead><tr><th>Person</th><th>Consent</th><th>Tags</th><th>Spent</th></tr></thead><tbody>
      ${people.slice(0, 150).map(p => `<tr class="click" data-action="go" data-v="#/admin/customers/${encodeURIComponent(p.email)}"><td><b>${esc(p.name || '—')}</b><div class="small muted">${esc(p.email)}${p.phone ? ' · ' + esc(p.phone) : ''}</div></td>
        <td>${consentChips(p.contact, p.phone)}</td><td>${(p.contact?.tags || []).map(t => `<span class="chip mini">${esc(t)}</span>`).join(' ')}</td><td class="tnum">${money(p.spent)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nobody matches.</td></tr>'}</tbody></table></div>
      ${people.length > 150 ? `<p class="small muted" style="padding:10px 16px">Showing 150 of ${people.length} — export for the full list.</p>` : ''}</div></div>
  <div class="cols" style="margin-top:16px"><div class="card"><h3>Suppression & unsubscribes</h3><p class="small muted" style="margin:4px 0 10px">Suppressed addresses get no email at all (bounces, complaints, requests); unsubscribed people still get their tickets and event information.</p>
      ${can('comms.consent') ? `<div class="row"><input class="inp" data-input="supEmail" value="${esc(S.ui.supEmail || '')}" placeholder="email@example.com"><button class="btn btn-ghost btn-sm" data-action="supAdd">Suppress</button></div>` : ''}
      ${sup.slice(0, 80).map(c => `<div class="between small line"><span>${esc(c.email)}<div class="muted">${c.suppressed ? `suppressed (${esc(c.suppressed)}) ${esc(fmtDT(c.suppressed_at))}` : ''}${c.unsub_email_at ? ` unsubscribed ${esc(fmtDT(c.unsub_email_at))}` : ''}${c.unsub_sms_at ? ` · texts stopped ${esc(fmtDT(c.unsub_sms_at))}` : ''}</div></span>
        ${can('comms.consent') && c.suppressed ? `<button class="btn btn-ghost btn-sm" data-action="ctAct" data-v="unsuppress" data-email="${esc(c.email)}">Remove</button>` : ''}</div>`).join('') || '<p class="small muted">Nobody.</p>'}</div>
    <div class="card"><h3>Consent history</h3><p class="small muted" style="margin:4px 0 10px">Every opt-in and opt-out with its date and source.</p>${log.map(r => `<div class="between small line"><span><b>${esc(r.email)}</b> · ${esc(CONSENT_LABEL[r.action.split(':')[0]] || r.action)}${r.action.includes(':') ? ' (' + esc(r.action.split(':')[1]) + ')' : ''}<div class="muted">${esc(r.source)} · ${esc(r.by)}</div></span><span class="muted">${esc(fmtDT(r.at))}</span></div>`).join('') || '<p class="small muted">No changes yet.</p>'}</div></div>`;
}
const CONSENT_LABEL = { optin: 'opted in to email', optout: 'unsubscribed from email', sms_optin: 'opted in to texts', sms_optout: 'stopped texts', sms_start: 'allowed texts again', suppress: 'suppressed', unsuppress: 'suppression removed' };
function MkMessages() {
  const q = S.ui.mq ||= { status: '', channel: '', kind: '', text: '' }, t = q.text.trim().toLowerCase();
  const list = (S.adm.outbox || []).filter(m => (!q.status || (q.status === 'scheduled' ? m.status === 'queued' && D(m.send_at) > Date.now() + 6e4 : m.status === q.status)) && (!q.channel || (m.channel || 'email') === q.channel)
    && (!q.kind || m.kind === q.kind) && (!t || [m.to, m.email, m.subject, m.body].join(' ').toLowerCase().includes(t))).sort((a, b) => D(b.send_at || b.at) - D(a.send_at || a.at));
  const sel = (k, opts) => `<select class="inp" data-bind="ui.mq.${k}">${opts.map(([v, l]) => `<option value="${v}" ${q[k] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<div class="toolbar">${sel('status', [['', 'Any status'], ['scheduled', 'Scheduled'], ...Object.entries(MSG_STATUS)])}${sel('channel', [['', 'Email & text'], ['email', 'Email'], ['sms', 'Text']])}${sel('kind', [['', 'Every kind'], ...Object.entries(MSG_KINDS).map(([k, v]) => [k, v[0]])])}
    <input class="inp" style="flex:1" data-input="mq.text" placeholder="Search address or subject…" value="${esc(q.text)}"><button class="btn btn-ghost btn-sm" data-action="mqGo">Search</button></div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Message</th><th>To</th><th>Status</th><th></th></tr></thead><tbody>
  ${list.slice(0, 300).map(m => `<tr class="click" data-action="msgOpen" data-id="${m.id}"><td class="small muted">${esc(fmtDT(m.sent_at || m.send_at || m.at))}</td><td><b>${esc(kindLabel(m))}</b> <span class="chip mini ${m.category === 'marketing' ? 'info' : ''}">${esc(m.category || 'transactional')}</span><div class="small muted">${esc(MailTpl.fill(m.subject || '', { event: evById(m.event_id)?.name || '' }).slice(0, 80))}</div></td>
    <td class="small">${esc(m.to)}</td><td>${msgChip(m)}${m.error ? `<div class="small muted">${esc(m.error)}</div>` : ''}</td>
    <td data-stop="1">${m.status === 'queued' ? `<button class="btn btn-ghost btn-sm" data-action="msgCancel" data-id="${m.id}">Cancel</button>` : ['failed', 'suppressed'].includes(m.status) ? `<button class="btn btn-ghost btn-sm" data-action="msgRetry" data-id="${m.id}">Retry</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No messages.</td></tr>'}</tbody></table></div>
  ${list.length > 300 ? `<p class="small muted" style="margin-top:8px">Showing the latest 300 of ${list.length}.</p>` : ''}`;
}
// where buyers came from: views (by ?src / utm_source), checkouts started, purchases, revenue, conversion — plus UTM campaigns
function attribution() {
  const rows = {}, R = k => rows[k] ||= { k, views: 0, checkouts: 0, orders: 0, tickets: 0, rev: 0 }, camps = {};
  for (const v of Object.values(S.adm.views || {})) for (const [k, n] of Object.entries(v.bySrc || {})) R(k || 'direct').views += n;
  for (const o of S.adm.orders) {
    if (o.data.payment === 'manual') continue;
    const k = o.data.utm?.source || o.data.source || 'direct', r = R(k), done = wasPaid(o) || o.status === 'pending';
    r.checkouts++; if (done) { r.orders++; r.tickets += S.adm.tickets.filter(t => t.order_id === o.id && t.status !== 'replaced').length; r.rev += o.data.total || 0; }
    if (o.data.utm?.campaign) { const c = camps[o.data.utm.campaign] ||= { k: o.data.utm.campaign, src: new Set(), checkouts: 0, orders: 0, rev: 0 }; c.src.add([o.data.utm.source, o.data.utm.medium].filter(Boolean).join(' / ')); c.checkouts++; if (done) { c.orders++; c.rev += o.data.total || 0; } }
  }
  return { rows: Object.values(rows).sort((a, b) => b.orders - a.orders || b.views - a.views), camps: Object.values(camps).sort((a, b) => b.orders - a.orders) };
}
function MkTracking() {
  const px = S.adm.bo.settings.pixels || {}, a = attribution(), u = S.ui.utm ||= { ev: '', source: '', medium: '', campaign: '' }, fin = can('finance.totals'), pct = (x, y) => y ? (x / y * 100).toFixed(1) + '%' : '—';
  const ev = evById(u.ev), qs = ['source', 'medium', 'campaign'].filter(k => u[k]).map(k => `utm_${k}=${encodeURIComponent(u[k].trim().toLowerCase().replace(/\s+/g, '-'))}`).join('&');
  const link = location.origin + location.pathname + (ev ? '#/e/' + ev.slug : '#/b/' + S.adm.bo.slug) + (qs ? '?' + qs : '');
  const pr = (S.adm.promos || []).map(p => { const os = S.adm.orders.filter(o => o.data.promo?.id === p.id && (wasPaid(o) || o.status === 'pending')); return { p, orders: os.length, rev: sum(os, o => o.data.total), disc: sum(os, o => (o.data.discount || 0) + (o.data.feeDiscount || 0)) }; }).filter(x => x.orders).sort((x, y) => y.orders - x.orders);
  return `<div class="cols"><div class="card"><h3>Pixels & analytics</h3><div class="kv-grid" style="margin-top:10px">${[['Google Analytics 4', px.ga4], ['Meta Pixel', px.meta], ['TikTok Pixel', px.tiktok]].map(([k, v]) => `<div><div class="eyebrow">${k}</div><div class="small">${v ? `<span class="chip ok mini">on</span> <code>${esc(v)}</code>` : '<span class="chip mini">not set</span>'}</div></div>`).join('')}
      <div><div class="eyebrow">Meta Conversions API</div><div class="small">${(S.adm.integrations || []).some(g => g.kind === 'meta_capi' && g.active) ? '<span class="chip ok mini">connected</span>' : '<span class="chip mini">not connected</span>'}</div></div></div>
      <p class="small muted" style="margin-top:10px">Pixels load on public pages only and report page views, “view content” on event pages, “initiate checkout” and “purchase” (with the order value; the purchase is matched with the Conversions API so it isn’t counted twice).${px.consent ? ' A cookie banner asks first.' : ''} Set the IDs in <a href="#/admin/settings">Settings → Tracking</a>.</p></div>
    <div class="card"><h3>Campaign link builder</h3><p class="small muted" style="margin:4px 0 10px">UTM tags are kept with the buyer’s order, so sales show up by source and campaign below.</p>
      <div class="grid2"><div class="field"><label class="fl">Page</label><select class="inp" data-bind="ui.utm.ev"><option value="">Box office home</option>${S.adm.events.filter(e => !e.archived).map(e => `<option value="${e.id}" ${u.ev === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></div>
        <div class="field"><label class="fl">Source</label><input class="inp" data-input="utm.source" value="${esc(u.source)}" placeholder="instagram"></div>
        <div class="field"><label class="fl">Medium</label><input class="inp" data-input="utm.medium" value="${esc(u.medium)}" placeholder="social, email, paid"></div>
        <div class="field"><label class="fl">Campaign</label><input class="inp" data-input="utm.campaign" value="${esc(u.campaign)}" placeholder="winter-launch"></div></div>
      <div class="row"><input class="inp" readonly value="${esc(link)}"><button class="btn btn-ghost btn-sm" data-action="utmBuild">Update</button><button class="btn btn-dark btn-sm" data-action="copyLink" data-v="${esc(link)}">Copy</button></div>
      <p class="small muted" style="margin-top:8px">Promoters and partners: give them a tracking code on <a href="#/admin/promos/tracking">Promotions</a> (<code>?ref=CODE</code>).</p></div></div>
  <div class="card" style="padding:0;margin-top:16px"><div style="padding:16px 20px 6px"><h3>Traffic source → purchase</h3></div><div class="tbl-wrap" style="border:0;box-shadow:none"><table class="tbl"><thead><tr><th>Source</th><th>Event page views</th><th>Checkouts</th><th>Purchases</th><th>Tickets</th>${fin ? '<th>Revenue</th>' : ''}<th>View → purchase</th><th>Checkout → purchase</th></tr></thead><tbody>
    ${a.rows.map(r => `<tr><td><b>${esc(r.k)}</b></td><td class="tnum">${r.views.toLocaleString()}</td><td class="tnum">${r.checkouts}</td><td class="tnum">${r.orders}</td><td class="tnum">${r.tickets}</td>${fin ? `<td class="tnum">${money(r.rev)}</td>` : ''}<td class="tnum">${pct(r.orders, r.views)}</td><td class="tnum">${pct(r.orders, r.checkouts)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No traffic yet.</td></tr>'}</tbody></table></div></div>
  <div class="cols" style="margin-top:16px"><div class="card"><h3>UTM campaigns</h3>${a.camps.map(c => `<div class="between small line"><span><b>${esc(c.k)}</b><div class="muted">${esc([...c.src].join(', '))}</div></span><span class="tnum">${c.orders} of ${c.checkouts} checkouts${fin ? ' · ' + money(c.rev) : ''}</span></div>`).join('') || '<p class="small muted" style="margin-top:6px">No orders with UTM tags yet — build a link above.</p>'}</div>
    <div class="card"><h3>Promo-code attribution</h3>${pr.map(x => `<a class="between small line" style="text-decoration:none" href="#/admin/promos/code/${x.p.id}"><b class="tnum">${esc(x.p.code)}</b><span class="tnum">${x.orders} orders${fin ? ` · ${money(x.rev)} · ${money(x.disc)} off` : ''}</span></a>`).join('') || '<p class="small muted" style="margin-top:6px">No orders with codes yet.</p>'}</div></div>`;
}
function MkIntegrations() {
  if (!can('admin.integrations') && !can('admin.api')) return '<div class="empty">You need “Access integrations” or “Access API settings”.</div>';
  const igs = S.adm.integrations || [], dl = (S.adm.deliveries || []).slice(0, 40), f = S.ui.ig, keys = S.adm.apiKeys || [];
  const form = f ? (() => { const def = INTEGRATIONS[f.kind]; return `<div class="card" style="margin-bottom:16px"><h3>${f.id ? 'Edit' : 'Connect'} ${esc(def.name)}</h3><p class="small muted" style="margin:4px 0 10px">${esc(def.blurb)}</p>
      <div class="grid2"><div class="field"><label class="fl">Name</label><input class="inp" data-bind="ui.ig.name" value="${esc(f.name)}"></div>${def.fields.map(([k, l]) => `<div class="field"><label class="fl">${esc(l)}</label><input class="inp" data-bind="ui.ig.config.${k}" value="${esc(f.config[k] || '')}"></div>`).join('')}
        ${def.secret ? `<div class="field"><label class="fl">${esc(def.secret)}</label><input class="inp" type="password" autocomplete="off" data-bind="ui.ig.secret" value="" placeholder="${f.secret_hint ? 'saved ' + esc(f.secret_hint) + ' — leave empty to keep' : 'paste it here'}"><div class="small muted" style="margin-top:4px">Stored on the server only — never shown again.</div></div>` : ''}</div>
      ${f.kind === 'webhook' ? `<div class="field"><label class="fl">Send these events</label><div class="chips">${Object.entries(HOOK_EVENTS).map(([k, l]) => `<button type="button" class="chip-btn ${(f.config.events || []).includes(k) ? 'on' : ''}" data-action="igEv" data-v="${k}">${l}</button>`).join('')}</div></div>` : ''}
      ${def.crm ? `<div class="field"><label class="fl">Who to sync</label><select class="inp" data-bind="ui.ig.config.who"><option value="optedIn" ${f.config.who !== 'all' ? 'selected' : ''}>Only people who opted in to marketing</option><option value="all" ${f.config.who === 'all' ? 'selected' : ''}>Every buyer (as non-marketing contacts)</option></select></div>` : ''}
      <label class="check"><input type="checkbox" data-bind="ui.ig.active" data-t="bool" ${f.active !== false ? 'checked' : ''}> <span>Active</span></label>
      <div class="row" style="margin-top:10px"><button class="btn btn-accent" data-action="igSave">Save</button><button class="btn btn-ghost" data-action="igCancel">Cancel</button></div></div>`; })() : '';
  return `${form}<div class="cols"><div class="stack">${can('admin.integrations') ? `<div class="card"><h3>Connections</h3>
      ${igs.map(g => `<div class="item-card" style="margin-top:10px"><div class="between"><span><b>${esc(g.name)}</b> <span class="chip mini">${esc(INTEGRATIONS[g.kind]?.name || g.kind)}</span> ${g.active ? '<span class="chip ok mini">active</span>' : '<span class="chip mini">off</span>'}</span>
          <span class="row"><button class="btn btn-ghost btn-sm" data-action="igTest" data-id="${g.id}">Test</button><button class="btn btn-ghost btn-sm" data-action="igEdit" data-id="${g.id}">Edit</button><button class="btn btn-ghost btn-sm" data-action="igDel" data-id="${g.id}">Disconnect</button></span></div>
        <div class="small muted">${g.kind === 'webhook' ? esc(g.config.url) + ' · ' + esc((g.config.events || []).map(e => HOOK_EVENTS[e]).join(', ')) : INTEGRATIONS[g.kind]?.crm ? (g.config.who === 'all' ? 'every buyer' : 'opted-in buyers') + (g.config.list ? ' → list ' + esc(g.config.list) : '') : esc(g.config.pixel || '')}
          · key ${esc(g.secret_hint || '—')}${g.last_at ? ' · last sent ' + esc(ago(g.last_at)) : ''}${g.last_error ? ` · <span style="color:var(--bad)">${esc(g.last_error)}</span>` : ''}</div></div>`).join('') || '<p class="small muted" style="margin-top:6px">Nothing connected yet.</p>'}
      <div class="sep"></div><div class="fl">Connect</div><div class="row wrap">${Object.entries(INTEGRATIONS).map(([k, d]) => `<button class="btn btn-ghost btn-sm" data-action="igNew" data-v="${k}">${esc(d.name)}</button>`).join('')}</div>
      <p class="small muted" style="margin-top:10px">Your own customer list stays here either way — CRMs get a copy.</p></div>
    <div class="card"><h3>Recent deliveries</h3>${dl.map(d => `<div class="between small line click" data-action="dlOpen" data-id="${d.id}"><span><b>${esc(HOOK_EVENTS[d.event] || d.event)}</b> → ${esc(igs.find(g => g.id === d.integration_id)?.name || d.kind)}<div class="muted">${esc(fmtDT(d.created_at))} · attempt ${d.attempts}${d.response ? ' · ' + esc(String(d.response).slice(0, 60)) : ''}</div></span>
        <span class="chip mini ${d.status === 'delivered' ? 'ok' : d.status === 'failed' ? 'bad' : 'info'}">${esc(d.status)}</span></div>`).join('') || '<p class="small muted" style="margin-top:6px">None yet.</p>'}</div>` : ''}</div>
    <div class="stack">${can('admin.api') ? `<div class="card"><h3>API keys</h3><p class="small muted" style="margin:4px 0 10px">Read-only access for your own systems. A key is shown once; only its fingerprint is stored.</p>
      ${keys.map(k => `<div class="between small line"><span><b>${esc(k.name)}</b> <code>${esc(k.prefix)}…</code><div class="muted">${esc(k.scopes.map(s => API_SCOPES[s]).join(', '))} · created ${esc(fmtDate(k.created_at, { month: 'short', day: 'numeric' }))}${k.last_used_at ? ' · used ' + esc(ago(k.last_used_at)) : ''}</div></span>
        ${k.revoked_at ? '<span class="chip mini bad">revoked</span>' : `<button class="btn btn-ghost btn-sm" data-action="keyRevoke" data-id="${k.id}">Revoke</button>`}</div>`).join('') || '<p class="small muted">No keys.</p>'}
      <div class="sep"></div><div class="field"><label class="fl">New key</label><input class="inp" data-input="key.name" value="${esc(S.ui.key?.name || '')}" placeholder="e.g. Website event listing"></div>
      <div class="chips">${Object.entries(API_SCOPES).map(([k, l]) => `<button type="button" class="chip-btn ${(S.ui.key?.scopes || ['events:read']).includes(k) ? 'on' : ''}" data-action="keyScope" data-v="${k}">${l}</button>`).join('')}</div>
      <button class="btn btn-dark btn-sm" style="margin-top:10px" data-action="keyCreate">Create key</button></div>` : ''}
    <div class="card"><h3>For developers</h3><p class="small muted" style="margin-top:6px">API: <code>GET …/functions/v1/api/v1/events</code> (also <code>orders</code>, <code>tickets</code>, <code>customers</code>) with <code>Authorization: Bearer set_live_…</code>, <code>?since=</code> and <code>?limit=</code>. 120 requests a minute.</p>
      <p class="small muted">Webhooks: JSON <code>{id, type, created, data}</code> POSTed with <code>SET-Signature: t=…,v1=…</code> = HMAC-SHA256 of <code>t + "." + body</code> with your signing secret. Failed deliveries retry with back-off for about a day.</p></div></div></div>`;
}
// ── the buyer's preferences page (#/unsubscribe/<token>) ──
function Unsubscribe() {
  const u = S.unsub;
  if (!u) return `<div class="wrap" style="padding:60px 16px"><div class="empty">Loading…</div></div>`;
  if (u.error) return `<div class="wrap" style="padding:60px 16px"><div class="card" style="max-width:480px;margin:0 auto"><h2>Link not valid</h2><p class="muted" style="margin-top:8px">${esc(u.error)}</p></div></div>`;
  return `<div class="wrap" style="padding:60px 16px"><div class="card" style="max-width:480px;margin:0 auto"><div class="eyebrow">${esc(u.box_office)}</div><h2 style="margin:6px 0 4px">Email & text preferences</h2><p class="small muted">${esc(u.email)}</p>
    <label class="check" style="margin-top:16px"><input type="checkbox" data-bind="ui.unsub.email" data-t="bool" ${S.ui.unsub.email ? 'checked' : ''}> <span>News and offers by email</span></label>
    ${u.has_phone ? `<label class="check" style="margin-top:8px"><input type="checkbox" data-bind="ui.unsub.sms" data-t="bool" ${S.ui.unsub.sms ? 'checked' : ''}> <span>Texts (marketing and event updates)</span></label>` : ''}
    <p class="small muted" style="margin-top:12px">Your tickets and messages about events you've booked still arrive by email either way.</p>
    <div class="row" style="margin-top:14px"><button class="btn btn-accent" data-action="unsubSave">Save preferences</button><button class="btn btn-ghost" data-action="unsubAll">Unsubscribe from everything</button></div>
    ${u.saved ? '<p class="small" style="margin-top:10px;color:var(--ok)">Saved.</p>' : ''}</div></div>`;
}
// marketing & consent for one customer (the customer page)
function CustomerConsent(email, c, phone) {
  const ed = can('comms.consent'), cu = S.ui.cc?.email === email ? S.ui.cc : (S.ui.cc = { email, source: '', tag: '' });
  const mails = (S.adm.outbox || []).filter(m => m.email === email || m.to === email).sort((a, b) => D(b.send_at || b.at) - D(a.send_at || a.at)).slice(0, 15);
  const st = !c ? 'No consent recorded — gets ticket and event emails only.' : c.suppressed ? `Suppressed (${esc(c.suppressed)}) since ${esc(fmtDT(c.suppressed_at))} — no email at all.` : c.email_optin && !c.unsub_email_at ? `Opted in ${esc(fmtDT(c.email_optin_at))} · ${esc(c.email_optin_src || '')}` : c.unsub_email_at ? `Unsubscribed ${esc(fmtDT(c.unsub_email_at))}` : 'Not opted in to marketing.';
  const sm = !c?.phone && !phone ? 'No mobile number.' : c?.unsub_sms_at ? `Replied STOP ${esc(fmtDT(c.unsub_sms_at))} — no texts.` : c?.sms_optin ? `Opted in to texts ${esc(fmtDT(c.sms_optin_at))} · ${esc(c.sms_optin_src || '')}` : 'Event and ticket texts only (no marketing opt-in).';
  const b = (v, l) => `<button class="btn btn-ghost btn-sm" data-action="ctAct" data-v="${v}" data-email="${esc(email)}">${l}</button>`;
  return `<div class="card"><h3>Marketing & consent</h3><div class="small" style="margin-top:6px"><b>Email:</b> ${st}</div><div class="small" style="margin-top:4px"><b>Texts:</b> ${sm}</div>
    <div style="margin-top:8px">${(c?.tags || []).map(t => `<span class="chip mini">${esc(t)}${ed ? ` <a href="#" data-action="ctUntag" data-email="${esc(email)}" data-v="${esc(t)}" title="Remove">×</a>` : ''}</span>`).join(' ') || '<span class="small muted">No tags.</span>'}</div>
    ${ed ? `<div class="sep"></div><div class="row wrap"><input class="inp inp-sm" style="width:150px" data-input="cc.tag" value="${esc(cu.tag)}" placeholder="Add tag"><button class="btn btn-ghost btn-sm" data-action="ctTag" data-email="${esc(email)}">Tag</button></div>
      <div class="row wrap" style="margin-top:8px"><input class="inp inp-sm" style="flex:1;min-width:180px" data-input="cc.source" value="${esc(cu.source)}" placeholder="How they gave consent (for opt-ins)">
        ${!(c?.email_optin && !c.unsub_email_at) ? b('optin', 'Record email opt-in') : b('optout', 'Unsubscribe')}${c?.phone ? (c.unsub_sms_at ? b('sms_start', 'Allow texts') : !c.sms_optin ? b('sms_optin', 'Record text opt-in') : b('sms_optout', 'Stop texts')) : ''}${c?.suppressed ? b('unsuppress', 'Remove suppression') : b('suppress', 'Suppress email')}</div>` : ''}
    <div class="sep"></div><div class="fl">Messages</div>${mails.map(m => `<div class="between small line click" data-action="msgOpen" data-id="${m.id}"><span>${esc(kindLabel(m))}<div class="muted">${esc(fmtDT(m.sent_at || m.send_at || m.at))}</div></span>${msgChip(m)}</div>`).join('') || '<p class="small muted">None.</p>'}</div>`;
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
      <p class="small muted">Custom domain and sending domain: <a href="#/admin/settings">Settings</a>.</p></div>
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

const feeText = f => `${+f.pct || 0}% + ${money(+f.fixed || 0)} per paid ticket, paid by ${f.payer === 'buyer' ? 'the buyer (shown as a service fee)' : 'the organizer (from payouts)'}`;
// Payments: the box office connects its OWN processor account; money goes straight to it. One gateway interface, many processors.
function PaymentsCard(s, c) {
  const g = S.adm.bo.gateway, gw = g && GATEWAYS[g.provider], pick = S.ui.gwPick || (DB.live ? 'stripe' : 'demo');
  return `<div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Payments</div>
    ${g ? `<div class="item-card"><div class="between"><b>${esc(gw?.name || g.provider)}</b><span class="chip ${g.status === 'connected' ? 'ok' : 'warn'}">${g.status === 'connected' ? 'Connected' : 'Finish setup'}${g.test ? ' · test mode' : ''}</span></div>
        <p class="small muted" style="margin-top:6px">${esc((gw?.methods || []).join(' · '))}${g.account ? ` · account <code>${esc(g.account)}</code>` : ''}. Payouts go straight to this account; the platform fee is taken automatically.</p>
        <div class="row wrap" style="margin-top:10px">${g.status !== 'connected' ? `<button class="btn btn-accent btn-sm" data-action="gwConnect" data-v="${esc(g.provider)}">Continue setup</button>` : ''}<button class="btn btn-ghost btn-sm" data-action="gwDisconnect">Disconnect</button>
          ${g.status === 'connected' ? `<button class="btn ${g.disabled ? 'btn-danger' : 'btn-ghost'} btn-sm" data-action="gwPause">${ic('pause', 13)} ${g.disabled ? 'Paused — resume card payments' : 'Pause card payments'}</button>` : ''}</div></div>`
      : `<p class="small muted" style="margin-bottom:10px">Connect your own payment account to take cards, Apple Pay and Google Pay. Payouts go straight to you.</p>
        <div class="field"><label class="fl">Payment processor</label><select class="inp" data-input="gwPick" data-rr="1">${Object.entries(GATEWAYS).filter(([k]) => k !== 'demo' || !DB.live).map(([k, x]) => `<option value="${k}" ${pick === k ? 'selected' : ''}>${esc(x.name)}${x.adapter ? '' : ' — on request'}</option>`).join('')}</select>
        <div class="small muted" style="margin-top:4px">${esc(GATEWAYS[pick]?.how || '')} · ${esc((GATEWAYS[pick]?.methods || []).join(', '))}</div></div>
        <button class="btn btn-accent btn-sm" data-action="gwConnect" data-v="${esc(pick)}">Connect ${esc(GATEWAYS[pick]?.name || '')}</button>`}
    <div style="margin-top:14px">${c('payments.card', 'Accept card payments')}${c('payments.offline', 'Allow “pay later / at the door” reservations (tickets issued when you mark them paid)')}
      ${c('passProcessing', `Pass the card processing fee to buyers${gw ? ` (${optNum(g.pct, gw.pct)}% + ${money(optNum(g.fixed, gw.fixed))})` : ''}`)}</div></div>`;
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
      ${c('taxOnFees', 'Charge sales tax on booking and service fees too')}
      ${c('donations', 'Offer a donation at checkout')}
      ${s.donations ? `<div class="grid2"><div class="field"><label class="fl">Suggested amounts ($)</label><input class="inp" data-input="donAmts" value="${esc((S.ui.donAmts ?? (s.donationAmounts || DEFAULT_SETTINGS.donationAmounts).map(v => v / 100).join(', ')))}" placeholder="18, 36, 100"></div>${f('donationPurpose', 'What donations support')}</div>${c('donationCustom', 'Let buyers type their own amount')}` : ''}
      <p class="small muted">Platform fee: ${esc(feeText(platformFeeFor(S.platform, S.adm.bo)))} — set by the platform.</p></div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Checkout</div>
      <div class="grid2"><div class="field"><label class="fl">Mobile number</label><select class="inp" data-bind="set.checkout.phone">${[['off', 'Don\'t ask'], ['optional', 'Optional'], ['required', 'Required']].map(([v, t]) => `<option value="${v}" ${s.checkout?.phone === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label class="fl">Address</label><select class="inp" data-bind="set.checkout.address">${[['off', 'Don\'t ask'], ['optional', 'Optional'], ['required', 'Required']].map(([v, t]) => `<option value="${v}" ${s.checkout?.address === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
      ${c('checkout.promo', 'Show the promo / referral code box')}${c('checkout.optIn', 'Offer the marketing email opt-in')}${c('checkout.smsOptIn', 'Offer the marketing text opt-in (when a mobile number is given)')}
      ${f('checkout.note', 'Message at the top of checkout')}${f('checkout.thanks', 'Message on the confirmation page')}</div>
    <div class="card">${QEditor('set', 'questions', s.questions || [], [])}</div>
    ${SellingCards(s, f, c)}
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Staff security</div>${c('require2fa', 'Require two-factor sign-in for everyone on this team')}
      ${f('sessionMinutes', 'Sign staff out after this many minutes without activity', 'num', '0 = never. Applies to the back office and scanner.')}
      <p class="small muted">People without it are asked to set it up before they can see anything. <a href="#/admin/security">Set up yours</a>.</p></div>
  </div><div class="stack">
    ${can('admin.payments') ? PaymentsCard(s, c) : ''}
    ${can('admin.integrations') ? `<div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Tracking</div>${f('pixels.ga4', 'Google Analytics 4 ID', 'text', 'e.g. G-XXXXXXX')}${f('pixels.meta', 'Meta Pixel ID')}${f('pixels.tiktok', 'TikTok Pixel ID')}
      ${c('pixels.consent', 'Ask visitors before loading pixels (cookie banner)')}<p class="small muted">Server-side Meta Conversions API, CRMs and webhooks: <a href="#/admin/marketing/integrations">Marketing → Integrations</a>.</p></div>` : ''}
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Email sender</div>${f('mail.fromName', 'Sender name', 'text', 'Shown as the “from” name — defaults to the box office name')}${f('mail.replyTo', 'Reply-to address', 'email', 'Where customer replies go')}
      ${f('mail.alerts', 'Where failed-email alerts go', 'email', 'Blank = the customer service email')}</div>
    ${MailDomainCard()}${DomainCard()}${PlanCard()}
    ${can('admin.api') ? `<div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Developers</div><p class="small muted">Read-only API keys, webhooks and CRM connections are on <a href="#/admin/marketing/integrations">Marketing → Integrations</a>.</p>
      ${!DB.live ? `<div class="sep"></div><button class="btn btn-danger btn-sm" data-action="demoReset">Reset demo data</button>` : ''}</div>` : ''}
    ${VersionsCard(S.adm.bo.id, 'restoreSettings')}
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
const PNAV = [['overview', 'Overview', 'home'], ['boxoffices', 'Box offices', 'ticket'], ['events', 'All events', 'cal'], ['staff', 'Staff & users', 'users'], ['billing', 'Plans & billing', 'tag'], ['risk', 'Risk & fraud', 'flag'],
  ['health', 'System health', 'pulse'], ['incidents', 'Incidents', 'bolt'], ['activity', 'Activity log', 'chart'], ['settings', 'Platform settings', 'gear']];
function PlatformShell() {
  if (!S.user || S.user.mfa) return Login('Platform sign in', 'open the platform dashboard');
  if (!S.adm?.super) return `<div class="empty" style="padding-top:20vh"><div class="display" style="font-size:32px">Super admins only</div><p class="muted" style="margin:10px 0 18px">${esc(S.user.email)} isn't a platform administrator.</p><a class="btn btn-dark" href="#/admin">Go to my box office</a></div>`;
  if (!S.plat) { DB.loadPlatform().then(p => { S.plat = p; render(); }).catch(e => toast(e.message, true)); return `<div class="empty" style="padding-top:30vh">Loading…</div>`; }
  const sub = S.route.params[0] || 'overview', page = { overview: POverview, boxoffices: PBoxOffices, events: PEvents, staff: PStaff, billing: PBilling, risk: PRisk, health: PHealth, incidents: PIncidents, activity: PActivity, settings: PSettings }[sub] || POverview;
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
  return head('Platform overview', `${P.bos.length} box offices · ${esc(P.platform.name)}`, `<button class="btn btn-ghost" data-action="platXp">Export platform data</button><button class="btn btn-accent" data-action="newBo">${ic('plus', 15)} New box office</button>`) + `
  ${pend.length ? `<div class="banner warn" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><span><b>${pend.length} waiting for approval:</b> ${pend.map(b => esc(b.name)).join(', ')}</span><a class="btn btn-dark btn-sm" href="#/platform/boxoffices">Review</a></div>` : ''}
  <div class="kpis"><div class="kpi dark"><div class="eyebrow">Processing volume</div><div class="v">${money(sum(live, o => o.total))}</div><div class="d" style="color:var(--mut)">${money(sum(live.filter(o => D(o.created_at) >= since), o => o.total))} last 30 days</div></div>
    <div class="kpi"><div class="eyebrow">Platform fees earned</div><div class="v">${money(sum(live, o => o.platformFee))}</div><div class="d">${esc(P.platform.feePct)}% + ${money(P.platform.feeFixed)} / paid ticket</div></div>
    <div class="kpi"><div class="eyebrow">Tickets sold</div><div class="v">${sum(P.bos, b => b.stats.tickets).toLocaleString()}</div><div class="d">${live.length} orders</div></div>
    <div class="kpi"><div class="eyebrow">Box offices</div><div class="v">${by('active')}</div><div class="d">${by('pending')} pending · ${by('suspended')} suspended · ${sum(P.bos, b => b.stats.staff)} staff</div></div></div>
  <div class="cols"><div class="card"><h3>Platform sales</h3><div class="small muted">Gross across every box office, last 28 days</div>${barChart(dailySeries(live.map(o => ({ ...o, data: { total: o.total } })), 28, o => o.data.total), v => money(v))}</div>
    <div class="card"><div class="between"><h3>System health</h3><a class="small" href="#/platform/health">Details</a></div>${HEALTH_PARTS.map(([k, n]) => { const [cls, lbl] = HEALTH_CHIP[P.health?.parts?.[k] || 'ok'];
      return `<div class="between small" style="padding:7px 0;border-bottom:1px solid var(--line)"><span>${n}</span><span class="chip ${cls}">${lbl}</span></div>`; }).join('')}
      ${(P.flagged || []).filter(o => !o.review).length ? `<p class="small" style="margin-top:10px"><a href="#/platform/risk">${(P.flagged || []).filter(o => !o.review).length} flagged orders to review</a></p>` : ''}</div></div>
  <div class="card" style="margin-top:18px"><div class="between" style="margin-bottom:8px"><h3>Latest platform activity</h3><a class="small" href="#/platform/activity">All activity</a></div>
    ${P.audit.slice(0, 8).map(a => `<div class="between small" style="padding:7px 0;border-bottom:1px solid var(--line)"><span><b>${esc(a.actor)}</b> · ${esc(a.summary)}</span><span class="muted">${esc(ago(a.at))}</span></div>`).join('')}</div>`;
}
function PBoxOffices() {
  const P = S.plat;
  return head('Box offices', 'Create, approve, suspend and support organizer accounts', `<button class="btn btn-accent" data-action="newBo">${ic('plus', 15)} New box office</button>`) + `
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Box office</th><th>Status</th><th>Owner</th><th>Events</th><th>Sales</th><th>Fees earned</th><th>Staff</th><th></th></tr></thead><tbody>
  ${P.bos.slice().sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0) || a.name.localeCompare(b.name)).map(b => `<tr><td><b>${esc(b.name)}</b><div class="small muted">/b/${esc(b.slug)} · since ${esc(fmtDate(b.created_at, { month: 'short', year: 'numeric' }))}${b.created_by === 'self-registration' ? ' · self-registered' : ''}</div></td>
    <td>${boChip(b.status)}</td><td class="small">${esc(b.owner)}</td><td class="tnum">${b.stats.events}</td><td class="tnum">${money(b.stats.gross)}<div class="small muted">${b.stats.orders} orders</div></td><td class="tnum">${money(b.stats.platformFees)}<div class="small muted">${b.platformFee ? 'custom fee' : 'default fee'} · <a href="#" data-action="boFee" data-id="${b.id}">change</a></div></td><td class="tnum">${b.stats.staff}</td>
    <td style="white-space:nowrap;text-align:right">${b.status === 'pending' ? `<button class="btn btn-accent btn-sm" data-action="boStatus" data-id="${b.id}" data-v="active">Approve</button> <button class="btn btn-ghost btn-sm" data-action="boStatus" data-id="${b.id}" data-v="deactivated">Decline</button>`
      : b.status === 'active' ? `<button class="btn btn-ghost btn-sm" data-action="support" data-id="${b.id}">Open (support)</button> <button class="btn btn-ghost btn-sm" data-action="boStatus" data-id="${b.id}" data-v="suspended">Suspend</button>`
      : b.status === 'suspended' ? `<button class="btn btn-dark btn-sm" data-action="boStatus" data-id="${b.id}" data-v="active">Reactivate</button> <button class="btn btn-ghost btn-sm" data-action="boStatus" data-id="${b.id}" data-v="deactivated">Deactivate</button>`
      : `<button class="btn btn-ghost btn-sm" data-action="boStatus" data-id="${b.id}" data-v="active">Reactivate</button> ${b.stats.orders ? '<span class="small muted" title="Has sales history">records kept</span>' : `<button class="btn btn-danger btn-sm" data-action="boDelete" data-id="${b.id}">Delete…</button>`}`}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="cols" style="margin-top:18px"><div class="card small"><h3>What each status means</h3><p class="muted" style="margin-top:6px"><b>Suspended</b> — event pages and checkout go offline and staff can't sign in; nothing is deleted. <b>Deactivated</b> — closed for good, all records kept and still exportable. <b>Delete</b> is separate and only possible for a deactivated box office that never sold a ticket, so order and financial history can't be erased by accident.</p></div>
  <div class="card small"><h3>Support access</h3><p class="muted" style="margin-top:6px">“Open (support)” lets you into an organizer's back office with full access to troubleshoot. It's shown to you as a banner and every visit is written to that box office's activity log.</p></div></div>`;
}
function PlatformFeeModal(id) {
  const b = S.plat.bos.find(x => x.id === id), cur = b.platformFee || {}, P = S.plat.platform;
  S.ui.bf = { useDefault: !b.platformFee, pct: cur.pct ?? '', fixed: cur.fixed === '' || cur.fixed == null ? '' : cur.fixed / 100, payer: cur.payer || '' };
  modal(`Platform fee — ${esc(b.name)}`, `<p class="small muted" style="margin-bottom:12px">Platform default: ${esc(feeText({ pct: P.feePct, fixed: P.feeFixed, payer: P.feePayer }))}. Leave a box blank to use the default.</p>
    <div class="grid2"><div class="field"><label class="fl">Percent of sales</label><input class="inp" type="number" step="0.1" data-input="bf.pct" value="${esc(S.ui.bf.pct)}" placeholder="${esc(P.feePct)}"></div>
      <div class="field"><label class="fl">Per paid ticket ($)</label><input class="inp" type="number" step="0.01" data-input="bf.fixed" value="${esc(S.ui.bf.fixed)}" placeholder="${esc(+P.feeFixed / 100)}"></div></div>
    <div class="field"><label class="fl">Who pays</label><select class="inp" data-input="bf.payer"><option value="">Platform default</option><option value="organizer" ${cur.payer === 'organizer' ? 'selected' : ''}>The organizer</option><option value="buyer" ${cur.payer === 'buyer' ? 'selected' : ''}>The buyer (service fee)</option></select></div>`,
    `<button class="btn btn-ghost" data-action="closeModal">Cancel</button><button class="btn btn-accent" data-action="saveBoFee" data-id="${b.id}">Save</button>`);
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
  const f = S.ui.ps || (S.ui.ps = JSON.parse(JSON.stringify({ ...DEFAULT_PLATFORM, ...S.plat.platform, adminsText: S.plat.platform.admins.join(', '), appHostsText: (S.plat.platform.appHosts || DEFAULT_PLATFORM.appHosts).join(', '),
    off: Object.fromEntries((S.plat.platform.gatewaysOff || []).map(k => [k, true])), planList: (S.plat.platform.planList || DEFAULT_PLANS).map(p => ({ ...p, monthly: (p.monthly || 0) / 100, feeFixed: p.feeFixed === '' ? '' : p.feeFixed / 100 })) })));
  return head('Platform settings', 'Applies to every box office', `<button class="btn btn-accent" data-action="savePlatform">Save</button>`) + `
  <div class="cols"><div class="stack"><div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Registration</div>
      <label class="check" style="margin-bottom:8px"><input type="checkbox" data-bind="ui.ps.publicRegistration" data-t="bool" ${f.publicRegistration ? 'checked' : ''}> <span>Allow organizers to register a box office themselves at <code>#/register</code></span></label>
      <label class="check" style="margin-bottom:8px"><input type="checkbox" data-bind="ui.ps.autoApprove" data-t="bool" ${f.autoApprove ? 'checked' : ''}> <span>Approve new sign-ups automatically (self-serve)</span></label>
      <p class="small muted">Off at launch. Without auto-approve, every new box office waits for a super admin's approval before it can sell.</p></div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Platform fees</div><div class="grid2">
      <div class="field"><label class="fl">Percent of ticket sales</label><input class="inp" type="number" step="0.1" data-bind="ui.ps.feePct" data-t="num" value="${esc(f.feePct)}"></div>
      <div class="field"><label class="fl">Per paid ticket</label><input class="inp" type="number" step="0.01" data-bind="ui.ps.feeFixed" data-t="money" value="${esc(+f.feeFixed / 100)}"></div></div>
      <div class="field"><label class="fl">Who pays it</label><select class="inp" data-bind="ui.ps.feePayer"><option value="organizer" ${f.feePayer !== 'buyer' ? 'selected' : ''}>The organizer — deducted from payouts, buyers don't see it</option><option value="buyer" ${f.feePayer === 'buyer' ? 'selected' : ''}>The buyer — added at checkout as a “service fee”</option></select></div>
      <p class="small muted">Recorded on each order and taken automatically as the processor's application fee. Override it for one box office from Box offices → Fee. Box offices set their own booking fees separately.</p>
      </div>
    <div class="card"><div class="between"><div class="eyebrow dash">Plans</div><button class="btn btn-ghost btn-sm" data-action="addPlan">${ic('plus', 14)} Add plan</button></div>
      <p class="small muted" style="margin:6px 0 10px">The money model: each plan has a monthly price and its own platform fee (blank = the default above). Organizers pick one at sign-up and can switch in Settings.</p>
      ${f.planList.map((p, i) => `<div class="item-card"><div class="grid2"><div class="field"><label class="fl">Name</label><input class="inp" data-bind="ui.ps.planList.${i}.name" value="${esc(p.name)}"></div><div class="field"><label class="fl">Monthly ($)</label><input class="inp" type="number" step="0.01" data-bind="ui.ps.planList.${i}.monthly" value="${esc(p.monthly)}"></div></div>
        <div class="grid2"><div class="field"><label class="fl">Platform fee %</label><input class="inp" data-bind="ui.ps.planList.${i}.feePct" value="${esc(p.feePct)}" placeholder="default"></div><div class="field"><label class="fl">Per paid ticket ($)</label><input class="inp" data-bind="ui.ps.planList.${i}.feeFixed" value="${esc(p.feeFixed)}" placeholder="default"></div></div>
        <div class="field"><label class="fl">Description</label><input class="inp" data-bind="ui.ps.planList.${i}.blurb" value="${esc(p.blurb || '')}"></div>
        <div class="between"><label class="check small"><input type="radio" name="defplan" data-action="defPlan" data-v="${esc(p.id)}" ${f.defaultPlan === p.id ? 'checked' : ''}> <span>Default for new box offices</span></label>${f.planList.length > 1 ? `<button class="btn btn-ghost btn-sm" data-action="delPlan" data-i="${i}">Remove</button>` : ''}</div></div>`).join('')}
      <div class="field"><label class="fl">Invoice payment terms (days)</label><input class="inp" type="number" data-bind="ui.ps.invoiceDays" data-t="num" value="${esc(f.invoiceDays)}"></div></div></div>
  <div class="stack"><div class="card"><div class="eyebrow dash" style="margin-bottom:12px">General</div><div class="field"><label class="fl">Platform name</label><input class="inp" data-bind="ui.ps.name" value="${esc(f.name)}"></div>
    <div class="field"><label class="fl">Super admins</label><input class="inp" data-bind="ui.ps.adminsText" value="${esc(f.adminsText)}"><div class="small muted" style="margin-top:4px">Comma-separated emails. Super admins can see and manage every box office.</div></div></div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Payment processors</div><p class="small muted" style="margin-bottom:10px">Emergency switch: turn a processor off for every box office (checkout says card payments are paused).</p>
      ${Object.entries(GATEWAYS).map(([k, g]) => `<label class="check" style="margin-bottom:6px"><input type="checkbox" data-bind="ui.ps.off.${k}" data-t="bool" ${f.off?.[k] ? 'checked' : ''}> <span>${esc(g.name)} switched off</span></label>`).join('')}</div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Domains & integrations</div>
      <div class="field"><label class="fl">Custom domains point at (CNAME target)</label><input class="inp" data-bind="ui.ps.domainTarget" value="${esc(f.domainTarget || '')}"></div>
      <div class="field"><label class="fl">The platform's own hosts</label><input class="inp" data-bind="ui.ps.appHostsText" value="${esc(f.appHostsText)}"><div class="small muted" style="margin-top:4px">Any other host name is looked up as a box office's custom domain.</div></div>
      <p class="small muted">API keys and webhooks are per box office (Marketing → Integrations) and follow each person's permissions.</p></div></div></div>`;
}

// ── Public: a box office's own page, and self-registration ──────────────────────
function BoxOfficePage() {
  const bo = S.bos.find(b => b.slug === S.route.params[0]); if (!bo) return NotFound();
  const br = bo.branding, all = listedEvents().filter(e => e.box_office_id === bo.id), evs = filterEvents(all);
  const soc = [['website', br.website, br.website], ['instagram', br.instagram, br.instagram && 'https://instagram.com/' + br.instagram.replace(/^@/, '')], ['facebook', br.facebook, br.facebook], ['tiktok', br.tiktok, br.tiktok && 'https://tiktok.com/@' + br.tiktok.replace(/^@/, '')]].filter(x => safeUrl(x[2]));
  return `<header class="bo-hero" style="${safeUrl(br.banner) ? `background-image:linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.7)),url('${safeUrl(br.banner)}')` : ''}"><div class="container">
      ${safeUrl(br.logo) ? `<img class="bo-logo" src="${esc(safeUrl(br.logo))}" alt="${esc(bo.name)}">` : ''}<h1 class="display">${esc(bo.name)}</h1>${br.tagline ? `<p>${esc(br.tagline)}</p>` : ''}
      ${soc.length ? `<div class="row wrap" style="margin-top:14px">${soc.map(([k, , u]) => `<a class="btn glass btn-sm" href="${esc(u)}" target="_blank" rel="noopener">${k[0].toUpperCase() + k.slice(1)}</a>`).join('')}</div>` : ''}</div></header>
    <section class="container section"><div class="eyebrow dash" style="margin-bottom:16px">Upcoming events</div>
      ${giftSettings(bo.settings).on || (bo.settings.passPlans || []).some(p => p.onSale !== false) ? `<div class="row wrap" style="margin-bottom:16px">${giftSettings(bo.settings).on ? `<a class="btn btn-ghost" href="#/gift/${esc(bo.slug)}">${ic('tag', 14)} Gift cards</a>` : ''}${(bo.settings.passPlans || []).some(p => p.onSale !== false) ? `<a class="btn btn-ghost" href="#/member/${esc(bo.slug)}">${ic('users', 14)} Memberships & season passes</a>` : ''}</div>` : ''}
      ${all.length > 1 ? EventFilters(all) : ''}
      ${evs.length ? `<div class="ev-grid">${evs.map(EvCard).join('')}</div>` : `<div class="empty">${all.length ? 'No events match — try a different search.' : 'No events on sale right now — check back soon.'}</div>`}</section>
    <section class="container section" style="padding-top:0"><div class="cols"><div class="card"><h3>Contact</h3><p class="small" style="margin-top:6px">${bo.settings.contactEmail ? `<a href="mailto:${esc(bo.settings.contactEmail)}">${esc(bo.settings.contactEmail)}</a>` : ''}${br.phone ? '<br>' + esc(br.phone) : ''}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" data-action="contactOrg" data-bo="${bo.id}">${ic('mail', 14)} Send a message</button></div>
      <div class="card"><h3>Policies</h3><p class="small" style="margin-top:6px"><a href="#" data-action="showPolicy" data-v="terms">Terms</a>${br.refundPolicy ? ' · <a href="#" data-action="showPolicy" data-v="refundPolicy">Refunds</a>' : ''}${br.privacyPolicy ? ' · <a href="#" data-action="showPolicy" data-v="privacyPolicy">Privacy</a>' : ''}</p></div></div></section>`;
}
function Register() {
  const f = S.ui.reg || (S.ui.reg = { name: '', ownerName: '', ownerEmail: '', done: false });
  if (!S.platform.publicRegistration) return `<div class="container section"><div class="empty"><div class="display" style="font-size:34px">Invitation only</div><p class="muted" style="margin:10px 0 18px">New box offices are set up by the platform team. Get in touch and we'll create yours.</p><a class="btn btn-dark" href="#/">Back to events</a></div></div>`;
  if (f.done) return `<div class="container section"><div class="empty"><div class="display" style="font-size:34px">${f.active ? 'Your box office is ready' : 'Request received'}</div><p class="muted" style="margin:10px 0 18px">${f.active ? `Sign in with ${esc(f.ownerEmail)} to set up <b>${esc(f.name)}</b> — a checklist walks you through payments and your first event.` : `We'll review <b>${esc(f.name)}</b> and email ${esc(f.ownerEmail)} once it's approved.`}</p>${f.active ? '<a class="btn btn-accent" href="#/admin">Sign in</a>' : ''}</div></div>`;
  return `<div class="container section" style="max-width:520px"><div class="card"><h1 class="display" style="font-size:32px">Start selling tickets</h1><p class="muted" style="margin:6px 0 18px">Tell us about your organization. Every new box office is reviewed before it goes live.</p>
    <div class="field"><label class="fl">Organization name</label><input class="inp" data-input="reg.name" value="${esc(f.name)}"></div>
    <div class="grid2"><div class="field"><label class="fl">Your name</label><input class="inp" data-input="reg.ownerName" value="${esc(f.ownerName)}"></div><div class="field"><label class="fl">Work email</label><input class="inp" type="email" data-input="reg.ownerEmail" value="${esc(f.ownerEmail)}"></div></div>
    <div class="field"><label class="fl">Phone (optional)</label><input class="inp" type="tel" data-input="reg.phone" value="${esc(f.phone || '')}"></div>
    <div class="eyebrow dash" style="margin:14px 0 10px">Choose a plan</div><div class="plans">${(S.platform.planList || DEFAULT_PLANS).map(p => `<label class="plan ${(f.plan || S.platform.defaultPlan || 'pay') === p.id ? 'on' : ''}"><input type="radio" name="plan" data-action="regPlan" data-v="${esc(p.id)}" ${(f.plan || S.platform.defaultPlan || 'pay') === p.id ? 'checked' : ''}> <b>${esc(p.name)}</b>
      <div class="display" style="font-size:22px">${p.monthly ? money(p.monthly) + '<small>/mo</small>' : 'Free'}</div><div class="small muted">${esc(feeText({ pct: optNum(p.feePct, S.platform.feePct), fixed: optNum(p.feeFixed, S.platform.feeFixed), payer: S.platform.feePayer }))}</div><div class="small">${esc(p.blurb || '')}</div></label>`).join('')}</div>
    <label class="check" style="margin:12px 0"><input type="checkbox" data-action="regAgree" ${f.agree ? 'checked' : ''}> <span>I agree to the platform's organizer terms and pricing.</span></label>
    <button class="btn btn-accent btn-block btn-lg" data-action="register">${S.platform.autoApprove ? 'Create my box office' : 'Request a box office'}</button><p class="small muted" style="margin-top:10px;text-align:center">After approval you'll connect payments (Stripe) and publish your first event — a checklist walks you through it.</p></div></div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  STAGE 10 — event controls & fees, full event report, versions, risk, customer service, plans & billing, domains, platform health
// ══════════════════════════════════════════════════════════════════════════════
function ContactModal(evId, boId, ref) {
  const ev = evId && evById(evId), f = S.ui.ct = { ev: evId || '', bo: boId || ev?.box_office_id || '', name: S.co.name || S.cust?.name || '', email: S.co.email || S.cust?.email || '', ref: ref || '', subject: '', body: '' };
  const to = ev?.contact?.team || ev?.contact?.name || (S.bos.find(b => b.id === f.bo)?.name) || 'the box office';
  modal('Contact the organizer', `<p class="small muted" style="margin-bottom:12px">Your message goes to <b>${esc(to)}</b>${ev ? ` about ${esc(ev.name)}` : ''}. They reply by email.</p>
    <div class="grid2"><div class="field"><label class="fl">Your name</label><input class="inp" data-input="ct.name" value="${esc(f.name)}"></div><div class="field"><label class="fl">Email</label><input class="inp" type="email" data-input="ct.email" value="${esc(f.email)}"></div></div>
    <div class="grid2"><div class="field"><label class="fl">Order number (optional)</label><input class="inp" data-input="ct.ref" value="${esc(f.ref)}"></div><div class="field"><label class="fl">Subject</label><input class="inp" data-input="ct.subject"></div></div>
    <div class="field"><label class="fl">Message</label><textarea class="inp" data-input="ct.body" rows="5"></textarea></div>`,
    `<button class="btn btn-ghost" data-action="closeModal">Cancel</button><button class="btn btn-accent" data-action="sendContact">Send message</button>`);
}

// ── Event tab "Controls & fees": emergency controls (act at once) + basket timeout, waiting room, sale windows, fees & tax, checkout form ──
function EdControls(ev) {
  const live = S.adm.events.find(e => e.id === ev.id) || ev, c = live.controls || {}, canC = can('events.controls', ev.id), q = { ...QUEUE_DEFAULT, ...(ev.queue || {}) }, f = ev.fees || {};
  const areas = ev.seating?.enabled ? [...new Set(Object.values(ev.seating.meta || {}).map(m => m[0]).filter(Boolean))] : [];
  const ruleInputs = (path, per = 'Per ticket ($)') => `<div class="grid3">${inp(path + '.pct', '%', { t: 'text', ph: 'inherit' })}${inp(path + '.fixed', per, { t: 'moneyOpt', ph: 'inherit' })}${sel(path + '.payer', 'Who pays', [['', 'Inherit'], ['buyer', 'Buyer'], ['organizer', 'Organizer absorbs']])}</div>`;
  return `<div class="cols"><div class="stack">
    <div class="card"><div class="between"><h3>Emergency controls</h3>${Object.keys(c).some(k => EV_CONTROLS.some(x => x[0] === k) && c[k]) ? '<span class="chip bad">Active</span>' : '<span class="chip ok">Normal</span>'}</div>
      <p class="small muted" style="margin:4px 0 12px">These act immediately and only on this event — no need to save. Every change is in the History tab.</p>
      ${EV_CONTROLS.map(([k, t, d]) => `<div class="between ctl-row"><div><b>${t}</b><div class="small muted">${d}</div></div>
        <button type="button" class="btn ${c[k] ? 'btn-danger' : 'btn-ghost'} btn-sm" data-action="evControl" data-k="${k}" ${canC ? '' : 'disabled title="Needs the Emergency controls permission"'}>${c[k] ? 'On — turn off' : 'Turn on'}</button></div>`).join('')}
      <div class="field" style="margin-top:10px"><label class="fl">Message buyers see while paused / in maintenance</label><div class="row"><input class="inp" style="flex:1" data-input="ctlMsg" value="${esc(S.ui.ctlMsg ?? c.message ?? '')}" placeholder="e.g. We're adding more seats — back at 2 PM"><button type="button" class="btn btn-ghost btn-sm" data-action="evControlMsg" ${canC ? '' : 'disabled'}>Update</button></div></div>
      ${c.at ? `<p class="small muted">Last changed ${esc(ago(c.at))} by ${esc(c.by || '')}.</p>` : ''}
      <p class="small muted">Hide the event: Details → Who can see it. Switch off card payments: Settings → Payments.</p></div>
    <div class="card"><h3>Basket timeout</h3><p class="small muted" style="margin:4px 0 10px">How long seats picked on the map stay held while the buyer checks out. When it runs out the seats return to sale and the buyer is told.</p>
      <div class="row wrap">${CART_MINUTES.map(m => `<button type="button" class="btn btn-sm ${cartMinutes(ev) === m ? 'btn-dark' : 'btn-ghost'}" data-action="cartMin" data-v="${m}">${m} min</button>`).join('')}
        <div style="width:110px">${inp('cartMinutes', '', { t: 'int', ph: 'exact' })}</div></div></div>
    <div class="card"><h3>Waiting room</h3><p class="small muted" style="margin:4px 0 10px">For big on-sales: buyers join a line and are let in a steady number per minute, first come first served. Only admitted buyers can pick seats or check out.</p>
      ${chk('queue.on', 'Waiting room on for this event')}
      <div class="grid2" style="margin-top:10px">${inp('queue.rate', 'Let in per minute', { t: 'int', ph: String(QUEUE_DEFAULT.rate) })}${inp('queue.passMinutes', 'Minutes to buy once in', { t: 'int', ph: String(QUEUE_DEFAULT.passMinutes) })}</div>
      ${inp('queue.message', 'Message in the line', { ph: 'Presale is busy — you won\'t lose your place.' })}
      ${q.on ? `<p class="small muted">At ${+q.rate || 60} a minute, 1,000 people take about ${Math.ceil(1000 / (+q.rate || 60))} minutes to get in.</p>` : ''}</div>
    <div class="card"><h3>Sale windows</h3><p class="small muted" style="margin:4px 0 10px">The event's own open / close times are on the Details tab, ticket types' on Tickets & pricing. Close one showtime or one seating area separately here.</p>
      <details ${Object.keys(ev.areaSales || {}).length || (ev.timeSlots || []).some(s => s.salesStart || s.salesEnd) ? 'open' : ''}><summary class="small"><b>${(ev.timeSlots || []).length} showtimes · ${areas.length} seating areas</b></summary>
      ${(ev.timeSlots || []).map((s, i) => `<div class="item-card"><b class="small">${esc(fmtDT(s.start))}${s.label ? ' · ' + esc(s.label) : ''}</b><div class="grid2">${inp(`timeSlots.${i}.salesStart`, 'Opens', { t: 'dt' })}${inp(`timeSlots.${i}.salesEnd`, 'Closes', { t: 'dt' })}</div></div>`).join('')}
      ${areas.map(a => `<div class="item-card"><b class="small">${esc(a)}</b><div class="grid2">${inp(`areaSales.${a}.from`, 'Opens', { t: 'dt' })}${inp(`areaSales.${a}.until`, 'Closes', { t: 'dt' })}</div></div>`).join('')}
      </details>${!(ev.timeSlots || []).length && !areas.length ? '<p class="small muted">No showtimes or seating areas on this event.</p>' : ''}</div>
  </div><div class="stack">
    <div class="card"><h3>Fees & tax for this event</h3><p class="small muted" style="margin:4px 0 10px">Blank = the box office's settings (${esc(S.adm.bo.settings.feePct || 0)}% + ${money(S.adm.bo.settings.feeFixed || 0)} booking fee, ${esc(S.adm.bo.settings.taxPct || 0)}% tax). The most specific rule wins: seating area → ticket type → this event.</p>
      <div class="eyebrow" style="margin:6px 0">Booking fee — whole event</div>${ruleInputs('fees')}
      <details style="margin-top:10px"><summary class="small"><b>By ticket type, seating area or product</b> <span class="muted">(${[...(ev.ticketTypes || []).map(t => t.fee), ...areas.map(a => f.areas?.[a]), ...(ev.addons || []).map(a => a.fee)].filter(hasRule).length} set)</span></summary>
      ${(ev.ticketTypes || []).map((t, i) => `<div class="eyebrow" style="margin:10px 0 6px">Ticket type · ${esc(t.name)}</div>${ruleInputs(`ticketTypes.${i}.fee`)}`).join('')}
      ${areas.map(a => `<div class="eyebrow" style="margin:10px 0 6px">Seating area · ${esc(a)}</div>${ruleInputs(`fees.areas.${a}`)}`).join('')}
      ${(ev.addons || []).map((a, i) => `<div class="eyebrow" style="margin:10px 0 6px">Product · ${esc(a.name)} — no fee unless set</div>${ruleInputs(`addons.${i}.fee`, 'Per item ($)')}`).join('')}</details>
      <div class="sep"></div><div class="grid2">${inp('taxPct', 'Sales tax % for this event', { t: 'text', ph: String(S.adm.bo.settings.taxPct || 0) })}${sel('fees.passProcessing', 'Card processing fee', [['', 'Box office setting'], ['yes', 'Buyer pays it'], ['no', 'Organizer absorbs it']])}</div></div>
    <div class="card"><div class="between"><h3>Other fees</h3><button type="button" class="btn btn-ghost btn-sm" data-action="addXFee">${ic('plus', 14)} Add fee</button></div>
      <p class="small muted" style="margin:4px 0 10px">A facility fee, a levy, optional ticket protection… Mandatory fees are added to every order; optional ones are a checkbox at checkout. Each is stored and reported separately.</p>
      ${(f.extra || []).map((x, i) => `<div class="item-card">${inp(`fees.extra.${i}.name`, 'Name')}<div class="grid3">${inp(`fees.extra.${i}.pct`, '%', { t: 'text' })}${inp(`fees.extra.${i}.fixed`, 'Amount ($)', { t: 'moneyOpt' })}${sel(`fees.extra.${i}.per`, 'Charged', [['ticket', 'Per ticket'], ['order', 'Per order']])}</div>
        <div class="between">${chk(`fees.extra.${i}.optional`, 'Optional — the buyer chooses')}<button type="button" class="btn btn-ghost btn-sm" data-action="delXFee" data-i="${i}">Remove</button></div></div>`).join('') || '<p class="small muted">None.</p>'}</div>
    <div class="card"><h3>Checkout form</h3><p class="small muted" style="margin:4px 0 10px">Ask this event's buyers for more than usual. Questions (per order / per ticket), waivers and signatures are on <a href="#/admin/event/${ev.id}/checkout">Page & checkout</a>.</p>
      <div class="grid2">${sel('checkout.phone', 'Mobile number', [['', 'Box office setting'], ['optional', 'Optional'], ['required', 'Required']])}${sel('checkout.address', 'Address', [['', 'Box office setting'], ['optional', 'Optional'], ['required', 'Required']])}</div>
      <div class="row wrap">${['optIn', 'smsOptIn', 'promo'].map(k => `<label class="check"><input type="checkbox" data-bind="draft.checkout.${k}" data-t="bool" ${ev.checkout?.[k] === false ? '' : 'checked'}> <span>${{ optIn: 'Email opt-in', smsOptIn: 'Text opt-in', promo: 'Promo code box' }[k]}</span></label>`).join('')}</div></div>
    <div class="card"><h3>Donations</h3>${chk('donation.off', 'No donation step for this event')}${inp('donation.purpose', 'What donations to this event support', { ph: S.adm.bo.settings.donationPurpose || 'e.g. Youth music fund' })}</div>
    ${EventSelfCard(ev)}
  </div></div>`;
}

// ── Full event report (Eli §26): everything about one show, filterable, to Excel / CSV / PDF, compared with earlier events ──
function eventReportData(ev, f = {}) {
  const x = { events: S.adm.events, orders: S.adm.orders, tickets: S.adm.tickets, statuses: S.adm.seatStatus || [], expenses: S.adm.expenses || [], expenseFinal: S.adm.expenseFinal || {} };
  const rep = finReport(x, { ...emptyFin(), eventId: ev.id, slotId: f.slotId || '', from: f.from || '', to: f.to || '' }), t = rep.totals;
  const tks = S.adm.tickets.filter(k => k.event_id === ev.id && (!f.slotId || k.slot_id === f.slotId)), valid = tks.filter(k => k.status === 'valid');
  const orders = S.adm.orders.filter(o => o.event_ids.includes(ev.id) && wasPaid(o) && (!f.from || localDay(o.paid_at || o.created_at) >= f.from) && (!f.to || localDay(o.paid_at || o.created_at) <= f.to));
  const inv = ev.seating?.enabled ? (() => { const st = seatStates(ev, { tickets: S.adm.tickets, statuses: S.adm.seatStatus || [], orders: S.adm.orders, slotId: f.slotId || '' }), n = s => [...st.values()].filter(v => v.state === s).length;
    return { total: st.size, available: n('available'), blocked: n('blocked'), held: n('held'), checkout: n('checkout') }; })() : null;
  const v = S.adm.views?.[ev.id] || {}, live = S.adm.live?.[ev.id] || {}, scans = valid.filter(k => k.checked_in_at);
  const earlier = new Set(); const byEmail = {}; for (const o of S.adm.orders.filter(wasPaid)) (byEmail[o.buyer_email] ||= []).push(o);
  const buyers = [...new Set(orders.map(o => o.buyer_email))], returning = buyers.filter(e => byEmail[e].some(o => !o.event_ids.includes(ev.id) && D(o.created_at) < D(orders.find(x => x.buyer_email === e).created_at))).length;
  const by = (list, key) => { const m = {}; for (const i of list) { const k = key(i); (m[k] ||= { n: 0, rev: 0 }); m[k].n++; m[k].rev += i.paid || 0; } return m; };
  const hours = by(valid.map(k => ({ ...k, h: D(S.adm.orders.find(o => o.id === k.order_id)?.created_at)?.getHours() })), k => String(k.h ?? '?').padStart(2, '0') + ':00');
  const days = by(valid.map(k => ({ ...k, d: localDay(S.adm.orders.find(o => o.id === k.order_id)?.created_at) })), k => k.d);
  const promos = {}; for (const o of orders) if (o.data.code) { const p = promos[o.data.code] ||= { orders: 0, tickets: 0, discount: 0, revenue: 0 }; p.orders++; p.discount += o.data.discount || 0; p.revenue += orderMoney(o).collected; p.tickets += tks.filter(k => k.order_id === o.id).length; }
  const track = {}; for (const o of orders) if (o.data.tracking) { const p = track[o.data.tracking] ||= { orders: 0, tickets: 0, revenue: 0 }; p.orders++; p.revenue += orderMoney(o).collected; p.tickets += tks.filter(k => k.order_id === o.id).length; }
  const sources = {}; for (const o of orders) { const s = o.data.source || o.data.utm?.source || 'direct'; (sources[s] ||= { orders: 0, revenue: 0 }); sources[s].orders++; sources[s].revenue += orderMoney(o).collected; }
  const entrances = {}; for (const k of scans) { const e = k.checkin?.entrance || '—'; entrances[e] = (entrances[e] || 0) + 1; }
  const rc = reconcile(S.adm.orders.filter(o => o.event_ids.includes(ev.id)), (S.adm.procTx || []), {});
  const allAbandoned = S.adm.orders.filter(o => o.event_ids.includes(ev.id) && o.status === 'expired').length, starts = S.adm.orders.filter(o => o.event_ids.includes(ev.id)).length;
  return { ev, rep, t, inv, valid, tks, orders, v, live, scans, buyers, returning, hours, days, promos, track, sources, entrances, rc, abandoned: allAbandoned, starts,
    ticketing: { total: inv ? inv.total : (+ev.capacity || valid.length), issued: tks.filter(k => k.status !== 'replaced').length, paid: valid.filter(k => !k.comp).length, comps: valid.filter(k => k.comp).length,
      cancelled: tks.filter(k => k.status === 'cancelled' && !k.refunded).length, refunded: tks.filter(k => k.refunded > 0).length } };
}
function reportSheets(R) {
  const $$ = c => (c || 0) / 100, t = R.t, tk = R.ticketing;
  return [
    ['Ticketing', [['Measure', 'Value'], ['Total tickets / seats', tk.total], ['Tickets issued', tk.issued], ['Paid tickets', tk.paid], ['Complimentary', tk.comps], ['Cancelled', tk.cancelled], ['Refunded', tk.refunded],
      ...(R.inv ? [['Available seats', R.inv.available], ['Blocked seats', R.inv.blocked], ['Held seats', R.inv.held]] : [])]],
    ['By section & price', [['Section / type', 'Tickets', 'Revenue'], ...finGroupRows(R.rep, 'area').map(r => [r.label, r.sold, $$(r.ticketRev)]), [], ['Ticket type / price level', 'Tickets', 'Revenue'], ...finGroupRows(R.rep, 'tt').map(r => [r.label, r.sold, $$(r.ticketRev)])]],
    ['Revenue', [['Measure', 'Amount'], ['Potential sellout', $$(t.potential)], ['Ticket revenue', $$(t.ticketRev)], ['Booking fees', $$(t.fees)], ['Other fees', $$(t.otherFee)], ['Processing fees', $$(t.processing)], ['Taxes', $$(t.tax)],
      ['Discounts', $$(t.discount)], ['Complimentary value', $$(t.comp)], ['Refunds', $$(t.refunds)], ['Credits', $$(t.credits)], ['Products', $$(t.productRev)], ['Packages', $$(t.bundleRev)], ['Donations', $$(t.donation)], ['Net collected', $$(t.net)],
      ...(t.expenses ? [['Event profit' + (t.profitFinal ? '' : ' (estimate — not every expense entered)'), $$(t.profit)]] : [])]],
    ['Promotions', [['Promo code', 'Orders', 'Tickets', 'Discount', 'Revenue'], ...Object.entries(R.promos).map(([k, p]) => [k, p.orders, p.tickets, $$(p.discount), $$(p.revenue)]), [], ['Tracking code', 'Orders', 'Tickets', 'Revenue'], ...Object.entries(R.track).map(([k, p]) => [k, p.orders, p.tickets, $$(p.revenue)]), [], ['Source', 'Orders', 'Revenue'], ...Object.entries(R.sources).map(([k, p]) => [k, p.orders, $$(p.revenue)])]],
    ['Traffic', [['Measure', 'Value'], ['Page views', R.v.total || 0], ['Unique visitors', R.v.unique || 0], ['Checkout starts', R.starts], ['Abandoned checkouts', R.abandoned], ['Paid orders', R.orders.length], ['Conversion (orders ÷ visitors)', R.v.unique ? (R.orders.length / R.v.unique * 100).toFixed(1) + '%' : '—']]],
    ['Attendance', [['Measure', 'Value'], ['Tickets scanned', R.scans.length], ['Attendance %', R.valid.length ? (R.scans.length / R.valid.length * 100).toFixed(1) + '%' : '—'], ['No-shows', D(R.ev.end || R.ev.start) < Date.now() ? R.valid.length - R.scans.length : 'event not over'], [], ['Entrance', 'Check-ins'], ...Object.entries(R.entrances)]],
    ['Customers', [['Measure', 'Value'], ['Customers', R.buyers.length], ['New', R.buyers.length - R.returning], ['Returning', R.returning], ['With a phone number', R.orders.filter(o => o.data.buyer?.phone && o.data.buyer.phone !== '•••').length], ['Opted in to email', R.orders.filter(o => o.data.optIn).length]]],
    ['Sales trends', [['Day', 'Tickets', 'Revenue'], ...Object.entries(R.days).sort().map(([k, x]) => [k, x.n, $$(x.rev)]), [], ['Hour', 'Tickets', 'Revenue'], ...Object.entries(R.hours).sort().map(([k, x]) => [k, x.n, $$(x.rev)])]],
    ['Reconciliation', [['Measure', 'Amount'], ['SET net', $$(R.rc.totals.setNet)], ['Processor net', $$(R.rc.totals.procNet)], ['Difference', $$(R.rc.totals.diff)], ['Refunds', $$(t.refunds)], ['Chargebacks', $$(t.chargebacks)], ['Processing fees', $$(t.processing)], ['Taxes', $$(t.tax)],
      ['Transactions with differences', R.rc.issues.length]]]];
}
function EdReport(ev) {
  const f = S.ui.er?.id === ev.id ? S.ui.er : (S.ui.er = { id: ev.id, slotId: '', from: '', to: '', cmp: [] }), R = eventReportData(ev, f), t = R.t, tk = R.ticketing, fin = can('finance.reports');
  const kpi = (l, v, d = '') => `<div class="kpi"><div class="eyebrow">${l}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
  // the export sheets hold plain dollars; on screen, money columns (by their heading) are shown as currency
  const table = (rows) => { let hd = rows[0]; const isM = (h, c) => typeof c === 'number' && /revenue|amount|discount/i.test(h || '');
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${hd.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(r => { if (r.length && r.every(c => typeof c === 'string') && rows.indexOf(r) > 0 && /^[A-Z]/.test(r[1] || '') && r.length > 1 && !/\d/.test(r[1])) { hd = r; return `<tr>${r.map(h => `<th>${esc(h)}</th>`).join('')}</tr>`; }
      return r.length ? `<tr>${r.map((c, i) => `<td class="${i ? 'tnum' : ''}">${esc(isM(hd[i], c) || (hd[1] === 'Amount' && i === 1 && typeof c === 'number') ? money(Math.round(c * 100)) : c)}</td>`).join('')}</tr>` : '<tr><td colspan="9" style="padding:4px"></td></tr>'; }).join('')}</tbody></table></div>`; };
  const others = S.adm.events.filter(e => e.id !== ev.id && D(e.start) < D(ev.start)).sort((a, b) => D(b.start) - D(a.start)).slice(0, 12), cmp = (f.cmp || []).map(id => S.adm.events.find(e => e.id === id)).filter(Boolean);
  const cmpRow = e => { const r = eventReportData(e); return [e.name, fmtDate(e.start, { month: 'short', day: 'numeric', year: 'numeric' }), r.ticketing.paid + r.ticketing.comps, money(r.t.ticketRev), money(r.t.net), r.valid.length ? Math.round(r.scans.length / r.valid.length * 100) + '%' : '—', r.v.unique ? (r.orders.length / r.v.unique * 100).toFixed(1) + '%' : '—']; };
  return `<div class="toolbar no-print">${(ev.timeSlots || []).length ? `<select class="inp" data-input="er.slotId" data-rr="1"><option value="">All showtimes</option>${ev.timeSlots.map(s => `<option value="${s.id}" ${f.slotId === s.id ? 'selected' : ''}>${esc(fmtDT(s.start))}</option>`).join('')}</select>` : ''}
      <label class="small muted">Sold from</label><input class="inp" type="date" data-input="er.from" data-rr="1" value="${esc(f.from)}"><label class="small muted">to</label><input class="inp" type="date" data-input="er.to" data-rr="1" value="${esc(f.to)}">
      <span style="flex:1"></span>${can('finance.export') || can('customers.export') ? `<button class="btn btn-ghost btn-sm" data-action="erExport" data-v="xlsx">Excel</button><button class="btn btn-ghost btn-sm" data-action="erExport" data-v="csv">CSV</button>` : ''}<button class="btn btn-ghost btn-sm" data-action="erPrint">PDF</button></div>
    <div class="print-only"><h1>${esc(ev.name)} — Full event report</h1><p>${esc(fmtDT(ev.start))} · ${esc(ev.venue || '')} · generated ${esc(fmtDT(new Date().toISOString()))}</p></div>
    <div class="eyebrow dash" style="margin:6px 0 10px">Ticketing</div>
    <div class="kpis">${kpi('Tickets issued', tk.issued, `${tk.paid} paid · ${tk.comps} comp`)}${kpi('Capacity', tk.total, R.inv ? `${R.inv.available} available · ${R.inv.blocked} blocked · ${R.inv.held} held` : '')}${kpi('Cancelled / refunded', `${tk.cancelled} / ${tk.refunded}`)}${kpi('Checked in', R.scans.length, R.valid.length ? Math.round(R.scans.length / R.valid.length * 100) + '% attendance' : '')}</div>
    ${fin ? `<div class="eyebrow dash" style="margin:18px 0 10px">Revenue</div><div class="kpis">${kpi('Potential sellout', money(t.potential))}${kpi('Ticket revenue', money(t.ticketRev))}${kpi('Net collected', money(t.net), `${money(t.fees)} fees · ${money(t.tax)} tax · ${money(t.refunds)} refunds`)}${t.expenses ? kpi(t.profitFinal ? 'Event profit' : 'Estimated profit', money(t.profit)) : kpi('Profit', '—', 'Enter expenses in Reports → Profitability')}</div>` : ''}
    <div class="cols" style="margin-top:18px">${reportSheets(R).filter(([n]) => fin || !['Revenue', 'Reconciliation', 'Promotions'].includes(n)).map(([n, rows]) => `<div class="card"><h3>${esc(n)}</h3>${table(rows)}</div>`).join('')}</div>
    <div class="card no-print" style="margin-top:18px"><h3>Compare with earlier events</h3><p class="small muted" style="margin:4px 0 10px">Pick up to 5.</p>
      <div class="row wrap">${others.map(e => `<label class="check small"><input type="checkbox" data-action="erCmp" data-v="${e.id}" ${(f.cmp || []).includes(e.id) ? 'checked' : ''}> <span>${esc(e.name)}</span></label>`).join('') || '<span class="small muted">No earlier events yet.</span>'}</div>
      ${cmp.length ? table([['Event', 'Date', 'Tickets', 'Ticket revenue', 'Net', 'Attendance', 'Conversion'], cmpRow(ev), ...cmp.map(cmpRow)]) : ''}</div>`;
}

// ── Versions (Eli §18): every save keeps a snapshot; restore loads it back for review ──
const SECTION_LABEL = Object.fromEntries([...EVENT_SECTIONS, ...BO_SECTIONS].map(([k, t]) => [k, t]).concat([['created', 'Created']]));
function VersionsCard(target, restoreAction) {
  const list = (S.adm.versions || []).filter(v => v.target === target);
  return `<div class="card"><h3>Version history</h3><p class="small muted" style="margin:4px 0 10px">Every save is kept (the last 40). Restoring loads that version back — review it, then save to make it current.</p>
    ${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>What changed</th><th></th></tr></thead><tbody>${list.map((v, i) => `<tr><td class="small">${esc(fmtDT(v.at))}</td><td class="small">${esc(v.by)}</td>
      <td>${v.sections.map(s => `<span class="chip mini">${esc(SECTION_LABEL[s] || s)}</span>`).join(' ')}</td><td style="text-align:right">${i ? `<button class="btn btn-ghost btn-sm" data-action="${restoreAction}" data-id="${v.id}">Restore</button>` : '<span class="small muted">current</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">No saved versions yet.</p>'}</div>`;
}

// ── Risk: flags on orders, review ──
const flagChips = o => (o.data.flags || []).map(k => `<span class="chip ${o.data.review?.result === 'ok' ? '' : 'warn'} mini" title="${esc(ORDER_FLAGS[k] || k)}">${ic('flag', 11)} ${esc(k)}</span>`).join(' ');
function FlagsCard(o) {
  if (!(o.data.flags || []).length) return '';
  const r = o.data.review;
  return `<div class="card"><h3>${ic('flag', 15)} Flagged for review</h3><ul class="small" style="margin:8px 0 10px 18px">${o.data.flags.map(k => `<li>${esc(ORDER_FLAGS[k] || k)}</li>`).join('')}</ul>
    ${r ? `<p class="small"><span class="chip ${r.result === 'fraud' ? 'bad' : 'ok'}">${r.result === 'fraud' ? 'Confirmed fraud' : 'Reviewed — genuine'}</span> by ${esc(r.by)} ${esc(ago(r.at))}${r.note ? ' · ' + esc(r.note) : ''}</p>`
      : can('orders.edit', o.event_ids[0]) ? `<div class="row wrap"><button class="btn btn-ghost btn-sm" data-action="reviewOrder" data-id="${o.id}" data-v="ok">Looks genuine</button><button class="btn btn-danger btn-sm" data-action="reviewOrder" data-id="${o.id}" data-v="fraud">Fraud</button>
        ${can('customers.ban') ? `<button class="btn btn-ghost btn-sm" data-action="banAsk" data-v="${esc(o.buyer_email)}">Ban this customer…</button>` : ''}</div>` : ''}</div>`;
}
function PoliciesCard(o) {
  const acc = o.data.accepted || []; if (!acc.length) return '';
  return `<div class="card"><h3>Policies accepted</h3><div class="small" style="margin-top:8px">${acc.map(a => { const t = S.adm.policyTexts?.[a.version];
    return `<div class="between" style="padding:5px 0;border-bottom:1px solid var(--line)"><span>${esc(t?.title || POLICY_KINDS[a.kind] || a.kind)} <code>${esc(a.version)}</code></span><span class="muted">${esc(fmtDT(a.at))}${t ? ` · <a href="#" data-action="showAccepted" data-v="${esc(a.version)}">read</a>` : ''}</span></div>`; }).join('')}</div></div>`;
}

// ── Customers: inbox + banned ──
function CustomersTabs(cur) {
  const t = [['list', 'Customers', 'customers.profiles'], ['inbox', 'Inbox', 'customers.inbox'], ['banned', 'Banned', 'customers.ban']].filter(x => can(x[2]) || (x[0] === 'banned' && can('customers.profiles')));
  const open = (S.adm.inbox || []).filter(m => m.status === 'open').length;
  return `<div class="tabs" style="margin-bottom:14px">${t.map(([k, l]) => `<a class="${cur === k ? 'on' : ''}" href="#/admin/customers${k === 'list' ? '' : '/~' + k}">${l}${k === 'inbox' && open ? ` <span class="chip warn mini">${open}</span>` : ''}</a>`).join('')}</div>`;
}
function CustomerInbox() {
  const list = S.adm.inbox || [], f = S.ui.inf || 'open';
  return head('Customer messages', 'Sent with “Contact organizer” — each goes to the event\'s own contact or team') + CustomersTabs('inbox') + `
  <div class="toolbar">${[['open', 'Open'], ['answered', 'Answered'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => `<button class="btn btn-sm ${f === k ? 'btn-dark' : 'btn-ghost'}" data-action="inboxFilter" data-v="${k}">${l}</button>`).join('')}</div>
  ${list.filter(m => f === 'all' || m.status === f).map(m => `<div class="card" style="margin-bottom:12px"><div class="between"><div><b>${esc(m.subject || '(no subject)')}</b> <span class="chip mini ${m.status === 'open' ? 'warn' : ''}">${esc(m.status)}</span>
      <div class="small muted">${esc(m.name)} · ${esc(m.email)}${m.ref ? ' · order ' + esc(m.ref) : ''}${m.event_id ? ' · ' + esc(evById(m.event_id)?.name || '') : ''} · to ${esc(m.team)} (${esc(m.routed_to)}) · ${esc(ago(m.at))}</div></div></div>
    <p style="white-space:pre-line;margin:10px 0">${esc(m.body)}</p>${(m.replies || []).map(r => `<div class="item-card small"><b>${esc(r.by)}</b> <span class="muted">${esc(ago(r.at))}</span><div style="white-space:pre-line">${esc(r.body)}</div></div>`).join('')}
    <div class="row wrap" style="margin-top:8px">${can('comms.email') ? `<input class="inp" style="flex:1;min-width:220px" data-input="rep_${m.id}" placeholder="Write a reply (emailed to the customer)"><button class="btn btn-accent btn-sm" data-action="inboxReply" data-id="${m.id}">Reply</button>` : ''}
      <button class="btn btn-ghost btn-sm" data-action="inboxStatus" data-id="${m.id}" data-v="${m.status === 'closed' ? 'reopen' : 'close'}">${m.status === 'closed' ? 'Reopen' : 'Close'}</button></div></div>`).join('') || '<div class="empty">No messages here.</div>'}`;
}
function CustomerBans() {
  const list = S.adm.bans || [], b = S.ui.ban || (S.ui.ban = { email: '', reason: '' });
  return head('Banned customers', 'They can\'t buy tickets from this box office. Only staff see the reason.') + CustomersTabs('banned') + `
  ${can('customers.ban') ? `<div class="card" style="margin-bottom:14px"><div class="row wrap"><input class="inp" style="flex:1;min-width:200px" type="email" placeholder="Email address" data-input="ban.email" value="${esc(b.email)}"><input class="inp" style="flex:2;min-width:240px" placeholder="Reason (internal)" data-input="ban.reason" value="${esc(b.reason)}"><button class="btn btn-danger" data-action="banAdd">Ban</button></div></div>` : ''}
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Email</th><th>Reason</th><th>Banned</th><th>By</th><th>Status</th><th></th></tr></thead><tbody>
  ${list.map(x => `<tr><td><b>${esc(x.email)}</b></td><td class="small">${esc(x.reason)}</td><td class="small">${esc(fmtDT(x.at))}</td><td class="small">${esc(x.by)}</td><td>${x.removed_at ? `<span class="chip mini">Removed ${esc(ago(x.removed_at))} by ${esc(x.removed_by)}</span>` : '<span class="chip bad mini">Banned</span>'}</td>
    <td style="text-align:right">${!x.removed_at && can('customers.ban') ? `<button class="btn btn-ghost btn-sm" data-action="banRemove" data-id="${x.id}">Remove ban</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nobody is banned.</td></tr>'}</tbody></table></div>`;
}

// ── Settings additions: plan & billing, custom domain, sending domain ──
function PlanCard() {
  const bo = S.adm.bo, plans = S.adm.plans?.length ? S.adm.plans : DEFAULT_PLANS, cur = planOf({ planList: plans, defaultPlan: S.adm.platform?.defaultPlan }, bo), owner = S.adm.me.owner || S.adm.me.support;
  const period = new Date().toISOString().slice(0, 7), b = billingFor(S.adm.orders, bo, { planList: plans, defaultPlan: S.adm.platform?.defaultPlan }, period);
  return `<div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Plan & billing</div>
    <div class="plans">${plans.map(p => `<div class="plan ${cur.id === p.id ? 'on' : ''}"><b>${esc(p.name)}</b><div class="display" style="font-size:24px">${p.monthly ? money(p.monthly) + '<small>/mo</small>' : 'Free'}</div>
      <div class="small muted">${esc(feeText({ pct: optNum(p.feePct, S.adm.platform?.feePct ?? S.platform.feePct), fixed: optNum(p.feeFixed, S.adm.platform?.feeFixed ?? S.platform.feeFixed), payer: bo.platformFee?.payer || S.adm.platform?.feePayer || 'organizer' }))}</div><p class="small" style="margin:6px 0">${esc(p.blurb || '')}</p>
      ${cur.id === p.id ? '<span class="chip ok mini">Current plan</span>' : owner ? `<button class="btn btn-ghost btn-sm" data-action="pickPlan" data-v="${esc(p.id)}">Switch</button>` : ''}</div>`).join('')}</div>
    ${bo.platformFee ? '<p class="small muted">The platform has set a custom fee for this box office, which replaces the plan\'s fee.</p>' : ''}
    <div class="sep"></div><div class="between small"><span>This month so far: platform fees taken automatically by ${esc(GATEWAYS.stripe.name)}</span><b class="tnum">${money(b.autoFees)}</b></div>
    <div class="between small"><span>Platform fees on cash / check / invoice / other orders (invoiced monthly)</span><b class="tnum">${money(b.owedFees)}</b></div>
    <div class="between small"><span>Plan</span><b class="tnum">${money(b.subscription)}</b></div>
    <div class="eyebrow" style="margin:14px 0 6px">Invoices</div>
    ${(S.adm.invoices || []).map(i => `<div class="between small" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(i.number)} · ${esc(i.period)}</span><span><span class="chip mini ${i.status === 'paid' ? 'ok' : i.status === 'open' ? 'warn' : ''}">${esc(INVOICE_STATUS[i.status])}</span> <b class="tnum">${money(i.total)}</b> <a href="#" data-action="viewInvoice" data-id="${i.id}">view</a></span></div>`).join('') || '<p class="small muted">No invoices yet.</p>'}</div>`;
}
function invoiceHtml(i) {
  return `<div class="invoice"><div class="between"><b>${esc(S.platform.name || 'SET')}</b><span>Invoice ${esc(i.number)}</span></div><p class="small muted">${esc(i.bo_name || S.adm?.bo?.name || '')} · ${esc(i.period)} · issued ${esc(fmtDate(i.issued_at))} · due ${esc(fmtDate(i.due_at))}</p>
    <table class="tbl" style="margin-top:10px"><tbody>${i.lines.map(l => `<tr><td>${esc(l.label)}</td><td class="tnum">${money(l.amount)}</td></tr>`).join('')}<tr><td><b>Total</b></td><td class="tnum"><b>${money(i.total)}</b></td></tr></tbody></table>
    ${i.info?.autoFees ? `<p class="small muted" style="margin-top:8px">Not included: ${money(i.info.autoFees)} in platform fees already taken automatically on ${i.info.autoOrders} card order(s).</p>` : ''}<p class="small" style="margin-top:8px">Status: ${esc(INVOICE_STATUS[i.status])}${i.paid_at ? ' · paid ' + esc(fmtDate(i.paid_at)) : ''}</p></div>`;
}
function DomainCard() {
  const d = S.adm.bo.domain, target = S.adm.platform?.domainTarget || DEFAULT_PLATFORM.domainTarget;
  return `<div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Custom domain</div><p class="small muted" style="margin-bottom:10px">Your box office's site on your own address, e.g. <code>tickets.yourvenue.com</code>, with HTTPS. Event links become <code>https://your-domain/#/e/event-name</code>.</p>
    <div class="row"><input class="inp" style="flex:1" data-input="domHost" placeholder="tickets.yourvenue.com" value="${esc(S.ui.domHost ?? d?.host ?? '')}"><button class="btn btn-ghost btn-sm" data-action="saveDomain">${d ? 'Change' : 'Add'}</button></div>
    ${d ? `<div class="item-card" style="margin-top:10px"><div class="between"><b>${esc(d.host)}</b><span class="chip ${d.status === 'verified' ? 'ok' : 'warn'}">${d.status === 'verified' ? 'Connected' : 'Waiting for DNS'}</span></div>
      <p class="small muted" style="margin:6px 0">Add these records at your domain provider:</p>${dnsTable(domainRecords(d.host, d.token, target))}
      <div class="row wrap" style="margin-top:8px"><button class="btn btn-ghost btn-sm" data-action="checkDomain" data-v="site">Check DNS</button>${d.host ? '<button class="btn btn-ghost btn-sm" data-action="removeDomain">Remove</button>' : ''}</div>
      ${d.demo ? '<p class="small muted">Demo mode can\'t look DNS up — marked connected for the walkthrough.</p>' : ''}</div>` : ''}</div>`;
}
const dnsTable = recs => `<div class="tbl-wrap"><table class="tbl dns"><thead><tr><th>Type</th><th>Name</th><th>Value</th>${recs[0]?.purpose ? '<th>For</th>' : ''}</tr></thead><tbody>${recs.map(r => `<tr><td>${esc(r.type)}</td><td><code>${esc(r.name)}</code></td><td><code>${esc(r.value)}</code></td>${r.purpose ? `<td class="small">${esc(r.purpose)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
function MailDomainCard() {
  const m = S.adm.bo.mailDomain;
  return `<div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Sending domain</div><p class="small muted" style="margin-bottom:10px">Send tickets from your own address (e.g. <code>tickets@yourvenue.com</code>). Add the SPF, DKIM and DMARC records below so inboxes trust it; until it's verified, email goes from the platform's domain with your name and reply-to.</p>
    <div class="row"><input class="inp" style="flex:1" data-input="mailDom" placeholder="yourvenue.com" value="${esc(S.ui.mailDom ?? m?.domain ?? '')}"><button class="btn btn-ghost btn-sm" data-action="saveMailDomain">${m ? 'Change' : 'Add'}</button></div>
    ${m ? `<div class="item-card" style="margin-top:10px"><div class="between"><b>${esc(m.domain)}</b><span class="chip ${m.status === 'verified' ? 'ok' : 'warn'}">${m.status === 'verified' ? 'Verified' : 'Not verified yet'}</span></div>${dnsTable(m.records || mailRecords(m.domain))}
      <button class="btn btn-ghost btn-sm" style="margin-top:8px" data-action="checkDomain" data-v="mail">Verify</button>${m.demo ? '<p class="small muted">Demo mode can\'t look DNS up — marked verified for the walkthrough.</p>' : ''}</div>` : ''}
    <p class="small muted" style="margin-top:10px">Bounces and complaints are tracked automatically (Marketing → Messages); you get one alert a day if emails fail.</p></div>`;
}
// ── Getting started (SaaS onboarding) ──
function Onboarding() {
  const bo = S.adm.bo, s = bo.settings || {};
  if (!(S.adm.me.owner || S.adm.me.support) || s.onboarded) return '';
  const steps = [['Add your logo and colours', !!(bo.branding?.logo || bo.branding?.accent !== DEFAULT_BRANDING.accent), '#/admin/branding'], ['Set your contact email and policies', !!(s.contactEmail && s.terms), '#/admin/branding'],
    ['Connect payments', bo.gateway?.status === 'connected', '#/admin/settings'], ['Create your first event', S.adm.events.length > 0, '#/admin/events'], ['Publish it', S.adm.events.some(e => e.status === 'published'), '#/admin/events'],
    ['Invite your team', (S.adm.team || []).length > 1, '#/admin/team']], done = steps.filter(x => x[1]).length;
  if (done === steps.length) return '';
  return `<div class="card onboard" style="margin-bottom:18px"><div class="between"><h3>Get started — ${done} of ${steps.length} done</h3><a href="#" class="small" data-action="onboardDone">Hide</a></div>
    <div class="q-bar" style="margin:10px 0"><span style="width:${Math.round(done / steps.length * 100)}%"></span></div>
    <div class="row wrap">${steps.map(([t, ok, href]) => `<a class="chip ${ok ? 'ok' : ''}" href="${href}">${ok ? '✓ ' : ''}${esc(t)}</a>`).join('')}</div></div>`;
}
// ── Platform (super admin) additions: all events, staff, billing, risk, system health, incidents ──
function PEvents() {
  const P = S.plat, q = String(S.ui.peq || '').toLowerCase(), now = Date.now(), f = S.ui.pef || 'upcoming';
  const list = (P.events || []).filter(e => (f === 'all' || (f === 'upcoming' ? D(e.start) >= now && !e.archived : D(e.start) < now || e.archived)) && (!q || (e.name + ' ' + e.bo).toLowerCase().includes(q)));
  return head('All events', `${(P.events || []).length} events across ${P.bos.length} box offices`) + `<div class="toolbar"><input class="inp" style="flex:1" data-input="peq" data-rr="1" placeholder="Search events or box offices…" value="${esc(S.ui.peq || '')}">
    ${[['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All']].map(([k, l]) => `<button class="btn btn-sm ${f === k ? 'btn-dark' : 'btn-ghost'}" data-action="pef" data-v="${k}">${l}</button>`).join('')}</div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Event</th><th>Box office</th><th>Date</th><th>Status</th><th>Tickets</th><th>Controls</th></tr></thead><tbody>${list.map(e => `<tr><td><b>${esc(e.name)}</b><div class="small muted">/e/${esc(e.slug)}</div></td><td class="small">${esc(e.bo)}</td>
    <td class="small">${esc(fmtDT(e.start))}</td><td><span class="chip mini">${esc(e.archived ? 'archived' : e.status)}${e.visibility && e.visibility !== 'public' ? ' · ' + esc(e.visibility) : ''}</span></td><td class="tnum">${e.tickets}</td>
    <td>${EV_CONTROLS.filter(([k]) => e.controls?.[k]).map(([, t]) => `<span class="chip bad mini">${esc(t)}</span>`).join(' ') || '<span class="small muted">—</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No events.</td></tr>'}</tbody></table></div>`;
}
function PStaff() {
  const P = S.plat, q = String(S.ui.psq || '').toLowerCase(), list = (P.staff || []).filter(m => !q || (m.email + ' ' + m.name + ' ' + m.bo).toLowerCase().includes(q));
  return head('Staff & users', `${new Set((P.staff || []).map(m => m.email)).size} people on ${P.bos.length} box offices · ${P.platform.admins.length} super admins`) + `<div class="toolbar"><input class="inp" style="flex:1" data-input="psq" data-rr="1" placeholder="Search…" value="${esc(S.ui.psq || '')}"></div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Person</th><th>Box office</th><th>Access</th><th>Last sign-in</th></tr></thead><tbody>${list.map(m => `<tr><td><b>${esc(m.name || m.email)}</b><div class="small muted">${esc(m.email)}</div></td><td class="small">${esc(m.bo)}</td>
    <td><span class="chip mini">${m.owner ? 'Owner' : esc(tplName(m.template) || 'Custom')}</span></td><td class="small muted">${m.last ? esc(ago(m.last)) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
}
function PBilling() {
  const P = S.plat, plat = P.platform, prev = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })(), period = S.ui.bp || prev;
  const fake = id => P.orders.filter(o => o.box_office_id === id).map(o => ({ ...o, data: { platformFee: o.platformFee, total: o.total }, payment: o.provider ? { provider: o.provider, ...(o.marked ? { markedPaidBy: 'staff' } : {}) } : null }));
  return head('Plans & billing', 'What each box office owes the platform', `<input class="inp" type="month" data-input="bp" value="${esc(period)}"><button class="btn btn-accent" data-action="billingRun">Create invoices for ${esc(period)}</button>`) + `
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Box office</th><th>Plan</th><th>Fees taken automatically</th><th>Fees to invoice</th><th>Plan fee</th><th>Due for ${esc(period)}</th></tr></thead><tbody>
  ${P.bos.filter(b => ['active', 'suspended'].includes(b.status)).map(b => { const x = billingFor(fake(b.id), b, plat, period); return `<tr><td><b>${esc(b.name)}</b></td><td><select class="inp" data-action-change="boPlan" data-id="${b.id}">${(plat.planList || DEFAULT_PLANS).map(p => `<option value="${esc(p.id)}" ${x.plan.id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></td>
    <td class="tnum">${money(x.autoFees)}<div class="small muted">${x.autoOrders} orders</div></td><td class="tnum">${money(x.owedFees)}<div class="small muted">${x.owedOrders} orders</div></td><td class="tnum">${money(x.subscription)}</td><td class="tnum"><b>${money(x.due)}</b></td></tr>`; }).join('')}</tbody></table></div>
  <div class="card" style="margin-top:18px"><h3>Invoices</h3>${(P.invoices || []).length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Invoice</th><th>Box office</th><th>Month</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>${P.invoices.slice().sort((a, b) => D(b.issued_at) - D(a.issued_at)).map(i => `<tr><td><a href="#" data-action="viewInvoice" data-id="${i.id}">${esc(i.number)}</a></td><td class="small">${esc(i.bo_name)}</td><td class="small">${esc(i.period)}</td><td class="tnum">${money(i.total)}</td>
    <td><span class="chip mini ${i.status === 'paid' ? 'ok' : i.status === 'open' ? 'warn' : ''}">${esc(INVOICE_STATUS[i.status])}</span></td><td style="text-align:right;white-space:nowrap">${i.status === 'open' ? `<button class="btn btn-ghost btn-sm" data-action="invoiceDo" data-id="${i.id}" data-v="paid">Mark paid</button> <button class="btn btn-ghost btn-sm" data-action="invoiceDo" data-id="${i.id}" data-v="void">Void</button>` : i.status === 'void' ? '' : `<button class="btn btn-ghost btn-sm" data-action="invoiceDo" data-id="${i.id}" data-v="open">Reopen</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">None yet — create them for a month above (the live system also does it on the 1st of every month).</p>'}</div>
  <p class="small muted" style="margin-top:12px">Card orders through Stripe Connect pay the platform fee automatically (the application fee). Only orders paid another way — cash, check, Zelle / bank transfer, invoice, pay-later marked paid, other processors — are invoiced, plus the plan's monthly price. Change plans and fees in Platform settings.</p>`;
}
const HEALTH_CHIP = { ok: ['ok', 'Operational'], degraded: ['warn', 'Degraded'], down: ['bad', 'Down'], off: ['', 'Not connected'] };
function PHealth() {
  const P = S.plat, h = P.health || { parts: {} };
  if (S.version === undefined) { S.version = null; fetch('version.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : { commit: 'local copy', at: null }).catch(() => ({ commit: 'local copy', at: null })).then(v => { S.version = v; render(); }); }
  return head('System health', 'Live status from what actually happened in the last minutes and hours', `<button class="btn btn-ghost" data-action="platReload">Refresh</button><button class="btn btn-accent" data-action="newIncident">Open an incident</button>`) + `
  <div class="health-grid">${HEALTH_PARTS.map(([k, t]) => { const [cls, lbl] = HEALTH_CHIP[h.parts[k] || 'ok']; return `<div class="card health"><div class="small muted">${t}</div><span class="chip ${cls}">${lbl}</span></div>`; }).join('')}</div>
  ${(h.open || []).length ? `<div class="banner warn" style="margin-top:14px"><b>${h.open.length} open incident${h.open.length === 1 ? '' : 's'}:</b> ${h.open.map(i => esc(i.title)).join(', ')} — <a href="#/platform/incidents">Incidents</a></div>` : ''}
  <div class="cols" style="margin-top:18px"><div class="card"><h3>Failed payments (last hour)</h3><p class="display" style="font-size:30px">${h.failedPayments || 0}<small class="muted" style="font-size:14px"> of ${h.attempts || 0} attempts</small></p></div>
    <div class="card"><h3>Backups</h3><p class="small">${h.lastBackup ? 'Last good backup ' + esc(ago(h.lastBackup)) : DB.live ? '<span style="color:var(--bad)">No backup recorded</span>' : 'Demo mode — the live system records each nightly backup (see SETUP.md)'}</p></div>
    <div class="card"><h3>Deployed version</h3><p class="small" id="verBox">${esc(S.version ? `${S.version.commit}${S.version.at ? ' · ' + fmtDT(S.version.at) : ''}${S.version.env ? ' · ' + S.version.env : ''}` : 'loading…')}</p><p class="small muted">History: <code>git tag -l 'deploy-*'</code> · roll back: <code>bash deploy/rollback.sh &lt;tag&gt;</code></p></div></div>
  <div class="cols" style="margin-top:18px"><div class="card"><h3>Failed emails (24 h)</h3>${(h.failedMail || []).slice(0, 12).map(m => `<div class="small between" style="padding:5px 0;border-bottom:1px solid var(--line)"><span>${esc(m.kind)} · ${esc(m.error || '')}</span><span class="muted">${esc(ago(m.at))}</span></div>`).join('') || '<p class="small muted">None.</p>'}</div>
    <div class="card"><h3>Failed integrations (24 h)</h3>${(h.failedHooks || []).slice(0, 12).map(d => `<div class="small between" style="padding:5px 0;border-bottom:1px solid var(--line)"><span>${esc(d.type || d.event || '')} · ${esc(d.response || '')}</span><span class="muted">${esc(ago(d.created_at || d.at))}</span></div>`).join('') || '<p class="small muted">None.</p>'}</div></div>
  <div class="card" style="margin-top:18px"><h3>Recent errors</h3>${(P.errors || []).length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Where</th><th>Message</th><th>Page</th></tr></thead><tbody>${P.errors.slice(0, 50).map(e => `<tr><td class="small">${esc(fmtDT(e.at))}</td><td><span class="chip mini">${esc(e.where)}</span></td><td class="small">${esc(e.message)}</td><td class="small muted">${esc(e.url || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">No errors recorded.</p>'}</div>`;
}
function PIncidents() {
  const list = S.plat.incidents || [];
  return head('Incidents', 'Outages and failures: when they started and ended, what they affected, the cause and the fix', `<button class="btn btn-accent" data-action="newIncident">Open an incident</button>`) + `
  ${list.map(i => `<div class="card" style="margin-bottom:12px"><div class="between"><div><b>${esc(i.title)}</b> <span class="chip mini ${i.status === 'resolved' ? 'ok' : 'bad'}">${esc(i.status)}</span> <span class="chip mini">${esc(INCIDENT_KINDS[i.kind] || i.kind)}</span> ${i.severity === 'major' ? '<span class="chip bad mini">major</span>' : ''}
      <div class="small muted">${esc(fmtDT(i.started_at))} → ${i.ended_at ? esc(fmtDT(i.ended_at)) : 'ongoing'}${i.events?.length ? ' · ' + i.events.map(id => esc((S.plat.events || []).find(e => e.id === id)?.name || 'event')).join(', ') : ''}</div></div>
      <button class="btn btn-ghost btn-sm" data-action="editIncident" data-id="${i.id}">${i.status === 'resolved' ? 'Edit' : 'Update / resolve'}</button></div>
    ${i.cause ? `<p class="small" style="margin-top:8px"><b>Cause:</b> ${esc(i.cause)}</p>` : ''}${i.resolution ? `<p class="small"><b>Resolution:</b> ${esc(i.resolution)}</p>` : ''}
    ${(i.updates || []).map(u => `<div class="small muted">${esc(fmtDT(u.at))} · ${esc(u.by)}: ${esc(u.text)}</div>`).join('')}</div>`).join('') || '<div class="empty">No incidents recorded.</div>'}`;
}
function IncidentModal(id) {
  const i = id ? (S.plat.incidents || []).find(x => x.id === id) : null;
  S.ui.inc = { id: i?.id || '', kind: i?.kind || 'checkout', title: i?.title || '', severity: i?.severity || 'minor', events: [...(i?.events || [])], cause: i?.cause || '', resolution: i?.resolution || '', started_at: i?.started_at || new Date().toISOString(), status: i?.status || 'open', update: '' };
  const f = S.ui.inc;
  modal(i ? 'Update incident' : 'Open an incident', `<div class="grid2"><div class="field"><label class="fl">Kind</label><select class="inp" data-input="inc.kind">${Object.entries(INCIDENT_KINDS).map(([k, t]) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label class="fl">Severity</label><select class="inp" data-input="inc.severity"><option value="minor">Minor — degraded</option><option value="major" ${f.severity === 'major' ? 'selected' : ''}>Major — down</option></select></div></div>
    <div class="field"><label class="fl">Title</label><input class="inp" data-input="inc.title" value="${esc(f.title)}"></div>
    <div class="field"><label class="fl">Affected events</label><select class="inp" multiple size="4" data-action-change="incEvents">${(S.plat.events || []).filter(e => !e.archived).map(e => `<option value="${e.id}" ${f.events.includes(e.id) ? 'selected' : ''}>${esc(e.name)} · ${esc(e.bo)}</option>`).join('')}</select></div>
    <div class="field"><label class="fl">Cause (when known)</label><textarea class="inp" data-input="inc.cause">${esc(f.cause)}</textarea></div>
    <div class="field"><label class="fl">Resolution</label><textarea class="inp" data-input="inc.resolution">${esc(f.resolution)}</textarea></div>
    <div class="field"><label class="fl">Add an update</label><input class="inp" data-input="inc.update" placeholder="e.g. Provider confirmed the issue"></div>`,
    `<button class="btn btn-ghost" data-action="closeModal">Cancel</button><button class="btn btn-ghost" data-action="saveIncident" data-v="open">Save (still open)</button><button class="btn btn-accent" data-action="saveIncident" data-v="resolved">Resolved</button>`);
}
function PRisk() {
  const P = S.plat, list = P.flagged || [], open = list.filter(o => !o.review);
  return head('Risk & fraud', `${open.length} flagged order${open.length === 1 ? '' : 's'} to review · ${P.bans || 0} banned customers`) + `
  <div class="cols"><div class="card small"><h3>What is checked</h3><p class="muted" style="margin-top:6px">Hard stops: too many checkout attempts per connection, too many orders per email per hour, a hidden form field only bots fill, banned customers, too many seats held per connection, too many declined cards on one order.
    Flags for review: several orders from one email, a duplicate of a recent order, unusually large orders, automated-looking checkouts, repeated card declines.</p></div>
    <div class="card small"><h3>Payment attempts</h3><p class="muted" style="margin-top:6px">${P.health?.attempts || 0} in the last hour, ${P.health?.failedPayments || 0} declined. Spikes show on System health.</p></div></div>
  <div class="tbl-wrap" style="margin-top:18px"><table class="tbl"><thead><tr><th>Order</th><th>Box office</th><th>Customer</th><th>Flags</th><th>Total</th><th>Placed</th><th>Review</th></tr></thead><tbody>
  ${list.map(o => `<tr><td><b>${esc(o.ref)}</b><div class="small muted">${esc(o.status)}</div></td><td class="small">${esc(o.bo)}</td><td class="small">${esc(o.email)}</td><td>${(o.flags || []).map(k => `<span class="chip warn mini" title="${esc(ORDER_FLAGS[k] || k)}">${esc(k)}</span>`).join(' ')}</td>
    <td class="tnum">${money(o.total)}</td><td class="small">${esc(ago(o.created_at))}</td><td>${o.review ? `<span class="chip mini ${o.review.result === 'fraud' ? 'bad' : 'ok'}">${o.review.result === 'fraud' ? 'fraud' : 'genuine'}</span>` : `<button class="btn btn-ghost btn-sm" data-action="support" data-id="${o.box_office_id}">Open box office</button>`}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nothing flagged.</td></tr>'}</tbody></table></div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  ACTIONS
// ══════════════════════════════════════════════════════════════════════════════
const dirty = () => { S.dirty = true; autosave(); document.querySelectorAll('[data-action="saveEvent"],[data-action="saveVenue"],[data-action="savePromo"],[data-action="saveTracking"]').forEach(b => { b.disabled = false; }); };
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
    const seen = new Set(), dup = seatLayout(ev.seating).seats.map(p => p.id).find(id => seen.has(id) || !seen.add(id));
    if (dup) throw new Error(`Two seats would share the ID ${dup} — check the row labels and seat numbers of that section`);
    delete ev.seating.blocked; pruneSeatKeys(ev.seating); Object.assign(ev.seating, seatDerive(ev.seating));
    if (!Object.keys(ev.seating.index).length) throw new Error('The seating map has no seats with a price');
  }
  const saved = await DB.saveEvent(ev);
  upsertLocal(S.adm.events, JSON.parse(JSON.stringify(saved)));
  S.events = S.events.filter(e => e.id !== saved.id); if (eventLive(normEvent(saved))) { const { secrets, ...pub } = saved; S.events.push({ ...pub, hasPassword: !!secrets?.password, ticketTypes: pub.ticketTypes.map(t => ({ ...t, locked: !!secrets?.ticketPasswords?.[t.id] })) }); }
  return saved;
}
// edit a seated section's row list (lengths, plus custom labels if it has them). op: dup | del | paste
function rowEdit(op, r) {
  const sec = S.draft.seating.sections.find(x => x.id === S.ui.smSel); if (!sec || secKind(sec) !== 'rows') return;
  const n = Math.max(1, +sec.rows || 1), per = +sec.seatsPerRow || 10, counts = Array.from({ length: n }, (_, k) => +(sec.rowSeats || [])[k] || per);
  const labels = sec.rowLabels ? Array.from({ length: n }, (_, k) => String(sec.rowLabels).split(',').map(x => x.trim())[k] || '') : null;
  if (op === 'dup') { counts.splice(r + 1, 0, counts[r]); labels?.splice(r + 1, 0, ''); }
  if (op === 'del') { counts.splice(r, 1); labels?.splice(r, 1); }
  if (op === 'paste') { counts.push(S.ui.rowClip); labels?.push(''); }
  const rowMap = op === 'dup' ? x => x > r ? x + 1 : x : op === 'del' ? x => x === r ? -1 : x > r ? x - 1 : x : x => x;
  remapSeatKeys(S.draft.seating, sec.id, () => {
    sec.rows = counts.length; sec.rowSeats = counts.map(c => c === per ? 0 : c); if (!sec.rowSeats.some(Boolean)) delete sec.rowSeats;
    if (labels) sec.rowLabels = labels.join(', ').replace(/(, )+$/, '');
  }, rowMap);
  S.ui.rowsOpen = true; dirty(); render();
}
// per-seat override maps (prices / areas / labels): a value equal to the section's own clears the override
function seatMapEdit(key, val, dflt) {
  const st = S.draft.seating, L = layoutOf(st), m = st[key] ||= {}; let n = 0;
  for (const id of S.ui.smSeats || []) { const p = L.byId.get(id); if (!p) continue; if (!val || val === dflt(p)) delete m[id]; else m[id] = val; n++; }
  dirty(); render(); toast(n + ' seat' + (n === 1 ? '' : 's') + ' updated');
}
const A = {
  // ── Stage 10 ──
  contactOrg: el => ContactModal(el.dataset.id, el.dataset.bo, el.dataset.ref),
  sendContact: async () => { const f = S.ui.ct; try { const r = await DB.contactOrganizer(f.ev, f.bo, f); closeModal(); toast(`Sent to ${r.routed} — they'll reply by email`); } catch (e) { toast(e.message, true); } },
  queueRetry: el => { delete S.queue[el.dataset.id]; render(); },
  evControl: async el => { const ev = S.draft, k = el.dataset.k, cur = !!(S.adm.events.find(e => e.id === ev.id)?.controls || {})[k];
    if (!cur && !confirm(`${EV_CONTROLS.find(x => x[0] === k)[1]} for “${ev.name}” now?`)) return;
    try { const c = await DB.eventControl(ev.id, { [k]: !cur, message: S.ui.ctlMsg ?? undefined }); const e = S.adm.events.find(x => x.id === ev.id); if (e) e.controls = c; ev.controls = c; await reloadAdmin(); await refreshPublic(); toast(cur ? 'Back to normal' : 'Done — it applies immediately'); render(); } catch (e) { toast(e.message, true); } },
  evControlMsg: async () => { const ev = S.draft; try { const c = await DB.eventControl(ev.id, { message: S.ui.ctlMsg || '' }); ev.controls = c; await reloadAdmin(); await refreshPublic(); toast('Message updated'); render(); } catch (e) { toast(e.message, true); } },
  cartMin: el => { S.draft.cartMinutes = +el.dataset.v; dirty(); render(); },
  addXFee: () => { ((S.draft.fees ||= {}).extra ||= []).push({ id: shortId('fx_'), name: 'Facility fee', pct: '', fixed: 100, per: 'ticket', optional: false }); dirty(); render(); },
  delXFee: el => { S.draft.fees.extra.splice(+el.dataset.i, 1); dirty(); render(); },
  erExport: el => { const R = eventReportData(S.draft, S.ui.er), sheets = reportSheets(R).filter(([n]) => can('finance.reports') || !['Revenue', 'Reconciliation', 'Promotions'].includes(n)), name = slugify(S.draft.name) + '-full-report';
    if (el.dataset.v === 'xlsx') xpDownload(name, sheets.map(([n, rows]) => ({ name: n, rows })), 'xlsx');
    else download(name + '.csv', sheets.map(([n, rows]) => [[n], ...rows, []]).flat().map(r => r.map(csvCell).join(',')).join('\n')); },
  erPrint: () => { document.body.classList.add('print-report'); window.print(); setTimeout(() => document.body.classList.remove('print-report'), 500); },
  erCmp: el => { const s = new Set(S.ui.er.cmp || []); el.checked ? s.add(el.dataset.v) : s.delete(el.dataset.v); S.ui.er.cmp = [...s].slice(0, 5); render(); },
  restoreVersion: el => { const v = (S.adm.versions || []).find(x => x.id === el.dataset.id); if (!v) return;
    const cur = S.draft, snap = clone(v.snapshot);
    S.draft = normEvent({ ...cur, ...snap, id: cur.id, box_office_id: cur.box_office_id, slug: cur.slug, status: cur.status, secrets: cur.secrets, controls: cur.controls,
      seating: snap.seating ? { ...snap.seating, bg: cur.seating?.bg } : cur.seating });
    if (S.draft.seating?.enabled) Object.assign(S.draft.seating, seatDerive(S.draft.seating));
    dirty(); toast(`Version from ${fmtDT(v.at)} loaded — review it, then Save changes`); render(); },
  restoreSettings: async el => { const v = (S.adm.versions || []).find(x => x.id === el.dataset.id); if (!v || !confirm(`Restore the box office settings from ${fmtDT(v.at)}?`)) return;
    try { await DB.saveBoxOffice({ settings: v.snapshot.settings, branding: v.snapshot.branding }); await refreshPublic(); await reloadAdmin(); S.ui.set = null; toast('Settings restored'); render(); } catch (e) { toast(e.message, true); } },
  autoRestore: () => { const a = autosaved(S.draft.id); if (!a) return; S.draft = normEvent({ ...a.draft, seating: a.draft.seating ? { ...a.draft.seating, bg: S.draft.seating?.bg } : a.draft.seating }); S.dirty = true; toast('Unsaved changes restored — Save to keep them'); render(); },
  autoDiscard: () => { try { localStorage.removeItem(AUTO_KEY(S.draft.id)); } catch (e) { } render(); },
  reviewOrder: async el => { try { await DB.orderAction(el.dataset.id, 'review', { result: el.dataset.v }); await reloadAdmin(); toast(el.dataset.v === 'fraud' ? 'Marked as fraud' : 'Flags cleared'); render(); } catch (e) { toast(e.message, true); } },
  banAsk: el => { S.ui.ban = { email: el.dataset.v, reason: '' }; modal('Ban from buying', `<p class="small muted" style="margin-bottom:10px"><b>${esc(el.dataset.v)}</b> won't be able to buy tickets from ${esc(S.adm.bo.name)}. Existing tickets stay valid. Only staff see the reason.</p>
    <div class="field"><label class="fl">Reason</label><textarea class="inp" data-input="ban.reason"></textarea></div>`, `<button class="btn btn-ghost" data-action="closeModal">Cancel</button><button class="btn btn-danger" data-action="banAdd">Ban</button>`); },
  banAdd: async () => { const b = S.ui.ban || {}; try { await DB.banCustomer(b.email, b.reason); closeModal(); S.ui.ban = null; await reloadAdmin(); toast('Banned'); render(); } catch (e) { toast(e.message, true); } },
  banRemove: async el => { try { await DB.unbanCustomer(el.dataset.id); await reloadAdmin(); toast('Ban removed'); render(); } catch (e) { toast(e.message, true); } },
  showAccepted: el => { const t = S.adm.policyTexts?.[el.dataset.v]; if (t) modal(esc(t.title), `<p style="white-space:pre-line">${esc(t.text)}</p><p class="small muted" style="margin-top:12px">Version ${esc(el.dataset.v)} · first accepted ${esc(fmtDT(t.first_at))}</p>`); },
  inboxFilter: el => { S.ui.inf = el.dataset.v; render(); },
  inboxReply: async el => { try { await DB.supportAction(el.dataset.id, 'reply', { body: S.ui['rep_' + el.dataset.id] || '' }); S.ui['rep_' + el.dataset.id] = ''; await reloadAdmin(); toast('Reply sent'); render(); } catch (e) { toast(e.message, true); } },
  inboxStatus: async el => { try { await DB.supportAction(el.dataset.id, el.dataset.v); await reloadAdmin(); render(); } catch (e) { toast(e.message, true); } },
  pickPlan: async el => { const p = (S.adm.plans || DEFAULT_PLANS).find(x => x.id === el.dataset.v); if (!confirm(`Switch to the ${p.name} plan (${p.monthly ? money(p.monthly) + ' a month' : 'no monthly fee'})?`)) return;
    try { await DB.setPlan(p.id); await reloadAdmin(); await refreshPublic(); toast('Plan changed'); render(); } catch (e) { toast(e.message, true); } },
  viewInvoice: el => { const i = (S.adm?.invoices || []).concat(S.plat?.invoices || []).find(x => x.id === el.dataset.id); if (i) modal('Invoice ' + esc(i.number), invoiceHtml(i), `<button class="btn btn-ghost" data-action="printInvoice">Print / PDF</button>`); },
  printInvoice: () => { document.body.classList.add('print-modal'); window.print(); setTimeout(() => document.body.classList.remove('print-modal'), 500); },
  saveDomain: async () => { try { await DB.saveDomain(S.ui.domHost ?? S.adm.bo.domain?.host ?? ''); S.ui.domHost = undefined; await reloadAdmin(); toast('Saved — now add the DNS records'); render(); } catch (e) { toast(e.message, true); } },
  removeDomain: async () => { if (!confirm('Remove the custom domain?')) return; try { await DB.saveDomain(''); S.ui.domHost = undefined; await reloadAdmin(); render(); } catch (e) { toast(e.message, true); } },
  checkDomain: async el => { try { const d = await DB.checkDomain(el.dataset.v); await reloadAdmin(); toast(d.status === 'verified' ? 'Verified' : 'Not found yet — DNS can take up to an hour'); render(); } catch (e) { toast(e.message, true); } },
  saveMailDomain: async () => { try { await DB.mailDomain(S.ui.mailDom ?? S.adm.bo.mailDomain?.domain ?? ''); S.ui.mailDom = undefined; await reloadAdmin(); toast('Saved — add the DNS records, then Verify'); render(); } catch (e) { toast(e.message, true); } },
  onboardDone: async () => { try { await DB.saveBoxOffice({ settings: { ...S.adm.bo.settings, onboarded: true } }); await reloadAdmin(); render(); } catch (e) { toast(e.message, true); } },
  gwPause: async () => { const g = S.adm.bo.gateway; if (!g.disabled && !confirm('Pause card payments for every event? Buyers can still reserve (pay later) if that is on.')) return;
    try { await DB.pauseGateway(!g.disabled); await reloadAdmin(); await refreshPublic(); toast(g.disabled ? 'Card payments resumed' : 'Card payments paused'); render(); } catch (e) { toast(e.message, true); } },
  regPlan: el => { S.ui.reg.plan = el.dataset.v; render(); },
  regAgree: el => { S.ui.reg.agree = el.checked; },
  pef: el => { S.ui.pef = el.dataset.v; render(); },
  billingRun: async () => { const p = S.ui.bp || (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
    try { const n = await DB.billingRun(p); S.plat = await DB.loadPlatform(); toast(n ? `${n} invoice${n === 1 ? '' : 's'} created` : 'Nothing to invoice for ' + p); render(); } catch (e) { toast(e.message, true); } },
  invoiceDo: async el => { try { await DB.invoiceAction(el.dataset.id, el.dataset.v); S.plat = await DB.loadPlatform(); render(); } catch (e) { toast(e.message, true); } },
  platReload: async () => { S.plat = await DB.loadPlatform(); render(); },
  newIncident: () => IncidentModal(null),
  editIncident: el => IncidentModal(el.dataset.id),
  saveIncident: async el => { const f = S.ui.inc; try { await DB.saveIncident({ ...f, status: el.dataset.v, ended_at: el.dataset.v === 'resolved' ? new Date().toISOString() : '' }); closeModal(); S.plat = await DB.loadPlatform(); toast('Incident saved'); render(); } catch (e) { toast(e.message, true); } },
  confPreview: () => { const ev = S.draft, o = S.adm.orders.find(x => x.event_ids.includes(ev.id) && x.status === 'paid') || { id: 'preview', ref: 'SET-PREVIEW', buyer_email: 'guest@example.com', box_office_id: ev.box_office_id, event_ids: [ev.id], data: { buyer: { name: 'Sample Guest' }, lines: [{ eventId: ev.id }] } };
    modal('Confirmation email preview', `<div class="email-pv">${msgPreview({ kind: 'confirmation', channel: 'email', category: 'transactional', order_id: o.id, event_id: ev.id, to: o.buyer_email, _event: ev, _order: o })}</div>`); },
  addPlan: () => { S.ui.ps.planList.push({ id: shortId('plan_'), name: 'New plan', monthly: 0, feePct: '', feeFixed: '', blurb: '' }); render(); },
  delPlan: el => { S.ui.ps.planList.splice(+el.dataset.i, 1); render(); },
  defPlan: el => { S.ui.ps.defaultPlan = el.dataset.v; },
  // ── Stage 9: reports, expenses, chargebacks, exports ──
  repClear: () => { S.ui.rep = emptyFin(); render(); },
  repProfit: el => { S.ui.rep = { ...emptyFin(), eventId: el.dataset.id }; location.hash = '#/admin/reports/profit'; },
  xpEventId: el => { S.ui.rep = { ...emptyFin(), eventId: el.dataset.id }; A.xpEvent({ dataset: { fmt: 'xlsx' } }); },
  repOpenEvent: el => { S.ui.rep = { ...emptyFin(), eventId: el.dataset.id }; S.ui.repBy = 'tt'; location.hash = '#/admin/reports'; },
  recClear: () => { S.ui.recImport = null; render(); },
  recAll: () => { S.ui.recAll = !S.ui.recAll; render(); },
  expAdd: async el => { const e = S.ui.exp || {}; try { await DB.saveExpense({ event_id: el.dataset.id, category: e.category || 'Venue', description: e.description, vendor: e.vendor, date: e.date, amount: opDollars(e.amount) });
    S.ui.exp = { category: e.category || 'Venue', description: '', amount: '', date: '', vendor: '' }; await reloadAdmin(); toast('Expense added'); render(); } catch (x) { toast(x.message, true); } },
  expDel: async el => { if (!confirmIn('Delete this expense?')) return; try { await DB.deleteExpense(el.dataset.id); await reloadAdmin(); toast('Expense deleted'); render(); } catch (x) { toast(x.message, true); } },
  expFinal: async el => { try { await DB.setExpensesFinal(el.dataset.id, el.checked); await reloadAdmin(); toast(el.checked ? 'Profit marked final' : 'Profit marked estimated'); render(); } catch (x) { toast(x.message, true); render(); } },
  cbAdd: async () => { const o = S.adm.orders.find(x => x.id === S.ui.oid), c = S.ui.cb || {}; if (!o) return;
    try { await DB.orderAction(o.id, 'chargeback', { amount: opDollars(c.amount), reason: c.reason, ref: c.ref }); S.ui.cb = null; await reloadAdmin(); toast('Chargeback recorded'); render(); } catch (x) { toast(x.message, true); } },
  cbOpen: () => { const o = S.adm.orders.find(x => x.id === S.ui.oid); S.ui.cb = { amount: o ? String((o.data.total || 0) / 100) : '', reason: '', ref: '' }; render(); },
  cbCancel: () => { S.ui.cb = null; render(); },
  cbClose: async el => { try { await DB.orderAction(S.ui.oid, 'chargeback', { id: el.dataset.id, status: el.dataset.v }); await reloadAdmin(); toast('Chargeback ' + el.dataset.v); render(); } catch (x) { toast(x.message, true); } },
  xp: el => { const k = el.dataset.k, s = XP_SETS.find(x => x[0] === k); if (!s || !xpOk(s)) return toast('You don\'t have permission to export that', true);
    xpDownload(`${slugify(S.adm.bo.name)}-${k}-${fileStamp()}`, [{ name: s[1], rows: xpRows(k, finRep()) }], el.dataset.fmt); },
  xpAll: () => { const rep = finRep(); xpDownload(`${slugify(S.adm.bo.name)}-reports-${fileStamp()}`, XP_SETS.filter(xpOk).map(s => ({ name: s[1], rows: xpRows(s[0], rep) })), 'xlsx'); },
  xpEvent: el => { const rep = finRep(), ev = evById(rep.f.eventId); if (!ev) return toast('Choose an event', true); if (!can('finance.export')) return toast('You need the “Export financial reports” permission', true);
    const sets = EVENT_SHEETS.map(k => XP_SETS.find(s => s[0] === k)).filter(s => s && xpOk(s) && (s[0] !== 'seats' || ev.seating?.enabled));
    xpDownload(`${slugify(ev.name)}-everything-${fileStamp()}`, sets.map(s => ({ name: s[1], rows: xpRows(s[0], rep) })), el.dataset.fmt); },
  xpOwn: async el => { try { const d = await DB.exportAll(S.adm.bo.id), name = `${slugify(S.adm.bo.name)}-all-data-${fileStamp()}`;
    if (el.dataset.fmt === 'json') download(name + '.json', JSON.stringify(d, null, 1), 'application/json'); else xpDownload(name, ownSheets(d), 'xlsx'); toast('Downloaded — amounts are in cents'); } catch (x) { toast(x.message, true); } },
  gateXp: async () => { try { const d = await DB.exportAll(S.adm.bo.id); xpDownload(`${slugify(S.adm.bo.name)}-all-data-${fileStamp()}`, ownSheets(d), 'xlsx'); } catch (x) { toast(x.message, true); } },
  platXp: async () => { try { const d = await DB.platformExport(); xpDownload(`platform-data-${fileStamp()}`, ownSheets({ ...d, box_office: d.platform }), 'xlsx'); toast('Platform data downloaded'); } catch (x) { toast(x.message, true); } },
  xpJournal: el => { const rep = finRep(), accts = S.adm.bo.settings?.accounting?.accounts || {}, j = journal(rep, accts), code = k => accts[k + '_code'] || ACCOUNTS.find(a => a[0] === k)[2];
    const rows = el.dataset.v === 'xero' ? [['*Narration', '*Date', 'Description', '*AccountCode', '*TaxRate', '*Amount'], ...j.map(x => ['SET ticket sales ' + x.date, x.date, x.memo, code(x.key), 'Tax Exempt', $$(x.debit - x.credit)])]
      : [['Journal No', 'Journal Date', 'Account', 'Debits', 'Credits', 'Description', 'Name'], ...j.map(x => ['SET-' + x.date.replace(/-/g, ''), x.date, x.account, $$(x.debit) || '', $$(x.credit) || '', x.memo, ''])];
    download(`${slugify(S.adm.bo.name)}-journal-${el.dataset.v}-${fileStamp()}.csv`, csv(rows)); },
  acctSave: async () => { try { const accounts = Object.fromEntries(Object.entries(S.ui.acct || {}).map(([k, v]) => [k, String(v).trim().slice(0, 80)]).filter(([, v]) => v));
    await DB.saveBoxOffice({ settings: { ...S.adm.bo.settings, accounting: { accounts } } }); await reloadAdmin(); S.ui.acct = null; toast('Account names saved'); render(); } catch (x) { toast(x.message, true); } },
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
  addon: el => { const a = S.sel.addons; a[el.dataset.id] = Math.max(0, Math.min((a[el.dataset.id] || 0) + +el.dataset.d, +el.dataset.max || 99)); render(); },
  bqty: el => { const b = S.sel.bundles ||= {}; b[el.dataset.id] = Math.max(0, Math.min((b[el.dataset.id] || 0) + +el.dataset.d, +el.dataset.max || 10)); render(); },
  pickSeat: el => { if (S.route.page === 'admin') return adminPickSeat(el.dataset.v); const s = el.dataset.v, a = S.sel.seats; const i = a.indexOf(s); if (i >= 0) a.splice(i, 1); else if (a.length < 10) a.push(s); else toast('Maximum 10 seats per order'); render(); },
  unlock: async () => { const ev = evById(S.sel.eventId); try { const r = await DB.unlock(ev.id, S.sel.pw); if (r?.event || r?.ticketTypes?.length) { S.sel.unlocked = { event: S.sel.unlocked.event || r.event, tts: [...S.sel.unlocked.tts, ...(r.ticketTypes || [])] }; S.cart.unlock[ev.id] = S.sel.pw; saveCart(); toast('Unlocked'); } else toast('That code isn\'t valid', true); render(); } catch (e) { toast(e.message, true); } },
  pickGa: el => { if (S.route.page === 'admin') return adminPickGa(el.dataset.v); const ev = evById(S.sel.eventId), off = offSeats(S.avail[ev.id], S.sel.slotId), a = S.sel.seats;
    const spot = layoutOf(ev.seating).seats.find(p => p.sec.code === el.dataset.v && !off.has(p.id) && !a.includes(p.id));
    if (!spot) return toast('That area is sold out', true); if (a.length >= 10) return toast('Maximum 10 seats per order'); a.push(spot.id); render(); },
  bLevel: el => { S.ui.bLevel = el.dataset.v; if (S.ui.pvOpen && document.querySelector('.modal .sm-buy')) A.smPreview(); else render(); },
  addToCart: async () => {
    const ev = evById(S.sel.eventId), sel = S.sel, sc = selCart(ev, sel);
    if (sc.err) return toast(sc.err, true);
    let hold;
    if (ev.seating?.enabled) {  // hold the seats for this buyer while they check out
      try { hold = (await DB.holdSeats(ev.id, sel.slotId || '', sel.seats))?.expires || null; }
      catch (e) { toast(e.message, true); refreshAvail(ev.id); return; }
    }
    const items = sc.items;
    if ([...S.cart.items, ...S.cart.addons].some(i => boOf(evById(i.eventId))?.id !== ev.box_office_id)) { S.cart = { items: [], addons: [], donation: 0, unlock: {} }; S.co.disc = null; toast('Your cart had another organizer\'s tickets — it now holds just this event'); }
    if (hold !== undefined) (S.cart.holds ||= {})[ev.id] = hold;
    S.cart.items = S.cart.items.filter(i => i.eventId !== ev.id).concat(items);
    S.cart.addons = S.cart.addons.filter(a => a.eventId !== ev.id).concat(sc.addons);
    if (sel.pw) S.cart.unlock[ev.id] = sel.pw;
    saveCart(); location.hash = S.route.page === 'embed' ? '#/cart?embed' : '#/cart';
  },
  removeEv: el => { if (S.cart.holds?.[el.dataset.id] !== undefined) { DB.releaseSeats(el.dataset.id).catch(() => { }); delete S.cart.holds[el.dataset.id]; }
    S.cart.items = S.cart.items.filter(i => i.eventId !== el.dataset.id); S.cart.addons = S.cart.addons.filter(i => i.eventId !== el.dataset.id); saveCart(); render(); },
  donate: el => { S.cart.donation = +el.dataset.v; S.co.donCustom = false; saveCart(); render(); },
  optFee: el => { const s = new Set(S.cart.optFees || []); el.checked ? s.add(el.dataset.v) : s.delete(el.dataset.v); S.cart.optFees = [...s]; saveCart(); render(); },
  showPolicy2: el => { const evs = cartEventIds().map(evById).filter(Boolean), p = policiesFor(cartBo(), evs)[+el.dataset.i]; if (p) modal(esc(p.title), `<p style="white-space:pre-line">${esc(p.text)}</p><p class="small muted" style="margin-top:12px">Version ${esc(p.version)}</p>`); },
  pay: el => { S.co.payment = el.dataset.v; render(); },
  showTerms: () => modal('Terms & conditions', `<p style="white-space:pre-line">${esc(S.settings.terms)}</p>`),
  // one box: a promo code (discount) or a tracking / referral code (credits whoever sent you)
  applyCode: async () => {
    const code = S.co.code.trim(); if (!code) return;
    const r = await DB.checkCode(cartEventIds(), code).catch(() => null);
    if (r?.kind === 'promo' && !r.error) { S.co.disc = r; S.co.err = ''; toast('Code applied'); return render(); }
    if (r?.kind === 'tracking') { S.co.tracking = r.code; S.co.code = ''; toast('Referral code added'); return render(); }
    toast(r?.error || 'That code isn\'t valid', true);
  },
  removeCode: () => { S.co.disc = null; S.co.code = ''; render(); },
  openCredit: () => { S.co.creditOpen = true; render(); },
  applyCredit: async () => { const bo = cartBo(); try { const c = await DB.checkCredit(bo?.id, S.co.creditCode); const why = !c ? 'That credit code is not valid' : c.status !== 'active' ? 'That credit is ' + c.status : c.event_id && !cartEventIds().includes(c.event_id) ? 'That credit is for a different event' : '';
    if (why) return toast(why, true); S.co.credit = { ...c, box_office_id: bo?.id }; S.co.useAcct = false; render(); } catch (e) { toast(e.message, true); } },
  removeCredit: () => { S.co.credit = null; S.co.creditCode = ''; render(); },
  removeRef: () => { S.co.tracking = ''; sessionStorage.removeItem('set_ref'); render(); },
  addUpsell: el => { const a = S.cart.addons.find(x => x.eventId === el.dataset.id && x.addonId === el.dataset.v);
    if (a) a.qty += +el.dataset.q || 1; else S.cart.addons.push({ eventId: el.dataset.id, addonId: el.dataset.v, qty: +el.dataset.q || 1 }); saveCart(); toast('Added to your order'); render(); },
  delAddonLine: el => { S.cart.addons = S.cart.addons.filter(x => !(x.eventId === el.dataset.id && x.addonId === el.dataset.v)); saveCart(); render(); },
  placeOrder: async () => {
    pix('InitiateCheckout', { value: cartQuote().total || 0, currency: S.settings.currency || 'USD' });
    const co = S.co, set = S.settings, evs = cartEventIds().map(evById).filter(Boolean), ck = checkoutFor(set, evs), q = cartQuote(); co.err = '';
    if (!co.name.trim() || !EMAIL_RE.test(co.email.trim())) co.err = 'Please enter your name and a valid email.';
    else if (ck.phone === 'required' && !String(co.phone || '').trim()) co.err = 'Please enter your mobile number.';
    else if (ck.address === 'required' && !String(co.address || '').trim()) co.err = 'Please enter your address.';
    else co.err = checkAnswers(set.questions, cartEventIds().map(evById).filter(Boolean), co.answers, tAnswers(), ticketsPerEvent(q));
    if (!co.err && !co.terms) co.err = 'Please accept the terms & policies.';
    if (co.err) return render();
    co.busy = true; co.attempt ||= uid(); render();   // one attempt id per checkout: a double click or retry returns the same order
    try {
      const r = await DB.placeOrder({ buyer: { name: co.name.trim(), email: co.email.trim(), phone: String(co.phone || '').trim(), ...(co.address ? { address: co.address.trim() } : {}) },
        items: S.cart.items, addons: S.cart.addons, code: co.disc?.code || '', tracking: co.tracking || sessionStorage.getItem('set_ref') || '',
        donation: S.cart.donation || 0, payment: q.total === 0 ? 'free' : co.payment, answers: co.answers, ticketAnswers: tAnswers(), optIn: !!co.optIn, smsOptIn: !!co.smsOptIn && !!normPhone(co.phone),
        source: sessionStorage.getItem('set_src') || null, utm: (() => { try { return JSON.parse(sessionStorage.getItem('set_utm') || 'null'); } catch (e) { return null; } })(), unlock: S.cart.unlock, holdToken: DB.holdToken(), attempt: co.attempt,
        credit: q.credit ? co.credit?.code || 'account' : '', optFees: S.cart.optFees || [],
        gifts: S.cart.gifts || [], passes: S.cart.passes || [], boxOfficeId: cartBo()?.id || null, pass: co.pass?.code || '', installments: !!co.plan && co.payment === 'card' && q.total > 0,
        accepted: policiesFor(cartBo(), evs).map(({ kind, eventId, version }) => ({ kind, eventId, version })),   // Stage 10: the versions the buyer just agreed to
        bot: { hp: co.hp || '', ms: Date.now() - (co.t0 || Date.now()), wd: !!navigator.webdriver } });
      if (r.status === 'awaiting_payment') return startPay(r);
      checkoutDone(r);
    } catch (e) { co.busy = false; co.err = e.message; render(); }
  },
  payCard: async () => payWith(S.co.card || {}),
  payWallet: el => payWith({ wallet: el.dataset.v }),
  payCancel: async () => { const p = S.co.pay; if (!p) return; await DB.cancelCheckout(p.id, p.key).catch(() => { }); endPay(); toast('Checkout cancelled — your seats were released'); },
  payRestart: () => { endPay(); },
  sigClear: el => { setPath(S.co, el.dataset.v, ''); render(); },
  resumePay: async e => { await resumePay(); location.hash = '#/cart'; },
  saveTickets: async () => {
    const ord = S.order?.order; if (!ord) return;
    try { const r = await DB.custSignUp({ name: ord.data.buyer.name, email: ord.buyer_email, password: S.ui.saveAcct?.pw || '' }); S.ui.saveAcct = {};
      if (r.confirm) toast('Check your email to confirm your account'); else { await loadCustomer(); toast('Account created — your tickets are saved'); } render(); } catch (e) { toast(e.message, true); }
  },
  custAuth: async () => {
    const f = S.ui.ca || {}; f.err = '';
    try {
      if (f.mode === 'up') { const r = await DB.custSignUp({ name: f.name, email: f.email, password: f.pw }); if (r.confirm) { f.sent = true; return render(); } }
      else if (f.mode === 'forgot') { await DB.custForgot(f.email); f.sent = true; return render(); }
      else await DB.custSignIn(f.email, f.pw);
      S.ui.ca = { mode: 'in' }; S.wallet = null; await loadCustomer(); render();
    } catch (e) { f.err = e.message; S.ui.ca = f; render(); }
  },
  custMode: el => { S.ui.ca = { ...(S.ui.ca || {}), mode: el.dataset.v, err: '', sent: false }; render(); },
  custOut: async () => { await DB.custSignOut(); S.cust = null; S.wallet = null; S.co = { ...S.co, name: '', email: '', phone: '' }; location.hash = '#/account'; render(); },
  custTab: el => { S.ui.wtab = el.dataset.v; render(); },
  saveProfile: async () => { const f = S.ui.prof || {}; try { await DB.saveProfile({ name: f.name ?? S.cust.name, phone: f.phone ?? S.cust.phone }); await loadCustomer(); S.ui.prof = {}; toast('Profile saved'); render(); } catch (e) { toast(e.message, true); } },
  changePw: async () => { const f = S.ui.pw || {}; try { await DB.changePassword(f.cur || '', f.next || ''); S.ui.pw = {}; toast('Password changed'); render(); } catch (e) { toast(e.message, true); } },
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
  saveSettings: async () => { try { if (S.ui.donAmts != null) S.ui.set.donationAmounts = String(S.ui.donAmts).split(/[,\s]+/).map(x => Math.round(+x * 100)).filter(x => x > 0).slice(0, 6);
    if (S.ui.giftAmts != null) { S.ui.set.gifts ||= {}; S.ui.set.gifts.amounts = String(S.ui.giftAmts).split(/[,\s]+/).map(x => Math.round(+x * 100)).filter(x => x > 0).slice(0, 8); S.ui.giftAmts = null; }
    await DB.saveBoxOffice({ settings: { ...S.adm.bo.settings, ...JSON.parse(JSON.stringify(S.ui.set)) } }); S.ui.donAmts = null; await refreshPublic(); await reloadAdmin(); S.ui.set = null; setContext(); loadPixels(); toast('Settings saved'); render(); } catch (e) { toast(e.message, true); } },
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
  savePlatform: async () => { const f = S.ui.ps; try {
    const planList = (f.planList || []).filter(p => String(p.name || '').trim()).map(p => ({ id: p.id || slugify(p.name), name: String(p.name).trim().slice(0, 40), monthly: Math.max(0, Math.round((+p.monthly || 0) * 100)), feePct: p.feePct === '' || p.feePct == null ? '' : +p.feePct, feeFixed: p.feeFixed === '' || p.feeFixed == null ? '' : Math.max(0, Math.round(+p.feeFixed * 100)), blurb: String(p.blurb || '').slice(0, 160) }));
    if (!planList.length) throw new Error('Keep at least one plan');
    await DB.savePlatform({ name: f.name, publicRegistration: !!f.publicRegistration, autoApprove: !!f.autoApprove, feePct: +f.feePct || 0, feeFixed: +f.feeFixed || 0, feePayer: f.feePayer === 'buyer' ? 'buyer' : 'organizer',
      planList, defaultPlan: planList.some(p => p.id === f.defaultPlan) ? f.defaultPlan : planList[0].id, gatewaysOff: Object.keys(GATEWAYS).filter(k => f.off?.[k]), domainTarget: String(f.domainTarget || '').trim().toLowerCase(),
      appHosts: String(f.appHostsText || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean), invoiceDays: Math.max(1, +f.invoiceDays || 14), admins: f.adminsText.split(',') }); S.ui.ps = null; S.plat = null; await refreshPublic(); toast('Platform settings saved'); render(); } catch (e) { toast(e.message, true); } },
  register: async () => { const f = S.ui.reg; try { if (!f.agree) throw new Error('Please accept the organizer terms'); const r = await DB.createBoxOffice({ name: f.name, ownerEmail: f.ownerEmail, ownerName: f.ownerName, plan: f.plan || S.platform.defaultPlan, phone: f.phone, agree: true }, true); f.done = true; f.active = r?.status === 'active'; render(); } catch (e) { toast(e.message, true); } },
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
    const ev = eventFromTemplate(t);
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
  // ── seat inventory ──
  invFilter: el => { const iv = S.ui.iv ||= {}; iv.filter = iv.filter === el.dataset.v ? '' : el.dataset.v; render(); },
  invLevel: el => { (S.ui.iv ||= {}).level = el.dataset.v; render(); },
  invSelAll: () => { const ev = S.adm.events.find(e => e.id === S.draft.id), d = invData(ev); S.ui.invSel = [...d.states].filter(([id, x]) => d.match(id, x, S.ui.iv.filter)).map(([id]) => id); render(); },
  invClear: () => { S.ui.invSel = []; S.ui.invMove = ''; render(); },
  invPick: el => { S.ui.invSel = [el.dataset.v]; const p = layoutOf(S.adm.events.find(e => e.id === S.draft.id).seating).byId.get(el.dataset.v); if (p) (S.ui.iv ||= {}).level = p.level; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  invDo: async el => {
    const ev = S.adm.events.find(e => e.id === S.draft.id), d = invData(ev), iv = S.ui.iv, act = el.dataset.v, seats = (S.ui.invSel || []).filter(id => d.states.has(id));
    if (['price', 'area'].includes(act) && S.dirty) return toast('Save your other changes first', true);
    if (act === 'hold' && !iv.note?.trim()) return toast('Add a note saying who the seats are held for', true);
    const slot = iv.scope === 'all' ? '' : d.slot;
    try { await DB.seatAction(ev.id, slot, act, seats, { note: iv.note || '', ttId: iv.tt || '', area: iv.area || '' });
      S.ui.invSel = []; iv.note = ''; await reloadAdmin(); toast(`${{ block: 'Blocked', unblock: 'Unblocked', hold: 'Held', release: 'Released', unavailable: 'Made unavailable', available: 'Made available', price: 'Re-priced', area: 'Moved to the new area' }[act]} — ${seats.length} seat${seats.length === 1 ? '' : 's'}`); render(); }
    catch (e) { toast(e.message, true); } },
  invMove: el => { S.ui.invMove = el.dataset.v; render(); },
  invMoveCancel: () => { S.ui.invMove = ''; render(); },
  invMoveTo: async to => { const ev = S.adm.events.find(e => e.id === S.draft.id), d = invData(ev), from = S.ui.invMove; if (to === from) return;
    try { await DB.seatAction(ev.id, d.slot, 'move', [from], { to }); S.ui.invMove = ''; S.ui.invSel = [to]; await reloadAdmin(); toast('Customer moved to ' + seatName(ev, to)); render(); } catch (e) { toast(e.message, true); } },
  invExport: () => { const ev = S.adm.events.find(e => e.id === S.draft.id), d = invData(ev), f = S.ui.iv.filter;
    const rows = f && f !== 'total' ? [...d.states].filter(([id, x]) => d.match(id, x, f)) : (S.ui.invSel || []).map(id => [id, d.states.get(id)]).filter(r => r[1]);
    download(slugify(ev.name) + '-seats.csv', csv([['Seat ID', 'Area', 'Row', 'Seat', 'Status', 'Price level', 'Customer', 'Order', 'Discount code', 'Note', 'By', 'At'],
      ...rows.map(([id, x]) => { const sp = seatParts(ev, id, x.t); return [id, sp.area, sp.row, sp.seat, SEAT_STATES[x.state], ev.ticketTypes.find(t => t.id === x.p.tt)?.name || '', x.t?.holder || '', x.o?.ref || '', x.o?.data?.code || '', x.s?.note || '', x.s?.by || '', x.s?.at || x.o?.created_at || '']; })])); },
  // ── venue library ──
  newVenue: async () => { const list = JSON.parse(JSON.stringify(S.adm.bo.venues || [])), v = { id: shortId('ven_'), name: 'New venue', address: '', updated_at: new Date().toISOString(), updated_by: S.user.email,
      chart: { stage: { x: -150, y: -120, w: 300, h: 46, label: 'STAGE' }, sections: [] }, tiers: [{ id: shortId('tt_'), name: 'Standard', price: 5000 }] };
    try { await DB.saveVenues([...list, v]); S.adm.bo.venues = [...list, v]; location.hash = '#/admin/venues/' + v.id; } catch (e) { toast(e.message, true); } },
  dupVenue: async el => { const list = JSON.parse(JSON.stringify(S.adm.bo.venues || [])), src = list.find(v => v.id === el.dataset.v); if (!src) return;
    const v = { ...JSON.parse(JSON.stringify(src)), id: shortId('ven_'), name: src.name + ' (copy)', updated_at: new Date().toISOString() };
    try { await DB.saveVenues([...list, v]); S.adm.bo.venues = [...list, v]; toast('Duplicated'); render(); } catch (e) { toast(e.message, true); } },
  delVenue: async el => { const v = S.adm.bo.venues.find(x => x.id === el.dataset.v); if (!confirmIn(`Delete the venue chart “${v.name}”? Events that use it keep their own copy.`)) return;
    const list = S.adm.bo.venues.filter(x => x.id !== v.id); try { await DB.saveVenues(list); S.adm.bo.venues = list; render(); } catch (e) { toast(e.message, true); } },
  saveVenue: async () => { const d = S.draft, list = JSON.parse(JSON.stringify(S.adm.bo.venues || [])), i = list.findIndex(v => v.id === d._venue); if (i < 0) return;
    const seen = new Set(), dup = seatLayout(d.seating).seats.map(p => p.id).find(id => seen.has(id) || !seen.add(id)); if (dup) return toast(`Two seats would share the ID ${dup} — check row labels and seat numbers`, true);
    const v = { ...eventToVenue(d, (d.name || '').trim() || 'Venue', d._venue), address: d.address || '', tiers: d.ticketTypes.map(t => ({ id: t.id, name: t.name, price: +t.price || 0 })) };
    list[i] = v; try { await DB.saveVenues(list); S.adm.bo.venues = list; S.dirty = false; toast('Venue chart saved'); render(); } catch (e) { toast(e.message, true); } },
  addTier: () => { S.draft.ticketTypes.push({ id: shortId('tt_'), name: 'Tier ' + (S.draft.ticketTypes.length + 1), price: 0 }); dirty(); render(); },
  delTier: el => { const t = S.draft.ticketTypes.splice(+el.dataset.i, 1)[0], st = S.draft.seating; (st.sections || []).forEach(x => { if (x.ticketTypeId === t.id) x.ticketTypeId = ''; });
    Object.keys(st.prices || {}).forEach(k => { if (st.prices[k] === t.id) delete st.prices[k]; }); dirty(); render(); },
  smDup: () => { const st = S.draft.seating, ids = [...smMulti()], made = [];
    for (const id of ids) { const src = st.sections.find(x => x.id === id); if (!src) continue;
      const c = { ...JSON.parse(JSON.stringify(src)), id: shortId('sec_'), code: nextCode({ table: 'T', booth: 'B', ga: 'GA' }[secKind(src)] || 'S'), name: src.name + ' copy', x: (+src.x || 0) + 40, y: (+src.y || 0) + 40 };
      st.sections.push(c); made.push(c.id); }
    S.ui.smMulti = made; S.ui.smSel = made.length === 1 ? made[0] : ''; dirty(); render(); },
  // a mirrored copy on the other side of the stage's centre line (seat numbers run the other way)
  smMirror: () => { const st = S.draft.seating, L = layoutOf(st), M = st.stage ? +st.stage.x + +st.stage.w / 2 : 0, made = [];
    for (const id of smMulti()) { const src = st.sections.find(x => x.id === id), g = L.secs.find(x => x.sec.id === id); if (!src || !g) continue;
      const c = { ...JSON.parse(JSON.stringify(src)), id: shortId('sec_'), code: nextCode({ table: 'T', booth: 'B', ga: 'GA' }[secKind(src)] || 'S'), name: src.name + ' (mirror)', rot: -(+src.rot || 0), reverse: !src.reverse };
      c.x = Math.round(2 * M - (+src.x || 0) - 2 * g.cx); st.sections.push(c); made.push(c.id); }
    S.ui.smMulti = made; S.ui.smSel = made.length === 1 ? made[0] : ''; dirty(); render(); },
  smDel: () => { const st = S.draft.seating, ids = smMulti(), secs = st.sections.filter(x => ids.has(x.id)); if (!secs.length) return;
    const sold = soldSeatIds(S.draft); if (secs.some(sec => sold.some(id => id.startsWith(sec.code + '-')))) return toast('Seats in this section are sold — block them in Seat inventory instead', true);
    st.sections = st.sections.filter(x => !ids.has(x.id)); for (const sec of secs) for (const m of [st.prices, st.areas, st.labels]) Object.keys(m || {}).forEach(k => { if (k.startsWith(sec.code + '-')) delete m[k]; });
    S.ui.smSel = ''; S.ui.smMulti = []; dirty(); render(); },
  smClearPrices: () => { const st = S.draft.seating, sec = st.sections.find(x => x.id === S.ui.smSel); Object.keys(st.prices || {}).forEach(k => { if (k.startsWith(sec.code + '-')) delete st.prices[k]; }); dirty(); render(); },
  smDeselect: () => { S.ui.smSel = ''; S.ui.smMulti = []; render(); },
  smSel: el => { S.ui.smSel = el.dataset.id; S.ui.smMulti = [el.dataset.id]; S.ui.smMode = 'move'; render(); },
  smEqualRows: () => { const sec = S.draft.seating.sections.find(x => x.id === S.ui.smSel); delete sec.rowSeats; dirty(); render(); },
  smStraighten: () => { S.draft.seating.sections.filter(x => smMulti().has(x.id)).forEach(x => { x.curve = 0; x.rot = 0; }); dirty(); render(); },
  smEven: () => { S.draft.seating.sections.filter(x => smMulti().has(x.id)).forEach(x => { delete x.gap; delete x.rowGap; }); dirty(); render(); },
  smLevel: el => { S.ui.smLevel = el.dataset.v; S.ui.smSel = ''; S.ui.smMulti = []; render(); },
  smAddLevel: () => { const st = S.draft.seating; if (!st.levels?.length) st.levels = [{ id: 'L1', name: 'Main floor' }];
    let n = st.levels.length + 1; while (st.levels.some(l => l.id === 'L' + n)) n++; st.levels.push({ id: 'L' + n, name: 'Level ' + n }); S.ui.smLevel = 'L' + n; dirty(); render(); },
  smDelLevel: el => { const st = S.draft.seating, l = st.levels[+el.dataset.i], lv0 = st.levels[0].id;
    if (st.sections.some(x => (x.level || lv0) === l.id)) return toast('Move or delete the sections on ' + l.name + ' first', true);
    st.sections.forEach(x => { x.level ||= lv0; }); st.levels.splice(+el.dataset.i, 1); if (st.levels.length < 2) { delete st.levels; st.sections.forEach(x => delete x.level); } dirty(); render(); },
  smBgRemove: () => { delete S.draft.seating.bg; dirty(); render(); },
  rowsOpen: el => { setTimeout(() => { S.ui.rowsOpen = el.open; }); },
  rowDup: el => rowEdit('dup', +el.dataset.i),
  rowDel: el => rowEdit('del', +el.dataset.i),
  rowCopy: el => { const sec = S.draft.seating.sections.find(x => x.id === S.ui.smSel); S.ui.rowClip = +(sec.rowSeats || [])[+el.dataset.i] || +sec.seatsPerRow || 10; S.ui.rowsOpen = true; toast('Row copied — open any section and paste it'); render(); },
  rowPaste: () => rowEdit('paste'),
  mpApply: () => { const secs = S.draft.seating.sections.filter(x => smMulti().has(x.id)), u = S.ui;
    secs.forEach(x => { if (u.mpTT) x.ticketTypeId = u.mpTT === 'none' ? '' : u.mpTT; if (u.mpArea?.trim()) x.area = u.mpArea.trim(); if (u.mpLevel) x.level = u.mpLevel; });
    u.mpTT = u.mpArea = u.mpLevel = ''; dirty(); render(); toast('Applied to ' + secs.length + ' sections'); },
  smSeatsClear: () => { S.ui.smSeats = []; render(); },
  seatsRemove: () => { const st = S.draft.seating, sold = new Set(soldSeatIds(S.draft)), ids = (S.ui.smSeats || []).filter(id => layoutOf(st).byId.get(id));
    if (ids.some(id => sold.has(id))) return toast('Some of these seats are sold — move those customers first', true);
    st.removed = [...new Set([...(st.removed || []), ...ids])]; S.ui.smSeats = []; dirty(); render(); },
  seatsRestore: () => { const st = S.draft.seating, sel = new Set(S.ui.smSeats || []); st.removed = (st.removed || []).filter(id => !sel.has(id)); S.ui.smSeats = []; dirty(); render(); },
  seatsArea: () => seatMapEdit('areas', (S.ui.spArea || '').trim(), p => p.sec.area || p.sec.name),
  seatsPrice: () => seatMapEdit('prices', S.ui.spTT || '', p => p.sec.ticketTypeId),
  seatsLabel: () => seatMapEdit('labels', (S.ui.spLabel || '').trim().slice(0, 8), p => String(p.num)),
  smPreview: () => { const ev = { ...S.draft, seating: { ...S.draft.seating, ...seatDerive(S.draft.seating) } }, saved = S.adm.events.find(e => e.id === ev.id);
    const slot = (ev.timeSlots || [])[0]?.id || '', av = saved ? availabilityFrom(S.adm.tickets, ev.id, S.adm.seatStatus) : { seats: [], off: [] };
    S.ui.pvOpen = true; modal('Customer preview', `<p class="small muted" style="margin-bottom:10px">Exactly what buyers see${slot ? ' for the first showtime' : ''}, including unsaved changes. Seats can't be picked here.</p>${BuyerSeatMap(ev, av, { slotId: slot, seats: [] }, true)}`); },
  loadVenue: el => { const v = (S.adm.bo.venues || []).find(x => x.id === (el.dataset.v || S.ui.venPick || S.adm.bo.venues[0]?.id)); if (!v) return;
    if (S.draft.seating?.sections?.length && !confirmIn(`Replace this event's seating chart with “${v.name}”? Price tiers are matched to ticket types by name (missing ones are added).`)) return;
    const r = venueToEvent(v, S.draft); S.draft.ticketTypes = r.ticketTypes; S.draft.seating = r.seating; if (!S.draft.venue || S.draft.venue === 'TBA') { S.draft.venue = v.name; S.draft.address ||= v.address; }
    S.ui.smSel = ''; S.ui.smMulti = []; dirty(); render(); toast('Loaded “' + v.name + '” — save to keep it'); },
  saveToVenue: async () => {
    const list = JSON.parse(JSON.stringify(S.adm.bo.venues || [])), cur = list.find(v => v.id === S.draft.seating.venueId); let v;
    if (cur && confirmIn(`Update the master chart “${cur.name}” with this layout? Events that already use it keep their own copy.`)) v = { ...eventToVenue(S.draft, cur.name, cur.id), address: cur.address };
    else { const name = window.prompt('Name for this venue chart', S.draft.venue || 'My venue'); if (!name?.trim()) return; v = eventToVenue(S.draft, name.trim()); }
    const i = list.findIndex(x => x.id === v.id); if (i >= 0) list[i] = v; else list.push(v);
    try { await DB.saveVenues(list); S.adm.bo.venues = list; S.draft.seating.venueId = v.id; S.draft.seating.venueName = v.name; dirty(); toast('Saved to venue library as “' + v.name + '”'); render(); } catch (e) { toast(e.message, true); }
  },
  addQ: el => { const o = el.dataset.v === 'set' ? S.ui.set : S.draft; (o.questions ||= []).push({ id: shortId('q_'), label: 'New question', type: 'text', options: '', required: false, scope: el.dataset.v === 'set' ? 'order' : 'event' }); if (o === S.draft) dirty(); render(); },
  delQ: el => { const o = el.dataset.v === 'set' ? S.ui.set : S.draft; o.questions.splice(+el.dataset.i, 1); if (o === S.draft) dirty(); render(); },
  pgSection: el => { const pg = S.draft.page ||= {}; (pg.hide ||= {})[el.dataset.v] = !el.checked; dirty(); render(); },
  pgAdd: el => { const pg = S.draft.page ||= {}; (pg[el.dataset.v] ||= []).push(el.dataset.v === 'blocks' ? { id: shortId('blk_'), title: '', text: '' } : { name: '', logo: '', url: '' }); dirty(); render(); },
  pgDel: el => { S.draft.page[el.dataset.v].splice(+el.dataset.i, 1); dirty(); render(); },
  pgColorsReset: () => { delete S.draft.page.accent; delete S.draft.page.ink; dirty(); render(); },
  gwConnect: async el => {
    try { const r = await DB.connectGateway(el.dataset.v, true); if (r?.url) { location.href = r.url; return; } await reloadAdmin(); await refreshPublic(); toast('Payment processor connected'); render(); } catch (e) { toast(e.message, true); }
  },
  gwDisconnect: async () => { if (!confirm('Disconnect the payment processor? Card checkout stops until you connect one again.')) return; try { await DB.disconnectGateway(); await reloadAdmin(); await refreshPublic(); toast('Disconnected'); render(); } catch (e) { toast(e.message, true); } },
  boFee: el => PlatformFeeModal(el.dataset.id),
  saveBoFee: async el => { const f = S.ui.bf; try { await DB.setPlatformFee(el.dataset.id, f.useDefault ? null : { pct: f.pct === '' ? '' : +f.pct, fixed: f.fixed === '' ? '' : Math.round(+f.fixed * 100), payer: f.payer || '' }); closeModal(); S.plat = null; toast('Platform fee saved'); render(); } catch (e) { toast(e.message, true); } },
  addAddon: () => { (S.draft.addons ||= []).push({ id: shortId('ad_'), name: 'New product', price: 1000, qty: 0, max: 0, desc: '', category: 'Other', salesStart: '', salesEnd: '', ticketTypeIds: [], areas: [], standalone: false }); dirty(); render(); },
  delAddon: el => { const a = S.draft.addons[+el.dataset.i]; if (S.adm.orders.some(o => ['paid', 'pending'].includes(o.status) && o.data.lines.some(l => l.addonId === a.id || (l.addons || []).some(x => x.addonId === a.id)))) return toast('This product has been sold — hide it instead', true);
    if ((S.draft.bundles || []).some(b => (b.addons || []).some(x => x.addonId === a.id))) return toast('A package includes this product — remove it from the package first', true);
    S.draft.addons.splice(+el.dataset.i, 1); S.draft.upsells = (S.draft.upsells || []).filter(u => u.addonId !== a.id); dirty(); render(); },
  addBundle: () => { (S.draft.bundles ||= []).push({ id: shortId('bd_'), name: 'New package', desc: '', price: 0, qty: 0, max: 4, parts: [{ ticketTypeIds: [S.draft.ticketTypes[0]?.id].filter(Boolean), qty: 1 }], addons: [] }); dirty(); render(); },
  delBundle: el => { const b = S.draft.bundles[+el.dataset.i]; if (S.adm.orders.some(o => o.data.lines.some(l => l.bundleId === b.id))) return toast('This package has been sold — hide it instead', true); S.draft.bundles.splice(+el.dataset.i, 1); dirty(); render(); },
  addUpsellRule: () => { (S.draft.upsells ||= []).push({ id: shortId('up_'), addonId: S.draft.addons?.[0]?.id || '', text: '', ticketTypeIds: [], areas: [], prices: [], minQty: 1, perTicket: false }); dirty(); render(); },
  delUpsellRule: el => { S.draft.upsells.splice(+el.dataset.i, 1); dirty(); render(); },
  // generic list rows inside the draft: price phases, quantity breaks, package parts / products
  addRule: el => { const path = el.dataset.path, list = getPath(S.draft, path) || []; setPath(S.draft, path, list);
    list.push(path.endsWith('phases') ? { id: shortId('ph_'), label: list.length ? 'Phase ' + (list.length + 1) : 'Early bird', price: getPath(S.draft, path.replace(/\.phases$/, '.price')) || 0, from: '', until: '', upTo: 0 }
      : path.endsWith('breaks') ? { min: 4, price: getPath(S.draft, path.replace(/\.breaks$/, '.price')) || 0 } : path.endsWith('peak') ? { label: 'Peak', days: [5, 6], from: '18:00', to: '23:59', price: getPath(S.draft, path.replace(/\.peak$/, '.price')) || 0 } : path.endsWith('parts') ? { ticketTypeIds: [], qty: 1 } : { addonId: S.draft.addons?.[0]?.id || '', qty: 1 });
    if (el.dataset.id) S.ui.rulesOpen = el.dataset.id; dirty(); render(); },
  delRule: el => { getPath(S.draft, el.dataset.path).splice(+el.dataset.i, 1); dirty(); render(); },
  togList: el => { const path = el.dataset.path, v = el.dataset.num ? +el.dataset.v : el.dataset.v, list = (getPath(S.draft, path) || []).filter(x => String(x) !== String(v));
    if (el.checked) list.push(v); setPath(S.draft, path, list); dirty(); if (S.draft._kind || /^(scope|eventIds)$/.test(path)) render(); },
  newPromo: el => { S.ui.promoEv = el?.dataset?.ev || null; S.draft = null; location.hash = '#/admin/promos/code/new-' + randCode(4).toLowerCase(); },
  newTracking: () => { S.draft = null; location.hash = '#/admin/promos/ref/new-' + randCode(4).toLowerCase(); },
  savePromo: async () => { const { _kind, _pid, ...p } = S.draft;
    try { const saved = await DB.savePromo(p); upsertLocal(S.adm.promos ||= [], saved); S.dirty = false; toast('Code saved'); S.draft = null; location.hash = '#/admin/promos/code/' + saved.id; if (_pid === saved.id) onRoute(); } catch (e) { toast(e.message, true); } },
  delPromo: async () => { if (!confirm('Delete code ' + S.draft.code + '?')) return; try { await DB.deletePromo(S.draft.id); S.adm.promos = S.adm.promos.filter(x => x.id !== S.draft.id); S.draft = null; location.hash = '#/admin/promos'; toast('Code deleted'); } catch (e) { toast(e.message, true); } },
  saveTracking: async () => { const { _kind, _pid, ...t } = S.draft;
    try { const saved = await DB.saveTracking(t); upsertLocal(S.adm.tracking ||= [], saved); S.dirty = false; toast('Tracking code saved'); S.draft = null; location.hash = '#/admin/promos/ref/' + saved.id; if (_pid === saved.id) onRoute(); } catch (e) { toast(e.message, true); } },
  delTracking: async () => { if (!confirm('Delete tracking code ' + S.draft.code + '?')) return; try { await DB.deleteTracking(S.draft.id); S.adm.tracking = S.adm.tracking.filter(x => x.id !== S.draft.id); S.draft = null; location.hash = '#/admin/promos/tracking'; toast('Tracking code deleted'); } catch (e) { toast(e.message, true); } },
  genCodes: () => { const n = Math.max(1, Math.min(5000, +(S.ui.genN || 25))), pre = String(S.ui.genPre ?? S.draft.code ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20), have = new Set(S.draft.codes ||= []);
    for (let i = 0; i < n; i++) { let c; do { c = (pre ? pre + '-' : '') + randCode(6); } while (have.has(c)); have.add(c); S.draft.codes.push(c); } dirty(); render(); toast(n + ' codes generated — save to activate'); },
  exportCodes: () => download((S.draft.code || 'promo') + '-codes.csv', csv([['Code', 'Used'], ...S.draft.codes.map(c => [c, S.adm.orders.some(o => o.data.promo?.id === S.draft.id && String(o.data.code).toUpperCase() === c) ? 'yes' : ''])])),
  clearCodes: () => { const used = new Set(S.adm.orders.filter(o => o.data.promo?.id === S.draft.id).map(o => String(o.data.code).toUpperCase())); S.draft.codes = (S.draft.codes || []).filter(c => used.has(c)); dirty(); render(); },
  addRem: () => { (S.draft.emails.reminders ||= []).push({ hoursBefore: S.settings.reminderHours || 24, channel: 'email', body: 'See you soon! Doors open at ' + (S.draft.doors || 'the listed time') + '.' }); dirty(); render(); },
  delRem: el => { S.draft.emails.reminders.splice(+el.dataset.i, 1); dirty(); render(); },
  broadcast: async () => { const b = S.ui.bc;
    try { const r = await DB.sendCampaign({ category: 'transactional', channel: b.channel || 'email', subject: b.subject, body: b.body, filter: { eventIds: [S.draft.id] }, sendAt: b.sendAt ? new Date(b.sendAt).toISOString() : null, name: b.subject || b.body.slice(0, 60) });
      await reloadAdmin(); S.ui.bc = null; toast(`${r.status === 'scheduled' ? 'Scheduled' : 'Sent'} to ${r.queued} ticket holder${r.queued === 1 ? '' : 's'}`); render(); } catch (e) { toast(e.message, true); } },
  exportWL: el => { download('waitlist.csv', csv([['Name', 'Email', 'Phone', 'Joined', 'Notified'], ...S.adm.waitlist.filter(w => w.event_id === el.dataset.id).map(w => [w.name, w.email, w.phone || '', w.created_at, w.notified_at || ''])])); DB.log('export.waitlist', 'Exported the waitlist'); },
  openOrder: el => { location.hash = '#/admin/orders/' + el.dataset.id; },
  oSel: el => { S.ui.osel[el.dataset.id] = el.checked; render(); },
  oSelAll: el => { const o = S.adm.orders.find(x => x.id === S.ui.oid); S.ui.osel = {}; if (el.checked) S.adm.tickets.filter(t => t.order_id === o.id && t.status === 'valid').forEach(t => { S.ui.osel[t.id] = true; }); render(); },
  oAll: el => { S.ui.oAll = el.checked; render(); },
  opOpen: el => {
    const o = S.adm.orders.find(x => x.id === S.ui.oid); if (!o) return;
    const live = S.adm.tickets.filter(t => t.order_id === o.id && t.status === 'valid'), sel = live.filter(t => S.ui.osel[t.id]).map(t => t.id), k = el.dataset.v, all = el.dataset.all === '1';
    const fut = futureEvents(), m = orderMoney(o), base = { kind: k, notify: true, note: '', _ev: (fut.find(e => o.event_ids.includes(e.id)) || fut[0])?.id };
    S.ui.op = k === 'change' ? { ...base, tickets: all || !sel.length ? live.map(t => t.id) : sel, map: {}, settle: 'collect', method: 'cash', downgrade: 'refund', to: 'original' }
      : k === 'reissue' ? { ...base, tickets: all || !sel.length ? live.map(t => t.id) : sel }
      : k === 'cancel' ? { ...base, all: all || sel.length === live.length, tickets: all ? live.map(t => t.id) : sel, seat: 'release', refundMode: can('orders.refund', o.event_ids[0]) && wasPaid(o) ? 'tickets' : 'none', to: 'original' }
      : k === 'refund' ? { ...base, mode: sel.length ? 'tickets' : 'full', to: 'original', cancel: false, seat: 'release' }
      : k === 'holder' ? { ...base, ticket: el.dataset.id, name: live.find(t => t.id === el.dataset.id)?.holder || '' }
      : k === 'customer' ? { ...base, name: o.data.buyer.name, email: o.buyer_email, phone: o.data.buyer.phone || '' }
      : k === 'removeAddon' ? { ...base, line: +el.dataset.id, refund: '' }
      : k === 'addAddon' ? { ...base, eventId: o.event_ids[0], qty: 1, settle: 'collect', method: 'cash' }
      : k === 'collect' ? { ...base, amount: m.due ? (m.due / 100).toFixed(2) : '', method: 'cash' }
      : k === 'markPaid' ? { ...base, method: o.payment?.method && PAY_METHODS[o.payment.method] ? o.payment.method : 'cash', date: localDay(new Date().toISOString()), ref: o.payment?.ref || '', notes: o.payment?.notes || '' }
      : k === 'installment' ? { ...base, method: 'cash' } : k === 'cancelUnpaid' ? { ...base, keep: 'credit' } : { ...base };
    render(); window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  opClose: () => { S.ui.op = null; render(); },
  opCur: el => { S.ui.op.cur = el.dataset.id; render(); },
  opLevel: el => { S.ui.op.level = el.dataset.v; render(); },
  opGo: async el => {
    const o = S.adm.orders.find(x => x.id === S.ui.oid); if (!o) return;
    const k = el.dataset.v, p = k === 'note' ? { body: S.ui.onote } : k === 'resend' ? { kind: el.dataset.k || 'tickets' } : opPayload(o);
    if (k === 'change' && !S.ui.op?._ready) return toast('Choose what each ticket changes to', true);
    el.disabled = true;
    try { const r = await DB.orderAction(o.id, k, p); S.ui.op = null; S.ui.osel = {}; if (k === 'note') S.ui.onote = ''; await reloadAdmin();
      toast(OP_DONE[k] + (r?.refund?.status === 'processing' ? ' — the card refund is processing' : '')); render(); } catch (e) { el.disabled = false; toast(e.message, true); }
  },
  creditIssue: async () => { const c = S.ui.cust; try { const r = await DB.creditAction('issue', { email: c.email, name: customerIndex().find(x => x.email === c.email)?.name, amount: opDollars(c.amount), eventId: c.eventId || null, expires: c.expires ? new Date(c.expires + 'T23:59').toISOString() : null, note: c.note });
    S.ui.cust = null; await reloadAdmin(); toast('Credit ' + r.code + ' issued'); render(); } catch (e) { toast(e.message, true); } },
  creditRevoke: async el => { if (!confirmIn('Revoke what is left of this credit? It can\'t be used after this.')) return; try { await DB.creditAction('revoke', { id: el.dataset.id }); await reloadAdmin(); toast('Credit revoked'); render(); } catch (e) { toast(e.message, true); } },
  creditApply: async el => { const c = (S.adm.credits || []).find(x => x.id === el.dataset.id), o = S.adm.orders.filter(x => x.buyer_email === c?.email && x.data.due > 0 && (!c.event_id || x.event_ids.includes(c.event_id)))[0];
    if (!o) return toast('No order with a balance due that this credit can pay', true);
    try { await DB.creditAction('apply', { id: c.id, order: o.id }); await reloadAdmin(); toast('Credit applied to ' + o.ref); render(); } catch (e) { toast(e.message, true); } },
  custNote: async el => { try { await DB.customerNote(el.dataset.v, S.ui.cnote); S.ui.cnote = ''; await reloadAdmin(); toast('Note added'); render(); } catch (e) { toast(e.message, true); } },
  exportCustomers: () => { download('customers.csv', csv([['Name', 'Email', 'Phone', 'Orders', 'Tickets', 'Spent', 'Refunds', 'Credit', 'Account', 'Last order', 'Email marketing', 'Email opt-in date', 'Text marketing', 'Unsubscribed', 'Suppressed', 'Tags'], ...customerIndex().map(c => { const k = contactFor(c.email);
      return [c.name, c.email, c.phone, c.orders.length, c.tickets.filter(t => t.status === 'valid').length, c.spent / 100, c.refunds / 100, c.credit / 100, c.account ? 'yes' : '', c.last,
        k?.email_optin && !k.unsub_email_at && !k.suppressed ? 'yes' : 'no', k?.email_optin_at || '', k?.sms_optin && !k.unsub_sms_at ? 'yes' : 'no', k?.unsub_email_at || '', k?.suppressed || '', (k?.tags || []).join('; ')]; })])); DB.log('export.customers', 'Exported the customer list'); },
  emailPv: el => { const o = S.adm.orders.find(x => x.id === el.dataset.id); modal('Confirmation email · ' + esc(o.ref), `<p class="small muted" style="margin-bottom:12px">One email per order — every ticket together, with a link to view and download them. This is exactly what the sender delivers.</p>${OrderEmail(o)}`); },
  pick: el => { S.ui.picked[el.dataset.id] = el.checked; render(); },
  orderStatus: async el => { if (['cancelled', 'refunded'].includes(el.dataset.v) && !confirmIn('Cancel this order and void its tickets?' + (el.dataset.v === 'refunded' ? ' Everything left is refunded to the original payment.' : ''))) return;
    try { await DB.setOrderStatus(el.dataset.id, el.dataset.v); await reloadAdmin(); toast('Order ' + el.dataset.v); OrderModal(el.dataset.id); render(); } catch (e) { toast(e.message, true); } },
  bulkCancel: async () => { const ids = Object.keys(S.ui.picked).filter(k => S.ui.picked[k]); if (!confirmIn(`Cancel ${ids.length} orders and void their tickets?`)) return;
    for (const id of ids) { const o = S.adm.orders.find(x => x.id === id); if (o && ['paid', 'pending'].includes(o.status)) await DB.setOrderStatus(id, o.status === 'paid' ? 'refunded' : 'cancelled'); }
    S.ui.picked = {}; await reloadAdmin(); toast(ids.length + ' orders cancelled'); render(); },
  manualOrder: () => { S.ui.mo = null; location.hash = '#/admin/orders/new'; },
  moLevel: el => { S.ui.mo.level = el.dataset.v; render(); },
  saveManual: async () => {
    const m = S.ui.mo, ev = evById(m.ev), { items, addons } = S.ui.moItems || {}; if (!ev) return;
    if (!items?.length && !addons?.length) return toast(ev.seating?.enabled ? 'Pick seats on the map' : 'Choose tickets', true);
    if (items.some(i => i.price !== undefined && !(i.price >= 0))) return toast('Enter a valid price', true);
    try { const r = await DB.placeOrder({ buyer: { name: m.name, email: m.email, phone: m.phone || '' }, items, addons, payment: 'manual', comp: !!m.comp, code: m.comp ? '' : m.code, creditId: m.comp ? '' : m.credit || '',
        payMethod: m.pay, payRef: m.ref, send: m.send !== false, source: 'box office', unpaid: !!m.unpaid, payDate: m.date || '', payNotes: m.notes || '' }, true);
      S.ui.mo = null; await reloadAdmin(); toast('Order created'); location.hash = '#/admin/orders/' + r.id; } catch (e) { toast(e.message, true); }
  },
  exportOrders: () => download('orders.csv', csv([['Order', 'Placed', 'Status', 'Name', 'Email', 'Phone', 'Events', 'Tickets & packages', 'Products', 'Face value', 'Subtotal', 'Discount', 'Fee discount', 'Code', 'Tracking code', 'Fees', 'Tax', 'Donation', 'Total', 'Payment', 'Source', 'Marketing opt-in'],
    ...filteredOrders().map(o => { const d = o.data, m = v => v == null ? '' : v / 100; return [o.ref, o.created_at, o.status, d.buyer.name, o.buyer_email, d.buyer.phone, [...new Set(d.lines.map(l => l.eventName))].join('; '), d.lines.filter(l => l.kind !== 'addon').map(l => l.qty + 'x ' + l.name).join('; '),
      d.lines.filter(l => l.kind === 'addon').map(l => l.qty + 'x ' + l.name).join('; '), m(d.faceValue), m(d.subtotal), m(d.discount), m(d.feeDiscount || 0), d.code || '', d.tracking || '', m(d.fee), m(d.tax), m(d.donation), m(d.total), d.payment, d.source || '', d.optIn ? 'yes' : 'no']; })])),
  exportAtt: () => { const ev = evById(S.ui.attEv); download(slugify(ev?.name || 'attendees') + '-door-list.csv', csv([['Name', 'Email', 'Ticket type', 'Area', 'Table / box', 'Row', 'Seat', 'Time slot', 'Code', 'Order', 'Checked in', 'Entrance'],
    ...S.adm.tickets.filter(t => t.event_id === S.ui.attEv && t.status === 'valid').map(t => { const o = S.adm.orders.find(x => x.id === t.order_id); const sp = t.seat ? seatParts(ev, t.seat, t) : {}; return [t.holder, o?.buyer_email, ev.ticketTypes.find(x => x.id === t.ticket_type_id)?.name, sp.area || '', sp.unit || '', sp.row || '', sp.seat || '', t.slot_id ? fmtDT(ev.timeSlots.find(s => s.id === t.slot_id)?.start) : '', t.code, o?.ref, t.checked_in_at || '', t.checkin?.entrance || '']; })])); },
  // one row per ticket: original type, face value, collected, discount + code, comp, tracking code, products, package, price override
  exportTickets: () => { S.ui.rep = { ...emptyFin(), eventId: S.ui.repEv || '' }; download('ticket-detail.csv', csv(xpRows('tickets', finRep()))); },
  exportReport: () => download('sales-report.csv', csv([['Event', 'Date', 'Tickets sold', 'Ticket revenue'], ...S.adm.events.map(e => { const s = evStats(e); return [e.name, e.start, s.sold, s.rev / 100]; })])),
  // ── Stage 8: marketing, messages, automations, integrations ──
  pxYes: () => { try { localStorage.setItem('set_px', 'yes'); } catch (e) { } $('#pxBanner')?.remove(); loadPixels(); },
  pxNo: () => { try { localStorage.setItem('set_px', 'no'); } catch (e) { } $('#pxBanner')?.remove(); },
  runSender: async () => { try { const r = await DB.runSender(); await reloadAdmin(); toast(`Sender ran: ${r.sent} message${r.sent === 1 ? '' : 's'} processed${r.queued ? ` · ${r.queued} automation step${r.queued === 1 ? '' : 's'} queued` : ''}`); render(); } catch (e) { toast(e.message, true); } },
  segTog: el => { const f = S.ui[el.dataset.p].filter, k = el.dataset.k, v = el.dataset.v; f[k] = f[k].includes(v) ? f[k].filter(x => x !== v) : [...f[k], v];
    if (k === 'eventIds') { f.ticketTypeIds = []; f.areas = []; } if (el.dataset.p === 'cmp') S.ui.cmp.segId = ''; render(); },
  cmpSend: async () => { const c = S.ui.cmp;
    try { const r = await DB.sendCampaign({ ...c, sendAt: c.sendAt ? new Date(c.sendAt).toISOString() : null }); await reloadAdmin(); S.ui.cmp = newCampaign({ category: c.category, channel: c.channel });
      const held = Object.values(r.skipped || {}).reduce((a, x) => a + x, 0); toast(`${r.status === 'scheduled' ? 'Scheduled' : 'Sent'} — ${r.queued} message${r.queued === 1 ? '' : 's'}${held ? ` · ${held} held back (no consent / no number)` : ''}`); render(); } catch (e) { toast(e.message, true); } },
  cmpPreview: () => { const c = S.ui.cmp, p = admPeople(c.category === 'transactional' ? { ...c.filter, status: 'buyers' } : c.filter)[0];
    modal('Preview', (c.channel === 'sms' ? [] : ['email']).concat(c.channel === 'email' ? [] : ['sms']).map(ch => msgPreview({ kind: c.category === 'marketing' ? 'campaign' : 'update', channel: ch, category: c.category, subject: c.subject, body: c.body, email: p?.email || '', event_id: c.filter.eventIds[0] || null })).join('<div class="sep"></div>')); },
  cmpCancel: async el => { try { await DB.campaignAction(el.dataset.id, 'cancel'); await reloadAdmin(); toast('Scheduled campaign cancelled'); render(); } catch (e) { toast(e.message, true); } },
  segLoad: el => { const sg = (S.adm.bo.segments || []).find(x => x.id === el.dataset.id); if (sg) { S.ui.aud = { filter: { ...emptySeg(), ...clone(sg.filter) }, name: sg.name, id: sg.id }; render(); } },
  segSave: async () => { const a = S.ui.aud, name = String(a.name || '').trim(); if (!name) return toast('Name the segment', true);
    const list = (S.adm.bo.segments || []).filter(x => x.name !== name).concat({ id: a.id && (S.adm.bo.segments || []).some(x => x.id === a.id && x.name === name) ? a.id : 'sg_' + Math.random().toString(36).slice(2, 8), name, filter: clone(a.filter) });
    try { S.adm.bo.segments = await DB.saveSegments(list); toast('Segment saved'); render(); } catch (e) { toast(e.message, true); } },
  segDel: async el => { try { S.adm.bo.segments = await DB.saveSegments((S.adm.bo.segments || []).filter(x => x.id !== el.dataset.id)); render(); } catch (e) { toast(e.message, true); } },
  segCampaign: () => { S.ui.cmp = newCampaign({ filter: clone(S.ui.aud.filter), segId: S.ui.aud.id || '' }); location.hash = '#/admin/marketing/campaigns'; },
  audExport: () => { const people = admPeople(S.ui.aud.filter), c = x => x || '';
    download('audience.csv', csv([['Email', 'Name', 'Phone', 'Email marketing', 'Email opt-in date', 'Email opt-in source', 'Text marketing', 'Text opt-in date', 'Unsubscribed', 'Suppressed', 'Tags', 'Orders', 'Spent'],
      ...people.map(p => { const k = p.contact; return [p.email, p.name, p.phone, k?.email_optin && !k.unsub_email_at && !k.suppressed ? 'yes' : 'no', c(k?.email_optin_at), c(k?.email_optin_src), k?.sms_optin && !k.unsub_sms_at ? 'yes' : 'no', c(k?.sms_optin_at),
        c(k?.unsub_email_at), c(k?.suppressed), (k?.tags || []).join('; '), p.orders.length, (p.spent / 100).toFixed(2)]; })])); },
  supAdd: async () => { try { await DB.contactAction(String(S.ui.supEmail || '').trim(), 'suppress', { reason: 'manual' }); S.ui.supEmail = ''; await reloadAdmin(); toast('Address suppressed'); render(); } catch (e) { toast(e.message, true); } },
  ctAct: async el => { const v = el.dataset.v; try { await DB.contactAction(el.dataset.email, v, { source: S.ui.cc?.source || '', reason: v === 'suppress' ? 'manual' : '' }); if (S.ui.cc) S.ui.cc.source = ''; await reloadAdmin(); toast('Saved'); render(); } catch (e) { toast(e.message, true); } },
  ctTag: async el => { const t = String(S.ui.cc?.tag || '').trim(); if (!t) return toast('Type a tag', true); try { await DB.contactAction(el.dataset.email, 'tag', { tags: t }); S.ui.cc.tag = ''; await reloadAdmin(); render(); } catch (e) { toast(e.message, true); } },
  ctUntag: async el => { try { await DB.contactAction(el.dataset.email, 'untag', { tags: el.dataset.v }); await reloadAdmin(); render(); } catch (e) { toast(e.message, true); } },
  auNew: () => { S.ui.au = newAuto(); render(); },
  auEdit: el => { const a = (S.adm.automations || []).find(x => x.id === el.dataset.id); if (!a) return; S.ui.au = { ...newAuto(), ...clone(a), cond: { ...newAuto().cond, ...clone(a.cond || {}) }, timing: { mode: 'now', hours: 0, ...clone(a.timing || {}) } }; render(); },
  auCancel: () => { S.ui.au = null; location.hash = '#/admin/marketing/automations'; render(); },
  auTog: el => { const c = S.ui.au.cond, k = el.dataset.k, v = el.dataset.num ? +el.dataset.v : el.dataset.v; c[k] = c[k].includes(v) ? c[k].filter(x => x !== v) : [...c[k], v]; if (k === 'eventIds') { c.ticketTypeIds = []; c.areas = []; } render(); },
  auActAdd: el => { const t = el.dataset.v; S.ui.au.actions.push({ type: t, ...(t === 'email' ? { category: 'transactional', subject: '', body: '' } : t === 'sms' ? { category: 'transactional', body: '' } : t === 'staff' ? { to: S.user.email, subject: '', body: '' } : {}) }); render(); },
  auActDel: el => { S.ui.au.actions.splice(+el.dataset.i, 1); render(); },
  auSave: async () => { try { await DB.saveAutomation(S.ui.au); S.ui.au = null; await reloadAdmin(); toast('Automation saved'); render(); } catch (e) { toast(e.message, true); } },
  auDel: async el => { try { await DB.deleteAutomation(el.dataset.id); await reloadAdmin(); toast('Automation deleted'); render(); } catch (e) { toast(e.message, true); } },
  auToggle: async el => { const a = (S.adm.automations || []).find(x => x.id === el.dataset.id); try { await DB.saveAutomation({ ...a, enabled: el.checked }); await reloadAdmin(); render(); } catch (e) { toast(e.message, true); render(); } },
  mqGo: () => render(),
  utmBuild: () => render(),
  msgOpen: el => { const m = (S.adm.outbox || []).find(x => x.id === el.dataset.id); if (!m) return;
    modal(esc(kindLabel(m)), `<div class="small muted" style="margin-bottom:10px">To <b>${esc(m.to)}</b> · ${msgChip(m)} · ${esc(m.category || 'transactional')}${m.sent_at ? ' · sent ' + esc(fmtDT(m.sent_at)) : ' · ' + esc(fmtDT(m.send_at || m.at))}${m.provider ? ' · via ' + esc(m.provider) : ''}${m.error ? `<br>${esc(m.error)}` : ''}</div>${msgPreview(m)}`); },
  msgCancel: async el => { try { await DB.outboxAction(el.dataset.id, 'cancel'); await reloadAdmin(); render(); } catch (e) { toast(e.message, true); } },
  msgRetry: async el => { try { await DB.outboxAction(el.dataset.id, 'retry'); await reloadAdmin(); toast('Queued again'); render(); } catch (e) { toast(e.message, true); } },
  igNew: el => { const k = el.dataset.v; S.ui.ig = { kind: k, name: INTEGRATIONS[k].name, active: true, config: k === 'webhook' ? { url: '', events: ['payment.completed'] } : { who: 'optedIn' }, secret: '' }; render(); },
  igEdit: el => { const g = (S.adm.integrations || []).find(x => x.id === el.dataset.id); if (g) { S.ui.ig = { ...clone(g), secret: '' }; render(); } },
  igCancel: () => { S.ui.ig = null; render(); },
  igEv: el => { const c = S.ui.ig.config, v = el.dataset.v; c.events = (c.events || []).includes(v) ? c.events.filter(x => x !== v) : [...(c.events || []), v]; render(); },
  igSave: async () => { const f = S.ui.ig;
    try { const r = await DB.saveIntegration(f, f.secret || null); S.ui.ig = null; await reloadAdmin(); render();
      if (r.secret) modal('Webhook signing secret', `<p class="small">Copy it now — it is not shown again. Use it to check the <code>SET-Signature</code> header on every delivery.</p><pre class="code">${esc(r.secret)}</pre>`); else toast('Saved'); } catch (e) { toast(e.message, true); } },
  igDel: async el => { try { await DB.deleteIntegration(el.dataset.id); await reloadAdmin(); toast('Disconnected'); render(); } catch (e) { toast(e.message, true); } },
  igTest: async el => { try { const d = await DB.testIntegration(el.dataset.id); await reloadAdmin(); toast(DB.live ? 'Test delivery queued' : 'Test recorded (demo mode — nothing is posted)'); render(); } catch (e) { toast(e.message, true); } },
  dlOpen: el => { const d = (S.adm.deliveries || []).find(x => x.id === el.dataset.id); if (d) modal(esc(HOOK_EVENTS[d.event] || d.event), `<div class="small muted" style="margin-bottom:8px">${esc(d.status)} · attempt ${d.attempts} · ${esc(d.response || '')}</div><pre class="code">${esc(JSON.stringify(d.payload, null, 2))}</pre>`); },
  keyScope: el => { const k = S.ui.key ||= { name: '', scopes: ['events:read'] }, v = el.dataset.v; k.scopes ||= ['events:read']; k.scopes = k.scopes.includes(v) ? k.scopes.filter(x => x !== v) : [...k.scopes, v]; render(); },
  keyCreate: async () => { const k = S.ui.key ||= { name: '', scopes: ['events:read'] };
    try { const r = await DB.createApiKey(k.name, k.scopes || ['events:read']); S.ui.key = null; await reloadAdmin(); render();
      modal('Your new API key', `<p class="small">Copy it now — it is shown only once.</p><pre class="code">${esc(r.key)}</pre><p class="small muted">Example:</p><pre class="code">curl -H "Authorization: Bearer ${esc(r.key)}" \\\n  https://&lt;project&gt;.supabase.co/functions/v1/api/v1/events</pre>`); } catch (e) { toast(e.message, true); } },
  keyRevoke: async el => { try { await DB.revokeApiKey(el.dataset.id); await reloadAdmin(); toast('Key revoked'); render(); } catch (e) { toast(e.message, true); } },
  unsubSave: async () => { try { S.unsub = { ...(await DB.unsubscribe(S._unsubTok, { email: !!S.ui.unsub.email, sms: !!S.ui.unsub.sms })), saved: true }; render(); } catch (e) { toast(e.message, true); } },
  unsubAll: async () => { S.ui.unsub = { email: false, sms: false }; return A.unsubSave(); },
  toggleIn: el => doCheckin(el.dataset.v, el.dataset.undo === '1'),
  scPick: el => { if (S.sc.evId !== el.dataset.id) { S.sc.entrance = S.sc.slot = null; } S.sc.evId = el.dataset.id; S.sc.tab = 'scan'; S.sc.q = ''; S.sc.pick = null; saveScanCtx(); render(); doorTick(); },
  scBack: () => { S.sc.evId = ''; S.sc.setup = false; camStop(); saveScanCtx(); render(); },
  scSetup: () => { S.sc.setup = true; S.sc.pick = null; camStop(); render(); },
  scSet: el => { S.sc.pick[el.dataset.k] = el.dataset.v; render(); },
  scSetupDone: () => {
    const pk = S.sc.pick || {}, ev = evById(S.sc.evId), d = scanDev(), name = String(pk.name || '').trim().slice(0, 60) || d.name;
    S.sc.entrance = ev?.entrances?.length ? pk.entrance ?? '' : ''; S.sc.slot = ev?.timeSlots?.length ? pk.slot ?? '' : '';
    if (name !== d.name) { d.name = name; try { localStorage.setItem('set_scan_device', JSON.stringify(d)); } catch (e) { S.sc._dev = d; } }
    S.sc.setup = false; S.sc.pick = null; S.sc.tab = 'scan'; saveScanCtx(); render();
  },
  enAdd: () => { (S.draft.entrances ||= []).push({ id: shortId('en_'), name: 'Entrance ' + (S.draft.entrances.length + 1), ticketTypeIds: [], areas: [] }); dirty(); render(); },
  enDel: el => { S.draft.entrances.splice(+el.dataset.i, 1); dirty(); render(); },
  enPick: el => { const en = S.draft.entrances[+el.dataset.i], k = el.dataset.k, l = en[k] ||= []; en[k] = el.checked ? [...new Set([...l, el.dataset.v])] : l.filter(x => x !== el.dataset.v); dirty(); render(); },
  dlogF: el => { S.ui.dlog.f = el.dataset.v; render(); },
  dlogRefresh: () => { S.ui.dlog = null; render(); },
  dlogCsv: () => { const ev = evById(S.ui.dlog.ev), tk = id => S.adm.tickets.find(t => t.id === id);
    download('scan-history.csv', csv([['Time', 'Result', 'Ticket', 'Guest', 'Seat', 'Entrance', 'Device', 'Staff', 'Manual', 'Override'], ...(S.ui.dlog.rows || []).map(r => { const t = tk(r.ticket_id);
      return [r.at, RES_TITLE[r.result] || r.result, r.code, t?.holder || '', t?.seat ? seatName(ev, t.seat, false, t) : '', r.entrance, r.device_name, r.by, r.manual ? 'yes' : '', r.override ? 'yes' : '']; })]));
    DB.log('export.scans', 'Exported the scan history of ' + (ev?.name || 'an event'), { target: ev?.id }); },
  scOverride: el => { S.sc.last = null; scanCheck(el.dataset.v, false, false, { override: true }); },
  devEdit: el => { S.ui.devEdit = el.dataset.id; S.ui.devName = null; render(); },
  devSave: async el => { try { await DB.deviceAction(el.dataset.id, 'rename', S.ui.devName ?? S.ui.devs.list.find(d => d.id === el.dataset.id)?.name); S.ui.devEdit = null; S.ui.devs = null; toast('Device renamed'); render(); } catch (e) { toast(e.message, true); } },
  devToggle: async el => { try { await DB.deviceAction(el.dataset.id, el.dataset.v); S.ui.devs = null; toast(el.dataset.v === 'disable' ? 'Switched off — it can\'t check anyone in now' : 'Switched back on'); render(); } catch (e) { toast(e.message, true); } },
  devForget: async el => { if (!confirmIn('Remove this device from the list? It reappears if it scans again.')) return; try { await DB.deviceAction(el.dataset.id, 'forget'); S.ui.devs = null; render(); } catch (e) { toast(e.message, true); } },
  scTab: el => { S.sc.tab = el.dataset.v; render(); },
  scCam: () => camStart(),
  scDismiss: (el, e) => { if (e.target.closest('[data-action="scUndo"],[data-action="scOverride"]')) return; S.sc.last = null; render(); },
  scUndo: el => scanCheck(el.dataset.v, true),
  scToggle: el => scanCheck(el.dataset.v, el.dataset.undo === '1', true, { manual: true }),   // from the guest search = a manual check-in
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
  boPlan: async el => { try { await DB.setPlan(el.value, el.dataset.id); S.plat = await DB.loadPlatform(); toast('Plan changed'); render(); } catch (e) { toast(e.message, true); } },
  incEvents: el => { S.ui.inc.events = [...el.selectedOptions].map(o => o.value); },
  donateCustom: el => { S.cart.donation = Math.max(0, Math.round((+el.value || 0) * 100)); S.co.donCustom = S.cart.donation > 0; saveCart(); render(); },
  rr: () => render(),
  // ── Stage 9: reports & exports ──
  repSet: el => { const f = repF(), k = el.dataset.k; f[k] = el.value.trim();
    if (k === 'eventId') Object.assign(f, { slotId: '', ttId: '', area: '', addonId: '', bundleId: '' }); render(); },
  repBy: el => { S.ui.repBy = el.value; render(); },
  recFile: el => { const file = el.files?.[0]; if (!file) return; file.text().then(txt => { try { S.ui.recImport = { name: file.name, rows: parseProcessorCsv(txt) }; toast(`${S.ui.recImport.rows.length} processor transactions loaded — nothing is saved`); render(); } catch (e) { toast(e.message, true); } }); },
  expFile: el => { const file = el.files?.[0], id = el.dataset.id; if (!file) return; file.text().then(async txt => { try { const rows = parseExpenseCsv(txt); const n = await DB.importExpenses(id, rows); await reloadAdmin(); toast(`${n} expense${n === 1 ? '' : 's'} imported`); render(); } catch (e) { toast(e.message, true); } }); },
  segVal: el => { const f = S.ui[el.dataset.p].filter, k = el.dataset.k; f[k] = k === 'tags' ? tagsOf(el.value) : el.value; if (el.dataset.p === 'cmp') S.ui.cmp.segId = ''; render(); },
  cmpSeg: el => { const sg = (S.adm.bo.segments || []).find(x => x.id === el.value); S.ui.cmp.segId = el.value; if (sg) S.ui.cmp.filter = { ...emptySeg(), ...clone(sg.filter) }; render(); },
  auTags: el => { S.ui.au.cond.tags = tagsOf(el.value); render(); },
  // a floor plan under the builder: downscaled in the browser so it stays small enough to store with the event
  smBg: el => { const f = el.files?.[0]; if (!f) return; if (!/^image\//.test(f.type)) return toast('Choose an image file', true);
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => { const k = Math.min(1, 1600 / img.width), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      const b = layoutOf(S.draft.seating).bounds; S.draft.seating.bg = { src: c.toDataURL('image/jpeg', .72), x: Math.round(b.x0), y: Math.round(b.y0), w: Math.round(b.x1 - b.x0), opacity: .35 }; dirty(); render(); };
    img.onerror = () => toast('That image could not be read', true); img.src = url; },
  bPick: el => { const p = (S.sel.picks ||= {})[el.dataset.id] ||= []; p[+el.dataset.i] = el.value; render(); },
  ttAccess: el => { const t = S.draft.ticketTypes[+el.dataset.i]; t.hidden = el.value === 'code'; t.adminOnly = el.value === 'admin'; t.memberOnly = el.value === 'members'; dirty(); render(); },
  switchBo: async el => { try { S.ui.support = null; S.ui.set = S.ui.brand = S.ui.pe = null; await reloadAdmin(el.value); location.hash = '#/admin/dashboard'; setContext(); render(); } catch (e) { toast(e.message, true); } },
  opPrice: el => { const m = S.ui.op.map[el.dataset.id] ||= {}; m.price = el.value === '' ? '' : Math.round(parseFloat(el.value) * 100); render(); },
  moAdd: el => { (S.ui.mo.adds ||= {})[el.dataset.id] = Math.max(0, parseInt(el.value, 10) || 0); render(); },
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
    let v = t === 'bool' || el.type === 'checkbox' ? el.checked : el.value;
    if (t === 'money') v = el.value === '' ? 0 : Math.round(parseFloat(el.value) * 100);
    else if (t === 'moneyOpt') v = el.value === '' ? '' : Math.round(parseFloat(el.value) * 100);
    else if (t === 'int') v = el.value === '' ? 0 : parseInt(el.value, 10);
    else if (t === 'num') v = el.value === '' ? 0 : parseFloat(el.value);
    else if (t === 'dt') v = el.value ? new Date(el.value).toISOString() : '';
    else if (t === 'list') v = el.value.split(',').map(x => x.trim()).filter(Boolean).map(Number);
    const target = root === 'draft' ? S.draft : root === 'co' ? S.co : root === 'set' ? S.ui.set : root === 'ui' ? S.ui : null;
    if (!target) return;
    const secM = root === 'draft' && path.match(/^seating\.sections\.(\d+)\./);
    if (secM && S.draft.seating.sections[+secM[1]]) remapSeatKeys(S.draft.seating, S.draft.seating.sections[+secM[1]].id, () => setPath(target, path, v)); else setPath(target, path, v);
    if (root === 'ui' && path.startsWith('pe.')) { S.ui.pe.dirty = true; const b = $('[data-action="savePerms"]'); if (b) b.disabled = false; }
    if (root === 'ui' && path.startsWith('brand.branding.') && el.type !== 'text' && el.type !== 'url') { render(); return; }
    if (root === 'draft') { dirty(); if (path === 'name' && S.draft.status === 'draft' && /^new-event-/.test(S.draft.slug)) S.draft.slug = slugify(v); }
    if (el.type === 'checkbox' || el.tagName === 'SELECT' || path.startsWith('seating.')) render();
    return;
  }
  if (el.dataset.input) {
    const k = el.dataset.input, v = el.value;
    if (k === 'pgGallery') { (S.draft.page ||= {}).gallery = v.split('\n').map(x => x.trim()).filter(Boolean); dirty(); return; }
    if (k === 'homeq') S.home.q = v; else if (k === 'homeWhen') S.home.when = v; else if (k === 'pw') S.sel.pw = v;
    else if (k === 'wlName' || k === 'wlEmail' || k === 'wlPhone') (S.ui.wl ||= {})[{ wlName: 'name', wlEmail: 'email', wlPhone: 'phone' }[k]] = v;
    else if (k === 'findRef' || k === 'findEmail') (S.ui.find ||= {})[k === 'findRef' ? 'ref' : 'email'] = v;
    else if (k === 'loginEmail') S.ui.login.email = v; else if (k === 'loginCode') S.ui.login.code = v; else if (k === 'loginTotp') S.ui.login.totp = v;
    else if (k === 'sc.q') { S.sc.q = v; return render(); }
    else if (k === 'sc.devName') { if (S.sc.pick) S.sc.pick.name = v; return; }
    else if (k === 'devName') { S.ui.devName = v; return; }
    else if (k.startsWith('entr:')) { const [, i, f] = k.split(':'); S.draft.entrances[+i][f] = v; dirty(); return; }
    else if (k.includes('.')) { const [a, b] = k.split('.'); (S.ui[a] ||= {})[b] = v; if (a === 'mo' && b === 'ev') Object.assign(S.ui.mo, { seats: [], adds: {}, tt: '', slot: '', credit: '', level: '' }); if (a === 'mo' && b === 'slot') S.ui.mo.seats = []; if (el.dataset.rr || (a === 'inv' && b === 'template')) render(); return; }
    else S.ui[k] = v;
    if (['homeq', 'homeWhen', 'q', 'ev', 'status', 'attEv', 'repEv'].includes(k) || el.dataset.rr === '1') render();
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
// Pixels: GA4, Meta, TikTok on public pages only (never the back office). With the cookie-banner setting they wait for the visitor's yes.
// Purchases carry the order id as the event id, so Meta matches the browser event with the server one (Conversions API) and counts it once.
let _pixels = false, _pixQ = [];
const pixOk = () => { const p = S.settings.pixels || {}; if (!p.consent) return true; try { return localStorage.getItem('set_px') === 'yes'; } catch (e) { return false; } };
function loadPixels() {
  const p = S.settings.pixels || {}; if (_pixels || location.hash.startsWith('#/admin') || location.hash.startsWith('#/platform') || location.hash.startsWith('#/scan')) return;
  const any = /^G-[A-Z0-9]+$/.test(p.ga4 || '') || /^\d{6,20}$/.test(p.meta || '') || /^[A-Z0-9]{8,30}$/.test(p.tiktok || '');
  if (!any) return;
  if (!pixOk()) { let ask = true; try { ask = localStorage.getItem('set_px') !== 'no'; } catch (e) { } if (ask && !$('#pxBanner')) { const d = document.createElement('div'); d.id = 'pxBanner'; d.className = 'px-banner';
    d.innerHTML = `<span>We use cookies to measure our ads and improve this site.</span><span class="row"><button class="btn btn-ghost btn-sm" data-action="pxNo">No thanks</button><button class="btn btn-accent btn-sm" data-action="pxYes">Accept</button></span>`; document.body.append(d); } return; }
  _pixels = true; const add = src => { const s = document.createElement('script'); s.async = true; s.src = src; document.head.append(s); };
  if (/^G-[A-Z0-9]+$/.test(p.ga4 || '')) { add('https://www.googletagmanager.com/gtag/js?id=' + p.ga4); window.dataLayer = window.dataLayer || []; window.gtag = function () { dataLayer.push(arguments); }; gtag('js', new Date()); gtag('config', p.ga4); }
  if (/^\d{6,20}$/.test(p.meta || '')) { const f = window.fbq = function () { f.callMethod ? f.callMethod.apply(f, arguments) : f.queue.push(arguments); }; f.push = f; f.loaded = true; f.version = '2.0'; f.queue = [];
    add('https://connect.facebook.net/en_US/fbevents.js'); fbq('init', p.meta); fbq('track', 'PageView'); }
  if (/^[A-Z0-9]{8,30}$/.test(p.tiktok || '')) { const t = window.ttq = window.ttq || []; ['page', 'track', 'identify'].forEach(m => { t[m] = function () { t.push([m, ...arguments]); }; });
    add('https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=' + p.tiktok + '&lib=ttq'); t.page(); }
  _pixQ.splice(0).forEach(([n, d]) => pix(n, d));
}
function pix(name, d = {}) {
  if (!_pixels) { if (_pixQ.length < 20) _pixQ.push([name, d]); return; }
  const value = (+d.value || 0) / 100, cur = d.currency || 'USD';
  if (window.gtag) gtag('event', { ViewContent: 'view_item', InitiateCheckout: 'begin_checkout', Purchase: 'purchase' }[name], name === 'Purchase' ? { transaction_id: d.ref, value, currency: cur } : name === 'ViewContent' ? { items: [{ item_id: d.id, item_name: d.name }] } : { value, currency: cur });
  if (window.fbq) fbq('track', name, name === 'ViewContent' ? { content_name: d.name, content_ids: [d.id] } : { value, currency: cur, ...(d.n ? { num_items: d.n } : {}) }, d.id && name === 'Purchase' ? { eventID: d.id } : undefined);
  if (window.ttq?.track) ttq.track({ ViewContent: 'ViewContent', InitiateCheckout: 'InitiateCheckout', Purchase: 'CompletePayment' }[name], name === 'ViewContent' ? { content_id: d.id, content_name: d.name } : { value, currency: cur });
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
async function loadCustomer() {
  S.cust = await DB.custSession().catch(() => null);
  if (S.cust) { const co = S.co; co.name ||= S.cust.name; co.email ||= S.cust.email; co.phone ||= S.cust.phone; }
}
// an interrupted card checkout (closed tab, lost signal) picks up where it stopped while its time lasts
async function resumePay() {
  let pend = null; try { pend = JSON.parse(localStorage.getItem('set_pay') || 'null'); } catch (e) { }
  if (!pend) return;
  const o = await DB.getOrder(pend.id, pend.key).catch(() => null);
  if (o?.order?.status === 'awaiting_payment' && D(o.order.expires_at) > Date.now()) startPay({ ...pend, status: 'awaiting_payment', total: o.order.data.total, expires_at: o.order.expires_at });
  else try { localStorage.removeItem('set_pay'); } catch (e) { }
}
async function boot() {
  try {
    LOGO = (await (await fetch('set-logo.svg')).text()).replace('<svg ', '<svg class="set-logo" role="img" aria-label="SET" ');
  } catch (e) { }
  try {
    await refreshPublic();
    // Stage 10: on a box office's own domain the site opens on that box office (platform hosts are listed in platform settings)
    const host = location.hostname.toLowerCase();
    if (!(S.platform.appHosts || DEFAULT_PLATFORM.appHosts).includes(host) && !DEFAULT_PLATFORM.appHosts.includes(host)) { const b = await DB.boByDomain(host).catch(() => null); if (b) S.domainBo = b.slug; }
    S.user = await DB.session();
    if (S.user && !S.user.mfa) await reloadAdmin().catch(e => { S.user = null; toast(e.message, true); });
    await loadCustomer();
    resumePay();
  } catch (e) { console.error(e); toast('Could not load events: ' + e.message, true); }
  S.sc.queue = loadQueue(); try { const c = JSON.parse(localStorage.getItem('set_scan_ctx') || 'null') || { evId: localStorage.getItem('set_scan_ev') || '' }; Object.assign(S.sc, { evId: c.evId || '', entrance: c.entrance ?? null, slot: c.slot ?? null }); } catch (e) { }
  if (window.SET_CONFIG?.env === 'staging') document.body.insertAdjacentHTML('afterbegin', '<div class="env-ribbon">Test environment — test payments, test emails only</div>');
  S.loading = false; loadPixels(); onRoute(); flushQueue();
  setInterval(heartbeat, 15000); setInterval(idleCheck, 30000);
}
// Stage 10 secure sessions: staff are signed out after the box office's inactivity limit (Settings → Staff security)
let _lastAct = Date.now();
['pointerdown', 'keydown'].forEach(t => document.addEventListener(t, () => { _lastAct = Date.now(); }, { passive: true }));
function idleCheck() {
  const mins = +(S.adm?.bo?.settings?.sessionMinutes) || 0;
  if (S.user && mins > 0 && Date.now() - _lastAct > mins * 6e4) { A.signOut(); toast(`Signed out after ${mins} minutes without activity`); }
}
// Stage 10 error logging: anything the page throws goes to the platform's error log (System health), at most 20 per page load
window.addEventListener('error', e => DB.logError(S.route?.page === 'cart' ? 'checkout' : S.route?.page === 'e' ? 'event' : S.route?.page === 'scan' ? 'scan' : 'app', e.error || e.message));
window.addEventListener('unhandledrejection', e => DB.logError(S.route?.page === 'cart' ? 'checkout' : 'app', e.reason));
// every 15s: buyers on an event page / in checkout tell the box office they're here (live activity); staff watching live numbers get fresh ones
let _beat = 0;
function heartbeat() {
  const r = S.route; _beat++;
  if (document.hidden) return;
  if (['e', 'cart'].includes(r.page) && _beat % 2 === 0) presencePing();
  if (r.page === 'admin' && S.adm && !S.dirty && !$('#modal').innerHTML && !S.ui.op && ((r.sub === 'event' && r.params[1] === 'live') || r.sub === 'dashboard'))
    reloadAdmin().then(() => { const a = document.activeElement; if (!a || !['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) render(); }).catch(() => { });
}
const cartTicketsFor = id => S.cart.items.filter(i => i.eventId === id).reduce((a, i) => a + (+i.qty || 0), 0);
function presencePing() {
  const ids = new Set(S.route.page === 'e' && S.sel?.eventId ? [S.sel.eventId] : []); cartEventIds().forEach(id => ids.add(id));
  ids.forEach(id => DB.ping(id, cartTicketsFor(id)));
}
// checkout: a membership / season pass code (§3)
function PassBox(q) {
  const co = S.co, bo = cartBo(); if (!(bo?.settings?.passPlans || []).length) return '';
  if (co.pass) return `<div class="between small" style="margin-top:8px"><span class="chip ok">${esc(co.pass.plan?.name || 'Pass')} ${esc(co.pass.code)}${co.pass.left != null ? ` · ${co.pass.left} left` : ''}</span><a href="#" data-action="removePass" class="small">Remove</a></div>
    ${!q.passUses && !q.lines.some(l => evById(l.eventId)?.ticketTypes.find(t => t.id === l.ticketTypeId)?.memberOnly) ? '<p class="small" style="color:var(--warn);margin-top:4px">Your pass doesn\'t cover anything in this cart.</p>' : ''}`;
  return co.passOpen ? `<div class="row" style="margin-top:8px"><input class="inp" data-bind="co.passCode" placeholder="Membership / pass code, MP-…" value="${esc(co.passCode || '')}"><button class="btn btn-ghost" data-action="applyPass">Apply</button></div><p class="small muted">Use the email the pass belongs to.</p>`
    : `<a href="#" class="small" style="display:inline-block;margin-top:8px;margin-left:12px" data-action="openPass">Have a membership or season pass?</a>`;
}
// checkout: the payment-plan offer (§5) — shown when the box office allows it and the order is big enough and early enough
function PlanOffer(q, set, evs) {
  const starts = q.lines.filter(l => l.eventId).map(l => D(l.slotStart || evById(l.eventId)?.start)?.getTime()).filter(Boolean);
  const pl = S.co.payment === 'card' && starts.length ? planSchedule(q.total, installFor(cartBo()?.settings || set, evs), new Date(Math.min(...starts)).toISOString()) : null;
  if (!pl) { S.co.plan = false; return ''; }
  return `<label class="pay-opt ${S.co.plan ? 'on' : ''}" style="margin-top:8px"><input type="checkbox" data-bind="co.plan" data-t="bool" data-action-change="rr" ${S.co.plan ? 'checked' : ''}><div><b>Pay in ${pl.schedule.length} parts</b>
    <div class="small muted">${money(pl.deposit, q.currency)} today, then ${pl.schedule.slice(1).map(x => `${money(x.amount, q.currency)} on ${esc(fmtDate(x.due, { month: 'short', day: 'numeric' }))}`).join(', ')}. Seats held; tickets issued with the last payment.</div></div></label>`;
}
// door sales: how it's paid — cash (with change), the card reader, or another method (§2)
function PosPayment(m, q) {
  const total = q && !m.comp ? q.total : 0, tender = Math.round(parseFloat(m.tender || 0) * 100);
  return `<div class="field"><label class="fl">Payment</label><div class="seg">${[['cash', 'Cash'], ['card', 'Card reader'], ['zelle', 'Zelle'], ['check', 'Check'], ['other', 'Other']].map(([k, t]) => `<button type="button" class="${m.pay === k ? 'on' : ''}" data-action="posPay" data-v="${k}">${t}</button>`).join('')}</div></div>
    ${m.pay === 'cash' ? `<div class="grid2">${opRow('Cash received ($)', `<input class="inp" type="number" min="0" step="0.01" data-input="mo.tender" data-rr="1" value="${esc(m.tender || '')}">`)}<div class="field"><label class="fl">Change due</label><div class="display" style="font-size:26px">${tender >= total && tender ? money(tender - total) : '—'}</div></div></div>`
      : m.pay === 'card' ? opRow('Card reader', `<select class="inp" data-input="mo.reader">${(S.readers || []).map(r => `<option value="${esc(r.id)}" ${m.reader === r.id ? 'selected' : ''}>${esc(r.label)}${r.status && r.status !== 'online' ? ' (' + esc(r.status) + ')' : ''}</option>`).join('') || '<option value="">No card reader connected</option>'}</select>`)
      : opRow('Reference', `<input class="inp" data-input="mo.ref" value="${esc(m.ref)}" placeholder="Zelle id / check no.">`)}`;
}
// scanner: a product voucher result (§11)
function ScanItem(r) {
  const kind = resKind(r.result), it = r.item, f = r.first || {};
  const note = { item_used: `Redeemed at ${fmtTime(f.at || it.redeemed_at)}${f.entrance ? ' · ' + f.entrance : ''}${f.device_name ? ' · ' + f.device_name : ''}`, item_void: 'This voucher was cancelled or refunded.',
    wrong_event: `This voucher is for ${it.event_name}`, undone: 'Redemption undone — the voucher can be used again.' }[r.result];
  return `<div class="sc-result ${kind}" data-action="scDismiss" role="alert"><div class="sc-res-icon">${ic(kind === 'ok' ? 'check' : kind === 'bad' ? 'x' : 'alert', 50)}</div>
    <div class="sc-res-t">${esc(RES_TITLE[r.result] || r.result)}</div><div class="sc-seat"><div>${esc(it.name)}</div></div>${it.from ? `<div class="sc-res-type">in ${esc(it.from)}</div>` : ''}
    <div class="sc-res-name">${esc(it.holder || '')}</div><div class="sc-res-code">${esc(it.code)}${it.order_ref ? ' · ' + esc(it.order_ref) : ''}</div>${note ? `<div class="sc-res-note">${esc(note)}</div>` : ''}
    <div class="sc-res-actions">${r.result === 'item_ok' && can('door.undo', it.event_id) ? `<button class="btn glass" data-action="scUndo" data-v="${esc(it.code)}">Undo</button>` : ''}<button class="btn glass" data-action="scDismiss">Next scan</button></div></div>`;
}
// ══════════════════════════════════════════════════════════════════════════════
//  FINAL ADDITIONS — gift cards, memberships, payment plans, self-service, door sales, wallet passes, embeds, product vouchers
// ══════════════════════════════════════════════════════════════════════════════
const boBySlug = slug => S.bos.find(b => b.slug === slug);
const startOf = (ev, slotId) => (ev.timeSlots || []).find(s => s.id === slotId)?.start || ev.start;
// a cart holds one organizer's things: gift cards and passes join it only when it's empty or already that box office's
function cartFor(bo) {
  const cur = cartBo();
  if (cur && cur.id !== bo.id && (S.cart.items.length || S.cart.addons.length || (S.cart.gifts || []).length || (S.cart.passes || []).length)) { toast('Your cart has another organizer\'s tickets — finish that order first', true); return false; }
  S.cart.boId = bo.id; S.cart.gifts ||= []; S.cart.passes ||= []; return true;
}
// §4 buy a gift card (box office page → #/gift/<slug>)
function GiftPage() {
  const bo = boBySlug(S.route.params[0]); if (!bo) return NotFound();
  const gs = giftSettings(bo.settings), g = S.ui.gift ||= { amount: gs.amounts?.[0] || gs.min, custom: '', to: '', toEmail: '', message: '' };
  if (!gs.on) return `<div class="container section"><div class="empty"><div class="display">No gift cards here</div><p>${esc(bo.name)} doesn't sell gift cards online.</p></div></div>`;
  const amt = g.custom ? Math.round(parseFloat(g.custom) * 100) : g.amount;
  return `<div class="container section" style="max-width:760px"><a href="#/b/${esc(bo.slug)}" class="small muted" style="text-decoration:none">← ${esc(bo.name)}</a>
    <h1 class="display" style="font-size:44px;margin:10px 0 6px">Gift cards</h1><p class="muted">Send a ${esc(bo.name)} gift card by email. It works for any of their events${+gs.days > 0 ? ` for ${Math.round(+gs.days / 30) >= 12 ? Math.round(+gs.days / 365) + ' year' + (Math.round(+gs.days / 365) > 1 ? 's' : '') : gs.days + ' days'}` : ''}, and the balance carries over if it isn't all used at once.</p>
    <div class="card stack" style="margin-top:18px"><div class="eyebrow dash">Amount</div>
      <div class="row wrap">${(gs.amounts || []).map(a => `<button class="btn ${!g.custom && g.amount === a ? 'btn-dark' : 'btn-ghost'}" data-action="giftAmt" data-v="${a}">${money(a)}</button>`).join('')}
        ${gs.custom ? `<input class="inp" style="width:150px" type="number" min="${gs.min / 100}" max="${gs.max / 100}" step="1" placeholder="Other $" data-input="gift.custom" data-rr="1" value="${esc(g.custom)}" aria-label="Other amount">` : ''}</div>
      ${gs.custom ? `<div class="small muted">Any amount from ${money(gs.min)} to ${money(gs.max)}.</div>` : ''}
      <div class="grid2"><div><label class="fl">Recipient's name</label><input class="inp" data-input="gift.to" value="${esc(g.to)}"></div><div><label class="fl">Recipient's email</label><input class="inp" type="email" data-input="gift.toEmail" value="${esc(g.toEmail)}" placeholder="Leave blank to send it to yourself"></div></div>
      <div><label class="fl">Message (optional)</label><textarea class="inp" rows="2" data-input="gift.message" maxlength="300">${esc(g.message)}</textarea></div>
      <button class="btn btn-accent btn-lg" data-action="giftAdd" data-bo="${esc(bo.id)}">Add ${amt > 0 ? money(amt) + ' ' : ''}gift card to cart <span class="arr">→</span></button></div></div>`;
}
// §3 memberships & season passes (#/member/<slug>)
function MemberPage() {
  const bo = boBySlug(S.route.params[0]); if (!bo) return NotFound();
  const plans = (bo.settings.passPlans || []).filter(p => p.onSale !== false);
  return `<div class="container section" style="max-width:900px"><a href="#/b/${esc(bo.slug)}" class="small muted" style="text-decoration:none">← ${esc(bo.name)}</a>
    <h1 class="display" style="font-size:44px;margin:10px 0 6px">Memberships & passes</h1><p class="muted">Buy once, then use your pass code at checkout — it covers or discounts your tickets automatically.</p>
    ${plans.length ? `<div class="ev-grid" style="margin-top:18px">${plans.map(p => `<div class="card plan-card"><span class="chip">${esc(PASS_KINDS[p.kind] || 'Pass')}</span><h3 style="margin-top:8px">${esc(p.name)}</h3>
      <div class="display" style="font-size:30px;margin:6px 0">${money(p.price)}</div><p class="small muted">${esc(p.desc || '')}</p>
      <ul class="small plan-points"><li>${p.benefit === 'free' ? `${+p.uses ? p.uses + ' visits included' : 'Unlimited visits'}${+p.perEvent ? ` · ${p.perEvent} per event` : ''}` : `${+p.pct || 0}% off ${(p.ticketTypeIds || []).length ? 'selected' : 'every'} ticket`}</li>
        <li>${p.validUntil ? 'Valid until ' + esc(fmtDate(p.validUntil, { month: 'short', day: 'numeric', year: 'numeric' })) : +p.validDays ? `Valid for ${p.validDays >= 365 ? Math.round(p.validDays / 365) + ' year' : p.validDays + ' days'}` : 'No expiry'}</li></ul>
      <button class="btn btn-accent btn-block" data-action="passAdd" data-bo="${esc(bo.id)}" data-v="${esc(p.id)}">Add to cart</button></div>`).join('')}</div>` : '<div class="empty">No memberships on sale right now.</div>'}</div>`;
}
// §10 embeds: an event list for another website (#/embed-list/<box office slug>)
function EmbedList() {
  const bo = boBySlug(S.route.params[0]); if (!bo) return NotFound();
  const evs = listedEvents().filter(e => e.box_office_id === bo.id);
  return `<div class="container" style="padding:16px"><div class="ev-grid">${evs.map(e => EvCard(e).replace(/href="#\/e\//g, 'href="#/embed/')).join('') || '<div class="empty">No events on sale right now.</div>'}</div></div>`;
}
// §10 just the ticket selector (#/embed/<slug>?compact=1) — checkout continues inside the widget
function CompactWidget(ev) {
  const av = S.avail[ev.id], stop = eventLive(ev) && controlBlock(ev, 'sales');
  return `<div class="container" style="padding:12px;max-width:${ev.seating?.enabled ? 1000 : 560}px"><div class="between"><b>${esc(ev.name)}</b><span class="small muted">${esc(fmtDT(ev.start))}</span></div>
    ${ev.seating?.enabled && S.sel && av ? `<div class="card" style="margin-top:10px">${BuyerSeatMap(ev, av, S.sel)}</div>` : ''}
    <div class="card" style="margin-top:10px">${stop ? `<h3>Sales paused</h3><p class="small muted">${esc(stop)}</p>` : TicketPanel(ev, S.sel, av)}</div></div>`;
}
// §1 the phone-wallet card (DEMO preview; LIVE the wallet Edge Function builds the real .pkpass / Google Wallet pass)
function WalletPreview(c, kind) {
  return `<div class="wallet-pv ${kind}"><div class="between"><b>${esc(c.org || 'SET')}</b><span class="small">${kind === 'apple' ? 'Apple Wallet' : 'Google Wallet'}</span></div>
    <div class="wp-ev">${esc(c.event)}</div><div class="wp-grid"><div><span>Date</span>${esc(fmtDT(c.start))}</div><div><span>Ticket</span>${esc(c.type)}</div>
    ${c.unit ? `<div><span>${esc(unitParts(c.unit)[0])}</span>${esc(unitParts(c.unit)[1])}</div>` : ''}${c.row ? `<div><span>Row</span>${esc(c.row)}</div>` : ''}${c.seat ? `<div><span>Seat</span>${esc(c.seat)}</div>` : ''}<div><span>Name</span>${esc(c.holder)}</div></div>
    <div class="wp-venue">${esc(c.venue)}</div>${c.void ? '<div class="wp-void">VOID — this ticket was cancelled or replaced</div>' : `<div class="qr wp-qr" data-qr="${esc(c.code)}"></div><div class="wp-code">${esc(c.code)} · ${esc(c.ref)}</div>`}</div>`;
}
// the buyer's ticket page extras: payment plan, product vouchers, gift cards / passes bought, self-service
function OrderPageExtras(o) {
  const ord = o.order, d = ord.data, pl = d.plan, self = o.self || {}, nx = planNext(pl), cur = d.currency;
  const planCard = pl ? `<div class="card no-print" style="margin-bottom:18px"><div class="between"><h3>Payment plan</h3><span class="chip ${planState(pl) === 'overdue' ? 'bad' : planState(pl) === 'paid' ? 'ok' : 'info'}">${esc(planState(pl))}</span></div>
      <p class="small muted" style="margin:4px 0 10px">${nx ? `Your seats are held. Your tickets are issued when the last payment is made — by ${esc(fmtDate(pl.deadline, { month: 'short', day: 'numeric', year: 'numeric' }))}.` : 'Paid in full — your tickets are below.'}</p>
      ${pl.schedule.map(x => `<div class="sum-line small"><span>${esc(x.label)} <span class="muted">· ${x.paid_at ? 'paid ' + esc(fmtDate(x.paid_at, { month: 'short', day: 'numeric' })) : 'due ' + esc(fmtDate(x.due, { month: 'short', day: 'numeric' }))}</span></span><span class="tnum">${x.paid_at ? '✓ ' : ''}${money(x.amount, cur)}</span></div>`).join('')}
      ${nx && ord.status === 'pending' ? `<div class="sep"></div>${DB.live ? '' : `<div class="grid3"><input class="inp tnum" placeholder="Card number" data-bind="ui.inst.number" value="${esc(S.ui.inst?.number || '')}"><input class="inp tnum" placeholder="MM/YY" data-bind="ui.inst.exp" value="${esc(S.ui.inst?.exp || '')}"><input class="inp tnum" placeholder="CVC" data-bind="ui.inst.cvc" value="${esc(S.ui.inst?.cvc || '')}"></div>
        <p class="small muted">Demo processor: use 4242 4242 4242 4242.</p>`}<button class="btn btn-accent" style="margin-top:8px" data-action="payInst">Pay ${esc(nx.label.toLowerCase())} — ${money(nx.amount, cur)}</button>` : ''}</div>` : '';
  const vouchers = (o.vouchers || []).length && ['paid', 'refunded'].includes(ord.status) ? `<h3 style="margin:24px 0 10px">Product vouchers</h3><p class="small muted" style="margin-bottom:10px">Show each code to staff — it's scanned and redeemed separately from your ticket.</p>
    <div class="voucher-grid">${o.vouchers.map(v => `<div class="voucher ${v.status}"><div><b>${esc(v.name)}</b><div class="small muted">${esc(evById(v.event_id)?.name || '')}${v.from ? ' · in ' + esc(v.from) : ''}</div>
      <div class="small">${v.status === 'valid' ? 'Not redeemed yet' : v.status === 'redeemed' ? 'Redeemed ' + esc(fmtDT(v.redeemed_at)) : 'Void'}</div></div>${v.status === 'valid' ? `<div class="qr vqr" data-qr="${esc(v.code)}"></div>` : ''}<div class="code small">${esc(v.code)}</div></div>`).join('')}</div>` : '';
  const bought = [...(o.gifts || []).map(g => `<div class="sum-line small"><span>Gift card ${money(g.amount, cur)} for ${esc(g.to || g.email)}${g.code ? ` · <b class="tnum">${esc(g.code)}</b> · ${money(g.remaining, cur)} left` : ` · emailed to ${esc(g.email)}`}</span><span class="chip mini">${esc(g.status)}</span></div>`),
    ...(o.passes || []).map(x => `<div class="sum-line small"><span>${esc(x.plan)} for ${esc(x.name || x.email)}${x.code ? ` · <b class="tnum">${esc(x.code)}</b>` : ` · emailed to ${esc(x.email)}`}${x.expires ? ' · valid until ' + esc(fmtDate(x.expires, { month: 'short', day: 'numeric', year: 'numeric' })) : ''}</span><span class="chip mini">${esc(x.status)}</span></div>`)];
  const reqs = ['seatChange', 'cancel', 'refund'].filter(k => self[k]);
  return { planCard, vouchers, bought: bought.length ? `<div class="card no-print" style="margin-top:20px"><h3>Gift cards & memberships</h3>${bought.join('')}<p class="small muted" style="margin-top:8px">Use a code at checkout — gift cards in the credit box, passes in the membership box.</p></div>` : '',
    requests: ord.status === 'paid' && reqs.length ? `<div class="card no-print" style="margin-top:16px"><h3>Need a change?</h3><p class="small muted" style="margin:4px 0 10px">Send a request to ${esc(S.settings.name)} — nothing changes until they reply.</p>
      <div class="row wrap">${reqs.map(k => `<button class="btn btn-ghost btn-sm" data-action="selfReq" data-v="${k}">${esc(SELF_REQUESTS[k])}</button>`).join('')}</div></div>` : '' };
}
// back office: the order page's extra cards — payment record (offline), payment plan, gift cards / passes sold, product vouchers
function OrderExtras(o) {
  const d = o.data, pay = o.payment, cur = d.currency, pl = d.plan, ev0 = o.event_ids[0], vs = (S.adm.vouchers || []).filter(v => v.order_id === o.id);
  const gifts = (S.adm.credits || []).filter(c => c.source_order === o.id && c.kind === 'gift'), passes = (S.adm.passes || []).filter(x => x.order_id === o.id);
  return [
    pay?.provider === 'manual' ? `<div class="card"><h3>Payment record</h3><div class="kv2 small" style="margin-top:8px">
      <div><span class="muted">Amount</span>${money(pay.amount ?? d.total, cur)}</div><div><span class="muted">Method</span>${esc(PAY_LABEL[pay.method] || pay.method || '')}</div>
      <div><span class="muted">Date</span>${esc(pay.paidDate || pay.date || fmtDate(o.created_at))}</div><div><span class="muted">By</span>${esc(pay.markedPaidBy || pay.by || '')}</div>
      <div><span class="muted">Status</span>${o.status === 'pending' ? '<span class="chip warn mini">Unpaid</span>' : '<span class="chip ok mini">Paid</span>'}</div>${pay.ref ? `<div><span class="muted">Reference</span>${esc(pay.ref)}</div>` : ''}</div>
      ${pay.notes ? `<p class="small" style="margin-top:8px">${esc(pay.notes)}</p>` : ''}${d.channel === 'pos' ? '<p class="small muted" style="margin-top:6px">Sold at the door.</p>' : ''}</div>` : '',
    pl ? `<div class="card"><div class="between"><h3>Payment plan</h3><span class="chip ${planState(pl) === 'overdue' ? 'bad' : planState(pl) === 'paid' ? 'ok' : 'info'}">${esc(planState(pl))}</span></div>
      ${pl.schedule.map(x => `<div class="sum-line small"><span>${esc(x.label)} <span class="muted">· ${x.paid_at ? `paid ${esc(fmtDT(x.paid_at))} · ${esc(PAY_LABEL[x.method] || x.method || '')}${x.last4 ? ' •••• ' + esc(x.last4) : ''}` : 'due ' + esc(fmtDate(x.due, { month: 'short', day: 'numeric' }))}</span></span><span class="tnum">${money(x.amount, cur)}</span></div>`).join('')}
      <div class="sum-line"><span class="muted">Paid so far</span><span class="tnum">${money(planPaid(pl), cur)} of ${money(d.total, cur)}</span></div><div class="small muted">Deadline ${esc(fmtDate(pl.deadline, { month: 'short', day: 'numeric', year: 'numeric' }))} · tickets are issued with the last payment.</div></div>` : '',
    gifts.length || passes.length ? `<div class="card"><h3>Gift cards & passes sold</h3>${gifts.map(c => `<div class="between small line"><span><code>${esc(c.code)}</code> · ${money(c.amount, cur)} → ${esc(c.email)}</span><span class="muted">${money(c.remaining, cur)} left</span></div>`).join('')}
      ${passes.map(x => `<div class="between small line"><span><code>${esc(x.code)}</code> · ${esc(x.plan_name)} → ${esc(x.email)}</span><span class="muted">${esc(x.status)}</span></div>`).join('')}</div>` : '',
    vs.length ? `<div class="card"><h3>Product vouchers</h3>${vs.map(v => `<div class="between small line"><span><code>${esc(v.code)}</code> · ${esc(v.name)}${v.from ? ' <span class="muted">in ' + esc(v.from) + '</span>' : ''}</span><span class="chip mini ${v.status === 'redeemed' ? 'ok' : v.status === 'void' ? 'bad' : ''}">${esc(VOUCHER_STATUS[v.status])}${v.redeemed_at ? ' ' + esc(fmtTime(v.redeemed_at)) : ''}</span></div>`).join('')}</div>` : ''].join('');
}
// §3 / §4 back office: memberships, season passes and gift cards (#/admin/passes)
function Passes() {
  const set = S.adm.bo.settings, plans = set.passPlans || [], tab = S.route.params[0] === 'gifts' ? 'gifts' : 'passes', f = S.ui.pf ||= { planId: plans[0]?.id || '', email: '', name: '', kind: 'gift', amount: '', eventId: '', expires: '' };
  const passes = S.adm.passes || [], gifts = (S.adm.credits || []).filter(c => c.kind === 'gift' || c.kind === 'voucher'), canIssue = can('orders.gifts');
  const tabs = `<div class="tabs" style="margin-bottom:16px"><a class="${tab === 'passes' ? 'on' : ''}" href="#/admin/passes">Memberships & passes</a><a class="${tab === 'gifts' ? 'on' : ''}" href="#/admin/passes/gifts">Gift cards & vouchers</a></div>`;
  if (tab === 'gifts') return head('Gift cards & passes', 'Gift cards and vouchers are credit codes with a balance — partial use, expiry and event limits', canIssue ? '<a class="btn btn-ghost" href="#/admin/settings">Gift card settings</a>' : '') + tabs + `
    ${canIssue ? `<div class="card" style="margin-bottom:16px"><h3>Issue a gift card or voucher</h3><div class="grid3" style="margin-top:10px">
      ${opRow('Type', `<select class="inp" data-bind="ui.pf.kind"><option value="gift" ${f.kind === 'gift' ? 'selected' : ''}>Gift card</option><option value="voucher" ${f.kind === 'voucher' ? 'selected' : ''}>Gift voucher</option></select>`)}
      ${opRow('Amount ($)', `<input class="inp" type="number" min="1" step="0.01" data-bind="ui.pf.amount" value="${esc(f.amount)}">`)}${opRow('Recipient email', `<input class="inp" data-bind="ui.pf.email" value="${esc(f.email)}">`)}</div>
      <div class="grid3">${opRow('Name', `<input class="inp" data-bind="ui.pf.name" value="${esc(f.name)}">`)}${opRow('Only for event', `<select class="inp" data-bind="ui.pf.eventId">${evOptions(f.eventId, 'Any event')}</select>`)}${opRow('Expires', `<input class="inp" type="date" data-bind="ui.pf.expires" value="${esc(f.expires)}">`)}</div>
      <button class="btn btn-dark btn-sm" data-action="giftIssue">Issue & email it</button></div>` : ''}
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Type</th><th>Holder</th><th>Amount</th><th>Left</th><th>Limits</th><th>Status</th></tr></thead><tbody>
      ${gifts.map(c => `<tr><td class="tnum"><b>${esc(c.code)}</b></td><td>${esc(CREDIT_KINDS[c.kind])}${c.from_name ? `<div class="small muted">from ${esc(c.from_name)}</div>` : ''}</td><td class="small">${esc(c.name || '')}<div class="muted">${esc(c.email)}</div></td>
        <td class="tnum">${money(c.amount)}</td><td class="tnum">${money(c.remaining)}</td><td class="small">${c.event_id ? esc(evById(c.event_id)?.name || 'one event') : 'Any event'}${c.expires ? '<div class="muted">until ' + esc(fmtDate(c.expires)) + '</div>' : ''}</td><td><span class="chip mini">${esc(c.status)}</span></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No gift cards yet.</td></tr>'}
    </tbody></table></div>`;
  const sold = id => passes.filter(x => x.plan_id === id && x.status !== 'cancelled').length;
  return head('Gift cards & passes', 'Season passes, memberships and multi-event passes — issued, used and tracked', canIssue ? '<a class="btn btn-ghost" href="#/admin/settings">Edit plans</a>' : '') + tabs + `
    <div class="kpis" style="margin-bottom:16px">${plans.map(p => `<div class="kpi"><div class="k">${esc(p.name)}</div><div class="v">${sold(p.id)}</div><div class="small muted">${money(p.price)} · ${esc(PASS_KINDS[p.kind] || '')}</div></div>`).join('') || '<p class="muted">No plans yet — add one in Settings.</p>'}</div>
    ${canIssue && plans.length ? `<div class="card" style="margin-bottom:16px"><h3>Issue a pass</h3><p class="small muted">Comp memberships, or ones paid at the counter. It's emailed to the holder.</p><div class="grid3" style="margin-top:10px">
      ${opRow('Plan', `<select class="inp" data-bind="ui.pf.planId">${plans.map(p => `<option value="${esc(p.id)}" ${f.planId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`)}${opRow('Holder email', `<input class="inp" data-bind="ui.pf.email" value="${esc(f.email)}">`)}${opRow('Holder name', `<input class="inp" data-bind="ui.pf.name" value="${esc(f.name)}">`)}</div>
      <button class="btn btn-dark btn-sm" data-action="passIssue">Issue pass</button></div>` : ''}
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Plan</th><th>Holder</th><th>Used</th><th>Left</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>
      ${passes.map(x => `<tr><td class="tnum"><b>${esc(x.code)}</b></td><td>${esc(x.plan_name)}</td><td class="small">${esc(x.name || '')}<div class="muted">${esc(x.email)}</div></td><td class="tnum">${x.used}</td><td class="tnum">${x.left == null ? '∞' : x.left}</td>
        <td class="small">${x.expires ? esc(fmtDate(x.expires, { month: 'short', day: 'numeric', year: 'numeric' })) : '—'}</td><td><span class="chip mini ${x.status === 'active' ? 'ok' : ''}">${esc(x.status)}</span></td>
        <td>${canIssue && x.status !== 'cancelled' ? `<a href="#" class="small" data-action="passCancel" data-id="${x.id}">cancel</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No passes issued yet.</td></tr>'}
    </tbody></table></div>`;
}
// §2 door sales: the manual-order screen in point-of-sale mode, then a receipt with the tickets to print or send
function Pos() {
  S.ui.mo ||= null;
  if (S.ui.posDone) return PosDone(S.ui.posDone);
  if (!S.ui.mo?.pos) S.ui.mo = { ev: posEvents()[0]?.id || S.adm.events[0]?.id, tt: '', qty: 1, slot: '', seats: [], adds: {}, name: '', email: '', phone: '', pay: 'cash', ref: '', send: true, code: '', price: '', comp: false, credit: '', pos: true, tender: '', deliver: 'print', reader: '' };
  if (!S.readers && !S._rdReq) { S._rdReq = 1; DB.readers().then(r => { S.readers = r; render(); }).catch(() => { S.readers = []; }); }
  return ManualOrder();
}
const posEvents = () => S.adm.events.filter(e => e.status === 'published' && !e.archived && D(e.end || e.start) > Date.now() - 864e5 && (can('door.sell', e.id) || can('orders.edit', e.id))).sort((a, b) => D(a.start) - D(b.start));
function PosDone(r) {
  const o = S.adm.orders.find(x => x.id === r.id), tks = S.adm.tickets.filter(t => t.order_id === r.id && t.status === 'valid'), vs = (S.adm.vouchers || []).filter(v => v.order_id === r.id);
  return `<div class="no-print">${head('Sale complete', `Order ${esc(o?.ref || r.ref)} · ${money(o?.data.total ?? r.total)}${r.change ? ` · <b>change due ${money(r.change)}</b>` : ''}`, `<button class="btn btn-dark" data-action="print">Print tickets</button><button class="btn btn-accent" data-action="posNew">New sale</button>`)}
    <p class="muted" style="margin-bottom:14px">${r.deliver === 'email' ? 'Tickets emailed to the customer.' : r.deliver === 'text' ? 'Ticket link texted to the customer.' : r.deliver === 'print' ? 'Print the tickets or show them on screen.' : ''} Inventory is already updated.</p></div>
    <div class="pos-print">${tks.map(t => { const ev = evById(t.event_id), sp = t.seat ? seatParts(ev, t.seat, t) : null;
      return `<div class="e-ticket"><div class="l"><div class="eyebrow" style="color:var(--accent)">${esc(ev?.ticketTypes.find(x => x.id === t.ticket_type_id)?.name || 'Ticket')}</div><h3 style="margin-top:6px">${esc(ev?.name || '')}</h3>
        <div class="small">${esc(fmtDT(startOf(ev, t.slot_id)))} · ${sp ? esc([sp.area, sp.unit, sp.row && 'Row ' + sp.row, sp.seat && 'Seat ' + sp.seat].filter(Boolean).join(' · ')) : 'General admission'}</div></div>
        <div class="r"><div class="qr" data-qr="${esc(t.code)}"></div><div class="code">${esc(t.code)}</div></div></div>`; }).join('')}
      ${vs.map(v => `<div class="e-ticket"><div class="l"><div class="eyebrow">Product voucher</div><h3 style="margin-top:6px">${esc(v.name)}</h3></div><div class="r"><div class="qr" data-qr="${esc(v.code)}"></div><div class="code">${esc(v.code)}</div></div></div>`).join('')}</div>`;
}
// Settings cards: gift cards, memberships, payment plans, self-service, selling on your own website
function SellingCards(s, f, c) {
  const plans = s.passPlans || [], ss = s.selfService || {}, emb = location.origin + location.pathname.replace(/index\.html$/, ''), slug = S.adm.bo.slug;
  const allTT = S.adm.events.flatMap(e => e.ticketTypes.map(t => ({ id: t.id, name: t.name, ev: e.name })));
  return `<div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Gift cards</div>${c('gifts.on', 'Sell gift cards on your box office page')}
      ${s.gifts?.on ? `<div class="grid2"><div class="field"><label class="fl">Fixed amounts ($)</label><input class="inp" data-input="giftAmts" value="${esc(S.ui.giftAmts ?? (s.gifts.amounts || []).map(v => v / 100).join(', '))}" placeholder="25, 50, 100"></div>${f('gifts.days', 'Valid for (days)', 'num', '0 = never expires')}</div>
        ${c('gifts.custom', 'Let buyers choose their own amount')}${s.gifts.custom ? `<div class="grid2">${f('gifts.min', 'Minimum', 'money')}${f('gifts.max', 'Maximum', 'money')}</div>` : ''}
        <p class="small muted">Gift cards work like credit: partial use, the balance carries over. Staff can also issue gift cards and vouchers in <a href="#/admin/passes/gifts">Gift cards & passes</a>.</p>` : ''}</div>
    <div class="card"><div class="between" style="margin-bottom:12px"><div class="eyebrow dash">Memberships & season passes</div><button class="btn btn-ghost btn-sm" data-action="planAdd">${ic('plus', 13)} Plan</button></div>
      ${plans.map((p, i) => `<div class="item-card"><div class="between"><b>${esc(p.name || 'Plan')}</b><button class="icon-btn" data-action="planDel" data-i="${i}" aria-label="Remove">${ic('x', 13)}</button></div>
        <div class="grid3">${f(`passPlans.${i}.name`, 'Name')}${f(`passPlans.${i}.price`, 'Price', 'money')}<div class="field"><label class="fl">Kind</label><select class="inp" data-bind="set.passPlans.${i}.kind">${Object.entries(PASS_KINDS).map(([k, t]) => `<option value="${k}" ${p.kind === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
        <div class="grid3"><div class="field"><label class="fl">Benefit</label><select class="inp" data-bind="set.passPlans.${i}.benefit" data-action-change="rr">${Object.entries(PASS_BENEFITS).map(([k, t]) => `<option value="${k}" ${p.benefit === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          ${p.benefit === 'discount' ? f(`passPlans.${i}.pct`, 'Discount %', 'num') : f(`passPlans.${i}.perEvent`, 'Per event (0 = no limit)', 'num')}${f(`passPlans.${i}.uses`, 'Number of uses (0 = unlimited)', 'num')}</div>
        <div class="grid3">${f(`passPlans.${i}.validDays`, 'Valid for (days)', 'num')}${f(`passPlans.${i}.validUntil`, 'Or valid until', 'date')}${f(`passPlans.${i}.max`, 'How many can be sold (0 = no limit)', 'num')}</div>
        ${f(`passPlans.${i}.desc`, 'Description')}
        <div class="targets"><div class="fl">Eligible events <span class="muted">(none = all)</span></div>${S.adm.events.map(e => setTog(`passPlans.${i}.eventIds`, e.id, esc(e.name))).join('')}</div>
        <div class="targets"><div class="fl">Eligible ticket types <span class="muted">(none = any)</span></div>${allTT.map(t => setTog(`passPlans.${i}.ticketTypeIds`, t.id, `${esc(t.name)} <span class="muted">· ${esc(t.ev)}</span>`)).join('')}</div>
        ${c(`passPlans.${i}.onSale`, 'On sale on the box office page')}</div>`).join('') || '<p class="small muted">Season passes (visits included), memberships (a member discount), multi-event and VIP passes. Members-only ticket types are set on each event.</p>'}</div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:12px">Payment plans</div>${c('installments.on', 'Let buyers pay in installments (card)')}
      ${s.installments?.on ? `<div class="grid2">${f('installments.minTotal', 'For orders from', 'money')}${f('installments.deposit', 'Deposit %', 'num')}</div><div class="grid2">${f('installments.count', 'Installments after the deposit', 'num')}${f('installments.finalDays', 'Paid in full this many days before the event', 'num')}</div>
        <p class="small muted">Seats stay held and tickets are issued with the last payment. Buyers get reminders 3 days before each one; you hear if the deadline passes. An event can switch it off (Controls & fees).</p>` : ''}</div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:6px">Customer self-service</div><p class="small muted" style="margin-bottom:10px">Everything is off unless you switch it on. Each event can override these (Controls & fees). Requests arrive in Customers → Inbox.</p>
      ${SELF_SERVICE.map(([k, t]) => `<label class="check" style="margin-bottom:6px"><input type="checkbox" data-bind="set.selfService.${k}" data-t="bool" ${ss[k] ? 'checked' : ''}> <span>${esc(t)}</span></label>`).join('')}</div>
    <div class="card"><div class="eyebrow dash" style="margin-bottom:6px">Sell on your own website</div><p class="small muted" style="margin-bottom:10px">Paste one line on any site (WordPress, Wix, Squarespace, Webflow). Buyers pick tickets and check out without leaving your site.</p>
      <div class="small"><b>1. Load the widget</b> (once per page)</div><pre class="code">&lt;script src="${esc(emb)}embed.js" async&gt;&lt;/script&gt;</pre>
      <div class="small"><b>Buy Tickets button</b> — opens checkout over your page</div><pre class="code">&lt;a href="${esc(emb)}#/e/EVENT-SLUG" data-set-tickets="EVENT-SLUG"&gt;Buy tickets&lt;/a&gt;</pre>
      <div class="small"><b>Event list</b></div><pre class="code">&lt;div data-set-widget="list" data-box-office="${esc(slug)}"&gt;&lt;/div&gt;</pre>
      <div class="small"><b>Ticket selector</b> (compact) or <b>full event widget</b></div><pre class="code">&lt;div data-set-widget="tickets" data-event="EVENT-SLUG"&gt;&lt;/div&gt;
&lt;div data-set-widget="event" data-event="EVENT-SLUG"&gt;&lt;/div&gt;</pre><p class="small muted">Each event's own snippets are on its Share & embed tab.</p></div>`;
}
const setTog = (path, v, label) => { const on = (getPath(S.ui.set, path) || []).map(String).includes(String(v));
  return `<label class="check small tog"><input type="checkbox" data-action="setTog" data-path="${esc(path)}" data-v="${esc(v)}" ${on ? 'checked' : ''}> <span>${label}</span></label>`; };
// event editor: purchase rules (§7)
function RulesEditor(ev) {
  const rules = ev.rules || [];
  return `<div class="item-card"><div class="between"><div><b>Purchase rules</b><div class="small muted">Ticket B only with ticket A, children need an adult, minimum / maximum across several types. Product rules (e.g. only with VIP) are on Products & packages.</div></div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="ruleAdd">${ic('plus', 13)} Rule</button></div>
    ${rules.map((r, i) => `<div class="rule-box"><div class="between"><select class="inp inp-sm" style="width:auto" data-bind="draft.rules.${i}.kind" data-action-change="rr">${Object.entries(RULE_KINDS).map(([k, t]) => `<option value="${k}" ${r.kind === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button type="button" class="icon-btn" data-action="delRule" data-path="rules" data-i="${i}" aria-label="Remove">${ic('x', 13)}</button></div>
      <div class="targets"><div class="fl">${r.kind === 'requires' ? 'These tickets…' : 'Ticket types counted together'}</div>${ev.ticketTypes.map(t => tog(`rules.${i}.ttIds`, t.id, esc(t.name))).join('')}</div>
      ${r.kind === 'requires' ? `<div class="targets"><div class="fl">…need one of these in the same order</div>${ev.ticketTypes.map(t => tog(`rules.${i}.needs`, t.id, esc(t.name))).join('')}</div>
        <div class="grid2">${inp(`rules.${i}.per`, 'One needed ticket for every', { t: 'int', hint: '0 = just at least one; 2 = one adult per 2 children' })}${inp(`rules.${i}.message`, 'Message to buyers (optional)')}</div>`
        : `<div class="grid3">${inp(`rules.${i}.min`, 'Minimum in total', { t: 'int' })}${inp(`rules.${i}.max`, 'Maximum in total', { t: 'int' })}${inp(`rules.${i}.message`, 'Message (optional)')}</div>`}</div>`).join('')}</div>`;
}
// event Controls & fees tab: payment plans + self-service for this event
function EventSelfCard(ev) {
  const bo = S.adm.bo.settings, v = k => ev.selfService?.[k] === true ? 'on' : ev.selfService?.[k] === false ? 'off' : '';
  return `<div class="card"><h3>Payment plans & customer self-service</h3>
    <label class="check" style="margin:8px 0"><input type="checkbox" data-bind="draft.installments.off" data-t="bool" ${ev.installments?.off ? 'checked' : ''}> <span>No payment plans for this event${bo.installments?.on ? '' : ' <span class="muted">(off for the whole box office anyway)</span>'}</span></label>
    <div class="grid2">${SELF_SERVICE.map(([k, t]) => `<div class="field"><label class="fl">${esc(t)}</label><select class="inp" data-action-change="evSelf" data-k="${k}"><option value="" ${!v(k) ? 'selected' : ''}>Box office setting (${bo.selfService?.[k] ? 'on' : 'off'})</option><option value="on" ${v(k) === 'on' ? 'selected' : ''}>On for this event</option><option value="off" ${v(k) === 'off' ? 'selected' : ''}>Off for this event</option></select></div>`).join('')}</div></div>`;
}

Object.assign(A, {
  giftAmt: el => { S.ui.gift.amount = +el.dataset.v; S.ui.gift.custom = ''; render(); },
  giftAdd: el => { const bo = S.bos.find(b => b.id === el.dataset.bo), g = S.ui.gift, amount = g.custom ? Math.round(parseFloat(g.custom) * 100) : g.amount;
    const e = giftErr(bo.settings, { amount, toEmail: g.toEmail }); if (e) return toast(e, true); if (!cartFor(bo)) return;
    S.cart.gifts.push({ amount, to: g.to.trim(), toEmail: g.toEmail.trim(), message: g.message.trim() }); S.ui.gift = null; saveCart(); location.hash = '#/cart'; },
  passAdd: el => { const bo = S.bos.find(b => b.id === el.dataset.bo); if (!cartFor(bo)) return; const x = S.cart.passes.find(p => p.planId === el.dataset.v);
    if (x) x.qty++; else S.cart.passes.push({ planId: el.dataset.v, qty: 1 }); saveCart(); location.hash = '#/cart'; },
  delGP: el => { (S.cart[el.dataset.k] || []).splice(+el.dataset.i, 1); saveCart(); render(); },
  openPass: () => { S.co.passOpen = true; render(); },
  applyPass: async () => { const bo = cartBo(); try { const r = await DB.checkPass(bo?.id, S.co.passCode, S.co.email); if (!r || r.error) return toast(r?.error || 'That code is not valid', true); S.co.pass = r; S.co.passOpen = false; render(); } catch (e) { toast(e.message, true); } },
  removePass: () => { S.co.pass = null; render(); },
  payInst: async () => { const o = S.order; if (!o?.order) return;
    try { const r = await DB.payInstallment(o.order.id, S.route.params[1], S.ui.inst || {});
      if (r?.clientSecret) { S.co.pay = { ...r, id: o.order.id, key: S.route.params[1], ref: o.order.ref, installment: true, expires_at: new Date(Date.now() + 36e5).toISOString() }; location.hash = '#/cart'; return; }
      S.ui.inst = null; toast(r?.status === 'paid' ? 'Paid in full — your tickets are issued' : 'Payment received — thank you'); loadOrder(o.order.id, S.route.params[1]); } catch (e) { toast(e.message, true); } },
  walletAdd: el => { const o = S.order, t = o?.tickets.find(x => x.id === el.dataset.id); if (!t) return;
    if (DB.live) { location.href = walletUrl(el.dataset.v, o.order.id, S.route.params[1], t.id); return; }
    const ev = evById(t.event_id) || { name: '', ticketTypes: [] }, c = { ...walletCard(ev, t, o.order), org: S.settings.name };
    modal(el.dataset.v === 'apple' ? 'Add to Apple Wallet' : 'Save to Google Wallet', `${WalletPreview(c, el.dataset.v)}<p class="small muted" style="margin-top:12px">Demo preview. On the live site this downloads the real pass; if the ticket is cancelled or replaced, the pass on the phone updates to show it's no longer valid.</p>`, '<button class="btn btn-dark" data-action="closeModal">Done</button>'); hydrate(); },
  selfRename: el => { const t = S.order?.tickets.find(x => x.id === el.dataset.id); S.ui.ss = { action: 'rename', ticket: el.dataset.id, name: t?.holder || '' };
    modal('Change the name on this ticket', `<div class="field"><label class="fl">New name</label><input class="inp" data-input="ss.name" value="${esc(S.ui.ss.name)}"></div>`, '<button class="btn btn-dark" data-action="selfGo">Save</button>'); },
  selfTransfer: el => { S.ui.ss = { action: 'transfer', ticket: el.dataset.id, name: '', email: '' };
    modal('Transfer this ticket', `<p class="small muted" style="margin-bottom:10px">The new holder gets a new ticket by email. Your copy of this ticket stops working.</p><div class="field"><label class="fl">Their name</label><input class="inp" data-input="ss.name"></div><div class="field"><label class="fl">Their email</label><input class="inp" type="email" data-input="ss.email"></div>`, '<button class="btn btn-dark" data-action="selfGo">Transfer ticket</button>'); },
  selfReq: el => { S.ui.ss = { action: el.dataset.v, body: '' };
    modal(SELF_REQUESTS[el.dataset.v], `<div class="field"><label class="fl">Tell the box office what you need</label><textarea class="inp" rows="4" data-input="ss.body"></textarea></div>`, '<button class="btn btn-dark" data-action="selfGo">Send request</button>'); },
  selfResend: async () => { S.ui.ss = { action: 'resend' }; return A.selfGo(); },
  selfGo: async () => { const o = S.order, ss = S.ui.ss; if (!o?.order || !ss) return;
    try { await DB.selfService(o.order.id, S.route.params[1], ss.action, ss); $('#modal').innerHTML = ''; S.ui.ss = null;
      toast({ rename: 'Name changed', transfer: 'Ticket transferred — the new holder has been emailed', resend: 'Your tickets are on their way', seatChange: 'Request sent', cancel: 'Request sent', refund: 'Request sent' }[ss.action]); loadOrder(o.order.id, S.route.params[1]); } catch (e) { toast(e.message, true); } },
  planAdd: () => { (S.ui.set.passPlans ||= []).push({ id: shortId('pp_'), name: 'New membership', kind: 'membership', price: 5000, desc: '', benefit: 'discount', pct: 10, uses: 0, perEvent: 0, eventIds: [], ticketTypeIds: [], validDays: 365, onSale: true, max: 0 }); render(); },
  planDel: el => { S.ui.set.passPlans.splice(+el.dataset.i, 1); render(); },
  setTog: el => { const path = el.dataset.path, v = el.dataset.v, list = (getPath(S.ui.set, path) || []).filter(x => String(x) !== String(v)); if (el.checked) list.push(v); setPath(S.ui.set, path, list); render(); },
  ruleAdd: () => { (S.draft.rules ||= []).push({ id: shortId('ru_'), kind: 'requires', ttIds: [], needs: [], per: 0, message: '' }); dirty(); render(); },
  passIssue: async () => { const f = S.ui.pf; try { const r = await DB.passAction('issue', { planId: f.planId, email: f.email, name: f.name }); S.ui.pf = null; await reloadAdmin(); toast(`Pass ${r.code} issued`); } catch (e) { toast(e.message, true); } },
  passCancel: async el => { try { await DB.passAction('cancel', { id: el.dataset.id }); await reloadAdmin(); toast('Pass cancelled'); } catch (e) { toast(e.message, true); } },
  giftIssue: async () => { const f = S.ui.pf; try { const r = await DB.creditAction('issue', { kind: f.kind, email: f.email, name: f.name, amount: opDollars(f.amount), eventId: f.eventId || null, expires: f.expires ? new Date(f.expires + 'T23:59').toISOString() : null });
    S.ui.pf = null; await reloadAdmin(); toast(`${CREDIT_KINDS[r.kind] || 'Gift card'} ${r.code} issued`); } catch (e) { toast(e.message, true); } },
  posPay: el => { S.ui.mo.pay = el.dataset.v; render(); },
  moDeliver: el => { S.ui.mo.deliver = el.dataset.v; render(); },
  posNew: () => { S.ui.posDone = null; S.ui.mo = null; render(); },
  posSell: async () => {
    const m = S.ui.mo, ev = evById(m.ev), { items, addons } = S.ui.moItems || {}; if (!ev) return;
    if (!items?.length && !addons?.length) return toast(ev.seating?.enabled ? 'Pick seats on the map' : 'Choose tickets', true);
    if (m.deliver === 'email' && !EMAIL_RE.test(m.email.trim())) return toast('Enter the customer\'s email to email the tickets', true);
    if (m.deliver === 'text' && !normPhone(m.phone)) return toast('Enter the customer\'s mobile number', true);
    const card = m.pay === 'card' && !m.comp, email = m.email.trim() || `door-sale@${S.adm.bo.slug}.invalid`;
    try {
      const r = await DB.placeOrder({ buyer: { name: m.name.trim() || 'Walk-up guest', email, phone: m.phone || '' }, items, addons, payment: card ? 'terminal' : 'manual', pos: true, comp: !!m.comp, code: m.comp ? '' : m.code,
        payMethod: m.pay === 'card' ? 'terminal' : m.pay, payRef: m.ref, send: m.deliver === 'email', smsTickets: m.deliver === 'text', source: 'door' }, true);
      if (card && r.status === 'awaiting_payment') { toast('Tap, insert or swipe the card on the reader…'); await DB.terminalPay(r.id, m.reader || S.readers?.[0]?.id); }
      await reloadAdmin(); const total = S.adm.orders.find(o => o.id === r.id)?.data.total ?? r.total;
      S.ui.posDone = { ...r, deliver: m.deliver, change: m.pay === 'cash' && m.tender ? Math.max(0, Math.round(parseFloat(m.tender) * 100) - total) : 0 }; S.ui.mo = null; render();
    } catch (e) { toast(e.message, true); }
  },
});
Object.assign(CHANGE, {
  evSelf: el => { const ss = S.draft.selfService ||= {}; if (el.value === 'on') ss[el.dataset.k] = true; else if (el.value === 'off') ss[el.dataset.k] = false; else delete ss[el.dataset.k]; dirty(); render(); },
});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
boot();
