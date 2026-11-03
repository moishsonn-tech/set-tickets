#!/bin/bash
# Nightly database backup (Stage 10). Needs SET_DB_URL = the Supabase "Session pooler" connection string (Project Settings → Database),
# kept in ~/.set-secrets/db_url (chmod 600), never in the repo. Run from cron:  0 3 * * *  bash ~/set-tickets/deploy/backup.sh
# Keeps 30 days in ~/set-backups, checks the dump can be read back (pg_restore --list), and records the run in backup_runs —
# Platform → System health turns "Backups" amber if no good backup in 26 hours. Supabase's own daily backups / PITR are the second copy.
set -euo pipefail
DB=${SET_DB_URL:-$(cat ~/.set-secrets/db_url)}; DIR=${SET_BACKUP_DIR:-~/set-backups}; mkdir -p "$DIR"; F="$DIR/set-$(date -u +%Y%m%d-%H%M%S).dump"
ok=true; note=''
pg_dump --format=custom --no-owner --no-privileges --dbname "$DB" --file "$F" || { ok=false; note='pg_dump failed'; }
if $ok; then n=$(pg_restore --list "$F" | grep -c 'TABLE DATA' || true); [ "$n" -gt 20 ] || { ok=false; note="only $n tables in the dump"; }; fi
size=$( [ -f "$F" ] && stat -f%z "$F" 2>/dev/null || stat -c%s "$F" 2>/dev/null || echo 0 )
psql "$DB" -qc "insert into backup_runs(kind, size_bytes, ok, note) values ('database', $size, $ok, '$note')" || true
find "$DIR" -name 'set-*.dump' -mtime +30 -delete
$ok && echo "backup ok: $F ($size bytes)" || { echo "BACKUP FAILED: $note"; exit 1; }
