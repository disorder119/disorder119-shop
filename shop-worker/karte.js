// Luftbilder fuer die Abholort-Karte der Kasse (assets/kasse.js).
//
//   GET /karte/luftbild/<Land>/<z>/<y>/<x>   -> eine Kachel (256 x 256, JPEG)
//
// Quelle sind die amtlichen Digitalen Orthophotos (DOP, meist 20 cm) der 16
// Vermessungsverwaltungen der Laender: offene Daten, kostenlos, ohne Konto,
// auch gewerblich nutzbar. Lizenz und Quellenvermerk je Land stehen unten
// (geprueft am 08.10.2026 in den GetCapabilities der Dienste bzw. den
// Nutzungsbedingungen). Das Land kommt aus der PLZ der Abholort-Suche
// (/versand/abholorte, adresse.js -> OpenPLZ).
//
// Der Shop-Server holt jede Kachel per WMS ab: Die Aemter sehen nur den
// Kartenausschnitt, nie die IP der Kundschaft. Cloudflare haelt eine Kachel
// eine Woche vor, der Browser ebenfalls. Keine Ratenbegrenzung je IP (eine
// Kartenansicht laedt 6 bis 12 Kacheln), stattdessen nur fuer Shop-Seiten.

const PFAD = /^\/karte\/luftbild\/([A-Z]{2})\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/;
// Unter Zoom 13 waere eine Kachel mehrere Kilometer breit - dafuer sind die
// Dienste nicht gedacht. Die Kasse zoomt im Luftbild nicht weiter heraus.
export const LUFTBILD_MIN_ZOOM = 13;
export const LUFTBILD_MAX_ZOOM = 19;
const SHOP_SEITEN = /^https:\/\/((www|test)\.)?disorder119\.com$|^http:\/\/localhost:8765$/;
const CACHE_SEKUNDEN = 7 * 24 * 60 * 60;

// quelle(jahr): Quellenvermerk, wie ihn das Land verlangt (jahr = Jahr des Abrufs).
export const LAENDER = Object.freeze({
  BW: { url: "https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C", ebene: "IMAGES_DOP_20_RGB",
    quelle: j => `LGL-BW (${j}) Datenlizenz Deutschland - Namensnennung - Version 2.0, www.lgl-bw.de` },
  BY: { url: "https://geoservices.bayern.de/od/wms/dop/v1/dop20", ebene: "by_dop20c",
    quelle: () => "© Bayerische Vermessungsverwaltung, CC BY 4.0" },
  BE: { url: "https://gdi.berlin.de/services/wms/truedop_2024", ebene: "truedop_2024",
    quelle: () => "Geoportal Berlin, dl-de/zero-2-0" },
  BB: { url: "https://isk.geobasis-bb.de/mapproxy/dop20c/service/wms", ebene: "bebb_dop20c",
    quelle: () => "© GeoBasis-DE/LGB, dl-de/by-2-0; © Geoportal Berlin, dl-de/by-2-0" },
  HB: { url: "https://geodienste.bremen.de/wms_dop20_2023", ebene: "DOP20_2023_HB,DOP20_2023_BHV",
    quelle: () => "Landesamt GeoInformation Bremen, CC BY" },
  HH: { url: "https://geodienste.hamburg.de/wms_dop_zeitreihe_belaubt", ebene: "dop_zeitreihe_belaubt",
    quelle: () => "Freie und Hansestadt Hamburg, LGV, dl-de/by-2-0" },
  HE: { url: "https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows", ebene: "he_dop20_rgb",
    quelle: () => "© HVBG" },
  MV: { url: "https://www.geodaten-mv.de/dienste/adv_dop", ebene: "mv_dop",
    quelle: j => `© GeoBasis-DE/M-V ${j}` },
  NI: { url: "https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms", ebene: "ni_dop20",
    quelle: j => `LGLN (${j}) CC BY 4.0` },
  NW: { url: "https://www.wms.nrw.de/geobasis/wms_nw_dop", ebene: "nw_dop_rgb",
    quelle: () => "Geobasis NRW, dl-de/zero-2-0" },
  RP: { url: "https://geo4.service24.rlp.de/wms/rp_dop20.fcgi", ebene: "rp_dop20",
    quelle: j => `©GeoBasis-DE / LVermGeoRP (${j}), dl-de/by-2-0, www.lvermgeo.rlp.de` },
  SL: { url: "https://geoportal.saarland.de/freewms/dop", ebene: "sl_dop",
    quelle: () => "© GeoBasis DE/LVGL-SL" },
  SN: { url: "https://geodienste.sachsen.de/wms_geosn_dop-rgb/guest", ebene: "sn_dop_020",
    quelle: () => "Quelle: GeoSN, dl-de/by-2-0" },
  ST: { url: "https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_DOP_WMS_OpenData/guest", ebene: "lsa_lvermgeo_dop20_2",
    quelle: j => `© GeoBasis-DE / LVermGeo ST ${j}, dl-de/by-2-0` },
  SH: { url: "https://dienste.gdi-sh.de/WMS_SH_DOP20col_OpenGBD", ebene: "sh_dop20_rgb",
    quelle: () => "© GeoBasis-DE/LVermGeo SH/CC BY 4.0" },
  TH: { url: "https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP", ebene: "th_dop",
    quelle: () => "© GDI-Th, CC BY 4.0" },
});

// Amtlicher Landesschluessel (OpenPLZ federalState.key) -> Kuerzel.
const SCHLUESSEL = Object.freeze({
  "01": "SH", "02": "HH", "03": "NI", "04": "HB", "05": "NW", "06": "HE", "07": "RP", "08": "BW",
  "09": "BY", "10": "SL", "11": "BE", "12": "BB", "13": "MV", "14": "SN", "15": "ST", "16": "TH",
});

export function landAusSchluessel(schluessel) {
  return SCHLUESSEL[String(schluessel || "").padStart(2, "0")] || null;
}

// Was die Kasse ueber die Luftbilder wissen muss - oder false.
export function luftbildFuer(land, jahr = new Date().getUTCFullYear()) {
  const dienst = LAENDER[land];
  return dienst ? { land, quelle: dienst.quelle(jahr) } : false;
}

export function isKarteRoute(url) {
  return url.pathname.startsWith("/karte/");
}

// Land, Zoom, Zeile, Spalte - oder null, wenn es die Kachel nicht geben kann.
export function kachelAus(pfad) {
  const m = PFAD.exec(pfad);
  if (!m || !LAENDER[m[1]]) return null;
  const [z, y, x] = m.slice(2).map(Number);
  const anzahl = 2 ** z;
  if (z < LUFTBILD_MIN_ZOOM || z > LUFTBILD_MAX_ZOOM || y >= anzahl || x >= anzahl) return null;
  return { land: m[1], z, y, x };
}

// WMS-GetMap fuer genau diese Kachel (Web-Mercator, EPSG:3857).
const R = 20037508.342789244;
export function wmsAdresse({ land, z, y, x }) {
  const dienst = LAENDER[land];
  const groesse = (2 * R) / 2 ** z;
  const links = -R + x * groesse;
  const oben = R - y * groesse;
  const bbox = [links, oben - groesse, links + groesse, oben].map(v => v.toFixed(2)).join(",");
  const q = new URLSearchParams({
    SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetMap", LAYERS: dienst.ebene, STYLES: "",
    SRS: "EPSG:3857", BBOX: bbox, WIDTH: "256", HEIGHT: "256", FORMAT: "image/jpeg",
  });
  return `${dienst.url}?${q}`;
}

// Nur Bilder fuer die eigenen Seiten. Ein Browser schickt bei <img> die
// Herkunft im Referer ("strict-origin-when-cross-origin"); fehlt er ganz
// (Datenschutz-Einstellung), wird trotzdem geliefert.
function vonShopSeite(request) {
  const referer = request.headers.get("Referer");
  if (!referer) return true;
  try {
    return SHOP_SEITEN.test(new URL(referer).origin);
  } catch {
    return false;
  }
}

function fehler(status, code) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function handleKarte(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return fehler(405, "METHOD_NOT_ALLOWED");
  const kachel = kachelAus(url.pathname);
  if (!kachel) return fehler(404, "KACHEL_UNBEKANNT");
  if (!vonShopSeite(request)) return fehler(403, "NUR_FUER_DEN_SHOP");
  let antwort;
  try {
    antwort = await fetch(wmsAdresse(kachel), {
      headers: { Accept: "image/jpeg,image/*", "User-Agent": "disorder119-shop-worker (Abholort-Karte)" },
      cf: { cacheTtl: CACHE_SEKUNDEN, cacheEverything: true },
    });
  } catch {
    return fehler(502, "LUFTBILD_NICHT_ERREICHBAR");
  }
  const typ = String(antwort.headers.get("Content-Type") || "");
  // WMS-Dienste melden Fehler oft mit Status 200 und XML statt Bild.
  if (!antwort.ok || !/^image\//i.test(typ)) return fehler(502, "LUFTBILD_FEHLER");
  return new Response(request.method === "HEAD" ? null : antwort.body, {
    status: 200,
    headers: {
      "Content-Type": typ,
      "Cache-Control": `public, max-age=${CACHE_SEKUNDEN}`,
      "Cross-Origin-Resource-Policy": "same-site",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
