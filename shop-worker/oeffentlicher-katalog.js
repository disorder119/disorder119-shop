// Oeffentlicher Katalog (data/catalog.json) fuer Admin-Ansichten, Besucher-
// Auswertung und Newsletter-Mails.
//
// Seit der Shop aus Cloudflare ausgeliefert wird, landet ein Abruf von
// https://disorder119.com/... aus diesem Worker (gleiche Zone) beim alten
// Ursprung und endet nach ~39 s mit 522. Admin-Ansichten warteten so bis zum
// Abbruch der App (20 s) oder zeigten nach 1,5 s Artikel ohne Namen und Bild.
// Deshalb zuerst die gebaute Datei auf main (GitHub, oeffentlich), mit kurzer
// Frist; disorder119.com bleibt nur Rueckfall (wie versand.js seit #322).
//
// Ein Abruf je Isolate und ein paar Minuten: parallele Anfragen teilen sich
// denselben laufenden Abruf, danach kommt die Liste aus dem Speicher.

export const KATALOG_ROH = "https://raw.githubusercontent.com/disorder119/disorder119-shop/main/data/catalog.json";
const SHOP_KATALOG = "https://disorder119.com/data/catalog.json";
export const KATALOG_FRIST_MS = 4000;
export const KATALOG_CACHE_MS = 5 * 60 * 1000;
// Fallen beide Quellen aus, nicht bei jeder Anfrage erneut 2 x 4 s warten.
const FEHLER_CACHE_MS = 30 * 1000;

let speicher = null;
let laufend = null;

// Nur fuer Tests.
export function oeffentlichenKatalogLeeren() {
  speicher = null;
  laufend = null;
}

export function katalogQuellen(basis = "") {
  const shop = basis ? `${String(basis).replace(/\/+$/, "")}/data/catalog.json` : SHOP_KATALOG;
  return shop === KATALOG_ROH ? [KATALOG_ROH] : [KATALOG_ROH, shop];
}

async function laden(holen, basis, frist) {
  for (const url of katalogQuellen(basis)) {
    try {
      const res = await holen(url, {
        headers: { Accept: "application/json", "User-Agent": "disorder119-shop-worker" },
        signal: AbortSignal.timeout(frist),
        cf: { cacheTtl: 120, cacheEverything: true },
      });
      if (!res || !res.ok) continue;
      const daten = await res.json();
      const liste = Array.isArray(daten) ? daten : Array.isArray(daten?.items) ? daten.items : null;
      if (liste) return { liste, ok: true };
    } catch {
      // naechste Quelle
    }
  }
  return { liste: [], ok: false };
}

// Die rohe Liste wie in data/catalog.json. Nie ein Fehler: ohne Katalog
// kommt eine leere Liste (die Ansichten zeigen dann nur die Nummern).
// fetcher: nur Tests und der Newsletter (neuesteArtikel) reichen einen eigenen.
export async function oeffentlicherKatalog({ env = null, fetcher = null, frist = KATALOG_FRIST_MS } = {}) {
  const holen = fetcher || globalThis.fetch;
  const basis = String(env?.SHOP_PUBLIC_URL || "");
  const passt = eintrag => eintrag && eintrag.holen === holen && eintrag.basis === basis;
  if (passt(speicher) && speicher.bis > Date.now()) return speicher.liste;
  if (passt(laufend)) return laufend.promise;
  const promise = laden(holen, basis, frist).then(({ liste, ok }) => {
    speicher = { liste, holen, basis, bis: Date.now() + (ok ? KATALOG_CACHE_MS : FEHLER_CACHE_MS) };
    return liste;
  });
  laufend = { promise, holen, basis };
  try {
    return await promise;
  } finally {
    if (laufend?.promise === promise) laufend = null;
  }
}

// Map: numerische Katalog-ID -> Eintrag (wie bisher die einzelnen loadCatalog).
export async function katalogNachId(optionen = {}) {
  const map = new Map();
  for (const item of await oeffentlicherKatalog(optionen)) {
    if (item && item.id !== undefined && item.id !== null) map.set(Number(item.id), item);
  }
  return map;
}
