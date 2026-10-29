#!/bin/bash
# Publish the site: pushes main, then pushes frontend/ as the gh-pages branch (GitHub Pages serves that).
# Run after any change:  bash deploy/publish.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export GH_TOKEN=$(~/.local/bin/gh auth token -h github.com -u moishsonn-tech)
git push -q origin main
git push -q -f origin "$(git subtree split --prefix frontend main)":refs/heads/gh-pages
~/.local/bin/gh api repos/moishsonn-tech/set-tickets/pages >/dev/null 2>&1 \
  || ~/.local/bin/gh api -X POST repos/moishsonn-tech/set-tickets/pages -f 'source[branch]=gh-pages' -f 'source[path]=/' >/dev/null
echo "Published → https://moishsonn-tech.github.io/set-tickets/ (live in ~1 minute)"
