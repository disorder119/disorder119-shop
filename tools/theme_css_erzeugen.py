"""Erzeugt assets/theme.css: die helle (weiss) und graue Ansicht des Shops.

Die dunkle Ansicht bleibt der Standard und wird nicht angefasst. Fuer die
hellen Ansichten gibt es zwei Teile:

1. Farbvariablen (--ink, --paper, --text ...) je Ansicht umgedreht.
2. Alle Stellen, die Farben fest eintragen statt ueber Variablen (z. B.
   rgba(242, 239, 231, 0.5) fuer halbtransparente Schrift), werden hier mit
   derselben Regel nachgebaut - nur mit der Farbe der jeweiligen Ansicht und
   hinter :root[data-theme]. So bleibt jede Regel in app.css & Co. unveraendert.

Ausfuehren nach groesseren CSS-Aenderungen (braucht tinycss2):
    pip install tinycss2 && python tools/theme_css_erzeugen.py
"""
import pathlib
import re

import tinycss2

BASE = pathlib.Path(__file__).resolve().parent.parent
ZIEL = BASE / "assets" / "theme.css"
QUELLEN = [
    "app.css", "article.css", "product-page-v4.css", "kasse.css", "konto.css",
    "newsletter.css", "product-lightbox-v2.css", "shop-promos.css",
]

# Helle Schrift auf dunklem Grund -> Schriftfarbe der Ansicht
HELL = re.compile(r"rgba\(\s*242\s*,\s*239\s*,\s*231\s*,\s*([0-9.]+)\s*\)|#f2efe7\b", re.I)
# Dunkle Flaechen (Overlays, Karten) -> Grund der Ansicht
DUNKEL_RGBA = re.compile(r"rgba\(\s*(?:0\s*,\s*0\s*,\s*0|6\s*,\s*6\s*,\s*5|8\s*,\s*8\s*,\s*7|10\s*,\s*10\s*,\s*9)\s*,\s*([0-9.]+)\s*\)", re.I)
DUNKEL_HEX = re.compile(r"#(?:000000|000|070707|080808|0a0a09|0d0d0d|111111|121212|161616|1b1b1b)\b", re.I)

HINTERGRUND = {"background", "background-color", "background-image"}
UEBERSPRINGEN = {"mask-image", "-webkit-mask-image", "box-shadow", "text-shadow", "filter"}


def umfaerben(name, wert):
    if name in UEBERSPRINGEN:
        return None
    neu = HELL.sub(lambda m: f"rgba(var(--d119-schrift-rgb), {m.group(1)})" if m.group(1) else "var(--d119-schrift)", wert)
    if name in HINTERGRUND:
        neu = DUNKEL_RGBA.sub(lambda m: f"rgba(var(--d119-grund-rgb), {m.group(1)})", neu)
        neu = DUNKEL_HEX.sub("var(--d119-flaeche)", neu)
    elif name in {"border", "border-color", "border-top", "border-bottom", "border-left", "border-right", "outline", "color"}:
        neu = DUNKEL_HEX.sub("var(--d119-flaeche)", neu)
    return neu if neu != wert else None


def selektor_mit_ansicht(prelude):
    teile = []
    for sel in prelude.split(","):
        sel = sel.strip()
        if not sel:
            continue
        # :root / html bekommen die Ansicht direkt angehaengt.
        m = re.match(r"^(:root|html)(\[[^\]]*\])*", sel)
        if m:
            teile.append(":root[data-theme]" + sel[len(m.group(1)):])
        else:
            teile.append(":root[data-theme] " + sel)
    return ", ".join(teile)


def regeln(knoten, quelle):
    out = []
    for regel in knoten:
        if regel.type == "qualified-rule":
            prelude = tinycss2.serialize(regel.prelude).strip()
            if prelude.startswith(("from", "to")) or re.fullmatch(r"[0-9.%, ]+", prelude):
                continue  # Keyframes
            decls = tinycss2.parse_declaration_list(regel.content, skip_whitespace=True, skip_comments=True)
            neu = []
            for d in decls:
                if d.type != "declaration":
                    continue
                wert = tinycss2.serialize(d.value).strip()
                ersatz = umfaerben(d.lower_name, wert)
                if ersatz is not None:
                    neu.append(f"  {d.name}: {ersatz}{' !important' if d.important else ''};")
            if neu:
                out.append(selektor_mit_ansicht(prelude) + " {\n" + "\n".join(neu) + "\n}")
        elif regel.type == "at-rule" and regel.lower_at_keyword in {"media", "supports"} and regel.content:
            innen = regeln(tinycss2.parse_rule_list(regel.content, skip_whitespace=True, skip_comments=True), quelle)
            if innen:
                kopf = "@" + regel.at_keyword + tinycss2.serialize(regel.prelude)
                out.append(kopf.rstrip() + " {\n" + "\n".join(innen) + "\n}")
    return out


VARIABLEN = """/* Erzeugt von tools/theme_css_erzeugen.py - nicht von Hand aendern.
   Ansicht "hell" (weiss) und "grau"; Standard bleibt dunkel.
   Gesetzt wird sie per <html data-theme="hell|grau"> (siehe theme.js). */

:root[data-theme="hell"] {
  --d119-schrift: #151514;
  --d119-schrift-rgb: 21, 21, 20;
  --d119-grund-rgb: 255, 255, 255;
  --d119-flaeche: #f3f2ef;
  --ink: #ffffff;
  --ink-lift: #f3f2ef;
  --ink-lift-2: #e9e7e2;
  --surface: #f3f2ef;
  --surface-2: #e9e7e2;
  --paper: #151514;
  --text: #151514;
  --text-muted: rgba(21, 21, 20, 0.64);
  --text-faint: rgba(21, 21, 20, 0.44);
  --rule: rgba(21, 21, 20, 0.12);
  --rule-strong: rgba(21, 21, 20, 0.26);
  --accent: #6f695d;
  --accent-soft: rgba(111, 105, 93, 0.14);
  --accent-text: #4b463d;
  --focus: #4b463d;
  --mount: #ffffff;
  --mount-text: #151514;
  --mount-rule: rgba(21, 21, 20, 0.12);
  color-scheme: light;
}

:root[data-theme="grau"] {
  --d119-schrift: #1f1e1c;
  --d119-schrift-rgb: 31, 30, 28;
  --d119-grund-rgb: 229, 227, 222;
  --d119-flaeche: #dcd9d3;
  --ink: #e5e3de;
  --ink-lift: #dcd9d3;
  --ink-lift-2: #d2cec7;
  --surface: #dcd9d3;
  --surface-2: #d2cec7;
  --paper: #1f1e1c;
  --text: #1f1e1c;
  --text-muted: rgba(31, 30, 28, 0.66);
  --text-faint: rgba(31, 30, 28, 0.46);
  --rule: rgba(31, 30, 28, 0.14);
  --rule-strong: rgba(31, 30, 28, 0.28);
  --accent: #6a6457;
  --accent-soft: rgba(106, 100, 87, 0.16);
  --accent-text: #4a453c;
  --focus: #4a453c;
  --mount: #e5e3de;
  --mount-text: #1f1e1c;
  --mount-rule: rgba(31, 30, 28, 0.14);
  color-scheme: light;
}

/* Produktfotos sind freigestellt: in Weiss auf reinem Weiss, in Grau
   nahtlos auf dem Seitengrau. */
:root[data-theme] .gallery__stage, :root[data-theme] .gallery__stage img,
:root[data-theme] .gallery-thumb, :root[data-theme] .related-card__frame { background: var(--mount); }

/* Mieten-Datumsfelder: Kalender in hell */
:root[data-theme] #d119RentalStart, :root[data-theme] #d119RentalEnd { color-scheme: light; }

/* ---- Feste Farben aus den Stylesheets, fuer die helle Ansicht nachgebaut ---- */
"""


def main():
    teile = [VARIABLEN]
    for name in QUELLEN:
        pfad = BASE / "assets" / name
        if not pfad.exists():
            continue
        baum = tinycss2.parse_stylesheet(pfad.read_text(encoding="utf-8"), skip_whitespace=True, skip_comments=True)
        erzeugt = regeln(baum, name)
        if erzeugt:
            teile.append(f"/* aus {name} */\n" + "\n".join(erzeugt) + "\n")
    ZIEL.write_text("\n".join(teile), encoding="utf-8")
    print(f"{ZIEL.relative_to(BASE)}: {sum(t.count('{') for t in teile)} Regeln")


if __name__ == "__main__":
    main()
