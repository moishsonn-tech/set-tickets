-- SET Tickets — Supabase schema. Apply once in a NEW Supabase project (SQL editor or Management API).
-- Multi-tenant: every row belongs to one box office. Security model:
--   * Buyers (anon) read active box offices + their published events (public columns only) and buy through
--     place_order(), which re-prices every line and enforces inventory/seats under a per-event lock.
--   * Staff are rows in `members` (box office + verified auth email) holding an explicit permission list,
--     optionally limited to some events. has_perm() is the one gate every policy and RPC uses.
--   * Platform super admins (`platform_admins`) manage box offices; their support access passes has_perm().
--   * Customer contact details and money reach staff only through admin_load(), which masks what the
--     member may not see. Direct table reads of orders need full customer + order permissions.
--   * audit_log is append-only; triggers record permission, event, order and box-office status changes.

create extension if not exists pgcrypto;

create table if not exists platform_settings (id int primary key default 1 check (id = 1), data jsonb not null default '{}');
insert into platform_settings (id, data) values (1, '{"name":"SET","publicRegistration":false,"feePct":1,"feeFixed":25,"plans":""}') on conflict (id) do nothing;
create table if not exists platform_admins (email text primary key, created_at timestamptz default now());

create table if not exists box_offices (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  name text not null,
  status text not null default 'pending' check (status in ('pending','active','suspended','deactivated')),
  owner text not null,
  branding jsonb not null default '{}',     -- public: logo, colours, font, socials, policies, domain
  settings jsonb not null default '{}',     -- public: currency, fees, tax, terms, require2fa, pixels
  templates jsonb not null default '[]',    -- permission templates [{id,name,perms[]}]
  event_templates jsonb not null default '[]',  -- reusable event set-ups [{id,name,at,minutes,event}]
  venues jsonb not null default '[]',       -- master seating charts [{id,name,address,chart,tiers}] (Stage 3); events copy them
  created_by text, created_at timestamptz default now());

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  box_office_id uuid not null references box_offices(id) on delete cascade,
  email text not null, name text,
  perms text[] not null default '{}',
  template text,
  all_events boolean not null default true,
  event_ids uuid[] not null default '{}',
  status text not null default 'active' check (status in ('active','removed')),
  added_by text, created_at timestamptz default now(), removed_at timestamptz, removed_by text,
  unique (box_office_id, email));

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  box_office_id uuid not null references box_offices(id),
  slug text unique not null,
  status text not null default 'draft' check (status in ('draft','published','cancelled')),
  data jsonb not null default '{}',          -- everything a buyer may see
  secrets jsonb not null default '{}',       -- {password, ticketPasswords:{ttId:pw}, discounts:[...]}
  created_at timestamptz default now(), updated_at timestamptz default now());
create index if not exists events_bo on events(box_office_id);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  box_office_id uuid not null references box_offices(id),
  ref text unique not null,
  access_key uuid not null default gen_random_uuid(),
  status text not null check (status in ('paid','pending','cancelled','refunded')),
  buyer_email text not null,
  event_ids uuid[] not null,
  data jsonb not null,
  created_at timestamptz default now());
create index if not exists orders_bo on orders(box_office_id);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  box_office_id uuid not null references box_offices(id),
  order_id uuid not null references orders(id),
  event_id uuid not null references events(id),
  ticket_type_id text not null, slot_id text, seat text,
  area text, "row" text, seat_label text, comp boolean not null default false,   -- Ticket type / Area, Row, Seat kept separately (Stage 3)
  code text unique not null, holder text,
  status text not null default 'valid' check (status in ('valid','cancelled')),
  checked_in_at timestamptz);
create index if not exists tickets_event on tickets(event_id);
create unique index if not exists tickets_seat on tickets(event_id, coalesce(slot_id,''), seat) where seat is not null and status = 'valid';

create table if not exists waitlist (id uuid primary key default gen_random_uuid(), box_office_id uuid not null references box_offices(id),
  event_id uuid references events(id) on delete cascade, name text, email text not null, phone text, notified_at timestamptz, created_at timestamptz default now(),
  unique (event_id, email));
create table if not exists broadcasts (id uuid primary key default gen_random_uuid(), box_office_id uuid not null references box_offices(id),
  event_id uuid references events(id) on delete cascade, subject text, body text, recipients int, created_by text, created_at timestamptz default now());
create table if not exists audit_log (id uuid primary key default gen_random_uuid(), at timestamptz not null default now(),
  actor text not null, box_office_id uuid, target uuid, kind text not null, summary text not null, before jsonb, after jsonb);
create index if not exists audit_bo on audit_log(box_office_id, at desc);
create index if not exists audit_target on audit_log(target, at desc);
-- Event page views (Stage 2 performance + conversion). Written only through track_view().
create table if not exists event_views (id bigint generated always as identity primary key, event_id uuid not null references events(id) on delete cascade,
  at timestamptz not null default now(), visitor text not null, src text);
create index if not exists event_views_ev on event_views(event_id, at);
-- Seat statuses (Stage 3). slot_id '' = every showtime. status: checkout (a buyer's 10-minute hold, keyed by a browser token) |
-- held (staff hold with a note) | blocked | unavailable. Sold / comp come from tickets. Written only through the RPCs below.
create table if not exists seat_status (id uuid primary key default gen_random_uuid(), box_office_id uuid not null references box_offices(id),
  event_id uuid not null references events(id) on delete cascade, slot_id text not null default '', seat text not null,
  status text not null check (status in ('checkout','held','blocked','unavailable')), note text, by text, at timestamptz not null default now(),
  expires_at timestamptz, token text, unique (event_id, slot_id, seat, status));
create index if not exists seat_status_ev on seat_status(event_id);
-- Per-seat history: sold, comp, cancelled, blocked, unblock, held, released, unavailable, available, moved, price, area.
create table if not exists seat_log (id bigint generated always as identity primary key, at timestamptz not null default now(), box_office_id uuid not null,
  event_id uuid not null references events(id) on delete cascade, slot_id text not null default '', seat text not null, action text not null, detail text,
  by text, ref text, discount text);
create index if not exists seat_log_ev on seat_log(event_id, seat, at desc);
-- for databases created before Stage 3
alter table box_offices add column if not exists venues jsonb not null default '[]';
alter table tickets add column if not exists area text, add column if not exists "row" text, add column if not exists seat_label text, add column if not exists comp boolean not null default false;
-- Stage 4: every ticket keeps its own money + attribution: face value, amount collected, discount + code, tracking code, package, products.
alter table tickets add column if not exists face bigint, add column if not exists paid bigint, add column if not exists discount bigint not null default 0,
  add column if not exists promo text, add column if not exists tracking text, add column if not exists bundle jsonb, add column if not exists extras jsonb not null default '[]',
  add column if not exists price_override boolean not null default false;
alter table event_views add column if not exists ref text;   -- tracking code from a ?ref= link
create index if not exists orders_events on orders using gin(event_ids);
-- Promo codes (Stage 4): box-office wide, targeted inside data {type, amount, on, scope, eventIds, slotIds, ticketTypeIds, areas, prices, addonIds,
-- bundleIds, startsAt, expires, maxUses, perCustomer, maxItems, maxTickets, minSpend, minQty, maxQty, codes:[bulk single-use codes], note, active}.
create table if not exists promos (id text primary key, box_office_id uuid not null references box_offices(id), code text not null, data jsonb not null default '{}',
  created_at timestamptz not null default now(), created_by text, unique (box_office_id, code));
-- Tracking / referral codes: credit sales to a promoter, partner, affiliate, sponsor or campaign. data {name, kind, eventIds, startsAt, expires, maxUses, active}.
create table if not exists tracking_codes (id text primary key, box_office_id uuid not null references box_offices(id), code text not null, data jsonb not null default '{}',
  created_at timestamptz not null default now(), unique (box_office_id, code));
-- Stage 5: order states + payments. Tickets exist only once an order is paid (or staff deliberately issue them).
--   awaiting_payment = a card checkout in progress: holds its seats / stock until expires_at, then expired (released).
--   pending = a "pay later" reservation the box office allows: holds stock, no tickets until staff mark it paid.
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check check (status in ('paid','pending','awaiting_payment','expired','cancelled','refunded'));
alter table orders add column if not exists attempt_key text, add column if not exists expires_at timestamptz, add column if not exists paid_at timestamptz,
  add column if not exists payment jsonb;   -- {provider, test, ref, method, brand, last4, fee, attempts[]} — staff with finance.processing only
create unique index if not exists orders_attempt on orders(box_office_id, attempt_key) where attempt_key is not null and status <> 'expired';   -- one order per checkout attempt
create index if not exists orders_awaiting on orders(expires_at) where status = 'awaiting_payment';
alter table tickets add column if not exists answers jsonb not null default '{}';   -- per-ticket checkout answers (attendee name, ...)
-- gateway: what buyers may know {provider, status, test}; set only by the payments Edge Function. platform_fee: super admin's per-box-office override.
alter table box_offices add column if not exists gateway jsonb, add column if not exists platform_fee jsonb;
-- the box office's own processor account (Stripe Connect account id, ...). Written only by the payments Edge Function (service role).
create table if not exists payment_accounts (box_office_id uuid primary key references box_offices(id) on delete cascade, provider text not null, account text not null,
  status text not null default 'pending' check (status in ('pending','connected','restricted')), test boolean not null default true, data jsonb not null default '{}', updated_at timestamptz not null default now());
-- outgoing mail: ONE confirmation per order (unique), delivered by Stage 8's sender
create table if not exists outbox (id uuid primary key default gen_random_uuid(), box_office_id uuid not null references box_offices(id), order_id uuid references orders(id),
  kind text not null, "to" text not null, status text not null default 'queued', at timestamptz not null default now());

-- Stage 6: tickets are never edited in place. A seat / type / showtime change voids the ticket ('replaced', replaced_by → the new one);
-- refunds per ticket are tracked; every order change is a row in order_log; credits; notes on customers; live presence on event pages.
alter table tickets drop constraint if exists tickets_status_check;
alter table tickets add constraint tickets_status_check check (status in ('valid','cancelled','replaced'));
alter table tickets add column if not exists replaces uuid, add column if not exists replaced_by uuid, add column if not exists refunded bigint not null default 0,
  add column if not exists cancelled_at timestamptz, add column if not exists changed_at timestamptz, add column if not exists issued_at timestamptz default now();
create table if not exists order_log (id bigint generated always as identity primary key, at timestamptz not null default now(), box_office_id uuid not null references box_offices(id),
  order_id uuid not null references orders(id), ref text, event_id uuid, kind text not null, summary text not null, by text, note text, data jsonb not null default '{}', before jsonb, after jsonb);
create index if not exists order_log_order on order_log(order_id, at desc);
create index if not exists order_log_bo on order_log(box_office_id, at desc);
create table if not exists credits (id uuid primary key default gen_random_uuid(), box_office_id uuid not null references box_offices(id), code text not null unique,
  email text not null, name text, amount bigint not null check (amount > 0), event_id uuid references events(id), expires timestamptz, source_order uuid references orders(id), source_ref text,
  note text, issued_by text, issued_at timestamptz not null default now(), revoked_at timestamptz, revoked_by text, revoke_note text, applied jsonb not null default '[]');
create index if not exists credits_email on credits(box_office_id, email);
create table if not exists customer_notes (id uuid primary key default gen_random_uuid(), box_office_id uuid not null references box_offices(id), email text not null, body text not null, by text,
  at timestamptz not null default now());
create table if not exists event_presence (event_id uuid not null references events(id) on delete cascade, visitor text not null, at timestamptz not null default now(), cart int not null default 0,
  carted_at timestamptz, converted_at timestamptz, primary key (event_id, visitor));
-- outbox: one confirmation per order; resends, updated tickets, refunds and staff messages are extra rows
alter table outbox add column if not exists subject text, add column if not exists body text, add column if not exists by text;
alter table outbox drop constraint if exists outbox_order_id_kind_key;
create unique index if not exists outbox_one_confirmation on outbox(order_id) where kind = 'confirmation';
-- Stage 7: event-day operations. A ticket's QR is only its random code. unit = the section's own name on the ticket ("Table 5", "Box 4");
-- checkin = where / how it was let in {entrance, device, device_name, by, manual}. Every scan attempt (good, duplicate or invalid) is a scan_log row;
-- every phone / tablet / handheld that scans is a scan_devices row (an admin can switch one off). Both are written only by checkin().
alter table tickets add column if not exists unit text, add column if not exists checkin jsonb, add column if not exists touched_at timestamptz not null default now();
create index if not exists tickets_touched on tickets(event_id, touched_at);
create table if not exists scan_log (id bigint generated always as identity primary key, at timestamptz not null default now(), box_office_id uuid not null references box_offices(id),
  event_id uuid, slot_id text, ticket_id uuid, code text, result text not null, entrance text, device text, device_name text, by text, manual boolean not null default false, override boolean not null default false);
create index if not exists scan_log_ev on scan_log(event_id, at desc);
create table if not exists scan_devices (box_office_id uuid not null references box_offices(id) on delete cascade, id text not null, name text not null, renamed boolean not null default false,
  entrance text, first_seen timestamptz not null default now(), last_seen timestamptz not null default now(), last_by text, scans int not null default 0, disabled boolean not null default false,
  primary key (box_office_id, id));
alter table scan_log enable row level security; alter table scan_devices enable row level security;   -- no policies: read through door_log() / scan_devices_list()

-- ── Who is asking ──────────────────────────────────────────────────────────────
create or replace function me_email() returns text language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;
create or replace function is_super() returns boolean language sql stable security definer set search_path = public as
$$ select exists(select 1 from platform_admins where email = me_email()) $$;
-- The one permission gate. p_event null = "anywhere in this box office"; otherwise the member must cover that event.
create or replace function has_perm(p_bo uuid, p_perm text, p_event uuid default null) returns boolean language sql stable security definer set search_path = public as $$
  select is_super() or exists(
    select 1 from members m join box_offices b on b.id = m.box_office_id
    where m.box_office_id = p_bo and m.email = me_email() and m.status = 'active' and b.status = 'active'
      and (b.owner = m.email or p_perm = any(m.perms))
      and (p_event is null or b.owner = m.email or m.all_events or p_event = any(m.event_ids))
      and (not coalesce((b.settings->>'require2fa')::boolean, false) or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'))
$$;
create or replace function is_member(p_bo uuid) returns boolean language sql stable security definer set search_path = public as
$$ select is_super() or exists(select 1 from members where box_office_id = p_bo and email = me_email() and status = 'active') $$;
create or replace function log_action(p_bo uuid, p_kind text, p_summary text, p_before jsonb default null, p_after jsonb default null, p_target uuid default null) returns void
  language sql security definer set search_path = public as
$$ insert into audit_log(actor, box_office_id, target, kind, summary, before, after) values (coalesce(nullif(me_email(),''), 'system'), p_bo, p_target, p_kind, p_summary, p_before, p_after) $$;
-- Public = published, not archived, not hidden, past its scheduled publish time, box office active. (Mirrors eventLive() in data.js.)
create or replace function event_live(e events) returns boolean language sql stable as $$
  select e.status = 'published' and not coalesce((e.data->>'archived')::boolean, false) and coalesce(e.data->>'visibility','public') <> 'hidden'
    and (nullif(e.data->>'publishAt','') is null or (e.data->>'publishAt')::timestamptz <= now())
    and exists(select 1 from box_offices b where b.id = e.box_office_id and b.status = 'active') $$;

-- ── Row-level security ─────────────────────────────────────────────────────────
alter table platform_settings enable row level security; alter table platform_admins enable row level security;
alter table box_offices enable row level security; alter table members enable row level security;
alter table events enable row level security;   alter table orders enable row level security;
alter table tickets enable row level security;  alter table waitlist enable row level security;
alter table broadcasts enable row level security; alter table audit_log enable row level security;

create policy platform_read on platform_settings for select using (is_super());
create policy platform_admins_read on platform_admins for select using (is_super());
create or replace view platform_public with (security_invoker = false) as
  select data->>'name' as name, coalesce((data->>'publicRegistration')::boolean, false) as "publicRegistration",
    coalesce((data->>'feePct')::numeric, 0) as "feePct", coalesce((data->>'feeFixed')::bigint, 0) as "feeFixed", coalesce(data->>'feePayer', 'organizer') as "feePayer" from platform_settings where id = 1;

create policy bo_public on box_offices for select using (status = 'active' or is_member(id));
create policy bo_update on box_offices for update using (has_perm(id, 'admin.settings')) with check (has_perm(id, 'admin.settings'));
-- insert/delete/status/owner changes only through the platform RPCs below

create policy members_read on members for select using (email = me_email() or has_perm(box_office_id, 'admin.invite') or has_perm(box_office_id, 'admin.perms') or has_perm(box_office_id, 'admin.remove'));
create policy members_insert on members for insert with check (has_perm(box_office_id, 'admin.invite'));
create policy members_update on members for update using (has_perm(box_office_id, 'admin.perms') or has_perm(box_office_id, 'admin.remove'));

-- Anyone can list public events; direct-link-only events are fetched one at a time through event_by_slug().
create policy events_public on events for select using (
  (event_live(events.*) and coalesce(data->>'visibility','public') = 'public')
  or has_perm(box_office_id, 'events.view', id) or has_perm(box_office_id, 'door.scan', id));
create policy events_insert on events for insert with check (has_perm(box_office_id, 'events.create'));
create policy events_update on events for update using (has_perm(box_office_id, 'events.edit', id)) with check (has_perm(box_office_id, 'events.edit', id));
create policy events_delete on events for delete using (has_perm(box_office_id, 'events.publish', id) and not exists(select 1 from orders o where id = any(o.event_ids)));

create policy orders_read on orders for select using (has_perm(box_office_id, 'orders.view') and has_perm(box_office_id, 'customers.emails') and has_perm(box_office_id, 'customers.phones'));
create policy tickets_read on tickets for select using (has_perm(box_office_id, 'door.attendees', event_id) or has_perm(box_office_id, 'orders.view', event_id));
-- Stage 6: no update policies on orders or tickets — staff change them only through order_action() (permission-checked, logged)
drop policy if exists orders_update on orders; drop policy if exists tickets_update on tickets;
alter table order_log enable row level security; alter table credits enable row level security; alter table customer_notes enable row level security; alter table event_presence enable row level security;
create policy order_log_team on order_log for select using (has_perm(box_office_id, 'orders.view', event_id));
create policy credits_team on credits for select using (has_perm(box_office_id, 'orders.view') or has_perm(box_office_id, 'customers.profiles'));
create policy customer_notes_team on customer_notes for select using (has_perm(box_office_id, 'customers.profiles'));
-- event_presence has no policy: nobody reads it directly (admin_load summarises it)
create policy waitlist_team on waitlist for select using (has_perm(box_office_id, 'orders.view', event_id) or has_perm(box_office_id, 'comms.lists', event_id));
alter table event_views enable row level security;
create policy views_team on event_views for select using (exists(select 1 from events e where e.id = event_id and has_perm(e.box_office_id, 'events.view', e.id)));
alter table seat_status enable row level security; alter table seat_log enable row level security;
create policy seat_status_team on seat_status for select using (has_perm(box_office_id, 'seating.view', event_id));
create policy seat_log_team on seat_log for select using (has_perm(box_office_id, 'seating.view', event_id));
alter table promos enable row level security; alter table tracking_codes enable row level security;   -- written only through save_promo() / save_tracking()
create policy promos_team on promos for select using (has_perm(box_office_id, 'tickets.discounts') or has_perm(box_office_id, 'tickets.discountsEdit') or has_perm(box_office_id, 'finance.reports'));
create policy tracking_team on tracking_codes for select using (has_perm(box_office_id, 'tickets.tracking') or has_perm(box_office_id, 'finance.reports'));
create policy broadcasts_read on broadcasts for select using (has_perm(box_office_id, 'comms.email', event_id) or has_perm(box_office_id, 'comms.notify', event_id));
create policy broadcasts_insert on broadcasts for insert with check (has_perm(box_office_id, 'comms.email', event_id));
create policy audit_read on audit_log for select using (is_super() or has_perm(box_office_id, 'admin.perms') or actor = me_email() or (target is not null and has_perm(box_office_id, 'events.edit', target)));
create policy audit_insert on audit_log for insert with check (actor = me_email() and (box_office_id is null or is_member(box_office_id)));
-- no update/delete policies: the activity log is append-only
alter table payment_accounts enable row level security; alter table outbox enable row level security;
create policy payment_accounts_team on payment_accounts for select using (has_perm(box_office_id, 'admin.payments'));
create policy outbox_team on outbox for select using (has_perm(box_office_id, 'orders.view'));

-- Buyers never see secrets or internal columns.
revoke select on events from anon;
grant select (id, box_office_id, slug, status, data, created_at, updated_at) on events to anon;
revoke select on box_offices from anon;
grant select (id, slug, name, status, branding, settings, gateway, platform_fee) on box_offices to anon;
grant select on platform_public to anon, authenticated;
revoke select on seat_status from anon, authenticated;   -- buyers' hold tokens never leave the server
grant select (id, box_office_id, event_id, slot_id, seat, status, note, by, at, expires_at) on seat_status to authenticated;

-- ── Guard rails no client can bypass ─────────────────────────────────────────────
-- Members: no privilege escalation, owner is untouchable, nobody edits their own permissions; every change logged.
create or replace function members_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare b box_offices%rowtype; extra text[];
begin
  select * into b from box_offices where id = new.box_office_id;
  if tg_op = 'UPDATE' and old.email = b.owner and new.status <> 'active' then raise exception 'Transfer ownership before removing the owner'; end if;
  if tg_op = 'UPDATE' and old.email = me_email() and not is_super() and new.perms is distinct from old.perms then raise exception 'You can''t change your own permissions'; end if;
  if not is_super() and me_email() <> b.owner then
    select array_agg(p) into extra from unnest(new.perms) p where not has_perm(new.box_office_id, p);
    if extra is not null then raise exception 'You can only grant permissions you have yourself (%)', array_to_string(extra, ', '); end if;
  end if;
  if tg_op = 'UPDATE' and not is_super() and me_email() <> b.owner then
    if (new.perms is distinct from old.perms or new.all_events is distinct from old.all_events or new.event_ids is distinct from old.event_ids) and not has_perm(new.box_office_id, 'admin.perms') then raise exception 'You don''t have permission to edit permissions'; end if;
    if new.status is distinct from old.status and not has_perm(new.box_office_id, 'admin.remove') then raise exception 'You don''t have permission to remove members'; end if;
  end if;
  if tg_op = 'INSERT' then
    new.added_by := coalesce(nullif(me_email(),''), new.added_by);
    perform log_action(new.box_office_id, 'team.invited', format('Invited %s (%s permissions)', new.email, coalesce(array_length(new.perms,1),0)), null, jsonb_build_object('perms', new.perms, 'events', case when new.all_events then to_jsonb('all'::text) else to_jsonb(new.event_ids) end));
  elsif new.status = 'removed' and old.status = 'active' then
    new.removed_at := now(); new.removed_by := me_email();
    perform log_action(new.box_office_id, 'team.removed', format('Removed %s — access revoked immediately', new.email), jsonb_build_object('perms', old.perms), null);
  elsif new.perms is distinct from old.perms or new.all_events is distinct from old.all_events or new.event_ids is distinct from old.event_ids then
    perform log_action(new.box_office_id, 'team.permissions', format('Changed %s', new.email),
      jsonb_build_object('perms', old.perms, 'events', case when old.all_events then to_jsonb('all'::text) else to_jsonb(old.event_ids) end),
      jsonb_build_object('perms', new.perms, 'events', case when new.all_events then to_jsonb('all'::text) else to_jsonb(new.event_ids) end));
  end if;
  return new;
end $$;
drop trigger if exists members_guard on members;
create trigger members_guard before insert or update on members for each row execute function members_guard();

-- Box offices: status/owner/slug ownership are platform-only (changed through the RPCs, which set set_config('set.platform','1')).
create or replace function box_offices_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.status is distinct from old.status or new.owner is distinct from old.owner) and coalesce(current_setting('set.platform', true), '') <> '1' then
    raise exception 'Status and ownership change only through the platform'; end if;
  if (new.gateway is distinct from old.gateway or new.platform_fee is distinct from old.platform_fee) and coalesce(current_setting('set.platform', true), '') <> '1'
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Payment processor and platform fee change only through Settings → Payments / the platform'; end if;
  if new.branding is distinct from old.branding or new.settings is distinct from old.settings or new.name is distinct from old.name or new.slug is distinct from old.slug then
    perform log_action(new.id, 'settings.updated', 'Changed box office ' || concat_ws(', ',
      case when new.name is distinct from old.name then 'name' end, case when new.slug is distinct from old.slug then 'slug' end,
      case when new.branding is distinct from old.branding then 'branding' end, case when new.settings is distinct from old.settings then 'settings' end)); end if;
  if new.templates is distinct from old.templates then perform log_action(new.id, 'team.templates', 'Edited permission templates'); end if;
  return new;
end $$;
drop trigger if exists box_offices_guard on box_offices;
create trigger box_offices_guard before update on box_offices for each row execute function box_offices_guard();

-- Events: publishing needs events.publish; important changes are logged with before/after.
-- prices, price rules, product and package prices (mirrors priceSig() in data.js): changing them needs tickets.pricing
create or replace function price_sig(d jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_array(
    (select coalesce(jsonb_agg(jsonb_build_array(t->'id', coalesce((t->>'price')::numeric, 0), coalesce(t->'phases','[]'), coalesce(t->'breaks','[]'), coalesce(t->'slotPrices','{}')) order by o), '[]') from jsonb_array_elements(coalesce(d->'ticketTypes','[]')) with ordinality z(t, o)),
    (select coalesce(jsonb_agg(jsonb_build_array(x->'id', coalesce((x->>'price')::numeric, 0)) order by o), '[]') from jsonb_array_elements(coalesce(d->'addons','[]')) with ordinality z(x, o)),
    (select coalesce(jsonb_agg(jsonb_build_array(x->'id', coalesce((x->>'price')::numeric, 0)) order by o), '[]') from jsonb_array_elements(coalesce(d->'bundles','[]')) with ordinality z(x, o))) $$;
create or replace function events_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare b jsonb := '{}'; a jsonb := '{}'; k text;
begin
  if tg_op = 'INSERT' then perform log_action(new.box_office_id, 'event.created', 'Created event “' || (new.data->>'name') || '”', null, null, new.id); return new; end if;
  if new.box_office_id <> old.box_office_id then raise exception 'Events cannot move between box offices'; end if;
  if (new.status <> old.status or (new.data->'archived') is distinct from (old.data->'archived')) and not has_perm(new.box_office_id, 'events.publish', new.id) then
    raise exception 'You don''t have permission to publish, cancel or archive events'; end if;
  if price_sig(new.data) is distinct from price_sig(old.data) and not has_perm(new.box_office_id, 'tickets.pricing', new.id) then
    raise exception 'You don''t have permission to change ticket prices'; end if;
  if new.status <> old.status then b := b || jsonb_build_object('Status', old.status); a := a || jsonb_build_object('Status', new.status); end if;
  foreach k in array array['name','start','end','allDay','venue','address','online','capacity','visibility','publishAt','salesStart','salesEnd','archived','waitlistMode','currency','contact','policies','timeSlots','addons','bundles','upsells','entrances'] loop
    if (new.data->k) is distinct from (old.data->k) then b := b || jsonb_build_object(k, old.data->k); a := a || jsonb_build_object(k, new.data->k); end if;
  end loop;
  if (new.data->'ticketTypes') is distinct from (old.data->'ticketTypes') then b := b || jsonb_build_object('ticketTypes', old.data->'ticketTypes'); a := a || jsonb_build_object('ticketTypes', new.data->'ticketTypes'); end if;
  if (new.data->'seating') is distinct from (old.data->'seating') then
    -- a layout edit can never delete a seat somebody holds a ticket for
    if exists(select 1 from tickets t where t.event_id = new.id and t.status = 'valid' and t.seat is not null and not coalesce(new.data->'seating'->'meta', '{}') ? t.seat) then
      raise exception 'Sold seats would disappear from the map. Move those customers first, or block the seats instead.'; end if;
    if (new.data->'seating'->'sections') is distinct from (old.data->'seating'->'sections') or (new.data->'seating'->'levels') is distinct from (old.data->'seating'->'levels')
       or (new.data->'seating'->'removed') is distinct from (old.data->'seating'->'removed') then b := b || '{"Seating map":"previous layout"}'; a := a || '{"Seating map":"new layout"}'; end if;
    if (new.data->'seating'->'noSingles') is distinct from (old.data->'seating'->'noSingles') then b := b || jsonb_build_object('Single-seat gap rule', old.data->'seating'->'noSingles'); a := a || jsonb_build_object('Single-seat gap rule', new.data->'seating'->'noSingles'); end if;
    -- per-seat price / area changes go into the seat history
    insert into seat_log(box_office_id, event_id, seat, action, detail, by)
      select new.box_office_id, new.id, m.k, 'price', 'Price level '
        || coalesce((select x->>'name' from jsonb_array_elements(old.data->'ticketTypes') x where x->>'id' = old.data->'seating'->'index'->>m.k), 'not for sale') || ' → '
        || coalesce((select x->>'name' from jsonb_array_elements(new.data->'ticketTypes') x where x->>'id' = new.data->'seating'->'index'->>m.k), 'not for sale'), me_email()
      from (select key k from jsonb_each(coalesce(new.data->'seating'->'meta','{}')) where coalesce(old.data->'seating'->'meta','{}') ? key) m
      where (old.data->'seating'->'index'->>m.k) is distinct from (new.data->'seating'->'index'->>m.k);
    insert into seat_log(box_office_id, event_id, seat, action, detail, by)
      select new.box_office_id, new.id, key, 'area', 'Seating area ' || (old.data->'seating'->'meta'->key->>0) || ' → ' || (value->>0), me_email()
      from jsonb_each(coalesce(new.data->'seating'->'meta','{}')) where coalesce(old.data->'seating'->'meta','{}') ? key and (old.data->'seating'->'meta'->key->>0) is distinct from (value->>0);
    if (new.data->'seating'->'index') is distinct from (old.data->'seating'->'index') then b := b || '{"Seat prices":""}'; a := a || '{"Seat prices":"changed"}'; end if;
    if (new.data->'seating'->'areas') is distinct from (old.data->'seating'->'areas') then b := b || '{"Seating areas":""}'; a := a || '{"Seating areas":"changed"}'; end if;
  end if;
  if (new.secrets->>'password' <> '') is distinct from (old.secrets->>'password' <> '') then b := b || jsonb_build_object('Password', old.secrets->>'password' <> ''); a := a || jsonb_build_object('Password', new.secrets->>'password' <> ''); end if;
  if a <> '{}' then perform log_action(new.box_office_id, 'event.updated', 'Updated “' || (new.data->>'name') || '”: ' || (select string_agg(x, ', ') from jsonb_object_keys(a) x), b, a, new.id); end if;
  new.updated_at := now(); return new;
end $$;
drop trigger if exists events_guard on events;
create trigger events_guard before insert or update on events for each row execute function events_guard();

create or replace function orders_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and coalesce(current_setting('set.system', true), '') <> '1' and not has_perm(new.box_office_id,
     case new.status when 'refunded' then 'orders.refund' when 'cancelled' then 'orders.cancel' else 'orders.edit' end, new.event_ids[1]) then
    raise exception 'You don''t have permission to mark this order %', new.status; end if;
  if new.status = 'refunded' and old.status <> 'refunded' then new.data := new.data || jsonb_build_object('refunded', coalesce((new.data->>'total')::bigint, 0)); end if;
  if new.status = 'paid' and old.status <> 'paid' then new.paid_at := coalesce(new.paid_at, now()); end if;
  if new.status is distinct from old.status and coalesce(current_setting('set.system', true), '') <> '1' then
    perform log_action(new.box_office_id, 'order.' || new.status, format('Order %s: %s → %s', new.ref, old.status, new.status), jsonb_build_object('status', old.status), jsonb_build_object('status', new.status), new.event_ids[1]); end if;
  return new;
end $$;
drop trigger if exists orders_audit on orders;
create trigger orders_audit before update on orders for each row execute function orders_audit();
-- staff "Mark paid" on a reservation, or the processor confirming a card payment: the order's tickets are issued now (once)
create or replace function orders_paid() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and old.status in ('pending','awaiting_payment','expired') then perform issue_order_tickets(new.id, coalesce(nullif(me_email(), ''), new.buyer_email)); end if;
  return null;
end $$;
drop trigger if exists orders_paid on orders;
create trigger orders_paid after update of status on orders for each row execute function orders_paid();

-- ── Public RPCs ────────────────────────────────────────────────────────────────
create or replace function rand_code(n int) returns text language sql volatile as
$$ select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random()*32)::int, 1), '') from generate_series(1, n) $$;

drop function if exists availability(uuid);
-- seats: sold "slot|seat" keys; off: seats nobody else can pick right now (blocked / held / unavailable / in another buyer's checkout).
-- an order that uses stock: paid, a pay-later reservation, or a card checkout still inside its time
create or replace function order_counts(o orders) returns boolean language sql stable as $$
  select o.status in ('paid','pending') or (o.status = 'awaiting_payment' and o.expires_at > now()) $$;
-- every ticket an unpaid-but-reserved order will become (ticket type, showtime, seat) — off the shelf until paid or expired
create or replace function reserved_units(p_event uuid) returns table(tt text, slot text, seat text) language sql stable security definer set search_path = public as $$
  select case when l->>'kind' = 'ticket' then l->>'ticketTypeId' else l->'tts'->>(g - 1) end, nullif(l->>'slotId',''), l->'seats'->>(g - 1)
  from orders o, jsonb_array_elements(o.data->'lines') l,
    generate_series(1, case when l->>'kind' = 'ticket' then (l->>'qty')::int * coalesce(nullif((l->>'admits')::int, 0), 1)
                            when l->>'kind' = 'bundle' then jsonb_array_length(coalesce(l->'tts','[]')) else 0 end) g
  where p_event = any(o.event_ids) and l->>'eventId' = p_event::text and o.status <> 'paid' and order_counts(o) $$;
create or replace function availability(p_event uuid, p_token text default null) returns jsonb language sql stable security definer set search_path = public as $$
  with u as (select ticket_type_id tt, slot_id slot, seat from tickets where event_id = p_event and status = 'valid'
             union all select tt, slot, seat from reserved_units(p_event))
  select jsonb_build_object(
    'tt',    coalesce((select jsonb_object_agg(k, c) from (select tt k, count(*) c from u group by 1) a), '{}'),
    'slots', coalesce((select jsonb_object_agg(k, c) from (select slot k, count(*) c from u where slot is not null group by 1) a), '{}'),
    'seats', coalesce((select jsonb_agg(coalesce(slot,'') || '|' || seat) from u where seat is not null), '[]'),
    'off',   coalesce((select jsonb_agg(slot_id || '|' || seat) from seat_status where event_id = p_event
               and not (status = 'checkout' and (expires_at <= now() or token = p_token))), '[]'),
    'total', (select count(*) from u),
    -- products and packages already sold (a package's products count against the product's stock)
    'ad', coalesce((select jsonb_object_agg(k, c) from (select k, sum(n) c from (
        select l->>'addonId' k, (l->>'qty')::int - coalesce((l->>'removed')::int, 0) n from orders o, jsonb_array_elements(o.data->'lines') l
          where p_event = any(o.event_ids) and order_counts(o) and l->>'kind' = 'addon' and l->>'eventId' = p_event::text
        union all
        select x->>'addonId', greatest(1, coalesce((x->>'qty')::int, 1)) * (l->>'qty')::int from orders o, jsonb_array_elements(o.data->'lines') l, jsonb_array_elements(coalesce(l->'addons','[]')) x
          where p_event = any(o.event_ids) and order_counts(o) and l->>'kind' = 'bundle' and l->>'eventId' = p_event::text) u group by k) a), '{}'),
    'bd', coalesce((select jsonb_object_agg(k, c) from (select l->>'bundleId' k, sum((l->>'qty')::int) c from orders o, jsonb_array_elements(o.data->'lines') l
          where p_event = any(o.event_ids) and order_counts(o) and l->>'kind' = 'bundle' and l->>'eventId' = p_event::text group by 1) a), '{}'));
$$;

-- ── Seats (Stage 3) ────────────────────────────────────────────────────────────
-- "Stalls centre · Row A · Seat 12" from the event's derived seat meta
create or replace function seat_text(e events, p_seat text) returns text language sql stable as $$
  select coalesce(concat_ws(' · ', nullif(e.data->'seating'->'meta'->p_seat->>0, ''), nullif(e.data->'seating'->'meta'->p_seat->>3, ''), 'Row ' || nullif(e.data->'seating'->'meta'->p_seat->>1, ''),
    'Seat ' || nullif(e.data->'seating'->'meta'->p_seat->>2, '')), p_seat) $$;
-- What stops this seat being sold right now (null = nothing). Staff may sell a seat they're holding; a buyer may buy their own checkout hold.
create or replace function seat_blocker(p_event uuid, p_slot text, p_seat text, p_token text, p_staff boolean) returns text language sql stable as $$
  select status from seat_status where event_id = p_event and seat = p_seat and slot_id in (coalesce(p_slot,''), '')
    and not (status = 'checkout' and (expires_at <= now() or token = p_token)) and not (p_staff and status = 'held')
  order by case status when 'unavailable' then 4 when 'blocked' then 3 when 'held' then 2 else 1 end desc limit 1 $$;
create or replace function seat_free(e events, p_slot text, p_seat text, p_token text) returns boolean language sql stable as $$
  select coalesce(e.data->'seating'->'index', '{}') ? p_seat
    and not exists(select 1 from tickets t where t.event_id = e.id and t.status = 'valid' and t.seat = p_seat and coalesce(t.slot_id,'') = coalesce(p_slot,''))
    and not exists(select 1 from reserved_units(e.id) r where r.seat = p_seat and coalesce(r.slot,'') = coalesce(p_slot,''))
    and seat_blocker(e.id, p_slot, p_seat, p_token, false) is null $$;
-- Single-seat gap rule (mirrors singleGaps() in data.js): seats this selection would leave stranded alone in a row.
create or replace function single_gaps(e events, p_slot text, p_seats text[], p_token text) returns text[] language plpgsql stable as $$
declare r jsonb; ids text[]; n int; i int; bef boolean[]; aft boolean[]; bad text[] := '{}';
begin
  for r in select value from jsonb_each(coalesce(e.data->'seating'->'rows', '{}')) loop
    select array_agg(x order by o) into ids from jsonb_array_elements_text(r) with ordinality as t(x, o);
    if not (ids && p_seats) then continue; end if;
    n := array_length(ids, 1); bef := '{}'; aft := '{}';
    for i in 1 .. n loop
      bef := bef || (ids[i] is not null and seat_free(e, p_slot, ids[i], p_token));
      aft := aft || (bef[i] and not (ids[i] = any(p_seats)));
    end loop;
    for i in 1 .. n loop
      if aft[i] and not coalesce(aft[i-1], false) and not coalesce(aft[i+1], false)
         and not (bef[i] and not coalesce(bef[i-1], false) and not coalesce(bef[i+1], false)) then bad := bad || ids[i]; end if;
    end loop;
  end loop;
  return bad;
end $$;
-- A buyer's 10-minute hold while they check out. p_token = a random id from their browser.
create or replace function hold_seats(p_event uuid, p_slot text, p_seats text[], p_token text) returns jsonb language plpgsql security definer set search_path = public as $$
declare e events%rowtype; s text; blk text; gaps text[]; exp timestamptz := now() + interval '10 minutes';
begin
  select * into e from events where id = p_event;
  if not found or not event_live(e) then raise exception 'Event is not on sale'; end if;
  if not coalesce((e.data->'seating'->>'enabled')::boolean, false) then return null; end if;
  if coalesce(length(p_token), 0) not between 8 and 64 then raise exception 'bad token'; end if;
  if coalesce(array_length(p_seats, 1), 0) > 10 then raise exception 'Maximum 10 seats per order'; end if;
  perform pg_advisory_xact_lock(hashtext(e.id::text));
  foreach s in array coalesce(p_seats, '{}') loop
    if not seat_free(e, p_slot, s, p_token) then
      blk := seat_blocker(e.id, p_slot, s, p_token, false);
      raise exception '% %', seat_text(e, s), case when blk = 'checkout' then 'is being held by another buyer — try again in a few minutes' else 'is no longer available' end; end if;
  end loop;
  if coalesce((e.data->'seating'->>'noSingles')::boolean, false) then
    gaps := single_gaps(e, p_slot, p_seats, p_token);
    if array_length(gaps, 1) > 0 then raise exception 'Please don''t leave a single empty seat next to your selection (%). Move over one seat, or include it.', (select string_agg(seat_text(e, g), '; ') from unnest(gaps) g); end if;
  end if;
  delete from seat_status where event_id = e.id and status = 'checkout' and token = p_token;
  insert into seat_status(box_office_id, event_id, slot_id, seat, status, by, expires_at, token)
    select e.box_office_id, e.id, coalesce(p_slot,''), x, 'checkout', 'buyer', exp, p_token from unnest(coalesce(p_seats, '{}')) x;
  return jsonb_build_object('expires', exp);
end $$;
create or replace function release_seats(p_event uuid, p_token text) returns void language sql security definer set search_path = public as $$
  delete from seat_status where status = 'checkout' and token = p_token and (p_event is null or event_id = p_event) $$;
-- Staff seat management, any number of seats at once. p_slot '' = every showtime.
-- p_action: block | unblock | hold {note} | release | unavailable | available | price {ttId} | area {area} | move {to}
create or replace function seat_action(p_event uuid, p_slot text, p_action text, p_seats text[], p jsonb default '{}') returns void language plpgsql security definer set search_path = public as $$
declare e events%rowtype; st text; perm text; s text; sec jsonb; v text; d jsonb; t tickets%rowtype; o_ref text; cnt int; sl text := coalesce(p_slot, '');
  kinds text[]; lbl text;
begin
  select * into e from events where id = p_event; if not found then raise exception 'Event not found'; end if;
  perm := case p_action when 'block' then 'seating.block' when 'hold' then 'seating.block' when 'unblock' then 'seating.unblock' when 'release' then 'seating.unblock'
    when 'unavailable' then 'seating.edit' when 'available' then 'seating.edit' when 'price' then 'seating.edit' when 'area' then 'seating.edit' when 'move' then 'seating.move' end;
  if perm is null then raise exception 'Unknown seat action'; end if;
  if not has_perm(e.box_office_id, perm, e.id) or (p_action = 'price' and not has_perm(e.box_office_id, 'tickets.pricing', e.id)) then
    raise exception 'You don''t have permission to do that (%)', perm; end if;
  select coalesce(array_agg(distinct x), '{}') into p_seats from unnest(p_seats) x where coalesce(e.data->'seating'->'meta', '{}') ? x;
  cnt := coalesce(array_length(p_seats, 1), 0); if cnt = 0 then raise exception 'Select at least one seat'; end if;
  perform pg_advisory_xact_lock(hashtext(e.id::text));
  if p_action in ('block', 'hold', 'unavailable') then
    st := case p_action when 'hold' then 'held' when 'block' then 'blocked' else 'unavailable' end;
    lbl := case p_action when 'hold' then 'Held' when 'block' then 'Blocked' else 'Made unavailable' end;
    delete from seat_status where event_id = e.id and slot_id = sl and seat = any(p_seats) and status <> 'checkout';
    insert into seat_status(box_office_id, event_id, slot_id, seat, status, note, by) select e.box_office_id, e.id, sl, x, st, left(p->>'note', 200), me_email() from unnest(p_seats) x;
    insert into seat_log(box_office_id, event_id, slot_id, seat, action, detail, by)
      select e.box_office_id, e.id, sl, x, st, concat_ws(' ', lbl, case when sl <> '' then 'for this showtime' when jsonb_array_length(coalesce(e.data->'timeSlots','[]')) > 0 then 'for every showtime' end,
        '— ' || nullif(p->>'note', '')), me_email() from unnest(p_seats) x;
  elsif p_action in ('unblock', 'release', 'available') then
    kinds := case p_action when 'unblock' then array['blocked'] when 'release' then array['held','checkout'] else array['unavailable'] end;
    with gone as (delete from seat_status where event_id = e.id and seat = any(p_seats) and status = any(kinds) and slot_id in (sl, '') returning seat)
    insert into seat_log(box_office_id, event_id, slot_id, seat, action, detail, by)
      select distinct e.box_office_id, e.id, sl, seat, case p_action when 'release' then 'released' else p_action end,
        case p_action when 'unblock' then 'Unblocked' when 'release' then 'Released' else 'Made available' end, me_email() from gone;
  elsif p_action in ('price', 'area') then
    d := e.data;
    foreach s in array p_seats loop
      select x into sec from jsonb_array_elements(d->'seating'->'sections') x where x->>'code' = split_part(s, '-', 1);
      if p_action = 'price' then
        v := nullif(p->>'ttId', '');
        if v is not null and not exists(select 1 from jsonb_array_elements(d->'ticketTypes') x where x->>'id' = v) then raise exception 'Unknown price level'; end if;
        d := jsonb_set(d, '{seating,prices}', case when v is null or v = sec->>'ticketTypeId' then coalesce(d->'seating'->'prices','{}') - s else coalesce(d->'seating'->'prices','{}') || jsonb_build_object(s, v) end);
        v := coalesce(v, nullif(sec->>'ticketTypeId', ''));
        d := jsonb_set(d, '{seating,index}', case when v is null then coalesce(d->'seating'->'index','{}') - s else coalesce(d->'seating'->'index','{}') || jsonb_build_object(s, v) end);
      else
        v := nullif(left(trim(coalesce(p->>'area', '')), 60), '');
        d := jsonb_set(d, '{seating,areas}', case when v is null or v = coalesce(nullif(sec->>'area',''), sec->>'name') then coalesce(d->'seating'->'areas','{}') - s else coalesce(d->'seating'->'areas','{}') || jsonb_build_object(s, v) end);
        d := jsonb_set(d, array['seating','meta',s,'0'], to_jsonb(coalesce(v, nullif(sec->>'area',''), sec->>'name', sec->>'code')));
      end if;
    end loop;
    update events set data = d where id = e.id;   -- events_guard writes each seat's price / area change into seat_log
  elsif p_action = 'move' then   -- same price level only; upgrades / downgrades go through the order (price difference)
    s := p->>'to';
    select * into t from tickets where event_id = e.id and status = 'valid' and seat = p_seats[1] and coalesce(slot_id,'') = sl;
    if not found then raise exception 'That seat has no ticket to move'; end if;
    if not coalesce(e.data->'seating'->'meta', '{}') ? s then raise exception 'Choose the new seat'; end if;
    if e.data->'seating'->'index'->>s is distinct from t.ticket_type_id then raise exception 'That seat is a different price level — use Change seats on the order to upgrade or downgrade'; end if;
    perform set_config('set.system', '1', true);
    d := change_order_tickets(t.order_id, jsonb_build_object('changes', jsonb_build_array(jsonb_build_object('ticket', t.id, 'seat', s))), me_email(), true);
    insert into order_log(box_office_id, order_id, ref, event_id, kind, summary, by, note, data) select o.box_office_id, o.id, o.ref, e.id, 'change',
      'moved from ' || seat_text(e, p_seats[1]) || ' to ' || seat_text(e, s) || ' (seat inventory)', me_email(), coalesce(p->>'note',''), d from orders o where o.id = t.order_id;
    perform queue_mail(o, 'updated', 'Your updated tickets', 'Your seat has changed. Your new ticket is attached — the old one no longer works.', me_email()) from orders o where o.id = t.order_id;
    perform set_config('set.system', '', true);
  end if;
  perform log_action(e.box_office_id, 'seats.' || p_action, format('%s %s seat%s — %s', initcap(p_action), cnt, case when cnt = 1 then '' else 's' end, e.data->>'name'), null, null, e.id);
end $$;
-- Master venue charts live on the box office; seating.edit manages them.
create or replace function save_venues(p_bo uuid, p jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_perm(p_bo, 'seating.edit') then raise exception 'You don''t have permission to edit venue charts'; end if;
  if jsonb_typeof(p) <> 'array' then raise exception 'bad venues'; end if;
  update box_offices set venues = p where id = p_bo;
  perform log_action(p_bo, 'venues.saved', 'Edited venue charts (' || jsonb_array_length(p) || ')');
end $$;
-- Cancelled / refunded tickets release their seats — on the seat's record.
create or replace function tickets_seat_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'valid' and new.status <> 'valid' and new.seat is not null and coalesce(current_setting('set.system', true), '') <> '1' then   -- order_action logs its own
    insert into seat_log(box_office_id, event_id, slot_id, seat, action, detail, by, ref)
      select new.box_office_id, new.event_id, coalesce(new.slot_id,''), new.seat, 'cancelled', 'Order ' || o.ref || ' ' || o.status || ' — seat released', me_email(), o.ref from orders o where o.id = new.order_id;
  end if;
  return new;
end $$;
-- every ticket write bumps touched_at, so scanners only pull what changed (door_sync)
create or replace function tickets_touch() returns trigger language plpgsql as $$ begin new.touched_at := now(); return new; end $$;
drop trigger if exists tickets_touch on tickets;
create trigger tickets_touch before insert or update on tickets for each row execute function tickets_touch();
drop trigger if exists tickets_seat_log on tickets;
create trigger tickets_seat_log after update on tickets for each row execute function tickets_seat_log();

drop function if exists check_discount(uuid, text);
-- ── Pricing, promo codes, products, packages, tracking (Stage 4) — mirrors the pricing section of data.js line for line ──
create or replace function in_window(p_from text, p_until text) returns boolean language sql stable as $$
  select (nullif(p_from,'') is null or p_from::timestamptz <= now()) and (nullif(p_until,'') is null or p_until::timestamptz > now()) $$;
-- [] = any
create or replace function any_of(p_list jsonb, p_v text) returns boolean language sql immutable as $$
  select jsonb_array_length(coalesce(p_list,'[]')) = 0 or exists(select 1 from jsonb_array_elements_text(p_list) x where x = p_v) $$;
-- split a whole number of cents over weights, exactly
create or replace function spread(p_total bigint, p_w bigint[]) returns bigint[] language plpgsql immutable as $$
declare n int := coalesce(array_length(p_w, 1), 0); w bigint[]; s numeric; o bigint[] := '{}'; lft bigint; i int;
begin
  if n = 0 then return '{}'; end if;
  w := array(select greatest(0, coalesce(x, 0)) from unnest(p_w) with ordinality z(x, k) order by k);
  s := (select sum(x) from unnest(w) x);
  for i in 1 .. n loop o := o || (case when s > 0 then floor(p_total::numeric * w[i] / s) else floor(p_total::numeric / n) end)::bigint; end loop;
  lft := p_total - (select sum(x) from unnest(o) x); i := 1;
  while lft > 0 loop if s = 0 or w[i] > 0 then o[i] := o[i] + 1; lft := lft - 1; end if; i := i % n + 1; end loop;
  return o;
end $$;
create or replace function list_price(tt jsonb, p_slot text) returns bigint language sql immutable as $$
  select case when tt is null then 0 else greatest(0, round(coalesce(case when coalesce(tt->'slotPrices'->>coalesce(p_slot,''), '') <> ''
    then (tt->'slotPrices'->>p_slot)::numeric else (tt->>'price')::numeric end, 0)))::bigint end $$;
create or replace function fee_of(p_unit bigint, p_tickets int, st jsonb) returns bigint language sql immutable as $$
  select case when p_unit > 0 and coalesce(st->>'feeMode','buyer') = 'buyer'
    then round(p_unit * coalesce((st->>'feePct')::numeric, 0) / 100)::bigint + p_tickets * coalesce((st->>'feeFixed')::bigint, 0) else 0 end $$;
-- price of one unit: the first active phase (dates + "until N sold"), else showtime/base price; a quantity break wins when lower
create or replace function unit_price(tt jsonb, p_slot text, p_sold int, br jsonb) returns jsonb language sql stable as $$
  with ph as (select x from jsonb_array_elements(coalesce(tt->'phases','[]')) with ordinality y(x, o)
      where in_window(x->>'from', x->>'until') and not (coalesce((x->>'upTo')::int, 0) > 0 and p_sold >= (x->>'upTo')::int) order by o limit 1),
    v as (select coalesce((select jsonb_build_object('price', greatest(0, round(coalesce((x->>'price')::numeric, 0)))::bigint, 'label', coalesce(nullif(x->>'label',''), 'Special price')) from ph),
      jsonb_build_object('price', list_price(tt, p_slot), 'label', '')) v)
  select case when br is not null and greatest(0, round(coalesce((br->>'price')::numeric, 0)))::bigint < (v->>'price')::bigint
    then jsonb_build_object('price', greatest(0, round((br->>'price')::numeric))::bigint, 'label', (br->>'min') || '+ price') else v end from v $$;
-- a package's ticket positions: one entry (allowed ticket types) per ticket in ONE package
create or replace function bundle_positions(b jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(coalesce(p->'ticketTypeIds','[]') order by o, g), '[]') from jsonb_array_elements(coalesce(b->'parts','[]')) with ordinality y(p, o),
    generate_series(1, greatest(0, coalesce((p->>'qty')::int, 0))) g $$;
-- ticket type of every ticket in a package line: seated → the seat's price level; general admission → buyer's pick (default the first allowed)
create or replace function bundle_tts(ev events, b jsonb, it jsonb) returns text[] language sql stable as $$
  with pos as (select bundle_positions(b) p), c as (select jsonb_array_length(p) n, p from pos)
  select coalesce(array_agg(case when coalesce((ev.data->'seating'->>'enabled')::boolean, false)
      then coalesce(ev.data->'seating'->'index'->>(it->'seats'->>(i - 1)), '')
      else coalesce(nullif(it->'picks'->>((i - 1) % c.n), ''), c.p->((i - 1) % c.n)->>0, '') end order by i), '{}')
  from c, generate_series(1, coalesce((it->>'qty')::int, 0) * c.n) i where c.n > 0 $$;
create or replace function addon_allowed(ad jsonb, mine jsonb) returns boolean language sql immutable as $$
  select (jsonb_array_length(coalesce(ad->'ticketTypeIds','[]')) = 0 or exists(select 1 from jsonb_array_elements_text(ad->'ticketTypeIds') x where coalesce(mine->'tts','[]') ? x))
     and (jsonb_array_length(coalesce(ad->'areas','[]')) = 0 or exists(select 1 from jsonb_array_elements_text(ad->'areas') x where coalesce(mine->'areas','[]') ? x)) $$;
-- a typed code: {promo} | {tracking} | null (one namespace per box office; bulk unique codes live in the promo's data.codes)
create or replace function find_code(p_bo uuid, p_code text) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('promo', x.data || jsonb_build_object('id', x.id, 'code', x.code)) from promos x
      where x.box_office_id = p_bo and (x.code = upper(trim(p_code)) or coalesce(x.data->'codes','[]') ? upper(trim(p_code))) limit 1),
    (select jsonb_build_object('tracking', t.data || jsonb_build_object('id', t.id, 'code', t.code)) from tracking_codes t where t.box_office_id = p_bo and t.code = upper(trim(p_code)) limit 1)) $$;
create or replace function promo_usable(p jsonb, p_code text, p_email text) returns text language plpgsql stable security definer set search_path = public as $$
declare used int; c text := upper(trim(p_code));
begin
  if p is null or not coalesce((p->>'active')::boolean, true) then return 'That code is not valid'; end if;
  if nullif(p->>'startsAt','') is not null and (p->>'startsAt')::timestamptz > now() then return format('Code %s isn''t active yet', p->>'code'); end if;
  if nullif(p->>'expires','') is not null and (p->>'expires')::timestamptz <= now() then return format('Code %s has expired', p->>'code'); end if;
  select count(*) into used from orders o where order_counts(o) and o.data->'promo'->>'id' = p->>'id';
  if coalesce((p->>'maxUses')::int, 0) > 0 and used >= (p->>'maxUses')::int then return format('Code %s has been fully used', p->>'code'); end if;
  if coalesce(p->'codes','[]') ? c and exists(select 1 from orders o where order_counts(o) and o.data->'promo'->>'id' = p->>'id' and upper(o.data->>'code') = c) then
    return format('Code %s has already been used', c); end if;
  if coalesce(p_email,'') <> '' and coalesce((p->>'perCustomer')::int, 0) > 0
     and (select count(*) from orders o where order_counts(o) and o.data->'promo'->>'id' = p->>'id' and o.buyer_email = lower(trim(p_email))) >= (p->>'perCustomer')::int then
    return format('You''ve already used code %s', p->>'code'); end if;
  return '';
end $$;
create or replace function tracking_usable(t jsonb, p_bo uuid, p_events uuid[]) returns boolean language sql stable security definer set search_path = public as $$
  select t is not null and coalesce((t->>'active')::boolean, true) and in_window(t->>'startsAt', t->>'expires')
    and (jsonb_array_length(coalesce(t->'eventIds','[]')) = 0 or exists(select 1 from jsonb_array_elements_text(t->'eventIds') e where e = any(p_events::text[])))
    and not (coalesce((t->>'maxUses')::int, 0) > 0 and (select count(*) from orders o where o.box_office_id = p_bo and order_counts(o) and o.data->>'tracking' = t->>'code') >= (t->>'maxUses')::int) $$;
-- what a buyer's browser may know about a promo: its targeting, never its limits or the other unique codes
create or replace function public_promo(p jsonb, p_code text) returns jsonb language sql immutable as $$
  select (p - 'codes' - 'note' - 'maxUses' - 'perCustomer' - 'created_at' - 'created_by' - 'box_office_id') || jsonb_build_object('code', upper(trim(p_code))) $$;
create or replace function check_code(p_events uuid[], p_code text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e events%rowtype; f jsonb; err text;
begin
  select * into e from events x where x.id = any(p_events) and event_live(x) limit 1;
  if not found then return null; end if;
  f := find_code(e.box_office_id, p_code); if f is null then return null; end if;
  if f ? 'promo' then
    err := promo_usable(f->'promo', p_code, '');
    return case when err <> '' then jsonb_build_object('kind', 'promo', 'error', err) else jsonb_build_object('kind', 'promo') || public_promo(f->'promo', p_code) end;
  end if;
  return case when tracking_usable(f->'tracking', e.box_office_id, p_events) then jsonb_build_object('kind', 'tracking', 'code', f->'tracking'->>'code') end;
end $$;
-- promo conditions + per-unit discounts (applyPromo in data.js). Returns {lines, err}.
create or replace function apply_promo(lines jsonb, p jsonb, p_subtotal bigint) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  scope jsonb := case when jsonb_array_length(coalesce(p->'scope','[]')) > 0 then p->'scope' else '["tickets","bundles"]' end;
  code text := p->>'code'; on_ text := coalesce(p->>'on','tickets'); amt numeric := coalesce((p->>'amount')::numeric, 0);
  tickets int; units jsonb := '[]'; take jsonb := '[]'; l jsonb; x jsonb; li int; u int; k int := 0; n int := 0; nt int := 0;
  area text; ev events%rowtype; dsum bigint; fsum bigint; ds bigint[]; fs bigint[]; d bigint; fd bigint; r numeric; a bigint;
begin
  tickets := (select coalesce(sum(case ln->>'kind' when 'ticket' then (ln->>'qty')::int * (ln->>'admits')::int when 'bundle' then (ln->>'qty')::int * (ln->>'perCopy')::int else 0 end), 0) from jsonb_array_elements(lines) ln);
  if coalesce((p->>'minQty')::int, 0) > 0 and tickets < (p->>'minQty')::int then return jsonb_build_object('lines', lines, 'err', format('Code %s needs at least %s tickets in the order', code, p->>'minQty')); end if;
  if coalesce((p->>'maxQty')::int, 0) > 0 and tickets > (p->>'maxQty')::int then return jsonb_build_object('lines', lines, 'err', format('Code %s is only for orders of up to %s tickets', code, p->>'maxQty')); end if;
  if coalesce((p->>'minSpend')::bigint, 0) > 0 and p_subtotal < (p->>'minSpend')::bigint then
    return jsonb_build_object('lines', lines, 'err', format('Code %s needs a minimum purchase of $%s', code, to_char((p->>'minSpend')::bigint / 100.0, 'FM999999990.00'))); end if;
  for li in 0 .. jsonb_array_length(lines) - 1 loop
    l := lines->li;
    if not any_of(p->'eventIds', l->>'eventId') then continue; end if;
    if l->>'kind' <> 'addon' and jsonb_array_length(coalesce(p->'slotIds','[]')) > 0 and not (p->'slotIds' ? coalesce(l->>'slotId','')) then continue; end if;
    select * into ev from events where id = (l->>'eventId')::uuid;
    for u in 0 .. (l->>'qty')::int - 1 loop
      if l->>'kind' = 'ticket' then
        area := coalesce(ev.data->'seating'->'meta'->(l->'seats'->>(u * (l->>'admits')::int))->>0, '');
        if not (scope ? 'tickets') or not any_of(p->'ticketTypeIds', l->>'ticketTypeId') or not any_of(p->'prices', l->>'unit') or not any_of(p->'areas', area) then continue; end if;
      elsif l->>'kind' = 'bundle' then
        if not (scope ? 'bundles') or not any_of(p->'bundleIds', l->>'bundleId') then continue; end if;
      elsif not (scope ? 'addons') or not any_of(p->'addonIds', l->>'addonId') then continue;
      end if;
      units := units || jsonb_build_array(jsonb_build_object('li', li, 'u', u, 'ord', jsonb_array_length(units), 'price', (l->>'unit')::bigint, 'fee', coalesce((l->>'unitFee')::bigint, 0),
        'tickets', case l->>'kind' when 'ticket' then 1 when 'bundle' then (l->>'perCopy')::int else 0 end));
    end loop;
  end loop;
  -- the most expensive items get the discount first, within the per-order caps
  for x in select v from jsonb_array_elements(units) v order by (v->>'price')::bigint desc, (v->>'ord')::int loop
    if (coalesce((p->>'maxItems')::int, 0) > 0 and n >= (p->>'maxItems')::int)
       or ((x->>'tickets')::int > 0 and coalesce((p->>'maxTickets')::int, 0) > 0 and nt + (x->>'tickets')::int > (p->>'maxTickets')::int) then continue; end if;
    n := n + 1; nt := nt + (x->>'tickets')::int; take := take || jsonb_build_array(x);
  end loop;
  if jsonb_array_length(take) = 0 then return jsonb_build_object('lines', lines, 'err', format('Code %s doesn''t apply to anything in your cart', code)); end if;
  if p->>'type' = 'order' then
    a := greatest(0, round(amt))::bigint;
    dsum := case when on_ = 'fee' then 0 else least(a, (select sum((v->>'price')::bigint) from jsonb_array_elements(take) v)) end;
    ds := spread(dsum, array(select (v->>'price')::bigint from jsonb_array_elements(take) with ordinality z(v, o) order by o));
    fsum := case when on_ = 'tickets' then 0 else least(a - dsum, (select sum((v->>'fee')::bigint) from jsonb_array_elements(take) v)) end;
    fs := spread(fsum, array(select (v->>'fee')::bigint from jsonb_array_elements(take) with ordinality z(v, o) order by o));
  end if;
  for x in select v from jsonb_array_elements(take) with ordinality z(v, o) order by o loop
    k := k + 1;
    if p->>'type' = 'order' then d := ds[k]; fd := fs[k];
    elsif p->>'type' = 'pct' then r := least(100, greatest(0, amt));
      d := case when on_ = 'fee' then 0 else round((x->>'price')::bigint * r / 100) end; fd := case when on_ = 'tickets' then 0 else round((x->>'fee')::bigint * r / 100) end;
    else a := greatest(0, round(amt))::bigint; d := case when on_ = 'fee' then 0 else least(a, (x->>'price')::bigint) end;
      fd := case when on_ = 'fee' then least(a, (x->>'fee')::bigint) when on_ = 'both' then least(a - d, (x->>'fee')::bigint) else 0 end;
    end if;
    li := (x->>'li')::int; u := (x->>'u')::int; l := lines->li;
    if l->'discs' is null then
      l := l || jsonb_build_object('discs', (select jsonb_agg(0) from generate_series(1, (l->>'qty')::int)), 'feeDiscs', (select jsonb_agg(0) from generate_series(1, (l->>'qty')::int)), 'disc', 0, 'feeDisc', 0); end if;
    l := jsonb_set(l, array['discs', u::text], to_jsonb((l->'discs'->>u)::bigint + d));
    l := jsonb_set(l, array['feeDiscs', u::text], to_jsonb((l->'feeDiscs'->>u)::bigint + fd));
    l := l || jsonb_build_object('disc', (l->>'disc')::bigint + d, 'feeDisc', (l->>'feeDisc')::bigint + fd);
    lines := jsonb_set(lines, array[li::text], l);
  end loop;
  return jsonb_build_object('lines', lines, 'err', '');
end $$;
-- The quote (quote() in data.js): ticket lines split where a price phase ends, package lines, product lines, promo, fees, tax.
create or replace function price_cart(p jsonb, p_manual boolean, st jsonb, p_promo jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  it jsonb; ad jsonb; ev events%rowtype; tt jsonb; b jsonb; slot jsonb; base jsonb; br jsonb; pr jsonb; r jsonb; adds jsonb;
  lines jsonb := '[]'; seen jsonb := '{}'; avs jsonb := '{}'; k text; adm int; sold int; inorder int; n int; i int; j int; per int;
  tts text[]; tf bigint[]; face bigint; unit bigint; uf bigint; ovr boolean; subtotal bigint; disc bigint; fdisc bigint; fee bigint; tax bigint; donation bigint; err text := '';
  paidtk int; pfee bigint := 0; sfee bigint; pre bigint; pfx bigint := 0; proc bigint; cr bigint; pf jsonb := coalesce(st->'platform', '{}'); cd jsonb := coalesce(st->'card', '{}');
begin
  for it in select * from jsonb_array_elements(coalesce(p->'items','[]')) loop
    select * into ev from events where id = (it->>'eventId')::uuid;
    if not found or coalesce((it->>'qty')::int, 0) < 1 then continue; end if;
    if not avs ? ev.id::text then avs := avs || jsonb_build_object(ev.id::text, availability(ev.id)); end if;
    slot := (select x from jsonb_array_elements(coalesce(ev.data->'timeSlots','[]')) x where x->>'id' = it->>'slotId');
    base := jsonb_build_object('eventId', ev.id, 'eventName', ev.data->>'name', 'slotId', nullif(it->>'slotId',''), 'slotStart', slot->>'start', 'currency', coalesce(ev.data->>'currency', st->>'currency', 'USD'));
    n := (it->>'qty')::int;
    if nullif(it->>'bundleId','') is not null then
      b := (select x from jsonb_array_elements(coalesce(ev.data->'bundles','[]')) x where x->>'id' = it->>'bundleId'); if b is null then continue; end if;
      tts := bundle_tts(ev, b, it); per := jsonb_array_length(bundle_positions(b));
      tf := array(select list_price((select x from jsonb_array_elements(ev.data->'ticketTypes') x where x->>'id' = t), it->>'slotId') from unnest(tts) with ordinality u(t, o) order by o);
      adds := (select coalesce(jsonb_agg(jsonb_build_object('addonId', a->>'id', 'name', a->>'name', 'qty', greatest(1, coalesce((x->>'qty')::int, 1)), 'face', greatest(0, round(coalesce((a->>'price')::numeric, 0)))::bigint) order by o), '[]')
        from jsonb_array_elements(coalesce(b->'addons','[]')) with ordinality y(x, o) join jsonb_array_elements(coalesce(ev.data->'addons','[]')) a on a->>'id' = x->>'addonId');
      unit := greatest(0, round(coalesce((b->>'price')::numeric, 0)))::bigint; uf := fee_of(unit, greatest(per, 1), st);
      lines := lines || jsonb_build_array(base || jsonb_build_object('kind', 'bundle', 'bundleId', b->>'id', 'name', b->>'name', 'qty', n, 'unit', unit, 'face', unit, 'perCopy', per,
        'tts', to_jsonb(tts), 'tfaces', to_jsonb(tf), 'addons', adds, 'seats', coalesce(it->'seats','[]'), 'admits', 1, 'unitFee', uf, 'fee', n * uf,
        'value', coalesce((select sum(x) from unnest(tf) x), 0) + n * coalesce((select sum((a->>'face')::bigint * (a->>'qty')::int) from jsonb_array_elements(adds) a), 0)));
      continue;
    end if;
    tt := (select x from jsonb_array_elements(ev.data->'ticketTypes') x where x->>'id' = it->>'ticketTypeId'); if tt is null then continue; end if;
    k := ev.id::text || '|' || (tt->>'id'); adm := coalesce(nullif((tt->>'admits')::int, 0), 1);
    sold := coalesce((avs->(ev.id::text)->'tt'->>(tt->>'id'))::int, 0) + coalesce((seen->>k)::int, 0);
    inorder := (select coalesce(sum((x->>'qty')::int), 0) from jsonb_array_elements(p->'items') x where x->>'eventId' = it->>'eventId' and x->>'ticketTypeId' = tt->>'id' and nullif(x->>'bundleId','') is null);
    seen := seen || jsonb_build_object(k, coalesce((seen->>k)::int, 0) + n * adm);
    br := (select x from jsonb_array_elements(coalesce(tt->'breaks','[]')) x where coalesce((x->>'min')::int, 0) > 1 and inorder >= (x->>'min')::int order by (x->>'min')::int desc limit 1);
    ovr := p_manual and coalesce(it->>'price','') <> '';
    i := 0;
    while i < n loop  -- a phase can end inside one order: one line per run of equal prices
      pr := unit_price(tt, it->>'slotId', sold + i * adm, br); j := i + 1;
      while j < n and unit_price(tt, it->>'slotId', sold + j * adm, br) = pr loop j := j + 1; end loop;
      face := (pr->>'price')::bigint; unit := case when ovr then greatest(0, round((it->>'price')::numeric))::bigint else face end; uf := fee_of(unit, 1, st);
      lines := lines || jsonb_build_array(base || jsonb_build_object('kind', 'ticket', 'ticketTypeId', tt->>'id', 'name', tt->>'name',
        'seats', coalesce((select jsonb_agg(s order by o) from jsonb_array_elements(coalesce(it->'seats','[]')) with ordinality z(s, o) where o > i * adm and o <= j * adm), '[]'),
        'qty', j - i, 'unit', unit, 'face', face, 'admits', adm, 'unitFee', uf, 'fee', (j - i) * uf)
        || case when pr->>'label' <> '' then jsonb_build_object('phase', pr->>'label') else '{}'::jsonb end || case when ovr then '{"override":true}'::jsonb else '{}'::jsonb end);
      i := j;
    end loop;
  end loop;
  for ad in select * from jsonb_array_elements(coalesce(p->'addons','[]')) loop
    select * into ev from events where id = (ad->>'eventId')::uuid;
    tt := (select x from jsonb_array_elements(coalesce(ev.data->'addons','[]')) x where x->>'id' = ad->>'addonId');
    if tt is null or coalesce((ad->>'qty')::int, 0) < 1 then continue; end if;
    unit := greatest(0, round(coalesce((tt->>'price')::numeric, 0)))::bigint;
    lines := lines || jsonb_build_array(jsonb_build_object('kind', 'addon', 'eventId', ev.id, 'eventName', ev.data->>'name', 'addonId', tt->>'id', 'name', tt->>'name', 'qty', (ad->>'qty')::int, 'unit', unit, 'face', unit, 'unitFee', 0, 'fee', 0));
  end loop;
  subtotal := (select coalesce(sum((l->>'unit')::bigint * (l->>'qty')::int), 0) from jsonb_array_elements(lines) l);
  if p_promo is not null then r := apply_promo(lines, p_promo, subtotal); lines := r->'lines'; err := r->>'err'; end if;
  disc := (select coalesce(sum((l->>'disc')::bigint), 0) from jsonb_array_elements(lines) l);
  fdisc := (select coalesce(sum((l->>'feeDisc')::bigint), 0) from jsonb_array_elements(lines) l);
  fee := (select coalesce(sum((l->>'fee')::bigint), 0) from jsonb_array_elements(lines) l) - fdisc;
  donation := greatest(0, round(coalesce((p->>'donation')::numeric, 0)))::bigint;
  -- Stage 5 breakdown (mirrors quote() in data.js): platform fee (organizer pays from payout, or buyer pays as a service fee), tax (+ on fees when set),
  -- card processing (the processor's cut; added to the total only when the box office passes it on)
  paidtk := (select coalesce(sum(case when l->>'kind' = 'ticket' then (l->>'qty')::int when l->>'kind' = 'bundle' then (l->>'qty')::int * (l->>'perCopy')::int else 0 end), 0)
             from jsonb_array_elements(lines) l where (l->>'unit')::bigint > 0);
  if subtotal - disc > 0 then pfee := round((subtotal - disc) * coalesce((pf->>'pct')::numeric, 0) / 100) + paidtk * coalesce((pf->>'fixed')::bigint, 0); end if;
  sfee := case when pf->>'payer' = 'buyer' then pfee else 0 end;
  tax := round((subtotal - disc + case when coalesce((st->>'taxOnFees')::boolean, false) then fee + sfee else 0 end) * coalesce((st->>'taxPct')::numeric, 0) / 100);
  pre := subtotal - disc + fee + sfee + tax + donation;
  cr := least(greatest(0, coalesce((p->>'creditAvail')::bigint, 0)), pre);   -- Stage 6: a credit pays first (set by place_order, never by the buyer)
  if p->>'payment' = 'card' and pre - cr > 0 then pfx := round((pre - cr) * coalesce((cd->>'pct')::numeric, 0) / 100) + coalesce((cd->>'fixed')::bigint, 0); end if;
  proc := case when coalesce((cd->>'pass')::boolean, false) then pfx else 0 end;
  return jsonb_build_object('lines', lines, 'subtotal', subtotal, 'discount', disc, 'feeDiscount', fdisc, 'fee', fee, 'serviceFee', sfee, 'tax', tax, 'donation', donation,
    'ticketsTotal', (select coalesce(sum((l->>'unit')::bigint * (l->>'qty')::int), 0) from jsonb_array_elements(lines) l where l->>'kind' in ('ticket','bundle')),
    'addonsTotal', (select coalesce(sum((l->>'unit')::bigint * (l->>'qty')::int), 0) from jsonb_array_elements(lines) l where l->>'kind' = 'addon'),
    'processing', proc, 'processingFee', pfx, 'platformFee', pfee, 'credit', cr, 'total', pre - cr + proc, 'promoErr', err,
    'faceValue', (select coalesce(sum(case when l->>'kind' = 'bundle' then (l->>'value')::bigint else (l->>'face')::bigint * (l->>'qty')::int end), 0) from jsonb_array_elements(lines) l),
    'currency', coalesce((select l->>'currency' from jsonb_array_elements(lines) l where l ? 'currency' limit 1), st->>'currency', 'USD'));
end $$;
-- ticket checks for n tickets of one type (inventory, capacity, showtime, seats). pend carries this order's running counts.
create or replace function order_check_tickets(ev events, av jsonb, it jsonb, tt jsonb, n int, seats text[], manual boolean, tok text, pend jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare adm int; k text; tk text := 'tot:' || ev.id; slot jsonb; sk text; s text; key text; blk text; mk text := 'mine:' || ev.id;
begin
  if tt is null then raise exception 'Unknown ticket type'; end if;
  adm := n * coalesce(nullif((tt->>'admits')::int, 0), 1); k := 'tt:' || ev.id || (tt->>'id');
  pend := pend || jsonb_build_object(k, coalesce((pend->>k)::int, 0) + adm, tk, coalesce((pend->>tk)::int, 0) + adm);
  if coalesce((tt->>'qty')::int, 0) > 0 and coalesce((av->'tt'->>(tt->>'id'))::int, 0) + (pend->>k)::int > (tt->>'qty')::int then
    raise exception 'Only % % left', greatest((tt->>'qty')::int - coalesce((av->'tt'->>(tt->>'id'))::int, 0), 0), tt->>'name'; end if;
  if coalesce((ev.data->>'capacity')::int, 0) > 0 and (av->>'total')::int + (pend->>tk)::int > (ev.data->>'capacity')::int then raise exception 'Event is sold out'; end if;
  if jsonb_array_length(coalesce(ev.data->'timeSlots','[]')) > 0 then
    slot := (select x from jsonb_array_elements(ev.data->'timeSlots') x where x->>'id' = it->>'slotId');
    if slot is null then raise exception 'Pick a time slot'; end if;
    if not manual and (coalesce((slot->>'hidden')::boolean, false) or coalesce((slot->>'unavailable')::boolean, false) or coalesce((slot->>'soldOut')::boolean, false)) then raise exception 'That showtime is not available'; end if;
    sk := 'sl:' || ev.id || (slot->>'id'); pend := pend || jsonb_build_object(sk, coalesce((pend->>sk)::int, 0) + n);
    if coalesce((slot->>'capacity')::int, 0) > 0 and coalesce((av->'slots'->>(slot->>'id'))::int, 0) + (pend->>sk)::int > (slot->>'capacity')::int then raise exception 'That time slot is full'; end if;
  end if;
  pend := pend || jsonb_build_object(mk, coalesce(pend->mk, '{"tts":[],"areas":[]}') || jsonb_build_object('tts', coalesce(pend->mk->'tts', '[]') || to_jsonb(tt->>'id')));
  if not coalesce((ev.data->'seating'->>'enabled')::boolean, false) then return pend; end if;
  if coalesce(array_length(seats, 1), 0) <> n then raise exception 'Pick % seat(s)', n; end if;
  foreach s in array seats loop
    key := coalesce(it->>'slotId','') || '|' || s;
    if not (coalesce(ev.data->'seating'->'index','{}') ? s) then raise exception '% is unavailable', seat_text(ev, s); end if;
    if ev.data->'seating'->'index'->>s <> tt->>'id' then raise exception '% isn''t a % seat', seat_text(ev, s), tt->>'name'; end if;
    if av->'seats' ? key or coalesce(pend->'seats','[]') ? (ev.id || key) then raise exception '% was just taken', seat_text(ev, s); end if;
    blk := seat_blocker(ev.id, coalesce(it->>'slotId',''), s, tok, manual);   -- staff may sell a seat they're holding
    if blk is not null then raise exception '% %', seat_text(ev, s), case when blk = 'checkout' then 'is being held by another buyer — try again in a few minutes' else 'is unavailable' end; end if;
    pend := pend || jsonb_build_object('seats', coalesce(pend->'seats','[]') || to_jsonb(ev.id || key));
    pend := jsonb_set(pend, array[mk, 'areas'], coalesce(pend->mk->'areas','[]') || to_jsonb(coalesce(ev.data->'seating'->'meta'->s->>0, '')));
  end loop;
  return pend;
end $$;
-- one issued ticket + its seat history row
create or replace function issue_ticket(p_bo uuid, p_order uuid, p_ref text, l jsonb, p_tt text, p_seat text, p_face bigint, p_paid bigint, p_disc bigint, p_promo text, p_tracking text,
  p_bundle jsonb, p_extras jsonb, p_comp boolean, p_holder text, p_by text, p_answers jsonb default '{}') returns void language plpgsql security definer set search_path = public as $$
declare e events%rowtype;
begin
  select * into e from events where id = (l->>'eventId')::uuid;
  insert into tickets(box_office_id, order_id, event_id, ticket_type_id, slot_id, seat, area, "row", seat_label, unit, comp, face, paid, discount, promo, tracking, bundle, extras, price_override, answers, code, holder)
  values (p_bo, p_order, e.id, p_tt, nullif(l->>'slotId',''), p_seat, e.data->'seating'->'meta'->p_seat->>0, e.data->'seating'->'meta'->p_seat->>1, e.data->'seating'->'meta'->p_seat->>2, nullif(e.data->'seating'->'meta'->p_seat->>3, ''),
    p_comp, p_face, p_paid, p_disc, case when p_disc > 0 then p_promo end, p_tracking, p_bundle, coalesce(p_extras, '[]'), coalesce((l->>'override')::boolean, false), coalesce(p_answers, '{}'), rand_code(10), p_holder);
  if p_seat is not null then
    insert into seat_log(box_office_id, event_id, slot_id, seat, action, detail, by, ref, discount)
    values (p_bo, e.id, coalesce(l->>'slotId',''), p_seat, case when p_comp then 'comp' else 'sold' end,
      case when p_comp then 'Complimentary ticket issued to ' else 'Sold to ' end || p_holder || case when p_disc > 0 then ' · discount ' || p_promo else '' end
        || case when p_bundle is not null then ' · ' || (p_bundle->>'name') else '' end || ' · $' || to_char(case when p_comp then p_face else p_paid end / 100.0, 'FM999999990.00'),
      p_by, p_ref, case when p_disc > 0 then p_promo end);
  end if;
end $$;

create or replace function unlock(p_event uuid, p_password text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'event', coalesce(secrets->>'password','') <> '' and secrets->>'password' = p_password,
    'ticketTypes', coalesce((select jsonb_agg(key) from jsonb_each_text(coalesce(secrets->'ticketPasswords','{}')) where value = p_password), '[]'))
  from events e where id = p_event and event_live(e);
$$;

create or replace function join_waitlist(p_event uuid, p_name text, p_email text, p_phone text default '') returns void language plpgsql security definer set search_path = public as $$
declare e events%rowtype;
begin
  select * into e from events where id = p_event;
  if not found or not event_live(e) or coalesce(e.data->>'waitlistMode','soldout') = 'off' then raise exception 'This event has no waitlist'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Enter your name'; end if;
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email'; end if;
  insert into waitlist(box_office_id, event_id, name, email, phone) values (e.box_office_id, p_event, left(trim(p_name),120), left(lower(trim(p_email)),200), left(trim(coalesce(p_phone,'')),40))
    on conflict (event_id, email) do nothing;
  if found then
    perform contact_upsert(e.box_office_id, p_email, p_name, p_phone);
    perform emit_event(e.box_office_id, 'waitlist.signup', jsonb_build_object('event_id', p_event, 'name', trim(p_name), 'email', lower(trim(p_email)), 'phone', coalesce(p_phone, '')),
      jsonb_build_object('email', lower(trim(p_email)), 'name', trim(p_name), 'phone', coalesce(p_phone, ''), 'tickets', '[]'::jsonb, 'eventIds', jsonb_build_array(p_event), 'eventId', p_event,
        'key', (select id from waitlist where event_id = p_event and email = lower(trim(p_email)))));
  end if;
end $$;
-- One direct-link-only (or public) event by its URL. Hidden / scheduled / archived events return nothing.
create or replace function event_by_slug(p_slug text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', e.id, 'box_office_id', e.box_office_id, 'slug', e.slug, 'status', e.status, 'data', e.data, 'created_at', e.created_at)
  from events e where e.slug = p_slug and event_live(e);
$$;
drop function if exists track_view(uuid, text, text);
create or replace function track_view(p_event uuid, p_visitor text, p_src text default null, p_ref text default null) returns void language sql security definer set search_path = public as $$
  insert into event_views(event_id, visitor, src, ref) select p_event, left(p_visitor, 40), left(p_src, 60), nullif(upper(left(trim(p_ref), 40)), '') from events e where e.id = p_event and event_live(e);
$$;
create or replace function save_event_templates(p_bo uuid, p jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_perm(p_bo, 'events.create') then raise exception 'You don''t have permission to do that'; end if;
  update box_offices set event_templates = p where id = p_bo;
  perform log_action(p_bo, 'event.templates', 'Edited event templates');
end $$;
create or replace function notify_waitlist(p_event uuid, p_message text) returns int language plpgsql security definer set search_path = public as $$
declare e events%rowtype; n int;
begin
  select * into e from events where id = p_event;
  if not has_perm(e.box_office_id, 'comms.notify', p_event) then raise exception 'You don''t have permission to do that'; end if;
  update waitlist set notified_at = now() where event_id = p_event and notified_at is null; get diagnostics n = row_count;
  insert into broadcasts(box_office_id, event_id, subject, body, recipients, created_by) values (e.box_office_id, p_event, 'Tickets available', p_message, n, me_email());
  perform log_action(e.box_office_id, 'comms.waitlist', format('Notified %s people on the waitlist', n), null, null, p_event);
  return n;  -- emails go out with Stage 8 (outbound email); until then this records the notice
end $$;

-- what a buyer may see of their own order (Stage 5): never the platform's cut, the processor's cut or payment internals
create or replace function buyer_order(o orders) returns jsonb language sql stable as $$
  select (to_jsonb(o) - 'access_key' - 'attempt_key' - 'payment') || jsonb_build_object('data', o.data - 'platformFee' - 'processingFee' || jsonb_build_object(
      'refunds', coalesce((select jsonb_agg(jsonb_build_object('at', r->'at', 'amount', r->'amount', 'to', r->'to', 'credit', r->'credit', 'status', r->'status')) from jsonb_array_elements(o.data->'refunds') r), '[]'),
      'charges', coalesce((select jsonb_agg(jsonb_build_object('at', c->'at', 'amount', c->'amount', 'method', c->'method', 'reason', c->'reason')) from jsonb_array_elements(o.data->'charges') c), '[]')),
    'paidWith', case when o.payment->>'last4' is not null then (o.payment->>'brand') || ' •••• ' || (o.payment->>'last4') else o.payment->>'brand' end,
    'failures', (select count(*) from jsonb_array_elements(coalesce(o.payment->'attempts','[]')) a where not coalesce((a->>'ok')::boolean, false))) $$;
create or replace function get_order(p_id uuid, p_key uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('order', buyer_order(o), 'tickets', coalesce((select jsonb_agg(to_jsonb(t)) from tickets t where t.order_id = o.id and t.status <> 'replaced'), '[]'))
  from orders o where o.id = p_id and o.access_key = p_key;
$$;

-- Find-my-tickets: returns links only when ref + email both match.
create or replace function lookup_order(p_ref text, p_email text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'key', access_key) from orders where upper(ref) = upper(trim(p_ref)) and lower(buyer_email) = lower(trim(p_email));
$$;

-- The checkout. Payload: {buyer:{name,email,phone}, items:[{eventId,ticketTypeId,slotId,qty,seats[]}], addons:[{eventId,addonId,qty}],
--   code, donation (cents), payment ('offline'|'free'|'manual'), answers, optIn, source, unlock:{eventId:password}}
create or replace function place_order(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st jsonb; it jsonb; ad jsonb; ev events%rowtype; tt jsonb; b jsonb; av jsonb; pend jsonb := '{}'; avs jsonb := '{}'; ev_ids uuid[] := '{}'; x text; k text; n int;
  manual boolean := coalesce(p->>'payment','') = 'manual'; is_comp boolean := coalesce((p->>'comp')::boolean, false); tok text := nullif(p->>'holdToken','');
  bo box_offices%rowtype; email text := lower(trim(coalesce(p->'buyer'->>'email',''))); seated boolean; tts text[]; pos jsonb; gaps text[]; all_seats text[]; with_t boolean;
  f jsonb; err text; promo jsonb; promo_code text; tracking text; q jsonb; status text; total bigint; prev orders%rowtype; cr credits%rowtype; cap bigint;
  oid uuid; okey uuid; oref text; l jsonb; c int; u int; j int; adm int; per int; d bigint; w bigint[]; fs bigint[]; ps bigint[]; ds bigint[]; extras jsonb; by_ text;
begin
  p := p - 'creditAvail';   -- only this function decides how much credit applies
  if coalesce(trim(p->'buyer'->>'name'),'') = '' then raise exception 'Name is required'; end if;
  if email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'A valid email is required'; end if;
  perform expire_orders();
  -- the same checkout submitted twice (double click, retry, flaky network) returns the first order — never a second one
  if coalesce(p->>'attempt','') <> '' then
    select * into prev from orders o where o.attempt_key = p->>'attempt' and o.buyer_email = email and order_counts(o) limit 1;
    if found then return jsonb_build_object('id', prev.id, 'key', prev.access_key, 'ref', prev.ref, 'status', prev.status, 'total', prev.data->'total', 'expires_at', prev.expires_at, 'again', true); end if;
  end if;
  if jsonb_array_length(coalesce(p->'items','[]')) = 0 and not exists(select 1 from jsonb_array_elements(coalesce(p->'addons','[]')) a where coalesce((a->>'qty')::int, 0) >= 1) then
    raise exception 'Your cart is empty'; end if;
  -- every event in the order (tickets first, then products): on sale, one box office, locked, availability read once
  for x in select e from (select i->>'eventId' e, o from jsonb_array_elements(coalesce(p->'items','[]')) with ordinality z(i, o)
                          union all select a->>'eventId', 1000000 + o from jsonb_array_elements(coalesce(p->'addons','[]')) with ordinality z(a, o) where coalesce((a->>'qty')::int, 0) >= 1) s
           group by e order by min(o) loop
    select * into ev from events where id = x::uuid;
    if not found or not (event_live(ev) or (manual and ev.status <> 'cancelled')) then raise exception 'Event is not on sale'; end if;
    if bo.id is null then select * into bo from box_offices where id = ev.box_office_id; st := coalesce(bo.settings, '{}');
    elsif bo.id <> ev.box_office_id then raise exception 'One order can only hold one organizer''s events'; end if;
    if bo.status <> 'active' and not manual then raise exception 'This box office is not selling tickets right now'; end if;
    perform pg_advisory_xact_lock(hashtext(ev.id::text));
    ev_ids := ev_ids || ev.id; avs := avs || jsonb_build_object(ev.id::text, availability(ev.id));
    if not manual then
      if nullif(ev.data->>'salesStart','') is not null and (ev.data->>'salesStart')::timestamptz > now() then raise exception 'Tickets go on sale %', ev.data->>'salesStart'; end if;
      if nullif(ev.data->>'salesEnd','') is not null and (ev.data->>'salesEnd')::timestamptz < now() then raise exception 'Sales have ended'; end if;
      if coalesce(ev.secrets->>'password','') <> '' and coalesce(p->'unlock'->>(ev.id::text),'') <> ev.secrets->>'password' then raise exception 'This event needs a password'; end if;
    end if;
  end loop;

  for it in select * from jsonb_array_elements(coalesce(p->'items','[]')) loop
    select * into ev from events where id = (it->>'eventId')::uuid;
    av := avs->(ev.id::text); seated := coalesce((ev.data->'seating'->>'enabled')::boolean, false);
    if manual and not has_perm(bo.id, 'orders.edit', ev.id) then raise exception 'You don''t have permission to create orders for %', ev.data->>'name'; end if;
    if coalesce((it->>'qty')::int, 0) < 1 then raise exception 'Bad quantity'; end if;
    if coalesce(it->>'price','') <> '' then   -- manual price override
      if not manual then raise exception 'not allowed'; end if;
      if not has_perm(bo.id, 'tickets.pricing', ev.id) then raise exception 'You don''t have permission to change ticket prices'; end if;
    end if;
    if nullif(it->>'bundleId','') is not null then
      b := (select y from jsonb_array_elements(coalesce(ev.data->'bundles','[]')) y where y->>'id' = it->>'bundleId');
      if b is null then raise exception 'Unknown bundle'; end if;
      if not manual then
        if coalesce((b->>'hidden')::boolean, false) or not in_window(b->>'salesStart', b->>'salesEnd') then raise exception '% is not on sale right now', b->>'name'; end if;
        if coalesce((b->>'max')::int, 0) > 0 and (it->>'qty')::int > (b->>'max')::int then raise exception 'Maximum % × % per order', b->>'max', b->>'name'; end if;
      end if;
      k := 'bd:' || (b->>'id'); pend := pend || jsonb_build_object(k, coalesce((pend->>k)::int, 0) + (it->>'qty')::int);
      if coalesce((b->>'qty')::int, 0) > 0 and coalesce((av->'bd'->>(b->>'id'))::int, 0) + (pend->>k)::int > (b->>'qty')::int then
        raise exception 'Only % % left', greatest(0, (b->>'qty')::int - coalesce((av->'bd'->>(b->>'id'))::int, 0)), b->>'name'; end if;
      pos := bundle_positions(b); tts := bundle_tts(ev, b, it);
      if seated and jsonb_array_length(coalesce(it->'seats','[]')) <> coalesce(array_length(tts, 1), 0) then raise exception 'Pick % seat(s) for %', coalesce(array_length(tts, 1), 0), b->>'name'; end if;
      for j in 1 .. coalesce(array_length(tts, 1), 0) loop
        if not (pos->((j - 1) % jsonb_array_length(pos)) ? tts[j]) then
          raise exception '% can''t include %', b->>'name', case when seated then seat_text(ev, it->'seats'->>(j - 1)) else 'that ticket type' end; end if;
      end loop;
      for x in select t from unnest(tts) with ordinality z(t, o) group by t order by min(o) loop
        pend := order_check_tickets(ev, av, it, (select y from jsonb_array_elements(ev.data->'ticketTypes') y where y->>'id' = x),
          (select count(*)::int from unnest(tts) t where t = x),
          array(select s from jsonb_array_elements_text(coalesce(it->'seats','[]')) with ordinality z(s, o) where tts[o::int] = x order by o), manual, tok, pend);
      end loop;
      for ad in select * from jsonb_array_elements(coalesce(b->'addons','[]')) loop
        k := 'ad:' || ev.id || '|' || (ad->>'addonId'); pend := pend || jsonb_build_object(k, coalesce((pend->>k)::int, 0) + greatest(1, coalesce((ad->>'qty')::int, 1)) * (it->>'qty')::int);
      end loop;
    else
      tt := (select y from jsonb_array_elements(ev.data->'ticketTypes') y where y->>'id' = it->>'ticketTypeId');
      if tt is null then raise exception 'Unknown ticket type'; end if;
      if not manual then
        if coalesce((tt->>'adminOnly')::boolean, false) then raise exception '% is sold by the box office only', tt->>'name'; end if;
        if coalesce(ev.secrets->'ticketPasswords'->>(tt->>'id'),'') <> '' and coalesce(p->'unlock'->>(ev.id::text),'') <> ev.secrets->'ticketPasswords'->>(tt->>'id') then raise exception '% is locked', tt->>'name'; end if;
        if nullif(tt->>'salesStart','') is not null and (tt->>'salesStart')::timestamptz > now() then raise exception '% is not on sale yet', tt->>'name'; end if;
        if nullif(tt->>'salesEnd','') is not null and (tt->>'salesEnd')::timestamptz < now() then raise exception '% sales have ended', tt->>'name'; end if;
        if (it->>'qty')::int < coalesce((tt->>'min')::int, 1) then raise exception 'Minimum % for %', tt->>'min', tt->>'name'; end if;
        if coalesce((tt->>'max')::int, 0) > 0 and (it->>'qty')::int > (tt->>'max')::int then raise exception 'Maximum % for %', tt->>'max', tt->>'name'; end if;
      end if;
      pend := order_check_tickets(ev, av, it, tt, (it->>'qty')::int, array(select jsonb_array_elements_text(coalesce(it->'seats','[]'))), manual, tok, pend);
    end if;
    if seated and coalesce((ev.data->'seating'->>'noSingles')::boolean, false) and not manual then
      select coalesce(array_agg(y), '{}') into all_seats from jsonb_array_elements(p->'items') i, jsonb_array_elements_text(coalesce(i->'seats','[]')) y
        where i->>'eventId' = ev.id::text and coalesce(i->>'slotId','') = coalesce(it->>'slotId','');
      gaps := single_gaps(ev, coalesce(it->>'slotId',''), all_seats, tok);
      if array_length(gaps, 1) > 0 then raise exception 'Please don''t leave a single empty seat next to your selection (%). Move over one seat, or include it.', (select string_agg(seat_text(ev, g), '; ') from unnest(gaps) g); end if;
    end if;
  end loop;

  -- products: on sale, sold with the right tickets / seats unless standalone, per-order limit, stock (packaged products count too)
  for ad in select * from jsonb_array_elements(coalesce(p->'addons','[]')) loop
    if coalesce((ad->>'qty')::int, 0) < 1 then continue; end if;
    select * into ev from events where id = (ad->>'eventId')::uuid;
    tt := (select y from jsonb_array_elements(coalesce(ev.data->'addons','[]')) y where y->>'id' = ad->>'addonId');
    if tt is null then raise exception 'Unknown add-on'; end if;
    with_t := exists(select 1 from jsonb_array_elements(coalesce(p->'items','[]')) i where i->>'eventId' = ev.id::text);
    if not manual then
      if coalesce((tt->>'hidden')::boolean, false) or not in_window(tt->>'salesStart', tt->>'salesEnd') then raise exception '% is not on sale right now', tt->>'name'; end if;
      if not coalesce((tt->>'standalone')::boolean, false) and not with_t then raise exception '% can only be bought with a ticket', tt->>'name'; end if;
      if with_t and not addon_allowed(tt, pend->('mine:' || ev.id)) then
        raise exception '% is only available with % tickets', tt->>'name', (select string_agg(nm, ' / ') from (
          select (select y->>'name' from jsonb_array_elements(ev.data->'ticketTypes') y where y->>'id' = z) nm from jsonb_array_elements_text(coalesce(tt->'ticketTypeIds','[]')) z
          union all select z from jsonb_array_elements_text(coalesce(tt->'areas','[]')) z) qq where nm is not null); end if;
      if not with_t and (jsonb_array_length(coalesce(tt->'ticketTypeIds','[]')) > 0 or jsonb_array_length(coalesce(tt->'areas','[]')) > 0) then raise exception '% can only be bought with a ticket', tt->>'name'; end if;
      if coalesce((tt->>'max')::int, 0) > 0 and (ad->>'qty')::int > (tt->>'max')::int then raise exception 'Maximum % × % per order', tt->>'max', tt->>'name'; end if;
    end if;
    k := 'ad:' || ev.id || '|' || (tt->>'id'); pend := pend || jsonb_build_object(k, coalesce((pend->>k)::int, 0) + (ad->>'qty')::int);
  end loop;
  for k in select key from jsonb_each(pend) where key like 'ad:%' loop
    select * into ev from events where id = split_part(substr(k, 4), '|', 1)::uuid;
    tt := (select y from jsonb_array_elements(coalesce(ev.data->'addons','[]')) y where y->>'id' = split_part(k, '|', 2));
    if tt is null then raise exception 'Unknown add-on'; end if;
    n := coalesce((avs->(ev.id::text)->'ad'->>(tt->>'id'))::int, 0);
    if coalesce((tt->>'qty')::int, 0) > 0 and n + (pend->>k)::int > (tt->>'qty')::int then raise exception 'Only % % left', greatest(0, (tt->>'qty')::int - n), tt->>'name'; end if;
  end loop;

  -- promo / tracking code — one box office, one code namespace; a stale tracking link never blocks a sale
  if coalesce(p->>'code','') <> '' and not is_comp then
    f := find_code(bo.id, p->>'code');
    if f ? 'promo' then
      err := promo_usable(f->'promo', p->>'code', email); if err <> '' then raise exception '%', err; end if;
      promo := public_promo(f->'promo', p->>'code'); promo_code := f->'promo'->>'code';
    elsif f ? 'tracking' and tracking_usable(f->'tracking', bo.id, ev_ids) then tracking := f->'tracking'->>'code';
    else raise exception 'That code is not valid'; end if;
  end if;
  if tracking is null and coalesce(p->>'tracking','') <> '' then
    f := find_code(bo.id, p->>'tracking'); if f ? 'tracking' and tracking_usable(f->'tracking', bo.id, ev_ids) then tracking := f->'tracking'->>'code'; end if;
  end if;
  q := price_cart(p, manual, pricing_settings(bo), promo);
  if promo is not null and q->>'promoErr' <> '' then raise exception '%', q->>'promoErr'; end if;
  -- credit (Stage 6): a credit code, the signed-in customer's own account credit, or one a staff member picks on a manual order
  if (coalesce(p->>'credit','') <> '' or coalesce(p->>'creditId','') <> '') and not is_comp then
    if coalesce(p->>'creditId','') <> '' then
      if not manual then raise exception 'not allowed'; end if;
      select * into cr from credits cx where cx.id = (p->>'creditId')::uuid and cx.box_office_id = bo.id for update;
    elsif p->>'credit' = 'account' then
      if me_email() <> email or (select u.email_confirmed_at from auth.users u where u.id = auth.uid()) is null then raise exception 'Sign in with this email to use your account credit'; end if;
      select * into cr from credits cx where cx.box_office_id = bo.id and cx.email = lower(trim(p->'buyer'->>'email')) and credit_problem(cx, ev_ids) = ''
        order by (credit_state(cx)->>'remaining')::bigint desc limit 1 for update;
      if not found then raise exception 'You have no credit that can be used on this order'; end if;
    else select * into cr from credits cx where cx.box_office_id = bo.id and cx.code = upper(trim(p->>'credit')) for update; end if;
    err := credit_problem(cr, ev_ids); if err <> '' then raise exception '%', err; end if;
    cap := (credit_state(cr)->>'remaining')::bigint;
    if cr.event_id is not null then cap := least(cap, (select coalesce(sum((l->>'unit')::bigint * (l->>'qty')::int - coalesce((l->>'disc')::bigint, 0) + coalesce((l->>'fee')::bigint, 0) - coalesce((l->>'feeDisc')::bigint, 0)), 0)
      from jsonb_array_elements(q->'lines') l where l->>'eventId' = cr.event_id::text)); end if;
    q := price_cart(p || jsonb_build_object('creditAvail', cap), manual, pricing_settings(bo), promo);
  end if;
  -- checkout questions: once per order (box office), once per event, once per ticket
  if not manual then
    err := check_answers(st, ev_ids, coalesce(p->'answers','{}'), coalesce(p->'ticketAnswers','{}'),
      (select coalesce(jsonb_object_agg(e, n2), '{}') from (select ln->>'eventId' e, sum(case when ln->>'kind' = 'ticket' then (ln->>'qty')::int * coalesce(nullif((ln->>'admits')::int, 0), 1)
        when ln->>'kind' = 'bundle' then jsonb_array_length(coalesce(ln->'tts','[]')) else 0 end) n2 from jsonb_array_elements(q->'lines') ln group by 1) z));
    if err <> '' then raise exception '%', err; end if;
  end if;
  if is_comp then  -- complimentary: real ticket type + face value kept, $0 collected
    if not manual then raise exception 'not allowed'; end if;
    foreach x in array ev_ids::text[] loop if not has_perm(bo.id, 'tickets.comps', x::uuid) then raise exception 'You don''t have permission to issue complimentary tickets'; end if; end loop;
    q := q || jsonb_build_object('lines', (select coalesce(jsonb_agg(ln || '{"unit":0,"fee":0,"unitFee":0,"comp":true}'::jsonb order by o), '[]') from jsonb_array_elements(q->'lines') with ordinality z(ln, o)),
      'subtotal', 0, 'ticketsTotal', 0, 'addonsTotal', 0, 'discount', 0, 'feeDiscount', 0, 'fee', 0, 'serviceFee', 0, 'tax', 0, 'donation', 0, 'processing', 0, 'processingFee', 0, 'platformFee', 0, 'total', 0);
  end if;
  total := (q->>'total')::bigint;
  -- how it's paid: free and staff orders are paid now; a card checkout waits for the processor (tickets only after it confirms); pay-later reserves
  if total > 0 and not manual then
    if p->>'payment' = 'card' then
      if coalesce((st->'payments'->>'card')::boolean, true) = false or coalesce(bo.gateway->>'status','') <> 'connected'
         or not exists(select 1 from payment_accounts a where a.box_office_id = bo.id and a.status = 'connected') then raise exception 'Card payments are not set up for this box office yet'; end if;
    elsif p->>'payment' = 'offline' then
      if coalesce((st->'payments'->>'offline')::boolean, true) = false then raise exception 'Pay later is not available for this box office'; end if;
    else raise exception 'Choose a payment method'; end if;
  end if;
  status := case when total = 0 or manual then 'paid' when p->>'payment' = 'card' then 'awaiting_payment' else 'pending' end;
  loop oref := 'SET-' || rand_code(6); exit when not exists(select 1 from orders where ref = oref); end loop;
  insert into orders(box_office_id, ref, status, buyer_email, event_ids, attempt_key, expires_at, paid_at, payment, data) values (bo.id, oref, status, email, ev_ids, nullif(p->>'attempt',''),
    case when status = 'awaiting_payment' then now() + interval '15 minutes' end, case when status = 'paid' then now() end,
    case when status = 'awaiting_payment' then jsonb_build_object('provider', bo.gateway->>'provider', 'test', coalesce((bo.gateway->>'test')::boolean, true), 'attempts', '[]'::jsonb)
         when manual and total > 0 then jsonb_build_object('provider', 'manual', 'method', case when p->>'payMethod' in ('cash','terminal','check','transfer','other') then p->>'payMethod' else 'other' end,
           'ref', left(coalesce(p->>'payRef',''), 80), 'by', me_email()) end,
    jsonb_build_object('buyer', p->'buyer', 'lines', q->'lines', 'subtotal', q->'subtotal', 'ticketsTotal', q->'ticketsTotal', 'addonsTotal', q->'addonsTotal', 'discount', q->'discount',
      'feeDiscount', q->'feeDiscount', 'fee', q->'fee', 'serviceFee', q->'serviceFee', 'tax', q->'tax', 'donation', q->'donation', 'processing', q->'processing', 'processingFee', q->'processingFee',
      'total', total, 'refunded', 0, 'faceValue', q->'faceValue', 'code', promo->>'code', 'promo', case when promo is null then null else jsonb_build_object('id', promo->>'id', 'code', promo_code) end,
      'tracking', tracking, 'payment', case when total = 0 then case when coalesce((q->>'credit')::bigint, 0) > 0 then 'credit' else 'free' end else p->>'payment' end,
      'credit', case when coalesce((q->>'credit')::bigint, 0) > 0 then jsonb_build_object('id', cr.id, 'code', cr.code, 'amount', (q->>'credit')::bigint) end, 'answers', coalesce(p->'answers','{}'), 'ticketAnswers', coalesce(p->'ticketAnswers','{}'),
      'optIn', coalesce((p->>'optIn')::boolean, false), 'smsOptIn', coalesce((p->>'smsOptIn')::boolean, false) and norm_phone(p->'buyer'->>'phone') is not null,
      'source', p->>'source', 'utm', (select nullif(jsonb_object_agg(uk.n, left(p->'utm'->>uk.n, 80)), '{}'::jsonb) from unnest(array['source','medium','campaign','content','term']) uk(n)
        where jsonb_typeof(p->'utm') = 'object' and coalesce(p->'utm'->>uk.n, '') <> ''),
      'currency', q->'currency', 'platformFee', q->'platformFee') || case when is_comp then '{"comp":true}'::jsonb else '{}'::jsonb end)
    returning id, access_key into oid, okey;
  -- the order holds its seats itself now (paid → tickets; unpaid → reserved until paid or expired), so the buyer's seat holds go
  for l in select v from jsonb_array_elements(q->'lines') v where jsonb_array_length(coalesce(v->'seats','[]')) > 0 loop
    delete from seat_status where event_id = (l->>'eventId')::uuid and slot_id in (coalesce(l->>'slotId',''), '') and (l->'seats') ? seat_status.seat
      and (seat_status.status = 'checkout' or (manual and seat_status.status = 'held'));
  end loop;
  if tok is not null then delete from seat_status y where y.status = 'checkout' and y.token = tok; end if;
  perform emit_event((select box_office_id from orders where id = oid), 'order.created', (select hook_order(oo) from orders oo where oo.id = oid));
  if status = 'pending' then perform order_contact(oid); end if;
  if status = 'paid' then perform issue_order_tickets(oid, coalesce(nullif(me_email(), ''), email)); end if;
  if manual and coalesce((p->>'send')::boolean, true) = false then update outbox set status = 'not sent (staff choice)' where order_id = oid and kind = 'confirmation'; end if;
  return jsonb_build_object('id', oid, 'key', okey, 'ref', oref, 'status', status, 'total', total,
    'expires_at', (select expires_at from orders where id = oid));
end $$;

-- ── Stage 5: payments, tickets-after-payment, customer accounts ──────────────────
-- what quote() needs for one box office: its settings + the platform fee (per-box-office override) + its processor's card rate
create or replace function pricing_settings(b box_offices) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(b.settings, '{}') || jsonb_build_object(
    'platform', jsonb_build_object('pct', coalesce(nullif(b.platform_fee->>'pct','')::numeric, (pl.data->>'feePct')::numeric, 0),
                                   'fixed', coalesce(nullif(b.platform_fee->>'fixed','')::bigint, (pl.data->>'feeFixed')::bigint, 0),
                                   'payer', coalesce(nullif(b.platform_fee->>'payer',''), pl.data->>'feePayer', 'organizer')),
    'card', jsonb_build_object('pct', coalesce((a.data->>'pct')::numeric, case a.provider when 'stripe' then 2.9 else 0 end),
                               'fixed', coalesce((a.data->>'fixed')::bigint, case a.provider when 'stripe' then 30 else 0 end),
                               'pass', coalesce((b.settings->>'passProcessing')::boolean, false)))
  from platform_settings pl left join payment_accounts a on a.box_office_id = b.id where pl.id = 1 $$;
-- one checkout answer (mirrors answerErr() in data.js)
create or replace function answer_err(q jsonb, v jsonb) returns text language plpgsql immutable as $$
declare t text := coalesce(q->>'type', 'text'); sv text := case when jsonb_typeof(v) = 'string' then v #>> '{}' else v::text end;
begin
  if v is null or jsonb_typeof(v) = 'null' or v = '""'::jsonb or v = 'false'::jsonb then
    return case when not coalesce((q->>'required')::boolean, false) then '' when t in ('terms','waiver') then 'Please accept: ' || (q->>'label')
                when t = 'signature' then 'Please sign: ' || (q->>'label') else 'Please answer: ' || (q->>'label') end; end if;
  if t = 'select' and not (trim(sv) = any(array(select trim(x) from unnest(string_to_array(coalesce(q->>'options',''), ',')) x))) then return 'Choose an option for: ' || (q->>'label'); end if;
  if t = 'date' and sv !~ '^\d{4}-\d{2}-\d{2}$' then return 'Enter a date for: ' || (q->>'label'); end if;
  if t = 'signature' and (length(sv) > 200000 or length(trim(sv)) < 2 or (sv like 'data:%' and sv !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$')) then return 'Please sign: ' || (q->>'label'); end if;
  if t <> 'signature' and length(sv) > 2000 then return 'Answer too long: ' || (q->>'label'); end if;
  return '';
end $$;
-- every required answer present and well formed (mirrors checkAnswers() in data.js). p_counts = {eventId: tickets in the order}
create or replace function check_answers(st jsonb, p_events uuid[], p_ans jsonb, p_tans jsonb, p_counts jsonb) returns text language plpgsql stable security definer set search_path = public as $$
declare q jsonb; e events%rowtype; i int; err text;
begin
  for q in select * from jsonb_array_elements(coalesce(st->'questions','[]')) loop err := answer_err(q, p_ans->(q->>'id')); if err <> '' then return err; end if; end loop;
  for e in select * from events where id = any(p_events) order by array_position(p_events, id) loop
    for q in select * from jsonb_array_elements(coalesce(e.data->'questions','[]')) loop
      if q->>'scope' = 'ticket' then
        for i in 0 .. coalesce((p_counts->>(e.id::text))::int, 0) - 1 loop
          err := answer_err(q, p_tans->(q->>'id')->i); if err <> '' then return err || format(' (ticket %s, %s)', i + 1, e.data->>'name'); end if;
        end loop;
      else err := answer_err(q, p_ans->(q->>'id')); if err <> '' then return err || ' (' || (e.data->>'name') || ')'; end if; end if;
    end loop;
  end loop;
  return '';
end $$;
-- Paid → tickets. Runs once per order (free / staff order placed, processor confirmed, staff marked paid). Every ticket keeps: real ticket type,
-- face value, amount collected, its discount + code, comp, tracking code, products, package, and its own checkout answers. Queues ONE confirmation email.
create or replace function issue_order_tickets(p_order uuid, p_by text) returns void language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; l jsonb; extras jsonb; adm int; per int; u int; j int; c int; d bigint; w bigint[]; fs bigint[]; ps bigint[]; ds bigint[]; idx jsonb := '{}'; k int; comp boolean;
begin
  select * into o from orders where id = p_order for update;
  if exists(select 1 from tickets where order_id = o.id) then return; end if;
  comp := coalesce((o.data->>'comp')::boolean, false);
  for l in select v from jsonb_array_elements(o.data->'lines') with ordinality z(v, n) order by n loop
    extras := (select coalesce(jsonb_agg((a->>'name') || ' × ' || (a->>'qty') order by n), '[]') from jsonb_array_elements(o.data->'lines') with ordinality z(a, n) where a->>'kind' = 'addon' and a->>'eventId' = l->>'eventId');
    if l->>'kind' = 'ticket' then
      adm := (l->>'admits')::int;
      for u in 0 .. (l->>'qty')::int - 1 loop
        d := coalesce((l->'discs'->>u)::bigint, 0);
        fs := spread((l->>'face')::bigint, array_fill(1::bigint, array[adm])); ps := spread((l->>'unit')::bigint - d, array_fill(1::bigint, array[adm])); ds := spread(d, array_fill(1::bigint, array[adm]));
        for j in 1 .. adm loop
          k := coalesce((idx->>(l->>'eventId'))::int, -1) + 1; idx := idx || jsonb_build_object(l->>'eventId', k);
          perform issue_ticket(o.box_office_id, o.id, o.ref, l, l->>'ticketTypeId', l->'seats'->>(u * adm + j - 1), fs[j], ps[j], ds[j], o.data->>'code', o.data->>'tracking', null, extras, comp, o.data->'buyer'->>'name', p_by, ticket_answers(o, l->>'eventId', k));
        end loop;
      end loop;
    elsif l->>'kind' = 'bundle' then  -- the package price is shared over its tickets and products by their normal prices
      per := (l->>'perCopy')::int;
      for c in 0 .. (l->>'qty')::int - 1 loop
        w := array(select x2::bigint from jsonb_array_elements_text(l->'tfaces') with ordinality z(x2, n) where n > c * per and n <= (c + 1) * per order by n)
          || array(select (a->>'face')::bigint * (a->>'qty')::int from jsonb_array_elements(l->'addons') with ordinality z(a, n) order by n);
        d := coalesce((l->'discs'->>c)::bigint, 0); ps := spread((l->>'unit')::bigint - d, w); ds := spread(d, w);
        for j in 1 .. per loop
          k := coalesce((idx->>(l->>'eventId'))::int, -1) + 1; idx := idx || jsonb_build_object(l->>'eventId', k);
          perform issue_ticket(o.box_office_id, o.id, o.ref, l, l->'tts'->>(c * per + j - 1), l->'seats'->>(c * per + j - 1), w[j], ps[j], ds[j], o.data->>'code', o.data->>'tracking',
            jsonb_build_object('id', l->>'bundleId', 'name', l->>'name', 'n', c + 1),
            extras || coalesce((select jsonb_agg((a->>'name') || ' × ' || (a->>'qty') || ' (in ' || (l->>'name') || ')' order by n) from jsonb_array_elements(l->'addons') with ordinality z(a, n)), '[]'),
            comp, o.data->'buyer'->>'name', p_by, ticket_answers(o, l->>'eventId', k));
        end loop;
      end loop;
    end if;
  end loop;
  perform queue_mail(o, 'confirmation', '', '', 'system');   -- ONE per order (unique index); transactional — never held back for marketing consent
  perform order_contact(o.id);
  perform emit_event(o.box_office_id, 'ticket.issued', jsonb_build_object('order_ref', o.ref, 'tickets', hook_order(o)->'tickets'));
  perform emit_event(o.box_office_id, 'payment.completed', hook_order(o), order_ctx(o));
end $$;
-- the k-th ticket's answers to that event's per-ticket questions
create or replace function ticket_answers(o orders, p_event text, k int) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(q->>'id', o.data->'ticketAnswers'->(q->>'id')->k) filter (where o.data->'ticketAnswers'->(q->>'id')->k is not null), '{}')
  from events e, jsonb_array_elements(coalesce(e.data->'questions','[]')) q where e.id = p_event::uuid and q->>'scope' = 'ticket' $$;

-- The processor (webhook, service role only) says the money arrived. Idempotent. A payment that lands after the checkout expired still gets its
-- tickets when every seat / ticket is still free; otherwise it must be refunded (the caller refunds it). → issued | already | refund | mismatch
create or replace function confirm_payment(p_order uuid, p jsonb) returns text language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; l jsonb; ev events%rowtype; clash boolean := false;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status = 'paid' then return 'already'; end if;
  if coalesce((p->>'amount')::bigint, -1) <> (o.data->>'total')::bigint then
    update orders set payment = coalesce(payment, '{}') || jsonb_build_object('mismatch', p) where id = o.id; return 'mismatch'; end if;
  if o.status in ('cancelled','refunded') then clash := true;
  elsif not order_counts(o) then   -- late: re-check every seat and ticket limit against everyone else
    for l in select v from jsonb_array_elements(o.data->'lines') v loop
      select * into ev from events where id = (l->>'eventId')::uuid;
      perform pg_advisory_xact_lock(hashtext(ev.id::text));
      if exists(select 1 from jsonb_array_elements_text(coalesce(l->'seats','[]')) st2(seat) where not seat_free(ev, coalesce(l->>'slotId',''), st2.seat, null)) then clash := true; end if;
      if exists(select 1 from jsonb_array_elements(ev.data->'ticketTypes') t where coalesce((t->>'qty')::int, 0) > 0
          and coalesce((availability(ev.id)->'tt'->>(t->>'id'))::int, 0) + (select count(*) from reserved_units_of(o) r where r.tt = t->>'id' and r.ev = ev.id::text) > (t->>'qty')::int) then clash := true; end if;
    end loop;
  end if;
  perform set_config('set.system', '1', true);   -- the processor, not a staff member, changes this order's status
  if clash then
    update orders set status = 'refunded', payment = coalesce(payment, '{}') || p || jsonb_build_object('refundedAt', now(), 'note', 'Paid after the checkout expired and the seats were gone — refunded automatically')
      where id = o.id;
    perform set_config('set.system', '', true);
    return 'refund';
  end if;
  update orders set status = 'paid', paid_at = now(), payment = coalesce(payment, '{}') || p,
    data = case when p ? 'fee' then data || jsonb_build_object('processingFee', (p->>'fee')::bigint) else data end where id = o.id;   -- orders_paid issues the tickets
  perform set_config('set.system', '', true);
  return 'issued';
end $$;
create or replace function reserved_units_of(o orders) returns table(ev text, tt text, seat text) language sql stable as $$
  select l->>'eventId', case when l->>'kind' = 'ticket' then l->>'ticketTypeId' else l->'tts'->>(g - 1) end, l->'seats'->>(g - 1)
  from jsonb_array_elements(o.data->'lines') l, generate_series(1, case when l->>'kind' = 'ticket' then (l->>'qty')::int * coalesce(nullif((l->>'admits')::int, 0), 1)
    when l->>'kind' = 'bundle' then jsonb_array_length(coalesce(l->'tts','[]')) else 0 end) g $$;
-- a declined / failed attempt (webhook): recorded on the order; the buyer may retry until the checkout expires
create or replace function record_payment_attempt(p_order uuid, p jsonb) returns void language sql security definer set search_path = public as $$
  update orders set payment = jsonb_set(coalesce(payment, '{}'), '{attempts}', coalesce(payment->'attempts', '[]') || jsonb_build_array(p || jsonb_build_object('at', now())))
  where id = p_order and status = 'awaiting_payment' $$;
-- card checkouts that ran out of time release their seats / stock (run by pg_cron every minute; availability ignores them anyway)
create or replace function expire_orders() returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; o orders%rowtype; l jsonb; s text;
begin
  perform set_config('set.system', '1', true);
  for o in update orders set status = 'expired' where status = 'awaiting_payment' and expires_at <= now() returning * loop
    n := n + 1;
    for l in select v from jsonb_array_elements(o.data->'lines') v loop
      for s in select jsonb_array_elements_text(coalesce(l->'seats','[]')) loop
        insert into seat_log(box_office_id, event_id, slot_id, seat, action, detail, by, ref) values (o.box_office_id, (l->>'eventId')::uuid, coalesce(l->>'slotId',''), s, 'released',
          'Checkout ' || o.ref || ' expired unpaid — seat released', 'system', o.ref);
      end loop;
    end loop;
    perform emit_event(o.box_office_id, 'cart.expired', hook_order(o), order_ctx(o, '{}') || jsonb_build_object('eventId', o.event_ids[1]));
  end loop;
  perform set_config('set.system', '', true); return n;
end $$;
-- the buyer gives up: seats go back on sale now instead of when the timer runs out
create or replace function cancel_checkout(p_id uuid, p_key uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update orders set expires_at = now() where id = p_id and access_key = p_key and status = 'awaiting_payment';
  perform expire_orders();
end $$;
create or replace function disconnect_gateway(p_bo uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_perm(p_bo, 'admin.payments') then raise exception 'You don''t have permission to change payment settings'; end if;
  perform set_config('set.platform', '1', true);
  update box_offices set gateway = null where id = p_bo; delete from payment_accounts where box_office_id = p_bo;
  perform log_action(p_bo, 'settings.payments', 'Disconnected the payment processor');
end $$;
-- super admin: one box office's platform fee {pct, fixed, payer} ('' = platform default); null = default
create or replace function set_platform_fee(p_bo uuid, p jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_super() then raise exception 'Platform super admins only'; end if;
  perform set_config('set.platform', '1', true);
  update box_offices set platform_fee = p where id = p_bo;
  perform log_action(null, 'platform.fee', 'Platform fee override for box office ' || p_bo || ': ' || coalesce(p::text, 'default'));
end $$;
-- the customer ticket wallet: orders bought with the signed-in, email-confirmed account's address — never the platform's or processor's cut
create or replace function my_orders() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare em text := me_email();
begin
  if em = '' or coalesce((select email_confirmed_at from auth.users where id = auth.uid()), null) is null then raise exception 'Please sign in with a confirmed email'; end if;
  return jsonb_build_object(
    'orders', coalesce((select jsonb_agg(buyer_order(o) || jsonb_build_object('key', o.access_key) order by o.created_at desc) from orders o where o.buyer_email = em and o.status <> 'expired'), '[]'),
    'tickets', coalesce((select jsonb_agg(to_jsonb(t)) from tickets t join orders o on o.id = t.order_id where o.buyer_email = em and t.status <> 'replaced'), '[]'));
end $$;

-- ── Stage 6: orders & customers — mirrors the "Orders & customers (Stage 6)" section of data.js ─────────────
-- Staff never write orders or tickets directly (no update policies): every change is order_action(), which checks the permission,
-- appends to order_log (never overwrites), and voids + reissues tickets for seat / type / showtime changes.
create or replace function order_money(o orders) returns jsonb language sql stable as $$
  with v as (select (case when o.paid_at is not null or o.status in ('paid','refunded') then coalesce((o.data->>'total')::bigint, 0) else 0 end) + coalesce((o.data->>'extraPaid')::bigint, 0) col,
      coalesce((o.data->>'refunded')::bigint, 0) ref, coalesce((o.data->>'credited')::bigint, 0) cre,
      coalesce((o.data->>'fee')::bigint, 0) + coalesce((o.data->>'serviceFee')::bigint, 0) fees)
  select jsonb_build_object('collected', col, 'refunded', ref, 'credited', cre, 'due', coalesce((o.data->>'due')::bigint, 0), 'refundable', greatest(0, col - ref - cre),
    'fees', fees, 'feesLeft', greatest(0, fees - coalesce((o.data->>'refundedFees')::bigint, 0))) from v $$;
create or replace function was_paid(o orders) returns boolean language sql stable as $$ select o.paid_at is not null or o.status in ('paid','refunded') $$;
create or replace function money_txt(c bigint) returns text language sql immutable as $$ select '$' || to_char(coalesce(c, 0) / 100.0, 'FM999999990.00') $$;
create or replace function order_log_add(o orders, p_kind text, p_summary text, p_by text, p_note text, p_data jsonb default '{}', p_before jsonb default null, p_after jsonb default null) returns void
  language plpgsql security definer set search_path = public as $$
begin
  insert into order_log(box_office_id, order_id, ref, event_id, kind, summary, by, note, data, before, after)
    values (o.box_office_id, o.id, o.ref, o.event_ids[1], p_kind, p_summary, p_by, left(coalesce(p_note, ''), 500), coalesce(p_data, '{}'), p_before, p_after);
  perform log_action(o.box_office_id, 'order.' || p_kind, 'Order ' || o.ref || ': ' || p_summary, p_before, p_after, o.event_ids[1]);
end $$;
create or replace function queue_mail(o orders, p_kind text, p_subject text, p_body text, p_by text) returns uuid language sql security definer set search_path = public as $$
  insert into outbox(box_office_id, order_id, kind, "to", subject, body, by) values (o.box_office_id, o.id, p_kind, o.buyer_email, left(p_subject, 200), left(p_body, 5000), p_by) returning id $$;
-- credits: remaining = amount − what orders (still counting) and staff applied; revoked → 0
create or replace function credit_state(c credits) returns jsonb language sql stable security definer set search_path = public as $$
  with u as (select coalesce(sum((o.data->'credit'->>'amount')::bigint), 0) n from orders o where o.data->'credit'->>'id' = c.id::text
      and not coalesce((o.data->'credit'->>'restored')::boolean, false) and (order_counts(o) or was_paid(o))),
    a as (select coalesce(sum((x->>'amount')::bigint), 0) n from jsonb_array_elements(c.applied) x),
    s as (select u.n + a.n used from u, a)
  select jsonb_build_object('used', used, 'remaining', case when c.revoked_at is not null then 0 else greatest(0, c.amount - used) end,
    'status', case when c.revoked_at is not null then 'revoked' when c.amount - used <= 0 then 'used' when c.expires is not null and c.expires <= now() then 'expired' else 'active' end,
    'uses', coalesce((select jsonb_agg(jsonb_build_object('ref', o.ref, 'order_id', o.id, 'amount', (o.data->'credit'->>'amount')::bigint, 'events', to_jsonb(o.event_ids), 'at', o.created_at))
       from orders o where o.data->'credit'->>'id' = c.id::text and not coalesce((o.data->'credit'->>'restored')::boolean, false) and (order_counts(o) or was_paid(o))), '[]') || c.applied) from s $$;
create or replace function credit_problem(c credits, p_events uuid[]) returns text language sql stable security definer set search_path = public as $$
  select case when c.id is null then 'That credit code is not valid' when credit_state(c)->>'status' = 'revoked' then 'That credit was cancelled'
    when credit_state(c)->>'status' = 'expired' then 'That credit has expired' when credit_state(c)->>'status' = 'used' then 'That credit has been used up'
    when c.event_id is not null and not (c.event_id = any(p_events)) then 'That credit is for a different event' else '' end $$;
create or replace function issue_credit(p_bo uuid, p jsonb, p_order orders, p_by text) returns credits language plpgsql security definer set search_path = public as $$
declare c credits%rowtype; cd text; em text := lower(trim(coalesce(p->>'email', p_order.buyer_email, ''))); amt bigint := greatest(0, round(coalesce(nullif(p->>'amount','')::numeric, 0)))::bigint;
begin
  if em !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'The credit needs the customer''s email'; end if;
  if amt <= 0 then raise exception 'Enter a credit amount'; end if;
  if nullif(p->>'eventId','') is not null and not exists(select 1 from events where id = (p->>'eventId')::uuid and box_office_id = p_bo) then raise exception 'Unknown event'; end if;
  loop cd := 'CR-' || rand_code(8); exit when not exists(select 1 from credits where code = cd); end loop;
  insert into credits(box_office_id, code, email, name, amount, event_id, expires, source_order, source_ref, note, issued_by)
    values (p_bo, cd, em, left(coalesce(p->>'name', p_order.data->'buyer'->>'name', ''), 120), amt, nullif(p->>'eventId','')::uuid, nullif(p->>'expires','')::timestamptz,
      p_order.id, p_order.ref, left(coalesce(p->>'note', ''), 300), p_by) returning * into c;
  return c;
end $$;
-- how much a refund request comes to. mode: full | tickets (+ their booking-fee share when fees) | fees | percent | amount
create or replace function refund_plan(o orders, p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m jsonb := order_money(o); amt bigint := 0; fees bigint := 0; per jsonb := '{}'; n_all int; n_sel int; pct numeric; t tickets%rowtype;
begin
  select count(*) into n_all from tickets where order_id = o.id and status <> 'replaced';
  if p->>'mode' = 'full' then
    amt := (m->>'refundable')::bigint; fees := (m->>'feesLeft')::bigint;
    for t in select * from tickets where order_id = o.id and status <> 'replaced' and coalesce(paid, 0) - refunded > 0 loop per := per || jsonb_build_object(t.id, t.paid - t.refunded); end loop;
  elsif p->>'mode' = 'tickets' then
    for t in select * from tickets where order_id = o.id and status <> 'replaced' and id::text in (select jsonb_array_elements_text(coalesce(p->'tickets','[]'))) loop
      per := per || jsonb_build_object(t.id, greatest(0, coalesce(t.paid, 0) - t.refunded)); amt := amt + greatest(0, coalesce(t.paid, 0) - t.refunded);
    end loop;
    n_sel := (select count(*) from jsonb_object_keys(per)); if n_sel = 0 then raise exception 'Choose the tickets to refund'; end if;
    if coalesce((p->>'fees')::boolean, false) then fees := least((m->>'feesLeft')::bigint, round((m->>'fees')::bigint * n_sel::numeric / greatest(1, n_all))::bigint); amt := amt + fees; end if;
  elsif p->>'mode' = 'fees' then fees := (m->>'feesLeft')::bigint; amt := fees;
  elsif p->>'mode' = 'percent' then
    pct := nullif(p->>'pct','')::numeric; if pct is null or pct <= 0 or pct > 100 then raise exception 'Enter a percentage between 1 and 100'; end if;
    amt := round((m->>'refundable')::bigint * pct / 100)::bigint;
  elsif p->>'mode' = 'amount' then
    amt := greatest(0, round(coalesce(nullif(p->>'amount','')::numeric, 0)))::bigint;
    if amt > (m->>'refundable')::bigint then raise exception 'You can refund at most % on this order', money_txt((m->>'refundable')::bigint); end if;
  else raise exception 'Choose how much to refund'; end if;
  amt := least(amt, (m->>'refundable')::bigint);
  if amt <= 0 then raise exception '%', case when (m->>'refundable')::bigint > 0 then 'Enter an amount to refund' else 'Nothing left to refund on this order' end; end if;
  return jsonb_build_object('amount', amt, 'fees', least(fees, amt), 'per', per);
end $$;
-- record a refund on the order. to = original (the processor refunds the card: left 'processing' for the payments Edge Function) | cash | other
-- | credit / eventCredit (a credit code instead of money)
create or replace function apply_refund(p_order uuid, plan jsonb, p jsonb, p_by text) returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; d jsonb; r jsonb; c credits%rowtype; tov text := coalesce(nullif(p->>'to',''), 'original'); k text;
begin
  select * into o from orders where id = p_order for update; d := o.data;
  if tov not in ('original','credit','eventCredit','cash','other') then raise exception 'Choose where the refund goes'; end if;
  r := jsonb_build_object('id', gen_random_uuid(), 'at', now(), 'by', p_by, 'amount', (plan->>'amount')::bigint, 'fees', (plan->>'fees')::bigint, 'to', tov,
    'note', left(coalesce(p->>'note', ''), 300), 'per', coalesce(plan->'per', '{}'), 'status', 'done', 'ref', null);
  if tov in ('credit','eventCredit') then
    if tov = 'eventCredit' and nullif(p->>'creditEvent','') is null then raise exception 'Choose the event the credit is for'; end if;
    c := issue_credit(o.box_office_id, jsonb_build_object('amount', plan->'amount', 'eventId', case when tov = 'eventCredit' then p->>'creditEvent' end, 'expires', p->>'creditExpires',
      'note', coalesce(nullif(p->>'note',''), 'Refunded as credit')), o, p_by);
    r := r || jsonb_build_object('credit', c.code);
    d := d || jsonb_build_object('credited', coalesce((d->>'credited')::bigint, 0) + (plan->>'amount')::bigint);
  else
    if tov = 'original' and o.payment->>'ref' is not null and coalesce(o.payment->>'provider','') not in ('', 'manual') then
      r := r || jsonb_build_object('status', 'processing', 'provider', o.payment->>'provider', 'payment', o.payment->>'ref'); end if;
    d := d || jsonb_build_object('refunded', coalesce((d->>'refunded')::bigint, 0) + (plan->>'amount')::bigint);
  end if;
  d := d || jsonb_build_object('refundedFees', coalesce((d->>'refundedFees')::bigint, 0) + (plan->>'fees')::bigint,
    'refunds', coalesce(d->'refunds', '[]') || jsonb_build_array(r));
  update orders set data = d where id = o.id;
  for k in select jsonb_object_keys(coalesce(plan->'per','{}')) loop update tickets set refunded = refunded + (plan->'per'->>k)::bigint where id = k::uuid and order_id = o.id; end loop;
  return r;
end $$;
create or replace function refund_text(r jsonb) returns text language sql immutable as $$
  select money_txt((r->>'amount')::bigint) || case when r->>'to' in ('credit','eventCredit') then ' as credit ' || (r->>'credit') else ' to ' || case r->>'to' when 'original' then 'original payment method'
    when 'cash' then 'cash' else 'other — recorded only' end end $$;
-- every ticket voided and no products left → cancelled (refunded when everything collected went back)
create or replace function settle_order_status(p_order uuid) returns void language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; m jsonb;
begin
  select * into o from orders where id = p_order;
  if exists(select 1 from tickets where order_id = o.id and status = 'valid')
     or exists(select 1 from jsonb_array_elements(o.data->'lines') l where l->>'kind' = 'addon' and (l->>'qty')::int - coalesce((l->>'removed')::int, 0) > 0) then return; end if;
  m := order_money(o);
  update orders set status = case when (m->>'collected')::bigint > 0 and (m->>'refunded')::bigint + (m->>'credited')::bigint >= (m->>'collected')::bigint then 'refunded' else 'cancelled' end where id = o.id;
end $$;
-- what a changed ticket costs (mirrors changePrice() in data.js)
create or replace function change_price(e events, t tickets, tt jsonb, p_slot text, p_sold int, p_override text) returns jsonb language plpgsql stable as $$
declare old_tt jsonb; same boolean; face bigint; paid bigint; ovr boolean := coalesce(p_override, '') <> '';
begin
  old_tt := (select x from jsonb_array_elements(e.data->'ticketTypes') x where x->>'id' = t.ticket_type_id);
  same := tt->>'id' = t.ticket_type_id and list_price(tt, p_slot) = list_price(old_tt, t.slot_id);
  face := case when same then t.face else (unit_price(tt, p_slot, p_sold, null)->>'price')::bigint end;
  paid := case when t.comp then 0 when ovr then greatest(0, round(p_override::numeric))::bigint when same then t.paid else greatest(0, face - coalesce(t.discount, 0)) end;
  return jsonb_build_object('face', face, 'newPaid', paid, 'diff', case when t.comp then 0 else paid - coalesce(t.paid, 0) end);
end $$;
-- Move / upgrade / downgrade / change type, section or showtime (mirrors changeOrderTickets() in data.js). The old ticket → 'replaced';
-- a new ticket is issued. The net difference is settled once: collect | due | waive, or refund | credit | eventCredit | none.
create or replace function change_order_tickets(p_order uuid, p jsonb, p_by text, p_inventory boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; c jsonb; t tickets%rowtype; e events%rowtype; tt jsonb; sl text; st text; seated boolean; ovr boolean; pr jsonb; plan jsonb := '[]'; x jsonb;
  vac uuid[] := '{}'; chosen text[] := '{}'; k text; net bigint := 0; keep boolean; rows jsonb := '[]'; nt uuid; paid bigint; disc bigint; frm text; tov text; kind text;
  m jsonb; out jsonb; r jsonb; ch jsonb; add int; cap int; used int;
begin
  select * into o from orders where id = p_order for update;
  if o.status <> 'paid' then raise exception 'Only paid orders can be changed'; end if;
  if jsonb_array_length(coalesce(p->'changes','[]')) = 0 then raise exception 'Choose at least one ticket to change'; end if;
  vac := array(select (y->>'ticket')::uuid from jsonb_array_elements(p->'changes') y);
  for c in select * from jsonb_array_elements(p->'changes') loop
    select * into t from tickets where id = (c->>'ticket')::uuid and order_id = o.id;
    if not found or t.status <> 'valid' then raise exception 'That ticket is no longer valid — reload the order'; end if;
    select * into e from events where id = t.event_id; perform pg_advisory_xact_lock(hashtext(e.id::text));
    seated := coalesce((e.data->'seating'->>'enabled')::boolean, false);
    sl := case when c ? 'slotId' then nullif(c->>'slotId','') else t.slot_id end;
    if jsonb_array_length(coalesce(e.data->'timeSlots','[]')) > 0 and not exists(select 1 from jsonb_array_elements(e.data->'timeSlots') s where s->>'id' = sl) then raise exception 'Choose a showtime'; end if;
    st := case when seated then case when c ? 'seat' then nullif(c->>'seat','') else t.seat end end;
    if seated and not coalesce(e.data->'seating'->'meta', '{}') ? coalesce(st, '') then raise exception 'Choose the new seat'; end if;
    tt := (select y from jsonb_array_elements(e.data->'ticketTypes') y where y->>'id' = case when seated then e.data->'seating'->'index'->>st else coalesce(nullif(c->>'ticketTypeId',''), t.ticket_type_id) end);
    if tt is null then raise exception '%', case when seated then seat_text(e, st) || ' is not for sale' else 'Unknown ticket type' end; end if;
    ovr := coalesce(c->>'price', '') <> '';
    if st is not distinct from t.seat and sl is not distinct from t.slot_id and tt->>'id' = t.ticket_type_id and not ovr then raise exception 'Ticket %: nothing to change', t.code; end if;
    if st is not null then   -- free, or vacated by this same change; staff may use held seats
      k := e.id || '|' || coalesce(sl, '') || '|' || st; if k = any(chosen) then raise exception '% is chosen twice', seat_text(e, st); end if; chosen := chosen || k;
      if exists(select 1 from tickets y where y.event_id = e.id and y.status = 'valid' and y.seat = st and coalesce(y.slot_id,'') = coalesce(sl,'') and not (y.id = any(vac)))
         or exists(select 1 from reserved_units(e.id) r2 where r2.seat = st and coalesce(r2.slot,'') = coalesce(sl,''))
         or seat_blocker(e.id, coalesce(sl,''), st, null, true) is not null then raise exception '% isn''t free', seat_text(e, st); end if;
    end if;
    plan := plan || jsonb_build_array(jsonb_build_object('t', t.id, 'e', e.id, 'tt', tt, 'seat', st, 'slot', sl, 'ovr', ovr, 'price', c->>'price'));
  end loop;
  if exists(select 1 from jsonb_array_elements(plan) y where (y->>'ovr')::boolean) and not p_inventory and not has_perm(o.box_office_id, 'tickets.pricing', o.event_ids[1]) then
    raise exception 'You don''t have permission to change ticket prices'; end if;
  -- ticket-type stock and showtime capacity, net of what this change gives back
  for e in select * from events where id in (select (y->>'e')::uuid from jsonb_array_elements(plan) y) loop
    for tt in select * from jsonb_array_elements(e.data->'ticketTypes') loop
      add := (select count(*) from jsonb_array_elements(plan) y where y->>'e' = e.id::text and y->'tt'->>'id' = tt->>'id')
           - (select count(*) from jsonb_array_elements(plan) y join tickets z on z.id = (y->>'t')::uuid where y->>'e' = e.id::text and z.ticket_type_id = tt->>'id');
      used := coalesce((availability(e.id)->'tt'->>(tt->>'id'))::int, 0);
      if add > 0 and coalesce((tt->>'qty')::int, 0) > 0 and used + add > (tt->>'qty')::int then raise exception 'Only % % left', greatest(0, (tt->>'qty')::int - used), tt->>'name'; end if;
    end loop;
    for x in select * from jsonb_array_elements(coalesce(e.data->'timeSlots','[]')) loop
      add := (select count(*) from jsonb_array_elements(plan) y where y->>'e' = e.id::text and y->>'slot' = x->>'id')
           - (select count(*) from jsonb_array_elements(plan) y join tickets z on z.id = (y->>'t')::uuid where y->>'e' = e.id::text and z.slot_id = x->>'id');
      cap := coalesce((x->>'capacity')::int, 0); used := coalesce((availability(e.id)->'slots'->>(x->>'id'))::int, 0);
      if add > 0 and cap > 0 and used + add > cap then raise exception 'That showtime is full'; end if;
    end loop;
  end loop;
  -- prices
  for x in select * from jsonb_array_elements(plan) loop
    select * into t from tickets where id = (x->>'t')::uuid; select * into e from events where id = (x->>'e')::uuid;
    pr := change_price(e, t, x->'tt', x->>'slot', coalesce((availability(e.id)->'tt'->>(x->'tt'->>'id'))::int, 0), case when (x->>'ovr')::boolean then x->>'price' end);
    net := net + (pr->>'diff')::bigint;
    rows := rows || jsonb_build_array(x || pr);
  end loop;
  m := order_money(o);
  if p_inventory and net <> 0 then raise exception 'That seat is a different price level — use Change seats on the order to upgrade or downgrade'; end if;
  if net > 0 and coalesce(p->>'settle','') not in ('collect','due','waive') then raise exception 'Choose how to handle the % difference', money_txt(net); end if;
  if net < 0 and coalesce(p->>'downgrade','') not in ('refund','credit','eventCredit','none') then raise exception 'Choose what to do with the % difference', money_txt(-net); end if;
  if net > 0 and p->>'settle' = 'collect' then
    if not has_perm(o.box_office_id, 'orders.edit', o.event_ids[1]) then raise exception 'You don''t have permission to take payments on orders'; end if;
    if coalesce(p->>'method','') not in ('cash','terminal','check','transfer','other') then raise exception 'Choose how the difference was paid'; end if; end if;
  if net < 0 and p->>'downgrade' <> 'none' then
    if not has_perm(o.box_office_id, 'orders.refund', o.event_ids[1]) then raise exception 'You don''t have permission to issue refunds'; end if;
    if -net > (m->>'refundable')::bigint then raise exception 'Only % can still be refunded on this order', money_txt((m->>'refundable')::bigint); end if; end if;
  keep := (net > 0 and p->>'settle' = 'waive') or (net < 0 and p->>'downgrade' = 'none');
  out := jsonb_build_object('net', net, 'tickets', '[]'::jsonb);
  for x in select * from jsonb_array_elements(rows) loop
    select * into t from tickets where id = (x->>'t')::uuid; select * into e from events where id = (x->>'e')::uuid;
    paid := case when keep then t.paid else (x->>'newPaid')::bigint end;
    disc := case when t.comp then 0 when (x->>'ovr')::boolean then greatest(0, (x->>'face')::bigint - paid) else coalesce(t.discount, 0) + case when keep and (x->>'diff')::bigint > 0 then (x->>'diff')::bigint else 0 end end;
    insert into tickets(box_office_id, order_id, event_id, ticket_type_id, slot_id, seat, area, "row", seat_label, unit, comp, face, paid, discount, promo, tracking, bundle, extras, price_override, answers, code, holder, status, checked_in_at, replaces)
      values (t.box_office_id, t.order_id, e.id, x->'tt'->>'id', x->>'slot', x->>'seat', e.data->'seating'->'meta'->(x->>'seat')->>0, e.data->'seating'->'meta'->(x->>'seat')->>1, e.data->'seating'->'meta'->(x->>'seat')->>2, nullif(e.data->'seating'->'meta'->(x->>'seat')->>3, ''),
        t.comp, (x->>'face')::bigint, paid, disc, t.promo, t.tracking, t.bundle, t.extras, (x->>'ovr')::boolean or t.price_override, t.answers, rand_code(10), t.holder, 'valid', t.checked_in_at, t.id) returning id into nt;
    update tickets set status = 'replaced', replaced_by = nt, changed_at = now() where id = t.id;
    frm := coalesce(case when t.seat is not null then seat_text(e, t.seat) end, (select y->>'name' from jsonb_array_elements(e.data->'ticketTypes') y where y->>'id' = t.ticket_type_id));
    tov := coalesce(case when x->>'seat' is not null then seat_text(e, x->>'seat') end, x->'tt'->>'name');
    kind := case when (x->>'diff')::bigint > 0 then 'upgrade' when (x->>'diff')::bigint < 0 then 'downgrade' else 'move' end;
    if t.seat is not null and (t.seat is distinct from x->>'seat' or t.slot_id is distinct from x->>'slot') then
      insert into seat_log(box_office_id, event_id, slot_id, seat, action, detail, by, ref) values (e.box_office_id, e.id, coalesce(t.slot_id,''), t.seat, 'moved', t.holder || ' moved to ' || tov || ' — seat released', p_by, o.ref); end if;
    if x->>'seat' is not null then
      delete from seat_status where event_id = e.id and seat = x->>'seat' and status = 'held' and slot_id in (coalesce(x->>'slot',''), '');
      if t.seat is distinct from x->>'seat' or t.slot_id is distinct from x->>'slot' then
        insert into seat_log(box_office_id, event_id, slot_id, seat, action, detail, by, ref) values (e.box_office_id, e.id, coalesce(x->>'slot',''), x->>'seat', 'moved',
          t.holder || ' moved here from ' || frm || case when kind <> 'move' then ' · ' || kind || ' ' || money_txt(abs((x->>'diff')::bigint)) else '' end, p_by, o.ref); end if;
    end if;
    out := jsonb_set(out, '{tickets}', (out->'tickets') || jsonb_build_array(jsonb_build_object('kind', kind, 'diff', (x->>'diff')::bigint,
      'from', jsonb_build_object('ticket', t.code, 'type', (select y->>'name' from jsonb_array_elements(e.data->'ticketTypes') y where y->>'id' = t.ticket_type_id), 'seat', case when t.seat is not null then seat_text(e, t.seat) end, 'slot', t.slot_id, 'face', t.face, 'paid', t.paid),
      'to', jsonb_build_object('ticket', (select code from tickets where id = nt), 'type', x->'tt'->>'name', 'seat', case when x->>'seat' is not null then seat_text(e, x->>'seat') end, 'slot', x->>'slot', 'face', (x->>'face')::bigint, 'paid', paid))));
  end loop;
  if net > 0 and p->>'settle' = 'collect' then
    ch := jsonb_build_object('id', gen_random_uuid(), 'at', now(), 'by', p_by, 'amount', net, 'method', p->>'method', 'ref', left(coalesce(p->>'ref',''), 80), 'reason', 'Upgrade difference');
    update orders set data = data || jsonb_build_object('charges', coalesce(data->'charges','[]') || jsonb_build_array(ch), 'extraPaid', coalesce((data->>'extraPaid')::bigint, 0) + net) where id = o.id;
    out := out || jsonb_build_object('charge', ch);
  elsif net > 0 and p->>'settle' = 'due' then
    update orders set data = data || jsonb_build_object('due', coalesce((data->>'due')::bigint, 0) + net) where id = o.id; out := out || jsonb_build_object('due', net);
  elsif net < 0 and p->>'downgrade' = 'refund' then
    out := out || jsonb_build_object('refund', apply_refund(o.id, jsonb_build_object('amount', -net, 'fees', 0, 'per', '{}'::jsonb), jsonb_build_object('to', coalesce(nullif(p->>'to',''), 'original'), 'note', p->>'note'), p_by));
  elsif net < 0 and p->>'downgrade' in ('credit','eventCredit') then
    out := out || jsonb_build_object('refund', apply_refund(o.id, jsonb_build_object('amount', -net, 'fees', 0, 'per', '{}'::jsonb),
      jsonb_build_object('to', p->>'downgrade', 'creditEvent', coalesce(nullif(p->>'creditEvent',''), o.event_ids[1]::text), 'creditExpires', p->>'creditExpires', 'note', p->>'note'), p_by));
  end if;
  return out || jsonb_build_object('settle', case when net > 0 then p->>'settle' when net < 0 then p->>'downgrade' end);
end $$;
create or replace function cancel_order_tickets(o orders, p jsonb, p_by text) returns text[] language plpgsql security definer set search_path = public as $$
declare t tickets%rowtype; e events%rowtype; mode text := coalesce(nullif(p->>'seat',''), 'release'); all_ boolean := coalesce((p->>'all')::boolean, false); codes text[] := '{}'; sst text;
begin
  if mode not in ('release','hold','block') then raise exception 'Choose what happens to the seats'; end if;
  if not all_ and jsonb_array_length(coalesce(p->'tickets','[]')) = 0 then raise exception 'Choose the tickets to cancel'; end if;
  for t in select * from tickets where order_id = o.id and status = 'valid' and (all_ or id::text in (select jsonb_array_elements_text(coalesce(p->'tickets','[]')))) for update loop
    update tickets set status = 'cancelled', cancelled_at = now() where id = t.id; codes := codes || t.code;
    if t.seat is null then continue; end if;
    select * into e from events where id = t.event_id;
    if mode = 'release' then
      insert into seat_log(box_office_id, event_id, slot_id, seat, action, detail, by, ref) values (o.box_office_id, e.id, coalesce(t.slot_id,''), t.seat, 'cancelled', 'Ticket ' || t.code || ' cancelled (order ' || o.ref || ') — seat released', p_by, o.ref);
    else
      sst := case mode when 'hold' then 'held' else 'blocked' end;
      delete from seat_status where event_id = e.id and seat = t.seat and slot_id = coalesce(t.slot_id,'') and status <> 'checkout';
      insert into seat_status(box_office_id, event_id, slot_id, seat, status, note, by) values (o.box_office_id, e.id, coalesce(t.slot_id,''), t.seat, sst, 'Kept from cancelled order ' || o.ref, p_by);
      insert into seat_log(box_office_id, event_id, slot_id, seat, action, detail, by, ref) values (o.box_office_id, e.id, coalesce(t.slot_id,''), t.seat, sst, 'Ticket ' || t.code || ' cancelled (order ' || o.ref || ') — seat kept ' || sst, p_by, o.ref);
    end if;
  end loop;
  if all_ then update orders set data = jsonb_set(data, '{lines}', (select jsonb_agg(case when l->>'kind' = 'addon' then l || jsonb_build_object('removed', (l->>'qty')::int) else l end order by n)
    from jsonb_array_elements(data->'lines') with ordinality z(l, n))) where id = o.id; end if;
  return codes;
end $$;
-- "Dinner × 2" strings on an event's valid tickets, from the order's product lines (after a product is added or removed)
create or replace function refresh_extras(p_order uuid, p_event text) returns void language sql security definer set search_path = public as $$
  update tickets set extras = (select coalesce(jsonb_agg((l->>'name') || ' × ' || ((l->>'qty')::int - coalesce((l->>'removed')::int, 0)) order by n), '[]')
    from orders o, jsonb_array_elements(o.data->'lines') with ordinality z(l, n) where o.id = p_order and l->>'kind' = 'addon' and l->>'eventId' = p_event and (l->>'qty')::int - coalesce((l->>'removed')::int, 0) > 0)
  where order_id = p_order and event_id::text = p_event and status = 'valid' $$;

-- Every staff change to an order (Eli Step 6). Mirrors demoOrderAction() in data.js. → jsonb {status, refund?, ...}
create or replace function order_action(p_order uuid, p_action text, p jsonb default '{}') returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; ev uuid; by_ text := me_email(); res jsonb := '{}'; plan jsonb; r jsonb; codes text[]; was text; all_ boolean; n_live int; amt bigint; l jsonb; e events%rowtype;
  ad jsonb; qty int; sold int; unit bigint; txt text := ''; nm text; em text; ph text; bef jsonb; aft jsonb; body text; subj text; t tickets%rowtype; mid uuid; s text;
  perm_ok boolean; nt uuid; pairs text[] := '{}'; nc text[] := '{}';
begin
  select * into o from orders where id = p_order for update;
  if not found or not is_member(o.box_office_id) and not is_super() then raise exception 'Order not found'; end if;
  ev := o.event_ids[1];
  if p_action = 'status' then   -- the old one-click buttons
    return order_action(p_order, case p->>'status' when 'paid' then 'markPaid' when 'refunded' then 'refund' when 'cancelled' then case when o.status in ('pending','awaiting_payment') then 'cancelUnpaid' else 'cancel' end else 'x' end,
      case p->>'status' when 'refunded' then jsonb_build_object('mode', 'full', 'to', 'original', 'cancel', true) || (p - 'status') when 'cancelled' then jsonb_build_object('all', true, 'seat', 'release') || (p - 'status') else p - 'status' end);
  end if;
  perm_ok := case p_action when 'markPaid' then has_perm(o.box_office_id, 'orders.edit', ev) when 'cancelUnpaid' then has_perm(o.box_office_id, 'orders.cancel', ev)
    when 'change' then has_perm(o.box_office_id, 'orders.seats', ev) when 'refund' then has_perm(o.box_office_id, 'orders.refund', ev)
    when 'collect' then has_perm(o.box_office_id, 'orders.edit', ev) when 'addAddon' then has_perm(o.box_office_id, 'orders.edit', ev) when 'removeAddon' then has_perm(o.box_office_id, 'orders.edit', ev)
    when 'customer' then has_perm(o.box_office_id, 'orders.customer', ev) when 'holder' then has_perm(o.box_office_id, 'orders.customer', ev)
    when 'note' then has_perm(o.box_office_id, 'orders.edit', ev) when 'message' then has_perm(o.box_office_id, 'comms.email', ev) when 'resend' then has_perm(o.box_office_id, 'orders.resend', ev)
    when 'reissue' then has_perm(o.box_office_id, 'orders.edit', ev) when 'cancel' then true else null end;
  if perm_ok is null then raise exception 'Unknown order action'; end if;
  if not perm_ok then raise exception 'You don''t have permission to do that'; end if;
  perform set_config('set.system', '1', true);   -- this function checks and logs the change itself
  if p_action = 'markPaid' then
    if o.status not in ('pending','awaiting_payment') then raise exception 'This order is not waiting for payment'; end if;
    was := o.status;
    update orders set status = 'paid', paid_at = now(), payment = coalesce(payment, '{}') || jsonb_build_object('markedPaidBy', by_) ||
      case when p->>'method' in ('cash','terminal','check','transfer','other') then jsonb_build_object('method', p->>'method') else '{}'::jsonb end where id = o.id;   -- orders_paid issues the tickets
    perform order_log_add(o, 'paid', format('marked paid (%s → paid) — tickets issued', was), by_, p->>'note', '{}', jsonb_build_object('status', was), '{"status":"paid"}');
  elsif p_action = 'cancelUnpaid' then
    if o.status not in ('pending','awaiting_payment') then raise exception 'This order is not an unpaid reservation'; end if;
    update orders set status = 'cancelled' where id = o.id;
    for l in select v from jsonb_array_elements(o.data->'lines') v loop
      for s in select jsonb_array_elements_text(coalesce(l->'seats','[]')) loop
        insert into seat_log(box_office_id, event_id, slot_id, seat, action, detail, by, ref) values (o.box_office_id, (l->>'eventId')::uuid, coalesce(l->>'slotId',''), s, 'released', 'Reservation ' || o.ref || ' cancelled — seat released', by_, o.ref);
      end loop;
    end loop;
    perform order_log_add(o, 'cancelled', 'unpaid reservation cancelled — seats released', by_, p->>'note', '{}', jsonb_build_object('status', o.status), '{"status":"cancelled"}');
  elsif p_action = 'change' then
    res := change_order_tickets(o.id, p, by_);
    perform order_log_add(o, 'change', format('%s: %s%s', case when jsonb_array_length(res->'tickets') = 1 then 'changed 1 ticket' else 'changed ' || jsonb_array_length(res->'tickets') || ' tickets' end,
      (select string_agg(coalesce(x->'from'->>'seat', x->'from'->>'type') || ' → ' || coalesce(x->'to'->>'seat', x->'to'->>'type'), '; ') from jsonb_array_elements(res->'tickets') x),
      case when (res->>'net')::bigint > 0 then ' · upgrade ' || money_txt((res->>'net')::bigint) || ' — ' || case res->>'settle' when 'collect' then 'collected' when 'due' then 'added to the balance due' else 'no charge' end
           when (res->>'net')::bigint < 0 then ' · downgrade ' || money_txt(-(res->>'net')::bigint) || ' — ' || case when res ? 'refund' then refund_text(res->'refund') else 'no refund' end else '' end), by_, p->>'note', res);
    if coalesce((p->>'notify')::boolean, true) then perform queue_mail(o, 'updated', 'Your updated tickets', 'Your tickets have changed. Your new tickets are attached — the old ones no longer work.', by_); end if;
    perform emit_event(o.box_office_id, 'seat.changed', jsonb_build_object('order_ref', o.ref, 'email', o.buyer_email, 'changes', res->'tickets', 'net', res->'net'));
  elsif p_action = 'cancel' then
    if o.status <> 'paid' then raise exception 'Only paid orders can be changed'; end if;
    select count(*) into n_live from tickets where order_id = o.id and status = 'valid';
    all_ := coalesce((p->>'all')::boolean, false) or (n_live > 0 and n_live = (select count(*) from tickets where order_id = o.id and status = 'valid' and id::text in (select jsonb_array_elements_text(coalesce(p->'tickets','[]')))));
    if not has_perm(o.box_office_id, case when all_ then 'orders.cancel' else 'orders.cancelTicket' end, ev) then raise exception 'You don''t have permission to do that'; end if;
    if p->'refund' is not null and jsonb_typeof(p->'refund') = 'object' then
      if not has_perm(o.box_office_id, 'orders.refund', ev) then raise exception 'You don''t have permission to issue refunds'; end if;
      plan := refund_plan(o, (p->'refund') || jsonb_build_object('mode', coalesce(nullif(p->'refund'->>'mode',''), 'tickets'),
        'tickets', case when all_ then (select jsonb_agg(id) from tickets where order_id = o.id and status = 'valid') else p->'tickets' end));
    end if;
    codes := cancel_order_tickets(o, p || jsonb_build_object('all', all_), by_);
    if plan is not null then r := apply_refund(o.id, plan, (p->'refund') || jsonb_build_object('note', p->>'note'), by_); end if;
    perform settle_order_status(o.id);
    perform order_log_add(o, 'cancel', format('%s (%s) — %s%s', case when all_ then 'order cancelled' else 'cancelled ' || coalesce(array_length(codes, 1), 0) || ' ticket' || case when coalesce(array_length(codes, 1), 0) = 1 then '' else 's' end end,
      coalesce(array_to_string(codes, ', '), 'products'), case coalesce(nullif(p->>'seat',''), 'release') when 'release' then 'release the seats for sale' when 'hold' then 'keep the seats held' else 'keep the seats blocked' end,
      case when r is not null then ' · refunded ' || refund_text(r) else ' · no refund' end), by_, p->>'note', jsonb_build_object('tickets', to_jsonb(codes), 'seat', coalesce(p->>'seat','release'), 'refund', r), null,
      jsonb_build_object('status', (select status from orders where id = o.id)));
    if coalesce((p->>'notify')::boolean, true) then perform queue_mail(o, 'cancelled', case when all_ then 'Your order was cancelled' else 'Some of your tickets were cancelled' end,
      case when r is not null then 'A refund of ' || money_txt((r->>'amount')::bigint) || ' has been issued.' else '' end, by_); end if;
    res := jsonb_build_object('cancelled', coalesce(array_length(codes, 1), 0), 'refund', r);
    perform emit_event(o.box_office_id, 'ticket.cancelled', jsonb_build_object('order_ref', o.ref, 'email', o.buyer_email, 'tickets', (select coalesce(jsonb_agg(id), '[]') from tickets where order_id = o.id and code = any(codes)), 'all', all_),
      order_ctx(o, array(select id from tickets where order_id = o.id and code = any(codes))) || jsonb_build_object('key', o.id || ':c' || (select count(*) from order_log where order_id = o.id)));
    if r is not null then perform emit_event(o.box_office_id, 'refund.issued', jsonb_build_object('order_ref', o.ref, 'email', o.buyer_email, 'amount', r->'amount', 'to', r->'to'),
      order_ctx(o, array(select id from tickets where order_id = o.id and code = any(codes))) || jsonb_build_object('key', o.id || ':r' || (select count(*) from order_log where order_id = o.id))); end if;
  elsif p_action = 'refund' then
    if not was_paid(o) then raise exception 'Nothing has been paid on this order'; end if;
    if coalesce((p->>'cancel')::boolean, false) and p->>'mode' in ('full','tickets') and not has_perm(o.box_office_id, case when p->>'mode' = 'full' then 'orders.cancel' else 'orders.cancelTicket' end, ev) then
      raise exception 'You don''t have permission to do that'; end if;
    plan := refund_plan(o, p); r := apply_refund(o.id, plan, p, by_);
    if coalesce((p->>'cancel')::boolean, false) and o.status = 'paid' and p->>'mode' in ('full','tickets') then
      codes := cancel_order_tickets(o, jsonb_build_object('all', p->>'mode' = 'full', 'tickets', case when p->>'mode' = 'tickets' then p->'tickets' else '[]'::jsonb end, 'seat', coalesce(p->>'seat','release')), by_);
      perform settle_order_status(o.id); end if;
    perform order_log_add(o, 'refund', 'refunded ' || refund_text(r) || case p->>'mode' when 'full' then ' (everything left)' when 'fees' then ' (booking fee)' when 'percent' then ' (' || (p->>'pct') || '%)'
      when 'tickets' then ' (' || (select count(*) from jsonb_object_keys(plan->'per')) || ' ticket(s)' || case when (plan->>'fees')::bigint > 0 then ' + booking fee' else '' end || ')' else '' end
      || case when coalesce(array_length(codes, 1), 0) > 0 then ' · ' || array_length(codes, 1) || ' ticket(s) cancelled' when coalesce((p->>'cancel')::boolean, false) then '' else ' · tickets kept' end,
      by_, p->>'note', jsonb_build_object('refund', r, 'cancelled', to_jsonb(coalesce(codes, '{}'))), null, jsonb_build_object('status', (select status from orders where id = o.id)));
    if coalesce((p->>'notify')::boolean, true) then perform queue_mail(o, 'refund', 'Your refund', 'We''ve issued a refund of ' || money_txt((r->>'amount')::bigint)
      || case when r ? 'credit' then ' as credit — use code ' || (r->>'credit') || ' on your next order' else '' end || '.', by_); end if;
    res := jsonb_build_object('refund', r);
    perform emit_event(o.box_office_id, 'refund.issued', jsonb_build_object('order_ref', o.ref, 'email', o.buyer_email, 'amount', r->'amount', 'to', r->'to'),
      order_ctx(o) || jsonb_build_object('key', o.id || ':r' || (select count(*) from order_log where order_id = o.id)));
    if coalesce(array_length(codes, 1), 0) > 0 then perform emit_event(o.box_office_id, 'ticket.cancelled', jsonb_build_object('order_ref', o.ref, 'email', o.buyer_email,
      'tickets', (select coalesce(jsonb_agg(id), '[]') from tickets where order_id = o.id and code = any(codes)), 'all', p->>'mode' = 'full'),
      order_ctx(o, array(select id from tickets where order_id = o.id and code = any(codes))) || jsonb_build_object('key', o.id || ':c' || (select count(*) from order_log where order_id = o.id))); end if;
  elsif p_action = 'collect' then
    amt := greatest(0, round(coalesce(nullif(p->>'amount','')::numeric, 0)))::bigint; if amt <= 0 then raise exception 'Enter the amount received'; end if;
    if coalesce(p->>'method','') not in ('cash','terminal','check','transfer','other') then raise exception 'Choose how it was paid'; end if;
    update orders set data = data || jsonb_build_object('charges', coalesce(data->'charges','[]') || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'at', now(), 'by', by_, 'amount', amt,
        'method', p->>'method', 'ref', left(coalesce(p->>'ref',''), 80), 'reason', left(coalesce(nullif(p->>'reason',''), 'Payment received'), 120))),
      'extraPaid', coalesce((data->>'extraPaid')::bigint, 0) + amt, 'due', greatest(0, coalesce((data->>'due')::bigint, 0) - amt)) where id = o.id;
    perform order_log_add(o, 'payment', money_txt(amt) || ' received (' || (p->>'method') || ')' || case when coalesce(p->>'ref','') <> '' then ' · ref ' || (p->>'ref') else '' end, by_, p->>'note', jsonb_build_object('amount', amt, 'method', p->>'method'));
  elsif p_action = 'addAddon' then
    if o.status <> 'paid' then raise exception 'Only paid orders can be changed'; end if;
    select * into e from events where id = coalesce(nullif(p->>'eventId','')::uuid, ev) and id = any(o.event_ids);
    ad := (select y from jsonb_array_elements(coalesce(e.data->'addons','[]')) y where y->>'id' = p->>'addonId'); qty := floor(coalesce(nullif(p->>'qty','')::numeric, 0));
    if ad is null then raise exception 'Choose a product'; end if; if qty < 1 then raise exception 'Enter a quantity'; end if;
    perform pg_advisory_xact_lock(hashtext(e.id::text)); sold := coalesce((availability(e.id)->'ad'->>(ad->>'id'))::int, 0);
    if coalesce((ad->>'qty')::int, 0) > 0 and sold + qty > (ad->>'qty')::int then raise exception 'Only % % left', greatest(0, (ad->>'qty')::int - sold), ad->>'name'; end if;
    unit := greatest(0, round(coalesce((ad->>'price')::numeric, 0)))::bigint; amt := unit * qty;
    if amt > 0 then
      if p->>'settle' = 'collect' then
        if coalesce(p->>'method','') not in ('cash','terminal','check','transfer','other') then raise exception 'Choose how it was paid'; end if;
        update orders set data = data || jsonb_build_object('charges', coalesce(data->'charges','[]') || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'at', now(), 'by', by_, 'amount', amt, 'method', p->>'method',
          'ref', left(coalesce(p->>'ref',''), 80), 'reason', 'Added ' || (ad->>'name'))), 'extraPaid', coalesce((data->>'extraPaid')::bigint, 0) + amt) where id = o.id;
        txt := ' · ' || money_txt(amt) || ' collected';
      elsif p->>'settle' = 'due' then update orders set data = data || jsonb_build_object('due', coalesce((data->>'due')::bigint, 0) + amt) where id = o.id; txt := ' · ' || money_txt(amt) || ' added to the balance due';
      elsif p->>'settle' = 'waive' then txt := ' · no charge';
      else raise exception 'Choose how the % is paid', money_txt(amt); end if;
    end if;
    update orders set data = jsonb_set(data, '{lines}', data->'lines' || jsonb_build_array(jsonb_build_object('kind', 'addon', 'eventId', e.id, 'eventName', e.data->>'name', 'addonId', ad->>'id', 'name', ad->>'name', 'qty', qty,
      'unit', case when p->>'settle' = 'waive' then 0 else unit end, 'face', unit, 'unitFee', 0, 'fee', 0, 'added', now(), 'by', by_) || case when p->>'settle' = 'waive' then '{"waived":true}'::jsonb else '{}'::jsonb end)) where id = o.id;
    perform refresh_extras(o.id, e.id::text);
    perform order_log_add(o, 'addon', 'added ' || (ad->>'name') || ' × ' || qty || txt, by_, p->>'note', jsonb_build_object('addonId', ad->>'id', 'qty', qty));
  elsif p_action = 'removeAddon' then
    if o.status <> 'paid' then raise exception 'Only paid orders can be changed'; end if;
    l := o.data->'lines'->((p->>'line')::int); qty := floor(coalesce(nullif(p->>'qty','')::numeric, 0));
    if l is null or l->>'kind' <> 'addon' then raise exception 'Choose a product'; end if;
    if qty < 1 or qty > (l->>'qty')::int - coalesce((l->>'removed')::int, 0) then raise exception 'Enter how many to remove'; end if;
    amt := least((l->>'unit')::bigint * qty, (order_money(o)->>'refundable')::bigint);
    if coalesce((p->>'refund')::boolean, false) and amt > 0 then
      if not has_perm(o.box_office_id, 'orders.refund', ev) then raise exception 'You don''t have permission to issue refunds'; end if;
      r := apply_refund(o.id, jsonb_build_object('amount', amt, 'fees', 0, 'per', '{}'::jsonb), p, by_); end if;
    update orders set data = jsonb_set(data, array['lines', p->>'line', 'removed'], to_jsonb(coalesce((l->>'removed')::int, 0) + qty)) where id = o.id;
    perform refresh_extras(o.id, l->>'eventId'); perform settle_order_status(o.id);
    perform order_log_add(o, 'addon', 'removed ' || (l->>'name') || ' × ' || qty || case when r is not null then ' · refunded ' || refund_text(r) else ' · no refund' end, by_, p->>'note', jsonb_build_object('addonId', l->>'addonId', 'qty', qty, 'refund', r));
  elsif p_action = 'customer' then
    nm := trim(coalesce(p->>'name', o.data->'buyer'->>'name')); em := lower(trim(coalesce(p->>'email', o.buyer_email))); ph := trim(coalesce(p->>'phone', o.data->'buyer'->>'phone', ''));
    if nm = '' then raise exception 'Name is required'; end if; if em !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'A valid email is required'; end if;
    bef := jsonb_build_object('name', o.data->'buyer'->>'name', 'email', o.buyer_email, 'phone', coalesce(o.data->'buyer'->>'phone','')); aft := jsonb_build_object('name', nm, 'email', em, 'phone', ph);
    if bef = aft then raise exception 'Nothing changed'; end if;
    update orders set buyer_email = em, data = jsonb_set(data, '{buyer}', coalesce(data->'buyer','{}') || aft) where id = o.id;
    perform order_log_add(o, 'customer', 'customer details changed: ' || (select string_agg(k2, ', ') from jsonb_object_keys(aft) k2 where aft->>k2 is distinct from bef->>k2), by_, p->>'note', '{}', bef, aft);
  elsif p_action = 'holder' then
    select * into t from tickets where id = nullif(p->>'ticket','')::uuid and order_id = o.id and status = 'valid'; if not found then raise exception 'That ticket is no longer valid'; end if;
    nm := left(trim(coalesce(p->>'name','')), 120); if nm = '' then raise exception 'Enter the new name'; end if;
    update tickets set holder = nm where id = t.id;
    perform order_log_add(o, 'holder', format('ticket %s now in the name of %s (was %s)', t.code, nm, t.holder), by_, p->>'note', jsonb_build_object('ticket', t.code), jsonb_build_object('holder', t.holder), jsonb_build_object('holder', nm));
  elsif p_action = 'note' then
    body := trim(coalesce(p->>'body','')); if body = '' then raise exception 'Write a note'; end if;
    perform order_log_add(o, 'note', left(body, 500), by_, '');
  elsif p_action = 'message' then
    subj := trim(coalesce(p->>'subject','')); body := trim(coalesce(p->>'body','')); if subj = '' or body = '' then raise exception 'Add a subject and a message'; end if;
    mid := queue_mail(o, 'message', subj, body, by_);
    perform order_log_add(o, 'message', format('message queued for %s: “%s”', o.buyer_email, left(subj, 80)), by_, '', jsonb_build_object('outbox', mid));
  elsif p_action = 'reissue' then   -- same seat / type, new QR code; the old code stops working at the door at once (Stage 7)
    if o.status <> 'paid' then raise exception 'Only paid orders can be changed'; end if;
    for t in select * from tickets where order_id = o.id and status = 'valid'
        and (coalesce(jsonb_array_length(p->'tickets'), 0) = 0 or id::text in (select jsonb_array_elements_text(p->'tickets'))) order by issued_at, id loop
      update tickets set status = 'replaced', changed_at = now() where id = t.id;   -- first, so the seat is free for its replacement
      insert into tickets(box_office_id, order_id, event_id, ticket_type_id, slot_id, seat, area, "row", seat_label, unit, comp, face, paid, discount, promo, tracking, bundle, extras, price_override, answers,
          code, holder, status, checked_in_at, checkin, refunded, replaces)
        values (t.box_office_id, t.order_id, t.event_id, t.ticket_type_id, t.slot_id, t.seat, t.area, t."row", t.seat_label, t.unit, t.comp, t.face, t.paid, t.discount, t.promo, t.tracking, t.bundle, t.extras,
          t.price_override, t.answers, rand_code(10), t.holder, 'valid', t.checked_in_at, t.checkin, t.refunded, t.id) returning id into nt;
      update tickets set replaced_by = nt where id = t.id;
      nc := nc || (select code from tickets where id = nt); pairs := pairs || (t.code || ' → ' || nc[cardinality(nc)]);
    end loop;
    if cardinality(nc) = 0 then raise exception 'Choose the tickets to reissue'; end if;
    perform order_log_add(o, 'reissue', format('reissued %s ticket%s with new QR codes (%s) — the old codes no longer scan', cardinality(nc), case when cardinality(nc) = 1 then '' else 's' end,
      array_to_string(pairs, ', ')), by_, coalesce(p->>'note', ''), jsonb_build_object('pairs', to_jsonb(pairs)));
    if coalesce((p->>'notify')::boolean, true) then
      perform queue_mail(o, 'tickets', 'Your updated tickets', 'Your tickets were reissued with new QR codes. Please use these — the old ones no longer work at the door.', by_); end if;
    res := jsonb_build_object('codes', to_jsonb(nc));
  elsif p_action = 'resend' then
    if p->>'kind' is distinct from 'confirmation' and not exists(select 1 from tickets where order_id = o.id and status = 'valid') then raise exception 'This order has no valid tickets'; end if;
    mid := queue_mail(o, case when p->>'kind' = 'confirmation' then 'confirmation_copy' else 'tickets' end, case when p->>'kind' = 'confirmation' then 'Your order confirmation' else 'Your tickets' end, '', by_);
    perform order_log_add(o, 'resend', case when p->>'kind' = 'confirmation' then 'confirmation email' else 'tickets' end || ' re-sent to ' || o.buyer_email, by_, '', jsonb_build_object('outbox', mid));
  end if;
  perform set_config('set.system', '', true);
  return res || jsonb_build_object('status', (select status from orders where id = o.id));
end $$;
-- the payments Edge Function (service role) reports what the processor did with a 'processing' refund
create or replace function finish_refund(p_order uuid, p_refund text, p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; r jsonb; i int; k text;
begin
  select * into o from orders where id = p_order for update;
  select n - 1, v into i, r from jsonb_array_elements(coalesce(o.data->'refunds','[]')) with ordinality z(v, n) where v->>'id' = p_refund;
  if r is null or r->>'status' <> 'processing' then return; end if;
  if coalesce((p->>'ok')::boolean, false) then
    update orders set data = jsonb_set(data, array['refunds', i::text], r || jsonb_build_object('status', 'done', 'ref', p->>'ref')) where id = o.id;
  else   -- the processor refused: the money did not go back, so it is still refundable
    update orders set data = jsonb_set(data, array['refunds', i::text], r || jsonb_build_object('status', 'failed', 'error', left(coalesce(p->>'error',''), 300)))
      || jsonb_build_object('refunded', greatest(0, coalesce((data->>'refunded')::bigint, 0) - (r->>'amount')::bigint), 'refundedFees', greatest(0, coalesce((data->>'refundedFees')::bigint, 0) - (r->>'fees')::bigint))
      where id = o.id;
    for k in select jsonb_object_keys(coalesce(r->'per','{}')) loop update tickets set refunded = greatest(0, refunded - (r->'per'->>k)::bigint) where id = k::uuid; end loop;
    insert into order_log(box_office_id, order_id, ref, event_id, kind, summary, by, data) values (o.box_office_id, o.id, o.ref, o.event_ids[1], 'refund',
      'card refund of ' || money_txt((r->>'amount')::bigint) || ' FAILED at the processor: ' || coalesce(p->>'error','') || ' — not refunded', 'system', jsonb_build_object('refund', r));
  end if;
end $$;
-- Credits outside an order: issue (goodwill / future-event credit), revoke what's left, apply to an order's balance due
create or replace function credit_action(p_bo uuid, p_action text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare c credits%rowtype; o orders%rowtype; st jsonb; amt bigint; why text;
begin
  if not has_perm(p_bo, 'orders.refund') then raise exception 'You don''t have permission to manage credits'; end if;
  if p_action = 'issue' then
    if nullif(p->>'order','') is not null then select * into o from orders where id = (p->>'order')::uuid and box_office_id = p_bo; end if;
    c := issue_credit(p_bo, p, o, me_email());
    perform log_action(p_bo, 'credit.issued', format('Issued %s credit %s to %s', money_txt(c.amount), c.code, c.email), null, null, coalesce(c.event_id, o.event_ids[1]));
    if o.id is not null then insert into order_log(box_office_id, order_id, ref, event_id, kind, summary, by, note, data) values (o.box_office_id, o.id, o.ref, o.event_ids[1], 'credit',
      format('credit %s issued: %s', c.code, money_txt(c.amount)), me_email(), coalesce(p->>'note',''), jsonb_build_object('credit', c.code)); end if;
    return to_jsonb(c);
  end if;
  select * into c from credits where id = nullif(p->>'id','')::uuid and box_office_id = p_bo for update; if not found then raise exception 'Credit not found'; end if;
  st := credit_state(c);
  if p_action = 'revoke' then
    if c.revoked_at is not null then raise exception 'Already revoked'; end if;
    update credits set revoked_at = now(), revoked_by = me_email(), revoke_note = left(coalesce(p->>'note',''), 300) where id = c.id returning * into c;
    perform log_action(p_bo, 'credit.revoked', format('Revoked credit %s (%s unused)', c.code, money_txt((st->>'remaining')::bigint)));
    return to_jsonb(c);
  elsif p_action = 'apply' then
    select * into o from orders where id = nullif(p->>'order','')::uuid and box_office_id = p_bo for update; if not found then raise exception 'Order not found'; end if;
    why := credit_problem(c, o.event_ids); if why <> '' then raise exception '%', why; end if;
    amt := least(coalesce(nullif(round(coalesce(nullif(p->>'amount','')::numeric, 0))::bigint, 0), (st->>'remaining')::bigint), (st->>'remaining')::bigint, coalesce((o.data->>'due')::bigint, 0));
    if amt <= 0 then raise exception 'This order has no balance due'; end if;
    update credits set applied = applied || jsonb_build_array(jsonb_build_object('order_id', o.id, 'ref', o.ref, 'amount', amt, 'events', to_jsonb(o.event_ids), 'at', now(), 'by', me_email())) where id = c.id returning * into c;
    update orders set data = data || jsonb_build_object('due', coalesce((data->>'due')::bigint, 0) - amt, 'charges', coalesce(data->'charges','[]') || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'at', now(),
      'by', me_email(), 'amount', amt, 'method', 'credit', 'ref', c.code, 'reason', 'Credit applied'))) where id = o.id;
    insert into order_log(box_office_id, order_id, ref, event_id, kind, summary, by, data) values (o.box_office_id, o.id, o.ref, o.event_ids[1], 'payment', format('credit %s applied: %s', c.code, money_txt(amt)), me_email(), jsonb_build_object('credit', c.code, 'amount', amt));
    perform log_action(p_bo, 'credit.applied', format('Applied %s of credit %s to order %s', money_txt(amt), c.code, o.ref), null, null, o.event_ids[1]);
    return to_jsonb(c);
  end if;
  raise exception 'Unknown credit action';
end $$;
create or replace function customer_note(p_bo uuid, p_email text, p_body text) returns jsonb language plpgsql security definer set search_path = public as $$
declare n customer_notes%rowtype;
begin
  if not has_perm(p_bo, 'customers.profiles') then raise exception 'You don''t have permission to do that'; end if;
  if trim(coalesce(p_body,'')) = '' then raise exception 'Write a note'; end if;
  insert into customer_notes(box_office_id, email, body, by) values (p_bo, lower(trim(p_email)), left(trim(p_body), 1000), me_email()) returning * into n;
  return to_jsonb(n);
end $$;
-- buyers: what a typed credit code is worth (never whose it is) · the signed-in customer's own credits
create or replace function check_credit(p_bo uuid, p_code text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', c.code, 'remaining', (credit_state(c)->>'remaining')::bigint, 'status', credit_state(c)->>'status', 'event_id', c.event_id, 'expires', c.expires)
  from credits c where c.box_office_id = p_bo and c.code = upper(trim(p_code)) $$;
create or replace function my_credits() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare em text := me_email();
begin
  if em = '' or (select email_confirmed_at from auth.users where id = auth.uid()) is null then return '[]'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'box_office_id', c.box_office_id, 'amount', c.amount, 'remaining', (credit_state(c)->>'remaining')::bigint,
    'status', credit_state(c)->>'status', 'event_id', c.event_id, 'expires', c.expires, 'issued_at', c.issued_at)) from credits c where c.email = em), '[]');
end $$;
-- live activity: a visitor on an event page (cart = tickets of this event in their cart; converted = they just ordered)
create or replace function presence_ping(p_event uuid, p_visitor text, p_cart int default 0, p_converted boolean default false) returns void language sql security definer set search_path = public as $$
  insert into event_presence(event_id, visitor, at, cart, carted_at, converted_at)
    select p_event, left(p_visitor, 64), now(), greatest(0, least(99, coalesce(p_cart, 0))), case when coalesce(p_cart, 0) > 0 then now() end, case when p_converted then now() end
    where exists(select 1 from events e where e.id = p_event and event_live(e))
  on conflict (event_id, visitor) do update set at = now(), cart = excluded.cart, carted_at = coalesce(event_presence.carted_at, excluded.carted_at), converted_at = coalesce(excluded.converted_at, event_presence.converted_at) $$;

-- ── Promo + tracking code admin (Stage 4) ──
create or replace function code_clash(p_bo uuid, p_codes text[], p_self text) returns void language plpgsql stable security definer set search_path = public as $$
declare c text; f jsonb;
begin
  if exists(select 1 from unnest(p_codes) y where y !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$') then raise exception 'Codes are 3–32 letters, numbers, - or _'; end if;
  if (select count(*) from unnest(p_codes)) <> (select count(distinct y) from unnest(p_codes) y) then raise exception 'The same code appears twice'; end if;
  foreach c in array p_codes loop
    f := find_code(p_bo, c);
    if f is not null and coalesce(f->'promo'->>'id', f->'tracking'->>'id') <> coalesce(p_self, '') then raise exception 'Code % is already in use', c; end if;
  end loop;
end $$;
create or replace function save_promo(p_bo uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare ex promos%rowtype; v_id text := coalesce(nullif(p->>'id',''), 'pr_' || lower(rand_code(6))); v_code text := upper(trim(coalesce(p->>'code',''))); v_codes jsonb; d jsonb; v_new boolean;
begin
  select * into ex from promos where id = v_id; v_new := ex.id is null;
  if ex.id is not null and ex.box_office_id <> p_bo then raise exception 'not allowed'; end if;
  if not has_perm(p_bo, case when ex.id is null then 'tickets.discounts' else 'tickets.discountsEdit' end) then raise exception 'You don''t have permission to do that'; end if;
  v_codes := (select coalesce(jsonb_agg(c order by o), '[]') from (select upper(trim(y)) c, min(o) o from jsonb_array_elements_text(coalesce(p->'codes','[]')) with ordinality z(y, o) where trim(y) <> '' group by 1) q);
  perform code_clash(p_bo, array[v_code] || array(select jsonb_array_elements_text(v_codes)), v_id);
  if coalesce(p->>'type','') not in ('pct','fixed','order') then raise exception 'Choose a discount type'; end if;
  if p->>'type' = 'pct' and not (coalesce((p->>'amount')::numeric, 0) > 0 and (p->>'amount')::numeric <= 100) then raise exception 'Percent must be between 1 and 100'; end if;
  if p->>'type' <> 'pct' and not (coalesce((p->>'amount')::numeric, 0) > 0) then raise exception 'Enter the discount amount'; end if;
  d := (p - 'id' - 'box_office_id' - 'created_at' - 'created_by' - '_kind' - '_pid') || jsonb_build_object('code', v_code, 'codes', v_codes);
  if ex.id is null then insert into promos(id, box_office_id, code, data, created_by) values (v_id, p_bo, v_code, d, me_email()) returning * into ex;
  else update promos set code = v_code, data = d where id = v_id returning * into ex; end if;
  perform log_action(p_bo, case when v_new then 'promo.created' else 'promo.updated' end,
    format('Saved promo code %s%s', v_code, case when jsonb_array_length(v_codes) > 0 then format(' (+%s unique codes)', jsonb_array_length(v_codes)) else '' end));
  return d || jsonb_build_object('id', ex.id, 'box_office_id', ex.box_office_id, 'created_at', ex.created_at, 'created_by', ex.created_by);
end $$;
create or replace function delete_promo(p_bo uuid, p_id text) returns void language plpgsql security definer set search_path = public as $$
declare x promos%rowtype;
begin
  select * into x from promos where id = p_id and box_office_id = p_bo; if x.id is null then return; end if;
  if not has_perm(p_bo, 'tickets.discountsEdit') then raise exception 'You don''t have permission to do that'; end if;
  if exists(select 1 from orders where box_office_id = p_bo and data->'promo'->>'id' = p_id) then raise exception 'This code has been used — switch it off instead, so its report is kept'; end if;
  delete from promos where id = p_id; perform log_action(p_bo, 'promo.deleted', 'Deleted promo code ' || x.code);
end $$;
create or replace function save_tracking(p_bo uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare ex tracking_codes%rowtype; v_id text := coalesce(nullif(p->>'id',''), 'tr_' || lower(rand_code(6))); v_code text := upper(trim(coalesce(p->>'code',''))); d jsonb;
begin
  select * into ex from tracking_codes where id = v_id;
  if ex.id is not null and ex.box_office_id <> p_bo then raise exception 'not allowed'; end if;
  if not has_perm(p_bo, 'tickets.tracking') then raise exception 'You don''t have permission to do that'; end if;
  perform code_clash(p_bo, array[v_code], v_id);
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'Who or what is this code for?'; end if;
  d := (p - 'id' - 'box_office_id' - 'created_at' - '_kind' - '_pid') || jsonb_build_object('code', v_code);
  if ex.id is null then insert into tracking_codes(id, box_office_id, code, data) values (v_id, p_bo, v_code, d) returning * into ex;
  else update tracking_codes set code = v_code, data = d where id = v_id returning * into ex; end if;
  perform log_action(p_bo, 'tracking.saved', format('Saved tracking code %s (%s)', v_code, p->>'name'));
  return d || jsonb_build_object('id', ex.id, 'box_office_id', ex.box_office_id, 'created_at', ex.created_at);
end $$;
create or replace function delete_tracking(p_bo uuid, p_id text) returns void language plpgsql security definer set search_path = public as $$
declare x tracking_codes%rowtype;
begin
  select * into x from tracking_codes where id = p_id and box_office_id = p_bo; if x.id is null then return; end if;
  if not has_perm(p_bo, 'tickets.tracking') then raise exception 'You don''t have permission to do that'; end if;
  if exists(select 1 from orders where box_office_id = p_bo and data->>'tracking' = x.code) then raise exception 'This code has orders — switch it off instead, so its report is kept'; end if;
  delete from tracking_codes where id = p_id; perform log_action(p_bo, 'tracking.deleted', 'Deleted tracking code ' || x.code);
end $$;

-- Door check-in (staff of the ticket's box office only). Another box office's ticket looks exactly like an unknown code.
-- ── Door / scanning (Stage 7). Mirrors demoCheckin() / doorTicket() / DB.door* in data.js. ──
-- What a scanner may know about a ticket: where the guest belongs — never money, email or phone.
create or replace function door_ticket(t tickets, p_names boolean) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', t.id, 'code', t.code, 'event_id', t.event_id, 'event_name', e.data->>'name', 'event_start', e.data->>'start', 'slot_id', t.slot_id,
    'slot_start', (select s->>'start' from jsonb_array_elements(coalesce(e.data->'timeSlots', '[]')) s where s->>'id' = t.slot_id limit 1),
    'ticket_type_id', t.ticket_type_id, 'type', z.tt->>'name', 'admits', greatest(1, coalesce((z.tt->>'admits')::int, 1)),
    'seat', t.seat, 'area', t.area, 'row', t."row", 'seat_label', t.seat_label, 'unit', t.unit,
    'holder', case when p_names then t.holder else 'Guest' end, 'comp', t.comp, 'status', t.status, 'checked_in_at', t.checked_in_at, 'checkin', t.checkin,
    'order_id', t.order_id, 'order_ref', o.ref,
    'of', (select count(*) from tickets x where x.order_id = t.order_id and x.status = 'valid'),
    'no', (select count(*) from tickets x where x.order_id = t.order_id and x.status = 'valid' and (x.issued_at, x.id) <= (t.issued_at, t.id)),
    'due', coalesce((o.data->>'due')::bigint, 0) > 0)
  from events e left join lateral (select y from jsonb_array_elements(e.data->'ticketTypes') y where y->>'id' = t.ticket_type_id limit 1) z(tt) on true
    left join orders o on o.id = t.order_id
  where e.id = t.event_id $$;
-- An entrance can be limited to ticket types and/or seating areas. No limits = everyone.
create or replace function entrance_takes(en jsonb, t tickets) returns boolean language sql immutable as $$
  select en is null or ((jsonb_array_length(coalesce(en->'ticketTypeIds', '[]')) = 0 or en->'ticketTypeIds' ? t.ticket_type_id)
    and (jsonb_array_length(coalesce(en->'areas', '[]')) = 0 or en->'areas' ? coalesce(t.area, ''))) $$;
-- Scan / check in one ticket. p_event = the event being scanned. p {slot, entrance (id), device, deviceName, manual, override}.
-- → {result: ok | already | undone | unknown | cancelled | refunded | replaced | wrong_event | wrong_slot | wrong_entrance | inactive | device_off, ticket, first?, entrances?}
-- Every attempt is logged in scan_log. The check-in itself is one conditional UPDATE, so two scanners can never both accept a ticket.
drop function if exists checkin(text, boolean, uuid);
create or replace function checkin(p_code text, p_undo boolean default false, p_event uuid default null, p jsonb default '{}') returns jsonb language plpgsql security definer set search_path = public as $$
declare t tickets%rowtype; c text := upper(left(trim(coalesce(p_code, '')), 64)); bo uuid; ev events%rowtype; te events%rowtype; o orders%rowtype; en jsonb; dv scan_devices%rowtype;
  res text; extra jsonb := '{}'; names boolean; dev text := left(coalesce(p->>'device', ''), 40); manual boolean := coalesce((p->>'manual')::boolean, false);
begin
  if me_email() = '' then raise exception 'Sign in first'; end if;
  select * into t from tickets where code = c;
  if p_event is not null then select * into ev from events where id = p_event; if not found then raise exception 'Event not found'; end if; end if;
  bo := coalesce(ev.box_office_id, t.box_office_id);
  if bo is null or not is_member(bo) then return jsonb_build_object('result', 'unknown'); end if;   -- another box office's ticket looks exactly like a fake one
  if not has_perm(bo, 'door.scan', p_event) then raise exception 'You don''t have permission to do that'; end if;
  if t.id is not null and t.box_office_id <> bo then t := null; end if;
  names := has_perm(bo, 'customers.names');
  if p_event is not null then select x into en from jsonb_array_elements(coalesce(ev.data->'entrances', '[]')) x where x->>'id' = p->>'entrance'; end if;
  if dev <> '' then
    insert into scan_devices as d (box_office_id, id, name, entrance, last_by, scans) values (bo, dev, coalesce(nullif(left(p->>'deviceName', 60), ''), 'Scanner'), coalesce(en->>'name', ''), me_email(), 1)
      on conflict (box_office_id, id) do update set last_seen = now(), last_by = me_email(), scans = d.scans + 1, entrance = coalesce(en->>'name', ''),
        name = case when d.renamed or coalesce(p->>'deviceName', '') = '' then d.name else left(p->>'deviceName', 60) end
      returning * into dv;
  end if;
  res := case when coalesce(dv.disabled, false) then 'device_off' when t.id is null then 'unknown' when p_event is not null and t.event_id <> p_event then 'wrong_event' end;
  if res is null then
    if not has_perm(bo, case when p_undo then 'door.undo' else 'door.checkin' end, t.event_id) then raise exception 'You don''t have permission to do that'; end if;
    select * into o from orders where id = t.order_id; select * into te from events where id = t.event_id;
    res := case when t.status = 'replaced' then 'replaced' when t.status <> 'valid' then case when t.refunded > 0 then 'refunded' else 'cancelled' end
      when nullif(p->>'slot', '') is not null and t.slot_id is not null and t.slot_id <> p->>'slot' then 'wrong_slot'
      when o.status not in ('paid', 'refunded') or coalesce((te.data->>'archived')::boolean, false) then 'inactive' end;
  end if;
  if res is null and p_undo then
    update tickets set checked_in_at = null, checkin = null where id = t.id returning * into t;
    perform log_action(bo, 'door.undo', 'Undid check-in for ticket ' || t.code, null, null, t.event_id); res := 'undone';
  end if;
  if res is null and en is not null and not entrance_takes(en, t) then
    if not coalesce((p->>'override')::boolean, false) then
      res := 'wrong_entrance';
      extra := jsonb_build_object('entrances', coalesce((select jsonb_agg(x->>'name') from jsonb_array_elements(ev.data->'entrances') x where entrance_takes(x, t)), '[]'));
    elsif not has_perm(bo, 'door.override', t.event_id) then raise exception 'You don''t have permission to do that';
    else extra := '{"override":true}'; end if;
  end if;
  if res is null then
    update tickets set checked_in_at = now(), checkin = jsonb_build_object('entrance', coalesce(en->>'name', ''), 'device', dev, 'device_name', coalesce(dv.name, ''), 'by', me_email(), 'manual', manual)
      where id = t.id and checked_in_at is null returning * into t;
    if found then res := 'ok';
      perform emit_event(bo, 'customer.checked_in', jsonb_build_object('ticket_id', t.id, 'event_id', t.event_id, 'order_ref', (select ref from orders where id = t.order_id),
        'email', (select buyer_email from orders where id = t.order_id), 'entrance', coalesce(en->>'name', ''), 'at', t.checked_in_at),
        (select order_ctx(x, array[t.id]) from orders x where x.id = t.order_id) || jsonb_build_object('key', t.id));
    else select * into t from tickets where code = c; res := 'already'; extra := extra || jsonb_build_object('first', coalesce(t.checkin, '{}') || jsonb_build_object('at', t.checked_in_at)); end if;
  end if;
  insert into scan_log(box_office_id, event_id, slot_id, ticket_id, code, result, entrance, device, device_name, by, manual, override)
    values (bo, coalesce(p_event, t.event_id), nullif(p->>'slot', ''), t.id, c, res, coalesce(en->>'name', ''), dev, coalesce(dv.name, ''), me_email(), manual, coalesce((extra->>'override')::boolean, false));
  return extra || jsonb_build_object('result', res, 'ticket', case when t.id is null then null
    when res = 'wrong_event' then (select jsonb_build_object('code', t.code, 'event_id', t.event_id, 'event_name', x.data->>'name', 'event_start', x.data->>'start') from events x where x.id = t.event_id)
    else door_ticket(t, names) end);
end $$;
-- What every scanner polls (every few seconds): tickets changed since p_since (all of them the first time) + the totals.
create or replace function door_sync(p_event uuid, p_since timestamptz default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e events%rowtype; names boolean;
begin
  select * into e from events where id = p_event;
  if not found or not has_perm(e.box_office_id, 'door.scan', e.id) then raise exception 'You don''t have permission to do that'; end if;
  names := has_perm(e.box_office_id, 'customers.names');
  return jsonb_build_object('at', now(),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'event_id', t.event_id, 'order_id', t.order_id, 'ticket_type_id', t.ticket_type_id, 'slot_id', t.slot_id,
        'seat', t.seat, 'area', t.area, 'row', t."row", 'seat_label', t.seat_label, 'unit', t.unit, 'holder', case when names then t.holder else 'Guest' end, 'comp', t.comp,
        'status', t.status, 'checked_in_at', t.checked_in_at, 'checkin', t.checkin))
      from tickets t where t.event_id = e.id and (p_since is null or t.touched_at > p_since - interval '2 seconds') and (p_since is not null or t.status = 'valid' or t.changed_at is not null or t.cancelled_at is not null)), '[]'),
    'stats', (select jsonb_build_object('total', count(*) filter (where status = 'valid'), 'inn', count(*) filter (where status = 'valid' and checked_in_at is not null)) from tickets where event_id = e.id));
end $$;
-- Manual look-up at the door: name, email, phone, order number or ticket number → door info only.
create or replace function door_search(p_event uuid, p_q text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e events%rowtype; q text := lower(left(trim(coalesce(p_q, '')), 80)); dg text; names boolean;
begin
  select * into e from events where id = p_event;
  if not found or not has_perm(e.box_office_id, 'door.search', e.id) then raise exception 'You don''t have permission to do that'; end if;
  if length(q) < 2 then return '[]'; end if;
  dg := regexp_replace(q, '\D', '', 'g'); names := has_perm(e.box_office_id, 'customers.names');
  return coalesce((select jsonb_agg(door_ticket(t, names)) from tickets t where t.id in (select x.id from tickets x join orders o on o.id = x.order_id
    where x.event_id = e.id and x.status = 'valid' and (position(q in lower(coalesce(x.holder, ''))) > 0 or position(q in lower(x.code)) > 0 or position(q in lower(o.ref)) > 0
      or position(q in o.buyer_email) > 0 or position(q in lower(coalesce(o.data->'buyer'->>'name', ''))) > 0
      or (length(dg) >= 4 and position(dg in regexp_replace(coalesce(o.data->'buyer'->>'phone', ''), '\D', '', 'g')) > 0)) limit 50)), '[]');
end $$;
-- Event-day log: every scan, duplicate and invalid attempt.
create or replace function door_log(p_event uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e events%rowtype;
begin
  select * into e from events where id = p_event;
  if not found or not has_perm(e.box_office_id, 'door.log', e.id) then raise exception 'You don''t have permission to do that'; end if;
  return coalesce((select jsonb_agg(to_jsonb(l) order by l.at desc) from (select * from scan_log where event_id = e.id and box_office_id = e.box_office_id order by at desc limit 3000) l), '[]');
end $$;
create or replace function scan_devices_list(p_bo uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not has_perm(p_bo, 'door.devices') then raise exception 'You don''t have permission to do that'; end if;
  return coalesce((select jsonb_agg(to_jsonb(d) order by d.last_seen desc) from scan_devices d where d.box_office_id = p_bo), '[]');
end $$;
-- rename | disable | enable | forget. A switched-off device gets 'device_off' for every scan.
create or replace function scan_device_action(p_bo uuid, p_id text, p_action text, p_name text default '') returns void language plpgsql security definer set search_path = public as $$
declare d scan_devices%rowtype;
begin
  if not has_perm(p_bo, 'door.devices') then raise exception 'You don''t have permission to do that'; end if;
  select * into d from scan_devices where box_office_id = p_bo and id = p_id; if not found then raise exception 'Device not found'; end if;
  if p_action = 'rename' then if trim(coalesce(p_name, '')) = '' then raise exception 'Enter a name'; end if; update scan_devices set name = left(trim(p_name), 60), renamed = true where box_office_id = p_bo and id = p_id;
  elsif p_action in ('disable', 'enable') then update scan_devices set disabled = p_action = 'disable' where box_office_id = p_bo and id = p_id;
  elsif p_action = 'forget' then delete from scan_devices where box_office_id = p_bo and id = p_id;
  else raise exception 'Unknown device action'; end if;
  perform log_action(p_bo, 'door.device', format('Scanner device “%s”: %s', d.name, case p_action when 'rename' then 'renamed' when 'forget' then 'removed' else p_action || 'd' end));
end $$;

-- Everything the back office needs for ONE box office, already filtered to the member's events and masked
-- by their customer-data / finance permissions. Mirrors DB.loadAdmin() in data.js.
create or replace function admin_load(p_bo uuid default null, p_support boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare em text := me_email(); sup boolean := is_super(); b box_offices%rowtype; m members%rowtype; me jsonb; bos jsonb; evs uuid[];
  P_names boolean; P_emails boolean; P_phones boolean; P_money boolean; P_proc boolean; P_fees boolean; seeorders boolean; res jsonb;
begin
  if em = '' then raise exception 'Sign in first'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'slug', x.slug, 'status', x.status) order by x.name), '[]') into bos
    from box_offices x where exists(select 1 from members y where y.box_office_id = x.id and y.email = em and y.status = 'active');
  if p_support and sup then select * into b from box_offices where id = p_bo;
  else select x.* into b from box_offices x join members y on y.box_office_id = x.id and y.email = em and y.status = 'active'
       order by (x.id = p_bo) desc, x.name limit 1; end if;
  if b.id is null then return jsonb_build_object('super', sup, 'bos', bos, 'bo', null, 'me', null); end if;
  if p_support and sup then
    perform log_action(b.id, 'support.access', 'Platform support opened this box office');
    me := jsonb_build_object('email', em, 'name', 'Platform support', 'support', true, 'perms', '[]'::jsonb, 'events', 'all');
  else
    select * into m from members where box_office_id = b.id and email = em and status = 'active';
    me := to_jsonb(m) - 'all_events' - 'event_ids' || jsonb_build_object('owner', b.owner = em, 'events', case when m.all_events then to_jsonb('all'::text) else to_jsonb(m.event_ids) end);
  end if;
  res := jsonb_build_object('super', sup, 'bos', bos, 'me', me, 'bo', to_jsonb(b));
  if b.status <> 'active' and not (p_support and sup) then return res || jsonb_build_object('blocked', b.status); end if;
  if coalesce((b.settings->>'require2fa')::boolean, false) and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' and not (p_support and sup) then
    return res || jsonb_build_object('needs2fa', true, 'events', '[]'::jsonb, 'orders', '[]'::jsonb, 'tickets', '[]'::jsonb, 'waitlist', '[]'::jsonb, 'team', jsonb_build_array(me), 'broadcasts', '[]'::jsonb, 'audit', '[]'::jsonb, 'seatStatus', '[]'::jsonb, 'seatLog', '[]'::jsonb, 'promos', '[]'::jsonb, 'tracking', '[]'::jsonb, 'outbox', '[]'::jsonb,
      'orderLog', '[]'::jsonb, 'credits', '[]'::jsonb, 'custNotes', '[]'::jsonb, 'accounts', '[]'::jsonb, 'live', '{}'::jsonb,
      'contacts', '[]'::jsonb, 'consentLog', '[]'::jsonb, 'automations', '[]'::jsonb, 'integrations', '[]'::jsonb, 'deliveries', '[]'::jsonb, 'apiKeys', '[]'::jsonb); end if;
  select coalesce(array_agg(e.id), '{}') into evs from events e where e.box_office_id = b.id and (has_perm(b.id, 'events.view', e.id) or has_perm(b.id, 'door.scan', e.id));
  P_names := has_perm(b.id, 'customers.names'); P_emails := has_perm(b.id, 'customers.emails'); P_phones := has_perm(b.id, 'customers.phones'); P_money := has_perm(b.id, 'finance.totals');
  P_proc := has_perm(b.id, 'finance.processing'); P_fees := has_perm(b.id, 'finance.fees');
  seeorders := has_perm(b.id, 'orders.view') or P_money or has_perm(b.id, 'finance.reports') or has_perm(b.id, 'comms.lists') or has_perm(b.id, 'customers.profiles');
  return res || jsonb_build_object(
    'events', coalesce((select jsonb_agg(to_jsonb(e)) from events e where e.id = any(evs)), '[]'),
    'orders', case when not seeorders then '[]'::jsonb else coalesce((select jsonb_agg(
        (to_jsonb(o) - 'access_key')
        || jsonb_build_object('payment', case when P_proc then o.payment when o.payment is null then null else jsonb_build_object('provider', o.payment->>'provider') end)
        || jsonb_build_object('buyer_email', case when P_emails then o.buyer_email else regexp_replace(o.buyer_email, '^(.)[^@]*@(.)[^.]*(\..+)$', '\1•••@\2•••\3') end)
        || jsonb_build_object('data', (case when P_money then o.data - case when P_proc then '' else 'processingFee' end - case when P_fees then '' else 'platformFee' end
               else o.data - 'subtotal' - 'ticketsTotal' - 'addonsTotal' - 'discount' - 'feeDiscount' - 'fee' - 'serviceFee' - 'tax' - 'donation' - 'processing' - 'processingFee' - 'refunded' - 'total' - 'faceValue' - 'platformFee'
               || jsonb_build_object('lines', (select coalesce(jsonb_agg((l - 'face' - 'value' - 'tfaces' - 'discs' - 'feeDiscs' - 'disc' - 'feeDisc' - 'fee' - 'unitFee') || '{"unit":null}'::jsonb order by k), '[]')
                  from jsonb_array_elements(o.data->'lines') with ordinality z(l, k))) end)
             || jsonb_build_object('buyer', (o.data->'buyer')
               || case when P_names then '{}'::jsonb else '{"name":"Guest"}'::jsonb end
               || case when P_emails then '{}'::jsonb else jsonb_build_object('email', regexp_replace(o.buyer_email, '^(.)[^@]*@(.)[^.]*(\..+)$', '\1•••@\2•••\3')) end
               || case when P_phones or coalesce(o.data->'buyer'->>'phone','') = '' then '{}'::jsonb else '{"phone":"•••"}'::jsonb end)))
      from orders o where o.box_office_id = b.id and o.event_ids && evs), '[]') end,
    'tickets', coalesce((select jsonb_agg(to_jsonb(t) - 'touched_at' || case when P_names then '{}'::jsonb else '{"holder":"Guest"}'::jsonb end
        || case when P_money then '{}'::jsonb else '{"face":null,"paid":null,"discount":null,"refunded":null}'::jsonb end
        -- door-only staff (scanner): where the guest belongs, not their answers, codes used or purchases
        || case when seeorders or has_perm(b.id, 'door.attendees') then '{}'::jsonb else '{"answers":{},"promo":null,"tracking":null,"bundle":null,"extras":[],"price_override":false}'::jsonb end)
      from tickets t where t.event_id = any(evs)), '[]'),
    'promos', case when has_perm(b.id, 'tickets.discounts') or has_perm(b.id, 'tickets.discountsEdit') or has_perm(b.id, 'finance.reports') then coalesce((select jsonb_agg(x.data
        || jsonb_build_object('id', x.id, 'box_office_id', x.box_office_id, 'code', x.code, 'created_at', x.created_at, 'created_by', x.created_by) order by x.created_at) from promos x where x.box_office_id = b.id), '[]') else '[]' end,
    'tracking', case when has_perm(b.id, 'tickets.tracking') or has_perm(b.id, 'finance.reports') then coalesce((select jsonb_agg(x.data
        || jsonb_build_object('id', x.id, 'box_office_id', x.box_office_id, 'code', x.code, 'created_at', x.created_at) order by x.created_at) from tracking_codes x where x.box_office_id = b.id), '[]') else '[]' end,
    'waitlist', case when has_perm(b.id, 'orders.view') or has_perm(b.id, 'comms.lists') then coalesce((select jsonb_agg(to_jsonb(w)) from waitlist w where w.event_id = any(evs)), '[]') else '[]' end,
    'team', case when has_perm(b.id, 'admin.invite') or has_perm(b.id, 'admin.perms') or has_perm(b.id, 'admin.remove')
      then coalesce((select jsonb_agg(to_jsonb(x) - 'all_events' - 'event_ids' || jsonb_build_object('owner', x.email = b.owner, 'events', case when x.all_events then to_jsonb('all'::text) else to_jsonb(x.event_ids) end))
        from members x where x.box_office_id = b.id and x.status = 'active'), '[]') else jsonb_build_array(me) end,
    'broadcasts', coalesce((select jsonb_agg(to_jsonb(x)) from broadcasts x where x.box_office_id = b.id and (x.event_id is null or x.event_id = any(evs))
      and (has_perm(b.id, 'comms.email') or has_perm(b.id, 'comms.notify') or has_perm(b.id, 'comms.marketing'))), '[]'),
    'audit', coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc) from (select * from audit_log a where a.box_office_id = b.id
        and (has_perm(b.id, 'admin.perms') or a.actor = em or (a.target is not null and has_perm(b.id, 'events.edit', a.target))) order by a.at desc limit 1500) a), '[]'),
    'outbox', case when has_perm(b.id, 'orders.view') or has_perm(b.id, 'comms.email') or has_perm(b.id, 'comms.marketing') or has_perm(b.id, 'comms.lists') then coalesce((select jsonb_agg(to_jsonb(x) - 'locked_until'
        || case when P_emails then '{}'::jsonb else jsonb_build_object('email', mask_email(x.email), 'to', case when x.channel = 'sms' then x."to" else mask_email(x."to") end) end
        || case when P_phones or x.channel <> 'sms' then '{}'::jsonb else '{"to":"•••"}'::jsonb end) from (select * from outbox y where y.box_office_id = b.id order by y.at desc limit 6000) x), '[]') else '[]' end,
    'seatStatus', coalesce((select jsonb_agg(to_jsonb(x) - 'token') from seat_status x where x.event_id = any(evs)
        and not (x.status = 'checkout' and x.expires_at <= now())), '[]'),
    'seatLog', case when has_perm(b.id, 'seating.view') then coalesce((select jsonb_agg(to_jsonb(l) order by l.at desc) from (select * from seat_log l
        where l.event_id = any(evs) order by l.at desc limit 8000) l), '[]') else '[]' end,
    -- Stage 6: every order's change history, credits, notes on customers, who has a customer account, live event activity
    'orderLog', case when has_perm(b.id, 'orders.view') then coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc) from (select * from order_log x where x.box_office_id = b.id and x.event_id = any(evs)
        order by x.at desc limit 5000) x), '[]') else '[]' end,
    'credits', case when has_perm(b.id, 'orders.view') or has_perm(b.id, 'customers.profiles') then coalesce((select jsonb_agg(to_jsonb(c) || credit_state(c)) from credits c where c.box_office_id = b.id), '[]') else '[]' end,
    'custNotes', case when has_perm(b.id, 'customers.profiles') then coalesce((select jsonb_agg(to_jsonb(n) order by n.at desc) from customer_notes n where n.box_office_id = b.id), '[]') else '[]' end,
    'accounts', case when has_perm(b.id, 'customers.profiles') then coalesce((select jsonb_agg(distinct u.email) from auth.users u where u.email_confirmed_at is not null
        and exists(select 1 from orders o where o.box_office_id = b.id and o.buyer_email = lower(u.email))), '[]') else '[]' end,
    'live', coalesce((select jsonb_object_agg(z.event_id, z.j) from (select p.event_id, jsonb_build_object('now', count(*) filter (where p.at > now() - interval '2 minutes'),
        'carts', count(*) filter (where p.at > now() - interval '2 minutes' and p.cart > 0), 'cartTickets', coalesce(sum(p.cart) filter (where p.at > now() - interval '2 minutes'), 0),
        'carted', count(*) filter (where p.carted_at is not null), 'converted', count(*) filter (where p.converted_at is not null),
        'abandoned', count(*) filter (where p.carted_at is not null and p.converted_at is null and p.at < now() - interval '30 minutes')) j
        from event_presence p where p.event_id = any(evs) group by p.event_id) z), '{}'),
    'views', coalesce((select jsonb_object_agg(v.event_id, jsonb_build_object('total', v.total, 'unique', v.uniq, 'today', v.today, 'last10m', v.now10, 'bySrc', v.bysrc, 'byRef', coalesce(v.byref, '{}'))) from (
        select event_id, count(*) total, count(distinct visitor) uniq, count(*) filter (where at >= date_trunc('day', now())) today,
          count(distinct visitor) filter (where at >= now() - interval '10 minutes') now10,
          (select jsonb_object_agg(k, c) from (select coalesce(src,'direct') k, count(*) c from event_views x where x.event_id = ev.event_id group by 1) q) bysrc,
          (select jsonb_object_agg(k, jsonb_build_object('views', c, 'unique', u)) from (select ref k, count(*) c, count(distinct visitor) u from event_views x where x.event_id = ev.event_id and ref is not null group by 1) q) byref
        from event_views ev where event_id = any(evs) group by event_id) v), '{}'))
  -- Stage 8: contacts (consent + tags; the unsubscribe token stays here), consent history, automations, connections (never their secrets), deliveries, API keys (never the hash)
  || jsonb_build_object(
    'contacts', case when has_perm(b.id, 'comms.lists') or has_perm(b.id, 'customers.profiles') or has_perm(b.id, 'comms.marketing') or has_perm(b.id, 'comms.consent') then coalesce((select jsonb_agg(to_jsonb(c) - 'token'
        || case when P_emails then '{}'::jsonb else jsonb_build_object('email', mask_email(c.email)) end || case when P_phones or c.phone is null then '{}'::jsonb else '{"phone":"•••"}'::jsonb end)
      from contacts c where c.box_office_id = b.id), '[]') else '[]' end,
    'consentLog', case when has_perm(b.id, 'comms.lists') or has_perm(b.id, 'customers.profiles') or has_perm(b.id, 'comms.marketing') or has_perm(b.id, 'comms.consent') then coalesce((select jsonb_agg(to_jsonb(x)
        || case when P_emails then '{}'::jsonb else jsonb_build_object('email', mask_email(x.email)) end order by x.at desc) from (select * from consent_log y where y.box_office_id = b.id order by y.at desc limit 3000) x), '[]') else '[]' end,
    'automations', case when has_perm(b.id, 'comms.automations') or has_perm(b.id, 'comms.lists') then coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from automations a where a.box_office_id = b.id), '[]') else '[]' end,
    'integrations', case when has_perm(b.id, 'admin.integrations') or has_perm(b.id, 'comms.automations') then coalesce((select jsonb_agg(to_jsonb(g) - 'secret' || jsonb_build_object('secret_set', g.secret is not null) order by g.created_at)
      from integrations g where g.box_office_id = b.id), '[]') else '[]' end,
    'deliveries', case when has_perm(b.id, 'admin.integrations') then coalesce((select jsonb_agg(to_jsonb(d) - 'locked_until' order by d.created_at desc) from (select * from deliveries y where y.box_office_id = b.id order by y.created_at desc limit 500) d), '[]') else '[]' end,
    'apiKeys', case when has_perm(b.id, 'admin.api') then coalesce((select jsonb_agg(to_jsonb(k) - 'hash' order by k.created_at) from api_keys k where k.box_office_id = b.id), '[]') else '[]' end);
end $$;

create or replace function transfer_ownership(p_bo uuid, p_email text) returns void language plpgsql security definer set search_path = public as $$
declare b box_offices%rowtype;
begin
  select * into b from box_offices where id = p_bo;
  if b.owner <> me_email() and not is_super() then raise exception 'Only the current owner can transfer ownership'; end if;
  if not exists(select 1 from members where box_office_id = p_bo and email = lower(p_email) and status = 'active') then raise exception 'Pick an active team member'; end if;
  perform set_config('set.platform', '1', true);
  update box_offices set owner = lower(p_email) where id = p_bo;
  update members set perms = (select coalesce(array_agg(distinct p), '{}') from members x, unnest(x.perms) p where x.box_office_id = p_bo), all_events = true, template = 'full'
    where box_office_id = p_bo and email = lower(p_email);
  perform log_action(p_bo, 'team.owner', format('Ownership transferred from %s to %s', b.owner, lower(p_email)), jsonb_build_object('owner', b.owner), jsonb_build_object('owner', lower(p_email)));
end $$;

-- ── Platform super admin ─────────────────────────────────────────────────────────
create or replace function platform_overview() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_super() then raise exception 'Platform super admins only'; end if;
  return jsonb_build_object(
    'platform', (select data from platform_settings where id = 1) || jsonb_build_object('admins', (select coalesce(jsonb_agg(email), '[]') from platform_admins)),
    'bos', coalesce((select jsonb_agg(to_jsonb(b) || jsonb_build_object('stats', jsonb_build_object(
        'events', (select count(*) from events e where e.box_office_id = b.id),
        'orders', (select count(*) from orders o where o.box_office_id = b.id and o.status in ('paid','pending')),
        'gross', (select coalesce(sum((o.data->>'total')::bigint), 0) from orders o where o.box_office_id = b.id and o.status in ('paid','pending')),
        'platformFees', (select coalesce(sum((o.data->>'platformFee')::bigint), 0) from orders o where o.box_office_id = b.id and o.status in ('paid','pending')),
        'tickets', (select count(*) from tickets t where t.box_office_id = b.id and t.status = 'valid'),
        'staff', (select count(*) from members m where m.box_office_id = b.id and m.status = 'active'),
        'lastSale', (select max(created_at) from orders o where o.box_office_id = b.id)))) from box_offices b), '[]'),
    'audit', coalesce((select jsonb_agg(to_jsonb(a)) from (select * from audit_log order by at desc limit 600) a), '[]'),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('box_office_id', box_office_id, 'status', status, 'created_at', created_at, 'total', (data->>'total')::bigint, 'platformFee', coalesce((data->>'platformFee')::bigint, 0))) from orders), '[]'));
end $$;

create or replace function platform_save(p jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_super() then raise exception 'Platform super admins only'; end if;
  update platform_settings set data = data || (p - 'admins') where id = 1;
  if p ? 'admins' then
    delete from platform_admins where email not in (select lower(trim(x)) from jsonb_array_elements_text(p->'admins') x) and email <> me_email();
    insert into platform_admins(email) select lower(trim(x)) from jsonb_array_elements_text(p->'admins') x where trim(x) <> '' on conflict do nothing;
  end if;
  perform log_action(null, 'platform.settings', 'Changed platform settings');
end $$;

create or replace function new_box_office(p_name text, p_slug text, p_owner text, p_owner_name text, p_status text, p_by text) returns jsonb language plpgsql security definer set search_path = public as $$
declare s text := lower(regexp_replace(coalesce(nullif(trim(p_slug),''), p_name), '[^a-zA-Z0-9]+', '-', 'g')); b box_offices%rowtype; full_perms text[];
begin
  if coalesce(trim(p_name),'') = '' then raise exception 'Enter the box office name'; end if;
  if coalesce(p_owner,'') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter the owner''s email'; end if;
  s := trim(both '-' from s); if exists(select 1 from box_offices where slug = s) then s := s || '-' || lower(rand_code(3)); end if;
  insert into box_offices(slug, name, status, owner, settings, created_by) values (s, trim(p_name), p_status, lower(trim(p_owner)),
    jsonb_build_object('name', trim(p_name), 'contactEmail', lower(trim(p_owner)), 'currency', 'USD'), p_by) returning * into b;
  perform set_config('set.platform', '1', true);
  insert into members(box_office_id, email, name, perms, template, added_by) values (b.id, b.owner, nullif(p_owner_name,''), '{}', 'full', p_by);
  perform log_action(b.id, case when p_status = 'pending' then 'platform.registered' else 'platform.created' end, case when p_status = 'pending' then 'Registration request: ' else 'Created box office ' end || b.name);
  return to_jsonb(b);
end $$;
create or replace function create_box_office(p_name text, p_slug text, p_owner text, p_owner_name text) returns jsonb language plpgsql security definer set search_path = public as $$
begin if not is_super() then raise exception 'Platform super admins only'; end if; return new_box_office(p_name, p_slug, p_owner, p_owner_name, 'active', me_email()); end $$;
create or replace function register_box_office(p_name text, p_slug text, p_owner text, p_owner_name text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not coalesce((select (data->>'publicRegistration')::boolean from platform_settings where id = 1), false) then raise exception 'Registration is closed'; end if;
  return new_box_office(p_name, p_slug, p_owner, p_owner_name, 'pending', 'self-registration') - 'templates';
end $$;
create or replace function set_box_office_status(p_bo uuid, p_status text) returns void language plpgsql security definer set search_path = public as $$
declare was text; nm text;
begin
  if not is_super() then raise exception 'Platform super admins only'; end if;
  select status, name into was, nm from box_offices where id = p_bo;
  perform set_config('set.platform', '1', true);
  update box_offices set status = p_status where id = p_bo;
  perform log_action(p_bo, 'platform.status', format('%s: %s → %s', nm, was, p_status), jsonb_build_object('status', was), jsonb_build_object('status', p_status));
end $$;
-- Permanent deletion is separate from deactivation and impossible once anything was sold.
create or replace function delete_box_office(p_bo uuid) returns void language plpgsql security definer set search_path = public as $$
declare b box_offices%rowtype;
begin
  if not is_super() then raise exception 'Platform super admins only'; end if;
  select * into b from box_offices where id = p_bo;
  if b.status <> 'deactivated' then raise exception 'Deactivate the box office first'; end if;
  if exists(select 1 from orders where box_office_id = p_bo) then raise exception 'It has order history — it stays deactivated so its records are kept'; end if;
  delete from waitlist where box_office_id = p_bo; delete from broadcasts where box_office_id = p_bo; delete from events where box_office_id = p_bo; delete from box_offices where id = p_bo;
  perform log_action(null, 'platform.deleted', 'Permanently deleted box office ' || b.name);
end $$;

grant execute on function availability(uuid,text), hold_seats(uuid,text,text[],text), release_seats(uuid,text), check_code(uuid[],text), unlock(uuid,text), join_waitlist(uuid,text,text,text),
  get_order(uuid,uuid), lookup_order(text,text), place_order(jsonb), register_box_office(text,text,text,text), cancel_checkout(uuid,uuid),
  event_by_slug(text), track_view(uuid,text,text,text), check_credit(uuid,text), presence_ping(uuid,text,int,boolean) to anon, authenticated;
grant execute on function order_action(uuid,text,jsonb), credit_action(uuid,text,jsonb), customer_note(uuid,text,text), my_credits() to authenticated;
revoke insert, update, delete on orders, tickets, order_log, credits, customer_notes, event_presence from anon, authenticated;
grant execute on function save_event_templates(uuid,jsonb), notify_waitlist(uuid,text), seat_action(uuid,text,text,text[],jsonb), save_venues(uuid,jsonb),
  save_promo(uuid,jsonb), delete_promo(uuid,text), save_tracking(uuid,jsonb), delete_tracking(uuid,text), my_orders(), disconnect_gateway(uuid), set_platform_fee(uuid,jsonb) to authenticated;
grant execute on function checkin(text,boolean,uuid,jsonb), door_sync(uuid,timestamptz), door_search(uuid,text), door_log(uuid), scan_devices_list(uuid), scan_device_action(uuid,text,text,text), admin_load(uuid,boolean), transfer_ownership(uuid,text), platform_overview(), platform_save(jsonb),
  create_box_office(text,text,text,text), set_box_office_status(uuid,text), delete_box_office(uuid) to authenticated;
-- staff-only RPCs: not for anonymous callers (their explicit grant to authenticated above stays)
revoke execute on function checkin(text,boolean,uuid,jsonb), door_sync(uuid,timestamptz), door_search(uuid,text), door_log(uuid), scan_devices_list(uuid), scan_device_action(uuid,text,text,text), admin_load(uuid,boolean), order_action(uuid,text,jsonb), credit_action(uuid,text,jsonb), customer_note(uuid,text,text), my_credits() from anon, public;
revoke execute on function new_box_office(text,text,text,text,text,text), log_action(uuid,text,text,jsonb,jsonb,uuid),
  seat_blocker(uuid,text,text,text,boolean), seat_free(events,text,text,text), single_gaps(events,text,text[],text),
  find_code(uuid,text), promo_usable(jsonb,text,text), tracking_usable(jsonb,uuid,uuid[]), apply_promo(jsonb,jsonb,bigint), price_cart(jsonb,boolean,jsonb,jsonb),
  order_check_tickets(events,jsonb,jsonb,jsonb,int,text[],boolean,text,jsonb), issue_ticket(uuid,uuid,text,jsonb,text,text,bigint,bigint,bigint,text,text,jsonb,jsonb,boolean,text,text,jsonb),
  code_clash(uuid,text[],text), issue_order_tickets(uuid,text), confirm_payment(uuid,jsonb), record_payment_attempt(uuid,jsonb), expire_orders(),
  pricing_settings(box_offices), check_answers(jsonb,uuid[],jsonb,jsonb,jsonb), ticket_answers(orders,text,int), reserved_units(uuid), reserved_units_of(orders),
  order_log_add(orders,text,text,text,text,jsonb,jsonb,jsonb), queue_mail(orders,text,text,text,text), issue_credit(uuid,jsonb,orders,text), refund_plan(orders,jsonb), apply_refund(uuid,jsonb,jsonb,text),
  settle_order_status(uuid), change_order_tickets(uuid,jsonb,text,boolean), cancel_order_tickets(orders,jsonb,text), refresh_extras(uuid,text), finish_refund(uuid,text,jsonb),
  credit_state(credits), credit_problem(credits,uuid[]), door_ticket(tickets,boolean), entrance_takes(jsonb,tickets) from anon, authenticated, public;
-- the payments Edge Function (service role) confirms payments, records failed attempts and expires stale checkouts
grant execute on function confirm_payment(uuid,jsonb), record_payment_attempt(uuid,jsonb), expire_orders(), finish_refund(uuid,text,jsonb) to service_role;
-- pg_cron (enable it in Supabase → Database → Extensions): release unpaid card checkouts every minute
-- select cron.schedule('set-expire-checkouts', '* * * * *', 'select expire_orders()');

-- ══════════════ Stage 8: messages, marketing, automation, integrations, API ══════════════
-- ONE outbox for everything sent (confirmations … campaigns, reminders, automation emails / texts, staff notifications). Rows are queued
-- with send_at; the `messaging` Edge Function claims due rows (claim_outbox, which re-checks consent), renders and sends them, and reports
-- back (outbox_result). Consent + tags are on contacts (one per box office + email), every change in consent_log. emit_event() is the one
-- place outside systems hear about things (deliveries → webhooks / CRMs) and runs matching automations. Mirrors the Stage 8 block in data.js.
alter table outbox add column if not exists event_id uuid, add column if not exists channel text not null default 'email', add column if not exists category text not null default 'transactional',
  add column if not exists email text, add column if not exists send_at timestamptz not null default now(), add column if not exists attempts int not null default 0, add column if not exists error text,
  add column if not exists provider text, add column if not exists provider_id text, add column if not exists sent_at timestamptz, add column if not exists campaign_id uuid,
  add column if not exists automation_id text, add column if not exists dedupe text, add column if not exists require_valid boolean not null default false,
  add column if not exists vars jsonb not null default '{}', add column if not exists locked_until timestamptz;
update outbox set email = lower("to") where email is null and channel = 'email';
alter table outbox drop constraint if exists outbox_channel_check; alter table outbox add constraint outbox_channel_check check (channel in ('email','sms'));
alter table outbox drop constraint if exists outbox_category_check; alter table outbox add constraint outbox_category_check check (category in ('transactional','marketing','staff'));
create unique index if not exists outbox_dedupe on outbox(dedupe) where dedupe is not null;
create index if not exists outbox_due on outbox(send_at) where status = 'queued';
create index if not exists outbox_bo on outbox(box_office_id, at desc);
create index if not exists outbox_provider on outbox(provider_id) where provider_id is not null;
-- campaigns (and event updates / waitlist notices) are broadcasts rows; their messages are outbox rows with campaign_id
alter table broadcasts add column if not exists kind text not null default 'update', add column if not exists name text, add column if not exists channel text not null default 'email',
  add column if not exists category text not null default 'transactional', add column if not exists filter jsonb not null default '{}', add column if not exists send_at timestamptz default now(),
  add column if not exists status text not null default 'sent', add column if not exists queued int not null default 0, add column if not exists skipped jsonb not null default '{}',
  add column if not exists cancelled_by text, add column if not exists cancelled_at timestamptz;
alter table box_offices add column if not exists segments jsonb not null default '[]';
create table if not exists contacts (id uuid primary key default gen_random_uuid(), box_office_id uuid not null references box_offices(id) on delete cascade, email text not null, name text, phone text,
  email_optin boolean not null default false, email_optin_at timestamptz, email_optin_src text, sms_optin boolean not null default false, sms_optin_at timestamptz, sms_optin_src text,
  unsub_email_at timestamptz, unsub_sms_at timestamptz, suppressed text check (suppressed in ('bounced','complaint','manual')), suppressed_at timestamptz, tags text[] not null default '{}',
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (box_office_id, email));
create index if not exists contacts_phone on contacts(phone) where phone is not null;
create table if not exists consent_log (id bigint generated always as identity primary key, box_office_id uuid not null references box_offices(id) on delete cascade, email text not null,
  action text not null, source text, by text, at timestamptz not null default now());
create index if not exists consent_log_bo on consent_log(box_office_id, at desc);
create table if not exists automations (id text primary key, box_office_id uuid not null references box_offices(id) on delete cascade, std text not null default '', kind text not null default 'automation',
  name text not null, enabled boolean not null default true, trigger jsonb not null, cond jsonb not null default '{}', timing jsonb not null default '{}', actions jsonb not null default '[]', promo text,
  runs int not null default 0, last_run timestamptz, created_at timestamptz not null default now(), created_by text, updated_at timestamptz);
create table if not exists automation_runs (automation_id text not null, key text not null, at timestamptz not null default now(), primary key (automation_id, key));
create table if not exists integrations (id uuid primary key default gen_random_uuid(), box_office_id uuid not null references box_offices(id) on delete cascade, kind text not null, name text not null,
  active boolean not null default true, config jsonb not null default '{}', secret text, secret_hint text, created_at timestamptz not null default now(), created_by text, last_at timestamptz, last_error text);
create table if not exists deliveries (id uuid primary key default gen_random_uuid(), box_office_id uuid not null references box_offices(id) on delete cascade,
  integration_id uuid references integrations(id) on delete cascade, kind text not null, event text not null, event_id text not null, payload jsonb not null, status text not null default 'queued',
  attempts int not null default 0, next_at timestamptz not null default now(), locked_until timestamptz, created_at timestamptz not null default now(), done_at timestamptz, response text);
create index if not exists deliveries_due on deliveries(next_at) where status = 'queued';
create index if not exists deliveries_bo on deliveries(box_office_id, created_at desc);
create table if not exists api_keys (id uuid primary key default gen_random_uuid(), box_office_id uuid not null references box_offices(id) on delete cascade, name text not null, prefix text not null,
  hash text not null unique, scopes text[] not null, created_at timestamptz not null default now(), created_by text, last_used_at timestamptz, revoked_at timestamptz, revoked_by text);
create table if not exists api_usage (key_id uuid not null references api_keys(id) on delete cascade, minute timestamptz not null, n int not null default 0, primary key (key_id, minute));
-- read only through admin_load() (masked by permission) and the RPCs below; nobody selects these tables directly
alter table contacts enable row level security; alter table consent_log enable row level security; alter table automations enable row level security;
alter table automation_runs enable row level security; alter table integrations enable row level security; alter table deliveries enable row level security;
alter table api_keys enable row level security; alter table api_usage enable row level security;
revoke all on contacts, consent_log, automations, automation_runs, integrations, deliveries, api_keys, api_usage from anon, authenticated;
revoke insert, update, delete on outbox, broadcasts from anon, authenticated;
drop policy if exists broadcasts_insert on broadcasts;

create or replace function norm_phone(p text) returns text language sql immutable as $$
  select case when length(d) < 7 then null when s like '+%' then '+' || d when length(d) = 10 then '+1' || d when length(d) = 11 and left(d, 1) = '1' then '+' || d else '+' || d end
  from (select trim(coalesce(p, '')) s, regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x $$;
create or replace function mask_email(e text) returns text language sql immutable as $$ select regexp_replace(coalesce(e, ''), '^(.)[^@]*@(.)[^.]*(\..+)$', '\1•••@\2•••\3') $$;
-- only https URLs on public hosts (no localhost / private IP literals); the Edge Function re-checks the resolved address before posting
create or replace function safe_url(u text) returns text language plpgsql immutable as $$
declare h text;
begin
  u := trim(coalesce(u, ''));
  if u !~* '^https://[^/?#@\s]+([/?#]\S*)?$' then return null; end if;
  h := lower(regexp_replace(substring(u from '^https://([^/?#]+)'), ':\d+$', ''));
  h := trim(both '[]' from h);
  if h = 'localhost' or h like '%.localhost' or h like '%.local' or h like '%.internal' or (position('.' in h) = 0 and position(':' in h) = 0) then return null; end if;
  if h ~ '^(0|10|127)\.' or h ~ '^169\.254\.' or h ~ '^192\.168\.' or h ~ '^172\.(1[6-9]|2\d|3[01])\.' or h ~ '^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.' or h ~ '^\d+$'
     or (position(':' in h) > 0 and h ~ '^(::1?|f[cd]|fe80)') then return null; end if;
  return u;
end $$;

create or replace function contact_upsert(p_bo uuid, p_email text, p_name text default '', p_phone text default '') returns contacts language plpgsql security definer set search_path = public as $$
declare c contacts%rowtype; em text := lower(trim(coalesce(p_email, '')));
begin
  if em !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return null; end if;
  insert into contacts(box_office_id, email, name, phone) values (p_bo, em, left(nullif(trim(coalesce(p_name, '')), ''), 120), norm_phone(p_phone))
    on conflict (box_office_id, email) do update set name = coalesce(left(nullif(trim(coalesce(p_name, '')), ''), 120), contacts.name),
      phone = coalesce(norm_phone(p_phone), contacts.phone), updated_at = now()
    returning * into c;
  return c;
end $$;
-- optin | optout (email marketing) · sms_optin | sms_optout (STOP: no texts at all) | sms_start · suppress | unsuppress (all email)
create or replace function consent_change(p_id uuid, p_action text, p_source text, p_by text, p_extra text default '') returns boolean language plpgsql security definer set search_path = public as $$
declare c contacts%rowtype;
begin
  select * into c from contacts where id = p_id for update;
  if p_action = 'optin' then update contacts set email_optin = true, email_optin_at = now(), email_optin_src = left(p_source, 160), unsub_email_at = null, updated_at = now() where id = p_id;
  elsif p_action = 'optout' then if not c.email_optin and c.unsub_email_at is not null then return false; end if; update contacts set email_optin = false, unsub_email_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'sms_optin' then if c.phone is null then raise exception 'No mobile number on file'; end if;
    update contacts set sms_optin = true, sms_optin_at = now(), sms_optin_src = left(p_source, 160), unsub_sms_at = null, updated_at = now() where id = p_id;
  elsif p_action = 'sms_optout' then if c.unsub_sms_at is not null then return false; end if; update contacts set sms_optin = false, unsub_sms_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'sms_start' then if c.unsub_sms_at is null then return false; end if; update contacts set unsub_sms_at = null, updated_at = now() where id = p_id;
  elsif p_action = 'suppress' then update contacts set suppressed = case when p_extra in ('bounced','complaint') then p_extra else 'manual' end, suppressed_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'unsuppress' then if c.suppressed is null then return false; end if; update contacts set suppressed = null, suppressed_at = null, updated_at = now() where id = p_id;
  else raise exception 'Unknown consent change'; end if;
  insert into consent_log(box_office_id, email, action, source, by) values (c.box_office_id, c.email,
    case when p_action = 'suppress' then 'suppress:' || case when p_extra in ('bounced','complaint') then p_extra else 'manual' end else p_action end, left(coalesce(p_source, ''), 160), coalesce(nullif(p_by, ''), 'system'));
  return true;
end $$;
-- an order's buyer → their contact + the consent they gave at checkout
create or replace function order_contact(p_order uuid) returns void language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; c contacts%rowtype; src text;
begin
  select * into o from orders where id = p_order;
  c := contact_upsert(o.box_office_id, o.buyer_email, o.data->'buyer'->>'name', o.data->'buyer'->>'phone'); if c.id is null then return; end if;
  src := 'checkout · order ' || o.ref;
  if coalesce((o.data->>'optIn')::boolean, false) and not c.email_optin then perform consent_change(c.id, 'optin', src, o.buyer_email); end if;
  if coalesce((o.data->>'smsOptIn')::boolean, false) and c.phone is not null and not c.sms_optin then perform consent_change(c.id, 'sms_optin', src, o.buyer_email); end if;
end $$;
-- may this message go to this person? '' = yes, otherwise why it is held back (mirrors sendGate)
create or replace function send_gate(c contacts, p_channel text, p_category text, p_to text) returns text language sql stable as $$
  select case when p_category = 'staff' then ''
    when p_channel = 'sms' then case when coalesce(p_to, '') = '' then 'no mobile number' when c.unsub_sms_at is not null then 'replied STOP to texts'
      when p_category = 'marketing' and not coalesce(c.sms_optin, false) then 'not opted in to marketing texts' else '' end
    when c.suppressed is not null then 'address suppressed (' || c.suppressed || ')'
    when p_category = 'marketing' and not (coalesce(c.email_optin, false) and c.unsub_email_at is null) then case when c.unsub_email_at is not null then 'unsubscribed from marketing' else 'not opted in to marketing email' end
    else '' end $$;
create or replace function queue_msg(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare mid uuid; ch text := coalesce(nullif(p->>'channel', ''), 'email'); k text := coalesce(nullif(p->>'kind', ''), 'message'); t text;
begin
  t := case when ch = 'sms' then norm_phone(p->>'to') else lower(trim(coalesce(p->>'to', p->>'email', ''))) end;
  insert into outbox(box_office_id, order_id, event_id, kind, channel, category, "to", email, subject, body, by, send_at, campaign_id, automation_id, dedupe, require_valid, vars)
  values ((p->>'box_office_id')::uuid, nullif(p->>'order_id', '')::uuid, nullif(p->>'event_id', '')::uuid, k, ch,
    coalesce(nullif(p->>'category', ''), case when k = 'campaign' then 'marketing' when k = 'staff' then 'staff' else 'transactional' end), coalesce(t, ''),
    lower(coalesce(nullif(p->>'email', ''), case when ch = 'email' then t end, '')), left(coalesce(p->>'subject', ''), 200), left(coalesce(p->>'body', ''), 5000), coalesce(p->>'by', 'system'),
    coalesce(nullif(p->>'send_at', '')::timestamptz, now()), nullif(p->>'campaign_id', '')::uuid, nullif(p->>'automation_id', ''), nullif(p->>'dedupe', ''), coalesce((p->>'require_valid')::boolean, false), coalesce(p->'vars', '{}'))
  on conflict do nothing returning id into mid;
  return mid;
end $$;
create or replace function queue_mail(o orders, p_kind text, p_subject text, p_body text, p_by text) returns uuid language sql security definer set search_path = public as $$
  select queue_msg(jsonb_build_object('box_office_id', o.box_office_id, 'order_id', o.id, 'event_id', o.event_ids[1], 'kind', p_kind, 'to', o.buyer_email, 'email', o.buyer_email,
    'subject', p_subject, 'body', p_body, 'by', p_by)) $$;

/* ── events out ── */
create or replace function hook_order(o orders) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'ref', o.ref, 'status', o.status, 'email', o.buyer_email, 'name', coalesce(o.data->'buyer'->>'name', ''), 'phone', coalesce(o.data->'buyer'->>'phone', ''),
    'total', o.data->'total', 'currency', coalesce(o.data->>'currency', 'USD'), 'promo', o.data->>'code', 'tracking', o.data->>'tracking', 'utm', o.data->'utm', 'created_at', o.created_at, 'paid_at', o.paid_at,
    'event_ids', to_jsonb(o.event_ids), 'tickets', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'code_last4', right(t.code, 4), 'event_id', t.event_id, 'ticket_type_id', t.ticket_type_id,
      'area', t.area, 'row', t."row", 'seat', t.seat_label, 'status', t.status, 'face', t.face, 'paid', t.paid)) from tickets t where t.order_id = o.id), '[]')) $$;
create or replace function order_ctx(o orders, p_tickets uuid[] default null) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('email', o.buyer_email, 'name', coalesce(o.data->'buyer'->>'name', ''), 'phone', coalesce(o.data->'buyer'->>'phone', ''), 'order_id', o.id, 'ref', o.ref,
    'promo', coalesce(o.data->>'code', ''), 'key', o.id::text, 'eventIds', to_jsonb(o.event_ids),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('event_id', t.event_id, 'slot_id', coalesce(t.slot_id, ''), 'ticket_type_id', t.ticket_type_id, 'area', coalesce(t.area, ''), 'face', t.face,
      'checked_in_at', t.checked_in_at)) from tickets t where t.order_id = o.id and (case when p_tickets is null then t.status = 'valid' else t.id = any(p_tickets) end)), '[]')) $$;
create or replace function ev_start(e events, p_slot text) returns timestamptz language sql stable as $$
  select coalesce((select (s->>'start')::timestamptz from jsonb_array_elements(coalesce(e.data->'timeSlots', '[]')) s where s->>'id' = p_slot), (e.data->>'start')::timestamptz) $$;
create or replace function ev_end(e events, p_slot text) returns timestamptz language sql stable as $$
  select coalesce((select coalesce(nullif(s->>'end', ''), s->>'start')::timestamptz from jsonb_array_elements(coalesce(e.data->'timeSlots', '[]')) s where s->>'id' = p_slot),
    nullif(e.data->>'end', '')::timestamptz, ev_start(e, p_slot) + interval '3 hours') $$;
-- matching tickets (null = conditions not met): events, ticket types, seating areas, price levels, quantity, promo code, customer tags (mirrors autoMatch)
create or replace function auto_match(a automations, ctx jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c jsonb := a.cond; tks jsonb; tkcond boolean;
begin
  tkcond := jsonb_array_length(coalesce(c->'ticketTypeIds', '[]')) > 0 or jsonb_array_length(coalesce(c->'areas', '[]')) > 0 or jsonb_array_length(coalesce(c->'prices', '[]')) > 0 or coalesce((c->>'minQty')::int, 0) > 0;
  if coalesce(c->>'promo', '') <> '' and upper(coalesce(ctx->>'promo', '')) <> upper(c->>'promo') then return null; end if;
  if jsonb_array_length(coalesce(c->'tags', '[]')) > 0 and not exists(select 1 from contacts k where k.box_office_id = a.box_office_id and k.email = ctx->>'email'
     and k.tags @> array(select jsonb_array_elements_text(c->'tags'))) then return null; end if;
  if jsonb_array_length(coalesce(ctx->'tickets', '[]')) = 0 then
    if tkcond or (jsonb_array_length(coalesce(c->'eventIds', '[]')) > 0 and not exists(select 1 from jsonb_array_elements_text(coalesce(ctx->'eventIds', '[]')) e where c->'eventIds' ? e)) then return null; end if;
    return '[]';
  end if;
  select coalesce(jsonb_agg(t), '[]') into tks from jsonb_array_elements(ctx->'tickets') t
    where (jsonb_array_length(coalesce(c->'eventIds', '[]')) = 0 or c->'eventIds' ? (t->>'event_id')) and (jsonb_array_length(coalesce(c->'ticketTypeIds', '[]')) = 0 or c->'ticketTypeIds' ? (t->>'ticket_type_id'))
      and (jsonb_array_length(coalesce(c->'areas', '[]')) = 0 or c->'areas' ? (t->>'area')) and (jsonb_array_length(coalesce(c->'prices', '[]')) = 0 or c->'prices' @> jsonb_build_array((t->>'face')::bigint));
  if jsonb_array_length(tks) = 0 or jsonb_array_length(tks) < greatest(1, coalesce((c->>'minQty')::int, 0)) then return null; end if;
  return tks;
end $$;
create or replace function run_automation(p_auto text, ctx jsonb, p_key text) returns int language plpgsql security definer set search_path = public as $$
declare a automations%rowtype; tks jsonb; ev events%rowtype; evid uuid; slot text; send timestamptz; tb boolean; c contacts%rowtype; x jsonb; i int := 0; ig integrations%rowtype; tagv text;
begin
  select * into a from automations where id = p_auto; tks := auto_match(a, ctx); if tks is null then return 0; end if;
  insert into automation_runs(automation_id, key) values (a.id, p_key) on conflict do nothing; if not found then return 0; end if;
  evid := coalesce(nullif(tks->0->>'event_id', ''), nullif(ctx->>'eventId', ''), nullif(ctx->'eventIds'->>0, ''))::uuid; slot := coalesce(tks->0->>'slot_id', '');
  if evid is not null then select * into ev from events where id = evid; end if;
  send := case when a.timing->>'mode' = 'before' and ev.id is not null then greatest(now(), ev_start(ev, slot) - make_interval(hours => coalesce((a.timing->>'hours')::int, 0)))
    when a.timing->>'mode' = 'after' and ev.id is not null then greatest(now(), ev_end(ev, slot) + make_interval(hours => coalesce((a.timing->>'hours')::int, 0)))
    when a.timing->>'mode' = 'delay' then now() + make_interval(hours => coalesce((a.timing->>'hours')::int, 0)) else now() end;
  tb := a.trigger->>'type' in ('ticket.purchased', 'promo.used', 'event.approaching', 'event.ended', 'checked_in');
  c := contact_upsert(a.box_office_id, ctx->>'email', ctx->>'name', ctx->>'phone');
  for x in select v from jsonb_array_elements(a.actions) v loop
    if x->>'type' in ('email', 'sms', 'staff') then
      perform queue_msg(jsonb_build_object('box_office_id', a.box_office_id, 'order_id', ctx->>'order_id', 'event_id', evid, 'automation_id', a.id, 'by', 'automation: ' || a.name, 'send_at', send,
        'require_valid', tb and x->>'type' <> 'staff' and ctx->>'order_id' is not null, 'dedupe', format('auto:%s:%s:%s:%s', a.id, p_key, x->>'type', i), 'kind', case when x->>'type' = 'staff' then 'staff' else a.kind end,
        'vars', jsonb_build_object('promo_code', coalesce(a.promo, ''), 'link', coalesce(x->>'link', ''))) ||
        case x->>'type' when 'email' then jsonb_build_object('channel', 'email', 'category', coalesce(x->>'category', 'transactional'), 'to', ctx->>'email', 'email', ctx->>'email', 'subject', x->>'subject', 'body', x->>'body')
          when 'sms' then jsonb_build_object('channel', 'sms', 'category', coalesce(x->>'category', 'transactional'), 'to', coalesce(c.phone, ctx->>'phone'), 'email', ctx->>'email', 'body', x->>'body')
          else jsonb_build_object('channel', 'email', 'category', 'staff', 'to', x->>'to', 'email', x->>'to', 'subject', coalesce(nullif(x->>'subject', ''), 'Automation “' || a.name || '”'),
            'body', concat_ws(E'\n\n', nullif(x->>'body', ''), format('%s <%s>%s%s', ctx->>'name', ctx->>'email', case when ctx->>'ref' is not null then ' · order ' || (ctx->>'ref') else '' end,
              case when ev.id is not null then ' · ' || (ev.data->>'name') else '' end))) end);
    elsif x->>'type' in ('tag', 'untag') and c.id is not null then
      tagv := replace(replace(x->>'tag', '{{event}}', coalesce(ev.data->>'name', '')), '{{ event }}', coalesce(ev.data->>'name', ''));
      update contacts set tags = case when x->>'type' = 'tag' then array(select distinct unnest(tags || array[left(trim(tagv), 40)])) else array_remove(tags, left(trim(tagv), 40)) end, updated_at = now() where id = c.id;
    elsif x->>'type' in ('webhook', 'crm') then
      select * into ig from integrations where id = nullif(x->>'integrationId', '')::uuid and box_office_id = a.box_office_id and active;
      if found then insert into deliveries(box_office_id, integration_id, kind, event, event_id, payload) values (a.box_office_id, ig.id, ig.kind, 'automation', 'evt_' || lower(rand_code(14)),
        jsonb_build_object('type', 'automation', 'automation', a.name, 'trigger', a.trigger->>'type', 'created', now(), 'data', jsonb_build_object('email', ctx->>'email', 'name', ctx->>'name', 'phone', coalesce(ctx->>'phone', ''),
          'order_ref', ctx->>'ref', 'event_id', evid, 'tags', (select to_jsonb(tags) from contacts where id = c.id)))); end if;
    end if;
    i := i + 1;
  end loop;
  update automations set runs = runs + 1, last_run = now() where id = a.id;
  return 1;
end $$;
-- webhooks / CRM syncs / Meta Conversions API for this event, then the automations it triggers (mirrors emitEvent)
create or replace function emit_event(p_bo uuid, p_type text, p_data jsonb, p_ctx jsonb default null) returns void language plpgsql security definer set search_path = public as $$
declare eid text := 'evt_' || lower(rand_code(14)); a automations%rowtype; trig text;
begin
  insert into deliveries(box_office_id, integration_id, kind, event, event_id, payload)
    select p_bo, g.id, g.kind, p_type, eid, jsonb_build_object('id', eid, 'type', p_type, 'created', now(), 'data', p_data) from integrations g
    where g.box_office_id = p_bo and g.active and case when g.kind = 'webhook' then coalesce(g.config->'events', '[]') ? p_type
      when g.kind in ('mailchimp', 'hubspot', 'activecampaign', 'constantcontact') then p_type in ('payment.completed', 'waitlist.signup') when g.kind = 'meta_capi' then p_type = 'payment.completed' else false end;
  if p_ctx is null then return; end if;
  for trig in select unnest(case p_type when 'payment.completed' then array['ticket.purchased', 'promo.used'] when 'ticket.cancelled' then array['ticket.cancelled'] when 'refund.issued' then array['refund.issued']
      when 'waitlist.signup' then array['waitlist.joined'] when 'customer.checked_in' then array['checked_in'] when 'cart.expired' then array['cart.abandoned'] else array[]::text[] end) loop
    if trig = 'promo.used' and coalesce(p_ctx->>'promo', '') = '' then continue; end if;
    for a in select * from automations where box_office_id = p_bo and enabled and trigger->>'type' = trig loop
      perform run_automation(a.id, p_ctx, p_type || ':' || coalesce(p_ctx->>'key', eid));
    end loop;
  end loop;
end $$;
-- every minute (pg_cron): the event's own reminders + automations for events approaching / ended / no-shows (mirrors marketingTick)
create or replace function marketing_tick() returns int language plpgsql security definer set search_path = public as $$
declare ev events%rowtype; r record; a automations%rowtype; rem jsonb; i int; n int := 0; st timestamptz; en timestamptz; fire timestamptz; ch text; ctx jsonb; o orders%rowtype;
begin
  for ev in select * from events e where e.status = 'published' and not coalesce((e.data->>'archived')::boolean, false)
      and (jsonb_array_length(coalesce(e.data->'emails'->'reminders', '[]')) > 0 or exists(select 1 from automations x where x.box_office_id = e.box_office_id and x.enabled
        and x.trigger->>'type' in ('event.approaching', 'event.ended', 'no_show'))) loop
    for r in select t.order_id, coalesce(t.slot_id, '') slot, array_agg(t.id) ids, bool_or(t.checked_in_at is not null) came from tickets t where t.event_id = ev.id and t.status = 'valid' group by 1, 2 loop
      select * into o from orders where id = r.order_id; st := ev_start(ev, r.slot); en := ev_end(ev, r.slot); i := 0;
      for rem in select v from jsonb_array_elements(coalesce(ev.data->'emails'->'reminders', '[]')) v loop
        if now() >= st - make_interval(hours => coalesce((rem->>'hoursBefore')::int, 0)) and now() < st then
          foreach ch in array case when rem->>'channel' = 'email' then array['email'] when rem->>'channel' = 'both' then array['email', 'sms'] else array['sms'] end loop
            if queue_msg(jsonb_build_object('box_office_id', o.box_office_id, 'order_id', o.id, 'event_id', ev.id, 'kind', 'reminder', 'channel', ch, 'to', case when ch = 'email' then o.buyer_email else o.data->'buyer'->>'phone' end,
                'email', o.buyer_email, 'subject', 'Reminder: {{event}} — {{date}}', 'body', coalesce(rem->>'body', ''), 'require_valid', true, 'dedupe', format('rem:%s:%s:%s:%s:%s', ev.id, r.slot, i, o.id, ch))) is not null then n := n + 1; end if;
          end loop;
        end if;
        i := i + 1;
      end loop;
      for a in select * from automations x where x.box_office_id = ev.box_office_id and x.enabled and x.trigger->>'type' in ('event.approaching', 'event.ended', 'no_show') loop
        if a.std = 'pre' and jsonb_array_length(coalesce(ev.data->'emails'->'reminders', '[]')) > 0 then continue; end if;
        fire := case when a.trigger->>'type' = 'event.approaching' then st - make_interval(hours => coalesce((a.trigger->>'hours')::int, 0)) else en + make_interval(hours => coalesce((a.trigger->>'hours')::int, 0)) end;
        if now() < fire or (case when a.trigger->>'type' = 'event.approaching' then now() >= st else now() >= fire + interval '2 days' end) then continue; end if;
        if a.trigger->>'type' = 'no_show' and r.came then continue; end if;
        ctx := order_ctx(o, r.ids) || jsonb_build_object('eventId', ev.id);
        n := n + run_automation(a.id, ctx, format('%s:%s:%s:%s', a.trigger->>'type', ev.id, r.slot, o.id));
      end loop;
    end loop;
  end loop;
  return n;
end $$;

/* ── segments (mirrors segmentPeople) ── */
create or replace function segment_people(p_bo uuid, f jsonb) returns table(email text, name text, phone text) language plpgsql stable security definer set search_path = public as $$
declare evs text[] := array(select jsonb_array_elements_text(coalesce(f->'eventIds', '[]'))); tts text[] := array(select jsonb_array_elements_text(coalesce(f->'ticketTypeIds', '[]')));
  ars text[] := array(select jsonb_array_elements_text(coalesce(f->'areas', '[]'))); tg text[] := array(select jsonb_array_elements_text(coalesce(f->'tags', '[]')));
  ck text := coalesce(nullif(f->>'checkin', ''), 'any'); sts text := coalesce(nullif(f->>'status', ''), 'any'); fr timestamptz := nullif(f->>'from', '')::timestamptz;
  til timestamptz := case when nullif(f->>'to', '') is null then null when length(f->>'to') <= 10 then (f->>'to')::date + interval '1 day' - interval '1 second' else (f->>'to')::timestamptz end;
  pr text := upper(nullif(f->>'promo', '')); trk text := upper(nullif(f->>'tracking', ''));
  tkf boolean := cardinality(evs) > 0 or cardinality(tts) > 0 or cardinality(ars) > 0 or ck <> 'any'; orf boolean := fr is not null or til is not null or pr is not null or trk is not null;
begin
  return query
  with ords as (select o.* from orders o where o.box_office_id = p_bo and o.status not in ('expired', 'awaiting_payment')),
    okord as (select o.id, o.buyer_email from ords o where (fr is null or o.created_at >= fr) and (til is null or o.created_at <= til)
      and (pr is null or upper(coalesce(o.data->>'code', '')) = pr) and (trk is null or upper(coalesce(o.data->>'tracking', '')) = trk)),
    oktk as (select distinct k.buyer_email em from okord k join tickets t on t.order_id = k.id where t.status = 'valid' and (cardinality(evs) = 0 or t.event_id::text = any(evs))
      and (cardinality(tts) = 0 or t.ticket_type_id = any(tts)) and (cardinality(ars) = 0 or t.area = any(ars)) and (ck = 'any' or (ck = 'in') = (t.checked_in_at is not null))),
    people as (select lower(o.buyer_email) em from ords o union select lower(w.email) from waitlist w where w.box_office_id = p_bo union select c.email from contacts c where c.box_office_id = p_bo),
    info as (select p.em, k.id cid, k.email_optin, k.unsub_email_at, k.suppressed, k.sms_optin, k.unsub_sms_at, k.tags,
      coalesce(k.name, (select o.data->'buyer'->>'name' from ords o where o.buyer_email = p.em order by o.created_at desc limit 1), (select w.name from waitlist w where w.box_office_id = p_bo and w.email = p.em limit 1)) nm,
      coalesce(k.phone, (select norm_phone(o.data->'buyer'->>'phone') from ords o where o.buyer_email = p.em and norm_phone(o.data->'buyer'->>'phone') is not null order by o.created_at desc limit 1)) ph,
      exists(select 1 from ords o where o.buyer_email = p.em) has_orders, exists(select 1 from waitlist w where w.box_office_id = p_bo and w.email = p.em) on_wl
      from people p left join contacts k on k.box_office_id = p_bo and k.email = p.em)
  select i.em, i.nm::text, i.ph::text from info i
  where case when sts = 'waitlist' then exists(select 1 from waitlist w where w.box_office_id = p_bo and w.email = i.em and (cardinality(evs) = 0 or w.event_id::text = any(evs)))
      else (not tkf or i.em in (select em from oktk)) and (tkf or not orf or i.em in (select buyer_email from okord)) and (sts <> 'buyers' or i.has_orders) end
    and (sts <> 'optedIn' or (coalesce(i.email_optin, false) and i.unsub_email_at is null and i.suppressed is null))
    and (sts <> 'smsOptIn' or (coalesce(i.sms_optin, false) and i.unsub_sms_at is null and i.ph is not null))
    and (sts <> 'account' or exists(select 1 from auth.users u where lower(u.email) = i.em and u.email_confirmed_at is not null))
    and (sts <> 'refunded' or exists(select 1 from ords o where o.buyer_email = i.em and coalesce((o.data->>'refunded')::bigint, 0) + coalesce((o.data->>'credited')::bigint, 0) > 0))
    and (sts <> 'credit' or exists(select 1 from credits c where c.box_office_id = p_bo and c.email = i.em and (credit_state(c)->>'status') = 'active'))
    and (sts <> 'unsubscribed' or i.unsub_email_at is not null or i.suppressed is not null or i.unsub_sms_at is not null)
    and (cardinality(tg) = 0 or coalesce(i.tags, '{}') @> tg)
    and (not (tkf or orf) or i.has_orders or i.on_wl);
end $$;
create or replace function segment_count(p_bo uuid, f jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not has_perm(p_bo, 'comms.lists') then raise exception 'You don''t have permission to do that'; end if;
  return (select jsonb_build_object('count', count(*), 'phones', count(*) filter (where s.phone is not null),
    'email', count(*) filter (where send_gate(k, 'email', 'marketing', s.email) = ''), 'sms', count(*) filter (where send_gate(k, 'sms', 'marketing', s.phone) = ''))
    from segment_people(p_bo, f) s left join contacts k on k.box_office_id = p_bo and k.email = s.email);
end $$;
create or replace function save_segments(p_bo uuid, p jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_perm(p_bo, 'comms.lists') then raise exception 'You don''t have permission to do that'; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 100 then raise exception 'Too many segments'; end if;
  update box_offices set segments = p where id = p_bo; perform log_action(p_bo, 'comms.segments', 'Saved audience segments');
end $$;

/* ── campaigns ── */
create or replace function send_campaign(p_bo uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare f jsonb := coalesce(p->'filter', '{}'); cat text := case when p->>'category' = 'transactional' then 'transactional' else 'marketing' end;
  ch text := case when p->>'channel' in ('email', 'sms', 'both') then p->>'channel' else 'email' end; chans text[]; evs uuid[]; e uuid; subj text := trim(coalesce(p->>'subject', ''));
  body text := trim(coalesce(p->>'body', '')); at_ timestamptz := coalesce(nullif(p->>'sendAt', '')::timestamptz, now()); b broadcasts%rowtype; s record; k contacts%rowtype; c text; why text;
  q int := 0; sk jsonb := '{}'; n int := 0;
begin
  chans := case when ch = 'both' then array['email', 'sms'] else array[ch] end;
  evs := array(select x::uuid from jsonb_array_elements_text(coalesce(f->'eventIds', '[]')) x where exists(select 1 from events v where v.id = x::uuid and v.box_office_id = p_bo));
  f := f || jsonb_build_object('eventIds', to_jsonb(evs));
  if cat = 'transactional' then
    if cardinality(evs) = 0 then raise exception 'An event update goes to the ticket holders of an event — choose the event'; end if;
    foreach e in array evs loop if not (has_perm(p_bo, 'comms.email', e) or has_perm(p_bo, 'comms.notify', e)) then raise exception 'You don''t have permission to do that'; end if; end loop;
    f := f || '{"status":"buyers"}';
  else
    if not has_perm(p_bo, 'comms.marketing') then raise exception 'You don''t have permission to do that'; end if;
    if not exists(select 1 from members m join box_offices x on x.id = m.box_office_id where m.box_office_id = p_bo and m.email = me_email() and (m.all_events or x.owner = m.email)) and not is_super() then
      if cardinality(evs) = 0 or exists(select 1 from unnest(evs) z where not has_perm(p_bo, 'comms.marketing', z)) then raise exception 'You can only message the ticket holders of your own events'; end if;
    end if;
  end if;
  if 'sms' = any(chans) and not has_perm(p_bo, 'comms.sms') then raise exception 'You don''t have permission to send text messages'; end if;
  if 'email' = any(chans) and subj = '' then raise exception 'Add a subject'; end if; if body = '' then raise exception 'Write the message'; end if;
  if ch = 'sms' and length(body) > 480 then raise exception 'Keep a text message under 480 characters'; end if;
  if at_ < now() - interval '1 minute' or at_ > now() + interval '366 days' then raise exception 'Choose a send time in the future (within a year)'; end if;
  insert into broadcasts(box_office_id, event_id, kind, name, subject, body, channel, category, filter, send_at, status, recipients, created_by)
    values (p_bo, evs[1], case when cat = 'transactional' then 'update' else 'campaign' end, left(coalesce(nullif(trim(p->>'name'), ''), nullif(subj, ''), body), 120), left(subj, 200), left(body, 5000), ch, cat, f, at_,
      case when at_ > now() + interval '1 minute' then 'scheduled' else 'sent' end, 0, me_email()) returning * into b;
  for s in select * from segment_people(p_bo, f) loop
    n := n + 1; select * into k from contacts where box_office_id = p_bo and email = s.email;
    foreach c in array chans loop
      why := send_gate(k, c, cat, case when c = 'email' then s.email else s.phone end);
      if why <> '' then sk := jsonb_set(sk, array[why], to_jsonb(coalesce((sk->>why)::int, 0) + 1)); continue; end if;
      if queue_msg(jsonb_build_object('box_office_id', p_bo, 'event_id', evs[1], 'kind', b.kind, 'channel', c, 'category', cat, 'to', case when c = 'email' then s.email else s.phone end, 'email', s.email,
        'subject', b.subject, 'body', b.body, 'by', me_email(), 'send_at', at_, 'campaign_id', b.id, 'dedupe', format('cmp:%s:%s:%s', b.id, s.email, c))) is not null then q := q + 1; end if;
    end loop;
  end loop;
  update broadcasts set recipients = n, queued = q, skipped = sk where id = b.id returning * into b;
  perform log_action(p_bo, 'comms.campaign', format('%s %s “%s” (%s) to %s', case when b.status = 'scheduled' then 'Scheduled' else 'Sent' end, case when cat = 'transactional' then 'event update' else 'campaign' end,
    b.name, array_to_string(chans, ' + '), q), null, null, evs[1]);
  return to_jsonb(b);
end $$;
create or replace function campaign_action(p_bo uuid, p_id uuid, p_action text) returns jsonb language plpgsql security definer set search_path = public as $$
declare b broadcasts%rowtype; n int;
begin
  select * into b from broadcasts where id = p_id and box_office_id = p_bo for update; if not found then raise exception 'Campaign not found'; end if;
  if not (case when b.category = 'transactional' then has_perm(p_bo, 'comms.email', b.event_id) or has_perm(p_bo, 'comms.notify', b.event_id) else has_perm(p_bo, 'comms.marketing') end) then
    raise exception 'You don''t have permission to do that'; end if;
  if p_action <> 'cancel' then raise exception 'Unknown action'; end if;
  if b.status <> 'scheduled' then raise exception 'Only a scheduled campaign can be cancelled'; end if;
  update outbox set status = 'cancelled', error = 'campaign cancelled' where campaign_id = p_id and status = 'queued'; get diagnostics n = row_count;
  update broadcasts set status = 'cancelled', cancelled_by = me_email(), cancelled_at = now() where id = p_id returning * into b;
  perform log_action(p_bo, 'comms.campaign', format('Cancelled scheduled campaign “%s” (%s messages)', b.name, n));
  return to_jsonb(b);
end $$;
-- the waitlist notice now really goes out: one transactional email per person (they asked to hear)
create or replace function notify_waitlist(p_event uuid, p_message text) returns int language plpgsql security definer set search_path = public as $$
declare e events%rowtype; n int := 0; w waitlist%rowtype; b uuid;
begin
  select * into e from events where id = p_event;
  if not has_perm(e.box_office_id, 'comms.notify', p_event) then raise exception 'You don''t have permission to do that'; end if;
  insert into broadcasts(box_office_id, event_id, kind, name, subject, body, channel, category, status, recipients, created_by)
    values (e.box_office_id, p_event, 'waitlist', 'Waitlist: ' || (e.data->>'name'), 'Tickets available', p_message, 'email', 'transactional', 'sent', 0, me_email()) returning id into b;
  for w in update waitlist set notified_at = now() where event_id = p_event and notified_at is null returning * loop
    n := n + 1; perform queue_msg(jsonb_build_object('box_office_id', e.box_office_id, 'event_id', p_event, 'kind', 'waitlist', 'to', w.email, 'email', w.email, 'subject', 'Tickets are available: {{event}}',
      'body', p_message, 'by', me_email(), 'campaign_id', b));
  end loop;
  update broadcasts set recipients = n, queued = n where id = b;
  perform log_action(e.box_office_id, 'comms.waitlist', format('Notified %s people on the waitlist', n), null, null, p_event);
  return n;
end $$;

/* ── automations ── */
create or replace function save_automation(p_bo uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare a automations%rowtype; t text := p->'trigger'->>'type'; acts jsonb := '[]'; x jsonb; r jsonb; nm text := left(trim(coalesce(p->>'name', '')), 80); g integrations%rowtype;
  hrs int := least(720, greatest(0, coalesce(round((p->'trigger'->>'hours')::numeric), 0)))::int; mode text := coalesce(p->'timing'->>'mode', 'now');
begin
  if not has_perm(p_bo, 'comms.automations') then raise exception 'You don''t have permission to do that'; end if;
  if t is null or t not in ('ticket.purchased', 'ticket.cancelled', 'refund.issued', 'waitlist.joined', 'event.approaching', 'checked_in', 'no_show', 'cart.abandoned', 'promo.used', 'event.ended') then raise exception 'Choose a trigger'; end if;
  if nm = '' then raise exception 'Name the automation'; end if;
  if mode not in ('now', 'before', 'after', 'delay') then mode := 'now'; end if;
  for x in select v from jsonb_array_elements(coalesce(p->'actions', '[]')) with ordinality z(v, k) where k <= 8 loop
    r := jsonb_build_object('type', x->>'type');
    if x->>'type' in ('email', 'sms') then
      r := r || jsonb_build_object('category', case when x->>'category' = 'marketing' then 'marketing' else 'transactional' end, 'body', left(trim(coalesce(x->>'body', '')), case when x->>'type' = 'sms' then 480 else 5000 end));
      if x->>'type' = 'email' then r := r || jsonb_build_object('subject', left(trim(coalesce(x->>'subject', '')), 200)); if r->>'subject' = '' then raise exception 'Give the email a subject'; end if; end if;
      if r->>'body' = '' then raise exception 'Write the message'; end if;
      if coalesce(x->>'link', '') <> '' then r := r || jsonb_build_object('link', coalesce(safe_url(x->>'link'), '')); end if;
      if x->>'type' = 'sms' and not has_perm(p_bo, 'comms.sms') then raise exception 'You don''t have permission to send text messages'; end if;
      if r->>'category' = 'marketing' and not has_perm(p_bo, 'comms.marketing') then raise exception 'You don''t have permission to send marketing'; end if;
    elsif x->>'type' in ('tag', 'untag') then r := r || jsonb_build_object('tag', left(trim(coalesce(x->>'tag', '')), 40)); if r->>'tag' = '' then raise exception 'Name the tag'; end if;
    elsif x->>'type' = 'staff' then
      if lower(trim(coalesce(x->>'to', ''))) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter the staff email to notify'; end if;
      r := r || jsonb_build_object('to', lower(trim(x->>'to')), 'subject', left(coalesce(x->>'subject', ''), 200), 'body', left(coalesce(x->>'body', ''), 2000));
    elsif x->>'type' in ('webhook', 'crm') then
      select * into g from integrations where id = nullif(x->>'integrationId', '')::uuid and box_office_id = p_bo;
      if not found or (x->>'type' = 'webhook') <> (g.kind = 'webhook') or (x->>'type' = 'crm' and g.kind not in ('mailchimp', 'hubspot', 'activecampaign', 'constantcontact')) then
        raise exception '%', case when x->>'type' = 'webhook' then 'Choose a webhook (set one up under Integrations)' else 'Choose a connected CRM' end; end if;
      r := r || jsonb_build_object('integrationId', g.id);
    else raise exception 'Unknown action'; end if;
    acts := acts || jsonb_build_array(r);
  end loop;
  if jsonb_array_length(acts) = 0 then raise exception 'Add at least one action'; end if;
  if nullif(p->>'id', '') is not null then select * into a from automations where id = p->>'id' and box_office_id = p_bo; if not found then raise exception 'Automation not found'; end if; end if;
  insert into automations(id, box_office_id, name, enabled, trigger, cond, timing, actions, promo, kind, created_by, updated_at)
    values (coalesce(a.id, 'au_' || lower(rand_code(8))), p_bo, nm, coalesce((p->>'enabled')::boolean, true),
      jsonb_build_object('type', t, 'hours', case when t in ('event.approaching', 'event.ended', 'no_show') then hrs else 0 end),
      jsonb_build_object('eventIds', coalesce(p->'cond'->'eventIds', '[]'), 'ticketTypeIds', coalesce(p->'cond'->'ticketTypeIds', '[]'), 'areas', coalesce(p->'cond'->'areas', '[]'),
        'prices', coalesce(p->'cond'->'prices', '[]'), 'minQty', least(100, greatest(0, coalesce((p->'cond'->>'minQty')::int, 0))), 'promo', upper(left(trim(coalesce(p->'cond'->>'promo', '')), 40)), 'tags', coalesce(p->'cond'->'tags', '[]')),
      jsonb_build_object('mode', mode, 'hours', least(720, greatest(0, coalesce(round((p->'timing'->>'hours')::numeric), 0)))::int), acts, upper(left(trim(coalesce(p->>'promo', '')), 40)),
      case when a.std = 'pre' then 'reminder' when a.std in ('post', 'offer') then 'followup' else 'automation' end, me_email(), now())
    on conflict (id) do update set name = excluded.name, enabled = excluded.enabled, trigger = excluded.trigger, cond = excluded.cond, timing = excluded.timing, actions = excluded.actions,
      promo = excluded.promo, updated_at = now()
    returning * into a;
  perform log_action(p_bo, 'comms.automation', format('Saved automation “%s”%s', a.name, case when a.enabled then '' else ' (off)' end));
  return to_jsonb(a);
end $$;
create or replace function delete_automation(p_bo uuid, p_id text) returns void language plpgsql security definer set search_path = public as $$
declare a automations%rowtype;
begin
  if not has_perm(p_bo, 'comms.automations') then raise exception 'You don''t have permission to do that'; end if;
  delete from automations where id = p_id and box_office_id = p_bo returning * into a; if not found then raise exception 'Automation not found'; end if;
  update outbox set status = 'cancelled', error = 'automation deleted' where automation_id = p_id and status = 'queued';
  perform log_action(p_bo, 'comms.automation', format('Deleted automation “%s”', a.name));
end $$;
-- the standard workflows every box office starts with (Purchase · Pre-event reminder · Post-event thank you · Next-event offer, off)
create or replace function std_automations(p_bo uuid) returns void language sql security definer set search_path = public as $$
  insert into automations(id, box_office_id, std, kind, name, enabled, trigger, timing, actions, cond) values
    ('au_purchase_' || p_bo, p_bo, 'purchase', 'automation', 'Purchase', true, '{"type":"ticket.purchased","hours":0}', '{"mode":"now","hours":0}', '[{"type":"tag","tag":"Attendee: {{event}}"}]', '{}'),
    ('au_pre_' || p_bo, p_bo, 'pre', 'reminder', 'Pre-event reminder', true, '{"type":"event.approaching","hours":24}', '{"mode":"now","hours":0}',
      jsonb_build_array(jsonb_build_object('type', 'email', 'category', 'transactional', 'subject', 'Coming up: {{event}} — {{date}}', 'body', E'Hi {{first_name}},\n\n{{event}} is coming up on {{date}} at {{time}} — {{venue}}. Doors open {{doors}}.\n\nYour tickets: {{tickets_link}}\n\nSee you there!')), '{}'),
    ('au_post_' || p_bo, p_bo, 'post', 'followup', 'Post-event thank you', true, '{"type":"event.ended","hours":12}', '{"mode":"now","hours":0}',
      jsonb_build_array(jsonb_build_object('type', 'email', 'category', 'transactional', 'subject', 'Thanks for coming to {{event}}', 'body', E'Hi {{first_name}},\n\nThank you for joining us at {{event}}. We would love to hear how it went — it takes a minute: {{link}}', 'link', '')), '{}'),
    ('au_offer_' || p_bo, p_bo, 'offer', 'followup', 'Next-event offer', false, '{"type":"event.ended","hours":48}', '{"mode":"now","hours":0}',
      jsonb_build_array(jsonb_build_object('type', 'email', 'category', 'marketing', 'subject', 'A thank-you offer for your next night out', 'body', E'Hi {{first_name}},\n\nAs a thank-you for coming to {{event}}, use code {{promo_code}} on your next order.')), '{}')
  on conflict (id) do nothing $$;
create or replace function box_offices_std() returns trigger language plpgsql security definer set search_path = public as $$ begin perform std_automations(new.id); return new; end $$;
drop trigger if exists box_offices_std on box_offices;
create trigger box_offices_std after insert on box_offices for each row execute function box_offices_std();
do $$ begin perform std_automations(id) from box_offices; end $$;

/* ── integrations, consent, outbox, API keys ── */
create or replace function save_integration(p_bo uuid, p jsonb, p_secret text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare g integrations%rowtype; k text := p->>'kind'; cfg jsonb := '{}'; shown text; nm text;
begin
  if not has_perm(p_bo, 'admin.integrations') then raise exception 'You don''t have permission to do that'; end if;
  if k not in ('webhook', 'mailchimp', 'hubspot', 'activecampaign', 'constantcontact', 'meta_capi') then raise exception 'Unknown integration'; end if;
  if nullif(p->>'id', '') is not null then select * into g from integrations where id = (p->>'id')::uuid and box_office_id = p_bo and kind = k; if not found then raise exception 'Integration not found'; end if; end if;
  if k in ('webhook', 'activecampaign') then cfg := jsonb_build_object('url', safe_url(p->'config'->>'url')); if cfg->>'url' is null then raise exception 'Use an https:// address on a public host'; end if; end if;
  if k = 'webhook' then cfg := cfg || jsonb_build_object('events', (select coalesce(jsonb_agg(e), '[]') from jsonb_array_elements_text(coalesce(p->'config'->'events', '[]')) e
      where e in ('order.created', 'payment.completed', 'ticket.issued', 'ticket.cancelled', 'refund.issued', 'seat.changed', 'cart.expired', 'waitlist.signup', 'customer.checked_in', 'event.updated')));
    if jsonb_array_length(cfg->'events') = 0 then raise exception 'Choose at least one event to send'; end if; end if;
  if k = 'mailchimp' then if coalesce(p->'config'->>'dc', '') !~ '^[a-z]{2,4}\d{1,3}$' then raise exception 'The Mailchimp data center looks like “us21” (the end of your API key)'; end if;
    cfg := jsonb_build_object('dc', p->'config'->>'dc', 'list', left(coalesce(p->'config'->>'list', ''), 60)); end if;
  if k in ('activecampaign', 'constantcontact') then cfg := cfg || jsonb_build_object('list', left(coalesce(p->'config'->>'list', ''), 60)); end if;
  if k = 'meta_capi' then if coalesce(p->'config'->>'pixel', '') !~ '^\d{6,20}$' then raise exception 'Enter your Meta Pixel ID (numbers only)'; end if;
    cfg := jsonb_build_object('pixel', p->'config'->>'pixel', 'test', left(coalesce(p->'config'->>'test', ''), 40)); end if;
  if k in ('mailchimp', 'hubspot', 'activecampaign', 'constantcontact') then cfg := cfg || jsonb_build_object('who', case when p->'config'->>'who' = 'all' then 'all' else 'optedIn' end); end if;
  nm := left(coalesce(nullif(trim(p->>'name'), ''), k), 80);
  if g.id is null then
    if k = 'webhook' then shown := 'whsec_' || replace(gen_random_uuid()::text, '-', '') || left(replace(gen_random_uuid()::text, '-', ''), 16); p_secret := shown; end if;
    if coalesce(p_secret, '') = '' then raise exception 'Paste the API key / access token'; end if;
    insert into integrations(box_office_id, kind, name, active, config, secret, secret_hint, created_by) values (p_bo, k, nm, coalesce((p->>'active')::boolean, true), cfg, left(p_secret, 400), '…' || right(p_secret, 4), me_email()) returning * into g;
  else
    update integrations set name = nm, active = coalesce((p->>'active')::boolean, true), config = cfg, secret = coalesce(nullif(left(p_secret, 400), ''), secret),
      secret_hint = case when coalesce(p_secret, '') <> '' then '…' || right(p_secret, 4) else secret_hint end where id = g.id returning * into g;
  end if;
  perform log_action(p_bo, 'admin.integrations', format('Saved %s “%s”', k, g.name));
  return to_jsonb(g) - 'secret' || jsonb_build_object('secret_set', g.secret is not null, 'secret', shown);
end $$;
create or replace function delete_integration(p_bo uuid, p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare g integrations%rowtype;
begin
  if not has_perm(p_bo, 'admin.integrations') then raise exception 'You don''t have permission to do that'; end if;
  delete from integrations where id = p_id and box_office_id = p_bo returning * into g; if not found then raise exception 'Integration not found'; end if;
  perform log_action(p_bo, 'admin.integrations', format('Disconnected %s “%s”', g.kind, g.name));
end $$;
create or replace function test_integration(p_bo uuid, p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare g integrations%rowtype; d deliveries%rowtype;
begin
  if not has_perm(p_bo, 'admin.integrations') then raise exception 'You don''t have permission to do that'; end if;
  select * into g from integrations where id = p_id and box_office_id = p_bo; if not found then raise exception 'Integration not found'; end if;
  insert into deliveries(box_office_id, integration_id, kind, event, event_id, payload) values (p_bo, g.id, g.kind, 'ping', 'evt_' || lower(rand_code(14)),
    jsonb_build_object('type', 'ping', 'created', now(), 'data', jsonb_build_object('box_office', (select name from box_offices where id = p_bo)))) returning * into d;
  return to_jsonb(d);
end $$;
create or replace function contact_action(p_bo uuid, p_email text, p_action text, p jsonb default '{}') returns jsonb language plpgsql security definer set search_path = public as $$
declare c contacts%rowtype; src text := trim(coalesce(p->>'source', '')); t text[];
begin
  if not has_perm(p_bo, 'comms.consent') then raise exception 'You don''t have permission to do that'; end if;
  c := contact_upsert(p_bo, p_email); if c.id is null then raise exception 'Enter a valid email'; end if;
  if p_action in ('tag', 'untag') then
    t := array(select distinct left(trim(x), 40) from unnest(string_to_array(coalesce(p->>'tags', p->>'tag', ''), ',')) x where trim(x) <> '');
    update contacts set tags = case when p_action = 'tag' then array(select distinct unnest(tags || t)) else array(select unnest(tags) except select unnest(t)) end, updated_at = now() where id = c.id;
    perform log_action(p_bo, 'comms.tags', format('%s %s: %s', case when p_action = 'tag' then 'Tagged' else 'Untagged' end, c.email, array_to_string(t, ', ')));
  elsif p_action = 'phone' then
    if coalesce(p->>'phone', '') <> '' and norm_phone(p->>'phone') is null then raise exception 'Enter a mobile number with country code'; end if;
    update contacts set phone = norm_phone(p->>'phone'), sms_optin = sms_optin and norm_phone(p->>'phone') is not null, updated_at = now() where id = c.id;
  else
    if p_action in ('optin', 'sms_optin') and src = '' then raise exception 'Say how the customer gave consent (e.g. “signed up at the door”)'; end if;
    perform consent_change(c.id, p_action, 'staff: ' || coalesce(nullif(src, ''), nullif(p->>'reason', ''), 'box office'), me_email(), p->>'reason');
    perform log_action(p_bo, 'comms.consent', format('%s for %s%s', p_action, c.email, case when src <> '' then ' — ' || src else '' end));
  end if;
  return (select to_jsonb(x) - 'token' from contacts x where x.id = c.id);
end $$;
create or replace function outbox_action(p_bo uuid, p_id uuid, p_action text) returns jsonb language plpgsql security definer set search_path = public as $$
declare m outbox%rowtype;
begin
  select * into m from outbox where id = p_id and box_office_id = p_bo for update; if not found then raise exception 'Message not found'; end if;
  if not (case when m.order_id is not null then has_perm(p_bo, 'orders.resend', m.event_id) else has_perm(p_bo, 'comms.email') or has_perm(p_bo, 'comms.marketing') end) then raise exception 'You don''t have permission to do that'; end if;
  if p_action = 'cancel' then if m.status <> 'queued' then raise exception 'Only a queued message can be cancelled'; end if; update outbox set status = 'cancelled', error = 'cancelled by ' || me_email() where id = p_id;
  elsif p_action = 'retry' then if m.status not in ('failed', 'suppressed') then raise exception 'Only a failed or held message can be retried'; end if; update outbox set status = 'queued', send_at = now(), error = null where id = p_id;
  else raise exception 'Unknown action'; end if;
  return (select to_jsonb(x) from outbox x where x.id = p_id);
end $$;
create or replace function create_api_key(p_bo uuid, p_name text, p_scopes text[]) returns jsonb language plpgsql security definer set search_path = public as $$
declare k text := 'set_live_' || replace(gen_random_uuid()::text, '-', '') || left(replace(gen_random_uuid()::text, '-', ''), 8); r api_keys%rowtype; sc text[] := array(select s from unnest(p_scopes) s where s in ('events:read', 'orders:read', 'tickets:read', 'customers:read'));
begin
  if not has_perm(p_bo, 'admin.api') then raise exception 'You don''t have permission to do that'; end if;
  if cardinality(sc) = 0 then raise exception 'Choose what the key may read'; end if;
  insert into api_keys(box_office_id, name, prefix, hash, scopes, created_by) values (p_bo, left(coalesce(nullif(trim(p_name), ''), 'API key'), 80), left(k, 13), encode(sha256(convert_to(k, 'UTF8')), 'hex'), sc, me_email()) returning * into r;
  perform log_action(p_bo, 'admin.api', format('Created API key “%s” (%s)', r.name, array_to_string(sc, ', ')));
  return to_jsonb(r) - 'hash' || jsonb_build_object('key', k);   -- shown once; only the hash is kept
end $$;
create or replace function revoke_api_key(p_bo uuid, p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare r api_keys%rowtype;
begin
  if not has_perm(p_bo, 'admin.api') then raise exception 'You don''t have permission to do that'; end if;
  update api_keys set revoked_at = now(), revoked_by = me_email() where id = p_id and box_office_id = p_bo and revoked_at is null returning * into r; if not found then raise exception 'Key not found'; end if;
  perform log_action(p_bo, 'admin.api', format('Revoked API key “%s”', r.name));
end $$;
-- the preferences page a marketing email links to (anyone holding the link; no sign-in)
create or replace function unsub_info(p_token text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('box_office', b.name, 'email', mask_email(c.email), 'email_on', c.email_optin and c.unsub_email_at is null, 'sms_on', c.sms_optin and c.unsub_sms_at is null,
    'has_phone', c.phone is not null, 'sms_stopped', c.unsub_sms_at is not null) from contacts c join box_offices b on b.id = c.box_office_id where c.token = p_token and length(p_token) >= 24 $$;
create or replace function unsubscribe(p_token text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare c contacts%rowtype;
begin
  select * into c from contacts where token = p_token and length(p_token) >= 24; if not found then raise exception 'This link is not valid any more'; end if;
  if (p->>'email')::boolean is false then perform consent_change(c.id, 'optout', 'unsubscribe link', c.email);
  elsif (p->>'email')::boolean and not (c.email_optin and c.unsub_email_at is null) then perform consent_change(c.id, 'optin', 'preferences page', c.email); end if;
  if (p->>'sms')::boolean is false and c.unsub_sms_at is null and c.phone is not null then perform consent_change(c.id, 'sms_optout', 'unsubscribe link', c.email);
  elsif (p->>'sms')::boolean and c.phone is not null and not (c.sms_optin and c.unsub_sms_at is null) then perform consent_change(c.id, 'sms_optin', 'preferences page', c.email); end if;
  return unsub_info(p_token);
end $$;

/* ── the sender (messaging Edge Function, service role only) ── */
-- what an email / text needs to be rendered: box office branding, the event, the order (incl. its private ticket link) and its valid tickets
create or replace function msg_context(m outbox) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('bo', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'branding', b.branding, 'mail', coalesce(b.settings->'mail', '{}'), 'domain', b.branding->>'domain'),
    'event', (select jsonb_build_object('id', e.id, 'slug', e.slug, 'name', e.data->>'name', 'start', e.data->>'start', 'end', e.data->>'end', 'doors', e.data->>'doors', 'venue', e.data->>'venue',
        'address', e.data->>'address', 'timezone', e.data->>'timezone', 'confirmation', e.data->'emails'->>'confirmation', 'timeSlots', e.data->'timeSlots') from events e where e.id = coalesce(m.event_id, o.event_ids[1])),
    'order', case when o.id is null then null else jsonb_build_object('id', o.id, 'key', o.access_key, 'ref', o.ref, 'total', o.data->'total', 'currency', o.data->'currency', 'buyer', o.data->'buyer',
      'events', (select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.data->>'name', 'start', e.data->>'start', 'venue', e.data->>'venue', 'address', e.data->>'address',
        'confirmation', e.data->'emails'->>'confirmation')) from events e where e.id = any(o.event_ids))) end,
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('event_id', t.event_id, 'slot_id', t.slot_id, 'type', (select tt->>'name' from events e, jsonb_array_elements(e.data->'ticketTypes') tt where e.id = t.event_id and tt->>'id' = t.ticket_type_id),
        'area', t.area, 'row', t."row", 'seat', coalesce(t.seat_label, t.seat), 'unit', t.unit, 'code', t.code, 'holder', t.holder) order by t.issued_at) from tickets t where t.order_id = o.id and t.status = 'valid'), '[]'),
    'contact', (select jsonb_build_object('name', c.name, 'token', c.token) from contacts c where c.box_office_id = m.box_office_id and c.email = m.email))
  from box_offices b left join orders o on o.id = m.order_id where b.id = m.box_office_id $$;
create or replace function claim_outbox(p_limit int default 50) returns jsonb language plpgsql security definer set search_path = public as $$
declare m outbox%rowtype; k contacts%rowtype; why text; out jsonb := '[]';
begin
  update outbox set status = 'queued', locked_until = null where status = 'sending' and locked_until < now();   -- a sender that died mid-run
  for m in select * from outbox where status = 'queued' and send_at <= now() order by send_at limit least(greatest(p_limit, 1), 500) for update skip locked loop
    if m.require_valid and m.order_id is not null and not exists(select 1 from tickets t where t.order_id = m.order_id and t.status = 'valid' and (m.event_id is null or t.event_id = m.event_id)) then
      update outbox set status = 'cancelled', error = 'the order has no valid tickets any more', attempts = attempts + 1 where id = m.id; continue; end if;
    select * into k from contacts where box_office_id = m.box_office_id and email = m.email;
    why := send_gate(k, m.channel, m.category, m."to");
    if why <> '' then update outbox set status = 'suppressed', error = why, attempts = attempts + 1 where id = m.id; continue; end if;
    update outbox set status = 'sending', attempts = attempts + 1, locked_until = now() + interval '5 minutes' where id = m.id returning * into m;
    out := out || jsonb_build_array(jsonb_build_object('msg', to_jsonb(m), 'ctx', msg_context(m)));
  end loop;
  return out;
end $$;
-- the provider's answer: sent · retry later (back-off 2, 4, 8, 16 min) · failed after 5 attempts or a permanent error
create or replace function outbox_result(p_id uuid, p_ok boolean, p_provider text, p_provider_id text, p_error text default null, p_permanent boolean default false) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_ok then update outbox set status = 'sent', sent_at = now(), provider = p_provider, provider_id = p_provider_id, error = null, locked_until = null where id = p_id;
  else update outbox set status = case when p_permanent or attempts >= 5 then 'failed' else 'queued' end, error = left(p_error, 500), provider = p_provider, locked_until = null,
    send_at = now() + make_interval(mins => power(2, least(attempts, 6))::int) where id = p_id; end if;
end $$;
create or replace function claim_deliveries(p_limit int default 50) returns jsonb language plpgsql security definer set search_path = public as $$
declare d deliveries%rowtype; g integrations%rowtype; out jsonb := '[]';
begin
  update deliveries set locked_until = null where status = 'queued' and locked_until < now();
  for d in select * from deliveries where status = 'queued' and next_at <= now() and (locked_until is null) order by next_at limit least(greatest(p_limit, 1), 200) for update skip locked loop
    select * into g from integrations where id = d.integration_id;
    if not found or not g.active then update deliveries set status = 'cancelled', response = 'integration off or removed' where id = d.id; continue; end if;
    update deliveries set attempts = attempts + 1, locked_until = now() + interval '5 minutes' where id = d.id returning * into d;
    out := out || jsonb_build_array(jsonb_build_object('delivery', to_jsonb(d), 'integration', to_jsonb(g),
      'contact', case when d.payload->'data'->>'email' is null then null else (select to_jsonb(c) - 'token' from contacts c where c.box_office_id = d.box_office_id and c.email = lower(d.payload->'data'->>'email')) end));
  end loop;
  return out;
end $$;
create or replace function delivery_result(p_id uuid, p_ok boolean, p_response text, p_permanent boolean default false) returns void language plpgsql security definer set search_path = public as $$
declare d deliveries%rowtype;
begin
  update deliveries set status = case when p_ok then 'delivered' when p_permanent or attempts >= 6 then 'failed' else 'queued' end, response = left(p_response, 500), locked_until = null,
    done_at = case when p_ok then now() end, next_at = case when p_ok then next_at else now() + make_interval(mins => power(2, least(attempts, 8))::int) end where id = p_id returning * into d;
  update integrations set last_at = now(), last_error = case when p_ok then '' else left(p_response, 300) end where id = d.integration_id;
end $$;
-- inbound texts: STOP / START keywords (carrier rules) — every contact with that number
create or replace function inbound_sms(p_from text, p_body text) returns int language plpgsql security definer set search_path = public as $$
declare c contacts%rowtype; n int := 0; w text := upper(trim(coalesce(p_body, '')));
begin
  for c in select * from contacts where phone = norm_phone(p_from) loop
    if w in ('STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT') then if consent_change(c.id, 'sms_optout', 'replied ' || w, p_from) then n := n + 1; end if;
    elsif w in ('START', 'UNSTOP', 'YES') then if consent_change(c.id, 'sms_start', 'replied ' || w, p_from) then n := n + 1; end if; end if;
  end loop;
  return n;
end $$;
-- email provider events: hard bounce / spam complaint → suppress the address
create or replace function mail_event(p_provider_id text, p_type text) returns void language plpgsql security definer set search_path = public as $$
declare m outbox%rowtype; c contacts%rowtype;
begin
  select * into m from outbox where provider_id = p_provider_id; if not found or p_type not in ('bounced', 'complaint') then return; end if;
  c := contact_upsert(m.box_office_id, m.email); if c.id is null then return; end if;
  if c.suppressed is null then perform consent_change(c.id, 'suppress', 'email provider: ' || case when p_type = 'bounced' then 'hard bounce' else 'spam complaint' end, 'system', p_type); end if;
  update outbox set status = 'failed', error = p_type where id = m.id;
end $$;
-- the read-only API: a key's hash → its box office + scopes (rate limited to 120 calls a minute)
create or replace function api_auth(p_hash text) returns jsonb language plpgsql security definer set search_path = public as $$
declare k api_keys%rowtype; n int;
begin
  select * into k from api_keys where hash = p_hash and revoked_at is null; if not found then return null; end if;
  insert into api_usage(key_id, minute, n) values (k.id, date_trunc('minute', now()), 1) on conflict (key_id, minute) do update set n = api_usage.n + 1 returning api_usage.n into n;
  update api_keys set last_used_at = now() where id = k.id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  delete from api_usage where key_id = k.id and minute < now() - interval '1 hour';
  return jsonb_build_object('key_id', k.id, 'box_office_id', k.box_office_id, 'scopes', to_jsonb(k.scopes), 'limited', n > 120);
end $$;
create or replace function api_read(p_bo uuid, p_resource text, p_since timestamptz default null, p_limit int default 100) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lim int := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  return case p_resource
    when 'events' then (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'slug', e.slug, 'status', e.status, 'name', e.data->>'name', 'start', e.data->>'start', 'end', e.data->>'end', 'venue', e.data->>'venue',
        'ticket_types', (select jsonb_agg(jsonb_build_object('id', t->>'id', 'name', t->>'name', 'price', t->'price', 'qty', t->'qty')) from jsonb_array_elements(e.data->'ticketTypes') t), 'created_at', e.created_at)), '[]')
      from (select * from events e where e.box_office_id = p_bo and (p_since is null or e.created_at >= p_since) order by e.created_at limit lim) e)
    when 'orders' then (select coalesce(jsonb_agg(hook_order(o) order by o.created_at), '[]') from (select * from orders o where o.box_office_id = p_bo and o.status not in ('awaiting_payment', 'expired')
      and (p_since is null or o.created_at >= p_since) order by o.created_at limit lim) o)
    when 'tickets' then (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'order_id', t.order_id, 'event_id', t.event_id, 'ticket_type_id', t.ticket_type_id, 'area', t.area, 'row', t."row", 'seat', t.seat_label,
        'status', t.status, 'face', t.face, 'paid', t.paid, 'comp', t.comp, 'checked_in_at', t.checked_in_at, 'issued_at', t.issued_at) order by t.issued_at), '[]')
      from (select * from tickets t where t.box_office_id = p_bo and (p_since is null or t.touched_at >= p_since) order by t.issued_at limit lim) t)
    when 'customers' then (select coalesce(jsonb_agg(to_jsonb(c) - 'token' - 'id' order by c.created_at), '[]') from (select * from contacts c where c.box_office_id = p_bo and (p_since is null or c.updated_at >= p_since) order by c.created_at limit lim) c)
    else null end;
end $$;
-- outside systems hear when a published event changes (date, venue, …)
create or replace function events_hook() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and old.data is distinct from new.data then
    perform emit_event(new.box_office_id, 'event.updated', jsonb_build_object('event_id', new.id, 'name', new.data->>'name', 'start', new.data->>'start', 'venue', new.data->>'venue')); end if;
  return new;
end $$;
drop trigger if exists events_hook on events;
create trigger events_hook after update on events for each row execute function events_hook();

grant execute on function unsub_info(text), unsubscribe(text,jsonb) to anon, authenticated;
grant execute on function send_campaign(uuid,jsonb), campaign_action(uuid,uuid,text), segment_count(uuid,jsonb), save_segments(uuid,jsonb), save_automation(uuid,jsonb), delete_automation(uuid,text),
  save_integration(uuid,jsonb,text), delete_integration(uuid,uuid), test_integration(uuid,uuid), contact_action(uuid,text,text,jsonb), outbox_action(uuid,uuid,text),
  create_api_key(uuid,text,text[]), revoke_api_key(uuid,uuid) to authenticated;
revoke execute on function send_campaign(uuid,jsonb), campaign_action(uuid,uuid,text), segment_count(uuid,jsonb), save_segments(uuid,jsonb), save_automation(uuid,jsonb), delete_automation(uuid,text),
  save_integration(uuid,jsonb,text), delete_integration(uuid,uuid), test_integration(uuid,uuid), contact_action(uuid,text,text,jsonb), outbox_action(uuid,uuid,text),
  create_api_key(uuid,text,text[]), revoke_api_key(uuid,uuid) from anon, public;
revoke execute on function contact_upsert(uuid,text,text,text), consent_change(uuid,text,text,text,text), order_contact(uuid), send_gate(contacts,text,text,text), queue_msg(jsonb), queue_mail(orders,text,text,text,text),
  hook_order(orders), order_ctx(orders,uuid[]), auto_match(automations,jsonb), run_automation(text,jsonb,text), emit_event(uuid,text,jsonb,jsonb), marketing_tick(), segment_people(uuid,jsonb),
  std_automations(uuid), msg_context(outbox), claim_outbox(int), outbox_result(uuid,boolean,text,text,text,boolean), claim_deliveries(int), delivery_result(uuid,boolean,text,boolean),
  inbound_sms(text,text), mail_event(text,text), api_auth(text), api_read(uuid,text,timestamptz,int) from anon, authenticated, public;
-- the messaging + api Edge Functions (service role) and pg_cron
grant execute on function marketing_tick(), claim_outbox(int), outbox_result(uuid,boolean,text,text,text,boolean), claim_deliveries(int), delivery_result(uuid,boolean,text,boolean),
  inbound_sms(text,text), mail_event(text,text), api_auth(text), api_read(uuid,text,timestamptz,int), expire_orders() to service_role;
-- pg_cron: select cron.schedule('set-marketing-tick', '* * * * *', 'select marketing_tick()');
--          + call the messaging function every minute (SETUP.md → "SET — sending email & texts")

-- Stage 4 migration: per-event discount codes become box-office promo codes (targeted at their event).
insert into promos(id, box_office_id, code, data)
  select 'pr_' || lower(rand_code(6)), e.box_office_id, upper(d->>'code'), jsonb_build_object('code', upper(d->>'code'), 'active', true, 'type', case when d->>'type' = 'pct' then 'pct' else 'order' end,
    'amount', d->'amount', 'on', 'tickets', 'scope', '["tickets"]'::jsonb, 'eventIds', jsonb_build_array(e.id), 'ticketTypeIds', coalesce(d->'ticketTypeIds','[]'), 'expires', coalesce(d->>'expires',''),
    'maxUses', coalesce((d->>'limit')::int, 0), 'codes', '[]'::jsonb, 'note', 'Moved from ' || (e.data->>'name'))
  from events e, jsonb_array_elements(coalesce(e.secrets->'discounts','[]')) d where coalesce(d->>'code','') <> ''
  on conflict do nothing;
update events set secrets = secrets - 'discounts' where secrets ? 'discounts';

-- First platform owner. Create box offices from #/platform after signing in.
insert into platform_admins(email) values ('moishsonn@gmail.com') on conflict do nothing;
