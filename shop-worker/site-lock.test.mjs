import assert from "node:assert/strict";
import test from "node:test";

import { handleSiteLock, passAusstellen, passGueltig, passwortHash } from "./site-lock.js";

function fakeDb() {
  const tabelle = new Map();
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              const eintrag = tabelle.get(args[0]);
              return eintrag ? { value: eintrag } : null;
            },
            async run() {
              if (/INSERT INTO site_settings/.test(sql)) tabelle.set(args[0], args[1]);
              return { success: true };
            },
          };
        },
      };
    },
  };
}

const adminEnv = db => ({ DB: db, ADMIN_TOKEN: "sitzung-123" });
const adminPost = body => new Request("https://api.disorder119.com/admin/site-lock", {
  method: "POST",
  headers: { Origin: "https://admin.disorder119.com", Authorization: "Bearer sitzung-123", "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const shopGet = pass => new Request(`https://api.disorder119.com/site-status${pass ? `?pass=${encodeURIComponent(pass)}` : ""}`, {
  headers: { Origin: "https://disorder119.com" },
});
const shopUnlock = password => new Request("https://api.disorder119.com/site-unlock", {
  method: "POST", headers: { Origin: "https://disorder119.com", "Content-Type": "application/json" },
  body: JSON.stringify({ password }),
});
const call = (req, env) => handleSiteLock(req, env, new URL(req.url), "t", req.headers.get("Origin"));

test("offen, solange nichts gesperrt ist", async () => {
  const res = await call(shopGet(), { DB: fakeDb() });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { locked: false });
});

test("sperren, falsches Passwort, richtiges Passwort, Pass gilt", async () => {
  const db = fakeDb();
  let res = await call(adminPost({ locked: true, password: "vorschau119", message: "Bald zurück" }), adminEnv(db));
  assert.equal(res.status, 200);
  res = await call(shopGet(), { DB: db });
  assert.deepEqual(await res.json(), { locked: true, access: false, message: "Bald zurück" });
  res = await call(shopUnlock("falsch"), { DB: db });
  assert.equal(res.status, 403);
  res = await call(shopUnlock("vorschau119"), { DB: db });
  const { pass } = await res.json();
  assert.ok(pass);
  res = await call(shopGet(pass), { DB: db });
  assert.equal((await res.json()).access, true);
});

test("neue Sperre macht alte Pässe ungültig, Öffnen gibt frei", async () => {
  const db = fakeDb();
  await call(adminPost({ locked: true, password: "eins1" }), adminEnv(db));
  const { pass } = await (await call(shopUnlock("eins1"), { DB: db })).json();
  await call(adminPost({ locked: true, password: "zwei2" }), adminEnv(db));
  assert.equal((await (await call(shopGet(pass), { DB: db })).json()).access, false);
  await call(adminPost({ locked: false }), adminEnv(db));
  assert.deepEqual(await (await call(shopGet(pass), { DB: db })).json(), { locked: false });
});

test("Admin-Route verlangt die Sitzung", async () => {
  const req = new Request("https://api.disorder119.com/admin/site-lock", {
    method: "POST", headers: { Origin: "https://admin.disorder119.com", Authorization: "Bearer falsch" },
    body: JSON.stringify({ locked: true, password: "abcd" }),
  });
  assert.equal((await call(req, adminEnv(fakeDb()))).status, 401);
});

test("zu kurzes Passwort wird abgelehnt", async () => {
  assert.equal((await call(adminPost({ locked: true, password: "abc" }), adminEnv(fakeDb()))).status, 400);
});

test("abgelaufener oder manipulierter Pass zählt nicht", async () => {
  const sperre = { version: 3, secret: "geheim" };
  const t0 = Date.UTC(2026, 8, 25);
  const pass = await passAusstellen(sperre, t0);
  assert.equal(await passGueltig(sperre, pass, t0 + 1000), true);
  assert.equal(await passGueltig(sperre, pass, t0 + 8 * 24 * 3600 * 1000), false);
  const kaputt = pass.slice(0, -1) + (pass.endsWith("0") ? "1" : "0");
  assert.equal(await passGueltig(sperre, kaputt, t0 + 1000), false);
  assert.notEqual(await passwortHash("salz", "a"), await passwortHash("salz", "b"));
});
