// Abholorte aus OpenStreetMap fuer die Kasse: DHL-Packstationen und
// -Postfilialen mit Nummer, PLZ und Ort - ohne den DHL Location Finder.
//
// Warum OpenStreetMap: Die Location-Finder-Bedingungen verbieten, die
// Standortdaten in irgendeiner Form zu speichern (abholorte.js, Inhaber
// 05.11.2026: "nur, was erlaubt ist"). OpenStreetMap-Daten stehen unter der
// Open Database License (ODbL 1.0): speichern und zwischenspeichern ist
// erlaubt, solange beim Anzeigen der Quellenvermerk "(c) OpenStreetMap-
// Mitwirkende" mit Link auf openstreetmap.org/copyright dabeisteht - die Kasse
// zeigt ihn unter Liste und Karte (OSM_QUELLENVERMERK). Die Tabellen hier sind
// ein gefilterter Auszug (abgeleitete Datenbank im Sinne der ODbL); wie er
// entsteht, steht vollstaendig in diesem Modul (Abfrage und Filter unten).
//
// Ablauf:
//   * Einlesen (Cron ABHOLORTE_OSM_CRONS, eigener Lauf in worker-entry.js):
//     je Lauf eine Leitregion (die ersten zwei Ziffern der PLZ, "01" bis
//     "99"), hoechstens einmal je Woche je Gebiet. Eine Overpass-Abfrage
//     liefert die PLZ-Gebiete (boundary=postal_code, Mitte und Ort) und je
//     Gebiet die Packstationen und Filialen darin - so bekommt auch eine
//     Packstation ohne addr:postcode (in OSM die meisten) ihre PLZ. Geschrieben
//     wird nur der Unterschied zum letzten Stand, in einem einzigen
//     D1-Batch (eine Transaktion): Faellt Overpass aus, kommt die Antwort
//     unvollstaendig (ohne Schlusszeile) oder unplausibel klein, bleibt der
//     alte Stand unveraendert stehen.
//   * Suche (GET /versand/abholorte, abholorte.js): nur aus D1 - Mitte der PLZ,
//     dann die naechsten Orte im Umkreis. Je Kasse geht keine Anfrage an
//     Overpass, DHL oder sonst wohin.
//
// Packstation: amenity=parcel_locker der Marke DHL/Deutsche Post (auch die
// neuere Poststation), Nummer in ref. Filiale: amenity=post_office von
// Deutscher Post/DHL mit Filialnummer in ref (auch Partnerfilialen,
// post_office=post_partner). Ohne gueltige Nummer (1-4 Ziffern) laesst sich ein
// Ort nicht adressieren ("Packstation 125", "Postfiliale 593") - er faellt weg,
// ebenso Schliessfaecher anderer Anbieter (Amazon, Hermes, DPD, GLS ...) und
// private Anlagen (access=private/no).
import { safeText } from "./commerce-core.js";

export const OSM_QUELLENVERMERK = Object.freeze({
  text: "© OpenStreetMap-Mitwirkende",
  url: "https://www.openstreetmap.org/copyright",
  lizenz: "ODbL 1.0",
});

// Eigene Cron-Ausdruecke (wrangler.toml): ein Gebiet je Stunde, getrennt vom
// Viertelstunden-Cron mit Zahlungen und Versand - so teilen sich die beiden
// weder Rechenzeit noch Abfragen. Shop zur Minute 7, Testshop zur Minute 37
// (nie gleichzeitig bei Overpass).
export const ABHOLORTE_OSM_CRONS = Object.freeze(["7 * * * *", "37 * * * *"]);
export function istAbholorteOsmCron(cron) {
  return ABHOLORTE_OSM_CRONS.includes(String(cron || ""));
}

// Leitregionen "01" bis "99" (unbenutzte liefern einfach nichts).
export const GEBIETE = Object.freeze(Array.from({ length: 99 }, (_, i) => String(i + 1).padStart(2, "0")));

const TAG_MS = 24 * 60 * 60 * 1000;
const STUNDE_MS = 60 * 60 * 1000;
// Hoechstens einmal je Woche je Gebiet (Overpass-Nutzungsregeln: wenige grosse Abfragen).
export const AUFFRISCHEN_MS = 7 * TAG_MS;
const OVERPASS_STANDARD = Object.freeze([
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
]);
const USER_AGENT = "Disorder119-Shop (kontakt@disorder119.com)";
const OVERPASS_TIMEOUT_S = 240;
const ABRUF_TIMEOUT_MS = 270 * 1000;
const MAX_ANTWORT_BYTES = 8 * 1024 * 1024;
const ENDE = "d119ende";
const TAGS = Object.freeze([
  "postal_code", "note", "name", "amenity", "ref", "brand", "operator", "post_office:brand", "access",
  "addr:street", "addr:housenumber", "addr:postcode", "addr:city",
]);
// Umkreis um die Mitte der PLZ: 5 km, auf dem Land bis 10 km, hoechstens 15 Orte.
const RADIUS_M = 5000;
const RADIUS_WEIT_M = 10000;
const MIN_NAH = 3;
const MAX_ORTE = 15;
const SCHREIB_BLOCK = 400;

export class OsmImportError extends Error {
  constructor(code, detail = "") {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

// ABHOLORTE_OSM = "aus" schaltet Einlesen und Suche ab (Kasse: Eingabe von Hand).
export function osmAbgeschaltet(env = {}) {
  return String(env?.ABHOLORTE_OSM || "").trim().toLowerCase() === "aus";
}

function overpassZiele(env = {}) {
  const eigene = String(env?.OVERPASS_URL || "").split(",").map(s => s.trim()).filter(s => /^https:\/\/[^\s]+$/.test(s));
  return eigene.length ? eigene : [...OVERPASS_STANDARD];
}

// ------------------------------------------------------------------ Abfrage

// Eine Leitregion: jedes PLZ-Gebiet (Mitte, Ort) und die Abholorte darin. Die
// Schlusszeile (make) zeigt, dass Overpass die Abfrage ganz beantwortet hat -
// bei Zeitueberschreitung fehlt sie.
export function overpassAbfrage(gebiet) {
  if (!/^\d{2}$/.test(String(gebiet))) throw new OsmImportError("GEBIET_UNGUELTIG");
  const spalten = ["::type", "::id", "::lat", "::lon", ...TAGS.map(t => `"${t}"`), `"ende"`].join(",");
  return `[out:csv(${spalten};true;"\\t")][timeout:${OVERPASS_TIMEOUT_S}];
area["ISO3166-1"="DE"]["admin_level"="2"]->.de;
rel["boundary"="postal_code"]["postal_code"~"^${gebiet}[0-9]{3}$"](area.de)->.gebiete;
foreach.gebiete->.r(
  .r out center;
  .r map_to_area->.flaeche;
  nwr(area.flaeche)["amenity"~"^(parcel_locker|post_office)$"]["ref"];
  out center;
);
make ${ENDE} ende="ok";
out;`;
}

// Overpass-CSV (Tabulator, Kopfzeile). Werte mit Komma setzt Overpass in
// Anfuehrungszeichen.
export function csvLesen(text) {
  const zeilen = String(text || "").replace(/\r/g, "").split("\n");
  const kopf = (zeilen.shift() || "").split("\t").map(s => s.trim());
  const out = [];
  for (const zeile of zeilen) {
    if (!zeile.trim()) continue;
    const werte = zeile.split("\t");
    const z = {};
    kopf.forEach((k, i) => { z[k] = wertLesen(werte[i]); });
    out.push(z);
  }
  return out;
}

function wertLesen(roh = "") {
  let s = String(roh ?? "");
  if (s.length >= 2 && s.startsWith("\"") && s.endsWith("\"")) s = s.slice(1, -1).replace(/""/g, "\"");
  return s.trim();
}

// ------------------------------------------------------------------ Filter

const DHL_MARKE = /\b(dhl|deutsche\s*post|packstation|poststation|postfiliale|post-?partnerfiliale|postagentur)\b/i;
const FREMDE_MARKE = /\b(amazon|hermes|dpd|gls|ups|fedex|myflexbox|bringme|deinfach|pickup|paketin)\b/i;
// ref "125", "Packstation 125", "DHL Paketshop 742"; steht dort Unbrauchbares
// ("survey"), zaehlt ein Name wie "Postfiliale 652".
const NUMMER = /^(?:(?:dhl\s+)?(?:packstation|poststation|postfiliale|filiale|paketshop)\s*)?(\d{1,4})$/i;
const NUMMER_IM_NAMEN = /^(?:dhl\s+)?(?:packstation|poststation|postfiliale|paketshop)\s+(\d{1,4})$/i;
// Namen ohne eigenen Inhalt ("Deutsche Post", "DHL Packstation 120", "Postfiliale 593").
const NAME_OHNE_INHALT = /^(?:(?:dhl|deutsche\s*post(?:\s*ag)?)\s*)?(?:packstation|poststation|post\s*filiale|postfiliale|filiale|partnerfiliale|paketshop|shop|post|ag)?(?:\s*\d{1,4})?$/i;

function zahl(wert) {
  const n = Number(wert);
  return String(wert ?? "").trim() !== "" && Number.isFinite(n) ? n : NaN;
}
function rund(n) { return Math.round(n * 1e6) / 1e6; }
function inDeutschland(lat, lng) { return lat >= 47 && lat <= 55.2 && lng >= 5.5 && lng <= 15.5; }
function zeile(wert, max) { return safeText(wert, max).replace(/\s+/g, " ").trim(); }

// Ort eines PLZ-Gebiets aus note ("63739 Aschaffenburg", "66957 Vinningen,
// Trulben u.a.") oder name - der erste genannte Ort.
export function ortAusNotiz(note, name, plz) {
  for (const roh of [note, name]) {
    let s = zeile(roh, 200);
    if (plz && s.startsWith(plz)) s = s.slice(plz.length);
    s = s.replace(/^[\s,;:–-]+/, "").split(/[,;(]/)[0].replace(/\s+u\.\s*a\.?$/i, "").trim();
    if (s.length >= 2 && !/^\d+$/.test(s)) return s.slice(0, 80);
  }
  return "";
}

// Ein OSM-Eintrag (CSV-Zeile) -> Abholort der Kasse, oder { grund } warum nicht.
// umgebung: { plz, ort } des PLZ-Gebiets, in dem der Eintrag liegt; plzOrte:
// Ort je PLZ der Leitregion (falls addr:postcode auf ein Nachbargebiet zeigt).
export function osmPruefen(z, umgebung = {}, plzOrte = new Map()) {
  const amenity = String(z?.amenity || "");
  const typ = amenity === "parcel_locker" ? "packstation" : amenity === "post_office" ? "filiale" : null;
  if (!typ) return { grund: "ART" };
  const marke = [z.brand, z.operator, z["post_office:brand"], z.name].join(" ");
  if (!DHL_MARKE.test(marke) || FREMDE_MARKE.test([z.brand, z.operator].join(" "))) return { grund: "NICHT_DHL" };
  if (/^(private|no)$/i.test(String(z.access || "").trim())) return { grund: "PRIVAT" };
  const treffer = NUMMER.exec(String(z.ref || "").trim()) || NUMMER_IM_NAMEN.exec(zeile(z.name, 100));
  const nummer = treffer ? String(Number(treffer[1])) : "";
  if (!/^[1-9]\d{0,3}$/.test(nummer)) return { grund: "OHNE_NUMMER" };
  const lat = zahl(z["@lat"]);
  const lng = zahl(z["@lon"]);
  if (!inDeutschland(lat, lng)) return { grund: "OHNE_LAGE" };
  const eigenePlz = String(z["addr:postcode"] || "").trim();
  const plz = /^\d{5}$/.test(eigenePlz) ? eigenePlz : String(umgebung.plz || "");
  if (!/^\d{5}$/.test(plz)) return { grund: "OHNE_PLZ" };
  const stadt = zeile(z["addr:city"], 80);
  const ort = stadt.length >= 2 ? stadt : (plz === umgebung.plz ? umgebung.ort : plzOrte.get(plz) || umgebung.ort) || "";
  if (ort.length < 2) return { grund: "OHNE_ORT" };
  const typArt = String(z["@type"] || "").charAt(0);
  if (!["n", "w", "r"].includes(typArt) || !/^\d+$/.test(String(z["@id"] || ""))) return { grund: "OHNE_ID" };
  const name = `${typ === "packstation" ? "Packstation" : "Postfiliale"} ${nummer}`;
  const roherName = zeile(z.name, 100);
  // Bei Partnerfilialen der Laden ("Güdinger Lädchen"), wie beim DHL-Paketshop.
  const geschaeft = typ === "filiale" && roherName && !NAME_OHNE_INHALT.test(roherName) && roherName.toLowerCase() !== name.toLowerCase() ? roherName : "";
  return {
    ort: {
      id: `${typ}-${nummer}-${plz}`,
      typ,
      nummer,
      name,
      geschaeft,
      strasse: zeile([z["addr:street"], z["addr:housenumber"]].filter(Boolean).join(" "), 100),
      plz,
      ort,
      lat: rund(lat),
      lng: rund(lng),
      osmId: `${typArt}${z["@id"]}`,
    },
  };
}

export function osmAbholort(z, umgebung, plzOrte) {
  return osmPruefen(z, umgebung, plzOrte).ort || null;
}

// Antwort einer Leitregion -> { plz: [...], orte: [...], verworfen: { grund: n } }.
export function gebietAuswerten(text, gebiet) {
  const zeilen = csvLesen(text);
  const letzte = zeilen[zeilen.length - 1];
  if (!letzte || letzte["@type"] !== ENDE || letzte.ende !== "ok") throw new OsmImportError("OVERPASS_UNVOLLSTAENDIG");
  const plzGebiete = new Map();
  const roh = [];
  let umgebung = null;
  for (const z of zeilen.slice(0, -1)) {
    if (z["@type"] === "relation") {
      const plz = String(z.postal_code || "").trim();
      umgebung = /^\d{5}$/.test(plz) && plz.startsWith(gebiet) ? { plz, ort: ortAusNotiz(z.note, z.name, plz) } : null;
      const lat = zahl(z["@lat"]);
      const lng = zahl(z["@lon"]);
      if (umgebung && inDeutschland(lat, lng) && !plzGebiete.has(plz)) {
        plzGebiete.set(plz, { plz, lat: rund(lat), lng: rund(lng), ort: umgebung.ort });
      }
      continue;
    }
    if (umgebung) roh.push({ z, umgebung });
  }
  const plzOrte = new Map([...plzGebiete.values()].map(p => [p.plz, p.ort]));
  const orte = new Map();
  const osmIds = new Set();
  const verworfen = {};
  for (const { z, umgebung: u } of roh) {
    const { ort, grund } = osmPruefen(z, u, plzOrte);
    // Liegt ein Ort in zwei sich ueberlappenden PLZ-Gebieten, zaehlt das erste.
    const doppelt = ort && (osmIds.has(ort.osmId) || orte.has(ort.id));
    if (!ort || doppelt) {
      const g = grund || "DOPPELT";
      verworfen[g] = (verworfen[g] || 0) + 1;
      continue;
    }
    osmIds.add(ort.osmId);
    orte.set(ort.id, ort);
  }
  return { plz: [...plzGebiete.values()], orte: [...orte.values()], verworfen };
}

// ------------------------------------------------------------------ Laden

async function standardLaden(ziel, abfrage) {
  let res;
  try {
    res = await fetch(ziel, {
      method: "POST",
      headers: { "User-Agent": USER_AGENT, Accept: "text/csv", "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(abfrage)}`,
      signal: AbortSignal.timeout(ABRUF_TIMEOUT_MS),
    });
  } catch (err) {
    throw new OsmImportError("OVERPASS_NICHT_ERREICHBAR", safeText(err?.name || err?.message || "", 60));
  }
  if (res.status === 429) throw new OsmImportError("OVERPASS_LIMIT");
  if (!res.ok) throw new OsmImportError("OVERPASS_HTTP", String(res.status));
  const laenge = Number(res.headers.get("Content-Length") || 0);
  if (laenge > MAX_ANTWORT_BYTES) throw new OsmImportError("OVERPASS_ZU_GROSS");
  const text = await res.text();
  if (text.length > MAX_ANTWORT_BYTES) throw new OsmImportError("OVERPASS_ZU_GROSS");
  return text;
}

// Erst der Hauptserver, bei Fehler oder unvollstaendiger Antwort der naechste.
export async function gebietLaden(env, gebiet, { laden = standardLaden } = {}) {
  const abfrage = overpassAbfrage(gebiet);
  let letzter = null;
  for (const ziel of overpassZiele(env)) {
    try {
      const daten = gebietAuswerten(await laden(ziel, abfrage), gebiet);
      return { daten, quelle: safeText(new URL(ziel).host, 80) };
    } catch (err) {
      letzter = err instanceof OsmImportError ? err : new OsmImportError("OVERPASS_FEHLER", safeText(err?.message || "", 80));
    }
  }
  throw letzter || new OsmImportError("OVERPASS_NICHT_ERREICHBAR");
}

// ------------------------------------------------------------------ Schreiben

const ORT_FELDER = ["id", "typ", "nummer", "name", "geschaeft", "strasse", "plz", "ort", "lat", "lng", "osmId"];
function ortSchluessel(o) {
  return JSON.stringify(ORT_FELDER.map(k => (k === "geschaeft" ? o[k] || "" : o[k])));
}
function plzSchluessel(p) {
  return JSON.stringify([p.plz, p.lat, p.lng, p.ort || ""]);
}
function bloecke(liste, groesse = SCHREIB_BLOCK) {
  const out = [];
  for (let i = 0; i < liste.length; i += groesse) out.push(liste.slice(i, i + groesse));
  return out;
}

// Schreibt nur den Unterschied zum letzten Stand und den Gebietsstand - alles
// in einem Batch (D1: eine Transaktion, ganz oder gar nicht). Ein deutlich
// kleineres Ergebnis als vorher gilt als Overpass-Stoerung: dann bleibt alles.
export async function gebietSchreiben(db, gebiet, daten, { jetzt = new Date().toISOString(), dauerMs = null, quelle = null } = {}) {
  const [altOrte, altPlz] = await Promise.all([
    db.prepare("SELECT id,typ,nummer,name,geschaeft,strasse,plz,ort,lat,lng,osm_id AS osmId FROM abholorte_osm WHERE gebiet=?").bind(gebiet).all(),
    db.prepare("SELECT plz,lat,lng,ort FROM abholorte_osm_plz WHERE gebiet=?").bind(gebiet).all(),
  ]);
  const alteOrte = new Map((altOrte?.results || []).map(o => [o.id, o]));
  const altePlz = new Map((altPlz?.results || []).map(p => [p.plz, p]));
  const geschrumpft = (alt, neu, anteil, ab) => (alt >= ab && neu < alt * anteil) || (alt > 0 && neu === 0);
  if (geschrumpft(alteOrte.size, daten.orte.length, 0.5, 10) || geschrumpft(altePlz.size, daten.plz.length, 0.8, 5)) {
    throw new OsmImportError("UNPLAUSIBEL", `${daten.orte.length}/${alteOrte.size} Orte, ${daten.plz.length}/${altePlz.size} PLZ`);
  }
  const neueOrte = new Map(daten.orte.map(o => [o.id, o]));
  const neuePlz = new Map(daten.plz.map(p => [p.plz, p]));
  const ortWeg = [...alteOrte.keys()].filter(id => !neueOrte.has(id));
  const ortNeu = daten.orte.filter(o => !alteOrte.has(o.id) || ortSchluessel(alteOrte.get(o.id)) !== ortSchluessel(o));
  const plzWeg = [...altePlz.keys()].filter(plz => !neuePlz.has(plz));
  const plzNeu = daten.plz.filter(p => !altePlz.has(p.plz) || plzSchluessel(altePlz.get(p.plz)) !== plzSchluessel(p));

  const schritte = [];
  for (const block of bloecke(ortWeg)) {
    schritte.push(db.prepare("DELETE FROM abholorte_osm WHERE gebiet=? AND id IN (SELECT value FROM json_each(?))").bind(gebiet, JSON.stringify(block)));
  }
  for (const block of bloecke(ortNeu)) {
    schritte.push(db.prepare(`INSERT OR REPLACE INTO abholorte_osm (gebiet,id,typ,nummer,name,geschaeft,strasse,plz,ort,lat,lng,osm_id,stand)
      SELECT ?, json_extract(value,'$.id'), json_extract(value,'$.typ'), json_extract(value,'$.nummer'), json_extract(value,'$.name'),
        NULLIF(json_extract(value,'$.geschaeft'),''), json_extract(value,'$.strasse'), json_extract(value,'$.plz'), json_extract(value,'$.ort'),
        json_extract(value,'$.lat'), json_extract(value,'$.lng'), json_extract(value,'$.osmId'), ?
      FROM json_each(?)`).bind(gebiet, jetzt, JSON.stringify(block)));
  }
  for (const block of bloecke(plzWeg)) {
    schritte.push(db.prepare("DELETE FROM abholorte_osm_plz WHERE gebiet=? AND plz IN (SELECT value FROM json_each(?))").bind(gebiet, JSON.stringify(block)));
  }
  for (const block of bloecke(plzNeu)) {
    schritte.push(db.prepare(`INSERT OR REPLACE INTO abholorte_osm_plz (plz,gebiet,lat,lng,ort,stand)
      SELECT json_extract(value,'$.plz'), ?, json_extract(value,'$.lat'), json_extract(value,'$.lng'), json_extract(value,'$.ort'), ?
      FROM json_each(?)`).bind(gebiet, jetzt, JSON.stringify(block)));
  }
  schritte.push(db.prepare(`INSERT INTO abholorte_osm_gebiete (gebiet,punkte,plz,stand,versuch_am,naechster_versuch,fehlversuche,fehler,dauer_ms,quelle)
    VALUES (?,?,?,?,?,NULL,0,NULL,?,?)
    ON CONFLICT(gebiet) DO UPDATE SET punkte=excluded.punkte, plz=excluded.plz, stand=excluded.stand, versuch_am=excluded.versuch_am,
      naechster_versuch=NULL, fehlversuche=0, fehler=NULL, dauer_ms=excluded.dauer_ms, quelle=excluded.quelle`)
    .bind(gebiet, daten.orte.length, daten.plz.length, jetzt, jetzt, dauerMs, quelle));
  await db.batch(schritte);
  return {
    punkte: daten.orte.length,
    plz: daten.plz.length,
    neu: ortNeu.filter(o => !alteOrte.has(o.id)).length,
    geaendert: ortNeu.filter(o => alteOrte.has(o.id)).length,
    entfernt: ortWeg.length,
    plzGeaendert: plzNeu.length + plzWeg.length,
  };
}

// ------------------------------------------------------------------ Cron

// Das naechste faellige Gebiet: nie eingelesen zuerst, dann der aelteste
// Stand; nach Fehlern erst wieder ab naechster_versuch.
export function naechstesGebiet(stand, jetzt = Date.now()) {
  const je = new Map((stand || []).map(r => [r.gebiet, r]));
  const faellig = GEBIETE.map(gebiet => ({ gebiet, r: je.get(gebiet) }))
    .filter(({ r }) => !r || ((!r.stand || jetzt - Date.parse(r.stand) >= AUFFRISCHEN_MS)
      && (!r.naechster_versuch || Date.parse(r.naechster_versuch) <= jetzt)));
  faellig.sort((a, b) => (a.r?.stand ? Date.parse(a.r.stand) : -Infinity) - (b.r?.stand ? Date.parse(b.r.stand) : -Infinity));
  return faellig[0]?.gebiet || null;
}

function fehlendeTabelle(err) {
  return /no such table/i.test(String(err?.message || err));
}

async function fehlerMerken(db, gebiet, alt, code, jetzt) {
  const versuche = Number(alt?.fehlversuche || 0) + 1;
  // Pause nach Fehlern: 1, 2, 4 ... hoechstens 24 Stunden.
  const naechster = new Date(Date.parse(jetzt) + Math.min(TAG_MS, STUNDE_MS * 2 ** (versuche - 1))).toISOString();
  await db.prepare(`INSERT INTO abholorte_osm_gebiete (gebiet,punkte,plz,stand,versuch_am,naechster_versuch,fehlversuche,fehler)
    VALUES (?,0,0,NULL,?,?,?,?)
    ON CONFLICT(gebiet) DO UPDATE SET versuch_am=excluded.versuch_am, naechster_versuch=excluded.naechster_versuch,
      fehlversuche=excluded.fehlversuche, fehler=excluded.fehler`).bind(gebiet, jetzt, naechster, versuche, code).run();
}

// Ein Schritt: das naechste faellige Gebiet (oder `gebiet`) einlesen. Laeuft
// im eigenen Cron (stuendlich); ein Durchgang durch alle 99 Gebiete dauert so
// gut vier Tage, danach je Gebiet einmal die Woche.
export async function abholorteOsmPflegen(env, now = Date.now(), { gebiet = null, laden } = {}) {
  if (!env?.DB) return { uebersprungen: "OHNE_DB" };
  if (osmAbgeschaltet(env)) return { uebersprungen: "AUS" };
  let stand;
  try {
    stand = (await env.DB.prepare("SELECT gebiet,stand,naechster_versuch,fehlversuche FROM abholorte_osm_gebiete").all())?.results || [];
  } catch (err) {
    if (fehlendeTabelle(err)) return { uebersprungen: "OHNE_TABELLE" };
    throw err;
  }
  const ziel = gebiet ? String(gebiet) : naechstesGebiet(stand, Number(now));
  if (!ziel) return { uebersprungen: "AKTUELL" };
  if (!GEBIETE.includes(ziel)) return { uebersprungen: "GEBIET_UNGUELTIG" };
  const jetzt = new Date(Number(now)).toISOString();
  const beginn = Date.now();
  try {
    const { daten, quelle } = await gebietLaden(env, ziel, { laden });
    const ergebnis = await gebietSchreiben(env.DB, ziel, daten, { jetzt, dauerMs: Date.now() - beginn, quelle });
    console.log(JSON.stringify({ level: "info", event: "abholorte_osm_import", gebiet: ziel, quelle, ...ergebnis, verworfen: daten.verworfen }));
    return { gebiet: ziel, quelle, ...ergebnis, verworfen: daten.verworfen };
  } catch (err) {
    const code = err instanceof OsmImportError ? err.code : "FEHLER";
    const detail = safeText(err?.detail || (err instanceof OsmImportError ? "" : err?.message) || "", 120);
    await fehlerMerken(env.DB, ziel, stand.find(r => r.gebiet === ziel), code, jetzt);
    console.warn(JSON.stringify({ level: "warn", event: "abholorte_osm_import_fehler", gebiet: ziel, code, detail }));
    return { gebiet: ziel, fehler: code, detail };
  }
}

// ------------------------------------------------------------------ Suche

function abstandM(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Abholorte um die Mitte des PLZ-Gebiets - nur aus D1. Ergebnis { orte } wie
// abholorteAus (abholorte.js), entfernungM ab der Mitte der PLZ; null, wenn es
// fuer diese PLZ noch keine OSM-Daten gibt (Kasse: Nummer von Hand).
export async function osmAbholorteSuchen(env, plz) {
  if (!env?.DB || osmAbgeschaltet(env) || !/^\d{5}$/.test(String(plz))) return null;
  let mitte;
  try {
    mitte = await env.DB.prepare("SELECT lat,lng FROM abholorte_osm_plz WHERE plz=?").bind(plz).first();
    if (!mitte) {
      // Leitregion schon eingelesen, aber die PLZ hat in OSM kein Gebiet (z. B. Postfach-PLZ).
      const eingelesen = await env.DB.prepare("SELECT 1 AS da FROM abholorte_osm_gebiete WHERE gebiet=? AND stand IS NOT NULL").bind(plz.slice(0, 2)).first();
      return eingelesen ? { orte: [] } : null;
    }
  } catch (err) {
    if (fehlendeTabelle(err)) return null;
    throw err;
  }
  const lat = Number(mitte.lat);
  const lng = Number(mitte.lng);
  const dLat = RADIUS_WEIT_M / 111320;
  const kos = Math.cos(lat * Math.PI / 180);
  const dLng = RADIUS_WEIT_M / (111320 * Math.max(0.2, kos));
  const { results = [] } = await env.DB.prepare(`SELECT id,typ,nummer,name,geschaeft,strasse,plz,ort,lat,lng,osm_id AS osmId FROM abholorte_osm
    WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
    ORDER BY (lat-?)*(lat-?) + (lng-?)*(lng-?)*? LIMIT 60`)
    .bind(lat - dLat, lat + dLat, lng - dLng, lng + dLng, lat, lat, lng, lng, kos * kos).all();
  const gesehen = new Set();
  const alle = [];
  for (const r of results) {
    if (gesehen.has(r.id) || gesehen.has(r.osmId)) continue;
    gesehen.add(r.id);
    gesehen.add(r.osmId);
    const entfernungM = Math.round(abstandM({ lat, lng }, { lat: Number(r.lat), lng: Number(r.lng) }));
    if (entfernungM > RADIUS_WEIT_M) continue;
    alle.push({
      id: r.id,
      typ: r.typ,
      nummer: r.nummer,
      name: r.name,
      ...(r.geschaeft ? { geschaeft: r.geschaeft } : {}),
      strasse: r.strasse || "",
      plz: r.plz,
      ort: r.ort,
      lat: Number(r.lat),
      lng: Number(r.lng),
      entfernungM,
    });
  }
  alle.sort((a, b) => a.entfernungM - b.entfernungM || a.id.localeCompare(b.id));
  const nah = alle.filter(o => o.entfernungM <= RADIUS_M);
  return { orte: (nah.length >= MIN_NAH ? nah : alle).slice(0, MAX_ORTE) };
}

// ------------------------------------------------------------------ Admin

// GET /admin/abholorte-osm: Stand des Einlesens. POST: jetzt einen Schritt
// einlesen (?gebiet=63 fuer eine bestimmte Leitregion) - wie der Cron.
const ADMIN_ORIGINS = Object.freeze(["https://admin.disorder119.com", "http://localhost:8765", "http://127.0.0.1:8765"]);

export function isAbholorteOsmAdminRoute(url) {
  return url.pathname.replace(/\/+$/, "") === "/admin/abholorte-osm";
}

function adminKopf(origin) {
  const out = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && ADMIN_ORIGINS.includes(origin)) out["Access-Control-Allow-Origin"] = origin;
  return out;
}

async function gleich(a, b) {
  if (!a || !b) return false;
  const [x, y] = await Promise.all([a, b].map(async v => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(v))))));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function osmStand(env) {
  const { results = [] } = await env.DB.prepare("SELECT gebiet,punkte,plz,stand,versuch_am,naechster_versuch,fehlversuche,fehler,dauer_ms,quelle FROM abholorte_osm_gebiete ORDER BY gebiet").all();
  const eingelesen = results.filter(r => r.stand);
  const staende = eingelesen.map(r => r.stand).sort();
  return {
    gebiete: GEBIETE.length,
    eingelesen: eingelesen.length,
    punkte: eingelesen.reduce((s, r) => s + Number(r.punkte || 0), 0),
    plz: eingelesen.reduce((s, r) => s + Number(r.plz || 0), 0),
    aeltesterStand: staende[0] || null,
    neuesterStand: staende[staende.length - 1] || null,
    fehler: results.filter(r => r.fehler).map(r => ({ gebiet: r.gebiet, fehler: r.fehler, fehlversuche: r.fehlversuche, naechsterVersuch: r.naechster_versuch })),
    quellenvermerk: OSM_QUELLENVERMERK,
  };
}

export async function handleAbholorteOsmAdmin(request, env, url, reqId = crypto.randomUUID(), origin = null) {
  const antwort = (daten, status = 200) => new Response(JSON.stringify(daten), { status, headers: adminKopf(origin) });
  try {
    if (request.method === "OPTIONS") {
      if (origin && !ADMIN_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers: adminKopf(null) });
      return new Response(null, { status: 204, headers: adminKopf(origin) });
    }
    if (origin && !ADMIN_ORIGINS.includes(origin)) return antwort({ error: "ORIGIN_NOT_ALLOWED", requestId: reqId }, 403);
    if (!env.ADMIN_TOKEN) return antwort({ error: "ADMIN_NOT_CONFIGURED", requestId: reqId }, 503);
    const token = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!(await gleich(token, env.ADMIN_TOKEN))) return antwort({ error: "UNAUTHORIZED", requestId: reqId }, 401);
    if (!env.DB) return antwort({ error: "COMMERCE_DATABASE_NOT_CONFIGURED", requestId: reqId }, 503);
    if (request.method === "GET") return antwort({ ok: true, ...(await osmStand(env)) });
    if (request.method !== "POST") return antwort({ error: "METHOD_NOT_ALLOWED", requestId: reqId }, 405);
    const gebiet = url.searchParams.get("gebiet");
    if (gebiet !== null && !GEBIETE.includes(gebiet)) return antwort({ error: "GEBIET_UNGUELTIG", requestId: reqId }, 400);
    const ergebnis = await abholorteOsmPflegen(env, Date.now(), { gebiet });
    return antwort({ ok: !ergebnis.fehler, ...ergebnis }, ergebnis.fehler ? 502 : 200);
  } catch (err) {
    if (fehlendeTabelle(err)) return antwort({ error: "MIGRATION_FEHLT", requestId: reqId }, 503);
    console.error(JSON.stringify({ level: "error", event: "abholorte_osm_admin_fehler", requestId: reqId, message: safeText(err?.message || "unknown", 160) }));
    return antwort({ error: "ABHOLORTE_OSM_FEHLER", requestId: reqId }, 500);
  }
}
