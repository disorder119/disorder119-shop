// Laender der Kasse: Namen, ISO-3-Code fuer DHL, Postleitzahl-Format und
// Sondergebiete, in die DHL "Paket EU" nicht ohne Zoll liefert.
//
// Welche Laender die Kasse WIRKLICH beliefert, steht nicht hier, sondern in
// config/shop-config.json (versand.zonen) - hier stehen nur Tatsachen ueber
// die Laender (Formate), die sich nicht nach dem Wunsch des Inhabers richten.
//
// Quellen: DHL "Preise international" (Zone 1 = EU ohne Sondergebiete:
// Kanaren, Ceuta, Melilla, Aaland, franzoesische Uebersee, Livigno, Campione,
// Berg Athos; ohne Faeroeer und Groenland), Postleitzahl-Formate der
// jeweiligen Post.
import { safeText } from "./commerce-core.js";

// code: [ISO-3 fuer DHL, deutsch, englisch, franzoesisch]
const NAMEN = Object.freeze({
  DE: ["DEU", "Deutschland", "Germany", "Allemagne"],
  AT: ["AUT", "Österreich", "Austria", "Autriche"],
  BE: ["BEL", "Belgien", "Belgium", "Belgique"],
  BG: ["BGR", "Bulgarien", "Bulgaria", "Bulgarie"],
  HR: ["HRV", "Kroatien", "Croatia", "Croatie"],
  CY: ["CYP", "Zypern", "Cyprus", "Chypre"],
  CZ: ["CZE", "Tschechien", "Czechia", "Tchéquie"],
  DK: ["DNK", "Dänemark", "Denmark", "Danemark"],
  EE: ["EST", "Estland", "Estonia", "Estonie"],
  FI: ["FIN", "Finnland", "Finland", "Finlande"],
  FR: ["FRA", "Frankreich", "France", "France"],
  GR: ["GRC", "Griechenland", "Greece", "Grèce"],
  HU: ["HUN", "Ungarn", "Hungary", "Hongrie"],
  IE: ["IRL", "Irland", "Ireland", "Irlande"],
  IT: ["ITA", "Italien", "Italy", "Italie"],
  LV: ["LVA", "Lettland", "Latvia", "Lettonie"],
  LT: ["LTU", "Litauen", "Lithuania", "Lituanie"],
  LU: ["LUX", "Luxemburg", "Luxembourg", "Luxembourg"],
  MT: ["MLT", "Malta", "Malta", "Malte"],
  NL: ["NLD", "Niederlande", "Netherlands", "Pays-Bas"],
  PL: ["POL", "Polen", "Poland", "Pologne"],
  PT: ["PRT", "Portugal", "Portugal", "Portugal"],
  RO: ["ROU", "Rumänien", "Romania", "Roumanie"],
  SE: ["SWE", "Schweden", "Sweden", "Suède"],
  SK: ["SVK", "Slowakei", "Slovakia", "Slovaquie"],
  SI: ["SVN", "Slowenien", "Slovenia", "Slovénie"],
  ES: ["ESP", "Spanien", "Spain", "Espagne"],
});

export const BEKANNTE_LAENDER = Object.freeze(Object.keys(NAMEN));

export function istBekanntesLand(code) {
  return Object.hasOwn(NAMEN, String(code || ""));
}

export function iso3(code) {
  return istBekanntesLand(code) ? NAMEN[code][0] : "";
}

export function landName(code, sprache = "de") {
  const eintrag = istBekanntesLand(code) ? NAMEN[code] : null;
  if (!eintrag) return safeText(code || "", 4);
  return eintrag[sprache === "en" ? 2 : sprache === "fr" ? 3 : 1];
}

// Postleitzahl: Eingabe -> Schreibweise der jeweiligen Post, sonst null.
// Laenderkuerzel davor ("LV-1050", "L-1234", "SI-1000") sind erlaubt.
function ziffern(n) {
  return roh => {
    const z = roh.replace(/^[A-Z]{1,2}-?(?=\d)/, "").replace(/[\s-]/g, "");
    return new RegExp(`^\\d{${n}}$`).test(z) ? z : null;
  };
}
function geteilt(vorne, hinten, trenner) {
  return roh => {
    const z = roh.replace(/^[A-Z]{1,2}-?(?=\d)/, "").replace(/[\s-]/g, "");
    return new RegExp(`^\\d{${vorne + hinten}}$`).test(z) ? z.slice(0, vorne) + trenner + z.slice(vorne) : null;
  };
}
const PLZ = Object.freeze({
  DE: ziffern(5),
  AT: ziffern(4), BE: ziffern(4), BG: ziffern(4), CY: ziffern(4), DK: ziffern(4), HU: ziffern(4), LU: ziffern(4), SI: ziffern(4),
  HR: ziffern(5), EE: ziffern(5), FI: ziffern(5), FR: ziffern(5), IT: ziffern(5), ES: ziffern(5),
  RO: ziffern(6),
  CZ: geteilt(3, 2, " "), GR: geteilt(3, 2, " "), SE: geteilt(3, 2, " "), SK: geteilt(3, 2, " "),
  PL: geteilt(2, 3, "-"), PT: geteilt(4, 3, "-"),
  LV: roh => { const z = ziffern(4)(roh); return z ? `LV-${z}` : null; },
  LT: roh => { const z = ziffern(5)(roh); return z ? `LT-${z}` : null; },
  NL: roh => { const m = /^(\d{4})\s*([A-Z]{2})$/.exec(roh); return m && !/^(SA|SD|SS)$/.test(m[2]) ? `${m[1]} ${m[2]}` : null; },
  MT: roh => { const m = /^([A-Z]{3})\s*(\d{4})$/.exec(roh); return m ? `${m[1]} ${m[2]}` : null; },
  // Eircode: Routing-Schluessel (A65, D6W) und vier Zeichen.
  IE: roh => {
    const m = /^([AC-FHKNPRTV-Y]\d{2}|D6W)\s*([0-9AC-FHKNPRTV-Y]{4})$/.exec(roh);
    return m ? `${m[1]} ${m[2]}` : null;
  },
});

export function plzNormalisieren(land, eingabe) {
  const fn = PLZ[String(land || "")];
  if (!fn) return null;
  const roh = String(eingabe ?? "").normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim();
  if (!roh || roh.length > 12) return null;
  return fn(roh);
}

// Gebiete ausserhalb des EU-Zoll- oder -Steuergebiets, die eine Postleitzahl
// des Mutterlands haben. Dorthin braucht es Zollpapiere - die Kasse lehnt sie
// ab (auf Anfrage wie das restliche Europa).
const SONDERGEBIETE = Object.freeze({
  ES: /^(35|38|51|52)\d{3}$/,          // Kanaren, Ceuta, Melilla
  FR: /^9[78]\d{3}$/,                  // Uebersee-Departements und -Gebiete, Monaco
  FI: /^22\d{3}$/,                     // Aaland
  IT: /^(23041|22061|4789\d|00120)$/,  // Livigno, Campione, San Marino, Vatikan
  GR: /^630 8[67]$/,                   // Berg Athos
  DK: /^39\d{2}$/,                     // Groenland
});

export function plzSondergebiet(land, plz) {
  const muster = SONDERGEBIETE[String(land || "")];
  return Boolean(muster && muster.test(String(plz || "")));
}

// DHL frankiert nur in Latin-1 (dhl-qr.js#dhlText). Buchstaben anderer
// Schriften (griechisch, kyrillisch ...) gingen auf dem Etikett verloren -
// die Kasse bittet deshalb um lateinische Schreibweise.
export function lateinTauglich(text) {
  for (const zeichen of String(text || "")) {
    if (/\p{L}/u.test(zeichen) && !/\p{Script=Latin}/u.test(zeichen)) return false;
  }
  return true;
}
