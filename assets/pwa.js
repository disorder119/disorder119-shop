(function () {
  "use strict";

  var EXPIRES_AT = Date.parse("2026-09-26T13:53:00+02:00");
  var AUTH_KEY = "d119_temp_private_until";
  var EXPECTED_HASH = "a65bd46ba7f83f1b2a7b54c9ee00f0be4e7fd90aafa39699704be1781a2f9d0e";
  var RUNTIME = "/assets/pwa-runtime.js?v=20260926-1";

  function loadRuntime() {
    if (document.querySelector('script[data-d119-pwa-runtime]')) return;
    var script = document.createElement("script");
    script.src = RUNTIME;
    script.async = false;
    script.setAttribute("data-d119-pwa-runtime", "");
    (document.head || document.documentElement).appendChild(script);
  }

  function authorized() {
    try { return localStorage.getItem(AUTH_KEY) === String(EXPIRES_AT); }
    catch (e) { return false; }
  }

  if (Date.now() >= EXPIRES_AT) {
    try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
    loadRuntime();
    return;
  }

  if (authorized()) {
    loadRuntime();
    return;
  }

  window.__D119_TEMP_LOCK__ = true;
  try { window.stop(); } catch (e) {}

  var robots = document.querySelector('meta[name="robots"]');
  if (!robots) {
    robots = document.createElement("meta");
    robots.name = "robots";
    document.head.appendChild(robots);
  }
  robots.content = "noindex,nofollow,noarchive";

  var style = document.createElement("style");
  style.id = "d119-temp-lock-style";
  style.textContent = "html,body{margin:0!important;min-height:100%!important;background:#000!important;color:#f2efe7!important;font-family:Helvetica,Arial,sans-serif!important;overflow:hidden!important}body>*:not(#d119-temp-lock){visibility:hidden!important}#d119-temp-lock{visibility:visible!important;position:fixed!important;inset:0!important;z-index:2147483647!important;background:#000!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:24px!important;box-sizing:border-box!important}#d119-temp-lock *{box-sizing:border-box!important;visibility:visible!important}.d119-lock-card{width:min(420px,100%);border:1px solid rgba(242,239,231,.25);padding:30px 24px;background:#080808}.d119-lock-kicker{margin:0 0 12px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.55}.d119-lock-title{margin:0 0 8px;font-size:26px;line-height:1.05;text-transform:uppercase}.d119-lock-copy{margin:0 0 22px;font-size:13px;line-height:1.5;opacity:.72}.d119-lock-form{display:flex;gap:8px}.d119-lock-input{min-width:0;flex:1;background:#000;color:#f2efe7;border:1px solid rgba(242,239,231,.35);padding:12px 13px;font:inherit;outline:none}.d119-lock-input:focus{border-color:#f2efe7}.d119-lock-btn{border:1px solid #f2efe7;background:#f2efe7;color:#000;padding:12px 15px;font:700 12px/1 Helvetica,Arial,sans-serif;text-transform:uppercase;cursor:pointer}.d119-lock-error{min-height:18px;margin:10px 0 0;font-size:12px;opacity:.8}.d119-lock-brand{margin-top:26px;padding-top:18px;border-top:1px solid rgba(242,239,231,.15);font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.45}@media(max-width:520px){.d119-lock-form{display:block}.d119-lock-input,.d119-lock-btn{width:100%}.d119-lock-btn{margin-top:8px}}";
  document.head.appendChild(style);

  var lock = document.createElement("div");
  lock.id = "d119-temp-lock";
  lock.innerHTML = '<main class="d119-lock-card"><p class="d119-lock-kicker">Private access</p><h1 class="d119-lock-title">Disorder119 ist vorübergehend privat.</h1><p class="d119-lock-copy">Die Website ist derzeit nur mit Passwort zugänglich.</p><form class="d119-lock-form" id="d119-lock-form"><input class="d119-lock-input" id="d119-lock-input" type="password" autocomplete="current-password" placeholder="Passwort" aria-label="Passwort" required><button class="d119-lock-btn" type="submit">Öffnen</button></form><p class="d119-lock-error" id="d119-lock-error" aria-live="polite"></p><div class="d119-lock-brand">Disorder119</div></main>';
  document.body.appendChild(lock);

  function sha256(value) {
    if (!window.crypto || !window.crypto.subtle || typeof TextEncoder === "undefined") return Promise.reject(new Error("crypto unavailable"));
    return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    });
  }

  var form = document.getElementById("d119-lock-form");
  var input = document.getElementById("d119-lock-input");
  var error = document.getElementById("d119-lock-error");
  if (input) input.focus();

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    error.textContent = "Prüfe …";
    sha256(input.value).then(function (hash) {
      if (hash !== EXPECTED_HASH) {
        error.textContent = "Falsches Passwort.";
        input.select();
        return;
      }
      try { localStorage.setItem(AUTH_KEY, String(EXPIRES_AT)); } catch (e) {}
      location.reload();
    }).catch(function () {
      error.textContent = "Passwortprüfung ist in diesem Browser nicht verfügbar.";
    });
  });
})();
