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
- **Scanning & event day (Stage 7):** a QR holds only the ticket's random `code`. Every scan goes to `DB.checkin(code, undo, eventId, o)` →
  DEMO `demoCheckin()` / SQL `checkin(p_code, p_undo, p_event, p)` (o: slot, entrance id, device, deviceName, manual, override) and answers
  with a result in `SCAN_RESULTS` (ok | already | undone | unknown | cancelled | refunded | replaced | wrong_event | wrong_slot | wrong_entrance |
  inactive | device_off) + `doorTicket()` / `door_ticket()` — where the guest belongs, never money / email / phone. Check-in is one conditional
  UPDATE (`checked_in_at is null`), so parallel scanners accept a ticket once; `tickets.checkin` = {entrance, device, device_name, by, manual}.
  Every attempt is a `scanLog` / `scan_log` row; scanning phones are `devices` / `scan_devices` (admin can rename / switch off — `door.devices`).
  Entrances = `event.entrances` [{id, name, ticketTypeIds, areas}] (`entranceTakes()` / `entrance_takes()`; wrong door → warn, `door.override`
  lets in). Scanners poll `DB.doorSync()` / `door_sync(p_event, p_since)` every 4 s (`tickets.touched_at` trigger → only changes) and merge via
  `mergeDoor()`. Manual look-up `doorSearch()` / `door_search()` (`door.search`), history `doorLog()` / `door_log()` (`door.log`). Reissue =
  order action `reissue` (same seat, new code, old → replaced). Section names on tickets ("Box 4", "Table 5", "Couch 3"): `sec.showName`
  (default on for table / booth) → 4th `meta` element → `tickets.unit`; `sec.hideRow` leaves the row off. `seatLines()` = the big door display.
  Scanner staff template = `door.scan` + `door.checkin` only (back office shows `ScannerHome`). Event tab "Door & check-in" (`EdDoor`).
  DEMO multi-device: `Demo.fresh()` updates `Demo.st` in place, and order / credit / place-order actions refresh first.
- **Marketing, messages & automation (Stage 8):** ONE outbox (`outbox`) for everything sent — confirmations, resends, ticket changes,
  refunds, staff messages, reminders, event updates, campaigns, waitlist notices, automation emails / texts, staff notifications. Rows have
  `channel` email|sms, `category` transactional|marketing|staff, `send_at`, `require_valid` (drop if the order no longer has valid tickets),
  `dedupe`. Queue with `queueMsg()` / SQL `queue_msg()` (`queueMail()` / `queue_mail()` for an order). Consent + tags live on `contacts`
  (one per box office + email; `orderContact()` / `order_contact()` records checkout opt-ins), every change via `consentChange()` /
  `consent_change()` → `consentLog` / `consent_log`. `sendGate()` / `send_gate()` decides at queue time AND again at send time:
  transactional → everyone unless suppressed; marketing → opted in, not unsubscribed; texts → a number and no STOP (marketing texts need
  their own opt-in). Segments = filters (`emptySeg()`; `segmentPeople()` / `segment_people()`; saved in `box_offices.segments`). Campaigns
  are `broadcasts` rows expanded into outbox rows by `sendCampaign()` / `send_campaign()` (event updates = category transactional, must name
  events). `emitEvent()` / `emit_event()` is the one place outside systems hear about things: webhook / CRM / Meta CAPI `deliveries` rows +
  matching `automations` (`runAutomation()` / `run_automation()`, once per key via `autoRuns` / `automation_runs`). Time triggers
  (event approaching / ended / no-show) + the event's own reminders run in `marketingTick()` / `marketing_tick()` (pg_cron every minute;
  DEMO runs it on each back-office load). Standard workflows = automations with `std` (purchase / pre / post / offer). The sender is the
  `messaging` Edge Function (`claim_outbox` → render with `mailtpl.js` → Resend / Twilio → `outbox_result`; `claim_deliveries` →
  `delivery_result`; STOP replies, bounces, one-click unsubscribe). `frontend/mailtpl.js` is the ONE renderer for app previews and the
  function — keep `supabase/functions/_shared/mailtpl.js` a byte-identical copy (db-e2e.sh checks). Read-only API = `api` Edge Function +
  `api_keys` (SHA-256 only). Pixels (GA4 / Meta / TikTok, optional consent banner) in `loadPixels()` / `pix()`; UTM tags → `order.data.utm`.
  Marketing page `#/admin/marketing/<tab>`; buyer preferences page `#/unsubscribe/<token>`.
- **Reports & money (Stage 9):** every figure comes from `finReport(x, filters)` in data.js — `finItems()` turns each paid order into items
  (one per ticket with its own stored face / paid / discount / comp / `fee` / `tax` / `proc` / `refunded` / `credited`, one per product line,
  package extras, and one "order" item for donations, card fees passed on, credit used, later changes, chargebacks and the platform fee), so
  an order's items always sum to `orderMoney(o).collected` and every filter / breakdown / export reconciles. Ticket fee/tax/processing shares
  are set once at issue (`allocTicketMoney` / SQL `alloc_ticket_money`). Chargebacks live on `order.data.chargebacks` (order_action
  'chargeback'; processor webhook → `record_dispute`). The processor's own ledger is `procTx` / `processor_tx` + `payouts` (demo processor /
  payments Edge Function webhooks); `reconcile()` matches it to SET by payment id (or against an imported processor CSV). Expenses:
  `expenses` + `expense_status` (perm `finance.expenses`; profit is "estimated" until marked final). Exports are built client-side from the
  already-masked admin data (`xpRows`), CSV (formula-injection safe `csvCell`) or Excel via `frontend/xlsx.js` (no library). Owners can
  always pull everything with `export_box_office()` (even while suspended); super admins `platform_export()`. Accounting = balanced daily
  `journal()` → QuickBooks / Xero CSV; direct sync needs their OAuth apps.
- **Platform, security & event controls (Stage 10):** the Stage 10 block in data.js (mirrored in schema.sql's "Stage 10 core" + RPC
  sections). Emergency controls = `ev.controls` (LIVE: `events.controls` column, written only by `event_control()` — `events_guard` keeps
  it on ordinary saves; perm `events.controls`) checked by `controlBlock()` / `control_block()` in holds, orders and `checkin` (result
  `paused`). Basket timeout `ev.cartMinutes` (`cartMinutes()` / `cart_minutes()`); sale windows per showtime (`slot.salesStart/End`) and per
  area (`ev.areaSales`) via `windowMsg()` / `window_msg()`. Waiting room `ev.queue {on, rate, passMinutes}`: FIFO entry times
  (`queueEntry()` / `queue_status()` + `queue_entries`), pass checked by `queuePass()` / `queue_pass()` with the browser's hold token.
  Fees per event: booking-fee rules seat area → ticket type (`tt.fee`) → event (`ev.fees`) → box office (`feeRuleFor()` / `fee_rule()`,
  `feeSet()` / `fee_set()`; ticket lines also split on the rule), product fees (`ad.fee`), other fees `ev.fees.extra` (mandatory or
  optional via `cart.optFees` / `p.optFees`) → `order.data.otherFees` / `otherFee` (finItems' order item, FIN_SUM `otherFee`), event tax
  `ev.taxPct`, `ev.fees.passProcessing`. Policies: `policiesFor()` / `policies_for()` (box office terms / refund / privacy, replaced by the
  event's own, + event policies), version = `fnv()` of the text (same in SQL); checkout sends `accepted`, `policyCheck()` / `policy_check()`
  stores it on `order.data.accepted` and texts in `policyTexts` / `policy_texts`. Checkout form per event `ev.checkout` (`checkoutFor()` /
  `checkout_for()` — strictest wins); donations `settings.donationAmounts/Purpose/Custom` + `ev.donation` → `order.data.donationFor`.
  Abuse: `rateHit()` / `rate_hit()` (+ `client_ip()`), honeypot `p.bot.hp`, velocity, bans (`bans`, `activeBan()`), flags
  (`ORDER_FLAGS` on `order.data.flags`, order action `review`); seat holds capped per address in SQL. Versions: `addVersion()` /
  `add_version()` on every event / box office save (`versions`, 40 per target) + local autosave of the event editor (`autosaved()`).
  Customer service: `contactOrganizer()` / `contact_organizer()` → `support_messages` + staff email to the event's contact (Customers →
  Inbox, `customers.inbox`). Super admin (`#/platform/...`): all events, staff, plans & billing (`planList`, `bo.plan`, `billingFor()` /
  `billing_for()`, `billing_run()` → `platform_invoices`; fees on Stripe orders are taken automatically, others invoiced), risk, system
  health (`healthOf()` / `platform_health()` from `pay_attempts`, outbox, deliveries, `error_log`, `backup_runs`, open `incidents`),
  incidents, processors off (`gatewaysOff`; per box office `pause_gateway()`). Domains: `bo.domain` + `bo.mailDomain` (column
  `mail_domain`) set by `save_domain()` / the `domains` Edge Function; `bo_by_domain()` at boot. Self-serve sign-up `register_organizer()`.
  Table lockdown: orders / tickets / outbox / credits / … have NO direct select for anon or authenticated — read through `admin_load()`.
  API keys only keep scopes their creator still has permission for (`API_PERM`, checked in `api_auth`). DEMO: every `DB.*` call runs
  `Demo.fresh()` first (other tabs' changes). `deploy/publish.sh` writes `version.json` + a `deploy-…` tag; `deploy/rollback.sh`,
  `deploy/backup.sh`, `deploy/restore-test.sh`, `tests/load/onsale.js`. Older test suites wrap `DB.placeOrder` with `acceptAll()` (current
  policy versions + reset demo rate limit) because they call it directly.
- **Final additions (Eli's list, §1–§11):** one block in data.js ("Final additions") mirrored in schema.sql's "Final additions" section.
  §1 wallet passes (`WalletPreview` in DEMO; `wallet_ticket()` / `wallet_devices` / `wallet_push` ready for a wallet Edge Function, not
  written — needs Apple Pass Type ID cert + Google Wallet issuer). §2 door sales = manual order in POS mode (`pos: true`, `payMethod`,
  `DB.terminalPay` card reader). §3 memberships / season passes = `settings.passPlans` + `passes` (`findPass()` / `find_pass()`,
  `applyPass()` / `apply_pass()`, `passState()`; member-only ticket types `memberOnly` + `memberPlans`). §4 gift cards = `credits` rows with
  `kind` gift|voucher (no fee / tax when bought; `giftErr()`). §5 payment plans = `order.data.plan` (`planSchedule()`, `payInstallment()` /
  `pay_installment()`; order stays `pending` until the last installment). Each card installment is its own processor payment (own ref,
  payments function `{action:'installment'}` + webhook `metadata.installment`); card refunds on a plan split over them
  (`planRefundParts()` / `plan_refund_parts()` → `refund.parts`), and `platformTx()` reconciles each separately. §6 peak / off-peak
  (`tt.peak`, `peakRule()` / `peak_rule()`) + last-minute phases (`hoursBefore`). §7 purchase rules `ev.rules` (`ruleErr()` / `rule_err()`).
  §8 customer self-service `settings.selfService` + per-event overrides, all OFF by default (`demoSelfService()` / `self_service()`).
  §9 offline payment methods `PAY_METHODS`. §10 embeds: `frontend/embed.js`, `#/embed/<slug>[?compact=1]`, `#/embed-list/<bo>`.
  §11 product vouchers (`ad.redeemable` → `vouchers`, scanned through `checkin` → item_ok | item_used | item_void). Tests: `tests/final-e2e.html`.
- **Money is integer cents everywhere.**
- **Not yet wired:** the payments, messaging and api Edge Functions are written but not deployed (no Supabase project yet; need
  Stripe / Resend / Twilio keys in Supabase secrets + pg_cron for `expire_orders()` and `marketing_tick()`; the messaging function sends
  nothing until `EMAIL_LIVE=1`); the domains function (DNS / Resend) and Cloudflare for SaaS custom hostnames; Apple Wallet passes.

## Run locally
`cd frontend && python3 -m http.server 8765` → http://localhost:8765 (organizer side: /#/admin).
Tests: copy `tests/*.html` into `frontend/`, open via the local server (headless Chrome `--dump-dom` works), then delete the copies.
Stage 5's and 6's suites use PBKDF2 (real CPU time), so run them in real time (poll their `#out` for `DONE`), not with `--virtual-time-budget`.
The database checks also compare the two `mailtpl.js` copies.
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
