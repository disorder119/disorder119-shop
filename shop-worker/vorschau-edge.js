// Vorschau-Worker (disorder119-vorschau.*.workers.dev): liefert einen
// eigenen Build des Shops (.vorschau-build, erzeugt von
// scripts/vorschau_export.py) mit Passwort aus, damit der Inhaber neue
// UI-Ideen am Handy ansehen kann. Kein Zugriff auf Kasse/Server: die Seiten
// sprechen weiter api.disorder119.com an, dessen CORS andere Origins ablehnt.
// Nie fuer Suchmaschinen. Gespeichert wird nichts.
import { angemeldet } from "./sandbox-edge.js";

const BANNER = '<div style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#7a4bff;color:#fff;'
  + 'font:600 12px/1.4 system-ui,sans-serif;text-align:center;padding:6px 10px;letter-spacing:.04em;pointer-events:none">'
  + 'VORSCHAU UI-IDEEN · <span style="opacity:.85">Übersicht: /vorschau-ui/</span></div>';

function textAntwort(text, status, extra = {}) {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", ...extra },
  });
}

export default {
  async fetch(request, env = {}) {
    if (!env.VORSCHAU_PASSWORT) return textAntwort("Vorschau ist noch nicht eingerichtet.", 503);
    if (!angemeldet(request, env.VORSCHAU_PASSWORT)) {
      return textAntwort("Vorschau: Benutzer test, Passwort wie mitgeteilt.", 401, { "WWW-Authenticate": 'Basic realm="Disorder119 Vorschau", charset="UTF-8"' });
    }
    const antwort = await env.ASSETS.fetch(request);
    const typ = antwort.headers.get("Content-Type") || "";
    const headers = new Headers(antwort.headers);
    headers.set("X-Robots-Tag", "noindex, nofollow");
    headers.set("Cache-Control", /html/.test(typ) ? "no-store" : "public, max-age=300");
    headers.delete("Content-Security-Policy");
    if (!/text\/html/.test(typ)) return new Response(antwort.body, { status: antwort.status, headers });
    let html = await antwort.text();
    html = html.replace(/<head([^>]*)>/i, '<head$1><meta name="robots" content="noindex, nofollow">');
    html = html.replace(/<\/body>/i, BANNER + "</body>");
    return new Response(html, { status: antwort.status, headers });
  },
};
