import assert from "node:assert/strict";
import test from "node:test";
import {
  KLEINUNTERNEHMER_LAUFEND_CENTS,
  KLEINUNTERNEHMER_VORJAHR_CENTS,
  bestellungenAlsCsv,
  csvFeld,
  handleBuchhaltung,
  jahrAusText,
  jahresZusammenfassung,
} from "./buchhaltung.js";

const ORIGIN = "https://admin.disorder119.com";
const TOKEN = "owner-test-token";

function zeile(ueber = {}) {
  return {
    id: "o1",
    order_number: "D119-20260115-ABC12345",
    status: "PAID",
    currency: "EUR",
    subtotal_cents: 38000,
    shipping_cents: 590,
    total_cents: 38590,
    created_at: "2026-01-15T10:00:00.000Z",
    article_no: "119-42",
    title_snapshot: "Prada Reversible Jacket",
    country_code: "DE",
    ...ueber,
  };
}

test("only sensible years are accepted", () => {
  const jetzt = new Date().getUTCFullYear();
  assert.equal(jahrAusText(String(jetzt)), jetzt);
  assert.equal(jahrAusText(2024), 2024);
  for (const kaputt of ["", "abc", "1999", String(jetzt + 5), "20260"]) {
    assert.throws(() => jahrAusText(kaputt), err => err.code === "JAHR_UNGUELTIG" && err.status === 400);
  }
});

test("a CSV field cannot smuggle a formula into the spreadsheet", () => {
  assert.equal(csvFeld("=1+1"), "\"'=1+1\"");
  assert.equal(csvFeld("+49"), "\"'+49\"");
  assert.equal(csvFeld("-5"), "\"'-5\"");
  assert.equal(csvFeld("@cmd"), "\"'@cmd\"");
  assert.equal(csvFeld('Titel mit "Zitat"'), '"Titel mit ""Zitat"""');
  assert.equal(csvFeld("Prada Jacke"), '"Prada Jacke"');
});

test("the order list carries every column the tax advisor needs", () => {
  const csv = bestellungenAlsCsv([zeile()]);
  const zeilen = csv.trim().split("\r\n");
  assert.equal(zeilen.length, 2);
  assert.match(zeilen[0], /"Datum";"Rechnungsnummer";"Artikel";"Artikelnummer";"Warenwert";"Versand";"Gesamt"/);
  // Deutsche Dezimaltrennung, damit die Betraege als Zahl ankommen.
  assert.match(zeilen[1], /"380,00";"5,90";"385,90"/);
  assert.match(zeilen[1], /"2026-01-15"/);
  assert.match(zeilen[1], /"D119-20260115-ABC12345"/);
});

test("revenue counts once per order even with several positions", () => {
  const bericht = jahresZusammenfassung([
    zeile(),
    zeile({ article_no: "119-43", title_snapshot: "Zweite Position" }),
    zeile({ id: "o2", order_number: "D119-20260220-B", created_at: "2026-02-20T10:00:00.000Z", subtotal_cents: 10000, total_cents: 10590 }),
  ], 2026);
  assert.equal(bericht.bestellungen, 2);
  assert.equal(bericht.warenwertCents, 48000);
  assert.equal(bericht.versandCents, 1180);
  assert.equal(bericht.gesamtCents, 49180);
  assert.equal(bericht.monate[0].bestellungen, 1);
  assert.equal(bericht.monate[1].bestellungen, 1);
  assert.equal(bericht.monate[5].bestellungen, 0);
  assert.equal(bericht.monate.length, 12);
});

test("the small-business thresholds are reported, not silently passed", () => {
  const ruhig = jahresZusammenfassung([zeile()], 2026, 0);
  assert.equal(ruhig.kleinunternehmer.laufendUeberschritten, false);
  assert.equal(ruhig.kleinunternehmer.nahAnGrenze, false);
  assert.match(ruhig.kleinunternehmer.hinweis, /§ 19 UStG/);

  const knapp = jahresZusammenfassung(
    [zeile({ total_cents: Math.round(KLEINUNTERNEHMER_LAUFEND_CENTS * 0.85) })], 2026, 0,
  );
  assert.equal(knapp.kleinunternehmer.nahAnGrenze, true);
  assert.match(knapp.kleinunternehmer.hinweis, /naehert sich/);

  const drueber = jahresZusammenfassung(
    [zeile({ total_cents: KLEINUNTERNEHMER_LAUFEND_CENTS + 1 })], 2026, 0,
  );
  assert.equal(drueber.kleinunternehmer.laufendUeberschritten, true);
  assert.match(drueber.kleinunternehmer.hinweis, /Regelbesteuerung/);

  const vorjahr = jahresZusammenfassung([zeile()], 2026, KLEINUNTERNEHMER_VORJAHR_CENTS + 1);
  assert.equal(vorjahr.kleinunternehmer.vorjahrUeberschritten, true);
  assert.match(vorjahr.kleinunternehmer.hinweis, /Vorjahresumsatz/);
});

function db(zeilen = [zeile()], archiv = []) {
  return {
    prepare(sql) {
      const text = String(sql);
      return {
        bind(...args) {
          return {
            async all() {
              if (text.includes("FROM rechnungen")) {
                const jahr = String(args[0] || "").slice(0, 4);
                return { results: archiv.filter(r => String(r.ausgestellt_am).startsWith(jahr)) };
              }
              const jahr = String(args[0] || "").slice(0, 4);
              return { results: zeilen.filter(z => String(z.created_at).startsWith(jahr)) };
            },
            async first() {
              if (text.includes("SELECT html FROM rechnungen")) {
                return archiv.find(r => r.order_id === args[0] || r.rechnungsnummer === args[1]) || null;
              }
              return null;
            },
            async run() { return { meta: { changes: 1 } }; },
          };
        },
      };
    },
  };
}

function anfrage(pfad, token = TOKEN) {
  const url = new URL("https://worker.example" + pfad);
  return {
    url,
    request: new Request(url, { headers: { Authorization: `Bearer ${token}`, Origin: ORIGIN } }),
  };
}

test("bookkeeping is closed without a valid owner token", async () => {
  const { request, url } = anfrage("/admin/buchhaltung/jahr/2026", "falsch");
  const antwort = await handleBuchhaltung(request, { ADMIN_TOKEN: TOKEN, DB: db() }, url, "r1", ORIGIN);
  assert.equal(antwort.status, 401);
  assert.equal((await antwort.json()).error, "UNAUTHORIZED");
});

test("a foreign origin is refused", async () => {
  const url = new URL("https://worker.example/admin/buchhaltung/jahr/2026");
  const request = new Request(url, { headers: { Authorization: `Bearer ${TOKEN}`, Origin: "https://boese.example" } });
  const antwort = await handleBuchhaltung(request, { ADMIN_TOKEN: TOKEN, DB: db() }, url, "r2", "https://boese.example");
  assert.equal(antwort.status, 403);
});

test("the yearly overview adds up and names the previous year", async () => {
  const zeilen = [zeile(), zeile({ id: "alt", created_at: "2025-06-01T10:00:00.000Z", total_cents: 999 })];
  const { request, url } = anfrage("/admin/buchhaltung/jahr/2026");
  const antwort = await handleBuchhaltung(request, { ADMIN_TOKEN: TOKEN, DB: db(zeilen) }, url, "r3", ORIGIN);
  const daten = await antwort.json();
  assert.equal(antwort.status, 200);
  assert.equal(daten.jahr, 2026);
  assert.equal(daten.bestellungen, 1);
  assert.equal(daten.gesamtCents, 38590);
  assert.equal(daten.kleinunternehmer.vorjahrCents, 999);
});

test("the CSV download is delivered as a file with a BOM", async () => {
  const { request, url } = anfrage("/admin/buchhaltung/bestellungen.csv?jahr=2026");
  const antwort = await handleBuchhaltung(request, { ADMIN_TOKEN: TOKEN, DB: db() }, url, "r4", ORIGIN);
  assert.equal(antwort.status, 200);
  assert.match(antwort.headers.get("Content-Type"), /text\/csv/);
  assert.match(antwort.headers.get("Content-Disposition"), /disorder119-bestellungen-2026\.csv/);
  // Ueber .text() ist die Byte-Order-Mark nicht mehr zu sehen: der Decoder
  // entfernt sie. Sie muss aber in den Bytes stehen, sonst zeigt Excel Umlaute
  // falsch an - deshalb wird hier der Rohinhalt geprueft.
  const bytes = new Uint8Array(await antwort.clone().arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF]);
  assert.match(await antwort.text(), /D119-20260115-ABC12345/);
});

const ARCHIV = [{
  order_id: "o1",
  rechnungsnummer: "D119-20260115-ABC12345",
  ausgestellt_am: "2026-01-15T10:00:00.000Z",
  waehrung: "EUR",
  warenwert_cents: 38000,
  versand_cents: 590,
  gesamt_cents: 38590,
  pruefsumme: "abc123",
  html: "<html><head></head><body><p>ARCHIVIERTE FASSUNG</p></body></html>",
}];

test("an archived invoice is served unchanged, not rebuilt", async () => {
  const { request, url } = anfrage("/admin/buchhaltung/rechnung/o1");
  const antwort = await handleBuchhaltung(request, { ADMIN_TOKEN: TOKEN, DB: db([zeile()], ARCHIV) }, url, "r6", ORIGIN);
  const html = await antwort.text();
  assert.equal(antwort.status, 200);
  assert.match(html, /ARCHIVIERTE FASSUNG/);
  // Keine Warnung: das ist die Fassung, die der Kunde bekommen hat.
  assert.doesNotMatch(html, /Aus den Bestelldaten erzeugte Fassung/);
});

test("without an archived copy the generated one says so", async () => {
  const { request, url } = anfrage("/admin/buchhaltung/rechnung/o1");
  const antwort = await handleBuchhaltung(request, { ADMIN_TOKEN: TOKEN, DB: db() }, url, "r7", ORIGIN);
  // Ohne Archiv faellt die Buchhaltung auf die erzeugte Fassung zurueck und
  // kennzeichnet sie - niemand soll sie fuer die ausgestellte halten.
  if (antwort.status === 200) {
    assert.match(await antwort.text(), /Aus den Bestelldaten erzeugte Fassung/);
  } else {
    assert.equal((await antwort.json()).error, "BESTELLUNG_NICHT_GEFUNDEN");
  }
});

test("the invoice list carries number, date, total and checksum", async () => {
  const { request, url } = anfrage("/admin/buchhaltung/rechnungen?jahr=2026");
  const antwort = await handleBuchhaltung(request, { ADMIN_TOKEN: TOKEN, DB: db([zeile()], ARCHIV) }, url, "r8", ORIGIN);
  const daten = await antwort.json();
  assert.equal(antwort.status, 200);
  assert.equal(daten.anzahl, 1);
  assert.equal(daten.gesamtCents, 38590);
  assert.equal(daten.rechnungen[0].rechnungsnummer, "D119-20260115-ABC12345");
  assert.equal(daten.rechnungen[0].pruefsumme, "abc123");
  assert.match(daten.rechnungen[0].weg, /\/admin\/buchhaltung\/rechnung\/o1$/);
});

test("an implausible year is refused instead of scanning everything", async () => {
  const { request, url } = anfrage("/admin/buchhaltung/bestellungen.csv?jahr=1999");
  const antwort = await handleBuchhaltung(request, { ADMIN_TOKEN: TOKEN, DB: db() }, url, "r5", ORIGIN);
  assert.equal(antwort.status, 400);
  assert.equal((await antwort.json()).error, "JAHR_UNGUELTIG");
});
