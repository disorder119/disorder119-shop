import assert from "node:assert/strict";
import test from "node:test";
import { applyChanges, handleKatalog } from "./admin-katalog.js";
import { RuntimeGuardError, guardRuntimeRequest } from "./backend-runtime.js";

const ADMIN = "https://admin.disorder119.com";
const TOKEN = "schluessel-dieser-anfrage";
const MAIN = "a".repeat(40);
const TREE = "b".repeat(40);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(64, 1)]).toString("base64");

const ITEMS = [
  { id: 6241, title: "Marbled Jeans", brand: "Jean Paul Gaultier", price: 90, public_status: "AVAILABLE", gallery: ["assets/img/b2-241/0.webp"] },
  { id: 6242, title: "Wool Coat", brand: "Comme des Garçons", price: 320, public_status: "AVAILABLE", gallery: [] },
];
const ITEMS_TEXT = JSON.stringify(ITEMS, null, 2) + "\n";

// Nachbau der GitHub-Schnittstelle: Git-Daten, Pull Requests, Merge.
function fakeGithub({ conflicts = 0 } = {}) {
  const calls = [];
  let merges = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || "GET";
    const path = u.pathname.replace("/repos/disorder119/disorder119-shop", "");
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path, search: u.search, body, headers: init.headers || {} });
    if (method === "GET" && path === "/git/ref/heads/main") return Response.json({ object: { sha: MAIN } });
    if (method === "GET" && path === `/git/commits/${MAIN}`) return Response.json({ tree: { sha: TREE } });
    if (method === "GET" && path === "/contents/data") return Response.json([{ name: "items.json", type: "file", sha: "items-sha" }]);
    if (method === "GET" && path === "/contents/assets/img/b2-241/thumbs") return Response.json([{ name: "0.webp", type: "file" }, { name: "9.webp", type: "file" }]);
    if (method === "GET" && path === "/contents/assets/img/b2-241") return Response.json([{ name: "0.webp", type: "file" }]);
    if (method === "GET" && path === "/git/blobs/items-sha") return new Response(ITEMS_TEXT);
    if (method === "GET" && path === "/commits") {
      return Response.json([{ sha: "c".repeat(40), commit: { message: "Admin: Titel geändert\n\nDetails", author: { name: "disorder119", date: "2026-09-24T10:00:00Z" } } }]);
    }
    if (method === "POST" && path === "/git/blobs") return Response.json({ sha: `blob-${calls.filter(c => c.path === "/git/blobs").length}` });
    if (method === "POST" && path === "/git/trees") return Response.json({ sha: "d".repeat(40) });
    if (method === "POST" && path === "/git/commits") return Response.json({ sha: "e".repeat(40) });
    if (method === "POST" && path === "/git/refs") return Response.json({ ref: body.ref }, { status: 201 });
    if (method === "POST" && path === "/pulls") return Response.json({ number: 200 + merges, html_url: "https://github.com/disorder119/disorder119-shop/pull/200" }, { status: 201 });
    if (method === "PUT" && /^\/pulls\/\d+\/merge$/.test(path)) {
      merges += 1;
      if (merges <= conflicts) return Response.json({ message: "Pull Request is not mergeable" }, { status: 405 });
      return Response.json({ sha: "f".repeat(40), merged: true });
    }
    if (method === "PATCH" && /^\/pulls\/\d+$/.test(path)) return Response.json({ state: "closed" });
    if (method === "DELETE" && path.startsWith("/git/refs/heads/admin/katalog-")) return new Response(null, { status: 204 });
    return new Response(`unerwartet: ${method} ${path}`, { status: 404 });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

async function call(pathname, { method = "GET", body, bearer = TOKEN, env = { ADMIN_TOKEN: TOKEN, GITHUB_TOKEN: "gh" } } = {}) {
  const req = new Request(`https://api.disorder119.com${pathname}`, {
    method,
    headers: { Origin: ADMIN, Authorization: `Bearer ${bearer}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handleKatalog(req, env, new URL(req.url), "req-test", ADMIN);
  return { status: res.status, data: await res.json() };
}

test("the catalog loads through the worker, without a token in the browser", async () => {
  const gh = fakeGithub();
  try {
    const result = await call("/admin/katalog");
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.items, ITEMS);
    assert.equal(result.data.sha, "items-sha");
    assert.equal(result.data.commits[0].message, "Admin: Titel geändert");
    assert.equal(gh.calls.find(c => c.path === "/git/blobs/items-sha").headers.Accept, "application/vnd.github.raw+json");
  } finally {
    gh.restore();
  }
});

test("a field change becomes one commit that reaches main through a merged pull request", async () => {
  const gh = fakeGithub();
  try {
    const result = await call("/admin/katalog/speichern", {
      method: "POST",
      body: { message: "Titel für #6241", changes: [{ id: 6241, set: { title: "Marbled Denim Jeans", price: "95.5" } }] },
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.deepEqual(result.data, { ok: true, pullRequest: 200, url: "https://github.com/disorder119/disorder119-shop/pull/200" });

    const blob = gh.calls.find(c => c.method === "POST" && c.path === "/git/blobs").body;
    assert.equal(blob.encoding, "utf-8");
    const saved = JSON.parse(blob.content);
    assert.equal(saved[0].title, "Marbled Denim Jeans");
    assert.equal(saved[0].price, 95.5);
    assert.deepEqual(saved[1], ITEMS[1], "andere Artikel bleiben unberuehrt");
    assert.ok(blob.content.endsWith("]\n"));

    const commit = gh.calls.find(c => c.method === "POST" && c.path === "/git/commits").body;
    assert.equal(commit.message, "Admin: Titel für #6241");
    assert.deepEqual(commit.parents, [MAIN]);
    const merge = gh.calls.find(c => c.method === "PUT").body;
    assert.deepEqual(merge, { merge_method: "squash", sha: "e".repeat(40), commit_title: "Admin: Titel für #6241" });
    // Kein direkter Push auf main - den wuerde der Waechter zurueckdrehen.
    assert.equal(gh.calls.some(c => c.method === "PATCH" && c.path === "/git/refs/heads/main"), false);
    assert.ok(gh.calls.some(c => c.method === "DELETE" && c.path.startsWith("/git/refs/heads/admin/katalog-")), "Zweig wird aufgeraeumt");
  } finally {
    gh.restore();
  }
});

test("a conflicting edit is retried on the new state of main", async () => {
  const gh = fakeGithub({ conflicts: 1 });
  try {
    const result = await call("/admin/katalog/speichern", { method: "POST", body: { changes: [{ id: 6242, set: { size: "M" } }] } });
    assert.equal(result.status, 200);
    assert.equal(gh.calls.filter(c => c.method === "PUT").length, 2);
    assert.equal(gh.calls.filter(c => c.method === "PATCH" && /^\/pulls\/\d+$/.test(c.path)).length, 1, "der gescheiterte PR wird geschlossen");
  } finally {
    gh.restore();
  }
});

test("only the editor's fields, with sane values, can be changed", () => {
  const fresh = () => JSON.parse(ITEMS_TEXT);
  const cases = [
    [{ id: 6241, set: { taxonomy_category: "X" } }, "FELD_NICHT_BEARBEITBAR"],
    [{ id: 6241, set: { toString: "X" } }, "FELD_NICHT_BEARBEITBAR"],
    [JSON.parse('{"id":6241,"set":{"__proto__":{"polluted":true}}}'), "FELD_NICHT_BEARBEITBAR"],
    [{ id: 6241, set: { price: -1 } }, "PREIS_UNGUELTIG"],
    [{ id: 6241, set: { price: "abc" } }, "PREIS_UNGUELTIG"],
    [{ id: 6241, set: { public_status: "HIDDEN" } }, "STATUS_UNGUELTIG"],
    [{ id: 6241, set: { price_estimated: "ja" } }, "FELD_UNGUELTIG"],
    [{ id: 6241, set: { title: "  " } }, "TITEL_FEHLT"],
    [{ id: 6241, set: { gallery: ["../../etc/passwd"] } }, "GALERIE_UNGUELTIG"],
    [{ id: 6241, set: { gallery: ["assets/img/b2-241/thumbs/0.webp"] } }, "GALERIE_UNGUELTIG"],
    [{ id: 9999, set: { title: "X" } }, "ARTIKEL_UNBEKANNT"],
  ];
  for (const [change, code] of cases) {
    assert.throws(() => applyChanges(fresh(), [change]), err => err.code === code, JSON.stringify(change));
  }
  assert.equal({}.polluted, undefined);
  const ok = applyChanges(fresh(), [{ id: 6241, set: { public_status: "sold", gallery: ["assets/img/b2-241/1.webp"], price_estimated: true } }]);
  assert.equal(ok[0].public_status, "SOLD");
  assert.deepEqual(ok[0].gallery, ["assets/img/b2-241/1.webp"]);
});

test("photos must be real WebP files in the image folders", async () => {
  const gh = fakeGithub();
  try {
    const good = await call("/admin/katalog/speichern", {
      method: "POST",
      body: {
        images: [{ path: "assets/img/b2-241/1.webp", base64: WEBP }, { path: "assets/img/b2-241/thumbs/1.webp", base64: WEBP }],
        changes: [{ id: 6241, set: { gallery: ["assets/img/b2-241/0.webp", "assets/img/b2-241/1.webp"] } }],
        // 7.webp gibt es nicht: wird still uebergangen statt den Commit zu kippen.
        remove: ["assets/img/b2-241/thumbs/9.webp", "assets/img/b2-241/7.webp"],
      },
    });
    assert.equal(good.status, 200, JSON.stringify(good.data));
    const tree = gh.calls.find(c => c.method === "POST" && c.path === "/git/trees").body.tree;
    assert.deepEqual(tree.map(t => [t.path, t.sha === null ? "entfernt" : "neu"]), [
      ["data/items.json", "neu"], ["assets/img/b2-241/1.webp", "neu"], ["assets/img/b2-241/thumbs/1.webp", "neu"], ["assets/img/b2-241/thumbs/9.webp", "entfernt"],
    ]);
    const imageBlob = gh.calls.filter(c => c.method === "POST" && c.path === "/git/blobs")[1].body;
    assert.equal(imageBlob.encoding, "base64");

    for (const [image, code] of [
      [{ path: "assets/img/../../index.html", base64: WEBP }, "BILDPFAD_UNGUELTIG"],
      [{ path: "assets/img/../5.webp", base64: WEBP }, "BILDPFAD_UNGUELTIG"],
      [{ path: "assets/img/./5.webp", base64: WEBP }, "BILDPFAD_UNGUELTIG"],
      [{ path: "index.html", base64: WEBP }, "BILDPFAD_UNGUELTIG"],
      [{ path: "assets/img/b2-241/2.webp", base64: Buffer.from("<html>kein Bild</html>").toString("base64") }, "BILD_KEIN_WEBP"],
      [{ path: "assets/img/b2-241/2.webp", base64: "nicht base64!" }, "BILD_UNGUELTIG"],
    ]) {
      const bad = await call("/admin/katalog/speichern", { method: "POST", body: { images: [image] } });
      assert.equal(bad.status, 400);
      assert.equal(bad.data.error, code, image.path);
    }
  } finally {
    gh.restore();
  }
});

test("without the request key or the worker's GitHub token nothing is read or written", async () => {
  const gh = fakeGithub();
  try {
    assert.equal((await call("/admin/katalog", { bearer: "falsch" })).status, 401);
    const noToken = await call("/admin/katalog", { env: { ADMIN_TOKEN: TOKEN } });
    assert.equal(noToken.data.error, "KATALOG_NICHT_EINGERICHTET");
    assert.equal(gh.calls.length, 0);
  } finally {
    gh.restore();
  }
});

test("only the catalog save route may carry photos larger than 32 KiB", async () => {
  const big = JSON.stringify({ images: [{ path: "assets/img/x/1.webp", base64: "A".repeat(200_000) }] });
  const request = pathname => new Request(`https://api.disorder119.com${pathname}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: big,
  });
  await assert.doesNotReject(() => guardRuntimeRequest(request("/admin/katalog/speichern"), {}));
  await assert.rejects(
    () => guardRuntimeRequest(request("/admin/notes"), {}),
    err => err instanceof RuntimeGuardError && err.code === "REQUEST_TOO_LARGE",
  );
});
