// Versand-Konfiguration fuer den Worker: Paketgroessen, Ersatzpreise und die
// Zuordnung Artikel -> Paketgroesse.
//
// Einzige Quelle ist config/shop-config.json ("versand"). Der Worker bundelt
// die Datei beim Deploy, build_site.py liest dieselbe Datei fuer Produktseiten
// und Google-Daten - Masse und Preise stehen also nirgends ein zweites Mal.
import shopConfig from "../config/shop-config.json" with { type: "json" };

const GROESSEN = ["S", "M", "L"];

function ganzzahl(wert, min, max) {
  return Number.isInteger(wert) && wert >= min && wert <= max;
}

// Bricht beim Laden ab, statt mit halben Angaben Preise zu rechnen.
export function versandKonfigurationPruefen(roh) {
  const v = roh && roh.versand;
  if (!v || typeof v !== "object") throw new Error("VERSAND_KONFIGURATION_FEHLT");
  const pakete = {};
  for (const key of GROESSEN) {
    const p = v.pakete && v.pakete[key];
    if (!p || !ganzzahl(p.laenge, 1, 120) || !ganzzahl(p.breite, 1, 120) || !ganzzahl(p.hoehe, 1, 120)
      || !(Number(p.gewichtKg) > 0 && Number(p.gewichtKg) <= 31.5) || !ganzzahl(p.ersatzCents, 1, 10000)) {
      throw new Error(`VERSAND_PAKET_UNGUELTIG_${key}`);
    }
    pakete[key] = Object.freeze({
      key,
      name: String(p.name || key),
      beispiel: String(p.beispiel || ""),
      laenge: p.laenge,
      breite: p.breite,
      hoehe: p.hoehe,
      gewichtKg: Number(p.gewichtKg),
      ersatzCents: p.ersatzCents,
    });
  }
  const standard = GROESSEN.includes(v.standardGroesse) ? v.standardGroesse : "M";
  const nurGroessen = map => Object.freeze(Object.fromEntries(
    Object.entries(map || {}).filter(([, g]) => GROESSEN.includes(g)),
  ));
  const land = /^[A-Z]{2}$/.test(String(v.zielLand || "")) ? v.zielLand : "DE";
  const plz = /^\d{5}$/.test(String(v.referenzPlz || "")) ? v.referenzPlz : "10115";
  // Paketdienste fuer den Checkout. Fehlt die Liste, sind alle erlaubt.
  const d = v.dienste && typeof v.dienste === "object" ? v.dienste : {};
  const erlaubt = Array.isArray(d.erlaubt)
    ? Object.freeze(d.erlaubt.map(n => String(n || "").trim().toUpperCase()).filter(Boolean))
    : null;
  const expressMaxCents = ganzzahl(d.expressMaxCents, 1, 100000) ? d.expressMaxCents : null;
  return Object.freeze({
    pakete: Object.freeze(pakete),
    standardGroesse: standard,
    nachProdukttyp: nurGroessen(v.groesseNachProdukttyp),
    nachKategorie: nurGroessen(v.groesseNachKategorie),
    zielLand: land,
    referenzPlz: plz,
    dienste: Object.freeze({ erlaubt, expressMaxCents }),
  });
}

// Darf die Kundschaft diesen Paketdienst im Checkout sehen? Der Name muss
// genau passen ("DHL" ist nicht "DHL Express").
export function dienstErlaubt(carrier, konfig = VERSAND) {
  const liste = konfig.dienste && konfig.dienste.erlaubt;
  if (!liste) return true;
  return liste.includes(String(carrier || "").trim().toUpperCase());
}

export const VERSAND = versandKonfigurationPruefen(shopConfig);
export const PAKETE = VERSAND.pakete;

export function paketFuer(key) {
  const k = String(key || "").toUpperCase();
  return PAKETE[k] || PAKETE[VERSAND.standardGroesse];
}

// Groesse eines einzelnen Stuecks: zuerst die genaue Produktart (Stiefel,
// Mantel), dann die Kategorie, sonst die Standardgroesse.
export function groesseFuerArtikel(item = {}, konfig = VERSAND) {
  return konfig.nachProdukttyp[String(item.product_type || "")]
    || konfig.nachKategorie[String(item.taxonomy_category || item.category || "")]
    || konfig.standardGroesse;
}

// Ein Paket je Bestellung: das groesste Einzelstueck bestimmt die Groesse,
// zwei Teile brauchen mindestens "M", ab drei Teilen wird es "L".
export function paketFuerArtikel(items = [], konfig = VERSAND) {
  const liste = (Array.isArray(items) ? items : [items]).filter(Boolean);
  if (!liste.length) return konfig.standardGroesse;
  let rang = Math.max(...liste.map(it => GROESSEN.indexOf(groesseFuerArtikel(it, konfig))));
  if (liste.length >= 2) rang = Math.max(rang, 1);
  if (liste.length >= 3) rang = 2;
  return GROESSEN[Math.max(0, rang)];
}
