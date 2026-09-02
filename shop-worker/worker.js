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
 * Noetige Secrets (per `wrangler secret put NAME` setzen, s. README.md):
 *   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID  (developer.paypal.com)
 *   DHL_API_KEY, DHL_API_SECRET, DHL_EKP, DHL_BILLING_NUMBER   (developer.dhl.com)
 *   GITHUB_TOKEN   (fein granulares PAT, nur "Contents: Read & write" auf
 *                    dieses eine Repo - siehe README.md)
 *
 * Nicht-geheime Konfiguration (unten in CONFIG):
 *   GITHUB_REPO, PAYPAL_API_BASE (sandbox waehrend des Testens, live danach)
 */

const CONFIG = {
  githubOwner: "disorder119",
  githubRepo: "disorder119-shop",
  githubBranch: "main",
  itemsPath: "data/items.json",
  // https://api-m.sandbox.paypal.com waehrend des Testens,
  // https://api-m.paypal.com sobald es mit echtem Geld laufen soll.
  paypalApiBase: "https://api-m.sandbox.paypal.com",
  currency: "EUR",
};

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
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

      return json({ error: "Not found" }, 404, origin);
    } catch (err) {
      console.error(err);
      return json({ error: err.message }, 500, origin);
    }
  },
};
