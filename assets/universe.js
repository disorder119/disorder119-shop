(function () {
  "use strict";

  var canvas = document.getElementById("uCanvas");
  var stage = document.getElementById("uStage");
  var focus = document.getElementById("uFocus");
  var focusBrand = document.getElementById("uFocusBrand");
  var focusTitle = document.getElementById("uFocusTitle");
  var focusMeta = document.getElementById("uFocusMeta");
  var shuffle = document.getElementById("uShuffle");
  var hint = document.getElementById("uHint");
  var tooltip = document.getElementById("uTooltip");
  var status = document.getElementById("uStatus");
  var errorBox = document.getElementById("uError");
  if (!canvas || !stage) return;

  var ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  var rawLang = String(document.documentElement.lang || "de").toLowerCase();
  var LANG = rawLang.indexOf("en") === 0 ? "en" : rawLang.indexOf("fr") === 0 ? "fr" : "de";
  var PREFIX = LANG === "de" ? "/" : "/" + LANG + "/";
  var COPY = {
    de: { hintMouse: "Maus bewegen: umsehen · Mausrad/Trackpad: zoomen · Doppelklick: öffnen", hintTouch: "Wischen: umsehen · Zwei Finger: zoomen · Tippen: annähern", closer: "Näher heranzoomen", size: "Größe", loaded: "Universum bereit", fail: "Das Universum konnte nicht geladen werden." },
    en: { hintMouse: "Move mouse: look around · Wheel/trackpad: zoom · Double-click: open", hintTouch: "Swipe: look around · Two fingers: zoom · Tap: move closer", closer: "Zoom in closer", size: "Size", loaded: "Universe ready", fail: "The universe could not be loaded." },
    fr: { hintMouse: "Déplacez la souris : regarder · Molette/trackpad : zoomer · Double-clic : ouvrir", hintTouch: "Glissez : regarder · Deux doigts : zoomer · Touchez : approcher", closer: "Zoomer davantage", size: "Taille", loaded: "Univers prêt", fail: "L’univers n’a pas pu être chargé." }
  }[LANG];

  var U = {
    ITEM_W: 1.04,
    FILL: 0.125,
    NEAR: 0.38,
    FAR: 10.2,
    REF: 2.15,
    BIG: 122,
    STAR_N: 360,
    STAR_SX: 42,
    STAR_SY: 78,
    STAR_SZ: 34,
    STAR_Z0: 11,
    DISPLAY_KEEP: 28,
    CELL_KEEP: 4200
  };

  var S = {
    W: 1, H: 1, left: 0, top: 0, DPR: 1, FOC: 600,
    cam: { x: 0, y: 0, z: -2.5 },
    vel: { x: 0, y: 0, z: 0 },
    mouse: { active: false, x: 0, y: 0, sx: 0, sy: 0 },
    pointers: new Map(), gesture: null, lastTap: { t: 0, x: 0, y: 0, key: "" },
    seed: (Math.random() * 2147483647) | 0,
    pool: [], stars: [], cells: new Map(), thumbs: new Map(), displays: new Map(), drawn: [],
    focusKey: "", focusItem: null, hoverKey: "",
    raf: 0, lastT: 0, anim: null,
    pendingWheel: 0, wheelX: 0, wheelY: 0,
    preloadAt: 0, slowFrames: 0, dprCap: 1.65
  };

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function finePointer() {
    return !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function mod(a, n) { return ((a % n) + n) % n; }
  function rnd(i, j, k, salt) {
    var h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x6c8e9cf5) ^ Math.imul(S.seed + salt, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  function money(v) {
    if (!(Number(v) > 0)) return LANG === "fr" ? "Prix sur demande" : LANG === "en" ? "Price on request" : "Preis auf Anfrage";
    return Number(v).toLocaleString(LANG === "de" ? "de-DE" : LANG === "fr" ? "fr-FR" : "en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €";
  }
  function imgVariant(path, folder) {
    var raw = String(path || "").replace(/^\/+/, "");
    var p = raw.lastIndexOf("/");
    if (p < 0) return "/" + raw;
    return "/" + raw.slice(0, p) + "/" + folder + "/" + raw.slice(p + 1);
  }
  function imageFrom(map, url) {
    var im = map.get(url);
    if (im) {
      map.delete(url); map.set(url, im);
      return im;
    }
    im = new Image();
    im.decoding = "async";
    im.onload = requestFrame;
    im.onerror = requestFrame;
    im.src = url;
    map.set(url, im);
    return im;
  }
  function thumb(it) { return imageFrom(S.thumbs, imgVariant(it.gallery[0], "thumbs")); }
  function display(it) {
    var im = imageFrom(S.displays, imgVariant(it.gallery[0], "display"));
    while (S.displays.size > U.DISPLAY_KEEP) S.displays.delete(S.displays.keys().next().value);
    return im;
  }
  function ready(im) { return !!(im && im.complete && im.naturalWidth > 0); }

  function resize() {
    var r = stage.getBoundingClientRect();
    S.W = Math.max(1, r.width); S.H = Math.max(1, r.height); S.left = r.left; S.top = r.top;
    var mobileCap = S.W < 760 ? 1.35 : 1.65;
    S.DPR = Math.min(S.dprCap, mobileCap, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(S.W * S.DPR));
    canvas.height = Math.max(1, Math.round(S.H * S.DPR));
    S.FOC = Math.min(S.W, S.H) * 1.72;
    requestFrame();
  }

  function makeStars() {
    S.stars = [];
    for (var i = 0; i < U.STAR_N; i++) {
      S.stars.push({ x: Math.random() * U.STAR_SX, y: Math.random() * U.STAR_SY, z: Math.random() * U.STAR_SZ, b: 0.25 + Math.random() * 0.7 });
    }
  }

  function getCell(i, j, k) {
    var key = i + ":" + j + ":" + k;
    if (S.cells.has(key)) return S.cells.get(key);
    var cell = null;
    if (rnd(i, j, k, 1) <= U.FILL && S.pool.length) {
      cell = {
        key: key,
        x: i + 0.18 + 0.64 * rnd(i, j, k, 3),
        y: j + 0.18 + 0.64 * rnd(i, j, k, 4),
        z: k + 0.1 + 0.8 * rnd(i, j, k, 5),
        rot: (rnd(i, j, k, 6) - 0.5) * 0.28,
        idx: Math.floor(rnd(i, j, k, 2) * S.pool.length)
      };
    }
    S.cells.set(key, cell || false);
    if (S.cells.size > U.CELL_KEEP) S.cells.clear();
    return cell || null;
  }

  function buildVisible() {
    var out = [], cam = S.cam, W = S.W, H = S.H, FOC = S.FOC;
    var k0 = Math.floor(cam.z + U.NEAR), k1 = Math.floor(cam.z + U.FAR);
    for (var k = k0; k <= k1; k++) {
      var slab = k + 1 - cam.z;
      if (slab <= U.NEAR) continue;
      var hw = (W / 2) / FOC * slab + 0.9;
      var hh = (H / 2) / FOC * slab + 0.9;
      var i0 = Math.floor(cam.x - hw), i1 = Math.floor(cam.x + hw);
      var j0 = Math.floor(cam.y - hh), j1 = Math.floor(cam.y + hh);
      for (var i = i0; i <= i1; i++) {
        for (var j = j0; j <= j1; j++) {
          var c = getCell(i, j, k);
          if (!c) continue;
          var d = c.z - cam.z;
          if (d <= U.NEAR || d > U.FAR) continue;
          var sc = FOC / d;
          var w = U.ITEM_W * sc;
          var it = S.pool[c.idx % S.pool.length];
          var tm = thumb(it);
          var ratio = ready(tm) ? tm.naturalHeight / Math.max(1, tm.naturalWidth) : 4 / 3;
          var h = w * ratio;
          var px = W / 2 + (c.x - cam.x) * sc;
          var py = H / 2 + (c.y - cam.y) * sc;
          if (px + w < 0 || px - w > W || py + h < 0 || py - h > H) continue;
          var a = 1;
          if (d > U.FAR - 3) a *= (U.FAR - d) / 3;
          if (d < U.NEAR + 0.45) a *= (d - U.NEAR) / 0.45;
          a *= Math.min(1, 0.22 + w / 190);
          if (a < 0.03) continue;
          out.push({ key: c.key, it: it, thumb: tm, x: c.x, y: c.y, z: c.z, d: d, px: px, py: py, w: w, h: h, a: a, rot: c.rot });
        }
      }
    }
    out.sort(function (a, b) { return b.d - a.d; });
    return out;
  }

  function setFocus(best) {
    var key = best ? best.key : "";
    if (key === S.focusKey) return;
    S.focusKey = key; S.focusItem = best ? best.it : null;
    if (!best) {
      focus.classList.add("is-empty");
      focusBrand.textContent = "";
      focusTitle.textContent = COPY.closer;
      focusMeta.textContent = "";
      return;
    }
    var it = best.it;
    focus.classList.remove("is-empty");
    focusBrand.textContent = it.brand || "";
    focusTitle.textContent = it.title || "";
    focusMeta.textContent = money(it.price) + (it.size ? " · " + COPY.size + " " + it.size : "");
  }

  function preloadVisible(list, now) {
    if (now - S.preloadAt < 140) return;
    S.preloadAt = now;
    var candidates = list.filter(function (o) { return o.w > 72 && o.a > 0.25; })
      .sort(function (a, b) { return a.d - b.d; })
      .slice(0, 10);
    candidates.forEach(function (o) { display(o.it); });
  }

  function render(now) {
    var W = S.W, H = S.H, DPR = S.DPR, cam = S.cam;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    var cx = W / 2, cy = H / 2;
    ctx.fillStyle = "#f2efe7";
    for (var s = 0; s < S.stars.length; s++) {
      var st = S.stars[s];
      var dz = mod(st.z - cam.z, U.STAR_SZ) + U.STAR_Z0;
      var sc = S.FOC / dz;
      var x = cx + (mod(st.x - cam.x + U.STAR_SX / 2, U.STAR_SX) - U.STAR_SX / 2) * sc;
      var y = cy + (mod(st.y - cam.y + U.STAR_SY / 2, U.STAR_SY) - U.STAR_SY / 2) * sc;
      if (x < -2 || x > W + 2 || y < -2 || y > H + 2) continue;
      var t = (dz - U.STAR_Z0) / U.STAR_SZ;
      var sz = 0.55 + 1.25 * (1 - t);
      ctx.globalAlpha = st.b * Math.min(1, (1 - t) * 1.5) * Math.min(1, t * 5);
      ctx.fillRect(x, y, sz, sz);
    }

    var list = buildVisible();
    var best = null, bestScore = Infinity;
    for (var b = 0; b < list.length; b++) {
      var e = list[b];
      if (e.w < 68 || e.w > W * 0.86 || e.a < 0.45) continue;
      var dist = Math.hypot(e.px - cx, e.py - H * 0.46);
      var score = dist - e.w * 0.32;
      if (dist < Math.min(W, H) * 0.43 && score < bestScore) { best = e; bestScore = score; }
    }

    for (var r = 0; r < list.length; r++) {
      var o = list[r], im = o.thumb;
      if (o.w * DPR > 220) {
        var hi = display(o.it);
        if (ready(hi)) im = hi;
      }
      ctx.setTransform(DPR, 0, 0, DPR, o.px * DPR, o.py * DPR);
      ctx.rotate(o.rot);
      ctx.globalAlpha = o.a;
      if (ready(im)) ctx.drawImage(im, -o.w / 2, -o.h / 2, o.w, o.h);
      else { ctx.fillStyle = "#e8e4db"; ctx.fillRect(-1.5, -1.5, 3, 3); }
      if (o === best) {
        ctx.globalAlpha = Math.min(1, o.a * 0.7);
        ctx.strokeStyle = "rgba(242,239,231,.55)";
        ctx.lineWidth = 1;
        ctx.strokeRect(-o.w / 2 - 4, -o.h / 2 - 4, o.w + 8, o.h + 8);
      }
    }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1;
    S.drawn = list;
    setFocus(best);
    preloadVisible(list, now);
  }

  function requestFrame() {
    if (!S.raf && !document.hidden) S.raf = requestAnimationFrame(tick);
  }

  function tick(now) {
    S.raf = 0;
    var dt = S.lastT ? Math.min(42, now - S.lastT) : 16.7;
    S.lastT = now;

    if (dt > 26) S.slowFrames += 1; else S.slowFrames = Math.max(0, S.slowFrames - 1);
    if (S.slowFrames > 32 && S.dprCap > 1.05) {
      S.dprCap = Math.max(1.05, S.dprCap - 0.15); S.slowFrames = 0; resize();
    }

    var moving = false;
    if (S.pendingWheel) {
      var delta = S.pendingWheel; S.pendingWheel = 0;
      var factor = Math.exp(-delta * 0.0019);
      factor = clamp(factor, 0.72, 1.38);
      zoomStep(S.wheelX, S.wheelY, factor);
      moving = true;
    }

    if (S.anim) {
      var p = Math.min(1, (now - S.anim.t0) / S.anim.ms);
      var e = 1 - Math.pow(1 - p, 3);
      S.cam.x = S.anim.from.x + (S.anim.to.x - S.anim.from.x) * e;
      S.cam.y = S.anim.from.y + (S.anim.to.y - S.anim.from.y) * e;
      S.cam.z = S.anim.from.z + (S.anim.to.z - S.anim.from.z) * e;
      if (p >= 1) S.anim = null; else moving = true;
    } else if (!S.pointers.size && S.mouse.active && finePointer()) {
      var smooth = Math.min(1, dt * 0.016);
      S.mouse.sx += (S.mouse.x - S.mouse.sx) * smooth;
      S.mouse.sy += (S.mouse.y - S.mouse.sy) * smooth;
      var dead = 0.045;
      var ax = Math.abs(S.mouse.sx) > dead ? (Math.abs(S.mouse.sx) - dead) / (1 - dead) * (S.mouse.sx < 0 ? -1 : 1) : 0;
      var ay = Math.abs(S.mouse.sy) > dead ? (Math.abs(S.mouse.sy) - dead) / (1 - dead) * (S.mouse.sy < 0 ? -1 : 1) : 0;
      if (ax || ay) {
        // Horizontal bewusst deutlich schneller als die alte Universum-Version.
        S.cam.x += ax * 0.00142 * dt * (1 + Math.abs(ax) * 0.9);
        S.cam.y += ay * 0.00088 * dt * (1 + Math.abs(ay) * 0.75);
        moving = true;
      }
    }

    var v = S.vel;
    if (!S.anim && !S.pointers.size && Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) > 0.000001) {
      S.cam.x += v.x * dt; S.cam.y += v.y * dt; S.cam.z += v.z * dt;
      var damp = Math.pow(0.92, dt / 16.7);
      v.x *= damp; v.y *= damp; v.z *= damp;
      if (Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) < 0.000003) v.x = v.y = v.z = 0;
      moving = true;
    }

    render(now);
    if (moving || S.pendingWheel || S.anim) requestFrame();
  }

  function local(e) { return { x: e.clientX - S.left, y: e.clientY - S.top }; }
  function mid() {
    var arr = [], x = 0, y = 0;
    S.pointers.forEach(function (p) { arr.push(p); x += p.x; y += p.y; });
    return { x: x / Math.max(1, arr.length), y: y / Math.max(1, arr.length), n: arr.length, dist: arr.length > 1 ? Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y) : 0 };
  }
  function startGesture() {
    var m = mid();
    S.gesture = { lastX: m.x, lastY: m.y, lastDist: m.dist, moved: 0, t0: performance.now(), samples: [] };
  }
  function zoomStep(px, py, factor) {
    var dz = U.REF * (1 - 1 / factor);
    S.cam.z += dz;
    S.cam.x += (px - S.W / 2) * dz / S.FOC;
    S.cam.y += (py - S.H / 2) * dz / S.FOC;
  }
  function flyTo(x, y, z, ms) {
    S.vel.x = S.vel.y = S.vel.z = 0;
    if (reducedMotion()) { S.cam.x = x; S.cam.y = y; S.cam.z = z; S.anim = null; requestFrame(); return; }
    S.anim = { from: { x: S.cam.x, y: S.cam.y, z: S.cam.z }, to: { x: x, y: y, z: z }, t0: performance.now(), ms: ms || 520 };
    requestFrame();
  }
  function hitTest(x, y) {
    for (var i = S.drawn.length - 1; i >= 0; i--) {
      var o = S.drawn[i];
      if (o.a < 0.28) continue;
      var dx = x - o.px, dy = y - o.py;
      var c = Math.cos(-o.rot), s = Math.sin(-o.rot);
      var rx = dx * c - dy * s, ry = dx * s + dy * c;
      if (Math.abs(rx) <= o.w * 0.44 && Math.abs(ry) <= o.h * 0.47) return o;
    }
    return null;
  }
  function openItem(it) {
    if (!it || !it.id) return;
    location.href = PREFIX + "artikel/" + encodeURIComponent(it.id) + "/";
  }
  function tap(x, y, pointerType) {
    var now = performance.now(), hit = hitTest(x, y);
    if (!hit) { S.lastTap = { t: now, x: x, y: y, key: "" }; return; }
    if (pointerType !== "mouse") {
      if (hit.w >= U.BIG) openItem(hit.it);
      else {
        var targetD = U.ITEM_W * S.FOC / Math.min(S.W * 0.62, 260);
        flyTo(hit.x, hit.y, hit.z - targetD, 520);
      }
      return;
    }
    var dbl = S.lastTap.key === hit.key && now - S.lastTap.t < 380 && Math.hypot(x - S.lastTap.x, y - S.lastTap.y) < 36;
    if (dbl) { S.lastTap.t = 0; openItem(hit.it); return; }
    S.lastTap = { t: now, x: x, y: y, key: hit.key };
    var td = U.ITEM_W * S.FOC / Math.min(S.W * 0.62, 260);
    flyTo(hit.x, hit.y, hit.z - td, 420);
  }

  canvas.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    S.mouse.active = false;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    S.pointers.set(e.pointerId, local(e));
    S.anim = null; S.vel.x = S.vel.y = S.vel.z = 0;
    startGesture(); canvas.classList.add("is-dragging"); tooltip.classList.remove("is-visible"); requestFrame();
  });

  canvas.addEventListener("pointermove", function (e) {
    var p = local(e);
    if (!S.pointers.has(e.pointerId) || !S.gesture) {
      if (e.pointerType === "mouse" && !e.buttons) {
        S.mouse.active = true;
        S.mouse.x = clamp((p.x - S.W / 2) / Math.max(1, S.W / 2), -1, 1);
        S.mouse.y = clamp((p.y - S.H / 2) / Math.max(1, S.H / 2), -1, 1);
        var hit = hitTest(p.x, p.y);
        canvas.classList.toggle("is-over", !!hit);
        if (hit) {
          if (hit.key !== S.hoverKey) {
            S.hoverKey = hit.key;
            tooltip.innerHTML = "<strong>" + String(hit.it.brand || "").replace(/[&<>\"]/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }) + "</strong>" + String(hit.it.title || "").replace(/[&<>\"]/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }) + "<br>" + money(hit.it.price);
          }
          tooltip.style.left = (e.clientX + 10) + "px"; tooltip.style.top = (e.clientY - 10) + "px"; tooltip.classList.add("is-visible");
        } else { S.hoverKey = ""; tooltip.classList.remove("is-visible"); }
        requestFrame();
      }
      return;
    }

    S.pointers.set(e.pointerId, p);
    var m = mid(), g = S.gesture, bx = S.cam.x, by = S.cam.y, bz = S.cam.z;
    if (m.n >= 2 && g.lastDist > 0) {
      var factor = m.dist / g.lastDist;
      if (factor > 0.35 && factor < 2.8) zoomStep(m.x, m.y, factor);
      g.lastDist = m.dist;
    }
    var dx = m.x - g.lastX, dy = m.y - g.lastY;
    S.cam.x -= dx * U.REF / S.FOC;
    S.cam.y -= dy * U.REF / S.FOC;
    g.lastX = m.x; g.lastY = m.y; g.moved += Math.abs(dx) + Math.abs(dy) + (m.n >= 2 ? 8 : 0);
    g.samples.push({ t: e.timeStamp, x: S.cam.x - bx, y: S.cam.y - by, z: S.cam.z - bz });
    if (g.samples.length > 7) g.samples.shift();
    requestFrame();
  });

  function endPointer(e) {
    if (!S.pointers.has(e.pointerId)) return;
    var localEnd = local(e), wasSingle = S.pointers.size === 1;
    S.pointers.delete(e.pointerId);
    if (S.pointers.size) { startGesture(); return; }
    canvas.classList.remove("is-dragging");
    var g = S.gesture; S.gesture = null;
    if (!g) return;
    if (wasSingle && g.moved < 10 && performance.now() - g.t0 < 360 && e.type === "pointerup") { tap(localEnd.x, localEnd.y, e.pointerType); return; }
    var recent = g.samples.filter(function (s) { return e.timeStamp - s.t < 100; });
    if (recent.length > 1) {
      var span = Math.max(16, e.timeStamp - recent[0].t), sx = 0, sy = 0, sz = 0;
      recent.forEach(function (s) { sx += s.x; sy += s.y; sz += s.z; });
      S.vel.x = sx / span; S.vel.y = sy / span; S.vel.z = sz / span;
    }
    requestFrame();
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", function (e) {
    if (e.pointerType === "mouse" && !S.pointers.size) { S.mouse.active = false; S.hoverKey = ""; tooltip.classList.remove("is-visible"); canvas.classList.remove("is-over"); }
  });
  canvas.addEventListener("gesturestart", function (e) { e.preventDefault(); });
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    var p = local(e);
    var delta = e.deltaMode === 1 ? e.deltaY * 24 : e.deltaY;
    S.pendingWheel = clamp(S.pendingWheel + clamp(delta, -120, 120), -320, 320);
    S.wheelX = p.x; S.wheelY = p.y;
    S.anim = null; S.vel.x = S.vel.y = S.vel.z = 0;
    tooltip.classList.remove("is-visible");
    requestFrame();
  }, { passive: false });

  canvas.addEventListener("keydown", function (e) {
    var step = 64 * U.REF / S.FOC;
    if (e.key === "+" || e.key === "=") zoomStep(S.W / 2, S.H / 2, 1.45);
    else if (e.key === "-") zoomStep(S.W / 2, S.H / 2, 1 / 1.45);
    else if (e.key === "ArrowLeft") flyTo(S.cam.x - step, S.cam.y, S.cam.z, 180);
    else if (e.key === "ArrowRight") flyTo(S.cam.x + step, S.cam.y, S.cam.z, 180);
    else if (e.key === "ArrowUp") zoomStep(S.W / 2, S.H / 2, 1.28);
    else if (e.key === "ArrowDown") zoomStep(S.W / 2, S.H / 2, 1 / 1.28);
    else if (e.key === "Enter" && S.focusItem) openItem(S.focusItem);
    else return;
    e.preventDefault(); requestFrame();
  });

  focus.addEventListener("click", function () { if (S.focusItem) openItem(S.focusItem); });
  shuffle.addEventListener("click", function () {
    S.seed = (Math.random() * 2147483647) | 0; S.cells.clear(); S.focusKey = ""; S.focusItem = null;
    S.cam = { x: 0, y: 0, z: reducedMotion() ? 0 : -2.5 }; S.vel = { x: 0, y: 0, z: 0 }; S.anim = null;
    makeStars();
    if (!reducedMotion()) flyTo(0, 0, 0, 700); else requestFrame();
  });
  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", function () { S.lastT = 0; if (!document.hidden) requestFrame(); });

  function prewarm() {
    var task = function () {
      var n = Math.min(S.pool.length, 36);
      for (var i = 0; i < n; i++) thumb(S.pool[(i * 7) % S.pool.length]);
      for (var j = 0; j < Math.min(10, S.pool.length); j++) display(S.pool[(j * 11) % S.pool.length]);
    };
    if ("requestIdleCallback" in window) requestIdleCallback(task, { timeout: 900 });
    else setTimeout(task, 120);
  }

  function start(items) {
    S.pool = items.filter(function (it) { return it && it.public_status === "AVAILABLE" && it.gallery && it.gallery[0]; });
    if (!S.pool.length) throw new Error("empty catalog");
    makeStars(); resize(); prewarm();
    status.textContent = COPY.loaded + " · " + S.pool.length;
    hint.textContent = finePointer() ? COPY.hintMouse : COPY.hintTouch;
    setTimeout(function () { hint.classList.add("is-gone"); }, 6500);
    if (!reducedMotion()) flyTo(0, 0, 0, 900); else { S.cam.z = 0; requestFrame(); }
    if (finePointer()) { try { canvas.focus({ preventScroll: true }); } catch (e) {} }
  }

  fetch("/data/catalog.json", { cache: "force-cache" })
    .then(function (r) { if (!r.ok) throw new Error("catalog " + r.status); return r.json(); })
    .then(start)
    .catch(function () { errorBox.hidden = false; errorBox.textContent = COPY.fail; status.textContent = ""; });
})();
