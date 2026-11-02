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
