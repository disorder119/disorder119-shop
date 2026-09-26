import assert from "node:assert/strict";
import test from "node:test";

import { findValidCoupon } from "./game-rewards.js";
import { CONSENT_TEXT, RESEND_PAUSE_MINUTES, handleNewsletter } from "./newsletter.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const SHOP = "https://disorder119.com";
const ADMIN = "https://admin.disorder119.com";

// Brevo abfangen: Mails und Listen-Aufrufe landen in `calls`.
function brevoStub() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    const method = init.method || "GET";
    calls.push({ url: String(url), method, body });
    const path = String(url).replace("https://api.brevo.com/v3", "");
    const antwort = (data, status = 200) => new Response(JSON.stringify(data), { status });
    if (path === "/smtp/email") return antwort({ messageId: `<m${calls.length}@brevo>` }, 201);
    if (path.startsWith("/contacts/lists?") && method === "GET") return antwort({ lists: [{ id: 3, name: "Alte Liste", folderId: 1 }], count: 1 });
    if (path.startsWith("/contacts/folders?") && method === "GET") return antwort({ folders: [{ id: 1, name: "Your first folder" }], count: 1 });
    if (path === "/contacts/lists" && method === "POST") return antwort({ id: 12 }, 201);
    if (path === "/contacts" && method === "POST") return antwort({ id: 99 }, 201);
    return new Response(null, { status: 204 });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function env(extra = {}) {
  return { DB: sqliteD1(allMigrations()), MAIL_API_KEY: "test-key", MAIL_FROM: "kontakt@disorder119.com", ...extra };
}

function post(path, body, origin = SHOP) {
  return new Request(`https://api.disorder119.com${path}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
    body: JSON.stringify(body),
  });
}

async function call(request, e) {
  const res = await handleNewsletter(request, e, new URL(request.url), "t", request.headers.get("Origin"));
  return { status: res.status, data: await res.json().catch(() => null), res };
}

const mails = calls => calls.filter(c => c.url.endsWith("/v3/smtp/email"));
const tokenFrom = (mail, param) => new RegExp(`[?&]${param}=([0-9a-f]{64})`).exec(mail.body.textContent)?.[1];

test("Anmeldung, Bestaetigung mit Code, Abmeldung", async () => {
  const brevo = brevoStub();
  try {
    const e = env({ NEWSLETTER_LIST_ID: "7" });
    let r = await call(post("/newsletter/subscribe", { email: " Kundin@Example.com ", consent: true, lang: "de", source: "footer" }), e);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { ok: true });
    assert.equal(r.res.headers.get("Access-Control-Allow-Origin"), SHOP);

    const row = await e.DB.prepare("SELECT * FROM newsletter_subscribers").first();
    assert.equal(row.email_normalized, "kundin@example.com");
    assert.equal(row.status, "PENDING");
    assert.equal(row.consent_text, CONSENT_TEXT.de);
    assert.equal(row.source, "footer");
    assert.ok(row.request_ip_hash && !row.request_ip_hash.includes("203.0.113.7"));

    const [bestaetigung] = mails(brevo.calls);
    assert.equal(bestaetigung.body.to[0].email, "kundin@example.com");
    assert.match(bestaetigung.body.subject, /bestätige/);
    const token = tokenFrom(bestaetigung, "bestaetigen");
    assert.ok(token, "Bestätigungslink fehlt");
    assert.match(bestaetigung.body.textContent, /https:\/\/disorder119\.com\/newsletter\/\?bestaetigen=/);

    r = await call(post("/newsletter/confirm", { token }), e);
    assert.equal(r.status, 200);
    assert.equal(r.data.confirmed, true);
    assert.match(r.data.couponCode, /^D119-10-[A-Z0-9]{10}$/);
    assert.equal(r.data.discountPercent, 10);
    const coupon = await findValidCoupon(e, r.data.couponCode);
    assert.equal(coupon.discount_bps, 1000);
    assert.equal(coupon.username_key, "newsletter");

    const liste = brevo.calls.find(c => c.url === "https://api.brevo.com/v3/contacts");
    assert.deepEqual(liste.body, { email: "kundin@example.com", listIds: [7], updateEnabled: true });

    const willkommen = mails(brevo.calls)[1];
    assert.ok(willkommen.body.textContent.includes(r.data.couponCode));
    const abmelden = tokenFrom(willkommen, "abmelden");
    assert.ok(abmelden, "Abmeldelink fehlt");

    // Zweiter Klick auf denselben Link: kein zweiter Code, keine zweite Mail.
    r = await call(post("/newsletter/confirm", { token }), e);
    assert.deepEqual(r.data, { ok: true, alreadyConfirmed: true, lang: "de" });
    assert.equal((await e.DB.prepare("SELECT COUNT(*) AS n FROM reward_coupons").first()).n, 1);
    assert.equal(mails(brevo.calls).length, 2);

    r = await call(post("/newsletter/unsubscribe", { token: abmelden }), e);
    assert.equal(r.status, 200);
    assert.equal(r.data.unsubscribed, true);
    assert.equal((await e.DB.prepare("SELECT status FROM newsletter_subscribers").first()).status, "UNSUBSCRIBED");
    assert.ok(brevo.calls.some(c => c.url.endsWith("/v3/contacts/lists/7/contacts/remove")));

    // Nach der Abmeldung gilt der alte Bestaetigungslink nicht mehr.
    r = await call(post("/newsletter/confirm", { token }), e);
    assert.equal(r.status, 404);
  } finally {
    brevo.restore();
  }
});

test("Den Rabatt gibt es pro Adresse nur einmal", async () => {
  const brevo = brevoStub();
  try {
    const e = env();
    await call(post("/newsletter/subscribe", { email: "a@example.com", consent: true }), e);
    let token = tokenFrom(mails(brevo.calls)[0], "bestaetigen");
    let r = await call(post("/newsletter/confirm", { token }), e);
    const abmelden = tokenFrom(mails(brevo.calls)[1], "abmelden");
    await call(post("/newsletter/unsubscribe", { token: abmelden }), e);

    await call(post("/newsletter/subscribe", { email: "a@example.com", consent: true, lang: "en" }), e);
    const erneut = mails(brevo.calls)[2];
    assert.match(erneut.body.subject, /confirm/i);
    token = tokenFrom(erneut, "bestaetigen");
    r = await call(post("/newsletter/confirm", { token }), e);
    assert.equal(r.data.confirmed, true);
    assert.equal(r.data.couponCode, "");
    assert.equal((await e.DB.prepare("SELECT COUNT(*) AS n FROM reward_coupons").first()).n, 1);
    assert.equal(mails(brevo.calls).length, 3, "ohne neuen Code keine Willkommensmail");
  } finally {
    brevo.restore();
  }
});

test("Brevo-Liste richtet sich beim ersten Mal selbst ein", async () => {
  const brevo = brevoStub();
  try {
    const e = env();
    for (const adresse of ["f@example.com", "g@example.org"]) {
      await call(post("/newsletter/subscribe", { email: adresse, consent: true }), e);
      const bestaetigung = mails(brevo.calls).filter(m => m.body.to[0].email === adresse)[0];
      await call(post("/newsletter/confirm", { token: tokenFrom(bestaetigung, "bestaetigen") }), e);
    }
    const angelegt = brevo.calls.filter(c => c.url === "https://api.brevo.com/v3/contacts/lists" && c.method === "POST");
    assert.equal(angelegt.length, 1, "Liste nur einmal anlegen");
    assert.deepEqual(angelegt[0].body, { name: "Newsletter DISORDER119", folderId: 1 });
    assert.equal((await e.DB.prepare("SELECT value FROM site_settings WHERE key='newsletter_list_id'").first()).value, "12");
    const kontakte = brevo.calls.filter(c => c.url === "https://api.brevo.com/v3/contacts");
    assert.deepEqual(kontakte.map(c => c.body.listIds), [[12], [12]]);
    assert.equal((await e.DB.prepare("SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE brevo_synced_at IS NOT NULL").first()).n, 2);
  } finally {
    brevo.restore();
  }
});

test("Einwilligung und gueltige Adresse sind Pflicht", async () => {
  const brevo = brevoStub();
  try {
    const e = env();
    let r = await call(post("/newsletter/subscribe", { email: "a@example.com" }), e);
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "CONSENT_REQUIRED");
    r = await call(post("/newsletter/subscribe", { email: "kein-at", consent: true }), e);
    assert.equal(r.data.error, "INVALID_EMAIL");
    r = await call(post("/newsletter/subscribe", { email: "a@example.com", consent: "ja" }), e);
    assert.equal(r.data.error, "CONSENT_REQUIRED");
    assert.equal(mails(brevo.calls).length, 0);
  } finally {
    brevo.restore();
  }
});

test("Gleiche Antwort ohne neue Mail: kurz hintereinander und schon bestaetigt", async () => {
  const brevo = brevoStub();
  try {
    const e = env();
    await call(post("/newsletter/subscribe", { email: "b@example.com", consent: true }), e);
    let r = await call(post("/newsletter/subscribe", { email: "b@example.com", consent: true }), e);
    assert.deepEqual(r.data, { ok: true });
    assert.equal(mails(brevo.calls).length, 1, `innerhalb von ${RESEND_PAUSE_MINUTES} Minuten keine zweite Mail`);

    const token = tokenFrom(mails(brevo.calls)[0], "bestaetigen");
    await call(post("/newsletter/confirm", { token }), e);
    const vorher = mails(brevo.calls).length;
    r = await call(post("/newsletter/subscribe", { email: "b@example.com", consent: true }), e);
    assert.deepEqual(r.data, { ok: true });
    assert.equal(mails(brevo.calls).length, vorher);
  } finally {
    brevo.restore();
  }
});

test("Abgelaufener und falscher Link", async () => {
  const brevo = brevoStub();
  try {
    const e = env();
    await call(post("/newsletter/subscribe", { email: "c@example.com", consent: true }), e);
    const token = tokenFrom(mails(brevo.calls)[0], "bestaetigen");
    await e.DB.prepare("UPDATE newsletter_subscribers SET confirm_expires_at='2000-01-01T00:00:00.000Z'").run();
    let r = await call(post("/newsletter/confirm", { token }), e);
    assert.equal(r.status, 410);
    assert.equal(r.data.error, "NEWSLETTER_LINK_EXPIRED");
    r = await call(post("/newsletter/confirm", { token: "f".repeat(64) }), e);
    assert.equal(r.status, 404);
    r = await call(post("/newsletter/unsubscribe", { token: "nix" }), e);
    assert.equal(r.status, 404);
  } finally {
    brevo.restore();
  }
});

test("Schreibweisen desselben Postfachs bekommen keinen zweiten Code", async () => {
  const brevo = brevoStub();
  try {
    const e = env();
    await call(post("/newsletter/subscribe", { email: "Max.Muster+shop@googlemail.com", consent: true }), e);
    const token = tokenFrom(mails(brevo.calls)[0], "bestaetigen");
    const r = await call(post("/newsletter/confirm", { token }), e);
    assert.match(r.data.couponCode, /^D119-10-/);

    for (const variante of ["maxmuster@gmail.com", "m.a.x.muster+2@gmail.com", "MAXMUSTER@GOOGLEMAIL.COM"]) {
      const antwort = await call(post("/newsletter/subscribe", { email: variante, consent: true }), e);
      assert.deepEqual(antwort.data, { ok: true }, "Antwort bleibt gleich");
    }
    assert.equal(mails(brevo.calls).length, 2, "nur Bestätigung und Willkommen der ersten Anmeldung");
    assert.equal((await e.DB.prepare("SELECT COUNT(*) AS n FROM newsletter_subscribers").first()).n, 1);
    assert.equal((await e.DB.prepare("SELECT COUNT(*) AS n FROM reward_coupons").first()).n, 1);

    // Andere Anbieter: nur der Plus-Anhang faellt weg, Punkte zaehlen.
    await call(post("/newsletter/subscribe", { email: "max.muster+x@web.de", consent: true }), e);
    await call(post("/newsletter/subscribe", { email: "max.muster@web.de", consent: true }), e);
    assert.equal((await e.DB.prepare("SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE email_canonical='max.muster@web.de'").first()).n, 1);
  } finally {
    brevo.restore();
  }
});

test("Wegwerf-Adressen werden abgelehnt", async () => {
  const brevo = brevoStub();
  try {
    const e = env();
    const r = await call(post("/newsletter/subscribe", { email: "rabatt@mailinator.com", consent: true }), e);
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "DISPOSABLE_EMAIL");
    assert.equal(mails(brevo.calls).length, 0);
  } finally {
    brevo.restore();
  }
});

test("Pro Anschluss hoechstens zwei Codes in 30 Tagen", async () => {
  const brevo = brevoStub();
  try {
    const e = env();
    const ergebnisse = [];
    for (const adresse of ["eins@example.com", "zwei@example.com", "drei@example.com"]) {
      await call(post("/newsletter/subscribe", { email: adresse, consent: true }), e);
      const bestaetigung = mails(brevo.calls).filter(m => m.body.to[0].email === adresse)[0];
      ergebnisse.push((await call(post("/newsletter/confirm", { token: tokenFrom(bestaetigung, "bestaetigen") }), e)).data);
    }
    assert.match(ergebnisse[0].couponCode, /^D119-10-/);
    assert.match(ergebnisse[1].couponCode, /^D119-10-/);
    assert.equal(ergebnisse[2].confirmed, true, "angemeldet ist die dritte Adresse trotzdem");
    assert.equal(ergebnisse[2].couponCode, "");
    assert.equal(ergebnisse[2].couponLimited, true);
    assert.equal((await e.DB.prepare("SELECT COUNT(*) AS n FROM reward_coupons").first()).n, 2);
  } finally {
    brevo.restore();
  }
});

test("Admin-App prueft und entwertet Codes, danach gilt der Code nirgends mehr", async () => {
  const brevo = brevoStub();
  try {
    const e = env({ ADMIN_TOKEN: "sitzung-2" });
    await call(post("/newsletter/subscribe", { email: "e@example.com", consent: true }), e);
    const token = tokenFrom(mails(brevo.calls)[0], "bestaetigen");
    const { couponCode } = (await call(post("/newsletter/confirm", { token }), e)).data;

    const adminPost = (pfad, body) => new Request(`https://api.disorder119.com${pfad}`, {
      method: "POST",
      headers: { Origin: ADMIN, Authorization: "Bearer sitzung-2", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let r = await call(adminPost("/admin/coupons/check", { code: couponCode.toLowerCase() }), e);
    assert.equal(r.status, 200);
    assert.equal(r.data.status, "ACTIVE");
    assert.equal(r.data.source, "newsletter");
    assert.equal(r.data.email, "e@example.com");

    r = await call(adminPost("/admin/coupons/redeem", { code: couponCode, note: "Vinted Jacke" }), e);
    assert.equal(r.data.redeemed, true);
    assert.equal(r.data.status, "REDEEMED");
    assert.equal(r.data.redeemedFor, "MANUELL:Vinted Jacke");
    assert.equal(await findValidCoupon(e, couponCode), null, "Warenkorb und Checkout lehnen ihn ab");

    r = await call(adminPost("/admin/coupons/redeem", { code: couponCode }), e);
    assert.equal(r.data.redeemed, false, "zweites Einlösen geht nicht");
    assert.equal(r.data.status, "REDEEMED");

    r = await call(adminPost("/admin/coupons/check", { code: "D119-10-XXXXXXXXXX" }), e);
    assert.equal(r.status, 404);
    r = await call(adminPost("/admin/coupons/check", { code: "RABATT" }), e);
    assert.equal(r.status, 400);
  } finally {
    brevo.restore();
  }
});

test("Fremde Herkunft wird abgewiesen, Admin-Liste braucht Anmeldung", async () => {
  const brevo = brevoStub();
  try {
    const e = env({ ADMIN_TOKEN: "sitzung-1" });
    let r = await call(post("/newsletter/subscribe", { email: "d@example.com", consent: true }, "https://evil.example"), e);
    assert.equal(r.status, 403);

    await call(post("/newsletter/subscribe", { email: "d@example.com", consent: true }), e);
    const token = tokenFrom(mails(brevo.calls)[0], "bestaetigen");
    await call(post("/newsletter/confirm", { token }), e);

    const adminGet = auth => new Request("https://api.disorder119.com/admin/newsletter", {
      headers: { Origin: ADMIN, ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    });
    r = await call(adminGet(null), e);
    assert.equal(r.status, 401);
    r = await call(adminGet("sitzung-1"), e);
    assert.equal(r.status, 200);
    assert.equal(r.data.confirmed, 1);
    assert.equal(r.data.pending, 0);
    assert.equal(r.data.subscribers[0].email, "d@example.com");
    assert.equal(r.data.subscribers[0].couponRedeemed, false);
    assert.equal(r.res.headers.get("Access-Control-Allow-Origin"), ADMIN);
  } finally {
    brevo.restore();
  }
});
