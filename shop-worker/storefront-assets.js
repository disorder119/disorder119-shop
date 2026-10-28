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
    const response = await edge.fetch(request, env, ctx, assetRequest => fetchAsset(assetRequest, env.ASSETS));
    const headers = new Headers(response.headers);
    headers.set('X-Disorder119-Hosting', 'cloudflare-assets');
    if (/^[a-f0-9]{40}$/.test(env.RELEASE_SHA || '')) headers.set('X-Disorder119-Release', env.RELEASE_SHA);
    // Rechtsseiten und Skripte mit der Anschrift: erreichbar, aber nicht im Suchindex.
    const robots = rechtsseitenRobots(new URL(request.url).pathname);
    if (robots) headers.set('X-Robots-Tag', robots);
    return new Response(response.body, {
      status: response.status, statusText: response.statusText, headers,
    });
  },
};
