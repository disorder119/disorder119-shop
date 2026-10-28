import assert from "node:assert/strict";
import test from "node:test";

import { subscribe, IP_MAILS_PER_HOUR, MAILS_PER_ADDRESS_DAY, NEWSLETTER_DAILY_CAP } from "./newsletter.js";
import { requestLoginLink } from "./customer-account.js";
import { formatWithdrawalReceipt } from "./customer-mail.js";
import { OEFFENTLICHE_MAILS_JE_TAG, linksEntschaerfen, oeffentlicheMailsJeTag } from "./oeffentliche-mails.js";
import { telegramFremd, telegramZeile, wohlgeformt, sendTelegramMessage } from "./notifications.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const T0 = Date.parse("2026-10-28T10:00:00Z");
const MIN = 60_000;

function mailStub() {
  const gesendet = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith("/v3/smtp/email")) { gesendet.push(JSON.parse(init.body)); return new Response(JSON.stringify({ messageId: "<m>" }), { status: 201 }); }
    if (u === "https://disorder119.com/data/catalog.json") return new Response("[]", { status: 200 });
    if (u.startsWith("https://api.telegram.org/")) { gesendet.push({ telegram: JSON.parse(init.body).text }); return Response.json({ ok: true, result: { message_id: 1 } }); }
    return new Response(null, { status: 204 });
  };
  return { gesendet, mails: () => gesendet.filter(g => !g.telegram), restore: () => { globalThis.fetch = original; } };
}

const umgebung = (extra = {}) => ({ DB: sqliteD1(allMigrations()), MAIL_API_KEY: "k", MAIL_FROM: "kontakt@disorder119.com", ...extra });
const anmelden = (e, email, ip, t) => subscribe(e, { email, consent: true, lang: "de" }, { ip, now: new Date(t) });

test("Newsletter: je Postfach hoechstens 3 Bestaetigungsmails am Tag - auch mit erneuter Anmeldung alle 10 Minuten", async () => {
  const stub = mailStub();
  try {
    const e = umgebung();
    const ergebnisse = [];
    for (let i = 0; i < 8; i++) ergebnisse.push((await anmelden(e, "opfer+x@gmail.com", `netz-${i}`, T0 + i * 11 * MIN)).reason || "gesendet");
    assert.equal(stub.mails().length, MAILS_PER_ADDRESS_DAY);
    assert.deepEqual(ergebnisse.slice(MAILS_PER_ADDRESS_DAY), Array(8 - MAILS_PER_ADDRESS_DAY).fill("ADDRESS_RATE_LIMITED"));
    // Schreibweisen desselben Postfachs zaehlen gemeinsam (kanonisch).
    assert.equal((await anmelden(e, "o.p.f.e.r@googlemail.com", "netz-x", T0 + 2 * 3_600_000)).reason, "ADDRESS_RATE_LIMITED");
    // Am naechsten Tag wieder.
    assert.equal((await anmelden(e, "opfer@gmail.com", "netz-y", T0 + 25 * 3_600_000)).queued, true);
  } finally { stub.restore(); }
});

test("Newsletter: je Anschluss 10 Mails in der Stunde, insgesamt 50 am Tag", async () => {
  const stub = mailStub();
  try {
    const e = umgebung();
    for (let i = 0; i < 12; i++) await anmelden(e, `opfer${i}@example.org`, "ein-netz", T0 + i * MIN);
    assert.equal(stub.mails().length, IP_MAILS_PER_HOUR);
    assert.equal((await anmelden(e, "noch@example.org", "ein-netz", T0 + 20 * MIN)).reason, "IP_RATE_LIMITED");
    assert.equal((await anmelden(e, "spaeter@example.org", "ein-netz", T0 + 61 * MIN)).queued, true, "eine Stunde spaeter wieder");
    const e2 = umgebung();
    const stub2 = stub.mails().length;
    for (let i = 0; i < NEWSLETTER_DAILY_CAP + 5; i++) await anmelden(e2, `x${i}@example.org`, `netz-${i}`, T0 + i * 1000);
    assert.equal(stub.mails().length - stub2, NEWSLETTER_DAILY_CAP);
    assert.equal((await anmelden(e2, "y@example.org", "netz-neu", T0 + 3_600_000)).reason, "DAILY_CAP");
  } finally { stub.restore(); }
});

test("Gemeinsames Tagesbudget: Newsletter und Anmeldelinks stoppen, Bestellmails nie", async () => {
  const stub = mailStub();
  try {
    const e = umgebung({ OEFFENTLICHE_MAILS_JE_TAG: "3" });
    assert.equal(oeffentlicheMailsJeTag({}), OEFFENTLICHE_MAILS_JE_TAG);
    assert.equal(oeffentlicheMailsJeTag({ OEFFENTLICHE_MAILS_JE_TAG: "9999" }), 280, "nie das ganze Brevo-Kontingent");
    const jetzt = Date.now();
    assert.equal((await anmelden(e, "a@example.org", "n1", jetzt)).queued, true);
    assert.equal((await requestLoginLink(e, "b@example.org", "r1", "n2")).queued, true);
    assert.equal((await anmelden(e, "c@example.org", "n3", jetzt)).queued, true);
    assert.equal(stub.mails().length, 3);
    // Budget voll: weder Newsletter noch Anmeldelink - nach aussen gleiche Antwort.
    assert.equal((await anmelden(e, "d@example.org", "n4", jetzt)).reason, "DAILY_CAP");
    assert.deepEqual(await requestLoginLink(e, "e@example.org", "r2", "n5"), { queued: false, reason: "DAILY_CAP" });
    assert.equal(stub.mails().length, 3);
    // Der Anmeldelink nach einem Kauf ("Konto anlegen") gehoert zur Bestellung.
    assert.equal((await requestLoginLink(e, "kaeuferin@example.org", "r3", "", { oeffentlich: false })).queued, true);
    assert.equal(stub.mails().length, 4);
  } finally { stub.restore(); }
});

test("Widerrufs-Bestaetigung: Freitext ohne klickbare Links", () => {
  const { text } = formatWithdrawalReceipt({
    id: "abc", name: "Gewinn! www.evil.example/login", email: "opfer@example.org", bestellnummer_eingabe: "https://evil.example/x",
    umfang: "TEIL", teile_text: "Jacke, siehe evil.example", nachricht: "Konto gesperrt: https://evil.example/login?u=1 oder mail@evil.example",
    eingegangen_at: new Date(T0).toISOString(),
  });
  assert.doesNotMatch(text, /https?:\/\/evil|evil\.example|www\.evil/);
  assert.match(text, /evil․example/);
  assert.match(text, /E-Mail: opfer@example\.org/, "die eigene Adresse bleibt lesbar");
  assert.equal(linksEntschaerfen("Preis 12.50 € bei shop.example, @name"), "Preis 12․50 € bei shop․example, ＠name");
});

test("Telegram: Fremdtext nicht klickbar, Richtungszeichen weg, abgeschnittene Emojis wohlgeformt", async () => {
  assert.equal(telegramFremd("https://evil.example/x @admin"), "https:⁄⁄evil․example/x ＠admin");
  assert.equal(wohlgeformt("a\uD83D"), "a�");
  assert.equal(wohlgeformt("😀"), "😀");
  // telegramZeile schneidet mitten im Emoji: trotzdem gueltiger Text.
  const zeile = telegramZeile("x".repeat(118) + "😀😀", 120);
  assert.equal(zeile, wohlgeformt(zeile));
  const stub = mailStub();
  try {
    await sendTelegramMessage({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "42" }, "Hallo ‮evil‬ Welt \uD83D");
    const text = stub.gesendet.at(-1).telegram;
    assert.equal(text, "Hallo evil Welt �");
  } finally { stub.restore(); }
});
