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
