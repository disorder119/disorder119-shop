// Katalog bearbeiten aus der Admin-App - ohne GitHub-Token im Browser.
//
// Bisher schrieb der Katalog-Editor mit einem persoenlichen GitHub-Token direkt
// auf main. Das hatte zwei Haken: Der Token musste im Browser liegen, und der
// Main-Waechter dreht direkte Pushes zurueck - Aenderungen verschwanden wieder.
//
// Jetzt: Die Admin-App schickt nur, was sich aendert (Feld fuer Feld, dazu neue
// oder entfernte Fotos). Der Worker prueft jedes Feld, baut daraus einen Commit
// und bringt ihn ueber einen Pull Request nach main. Gemergte Pull Requests
// laesst der Waechter stehen, und der Rebuild veroeffentlicht die Seite.
import { safeText } from "./commerce-core.js";
import {
  GithubError,
  branchHead,
  createCommit,
  mergeViaPullRequest,
  readRepoFile,
  recentCommits,
} from "./github-datei.js";

const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

const ITEMS_PATH = "data/items.json";
const USER_AGENT = "disorder119-admin-katalog";
export const MAX_KATALOG_BODY_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_B64 = 3 * 1024 * 1024;
// Ordnername ohne "." und ".." - sonst zeigte "assets/img/../1.webp" aus dem
// Bilderordner heraus.
const IMAGE_PATH = /^assets\/img\/(?!\.{1,2}\/)[A-Za-z0-9._-]{1,80}\/(thumbs\/)?\d{1,3}\.webp$/;

export class KatalogError extends Error {
  constructor(code, status = 400, detail = "") {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

// ------------------------------------------------------------ Felder pruefen

const text = max => value => {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string" && typeof value !== "number") throw new KatalogError("FELD_UNGUELTIG", 400);
  return safeText(String(value), max).replace(/\r\n?/g, "\n");
};

// Genau die Felder, die der Editor anbietet. Alles andere (Taxonomie,
// Bildauswahl fuer die Kacheln, Bewertungen) rechnet der Build selbst aus.
const EDITABLE = Object.freeze({
  title: text(200),
  brand: text(120),
  size: text(40),
  color: text(60),
  condition: text(60),
  category: text(60),
  desc_de: text(8000),
  desc_en: text(8000),
  desc_fr: text(8000),
  price(value) {
    const zahl = Number(value);
    if (!Number.isFinite(zahl) || zahl < 0 || zahl > 100000) throw new KatalogError("PREIS_UNGUELTIG", 400);
    return Math.round(zahl * 100) / 100;
  },
  price_estimated(value) {
    if (typeof value !== "boolean") throw new KatalogError("FELD_UNGUELTIG", 400);
    return value;
  },
  public_status(value) {
    const status = String(value || "").toUpperCase();
    if (!["AVAILABLE", "SOLD", "DRAFT"].includes(status)) throw new KatalogError("STATUS_UNGUELTIG", 400);
    return status;
  },
  gallery(value) {
    if (!Array.isArray(value) || value.length > 40) throw new KatalogError("GALERIE_UNGUELTIG", 400);
    return value.map(pfad => {
      const p = String(pfad || "");
      if (!IMAGE_PATH.test(p) || p.includes("/thumbs/")) throw new KatalogError("GALERIE_UNGUELTIG", 400, p.slice(0, 120));
      return p;
    });
  },
});

export function applyChanges(items, changes) {
  if (!Array.isArray(changes) || changes.length > 300) throw new KatalogError("AENDERUNGEN_UNGUELTIG", 400);
  const byId = new Map(items.map((it, index) => [String(it.id), index]));
  for (const change of changes) {
    const index = byId.get(String(change?.id));
    if (index === undefined) throw new KatalogError("ARTIKEL_UNBEKANNT", 404, String(change?.id).slice(0, 20));
    const set = change?.set;
    if (!set || typeof set !== "object" || Array.isArray(set)) throw new KatalogError("AENDERUNGEN_UNGUELTIG", 400);
    const next = { ...items[index] };
    for (const [field, value] of Object.entries(set)) {
      // Nur eigene Eintraege: "toString" oder "__proto__" erbt jedes Objekt,
      // sie duerfen nie als bearbeitbares Feld durchgehen.
      if (!Object.prototype.hasOwnProperty.call(EDITABLE, field)) {
        throw new KatalogError("FELD_NICHT_BEARBEITBAR", 400, field.slice(0, 40));
      }
      next[field] = EDITABLE[field](value);
    }
    if (!String(next.title || "").trim()) throw new KatalogError("TITEL_FEHLT", 400, String(next.id));
    if (next.public_status !== "DRAFT" && !String(next.brand || "").trim()) throw new KatalogError("MARKE_FEHLT", 400, String(next.id));
    items[index] = next;
  }
  return items;
}

function checkImage(image) {
  const path = String(image?.path || "");
  const b64 = String(image?.base64 || "");
  if (!IMAGE_PATH.test(path)) throw new KatalogError("BILDPFAD_UNGUELTIG", 400, path.slice(0, 120));
  if (!b64 || b64.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new KatalogError("BILD_UNGUELTIG", 400, path);
  // Nur echte WebP-Dateien: "RIFF" .... "WEBP" in den ersten zwoelf Byte.
  let kopf;
  try { kopf = atob(b64.slice(0, 16)); } catch { throw new KatalogError("BILD_UNGUELTIG", 400, path); }
  if (kopf.slice(0, 4) !== "RIFF" || kopf.slice(8, 12) !== "WEBP") throw new KatalogError("BILD_KEIN_WEBP", 400, path);
  return { path, base64: b64 };
}

function checkRemoval(path) {
  const p = String(path || "");
  if (!IMAGE_PATH.test(p)) throw new KatalogError("BILDPFAD_UNGUELTIG", 400, p.slice(0, 120));
  return { path: p, remove: true };
}

// ------------------------------------------------------------------ Ablaeufe

export async function loadCatalog(env) {
  const [{ text: itemsText, sha }, commits] = await Promise.all([
    readRepoFile(env, ITEMS_PATH, { userAgent: USER_AGENT }),
    recentCommits(env, ITEMS_PATH, { userAgent: USER_AGENT }).catch(() => []),
  ]);
  // Die Artikelliste geht als Text durch: 1 MB einmal parsen und wieder
  // serialisieren kostete nur Rechenzeit.
  return `{"ok":true,"sha":${JSON.stringify(sha)},"commits":${JSON.stringify(commits)},"items":${itemsText}}`;
}

export async function saveCatalog(env, body = {}) {
  const message = safeText(String(body.message || "Admin: Katalog aktualisiert"), 140).replace(/\s+/g, " ").trim();
  const changes = Array.isArray(body.changes) ? body.changes : [];
  const images = (Array.isArray(body.images) ? body.images : []).map(checkImage);
  const removals = (Array.isArray(body.remove) ? body.remove : []).map(checkRemoval);
  if (images.length > 12 || removals.length > 24) throw new KatalogError("ZU_VIELE_DATEIEN", 400);
  if (!changes.length && !images.length && !removals.length) throw new KatalogError("NICHTS_ZU_SPEICHERN", 400);

  for (let versuch = 0; versuch < 3; versuch++) {
    const head = await branchHead(env, { userAgent: USER_AGENT });
    const files = [...images, ...removals];
    if (changes.length) {
      const { text: itemsText } = await readRepoFile(env, ITEMS_PATH, { userAgent: USER_AGENT, ref: head.commitSha });
      const items = applyChanges(JSON.parse(itemsText), changes);
      files.unshift({ path: ITEMS_PATH, text: JSON.stringify(items, null, 2) + (itemsText.endsWith("\n") ? "\n" : "") });
    }
    const commitSha = await createCommit(env, {
      parent: head.commitSha,
      baseTree: head.treeSha,
      files,
      message: message.startsWith("Admin:") ? message : `Admin: ${message}`,
      userAgent: USER_AGENT,
    });
    const pr = await mergeViaPullRequest(env, commitSha, {
      title: message.startsWith("Admin:") ? message : `Admin: ${message}`,
      body: "Gespeichert über die Admin-App (Anmeldung per Passkey). Der Rebuild veröffentlicht die Änderung in wenigen Minuten.",
      userAgent: USER_AGENT,
    });
    if (pr.merged) return { ok: true, pullRequest: pr.number, url: pr.url };
    // Konflikt: jemand anderes hat items.json inzwischen geaendert. Auf dem
    // neuen Stand noch einmal - die Aenderungen sind ja Feld fuer Feld.
  }
  throw new KatalogError("KATALOG_KONFLIKT", 409);
}

// ------------------------------------------------------------------- Routen

function headers(origin, type = "application/json; charset=utf-8") {
  const out = {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && ADMIN_ORIGINS.includes(origin)) out["Access-Control-Allow-Origin"] = origin;
  return out;
}

async function tokenEquals(left, right) {
  if (!left || !right) return false;
  const digest = async v => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(v))));
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function isKatalogRoute(url) {
  const path = url.pathname.replace(/\/+$/, "");
  return path === "/admin/katalog" || path === "/admin/katalog/speichern";
}

export async function handleKatalog(request, env, url, reqId = crypto.randomUUID(), origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !ADMIN_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers: headers(null) });
      return new Response(null, { status: 204, headers: headers(origin) });
    }
    if (origin && !ADMIN_ORIGINS.includes(origin)) throw new KatalogError("ORIGIN_NOT_ALLOWED", 403);
    const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!env.ADMIN_TOKEN || !(await tokenEquals(supplied, env.ADMIN_TOKEN))) throw new KatalogError("UNAUTHORIZED", 401);
    if (!env.GITHUB_TOKEN) throw new KatalogError("KATALOG_NICHT_EINGERICHTET", 503);

    const path = url.pathname.replace(/\/+$/, "");
    if (path === "/admin/katalog" && request.method === "GET") {
      return new Response(await loadCatalog(env), { status: 200, headers: headers(origin) });
    }
    if (path === "/admin/katalog/speichern" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { throw new KatalogError("INVALID_JSON", 400); }
      return new Response(JSON.stringify(await saveCatalog(env, body || {})), { status: 200, headers: headers(origin) });
    }
    throw new KatalogError("NOT_FOUND", 404);
  } catch (err) {
    if (err instanceof KatalogError) {
      return new Response(JSON.stringify({ error: err.code, detail: err.detail || undefined, requestId: reqId }), { status: err.status, headers: headers(origin) });
    }
    if (err instanceof GithubError) {
      console.error(JSON.stringify({ level: "error", event: "katalog_github_failed", requestId: reqId, code: err.code }));
      return new Response(JSON.stringify({ error: "GITHUB_NICHT_ERREICHBAR", detail: err.code, requestId: reqId }), { status: 502, headers: headers(origin) });
    }
    console.error(JSON.stringify({ level: "error", event: "katalog_failed", requestId: reqId, message: safeText(err?.message || "unknown", 160) }));
    return new Response(JSON.stringify({ error: "INTERNAL_KATALOG_ERROR", requestId: reqId }), { status: 500, headers: headers(origin) });
  }
}
