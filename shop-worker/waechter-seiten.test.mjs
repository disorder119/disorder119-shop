import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ERWISCHT_SPRACHEN, TURNSTILE_SITE_KEY, anzeigeText, erwischtCsp, erwischtSeite, erwischtSprache, esc, geraetText,
  sichererRuecksprung, sperrCsp, sperrSeite, sperrSprache, vorfallNummer, vorschauDaten,
} from "./waechter-seiten.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T0 = Date.parse("2026-10-28T09:59:31Z");
const basis = { ip: "198.51.100.7", land: "FR", stadt: "Paris", netz: "OVH SAS", asn: 16276, zeit: T0, grund: "sql-injection", nr: "W-ABC2345" };

test("Escaping: Nutzlast, Browserkennung und Netz koennen kein HTML einschleusen", () => {
  const boese = [
    "/?q=<script>alert(1)</script>",
    '/?x="><img src=x onerror=alert(document.cookie)>',
    "/?a=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
    "/?n=‮gnp.exe‬&b=⁦x⁩",
    "/?s=</code></li></ol><h1>fake</h1>",
    "/?t=' onmouseover='alert(1)",
  ];
  for (const nutzlast of boese) {
    const html = erwischtSeite({ ...basis, nutzlast, ua: '<svg onload=alert(1)>"', netz: '<b>OVH</b>"', stadt: "<i>Paris</i>" });
    const body = html.slice(html.indexOf("<body>"));
    assert.ok(!/<script/i.test(body), nutzlast);
    assert.ok(!/<img/i.test(body), nutzlast);
    assert.ok(!/<svg/i.test(body), nutzlast);
    assert.ok(!/<h1>fake/i.test(body), nutzlast);
    assert.ok(!/onerror=|onmouseover=|onload=/i.test(body.replace(/&[a-z#0-9]+;/gi, "")) || !/<[^>]*\bon\w+=/i.test(body), nutzlast);
    assert.ok(!/[‪-‮⁦-⁩]/.test(html), "keine Richtungszeichen");
    // Genau ein code-Element, es wird nicht vorzeitig geschlossen.
    assert.equal((body.match(/<code /g) || []).length, 1);
    assert.equal((body.match(/<\/code>/g) || []).length, 1);
  }
  const html = erwischtSeite({ ...basis, nutzlast: "/?q=<script>alert(1)</script>" });
  assert.match(html, /\/\?q=&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("Sehr lange Browserkennung und Nutzlast werden gekuerzt", () => {
  const ua = "Mozilla/5.0 " + "A".repeat(20000);
  const nutzlast = "/?q=" + "x".repeat(20000);
  const html = erwischtSeite({ ...basis, ua, nutzlast });
  assert.ok(html.length < 12000, `Seite bleibt klein (${html.length})`);
  assert.equal(anzeigeText("a".repeat(500), 120).length, 120);
  assert.equal(Array.from(anzeigeText("😀".repeat(300), 10)).length, 10, "nach Zeichen, nicht mitten im Emoji");
  assert.equal(geraetText("sqlmap/1.7.2#stable (https://sqlmap.org)"), "sqlmap/1.7.2#stable");
  assert.equal(geraetText("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"), "iOS · Safari 18");
  assert.equal(geraetText("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"), "Windows · Edge 130");
  assert.equal(esc(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
});

test("Sprache nach Land, Englisch immer dazu, Rechts-nach-links fuer Arabisch, Persisch, Urdu, Hebraeisch", () => {
  const faelle = [["FR", "fr", "ATTAQUE DÉTECTÉE"], ["DE", "de", "ANGRIFF ERKANNT"], ["IN", "hi", "हमला पकड़ा गया"], ["KH", "km", "រកឃើញការវាយប្រហារ"],
    ["RU", "ru", "АТАКА ОБНАРУЖЕНА"], ["CN", "zh", "检测到攻击"], ["TW", "zh-Hant", "偵測到攻擊"], ["JP", "ja", "攻撃を検知しました"], ["BR", "pt", "ATAQUE DETECTADO"],
    ["PH", "fil", "NATUKLASAN ANG PAG-ATAKE"], ["VN", "vi", "PHÁT HIỆN TẤN CÔNG"], ["TR", "tr", "SALDIRI TESPİT EDİLDİ"], ["BD", "bn", "আক্রমণ শনাক্ত হয়েছে"]];
  for (const [land, sprache, titel] of faelle) {
    assert.equal(erwischtSprache(land), sprache, land);
    const html = erwischtSeite({ ...basis, land });
    assert.match(html, new RegExp(`<html lang="${sprache}" dir="ltr">`), land);
    assert.ok(html.includes(titel), land);
    assert.match(html, /I know you&#39;re trying to hack me\./, land);
    assert.match(html, /Your attack was blocked and logged\. This connection is blocked\./, land);
  }
  for (const [land, sprache] of [["SA", "ar"], ["IR", "fa"], ["PK", "ur"], ["IL", "he"]]) {
    const html = erwischtSeite({ ...basis, land });
    assert.match(html, new RegExp(`<html lang="${sprache}" dir="rtl">`), land);
    assert.match(html, /<p class="satz en" lang="en" dir="ltr">/);
    assert.match(html, /<code class="w" dir="ltr">/, "Nutzlast bleibt links-nach-rechts");
  }
  const en = erwischtSeite({ ...basis, land: "US" });
  assert.match(en, /<html lang="en"/);
  assert.equal((en.match(/I know you&#39;re trying to hack me/g) || []).length, 1, "kein doppeltes Englisch");
  assert.equal(erwischtSprache("XX"), "en");
  assert.equal(erwischtSprache(""), "en");
  for (const sprache of ["de", "en", "fr", "es", "it", "pt", "nl", "pl", "cs", "ro", "hu", "el", "sv", "ru", "uk", "tr", "ar", "fa", "hi", "bn", "ur", "zh", "ja", "ko", "vi", "th", "id", "ms", "km", "fil"]) {
    assert.ok(ERWISCHT_SPRACHEN.includes(sprache), sprache);
    const html = erwischtSeite({ ...basis, sprache });
    assert.ok(!/undefined|>null</.test(html), sprache);
    assert.match(html, new RegExp(`<html lang="${sprache}"`), sprache);
  }
});

test("Nur echte Daten, ehrlicher Text, keine Drohungen", () => {
  const html = erwischtSeite({ ...basis, nutzlast: "/fr/mieten/?item=1' AND 1=1 UNION SELECT NULL-- -", ua: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0" });
  for (const wahr of ["198.51.100.7", "OVH SAS (AS16276)", "Paris, France", "Linux · Firefox 131", "2026-10-28 09:59:31 UTC", "SQL injection", "W-ABC2345"]) {
    assert.ok(html.includes(wahr), wahr);
  }
  assert.ok(!/police|polizei|download|\.exe|virus|hacked your|deinen Computer/i.test(html), "keine falschen Behauptungen");
  assert.ok(!/<script|<link|<img|https?:\/\/(?!disorder119)/i.test(html.replace(/https:\/\/disorder119\.com/g, "")), "keine externen Ressourcen");
  assert.match(html, /prefers-reduced-motion:reduce/);
});

test("CSP: Stil nur per Hash, kein Skript; Sperrseite erlaubt nur Turnstile", async () => {
  const csp = await erwischtCsp();
  assert.match(csp, /^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'$/);
  const html = erwischtSeite(basis);
  const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
  const hash = `'sha256-${Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(css))).toString("base64")}'`;
  assert.ok(csp.includes(hash), "Hash passt zum ausgelieferten Stil");
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
  assert.equal(vorschauDaten("<x>", T0).land, "FR");
  assert.match(erwischtSeite(v), /PREVIEW/);
});
