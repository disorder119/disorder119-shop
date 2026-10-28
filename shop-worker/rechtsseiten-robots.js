// Rechtsseiten (Impressum, AGB, Datenschutz, Widerruf) nennen Name und
// Wohnanschrift des Inhabers. Das ist Pflicht (§ 5 DDG, Widerrufsbelehrung,
// Art. 13 DSGVO): Die Seiten bleiben von jeder Seite verlinkt, frei erreichbar
// und als normaler Text lesbar. Sie sollen aber nicht in Suchergebnissen,
// Snippets, Archivkopien oder der Bildersuche auftauchen.
//
// Dieser Header ergaenzt das <meta name="robots" content="noindex,follow"> der
// Seiten und gilt auch fuer die beiden Skripte, in denen die Rechtstexte
// stecken. Crawlen bleibt erlaubt: robots.txt sperrt Google und Bing hier
// bewusst nicht, sonst saehen sie das noindex nie und die Adresse koennte
// ohne Inhalt im Index bleiben. Ein noindex auf app.js stoert das Rendern der
// Startseite nicht; es verbietet nur, die Datei selbst als Treffer zu zeigen.
export const RECHTSSEITEN_ROBOTS = 'noindex, noarchive, nosnippet, noimageindex';

const RECHTSSEITE = /^\/(?:(?:en|fr)\/)?(?:impressum|agb|datenschutz|widerruf)(?:\/(?:index\.html)?)?$/;
const DATEIEN_MIT_ANSCHRIFT = new Set(['/assets/app.js', '/assets/legal-content.js']);

export function rechtsseitenRobots(pathname) {
  const pfad = String(pathname || '');
  return RECHTSSEITE.test(pfad) || DATEIEN_MIT_ANSCHRIFT.has(pfad) ? RECHTSSEITEN_ROBOTS : '';
}
