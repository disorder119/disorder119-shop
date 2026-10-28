import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ERWISCHT_SPRACHEN, TURNSTILE_SITE_KEY, anzeigeText, erwischtCsp, erwischtSeite, erwischtSprache, erwischtVariante, esc, geraetText,
  sichererRuecksprung, sperrCsp, sperrSeite, sperrSprache, vorfallNummer, vorschauDaten,
} from "./waechter-seiten.js";
import { V } from "./waechter-erwischt-texte.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T0 = Date.parse("2026-10-28T09:59:31Z");
const PRODUKTE = [
  { marke: "Prada", titel: "Prada Sport Sneaker Schwarz", titelEn: "Prada Sport Sneaker Black", preis: 120, nr: "132", bild: "assets/img/9491/thumbs/0.webp", kat: "Sneakers" },
  { marke: "Balmain", titel: "Balmain Kunstfelljacke Damen Braun", titelEn: "Balmain Faux Fur Jacket Women Brown", preis: 250, nr: "67", bild: "assets/img/9418/thumbs/0.webp", kat: "Jacket" },
  { marke: "Y-3", titel: "Y-3 Logo-Cap Grün", titelEn: "Y-3 Logo Cap Green", preis: 105, nr: "208", bild: "assets/img/b2-211/thumbs/0.webp", kat: "Hat" },
  { marke: "Dior", titel: "Dior Stricktop Damen Schwarz", titelEn: "Dior Knit Top Women Black", preis: 110, nr: "197", bild: "assets/img/b2-200/thumbs/0.webp", kat: "Top" },
  { marke: "Yohji Yamamoto", titel: "Yohji Yamamoto Wollhut", titelEn: "Yohji Yamamoto Wool Hat", preis: 380, nr: "182", bild: "assets/img/b2-185/thumbs/0.webp", kat: "Hat" },
  { marke: "Raf Simons", titel: "Raf Simons Lederweste Herren", titelEn: "Raf Simons Leather Vest Men", preis: 1200, nr: "201", bild: "assets/img/6204/thumbs/0.webp", kat: "Vest" },
  { marke: "Böse", titel: "x", titelEn: "x", preis: 1, nr: "<script>", bild: "javascript:alert(1)", kat: "" },
];
const basis = { ip: "198.51.100.7", land: "FR", stadt: "Paris", netz: "OVH SAS", asn: 16276, zeit: T0, grund: "sql-injection", nr: "W-ABC2345", bis: new Date(T0 + 24 * 3600_000).toISOString(), produkte: PRODUKTE };
const VARIANTEN = ["a", "b", "c"];

test("Rotation: drei Varianten, deterministisch aus der Vorfall-Nummer, grob gleichverteilt", () => {
  // Gleiche Nummer -> gleiche Variante (kein Zufall je Request).
  for (const nr of ["W-7K2Q9XM", "W-ABC2345", "W-ZZZ2222"]) assert.equal(erwischtVariante(nr), erwischtVariante(nr), nr);
  // Override hat Vorrang.
  for (const v of VARIANTEN) assert.equal(erwischtVariante("W-IRRELEVANT", v), v);
  assert.ok(VARIANTEN.includes(erwischtVariante("W-X")));
  const zaehler = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 9000; i++) zaehler[erwischtVariante("W-" + i.toString(36).toUpperCase())]++;
  for (const v of VARIANTEN) assert.ok(zaehler[v] > 2400 && zaehler[v] < 3600, `${v}=${zaehler[v]}`);
});

test("Escaping: Nutzlast, Browserkennung, Netz und Produktdaten koennen in keiner Variante HTML einschleusen", () => {
  const boese = [
    "/?q=<script>alert(1)</script>",
    '/?x="><img src=x onerror=alert(document.cookie)>',
    "/?a=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
    "/?n=‮gnp.exe‬&b=⁦x⁩",
    "/?s=</code></li></ol><h1>fake</h1>",
    "/?t=' onmouseover='alert(1)",
  ];
  for (const variante of VARIANTEN) {
    for (const nutzlast of boese) {
      const html = erwischtSeite({ ...basis, variante, nutzlast, ua: '<svg onload=alert(1)>"', netz: '<b>OVH</b>"', stadt: "<i>Paris</i>" });
      const body = html.slice(html.indexOf("<body>"));
      const ohneEntities = body.replace(/&[a-z#0-9]+;/gi, "");
      assert.ok(!/<script/i.test(body), `${variante} ${nutzlast}`);
      assert.ok(!/<svg[^>]*onload/i.test(body), `${variante} svg`);
      assert.ok(!/<img[^>]*onerror/i.test(body), `${variante} img`);
      assert.ok(!/<h1>fake/i.test(body), `${variante} fake`);
      assert.ok(!/<[^>]*\son\w+=/i.test(ohneEntities), `${variante} inline-handler`);
      assert.ok(!/[‪-‮⁦-⁩]/.test(html), "keine Richtungszeichen");
      // Genau ein echtes <code>-Element (die Nutzlast), nie vorzeitig geschlossen.
      assert.equal((body.match(/<code /g) || []).length, 1, `${variante} code offen`);
      assert.equal((body.match(/<\/code>/g) || []).length, 1, `${variante} code zu`);
      // Jedes Bild ist ein eigenes Asset, kein eingeschleuster Pfad.
      for (const src of body.match(/<img[^>]*\ssrc="([^"]*)"/g) || []) assert.match(src, /src="\/assets\/img\//, `${variante} img-src`);
    }
    const html = erwischtSeite({ ...basis, variante, nutzlast: "/?q=<script>alert(1)</script>" });
    assert.match(html, /\/\?q=&lt;script&gt;alert\(1\)&lt;\/script&gt;/, variante);
  }
});

test("Sehr lange Browserkennung und Nutzlast werden gekuerzt, die Seite bleibt klein", () => {
  const ua = "Mozilla/5.0 " + "A".repeat(20000);
  const nutzlast = "/?q=" + "x".repeat(20000);
  for (const variante of VARIANTEN) {
    const html = erwischtSeite({ ...basis, variante, ua, nutzlast });
    assert.ok(html.length < 90000, `${variante} Seite bleibt klein (${html.length})`);
  }
  assert.equal(anzeigeText("a".repeat(500), 120).length, 120);
  assert.equal(Array.from(anzeigeText("😀".repeat(300), 10)).length, 10, "nach Zeichen, nicht mitten im Emoji");
  assert.equal(geraetText("sqlmap/1.7.2#stable (https://sqlmap.org)"), "sqlmap/1.7.2#stable");
  assert.equal(geraetText("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"), "iOS · Safari 18");
  assert.equal(esc(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
});

test("Sprache nach Land in jeder Variante, Englisch immer dazu, Rechts-nach-links fuer Arabisch, Persisch, Urdu, Hebraeisch", () => {
  const faelle = [["FR", "fr"], ["DE", "de"], ["IN", "hi"], ["KH", "km"], ["RU", "ru"], ["CN", "zh"], ["JP", "ja"], ["BR", "pt"], ["PH", "fil"], ["VN", "vi"], ["TR", "tr"], ["BD", "bn"], ["US", "en"]];
  const enText = "Your attack was blocked and logged. This connection is blocked.";
  for (const [land, sprache] of faelle) {
    for (const variante of VARIANTEN) {
      const html = erwischtSeite({ ...basis, land, variante });
      assert.match(html, new RegExp(`<html lang="${sprache}" dir="ltr">`), `${land}/${variante}`);
      const titel = variante === "a" ? V[sprache].aTitel : variante === "b" ? V[sprache].bTitel : V[sprache].cTitel1;
      assert.ok(html.includes(esc(titel)), `${land}/${variante} Ueberschrift`);
      assert.ok(html.includes(enText), `${land}/${variante} Englisch`);
      assert.ok(!/undefined|>null<|\[object/.test(html), `${land}/${variante} sauber`);
    }
  }
  for (const [land, sprache] of [["SA", "ar"], ["IR", "fa"], ["PK", "ur"], ["IL", "he"]]) {
    for (const variante of VARIANTEN) {
      const html = erwischtSeite({ ...basis, land, variante });
      assert.match(html, new RegExp(`<html lang="${sprache}" dir="rtl">`), `${land}/${variante}`);
      assert.match(html, /<code[^>]* dir="ltr">/, "Nutzlast bleibt links-nach-rechts");
      assert.match(html, /dir="ltr">198\.51\.100\.7/, "IP bleibt links-nach-rechts");
    }
  }
  const en = erwischtSeite({ ...basis, land: "US", variante: "a" });
  assert.equal((en.match(/lang="en"/g) || []).length, 1, "englische Seite ohne doppelte Sprache (nur das html-Attribut)");
  assert.equal(erwischtSprache("XX"), "en");
  assert.equal(erwischtSprache(""), "en");
  // Alle Mindestsprachen rendern ohne Luecken.
  for (const sprache of ["de", "en", "fr", "es", "it", "pt", "nl", "pl", "cs", "ro", "hu", "el", "sv", "da", "nb", "fi", "ru", "uk", "tr", "ar", "fa", "hi", "bn", "ur", "zh", "ja", "ko", "vi", "th", "id", "ms", "km", "fil"]) {
    assert.ok(ERWISCHT_SPRACHEN.includes(sprache), sprache);
    assert.ok(V[sprache], `V fehlt ${sprache}`);
    for (const variante of VARIANTEN) {
      const html = erwischtSeite({ ...basis, sprache, variante });
      assert.ok(!/undefined|>null</.test(html), `${sprache}/${variante}`);
      assert.match(html, new RegExp(`<html lang="${sprache}"`), `${sprache}/${variante}`);
    }
  }
});

test("Echte Artikel: freigestellte Vorschaubilder, Marke, Name, Preis, Produktlink; defekte Daten fallen weg", () => {
  for (const variante of VARIANTEN) {
    const html = erwischtSeite({ ...basis, sprache: "de", variante });
    assert.match(html, /\/assets\/img\/9491\/thumbs\/0\.webp/, `${variante} Bild`);
    assert.match(html, /href="\/artikel\/132\/"/, `${variante} Produktlink`);
    assert.match(html, /Prada/, `${variante} Marke`);
    // "Böse" Produkt (javascript:-Bild, kein gueltiger Pfad) darf nicht erscheinen.
    assert.ok(!/javascript:/.test(html), `${variante} kein boeser Pfad`);
    assert.ok(!html.includes("Böse"), `${variante} boeses Produkt gefiltert`);
  }
  // Ohne Produkte rendert die Seite trotzdem (nie Fehler).
  for (const variante of VARIANTEN) {
    const html = erwischtSeite({ ...basis, produkte: [], variante });
    assert.ok(html.includes("</html>"), `${variante} ohne Produkte`);
    assert.ok(!/<img[^>]*src="\/assets\/img/.test(html), `${variante} keine Bilder`);
  }
});

test("Echte Sperrdauer: 24 h, 7 Tage, 2 h; ohne Angabe neutral", () => {
  const vt = V.de;
  const h = (ms) => erwischtSeite({ ...basis, sprache: "de", variante: "a", bis: new Date(T0 + ms).toISOString(), zeit: T0 });
  assert.ok(h(24 * 3600_000).includes(`24 ${vt.std}`), "24 h");
  assert.ok(h(7 * 86400_000).includes(`7 ${vt.tage}`), "7 Tage");
  assert.ok(h(2 * 3600_000).includes(`2 ${vt.std}`), "2 h");
  // Ohne/abgelaufene Angabe neutral, keine erfundene Zahl.
  const neutral = erwischtSeite({ ...basis, sprache: "de", variante: "a", bis: null });
  assert.ok(neutral.includes(vt.dNull), "neutral");
  for (const variante of VARIANTEN) assert.ok(erwischtSeite({ ...basis, sprache: "de", variante, bis: new Date(T0 + 7 * 86400_000).toISOString(), zeit: T0 }).includes(`7 ${vt.tage}`), `${variante} Dauer sichtbar`);
});

test("Nur echte Daten, ehrlicher Text, keine Drohungen, keine externen Ressourcen", () => {
  for (const variante of VARIANTEN) {
    const html = erwischtSeite({ ...basis, variante, nutzlast: "/fr/mieten/?item=1' AND 1=1 UNION SELECT NULL-- -", ua: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0" });
    for (const wahr of ["198.51.100.7", "OVH SAS (AS16276)", "Paris, France", "Linux · Firefox 131", "2026-10-28 09:59:31 UTC", "SQL injection", "W-ABC2345"]) {
      assert.ok(html.includes(wahr), `${variante} ${wahr}`);
    }
    assert.ok(!/police|polizei|download|\.exe|virus|hacked your|deinen Computer/i.test(html), `${variante} keine falschen Behauptungen`);
    // Keine externen Ressourcen (nur eigene Assets, keine fremden Hosts, kein Skript).
    assert.ok(!/<script/i.test(html), `${variante} kein Skript`);
    assert.ok(!/https?:\/\/(?!disorder119)/i.test(html.replace(/https:\/\/disorder119\.com/g, "")), `${variante} keine fremden URLs`);
    assert.match(html, /prefers-reduced-motion:reduce/, `${variante} Bewegung reduzierbar`);
  }
});

test("CSP: Stil nur per Hash (passend zur Variante), img-src nur eigene Domain, kein Skript", async () => {
  for (const variante of VARIANTEN) {
    const csp = await erwischtCsp(variante);
    assert.match(csp, /^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'$/, variante);
    const html = erwischtSeite({ ...basis, variante });
    const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
    const hash = `'sha256-${Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(css))).toString("base64")}'`;
    assert.ok(csp.includes(hash), `${variante} Hash passt zum ausgelieferten Stil`);
  }
  const sperr = await sperrCsp();
  assert.match(sperr, /script-src https:\/\/challenges\.cloudflare\.com;/);
  assert.match(sperr, /frame-src https:\/\/challenges\.cloudflare\.com;/);
  assert.match(sperr, /form-action 'self'/);
  assert.doesNotMatch(sperr, /script-src[^;]*unsafe/);
});

test("Sperrseite: dreisprachig, Impressum, Turnstile nur bei milden Sperren, sichere Ruecksprungadresse", () => {
  const mild = sperrSeite({ sprache: "de", selbst: true, zurueck: "/artikel/12/?x=\"><script>" });
  assert.match(mild, /lang="de"[\s\S]*lang="en"[\s\S]*lang="fr"/);
  assert.match(mild, /href="\/impressum\/"/);
  assert.match(mild, /data-sitekey="0x4AAAAAAFHqI2j_AitAYIKF"/);
  assert.match(mild, /<form method="post" action="\/_waechter\/entsperren">/);
  assert.ok(!mild.includes('"><script>'), "Ruecksprung maskiert");
  const hart = sperrSeite({ sprache: "en", selbst: false, bis: "2026-10-29T10:00:00Z" });
  assert.doesNotMatch(hart, /<form|turnstile\/v0/);
  assert.match(hart, /The block ends on 29 October at 11:00/);
  assert.match(hart, /<nav lang="en"><a href="\/en\/impressum\/">Legal notice/);
  assert.equal(sperrSprache("/fr/kasse/", "DE"), "fr");
  assert.equal(sperrSprache("/", "BE"), "fr");
  assert.equal(sperrSprache("/", "AT"), "de");
  assert.equal(sperrSprache("/", "JP"), "en");
  for (const [roh, erwartet] of [["/kasse/?a=1", "/kasse/?a=1"], ["//evil.example", "/"], ["https://evil.example/", "/"], ["/\\evil.example", "/"],
    ["/%2F%2Fevil.example", "/%2F%2Fevil.example"], ["javascript:alert(1)", "/"], ["/_waechter/entsperren", "/"], ["/a\nb", "/"], ["", "/"], [null, "/"]]) {
    assert.equal(sichererRuecksprung(roh), erwartet, String(roh));
  }
});

test("Turnstile-Site-Key stimmt mit der Shop-Konfiguration ueberein", () => {
  const config = JSON.parse(fs.readFileSync(path.join(HERE, "..", "config", "shop-config.json"), "utf8"));
  assert.equal(TURNSTILE_SITE_KEY, config.turnstileSiteKey);
});

test("Vorfall-Nummer und Vorschau-Daten", () => {
  const nummern = new Set(Array.from({ length: 200 }, () => vorfallNummer()));
  assert.ok(nummern.size > 195);
  for (const nr of nummern) assert.match(nr, /^W-[A-HJ-NP-Z2-9]{7}$/);
  const v = vorschauDaten("KH", T0);
  assert.equal(v.ip, "203.0.113.42", "Dokumentations-IP");
  assert.equal(v.vorschau, true);
  assert.ok(v.bis, "Vorschau zeigt eine Dauer");
  assert.equal(vorschauDaten("<x>", T0).land, "FR");
  assert.match(erwischtSeite({ ...v, produkte: PRODUKTE }), /PREVIEW/);
});
