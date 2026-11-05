-- Database end-to-end checks: runs supabase/schema.sql's rules for real on Postgres (not the browser demo).
-- Run:  bash tests/db-e2e.sh   (needs a local Postgres — see the script). Prints PASS / FAIL per check.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
create schema t; grant usage on schema t to public;
create table t.results (n serial primary key, ok boolean, msg text); grant all on t.results to public; grant all on sequence t.results_n_seq to public;
create function t.ok(c boolean, m text) returns void language sql as $$ insert into t.results(ok, msg) values (coalesce(c, false), m) $$;
create function t.err(q text, pat text, m text) returns void language plpgsql as $$
declare e text;
begin
  begin execute q; insert into t.results(ok, msg) values (false, m || ' (no error)');
  exception when others then e := sqlerrm; insert into t.results(ok, msg) values (e ~* pat, m || ' [' || e || ']'); end;
end $$;
create function t.who(p_email text) returns void language sql security definer as $$
  select set_config('request.jwt.claims', case when p_email = '' then '{}' else json_build_object('email', p_email, 'sub', (select id from auth.users where email = p_email))::text end, false) $$;
grant execute on all functions in schema t to public;
-- Stage 10 locked these tables (the app reads them only through admin_load / RPCs); the checks below read them through these owner views
create view t.orders as select * from public.orders;
create view t.tickets as select * from public.tickets;
create view t.order_log as select * from public.order_log;
create view t.credits as select * from public.credits;
create view t.customer_notes as select * from public.customer_notes;
create view t.waitlist as select * from public.waitlist;
create view t.outbox as select * from public.outbox;
create view t.event_views as select * from public.event_views;
create view t.seat_log as select * from public.seat_log;
create view t.promos as select * from public.promos;
create view t.tracking_codes as select * from public.tracking_codes;
create view t.broadcasts as select * from public.broadcasts;
create view t.payment_accounts as select * from public.payment_accounts;
create view t.versions_v as select * from public.versions; create view t.support_v as select * from public.support_messages; create view t.bans_v as select * from public.bans;
grant select on all tables in schema t to public;
\o /dev/null

-- ── set-up: one box office (owner, a clerk who may change seats but not refund), a seated event and a general-admission event ──
insert into auth.users(email, email_confirmed_at) values ('owner@box.test', now()), ('clerk@box.test', now()), ('fan@mail.test', now()), ('other@mail.test', now());
insert into platform_admins(email) values ('root@platform.test'); select t.who('root@platform.test');   -- set-up runs as a platform super admin
insert into box_offices(id, slug, name, status, owner, settings, gateway) values ('b0000000-0000-0000-0000-000000000001', 'test-box', 'Test Box', 'active', 'owner@box.test',
  '{"currency":"USD","feeMode":"buyer","feePct":0,"feeFixed":100,"taxPct":0,"payments":{"card":true,"offline":true}}', '{"provider":"stripe","status":"connected","test":true}');
insert into payment_accounts(box_office_id, provider, account, status) values ('b0000000-0000-0000-0000-000000000001', 'stripe', 'acct_test', 'connected');
insert into members(box_office_id, email, name, perms) values ('b0000000-0000-0000-0000-000000000001', 'owner@box.test', 'Owner', '{}'),
  ('b0000000-0000-0000-0000-000000000001', 'clerk@box.test', 'Clerk', '{orders.view,orders.seats,orders.customer,customers.names,customers.emails,customers.phones}');
insert into events(id, box_office_id, slug, status, data) values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'seated-show', 'published', '{
  "name":"Seated Show","start":"2099-01-01T20:00:00Z","currency":"USD","visibility":"public","timeSlots":[],
  "ticketTypes":[{"id":"std","name":"Standard","price":5000,"qty":0,"admits":1},{"id":"vip","name":"VIP","price":10000,"qty":0,"admits":1}],
  "addons":[{"id":"park","name":"Parking","price":1000,"qty":5,"standalone":false}],
  "seating":{"enabled":true,"noSingles":false,
    "index":{"A-1":"std","A-2":"std","A-3":"std","A-4":"std","A-5":"std","B-1":"vip","B-2":"vip"},
    "meta":{"A-1":["Stalls","A","1"],"A-2":["Stalls","A","2"],"A-3":["Stalls","A","3"],"A-4":["Stalls","A","4"],"A-5":["Stalls","A","5"],"B-1":["Front","B","1"],"B-2":["Front","B","2"]},
    "rows":{}}}'),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'ga-party', 'published', '{
  "name":"GA Party","start":"2099-02-01T20:00:00Z","currency":"USD","visibility":"public","timeSlots":[],
  "ticketTypes":[{"id":"ga","name":"General","price":2000,"qty":100,"admits":1},{"id":"early","name":"Early","price":1500,"qty":1,"admits":1}],"addons":[]}');

select t.who('');
-- ── buyers (anon): a pay-later reservation and a card checkout ──
set role anon; select t.who('');
select place_order('{"buyer":{"name":"Fan One","email":"fan@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000001","ticketTypeId":"std","qty":2,"seats":["A-1","A-2"]}],"payment":"offline"}')->>'id' as o1 \gset
select place_order('{"buyer":{"name":"Card Fan","email":"card@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000001","ticketTypeId":"std","qty":2,"seats":["A-3","A-4"]}],"addons":[{"eventId":"e0000000-0000-0000-0000-000000000001","addonId":"park","qty":1}],"payment":"card"}') as r2 \gset
select t.ok((:'r2'::jsonb)->>'status' = 'awaiting_payment', 'card checkout waits for the processor');
select t.err($$update orders set status = 'cancelled'$$, 'permission denied', 'a buyer cannot write orders directly');
select t.err($$select order_action('$$ || :'o1' || $$', 'markPaid', '{}')$$, 'permission denied|not found', 'a buyer cannot run staff order actions');
reset role;
set role service_role;
select t.ok(confirm_payment(((:'r2'::jsonb)->>'id')::uuid, json_build_object('amount', (select (data->>'total')::bigint from t.orders where id = ((:'r2'::jsonb)->>'id')::uuid), 'ref', 'pi_test_1', 'provider', 'stripe')::jsonb) = 'issued', 'processor confirms the card payment → tickets issued');
reset role;
select t.ok((select count(*) from t.tickets where order_id = ((:'r2'::jsonb)->>'id')::uuid and status = 'valid') = 2, 'card order has its 2 tickets');

-- ── staff: direct writes are blocked; everything goes through order_action ──
set role authenticated; select t.who('clerk@box.test');
select t.err($$update orders set status = 'cancelled' where id = '$$ || :'o1' || $$'$$, 'permission denied', 'staff cannot update orders directly');
select t.err($$update tickets set status = 'cancelled'$$, 'permission denied', 'staff cannot update tickets directly');
select t.err($$select order_action('$$ || :'o1' || $$', 'markPaid', '{}')$$, 'permission', 'clerk without orders.edit cannot mark paid');
select t.who('owner@box.test');
select t.ok(order_action(:'o1', 'markPaid', '{"method":"cash"}')->>'status' = 'paid', 'owner marks the reservation paid');
select t.ok((select count(*) from t.tickets where order_id = :'o1' and status = 'valid') = 2, 'marking paid issued 2 tickets');
select t.ok((select count(*) from t.order_log where order_id = :'o1' and kind = 'paid') = 1, 'mark-paid is in the order history');

-- move one ticket to another Standard seat (no price difference) → old ticket replaced, new one issued
select id as t1, code as c1 from t.tickets where order_id = :'o1' and seat = 'A-1' \gset
select t.who('clerk@box.test');
select order_action(:'o1', 'change', json_build_object('changes', json_build_array(json_build_object('ticket', :'t1', 'seat', 'A-5')), 'note', 'wanted the aisle')::jsonb) as ch1 \gset
reset role;
select t.ok((select status from t.tickets where id = :'t1') = 'replaced' and (select count(*) from t.tickets where order_id = :'o1' and seat = 'A-5' and status = 'valid' and replaces = :'t1') = 1, 'move: old ticket replaced, new ticket on A-5');
select t.ok((select code from t.tickets where replaces = :'t1') <> :'c1', 'move: the new ticket has a new code');
select t.ok((select count(*) from t.seat_log where seat in ('A-1','A-5') and action = 'moved') = 2, 'move: both seats have history');
select t.ok((select data->'tickets'->0->'from'->>'seat' from t.order_log where order_id = :'o1' and kind = 'change') like '%Seat 1%', 'change log keeps the original seat');
select t.ok((select count(*) from t.outbox where order_id = :'o1' and kind = 'updated') = 1, 'updated tickets queued for the customer');
set role authenticated; select t.who('owner@box.test');
select t.ok(checkin(:'c1', false, null)->>'result' = 'replaced', 'the replaced ticket no longer gets in (scanner says “replaced”)');

-- upgrade to VIP: $50 more, clerk cannot refund but can collect? (needs orders.edit) → owner collects in cash
select t.who('clerk@box.test');
select t.err($$select order_action('$$ || :'o1' || $$', 'change', '{"changes":[{"ticket":"$$ || (select id from t.tickets where order_id = :'o1' and seat = 'A-2') || $$","seat":"B-1"}],"settle":"collect","method":"cash"}')$$, 'permission', 'clerk cannot collect money for an upgrade');
select t.who('owner@box.test');
select t.err($$select order_action('$$ || :'o1' || $$', 'change', '{"changes":[{"ticket":"$$ || (select id from t.tickets where order_id = :'o1' and seat = 'A-2') || $$","seat":"B-1"}]}')$$, 'difference', 'upgrade asks how to settle the difference');
select order_action(:'o1', 'change', json_build_object('changes', json_build_array(json_build_object('ticket', (select id from t.tickets where order_id = :'o1' and seat = 'A-2' and status = 'valid'), 'seat', 'B-1')), 'settle', 'collect', 'method', 'cash')::jsonb) as up \gset
select t.ok((:'up'::jsonb)->>'net' = '5000', 'upgrade difference = $50 (old $50 → new $100)');
select t.ok((select (data->>'extraPaid')::bigint from t.orders where id = :'o1') = 5000, 'the $50 collected is recorded on the order');
select t.ok((select paid from t.tickets where order_id = :'o1' and seat = 'B-1' and status = 'valid') = 10000, 'the VIP ticket now shows $100 paid');
select t.err($$select order_action('$$ || :'o1' || $$', 'change', '{"changes":[{"ticket":"$$ || (select id from t.tickets where order_id = :'o1' and seat = 'A-5') || $$","seat":"A-3"}]}')$$, 'free', 'cannot move onto a sold seat');

-- downgrade back to Standard with a refund of the difference (processor refund → processing)
select order_action(:'o1', 'change', json_build_object('changes', json_build_array(json_build_object('ticket', (select id from t.tickets where order_id = :'o1' and seat = 'B-1' and status = 'valid'), 'seat', 'A-1')),
  'downgrade', 'credit')::jsonb) as down \gset
select t.ok((:'down'::jsonb)->>'net' = '-5000' and (:'down'::jsonb)->'refund'->>'credit' like 'CR-%', 'downgrade $50 → issued as a credit code');
select t.ok((select (data->>'credited')::bigint from t.orders where id = :'o1') = 5000, 'credited amount recorded on the order');

-- refunds on the card order: one ticket + its booking fee, to the card → processing until the processor confirms
select t.who('clerk@box.test');
select t.err($$select order_action('$$ || ((:'r2'::jsonb)->>'id') || $$', 'refund', '{"mode":"full"}')$$, 'permission', 'clerk cannot refund');
select t.who('owner@box.test');
select order_action(((:'r2'::jsonb)->>'id')::uuid, 'refund', json_build_object('mode', 'tickets', 'tickets', json_build_array((select id from t.tickets where order_id = ((:'r2'::jsonb)->>'id')::uuid and seat = 'A-3')), 'fees', true, 'to', 'original', 'cancel', true, 'seat', 'hold')::jsonb) as rf \gset
select t.ok((:'rf'::jsonb)->'refund'->>'amount' = '5100', 'refund = ticket $50 + its $1 booking fee');
select t.ok((:'rf'::jsonb)->'refund'->>'status' = 'processing', 'a card refund waits for the processor');
reset role;
select t.ok((select status from t.tickets where order_id = ((:'r2'::jsonb)->>'id')::uuid and seat = 'A-3') = 'cancelled', 'the refunded ticket was cancelled');
select t.ok(exists(select 1 from seat_status where seat = 'A-3' and status = 'held'), 'its seat was kept held');
set role service_role;
select finish_refund(((:'r2'::jsonb)->>'id')::uuid, (:'rf'::jsonb)->'refund'->>'id', '{"ok":false,"error":"card expired"}');
reset role;
select t.ok((select (data->>'refunded')::bigint from t.orders where id = ((:'r2'::jsonb)->>'id')::uuid) = 0, 'a refund the processor refused is reversed (still refundable)');
set role authenticated; select t.who('owner@box.test');
select t.err($$select order_action('$$ || ((:'r2'::jsonb)->>'id') || $$', 'refund', '{"mode":"amount","amount":999999}')$$, 'at most', 'cannot refund more than was collected');
select order_action(((:'r2'::jsonb)->>'id')::uuid, 'refund', '{"mode":"percent","pct":10,"to":"cash"}') as rp \gset
select t.ok(((:'rp'::jsonb)->'refund'->>'amount')::bigint > 0 and (:'rp'::jsonb)->'refund'->>'status' = 'done', '10% refund in cash, recorded');
select t.ok((select status from t.orders where id = ((:'r2'::jsonb)->>'id')::uuid) = 'paid', 'refund without cancelling keeps the order paid');

-- products: add one (balance due), remove it with a refund
select t.ok(order_action(:'o1', 'addAddon', '{"eventId":"e0000000-0000-0000-0000-000000000001","addonId":"park","qty":2,"settle":"due"}')->>'status' = 'paid', 'add a product to a paid order');
reset role;
select t.ok((select (data->>'due')::bigint from t.orders where id = :'o1') = 2000, 'balance due $20 for the added parking');
select t.ok((select availability('e0000000-0000-0000-0000-000000000001')->'ad'->>'park') = '3', 'product stock counts the added parking (1 + 2)');
set role authenticated; select t.who('owner@box.test');
select order_action(:'o1', 'collect', '{"amount":2000,"method":"terminal"}');
reset role;
select t.ok((select (data->>'due')::bigint from t.orders where id = :'o1') = 0, 'payment recorded clears the balance due');
set role authenticated; select t.who('owner@box.test');
select order_action(:'o1', 'removeAddon', json_build_object('line', (select n - 1 from t.orders o, jsonb_array_elements(o.data->'lines') with ordinality z(l, n) where o.id = :'o1' and l->>'kind' = 'addon' limit 1), 'qty', 1, 'refund', true, 'to', 'cash')::jsonb);
reset role;
select t.ok((select availability('e0000000-0000-0000-0000-000000000001')->'ad'->>'park') = '2', 'removing a product gives the stock back');

-- customer + holder + notes + messages + resend
set role authenticated; select t.who('clerk@box.test');
select order_action(:'o1', 'holder', json_build_object('ticket', (select id from t.tickets where order_id = :'o1' and status = 'valid' limit 1), 'name', 'Friend Two')::jsonb);
select order_action(:'o1', 'customer', '{"phone":"555-0101"}');
select t.err($$select order_action('$$ || :'o1' || $$', 'message', '{"subject":"Hi","body":"x"}')$$, 'permission', 'clerk without comms.email cannot message customers');
select t.who('owner@box.test');
select order_action(:'o1', 'message', '{"subject":"Doors at 7","body":"See you then"}');
select order_action(:'o1', 'resend', '{"kind":"tickets"}');
select order_action(:'o1', 'note', '{"body":"VIP friend of the artist"}');
reset role;
select t.ok((select count(*) from t.outbox where order_id = :'o1' and kind in ('message','tickets')) = 2, 'message + resend are queued and listed on the order');
select t.ok((select count(*) from t.order_log where order_id = :'o1') >= 9, 'every change is in the order history');
select t.ok((select before->>'phone' from t.order_log where order_id = :'o1' and kind = 'customer') = '' and (select data->'buyer'->>'phone' from t.orders where id = :'o1') = '555-0101', 'customer edit keeps the old details in the history');

-- cancel the rest of the order, keeping seats blocked, no refund
set role authenticated; select t.who('owner@box.test');
select order_action(:'o1', 'cancel', '{"all":true,"seat":"block","refund":null}');
reset role;
select t.ok((select count(*) from t.tickets where order_id = :'o1' and status = 'valid') = 0, 'cancel whole order voids every ticket');
select t.ok((select status from t.orders where id = :'o1') = 'cancelled', 'cancelled without refund → status cancelled');
select t.ok((select count(*) from seat_status where status = 'blocked' and note like 'Kept from cancelled order%') = 2, 'its seats were kept blocked');

-- credits: the downgrade credit pays part of a new order; revoking stops it
select code as crc from t.credits where source_order = :'o1' \gset
set role anon; select t.who('');
select t.ok((check_credit('b0000000-0000-0000-0000-000000000001', :'crc')->>'remaining')::bigint = 5000, 'a guest can check a credit code (value only)');
select place_order(json_build_object('buyer', json_build_object('name', 'Fan One', 'email', 'fan@mail.test'), 'items', json_build_array(json_build_object('eventId', 'e0000000-0000-0000-0000-000000000002', 'ticketTypeId', 'ga', 'qty', 1)),
  'payment', 'offline', 'credit', :'crc', 'creditAvail', 999999)::jsonb) as rc \gset
select t.ok((:'rc'::jsonb)->>'total' = '0' and (:'rc'::jsonb)->>'status' = 'paid', 'credit covers a $20 + $1 order; a buyer-supplied creditAvail is ignored');
select t.ok((check_credit('b0000000-0000-0000-0000-000000000001', :'crc')->>'remaining')::bigint = 5000 - 2100, 'credit balance goes down by what was used');
reset role;
set role authenticated; select t.who('owner@box.test');
select credit_action('b0000000-0000-0000-0000-000000000001', 'revoke', json_build_object('id', (select id from t.credits where code = :'crc'))::jsonb);
set role anon; select t.who('');
select t.err($$select place_order('{"buyer":{"name":"X","email":"x@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000002","ticketTypeId":"ga","qty":1}],"payment":"offline","credit":"$$ || :'crc' || $$"}')$$, 'cancelled', 'a revoked credit cannot be used');
-- account credit: only the signed-in, confirmed owner of the email
reset role; set role authenticated; select t.who('owner@box.test');
select credit_action('b0000000-0000-0000-0000-000000000001', 'issue', '{"email":"fan@mail.test","amount":1500,"note":"goodwill"}');
select t.who('other@mail.test');
select t.err($$select place_order('{"buyer":{"name":"Fan","email":"fan@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000002","ticketTypeId":"ga","qty":1}],"payment":"offline","credit":"account"}')$$, 'sign in', 'someone else cannot spend a customer''s account credit');
select t.who('fan@mail.test');
select t.ok(jsonb_array_length(my_credits()) = 2, 'the customer sees their credits');
select t.ok((place_order('{"buyer":{"name":"Fan","email":"fan@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000002","ticketTypeId":"ga","qty":1}],"payment":"offline","credit":"account"}')->>'total')::bigint = 600, 'signed-in customer: account credit applied automatically ($21 − $15)');
select t.ok(not exists(select 1 from jsonb_array_elements(my_orders()->'tickets') x where x->>'status' = 'replaced'), 'the wallet never shows replaced tickets');

-- reading: RLS + admin_load
select t.who('clerk@box.test');
select t.ok((select count(*) from t.order_log) > 0 and (select count(*) from t.credits) > 0, 'clerk (orders.view) reads order history and credits');
select t.err($$select count(*) from customer_notes$$, 'permission denied', 'notes are never read directly (admin_load gives them to customers.profiles only)');
select t.err($$select customer_note('b0000000-0000-0000-0000-000000000001', 'fan@mail.test', 'x')$$, 'permission', 'clerk cannot write customer notes');
select t.who('fan@mail.test');
select t.err($$select count(*) from orders$$, 'permission denied', 'a customer cannot read orders directly'); select t.err($$select count(*) from order_log$$, 'permission denied', 'a customer cannot read order history directly'); select t.err($$select count(*) from credits$$, 'permission denied', 'a customer cannot read credits directly');
select t.who('owner@box.test');
select customer_note('b0000000-0000-0000-0000-000000000001', 'fan@mail.test', 'Prefers the aisle');
reset role; set role anon; select t.who('');
select presence_ping('e0000000-0000-0000-0000-000000000002', 'visitor-1', 3, false);
select presence_ping('e0000000-0000-0000-0000-000000000002', 'visitor-2', 0, false);
reset role; set role authenticated; select t.who('owner@box.test');
select admin_load('b0000000-0000-0000-0000-000000000001', false) as al \gset
select t.ok(jsonb_array_length((:'al'::jsonb)->'orderLog') > 5 and jsonb_array_length((:'al'::jsonb)->'credits') = 2 and jsonb_array_length((:'al'::jsonb)->'custNotes') = 1, 'admin_load returns history, credits and notes');
select t.ok((:'al'::jsonb)->'accounts' ? 'fan@mail.test', 'admin_load knows who has a customer account');
select t.ok((:'al'::jsonb)->'live'->'e0000000-0000-0000-0000-000000000002'->>'now' = '2' and (:'al'::jsonb)->'live'->'e0000000-0000-0000-0000-000000000002'->>'cartTickets' = '3', 'live activity: 2 viewing now, 3 tickets in carts');
-- seat inventory move goes through the same change (history kept)
select t.err($$select seat_action('e0000000-0000-0000-0000-000000000001', '', 'move', array['A-4'], '{"to":"B-2"}')$$, 'different price level', 'inventory move to a different price level is refused');
select seat_action('e0000000-0000-0000-0000-000000000001', '', 'move', array['A-4'], '{"to":"A-2"}');
reset role;
select t.ok((select count(*) from t.tickets where seat = 'A-4' and status = 'replaced') = 1 and (select count(*) from t.tickets where seat = 'A-2' and status = 'valid') = 1, 'inventory move replaces the ticket and keeps history');

-- ── Stage 7: scanning — door view, duplicates across devices, wrong event / entrance, reissue, cancel / refund, devices, scan history ──
insert into auth.users(email, email_confirmed_at) values ('scan@box.test', now()), ('door@box.test', now());
insert into members(box_office_id, email, name, perms) values ('b0000000-0000-0000-0000-000000000001', 'scan@box.test', 'Scanner', '{door.scan,door.checkin}'),
  ('b0000000-0000-0000-0000-000000000001', 'door@box.test', 'Door lead', '{door.scan,door.checkin,door.undo,door.override,door.search,door.log,door.devices,customers.names}');
insert into events(id, box_office_id, slug, status, data) values ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'box-night', 'published', '{
  "name":"Box Night","start":"2099-03-01T20:00:00Z","currency":"USD","visibility":"public","timeSlots":[],
  "ticketTypes":[{"id":"box","name":"Box seat","price":8000,"qty":0,"admits":1},{"id":"floor","name":"Floor","price":3000,"qty":0,"admits":1}],
  "entrances":[{"id":"main","name":"Main entrance","ticketTypeIds":[],"areas":[]},{"id":"boxdoor","name":"Box seat entrance","ticketTypeIds":[],"areas":["Boxes"]}],
  "seating":{"enabled":true,"noSingles":false,"index":{"BX4-1":"box","BX4-2":"box","BX4-3":"box","F-A1":"floor","F-A2":"floor"},
    "meta":{"BX4-1":["Boxes","","1","Box 4"],"BX4-2":["Boxes","","2","Box 4"],"BX4-3":["Boxes","","3","Box 4"],"F-A1":["Floor","A","1"],"F-A2":["Floor","A","2"]},"rows":{}}}');
reset role; set role anon; select t.who('');
select place_order('{"buyer":{"name":"Bo Xer","email":"box@mail.test","phone":"(917) 555-0199"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000003","ticketTypeId":"box","qty":3,"seats":["BX4-1","BX4-2","BX4-3"]},{"eventId":"e0000000-0000-0000-0000-000000000003","ticketTypeId":"floor","qty":1,"seats":["F-A1"]}],"payment":"offline"}')->>'id' as o7 \gset
reset role; set role authenticated; select t.who('owner@box.test');
select order_action(:'o7', 'markPaid', '{"method":"cash"}');
reset role;
select code as k1 from t.tickets where order_id = :'o7' and seat = 'BX4-1' \gset
select code as k2 from t.tickets where order_id = :'o7' and seat = 'BX4-2' \gset
select code as k3 from t.tickets where order_id = :'o7' and seat = 'BX4-3' \gset
select code as kf from t.tickets where order_id = :'o7' and seat = 'F-A1' \gset
select ref as ref7 from t.orders where id = :'o7' \gset
select t.ok((select unit = 'Box 4' and coalesce("row", '') = '' and seat_label = '1' and area = 'Boxes' from t.tickets where code = :'k1'), 'box seat ticket: area Boxes, Box 4, no row, seat 1');
select t.ok((select count(distinct code) = 4 and bool_and(code ~ '^[A-Z0-9]{10}$') from t.tickets where order_id = :'o7'), 'every ticket has its own random 10-character code (the QR holds only this)');
set role authenticated; select t.who('scan@box.test');
select checkin(:'k1', false, 'e0000000-0000-0000-0000-000000000003', '{"device":"dev-a","deviceName":"Door phone 1","entrance":"main"}') as s1 \gset
select t.ok((:'s1'::jsonb)->>'result' = 'ok' and (:'s1'::jsonb)->'ticket'->>'unit' = 'Box 4' and (:'s1'::jsonb)->'ticket'->>'seat_label' = '1' and (:'s1'::jsonb)->'ticket'->>'type' = 'Box seat', 'scanner: VALID with Box 4 · Seat 1');
select t.ok(not ((:'s1'::jsonb)->'ticket' ? 'paid') and not ((:'s1'::jsonb)->'ticket' ? 'face') and not ((:'s1'::jsonb)->'ticket' ? 'answers') and (:'s1'::jsonb)->'ticket'->>'holder' = 'Guest', 'scanner staff see no money, answers or names');
select t.ok((:'s1'::jsonb)->'ticket'->>'of' = '4' and (:'s1'::jsonb)->'ticket'->>'order_ref' like 'SET-%', 'scan shows the order number and ticket x of 4');
select checkin(:'k1', false, 'e0000000-0000-0000-0000-000000000003', '{"device":"dev-b","deviceName":"Door phone 2","entrance":"main"}') as s2 \gset
select t.ok((:'s2'::jsonb)->>'result' = 'already' and (:'s2'::jsonb)->'first'->>'device_name' = 'Door phone 1' and (:'s2'::jsonb)->'first'->>'entrance' = 'Main entrance' and (:'s2'::jsonb)->'first'->>'at' is not null, 'a second phone gets ALREADY SCANNED with the original time, door and device');
select t.ok(checkin(:'k2', false, 'e0000000-0000-0000-0000-000000000001', '{}')->>'result' = 'wrong_event', 'wrong event is rejected');
select t.ok(checkin(:'k2', false, 'e0000000-0000-0000-0000-000000000001', '{}')->'ticket'->>'event_name' = 'Box Night' and not (checkin(:'k2', false, 'e0000000-0000-0000-0000-000000000001', '{}')->'ticket' ? 'seat'), 'wrong event says which event, nothing else');
select t.ok(checkin('NOTAREALCODE', false, 'e0000000-0000-0000-0000-000000000003', '{"device":"dev-a"}')->>'result' = 'unknown', 'an invalid QR code is rejected');
select checkin(:'kf', false, 'e0000000-0000-0000-0000-000000000003', '{"device":"dev-a","entrance":"boxdoor"}') as s3 \gset
select t.ok((:'s3'::jsonb)->>'result' = 'wrong_entrance' and (:'s3'::jsonb)->'entrances' ? 'Main entrance' and not ((:'s3'::jsonb)->'entrances' ? 'Box seat entrance'), 'a floor ticket at the box entrance: WRONG ENTRANCE → send to Main entrance');
select t.err($$select checkin('$$ || :'kf' || $$', false, 'e0000000-0000-0000-0000-000000000003', '{"entrance":"boxdoor","override":true}')$$, 'permission', 'scanner staff cannot override the entrance warning');
select t.err($$select checkin('$$ || :'k2' || $$', true, 'e0000000-0000-0000-0000-000000000003', '{}')$$, 'permission', 'scanner staff cannot undo check-ins');
select t.err($$select door_search('e0000000-0000-0000-0000-000000000003', 'box')$$, 'permission', 'scanner staff cannot search guests by email / phone');
select t.err($$select door_log('e0000000-0000-0000-0000-000000000003')$$, 'permission', 'scanner staff cannot read the scan history');
select t.ok(jsonb_array_length(admin_load('b0000000-0000-0000-0000-000000000001', false)->'orders') = 0 and not exists(select 1 from jsonb_array_elements(admin_load('b0000000-0000-0000-0000-000000000001', false)->'tickets') x where x->>'paid' is not null or x->'answers' <> '{}'), 'scanner back office: no orders, no ticket money or answers');
select t.who('door@box.test');
select t.ok(checkin(:'kf', false, 'e0000000-0000-0000-0000-000000000003', '{"device":"dev-c","entrance":"boxdoor","override":true}')->>'override' = 'true', 'door lead lets the guest in anyway (override logged)');
select t.ok(jsonb_array_length(door_search('e0000000-0000-0000-0000-000000000003', 'box@mail')) = 4 and jsonb_array_length(door_search('e0000000-0000-0000-0000-000000000003', '5550199')) = 4, 'manual search by email and by phone');
select t.ok(not (door_search('e0000000-0000-0000-0000-000000000003', 'box@mail')->0 ? 'buyer_email') and door_search('e0000000-0000-0000-0000-000000000003', :'ref7')->0->>'holder' = 'Bo Xer', 'search by order number; results never include email or phone');
select t.ok(checkin(:'k2', false, 'e0000000-0000-0000-0000-000000000003', '{"manual":true,"device":"dev-c"}')->>'result' = 'ok', 'manual check-in from the search');
select t.ok(checkin(:'k2', true, 'e0000000-0000-0000-0000-000000000003', '{"device":"dev-c"}')->>'result' = 'undone', 'door lead can undo a check-in');
-- reissue: new QR, old one dead at once
select t.who('owner@box.test');
select order_action(:'o7', 'reissue', json_build_object('tickets', json_build_array((select id from t.tickets where code = :'k3')))::jsonb) as ri \gset
reset role; set role authenticated; select t.who('scan@box.test');
select t.ok(checkin(:'k3', false, 'e0000000-0000-0000-0000-000000000003', '{}')->>'result' = 'replaced', 'reissue: the old QR code is rejected as replaced');
select t.ok(checkin((:'ri'::jsonb)->'codes'->>0, false, 'e0000000-0000-0000-0000-000000000003', '{}')->>'result' = 'ok' and checkin((:'ri'::jsonb)->'codes'->>0, false, 'e0000000-0000-0000-0000-000000000003', '{}')->'ticket'->>'unit' = 'Box 4', 'reissue: the new code scans, same seat');
reset role;
select t.ok((select count(*) from t.outbox where order_id = :'o7' and kind = 'tickets') = 1 and (select count(*) from t.order_log where order_id = :'o7' and kind = 'reissue') = 1, 'reissue is in the order history and the updated tickets are queued');
-- cancelled / refunded tickets: rejected at once
set role authenticated; select t.who('owner@box.test');
select t.ok(checkin((select code from t.tickets where order_id = ((:'r2'::jsonb)->>'id')::uuid and seat = 'A-3' and status = 'cancelled' limit 1), false, 'e0000000-0000-0000-0000-000000000001', '{}')->>'result' = 'cancelled', 'a cancelled ticket is rejected as cancelled');
reset role; select id as t2 from t.tickets where code = :'k2' \gset
set role authenticated; select t.who('owner@box.test');
select order_action(:'o7', 'refund', json_build_object('mode', 'tickets', 'tickets', json_build_array(:'t2'), 'to', 'cash', 'cancel', true, 'seat', 'release')::jsonb);
select t.ok(checkin(:'k2', false, 'e0000000-0000-0000-0000-000000000003', '{}')->>'result' = 'refunded', 'a refunded ticket is rejected as refunded');
-- devices: switch one off → it can't check anyone in
select t.who('door@box.test');
select t.ok(jsonb_array_length(scan_devices_list('b0000000-0000-0000-0000-000000000001')) = 3, 'every scanning device is listed (3)');
select scan_device_action('b0000000-0000-0000-0000-000000000001', 'dev-a', 'disable');
select t.who('scan@box.test');
select t.ok(checkin(:'kf', false, 'e0000000-0000-0000-0000-000000000003', '{"device":"dev-a"}')->>'result' = 'device_off', 'a switched-off device is refused');
select t.err($$select scan_device_action('b0000000-0000-0000-0000-000000000001', 'dev-a', 'enable')$$, 'permission', 'scanner staff cannot manage devices');
select t.who('door@box.test');
select door_log('e0000000-0000-0000-0000-000000000003') as dl \gset
select t.ok((select count(*) from jsonb_array_elements(:'dl'::jsonb) x where x->>'result' = 'already') >= 1 and (select count(*) from jsonb_array_elements(:'dl'::jsonb) x where x->>'result' = 'unknown') = 1
  and (select count(*) from jsonb_array_elements(:'dl'::jsonb) x where x->>'result' = 'device_off') = 1 and (select bool_and(x->>'by' <> '') from jsonb_array_elements(:'dl'::jsonb) x), 'scan history: check-ins, duplicates, invalid and refused scans, with the employee');
select t.ok((select count(*) from jsonb_array_elements(:'dl'::jsonb) x where (x->>'manual')::boolean) = 1 and (select count(*) from jsonb_array_elements(:'dl'::jsonb) x where (x->>'override')::boolean) = 1, 'scan history marks manual check-ins and overrides');
-- sync: what changed since the last pull
select door_sync('e0000000-0000-0000-0000-000000000003', null) as ds \gset
select t.ok(jsonb_array_length((:'ds'::jsonb)->'tickets') >= 4 and ((:'ds'::jsonb)->'stats'->>'total')::int = 3 and ((:'ds'::jsonb)->'stats'->>'inn')::int = 3, 'door_sync: tickets + live totals (3 valid, 3 in)');
select t.ok(jsonb_array_length(door_sync('e0000000-0000-0000-0000-000000000003', now() + interval '1 hour')->'tickets') = 0, 'door_sync: nothing changed since → empty');
select t.who('');
select t.err($$select door_sync('e0000000-0000-0000-0000-000000000003', null)$$, 'permission|sign in', 'signed out: no door data');
reset role;
-- a race: two scanners, same ticket, same instant — the conditional update lets exactly one through
select t.ok((select count(*) from scan_log where code = :'k1' and result = 'ok') = 1, 'one ticket, two phones one after the other: accepted once');

-- ══ Stage 8: messages, consent, campaigns, automations, integrations, API ══
reset role; select t.who('');
select t.ok((select count(*) from automations where box_office_id = 'b0000000-0000-0000-0000-000000000001' and std in ('purchase','pre','post','offer')) = 4, 'S8 a box office starts with the four standard workflows');
set role anon; select t.who('');
select t.err($$select * from contacts$$, 'permission denied', 'S8 buyers cannot read contacts');
select t.err($$insert into outbox(box_office_id, kind, "to") values ('b0000000-0000-0000-0000-000000000001', 'campaign', 'x@y.z')$$, 'permission denied', 'S8 nobody writes the outbox directly');
select place_order('{"buyer":{"name":"Opt Fan","email":"opt@mail.test","phone":"(646) 555-0123"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000002","ticketTypeId":"ga","qty":1,"seats":[]}],"payment":"offline","optIn":true,"smsOptIn":true,"utm":{"source":"ig","campaign":"spring","bogus":"x"}}')->>'id' as s8o1 \gset
reset role;
select t.ok((select email_optin and sms_optin and phone = '+16465550123' and email_optin_src like 'checkout%' from contacts where email = 'opt@mail.test'), 'S8 checkout opt-ins (email + text) recorded on the contact with their source');
select t.ok((select count(*) from consent_log where email = 'opt@mail.test') = 2, 'S8 consent history has both opt-ins');
select t.ok((select data->'utm' = '{"source":"ig","campaign":"spring"}'::jsonb from t.orders where id = :'s8o1'), 'S8 UTM tags stored on the order (known keys only)');
set role authenticated; select t.who('owner@box.test');
select t.err($$select save_integration('b0000000-0000-0000-0000-000000000001', '{"kind":"webhook","config":{"url":"http://hooks.example.org","events":["payment.completed"]}}')$$, 'https', 'S8 webhooks must be https');
select t.err($$select save_integration('b0000000-0000-0000-0000-000000000001', '{"kind":"webhook","config":{"url":"https://169.254.169.254/x","events":["payment.completed"]}}')$$, 'public host', 'S8 webhooks cannot target private / metadata addresses');
select save_integration('b0000000-0000-0000-0000-000000000001', '{"kind":"webhook","name":"WH","config":{"url":"https://hooks.example.org/set","events":["payment.completed","ticket.cancelled","order.created","waitlist.signup"]}}') as s8wh \gset
select t.ok((:'s8wh'::jsonb)->>'secret' like 'whsec_%' and not ((:'s8wh'::jsonb) ? 'secret_hint' and (:'s8wh'::jsonb)->>'secret_hint' is null), 'S8 a new webhook returns its signing secret once');
select t.ok(not (admin_load('b0000000-0000-0000-0000-000000000001')->>'integrations') like '%whsec_%', 'S8 admin_load never returns integration secrets');
select save_automation('b0000000-0000-0000-0000-000000000001', '{"name":"VIP info","trigger":{"type":"ticket.purchased"},"cond":{"ticketTypeIds":["vip"]},"timing":{"mode":"before","hours":48},
  "actions":[{"type":"email","subject":"VIP {{event}}","body":"Hi {{first_name}}"},{"type":"sms","body":"VIP door on 8th"},{"type":"tag","tag":"VIP"}]}') as s8a \gset
select t.err($$select save_automation('b0000000-0000-0000-0000-000000000001', '{"name":"x","trigger":{"type":"ticket.purchased"},"actions":[]}')$$, 'at least one action', 'S8 an automation needs an action');
select t.who('clerk@box.test');
select t.err($$select save_automation('b0000000-0000-0000-0000-000000000001', '{"name":"x","trigger":{"type":"ticket.purchased"},"actions":[{"type":"tag","tag":"x"}]}')$$, 'permission', 'S8 staff without “Manage automations” cannot change them');
select t.err($$select segment_count('b0000000-0000-0000-0000-000000000001', '{}')$$, 'permission', 'S8 audience counts need “mailing lists”');
reset role;
-- a VIP purchase (staff order, paid at once) → confirmation, purchase webhook, VIP email + text 48 h before, tag
set role authenticated; select t.who('owner@box.test');
select place_order('{"buyer":{"name":"Vera Vip","email":"vera@mail.test","phone":"+1 212 555 0199"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000001","ticketTypeId":"vip","qty":1,"seats":["B-1"]}],"payment":"manual","payMethod":"cash"}')->>'id' as s8v \gset
reset role;
select t.ok((select count(*) from t.outbox where order_id = :'s8v' and kind = 'confirmation') = 1, 'S8 one confirmation for the order');
select t.ok((select count(*) from deliveries where event = 'payment.completed' and payload->'data'->>'id' = :'s8v') = 1 and (select count(*) from deliveries where event = 'order.created' and payload->'data'->>'id' = :'s8v') = 1, 'S8 order.created + payment.completed webhooks queued');
select t.ok(not exists(select 1 from deliveries where payload::text like '%access_key%' or payload::text like '%platformFee%'), 'S8 webhook payloads never carry the order key or platform money');
select t.ok((select count(*) from t.outbox where order_id = :'s8v' and automation_id = (:'s8a'::jsonb)->>'id' and send_at = '2099-01-01T20:00:00Z'::timestamptz - interval '48 hours') = 2, 'S8 VIP purchase → email + text scheduled 48 h before the event');
select t.ok((select 'VIP' = any(tags) and 'Attendee: Seated Show' = any(tags) from contacts where email = 'vera@mail.test'), 'S8 tags from the automation and the standard Purchase workflow');
select t.ok((select count(*) from automation_runs where automation_id = (:'s8a'::jsonb)->>'id') = 1, 'S8 the automation ran once');
select emit_event('b0000000-0000-0000-0000-000000000001', 'payment.completed', '{}', order_ctx(o)) from public.orders o where id = :'s8v';
select t.ok((select count(*) from t.outbox where order_id = :'s8v' and automation_id = (:'s8a'::jsonb)->>'id') = 2, 'S8 the same trigger never runs an automation twice');
-- campaigns: marketing only to opted-in; event update to all holders
set role authenticated; select t.who('owner@box.test');
select send_campaign('b0000000-0000-0000-0000-000000000001', '{"category":"marketing","channel":"email","subject":"News","body":"Hi {{first_name}}","filter":{"status":"any"}}') as s8c \gset
select t.ok((:'s8c'::jsonb)->>'queued' = '1' and ((:'s8c'::jsonb)->'skipped'->>'not opted in to marketing email')::int >= 3, 'S8 marketing campaign: only the opted-in contact queued, the rest counted as held back');
select t.err($$select send_campaign('b0000000-0000-0000-0000-000000000001', '{"category":"transactional","subject":"x","body":"y","filter":{}}')$$, 'choose the event', 'S8 an event update must name its event');
select send_campaign('b0000000-0000-0000-0000-000000000001', '{"category":"transactional","channel":"sms","body":"Doors at 7","filter":{"eventIds":["e0000000-0000-0000-0000-000000000001"]}}') as s8u \gset
select t.ok((:'s8u'::jsonb)->>'queued' = '1' and ((:'s8u'::jsonb)->'skipped'->>'no mobile number')::int >= 1, 'S8 an event-update text reaches holders with a number; the rest are counted');
select t.ok((segment_count('b0000000-0000-0000-0000-000000000001', '{"status":"optedIn"}')->>'count')::int = 1, 'S8 segment count: opted in');
select t.ok((segment_count('b0000000-0000-0000-0000-000000000001', '{"eventIds":["e0000000-0000-0000-0000-000000000001"],"ticketTypeIds":["vip"]}')->>'count')::int >= 1, 'S8 segment by event + ticket type');
reset role;
-- the sender: claims due rows (consent re-checked), renders context, records results
select queue_msg(jsonb_build_object('box_office_id', 'b0000000-0000-0000-0000-000000000001', 'kind', 'campaign', 'to', 'vera@mail.test', 'email', 'vera@mail.test', 'subject', 'Sneaky', 'body', 'x')) as s8m \gset
set role service_role;
select claim_outbox(500) as s8cl \gset
reset role;
select t.ok((select status from t.outbox where id = :'s8m') = 'suppressed', 'S8 sender: a marketing email to someone who never opted in is held back at send time');
select t.ok(exists(select 1 from jsonb_array_elements(:'s8cl'::jsonb) x where x->'msg'->>'kind' = 'confirmation' and x->'ctx'->'order'->>'key' is not null and jsonb_array_length(x->'ctx'->'tickets') >= 1), 'S8 sender gets what it needs to render (order link, tickets)');
select t.ok(not exists(select 1 from jsonb_array_elements(:'s8cl'::jsonb) x where (x->'msg'->>'send_at')::timestamptz > now()), 'S8 nothing is claimed before its time');
set role service_role;
select outbox_result(((x->'msg')->>'id')::uuid, true, 'resend', 're_' || ((x->'msg')->>'id'), null, false) from jsonb_array_elements(:'s8cl'::jsonb) x where x->'msg'->>'kind' = 'confirmation';
select outbox_result(((x->'msg')->>'id')::uuid, false, 'resend', null, 'timeout', false) from jsonb_array_elements(:'s8cl'::jsonb) x where x->'msg'->>'kind' = 'update';
reset role;
select t.ok((select bool_and(status = 'sent' and sent_at is not null) from t.outbox where kind = 'confirmation' and provider = 'resend'), 'S8 delivered messages are marked sent');
select t.ok((select status = 'queued' and send_at > now() from t.outbox where kind = 'update' and channel = 'sms' limit 1), 'S8 a failed send is retried later (back-off)');
-- bounces, STOP, unsubscribe link
set role service_role;
select mail_event((select provider_id from t.outbox where kind = 'confirmation' and email = 'vera@mail.test' limit 1), 'bounced');
select inbound_sms('+16465550123', 'STOP');
reset role;
select t.ok((select suppressed = 'bounced' from contacts where email = 'vera@mail.test'), 'S8 a hard bounce suppresses the address');
select t.ok((select unsub_sms_at is not null and not sms_optin from contacts where email = 'opt@mail.test'), 'S8 replying STOP stops all texts');
select token as s8tok from contacts where email = 'opt@mail.test' \gset
set role anon; select t.who('');
select t.ok(unsub_info(:'s8tok')->>'email' = 'o•••@m•••.test', 'S8 the preferences page shows the address masked');
select unsubscribe(:'s8tok', '{"email":false}');
select t.ok(unsub_info('short') is null, 'S8 a bad token shows nothing');
reset role;
select t.ok((select not email_optin and unsub_email_at is not null from contacts where email = 'opt@mail.test') and exists(select 1 from consent_log where email = 'opt@mail.test' and action = 'optout' and source = 'unsubscribe link'), 'S8 unsubscribe link: email marketing off, logged with its source');
-- time-based: a show starting in 2 hours with its own 24 h reminder
insert into events(id, box_office_id, slug, status, data) values ('e0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000001', 'soon', 'published',
  jsonb_build_object('name', 'Soon Show', 'start', now() + interval '2 hours', 'currency', 'USD', 'visibility', 'public', 'timeSlots', '[]'::jsonb, 'ticketTypes', '[{"id":"g","name":"General","price":1000,"qty":50,"admits":1}]'::jsonb,
    'emails', '{"reminders":[{"hoursBefore":24,"channel":"email","body":"See you soon"}]}'::jsonb));
set role anon; select t.who('');
select place_order('{"buyer":{"name":"Soon Fan","email":"soon@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000008","ticketTypeId":"g","qty":1,"seats":[]}],"payment":"offline"}')->>'id' as s8s \gset
reset role; set role authenticated; select t.who('owner@box.test'); select order_action(:'s8s', 'markPaid', '{"method":"cash"}'); reset role;
set role service_role; select marketing_tick(); select marketing_tick(); reset role;
select t.ok((select count(*) from t.outbox where order_id = :'s8s' and kind = 'reminder') = 1, 'S8 the event''s own reminder is queued once (the standard one is skipped for it)');
-- cancel → webhook + scheduled VIP messages dropped at send time
set role authenticated; select t.who('owner@box.test');
select order_action(:'s8v', 'cancel', '{"all":true,"seat":"release"}');
reset role;
select t.ok(exists(select 1 from deliveries where event = 'ticket.cancelled' and payload->'data'->>'order_ref' = (select ref from t.orders where id = :'s8v')), 'S8 ticket.cancelled webhook');
update outbox set send_at = now() - interval '1 second' where order_id = :'s8v' and automation_id is not null;
set role service_role; select claim_outbox(500); reset role;
select t.ok((select bool_and(status = 'cancelled') from t.outbox where order_id = :'s8v' and automation_id = (:'s8a'::jsonb)->>'id'), 'S8 scheduled automation messages for a cancelled order are dropped');
-- deliveries + API keys
set role service_role; select claim_deliveries(100) as s8d \gset
reset role;
select t.ok(jsonb_array_length(:'s8d'::jsonb) >= 3 and (:'s8d'::jsonb)->0->'integration'->>'secret' like 'whsec_%', 'S8 the sender gets deliveries with their integration (server-side secret)');
set role authenticated; select t.who('owner@box.test');
select create_api_key('b0000000-0000-0000-0000-000000000001', 'Warehouse', '{orders:read}') as s8k \gset
reset role;
select t.ok((:'s8k'::jsonb)->>'key' ~ '^set_live_[0-9a-f]{40}$' and not ((:'s8k'::jsonb) ? 'hash'), 'S8 API key shown once, hash never returned');
set role service_role;
select api_auth(encode(sha256(convert_to((:'s8k'::jsonb)->>'key', 'UTF8')), 'hex')) as s8au \gset
select t.ok((:'s8au'::jsonb)->>'box_office_id' = 'b0000000-0000-0000-0000-000000000001' and (:'s8au'::jsonb)->'scopes' ? 'orders:read', 'S8 the API recognises the key by its hash');
select t.ok(jsonb_array_length(api_read('b0000000-0000-0000-0000-000000000001', 'orders', null, 10)) >= 1 and not api_read('b0000000-0000-0000-0000-000000000001', 'orders', null, 10)::text like '%access_key%', 'S8 API reads orders without private keys');
reset role;
set role authenticated; select t.who('owner@box.test'); select revoke_api_key('b0000000-0000-0000-0000-000000000001', ((:'s8k'::jsonb)->>'id')::uuid); reset role;
set role service_role; select t.ok(api_auth(encode(sha256(convert_to((:'s8k'::jsonb)->>'key', 'UTF8')), 'hex')) is null, 'S8 a revoked key stops working'); reset role;
set role anon; select t.err($$select api_auth('x')$$, 'permission denied', 'S8 the API functions are server-only'); reset role;

-- ══ Stage 9: ticket money, chargebacks, processor ledger + payouts, expenses, exports ══
update box_offices set settings = settings || '{"taxPct":8}' where id = 'b0000000-0000-0000-0000-000000000001';
insert into events(id, box_office_id, slug, status, data) values ('e0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000001', 'money-night', 'published', '{
  "name":"Money Night","start":"2099-03-01T20:00:00Z","currency":"USD","visibility":"public","timeSlots":[],
  "ticketTypes":[{"id":"m","name":"Main","price":3333,"qty":50,"admits":1}],"addons":[{"id":"prog","name":"Programme","price":700,"qty":20,"standalone":false}]}');
set role anon; select t.who('');
select place_order('{"buyer":{"name":"Money Fan","email":"money@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000009","ticketTypeId":"m","qty":3,"seats":[]}],"addons":[{"eventId":"e0000000-0000-0000-0000-000000000009","addonId":"prog","qty":1}],"payment":"card"}')->>'id' as s9o \gset
reset role; set role service_role;
select confirm_payment(:'s9o', json_build_object('amount', (select (data->>'total')::bigint from t.orders where id = :'s9o'), 'ref', 'pi_s9', 'provider', 'stripe', 'fee', 397)::jsonb);
reset role;
select t.ok((select sum(fee) from t.tickets where order_id = :'s9o') = (select (data->>'fee')::bigint + coalesce((data->>'serviceFee')::bigint, 0) from t.orders where id = :'s9o') and (select sum(fee) from t.tickets where order_id = :'s9o') > 0,
  'S9 the tickets share the order''s booking fee exactly');
select t.ok((select sum(tax) from t.tickets where order_id = :'s9o') > 0 and (select sum(tax) from t.tickets where order_id = :'s9o') < (select (data->>'tax')::bigint from t.orders where id = :'s9o'),
  'S9 tickets carry their part of the sales tax; the product keeps the rest');
select t.ok((select sum(proc) from t.tickets where order_id = :'s9o') between 1 and 396, 'S9 tickets carry their part of the card processing fee');
select t.ok((select bool_and(fee > 0 and tax > 0 and proc > 0) from t.tickets where order_id = :'s9o'), 'S9 every ticket has its own booking fee, tax and processing share');
-- refund one ticket as credit → that ticket shows the credit; a chargeback; a clerk can't record one
set role authenticated; select t.who('owner@box.test');
select order_action(:'s9o', 'refund', json_build_object('mode', 'tickets', 'tickets', (select jsonb_agg(id) from (select id from t.tickets where order_id = :'s9o' limit 1) x), 'to', 'credit')::jsonb);
reset role;
select t.ok((select count(*) from t.tickets where order_id = :'s9o' and credited > 0 and credited = refunded) = 1, 'S9 a refund as credit is recorded on the ticket as credit');
set role authenticated; select t.who('clerk@box.test');
select t.err($$select order_action('$$ || :'s9o' || $$', 'chargeback', '{"amount":1000}')$$, 'permission', 'S9 a clerk without “Issue refunds” cannot record a chargeback');
select t.who('owner@box.test');
select t.err($$select order_action('$$ || :'s9o' || $$', 'chargeback', '{"amount":99999999}')$$, 'at most', 'S9 a chargeback can''t exceed what was collected');
select order_action(:'s9o', 'chargeback', '{"amount":1000,"reason":"fraudulent"}');
reset role;
select t.ok((order_money(o)->>'chargedBack')::bigint = 1000 and (order_money(o)->>'refundable')::bigint = (order_money(o)->>'collected')::bigint - (order_money(o)->>'credited')::bigint - 1000, 'S9 an open chargeback reduces what can still be refunded')
  from public.orders o where id = :'s9o';
set role authenticated; select t.who('owner@box.test');
select order_action(:'s9o', 'chargeback', json_build_object('id', (select data->'chargebacks'->0->>'id' from t.orders where id = :'s9o'), 'status', 'won')::jsonb);
reset role;
select t.ok((order_money(o)->>'chargedBack')::bigint = 0 and o.data->'chargebacks'->0->>'status' = 'won', 'S9 a won chargeback gives the money back') from public.orders o where id = :'s9o';
select t.ok(exists(select 1 from t.order_log where order_id = :'s9o' and kind = 'chargeback'), 'S9 chargebacks are in the order''s change history');
-- the processor's side: charge, dispute (webhook, twice), payout
set role service_role;
select record_processor_tx(json_build_object('id', 'ch_s9', 'payment', 'pi_s9', 'type', 'charge', 'amount', (select (data->>'total')::bigint from t.orders where id = :'s9o'), 'fee', 397, 'app_fee', 0, 'account', 'acct_test')::jsonb);
select record_processor_tx('{"id":"ch_s9","payment":"pi_s9","type":"charge","amount":1,"account":"acct_test"}');
select record_dispute('{"id":"dp_s9","payment":"pi_s9","amount":500,"reason":"duplicate","status":"open","provider":"stripe"}');
select record_dispute('{"id":"dp_s9","payment":"pi_s9","amount":500,"reason":"duplicate","status":"open","provider":"stripe"}');
select record_payout('{"id":"po_s9","account":"acct_test","amount":9000,"status":"paid","arrival":"2099-01-03T00:00:00Z","tx":["pi_s9"],"provider":"stripe"}');
reset role;
select t.ok((select count(*) from processor_tx where id = 'ch_s9') = 1 and (select amount from processor_tx where id = 'ch_s9') > 1, 'S9 processor transactions are recorded once (a repeated webhook changes nothing)');
select t.ok((select count(*) from t.orders o, jsonb_array_elements(o.data->'chargebacks') c where o.id = :'s9o' and c->>'id' = 'dp_s9') = 1 and exists(select 1 from processor_tx where id = 'dp:dp_s9' and amount = -500),
  'S9 a processor dispute opens one chargeback on the order + a processor transaction');
select t.ok((select status from payouts where id = 'po_s9') = 'paid' and (select bool_and(payout_id = 'po_s9') from processor_tx where payment = 'pi_s9'), 'S9 a paid payout links the transactions it carried');
set role anon; select t.err($$select record_payout('{"id":"x","account":"acct_test","amount":1,"status":"paid"}')$$, 'permission denied', 'S9 payouts can only be written by the processor (service role)'); reset role;
set role authenticated; select t.who('owner@box.test'); select t.err($$select * from processor_tx$$, 'permission denied', 'S9 nobody reads the processor ledger directly'); reset role;
-- expenses
set role authenticated; select t.who('clerk@box.test');
select t.err($$select save_expense('b0000000-0000-0000-0000-000000000001', '{"event_id":"e0000000-0000-0000-0000-000000000009","category":"Venue","amount":50000}')$$, 'permission', 'S9 entering expenses needs “Enter event expenses”');
reset role; select t.who('root@platform.test'); update members set perms = perms || '{events.view}' where email = 'clerk@box.test'; set role authenticated; select t.who('clerk@box.test');
select t.ok(jsonb_array_length(admin_load('b0000000-0000-0000-0000-000000000001')->'expenses') = 0 and jsonb_array_length(admin_load('b0000000-0000-0000-0000-000000000001')->'tickets') > 0
  and (select bool_and(t2->'fee' = 'null'::jsonb and t2->'proc' = 'null'::jsonb) from jsonb_array_elements(admin_load('b0000000-0000-0000-0000-000000000001')->'tickets') t2),
  'S9 staff without finance permissions see no expenses and no ticket fees');
reset role; select t.who('root@platform.test'); update members set perms = array_remove(perms, 'events.view') where email = 'clerk@box.test'; set role authenticated; select t.who('owner@box.test');
select t.who('owner@box.test');
select save_expense('b0000000-0000-0000-0000-000000000001', '{"event_id":"e0000000-0000-0000-0000-000000000009","category":"Venue","description":"Hall","amount":50000,"date":"2099-02-01"}');
select t.err($$select save_expense('b0000000-0000-0000-0000-000000000001', '{"event_id":"e0000000-0000-0000-0000-000000000009","amount":0}')$$, 'amount', 'S9 an expense needs an amount');
select t.ok(import_expenses('b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000009', '[{"category":"AV","amount":12000},{"category":"Nope","description":"Misc","amount":3000}]') = 2, 'S9 import expenses from a spreadsheet');
select set_expenses_final('b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000009', true);
select admin_load('b0000000-0000-0000-0000-000000000001') as s9al \gset
reset role;
select t.ok((select sum((x->>'amount')::bigint) from jsonb_array_elements((:'s9al'::jsonb)->'expenses') x where x->>'event_id' = 'e0000000-0000-0000-0000-000000000009') = 65000
  and (select count(*) from expenses where category = 'Other' and description = 'Misc') = 1, 'S9 expenses add up (unknown categories become Other)');
select t.ok((:'s9al'::jsonb)->'expenseFinal' ? 'e0000000-0000-0000-0000-000000000009', 'S9 profit marked final for the event');
select t.ok(jsonb_array_length((:'s9al'::jsonb)->'payouts') >= 1 and jsonb_array_length((:'s9al'::jsonb)->'procTx') >= 2, 'S9 the owner sees payouts and the processor ledger');
select t.ok(exists(select 1 from audit_log where kind = 'finance.expense' and target = 'e0000000-0000-0000-0000-000000000009'), 'S9 expense changes are in the activity log');
-- reissue keeps a ticket's money
set role authenticated; select t.who('owner@box.test');
select order_action(:'s9o', 'reissue', json_build_object('tickets', (select jsonb_agg(id) from (select id from t.tickets where order_id = :'s9o' and status = 'valid' and credited = 0 limit 1) x))::jsonb);
reset role;
select t.ok((select sum(fee) from t.tickets where order_id = :'s9o' and status <> 'replaced') = (select (data->>'fee')::bigint + coalesce((data->>'serviceFee')::bigint, 0) from t.orders where id = :'s9o'), 'S9 a reissued ticket keeps its fee, tax and processing share');
-- data ownership
set role authenticated; select t.who('clerk@box.test');
select t.err($$select export_box_office('b0000000-0000-0000-0000-000000000001')$$, 'owner', 'S9 staff without both export permissions can''t download everything');
select t.err($$select platform_export()$$, 'super admins', 'S9 only super admins export platform-wide data');
select t.who('owner@box.test');
select export_box_office('b0000000-0000-0000-0000-000000000001') as s9x \gset
select t.who('root@platform.test'); select platform_export() as s9p \gset
reset role;
select t.ok(jsonb_array_length((:'s9x'::jsonb)->'orders') = (select count(*) from t.orders where box_office_id = 'b0000000-0000-0000-0000-000000000001') and not (:'s9x')::text like '%access_key%'
  and jsonb_array_length((:'s9x'::jsonb)->'expenses') = 3, 'S9 the owner downloads every order (no private keys), ticket and expense');
select t.ok(jsonb_array_length((:'s9p'::jsonb)->'box_offices') >= 1 and not (:'s9p')::text like '%buyer_email%', 'S9 platform export: box offices and order money, no customer contact data');
set role authenticated; select t.who('root@platform.test'); select set_box_office_status('b0000000-0000-0000-0000-000000000001', 'suspended'); select t.who('owner@box.test');
select t.ok(jsonb_array_length(export_box_office('b0000000-0000-0000-0000-000000000001')->'orders') > 0, 'S9 a suspended box office''s owner can still download all of its data');
reset role;
set role authenticated; select t.who('root@platform.test'); select set_box_office_status('b0000000-0000-0000-0000-000000000001', 'active'); reset role;
update box_offices set settings = settings - 'taxPct' where id = 'b0000000-0000-0000-0000-000000000001';

-- ═══ Stage 10: grants & RLS denials per role, emergency controls, waiting room, abuse limits, bans, policies, fees, versions, billing, health ═══
delete from rate_hits;
update box_offices set settings = settings || '{"feePct":0,"feeFixed":100,"taxPct":5}' where id = 'b0000000-0000-0000-0000-000000000001';
insert into members(box_office_id, email, name, perms) values ('b0000000-0000-0000-0000-000000000001', 'gate@box.test', 'Gate', '{door.scan,door.checkin,door.attendees}');
insert into auth.users(email, email_confirmed_at) values ('gate@box.test', now()), ('other-owner@box2.test', now());
insert into box_offices(id, slug, name, status, owner, settings) values ('b0000000-0000-0000-0000-000000000002', 'other-box', 'Other Box', 'active', 'other-owner@box2.test', '{}');
insert into members(box_office_id, email, name, perms) values ('b0000000-0000-0000-0000-000000000002', 'other-owner@box2.test', 'Other', '{}');
insert into events(id, box_office_id, slug, status, data) values ('e0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000001', 'fest-ten', 'published', '{
  "name":"Fest Ten","start":"2099-03-01T20:00:00Z","currency":"USD","visibility":"link","timeSlots":[],"taxPct":10,
  "ticketTypes":[{"id":"gen","name":"General","price":4000,"qty":100,"admits":1,"fee":{"pct":"","fixed":300,"payer":""}}],"addons":[],
  "fees":{"passProcessing":"no","extra":[{"id":"fx1","name":"Facility fee","pct":"","fixed":200,"per":"ticket","optional":false},{"id":"fx2","name":"Protection","pct":5,"fixed":"","per":"order","optional":true}]},
  "terms":"Fest terms v1","checkout":{"phone":"required"},"donation":{"purpose":"Music fund"},"contact":{"email":"fest@box.test","team":"Fest crew"}}');
insert into events(id, box_office_id, slug, status, data) values ('e0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000001', 'free-ten', 'published',
  '{"name":"Free Ten","start":"2099-04-01T20:00:00Z","currency":"USD","visibility":"public","timeSlots":[],"ticketTypes":[{"id":"free","name":"Free","price":0,"qty":100,"admits":1}],"addons":[]}');
-- grants: nobody reads orders / tickets / money tables directly
set role authenticated; select t.who('gate@box.test');
select t.err($$select price_paid from tickets$$, 'permission denied|does not exist', 'S10 door staff cannot read ticket prices straight from the table');
select t.err($$select paid, fee, tax from tickets limit 1$$, 'permission denied', 'S10 door staff: ticket money columns are not readable');
select t.err($$select * from outbox limit 1$$, 'permission denied', 'S10 staff cannot read the outbox directly');
select t.err($$select * from bans$$, 'permission denied', 'S10 bans are not readable directly');
select t.err($$select * from error_log$$, 'permission denied', 'S10 the error log is not readable directly');
select t.ok(jsonb_array_length(admin_load('b0000000-0000-0000-0000-000000000001')->'tickets') > 0 and (select bool_and(x->'paid' = 'null'::jsonb or not (x ? 'paid')) from jsonb_array_elements(admin_load('b0000000-0000-0000-0000-000000000001')->'tickets') x), 'S10 door staff get tickets through admin_load — with the money masked');
select t.err($$update events set controls = '{"salesPaused":true}' where id = 'e0000000-0000-0000-0000-000000000010'$$, 'permission denied', 'S10 the emergency-control column can''t be written directly');
select t.err($$select event_control('e0000000-0000-0000-0000-000000000010', '{"salesPaused":true}')$$, 'permission', 'S10 emergency controls need events.controls');
select t.who('other-owner@box2.test');
select t.ok((admin_load('b0000000-0000-0000-0000-000000000001')->'bo'->>'id') = 'b0000000-0000-0000-0000-000000000002', 'S10 strict box office separation: another box office''s owner only ever loads their own');
select t.err($$select event_control('e0000000-0000-0000-0000-000000000010', '{"salesPaused":true}')$$, 'permission', 'S10 another box office can''t pause this one''s event');
select t.err($$select ban_customer('b0000000-0000-0000-0000-000000000001', 'x@y.test', 'r')$$, 'permission', 'S10 another box office can''t ban this one''s customers');
select t.err($$select platform_health()$$, 'super admins', 'S10 system health is for super admins only');
select t.err($$select billing_run('2099-01')$$, 'super admins', 'S10 only super admins run billing');
select t.err($$select set_plan('b0000000-0000-0000-0000-000000000001', 'pro')$$, 'owner', 'S10 only the owner (or a super admin) changes the plan');
reset role;
set role anon; select t.who('');
select t.ok((select controls from events where id = 'e0000000-0000-0000-0000-000000000011') = '{}', 'S10 buyers can see an event''s controls (to show "paused")');
select t.err($$select * from orders$$, 'permission denied', 'S10 buyers cannot read orders');
select t.err($$select platform_overview()$$, 'permission denied|super admins', 'S10 buyers cannot open the platform dashboard');
select t.err($$select event_control('e0000000-0000-0000-0000-000000000010', '{"salesPaused":true}')$$, 'permission denied', 'S10 buyers cannot run staff functions');
reset role;
-- fees & taxes per event, policies, checkout form, donations
set role anon; select t.who('');
select t.err($$select place_order('{"buyer":{"name":"F","email":"f10@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000010","ticketTypeId":"gen","qty":2}],"payment":"offline"}')$$, 'mobile', 'S10 the event''s checkout form requires a mobile number');
select t.err($$select place_order('{"buyer":{"name":"F","email":"f10@mail.test","phone":"+12125550100"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000010","ticketTypeId":"gen","qty":2}],"payment":"offline"}')$$, 'accept', 'S10 the policies must be accepted');
select place_order(('{"buyer":{"name":"F","email":"f10@mail.test","phone":"+12125550100"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000010","ticketTypeId":"gen","qty":2}],"optFees":["fx2"],"donation":500,"payment":"offline","accepted":[{"kind":"terms","eventId":"e0000000-0000-0000-0000-000000000010","version":"' || fnv('Fest terms v1') || '"}]}')::jsonb)->>'id' as f10 \gset
reset role;
select t.ok((data->>'fee')::bigint = 600 and (data->>'otherFee')::bigint = 400 + 400 and jsonb_array_length(data->'otherFees') = 2, 'S10 ticket-type booking fee ($3) + mandatory facility fee + optional 5% fee') from orders where id = :'f10';
select t.ok((data->>'tax')::bigint = 800 and (data->>'total')::bigint = 8000 + 600 + 800 + 800 + 500, 'S10 the event''s own tax rate (10%); everything stored separately') from orders where id = :'f10';
select t.ok(data->'accepted'->0->>'version' = fnv('Fest terms v1') and data->>'donationFor' = 'Music fund' and exists(select 1 from policy_texts where version = fnv('Fest terms v1')), 'S10 accepted policy version + time stored; donation purpose stored') from orders where id = :'f10';
select t.ok(fnv('é ok') = '1ba406ad', 'S10 policy fingerprint matches the browser''s (UTF-8)');
select t.who('root@platform.test'); update events set data = data || '{"terms":"Fest terms v2"}' where id = 'e0000000-0000-0000-0000-000000000010';
set role anon; select t.who('');
select t.err($$select place_order(('{"buyer":{"name":"F","email":"f11@mail.test","phone":"+12125550100"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000010","ticketTypeId":"gen","qty":1}],"payment":"offline","accepted":[{"kind":"terms","eventId":"e0000000-0000-0000-0000-000000000010","version":"' || fnv('Fest terms v1') || '"}]}')::jsonb)$$, 'changed', 'S10 a policy changed during checkout → old version refused');
-- abuse protection
reset role; select t.who('root@platform.test'); update events set data = jsonb_set(data, '{ticketTypes,0,price}', '0') where id = 'e0000000-0000-0000-0000-000000000002';
set role anon; select t.who('');
select t.err($$select place_order('{"buyer":{"name":"B","email":"b10@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000002","ticketTypeId":"ga","qty":1}],"payment":"offline","bot":{"hp":"x"}}')$$, 'Checkout failed', 'S10 honeypot field → refused');
select place_order('{"buyer":{"name":"B","email":"v10@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000002","ticketTypeId":"ga","qty":1}],"payment":"free","bot":{"ms":300}}')->>'id' as v1 \gset
reset role;
select t.ok(data->'flags' ? 'bot', 'S10 an automated-looking checkout is flagged') from orders where id = :'v1';
set role anon; select t.who('');
select place_order('{"buyer":{"name":"B","email":"v10@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000002","ticketTypeId":"ga","qty":1}],"payment":"free"}')->>'id' as v2 \gset
select place_order('{"buyer":{"name":"B","email":"v10@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000002","ticketTypeId":"ga","qty":1}],"payment":"free"}')->>'id' as v3 \gset
reset role;
select t.ok(data->'flags' ? 'velocity' and data->'flags' ? 'duplicate', 'S10 third order from one email in an hour → velocity + duplicate flags') from orders where id = :'v3';
update orders set created_at = now() where buyer_email = 'v10@mail.test';
insert into orders(box_office_id, ref, status, buyer_email, event_ids, data) select 'b0000000-0000-0000-0000-000000000001', 'SET-VEL' || g, 'paid', 'v10@mail.test', '{e0000000-0000-0000-0000-000000000002}', '{"lines":[],"total":0}' from generate_series(1, 12) g;
set role anon; select t.who('');
select t.err($$select place_order('{"buyer":{"name":"B","email":"v10@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000002","ticketTypeId":"ga","qty":1}],"payment":"free"}')$$, 'Too many orders', 'S10 velocity limit per email per hour');
reset role; delete from rate_hits; insert into rate_hits(key) select 'order:local' from generate_series(1, 20);
set role anon; select t.who('');
select t.err($$select place_order('{"buyer":{"name":"B","email":"r10@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000002","ticketTypeId":"ga","qty":1}],"payment":"free"}')$$, 'Too many checkout attempts', 'S10 rate limit per connection');
reset role; delete from rate_hits;
-- bans
set role authenticated; select t.who('owner@box.test');
select ban_customer('b0000000-0000-0000-0000-000000000001', 'banned10@mail.test', 'Resale bot');
reset role; set role anon; select t.who('');
select t.err($$select place_order('{"buyer":{"name":"B","email":"banned10@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000002","ticketTypeId":"ga","qty":1}],"payment":"free"}')$$, 'contact the box office', 'S10 a banned customer can''t buy');
reset role; set role authenticated; select t.who('owner@box.test');
select unban_customer((select id from t.bans_v where email = 'banned10@mail.test'));
reset role; set role anon; select t.who('');
select t.ok(place_order('{"buyer":{"name":"B","email":"banned10@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000002","ticketTypeId":"ga","qty":1}],"payment":"free"}')->>'status' = 'paid', 'S10 ban removed → can buy again');
reset role;
select t.ok((select removed_by from bans where email = 'banned10@mail.test') = 'owner@box.test' and exists(select 1 from audit_log where kind = 'customers.ban'), 'S10 bans and their removal are on record');
-- emergency controls
set role authenticated; select t.who('owner@box.test');
select event_control('e0000000-0000-0000-0000-000000000002', '{"salesPaused":true,"message":"Back at 2"}');
reset role; set role anon; select t.who('');
select t.err($$select place_order('{"buyer":{"name":"B","email":"c10@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000002","ticketTypeId":"ga","qty":1}],"payment":"free"}')$$, 'Back at 2', 'S10 pause sales: orders refused with the organizer''s message');
select t.ok(place_order('{"buyer":{"name":"B","email":"c10@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000011","ticketTypeId":"free","qty":1}],"payment":"free"}')->>'status' = 'paid', 'S10 other events keep selling');
reset role; set role authenticated; select t.who('owner@box.test');
select event_control('e0000000-0000-0000-0000-000000000002', '{"salesPaused":false}');
select event_control('e0000000-0000-0000-0000-000000000003', '{"scanPaused":true}');
select t.ok(checkin((select code from t.tickets where event_id = 'e0000000-0000-0000-0000-000000000003' and status = 'valid' limit 1), false, 'e0000000-0000-0000-0000-000000000003', '{}')->>'result' = 'paused', 'S10 stop scanning → "paused"');
select event_control('e0000000-0000-0000-0000-000000000003', '{"scanPaused":false}');
select t.ok((select count(*) from audit_log where kind = 'event.controls') >= 3, 'S10 every emergency control is logged');
update events set data = data || '{"name":"GA Party!"}' where id = 'e0000000-0000-0000-0000-000000000002';
select t.ok(exists(select 1 from t.versions_v where target = 'e0000000-0000-0000-0000-000000000002' and 'details' = any(sections) and by = 'owner@box.test'), 'S10 event saves keep a version (what changed, who)');
select pause_gateway('b0000000-0000-0000-0000-000000000001', true);
reset role; set role anon; select t.who('');
select t.err($$select place_order(('{"buyer":{"name":"F","email":"g10@mail.test","phone":"+12125550100"},"items":[{"eventId":"e0000000-0000-0000-0000-000000000010","ticketTypeId":"gen","qty":1}],"payment":"card","accepted":[{"kind":"terms","eventId":"e0000000-0000-0000-0000-000000000010","version":"' || fnv('Fest terms v2') || '"}]}')::jsonb)$$, 'paused', 'S10 a paused processor takes no card payments');
reset role; set role authenticated; select t.who('owner@box.test'); select pause_gateway('b0000000-0000-0000-0000-000000000001', false); reset role;
-- waiting room
select t.who('root@platform.test'); update events set data = data || '{"queue":{"on":true,"rate":60,"passMinutes":20}}' where id = 'e0000000-0000-0000-0000-000000000010';
set role anon; select t.who('');
select t.ok(queue_status('e0000000-0000-0000-0000-000000000010', 'token-first-0001')->>'admitted' = 'true', 'S10 waiting room: first arrival goes straight in');
select t.ok((queue_status('e0000000-0000-0000-0000-000000000010', 'token-second-001')->>'position')::int = 1 and queue_status('e0000000-0000-0000-0000-000000000010', 'token-third-0001')->>'position' = '2', 'S10 later arrivals queue in order');
select t.err($$select place_order(('{"buyer":{"name":"F","email":"q10@mail.test","phone":"+12125550100"},"holdToken":"token-third-0001","items":[{"eventId":"e0000000-0000-0000-0000-000000000010","ticketTypeId":"gen","qty":1}],"payment":"offline","accepted":[{"kind":"terms","eventId":"e0000000-0000-0000-0000-000000000010","version":"' || fnv('Fest terms v2') || '"}]}')::jsonb)$$, 'waiting room', 'S10 no pass → no checkout');
select t.ok(place_order(('{"buyer":{"name":"F","email":"q11@mail.test","phone":"+12125550100"},"holdToken":"token-first-0001","items":[{"eventId":"e0000000-0000-0000-0000-000000000010","ticketTypeId":"gen","qty":1}],"payment":"offline","accepted":[{"kind":"terms","eventId":"e0000000-0000-0000-0000-000000000010","version":"' || fnv('Fest terms v2') || '"}]}')::jsonb)->>'status' = 'pending', 'S10 admitted visitor checks out');
-- customer service routing
select t.ok(contact_organizer('e0000000-0000-0000-0000-000000000010', null, '{"name":"Q","email":"cs10@mail.test","body":"Is there parking?"}')->>'routed' = 'Fest crew', 'S10 contact form routed to the event''s team');
reset role;
select t.ok((select routed_to from support_messages where email = 'cs10@mail.test') = 'fest@box.test' and exists(select 1 from outbox where "to" = 'fest@box.test' and category = 'staff'), 'S10 the event''s contact gets the message by email');
set role authenticated; select t.who('owner@box.test');
select support_action((select id from t.support_v where email = 'cs10@mail.test'), 'reply', '{"body":"Yes, at Pier 17."}');
reset role;
select t.ok((select status from support_messages where email = 'cs10@mail.test') = 'answered' and exists(select 1 from outbox where "to" = 'cs10@mail.test' and body like '%Pier 17%'), 'S10 staff reply from the inbox');
-- versions, plans, billing, incidents, health, API scopes, domains
set role authenticated; select t.who('owner@box.test');
update box_offices set settings = settings || '{"terms":"Box terms v2"}' where id = 'b0000000-0000-0000-0000-000000000001';
select t.err($$update box_offices set plan = 'venue' where id = 'b0000000-0000-0000-0000-000000000001'$$, 'Plan and domains', 'S10 plan can''t be set by an ordinary settings update');
select set_plan('b0000000-0000-0000-0000-000000000001', 'pro');
reset role;
select t.ok((pricing_settings(b)->'platform'->>'pct')::numeric = 0.5, 'S10 the plan sets the platform fee') from box_offices b where id = 'b0000000-0000-0000-0000-000000000001';
set role authenticated; select t.who('owner@box.test');
select save_domain('b0000000-0000-0000-0000-000000000001', 'tickets.testbox.example');
select t.ok(bo_by_domain('tickets.testbox.example') is null, 'S10 an unverified custom domain doesn''t serve the site');
select t.ok(admin_load('b0000000-0000-0000-0000-000000000001')->'bans' is not null and jsonb_array_length(admin_load('b0000000-0000-0000-0000-000000000001')->'versions') >= 2, 'S10 admin_load: versions + bans for the owner');
select t.who('root@platform.test');
select t.ok(billing_run(to_char(now(), 'YYYY-MM')) >= 1 and billing_run(to_char(now(), 'YYYY-MM')) = 0, 'S10 billing run: invoices once per box office per month');
select save_incident('{"kind":"payment","title":"Cards failing","severity":"major"}');
select t.ok(platform_health()->'parts'->>'payments' = 'down', 'S10 an open incident shows on system health');
select t.ok(jsonb_array_length(platform_overview()->'events') >= 4 and jsonb_array_length(platform_overview()->'staff') >= 3, 'S10 the platform dashboard lists every event and staff member');
reset role;
set role service_role; select domain_result('b0000000-0000-0000-0000-000000000001', 'site', '{"status":"verified"}'); reset role;
set role anon; select t.ok(bo_by_domain('tickets.testbox.example')->>'slug' = 'test-box', 'S10 verified domain → its box office'); reset role;
insert into api_keys(box_office_id, name, prefix, hash, scopes, created_by) values ('b0000000-0000-0000-0000-000000000001', 'k', 'set_live_x', 'h10', '{orders:read,finance:read,events:read}', 'clerk@box.test');
select t.ok((select api_auth('h10')->'scopes') = '["orders:read"]', 'S10 an API key only keeps the scopes its creator still has permission for');
select t.ok(jsonb_typeof(api_read('b0000000-0000-0000-0000-000000000001', 'finance')) = 'array' and jsonb_typeof(api_read('b0000000-0000-0000-0000-000000000001', 'seating')) = 'array', 'S10 API: finance and seating resources');
update box_offices set settings = settings - 'taxPct' || '{"feeFixed":100}' where id = 'b0000000-0000-0000-0000-000000000001';

-- ════════ Final additions: gift cards, memberships / passes, payment plans, purchase rules, pricing, self-service, POS, offline payments, vouchers, wallet ════════
reset role; delete from rate_hits;
update box_offices set branding = branding - 'refundPolicy' - 'privacyPolicy' where id = 'b0000000-0000-0000-0000-000000000001';   -- policies are checked in Stage 10's section
update box_offices set settings = settings - 'terms' || '{"gifts":{"on":true,"amounts":[2500,5000],"custom":true,"min":1000,"max":20000,"days":365},
  "passPlans":[{"id":"season","name":"Season Pass","kind":"season","price":10000,"benefit":"free","uses":2,"perEvent":1,"eventIds":[],"ticketTypeIds":["adult"],"validDays":365,"onSale":true,"max":0},
               {"id":"member","name":"Members","kind":"membership","price":5000,"benefit":"discount","pct":20,"uses":0,"perEvent":0,"eventIds":[],"ticketTypeIds":[],"validDays":365,"onSale":true,"max":0}],
  "installments":{"on":true,"minTotal":10000,"deposit":25,"count":3,"finalDays":14},
  "selfService":{"rename":true,"transfer":true,"resend":true,"seatChange":true}}'::jsonb where id = 'b0000000-0000-0000-0000-000000000001';
insert into events(id, box_office_id, slug, status, data) values ('e0000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-000000000001', 'fa-show', 'published', '{
  "name":"FA Show","start":"2099-03-01T19:00:00Z","timezone":"UTC","currency":"USD","visibility":"public","timeSlots":[{"id":"eve","start":"2099-03-01T19:00:00Z"},{"id":"mat","start":"2099-03-01T13:00:00Z"}],
  "ticketTypes":[{"id":"adult","name":"Adult","price":3000,"qty":0,"admits":1,"peak":[{"label":"Evening","from":"18:00","to":"23:59","price":4000}]},{"id":"child","name":"Child","price":1000,"qty":0,"admits":1},
    {"id":"mem","name":"Members lounge","price":2000,"qty":0,"admits":1,"memberOnly":true,"memberPlans":["member"]}],
  "addons":[{"id":"drink","name":"Drink voucher","price":500,"qty":0,"standalone":false,"redeemable":true}],
  "rules":[{"id":"r1","kind":"requires","ttIds":["child"],"needs":["adult"],"per":2},{"id":"r2","kind":"limit","ttIds":["adult","child"],"max":8}]}'),
  ('e0000000-0000-0000-0000-0000000000f2', 'b0000000-0000-0000-0000-000000000001', 'fa-soon', 'published', jsonb_build_object('name', 'FA Soon', 'start', now() + interval '1 day', 'currency', 'USD', 'visibility', 'public', 'timeSlots', '[]'::jsonb,
    'ticketTypes', '[{"id":"std","name":"Standard","price":3000,"qty":0,"admits":1,"phases":[{"id":"lm","label":"Last-minute","price":3500,"hoursBefore":48}]}]'::jsonb, 'addons', '[]'::jsonb));
-- §6 pricing: peak showtime price (event timezone), last-minute phase
select t.ok((price_cart('{"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":2,"slotId":"eve"}]}', false, '{}', null)->'lines'->0->>'unit')::bigint = 4000
  and (price_cart('{"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":1,"slotId":"mat"}]}', false, '{}', null)->'lines'->0->>'unit')::bigint = 3000, 'FA §6 peak price for the evening showtime, off-peak for the matinee');
select t.ok((price_cart('{"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f2","ticketTypeId":"std","qty":1}]}', false, '{}', null)->'lines'->0->>'unit')::bigint = 3500, 'FA §6 last-minute price in the final 48 hours');
set role anon; select t.who('');
-- §7 purchase rules
select t.err($$select place_order('{"buyer":{"name":"Kid","email":"kid@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"child","qty":1,"slotId":"mat"}],"payment":"offline"}')$$, 'need one Adult', 'FA §7 a child ticket needs an adult ticket');
select t.err($$select place_order('{"buyer":{"name":"Kid","email":"kid@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":1,"slotId":"mat"},{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"child","qty":3,"slotId":"mat"}],"payment":"offline"}')$$, 'need one Adult', 'FA §7 one adult for every 2 children');
select t.ok(place_order('{"buyer":{"name":"Fam","email":"fam@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":1,"slotId":"mat"},{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"child","qty":2,"slotId":"mat"}],"payment":"offline"}')->>'status' = 'pending', 'FA §7 adult + 2 children is allowed');
select t.err($$select place_order('{"buyer":{"name":"Big","email":"big@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":6,"slotId":"mat"},{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"child","qty":3,"slotId":"mat"}],"payment":"offline"}')$$, 'At most 8', 'FA §7 maximum across a combination of ticket types');
-- §4 gift cards: bought online (no tax, no fee), issued to the recipient when paid; amount rules
select t.err($$select place_order('{"buyer":{"name":"Giver","email":"giver@mail.test"},"boxOfficeId":"b0000000-0000-0000-0000-000000000001","gifts":[{"amount":999999}],"payment":"card"}')$$, 'Gift cards are', 'FA §4 gift card amount must be within the limits');
select place_order('{"buyer":{"name":"Giver","email":"giver@mail.test"},"boxOfficeId":"b0000000-0000-0000-0000-000000000001","gifts":[{"amount":5000,"to":"Pat","toEmail":"pat@mail.test","message":"Enjoy!"}],"payment":"card"}') as gr \gset
select t.ok((:'gr'::jsonb)->>'status' = 'awaiting_payment' and ((:'gr'::jsonb)->>'total')::bigint = 5000, 'FA §4 a gift-card-only order: $50, no booking fee or tax');
reset role; set role service_role;
select t.ok(confirm_payment(((:'gr'::jsonb)->>'id')::uuid, '{"amount":5000,"ref":"pi_gift","provider":"stripe"}') = 'issued', 'FA §4 the processor confirms the gift card order');
reset role;
select t.ok(exists(select 1 from t.credits where source_order = ((:'gr'::jsonb)->>'id')::uuid and kind = 'gift' and email = 'pat@mail.test' and amount = 5000 and expires > now() + interval '300 days'), 'FA §4 gift card issued to the recipient, with its expiry');
select t.ok(exists(select 1 from t.outbox where kind = 'gift' and "to" = 'pat@mail.test' and data->>'credit' like 'CR-%'), 'FA §4 the recipient is emailed the code');
select code as gcode from t.credits where source_order = ((:'gr'::jsonb)->>'id')::uuid \gset
set role anon; select t.who('');
select place_order(('{"buyer":{"name":"Pat","email":"pat@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":1,"slotId":"mat"}],"payment":"offline","credit":"' || :'gcode' || '"}')::jsonb) as gu \gset
reset role;
select t.ok((select (credit_state(c)->>'remaining')::bigint from public.credits c where code = :'gcode') = 5000 - (select (data->'credit'->>'amount')::bigint from t.orders where id = ((:'gu'::jsonb)->>'id')::uuid)
  and (select (credit_state(c)->>'remaining')::bigint from public.credits c where code = :'gcode') > 0, 'FA §4 partial use: the balance goes down and stays on the card');
-- §3 memberships / season passes
set role anon; select t.who('');
select place_order('{"buyer":{"name":"Mem","email":"mem@mail.test"},"boxOfficeId":"b0000000-0000-0000-0000-000000000001","passes":[{"planId":"season","qty":1},{"planId":"member","qty":1}],"payment":"card"}') as pr \gset
reset role; set role service_role; select confirm_payment(((:'pr'::jsonb)->>'id')::uuid, '{"amount":15000,"ref":"pi_pass","provider":"stripe"}'); reset role;
select t.ok((select count(*) from t.orders o where id = ((:'pr'::jsonb)->>'id')::uuid and status = 'paid') = 1 and (select count(*) from passes where order_id = ((:'pr'::jsonb)->>'id')::uuid) = 2, 'FA §3 two passes bought and issued');
select code as season from passes where order_id = ((:'pr'::jsonb)->>'id')::uuid and plan_id = 'season' \gset
select code as member from passes where order_id = ((:'pr'::jsonb)->>'id')::uuid and plan_id = 'member' \gset
set role anon; select t.who('');
select t.err($$select place_order('{"buyer":{"name":"X","email":"x@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":1,"slotId":"mat"}],"payment":"offline","pass":"$$ || :'season' || $$"}')$$, 'email the pass belongs', 'FA §3 a pass only works for its holder''s email');
select t.err($$select place_order('{"buyer":{"name":"Mem","email":"mem@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"mem","qty":1,"slotId":"mat"}],"payment":"offline"}')$$, 'for members', 'FA §3 members-only tickets need a membership');
select place_order(('{"buyer":{"name":"Mem","email":"mem@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":2,"slotId":"mat"}],"payment":"card","pass":"' || :'season' || '"}')::jsonb) as so \gset
select t.ok(((:'so'::jsonb)->>'total')::bigint = 3100, 'FA §3 season pass: one ticket (and its booking fee) covered per event, the second one paid ($30 + $1 fee)');
reset role; set role service_role; select confirm_payment(((:'so'::jsonb)->>'id')::uuid, '{"amount":3100,"ref":"pi_so","provider":"stripe"}'); reset role;
select t.ok((select count(*) from t.tickets where order_id = ((:'so'::jsonb)->>'id')::uuid and pass is not null) = 1 and (select pass_state(x)->>'used' from passes x where code = :'season') = '1'
  and (select pass_state(x)->>'left' from passes x where code = :'season') = '1', 'FA §3 usage tracking: the covered ticket carries the pass; 1 of 2 uses left');
set role anon; select t.who('');
select t.ok((place_order(('{"buyer":{"name":"Mem","email":"mem@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"mem","qty":1,"slotId":"mat"},{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":1,"slotId":"mat"}],"payment":"offline","pass":"' || :'member' || '"}')::jsonb)->>'total')::bigint = 4200,
  'FA §3 membership: unlocks members-only tickets and takes 20% off ($20 + $30 → $40, + $2 booking fees)');
select t.ok(check_pass('b0000000-0000-0000-0000-000000000001', :'season', 'mem@mail.test')->>'status' = 'active' and check_pass('b0000000-0000-0000-0000-000000000001', 'MP-NOPE', '') ? 'error', 'FA §3 check_pass: public rules of a valid pass, an error for a bad code');
select t.err($$select * from passes$$, 'permission denied', 'FA buyers cannot read passes');
select t.err($$select * from vouchers$$, 'permission denied', 'FA buyers cannot read vouchers');
-- §5 payment plan: deposit, installments, tickets only when paid in full
select place_order('{"buyer":{"name":"Planner","email":"plan@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":4,"slotId":"mat"}],"payment":"card","installments":true}') as pl \gset
select t.ok(((:'pl'::jsonb)->>'due')::bigint < ((:'pl'::jsonb)->>'total')::bigint and (:'pl'::jsonb)->>'status' = 'awaiting_payment', 'FA §5 payment plan: only the deposit is due now');
select t.err($$select place_order('{"buyer":{"name":"P","email":"p2@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":1,"slotId":"mat"}],"payment":"card","installments":true}')$$, 'payment plan isn', 'FA §5 small orders can''t use a plan (minimum total)');
reset role; set role service_role;
select t.ok(confirm_payment(((:'pl'::jsonb)->>'id')::uuid, json_build_object('amount', ((:'pl'::jsonb)->>'due')::bigint, 'ref', 'pi_dep', 'provider', 'stripe')::jsonb) = 'deposit', 'FA §5 the deposit is confirmed');
reset role;
select t.ok((select status from t.orders where id = ((:'pl'::jsonb)->>'id')::uuid) = 'pending' and not exists(select 1 from t.tickets where order_id = ((:'pl'::jsonb)->>'id')::uuid), 'FA §5 seats held, no tickets yet');
set role service_role;
select pay_installment(((:'pl'::jsonb)->>'id')::uuid, '{"method":"card","ref":"pi_i1","provider":"stripe"}');
select t.ok(pay_installment(((:'pl'::jsonb)->>'id')::uuid, '{"method":"card","ref":"pi_i1","provider":"stripe"}') = 'already', 'FA §5 the same installment payment arriving twice is recorded once');
select record_processor_tx('{"id":"ch_i1","payment":"pi_i1","type":"charge","amount":100,"provider":"stripe"}');
select t.ok((select order_id from processor_tx where id = 'ch_i1') = ((:'pl'::jsonb)->>'id')::uuid, 'FA §5 an installment''s own processor payment is linked to its order');
reset role;
set role authenticated; select t.who('owner@box.test');
select order_action(((:'pl'::jsonb)->>'id')::uuid, 'installment', '{"method":"zelle","ref":"ZL-1"}');
select t.err($$select order_action('$$ || ((:'pl'::jsonb)->>'id') || $$', 'markPaid', '{}')$$, 'installment', 'FA §5 a part-paid plan is finished by installments, not "mark paid"');
select order_action(((:'pl'::jsonb)->>'id')::uuid, 'installment', '{"method":"cash"}');
reset role;
select t.ok((select status from t.orders where id = ((:'pl'::jsonb)->>'id')::uuid) = 'paid' and (select count(*) from t.tickets where order_id = ((:'pl'::jsonb)->>'id')::uuid and status = 'valid') = 4
  and plan_paid((select data->'plan' from t.orders where id = ((:'pl'::jsonb)->>'id')::uuid)) = (select (data->>'total')::bigint from t.orders where id = ((:'pl'::jsonb)->>'id')::uuid), 'FA §5 last installment → paid in full, tickets issued');
-- a card refund on a plan goes back to the card installments (newest first), never more than the card took in
select (select sum((x->>'amount')::bigint) from t.orders o, jsonb_array_elements(o.data->'plan'->'schedule') x where o.id = ((:'pl'::jsonb)->>'id')::uuid and x->>'ref' in ('pi_dep','pi_i1')) as cardpaid,
  (select (x->>'amount')::bigint from t.orders o, jsonb_array_elements(o.data->'plan'->'schedule') x where o.id = ((:'pl'::jsonb)->>'id')::uuid and x->>'ref' = 'pi_i1') as i1amt \gset
set role authenticated; select t.who('owner@box.test');
select t.err(format($$select order_action('%s', 'refund', '{"mode":"amount","amount":%s,"to":"original"}')$$, (:'pl'::jsonb)->>'id', :cardpaid + 1), 'can go back to the card', 'FA §5 a plan''s card refund can''t exceed what was paid by card');
select order_action(((:'pl'::jsonb)->>'id')::uuid, 'refund', json_build_object('mode', 'amount', 'amount', :i1amt + 100, 'to', 'original')::jsonb) as prf \gset
reset role;
select t.ok((:'prf'::jsonb)->'refund'->'parts' = json_build_array(json_build_object('payment', 'pi_i1', 'amount', :i1amt), json_build_object('payment', 'pi_dep', 'amount', 100))::jsonb,
  'FA §5 the card refund is split over the installments paid by card, newest first');
select t.ok(marketing_tick() >= 0, 'FA §5 reminders run without error');
-- §9 offline / manual payments + §2 door sales
insert into members(box_office_id, email, name, perms) values ('b0000000-0000-0000-0000-000000000001', 'seller@box.test', 'Seller', '{door.sell,door.scan,door.checkin}');
insert into auth.users(email, email_confirmed_at) values ('seller@box.test', now());
set role authenticated; select t.who('owner@box.test');
select place_order('{"buyer":{"name":"Invoice Co","email":"inv@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":2,"slotId":"mat"}],"payment":"manual","payMethod":"invoice","unpaid":true,"payNotes":"Net 30","payRef":"INV-7"}') as iv \gset
select t.ok((:'iv'::jsonb)->>'status' = 'pending' and (select payment->>'status' = 'unpaid' and payment->>'notes' = 'Net 30' and payment->>'method' = 'invoice' and (payment->>'amount')::bigint = 6200 and payment->>'by' = 'owner@box.test' and payment ? 'date' from t.orders where id = ((:'iv'::jsonb)->>'id')::uuid), 'FA §9 an unpaid invoice order records amount, method, date, admin, notes and unpaid');
select order_action(((:'iv'::jsonb)->>'id')::uuid, 'markPaid', '{"method":"zelle","date":"2099-01-05","ref":"ZL-99"}');
select t.ok((select status = 'paid' and payment->>'status' = 'paid' and payment->>'paidDate' = '2099-01-05' and payment->>'method' = 'zelle' from t.orders where id = ((:'iv'::jsonb)->>'id')::uuid), 'FA §9 marked paid by Zelle: date + reference kept');
select t.who('seller@box.test');
select t.err($$select place_order('{"buyer":{"name":"Walk","email":"walk@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":1,"slotId":"mat"}],"payment":"manual","payMethod":"cash"}')$$, 'permission', 'FA §2 door staff only sell through the door-sales screen (pos)');
select place_order('{"buyer":{"name":"Walk","email":"walk@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":1,"slotId":"mat"}],"addons":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","addonId":"drink","qty":2}],"payment":"manual","payMethod":"cash","pos":true}') as ps \gset
select place_order('{"buyer":{"name":"Tap","email":"tap@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":1,"slotId":"mat"}],"payment":"terminal","pos":true}') as pt \gset
reset role;
select t.ok((select status = 'paid' and data->>'channel' = 'pos' from t.orders where id = ((:'ps'::jsonb)->>'id')::uuid) and (select count(*) from t.tickets where order_id = ((:'ps'::jsonb)->>'id')::uuid) = 1, 'FA §2 a cash door sale: paid, tickets issued at once');
select t.ok((select status = 'awaiting_payment' and (payment->>'terminal')::boolean from t.orders where id = ((:'pt'::jsonb)->>'id')::uuid), 'FA §2 a card-reader door sale waits for the processor');
-- §11 product vouchers: own QR, redeemed separately, voided when the product is removed
select t.ok((select count(*) from vouchers where order_id = ((:'ps'::jsonb)->>'id')::uuid and addon_id = 'drink' and status = 'valid') = 2, 'FA §11 one voucher per redeemable product unit');
select code as vc from vouchers where order_id = ((:'ps'::jsonb)->>'id')::uuid order by created_at limit 1 \gset
set role authenticated; select t.who('seller@box.test');
select t.ok(checkin(:'vc', false, 'e0000000-0000-0000-0000-0000000000f1', '{}')->>'result' = 'item_ok', 'FA §11 scanning a drink voucher redeems it');
select t.ok(checkin(:'vc', false, 'e0000000-0000-0000-0000-0000000000f1', '{}')->>'result' = 'item_used', 'FA §11 a second scan: already redeemed');
select t.ok(checkin(:'vc', false, 'e0000000-0000-0000-0000-000000000002', '{}')->>'result' = 'wrong_event', 'FA §11 a voucher for another event is refused');
select t.who('owner@box.test');
select order_action(((:'ps'::jsonb)->>'id')::uuid, 'removeAddon', jsonb_build_object('line', (select (n - 1)::int from t.orders o, jsonb_array_elements(o.data->'lines') with ordinality z(l, n) where o.id = ((:'ps'::jsonb)->>'id')::uuid and l->>'kind' = 'addon'), 'qty', 1));
reset role;
select t.ok((select count(*) filter (where status = 'void') = 1 and count(*) filter (where status = 'redeemed') = 1 from vouchers where order_id = ((:'ps'::jsonb)->>'id')::uuid), 'FA §11 removing a product voids an unredeemed voucher');
-- §8 customer self-service (order key; only what the box office switched on)
select id as sso, access_key as ssk from t.orders where id = ((:'so'::jsonb)->>'id')::uuid \gset
select id as sst, code as ssc from t.tickets where order_id = :'sso' and status = 'valid' order by id limit 1 \gset
set role anon; select t.who('');
select self_service(:'sso', :'ssk', 'rename', json_build_object('ticket', :'sst', 'name', 'New Name')::jsonb);
select t.ok((select holder from t.tickets where id = :'sst') = 'New Name', 'FA §8 the customer changes the name on a ticket');
select self_service(:'sso', :'ssk', 'transfer', json_build_object('ticket', :'sst', 'name', 'Friend', 'email', 'friend@mail.test')::jsonb) as tr \gset
select t.ok((select status from t.tickets where id = :'sst') = 'replaced' and (select holder_email = 'friend@mail.test' and status = 'valid' and code <> :'ssc' from t.tickets where id = ((:'tr'::jsonb)->>'ticket')::uuid)
  and exists(select 1 from t.outbox where kind = 'transfer' and "to" = 'friend@mail.test'), 'FA §8 transfer: new QR for the new holder, emailed; the old one is replaced');
select t.err($$select self_service('$$ || :'sso' || $$', '$$ || :'ssk' || $$', 'refund', '{}')$$, 'doesn''t offer', 'FA §8 switched-off features are refused (refund requests are off)');
select t.err($$select self_service('$$ || :'sso' || $$', gen_random_uuid(), 'resend', '{}')$$, 'not found', 'FA §8 the order''s private key is required');
select self_service(:'sso', :'ssk', 'seatChange', '{"body":"Aisle please"}');
reset role;
select t.ok(exists(select 1 from t.support_v where ref = (select ref from t.orders where id = :'sso') and request = 'seatChange' and status = 'open'), 'FA §8 a seat-change request lands in the customer-service inbox');
set role authenticated; select t.who('seller@box.test');
select t.ok(checkin(:'ssc', false, 'e0000000-0000-0000-0000-0000000000f1', '{}')->>'result' = 'replaced', 'FA §8 the transferred ticket''s old code no longer scans');
reset role;
-- §1 wallet passes
set role service_role;
select t.ok(wallet_ticket(:'sso', :'ssk', ((:'tr'::jsonb)->>'ticket')::uuid)->>'holder' = 'Friend' and wallet_ticket(:'sso', gen_random_uuid(), ((:'tr'::jsonb)->>'ticket')::uuid) is null, 'FA §1 the wallet pass data needs the order key');
reset role;
insert into wallet_devices(device, push_token, pass_type, serial) values ('dev1', 'tok1', 'pass.test', ((:'tr'::jsonb)->>'ticket')::uuid);
set role authenticated; select t.who('owner@box.test');
select order_action(:'sso', 'reissue', json_build_object('tickets', json_build_array(((:'tr'::jsonb)->>'ticket')))::jsonb);
reset role;
select t.ok(exists(select 1 from wallet_push where ticket_id = ((:'tr'::jsonb)->>'ticket')::uuid), 'FA §1 a replaced ticket is queued to update the phone wallet');
-- §3 / §4 staff issue memberships + gift vouchers (own permission)
set role authenticated; select t.who('clerk@box.test');
select t.err($$select pass_action('b0000000-0000-0000-0000-000000000001', 'issue', '{"planId":"member","email":"vip@mail.test"}')$$, 'permission', 'FA §3 issuing memberships needs its permission');
select t.who('owner@box.test');
select t.ok(pass_action('b0000000-0000-0000-0000-000000000001', 'issue', '{"planId":"member","email":"vip@mail.test","name":"VIP"}')->>'code' like 'MP-%', 'FA §3 staff issue a membership');
select t.ok(credit_action('b0000000-0000-0000-0000-000000000001', 'issue', '{"kind":"voucher","email":"vip@mail.test","amount":2500}')->>'kind' = 'voucher', 'FA §4 staff issue a gift voucher');
reset role;

-- ════════ Platform billing: credits plan (Ticket Tailor style) and flat-fee plan ════════
select t.ok(plat_credits('[{"kind":"ticket","qty":2,"unit":1000},{"kind":"ticket","qty":3,"unit":2000,"seats":["A-1","A-2","A-3"]},{"kind":"ticket","qty":4,"unit":0},{"kind":"addon","qty":1,"unit":500}]',
  '{"ga":1,"seated":2,"prepaid":5}') = '{"n":8,"prepaid":5,"billable":3}', 'BILL credits: 1 per general-admission ticket, 2 per reserved seat, free tickets and products free; prepaid first');
set role authenticated; select t.who('owner@box.test');
select set_plan('b0000000-0000-0000-0000-000000000001', 'credits');
reset role;
select t.ok((pricing_settings(b)->'platform') @> '{"basis":"credits","ga":1,"seated":2,"unit":75}', 'BILL the credits plan sets how credits are counted and priced') from box_offices b where id = 'b0000000-0000-0000-0000-000000000001';
select place_order('{"buyer":{"name":"Payg","email":"payg@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":2,"slotId":"mat"}],"payment":"offline"}') as bg1 \gset
select t.ok((select (data->>'platformFee')::bigint = 150 and data->'platCredits' = '{"n":2,"prepaid":0,"billable":2}' from t.orders where id = ((:'bg1'::jsonb)->>'id')::uuid),
  'BILL no prepaid credits: 2 GA tickets cost 2 credits at the pay-as-you-go price ($1.50)');
set role authenticated; select t.who('clerk@box.test');
select t.err($$select buy_credits('b0000000-0000-0000-0000-000000000001', 0)$$, 'owner', 'BILL only the owner buys credit packs');
select t.who('owner@box.test');
select t.ok((buy_credits('b0000000-0000-0000-0000-000000000001', 0)->>'total')::bigint = 60000, 'BILL owner buys 1,000 credits at $0.60 → a $600 credits invoice');
select t.err($$select buy_credits('b0000000-0000-0000-0000-000000000001', 9)$$, 'credit pack', 'BILL an unknown pack is refused');
reset role;
select plat_credit_balance('b0000000-0000-0000-0000-000000000001') as bal0 \gset
select place_order('{"buyer":{"name":"Pre","email":"pre@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":3,"slotId":"mat"}],"payment":"offline"}') as bg2 \gset
select t.ok((select (data->>'platformFee')::bigint = 0 and (data->'platCredits'->>'prepaid')::int = 3 from t.orders where id = ((:'bg2'::jsonb)->>'id')::uuid)
  and plat_credit_balance('b0000000-0000-0000-0000-000000000001') = :bal0 - 3, 'BILL prepaid credits are used first (no per-order fee) and the balance goes down');
set role authenticated; select t.who('owner@box.test');
select place_order('{"buyer":{"name":"Guest","email":"comp@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":2,"slotId":"mat"}],"payment":"manual","comp":true}') as bgc \gset
reset role;
select t.ok((select not (data ? 'platCredits') and (data->>'platformFee')::bigint = 0 from t.orders where id = ((:'bgc'::jsonb)->>'id')::uuid), 'BILL complimentary tickets use no credits');
-- flat fee: no per-ticket fee; the yearly fee lands in the month the box office joined
set role authenticated; select t.who('owner@box.test');
select set_plan('b0000000-0000-0000-0000-000000000001', 'flat');
reset role;
select place_order('{"buyer":{"name":"Flat","email":"flat@mail.test"},"items":[{"eventId":"e0000000-0000-0000-0000-0000000000f1","ticketTypeId":"adult","qty":1,"slotId":"mat"}],"payment":"offline"}') as bg3 \gset
select t.ok((select (data->>'platformFee')::bigint from t.orders where id = ((:'bg3'::jsonb)->>'id')::uuid) = 0, 'BILL flat plan: no platform fee on orders');
select t.ok((billing_for(b, to_char(b.created_at, 'YYYY-MM'))->>'flat')::bigint = 200000 and (billing_for(b, to_char(b.created_at + interval '1 month', 'YYYY-MM'))->>'flat')::bigint = 0,
  'BILL flat yearly fee ($2,000) is billed once a year, in the joining month') from box_offices b where id = 'b0000000-0000-0000-0000-000000000001';
set role authenticated; select t.who('root@platform.test');
select billing_run(to_char(now() + interval '1 year', 'YYYY-MM'));   -- next year's joining month (this month was already invoiced above)
reset role;
select t.ok(exists(select 1 from platform_invoices where box_office_id = 'b0000000-0000-0000-0000-000000000001' and kind = 'monthly' and period = to_char(now() + interval '1 year', 'YYYY-MM') and lines::text like '%yearly fee%')
  and exists(select 1 from platform_invoices where box_office_id = 'b0000000-0000-0000-0000-000000000001' and kind = 'credits'), 'BILL the monthly invoice carries the flat fee, beside the credits invoice');

\o
\pset tuples_only off
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
\pset tuples_only on
select case when ok then 'PASS ' else 'FAIL ' end || msg from t.results order by n;
