// PC Manager -> Shop: neue Artikel als Entwurf (manager-katalog.js, Migration 0056).
// Echte SQLite-D1 mit allen Migrationen, GitHub als Nachbau - nichts geht ins Netz.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sqliteD1, allMigrations } from "./test-d1.mjs";
import { handleManagerConnection } from "./manager-connection.js";
import { baueEntwurf, kategorie, pruefeNeu, webpGroesse } from "./manager-katalog.js";
import { guardRuntimeRequest } from "./backend-runtime.js";

const ORIGIN = "https://admin.disorder119.com";
const hash = v => createHash("sha256").update(v).digest("base64url");
const cookie = "S".repeat(43), verifier = "V".repeat(43), state = "T".repeat(43), redirect = "http://127.0.0.1:54321/callback";
const MAIN = "a".repeat(40), TREE = "b".repeat(40);

const ITEMS = [
  { id: 9641, article: "279", title: "Y-3 Running Jacket", brand: "Y-3", price: 85, public_status: "AVAILABLE", url_slug: "279", gallery: ["assets/img/9641/0.webp"] },
  { id: 9642, article: "280", title: "Y-3 Cargohose", brand: "Y-3", price: 120, public_status: "SOLD", url_slug: "280", gallery: ["assets/img/9642/0.webp"] },
  { id: 9427, article: "72", title: "Jean Paul Gaultier Jeans", brand: "Jean Paul Gaultier", price: 75, public_status: "DRAFT", url_slug: "9427", gallery: [] },
];
const LINKS = { version: 1, description: "Bestätigte Nummern", links: [{ shop_id: 9641, article: "279" }, { shop_id: 9642, article: "280" }, { shop_id: 6184, article: "181" }], excluded_shop_ids: [6042] };
const ITEMS_TEXT = JSON.stringify(ITEMS, null, 2) + "\n";
const LINKS_TEXT = JSON.stringify(LINKS, null, 2) + "\n";

// Minimales WebP mit VP8X-Kopf: Breite/Hoehe frei waehlbar.
function webp(breite = 1200, hoehe = 1600, extra = 64) {
  const b = Buffer.alloc(30 + extra, 0);
  b.write("RIFF", 0); b.writeUInt32LE(22 + extra, 4); b.write("WEBP", 8); b.write("VP8X", 12);
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(breite - 1, 24, 3); b.writeUIntLE(hoehe - 1, 27, 3);
  return b.toString("base64");
}

function env({ sandbox = false, github = true } = {}) {
  const DB = sqliteD1(allMigrations()), now = new Date().toISOString();
  DB.raw.prepare(`INSERT INTO admin_passkeys(id,name,rp_id,public_key_jwk,algorithm,created_at) VALUES('TEST-OWNER','Synthetic owner','admin.disorder119.com','{}',-7,?)`).run(now);
  DB.raw.prepare(`INSERT INTO admin_sessions(id,passkey_id,created_at,expires_at,last_seen_at) VALUES(?,'TEST-OWNER',?,'2099-01-01T00:00:00.000Z',?)`).run(createHash("sha256").update(cookie).digest("hex"), now, now);
  return {
    DB, RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...(github ? { GITHUB_TOKEN: "gh-test" } : {}), ...(sandbox ? { SANDBOX: "1" } : {}),
  };
}

async function call(e, path, body, { owner = false, token, method } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (owner) { headers.Origin = ORIGIN; headers.Cookie = "d119_admin=" + cookie; }
  if (token) headers.Authorization = "Bearer " + token;
  const r = new Request("https://api.disorder119.com" + path, { method: method || (body === undefined ? "GET" : "POST"), headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const response = await handleManagerConnection(r, e, new URL(r.url));
  return { status: response.status, data: response.headers.get("Content-Type")?.includes("json") ? await response.json() : null };
}

async function paired(e, scope) {
  const start = await call(e, "/manager/authorize", { redirect_uri: redirect, state, code_challenge: hash(verifier), code_challenge_method: "S256", device_name: "BUERO PC", ...(scope ? { scope } : {}) });
  assert.equal(start.status, 201);
  const view = await call(e, "/admin/manager/request?id=" + start.data.request_id, undefined, { owner: true });
  assert.equal(view.status, 200);
  const a = await call(e, "/admin/manager/approve", { id: start.data.request_id, confirm: true }, { owner: true });
  assert.equal(a.status, 200);
  const code = new URL(a.data.callback_uri).searchParams.get("code");
  const t = await call(e, "/manager/token", { code, code_verifier: verifier, redirect_uri: redirect });
  assert.equal(t.status, 200);
  return { ...t.data, requested: view.data.scope };
}

// Nachbau der GitHub-Schnittstelle (Git-Daten, Pull Requests, Merge).
function fakeGithub({ items = ITEMS_TEXT, links = LINKS_TEXT, conflicts = 0 } = {}) {
  const calls = [];
  let merges = 0, blobs = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || "GET";
    if (u.hostname === "raw.githubusercontent.com") {
      calls.push({ method, path: u.pathname, raw: true });
      if (u.pathname.endsWith("/data/items.json")) return new Response(items);
      if (u.pathname.endsWith("/config/catalog-number-links.json")) return new Response(links);
      return new Response("fehlt", { status: 404 });
    }
    const path = u.pathname.replace("/repos/disorder119/disorder119-shop", "");
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path, search: u.search, body });
    if (method === "GET" && path === "/git/ref/heads/main") return Response.json({ object: { sha: MAIN } });
    if (method === "GET" && path === `/git/commits/${MAIN}`) return Response.json({ tree: { sha: TREE } });
    if (method === "GET" && path === "/contents/data") return Response.json([{ name: "items.json", type: "file", sha: "1".repeat(40) }]);
    if (method === "GET" && path === "/contents/config") return Response.json([{ name: "catalog-number-links.json", type: "file", sha: "2".repeat(40) }]);
    if (method === "GET" && path === `/git/blobs/${"1".repeat(40)}`) return new Response(items);
    if (method === "GET" && path === `/git/blobs/${"2".repeat(40)}`) return new Response(links);
    if (method === "POST" && path === "/git/blobs") { blobs += 1; return Response.json({ sha: String(blobs).padStart(40, "c") }); }
    if (method === "POST" && path === "/git/trees") return Response.json({ sha: "d".repeat(40) });
    if (method === "POST" && path === "/git/commits") return Response.json({ sha: "e".repeat(40) });
    if (method === "POST" && path === "/git/refs") return Response.json({ ref: body.ref }, { status: 201 });
    if (method === "POST" && path === "/pulls") return Response.json({ number: 400 + merges, html_url: "https://github.com/disorder119/disorder119-shop/pull/400" }, { status: 201 });
    if (method === "PUT" && /^\/pulls\/\d+\/merge$/.test(path)) {
      merges += 1;
      if (merges <= conflicts) return Response.json({ message: "not mergeable" }, { status: 405 });
      return Response.json({ sha: "f".repeat(40), merged: true });
    }
    if (method === "PATCH" && /^\/pulls\/\d+$/.test(path)) return Response.json({ state: "closed" });
    if (method === "DELETE" && path.startsWith("/git/refs/heads/admin/katalog-")) return new Response(null, { status: 204 });
    return new Response(`unerwartet: ${method} ${path}`, { status: 404 });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

const FELDER = { id: 9701, article: "281", title: "y-3 wollmantel schwarz", brand: "y-3", size: "M", color: "Schwarz", condition: "Gut", category: "Jacke / Blazer", price: 240, desc_de: "Schwarzer Wollmantel." };

test("catalog draft approval is its own scope, table and bearer", async () => {
  const e = env();
  const k = await paired(e, "katalog_entwurf");
  assert.equal(k.requested, "katalog_entwurf");
  assert.equal(k.scope, "katalog_entwurf");
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) AS n FROM manager_katalog_grants").get().n, 1);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) AS n FROM manager_dataset_grants").get().n, 0);
  const d = await paired(e);
  assert.equal(d.requested, "shop_dataset_read");
  assert.equal(d.scope, "shop_dataset_read");
  // Der Datensatz-Bearer erreicht keine Katalog-Route, der Katalog-Bearer keinen Datensatz.
  assert.equal((await call(e, "/manager/katalog/pruefen?id=9701&article=281", undefined, { token: d.access_token })).status, 403);
  assert.equal((await call(e, "/manager/dataset.zip?jahr=2026", undefined, { token: k.access_token })).status, 403);
  assert.equal((await call(e, "/manager/status", undefined, { token: k.access_token })).data.scope, "katalog_entwurf");
  // Unbekannte Freigaben werden gar nicht erst angefragt.
  const bad = await call(e, "/manager/authorize", { redirect_uri: redirect, state, code_challenge: hash(verifier), code_challenge_method: "S256", device_name: "PC", scope: "admin" });
  assert.equal(bad.status, 400);
  // Der Besitzer sieht beide Freigaben und kann die Katalog-Freigabe einzeln entfernen.
  const list = await call(e, "/admin/manager/grants", undefined, { owner: true });
  assert.deepEqual(list.data.grants.map(g => g.scope).sort(), ["katalog_entwurf", "shop_dataset_read"]);
  const id = list.data.grants.find(g => g.scope === "katalog_entwurf").id;
  assert.equal((await call(e, "/admin/manager/revoke", { id }, { owner: true })).status, 200);
  assert.equal((await call(e, "/manager/katalog/pruefen?id=9701&article=281", undefined, { token: k.access_token })).status, 401);
  assert.equal((await call(e, "/manager/status", undefined, { token: d.access_token })).status, 200);
});

test("number and id checks never reuse an existing article, route or draft", () => {
  assert.deepEqual(pruefeNeu(ITEMS, LINKS, "9701", "281"), { frei: true });
  assert.equal(pruefeNeu(ITEMS, LINKS, "9701", "280").grund, "NUMMER_SCHON_VERGEBEN");
  assert.equal(pruefeNeu(ITEMS, LINKS, "9701", "72").grund, "NUMMER_SCHON_VERGEBEN");
  // Alte Shop-ID-Adresse (/artikel/6184/ leitet auf #181) und ausgeschlossene IDs bleiben belegt.
  assert.equal(pruefeNeu(ITEMS, LINKS, "9701", "6184").grund, "NUMMER_SCHON_VERGEBEN");
  assert.equal(pruefeNeu(ITEMS, LINKS, "9701", "6042").grund, "NUMMER_SCHON_VERGEBEN");
  assert.equal(pruefeNeu(ITEMS, LINKS, "9642", "281").grund, "ARTIKEL_SCHON_IM_SHOP");
  assert.equal(pruefeNeu(ITEMS, LINKS, "279", "281").grund, "ID_KOLLIDIERT_MIT_ADRESSE");
  assert.equal(pruefeNeu(ITEMS, LINKS, "9427", "72").vorhanden, true);
  assert.throws(() => pruefeNeu(ITEMS, LINKS, "abc", "281"), /ID_UNGUELTIG/);
  assert.throws(() => pruefeNeu(ITEMS, LINKS, "9701", "#281"), /NUMMER_UNGUELTIG/);
  assert.throws(() => pruefeNeu(ITEMS, LINKS, "9701", "0"), /NUMMER_UNGUELTIG/);
});

test("a draft keeps the manager's id and number, maps category and known brand spelling", () => {
  const item = baueEntwurf(ITEMS, FELDER, 3);
  assert.equal(item.id, 9701);
  assert.equal(item.article, "281");
  assert.equal(item.url_slug, "281");
  assert.equal(item.public_status, "DRAFT");
  assert.equal(item.brand, "Y-3");
  assert.equal(item.category, "Jackets");
  assert.equal(item.desc, item.desc_de);
  assert.deepEqual(item.gallery, ["assets/img/9701/0.webp", "assets/img/9701/1.webp", "assets/img/9701/2.webp"]);
  assert.equal(item.look, item.gallery[0]);
  assert.equal(kategorie("Sonstiges"), "");
  assert.equal(kategorie("pants"), "Pants");
  assert.equal(baueEntwurf(ITEMS, { ...FELDER, brand: "Neue Marke" }, 1).brand, "Neue Marke");
  assert.throws(() => baueEntwurf(ITEMS, { ...FELDER, title: " " }, 1), /TITEL_FEHLT/);
  assert.throws(() => baueEntwurf(ITEMS, { ...FELDER, price: -1 }, 1), /PREIS_UNGUELTIG/);
  assert.throws(() => baueEntwurf(ITEMS, FELDER, 0), /GALERIE_UNGUELTIG/);
  // Der Manager kann nie einen sichtbaren Status setzen.
  assert.equal(baueEntwurf(ITEMS, { ...FELDER, public_status: "AVAILABLE" }, 1).public_status, "DRAFT");
});

test("WebP size is read from the header for VP8X, VP8L and VP8", () => {
  assert.deepEqual(webpGroesse(Buffer.from(webp(1600, 1067), "base64")), { breite: 1600, hoehe: 1067 });
  const l = Buffer.alloc(30); l.write("RIFF", 0); l.write("WEBP", 8); l.write("VP8L", 12); l[20] = 0x2f;
  l.writeUInt32LE((799) | (599 << 14), 21);
  assert.deepEqual(webpGroesse(l), { breite: 800, hoehe: 600 });
  const v = Buffer.alloc(30); v.write("RIFF", 0); v.write("WEBP", 8); v.write("VP8 ", 12); v[23] = 0x9d; v[24] = 0x01; v[25] = 0x2a;
  v.writeUInt16LE(1024, 26); v.writeUInt16LE(768, 28);
  assert.deepEqual(webpGroesse(v), { breite: 1024, hoehe: 768 });
});

test("photos: only real WebP up to 1600 px and 0.45 MiB, at most three per request", async () => {
  const e = env(), k = await paired(e, "katalog_entwurf"), gh = fakeGithub();
  try {
    const ok = await call(e, "/manager/katalog/bilder", { id: 9701, bilder: [{ base64: webp() }, { base64: webp(800, 600) }] }, { token: k.access_token });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.bilder.length, 2);
    assert.match(ok.data.bilder[0].sha, /^[0-9a-f]{40}$/);
    assert.match(ok.data.bilder[0].zeichen, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(gh.calls.filter(c => c.method === "POST" && c.path === "/git/blobs").length, 2);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40)]).toString("base64");
    assert.equal((await call(e, "/manager/katalog/bilder", { id: 9701, bilder: [{ base64: png }] }, { token: k.access_token })).data.error, "BILD_KEIN_WEBP");
    assert.equal((await call(e, "/manager/katalog/bilder", { id: 9701, bilder: [{ base64: webp(2000, 1500) }] }, { token: k.access_token })).data.error, "BILD_ZU_GROSS");
    assert.equal((await call(e, "/manager/katalog/bilder", { id: 9701, bilder: [{ base64: webp(1000, 1000, 500 * 1024) }] }, { token: k.access_token })).data.error, "BILD_ZU_GROSS");
    assert.equal((await call(e, "/manager/katalog/bilder", { id: 9701, bilder: Array(4).fill({ base64: webp() }) }, { token: k.access_token })).data.error, "ZU_VIELE_DATEIEN");
    assert.equal(gh.calls.filter(c => c.method === "POST" && c.path === "/git/blobs").length, 2);
  } finally { gh.restore(); }
});

test("a draft becomes one commit through a merged pull request; existing items stay byte-identical", async () => {
  const e = env(), k = await paired(e, "katalog_entwurf"), gh = fakeGithub();
  try {
    const frei = await call(e, "/manager/katalog/pruefen?id=9701&article=281", undefined, { token: k.access_token });
    assert.deepEqual(frei.data, { frei: true });
    const up = await call(e, "/manager/katalog/bilder", { id: 9701, bilder: [{ base64: webp() }, { base64: webp(1000, 1500) }, { base64: webp(900, 1200) }] }, { token: k.access_token });
    const res = await call(e, "/manager/katalog/entwurf", { ...FELDER, bilder: up.data.bilder }, { token: k.access_token });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.pullRequest, 400);
    const tree = gh.calls.find(c => c.path === "/git/trees").body;
    assert.equal(tree.base_tree, TREE);
    const byPath = Object.fromEntries(tree.tree.map(t => [t.path, t]));
    assert.deepEqual(Object.keys(byPath).sort(), ["assets/img/9701/0.webp", "assets/img/9701/1.webp", "assets/img/9701/2.webp", "config/catalog-number-links.json", "data/items.json"]);
    assert.equal(byPath["assets/img/9701/1.webp"].sha, up.data.bilder[1].sha);
    const textBlobs = gh.calls.filter(c => c.method === "POST" && c.path === "/git/blobs" && c.body.encoding === "utf-8").map(c => c.body.content);
    const items = JSON.parse(textBlobs.find(t => t.trimStart().startsWith("[")));
    const links = JSON.parse(textBlobs.find(t => t.trimStart().startsWith("{")));
    assert.equal(textBlobs.find(t => t.trimStart().startsWith("[")).startsWith(ITEMS_TEXT.slice(0, -3)), true);
    assert.deepEqual(items.slice(0, ITEMS.length), ITEMS);
    assert.equal(items.length, ITEMS.length + 1);
    assert.equal(items.at(-1).public_status, "DRAFT");
    assert.deepEqual(links.links.at(-1), { shop_id: 9701, article: "281" });
    assert.deepEqual(links.links.slice(0, -1), LINKS.links);
    assert.equal(links.description, LINKS.description);
    const pr = gh.calls.find(c => c.path === "/pulls" && c.method === "POST").body;
    assert.match(pr.title, /^Manager: neuer Entwurf #281/);
    assert.match(pr.body, /Entwurf/);
  } finally { gh.restore(); }
});

test("photos are bound to grant and id; resending an existing draft changes nothing", async () => {
  const e = env(), k = await paired(e, "katalog_entwurf"), k2 = await paired(e, "katalog_entwurf");
  const gh = fakeGithub();
  try {
    const up = await call(e, "/manager/katalog/bilder", { id: 9701, bilder: [{ base64: webp() }] }, { token: k.access_token });
    // Fremde Artikel-ID, fremde Freigabe oder erfundener Blob: abgelehnt.
    assert.equal((await call(e, "/manager/katalog/entwurf", { ...FELDER, id: 9702, article: "282", bilder: up.data.bilder }, { token: k.access_token })).data.error, "BILD_NICHT_HOCHGELADEN");
    assert.equal((await call(e, "/manager/katalog/entwurf", { ...FELDER, bilder: up.data.bilder }, { token: k2.access_token })).data.error, "BILD_NICHT_HOCHGELADEN");
    assert.equal((await call(e, "/manager/katalog/entwurf", { ...FELDER, bilder: [{ sha: "1".repeat(40), zeichen: up.data.bilder[0].zeichen }] }, { token: k.access_token })).data.error, "BILD_NICHT_HOCHGELADEN");
    assert.equal((await call(e, "/manager/katalog/entwurf", { ...FELDER, bilder: [up.data.bilder[0], up.data.bilder[0]] }, { token: k.access_token })).data.error, "BILD_DOPPELT");
    // Vergebene Nummer: 409, kein Commit.
    const besetzt = await call(e, "/manager/katalog/entwurf", { ...FELDER, article: "280", bilder: up.data.bilder }, { token: k.access_token });
    assert.equal(besetzt.status, 409);
    assert.equal(besetzt.data.error, "NUMMER_SCHON_VERGEBEN");
    assert.equal(gh.calls.some(c => c.path === "/git/commits" && c.method === "POST"), false);
  } finally { gh.restore(); }
  const mitEntwurf = JSON.stringify([...ITEMS, baueEntwurf(ITEMS, FELDER, 1)], null, 2) + "\n";
  const gh2 = fakeGithub({ items: mitEntwurf });
  try {
    const up = await call(e, "/manager/katalog/bilder", { id: 9701, bilder: [{ base64: webp() }] }, { token: k.access_token });
    const nochmal = await call(e, "/manager/katalog/entwurf", { ...FELDER, bilder: up.data.bilder }, { token: k.access_token });
    assert.equal(nochmal.status, 200);
    assert.equal(nochmal.data.vorhanden, true);
    assert.equal(gh2.calls.some(c => c.path === "/git/commits" && c.method === "POST"), false);
  } finally { gh2.restore(); }
});

test("a merge conflict is retried on the new main state", async () => {
  const e = env(), k = await paired(e, "katalog_entwurf"), gh = fakeGithub({ conflicts: 1 });
  try {
    const up = await call(e, "/manager/katalog/bilder", { id: 9701, bilder: [{ base64: webp() }] }, { token: k.access_token });
    const res = await call(e, "/manager/katalog/entwurf", { ...FELDER, bilder: up.data.bilder }, { token: k.access_token });
    assert.equal(res.status, 200);
    assert.equal(gh.calls.filter(c => c.method === "PUT").length, 2);
  } finally { gh.restore(); }
});

test("test shop checks everything but writes nothing to GitHub", async () => {
  const e = env({ sandbox: true, github: false }), k = await paired(e, "katalog_entwurf"), gh = fakeGithub();
  try {
    const up = await call(e, "/manager/katalog/bilder", { id: 9701, bilder: [{ base64: webp() }] }, { token: k.access_token });
    assert.equal(up.status, 200);
    assert.equal(up.data.testshop, true);
    const expected = createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${Buffer.from(webp(), "base64").length}\0`), Buffer.from(webp(), "base64")])).digest("hex");
    assert.equal(up.data.bilder[0].sha, expected);
    const res = await call(e, "/manager/katalog/entwurf", { ...FELDER, bilder: up.data.bilder }, { token: k.access_token });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.testshop, true);
    assert.equal(res.data.entwurf.public_status, "DRAFT");
    assert.ok(res.data.dateien.includes("assets/img/9701/0.webp"));
    assert.equal(gh.calls.every(c => c.raw && c.method === "GET"), true);
    assert.equal((await call(e, "/manager/katalog/pruefen?id=9701&article=280", undefined, { token: k.access_token })).data.grund, "NUMMER_SCHON_VERGEBEN");
  } finally { gh.restore(); }
});

test("only the photo and draft routes may carry larger bodies", async () => {
  const big = JSON.stringify({ id: 9701, bilder: [{ base64: "A".repeat(600 * 1024) }] });
  const guard = path => guardRuntimeRequest(new Request("https://api.disorder119.com" + path, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": String(big.length) }, body: big }), { RATE_LIMITER: { limit: async () => ({ success: true }) } });
  await guard("/manager/katalog/bilder");
  await assert.rejects(() => guard("/manager/token"), /REQUEST_TOO_LARGE/);
  await assert.rejects(() => guard("/manager/katalog/entwurf"), /REQUEST_TOO_LARGE/);
});
