// Luftbilder fuer die Abholort-Karte der Kasse (assets/kasse.js).
//
//   GET /karte/luftbild/<z>/<y>/<x>   -> eine Kachel (256 x 256, JPEG)
//
// Quelle ist Esri World Imagery ueber die ArcGIS Location Platform
// (Secret ESRI_API_KEY, kostenloser Rahmen 2 Mio. Kacheln im Monat). Der
// Shop-Server holt die Kachel ab: Der Schluessel bleibt hier, und Esri sieht
// nur den Kartenausschnitt, nie die IP der Kundschaft. Ohne Schluessel meldet
// /versand/abholorte "luftbild: false" und die Kasse zeigt nur die
// Strassenkarte von OpenStreetMap.
//
// Keine Ratenbegrenzung je IP (eine Kartenansicht laedt 6 bis 12 Kacheln);
// stattdessen nur fuer Seiten des Shops und mit Browser-Cache.

const QUELLE = "https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile";
const PFAD = /^\/karte\/luftbild\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/;
const MIN_ZOOM = 3;
const MAX_ZOOM = 19;
const SHOP_SEITEN = /^https:\/\/((www|test)\.)?disorder119\.com$|^http:\/\/localhost:8765$/;
const CACHE_SEKUNDEN = 7 * 24 * 60 * 60;

export const LUFTBILD_QUELLE = "Esri, Maxar, Earthstar Geographics";

export function luftbildBereit(env) {
  return Boolean(env?.ESRI_API_KEY);
}

export function isKarteRoute(url) {
  return url.pathname.startsWith("/karte/");
}

// Zoom, Zeile, Spalte - oder null, wenn die Kachel nicht existieren kann.
export function kachelAus(pfad) {
  const m = PFAD.exec(pfad);
  if (!m) return null;
  const [z, y, x] = m.slice(1).map(Number);
  const anzahl = 2 ** z;
  if (z < MIN_ZOOM || z > MAX_ZOOM || y >= anzahl || x >= anzahl) return null;
  return { z, y, x };
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
  if (!luftbildBereit(env)) return fehler(503, "LUFTBILD_NICHT_EINGERICHTET");
  let antwort;
  try {
    antwort = await fetch(`${QUELLE}/${kachel.z}/${kachel.y}/${kachel.x}?token=${encodeURIComponent(String(env.ESRI_API_KEY))}`, {
      headers: { Accept: "image/jpeg,image/png,image/*" },
    });
  } catch {
    return fehler(502, "LUFTBILD_NICHT_ERREICHBAR");
  }
  const typ = String(antwort.headers.get("Content-Type") || "");
  if (!antwort.ok || !/^image\//i.test(typ)) {
    // Esri meldet einen falschen oder abgelaufenen Schluessel mit JSON
    // (Code 498/499), nicht mit dem HTTP-Status.
    return fehler(antwort.status === 404 ? 404 : 502, antwort.status === 404 ? "KACHEL_UNBEKANNT" : "LUFTBILD_FEHLER");
  }
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
