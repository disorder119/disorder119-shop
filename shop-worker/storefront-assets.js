import edge, { storefrontHeaders } from './storefront-edge.js';

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
    const response = await edge.fetch(request, env, ctx, assetRequest => env.ASSETS.fetch(assetRequest));
    const headers = new Headers(response.headers);
    headers.set('X-Disorder119-Hosting', 'cloudflare-assets');
    if (/^[a-f0-9]{40}$/.test(env.RELEASE_SHA || '')) headers.set('X-Disorder119-Release', env.RELEASE_SHA);
    return new Response(response.body, {
      status: response.status, statusText: response.statusText, headers,
    });
  },
};
