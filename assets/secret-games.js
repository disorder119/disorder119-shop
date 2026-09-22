(function () {
  "use strict";

  if (window.__D119_ARCHIVE_RAID_V3__) return;
  window.__D119_ARCHIVE_RAID_V3__ = true;

  var ROOT_ID = "d119SecretGames";
  var NAME_KEY = "d119_secret_player";
  var COUPON_KEY = "d119_reward_coupon";
  var LOCAL_BOARD_KEY = "d119_archive_raid_board_v3";
  var GAME_ID = "warp";
  var GAME_VERSION = "archive-raid-v3";
  var META = {
    title: "ARCHIVE RAID 119",
    subtitle: "Defend the Disorder archive",
    target: 48000,
    duration: 42000,
    copy: "Ein fremder Carrier zieht Archive-Cargo in den Void. Übernimm STARSHIP 119, zerstöre Drohnen und Asteroiden, rette Pieces und überlebe den finalen NULL CARRIER."
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
    if (!response.ok) {
      var err = new Error(data && data.error ? data.error : "GAME_API_FAILED");
      err.status = response.status;
      throw err;
    }
    return data || {};
  }

  function loadName() {
    try { return String(localStorage.getItem(NAME_KEY) || "").slice(0, 16); } catch (_) { return ""; }
  }
  function validName(value) {
    var v = String(value || "").trim();
    if (v.length < 3 || v.length > 16) return false;
    try { return /^[\p{L}\p{N}._ -]+$/u.test(v); }
    catch (_) { return /^[A-Za-z0-9._ -]+$/.test(v); }
  }
  function saveName(value) {
    var v = String(value || "").trim().replace(/\s+/g, " ").slice(0, 16);
    if (!validName(v)) return "";
    try { localStorage.setItem(NAME_KEY, v); } catch (_) {}
    return v;
  }
  function normalizeGame(value) {
    var v = String(value || "").toLowerCase().trim();
    if (!v) return "";
    if (["raid", "archive", "archive-raid", "warp", "signal", "memory", "1", "2", "3"].indexOf(v) >= 0) return GAME_ID;
    return "";
  }

  async function loadItems() {
    if (state.items) return state.items;
    try {
      var response = await fetch("/data/items.json", { cache: "no-store" });
      if (!response.ok) throw new Error("catalog");
      var raw = await response.json();
      var list = Array.isArray(raw) ? raw : (Array.isArray(raw.items) ? raw.items : []);
      state.items = list.filter(function (it) {
        return String(it.public_status || "").toUpperCase() === "AVAILABLE" && Array.isArray(it.gallery) && it.gallery[0];
      }).slice(0, 240);
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
    qsa("img", host).forEach(function (img) { img.draggable = false; });
  }

  function buildRoot() {
    if (state.root) return state.root;
    var host = document.getElementById("chaosScreen") || document.body;
    var root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "d119-games d119-games-v3";
    root.hidden = true;
    root.innerHTML =
      '<div class="d119-games__veil"></div>' +
      '<section class="d119-game-gate" data-view="gate" hidden>' +
        '<button type="button" class="d119-game-close" data-action="close" aria-label="Schließen">×</button>' +
        '<div class="d119-raid-emblem" aria-hidden="true"><span></span><b>119</b><i></i></div>' +
        '<p class="d119-game-kicker">UNIVERSE // CLASSIFIED ENCOUNTER</p>' +
        '<h2 class="d119-game-heading">' + META.title + '</h2>' +
        '<p class="d119-game-copy">' + META.copy + '</p>' +
        '<div class="d119-game-rules"><span>42 SEK.</span><span>AUTO-CANNON</span><span>48K = 10%</span></div>' +
        '<form class="d119-player-gate" data-player-gate>' +
          '<label><span>CALLSIGN</span><input type="text" maxlength="16" autocomplete="nickname" spellcheck="false" placeholder="3–16 Zeichen"></label>' +
          '<button type="submit">MISSION STARTEN</button>' +
        '</form>' +
        '<p class="d119-player-error" aria-live="polite"></p>' +
        '<p class="d119-gate-note">Finger halten + ziehen = steuern und feuern. Archive-Cargo nicht abschießen — einsammeln.</p>' +
      '</section>' +
      '<section class="d119-game-stage" data-view="stage" hidden></section>' +
      '<section class="d119-game-result" data-view="result" hidden></section>';
    host.appendChild(root);
    state.root = root;
    state.gate = qs('[data-view="gate"]', root);
    state.stage = qs('[data-view="stage"]', root);
    state.result = qs('[data-view="result"]', root);

    var form = qs("[data-player-gate]", root);
    var input = qs(".d119-player-gate input", root);
    input.value = loadName();
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var name = saveName(input.value);
      if (!name) {
        qs(".d119-player-error", root).textContent = "Bitte 3–16 Zeichen: Buchstaben, Zahlen, Punkt, _ oder -.";
        return;
      }
      qs(".d119-player-error", root).textContent = "";
      launchGame(name);
    });
    root.addEventListener("click", function (event) {
      var close = event.target.closest && event.target.closest('[data-action="close"]');
      if (close) closeGames();
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
    scheduleEncounter(26000 + Math.random() * 62000);
  }

  function showGate() {
    showRoot();
    setView("gate");
    var input = qs(".d119-player-gate input", state.gate);
    input.value = loadName();
    setTimeout(function () { try { input.focus(); } catch (_) {} }, 90);
  }

  function localBoards() {
    try {
      var parsed = JSON.parse(localStorage.getItem(LOCAL_BOARD_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }
  function localAdd(name, score) {
    var list = localBoards();
    list.push({ username: name, score: Math.round(score), createdAt: new Date().toISOString() });
    list.sort(function (a, b) { return b.score - a.score; });
    list = list.slice(0, 20);
    try { localStorage.setItem(LOCAL_BOARD_KEY, JSON.stringify(list)); } catch (_) {}
    return list;
  }

  async function createRun() {
    try {
      var result = await api("/games/start", { method: "POST", body: JSON.stringify({ game: GAME_ID }) });
      return { id: result.runId, token: result.runToken || "", startedAt: Number(result.startedAt || now()), server: true };
    } catch (_) {
      return { id: randomId(), token: "", startedAt: now(), server: false };
    }
  }

  async function requestStart() {
    removeEncounter();
    var name = loadName();
    if (!validName(name)) { showGate(); return; }
    launchGame(name);
  }

  async function launchGame(name) {
    showRoot();
    setView("stage");
    state.stage.innerHTML = '<div class="d119-game-loading"><span></span><p>STARSHIP 119 WIRD GEKOPPELT</p></div>';
    state.active = true;
    var pair = await Promise.all([createRun(), loadItems()]);
    if (!state.active) return;
    state.run = pair[0];
    startRaid(name, pair[1]);
  }

  async function finishGame(name, score, details, durationMs) {
    if (state.stopGame) { try { state.stopGame(); } catch (_) {} }
    state.stopGame = null;
    state.active = false;
    var run = state.run;
    var safeScore = Math.max(0, Math.round(score));
    var qualified = safeScore >= META.target;
    var couponCode = "";
    var board = null;
    var server = false;
    if (run && run.server) {
      try {
        var response = await api("/games/score", {
          method: "POST",
          body: JSON.stringify({
            game: GAME_ID,
            runId: run.id,
            runToken: run.token,
            username: name,
            score: safeScore,
            durationMs: Math.round(durationMs),
            detail: Object.assign({ version: GAME_VERSION }, details || {})
          })
        });
        qualified = Boolean(response.qualified);
        couponCode = String(response.couponCode || "");
        board = Array.isArray(response.leaderboard) ? response.leaderboard : null;
        server = true;
      } catch (_) {}
    }
    if (!server) {
      board = localAdd(name, safeScore);
      if (qualified) couponCode = "D11910-PREVIEW";
    }
    if (couponCode) {
      try { localStorage.setItem(COUPON_KEY, JSON.stringify({ code: couponCode, game: GAME_ID, issuedAt: now(), server: server })); } catch (_) {}
      document.dispatchEvent(new CustomEvent("d119:coupon-earned", { detail: { code: couponCode, server: server } }));
    }
    renderResult(name, safeScore, qualified, couponCode, board || [], server, details || {});
  }

  function renderResult(name, score, qualified, couponCode, board, server, details) {
    showRoot();
    setView("result");
    var accuracy = Number(details.accuracy || 0);
    var coupon = qualified ?
      '<div class="d119-reward is-earned"><span>10 % UNLOCKED</span><strong>' + escapeHtml(couponCode || "FREIGESCHALTET") + '</strong><small>' +
        (server ? "Einmaliger Code · serverseitig geprüft" : "Preview · echter Code sobald der Shop-Worker aktiv ist") + '</small></div>' :
      '<div class="d119-reward"><span>10 % LOCKED</span><strong>NOCH ' + formatScore(Math.max(0, META.target - score)) + '</strong><small>Zielscore: ' + formatScore(META.target) + '</small></div>';
    state.result.innerHTML =
      '<button type="button" class="d119-game-close" data-action="close" aria-label="Schließen">×</button>' +
      '<p class="d119-game-kicker">ARCHIVE RAID 119 // MISSION COMPLETE</p>' +
      '<h2 class="d119-result-score">' + formatScore(score) + '</h2>' +
      '<p class="d119-result-name">CALLSIGN ' + escapeHtml(name) + '</p>' +
      '<div class="d119-result-stats">' +
        '<span><small>KILLS</small><strong>' + Math.round(details.kills || 0) + '</strong></span>' +
        '<span><small>CARGO</small><strong>' + Math.round(details.cargo || 0) + '</strong></span>' +
        '<span><small>ACCURACY</small><strong>' + Math.round(accuracy) + '%</strong></span>' +
        '<span><small>HULL</small><strong>' + Math.max(0, Math.round(details.hull || 0)) + '%</strong></span>' +
      '</div>' + coupon +
      '<div class="d119-result-board"><div class="d119-board-title">TOP 10 ' + (server ? "GLOBAL" : "LOCAL") + '</div><ol class="d119-board-list">' +
        board.slice(0, 10).map(function (row, i) {
          return '<li><span>' + String(i + 1).padStart(2, "0") + '</span><strong>' + escapeHtml(row.username || "???") + '</strong><em>' + formatScore(row.score) + '</em></li>';
        }).join("") + '</ol></div>' +
      '<div class="d119-result-actions"><button type="button" class="d119-retry" data-action="retry">NOCHMAL</button>' +
        '<button type="button" class="d119-return-universe" data-action="close">ZURÜCK INS UNIVERSUM</button></div>';
    var retry = qs('[data-action="retry"]', state.result);
    if (retry) retry.addEventListener("click", function () { launchGame(name); });
  }

  function startRaid(name, items) {
    var duration = META.duration;
    var started = performance.now();
    var last = started;
    var raf = 0;
    var ended = false;
    var dpr = 1;
    var width = 390;
    var height = 700;
    var score = 0;
    var kills = 0;
    var cargoCount = 0;
    var shots = 0;
    var hits = 0;
    var combo = 0;
    var bestCombo = 0;
    var phase = 1;
    var enemySpawnAt = 0;
    var cargoSpawnAt = 0;
    var bossSpawned = false;
    var bossDefeated = false;
    var shakeUntil = 0;
    var flashUntil = 0;
    var player = { x: 0, y: 0, tx: 0, ty: 0, hull: 100, invulnerableUntil: 0, disabledUntil: 0, fireAt: 0, overdriveUntil: 0, shieldUntil: 0 };
    var pointer = { active: false, id: null };
    var keys = {};
    var bullets = [];
    var enemyBullets = [];
    var enemies = [];
    var cargo = [];
    var particles = [];
    var stars = [];
    var catalog = Array.isArray(items) && items.length ? items : [];
    var imageCache = Object.create(null);

    state.stage.innerHTML =
      '<div class="d119-raid-shell">' +
        '<canvas class="d119-raid-canvas" tabindex="0" aria-label="ARCHIVE RAID 119. Finger halten und ziehen zum Steuern und Feuern."></canvas>' +
        '<div class="d119-raid-hud" aria-live="polite">' +
          '<span><small>SCORE</small><strong data-hud="score">0 P</strong></span>' +
          '<span><small>HULL</small><strong data-hud="hull">100%</strong></span>' +
          '<span><small>COMBO</small><strong data-hud="combo">×1.0</strong></span>' +
          '<span><small>ZEIT</small><strong data-hud="time">42</strong></span>' +
        '</div>' +
        '<div class="d119-raid-phase" data-raid-phase>ORBIT 01 // ENTRY</div>' +
        '<div class="d119-boss-meter" data-boss-meter hidden><span>NULL CARRIER</span><i><b></b></i></div>' +
        '<div class="d119-raid-intro" data-raid-intro><strong>ARCHIVE RAID 119</strong><span>HALTEN + ZIEHEN = STEUERN & FEUERN</span></div>' +
        '<p class="d119-raid-help">Drohnen & Asteroiden zerstören · Archive-Cargo einsammeln · Treffer vermeiden</p>' +
        '<button type="button" class="d119-game-close d119-game-close--play" data-action="close" aria-label="Mission beenden">×</button>' +
      '</div>';

    state.stage.dataset.game = "archive-raid";
    state.stage.dataset.running = "1";
    state.stage.dataset.score = "0";
    state.stage.dataset.shots = "0";
    state.stage.dataset.kills = "0";

    var canvas = qs(".d119-raid-canvas", state.stage);
    var ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    var hudScore = qs('[data-hud="score"]', state.stage);
    var hudHull = qs('[data-hud="hull"]', state.stage);
    var hudCombo = qs('[data-hud="combo"]', state.stage);
    var hudTime = qs('[data-hud="time"]', state.stage);
    var phaseEl = qs("[data-raid-phase]", state.stage);
    var bossMeter = qs("[data-boss-meter]", state.stage);
    var bossFill = bossMeter ? qs("b", bossMeter) : null;
    var intro = qs("[data-raid-intro]", state.stage);

    function buildStars() {
      stars = [];
      var count = Math.max(45, Math.min(110, Math.round(width * height / 5200)));
      for (var i = 0; i < count; i++) stars.push({ x: Math.random() * width, y: Math.random() * height, z: 0.25 + Math.random() * 0.9, size: Math.random() < 0.12 ? 1.6 : 0.6 + Math.random() * 0.8 });
    }
    function resize() {
      var rect = canvas.getBoundingClientRect();
      width = Math.max(280, rect.width || window.innerWidth);
      height = Math.max(420, rect.height || window.innerHeight);
      dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      var pxW = Math.round(width * dpr), pxH = Math.round(height * dpr);
      if (canvas.width !== pxW || canvas.height !== pxH) { canvas.width = pxW; canvas.height = pxH; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!player.x) {
        player.x = player.tx = width * 0.5;
        player.y = player.ty = height * 0.78;
      } else {
        player.x = clamp(player.x, 28, width - 28); player.y = clamp(player.y, 96, height - 42);
        player.tx = clamp(player.tx, 28, width - 28); player.ty = clamp(player.ty, 96, height - 42);
      }
      buildStars();
    }
    function pointerTarget(event) {
      var r = canvas.getBoundingClientRect();
      player.tx = clamp(event.clientX - r.left, 26, r.width - 26);
      player.ty = clamp(event.clientY - r.top, 92, r.height - 38);
    }
    function onPointerDown(event) {
      event.preventDefault(); pointer.active = true; pointer.id = event.pointerId;
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
      pointerTarget(event);
      try { canvas.focus({ preventScroll: true }); } catch (_) { try { canvas.focus(); } catch (_) {} }
      if (intro) intro.classList.add("is-hidden");
    }
    function onPointerMove(event) {
      if (!pointer.active || (pointer.id !== null && event.pointerId !== pointer.id)) return;
      event.preventDefault(); pointerTarget(event);
    }
    function onPointerUp(event) {
      if (pointer.id !== null && event.pointerId !== pointer.id) return;
      event.preventDefault(); pointer.active = false; pointer.id = null;
    }
    function onKeyDown(event) {
      var key = String(event.key || "").toLowerCase();
      if (["arrowleft","arrowright","arrowup","arrowdown","a","d","w","s"," "].indexOf(key) < 0) return;
      event.preventDefault(); keys[key] = true; if (intro) intro.classList.add("is-hidden");
    }
    function onKeyUp(event) {
      var key = String(event.key || "").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(keys, key)) { event.preventDefault(); keys[key] = false; }
    }
    canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
    canvas.addEventListener("pointermove", onPointerMove, { passive: false });
    canvas.addEventListener("pointerup", onPointerUp, { passive: false });
    canvas.addEventListener("pointercancel", onPointerUp, { passive: false });
    canvas.addEventListener("contextmenu", function (event) { event.preventDefault(); });
    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("keyup", onKeyUp);
    window.addEventListener("resize", resize);

    function cacheImage(item) {
      var src = imageUrl(item);
      if (!src) return null;
      if (imageCache[src]) return imageCache[src];
      var img = new Image(); img.decoding = "async"; img.loading = "eager"; img.draggable = false; img.src = src; imageCache[src] = img; return img;
    }
    function spawnParticle(x, y, color, count, speed) {
      for (var i = 0; i < count; i++) {
        var a = Math.random() * Math.PI * 2, s = (0.35 + Math.random() * 0.65) * speed;
        particles.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 320 + Math.random() * 420, maxLife: 760, size: 1 + Math.random() * 3, color: color });
      }
    }
    function spawnBullet(x, y, angle, speed) {
      var v = speed || 660;
      bullets.push({ x: x, y: y, vx: Math.sin(angle || 0) * v, vy: -Math.cos(angle || 0) * v, r: 2.4, dead: false });
      shots++;
    }
    function firePlayer(t) {
      if (t < player.disabledUntil || t < player.fireAt) return;
      var focused = pointer.active || keys[" "];
      var overdrive = t < player.overdriveUntil;
      player.fireAt = t + (overdrive ? 82 : (focused ? 118 : 245));
      if (overdrive) {
        spawnBullet(player.x - 8, player.y - 18, -0.08, 700); spawnBullet(player.x, player.y - 22, 0, 730); spawnBullet(player.x + 8, player.y - 18, 0.08, 700);
      } else {
        spawnBullet(player.x - 5, player.y - 19, 0, 680); spawnBullet(player.x + 5, player.y - 19, 0, 680);
      }
    }
    function spawnEnemy(t) {
      var elapsed = t - started, difficulty = clamp(elapsed / duration, 0, 1), roll = Math.random();
      var type = roll < 0.46 ? "asteroid" : (roll < 0.79 ? "drone" : "mine");
      if (elapsed < 9000 && type === "mine") type = "asteroid";
      var r = type === "asteroid" ? 19 + Math.random() * 18 : (type === "drone" ? 19 : 15);
      var hp = type === "asteroid" ? (2 + Math.floor(Math.random() * 3)) : (type === "drone" ? 3 + (difficulty > 0.65 ? 1 : 0) : 1);
      enemies.push({ type: type, x: 32 + Math.random() * Math.max(40, width - 64), y: -r - 12, r: r, hp: hp, maxHp: hp,
        speed: 96 + Math.random() * 72 + difficulty * 72, vx: type === "mine" ? (-26 + Math.random() * 52) : (-10 + Math.random() * 20),
        phase: Math.random() * Math.PI * 2, shootAt: t + 700 + Math.random() * 1500, dead: false, boss: false,
        points: type === "asteroid" ? 520 : (type === "drone" ? 880 : 610) });
    }
    function spawnCargo() {
      var item = catalog.length ? catalog[Math.floor(Math.random() * catalog.length)] : null;
      cargo.push({ x: 42 + Math.random() * Math.max(40, width - 84), y: -44, r: 26, speed: 92 + Math.random() * 40,
        drift: -22 + Math.random() * 44, item: item, image: item ? cacheImage(item) : null, type: Math.random() < 0.22 ? "overdrive" : "piece", dead: false });
    }
    function spawnBoss(t) {
      bossSpawned = true;
      enemies.push({ type: "boss", x: width * 0.5, y: -90, r: 58, hp: 54, maxHp: 54, speed: 60, vx: 0, phase: 0,
        shootAt: t + 900, dead: false, boss: true, points: 12500, entered: false });
      if (bossMeter) bossMeter.hidden = false;
      phase = 3; phaseEl.textContent = "FINAL // NULL CARRIER"; phaseEl.classList.add("is-danger");
    }
    function enemyShoot(e, t) {
      if (e.dead || t < e.shootAt) return;
      var dx = player.x - e.x, dy = player.y - e.y, mag = Math.max(1, Math.hypot(dx, dy));
      var speed = e.boss ? 245 : 205, count = e.boss ? 5 : 1, center = Math.atan2(dx / mag, dy / mag);
      for (var i = 0; i < count; i++) {
        var spread = e.boss ? (i - 2) * 0.18 : 0;
        enemyBullets.push({ x: e.x, y: e.y + e.r * 0.55, vx: Math.sin(center + spread) * speed, vy: Math.cos(center + spread) * speed, r: e.boss ? 4.6 : 4, dead: false });
      }
      e.shootAt = t + (e.boss ? 780 + Math.random() * 260 : 1450 + Math.random() * 950);
    }
    function comboMultiplier() { return 1 + Math.min(15, combo) * 0.12; }
    function destroyEnemy(e) {
      if (e.dead) return;
      e.dead = true; kills++; combo++; bestCombo = Math.max(bestCombo, combo);
      score += Math.round(e.points * comboMultiplier());
      spawnParticle(e.x, e.y, e.boss ? "#f5e8b7" : "#e9e5d9", e.boss ? 48 : 15, e.boss ? 180 : 120);
      if (e.boss) { bossDefeated = true; score += 6500; if (bossMeter) bossMeter.classList.add("is-defeated"); flashUntil = performance.now() + 260; }
    }
    function damagePlayer(amount, t) {
      if (t < player.invulnerableUntil || t < player.disabledUntil) return;
      var dmg = t < player.shieldUntil ? Math.max(5, Math.round(amount * 0.35)) : amount;
      player.hull = Math.max(0, player.hull - dmg); player.invulnerableUntil = t + 720; combo = 0;
      score = Math.max(0, score - Math.round(dmg * 38)); shakeUntil = t + 230; flashUntil = t + 120;
      spawnParticle(player.x, player.y, "#d77c6e", 18, 145);
      if (player.hull <= 0) {
        player.disabledUntil = t + 1350; player.invulnerableUntil = t + 2100; player.hull = 58; score = Math.max(0, score - 2600);
        player.tx = player.x = width * 0.5; player.ty = player.y = height * 0.78; spawnParticle(player.x, player.y, "#f0e9d5", 42, 210);
      }
    }
    function collectCargo(c, t) {
      if (c.dead) return;
      c.dead = true; cargoCount++; combo++; bestCombo = Math.max(bestCombo, combo);
      if (c.type === "overdrive") { player.overdriveUntil = t + 6200; player.shieldUntil = Math.max(player.shieldUntil, t + 2200); score += 1900; }
      else score += Math.round(1450 * comboMultiplier());
      player.hull = Math.min(100, player.hull + 8); spawnParticle(c.x, c.y, "#f4e5ad", 16, 105);
    }
    function circleHit(ax, ay, ar, bx, by, br) { var dx = ax - bx, dy = ay - by, rr = ar + br; return dx * dx + dy * dy <= rr * rr; }

    function update(dt, t) {
      var elapsed = t - started, remaining = Math.max(0, duration - elapsed), sec = dt / 1000;
      if (elapsed > 14500 && phase === 1) { phase = 2; phaseEl.textContent = "ORBIT 02 // DEBRIS STORM"; }
      if (elapsed > 31500 && !bossSpawned) spawnBoss(t);
      if (keys["arrowleft"] || keys["a"]) player.tx -= 280 * sec;
      if (keys["arrowright"] || keys["d"]) player.tx += 280 * sec;
      if (keys["arrowup"] || keys["w"]) player.ty -= 280 * sec;
      if (keys["arrowdown"] || keys["s"]) player.ty += 280 * sec;
      player.tx = clamp(player.tx, 26, width - 26); player.ty = clamp(player.ty, 92, height - 38);
      var follow = Math.min(1, dt * 0.018); player.x += (player.tx - player.x) * follow; player.y += (player.ty - player.y) * follow;
      if (t >= player.disabledUntil) firePlayer(t);
      var spawnInterval = phase === 1 ? 720 : (phase === 2 ? 510 : 740);
      if (t >= enemySpawnAt && elapsed < duration - 800) { spawnEnemy(t); enemySpawnAt = t + spawnInterval * (0.76 + Math.random() * 0.55); }
      if (t >= cargoSpawnAt && elapsed < duration - 2600) { spawnCargo(); cargoSpawnAt = t + 4300 + Math.random() * 2800; }
      stars.forEach(function (star) { star.y += (22 + star.z * 70) * sec; if (star.y > height + 4) { star.y = -4; star.x = Math.random() * width; } });
      bullets.forEach(function (b) { if (b.dead) return; b.x += b.vx * sec; b.y += b.vy * sec; if (b.y < -20 || b.x < -20 || b.x > width + 20) b.dead = true; });
      enemyBullets.forEach(function (b) {
        if (b.dead) return; b.x += b.vx * sec; b.y += b.vy * sec;
        if (b.y > height + 18 || b.x < -18 || b.x > width + 18) b.dead = true;
        else if (t >= player.disabledUntil && circleHit(player.x, player.y, 17, b.x, b.y, b.r + 2)) { b.dead = true; damagePlayer(16, t); }
      });
      enemies.forEach(function (e) {
        if (e.dead) return;
        if (e.boss) {
          if (!e.entered) { e.y += e.speed * sec; if (e.y >= 105) { e.y = 105; e.entered = true; } }
          else { e.phase += sec * 0.9; e.x = width * 0.5 + Math.sin(e.phase) * Math.max(20, width * 0.28); enemyShoot(e, t); }
          if (bossFill) bossFill.style.width = clamp(e.hp / e.maxHp * 100, 0, 100) + "%";
        } else {
          e.y += e.speed * sec; e.x += e.vx * sec;
          if (e.type === "drone") { e.phase += sec * 2.1; e.x += Math.sin(e.phase) * 34 * sec; if (e.y > 70) enemyShoot(e, t); }
          if (e.y > height + e.r + 20) { e.dead = true; combo = 0; }
          else if (t >= player.disabledUntil && circleHit(player.x, player.y, 18, e.x, e.y, e.r * 0.78)) { e.dead = true; damagePlayer(e.type === "asteroid" ? 30 : 24, t); spawnParticle(e.x, e.y, "#d9d4c8", 14, 115); }
        }
      });
      bullets.forEach(function (b) {
        if (b.dead) return;
        for (var i = 0; i < enemies.length; i++) {
          var e = enemies[i]; if (e.dead) continue;
          if (circleHit(b.x, b.y, b.r + 2, e.x, e.y, e.r * (e.boss ? 0.72 : 0.78))) {
            b.dead = true; e.hp -= 1; hits++; spawnParticle(b.x, b.y, "#efe8d6", 3, 65); if (e.hp <= 0) destroyEnemy(e); break;
          }
        }
      });
      cargo.forEach(function (c) {
        if (c.dead) return; c.y += c.speed * sec; c.x += c.drift * sec;
        if (c.y > height + 50) { c.dead = true; combo = 0; }
        else if (t >= player.disabledUntil && circleHit(player.x, player.y, 20, c.x, c.y, c.r)) collectCargo(c, t);
      });
      particles.forEach(function (p) { p.x += p.vx * sec; p.y += p.vy * sec; p.vx *= 0.985; p.vy *= 0.985; p.life -= dt; });
      bullets = bullets.filter(function (b) { return !b.dead; }); enemyBullets = enemyBullets.filter(function (b) { return !b.dead; });
      enemies = enemies.filter(function (e) { return !e.dead; }); cargo = cargo.filter(function (c) { return !c.dead; }); particles = particles.filter(function (p) { return p.life > 0; });
      score = Math.min(150000, score + dt * 0.021);
      hudScore.textContent = formatScore(score); hudHull.textContent = Math.round(player.hull) + "%"; hudCombo.textContent = "×" + comboMultiplier().toFixed(1); hudTime.textContent = String(Math.ceil(remaining / 1000));
      state.stage.dataset.score = String(Math.round(score)); state.stage.dataset.shots = String(shots); state.stage.dataset.kills = String(kills);
      if (elapsed >= duration) { score = Math.min(150000, score + Math.round(player.hull * 42 + Math.min(15, bestCombo) * 310 + (bossDefeated ? 5200 : 0))); endGame(t); }
    }

    function endGame(t) {
      if (ended) return;
      ended = true; state.stage.dataset.running = "0"; cancelAnimationFrame(raf);
      var accuracy = shots ? Math.min(100, Math.round(hits / shots * 100)) : 0;
      var elapsed = Math.round(Math.max(0, t - started)); cleanupControls();
      finishGame(name, Math.round(score), { kills: kills, cargo: cargoCount, accuracy: accuracy, hull: Math.round(player.hull), bestCombo: bestCombo, bossDefeated: bossDefeated, shots: shots }, elapsed);
    }

    function drawBackground(t) {
      var grad = ctx.createRadialGradient(width * 0.5, height * 0.28, 0, width * 0.5, height * 0.4, Math.max(width, height) * 0.82);
      grad.addColorStop(0, "#11110f"); grad.addColorStop(0.5, "#050505"); grad.addColorStop(1, "#010101");
      ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);
      ctx.save(); stars.forEach(function (s) { ctx.globalAlpha = 0.22 + s.z * 0.58; ctx.fillStyle = "#f1eee5"; ctx.fillRect(s.x, s.y, s.size, s.size * (1 + s.z * 1.7)); }); ctx.restore();
      ctx.save(); ctx.globalAlpha = 0.06; ctx.strokeStyle = "#e8e0c9"; ctx.lineWidth = 1;
      for (var r = 1; r <= 7; r++) { ctx.beginPath(); ctx.ellipse(width * 0.5, height * 0.34, width * 0.1 * r, height * 0.05 * r, 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
      if (t < flashUntil) { ctx.fillStyle = "rgba(255,235,210,.10)"; ctx.fillRect(0, 0, width, height); }
    }
    function drawShip(t) {
      if (t < player.disabledUntil) return;
      ctx.save(); ctx.translate(player.x, player.y); ctx.globalAlpha = t < player.invulnerableUntil && Math.floor(t / 90) % 2 === 0 ? 0.35 : 1;
      if (t < player.shieldUntil) { ctx.strokeStyle = "rgba(244,226,168,.6)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, 28, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = "rgba(240,237,229,.16)"; ctx.strokeStyle = "#f0ede5"; ctx.lineWidth = 1.4; ctx.beginPath();
      ctx.moveTo(0, -24); ctx.lineTo(15, 16); ctx.lineTo(5, 11); ctx.lineTo(0, 18); ctx.lineTo(-5, 11); ctx.lineTo(-15, 16); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#f3df9e"; ctx.beginPath(); ctx.moveTo(-6, 18); ctx.lineTo(0, 31 + Math.random() * 6); ctx.lineTo(6, 18); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#f0ede5"; ctx.font = "700 7px Helvetica Neue,Arial,sans-serif"; ctx.textAlign = "center"; ctx.fillText("119", 0, 7); ctx.restore();
    }
    function drawAsteroid(e, t) {
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate((t * 0.00045 + e.phase) % (Math.PI * 2)); ctx.strokeStyle = "#8c8981"; ctx.fillStyle = "#181816"; ctx.lineWidth = 1.1; ctx.beginPath();
      for (var i = 0; i < 8; i++) { var a = i / 8 * Math.PI * 2, rr = e.r * (0.76 + ((i * 37) % 5) * 0.055), x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(-e.r * 0.22, -e.r * 0.08, e.r * 0.22, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    function drawDrone(e) {
      ctx.save(); ctx.translate(e.x, e.y); ctx.strokeStyle = "#ddd8ca"; ctx.fillStyle = "rgba(221,216,202,.06)"; ctx.lineWidth = 1.2; ctx.beginPath();
      ctx.moveTo(0, -e.r); ctx.lineTo(e.r, 0); ctx.lineTo(0, e.r * 0.72); ctx.lineTo(-e.r, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-e.r * 1.25, 0); ctx.lineTo(e.r * 1.25, 0); ctx.stroke(); ctx.fillStyle = "#d77c6e"; ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    function drawMine(e, t) {
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(t * 0.0015); ctx.strokeStyle = "#c5beb0"; ctx.lineWidth = 1;
      for (var i = 0; i < 6; i++) { ctx.rotate(Math.PI / 3); ctx.beginPath(); ctx.moveTo(0, -e.r * 0.6); ctx.lineTo(0, -e.r * 1.45); ctx.stroke(); }
      ctx.fillStyle = "#171715"; ctx.beginPath(); ctx.arc(0, 0, e.r * 0.75, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#d77c6e"; ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    function drawBoss(e) {
      ctx.save(); ctx.translate(e.x, e.y); ctx.strokeStyle = "#ece5d5"; ctx.fillStyle = "rgba(236,229,213,.055)"; ctx.lineWidth = 1.4; ctx.beginPath();
      ctx.moveTo(-e.r, -14); ctx.lineTo(-e.r * 0.58, -e.r * 0.65); ctx.lineTo(e.r * 0.58, -e.r * 0.65); ctx.lineTo(e.r, -14); ctx.lineTo(e.r * 0.72, e.r * 0.52); ctx.lineTo(-e.r * 0.72, e.r * 0.52); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(236,229,213,.28)"; ctx.beginPath(); ctx.moveTo(-e.r * 0.55, 0); ctx.lineTo(e.r * 0.55, 0); ctx.stroke(); ctx.fillStyle = "#d77c6e"; ctx.font = "700 9px Helvetica Neue,Arial,sans-serif"; ctx.textAlign = "center"; ctx.fillText("NULL", 0, 4); ctx.restore();
    }
    function drawCargo(c) {
      ctx.save(); ctx.translate(c.x, c.y); var size = 42; ctx.fillStyle = "#0d0d0c"; ctx.strokeStyle = c.type === "overdrive" ? "#f2d88f" : "#ddd5c1"; ctx.lineWidth = 1.4; ctx.fillRect(-size / 2, -size / 2, size, size); ctx.strokeRect(-size / 2, -size / 2, size, size);
      if (c.image && c.image.complete && c.image.naturalWidth) {
        ctx.save(); ctx.beginPath(); ctx.rect(-17, -17, 34, 34); ctx.clip(); var iw = c.image.naturalWidth, ih = c.image.naturalHeight, scale = Math.max(34 / iw, 34 / ih), dw = iw * scale, dh = ih * scale; ctx.drawImage(c.image, -dw / 2, -dh / 2, dw, dh); ctx.restore(); ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fillRect(-17, -17, 34, 34);
      }
      ctx.fillStyle = c.type === "overdrive" ? "#f2d88f" : "#f0ede5"; ctx.font = "700 7px Helvetica Neue,Arial,sans-serif"; ctx.textAlign = "center"; ctx.fillText(c.type === "overdrive" ? "OVERDRIVE" : "ARCHIVE", 0, 3); ctx.restore();
    }
    function drawProjectiles() {
      ctx.save(); ctx.lineCap = "round";
      bullets.forEach(function (b) { ctx.strokeStyle = "#f2e3ae"; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(b.x, b.y + 7); ctx.lineTo(b.x, b.y - 7); ctx.stroke(); });
      enemyBullets.forEach(function (b) { ctx.fillStyle = "#d77c6e"; ctx.shadowColor = "#d77c6e"; ctx.shadowBlur = 7; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); }); ctx.restore();
    }
    function drawParticles() { ctx.save(); particles.forEach(function (p) { ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); }); ctx.restore(); }
    function draw(t) {
      ctx.save(); if (t < shakeUntil) ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6); drawBackground(t); cargo.forEach(drawCargo);
      enemies.forEach(function (e) { if (e.boss) drawBoss(e); else if (e.type === "asteroid") drawAsteroid(e, t); else if (e.type === "drone") drawDrone(e); else drawMine(e, t); });
      drawProjectiles(); drawParticles(); drawShip(t); ctx.restore();
    }
    function frame(t) {
      if (ended) return; var dt = Math.min(40, Math.max(0, t - last)); last = t; update(dt, t); if (ended) return; draw(t); raf = requestAnimationFrame(frame);
    }
    function cleanupControls() {
      window.removeEventListener("resize", resize); canvas.removeEventListener("pointerdown", onPointerDown); canvas.removeEventListener("pointermove", onPointerMove); canvas.removeEventListener("pointerup", onPointerUp); canvas.removeEventListener("pointercancel", onPointerUp); canvas.removeEventListener("keydown", onKeyDown); canvas.removeEventListener("keyup", onKeyUp);
    }
    state.stopGame = function () { if (ended) return; ended = true; state.stage.dataset.running = "0"; cancelAnimationFrame(raf); cleanupControls(); };
    resize(); enemySpawnAt = started + 650; cargoSpawnAt = started + 4200; setTimeout(function () { if (intro) intro.classList.add("is-hidden"); }, 2400); raf = requestAnimationFrame(frame);
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
    removeEncounter(); if (!universeReady()) return;
    var host = document.getElementById("chaosScreen"); if (!host) return;
    var btn = document.createElement("button"); btn.type = "button"; btn.className = "d119-universe-encounter d119-universe-encounter--raid"; btn.setAttribute("aria-label", "STARSHIP 119 untersuchen");
    btn.innerHTML = '<span class="d119-encounter-ship" aria-hidden="true"><i></i><b>119</b><em></em><small>UNKNOWN</small></span>';
    btn.style.setProperty("--enc-y", (16 + Math.random() * 54).toFixed(1) + "%"); btn.style.setProperty("--enc-dur", (7.0 + Math.random() * 3.6).toFixed(2) + "s");
    btn.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
    btn.addEventListener("click", function (event) { event.preventDefault(); event.stopPropagation(); removeEncounter(); requestStart(); });
    btn.addEventListener("animationend", function (event) { if (event.target !== btn || state.encounter !== btn) return; removeEncounter(); scheduleEncounter(34000 + Math.random() * 62000); });
    host.appendChild(btn); state.encounter = btn;
  }
  function directGame() { var params = new URLSearchParams(location.search); return normalizeGame(params.get("game")); }
  function observeUniverse() {
    var view = document.getElementById("chaosView"); if (!view) return;
    var obs = new MutationObserver(function () { if (universeReady() && !state.encounter && !state.directStarted) scheduleEncounter(7000 + Math.random() * 21000); if (!universeReady()) removeEncounter(); });
    obs.observe(view, { attributes: true, attributeFilter: ["class"] }); if (universeReady()) scheduleEncounter(7000 + Math.random() * 21000);
  }
  function boot() {
    if (!document.getElementById("chaosView")) return;
    buildRoot(); qsa(".d119-warp-control,.universe-shooting-star,.d119-secret-relic,#universeTurbo").forEach(function (el) { el.remove(); }); installSelectionGuard(); observeUniverse();
    var game = directGame(); if (game) { state.directStarted = true; setTimeout(requestStart, 420); }
    window.D119SecretGames = Object.freeze({ start: requestStart, close: closeGames, discover: spawnEncounter, version: GAME_VERSION });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
