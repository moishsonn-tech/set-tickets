#!/bin/bash
# Run supabase/schema.sql on a scratch Postgres database and check the server rules for real (tests/db-e2e.sql).
# Needs psql + a running Postgres 15+ (PGHOST / PGPORT / PGUSER as usual; PGBIN = folder of psql if it isn't on PATH).
# A quick local Postgres: python3 -m venv v && v/bin/pip install pgserver  → binaries in v/lib/python3*/site-packages/pgserver/pginstall/bin
set -e
cd "$(dirname "$0")/.."
PSQL="${PGBIN:+$PGBIN/}psql"; DB=${DB:-set_e2e}
"$PSQL" -q -d postgres -c "drop database if exists $DB" -c "create database $DB" 2>&1 | grep -v NOTICE || true
"$PSQL" -q -v ON_ERROR_STOP=1 -d $DB -f tests/supabase-stub.sql
# Supabase already has pgcrypto (and gen_random_uuid is built in), so a plain Postgres skips that line
grep -v '^create extension if not exists pgcrypto' supabase/schema.sql | "$PSQL" -q -v ON_ERROR_STOP=1 -d $DB 2>&1 | grep -v NOTICE || true
"$PSQL" -q -d $DB -f tests/db-e2e.sql 2>&1 | grep -v NOTICE
# Stage 7: three scanners check in the same ticket at the same moment (each holds its transaction open) → exactly one "ok"
K=$("$PSQL" -At -d $DB -c "select code from tickets where event_id = 'e0000000-0000-0000-0000-000000000003' and seat = 'BX4-1' and status = 'valid'")
"$PSQL" -q -At -d $DB -c "update tickets set checked_in_at = null, checkin = null where code = '$K'" >/dev/null
race() { "$PSQL" -At -d $DB -c "set role authenticated" -c "select set_config('request.jwt.claims', '{\"email\":\"scan@box.test\"}', false)" \
  -c "begin" -c "select checkin('$K', false, 'e0000000-0000-0000-0000-000000000003', '{\"device\":\"race-$1\"}'::jsonb)->>'result'" -c "select pg_sleep(1)" -c "commit" 2>&1 | grep -E '^(ok|already)$'; }
R=$( (race 1 & race 2 & race 3 & wait) | sort | tr '\n' ' ')
[ "$R" = "already already ok " ] && echo "PASS three phones scan one ticket at the same instant: accepted exactly once ($R)" || echo "FAIL concurrent scans: $R"

