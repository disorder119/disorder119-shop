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

export function bekannterBot(request, userAgent) {
  return verifizierterBot(request) || BEKANNTE_BOTS.test(String(userAgent || ""));
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
});
