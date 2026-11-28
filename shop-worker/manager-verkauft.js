// PC Manager -> Shop: ein anderswo (Vinted, eBay, sonstwo) verkauftes Stueck im
// Shop als verkauft markieren, damit es nicht zweimal verkauft wird (Freigabe
// "katalog_verkauft", Migration 0059). Bisher tat das der Inhaber von Hand in
// der Admin-App.
//
//   POST /manager/katalog/verkauft
//     {artikelnummer:"213", plattform:"vinted"|"ebay"|"sonstige", verkauft_am:"YYYY-MM-DD", request_id:"<uuid>"}
//   200 {ok, status:"SOLD", artikelnummer, shop_id, bereits:false}   jetzt auf SOLD gestellt
//   200 {ok, status:"SOLD", artikelnummer, shop_id, bereits:true}    stand schon auf SOLD
//   200 {ok, nicht_im_shop:true, artikelnummer, shop_id, status}     Entwurf, verborgen, nicht mehr im Katalog
//   409 {error:"in_bestellung", bestellung, bestellstatus, art}      steckt in einer offenen Shop-Bestellung
//   404 {error:"artikel_unbekannt"}      400 {error:"anfrage_ungueltig", feld}
//   502 {error:"github_nicht_erreichbar", detail}  Katalog nicht les- oder schreibbar (auch Netzfehler) - spaeter erneut
//   503 {error:"katalog_nicht_eingerichtet"}
//
// Artikelnummer -> Shop-ID: config/catalog-number-links.json ("links", vom
// Inhaber bestaetigt) und sonst das Feld "article" in data/items.json. Eine
// feste Rechenregel (6000+Nummer, 9000+Manager-ID) gibt es nicht: #213 ist
// 6216, #1 ist 9372. Ausgeschlossene IDs (excluded_shop_ids) und stillgelegte
// Nummern (retired_links) gelten als "nicht im Shop".
//
// Katalog: genau der Weg der Kasse nach einer Zahlung - markCatalogSold
// (worker.js) schreibt einen direkten Commit "Verkauft: Artikel <Shop-ID>",
// der nur die beiden Statuszeilen aendert. Nur so laesst der Main-Waechter
// (scripts/main_provenance.py) einen direkten Push stehen. Die Kasse liest den
// Katalog bei jedem Kauf frisch von main (worker.js loadItems): Ab dem Commit
// ist das Stueck nicht mehr kaufbar, der Rebuild aendert nur noch die Anzeige.
//
// D1: Vor dem Commit haelt eine kurze Reservierung (dieselbe wie in der Kasse:
// reservations RESERVED + inventory RESERVED) das Stueck fest - so kann es
// niemand zwischen Pruefung und Commit in die Kasse legen. Ohne Halt kein
// Commit: Greift eine Kasse oder Miete nach der Pruefung zu, scheitert der
// Halt und es gibt 409 (Fuzzing 28.11.2026: der Halt wurde uebersprungen,
// sobald das Lagerstueck schon RESERVED war - genau dann). Danach steht
// inventory.catalog_status auf SOLD und der Halt ist wieder frei. Scheitert
// der Commit, wird der Halt sofort freigegeben (sonst laeuft er nach fuenf
// Minuten ab).
//
// Steckt das Stueck in einer offenen Shop-Bestellung (reserviert, bezahlt,
// gepackt, unterwegs, Ruecksendung offen) oder einer Miete, aendert sich
// nichts: 409 - das ist der Doppelverkauf, den der Inhaber entscheiden muss.
// Testshop (SANDBOX=1): Katalog vom oeffentlichen main, "verkauft" nur in D1.
import { catalogDisplayName, safeText } from "./commerce-core.js";
import { GithubError, SHOP_REPO, branchHead, readRepoFile } from "./github-datei.js";
import { sendTelegramMessage, telegramZeile } from "./notifications.js";
import { istSandbox, sandboxKatalogLaden } from "./sandbox.js";
import { cleanupExpired, ensureInventory, markCatalogSold } from "./worker.js";

const ITEMS_PATH = "data/items.json";
const LINKS_PATH = "config/catalog-number-links.json";
const USER_AGENT = "disorder119-manager-verkauft";
const RAW = `https://raw.githubusercontent.com/${SHOP_REPO.owner}/${SHOP_REPO.repo}/${SHOP_REPO.branch}/`;
const MAX_BODY = 4096;
const NUMMER = /^[1-9]\d{0,6}(?:-\d{1,3})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;
export const PLATTFORMEN = Object.freeze({ vinted: "Vinted", ebay: "eBay", sonstige: "einer anderen Plattform" });
// Halt waehrend des Commits; laeuft von selbst ab, falls der Worker abbricht.
export const HALT_SEKUNDEN = 5 * 60;
export const HALT_PREFIX = "manager-verkauft:";
// Ein zweiter Versuch mit derselben request_id wartet so lange auf den ersten.
const IN_ARBEIT_MS = 2 * 60 * 1000;
// Bestellung haelt das Stueck: alles ausser zugestellt, storniert, zurueck, erstattet.
const BESTELLUNG_OFFEN = Object.freeze(["RESERVED", "PAYMENT_PENDING", "PAID", "PREPARING", "SHIPPED", "RETURN_REQUESTED"]);
const MIETE_AKTIV = Object.freeze(["RESERVED", "PAYMENT_PENDING", "CONFIRMED", "ACTIVE", "RETURN_DUE"]);
const liste = werte => werte.map(w => `'${w}'`).join(",");

class VerkauftFehler extends Error {
  constructor(status, body) {
    super(String(body?.error || "fehler"));
    this.status = status;
    this.body = body;
  }
}

// ------------------------------------------------------------- reine Logik

function gueltigesDatum(text, jetzt) {
  const m = DATUM.exec(text);
  if (!m) return false;
  const [jahr, monat, tag] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(jahr, monat - 1, tag));
  if (d.getUTCFullYear() !== jahr || d.getUTCMonth() !== monat - 1 || d.getUTCDate() !== tag) return false;
  // Nicht in der Zukunft - ein Tag Spielraum, der Manager rechnet in deutscher Zeit.
  return jahr >= 2000 && d.getTime() <= jetzt.getTime() + 86400 * 1000;
}

/** Koerper pruefen; wirft 400 {error:"anfrage_ungueltig", feld}. */
export function eingabePruefen(v, jetzt = new Date()) {
  const falsch = feld => { throw new VerkauftFehler(400, { error: "anfrage_ungueltig", feld }); };
  const nummer = typeof v?.artikelnummer === "number" && Number.isSafeInteger(v.artikelnummer) ? String(v.artikelnummer) : v?.artikelnummer;
  if (typeof nummer !== "string" || !NUMMER.test(nummer.trim())) falsch("artikelnummer");
  if (typeof v.plattform !== "string" || !Object.hasOwn(PLATTFORMEN, v.plattform)) falsch("plattform");
  if (typeof v.verkauft_am !== "string" || !gueltigesDatum(v.verkauft_am, jetzt)) falsch("verkauft_am");
  if (typeof v.request_id !== "string" || !UUID.test(v.request_id)) falsch("request_id");
  return { artikelnummer: nummer.trim(), plattform: v.plattform, verkauftAm: v.verkauft_am, requestId: v.request_id.toLowerCase() };
}

/**
 * Manager-Artikelnummer -> Katalogeintrag.
 * {item, shopId} | {item, shopId, ausgeschlossen:true} | {item:null, shopId} (stillgelegt) | null (unbekannt)
 */
export function artikelAufloesen(items, links, nummer) {
  const gleich = wert => String(wert ?? "").trim() === nummer;
  const link = (links?.links || []).find(l => gleich(l.article));
  if (link) return { item: items.find(it => String(it.id) === String(link.shop_id)) || null, shopId: Number(link.shop_id) };
  const ausgeschlossen = new Set((links?.excluded_shop_ids || []).map(String));
  const treffer = items.filter(it => gleich(it.article) && !ausgeschlossen.has(String(it.id)));
  if (treffer.length > 1) throw new VerkauftFehler(409, { error: "nummer_mehrdeutig", shop_ids: treffer.map(it => Number(it.id)) });
  if (treffer.length === 1) return { item: treffer[0], shopId: Number(treffer[0].id) };
  const alt = items.find(it => gleich(it.article));
  if (alt) return { item: alt, shopId: Number(alt.id), ausgeschlossen: true };
  const still = (links?.retired_links || []).find(l => gleich(l.article));
  if (still) return { item: null, shopId: Number(still.shop_id) };
  return null;
}

const datumDe = iso => iso.split("-").reverse().join(".");

export function telegramText(eingabe, item) {
  const titel = telegramZeile(catalogDisplayName(item), 120);
  return `Manager: Artikel ${eingabe.artikelnummer} auf ${PLATTFORMEN[eingabe.plattform]} verkauft – im Shop ausgeblendet\n`
    + `${titel} · verkauft am ${datumDe(eingabe.verkauftAm)}`;
}

// --------------------------------------------------------------- Katalog

// Netzfehler (fetch wirft TypeError), unlesbare Antworten (SyntaxError) und
// eine ausgefallene Katalogquelle im Testshop heissen "GitHub nicht
// erreichbar" (502, der Manager versucht es spaeter) - nicht 500.
function alsGithubFehler(err) {
  if (err instanceof VerkauftFehler || err instanceof GithubError) return err;
  let code = null;
  if (err instanceof SyntaxError) code = "github_antwort_unlesbar";
  else if (err instanceof TypeError) code = "github_netz";
  else if (/^sandbox_katalog_http_\d{3}$/.test(String(err?.message))) code = err.message;
  if (!code) return err;
  const fehler = new GithubError(code);
  fehler.ursache = safeText(err?.message || "unknown", 120);
  return fehler;
}

async function katalogLesen(env) {
  try {
    return await katalogHolen(env);
  } catch (err) {
    throw alsGithubFehler(err);
  }
}

async function katalogHolen(env) {
  if (istSandbox(env)) {
    // Testshop: oeffentlicher main-Stand, im Testshop Verkauftes aus D1 obendrauf.
    const { items } = await sandboxKatalogLaden(env);
    const res = await fetch(RAW + LINKS_PATH, { headers: { "User-Agent": USER_AGENT }, cf: { cacheTtl: 0 } });
    if (!res.ok) throw new GithubError(`raw_${res.status}`, res.status);
    return { items, links: JSON.parse(await res.text()) };
  }
  if (!env.GITHUB_TOKEN) throw new VerkauftFehler(503, { error: "katalog_nicht_eingerichtet" });
  const head = await branchHead(env, { userAgent: USER_AGENT });
  const [items, links] = await Promise.all([ITEMS_PATH, LINKS_PATH].map(async pfad =>
    JSON.parse((await readRepoFile(env, pfad, { userAgent: USER_AGENT, ref: head.commitSha })).text)));
  return { items, links };
}

// --------------------------------------------------------------- D1

/** Haelt eine offene Bestellung, Miete oder Kasse das Stueck? Dann der 409-Koerper. */
async function offeneBestellung(env, shopId) {
  const db = env.DB;
  const inv = await db.prepare("SELECT id FROM inventory WHERE item_id=?").bind(shopId).first();
  if (!inv) return null; // nie in der Kasse gewesen: keine Bestellung moeglich
  // Abgelaufene Reservierungen und verwaiste Kassen zuerst aufraeumen (wie die Kasse).
  await cleanupExpired(env, inv.id);
  const bestellung = await db.prepare(`SELECT o.order_number,o.status FROM order_items oi JOIN commerce_orders o ON o.id=oi.order_id
    WHERE oi.inventory_id=? AND o.status IN (${liste(BESTELLUNG_OFFEN)}) ORDER BY o.created_at DESC LIMIT 1`).bind(inv.id).first();
  if (bestellung) return { error: "in_bestellung", bestellung: bestellung.order_number, bestellstatus: bestellung.status, art: "bestellung" };
  const miete = await db.prepare(`SELECT status FROM rental_reservations WHERE inventory_id=? AND status IN (${liste(MIETE_AKTIV)})
    ORDER BY created_at DESC LIMIT 1`).bind(inv.id).first();
  if (miete) return { error: "in_bestellung", bestellung: null, bestellstatus: miete.status, art: "miete" };
  const halt = await db.prepare("SELECT idempotency_key FROM reservations WHERE inventory_id=? AND status='RESERVED' LIMIT 1").bind(inv.id).first();
  if (halt && String(halt.idempotency_key).startsWith(HALT_PREFIX)) return { error: "in_arbeit" };
  // Jemand ist gerade in der Kasse (reserviert, PayPal-Bestellung noch nicht angelegt).
  if (halt) return { error: "in_bestellung", bestellung: null, bestellstatus: "RESERVED", art: "kasse" };
  return null;
}

/**
 * Stueck festhalten wie die Kasse (reserveForPurchase): eine Reservierung,
 * inventory RESERVED. Auch fuer ein Lagerstueck, das gerade nicht AVAILABLE
 * ist (z. B. REFUNDED): Die Reservierung allein sperrt dann Kasse und Miete -
 * scheitern darf der Halt nur an einer anderen Reservierung oder Miete.
 */
async function festhalten(env, inventoryId, requestId) {
  const db = env.DB, id = crypto.randomUUID(), jetzt = new Date(), stamp = jetzt.toISOString();
  const bis = new Date(jetzt.getTime() + HALT_SEKUNDEN * 1000).toISOString();
  const r = await db.batch([
    db.prepare(`INSERT INTO reservations (id,inventory_id,kind,status,idempotency_key,expires_at,created_at)
      SELECT ?,id,'PURCHASE','RESERVED',?,?,? FROM inventory
      WHERE id=? AND catalog_status='AVAILABLE'
      AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.inventory_id=inventory.id AND r.status='RESERVED')
      AND NOT EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.inventory_id=inventory.id AND rr.status IN (${liste(MIETE_AKTIV)}))`)
      .bind(id, `${HALT_PREFIX}${requestId}:${id}`, bis, stamp, inventoryId),
    db.prepare(`UPDATE inventory SET status='RESERVED',updated_at=?,version=version+1
      WHERE id=? AND status='AVAILABLE' AND EXISTS (SELECT 1 FROM reservations WHERE id=? AND status='RESERVED')`)
      .bind(stamp, inventoryId, id),
  ]);
  return r[0]?.meta?.changes ? id : null;
}

/** Halt loesen; nach dem Commit zugleich catalog_status SOLD (sperrt Kasse und Miete). */
async function loesen(env, haltId, inventoryId, verkauft) {
  const db = env.DB, stamp = new Date().toISOString(), schritte = [];
  if (haltId) schritte.push(db.prepare("UPDATE reservations SET status='CANCELLED',updated_at=? WHERE id=? AND status='RESERVED'").bind(stamp, haltId));
  if (verkauft) schritte.push(db.prepare("UPDATE inventory SET catalog_status='SOLD',updated_at=?,version=version+1 WHERE id=? AND catalog_status!='SOLD'").bind(stamp, inventoryId));
  if (haltId) {
    schritte.push(db.prepare(`UPDATE inventory SET status='AVAILABLE',updated_at=?,version=version+1 WHERE id=? AND status='RESERVED'
      AND NOT EXISTS (SELECT 1 FROM reservations WHERE inventory_id=? AND status='RESERVED')
      AND NOT EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.inventory_id=? AND rr.status IN (${liste(MIETE_AKTIV)}))`)
      .bind(stamp, inventoryId, inventoryId, inventoryId));
  }
  if (schritte.length) await db.batch(schritte);
}

async function protokoll(env, ereignis, eingabe, access, shopId, extra = {}) {
  try {
    await env.DB.prepare(`INSERT INTO audit_events
      (id,actor_type,actor_ref,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(
        crypto.randomUUID(), "ADMIN", `manager:${access.id}`, "catalog_item",
        shopId ? String(shopId) : `artikel:${eingabe.artikelnummer}`, ereignis, eingabe.requestId,
        JSON.stringify({ artikelnummer: eingabe.artikelnummer, plattform: eingabe.plattform, verkauftAm: eingabe.verkauftAm,
          geraet: safeText(access.device_name || "", 60), ...extra }),
        new Date().toISOString(),
      ).run();
  } catch (err) {
    // Das Protokoll darf eine schon geschehene Markierung nicht scheitern lassen.
    console.error(JSON.stringify({ level: "error", event: "manager_verkauft_audit_failed", ereignis, message: safeText(err?.message || "unknown", 120) }));
  }
}

// --------------------------------------------------------- Idempotenz

async function beanspruchen(env, eingabe, access) {
  const db = env.DB, versuch = crypto.randomUUID(), stamp = new Date().toISOString();
  await db.prepare(`INSERT OR IGNORE INTO manager_verkauft_meldungen
    (request_id,grant_id,artikelnummer,plattform,verkauft_am,versuch,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(eingabe.requestId, access.id, eingabe.artikelnummer, eingabe.plattform, eingabe.verkauftAm, versuch, stamp, stamp).run();
  const row = await db.prepare("SELECT * FROM manager_verkauft_meldungen WHERE request_id=?").bind(eingabe.requestId).first();
  // Weg zwischen Anlegen und Lesen: ein gleichzeitiger Versuch mit derselben
  // request_id hatte den Eintrag und hat ihn nach einer Absage (409/502)
  // freigegeben - wie "laeuft noch", der Manager wiederholt (vorher 500).
  if (!row) throw new VerkauftFehler(409, { error: "in_arbeit" });
  if (row.artikelnummer !== eingabe.artikelnummer || row.plattform !== eingabe.plattform || row.verkauft_am !== eingabe.verkauftAm) {
    throw new VerkauftFehler(409, { error: "request_id_wiederverwendet" });
  }
  if (row.antwort_json) return { antwort: { status: Number(row.antwort_status) || 200, body: JSON.parse(row.antwort_json) } };
  if (row.versuch === versuch) return { requestId: eingabe.requestId, versuch };
  // Ein anderer Versuch laeuft noch - oder ist abgebrochen: erst nach IN_ARBEIT_MS uebernehmen.
  if (Date.parse(row.updated_at) > Date.now() - IN_ARBEIT_MS) throw new VerkauftFehler(409, { error: "in_arbeit" });
  const r = await db.prepare(`UPDATE manager_verkauft_meldungen SET versuch=?,grant_id=?,updated_at=?
    WHERE request_id=? AND antwort_json IS NULL AND versuch IS ? AND updated_at=?`)
    .bind(versuch, access.id, stamp, eingabe.requestId, row.versuch, row.updated_at).run();
  if (r.meta.changes !== 1) throw new VerkauftFehler(409, { error: "in_arbeit" });
  return { requestId: eingabe.requestId, versuch };
}

async function festschreiben(env, claim, ergebnis, shopId) {
  try {
    await env.DB.prepare(`UPDATE manager_verkauft_meldungen SET antwort_status=?,antwort_json=?,shop_id=?,versuch=NULL,updated_at=?
      WHERE request_id=? AND versuch=?`).bind(ergebnis.status, JSON.stringify(ergebnis.body), shopId ?? null,
      new Date().toISOString(), claim.requestId, claim.versuch).run();
  } catch (err) {
    // Dann prueft eine Wiederholung neu - am Katalog aendert sie nichts mehr (bereits:true).
    console.error(JSON.stringify({ level: "error", event: "manager_verkauft_idempotency_failed", message: safeText(err?.message || "unknown", 120) }));
  }
}

async function freigeben(env, claim) {
  try {
    await env.DB.prepare("DELETE FROM manager_verkauft_meldungen WHERE request_id=? AND versuch=? AND antwort_json IS NULL")
      .bind(claim.requestId, claim.versuch).run();
  } catch {
    // Dann uebernimmt eine Wiederholung den Eintrag nach IN_ARBEIT_MS.
  }
}

// --------------------------------------------------------------- Ablauf

async function verkaufen(env, eingabe, access, reqId) {
  const { items, links } = await katalogLesen(env);
  const treffer = artikelAufloesen(items, links, eingabe.artikelnummer);
  if (!treffer) return { status: 404, body: { error: "artikel_unbekannt" } };
  const basis = { artikelnummer: eingabe.artikelnummer, shop_id: treffer.shopId };
  const testshop = istSandbox(env) ? { testshop: true } : {};
  const status = String(treffer.item?.public_status || "").toUpperCase();

  // 1. Doppelverkauf? Dann bleibt alles, wie es ist - auch bei schon SOLD.
  const konflikt = treffer.item ? await offeneBestellung(env, treffer.shopId) : null;
  if (konflikt) {
    if (konflikt.error === "in_bestellung") await protokoll(env, "MANAGER_VERKAUFT_IN_BESTELLUNG", eingabe, access, treffer.shopId, { bestellung: konflikt.bestellung, art: konflikt.art });
    return { status: 409, body: konflikt };
  }
  // 2. Nicht oeffentlich (Entwurf, verborgen, ausgeschlossen, stillgelegt): nichts zu tun.
  if (!treffer.item || treffer.ausgeschlossen || !["AVAILABLE", "SOLD"].includes(status)) {
    await protokoll(env, "MANAGER_VERKAUFT_NICHT_IM_SHOP", eingabe, access, treffer.shopId, { status: status || "ENTFERNT" });
    return { status: 200, body: { ok: true, nicht_im_shop: true, ...basis, status: status || "ENTFERNT", ...testshop } };
  }
  // 3. Schon verkauft: kein zweiter Commit; D1 nachziehen, falls das Stueck dort noch frei steht.
  if (status === "SOLD") {
    await env.DB.prepare("UPDATE inventory SET catalog_status='SOLD',updated_at=?,version=version+1 WHERE item_id=? AND catalog_status!='SOLD'")
      .bind(new Date().toISOString(), treffer.shopId).run();
    await protokoll(env, "MANAGER_VERKAUFT_BEREITS", eingabe, access, treffer.shopId);
    return { status: 200, body: { ok: true, status: "SOLD", ...basis, bereits: true, ...testshop } };
  }

  // 4. Verfuegbar: festhalten, Commit "Verkauft: Artikel <Shop-ID>", Halt loesen.
  const inv = await ensureInventory(env, treffer.item);
  await cleanupExpired(env, inv.id);
  // Immer festhalten: Steht das Lagerstueck inzwischen auf RESERVED, hat seit
  // Schritt 1 eine Kasse oder Miete zugegriffen - dann scheitert der Halt, 409.
  const halt = await festhalten(env, inv.id, eingabe.requestId);
  if (!halt) {
    const k = (await offeneBestellung(env, treffer.shopId)) || { error: "in_bestellung", bestellung: null, bestellstatus: null, art: "kasse" };
    if (k.error === "in_bestellung") await protokoll(env, "MANAGER_VERKAUFT_IN_BESTELLUNG", eingabe, access, treffer.shopId, { bestellung: k.bestellung, art: k.art });
    return { status: 409, body: k };
  }
  try {
    await markCatalogSold(env, treffer.shopId);
  } catch (err) {
    await loesen(env, halt, inv.id, false).catch(() => {}); // sonst nach HALT_SEKUNDEN
    throw alsGithubFehler(err);
  }
  try {
    await loesen(env, halt, inv.id, true);
  } catch (err) {
    // Der Katalog steht schon auf SOLD (die Kasse liest ihn frisch) - der Halt laeuft ab.
    console.error(JSON.stringify({ level: "error", event: "manager_verkauft_release_failed", requestId: reqId, shopId: treffer.shopId,
      message: safeText(err?.message || "unknown", 120) }));
  }
  await protokoll(env, "MANAGER_VERKAUFT", eingabe, access, treffer.shopId, { commit: `Verkauft: Artikel ${treffer.shopId}` });
  try {
    await sendTelegramMessage(env, telegramText(eingabe, treffer.item), reqId);
  } catch (err) {
    console.warn(JSON.stringify({ level: "warn", event: "manager_verkauft_telegram_failed", requestId: reqId, message: safeText(err?.message || "unknown", 120) }));
  }
  return { status: 200, body: { ok: true, status: "SOLD", ...basis, bereits: false, ...testshop } };
}

async function begrenzen(env, access) {
  if (!env.RATE_LIMITER?.limit) throw new VerkauftFehler(503, { error: "MANAGER_RATE_LIMIT_UNAVAILABLE" });
  const ok = await env.RATE_LIMITER.limit({ key: `manager:verkauft:${access.id}` });
  if (!ok?.success) throw new VerkauftFehler(429, { error: "MANAGER_RATE_LIMITED" });
}

async function jsonLesen(request) {
  const falsch = () => new VerkauftFehler(400, { error: "anfrage_ungueltig", feld: "body" });
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") || "")) throw falsch();
  const text = await request.text();
  if (text.length > MAX_BODY) throw falsch();
  let v;
  try { v = JSON.parse(text); } catch { throw falsch(); }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw falsch();
  return v;
}

const antwort = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
});

/** POST /manager/katalog/verkauft - die Freigabe ist schon geprueft (manager-connection.js). */
export async function handleManagerVerkauft(request, env, url, access) {
  const reqId = crypto.randomUUID();
  let claim = null;
  try {
    if (request.method !== "POST") throw new VerkauftFehler(405, { error: "MANAGER_ROUTE_NOT_ALLOWED" });
    await begrenzen(env, access);
    const eingabe = eingabePruefen(await jsonLesen(request));
    claim = await beanspruchen(env, eingabe, access);
    if (claim.antwort) return antwort(claim.antwort.body, claim.antwort.status);
    const ergebnis = await verkaufen(env, eingabe, access, reqId);
    // Nur fertige 200-Antworten bleiben stehen; 409/404 prueft eine Wiederholung neu.
    if (ergebnis.status === 200) await festschreiben(env, claim, ergebnis, ergebnis.body.shop_id);
    else await freigeben(env, claim);
    return antwort(ergebnis.body, ergebnis.status);
  } catch (err) {
    if (claim?.versuch) await freigeben(env, claim);
    if (err instanceof VerkauftFehler) return antwort(err.body, err.status);
    if (err instanceof GithubError) {
      console.error(JSON.stringify({ level: "error", event: "manager_verkauft_github_failed", requestId: reqId, code: err.code,
        ...(err.ursache ? { ursache: err.ursache } : {}) }));
      return antwort({ error: "github_nicht_erreichbar", detail: err.code }, 502);
    }
    const code = String(err?.message || "");
    if (code === "catalog_mark_sold_conflict" || code === "catalog_item_missing") return antwort({ error: "katalog_konflikt" }, 409);
    if (err?.code === "CATALOG_BACKEND_NOT_CONFIGURED") return antwort({ error: "katalog_nicht_eingerichtet" }, 503);
    console.error(JSON.stringify({ level: "error", event: "manager_verkauft_failed", requestId: reqId, message: safeText(code || "unknown", 160) }));
    return antwort({ error: "interner_fehler" }, 500);
  }
}
