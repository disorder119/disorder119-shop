// PC Manager -> Shop: neue Artikel als Entwurf (Freigabe "katalog_entwurf",
// Migration 0056, Manager "An Shop senden").
//
// Der Manager ist die Quelle fuer Artikel-ID (= Shop-ID) und Artikelnummer -
// hier wird keine Nummer vergeben oder veraendert. Dieser Weg legt nur NEUE
// Artikel an, immer als Entwurf (public_status DRAFT, nicht oeffentlich).
// Bestehende Artikel, Nummern und Fotos bleiben unberuehrt. Weiterbearbeiten
// und Freischalten: Admin-App -> Katalog (admin-katalog.js).
//
//   GET  /manager/katalog/pruefen?id=&article=      -> {frei, grund?}
//   POST /manager/katalog/bilder  {id, bilder:[{base64}]}   (hoechstens 3)
//                                                     -> {bilder:[{sha, zeichen}]}
//   POST /manager/katalog/entwurf {id, article, title, brand, ..., bilder:[{sha, zeichen}]}
//                                                     -> {ok, pullRequest, url} | {ok, vorhanden}
//
// Fotos gehen vorab einzeln als Git-Blobs zu GitHub (kleine Anfragen, kein
// Base64 im Worker), der Entwurf ist danach EIN Commit ueber einen Pull
// Request - wie beim Speichern im Katalog-Editor. Das Zeichen (HMAC mit einem
// Server-Geheimnis) bindet jeden Blob an Freigabe und Artikel-ID: Ein Entwurf
// kann nur hier gepruefte WebP-Blobs verwenden, nie beliebige Repo-Dateien.
// Testshop (SANDBOX=1): alles wird geprueft, aber nichts zu GitHub geschrieben.
import { safeText } from "./commerce-core.js";
import { EDITABLE, KatalogError, webpPruefen } from "./admin-katalog.js";
import { GithubError, SHOP_REPO, branchHead, createCommit, mergeViaPullRequest, readRepoFile } from "./github-datei.js";
import { istSandbox } from "./sandbox.js";

const ITEMS_PATH = "data/items.json";
const LINKS_PATH = "config/catalog-number-links.json";
const USER_AGENT = "disorder119-manager-katalog";
const RAW = `https://raw.githubusercontent.com/${SHOP_REPO.owner}/${SHOP_REPO.repo}/${SHOP_REPO.branch}/`;
// Wie der bisherige Fotoimport: hoechstens 1600 px, hoechstens 0,45 MiB.
export const MAX_SEITE = 1600;
export const MAX_BILD_BYTES = Math.floor(0.45 * 1024 * 1024);
export const MAX_BILDER_JE_ANFRAGE = 3;
export const MAX_GALERIE = 40;
const MAX_JSON = { bilder: 3 * 1024 * 1024, entwurf: 256 * 1024 };
const ID = /^[1-9]\d{0,8}$/;
const NUMMER = /^[1-9]\d{0,6}(?:-\d{1,3})?$/;
const SHA = /^[0-9a-f]{40}$/;

// ------------------------------------------------------------- reine Logik

/** Alle Adressen /artikel/<x>/, die es schon gibt oder die weiterleiten. */
function belegteAdressen(items, links) {
  const belegt = new Map();
  for (const it of items) {
    for (const key of [it.url_slug, it.article, it.id]) {
      const k = String(key ?? "").trim();
      if (k && !belegt.has(k)) belegt.set(k, it.id);
    }
  }
  for (const l of links.links || []) {
    for (const key of [l.shop_id, l.article]) {
      const k = String(key ?? "").trim();
      if (k && !belegt.has(k)) belegt.set(k, l.shop_id);
    }
  }
  for (const id of links.excluded_shop_ids || []) belegt.set(String(id), id);
  return belegt;
}

/**
 * Darf id/article neu angelegt werden? {frei: true} | {frei: false, grund, vorhanden?}
 * "vorhanden": genau dieser Entwurf liegt schon im Katalog (erneutes Senden).
 */
export function pruefeNeu(items, links, idWert, nummerWert) {
  const id = String(idWert ?? "").trim();
  const nummer = String(nummerWert ?? "").trim();
  if (!ID.test(id)) throw new KatalogError("ID_UNGUELTIG", 400, id.slice(0, 20));
  if (!NUMMER.test(nummer)) throw new KatalogError("NUMMER_UNGUELTIG", 400, nummer.slice(0, 20));
  const gleich = items.find(it => String(it.id) === id);
  if (gleich) {
    if (String(gleich.article ?? "") === nummer && String(gleich.public_status).toUpperCase() === "DRAFT") {
      return { frei: false, vorhanden: true, grund: "SCHON_ALS_ENTWURF_IM_SHOP" };
    }
    return { frei: false, grund: "ARTIKEL_SCHON_IM_SHOP", status: String(gleich.public_status || "") };
  }
  const belegt = belegteAdressen(items, links);
  if (belegt.has(nummer)) return { frei: false, grund: "NUMMER_SCHON_VERGEBEN", bei: belegt.get(nummer) };
  // /artikel/<id>/ darf auch keine bestehende Nummer-Adresse verdecken.
  if (belegt.has(id)) return { frei: false, grund: "ID_KOLLIDIERT_MIT_ADRESSE", bei: belegt.get(id) };
  return { frei: true };
}

/** Neuer Katalogeintrag aus den Manager-Feldern - immer Entwurf. */
export function baueEntwurf(items, eingabe, bildAnzahl) {
  const id = Number(eingabe.id);
  const nummer = String(eingabe.article).trim();
  const feld = (name, wert) => EDITABLE[name](wert);
  const title = feld("title", eingabe.title).replace(/\s+/g, " ").trim();
  if (!title) throw new KatalogError("TITEL_FEHLT", 400, String(id));
  // Marke in der Schreibweise, die der Katalog schon kennt ("y-3" -> "Y-3").
  let brand = feld("brand", eingabe.brand).replace(/\s+/g, " ").trim();
  const bekannt = items.find(it => String(it.brand || "").trim().toLowerCase() === brand.toLowerCase());
  if (brand && bekannt) brand = String(bekannt.brand).trim();
  const descDe = feld("desc_de", eingabe.desc_de);
  if (!Number.isInteger(bildAnzahl) || bildAnzahl < 1 || bildAnzahl > MAX_GALERIE) throw new KatalogError("GALERIE_UNGUELTIG", 400);
  const gallery = Array.from({ length: bildAnzahl }, (_, k) => `assets/img/${id}/${k}.webp`);
  return {
    id,
    article: nummer,
    title,
    brand,
    price: feld("price", eingabe.price ?? 0),
    status: "Entwurf",
    // Ohne Kategorie: die gepruefte Kategorie bestimmt der Build aus dem Titel;
    // eine abweichende Manager-Kategorie (z. B. "Jacke / Blazer" bei einem
    // Mantel) wuerde den Rebuild auf main anhalten. Gewaehlt wird im Admin.
    category: "",
    size: feld("size", eingabe.size),
    color: feld("color", eingabe.color),
    condition: feld("condition", eingabe.condition),
    desc: descDe,
    desc_de: descDe,
    desc_en: feld("desc_en", eingabe.desc_en),
    desc_fr: feld("desc_fr", eingabe.desc_fr),
    gallery,
    look: gallery[0],
    price_estimated: false,
    public_status: "DRAFT",
    url_slug: nummer,
  };
}

/** WebP-Abmessungen aus dem Dateikopf (VP8, VP8L, VP8X) - ohne alles zu dekodieren. */
export function webpGroesse(kopf) {
  const b = typeof kopf === "string" ? Uint8Array.from(kopf, c => c.charCodeAt(0)) : kopf;
  const art = String.fromCharCode(...b.slice(12, 16));
  if (art === "VP8 " && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { breite: (b[26] | (b[27] << 8)) & 0x3fff, hoehe: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  if (art === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { breite: (bits & 0x3fff) + 1, hoehe: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (art === "VP8X" && b.length >= 30) {
    return { breite: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, hoehe: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1 };
  }
  return null;
}

/** Ein Foto pruefen: echtes WebP, hoechstens 0,45 MiB und 1600 px. */
export function pruefeBild(base64) {
  const b64 = String(base64 || "");
  // 0,45 MiB Datei = hoechstens ceil(n/3)*4 Base64-Zeichen.
  if (b64.length > Math.ceil(MAX_BILD_BYTES / 3) * 4) throw new KatalogError("BILD_ZU_GROSS", 413);
  webpPruefen(b64, "manager");
  let kopf;
  try { kopf = atob(b64.slice(0, 40)); } catch { throw new KatalogError("BILD_UNGUELTIG", 400); }
  const masse = webpGroesse(kopf);
  if (!masse || !masse.breite || !masse.hoehe) throw new KatalogError("BILD_UNGUELTIG", 400);
  if (Math.max(masse.breite, masse.hoehe) > MAX_SEITE) throw new KatalogError("BILD_ZU_GROSS", 413, `${masse.breite}x${masse.hoehe}`);
  return b64;
}

// --------------------------------------------------------------- Zeichen

async function schluessel(env) {
  const geheim = String(env.GITHUB_TOKEN || env.ADMIN_TOKEN || (istSandbox(env) ? "testshop" : ""));
  if (!geheim) throw new KatalogError("KATALOG_NICHT_EINGERICHTET", 503);
  const roh = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`d119-manager-katalog-bild\0${geheim}`));
  return crypto.subtle.importKey("raw", roh, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function zeichen(env, grantId, id, sha) {
  const key = await schluessel(env);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${grantId}:${id}:${sha}`)));
}

async function zeichenPruefen(env, grantId, id, sha, wert) {
  if (!SHA.test(String(sha || "")) || typeof wert !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(wert)) return false;
  const soll = await zeichen(env, grantId, id, sha);
  let diff = soll.length ^ wert.length;
  for (let i = 0; i < soll.length; i++) diff |= soll.charCodeAt(i) ^ wert.charCodeAt(i);
  return diff === 0;
}

// --------------------------------------------------------------- Ablaeufe

async function gitBlobShaBytes(bytes) {
  const kopf = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const alles = new Uint8Array(kopf.length + bytes.length);
  alles.set(kopf);
  alles.set(bytes, kopf.length);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-1", alles))].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function json(request, limit) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") || "")) throw new KatalogError("JSON_ERWARTET", 415);
  const text = await request.text();
  if (text.length > limit) throw new KatalogError("ANFRAGE_ZU_GROSS", 413);
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("x");
    return v;
  } catch { throw new KatalogError("INVALID_JSON", 400); }
}

/** Katalog und Nummern-Links: im Testshop der oeffentliche Stand von main. */
async function katalogLesen(env, ref) {
  if (istSandbox(env) && !env.GITHUB_TOKEN) {
    const lies = async pfad => {
      const res = await fetch(RAW + pfad, { headers: { "User-Agent": USER_AGENT }, cf: { cacheTtl: 0 } });
      if (!res.ok) throw new GithubError(`raw_${res.status}`, res.status);
      return res.text();
    };
    const [itemsText, linksText] = await Promise.all([lies(ITEMS_PATH), lies(LINKS_PATH)]);
    return { itemsText, linksText };
  }
  const [{ text: itemsText }, { text: linksText }] = await Promise.all([
    readRepoFile(env, ITEMS_PATH, { userAgent: USER_AGENT, ref }),
    readRepoFile(env, LINKS_PATH, { userAgent: USER_AGENT, ref }),
  ]);
  return { itemsText, linksText };
}

async function pruefen(env, url) {
  const id = url.searchParams.get("id"), nummer = url.searchParams.get("article");
  if (!istSandbox(env) && !env.GITHUB_TOKEN) throw new KatalogError("KATALOG_NICHT_EINGERICHTET", 503);
  const { itemsText, linksText } = await katalogLesen(env);
  return pruefeNeu(JSON.parse(itemsText), JSON.parse(linksText), id, nummer);
}

async function bilderHochladen(env, body, access) {
  const id = String(body.id ?? "");
  if (!ID.test(id)) throw new KatalogError("ID_UNGUELTIG", 400);
  const bilder = Array.isArray(body.bilder) ? body.bilder : [];
  if (!bilder.length || bilder.length > MAX_BILDER_JE_ANFRAGE) throw new KatalogError("ZU_VIELE_DATEIEN", 400);
  const geprueft = bilder.map(b => pruefeBild(b?.base64));
  if (!istSandbox(env) && !env.GITHUB_TOKEN) throw new KatalogError("KATALOG_NICHT_EINGERICHTET", 503);
  const out = [];
  for (const b64 of geprueft) {
    let sha;
    if (istSandbox(env)) {
      // Testshop: nichts hochladen, nur den Git-SHA wie GitHub berechnen.
      sha = await gitBlobShaBytes(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
    } else {
      const res = await fetch(`https://api.github.com/repos/${SHOP_REPO.owner}/${SHOP_REPO.repo}/git/blobs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": USER_AGENT,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: b64, encoding: "base64" }),
      });
      if (!res.ok) throw new GithubError(`github_post_${res.status}`, res.status);
      sha = String((await res.json())?.sha || "");
      if (!SHA.test(sha)) throw new GithubError("github_blob_invalid");
    }
    out.push({ sha, zeichen: await zeichen(env, access.id, id, sha) });
  }
  return { bilder: out, testshop: istSandbox(env) || undefined };
}

async function entwurfAnlegen(env, body, access) {
  const id = String(body.id ?? "");
  if (!ID.test(id)) throw new KatalogError("ID_UNGUELTIG", 400);
  const refs = Array.isArray(body.bilder) ? body.bilder : [];
  if (!refs.length || refs.length > MAX_GALERIE) throw new KatalogError("GALERIE_UNGUELTIG", 400);
  for (const r of refs) {
    if (!(await zeichenPruefen(env, access.id, id, r?.sha, r?.zeichen))) throw new KatalogError("BILD_NICHT_HOCHGELADEN", 400);
  }
  if (new Set(refs.map(r => r.sha)).size !== refs.length) throw new KatalogError("BILD_DOPPELT", 400);
  if (!istSandbox(env) && !env.GITHUB_TOKEN) throw new KatalogError("KATALOG_NICHT_EINGERICHTET", 503);

  for (let versuch = 0; versuch < 3; versuch++) {
    const head = istSandbox(env) ? null : await branchHead(env, { userAgent: USER_AGENT });
    const { itemsText, linksText } = await katalogLesen(env, head?.commitSha);
    const items = JSON.parse(itemsText), links = JSON.parse(linksText);
    const stand = pruefeNeu(items, links, id, body.article);
    if (stand.vorhanden) return { ok: true, vorhanden: true, id: Number(id), article: String(body.article) };
    if (!stand.frei) throw new KatalogError(stand.grund, 409, String(stand.bei ?? stand.status ?? ""));
    const item = baueEntwurf(items, body, refs.length);
    items.push(item);
    links.links = [...(links.links || []), { shop_id: item.id, article: item.article }];
    const files = [
      { path: ITEMS_PATH, text: JSON.stringify(items, null, 2) + (itemsText.endsWith("\n") ? "\n" : "") },
      { path: LINKS_PATH, text: JSON.stringify(links, null, 2) + (linksText.endsWith("\n") ? "\n" : "") },
      ...refs.map((r, k) => ({ path: item.gallery[k], sha: r.sha })),
    ];
    const titel = safeText(`Manager: neuer Entwurf #${item.article} – ${item.title}`, 140).replace(/\s+/g, " ").trim();
    if (istSandbox(env)) {
      return { ok: true, testshop: true, entwurf: item, dateien: files.map(f => f.path), titel };
    }
    const commitSha = await createCommit(env, {
      parent: head.commitSha, baseTree: head.treeSha, files, message: titel, userAgent: USER_AGENT,
    });
    const pr = await mergeViaPullRequest(env, commitSha, {
      title: titel,
      body: `Vom PC Manager gesendet (Freigabe „Artikel als Entwurf senden“, Gerät: ${safeText(access.device_name, 60)}).\n\n`
        + `Artikel-ID ${item.id} = Manager-ID, Artikelnummer #${item.article} aus dem Manager, ${refs.length} Foto(s). `
        + "Der Artikel ist ein Entwurf und erst sichtbar, wenn er in der Admin-App unter Katalog auf AVAILABLE gestellt wird.",
      userAgent: USER_AGENT,
    });
    if (pr.merged) return { ok: true, id: item.id, article: item.article, pullRequest: pr.number, url: pr.url };
  }
  throw new KatalogError("KATALOG_KONFLIKT", 409);
}

async function begrenzen(request, env, access) {
  if (!env.RATE_LIMITER?.limit) throw new KatalogError("MANAGER_RATE_LIMIT_UNAVAILABLE", 503);
  const ok = await env.RATE_LIMITER.limit({ key: `manager:katalog:${access.id}` });
  if (!ok?.success) throw new KatalogError("MANAGER_RATE_LIMITED", 429);
}

const antwort = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
});

/** Routen unter /manager/katalog/ - die Freigabe ist schon geprueft (manager-connection.js). */
export async function handleManagerKatalog(request, env, url, access) {
  const path = url.pathname.replace(/\/+$/, "");
  try {
    if (path === "/manager/katalog/pruefen" && request.method === "GET") {
      await begrenzen(request, env, access);
      return antwort(await pruefen(env, url));
    }
    if (path === "/manager/katalog/bilder" && request.method === "POST") {
      return antwort(await bilderHochladen(env, await json(request, MAX_JSON.bilder), access));
    }
    if (path === "/manager/katalog/entwurf" && request.method === "POST") {
      await begrenzen(request, env, access);
      return antwort(await entwurfAnlegen(env, await json(request, MAX_JSON.entwurf), access));
    }
    return antwort({ error: "MANAGER_ROUTE_NOT_ALLOWED" }, 405);
  } catch (err) {
    if (err instanceof KatalogError) return antwort({ error: err.code, detail: err.detail || undefined }, err.status);
    if (err instanceof GithubError) {
      console.error(JSON.stringify({ level: "error", event: "manager_katalog_github_failed", code: err.code }));
      return antwort({ error: "GITHUB_NICHT_ERREICHBAR", detail: err.code }, 502);
    }
    console.error(JSON.stringify({ level: "error", event: "manager_katalog_failed", message: safeText(err?.message || "unknown", 160) }));
    return antwort({ error: "INTERNAL_KATALOG_ERROR" }, 500);
  }
}
