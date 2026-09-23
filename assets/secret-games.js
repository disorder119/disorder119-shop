(function () {
  "use strict";

  if (window.__D119_DODGE_THE_DROP_V1__) return;
  window.__D119_DODGE_THE_DROP_V1__ = true;

  var ROOT_ID = "d119SecretGames";
  var COUPON_KEY = "d119_reward_coupon";
  var BEST_KEY = "d119_dodge_the_drop_best_v1";
  // The deployed reward API still stores the historical database id/version.
  // Keep those protocol values for compatibility; the public game is entirely new.
  var GAME_ID = "warp";
  var SUBMISSION_VERSION = "archive-raid-v3";
  var PUBLIC_VERSION = "dodge-the-drop-v1";
  var META = {
    title: "DODGE THE DROP",
    subtitle: "Move. Dodge. Survive.",
    target: 48000,
    duration: 42000
  };

  var state = {
    root: null,
    gate: null,
    stage: null,
    result: null,
    encounter: null,
    encounterTimer: 0,
    active: false,
    run: null,
    stopGame: null,
    items: null,
    directStarted: false,
    selectionGuardInstalled: false
  };

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function now() { return Date.now(); }
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "local-" + now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }
  function formatScore(value) {
    return Math.max(0, Math.round(Number(value) || 0)).toLocaleString("de-DE") + " P";
  }
  function apiBase() {
    var cfg = window.SHOP_CONFIG || window.ARTICLE_SHOP_CONFIG || {};
    return String(window.D119_GAME_API || cfg.shopWorkerUrl || "").replace(/\/$/, "");
  }
  async function api(path, options) {
    var base = apiBase();
    if (!base) throw new Error("GAME_API_NOT_CONFIGURED");
    var response = await fetch(base + path, Object.assign({
      headers: { "Content-Type": "application/json" },
      credentials: "omit"
    }, options || {}));
    var data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(data && data.error ? data.error : "GAME_API_FAILED");
    return data || {};
  }

  async function loadItems() {
    if (state.items) return state.items;
    try {
      var response = await fetch("/data/catalog.json", { cache: "no-store" });
      if (!response.ok) throw new Error("catalog");
      var raw = await response.json();
      var list = Array.isArray(raw) ? raw : (Array.isArray(raw.items) ? raw.items : []);
      state.items = list.filter(function (it) {
        return String(it.public_status || "").toUpperCase() === "AVAILABLE" && Array.isArray(it.gallery) && it.gallery[0];
      }).slice(0, 260);
    } catch (_) {
      state.items = [];
    }
    return state.items;
  }
  function imageUrl(item) {
    var value = item && item.gallery && item.gallery[0] ? String(item.gallery[0]) : "";
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    return "/" + value.replace(/^\/+/, "");
  }

  function universeReady() {
    var view = document.getElementById("chaosView");
    return !!(view && !view.classList.contains("hidden") && !view.classList.contains("chaos-view--game") &&
      !state.active && (!state.root || state.root.hidden));
  }

  function stopNativeGame() {
    var native = document.getElementById("chaosGame");
    if (native && !native.hidden) {
      var back = document.getElementById("chaosGameBack");
      if (back) back.click();
    }
  }

  function installSelectionGuard() {
    if (state.selectionGuardInstalled) return;
    var host = document.getElementById("chaosScreen");
    if (!host) return;
    state.selectionGuardInstalled = true;
    host.addEventListener("selectstart", function (event) {
      var target = event.target;
      if (target && target.closest && target.closest("input,textarea,[contenteditable='true']")) return;
      event.preventDefault();
    }, true);
    host.addEventListener("dragstart", function (event) {
      var target = event.target;
      if (target && target.closest && target.closest("input,textarea,[contenteditable='true']")) return;
      event.preventDefault();
    }, true);
  }

  function buildRoot() {
    if (state.root) return state.root;
    var host = document.getElementById("chaosScreen") || document.body;
    var root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "d119-games d119-dodge-game";
    root.hidden = true;
    root.innerHTML =
      '<div class="d119-games__veil"></div>' +
      '<section class="d119-game-gate" data-view="gate" hidden>' +
        '<button type="button" class="d119-game-close" data-action="close" aria-label="Schließen">×</button>' +
        '<p class="d119-game-kicker">DISORDER119 // GAME 01</p>' +
        '<h2 class="d119-game-heading">DODGE<br>THE DROP</h2>' +
        '<p class="d119-game-copy">Echte Pieces aus dem Shop fallen durch den Screen. Bewege den 119-Punkt nur mit Maus, Trackpad oder Finger und weich den Klamotten aus. Kein Schießen, kein Klicken.</p>' +
        '<div class="d119-game-rules"><span>42 SEK.</span><span>MAUS = BEWEGEN</span><span>48K = 10%</span></div>' +
        '<button type="button" class="d119-game-start" data-action="start">START</button>' +
        '<p class="d119-gate-note">Desktop: Maus einfach bewegen. Mobil: Finger ziehen. Pfeiltasten funktionieren ebenfalls. Esc beendet das Spiel.</p>' +
      '</section>' +
      '<section class="d119-game-stage" data-view="stage" hidden></section>' +
      '<section class="d119-game-result" data-view="result" hidden></section>';
    host.appendChild(root);
    state.root = root;
    state.gate = qs('[data-view="gate"]', root);
    state.stage = qs('[data-view="stage"]', root);
    state.result = qs('[data-view="result"]', root);
    root.addEventListener("click", function (event) {
      var action = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      if (!action) return;
      var name = action.getAttribute("data-action");
      if (name === "close" || name === "back") closeGames();
      else if (name === "start" || name === "retry") launchGame();
    });
    installSelectionGuard();
    return root;
  }

  function setView(name) {
    [state.gate, state.stage, state.result].forEach(function (view) { if (view) view.hidden = true; });
    var target = name === "gate" ? state.gate : name === "stage" ? state.stage : state.result;
    if (target) target.hidden = false;
  }
  function showRoot() {
    buildRoot();
    stopNativeGame();
    removeEncounter();
    state.root.hidden = false;
    document.documentElement.classList.add("d119-game-open");
    document.body.classList.add("d119-game-open");
  }
  function closeGames() {
    if (state.stopGame) { try { state.stopGame(); } catch (_) {} }
    state.stopGame = null;
    state.active = false;
    state.run = null;
    if (state.root) {
      state.root.hidden = true;
      state.stage.innerHTML = "";
      state.result.innerHTML = "";
    }
    document.documentElement.classList.remove("d119-game-open");
    document.body.classList.remove("d119-game-open");
    state.directStarted = false;
    scheduleEncounter(30000 + Math.random() * 60000);
  }
  function showGate() {
    showRoot();
    setView("gate");
  }

  async function createRun() {
    try {
      var result = await api("/games/start", { method: "POST", body: JSON.stringify({ game: GAME_ID }) });
      return { id: result.runId, token: result.runToken || "", startedAt: Number(result.startedAt || now()), server: true };
    } catch (_) {
      return { id: randomId(), token: "", startedAt: now(), server: false };
    }
  }

  function requestStart() { showGate(); }

  async function launchGame() {
    showRoot();
    setView("stage");
    state.stage.innerHTML = '<div class="d119-game-loading"><span></span><p>PIECES LADEN</p></div>';
    state.active = true;
    var pair = await Promise.all([createRun(), loadItems()]);
    if (!state.active) return;
    state.run = pair[0];
    if (!pair[1].length) {
      state.stage.innerHTML = '<div class="d119-game-loading"><p>Keine verfügbaren Pieces gefunden.</p></div>';
      return;
    }
    startDodge(pair[1]);
  }

  async function finishGame(score, details, durationMs) {
    if (state.stopGame) { try { state.stopGame(); } catch (_) {} }
    state.stopGame = null;
    state.active = false;
    var run = state.run;
    var safeScore = clamp(Math.round(score), 0, 149900);
    var qualified = safeScore >= META.target;
    var couponCode = "";
    var server = false;
    if (run && run.server) {
      try {
        var response = await api("/games/score", {
          method: "POST",
          body: JSON.stringify({
            game: GAME_ID,
            runId: run.id,
            runToken: run.token,
            username: "PLAYER119",
            score: safeScore,
            durationMs: Math.round(durationMs),
            detail: Object.assign({ version: SUBMISSION_VERSION, mode: PUBLIC_VERSION }, details || {})
          })
        });
        qualified = Boolean(response.qualified);
        couponCode = String(response.couponCode || "");
        server = true;
      } catch (_) {}
    }
    if (!server && qualified) couponCode = "D11910-PREVIEW";
    if (couponCode) {
      try { localStorage.setItem(COUPON_KEY, JSON.stringify({ code: couponCode, game: GAME_ID, issuedAt: now(), server: server })); } catch (_) {}
      document.dispatchEvent(new CustomEvent("d119:coupon-earned", { detail: { code: couponCode, server: server } }));
    }
    renderResult(safeScore, qualified, couponCode, server, details || {});
  }

  function renderResult(score, qualified, couponCode, server, details) {
    showRoot();
    setView("result");
    var best = 0;
    try { best = Number(localStorage.getItem(BEST_KEY) || 0); } catch (_) {}
    if (score > best) {
      best = score;
      try { localStorage.setItem(BEST_KEY, String(score)); } catch (_) {}
    }
    var dodged = Math.max(0, Number(details.dodged || 0));
    var hits = Math.max(0, Number(details.hits || 0));
    var reward = qualified
      ? '<div class="d119-reward is-earned"><span>10 % UNLOCKED</span><strong>' + escapeHtml(couponCode || "FREIGESCHALTET") + '</strong><small>' +
          (server ? "Einmaliger Code · serverseitig geprüft" : "Preview · echter Code sobald der Shop-Worker aktiv ist") + '</small></div>'
      : '<div class="d119-reward"><span>10 % LOCKED</span><strong>NOCH ' + formatScore(Math.max(0, META.target - score)) + '</strong><small>Zielscore: ' + formatScore(META.target) + '</small></div>';
    state.result.innerHTML =
      '<button type="button" class="d119-game-close" data-action="close" aria-label="Schließen">×</button>' +
      '<p class="d119-game-kicker">DODGE THE DROP // FINISH</p>' +
      '<h2 class="d119-result-score">' + formatScore(score) + '</h2>' +
      '<p class="d119-result-line">' + dodged + ' Pieces ausgewichen · ' + hits + ' Treffer</p>' +
      '<p class="d119-result-best">Bestwert auf diesem Gerät: ' + formatScore(best) + '</p>' +
      reward +
      '<div class="d119-result-actions"><button type="button" class="d119-retry" data-action="retry">NOCHMAL</button>' +
      '<button type="button" class="d119-return-universe" data-action="back">ZURÜCK INS UNIVERSUM</button></div>';
  }

  function startDodge(items) {
    var stage = state.stage;
    stage.innerHTML =
      '<div class="d119-dodge-shell">' +
        '<canvas class="d119-dodge-canvas" tabindex="0" aria-label="Dodge the Drop. Bewege den 119-Punkt und weiche den fallenden Kleidungsstücken aus."></canvas>' +
        '<div class="d119-dodge-hud">' +
          '<span><small>ZEIT</small><strong data-hud="time">42</strong></span>' +
          '<span><small>SCORE</small><strong data-hud="score">0 P</strong></span>' +
          '<span><small>AUSGEWICHEN</small><strong data-hud="dodged">0</strong></span>' +
          '<span><small>TREFFER</small><strong data-hud="hits">0</strong></span>' +
        '</div>' +
        '<p class="d119-dodge-help">MAUS BEWEGEN · NICHT KLICKEN · ESC = ENDE</p>' +
        '<button type="button" class="d119-game-close d119-game-close--play" data-action="close" aria-label="Spiel beenden">×</button>' +
      '</div>';

    var canvas = qs("canvas", stage);
    var ctx = canvas.getContext("2d", { alpha: false });
    var shell = qs(".d119-dodge-shell", stage);
    var hudTime = qs('[data-hud="time"]', stage);
    var hudScore = qs('[data-hud="score"]', stage);
    var hudDodged = qs('[data-hud="dodged"]', stage);
    var hudHits = qs('[data-hud="hits"]', stage);
    var dpr = 1, W = 1, H = 1, raf = 0;
    var started = performance.now(), last = started, lastSpawn = started - 500;
    var score = 0, dodged = 0, hits = 0, stopped = false;
    var player = { x: 0, y: 0, r: 17, invUntil: 0 };
    var obstacles = [], pops = [], keys = {};
    var imageCache = Object.create(null);
    var stars = [];
    for (var si = 0; si < 80; si++) stars.push({ x: Math.random(), y: Math.random(), s: 0.4 + Math.random() * 1.4, a: 0.15 + Math.random() * 0.45 });

    function resize() {
      var r = shell.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      if (!player.x) { player.x = W * 0.5; player.y = H * 0.78; }
      player.x = clamp(player.x, player.r + 4, W - player.r - 4);
      player.y = clamp(player.y, 78, H - player.r - 8);
    }
    function imageFor(item) {
      var src = imageUrl(item);
      if (!src) return null;
      if (!imageCache[src]) { var im = new Image(); im.decoding = "async"; im.src = src; imageCache[src] = im; }
      return imageCache[src];
    }
    function spawn(progress) {
      var item = items[Math.floor(Math.random() * items.length)];
      var base = W < 600 ? 64 : 78;
      var width = base + Math.random() * (W < 600 ? 42 : 68);
      obstacles.push({
        item: item, img: imageFor(item), x: width * 0.55 + Math.random() * Math.max(1, W - width * 1.1), y: -width * 1.7,
        w: width, h: width * 1.25, vy: 150 + progress * 240 + Math.random() * 95,
        vx: (Math.random() - 0.5) * (18 + progress * 34), resolved: false, hit: false, rot: (Math.random() - 0.5) * 0.12
      });
    }
    function overlap(o) {
      var hw = o.w * 0.31, hh = o.h * 0.34;
      return Math.abs(player.x - o.x) < hw + player.r && Math.abs(player.y - o.y) < hh + player.r;
    }
    function addPop(text, x, y, bad) { pops.push({ text: text, x: x, y: y, t: performance.now(), bad: bad }); }
    function updateHud(remaining) {
      hudTime.textContent = String(Math.max(0, Math.ceil(remaining / 1000)));
      hudScore.textContent = formatScore(score);
      hudDodged.textContent = String(dodged);
      hudHits.textContent = String(hits);
    }
    function onPointer(e) {
      var r = canvas.getBoundingClientRect();
      player.x = clamp(e.clientX - r.left, player.r + 4, W - player.r - 4);
      player.y = clamp(e.clientY - r.top, 78, H - player.r - 8);
      if (e.pointerType !== "mouse" && e.cancelable) e.preventDefault();
    }
    function onKeyDown(e) {
      if (e.key === "Escape") { e.preventDefault(); closeGames(); return; }
      if (/^Arrow(Up|Down|Left|Right)$/.test(e.key)) { e.preventDefault(); keys[e.key] = true; }
    }
    function onKeyUp(e) { delete keys[e.key]; }
    function stop() {
      if (stopped) return;
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      canvas.removeEventListener("pointermove", onPointer);
      canvas.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", resize);
    }
    state.stopGame = stop;

    canvas.addEventListener("pointermove", onPointer, { passive: false });
    canvas.addEventListener("pointerdown", onPointer, { passive: false });
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("resize", resize);
    resize();
    try { canvas.focus({ preventScroll: true }); } catch (_) {}

    function frame(t) {
      if (stopped || !state.active) return;
      var dt = Math.min(34, Math.max(0, t - last)); last = t;
      var elapsed = t - started;
      var remaining = META.duration - elapsed;
      var progress = clamp(elapsed / META.duration, 0, 1);
      if (remaining <= 0) {
        updateHud(0);
        finishGame(score, { dodged: dodged, hits: hits }, META.duration);
        return;
      }

      var move = dt * 0.55;
      if (keys.ArrowLeft) player.x -= move;
      if (keys.ArrowRight) player.x += move;
      if (keys.ArrowUp) player.y -= move;
      if (keys.ArrowDown) player.y += move;
      player.x = clamp(player.x, player.r + 4, W - player.r - 4);
      player.y = clamp(player.y, 78, H - player.r - 8);

      var interval = 720 - progress * 360;
      if (t - lastSpawn >= interval) { lastSpawn = t; spawn(progress); }

      obstacles.forEach(function (o) {
        o.x += o.vx * dt / 1000;
        o.y += o.vy * dt / 1000;
        if (o.x < o.w * 0.4 || o.x > W - o.w * 0.4) o.vx *= -1;
        var im = o.img;
        if (im && im.complete && im.naturalWidth > 0) {
          o.h = Math.min(o.w * 1.72, o.w * im.naturalHeight / im.naturalWidth);
        }
        if (!o.resolved && t >= player.invUntil && overlap(o)) {
          o.resolved = true; o.hit = true; hits++;
          score = Math.max(0, score - 2800);
          player.invUntil = t + 720;
          addPop("TREFFER −2.800", player.x, player.y - 26, true);
        }
        if (!o.resolved && o.y - o.h * 0.5 > H) {
          o.resolved = true; dodged++;
          var price = Math.max(0, Number(o.item && o.item.price) || 0);
          var gain = Math.round(Math.min(4000, 900 + price * 2));
          score = Math.min(149900, score + gain);
          addPop("+" + gain.toLocaleString("de-DE"), clamp(o.x, 50, W - 50), H - 42, false);
        }
      });
      obstacles = obstacles.filter(function (o) { return o.y - o.h < H + 160; });
      pops = pops.filter(function (p) { return t - p.t < 850; });

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#020202"; ctx.fillRect(0, 0, W, H);
      stars.forEach(function (s) {
        var yy = (s.y * H + elapsed * s.s * 0.02) % H;
        ctx.globalAlpha = s.a; ctx.fillStyle = "#f2efe7"; ctx.fillRect(s.x * W, yy, s.s, s.s);
      });
      ctx.globalAlpha = 1;
      obstacles.forEach(function (o) {
        ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.rot);
        ctx.globalAlpha = o.hit ? 0.28 : 0.94;
        if (o.img && o.img.complete && o.img.naturalWidth > 0) ctx.drawImage(o.img, -o.w / 2, -o.h / 2, o.w, o.h);
        else { ctx.strokeStyle = "rgba(242,239,231,.55)"; ctx.strokeRect(-o.w / 2, -o.h / 2, o.w, o.h); }
        ctx.restore();
      });

      ctx.globalAlpha = t < player.invUntil ? (Math.floor(t / 80) % 2 ? 0.3 : 1) : 1;
      ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
      ctx.fillStyle = "#f2efe7"; ctx.fill();
      ctx.fillStyle = "#050505"; ctx.font = "800 9px Helvetica Neue, Arial, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("119", player.x, player.y + 0.5);
      ctx.globalAlpha = 1;

      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.font = "800 12px Helvetica Neue, Arial, sans-serif";
      pops.forEach(function (p) {
        var q = (t - p.t) / 850;
        ctx.globalAlpha = 1 - q;
        ctx.fillStyle = p.bad ? "#f2efe7" : "rgba(242,239,231,.86)";
        ctx.fillText(p.text, p.x, p.y - q * 34);
      });
      ctx.globalAlpha = 1;
      updateHud(remaining);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }

  function removeEncounter() {
    if (state.encounter) { try { state.encounter.remove(); } catch (_) {} state.encounter = null; }
  }
  function scheduleEncounter(delay) {
    clearTimeout(state.encounterTimer);
    state.encounterTimer = setTimeout(function waitForUniverse() {
      if (!universeReady()) { state.encounterTimer = setTimeout(waitForUniverse, 1800 + Math.random() * 2200); return; }
      spawnEncounter();
    }, Math.max(1200, delay || 9000));
  }
  function spawnEncounter() {
    removeEncounter();
    if (!universeReady()) return;
    var host = document.getElementById("chaosScreen");
    if (!host) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "d119-universe-encounter";
    btn.setAttribute("aria-label", "Dodge the Drop starten");
    btn.innerHTML = '<span aria-hidden="true">DODGE<br><b>THE DROP</b></span>';
    btn.style.setProperty("--enc-y", (18 + Math.random() * 52).toFixed(1) + "%");
    btn.style.setProperty("--enc-dur", (8 + Math.random() * 4).toFixed(2) + "s");
    btn.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
    btn.addEventListener("click", function (event) { event.preventDefault(); event.stopPropagation(); removeEncounter(); requestStart(); });
    btn.addEventListener("animationend", function () {
      if (state.encounter !== btn) return;
      removeEncounter(); scheduleEncounter(34000 + Math.random() * 62000);
    });
    host.appendChild(btn); state.encounter = btn;
  }
  function directGame() {
    var value = String(new URLSearchParams(location.search).get("game") || "").toLowerCase();
    return ["dodge", "drop", "game", "raid", "warp"].indexOf(value) >= 0;
  }
  function observeUniverse() {
    var view = document.getElementById("chaosView"); if (!view) return;
    var obs = new MutationObserver(function () {
      if (universeReady() && !state.encounter && !state.directStarted) scheduleEncounter(9000 + Math.random() * 22000);
      if (!universeReady()) removeEncounter();
    });
    obs.observe(view, { attributes: true, attributeFilter: ["class"] });
    if (universeReady()) scheduleEncounter(9000 + Math.random() * 22000);
  }
  function bindLaunchButtons() {
    qsa("[data-d119-game-launch]").forEach(function (button) {
      if (button.getAttribute("data-d119-game-bound") === "1") return;
      button.setAttribute("data-d119-game-bound", "1");
      button.addEventListener("click", function (event) { event.preventDefault(); requestStart(); });
    });
  }
  function boot() {
    if (!document.getElementById("chaosView")) return;
    buildRoot();
    qsa(".d119-warp-control,.universe-shooting-star,.d119-secret-relic,#universeTurbo").forEach(function (el) { el.remove(); });
    installSelectionGuard(); bindLaunchButtons(); observeUniverse();
    var game = directGame();
    if (game) { state.directStarted = true; setTimeout(requestStart, 420); }
    window.D119SecretGames = Object.freeze({ start: requestStart, close: closeGames, discover: spawnEncounter, version: PUBLIC_VERSION });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();