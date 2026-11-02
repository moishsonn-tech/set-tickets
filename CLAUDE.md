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
- **Multi-tenant (Stage 1):** every event/order/ticket belongs to one **box office** (`box_offices`). Staff are
  `members` rows (box office + email) with an explicit permission list (`PERMS` in data.js, "group.key") and
  optional event scoping; templates are just named starting lists. `hasPerm()` (JS) / `has_perm()` (SQL) is the
  single gate; owner + platform super admins (`platform_admins`) pass everything. Customer details and money are
  masked server-side (`admin_load()` / `DB.loadAdmin`) by permission. `audit_log` is append-only. Super Admin
  dashboard = `#/platform`; a box office's public page = `#/b/<slug>`; self-registration `#/register` (off).
  DEMO enforces the same rules in `need()` before every write. 2FA = TOTP (Supabase MFA live, `totp()` demo).
- **Events (Stage 2):** lifecycle helpers in data.js — `eventLive()` (published, not archived/hidden, past `publishAt`) /
  `eventListed()` (+ visibility `public`; `link` events load via `event_by_slug`), `salesOpen()`, `slotState()` for
  showtimes (`timeSlots` with hidden/unavailable/soldOut), `sellout()` = potential revenue at face value. Event
  templates live on the box office (`eventToTemplate` / `eventFromTemplate` / `cloneEventStructure`). Comps keep the
  real ticket type with `face` value and `unit: 0`. Audit rows carry `target` (event id) → per-event History tab.
- **Seating (Stage 3):** the layout lives in `event.seating` (sections: rows | table | booth | ga standing area; levels; per-seat
  `prices` / `areas` / `labels` / `removed` overrides keyed by seat id). `seatDerive()` builds what the server checks — `index`
  (seat → ticket type), `meta` (seat → [area, row, seat label], copied onto every ticket as `area`/`row`/`seat_label`) and `rows`
  (for the single-seat gap rule `singleGaps()` / SQL `single_gaps()`). Seat ids come from row labels + numbers, so renaming rows goes
  through `remapSeatKeys()`. Blocks, staff holds, "unavailable" and buyers' 10-minute checkout holds are `seat_status` rows (never in
  the event) — `seatStates()` merges them with tickets; staff change them via `seatAction()` / `seat_action()`. Every seat change is in
  `seat_log`. Master venue charts are `box_offices.venues`; `venueToEvent()` copies one into an event (tiers matched to ticket types by name).
- **Pricing & promotions (Stage 4):** `quote()` in data.js is the one pricing engine (display everywhere, authoritative in DEMO); SQL
  `price_cart()` / `apply_promo()` mirror it line for line — change both. Ticket price = showtime price (`slotPrices`) or base, replaced by the
  first active `phases` entry (dates + `upTo` sold), then a lower `breaks` quantity price; a phase ending mid-order splits the line. Staff
  override = item `price` on manual orders (`tickets.pricing`); price edits on save also need `tickets.pricing` (`priceSig` / `price_sig`).
  Packages = `event.bundles` (parts of allowed ticket types + products, one price, own stock); products = `event.addons` (stock, per-order
  max, sale window, standalone, ticket-type / seat-area rules); checkout offers = `event.upsells`. Promo codes + tracking codes are
  box-office wide (`promos`, `tracking_codes`; one code namespace incl. bulk unique `codes`) — `findCode()` / `find_code()`. Promo discounts
  are per unit (`line.discs`), so every ticket stores `face`, `paid`, `discount`, `promo`, `tracking`, `bundle`, `extras`, `comp`,
  `price_override`. Tracking links are `?ref=CODE` (views keep the ref). Promotions page = `#/admin/promos`.
- **Checkout & payments (Stage 5):** tickets exist ONLY for paid orders (or deliberate staff orders/comps). Order states
  (`ORDER_STATUS`): `awaiting_payment` (card checkout, holds seats/stock for `PAY_MINUTES` via `expires_at`), `pending` (pay-later
  reservation, no tickets until staff "Mark paid"), `expired`, `paid`, `cancelled`, `refunded`. Unpaid-but-reserved orders count in
  availability through `lineUnits()` / SQL `reserved_units()`; `issueOrderTickets()` / `issue_order_tickets()` run once on paid (SQL: the
  `orders_paid` trigger) and queue ONE `outbox` confirmation. Same checkout submitted twice → same order (`attempt` key). Processors:
  `GATEWAYS` in data.js + `supabase/functions/payments/` (one adapter per processor in `providers/`; Stripe Connect direct charges with
  the platform fee as application fee; webhook → `confirm_payment()`, which refunds late payments whose seats are gone). DEMO uses a
  built-in test processor with Stripe's test card numbers (`demoCharge`). Box office's processor = `bo.gateway` (public part) +
  `payment_accounts` (account id, service-role only). Money breakdown is in `quote()` / `price_cart()`: ticketsTotal, addonsTotal, fee,
  serviceFee (platform fee when the buyer pays it), tax (`taxOnFees`), processing (only if `passProcessing`), processingFee, platformFee
  (`platformFeeFor()`: platform default + super-admin per-box-office override), refunded, total. Buyers get `buyerOrder()` / `buyer_order()`
  (never platform/processing fees or payment internals). Checkout questions: box office `settings.questions` (per order) + `event.questions`
  with `scope` event|ticket, types in `Q_TYPES`, checked server-side by `checkAnswers()` / `check_answers()`; per-ticket answers land on
  `tickets.answers`. Event page sections + `event.page` (video, gallery, sponsors, blocks, hide{}, colours, checkoutNote). Customer accounts
  (`#/account`, optional): DEMO `st.customers` (PBKDF2), LIVE Supabase Auth email+password + `my_orders()` (confirmed email only).
- **Orders & customers (Stage 6):** staff never write `orders` / `tickets` directly (no update policies; table writes revoked) — every
  change is `DB.orderAction(id, action, p)` → DEMO `demoOrderAction()` / SQL `order_action()` (actions: change | cancel | refund | collect |
  addAddon | removeAddon | customer | holder | note | message | resend | markPaid | cancelUnpaid | status). Nothing is overwritten: a seat /
  type / showtime change sets the old ticket `status='replaced'` (`replaced_by`) and issues a new ticket + code (`changeOrderTickets()` /
  `change_order_tickets()`, price via `changePrice()` / `change_price()`; net difference settled once: collect | due | waive, or refund | credit |
  eventCredit | none). Refunds `refundPlan()` + `applyRefund()` append to `data.refunds` (per-ticket `tickets.refunded`); extra money to
  `data.charges` / `extraPaid`; `data.due` = balance due; `orderMoney()` / `order_money()` = collected / refunded / credited / refundable.
  Every change is a row in `orderLog` / `order_log` (+ audit). Refunds to the card: LIVE goes through the payments Edge Function
  (`{action:'order'}` runs `order_action` as the caller, then `provider.refund` per 'processing' refund → `finish_refund()`). Credits = `credits`
  table (code `CR-…`, email, optional event, expiry, `applied[]`; `creditState()` / `credit_state()`); used at checkout via `p.credit` (code or
  'account') / `p.creditId` (staff) → `quote(..., {credit})` / `price_cart` `creditAvail` (set only by `place_order`, stripped from the payload).
  Customers page `#/admin/customers[/<email>]`, notes `customer_notes`; order page `#/admin/orders/<id>`, manual order `#/admin/orders/new`.
  Live activity: `DB.ping()` / `presence_ping()` → `event_presence`, summarised in `admin_load().live`; event tab "Live activity". Outbox has
  one `confirmation` per order (partial unique index) plus resend / updated / refund / message rows.
- **Money is integer cents everywhere.**
- **Not yet wired:** the payments Edge Function is written but not deployed (no Supabase project yet; needs Stripe keys in
  Supabase secrets + pg_cron for `expire_orders()`); outbound email/SMS (confirmations are queued in `outbox`, not sent); Apple Wallet passes.

## Run locally
`cd frontend && python3 -m http.server 8765` → http://localhost:8765 (organizer side: /#/admin).
Tests: copy `tests/*.html` into `frontend/`, open via the local server (headless Chrome `--dump-dom` works), then delete the copies.
Stage 5's and 6's suites use PBKDF2 (real CPU time), so run them in real time (poll their `#out` for `DONE`), not with `--virtual-time-budget`.
Database rules for real: `bash tests/db-e2e.sh` applies `supabase/schema.sql` to a scratch Postgres (with `tests/supabase-stub.sql` standing in
for Supabase's auth schema and roles) and runs `tests/db-e2e.sql` as buyers, staff, customers and the service role. A throwaway Postgres:
`pip install pgserver` (bundles the binaries) — see the script header.

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
