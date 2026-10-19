#!/usr/bin/env python3
"""Generate poster images for every video the site renders.

* Local videos under assets/ get   <same path minus extension>-poster.webp
* Remote videos referenced in data/*.json (e.g. files.catbox.moe) are downloaded
  to a temp cache and get assets/images/posters/<host>-<name>-poster.webp; a
  "poster" field is inserted next to their "image" field in the JSON.

Frames: ~1 s in (or 10 % for clips under 10 s); if that frame is dark or flat,
the brightest, most detailed of 9 frames spread across the clip is used. Output is WebP,
max 720 px wide, quality lowered until it is under 150 KB.

Usage:  python3 scripts/generate-video-posters.py [--force]
Needs:  ffmpeg + ffprobe, curl.
"""
import json, os, re, subprocess, sys, tempfile, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIDEO_RE = re.compile(r'\.(mp4|webm|mov)$', re.I)
MAX_BYTES = 150 * 1024
MAX_W = 720
CACHE = os.path.join(tempfile.gettempdir(), 'gvh-video-cache')
FORCE = '--force' in sys.argv


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def duration(path):
    r = run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path])
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def frame_stats(path, t):
    """Return (yavg, ymin, ymax) for the frame at t, or None."""
    r = run(['ffmpeg', '-v', 'error', '-ss', f'{t:.3f}', '-i', path, '-frames:v', '1',
             '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'])
    vals = dict(re.findall(r'lavfi\.signalstats\.(YAVG|YMIN|YMAX)=([\d.]+)', r.stdout))
    if 'YAVG' not in vals:
        return None
    return float(vals['YAVG']), float(vals['YMIN']), float(vals['YMAX'])


def pick_time(path):
    """~1 s in (10 % for clips < 10 s) unless that frame is dark or flat;
    otherwise the brightest, most detailed of several frames across the clip."""
    d = duration(path)
    first = d * 0.10 if d and d < 10 else 1.0
    if d and first >= d:
        first = d / 2
    candidates = [first] + ([d * f / 10 for f in range(1, 10)] if d else [])
    best = None
    for t in candidates:
        s = frame_stats(path, t)
        if not s:
            continue
        yavg, ymin, ymax = s
        if yavg >= 40 and ymax - ymin > 60:  # bright enough and not a flat frame
            return t
        score = min(yavg, 200) + (ymax - ymin) / 8
        if best is None or score > best[0]:
            best = (score, t)
    return best[1] if best else 0.0


def make_poster(video, out):
    t = pick_time(video)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    for q in (78, 70, 62, 54, 46, 38):
        r = run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.3f}', '-i', video, '-frames:v', '1',
                 '-vf', f"scale='min({MAX_W},iw)':-2", '-c:v', 'libwebp', '-quality', str(q), out])
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip()[-300:])
        if os.path.getsize(out) <= MAX_BYTES:
            break
    return t, q, os.path.getsize(out)


def local_poster_path(rel):
    return VIDEO_RE.sub('-poster.webp', rel)


def remote_poster_path(url):
    u = urllib.parse.urlparse(url)
    host = u.netloc.split('.')[-2] if '.' in u.netloc else u.netloc
    stem = VIDEO_RE.sub('', os.path.basename(urllib.parse.unquote(u.path)))
    stem = re.sub(r'[^A-Za-z0-9_-]+', '-', stem).strip('-')
    return f'assets/images/posters/{host}-{stem}-poster.webp'


def main():
    results, failures = [], []

    # 1) local videos
    for dirpath, _, files in os.walk(os.path.join(ROOT, 'assets')):
        for f in sorted(files):
            if not VIDEO_RE.search(f):
                continue
            rel = os.path.relpath(os.path.join(dirpath, f), ROOT)
            out = os.path.join(ROOT, local_poster_path(rel))
            if os.path.exists(out) and not FORCE:
                results.append((rel, local_poster_path(rel), 'exists')); continue
            try:
                t, q, size = make_poster(os.path.join(ROOT, rel), out)
                results.append((rel, local_poster_path(rel), f'{t:.2f}s q{q} {size//1024}KB'))
            except Exception as e:
                failures.append((rel, str(e)))

    # 2) remote videos in data/*.json (text edit keeps the original formatting)
    os.makedirs(CACHE, exist_ok=True)
    for name in sorted(os.listdir(os.path.join(ROOT, 'data'))):
        if not name.endswith('.json'):
            continue
        path = os.path.join(ROOT, 'data', name)
        lines = open(path, encoding='utf-8').read().split('\n')
        changed, out_lines = False, []
        for i, line in enumerate(lines):
            m = re.match(r'^(\s*)"image":\s*"(https?://[^"]+)"', line)
            if m and VIDEO_RE.search(urllib.parse.urlparse(m.group(2)).path):
                indent, url = m.group(1), m.group(2)
                poster = remote_poster_path(url)
                prev = out_lines[-1] if out_lines else ''
                nxt = lines[i + 1] if i + 1 < len(lines) else ''
                has_field = '"poster"' in prev or '"poster"' in nxt
                dest = os.path.join(ROOT, poster)
                if not os.path.exists(dest) or FORCE:
                    cached = os.path.join(CACHE, os.path.basename(poster).replace('-poster.webp', '') +
                                          os.path.splitext(urllib.parse.urlparse(url).path)[1])
                    if not os.path.exists(cached):
                        r = run(['curl', '-sSfL', '--http1.1', '--retry', '4', '--retry-all-errors', '-m', '300', '-o', cached, url])
                        if r.returncode != 0:
                            failures.append((url, 'download failed: ' + r.stderr.strip()))
                            out_lines.append(line); continue
                    try:
                        t, q, size = make_poster(cached, dest)
                        results.append((url, poster, f'{t:.2f}s q{q} {size//1024}KB'))
                    except Exception as e:
                        failures.append((url, str(e)))
                        out_lines.append(line); continue
                else:
                    results.append((url, poster, 'exists'))
                if not has_field:
                    out_lines.append(f'{indent}"poster": "{poster}",')
                    changed = True
            out_lines.append(line)
        if changed:
            text = '\n'.join(out_lines)
            json.loads(text)  # sanity check
            open(path, 'w', encoding='utf-8').write(text)
            print(f'updated {os.path.relpath(path, ROOT)}')

    for src, poster, info in results:
        print(f'OK   {src} -> {poster} ({info})')
    for src, err in failures:
        print(f'FAIL {src}: {err}')
    print(f'{len(results)} posters, {len(failures)} failures')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
