// Versand-Konfiguration fuer den Worker: Paketklassen (DHL nach Gewicht),
// Preise und die Schaetzung, welche Klasse eine Bestellung braucht.
//
// Einzige Quelle ist config/shop-config.json ("versand"). Der Worker bundelt
// die Datei beim Deploy, build_site.py liest dieselbe Datei fuer Produktseiten
// und Google-Daten - Masse und Preise stehen also nirgends ein zweites Mal.
import shopConfig from "../config/shop-config.json" with { type: "json" };

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
  let versandkostenfrei = null;
  if (v.versandkostenfrei !== undefined && v.versandkostenfrei !== null) {
    const f = v.versandkostenfrei;
    if (typeof f !== "object" || !ganzzahl(f.abCents, 1, 10000000)) throw new Error("VERSAND_VERSANDKOSTENFREI_UNGUELTIG");
    versandkostenfrei = Object.freeze({ abCents: f.abCents });
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
      tarife.push(Object.freeze({
        id,
        carrier: String(t.carrier || "").trim(),
        titel: String(t.titel || t.carrier || id),
        art: t.art === "express" ? "express" : "standard",
        preise: Object.freeze({ ...t.preise }),
        laufzeitTage: ganzzahl(t.laufzeitTage, 1, 30) ? t.laufzeitTage : null,
        abholstation: t.abholstation === true,
        versichertBisCents: ganzzahl(t.versichertBisCents, 0, 10000000) ? t.versichertBisCents : null,
        // Erst ab diesem Warenwert anbieten (Hoeherversicherung).
        abWarenwertCents: ganzzahl(t.abWarenwertCents, 1, 100000000) ? t.abWarenwertCents : null,
      }));
    }
    if (!tarife.length) throw new Error("VERSAND_TARIFE_FEHLEN");
  }
  return Object.freeze({
    quelle,
    tarife: Object.freeze(tarife),
    pakete: Object.freeze(pakete),
    standardGroesse: standard,
    schaetzung,
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
