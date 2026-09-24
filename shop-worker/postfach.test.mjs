import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import workerEntry from "./worker-entry.js";
import {
  antwortBetreff,
  handleInboundEmail,
  handlePostfach,
  htmlZuText,
  nachrichtAusMail,
  POSTFACH_MAX_TEXT,
  spamVerdacht,
} from "./postfach.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_ORIGIN = "https://admin.disorder119.com";

// D1-kompatible Huelle um SQLite mit Grundschema und allen Migrationen, damit
// die echten SQL-Anweisungen samt Indizes geprueft werden.
function d1() {
  const raw = new DatabaseSync(":memory:");
  const files = [
    path.join(HERE, "schema.sql"),
    ...fs.readdirSync(path.join(HERE, "migrations")).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()
      .map(f => path.join(HERE, "migrations", f)),
  ];
  for (const file of files) raw.exec(fs.readFileSync(file, "utf8"));
  const arg = v => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v);
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next.map(arg)),
    first: async () => { const row = raw.prepare(sql).get(...args); return row ? { ...row } : null; },
    all: async () => ({ results: raw.prepare(sql).all(...args).map(row => ({ ...row })) }),
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }),
    runSync: () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }),
  });
  return {
    raw,
    prepare: sql => statement(sql),
    batch: async statements => {
      raw.exec("BEGIN");
      try { const out = statements.map(s => s.runSync()); raw.exec("COMMIT"); return out; }
      catch (err) { raw.exec("ROLLBACK"); throw err; }
    },
  };
}

function fakeMessage({ from = "anna@example.com", to = "bestellung@disorder119.com", forwardFails = false } = {}) {
  const calls = { forward: [], reject: [] };
  return {
    calls,
    from,
    to,
    rawSize: 2048,
    raw: new Response("From: anna@example.com\r\n\r\nHallo").body,
    forward: async address => {
      if (forwardFails) throw new Error("destination not verified");
      calls.forward.push(address);
    },
    setReject: reason => calls.reject.push(reason),
  };
}

const MAIL = {
  from: { address: "Anna@Example.com", name: "Anna Käufer" },
  replyTo: [{ address: "anna.privat@example.org" }],
  subject: "Frage zur Jacke – Größe",
  messageId: "<abc123@example.com>",
  html: "<p>Hallo,<br>passt die <b>Jacke</b>? <a href=\"https://disorder119.com/artikel/6241/\">Artikel</a></p><script>alert(1)</script>",
  attachments: [{ filename: "foto.jpg", mimeType: "image/jpeg", content: new Uint8Array(10) }],
  headers: [{ key: "authentication-results", value: "mx.cloudflare.net; dmarc=pass; spf=pass" }],
};

test("mail HTML becomes plain text: scripts gone, links kept, entities decoded", () => {
  const text = htmlZuText('<style>p{}</style><p>Gr&uuml;&szlig;e &amp; <b>Dank</b><br>Zeile&nbsp;2</p><a href="javascript:alert(1)">klick</a> <a href="mailto:x@y.de">x@y.de</a><script>steal()</script>');
  assert.equal(text.includes("steal"), false);
  assert.equal(text.includes("<"), false);
  assert.equal(text.includes("javascript:"), false);
  assert.match(text, /& Dank\nZeile 2/);
  assert.match(text, /klick x@y\.de/);
  assert.equal(htmlZuText(MAIL.html), "Hallo,\npasst die Jacke? Artikel (https://disorder119.com/artikel/6241/)");
});

test("a parsed mail becomes a text-only record with attachment metadata", () => {
  const row = nachrichtAusMail(MAIL, { envelopeFrom: "bounce@example.com", envelopeTo: "Bestellung@disorder119.com", rawSize: 2048, now: new Date("2026-09-25T10:00:00Z") });
  assert.equal(row.von, "anna@example.com");
  assert.equal(row.von_name, "Anna Käufer");
  assert.equal(row.antwort_an, "anna.privat@example.org");
  assert.equal(row.an, "bestellung@disorder119.com");
  assert.equal(row.betreff, "Frage zur Jacke – Größe");
  assert.equal(row.text.includes("<"), false);
  assert.deepEqual(JSON.parse(row.anhaenge_json), [{ name: "foto.jpg", typ: "image/jpeg", groesse: 10 }]);
  assert.equal(row.spam_verdacht, 0);

  const long = nachrichtAusMail({ text: "x".repeat(POSTFACH_MAX_TEXT + 5) }, { envelopeFrom: "a@b.de" });
  assert.equal(long.text.length, POSTFACH_MAX_TEXT);
  assert.equal(long.text_gekuerzt, 1);
  assert.equal(long.von, "a@b.de");

  assert.equal(spamVerdacht([{ key: "authentication-results", value: "mx; dmarc=fail (p=reject)" }]), true);
  assert.equal(spamVerdacht([{ key: "received-spf", value: "fail (domain does not designate)" }]), true);
  assert.equal(spamVerdacht(MAIL.headers), false);
});

test("inbound mail is forwarded, stored once and never lost silently", async () => {
  const db = d1();
  const env = { DB: db, MAIL_FORWARD_TO: "disorder119shop@gmail.com" };
  const first = fakeMessage();
  assert.deepEqual(await handleInboundEmail(first, env, null, { parse: async () => MAIL }), { gespeichert: true, weitergeleitet: true });
  assert.deepEqual(first.calls.forward, ["disorder119shop@gmail.com"]);
  assert.deepEqual(first.calls.reject, []);

  // Der Mailserver stellt dieselbe Nachricht erneut zu: kein zweiter Eintrag.
  await handleInboundEmail(fakeMessage(), env, null, { parse: async () => MAIL });
  const rows = db.raw.prepare("SELECT von, antwort_an, weitergeleitet, text FROM postfach_nachrichten").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].weitergeleitet, 1);
  assert.equal(rows[0].text.includes("<script>"), false);

  // Weiterleitung kaputt, Ablage klappt: angenommen, nicht zurueckgewiesen.
  const noForward = fakeMessage({ forwardFails: true });
  const result = await handleInboundEmail(noForward, env, null, { parse: async () => ({ ...MAIL, messageId: "<other@example.com>" }) });
  assert.deepEqual(result, { gespeichert: true, weitergeleitet: false });
  assert.deepEqual(noForward.calls.reject, []);

  // Weder Ablage noch Weiterleitung moeglich: Absender bekommt eine Fehlermeldung.
  const lost = fakeMessage();
  assert.deepEqual(await handleInboundEmail(lost, {}, null, { parse: async () => MAIL }), { gespeichert: false, weitergeleitet: false });
  assert.equal(lost.calls.reject.length, 1);
});

test("the worker exports an email handler for Cloudflare Email Routing", () => {
  assert.equal(typeof workerEntry.email, "function");
});

function adminRequest(method, pathname, body = null, origin = ADMIN_ORIGIN) {
  const headers = { Origin: origin };
  if (body) headers["Content-Type"] = "application/json";
  return new Request(`https://api.disorder119.com${pathname}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

async function call(env, method, pathname, body, origin) {
  const request = adminRequest(method, pathname, body, origin);
  const response = await handlePostfach(request, env, new URL(request.url), "req-test", origin ?? ADMIN_ORIGIN);
  return { status: response.status, data: await response.json(), headers: response.headers };
}

test("admin inbox lists, reads, marks, answers, archives and deletes", async () => {
  const db = d1();
  await handleInboundEmail(fakeMessage(), { DB: db }, null, { parse: async () => MAIL });
  const env = {
    DB: db,
    ADMIN_AUTH_CONTEXT: { role: "OWNER" },
    MAIL_API_KEY: "test-key",
    MAIL_FROM: "bestellung@disorder119.com",
  };

  const list = await call(env, "GET", "/admin/postfach");
  assert.equal(list.status, 200);
  assert.equal(list.headers.get("Access-Control-Allow-Origin"), ADMIN_ORIGIN);
  assert.equal(list.data.ungelesen, 1);
  assert.equal(list.data.nachrichten.length, 1);
  const id = list.data.nachrichten[0].id;
  assert.equal(list.data.nachrichten[0].anhaenge, 1);

  const one = await call(env, "GET", `/admin/postfach/${id}`);
  assert.equal(one.data.nachricht.antwortAn, "anna.privat@example.org");
  assert.equal(one.data.nachricht.text.includes("<"), false);

  await call(env, "PATCH", `/admin/postfach/${id}`, { gelesen: true });
  assert.equal((await call(env, "GET", "/admin/postfach")).data.ungelesen, 0);

  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), payload: JSON.parse(init.body) });
    return new Response(JSON.stringify({ messageId: "<brevo-1@smtp>" }), { status: 201 });
  };
  try {
    const reply = await call(env, "POST", `/admin/postfach/${id}/antwort`, { text: "Hallo Anna,\nja, die Jacke fällt normal aus." });
    assert.equal(reply.status, 200);
    assert.equal(reply.data.nachricht.beantwortet, true);
    assert.equal(reply.data.nachricht.antworten.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(sent.length, 1);
  const payload = sent[0].payload;
  assert.deepEqual(payload.to, [{ email: "anna.privat@example.org" }]);
  assert.equal(payload.subject, "Re: Frage zur Jacke – Größe");
  assert.equal(payload.headers["In-Reply-To"], "<abc123@example.com>");
  assert.ok(payload.textContent.startsWith("Hallo Anna,\nja, die Jacke fällt normal aus.\n\nAm "));
  assert.match(payload.textContent, /schrieb Anna Käufer <anna@example\.com>:\n> Hallo,/);
  assert.equal(payload.htmlContent.includes("<script>"), false);

  await call(env, "PATCH", `/admin/postfach/${id}`, { archiviert: true });
  assert.equal((await call(env, "GET", "/admin/postfach")).data.total, 0);
  assert.equal((await call(env, "GET", "/admin/postfach?ordner=archiv")).data.total, 1);

  const deleted = await call(env, "DELETE", `/admin/postfach/${id}`);
  assert.equal(deleted.status, 200);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM postfach_nachrichten").get().n, 0);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM postfach_antworten").get().n, 0);
});

test("admin inbox enforces roles, ids and origins", async () => {
  const db = d1();
  await handleInboundEmail(fakeMessage(), { DB: db }, null, { parse: async () => MAIL });
  const id = db.raw.prepare("SELECT id FROM postfach_nachrichten").get().id;

  assert.equal((await call({ DB: db }, "GET", "/admin/postfach")).status, 401);
  const reader = { DB: db, ADMIN_AUTH_CONTEXT: { role: "READER" } };
  assert.equal((await call(reader, "GET", "/admin/postfach")).status, 200);
  assert.equal((await call(reader, "POST", `/admin/postfach/${id}/antwort`, { text: "Hi" })).status, 403);
  assert.equal((await call(reader, "DELETE", `/admin/postfach/${id}`)).status, 403);

  const owner = { DB: db, ADMIN_AUTH_CONTEXT: { role: "OWNER" } };
  assert.equal((await call(owner, "GET", "/admin/postfach/not-a-uuid")).status, 400);
  assert.equal((await call(owner, "GET", `/admin/postfach/${crypto.randomUUID()}`)).status, 404);
  assert.equal((await call(owner, "POST", `/admin/postfach/${id}/antwort`, { text: "Hi" })).data.error, "MAIL_NOT_CONFIGURED");
  assert.equal((await call(owner, "GET", "/admin/postfach", null, "https://evil.example")).status, 403);
  assert.equal(antwortBetreff("AW: Frage"), "AW: Frage");
  assert.equal(antwortBetreff(""), "Re: Deine Nachricht");
});
