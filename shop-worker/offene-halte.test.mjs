import assert from "node:assert/strict";
import test from "node:test";

import {
  HALT_FENSTER_MS, KASSE_JE_ANSCHLUSS, KASSE_JE_MAIL, MIETE_JE_ANSCHLUSS, MIN_WARTEN_SEKUNDEN,
  haltBelegen, haltFreigeben, haltMailHash, haltNetzHash, haltZuordnen, halteAufraeumen,
} from "./offene-halte.js";
import { RESERVATION_TTL_SECONDS } from "./commerce-core.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const T0 = new Date("2026-10-15T12:00:00.000Z");
const nach = ms => new Date(T0.getTime() + ms);
const MINUTE = 60 * 1000;

test("Offene Halte: Kasse und Miete zaehlen getrennt, Miete ohne E-Mail-Grenze", async () => {
  const DB = sqliteD1(allMigrations());
  for (let i = 0; i < MIETE_JE_ANSCHLUSS; i++) {
    assert.equal((await haltBelegen(DB, { art: "miete", netz: "netz-a", mail: `m${i}`, jetzt: T0 })).ok, true);
  }
  const miete = await haltBelegen(DB, { art: "miete", netz: "netz-a", jetzt: T0 });
  assert.equal(miete.ok, false);
  assert.equal(miete.grund, "ANSCHLUSS");
  // Volle Miete sperrt die Kasse nicht.
  for (let i = 0; i < KASSE_JE_ANSCHLUSS; i++) {
    assert.equal((await haltBelegen(DB, { art: "kasse", netz: "netz-a", mail: `kasse-${i}`, jetzt: T0 })).ok, true, `Kasse ${i}`);
  }
  const kasse = await haltBelegen(DB, { art: "kasse", netz: "netz-a", mail: "kasse-neu", jetzt: T0 });
  assert.deepEqual([kasse.ok, kasse.grund], [false, "ANSCHLUSS"]);
  // Bei der Miete wird keine Adresse gespeichert.
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='kontingent:halt-miete' AND metadata_json IS NOT NULL").get().n, 0);
  await assert.rejects(haltBelegen(DB, { art: "unbekannt", netz: "x" }), /halt_art_unbekannt/);
});

test("Offene Halte: je E-Mail-Adresse zwei, Grund MAIL geht vor ANSCHLUSS", async () => {
  const DB = sqliteD1(allMigrations());
  assert.equal(KASSE_JE_MAIL, 2);
  assert.equal((await haltBelegen(DB, { art: "kasse", netz: "n1", mail: "adresse", jetzt: T0 })).ok, true);
  assert.equal((await haltBelegen(DB, { art: "kasse", netz: "n2", mail: "adresse", jetzt: T0 })).ok, true);
  const dritte = await haltBelegen(DB, { art: "kasse", netz: "n3", mail: "adresse", jetzt: T0 });
  assert.deepEqual([dritte.ok, dritte.grund], [false, "MAIL"]);
  // Ohne Anschluss (keine IP) zaehlt nur die Adresse.
  const ohneNetz = await haltBelegen(DB, { art: "kasse", mail: "adresse", jetzt: T0 });
  assert.deepEqual([ohneNetz.ok, ohneNetz.grund], [false, "MAIL"]);
  // Nichts zu zaehlen: ok ohne Zeile.
  assert.deepEqual(await haltBelegen(DB, { art: "kasse", jetzt: T0 }), { ok: true, id: null });
});

test("Offene Halte: Retry-After bis der erste Halt frei wird, mindestens eine Minute", async () => {
  const DB = sqliteD1(allMigrations());
  const ttl = RESERVATION_TTL_SECONDS * 1000;
  // Zwei laufende Anfragen (noch ohne Bezug): frei nach der Reservierungszeit.
  await haltBelegen(DB, { art: "kasse", netz: "n", mail: "a", jetzt: T0 });
  await haltBelegen(DB, { art: "kasse", netz: "n2", mail: "a", jetzt: nach(2 * MINUTE) });
  const fuenfMinutenSpaeter = await haltBelegen(DB, { art: "kasse", netz: "n3", mail: "a", jetzt: nach(5 * MINUTE) });
  assert.equal(fuenfMinutenSpaeter.ok, false);
  assert.equal(fuenfMinutenSpaeter.warteSekunden, (ttl - 5 * MINUTE) / 1000, "der aelteste Halt zaehlt");
  const kurzVorSchluss = await haltBelegen(DB, { art: "kasse", netz: "n3", mail: "a", jetzt: nach(ttl - 10 * 1000) });
  assert.equal(kurzVorSchluss.warteSekunden, MIN_WARTEN_SEKUNDEN);

  // Mit Bezug: das Ende der Reservierung (Mietanfrage), nicht die Anlage.
  const DB2 = sqliteD1(allMigrations());
  const anfragen = [];
  for (let i = 0; i < MIETE_JE_ANSCHLUSS; i++) {
    const halt = await haltBelegen(DB2, { art: "miete", netz: "m", jetzt: T0 });
    anfragen.push(halt.id);
  }
  DB2.raw.prepare("INSERT INTO inventory (id,item_id,status,updated_at) VALUES ('inv-1',1,'RESERVED',?)").run(T0.toISOString());
  DB2.raw.prepare(`INSERT INTO rental_reservations (id,inventory_id,start_date,end_date,days,currency,price_on_request,status,idempotency_key,expires_at,created_at)
    VALUES ('rr-1','inv-1','2026-11-01','2026-11-02',2,'EUR',1,'RESERVED','k-rr-1',?,?)`).run(nach(25 * MINUTE).toISOString(), T0.toISOString());
  for (const id of anfragen) await haltZuordnen(DB2, id, "rr-1");
  const voll = await haltBelegen(DB2, { art: "miete", netz: "m", jetzt: nach(20 * MINUTE) });
  assert.equal(voll.ok, false);
  assert.equal(voll.warteSekunden, 5 * 60);
  // Laenger als HALT_FENSTER_MS zaehlt nichts, auch wenn die Reservierung laenger liefe.
  DB2.raw.prepare("UPDATE rental_reservations SET expires_at=?").run(nach(5 * 60 * MINUTE).toISOString());
  const deckel = await haltBelegen(DB2, { art: "miete", netz: "m", jetzt: nach(20 * MINUTE) });
  assert.equal(deckel.warteSekunden, (HALT_FENSTER_MS - 20 * MINUTE) / 1000);
  assert.equal((await haltBelegen(DB2, { art: "miete", netz: "m", jetzt: nach(HALT_FENSTER_MS + 1000) })).ok, true);
});

test("Offene Halte: Zeilen nach 30 Minuten weg - beim Belegen und im Cron", async () => {
  assert.equal(HALT_FENSTER_MS, 30 * MINUTE);
  const DB = sqliteD1(allMigrations());
  const zeile = DB.raw.prepare("INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,created_at) VALUES (?,'SYSTEM',?,?,'KONTINGENT_BELEGT',?)");
  zeile.run("k-alt", "kontingent:halt-kasse", "n", nach(-31 * MINUTE).toISOString());
  zeile.run("k-neu", "kontingent:halt-kasse", "n", nach(-29 * MINUTE).toISOString());
  zeile.run("m-alt", "kontingent:halt-miete", "n", nach(-31 * MINUTE).toISOString());
  zeile.run("s-alt", "kontingent:spiel-code", "n", nach(-31 * MINUTE).toISOString());
  assert.deepEqual(await halteAufraeumen(DB, T0), { geloescht: 2 });
  assert.deepEqual(DB.raw.prepare("SELECT id FROM audit_events ORDER BY id").all().map(r => r.id), ["k-neu", "s-alt"]);
  assert.deepEqual(await halteAufraeumen(null, T0), { geloescht: 0 });
  // Belegen raeumt die eigene Art mit auf.
  assert.equal((await haltBelegen(DB, { art: "kasse", netz: "x", jetzt: nach(2 * MINUTE) })).ok, true);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE id='k-neu'").get().n, 0);
});

test("Offene Halte: Freigeben und Zuordnen treffen nur Halte-Zeilen", async () => {
  const DB = sqliteD1(allMigrations());
  const halt = await haltBelegen(DB, { art: "miete", netz: "n", jetzt: T0 });
  DB.raw.prepare("INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,created_at) VALUES ('fremd','SYSTEM','order','o1','PAYMENT_STARTED',?)").run(T0.toISOString());
  await haltZuordnen(DB, "fremd", "o2");
  await haltFreigeben(DB, "fremd");
  assert.equal(DB.raw.prepare("SELECT entity_id FROM audit_events WHERE id='fremd'").get().entity_id, "o1");
  await haltZuordnen(DB, halt.id, "gruppe-1");
  assert.equal(DB.raw.prepare("SELECT actor_ref FROM audit_events WHERE id=?").get(halt.id).actor_ref, "gruppe-1");
  await haltFreigeben(DB, halt.id);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE id=?").get(halt.id).n, 0);
});

test("Offene Halte: im Livebetrieb ohne Pepper kein Zaehlen ohne Grenze (fail-closed), Testshop und Tests mit Test-Pepper", async () => {
  const anfrage = new Request("https://api.disorder119.com/create-order", { headers: { "CF-Connecting-IP": "2001:db8:1:2::3" } });
  const live = { PAYPAL_ENVIRONMENT: "live" };
  await assert.rejects(haltNetzHash(anfrage, live), err => err.code === "IP_PRIVACY_NOT_CONFIGURED" && err.status === 503);
  await assert.rejects(haltMailHash(live, "a@example.com"), err => err.code === "IP_PRIVACY_NOT_CONFIGURED");
  // Mit Pepper: Hash je /64, die Adresse ohne Gross-/Kleinschreibung.
  const mitPepper = { PAYPAL_ENVIRONMENT: "live", LOGIN_IP_PEPPER: "p".repeat(32) };
  const nachbar = new Request("https://api.disorder119.com/create-order", { headers: { "CF-Connecting-IP": "2001:db8:1:2::99" } });
  assert.match(await haltNetzHash(anfrage, mitPepper), /^[0-9a-f]{64}$/);
  assert.equal(await haltNetzHash(anfrage, mitPepper), await haltNetzHash(nachbar, mitPepper));
  assert.equal(await haltMailHash(mitPepper, " A@Example.com "), await haltMailHash(mitPepper, "a@example.com"));
  assert.notEqual(await haltMailHash(mitPepper, "a@example.com"), await haltMailHash({ ...mitPepper, LOGIN_IP_PEPPER: "q".repeat(32) }, "a@example.com"));
  assert.equal(await haltMailHash(mitPepper, ""), null);
  // Testshop (PayPal-Sandbox) und Tests: fester Test-Pepper.
  assert.match(await haltNetzHash(anfrage, { PAYPAL_ENVIRONMENT: "sandbox" }), /^[0-9a-f]{64}$/);
  assert.match(await haltMailHash({}, "a@example.com"), /^[0-9a-f]{64}$/);
});
