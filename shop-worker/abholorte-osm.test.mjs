// Abholorte aus OpenStreetMap (abholorte-osm.js): Filter, Einlesen in eine
// echte SQLite-D1 mit allen Migrationen, Umkreissuche und die Kassen-Route -
// ohne Netz: Overpass ist nachgebaut, DHL darf nie gefragt werden.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  AUFFRISCHEN_MS,
  GEBIETE,
  OSM_QUELLENVERMERK,
  abholorteOsmPflegen,
  csvLesen,
  gebietAuswerten,
  gebietLaden,
  gebietSchreiben,
  handleAbholorteOsmAdmin,
  istAbholorteOsmCron,
  naechstesGebiet,
  ortAusNotiz,
  osmAbholort,
  osmAbholorteSuchen,
  osmPruefen,
  osmStand,
  overpassAbfrage,
} from "./abholorte-osm.js";
import { handleAbholorte } from "./abholorte.js";
import { adresseCacheLeeren } from "./adresse.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";
import worker from "./worker-entry.js";

const SHOP = "https://disorder119.com";
const KOPF = ["@type", "@id", "@lat", "@lon", "postal_code", "note", "name", "amenity", "ref", "brand", "operator",
  "post_office:brand", "access", "addr:street", "addr:housenumber", "addr:postcode", "addr:city", "ende"];

// Overpass-CSV wie vom Server: Kopfzeile, Tabulator, Schlusszeile aus "make".
function csv(zeilen, { ende = true } = {}) {
  const out = [KOPF.join("\t")];
  for (const z of zeilen) out.push(KOPF.map(k => z[k] ?? "").join("\t"));
  if (ende) out.push(KOPF.map(k => (k === "@type" ? "d119ende" : k === "@id" ? "1" : k === "ende" ? "ok" : "")).join("\t"));
  return `${out.join("\n")}\n`;
}
const plzGebiet = (plz, lat, lon, note = `${plz} Aschaffenburg`) => ({ "@type": "relation", "@id": `9${plz}`, "@lat": lat, "@lon": lon, postal_code: plz, note });
const packstation = (id, ref, lat, lon, extra = {}) => ({ "@type": "node", "@id": id, "@lat": lat, "@lon": lon, amenity: "parcel_locker", ref, brand: "DHL Packstation", operator: "DHL", ...extra });
const filiale = (id, ref, lat, lon, extra = {}) => ({ "@type": "node", "@id": id, "@lat": lat, "@lon": lon, amenity: "post_office", ref, operator: "Deutsche Post", ...extra });
const UMGEBUNG = { plz: "63739", ort: "Aschaffenburg" };

// Mitte von 63739 und Punkte in bekanntem Abstand (0,009 Grad Breite = 1 km).
const MITTE = { lat: 49.9765, lng: 9.1445 };
const nord = km => (MITTE.lat + km * 0.0089932).toFixed(7);
const r6 = wert => Math.round(Number(wert) * 1e6) / 1e6;

test("Filter: DHL-Packstation mit Nummer bleibt, Amazon und Partner ohne Nummer fallen weg, Filiale mit Nummer bleibt", () => {
  // Wie in OSM ueblich ohne addr:postcode - PLZ und Ort kommen aus dem PLZ-Gebiet.
  const ps = osmPruefen(packstation("5141420255", "125", "49.9802267", "9.1357279"), UMGEBUNG);
  assert.deepEqual(ps.ort, { id: "packstation-125-63739", typ: "packstation", nummer: "125", name: "Packstation 125", geschaeft: "",
    strasse: "", plz: "63739", ort: "Aschaffenburg", lat: 49.980227, lng: 9.135728, osmId: "n5141420255" });
  assert.equal(osmPruefen({ "@type": "node", "@id": "1", "@lat": "49.98", "@lon": "9.14", amenity: "parcel_locker", ref: "pfiffig", brand: "Amazon Hub", operator: "Amazon" }, UMGEBUNG).grund, "NICHT_DHL");
  assert.equal(osmPruefen({ "@type": "node", "@id": "2", "@lat": "49.98", "@lon": "9.14", amenity: "parcel_locker", ref: "12", brand: "Amazon Locker", operator: "Amazon", name: "Packstation" }, UMGEBUNG).grund, "NICHT_DHL");
  assert.equal(osmPruefen(packstation("3", "17", "49.98", "9.14", { brand: "MYFLEXBOX", operator: "MYFLEXBOX Germany GmbH" }), UMGEBUNG).grund, "NICHT_DHL");
  // DHL-Paketshop ohne ref: laesst sich nicht als "Postfiliale <Nummer>" adressieren.
  assert.equal(osmPruefen(filiale("4", "", "49.98", "9.14", { "post_office:brand": "DHL", operator: "Kiosk Rana", name: "Kiosk Rana" }), UMGEBUNG).grund, "OHNE_NUMMER");
  assert.equal(osmPruefen(filiale("5", "Adenauerstraße 62, 66399 Mandelbachtal", "49.98", "9.14"), UMGEBUNG).grund, "OHNE_NUMMER");
  assert.equal(osmPruefen(filiale("6", "12345", "49.98", "9.14"), UMGEBUNG).grund, "OHNE_NUMMER", "fuenf Ziffern sind keine Filialnummer");
  assert.equal(osmPruefen(filiale("7", "123", "49.98", "9.14", { operator: "Hermes", brand: "Hermes" }), UMGEBUNG).grund, "NICHT_DHL");
  assert.equal(osmPruefen(packstation("8", "130", "49.98", "9.14", { access: "private" }), UMGEBUNG).grund, "PRIVAT");
  assert.equal(osmPruefen(packstation("9", "131", "", ""), UMGEBUNG).grund, "OHNE_LAGE");
  assert.equal(osmPruefen(packstation("10", "132", "49.98", "9.14"), {}).grund, "OHNE_PLZ");

  const fil = osmAbholort(filiale("2914512286", "642", "49.9722016", "9.1498810", { brand: "Deutsche Post;DHL", "addr:street": "Wermbachstraße", "addr:housenumber": "54" }), UMGEBUNG);
  assert.deepEqual([fil.typ, fil.name, fil.strasse, fil.plz, fil.geschaeft], ["filiale", "Postfiliale 642", "Wermbachstraße 54", "63739", ""]);
  // Partnerfiliale: der Laden als Zusatz; "Deutsche Post" allein ist keiner.
  assert.equal(osmAbholort(filiale("11", "656", "49.98", "9.14", { brand: "Deutsche Post", name: "Güdinger Lädchen", post_office: "post_partner" }), UMGEBUNG).geschaeft, "Güdinger Lädchen");
  assert.equal(osmAbholort(filiale("12", "657", "49.98", "9.14", { name: "Deutsche Post Filiale 657" }), UMGEBUNG).geschaeft, "");
  // Nummern in anderer Schreibweise und eigene Adresse vor dem PLZ-Gebiet.
  assert.equal(osmAbholort(filiale("13", "DHL Paketshop 742", "49.98", "9.14", { operator: "", brand: "DHL", name: "Lotto-Toto Eldener" }), UMGEBUNG).name, "Postfiliale 742");
  assert.equal(osmAbholort(filiale("14", "survey", "49.98", "9.14", { name: "Postfiliale 652" }), UMGEBUNG).nummer, "652");
  assert.equal(osmAbholort(packstation("15", "Packstation 0125", "49.98", "9.14"), UMGEBUNG).nummer, "125");
  const eigene = osmAbholort(packstation("16", "701", "49.98", "9.14", { brand: "DHL Poststation", "addr:postcode": "63741", "addr:city": "Aschaffenburg-Damm" }), UMGEBUNG);
  assert.deepEqual([eigene.name, eigene.plz, eigene.ort, eigene.id], ["Packstation 701", "63741", "Aschaffenburg-Damm", "packstation-701-63741"]);
  assert.equal(osmAbholort({ "@type": "way", "@id": "77", "@lat": "49.98", "@lon": "9.14", amenity: "parcel_locker", ref: "140", name: "Packstation 140" }, UMGEBUNG).osmId, "w77");
});

test("Ort aus der PLZ-Grenze und Overpass-CSV mit Anfuehrungszeichen", () => {
  assert.equal(ortAusNotiz("63739 Aschaffenburg", "", "63739"), "Aschaffenburg");
  assert.equal(ortAusNotiz("66957 Vinningen, Trulben, Ruppertsweiler u.a.", "", "66957"), "Vinningen");
  assert.equal(ortAusNotiz("", "66957 Pirmasens-Land", "66957"), "Pirmasens-Land");
  assert.equal(ortAusNotiz("", "", "66957"), "");
  const zeilen = csvLesen("@type\t@id\tnote\nrelation\t1\t\"66957 Vinningen, Trulben u.a.\"\r\n\nnode\t2\t\"sagt \"\"hallo\"\"\"\n");
  assert.deepEqual(zeilen, [{ "@type": "relation", "@id": "1", note: "66957 Vinningen, Trulben u.a." }, { "@type": "node", "@id": "2", note: "sagt \"hallo\"" }]);
});

test("Overpass-Abfrage: eine Leitregion, Zeitlimit und Schlusszeile", () => {
  const q = overpassAbfrage("63");
  assert.match(q, /^\[out:csv\(::type,::id,::lat,::lon,/);
  assert.match(q, /\[timeout:240\]/);
  assert.match(q, /\["postal_code"~"\^63\[0-9\]\{3\}\$"\]\(area\.de\)/);
  assert.match(q, /nwr\(area\.flaeche\)\["amenity"~"\^\(parcel_locker\|post_office\)\$"\]\["ref"\]/);
  assert.match(q, /make d119ende ende="ok";\nout;$/);
  assert.throws(() => overpassAbfrage("6"), /GEBIET_UNGUELTIG/);
  assert.throws(() => overpassAbfrage("63\"];out;"), /GEBIET_UNGUELTIG/);
  assert.equal(GEBIETE.length, 99);
  assert.deepEqual([GEBIETE[0], GEBIETE[98]], ["01", "99"]);
  assert.ok(istAbholorteOsmCron("7 * * * *") && istAbholorteOsmCron("37 * * * *") && !istAbholorteOsmCron("*/15 * * * *"));
});

test("Antwort auswerten: Orte gehoeren zum PLZ-Gebiet davor, Doppelte einmal, ohne Schlusszeile ein Fehler", () => {
  const text = csv([
    plzGebiet("63739", "49.9765", "9.1445"),
    packstation("100", "125", "49.9802", "9.1357"),
    filiale("101", "593", "49.9799", "9.1453", { name: "Hauptpost" }),
    { "@type": "node", "@id": "102", "@lat": "49.98", "@lon": "9.14", amenity: "parcel_locker", ref: "1", brand: "Amazon Locker", operator: "Amazon" },
    plzGebiet("63741", "49.9900", "9.1200", "63741 Aschaffenburg"),
    packstation("103", "124", "49.9910", "9.1210"),
    // Ueberlappende PLZ-Grenzen: derselbe OSM-Knoten noch einmal.
    packstation("100", "125", "49.9802", "9.1357"),
    // PLZ eines Nachbargebiets (anderer Praefix) gehoert nicht in diese Leitregion.
    plzGebiet("64001", "49.9", "9.0"),
    packstation("104", "126", "49.9", "9.0"),
  ]);
  const daten = gebietAuswerten(text, "63");
  assert.deepEqual(daten.plz, [{ plz: "63739", lat: 49.9765, lng: 9.1445, ort: "Aschaffenburg" }, { plz: "63741", lat: 49.99, lng: 9.12, ort: "Aschaffenburg" }]);
  assert.deepEqual(daten.orte.map(o => [o.id, o.geschaeft]), [["packstation-125-63739", ""], ["filiale-593-63739", "Hauptpost"], ["packstation-124-63741", ""]]);
  assert.deepEqual(daten.verworfen, { NICHT_DHL: 1, DOPPELT: 1 });
  assert.throws(() => gebietAuswerten(csv([plzGebiet("63739", "49.9765", "9.1445")], { ende: false }), "63"), err => err.code === "OVERPASS_UNVOLLSTAENDIG");
  assert.throws(() => gebietAuswerten("", "63"), err => err.code === "OVERPASS_UNVOLLSTAENDIG");
});

// Ein Gebiet "63" mit Orten in bekanntem Abstand zur Mitte von 63739.
function gebiet63({ ohne = [], ref125 = "125" } = {}) {
  const orte = [
    ["200", ref125, 0.2], ["201", "201", 1], ["202", "202", 3], ["203", "203", 4.9], ["204", "204", 6], ["205", "205", 9], ["206", "206", 12],
  ].filter(([id]) => !ohne.includes(id));
  return csv([
    plzGebiet("63739", String(MITTE.lat), String(MITTE.lng)),
    ...orte.map(([id, ref, km]) => packstation(id, ref, nord(km), String(MITTE.lng))),
    filiale("210", "593", nord(0.5), String(MITTE.lng), { name: "Hauptpost" }),
    // Weit draussen: Mitte einer PLZ, um die im Umkreis von 5 km nichts liegt
    // (Packstation 206 in 6,5 km, 205 in 9,5 km, der Rest weiter als 10 km).
    plzGebiet("63999", nord(18.5), String(MITTE.lng), "63999 Irgendwo"),
  ]);
}

test("Einlesen in D1: nur der Unterschied wird geschrieben, ein Fehler laesst den alten Stand stehen", async () => {
  const DB = sqliteD1(allMigrations());
  const env = { DB };
  const anzahl = () => DB.raw.prepare("SELECT COUNT(*) AS n FROM abholorte_osm").get().n;
  const t0 = Date.parse("2026-11-05T03:07:00Z");
  const erst = await abholorteOsmPflegen(env, t0, { gebiet: "63", laden: async () => gebiet63() });
  assert.deepEqual({ ...erst, verworfen: undefined }, { gebiet: "63", quelle: "overpass-api.de", punkte: 8, plz: 2, neu: 8, geaendert: 0, entfernt: 0, plzGeaendert: 2, verworfen: undefined });
  assert.equal(anzahl(), 8);
  const zeile = DB.raw.prepare("SELECT * FROM abholorte_osm WHERE id='filiale-593-63739'").get();
  assert.deepEqual({ ...zeile }, { gebiet: "63", id: "filiale-593-63739", typ: "filiale", nummer: "593", name: "Postfiliale 593", geschaeft: "Hauptpost",
    strasse: "", plz: "63739", ort: "Aschaffenburg", lat: r6(nord(0.5)), lng: MITTE.lng, osm_id: "n210", stand: "2026-11-05T03:07:00.000Z" });

  // Gleiche Antwort eine Woche spaeter: nichts zu schreiben ausser dem Stand.
  const gleich = await abholorteOsmPflegen(env, t0 + AUFFRISCHEN_MS, { gebiet: "63", laden: async () => gebiet63() });
  assert.deepEqual([gleich.neu, gleich.geaendert, gleich.entfernt, gleich.plzGeaendert], [0, 0, 0, 0]);
  assert.equal(DB.raw.prepare("SELECT stand FROM abholorte_osm WHERE id='filiale-593-63739'").get().stand, "2026-11-05T03:07:00.000Z");

  // Eine Packstation weg, eine mit neuer Nummer: geloescht bzw. neu.
  const neu = await abholorteOsmPflegen(env, t0 + 2 * AUFFRISCHEN_MS, { gebiet: "63", laden: async () => gebiet63({ ohne: ["206"], ref125: "127" }) });
  assert.deepEqual([neu.punkte, neu.neu, neu.geaendert, neu.entfernt], [7, 1, 0, 2]);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM abholorte_osm WHERE id IN ('packstation-125-63739','packstation-206-63739')").get().n, 0);
  assert.equal(anzahl(), 7);

  // Overpass weg (beide Server): alter Stand bleibt, Fehler und Pause gemerkt.
  const vorher = DB.raw.prepare("SELECT * FROM abholorte_osm ORDER BY id").all();
  const versuche = [];
  const weg = await abholorteOsmPflegen(env, t0 + 3 * AUFFRISCHEN_MS, { gebiet: "63", laden: async ziel => { versuche.push(ziel); throw new Error("502 Gateway Timeout"); } });
  assert.equal(weg.fehler, "OVERPASS_FEHLER");
  assert.deepEqual(versuche, ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]);
  assert.deepEqual(DB.raw.prepare("SELECT * FROM abholorte_osm ORDER BY id").all(), vorher);
  const status = DB.raw.prepare("SELECT * FROM abholorte_osm_gebiete WHERE gebiet='63'").get();
  assert.equal(status.fehler, "OVERPASS_FEHLER");
  assert.equal(status.fehlversuche, 1);
  assert.equal(status.punkte, 7, "Anzahl des letzten guten Stands bleibt");
  assert.equal(status.naechster_versuch, new Date(t0 + 3 * AUFFRISCHEN_MS + 60 * 60 * 1000).toISOString());

  // Abgebrochene Antwort (Zeitlimit, keine Schlusszeile) und unplausibel kleine Antwort: ebenso.
  const halb = await abholorteOsmPflegen(env, t0 + 3 * AUFFRISCHEN_MS, { gebiet: "63", laden: async () => gebiet63().split("\n").slice(0, 4).join("\n") });
  assert.equal(halb.fehler, "OVERPASS_UNVOLLSTAENDIG");
  const klein = await abholorteOsmPflegen({ DB, OVERPASS_URL: "https://overpass.example/api/interpreter" }, t0 + 3 * AUFFRISCHEN_MS, {
    gebiet: "63", laden: async () => csv([plzGebiet("63739", String(MITTE.lat), String(MITTE.lng))]),
  });
  assert.equal(klein.fehler, "UNPLAUSIBEL");
  assert.deepEqual(DB.raw.prepare("SELECT * FROM abholorte_osm ORDER BY id").all(), vorher);
  assert.equal(DB.raw.prepare("SELECT fehlversuche FROM abholorte_osm_gebiete WHERE gebiet='63'").get().fehlversuche, 3);

  // Ein Batch ist eine Transaktion: scheitert ein Teil, ist auch das Loeschen davor ungeschehen.
  const teils = gebietAuswerten(gebiet63({ ohne: ["201", "202"] }), "63");
  teils.orte.push({ ...teils.orte[0], id: "kaputt", typ: "schrank" });
  await assert.rejects(gebietSchreiben(DB, "63", teils), /CHECK constraint failed/);
  assert.deepEqual(DB.raw.prepare("SELECT * FROM abholorte_osm ORDER BY id").all(), vorher);
  // D1 nicht erreichbar: Fehler gemeldet, der Stand gilt nicht als erneuert.
  const kaputt = { prepare: DB.prepare.bind(DB), batch: async () => { throw new Error("D1 weg"); } };
  const d1weg = await abholorteOsmPflegen({ DB: kaputt }, t0 + 4 * AUFFRISCHEN_MS, { gebiet: "63", laden: async () => gebiet63({ ohne: ["201", "202"] }) });
  assert.equal(d1weg.fehler, "FEHLER");
  assert.equal(DB.raw.prepare("SELECT stand FROM abholorte_osm_gebiete WHERE gebiet='63'").get().stand, new Date(t0 + 2 * AUFFRISCHEN_MS).toISOString());
  assert.deepEqual(DB.raw.prepare("SELECT * FROM abholorte_osm ORDER BY id").all(), vorher);

  // Wieder erreichbar: Fehler geloescht.
  const wieder = await abholorteOsmPflegen(env, t0 + 5 * AUFFRISCHEN_MS, { gebiet: "63", laden: async () => gebiet63() });
  assert.equal(wieder.fehler, undefined);
  const gut = DB.raw.prepare("SELECT fehler,fehlversuche,naechster_versuch,punkte FROM abholorte_osm_gebiete WHERE gebiet='63'").get();
  assert.deepEqual({ ...gut }, { fehler: null, fehlversuche: 0, naechster_versuch: null, punkte: 8 });
});

test("Einlesen in Bloecken: ueber tausend Orte in einem Gebiet kommen vollstaendig an", async () => {
  const DB = sqliteD1(allMigrations());
  const zeilen = [plzGebiet("10115", "52.532", "13.384", "10115 Berlin")];
  for (let i = 1; i <= 1100; i++) zeilen.push(packstation(String(5000 + i), String(i), (52.5 + i / 100000).toFixed(6), "13.38"));
  const batches = [];
  const db = { prepare: DB.prepare.bind(DB), batch: async liste => { batches.push(liste.length); return DB.batch(liste); } };
  const e = await abholorteOsmPflegen({ DB: db }, Date.now(), { gebiet: "10", laden: async () => csv(zeilen) });
  assert.equal(e.punkte, 1100);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM abholorte_osm WHERE gebiet='10'").get().n, 1100);
  // Ein einziger Batch: 3 Bloecke Orte, 1 Block PLZ, 1 Gebietsstand.
  assert.deepEqual(batches, [5]);
});

test("Naechstes Gebiet: nie eingelesene zuerst, dann der aelteste Stand; nach Fehlern Pause; einmal die Woche", async () => {
  const jetzt = Date.parse("2026-11-05T12:00:00Z");
  const alt = new Date(jetzt - AUFFRISCHEN_MS - 1).toISOString();
  const frisch = new Date(jetzt - 1000).toISOString();
  const alle = GEBIETE.map(gebiet => ({ gebiet, stand: frisch }));
  assert.equal(naechstesGebiet([], jetzt), "01");
  assert.equal(naechstesGebiet(alle, jetzt), null);
  const mit = (gebiet, r) => alle.map(x => (x.gebiet === gebiet ? { gebiet, ...r } : x));
  assert.equal(naechstesGebiet(mit("42", { stand: alt }), jetzt), "42");
  assert.equal(naechstesGebiet(mit("42", { stand: null, naechster_versuch: new Date(jetzt + 1000).toISOString() }), jetzt), null, "Pause nach Fehler");
  assert.equal(naechstesGebiet(mit("42", { stand: null, naechster_versuch: new Date(jetzt - 1000).toISOString() }), jetzt), "42");
  const zwei = alle.filter(x => !["07", "08"].includes(x.gebiet)).concat([{ gebiet: "07", stand: alt }]);
  assert.equal(naechstesGebiet(zwei, jetzt), "08", "nie eingelesen vor veraltet");

  const DB = sqliteD1(allMigrations());
  assert.deepEqual(await abholorteOsmPflegen({}, jetzt), { uebersprungen: "OHNE_DB" });
  assert.deepEqual(await abholorteOsmPflegen({ DB, ABHOLORTE_OSM: "aus" }, jetzt), { uebersprungen: "AUS" });
  const gefragt = [];
  const e = await abholorteOsmPflegen({ DB }, jetzt, { laden: async (_, abfrage) => { gefragt.push(abfrage); return csv([]); } });
  assert.equal(e.gebiet, "01");
  assert.match(gefragt[0], /\^01\[0-9\]/);
  for (const gebiet of GEBIETE.slice(1)) {
    DB.raw.prepare("INSERT INTO abholorte_osm_gebiete (gebiet,stand) VALUES (?,?)").run(gebiet, frisch);
  }
  assert.deepEqual(await abholorteOsmPflegen({ DB }, jetzt, { laden: async () => { throw new Error("nicht fragen"); } }), { uebersprungen: "AKTUELL" });
});

test("Overpass wird hoeflich gefragt: POST, eigener User-Agent, zweiter Server nur bei Fehler", async () => {
  const original = globalThis.fetch;
  const aufrufe = [];
  globalThis.fetch = async (url, init = {}) => {
    aufrufe.push({ url: String(url), method: init.method, ua: init.headers?.["User-Agent"], body: String(init.body || "") });
    if (aufrufe.length === 1) return new Response("# 502 Gateway Timeout\nThis Overpass API server is currently at capacity.", { status: 502 });
    return new Response(gebiet63(), { headers: { "Content-Type": "text/csv" } });
  };
  try {
    const { daten, quelle } = await gebietLaden({}, "63");
    assert.equal(quelle, "overpass.private.coffee");
    assert.equal(daten.orte.length, 8);
    assert.deepEqual(aufrufe.map(a => [a.url, a.method, a.ua]), [
      ["https://overpass-api.de/api/interpreter", "POST", "Disorder119-Shop (kontakt@disorder119.com)"],
      ["https://overpass.private.coffee/api/interpreter", "POST", "Disorder119-Shop (kontakt@disorder119.com)"],
    ]);
    assert.equal(decodeURIComponent(aufrufe[0].body.replace(/^data=/, "")), overpassAbfrage("63"));
  } finally {
    globalThis.fetch = original;
  }
});

test("Suche: Mitte der PLZ, naechste Orte bis 5 km (auf dem Land bis 10 km), hoechstens 15, sortiert", async () => {
  const DB = sqliteD1(allMigrations());
  const env = { DB };
  assert.equal(await osmAbholorteSuchen(env, "63739"), null, "noch nichts eingelesen");
  assert.equal(await osmAbholorteSuchen({}, "63739"), null);
  await abholorteOsmPflegen(env, Date.now(), { gebiet: "63", laden: async () => gebiet63() });

  const nah = await osmAbholorteSuchen(env, "63739");
  assert.deepEqual(nah.orte.map(o => [o.name, Math.round(o.entfernungM / 100) / 10]), [
    ["Packstation 125", 0.2], ["Postfiliale 593", 0.5], ["Packstation 201", 1], ["Packstation 202", 3], ["Packstation 203", 4.9],
  ]);
  assert.deepEqual(Object.keys(nah.orte[1]), ["id", "typ", "nummer", "name", "geschaeft", "strasse", "plz", "ort", "lat", "lng", "entfernungM"]);
  assert.equal(nah.orte[1].geschaeft, "Hauptpost");
  assert.ok(!("geschaeft" in nah.orte[0]), "ohne Laden kein leeres Feld");
  // Um 63999 liegt im Umkreis von 5 km nichts: dann bis 10 km.
  const land = await osmAbholorteSuchen(env, "63999");
  assert.deepEqual(land.orte.map(o => o.name), ["Packstation 206", "Packstation 205"]);
  assert.ok(land.orte.every(o => o.entfernungM <= 10000));
  // PLZ ohne Grenze in OSM in einer schon eingelesenen Leitregion: leer; in einer anderen: noch nicht eingerichtet.
  assert.deepEqual(await osmAbholorteSuchen(env, "63001"), { orte: [] });
  assert.equal(await osmAbholorteSuchen(env, "80331"), null);
  assert.equal(await osmAbholorteSuchen({ DB, ABHOLORTE_OSM: "aus" }, "63739"), null);

  // Viele Orte: die 15 naechsten.
  const viele = [plzGebiet("10115", "52.532", "13.384", "10115 Berlin")];
  for (let i = 1; i <= 25; i++) viele.push(packstation(String(7000 + i), String(100 + i), (52.532 + i * 0.0005).toFixed(6), "13.384"));
  await abholorteOsmPflegen(env, Date.now(), { gebiet: "10", laden: async () => csv(viele) });
  const berlin = await osmAbholorteSuchen(env, "10115");
  assert.equal(berlin.orte.length, 15);
  assert.deepEqual(berlin.orte.slice(0, 3).map(o => o.nummer), ["101", "102", "103"]);
  assert.ok(berlin.orte.every((o, i, a) => i === 0 || a[i - 1].entfernungM <= o.entfernungM));
});

test("GET /versand/abholorte: Antwort aus OpenStreetMap mit Quellenvermerk - ohne DHL, ohne Overpass", async () => {
  adresseCacheLeeren();
  const DB = sqliteD1(allMigrations());
  await abholorteOsmPflegen({ DB }, Date.now(), { gebiet: "63", laden: async () => gebiet63() });
  const original = globalThis.fetch;
  const netz = [];
  globalThis.fetch = async url => { netz.push(String(url)); throw new Error(`kein Netz erwartet: ${url}`); };
  const OPENPLZ_LADEN = async url => (String(url).includes("postalCode=63739") ? [{ postalCode: "63739", federalState: { key: "09", name: "Bayern" } }] : []);
  const abfrage = async (query, env, origin = SHOP) => {
    const req = new Request(`https://api.disorder119.com/versand/abholorte${query}`, { headers: origin ? { Origin: origin, "CF-Connecting-IP": "203.0.113.9" } : {} });
    const res = await handleAbholorte(req, env, new URL(req.url), "req", origin);
    return { status: res.status, cors: res.headers.get("Access-Control-Allow-Origin"), daten: await res.json() };
  };
  try {
    // DHL-Schluessel da, aber keine Freigabe: OpenStreetMap, kein Aufruf bei DHL.
    const ok = await abfrage("?plz=63739&strasse=Nelseestra%C3%9Fe%2025", { DB, DHL_PRIVAT_API_KEY: "dhl-test", OPENPLZ_LADEN });
    assert.equal(ok.status, 200);
    assert.equal(ok.cors, SHOP);
    assert.deepEqual(Object.keys(ok.daten), ["ok", "orte", "quelle", "quellenvermerk", "bezug", "luftbild"]);
    assert.equal(ok.daten.ok, true);
    assert.equal(ok.daten.quelle, "osm");
    assert.equal(ok.daten.bezug, "plz");
    assert.deepEqual(ok.daten.quellenvermerk, { text: "© OpenStreetMap-Mitwirkende", url: "https://www.openstreetmap.org/copyright", lizenz: "ODbL 1.0" });
    assert.deepEqual(ok.daten.quellenvermerk, { ...OSM_QUELLENVERMERK });
    assert.deepEqual(ok.daten.luftbild, { land: "BY", quelle: "© Bayerische Vermessungsverwaltung, CC BY 4.0" });
    assert.equal(ok.daten.orte.length, 5);
    assert.deepEqual(ok.daten.orte[0], { id: "packstation-125-63739", typ: "packstation", nummer: "125", name: "Packstation 125", strasse: "", plz: "63739",
      ort: "Aschaffenburg", lat: r6(nord(0.2)), lng: MITTE.lng, entfernungM: ok.daten.orte[0].entfernungM });
    assert.ok(Math.abs(ok.daten.orte[0].entfernungM - 200) <= 2);
    assert.deepEqual(netz, [], "keine Anfrage ins Netz - weder DHL noch Overpass");

    // Noch nicht eingelesene Leitregion oder ohne Datenbank: Eingabe von Hand wie bisher.
    assert.deepEqual((await abfrage("?plz=80331", { DB, OPENPLZ_LADEN })).daten.error, "ABHOLORTE_NICHT_EINGERICHTET");
    assert.equal((await abfrage("?plz=80331", { DB, OPENPLZ_LADEN })).status, 503);
    assert.equal((await abfrage("?plz=63739", { OPENPLZ_LADEN })).daten.error, "ABHOLORTE_NICHT_EINGERICHTET");
    assert.equal((await abfrage("?plz=63739", { DB, ABHOLORTE_OSM: "aus", OPENPLZ_LADEN })).daten.error, "ABHOLORTE_NICHT_EINGERICHTET");
    // Schutz wie bisher: Herkunft, PLZ, Ratenbegrenzer.
    assert.equal((await abfrage("?plz=63739", { DB, OPENPLZ_LADEN }, "https://evil.example")).status, 403);
    assert.equal((await abfrage("?plz=637", { DB, OPENPLZ_LADEN })).status, 400);
    const begrenzt = await abfrage("?plz=63739", { DB, OPENPLZ_LADEN, RATE_LIMITER: { limit: async ({ key }) => ({ success: !key.startsWith("abholorte:") }) } });
    assert.deepEqual([begrenzt.status, begrenzt.daten.error], [429, "RATE_LIMITED"]);
    assert.deepEqual(netz, []);
  } finally {
    globalThis.fetch = original;
  }
});

test("Cron: der eigene Stundenlauf liest genau ein Gebiet ein, der Viertelstundenlauf fragt Overpass nie", async () => {
  const DB = sqliteD1(allMigrations());
  const original = globalThis.fetch;
  const netz = [];
  globalThis.fetch = async (url, init = {}) => {
    netz.push(String(url));
    if (String(url).includes("overpass")) return new Response(csv([plzGebiet("01067", "51.05", "13.73", "01067 Dresden"), packstation("1", "101", "51.051", "13.731")]));
    throw new Error(`kein Netz erwartet: ${url}`);
  };
  const warten = [];
  const ctx = { waitUntil: p => warten.push(p) };
  try {
    await worker.scheduled({ cron: "7 * * * *", scheduledTime: Date.parse("2026-11-05T03:07:00Z") }, { DB }, ctx);
    await Promise.all(warten);
    assert.equal(warten.length, 1, "nur der Abholort-Schritt");
    assert.deepEqual(netz, ["https://overpass-api.de/api/interpreter"]);
    assert.equal(DB.raw.prepare("SELECT punkte FROM abholorte_osm_gebiete WHERE gebiet='01'").get().punkte, 1);
    const stand = await osmStand({ DB });
    assert.deepEqual([stand.gebiete, stand.eingelesen, stand.punkte, stand.plz], [99, 1, 1, 1]);

    // Der Viertelstundenlauf (Zahlungen, Versand ...) laesst die Abholorte in Ruhe.
    netz.length = 0;
    warten.length = 0;
    await worker.scheduled({ cron: "*/15 * * * *", scheduledTime: Date.parse("2026-11-05T03:15:00Z") }, { DB }, ctx);
    await Promise.allSettled(warten);
    assert.ok(warten.length > 1);
    assert.ok(!netz.some(url => url.includes("overpass")), netz.join(", "));
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM abholorte_osm_gebiete").get().n, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("Admin: Stand lesen und einen Schritt anstossen, nur mit Anmeldung", async () => {
  const DB = sqliteD1(allMigrations());
  const env = { DB, ADMIN_TOKEN: "admin-token" };
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(gebiet63());
  const rufe = async (method, pfad, token = "admin-token") => {
    const url = new URL(`https://api.disorder119.com${pfad}`);
    const res = await handleAbholorteOsmAdmin(new Request(url, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} }), env, url, "req", "https://admin.disorder119.com");
    return { status: res.status, daten: await res.json() };
  };
  try {
    assert.equal((await rufe("GET", "/admin/abholorte-osm", "falsch")).status, 401);
    assert.equal((await rufe("GET", "/admin/abholorte-osm", "")).status, 401);
    assert.deepEqual((await rufe("POST", "/admin/abholorte-osm?gebiet=6")).status, 400);
    const schritt = await rufe("POST", "/admin/abholorte-osm?gebiet=63");
    assert.equal(schritt.status, 200);
    assert.deepEqual([schritt.daten.ok, schritt.daten.gebiet, schritt.daten.punkte], [true, "63", 8]);
    const stand = await rufe("GET", "/admin/abholorte-osm");
    assert.deepEqual([stand.status, stand.daten.eingelesen, stand.daten.punkte, stand.daten.plz, stand.daten.fehler], [200, 1, 8, 2, []]);
    assert.equal(stand.daten.quellenvermerk.lizenz, "ODbL 1.0");
  } finally {
    globalThis.fetch = original;
  }
});

test("Kasse: Quellenvermerk und Hinweis in allen drei Sprachen, Eingabe von Hand bleibt", () => {
  const kasse = fs.readFileSync(new URL("../assets/kasse.js", import.meta.url), "utf8");
  for (const schluessel of ["abholOsmVor", "abholOsmLink", "abholOsmHinweis", "abholManuell", "abholDhlFinder"]) {
    assert.equal(kasse.match(new RegExp(`\\b${schluessel}: "`, "g"))?.length, 3, schluessel);
  }
  assert.match(kasse, /abholOsmLink: "© OpenStreetMap-Mitwirkende"/);
  assert.match(kasse, /abholOsmLink: "© OpenStreetMap contributors"/);
  assert.match(kasse, /aOsmLink\.href = "https:\/\/www\.openstreetmap\.org\/copyright"/);
  assert.match(kasse, /abhol\.quelle = daten\.quelle === "osm" \? "osm" : ""/);
});
