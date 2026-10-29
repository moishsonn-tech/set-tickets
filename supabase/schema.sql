-- SET Tickets — Supabase schema. Apply once in a NEW Supabase project (SQL editor or Management API).
-- Security model:
--   * Anyone may read published events (public `data` column only; `secrets` is never granted to anon).
--   * Buyers never write tables directly: orders go through place_order(), which re-prices every line,
--     enforces inventory/time-slot/seat capacity under a per-event lock, and validates discount codes.
--   * Organizers are rows in `team` (matched by verified auth email). RLS gives them full access.

create extension if not exists pgcrypto;

create table if not exists settings (id int primary key default 1 check (id = 1), data jsonb not null default '{}');
insert into settings (id, data) values (1, '{"name":"SING Entertainment","currency":"USD","feePct":0,"feeFixed":0,"feeMode":"buyer","taxPct":0}')
  on conflict (id) do nothing;

create table if not exists team (email text primary key, role text not null check (role in ('admin','event_manager','order_manager','overview')), name text, created_at timestamptz default now());

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  status text not null default 'draft' check (status in ('draft','published','cancelled')),
  data jsonb not null default '{}',          -- everything a buyer may see
  secrets jsonb not null default '{}',       -- {password, ticketPasswords:{ttId:pw}, discounts:[...]}
  created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null,
  access_key uuid not null default gen_random_uuid(),
  status text not null check (status in ('paid','pending','cancelled','refunded')),
  buyer_email text not null,
  event_ids uuid[] not null,
  data jsonb not null,
  created_at timestamptz default now());

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  ticket_type_id text not null, slot_id text, seat text,
  code text unique not null, holder text,
  status text not null default 'valid' check (status in ('valid','cancelled')),
  checked_in_at timestamptz);
create index if not exists tickets_event on tickets(event_id);
create unique index if not exists tickets_seat on tickets(event_id, coalesce(slot_id,''), seat) where seat is not null and status = 'valid';

create table if not exists waitlist (id uuid primary key default gen_random_uuid(), event_id uuid references events(id) on delete cascade,
  name text, email text not null, created_at timestamptz default now());
create table if not exists broadcasts (id uuid primary key default gen_random_uuid(), event_id uuid references events(id) on delete cascade,
  subject text, body text, recipients int, created_by text, created_at timestamptz default now());

-- ── Auth helpers ───────────────────────────────────────────────────────────────
create or replace function team_role() returns text language sql stable security definer set search_path = public as
$$ select role from team where lower(email) = lower(auth.jwt() ->> 'email') $$;
create or replace function is_team() returns boolean language sql stable as $$ select team_role() is not null $$;
create or replace function can_edit_events() returns boolean language sql stable as $$ select team_role() in ('admin','event_manager') $$;
create or replace function can_edit_orders() returns boolean language sql stable as $$ select team_role() in ('admin','order_manager','event_manager') $$;

alter table settings enable row level security; alter table team enable row level security;
alter table events enable row level security;   alter table orders enable row level security;
alter table tickets enable row level security;  alter table waitlist enable row level security;
alter table broadcasts enable row level security;

create policy settings_read on settings for select using (true);
create policy settings_write on settings for update using (team_role() = 'admin');
create policy team_read on team for select using (is_team());
create policy team_write on team for all using (team_role() = 'admin') with check (team_role() = 'admin');
create policy events_public on events for select using (status = 'published' or is_team());
create policy events_write on events for all using (can_edit_events()) with check (can_edit_events());
create policy orders_team on orders for select using (is_team());
create policy orders_write on orders for update using (can_edit_orders());
create policy tickets_team on tickets for select using (is_team());
create policy tickets_write on tickets for update using (is_team());
create policy waitlist_team on waitlist for all using (is_team());
create policy broadcasts_team on broadcasts for all using (is_team()) with check (is_team());

-- Buyers never see secrets: column-level grant on events for anon.
revoke select on events from anon;
grant select (id, slug, status, data, created_at, updated_at) on events to anon;

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
   where e.id = p_event and e.status='published' and upper(x->>'code') = upper(trim(p_code)) limit 1;
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
  from events where id = p_event and status = 'published';
$$;

create or replace function join_waitlist(p_event uuid, p_name text, p_email text) returns void language sql security definer set search_path = public as $$
  insert into waitlist(event_id, name, email) select p_event, left(p_name,120), left(lower(trim(p_email)),200)
  where exists(select 1 from events where id = p_event and status='published') and p_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$';
$$;

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
begin
  if manual and not can_edit_orders() then raise exception 'not allowed'; end if;
  if coalesce(trim(p->'buyer'->>'name'),'') = '' then raise exception 'Name is required'; end if;
  if coalesce(p->'buyer'->>'email','') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'A valid email is required'; end if;
  select data into st from settings where id = 1;

  for it in select * from jsonb_array_elements(coalesce(p->'items','[]')) loop
    select * into ev from events where id = (it->>'eventId')::uuid and (status = 'published' or manual);
    if not found then raise exception 'Event is not on sale'; end if;
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
      if coalesce((slot->>'capacity')::int,0) > 0 and coalesce((av->'slots'->>(slot->>'id'))::int,0) + qty > (slot->>'capacity')::int then raise exception 'That time slot is full'; end if;
    elsif jsonb_array_length(coalesce(ev.data->'timeSlots','[]')) > 0 then raise exception 'Pick a time slot';
    end if;
    if coalesce((ev.data->'seating'->>'enabled')::boolean, false) then
      if jsonb_array_length(coalesce(it->'seats','[]')) <> qty then raise exception 'Pick % seat(s)', qty; end if;
      for seat in select jsonb_array_elements_text(it->'seats') loop
        if (ev.data->'seating'->'blocked') ? seat then raise exception 'Seat % is unavailable', seat; end if;
        if av->'seats' ? (coalesce(it->>'slotId','') || '|' || seat) then raise exception 'Seat % was just taken', seat; end if;
      end loop;
    end if;
    unit := coalesce((tt->>'price')::bigint, 0);
    subtotal := subtotal + unit * qty;
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
  status := case when total = 0 or manual then 'paid' else 'pending' end;
  if total > 0 and not manual and coalesce(p->>'payment','') <> 'offline' then raise exception 'Card payments are not connected yet'; end if;

  loop oref := 'SET-' || rand_code(6); exit when not exists(select 1 from orders where ref = oref); end loop;
  insert into orders(ref, status, buyer_email, event_ids, data) values (oref, status, lower(trim(p->'buyer'->>'email')), ev_ids,
    jsonb_build_object('buyer', p->'buyer', 'lines', lines, 'subtotal', subtotal, 'discount', discount, 'fee', fee, 'tax', tax, 'donation', donation,
      'total', total, 'code', case when disc is null then null else disc->>'code' end, 'payment', coalesce(p->>'payment','free'),
      'answers', coalesce(p->'answers','{}'), 'optIn', coalesce((p->>'optIn')::boolean,false), 'source', p->>'source', 'currency', cur))
    returning id, access_key into oid, okey;

  for it in select * from jsonb_array_elements(lines) where value->>'kind' = 'ticket' loop
    for i in 1 .. ((it->>'qty')::int * (it->>'admits')::int) loop
      insert into tickets(order_id, event_id, ticket_type_id, slot_id, seat, code, holder)
      values (oid, (it->>'eventId')::uuid, it->>'ticketTypeId', nullif(it->>'slotId',''),
              case when jsonb_array_length(it->'seats') >= i then it->'seats'->>(i-1) end, rand_code(10), p->'buyer'->>'name');
    end loop;
  end loop;
  return jsonb_build_object('id', oid, 'key', okey, 'ref', oref);
end $$;

-- Door check-in by QR code (team only). Returns the ticket + whether it was already scanned.
create or replace function checkin(p_code text, p_undo boolean default false, p_event uuid default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare t tickets%rowtype; was timestamptz;
begin
  if not is_team() then raise exception 'not allowed'; end if;
  select * into t from tickets where code = upper(trim(p_code));
  if not found then return jsonb_build_object('result','unknown'); end if;
  if t.status <> 'valid' then return jsonb_build_object('result','cancelled','ticket',to_jsonb(t)); end if;
  if p_event is not null and t.event_id <> p_event then return jsonb_build_object('result','wrong_event','ticket',to_jsonb(t)); end if;
  was := t.checked_in_at;
  update tickets set checked_in_at = case when p_undo then null else coalesce(checked_in_at, now()) end where id = t.id returning * into t;
  return jsonb_build_object('result', case when p_undo then 'undone' when was is not null then 'already' else 'ok' end, 'ticket', to_jsonb(t));
end $$;

grant execute on function availability(uuid), check_discount(uuid,text), unlock(uuid,text), join_waitlist(uuid,text,text),
  get_order(uuid,uuid), lookup_order(text,text), place_order(jsonb) to anon, authenticated;
grant execute on function checkin(text,boolean,uuid) to authenticated;
revoke execute on function checkin(text,boolean,uuid) from anon;

-- First organizer (owner). Add more from the app's Team page.
insert into team(email, role, name) values ('moishsonn@gmail.com', 'admin', 'Owner') on conflict do nothing;
