#!/bin/bash
# Put an earlier published version back live:  bash deploy/rollback.sh deploy-20261103-041500   (git tag -l 'deploy-*' lists them)
# Republishes that commit's frontend/ (with its own version.json). The database is not rolled back — schema.sql changes are additive.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -n "${1:-}" ] || { echo "usage: rollback.sh <deploy tag or commit>"; git tag -l 'deploy-*' | tail -10; exit 1; }
git rev-parse --verify "$1^{commit}" >/dev/null
SET_ENV=${SET_ENV:-production} bash deploy/publish.sh "$1"
