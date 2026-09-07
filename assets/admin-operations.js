"use strict";

(function () {
  var state = {
    apiBase: localStorage.getItem("d119_admin_api_base") || "",
    token: sessionStorage.getItem("d119_admin_token") || "",
    visitors: [],
    orders: [],
    visitorTimer: null,
    orderTimer: null
  };

  function $(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  function compactId(value) {
    var text = String(value || "");
    return text.length > 18 ? text.slice(0, 8) + "…" + text.slice(-6) : text;
  }
  function dateTime(value) {
    if (!value) return "—";
    var d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(d);
  }
  function relative(value) {
    if (!value) return "—";
    var ms = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(ms)) return dateTime(value);
    var minutes = Math.max(0, Math.round(ms / 60000));
    if (minutes < 1) return "gerade eben";
    if (minutes < 60) return "vor " + minutes + " Min.";
    var hours = Math.round(minutes / 60);
    if (hours < 24) return "vor " + hours + " Std.";
    return dateTime(value);
  }
  function money(cents, currency) {
    var value = Number(cents || 0) / 100;
    try {
      return new Intl.NumberFormat("de-DE", { style: "currency", currency: currency || "EUR" }).format(value);
    } catch (error) {
      return value.toFixed(2) + " " + (currency || "EUR");
    }
  }
  function badge(value) {
    var text = String(value || "—").toUpperCase();
    var tone = "";
    if (/PAID|COMPLETED|DELIVERED|ACTIVE|AVAILABLE/.test(text)) tone = "ok";
    else if (/FAILED|CANCELLED|EXCEPTION|REFUNDED/.test(text)) tone = "danger";
    else if (/PENDING|CREATED|PREPARING|SHIPPED|RETURN/.test(text)) tone = "warn";
    return '<span class="badge" data-tone="' + tone + '">' + esc(text) + "</span>";
  }
  function toast(message) {
    var el = $("toast");
    el.textContent = message;
    el.hidden = false;
    window.clearTimeout(toast._timer);
    toast._timer = window.setTimeout(function () { el.hidden = true; }, 3200);
  }
  function setConnection(kind, text) {
    var el = $("connectionStatus");
    el.dataset.state = kind;
    el.textContent = text;
  }
  function apiBase() { return String(state.apiBase || "").replace(/\/+$/, ""); }
  async function api(path, options) {
    if (!state.apiBase || !state.token) throw new Error("ADMIN_CONNECTION_REQUIRED");
    var opts = Object.assign({}, options || {});
    opts.headers = Object.assign({}, opts.headers || {}, {
      Authorization: "Bearer " + state.token,
      Accept: "application/json"
    });
    if (opts.body && !opts.headers["Content-Type"]) opts.headers["Content-Type"] = "application/json";
    var response = await fetch(apiBase() + path, opts);
    var payload = null;
    try { payload = await response.json(); } catch (error) { payload = {}; }
    if (!response.ok) {
      var err = new Error(payload && payload.error ? payload.error : "HTTP_" + response.status);
      err.status = response.status;
      err.payload = payload;
      throw err;
    }
    return payload;
  }
  function openSetup() {
    $("apiBaseInput").value = state.apiBase;
    $("adminTokenInput").value = state.token;
    $("setupDialog").showModal();
  }
  async function saveConnection() {
    var base = $("apiBaseInput").value.trim().replace(/\/+$/, "");
    var token = $("adminTokenInput").value.trim();
    if (!/^https?:\/\//i.test(base) || !token) { toast("Worker-URL und Admin-Token vollständig eintragen."); return; }
    state.apiBase = base;
    state.token = token;
    localStorage.setItem("d119_admin_api_base", base);
    sessionStorage.setItem("d119_admin_token", token);
    setConnection("idle", "Prüfe Verbindung …");
    try {
      await api("/admin/ping");
      setConnection("ok", "Verbunden");
      $("setupDialog").close();
      await loadAll();
    } catch (error) {
      setConnection("error", "Verbindung fehlgeschlagen");
      toast("Admin API: " + error.message);
    }
  }

  async function loadAll() {
    if (!state.apiBase || !state.token) { setConnection("idle", "Nicht verbunden"); openSetup(); return; }
    setConnection("idle", "Aktualisiere …");
    try {
      var results = await Promise.all([
        api("/admin/visitors?limit=100"),
        api("/admin/orders?limit=100"),
        api("/admin/overview?days=30")
      ]);
      renderVisitors(results[0]);
      renderOrders(results[1]);
      renderMetrics(results[0], results[2], results[1]);
      setConnection("ok", "Verbunden");
    } catch (error) {
      setConnection("error", "Fehler");
      if (error.status === 401 || error.status === 403 || error.status === 503) openSetup();
      toast("Operations konnten nicht geladen werden: " + error.message);
    }
  }

  function renderMetrics(visitors, overview, orders) {
    var summary = visitors.summary || {};
    $("mActive").textContent = summary.active15m == null ? "—" : summary.active15m;
    $("mVisitorsToday").textContent = summary.visitorsToday == null ? "—" : summary.visitorsToday;
    $("mPageviewsToday").textContent = summary.pageViewsToday == null ? "—" : summary.pageViewsToday;
    var orderSummary = (overview && overview.orders) || {};
    $("mOrders").textContent = orderSummary.total == null ? (orders.total || 0) : orderSummary.total;
    var open = Number(orderSummary.created || 0) + Number(orderSummary.paymentPending || 0) + Number(orderSummary.paid || 0) + Number(orderSummary.preparing || 0);
    $("mOrdersSub").textContent = open ? open + " offen" : "gesamt";
    $("mOrderValue").textContent = money(orderSummary.valueCents || orderSummary.totalCents || 0, "EUR");
  }

  function visitorLocation(v) {
    var parts = [v.city, v.region, v.country].filter(Boolean);
    return parts.length ? parts.join(", ") : "—";
  }
  function visitorSource(v) {
    if (v.utm_source) return v.utm_source + (v.utm_campaign ? " · " + v.utm_campaign : "");
    if (!v.initial_referrer) return "Direkt";
    try { return new URL(v.initial_referrer).hostname; } catch (error) { return v.initial_referrer; }
  }
  function renderVisitors(data) {
    state.visitors = data.visitors || [];
    $("visitorCount").textContent = Number(data.total || 0).toLocaleString("de-DE") + " Sessions · neueste zuerst";
    var tbody = $("visitorRows");
    if (!state.visitors.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">Keine Besucher für diesen Filter.</td></tr>';
      return;
    }
    tbody.innerHTML = state.visitors.map(function (v) {
      return '<tr data-visitor-id="' + esc(v.id) + '">' +
        '<td><strong>' + esc(relative(v.last_seen_at)) + '</strong><div class="muted">' + esc(dateTime(v.last_seen_at)) + '</div></td>' +
        '<td class="mono" title="' + esc(v.id) + '">' + esc(compactId(v.id)) + '</td>' +
        '<td>' + esc(visitorLocation(v)) + '</td>' +
        '<td>' + esc(v.device_type || "—") + '<div class="muted">' + esc([v.browser, v.platform].filter(Boolean).join(" · ")) + '</div></td>' +
        '<td>' + esc(v.page_views || 0) + '</td>' +
        '<td>' + esc(v.last_path || "—") + '</td>' +
        '<td>' + esc(visitorSource(v)) + '</td>' +
        '</tr>';
    }).join("");
  }

  function renderOrders(data) {
    state.orders = data.orders || [];
    $("orderCount").textContent = Number(data.total || 0).toLocaleString("de-DE") + " Bestellungen · neueste zuerst";
    var tbody = $("orderRows");
    if (!state.orders.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">Keine Bestellungen für diesen Filter.</td></tr>';
      return;
    }
    tbody.innerHTML = state.orders.map(function (o) {
      return '<tr data-order-id="' + esc(o.id || o.order_number) + '">' +
        '<td>' + esc(dateTime(o.created_at)) + '</td>' +
        '<td><strong>' + esc(o.order_number || compactId(o.id)) + '</strong><div class="muted">' + esc(o.itemTitles || "") + '</div></td>' +
        '<td>' + badge(o.status) + '</td>' +
        '<td>' + badge(o.paymentStatus || "—") + '<div class="muted">' + esc(o.paymentProvider || "") + '</div></td>' +
        '<td>' + badge(o.shipmentStatus || "—") + '<div class="mono muted">' + esc(o.trackingNumber || "") + '</div></td>' +
        '<td>' + esc(o.itemCount || 0) + '</td>' +
        '<td><strong>' + esc(money(o.total_cents, o.currency)) + '</strong></td>' +
        '</tr>';
    }).join("");
  }

  function kv(object, fields) {
    return '<dl class="kv">' + fields.map(function (field) {
      var label = field[0], key = field[1], formatter = field[2];
      var raw = object && object[key];
      var value = formatter ? formatter(raw, object) : (raw == null || raw === "" ? "—" : raw);
      return '<dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd>';
    }).join("") + '</dl>';
  }
  function records(title, rows, formatter) {
    var list = rows || [];
    return '<section class="detail-card detail-card--wide"><h3>' + esc(title) + ' (' + list.length + ')</h3>' +
      (list.length ? '<div class="record-list">' + list.map(function (row) {
        if (formatter) return '<div class="record">' + formatter(row) + '</div>';
        return '<div class="record"><pre>' + esc(JSON.stringify(row, null, 2)) + '</pre></div>';
      }).join("") + '</div>' : '<div class="muted">Keine Einträge.</div>') + '</section>';
  }
  function openDrawer(title, eyebrow, html) {
    $("drawerTitle").textContent = title;
    $("drawerEyebrow").textContent = eyebrow;
    $("drawerBody").innerHTML = html;
    $("drawerBackdrop").hidden = false;
    $("detailDrawer").classList.add("is-open");
    $("detailDrawer").setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
  }
  function closeDrawer() {
    $("drawerBackdrop").hidden = true;
    $("detailDrawer").classList.remove("is-open");
    $("detailDrawer").setAttribute("aria-hidden", "true");
    document.body.classList.remove("drawer-open");
  }
  function loadingDrawer(title, eyebrow) {
    openDrawer(title, eyebrow, '<div class="empty">Details werden geladen …</div>');
  }

  async function showVisitor(id) {
    loadingDrawer("Besucher", "SESSION DETAIL");
    try {
      var data = await api("/admin/visitors/" + encodeURIComponent(id));
      var v = data.visitor || {};
      var html = '<div class="detail-grid">' +
        '<section class="detail-card"><h3>Session</h3>' + kv(v, [
          ["Session-ID", "id"], ["Erster Besuch", "first_seen_at", dateTime], ["Letzter Besuch", "last_seen_at", dateTime], ["Seitenaufrufe", "page_views"],
          ["Landingpage", "landing_path"], ["Letzte Seite", "last_path"]
        ]) + '</section>' +
        '<section class="detail-card"><h3>Gerät & Ort</h3>' + kv(v, [
          ["Gerät", "device_type"], ["Browser", "browser"], ["Plattform", "platform"], ["Sprache", "language"],
          ["Viewport", "viewport_width", function (value, obj) { return value && obj.viewport_height ? value + " × " + obj.viewport_height : "—"; }],
          ["Land", "country"], ["Region", "region"], ["Stadt", "city"], ["Cloudflare POP", "colo"]
        ]) + '</section>' +
        '<section class="detail-card detail-card--wide"><h3>Quelle</h3>' + kv(v, [
          ["Referrer", "initial_referrer"], ["UTM Source", "utm_source"], ["UTM Medium", "utm_medium"], ["UTM Campaign", "utm_campaign"]
        ]) + '</section>' +
        records("Seitenverlauf", data.pageviews, function (p) {
          return '<strong>' + esc(p.path) + '</strong><div class="muted">' + esc(p.title || "") + '</div><div class="mono muted">' + esc(dateTime(p.occurred_at)) + '</div>';
        }) +
        '</div>';
      openDrawer(compactId(v.id), "SESSION DETAIL", html);
    } catch (error) {
      openDrawer("Fehler", "SESSION DETAIL", '<div class="empty">' + esc(error.message) + '</div>');
    }
  }

  function contactCard(data) {
    var contact = data.contact || {};
    var customer = data.customer || {};
    return '<section class="detail-card"><h3>Kunde & Kontakt</h3>' + kv(Object.assign({}, customer, contact), [
      ["Kunden-ID", "id"], ["E-Mail", "email_normalized"], ["Kontakt E-Mail", "email"], ["Vorname", "first_name"], ["Nachname", "last_name"], ["Telefon", "phone"], ["Verifiziert", "email_verified"]
    ]) + '</section>';
  }
  function orderStatusControls(data) {
    var next = data.nextStatuses || [];
    if (!next.length) return "";
    return '<section class="detail-card detail-card--wide"><h3>Status ändern</h3><div class="record-list"><div class="record"><div class="dialog-actions" style="margin-top:0;justify-content:flex-start;flex-wrap:wrap">' + next.map(function (status) {
      return '<button type="button" class="button button--quiet" data-order-status="' + esc(status) + '">' + esc(status) + '</button>';
    }).join("") + '</div></div></div></section>';
  }
  async function showOrder(id) {
    loadingDrawer("Bestellung", "ORDER DETAIL");
    try {
      var data = await api("/admin/orders/" + encodeURIComponent(id));
      var o = data.order || {};
      var html = '<div class="detail-grid">' +
        '<section class="detail-card"><h3>Bestellung</h3>' + kv(o, [
          ["Bestellnummer", "order_number"], ["ID", "id"], ["Status", "status"], ["Erstellt", "created_at", dateTime], ["Aktualisiert", "updated_at", dateTime],
          ["Zwischensumme", "subtotal_cents", function (v, obj) { return money(v, obj.currency); }], ["Versand", "shipping_cents", function (v, obj) { return money(v, obj.currency); }],
          ["Gesamt", "total_cents", function (v, obj) { return money(v, obj.currency); }], ["Währung", "currency"]
        ]) + '</section>' + contactCard(data) +
        records("Adressen", data.addresses) +
        records("Artikel", data.items, function (item) {
          return '<strong>' + esc(item.title_snapshot || item.item_id || "Artikel") + '</strong><div>' + esc(money(item.unit_price_cents, o.currency)) + '</div><pre>' + esc(JSON.stringify(item, null, 2)) + '</pre>';
        }) +
        records("Zahlungen", data.payments) +
        records("Versand", data.shipments) +
        records("Retouren", data.returns) +
        records("Erstattungen", data.refunds) +
        records("Notizen", data.notes) +
        '<section class="detail-card detail-card--wide"><h3>Ereignisverlauf (' + (data.events || []).length + ')</h3><div class="timeline">' +
          ((data.events || []).length ? data.events.map(function (event) {
            return '<div class="timeline-item"><strong>' + esc(event.event_type || event.action || "Ereignis") + '</strong><small>' + esc(dateTime(event.created_at)) + ' · ' + esc(event.request_id || "") + '</small><div class="muted">' + esc(event.metadata_json || event.details_json || "") + '</div></div>';
          }).join("") : '<div class="muted">Keine Ereignisse.</div>') + '</div></section>' +
        orderStatusControls(data) +
        '</div>';
      openDrawer(o.order_number || compactId(o.id), "ORDER DETAIL", html);
      Array.prototype.forEach.call(document.querySelectorAll("[data-order-status]"), function (button) {
        button.addEventListener("click", async function () {
          var status = button.getAttribute("data-order-status");
          if (!window.confirm("Bestellstatus wirklich auf " + status + " setzen?")) return;
          button.disabled = true;
          try {
            await api("/admin/orders/" + encodeURIComponent(o.id), { method: "PATCH", body: JSON.stringify({ status: status }) });
            toast("Bestellstatus aktualisiert.");
            await Promise.all([loadOrders(), showOrder(o.id)]);
          } catch (error) {
            toast("Status konnte nicht geändert werden: " + error.message);
            button.disabled = false;
          }
        });
      });
    } catch (error) {
      openDrawer("Fehler", "ORDER DETAIL", '<div class="empty">' + esc(error.message) + '</div>');
    }
  }

  async function loadVisitors() {
    var query = new URLSearchParams({ limit: "100" });
    var search = $("visitorSearch").value.trim();
    if (search) query.set("q", search);
    if ($("activeOnly").checked) query.set("active", "1");
    var data = await api("/admin/visitors?" + query.toString());
    renderVisitors(data);
    renderMetrics(data, {}, { total: state.orders.length });
  }
  async function loadOrders() {
    var query = new URLSearchParams({ limit: "100" });
    var search = $("orderSearch").value.trim();
    var status = $("orderStatus").value;
    if (search) query.set("q", search);
    if (status) query.set("status", status);
    renderOrders(await api("/admin/orders?" + query.toString()));
  }
  function debounce(fn, prop) {
    window.clearTimeout(state[prop]);
    state[prop] = window.setTimeout(function () {
      fn().catch(function (error) { toast(error.message); });
    }, 260);
  }
  function selectTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (tab) {
      tab.classList.toggle("is-active", tab.dataset.tab === name);
    });
    $("visitorsPanel").hidden = name !== "visitors";
    $("ordersPanel").hidden = name !== "orders";
  }

  $("openSetup").addEventListener("click", openSetup);
  $("saveConnection").addEventListener("click", saveConnection);
  $("refreshAll").addEventListener("click", loadAll);
  $("closeDrawer").addEventListener("click", closeDrawer);
  $("drawerBackdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function (event) { if (event.key === "Escape") closeDrawer(); });
  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (tab) {
    tab.addEventListener("click", function () { selectTab(tab.dataset.tab); });
  });
  $("visitorRows").addEventListener("click", function (event) {
    var row = event.target.closest("[data-visitor-id]");
    if (row) showVisitor(row.getAttribute("data-visitor-id"));
  });
  $("orderRows").addEventListener("click", function (event) {
    var row = event.target.closest("[data-order-id]");
    if (row) showOrder(row.getAttribute("data-order-id"));
  });
  $("visitorSearch").addEventListener("input", function () { debounce(loadVisitors, "visitorTimer"); });
  $("activeOnly").addEventListener("change", function () { loadVisitors().catch(function (e) { toast(e.message); }); });
  $("orderSearch").addEventListener("input", function () { debounce(loadOrders, "orderTimer"); });
  $("orderStatus").addEventListener("change", function () { loadOrders().catch(function (e) { toast(e.message); }); });

  if (state.apiBase && state.token) loadAll();
  else openSetup();
})();
