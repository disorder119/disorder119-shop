// Lager: welche Artikelnummer liegt in welcher Kiste (Admin-App, Bereich "Lager").
//
// Die Kisten stehen im Keller und sind dort nicht beschriftet - hier wird
// festgehalten, was wo liegt, damit nach einem Verkauf nur eine Kiste
// geoeffnet werden muss. Gespeichert wird nur die Zuordnung
// Artikelnummer -> Kiste; Titel, Foto und Status kommen in der App aus dem
// Katalog (/admin/katalog). "geprueft" heisst: im Keller nachgesehen.

const ADMIN_ORIGINS = Object.freeze(["https://admin.disorder119.com"]);
const MAX_KISTEN = 60;
const BILD_PFAD = /^assets\/img\/[A-Za-z0-9_-]{1,40}\/(?:thumbs\/)?\d{1,3}\.webp$/;

export class LagerError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function tokenEquals(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(a))),
    crypto.subtle.digest("SHA-256", enc.encode(String(b))),
  ]);
  const p = new Uint8Array(x), q = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff |= p[i] ^ q[i];
  return diff === 0;
}

function kopf(origin) {
  const out = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && ADMIN_ORIGINS.includes(origin)) out["Access-Control-Allow-Origin"] = origin;
  return out;
}

export function isLagerRoute(url) {
  const path = url.pathname.replace(/\/+$/, "");
  return path === "/admin/lager" || path === "/admin/lager/kisten" || path === "/admin/lager/artikel" || path === "/admin/lager/bilder"
    || /^\/admin\/lager\/kisten\/\d{1,6}$/.test(path);
}

const sauber = (wert, max) => String(wert ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
// Artikelnummern sind Ziffern (1-5 Stellen), wie im Katalog.
const artikelNr = wert => { const s = String(wert ?? "").trim().replace(/^#/, ""); return /^\d{1,5}$/.test(s) ? String(Number(s)) : null; };

async function uebersicht(db) {
  const [kisten, plaetze] = await Promise.all([
    db.prepare("SELECT id, name, notiz, pos FROM lager_kisten ORDER BY pos, id").all(),
    db.prepare("SELECT artikel, kiste_id, geprueft, ort FROM lager_plaetze ORDER BY CAST(artikel AS INTEGER)").all(),
  ]);
  const je = new Map();
  for (const p of plaetze.results || []) {
    if (!je.has(p.kiste_id)) je.set(p.kiste_id, []);
    je.get(p.kiste_id).push({ artikel: String(p.artikel), geprueft: Boolean(p.geprueft), ort: p.ort || "" });
  }
  return {
    schema: "lager-v1",
    kisten: (kisten.results || []).map(k => ({ id: k.id, name: k.name, notiz: k.notiz || "", artikel: je.get(k.id) || [] })),
  };
}

export async function handleLager(request, env, url, reqId = crypto.randomUUID(), origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !ADMIN_ORIGINS.includes(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: kopf(origin) });
    }
    if (origin && !ADMIN_ORIGINS.includes(origin)) throw new LagerError("ORIGIN_NOT_ALLOWED", 403);
    const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!env.ADMIN_TOKEN || !(await tokenEquals(supplied, env.ADMIN_TOKEN))) throw new LagerError("UNAUTHORIZED", 401);
    if (!env.DB) throw new LagerError("DB_FEHLT", 503);

    const path = url.pathname.replace(/\/+$/, "");
    const jetzt = new Date().toISOString();
    const antwort = async () => new Response(JSON.stringify(await uebersicht(env.DB)), { status: 200, headers: kopf(origin) });
    const lesen = async () => { try { return await request.json(); } catch { throw new LagerError("INVALID_JSON", 400); } };

    if (path === "/admin/lager" && request.method === "GET") return antwort();

    // Neue Kiste
    if (path === "/admin/lager/kisten" && request.method === "POST") {
      const body = await lesen();
      const zahl = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(pos), 0) AS p FROM lager_kisten").first();
      if (Number(zahl?.n || 0) >= MAX_KISTEN) throw new LagerError("ZU_VIELE_KISTEN", 409);
      const name = sauber(body?.name, 60) || `Kiste ${Number(zahl?.n || 0) + 1}`;
      await env.DB.prepare("INSERT INTO lager_kisten (name, notiz, pos, created_at, updated_at) VALUES (?,?,?,?,?)")
        .bind(name, sauber(body?.notiz, 500), Number(zahl?.p || 0) + 1, jetzt, jetzt).run();
      return antwort();
    }

    // Kiste umbenennen / Notiz aendern / leere Kiste entfernen
    const eine = /^\/admin\/lager\/kisten\/(\d{1,6})$/.exec(path);
    if (eine) {
      const id = Number(eine[1]);
      const kiste = await env.DB.prepare("SELECT id FROM lager_kisten WHERE id=?").bind(id).first();
      if (!kiste) throw new LagerError("KISTE_UNBEKANNT", 404);
      if (request.method === "POST") {
        const body = await lesen();
        const name = sauber(body?.name, 60);
        if (body?.name !== undefined && !name) throw new LagerError("NAME_FEHLT", 400);
        await env.DB.prepare("UPDATE lager_kisten SET name=COALESCE(?,name), notiz=COALESCE(?,notiz), updated_at=? WHERE id=?")
          .bind(body?.name !== undefined ? name : null, body?.notiz !== undefined ? sauber(body.notiz, 500) : null, jetzt, id).run();
        return antwort();
      }
      if (request.method === "DELETE") {
        const drin = await env.DB.prepare("SELECT COUNT(*) AS n FROM lager_plaetze WHERE kiste_id=?").bind(id).first();
        if (Number(drin?.n || 0) > 0) throw new LagerError("KISTE_NICHT_LEER", 409);
        await env.DB.prepare("DELETE FROM lager_kisten WHERE id=?").bind(id).run();
        return antwort();
      }
    }

    // Vorschaubilder fuer das Lager-PDF: die App baut das PDF selbst und braucht dafuer die Bilddaten.
    if (path === "/admin/lager/bilder" && request.method === "POST") {
      const body = await lesen();
      const pfade = [...new Set((Array.isArray(body?.pfade) ? body.pfade : []).map(String))]
        .filter(x => BILD_PFAD.test(x)).slice(0, 12);
      if (!pfade.length) throw new LagerError("BILD_FEHLT", 400);
      const bilder = {};
      await Promise.all(pfade.map(async pfad => {
        try {
          const res = await (env.BILD_FETCH || fetch)(`https://disorder119.com/${pfad}`, { headers: { Accept: "image/webp" } });
          if (!res.ok) return;
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (!bytes.length || bytes.length > 600_000) return;
          let bin = "";
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          bilder[pfad] = `data:image/webp;base64,${btoa(bin)}`;
        } catch { /* Bild fehlt im PDF, der Rest bleibt */ }
      }));
      return new Response(JSON.stringify({ bilder }), { status: 200, headers: kopf(origin) });
    }

    // Artikel in eine Kiste legen, herausnehmen (kiste: null) oder als geprueft markieren
    if (path === "/admin/lager/artikel" && request.method === "POST") {
      const body = await lesen();
      const nummern = [...new Set((Array.isArray(body?.artikel) ? body.artikel : [body?.artikel]).map(artikelNr).filter(Boolean))];
      if (!nummern.length || nummern.length > 400) throw new LagerError("ARTIKEL_FEHLT", 400);
      const befehle = [];
      if (body?.kiste === null) {
        for (const nr of nummern) befehle.push(env.DB.prepare("DELETE FROM lager_plaetze WHERE artikel=?").bind(nr));
      } else if (body?.kiste !== undefined) {
        const id = Number(body.kiste);
        const kiste = Number.isInteger(id) ? await env.DB.prepare("SELECT id FROM lager_kisten WHERE id=?").bind(id).first() : null;
        if (!kiste) throw new LagerError("KISTE_UNBEKANNT", 404);
        const geprueft = body?.geprueft === false ? 0 : 1;   // von Hand einsortiert = nachgesehen
        for (const nr of nummern) {
          befehle.push(env.DB.prepare(`INSERT INTO lager_plaetze (artikel, kiste_id, geprueft, updated_at) VALUES (?,?,?,?)
            ON CONFLICT(artikel) DO UPDATE SET kiste_id=excluded.kiste_id, geprueft=excluded.geprueft, ort='', updated_at=excluded.updated_at`).bind(nr, id, geprueft, jetzt));
        }
      } else if (body?.ort !== undefined) {
        // Teil liegt gerade woanders ("wohnung") oder wieder in der Kiste ("") - zurueckgelegt heisst auch: nachgesehen.
        const ort = body.ort === "wohnung" ? "wohnung" : "";
        for (const nr of nummern) {
          befehle.push(ort ? env.DB.prepare("UPDATE lager_plaetze SET ort=?, updated_at=? WHERE artikel=?").bind(ort, jetzt, nr)
            : env.DB.prepare("UPDATE lager_plaetze SET ort='', geprueft=1, updated_at=? WHERE artikel=?").bind(jetzt, nr));
        }
      } else if (typeof body?.geprueft === "boolean") {
        for (const nr of nummern) befehle.push(env.DB.prepare("UPDATE lager_plaetze SET geprueft=?, updated_at=? WHERE artikel=?").bind(body.geprueft ? 1 : 0, jetzt, nr));
      } else {
        throw new LagerError("AKTION_FEHLT", 400);
      }
      await env.DB.batch(befehle);
      return antwort();
    }

    throw new LagerError("NOT_FOUND", 404);
  } catch (err) {
    if (err instanceof LagerError) return new Response(JSON.stringify({ error: err.code, requestId: reqId }), { status: err.status, headers: kopf(origin) });
    console.error(JSON.stringify({ level: "error", event: "lager_failed", requestId: reqId, message: String(err?.message || err).slice(0, 160) }));
    return new Response(JSON.stringify({ error: "INTERNAL_LAGER_ERROR", requestId: reqId }), { status: 500, headers: kopf(origin) });
  }
}
