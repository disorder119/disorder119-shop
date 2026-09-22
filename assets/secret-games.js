(function () {
  "use strict";

  if (window.__D119_SECRET_GAMES__) return;
  window.__D119_SECRET_GAMES__ = true;

  var ROOT_ID = "d119SecretGames";
  var NAME_KEY = "d119_secret_player";
  var COUPON_KEY = "d119_reward_coupon";
  var LOCAL_BOARD_KEY = "d119_game_board_v1";
  var GAME_IDS = ["warp", "signal", "memory"];
  var GAME_META = {
    warp: { title: "VOID RUN", subtitle: "Durch Archivteile fliegen", target: 4500, unit: "€", glyph: "◇", duration: 32000 },
    signal: { title: "SIGNAL 119", subtitle: "Reaktion gegen das Rauschen", target: 18000, unit: " P", glyph: "✦", duration: 25000 },
    memory: { title: "ARCHIVE MATCH", subtitle: "Paare aus dem Archiv finden", target: 7600, unit: " P", glyph: "▦", duration: 60000 }
  };

  var state = {
    root: null,
    hub: null,
    stage: null,
    result: null,
    relic: null,
    relicTimer: 0,
    activeGame: "",
    run: null,
    stopGame: null,
    items: null,
    directStarted: false
  };

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function now() { return Date.now(); }
  function money(n) { return Math.round(Number(n) || 0).toLocaleString("de-DE") + " €"; }
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "local-" + now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }
  function coarse() {
    try { return window.matchMedia("(pointer: coarse)").matches; } catch (_) { return false; }
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
    var data = null;
    try { data = await response.json(); } catch (_) { data = {}; }
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

  async function loadItems() {
    if (state.items) return state.items;
    try {
      var response = await fetch("/data/items.json", { cache: "no-store" });
      if (!response.ok) throw new Error("catalog");
      var raw = await response.json();
      var list = Array.isArray(raw) ? raw : (Array.isArray(raw.items) ? raw.items : []);
      state.items = list.filter(function (it) {
        return String(it.public_status || "").toUpperCase() === "AVAILABLE" && Number(it.price) > 0 && Array.isArray(it.gallery) && it.gallery[0];
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
    return !!(view && !view.classList.contains("hidden") && !view.classList.contains("chaos-view--game") && !state.activeGame);
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
    root.className = "d119-games";
    root.hidden = true;
    root.innerHTML =
      '<div class="d119-games__veil"></div>' +
      '<section class="d119-game-hub" data-view="hub" hidden>' +
        '<button type="button" class="d119-game-close" data-action="close" aria-label="Schließen">×</button>' +
        '<p class="d119-game-kicker">SECRET // DISORDER119</p>' +
        '<h2 class="d119-game-heading">Drei Signale. Drei Spiele.</h2>' +
        '<p class="d119-game-copy">Setz deinen Namen aufs Board. Knack den schweren Zielscore und schalte 10 % frei.</p>' +
        '<label class="d119-player"><span>USERNAME</span><input type="text" maxlength="16" autocomplete="nickname" spellcheck="false" placeholder="3–16 Zeichen"></label>' +
        '<p class="d119-player-error" aria-live="polite"></p>' +
        '<div class="d119-game-cards"></div>' +
        '<div class="d119-hub-board"><div class="d119-board-title">LEADERBOARD</div><div class="d119-board-tabs"></div><ol class="d119-board-list"></ol></div>' +
      '</section>' +
      '<section class="d119-game-stage" data-view="stage" hidden></section>' +
      '<section class="d119-game-result" data-view="result" hidden></section>';
    host.appendChild(root);
    state.root = root;
    state.hub = qs('[data-view="hub"]', root);
    state.stage = qs('[data-view="stage"]', root);
    state.result = qs('[data-view="result"]', root);

    var input = qs(".d119-player input", root);
    input.value = loadName();
    input.addEventListener("change", function () {
      var stored = saveName(input.value);
      qs(".d119-player-error", root).textContent = stored ? "" : "Bitte 3–16 Zeichen: Buchstaben, Zahlen, Punkt, _ oder -.";
    });
    root.addEventListener("click", function (event) {
      var close = event.target.closest('[data-action="close"]');
      if (close) { closeGames(); return; }
      var play = event.target.closest("[data-play]");
      if (play) { requestStart(play.getAttribute("data-play")); return; }
      var hub = event.target.closest('[data-action="hub"]');
      if (hub) { showHub(); return; }
      var again = event.target.closest('[data-action="again"]');
      if (again) { requestStart(again.getAttribute("data-game")); return; }
      var boardTab = event.target.closest("[data-board-game]");
      if (boardTab) loadLeaderboard(boardTab.getAttribute("data-board-game"));
    });
    renderHubCards();
    return root;
  }

  function renderHubCards() {
    var cards = qs(".d119-game-cards", state.root);
    cards.innerHTML = GAME_IDS.map(function (id, index) {
      var m = GAME_META[id];
      return '<button type="button" class="d119-game-card" data-play="' + id + '">' +
        '<span class="d119-game-card__n">0' + (index + 1) + '</span>' +
        '<span class="d119-game-card__glyph">' + m.glyph + '</span>' +
        '<strong>' + m.title + '</strong><small>' + m.subtitle + '</small>' +
        '<em>ZIEL ' + (id === "warp" ? money(m.target) : m.target.toLocaleString("de-DE") + " P") + '</em>' +
      '</button>';
    }).join("");
    qs(".d119-board-tabs", state.root).innerHTML = GAME_IDS.map(function (id) {
      return '<button type="button" data-board-game="' + id + '">' + GAME_META[id].title + '</button>';
    }).join("");
  }

  function ensurePlayer() {
    var input = qs(".d119-player input", state.root);
    var name = saveName(input ? input.value : loadName());
    if (name) return name;
    showHub();
    if (input) {
      qs(".d119-player-error", state.root).textContent = "Gib zuerst einen Username mit 3–16 Zeichen ein.";
      setTimeout(function () { try { input.focus(); } catch (_) {} }, 40);
    }
    return "";
  }

  function setView(name) {
    [state.hub, state.stage, state.result].forEach(function (view) { if (view) view.hidden = true; });
    var target = name === "hub" ? state.hub : name === "stage" ? state.stage : state.result;
    if (target) target.hidden = false;
  }

  function showRoot() {
    buildRoot();
    stopNativeGame();
    state.root.hidden = false;
    document.documentElement.classList.add("d119-game-open");
    document.body.classList.add("d119-game-open");
  }

  function closeGames() {
    if (state.stopGame) { try { state.stopGame(); } catch (_) {} }
    state.stopGame = null;
    state.activeGame = "";
    state.run = null;
    if (state.root) {
      state.root.hidden = true;
      state.stage.innerHTML = "";
      state.result.innerHTML = "";
    }
    document.documentElement.classList.remove("d119-game-open");
    document.body.classList.remove("d119-game-open");
    scheduleRelic(28000 + Math.random() * 42000);
  }

  function showHub() {
    if (state.stopGame) { try { state.stopGame(); } catch (_) {} }
    state.stopGame = null;
    state.activeGame = "";
    showRoot();
    setView("hub");
    var input = qs(".d119-player input", state.root);
    if (input && !input.value) input.value = loadName();
    loadLeaderboard("warp");
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

  async function loadLeaderboard(game, container) {
    game = GAME_IDS.indexOf(game) >= 0 ? game : "warp";
    var listEl = container || qs(".d119-board-list", state.root);
    if (!listEl) return;
    qsa("[data-board-game]", state.root).forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-board-game") === game); });
    listEl.innerHTML = '<li class="d119-board-loading">Lädt …</li>';
    var rows = [];
    var local = false;
    try {
      var data = await api("/games/leaderboard?game=" + encodeURIComponent(game) + "&limit=10", { method: "GET", headers: {} });
      rows = Array.isArray(data.scores) ? data.scores : [];
    } catch (_) {
      rows = (localBoards()[game] || []).slice(0, 10);
      local = true;
    }
    if (!rows.length) {
      listEl.innerHTML = '<li class="d119-board-empty">Noch kein Score' + (local ? " auf diesem Gerät" : "") + '.</li>';
      return;
    }
    listEl.innerHTML = rows.map(function (row, i) {
      var score = game === "warp" ? money(row.score) : Math.round(row.score).toLocaleString("de-DE") + " P";
      return '<li><span>' + String(i + 1).padStart(2, "0") + '</span><strong>' + escapeHtml(row.username || "???") + '</strong><em>' + score + '</em></li>';
    }).join("") + (local ? '<li class="d119-board-note">Lokales Board · Online-Board sobald der Shop-Worker aktiv ist.</li>' : "");
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
    if (GAME_IDS.indexOf(game) < 0) game = "warp";
    showRoot();
    var name = ensurePlayer();
    if (!name) return;
    setView("stage");
    state.stage.innerHTML = '<div class="d119-game-loading"><span>✦</span><p>SIGNAL WIRD GELADEN</p></div>';
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
    var m = GAME_META[game];
    var qualified = score >= m.target;
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
            score: Math.round(score),
            durationMs: Math.round(durationMs),
            detail: details || {}
          })
        });
        qualified = Boolean(response.qualified);
        couponCode = String(response.couponCode || "");
        board = Array.isArray(response.leaderboard) ? response.leaderboard : null;
        server = true;
      } catch (_) {}
    }
    if (!server) {
      board = localAdd(game, name, score);
      if (qualified) {
        // This local code keeps the reward visible on the current free/static shop.
        // Real checkout validation never trusts it; the Worker replaces it with a one-time server coupon once configured.
        couponCode = "D11910-" + game.toUpperCase().slice(0, 3) + "-" + Math.random().toString(36).slice(2, 8).toUpperCase();
      }
    }
    if (couponCode) {
      try { localStorage.setItem(COUPON_KEY, JSON.stringify({ code: couponCode, game: game, issuedAt: now(), server: server })); } catch (_) {}
      document.dispatchEvent(new CustomEvent("d119:coupon-earned", { detail: { code: couponCode, server: server } }));
    }
    renderResult(game, name, score, qualified, couponCode, board || [], server, details || {});
  }

  function renderResult(game, name, score, qualified, couponCode, board, server, details) {
    var m = GAME_META[game];
    showRoot();
    setView("result");
    var scoreText = game === "warp" ? money(score) : Math.round(score).toLocaleString("de-DE") + " P";
    var targetText = game === "warp" ? money(m.target) : m.target.toLocaleString("de-DE") + " P";
    var coupon = qualified ?
      '<div class="d119-reward is-earned"><span>10 % UNLOCKED</span><strong>' + escapeHtml(couponCode || "FREIGESCHALTET") + '</strong><small>' + (server ? "Einmaliger Code · wird serverseitig geprüft" : "Lokaler Preview-Code · echter Einmal-Code folgt mit aktivem Shop-Worker") + '</small></div>' :
      '<div class="d119-reward"><span>10 % LOCKED</span><strong>NOCH ' + (game === "warp" ? money(Math.max(0, m.target - score)) : Math.max(0, m.target - score).toLocaleString("de-DE") + " P") + '</strong><small>Zielscore: ' + targetText + '</small></div>';
    state.result.innerHTML =
      '<button type="button" class="d119-game-close" data-action="close" aria-label="Schließen">×</button>' +
      '<p class="d119-game-kicker">' + escapeHtml(m.title) + ' // RESULT</p>' +
      '<h2 class="d119-result-score">' + scoreText + '</h2>' +
      '<p class="d119-result-name">' + escapeHtml(name) + '</p>' + coupon +
      '<div class="d119-result-board"><div class="d119-board-title">TOP 10 ' + (server ? "GLOBAL" : "LOCAL") + '</div><ol class="d119-board-list">' + board.slice(0, 10).map(function (row, i) {
        var s = game === "warp" ? money(row.score) : Math.round(row.score).toLocaleString("de-DE") + " P";
        return '<li><span>' + String(i + 1).padStart(2, "0") + '</span><strong>' + escapeHtml(row.username || "???") + '</strong><em>' + s + '</em></li>';
      }).join("") + '</ol></div>' +
      '<div class="d119-result-actions"><button type="button" data-action="again" data-game="' + game + '">NOCHMAL</button><button type="button" data-action="hub">3 GAMES</button><button type="button" data-action="close">ZURÜCK</button></div>';
  }

  function commonHud(game, name, timeText, scoreText) {
    var m = GAME_META[game];
    return '<div class="d119-play-hud"><span><small>' + escapeHtml(name) + '</small><strong>' + m.title + '</strong></span>' +
      '<span><small>ZEIT</small><strong data-hud="time">' + timeText + '</strong></span>' +
      '<span><small>SCORE</small><strong data-hud="score">' + scoreText + '</strong></span></div>' +
      '<button type="button" class="d119-game-close d119-game-close--play" data-action="close" aria-label="Spiel beenden">×</button>';
  }

  function startWarp(name, items) {
    var game = "warp";
    var m = GAME_META[game];
    var started = performance.now();
    var ended = false;
    var score = 0;
    var combo = 1;
    var lastHit = 0;
    var pointer = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.52 };
    var targets = [];
    var spawnAt = 0;
    var raf = 0;
    var catalog = items && items.length ? items : [{ price: 90, brand: "DISORDER119", title: "ARCHIVE", gallery: [] }];

    state.stage.innerHTML = commonHud(game, name, "32", "0 €") +
      '<div class="d119-warp-field" data-warp-field>' +
        '<div class="d119-warp-horizon"></div><div class="d119-warp-cross" data-warp-cross><i></i></div>' +
        '<p class="d119-play-help">Finger auf dem Feld bewegen · Teile mit dem Fadenkreuz schneiden</p>' +
      '</div>';
    var field = qs("[data-warp-field]", state.stage);
    var cross = qs("[data-warp-cross]", state.stage);
    var hudTime = qs('[data-hud="time"]', state.stage);
    var hudScore = qs('[data-hud="score"]', state.stage);

    function setPointer(clientX, clientY) {
      var r = field.getBoundingClientRect();
      pointer.x = clamp(clientX - r.left, 18, r.width - 18);
      pointer.y = clamp(clientY - r.top, 18, r.height - 18);
      cross.style.transform = "translate3d(" + pointer.x + "px," + pointer.y + "px,0)";
    }
    function onPointer(e) { e.preventDefault(); setPointer(e.clientX, e.clientY); }
    field.addEventListener("pointerdown", onPointer, { passive: false });
    field.addEventListener("pointermove", onPointer, { passive: false });

    function spawn(t) {
      var item = catalog[Math.floor(Math.random() * catalog.length)];
      var angle = Math.random() * Math.PI * 2;
      var radial = 0.62 + Math.random() * 0.5;
      var target = document.createElement("div");
      target.className = "d119-warp-item";
      var src = imageUrl(item);
      target.innerHTML = src ? '<img src="' + escapeHtml(src) + '" alt="" draggable="false">' : '<span>◇</span>';
      field.appendChild(target);
      targets.push({ el: target, item: item, born: t, angle: angle, radial: radial, caught: false });
    }

    function frame(t) {
      if (ended) return;
      var elapsed = t - started;
      var remaining = Math.max(0, m.duration - elapsed);
      hudTime.textContent = String(Math.ceil(remaining / 1000));
      if (t >= spawnAt && elapsed < m.duration - 1200) {
        spawn(t); spawnAt = t + (coarse() ? 610 : 540) + Math.random() * 260;
      }
      var rect = field.getBoundingClientRect();
      var hitRadius = coarse() ? 76 : 54;
      targets.forEach(function (obj) {
        if (obj.caught) return;
        var age = t - obj.born;
        var p = clamp(age / 3100, 0, 1.14);
        var eased = p * p;
        var radius = Math.min(rect.width, rect.height) * obj.radial * eased;
        var x = rect.width * 0.5 + Math.cos(obj.angle) * radius;
        var y = rect.height * 0.44 + Math.sin(obj.angle) * radius * 0.82;
        var scale = 0.16 + eased * 1.45;
        obj.el.style.transform = "translate3d(" + x + "px," + y + "px,0) translate(-50%,-50%) scale(" + scale + ")";
        obj.el.style.opacity = String(clamp(0.15 + p * 1.4, 0, 1));
        var visualRadius = 28 + 42 * scale;
        if (p > 0.18 && p < 1.05 && Math.hypot(pointer.x - x, pointer.y - y) <= hitRadius + visualRadius * 0.35) {
          obj.caught = true;
          var n = performance.now();
          combo = n - lastHit < 1800 ? Math.min(5, combo + 1) : 1;
          lastHit = n;
          var value = Math.max(20, Number(obj.item.price) || 50) * combo;
          score += value;
          hudScore.textContent = money(score);
          obj.el.classList.add("is-caught");
          var pop = document.createElement("b");
          pop.className = "d119-warp-pop";
          pop.style.left = x + "px"; pop.style.top = y + "px";
          pop.textContent = "+" + money(value) + (combo > 1 ? " ×" + combo : "");
          field.appendChild(pop);
          setTimeout(function () { pop.remove(); }, 800);
          setTimeout(function () { obj.el.remove(); }, 220);
        } else if (p > 1.08) {
          obj.caught = true;
          obj.el.remove();
        }
      });
      targets = targets.filter(function (o) { return !o.caught || o.el.isConnected; });
      if (elapsed >= m.duration) {
        ended = true;
        cancelAnimationFrame(raf);
        finishGame(game, name, Math.round(score), { worth: Math.round(score) }, Math.round(elapsed));
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    setPointer(field.clientWidth * 0.5, field.getBoundingClientRect().top + field.clientHeight * 0.52);
    state.stopGame = function () { ended = true; cancelAnimationFrame(raf); };
    raf = requestAnimationFrame(frame);
  }

  function startSignal(name) {
    var game = "signal";
    var m = GAME_META[game];
    var started = performance.now();
    var ended = false;
    var score = 0;
    var streak = 0;
    var target = null;
    var targetBorn = 0;
    var targetTimer = 0;
    var clock = 0;

    state.stage.innerHTML = commonHud(game, name, "25", "0 P") +
      '<div class="d119-signal-field"><div class="d119-signal-noise"></div><p class="d119-play-help">✦ echtes Signal tippen · × Störsignal meiden</p></div>';
    var field = qs(".d119-signal-field", state.stage);
    var hudTime = qs('[data-hud="time"]', state.stage);
    var hudScore = qs('[data-hud="score"]', state.stage);

    function removeTarget() { if (target) target.remove(); target = null; }
    function nextTarget() {
      if (ended) return;
      removeTarget();
      var elapsed = performance.now() - started;
      if (elapsed >= m.duration) { end(); return; }
      var decoy = Math.random() < 0.23;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "d119-signal-target" + (decoy ? " is-decoy" : "");
      btn.textContent = decoy ? "×" : "✦";
      btn.style.left = (10 + Math.random() * 80) + "%";
      btn.style.top = (16 + Math.random() * 66) + "%";
      field.appendChild(btn);
      target = btn;
      targetBorn = performance.now();
      btn.addEventListener("click", function (event) {
        event.preventDefault(); event.stopPropagation();
        var reaction = performance.now() - targetBorn;
        if (decoy) {
          score = Math.max(0, score - 800); streak = 0;
          btn.classList.add("is-wrong");
        } else {
          streak = Math.min(12, streak + 1);
          score += Math.max(220, Math.round(1100 - reaction)) + streak * 65;
          btn.classList.add("is-hit");
        }
        hudScore.textContent = Math.round(score).toLocaleString("de-DE") + " P";
        clearTimeout(targetTimer);
        targetTimer = setTimeout(nextTarget, 130 + Math.random() * 180);
      });
      var life = 760 + Math.random() * 330;
      targetTimer = setTimeout(function () {
        if (!decoy) streak = 0;
        nextTarget();
      }, life);
    }
    function tick() {
      if (ended) return;
      var elapsed = performance.now() - started;
      hudTime.textContent = String(Math.ceil(Math.max(0, m.duration - elapsed) / 1000));
      if (elapsed >= m.duration) { end(); return; }
      clock = requestAnimationFrame(tick);
    }
    function end() {
      if (ended) return;
      ended = true;
      clearTimeout(targetTimer); cancelAnimationFrame(clock); removeTarget();
      finishGame(game, name, Math.round(score), { streak: streak }, Math.round(performance.now() - started));
    }
    state.stopGame = function () { ended = true; clearTimeout(targetTimer); cancelAnimationFrame(clock); removeTarget(); };
    nextTarget(); tick();
  }

  function startMemory(name, items) {
    var game = "memory";
    var m = GAME_META[game];
    var started = performance.now();
    var ended = false;
    var moves = 0;
    var matched = 0;
    var lock = false;
    var open = [];
    var timer = 0;
    var clock = 0;
    var source = shuffle(items && items.length ? items : []).slice(0, 6);
    while (source.length < 6) source.push({ id: "fallback-" + source.length, brand: "D119", title: "ARCHIVE " + (source.length + 1), gallery: [] });
    var cards = shuffle(source.concat(source).map(function (item, index) { return { item: item, key: String(item.id || item.title), uid: index + "-" + Math.random() }; }));

    state.stage.innerHTML = commonHud(game, name, "60", "0 P") +
      '<div class="d119-memory-field"><div class="d119-memory-grid"></div><p class="d119-play-help">Zwei Karten öffnen · alle 6 Paare finden</p></div>';
    var grid = qs(".d119-memory-grid", state.stage);
    var hudTime = qs('[data-hud="time"]', state.stage);
    var hudScore = qs('[data-hud="score"]', state.stage);

    function liveScore() {
      var elapsed = performance.now() - started;
      if (matched < 6) return matched * 850;
      return Math.max(0, Math.round(10000 - elapsed * 0.055 - Math.max(0, moves - 6) * 180));
    }
    cards.forEach(function (card) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "d119-memory-card";
      btn.setAttribute("data-key", card.key);
      var src = imageUrl(card.item);
      btn.innerHTML = '<span class="d119-memory-back">119</span><span class="d119-memory-face">' +
        (src ? '<img src="' + escapeHtml(src) + '" alt="" draggable="false">' : '<b>◇</b>') +
        '<small>' + escapeHtml(card.item.brand || "ARCHIVE") + '</small></span>';
      grid.appendChild(btn);
      btn.addEventListener("click", function () {
        if (ended || lock || btn.classList.contains("is-open") || btn.classList.contains("is-match")) return;
        btn.classList.add("is-open");
        open.push(btn);
        if (open.length < 2) return;
        moves++;
        var a = open[0], b = open[1];
        open = [];
        if (a.getAttribute("data-key") === b.getAttribute("data-key")) {
          a.classList.add("is-match"); b.classList.add("is-match");
          matched++;
          hudScore.textContent = liveScore().toLocaleString("de-DE") + " P";
          if (matched === 6) {
            ended = true;
            cancelAnimationFrame(clock); clearTimeout(timer);
            var score = liveScore();
            setTimeout(function () { finishGame(game, name, score, { moves: moves, pairs: matched }, Math.round(performance.now() - started)); }, 420);
          }
        } else {
          lock = true;
          timer = setTimeout(function () {
            a.classList.remove("is-open"); b.classList.remove("is-open"); lock = false;
          }, 650);
        }
      });
    });
    function tick() {
      if (ended) return;
      var elapsed = performance.now() - started;
      hudTime.textContent = String(Math.ceil(Math.max(0, m.duration - elapsed) / 1000));
      if (elapsed >= m.duration) {
        ended = true;
        clearTimeout(timer);
        finishGame(game, name, matched * 850, { moves: moves, pairs: matched }, Math.round(elapsed));
        return;
      }
      clock = requestAnimationFrame(tick);
    }
    state.stopGame = function () { ended = true; cancelAnimationFrame(clock); clearTimeout(timer); };
    tick();
  }

  function removeRelic() {
    if (state.relic) { state.relic.remove(); state.relic = null; }
  }
  function scheduleRelic(delay) {
    clearTimeout(state.relicTimer);
    state.relicTimer = setTimeout(function wait() {
      if (!universeReady()) { state.relicTimer = setTimeout(wait, 1800); return; }
      spawnRelic();
    }, Math.max(1000, delay || 18000));
  }
  function spawnRelic() {
    removeRelic();
    if (!universeReady()) return;
    var host = document.getElementById("chaosScreen");
    if (!host) return;
    var game = GAME_IDS[Math.floor(Math.random() * GAME_IDS.length)];
    var m = GAME_META[game];
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "d119-secret-relic d119-secret-relic--" + game;
    btn.setAttribute("aria-label", "Geheimes Signal");
    btn.setAttribute("title", "?");
    btn.innerHTML = '<span aria-hidden="true">' + m.glyph + '</span>';
    btn.style.setProperty("--relic-y", (14 + Math.random() * 56) + "%");
    btn.style.setProperty("--relic-dur", (4.7 + Math.random() * 2.4).toFixed(2) + "s");
    btn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    btn.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation(); removeRelic(); requestStart(game);
    });
    btn.addEventListener("animationend", function () {
      if (state.relic === btn) {
        removeRelic();
        scheduleRelic(42000 + Math.random() * 62000);
      }
    });
    host.appendChild(btn);
    state.relic = btn;
  }

  function directGame() {
    var params = new URLSearchParams(location.search);
    var value = String(params.get("game") || "").toLowerCase();
    if (value === "1") value = "warp";
    if (value === "2") value = "signal";
    if (value === "3") value = "memory";
    return GAME_IDS.indexOf(value) >= 0 ? value : "";
  }

  function observeUniverse() {
    var view = document.getElementById("chaosView");
    if (!view) return;
    var obs = new MutationObserver(function () {
      if (universeReady() && !state.relic && !state.directStarted) scheduleRelic(18000 + Math.random() * 24000);
      if (!universeReady()) removeRelic();
    });
    obs.observe(view, { attributes: true, attributeFilter: ["class"] });
    if (universeReady()) scheduleRelic(18000 + Math.random() * 24000);
  }

  function boot() {
    if (!document.getElementById("chaosView")) return;
    buildRoot();
    // Old visible Warp controls from earlier iterations must never remain on the live Universe page.
    qsa(".d119-warp-control,.universe-shooting-star").forEach(function (el) { el.remove(); });
    observeUniverse();
    var game = directGame();
    if (game) {
      state.directStarted = true;
      setTimeout(function () { requestStart(game); }, 650);
    }
    window.D119SecretGames = Object.freeze({ open: showHub, start: requestStart, close: closeGames });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();