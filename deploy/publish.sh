#!/bin/bash
# Publish the site: pushes main, then pushes frontend/ as the gh-pages branch (GitHub Pages serves that).
# Run after any change:  bash deploy/publish.sh
# Stage 10: every publish adds frontend/version.json (commit, time, environment — shown on Platform → System health) and a
# deploy-… tag, so `git tag -l 'deploy-*'` is the deployment history and `bash deploy/rollback.sh <tag>` puts an older one back.
# Staging: SET_ENV=staging SET_REPO=<owner>/<staging-repo> bash deploy/publish.sh  (a second Pages site + its own Supabase project).
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=${SET_REPO:-moishsonn-tech/set-tickets}; ENV=${SET_ENV:-production}; REF=${1:-main}
export GH_TOKEN=$(~/.local/bin/gh auth token -h github.com -u moishsonn-tech)
[ "$REF" = main ] && git push -q origin main
SPLIT=$(git subtree split --prefix frontend "$REF")
VER=$(printf '{"commit":"%s","at":"%s","env":"%s"}' "$(git rev-parse --short "$REF")" "$(date -u +%FT%TZ)" "$ENV")
BLOB=$(printf '%s' "$VER" | git hash-object -w --stdin)
IDX=$(mktemp -u); GIT_INDEX_FILE=$IDX git read-tree "$SPLIT"; GIT_INDEX_FILE=$IDX git update-index --add --cacheinfo 100644,"$BLOB",version.json
TREE=$(GIT_INDEX_FILE=$IDX git write-tree); rm -f "$IDX"
C=$(git commit-tree "$TREE" -p "$SPLIT" -m "publish $VER")
REMOTE=${SET_REPO:+https://github.com/$SET_REPO.git}; git push -q -f "${REMOTE:-origin}" "$C:refs/heads/gh-pages"
if [ "$ENV" = production ]; then TAG="deploy-$(date -u +%Y%m%d-%H%M%S)"; git tag "$TAG" "$REF"; git push -q origin "$TAG"; fi
~/.local/bin/gh api "repos/$REPO/pages" >/dev/null 2>&1 \
  || ~/.local/bin/gh api -X POST "repos/$REPO/pages" -f 'source[branch]=gh-pages' -f 'source[path]=/' >/dev/null 2>&1 || true
echo "Published $VER → https://${REPO%%/*}.github.io/${REPO#*/}/ (live in ~1 minute)"
