// Versand-Konfiguration fuer den Worker: Paketklassen (DHL nach Gewicht),
// Preise und die Schaetzung, welche Klasse eine Bestellung braucht.
//
// Einzige Quelle ist config/shop-config.json ("versand"). Der Worker bundelt
// die Datei beim Deploy, build_site.py liest dieselbe Datei fuer Produktseiten
// und Google-Daten - Masse und Preise stehen also nirgends ein zweites Mal.
import shopConfig from "../config/shop-config.json" with { type: "json" };
import { istBekanntesLand } from "./laender.js";

// DHL-Paketklassen: S bis 2 kg, M bis 5 kg, L bis 10 kg, XL bis 20 kg, XXL bis 31,5 kg.
export const GROESSEN = Object.freeze(["S", "M", "L", "XL", "XXL"]);

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
      // Nur Klasse S (60 x 30 x 15 cm): was dicker ist, passt nicht hinein.
      maxLiter: ganzzahl(p.maxLiter, 1, 500) ? p.maxLiter : null,
      ersatzCents: p.ersatzCents,
    });
  }
  const standard = GROESSEN.includes(v.standardGroesse) ? v.standardGroesse : "S";
  // Schaetzung je Stueck: Gewicht (kg) und Volumen (Liter).
  const sch = v.schaetzung && typeof v.schaetzung === "object" ? v.schaetzung : {};
  const wert = x => (x && Number(x.kg) > 0 && Number(x.kg) <= 31.5 && Number(x.liter) > 0 && Number(x.liter) <= 500
    ? Object.freeze({ kg: Number(x.kg), liter: Number(x.liter) }) : null);
  const tabelle = map => Object.freeze(Object.fromEntries(
    Object.entries(map || {}).map(([k, x]) => [k, wert(x)]).filter(([, x]) => x),
  ));
  let schwerMuster = null;
  if (sch.schwer && sch.schwer.muster) {
    try { schwerMuster = new RegExp(String(sch.schwer.muster), "i"); } catch { throw new Error("VERSAND_SCHAETZUNG_MUSTER_UNGUELTIG"); }
  }
  const faktor = Number(sch.schwer && sch.schwer.faktor);
  const schaetzung = Object.freeze({
    verpackungKg: Number(sch.verpackungKg) >= 0 && Number(sch.verpackungKg) <= 5 ? Number(sch.verpackungKg) : 0.4,
    standard: wert(sch.standard) || Object.freeze({ kg: 1, liter: 8 }),
    schwerMuster,
    schwerFaktor: faktor >= 1 && faktor <= 5 ? faktor : 1,
    nachProdukttyp: tabelle(sch.nachProdukttyp),
    nachKategorie: tabelle(sch.nachKategorie),
  });
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
  // Liefergebiet (Inhaber 28.10.2026): Zonen mit ihren Laendern. Ohne Block
  // nur Deutschland - wie vor der EU-Kasse.
  const zonen = zonenPruefen(v.zonen);
  let versandkostenfrei = null;
  if (v.versandkostenfrei !== undefined && v.versandkostenfrei !== null) {
    const f = v.versandkostenfrei;
    if (typeof f !== "object" || !ganzzahl(f.abCents, 1, 10000000)) throw new Error("VERSAND_VERSANDKOSTENFREI_UNGUELTIG");
    // In welchen Zonen der Shop ab dem Warenwert den Versand uebernimmt.
    // Fehlt die Liste: nur Deutschland - nie aus Versehen gratis ins Ausland.
    const freiZonen = f.zonen === undefined ? ["DE"] : f.zonen;
    if (!Array.isArray(freiZonen) || freiZonen.some(z => !Object.hasOwn(zonen, z))) throw new Error("VERSAND_VERSANDKOSTENFREI_ZONE_UNGUELTIG");
    versandkostenfrei = Object.freeze({ abCents: f.abCents, zonen: Object.freeze([...freiZonen]) });
  }
  // Feste Tarife (quelle "fest"): je Paketdienst ein Preis pro Paketgroesse.
  const quelle = v.quelle === "fest" ? "fest" : "packlink";
  const tarife = [];
  if (quelle === "fest") {
    const liste = Array.isArray(v.tarife?.liste) ? v.tarife.liste : [];
    for (const t of liste) {
      const id = String(t?.id || "");
      if (!/^[a-z0-9-]{2,20}$/.test(id) || tarife.some(x => x.id === id)) throw new Error("VERSAND_TARIF_UNGUELTIG");
      if (!GROESSEN.every(g => ganzzahl(t.preise?.[g], 1, 100000))) throw new Error(`VERSAND_TARIF_PREIS_${id}`);
      const zone = t.zone === undefined ? "DE" : String(t.zone);
      if (!Object.hasOwn(zonen, zone)) throw new Error(`VERSAND_TARIF_ZONE_${id}`);
      tarife.push(Object.freeze({
        id,
        zone,
        carrier: String(t.carrier || "").trim(),
        titel: String(t.titel || t.carrier || id),
        art: t.art === "express" ? "express" : "standard",
        preise: Object.freeze({ ...t.preise }),
        laufzeitTage: ganzzahl(t.laufzeitTage, 1, 30) ? t.laufzeitTage : null,
        // Packstation und Filiale gibt es nur in Deutschland.
        abholstation: t.abholstation === true && zone === "DE",
        versichertBisCents: ganzzahl(t.versichertBisCents, 0, 10000000) ? t.versichertBisCents : null,
        // Erst ab / nur bis zu diesem Warenwert anbieten (Stufen der Hoeherversicherung).
        abWarenwertCents: ganzzahl(t.abWarenwertCents, 1, 100000000) ? t.abWarenwertCents : null,
        bisWarenwertCents: ganzzahl(t.bisWarenwertCents, 1, 100000000) ? t.bisWarenwertCents : null,
      }));
    }
    if (!tarife.length) throw new Error("VERSAND_TARIFE_FEHLEN");
    // Jede Zone braucht einen Standard ohne Warenwert-Grenze, sonst stuende
    // die Kasse in diesem Land ohne Versandart da.
    for (const zone of Object.keys(zonen)) {
      if (!tarife.some(t => t.zone === zone && t.art === "standard" && !t.abWarenwertCents && !t.bisWarenwertCents)) {
        throw new Error(`VERSAND_ZONE_OHNE_TARIF_${zone}`);
      }
    }
  }
  return Object.freeze({
    quelle,
    tarife: Object.freeze(tarife),
    zonen,
    pakete: Object.freeze(pakete),
    standardGroesse: standard,
    schaetzung,
    zielLand: land,
    referenzPlz: plz,
    dienste: Object.freeze({ erlaubt, ausgeschlossen, expressMaxCents }),
    versandkostenfrei,
  });
}

// Zonen des Liefergebiets: { DE: { key, name, laender, laufzeitTage, maxGewichtKg }, EU: ... }.
// Jedes Land hoechstens in einer Zone, Deutschland immer in "DE".
function zonenPruefen(roh) {
  const quelle = roh && typeof roh === "object" ? roh : { DE: { name: "Deutschland", laender: ["DE"] } };
  const zonen = {};
  const vergeben = new Set();
  for (const [key, z] of Object.entries(quelle)) {
    if (key.startsWith("_")) continue;
    if (!/^[A-Z]{2,3}$/.test(key) || !z || typeof z !== "object" || !Array.isArray(z.laender) || !z.laender.length) {
      throw new Error(`VERSAND_ZONE_UNGUELTIG_${key}`);
    }
    for (const land of z.laender) {
      if (!istBekanntesLand(land) || vergeben.has(land)) throw new Error(`VERSAND_ZONE_LAND_UNGUELTIG_${land}`);
      vergeben.add(land);
    }
    const laufzeit = {};
    for (const [land, spanne] of Object.entries(z.laufzeitTage || {})) {
      if (!z.laender.includes(land) || !Array.isArray(spanne) || spanne.length !== 2
        || !ganzzahl(spanne[0], 1, 10) || !ganzzahl(spanne[1], spanne[0], 10)) {
        throw new Error(`VERSAND_ZONE_LAUFZEIT_UNGUELTIG_${land}`);
      }
      laufzeit[land] = Object.freeze([spanne[0], spanne[1]]);
    }
    const maxKg = Number(z.maxGewichtKg);
    zonen[key] = Object.freeze({
      key,
      name: String(z.name || key),
      laender: Object.freeze([...z.laender]),
      laufzeitTage: Object.freeze(laufzeit),
      maxGewichtKg: maxKg > 0 && maxKg <= 31.5 ? maxKg : 31.5,
    });
  }
  if (!zonen.DE || !zonen.DE.laender.includes("DE")) throw new Error("VERSAND_ZONE_DE_FEHLT");
  return Object.freeze(zonen);
}

// Zone eines Lieferlands ("DE", "EU") oder null, wenn die Kasse nicht dorthin liefert.
export function zoneFuerLand(land, konfig = VERSAND) {
  const code = String(land || "").toUpperCase();
  return Object.values(konfig.zonen || {}).find(z => z.laender.includes(code)) || null;
}

// Alle Laender der Kasse, Deutschland zuerst.
export function lieferlaender(konfig = VERSAND) {
  const alle = Object.values(konfig.zonen || {}).flatMap(z => z.laender);
  return ["DE", ...alle.filter(l => l !== "DE").sort()];
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

// Gewicht und Volumen eines Stuecks: zuerst die genaue Produktart (Stiefel,
// Mantel), dann die Kategorie, sonst der Standard. Leder, Fell, Daunen & Co.
// im Titel machen es schwerer und dicker.
export function schaetzeArtikel(item = {}, konfig = VERSAND) {
  const s = konfig.schaetzung;
  const basis = s.nachProdukttyp[String(item.product_type || "")]
    || s.nachKategorie[String(item.taxonomy_category || item.category || "")]
    || s.standard;
  const schwer = s.schwerMuster && s.schwerMuster.test(String(item.title || "")) ? s.schwerFaktor : 1;
  return { kg: basis.kg * schwer, liter: basis.liter * schwer };
}

// Ein Paket je Bestellung: alle Stuecke plus Verpackung. Die kleinste Klasse,
// deren Gewicht reicht - Klasse S nur, wenn auch das Volumen hineinpasst.
// Mehr als 31,5 kg passt in kein DHL-Paket; dann bleibt es bei XXL und der
// Inhaber teilt auf (kommt bei hoechstens zehn Stuecken praktisch nie vor).
export function paketFuerArtikel(items = [], konfig = VERSAND) {
  const liste = (Array.isArray(items) ? items : [items]).filter(Boolean);
  if (!liste.length) return konfig.standardGroesse;
  let kg = konfig.schaetzung.verpackungKg;
  let liter = 0;
  for (const it of liste) {
    const e = schaetzeArtikel(it, konfig);
    kg += e.kg;
    liter += e.liter;
  }
  for (const key of GROESSEN) {
    const p = konfig.pakete[key];
    if (kg <= p.gewichtKg + 1e-9 && (!p.maxLiter || liter <= p.maxLiter)) return key;
  }
  return GROESSEN[GROESSEN.length - 1];
}

// Fuer ein einzelnes Stueck (Produktseite).
export function groesseFuerArtikel(item = {}, konfig = VERSAND) {
  return paketFuerArtikel([item], konfig);
}
