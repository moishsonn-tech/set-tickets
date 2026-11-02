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
create or replace function events_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare b jsonb := '{}'; a jsonb := '{}'; k text;
begin
  if tg_op = 'INSERT' then perform log_action(new.box_office_id, 'event.created', 'Created event “' || (new.data->>'name') || '”', null, null, new.id); return new; end if;
  if new.box_office_id <> old.box_office_id then raise exception 'Events cannot move between box offices'; end if;
  if (new.status <> old.status or (new.data->'archived') is distinct from (old.data->'archived')) and not has_perm(new.box_office_id, 'events.publish', new.id) then
    raise exception 'You don''t have permission to publish, cancel or archive events'; end if;
  if new.status <> old.status then b := b || jsonb_build_object('Status', old.status); a := a || jsonb_build_object('Status', new.status); end if;
  foreach k in array array['name','start','end','allDay','venue','address','online','capacity','visibility','publishAt','salesStart','salesEnd','archived','waitlistMode','currency','contact','policies','timeSlots'] loop
    if (new.data->k) is distinct from (old.data->k) then b := b || jsonb_build_object(k, old.data->k); a := a || jsonb_build_object(k, new.data->k); end if;
  end loop;
  if (new.data->'ticketTypes') is distinct from (old.data->'ticketTypes') then b := b || jsonb_build_object('ticketTypes', old.data->'ticketTypes'); a := a || jsonb_build_object('ticketTypes', new.data->'ticketTypes'); end if;
  if (new.data->'seating'->'blocked') is distinct from (old.data->'seating'->'blocked') then b := b || jsonb_build_object('Blocked seats', jsonb_array_length(coalesce(old.data->'seating'->'blocked','[]'))); a := a || jsonb_build_object('Blocked seats', jsonb_array_length(coalesce(new.data->'seating'->'blocked','[]'))); end if;
  if (new.data->'seating'->'sections') is distinct from (old.data->'seating'->'sections') then b := b || '{"Seating map":"previous layout"}'; a := a || '{"Seating map":"new layout"}'; end if;
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

create or replace function availability(p_event uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tt',    coalesce((select jsonb_object_agg(k, c) from (select ticket_type_id k, count(*) c from tickets where event_id = p_event and status='valid' group by 1) a), '{}'),
    'slots', coalesce((select jsonb_object_agg(k, c) from (select slot_id k, count(*) c from tickets where event_id = p_event and status='valid' and slot_id is not null group by 1) a), '{}'),
    'seats', coalesce((select jsonb_agg(coalesce(slot_id,'') || '|' || seat) from tickets where event_id = p_event and status='valid' and seat is not null), '[]'),
    'total', (select count(*) from tickets where event_id = p_event and status='valid'));
$$;

create or replace function check_discount(p_event uuid, p_code text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d jsonb; used int;
begin
  select x into d from events e, jsonb_array_elements(e.secrets->'discounts') x
   where e.id = p_event and event_live(e) and upper(x->>'code') = upper(trim(p_code)) limit 1;
  if d is null then return null; end if;
  if nullif(d->>'expires','') is not null and (d->>'expires')::timestamptz < now() then return null; end if;
  select count(*) into used from orders where status in ('paid','pending') and p_event = any(event_ids) and upper(data->>'code') = upper(d->>'code');
  if coalesce((d->>'limit')::int, 0) > 0 and used >= (d->>'limit')::int then return null; end if;
  return d - 'limit';
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
create or replace function track_view(p_event uuid, p_visitor text, p_src text default null) returns void language sql security definer set search_path = public as $$
  insert into event_views(event_id, visitor, src) select p_event, left(p_visitor, 40), left(p_src, 60) from events e where e.id = p_event and event_live(e);
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
  st jsonb; it jsonb; ad jsonb; ev events%rowtype; tt jsonb; slot jsonb; av jsonb; disc jsonb; pw text;
  lines jsonb := '[]'; subtotal bigint := 0; discount bigint := 0; fee bigint := 0; tax bigint := 0; eligible bigint := 0;
  qty int; unit bigint; sold int; oid uuid; okey uuid; oref text; seat text; i int; donation bigint; ev_ids uuid[] := '{}';
  manual boolean := coalesce(p->>'payment','') = 'manual'; status text; total bigint; cur text;
  bo box_offices%rowtype; plat jsonb; pfee bigint := 0; ntk int := 0;
begin
  if coalesce(trim(p->'buyer'->>'name'),'') = '' then raise exception 'Name is required'; end if;
  if coalesce(p->'buyer'->>'email','') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'A valid email is required'; end if;

  for it in select * from jsonb_array_elements(coalesce(p->'items','[]')) loop
    select * into ev from events where id = (it->>'eventId')::uuid;
    if not found or not (event_live(ev) or (manual and ev.status <> 'cancelled')) then raise exception 'Event is not on sale'; end if;
    if bo.id is null then select * into bo from box_offices where id = ev.box_office_id; st := bo.settings;
    elsif bo.id <> ev.box_office_id then raise exception 'One order can only hold one organizer''s events'; end if;
    if bo.status <> 'active' and not manual then raise exception 'This box office is not selling tickets right now'; end if;
    if manual and not has_perm(bo.id, 'orders.edit', ev.id) then raise exception 'You don''t have permission to create orders for %', ev.data->>'name'; end if;
    perform pg_advisory_xact_lock(hashtext(ev.id::text));
    ev_ids := array_append(ev_ids, ev.id);
    cur := coalesce(ev.data->>'currency', st->>'currency', 'USD');
    pw := p->'unlock'->>(ev.id::text);
    if not manual and coalesce(ev.secrets->>'password','') <> '' and coalesce(pw,'') <> ev.secrets->>'password' then raise exception 'This event needs a password'; end if;
    select x into tt from jsonb_array_elements(ev.data->'ticketTypes') x where x->>'id' = it->>'ticketTypeId';
    if tt is null then raise exception 'Unknown ticket type'; end if;
    qty := (it->>'qty')::int;
    if qty is null or qty < 1 then raise exception 'Bad quantity'; end if;
    if not manual then
      if coalesce(ev.secrets->'ticketPasswords'->>(tt->>'id'),'') <> '' and coalesce(pw,'') <> ev.secrets->'ticketPasswords'->>(tt->>'id') then raise exception '% is locked', tt->>'name'; end if;
      if nullif(tt->>'salesStart','') is not null and (tt->>'salesStart')::timestamptz > now() then raise exception '% is not on sale yet', tt->>'name'; end if;
      if nullif(tt->>'salesEnd','') is not null and (tt->>'salesEnd')::timestamptz < now() then raise exception '% sales have ended', tt->>'name'; end if;
      if nullif(ev.data->>'salesEnd','') is not null and (ev.data->>'salesEnd')::timestamptz < now() then raise exception 'Sales have ended'; end if;
      if nullif(ev.data->>'salesStart','') is not null and (ev.data->>'salesStart')::timestamptz > now() then raise exception 'Tickets go on sale %', ev.data->>'salesStart'; end if;
      if qty < coalesce((tt->>'min')::int, 1) then raise exception 'Minimum % for %', tt->>'min', tt->>'name'; end if;
      if coalesce((tt->>'max')::int, 0) > 0 and qty > (tt->>'max')::int then raise exception 'Maximum % for %', tt->>'max', tt->>'name'; end if;
    end if;
    av := availability(ev.id);
    sold := coalesce((av->'tt'->>(tt->>'id'))::int, 0);
    if coalesce((tt->>'qty')::int, 0) > 0 and sold + qty * coalesce((tt->>'admits')::int,1) > (tt->>'qty')::int then raise exception 'Only % % left', greatest((tt->>'qty')::int - sold, 0), tt->>'name'; end if;
    if coalesce((ev.data->>'capacity')::int, 0) > 0 and (av->>'total')::int + qty * coalesce((tt->>'admits')::int,1) > (ev.data->>'capacity')::int then raise exception 'Event is sold out'; end if;
    if nullif(it->>'slotId','') is not null then
      select x into slot from jsonb_array_elements(ev.data->'timeSlots') x where x->>'id' = it->>'slotId';
      if slot is null then raise exception 'Unknown time slot'; end if;
      if not manual and (coalesce((slot->>'hidden')::boolean,false) or coalesce((slot->>'unavailable')::boolean,false) or coalesce((slot->>'soldOut')::boolean,false)) then raise exception 'That showtime is not available'; end if;
      if coalesce((slot->>'capacity')::int,0) > 0 and coalesce((av->'slots'->>(slot->>'id'))::int,0) + qty > (slot->>'capacity')::int then raise exception 'That time slot is full'; end if;
    elsif jsonb_array_length(coalesce(ev.data->'timeSlots','[]')) > 0 then raise exception 'Pick a time slot';
    end if;
    if coalesce((ev.data->'seating'->>'enabled')::boolean, false) then
      if jsonb_array_length(coalesce(it->'seats','[]')) <> qty then raise exception 'Pick % seat(s)', qty; end if;
      for seat in select jsonb_array_elements_text(it->'seats') loop
        if (ev.data->'seating'->'blocked') ? seat or not (coalesce(ev.data->'seating'->'index','{}') ? seat) then raise exception 'Seat % is unavailable', seat; end if;
        if ev.data->'seating'->'index'->>seat <> tt->>'id' then raise exception 'Seat % is not a % seat', seat, tt->>'name'; end if;
        if av->'seats' ? (coalesce(it->>'slotId','') || '|' || seat) then raise exception 'Seat % was just taken', seat; end if;
      end loop;
    end if;
    unit := coalesce((tt->>'price')::bigint, 0);
    subtotal := subtotal + unit * qty; if unit > 0 then ntk := ntk + qty; end if;
    if unit > 0 and coalesce(st->>'feeMode','buyer') = 'buyer' then
      fee := fee + qty * (round(unit * coalesce((st->>'feePct')::numeric,0) / 100) + coalesce((st->>'feeFixed')::bigint,0));
    end if;
    lines := lines || jsonb_build_object('kind','ticket','eventId',ev.id,'eventName',ev.data->>'name','ticketTypeId',tt->>'id','name',tt->>'name',
      'slotId',it->>'slotId','slotStart',slot->>'start','seats',coalesce(it->'seats','[]'),'qty',qty,'unit',unit,'admits',coalesce((tt->>'admits')::int,1),'currency',cur);
    -- discount eligibility
    if coalesce(p->>'code','') <> '' and disc is null then disc := check_discount(ev.id, p->>'code'); end if;
    if disc is not null and (jsonb_array_length(coalesce(disc->'ticketTypeIds','[]')) = 0 or (disc->'ticketTypeIds') ? (tt->>'id')) then eligible := eligible + unit * qty; end if;
    slot := null;
  end loop;

  for ad in select * from jsonb_array_elements(coalesce(p->'addons','[]')) loop
    select * into ev from events where id = (ad->>'eventId')::uuid;
    select x into tt from jsonb_array_elements(ev.data->'addons') x where x->>'id' = ad->>'addonId';
    if tt is null or not (ev.id = any(ev_ids)) then raise exception 'Unknown add-on'; end if;
    qty := (ad->>'qty')::int; if qty < 1 then continue; end if;
    unit := coalesce((tt->>'price')::bigint,0); subtotal := subtotal + unit * qty;
    lines := lines || jsonb_build_object('kind','addon','eventId',ev.id,'addonId',tt->>'id','name',tt->>'name','qty',qty,'unit',unit);
  end loop;

  if jsonb_array_length(lines) = 0 then raise exception 'Your cart is empty'; end if;
  if coalesce(p->>'code','') <> '' and disc is null then raise exception 'That discount code is not valid'; end if;
  if disc is not null then
    discount := case when disc->>'type' = 'pct' then round(eligible * (disc->>'amount')::numeric / 100) else least((disc->>'amount')::bigint, eligible) end;
  end if;
  tax := round((subtotal - discount) * coalesce((st->>'taxPct')::numeric, 0) / 100);
  donation := greatest(coalesce((p->>'donation')::bigint, 0), 0);
  total := subtotal - discount + fee + tax + donation;
  if coalesce((p->>'comp')::boolean, false) then  -- complimentary: real ticket type + face value kept, $0 collected
    if not manual then raise exception 'not allowed'; end if;
    for it in select * from jsonb_array_elements(lines) where value->>'kind' = 'ticket' loop
      if not has_perm(bo.id, 'tickets.comps', (it->>'eventId')::uuid) then raise exception 'You don''t have permission to issue complimentary tickets'; end if; end loop;
    select coalesce(jsonb_agg(l || jsonb_build_object('face', l->'unit', 'unit', 0, 'comp', true)), '[]') into lines from jsonb_array_elements(lines) l;
    p := p || jsonb_build_object('faceValue', subtotal); subtotal := 0; discount := 0; fee := 0; tax := 0; donation := 0; total := 0;
  end if;
  status := case when total = 0 or manual then 'paid' else 'pending' end;
  if total > 0 and not manual and coalesce(p->>'payment','') <> 'offline' then raise exception 'Card payments are not connected yet'; end if;

  select data into plat from platform_settings where id = 1;
  if subtotal - discount > 0 then pfee := round((subtotal - discount) * coalesce((plat->>'feePct')::numeric, 0) / 100) + ntk * coalesce((plat->>'feeFixed')::bigint, 0); end if;
  loop oref := 'SET-' || rand_code(6); exit when not exists(select 1 from orders where ref = oref); end loop;
  insert into orders(box_office_id, ref, status, buyer_email, event_ids, data) values (bo.id, oref, status, lower(trim(p->'buyer'->>'email')), ev_ids,
    jsonb_build_object('buyer', p->'buyer', 'lines', lines, 'subtotal', subtotal, 'discount', discount, 'fee', fee, 'tax', tax, 'donation', donation,
      'total', total, 'code', case when disc is null then null else disc->>'code' end, 'payment', coalesce(p->>'payment','free'),
      'answers', coalesce(p->'answers','{}'), 'optIn', coalesce((p->>'optIn')::boolean,false), 'source', p->>'source', 'currency', cur, 'platformFee', pfee)
      || case when coalesce((p->>'comp')::boolean,false) then jsonb_build_object('comp', true, 'faceValue', (p->>'faceValue')::bigint) else '{}'::jsonb end)
    returning id, access_key into oid, okey;

  for it in select * from jsonb_array_elements(lines) where value->>'kind' = 'ticket' loop
    for i in 1 .. ((it->>'qty')::int * (it->>'admits')::int) loop
      insert into tickets(box_office_id, order_id, event_id, ticket_type_id, slot_id, seat, code, holder)
      values (bo.id, oid, (it->>'eventId')::uuid, it->>'ticketTypeId', nullif(it->>'slotId',''),
              case when jsonb_array_length(it->'seats') >= i then it->'seats'->>(i-1) end, rand_code(10), p->'buyer'->>'name');
    end loop;
  end loop;
  return jsonb_build_object('id', oid, 'key', okey, 'ref', oref);
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
    return res || jsonb_build_object('needs2fa', true, 'events', '[]'::jsonb, 'orders', '[]'::jsonb, 'tickets', '[]'::jsonb, 'waitlist', '[]'::jsonb, 'team', jsonb_build_array(me), 'broadcasts', '[]'::jsonb, 'audit', '[]'::jsonb); end if;
  select coalesce(array_agg(e.id), '{}') into evs from events e where e.box_office_id = b.id and (has_perm(b.id, 'events.view', e.id) or has_perm(b.id, 'door.scan', e.id));
  P_names := has_perm(b.id, 'customers.names'); P_emails := has_perm(b.id, 'customers.emails'); P_phones := has_perm(b.id, 'customers.phones'); P_money := has_perm(b.id, 'finance.totals');
  seeorders := has_perm(b.id, 'orders.view') or P_money or has_perm(b.id, 'finance.reports') or has_perm(b.id, 'comms.lists') or has_perm(b.id, 'customers.profiles');
  return res || jsonb_build_object(
    'events', coalesce((select jsonb_agg(to_jsonb(e)) from events e where e.id = any(evs)), '[]'),
    'orders', case when not seeorders then '[]'::jsonb else coalesce((select jsonb_agg(
        (to_jsonb(o) - 'access_key')
        || jsonb_build_object('buyer_email', case when P_emails then o.buyer_email else regexp_replace(o.buyer_email, '^(.)[^@]*@(.)[^.]*(\..+)$', '\1•••@\2•••\3') end)
        || jsonb_build_object('data', (case when P_money then o.data else o.data - 'subtotal' - 'discount' - 'fee' - 'tax' - 'donation' - 'total' - 'platformFee' end)
             || jsonb_build_object('buyer', (o.data->'buyer')
               || case when P_names then '{}'::jsonb else '{"name":"Guest"}'::jsonb end
               || case when P_emails then '{}'::jsonb else jsonb_build_object('email', regexp_replace(o.buyer_email, '^(.)[^@]*@(.)[^.]*(\..+)$', '\1•••@\2•••\3')) end
               || case when P_phones or coalesce(o.data->'buyer'->>'phone','') = '' then '{}'::jsonb else '{"phone":"•••"}'::jsonb end)))
      ) from orders o where o.box_office_id = b.id and o.event_ids && evs), '[]') end,
    'tickets', coalesce((select jsonb_agg(to_jsonb(t) || case when P_names then '{}'::jsonb else '{"holder":"Guest"}'::jsonb end) from tickets t where t.event_id = any(evs)), '[]'),
    'waitlist', case when has_perm(b.id, 'orders.view') or has_perm(b.id, 'comms.lists') then coalesce((select jsonb_agg(to_jsonb(w)) from waitlist w where w.event_id = any(evs)), '[]') else '[]' end,
    'team', case when has_perm(b.id, 'admin.invite') or has_perm(b.id, 'admin.perms') or has_perm(b.id, 'admin.remove')
      then coalesce((select jsonb_agg(to_jsonb(x) - 'all_events' - 'event_ids' || jsonb_build_object('owner', x.email = b.owner, 'events', case when x.all_events then to_jsonb('all'::text) else to_jsonb(x.event_ids) end))
        from members x where x.box_office_id = b.id and x.status = 'active'), '[]') else jsonb_build_array(me) end,
    'broadcasts', coalesce((select jsonb_agg(to_jsonb(x)) from broadcasts x where x.event_id = any(evs) and (has_perm(b.id, 'comms.email') or has_perm(b.id, 'comms.notify'))), '[]'),
    'audit', coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc) from (select * from audit_log a where a.box_office_id = b.id
        and (has_perm(b.id, 'admin.perms') or a.actor = em or (a.target is not null and has_perm(b.id, 'events.edit', a.target))) order by a.at desc limit 1500) a), '[]'),
    'views', coalesce((select jsonb_object_agg(v.event_id, jsonb_build_object('total', v.total, 'unique', v.uniq, 'today', v.today, 'last10m', v.now10, 'bySrc', v.bysrc)) from (
        select event_id, count(*) total, count(distinct visitor) uniq, count(*) filter (where at >= date_trunc('day', now())) today,
          count(distinct visitor) filter (where at >= now() - interval '10 minutes') now10,
          (select jsonb_object_agg(k, c) from (select coalesce(src,'direct') k, count(*) c from event_views x where x.event_id = ev.event_id group by 1) q) bysrc
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

grant execute on function availability(uuid), check_discount(uuid,text), unlock(uuid,text), join_waitlist(uuid,text,text,text),
  get_order(uuid,uuid), lookup_order(text,text), place_order(jsonb), register_box_office(text,text,text,text),
  event_by_slug(text), track_view(uuid,text,text) to anon, authenticated;
grant execute on function save_event_templates(uuid,jsonb), notify_waitlist(uuid,text) to authenticated;
grant execute on function checkin(text,boolean,uuid), admin_load(uuid,boolean), transfer_ownership(uuid,text), platform_overview(), platform_save(jsonb),
  create_box_office(text,text,text,text), set_box_office_status(uuid,text), delete_box_office(uuid) to authenticated;
revoke execute on function checkin(text,boolean,uuid), admin_load(uuid,boolean), new_box_office(text,text,text,text,text,text), log_action(uuid,text,text,jsonb,jsonb) from anon, public;

-- First platform owner. Create box offices from #/platform after signing in.
insert into platform_admins(email) values ('moishsonn@gmail.com') on conflict do nothing;
