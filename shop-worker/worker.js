/**
 * Disorder119 Shop-Automat (Cloudflare Worker)
 * ---------------------------------------------
 * Sitzt zwischen dem PayPal-Button auf den Artikelseiten und dem Repo:
 *
 *   1. Frontend ruft POST /create-order  -> Worker legt bei PayPal eine
 *      Bestellung ueber den ECHTEN, in items.json hinterlegten Preis an
 *      (nie dem Browser vertrauen - der Preis kommt server-seitig aus dem
 *      Katalog, nicht vom Client).
 *   2. Kaeufer bestaetigt bei PayPal.
 *   3. Frontend ruft POST /capture-order -> Worker zieht die Zahlung ein,
 *      und wenn das klappt:
 *        a) markiert den Artikel in data/items.json als SOLD (ueber die
 *           GitHub Contents API) - der Rebuild-Workflow baut die Seite
 *           danach automatisch neu, der Artikel verschwindet aus dem
 *           Katalog, bevor ihn jemand zweites Mal bestellen kann.
 *        b) erstellt ein DHL-Versandlabel mit der vom Kaeufer bei PayPal
 *           hinterlegten Lieferadresse.
 *   4. POST /paypal-webhook ist ein Sicherheitsnetz: falls Schritt 3 durch
 *      einen geschlossenen Tab o.ae. nie ausgeloest wurde, markiert PayPals
 *      eigener Webhook (PAYMENT.CAPTURE.COMPLETED) den Artikel trotzdem als
 *      verkauft. Beide Wege sind idempotent (pruefen erst, ob der Artikel
 *      nicht schon SOLD ist), doppeltes Ausfuehren richtet nichts an.
 *
 * Zusaetzlich zum Kauf-Ablauf nimmt der Worker auch Verleih-Anfragen
 * (Musikvideo/Shooting) entgegen und macht sie fuer ein spaeteres
 * Admin-Dashboard abrufbar:
 *   5. POST /rental-request  -> vom Verleih-Modal auf der Startseite
 *      aufgerufen (sofern SHOP_CONFIG.shopWorkerUrl gesetzt ist), validiert
 *      Artikel/Zeitraum server-seitig und haengt die Anfrage an
 *      data/rental-requests.json an (gleiche GitHub-Contents-API-Technik
 *      wie markSold() - keine eigene Datenbank noetig fuer dieses
 *      Datenvolumen).
 *   6. GET  /rental-requests -> fuers Admin-Dashboard, nur mit gueltigem
 *      ADMIN_TOKEN (Bearer-Header) abrufbar. Das ist bewusst nur ein
 *      simples geteiltes Geheimnis als UEBERGANGSLOESUNG, bis ein echtes
 *      Admin-Auth-System (Supabase Auth + Cloudflare Access, siehe
 *      ADMIN_SETUP.md im disorder119-admin-Repo) steht - dann re-checkt
 *      dieser Worker zusaetzlich die dortige Identitaet/JWT statt (oder
 *      zusaetzlich zu) diesem Token.
 *
 * Noetige Secrets (per `wrangler secret put NAME` setzen, s. README.md):
 *   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID  (developer.paypal.com)
 *   DHL_API_KEY, DHL_API_SECRET, DHL_EKP, DHL_BILLING_NUMBER   (developer.dhl.com)
 *   GITHUB_TOKEN   (fein granulares PAT, nur "Contents: Read & write" auf
 *                    dieses eine Repo - siehe README.md)
 *   ADMIN_TOKEN    (frei gewaehltes, langes Zufallsgeheimnis - Uebergangs-
 *                    Login fuers Admin-Dashboard, s.o.)
 *
 * Nicht-geheime Konfiguration (unten in CONFIG):
 *   GITHUB_REPO, PAYPAL_API_BASE (sandbox waehrend des Testens, live danach)
 */

const CONFIG = {
  githubOwner: "disorder119",
  githubRepo: "disorder119-shop",
  githubBranch: "main",
  itemsPath: "data/items.json",
  rentalRequestsPath: "data/rental-requests.json",
  // https://api-m.sandbox.paypal.com waehrend des Testens,
  // https://api-m.paypal.com sobald es mit echtem Geld laufen soll.
  paypalApiBase: "https://api-m.sandbox.paypal.com",
  currency: "EUR",
};

// Production darf keine beliebige Origin spiegeln (frueher: origin || "*") -
// nur die tatsaechlichen Disorder119-Domains + das kuenftige Admin-Dashboard
// + localhost fuers lokale Testen duerfen den Worker aufrufen.
const ALLOWED_ORIGINS = [
  "https://disorder119.com",
  "https://www.disorder119.com",
  "https://admin.disorder119.com",
  "http://localhost:8765",
];

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.indexOf(origin) !== -1;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

/** Uebergangsloesung bis Supabase Auth + Cloudflare Access stehen (siehe
 *  Kommentar oben): ein einzelnes, langes, per `wrangler secret put
 *  ADMIN_TOKEN` gesetztes Geheimnis. Nie im Code hinterlegen. */
function isAdminAuthorized(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return !!env.ADMIN_TOKEN && token.length > 0 && token === env.ADMIN_TOKEN;
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

// ---------- PayPal ----------

async function paypalAccessToken(env) {
  const creds = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${CONFIG.paypalApiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error("PayPal-Login fehlgeschlagen: " + (await res.text()));
  const data = await res.json();
  return data.access_token;
}

async function createPaypalOrder(env, item) {
  const token = await paypalAccessToken(env);
  const res = await fetch(`${CONFIG.paypalApiBase}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: String(item.id),
          description: `${item.brand || ""} ${item.title}`.trim().slice(0, 127),
          amount: { currency_code: CONFIG.currency, value: item.price.toFixed(2) },
        },
      ],
      application_context: {
        shipping_preference: "GET_FROM_FILE",
        brand_name: "Disorder119",
      },
    }),
  });
  if (!res.ok) throw new Error("PayPal-Bestellung fehlgeschlagen: " + (await res.text()));
  return res.json();
}

async function capturePaypalOrder(env, orderId) {
  const token = await paypalAccessToken(env);
  const res = await fetch(`${CONFIG.paypalApiBase}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("PayPal-Zahlungseinzug fehlgeschlagen: " + (await res.text()));
  return res.json();
}

async function verifyPaypalWebhook(env, headers, body) {
  const token = await paypalAccessToken(env);
  const res = await fetch(`${CONFIG.paypalApiBase}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: body,
    }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.verification_status === "SUCCESS";
}

// ---------- Katalog (GitHub) ----------

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "disorder119-shop-worker",
  };
}

async function loadItems(env) {
  const url = `https://api.github.com/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${CONFIG.itemsPath}?ref=${CONFIG.githubBranch}`;
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (!res.ok) throw new Error("Katalog konnte nicht geladen werden: " + (await res.text()));
  const file = await res.json();
  const text = new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
  return { items: JSON.parse(text), sha: file.sha };
}

async function findItem(env, id) {
  const { items } = await loadItems(env);
  return items.find((it) => String(it.id) === String(id));
}

/** Markiert einen Artikel als verkauft. Idempotent: ist er schon SOLD,
 *  passiert nichts (wichtig, weil Capture UND Webhook denselben Artikel
 *  markieren koennten). */
async function markSold(env, id, orderId) {
  const { items, sha } = await loadItems(env);
  const item = items.find((it) => String(it.id) === String(id));
  if (!item) throw new Error("Unbekannter Artikel: " + id);
  if (item.public_status === "SOLD") return { item, alreadySold: true };

  item.public_status = "SOLD";
  item.status = "Verkauft";
  item.paypal_order_id = orderId;

  const newContent = btoa(unescape(encodeURIComponent(JSON.stringify(items, null, 2))));
  const url = `https://api.github.com/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${CONFIG.itemsPath}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: ghHeaders(env),
    body: JSON.stringify({
      message: `Verkauft via PayPal: ${item.brand || ""} ${item.title} (Artikel ${id})`.trim(),
      content: newContent,
      sha,
      branch: CONFIG.githubBranch,
    }),
  });
  if (!res.ok) throw new Error("Konnte Artikel nicht als verkauft markieren: " + (await res.text()));
  return { item, alreadySold: false };
}

// ---------- Verleih-Anfragen ----------
// Gleiche Technik wie loadItems()/markSold() oben: data/rental-requests.json
// im Repo ist die "Datenbank" (kein eigener DB-Server fuer dieses geringe
// Datenvolumen noetig). Datei existiert anfangs nicht - wird beim ersten
// Request angelegt.

async function loadRentalRequests(env) {
  const url = `https://api.github.com/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${CONFIG.rentalRequestsPath}?ref=${CONFIG.githubBranch}`;
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (res.status === 404) return { requests: [], sha: null };
  if (!res.ok) throw new Error("Verleih-Anfragen konnten nicht geladen werden: " + (await res.text()));
  const file = await res.json();
  const text = new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
  return { requests: JSON.parse(text), sha: file.sha };
}

async function appendRentalRequest(env, record) {
  const { requests, sha } = await loadRentalRequests(env);
  requests.unshift(record); // neueste zuerst, praktisch fuers Admin-Dashboard
  const newContent = btoa(unescape(encodeURIComponent(JSON.stringify(requests, null, 2))));
  const url = `https://api.github.com/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${CONFIG.rentalRequestsPath}`;
  const body = {
    message: `Verleih-Anfrage: ${record.itemTitle} (${record.start} – ${record.end})`,
    content: newContent,
    branch: CONFIG.githubBranch,
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: "PUT", headers: ghHeaders(env), body: JSON.stringify(body) });
  if (!res.ok) throw new Error("Verleih-Anfrage konnte nicht gespeichert werden: " + (await res.text()));
  return record;
}

function rentalDayCount(start, end) {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
  return Math.round((e - s) / 86400000) + 1;
}

// ---------- DHL ----------

async function dhlAccessToken(env) {
  const res = await fetch("https://api-eu.dhl.com/parcel/de/account/auth/ropc/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: env.DHL_API_KEY,
      client_secret: env.DHL_API_SECRET,
      username: env.DHL_PORTAL_USER,
      password: env.DHL_PORTAL_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error("DHL-Login fehlgeschlagen: " + (await res.text()));
  const data = await res.json();
  return data.access_token;
}

/** shipping = { name, addressLine1, city, postalCode, countryCode } aus der
 *  PayPal-Order (purchase_units[0].shipping). */
async function createDhlLabel(env, item, shipping) {
  const token = await dhlAccessToken(env);
  const res = await fetch("https://api-eu.dhl.com/parcel/de/shipping/v2/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "DHL-API-Key": env.DHL_API_KEY,
    },
    body: JSON.stringify({
      profile: "STANDARD_GRUPPENPROFIL",
      shipments: [
        {
          product: "V01PAK",
          billingNumber: env.DHL_BILLING_NUMBER, // EKP + Verfahren + Teilnahme, s. README
          refNo: `disorder119-${item.id}`,
          shipper: JSON.parse(env.DHL_SHIPPER_ADDRESS), // { name1, addressStreet, addressHouse, postalCode, city, country }
          consignee: {
            name1: shipping.name,
            addressStreet: shipping.addressLine1,
            postalCode: shipping.postalCode,
            city: shipping.city,
            country: shipping.countryCode,
          },
          details: { weight: { uom: "kg", value: 1 } },
        },
      ],
    }),
  });
  if (!res.ok) throw new Error("DHL-Label fehlgeschlagen: " + (await res.text()));
  const data = await res.json();
  const shipment = data.items && data.items[0];
  return shipment && shipment.label ? shipment.label.url : null;
}

// ---------- Routen ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });

    try {
      if (url.pathname === "/create-order" && request.method === "POST") {
        const { itemId } = await request.json();
        const item = await findItem(env, itemId);
        if (!item || item.public_status !== "AVAILABLE") {
          return json({ error: "Artikel nicht mehr verfuegbar." }, 409, origin);
        }
        const order = await createPaypalOrder(env, item);
        return json({ id: order.id }, 200, origin);
      }

      if (url.pathname === "/capture-order" && request.method === "POST") {
        const { orderId, itemId } = await request.json();
        const capture = await capturePaypalOrder(env, orderId);
        if (capture.status !== "COMPLETED") {
          return json({ error: "Zahlung nicht abgeschlossen." }, 402, origin);
        }
        const { item, alreadySold } = await markSold(env, itemId, orderId);
        if (!alreadySold) {
          const shippingRaw = capture.purchase_units?.[0]?.shipping;
          if (shippingRaw) {
            try {
              await createDhlLabel(env, item, {
                name: shippingRaw.name?.full_name,
                addressLine1: shippingRaw.address?.address_line_1,
                city: shippingRaw.address?.admin_area_2,
                postalCode: shippingRaw.address?.postal_code,
                countryCode: shippingRaw.address?.country_code,
              });
            } catch (dhlErr) {
              // Zahlung ist bereits eingezogen und Artikel markiert - ein
              // DHL-Fehler darf das nicht rueckgaengig machen, nur melden.
              console.error("DHL-Label fehlgeschlagen, manuell nachholen:", dhlErr.message);
            }
          }
        }
        return json({ ok: true }, 200, origin);
      }

      if (url.pathname === "/paypal-webhook" && request.method === "POST") {
        const body = await request.json();
        const verified = await verifyPaypalWebhook(env, request.headers, body);
        if (!verified) return json({ error: "Signatur ungueltig" }, 400, origin);
        if (body.event_type === "PAYMENT.CAPTURE.COMPLETED") {
          const itemId = body.resource?.custom_id;
          if (itemId) await markSold(env, itemId, body.resource?.supplementary_data?.related_ids?.order_id);
        }
        return json({ ok: true }, 200, origin);
      }

      if (url.pathname === "/rental-request" && request.method === "POST") {
        // Nur echte Disorder119-Seiten duerfen Anfragen anlegen - keine
        // beliebige Website darf hier Datensaetze in unser Repo schreiben.
        if (!isAllowedOrigin(origin)) return json({ error: "Origin nicht erlaubt." }, 403, origin);
        const body = await request.json();
        const itemId = body.itemId;
        const start = String(body.start || "");
        const end = String(body.end || "");
        const purpose = String(body.purpose || "other").slice(0, 40);
        const message = String(body.message || "").slice(0, 2000);
        if (!itemId || !start || !end) return json({ error: "Fehlende Angaben." }, 400, origin);
        const days = rentalDayCount(start, end);
        if (!days || days < 1) return json({ error: "Ungueltiger Zeitraum." }, 400, origin);
        // Server-seitig gegen den echten Katalog pruefen statt dem Client zu
        // vertrauen - derselbe Grundsatz wie beim Kaufpreis in /create-order.
        const item = await findItem(env, itemId);
        if (!item) return json({ error: "Unbekannter Artikel." }, 404, origin);
        const record = {
          id: crypto.randomUUID(),
          itemId: item.id,
          itemTitle: `${item.brand || ""} ${item.title}`.trim(),
          articleNo: item.article || item.id,
          start,
          end,
          days,
          purpose,
          message,
          status: "new",
          createdAt: new Date().toISOString(),
        };
        await appendRentalRequest(env, record);
        return json({ ok: true }, 200, origin);
      }

      if (url.pathname === "/rental-requests" && request.method === "GET") {
        if (!isAdminAuthorized(request, env)) return json({ error: "Nicht autorisiert." }, 401, origin);
        const { requests } = await loadRentalRequests(env);
        return json({ requests }, 200, origin);
      }

      // /rental-request/<id> - Status im Admin-Dashboard aendern (z.B. "new"
      // -> "contacted" -> "done"), damit bearbeitete Anfragen nicht jedes Mal
      // neu durchsucht werden muessen.
      if (url.pathname.startsWith("/rental-request/") && request.method === "PATCH") {
        if (!isAdminAuthorized(request, env)) return json({ error: "Nicht autorisiert." }, 401, origin);
        const id = url.pathname.slice("/rental-request/".length);
        const body = await request.json();
        const status = String(body.status || "");
        if (["new", "contacted", "done"].indexOf(status) === -1) {
          return json({ error: "Ungueltiger Status." }, 400, origin);
        }
        const { requests, sha } = await loadRentalRequests(env);
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
      }

      return json({ error: "Not found" }, 404, origin);
    } catch (err) {
      console.error(err);
      return json({ error: err.message }, 500, origin);
    }
  },
};
