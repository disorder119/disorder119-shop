(function () {
  "use strict";

  if (window.__D119_SECRET_GAMES_V2__) return;
  window.__D119_SECRET_GAMES_V2__ = true;

  var ROOT_ID = "d119SecretGames";
  var NAME_KEY = "d119_secret_player";
  var COUPON_KEY = "d119_reward_coupon";
  var LOCAL_BOARD_KEY = "d119_game_board_v2";
  var GAME_IDS = ["warp", "signal", "memory"];
  var GAME_META = {
    warp: {
      title: "STARSHIP 119",
      subtitle: "Flieg durch den Archive Belt",
      target: 4500,
      duration: 36000,
      encounter: "ship",
      copy: "Ein unbekanntes Schiff ist aus dem Universum gefallen. Übernimm kurz das Steuer, sammle Archive-Cargo und weich Asteroiden aus."
    },
    signal: {
      title: "WORMHOLE LOCK",
      subtitle: "Stabilisiere den Riss",
      target: 18000,
      duration: 30000,
      encounter: "rift",
      copy: "Ein Wurmloch flackert zwischen den Objekten. Richte alle drei Orbit-Knoten auf den Lichtstrahl aus, bevor der Riss kollabiert."
    },
    memory: {
      title: "ZERO-G BAG",
      subtitle: "Fang verlorene Archive-Pieces",
      target: 7600,
      duration: 35000,
      encounter: "bag",
      copy: "Eine Disorder119-Bag treibt offen durch Zero-G. Fang die Archive-Pieces und Energiekerne – aber kein Weltraumschrott."
    }
  };

  var state = {
    root: null,
    gate: null,
    stage: null,
    result: null,
    encounter: null,
    encounterTimer: 0,
    activeGame: "",
    pendingGame: "",
    run: null,
    stopGame: null,
    items: null,
    directStarted: false
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
    try { return /^[\p{L}\p{N}._ -]+$/u.test(v); } catch (_) { return /^[A-Za-z0-9._ -]+$/.test(v); }
  }
  function saveName(value) {
    var v = String(value || "").trim().replace(/\s+/g, " ").slice(0, 16);
    if (!validName(v)) return "";
    try { localStorage.setItem(NAME_KEY, v); } catch (_) {}
    return v;
  }
  function normalizeGame(value) {
    var v = String(value || "").toLowerCase();
    if (v === "pilot" || v === "ship") v = "warp";
    if (v === "wormhole" || v === "rift") v = "signal";
    if (v === "bag" || v === "zero-g") v = "memory";
    return GAME_IDS.indexOf(v) >= 0 ? v : "";
  }
  function formatScore(value) {
    return Math.max(0, Math.round(Number(value) || 0)).toLocaleString("de-DE") + " P";
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
      }).slice(0, 500);
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
    return !!(view && !view.classList.contains("hidden") && !view.classList.contains("chaos-view--game") && !state.activeGame && (!state.root || state.root.hidden));
  }
  function stopNativeGame() {
    var native = document.getElementById("chaosGame");
    if (native && !native.hidden) {
      var back = document.getElementById("chaosGameBack");
      if (back) back.click();
    }
  }

  function buildRoot() {
    if (state.root) return state.root;
    var host = document.getElementById("chaosScreen") || document.body;
    var root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "d119-games d119-games-v2";
    root.hidden = true;
    root.innerHTML =
      '<div class="d119-games__veil"></div>' +
      '<section class="d119-game-gate" data-view="gate" hidden>' +
        '<button type="button" class="d119-game-close" data-action="close" aria-label="Schließen">×</button>' +
        '<div class="d119-gate-object" aria-hidden="true"></div>' +
        '<p class="d119-game-kicker">UNIVERSE // ENCOUNTER</p>' +
        '<h2 class="d119-game-heading" data-gate-title></h2>' +
        '<p class="d119-game-copy" data-gate-copy></p>' +
        '<form class="d119-player-gate" data-player-gate>' +
          '<label><span>CALLSIGN</span><input type="text" maxlength="16" autocomplete="nickname" spellcheck="false" placeholder="3–16 Zeichen"></label>' +
          '<button type="submit">EINSTEIGEN</button>' +
        '</form>' +
        '<p class="d119-player-error" aria-live="polite"></p>' +
        '<p class="d119-gate-note">Kein Spiele-Menü. Begegnungen tauchen zufällig im Universum auf.</p>' +
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
      launchGame(state.pendingGame || "warp", name);
    });
    root.addEventListener("click", function (event) {
      var close = event.target.closest && event.target.closest('[data-action="close"]');
      if (close) closeGames();
    });
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
    state.activeGame = "";
    state.pendingGame = "";
    state.run = null;
    if (state.root) {
      state.root.hidden = true;
      state.stage.innerHTML = "";
      state.result.innerHTML = "";
    }
    document.documentElement.classList.remove("d119-game-open");
    document.body.classList.remove("d119-game-open");
    state.directStarted = false;
    scheduleEncounter(18000 + Math.random() * 52000);
  }
  function showGate(game) {
    game = normalizeGame(game) || "warp";
    state.pendingGame = game;
    showRoot();
    setView("gate");
    var meta = GAME_META[game];
    state.gate.className = "d119-game-gate d119-game-gate--" + meta.encounter;
    qs("[data-gate-title]", state.gate).textContent = meta.title;
    qs("[data-gate-copy]", state.gate).textContent = meta.copy;
    var input = qs(".d119-player-gate input", state.gate);
    input.value = loadName();
    setTimeout(function () { try { input.focus(); } catch (_) {} }, 80);
  }

  function localBoards() {
    try {
      var parsed = JSON.parse(localStorage.getItem(LOCAL_BOARD_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) { return {}; }
  }
  function localAdd(game, name, score) {
    var boards = localBoards();
    var list = Array.isArray(boards[game]) ? boards[game] : [];
    list.push({ username: name, score: Math.round(score), createdAt: new Date().toISOString() });
    list.sort(function (a, b) { return b.score - a.score; });
    boards[game] = list.slice(0, 20);
    try { localStorage.setItem(LOCAL_BOARD_KEY, JSON.stringify(boards)); } catch (_) {}
    return boards[game];
  }
  async function createRun(game) {
    try {
      var result = await api("/games/start", { method: "POST", body: JSON.stringify({ game: game }) });
      return { id: result.runId, token: result.runToken || "", startedAt: Number(result.startedAt || now()), server: true };
    } catch (_) {
      return { id: randomId(), token: "", startedAt: now(), server: false };
    }
  }
  async function requestStart(game) {
    game = normalizeGame(game) || "warp";
    removeEncounter();
    var name = loadName();
    if (!validName(name)) {
      showGate(game);
      return;
    }
    launchGame(game, name);
  }
  async function launchGame(game, name) {
    game = normalizeGame(game) || "warp";
    showRoot();
    setView("stage");
    state.stage.innerHTML = '<div class="d119-game-loading"><span></span><p>ENCOUNTER WIRD STABILISIERT</p></div>';
    state.activeGame = game;
    var pair = await Promise.all([createRun(game), loadItems()]);
    if (state.activeGame !== game) return;
    state.run = pair[0];
    if (game === "warp") startWarp(name, pair[1]);
    else if (game === "signal") startSignal(name);
    else startMemory(name, pair[1]);
  }

  async function finishGame(game, name, score, details, durationMs) {
    if (state.stopGame) { try { state.stopGame(); } catch (_) {} }
    state.stopGame = null;
    var run = state.run;
    state.activeGame = "";
    var meta = GAME_META[game];
    var safeScore = Math.max(0, Math.round(score));
    var qualified = safeScore >= meta.target;
    var couponCode = "";
    var board = null;
    var server = false;
    if (run && run.server) {
      try {
        var response = await api("/games/score", {
          method: "POST",
          body: JSON.stringify({
            game: game,
            runId: run.id,
            runToken: run.token,
            username: name,
            score: safeScore,
            durationMs: Math.round(durationMs),
            detail: Object.assign({ version: "universe-encounters-v2" }, details || {})
          })
        });
        qualified = Boolean(response.qualified);
        couponCode = String(response.couponCode || "");
        board = Array.isArray(response.leaderboard) ? response.leaderboard : null;
        server = true;
      } catch (_) {}
    }
    if (!server) {
      board = localAdd(game, name, safeScore);
      if (qualified) couponCode = "D11910-" + game.toUpperCase().slice(0, 3) + "-" + Math.random().toString(36).slice(2, 8).toUpperCase();
    }
    if (couponCode) {
      try { localStorage.setItem(COUPON_KEY, JSON.stringify({ code: couponCode, game: game, issuedAt: now(), server: server })); } catch (_) {}
      document.dispatchEvent(new CustomEvent("d119:coupon-earned", { detail: { code: couponCode, server: server } }));
    }
    renderResult(game, name, safeScore, qualified, couponCode, board || [], server);
  }
  function renderResult(game, name, score, qualified, couponCode, board, server) {
    var meta = GAME_META[game];
    showRoot();
    setView("result");
    var coupon = qualified ?
      '<div class="d119-reward is-earned"><span>10 % UNLOCKED</span><strong>' + escapeHtml(couponCode || "FREIGESCHALTET") + '</strong><small>' + (server ? "Einmaliger Code · serverseitig geprüft" : "Preview · echter Code sobald der Shop-Worker aktiv ist") + '</small></div>' :
      '<div class="d119-reward"><span>10 % LOCKED</span><strong>NOCH ' + formatScore(Math.max(0, meta.target - score)) + '</strong><small>Zielscore: ' + formatScore(meta.target) + '</small></div>';
    state.result.innerHTML =
      '<button type="button" class="d119-game-close" data-action="close" aria-label="Schließen">×</button>' +
      '<p class="d119-game-kicker">' + escapeHtml(meta.title) + ' // ENCOUNTER COMPLETE</p>' +
      '<h2 class="d119-result-score">' + formatScore(score) + '</h2>' +
      '<p class="d119-result-name">CALLSIGN ' + escapeHtml(name) + '</p>' + coupon +
      '<div class="d119-result-board"><div class="d119-board-title">TOP 10 ' + (server ? "GLOBAL" : "LOCAL") + '</div><ol class="d119-board-list">' +
        board.slice(0, 10).map(function (row, i) {
          return '<li><span>' + String(i + 1).padStart(2, "0") + '</span><strong>' + escapeHtml(row.username || "???") + '</strong><em>' + formatScore(row.score) + '</em></li>';
        }).join("") +
      '</ol></div>' +
      '<button type="button" class="d119-return-universe" data-action="close">ZURÜCK INS UNIVERSUM</button>';
  }

  function commonHud(game, name, timeText, scoreText, extra) {
    var meta = GAME_META[game];
    return '<div class="d119-play-hud">' +
      '<span><small>CALLSIGN</small><strong>' + escapeHtml(name) + '</strong></span>' +
      '<span><small>ENCOUNTER</small><strong>' + escapeHtml(meta.title) + '</strong></span>' +
      '<span><small>ZEIT</small><strong data-hud="time">' + timeText + '</strong></span>' +
      '<span><small>SCORE</small><strong data-hud="score">' + scoreText + '</strong></span>' +
      (extra || "") +
      '</div>' +
      '<button type="button" class="d119-game-close d119-game-close--play" data-action="close" aria-label="Spiel beenden">×</button>';
  }

  // 1) STARSHIP 119 — direct drag steering, cargo collection and asteroid avoidance.
  function startWarp(name, items) {
    var game = "warp";
    var meta = GAME_META[game];
    var started = performance.now();
    var last = started;
    var ended = false;
    var score = 0;
    var cargo = 0;
    var collisions = 0;
    var combo = 0;
    var spawnAt = 0;
    var raf = 0;
    var invulnerableUntil = 0;
    var objects = [];
    var catalog = items && items.length ? items : [{ id: "fallback", brand: "D119", title: "ARCHIVE", gallery: [] }];

    state.stage.innerHTML = commonHud(game, name, "36", "0 P", '<span><small>HULL</small><strong data-hud="hull">100%</strong></span>') +
      '<div class="d119-flight-field d119-warp-field" data-flight-field>' +
        '<div class="d119-flight-stars d119-flight-stars--a"></div><div class="d119-flight-stars d119-flight-stars--b"></div>' +
        '<div class="d119-player-ship" data-player-ship><i></i><b>119</b><em></em></div>' +
        '<p class="d119-play-help">Finger ziehen = Schiff steuern · Archive-Cargo einsammeln · Asteroiden ausweichen</p>' +
      '</div>';
    var field = qs("[data-flight-field]", state.stage);
    var ship = qs("[data-player-ship]", state.stage);
    var hudTime = qs('[data-hud="time"]', state.stage);
    var hudScore = qs('[data-hud="score"]', state.stage);
    var hudHull = qs('[data-hud="hull"]', state.stage);
    var w = field.clientWidth || window.innerWidth;
    var h = field.clientHeight || window.innerHeight;
    var player = { x: w * 0.22, y: h * 0.55, tx: w * 0.22, ty: h * 0.55, hull: 100 };

    function resize() {
      w = field.clientWidth || window.innerWidth;
      h = field.clientHeight || window.innerHeight;
      player.tx = clamp(player.tx, 46, w * 0.48);
      player.ty = clamp(player.ty, 86, h - 54);
    }
    function steer(event) {
      event.preventDefault();
      var r = field.getBoundingClientRect();
      player.tx = clamp(event.clientX - r.left, 46, r.width * 0.48);
      player.ty = clamp(event.clientY - r.top, 86, r.height - 54);
    }
    field.addEventListener("pointerdown", steer, { passive: false });
    field.addEventListener("pointermove", steer, { passive: false });
    window.addEventListener("resize", resize);

    function spawn(t) {
      var roll = Math.random();
      var type = roll < 0.58 ? "asteroid" : (roll < 0.9 ? "cargo" : "energy");
      var el = document.createElement("div");
      el.className = "d119-flight-object d119-warp-item is-" + type;
      var size = type === "asteroid" ? 44 + Math.random() * 46 : (type === "cargo" ? 58 + Math.random() * 24 : 42);
      var y = 92 + Math.random() * Math.max(80, h - 164);
      var speed = 190 + Math.random() * 115 + Math.min(75, (t - started) / 450);
      var obj = { el: el, type: type, x: w + size + 20, y: y, size: size, speed: speed, dead: false };
      if (type === "cargo") {
        var item = catalog[Math.floor(Math.random() * catalog.length)];
        var src = imageUrl(item);
        el.innerHTML = src ? '<img src="' + escapeHtml(src) + '" alt="" draggable="false">' : '<span>◇</span>';
      } else if (type === "energy") {
        el.innerHTML = '<span>✦</span>';
      } else {
        el.innerHTML = '<i></i>';
      }
      el.style.width = size + "px";
      el.style.height = size + "px";
      field.appendChild(el);
      objects.push(obj);
    }
    function kill(obj, className) {
      obj.dead = true;
      if (className) obj.el.classList.add(className);
      setTimeout(function () { try { obj.el.remove(); } catch (_) {} }, className ? 220 : 0);
    }
    function hit(obj, t) {
      if (obj.type === "asteroid") {
        if (t < invulnerableUntil) return;
        invulnerableUntil = t + 850;
        collisions++;
        combo = 0;
        player.hull = Math.max(0, player.hull - 24);
        score = Math.max(0, score - 480);
        hudHull.textContent = player.hull + "%";
        ship.classList.add("is-damaged");
        field.classList.add("is-impact");
        setTimeout(function () { ship.classList.remove("is-damaged"); field.classList.remove("is-impact"); }, 180);
        kill(obj, "is-hit");
      } else {
        cargo++;
        combo = Math.min(4, combo + 1);
        score += obj.type === "energy" ? 900 : 620 + combo * 110;
        score = Math.min(49000, score);
        kill(obj, "is-collected");
      }
      hudScore.textContent = formatScore(score);
    }
    function frame(t) {
      if (ended) return;
      var dt = Math.min(45, Math.max(0, t - last));
      last = t;
      var elapsed = t - started;
      var remaining = Math.max(0, meta.duration - elapsed);
      score = Math.min(49000, score + dt * 0.035);
      player.x += (player.tx - player.x) * Math.min(1, dt * 0.013);
      player.y += (player.ty - player.y) * Math.min(1, dt * 0.013);
      ship.style.transform = "translate3d(" + player.x + "px," + player.y + "px,0) translate(-50%,-50%)";
      hudTime.textContent = String(Math.ceil(remaining / 1000));
      hudScore.textContent = formatScore(score);
      if (t >= spawnAt && elapsed < meta.duration - 900) {
        spawn(t);
        spawnAt = t + 420 + Math.random() * 370;
      }
      objects.forEach(function (obj) {
        if (obj.dead) return;
        obj.x -= obj.speed * dt / 1000;
        obj.el.style.transform = "translate3d(" + obj.x + "px," + obj.y + "px,0) translate(-50%,-50%) rotate(" + ((t + obj.y) * 0.025) + "deg)";
        var radius = obj.size * (obj.type === "asteroid" ? 0.34 : 0.3) + 27;
        if (Math.hypot(player.x - obj.x, player.y - obj.y) < radius) hit(obj, t);
        else if (obj.x < -obj.size) kill(obj, "");
      });
      objects = objects.filter(function (o) { return !o.dead || o.el.isConnected; });
      if (elapsed >= meta.duration) {
        ended = true;
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        finishGame(game, name, Math.min(49000, Math.round(score)), { cargo: cargo, collisions: collisions, hull: player.hull }, Math.round(elapsed));
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    state.stopGame = function () {
      ended = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
    resize();
    raf = requestAnimationFrame(frame);
  }

  // 2) WORMHOLE LOCK — drag three orbital nodes onto one beacon ray.
  function startSignal(name) {
    var game = "signal";
    var meta = GAME_META[game];
    var started = performance.now();
    var ended = false;
    var score = 0;
    var rounds = 0;
    var activeRing = -1;
    var raf = 0;
    var roundReset = 0;
    var targetAngle = 0;
    var rings = [
      { angle: 0, locked: false, awarded: false },
      { angle: 0, locked: false, awarded: false },
      { angle: 0, locked: false, awarded: false }
    ];

    state.stage.innerHTML = commonHud(game, name, "30", "0 P", '<span><small>LOCK</small><strong data-hud="lock">0/3</strong></span>') +
      '<div class="d119-wormhole-field" data-wormhole-field>' +
        '<div class="d119-wormhole-space"></div>' +
        '<div class="d119-wormhole-core"><i></i><b></b></div>' +
        '<div class="d119-wormhole-ray" data-wormhole-ray></div>' +
        '<div class="d119-orbit-ring d119-orbit-ring--1" data-ring="0"><span></span></div>' +
        '<div class="d119-orbit-ring d119-orbit-ring--2" data-ring="1"><span></span></div>' +
        '<div class="d119-orbit-ring d119-orbit-ring--3" data-ring="2"><span></span></div>' +
        '<div class="d119-wormhole-burst" data-wormhole-burst></div>' +
        '<p class="d119-play-help">Ring anfassen + drehen · jeden leuchtenden Knoten auf den weißen Lichtstrahl setzen</p>' +
      '</div>';
    var field = qs("[data-wormhole-field]", state.stage);
    var ray = qs("[data-wormhole-ray]", field);
    var ringEls = qsa("[data-ring]", field);
    var burst = qs("[data-wormhole-burst]", field);
    var hudTime = qs('[data-hud="time"]', state.stage);
    var hudScore = qs('[data-hud="score"]', state.stage);
    var hudLock = qs('[data-hud="lock"]', state.stage);

    function norm(a) { a %= 360; return a < 0 ? a + 360 : a; }
    function diff(a, b) { var d = Math.abs(norm(a) - norm(b)); return Math.min(d, 360 - d); }
    function paintRing(i) {
      var el = ringEls[i];
      el.style.transform = "translate(-50%,-50%) rotate(" + rings[i].angle + "deg)";
      el.classList.toggle("is-locked", rings[i].locked);
    }
    function updateLock() {
      var count = rings.filter(function (r) { return r.locked; }).length;
      hudLock.textContent = count + "/3";
      if (count === 3 && !roundReset) {
        rounds++;
        score = Math.min(59000, score + 5500 + rounds * 250);
        hudScore.textContent = formatScore(score);
        field.classList.add("is-open");
        burst.classList.add("is-active");
        roundReset = window.setTimeout(function () {
          roundReset = 0;
          field.classList.remove("is-open");
          burst.classList.remove("is-active");
          newRound();
        }, 620);
      }
    }
    function newRound() {
      targetAngle = 15 + Math.random() * 330;
      ray.style.transform = "translateY(-50%) rotate(" + targetAngle + "deg)";
      rings.forEach(function (r, i) {
        r.angle = norm(targetAngle + 70 + Math.random() * 220 + i * 53);
        r.locked = false;
        r.awarded = false;
        paintRing(i);
      });
      updateLock();
    }
    function chooseRing(event) {
      var r = field.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var distance = Math.hypot(event.clientX - cx, event.clientY - cy);
      var best = -1;
      var bestDelta = Infinity;
      ringEls.forEach(function (el, i) {
        var radius = el.getBoundingClientRect().width / 2;
        var delta = Math.abs(distance - radius);
        if (delta < bestDelta) { best = i; bestDelta = delta; }
      });
      return bestDelta < 42 ? best : -1;
    }
    function pointerAngle(event) {
      var r = field.getBoundingClientRect();
      return norm(Math.atan2(event.clientY - (r.top + r.height / 2), event.clientX - (r.left + r.width / 2)) * 180 / Math.PI);
    }
    function moveRing(event) {
      if (activeRing < 0 || ended) return;
      event.preventDefault();
      var angle = pointerAngle(event);
      var r = rings[activeRing];
      var wasLocked = r.locked;
      if (diff(angle, targetAngle) <= 8) {
        r.angle = targetAngle;
        r.locked = true;
        if (!wasLocked && !r.awarded) {
          r.awarded = true;
          score = Math.min(59000, score + 350);
          hudScore.textContent = formatScore(score);
        }
      } else {
        r.angle = angle;
        r.locked = false;
      }
      paintRing(activeRing);
      updateLock();
    }
    field.addEventListener("pointerdown", function (event) {
      activeRing = chooseRing(event);
      if (activeRing >= 0) {
        try { field.setPointerCapture(event.pointerId); } catch (_) {}
        moveRing(event);
      }
    }, { passive: false });
    field.addEventListener("pointermove", moveRing, { passive: false });
    field.addEventListener("pointerup", function () { activeRing = -1; }, { passive: true });
    field.addEventListener("pointercancel", function () { activeRing = -1; }, { passive: true });

    function tick(t) {
      if (ended) return;
      var elapsed = t - started;
      hudTime.textContent = String(Math.ceil(Math.max(0, meta.duration - elapsed) / 1000));
      if (elapsed >= meta.duration) {
        ended = true;
        if (roundReset) clearTimeout(roundReset);
        finishGame(game, name, Math.min(59000, Math.round(score)), { rounds: rounds }, Math.round(elapsed));
        return;
      }
      raf = requestAnimationFrame(tick);
    }
    state.stopGame = function () {
      ended = true;
      if (roundReset) clearTimeout(roundReset);
      cancelAnimationFrame(raf);
    };
    newRound();
    raf = requestAnimationFrame(tick);
  }

  // 3) ZERO-G BAG — move the shopping bag and catch archive pieces.
  function startMemory(name, items) {
    var game = "memory";
    var meta = GAME_META[game];
    var started = performance.now();
    var last = started;
    var ended = false;
    var score = 0;
    var pieces = 0;
    var debrisHits = 0;
    var combo = 0;
    var spawnAt = 0;
    var raf = 0;
    var drops = [];
    var catalog = items && items.length ? items : [{ id: "fallback", brand: "D119", title: "ARCHIVE", gallery: [] }];

    state.stage.innerHTML = commonHud(game, name, "35", "0 P", '<span><small>STREAK</small><strong data-hud="streak">×1</strong></span>') +
      '<div class="d119-bag-field" data-bag-field>' +
        '<div class="d119-bag-stars"></div>' +
        '<div class="d119-catch-bag" data-catch-bag><i></i><b>119</b><em></em></div>' +
        '<p class="d119-play-help">Finger links/rechts bewegen · Pieces + Sterne fangen · roten Schrott meiden</p>' +
      '</div>';
    var field = qs("[data-bag-field]", state.stage);
    var bag = qs("[data-catch-bag]", field);
    var hudTime = qs('[data-hud="time"]', state.stage);
    var hudScore = qs('[data-hud="score"]', state.stage);
    var hudStreak = qs('[data-hud="streak"]', state.stage);
    var w = field.clientWidth || window.innerWidth;
    var h = field.clientHeight || window.innerHeight;
    var bagX = w * 0.5;
    var targetX = bagX;
    var bagY = h - 76;

    function resize() {
      w = field.clientWidth || window.innerWidth;
      h = field.clientHeight || window.innerHeight;
      bagY = h - 76;
      targetX = clamp(targetX, 62, w - 62);
    }
    function steer(event) {
      event.preventDefault();
      var r = field.getBoundingClientRect();
      targetX = clamp(event.clientX - r.left, 62, r.width - 62);
    }
    field.addEventListener("pointerdown", steer, { passive: false });
    field.addEventListener("pointermove", steer, { passive: false });
    window.addEventListener("resize", resize);

    function spawn(t) {
      var roll = Math.random();
      var type = roll < 0.62 ? "piece" : (roll < 0.82 ? "star" : "debris");
      var el = document.createElement("div");
      el.className = "d119-bag-drop is-" + type;
      var size = type === "piece" ? 54 + Math.random() * 28 : (type === "star" ? 34 : 42 + Math.random() * 22);
      var obj = {
        el: el,
        type: type,
        x: 40 + Math.random() * Math.max(40, w - 80),
        y: -size,
        size: size,
        speed: 118 + Math.random() * 105 + Math.min(50, (t - started) / 700),
        drift: -26 + Math.random() * 52,
        dead: false
      };
      if (type === "piece") {
        var item = catalog[Math.floor(Math.random() * catalog.length)];
        var src = imageUrl(item);
        el.innerHTML = src ? '<img src="' + escapeHtml(src) + '" alt="" draggable="false">' : '<span>◇</span>';
      } else if (type === "star") {
        el.innerHTML = '<span>✦</span>';
      } else {
        el.innerHTML = '<i></i><b>VOID</b>';
      }
      el.style.width = size + "px";
      el.style.height = size + "px";
      field.appendChild(el);
      drops.push(obj);
    }
    function removeDrop(obj, cls) {
      obj.dead = true;
      if (cls) obj.el.classList.add(cls);
      setTimeout(function () { try { obj.el.remove(); } catch (_) {} }, cls ? 180 : 0);
    }
    function catchDrop(obj) {
      if (obj.type === "debris") {
        debrisHits++;
        combo = 0;
        score = Math.max(0, score - 650);
        field.classList.add("is-impact");
        setTimeout(function () { field.classList.remove("is-impact"); }, 160);
        removeDrop(obj, "is-bad-catch");
      } else {
        combo = Math.min(6, combo + 1);
        if (obj.type === "piece") {
          pieces++;
          score += 690 + combo * 85;
        } else {
          score += 420 + combo * 45;
        }
        score = Math.min(10000, score);
        removeDrop(obj, "is-good-catch");
      }
      hudScore.textContent = formatScore(score);
      hudStreak.textContent = "×" + Math.max(1, combo);
    }
    function frame(t) {
      if (ended) return;
      var dt = Math.min(45, Math.max(0, t - last));
      last = t;
      var elapsed = t - started;
      bagX += (targetX - bagX) * Math.min(1, dt * 0.018);
      bag.style.transform = "translate3d(" + bagX + "px," + bagY + "px,0) translate(-50%,-50%)";
      hudTime.textContent = String(Math.ceil(Math.max(0, meta.duration - elapsed) / 1000));
      if (t >= spawnAt && elapsed < meta.duration - 650) {
        spawn(t);
        spawnAt = t + 380 + Math.random() * 360;
      }
      drops.forEach(function (obj) {
        if (obj.dead) return;
        obj.y += obj.speed * dt / 1000;
        obj.x += obj.drift * dt / 1000;
        obj.el.style.transform = "translate3d(" + obj.x + "px," + obj.y + "px,0) translate(-50%,-50%) rotate(" + ((t + obj.x) * 0.03) + "deg)";
        if (obj.y > bagY - 46 && obj.y < bagY + 30 && Math.abs(obj.x - bagX) < 66) catchDrop(obj);
        else if (obj.y > h + obj.size) {
          if (obj.type === "piece") combo = 0;
          removeDrop(obj, "");
        }
      });
      drops = drops.filter(function (o) { return !o.dead || o.el.isConnected; });
      if (elapsed >= meta.duration) {
        ended = true;
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        finishGame(game, name, Math.min(10000, Math.round(score)), { pieces: pieces, debrisHits: debrisHits }, Math.round(elapsed));
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    state.stopGame = function () {
      ended = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
    resize();
    raf = requestAnimationFrame(frame);
  }

  function removeEncounter() {
    if (state.encounter) {
      try { state.encounter.remove(); } catch (_) {}
      state.encounter = null;
    }
  }
  function scheduleEncounter(delay) {
    clearTimeout(state.encounterTimer);
    state.encounterTimer = setTimeout(function waitForUniverse() {
      if (!universeReady()) {
        state.encounterTimer = setTimeout(waitForUniverse, 1800 + Math.random() * 2200);
        return;
      }
      spawnEncounter();
    }, Math.max(1200, delay || 8000));
  }
  function encounterMarkup(game) {
    if (game === "warp") {
      return '<span class="d119-encounter-ship" aria-hidden="true"><i></i><b>119</b><em></em></span>';
    }
    if (game === "signal") {
      return '<span class="d119-encounter-rift" aria-hidden="true"><i></i><i></i><i></i><b></b></span>';
    }
    return '<span class="d119-encounter-bag" aria-hidden="true"><i></i><b>119</b><em></em></span>';
  }
  function spawnEncounter() {
    removeEncounter();
    if (!universeReady()) return;
    var host = document.getElementById("chaosScreen");
    if (!host) return;
    var game = GAME_IDS[Math.floor(Math.random() * GAME_IDS.length)];
    var type = GAME_META[game].encounter;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "d119-universe-encounter d119-universe-encounter--" + type;
    btn.setAttribute("aria-label", "Unbekanntes Objekt untersuchen");
    btn.setAttribute("data-game", game);
    btn.innerHTML = encounterMarkup(game);
    btn.style.setProperty("--enc-y", (14 + Math.random() * 58).toFixed(1) + "%");
    btn.style.setProperty("--enc-x", (16 + Math.random() * 68).toFixed(1) + "%");
    btn.style.setProperty("--enc-dur", (type === "rift" ? 7.2 + Math.random() * 2.8 : 6.2 + Math.random() * 4.2).toFixed(2) + "s");
    btn.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
    btn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      removeEncounter();
      requestStart(game);
    });
    btn.addEventListener("animationend", function (event) {
      if (event.target !== btn || state.encounter !== btn) return;
      removeEncounter();
      scheduleEncounter(28000 + Math.random() * 72000);
    });
    host.appendChild(btn);
    state.encounter = btn;
  }

  function directGame() {
    var params = new URLSearchParams(location.search);
    var value = String(params.get("game") || "").toLowerCase();
    if (value === "1") value = "warp";
    if (value === "2") value = "signal";
    if (value === "3") value = "memory";
    return normalizeGame(value);
  }
  function observeUniverse() {
    var view = document.getElementById("chaosView");
    if (!view) return;
    var obs = new MutationObserver(function () {
      if (universeReady() && !state.encounter && !state.directStarted) scheduleEncounter(6500 + Math.random() * 24000);
      if (!universeReady()) removeEncounter();
    });
    obs.observe(view, { attributes: true, attributeFilter: ["class"] });
    if (universeReady()) scheduleEncounter(6500 + Math.random() * 24000);
  }
  function boot() {
    if (!document.getElementById("chaosView")) return;
    buildRoot();
    qsa(".d119-warp-control,.universe-shooting-star,.d119-secret-relic").forEach(function (el) { el.remove(); });
    observeUniverse();
    var game = directGame();
    if (game) {
      state.directStarted = true;
      setTimeout(function () { requestStart(game); }, 500);
    }
    window.D119SecretGames = Object.freeze({
      start: requestStart,
      close: closeGames,
      discover: spawnEncounter
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
