// Nur verschluesselt: "Always Use HTTPS" ist in der Cloudflare-Zone aus, und
// ein Worker auf eigener Adresse bekommt auch Aufrufe per http://. Muster wie
// storefront-edge.js, genutzt von worker-entry.js (api.* und api-test.*) und
// sandbox-edge.js (test.*), jeweils ganz am Anfang - vor Anmeldung und Routing.
//
//   * GET/HEAD per http   -> 301 auf dieselbe Adresse mit https
//   * alles andere        -> 403 {"error":"HTTPS_REQUIRED"} - eine Umleitung
//                            verloere den Body (und er war schon unterwegs)
//   * jede HTTPS-Antwort  -> Strict-Transport-Security, falls noch nicht gesetzt
//
// Lokal (wrangler dev, localhost, 127.0.0.1, Tests) bleibt http erlaubt.

export const HSTS = "max-age=31536000; includeSubDomains";

const LOKALE_NAMEN = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function lokalerName(name) {
  const host = String(name || "").trim().toLowerCase().replace(/\.$/, "");
  return LOKALE_NAMEN.has(host) || host.endsWith(".localhost");
}

function hostOhnePort(wert) {
  const text = String(wert || "").trim();
  if (!text) return "";
  try { return new URL(`http://${text}`).hostname; } catch { return ""; }
}

// wrangler dev biegt Aufrufe an localhost:8787 auf die erste Route um
// (http://api.disorder119.com/...) und merkt sich den echten Host in
// MF-Original-Hostname. Ohne diese Ausnahme leitete die lokale Entwicklung
// jeden Aufruf auf den Live-Server. Wer den Kopf selbst setzt, schwaecht nur
// seine eigene Anfrage - fremde Browser senden ihn nie.
export function lokal(request, url = new URL(request.url)) {
  // Hinter Cloudflare traegt jede Anfrage CF-Ray - dann ist sie nie lokal,
  // egal welche Host-Koepfe der Client selbst mitschickt.
  if (request.headers.get("CF-Ray")) return false;
  return lokalerName(url.hostname)
    || lokalerName(hostOhnePort(request.headers.get("Host")))
    || lokalerName(hostOhnePort(request.headers.get("MF-Original-Hostname")));
}

// CF-Visitor setzt Cloudflare selbst: {"scheme":"http"} oder {"scheme":"https"}.
function besucherSchema(request) {
  try { return String(JSON.parse(request.headers.get("CF-Visitor") || "{}")?.scheme || "").toLowerCase(); } catch { return ""; }
}

export function unverschluesselt(request, url = new URL(request.url)) {
  if (lokal(request, url)) return false;
  return url.protocol === "http:" || besucherSchema(request) === "http";
}

// Antwort fuer einen unverschluesselten Aufruf, sonst null (weiter wie bisher).
export function httpsErzwingen(request) {
  const url = new URL(request.url);
  if (!unverschluesselt(request, url)) return null;
  if (request.method === "GET" || request.method === "HEAD") {
    url.protocol = "https:";
    url.port = "";   // Cloudflare bedient https nicht auf den http-Sonderports (8080, 2052 ...)
    return new Response(null, { status: 301, headers: { Location: url.toString(), "Cache-Control": "no-store" } });
  }
  return new Response(JSON.stringify({ error: "HTTPS_REQUIRED" }), {
    status: 403,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// HSTS auf jede HTTPS-Antwort; ein schon gesetzter Wert bleibt.
export function mitHsts(response, request) {
  if (!response || response.status === 101 || response.headers.has("Strict-Transport-Security")) return response;
  if (new URL(request.url).protocol !== "https:") return response;
  const headers = new Headers(response.headers);
  headers.set("Strict-Transport-Security", HSTS);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
