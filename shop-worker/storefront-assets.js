import edge, { storefrontHeaders } from './storefront-edge.js';
import { rechtsseitenRobots } from './rechtsseiten-robots.js';

async function fetchAsset(request, assets) {
  const url = new URL(request.url);
  // Cloudflare's automatic HTML routing strips .html even from Google's
  // verification file. Use exact asset names and map only directory pages.
  const directory = url.pathname.endsWith('/');
  const addSlash = !directory && !/\.[^/]+$/.test(url.pathname) && !url.pathname.startsWith('/.well-known/');
  if (directory) url.pathname += 'index.html';
  else if (addSlash) url.pathname += '/index.html';
  const response = await assets.fetch(new Request(url, request));
  if (addSlash && response.ok) {
    await response.body?.cancel();
    const canonical = new URL(request.url);
    canonical.pathname += '/';
    return new Response(null, { status: 301, headers: { Location: canonical.toString() } });
  }
  return response;
}

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
// HTML, Katalog und unversionierte Skripte bleiben unveraendert.
export const CACHE_UNVERAENDERLICH = 'public, max-age=31536000, immutable';
export const CACHE_BILD = 'public, max-age=600';
const BILD_ENDUNG = /\.(?:webp|avif|png|jpe?g|gif|svg|ico)$/i;

export function assetVersion(url) {
  if (!url.pathname.startsWith('/assets/') || !/\.(?:css|js)$/i.test(url.pathname)) return '';
  const keys = [...url.searchParams.keys()];
  const v = url.searchParams.get('v') || '';
  return keys.length === 1 && keys[0] === 'v' && /^[a-f0-9]{10,64}$/.test(v) ? v : '';
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}

// Keep the existing public-path, catalog, CSP, redirect and visit protections.
// There is deliberately no network/origin fallback: a missing asset binding
// must never silently resume GitHub Pages hosting.
export default {
  async fetch(request, env, ctx) {
    if (!env?.ASSETS || typeof env.ASSETS.fetch !== 'function') {
      return new Response(request.method === 'HEAD' ? null : 'Website vorübergehend nicht erreichbar.', {
        status: 503,
        headers: storefrontHeaders(new Response(null, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        })),
      });
    }
    const url = new URL(request.url);
    const version = request.method === 'GET' ? assetVersion(url) : '';
    let edgeRequest = request;
    if (version) {
      // Ohne Bedingung kommt immer der volle Inhalt, damit der Hash pruefbar
      // ist (einmal je Datei und Browser, danach fragt er ein Jahr nicht mehr).
      const conditionless = new Headers(request.headers);
      conditionless.delete('If-None-Match');
      conditionless.delete('If-Modified-Since');
      edgeRequest = new Request(request, { headers: conditionless });
    }
    const response = await edge.fetch(edgeRequest, env, ctx, assetRequest => fetchAsset(assetRequest, env.ASSETS));
    const headers = new Headers(response.headers);
    headers.set('X-Disorder119-Hosting', 'cloudflare-assets');
    if (/^[a-f0-9]{40}$/.test(env.RELEASE_SHA || '')) headers.set('X-Disorder119-Release', env.RELEASE_SHA);
    // Rechtsseiten und Skripte mit der Anschrift: erreichbar, aber nicht im Suchindex.
    const robots = rechtsseitenRobots(url.pathname);
    if (robots) headers.set('X-Robots-Tag', robots);
    let body = response.body;
    if (version && response.status === 200 && body) {
      body = await response.arrayBuffer();
      if ((await sha256Hex(body)).startsWith(version)) headers.set('Cache-Control', CACHE_UNVERAENDERLICH);
    } else if ((response.status === 200 || response.status === 304) && url.pathname.startsWith('/assets/')
        && BILD_ENDUNG.test(url.pathname)) {
      headers.set('Cache-Control', CACHE_BILD);
    }
    return new Response(body, {
      status: response.status, statusText: response.statusText, headers,
    });
  },
};
