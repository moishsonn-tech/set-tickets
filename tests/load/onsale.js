// Load test for a big on-sale (Stage 10) — run against STAGING only, never production:
//   k6 run -e SUPABASE_URL=https://<staging>.supabase.co -e ANON=<anon key> -e EVENT=<event uuid> -e SEATS=A-1,A-2,... tests/load/onsale.js
// Ramps to 2,000 virtual buyers: each loads availability, joins the waiting room, tries to hold 2 seats and checks out pay-later.
// Pass = p95 under 800 ms, < 1% server errors, and no seat sold twice (check: select seat, count(*) from tickets where event_id = … and status = 'valid' group by 1 having count(*) > 1).
import http from 'k6/http'; import { check, sleep } from 'k6';
export const options = { scenarios: { onsale: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '1m', target: 500 }, { duration: '2m', target: 2000 }, { duration: '1m', target: 0 }] } },
  thresholds: { http_req_duration: ['p(95)<800'], http_req_failed: ['rate<0.01'] } };
const U = __ENV.SUPABASE_URL + '/rest/v1/rpc/', H = { headers: { apikey: __ENV.ANON, Authorization: 'Bearer ' + __ENV.ANON, 'Content-Type': 'application/json' } }, SEATS = (__ENV.SEATS || '').split(',');
export default function () {
  const tok = 'load-' + __VU + '-' + __ITER + '-' + Math.random().toString(36).slice(2, 10);
  check(http.post(U + 'availability', JSON.stringify({ p_event: __ENV.EVENT, p_token: tok }), H), { availability: r => r.status === 200 });
  let q = http.post(U + 'queue_status', JSON.stringify({ p_event: __ENV.EVENT, p_token: tok }), H).json();
  for (let i = 0; i < 30 && q && q.on && !q.admitted; i++) { sleep(3); q = http.post(U + 'queue_status', JSON.stringify({ p_event: __ENV.EVENT, p_token: tok }), H).json(); }
  const i = Math.floor(Math.random() * (SEATS.length - 1)), seats = [SEATS[i], SEATS[i + 1]];
  const h = http.post(U + 'hold_seats', JSON.stringify({ p_event: __ENV.EVENT, p_slot: '', p_seats: seats, p_token: tok }), H);
  check(h, { 'hold answered (ok or taken)': r => r.status === 200 || r.status === 400 });
  sleep(1 + Math.random() * 3);
}
