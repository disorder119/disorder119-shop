// Waechter-Regeln: erkennt Scanner, Angriffsproben und Angriffswerkzeuge an
// Pfad, Query und Browserkennung. Reine Funktionen ohne Speicher - der
// Storefront-Worker (storefront-edge.js) und die Shop-API (worker-entry.js)
// nutzen dieselben Regeln, gespeichert und gesperrt wird in waechter.js.
//
// art:
//   "angriff" - eindeutige Angriffsprobe (SQL-Injection, XSS, Path-Traversal,
//               Log4Shell) oder ein Angriffswerkzeug: sofort 24 h sperren.
//   "probe"   - typischer Scanner-Pfad (WordPress, .env, .git, PHP ...): die
//               Anfrage bekommt 404, gesperrt wird ab drei solchen Pfaden in
//               zehn Minuten - so sperrt sich niemand mit einem einzelnen
//               Tippfehler oder einem eigenen Sicherheitstest aus.

const SCANNER_PFADE = [
  /^\/wp-(?:admin|login|content|includes|json)\b/i,
  /^\/(?:wordpress|wp|blog|old|new|test)\/wp-/i,
  /\/xmlrpc\.php/i,
  /(?:^|\/)\.(?:env|git|svn|hg|aws|ssh|docker|htaccess|htpasswd|DS_Store)(?:[/.]|$)/i,
  /(?:^|\/)(?:phpmyadmin|pma|myadmin|mysqladmin|adminer)(?:[/.]|$)/i,
  /\/admin\.php/i,
  /(?:^|\/)cgi-bin(?:\/|$)/i,
  /\.(?:php\d?|phtml|asp|aspx|jsp|cgi)(?:$|[/?])/i,
  /(?:^|\/)vendor\//i,
  /(?:^|\/)server-(?:status|info)(?:\/|$)/i,
  /(?:^|\/)actuator(?:\/|$)/i,
  /(?:^|\/)(?:id_rsa|id_ed25519|config\.ya?ml|docker-compose\.ya?ml|web\.config|sftp-config\.json)$/i,
  /(?:^|\/)(?:boaform|HNAP1|owa\/auth|autodiscover\/autodiscover\.xml|solr\/admin|jenkins\/login|manager\/html|console\/login)(?:\/|$)/i,
  /(?:^|\/)etc\/(?:passwd|shadow)(?:$|\/)/i,
];

const ANGRIFFE = [
  ["log4shell", /\$\{\s*(?:jndi|\$\{|lower:|upper:|env:|sys:|::-)/i],
  ["path-traversal", /(?:\.\.[/\\])|(?:[/\\]\.\.(?:$|[/\\?]))/],
  ["sql-injection", /\bunion\b[\s+/*()]*(?:all[\s+/*()]+)?select\b|\bselect\b[\s\S]{0,40}\bfrom\b[\s\S]{0,40}\binformation_schema\b|\b(?:sleep|benchmark|pg_sleep)\s*\(\s*\d|\bwaitfor\s+delay\b|['"]\s*(?:or|and)\s*['"]?\d+['"]?\s*=\s*['"]?\d|\bor\s+1\s*=\s*1\b|;\s*(?:drop|truncate|alter)\s+table\b|\bxp_cmdshell\b|\bload_file\s*\(|\binto\s+outfile\b/i],
  ["xss", /<\s*\/?\s*(?:script|iframe|svg|img|body|object|embed)\b|javascript\s*:|\bon(?:error|load|mouseover|focus|click)\s*=|document\.cookie|\balert\s*\(|\bprompt\s*\(/i],
];

const WERKZEUGE = /\b(sqlmap|nikto|nuclei|masscan|zgrab|gobuster|dirbuster|wpscan|acunetix|nessus|openvas|netsparker|w3af|havij|feroxbuster|ffuf|joomscan|whatweb|nmap scripting engine|commix|xsstrike|jaeles)\b/i;

// Echte Suchmaschinen und Plattformen sperrt der Waechter nie - auch wenn sie
// einem Spam-Link auf /wp-login.php folgen. Ohne Cloudflare-Bot-Management
// laesst sich das nur an der Kennung erkennen; die Anfrage selbst bekommt
// trotzdem 404/403, nur gibt es keine 24-h-Sperre.
const BEKANNTE_BOTS = /\b(Googlebot|Google-InspectionTool|GoogleOther|AdsBot-Google|Mediapartners-Google|Storebot-Google|APIs-Google|bingbot|BingPreview|msnbot|DuckDuckBot|Applebot|facebookexternalhit|facebookcatalog|meta-externalagent|meta-externalfetcher|Pinterestbot|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Slackbot|Discordbot|YandexBot|Baiduspider|PetalBot|PayPal)\b/i;

export function verifizierterBot(request) {
  const cf = request?.cf;
  return Boolean(cf && (cf.botManagement?.verifiedBot === true || cf.verifiedBotCategory));
}

// Die Browserkennung allein laesst sich faelschen ("Googlebot" aus einem
// gemieteten Server). Ohne Cloudflare-Bot-Management zaehlt eine Bot-Kennung
// deshalb nur, wenn die Anfrage auch aus dem Netz (cf.asn) des Betreibers
// kommt. Kennungen ohne eigenes Netz (Pinterest, Slack, Discord, WhatsApp-
// Vorschau vom Handy ...) und Bing (Microsoft-Netz = auch jede Azure-VM)
// gelten als normale Besucher - die werden ohnehin nur bei Angriffen,
// Scans und Fluten gesperrt. Auch fuer erkannte Bots gilt die Flut-Grenze
// (nur 429, keine Sperre); ganz ausgenommen sind nur von Cloudflare
// verifizierte Bots.
const BOT_NETZE = [
  [/Googlebot|Google-InspectionTool|GoogleOther|AdsBot-Google|Mediapartners-Google|Storebot-Google|APIs-Google/i, [15169]],
  [/Applebot/i, [714, 6185]],
  [/facebookexternalhit|facebookcatalog|meta-externalagent|meta-externalfetcher/i, [32934, 63293]],
  [/Twitterbot/i, [13414, 35995, 63179]],
  [/LinkedInBot/i, [14413]],
  [/TelegramBot/i, [62041, 62014, 59930, 44907, 211157]],
  [/YandexBot/i, [13238, 208722]],
  [/Baiduspider/i, [55967, 38365]],
  [/PetalBot/i, [136907, 55990, 131444]],
  [/PayPal/i, [17012]],
];

export function botNetzPasst(request, userAgent) {
  const ua = String(userAgent || "");
  const asn = Number(request?.cf?.asn);
  if (!Number.isFinite(asn) || asn <= 0) return false;
  return BOT_NETZE.some(([muster, netze]) => muster.test(ua) && netze.includes(asn));
}

export function bekannterBot(request, userAgent) {
  const ua = String(userAgent || "");
  if (verifizierterBot(request)) return true;
  if (!BEKANNTE_BOTS.test(ua)) return false;
  // Ohne cf-Objekt (Tests, interne Aufrufe): wie bisher nach Kennung.
  if (!request?.cf || typeof request.cf !== "object") return true;
  return botNetzPasst(request, ua);
}

// ---------------------------------------------------------------- Netze

// Rechenzentren und Hoster: von dort kommen Scanner, aber kaum Kunden. Der
// Waechter behandelt sie strenger (Scanner-Pfad sperrt schon beim ersten
// Treffer, 404-Flut ab 10 statt 20). iCloud Privat-Relay (Akamai AS36183,
// Cloudflare AS13335, Fastly AS54113), Akamai-CDN (AS20940, AS16625) und
// Mobilfunk gehoeren ausdruecklich NICHT dazu.
const NIE_HOSTING = new Set([36183, 13335, 54113, 20940, 16625]);
const HOSTING_NETZE = new Set([
  16509, 14618, 8987, // Amazon / AWS
  396982, 19527, // Google Cloud
  8075, // Microsoft / Azure
  16276, // OVH
  24940, 213230, // Hetzner
  14061, // DigitalOcean
  51167, // Contabo
  12876, // Scaleway
  9009, // M247
  20473, // Vultr / Choopa
  63949, // Linode / Akamai Connected Cloud
  60781, 28753, // Leaseweb
  45102, 37963, // Alibaba
  132203, 45090, // Tencent
  212238, // Datacamp / CDN77
  31898, // Oracle
  46606, // Unified Layer
  62240, // Clouvider
  210644, // Aeza
  44477, // Stark Industries
  9370, // Sakura
]);
const HOSTING_NAMEN = /\b(?:OVH|Hetzner|DigitalOcean|Amazon(?:\.com| Technologies| Data Services)|AWS|Google Cloud|Microsoft|Azure|Contabo|Scaleway|M247|Vultr|Choopa|Constant Company|Linode|Akamai Connected Cloud|Leaseweb|Alibaba|Aliyun|Tencent|Datacamp|CDN77|Oracle|IONOS Cloud|Hostinger|Hostwinds|Kamatera|Psychz|QuadraNet|ColoCrossing|FranTech|BuyVM|Stark Industries|PQ Hosting|Aeza|Hivelocity|DataPacket|Zenlayer|Clouvider|Selectel|Timeweb|netcup|Hostkey|HostRoyale|Censys|Shodan|Driftnet|ONYPHE|Palo Alto Networks)\b/i;

// Netz des Anschlusses (nur fuer Schwellen und Anzeige, nie die IP).
export function netzVon(request) {
  const cf = request?.cf || {};
  const asn = Number(cf.asn);
  return {
    asn: Number.isInteger(asn) && asn > 0 ? asn : null,
    name: String(cf.asOrganization || "").replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "").trim().slice(0, 60),
  };
}

export function istHosting(asn, name) {
  const nummer = Number(asn);
  if (NIE_HOSTING.has(nummer)) return false;
  if (HOSTING_NETZE.has(nummer)) return true;
  return HOSTING_NAMEN.test(String(name || ""));
}

// Angriffsmuster in einer Anfrage, die eine FREMDE Website ausgeloest hat
// (Bild, Skript oder Link auf disorder119.com/?q=<svg ...>): der Browser des
// Besuchers schickt sie mit seiner eigenen IP. Solche Anfragen werden nur
// abgewiesen, nie gezaehlt oder gesperrt (waechter.js, storefront-edge.js) -
// sonst koennte jede fremde Seite unsere Kunden aussperren. Wer den Kopf
// faelscht, wird weiter abgewiesen, nur nicht gesperrt.
export function fremdAusgeloest(request) {
  return String(request?.headers?.get?.("Sec-Fetch-Site") || "").toLowerCase() === "cross-site";
}

function dekodiert(text) {
  let wert = String(text || "");
  for (let i = 0; i < 3; i++) {
    let weiter;
    try { weiter = decodeURIComponent(wert.replace(/\+/g, " ")); } catch { break; }
    if (weiter === wert) break;
    wert = weiter;
  }
  return wert;
}

// Signatur eines Angriffs fuer die Kampagnen-Erkennung: Grund + Pfad ohne
// Sprachvorsatz, Zahlen zu 0, Parameter-NAMEN statt Werten (dieselbe Luecke
// mit wechselnden Nutzlasten bleibt eine Kampagne).
export function angriffsSignatur(url, grund) {
  let pfad = dekodiert(url.pathname).toLowerCase();
  pfad = pfad.replace(/^\/(?:en|fr)(?=\/|$)/, "").replace(/\d+/g, "0").replace(/\/{2,}/g, "/").slice(0, 80) || "/";
  const namen = [...new Set([...url.searchParams.keys()]
    .map(k => k.toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 20)).filter(Boolean))].sort().slice(0, 5);
  return `${grund}|${pfad}${namen.length ? `?${namen.join("&")}` : ""}`;
}

export function kurzPfad(url, max = 90) {
  const text = `${url.pathname}${url.search}`.replace(/[\u0000-\u001f\u007f]/g, " ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// null oder { art, grund, detail }.
export function waechterPruefen(url, userAgent = "") {
  const ua = String(userAgent || "");
  const werkzeug = WERKZEUGE.exec(ua);
  if (werkzeug) return { art: "angriff", grund: "angriffs-programm", detail: werkzeug[1].toLowerCase() };
  // Log4Shell kommt oft ueber die Browserkennung selbst.
  if (ANGRIFFE[0][1].test(dekodiert(ua))) return { art: "angriff", grund: "log4shell", detail: "Browserkennung" };
  const roh = `${url.pathname}${url.search}`;
  const text = dekodiert(roh);
  for (const [grund, muster] of ANGRIFFE) {
    if (muster.test(text) || muster.test(roh)) return { art: "angriff", grund, detail: kurzPfad(url) };
  }
  const pfad = dekodiert(url.pathname);
  if (SCANNER_PFADE.some(muster => muster.test(pfad))) return { art: "probe", grund: "scanner-pfad", detail: kurzPfad(url) };
  return null;
}

export const GRUND_TEXT = Object.freeze({
  "angriffs-programm": "Angriffs-Programm",
  "log4shell": "Log4Shell-Versuch",
  "path-traversal": "Path-Traversal (../)",
  "sql-injection": "SQL-Injection",
  "xss": "Skript-Einschleusung (XSS)",
  "scanner-pfad": "Scanner-Pfade (WordPress, .env, .git, PHP …)",
  "zu-viele-404": "sehr viele nicht vorhandene Seiten",
  "zu-viele-anfragen": "zu viele Anfragen pro Minute",
  "codes-durchprobiert": "Codes durchprobiert (Gutscheine)",
  "kasse-fehlschlaege": "viele fehlgeschlagene Zahlungsabschlüsse",
  "formular-falle": "Bot im Formular (verstecktes Feld ausgefüllt)",
});

// Eindeutige Angriffe: keine Selbst-Entsperrung per Turnstile, und nur bei
// ihnen (und bei Scanner-Sperren) zeigt die Website den "Erwischt"-Bildschirm.
export const HARTE_GRUENDE = Object.freeze(["angriffs-programm", "log4shell", "path-traversal", "sql-injection", "xss"]);
