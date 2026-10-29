# SET — SING Entertainment Tickets

Ticketing platform for SING Entertainment (singentertainment.net), built as a full replacement for
Ticket Tailor (which SING uses today via buytickets.at). Brand: the "set" wordmark is cut from SING's own
logo lettering (`frontend/set-logo.svg`); navy `#020a16` + one gold accent `#f4cd5e`; Anton display + Inter.

## Architecture (this project's deviations from the kit template below)
- **Frontend:** `frontend/index.html` (shell + CSS) + `data.js` (data layer) + `app.js` (UI). Vanilla JS,
  no build. Hash routes: `#/` box office, `#/e/<slug>` event, `#/cart`, `#/order/<id>/<key>` ticket wallet,
  `#/tickets` lookup, `#/embed/<slug>` iframe widget, `#/admin/...` organizer back office.
- **Backend = Supabase** (no proxy.js). `supabase/schema.sql` = tables + RLS + RPCs. Buyers never write
  tables: `place_order()` re-prices every line, enforces inventory / time-slot / seat capacity under a
  per-event advisory lock, and validates discount codes. Event passwords + discount codes live in
  `events.secrets`, which anon cannot select. Organizers = rows in `team` (role-gated RLS).
- **Two modes, one interface (`DB.*`):** blank `config.js` → DEMO (sample data in localStorage, same rules
  run in JS in `demoPlaceOrder`); filled `config.js` → LIVE Supabase. Keep the JS and SQL rules in sync.
- **Money is integer cents everywhere.** `quote()` in data.js is the one pricing function on the client.
- **Not yet wired:** Stripe card payments (needs a Supabase Edge Function + webhook), outbound email/SMS
  (confirmations, reminders, broadcasts are recorded but not sent), Apple Wallet passes.

## Run locally
`cd frontend && python3 -m http.server 8765` → http://localhost:8765 (organizer side: /#/admin).

## Deploy
Live at https://moishsonn-tech.github.io/set-tickets/ (public repo moishsonn-tech/set-tickets).
`bash deploy/publish.sh` pushes main and force-pushes `frontend/` as the `gh-pages` branch, which Pages serves.
No GitHub Actions: the saved gh token for moishsonn-tech lacks the `workflow` scope, so a workflow file in the
repo makes every push fail. Scanner app = `#/scan` (phone cameras require the https site).

---

# App Starter Kit — Engineering Guide (CLAUDE.md)

> This file is loaded into every Claude Code session for this project. It encodes the
> owner's build style so a fresh session — on any machine, any git account, with no prior
> memory — builds the same way. **Read Engineering Priorities + Security + PR Process before
> planning any change.** Replace every `<PLACEHOLDER>` when you adopt this kit.

## What this is
A starting template for a single-author internal/ops web tool. Two deployables:
- **Frontend:** one static `frontend/index.html` — **vanilla JS, no build step, no framework.**
  Global `S` state object; `render()` rebuilds views via `innerHTML`; delegated `data-action`
  handlers; `data-field`→form-model input mapping; `esc()` on ALL HTML interpolation. PWA
  (manifest + icons + service worker). Data via a backend proxy and/or a hosted DB over REST.
- **Backend:** `backend/proxy.js` — Node, **no dependencies**. Holds all third-party API keys
  server-side, gates every `/api/*` route behind verified auth, encrypts secrets at rest.

Deploy = SFTP a single file up (`deploy/deploy-index.js` / `deploy-proxy.js`). Never hand-roll SFTP.

Wiring in any third-party capability (email, payments, maps, browser automation, scheduled jobs,
LLM, push, PDF…)? **Read `INTEGRATIONS.md` first** — it catalogs every option with the proven
picks and the gotchas already paid for.

## Deploy discipline (learned the hard way)
The deploy scripts OVERWRITE the live file with the local copy. If the live file was ever
hot-patched in place (emergency fix applied directly on the server), a deploy from a stale local
template silently regresses production. Rules:
- Every change lands in the repo copy FIRST; hot patches on the server are an emergency measure
  that must be back-ported to the repo the same day.
- Before any backend deploy, diff the live file against the local one (download it or `ssh cat`);
  investigate any difference you didn't write.
- Take a dated server-side backup (`proxy.js.bak-YYYYMMDD`) before overwriting.

---

## Engineering Priorities (read before planning any PR)
1. **Elegance.** Completely, directly, simply solve the problem. Reuse an existing convention
   over inventing one; delete/strangle bad patterns rather than duplicate them. No band-aids
   that leave the root cause in place.
2. **Limit blast radius.** Fewest call sites, local + additive + reversible changes; preserve
   out-of-scope behavior. Replace patterns strangler-fig (new path beside old → migrate → remove
   old last), never big-bang rewrites.
3. **Scope in user-meaningful arcs.** An arc = the minimum to end-to-end test a real user-facing
   capability against the REAL thing (no mocks/sims). Atomic commits; tightly-scoped PRs; split
   sequential work into ordered waves.
4. **Double-review high-risk work** (agent-review team + your own hand) before merge.
5. **Verify on the REAL app** (browser/backend), not just that it compiles. Report outcomes
   faithfully — if something is unverified, say so.
6. **Single source of truth.** Before adding state/a collection, confirm the concept isn't already
   owned somewhere. Never create a second source of truth.

## Security (non-negotiable)
- **HTTPS everywhere, always.** Never ship plain HTTP. Static hosts give automatic TLS; on a
  server use nginx + Let's Encrypt with a force-HTTPS redirect + HSTS. See SETUP.md.
- **Never trust the client.** The server validates everything. Any client-side gate (e.g. a PIN)
  is convenience only and must NOT be the real authorization boundary.
- **Secrets live server-side only.** API keys never reach the browser — the proxy injects them.
  Encrypt sensitive tokens at rest (AES-256-GCM; key in a separate `0600` file or a secrets store).
- **Gate every `/api/*` route** behind verified auth (e.g. a verified identity-provider ID token,
  signature-checked, with issuer/audience/expiry + an allowlist). Mark privileged routes admin-only.
- **Lock CORS** to the app's own origin (not `*`). **Rate-limit** the proxy.
- **Guard against SSRF** on any server-side fetch (allowlist hosts, block private IPs).
- **Hardware/financial-control APIs (e.g. vehicle command, payments): treat the signing/secret key
  as a crown jewel** — server-only, encrypted, admin-gated, rate-limited, audit-logged, with explicit
  confirmation for actuating commands; request minimum OAuth scopes; never log tokens.

## UI aesthetic (corporate/professional SaaS, never cheesy)
- One brand accent color used sparingly (active states, primary actions); everything else a neutral
  gray/off-white scale with tiered text hierarchy. Pick concrete colors per project.
- Soft depth, not gloss: small-to-medium radius, low-opacity layered shadows, hairline borders.
- Typography: Inter/system for body; a distinct display face for big numbers/titles; UPPERCASE
  micro-labels with letter-spacing for stat labels / table headers / section labels. Antialiased.
- Data-dense but breathable; subtle ~.15–.2s transitions and tiny hover lift only.
- Mobile = native-app feel (bottom nav, safe-area insets, bottom-sheet modals), not a shrunk desktop.
- Avoid: loud gradients, neon glows, shadow overload, decorative emoji chrome, blobby shapes,
  comic fonts, skeuomorphism, gimmicky animation. When unsure, choose the more restrained option.

## When to abandon "no build step"
No-build single-file is correct for internal tools with known/trusted users, and scales to many
users — user COUNT doesn't force a build. Step up to a real framework + build step when the app
gains: untrusted external users, a large/growing feature set, hard first-load performance needs,
public/SEO pages, npm UI libraries, or multiple developers. The line is COMPLEXITY + UNTRUSTED
USERS, not user count. For untrusted users the real change is the SECURITY/auth architecture.

## Communication: explain big decisions
For any significant decision (architecture, security tradeoff, tooling pick, anything non-trivial),
explain it in simple English first — WHAT and WHY — then give the technical term(s) in parentheses,
and define jargon inline. Keep it a natural parenthetical, not a lecture. Ask fewer questions; act on
routine choices, but explain the meaningful ones.

## PR Process
1. Re-read the priorities + security rules above.
2. Plan the arc: capability, minimum features to e2e-test it for real, atomic commits, waves.
3. Assess blast radius: list call sites touched + what could break; mark high-risk for double-review.
4. Implement (elegance + blast-radius rules).
5. Review the diff: correctness, scope creep, SSOT violations, security.
6. Test against the real deployed app; loop-fix until green.
7. Verify live, then deploy via the deploy scripts.
