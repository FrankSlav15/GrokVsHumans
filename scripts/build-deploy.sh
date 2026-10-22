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
# Shared HTML partials: a line "<!-- include:NAME ... -->" is replaced by partials/NAME.html (one source for repeated blocks).
python3 - "$OUT" "$REPO/partials" <<'PY'
import re, sys, pathlib
out, parts = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
for f in out.glob('*.html'):
    s = f.read_text()
    n = re.sub(r'^[ \t]*<!-- include:([\w-]+)[^>]*-->\n', lambda m: (parts / (m.group(1) + '.html')).read_text(), s, flags=re.M)
    if n != s: f.write_text(n)
PY
grep -l 'include:' "$OUT"/*.html && { echo "unresolved include"; exit 1; } || true
# Cache-bust the non-fingerprinted v2 CSS/JS (served with max-age=14400) so a deploy reaches phones/iPads at once.
V="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || date +%s)$( [ -n "$(git -C "$REPO" status --porcelain 2>/dev/null)" ] && echo -d$(date +%s) )"
sed -i -E "s#(/assets/(v2|admin)/[a-z0-9_-]+\.(css|js))\"#\1?v=$V\"#g" "$OUT"/*.html
