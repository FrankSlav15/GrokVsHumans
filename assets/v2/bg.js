/* Rotating backdrop (ported from v1 common.js setRandomBackground + body::before overlay).
   One random photo per load, in a position:fixed layer (iOS ignores background-attachment:fixed).
   Only the first image loads eagerly; the next is fetched just before a crossfade (every 3 min),
   and crossfades are skipped under prefers-reduced-motion. */
(function () {
  var N = 20, d = document, root = d.documentElement;
  var small = matchMedia('(max-width: 760px)').matches;
  // Browsers that understand image-set type() all decode AVIF (Chrome 113+, Safari 17+, Firefox 113+); others get WebP.
  var ext = (window.CSS && CSS.supports && CSS.supports('background-image', 'image-set(url("a.avif") type("image/avif"))')) ? 'avif' : 'webp';
  function url(i) { return '/assets/v2/bg/bg' + i + '-' + (small ? 'm' : 'd') + '.' + ext; }
  var cur = 1 + Math.floor(Math.random() * N);
  var layer = d.createElement('div'); layer.className = 'bg'; layer.setAttribute('aria-hidden', 'true');
  var a = d.createElement('div'), b = d.createElement('div');
  a.className = b.className = 'bg__img';
  a.style.backgroundImage = 'url("' + url(cur) + '")'; a.classList.add('is-on');
  layer.appendChild(a); layer.appendChild(b);
  var shade = d.createElement('div'); shade.className = 'bg__shade'; layer.appendChild(shade);
  d.body.insertBefore(layer, d.body.firstChild);
  root.dataset.bg = String(cur);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var front = a, back = b;
  setInterval(function () {
    if (d.hidden) return;
    var next; do { next = 1 + Math.floor(Math.random() * N); } while (next === cur);
    var img = new Image(); img.decoding = 'async';
    img.onload = function () {
      back.style.backgroundImage = 'url("' + img.src + '")';
      back.classList.add('is-on'); front.classList.remove('is-on');
      var t = front; front = back; back = t; cur = next; root.dataset.bg = String(cur);
    };
    img.src = url(next);
  }, 180000);
})();
