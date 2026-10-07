import assert from "node:assert/strict";
import test from "node:test";
import { heuteInDeutschland, istWerktag, lieferfenster, ostersonntag, plusWerktage } from "./lieferzeit.js";

const tag = iso => new Date(`${iso}T00:00:00Z`);

test("Easter Sunday for the moving Bavarian holidays", () => {
  assert.equal(ostersonntag(2024).toISOString().slice(0, 10), "2024-03-31");
  assert.equal(ostersonntag(2025).toISOString().slice(0, 10), "2025-04-20");
  assert.equal(ostersonntag(2026).toISOString().slice(0, 10), "2026-04-05");
  assert.equal(ostersonntag(2027).toISOString().slice(0, 10), "2027-03-28");
});

test("working days are Monday to Friday without Bavarian public holidays", () => {
  assert.equal(istWerktag(tag("2026-10-05")), true); // Montag
  assert.equal(istWerktag(tag("2026-10-10")), false); // Samstag
  assert.equal(istWerktag(tag("2026-10-11")), false); // Sonntag
  // Alle auf Montag bis Freitag: Neujahr, Heilige Drei Koenige, Karfreitag,
  // Ostermontag, 1. Mai, Himmelfahrt, Pfingstmontag, Fronleichnam, Mariae
  // Himmelfahrt, Tag der Deutschen Einheit, Allerheiligen, Weihnachten.
  for (const feiertag of ["2026-01-01", "2026-01-06", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-14",
    "2026-05-25", "2026-06-04", "2025-08-15", "2025-10-03", "2027-11-01", "2026-12-25", "2027-03-26", "2027-03-29"]) {
    assert.equal(istWerktag(tag(feiertag)), false, feiertag);
  }
  assert.equal(istWerktag(tag("2026-12-24")), true); // Heiligabend ist kein gesetzlicher Feiertag
  assert.equal(plusWerktage(tag("2026-10-09"), 1).toISOString().slice(0, 10), "2026-10-12");
});

test("today is the German date, not UTC", () => {
  // 22:30 UTC am 7. Oktober ist in Deutschland schon der 8. Oktober.
  assert.equal(heuteInDeutschland(new Date("2026-10-07T22:30:00Z")).toISOString().slice(0, 10), "2026-10-08");
  assert.equal(heuteInDeutschland(new Date("2026-01-15T23:30:00Z")).toISOString().slice(0, 10), "2026-01-16");
  assert.equal(heuteInDeutschland(new Date("2026-01-15T22:30:00Z")).toISOString().slice(0, 10), "2026-01-15");
});

test("delivery window: shipped within 3 working days plus the carrier's transit time", () => {
  // Mittwoch: fruehestens Montag (Versand Do + 2 Tage), spaetestens Mittwoch.
  assert.deepEqual(lieferfenster(2, new Date("2026-10-07T10:00:00Z")), { von: "2026-10-12", bis: "2026-10-14" });
  // Kurz vor Mitternacht deutscher Zeit zaehlt schon der naechste Tag.
  assert.deepEqual(lieferfenster(2, new Date("2026-10-07T22:30:00Z")), { von: "2026-10-13", bis: "2026-10-15" });
  // Weihnachten: 25. und 26. Dezember zaehlen nicht.
  assert.deepEqual(lieferfenster(2, new Date("2026-12-22T09:00:00Z")), { von: "2026-12-28", bis: "2026-12-30" });
  // Ostern 2027: Karfreitag und Ostermontag zaehlen nicht.
  assert.deepEqual(lieferfenster(1, new Date("2027-03-25T09:00:00Z")), { von: "2027-03-31", bis: "2027-04-02" });
  // Ohne bekannte Laufzeit kein Datum.
  assert.equal(lieferfenster(null), null);
  assert.equal(lieferfenster(0), null);
  assert.equal(lieferfenster(30), null);
});
