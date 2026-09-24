(function () {
  "use strict";

  var EXPIRES_AT = Date.parse("2026-09-25T13:58:57+02:00");
  var AUTH_KEY = "d119_temp_private_until";
  var EXPECTED_HASH = "a65bd46ba7f83f1b2a7b54c9ee00f0be4e7fd90aafa39699704be1781a2f9d0e";
  var RUNTIME = "/assets/pwa-runtime.js?v=64d42bd7c7";

  function loadRuntime() {
    if (document.querySelector('script[data-d119-pwa-runtime]')) return;
    var script = document.createElement("script");
    script.src = RUNTIME;
    script.async = false;
    script.setAttribute("data-d119-pwa-runtime", "");
    (document.head || document.documentElement).appendChild(script);
  }

  function isAuthorized() {
    try { return window.localStorage.getItem(AUTH_KEY) === String(EXPIRES_AT); }
    catch (e) { return false; }
  }

  if (Date.now() >= EXPIRES_AT) {
    try { window.localStorage.removeItem(AUTH_KEY); } catch (e) {}
    loadRuntime();
    return;
  }

  if (isAuthorized()) {
    loadRuntime();
    return;
  }

  try { window.stop(); } catch (e) {}

  var robots = document.querySelector('meta[name="robots"]');
  if (!robots) {
    robots = document.createElement("meta");
    robots.name = "robots";
    document.head.appendChild(robots);
  }
  robots.content = "noindex,nofollow,noarchive";
  document.title = "Disorder119 — Privat";

  function renderLock() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", renderLock, { once: true });
      return;
    }

    document.documentElement.style.background = "#000";
    document.body.innerHTML = "";
    document.body.setAttribute("data-d119-temp-lock", "");

    var style = document.createElement("style");
    style.textContent = "html,body{margin:0;min-height:100%;background:#000;color:#f2efe7;font-family:Helvetica,Arial,sans-serif}body[data-d119-temp-lock]{min-height:100vh;display:grid;place-items:center;padding:24px}.d119-lock{width:min(92vw,420px);border:1px solid rgba(242,239,231,.25);padding:28px;background:#080808}.d119-lock__brand{margin:0 0 42px;font-weight:800;letter-spacing:-.02em;text-transform:uppercase;font-size:20px}.d119-lock__eyebrow{margin:0 0 8px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.58}.d119-lock h1{margin:0 0 10px;font-size:28px;line-height:1.05}.d119-lock__copy{margin:0 0 28px;font-size:13px;line-height:1.55;opacity:.72}.d119-lock label{display:block;margin:0 0 8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase}.d119-lock__row{display:grid;grid-template-columns:1fr auto;border:1px solid rgba(242,239,231,.35)}.d119-lock input{min-width:0;border:0;background:#000;color:#f2efe7;padding:14px 13px;font:inherit;outline:none}.d119-lock button{border:0;border-left:1px solid rgba(242,239,231,.35);background:#f2efe7;color:#000;padding:0 18px;font:700 12px Helvetica,Arial,sans-serif;text-transform:uppercase;cursor:pointer}.d119-lock__error{min-height:18px;margin:10px 0 0;font-size:12px;color:#ff8c8c}.d119-lock__until{margin:28px 0 0;font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.42}@media(max-width:480px){.d119-lock{padding:22px}.d119-lock__row{grid-template-columns:1fr}.d119-lock button{min-height:44px;border-left:0;border-top:1px solid rgba(242,239,231,.35)}}";
    document.head.appendChild(style);

    var box = document.createElement("main");
    box.className = "d119-lock";
    box.innerHTML = '<p class="d119-lock__brand">DISORDER119</p><p class="d119-lock__eyebrow">Private Archive</p><h1>Temporär geschlossen.</h1><p class="d119-lock__copy">Der Zugriff ist derzeit passwortgeschützt.</p><form id="d119LockForm" autocomplete="off"><label for="d119LockPassword">Passwort</label><div class="d119-lock__row"><input id="d119LockPassword" type="password" autocomplete="current-password" required autofocus><button type="submit">Öffnen</button></div><p class="d119-lock__error" id="d119LockError" role="alert"></p></form><p class="d119-lock__until">Automatische Freigabe: 25.09.2026 · 13:58 Uhr</p>';
    document.body.appendChild(box);

    var form = document.getElementById("d119LockForm");
    var input = document.getElementById("d119LockPassword");
    var error = document.getElementById("d119LockError");

    function toHex(buffer) {
      return Array.prototype.map.call(new Uint8Array(buffer), function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      error.textContent = "Prüfe …";
      var value = input.value || "";
      if (!window.crypto || !window.crypto.subtle || !window.TextEncoder) {
        error.textContent = "Dieser Browser unterstützt die Passwortprüfung nicht.";
        return;
      }
      window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)).then(function (hash) {
        if (toHex(hash) !== EXPECTED_HASH) {
          error.textContent = "Falsches Passwort.";
          input.select();
          return;
        }
        try { window.localStorage.setItem(AUTH_KEY, String(EXPIRES_AT)); } catch (e) {}
        location.reload();
      }).catch(function () {
        error.textContent = "Passwortprüfung fehlgeschlagen.";
      });
    });

    window.setTimeout(function () {
      if (Date.now() >= EXPIRES_AT) location.reload();
    }, Math.max(1000, Math.min(2147483000, EXPIRES_AT - Date.now() + 1000)));
  }

  renderLock();
})();
