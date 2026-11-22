// Kleiner PDF-Schreiber ohne Bibliothek: Textseiten A4 mit Helvetica (Standard-14-
// Schrift, WinAnsi) fuer Rechnung sowie AGB und Widerrufsbelehrung als Anhang der
// Kundenmails. Kein Bild, keine Einbettung - dafuer wenige Kilobyte, reproduzierbar
// und ohne Abhaengigkeit im Worker.
//
//   const pdf = new PdfText({ titel: "Rechnung 2026-002" });
//   pdf.ueberschrift("Rechnung"); pdf.absatz("..."); pdf.tabelle([...]);
//   const bytes = pdf.bytes();   // Uint8Array
//   const b64 = pdf.base64();    // fuer Brevo attachment.content

const BREITE = 595.28, HOEHE = 841.89;           // A4 in pt
const RAND_L = 56, RAND_R = 56, RAND_O = 60, RAND_U = 60;
const ZEILE = 1.4;

// Zeichenbreiten Helvetica (AFM, 1/1000 em) fuer WinAnsi - fuer den Umbruch.
const BREITEN_REGULAR = {
  " ": 278, "!": 278, "\"": 355, "#": 556, "$": 556, "%": 889, "&": 667, "'": 191, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  "{": 334, "|": 260, "}": 334, "~": 584, "€": 556, "–": 556, "—": 1000, "„": 333, "“": 333, "”": 333, "‚": 222, "‘": 222, "’": 222, "•": 350, "…": 1000,
  "§": 556, "°": 400, "ä": 556, "ö": 556, "ü": 556, "Ä": 667, "Ö": 778, "Ü": 722, "ß": 611, "é": 556, "è": 556, "à": 556, "ç": 500, "ê": 556, "î": 278, "ô": 556, "û": 556, "·": 278, "×": 584, "«": 556, "»": 556,
};
const BREITEN_FETT = {
  " ": 278, "!": 333, "\"": 474, "#": 556, "$": 556, "%": 889, "&": 722, "'": 238, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556, ":": 333, ";": 333, "<": 584, "=": 584, ">": 584, "?": 611, "@": 975,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 333, "\\": 278, "]": 333, "^": 584, _: 556, "`": 333,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
  "{": 389, "|": 280, "}": 389, "~": 584, "€": 556, "–": 556, "—": 1000, "„": 500, "“": 500, "”": 500, "‚": 278, "‘": 278, "’": 278, "•": 350, "…": 1000,
  "§": 556, "°": 400, "ä": 556, "ö": 611, "ü": 611, "Ä": 722, "Ö": 778, "Ü": 722, "ß": 611, "é": 556, "è": 556, "à": 556, "ç": 556, "ê": 556, "î": 278, "ô": 611, "û": 611, "·": 278, "×": 584, "«": 556, "»": 556,
};

// WinAnsi: Latin-1 plus die Sonderzeichen in 0x80-0x9F.
const WINANSI_EXTRA = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e };
const ERSATZ = { " ": " ", " ": " ", " ": " ", "→": "->", "✓": "+", "☐": "[ ]", "★": "*", "‐": "-", "‑": "-", "−": "-", "′": "'", "″": "\"" };

export function winAnsi(text) {
  const out = [];
  for (const ch of String(text ?? "").normalize("NFC")) {
    const e = ERSATZ[ch];
    if (e !== undefined) { for (const c of e) out.push(c.charCodeAt(0)); continue; }
    const code = ch.codePointAt(0);
    if (code === 0x0a || code === 0x09) { out.push(0x20); continue; }
    if (code < 0x20) continue;
    if (code <= 0x7e) { out.push(code); continue; }
    if (code >= 0xa0 && code <= 0xff) { out.push(code); continue; }
    if (WINANSI_EXTRA[ch] !== undefined) { out.push(WINANSI_EXTRA[ch]); continue; }
    out.push(0x3f); // ?
  }
  return out;
}

function textBreite(text, groesse, fett) {
  const tab = fett ? BREITEN_FETT : BREITEN_REGULAR;
  let summe = 0;
  for (const ch of String(text)) summe += tab[ch] ?? (/[A-Z]/.test(ch) ? 700 : 556);
  return summe * groesse / 1000;
}

function umbrechen(text, groesse, fett, breite) {
  const zeilen = [];
  for (const absatz of String(text ?? "").split("\n")) {
    const woerter = absatz.split(/\s+/).filter(Boolean);
    if (!woerter.length) { zeilen.push(""); continue; }
    let zeile = "";
    for (const wort of woerter) {
      const probe = zeile ? `${zeile} ${wort}` : wort;
      if (textBreite(probe, groesse, fett) <= breite || !zeile) zeile = probe;
      else { zeilen.push(zeile); zeile = wort; }
    }
    zeilen.push(zeile);
  }
  return zeilen;
}

function pdfString(bytes) {
  let s = "(";
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += "\\" + String.fromCharCode(b);
    else if (b < 0x20 || b > 0x7e) s += "\\" + b.toString(8).padStart(3, "0");
    else s += String.fromCharCode(b);
  }
  return s + ")";
}

const f2 = n => (Math.round(n * 100) / 100).toFixed(2);

export class PdfText {
  constructor({ titel = "", autor = "Disorder119", kopfzeile = "", fusszeile = "" } = {}) {
    this.titel = titel; this.autor = autor; this.kopfzeile = kopfzeile; this.fusszeile = fusszeile;
    this.seiten = [];
    this.neueSeite();
  }
  neueSeite() {
    this.ops = [];
    this.seiten.push(this.ops);
    this.y = HOEHE - RAND_O;
    if (this.kopfzeile) {
      this.zeile(this.kopfzeile, { groesse: 8, fett: true, farbe: 0.45, x: RAND_L, y: HOEHE - 32 });
    }
  }
  get breite() { return BREITE - RAND_L - RAND_R; }
  platz(hoehe) { if (this.y - hoehe < RAND_U) this.neueSeite(); }
  // Eine Zeile an fester Stelle (ohne Umbruch).
  zeile(text, { groesse = 10, fett = false, farbe = 0, x = RAND_L, y = null, rechts = false } = {}) {
    const bytes = winAnsi(text);
    const yy = y ?? this.y;
    let xx = x;
    if (rechts) xx = x - textBreite(text, groesse, fett);
    this.ops.push(`BT /${fett ? "F2" : "F1"} ${groesse} Tf ${f2(farbe)} g ${f2(xx)} ${f2(yy)} Td ${pdfString(bytes)} Tj ET`);
  }
  abstand(pt = 6) { this.y -= pt; }
  ueberschrift(text, groesse = 18) {
    this.platz(groesse * 2);
    this.y -= groesse;
    this.zeile(text, { groesse, fett: true });
    this.y -= groesse * 0.6;
  }
  absatz(text, { groesse = 10, fett = false, farbe = 0, einzug = 0, nach = 7 } = {}) {
    const zeilen = umbrechen(text, groesse, fett, this.breite - einzug);
    for (const z of zeilen) {
      this.platz(groesse * ZEILE);
      this.y -= groesse * ZEILE;
      if (z) this.zeile(z, { groesse, fett, farbe, x: RAND_L + einzug });
    }
    this.y -= nach;
  }
  // Mehrere kurze Zeilen (Adresse).
  block(zeilen, opts = {}) { for (const z of zeilen) this.absatz(z, { ...opts, nach: 0 }); this.y -= opts.nach ?? 7; }
  linie(farbe = 0.75) {
    this.platz(8);
    this.y -= 4;
    this.ops.push(`${f2(farbe)} G 0.6 w ${f2(RAND_L)} ${f2(this.y)} m ${f2(BREITE - RAND_R)} ${f2(this.y)} l S`);
    this.y -= 6;
  }
  // Tabelle: spalten = [{ titel, breite (Anteil), rechts }], zeilen = [[...], ...]
  tabelle(spalten, zeilen, { groesse = 10 } = {}) {
    const gesamt = spalten.reduce((s, c) => s + (c.breite || 1), 0);
    const breiten = spalten.map(c => this.breite * (c.breite || 1) / gesamt);
    const zeileSchreiben = (zellen, fett) => {
      const umbrueche = zellen.map((z, i) => umbrechen(String(z ?? ""), groesse, fett, breiten[i] - 6));
      const hoehe = Math.max(...umbrueche.map(u => u.length)) * groesse * ZEILE + 6;
      this.platz(hoehe);
      const oben = this.y;
      umbrueche.forEach((u, i) => {
        const x0 = RAND_L + breiten.slice(0, i).reduce((s, b) => s + b, 0);
        u.forEach((t, k) => {
          const yy = oben - groesse * ZEILE * (k + 1) + 2;
          if (spalten[i].rechts) this.zeile(t, { groesse, fett, x: x0 + breiten[i] - 3, y: yy, rechts: true });
          else this.zeile(t, { groesse, fett, x: x0 + 3, y: yy });
        });
      });
      this.y = oben - hoehe;
    };
    zeileSchreiben(spalten.map(c => c.titel), true);
    this.linie(0.2);
    for (const z of zeilen) { zeileSchreiben(z, false); this.linie(0.85); }
  }
  bytes() {
    const objekte = [];
    const add = s => { objekte.push(s); return objekte.length; };
    const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontFett = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const seitenNr = add("PLATZHALTER");
    const seitenIds = [];
    const anzahl = this.seiten.length;
    this.seiten.forEach((ops, i) => {
      const fuss = [];
      const fussText = `${this.fusszeile ? this.fusszeile + " · " : ""}Seite ${i + 1} von ${anzahl}`;
      fuss.push(`BT /F1 8 Tf 0.45 g ${f2(RAND_L)} ${f2(32)} Td ${pdfString(winAnsi(fussText))} Tj ET`);
      const inhalt = [...ops, ...fuss].join("\n");
      const inhaltBytes = new TextEncoder().encode(inhalt);
      const stream = add(`<< /Length ${inhaltBytes.length} >>\nstream\n${inhalt}\nendstream`);
      const seite = add(`<< /Type /Page /Parent ${seitenNr} 0 R /MediaBox [0 0 ${f2(BREITE)} ${f2(HOEHE)}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontFett} 0 R >> >> /Contents ${stream} 0 R >>`);
      seitenIds.push(seite);
    });
    objekte[seitenNr - 1] = `<< /Type /Pages /Kids [${seitenIds.map(id => `${id} 0 R`).join(" ")}] /Count ${anzahl} >>`;
    const katalog = add(`<< /Type /Catalog /Pages ${seitenNr} 0 R >>`);
    const info = add(`<< /Title ${pdfString(winAnsi(this.titel))} /Author ${pdfString(winAnsi(this.autor))} /Producer (Disorder119 Shop) >>`);
    // Datei zusammensetzen (Byte-genau: Latin-1-Strings -> Bytes).
    let kopf = "%PDF-1.4\n%âãÏÓ\n";
    const teile = [kopf];
    const offsets = [];
    let pos = latin1Laenge(kopf);
    objekte.forEach((o, i) => {
      const s = `${i + 1} 0 obj\n${o}\nendobj\n`;
      offsets.push(pos);
      teile.push(s);
      pos += latin1Laenge(s);
    });
    const xref = pos;
    let tab = `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) tab += `${String(off).padStart(10, "0")} 00000 n \n`;
    tab += `trailer\n<< /Size ${objekte.length + 1} /Root ${katalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    teile.push(tab);
    return latin1Bytes(teile.join(""));
  }
  base64() {
    const bytes = this.bytes();
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
}

// Inhalt der Streams ist bereits WinAnsi-kodiert als Oktal-Escapes (ASCII), nur die
// Kopfzeile traegt Bytes > 0x7f - deshalb reicht Latin-1 fuer die ganze Datei.
function latin1Laenge(s) { let n = 0; for (const ch of s) n += ch.codePointAt(0) > 0xffff ? 2 : 1; return n; }
function latin1Bytes(s) {
  const out = new Uint8Array(latin1Laenge(s));
  let i = 0;
  for (const ch of s) { const c = ch.codePointAt(0); out[i++] = c > 0xff ? 0x3f : c; }
  return out;
}

// HTML grob zu Text: fuer AGB/Widerruf, die als HTML in legal-content.json liegen.
export function htmlZuText(html) {
  return String(html ?? "")
    .replace(/<\s*(h[1-6]|p|div|li|tr|br)[^>]*>/gi, "\n")
    .replace(/<\s*\/(h[1-6]|p|div|li|tr|table|ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
