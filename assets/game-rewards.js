/* Disorder119 Warp-Jagd leaderboard + reward coupon client.
   Loaded after the main shop runtime so it can enhance the existing game without
   duplicating or replacing the protected Chaos/Universe game implementation. */
(function () {
  "use strict";

  var REWARD_SCORE = 20000;
  var USERNAME_KEY = "d119_warp_username";
  var COUPON_KEY = "d119_coupon_code";
  var LOCAL_BOARD_KEY = "d119_warp_local_board_v1";
  var workerBase = String((window.SHOP_CONFIG && window.SHOP_CONFIG.shopWorkerUrl) || "").replace(/\/+$/, "");
  var nativeFetch = window.fetch.bind(window);
  var currentSessionId = "";
  var currentSessionPromise = null;
  var resultSubmittedForScore = null;
  var langMatch = /^\/(en|fr)(?:\/|$)/.exec(location.pathname);
  var lang = langMatch ? langMatch[1] : "de";
  var isChaosPage = /\/(?:en\/|fr\/)?chaos\/?$/.test(location.pathname);

  var TEXT = {
    de: {
      leaderboard: "Rangliste",
      leaderboardTitle: "Warp-Jagd — Top 10",
      close: "Schließen",
      rewardGoal: "20.000 € Warenwert knacken → 10 % Gutschein",
      username: "Username",
      usernamePh: "Dein Name in der Rangliste",
      saveScore: "Score speichern",
      saving: "Wird gespeichert …",
      saved: "Score gespeichert.",
      rank: "Dein Rang: #{rank}",
      rewardWon: "Geschafft. Dein einmaliger 10%-Code:",
      copy: "Code kopieren",
      copied: "Kopiert",
      noReward: "Noch {missing} € bis zum Gutschein.",
      backendOffline: "Online-Rangliste und echter Gutschein werden aktiv, sobald der Shop-Backend-Worker verbunden ist. Dein Score wird auf diesem Gerät gespeichert.",
      boardEmpty: "Noch keine Scores.",
      localBoard: "Lokale Rangliste auf diesem Gerät",
      directPlay: "Warp-Jagd starten",
      couponLabel: "Gutscheincode",
      couponPh: "Code eingeben",
      couponApply: "Anwenden",
      couponValid: "10 % Gutschein aktiv.",
      couponInvalid: "Code ist ungültig, bereits benutzt oder reserviert.",
      couponSaved: "Code gespeichert. Er wird beim Checkout serverseitig geprüft.",
      couponError: "Code konnte gerade nicht geprüft werden.",
      submitError: "Score konnte gerade nicht online gespeichert werden. Lokal wurde er gesichert.",
      usernameError: "Bitte gib einen Username mit mindestens 2 Zeichen ein."
    },
    en: {
      leaderboard: "Leaderboard",
      leaderboardTitle: "Warp Hunt — Top 10",
      close: "Close",
      rewardGoal: "Reach €20,000 value → 10% voucher",
      username: "Username",
      usernamePh: "Your leaderboard name",
      saveScore: "Save score",
      saving: "Saving …",
      saved: "Score saved.",
      rank: "Your rank: #{rank}",
      rewardWon: "You made it. Your one-use 10% code:",
      copy: "Copy code",
      copied: "Copied",
      noReward: "€{missing} more for the voucher.",
      backendOffline: "The online leaderboard and real voucher activate once the shop backend worker is connected. Your score is saved on this device.",
      boardEmpty: "No scores yet.",
      localBoard: "Local leaderboard on this device",
      directPlay: "Start Warp Hunt",
      couponLabel: "Voucher code",
      couponPh: "Enter code",
      couponApply: "Apply",
      couponValid: "10% voucher active.",
      couponInvalid: "Code is invalid, already used or reserved.",
      couponSaved: "Code saved. It will be checked server-side at checkout.",
      couponError: "Code cannot be checked right now.",
      submitError: "The score could not be saved online. It was saved locally.",
      usernameError: "Enter a username with at least 2 characters."
    },
    fr: {
      leaderboard: "Classement",
      leaderboardTitle: "Chasse Warp — Top 10",
      close: "Fermer",
      rewardGoal: "Atteignez 20 000 € → bon de réduction de 10 %",
      username: "Pseudo",
      usernamePh: "Votre nom dans le classement",
      saveScore: "Enregistrer le score",
      saving: "Enregistrement …",
      saved: "Score enregistré.",
      rank: "Votre rang : #{rank}",
      rewardWon: "Objectif atteint. Votre code unique de 10 % :",
      copy: "Copier le code",
      copied: "Copié",
      noReward: "Encore {missing} € pour obtenir le bon.",
      backendOffline: "Le classement en ligne et le vrai bon s’activent dès que le backend du shop est connecté. Votre score est enregistré sur cet appareil.",
      boardEmpty: "Aucun score pour le moment.",
      localBoard: "Classement local sur cet appareil",
      directPlay: "Lancer la Chasse Warp",
      couponLabel: "Code promo",
      couponPh: "Saisir le code",
      couponApply: "Appliquer",
      couponValid: "Bon de 10 % actif.",
      couponInvalid: "Code invalide, déjà utilisé ou réservé.",
      couponSaved: "Code enregistré. Il sera vérifié côté serveur au paiement.",
      couponError: "Le code ne peut pas être vérifié pour le moment.",
      submitError: "Le score n’a pas pu être enregistré en ligne. Il a été sauvegardé localement.",
      usernameError: "Saisissez un pseudo d’au moins 2 caractères."
    }
  };

  function t(key) { return (TEXT[lang] || TEXT.de)[key] || TEXT.de[key] || key; }
  function fmt(template, vars) {
    var out = String(template || "");
    Object.keys(vars || {}).forEach(function (key) {
      out = out.split("{" + key + "}").join(String(vars[key]));
    });
    return out;
  }
  function money(value) {
    var locale = lang === "en" ? "en-GB" : lang === "fr" ? "fr-FR" : "de-DE";
    return Math.round(Number(value) || 0).toLocaleString(locale) + " €";
  }
  function normalizeUsername(value) {
    return String(value || "").trim().replace(/\s+/g, " ").replace(/[^0-9A-Za-zÀ-ÖØ-öø-ÿ._ -]/g, "").slice(0, 18).trim();
  }
  function storedCoupon() {
    try { return String(localStorage.getItem(COUPON_KEY) || "").trim(); } catch (e) { return ""; }
  }
  function setStoredCoupon(code) {
    try {
      if (code) localStorage.setItem(COUPON_KEY, String(code).trim().toUpperCase());
      else localStorage.removeItem(COUPON_KEY);
    } catch (e) {}
  }
  function api(path, options) {
    if (!workerBase) return Promise.reject(new Error("backend_not_configured"));
    return nativeFetch(workerBase + path, options || {}).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) {
          var err = new Error(body.error || ("HTTP_" + response.status));
          err.status = response.status;
          err.body = body;
          throw err;
        }
        return body;
      });
    });
  }

  function injectStyles() {
    if (document.getElementById("d119WarpRewardsStyles")) return;
    var style = document.createElement("style");
    style.id = "d119WarpRewardsStyles";
    style.textContent = [
      ".d119-warp-submit{border-top:1px solid rgba(242,239,231,.22);margin-top:16px;padding-top:16px;text-align:left}",
      ".d119-warp-goal{margin:0 0 12px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;opacity:.78}",
      ".d119-warp-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}",
      ".d119-warp-form input,.d119-coupon input{min-width:0;min-height:44px;border:1px solid rgba(242,239,231,.35);background:#080808;color:#f2efe7;padding:10px 12px;font:inherit;font-size:12px;border-radius:0}",
      ".d119-warp-form button,.d119-coupon button,.d119-warp-copy,.d119-warp-board__close{min-height:44px;border:1px solid rgba(242,239,231,.55);background:transparent;color:#f2efe7;padding:9px 12px;font:inherit;font-size:11px;cursor:pointer;border-radius:0}",
      ".d119-warp-status{min-height:18px;margin:9px 0 0;font-size:11px;line-height:1.45;opacity:.78}",
      ".d119-warp-reward{margin-top:12px;padding:12px;border:1px solid rgba(242,239,231,.45);background:rgba(242,239,231,.05)}",
      ".d119-warp-reward strong{display:block;margin:7px 0 9px;font-size:17px;letter-spacing:.08em;word-break:break-all}",
      ".d119-warp-mini-board{margin-top:14px;border-top:1px solid rgba(242,239,231,.16);padding-top:10px}",
      ".d119-warp-mini-board h3{font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 7px}",
      ".d119-warp-row{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(242,239,231,.1);font-size:11px}",
      ".d119-warp-row__rank{opacity:.55}.d119-warp-row__score{font-variant-numeric:tabular-nums}",
      ".d119-warp-board{position:fixed;inset:0;z-index:10030;background:rgba(0,0,0,.88);display:grid;place-items:center;padding:20px}",
      ".d119-warp-board[hidden]{display:none}",
      ".d119-warp-board__panel{width:min(520px,100%);max-height:min(720px,88vh);overflow:auto;background:#080808;color:#f2efe7;border:1px solid rgba(242,239,231,.4);padding:20px}",
      ".d119-warp-board__head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:14px}",
      ".d119-warp-board__head h2{font-size:18px;margin:0;text-transform:uppercase;letter-spacing:.04em}",
      ".d119-warp-board__note{font-size:10px;line-height:1.45;opacity:.62;margin:10px 0 0}",
      ".d119-coupon{border-top:1px solid rgba(0,0,0,.16);padding:14px 0 2px;margin-top:12px}",
      ".d119-coupon__label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:7px}",
      ".d119-coupon__row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px}",
      ".d119-coupon__status{min-height:16px;font-size:10px;line-height:1.35;margin:7px 0 0;opacity:.72}",
      ".d119-coupon input{background:transparent;color:inherit;border-color:currentColor;opacity:.92}",
      ".d119-coupon button{color:inherit;border-color:currentColor}",
      "@media(max-width:560px){.d119-warp-form,.d119-coupon__row{grid-template-columns:1fr}.d119-warp-form button,.d119-coupon button{width:100%}.d119-warp-board{padding:12px}.d119-warp-board__panel{padding:16px}}"
    ].join("");
    document.head.appendChild(style);
  }

  function localBoard() {
    try {
      var rows = JSON.parse(localStorage.getItem(LOCAL_BOARD_KEY) || "[]");
      return Array.isArray(rows) ? rows : [];
    } catch (e) { return []; }
  }
  function addLocalScore(username, score) {
    var rows = localBoard();
    rows.push({ username: username, score: Math.round(score), createdAt: new Date().toISOString() });
    rows.sort(function (a, b) { return b.score - a.score || String(a.createdAt).localeCompare(String(b.createdAt)); });
    rows = rows.slice(0, 50);
    try { localStorage.setItem(LOCAL_BOARD_KEY, JSON.stringify(rows)); } catch (e) {}
    var rank = rows.findIndex(function (row) { return row.username === username && row.score === Math.round(score); });
    return { rank: rank < 0 ? null : rank + 1, leaderboard: rows.slice(0, 10) };
  }

  function renderRows(container, rows, local) {
    container.textContent = "";
    if (!rows || !rows.length) {
      var empty = document.createElement("p");
      empty.className = "d119-warp-board__note";
      empty.textContent = t("boardEmpty");
      container.appendChild(empty);
      return;
    }
    rows.slice(0, 10).forEach(function (row, index) {
      var line = document.createElement("div");
      line.className = "d119-warp-row";
      var rank = document.createElement("span");
      rank.className = "d119-warp-row__rank";
      rank.textContent = "#" + (row.rank || (index + 1));
      var user = document.createElement("span");
      user.textContent = String(row.username || "—");
      var score = document.createElement("span");
      score.className = "d119-warp-row__score";
      score.textContent = money(row.score);
      line.appendChild(rank); line.appendChild(user); line.appendChild(score);
      container.appendChild(line);
    });
    if (local) {
      var note = document.createElement("p");
      note.className = "d119-warp-board__note";
      note.textContent = t("localBoard");
      container.appendChild(note);
    }
  }

  function getLeaderboard() {
    if (!workerBase) return Promise.resolve({ leaderboard: localBoard().slice(0, 10), local: true });
    return api("/game/leaderboard?limit=10", { method: "GET", headers: { Accept: "application/json" } })
      .then(function (data) { return { leaderboard: data.leaderboard || [], local: false }; })
      .catch(function () { return { leaderboard: localBoard().slice(0, 10), local: true }; });
  }

  function startSession(force) {
    if (!workerBase) { currentSessionId = ""; return Promise.resolve(null); }
    if (!force && currentSessionPromise) return currentSessionPromise;
    currentSessionId = "";
    currentSessionPromise = api("/game/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    }).then(function (data) {
      currentSessionId = String(data.sessionId || "");
      return currentSessionId;
    }).catch(function () {
      currentSessionId = "";
      return null;
    });
    return currentSessionPromise;
  }

  function parseCurrentScore() {
    var el = document.getElementById("chaosGameScore");
    var raw = el ? String(el.textContent || "") : "";
    var digits = raw.replace(/[^0-9]/g, "");
    return digits ? Number(digits) : 0;
  }

  function ensureBoardModal() {
    var existing = document.getElementById("d119WarpBoard");
    if (existing) return existing;
    var overlay = document.createElement("div");
    overlay.className = "d119-warp-board";
    overlay.id = "d119WarpBoard";
    overlay.hidden = true;
    overlay.innerHTML = '<section class="d119-warp-board__panel" role="dialog" aria-modal="true" aria-labelledby="d119WarpBoardTitle">' +
      '<div class="d119-warp-board__head"><h2 id="d119WarpBoardTitle"></h2><button type="button" class="d119-warp-board__close"></button></div>' +
      '<p class="d119-warp-goal"></p><div class="d119-warp-board__rows"></div><p class="d119-warp-board__note d119-warp-board__backend"></p></section>';
    overlay.querySelector("h2").textContent = t("leaderboardTitle");
    overlay.querySelector(".d119-warp-board__close").textContent = t("close");
    overlay.querySelector(".d119-warp-goal").textContent = t("rewardGoal");
    overlay.querySelector(".d119-warp-board__backend").textContent = workerBase ? "" : t("backendOffline");
    overlay.querySelector(".d119-warp-board__close").addEventListener("click", function () { overlay.hidden = true; });
    overlay.addEventListener("click", function (event) { if (event.target === overlay) overlay.hidden = true; });
    document.body.appendChild(overlay);
    return overlay;
  }

  function openLeaderboard() {
    var overlay = ensureBoardModal();
    overlay.hidden = false;
    getLeaderboard().then(function (data) {
      renderRows(overlay.querySelector(".d119-warp-board__rows"), data.leaderboard, data.local);
    });
  }

  function ensureChaosActions() {
    if (!isChaosPage) return;
    var actions = document.querySelector(".chaos-view__actions");
    if (!actions) return;
    if (!document.getElementById("d119WarpDirect")) {
      var direct = document.createElement("a");
      direct.id = "d119WarpDirect";
      direct.className = "view-enter-btn";
      direct.href = location.pathname + "?play=1";
      direct.textContent = t("directPlay");
      actions.insertBefore(direct, actions.firstChild);
    }
    if (!document.getElementById("d119WarpLeaderboardOpen")) {
      var board = document.createElement("button");
      board.id = "d119WarpLeaderboardOpen";
      board.type = "button";
      board.className = "view-enter-btn";
      board.textContent = t("leaderboard");
      board.addEventListener("click", openLeaderboard);
      actions.insertBefore(board, actions.firstChild);
    }
  }

  function rewardBlock(panel, code) {
    var old = panel.querySelector(".d119-warp-reward");
    if (old) old.remove();
    if (!code) return;
    var box = document.createElement("div");
    box.className = "d119-warp-reward";
    var intro = document.createElement("span");
    intro.textContent = t("rewardWon");
    var strong = document.createElement("strong");
    strong.textContent = code;
    var copy = document.createElement("button");
    copy.type = "button";
    copy.className = "d119-warp-copy";
    copy.textContent = t("copy");
    copy.addEventListener("click", function () {
      var done = function () { copy.textContent = t("copied"); window.setTimeout(function () { copy.textContent = t("copy"); }, 1400); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done).catch(function () {});
    });
    box.appendChild(intro); box.appendChild(strong); box.appendChild(copy);
    panel.insertBefore(box, panel.querySelector(".d119-warp-mini-board"));
  }

  function ensureResultPanel() {
    var result = document.getElementById("chaosGameResult");
    if (!result) return null;
    var existing = result.querySelector(".d119-warp-submit");
    if (existing) return existing;
    var actions = result.querySelector(".chaos-game__actions");
    var panel = document.createElement("div");
    panel.className = "d119-warp-submit";
    panel.innerHTML = '<p class="d119-warp-goal"></p>' +
      '<div class="d119-warp-form"><input type="text" maxlength="18" autocomplete="nickname"><button type="button"></button></div>' +
      '<p class="d119-warp-status" aria-live="polite"></p>' +
      '<div class="d119-warp-mini-board"><h3></h3><div class="d119-warp-mini-board__rows"></div></div>';
    panel.querySelector(".d119-warp-goal").textContent = t("rewardGoal");
    var input = panel.querySelector("input");
    input.setAttribute("aria-label", t("username"));
    input.placeholder = t("usernamePh");
    try { input.value = localStorage.getItem(USERNAME_KEY) || ""; } catch (e) {}
    var submit = panel.querySelector("button");
    submit.textContent = t("saveScore");
    panel.querySelector("h3").textContent = t("leaderboard");
    submit.addEventListener("click", function () { submitCurrentScore(panel); });
    if (actions) result.insertBefore(panel, actions); else result.appendChild(panel);
    return panel;
  }

  function refreshResultBoard(panel) {
    getLeaderboard().then(function (data) {
      renderRows(panel.querySelector(".d119-warp-mini-board__rows"), data.leaderboard, data.local);
    });
  }

  function submitCurrentScore(panel) {
    var input = panel.querySelector("input");
    var button = panel.querySelector(".d119-warp-form button");
    var status = panel.querySelector(".d119-warp-status");
    var username = normalizeUsername(input.value);
    var score = parseCurrentScore();
    if (username.length < 2) { status.textContent = t("usernameError"); input.focus(); return; }
    try { localStorage.setItem(USERNAME_KEY, username); } catch (e) {}
    if (resultSubmittedForScore === score) return;
    button.disabled = true;
    status.textContent = t("saving");

    var local = addLocalScore(username, score);
    if (!workerBase || !currentSessionId) {
      resultSubmittedForScore = score;
      status.textContent = t("backendOffline") + (local.rank ? " " + fmt(t("rank"), { rank: local.rank }) : "");
      button.disabled = false;
      refreshResultBoard(panel);
      return;
    }

    api("/game/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: currentSessionId, username: username, score: score })
    }).then(function (data) {
      resultSubmittedForScore = score;
      status.textContent = t("saved") + " " + fmt(t("rank"), { rank: data.rank || "—" });
      if (data.couponCode) {
        setStoredCoupon(data.couponCode);
        rewardBlock(panel, data.couponCode);
        ensureCouponBoxes();
      } else if (score < REWARD_SCORE) {
        status.textContent += " " + fmt(t("noReward"), { missing: money(REWARD_SCORE - score).replace(" €", "") });
      }
      renderRows(panel.querySelector(".d119-warp-mini-board__rows"), data.leaderboard || [], false);
    }).catch(function () {
      resultSubmittedForScore = score;
      status.textContent = t("submitError");
      refreshResultBoard(panel);
    }).finally(function () { button.disabled = false; });
  }

  function onResultVisible() {
    var panel = ensureResultPanel();
    if (!panel) return;
    resultSubmittedForScore = null;
    var status = panel.querySelector(".d119-warp-status");
    var score = parseCurrentScore();
    if (score < REWARD_SCORE) status.textContent = fmt(t("noReward"), { missing: money(REWARD_SCORE - score).replace(" €", "") });
    else status.textContent = "";
    rewardBlock(panel, null);
    refreshResultBoard(panel);
  }

  function watchGameResult() {
    if (!isChaosPage) return;
    var result = document.getElementById("chaosGameResult");
    if (!result) return;
    var observer = new MutationObserver(function () {
      if (!result.hidden) onResultVisible();
    });
    observer.observe(result, { attributes: true, attributeFilter: ["hidden"] });
    var again = document.getElementById("chaosGameAgain");
    if (again) again.addEventListener("click", function () { resultSubmittedForScore = null; startSession(true); });
  }

  function directStart() {
    if (!isChaosPage || new URLSearchParams(location.search).get("play") !== "1") return;
    var attempts = 0;
    function tryStart() {
      attempts += 1;
      var view = document.getElementById("chaosView");
      var sky = document.getElementById("chaosSky");
      var game = document.getElementById("chaosGame");
      if (view && sky && game && !view.classList.contains("hidden")) {
        ["1", "1", "9"].forEach(function (key) {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: key, bubbles: true }));
        });
        try { sky.focus({ preventScroll: true }); } catch (e) {}
        return;
      }
      if (attempts < 80) window.setTimeout(tryStart, 100);
    }
    tryStart();
  }

  function couponBox(foot) {
    if (!foot || foot.querySelector(".d119-coupon")) return;
    var box = document.createElement("div");
    box.className = "d119-coupon";
    box.innerHTML = '<label class="d119-coupon__label"></label><div class="d119-coupon__row"><input type="text" autocomplete="off" maxlength="40"><button type="button"></button></div><p class="d119-coupon__status" aria-live="polite"></p>';
    box.querySelector("label").textContent = t("couponLabel");
    var input = box.querySelector("input");
    input.placeholder = t("couponPh");
    input.value = storedCoupon();
    var button = box.querySelector("button");
    button.textContent = t("couponApply");
    button.addEventListener("click", function () {
      var code = String(input.value || "").trim().toUpperCase();
      var status = box.querySelector(".d119-coupon__status");
      if (!code) { setStoredCoupon(""); status.textContent = ""; return; }
      setStoredCoupon(code);
      if (!workerBase) { status.textContent = t("couponSaved"); return; }
      button.disabled = true;
      api("/coupon/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code })
      }).then(function (data) {
        status.textContent = data.valid ? (Number(data.percentOff) + " % — " + t("couponValid").replace(/^10 % —?\s*/, "")) : t("couponInvalid");
        if (!data.valid) setStoredCoupon("");
      }).catch(function () { status.textContent = t("couponError"); }).finally(function () { button.disabled = false; });
    });
    foot.insertBefore(box, foot.firstChild);
  }

  function ensureCouponBoxes() {
    var feet = document.querySelectorAll("#cartFoot, [data-d119-checkout-foot]");
    Array.prototype.forEach.call(feet, couponBox);
  }

  function watchCart() {
    ensureCouponBoxes();
    if (!document.body) return;
    var scheduled = false;
    new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () { scheduled = false; ensureCouponBoxes(); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  function installCheckoutCouponBridge() {
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      var options = init ? Object.assign({}, init) : {};
      var isCreate = /\/create-order(?:\?|$)/.test(url) && String(options.method || "GET").toUpperCase() === "POST";
      var isCapture = /\/capture-order(?:\?|$)/.test(url) && String(options.method || "GET").toUpperCase() === "POST";
      if (isCreate) {
        var code = storedCoupon();
        if (code && typeof options.body === "string") {
          try {
            var body = JSON.parse(options.body);
            body.couponCode = code;
            options.body = JSON.stringify(body);
          } catch (e) {}
        }
      }
      var promise = nativeFetch(input, options);
      if (isCapture) {
        promise = promise.then(function (response) {
          if (response.ok) setStoredCoupon("");
          return response;
        });
      }
      return promise;
    };
  }

  injectStyles();
  installCheckoutCouponBridge();
  watchCart();

  if (isChaosPage) {
    ensureChaosActions();
    ensureBoardModal();
    startSession(false);
    watchGameResult();
    directStart();
  }
})();
