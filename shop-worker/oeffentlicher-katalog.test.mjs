import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KATALOG_ROH,
  katalogNachId,
  katalogQuellen,
  oeffentlichenKatalogLeeren,
  oeffentlicherKatalog,
} from "./oeffentlicher-katalog.js";
import { handleAdminRequest } from "./admin-api.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOP_KATALOG = "https://disorder119.com/data/catalog.json";
const LISTE = [{ id: 6042, article: "42", brand: "Prada", title: "Nylonjacke", gallery: ["assets/img/a/1.webp"], public_status: "AVAILABLE" }];

function zaehler(antwort) {
  const aufrufe = [];
  const fetcher = async (url, init = {}) => {
    aufrufe.push(String(url));
    return antwort(String(url), init);
  };
  return { aufrufe, fetcher };
}

test("Quelle: GitHub main zuerst, disorder119.com nur als Rueckfall", async () => {
  oeffentlichenKatalogLeeren();
  assert.deepEqual(katalogQuellen(), [KATALOG_ROH, SHOP_KATALOG]);
  assert.match(KATALOG_ROH, /^https:\/\/raw\.githubusercontent\.com\/disorder119\/disorder119-shop\/main\/data\/catalog\.json$/);
  const { aufrufe, fetcher } = zaehler(url => url === KATALOG_ROH ? Response.json(LISTE) : new Response("nein", { status: 500 }));
  assert.deepEqual(await oeffentlicherKatalog({ fetcher }), LISTE);
  assert.deepEqual(aufrufe, [KATALOG_ROH]);
});

test("Faellt GitHub aus, kommt der Katalog von der Website", async () => {
  oeffentlichenKatalogLeeren();
  const { aufrufe, fetcher } = zaehler(url => url === KATALOG_ROH ? new Response("weg", { status: 503 }) : Response.json(LISTE));
  assert.deepEqual(await oeffentlicherKatalog({ fetcher }), LISTE);
  assert.deepEqual(aufrufe, [KATALOG_ROH, SHOP_KATALOG]);
});

test("Haengende Quelle wird nach der Frist abgebrochen (kein 39-s-Warten)", async () => {
  oeffentlichenKatalogLeeren();
  const fetcher = (url, init) => new Promise((resolve, reject) => {
    if (url !== KATALOG_ROH) return resolve(Response.json(LISTE));
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
  });
  const start = Date.now();
  assert.deepEqual(await oeffentlicherKatalog({ fetcher, frist: 50 }), LISTE);
  assert.ok(Date.now() - start < 1000);
});

test("Parallele Aufrufe teilen sich einen Abruf, danach aus dem Speicher", async () => {
  oeffentlichenKatalogLeeren();
  const { aufrufe, fetcher } = zaehler(() => Response.json(LISTE));
  const [a, b, c] = await Promise.all([oeffentlicherKatalog({ fetcher }), oeffentlicherKatalog({ fetcher }), katalogNachId({ fetcher })]);
  assert.deepEqual(a, LISTE);
  assert.equal(a, b);
  assert.equal(c.get(6042).brand, "Prada");
  await oeffentlicherKatalog({ fetcher });
  assert.equal(aufrufe.length, 1);
});

test("Ohne Katalog: leere Liste, kein Fehler", async () => {
  oeffentlichenKatalogLeeren();
  const fetcher = async () => { throw new Error("offline"); };
  assert.deepEqual(await oeffentlicherKatalog({ fetcher }), []);
});

test("Inventar laedt Namen auch, wenn disorder119.com aus dem Worker haengt", async () => {
  oeffentlichenKatalogLeeren();
  const original = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const url = String(input?.url || input);
    if (url === KATALOG_ROH) return Promise.resolve(Response.json(LISTE));
    // Gleiche Zone: wie live erst nach ~39 s ein 522 - hier nie.
    return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal.reason)));
  };
  try {
    const DB = sqliteD1(allMigrations());
    await DB.prepare("INSERT INTO inventory (id,item_id,article_no,status,updated_at) VALUES ('inv-1',6042,'42','AVAILABLE',?)")
      .bind(new Date().toISOString()).run();
    const url = new URL("https://api.disorder119.com/admin/inventory");
    const start = Date.now();
    const res = await handleAdminRequest(new Request(url, { headers: { Authorization: "Bearer test" } }), { DB, ADMIN_TOKEN: "test" }, url, "t");
    assert.equal(res.status, 200);
    const daten = await res.json();
    assert.equal(daten.inventory[0].catalog.brand, "Prada");
    assert.ok(Date.now() - start < 1000, "ohne Warten auf disorder119.com");
  } finally {
    globalThis.fetch = original;
    oeffentlichenKatalogLeeren();
  }
});

test("Kein Worker-Modul holt den Katalog direkt von disorder119.com", () => {
  // Erlaubt: das gemeinsame Modul (Rueckfall), versand.js (eigene Liste mit
  // GitHub zuerst, #322) und die Edge-Worker vor der Website selbst.
  const erlaubt = new Set(["oeffentlicher-katalog.js", "versand.js", "storefront-edge.js", "sandbox-edge.js", "storefront-assets.js"]);
  const verstoesse = [];
  for (const name of fs.readdirSync(here)) {
    if (!name.endsWith(".js") || erlaubt.has(name)) continue;
    const text = fs.readFileSync(path.join(here, name), "utf8");
    if (/fetch(?:er)?\s*\(\s*["'`](?:https:\/\/(?:www\.)?disorder119\.com|\$\{[^}]+\})\/data\/catalog\.json/.test(text)) verstoesse.push(name);
    if (/["'`]https:\/\/(?:www\.)?disorder119\.com\/data\/catalog\.json["'`]/.test(text)) verstoesse.push(name);
  }
  assert.deepEqual(verstoesse, []);
});
