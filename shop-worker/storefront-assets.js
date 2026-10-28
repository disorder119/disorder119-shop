import edge, { storefrontHeaders } from './storefront-edge.js';
import { rechtsseitenRobots } from './rechtsseiten-robots.js';
import { BILD_ENDUNG, CACHE_BILD, CACHE_SEITE, CACHE_UNVERAENDERLICH, SPEKULATION, assetVersion, seitenspeicherErlaubt,
  sha256Hex, spekulationsKopf } from './storefront-cache.js';

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
    } else if (response.status === 200 && SPEKULATION.test(url.pathname)) {
      headers.set('Content-Type', 'application/speculationrules+json');
      headers.set('Cache-Control', 'public, max-age=3600');
    } else if (response.status === 200 && /text\/html/i.test(headers.get('Content-Type') || '')
        && seitenspeicherErlaubt(url.pathname)) {
      headers.set('Cache-Control', CACHE_SEITE);
      headers.set('Speculation-Rules', spekulationsKopf(url.pathname));
    }
    return new Response(body, {
      status: response.status, statusText: response.statusText, headers,
    });
  },
};
