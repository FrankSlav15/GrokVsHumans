#!/usr/bin/env bash
# Builds the Cloudflare Pages deploy folder (../gvh-site by default) from the repo:
# static site files + _headers/_redirects/_routes.json, plus the Functions bundle.
# Repo-only files (.git, .github, scripts, migrations, server, functions, firebase files) are excluded.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$REPO/../../gvh-site}"
rm -rf "$OUT"; mkdir -p "$OUT"
tar -C "$REPO" -cf - \
  --exclude './.git' --exclude './.github' --exclude './.gitignore' --exclude './scripts' \
  --exclude './migrations' --exclude './server' --exclude './functions' --exclude 'node_modules' \
  --exclude './database.rules.json' --exclude './firebase.json' --exclude './wrangler.toml' \
  --exclude './docs' --exclude './.wrangler' --exclude '.DS_Store' . | tar -C "$OUT" -xf -
echo "static files: $(find "$OUT" -type f | wc -l)"
