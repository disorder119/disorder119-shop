"""Produktseite: strukturierte Beschreibung (Inhaber 05.11.2026).

Mischung aus Entwurf A "Datenblatt" und B "Editorial" (D:\\d119_tasks\\beschreibung):
drei Schlagzeilen aus den Daten, ein Hook-Absatz, Kaufknoepfe sofort, die Fakten
als Tabelle, der lange Text in Klappleisten (Beschreibung, Zustand, Masse &
Passform, Versand & Rueckgabe, Rechtliches), Vertrauensleiste, Puppenmasse als
Leiste unter dem Foto. Alles kommt aus dem vorhandenen Beschreibungstext
(data/items.json desc_de/desc_en/desc_fr), nichts wird erfunden: fehlt ein
Abschnitt, entfaellt seine Leiste.

Nur Standardbibliothek; build_site.py ruft die Funktionen je Seite auf.
"""
from __future__ import annotations

import html
import re
import unicodedata


def esc(text) -> str:
    return html.escape(str(text if text is not None else ""), quote=True)


def _norm(text: str) -> str:
    t = unicodedata.normalize("NFKD", str(text or "").replace("ß", "ss").replace("ẞ", "ss").replace("’", "'").replace(" ", " "))
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", t).strip().lower()


# Abschnittsueberschriften je Sprache (normalisiert, ohne Doppelpunkt)
_ABSCHNITTE = {
    "details": ("details",),
    "foto": ("fotografie & passform", "photography & fit", "photographie et coupe"),
    "masse": ("masse der schneiderpuppe", "measurements of the dress form", "dress form measurements",
              "dimensions du mannequin de couture", "mesures du mannequin"),
    "zustand": ("zustand", "condition", "etat"),
    "recht": ("rechtliche hinweise", "legal notice", "legal notices", "legal notes", "mentions legales"),
}
_INTRO = ("aus dem kuratierten archiv von disorder119", "from the curated archive of disorder119",
          "issu des archives selectionnees de disorder119", "issu des archives de disorder119")
_LEITBILD = ("disorder119 steht fur", "disorder119 stands for", "disorder119 est synonyme", "disorder119 incarne", "disorder119, c'est")
_HINWEIS_ZUSTAND = ("hinweis zum zustand", "condition note", "note sur l'etat", "remarque sur l'etat", "note d'etat")

# Details-Zeilen: Label -> kanonischer Schluessel (None = nicht nochmal zeigen)
_DETAIL_KEYS = {
    "marke": None, "brand": None, "marque": None,
    "farbe": None, "color": None, "colour": None, "couleur": None,
    "grosse": None, "size": None, "taille": None,
    "artikel": None, "article": None,
    "kollektion/jahr": "kollektion", "kollektion": "kollektion", "collection/year": "kollektion", "collection": "kollektion",
    "collection/annee": "kollektion", "saison": "kollektion",
    "passform": "passform", "fit": "passform", "coupe": "passform", "ajustement": "passform",
    "country of production": "herkunft", "pays de production": "herkunft", "produktionsland": "herkunft",
    "verschluss": "verschluss", "closure": "verschluss", "fastening": "verschluss", "fermeture": "verschluss", "boucle": "verschluss",
    "material": "material", "matiere": "material", "materiau": "material", "composition": "material",
    "herstellungsland": "herkunft", "country of manufacture": "herkunft", "pays de fabrication": "herkunft", "made in": "herkunft",
    "armel": "aermel", "sleeves": "aermel", "manches": "aermel",
    "futter": "futter", "lining": "futter", "doublure": "futter",
}
_DETAIL_LEER = ("nicht angegeben", "not specified", "non specifie", "non specifiee", "non indique", "k. a.", "k.a.", "unbekannt", "unknown",
                "kein verschluss", "no closure", "none", "sans fermeture", "pas de fermeture", "aucune", "aucun", "-", "–")

_LABEL = {
    "de": {"kollektion": "Kollektion", "passform": "Passform", "verschluss": "Verschluss", "material": "Material", "herkunft": "Herkunft",
           "aermel": "Ärmel", "futter": "Futter", "archiv": "Archiv-Nr.",
           "beschreibung": "Beschreibung", "zustand": "Zustand", "masse": "Maße & Passform", "versand": "Versand & Rückgabe", "recht": "Rechtliches",
           "brust": "Brust", "taille": "Taille", "huefte": "Hüfte", "schulter": "Schulter", "puppe": "Schneiderpuppe (Standard) · keine Artikelmaße",
           "groesse": "Größe", "trust": (("1×", "verfügbar"), ("14 Tage", "Widerruf"), ("DHL", "versicherter Versand")),
           "versand_text": "Versand innerhalb Deutschlands mit DHL; der genaue Betrag steht vor der Bestellung.{frei} In alle EU-Länder liefern wir direkt über die Kasse, ins übrige Europa und in die USA auf Anfrage. 14 Tage Widerrufsrecht für Verbraucher:innen, gesetzliche Gewährleistungsrechte.",
           "frei": " Ab {betrag} Warenwert ist der Versand innerhalb Deutschlands kostenlos."},
    "en": {"kollektion": "Collection", "passform": "Fit", "verschluss": "Closure", "material": "Material", "herkunft": "Origin",
           "aermel": "Sleeves", "futter": "Lining", "archiv": "Archive no.",
           "beschreibung": "Description", "zustand": "Condition", "masse": "Measurements & fit", "versand": "Shipping & returns", "recht": "Legal",
           "brust": "Chest", "taille": "Waist", "huefte": "Hips", "schulter": "Shoulder", "puppe": "Dress form (standard) · not garment measurements",
           "groesse": "Size", "trust": (("1×", "available"), ("14 days", "withdrawal"), ("DHL", "insured shipping")),
           "versand_text": "Shipping within Germany with DHL; the exact amount is shown before you order.{frei} We deliver to every EU country straight through checkout, to the rest of Europe and the USA on request. 14-day statutory withdrawal right for consumers, statutory warranty rights.",
           "frei": " From {betrag} order value, shipping within Germany is free."},
    "fr": {"kollektion": "Collection", "passform": "Coupe", "verschluss": "Fermeture", "material": "Matière", "herkunft": "Origine",
           "aermel": "Manches", "futter": "Doublure", "archiv": "N° d’archive",
           "beschreibung": "Description", "zustand": "État", "masse": "Mesures et coupe", "versand": "Livraison et retours", "recht": "Mentions légales",
           "brust": "Poitrine", "taille": "Taille", "huefte": "Hanches", "schulter": "Épaules", "puppe": "Mannequin (standard) · pas les mesures de l’article",
           "groesse": "Taille", "trust": (("1×", "disponible"), ("14 jours", "rétractation"), ("DHL", "envoi assuré")),
           "versand_text": "Livraison en Allemagne avec DHL ; le montant exact est indiqué avant la commande.{frei} Nous livrons dans tous les pays de l’UE directement via la caisse, ailleurs en Europe et aux États-Unis sur demande. Droit légal de rétractation de 14 jours pour les consommateurs, garantie légale.",
           "frei": " À partir de {betrag} d’achat, la livraison en Allemagne est gratuite."},
}
_FIT = {
    "de": {"regular": "Regular Fit", "regulär": "Regular Fit", "regulaer": "Regular Fit", "oversized": "Oversized", "slim": "Slim Fit", "weit": "Weiter Schnitt", "tailliert": "Tailliert"},
    "en": {"regular": "Regular fit", "oversized": "Oversized", "slim": "Slim fit", "wide": "Wide cut", "relaxed": "Relaxed fit"},
    "fr": {"régulière": "Coupe régulière", "reguliere": "Coupe régulière", "régulier": "Coupe régulière", "regulier": "Coupe régulière",
           "oversize": "Oversize", "ajustée": "Coupe ajustée", "ajuste": "Coupe ajustée", "ample": "Coupe ample", "droite": "Coupe droite"},
}
_ABTEILUNG = ("damen", "herren", "unisex", "kinder", "men", "women", "unisex", "kids", "femme", "femmes", "homme", "hommes", "mixte", "enfant")


def teile(text: str, lang: str = "de") -> dict:
    """Beschreibungstext in Abschnitte zerlegen."""
    t = {"haupt": [], "details": [], "foto": [], "masse": [], "masse_hinweis": [], "zustand": [], "recht": [],
         "leitbild": [], "hinweis_zustand": [], "rest": []}
    aktuell = "haupt"
    offen_label = None  # Details im Format "Marke" / "Prada" auf zwei Zeilen
    for roh in str(text or "").replace("\r", "").split("\n"):
        line = roh.strip()
        if not line:
            continue
        n = _norm(line)
        if n.endswith(":") and len(n) < 48:
            kopf = n[:-1].strip()
            key = next((k for k, names in _ABSCHNITTE.items() if kopf in names), None)
            if key:
                aktuell = key
                continue
        if any(n.startswith(p) for p in _HINWEIS_ZUSTAND):
            t["hinweis_zustand"].append(re.sub(r"^[^:]{3,40}:\s*", "", line, count=1))
            continue
        if any(n.startswith(p) for p in _INTRO) and aktuell == "haupt":
            continue
        if any(n.startswith(p) for p in _LEITBILD):
            t["leitbild"].append(line)
            continue
        if aktuell == "details":
            m = re.match(r"^([^:]{2,40}):\s*(.+)$", line)
            if m:
                t["details"].append((m.group(1).strip(), m.group(2).strip()))
                offen_label = None
            elif offen_label:
                t["details"].append((offen_label, line))
                offen_label = None
            elif len(line) <= 40 and not str(_detail_key(line.rstrip(": ")) or "").startswith("frei:"):
                offen_label = line.rstrip(": ")
            else:
                t["rest"].append(line)
            continue
        if aktuell == "masse":
            m = re.match(r"^(.*?)[\s:]+(\d+(?:[.,]\d+)?)\s*cm\b", line, re.I)
            if m:
                t["masse"].append((m.group(1).strip(" :"), m.group(2).replace(".", ",")))
            else:
                t["masse_hinweis"].append(line)
            continue
        t[aktuell].append(line)
    return t


def _detail_key(label: str):
    n = _norm(label)
    if n in _DETAIL_KEYS:
        return _DETAIL_KEYS[n]
    for k, v in _DETAIL_KEYS.items():
        if n.startswith(k):
            return v
    return "frei:" + label.strip()


# Platzhalter aus der Erfassung (Etikett nicht lesbar u. ae.) sind keine Angabe
# und erscheinen nie auf der Seite (Inhaber 06.11.2026: "Material: Nicht
# eindeutig lesbar" stand als Schlagzeile - "das soll niemals dastehen").
_UNLESBAR = re.compile(
    r"\b(nicht|kaum)\s+(eindeutig\s+|klar\s+|gut\s+)?(lesbar|erkennbar|bekannt|feststellbar|zu erkennen)\b"
    r"|unleserlich|unlesbar|keine angaben?\b|^unklar$|^n\s*/?\s*a$|^\?+$"
    r"|\bnot\s+(clearly\s+)?(legible|readable|visible|known)\b|\billegible\b|\bunreadable\b|^unclear$"
    r"|\bnon\s+lisible\b|\billisible\b|\bincon+ue?\b|\bnon\s+(connu|precise|indique)e?\b")


def ist_platzhalter(wert) -> bool:
    n = _norm(wert)
    return not n or n in _DETAIL_LEER or bool(_UNLESBAR.search(n))


def ohne_platzhalter_zeilen(text) -> str:
    """Rohbeschreibung ohne Angaben-Zeilen mit Platzhalterwert ("Material: Nicht eindeutig lesbar")."""
    zeilen = []
    for zeile in str(text or "").split("\n"):
        label, trenner, wert = zeile.partition(":")
        if trenner and len(zeile) < 200 and len(label.strip()) <= 40 and wert.strip() and ist_platzhalter(wert):
            continue
        zeilen.append(zeile)
    return "\n".join(zeilen)


# Inhaber 07.11.2026: "es ist kein Einzelstück" - die Teile sind gebraucht und
# im Shop nur 1x verfuegbar, aber keine Unikate. Saetze, die ein Teil als
# Einzelstueck/Unikat bezeichnen, erscheinen darum nirgends im Shop (auch wenn
# sie in einer Beschreibung aus dem Katalog stehen; die Daten bleiben unberuehrt).
_UNIKAT = re.compile(
    r"einzelst(ü|ue|u)ck|unikat|one[- ]of[- ]a[- ]kind|\bone[- ]offs?\b|\bpi[eè]ces?\s+uniques?\b",
    re.I)


def ohne_unikat_saetze(text) -> str:
    """Beschreibung ohne Saetze, die das Teil ein Einzelstueck/Unikat nennen."""
    s = str(text or "")
    if not _UNIKAT.search(s):
        return s
    zeilen = []
    for zeile in s.split("\n"):
        if _UNIKAT.search(zeile):
            saetze = re.split(r"(?<=[.!?])\s+", zeile.strip())
            zeile = " ".join(x for x in saetze if not _UNIKAT.search(x))
        zeilen.append(zeile)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(zeilen)).strip("\n")


def details_kanonisch(t: dict) -> dict:
    """Details-Zeilen -> {schluessel: wert}; Leerwerte, Platzhalter und doppelte Fakten entfallen."""
    out = {}
    for label, wert in t.get("details", []):
        key = _detail_key(label)
        if key is None:
            continue
        if ist_platzhalter(wert):
            continue
        out.setdefault(key, wert.strip())
    return out


def produkt_phrase(title: str, brand: str, color: str, lang: str = "de") -> str:
    """'Helmut Lang Logo-Hoodie Herren Schwarz' -> 'Logo-Hoodie' (Titelschema Marke Produktart Bereich Farbe)."""
    s = str(title or "").strip()
    b = str(brand or "").strip()
    if b and _norm(s).startswith(_norm(b)):
        s = s[len(b):].strip(" -–·")
    worte = s.split()
    farbe = _norm(color)
    # Farbe (auch mehrteilig) und Abteilung am Ende abschneiden
    for _ in range(3):
        if not worte:
            break
        if farbe and _norm(" ".join(worte[-len(farbe.split()):])) == farbe and len(worte) > len(farbe.split()):
            worte = worte[:-len(farbe.split())]
            continue
        if _norm(worte[-1]) in _ABTEILUNG and len(worte) > 1:
            worte = worte[:-1]
            continue
        break
    return " ".join(worte).strip() or s or b


def _fit_label(wert: str, lang: str) -> str:
    n = _norm(wert)
    for k, v in _FIT.get(lang, {}).items():
        if n.startswith(_norm(k)):
            return v
    return wert.strip()


def caption_zeilen(it: dict, t: dict, lang: str, *, title: str, color: str, size_label: str, kategorie_label: str) -> list:
    """Drei Schlagzeilen: Produktart / Kollektion|Material|Herkunft|Marke / Groesse · Passform."""
    d = details_kanonisch(t)
    z1 = produkt_phrase(title, it.get("brand") or "", color, lang)
    if d.get("kollektion"):
        z2 = d["kollektion"]
    elif d.get("material"):
        z2 = d["material"]
    elif d.get("herkunft"):
        z2 = {"de": "Made in ", "en": "Made in ", "fr": "Fabriqué en "}[lang] + d["herkunft"]
    else:
        z2 = it.get("brand") or kategorie_label or ""
    L = _LABEL[lang]
    teile3 = []
    if size_label:
        # "Einheitsgröße" / "One Size" / "Taille unique" stehen ohne "Größe" davor.
        ohne_vorsatz = re.search(r"einheit|one ?size|unique|onesize|universal", _norm(size_label))
        teile3.append(size_label if ohne_vorsatz else f"{L['groesse']} {size_label}")
    if d.get("passform"):
        teile3.append(_fit_label(d["passform"], lang))
    elif color:
        teile3.append(color)
    z3 = " · ".join(teile3) or kategorie_label or ""
    zeilen = [z for z in (z1, z2, z3) if z]
    # Keine Zeile doppelt (z.B. Produktart = Kategorie)
    gesehen, out = set(), []
    for z in zeilen:
        if _norm(z) not in gesehen:
            gesehen.add(_norm(z))
            out.append(z)
    return out


def caption_html(zeilen: list) -> str:
    if not zeilen:
        return ""
    return '<p class="info__caption">' + "".join(f"<span>{esc(z)}.</span>" for z in zeilen) + "</p>"


def hook_text(t: dict, fallback: str = "", max_len: int = 280) -> str:
    """Die ersten zwei Saetze des Haupttexts."""
    text = " ".join(t.get("haupt", [])).strip() or str(fallback or "").strip()
    if not text:
        return ""
    saetze = re.split(r"(?<=[.!?])\s+(?=[A-ZÄÖÜ„“\"(])", text)
    hook = saetze[0]
    if len(saetze) > 1 and len(hook) + 1 + len(saetze[1]) <= max_len:
        hook = hook + " " + saetze[1]
    if len(hook) > max_len:
        hook = hook[:max_len].rsplit(" ", 1)[0].rstrip(",;:") + " …"
    return hook


def hook_html(text: str) -> str:
    return f'<p class="info__hook">{esc(text)}</p>' if text else ""


def spec_rows_html(it: dict, t: dict, lang: str, *, archiv_nr: str = "") -> str:
    """Zusaetzliche Zeilen fuer .info__facts (gleiches Markup wie facts_html)."""
    L = _LABEL[lang]
    d = details_kanonisch(t)
    rows = []
    for key in ("kollektion", "passform", "material", "herkunft", "verschluss", "aermel", "futter"):
        if d.get(key):
            wert = _fit_label(d[key], lang) if key == "passform" else d[key]
            rows.append((L[key], wert))
    for key, wert in d.items():
        if key.startswith("frei:"):
            rows.append((key[5:], wert))
    if archiv_nr:
        rows.append((L["archiv"], archiv_nr))
    return "".join(
        '<div><div class="fact__label">' + esc(label) + '</div><div class="fact__value">' + esc(wert) + "</div></div>"
        for label, wert in rows
    )


def _absatz(lines: list) -> str:
    return "\n".join(lines).strip()


def _woerter(text: str) -> set:
    t = re.sub(r"\([^)]*\)", " ", _norm(text))
    return {w for w in re.findall(r"[a-z0-9][a-z0-9-]{3,}", t)}


def zustand_text(t: dict) -> str:
    """Zustand + 'Hinweis zum Zustand' ohne Doppelung: steckt der Hinweis
    (ohne Klammerzusatz wie 'siehe Fotos') schon fast ganz im Zustandstext,
    entfaellt er."""
    zustand = _absatz(t.get("zustand", []))
    hinweise = []
    for h in t.get("hinweis_zustand", []):
        w = _woerter(h)
        if zustand and w and len(w & _woerter(zustand)) / len(w) >= 0.7:
            continue
        hinweise.append(h)
    return "\n".join(x for x in (zustand, *hinweise) if x).strip()


def akkordeon_html(it: dict, t: dict, lang: str, *, beschreibung_text: str, gebraucht_hinweis: str, frei_ab_text: str = "") -> str:
    """Klappleisten; #itemDesc bleibt (Marker fuer apply_catalog_taxonomy.py und article.js)."""
    L = _LABEL[lang]
    haupt = _absatz(t.get("haupt", [])) or str(beschreibung_text or "").strip()
    zustand = zustand_text(t)
    masse = "\n".join(x for x in (_absatz(t.get("foto", [])), _absatz(t.get("masse_hinweis", []))) if x)
    recht = "\n\n".join(x for x in (_absatz(t.get("recht", [])), _absatz(t.get("leitbild", [])), _absatz(t.get("rest", []))) if x)
    versand = L["versand_text"].format(frei=(L["frei"].format(betrag=frei_ab_text) if frei_ab_text else ""))

    def leiste(key, body_html, offen=False, extra=""):
        return (f'<details class="info__akk-item"{" open" if offen else ""}{extra}><summary>{esc(L[key])}</summary>'
                f'<div class="info__akk-body">{body_html}</div></details>')

    out = ['<div class="info__akk" data-strukturiert>']
    out.append(leiste("beschreibung", '\n    <p class="info__desc" id="itemDesc">' + esc(haupt) + "</p>\n  "))
    # Erst der konkrete Zustand des Stuecks, darunter klein der allgemeine
    # Gebraucht-Hinweis (gleich auf jeder Seite, data-zustand-hinweis zaehlt validate_focus_three.py).
    zustand_html = (f'<p class="info__akk-text">{esc(zustand)}</p>' if zustand else "") + \
        f'<p class="info__gebraucht info__akk-text--klein" data-zustand-hinweis>{esc(gebraucht_hinweis)}</p>'
    out.append(leiste("zustand", zustand_html, offen=True))
    masse_leiste = masse_html(t, lang)
    # Puppenmasse nur, wo sie etwas sagen (Oberteile, Kleider, Jacken, Roecke):
    # bei Hosen, Schuhen und Accessoires keine Leiste (Inhaber 06.11.2026).
    if not puppenmasse_sinnvoll(it):
        masse, masse_leiste = "", ""
    if masse or masse_leiste:
        out.append(leiste("masse", masse_leiste + (f'<p class="info__akk-text info__akk-text--klein">{esc(masse)}</p>' if masse else "")))
    out.append(leiste("versand", f'<p class="info__akk-text">{esc(versand)}</p>'))
    if recht:
        out.append(leiste("recht", f'<p class="info__akk-text info__akk-text--klein">{esc(recht)}</p>'))
    out.append("</div>")
    return "".join(out)


_OHNE_PUPPE = re.compile(
    r"\b(pants?|trousers?|jeans|shorts|leggings|hosen?|shoes?|sneakers?|boots?|sandals?|heels|loafers?|pumps|"
    r"mules|schuhe?|stiefel\w*|accessor\w*|bags?|taschen?|jewel\w*|schmuck|belts?|guertel|hats?|caps?|muetzen?|"
    r"scarf|scarves|schals?|tuecher|sunglasses|sonnenbrillen?|socks|socken|wallets?|geldboersen?)\b")


def puppenmasse_sinnvoll(it: dict) -> bool:
    """Puppenmasse passen zu Teilen, die an der Puppe oben sitzen; nicht zu Hosen, Schuhen, Accessoires."""
    felder = " ".join(_norm(it.get(k) or "") for k in ("category", "taxonomy_category", "product_type"))
    return not _OHNE_PUPPE.search(felder)


def trust_html(lang: str) -> str:
    L = _LABEL[lang]
    return '<div class="info__trust">' + "".join(f"<div><b>{esc(a)}</b>{esc(b)}</div>" for a, b in L["trust"]) + "</div>"


def masse_html(t: dict, lang: str) -> str:
    """Puppenmasse als eine ruhige Zeile in der Klappleiste "Masse & Passform"
    (Inhaber 05.11.2026: nicht mehr als Leiste unter dem Foto)."""
    if not t.get("masse"):
        return ""
    L = _LABEL[lang]
    karten = []
    for label, cm in t["masse"]:
        n = _norm(label)
        key = ("brust" if any(w in n for w in ("brust", "chest", "poitrine")) else
               "taille" if any(w in n for w in ("taille", "waist")) and "poitrine" not in n else
               "huefte" if any(w in n for w in ("huft", "hip", "hanche")) else
               "schulter" if any(w in n for w in ("schulter", "shoulder", "epaule")) else None)
        karten.append((L[key] if key else label, cm))
    if not karten:
        return ""
    return ('<dl class="info__masse">'
            + "".join(f"<div><dt>{esc(label)}</dt><dd>{esc(cm)} cm</dd></div>" for label, cm in karten[:5])
            + "</dl>")
