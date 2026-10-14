import assert from "node:assert/strict";
import test from "node:test";

import { handleIncomingEmail, kopfDekodieren, mailLesen } from "./postfach.js";

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

// Ein Betreff wie "=?UTF-8?Q?Rechnung=0A=0ADISORDER119_...?=" darf in der
// Telegram-Meldung keine eigenen Zeilen erzeugen, die wie ein echter Alarm
// aussehen (z. B. "DISORDER119 — NEUES ADMIN-GERÄT").
test("Betreff und Absender erzeugen in der Telegram-Meldung keine eigenen Zeilen", async () => {
  const falle = "Rechnung\u2028DISORDER119 — NEUES ADMIN-GERÄT\u0085Warst du das nicht?\u2029Link: https://evil.example/y";
  const mails = [
    [
      "From: =?UTF-8?Q?Support=0ADISORDER119_=E2=80=94_NEUES_ADMIN-GER=C3=84T?= <boese@example.com>",
      "To: kontakt@disorder119.com",
      "Subject: =?UTF-8?Q?Rechnung=0A=0ADISORDER119_=E2=80=94_NEUES_ADMIN-GER=C3=84T=0AWarst_du_das_nicht=3F_Link:_https://evil.example/x?=",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hallo",
    ].join("\r\n"),
    [
      `From: =?UTF-8?B?${Buffer.from("Support\r\nDISORDER119 — NEUES ADMIN-GERÄT", "utf8").toString("base64")}?= <boese@example.com>`,
      "To: kontakt@disorder119.com",
      `Subject: =?UTF-8?B?${Buffer.from(falle, "utf8").toString("base64")}?=`,
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
  assert.equal(gesendet.length, 2);
  for (const { text } of gesendet) {
    const zeilen = text.split(/\r\n|[\n\r\u0085\u2028\u2029]/);
    assert.equal(zeilen.length, 3, JSON.stringify(text));
    assert.equal(zeilen[0], "📬 Neue Mail an kontakt@disorder119.com");
    assert.match(zeilen[1], /^Von: Support DISORDER119 — NEUES ADMIN-GERÄT <boese@example\.com>$/);
    assert.match(zeilen[2], /^Betreff: „Rechnung DISORDER119 — NEUES ADMIN-GERÄT Warst du das nicht\? Link: https:\/\/evil\.example\/[xy]“$/);
    assert.doesNotMatch(text, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
  }
});

test("sehr lange Betreffe werden für Telegram gekürzt", async () => {
  const roh = [
    "From: anna@example.org",
    "To: kontakt@disorder119.com",
    `Subject: ${"Frage ".repeat(80)}`,
    "",
    "Hallo",
  ].join("\r\n");
  const gesendet = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    gesendet.push(JSON.parse(String(init.body || "{}")));
    return Response.json({ ok: true, result: { message_id: 1 } });
  };
  try {
    const bytes = new TextEncoder().encode(roh);
    await handleIncomingEmail({
      from: "anna@example.org", to: "kontakt@disorder119.com",
      raw: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
      forward: async () => {},
      setReject: () => { throw new Error("darf nicht abweisen"); },
    }, { TELEGRAM_BOT_TOKEN: "bot", TELEGRAM_CHAT_ID: "42" }, null);
  } finally {
    globalThis.fetch = original;
  }
  const betreff = gesendet[0].text.split("\n")[2];
  const innen = /^Betreff: „(.*)“$/.exec(betreff)?.[1] || "";
  assert.match(innen, /^Frage Frage .*…$/, betreff);
  assert.ok(innen.length <= 120, betreff);
  assert.equal(gesendet[0].text.split("\n")[1], "Von: anna@example.org");
});
