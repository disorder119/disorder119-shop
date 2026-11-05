import assert from "node:assert/strict";
import test from "node:test";

import { handleIncomingEmail, handlePostfach, kopfDekodieren, mailLesen, postfachMeldungNachholen, postfachText } from "./postfach.js";
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

test("DHL-Auftragsbestaetigung wird gespeichert und an die Marken-Zuordnung gegeben", async () => {
  const DB = sqliteD1(allMigrations());
  const roh = [
    "From: DHL <noreply@dhl.com>",
    "To: kontakt@disorder119.com",
    "Subject: =?UTF-8?Q?Auftragsbest=C3=A4tigung_Ihrer_Online_Frankierung_ABCDEF123456?=",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Warenkorb-Nr.: ABCDEF123456",
  ].join("\r\n");
  const bytes = new TextEncoder().encode(roh);
  const warten = [];
  const message = {
    from: "noreply@dhl.com", to: "kontakt@disorder119.com",
    raw: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
    forward: async () => {},
    setReject: () => { throw new Error("darf nicht abweisen"); },
  };
  await handleIncomingEmail(message, { DB }, { waitUntil: p => warten.push(p) });
  await Promise.all(warten);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM postfach").get().n, 1);
  // Keine offene Marke: nichts zugeordnet, aber auch kein Fehler.
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM dhl_qr_marken").get().n, 0);
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


// ------------------------------------------------ Anhaenge, HTML, Loeschen, DHL-Marke
const ADMIN_ORIGIN = "https://admin.disorder119.com";

function eingang(roh) {
  const bytes = new TextEncoder().encode(roh);
  return {
    from: "noreply@dhl.com", to: "kontakt@disorder119.com",
    raw: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
    forward: async () => {},
    setReject: () => { throw new Error("darf nicht abweisen"); },
  };
}

async function adminApi(env, pfad, method = "GET") {
  const req = new Request(`https://api.disorder119.com${pfad}`, { method, headers: { Origin: ADMIN_ORIGIN, Authorization: "Bearer test-token" } });
  return handlePostfach(req, env, new URL(req.url), "req-test", ADMIN_ORIGIN);
}

const mitAnhang = [
  "From: DHL <noreply@dhl.com>",
  "To: kontakt@disorder119.com",
  "Subject: Ihre Paketmarke",
  "Content-Type: multipart/mixed; boundary=\"aussen\"",
  "",
  "--aussen",
  "Content-Type: multipart/related; boundary=\"rel\"",
  "",
  "--rel",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<p>Hallo <img src=\"cid:logo1\" alt=\"DHL\"></p>",
  "--rel",
  "Content-Type: image/png",
  "Content-ID: <logo1>",
  "Content-Disposition: inline",
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).toString("base64"),
  "--rel--",
  "--aussen",
  "Content-Type: application/pdf; name=\"Paketmarke.pdf\"",
  "Content-Disposition: attachment; filename=\"Paketmarke.pdf\"",
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("%PDF-1.4 marke").toString("base64"),
  "--aussen--",
].join("\r\n");

test("Anhaenge und HTML: gespeichert, angezeigt, ausgeliefert und mit der Mail geloescht", async () => {
  const DB = sqliteD1(allMigrations());
  const env = { DB, ADMIN_TOKEN: "test-token" };
  await handleIncomingEmail(eingang(mitAnhang), env, null);

  const liste = await (await adminApi(env, "/admin/postfach")).json();
  assert.equal(liste.mails.length, 1);
  assert.equal(liste.mails[0].attachmentCount, 1, "eingebettetes Logo zaehlt nicht als Anhang");
  assert.equal(liste.mails[0].dhl, true);
  const id = liste.mails[0].id;

  const { mail } = await (await adminApi(env, `/admin/postfach/${id}`)).json();
  assert.match(mail.html, /cid:logo1/);
  const pdf = mail.files.find(f => !f.inline);
  const bild = mail.files.find(f => f.inline);
  assert.equal(pdf.name, "Paketmarke.pdf");
  assert.equal(pdf.stored, true);
  assert.equal(bild.cid, "logo1");
  assert.equal(bild.type, "image/png");

  const r = await adminApi(env, `/admin/postfach/${id}/anhang/${pdf.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Content-Type"), "application/pdf");
  assert.match(r.headers.get("Content-Security-Policy"), /sandbox/);
  assert.equal(Buffer.from(await r.arrayBuffer()).toString(), "%PDF-1.4 marke");

  assert.equal((await adminApi(env, `/admin/postfach/${id}`, "DELETE")).status, 200);
  assert.equal((await (await adminApi(env, "/admin/postfach")).json()).mails.length, 0);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM postfach_anhaenge").get().n, 0);
});

test("Anhang als HTML wird nie im API-Kontext angezeigt, sondern heruntergeladen", async () => {
  const DB = sqliteD1(allMigrations());
  const env = { DB, ADMIN_TOKEN: "test-token" };
  const roh = [
    "From: Kunde <kunde@example.com>", "To: kontakt@disorder119.com", "Subject: Datei",
    "Content-Type: multipart/mixed; boundary=\"x\"", "",
    "--x", "Content-Type: text/plain; charset=utf-8", "", "Siehe Anhang",
    "--x", "Content-Type: text/html; name=\"boese.html\"", "Content-Disposition: attachment; filename=\"boese.html\"", "",
    "<script>alert(1)</script>",
    "--x--",
  ].join("\r\n");
  await handleIncomingEmail(eingang(roh), env, null);
  const id = DB.raw.prepare("SELECT id FROM postfach").get().id;
  const { mail } = await (await adminApi(env, `/admin/postfach/${id}`)).json();
  const datei = mail.files[0];
  const r = await adminApi(env, `/admin/postfach/${id}/anhang/${datei.id}`);
  assert.equal(r.headers.get("Content-Type"), "application/octet-stream");
  assert.match(r.headers.get("Content-Disposition"), /^attachment;/);
});

test("DHL-Auftragsbestaetigung zeigt die gekaufte Marke (QR-Code) direkt in der Mail", async () => {
  const DB = sqliteD1(allMigrations());
  DB.raw.exec("PRAGMA foreign_keys=OFF");
  DB.raw.prepare(`INSERT INTO dhl_qr_marken (id,order_id,cart_id,product_id,entry_url,state,price_cents,shipment_number,pak_id,qr_png_b64,created_at,updated_at)
    VALUES ('m1','o1','QM73WSTKZNES','PAK02','https://www.dhl.de/x','PAYED',619,'358088742443','HW6C643NL','iVBORw0KGgo','2026-11-04T12:00:00Z','2026-11-04T12:00:00Z')`).run();
  const env = { DB, ADMIN_TOKEN: "test-token" };
  const roh = [
    "From: DHL <noreply@dhl.com>", "To: kontakt@disorder119.com",
    "Subject: =?UTF-8?Q?Auftragsbest=C3=A4tigung_Ihrer_Online_Frankierung_QM73WSTKZNES?=",
    "Content-Type: text/plain; charset=utf-8", "",
    "1. 2 kg - Paket / 6,19 €",
    "Warenkorb-Nr.: QM73WSTKZNES",
    "Zum Warenkorb: https://www.dhl.de/int-versenden/gw/rest/init?token=abc",
  ].join("\r\n");
  const warten = [];
  await handleIncomingEmail(eingang(roh), env, { waitUntil: q => warten.push(q) });
  await Promise.all(warten);
  const id = DB.raw.prepare("SELECT id FROM postfach").get().id;
  const { mail } = await (await adminApi(env, `/admin/postfach/${id}`)).json();
  assert.equal(mail.marke.warenkorb, "QM73WSTKZNES");
  assert.equal(mail.marke.sendungsnummer, "358088742443");
  assert.match(mail.marke.qrPng, /^data:image\/png;base64,/);
  assert.deepEqual(mail.links, ["https://www.dhl.de/int-versenden/gw/rest/init?token=abc"]);
});


// ------------------------------------------------ Postausgang und selbst schreiben
import { sendMail } from "./customer-mail.js";

function brevoFake() {
  const anfragen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    anfragen.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    return Response.json({ messageId: "<brevo-1@smtp-relay.mailin.fr>" }, { status: 201 });
  };
  return { anfragen, restore() { globalThis.fetch = original; } };
}

async function adminPost(env, pfad, body) {
  const req = new Request(`https://api.disorder119.com${pfad}`, {
    method: "POST", headers: { Origin: ADMIN_ORIGIN, Authorization: "Bearer test-token", "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return handlePostfach(req, env, new URL(req.url), "req-test", ADMIN_ORIGIN);
}

const MAIL_ENV = { MAIL_API_KEY: "brevo-test", MAIL_FROM: "bestellung@disorder119.com", ADMIN_TOKEN: "test-token" };

test("jede verschickte Mail steht mit Inhalt im Postausgang, Anmeldelinks nur ohne Inhalt", async () => {
  const DB = sqliteD1(allMigrations());
  const env = { DB, ...MAIL_ENV };
  const brevo = brevoFake();
  try {
    await sendMail(env, { to: "kundin@example.com", subject: "Dein Paket ist unterwegs", html: "<p>Sendungsnummer 123</p>", text: "Sendungsnummer 123", tag: "shipping-confirmation" });
    await sendMail(env, { to: "kundin@example.com", subject: "Dein Anmeldelink", html: "<a href='https://x/?anmeldung=GEHEIM'>Login</a>", text: "GEHEIM", tag: "login-link" });
  } finally { brevo.restore(); }
  const zeilen = DB.raw.prepare("SELECT tag, html, text, vertraulich, status FROM postausgang ORDER BY gesendet_am, rowid").all();
  assert.equal(zeilen.length, 2);
  const versand = zeilen.find(z => z.tag === "shipping-confirmation");
  assert.equal(versand.status, "GESENDET");
  assert.match(versand.html, /Sendungsnummer 123/);
  const login = zeilen.find(z => z.tag === "login-link");
  assert.equal(login.vertraulich, 1);
  assert.equal(login.html, null);
  assert.equal(login.text, null);

  const liste = await (await adminApi(env, "/admin/postfach?ordner=gesendet")).json();
  assert.equal(liste.mails.length, 2);
  const eintrag = liste.mails.find(m => m.tag === "shipping-confirmation");
  assert.equal(eintrag.tagName, "Versand");
  const { mail } = await (await adminApi(env, `/admin/postfach/gesendet/${eintrag.id}`)).json();
  assert.match(mail.html, /Sendungsnummer 123/);
});

test("Mail selbst schreiben: Shop-Design, Antwort im selben Verlauf, steht unter Gesendet", async () => {
  const DB = sqliteD1(allMigrations());
  const env = { DB, ...MAIL_ENV };
  await handleIncomingEmail(eingang([
    "From: Anna <anna@example.org>", "To: kontakt@disorder119.com", "Subject: Frage zur Jacke", "Message-ID: <frage-1@example.org>",
    "Content-Type: text/plain; charset=utf-8", "", "Ist die Jacke noch da?",
  ].join("\r\n")), env, null);
  const original = DB.raw.prepare("SELECT id FROM postfach").get().id;

  const vorschau = await (await adminPost(env, "/admin/postfach/vorschau", { subject: "Re: Frage zur Jacke", text: "Hallo Anna,\n\nja, sie ist noch da: https://disorder119.com/artikel/12/" })).json();
  assert.match(vorschau.html, /Hallo Anna,/);
  assert.match(vorschau.html, /<a href="https:\/\/disorder119\.com\/artikel\/12\/"/);

  const brevo = brevoFake();
  let antwort;
  try {
    antwort = await adminPost(env, "/admin/postfach/senden", { to: "anna@example.org", subject: "Re: Frage zur Jacke", text: "Hallo Anna,\n\nja, sie ist noch da.", antwortAuf: original });
  } finally { brevo.restore(); }
  assert.equal(antwort.status, 200, await antwort.clone().text());
  const gesendet = brevo.anfragen[0].body;
  assert.equal(gesendet.to[0].email, "anna@example.org");
  assert.equal(gesendet.replyTo.email, "kontakt@disorder119.com");
  assert.equal(gesendet.headers["In-Reply-To"], "<frage-1@example.org>");
  assert.match(gesendet.htmlContent, /DISORDER119/);
  const zeile = DB.raw.prepare("SELECT art, tag, antwort_auf FROM postausgang").get();
  assert.equal(zeile.art, "MANUELL");
  assert.equal(zeile.tag, "antwort");
  assert.equal(zeile.antwort_auf, original);

  const fehler = await adminPost(env, "/admin/postfach/senden", { to: "keine-adresse", subject: "x", text: "y" });
  assert.equal(fehler.status, 400);
});


// ------------------------------------------------ Fruehere Mails aus Brevo nachholen
import { postausgangNachholen } from "./postausgang-nachholen.js";

test("fruehere Shop-Mails kommen einmalig aus dem Brevo-Protokoll in Gesendet", async () => {
  const DB = sqliteD1(allMigrations());
  DB.raw.prepare("INSERT INTO newsletter_subscribers (id, email_normalized, email_canonical, status, consent_text, consent_version, requested_at, updated_at) VALUES ('n1','kundin@example.com','kundin@example.com','CONFIRMED','ja','2026-10-03','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')").run();
  const env = { DB, MAIL_API_KEY: "brevo-test", MAIL_BCC: "disorder119shop@gmail.com" };
  const aufrufe = [];
  const fake = async (url) => {
    const u = String(url); aufrufe.push(u);
    if (u.includes("/smtp/emails?")) {
      if (!u.includes("startDate=2026-10-01")) return Response.json({});
      return Response.json({ transactionalEmails: [
        { email: "kundin@example.com", subject: "Willkommen", messageId: "<a@relay>", uuid: "u-1", date: "2026-10-03T10:00:00+02:00", tags: ["newsletter-willkommen"] },
        { email: "kundin@example.com", subject: "Bitte bestaetigen", messageId: "<b@relay>", uuid: "u-2", date: "2026-10-03T09:00:00+02:00", tags: ["newsletter-bestaetigung"] },
      ] });
    }
    if (u.endsWith("/u-1")) return Response.json({ body: "<p>Hallo im Club</p>", events: [{ name: "delivered" }] });
    return new Response("nein", { status: 404 });
  };
  const r = await postausgangNachholen(env, Date.parse("2026-11-05T12:00:00Z"), { fetchImpl: fake });
  assert.equal(r.neu, 2);
  assert.equal(r.fertig, true);
  assert.ok(!aufrufe.some((u) => u.endsWith("/u-2")), "Bestaetigungslink-Inhalt wird nicht abgerufen");
  const zeilen = DB.raw.prepare("SELECT tag, html, vertraulich, status FROM postausgang ORDER BY gesendet_am").all();
  assert.equal(zeilen.find((z) => z.tag === "newsletter-bestaetigung").html, null);
  assert.equal(zeilen.find((z) => z.tag === "newsletter-bestaetigung").vertraulich, 1);
  assert.match(zeilen.find((z) => z.tag === "newsletter-willkommen").html, /Hallo im Club/);
  const zweiter = await postausgangNachholen(env, Date.parse("2026-11-05T12:15:00Z"), { fetchImpl: fake });
  assert.equal(zweiter.skipped, "DONE");
});
