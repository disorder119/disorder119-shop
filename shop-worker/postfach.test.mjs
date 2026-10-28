import assert from "node:assert/strict";
import test from "node:test";

import { handleIncomingEmail, kopfDekodieren, mailLesen, postfachMeldungNachholen, postfachText } from "./postfach.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const einfach = [
  "From: =?UTF-8?Q?J=C3=BCrgen_M=C3=BCller?= <Juergen@Example.com>",
  "To: kontakt@disorder119.com",
  "Subject: =?UTF-8?B?RnJhZ2UgenVy?= =?UTF-8?B?IFByYWRhLUphY2tl?=",
  "Message-ID: <abc@example.com>",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Hallo, ist die Jacke in Gr=C3=B6=C3=9Fe 48 noch da? Gr=",
  "=C3=BC=C3=9Fe",
].join("\r\n");

const mehrteilig = [
  "From: Anna <anna@example.org>",
  "Reply-To: anna.privat@example.org",
  "To: kontakt@disorder119.com",
  "Subject: Rückgabe",
  "Content-Type: multipart/mixed; boundary=\"aussen\"",
  "",
  "--aussen",
  "Content-Type: multipart/alternative; boundary=innen",
  "",
  "--innen",
  "Content-Type: text/html; charset=iso-8859-1",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "<p>Nur HTML =FCber Umwege</p>",
  "--innen",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("Ich möchte das Hemd zurückgeben.", "utf8").toString("base64"),
  "--innen--",
  "--aussen",
  "Content-Type: application/pdf; name=\"Rechnung.pdf\"",
  "Content-Disposition: attachment; filename=\"Rechnung.pdf\"",
  "Content-Transfer-Encoding: base64",
  "",
  "JVBERi0xLjQK",
  "--aussen--",
].join("\r\n");

test("Kopfzeilen mit Umlauten (Q und B)", () => {
  assert.equal(kopfDekodieren("=?UTF-8?Q?J=C3=BCrgen?="), "Jürgen");
  const m = mailLesen(einfach);
  assert.equal(m.vonEmail, "juergen@example.com");
  assert.equal(m.vonName, "Jürgen Müller");
  assert.equal(m.betreff, "Frage zur Prada-Jacke");
  assert.equal(m.text, "Hallo, ist die Jacke in Größe 48 noch da? Grüße");
});

test("multipart: Text statt HTML, Anhang nur mit Namen, Reply-To", () => {
  const m = mailLesen(mehrteilig);
  assert.equal(m.text, "Ich möchte das Hemd zurückgeben.");
  assert.deepEqual(m.anhaenge, ["Rechnung.pdf"]);
  assert.equal(m.antwortAn, "anna.privat@example.org");
  assert.equal(m.betreff, "Rückgabe");
});

test("nur HTML wird zu lesbarem Text", () => {
  const nurHtml = mehrteilig.replace(/--innen\r\nContent-Type: text\/plain[\s\S]*?(?=--innen--)/, "");
  assert.equal(mailLesen(nurHtml).text, "Nur HTML über Umwege");
});

test("eingehende Mail wird gespeichert und weitergeleitet", async () => {
  const gespeichert = [];
  const env = {
    DB: { prepare: () => ({ bind: (...args) => ({ run: async () => { gespeichert.push(args); } }) }) },
  };
  let weiter = "";
  const bytes = new TextEncoder().encode(einfach);
  const message = {
    from: "juergen@example.com", to: "kontakt@disorder119.com",
    raw: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
    forward: async ziel => { weiter = ziel; },
    setReject: () => { throw new Error("darf nicht abweisen"); },
  };
  await handleIncomingEmail(message, env, null);
  assert.equal(weiter, "disorder119shop@gmail.com");
  assert.equal(gespeichert.length, 1);
  assert.equal(gespeichert[0][2], "juergen@example.com");
  assert.equal(gespeichert[0][6], "Frage zur Prada-Jacke");
});

// Telegram bekommt keine Personendaten aus Mails (Absender, Betreff): die
// stehen nur in der Admin-App. Ein Betreff wie "=?UTF-8?Q?Rechnung=0A=0A
// DISORDER119 — NEUES ADMIN-GERÄT ...?=" kann so auch keine falsche Meldung
// mehr vortaeuschen.
test("Telegram-Meldung ohne Absender und Betreff", async () => {
  const mails = [
    [
      "From: =?UTF-8?Q?Support=0ADISORDER119_=E2=80=94_NEUES_ADMIN-GER=C3=84T?= <boese@example.com>",
      "To: kontakt@disorder119.com",
      "Subject: =?UTF-8?Q?Rechnung=0A=0ADISORDER119_=E2=80=94_NEUES_ADMIN-GER=C3=84T=0AWarst_du_das_nicht=3F_Link:_https://evil.example/x?=",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hallo",
    ].join("\r\n"),
  ];
  const gesendet = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.match(String(url), /^https:\/\/api\.telegram\.org\//);
    gesendet.push(JSON.parse(String(init.body || "{}")));
    return Response.json({ ok: true, result: { message_id: gesendet.length } });
  };
  try {
    for (const roh of mails) {
      const bytes = new TextEncoder().encode(roh);
      await handleIncomingEmail({
        from: "boese@example.com", to: "kontakt@disorder119.com",
        raw: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
        forward: async () => {},
        setReject: () => { throw new Error("darf nicht abweisen"); },
      }, { TELEGRAM_BOT_TOKEN: "bot", TELEGRAM_CHAT_ID: "42" }, null);
    }
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(gesendet.length, 1);
  assert.equal(gesendet[0].text, postfachText(1));
  assert.doesNotMatch(gesendet[0].text, /boese|evil|Rechnung|Support|ADMIN-GER/);
});

test("Telegram hoechstens alle 10 Minuten, dazwischen gesammelt; Cron holt nach", async () => {
  const DB = sqliteD1(allMigrations());
  const env = { DB, TELEGRAM_BOT_TOKEN: "bot", TELEGRAM_CHAT_ID: "42" };
  const gesendet = [];
  const original = globalThis.fetch;
  let kaputt = false;
  globalThis.fetch = async (url, init = {}) => {
    if (kaputt) return new Response("{}", { status: 502 });
    gesendet.push(JSON.parse(String(init.body || "{}")).text);
    return Response.json({ ok: true, result: { message_id: gesendet.length } });
  };
  const ankommen = async i => {
    const bytes = new TextEncoder().encode(einfach.replace("Frage zur Prada-Jacke", `Frage ${i}`));
    await handleIncomingEmail({
      from: "juergen@example.com", to: "kontakt@disorder119.com",
      raw: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
      forward: async () => {},
      setReject: () => { throw new Error("darf nicht abweisen"); },
    }, env, null);
  };
  try {
    await ankommen(1);
    assert.equal(gesendet.length, 1, "erste Mail sofort");
    await ankommen(2);
    await ankommen(3);
    assert.equal(gesendet.length, 1, "innerhalb von 10 Minuten keine weitere Meldung");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM postfach").get().n, 3, "alles gespeichert");
    // Der Cron 11 Minuten spaeter meldet beide gesammelt.
    assert.equal(await postfachMeldungNachholen(env, Date.now() + 11 * 60_000), 2);
    assert.match(gesendet[1], /^📬 2 neue Mails seit \d\d:\d\d Uhr – Admin-App → Postfach$/);
    assert.equal(await postfachMeldungNachholen(env, Date.now() + 30 * 60_000), 0, "nichts Neues: keine Meldung");
    // Telegram gestoert: der Anspruch wird zurueckgenommen, der Cron meldet spaeter.
    DB.raw.prepare("DELETE FROM postfach").run();
    DB.raw.prepare("DELETE FROM site_settings").run();
    kaputt = true;
    await ankommen(4);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM site_settings").get().n, 0, "Anspruch zurueckgenommen");
    kaputt = false;
    const vorher = gesendet.length;
    assert.equal(await postfachMeldungNachholen(env), 1);
    assert.equal(gesendet.length, vorher + 1);
    assert.equal(gesendet.at(-1), postfachText(1));
  } finally {
    globalThis.fetch = original;
  }
});

test("Riesige HTML-Mail (180 KB, boesartig verschachtelt) kostet kaum Rechenzeit", () => {
  const boese = [
    "<style>".repeat(15_000) + "x",
    "<".repeat(180_000),
    "<a " + " ".repeat(180_000) + "x",
    "<p>" + " \t".repeat(90_000) + "x</p>",
    "<script>" + "a".repeat(100) + "<br     ".repeat(20_000),
  ];
  for (const html of boese) {
    const roh = ["From: a@example.org", "To: kontakt@disorder119.com", "Subject: x", "Content-Type: text/html; charset=utf-8", "", html].join("\r\n");
    const start = performance.now();
    const mail = mailLesen(roh);
    const dauer = performance.now() - start;
    assert.ok(dauer < 200, `${dauer.toFixed(0)} ms fuer ${html.slice(0, 12)}…`);
    assert.ok(mail.text.length <= 60_100);
  }
  // Normales HTML bleibt lesbar.
  const normal = mailLesen(["From: a@example.org", "Subject: x", "Content-Type: text/html; charset=utf-8", "",
    "<html><head><style>p{color:red}</style><script>alert(1)</script></head><body><p>Hallo   </p><p>Welt</p></body></html>"].join("\r\n"));
  assert.equal(normal.text, "Hallo\nWelt");
});
