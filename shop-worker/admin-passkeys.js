// Admin-Anmeldung per Passkey: Face ID auf dem iPhone, Windows Hello am Laptop.
//
// Kein Passwort und kein Token im Browser. Jedes freigeschaltete Geraet haelt
// einen privaten Schluessel in seinem Sicherheitschip; der Server speichert
// nur die oeffentlichen Schluessel. Eine Unterschrift gilt nur fuer
// admin.disorder119.com - eine nachgebaute Phishing-Seite bekommt vom Geraet
// gar keine.
//
// Wer darf ein Geraet freischalten?
//   - Das erste: nur solange noch kein Passkey existiert, und nur mit dem
//     ADMIN_WRITE_TOKEN. Danach oeffnet der Token keine Tuer mehr.
//   - Jedes weitere: nur mit einem Kopplungscode, den ein bereits
//     angemeldetes Geraet erzeugt (zehn Minuten gueltig, einmal nutzbar).
//   - Hoechstens ADMIN_MAX_PASSKEYS Geraete, Standard zwei.
// Sind beide Geraete verloren, setzt man die Tabelle admin_passkeys ueber
// das Cloudflare-Konto zurueck - dann gilt wieder der Token fuer das erste.
//
// Umgesetzt nach WebAuthn Level 2, ohne fremde Bibliothek: CBOR, COSE und die
// Signaturpruefung sind klein genug, um sie hier vollstaendig zu pruefen, und
// jede Zeile Fremdcode waere Angriffsflaeche an der sensibelsten Stelle.
import { safeText } from "./commerce-core.js";
import { sendTelegramMessage } from "./notifications.js";

export const ADMIN_SESSION_COOKIE = "d119_admin";
const DEFAULT_SESSION_HOURS = 12;
const DEFAULT_MAX_PASSKEYS = 2;
const CHALLENGE_TTL_MS = 5 * 60_000;
const PAIRING_TTL_MS = 10 * 60_000;
const USER_HANDLE = "disorder119-owner";
const RP_NAME = "DISORDER119 Admin";

// Nur diese Seiten duerfen Admin-Passkeys anlegen oder benutzen. Der Wert ist
// die Relying-Party-ID: der Passkey gilt nur fuer genau diesen Hostnamen.
export const PASSKEY_ORIGINS = Object.freeze({
  "https://admin.disorder119.com": "admin.disorder119.com",
  "http://localhost:8765": "localhost",
});

const ALGORITHMS = Object.freeze({ ES256: -7, RS256: -257 });

export class AdminAuthError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// ------------------------------------------------------------------ Kodierung

export function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(text, code = "ENCODING_INVALID") {
  const value = String(text || "");
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new AdminAuthError(code, 400);
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  let binary;
  try { binary = atob(padded); } catch { throw new AdminAuthError(code, 400); }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function sha256(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function hex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sameSecret(left, right) {
  if (!left || !right) return false;
  const [a, b] = await Promise.all([sha256(String(left)), sha256(String(right))]);
  return sameBytes(a, b);
}

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

// ----------------------------------------------------------------------- CBOR
// Nur der Teil, den WebAuthn braucht: Zahlen, Bytes, Text, Listen, Maps und
// true/false/null. Unbestimmte Laengen, Tags und Gleitkommazahlen lehnen wir
// ab - kein Authenticator schickt sie in den Feldern, die wir lesen.

export function decodeCbor(bytes, start = 0) {
  let pos = start;
  const need = n => {
    if (pos + n > bytes.length) throw new AdminAuthError("CBOR_TRUNCATED", 400);
  };
  const length = info => {
    if (info < 24) return info;
    if (info === 24) { need(1); return bytes[pos++]; }
    if (info === 25) { need(2); const v = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2; return v; }
    if (info === 26) {
      need(4);
      const v = ((bytes[pos] << 24) >>> 0) + (bytes[pos + 1] << 16) + (bytes[pos + 2] << 8) + bytes[pos + 3];
      pos += 4;
      return v;
    }
    if (info === 27) {
      need(8);
      let v = 0;
      for (let i = 0; i < 8; i++) v = v * 256 + bytes[pos + i];
      pos += 8;
      if (!Number.isSafeInteger(v)) throw new AdminAuthError("CBOR_UNSUPPORTED", 400);
      return v;
    }
    throw new AdminAuthError("CBOR_UNSUPPORTED", 400);
  };
  const item = depth => {
    if (depth > 16) throw new AdminAuthError("CBOR_TOO_DEEP", 400);
    need(1);
    const first = bytes[pos++];
    const major = first >> 5;
    const info = first & 31;
    switch (major) {
      case 0: return length(info);
      case 1: return -1 - length(info);
      case 2: {
        const n = length(info);
        need(n);
        const v = bytes.slice(pos, pos + n);
        pos += n;
        return v;
      }
      case 3: {
        const n = length(info);
        need(n);
        let v;
        try { v = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(pos, pos + n)); }
        catch { throw new AdminAuthError("CBOR_TEXT_INVALID", 400); }
        pos += n;
        return v;
      }
      case 4: {
        const n = length(info);
        const list = [];
        for (let i = 0; i < n; i++) list.push(item(depth + 1));
        return list;
      }
      case 5: {
        const n = length(info);
        const map = new Map();
        for (let i = 0; i < n; i++) {
          const key = item(depth + 1);
          map.set(key, item(depth + 1));
        }
        return map;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new AdminAuthError("CBOR_UNSUPPORTED", 400);
      default:
        throw new AdminAuthError("CBOR_UNSUPPORTED", 400);
    }
  };
  const value = item(0);
  return { value, offset: pos };
}

// --------------------------------------------------------- Authenticator-Daten

export function parseAuthenticatorData(data) {
  if (!(data instanceof Uint8Array) || data.length < 37) throw new AdminAuthError("AUTH_DATA_INVALID", 400);
  const flags = data[32];
  const result = {
    rpIdHash: data.subarray(0, 32),
    flags,
    userPresent: Boolean(flags & 0x01),
    userVerified: Boolean(flags & 0x04),
    signCount: ((data[33] << 24) >>> 0) + (data[34] << 16) + (data[35] << 8) + data[36],
  };
  if (flags & 0x40) {
    if (data.length < 55) throw new AdminAuthError("AUTH_DATA_INVALID", 400);
    result.aaguid = data.subarray(37, 53);
    const idLength = (data[53] << 8) | data[54];
    if (idLength < 16 || idLength > 1023 || 55 + idLength > data.length) {
      throw new AdminAuthError("AUTH_DATA_INVALID", 400);
    }
    result.credentialId = data.subarray(55, 55 + idLength);
    const { value, offset } = decodeCbor(data, 55 + idLength);
    result.coseKey = value;
    // Nur Erweiterungen duerfen noch folgen, und nur wenn das ED-Bit sie ankuendigt.
    if (offset !== data.length && !(flags & 0x80)) throw new AdminAuthError("AUTH_DATA_INVALID", 400);
  }
  return result;
}

export function coseToJwk(cose) {
  if (!(cose instanceof Map)) throw new AdminAuthError("PASSKEY_KEY_INVALID", 400);
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (kty === 2 && alg === ALGORITHMS.ES256 && cose.get(-1) === 1) {
    const x = cose.get(-2);
    const y = cose.get(-3);
    if (!(x instanceof Uint8Array) || x.length !== 32 || !(y instanceof Uint8Array) || y.length !== 32) {
      throw new AdminAuthError("PASSKEY_KEY_INVALID", 400);
    }
    return { alg, jwk: { kty: "EC", crv: "P-256", x: base64url(x), y: base64url(y) } };
  }
  if (kty === 3 && alg === ALGORITHMS.RS256) {
    const n = cose.get(-1);
    const e = cose.get(-2);
    // Mindestens 2048 Bit - kuerzere RSA-Schluessel lassen wir nicht zu.
    if (!(n instanceof Uint8Array) || n.length < 256 || !(e instanceof Uint8Array) || e.length < 1 || e.length > 8) {
      throw new AdminAuthError("PASSKEY_KEY_INVALID", 400);
    }
    return { alg, jwk: { kty: "RSA", n: base64url(n), e: base64url(e) } };
  }
  throw new AdminAuthError("PASSKEY_ALGORITHM_UNSUPPORTED", 400);
}

async function importPublicKey(alg, jwk) {
  try {
    if (alg === ALGORITHMS.ES256) {
      return await crypto.subtle.importKey("jwk", { ...jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    }
    if (alg === ALGORITHMS.RS256) {
      return await crypto.subtle.importKey("jwk", { ...jwk, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    }
  } catch {
    throw new AdminAuthError("PASSKEY_KEY_INVALID", 400);
  }
  throw new AdminAuthError("PASSKEY_ALGORITHM_UNSUPPORTED", 400);
}

// ECDSA-Unterschriften kommen als ASN.1-DER; WebCrypto erwartet r||s mit je 32 Byte.
export function derToRawSignature(sig) {
  let p = 0;
  const fail = () => { throw new AdminAuthError("SIGNATURE_INVALID", 401); };
  if (!(sig instanceof Uint8Array) || sig.length < 8 || sig[p++] !== 0x30) fail();
  let total = sig[p++];
  if (total & 0x80) {
    if ((total & 0x7f) !== 1) fail();
    total = sig[p++];
  }
  if (p + total !== sig.length) fail();
  const integer = () => {
    if (sig[p++] !== 0x02) fail();
    const len = sig[p++];
    if (!len || len > 33 || p + len > sig.length) fail();
    let value = sig.subarray(p, p + len);
    p += len;
    while (value.length > 32 && value[0] === 0) value = value.subarray(1);
    if (value.length > 32) fail();
    const out = new Uint8Array(32);
    out.set(value, 32 - value.length);
    return out;
  };
  const r = integer();
  const s = integer();
  if (p !== sig.length) fail();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

async function verifySignature(alg, jwk, signature, signedData) {
  const key = await importPublicKey(alg, jwk);
  if (alg === ALGORITHMS.ES256) {
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRawSignature(signature), signedData);
  }
  return crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, signature, signedData);
}

function readClientData(bytes) {
  try {
    const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!data || typeof data !== "object") throw new Error("kein Objekt");
    return data;
  } catch {
    throw new AdminAuthError("CLIENT_DATA_INVALID", 400);
  }
}

// ------------------------------------------------------------- Konfiguration

function maxPasskeys(env) {
  const configured = Number(env?.ADMIN_MAX_PASSKEYS);
  return Number.isInteger(configured) && configured >= 1 && configured <= 10 ? configured : DEFAULT_MAX_PASSKEYS;
}

function sessionHours(env) {
  const configured = Number(env?.ADMIN_SESSION_HOURS);
  return Number.isFinite(configured) && configured >= 1 && configured <= 168 ? configured : DEFAULT_SESSION_HOURS;
}

function requireDb(env) {
  if (!env?.DB) throw new AdminAuthError("ADMIN_DATABASE_NOT_CONFIGURED", 503);
  return env.DB;
}

function isLive(env) {
  return String(env?.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase() === "live";
}

// Vor Migration 0014 gibt es die Tabellen noch nicht - dann existiert auch
// kein Passkey, und alles bleibt wie vorher. Jeder andere Datenbankfehler
// wird weitergereicht: lieber keine Anmeldung als eine versehentlich offene Tuer.
function isMissingTable(err) {
  return /no such table/i.test(String(err?.message || err || ""));
}

export async function activePasskeyCount(env) {
  if (!env?.DB || typeof env.DB.prepare !== "function") return 0;
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS anzahl FROM admin_passkeys WHERE revoked_at IS NULL").first();
    return Number(row?.anzahl || 0);
  } catch (err) {
    if (isMissingTable(err)) return 0;
    throw err;
  }
}

// ------------------------------------------------------------------ Sitzungen

function cookieValue(request, name) {
  const header = String(request.headers.get("Cookie") || "");
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function sessionCookie(token, maxAgeSeconds) {
  // Path=/admin: der Browser schickt das Cookie nie an Kasse oder Konto.
  // SameSite=Strict + Origin-Pruefung: fremde Seiten koennen es nicht benutzen.
  return [
    `${ADMIN_SESSION_COOKIE}=${token}`,
    "Path=/admin",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.trunc(maxAgeSeconds))}`,
  ].join("; ");
}

/**
 * Die Admin-Sitzung dieser Anfrage oder null. Gilt nur, wenn die Anfrage von
 * einer Admin-Seite kommt: Das Cookie ist SameSite=Strict, aber "same site"
 * umfasst alle Subdomains - ohne diese Pruefung koennte ein Skript auf der
 * oeffentlichen Shop-Seite es mitbenutzen.
 */
export async function resolveAdminSession(request, env) {
  const token = cookieValue(request, ADMIN_SESSION_COOKIE);
  if (!token || !env?.DB || typeof env.DB.prepare !== "function") return null;
  try {
    return await lookupSession(request, env, token);
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

async function lookupSession(request, env, token) {
  const origin = request.headers.get("Origin");
  if (!origin || !PASSKEY_ORIGINS[origin]) return null;
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && fetchSite !== "same-site" && fetchSite !== "same-origin") return null;
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const id = hex(await sha256(token));
  const row = await env.DB.prepare(`SELECT s.id,s.passkey_id,s.expires_at,s.last_seen_at,p.name
      FROM admin_sessions s JOIN admin_passkeys p ON p.id=s.passkey_id
      WHERE s.id=? AND s.revoked_at IS NULL AND p.revoked_at IS NULL LIMIT 1`).bind(id).first();
  if (!row || new Date(String(row.expires_at)).getTime() <= Date.now()) return null;
  const now = Date.now();
  const lastSeen = new Date(String(row.last_seen_at || 0)).getTime();
  if (!Number.isFinite(lastSeen) || now - lastSeen > 5 * 60_000) {
    try {
      await env.DB.prepare("UPDATE admin_sessions SET last_seen_at=? WHERE id=?").bind(new Date(now).toISOString(), id).run();
    } catch { /* reine Statistik */ }
  }
  return { sessionId: id, passkeyId: String(row.passkey_id), passkeyName: String(row.name || "") };
}

async function createSession(env, passkeyId) {
  const token = base64url(randomBytes(32));
  const now = new Date();
  const expires = new Date(now.getTime() + sessionHours(env) * 3_600_000);
  await env.DB.prepare(`INSERT INTO admin_sessions (id,passkey_id,created_at,expires_at,last_seen_at)
    VALUES (?,?,?,?,?)`).bind(hex(await sha256(token)), passkeyId, now.toISOString(), expires.toISOString(), now.toISOString()).run();
  return { token, expiresAt: expires.toISOString(), maxAge: sessionHours(env) * 3600 };
}

// ------------------------------------------------------------------- Ablaeufe

function rpIdFor(origin) {
  const rpId = origin ? PASSKEY_ORIGINS[origin] : null;
  if (!rpId) throw new AdminAuthError("ORIGIN_NOT_ALLOWED", 403);
  return rpId;
}

async function issueChallenge(env, purpose, origin, grant = null) {
  const db = requireDb(env);
  const challenge = base64url(randomBytes(32));
  const now = new Date();
  // Abgelaufene Challenges gleich mit wegraeumen - die Tabelle bleibt klein.
  await db.prepare("DELETE FROM admin_auth_challenges WHERE expires_at<?").bind(now.toISOString()).run();
  await db.prepare(`INSERT INTO admin_auth_challenges (id,purpose,rp_id,origin,grant_ref,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?)`).bind(
    challenge, purpose, rpIdFor(origin), origin, grant, now.toISOString(),
    new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
  ).run();
  return challenge;
}

// Einmal benutzen, sofort: auch eine fehlgeschlagene Pruefung verbraucht die
// Challenge. Eine abgefangene Antwort laesst sich so nie wiederholen.
async function consumeChallenge(env, challenge, purpose, origin) {
  const db = requireDb(env);
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(challenge || ""))) throw new AdminAuthError("CHALLENGE_INVALID", 401);
  const row = await db.prepare(`SELECT id,purpose,rp_id,origin,grant_ref,expires_at,used_at
    FROM admin_auth_challenges WHERE id=? LIMIT 1`).bind(challenge).first();
  if (!row || row.purpose !== purpose || row.used_at) throw new AdminAuthError("CHALLENGE_INVALID", 401);
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) throw new AdminAuthError("CHALLENGE_EXPIRED", 401);
  if (row.origin !== origin) throw new AdminAuthError("ORIGIN_MISMATCH", 401);
  const claimed = await db.prepare("UPDATE admin_auth_challenges SET used_at=? WHERE id=? AND used_at IS NULL")
    .bind(new Date().toISOString(), challenge).run();
  if (!claimed?.meta?.changes) throw new AdminAuthError("CHALLENGE_INVALID", 401);
  return row;
}

function bearerToken(request) {
  const match = String(request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function normalizePairingCode(raw) {
  // Crockford-Base32: O liest sich wie 0, I und L wie 1 - Tippfehler verzeihen.
  return String(raw || "").toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function newPairingCode() {
  // 60 Zufallsbits in 12 Zeichen - bei zehn Minuten Gueltigkeit und
  // Ratenbegrenzung nicht zu erraten.
  const bytes = randomBytes(8);
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let code = "";
  for (let i = 0; i < 12; i++) code += CROCKFORD[Number((bits >> BigInt(i * 5)) & 31n)];
  return code;
}

function formatPairingCode(code) {
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

// Wer darf gerade ein Geraet freischalten? Gibt den Grund als Kurzform zurueck,
// der an der Challenge haengt: "setup" oder "pairing:<id>".
async function registrationGrant(request, env, body) {
  const db = requireDb(env);
  const active = await activePasskeyCount(env);
  if (active >= maxPasskeys(env)) throw new AdminAuthError("PASSKEY_LIMIT_REACHED", 409);

  const pairing = normalizePairingCode(body?.pairingCode);
  if (pairing) {
    if (!/^[0-9A-HJKMNP-TV-Z]{12}$/.test(pairing)) throw new AdminAuthError("PAIRING_CODE_INVALID", 401);
    const id = hex(await sha256(pairing));
    const row = await db.prepare(`SELECT id,expires_at,used_at FROM admin_pairing_codes WHERE id=? LIMIT 1`).bind(id).first();
    if (!row || row.used_at || new Date(String(row.expires_at)).getTime() <= Date.now()) {
      throw new AdminAuthError("PAIRING_CODE_INVALID", 401);
    }
    return `pairing:${id}`;
  }

  // Der Token oeffnet nur die allererste Tuer.
  if (active > 0) throw new AdminAuthError("PAIRING_CODE_REQUIRED", 401);
  if (!env.ADMIN_WRITE_TOKEN || !(await sameSecret(bearerToken(request), env.ADMIN_WRITE_TOKEN))) {
    throw new AdminAuthError("SETUP_TOKEN_INVALID", 401);
  }
  return "setup";
}

async function registrationOptions(request, env, origin, body) {
  const grant = await registrationGrant(request, env, body);
  const challenge = await issueChallenge(env, "register", origin, grant);
  const existing = await env.DB.prepare("SELECT id FROM admin_passkeys WHERE revoked_at IS NULL").all();
  return {
    challenge,
    rp: { id: rpIdFor(origin), name: RP_NAME },
    user: { id: base64url(new TextEncoder().encode(USER_HANDLE)), name: "admin", displayName: RP_NAME },
    pubKeyCredParams: [
      { type: "public-key", alg: ALGORITHMS.ES256 },
      { type: "public-key", alg: ALGORITHMS.RS256 },
    ],
    timeout: CHALLENGE_TTL_MS,
    attestation: "none",
    authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
    // Dasselbe Geraet zweimal anzulegen fuellt nur einen Platz.
    excludeCredentials: (existing?.results || []).map(row => ({ type: "public-key", id: String(row.id) })),
  };
}

function deviceName(raw) {
  const name = safeText(String(raw || "").replace(/[\u0000-\u001f<>]/g, ""), 40).trim();
  return name || "Gerät";
}

async function verifyRegistration(env, origin, body, reqId) {
  const db = requireDb(env);
  const credential = body?.credential || {};
  const clientDataBytes = fromBase64url(credential?.response?.clientDataJSON, "CLIENT_DATA_INVALID");
  const clientData = readClientData(clientDataBytes);
  if (clientData.type !== "webauthn.create") throw new AdminAuthError("CLIENT_DATA_INVALID", 400);
  const record = await consumeChallenge(env, clientData.challenge, "register", origin);
  if (clientData.origin !== origin || clientData.crossOrigin === true) throw new AdminAuthError("ORIGIN_MISMATCH", 401);

  const attestation = decodeCbor(fromBase64url(credential?.response?.attestationObject, "ATTESTATION_INVALID")).value;
  if (!(attestation instanceof Map) || !(attestation.get("authData") instanceof Uint8Array)) {
    throw new AdminAuthError("ATTESTATION_INVALID", 400);
  }
  // Wir verlangen attestation "none": Welches Modell das Geraet ist, spielt
  // keine Rolle - entscheidend ist, wer die Freischaltung erlaubt hat.
  const auth = parseAuthenticatorData(attestation.get("authData"));
  if (!sameBytes(auth.rpIdHash, await sha256(record.rp_id))) throw new AdminAuthError("RP_ID_MISMATCH", 401);
  if (!auth.userPresent || !auth.userVerified) throw new AdminAuthError("USER_VERIFICATION_REQUIRED", 401);
  if (!auth.credentialId || !auth.coseKey) throw new AdminAuthError("ATTESTATION_INVALID", 400);
  const credentialId = base64url(auth.credentialId);
  if (credential.id !== credentialId || credential.rawId !== credentialId) throw new AdminAuthError("CREDENTIAL_ID_MISMATCH", 400);

  const { alg, jwk } = coseToJwk(auth.coseKey);
  await importPublicKey(alg, jwk); // ein ungueltiger Punkt faellt hier auf, nicht erst beim Anmelden

  // Grund der Freischaltung erneut pruefen - zwischen Optionen und Antwort
  // kann ein anderes Geraet den letzten Platz belegt haben.
  const active = await activePasskeyCount(env);
  if (active >= maxPasskeys(env)) throw new AdminAuthError("PASSKEY_LIMIT_REACHED", 409);
  if (record.grant_ref === "setup") {
    if (active > 0) throw new AdminAuthError("PAIRING_CODE_REQUIRED", 401);
  } else if (String(record.grant_ref || "").startsWith("pairing:")) {
    const used = await db.prepare(`UPDATE admin_pairing_codes SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?`)
      .bind(new Date().toISOString(), String(record.grant_ref).slice(8), new Date().toISOString()).run();
    if (!used?.meta?.changes) throw new AdminAuthError("PAIRING_CODE_INVALID", 401);
  } else {
    throw new AdminAuthError("REGISTRATION_NOT_ALLOWED", 401);
  }

  const name = deviceName(body?.name);
  const now = new Date().toISOString();
  try {
    await db.prepare(`INSERT INTO admin_passkeys
      (id,name,rp_id,public_key_jwk,algorithm,sign_count,aaguid,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).bind(
      credentialId, name, record.rp_id, JSON.stringify(jwk), alg, auth.signCount, hex(auth.aaguid || new Uint8Array(16)), now,
    ).run();
  } catch {
    throw new AdminAuthError("PASSKEY_ALREADY_REGISTERED", 409);
  }

  await notifyOwner(env, [
    "DISORDER119 — NEUES ADMIN-GERÄT",
    `Gerät: ${name}`,
    `Zeit: ${now}`,
    "Warst du das nicht? Sofort in der Admin-App unter Geräte entfernen.",
  ].join("\n"), reqId);

  const session = await createSession(env, credentialId);
  return { passkeyId: credentialId, name, session };
}

async function loginOptions(env, origin) {
  const db = requireDb(env);
  const rpId = rpIdFor(origin);
  const challenge = await issueChallenge(env, "login", origin);
  const rows = await db.prepare("SELECT id FROM admin_passkeys WHERE revoked_at IS NULL AND rp_id=?").bind(rpId).all();
  return {
    challenge,
    rpId,
    timeout: CHALLENGE_TTL_MS,
    userVerification: "required",
    allowCredentials: (rows?.results || []).map(row => ({ type: "public-key", id: String(row.id) })),
  };
}

async function verifyLogin(env, origin, body, reqId) {
  const db = requireDb(env);
  const credential = body?.credential || {};
  const clientDataBytes = fromBase64url(credential?.response?.clientDataJSON, "CLIENT_DATA_INVALID");
  const clientData = readClientData(clientDataBytes);
  if (clientData.type !== "webauthn.get") throw new AdminAuthError("CLIENT_DATA_INVALID", 400);
  const record = await consumeChallenge(env, clientData.challenge, "login", origin);
  if (clientData.origin !== origin || clientData.crossOrigin === true) throw new AdminAuthError("ORIGIN_MISMATCH", 401);

  const credentialId = String(credential.id || "");
  if (!/^[A-Za-z0-9_-]{16,1400}$/.test(credentialId) || credential.rawId !== credentialId) {
    throw new AdminAuthError("PASSKEY_UNKNOWN", 401);
  }
  const passkey = await db.prepare(`SELECT id,name,rp_id,public_key_jwk,algorithm,sign_count
    FROM admin_passkeys WHERE id=? AND revoked_at IS NULL LIMIT 1`).bind(credentialId).first();
  if (!passkey || passkey.rp_id !== record.rp_id) throw new AdminAuthError("PASSKEY_UNKNOWN", 401);

  const authBytes = fromBase64url(credential?.response?.authenticatorData, "AUTH_DATA_INVALID");
  const auth = parseAuthenticatorData(authBytes);
  if (!sameBytes(auth.rpIdHash, await sha256(record.rp_id))) throw new AdminAuthError("RP_ID_MISMATCH", 401);
  if (!auth.userPresent || !auth.userVerified) throw new AdminAuthError("USER_VERIFICATION_REQUIRED", 401);

  const signed = new Uint8Array(authBytes.length + 32);
  signed.set(authBytes, 0);
  signed.set(await sha256(clientDataBytes), authBytes.length);
  const signature = fromBase64url(credential?.response?.signature, "SIGNATURE_INVALID");
  let jwk;
  try { jwk = JSON.parse(passkey.public_key_jwk); } catch { throw new AdminAuthError("PASSKEY_KEY_INVALID", 500); }
  if (!(await verifySignature(Number(passkey.algorithm), jwk, signature, signed))) {
    throw new AdminAuthError("SIGNATURE_INVALID", 401);
  }

  // Zaehler: Geraete mit festem Schluessel zaehlen hoch. Geht er zurueck,
  // wurde der Schluessel womoeglich kopiert. Synchronisierte Passkeys
  // (iCloud-Schluesselbund) melden immer 0 - dann gibt es nichts zu pruefen.
  const stored = Number(passkey.sign_count || 0);
  if ((auth.signCount > 0 || stored > 0) && auth.signCount <= stored) {
    throw new AdminAuthError("PASSKEY_COUNTER_ROLLBACK", 401);
  }
  const now = new Date().toISOString();
  await db.prepare("UPDATE admin_passkeys SET sign_count=?,last_used_at=? WHERE id=?")
    .bind(auth.signCount, now, credentialId).run();

  await notifyOwner(env, [
    "DISORDER119 — ADMIN-ANMELDUNG",
    `Gerät: ${passkey.name}`,
    `Zeit: ${now}`,
  ].join("\n"), reqId);

  const session = await createSession(env, credentialId);
  return { passkeyId: credentialId, name: String(passkey.name), session };
}

async function notifyOwner(env, text, reqId) {
  // Eine fehlende Telegram-Verbindung darf keine Anmeldung verhindern.
  try { await sendTelegramMessage(env, text, reqId); } catch { /* bewusst still */ }
}

async function createPairing(env, session) {
  const db = requireDb(env);
  const active = await activePasskeyCount(env);
  if (active >= maxPasskeys(env)) throw new AdminAuthError("PASSKEY_LIMIT_REACHED", 409);
  const code = newPairingCode();
  const now = new Date();
  // Nur ein offener Code auf einmal.
  await db.prepare("DELETE FROM admin_pairing_codes WHERE used_at IS NULL").run();
  const expires = new Date(now.getTime() + PAIRING_TTL_MS).toISOString();
  await db.prepare(`INSERT INTO admin_pairing_codes (id,created_by_passkey,created_at,expires_at)
    VALUES (?,?,?,?)`).bind(hex(await sha256(code)), session.passkeyId, now.toISOString(), expires).run();
  return { code: formatPairingCode(code), expiresAt: expires };
}

async function listPasskeys(env, session) {
  const rows = await requireDb(env).prepare(`SELECT id,name,created_at,last_used_at FROM admin_passkeys
    WHERE revoked_at IS NULL ORDER BY created_at`).all();
  return (rows?.results || []).map(row => ({
    id: String(row.id),
    name: String(row.name || ""),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
    current: String(row.id) === session.passkeyId,
  }));
}

async function revokePasskey(env, id, reqId) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  const row = await db.prepare("SELECT name FROM admin_passkeys WHERE id=? AND revoked_at IS NULL").bind(id).first();
  if (!row) throw new AdminAuthError("PASSKEY_UNKNOWN", 404);
  await db.batch([
    db.prepare("UPDATE admin_passkeys SET revoked_at=? WHERE id=? AND revoked_at IS NULL").bind(now, id),
    db.prepare("UPDATE admin_sessions SET revoked_at=? WHERE passkey_id=? AND revoked_at IS NULL").bind(now, id),
  ]);
  await notifyOwner(env, `DISORDER119 — ADMIN-GERÄT ENTFERNT\nGerät: ${row.name}\nZeit: ${now}`, reqId);
}

// -------------------------------------------------------------------- Routen

export function isAdminAuthRoute(url) {
  return url.pathname === "/admin/auth" || url.pathname.startsWith("/admin/auth/");
}

function headers(origin, extra = {}) {
  const out = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    Vary: "Origin",
    ...extra,
  };
  if (origin && PASSKEY_ORIGINS[origin]) {
    out["Access-Control-Allow-Origin"] = origin;
    out["Access-Control-Allow-Credentials"] = "true";
    out["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS";
    out["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    out["Access-Control-Max-Age"] = "600";
  }
  return out;
}

function reply(data, status, origin, extra) {
  return new Response(JSON.stringify(data), { status, headers: headers(origin, extra) });
}

async function readBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

async function rateLimit(request, env) {
  if (!env.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== "function") {
    // Im Livebetrieb nie ohne Bremse: lieber gar keine Anmeldung.
    if (isLive(env)) throw new AdminAuthError("LIVE_BACKEND_NOT_READY", 503);
    return;
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const result = await env.RATE_LIMITER.limit({ key: `admin-auth:${ip}` });
  if (result && result.success === false) throw new AdminAuthError("RATE_LIMITED", 429);
}

export async function handleAdminAuth(request, env, url, reqId = crypto.randomUUID()) {
  const origin = request.headers.get("Origin");
  try {
    if (request.method === "OPTIONS") {
      if (!origin || !PASSKEY_ORIGINS[origin]) return new Response(null, { status: 403, headers: headers(null) });
      return new Response(null, { status: 204, headers: headers(origin) });
    }
    // Jede Anmelde-Route nur von einer Admin-Seite aus - nie von der Shop-Seite
    // und nie ohne Origin (etwa ein Skript mit gestohlenem Cookie).
    if (!origin || !PASSKEY_ORIGINS[origin]) throw new AdminAuthError("ORIGIN_NOT_ALLOWED", 403);
    const path = url.pathname.replace(/\/+$/, "");
    await rateLimit(request, env);

    if (path === "/admin/auth/status" && request.method === "GET") {
      const session = await resolveAdminSession(request, env);
      const active = await activePasskeyCount(env);
      return reply({
        ok: true,
        loggedIn: Boolean(session),
        device: session ? session.passkeyName : null,
        setupRequired: active === 0,
      }, 200, origin);
    }

    if (path === "/admin/auth/register/options" && request.method === "POST") {
      const body = await readBody(request);
      return reply({ ok: true, publicKey: await registrationOptions(request, env, origin, body) }, 200, origin);
    }

    if (path === "/admin/auth/register/verify" && request.method === "POST") {
      const body = await readBody(request);
      const result = await verifyRegistration(env, origin, body, reqId);
      return reply({ ok: true, device: result.name, expiresAt: result.session.expiresAt }, 200, origin, {
        "Set-Cookie": sessionCookie(result.session.token, result.session.maxAge),
      });
    }

    if (path === "/admin/auth/login/options" && request.method === "POST") {
      return reply({ ok: true, publicKey: await loginOptions(env, origin) }, 200, origin);
    }

    if (path === "/admin/auth/login/verify" && request.method === "POST") {
      const body = await readBody(request);
      const result = await verifyLogin(env, origin, body, reqId);
      return reply({ ok: true, device: result.name, expiresAt: result.session.expiresAt }, 200, origin, {
        "Set-Cookie": sessionCookie(result.session.token, result.session.maxAge),
      });
    }

    // Ab hier nur mit gueltiger Sitzung.
    const session = await resolveAdminSession(request, env);
    if (!session) throw new AdminAuthError("NOT_AUTHENTICATED", 401);

    if (path === "/admin/auth/logout" && request.method === "POST") {
      await env.DB.prepare("UPDATE admin_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL")
        .bind(new Date().toISOString(), session.sessionId).run();
      return reply({ ok: true }, 200, origin, { "Set-Cookie": sessionCookie("", 0) });
    }

    if (path === "/admin/auth/pairing" && request.method === "POST") {
      return reply({ ok: true, ...(await createPairing(env, session)) }, 200, origin);
    }

    if (path === "/admin/auth/passkeys" && request.method === "GET") {
      return reply({ ok: true, maxDevices: maxPasskeys(env), passkeys: await listPasskeys(env, session) }, 200, origin);
    }

    const revokeMatch = /^\/admin\/auth\/passkeys\/([A-Za-z0-9_-]{16,1400})$/.exec(path);
    if (revokeMatch && request.method === "DELETE") {
      await revokePasskey(env, revokeMatch[1], reqId);
      const own = revokeMatch[1] === session.passkeyId;
      return reply({ ok: true, signedOut: own }, 200, origin, own ? { "Set-Cookie": sessionCookie("", 0) } : {});
    }

    throw new AdminAuthError("NOT_FOUND", 404);
  } catch (err) {
    if (err instanceof AdminAuthError) return reply({ error: err.code, requestId: reqId }, err.status, origin);
    console.error(JSON.stringify({
      level: "error",
      event: "admin_auth_failed",
      requestId: reqId,
      message: safeText(err?.message || "unknown", 160),
    }));
    return reply({ error: "INTERNAL_AUTH_ERROR", requestId: reqId }, 500, origin);
  }
}
