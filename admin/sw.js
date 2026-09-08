"use strict";

const CACHE_PREFIX = "disorder119-admin-pwa-";
const CACHE_NAME = CACHE_PREFIX + "v2"; // ADMIN_GITHUB_RESPONSE_V3 cache invalidation
const PRECACHE = [
  "/admin/",
  "/admin/offline.html",
  "/admin/manifest.webmanifest",
  "/assets/favicon.png",
  "/assets/app-icon.svg",
  "/assets/app-icon-maskable.svg",
  "/assets/admin-pwa.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, fallbackPath) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type !== "opaque") {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackPath) {
      const fallback = await cache.match(fallbackPath, { ignoreSearch: true });
      if (fallback) return fallback;
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The admin worker is intentionally narrow: it never intercepts the public
  // shop and never sees the cross-origin GitHub API calls used by the editor.
  if (!url.pathname.startsWith("/admin/") && !url.pathname.startsWith("/assets/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/admin/offline.html"));
    return;
  }

  event.respondWith(networkFirst(request, null));
});
