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
  // Paketdienste fuer den Checkout. Fehlt die Erlaubt-Liste, sind alle
  // erlaubt - ausser denen auf der Sperrliste ("ausgeschlossen").
  const d = v.dienste && typeof v.dienste === "object" ? v.dienste : {};
  const namen = liste => Object.freeze(liste.map(n => String(n || "").trim().toUpperCase()).filter(Boolean));
  const erlaubt = Array.isArray(d.erlaubt) ? namen(d.erlaubt) : null;
  const ausgeschlossen = Array.isArray(d.ausgeschlossen) ? namen(d.ausgeschlossen) : Object.freeze([]);
  const expressMaxCents = ganzzahl(d.expressMaxCents, 1, 100000) ? d.expressMaxCents : null;
  // Versandkostenfrei ab einem Warenwert in Cent (Wunsch des Inhabers: ab 99
  // Euro). Fehlt der Block, gibt es keine Grenze; ist er kaputt, bricht der
  // Worker ab, statt falsch zu rechnen.
  let versandkostenfrei = null;
  if (v.versandkostenfrei !== undefined && v.versandkostenfrei !== null) {
    const f = v.versandkostenfrei;
    if (typeof f !== "object" || !ganzzahl(f.abCents, 1, 10000000)) throw new Error("VERSAND_VERSANDKOSTENFREI_UNGUELTIG");
    versandkostenfrei = Object.freeze({ abCents: f.abCents });
  }
  return Object.freeze({
    pakete: Object.freeze(pakete),
    standardGroesse: standard,
    nachProdukttyp: nurGroessen(v.groesseNachProdukttyp),
    nachKategorie: nurGroessen(v.groesseNachKategorie),
    zielLand: land,
    referenzPlz: plz,
    dienste: Object.freeze({ erlaubt, ausgeschlossen, expressMaxCents }),
    versandkostenfrei,
  });
}

// Ein Name trifft auch Varianten: "UPS" sperrt "UPS® Standard", aber nicht
// "GROUPS" (davor und dahinter darf kein Buchstabe stehen).
function namePasst(name, gesperrt) {
  const muster = gesperrt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^A-Z0-9])" + muster + "(?![A-Z0-9])").test(name);
}

// Darf die Kundschaft diesen Paketdienst im Checkout sehen? Die Sperrliste
// gilt immer. Eine Erlaubt-Liste trifft wie die Sperrliste auch Varianten:
// "DHL" erlaubt "DHL Paket" und "DHL Express", "HERMES" erlaubt
// "Hermes Germany" - Packlink haengt oft den Dienstnamen an.
export function dienstErlaubt(carrier, konfig = VERSAND) {
  const name = String(carrier || "").trim().toUpperCase();
  const d = konfig.dienste || {};
  if ((d.ausgeschlossen || []).some(gesperrt => namePasst(name, gesperrt))) return false;
  if (!d.erlaubt) return true;
  return d.erlaubt.some(erlaubt => namePasst(name, erlaubt));
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
