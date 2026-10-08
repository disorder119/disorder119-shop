import assert from "node:assert/strict";
import test from "node:test";

import workerEntry from "./worker-entry.js";
import { sendMail } from "./customer-mail.js";
import { sendTelegramMessage } from "./notifications.js";
import {
  istSandbox,
  sandboxKatalogCacheLeeren,
  sandboxKatalogLaden,
  sandboxVerkauft,
  sandboxWiederVerfuegbar,
  testshopFetch,
  TESTSHOP_ORIGIN,
} from "./sandbox.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const SANDBOX = { SANDBOX: "1" };

function netz(antworten) {
  const aufrufe = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    aufrufe.push({ url, init });
    for (const [muster, antwort] of antworten) if (url.includes(muster)) return antwort(url, init);
    throw new Error(`unerwarteter fetch: ${url}`);
  };
  return { aufrufe, zurueck: () => { globalThis.fetch = original; } };
}

test("Testmodus nur mit SANDBOX=1", () => {
  assert.equal(istSandbox({ SANDBOX: "1" }), true);
  for (const env of [{}, { SANDBOX: "0" }, { SANDBOX: "true" }, null]) assert.equal(istSandbox(env), false);
});

test("Herkunft des Testshops wird hin und zurueck uebersetzt", async () => {
  let gesehen;
  const weiter = async anfrage => {
    gesehen = anfrage.headers.get("Origin");
    return new Response("{}", { headers: { "Access-Control-Allow-Origin": gesehen } });
  };
  const antwort = await testshopFetch(new Request("https://api-test.disorder119.com/site-status", { headers: { Origin: TESTSHOP_ORIGIN } }), SANDBOX, weiter);
  assert.equal(gesehen, "https://disorder119.com");
  assert.equal(antwort.headers.get("Access-Control-Allow-Origin"), TESTSHOP_ORIGIN);

  const fremd = await testshopFetch(new Request("https://api-test.disorder119.com/site-status", { headers: { Origin: "https://evil.example" } }), SANDBOX, weiter);
  assert.equal(gesehen, "https://evil.example");
  assert.equal(fremd.headers.get("Access-Control-Allow-Origin"), "https://evil.example");
});

test("ueber den echten Eingang: Testshop-Herkunft nur im Testmodus erlaubt", async () => {
  const db = sqliteD1(allMigrations());
  const anfrage = () => new Request("https://api-test.disorder119.com/site-status", { headers: { Origin: TESTSHOP_ORIGIN } });
  const test1 = await workerEntry.fetch(anfrage(), { DB: db, ...SANDBOX }, { waitUntil() {} });
  assert.equal(test1.status, 200);
  assert.equal(test1.headers.get("Access-Control-Allow-Origin"), TESTSHOP_ORIGIN);
  const live = await workerEntry.fetch(anfrage(), { DB: db }, { waitUntil() {} });
  assert.notEqual(live.headers.get("Access-Control-Allow-Origin"), TESTSHOP_ORIGIN);
  // Die Verkauft-Liste gibt es nur im Testmodus.
  const liste = await workerEntry.fetch(new Request("https://api-test.disorder119.com/sandbox/verkauft", { headers: { Origin: TESTSHOP_ORIGIN } }), { DB: db, ...SANDBOX }, { waitUntil() {} });
  assert.deepEqual(await liste.json(), { ok: true, verkauft: [] });
  const liveListe = await workerEntry.fetch(new Request("https://api.disorder119.com/sandbox/verkauft"), { DB: db }, { waitUntil() {} });
  assert.notEqual(liveListe.status, 200);
});

test("Katalog im Testshop: oeffentlicher Stand, Verkauftes nur in D1", async () => {
  const db = sqliteD1(allMigrations());
  const env = { DB: db, ...SANDBOX };
  const n = netz([["raw.githubusercontent.com", () => new Response(JSON.stringify([
    { id: 101, title: "A", public_status: "AVAILABLE", status: "Verfügbar" },
    { id: 102, title: "B", public_status: "AVAILABLE", status: "Verfügbar" },
  ]))]]);
  try {
    sandboxKatalogCacheLeeren();
    await sandboxVerkauft(env, 102);
    const { items } = await sandboxKatalogLaden(env);
    assert.deepEqual(items.map(i => [i.id, i.public_status]), [[101, "AVAILABLE"], [102, "SOLD"]]);
    assert.ok(n.aufrufe.every(a => !a.init?.method || a.init.method === "GET"), "nur lesen, nie schreiben");
    assert.ok(n.aufrufe.every(a => !/api\.github\.com/.test(a.url)), "kein GitHub-Schreibzugriff");
    const wieder = await sandboxWiederVerfuegbar(env, ["102", "999", "x"]);
    assert.deepEqual(wieder.geaendert, [102]);
    const { items: danach } = await sandboxKatalogLaden(env);
    assert.equal(danach.find(i => i.id === 102).public_status, "AVAILABLE");
  } finally {
    n.zurueck();
  }
});

test("Mails im Testshop gehen nur ans eigene Postfach, Telegram mit TEST", async () => {
  const gesendet = [];
  const n = netz([
    ["api.brevo.com", (url, init) => { gesendet.push(JSON.parse(init.body)); return new Response(JSON.stringify({ messageId: "m1" }), { status: 201 }); }],
    ["api.telegram.org", (url, init) => { gesendet.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }],
  ]);
  try {
    const env = { ...SANDBOX, MAIL_API_KEY: "test", MAIL_FROM: "shop@disorder119.com", SANDBOX_MAIL_AN: "inhaber@example.test", MAIL_BCC: "kopie@example.test" };
    const r = await sendMail(env, { to: "kundin@example.test", subject: "Deine Bestellung", text: "Hallo", kopieAnShop: true });
    assert.equal(r.sent, true);
    assert.deepEqual(gesendet[0].to, [{ email: "inhaber@example.test", name: "Testshop" }]);
    assert.equal(gesendet[0].subject, "[TEST] Deine Bestellung");
    assert.equal(gesendet[0].bcc, undefined, "keine Kopie an echte Adressen");
    assert.ok(!JSON.stringify(gesendet[0]).includes("kundin@example.test"));

    const ohneZiel = await sendMail({ ...SANDBOX, MAIL_API_KEY: "test", MAIL_FROM: "shop@disorder119.com" }, { to: "kundin@example.test", subject: "x", text: "y" });
    assert.equal(ohneZiel.sent, false);

    await sendTelegramMessage({ ...SANDBOX, TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "42" }, "Neue Bestellung");
    assert.match(gesendet.at(-1).text, /^🧪 TEST · Neue Bestellung/);
  } finally {
    n.zurueck();
  }
});

test("Health: Testshop ist mit PayPal-Sandbox kassenbereit, ohne GitHub-Schluessel - der echte Shop nicht", async () => {
  const db = sqliteD1(allMigrations());
  const paypal = { PAYPAL_CLIENT_ID: "sb-id", PAYPAL_CLIENT_SECRET: "sb-secret", PAYPAL_WEBHOOK_ID: "WH-1" };
  const health = async env => (await workerEntry.fetch(new Request("https://api-test.disorder119.com/health"), env, { waitUntil() {} })).json();
  const test = await health({ DB: db, ...SANDBOX, ...paypal });
  assert.equal(test.environment, "sandbox");
  assert.equal(test.checkoutReady, true);
  const live = await health({ DB: db, ...paypal, PAYPAL_ENVIRONMENT: "live" });
  assert.equal(live.checkoutReady, false, "live braucht weiter den GitHub-Schluessel");
});
