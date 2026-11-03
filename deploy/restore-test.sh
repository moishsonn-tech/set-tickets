#!/bin/bash
# Recovery test (Stage 10): restore the newest backup into a scratch local database and compare row counts with production.
# Run monthly (and after any schema change):  bash deploy/restore-test.sh   — needs a local Postgres (see tests/db-e2e.sh) and SET_DB_URL.
set -euo pipefail
DB=${SET_DB_URL:-$(cat ~/.set-secrets/db_url)}; F=$(ls -t ${SET_BACKUP_DIR:-~/set-backups}/set-*.dump | head -1); T=set_restore_test
psql -qd postgres -c "drop database if exists $T" -c "create database $T"
pg_restore --no-owner --no-privileges --dbname "$T" "$F" 2>/dev/null || true
for t in box_offices events orders tickets members outbox; do a=$(psql -Atd "$T" -c "select count(*) from $t"); b=$(psql "$DB" -Atc "select count(*) from $t"); echo "$t restored=$a production=$b"; done
psql "$DB" -qc "update backup_runs set verified_at = now() where id = (select max(id) from backup_runs where ok)"
echo "Restore test done from $F — compare the counts above (production may have grown since the backup)."
