// Voraussichtliches Lieferfenster je Versandart, wie es Produktseite,
// Warenkorb und Kasse zeigen ("Heute bestellt – voraussichtlich bei dir
// zwischen Mo., 12.10. und Mi., 14.10.").
//
// Grundlage ist AGB § 4: Wir versenden innerhalb von 3 Werktagen nach der
// Bestellung, dazu kommt die Laufzeit des Paketdienstes. Werktage sind Montag
// bis Freitag ohne die gesetzlichen Feiertage in Bayern (Sitz des Shops).
//   fruehestens: am naechsten Werktag versendet + Laufzeit
//   spaetestens: am dritten Werktag versendet + Laufzeit
// Das ist dieselbe Spanne wie "3–5 Werktage" an der Kasse. Gerechnet wird mit
// dem heutigen Datum in Deutschland, nicht mit UTC.
export const VERSAND_WERKTAGE = 3;

const TAG_MS = 24 * 60 * 60 * 1000;
const BERLIN = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });

// Feste Feiertage in Bayern; Mariae Himmelfahrt gilt in Aschaffenburg.
const FESTE_FEIERTAGE = ["01-01", "01-06", "05-01", "08-15", "10-03", "11-01", "12-25", "12-26"];
// Bewegliche Feiertage, Tage ab Ostersonntag: Karfreitag, Ostermontag,
// Christi Himmelfahrt, Pfingstmontag, Fronleichnam.
const OSTER_ABSTAENDE = [-2, 1, 39, 50, 60];

function utcTag(jahr, monat, tag) {
  return new Date(Date.UTC(jahr, monat - 1, tag));
}

function iso(datum) {
  return datum.toISOString().slice(0, 10);
}

// Ostersonntag im gregorianischen Kalender (Algorithmus nach Meeus/Jones/Butcher).
export function ostersonntag(jahr) {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return utcTag(jahr, Math.floor(n / 31), (n % 31) + 1);
}

const feiertagCache = new Map();
function feiertageImJahr(jahr) {
  if (!feiertagCache.has(jahr)) {
    const ostern = ostersonntag(jahr).getTime();
    const tage = new Set(FESTE_FEIERTAGE.map(md => `${jahr}-${md}`));
    for (const abstand of OSTER_ABSTAENDE) tage.add(iso(new Date(ostern + abstand * TAG_MS)));
    feiertagCache.set(jahr, tage);
  }
  return feiertagCache.get(jahr);
}

export function istWerktag(datum) {
  const wochentag = datum.getUTCDay();
  if (wochentag === 0 || wochentag === 6) return false;
  return !feiertageImJahr(datum.getUTCFullYear()).has(iso(datum));
}

// Der n-te Werktag nach `datum` (der Tag selbst zaehlt nicht).
export function plusWerktage(datum, anzahl) {
  let tag = datum;
  for (let rest = anzahl; rest > 0;) {
    tag = new Date(tag.getTime() + TAG_MS);
    if (istWerktag(tag)) rest -= 1;
  }
  return tag;
}

export function heuteInDeutschland(jetzt = new Date()) {
  const teile = Object.fromEntries(BERLIN.formatToParts(jetzt).map(t => [t.type, t.value]));
  return utcTag(Number(teile.year), Number(teile.month), Number(teile.day));
}

// { von: "2026-10-12", bis: "2026-10-14" } - oder null, wenn die Laufzeit
// des Paketdienstes unbekannt ist (Ersatzpreis, solange Packlink fehlt).
export function lieferfenster(laufzeitTage, jetzt = new Date()) {
  if (!Number.isInteger(laufzeitTage) || laufzeitTage < 1 || laufzeitTage > 10) return null;
  const heute = heuteInDeutschland(jetzt);
  return {
    von: iso(plusWerktage(heute, laufzeitTage + 1)),
    bis: iso(plusWerktage(heute, laufzeitTage + VERSAND_WERKTAGE)),
  };
}
