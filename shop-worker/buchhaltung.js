// Buchhaltung: Jahresuebersicht, Bestellliste als CSV und die Rechnung zu
// einer einzelnen Bestellung.
//
// Aufgebaut wie der Datenexport, den der Shop von Vinted kennt: eine Liste
// aller Bestellungen, eine Rechnung je Bestellung, eine Zusammenfassung je
// Jahr. Damit laesst sich dasselbe an den Steuerberater geben.
//
// Die Rechnung wird nicht neu getextet, sondern ist dieselbe Darstellung, die
// die Kundin per Mail bekommen hat (formatOrderConfirmation). So kann die
// Rechnung in den Buechern gar nicht von der beim Kunden abweichen.
import { safeText } from "./commerce-core.js";
import { euroAmount, formatOrderConfirmation, loadOrderForConfirmation, mailSenderIdentity } from "./customer-mail.js";

const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

// § 19 UStG in der seit 2025 geltenden Fassung: Kleinunternehmer bleibt, wer im
// Vorjahr hoechstens 25.000 EUR und im laufenden Jahr hoechstens 100.000 EUR
// Umsatz hat. Wird die Grenze im laufenden Jahr ueberschritten, gilt ab genau
// diesem Umsatz die Regelbesteuerung. Diese Zahlen sind hier nur zur
// Fruehwarnung hinterlegt - die Bewertung gehoert zum Steuerberater.
export const KLEINUNTERNEHMER_VORJAHR_CENTS = 2_500_000;
export const KLEINUNTERNEHMER_LAUFEND_CENTS = 10_000_000;
// Ab 80 Prozent der laufenden Grenze wird gewarnt, damit die Umstellung nicht
// erst auffaellt, wenn sie schon rueckwirkend noetig war.
export const WARNSCHWELLE = 0.8;

// Umsaetze zaehlen ab bezahlt. Storniert und erstattet bleiben draussen,
// zurueckgesendet ebenfalls - sonst stuende Geld in den Buechern, das nie
// verdient wurde.
const UMSATZ_STATUS = ["PAID", "PREPARING", "SHIPPED", "DELIVERED", "RETURN_REQUESTED"];

export class BuchhaltungError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function securityHeaders() {
  return {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && ADMIN_ORIGINS.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function antwort(inhalt, typ, status = 200, origin = null, extra = {}) {
  return new Response(inhalt, {
    status,
    headers: {
      "Content-Type": typ,
      ...securityHeaders(),
      ...corsHeaders(origin),
      ...extra,
    },
  });
}

function json(daten, status = 200, origin = null) {
  return antwort(JSON.stringify(daten), "application/json; charset=utf-8", status, origin);
}

async function digest(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function tokenEquals(left, right) {
  if (!left || !right) return false;
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) throw new BuchhaltungError("ADMIN_NOT_CONFIGURED", 503);
  const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!(await tokenEquals(supplied, env.ADMIN_TOKEN))) throw new BuchhaltungError("UNAUTHORIZED", 401);
}

export function jahrAusText(wert) {
  const jahr = Number.parseInt(String(wert || "").trim(), 10);
  // Vor 2020 gab es den Shop nicht, mehr als ein Jahr im Voraus ergibt keinen
  // Sinn - eine krumme Zahl waere hier ein Tippfehler, kein Auswertungswunsch.
  if (!Number.isInteger(jahr) || jahr < 2020 || jahr > new Date().getUTCFullYear() + 1) {
    throw new BuchhaltungError("JAHR_UNGUELTIG", 400);
  }
  return jahr;
}

export function csvFeld(wert) {
  const text = String(wert ?? "");
  // Ein Feld, das mit =, +, - oder @ beginnt, wuerde Excel als Formel
  // ausfuehren. Ein vorangestelltes Hochkomma macht daraus sicher Text.
  const entschaerft = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${entschaerft.replace(/"/g, '""')}"`;
}

export function bestellungenAlsCsv(zeilen = []) {
  const kopf = [
    "Datum", "Rechnungsnummer", "Artikel", "Artikelnummer",
    "Warenwert", "Versand", "Gesamt", "Waehrung",
    "Zahlungsart", "Status", "Land",
  ];
  const zeile = row => [
    String(row.created_at || "").slice(0, 10),
    row.order_number,
    row.title_snapshot || "",
    row.article_no || "",
    // Deutsche Dezimaltrennung: so landen die Betraege in einer deutschen
    // Tabellenkalkulation als Zahl und nicht als Text.
    (Number(row.subtotal_cents || 0) / 100).toFixed(2).replace(".", ","),
    (Number(row.shipping_cents || 0) / 100).toFixed(2).replace(".", ","),
    (Number(row.total_cents || 0) / 100).toFixed(2).replace(".", ","),
    row.currency || "EUR",
    row.zahlungsart || "PayPal",
    row.status || "",
    row.country_code || "",
  ].map(csvFeld).join(";");
  return [kopf.map(csvFeld).join(";"), ...zeilen.map(zeile)].join("\r\n") + "\r\n";
}

async function umsatzZeilen(env, jahr) {
  const von = `${jahr}-01-01T00:00:00.000Z`;
  const bis = `${jahr + 1}-01-01T00:00:00.000Z`;
  const platzhalter = UMSATZ_STATUS.map(() => "?").join(",");
  const ergebnis = await env.DB.prepare(`SELECT o.id,o.order_number,o.status,o.currency,
      o.subtotal_cents,o.shipping_cents,o.total_cents,o.created_at,
      oi.article_no,oi.title_snapshot,
      k.country_code
    FROM commerce_orders o
    LEFT JOIN order_items oi ON oi.order_id=o.id
    LEFT JOIN order_contact_snapshots k ON k.order_id=o.id
    WHERE o.created_at>=? AND o.created_at<? AND o.status IN (${platzhalter})
    ORDER BY o.created_at`).bind(von, bis, ...UMSATZ_STATUS).all();
  return ergebnis?.results || [];
}

export function jahresZusammenfassung(zeilen = [], jahr, vorjahrCents = 0) {
  const monate = Array.from({ length: 12 }, (_, i) => ({
    monat: i + 1, bestellungen: 0, warenwertCents: 0, versandCents: 0, gesamtCents: 0,
  }));
  let warenwert = 0;
  let versand = 0;
  let gesamt = 0;
  const gesehen = new Set();

  for (const zeile of zeilen) {
    // Eine Bestellung kann mehrere Positionen haben; der Umsatz zaehlt einmal.
    if (gesehen.has(String(zeile.id))) continue;
    gesehen.add(String(zeile.id));
    const index = Math.min(11, Math.max(0, Number(String(zeile.created_at || "").slice(5, 7)) - 1));
    const w = Number(zeile.subtotal_cents || 0);
    const v = Number(zeile.shipping_cents || 0);
    const g = Number(zeile.total_cents || 0);
    monate[index].bestellungen += 1;
    monate[index].warenwertCents += w;
    monate[index].versandCents += v;
    monate[index].gesamtCents += g;
    warenwert += w;
    versand += v;
    gesamt += g;
  }

  const vorjahrUeber = Number(vorjahrCents || 0) > KLEINUNTERNEHMER_VORJAHR_CENTS;
  const laufendUeber = gesamt > KLEINUNTERNEHMER_LAUFEND_CENTS;
  const nahAnGrenze = !laufendUeber && gesamt >= KLEINUNTERNEHMER_LAUFEND_CENTS * WARNSCHWELLE;

  return {
    jahr,
    bestellungen: gesehen.size,
    warenwertCents: warenwert,
    versandCents: versand,
    gesamtCents: gesamt,
    monate,
    kleinunternehmer: {
      vorjahrCents: Number(vorjahrCents || 0),
      grenzeVorjahrCents: KLEINUNTERNEHMER_VORJAHR_CENTS,
      grenzeLaufendCents: KLEINUNTERNEHMER_LAUFEND_CENTS,
      vorjahrUeberschritten: vorjahrUeber,
      laufendUeberschritten: laufendUeber,
      nahAnGrenze,
      hinweis: laufendUeber
        ? "Die Grenze von 100.000 EUR im laufenden Jahr ist ueberschritten. Ab diesem Umsatz gilt die Regelbesteuerung - bitte umgehend mit dem Steuerberater klaeren."
        : vorjahrUeber
          ? "Der Vorjahresumsatz liegt ueber 25.000 EUR. Die Kleinunternehmerregelung entfaellt damit fuer dieses Jahr - bitte mit dem Steuerberater klaeren."
          : nahAnGrenze
            ? "Der Umsatz naehert sich der Grenze von 100.000 EUR. Gute Gelegenheit, die Umstellung mit dem Steuerberater vorzubereiten."
            : "Innerhalb der Kleinunternehmergrenzen nach § 19 UStG. Diese Auswertung ersetzt keine Steuerberatung.",
    },
  };
}

async function jahresUmsatzCents(env, jahr) {
  const zeilen = await umsatzZeilen(env, jahr);
  const gesehen = new Set();
  let summe = 0;
  for (const zeile of zeilen) {
    if (gesehen.has(String(zeile.id))) continue;
    gesehen.add(String(zeile.id));
    summe += Number(zeile.total_cents || 0);
  }
  return summe;
}

// Die Rechnung ist wortgleich zur Bestellbestaetigung, nur als Seite zum
// Ausdrucken oder Ablegen als PDF.
export async function rechnungHtml(env, orderId) {
  const bestellung = await loadOrderForConfirmation(env, orderId);
  if (!bestellung) throw new BuchhaltungError("BESTELLUNG_NICHT_GEFUNDEN", 404);
  const absender = mailSenderIdentity(env).email || safeText(env.MAIL_REPLY_TO || "", 200);
  const mail = formatOrderConfirmation(bestellung, { contactEmail: absender });
  return mail.html.replace(
    "</head>",
    "<style>@media print{body{background:#fff}}</style></head>",
  );
}

export function istBuchhaltungsRoute(url) {
  return url.pathname === "/admin/buchhaltung" || url.pathname.startsWith("/admin/buchhaltung/");
}

export async function handleBuchhaltung(request, env, url, reqId = crypto.randomUUID(), origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !ADMIN_ORIGINS.includes(origin)) {
        return new Response(null, { status: 403, headers: securityHeaders() });
      }
      return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(origin) } });
    }
    if (origin && !ADMIN_ORIGINS.includes(origin)) throw new BuchhaltungError("ORIGIN_NOT_ALLOWED", 403);
    if (request.method !== "GET") throw new BuchhaltungError("METHOD_NOT_ALLOWED", 405);
    await requireAdmin(request, env);
    if (!env.DB) throw new BuchhaltungError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);

    const pfad = url.pathname.replace(/\/+$/, "");

    const jahrTreffer = /^\/admin\/buchhaltung\/jahr\/(\d{4})$/.exec(pfad);
    if (jahrTreffer) {
      const jahr = jahrAusText(jahrTreffer[1]);
      const [zeilen, vorjahr] = await Promise.all([
        umsatzZeilen(env, jahr),
        jahresUmsatzCents(env, jahr - 1),
      ]);
      return json({ ok: true, ...jahresZusammenfassung(zeilen, jahr, vorjahr) }, 200, origin);
    }

    if (pfad === "/admin/buchhaltung/bestellungen.csv") {
      const jahr = jahrAusText(url.searchParams.get("jahr") || new Date().getUTCFullYear());
      const zeilen = await umsatzZeilen(env, jahr);
      // BOM voran, sonst zeigt Excel Umlaute falsch an.
      const csv = "﻿" + bestellungenAlsCsv(zeilen);
      return antwort(csv, "text/csv; charset=utf-8", 200, origin, {
        "Content-Disposition": `attachment; filename="disorder119-bestellungen-${jahr}.csv"`,
      });
    }

    const rechnungTreffer = /^\/admin\/buchhaltung\/rechnung\/([^/]+)$/.exec(pfad);
    if (rechnungTreffer) {
      const html = await rechnungHtml(env, decodeURIComponent(rechnungTreffer[1]));
      return antwort(html, "text/html; charset=utf-8", 200, origin);
    }

    if (pfad === "/admin/buchhaltung") {
      const jahr = new Date().getUTCFullYear();
      return json({
        ok: true,
        jahr,
        wege: {
          jahresuebersicht: `/admin/buchhaltung/jahr/${jahr}`,
          bestellungenCsv: `/admin/buchhaltung/bestellungen.csv?jahr=${jahr}`,
          rechnung: "/admin/buchhaltung/rechnung/<bestell-id>",
        },
      }, 200, origin);
    }

    throw new BuchhaltungError("NOT_FOUND", 404);
  } catch (err) {
    if (err instanceof BuchhaltungError) return json({ error: err.code, requestId: reqId }, err.status, origin);
    console.error(JSON.stringify({
      level: "error",
      event: "admin_buchhaltung_error",
      requestId: reqId,
      message: safeText(err?.message || "unknown", 180),
    }));
    return json({ error: "INTERNAL_BUCHHALTUNG_ERROR", requestId: reqId }, 500, origin);
  }
}

export { euroAmount };
