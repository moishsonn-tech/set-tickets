/* SET embeddable ticket sales (Final additions §10). Load once on any website:
     <script src="https://…/embed.js" async></script>
   then use any of:
     <a href="…#/e/SLUG" data-set-tickets="SLUG">Buy tickets</a>       → opens checkout over the page (no leaving the site)
     <div data-set-widget="list" data-box-office="BOX-OFFICE-SLUG"></div> → the box office's events
     <div data-set-widget="tickets" data-event="SLUG"></div>              → just the ticket selector (checkout continues inside)
     <div data-set-widget="event" data-event="SLUG"></div>                → the full event page with checkout
   Frames resize themselves (the app posts its height). No cookies, no tracking of the host page. */
(function () {
  'use strict';
  var me = document.currentScript || [].slice.call(document.scripts).filter(function (s) { return /embed\.js(\?|$)/.test(s.src); }).pop();
  var base = me ? me.src.replace(/embed\.js(\?.*)?$/, '') : '';
  var slug = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, ''); };
  var url = function (hash) { return base + 'index.html' + hash; };
  var frames = [];
  function frame(src, minH) {
    var f = document.createElement('iframe');
    f.src = src; f.title = 'Tickets'; f.loading = 'lazy'; f.allow = 'payment';
    f.style.cssText = 'width:100%;border:0;display:block;min-height:' + (minH || 420) + 'px;background:transparent';
    frames.push(f); return f;
  }
  window.addEventListener('message', function (e) {
    var d = e.data; if (!d || d.setTickets !== 'height' || base.indexOf(e.origin) !== 0) return;
    frames.forEach(function (f) { if (f.contentWindow === e.source) f.style.height = Math.max(200, Math.min(+d.h || 0, 6000)) + 'px'; });
  });
  function overlay(s) {
    var bg = document.createElement('div');
    bg.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(2,10,22,.55);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 12px';
    var box = document.createElement('div');
    box.style.cssText = 'position:relative;width:min(1100px,100%);background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.35);overflow:hidden';
    var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
    x.style.cssText = 'position:absolute;top:8px;right:10px;z-index:2;width:36px;height:36px;border:0;border-radius:50%;background:#020a16;color:#fff;font-size:22px;cursor:pointer';
    var close = function () { bg.remove(); document.removeEventListener('keydown', esc); };
    var esc = function (e) { if (e.key === 'Escape') close(); };
    x.onclick = close; bg.onclick = function (e) { if (e.target === bg) close(); }; document.addEventListener('keydown', esc);
    box.appendChild(x); box.appendChild(frame(url('#/embed/' + s), 640)); bg.appendChild(box); document.body.appendChild(bg);
  }
  function mount(root) {
    (root || document).querySelectorAll('[data-set-tickets]').forEach(function (a) {
      if (a.dataset.setReady) return; a.dataset.setReady = '1';
      a.addEventListener('click', function (e) { var s = slug(a.dataset.setTickets); if (!s) return; e.preventDefault(); overlay(s); });
    });
    (root || document).querySelectorAll('[data-set-widget]').forEach(function (el) {
      if (el.dataset.setReady) return; el.dataset.setReady = '1';
      var k = el.dataset.setWidget, s = slug(el.dataset.event), b = slug(el.dataset.boxOffice);
      var src = k === 'list' && b ? url('#/embed-list/' + b) : k === 'tickets' && s ? url('#/embed/' + s + '?compact=1') : s ? url('#/embed/' + s) : '';
      if (src) el.appendChild(frame(src, k === 'tickets' ? 380 : 600));
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mount(); }); else mount();
  window.SETTickets = { mount: mount, open: function (s) { overlay(slug(s)); } };
})();
