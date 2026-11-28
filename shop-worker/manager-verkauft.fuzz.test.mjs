// Fuzzing der Verkaufsmeldung des PC Managers: POST /manager/katalog/verkauft
// (manager-verkauft.js, Freigabe katalog_verkauft, Migration 0059).
//
// Laeuft NUR lokal/CI und nur im Prozess: der echte Worker (worker-entry.js)
// mit echter SQLite-D1 aller Migrationen. GitHub (Git-Daten-API mit echtem
// Vorspulen: ein Push, der main nicht vorspult, bekommt 422),
// raw.githubusercontent und Telegram sind Nachbauten. Jede andere Adresse -
// auch api.disorder119.com - wirft sofort: nie gegen den Live- oder Testshop
// (der Waechter sperrt sonst den eigenen Anschluss).
//
// Geprueft wird nach jeder Antwort:
//  - nie 5xx ausser 502 github_nicht_erreichbar / 503 (nicht eingerichtet)
//  - nie SOLD fuer unbekannte oder mehrdeutige Nummern, nie fuer ein Stueck in
//    offener Bestellung, Miete oder Kasse - auch wenn Kasse oder Miete mitten
//    im Ablauf zugreifen (jeder Zwischenschritt einzeln)
//  - hoechstens ein "Verkauft: Artikel N"-Commit je Stueck auf main, und jeder
//    besteht die Pruefung des Main-Waechters (scripts/main_provenance.py:
//    Nachricht, eine Datei, nur die Statuszeilen genau dieses Stuecks)
//  - eine fertige 200 mit derselben request_id kommt bytegleich wieder
//  - der Halt (Reservierung "manager-verkauft:") ist nach jeder Antwort frei
//  - keine Tokens, Stacktraces, SQL-Fehler, Pfade oder Kundendaten in Antworten
//
// Umfang: D119_VERKAUFT_RUNDEN (Standard 260), Seed D119_FUZZ_SEED (Standard 458).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import worker from "./worker-entry.js";
import { sqliteD1, allMigrations } from "./test-d1.mjs";
import { HALT_PREFIX } from "./manager-verkauft.js";
import { sandboxKatalogCacheLeeren } from "./sandbox.js";

const SEED = Number(process.env.D119_FUZZ_SEED || 458);
const RUNDEN = Number(process.env.D119_VERKAUFT_RUNDEN || 260);
const PFAD = "/manager/katalog/verkauft";
const BASIS = "https://api.disorder119.com";
const ORIGIN = "https://admin.disorder119.com";
const COOKIE = "S".repeat(43), VERIFIER = "V".repeat(43), STATE = "T".repeat(43);
const REDIRECT = "http://127.0.0.1:54321/callback";
// Kein echtes Token-Format (scripts/security_scan.py), aber unverwechselbar fuer die Leck-Pruefung.
const GH = "fuzz-github-geheim-7f3a9c";
const TG = "fuzz-telegram-geheim-4b2d1e";
const KUNDE = ["kundin.fuzz@example.com", "Erika Fuzzfrau", "Geheimweg 7"];
const INTERNA = [/\bat [\w.$<>]+ \(?[\w:/\\.-]+\.m?js:\d+/, /SQLITE_|D1_ERROR|no such (table|column)|constraint failed/i,
  /TypeError|ReferenceError|SyntaxError|RangeError/, /[A-Z]:\\/, /node_modules|shop-worker\//, /\bstack\b/i];
const STATUS_ZEILE = /^"(public_status|status)": "[^"\\]*"$/;
const OFFENE_BESTELLUNG = ["RESERVED", "PAYMENT_PENDING", "PAID", "PREPARING", "SHIPPED", "RETURN_REQUESTED"];
const MIETE_AKTIV = ["RESERVED", "PAYMENT_PENDING", "CONFIRMED", "ACTIVE", "RETURN_DUE"];
const STOERUNGEN = ["500", "netz", "json", "verloren", "fremd"];
const ctx = { waitUntil(p) { Promise.resolve(p).catch(() => {}); }, passThroughOnException() {} };
const text = wert => JSON.stringify(wert, null, 2) + "\n";
const hash = v => createHash("sha256").update(v).digest("base64url");
const schritte = async n => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const tag = versatz => new Date(Date.now() + versatz * 86400000).toISOString().slice(0, 10);

// ------------------------------------------------------------ Zufall (mulberry32)

function zufallsquelle(start) {
  let a = start >>> 0;
  const zahl = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ganz = (lo, hi) => lo + Math.floor(zahl() * (hi - lo + 1));
  const wahl = liste => liste[Math.floor(zahl() * liste.length)];
  const aus = (zeichen, n) => Array.from({ length: n }, () => zeichen[ganz(0, zeichen.length - 1)]).join("");
  const hex = n => aus("0123456789abcdef", n);
  return {
    zahl, ganz, wahl, chance: p => zahl() < p,
    uuid: () => `${hex(8)}-${hex(4)}-4${hex(3)}-${wahl(["8", "9", "a", "b"])}${hex(3)}-${hex(12)}`,
    token: () => aus("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", 43),
  };
}

// ------------------------------------------------------------ Katalog

// Katalog wie ihn scripts/validate_catalog_number_links.py zulaesst: Links
// eindeutig, verlinkte Stuecke tragen ihre Nummer, Stillgelegte sind
// ausgeschlossen. Dazu unverlinkte Neuzugaenge (Feld "article") - eindeutig
// und doppelt.
function katalogBauen(z, { frei = 40 } = {}) {
  const items = [], links = { version: 1, links: [], excluded_shop_ids: [], retired_links: [] };
  const g = { items, links, frei: [], verkauft: [], entwurf: [], ausgeschlossen: [], still: [], fallback: [], mehrdeutig: [],
    gesperrt: new Map(), gesperrtNr: [], d1: [], unbekannt: ["99999", "7001", "6216", "1-1", "9999999", "300-1", "1", "13"] };
  let id = 7000, nr = 300;
  const TITEL = ["Prada Loafer Damen Schwarz", "Arc'teryx Jacke Herren Grün", "Rick Owens \"Geobasket\" Herren",
    "<script>alert(1)</script> Hose", "Jean Paul Gaultier Netzshirt ' OR 1=1 --", "Maison Margiela Tabi 😀 Damen",
    "Y-3 Hose \u202eHerren", "Balenciaga Verkauft: Artikel 1\nX", "Ünïcödé ß Mantel"];
  const neu = (public_status, extra = {}) => {
    const article = extra.article ?? String(++nr);
    const status = { AVAILABLE: "Verfügbar", available: "Verfügbar", SOLD: "Verkauft" }[public_status] || "Entwurf";
    const it = { id: ++id, article, title: z.wahl(TITEL), brand: "Fuzz", price: z.ganz(20, 900), status, public_status, url_slug: article, ...extra };
    items.push(it);
    return it;
  };
  const verlinkt = it => { links.links.push({ shop_id: it.id, article: it.article }); return it; };
  const sperre = (it, koerper, seed) => { g.gesperrt.set(it.id, koerper); g.gesperrtNr.push(it.article); g.d1.push({ it, ...seed }); };

  for (let i = 0; i < frei; i++) g.frei.push(verlinkt(neu("AVAILABLE")).article);
  g.frei.push(verlinkt(neu("available")).article); // Kleinschreibung: die Kasse liest es auch als verfuegbar
  for (let i = 0; i < 5; i++) g.verkauft.push(verlinkt(neu("SOLD")).article);
  for (let i = 0; i < 3; i++) g.entwurf.push(verlinkt(neu("DRAFT")).article);
  g.entwurf.push(verlinkt(neu("DRAFT", { hidden_from_shop: true, hidden_previous_status: "AVAILABLE" })).article);
  g.entwurf.push(verlinkt(neu("RESERVED")).article);
  // Doppelte Nummer wie #45: der bestaetigte Link gewinnt, die ausgeschlossene Fassung nie.
  const echt = verlinkt(neu("AVAILABLE"));
  g.frei.push(echt.article);
  links.excluded_shop_ids.push(neu("DRAFT", { article: echt.article, url_slug: String(id + 1) }).id);
  // Nur noch ausgeschlossen wie #15-2, stillgelegt wie #14.
  const alt = neu("SOLD", { article: `${nr}-2`, url_slug: String(id + 1) });
  links.excluded_shop_ids.push(alt.id);
  g.ausgeschlossen.push(alt.article);
  links.retired_links.push({ shop_id: 6999, article: "14" });
  links.excluded_shop_ids.push(6999);
  g.still.push("14");
  // Ohne Link (neue Stuecke aus dem Manager): eindeutig verkaufbar, doppelt mehrdeutig.
  for (let i = 0; i < 3; i++) g.fallback.push(neu("AVAILABLE", { url_slug: String(id + 1) }).article);
  for (let i = 0; i < 2; i++) {
    const m = String(++nr);
    neu("AVAILABLE", { article: m, url_slug: String(id + 1) });
    neu(i ? "DRAFT" : "AVAILABLE", { article: m, url_slug: String(id + 1) });
    g.mehrdeutig.push(m);
  }
  // Offene Bestellungen, Mieten, Kassen, ein abgebrochener Manager-Halt: 409.
  for (const status of OFFENE_BESTELLUNG) {
    const it = verlinkt(neu("AVAILABLE")), nummer = `D119-FUZZ-${it.id}`;
    sperre(it, { error: "in_bestellung", bestellung: nummer, bestellstatus: status, art: "bestellung" }, { art: "bestellung", status, nummer });
  }
  {
    const it = verlinkt(neu("SOLD")), nummer = `D119-FUZZ-${it.id}`; // im Shop verkauft und anderswo: Doppelverkauf
    sperre(it, { error: "in_bestellung", bestellung: nummer, bestellstatus: "PREPARING", art: "bestellung" }, { art: "bestellung", status: "PREPARING", nummer });
  }
  {
    const it = verlinkt(neu("DRAFT")), nummer = `D119-FUZZ-${it.id}`;
    sperre(it, { error: "in_bestellung", bestellung: nummer, bestellstatus: "PAID", art: "bestellung" }, { art: "bestellung", status: "PAID", nummer });
  }
  for (const status of MIETE_AKTIV) {
    const it = verlinkt(neu("AVAILABLE"));
    sperre(it, { error: "in_bestellung", bestellung: null, bestellstatus: status, art: "miete" }, { art: "miete", status });
  }
  { const it = verlinkt(neu("AVAILABLE")); sperre(it, { error: "in_bestellung", bestellung: null, bestellstatus: "RESERVED", art: "kasse" }, { art: "kasse" }); }
  { const it = verlinkt(neu("AVAILABLE")); sperre(it, { error: "in_arbeit" }, { art: "halt" }); }
  // Abgeschlossen oder abgelaufen: verkaufbar.
  for (const [status, lager] of [["DELIVERED", "DELIVERED"], ["CANCELLED", "CANCELLED"], ["REFUNDED", "REFUNDED"], ["RETURNED", "RETURNED"]]) {
    const it = verlinkt(neu("AVAILABLE"));
    g.d1.push({ it, art: "bestellung", status, lager, nummer: `D119-FUZZ-${it.id}` });
    g.frei.push(it.article);
  }
  for (const status of ["CANCELLED", "RETURNED", "REFUNDED"]) {
    const it = verlinkt(neu("AVAILABLE"));
    g.d1.push({ it, art: "miete", status, lager: "AVAILABLE" });
    g.frei.push(it.article);
  }
  for (const art of ["kasse", "halt", "miete"]) {
    const it = verlinkt(neu("AVAILABLE"));
    g.d1.push({ it, art, status: "RESERVED", abgelaufen: true });
    g.frei.push(it.article);
  }
  { const it = verlinkt(neu("SOLD")); g.d1.push({ it, art: "lager" }); g.verkauft.push(it.article); } // D1 noch frei, Katalog SOLD
  g.nummernFrei = new Set(g.frei);
  return g;
}

function d1Saat(raw, eintrag) {
  const { it } = eintrag, inv = `inv_${it.id}`, jetzt = new Date(), stamp = jetzt.toISOString();
  const bis = new Date(jetzt.getTime() + (eintrag.abgelaufen ? -60000 : 3600000)).toISOString();
  const lager = eintrag.lager || (eintrag.art === "bestellung" ? eintrag.status : eintrag.art === "lager" ? "AVAILABLE" : "RESERVED");
  raw.prepare(`INSERT OR IGNORE INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
    VALUES (?,?,?,?,?,'EUR','AVAILABLE',1,?)`).run(inv, it.id, it.article, lager, it.price * 100, stamp);
  if (eintrag.art === "bestellung") {
    const order = `ord_${it.id}`;
    raw.prepare(`INSERT INTO commerce_orders (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
      VALUES (?,?,?,'EUR',?,0,?,?,?)`).run(order, eintrag.nummer, eintrag.status, it.price * 100, it.price * 100, `key-${it.id}`, stamp);
    raw.prepare(`INSERT INTO order_items (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents,quantity,currency)
      VALUES (?,?,?,?,?,?,?,1,'EUR')`).run(`oi_${it.id}`, order, inv, it.id, it.article, it.title, it.price * 100);
    raw.prepare(`INSERT INTO order_contact_snapshots (order_id,source_provider,email,recipient_name,address_line1,postal_code,city,country_code,captured_at)
      VALUES (?,'CHECKOUT',?,?,?,'63739','Aschaffenburg','DE',?)`).run(order, KUNDE[0], KUNDE[1], KUNDE[2], stamp);
  }
  if (eintrag.art === "miete") {
    const tag = Math.trunc((it.price * 100 + 5) / 10);
    raw.prepare(`INSERT INTO rental_reservations (id,inventory_id,start_date,end_date,days,daily_price_cents,total_price_cents,status,idempotency_key,expires_at,created_at)
      VALUES (?,?,'2026-12-10','2026-12-11',2,?,?,?,?,?,?)`).run(`miete_${it.id}`, inv, tag, tag * 2, eintrag.status, `miete-${it.id}`,
      eintrag.status === "RESERVED" ? bis : null, stamp);
  }
  if (eintrag.art === "kasse" || eintrag.art === "halt") {
    const id = `${eintrag.art}_${it.id}`;
    const schluessel = eintrag.art === "halt" ? `${HALT_PREFIX}00000000-0000-4000-8000-${String(it.id).padStart(12, "0")}:${id}` : `kasse-${it.id}#${it.id}`;
    raw.prepare(`INSERT INTO reservations (id,inventory_id,kind,status,idempotency_key,expires_at,created_at) VALUES (?,?,'PURCHASE','RESERVED',?,?,?)`)
      .run(id, inv, schluessel, bis, stamp);
  }
}

// Unabhaengiges Modell der dokumentierten Regeln (Kopf von manager-verkauft.js).
function aufloesen(items, links, nummer) {
  const link = links.links.find(l => l.article === nummer);
  if (link) return { item: items.find(it => it.id === link.shop_id) || null, shopId: link.shop_id };
  const aus = new Set(links.excluded_shop_ids);
  const treffer = items.filter(it => String(it.article).trim() === nummer && !aus.has(it.id));
  if (treffer.length > 1) return { mehrdeutig: treffer.map(it => it.id) };
  if (treffer.length === 1) return { item: treffer[0], shopId: treffer[0].id };
  const alt = items.find(it => String(it.article).trim() === nummer);
  if (alt) return { item: alt, shopId: alt.id, ausgeschlossen: true };
  const still = (links.retired_links || []).find(l => l.article === nummer);
  return still ? { item: null, shopId: still.shop_id } : null;
}

function erwarten(w, nummer) {
  const t = aufloesen(w.netz.items(), w.kat.links, nummer);
  if (!t) return { status: 404, body: { error: "artikel_unbekannt" } };
  if (t.mehrdeutig) return { status: 409, body: { error: "nummer_mehrdeutig", shop_ids: t.mehrdeutig } };
  if (t.item && w.kat.gesperrt.has(t.shopId)) return { status: 409, body: w.kat.gesperrt.get(t.shopId), shopId: t.shopId };
  const status = String(t.item?.public_status || "").toUpperCase(), basis = { artikelnummer: nummer, shop_id: t.shopId };
  if (!t.item || t.ausgeschlossen || !["AVAILABLE", "SOLD"].includes(status)) {
    return { status: 200, body: { ok: true, nicht_im_shop: true, ...basis, status: status || "ENTFERNT" } };
  }
  if (status === "SOLD") return { status: 200, body: { ok: true, status: "SOLD", ...basis, bereits: true }, shopId: t.shopId };
  return { status: 200, body: { ok: true, status: "SOLD", ...basis, bereits: false }, shopId: t.shopId, verkauf: true };
}

// ------------------------------------------------------------ GitHub-Nachbau

function gitNachbau(kat, takt) {
  let zaehler = 0;
  const neueSha = art => art + (++zaehler).toString(16).padStart(39, "0");
  const blobs = new Map(), baeume = new Map(), commits = new Map();
  const blob = inhalt => { const sha = neueSha("b"); blobs.set(sha, inhalt); return sha; };
  const wurzelBaum = neueSha("c"), wurzel = neueSha("a");
  baeume.set(wurzelBaum, new Map([["data/items.json", blob(text(kat.items))], ["config/catalog-number-links.json", blob(text(kat.links))],
    ["sitemap.xml", blob("<urlset/>\n")]]));
  commits.set(wurzel, { tree: wurzelBaum, parents: [], message: "Start" });
  const s = { head: wurzel, main: [wurzel], ghNr: 0, stoerung: null, telegramArt: "ok", telegram: [], fremd: [], unerwartet: [] };
  const dateiAm = (sha, pfad) => { const b = baeume.get(commits.get(sha)?.tree)?.get(pfad); return b === undefined ? undefined : blobs.get(b); };
  const fremderCommit = () => {
    const baum = new Map(baeume.get(commits.get(s.head).tree));
    baum.set("sitemap.xml", blob(`<urlset n="${zaehler}"/>\n`));
    const t = neueSha("c"), c = neueSha("a");
    baeume.set(t, baum);
    commits.set(c, { tree: t, parents: [s.head], message: "Automatischer Rebuild nach Shop- und SEO-Validierung" });
    s.head = c; s.main.push(c);
  };
  const fehlt = () => new Response("nicht gefunden", { status: 404 });
  const ungueltig = () => Response.json({ message: "Invalid request" }, { status: 422 });
  function api(method, pfad, u, body) {
    let m;
    if (method === "GET" && pfad === "/git/ref/heads/main") return Response.json({ ref: "refs/heads/main", object: { sha: s.head, type: "commit" } });
    if (method === "GET" && (m = /^\/git\/commits\/([0-9a-f]{40})$/.exec(pfad))) {
      const c = commits.get(m[1]);
      return c ? Response.json({ sha: m[1], tree: { sha: c.tree }, parents: c.parents.map(sha => ({ sha })), message: c.message }) : fehlt();
    }
    if (method === "GET" && (m = /^\/contents\/(data|config)$/.exec(pfad))) {
      const ref = u.searchParams.get("ref") || "main", c = commits.get(ref === "main" ? s.head : ref);
      if (!c) return fehlt();
      return Response.json([...baeume.get(c.tree)].filter(([p]) => p.startsWith(m[1] + "/"))
        .map(([p, sha]) => ({ name: p.slice(m[1].length + 1), path: p, type: "file", sha })));
    }
    if (method === "GET" && (m = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(pfad))) return blobs.has(m[1]) ? new Response(blobs.get(m[1])) : fehlt();
    if (method === "POST" && pfad === "/git/blobs") {
      if (body?.encoding !== "utf-8" || typeof body.content !== "string") return ungueltig();
      return Response.json({ sha: blob(body.content) }, { status: 201 });
    }
    if (method === "POST" && pfad === "/git/trees") {
      const basis = baeume.get(body?.base_tree);
      if (!basis || !Array.isArray(body.tree)) return ungueltig();
      const baum = new Map(basis);
      for (const e of body.tree) {
        if (e.sha === null) baum.delete(e.path);
        else if (!blobs.has(e.sha)) return ungueltig();
        else baum.set(e.path, e.sha);
      }
      const t = neueSha("c");
      baeume.set(t, baum);
      return Response.json({ sha: t }, { status: 201 });
    }
    if (method === "POST" && pfad === "/git/commits") {
      if (!baeume.has(body?.tree) || !Array.isArray(body.parents) || !body.parents.every(p => commits.has(p))) return ungueltig();
      const c = neueSha("a");
      commits.set(c, { tree: body.tree, parents: body.parents, message: String(body.message) });
      return Response.json({ sha: c }, { status: 201 });
    }
    if (method === "PATCH" && pfad === "/git/refs/heads/main") {
      const c = commits.get(body?.sha);
      if (!c) return ungueltig();
      // Wie GitHub: ohne force nur Vorspulen.
      if (body.force !== false || c.parents[0] !== s.head) return Response.json({ message: "Update is not a fast forward" }, { status: 422 });
      s.head = body.sha; s.main.push(body.sha);
      return Response.json({ object: { sha: body.sha } });
    }
    s.unerwartet.push(`${method} ${pfad}`);
    return fehlt();
  }
  const original = globalThis.fetch;
  globalThis.fetch = async (eingabe, init = {}) => {
    const u = new URL(String(eingabe?.url || eingabe));
    const method = String(init.method || eingabe?.method || "GET").toUpperCase();
    await takt("netz");
    if (u.hostname === "api.telegram.org") {
      s.telegram.push(JSON.parse(init.body));
      if (s.telegramArt === "netz") throw new TypeError("fetch failed");
      if (s.telegramArt === "500") return Response.json({ ok: false, description: "kaputt" }, { status: 500 });
      return Response.json({ ok: true, result: { message_id: s.telegram.length } });
    }
    const roh = u.hostname === "raw.githubusercontent.com";
    if (!roh && u.hostname !== "api.github.com") { s.fremd.push(u.href); throw new TypeError(`Testnetz: ${u.hostname} gesperrt`); }
    const nr = ++s.ghNr, st = s.stoerung?.nr === nr ? s.stoerung.art : null;
    if (st === "netz") throw new TypeError("Network connection lost.");
    if (st === "500") return new Response("<h1>502 Bad Gateway</h1>", { status: 500 });
    if (st === "fremd") fremderCommit(); // main bewegt sich (Rebuild) genau vor diesem Aufruf
    let antwort;
    if (roh) {
      const m = /^\/disorder119\/disorder119-shop\/main\/(.+)$/.exec(u.pathname), inhalt = m ? dateiAm(s.head, m[1]) : undefined;
      antwort = inhalt === undefined ? fehlt() : new Response(inhalt);
    } else {
      let body = null;
      try { body = init.body ? JSON.parse(init.body) : null; } catch { body = null; }
      antwort = api(method, u.pathname.replace(/^\/repos\/disorder119\/disorder119-shop/, ""), u, body);
    }
    if (st === "verloren") throw new TypeError("Network connection lost."); // bei GitHub angekommen, Antwort weg
    if (st === "json") return new Response("<html>Wartung</html>", { status: 200, headers: { "Content-Type": "text/html" } });
    return antwort;
  };
  return Object.assign(s, {
    items: () => JSON.parse(dateiAm(s.head, "data/items.json")),
    item: id => JSON.parse(dateiAm(s.head, "data/items.json")).find(it => it.id === id),
    commit: sha => commits.get(sha), baum: sha => baeume.get(sha), blob: sha => blobs.get(sha),
    verkaufCommits: id => s.main.slice(1).filter(sha => commits.get(sha).message.trim() === `Verkauft: Artikel ${id}`).length,
    zurueck() { globalThis.fetch = original; },
  });
}

// Die Pruefung des Main-Waechters (scripts/main_provenance.py, ist_verkauf) nachgebaut.
function verkaufsDiff(alt, neu, id) {
  const a = alt.split("\n"), b = neu.split("\n");
  if (a.length !== b.length) return "Zeilenzahl geaendert";
  const weg = [], dazu = [];
  a.forEach((z, i) => { if (z !== b[i]) { weg.push(z.trim().replace(/,+$/, "")); dazu.push(b[i].trim().replace(/,+$/, "")); } });
  if (!weg.length || !weg.every(z => STATUS_ZEILE.test(z))) return `fremde Zeilen: ${weg.join(" | ").slice(0, 160)}`;
  const neue = [...dazu].sort().join("|");
  if (!['"public_status": "SOLD"', '"public_status": "SOLD"|"status": "Verkauft"'].includes(neue)) return `neue Zeilen: ${neue}`;
  const schluessel = l => l.map(z => z.split(":")[0]).sort().join();
  if (schluessel(weg) !== schluessel(dazu)) return "andere Schluessel";
  const A = JSON.parse(alt), B = JSON.parse(neu);
  if (!A.some(x => x.id === id)) return "Stueck fehlt im Katalog";
  for (let i = 0; i < A.length; i++) {
    if (A[i].id !== id && JSON.stringify(A[i]) !== JSON.stringify(B[i])) return `fremdes Stueck ${A[i].id} geaendert`;
    if (A[i].id === id && String(B[i].public_status) !== "SOLD") return "nicht SOLD";
  }
  return null;
}

function waechterBefunde(netz) {
  const befunde = [], je = new Map();
  for (const sha of netz.main.slice(1)) {
    const c = netz.commit(sha);
    if (c.message === "Automatischer Rebuild nach Shop- und SEO-Validierung") continue;
    const m = /^Verkauft: Artikel (\d+)$/.exec(c.message);
    if (!m) { befunde.push(`Commit mit Nachricht ${JSON.stringify(c.message)} - der Main-Waechter dreht ihn zurueck`); continue; }
    je.set(m[1], (je.get(m[1]) || 0) + 1);
    const vorher = netz.baum(netz.commit(c.parents[0]).tree), nachher = netz.baum(c.tree);
    const geaendert = [...new Set([...vorher.keys(), ...nachher.keys()])].filter(p => vorher.get(p) !== nachher.get(p));
    if (geaendert.join() !== "data/items.json") befunde.push(`${c.message}: Dateien ${geaendert.join()}`);
    const grund = verkaufsDiff(netz.blob(vorher.get("data/items.json")), netz.blob(nachher.get("data/items.json")), Number(m[1]));
    if (grund) befunde.push(`${c.message}: ${grund}`);
  }
  for (const [id, n] of je) if (n > 1) befunde.push(`Artikel ${id}: ${n} Verkauft-Commits auf main`);
  return befunde;
}

// ------------------------------------------------------------ Umgebung

// D1 mit Takt: vor jedem Zugriff ein Schritt, an dem Tests Kasse/Miete
// zugreifen lassen oder (gleichzeitige Anfragen) die Reihenfolge mischen.
function mitTakt(DB, takt) {
  const huelle = (st, sql) => ({
    sql,
    bind: (...a) => huelle(st.bind(...a), sql),
    execute: () => st.execute(),
    first: async () => { await takt("d1", sql); return st.first(); },
    all: async () => { await takt("d1", sql); return st.all(); },
    run: async () => { await takt("d1", sql); return st.run(); },
  });
  return { prepare: sql => huelle(DB.prepare(sql), sql), batch: async liste => { await takt("d1", liste[0]?.sql || ""); return DB.batch(liste); }, raw: DB.raw };
}

function welt(kat, { github = true, telegram = true, waechter = false, sandbox = false } = {}) {
  const roh = sqliteD1(allMigrations()), stamp = new Date().toISOString();
  roh.raw.prepare(`INSERT INTO admin_passkeys(id,name,rp_id,public_key_jwk,algorithm,created_at) VALUES('TEST-OWNER','Synthetic owner','admin.disorder119.com','{}',-7,?)`).run(stamp);
  roh.raw.prepare(`INSERT INTO admin_sessions(id,passkey_id,created_at,expires_at,last_seen_at) VALUES(?,'TEST-OWNER',?,'2099-01-01T00:00:00.000Z',?)`)
    .run(createHash("sha256").update(COOKIE).digest("hex"), stamp, stamp);
  for (const eintrag of kat.d1) d1Saat(roh.raw, eintrag);
  const uhr = { n: 0, beim: null, warten: null };
  const takt = async (art, sql = "") => { uhr.n++; if (uhr.beim) uhr.beim(uhr.n, art, sql); if (uhr.warten) await uhr.warten(); };
  const grenze = { nein: false };
  const env = {
    DB: mitTakt(roh, takt), RATE_LIMITER: { limit: async () => ({ success: !grenze.nein }) },
    ...(github ? { GITHUB_TOKEN: GH } : {}), ...(telegram ? { TELEGRAM_BOT_TOKEN: TG, TELEGRAM_CHAT_ID: "42" } : {}),
    ...(sandbox ? { SANDBOX: "1" } : {}), ...(waechter ? {} : { WAECHTER: "aus" }),
  };
  const netz = gitNachbau(kat, takt);
  const halteSaat = new Set(kat.d1.filter(e => e.art === "halt").map(e => `halt_${e.it.id}`));
  return { env, roh, raw: roh.raw, uhr, grenze, netz, kat, tokens: [], halteSaat };
}

async function senden(w, { pfad = PFAD, methode = "POST", kopf = {}, body } = {}) {
  let anfrage;
  try {
    anfrage = new Request(BASIS + pfad, { method: methode, headers: kopf, body: ["GET", "HEAD"].includes(methode) ? undefined : body });
  } catch {
    return null; // vom Request-Konstruktor abgelehnt (kein Worker-Thema)
  }
  const res = await worker.fetch(anfrage, w.env, ctx);
  const inhalt = methode === "HEAD" ? "" : await res.text();
  let data = null;
  try { data = JSON.parse(inhalt); } catch { data = null; }
  return { status: res.status, text: inhalt, data, typ: res.headers.get("Content-Type") || "" };
}

const JSON_KOPF = { "Content-Type": "application/json" };
const kopfGut = token => ({ ...JSON_KOPF, Authorization: `Bearer ${token}` });

async function koppeln(w, scope) {
  const a = await senden(w, { pfad: "/manager/authorize", kopf: JSON_KOPF, body: JSON.stringify({
    redirect_uri: REDIRECT, state: STATE, code_challenge: hash(VERIFIER), code_challenge_method: "S256", device_name: "FUZZ PC", ...(scope ? { scope } : {}) }) });
  assert.equal(a.status, 201, a.text);
  const b = await senden(w, { pfad: "/admin/manager/approve", kopf: { ...JSON_KOPF, Origin: ORIGIN, Cookie: `d119_admin=${COOKIE}` },
    body: JSON.stringify({ id: a.data.request_id, confirm: true }) });
  assert.equal(b.status, 200, b.text);
  const code = new URL(b.data.callback_uri).searchParams.get("code");
  const t = await senden(w, { pfad: "/manager/token", kopf: JSON_KOPF, body: JSON.stringify({ code, code_verifier: VERIFIER, redirect_uri: REDIRECT }) });
  assert.equal(t.status, 200, t.text);
  w.tokens.push(t.data.access_token);
  return t.data;
}

const stueck = (kat, nummer) => kat.items.find(it => it.article === nummer);
const ohneBom = roh => roh.replace(/^﻿/, "");
const meldung = (z, artikelnummer, extra = {}) => ({
  artikelnummer, plattform: z.wahl(["vinted", "ebay", "sonstige"]),
  verkauft_am: z.wahl(["2026-11-27", "2024-02-29", "2000-01-01", tag(0), tag(1), tag(-3)]), request_id: z.uuid(), ...extra,
});

function kasseVersuch(w, it) {
  // Die Kasse liest den Katalog frisch von main (findItems): verkauft -> keine Reservierung.
  if (String(w.netz.item(it.id)?.public_status || "").toUpperCase() !== "AVAILABLE") return false;
  const raw = w.raw, stamp = new Date().toISOString(), inv = `inv_${it.id}`, id = `kasse_${it.id}_${stamp}`;
  raw.prepare(`INSERT OR IGNORE INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
    VALUES (?,?,?,'AVAILABLE',?,'EUR','AVAILABLE',1,?)`).run(inv, it.id, it.article, it.price * 100, stamp);
  raw.prepare("UPDATE inventory SET catalog_status='AVAILABLE',updated_at=? WHERE id=?").run(stamp, inv); // ensureInventory
  raw.exec("BEGIN");
  try { // reserveForPurchase (worker.js), ein Batch
    const r = raw.prepare(`INSERT INTO reservations (id,inventory_id,kind,status,idempotency_key,expires_at,created_at)
      SELECT ?,id,'PURCHASE','RESERVED',?,?,? FROM inventory WHERE id=? AND status='AVAILABLE' AND catalog_status='AVAILABLE'
      AND NOT EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.inventory_id=inventory.id AND rr.status IN ('RESERVED','PAYMENT_PENDING','CONFIRMED','ACTIVE','RETURN_DUE'))`)
      .run(id, `kasse-${id}#${it.id}`, new Date(Date.now() + 900000).toISOString(), stamp, inv);
    raw.prepare(`UPDATE inventory SET status='RESERVED',updated_at=?,version=version+1
      WHERE id=? AND status='AVAILABLE' AND EXISTS (SELECT 1 FROM reservations WHERE id=? AND status='RESERVED')`).run(stamp, inv, id);
    raw.exec("COMMIT");
    return r.changes === 1;
  } catch (err) {
    raw.exec("ROLLBACK");
    if (/UNIQUE/.test(err.message)) return false;
    throw err;
  }
}

function mieteVersuch(w, it) {
  // createRentalReservation (worker.js), hier in einem Zug.
  if (String(w.netz.item(it.id)?.public_status || "").toUpperCase() !== "AVAILABLE") return false;
  const raw = w.raw, stamp = new Date().toISOString(), inv = `inv_${it.id}`;
  raw.prepare(`INSERT OR IGNORE INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
    VALUES (?,?,?,'AVAILABLE',?,'EUR','AVAILABLE',1,?)`).run(inv, it.id, it.article, it.price * 100, stamp);
  raw.prepare("UPDATE inventory SET catalog_status='AVAILABLE',sale_price_cents=?,updated_at=? WHERE id=?").run(it.price * 100, stamp, inv);
  const zeile = raw.prepare("SELECT status,catalog_status FROM inventory WHERE id=?").get(inv);
  if (["PAID", "PREPARING", "SHIPPED", "DELIVERED", "RETURN_REQUESTED"].includes(zeile.status) || zeile.catalog_status !== "AVAILABLE") return false;
  if (raw.prepare("SELECT 1 AS ja FROM reservations WHERE inventory_id=? AND status='RESERVED' AND expires_at>?").get(inv, stamp)) return false;
  const tagCents = Math.trunc((it.price * 100 + 5) / 10), id = `miete_${it.id}_${stamp}`;
  raw.exec("BEGIN");
  raw.prepare(`INSERT INTO rental_reservations (id,inventory_id,start_date,end_date,days,daily_price_cents,total_price_cents,status,idempotency_key,expires_at,created_at)
    VALUES (?,?,'2026-12-20','2026-12-21',2,?,?,'RESERVED',?,?,?)`).run(id, inv, tagCents, tagCents * 2, id, new Date(Date.now() + 900000).toISOString(), stamp);
  raw.prepare("UPDATE inventory SET status='RESERVED',updated_at=?,version=version+1 WHERE id=? AND status='AVAILABLE'").run(stamp, inv);
  raw.exec("COMMIT");
  return true;
}

// ------------------------------------------------------------ Invarianten

function leck(w, antwort, erlaubteBestellung = null) {
  const befunde = [], t = antwort.text;
  for (const geheim of [GH, TG, COOKIE, ...w.tokens]) if (t.includes(geheim)) befunde.push("Token in der Antwort");
  for (const muster of INTERNA) if (muster.test(t)) befunde.push(`Interna (${muster}): ${t.slice(0, 160)}`);
  for (const k of KUNDE) if (t.includes(k)) befunde.push(`Kundendaten in der Antwort: ${k}`);
  for (const n of t.match(/D119-FUZZ-\d+/g) || []) if (n !== erlaubteBestellung) befunde.push(`fremde Bestellnummer ${n}`);
  if (antwort.text && !/application\/json/.test(antwort.typ)) befunde.push(`kein JSON: ${antwort.typ}`);
  return befunde;
}

const zahl = (w, sql, ...a) => w.raw.prepare(sql).get(...a).n;
function zustand(w) {
  const befunde = [];
  const halte = w.raw.prepare(`SELECT id FROM reservations WHERE status='RESERVED' AND idempotency_key LIKE 'manager-verkauft:%'`).all()
    .filter(r => !w.halteSaat.has(r.id));
  if (halte.length) befunde.push(`${halte.length} Manager-Halt(e) nach der Antwort noch offen`);
  const offen = zahl(w, "SELECT COUNT(*) AS n FROM manager_verkauft_meldungen WHERE antwort_json IS NULL");
  if (offen) befunde.push(`${offen} Meldung(en) ohne Antwort stehen geblieben`);
  const nicht200 = zahl(w, "SELECT COUNT(*) AS n FROM manager_verkauft_meldungen WHERE antwort_status<>200");
  if (nicht200) befunde.push(`${nicht200} gespeicherte Nicht-200-Antwort(en)`);
  const klemmt = zahl(w, `SELECT COUNT(*) AS n FROM inventory i WHERE i.status='RESERVED'
    AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.inventory_id=i.id AND r.status='RESERVED')
    AND NOT EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.inventory_id=i.id AND rr.status IN ('RESERVED','PAYMENT_PENDING','CONFIRMED','ACTIVE','RETURN_DUE'))
    AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.inventory_id=i.id)`);
  if (klemmt) befunde.push(`${klemmt} Lagerstueck(e) RESERVED ohne Grund`);
  if (w.netz.fremd.length) befunde.push(`fremde Adressen angefragt: ${[...new Set(w.netz.fremd)].join(", ").slice(0, 200)}`);
  if (w.netz.unerwartet.length) befunde.push(`unerwartete GitHub-Aufrufe: ${[...new Set(w.netz.unerwartet)].join(", ")}`);
  return befunde;
}

// Nur erlaubte Commits: genau einer je erwartetem Verkauf, keiner sonst.
function commitBefunde(w, verkauft) {
  const befunde = waechterBefunde(w.netz);
  for (const it of w.kat.items) {
    const n = w.netz.verkaufCommits(it.id);
    if (n && !verkauft.has(it.id)) befunde.push(`Artikel ${it.article} (Shop ${it.id}) ohne Grund verkauft`);
    if (!n && verkauft.has(it.id)) befunde.push(`Artikel ${it.article} (Shop ${it.id}) gemeldet, aber kein Commit`);
  }
  for (const id of w.kat.gesperrt.keys()) if (w.netz.verkaufCommits(id)) befunde.push(`gesperrtes Stueck ${id} verkauft`);
  return befunde;
}

const nurEinmal = befunde => [...new Set(befunde)];

// ------------------------------------------------------------ Eingaben

const SCHLECHT = {
  artikelnummer: [undefined, "0", "00", "0213", "-213", "#213", " #213", "213a", "213.0", "", " ", "\u00a0", null, true, false, [], {}, ["301"],
    0, -1, 301.5, 1e21, 2 ** 53, "12345678", "213-", "213--1", "213-1234", "-1", "1e3", "0x1F", "213\u0000", "213\u200b", "２１３", "٢١٣",
    "' OR 1=1 --", "301; DROP TABLE inventory; --", "\"},{\"x\":1", "Verkauft: Artikel 7001", "301\n302", "x".repeat(3000), "${jndi:ldap://x}"],
  plattform: [undefined, "Vinted", "VINTED", " vinted", "vinted ", "kleinanzeigen", "", null, 1, true, ["vinted"], {}, "__proto__", "constructor",
    "toString", "hasOwnProperty", "valueOf", "ebay\u0000", "vintéd"],
  verkauft_am: [undefined, "2026-02-30", "2025-02-29", "2026-13-01", "2026-00-10", "2026-11-00", "2026-11-31", "1999-12-31", "0000-01-01",
    "27.11.2026", "2026-11-27T10:00:00Z", "2026-1-1", "20261127", "", null, 20261127, tag(2), tag(40), "2099-01-01", " 2026-11-27",
    "2026-11-27 ", "2026/11/27", "２０２６-11-27", "+02026-11-27", "2026-11-27\n", "9999-12-31"],
  request_id: [undefined, "abc", "", null, 123, true, "00000000-0000-0000-0000-00000000000", "x".repeat(36), "' OR 1=1 --",
    u => u.replace(/-/g, ""), u => `{${u}}`, u => `${u} `, u => ` ${u}`, u => `${u.slice(0, -1)}g`, u => `${u}0`, u => `urn:uuid:${u}`, u => `${u}\n`],
};
const KAPUTT = ["", "{", "[]", "null", "true", "123", "\"text\"", "{\"artikelnummer\":", "[{\"artikelnummer\":\"301\"}]", "{}",
  "{\"a\":" + "[".repeat(2000) + "]".repeat(2000) + "}", "😀".repeat(2100), "x".repeat(5000), "{'artikelnummer':'301'}", "\u0000"];
const ORIGINS = [ORIGIN, "https://disorder119.com", "null", "https://evil.example", "http://127.0.0.1:8765", ""];
const PFADE = [PFAD, `${PFAD}/`, `${PFAD}//`, `${PFAD}?x=1`, `/manager/katalog/./verkauft`, `/manager/katalog/x/../verkauft`,
  `${PFAD}/x`, "/manager/katalog/Verkauft", `${PFAD}.json`, `${PFAD}%2F`, `/${PFAD}`, "/manager/katalog//verkauft", "/manager/katalog/verkauf",
  `${PFAD}x`, "/manager/katalog/%76erkauft", "/MANAGER/katalog/verkauft", `${PFAD};a=b`, "/manager/verkauft", "/manager/katalog/verkauft%00",
  "/admin/manager/verkauft", "/manager/katalog/entwurf", "/manager/status"];
const kanonisch = pfad => new URL(BASIS + pfad).pathname.replace(/\/+$/, "") === PFAD;

function nummerWaehlen(z, kat) {
  const r = z.zahl();
  if (r < 0.34) return z.wahl(kat.frei);
  if (r < 0.44) return z.wahl(kat.verkauft);
  if (r < 0.51) return z.wahl(kat.entwurf);
  if (r < 0.55) return z.wahl([...kat.ausgeschlossen, ...kat.still]);
  if (r < 0.63) return z.wahl(kat.fallback);
  if (r < 0.68) return z.wahl(kat.mehrdeutig);
  if (r < 0.84) return z.wahl(kat.gesperrtNr);
  return z.wahl(kat.unbekannt);
}

// Eine gueltige Meldung in zufaelliger, aber gleichwertiger Schreibweise.
function gueltigerKoerper(z, nummer) {
  const b = meldung(z, nummer);
  let wert = nummer;
  if (/^\d+$/.test(nummer) && z.chance(0.2)) wert = Number(nummer);
  else if (z.chance(0.12)) wert = z.wahl([` ${nummer}`, `${nummer}\t`, `\n${nummer} `, `\u00a0${nummer}`]);
  b.artikelnummer = wert;
  if (z.chance(0.1)) b.request_id = b.request_id.toUpperCase();
  let roh = JSON.stringify(b);
  if (typeof wert === "number" && z.chance(0.3)) roh = roh.replace(`"artikelnummer":${wert}`, `"artikelnummer":${z.wahl([`${wert}.0`, `${wert}e0`, `${wert}.000`])}`);
  if (z.chance(0.2)) roh = roh.slice(0, -1) + z.wahl([',"__proto__":{"admin":true}', ',"shop_id":7001,"bereits":true', ',"status":"SOLD","ok":false',
    ',"constructor":{"prototype":{"x":1}}', `,"notiz":"${"ä".repeat(300)}"`, ',"plattform2":"vinted"']) + "}";
  if (z.chance(0.05)) roh = `{"artikelnummer":"99999",` + roh.slice(1); // doppelter Schluessel: der letzte gilt
  if (z.chance(0.04)) roh = `﻿${roh}`; // UTF-8-BOM: das Dekodieren entfernt es, die Meldung gilt
  return { roh, b, nummer: nummer.trim() };
}

// Eine Runde: Anfrage bauen und schicken. Liefert die Antwort und - wo klar - die Erwartung.
async function runde(w, z, stand) {
  const gut = z.wahl(stand.gute);
  const r = z.zahl();
  if (r < 0.4 || (r >= 0.93 && !stand.fertig.size)) {
    const { roh, nummer } = gueltigerKoerper(z, nummerWaehlen(z, w.kat));
    const erwartung = erwarten(w, nummer);
    const kopf = { ...kopfGut(gut), "Content-Type": z.wahl(["application/json", "application/json; charset=utf-8", "Application/JSON"]) };
    return { art: "gueltig", kopf, roh, erwartung, antwort: await senden(w, { kopf, body: roh }) };
  }
  if (r < 0.68) {
    const basis = meldung(z, z.wahl(w.kat.frei));
    if (z.chance(0.7)) {
      const feld = z.wahl(Object.keys(SCHLECHT)), wert = z.wahl(SCHLECHT[feld]);
      const b = { ...basis, [feld]: typeof wert === "function" ? wert(basis.request_id) : wert };
      if (b[feld] === undefined) delete b[feld];
      return { art: "feld", erwartung: { status: 400, body: { error: "anfrage_ungueltig", feld } }, antwort: await senden(w, { kopf: kopfGut(gut), body: JSON.stringify(b) }) };
    }
    const roh = z.chance(0.1) ? JSON.stringify({ ...basis, polster: "y".repeat(40000) }) : z.wahl(KAPUTT);
    return { art: "koerper", antwort: await senden(w, { kopf: kopfGut(gut), body: roh }), nurFehler: [400, 413] };
  }
  if (r < 0.8) {
    const nummer = z.wahl([...w.kat.frei, ...w.kat.verkauft]), roh = JSON.stringify(meldung(z, nummer));
    const wahl = z.ganz(0, 3);
    if (wahl === 0) return { art: "origin", antwort: await senden(w, { kopf: { ...kopfGut(gut), Origin: z.wahl(ORIGINS) }, body: roh }), nurFehler: [403] };
    if (wahl === 1) {
      const [wert, status] = z.wahl([
        [undefined, 401], [`bearer ${gut}`, 401], [`Bearer  ${gut}`, 401], [`Basic ${gut}`, 401], [`Bearer ${gut.slice(0, 42)}`, 401],
        [`Bearer ${gut}A`, 401], [`Bearer ${gut},${gut}`, 401], [`Bearer ${gut}=`, 401], [`Bearer ${"A".repeat(70000)}`, 401],
        [`Bearer ${z.token()}`, 401], [`Bearer ${gut.toUpperCase() === gut ? gut.toLowerCase() : gut.toUpperCase()}`, 401], ["Bearer ÿÿÿ", 401],
        [`Bearer ${z.wahl(stand.fremde)}`, 403], ["", 401], ["Bearer", 401]]);
      const kopf = { ...JSON_KOPF, ...(wert === undefined ? {} : { Authorization: wert }) };
      return { art: "auth", antwort: await senden(w, { kopf, body: roh }), nurFehler: [status] };
    }
    if (wahl === 2) {
      const typ = z.wahl([undefined, "text/plain", "application/jsonp", "application/json, text/plain", "multipart/form-data; boundary=x",
        "application/x-www-form-urlencoded", `application/json${"x".repeat(5000)}`, "json", "application/ld+json"]);
      const kopf = { Authorization: `Bearer ${gut}`, ...(typ === undefined ? {} : { "Content-Type": typ }) };
      return { art: "typ", antwort: await senden(w, { kopf, body: roh }), erwartung: { status: 400, body: { error: "anfrage_ungueltig", feld: "body" } } };
    }
    const kopf = { ...kopfGut(gut), "X-Fuzz": "z".repeat(z.ganz(1, 65536)), Cookie: `d119_admin=${COOKIE}; x=${"y".repeat(500)}`,
      "CF-Connecting-IP": z.wahl(["203.0.113.7", "::1", "not-an-ip", "1".repeat(300)]), "X-Forwarded-For": "1.2.3.4, evil", Accept: "*/*" };
    const erwartung = erwarten(w, nummer);
    return { art: "kopf-neutral", kopf, roh, erwartung, antwort: await senden(w, { kopf, body: roh }) };
  }
  if (r < 0.9) {
    const nummer = z.wahl(w.kat.frei), roh = JSON.stringify(meldung(z, nummer));
    if (z.chance(0.4)) {
      const methode = z.wahl(["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]);
      return { art: "methode", antwort: await senden(w, { methode, kopf: kopfGut(gut), body: roh }), nurFehler: [405] };
    }
    const pfad = z.wahl(PFADE);
    if (kanonisch(pfad)) {
      const erwartung = erwarten(w, nummer);
      return { art: "pfad-kanonisch", kopf: kopfGut(gut), roh, pfad, erwartung, antwort: await senden(w, { pfad, kopf: kopfGut(gut), body: roh }) };
    }
    return { art: "pfad", antwort: await senden(w, { pfad, kopf: kopfGut(gut), body: roh }), nurFehler: [400, 401, 403, 404, 405, 413] };
  }
  if (r < 0.93) {
    w.grenze.nein = true;
    try {
      return { art: "grenze", antwort: await senden(w, { kopf: kopfGut(gut), body: JSON.stringify(meldung(z, z.wahl(w.kat.frei))) }), nurFehler: [429] };
    } finally { w.grenze.nein = false; }
  }
  // Wiederholung einer fertigen 200: bytegleich - mit geaendertem Inhalt 409.
  const [rid, alt] = z.wahl([...stand.fertig]);
  if (z.chance(0.7)) {
    const kopf = { ...alt.kopf, Authorization: `Bearer ${z.wahl(stand.gute)}` };
    return { art: "wiederholung", rid, alt, antwort: await senden(w, { pfad: alt.pfad, kopf, body: alt.roh }) };
  }
  const b = JSON.parse(ohneBom(alt.roh));
  const aenderung = z.wahl([
    { plattform: { vinted: "ebay", ebay: "sonstige", sonstige: "vinted" }[b.plattform] },
    { verkauft_am: b.verkauft_am === "2000-01-01" ? "2000-01-02" : "2000-01-01" },
    { artikelnummer: z.wahl(w.kat.frei.filter(n => n !== String(b.artikelnummer).trim())) }]);
  return { art: "wiederholung-anders", antwort: await senden(w, { kopf: kopfGut(gut), body: JSON.stringify({ ...b, ...aenderung }) }),
    erwartung: { status: 409, body: { error: "request_id_wiederverwendet" } } };
}

function bewerten(w, stand, e, { streng = true } = {}) {
  const befunde = [], a = e.antwort;
  if (!a) return befunde;
  const was = `${e.art} -> ${a.status} ${a.text.slice(0, 140)}`;
  if (a.status >= 500) befunde.push(`5xx: ${was}`);
  befunde.push(...leck(w, a, e.erwartung?.body?.bestellung || null).map(b => `${e.art}: ${b}`));
  if (e.nurFehler && !e.nurFehler.includes(a.status) && streng) befunde.push(`erwartet ${e.nurFehler.join("/")}: ${was}`);
  if (e.nurFehler && a.status < 400) befunde.push(`Fehleingabe angenommen: ${was}`);
  if (e.art === "wiederholung" && (a.status !== 200 || a.text !== e.alt.text)) befunde.push(`Wiederholung nicht bytegleich: ${a.text.slice(0, 120)} statt ${e.alt.text.slice(0, 120)}`);
  if (e.erwartung && streng) {
    if (a.status !== e.erwartung.status) befunde.push(`Status ${a.status} statt ${e.erwartung.status}: ${was}`);
    else {
      try { assert.deepEqual(a.data, e.erwartung.body); } catch { befunde.push(`Koerper ${a.text.slice(0, 160)} statt ${JSON.stringify(e.erwartung.body)}`); }
    }
  }
  if (e.erwartung?.verkauf && a.status === 200 && a.data?.bereits === false) stand.verkauft.add(e.erwartung.shopId);
  if (a.status === 200 && e.roh && a.data?.ok) {
    const rid = String(JSON.parse(ohneBom(e.roh)).request_id || "").toLowerCase();
    if (rid && !stand.fertig.has(rid)) stand.fertig.set(rid, { roh: e.roh, kopf: e.kopf, pfad: e.pfad || PFAD, text: a.text });
  }
  return befunde;
}

// ------------------------------------------------------------ Tests

test(`Eingaben: ${RUNDEN} zufaellige, kaputte und boesartige Anfragen an den echten Worker`, { timeout: 300_000 }, async () => {
  const z = zufallsquelle(SEED), kat = katalogBauen(z, { frei: 60 }), w = welt(kat);
  const befunde = [], statistik = {};
  try {
    const stand = { gute: [], fremde: [], fertig: new Map(), verkauft: new Set() };
    for (let i = 0; i < 2; i++) stand.gute.push((await koppeln(w, "katalog_verkauft")).access_token);
    stand.fremde.push((await koppeln(w, "katalog_entwurf")).access_token, (await koppeln(w)).access_token);
    const telegramVorher = w.netz.telegram.length;
    for (let i = 0; i < RUNDEN; i++) {
      const e = await runde(w, z, stand);
      const s = e.antwort?.status ?? "abgelehnt";
      statistik[`${e.art} ${s}`] = (statistik[`${e.art} ${s}`] || 0) + 1;
      befunde.push(...bewerten(w, stand, e), ...zustand(w));
      if (i % 25 === 0) befunde.push(...commitBefunde(w, stand.verkauft));
    }
    befunde.push(...commitBefunde(w, stand.verkauft));
    for (const id of stand.verkauft) {
      if (w.raw.prepare("SELECT catalog_status FROM inventory WHERE item_id=?").get(id)?.catalog_status !== "SOLD") befunde.push(`D1 nicht SOLD: ${id}`);
    }
    if (w.netz.telegram.length - telegramVorher !== stand.verkauft.size) befunde.push(`Telegram ${w.netz.telegram.length - telegramVorher}x fuer ${stand.verkauft.size} Verkaeufe`);
    console.log(`[Eingaben] ${stand.verkauft.size} Verkaeufe, ${stand.fertig.size} fertige Antworten`, JSON.stringify(statistik));
    assert.ok(stand.verkauft.size >= 5 && stand.fertig.size >= 20, "zu wenige gueltige Meldungen - Fuzzer pruefen");
  } finally { w.netz.zurueck(); }
  assert.deepEqual(nurEinmal(befunde).slice(0, 40), []);
});

test("Freigaben: fremde Scopes, abgelaufen, getrennt, vom Inhaber widerrufen, unbekannt, Passkey weg", { timeout: 120_000 }, async () => {
  const z = zufallsquelle(SEED + 2), kat = katalogBauen(z, { frei: 10 }), w = welt(kat), befunde = [];
  try {
    const gut = await koppeln(w, "katalog_verkauft"), entwurf = await koppeln(w, "katalog_entwurf"), daten = await koppeln(w);
    const abgelaufen = await koppeln(w, "katalog_verkauft"), getrennt = await koppeln(w, "katalog_verkauft"), widerrufen = await koppeln(w, "katalog_verkauft");
    // Eine fertige Meldung mit einer spaeter widerrufenen Freigabe: Wiederholen darf sie danach nicht mehr.
    const frueher = JSON.stringify(meldung(z, kat.frei[0]));
    assert.equal((await senden(w, { kopf: kopfGut(widerrufen.access_token), body: frueher })).status, 200);
    w.raw.prepare("UPDATE manager_verkauft_grants SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(abgelaufen.grant_id);
    assert.equal((await senden(w, { pfad: "/manager/disconnect", kopf: kopfGut(getrennt.access_token), body: "{}" })).status, 200);
    assert.equal((await senden(w, { pfad: "/admin/manager/revoke", kopf: { ...JSON_KOPF, Origin: ORIGIN, Cookie: `d119_admin=${COOKIE}` },
      body: JSON.stringify({ id: widerrufen.grant_id }) })).status, 200);
    const faelle = [[entwurf.access_token, 403], [daten.access_token, 403], [abgelaufen.access_token, 401], [getrennt.access_token, 401],
      [widerrufen.access_token, 401], [z.token(), 401]];
    const main = w.netz.main.length, meldungen = zahl(w, "SELECT COUNT(*) AS n FROM manager_verkauft_meldungen");
    for (let i = 0; i < 60; i++) {
      const [token, status] = z.wahl(faelle);
      const roh = z.chance(0.15) ? frueher : JSON.stringify(meldung(z, z.wahl([...kat.frei.slice(1), ...kat.verkauft])));
      const a = await senden(w, { kopf: kopfGut(token), body: roh });
      if (a.status !== status) befunde.push(`erwartet ${status}, bekam ${a.status} ${a.text.slice(0, 100)}`);
      befunde.push(...leck(w, a), ...zustand(w));
    }
    if (w.netz.main.length !== main) befunde.push("ohne gueltige Freigabe wurde committet");
    if (zahl(w, "SELECT COUNT(*) AS n FROM manager_verkauft_meldungen") !== meldungen) befunde.push("ohne gueltige Freigabe wurde eine Meldung gespeichert");
    const ok = await senden(w, { kopf: kopfGut(gut.access_token), body: JSON.stringify(meldung(z, kat.frei[1])) });
    assert.equal(ok.status, 200, ok.text);
    // Passkey des Inhabers widerrufen: alle Freigaben sind tot.
    w.raw.prepare("UPDATE admin_passkeys SET revoked_at=? WHERE id='TEST-OWNER'").run(new Date().toISOString());
    const tot = await senden(w, { kopf: kopfGut(gut.access_token), body: JSON.stringify(meldung(z, kat.frei[2])) });
    if (tot.status !== 401) befunde.push(`Passkey widerrufen: ${tot.status}`);
    if (w.netz.verkaufCommits(kat.items.find(it => it.article === kat.frei[2]).id)) befunde.push("nach Passkey-Widerruf verkauft");
  } finally { w.netz.zurueck(); }
  assert.deepEqual(nurEinmal(befunde), []);
});

test("Kasse oder Miete greift an jedem einzelnen Zwischenschritt zu: nie reserviert UND verkauft", { timeout: 300_000 }, async () => {
  const z = zufallsquelle(SEED + 4), kat = katalogBauen(z, { frei: 170 }), w = welt(kat), befunde = [];
  let naechstes = 0;
  const frisch = () => stueck(kat, kat.frei[naechstes++]);
  try {
    const g = await koppeln(w, "katalog_verkauft");
    for (const lagerzeile of [false, true]) {
      // Laenge eines ungestoerten Ablaufs (D1-Zugriffe + GitHub/Telegram) messen.
      const lager = it => w.raw.prepare(`INSERT OR IGNORE INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
        VALUES (?,?,?,'AVAILABLE',?,'EUR','AVAILABLE',1,?)`).run(`inv_${it.id}`, it.id, it.article, it.price * 100, new Date().toISOString());
      const probe = frisch();
      if (lagerzeile) lager(probe);
      const t0 = w.uhr.n;
      assert.equal((await senden(w, { kopf: kopfGut(g.access_token), body: JSON.stringify(meldung(z, probe.article)) })).status, 200);
      const laenge = w.uhr.n - t0;
      for (const art of ["kasse", "miete"]) {
        for (let k = 1; k <= laenge + 1; k++) {
          const it = frisch();
          if (lagerzeile) lager(it);
          const start = w.uhr.n;
          let gegriffen = null;
          w.uhr.beim = n => { if (n === start + k) { w.uhr.beim = null; gegriffen = art === "kasse" ? kasseVersuch(w, it) : mieteVersuch(w, it); } };
          const a = await senden(w, { kopf: kopfGut(g.access_token), body: JSON.stringify(meldung(z, it.article)) });
          w.uhr.beim = null;
          const wo = `${art} bei Schritt ${k}/${laenge} (${lagerzeile ? "mit" : "ohne"} Lagerzeile)`;
          const commits = w.netz.verkaufCommits(it.id);
          if (gegriffen && commits) befunde.push(`${wo}: Stueck reserviert UND als verkauft committet (${a.status} ${a.text.slice(0, 100)})`);
          if (gegriffen && !(a.status === 409 && a.data?.error === "in_bestellung" && a.data.art === art)) befunde.push(`${wo}: ${a.status} ${a.text.slice(0, 120)}`);
          if (!gegriffen && !(a.status === 200 && a.data?.bereits === false && commits === 1)) befunde.push(`${wo} (zu spaet): ${a.status} ${a.text.slice(0, 120)}`);
          befunde.push(...zustand(w).map(b => `${wo}: ${b}`), ...leck(w, a));
        }
      }
    }
    befunde.push(...waechterBefunde(w.netz));
    console.log(`[Zwischenschritte] ${naechstes} Ablaeufe`);
  } finally { w.netz.zurueck(); }
  assert.deepEqual(nurEinmal(befunde).slice(0, 30), []);
});

test("gleichzeitig: dieselbe und andere request_ids fuer dasselbe Stueck, dazwischen Kasse, Miete und GitHub-Ausfall", { timeout: 300_000 }, async () => {
  const z = zufallsquelle(SEED + 3), kat = katalogBauen(z, { frei: 45 }), w = welt(kat), befunde = [];
  try {
    const g = [await koppeln(w, "katalog_verkauft"), await koppeln(w, "katalog_verkauft")];
    w.uhr.warten = () => schritte(z.ganz(0, 3));
    for (let r = 0; r < 40; r++) {
      const it = kat.items.find(x => x.article === kat.frei[r]);
      const erste = meldung(z, it.article), koerper = [erste];
      for (let i = 0, n = z.ganz(1, 3); i < n; i++) {
        const art = z.wahl(["gleich", "gleich", "neu", "neu", "anders"]);
        koerper.push(art === "gleich" ? erste : art === "neu" ? meldung(z, it.article) : { ...erste, plattform: { vinted: "ebay", ebay: "sonstige", sonstige: "vinted" }[erste.plattform] });
      }
      let zugriff = null;
      if (z.chance(0.4)) {
        const ziel = w.uhr.n + z.ganz(1, 60), art = z.wahl(["kasse", "miete"]);
        w.uhr.beim = n => { if (n >= ziel) { w.uhr.beim = null; zugriff = { art, ok: art === "kasse" ? kasseVersuch(w, it) : mieteVersuch(w, it) }; } };
      }
      const stoerung = z.chance(0.3) ? { nr: w.netz.ghNr + z.ganz(1, 40), art: z.wahl(STOERUNGEN) } : null;
      w.netz.stoerung = stoerung;
      const antworten = await Promise.all(koerper.map(b => senden(w, { kopf: kopfGut(z.wahl(g).access_token), body: JSON.stringify(b) })));
      w.uhr.beim = null; w.netz.stoerung = null;
      const wo = `Runde ${r} (${koerper.length} Anfragen, ${zugriff ? `${zugriff.art}:${zugriff.ok}` : "ohne Zugriff"}, ${stoerung ? stoerung.art : "ohne Stoerung"})`;
      const je = new Map();
      antworten.forEach((a, i) => {
        befunde.push(...leck(w, a, null).map(b => `${wo}: ${b}`));
        const ok = a.status === 200 ? a.data?.status === "SOLD" && a.data.shop_id === it.id
          : a.status === 409 ? ["in_arbeit", "in_bestellung", "request_id_wiederverwendet"].includes(a.data?.error)
            : a.status === 502 ? Boolean(stoerung) && a.data?.error === "github_nicht_erreichbar" : false;
        if (!ok) befunde.push(`${wo}: ${a.status} ${a.text.slice(0, 120)}`);
        if (a.status === 200) {
          const rid = koerper[i].request_id;
          if (je.has(rid) && je.get(rid).text !== a.text) befunde.push(`${wo}: zwei verschiedene 200 fuer dieselbe request_id`);
          je.set(rid, { text: a.text, body: koerper[i] });
        }
      });
      const commits = w.netz.verkaufCommits(it.id);
      if (commits > 1) befunde.push(`${wo}: ${commits} Commits`);
      if (zugriff?.ok && commits) befunde.push(`${wo}: ${zugriff.art} hat reserviert UND es wurde verkauft`);
      if (antworten.some(a => a.status === 200) && String(w.netz.item(it.id).public_status) !== "SOLD") befunde.push(`${wo}: 200 ohne SOLD auf main`);
      befunde.push(...zustand(w).map(b => `${wo}: ${b}`));
      // Danach ohne Stoerung: dieselben request_ids bytegleich, eine neue Meldung verkauft genau einmal.
      for (const [, { text: t, body: b }] of je) {
        const nochmal = await senden(w, { kopf: kopfGut(g[0].access_token), body: JSON.stringify(b) });
        if (nochmal.text !== t) befunde.push(`${wo}: Wiederholung ${nochmal.status} nicht bytegleich`);
      }
      const nach = await senden(w, { kopf: kopfGut(g[1].access_token), body: JSON.stringify(meldung(z, it.article)) });
      if (zugriff?.ok) {
        if (nach.status !== 409 || nach.data?.art !== zugriff.art) befunde.push(`${wo}: danach ${nach.status} ${nach.text.slice(0, 100)}`);
      } else {
        if (nach.status !== 200 || w.netz.verkaufCommits(it.id) !== 1) befunde.push(`${wo}: danach ${nach.status} ${nach.text.slice(0, 100)}, ${w.netz.verkaufCommits(it.id)} Commits`);
        if (w.raw.prepare("SELECT catalog_status FROM inventory WHERE item_id=?").get(it.id)?.catalog_status !== "SOLD") befunde.push(`${wo}: D1 danach nicht SOLD`);
      }
      befunde.push(...zustand(w).map(b => `${wo}: ${b}`));
    }
    befunde.push(...waechterBefunde(w.netz));
  } finally { w.netz.zurueck(); }
  assert.deepEqual(nurEinmal(befunde).slice(0, 30), []);
});

test("GitHub faellt an jeder Stelle aus: 502, Halt frei, Wiederholung verkauft genau einmal", { timeout: 300_000 }, async () => {
  const z = zufallsquelle(SEED + 5), kat = katalogBauen(z, { frei: 90 }), w = welt(kat), befunde = [];
  let naechstes = 0;
  const frisch = () => stueck(kat, kat.frei[naechstes++]);
  try {
    const g = await koppeln(w, "katalog_verkauft");
    const probe = frisch(), n0 = w.netz.ghNr;
    assert.equal((await senden(w, { kopf: kopfGut(g.access_token), body: JSON.stringify(meldung(z, probe.article)) })).status, 200);
    const aufrufe = w.netz.ghNr - n0;
    for (const art of STOERUNGEN) {
      for (let nr = 1; nr <= aufrufe; nr++) {
        const it = frisch(), body = JSON.stringify(meldung(z, it.article)), wo = `GitHub "${art}" bei Aufruf ${nr}/${aufrufe}`;
        w.netz.stoerung = { nr: w.netz.ghNr + nr, art };
        const a = await senden(w, { kopf: kopfGut(g.access_token), body });
        w.netz.stoerung = null;
        const gelandet = w.netz.verkaufCommits(it.id);
        if (!(a.status === 200 && a.data?.bereits === false && gelandet === 1) && !(a.status === 502 && a.data?.error === "github_nicht_erreichbar")) {
          befunde.push(`${wo}: ${a.status} ${a.text.slice(0, 140)}`);
        }
        befunde.push(...leck(w, a).map(b => `${wo}: ${b}`), ...zustand(w).map(b => `${wo}: ${b}`));
        const inv = w.raw.prepare("SELECT status FROM inventory WHERE item_id=?").get(it.id);
        if (inv && inv.status !== "AVAILABLE") befunde.push(`${wo}: Lagerstueck ${inv.status}`);
        const nochmal = await senden(w, { kopf: kopfGut(g.access_token), body });
        if (a.status === 200 ? nochmal.text !== a.text : !(nochmal.status === 200 && nochmal.data?.bereits === Boolean(gelandet))) {
          befunde.push(`${wo}: Wiederholung ${nochmal.status} ${nochmal.text.slice(0, 120)}`);
        }
        if (w.netz.verkaufCommits(it.id) !== 1) befunde.push(`${wo}: ${w.netz.verkaufCommits(it.id)} Commits nach der Wiederholung`);
      }
    }
    befunde.push(...waechterBefunde(w.netz));
    // Nicht eingerichtet: 503, nie 500.
    const ohne = welt(kat, { github: false });
    try {
      const g2 = await koppeln(ohne, "katalog_verkauft");
      const a = await senden(ohne, { kopf: kopfGut(g2.access_token), body: JSON.stringify(meldung(z, kat.frei[0])) });
      if (a.status !== 503 || a.data?.error !== "katalog_nicht_eingerichtet") befunde.push(`ohne GITHUB_TOKEN: ${a.status} ${a.text}`);
      delete ohne.env.RATE_LIMITER;
      const b = await senden(ohne, { kopf: kopfGut(g2.access_token), body: JSON.stringify(meldung(z, kat.frei[0])) });
      if (b.status !== 503) befunde.push(`ohne Begrenzer: ${b.status} ${b.text}`);
    } finally { ohne.netz.zurueck(); }
  } finally { w.netz.zurueck(); }
  assert.deepEqual(nurEinmal(befunde).slice(0, 30), []);
});

test("Testshop: Katalogquelle faellt aus -> 502, nie ein Commit", { timeout: 120_000 }, async () => {
  const z = zufallsquelle(SEED + 6), kat = katalogBauen(z, { frei: 12 }), w = welt(kat, { sandbox: true, github: false, telegram: false }), befunde = [];
  try {
    const g = await koppeln(w, "katalog_verkauft");
    let naechstes = 0;
    for (const art of ["500", "netz", "json"]) {
      for (const nr of [1, 2]) {
        sandboxKatalogCacheLeeren();
        const it = stueck(kat, kat.frei[naechstes++]);
        w.netz.stoerung = { nr: w.netz.ghNr + nr, art };
        const a = await senden(w, { kopf: kopfGut(g.access_token), body: JSON.stringify(meldung(z, it.article)) });
        w.netz.stoerung = null;
        if (!(a.status === 502 || (a.status === 200 && a.data?.testshop))) befunde.push(`Testshop "${art}" bei ${nr}: ${a.status} ${a.text.slice(0, 120)}`);
        befunde.push(...zustand(w), ...leck(w, a));
      }
    }
    if (w.netz.main.length !== 1) befunde.push("Testshop hat committet");
  } finally { w.netz.zurueck(); sandboxKatalogCacheLeeren(); }
  assert.deepEqual(nurEinmal(befunde), []);
});

test("Telegram kaputt, weg oder ohne Netz: der Verkauf steht trotzdem genau einmal", { timeout: 120_000 }, async () => {
  const z = zufallsquelle(SEED + 7), kat = katalogBauen(z, { frei: 8 }), befunde = [];
  let i = 0;
  for (const [telegram, art] of [[true, "500"], [true, "netz"], [false, "ok"], [true, "ok"]]) {
    const w = welt(kat, { telegram });
    try {
      const g = await koppeln(w, "katalog_verkauft");
      w.netz.telegramArt = art;
      const it = stueck(kat, kat.frei[i++]);
      const body = JSON.stringify(meldung(z, it.article));
      const a = await senden(w, { kopf: kopfGut(g.access_token), body });
      if (a.status !== 200 || a.data?.bereits !== false || w.netz.verkaufCommits(it.id) !== 1) befunde.push(`Telegram ${telegram}/${art}: ${a.status} ${a.text}`);
      if (w.netz.telegram.length !== (telegram ? 1 : 0)) befunde.push(`Telegram ${telegram}/${art}: ${w.netz.telegram.length} Nachrichten`);
      if ((await senden(w, { kopf: kopfGut(g.access_token), body })).text !== a.text) befunde.push(`Telegram ${art}: Wiederholung anders`);
      if (w.netz.telegram.length !== (telegram ? 1 : 0)) befunde.push(`Telegram ${art}: Wiederholung meldet erneut`);
      befunde.push(...zustand(w), ...leck(w, a));
    } finally { w.netz.zurueck(); }
  }
  assert.deepEqual(nurEinmal(befunde), []);
});

test("abgebrochene Versuche: laufende Meldung 409, nach zwei Minuten uebernommen, alter Halt erst nach Ablauf frei", { timeout: 120_000 }, async () => {
  const z = zufallsquelle(SEED + 8), kat = katalogBauen(z, { frei: 6 }), w = welt(kat);
  try {
    const g = await koppeln(w, "katalog_verkauft");
    const it = kat.items.find(x => x.article === kat.frei[0]), b = meldung(z, it.article), body = JSON.stringify(b);
    const jetzt = Date.now(), iso = ms => new Date(ms).toISOString();
    w.raw.prepare(`INSERT INTO manager_verkauft_meldungen (request_id,grant_id,artikelnummer,plattform,verkauft_am,versuch,created_at,updated_at)
      VALUES (?,?,?,?,?,'alter-versuch',?,?)`).run(b.request_id, g.grant_id, it.article, b.plattform, b.verkauft_am, iso(jetzt - 30000), iso(jetzt - 30000));
    const laeuft = await senden(w, { kopf: kopfGut(g.access_token), body });
    assert.deepEqual([laeuft.status, laeuft.data], [409, { error: "in_arbeit" }]);
    assert.equal(w.raw.prepare("SELECT versuch FROM manager_verkauft_meldungen WHERE request_id=?").get(b.request_id).versuch, "alter-versuch");
    // Der abgebrochene Versuch hat schon festgehalten (Worker beendet): sein Halt blockiert bis zum Ablauf.
    w.raw.prepare("UPDATE manager_verkauft_meldungen SET updated_at=? WHERE request_id=?").run(iso(jetzt - 180000), b.request_id);
    w.raw.prepare(`INSERT INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
      VALUES (?,?,?,'RESERVED',?,'EUR','AVAILABLE',1,?)`).run(`inv_${it.id}`, it.id, it.article, it.price * 100, iso(jetzt));
    w.raw.prepare(`INSERT INTO reservations (id,inventory_id,kind,status,idempotency_key,expires_at,created_at) VALUES ('alt',?,'PURCHASE','RESERVED',?,?,?)`)
      .run(`inv_${it.id}`, `${HALT_PREFIX}${b.request_id}:alt`, iso(jetzt + 120000), iso(jetzt - 180000));
    const halt = await senden(w, { kopf: kopfGut(g.access_token), body });
    assert.deepEqual([halt.status, halt.data], [409, { error: "in_arbeit" }]);
    assert.equal(w.netz.verkaufCommits(it.id), 0);
    assert.equal(zahl(w, "SELECT COUNT(*) AS n FROM manager_verkauft_meldungen WHERE request_id=?", b.request_id), 0, "Uebernahme wieder freigegeben");
    w.raw.prepare("UPDATE reservations SET expires_at=? WHERE id='alt'").run(iso(jetzt - 1000));
    const fertig = await senden(w, { kopf: kopfGut(g.access_token), body });
    assert.equal(fertig.status, 200, fertig.text);
    assert.equal(fertig.data.bereits, false);
    assert.equal(w.netz.verkaufCommits(it.id), 1);
    assert.equal(w.raw.prepare("SELECT status FROM reservations WHERE id='alt'").get().status, "EXPIRED");
    assert.deepEqual(zustand(w), []);
  } finally { w.netz.zurueck(); }
});

// Gefunden mit Seed 31337: Ein gleichzeitiger Versuch mit derselben request_id
// sagt ab (502) und gibt seinen Eintrag frei - genau zwischen INSERT OR IGNORE
// und SELECT des zweiten. Das war "meldung_fehlt" -> 500.
test("derselbe Versuch gibt zwischen Anlegen und Lesen frei: 409 in_arbeit statt 500, danach normal", { timeout: 120_000 }, async () => {
  const z = zufallsquelle(SEED + 10), kat = katalogBauen(z, { frei: 4 }), w = welt(kat);
  try {
    const g = await koppeln(w, "katalog_verkauft");
    const it = stueck(kat, kat.frei[0]), b = meldung(z, it.article), body = JSON.stringify(b), stamp = new Date().toISOString();
    w.raw.prepare(`INSERT INTO manager_verkauft_meldungen (request_id,grant_id,artikelnummer,plattform,verkauft_am,versuch,created_at,updated_at)
      VALUES (?,?,?,?,?,'erster-versuch',?,?)`).run(b.request_id, g.grant_id, it.article, b.plattform, b.verkauft_am, stamp, stamp);
    w.uhr.beim = (n, art, sql) => {
      if (!sql.startsWith("SELECT * FROM manager_verkauft_meldungen")) return;
      w.uhr.beim = null;
      w.raw.prepare("DELETE FROM manager_verkauft_meldungen WHERE request_id=? AND versuch='erster-versuch'").run(b.request_id);
    };
    const a = await senden(w, { kopf: kopfGut(g.access_token), body });
    w.uhr.beim = null;
    assert.deepEqual([a.status, a.data], [409, { error: "in_arbeit" }]);
    assert.equal(w.netz.verkaufCommits(it.id), 0);
    const nochmal = await senden(w, { kopf: kopfGut(g.access_token), body });
    assert.equal(nochmal.status, 200, nochmal.text);
    assert.equal(nochmal.data.bereits, false);
    assert.equal(w.netz.verkaufCommits(it.id), 1);
    assert.deepEqual(zustand(w), []);
  } finally { w.netz.zurueck(); }
});

test("mit Waechter: dieselben Anfragen loesen nie 5xx, Lecks oder fremde Verkaeufe aus", { timeout: 300_000 }, async () => {
  const z = zufallsquelle(SEED + 9), kat = katalogBauen(z, { frei: 30 }), w = welt(kat, { waechter: true }), befunde = [];
  try {
    const stand = { gute: [], fremde: [], fertig: new Map(), verkauft: new Set() };
    stand.gute.push((await koppeln(w, "katalog_verkauft")).access_token);
    stand.fremde.push((await koppeln(w, "katalog_entwurf")).access_token);
    const ziele = new Set();
    for (let i = 0; i < Math.ceil(RUNDEN / 2); i++) {
      const e = await runde(w, z, stand);
      if (e.erwartung?.verkauf) ziele.add(e.erwartung.shopId);
      befunde.push(...bewerten(w, stand, e, { streng: false }), ...zustand(w));
    }
    befunde.push(...waechterBefunde(w.netz));
    for (const it of kat.items) if (w.netz.verkaufCommits(it.id) && !ziele.has(it.id)) befunde.push(`ohne Meldung verkauft: ${it.id}`);
  } finally { w.netz.zurueck(); }
  assert.deepEqual(nurEinmal(befunde).slice(0, 30), []);
});
