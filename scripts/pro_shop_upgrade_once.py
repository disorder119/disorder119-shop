#!/usr/bin/env python3
"""Einmaliger Quellcode-Patch fuer den Professional-Shop-Pass.

Wird nur auf dem Arbeitsbranch ausgefuehrt und danach geloescht.
Keine Aenderung an Match/Chaos/Baukasten oder deren CSS/HTML.
"""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]


def replace_once(text, old, new, label):
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label}: Ausgangstext nicht gefunden")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# build_site.py: Feature-Flags wirklich auswerten + bessere strukturierte Daten
# ---------------------------------------------------------------------------
p = BASE / "build_site.py"
s = p.read_text(encoding="utf-8")

old = '''    cfg = {
        "whatsappNumber": raw.get("whatsappNumber") or "",
        "email": raw.get("email") or "",
        "paypalClientId": raw.get("paypalClientId") or "",
        "shopWorkerUrl": raw.get("shopWorkerUrl") or "",
    }
'''
new = '''    features_raw = raw.get("features") or {}
    if not isinstance(features_raw, dict):
        raise SystemExit(f"FEHLER: {SHOP_CONFIG_PATH} Feld 'features' muss ein Objekt sein.")
    environment = raw.get("environment") or "sandbox"
    if environment not in ("sandbox", "live"):
        raise SystemExit(f"FEHLER: {SHOP_CONFIG_PATH} environment muss 'sandbox' oder 'live' sein.")
    cfg = {
        "whatsappNumber": raw.get("whatsappNumber") or "",
        "email": raw.get("email") or "",
        "paypalClientId": raw.get("paypalClientId") or "",
        "shopWorkerUrl": raw.get("shopWorkerUrl") or "",
        "environment": environment,
        "features": {
            "paypalCheckout": bool(features_raw.get("paypalCheckout")),
            "customerAccounts": bool(features_raw.get("customerAccounts")),
        },
    }
    if cfg["features"]["paypalCheckout"] and (not cfg["paypalClientId"] or not cfg["shopWorkerUrl"]):
        raise SystemExit(
            "FEHLER: paypalCheckout=true, aber paypalClientId oder shopWorkerUrl fehlt. "
            "Checkout bleibt aus, bis die Sandbox-Konfiguration vollstaendig ist."
        )
'''
s = replace_once(s, old, new, "Shop-Config Feature Flags")

old = '''    if shop_config.get("paypalClientId") and shop_config.get("shopWorkerUrl") and not sold and it.get("price", 0) > 0:
'''
new = '''    paypal_enabled = bool((shop_config.get("features") or {}).get("paypalCheckout"))
    if paypal_enabled and shop_config.get("paypalClientId") and shop_config.get("shopWorkerUrl") and not sold and it.get("price", 0) > 0:
'''
s = replace_once(s, old, new, "PayPal SDK Feature Gate")

old = '''    paypal_ready = bool(shop_config.get("paypalClientId")) and bool(shop_config.get("shopWorkerUrl"))
'''
new = '''    paypal_ready = (
        bool((shop_config.get("features") or {}).get("paypalCheckout"))
        and bool(shop_config.get("paypalClientId"))
        and bool(shop_config.get("shopWorkerUrl"))
    )
'''
s = replace_once(s, old, new, "PayPal CTA Feature Gate")

old = '''        "brand": {"@type": "Brand", "name": it.get("brand") or "Disorder119"},
    }
'''
new = '''        "brand": {"@type": "Brand", "name": it.get("brand") or "Disorder119"},
        "seller": {"@type": "OnlineStore", "name": "Disorder119", "url": SITE_URL},
    }
'''
s = replace_once(s, old, new, "Product Seller JSON-LD")

marker = '''def thumb_path(p):
'''
insert = '''def breadcrumb_json_ld(it, lang):
    home_url = SITE_URL.rstrip("/") + lang_home(lang)
    product_url = home_url + "artikel/" + str(it["id"]) + "/"
    labels = {"de": "Archiv", "en": "Archive", "fr": "Archive"}
    data = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": labels.get(lang, "Archiv"), "item": home_url},
            {"@type": "ListItem", "position": 2, "name": display_name(it), "item": product_url},
        ],
    }
    return json.dumps(data, ensure_ascii=False)


def thumb_path(p):
'''
s = replace_once(s, marker, insert, "Breadcrumb JSON-LD Funktion")

old = '''<script type="application/ld+json">{json_ld(it, lang)}</script>
</head>
'''
new = '''<script type="application/ld+json">{json_ld(it, lang)}</script>
<script type="application/ld+json">{breadcrumb_json_ld(it, lang)}</script>
</head>
'''
s = replace_once(s, old, new, "Breadcrumb JSON-LD Einbindung")
p.write_text(s, encoding="utf-8")


# ---------------------------------------------------------------------------
# article.js: Checkout nur bei aktiviertem Feature, gekauften Artikel lokal
# aus dem Warenkorb entfernen. Keine Layout-/CSS-Aenderung.
# ---------------------------------------------------------------------------
p = BASE / "assets" / "article.js"
s = p.read_text(encoding="utf-8")
old = '''  if (paypalContainer && window.paypal && SHOP_CONFIG.shopWorkerUrl) {
'''
new = '''  if (paypalContainer && window.paypal && SHOP_CONFIG.shopWorkerUrl &&
      SHOP_CONFIG.features && SHOP_CONFIG.features.paypalCheckout) {
'''
s = replace_once(s, old, new, "Article PayPal Feature Gate")
old = '''          .then(function () { location.reload(); }); // Seite neu laden -> Artikel zeigt sich als verkauft, sobald der Rebuild durch ist
'''
new = '''          .then(function () {
            // Erfolgreich bezahltes Einzelstueck sofort aus dem lokalen
            // Warenkorb entfernen. Der serverseitige SOLD-Status bleibt die
            // autoritative Quelle; der anschliessende Reload zeigt ihn nach
            // dem automatischen Rebuild auch auf der Produktseite.
            var cart = loadCart();
            var pos = cart.indexOf(IT.id);
            if (pos !== -1) cart.splice(pos, 1);
            saveCart(cart);
            refreshCartCount();
            location.reload();
          });
'''
s = replace_once(s, old, new, "Paid item cart cleanup")
p.write_text(s, encoding="utf-8")


# ---------------------------------------------------------------------------
# Worker: sichere Origins, Sandbox/Live-Schalter, no-store, private D1-Daten,
# Capture-Verifikation und generische 500er. Kein Frontend-Design betroffen.
# ---------------------------------------------------------------------------
p = BASE / "shop-worker" / "worker.js"
s = p.read_text(encoding="utf-8")

marker = '''// Production darf keine beliebige Origin spiegeln (frueher: origin || "*") -
'''
insert = '''function paypalApiBase(env) {
  const mode = String(env.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase();
  return mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

function isLiveEnvironment(env) {
  return String(env.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase() === "live";
}

// Production darf keine beliebige Origin spiegeln (frueher: origin || "*") -
'''
s = replace_once(s, marker, insert, "PayPal Environment Helper")
s = s.replace("${CONFIG.paypalApiBase}", "${paypalApiBase(env)}")

old = '''    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
'''
new = '''    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Vary": "Origin",
      ...corsHeaders(origin),
    },
'''
s = replace_once(s, old, new, "API no-store headers")

old = '''  delete item.reserved_order_id;
  delete item.reserved_until;
'''
new = '''  delete item.reserved_order_id;
  delete item.reserved_until;
  delete item.reserved_price;
  delete item.reserved_currency;
'''
s = replace_once(s, old, new, "Reservation cleanup")

old = '''    item.reserved_order_id = orderId;
    item.reserved_until = Date.now() + RESERVATION_TTL_MS;
'''
new = '''    item.reserved_order_id = orderId;
    item.reserved_until = Date.now() + RESERVATION_TTL_MS;
    item.reserved_price = Number(item.price);
    item.reserved_currency = CONFIG.currency;
'''
s = replace_once(s, old, new, "Reservation price snapshot")

route_marker = '''// ---------- Routen ----------

export default {
'''
route_insert = '''// ---------- Private Betriebsdaten (Cloudflare D1) ----------
// Kunden-/Anfragedaten duerfen niemals in das oeffentliche GitHub-Repo.
async function appendRentalRequestPrivate(env, record) {
  if (!env.DB) throw new Error("Private D1-Datenbank ist fuer Verleih-Anfragen nicht konfiguriert.");
  await env.DB.prepare(
    `INSERT INTO rental_requests
      (id, item_id, item_title, article_no, start_date, end_date, days, purpose, message, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    record.id, record.itemId, record.itemTitle, String(record.articleNo || ""),
    record.start, record.end, record.days, record.purpose, record.message,
    record.status, record.createdAt
  ).run();
  return record;
}

async function listRentalRequestsPrivate(env) {
  if (!env.DB) throw new Error("Private D1-Datenbank ist nicht konfiguriert.");
  const result = await env.DB.prepare(
    `SELECT id, item_id AS itemId, item_title AS itemTitle, article_no AS articleNo,
            start_date AS start, end_date AS end, days, purpose, message, status,
            created_at AS createdAt, updated_at AS updatedAt
       FROM rental_requests ORDER BY created_at DESC LIMIT 500`
  ).all();
  return result.results || [];
}

async function updateRentalRequestPrivate(env, id, status) {
  if (!env.DB) throw new Error("Private D1-Datenbank ist nicht konfiguriert.");
  const existing = await env.DB.prepare("SELECT id FROM rental_requests WHERE id = ?").bind(id).first();
  if (!existing) return false;
  await env.DB.prepare("UPDATE rental_requests SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, new Date().toISOString(), id).run();
  return true;
}

function captureMatchesItem(capture, item) {
  if (!capture || capture.status !== "COMPLETED") return false;
  const unit = capture.purchase_units && capture.purchase_units[0];
  const payment = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
  const amount = payment && payment.amount;
  if (!unit || String(unit.custom_id || "") !== String(item.id)) return false;
  if (!amount || amount.currency_code !== CONFIG.currency) return false;
  return Number(amount.value).toFixed(2) === Number(item.price).toFixed(2);
}

async function recordCompletedOrder(env, item, orderId, capture) {
  if (!env.DB) return; // Sandbox darf ohne D1 getestet werden; live wird unten blockiert.
  const unit = capture && capture.purchase_units && capture.purchase_units[0];
  const payment = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
  const amount = payment && payment.amount ? Number(payment.amount.value) : Number(item.price);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO orders
      (id, paypal_order_id, item_id, article_no, item_title, amount_cents, currency, payment_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(), orderId, item.id, String(item.article || item.id),
    `${item.brand || ""} ${item.title}`.trim(), Math.round(amount * 100), CONFIG.currency,
    "COMPLETED", now
  ).run();
}

// ---------- Routen ----------

export default {
'''
s = replace_once(s, route_marker, route_insert, "Private D1 helpers")

old = '''    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });

    try {
'''
new = '''    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });

    // POST-Endpunkte, die einen Kauf/Datensatz ausloesen, akzeptieren nur
    // Aufrufe von den echten Shop-Domains. CORS allein reicht nicht: eine
    // fremde Seite koennte einen POST sonst trotzdem absenden, auch wenn sie
    // die Antwort anschliessend nicht lesen darf.
    const protectedPost = ["/create-order", "/capture-order", "/rental-request"].indexOf(url.pathname) !== -1;
    if (request.method === "POST" && protectedPost && !isAllowedOrigin(origin)) {
      return json({ error: "Origin nicht erlaubt." }, 403, origin);
    }
    if (request.method === "POST" && protectedPost && !(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
      return json({ error: "Content-Type application/json erforderlich." }, 415, origin);
    }

    try {
      if (url.pathname === "/health" && request.method === "GET") {
        const paypalConfigured = !!env.PAYPAL_CLIENT_ID && !!env.PAYPAL_CLIENT_SECRET && !!env.PAYPAL_WEBHOOK_ID;
        const githubConfigured = !!env.GITHUB_TOKEN;
        const dhlConfigured = !!env.DHL_API_KEY && !!env.DHL_API_SECRET && !!env.DHL_PORTAL_USER &&
          !!env.DHL_PORTAL_PASSWORD && !!env.DHL_BILLING_NUMBER && !!env.DHL_SHIPPER_ADDRESS;
        const dbConfigured = !!env.DB;
        return json({
          ok: true,
          environment: isLiveEnvironment(env) ? "live" : "sandbox",
          paypalConfigured,
          githubConfigured,
          dhlConfigured,
          dbConfigured,
          readyForLive: paypalConfigured && githubConfigured && dbConfigured,
        }, 200, origin);
      }
'''
s = replace_once(s, old, new, "Origin/health guard")

old = '''      if (url.pathname === "/create-order" && request.method === "POST") {
        const { itemId } = await request.json();
'''
new = '''      if (url.pathname === "/create-order" && request.method === "POST") {
        if (isLiveEnvironment(env) && !env.DB) {
          return json({ error: "Live-Checkout ist ohne privaten Bestellspeicher nicht freigeschaltet." }, 503, origin);
        }
        const { itemId } = await request.json();
        if (!/^\\d+$/.test(String(itemId || ""))) return json({ error: "Ungueltige Artikel-ID." }, 400, origin);
'''
s = replace_once(s, old, new, "Create-order validation")

old = '''          if (!preCheckItem || preCheckItem.reserved_order_id !== orderId || !reservationActive(preCheckItem)) {
            return json({ error: "Reservierung abgelaufen oder ungueltig - bitte Kauf neu starten." }, 409, origin);
          }
        }
        const capture = alreadyDoneForThisOrder ? null : await capturePaypalOrder(env, orderId);
        if (capture && capture.status !== "COMPLETED") {
          return json({ error: "Zahlung nicht abgeschlossen." }, 402, origin);
        }
'''
new = '''          if (!preCheckItem || preCheckItem.reserved_order_id !== orderId || !reservationActive(preCheckItem)) {
            return json({ error: "Reservierung abgelaufen oder ungueltig - bitte Kauf neu starten." }, 409, origin);
          }
          if (preCheckItem.reserved_price != null &&
              Number(preCheckItem.reserved_price).toFixed(2) !== Number(preCheckItem.price).toFixed(2)) {
            return json({ error: "Der Artikelpreis hat sich waehrend des Checkouts geaendert. Bitte Kauf neu starten." }, 409, origin);
          }
        }
        const capture = alreadyDoneForThisOrder ? null : await capturePaypalOrder(env, orderId);
        if (capture && !captureMatchesItem(capture, preCheckItem)) {
          // Capture ist serverseitig mit dem autoritativen Katalogpreis erstellt;
          // diese zusaetzliche Kontrolle erkennt trotzdem unerwartete Provider-
          // oder Zuordnungsfehler, bevor das Inventar auf SOLD gesetzt wird.
          console.error("PayPal Capture passt nicht zum reservierten Artikel", { orderId, itemId });
          return json({ error: "Zahlung konnte dem Artikel nicht eindeutig zugeordnet werden." }, 409, origin);
        }
'''
s = replace_once(s, old, new, "Capture verification")

old = '''        if (!alreadySold) {
          const shippingRaw = capture.purchase_units?.[0]?.shipping;
'''
new = '''        if (!alreadySold) {
          await recordCompletedOrder(env, item, orderId, capture);
          const shippingRaw = capture.purchase_units?.[0]?.shipping;
'''
s = replace_once(s, old, new, "Private order record")

s = replace_once(
    s,
    '''        await appendRentalRequest(env, record);\n''',
    '''        await appendRentalRequestPrivate(env, record);\n''',
    "Private rental insert",
)
old = '''        const { requests } = await loadRentalRequests(env);
        return json({ requests }, 200, origin);
'''
new = '''        const requests = await listRentalRequestsPrivate(env);
        return json({ requests }, 200, origin);
'''
s = replace_once(s, old, new, "Private rental listing")

old = '''        const { requests, sha } = await loadRentalRequests(env);
        const record = requests.find((r) => r.id === id);
        if (!record) return json({ error: "Anfrage nicht gefunden." }, 404, origin);
        record.status = status;
        record.updatedAt = new Date().toISOString();
        const newContent = btoa(unescape(encodeURIComponent(JSON.stringify(requests, null, 2))));
        const putUrl = `https://api.github.com/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${CONFIG.rentalRequestsPath}`;
        const putRes = await fetch(putUrl, {
          method: "PUT",
          headers: ghHeaders(env),
          body: JSON.stringify({
            message: `Verleih-Anfrage ${id}: Status -> ${status}`,
            content: newContent,
            sha,
            branch: CONFIG.githubBranch,
          }),
        });
        if (!putRes.ok) return json({ error: "Status konnte nicht gespeichert werden." }, 500, origin);
        return json({ ok: true }, 200, origin);
'''
new = '''        const updated = await updateRentalRequestPrivate(env, id, status);
        if (!updated) return json({ error: "Anfrage nicht gefunden." }, 404, origin);
        return json({ ok: true }, 200, origin);
'''
s = replace_once(s, old, new, "Private rental status update")

old = '''      console.error(err);
      return json({ error: err.message }, 500, origin);
'''
new = '''      console.error(err);
      // Keine internen Provider-/Token-/API-Details an den Browser leaken.
      return json({ error: "Interner Shop-Fehler." }, 500, origin);
'''
s = replace_once(s, old, new, "Generic API error")
p.write_text(s, encoding="utf-8")

print("Professional-Shop-Patch erfolgreich angewendet.")
