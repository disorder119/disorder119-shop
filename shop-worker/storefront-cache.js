// Cache- und Seitenspeicher-Regeln des Storefront-Workers (storefront-assets.js).
// Eigenes Modul: Das Hauptmodul eines Workers darf ausser dem Handler nichts
// exportieren (workerd lehnt Konstanten als Einstiegspunkte ab).

// Ladezeit (Browser-Cache) fuer Dateien unter /assets/. Bisher musste der
// Browser bei jedem Seitenwechsel jede Datei neu bestaetigen lassen
// (max-age=0) - am Handy eine Rundreise vor jedem Stil, Skript und Bild.
// - Skripte/Stile mit ?v=<Inhalts-Hash> (build_site.py: sha256 der Datei,
//   erste 10 Zeichen): ein Jahr unveraenderlich, aber nur, wenn der
//   ausgelieferte Inhalt nachweislich zu diesem Hash passt. Ein manueller
//   (?v=20261008-1) oder nicht passender Wert behaelt die bisherige Regel;
//   so kann auch waehrend eines Deploys nie eine alte Datei unter einer neuen
//   Adresse fest im Browser landen.
// - Bilder: 10 Minuten ohne Nachfrage. Ein ausgetauschtes Foto (gleicher
//   Pfad) ist damit spaetestens nach 10 Minuten ueberall neu.
// Katalog und unversionierte Skripte bleiben unveraendert; Seiten siehe unten.
export const CACHE_UNVERAENDERLICH = 'public, max-age=31536000, immutable';
export const CACHE_BILD = 'public, max-age=600';
export const BILD_ENDUNG = /\.(?:webp|avif|png|jpe?g|gif|svg|ico)$/i;

export function assetVersion(url) {
  if (!url.pathname.startsWith('/assets/') || !/\.(?:css|js)$/i.test(url.pathname)) return '';
  const keys = [...url.searchParams.keys()];
  const v = url.searchParams.get('v') || '';
  return keys.length === 1 && keys[0] === 'v' && /^[a-f0-9]{10,64}$/.test(v) ? v : '';
}

// Zurueck/Vor ohne Neuladen und Vorab-Laden beim Ueberfahren (Runde 3):
// - Seiten bekommen "private, no-cache" statt "no-store". no-store hielt jede
//   Seite aus dem Seitenspeicher des Browsers (bfcache, gemessen): Zurueck zum
//   Archiv lud alles neu und landete wieder oben. no-cache fragt weiter bei
//   jedem normalen Aufruf beim Server nach (der Worker liefert dann immer die
//   volle Seite mit frischer CSP, siehe storefront-edge.js), erlaubt aber den
//   Seitenspeicher. Kasse, Konto, Warenkorb, Widerruf und Newsletter bleiben
//   no-store (assets/zurueck.js laedt sie zusaetzlich neu).
// - Speculation-Rules-Kopf: Produktseiten und Archiv derselben Sprache holt
//   der Browser beim Ueberfahren (~200 ms) bzw. Antippen vorab - nur das HTML,
//   kein Prerender. Vorab-Abrufe zaehlt storefront-edge.js nicht; angezeigt
//   meldet assets/zurueck.js sie an /_seitenaufruf.
const KEIN_SEITENSPEICHER = /^\/(?:(?:en|fr)\/)?(?:kasse|konto|cart|widerruf|newsletter)(?:\/|$)|^\/_/;
export const CACHE_SEITE = 'private, no-cache';
export const SPEKULATION = /^\/assets\/spekulation-(?:de|en|fr)\.json$/;

export function seitenspeicherErlaubt(pathname) {
  return !KEIN_SEITENSPEICHER.test(pathname);
}

export function spekulationsKopf(pathname) {
  const sprache = /^\/(en|fr)(?:\/|$)/.exec(pathname)?.[1] || 'de';
  return `"/assets/spekulation-${sprache}.json"`;
}

export async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}
