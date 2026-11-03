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
select t.ok(confirm_payment(((:'r2'::jsonb)->>'id')::uuid, json_build_object('amount', (select (data->>'total')::bigint from orders where id = ((:'r2'::jsonb)->>'id')::uuid), 'ref', 'pi_test_1', 'provider', 'stripe')::jsonb) = 'issued', 'processor confirms the card payment → tickets issued');
reset role;
select t.ok((select count(*) from tickets where order_id = ((:'r2'::jsonb)->>'id')::uuid and status = 'valid') = 2, 'card order has its 2 tickets');

-- ── staff: direct writes are blocked; everything goes through order_action ──
set role authenticated; select t.who('clerk@box.test');
select t.err($$update orders set status = 'cancelled' where id = '$$ || :'o1' || $$'$$, 'permission denied', 'staff cannot update orders directly');
select t.err($$update tickets set status = 'cancelled'$$, 'permission denied', 'staff cannot update tickets directly');
select t.err($$select order_action('$$ || :'o1' || $$', 'markPaid', '{}')$$, 'permission', 'clerk without orders.edit cannot mark paid');
select t.who('owner@box.test');
select t.ok(order_action(:'o1', 'markPaid', '{"method":"cash"}')->>'status' = 'paid', 'owner marks the reservation paid');
select t.ok((select count(*) from tickets where order_id = :'o1' and status = 'valid') = 2, 'marking paid issued 2 tickets');
select t.ok((select count(*) from order_log where order_id = :'o1' and kind = 'paid') = 1, 'mark-paid is in the order history');

-- move one ticket to another Standard seat (no price difference) → old ticket replaced, new one issued
select id as t1, code as c1 from tickets where order_id = :'o1' and seat = 'A-1' \gset
select t.who('clerk@box.test');
select order_action(:'o1', 'change', json_build_object('changes', json_build_array(json_build_object('ticket', :'t1', 'seat', 'A-5')), 'note', 'wanted the aisle')::jsonb) as ch1 \gset
reset role;
select t.ok((select status from tickets where id = :'t1') = 'replaced' and (select count(*) from tickets where order_id = :'o1' and seat = 'A-5' and status = 'valid' and replaces = :'t1') = 1, 'move: old ticket replaced, new ticket on A-5');
select t.ok((select code from tickets where replaces = :'t1') <> :'c1', 'move: the new ticket has a new code');
select t.ok((select count(*) from seat_log where seat in ('A-1','A-5') and action = 'moved') = 2, 'move: both seats have history');
select t.ok((select data->'tickets'->0->'from'->>'seat' from order_log where order_id = :'o1' and kind = 'change') like '%Seat 1%', 'change log keeps the original seat');
select t.ok((select count(*) from outbox where order_id = :'o1' and kind = 'updated') = 1, 'updated tickets queued for the customer');
set role authenticated; select t.who('owner@box.test');
select t.ok(checkin(:'c1', false, null)->>'result' = 'replaced', 'the replaced ticket no longer gets in (scanner says “replaced”)');

-- upgrade to VIP: $50 more, clerk cannot refund but can collect? (needs orders.edit) → owner collects in cash
select t.who('clerk@box.test');
select t.err($$select order_action('$$ || :'o1' || $$', 'change', '{"changes":[{"ticket":"$$ || (select id from tickets where order_id = :'o1' and seat = 'A-2') || $$","seat":"B-1"}],"settle":"collect","method":"cash"}')$$, 'permission', 'clerk cannot collect money for an upgrade');
select t.who('owner@box.test');
select t.err($$select order_action('$$ || :'o1' || $$', 'change', '{"changes":[{"ticket":"$$ || (select id from tickets where order_id = :'o1' and seat = 'A-2') || $$","seat":"B-1"}]}')$$, 'difference', 'upgrade asks how to settle the difference');
select order_action(:'o1', 'change', json_build_object('changes', json_build_array(json_build_object('ticket', (select id from tickets where order_id = :'o1' and seat = 'A-2' and status = 'valid'), 'seat', 'B-1')), 'settle', 'collect', 'method', 'cash')::jsonb) as up \gset
select t.ok((:'up'::jsonb)->>'net' = '5000', 'upgrade difference = $50 (old $50 → new $100)');
select t.ok((select (data->>'extraPaid')::bigint from orders where id = :'o1') = 5000, 'the $50 collected is recorded on the order');
select t.ok((select paid from tickets where order_id = :'o1' and seat = 'B-1' and status = 'valid') = 10000, 'the VIP ticket now shows $100 paid');
select t.err($$select order_action('$$ || :'o1' || $$', 'change', '{"changes":[{"ticket":"$$ || (select id from tickets where order_id = :'o1' and seat = 'A-5') || $$","seat":"A-3"}]}')$$, 'free', 'cannot move onto a sold seat');

-- downgrade back to Standard with a refund of the difference (processor refund → processing)
select order_action(:'o1', 'change', json_build_object('changes', json_build_array(json_build_object('ticket', (select id from tickets where order_id = :'o1' and seat = 'B-1' and status = 'valid'), 'seat', 'A-1')),
  'downgrade', 'credit')::jsonb) as down \gset
select t.ok((:'down'::jsonb)->>'net' = '-5000' and (:'down'::jsonb)->'refund'->>'credit' like 'CR-%', 'downgrade $50 → issued as a credit code');
select t.ok((select (data->>'credited')::bigint from orders where id = :'o1') = 5000, 'credited amount recorded on the order');

-- refunds on the card order: one ticket + its booking fee, to the card → processing until the processor confirms
select t.who('clerk@box.test');
select t.err($$select order_action('$$ || ((:'r2'::jsonb)->>'id') || $$', 'refund', '{"mode":"full"}')$$, 'permission', 'clerk cannot refund');
select t.who('owner@box.test');
select order_action(((:'r2'::jsonb)->>'id')::uuid, 'refund', json_build_object('mode', 'tickets', 'tickets', json_build_array((select id from tickets where order_id = ((:'r2'::jsonb)->>'id')::uuid and seat = 'A-3')), 'fees', true, 'to', 'original', 'cancel', true, 'seat', 'hold')::jsonb) as rf \gset
select t.ok((:'rf'::jsonb)->'refund'->>'amount' = '5100', 'refund = ticket $50 + its $1 booking fee');
select t.ok((:'rf'::jsonb)->'refund'->>'status' = 'processing', 'a card refund waits for the processor');
reset role;
select t.ok((select status from tickets where order_id = ((:'r2'::jsonb)->>'id')::uuid and seat = 'A-3') = 'cancelled', 'the refunded ticket was cancelled');
select t.ok(exists(select 1 from seat_status where seat = 'A-3' and status = 'held'), 'its seat was kept held');
set role service_role;
select finish_refund(((:'r2'::jsonb)->>'id')::uuid, (:'rf'::jsonb)->'refund'->>'id', '{"ok":false,"error":"card expired"}');
reset role;
select t.ok((select (data->>'refunded')::bigint from orders where id = ((:'r2'::jsonb)->>'id')::uuid) = 0, 'a refund the processor refused is reversed (still refundable)');
set role authenticated; select t.who('owner@box.test');
select t.err($$select order_action('$$ || ((:'r2'::jsonb)->>'id') || $$', 'refund', '{"mode":"amount","amount":999999}')$$, 'at most', 'cannot refund more than was collected');
select order_action(((:'r2'::jsonb)->>'id')::uuid, 'refund', '{"mode":"percent","pct":10,"to":"cash"}') as rp \gset
select t.ok(((:'rp'::jsonb)->'refund'->>'amount')::bigint > 0 and (:'rp'::jsonb)->'refund'->>'status' = 'done', '10% refund in cash, recorded');
select t.ok((select status from orders where id = ((:'r2'::jsonb)->>'id')::uuid) = 'paid', 'refund without cancelling keeps the order paid');

-- products: add one (balance due), remove it with a refund
select t.ok(order_action(:'o1', 'addAddon', '{"eventId":"e0000000-0000-0000-0000-000000000001","addonId":"park","qty":2,"settle":"due"}')->>'status' = 'paid', 'add a product to a paid order');
reset role;
select t.ok((select (data->>'due')::bigint from orders where id = :'o1') = 2000, 'balance due $20 for the added parking');
select t.ok((select availability('e0000000-0000-0000-0000-000000000001')->'ad'->>'park') = '3', 'product stock counts the added parking (1 + 2)');
set role authenticated; select t.who('owner@box.test');
select order_action(:'o1', 'collect', '{"amount":2000,"method":"terminal"}');
reset role;
select t.ok((select (data->>'due')::bigint from orders where id = :'o1') = 0, 'payment recorded clears the balance due');
set role authenticated; select t.who('owner@box.test');
select order_action(:'o1', 'removeAddon', json_build_object('line', (select n - 1 from orders o, jsonb_array_elements(o.data->'lines') with ordinality z(l, n) where o.id = :'o1' and l->>'kind' = 'addon' limit 1), 'qty', 1, 'refund', true, 'to', 'cash')::jsonb);
reset role;
select t.ok((select availability('e0000000-0000-0000-0000-000000000001')->'ad'->>'park') = '2', 'removing a product gives the stock back');

-- customer + holder + notes + messages + resend
set role authenticated; select t.who('clerk@box.test');
select order_action(:'o1', 'holder', json_build_object('ticket', (select id from tickets where order_id = :'o1' and status = 'valid' limit 1), 'name', 'Friend Two')::jsonb);
select order_action(:'o1', 'customer', '{"phone":"555-0101"}');
select t.err($$select order_action('$$ || :'o1' || $$', 'message', '{"subject":"Hi","body":"x"}')$$, 'permission', 'clerk without comms.email cannot message customers');
select t.who('owner@box.test');
select order_action(:'o1', 'message', '{"subject":"Doors at 7","body":"See you then"}');
select order_action(:'o1', 'resend', '{"kind":"tickets"}');
select order_action(:'o1', 'note', '{"body":"VIP friend of the artist"}');
reset role;
select t.ok((select count(*) from outbox where order_id = :'o1' and kind in ('message','tickets')) = 2, 'message + resend are queued and listed on the order');
select t.ok((select count(*) from order_log where order_id = :'o1') >= 9, 'every change is in the order history');
select t.ok((select before->>'phone' from order_log where order_id = :'o1' and kind = 'customer') = '' and (select data->'buyer'->>'phone' from orders where id = :'o1') = '555-0101', 'customer edit keeps the old details in the history');

-- cancel the rest of the order, keeping seats blocked, no refund
set role authenticated; select t.who('owner@box.test');
select order_action(:'o1', 'cancel', '{"all":true,"seat":"block","refund":null}');
reset role;
select t.ok((select count(*) from tickets where order_id = :'o1' and status = 'valid') = 0, 'cancel whole order voids every ticket');
select t.ok((select status from orders where id = :'o1') = 'cancelled', 'cancelled without refund → status cancelled');
select t.ok((select count(*) from seat_status where status = 'blocked' and note like 'Kept from cancelled order%') = 2, 'its seats were kept blocked');

-- credits: the downgrade credit pays part of a new order; revoking stops it
select code as crc from credits where source_order = :'o1' \gset
set role anon; select t.who('');
select t.ok((check_credit('b0000000-0000-0000-0000-000000000001', :'crc')->>'remaining')::bigint = 5000, 'a guest can check a credit code (value only)');
select place_order(json_build_object('buyer', json_build_object('name', 'Fan One', 'email', 'fan@mail.test'), 'items', json_build_array(json_build_object('eventId', 'e0000000-0000-0000-0000-000000000002', 'ticketTypeId', 'ga', 'qty', 1)),
  'payment', 'offline', 'credit', :'crc', 'creditAvail', 999999)::jsonb) as rc \gset
select t.ok((:'rc'::jsonb)->>'total' = '0' and (:'rc'::jsonb)->>'status' = 'paid', 'credit covers a $20 + $1 order; a buyer-supplied creditAvail is ignored');
select t.ok((check_credit('b0000000-0000-0000-0000-000000000001', :'crc')->>'remaining')::bigint = 5000 - 2100, 'credit balance goes down by what was used');
reset role;
set role authenticated; select t.who('owner@box.test');
select credit_action('b0000000-0000-0000-0000-000000000001', 'revoke', json_build_object('id', (select id from credits where code = :'crc'))::jsonb);
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
select t.ok((select count(*) from order_log) > 0 and (select count(*) from credits) > 0, 'clerk (orders.view) reads order history and credits');
select t.ok((select count(*) from customer_notes) = 0, 'notes need customers.profiles');
select t.err($$select customer_note('b0000000-0000-0000-0000-000000000001', 'fan@mail.test', 'x')$$, 'permission', 'clerk cannot write customer notes');
select t.who('fan@mail.test');
select t.ok((select count(*) from orders) = 0 and (select count(*) from order_log) = 0 and (select count(*) from credits) = 0, 'a customer cannot read orders, history or credits directly');
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
select t.ok((select count(*) from tickets where seat = 'A-4' and status = 'replaced') = 1 and (select count(*) from tickets where seat = 'A-2' and status = 'valid') = 1, 'inventory move replaces the ticket and keeps history');

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
select code as k1 from tickets where order_id = :'o7' and seat = 'BX4-1' \gset
select code as k2 from tickets where order_id = :'o7' and seat = 'BX4-2' \gset
select code as k3 from tickets where order_id = :'o7' and seat = 'BX4-3' \gset
select code as kf from tickets where order_id = :'o7' and seat = 'F-A1' \gset
select ref as ref7 from orders where id = :'o7' \gset
select t.ok((select unit = 'Box 4' and coalesce("row", '') = '' and seat_label = '1' and area = 'Boxes' from tickets where code = :'k1'), 'box seat ticket: area Boxes, Box 4, no row, seat 1');
select t.ok((select count(distinct code) = 4 and bool_and(code ~ '^[A-Z0-9]{10}$') from tickets where order_id = :'o7'), 'every ticket has its own random 10-character code (the QR holds only this)');
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
select order_action(:'o7', 'reissue', json_build_object('tickets', json_build_array((select id from tickets where code = :'k3')))::jsonb) as ri \gset
reset role; set role authenticated; select t.who('scan@box.test');
select t.ok(checkin(:'k3', false, 'e0000000-0000-0000-0000-000000000003', '{}')->>'result' = 'replaced', 'reissue: the old QR code is rejected as replaced');
select t.ok(checkin((:'ri'::jsonb)->'codes'->>0, false, 'e0000000-0000-0000-0000-000000000003', '{}')->>'result' = 'ok' and checkin((:'ri'::jsonb)->'codes'->>0, false, 'e0000000-0000-0000-0000-000000000003', '{}')->'ticket'->>'unit' = 'Box 4', 'reissue: the new code scans, same seat');
reset role;
select t.ok((select count(*) from outbox where order_id = :'o7' and kind = 'tickets') = 1 and (select count(*) from order_log where order_id = :'o7' and kind = 'reissue') = 1, 'reissue is in the order history and the updated tickets are queued');
-- cancelled / refunded tickets: rejected at once
set role authenticated; select t.who('owner@box.test');
select t.ok(checkin((select code from tickets where order_id = ((:'r2'::jsonb)->>'id')::uuid and seat = 'A-3' and status = 'cancelled' limit 1), false, 'e0000000-0000-0000-0000-000000000001', '{}')->>'result' = 'cancelled', 'a cancelled ticket is rejected as cancelled');
reset role; select id as t2 from tickets where code = :'k2' \gset
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
select t.ok((select data->'utm' = '{"source":"ig","campaign":"spring"}'::jsonb from orders where id = :'s8o1'), 'S8 UTM tags stored on the order (known keys only)');
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
select t.ok((select count(*) from outbox where order_id = :'s8v' and kind = 'confirmation') = 1, 'S8 one confirmation for the order');
select t.ok((select count(*) from deliveries where event = 'payment.completed' and payload->'data'->>'id' = :'s8v') = 1 and (select count(*) from deliveries where event = 'order.created' and payload->'data'->>'id' = :'s8v') = 1, 'S8 order.created + payment.completed webhooks queued');
select t.ok(not exists(select 1 from deliveries where payload::text like '%access_key%' or payload::text like '%platformFee%'), 'S8 webhook payloads never carry the order key or platform money');
select t.ok((select count(*) from outbox where order_id = :'s8v' and automation_id = (:'s8a'::jsonb)->>'id' and send_at = '2099-01-01T20:00:00Z'::timestamptz - interval '48 hours') = 2, 'S8 VIP purchase → email + text scheduled 48 h before the event');
select t.ok((select 'VIP' = any(tags) and 'Attendee: Seated Show' = any(tags) from contacts where email = 'vera@mail.test'), 'S8 tags from the automation and the standard Purchase workflow');
select t.ok((select count(*) from automation_runs where automation_id = (:'s8a'::jsonb)->>'id') = 1, 'S8 the automation ran once');
select emit_event('b0000000-0000-0000-0000-000000000001', 'payment.completed', '{}', order_ctx(o)) from orders o where id = :'s8v';
select t.ok((select count(*) from outbox where order_id = :'s8v' and automation_id = (:'s8a'::jsonb)->>'id') = 2, 'S8 the same trigger never runs an automation twice');
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
select t.ok((select status from outbox where id = :'s8m') = 'suppressed', 'S8 sender: a marketing email to someone who never opted in is held back at send time');
select t.ok(exists(select 1 from jsonb_array_elements(:'s8cl'::jsonb) x where x->'msg'->>'kind' = 'confirmation' and x->'ctx'->'order'->>'key' is not null and jsonb_array_length(x->'ctx'->'tickets') >= 1), 'S8 sender gets what it needs to render (order link, tickets)');
select t.ok(not exists(select 1 from jsonb_array_elements(:'s8cl'::jsonb) x where (x->'msg'->>'send_at')::timestamptz > now()), 'S8 nothing is claimed before its time');
set role service_role;
select outbox_result(((x->'msg')->>'id')::uuid, true, 'resend', 're_' || ((x->'msg')->>'id'), null, false) from jsonb_array_elements(:'s8cl'::jsonb) x where x->'msg'->>'kind' = 'confirmation';
select outbox_result(((x->'msg')->>'id')::uuid, false, 'resend', null, 'timeout', false) from jsonb_array_elements(:'s8cl'::jsonb) x where x->'msg'->>'kind' = 'update';
reset role;
select t.ok((select bool_and(status = 'sent' and sent_at is not null) from outbox where kind = 'confirmation' and provider = 'resend'), 'S8 delivered messages are marked sent');
select t.ok((select status = 'queued' and send_at > now() from outbox where kind = 'update' and channel = 'sms' limit 1), 'S8 a failed send is retried later (back-off)');
-- bounces, STOP, unsubscribe link
set role service_role;
select mail_event((select provider_id from outbox where kind = 'confirmation' and email = 'vera@mail.test' limit 1), 'bounced');
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
select t.ok((select count(*) from outbox where order_id = :'s8s' and kind = 'reminder') = 1, 'S8 the event''s own reminder is queued once (the standard one is skipped for it)');
-- cancel → webhook + scheduled VIP messages dropped at send time
set role authenticated; select t.who('owner@box.test');
select order_action(:'s8v', 'cancel', '{"all":true,"seat":"release"}');
reset role;
select t.ok(exists(select 1 from deliveries where event = 'ticket.cancelled' and payload->'data'->>'order_ref' = (select ref from orders where id = :'s8v')), 'S8 ticket.cancelled webhook');
update outbox set send_at = now() - interval '1 second' where order_id = :'s8v' and automation_id is not null;
set role service_role; select claim_outbox(500); reset role;
select t.ok((select bool_and(status = 'cancelled') from outbox where order_id = :'s8v' and automation_id = (:'s8a'::jsonb)->>'id'), 'S8 scheduled automation messages for a cancelled order are dropped');
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
select confirm_payment(:'s9o', json_build_object('amount', (select (data->>'total')::bigint from orders where id = :'s9o'), 'ref', 'pi_s9', 'provider', 'stripe', 'fee', 397)::jsonb);
reset role;
select t.ok((select sum(fee) from tickets where order_id = :'s9o') = (select (data->>'fee')::bigint + coalesce((data->>'serviceFee')::bigint, 0) from orders where id = :'s9o') and (select sum(fee) from tickets where order_id = :'s9o') > 0,
  'S9 the tickets share the order''s booking fee exactly');
select t.ok((select sum(tax) from tickets where order_id = :'s9o') > 0 and (select sum(tax) from tickets where order_id = :'s9o') < (select (data->>'tax')::bigint from orders where id = :'s9o'),
  'S9 tickets carry their part of the sales tax; the product keeps the rest');
select t.ok((select sum(proc) from tickets where order_id = :'s9o') between 1 and 396, 'S9 tickets carry their part of the card processing fee');
select t.ok((select bool_and(fee > 0 and tax > 0 and proc > 0) from tickets where order_id = :'s9o'), 'S9 every ticket has its own booking fee, tax and processing share');
-- refund one ticket as credit → that ticket shows the credit; a chargeback; a clerk can't record one
set role authenticated; select t.who('owner@box.test');
select order_action(:'s9o', 'refund', json_build_object('mode', 'tickets', 'tickets', (select jsonb_agg(id) from (select id from tickets where order_id = :'s9o' limit 1) x), 'to', 'credit')::jsonb);
reset role;
select t.ok((select count(*) from tickets where order_id = :'s9o' and credited > 0 and credited = refunded) = 1, 'S9 a refund as credit is recorded on the ticket as credit');
set role authenticated; select t.who('clerk@box.test');
select t.err($$select order_action('$$ || :'s9o' || $$', 'chargeback', '{"amount":1000}')$$, 'permission', 'S9 a clerk without “Issue refunds” cannot record a chargeback');
select t.who('owner@box.test');
select t.err($$select order_action('$$ || :'s9o' || $$', 'chargeback', '{"amount":99999999}')$$, 'at most', 'S9 a chargeback can''t exceed what was collected');
select order_action(:'s9o', 'chargeback', '{"amount":1000,"reason":"fraudulent"}');
reset role;
select t.ok((order_money(o)->>'chargedBack')::bigint = 1000 and (order_money(o)->>'refundable')::bigint = (order_money(o)->>'collected')::bigint - (order_money(o)->>'credited')::bigint - 1000, 'S9 an open chargeback reduces what can still be refunded')
  from orders o where id = :'s9o';
set role authenticated; select t.who('owner@box.test');
select order_action(:'s9o', 'chargeback', json_build_object('id', (select data->'chargebacks'->0->>'id' from orders where id = :'s9o'), 'status', 'won')::jsonb);
reset role;
select t.ok((order_money(o)->>'chargedBack')::bigint = 0 and o.data->'chargebacks'->0->>'status' = 'won', 'S9 a won chargeback gives the money back') from orders o where id = :'s9o';
select t.ok(exists(select 1 from order_log where order_id = :'s9o' and kind = 'chargeback'), 'S9 chargebacks are in the order''s change history');
-- the processor's side: charge, dispute (webhook, twice), payout
set role service_role;
select record_processor_tx(json_build_object('id', 'ch_s9', 'payment', 'pi_s9', 'type', 'charge', 'amount', (select (data->>'total')::bigint from orders where id = :'s9o'), 'fee', 397, 'app_fee', 0, 'account', 'acct_test')::jsonb);
select record_processor_tx('{"id":"ch_s9","payment":"pi_s9","type":"charge","amount":1,"account":"acct_test"}');
select record_dispute('{"id":"dp_s9","payment":"pi_s9","amount":500,"reason":"duplicate","status":"open","provider":"stripe"}');
select record_dispute('{"id":"dp_s9","payment":"pi_s9","amount":500,"reason":"duplicate","status":"open","provider":"stripe"}');
select record_payout('{"id":"po_s9","account":"acct_test","amount":9000,"status":"paid","arrival":"2099-01-03T00:00:00Z","tx":["pi_s9"],"provider":"stripe"}');
reset role;
select t.ok((select count(*) from processor_tx where id = 'ch_s9') = 1 and (select amount from processor_tx where id = 'ch_s9') > 1, 'S9 processor transactions are recorded once (a repeated webhook changes nothing)');
select t.ok((select count(*) from orders o, jsonb_array_elements(o.data->'chargebacks') c where o.id = :'s9o' and c->>'id' = 'dp_s9') = 1 and exists(select 1 from processor_tx where id = 'dp:dp_s9' and amount = -500),
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
select order_action(:'s9o', 'reissue', json_build_object('tickets', (select jsonb_agg(id) from (select id from tickets where order_id = :'s9o' and status = 'valid' and credited = 0 limit 1) x))::jsonb);
reset role;
select t.ok((select sum(fee) from tickets where order_id = :'s9o' and status <> 'replaced') = (select (data->>'fee')::bigint + coalesce((data->>'serviceFee')::bigint, 0) from orders where id = :'s9o'), 'S9 a reissued ticket keeps its fee, tax and processing share');
-- data ownership
set role authenticated; select t.who('clerk@box.test');
select t.err($$select export_box_office('b0000000-0000-0000-0000-000000000001')$$, 'owner', 'S9 staff without both export permissions can''t download everything');
select t.err($$select platform_export()$$, 'super admins', 'S9 only super admins export platform-wide data');
select t.who('owner@box.test');
select export_box_office('b0000000-0000-0000-0000-000000000001') as s9x \gset
select t.who('root@platform.test'); select platform_export() as s9p \gset
reset role;
select t.ok(jsonb_array_length((:'s9x'::jsonb)->'orders') = (select count(*) from orders where box_office_id = 'b0000000-0000-0000-0000-000000000001') and not (:'s9x')::text like '%access_key%'
  and jsonb_array_length((:'s9x'::jsonb)->'expenses') = 3, 'S9 the owner downloads every order (no private keys), ticket and expense');
select t.ok(jsonb_array_length((:'s9p'::jsonb)->'box_offices') >= 1 and not (:'s9p')::text like '%buyer_email%', 'S9 platform export: box offices and order money, no customer contact data');
set role authenticated; select t.who('root@platform.test'); select set_box_office_status('b0000000-0000-0000-0000-000000000001', 'suspended'); select t.who('owner@box.test');
select t.ok(jsonb_array_length(export_box_office('b0000000-0000-0000-0000-000000000001')->'orders') > 0, 'S9 a suspended box office''s owner can still download all of its data');
reset role;
set role authenticated; select t.who('root@platform.test'); select set_box_office_status('b0000000-0000-0000-0000-000000000001', 'active'); reset role;
update box_offices set settings = settings - 'taxPct' where id = 'b0000000-0000-0000-0000-000000000001';

\o
\pset tuples_only off
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
\pset tuples_only on
select case when ok then 'PASS ' else 'FAIL ' end || msg from t.results order by n;
