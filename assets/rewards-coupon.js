(function () {
  "use strict";

  if (window.__D119_REWARDS_COUPON__) return;
  window.__D119_REWARDS_COUPON__ = true;

  var REWARD_SCORE = 19119;
  var USERNAME_KEY = "d119_universe_username_v1";
  var COUPON_KEY = "d119_coupon_v1";
  var LOCAL_SCORES_KEY = "d119_universe_local_scores_v1";
  var currentRunId = "";
  var resultObserver = null;
  var submittedForResult = false;
  var apiAvailable = null;

  function lang() {
    var value = String(document.documentElement.lang || "de").toLowerCase();
    return value.indexOf("fr") === 0 ? "fr" : value.indexOf("en") === 0 ? "en" : "de";
  }

  function text() {
    var all = {
      de: {
        leaderboard: "Leaderboard", username: "Username", save: "Speichern", play: "Direkt spielen",
        target: "19.119 Punkte = 10 % Gutschein", scoreSaved: "Score gespeichert", rank: "Rang",
        coupon: "Gutschein", apply: "Anwenden", couponPlaceholder: "WARP10-…", couponValid: "10 % Gutschein aktiv",
        couponInvalid: "Gutschein ungültig oder abgelaufen", couponOffline: "Online-Prüfung derzeit nicht verfügbar",
        publicBoard: "Warp-Jagd Leaderboard", localBoard: "Scores auf diesem Gerät", noScores: "Noch keine Scores.",
        usernameHelp: "2–16 Zeichen: Buchstaben, Zahlen, _ oder -", rewardWon: "GESCHAFFT — dein 10%-Code:",
        rewardHint: "Knacke 19.119 Punkte. Der Code ist einmalig und 90 Tage gültig.", close: "Schließen",
        apiMissing: "Das globale Leaderboard benötigt die Shop-API. Lokale Scores funktionieren bereits.",
        enterUsername: "Gib einen Username ein, damit dein Score ins Leaderboard kommt.", copied: "Code kopiert"
      },
      en: {
        leaderboard: "Leaderboard", username: "Username", save: "Save", play: "Play now",
        target: "19,119 points = 10% voucher", scoreSaved: "Score saved", rank: "Rank",
        coupon: "Voucher", apply: "Apply", couponPlaceholder: "WARP10-…", couponValid: "10% voucher active",
        couponInvalid: "Voucher invalid or expired", couponOffline: "Online validation is currently unavailable",
        publicBoard: "Warp Hunt leaderboard", localBoard: "Scores on this device", noScores: "No scores yet.",
        usernameHelp: "2–16 characters: letters, numbers, _ or -", rewardWon: "YOU DID IT — your 10% code:",
        rewardHint: "Reach 19,119 points. The code is single-use and valid for 90 days.", close: "Close",
        apiMissing: "The global leaderboard needs the shop API. Local scores already work.",
        enterUsername: "Choose a username to submit your score to the leaderboard.", copied: "Code copied"
      },
      fr: {
        leaderboard: "Classement", username: "Pseudo", save: "Enregistrer", play: "Jouer maintenant",
        target: "19 119 points = bon de 10 %", scoreSaved: "Score enregistré", rank: "Rang",
        coupon: "Code promo", apply: "Appliquer", couponPlaceholder: "WARP10-…", couponValid: "Bon de 10 % actif",
        couponInvalid: "Code invalide ou expiré", couponOffline: "Validation en ligne indisponible",
        publicBoard: "Classement Chasse Warp", localBoard: "Scores sur cet appareil", noScores: "Aucun score.",
        usernameHelp: "2–16 caractères : lettres, chiffres, _ ou -", rewardWon: "RÉUSSI — votre code de 10 % :",
        rewardHint: "Atteignez 19 119 points. Code à usage unique, valable 90 jours.", close: "Fermer",
        apiMissing: "Le classement global nécessite l’API boutique. Les scores locaux fonctionnent déjà.",
        enterUsername: "Choisissez un pseudo pour envoyer votre score au classement.", copied: "Code copié"
      }
    };
    return all[lang()];
  }

  function apiBase() {
    var config = window.SHOP_CONFIG || window.ARTICLE_SHOP_CONFIG || {};
    var value = String(config.shopWorkerUrl || "").trim().replace(/\/+$/, "");
    if (value) return value;
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return location.origin;
    return "";
  }

  function api(path, options) {
    var base = apiBase();
    if (!base) return Promise.reject(new Error("SHOP_API_NOT_CONFIGURED"));
    return fetch(base + path, options || {}).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || "HTTP_" + res.status);
          err.status = res.status;
          throw err;
        }
        apiAvailable = true;
        return data;
      });
    }).catch(function (err) {
      if (err && (err.message === "SHOP_API_NOT_CONFIGURED" || !err.status)) apiAvailable = false;
      throw err;
    });
  }

  function getUsername() {
    try { return localStorage.getItem(USERNAME_KEY) || ""; } catch (e) { return ""; }
  }

  function validUsername(value) {
    return /^[A-Za-z0-9_-]{2,16}$/.test(String(value || "").trim());
  }

  function setUsername(value) {
    value = String(value || "").trim();
    if (!validUsername(value)) return false;
    try { localStorage.setItem(USERNAME_KEY, value); } catch (e) {}
    return true;
  }

  function localScores() {
    try {
      var parsed = JSON.parse(localStorage.getItem(LOCAL_SCORES_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function addLocalScore(username, score) {
    var rows = localScores();
    rows.push({ username: username || "YOU", score: score, createdAt: new Date().toISOString() });
    rows.sort(function (a, b) { return Number(b.score || 0) - Number(a.score || 0); });
    rows = rows.slice(0, 20);
    try { localStorage.setItem(LOCAL_SCORES_KEY, JSON.stringify(rows)); } catch (e) {}
    return rows;
  }

  function formatScore(score) {
    return Math.round(Number(score || 0)).toLocaleString(lang() === "de" ? "de-DE" : lang() === "fr" ? "fr-FR" : "en-US");
  }

  function parseGameScore() {
    var el = document.getElementById("chaosGameScore");
    if (!el) return 0;
    var digits = String(el.textContent || "").replace(/[^0-9]/g, "");
    return digits ? Number(digits) : 0;
  }

  function saveCoupon(coupon) {
    if (!coupon || !coupon.code) return;
    try { localStorage.setItem(COUPON_KEY, JSON.stringify(coupon)); } catch (e) {}
    refreshCouponWidget();
  }

  function storedCoupon() {
    try {
      var parsed = JSON.parse(localStorage.getItem(COUPON_KEY) || "null");
      return parsed && parsed.code ? parsed : null;
    } catch (e) { return null; }
  }

  function beginRun() {
    submittedForResult = false;
    currentRunId = "";
    api("/game/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(function (data) { currentRunId = String(data.runId || ""); })
      .catch(function () {});
  }

  function submitResult(score) {
    var username = getUsername();
    if (!username || !validUsername(username)) {
      addLocalScore("YOU", score);
      showLeaderboard(score, true);
      return;
    }
    addLocalScore(username, score);
    if (!currentRunId) {
      showLeaderboard(score, false);
      return;
    }
    api("/game/submit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: currentRunId, username: username, score: Math.round(score) })
    }).then(function (data) {
      if (data.coupon) saveCoupon(data.coupon);
      showLeaderboard(score, false, data);
    }).catch(function () { showLeaderboard(score, false); });
  }

  function watchGameResult() {
    var result = document.getElementById("chaosGameResult");
    if (!result || resultObserver) return;
    resultObserver = new MutationObserver(function () {
      if (result.hidden || submittedForResult) return;
      submittedForResult = true;
      window.setTimeout(function () { submitResult(parseGameScore()); }, 120);
    });
    resultObserver.observe(result, { attributes: true, attributeFilter: ["hidden"] });
  }

  function hookGameStarts() {
    var again = document.getElementById("chaosGameAgain");
    if (again && !again.dataset.rewardsHook) {
      again.dataset.rewardsHook = "1";
      again.addEventListener("click", beginRun, true);
    }
  }

  function directPlay() {
    var params = new URLSearchParams(location.search);
    if (params.get("play") !== "1") return;
    var attempts = 0;
    function tryStart() {
      attempts += 1;
      var view = document.getElementById("chaosView");
      var start = document.getElementById("chaosGameAgain");
      if (view && start && !view.classList.contains("hidden")) {
        start.click();
        return;
      }
      if (attempts < 80) window.setTimeout(tryStart, 100);
    }
    window.setTimeout(tryStart, 120);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (ch) {
      return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch];
    });
  }

  function boardRows(rows) {
    if (!rows || !rows.length) return '<p class="d119-board__empty">' + escapeHtml(text().noScores) + '</p>';
    return '<ol class="d119-board__list">' + rows.map(function (row, index) {
      return '<li><span class="d119-board__rank">#' + escapeHtml(row.rank || index + 1) + '</span><strong>' + escapeHtml(row.username) + '</strong><span>' + formatScore(row.score) + '</span></li>';
    }).join("") + '</ol>';
  }

  function renderLeaderboardContent(modal, rows, isPublic, resultData) {
    var c = text();
    var body = modal.querySelector(".d119-board__body");
    var username = getUsername();
    var reward = resultData && resultData.coupon;
    body.innerHTML =
      '<p class="d119-board__target">' + escapeHtml(c.target) + '</p>' +
      (reward ? '<div class="d119-board__reward"><span>' + escapeHtml(c.rewardWon) + '</span><button type="button" class="d119-board__code" data-copy-code>' + escapeHtml(reward.code) + '</button></div>' : '<p class="d119-board__hint">' + escapeHtml(c.rewardHint) + '</p>') +
      '<div class="d119-board__profile"><label>' + escapeHtml(c.username) + '<input maxlength="16" autocomplete="nickname" value="' + escapeHtml(username) + '"></label><button type="button" data-save-user>' + escapeHtml(c.save) + '</button><small>' + escapeHtml(c.usernameHelp) + '</small></div>' +
      '<h3>' + escapeHtml(isPublic ? c.publicBoard : c.localBoard) + '</h3>' + boardRows(rows) +
      (!isPublic ? '<p class="d119-board__offline">' + escapeHtml(c.apiMissing) + '</p>' : '');

    var save = body.querySelector("[data-save-user]");
    if (save) save.addEventListener("click", function () {
      var input = body.querySelector("input");
      if (!input || !setUsername(input.value)) {
        if (input) input.setAttribute("aria-invalid", "true");
        return;
      }
      input.removeAttribute("aria-invalid");
      save.textContent = "✓";
    });
    var copy = body.querySelector("[data-copy-code]");
    if (copy) copy.addEventListener("click", function () {
      var code = copy.textContent.trim();
      try { navigator.clipboard.writeText(code); } catch (e) {}
      copy.setAttribute("data-copied", "1");
      copy.title = c.copied;
    });
  }

  function ensureLeaderboardModal() {
    var existing = document.getElementById("d119Leaderboard");
    if (existing) return existing;
    var c = text();
    var modal = document.createElement("div");
    modal.id = "d119Leaderboard";
    modal.className = "d119-board";
    modal.hidden = true;
    modal.innerHTML = '<div class="d119-board__panel" role="dialog" aria-modal="true" aria-labelledby="d119BoardTitle"><button type="button" class="d119-board__close" aria-label="' + escapeHtml(c.close) + '">×</button><h2 id="d119BoardTitle">' + escapeHtml(c.publicBoard) + '</h2><div class="d119-board__body"></div></div>';
    document.body.appendChild(modal);
    modal.querySelector(".d119-board__close").addEventListener("click", function () { modal.hidden = true; });
    modal.addEventListener("click", function (event) { if (event.target === modal) modal.hidden = true; });
    return modal;
  }

  function showLeaderboard(score, needsUsername, resultData) {
    var modal = ensureLeaderboardModal();
    modal.hidden = false;
    api("/game/leaderboard?limit=20", { method: "GET" }).then(function (data) {
      renderLeaderboardContent(modal, data.scores || [], true, resultData);
    }).catch(function () {
      renderLeaderboardContent(modal, localScores().map(function (row, i) { return Object.assign({ rank: i + 1 }, row); }), false, resultData);
    });
    if (needsUsername) modal.setAttribute("data-needs-username", "1");
    else modal.removeAttribute("data-needs-username");
  }

  function installUniverseButtons() {
    var actions = document.querySelector("#chaosView .chaos-view__actions");
    if (!actions || document.getElementById("d119LeaderboardButton")) return;
    var c = text();
    var board = document.createElement("button");
    board.type = "button";
    board.id = "d119LeaderboardButton";
    board.className = "view-enter-btn d119-leaderboard-btn";
    board.textContent = c.leaderboard;
    board.addEventListener("click", function () { showLeaderboard(0, false); });
    actions.insertBefore(board, actions.firstChild);

    var direct = document.createElement("a");
    direct.className = "view-enter-btn d119-direct-play";
    direct.href = location.pathname + "?play=1";
    direct.textContent = c.play;
    actions.insertBefore(direct, board.nextSibling);
  }

  function validateCoupon(code, statusEl) {
    code = String(code || "").trim().toUpperCase();
    if (!code) return;
    statusEl.textContent = "…";
    api("/coupons/validate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code })
    }).then(function (data) {
      saveCoupon({ code: data.code, percentOff: data.percentOff, expiresAt: data.expiresAt, validated: true });
      statusEl.textContent = text().couponValid;
      statusEl.className = "d119-coupon__status is-valid";
    }).catch(function (err) {
      statusEl.textContent = err && err.message === "SHOP_API_NOT_CONFIGURED" ? text().couponOffline : text().couponInvalid;
      statusEl.className = "d119-coupon__status is-error";
    });
  }

  function refreshCouponWidget() {
    var input = document.querySelector("#d119CouponPanel input");
    var status = document.querySelector("#d119CouponPanel .d119-coupon__status");
    var coupon = storedCoupon();
    if (input && coupon) input.value = coupon.code || "";
    if (status && coupon && coupon.validated) {
      status.textContent = text().couponValid;
      status.className = "d119-coupon__status is-valid";
    }
  }

  function ensureCouponWidget() {
    if (document.getElementById("d119CouponWidget")) return;
    var c = text();
    var wrap = document.createElement("div");
    wrap.id = "d119CouponWidget";
    wrap.className = "d119-coupon";
    wrap.innerHTML = '<button type="button" class="d119-coupon__toggle" aria-expanded="false">' + escapeHtml(c.coupon) + '</button><div class="d119-coupon__panel" id="d119CouponPanel" hidden><label>' + escapeHtml(c.coupon) + '<input type="text" maxlength="32" autocomplete="off" spellcheck="false" placeholder="' + escapeHtml(c.couponPlaceholder) + '"></label><button type="button" class="d119-coupon__apply">' + escapeHtml(c.apply) + '</button><p class="d119-coupon__status" aria-live="polite"></p></div>';
    document.body.appendChild(wrap);
    var toggle = wrap.querySelector(".d119-coupon__toggle");
    var panel = wrap.querySelector(".d119-coupon__panel");
    var apply = wrap.querySelector(".d119-coupon__apply");
    var input = wrap.querySelector("input");
    var status = wrap.querySelector(".d119-coupon__status");
    toggle.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
      toggle.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
      if (!panel.hidden) input.focus();
    });
    apply.addEventListener("click", function () { validateCoupon(input.value, status); });
    input.addEventListener("keydown", function (event) { if (event.key === "Enter") validateCoupon(input.value, status); });
    refreshCouponWidget();
  }

  function installCartCouponMirror() {
    var drawer = document.getElementById("cartDrawer");
    if (!drawer || document.getElementById("d119CartCoupon")) return;
    var c = text();
    var box = document.createElement("div");
    box.id = "d119CartCoupon";
    box.className = "d119-cart-coupon";
    box.innerHTML = '<strong>' + escapeHtml(c.coupon) + '</strong><span>' + escapeHtml(storedCoupon()?.code || c.couponPlaceholder) + '</span><button type="button">' + escapeHtml(c.apply) + '</button>';
    drawer.appendChild(box);
    box.querySelector("button").addEventListener("click", function () {
      var toggle = document.querySelector(".d119-coupon__toggle");
      if (toggle) toggle.click();
    });
  }

  function install() {
    hookGameStarts();
    watchGameResult();
    installUniverseButtons();
    ensureCouponWidget();
    installCartCouponMirror();
    directPlay();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { window.setTimeout(install, 0); }, { once: true });
  else window.setTimeout(install, 0);
})();
