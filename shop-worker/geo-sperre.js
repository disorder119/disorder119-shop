// Geo-Sperre: Laender, aus denen disorder119.com (Storefront-Worker) und die
// Shop-API gar nicht erreichbar sein sollen. Dorthin wird nicht verschickt,
// und Angriffsversuche von dort sollen gar nicht erst ankommen.
//
// Einstellung ueber Umgebungsvariablen (ISO-3166-Codes, Komma/Leerzeichen):
//   GEO_SPERRE_LAENDER     Standard "RU,BY,IN,KP,IR" (Russland, Belarus,
//                          Indien, Nordkorea, Iran). "aus" schaltet ab.
//   GEO_SPERRE_KONTINENTE  optional, Cloudflare-Kontinentcodes, z. B. "AS"
//                          fuer ganz Asien (AF, AS, EU, NA, OC, SA).
// Das Land kommt von Cloudflare (request.cf.country, aus der IP abgeleitet);
// gespeichert wird dabei nichts, gesperrte Besucher werden nicht gezaehlt.
//
// Nie gesperrt, egal was eingetragen ist:
// - DE: eigenes Land - sonst sperrt sich der Betreiber selbst aus.
// - US: PayPal-Webhooks, Googlebot, Meta-Crawler und Apples Pruefung der
//   Apple-Pay-Domain kommen von dort.
// - von Cloudflare verifizierte Bots (request.cf.botManagement.verifiedBot),
//   falls das Konto diese Angabe liefert. Eine Ausnahme nach Browserkennung
//   gibt es bewusst nicht: die laesst sich faelschen.
export const STANDARD_LAENDER = Object.freeze(["RU", "BY", "IN", "KP", "IR"]);
export const NIE_GESPERRT = Object.freeze(["DE", "US"]);
const KONTINENTE = Object.freeze(["AF", "AN", "AS", "EU", "NA", "OC", "SA"]);
const AUS = ["aus", "off", "false", "0", "nein", "keine", "-"];

function codes(wert) {
  return String(wert ?? "").toUpperCase().split(/[\s,;]+/).filter(Boolean);
}

export function geoSperrListe(env = {}) {
  const roh = String(env?.GEO_SPERRE_LAENDER ?? "").trim();
  const laender = AUS.includes(roh.toLowerCase())
    ? []
    : (roh ? codes(roh) : [...STANDARD_LAENDER]).filter(c => /^[A-Z][A-Z0-9]$/.test(c) && !NIE_GESPERRT.includes(c));
  const kontinente = AUS.includes(roh.toLowerCase())
    ? []
    : codes(env?.GEO_SPERRE_KONTINENTE).filter(c => KONTINENTE.includes(c));
  return { laender: [...new Set(laender)], kontinente: [...new Set(kontinente)] };
}

// null = durchlassen, sonst { land, kontinent } fuer die Sperrseite.
export function geoGesperrt(request, env = {}) {
  const cf = request?.cf;
  if (!cf || typeof cf !== "object") return null; // interne Dienstbindung, Tests
  if (cf.botManagement?.verifiedBot === true || cf.verifiedBotCategory) return null;
  const land = String(cf.country || "").toUpperCase();
  if (!land || NIE_GESPERRT.includes(land)) return null;
  const { laender, kontinente } = geoSperrListe(env);
  if (laender.includes(land)) return { land, kontinent: null };
  const kontinent = String(cf.continent || "").toUpperCase();
  if (kontinent && kontinente.includes(kontinent)) return { land, kontinent };
  return null;
}

// Kurze, neutrale Seite ohne Skript, ohne Bilder, ohne Zaehlung.
export const SPERRSEITE = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>403</title>'
  + '<style>html{background:#000;color:#f2efe7;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px 20px;box-sizing:border-box}'
  + 'h1{font-size:3rem;margin:0 0 12px}p{max-width:420px;color:rgba(242,239,231,.62);font-size:.9rem;line-height:1.6;margin:4px 0}</style></head>'
  + '<body><h1>403</h1><p>This website is not available in your region.</p><p lang="de">Diese Website ist in deiner Region nicht verfügbar.</p></body></html>';

export function geoSperrAntwort(request, headers = {}) {
  return new Response(request?.method === "HEAD" ? null : SPERRSEITE, {
    status: 403,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
