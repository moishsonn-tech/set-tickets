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
  select data->>'name' as name, coalesce((data->>'publicRegistration')::boolean, false) as "publicRegistration" from platform_settings where id = 1;

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
create policy orders_update on orders for update using (has_perm(box_office_id, 'orders.edit', event_ids[1]) or has_perm(box_office_id, 'orders.cancel', event_ids[1]) or has_perm(box_office_id, 'orders.refund', event_ids[1]));
create policy tickets_read on tickets for select using (has_perm(box_office_id, 'door.attendees', event_id) or has_perm(box_office_id, 'orders.view', event_id));
create policy tickets_update on tickets for update using (has_perm(box_office_id, 'orders.cancelTicket', event_id) or has_perm(box_office_id, 'orders.cancel', event_id));
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

-- Buyers never see secrets or internal columns.
revoke select on events from anon;
grant select (id, box_office_id, slug, status, data, created_at, updated_at) on events to anon;
revoke select on box_offices from anon;
grant select (id, slug, name, status, branding, settings) on box_offices to anon;
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
  foreach k in array array['name','start','end','allDay','venue','address','online','capacity','visibility','publishAt','salesStart','salesEnd','archived','waitlistMode','currency','contact','policies','timeSlots','addons','bundles','upsells'] loop
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
  if new.status is distinct from old.status and not has_perm(new.box_office_id,
     case new.status when 'refunded' then 'orders.refund' when 'cancelled' then 'orders.cancel' else 'orders.edit' end, new.event_ids[1]) then
    raise exception 'You don''t have permission to mark this order %', new.status; end if;
  if new.status is distinct from old.status then
    perform log_action(new.box_office_id, 'order.' || new.status, format('Order %s: %s → %s', new.ref, old.status, new.status), jsonb_build_object('status', old.status), jsonb_build_object('status', new.status), new.event_ids[1]); end if;
  return new;
end $$;
drop trigger if exists orders_audit on orders;
create trigger orders_audit before update on orders for each row execute function orders_audit();

-- ── Public RPCs ────────────────────────────────────────────────────────────────
create or replace function rand_code(n int) returns text language sql volatile as
$$ select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random()*32)::int, 1), '') from generate_series(1, n) $$;

drop function if exists availability(uuid);
-- seats: sold "slot|seat" keys; off: seats nobody else can pick right now (blocked / held / unavailable / in another buyer's checkout).
create or replace function availability(p_event uuid, p_token text default null) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tt',    coalesce((select jsonb_object_agg(k, c) from (select ticket_type_id k, count(*) c from tickets where event_id = p_event and status='valid' group by 1) a), '{}'),
    'slots', coalesce((select jsonb_object_agg(k, c) from (select slot_id k, count(*) c from tickets where event_id = p_event and status='valid' and slot_id is not null group by 1) a), '{}'),
    'seats', coalesce((select jsonb_agg(coalesce(slot_id,'') || '|' || seat) from tickets where event_id = p_event and status='valid' and seat is not null), '[]'),
    'off',   coalesce((select jsonb_agg(slot_id || '|' || seat) from seat_status where event_id = p_event
               and not (status = 'checkout' and (expires_at <= now() or token = p_token))), '[]'),
    'total', (select count(*) from tickets where event_id = p_event and status='valid'),
    -- products and packages already sold (a package's products count against the product's stock)
    'ad', coalesce((select jsonb_object_agg(k, c) from (select k, sum(n) c from (
        select l->>'addonId' k, (l->>'qty')::int n from orders o, jsonb_array_elements(o.data->'lines') l
          where p_event = any(o.event_ids) and o.status in ('paid','pending') and l->>'kind' = 'addon' and l->>'eventId' = p_event::text
        union all
        select x->>'addonId', greatest(1, coalesce((x->>'qty')::int, 1)) * (l->>'qty')::int from orders o, jsonb_array_elements(o.data->'lines') l, jsonb_array_elements(coalesce(l->'addons','[]')) x
          where p_event = any(o.event_ids) and o.status in ('paid','pending') and l->>'kind' = 'bundle' and l->>'eventId' = p_event::text) u group by k) a), '{}'),
    'bd', coalesce((select jsonb_object_agg(k, c) from (select l->>'bundleId' k, sum((l->>'qty')::int) c from orders o, jsonb_array_elements(o.data->'lines') l
          where p_event = any(o.event_ids) and o.status in ('paid','pending') and l->>'kind' = 'bundle' and l->>'eventId' = p_event::text group by 1) a), '{}'));
$$;

-- ── Seats (Stage 3) ────────────────────────────────────────────────────────────
-- "Stalls centre · Row A · Seat 12" from the event's derived seat meta
create or replace function seat_text(e events, p_seat text) returns text language sql stable as $$
  select coalesce(concat_ws(' · ', nullif(e.data->'seating'->'meta'->p_seat->>0, ''), 'Row ' || nullif(e.data->'seating'->'meta'->p_seat->>1, ''),
    'Seat ' || nullif(e.data->'seating'->'meta'->p_seat->>2, '')), p_seat) $$;
-- What stops this seat being sold right now (null = nothing). Staff may sell a seat they're holding; a buyer may buy their own checkout hold.
create or replace function seat_blocker(p_event uuid, p_slot text, p_seat text, p_token text, p_staff boolean) returns text language sql stable as $$
  select status from seat_status where event_id = p_event and seat = p_seat and slot_id in (coalesce(p_slot,''), '')
    and not (status = 'checkout' and (expires_at <= now() or token = p_token)) and not (p_staff and status = 'held')
  order by case status when 'unavailable' then 4 when 'blocked' then 3 when 'held' then 2 else 1 end desc limit 1 $$;
create or replace function seat_free(e events, p_slot text, p_seat text, p_token text) returns boolean language sql stable as $$
  select coalesce(e.data->'seating'->'index', '{}') ? p_seat
    and not exists(select 1 from tickets t where t.event_id = e.id and t.status = 'valid' and t.seat = p_seat and coalesce(t.slot_id,'') = coalesce(p_slot,''))
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
  elsif p_action = 'move' then
    s := p->>'to';
    select * into t from tickets where event_id = e.id and status = 'valid' and seat = p_seats[1] and coalesce(slot_id,'') = sl;
    if not found then raise exception 'That seat has no ticket to move'; end if;
    if not coalesce(e.data->'seating'->'meta', '{}') ? s then raise exception 'Choose the new seat'; end if;
    if exists(select 1 from tickets where event_id = e.id and status = 'valid' and seat = s and coalesce(slot_id,'') = sl) or seat_blocker(e.id, sl, s, null, true) is not null
      then raise exception '% isn''t free', seat_text(e, s); end if;
    if e.data->'seating'->'index'->>s is distinct from t.ticket_type_id then raise exception 'That seat is a different price level — changing price (upgrade / downgrade) comes with order editing in Stage 6'; end if;
    update tickets set seat = s, area = e.data->'seating'->'meta'->s->>0, "row" = e.data->'seating'->'meta'->s->>1, seat_label = e.data->'seating'->'meta'->s->>2 where id = t.id;
    update orders set data = jsonb_set(data, '{lines}', (select jsonb_agg(case when l->>'eventId' = e.id::text and (l->'seats') ? p_seats[1]
        then jsonb_set(l, '{seats}', (select jsonb_agg(case when z = p_seats[1] then s else z end) from jsonb_array_elements_text(l->'seats') z)) else l end) from jsonb_array_elements(data->'lines') l))
      where id = t.order_id returning ref into o_ref;
    delete from seat_status where event_id = e.id and seat = s and status = 'held' and slot_id in (sl, '');
    insert into seat_log(box_office_id, event_id, slot_id, seat, action, detail, by, ref) values
      (e.box_office_id, e.id, sl, p_seats[1], 'moved', t.holder || ' moved to ' || seat_text(e, s) || ' — seat released', me_email(), o_ref),
      (e.box_office_id, e.id, sl, s, 'moved', t.holder || ' moved here from ' || seat_text(e, p_seats[1]), me_email(), o_ref);
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
  if old.status = 'valid' and new.status <> 'valid' and new.seat is not null then
    insert into seat_log(box_office_id, event_id, slot_id, seat, action, detail, by, ref)
      select new.box_office_id, new.event_id, coalesce(new.slot_id,''), new.seat, 'cancelled', 'Order ' || o.ref || ' ' || o.status || ' — seat released', me_email(), o.ref from orders o where o.id = new.order_id;
  end if;
  return new;
end $$;
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
  select count(*) into used from orders where status in ('paid','pending') and data->'promo'->>'id' = p->>'id';
  if coalesce((p->>'maxUses')::int, 0) > 0 and used >= (p->>'maxUses')::int then return format('Code %s has been fully used', p->>'code'); end if;
  if coalesce(p->'codes','[]') ? c and exists(select 1 from orders where status in ('paid','pending') and data->'promo'->>'id' = p->>'id' and upper(data->>'code') = c) then
    return format('Code %s has already been used', c); end if;
  if coalesce(p_email,'') <> '' and coalesce((p->>'perCustomer')::int, 0) > 0
     and (select count(*) from orders where status in ('paid','pending') and data->'promo'->>'id' = p->>'id' and buyer_email = lower(trim(p_email))) >= (p->>'perCustomer')::int then
    return format('You''ve already used code %s', p->>'code'); end if;
  return '';
end $$;
create or replace function tracking_usable(t jsonb, p_bo uuid, p_events uuid[]) returns boolean language sql stable security definer set search_path = public as $$
  select t is not null and coalesce((t->>'active')::boolean, true) and in_window(t->>'startsAt', t->>'expires')
    and (jsonb_array_length(coalesce(t->'eventIds','[]')) = 0 or exists(select 1 from jsonb_array_elements_text(t->'eventIds') e where e = any(p_events::text[])))
    and not (coalesce((t->>'maxUses')::int, 0) > 0 and (select count(*) from orders o where o.box_office_id = p_bo and o.status in ('paid','pending') and o.data->>'tracking' = t->>'code') >= (t->>'maxUses')::int) $$;
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
  tax := round((subtotal - disc) * coalesce((st->>'taxPct')::numeric, 0) / 100);
  donation := greatest(0, round(coalesce((p->>'donation')::numeric, 0)))::bigint;
  return jsonb_build_object('lines', lines, 'subtotal', subtotal, 'discount', disc, 'feeDiscount', fdisc, 'fee', fee, 'tax', tax, 'donation', donation,
    'total', subtotal - disc + fee + tax + donation, 'promoErr', err,
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
  p_bundle jsonb, p_extras jsonb, p_comp boolean, p_holder text, p_by text) returns void language plpgsql security definer set search_path = public as $$
declare e events%rowtype;
begin
  select * into e from events where id = (l->>'eventId')::uuid;
  insert into tickets(box_office_id, order_id, event_id, ticket_type_id, slot_id, seat, area, "row", seat_label, comp, face, paid, discount, promo, tracking, bundle, extras, price_override, code, holder)
  values (p_bo, p_order, e.id, p_tt, nullif(l->>'slotId',''), p_seat, e.data->'seating'->'meta'->p_seat->>0, e.data->'seating'->'meta'->p_seat->>1, e.data->'seating'->'meta'->p_seat->>2,
    p_comp, p_face, p_paid, p_disc, case when p_disc > 0 then p_promo end, p_tracking, p_bundle, coalesce(p_extras, '[]'), coalesce((l->>'override')::boolean, false), rand_code(10), p_holder);
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
    'ticketTypes', coalesce((select jsonb_agg(k) from jsonb_each_text(coalesce(secrets->'ticketPasswords','{}')) where value = p_password), '[]'))
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

create or replace function get_order(p_id uuid, p_key uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('order', to_jsonb(o) - 'access_key', 'tickets', coalesce((select jsonb_agg(to_jsonb(t)) from tickets t where t.order_id = o.id), '[]'))
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
  f jsonb; err text; promo jsonb; promo_code text; tracking text; q jsonb; plat jsonb; pfee bigint := 0; ntk int; status text; total bigint;
  oid uuid; okey uuid; oref text; l jsonb; c int; u int; j int; adm int; per int; d bigint; w bigint[]; fs bigint[]; ps bigint[]; ds bigint[]; extras jsonb; by_ text;
begin
  if coalesce(trim(p->'buyer'->>'name'),'') = '' then raise exception 'Name is required'; end if;
  if email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'A valid email is required'; end if;
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
  q := price_cart(p, manual, st, promo);
  if promo is not null and q->>'promoErr' <> '' then raise exception '%', q->>'promoErr'; end if;
  select data into plat from platform_settings where id = 1;
  ntk := (select coalesce(sum(case when ln->>'kind' = 'ticket' then (ln->>'qty')::int when ln->>'kind' = 'bundle' then (ln->>'qty')::int * (ln->>'perCopy')::int else 0 end), 0)
          from jsonb_array_elements(q->'lines') ln where (ln->>'unit')::bigint > 0);
  if (q->>'subtotal')::bigint - (q->>'discount')::bigint > 0 then
    pfee := round(((q->>'subtotal')::bigint - (q->>'discount')::bigint) * coalesce((plat->>'feePct')::numeric, 0) / 100) + ntk * coalesce((plat->>'feeFixed')::bigint, 0); end if;
  if is_comp then  -- complimentary: real ticket type + face value kept, $0 collected
    if not manual then raise exception 'not allowed'; end if;
    foreach x in array ev_ids::text[] loop if not has_perm(bo.id, 'tickets.comps', x::uuid) then raise exception 'You don''t have permission to issue complimentary tickets'; end if; end loop;
    q := q || jsonb_build_object('lines', (select coalesce(jsonb_agg(ln || '{"unit":0,"fee":0,"unitFee":0,"comp":true}'::jsonb order by o), '[]') from jsonb_array_elements(q->'lines') with ordinality z(ln, o)),
      'subtotal', 0, 'discount', 0, 'feeDiscount', 0, 'fee', 0, 'tax', 0, 'donation', 0, 'total', 0);
    pfee := 0;
  end if;
  total := (q->>'total')::bigint;
  if total > 0 and not manual and coalesce(p->>'payment','') <> 'offline' then raise exception 'Card payments are not connected yet'; end if;
  status := case when total = 0 or manual then 'paid' else 'pending' end;
  loop oref := 'SET-' || rand_code(6); exit when not exists(select 1 from orders where ref = oref); end loop;
  insert into orders(box_office_id, ref, status, buyer_email, event_ids, data) values (bo.id, oref, status, email, ev_ids,
    jsonb_build_object('buyer', p->'buyer', 'lines', q->'lines', 'subtotal', q->'subtotal', 'discount', q->'discount', 'feeDiscount', q->'feeDiscount', 'fee', q->'fee', 'tax', q->'tax',
      'donation', q->'donation', 'total', total, 'faceValue', q->'faceValue', 'code', promo->>'code', 'promo', case when promo is null then null else jsonb_build_object('id', promo->>'id', 'code', promo_code) end,
      'tracking', tracking, 'payment', case when total = 0 then 'free' else p->>'payment' end, 'answers', coalesce(p->'answers','{}'), 'optIn', coalesce((p->>'optIn')::boolean, false),
      'source', p->>'source', 'currency', q->'currency', 'platformFee', pfee) || case when is_comp then '{"comp":true}'::jsonb else '{}'::jsonb end)
    returning id, access_key into oid, okey;

  -- Every ticket keeps: real ticket type, face value, amount collected, its discount + code, comp, tracking code, products and package.
  by_ := coalesce(nullif(me_email(), ''), email);
  for l in select v from jsonb_array_elements(q->'lines') with ordinality z(v, o) order by o loop
    extras := (select coalesce(jsonb_agg((a->>'name') || ' × ' || (a->>'qty') order by o), '[]') from jsonb_array_elements(q->'lines') with ordinality z(a, o) where a->>'kind' = 'addon' and a->>'eventId' = l->>'eventId');
    if l->>'kind' = 'ticket' then
      adm := (l->>'admits')::int;
      for u in 0 .. (l->>'qty')::int - 1 loop
        d := coalesce((l->'discs'->>u)::bigint, 0);
        fs := spread((l->>'face')::bigint, array_fill(1::bigint, array[adm])); ps := spread((l->>'unit')::bigint - d, array_fill(1::bigint, array[adm])); ds := spread(d, array_fill(1::bigint, array[adm]));
        for j in 1 .. adm loop
          perform issue_ticket(bo.id, oid, oref, l, l->>'ticketTypeId', l->'seats'->>(u * adm + j - 1), fs[j], ps[j], ds[j], promo->>'code', tracking, null, extras, is_comp, p->'buyer'->>'name', by_);
        end loop;
      end loop;
    elsif l->>'kind' = 'bundle' then  -- the package price is shared over its tickets and products by their normal prices
      per := (l->>'perCopy')::int;
      for c in 0 .. (l->>'qty')::int - 1 loop
        w := array(select x2::bigint from jsonb_array_elements_text(l->'tfaces') with ordinality z(x2, o) where o > c * per and o <= (c + 1) * per order by o)
          || array(select (a->>'face')::bigint * (a->>'qty')::int from jsonb_array_elements(l->'addons') with ordinality z(a, o) order by o);
        d := coalesce((l->'discs'->>c)::bigint, 0); ps := spread((l->>'unit')::bigint - d, w); ds := spread(d, w);
        for j in 1 .. per loop
          perform issue_ticket(bo.id, oid, oref, l, l->'tts'->>(c * per + j - 1), l->'seats'->>(c * per + j - 1), w[j], ps[j], ds[j], promo->>'code', tracking,
            jsonb_build_object('id', l->>'bundleId', 'name', l->>'name', 'n', c + 1),
            extras || coalesce((select jsonb_agg((a->>'name') || ' × ' || (a->>'qty') || ' (in ' || (l->>'name') || ')' order by o) from jsonb_array_elements(l->'addons') with ordinality z(a, o)), '[]'),
            is_comp, p->'buyer'->>'name', by_);
        end loop;
      end loop;
    end if;
    -- seats sold out of a checkout hold, or a staff hold, leave the hold list
    if jsonb_array_length(coalesce(l->'seats','[]')) > 0 then
      delete from seat_status where event_id = (l->>'eventId')::uuid and slot_id in (coalesce(l->>'slotId',''), '') and (l->'seats') ? seat_status.seat
        and (seat_status.status = 'checkout' or (manual and seat_status.status = 'held'));
    end if;
  end loop;
  if tok is not null then delete from seat_status y where y.status = 'checkout' and y.token = tok; end if;
  return jsonb_build_object('id', oid, 'key', okey, 'ref', oref);
end $$;

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
create or replace function checkin(p_code text, p_undo boolean default false, p_event uuid default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare t tickets%rowtype; was timestamptz;
begin
  select * into t from tickets where code = upper(trim(p_code));
  if not found or not is_member(t.box_office_id) then return jsonb_build_object('result','unknown'); end if;
  if not has_perm(t.box_office_id, case when p_undo then 'door.undo' else 'door.checkin' end, t.event_id) then raise exception 'You don''t have permission to do that'; end if;
  if t.status <> 'valid' then return jsonb_build_object('result','cancelled','ticket',to_jsonb(t)); end if;
  if p_event is not null and t.event_id <> p_event then return jsonb_build_object('result','wrong_event','ticket',to_jsonb(t)); end if;
  was := t.checked_in_at;
  update tickets set checked_in_at = case when p_undo then null else coalesce(checked_in_at, now()) end where id = t.id returning * into t;
  if p_undo then perform log_action(t.box_office_id, 'door.undo', 'Undid check-in for ticket ' || t.code, null, null, t.event_id); end if;
  return jsonb_build_object('result', case when p_undo then 'undone' when was is not null then 'already' else 'ok' end, 'ticket', to_jsonb(t));
end $$;

-- Everything the back office needs for ONE box office, already filtered to the member's events and masked
-- by their customer-data / finance permissions. Mirrors DB.loadAdmin() in data.js.
create or replace function admin_load(p_bo uuid default null, p_support boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare em text := me_email(); sup boolean := is_super(); b box_offices%rowtype; m members%rowtype; me jsonb; bos jsonb; evs uuid[];
  P_names boolean; P_emails boolean; P_phones boolean; P_money boolean; seeorders boolean; res jsonb;
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
    return res || jsonb_build_object('needs2fa', true, 'events', '[]'::jsonb, 'orders', '[]'::jsonb, 'tickets', '[]'::jsonb, 'waitlist', '[]'::jsonb, 'team', jsonb_build_array(me), 'broadcasts', '[]'::jsonb, 'audit', '[]'::jsonb, 'seatStatus', '[]'::jsonb, 'seatLog', '[]'::jsonb, 'promos', '[]'::jsonb, 'tracking', '[]'::jsonb); end if;
  select coalesce(array_agg(e.id), '{}') into evs from events e where e.box_office_id = b.id and (has_perm(b.id, 'events.view', e.id) or has_perm(b.id, 'door.scan', e.id));
  P_names := has_perm(b.id, 'customers.names'); P_emails := has_perm(b.id, 'customers.emails'); P_phones := has_perm(b.id, 'customers.phones'); P_money := has_perm(b.id, 'finance.totals');
  seeorders := has_perm(b.id, 'orders.view') or P_money or has_perm(b.id, 'finance.reports') or has_perm(b.id, 'comms.lists') or has_perm(b.id, 'customers.profiles');
  return res || jsonb_build_object(
    'events', coalesce((select jsonb_agg(to_jsonb(e)) from events e where e.id = any(evs)), '[]'),
    'orders', case when not seeorders then '[]'::jsonb else coalesce((select jsonb_agg(
        (to_jsonb(o) - 'access_key')
        || jsonb_build_object('buyer_email', case when P_emails then o.buyer_email else regexp_replace(o.buyer_email, '^(.)[^@]*@(.)[^.]*(\..+)$', '\1•••@\2•••\3') end)
        || jsonb_build_object('data', (case when P_money then o.data else o.data - 'subtotal' - 'discount' - 'feeDiscount' - 'fee' - 'tax' - 'donation' - 'total' - 'faceValue' - 'platformFee'
               || jsonb_build_object('lines', (select coalesce(jsonb_agg((l - 'face' - 'value' - 'tfaces' - 'discs' - 'feeDiscs' - 'disc' - 'feeDisc' - 'fee' - 'unitFee') || '{"unit":null}'::jsonb order by k), '[]')
                  from jsonb_array_elements(o.data->'lines') with ordinality z(l, k))) end)
             || jsonb_build_object('buyer', (o.data->'buyer')
               || case when P_names then '{}'::jsonb else '{"name":"Guest"}'::jsonb end
               || case when P_emails then '{}'::jsonb else jsonb_build_object('email', regexp_replace(o.buyer_email, '^(.)[^@]*@(.)[^.]*(\..+)$', '\1•••@\2•••\3')) end
               || case when P_phones or coalesce(o.data->'buyer'->>'phone','') = '' then '{}'::jsonb else '{"phone":"•••"}'::jsonb end)))
      from orders o where o.box_office_id = b.id and o.event_ids && evs), '[]') end,
    'tickets', coalesce((select jsonb_agg(to_jsonb(t) || case when P_names then '{}'::jsonb else '{"holder":"Guest"}'::jsonb end
        || case when P_money then '{}'::jsonb else '{"face":null,"paid":null,"discount":null}'::jsonb end) from tickets t where t.event_id = any(evs)), '[]'),
    'promos', case when has_perm(b.id, 'tickets.discounts') or has_perm(b.id, 'tickets.discountsEdit') or has_perm(b.id, 'finance.reports') then coalesce((select jsonb_agg(x.data
        || jsonb_build_object('id', x.id, 'box_office_id', x.box_office_id, 'code', x.code, 'created_at', x.created_at, 'created_by', x.created_by) order by x.created_at) from promos x where x.box_office_id = b.id), '[]') else '[]' end,
    'tracking', case when has_perm(b.id, 'tickets.tracking') or has_perm(b.id, 'finance.reports') then coalesce((select jsonb_agg(x.data
        || jsonb_build_object('id', x.id, 'box_office_id', x.box_office_id, 'code', x.code, 'created_at', x.created_at) order by x.created_at) from tracking_codes x where x.box_office_id = b.id), '[]') else '[]' end,
    'waitlist', case when has_perm(b.id, 'orders.view') or has_perm(b.id, 'comms.lists') then coalesce((select jsonb_agg(to_jsonb(w)) from waitlist w where w.event_id = any(evs)), '[]') else '[]' end,
    'team', case when has_perm(b.id, 'admin.invite') or has_perm(b.id, 'admin.perms') or has_perm(b.id, 'admin.remove')
      then coalesce((select jsonb_agg(to_jsonb(x) - 'all_events' - 'event_ids' || jsonb_build_object('owner', x.email = b.owner, 'events', case when x.all_events then to_jsonb('all'::text) else to_jsonb(x.event_ids) end))
        from members x where x.box_office_id = b.id and x.status = 'active'), '[]') else jsonb_build_array(me) end,
    'broadcasts', coalesce((select jsonb_agg(to_jsonb(x)) from broadcasts x where x.event_id = any(evs) and (has_perm(b.id, 'comms.email') or has_perm(b.id, 'comms.notify'))), '[]'),
    'audit', coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc) from (select * from audit_log a where a.box_office_id = b.id
        and (has_perm(b.id, 'admin.perms') or a.actor = em or (a.target is not null and has_perm(b.id, 'events.edit', a.target))) order by a.at desc limit 1500) a), '[]'),
    'seatStatus', coalesce((select jsonb_agg(to_jsonb(x) - 'token') from seat_status x where x.event_id = any(evs)
        and not (x.status = 'checkout' and x.expires_at <= now())), '[]'),
    'seatLog', case when has_perm(b.id, 'seating.view') then coalesce((select jsonb_agg(to_jsonb(l) order by l.at desc) from (select * from seat_log l
        where l.event_id = any(evs) order by l.at desc limit 8000) l), '[]') else '[]' end,
    'views', coalesce((select jsonb_object_agg(v.event_id, jsonb_build_object('total', v.total, 'unique', v.uniq, 'today', v.today, 'last10m', v.now10, 'bySrc', v.bysrc, 'byRef', coalesce(v.byref, '{}'))) from (
        select event_id, count(*) total, count(distinct visitor) uniq, count(*) filter (where at >= date_trunc('day', now())) today,
          count(distinct visitor) filter (where at >= now() - interval '10 minutes') now10,
          (select jsonb_object_agg(k, c) from (select coalesce(src,'direct') k, count(*) c from event_views x where x.event_id = ev.event_id group by 1) q) bysrc,
          (select jsonb_object_agg(k, jsonb_build_object('views', c, 'unique', u)) from (select ref k, count(*) c, count(distinct visitor) u from event_views x where x.event_id = ev.event_id and ref is not null group by 1) q) byref
        from event_views ev where event_id = any(evs) group by event_id) v), '{}'));
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
  get_order(uuid,uuid), lookup_order(text,text), place_order(jsonb), register_box_office(text,text,text,text),
  event_by_slug(text), track_view(uuid,text,text,text) to anon, authenticated;
grant execute on function save_event_templates(uuid,jsonb), notify_waitlist(uuid,text), seat_action(uuid,text,text,text[],jsonb), save_venues(uuid,jsonb),
  save_promo(uuid,jsonb), delete_promo(uuid,text), save_tracking(uuid,jsonb), delete_tracking(uuid,text) to authenticated;
grant execute on function checkin(text,boolean,uuid), admin_load(uuid,boolean), transfer_ownership(uuid,text), platform_overview(), platform_save(jsonb),
  create_box_office(text,text,text,text), set_box_office_status(uuid,text), delete_box_office(uuid) to authenticated;
revoke execute on function checkin(text,boolean,uuid), admin_load(uuid,boolean), new_box_office(text,text,text,text,text,text), log_action(uuid,text,text,jsonb,jsonb,uuid),
  seat_blocker(uuid,text,text,text,boolean), seat_free(events,text,text,text), single_gaps(events,text,text[],text),
  find_code(uuid,text), promo_usable(jsonb,text,text), tracking_usable(jsonb,uuid,uuid[]), apply_promo(jsonb,jsonb,bigint), price_cart(jsonb,boolean,jsonb,jsonb),
  order_check_tickets(events,jsonb,jsonb,jsonb,int,text[],boolean,text,jsonb), issue_ticket(uuid,uuid,text,jsonb,text,text,bigint,bigint,bigint,text,text,jsonb,jsonb,boolean,text,text),
  code_clash(uuid,text[],text) from anon, authenticated, public;

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
