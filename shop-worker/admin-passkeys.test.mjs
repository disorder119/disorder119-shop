import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_SESSION_COOKIE,
  decodeCbor,
  derToRawSignature,
  handleAdminAuth,
  resolveAdminSession,
} from "./admin-passkeys.js";
import { authorizeAdminRequest } from "./backend-runtime.js";
import workerEntry from "./worker-entry.js";
import { sqliteD1 } from "./test-d1.mjs";

const ADMIN = "https://admin.disorder119.com";
const SETUP_TOKEN = "setup-token-3f9c1d7e2b8a4c6d";

// ------------------------------------------------------- Hilfen fuer die Tests

const utf8 = text => new TextEncoder().encode(text);

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function fromB64url(text) {
  return new Uint8Array(Buffer.from(text, "base64url"));
}

async function sha(data) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", typeof data === "string" ? utf8(data) : data));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function cbor(value) {
  const out = [];
  const head = (major, n) => {
    if (n < 24) out.push((major << 5) | n);
    else if (n < 256) out.push((major << 5) | 24, n);
    else if (n < 65536) out.push((major << 5) | 25, n >> 8, n & 255);
    else out.push((major << 5) | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
  };
  const encode = v => {
    if (typeof v === "number") { if (v >= 0) head(0, v); else head(1, -1 - v); return; }
    if (v instanceof Uint8Array) { head(2, v.length); for (const b of v) out.push(b); return; }
    if (typeof v === "string") { const b = utf8(v); head(3, b.length); for (const x of b) out.push(x); return; }
    if (Array.isArray(v)) { head(4, v.length); v.forEach(encode); return; }
    if (v instanceof Map) { head(5, v.size); for (const [k, x] of v) { encode(k); encode(x); } return; }
    if (v === false) { out.push(0xf4); return; }
    if (v === true) { out.push(0xf5); return; }
    if (v === null) { out.push(0xf6); return; }
    throw new Error("nicht kodierbar");
  };
  encode(value);
  return new Uint8Array(out);
}

// WebCrypto liefert ECDSA roh (r||s), Authenticatoren schicken DER.
function rawToDer(raw) {
  const integer = bytes => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v = [...bytes.slice(i)];
    if (v[0] & 0x80) v = [0, ...v];
    return [0x02, v.length, ...v];
  };
  const r = integer(raw.slice(0, 32));
  const s = integer(raw.slice(32));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

// Ein Software-Authenticator: erzeugt echte Schluessel und echte
// Unterschriften, genau wie Face ID oder Windows Hello - nur ohne Chip.
async function authenticator({ alg = -7, rpId = "admin.disorder119.com", counter = 0 } = {}) {
  let keys;
  let cose;
  if (alg === -7) {
    keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
    cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, fromB64url(jwk.x)], [-3, fromB64url(jwk.y)]]);
  } else {
    keys = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true, ["sign", "verify"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
    cose = new Map([[1, 3], [3, -257], [-1, fromB64url(jwk.n)], [-2, fromB64url(jwk.e)]]);
  }
  const credentialId = crypto.getRandomValues(new Uint8Array(32));
  const id = b64url(credentialId);
  const state = { counter };

  async function authData(flags, withCredential, rpOverride) {
    const count = new Uint8Array([(state.counter >>> 24) & 255, (state.counter >> 16) & 255, (state.counter >> 8) & 255, state.counter & 255]);
    const base = concat(await sha(rpOverride || rpId), new Uint8Array([flags]), count);
    if (!withCredential) return base;
    return concat(base, new Uint8Array(16), new Uint8Array([0, credentialId.length]), credentialId, cbor(cose));
  }

  return {
    id,
    state,
    async register(publicKey, origin, o = {}) {
      const clientData = utf8(JSON.stringify({
        type: o.type || "webauthn.create", challenge: publicKey.challenge, origin: o.origin || origin, crossOrigin: false,
      }));
      const data = await authData(o.flags ?? 0x45, true, o.rpId);
      const attestationObject = cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", data]]));
      return { id, rawId: id, type: "public-key", response: { clientDataJSON: b64url(clientData), attestationObject: b64url(attestationObject) } };
    },
    async login(publicKey, origin, o = {}) {
      if (o.counter !== undefined) state.counter = o.counter;
      else if (state.counter > 0) state.counter += 1;
      const clientData = utf8(JSON.stringify({
        type: o.type || "webauthn.get", challenge: publicKey.challenge, origin: o.origin || origin, crossOrigin: false,
      }));
      const data = await authData(o.flags ?? 0x05, false, o.rpId);
      const signed = concat(data, await sha(clientData));
      let signature;
      if (alg === -7) {
        signature = rawToDer(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, signed)));
      } else {
        signature = new Uint8Array(await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, keys.privateKey, signed));
      }
      if (o.tamper) signature[signature.length - 3] ^= 0x01;
      return {
        id, rawId: id, type: "public-key",
        response: { clientDataJSON: b64url(clientData), authenticatorData: b64url(data), signature: b64url(signature) },
      };
    },
  };
}

function freshEnv(extra = {}) {
  return {
    DB: sqliteD1(["migrations/0014_admin_passkeys.sql"]),
    ADMIN_WRITE_TOKEN: SETUP_TOKEN,
    ADMIN_READ_TOKEN: "read-token-8d2e6a1c4f9b3e7a",
    ...extra,
  };
}

function request(pathname, { method = "POST", body, origin = ADMIN, cookie, bearer, headers = {} } = {}) {
  const h = new Headers(headers);
  if (body !== undefined) h.set("Content-Type", "application/json");
  if (origin) h.set("Origin", origin);
  if (cookie) h.set("Cookie", cookie);
  if (bearer) h.set("Authorization", `Bearer ${bearer}`);
  return new Request(`https://api.disorder119.com${pathname}`, {
    method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(env, pathname, options) {
  const req = request(pathname, options);
  const response = await handleAdminAuth(req, env, new URL(req.url), "req-test");
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, setCookie: response.headers.get("Set-Cookie") || "", headers: response.headers };
}

const cookieOf = setCookie => setCookie.split(";")[0];

async function setupFirstDevice(env, options = {}) {
  const device = await authenticator(options);
  const opts = await call(env, "/admin/auth/register/options", { bearer: SETUP_TOKEN, body: {} });
  assert.equal(opts.status, 200, JSON.stringify(opts.data));
  const done = await call(env, "/admin/auth/register/verify", {
    body: { credential: await device.register(opts.data.publicKey, ADMIN), name: options.name || "Laptop" },
  });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  return { device, cookie: cookieOf(done.setCookie) };
}

async function login(env, device, overrides = {}) {
  const opts = await call(env, "/admin/auth/login/options", { body: {} });
  assert.equal(opts.status, 200);
  const assertion = await device.login(opts.data.publicKey, ADMIN, overrides);
  return call(env, "/admin/auth/login/verify", { body: { credential: assertion } });
}

// ------------------------------------------------------------------- Bausteine

test("CBOR decoding follows RFC 8949 and refuses what WebAuthn never sends", () => {
  const hexBytes = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
  assert.equal(decodeCbor(hexBytes("00")).value, 0);
  assert.equal(decodeCbor(hexBytes("17")).value, 23);
  assert.equal(decodeCbor(hexBytes("1818")).value, 24);
  assert.equal(decodeCbor(hexBytes("190100")).value, 256);
  assert.equal(decodeCbor(hexBytes("1a000f4240")).value, 1000000);
  assert.equal(decodeCbor(hexBytes("20")).value, -1);
  assert.equal(decodeCbor(hexBytes("3863")).value, -100);
  assert.deepEqual([...decodeCbor(hexBytes("43010203")).value], [1, 2, 3]);
  assert.equal(decodeCbor(hexBytes("6449455446")).value, "IETF");
  assert.deepEqual(decodeCbor(hexBytes("83010203")).value, [1, 2, 3]);
  assert.deepEqual([...decodeCbor(hexBytes("a201020304")).value.entries()], [[1, 2], [3, 4]]);
  assert.equal(decodeCbor(hexBytes("f5")).value, true);
  for (const bad of ["9f", "c074", "4301", "fb3ff199999999999a", "7fff"]) {
    assert.throws(() => decodeCbor(hexBytes(bad)), err => err.code && err.code.startsWith("CBOR_"), bad);
  }
});

test("DER signatures convert to the raw form WebCrypto verifies", async () => {
  for (let i = 0; i < 12; i++) {
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const data = crypto.getRandomValues(new Uint8Array(40));
    const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, data));
    assert.deepEqual([...derToRawSignature(rawToDer(raw))], [...raw]);
  }
  assert.throws(() => derToRawSignature(new Uint8Array([0x30, 0x02, 0x02, 0x00])), /SIGNATURE_INVALID/);
});

// ----------------------------------------------------------------- Ablaeufe

test("the first device is set up with the token and gets a strict session cookie", async () => {
  const env = freshEnv();
  const status = await call(env, "/admin/auth/status", { method: "GET" });
  assert.deepEqual(status.data, { ok: true, loggedIn: false, device: null, setupRequired: true });

  const { cookie } = await setupFirstDevice(env);
  assert.ok(cookie.startsWith(`${ADMIN_SESSION_COOKIE}=`));
  const after = await call(env, "/admin/auth/status", { method: "GET", cookie });
  assert.deepEqual(after.data, { ok: true, loggedIn: true, device: "Laptop", setupRequired: false });

  // Nur Abdruecke in der Datenbank - der Cookie-Wert selbst steht nirgends.
  const token = cookie.split("=")[1];
  const rows = env.DB.raw.prepare("SELECT id FROM admin_sessions").all();
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].id, token);
});

test("the session cookie is HttpOnly, Secure, SameSite=Strict and limited to /admin", async () => {
  const env = freshEnv();
  const device = await authenticator();
  const opts = await call(env, "/admin/auth/register/options", { bearer: SETUP_TOKEN, body: {} });
  const done = await call(env, "/admin/auth/register/verify", { body: { credential: await device.register(opts.data.publicKey, ADMIN), name: "Laptop" } });
  for (const part of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/admin", "Max-Age=43200"]) {
    assert.ok(done.setCookie.includes(part), `${part} fehlt: ${done.setCookie}`);
  }
  assert.equal(done.headers.get("Access-Control-Allow-Credentials"), "true");
  assert.equal(done.headers.get("Access-Control-Allow-Origin"), ADMIN);
});

test("face-id style login works for ES256 and Windows-Hello style RS256 keys", async () => {
  for (const alg of [-7, -257]) {
    const env = freshEnv();
    const { device } = await setupFirstDevice(env, { alg });
    const result = await login(env, device);
    assert.equal(result.status, 200, `${alg}: ${JSON.stringify(result.data)}`);
    assert.equal(result.data.device, "Laptop");
    const session = await resolveAdminSession(request("/admin/ping", { method: "GET", cookie: cookieOf(result.setCookie) }), env);
    assert.equal(session.passkeyName, "Laptop");
  }
});

test("the setup token opens only the very first door", async () => {
  const env = freshEnv();
  const wrong = await call(env, "/admin/auth/register/options", { bearer: "falsch", body: {} });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error, "SETUP_TOKEN_INVALID");
  const missing = await call(env, "/admin/auth/register/options", { body: {} });
  assert.equal(missing.data.error, "SETUP_TOKEN_INVALID");

  await setupFirstDevice(env);
  // Mit dem richtigen Token, aber es gibt schon ein Geraet: abgelehnt.
  const again = await call(env, "/admin/auth/register/options", { bearer: SETUP_TOKEN, body: {} });
  assert.equal(again.status, 401);
  assert.equal(again.data.error, "PAIRING_CODE_REQUIRED");
});

test("a second device joins only with a pairing code from a signed-in device", async () => {
  const env = freshEnv();
  const { cookie } = await setupFirstDevice(env);

  const pairing = await call(env, "/admin/auth/pairing", { cookie, body: {} });
  assert.equal(pairing.status, 200);
  assert.match(pairing.data.code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);

  const phone = await authenticator();
  const typed = pairing.data.code.toLowerCase().replace(/-/g, " ");
  const opts = await call(env, "/admin/auth/register/options", { body: { pairingCode: typed } });
  assert.equal(opts.status, 200, JSON.stringify(opts.data));
  assert.equal(opts.data.publicKey.excludeCredentials.length, 1, "das erste Geraet darf nicht doppelt angelegt werden");
  const done = await call(env, "/admin/auth/register/verify", {
    body: { credential: await phone.register(opts.data.publicKey, ADMIN), name: "iPhone" },
  });
  assert.equal(done.status, 200, JSON.stringify(done.data));

  // Zwei Geraete: voll. Weder Code noch Token schalten ein drittes frei.
  const third = await call(env, "/admin/auth/pairing", { cookie, body: {} });
  assert.equal(third.status, 409);
  assert.equal(third.data.error, "PASSKEY_LIMIT_REACHED");
  const token = await call(env, "/admin/auth/register/options", { bearer: SETUP_TOKEN, body: {} });
  assert.equal(token.data.error, "PASSKEY_LIMIT_REACHED");
});

test("a pairing code works once and not after it expired", async () => {
  const env = freshEnv({ ADMIN_MAX_PASSKEYS: "3" });
  const { cookie } = await setupFirstDevice(env);
  const pairing = await call(env, "/admin/auth/pairing", { cookie, body: {} });

  const first = await authenticator();
  const opts = await call(env, "/admin/auth/register/options", { body: { pairingCode: pairing.data.code } });
  await call(env, "/admin/auth/register/verify", { body: { credential: await first.register(opts.data.publicKey, ADMIN), name: "iPhone" } });
  const reused = await call(env, "/admin/auth/register/options", { body: { pairingCode: pairing.data.code } });
  assert.equal(reused.data.error, "PAIRING_CODE_INVALID");

  const fresh = await call(env, "/admin/auth/pairing", { cookie, body: {} });
  env.DB.raw.prepare("UPDATE admin_pairing_codes SET expires_at=?").run(new Date(Date.now() - 1000).toISOString());
  const expired = await call(env, "/admin/auth/register/options", { body: { pairingCode: fresh.data.code } });
  assert.equal(expired.data.error, "PAIRING_CODE_INVALID");
});

test("a recorded login cannot be replayed", async () => {
  const env = freshEnv();
  const { device } = await setupFirstDevice(env);
  const opts = await call(env, "/admin/auth/login/options", { body: {} });
  const assertion = await device.login(opts.data.publicKey, ADMIN);
  const first = await call(env, "/admin/auth/login/verify", { body: { credential: assertion } });
  assert.equal(first.status, 200);
  const replay = await call(env, "/admin/auth/login/verify", { body: { credential: assertion } });
  assert.equal(replay.status, 401);
  assert.equal(replay.data.error, "CHALLENGE_INVALID");
});

test("forged, foreign and unverified logins are refused", async () => {
  const env = freshEnv();
  const { device } = await setupFirstDevice(env);
  const cases = [
    [{ tamper: true }, "SIGNATURE_INVALID"],
    [{ rpId: "admin.disorder119.com.evil.example" }, "RP_ID_MISMATCH"],
    [{ origin: "https://disorder119.com" }, "ORIGIN_MISMATCH"],
    [{ flags: 0x01 }, "USER_VERIFICATION_REQUIRED"],
    [{ type: "webauthn.create" }, "CLIENT_DATA_INVALID"],
  ];
  for (const [overrides, code] of cases) {
    const result = await login(env, device, overrides);
    assert.equal(result.data.error, code, JSON.stringify(overrides));
    assert.equal(result.setCookie, "");
  }
  const stranger = await authenticator();
  const foreign = await login(env, stranger);
  assert.equal(foreign.data.error, "PASSKEY_UNKNOWN");
});

test("the auth routes answer only to the admin page itself", async () => {
  const env = freshEnv();
  for (const origin of ["https://disorder119.com", "https://evil.example", null]) {
    const result = await call(env, "/admin/auth/login/options", { body: {}, origin });
    assert.equal(result.status, 403, String(origin));
    assert.equal(result.headers.get("Access-Control-Allow-Origin"), null);
  }
});

test("a session is only honoured from an admin page, never from the shop", async () => {
  const env = freshEnv();
  const { cookie } = await setupFirstDevice(env);
  const good = await resolveAdminSession(request("/admin/orders", { method: "GET", cookie }), env);
  assert.ok(good);
  // Gleiche Site (disorder119.com), anderes Origin: ein Skript auf der
  // Shop-Seite darf das Cookie nicht mitbenutzen.
  assert.equal(await resolveAdminSession(request("/admin/orders", { method: "GET", cookie, origin: "https://disorder119.com" }), env), null);
  assert.equal(await resolveAdminSession(request("/admin/orders", { method: "GET", cookie, origin: null }), env), null);
  assert.equal(await resolveAdminSession(request("/admin/orders", {
    method: "GET", cookie, headers: { "Sec-Fetch-Site": "cross-site" },
  }), env), null);
});

test("a counter going backwards reveals a copied key", async () => {
  const env = freshEnv();
  const { device } = await setupFirstDevice(env, { counter: 5 });
  assert.equal((await login(env, device)).status, 200);
  const rollback = await login(env, device, { counter: 3 });
  assert.equal(rollback.data.error, "PASSKEY_COUNTER_ROLLBACK");
});

test("removing a device ends its sessions for good", async () => {
  const env = freshEnv();
  const { device: laptop, cookie: laptopCookie } = await setupFirstDevice(env);
  const pairing = await call(env, "/admin/auth/pairing", { cookie: laptopCookie, body: {} });
  const phone = await authenticator();
  const opts = await call(env, "/admin/auth/register/options", { body: { pairingCode: pairing.data.code } });
  const joined = await call(env, "/admin/auth/register/verify", { body: { credential: await phone.register(opts.data.publicKey, ADMIN), name: "iPhone" } });
  const phoneCookie = cookieOf(joined.setCookie);

  const list = await call(env, "/admin/auth/passkeys", { method: "GET", cookie: laptopCookie });
  assert.deepEqual(list.data.passkeys.map(p => [p.name, p.current]), [["Laptop", true], ["iPhone", false]]);

  const removed = await call(env, `/admin/auth/passkeys/${phone.id}`, { method: "DELETE", cookie: laptopCookie });
  assert.equal(removed.status, 200);
  assert.equal(await resolveAdminSession(request("/admin/orders", { method: "GET", cookie: phoneCookie }), env), null);
  assert.equal((await login(env, phone)).data.error, "PASSKEY_UNKNOWN");
  assert.equal((await login(env, laptop)).status, 200);
  assert.throws(
    () => env.DB.raw.prepare("UPDATE admin_passkeys SET revoked_at=NULL WHERE id=?").run(phone.id),
    /admin_passkey_revoke_is_final/,
  );
});

test("logout ends exactly this session", async () => {
  const env = freshEnv();
  const { cookie } = await setupFirstDevice(env);
  const out = await call(env, "/admin/auth/logout", { cookie, body: {} });
  assert.equal(out.status, 200);
  assert.ok(out.setCookie.includes("Max-Age=0"));
  assert.equal(await resolveAdminSession(request("/admin/orders", { method: "GET", cookie }), env), null);
});

test("every new device and every login is reported to Telegram", async () => {
  const messages = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api.telegram.org")) {
      messages.push(JSON.parse(init.body).text);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    return original(url, init);
  };
  try {
    const env = freshEnv({ TELEGRAM_BOT_TOKEN: "bot-test", TELEGRAM_CHAT_ID: "42" });
    const { device } = await setupFirstDevice(env);
    await login(env, device);
    assert.equal(messages.length, 2);
    assert.match(messages[0], /NEUES ADMIN-GERÄT[\s\S]*Laptop/);
    assert.match(messages[1], /ADMIN-ANMELDUNG[\s\S]*Laptop/);
  } finally {
    globalThis.fetch = original;
  }
});

test("before migration 0014 everything stays as it was, other database errors do not open doors", async () => {
  const withoutTables = { DB: sqliteD1([]), ADMIN_WRITE_TOKEN: SETUP_TOKEN, ADMIN_READ_TOKEN: "read-token-8d2e6a1c4f9b3e7a" };
  const bearer = await authorizeAdminRequest(request("/admin/orders", { method: "GET", bearer: SETUP_TOKEN }), withoutTables, "READER");
  assert.equal(bearer.role, "OWNER");
  assert.equal(await resolveAdminSession(request("/admin/orders", { method: "GET", cookie: `${ADMIN_SESSION_COOKIE}=${"a".repeat(43)}` }), withoutTables), null);

  const broken = {
    ...withoutTables,
    DB: { prepare() { return { bind() { return this; }, async first() { throw new Error("D1_ERROR: database is locked"); } }; } },
  };
  await assert.rejects(
    () => authorizeAdminRequest(request("/admin/orders", { method: "GET", bearer: SETUP_TOKEN }), broken, "READER"),
    /database is locked/,
  );
});

// ------------------------------------------------ Zusammenspiel mit dem Worker

test("once a device exists, the old admin token alone opens nothing", async () => {
  const env = freshEnv();
  const bearerBefore = await authorizeAdminRequest(request("/admin/orders", { method: "GET", bearer: SETUP_TOKEN }), env, "READER");
  assert.equal(bearerBefore.role, "OWNER");

  const { cookie } = await setupFirstDevice(env);
  await assert.rejects(
    () => authorizeAdminRequest(request("/admin/orders", { method: "GET", bearer: SETUP_TOKEN }), env, "READER"),
    err => err.code === "PASSKEY_REQUIRED" && err.status === 401,
  );
  const scripted = await authorizeAdminRequest(
    request("/admin/orders", { method: "GET", bearer: SETUP_TOKEN }), { ...env, ADMIN_BEARER_ENABLED: "true" }, "READER",
  );
  assert.equal(scripted.role, "OWNER");
  const viaSession = await authorizeAdminRequest(request("/admin/orders", { method: "GET", cookie }), env, "OWNER");
  assert.equal(viaSession.mode, "PASSKEY_SESSION");
});

test("the admin app reaches every admin module through its passkey session", async () => {
  const env = freshEnv();
  const { cookie } = await setupFirstDevice(env);

  const ping = await workerEntry.fetch(request("/admin/ping", { method: "GET", cookie }), env, {});
  assert.equal(ping.status, 200);
  assert.equal((await ping.json()).ok, true);
  assert.equal(ping.headers.get("Access-Control-Allow-Credentials"), "true");
  assert.equal(ping.headers.get("Access-Control-Allow-Origin"), ADMIN);

  const noSession = await workerEntry.fetch(request("/admin/ping", { method: "GET" }), env, {});
  assert.equal(noSession.status, 401);
  const fromShop = await workerEntry.fetch(request("/admin/ping", { method: "GET", cookie, origin: "https://disorder119.com" }), env, {});
  assert.equal(fromShop.status, 403);
  const oldToken = await workerEntry.fetch(request("/admin/ping", { method: "GET", bearer: SETUP_TOKEN }), env, {});
  assert.equal(oldToken.status, 401);
  assert.equal((await oldToken.json()).error, "PASSKEY_REQUIRED");
});
