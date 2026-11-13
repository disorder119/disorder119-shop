import assert from "node:assert/strict";
import test from "node:test";

import { handleLager, isLagerRoute } from "./lager.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const ORIGIN = "https://admin.disorder119.com";

async function api(env, pfad, method = "GET", body, token = "test-token") {
  const req = new Request(`https://api.disorder119.com${pfad}`, {
    method,
    headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handleLager(req, env, new URL(req.url), "req-test", ORIGIN);
}

test("Lager: Startbestand mit neun Kisten, alles ungeprueft, nur mit Anmeldung", async () => {
  const env = { DB: sqliteD1(allMigrations()), ADMIN_TOKEN: "test-token" };
  assert.equal(isLagerRoute(new URL("https://api.disorder119.com/admin/lager")), true);
  assert.equal(isLagerRoute(new URL("https://api.disorder119.com/admin/lager/kisten/3")), true);
  assert.equal(isLagerRoute(new URL("https://api.disorder119.com/admin/lagerx")), false);
  assert.equal((await api(env, "/admin/lager", "GET", undefined, "falsch")).status, 401);

  const daten = await (await api(env, "/admin/lager")).json();
  assert.equal(daten.schema, "lager-v1");
  assert.equal(daten.kisten.length, 9);
  assert.deepEqual(daten.kisten.map(k => k.name).slice(0, 3), ["Kiste 1", "Kiste 2", "Kiste 3"]);
  const alle = daten.kisten.flatMap(k => k.artikel);
  assert.ok(alle.length > 100);
  assert.equal(new Set(alle.map(a => a.artikel)).size, alle.length, "jede Artikelnummer liegt nur in einer Kiste");
  assert.ok(alle.every(a => a.geprueft === false));
  assert.equal(daten.kisten[6].artikel.length, 0);
});

test("Lager: einsortieren, umlegen, bestaetigen, herausnehmen", async () => {
  const env = { DB: sqliteD1(allMigrations()), ADMIN_TOKEN: "test-token" };
  let d = await (await api(env, "/admin/lager/artikel", "POST", { artikel: ["#270", "271", "abc"], kiste: 7 })).json();
  assert.deepEqual(d.kisten[6].artikel, [{ artikel: "270", geprueft: true }, { artikel: "271", geprueft: true }]);

  // umlegen: 270 liegt danach nur noch in Kiste 8
  d = await (await api(env, "/admin/lager/artikel", "POST", { artikel: "270", kiste: 8 })).json();
  assert.deepEqual(d.kisten[6].artikel.map(a => a.artikel), ["271"]);
  assert.deepEqual(d.kisten[7].artikel.map(a => a.artikel), ["270"]);

  // Vorbelegtes bestaetigen
  const erste = d.kisten[5].artikel[0].artikel;
  d = await (await api(env, "/admin/lager/artikel", "POST", { artikel: erste, geprueft: true })).json();
  assert.equal(d.kisten[5].artikel.find(a => a.artikel === erste).geprueft, true);

  d = await (await api(env, "/admin/lager/artikel", "POST", { artikel: "271", kiste: null })).json();
  assert.equal(d.kisten[6].artikel.length, 0);

  assert.equal((await api(env, "/admin/lager/artikel", "POST", { artikel: "5", kiste: 999 })).status, 404);
  assert.equal((await api(env, "/admin/lager/artikel", "POST", { artikel: "5" })).status, 400);
});

test("Lager: Kiste anlegen, umbenennen, nur leer entfernen", async () => {
  const env = { DB: sqliteD1(allMigrations()), ADMIN_TOKEN: "test-token" };
  let d = await (await api(env, "/admin/lager/kisten", "POST", { name: "Schuhe" })).json();
  assert.equal(d.kisten.length, 10);
  const neu = d.kisten[9];
  assert.equal(neu.name, "Schuhe");

  d = await (await api(env, `/admin/lager/kisten/${neu.id}`, "POST", { name: "Schuhkarton", notiz: "steht links" })).json();
  assert.deepEqual([d.kisten[9].name, d.kisten[9].notiz], ["Schuhkarton", "steht links"]);
  assert.equal((await api(env, `/admin/lager/kisten/${neu.id}`, "POST", { name: "  " })).status, 400);

  assert.equal((await api(env, "/admin/lager/kisten/6", "DELETE")).status, 409);
  d = await (await api(env, `/admin/lager/kisten/${neu.id}`, "DELETE")).json();
  assert.equal(d.kisten.length, 9);
  assert.equal((await api(env, "/admin/lager/kisten/4711", "DELETE")).status, 404);
});
