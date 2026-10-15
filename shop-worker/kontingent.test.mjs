import assert from "node:assert/strict";
import test from "node:test";

import { LAENGSTES_FENSTER_MS, TAG_MS, kontingentAufraeumen, kontingentBelegen, kontingentFreigeben, kontingentStand } from "./kontingent.js";
import { SPIEL_CODE_FENSTER_TAGE } from "./game-rewards.js";
import { HALT_FENSTER_MS } from "./offene-halte.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

test("Kontingent: Grenze je Schluessel und insgesamt, gleichzeitige Anfragen ueberschreiten sie nicht", async () => {
  const DB = sqliteD1(allMigrations());
  const jetzt = new Date("2026-10-15T12:00:00.000Z");
  const belegen = schluessel => kontingentBelegen(DB, { art: "test", schluessel, jeSchluessel: 2, gesamt: 3, jetzt });
  const gleichzeitig = await Promise.all([belegen("a"), belegen("a"), belegen("a")]);
  assert.deepEqual(gleichzeitig.map(r => r.ok), [true, true, false]);
  assert.equal(gleichzeitig[2].grund, "ANSCHLUSS");
  assert.equal((await belegen("b")).ok, true);
  const voll = await belegen("c");
  assert.deepEqual(voll, { ok: false, grund: "GESAMT" });
  assert.equal(await kontingentStand(DB, { art: "test", jetzt }), 3);
  assert.equal(await kontingentStand(DB, { art: "test", schluessel: "a", jetzt }), 2);

  // Zurueckgegeben (Aktion fand nicht statt): wieder Platz.
  await kontingentFreigeben(DB, gleichzeitig[0].id);
  assert.equal((await belegen("c")).ok, true);
  // Fremde audit_events lassen sich so nicht loeschen.
  DB.raw.prepare("INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,created_at) VALUES ('x','SYSTEM','order','o1','PAYMENT_STARTED',?)").run(jetzt.toISOString());
  await kontingentFreigeben(DB, "x");
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE id='x'").get().n, 1);

  // Nach dem Fenster ist alles wieder frei, alte Zeilen sind weg.
  const morgen = new Date(jetzt.getTime() + TAG_MS + 1000);
  assert.equal((await kontingentBelegen(DB, { art: "test", schluessel: "a", jeSchluessel: 2, gesamt: 3, jetzt: morgen })).ok, true);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='kontingent:test'").get().n, 1);
});

test("Kontingent ohne Grenze merkt nur (z. B. offene Bestellungen je Anschluss)", async () => {
  const DB = sqliteD1(allMigrations());
  for (let i = 0; i < 5; i++) assert.equal((await kontingentBelegen(DB, { art: "merken", schluessel: "h", bezug: `o${i}` })).ok, true);
  assert.deepEqual(DB.raw.prepare("SELECT actor_ref FROM audit_events WHERE entity_type='kontingent:merken' ORDER BY actor_ref").all().map(r => r.actor_ref),
    ["o0", "o1", "o2", "o3", "o4"]);
});

test("Kontingent: der Cron raeumt IP-Hashes auch ruhender Arten weg", async () => {
  const DB = sqliteD1(allMigrations());
  const jetzt = new Date("2026-10-15T12:00:00.000Z");
  const vor = ms => new Date(jetzt.getTime() - ms).toISOString();
  const zeile = DB.raw.prepare("INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,created_at) VALUES (?,'SYSTEM',?,?,?,?)");
  zeile.run("w-alt", "kontingent:widerruf-mail", "hash", "KONTINGENT_BELEGT", vor(TAG_MS + 1000));
  zeile.run("w-neu", "kontingent:widerruf-mail", "hash", "KONTINGENT_BELEGT", vor(60 * 60 * 1000));
  // Halte raeumt offene-halte.js (halteAufraeumen) nach 30 Minuten; hier
  // greift nur noch das laengste Fenster.
  zeile.run("h-tag", "kontingent:halt-kasse", "hash", "KONTINGENT_BELEGT", vor(TAG_MS + 1000));
  zeile.run("h-alt", "kontingent:halt-miete", "hash", "KONTINGENT_BELEGT", vor(31 * TAG_MS));
  zeile.run("t-alt", "kontingent:testshop-mail", "-", "KONTINGENT_BELEGT", vor(TAG_MS + 1000));
  zeile.run("s-mittel", "kontingent:spiel-code", "hash", "KONTINGENT_BELEGT", vor(10 * TAG_MS));
  zeile.run("s-alt", "kontingent:spiel-code", "hash", "KONTINGENT_BELEGT", vor(31 * TAG_MS));
  zeile.run("fremd", "order", "o1", "PAYMENT_STARTED", vor(400 * TAG_MS));
  // Bereich statt LIKE: nur entity_type mit genau "kontingent:" vorn.
  zeile.run("aehnlich-1", "kontingent;x", "-", "KONTINGENT_BELEGT", vor(400 * TAG_MS));
  zeile.run("aehnlich-2", "kontingentx", "-", "KONTINGENT_BELEGT", vor(400 * TAG_MS));
  zeile.run("aehnlich-3", "Kontingent:x", "-", "KONTINGENT_BELEGT", vor(400 * TAG_MS));
  const ergebnis = await kontingentAufraeumen(DB, jetzt);
  assert.equal(ergebnis.geloescht, 4);
  assert.deepEqual(DB.raw.prepare("SELECT id FROM audit_events ORDER BY id").all().map(r => r.id),
    ["aehnlich-1", "aehnlich-2", "aehnlich-3", "fremd", "h-tag", "s-mittel", "w-neu"]);
  assert.deepEqual(await kontingentAufraeumen(null, jetzt), { geloescht: 0 });
});

test("Kontingent: das laengste Fenster deckt jede Art ab (Spiel-Codes, Halte)", () => {
  // Kein Import von game-rewards.js in kontingent.js (Kreis) - darum hier.
  assert.ok(LAENGSTES_FENSTER_MS >= SPIEL_CODE_FENSTER_TAGE * TAG_MS,
    "SPIEL_CODE_FENSTER_TAGE gewachsen: LAENGSTES_FENSTER_MS in kontingent.js mitziehen");
  assert.ok(LAENGSTES_FENSTER_MS >= HALT_FENSTER_MS);
});
