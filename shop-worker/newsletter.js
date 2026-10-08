import { privateIpHash } from "./privacy-security.js";
// Newsletter mit Double-Opt-in und einmaligem 10-%-Willkommenscode.
//
// Ablauf: Anmeldung auf der Website -> Bestaetigungsmail (Link gilt 48 Std.)
// -> Klick auf der Seite /newsletter/ -> bestaetigt, einmaliger 10-%-Code
// (dieselben Codes wie bei den Spielen, reward_coupons, einloesbar im
// Warenkorb) -> Willkommensmail mit Code und Abmeldelink.
//
// Erst die Bestaetigung zaehlt als Einwilligung (§ 7 Abs. 2 UWG, Art. 7
// DSGVO). Gespeichert werden Zeitpunkt, Wortlaut und Herkunft der
// Einwilligung, dazu nur ein Hash der IP-Adresse.
//
// Nach aussen antwortet die Anmeldung immer gleich - ob eine Adresse schon
// eingetragen ist, erfaehrt niemand, der sie nur ausprobiert.
//
// Gegen Mehrfach-Rabatte: ein Code pro Postfach (name+x@ und bei Gmail
// n.a.m.e@ zaehlen als dieselbe Adresse, auch nach Ab- und Neuanmeldung),
// keine Wegwerf-Adressen, hoechstens CODES_PER_NETWORK Codes pro
// Internetanschluss in 30 Tagen. Jeder Code ist einmal einloesbar
// (reward_coupons), pro Bestellung zaehlt genau ein Code; bei Verkaeufen
// ausserhalb des Shops entwertet die Admin-App ihn ueber /admin/coupons/redeem.
//
// Jede bestaetigte Adresse landet zusaetzlich in der Brevo-Liste "Newsletter
// DISORDER119" (legt der Worker beim ersten Mal selbst an, NEWSLETTER_LIST_ID
// kann eine andere Liste vorgeben). Von dort verschickst du die Newsletter;
// Brevo haengt an jede Kampagne selbst einen Abmeldelink.
import { SHOP_URL, escapeHtml, mailTransportReady, normalizeEmail, sendMail } from "./customer-mail.js";
import { issueRewardCoupon, normalizeCouponCode } from "./game-rewards.js";
import { absatz, artikelRaster, artikelStreifen, codeBox, kleingedruckt, knopf, mailRahmen, neuesteArtikel, shopHome } from "./mail-design.js";
import { istSandbox } from "./sandbox.js";

const SHOP_ORIGINS = Object.freeze([
  "https://disorder119.com",
  "https://www.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);
const ADMIN_ORIGINS = Object.freeze(["https://admin.disorder119.com"]);
const BREVO_CONTACTS = "https://api.brevo.com/v3/contacts";

export const CONFIRM_TTL_HOURS = 48;
export const RESEND_PAUSE_MINUTES = 10;
export const IP_MAILS_PER_HOUR = 10;
export const NEWSLETTER_DAILY_CAP = 150;
export const CODES_PER_NETWORK = 2;
export const CODE_NETWORK_WINDOW_DAYS = 30;
export const CONSENT_VERSION = "2026-09-26";

// Die bekanntesten Wegwerf-Postfaecher. Wer dort einen Code holt, meint ihn
// nicht ernst - und koennte sich beliebig viele holen.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.de", "sharklasers.com", "grr.la",
  "10minutemail.com", "10minutemail.net", "temp-mail.org", "tempmail.com", "tempmail.de",
  "tempmailo.com", "tempr.email", "yopmail.com", "yopmail.fr", "trashmail.com", "trashmail.de",
  "wegwerfmail.de", "wegwerfemail.de", "einrot.com", "spambog.com", "getnada.com", "nada.email",
  "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com", "mailnesia.com",
  "mintemail.com", "emailondeck.com", "moakt.com", "discard.email", "mohmal.com",
  "burnermail.io", "mailcatch.com", "spamgourmet.com", "trbvm.com", "byom.de", "muell.email",
]);

// Ein Postfach, eine Schreibweise: Plus-Anhang weg, bei Gmail zaehlen Punkte
// nicht und googlemail.com ist gmail.com.
export function canonicalEmail(email) {
  const [local = "", domain = ""] = String(email || "").split("@");
  const host = domain === "googlemail.com" ? "gmail.com" : domain;
  let name = local.split("+")[0];
  if (host === "gmail.com") name = name.replace(/\./g, "");
  return `${name}@${host}`;
}

export function isDisposableEmail(email) {
  const domain = String(email || "").split("@")[1] || "";
  return DISPOSABLE_DOMAINS.has(domain) || [...DISPOSABLE_DOMAINS].some(d => domain.endsWith(`.${d}`));
}

export const CONSENT_TEXT = Object.freeze({
  de: "Ja, ich möchte den DISORDER119-Newsletter mit neuen Stücken und Aktionen per E-Mail erhalten – einschließlich der Messung, ob die Mails geöffnet und Links angeklickt werden. Die Einwilligung kann ich jederzeit widerrufen, z. B. über den Abmeldelink in jeder Mail.",
  en: "Yes, I want to receive the DISORDER119 newsletter with new pieces and offers by email – including measurement of whether the emails are opened and links are clicked. I can withdraw my consent at any time, e.g. via the unsubscribe link in every email.",
  fr: "Oui, je souhaite recevoir la newsletter DISORDER119 avec les nouvelles pièces et offres par e-mail – y compris la mesure de l'ouverture des e-mails et des clics sur les liens. Je peux retirer mon consentement à tout moment, p. ex. via le lien de désinscription dans chaque e-mail.",
});

export class NewsletterError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function isNewsletterRoute(url) {
  const path = url.pathname.replace(/\/+$/, "");
  return path === "/newsletter/subscribe" ||
    path === "/newsletter/confirm" ||
    path === "/newsletter/unsubscribe" ||
    path === "/admin/newsletter" ||
    path === "/admin/coupons/check" ||
    path === "/admin/coupons/redeem" ||
    path === "/admin/newsletter/entwurf";
}

function language(value) {
  const lang = String(value || "").trim().toLowerCase().slice(0, 2);
  return lang === "en" || lang === "fr" ? lang : "de";
}

function pageUrl(lang) {
  return `${SHOP_URL}${lang === "de" ? "" : `/${lang}`}/newsletter/`;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const data = new Uint8Array(32);
  crypto.getRandomValues(data);
  return Array.from(data, byte => byte.toString(16).padStart(2, "0")).join("");
}

function tokenFrom(value) {
  const token = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(token) ? token : "";
}

async function ipHash(request, env) {
  return privateIpHash(request, env, "newsletter");
}

function dailyCap(env) {
  const configured = Number(env?.NEWSLETTER_DAILY_CAP);
  return Number.isInteger(configured) && configured > 0 ? configured : NEWSLETTER_DAILY_CAP;
}

function plusHours(hours, from = new Date()) {
  return new Date(from.getTime() + hours * 3_600_000).toISOString();
}

// ------------------------------------------------------------------ Mails
//
// Schwarz wie der Shop (mail-design.js): die Bestaetigungsmail zeigt einen
// Streifen mit drei neuen Stuecken, die Willkommensmail Code, Knopf und die
// vier neuesten Artikel. Ohne Katalog (Abruf fehlgeschlagen) kommen beide
// Mails eben ohne Bilder - der Text allein reicht immer.

const MAIL_TEXT = {
  de: {
    eyebrow: "Newsletter",
    confirmSubject: "Bitte bestätige deine Anmeldung – DISORDER119",
    confirmTitle: "Fast geschafft",
    confirmBody: "Ein Klick noch: Bestätige deine Anmeldung zum DISORDER119-Newsletter. Danach bekommst du deinen Code für 10 % auf deine nächste Bestellung.",
    confirmButton: "Anmeldung bestätigen",
    confirmNote: `Der Link gilt ${CONFIRM_TTL_HOURS} Stunden. Wenn du dich nicht angemeldet hast, ignorier diese Mail einfach – ohne Klick passiert nichts.`,
    confirmPreview: "Nur noch ein Klick – dann gehören 10 % dir.",
    welcomeSubject: "Dein 10-%-Code – willkommen bei DISORDER119",
    welcomeEyebrow: "Willkommen im Archiv",
    welcomeTitle: "10 % für dich",
    welcomeBody: "Danke für deine Anmeldung. Dein Code gilt für deine nächste Bestellung – einfach im Warenkorb eingeben.",
    codeNote: "Einmal einlösbar · 10 % auf deine nächste Bestellung",
    welcomeShop: "Zum Archiv",
    newArrivals: "Neu im Archiv",
    welcomePreview: "Dein Code für 10 % – und die neuesten Stücke im Archiv.",
    unsubscribe: "Newsletter abbestellen",
  },
  en: {
    eyebrow: "Newsletter",
    confirmSubject: "Please confirm your subscription – DISORDER119",
    confirmTitle: "Almost there",
    confirmBody: "One more click: confirm your subscription to the DISORDER119 newsletter. Afterwards you get your code for 10% off your next order.",
    confirmButton: "Confirm subscription",
    confirmNote: `The link is valid for ${CONFIRM_TTL_HOURS} hours. If you didn't sign up, just ignore this email – nothing happens without a click.`,
    confirmPreview: "One more click – then 10% is yours.",
    welcomeSubject: "Your 10% code – welcome to DISORDER119",
    welcomeEyebrow: "Welcome to the archive",
    welcomeTitle: "10% for you",
    welcomeBody: "Thanks for subscribing. Your code is valid for your next order – just enter it in the cart.",
    codeNote: "Valid once · 10% off your next order",
    welcomeShop: "Visit the archive",
    newArrivals: "New in the archive",
    welcomePreview: "Your 10% code – and the newest pieces in the archive.",
    unsubscribe: "Unsubscribe",
  },
  fr: {
    eyebrow: "Newsletter",
    confirmSubject: "Confirme ton inscription – DISORDER119",
    confirmTitle: "Presque fini",
    confirmBody: "Encore un clic : confirme ton inscription à la newsletter DISORDER119. Ensuite, tu recevras ton code de 10 % sur ta prochaine commande.",
    confirmButton: "Confirmer l'inscription",
    confirmNote: `Le lien est valable ${CONFIRM_TTL_HOURS} heures. Si tu ne t'es pas inscrit·e, ignore simplement cet e-mail – rien ne se passe sans clic.`,
    confirmPreview: "Encore un clic – et les 10 % sont à toi.",
    welcomeSubject: "Ton code de 10 % – bienvenue chez DISORDER119",
    welcomeEyebrow: "Bienvenue dans l'archive",
    welcomeTitle: "10 % pour toi",
    welcomeBody: "Merci pour ton inscription. Ton code est valable pour ta prochaine commande – à saisir dans le panier.",
    codeNote: "Valable une fois · 10 % sur ta prochaine commande",
    welcomeShop: "Voir l'archive",
    newArrivals: "Nouveau dans l'archive",
    welcomePreview: "Ton code de 10 % – et les nouvelles pièces de l'archive.",
    unsubscribe: "Se désinscrire",
  },
};

const ABSTAND = (px) => `<div style="height:${px}px;line-height:${px}px;font-size:1px;">&nbsp;</div>`;

function artikelText(artikel) {
  return artikel.map(a => `${a.marke} – ${a.titel} – ${a.preis}\n${a.link}`).join("\n\n");
}

export function confirmMail(lang, link, artikel = []) {
  const l = language(lang);
  const t = MAIL_TEXT[l];
  return {
    subject: t.confirmSubject,
    text: ["DISORDER119", "", t.confirmBody, "", link, "", t.confirmNote].join("\n"),
    html: mailRahmen({
      lang: l, titel: t.confirmTitle, eyebrow: t.eyebrow, vorschau: t.confirmPreview,
      inhalt: absatz(t.confirmBody) + knopf(link, t.confirmButton) + kleingedruckt(t.confirmNote) + artikelStreifen(artikel),
    }),
  };
}

export function welcomeMail(lang, code, unsubscribeLink, artikel = []) {
  const l = language(lang);
  const t = MAIL_TEXT[l];
  return {
    subject: t.welcomeSubject,
    text: ["DISORDER119", "", t.welcomeBody, "", code, "", shopHome(l),
      ...(artikel.length ? ["", t.newArrivals.toUpperCase(), "", artikelText(artikel)] : []),
      "", `${t.unsubscribe}: ${unsubscribeLink}`].join("\n"),
    html: mailRahmen({
      lang: l, titel: t.welcomeTitle, eyebrow: t.welcomeEyebrow, vorschau: t.welcomePreview, abmeldeLink: unsubscribeLink,
      inhalt: absatz(t.welcomeBody) + codeBox(code, t.codeNote) + ABSTAND(32) + knopf(shopHome(l), t.welcomeShop) +
        ABSTAND(44) + artikelRaster(artikel, t.newArrivals),
    }),
  };
}

// Vorlage fuer einen richtigen Newsletter (Brevo-Kampagne): die neuesten
// Stuecke im Raster. {{ unsubscribe }} ersetzt Brevo durch den Abmeldelink.
export const ENTWURF_TEXT = Object.freeze({
  betreff: "Neu im Archiv – DISORDER119",
  vorschau: "Die neuesten Stücke im Archiv – jedes gibt es nur einmal.",
  titel: "Neu im Archiv",
  eyebrow: "DISORDER119 Newsletter",
  einleitung: "Frisch fotografiert und beschrieben: die neuesten Stücke im Archiv. Jedes davon gibt es genau einmal – wer zuerst kommt.",
  knopf: "Alle Stücke ansehen",
});

export function entwurfMail(artikel) {
  return mailRahmen({
    lang: "de", titel: ENTWURF_TEXT.titel, eyebrow: ENTWURF_TEXT.eyebrow, vorschau: ENTWURF_TEXT.vorschau,
    abmeldeLink: "{{ unsubscribe }}",
    inhalt: absatz(ENTWURF_TEXT.einleitung) + knopf(shopHome("de"), ENTWURF_TEXT.knopf) + ABSTAND(44) +
      artikelRaster(artikel, "") + ABSTAND(8) + knopf(shopHome("de"), ENTWURF_TEXT.knopf),
  });
}

// ------------------------------------------------------------------ Brevo-Liste

export const BREVO_LIST_NAME = "Newsletter DISORDER119";

async function brevoContacts(env, path, body, method = "POST") {
  // Testshop: die echte Newsletter-Liste bei Brevo bleibt unberuehrt.
  if (istSandbox(env)) return null;
  const response = await fetch(`${BREVO_CONTACTS}${path}`, {
    method,
    headers: { "api-key": String(env.MAIL_API_KEY), "Content-Type": "application/json", Accept: "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`brevo_contacts:${String(data?.code || data?.message || `HTTP ${response.status}`).slice(0, 80)}`);
  }
  return data;
}

function configuredListId(env) {
  const id = Number(env?.NEWSLETTER_LIST_ID);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Die Brevo-Liste richtet sich selbst ein: gibt es "Newsletter DISORDER119"
// noch nicht, legt der Worker sie im ersten Ordner an und merkt sich die
// Nummer in site_settings. NEWSLETTER_LIST_ID ueberschreibt das.
async function ensureListId(env) {
  const configured = configuredListId(env);
  if (configured) return configured;
  const cached = await env.DB.prepare("SELECT value FROM site_settings WHERE key='newsletter_list_id'").first();
  if (Number(cached?.value) > 0) return Number(cached.value);

  const lists = await brevoContacts(env, "/lists?limit=50&offset=0", null, "GET");
  let id = (lists?.lists || []).find(list => list.name === BREVO_LIST_NAME)?.id;
  if (!id) {
    const folders = await brevoContacts(env, "/folders?limit=10&offset=0", null, "GET");
    let folderId = folders?.folders?.[0]?.id;
    if (!folderId) folderId = (await brevoContacts(env, "/folders", { name: "DISORDER119" }))?.id;
    id = (await brevoContacts(env, "/lists", { name: BREVO_LIST_NAME, folderId }))?.id;
  }
  if (!(Number(id) > 0)) throw new Error("brevo_list_missing");
  await env.DB.prepare(`INSERT INTO site_settings (key,value,updated_at) VALUES ('newsletter_list_id',?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .bind(String(id), new Date().toISOString()).run();
  return Number(id);
}

async function knownListId(env) {
  const configured = configuredListId(env);
  if (configured) return configured;
  const cached = await env.DB.prepare("SELECT value FROM site_settings WHERE key='newsletter_list_id'").first();
  return Number(cached?.value) > 0 ? Number(cached.value) : null;
}

function logFailure(event, reqId, err) {
  console.error(JSON.stringify({ level: "error", event, requestId: String(reqId).slice(0, 120), message: String(err?.message || err).slice(0, 160) }));
}

// ------------------------------------------------------------------ Ablauf

export async function subscribe(env, input = {}, { reqId = crypto.randomUUID(), ip = null, now = new Date() } = {}) {
  if (!env?.DB) throw new NewsletterError("NEWSLETTER_DATABASE_NOT_CONFIGURED", 503);
  if (!mailTransportReady(env)) throw new NewsletterError("NEWSLETTER_MAIL_NOT_CONFIGURED", 503);
  const email = normalizeEmail(input.email);
  if (!email) throw new NewsletterError("INVALID_EMAIL", 400);
  if (isDisposableEmail(email)) throw new NewsletterError("DISPOSABLE_EMAIL", 400);
  if (input.consent !== true) throw new NewsletterError("CONSENT_REQUIRED", 400);
  const lang = language(input.lang);
  const source = String(input.source || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || null;
  const nowIso = now.toISOString();
  const db = env.DB;
  const canonical = canonicalEmail(email);

  // Dieselbe Zeile fuer alle Schreibweisen eines Postfachs: die Mail geht an
  // die zuerst eingetragene Adresse, der Code bleibt einer.
  const existing = await db.prepare("SELECT * FROM newsletter_subscribers WHERE email_canonical=?").bind(canonical).first();
  // Schon bestaetigt: nichts verschicken, gleiche Antwort wie immer.
  if (existing?.status === "CONFIRMED") return { queued: false, reason: "ALREADY_CONFIRMED" };
  if (existing?.status === "PENDING" && existing.last_confirm_mail_at &&
      existing.last_confirm_mail_at > new Date(now.getTime() - RESEND_PAUSE_MINUTES * 60_000).toISOString()) {
    return { queued: false, reason: "RECENTLY_SENT" };
  }
  if (ip) {
    const hour = new Date(now.getTime() - 3_600_000).toISOString();
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM newsletter_subscribers
      WHERE request_ip_hash=? AND last_confirm_mail_at>=?`).bind(ip, hour).first();
    if (Number(row?.n || 0) >= IP_MAILS_PER_HOUR) return { queued: false, reason: "IP_RATE_LIMITED" };
  }
  const day = new Date(now.getTime() - 86_400_000).toISOString();
  const sentToday = await db.prepare("SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE last_confirm_mail_at>=?").bind(day).first();
  if (Number(sentToday?.n || 0) >= dailyCap(env)) {
    console.warn(JSON.stringify({ level: "warn", event: "newsletter_daily_cap_reached", requestId: String(reqId).slice(0, 120) }));
    return { queued: false, reason: "DAILY_CAP" };
  }

  const token = randomToken();
  const fields = {
    lang,
    source,
    consent_text: CONSENT_TEXT[lang],
    consent_version: CONSENT_VERSION,
    requested_at: nowIso,
    request_ip_hash: ip,
    confirm_token_hash: await sha256Hex(token),
    confirm_expires_at: plusHours(CONFIRM_TTL_HOURS, now),
    last_confirm_mail_at: nowIso,
    updated_at: nowIso,
  };
  if (existing) {
    await db.prepare(`UPDATE newsletter_subscribers SET status='PENDING',lang=?,source=?,consent_text=?,
        consent_version=?,requested_at=?,request_ip_hash=?,confirm_token_hash=?,confirm_expires_at=?,
        last_confirm_mail_at=?,updated_at=?
      WHERE id=?`)
      .bind(fields.lang, fields.source, fields.consent_text, fields.consent_version, fields.requested_at,
        fields.request_ip_hash, fields.confirm_token_hash, fields.confirm_expires_at, fields.last_confirm_mail_at,
        fields.updated_at, existing.id)
      .run();
  } else {
    await db.prepare(`INSERT INTO newsletter_subscribers
        (id,email_normalized,email_canonical,status,lang,source,consent_text,consent_version,requested_at,
         request_ip_hash,confirm_token_hash,confirm_expires_at,last_confirm_mail_at,updated_at)
      VALUES (?,?,?,'PENDING',?,?,?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), email, canonical, fields.lang, fields.source, fields.consent_text,
        fields.consent_version, fields.requested_at, fields.request_ip_hash, fields.confirm_token_hash,
        fields.confirm_expires_at, fields.last_confirm_mail_at, fields.updated_at)
      .run();
  }

  const link = `${pageUrl(lang)}?bestaetigen=${token}`;
  const message = confirmMail(lang, link, await neuesteArtikel(3, lang));
  const recipient = existing?.email_normalized || email;
  await sendMail(env, { to: recipient, subject: message.subject, text: message.text, html: message.html, tag: "newsletter-bestaetigung" });
  return { queued: true };
}

export async function confirm(env, rawToken, { reqId = crypto.randomUUID(), ip = null, now = new Date() } = {}) {
  if (!env?.DB) throw new NewsletterError("NEWSLETTER_DATABASE_NOT_CONFIGURED", 503);
  const token = tokenFrom(rawToken);
  if (!token) throw new NewsletterError("NEWSLETTER_LINK_INVALID", 404);
  const db = env.DB;
  const row = await db.prepare("SELECT * FROM newsletter_subscribers WHERE confirm_token_hash=?").bind(await sha256Hex(token)).first();
  if (!row || row.status === "UNSUBSCRIBED") throw new NewsletterError("NEWSLETTER_LINK_INVALID", 404);

  const nowIso = now.toISOString();
  let firstConfirm = false;
  if (row.status === "PENDING") {
    if (!row.confirm_expires_at || row.confirm_expires_at <= nowIso) {
      throw new NewsletterError("NEWSLETTER_LINK_EXPIRED", 410);
    }
    const changed = await db.prepare(`UPDATE newsletter_subscribers
        SET status='CONFIRMED',confirmed_at=?,confirm_ip_hash=?,unsubscribed_at=NULL,updated_at=?
      WHERE id=? AND status='PENDING'`).bind(nowIso, ip, nowIso, row.id).run();
    firstConfirm = Boolean(changed?.meta?.changes);
  }

  // Genau ein Code pro Adresse. Fehlt er noch (erster Klick oder ein
  // abgebrochener Versuch), wird er jetzt vergeben. Klicken zwei Tabs
  // gleichzeitig, gewinnt einer; der Code des anderen wird entwertet.
  let couponCode = "";
  let couponLimited = false;
  const current = await db.prepare("SELECT coupon_id FROM newsletter_subscribers WHERE id=?").bind(row.id).first();
  if (!current?.coupon_id && ip) {
    // Viele Adressen, ein Anschluss: nach CODES_PER_NETWORK Codes in 30 Tagen
    // bleibt die Anmeldung gueltig, aber ohne weiteren Rabatt.
    const since = new Date(now.getTime() - CODE_NETWORK_WINDOW_DAYS * 86_400_000).toISOString();
    const issued = await db.prepare(`SELECT COUNT(*) AS n FROM newsletter_subscribers
      WHERE confirm_ip_hash=? AND coupon_id IS NOT NULL AND confirmed_at>=? AND id<>?`).bind(ip, since, row.id).first();
    couponLimited = Number(issued?.n || 0) >= CODES_PER_NETWORK;
  }
  if (!current?.coupon_id && !couponLimited) {
    const coupon = await issueRewardCoupon(db, { usernameKey: "newsletter" });
    const linked = await db.prepare(`UPDATE newsletter_subscribers SET coupon_id=?,coupon_hint=?,updated_at=?
      WHERE id=? AND coupon_id IS NULL`).bind(coupon.id, coupon.hint, nowIso, row.id).run();
    if (linked?.meta?.changes) couponCode = coupon.code;
    else await db.prepare("UPDATE reward_coupons SET status='VOID' WHERE id=?").bind(coupon.id).run();
  }
  if (!firstConfirm && !couponCode) return { alreadyConfirmed: true, lang: row.lang };

  if (firstConfirm && env.MAIL_API_KEY) {
    try {
      const list = await ensureListId(env);
      await brevoContacts(env, "", { email: row.email_normalized, listIds: [list], updateEnabled: true });
      await db.prepare("UPDATE newsletter_subscribers SET brevo_synced_at=? WHERE id=?").bind(nowIso, row.id).run();
    } catch (err) {
      logFailure("newsletter_brevo_sync_failed", reqId, err);
    }
  }

  // Die Willkommensmail bringt den Code und einen eigenen Abmeldelink. Der
  // Abmelde-Token entsteht erst hier, weil er vorher nirgends verschickt wird.
  if (couponCode) {
    const unsubscribeToken = randomToken();
    await db.prepare("UPDATE newsletter_subscribers SET unsubscribe_token_hash=? WHERE id=?")
      .bind(await sha256Hex(unsubscribeToken), row.id).run();
    const unsubscribeLink = `${pageUrl(row.lang)}?abmelden=${unsubscribeToken}`;
    try {
      const message = welcomeMail(row.lang, couponCode, unsubscribeLink, await neuesteArtikel(4, row.lang));
      await sendMail(env, { to: row.email_normalized, subject: message.subject, text: message.text, html: message.html, tag: "newsletter-willkommen" });
    } catch (err) {
      // Der Code steht trotzdem auf der Seite - die Mail ist nur die Kopie.
      logFailure("newsletter_welcome_mail_failed", reqId, err);
    }
  }
  return { confirmed: true, lang: row.lang, couponCode, discountPercent: couponCode ? 10 : 0, ...(couponLimited ? { couponLimited: true } : {}) };
}

// ------------------------------------------------------------------ Codes in der Admin-App
//
// Verkaeufe per Nachricht oder auf dem Flohmarkt laufen nicht durch den
// Checkout. Damit ein Code dort nicht zweimal zaehlt, prueft und entwertet
// die Admin-App ihn hier - danach lehnen Warenkorb und Checkout ihn ab.

async function couponRow(db, rawCode) {
  const code = normalizeCouponCode(rawCode);
  if (!code) throw new NewsletterError("COUPON_FORMAT_INVALID", 400);
  const row = await db.prepare(`SELECT c.*, s.email_normalized AS newsletter_email
    FROM reward_coupons c LEFT JOIN newsletter_subscribers s ON s.coupon_id = c.id
    WHERE c.code_hash=? LIMIT 1`).bind(await sha256Hex(code)).first();
  if (!row) throw new NewsletterError("COUPON_NOT_FOUND", 404);
  return row;
}

function couponInfo(row) {
  return {
    status: row.status,
    discountPercent: Number(row.discount_bps || 0) / 100,
    source: row.source_game ? "spiel" : row.username_key === "newsletter" ? "newsletter" : "sonstiges",
    email: row.newsletter_email || null,
    createdAt: row.created_at,
    redeemedAt: row.redeemed_at || null,
    redeemedFor: row.redeemed_order_id || null,
  };
}

export async function checkCoupon(env, rawCode) {
  return couponInfo(await couponRow(env.DB, rawCode));
}

export async function redeemCouponManually(env, rawCode, note = "", now = new Date()) {
  const db = env.DB;
  const row = await couponRow(db, rawCode);
  if (row.status !== "ACTIVE") return { redeemed: false, ...couponInfo(row) };
  const label = `MANUELL:${String(note || "").replace(/\s+/g, " ").trim().slice(0, 60) || "Admin-App"}`;
  const changed = await db.prepare(`UPDATE reward_coupons SET status='REDEEMED',redeemed_order_id=?,redeemed_at=?,reserved_until=NULL
    WHERE id=? AND status='ACTIVE'`).bind(label, now.toISOString(), row.id).run();
  const after = await couponRow(db, rawCode);
  return { redeemed: Boolean(changed?.meta?.changes), ...couponInfo(after) };
}

export async function unsubscribe(env, rawToken, { reqId = crypto.randomUUID(), now = new Date() } = {}) {
  if (!env?.DB) throw new NewsletterError("NEWSLETTER_DATABASE_NOT_CONFIGURED", 503);
  const token = tokenFrom(rawToken);
  if (!token) throw new NewsletterError("NEWSLETTER_LINK_INVALID", 404);
  const db = env.DB;
  const row = await db.prepare("SELECT * FROM newsletter_subscribers WHERE unsubscribe_token_hash=?").bind(await sha256Hex(token)).first();
  if (!row) throw new NewsletterError("NEWSLETTER_LINK_INVALID", 404);
  if (row.status !== "UNSUBSCRIBED") {
    const nowIso = now.toISOString();
    await db.prepare(`UPDATE newsletter_subscribers
        SET status='UNSUBSCRIBED',unsubscribed_at=?,confirm_token_hash=NULL,confirm_expires_at=NULL,updated_at=?
      WHERE id=?`).bind(nowIso, nowIso, row.id).run();
    const list = await knownListId(env);
    if (list && env.MAIL_API_KEY) {
      try {
        await brevoContacts(env, `/lists/${list}/contacts/remove`, { emails: [row.email_normalized] });
      } catch (err) {
        logFailure("newsletter_brevo_remove_failed", reqId, err);
      }
    }
  }
  return { unsubscribed: true, lang: row.lang };
}

export async function overview(env, { limit = 100 } = {}) {
  const db = env.DB;
  const counts = { PENDING: 0, CONFIRMED: 0, UNSUBSCRIBED: 0 };
  const { results: groups } = await db.prepare("SELECT status, COUNT(*) AS n FROM newsletter_subscribers GROUP BY status").all();
  for (const group of groups || []) counts[group.status] = Number(group.n || 0);
  // Alle Anmeldungen, neueste zuerst: bestaetigte, noch offene und
  // abgemeldete - die Admin-App zeigt den Status dazu.
  const { results } = await db.prepare(`SELECT s.email_normalized AS email, s.status, s.lang, s.source,
      s.requested_at AS requestedAt, s.confirmed_at AS confirmedAt, s.unsubscribed_at AS unsubscribedAt,
      s.coupon_hint AS couponHint, c.status AS couponStatus
    FROM newsletter_subscribers s LEFT JOIN reward_coupons c ON c.id = s.coupon_id
    ORDER BY COALESCE(s.unsubscribed_at, s.confirmed_at, s.requested_at) DESC LIMIT ?`)
    .bind(Math.max(1, Math.min(500, Number(limit) || 100))).all();
  return {
    confirmed: counts.CONFIRMED,
    pending: counts.PENDING,
    unsubscribed: counts.UNSUBSCRIBED,
    brevoList: await knownListId(env),
    notInBrevo: Number((await db.prepare(`SELECT COUNT(*) AS n FROM newsletter_subscribers
      WHERE status='CONFIRMED' AND brevo_synced_at IS NULL`).first())?.n || 0),
    subscribers: (results || []).map(r => ({ ...r, couponRedeemed: r.couponStatus === "REDEEMED" })),
  };
}

// Newsletter-Entwurf: legt in Brevo eine Kampagne mit den neuesten Stuecken
// an - nur als Entwurf, verschickt wird erst in Brevo per Klick.
const BREVO_KAMPAGNEN = "https://api.brevo.com/v3/emailCampaigns";

export async function createCampaignDraft(env, { anzahl = 6, betreff = "" } = {}, now = new Date()) {
  if (!mailTransportReady(env)) throw new NewsletterError("NEWSLETTER_MAIL_NOT_CONFIGURED", 503);
  if (istSandbox(env)) throw new NewsletterError("IM_TESTSHOP_NICHT_MOEGLICH", 409);
  const artikel = await neuesteArtikel(Math.max(2, Math.min(12, Number(anzahl) || 6)), "de");
  if (!artikel.length) throw new NewsletterError("KEINE_ARTIKEL", 503);
  const list = await ensureListId(env);
  const datum = now.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
  const response = await fetch(BREVO_KAMPAGNEN, {
    method: "POST",
    headers: { "api-key": String(env.MAIL_API_KEY), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      name: `Neu im Archiv – ${datum}`,
      subject: String(betreff || ENTWURF_TEXT.betreff).slice(0, 150),
      previewText: ENTWURF_TEXT.vorschau,
      sender: { name: String(env.MAIL_FROM_NAME || "DISORDER119"), email: String(env.MAIL_FROM) },
      replyTo: normalizeEmail(env.MAIL_REPLY_TO || env.MAIL_FROM) || String(env.MAIL_FROM),
      htmlContent: entwurfMail(artikel),
      recipients: { listIds: [list] },
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    console.error(JSON.stringify({ level: "error", event: "newsletter_campaign_failed", status: response.status, code: String(data?.code || "").slice(0, 60), message: String(data?.message || "").slice(0, 160) }));
    throw new NewsletterError("BREVO_KAMPAGNE_FEHLGESCHLAGEN", 502);
  }
  return {
    campaignId: data?.id ?? null,
    artikel: artikel.length,
    liste: list,
    link: data?.id ? `https://app.brevo.com/marketing-campaign/edit/${data.id}` : "https://app.brevo.com/marketing-campaign/list",
  };
}

// ------------------------------------------------------------------ HTTP

function headers(origin, admin) {
  const allowed = admin ? ADMIN_ORIGINS : SHOP_ORIGINS;
  const out = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Access-Control-Allow-Methods": admin ? "GET, POST, OPTIONS" : "POST, OPTIONS",
    "Access-Control-Allow-Headers": admin ? "Content-Type, Authorization" : "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && allowed.includes(origin)) out["Access-Control-Allow-Origin"] = origin;
  return out;
}

function reply(data, status, origin, admin = false) {
  return new Response(JSON.stringify(data), { status, headers: headers(origin, admin) });
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

async function tokenEquals(left, right) {
  if (!left || !right) return false;
  const [a, b] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function limitRequests(request, env) {
  if (!env.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== "function") return;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const result = await env.RATE_LIMITER.limit({ key: `newsletter:${ip}` });
  if (result && result.success === false) throw new NewsletterError("RATE_LIMITED", 429);
}

// Wie bei der Konto-Anmeldung: ohne Secret (Testbetrieb) keine Pruefung, im
// Livebetrieb laesst backend-runtime.js die Route ohne Secret gar nicht zu.
async function verifyTurnstile(env, request, body) {
  if (!env.TURNSTILE_SECRET) return;
  const token = request.headers.get("X-Turnstile-Token") || body?.turnstileToken;
  if (!token) throw new NewsletterError("TURNSTILE_REQUIRED", 403);
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", String(token).slice(0, 2048));
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const result = await res.json();
  if (!result.success) throw new NewsletterError("TURNSTILE_FAILED", 403);
}

export async function handleNewsletter(request, env, url, reqId = crypto.randomUUID(), origin = null) {
  const path = url.pathname.replace(/\/+$/, "");
  const admin = path.startsWith("/admin/");
  try {
    if (request.method === "OPTIONS") {
      const allowed = admin ? ADMIN_ORIGINS : SHOP_ORIGINS;
      if (origin && !allowed.includes(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: headers(origin, admin) });
    }

    if (admin) {
      if (origin && !ADMIN_ORIGINS.includes(origin)) throw new NewsletterError("ORIGIN_NOT_ALLOWED", 403);
      const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      if (!env.ADMIN_TOKEN || !(await tokenEquals(supplied, env.ADMIN_TOKEN))) throw new NewsletterError("UNAUTHORIZED", 401);
      if (!env.DB) throw new NewsletterError("NEWSLETTER_DATABASE_NOT_CONFIGURED", 503);
      if (path === "/admin/newsletter") {
        if (request.method !== "GET") throw new NewsletterError("METHOD_NOT_ALLOWED", 405);
        return reply({ ok: true, ...(await overview(env, { limit: url.searchParams.get("limit") })) }, 200, origin, true);
      }
      if (request.method !== "POST") throw new NewsletterError("METHOD_NOT_ALLOWED", 405);
      const body = await readJson(request);
      if (path === "/admin/newsletter/entwurf") {
        return reply({ ok: true, ...(await createCampaignDraft(env, { anzahl: body.anzahl, betreff: body.betreff })) }, 200, origin, true);
      }
      if (path === "/admin/coupons/check") {
        return reply({ ok: true, ...(await checkCoupon(env, body.code)) }, 200, origin, true);
      }
      return reply({ ok: true, ...(await redeemCouponManually(env, body.code, body.note)) }, 200, origin, true);
    }

    if (origin && !SHOP_ORIGINS.includes(origin)) throw new NewsletterError("ORIGIN_NOT_ALLOWED", 403);
    if (request.method !== "POST") throw new NewsletterError("METHOD_NOT_ALLOWED", 405);
    const body = await readJson(request);

    if (path === "/newsletter/subscribe") {
      await limitRequests(request, env);
      await verifyTurnstile(env, request, body);
      await subscribe(env, body, { reqId, ip: await ipHash(request, env) });
      return reply({ ok: true }, 200, origin);
    }
    if (path === "/newsletter/confirm") {
      await limitRequests(request, env);
      const result = await confirm(env, body.token, { reqId, ip: await ipHash(request, env) });
      return reply({ ok: true, ...result }, 200, origin);
    }
    await limitRequests(request, env);
    return reply({ ok: true, ...(await unsubscribe(env, body.token, { reqId })) }, 200, origin);
  } catch (err) {
    if (err instanceof NewsletterError || err?.code === "IP_PRIVACY_NOT_CONFIGURED") {
      return reply({ error: err.code, requestId: reqId }, err.status, origin, admin);
    }
    logFailure("newsletter_error", reqId, err);
    return reply({ error: "NEWSLETTER_ERROR", requestId: reqId }, 500, origin, admin);
  }
}
