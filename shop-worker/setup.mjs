#!/usr/bin/env node
// Gefuehrter Einrichtungs-Assistent fuer den Disorder119-Shop-Worker.
//
//   cd shop-worker
//   node setup.mjs            # kompletter Durchgang (setzt dort fort, wo du warst)
//   node setup.mjs --status   # nur pruefen: was ist gesetzt, was fehlt
//   node setup.mjs --alles    # auch bewusst uebersprungene Optionen nochmal anbieten
//   node setup.mjs --live     # nach dem Sandbox-Test: PayPal und DHL auf echten Betrieb
//
// Der Assistent oeffnet die jeweils passende Anbieter-Seite im Browser, erklaert
// welcher Wert wohin gehoert und uebergibt ihn direkt an Cloudflare. Geheime
// Werte tippst du in die versteckte Eingabe von Wrangler; sie landen nie in
// einer Datei im Repository. Nur oeffentliche Werte (Worker-Adresse, PayPal
// Client ID, Turnstile Site-Key, D1-Datenbank-ID) werden in Dateien
// geschrieben, die du anschliessend per Pull Request uebernimmst.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const TOML_PATH = path.join(HERE, "wrangler.toml");
const SHOP_CONFIG_PATH = path.join(REPO, "config", "shop-config.json");
const STATE_PATH = path.join(HERE, ".wrangler", "setup-state.json");
const DB_NAME = "disorder119-shop";
const IS_WINDOWS = process.platform === "win32";

// ------------------------------------------------------------------ Ausgabe

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = code => text => (useColor ? `\x1b[${code}m${text}\x1b[0m` : String(text));
const bold = paint("1");
const dim = paint("2");
const green = paint("32");
const yellow = paint("33");
const red = paint("31");
const cyan = paint("36");

function line(text = "") { process.stdout.write(`${text}\n`); }
function heading(num, total, title) {
  line();
  line(bold(cyan(`━━ Schritt ${num}/${total} · ${title} `.padEnd(64, "━"))));
}
function ok(text) { line(`${green("✓")} ${text}`); }
function warn(text) { line(`${yellow("!")} ${text}`); }
function fail(text) { line(`${red("✗")} ${text}`); }
function info(text) { line(`  ${text}`); }

// ------------------------------------------------------------------ Eingabe
// Fuer jede Frage eine eigene readline-Instanz: waehrend Wrangler selbst fragt
// (Login, versteckte Secret-Eingabe), darf keine zweite Leserin am Terminal
// haengen. SETUP_ANSWERS erlaubt einen automatisierten Testdurchlauf.

const scripted = process.env.SETUP_ANSWERS ? JSON.parse(process.env.SETUP_ANSWERS) : null;

async function ask(question, { fallback = "", validate = null } = {}) {
  for (;;) {
    let answer;
    const prompt = `${bold("?")} ${question}${fallback ? dim(` [${fallback}]`) : ""} `;
    if (scripted) {
      if (!scripted.length) throw new Error(`Testdurchlauf: keine Antwort mehr fuer "${question}"`);
      answer = String(scripted.shift());
      line(`${prompt}${answer}`);
    } else {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try { answer = await rl.question(prompt); } finally { rl.close(); }
    }
    const value = answer.trim() || fallback;
    if (!validate) return value;
    const problem = validate(value);
    if (!problem) return value;
    warn(problem);
  }
}

async function confirm(question, defaultYes = true) {
  const answer = (await ask(`${question} ${dim(defaultYes ? "(J/n)" : "(j/N)")}`)).toLowerCase();
  if (!answer) return defaultYes;
  return ["j", "ja", "y", "yes"].includes(answer);
}

async function pause(text = "Weiter mit Enter, wenn du so weit bist.") {
  await ask(dim(text));
}

// ------------------------------------------------------------------ Browser

function openUrl(url) {
  line(`  ${cyan("↗")} ${url}`);
  if (process.env.SETUP_NO_BROWSER) return;
  const [cmd, args] = IS_WINDOWS
    ? ["cmd", ["/c", "start", "", url.replace(/&/g, "^&")]]
    : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Kein Browser startbar: die Adresse steht oben zum Anklicken.
  }
}

// ------------------------------------------------------------------ Wrangler

function wranglerCommand(args) {
  if (process.env.SETUP_WRANGLER_BIN) return [process.env.SETUP_WRANGLER_BIN, args];
  return ["npx", ["--yes", "wrangler@4", ...args]];
}

// mode: "inherit" (Wrangler spricht selbst mit dir), "capture" (Ausgabe wird
// ausgewertet) oder "input" (Wert wird ueber stdin uebergeben).
function wrangler(args, { mode = "inherit", input = "" } = {}) {
  const [cmd, fullArgs] = wranglerCommand(args);
  const stdio = mode === "inherit" ? "inherit"
    : mode === "capture" ? ["ignore", "pipe", "pipe"]
    : ["pipe", "inherit", "inherit"];
  return new Promise(resolve => {
    const child = spawn(cmd, fullArgs, { cwd: HERE, stdio, shell: IS_WINDOWS, env: process.env });
    let out = "";
    let err = "";
    if (child.stdout) child.stdout.on("data", chunk => { out += chunk; });
    if (child.stderr) child.stderr.on("data", chunk => { err += chunk; });
    if (mode === "input") { child.stdin.write(input); child.stdin.end(); }
    child.on("error", error => resolve({ code: 127, out, err: String(error.message || error) }));
    child.on("close", code => resolve({ code, out, err }));
  });
}

function jsonFrom(text, opener = "[", closer = "]") {
  const start = text.indexOf(opener);
  const end = text.lastIndexOf(closer);
  if (start === -1 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

// ------------------------------------------------------------------ Zustand

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return {}; }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ------------------------------------------------------------------ Dateien

export function upsertD1Block(tomlText, databaseId) {
  const block = [
    "[[d1_databases]]",
    'binding = "DB"',
    `database_name = "${DB_NAME}"`,
    `database_id = "${databaseId}"`,
    'migrations_dir = "migrations"',
  ].join("\n");
  const pattern = /\[\[d1_databases\]\][\s\S]*?(?=\n\[|\s*$)/;
  if (pattern.test(tomlText)) return tomlText.replace(pattern, block);
  return `${tomlText.replace(/\s*$/, "")}\n\n${block}\n`;
}

export function updateShopConfig(configText, values) {
  const config = JSON.parse(configText);
  const next = {};
  for (const [key, value] of Object.entries(config)) {
    next[key] = key in values ? values[key] : value;
    if (key === "shopWorkerUrl" && !("turnstileSiteKey" in config)) {
      next.turnstileSiteKey = values.turnstileSiteKey ?? "";
    }
  }
  return `${JSON.stringify(next, null, 2)}\n`;
}

// ------------------------------------------------------------------ Pruefregeln

const WORKER_URL_RE = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/;
const validators = {
  workerUrl: v => (WORKER_URL_RE.test(v.replace(/\/$/, "")) ? null : "Bitte die volle https://…-Adresse ohne Pfad einfuegen."),
  email: v => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? null : "Das sieht nicht wie eine E-Mail-Adresse aus."),
  optionalEmail: v => (!v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? null : "Das sieht nicht wie eine E-Mail-Adresse aus."),
  turnstileSiteKey: v => (/^[0-9A-Za-z_-]{10,100}$/.test(v) ? null : "Den Site-Key (beginnt meist mit 0x4…) einfuegen, nicht den Secret-Key."),
  paypalClientId: v => (/^[A-Za-z0-9_-]{20,128}$/.test(v) ? null : "Die Client ID ist eine lange Zeichenfolge aus Buchstaben und Ziffern."),
  billingNumber: v => (/^\d{14}$/.test(v) ? null : "Die Abrechnungsnummer hat 14 Ziffern (EKP + 01 + Teilnahme)."),
  environment: v => (["sandbox", "live"].includes(v) ? null : "Bitte sandbox oder live eingeben."),
};

// ------------------------------------------------------------------ Secrets

async function existingSecrets() {
  let result = await wrangler(["secret", "list", "--format", "json"], { mode: "capture" });
  if (result.code !== 0) result = await wrangler(["secret", "list"], { mode: "capture" });
  const parsed = jsonFrom(result.out);
  return new Set(Array.isArray(parsed) ? parsed.map(entry => String(entry.name)) : []);
}

async function putSecret(name, value = null) {
  line(dim(`  → wrangler secret put ${name}`));
  const result = value === null
    ? await wrangler(["secret", "put", name])
    : await wrangler(["secret", "put", name], { mode: "input", input: `${value}\n` });
  if (result.code === 0) ok(`${name} gesetzt.`);
  else fail(`${name} konnte nicht gesetzt werden (Code ${result.code}). Du kannst den Assistenten einfach nochmal starten.`);
  return result.code === 0;
}

function generatedToken() {
  return randomBytes(32).toString("base64url");
}

// ------------------------------------------------------------------ Schritte

const TOTAL = 8;

async function stepWelcome() {
  line();
  line(bold("DISORDER119 · Einrichtungs-Assistent für echte Bestellungen"));
  line(dim("Cloudflare-Backend, Datenbank, Zugangsdaten, PayPal, Mail, Botschutz und DHL-API."));
  line();
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) {
    fail(`Node ${process.versions.node} ist zu alt. Bitte Node 20 oder neuer installieren: https://nodejs.org`);
    process.exit(1);
  }
  ok(`Node ${process.versions.node}`);
  info("Du brauchst gleich nacheinander Zugang zu: Cloudflare, GitHub, Brevo, PayPal Developer");
  info("und – für die DHL-API – zum DHL Geschäftskundenportal und developer.dhl.com.");
  info("Du kannst jederzeit abbrechen (Strg+C) und später weitermachen.");
}

async function stepLogin() {
  heading(1, TOTAL, "Bei Cloudflare anmelden");
  let who = await wrangler(["whoami"], { mode: "capture" });
  if (who.code !== 0 || /not authenticated/i.test(who.out + who.err)) {
    info("Es öffnet sich gleich Cloudflare im Browser. Melde dich an (oder lege ein kostenloses");
    info("Konto an) und bestätige den Zugriff für Wrangler.");
    await pause();
    const login = await wrangler(["login"]);
    if (login.code !== 0) { fail("Anmeldung abgebrochen."); process.exit(1); }
    who = await wrangler(["whoami"], { mode: "capture" });
  }
  const email = (who.out.match(/[^\s'"]+@[^\s'"]+\.[a-z]{2,}/i) || [""])[0];
  ok(`Bei Cloudflare angemeldet${email ? ` als ${email}` : ""}.`);
}

async function stepDatabase(state) {
  heading(2, TOTAL, "Datenbank (D1) anlegen");
  info("D1 ist die private Datenbank für Bestellungen, Zahlungen und Reservierungen.");
  const listDatabases = async () => {
    const res = await wrangler(["d1", "list", "--json"], { mode: "capture" });
    const parsed = jsonFrom(res.out);
    return Array.isArray(parsed) ? parsed : [];
  };
  let found = (await listDatabases()).find(db => db.name === DB_NAME);
  if (!found) {
    info(`Lege Datenbank "${DB_NAME}" an …`);
    const created = await wrangler(["d1", "create", DB_NAME]);
    if (created.code !== 0) { fail("Datenbank konnte nicht angelegt werden."); process.exit(1); }
    found = (await listDatabases()).find(db => db.name === DB_NAME);
  }
  const id = found && (found.uuid || found.database_id || found.id);
  if (!id) { fail("Datenbank-ID nicht gefunden. Bitte `npx wrangler d1 list` prüfen."); process.exit(1); }
  const before = fs.readFileSync(TOML_PATH, "utf8");
  const after = upsertD1Block(before, id);
  if (after !== before) fs.writeFileSync(TOML_PATH, after);
  state.databaseId = id;
  saveState(state);
  ok(`Datenbank "${DB_NAME}" verbunden (ID in wrangler.toml eingetragen).`);
}

async function stepMigrations(state) {
  heading(3, TOTAL, "Datenbank-Tabellen einrichten");
  if (state.migratedAt && !(await confirm(`Bereits am ${state.migratedAt.slice(0, 10)} eingerichtet. Auf neue Migrationen prüfen?`, true))) {
    ok("Übersprungen.");
    return;
  }
  info("Erst das Grundschema, dann alle Migrationen in der richtigen Reihenfolge.");
  info("Cloudflare merkt sich, welche schon gelaufen sind – ein zweiter Lauf ist harmlos.");
  const schema = await wrangler(["d1", "execute", DB_NAME, "--remote", "--file=schema.sql"]);
  if (schema.code !== 0) { fail("Grundschema fehlgeschlagen."); process.exit(1); }
  const migrations = await wrangler(["d1", "migrations", "apply", DB_NAME, "--remote"]);
  if (migrations.code !== 0) { fail("Migrationen fehlgeschlagen."); process.exit(1); }
  state.migratedAt = new Date().toISOString();
  saveState(state);
  ok("Alle Tabellen, Trigger und Schutzregeln sind eingerichtet.");
}

async function stepDeploy(state) {
  heading(4, TOTAL, "Worker veröffentlichen");
  info("Lädt den Shop-Worker zu Cloudflare hoch. Beim allerersten Mal fragt Cloudflare");
  info("eventuell nach einer workers.dev-Subdomain – nimm z. B. „disorder119“.");
  const deployed = await wrangler(["deploy"]);
  if (deployed.code !== 0) { fail("Veröffentlichung fehlgeschlagen."); process.exit(1); }
  line();
  info("Oben in der Ausgabe steht die Adresse deines Workers, z. B.");
  info(dim("https://disorder119-shop-worker.disorder119.workers.dev"));
  const url = await ask("Worker-Adresse:", { fallback: state.workerUrl || "", validate: validators.workerUrl });
  state.workerUrl = url.replace(/\/$/, "");
  saveState(state);
  ok(`Worker läuft unter ${state.workerUrl}`);
}

async function stepSecrets(state) {
  heading(5, TOTAL, "Zugangsdaten sicher hinterlegen");
  info("Geheime Werte gibst du in Wranglers versteckte Eingabe ein – sie erscheinen nicht");
  info("auf dem Bildschirm und landen nur verschlüsselt bei Cloudflare, nie im Repository.");
  const have = await existingSecrets();
  const overwrite = have.size ? await confirm(`${have.size} Werte sind schon gesetzt. Vorhandene überspringen?`, true) === false : false;
  const needs = name => overwrite || !have.has(name);
  const done = name => { if (!needs(name)) ok(`${name} ist schon gesetzt.`); return !needs(name); };
  // Optionales, das du einmal abgelehnt hast, fragt der Assistent nicht bei
  // jedem Lauf erneut - erst wieder mit --alles.
  state.declined = state.declined || {};
  const askAll = process.argv.includes("--alles");
  const offerOptional = async (key, question) => {
    if (state.declined[key] && !askAll) {
      info(dim(`${question.replace(/\?$/, "")} – übersprungen (nachholen mit: node setup.mjs --alles)`));
      return false;
    }
    const yes = await confirm(question, true);
    if (yes) delete state.declined[key]; else state.declined[key] = true;
    saveState(state);
    return yes;
  };

  // --- Admin
  line(); line(bold("Admin-Zugang"));
  const tokens = {};
  for (const name of ["ADMIN_READ_TOKEN", "ADMIN_WRITE_TOKEN"]) {
    // Vorhandene Admin-Schluessel werden nie beilaeufig ersetzt - sonst waere
    // die Admin-App sofort ausgesperrt. Bewusstes Erneuern: --neue-admin-tokens.
    if (have.has(name) && !process.argv.includes("--neue-admin-tokens")) {
      ok(`${name} ist schon gesetzt.`);
      continue;
    }
    tokens[name] = generatedToken();
    await putSecret(name, tokens[name]);
  }
  if (Object.keys(tokens).length) {
    line();
    line(yellow("  Speichere diese Werte JETZT in deinem Passwort-Manager – sie werden nicht nochmal angezeigt:"));
    for (const [name, value] of Object.entries(tokens)) line(`  ${bold(name.padEnd(18))} ${value}`);
    info(dim("ADMIN_WRITE_TOKEN ist der Owner-Schlüssel für die Admin-App (Lesen und Ändern)."));
    await pause("Gespeichert? Weiter mit Enter.");
  }

  // --- GitHub
  line(); line(bold("GitHub (markiert verkaufte Stücke im Katalog)"));
  if (!done("GITHUB_TOKEN")) {
    info("Lege ein Fine-grained Token an:");
    info("• Repository access: Only select repositories → disorder119/disorder119-shop");
    info("• Permissions → Repository → Contents: Read and write (sonst nichts)");
    info("• Ablauf: 1 Jahr, dann erneuern. Kopiere das Token und füge es gleich ein.");
    openUrl("https://github.com/settings/personal-access-tokens/new");
    await pause();
    await putSecret("GITHUB_TOKEN");
  }

  // --- Turnstile
  line(); line(bold("Botschutz (Cloudflare Turnstile)"));
  if (needs("TURNSTILE_SECRET") || !state.turnstileSiteKey) {
    info("Turnstile → „Add widget“: Name „Disorder119 Checkout“, Hostnames disorder119.com und");
    info("www.disorder119.com, Widget Mode „Managed“. Danach siehst du Site Key und Secret Key.");
    openUrl("https://dash.cloudflare.com/?to=/:account/turnstile");
    await pause();
    state.turnstileSiteKey = await ask("Site Key (öffentlich, beginnt meist mit 0x4…):", {
      fallback: state.turnstileSiteKey || "", validate: validators.turnstileSiteKey,
    });
    saveState(state);
    if (needs("TURNSTILE_SECRET")) {
      info("Jetzt den Secret Key in die versteckte Eingabe:");
      await putSecret("TURNSTILE_SECRET");
    }
  } else {
    ok("TURNSTILE_SECRET ist schon gesetzt.");
  }

  // --- Mail
  line(); line(bold("Bestellbestätigung per Mail (Brevo, EU)"));
  if (!done("MAIL_API_KEY")) {
    info("Brevo → SMTP & API → API Keys → „Generate a new API key“, Name „disorder119-shop“.");
    info("Wichtig: Vorher die Domain disorder119.com in Brevo verifizieren (Senders, Domains).");
    openUrl("https://app.brevo.com/settings/keys/api");
    await pause();
    await putSecret("MAIL_API_KEY");
  }
  if (!done("MAIL_FROM")) {
    const from = await ask("Absender-Adresse:", { fallback: "bestellung@disorder119.com", validate: validators.email });
    await putSecret("MAIL_FROM", from);
  }
  if (needs("MAIL_BCC") && await offerOptional("MAIL_BCC", "Rechnungs-Durchschlag an dein eigenes Postfach schicken (MAIL_BCC)?")) {
    const bcc = await ask("Dein Postfach für Durchschläge:", { validate: validators.email });
    await putSecret("MAIL_BCC", bcc);
  }

  // --- PayPal
  line(); line(bold("PayPal"));
  if (needs("PAYPAL_ENVIRONMENT")) {
    info("Starte mit sandbox (Spielgeld). Auf live stellst du erst nach dem Testkauf um.");
    const environment = await ask("PayPal-Umgebung (sandbox/live):", { fallback: "sandbox", validate: validators.environment });
    await putSecret("PAYPAL_ENVIRONMENT", environment);
    state.paypalEnvironment = environment;
    saveState(state);
  } else ok("PAYPAL_ENVIRONMENT ist schon gesetzt.");
  const paypalEnv = state.paypalEnvironment || "sandbox";
  if (needs("PAYPAL_CLIENT_ID") || needs("PAYPAL_CLIENT_SECRET") || !state.paypalClientId) {
    info(`PayPal Developer → Apps & Credentials → Umschalter oben auf „${paypalEnv === "live" ? "Live" : "Sandbox"}“ →`);
    info("„Create App“ (Name „Disorder119 Shop“, Typ Merchant). Dort stehen Client ID und Secret.");
    openUrl("https://developer.paypal.com/dashboard/applications");
    await pause();
    state.paypalClientId = await ask("Client ID (öffentlich):", { fallback: state.paypalClientId || "", validate: validators.paypalClientId });
    saveState(state);
    if (needs("PAYPAL_CLIENT_ID")) await putSecret("PAYPAL_CLIENT_ID", state.paypalClientId);
    if (needs("PAYPAL_CLIENT_SECRET")) {
      info("Jetzt das Secret (unter der Client ID auf „Show“ klicken) in die versteckte Eingabe:");
      await putSecret("PAYPAL_CLIENT_SECRET");
    }
  } else ok("PayPal Client ID und Secret sind schon gesetzt.");
  if (!done("PAYPAL_WEBHOOK_ID")) {
    info("In derselben App ganz unten „Add Webhook“:");
    info(`• Webhook URL: ${bold(`${state.workerUrl}/paypal-webhook`)}`);
    info("• Event: Payment capture completed (PAYMENT.CAPTURE.COMPLETED)");
    info("Nach dem Speichern zeigt PayPal die Webhook ID – die kommt jetzt in die Eingabe.");
    await pause();
    await putSecret("PAYPAL_WEBHOOK_ID");
  }

  // --- Telegram (optional)
  line(); line(bold("Verkaufsmeldung aufs Handy (Telegram, optional)"));
  if (needs("TELEGRAM_BOT_TOKEN") && await offerOptional("TELEGRAM", "Bei jedem Verkauf eine Telegram-Nachricht bekommen?")) {
    info("In Telegram @BotFather öffnen → /newbot → Namen vergeben → Token kopieren.");
    info("Danach deinem neuen Bot einmal privat „Hallo“ schreiben – der Worker merkt sich den Chat.");
    openUrl("https://t.me/BotFather");
    await pause();
    await putSecret("TELEGRAM_BOT_TOKEN");
  } else if (!needs("TELEGRAM_BOT_TOKEN")) ok("TELEGRAM_BOT_TOKEN ist schon gesetzt.");

  // --- DHL
  line(); line(bold("DHL-Versand per API"));
  const dhlNames = ["DHL_API_KEY", "DHL_USER", "DHL_PASSWORD", "DHL_BILLING_NUMBER", "DHL_ENVIRONMENT"];
  if (dhlNames.some(needs)) {
    info("Voraussetzung: ein DHL-Geschäftskundenvertrag (EKP-Nummer). Den Ablauf dazu zeigt");
    info("dir die Go-Live-Anleitung. Ohne Vertrag kannst du diesen Teil überspringen und");
    info("später mit `node setup.mjs` nachholen – Etiketten gehen bis dahin im Portal.");
    if (await offerOptional("DHL", "DHL-API jetzt einrichten?")) {
      if (needs("DHL_ENVIRONMENT")) {
        info("sandbox = Testetiketten mit den Testzugängen aus der DHL-Doku, live = echte Etiketten.");
        await putSecret("DHL_ENVIRONMENT", await ask("DHL-Umgebung (sandbox/live):", { fallback: "sandbox", validate: validators.environment }));
      }
      if (needs("DHL_API_KEY")) {
        info("developer.dhl.com → Login → „My Apps“ → „+ Create App“ → API „Parcel DE Shipping");
        info("(Post & Parcel Germany)“ hinzufügen. Den „API Key“ der App kopieren.");
        openUrl("https://developer.dhl.com/user/apps");
        await pause();
        await putSecret("DHL_API_KEY");
      }
      if (needs("DHL_USER") || needs("DHL_PASSWORD")) {
        info("Benutzername und Passwort deines Geschäftskundenportals (für sandbox: die");
        info("Testzugangsdaten aus der API-Doku von „Parcel DE Shipping“).");
        openUrl("https://geschaeftskunden.dhl.de");
        if (needs("DHL_USER")) await putSecret("DHL_USER");
        if (needs("DHL_PASSWORD")) await putSecret("DHL_PASSWORD");
      }
      if (needs("DHL_BILLING_NUMBER")) {
        info("Abrechnungsnummer (14 Ziffern) aus dem Geschäftskundenportal → Vertragsdaten:");
        info("EKP (10) + Verfahren 01 (DHL Paket national) + Teilnahme (meist 01).");
        await putSecret("DHL_BILLING_NUMBER", await ask("Abrechnungsnummer:", { validate: validators.billingNumber }));
      }
    } else {
      warn("DHL-API übersprungen – Versandlabels erstellst du vorerst im DHL-Portal.");
    }
  } else ok("DHL-Zugangsdaten sind schon gesetzt.");
}

async function stepHealth(state) {
  heading(6, TOTAL, "Gesundheitscheck");
  if (!state.workerUrl) { warn("Keine Worker-Adresse bekannt – erst Schritt 4 abschließen."); return; }
  let data;
  try {
    const res = await fetch(`${state.workerUrl}/health`);
    data = await res.json();
  } catch (error) {
    fail(`Worker nicht erreichbar: ${error.message}`);
    return;
  }
  const h = data.backendHardening || {};
  const rows = [
    ["Datenbank verbunden", data.dbReady],
    ["Admin-Zugang (Lesen + Schreiben)", h.adminRbacReady],
    ["Kaufen möglich (PayPal + Katalog)", h.checkoutReady],
    ["PayPal-Webhook bereit", h.webhookReady],
    ["Schutz für Live-Betrieb (Ratelimit + Botschutz)", h.productionGuardsReady],
  ];
  for (const [label, value] of rows) (value ? ok : warn)(label);
  info(`PayPal-Umgebung: ${bold(data.environment || h.environment || "?")}`);
}

async function stepFrontend(state) {
  heading(7, TOTAL, "Shop-Webseite verbinden");
  const values = {
    shopWorkerUrl: state.workerUrl || "",
    paypalClientId: state.paypalClientId || "",
    turnstileSiteKey: state.turnstileSiteKey || "",
  };
  info("Diese öffentlichen Werte kommen in config/shop-config.json:");
  for (const [key, value] of Object.entries(values)) info(`${key.padEnd(18)} ${value || dim("(noch leer)")}`);
  info(dim("Der Kaufen-Button bleibt dabei noch AUS (features.paypalCheckout = false)."));
  if (!(await confirm("Jetzt eintragen?", true))) return;
  const before = fs.readFileSync(SHOP_CONFIG_PATH, "utf8");
  fs.writeFileSync(SHOP_CONFIG_PATH, updateShopConfig(before, values));
  ok("config/shop-config.json aktualisiert.");
}

async function stepNext() {
  heading(8, TOTAL, "Übernehmen und testen");
  info("1. Änderungen per Pull Request übernehmen (main nimmt keine Direkt-Pushes an):");
  info(dim("   git checkout -b shop-einrichtung"));
  info(dim("   git add shop-worker/wrangler.toml config/shop-config.json"));
  info(dim('   git commit -m "Shop-Backend verbinden"'));
  info(dim("   git push -u origin shop-einrichtung   → auf GitHub den PR mergen"));
  info("2. Sandbox-Testkauf: in config/shop-config.json features.paypalCheckout auf true,");
  info("   per PR mergen, mit einem PayPal-Sandbox-Käuferkonto ein günstiges Stück kaufen.");
  info("   Danach das Stück in der Admin-App wieder auf verfügbar setzen.");
  info("3. Live: `node setup.mjs --live` – stellt PayPal (und auf Wunsch DHL) auf echten");
  info("   Betrieb um und traegt environment=live in config/shop-config.json ein – per PR.");
  line();
  ok(bold("Einrichtung abgeschlossen. Den Stand prüfst du jederzeit mit: node setup.mjs --status"));
}

async function statusOnly(state) {
  line(bold("DISORDER119 · Status"));
  const have = await existingSecrets();
  const expected = [
    "ADMIN_READ_TOKEN", "ADMIN_WRITE_TOKEN", "GITHUB_TOKEN", "TURNSTILE_SECRET", "MAIL_API_KEY", "MAIL_FROM",
    "PAYPAL_ENVIRONMENT", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID",
  ];
  const optional = ["MAIL_BCC", "TELEGRAM_BOT_TOKEN", "DHL_API_KEY", "DHL_USER", "DHL_PASSWORD", "DHL_BILLING_NUMBER", "DHL_ENVIRONMENT"];
  for (const name of expected) (have.has(name) ? ok : warn)(`${name}${have.has(name) ? "" : " fehlt"}`);
  for (const name of optional) if (have.has(name)) ok(`${name} ${dim("(optional)")}`);
  await stepHealth(state);
}

async function goLive(state) {
  line();
  line(bold("DISORDER119 · Umstellung auf echten Betrieb"));
  info("Nur nach einem erfolgreichen Sandbox-Testkauf. Admin-Schlüssel, Mail, GitHub und");
  info("Botschutz bleiben unverändert; umgestellt werden PayPal und auf Wunsch DHL.");
  if (!(await confirm("Sandbox-Testkauf war erfolgreich und du willst jetzt live gehen?", false))) return;
  await stepLogin();

  line(); line(bold("PayPal Live"));
  info("PayPal Developer → Apps & Credentials → Umschalter oben auf „Live“ → „Create App“.");
  info("Voraussetzung ist ein PayPal-Geschäftskonto.");
  openUrl("https://developer.paypal.com/dashboard/applications/live");
  await pause();
  state.paypalClientId = await ask("Live Client ID (öffentlich):", { validate: validators.paypalClientId });
  saveState(state);
  await putSecret("PAYPAL_CLIENT_ID", state.paypalClientId);
  info("Jetzt das Live-Secret in die versteckte Eingabe:");
  await putSecret("PAYPAL_CLIENT_SECRET");
  info("In der Live-App „Add Webhook“:");
  info(`• Webhook URL: ${bold(`${state.workerUrl || "<deine Worker-Adresse>"}/paypal-webhook`)}`);
  info("• Event: Payment capture completed (PAYMENT.CAPTURE.COMPLETED)");
  await pause();
  await putSecret("PAYPAL_WEBHOOK_ID");
  await putSecret("PAYPAL_ENVIRONMENT", "live");
  state.paypalEnvironment = "live";
  saveState(state);

  line(); line(bold("DHL Live"));
  if (await confirm("DHL-Etiketten ab jetzt echt erzeugen (kostenpflichtig)?", false)) {
    info("Jetzt die echten Zugangsdaten deines Geschäftskundenportals und die echte");
    info("Abrechnungsnummer – nicht die Sandbox-Testdaten.");
    openUrl("https://geschaeftskunden.dhl.de");
    await putSecret("DHL_USER");
    await putSecret("DHL_PASSWORD");
    await putSecret("DHL_BILLING_NUMBER", await ask("Abrechnungsnummer (14 Ziffern):", { validate: validators.billingNumber }));
    await putSecret("DHL_ENVIRONMENT", "live");
  } else {
    warn("DHL bleibt in der Sandbox – echte Etiketten weiter im Portal erstellen.");
  }

  const config = JSON.parse(fs.readFileSync(SHOP_CONFIG_PATH, "utf8"));
  if (!config.turnstileSiteKey && !state.turnstileSiteKey) {
    warn("turnstileSiteKey fehlt – ohne Botschutz lehnt der Worker live jeden Kauf ab. Erst `node setup.mjs` abschließen.");
  }
  const values = { paypalClientId: state.paypalClientId, environment: "live" };
  if (!config.turnstileSiteKey && state.turnstileSiteKey) values.turnstileSiteKey = state.turnstileSiteKey;
  fs.writeFileSync(SHOP_CONFIG_PATH, updateShopConfig(fs.readFileSync(SHOP_CONFIG_PATH, "utf8"), values));
  ok("config/shop-config.json: Live Client ID und environment=live eingetragen.");
  await stepHealth(state);
  line();
  info("Letzter Schritt: config/shop-config.json per Pull Request übernehmen. Nach dem");
  info("automatischen Rebuild kaufen Kundinnen mit echtem Geld. Direkt danach eine");
  info("Testbestellung mit kleinem Betrag machen und im PayPal-Konto erstatten.");
}

async function main() {
  const state = loadState();
  if (process.argv.includes("--status")) return statusOnly(state);
  if (process.argv.includes("--live")) return goLive(state);
  await stepWelcome();
  await stepLogin();
  await stepDatabase(state);
  await stepMigrations(state);
  await stepDeploy(state);
  await stepSecrets(state);
  await stepHealth(state);
  await stepFrontend(state);
  await stepNext();
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch(error => {
    line();
    fail(`Abgebrochen: ${error.message}`);
    info("Starte `node setup.mjs` einfach nochmal – erledigte Schritte werden erkannt.");
    process.exit(1);
  });
}
