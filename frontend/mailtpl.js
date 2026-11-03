/* SET message templates — ONE renderer for the app's previews and the messaging Edge Function (which imports a byte-identical copy at
   supabase/functions/_shared/mailtpl.js; tests/stage8-e2e.html checks the two match). Plain script, no dependencies.
   render(m, ctx, opts) → { subject, html, text, sms }
     m   = an outbox row (kind, channel, category, subject, body, vars)
     ctx = { bo:{name, slug, branding, mail}, event, order:{id, key, ref, buyer, events[]}, tickets:[{event_id, type, area, row, seat, unit, code}], contact:{name, token} }
     opts = { appUrl } — the public app address the links point at.
   Every value from the data is escaped; staff-written text becomes paragraphs, its links clickable. Placeholders: {{first_name}} … (MSG_VARS). */
(function (root) {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const HEX = /^#[0-9a-f]{6}$/i;
  const ORDER_KINDS = ['confirmation', 'confirmation_copy', 'tickets', 'updated'];
  const tzOk = tz => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; } };
  const when = (iso, tz, o) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; return d.toLocaleString('en-US', { ...o, timeZone: tzOk(tz) ? tz : 'America/New_York' }); };
  const slotStart = (ev, slotId) => (ev?.timeSlots || []).find(s => s.id === slotId)?.start || ev?.start;
  function vars(m, ctx, opts) {
    const app = String(opts?.appUrl || '').replace(/#.*$/, ''), ev = ctx.event || null, o = ctx.order || null, bo = ctx.bo || {};
    const name = (o?.buyer?.name || ctx.contact?.name || '').trim(), start = slotStart(ev, ctx.tickets?.[0]?.slot_id);
    return { first_name: name.split(/\s+/)[0] || 'there', name: name || 'there', event: ev?.name || (o?.events || []).map(e => e.name).join(' & ') || bo.name || '',
      date: when(start, ev?.timezone, { weekday: 'long', month: 'long', day: 'numeric' }), time: when(start, ev?.timezone, { hour: 'numeric', minute: '2-digit' }),
      venue: [ev?.venue, ev?.address].filter(Boolean).join(', '), doors: ev?.doors || when(start, ev?.timezone, { hour: 'numeric', minute: '2-digit' }), order_ref: o?.ref || '',
      tickets_link: o ? `${app}#/order/${o.id}/${o.key}` : '', event_link: ev?.slug ? `${app}#/e/${ev.slug}` : bo.slug ? `${app}#/b/${bo.slug}` : app,
      box_office: bo.name || '', promo_code: m.vars?.promo_code || '', link: m.vars?.link || '', unsubscribe_link: ctx.contact?.token ? `${app}#/unsubscribe/${ctx.contact.token}` : '' };
  }
  const fill = (s, v) => String(s || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k) => v[k] ?? '');
  // staff text → paragraphs; https links become links (escaped, nothing else becomes HTML)
  const paras = t => String(t || '').trim().split(/\n{2,}/).filter(Boolean).map(p => `<p style="margin:0 0 14px">${esc(p).replace(/(https:\/\/[^\s<]+)/g, u => `<a href="${u}" style="color:inherit">${u}</a>`).replace(/\n/g, '<br>')}</p>`).join('');
  const DEFAULTS = {
    confirmation: ['Your tickets — {{event}}', 'Hi {{first_name}}, thank you for your order {{order_ref}}. Your tickets are below — show the QR code on your phone or print them.'],
    confirmation_copy: ['Your tickets — {{event}}', 'Hi {{first_name}}, here is your order {{order_ref}} again. Your tickets are below.'],
    tickets: ['Your tickets — {{event}}', 'Hi {{first_name}}, here are your tickets for order {{order_ref}}.'],
    updated: ['Your updated tickets', 'Your tickets have changed. Your new tickets are below — the old ones no longer work.'],
    waitlist: ['Tickets are available: {{event}}', 'Good news — tickets for {{event}} are available. Book here: {{event_link}}'],
  };
  function render(m, ctx, opts = {}) {
    const v = vars(m, ctx, opts), d = DEFAULTS[m.kind] || [], bo = ctx.bo || {}, br = bo.branding || {};
    // an event's own confirmation email (Stage 10): subject + header when the order is for that one event
    const own = ORDER_KINDS.includes(m.kind) && ctx.order?.events?.length === 1 ? ctx.order.events[0].email || null : null;
    const subject = fill(m.subject || (m.kind === 'confirmation' && own?.subject) || d[0] || bo.name, v).slice(0, 200), body = fill(m.body || d[1] || '', v), marketing = m.category === 'marketing';
    const header = own?.header ? fill(own.header, v).slice(0, 200) : subject;
    if (m.channel === 'sms') {
      const t = `${bo.name ? bo.name + ': ' : ''}${body}`.replace(/\s+\n/g, '\n').trim();
      return { subject: '', html: '', text: t, sms: marketing ? t + ' Reply STOP to opt out.' : t };
    }
    const ink = HEX.test(br.ink || '') ? br.ink : '#020a16', accent = HEX.test(br.accent || '') ? br.accent : '#f4cd5e';
    const showTickets = ORDER_KINDS.includes(m.kind) && ctx.order, tks = showTickets ? ctx.tickets || [] : [];
    const evs = showTickets ? (ctx.order.events || []) : [];
    const table = evs.map(e => { const mine = tks.filter(t => t.event_id === e.id); if (!mine.length) return '';
      return `<div style="border:1px solid #e3e6ea;border-radius:10px;padding:14px 16px;margin:0 0 14px"><div style="font-weight:700">${esc(e.name)}</div>
        <div style="font-size:13px;color:#5b6472;margin:2px 0 10px">${esc(when(e.start, ctx.event?.timezone, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))} · ${esc([e.venue, e.address].filter(Boolean).join(', '))}</div>
        ${e.confirmation ? `<p style="font-size:13px;margin:0 0 10px">${esc(e.confirmation)}</p>` : ''}
        ${[['instructions', 'Your tickets'], ['venue', 'Getting there']].map(([k, t]) => e.email?.[k] ? `<p style="font-size:13px;margin:0 0 10px"><b>${t}:</b> ${esc(e.email[k])}</p>` : '').join('')}
        <table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px"><tr style="text-align:left;color:#5b6472"><th style="padding:4px 0">Ticket type / Area</th><th>Row</th><th>Seat</th><th>Ticket no.</th></tr>
        ${mine.map(t => `<tr style="border-top:1px solid #eef0f3"><td style="padding:6px 0">${esc(t.area && t.area !== t.type ? [t.type, t.area].filter(Boolean).join(' · ') : t.type || 'Ticket')}</td><td>${esc(t.row || '—')}</td><td>${esc(t.unit ? `${t.unit} · ${t.seat || ''}` : t.seat || 'General')}</td><td style="font-family:monospace">${esc(t.code)}</td></tr>`).join('')}</table>
        ${e.email?.policies && e.policies ? `<p style="font-size:12px;color:#5b6472;margin:10px 0 0"><b>Policies:</b> ${esc(e.policies)}</p>` : ''}
        ${e.email?.sponsor ? `<p style="font-size:12px;color:#5b6472;margin:8px 0 0">${esc(e.email.sponsor)}</p>` : ''}${e.email?.contact ? `<p style="font-size:12px;margin:8px 0 0">${esc(e.email.contact)}</p>` : ''}</div>`; }).join('');
    const btn = (href, label) => href ? `<p style="margin:18px 0"><a href="${esc(href)}" style="display:inline-block;background:${ink};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${esc(label)}</a></p>` : '';
    const why = marketing ? `You are receiving this because you opted in to news from ${esc(bo.name)}.${v.unsubscribe_link ? ` <a href="${esc(v.unsubscribe_link)}" style="color:#5b6472">Unsubscribe or change preferences</a>.` : ''}`
      : m.category === 'staff' ? 'Staff notification from SET.' : `You are receiving this about ${v.order_ref ? 'your order ' + esc(v.order_ref) : 'your booking'} with ${esc(bo.name)}.`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#f4f5f7;font-family:Inter,Helvetica,Arial,sans-serif;color:#111827">
<div style="max-width:600px;margin:0 auto;padding:24px 16px"><div style="background:${ink};color:#fff;border-radius:12px 12px 0 0;padding:16px 22px;font-weight:800;letter-spacing:.04em;border-bottom:3px solid ${accent}">${esc(bo.name || 'SET')}</div>
<div style="background:#fff;border-radius:0 0 12px 12px;padding:22px;line-height:1.5;font-size:15px"><h1 style="font-size:20px;margin:0 0 14px">${esc(header)}</h1>${paras(body)}${table}
${showTickets ? btn(v.tickets_link, 'View & download your tickets') : ''}</div>
<p style="font-size:12px;color:#5b6472;text-align:center;margin:16px 8px">${why}</p></div></body></html>`;
    const text = [subject, '', body, ...(showTickets ? ['', ...tks.map(t => `${t.type || 'Ticket'}${t.area ? ' · ' + t.area : ''}${t.row ? ' · Row ' + t.row : ''}${t.seat ? ' · Seat ' + t.seat : ''} — ${t.code}`), '', 'Your tickets: ' + v.tickets_link] : []),
      '', marketing ? `Unsubscribe: ${v.unsubscribe_link}` : ''].join('\n').trim();
    return { subject, html, text, sms: '' };
  }
  const api = { render, fill, vars, esc, ORDER_KINDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MailTpl = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
