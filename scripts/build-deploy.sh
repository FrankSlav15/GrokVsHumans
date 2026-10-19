#!/usr/bin/env bash
# Builds the Cloudflare Pages deploy folder (../gvh-site by default) from the repo.
# ALLOW-LIST: only public site files are copied (top-level *.html, assets/, data/, favicon.ico,
# _headers, _redirects, _routes.json). Everything else (workers/, wrangler.toml, migrations*/,
# scripts/, docs/, tools/, server/, functions/, firebase files, dotfiles) never reaches the site.
# Functions are bundled by wrangler from ./functions, not from this folder.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$REPO/../../gvh-site}"
rm -rf "$OUT"; mkdir -p "$OUT"
cd "$REPO"
shopt -s nullglob
FILES=( *.html favicon.ico _headers _redirects _routes.json )
DIRS=( assets data )
for f in "${FILES[@]}"; do [ -f "$f" ] && cp -p "$f" "$OUT/"; done
for d in "${DIRS[@]}"; do [ -d "$d" ] && tar -cf - --exclude '.DS_Store' "$d" | tar -C "$OUT" -xf -; done
echo "static files: $(find "$OUT" -type f | wc -l)"
