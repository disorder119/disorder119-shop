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
// Hier laeuft das Shop-Backend bereits (Custom Domain im Cloudflare-Dashboard).
const EXISTING_WORKER_URL = "https://api.disorder119.com";

// Je Migration ein Datenbank-Objekt, das genau diese Datei anlegt. Damit
// erkennt der Assistent, welche Migrationen auf einer von Hand eingerichteten
// Datenbank schon laufen, und fuehrt sie nicht ein zweites Mal aus.
export const MIGRATION_MARKERS = Object.freeze({
  "0002_commerce_foundation.sql": "commerce_orders",
  "0003_state_integrity.sql": "trg_order_status_transition",
  "0004_admin_operations.sql": "order_contact_snapshots",
  "0005_rental_groups.sql": "rental_groups",
  "0006_operations_cases.sql": "operations_tasks",
  "0007_operations_automation.sql": "uniq_operations_tasks_automation_key",
  "0008_backend_hardening.sql": "trg_rental_duration_insert",
  "0009_secret_games.sql": "reward_coupons",
  "0010_coupon_checkout.sql": "trg_reward_coupon_redeem_paid_order",
  "0011_customer_accounts.sql": "customer_login_tokens",
  "0012_rechnungsarchiv.sql": "rechnungen",
  "0013_postfach.sql": "postfach_nachrichten",
});

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

export function upsertD1Block(tomlText, databaseId, databaseName = DB_NAME) {
  const block = [
    "[[d1_databases]]",
    'binding = "DB"',
    `database_name = "${databaseName}"`,
    `database_id = "${databaseId}"`,
    'migrations_dir = "migrations"',
  ].join("\n");
  const pattern = /\[\[d1_databases\]\][\s\S]*?(?=\n\[|\s*$)/;
  if (pattern.test(tomlText)) return tomlText.replace(pattern, block);
  return `${tomlText.replace(/\s*$/, "")}\n\n${block}\n`;
}

export function currentD1Binding(tomlText) {
  const block = (tomlText.match(/\[\[d1_databases\]\][\s\S]*?(?=\n\[|\s*$)/) || [""])[0];
  const name = (block.match(/database_name\s*=\s*"([^"]+)"/) || [])[1] || "";
  const id = (block.match(/database_id\s*=\s*"([^"]+)"/) || [])[1] || "";
  return name && id ? { name, id } : null;
}

export function tomlWorkerName(tomlText) {
  return (tomlText.match(/^name\s*=\s*"([^"]+)"/m) || [])[1] || "";
}

export function setTomlWorkerName(tomlText, name) {
  return tomlText.replace(/^name\s*=\s*"[^"]*"/m, `name = "${name}"`);
}

// Liefert die Migrationen, die auf einer bestehenden, von Hand eingerichteten
// Datenbank schon wirksam sind, aber in Cloudflares Buchfuehrung
// (d1_migrations) fehlen. Leer, wenn die Datenbank neu ist oder Wrangler sie
// schon selbst verwaltet.
export function migrationsToBaseline(objectNames, migrationFiles) {
  const names = new Set(objectNames);
  if (names.has("d1_migrations") || !names.has("commerce_orders")) return [];
  return migrationFiles
    .filter(file => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .filter(file => MIGRATION_MARKERS[file] && names.has(MIGRATION_MARKERS[file]))
    .sort();
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
  workerName: v => (/^[a-z0-9][a-z0-9-]{0,62}$/.test(v) ? null : "Worker-Namen bestehen aus Kleinbuchstaben, Ziffern und Bindestrichen."),
};

async function probeHealth(url) {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    return res.ok && String(data.version || "").startsWith("commerce-") ? data : null;
  } catch {
    return null;
  }
}

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

const TOTAL = 9;

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

async function stepExisting(state) {
  heading(2, TOTAL, "Bestehende Installation prüfen");
  const live = await probeHealth(EXISTING_WORKER_URL);
  if (live) {
    state.existing = true;
    if (!state.workerUrl) state.workerUrl = EXISTING_WORKER_URL;
    saveState(state);
    ok(`Dein Shop-Backend läuft bereits unter ${EXISTING_WORKER_URL} (${live.environment || "?"}).`);
    info("Der Assistent aktualisiert diese Installation und legt nichts doppelt an.");
  } else {
    info(`Unter ${EXISTING_WORKER_URL} läuft noch kein Shop-Backend – es wird neu eingerichtet.`);
  }
  // Schutz vor Rueckschritt: Hat das laufende Backend Funktionen, die dieser
  // Code nicht kennt (z. B. Passkey-Anmeldung unter /admin/auth/), wurde es aus
  // einem neueren, nicht gepushten Stand veroeffentlicht. Ein Deploy von hier
  // wuerde diese Funktionen loeschen.
  if (live && !process.env.SETUP_WRANGLER_BIN) {
    const liveAuth = await fetch(`${EXISTING_WORKER_URL}/admin/auth/status`, {
      headers: { Origin: "https://admin.disorder119.com" },
      signal: AbortSignal.timeout(10000),
    }).then(res => res.status === 200).catch(() => false);
    const hiesigerCode = fs.readdirSync(HERE).filter(f => f.endsWith(".js"))
      .some(f => fs.readFileSync(path.join(HERE, f), "utf8").includes("/admin/auth/"));
    if (liveAuth && !hiesigerCode) {
      fail("Dein laufendes Backend ist NEUER als dieser Code (es hat Passkey-Anmeldung, dieser Stand nicht).");
      info("Ein Deploy von hier würde Passkey-Login, Katalog-Speichern und weitere Funktionen löschen.");
      info("Erst den neueren Worker-Code nach GitHub pushen und hier zusammenführen, dann erneut starten.");
      process.exit(1);
    }
  }
  let name = tomlWorkerName(fs.readFileSync(TOML_PATH, "utf8"));
  const found = await wrangler(["deployments", "list", "--json"], { mode: "capture" });
  if (found.code === 0) {
    ok(`Worker „${name}“ gefunden – er wird aktualisiert, nicht neu angelegt.`);
    return;
  }
  if (!live) {
    info(`Worker „${name}“ wird beim Veröffentlichen neu angelegt.`);
    return;
  }
  warn(`In deinem Cloudflare-Konto gibt es keinen Worker namens „${name}“.`);
  info("Dein laufendes Backend heißt also anders. Öffne „Workers & Pages“ und sieh nach, welcher");
  info("Worker die Domain api.disorder119.com hat. Seinen Namen gibst du gleich ein – sonst würde ein");
  info("zweiter Worker entstehen.");
  openUrl("https://dash.cloudflare.com/?to=/:account/workers-and-pages");
  for (;;) {
    name = await ask("Name des laufenden Workers:", { validate: validators.workerName });
    const check = await wrangler(["deployments", "list", "--name", name, "--json"], { mode: "capture" });
    if (check.code === 0) break;
    warn(`Auch „${name}“ wurde nicht gefunden. Bitte genau so abschreiben, wie er im Dashboard steht.`);
  }
  fs.writeFileSync(TOML_PATH, setTomlWorkerName(fs.readFileSync(TOML_PATH, "utf8"), name));
  ok(`wrangler.toml nutzt jetzt den Worker-Namen „${name}“.`);
}

async function stepDatabase(state) {
  heading(3, TOTAL, "Datenbank (D1) verbinden");
  info("D1 ist die private Datenbank für Bestellungen, Zahlungen und Reservierungen.");
  const listDatabases = async () => {
    const res = await wrangler(["d1", "list", "--json"], { mode: "capture" });
    const parsed = jsonFrom(res.out);
    return Array.isArray(parsed) ? parsed : [];
  };
  const idOf = db => db && (db.uuid || db.database_id || db.id);
  const databases = await listDatabases();
  const bound = currentD1Binding(fs.readFileSync(TOML_PATH, "utf8"));
  let chosen = bound ? databases.find(db => idOf(db) === bound.id) : null;
  if (!chosen) chosen = databases.find(db => db.name === DB_NAME) || null;
  if (!chosen && databases.length) {
    info("In deinem Cloudflare-Konto gibt es schon diese Datenbanken:");
    databases.forEach((db, i) => info(`${i + 1}. ${db.name}`));
    info("Wähle die, mit der dein laufendes Backend arbeitet (Workers & Pages → dein Worker →");
    info("Settings → Bindings → DB). Mit „neu“ entsteht eine leere Datenbank.");
    const suggestion = databases.findIndex(db => /disorder|shop/i.test(db.name));
    const answer = await ask("Nummer der Datenbank oder „neu“:", {
      fallback: suggestion >= 0 ? String(suggestion + 1) : "neu",
      validate: v => (v === "neu" || (Number(v) >= 1 && Number(v) <= databases.length) ? null : "Bitte eine Nummer aus der Liste oder „neu“."),
    });
    if (answer !== "neu") chosen = databases[Number(answer) - 1];
    else if (state.existing && !(await confirm("Wirklich eine neue, leere Datenbank? Dein laufendes Backend verliert dann den Zugriff auf seine bisherigen Daten.", false))) {
      process.exit(1);
    }
  }
  if (!chosen) {
    info(`Lege Datenbank "${DB_NAME}" an …`);
    const created = await wrangler(["d1", "create", DB_NAME]);
    if (created.code !== 0) { fail("Datenbank konnte nicht angelegt werden."); process.exit(1); }
    chosen = (await listDatabases()).find(db => db.name === DB_NAME);
  }
  const id = idOf(chosen);
  if (!id) { fail("Datenbank-ID nicht gefunden. Bitte `npx wrangler d1 list` prüfen."); process.exit(1); }
  const before = fs.readFileSync(TOML_PATH, "utf8");
  const after = upsertD1Block(before, id, chosen.name);
  if (after !== before) fs.writeFileSync(TOML_PATH, after);
  state.databaseId = id;
  state.dbName = chosen.name;
  saveState(state);
  ok(`Datenbank "${chosen.name}" verbunden (ID in wrangler.toml eingetragen).`);
}

async function remoteObjectNames(dbName) {
  const res = await wrangler(["d1", "execute", dbName, "--remote", "--json", "--command", "SELECT name FROM sqlite_master"], { mode: "capture" });
  const parsed = jsonFrom(res.out);
  if (!Array.isArray(parsed)) return null;
  return parsed.flatMap(block => (Array.isArray(block?.results) ? block.results : [])).map(row => String(row.name));
}

async function stepMigrations(state) {
  heading(4, TOTAL, "Datenbank-Tabellen einrichten");
  const dbName = state.dbName || DB_NAME;
  if (state.migratedAt && !(await confirm(`Bereits am ${state.migratedAt.slice(0, 10)} eingerichtet. Auf neue Migrationen prüfen?`, true))) {
    ok("Übersprungen.");
    return;
  }
  const names = await remoteObjectNames(dbName);
  if (names === null) { fail("Die Datenbank ließ sich nicht lesen. Bitte Anmeldung und Datenbank prüfen."); process.exit(1); }
  const files = fs.readdirSync(path.join(HERE, "migrations")).filter(f => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const baseline = migrationsToBaseline(names, files);
  if (baseline.length) {
    info("Deine Datenbank wurde bisher von Hand eingerichtet. Damit Cloudflare nichts doppelt");
    info(`ausführt, werden ${baseline.length} bereits vorhandene Migrationen als erledigt vermerkt:`);
    info(dim(baseline.join(", ")));
    if (!(await confirm("Vermerken und fortfahren?", true))) process.exit(1);
    const sql = [
      "CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
      ...baseline.map(file => `INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${file}')`),
    ].join("; ");
    const marked = await wrangler(["d1", "execute", dbName, "--remote", "--yes", "--command", sql]);
    if (marked.code !== 0) { fail("Vermerk fehlgeschlagen – es wurde nichts verändert."); process.exit(1); }
    ok("Vorhandene Migrationen vermerkt.");
  }
  info("Jetzt das Grundschema und alle noch fehlenden Migrationen in der richtigen Reihenfolge.");
  info("Cloudflare merkt sich, welche schon gelaufen sind – ein zweiter Lauf ist harmlos.");
  const schema = await wrangler(["d1", "execute", dbName, "--remote", "--yes", "--file=schema.sql"]);
  if (schema.code !== 0) { fail("Grundschema fehlgeschlagen."); process.exit(1); }
  const migrations = await wrangler(["d1", "migrations", "apply", dbName, "--remote"]);
  if (migrations.code !== 0) { fail("Migrationen fehlgeschlagen."); process.exit(1); }
  state.migratedAt = new Date().toISOString();
  saveState(state);
  ok("Alle Tabellen, Trigger und Schutzregeln sind eingerichtet.");
}

function npmCommand(args) {
  return new Promise(resolve => {
    const child = spawn("npm", args, { cwd: HERE, stdio: "inherit", shell: IS_WINDOWS, env: process.env });
    child.on("error", () => resolve(127));
    child.on("close", code => resolve(code));
  });
}

async function stepDeploy(state) {
  heading(5, TOTAL, "Worker veröffentlichen");
  if (fs.existsSync(path.join(HERE, "package.json")) && !process.env.SETUP_WRANGLER_BIN) {
    info("Installiere die Bausteine des Workers (einmalig) …");
    if (await npmCommand(["ci", "--no-audit", "--no-fund"]) !== 0) {
      fail("npm ci fehlgeschlagen. Bitte Internetverbindung prüfen und nochmal starten.");
      process.exit(1);
    }
  }
  info(state.existing
    ? "Aktualisiert dein laufendes Backend mit dem neuen Code. Zugangsdaten und Domain bleiben erhalten."
    : "Lädt den Shop-Worker zu Cloudflare hoch. Beim ersten Mal fragt Cloudflare eventuell nach einer\n  workers.dev-Subdomain – nimm z. B. „disorder119“.");
  const deployed = await wrangler(["deploy"]);
  if (deployed.code !== 0) { fail("Veröffentlichung fehlgeschlagen."); process.exit(1); }
  line();
  if (!state.existing) {
    info("Oben in der Ausgabe steht die Adresse deines Workers, z. B.");
    info(dim("https://disorder119-shop-worker.disorder119.workers.dev"));
  }
  const url = await ask("Worker-Adresse:", { fallback: state.workerUrl || "", validate: validators.workerUrl });
  state.workerUrl = url.replace(/\/$/, "");
  saveState(state);
  const health = await probeHealth(state.workerUrl);
  if (health) ok(`Worker antwortet unter ${state.workerUrl}`);
  else warn(`Unter ${state.workerUrl} antwortet noch kein Shop-Backend – das kann nach dem ersten Veröffentlichen ein bis zwei Minuten dauern.`);
}

async function stepSecrets(state) {
  heading(6, TOTAL, "Zugangsdaten sicher hinterlegen");
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

  // --- Postfach
  line(); line(bold("Postfach: Mails an bestellung@disorder119.com empfangen"));
  info("Eingehende Mails landen im Postfach deiner Admin-App und zusätzlich als vollständige");
  info("Kopie mit allen Anhängen in deinem normalen Postfach.");
  if (needs("MAIL_FORWARD_TO")) {
    const ziel = await ask("Dein normales Postfach für die Kopie:", { fallback: "disorder119shop@gmail.com", validate: validators.email });
    await putSecret("MAIL_FORWARD_TO", ziel);
  } else ok("MAIL_FORWARD_TO ist schon gesetzt.");
  if (!state.emailRoutingDone || process.argv.includes("--alles")) {
    info("Jetzt in Cloudflare das E-Mail-Routing für disorder119.com einrichten:");
    info("1. „Email Routing“ aktivieren. Cloudflare ersetzt dabei die MX-Einträge der bisherigen");
    info("   Porkbun-Weiterleitung – das ist so gewollt. Weitere Porkbun-Weiterleitungen hier neu anlegen.");
    info("2. „Destination addresses“: dein normales Postfach hinzufügen und die Bestätigungsmail anklicken.");
    info("3. „Routing rules“ → Custom address „bestellung“ → Action „Send to a Worker“ → dein Shop-Worker.");
    info("   Optional: „Catch-all“ ebenfalls an den Worker, dann landet auch kontakt@… im Postfach.");
    info("4. Unter DNS den SPF-Eintrag (TXT, beginnt mit v=spf1) so zusammenführen, dass es nur einen gibt:");
    info(dim("   v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all"));
    openUrl("https://dash.cloudflare.com/?to=/:account/:zone/email/routing/overview");
    await pause("Alles eingerichtet? Weiter mit Enter.");
    state.emailRoutingDone = true;
    saveState(state);
  } else ok("E-Mail-Routing ist eingerichtet.");

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
  heading(7, TOTAL, "Gesundheitscheck");
  if (!state.workerUrl) { warn("Keine Worker-Adresse bekannt – erst Schritt 5 abschließen."); return; }
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
  heading(8, TOTAL, "Shop-Webseite verbinden");
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
  heading(9, TOTAL, "Übernehmen und testen");
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
  const optional = ["MAIL_FORWARD_TO", "MAIL_BCC", "TELEGRAM_BOT_TOKEN", "DHL_API_KEY", "DHL_USER", "DHL_PASSWORD", "DHL_BILLING_NUMBER", "DHL_ENVIRONMENT"];
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
  await stepExisting(state);
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
