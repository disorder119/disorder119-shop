// Texte und Mail fuer das Ruecksendeetikett (ruecksendung.js).
//
// Vier Vorlagen (Inhaber 05.11.2026: "alle 4 sind gut, einfach abwechseln"):
//   A Abschiedsbrief - der Artikel schreibt selbst
//   B Trauerkarte
//   C Trennungsgespraech
//   D Reklamation - ehrlich, das Etikett zahlt der Shop
// Beim Widerruf wechseln A, B und C (dieselbe Bestellung bekommt immer
// dieselbe), bei einer Reklamation immer D. Der Text passt sich dem Artikel an:
// Marke aus dem Katalog, Bezeichnung und Grammatik aus Kategorie und Titel
// ("deine Y-3 Jacke packt", "deine Prada Sneaker packen", "dein Mantel").
//
// Die Ruecksendung geht immer an Joel nach Aschaffenburg (SELLER) - das steht
// auf dem "Ticket" in der Mail und auf dem Etikett selbst.
import { safeText } from "./commerce-core.js";
import { MAIL_FARBE, SELLER, SHOP_URL, escapeHtml, kundenmailRahmen, mailKnopf } from "./customer-mail.js";

export const VORLAGEN = Object.freeze(["A", "B", "C", "D"]);
const WIDERRUF_VORLAGEN = Object.freeze(["A", "B", "C"]);

// Dieselbe Bestellung bekommt immer dieselbe Vorlage, verschiedene wechseln sich ab.
export function vorlageFuer(anlass, bestellnummer = "") {
  if (anlass === "REKLAMATION") return "D";
  let h = 0;
  for (const z of String(bestellnummer)) h = (h * 31 + z.charCodeAt(0)) >>> 0;
  return WIDERRUF_VORLAGEN[h % WIDERRUF_VORLAGEN.length];
}

// ------------------------------------------------------------ Artikel-Grammatik

// genus: f, m, n oder pl (Mehrzahl, z. B. Schuhe).
function teil(nomen, genus) { return { nomen, genus }; }

export function artikelBezeichnung(item = {}) {
  const titel = String(item.title || item.titel || "").toLowerCase();
  const kat = String(item.category || item.kategorie || "");
  if (/sneaker/.test(titel)) return teil("Sneaker", "pl");
  if (/boots|stiefel/.test(titel)) return teil("Boots", "pl");
  if (/sandale/.test(titel)) return teil("Sandalen", "pl");
  if (/hoodie/.test(titel)) return teil("Hoodie", "m");
  if (/weste/.test(titel)) return teil("Weste", "f");
  if (/cap\b|kappe/.test(titel)) return teil("Cap", "f");
  if (/m(ü|ue)tze|beanie/.test(titel)) return teil("Mütze", "f");
  if (/tasche|bag\b/.test(titel)) return teil("Tasche", "f");
  if (/g(ü|ue)rtel/.test(titel)) return teil("Gürtel", "m");
  if (/schal\b|scarf/.test(titel)) return teil("Schal", "m");
  if (/hemd/.test(titel)) return teil("Hemd", "n");
  if (/jeans/.test(titel)) return teil("Jeans", "f");
  switch (kat) {
    case "Jackets": return teil("Jacke", "f");
    case "Coats": return teil("Mantel", "m");
    case "Pants": return teil("Hose", "f");
    case "Shoes": return teil("Schuhe", "pl");
    case "Shirts": return teil("Shirt", "n");
    case "Tops": return teil("Top", "n");
    case "Knitwear": return teil("Pulli", "m");
    case "Dresses": return teil("Kleid", "n");
    case "Skirts": return teil("Rock", "m");
    case "Accessories": return teil("Accessoire", "n");
    default: return teil("Teil", "n");
  }
}

// Grammatik-Helfer fuer eine Bezeichnung.
export function grammatik({ genus }) {
  const pl = genus === "pl";
  return {
    pl,
    dein: genus === "f" || pl ? "deine" : "dein",
    Dein: genus === "f" || pl ? "Deine" : "Dein",
    er: pl ? "sie" : genus === "m" ? "er" : genus === "f" ? "sie" : "es",
    Er: pl ? "Sie" : genus === "m" ? "Er" : genus === "f" ? "Sie" : "Es",
    ihn: pl ? "sie" : genus === "m" ? "ihn" : genus === "f" ? "sie" : "es",
    ist: pl ? "sind" : "ist",
    hat: pl ? "haben" : "hat",
    war: pl ? "waren" : "war",
    v: (einzahl, mehrzahl) => (pl ? mehrzahl : einzahl),
  };
}

// Satz des Artikels im Abschiedsbrief (A), je Art des Teils.
function satzA(item, b) {
  const pl = b.genus === "pl";
  const kat = String(item.category || "");
  if (pl && (kat === "Shoes" || /Sneaker|Boots|Schuhe|Sandalen/.test(b.nomen))) {
    return "Wir sind nicht mal einen Kilometer zusammen gelaufen. Wir nehmen’s sportlich.";
  }
  if (pl) return "Wir hätten so gern zu dir gepasst. Hat nicht sollen sein.";
  if (b.nomen === "Hoodie" || kat === "Knitwear") return "Ich bin weich. Aber nicht so weich, dass mich das kalt lässt.";
  switch (kat) {
    case "Jackets": return "Ich hätte dich durch jeden Regenschauer gebracht. Aber ich bin wetterfest – ich werd’s verkraften.";
    case "Coats": return "Ich wollte mit dir durch den Winter. Jetzt geh ich allein – mit hochgeschlagenem Kragen, wie es sich gehört.";
    case "Pants": return "Wir hatten Beine füreinander. Nur eben nicht dieselben.";
    case "Shirts": case "Tops": return "Ich war so nah dran, dein Lieblingsteil zu werden. So nah.";
    case "Dresses": case "Skirts": return "Ich hatte schon einen Abend für uns geplant. Der dreht sich jetzt halt ohne dich.";
    case "Accessories": return "Ich war nur ein kleines Detail. Aber ich hab gemerkt, dass du mich nicht wolltest.";
    default: return "Ich hätte so gern zu dir gepasst. Hat nicht sollen sein.";
  }
}

// ------------------------------------------------------------ Texte je Vorlage

function euro(cents) {
  return (Number(cents || 0) / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function datumDe(iso) {
  const d = new Date(String(iso || ""));
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" }).format(d);
}

// daten: { vorlage, anlass, kosten, preisCents, vorname, bestellnummer,
//          artikel: [{ title, brand, category, size, articleNo, itemId, bild }], fristBis }
export function ruecksendeTexte(daten = {}) {
  const artikel = Array.isArray(daten.artikel) && daten.artikel.length ? daten.artikel : [{}];
  const mehrere = artikel.length > 1;
  const erstes = artikel[0] || {};
  const b = mehrere ? teil("Teile", "pl") : artikelBezeichnung(erstes);
  const g = grammatik(b);
  const marke = !mehrere && erstes.brand ? safeText(erstes.brand, 40) + " " : "";
  const name = `${marke}${b.nomen}`;
  const hallo = daten.vorname ? safeText(daten.vorname, 40) : "";
  const anrede = hallo ? `${hallo}` : "Hallo";
  const vorlage = VORLAGEN.includes(daten.vorlage) ? daten.vorlage : vorlageFuer(daten.anlass, daten.bestellnummer);
  const reklamation = vorlage === "D" || daten.anlass === "REKLAMATION";
  const shopZahlt = reklamation || daten.kosten !== "KUNDIN";

  let betreff, vorschau, eyebrow, titel, absaetze, trauer = null;
  const esc = escapeHtml;
  const stimme = t => ({ art: "stimme", html: esc(t) });
  const absatz = t => ({ art: "text", html: esc(t) });

  if (vorlage === "A") {
    betreff = `${g.Dein} ${name} ${g.v("packt", "packen")} die Koffer`;
    vorschau = `${g.Er} ${g.hat} dir noch was zu sagen. Dein Rücksendeetikett ist dabei.`;
    titel = "Ein Abschiedsbrief";
    absaetze = [
      absatz(`Hey ${hallo || "du"},`),
      stimme(g.pl
        ? `hier sprechen ${g.dein} ${name}. Wir haben’s gehört: Wir und du, das hat nicht gepasst. Ist okay. ${satzA(erstes, b)}`
        : `hier spricht ${g.dein} ${name}. Ich hab’s gehört: Wir zwei, das hat nicht gepasst. Ist okay. ${satzA(erstes, b)}`),
      stimme(g.pl
        ? "Unser Ticket nach Hause hängt unten dran. Es bringt uns direkt zurück zu Joel nach Aschaffenburg. Mach’s gut – und such dir was, das dich so ansieht, wie wir es versucht haben."
        : "Mein Ticket nach Hause hängt unten dran. Es bringt mich direkt zurück zu Joel nach Aschaffenburg. Mach’s gut – und such dir was, das dich so ansieht, wie ich es versucht habe."),
      { art: "unterschrift", html: esc(`— ${g.dein} ${b.nomen} (abgetippt von Joel)`) },
    ];
  } else if (vorlage === "B") {
    betreff = `In stiller Trauer: ${g.Dein} ${name} ${g.v("kehrt", "kehren")} heim`;
    vorschau = "Statt Blumen bitte einfach den QR-Code zeigen.";
    titel = "In stiller Trauer";
    trauer = {
      gross: `Wir geben bekannt, dass uns<br><b>${esc(`${g.dein} ${name}`)}</b><br>nach kurzer, aber intensiver Zeit bei dir ${g.v("verlässt", "verlassen")}.`,
      klein: esc(`${g.Er} ${g.war} nicht lange bei dir. Aber jede Minute hat gezählt.`),
    };
    absaetze = [
      absatz(`Hallo ${hallo || "du"},`),
      absatz("statt Blumen genügt der QR-Code unten. Die Familie DISORDER119 nimmt die Heimkehr gefasst entgegen – in Aschaffenburg, wo alles begann."),
      absatz(`Kondolenzschreiben sind nicht nötig. Die Erstattung kommt von allein, sobald ${g.er} zu Hause angekommen ${g.ist}.`),
    ];
  } else if (vorlage === "C") {
    betreff = "Es liegt nicht an dir. Es liegt an der Passform.";
    vorschau = "Kein Drama. Dein Rücksendeetikett ist dabei.";
    titel = "Es liegt nicht an dir";
    absaetze = [
      absatz(`${anrede}, lass uns ehrlich sein.`),
      absatz(`Es liegt nicht an dir. Es liegt an der Passform. ${g.Dein} ${name} und du – ihr wolltet einfach unterschiedliche Dinge.`),
      absatz(`Keine Szene, kein Drama, kein „Können wir nicht wenigstens Freunde bleiben?“. Wir machen es kurz: Das Ticket ist schon ausgestellt, ${g.er} ${g.v("zieht", "ziehen")} zurück zu uns. Und wenn du bereit bist für was Neues – du weißt, wo du uns findest.`),
    ];
  } else {
    betreff = "Das geht auf uns – dein Rücksendeetikett";
    vorschau = "Tut uns leid. Das Etikett zahlen wir.";
    titel = "Das geht auf uns";
    absaetze = [
      absatz(`${anrede}, das tut uns ehrlich leid.`),
      absatz(`${g.Dein} ${name} ${g.v("hätte", "hätten")} so nicht bei dir ankommen dürfen. Wir schämen uns ein bisschen. ${g.Er} noch mehr – ${g.er} ${g.v("sitzt", "sitzen")} gerade ganz still in der Ecke.`),
      { art: "text", html: `<b>Das Rücksendeetikett zahlen wir.</b> ${esc(`Schick ${g.ihn} einfach zurück, wir schauen ${g.ihn} uns genau an und melden uns, sobald ${g.er} da ${g.ist}.`)}` },
    ];
  }

  const bestellnummer = safeText(daten.bestellnummer || "", 60);
  eyebrow = `${reklamation ? "Reklamation" : "Rücksendung"}${bestellnummer ? " · " + bestellnummer : ""}`;
  const kostenText = shopZahlt
    ? "übernehmen wir"
    : `${euro(daten.preisCents)}, ziehen wir von der Erstattung ab`;
  const frist = !reklamation && daten.fristBis ? datumDe(daten.fristBis) : "";
  const schritte = [
    "QR-Code in einer DHL-Filiale, einem Paketshop oder an einer Packstation zeigen – DHL druckt das Etikett aus.",
    `${mehrere ? "Alles" : g.Dein + " " + b.nomen} gut verpacken, Etikett drauf, abgeben.${b.nomen === "Schuhe" || b.nomen === "Sneaker" || b.nomen === "Boots" ? " Gern im Originalkarton." : ""}`,
    reklamation
      ? `Du zahlst nichts. Sobald ${g.er} da ${g.ist}, melden wir uns bei dir.`
      : `Sobald ${g.er} bei uns ${g.ist}, geht die Erstattung über PayPal an dich raus.${shopZahlt ? "" : " Die Kosten für das Etikett ziehen wir davon ab – so steht es in unseren AGB."}`,
  ];
  if (frist) schritte.splice(2, 0, `Bitte bis ${frist} losschicken – so bleibt die Widerrufsfrist sicher gewahrt.`);
  return { vorlage, betreff, vorschau, eyebrow, titel, absaetze, trauer, schritte, kostenText, frist, name, reklamation, shopZahlt, artikel, bezeichnung: b };
}

// ------------------------------------------------------------ Mail-HTML

const F = MAIL_FARBE;
const SCHRIFT = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const PAPIER = "#ebe7df";

function bildUrl(pfad) {
  const p = safeText(pfad || "", 200).replace(/^\/+/, "");
  return /^assets\/img\/[A-Za-z0-9_\/.-]+$/.test(p) ? `${SHOP_URL}/${p}` : "";
}

function absatzHtml(a) {
  if (a.art === "stimme") return `<p style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:17px;line-height:1.6;color:${F.text};">${a.html}</p>`;
  if (a.art === "unterschrift") return `<p style="margin:0 0 6px;font-size:13px;color:${F.leise};">${a.html}</p>`;
  return `<p style="margin:0 0 15px;font-size:15.5px;line-height:1.65;color:${F.text};">${a.html}</p>`;
}

// links: { qr, pdf, seite } - Adressen auf api.disorder119.com (mit Zugang).
export function ruecksendeMailHtml(texte, { links = {}, sendungsnummer = "" } = {}) {
  const esc = escapeHtml;
  const erstes = texte.artikel[0] || {};
  const held = bildUrl(erstes.bild || (Array.isArray(erstes.gallery) ? erstes.gallery[0] : "") || erstes.grid_image);
  const heldZeile = held
    ? `<tr><td align="center" style="background:${PAPIER};padding:28px 20px 22px;">
        <img src="${esc(held)}" width="330" alt="${esc(safeText(erstes.title || "", 120))}" style="display:block;width:330px;max-width:80%;height:auto;border:0;">
      </td></tr>`
    : "";
  const artikelZeilen = texte.artikel.map(a => `<tr>
      <td style="padding:14px 24px;border-bottom:1px solid ${F.linie};">
        ${a.brand ? `<span style="display:block;font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${F.leise};">${esc(safeText(a.brand, 40))}</span>` : ""}
        <span style="display:block;margin-top:3px;font-size:15px;color:${F.text};">${esc(safeText(a.title || "Artikel", 160))}</span>
      </td>
      <td align="right" style="padding:14px 24px 14px 0;border-bottom:1px solid ${F.linie};font-size:12px;line-height:1.6;color:${F.leise};white-space:nowrap;">
        ${a.size ? `Größe ${esc(safeText(a.size, 20))}<br>` : ""}${a.articleNo ? `Art.-Nr. ${esc(safeText(a.articleNo, 30))}` : ""}
      </td></tr>`).join("");
  const trauer = texte.trauer
    ? `<tr><td style="padding:22px 30px 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:3px double ${F.text};">
        <tr><td align="center" style="padding:20px 16px;">
          <p style="margin:0 0 8px;font-size:20px;color:${F.text};">&#10013;</p>
          <p style="margin:0 0 8px;font-family:Georgia,serif;font-size:16px;line-height:1.6;color:${F.text};">${texte.trauer.gross}</p>
          <p style="margin:0;font-size:12.5px;line-height:1.5;color:${F.leise};">${texte.trauer.klein}</p>
        </td></tr></table></td></tr>`
    : "";
  const ticketWert = (label, wert, mono = false) => `<p style="margin:0 0 3px;font-size:10.5px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#6b665d;">${esc(label)}</p>
      <p style="margin:0 0 11px;font-size:${mono ? "13.5px" : "15px"};font-weight:700;color:#111111;${mono ? "font-family:Consolas,'Courier New',monospace;letter-spacing:0.04em;" : ""}">${esc(wert)}</p>`;
  const nummer = String(sendungsnummer || "").replace(/(.{4})/g, "$1 ").trim();
  const qr = links.qr
    ? `<img src="${esc(links.qr)}" width="128" height="128" alt="QR-Code für DHL" style="display:block;width:128px;height:128px;border:0;background:#ffffff;">`
    : `<div style="width:128px;height:128px;background:#ffffff;"></div>`;
  const ticket = `<tr><td style="padding:26px 24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2efe7;">
        <tr><td width="140" valign="middle" style="padding:18px 0 18px 18px;"><div style="background:#ffffff;padding:6px;width:128px;">${qr}</div></td>
          <td valign="middle" style="padding:18px 18px 18px 14px;font-family:${SCHRIFT};">
            ${ticketWert("Dein Ticket nach Hause", "DHL Paket · Rücksendung")}
            ${nummer ? ticketWert("Sendungsnummer", nummer, true) : ""}
            ${texte.frist ? ticketWert("Losschicken bis", texte.frist) : ticketWert("Kosten", texte.kostenText)}
          </td></tr>
        <tr><td colspan="2" style="padding:0 14px;"><div style="border-top:2px dashed #b9b3a7;font-size:0;line-height:0;">&nbsp;</div></td></tr>
        <tr><td colspan="2" style="padding:14px 18px 16px;font-family:${SCHRIFT};font-size:13.5px;line-height:1.5;color:#111111;">
          <span style="display:block;font-size:10.5px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#6b665d;margin-bottom:4px;">Geht zurück an</span>
          ${esc(SELLER.brand.toUpperCase())} · ${esc(SELLER.name)}<br>${esc(SELLER.street)} · ${esc(SELLER.city)}
        </td></tr>
      </table></td></tr>`;
  const schritte = texte.schritte.map((s, i) => `<tr>
      <td width="44" valign="top" style="padding:12px 0;border-top:1px solid ${F.linie};font-size:22px;font-weight:800;color:#5d5951;line-height:1.1;">${String(i + 1).padStart(2, "0")}</td>
      <td valign="top" style="padding:12px 0;border-top:1px solid ${F.linie};font-size:14.5px;line-height:1.5;color:${F.text};">${esc(s)}</td></tr>`).join("");
  const knoepfe = [links.seite ? mailKnopf(links.seite, "QR-Code groß anzeigen") : "", links.pdf ? `<p style="margin:14px 0 0;text-align:center;font-size:13px;"><a href="${esc(links.pdf)}" style="color:${F.text};">Etikett als PDF</a></p>` : ""].join("");

  const inhalt = `
  ${heldZeile}
  <tr><td style="padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${artikelZeilen}</table></td></tr>
  <tr><td align="center" style="padding:34px 26px 6px;">
    <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;color:${F.leise};">${esc(texte.eyebrow)}</p>
    <h1 class="mail-h1" style="margin:0;font-size:30px;line-height:1.08;font-weight:800;text-transform:uppercase;color:${F.text};">${esc(texte.titel)}</h1>
  </td></tr>
  ${trauer}
  <tr><td style="padding:22px 30px 4px;">${texte.absaetze.map(absatzHtml).join("")}</td></tr>
  ${ticket}
  <tr><td style="padding:24px 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${schritte}</table></td></tr>
  <tr><td align="center" style="padding:24px 24px 30px;">${knoepfe}</td></tr>`;
  return kundenmailRahmen({ titel: "", eyebrow: "", kopf: "", inhalt, vorschau: texte.vorschau, sprache: "de" });
}

// Reiner Text fuer Mailprogramme ohne HTML.
export function ruecksendeMailText(texte, { links = {}, sendungsnummer = "" } = {}) {
  const ohneHtml = s => String(s || "").replace(/<br>/g, " ").replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  return [
    texte.titel.toUpperCase(), "",
    ...(texte.trauer ? [ohneHtml(texte.trauer.gross), ohneHtml(texte.trauer.klein), ""] : []),
    ...texte.absaetze.map(a => ohneHtml(a.html)), "",
    "DEIN TICKET NACH HAUSE (DHL Paket, Rücksendung)",
    ...(sendungsnummer ? [`Sendungsnummer: ${sendungsnummer}`] : []),
    ...(links.seite ? [`QR-Code: ${links.seite}`] : []),
    ...(links.pdf ? [`Etikett als PDF: ${links.pdf}`] : []),
    `Geht zurück an: ${SELLER.brand.toUpperCase()} · ${SELLER.name}, ${SELLER.street}, ${SELLER.city}`, "",
    ...texte.schritte.map((s, i) => `${i + 1}. ${s}`),
  ].join("\n");
}
