# Setup — hosting (HTTPS-first), git, naming

## The complete "accounts you need" list (to build a kit-style app from zero)
1. **GitHub account** (one PER company — see §3): code home + free HTTPS hosting via Pages.
2. **Google account** (the company's): Firebase/Firestore for data (see INTEGRATIONS.md §5
   recipe), Google sign-in for auth, Apps Script mail relay, Sheets/Drive.
3. **A server (droplet), ONLY if the app needs server-side secrets or device/webhook traffic** —
   many apps don't: static frontend on Pages + Firestore + Google auth = zero servers.
4. **A domain** for the company (subdomain per app, §1). Optional for pure-internal tools
   (`<user>.github.io/<repo>` works), required for anything client-facing.
That's the whole dependency list; everything else in INTEGRATIONS.md (Stripe, maps, email) is
added per-feature, not up front.

## 0. Installing this kit on a new computer (if you received it as a zip)
1. Unzip the whole folder anywhere (e.g. `C:\Users\<you>\app-starter-kit` or `~/app-starter-kit`).
   Keep the hidden `.claude` folder inside it — that's where the skills live.
2. The skills (`new-app`, `harden`, `breakdown`, `diagnose`, `parse-info`) work automatically in any
   Claude Code session opened INSIDE this folder. To make them available in EVERY session on the
   machine, copy the folders from `app-starter-kit/.claude/skills/` into `~/.claude/skills/`
   (`C:\Users\<you>\.claude\skills\` on Windows).
3. `CLAUDE.md` in this folder carries the owner's full build style (engineering priorities, security
   checklist, UI aesthetic) — a fresh Claude with no memory reads it and builds the same way. To apply
   the "explain big decisions in plain English" communication rule globally, copy that section into
   `~/.claude/CLAUDE.md`.
4. From there, follow section 4 below to start a project (or just say "/new-app").

## 1. Naming & URL conventions
- **Repo + host slug match.** Pick one short lowercase slug (e.g. `ops`, `installer`, `partners`)
  and use it for both the repo name and the subdomain. Human-friendly name lives in the UI only.
- **One subdomain per app:** `ops.<company>.com`, `installer.<company>.com`. Subdomains isolate
  blast radius and SSL per app — prefer them over stacking many apps under one domain's paths.
- **Separate prod from test:** `ops.<company>.com` (prod) vs `ops-test.<company>.com` or a
  separate static host. Never test on the prod host.

## 2. Hosting with HTTPS — pick one (all give automatic or easy TLS)

### A. Static host (recommended for no-build single-file apps) — HTTPS automatic, free
- **GitHub Pages:** push repo → Settings → Pages → deploy from branch. URL `https://<user>.github.io/<repo>/`.
- **Netlify / Cloudflare Pages / Vercel:** connect repo, auto-deploy on push, free TLS + a real
  domain you can point a custom subdomain at (CNAME). Best when you want `app.<company>.com`.
- Use these whenever the app needs no server-side secrets. If it needs APIs with secret keys,
  pair the static frontend with the proxy (below) on its own subdomain.

### B. Server (droplet) for the proxy/backend — HTTPS via nginx + Let's Encrypt
```
# one-time, on the server:
sudo apt install -y nginx certbot python3-certbot-nginx
# nginx site: proxy_pass http://127.0.0.1:3001;  server_name api.<company>.com;
sudo certbot --nginx -d api.<company>.com         # issues cert + adds 80->443 redirect
# certbot auto-renews via systemd timer; verify: sudo certbot renew --dry-run
```
- Add HSTS in the nginx server block: `add_header Strict-Transport-Security "max-age=31536000" always;`
- Run the proxy under a process manager (`pm2 start backend/proxy.js --name proxy`).
- **Never expose the raw HTTP port publicly** — nginx terminates TLS and proxies to localhost:3001.

### C. Sub-path of an EXISTING host (proven shortcut for small internal tools)
A new no-build app can ship as a subdirectory of an app you already host:
`https://ops.<company>.com/<newapp>/` — upload `index.html` (+ manifest) into a subfolder of the
existing nginx/static root. Zero DNS, zero TLS, zero nginx changes; live in minutes.
- Check the parent app's **service worker scope** first: a SW registered at `/` that intercepts
  fetches would capture the sub-app too (a push-only SW is harmless).
- Fine for tools with no server-side data (e.g. localStorage-only) even without an auth gate —
  there's nothing to protect. Anything with real data still needs the auth rules in CLAUDE.md.
- Graduate to its own subdomain (section 1) if it grows real users or a backend.

## 3. Using a DIFFERENT git account (e.g. a new company)
Per-repo identity so commits/keys don't cross companies:
```
# inside the new repo:
git config user.name  "Your Name"
git config user.email "you@<company>.com"
# dedicated SSH key for this account:
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_<company> -C "you@<company>.com"
# ~/.ssh/config:
#   Host github-<company>
#     HostName github.com
#     IdentityFile ~/.ssh/id_ed25519_<company>
# then clone/remote with the alias:
git remote add origin git@github-<company>:<org>/<repo>.git
```
Add the new public key to the new company's GitHub account.

## 4. Adopting this kit for a new project
1. Copy this folder, rename to the project slug.
2. Replace every `<PLACEHOLDER>` in `CLAUDE.md`, `.env.example`, and the skeletons.
3. `git init`, set per-repo identity (section 3), first commit, push to the new account's repo.
4. Choose a host (section 2) — **HTTPS from day one.**
5. Fill `.env` from `.env.example` (never commit it).
6. Open `CLAUDE.md` in Claude Code and describe the use case — it will build in the owner's style.
7. Adding email, payments, maps, scheduled jobs, browser automation, LLM calls, push, or PDF
   output? Read `INTEGRATIONS.md` for the proven option in each category before picking one.

## SET — taking real card payments (Stage 5)
1. Create the SET Supabase project (separate from any other app), run `supabase/schema.sql`, fill `frontend/config.js`.
2. Turn on **pg_cron** (Database → Extensions) and run `select cron.schedule('set-expire-checkouts', '* * * * *', 'select expire_orders()');`
   — unpaid card checkouts release their seats after 15 minutes.
3. In Stripe (platform account): enable **Connect** (Express accounts). Then set the secrets — in your own terminal, never in chat:
   `supabase secrets set STRIPE_SECRET_KEY=sk_test_… STRIPE_PUBLISHABLE_KEY=pk_test_… APP_ORIGINS=https://your-site`
4. Deploy: `supabase functions deploy payments --no-verify-jwt`.
5. Stripe → Developers → Webhooks → add `https://<project>.functions.supabase.co/payments?webhook=stripe`, listening to
   `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`, `charge.dispute.created`, `charge.dispute.closed`,
   `payout.created`, `payout.paid`, `payout.failed` (tick "events on Connected accounts"). Put its signing
   secret in `STRIPE_WEBHOOK_SECRET`.
6. Each box office: Settings → Payments → Connect Stripe → finishes Stripe's onboarding → card checkout turns on by itself.
Test with Stripe's test cards first (4242 4242 4242 4242); switch to live keys only when everything checks out.

## SET — custom domains for a box office (Stage 10)
The app side is built: Settings → Custom domain gives the box office a CNAME (→ `domainTarget` in Platform settings) and a TXT
`_set-verify.<host>` record; the `domains` Edge Function checks them (DNS-over-HTTPS) and `bo_by_domain()` makes that host open the box
office's own page. What GitHub Pages can't do is serve many domains with HTTPS, so production hosting moves to **Cloudflare Pages +
Cloudflare for SaaS** (custom hostnames, automatic certificates): point `domainTarget` (e.g. `domains.set-tickets.app`) at the Pages site,
add each verified host as a custom hostname (API or dashboard), and list the platform's own hosts in Platform settings → "The platform's
own hosts". Deploy: `supabase functions deploy domains` (needs `APP_ORIGINS`, and `RESEND_API_KEY` for sending domains).

## SET — sending email & texts (Stage 8)
Nothing is sent until every step below is done AND `EMAIL_LIVE=1` is set — until then the sender marks messages "sending is switched off".
1. **Email (Resend):** create a Resend account, add and verify the sending domain (DNS records Resend shows you). Then, in your own
   terminal (never in chat):
   `supabase secrets set RESEND_API_KEY=re_… MAIL_FROM="SET Tickets <tickets@your-domain>" APP_URL=https://your-site/ CRON_SECRET=<long random string>`
2. **Texts (optional, Twilio):** buy a number (or create a Messaging Service), register it for A2P 10DLC in the US, then
   `supabase secrets set TWILIO_ACCOUNT_SID=AC… TWILIO_AUTH_TOKEN=… TWILIO_FROM=+1…` (or `TWILIO_MESSAGING_SERVICE_SID=MG…`).
   In Twilio, set the number's "A message comes in" webhook to `https://<project>.functions.supabase.co/messaging?inbound=twilio`
   (STOP / START replies).
3. Deploy: `supabase functions deploy messaging --no-verify-jwt` and `supabase functions deploy api --no-verify-jwt`
   (copy `frontend/mailtpl.js` to `supabase/functions/_shared/` first if it changed — the tests check they match).
4. Resend → Webhooks → add `https://<project>.functions.supabase.co/messaging?events=resend` for `email.bounced`, `email.complained`;
   put its signing secret in `RESEND_WEBHOOK_SECRET`. Hard bounces and spam complaints then suppress the address.
5. Schedule (pg_cron + pg_net, Database → Extensions):
   `select cron.schedule('set-marketing-tick', '* * * * *', 'select marketing_tick()');`
   `select cron.schedule('set-send', '* * * * *', $$select net.http_post('https://<project>.functions.supabase.co/messaging', '{"action":"run"}'::jsonb, '{}'::jsonb, '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb)$$);`
6. Test by sending yourself an event update from a test box office, then set `supabase secrets set EMAIL_LIVE=1`.
Box offices connect their own CRMs / webhooks / Meta Conversions API under Marketing → Integrations; their keys are stored in the
database (server-side only, never returned to the browser).

## SET — production go-live checklist (Stage 10)
Do these in order; each is yours to do (accounts, keys, money) — paste nothing secret into chat.
1. **Two Supabase projects:** `set-production` and `set-staging` (never the ASP project). Run `supabase/schema.sql` on both
   (`psql "$DB_URL" -f supabase/schema.sql`; it is safe to re-run). Turn on Point-in-Time Recovery on production (Pro plan).
2. **Two sites:** production = this repo's Pages site (or Cloudflare Pages for custom domains, above); staging = a second repo:
   `SET_ENV=staging SET_REPO=<owner>/set-tickets-staging bash deploy/publish.sh` with `config.js` `env: 'staging'` (shows a ribbon).
3. **Config:** fill `frontend/config.js` with each project's URL + anon key (public by design). Make yourself a super admin:
   `insert into platform_admins(email) values ('you@…');`
4. **Payments, email, texts:** the Stage 5 and Stage 8 sections above, on staging first with Stripe test keys and `EMAIL_LIVE` unset.
5. **Schedules (pg_cron):** `expire_orders()` and `marketing_tick()` every minute (above), plus
   `select cron.schedule('set-billing', '0 6 1 * *', $$select billing_run(to_char(now() - interval '1 month', 'YYYY-MM'))$$);`
6. **Backups:** `~/.set-secrets/db_url` (chmod 600) = the production connection string; cron `0 3 * * * bash ~/set-tickets/deploy/backup.sh`;
   once a month `bash deploy/restore-test.sh`. System health turns "Backups" amber after 26 hours without a good one.
7. **Auth hardening (Supabase → Authentication):** email OTP + TOTP MFA on, rate limits on (defaults are fine), JWT expiry 1 hour,
   refresh-token rotation on, "Secure email change" on. Staff inactivity sign-out is per box office (Settings → Staff security).
8. **Load test before a big on-sale:** on staging, `k6 run … tests/load/onsale.js` (header explains); turn the event's waiting room on.
9. **Test on staging:** `bash tests/db-e2e.sh` locally, then one real test order end to end (test card), a scan, a refund, an email.
10. **Go live:** switch Stripe to live keys, set `EMAIL_LIVE=1`, publish production. Deployment history: `git tag -l 'deploy-*'`;
    roll back the site with `bash deploy/rollback.sh <tag>` (the database is never rolled back — schema changes are additive).
