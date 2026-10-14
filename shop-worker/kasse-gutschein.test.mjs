// Gutschein im Browser (assets/shop-promos.js + assets/kasse.js): Ein
// eingeloester oder abgelehnter Code darf spaetere Kaeufe nicht blockieren.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const PROMOS = fs.readFileSync(new URL("../assets/shop-promos.js", import.meta.url), "utf8");
const KASSE = fs.readFileSync(new URL("../assets/kasse.js", import.meta.url), "utf8");
const WORKER = "https://api.disorder119.com";
const CODE_KEY = "d119_coupon_code";
const REWARD_KEY = "d119_reward_coupon";
const STUECK = { id: 9428, article: "9428", brand: "Jean Paul Gaultier", title: "Jean Paul Gaultier T-Shirt mit Print Damen Blau", price: 150, public_status: "AVAILABLE", grid_image: "assets/img/a/thumbs/0.webp" };
const VERSAND = { paket: "S", optionen: [{ id: "fest-dhl-S", art: "standard", titel: "DHL Paket", carrier: "DHL", preisCents: 0, tage: 2 }] };

// Knapper DOM-Nachbau: genug fuer shop-promos.js und kasse.js.
function element(tag = "div") {
  return {
    tagName: String(tag).toUpperCase(), children: [], parentNode: null, attributes: {}, dataset: {},
    style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    textContent: "", hidden: false, value: "", checked: false, disabled: false, readOnly: false, className: "", id: "", name: "", type: "",
    elements: [],
    appendChild(kind) { this.children.push(kind); if (kind && typeof kind === "object") kind.parentNode = this; return kind; },
    append(...kinder) { kinder.forEach(kind => this.appendChild(kind)); },
    insertBefore(kind) { return this.appendChild(kind); },
    insertAdjacentElement(_, kind) { return this.appendChild(kind); },
    removeChild(kind) { this.children = this.children.filter(k => k !== kind); return kind; },
    remove() {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
    removeAttribute(k) { delete this.attributes[k]; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    focus() {}, blur() {}, click() {}, scrollIntoView() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }, contains() { return false; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
  };
}

function seite({ store = {}, antworten = {}, search = "" } = {}) {
  const speicher = new Map(Object.entries(store));
  const anfragen = [];
  const ids = new Map();
  const body = element("body");
  const document = {
    documentElement: Object.assign(element("html"), { lang: "de" }), head: element("head"), body,
    activeElement: null, readyState: "complete", cookie: "",
    getElementById(id) {
      if (!ids.has(id)) ids.set(id, Object.assign(element("div"), { id, parentNode: body }));
      return ids.get(id);
    },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement: element, createTextNode: text => ({ textContent: String(text) }),
    addEventListener() {}, removeEventListener() {},
  };
  const localStorage = {
    getItem: k => (speicher.has(k) ? speicher.get(k) : null),
    setItem: (k, v) => { speicher.set(k, String(v)); },
    removeItem: k => { speicher.delete(k); },
  };
  // Netz-Nachbau: der Pfad bestimmt die Antwort (Funktion, damit jede
  // Anfrage eine frische Response bekommt).
  async function fetch(url, init = {}) {
    const ziel = String(url);
    anfragen.push({ ziel, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    const pfad = ziel.startsWith(WORKER) ? new URL(ziel).pathname : ziel;
    const antwort = antworten[pfad];
    if (!antwort) return new Response("{}", { status: 404 });
    return antwort();
  }
  const kontext = {
    document, localStorage, fetch, Response, URL, URLSearchParams, console,
    location: { search, pathname: "/kasse/", href: "https://disorder119.com/kasse/" + search },
    navigator: {}, history: { replaceState() {} }, addEventListener() {}, removeEventListener() {},
    setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0,
    MutationObserver: class { observe() {} disconnect() {} },
    SHOP_CONFIG: { shopWorkerUrl: WORKER, paypalClientId: "test", features: { paypalCheckout: true }, email: "shop@example.com" },
    KASSE_LANG: "de",
    D119Schutz: { schluessel: zweck => `${zweck}:${anfragen.length}-0000000000000000`, waechter: () => ({ token: () => Promise.resolve("token") }) },
  };
  kontext.window = kontext;
  kontext.paypal = { Buttons(zahlung) { kontext.zahlung = zahlung; return { render() { return Promise.resolve(); } }; } };
  vm.createContext(kontext);
  return { kontext, speicher, anfragen, document, laden: quelle => vm.runInContext(quelle, kontext) };
}

const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const json = (daten, status = 200) => () => Response.json(daten, { status });
const spielcode = code => JSON.stringify({ code, game: "zero-g-runway", issuedAt: 1, server: true });

test("rejected coupon (COUPON_INVALID_OR_USED) is forgotten in both keys, the next order goes without it", async () => {
  const s = seite({
    store: { [CODE_KEY]: "D119-SPIEL", [REWARD_KEY]: spielcode("D119-SPIEL") },
    antworten: { "/create-order": json({ error: "COUPON_INVALID_OR_USED", requestId: "r1" }, 409) },
  });
  s.laden(PROMOS);
  const res = await s.kontext.fetch(`${WORKER}/create-order`, { method: "POST", body: JSON.stringify({ itemIds: [9428] }) });
  assert.equal(res.status, 409, "die Kasse bekommt die Antwort unveraendert");
  assert.equal((await res.json()).error, "COUPON_INVALID_OR_USED");
  assert.equal(s.anfragen[0].body.couponCode, "D119-SPIEL");
  assert.equal(s.speicher.has(CODE_KEY), false);
  assert.equal(s.speicher.has(REWARD_KEY), false, "sonst schreibt der Warenkorb den Spielcode zurueck");
  await s.kontext.fetch(`${WORKER}/create-order`, { method: "POST", body: JSON.stringify({ itemIds: [9428] }) });
  assert.equal(Object.hasOwn(s.anfragen[1].body, "couponCode"), false);
});

test("other checkout errors keep the coupon", async () => {
  const s = seite({
    store: { [CODE_KEY]: "D119-NEWS" },
    antworten: { "/create-order": json({ error: "ITEM_UNAVAILABLE" }, 409), "/capture-order": json({ error: "RESERVATION_EXPIRED" }, 409) },
  });
  s.laden(PROMOS);
  await s.kontext.fetch(`${WORKER}/create-order`, { method: "POST", body: "{}" });
  await s.kontext.fetch(`${WORKER}/capture-order`, { method: "POST", body: "{}" });
  assert.equal(s.speicher.get(CODE_KEY), "D119-NEWS");
});

test("after a successful payment the redeemed code is removed; a different unused game code stays", async () => {
  const s = seite({
    store: { [CODE_KEY]: "D119-NEWS", [REWARD_KEY]: spielcode("D119-SPIEL") },
    antworten: { "/capture-order": json({ ok: true, orderNumber: "D119-1", zahlung: "RESERVIERT" }) },
  });
  s.laden(PROMOS);
  await s.kontext.fetch(`${WORKER}/capture-order`, { method: "POST", body: "{}" });
  assert.equal(s.speicher.has(CODE_KEY), false);
  assert.equal(JSON.parse(s.speicher.get(REWARD_KEY)).code, "D119-SPIEL");

  const spiel = seite({
    store: { [CODE_KEY]: "D119-SPIEL", [REWARD_KEY]: spielcode("d119-spiel") },
    antworten: { "/capture-order": json({ ok: true }) },
  });
  spiel.laden(PROMOS);
  await spiel.kontext.fetch(`${WORKER}/capture-order`, { method: "POST", body: "{}" });
  assert.equal(spiel.speicher.has(CODE_KEY), false);
  assert.equal(spiel.speicher.has(REWARD_KEY), false);
});

test("checkout page: a used coupon shows a clear message, disappears from the summary and the retry pays without it", async () => {
  let createAntwort = json({ error: "COUPON_INVALID_OR_USED", requestId: "r2" }, 409);
  const s = seite({
    search: "?artikel=9428",
    store: { [CODE_KEY]: "D119-SPIEL", [REWARD_KEY]: spielcode("D119-SPIEL") },
    antworten: {
      "/data/catalog.json": json([STUECK]),
      "/versand/optionen": json(VERSAND),
      "/create-order": () => createAntwort(),
      "/capture-order": json({ ok: true, orderNumber: "D119-7", zahlung: "RESERVIERT" }),
    },
  });
  s.laden(PROMOS);
  s.laden(KASSE);
  await ruhe();
  const zahlung = s.kontext.zahlung;
  assert.ok(zahlung, "PayPal-Knopf eingerichtet");
  const gutschein = s.document.getElementById("kasseGutschein");
  assert.equal(gutschein.hidden, false);
  assert.match(gutschein.textContent, /D119-SPIEL/);

  const fehler = await zahlung.createOrder().then(() => null, err => err);
  assert.equal(fehler?.code, "COUPON_INVALID_OR_USED");
  zahlung.onError(fehler);
  assert.equal(s.document.getElementById("kasseStatus").textContent,
    "Dein Gutschein ist ungültig oder schon eingelöst – wir haben ihn entfernt. Klick bitte noch einmal auf PayPal, dann bezahlst du ohne Gutschein.");
  assert.equal(gutschein.hidden, true, "kein 'wird verrechnet' mehr");
  assert.equal(s.speicher.has(CODE_KEY), false);
  assert.equal(s.speicher.has(REWARD_KEY), false);

  createAntwort = json({ id: "PAYPAL-1", orderId: "o1", orderNumber: "D119-7", expiresAt: new Date(Date.now() + 900000).toISOString() });
  assert.equal(await zahlung.createOrder(), "PAYPAL-1");
  const zweite = s.anfragen.filter(a => a.ziel.endsWith("/create-order")).at(-1);
  assert.equal(Object.hasOwn(zweite.body, "couponCode"), false, "zweiter Versuch ohne Gutschein");
});

test("checkout page: paying with a coupon removes it, the next visit starts clean", async () => {
  const s = seite({
    search: "?artikel=9428",
    store: { [CODE_KEY]: "D119-NEWS" },
    antworten: {
      "/data/catalog.json": json([STUECK]),
      "/versand/optionen": json(VERSAND),
      "/create-order": json({ id: "PAYPAL-2", orderId: "o2", orderNumber: "D119-8", expiresAt: new Date(Date.now() + 900000).toISOString(), coupon: { applied: true } }),
      "/capture-order": json({ ok: true, orderNumber: "D119-8", zahlung: "RESERVIERT" }),
    },
  });
  s.laden(PROMOS);
  s.laden(KASSE);
  await ruhe();
  const zahlung = s.kontext.zahlung;
  assert.equal(await zahlung.createOrder(), "PAYPAL-2");
  assert.equal(s.anfragen.find(a => a.ziel.endsWith("/create-order")).body.couponCode, "D119-NEWS");
  assert.equal(s.speicher.get(CODE_KEY), "D119-NEWS", "bis zur Zahlung bleibt der Code");
  await zahlung.onApprove({ orderID: "PAYPAL-2" });
  assert.equal(s.speicher.has(CODE_KEY), false);
});
