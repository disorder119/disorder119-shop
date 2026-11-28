// PC Manager -> Shop: anderswo verkaufte Stuecke im Shop auf SOLD (manager-verkauft.js, Migration 0059).
// Echte SQLite-D1 mit allen Migrationen, GitHub und Telegram als Nachbau - nichts geht ins Netz.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { sqliteD1, allMigrations } from "./test-d1.mjs";
import { handleManagerConnection } from "./manager-connection.js";
import { artikelAufloesen, eingabePruefen, telegramText } from "./manager-verkauft.js";

const ORIGIN = "https://admin.disorder119.com";
const hash = v => createHash("sha256").update(v).digest("base64url");
const cookie = "S".repeat(43), verifier = "V".repeat(43), state = "T".repeat(43), redirect = "http://127.0.0.1:54321/callback";
const MAIN = "a".repeat(40), TREE = "b".repeat(40);

const ITEMS = [
  { id: 6216, article: "213", title: "Jean Paul Gaultier Netzshirt Herren Schwarz", brand: "Jean Paul Gaultier", price: 180, status: "Verfügbar", public_status: "AVAILABLE", url_slug: "213" },
  { id: 6217, article: "214", title: "Y-3 Hose Herren Schwarz", brand: "Y-3", price: 90, status: "Verkauft", public_status: "SOLD", url_slug: "214" },
  { id: 6218, article: "215", title: "Prada Loafer Damen Schwarz", brand: "Prada", price: 240, status: "Verfügbar", public_status: "AVAILABLE", url_slug: "215" },
  { id: 9427, article: "72", title: "Jeans", brand: "Jean Paul Gaultier", price: 75, status: "Entwurf", public_status: "DRAFT", url_slug: "9427" },
  { id: 9428, article: "73", title: "Mantel", brand: "Balmain", price: 300, status: "Verborgen", public_status: "DRAFT", hidden_from_shop: true, hidden_previous_status: "AVAILABLE", url_slug: "73" },
  { id: 9382, article: "45", title: "Arc'teryx Jacke", brand: "Arc'teryx", price: 150, status: "Verfügbar", public_status: "AVAILABLE", url_slug: "45" },
  { id: 9402, article: "45", title: "Alter Doppelgaenger", brand: "Arc'teryx", price: 150, status: "Bilder importiert", public_status: "DRAFT", url_slug: "9402" },
  { id: 9374, article: "15-2", title: "Alter Entwurf", brand: "Prada", price: 60, status: "Verkauft", public_status: "DRAFT", url_slug: "9374" },
];
const LINKS = {
  version: 1,
  links: [
    { shop_id: 6216, article: "213" }, { shop_id: 6217, article: "214" }, { shop_id: 6218, article: "215" },
    { shop_id: 9427, article: "72" }, { shop_id: 9428, article: "73" }, { shop_id: 9382, article: "45" },
  ],
  excluded_shop_ids: [9402, 9374],
  retired_links: [{ shop_id: 9373, article: "14" }],
};
const text = value => JSON.stringify(value, null, 2) + "\n";

function env({ sandbox = false, github = true, telegram = true } = {}) {
  const DB = sqliteD1(allMigrations()), now = new Date().toISOString();
  DB.raw.prepare(`INSERT INTO admin_passkeys(id,name,rp_id,public_key_jwk,algorithm,created_at) VALUES('TEST-OWNER','Synthetic owner','admin.disorder119.com','{}',-7,?)`).run(now);
  DB.raw.prepare(`INSERT INTO admin_sessions(id,passkey_id,created_at,expires_at,last_seen_at) VALUES(?,'TEST-OWNER',?,'2099-01-01T00:00:00.000Z',?)`).run(createHash("sha256").update(cookie).digest("hex"), now, now);
  return {
    DB, RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...(github ? { GITHUB_TOKEN: "gh-test" } : {}), ...(sandbox ? { SANDBOX: "1" } : {}),
    ...(telegram ? { TELEGRAM_BOT_TOKEN: "tg-test", TELEGRAM_CHAT_ID: "42" } : {}),
  };
}

async function call(e, path, body, { owner = false, token, method, origin, raw } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (owner) { headers.Origin = ORIGIN; headers.Cookie = "d119_admin=" + cookie; }
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = "Bearer " + token;
  const r = new Request("https://api.disorder119.com" + path, { method: method || (body === undefined ? "GET" : "POST"), headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const response = await handleManagerConnection(r, e, new URL(r.url));
  return { status: response.status, data: response.headers.get("Content-Type")?.includes("json") ? await response.json() : null };
}

async function paired(e, scope) {
  const start = await call(e, "/manager/authorize", { redirect_uri: redirect, state, code_challenge: hash(verifier), code_challenge_method: "S256", device_name: "BUERO PC", ...(scope ? { scope } : {}) });
  assert.equal(start.status, 201, JSON.stringify(start.data));
  const view = await call(e, "/admin/manager/request?id=" + start.data.request_id, undefined, { owner: true });
  assert.equal(view.status, 200);
  const a = await call(e, "/admin/manager/approve", { id: start.data.request_id, confirm: true }, { owner: true });
  assert.equal(a.status, 200);
  const code = new URL(a.data.callback_uri).searchParams.get("code");
  const t = await call(e, "/manager/token", { code, code_verifier: verifier, redirect_uri: redirect });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  return { ...t.data, requested: view.data.scope, request_id: start.data.request_id };
}

// Nachbau von GitHub (Git-Daten-API, Vorspulen von main), raw.githubusercontent und Telegram.
function fakeGithub({ items = ITEMS, links = LINKS, commitFails = false, telegramFails = false, beimCommit = null } = {}) {
  const s = { items: text(items), links: text(links), head: MAIN, version: 1, blobs: new Map(), trees: new Map(), n: 0 };
  const calls = [], commits = [], telegram = [];
  const original = globalThis.fetch;
  const hex = (prefix) => (++s.n).toString(16).padStart(40, prefix);
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || "GET";
    if (u.hostname === "api.telegram.org") {
      telegram.push(JSON.parse(init.body));
      return telegramFails ? Response.json({ ok: false, description: "kaputt" }, { status: 500 }) : Response.json({ ok: true, result: { message_id: 7 } });
    }
    if (u.hostname === "raw.githubusercontent.com") {
      calls.push({ method, path: u.pathname, raw: true });
      if (u.pathname.endsWith("/data/items.json")) return new Response(s.items);
      if (u.pathname.endsWith("/config/catalog-number-links.json")) return new Response(s.links);
      return new Response("fehlt", { status: 404 });
    }
    const path = u.pathname.replace("/repos/disorder119/disorder119-shop", "");
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path, search: u.search, body });
    if (method === "GET" && path === "/git/ref/heads/main") return Response.json({ object: { sha: s.head } });
    if (method === "GET" && path.startsWith("/git/commits/")) return Response.json({ tree: { sha: TREE } });
    if (method === "GET" && path === "/contents/data") return Response.json([{ name: "items.json", type: "file", sha: `items-${s.version}` }]);
    if (method === "GET" && path === "/contents/config") return Response.json([{ name: "catalog-number-links.json", type: "file", sha: "links-1" }]);
    if (method === "GET" && path === `/git/blobs/items-${s.version}`) return new Response(s.items);
    if (method === "GET" && path === "/git/blobs/links-1") return new Response(s.links);
    if (method === "POST" && path === "/git/blobs") { const sha = hex("c"); s.blobs.set(sha, body.content); return Response.json({ sha }); }
    if (method === "POST" && path === "/git/trees") {
      if (commitFails) return new Response("server error", { status: 500 });
      const sha = hex("d"); s.trees.set(sha, body.tree); return Response.json({ sha });
    }
    if (method === "POST" && path === "/git/commits") { beimCommit?.(); const sha = hex("e"); commits.push({ ...body, sha }); return Response.json({ sha }); }
    if (method === "PATCH" && path === "/git/refs/heads/main") {
      const commit = commits.find(c => c.sha === body.sha);
      const entry = s.trees.get(commit.tree).find(t => t.path === "data/items.json");
      s.items = s.blobs.get(entry.sha); s.version += 1; s.head = body.sha;
      return Response.json({ object: { sha: body.sha } });
    }
    return new Response(`unerwartet: ${method} ${path}`, { status: 404 });
  };
  return { calls, commits, telegram, state: s, restore() { globalThis.fetch = original; } };
}

const meldung = (artikelnummer, extra = {}) => ({ artikelnummer, plattform: "vinted", verkauft_am: "2026-11-27", request_id: randomUUID(), ...extra });
const verkauft = (e, token, body) => call(e, "/manager/katalog/verkauft", body, { token });
const anzahl = (e, sql, ...args) => e.DB.raw.prepare(sql).get(...args).n;

// Bestellung im Shop: Lagerstueck + Bestellung + Position (wie die Kasse sie anlegt).
function bestellung(e, itemId, { status = "PAID", inventar = status, nummer = "D119-20261127-TEST" } = {}) {
  const now = new Date().toISOString(), inv = `inv_${itemId}`, order = randomUUID();
  e.DB.raw.prepare(`INSERT OR IGNORE INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
    VALUES (?,?,?,?,?,'EUR','AVAILABLE',1,?)`).run(inv, itemId, String(itemId), inventar, 24000, now);
  e.DB.raw.prepare(`INSERT INTO commerce_orders (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
    VALUES (?,?,?,'EUR',24000,0,24000,?,?)`).run(order, nummer, status, randomUUID(), now);
  e.DB.raw.prepare(`INSERT INTO order_items (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents,quantity,currency)
    VALUES (?,?,?,?,?,'Prada Loafer',24000,1,'EUR')`).run(randomUUID(), order, inv, itemId, String(itemId));
  return order;
}

test("katalog_verkauft is its own scope, request table, grant table and bearer", async () => {
  const e = env(), gh = fakeGithub();
  try {
    const v = await paired(e, "katalog_verkauft");
    assert.equal(v.requested, "katalog_verkauft");
    assert.equal(v.scope, "katalog_verkauft");
    assert.equal(anzahl(e, "SELECT COUNT(*) AS n FROM manager_verkauft_grants"), 1);
    assert.equal(anzahl(e, "SELECT COUNT(*) AS n FROM manager_verkauft_requests"), 1);
    assert.equal(anzahl(e, "SELECT COUNT(*) AS n FROM manager_auth_requests"), 0);
    assert.equal(anzahl(e, "SELECT COUNT(*) AS n FROM manager_katalog_grants") + anzahl(e, "SELECT COUNT(*) AS n FROM manager_dataset_grants"), 0);
    const k = await paired(e, "katalog_entwurf"), d = await paired(e);
    assert.equal(k.scope, "katalog_entwurf");
    assert.equal(d.scope, "shop_dataset_read");
    // Fremde Bearer erreichen die Verkaufsroute nicht - und der Verkaufs-Bearer sonst nichts.
    assert.equal((await verkauft(e, k.access_token, meldung("213"))).status, 403);
    assert.equal((await verkauft(e, d.access_token, meldung("213"))).status, 403);
    assert.equal((await call(e, "/manager/katalog/pruefen?id=9701&article=281", undefined, { token: v.access_token })).status, 403);
    assert.equal((await call(e, "/manager/katalog/entwurf", { id: 9701 }, { token: v.access_token })).status, 403);
    assert.equal((await call(e, "/manager/dataset.zip?jahr=2026", undefined, { token: v.access_token })).status, 403);
    assert.equal((await call(e, "/manager/status", undefined, { token: v.access_token })).data.scope, "katalog_verkauft");
    // Native Regeln wie ueberall: kein Browser-Origin, nur POST, Bearer Pflicht.
    assert.equal((await call(e, "/manager/katalog/verkauft", meldung("213"), { token: v.access_token, origin: ORIGIN })).status, 403);
    assert.equal((await call(e, "/manager/katalog/verkauft", undefined, { token: v.access_token })).status, 405);
    assert.equal((await verkauft(e, undefined, meldung("213"))).status, 401);
    assert.equal(gh.commits.length, 0);
    // Der Besitzer sieht alle drei Freigaben und kann die Verkaufs-Freigabe einzeln entfernen.
    const list = await call(e, "/admin/manager/grants", undefined, { owner: true });
    assert.deepEqual(list.data.grants.map(g => g.scope).sort(), ["katalog_entwurf", "katalog_verkauft", "shop_dataset_read"]);
    const id = list.data.grants.find(g => g.scope === "katalog_verkauft").id;
    assert.equal((await call(e, "/admin/manager/revoke", { id }, { owner: true })).status, 200);
    assert.equal((await verkauft(e, v.access_token, meldung("213"))).status, 401);
    assert.equal((await call(e, "/manager/status", undefined, { token: k.access_token })).status, 200);
    assert.equal((await call(e, "/manager/status", undefined, { token: d.access_token })).status, 200);
  } finally { gh.restore(); }
});

test("verkauft requests: deny, expiry and single-use code work like the other scopes", async () => {
  const e = env();
  const start = await call(e, "/manager/authorize", { redirect_uri: redirect, state, code_challenge: hash(verifier), code_challenge_method: "S256", device_name: "PC", scope: "katalog_verkauft" });
  assert.equal((await call(e, "/admin/manager/deny", { id: start.data.request_id }, { owner: true })).status, 200);
  assert.equal((await call(e, "/admin/manager/request?id=" + start.data.request_id, undefined, { owner: true })).status, 410);
  assert.equal((await call(e, "/admin/manager/approve", { id: start.data.request_id, confirm: true }, { owner: true })).status, 410);
  const g = await paired(e, "katalog_verkauft");
  const again = e.DB.raw.prepare("SELECT used_at FROM manager_verkauft_requests WHERE id=?").get(g.request_id);
  assert.ok(again.used_at);
  // Ein Verkaufs-Antrag kann nie in der alten Tabelle landen (CHECK aus 0056 bleibt).
  assert.throws(() => e.DB.raw.prepare(`INSERT INTO manager_auth_requests(id,device_name,redirect_uri,state,challenge,created_at,expires_at,scope)
    VALUES('x','PC','r','s','c','t','t','katalog_verkauft')`).run(), /CHECK/);
});

test("success: one 'Verkauft: Artikel <shop id>' commit, D1 blocks checkout, audit and Telegram", async () => {
  const e = env(), v = await paired(e, "katalog_verkauft");
  // Waehrend des Commits versucht jemand zu kaufen: dieselbe Reservierung wie reserveForPurchase (worker.js).
  let kasse = null;
  const gh = fakeGithub({ beimCommit() {
    kasse = e.DB.raw.prepare(`INSERT INTO reservations (id,inventory_id,kind,status,idempotency_key,expires_at,created_at)
      SELECT 'kasse',id,'PURCHASE','RESERVED','kasse-2#6216','2099-01-01','2026-11-28' FROM inventory
      WHERE id='inv_6216' AND status='AVAILABLE' AND catalog_status='AVAILABLE'`).run().changes;
  } });
  try {
    const body = meldung("213");
    const res = await verkauft(e, v.access_token, body);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(res.data, { ok: true, status: "SOLD", artikelnummer: "213", shop_id: 6216, bereits: false });
    assert.equal(kasse, 0, "der Halt sperrt die Kasse schon vor dem Commit");
    // Genau der Kassen-Commit: Nachricht, eine Datei, nur die beiden Statuszeilen.
    assert.equal(gh.commits.length, 1);
    assert.equal(gh.commits[0].message, "Verkauft: Artikel 6216");
    assert.deepEqual(gh.commits[0].parents, [MAIN]);
    assert.deepEqual([...gh.state.trees.values()][0].map(t => t.path), ["data/items.json"]);
    assert.equal(gh.calls.some(c => c.path === "/pulls"), false);
    const alt = text(ITEMS).split("\n"), neu = gh.state.items.split("\n");
    assert.equal(neu.length, alt.length);
    assert.deepEqual(alt.map((z, i) => [z, neu[i]]).filter(([a, b]) => a !== b), [
      ['    "status": "Verfügbar",', '    "status": "Verkauft",'],
      ['    "public_status": "AVAILABLE",', '    "public_status": "SOLD",'],
    ]);
    // D1: Lagerstueck gesperrt (die Kasse reserviert nur catalog_status AVAILABLE), kein Halt mehr offen.
    const inv = e.DB.raw.prepare("SELECT status,catalog_status FROM inventory WHERE item_id=6216").get();
    assert.deepEqual({ ...inv }, { status: "AVAILABLE", catalog_status: "SOLD" });
    assert.equal(anzahl(e, "SELECT COUNT(*) AS n FROM reservations WHERE status='RESERVED'"), 0);
    const halt = e.DB.raw.prepare("SELECT status,idempotency_key FROM reservations WHERE inventory_id='inv_6216'").get();
    assert.equal(halt.status, "CANCELLED");
    assert.match(halt.idempotency_key, /^manager-verkauft:/);
    // Protokoll und Meldung an den Inhaber.
    const audit = e.DB.raw.prepare("SELECT * FROM audit_events WHERE event_type='MANAGER_VERKAUFT'").get();
    assert.equal(audit.entity_id, "6216");
    assert.equal(audit.actor_ref, `manager:${v.grant_id}`);
    assert.equal(audit.request_id, body.request_id);
    assert.deepEqual(JSON.parse(audit.metadata_json).plattform, "vinted");
    assert.equal(gh.telegram.length, 1);
    assert.equal(gh.telegram[0].chat_id, "42");
    assert.match(gh.telegram[0].text, /^Manager: Artikel 213 auf Vinted verkauft – im Shop ausgeblendet\n/);
    assert.match(gh.telegram[0].text, /27\.11\.2026/);
  } finally { gh.restore(); }
});

test("idempotency: same request_id returns the same answer without a second effect", async () => {
  const e = env(), v = await paired(e, "katalog_verkauft"), gh = fakeGithub();
  try {
    const body = meldung("213", { plattform: "ebay" });
    const first = await verkauft(e, v.access_token, body);
    const again = await verkauft(e, v.access_token, body);
    assert.equal(again.status, 200);
    assert.deepEqual(again.data, first.data);
    assert.equal(again.data.bereits, false);
    assert.equal(gh.commits.length, 1);
    assert.equal(gh.telegram.length, 1);
    assert.equal(anzahl(e, "SELECT COUNT(*) AS n FROM audit_events WHERE event_type='MANAGER_VERKAUFT'"), 1);
    // Dieselbe request_id mit anderem Inhalt: Fehler des Aufrufers.
    assert.equal((await verkauft(e, v.access_token, { ...body, plattform: "vinted" })).data.error, "request_id_wiederverwendet");
    // Neue request_id fuer dasselbe Stueck: schon verkauft, kein zweiter Commit.
    const neu = await verkauft(e, v.access_token, meldung("213"));
    assert.deepEqual(neu.data, { ok: true, status: "SOLD", artikelnummer: "213", shop_id: 6216, bereits: true });
    assert.equal(gh.commits.length, 1);
    // Gleichzeitig zweimal dieselbe neue Meldung: hoechstens ein Commit.
    const parallel = meldung("45");
    const beide = await Promise.all([verkauft(e, v.access_token, parallel), verkauft(e, v.access_token, parallel)]);
    assert.ok(beide.every(r => r.status === 200 || (r.status === 409 && r.data.error === "in_arbeit")), JSON.stringify(beide));
    assert.equal(gh.commits.filter(c => c.message === "Verkauft: Artikel 9382").length, 1);
    assert.deepEqual((await verkauft(e, v.access_token, parallel)).data, { ok: true, status: "SOLD", artikelnummer: "45", shop_id: 9382, bereits: false });
  } finally { gh.restore(); }
});

test("already sold: 200 bereits, no commit, no Telegram; a stale D1 row is blocked too", async () => {
  const e = env(), v = await paired(e, "katalog_verkauft"), gh = fakeGithub();
  try {
    e.DB.raw.prepare(`INSERT INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
      VALUES ('inv_6217',6217,'214','AVAILABLE',9000,'EUR','AVAILABLE',1,?)`).run(new Date().toISOString());
    const res = await verkauft(e, v.access_token, meldung("214"));
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { ok: true, status: "SOLD", artikelnummer: "214", shop_id: 6217, bereits: true });
    assert.equal(gh.commits.length, 0);
    assert.equal(gh.telegram.length, 0);
    assert.equal(e.DB.raw.prepare("SELECT catalog_status FROM inventory WHERE item_id=6217").get().catalog_status, "SOLD");
    assert.equal(anzahl(e, "SELECT COUNT(*) AS n FROM audit_events WHERE event_type='MANAGER_VERKAUFT_BEREITS'"), 1);
  } finally { gh.restore(); }
});

test("draft, hidden, excluded and retired numbers are not in the shop: nothing to do", async () => {
  const e = env(), v = await paired(e, "katalog_verkauft"), gh = fakeGithub();
  try {
    for (const [nummer, shopId, status] of [["72", 9427, "DRAFT"], ["73", 9428, "DRAFT"], ["15-2", 9374, "DRAFT"], ["14", 9373, "ENTFERNT"]]) {
      const res = await verkauft(e, v.access_token, meldung(nummer));
      assert.equal(res.status, 200, nummer);
      assert.deepEqual(res.data, { ok: true, nicht_im_shop: true, artikelnummer: nummer, shop_id: shopId, status }, nummer);
    }
    assert.equal(gh.commits.length, 0);
    assert.equal(gh.telegram.length, 0);
    assert.equal(anzahl(e, "SELECT COUNT(*) AS n FROM inventory"), 0);
  } finally { gh.restore(); }
});

test("article number maps through the confirmed links, never by arithmetic", () => {
  assert.equal(artikelAufloesen(ITEMS, LINKS, "213").shopId, 6216);
  // #45 gibt es zweimal - der bestaetigte Link gewinnt, die ausgeschlossene ID nie.
  assert.equal(artikelAufloesen(ITEMS, LINKS, "45").shopId, 9382);
  assert.equal(artikelAufloesen(ITEMS, LINKS, "15-2").ausgeschlossen, true);
  assert.deepEqual(artikelAufloesen(ITEMS, LINKS, "14"), { item: null, shopId: 9373 });
  // Ohne Link: Feld "article" im Katalog. Eine Shop-ID ist keine Artikelnummer.
  assert.equal(artikelAufloesen(ITEMS, { links: [] }, "213").shopId, 6216);
  assert.equal(artikelAufloesen(ITEMS, LINKS, "6216"), null);
  assert.equal(artikelAufloesen(ITEMS, LINKS, "999"), null);
});

test("an open shop order or reservation answers 409 in_bestellung and changes nothing", async () => {
  const e = env(), v = await paired(e, "katalog_verkauft"), gh = fakeGithub();
  try {
    const order = bestellung(e, 6218, { status: "PAID" });
    const body = meldung("215");
    const res = await verkauft(e, v.access_token, body);
    assert.equal(res.status, 409);
    assert.deepEqual(res.data, { error: "in_bestellung", bestellung: "D119-20261127-TEST", bestellstatus: "PAID", art: "bestellung" });
    assert.equal(gh.commits.length, 0);
    assert.equal(gh.telegram.length, 0);
    assert.deepEqual({ ...e.DB.raw.prepare("SELECT status,catalog_status FROM inventory WHERE item_id=6218").get() }, { status: "PAID", catalog_status: "AVAILABLE" });
    assert.equal(anzahl(e, "SELECT COUNT(*) AS n FROM audit_events WHERE event_type='MANAGER_VERKAUFT_IN_BESTELLUNG'"), 1);
    // Der Inhaber storniert die Shop-Bestellung - dieselbe Meldung geht jetzt durch.
    const now = new Date().toISOString();
    e.DB.raw.prepare("UPDATE commerce_orders SET status='CANCELLED',updated_at=? WHERE id=?").run(now, order);
    e.DB.raw.prepare("UPDATE inventory SET status='CANCELLED',updated_at=? WHERE item_id=6218").run(now);
    const nachher = await verkauft(e, v.access_token, body);
    assert.equal(nachher.status, 200, JSON.stringify(nachher.data));
    assert.equal(nachher.data.bereits, false);
    assert.equal(gh.commits.length, 1);
  } finally { gh.restore(); }
});

test("double sale after a shop sale: a paid order on a SOLD piece is still 409", async () => {
  const e = env(), v = await paired(e, "katalog_verkauft"), gh = fakeGithub();
  try {
    bestellung(e, 6217, { status: "PREPARING", nummer: "D119-20261126-SHOP" });
    const res = await verkauft(e, v.access_token, meldung("214", { plattform: "sonstige" }));
    assert.equal(res.status, 409);
    assert.equal(res.data.bestellung, "D119-20261126-SHOP");
    assert.equal(res.data.bestellstatus, "PREPARING");
    assert.equal(gh.commits.length, 0);
  } finally { gh.restore(); }
});

test("someone in checkout right now blocks; an expired checkout reservation does not", async () => {
  const e = env(), v = await paired(e, "katalog_verkauft"), gh = fakeGithub();
  try {
    const now = new Date(), stamp = now.toISOString();
    e.DB.raw.prepare(`INSERT INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
      VALUES ('inv_6218',6218,'215','RESERVED',24000,'EUR','AVAILABLE',1,?)`).run(stamp);
    e.DB.raw.prepare(`INSERT INTO reservations (id,inventory_id,kind,status,idempotency_key,expires_at,created_at)
      VALUES ('r1','inv_6218','PURCHASE','RESERVED','kasse-1#6218',?,?)`).run(new Date(now.getTime() + 600000).toISOString(), stamp);
    const res = await verkauft(e, v.access_token, meldung("215"));
    assert.equal(res.status, 409);
    assert.deepEqual(res.data, { error: "in_bestellung", bestellung: null, bestellstatus: "RESERVED", art: "kasse" });
    assert.equal(gh.commits.length, 0);
    e.DB.raw.prepare("UPDATE reservations SET expires_at=? WHERE id='r1'").run(new Date(now.getTime() - 1000).toISOString());
    const spaeter = await verkauft(e, v.access_token, meldung("215"));
    assert.equal(spaeter.status, 200, JSON.stringify(spaeter.data));
    assert.equal(e.DB.raw.prepare("SELECT status FROM reservations WHERE id='r1'").get().status, "EXPIRED");
    assert.equal(gh.commits.length, 1);
  } finally { gh.restore(); }
});

test("an active rental blocks with art miete", async () => {
  const e = env(), v = await paired(e, "katalog_verkauft"), gh = fakeGithub();
  try {
    const stamp = new Date().toISOString();
    e.DB.raw.prepare(`INSERT INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
      VALUES ('inv_6216',6216,'213','RESERVED',18000,'EUR','AVAILABLE',1,?)`).run(stamp);
    e.DB.raw.prepare(`INSERT INTO rental_reservations (id,inventory_id,start_date,end_date,days,daily_price_cents,total_price_cents,status,idempotency_key,expires_at,created_at)
      VALUES ('m1','inv_6216','2026-12-01','2026-12-03',3,1800,5400,'CONFIRMED','miete-1',NULL,?)`).run(stamp);
    const res = await verkauft(e, v.access_token, meldung("213"));
    assert.equal(res.status, 409);
    assert.equal(res.data.art, "miete");
    assert.equal(res.data.bestellstatus, "CONFIRMED");
    assert.equal(gh.commits.length, 0);
  } finally { gh.restore(); }
});

test("unknown number 404, bad bodies 400 - nothing stored", async () => {
  const e = env(), v = await paired(e, "katalog_verkauft"), gh = fakeGithub();
  try {
    const unbekannt = await verkauft(e, v.access_token, meldung("999"));
    assert.equal(unbekannt.status, 404);
    assert.deepEqual(unbekannt.data, { error: "artikel_unbekannt" });
    const gut = meldung("213");
    for (const [feld, body] of [
      ["artikelnummer", { ...gut, artikelnummer: "#213" }], ["artikelnummer", { ...gut, artikelnummer: "0" }], ["artikelnummer", { ...gut, artikelnummer: undefined }],
      ["plattform", { ...gut, plattform: "Vinted" }], ["plattform", { ...gut, plattform: "kleinanzeigen" }],
      ["verkauft_am", { ...gut, verkauft_am: "2026-02-30" }], ["verkauft_am", { ...gut, verkauft_am: "27.11.2026" }], ["verkauft_am", { ...gut, verkauft_am: "2099-01-01" }],
      ["request_id", { ...gut, request_id: "abc" }], ["request_id", { ...gut, request_id: undefined }],
    ]) {
      const res = await verkauft(e, v.access_token, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(res.data, { error: "anfrage_ungueltig", feld });
    }
    for (const raw of ["{kaputt", "[]", "null", "x".repeat(5000)]) {
      assert.equal((await call(e, "/manager/katalog/verkauft", raw, { token: v.access_token, raw: true })).status, 400);
    }
    assert.equal(gh.commits.length, 0);
    assert.equal(anzahl(e, "SELECT COUNT(*) AS n FROM manager_verkauft_meldungen"), 0);
  } finally { gh.restore(); }
});

test("revoked, expired, disconnected or passkey-revoked grants fail closed with 401", async () => {
  for (const mode of ["owner", "expired", "device", "passkey"]) {
    const e = env(), v = await paired(e, "katalog_verkauft"), gh = fakeGithub();
    try {
      if (mode === "owner") assert.equal((await call(e, "/admin/manager/revoke", { id: v.grant_id }, { owner: true })).status, 200);
      if (mode === "expired") e.DB.raw.prepare("UPDATE manager_verkauft_grants SET expires_at='2000-01-01'").run();
      if (mode === "device") assert.equal((await call(e, "/manager/disconnect", {}, { token: v.access_token })).status, 200);
      if (mode === "passkey") e.DB.raw.prepare("UPDATE admin_passkeys SET revoked_at='2000-01-01' WHERE id='TEST-OWNER'").run();
      const res = await verkauft(e, v.access_token, meldung("213"));
      assert.equal(res.status, 401, mode);
      assert.equal(gh.commits.length, 0, mode);
    } finally { gh.restore(); }
  }
  // Frist wie bei den anderen Freigaben: 90 Tage.
  const e = env(), v = await paired(e, "katalog_verkauft");
  const tage = (Date.parse(v.expires_at) - Date.now()) / 86400000;
  assert.ok(tage > 89.9 && tage <= 90, String(tage));
});

test("a failed GitHub commit releases the hold; the same request_id succeeds later", async () => {
  const e = env(), v = await paired(e, "katalog_verkauft"), body = meldung("213");
  const kaputt = fakeGithub({ commitFails: true });
  try {
    const res = await verkauft(e, v.access_token, body);
    assert.equal(res.status, 502);
    assert.equal(res.data.error, "github_nicht_erreichbar");
    assert.deepEqual({ ...e.DB.raw.prepare("SELECT status,catalog_status FROM inventory WHERE item_id=6216").get() }, { status: "AVAILABLE", catalog_status: "AVAILABLE" });
    assert.equal(anzahl(e, "SELECT COUNT(*) AS n FROM reservations WHERE status='RESERVED'"), 0);
    assert.equal(anzahl(e, "SELECT COUNT(*) AS n FROM manager_verkauft_meldungen"), 0);
    assert.equal(kaputt.telegram.length, 0);
  } finally { kaputt.restore(); }
  const gh = fakeGithub();
  try {
    const res = await verkauft(e, v.access_token, body);
    assert.equal(res.status, 200);
    assert.equal(res.data.bereits, false);
    assert.equal(gh.commits.length, 1);
  } finally { gh.restore(); }
});

test("Telegram failing or missing never fails the sale", async () => {
  for (const variante of ["fehler", "ohne"]) {
    const e = env({ telegram: variante === "fehler" }), v = await paired(e, "katalog_verkauft");
    const gh = fakeGithub({ telegramFails: true });
    try {
      const res = await verkauft(e, v.access_token, meldung("213"));
      assert.equal(res.status, 200, variante);
      assert.equal(res.data.bereits, false);
      assert.equal(gh.telegram.length, variante === "fehler" ? 1 : 0);
    } finally { gh.restore(); }
  }
});

test("test shop: public catalog, sold only in D1, nothing written to GitHub", async () => {
  const e = env({ sandbox: true, github: false, telegram: false }), v = await paired(e, "katalog_verkauft"), gh = fakeGithub();
  try {
    const res = await verkauft(e, v.access_token, meldung("213"));
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(res.data, { ok: true, status: "SOLD", artikelnummer: "213", shop_id: 6216, bereits: false, testshop: true });
    assert.equal(gh.calls.every(c => c.raw && c.method === "GET"), true);
    assert.equal(e.DB.raw.prepare("SELECT item_id FROM sandbox_verkauft").get().item_id, "6216");
    const nochmal = await verkauft(e, v.access_token, meldung("213"));
    assert.equal(nochmal.data.bereits, true);
  } finally { gh.restore(); }
});

test("pure checks: body validation and the Telegram line", () => {
  const jetzt = new Date("2026-11-28T10:00:00Z");
  const ok = eingabePruefen({ artikelnummer: 213, plattform: "sonstige", verkauft_am: "2026-11-29", request_id: "0F8FAD5B-D9CB-469F-A165-70867728950E" }, jetzt);
  assert.deepEqual(ok, { artikelnummer: "213", plattform: "sonstige", verkauftAm: "2026-11-29", requestId: "0f8fad5b-d9cb-469f-a165-70867728950e" });
  assert.throws(() => eingabePruefen({ ...ok, artikelnummer: "213", verkauft_am: "2026-11-30", request_id: randomUUID() }, jetzt), /anfrage_ungueltig/);
  assert.equal(telegramText({ artikelnummer: "213", plattform: "sonstige", verkauftAm: "2026-11-27" }, ITEMS[0]),
    "Manager: Artikel 213 auf einer anderen Plattform verkauft – im Shop ausgeblendet\nJean Paul Gaultier Netzshirt Herren Schwarz · verkauft am 27.11.2026");
});
