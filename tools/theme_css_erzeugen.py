"""Erzeugt assets/theme.css: die helle (weisse) Ansicht des Shops.

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
   Ansicht "hell" (weiss); Standard bleibt dunkel.
   Gesetzt wird sie per <html data-theme="hell"> (Kopf-Skript und ansicht.js). */

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

/* Produktfotos sind freigestellt: in Weiss auf reinem Weiss. */
:root[data-theme] .gallery__stage, :root[data-theme] .gallery__stage img,
:root[data-theme] .gallery-thumb, :root[data-theme] .related-card__frame { background: var(--mount); }

/* Helle Ansicht: Kacheln reinweiss wie die Seite (kein warmer Fotogrund).
   Die freigestellten Fotos heller und kraeftiger, dazu ein weicher Schatten
   entlang der Silhouette - so heben sich auch weisse Teile vom Weiss ab, und
   die Farben leuchten. Wie stark aufgehellt wird, misst build_site.py je Foto
   (foto_hell -> --d119-hell, 1.0 bis 1.25; ohne Messwert 1.08). Die
   Bilddateien bleiben unveraendert. */
:root[data-theme="hell"] .plate__frame,
:root[data-theme="hell"] .cart-line__frame,
:root[data-theme="hell"] .kasse-stueck__bild { background: #ffffff; box-shadow: none; }
:root[data-theme="hell"] .plate__frame img,
:root[data-theme="hell"] .gallery__stage img,
:root[data-theme="hell"] .gallery-thumb img,
:root[data-theme="hell"] .related-card__frame img,
:root[data-theme="hell"] .cart-line__frame img,
:root[data-theme="hell"] .kasse-stueck__bild img {
  background: transparent;
  filter: brightness(var(--d119-hell, 1.08)) contrast(1.06) saturate(1.22) drop-shadow(0 12px 16px rgba(21, 21, 20, 0.16));
  transition: filter .35s ease;
}
@media (prefers-reduced-motion: reduce) {
  :root[data-theme="hell"] .plate__frame img { transition: none; }
}

/* Warenkorb und Kasse in hell: reinweiss statt warmer Flaeche, mit weichem
   Schatten; die Hinweiskaesten darin neutral hellgrau. */
:root[data-theme="hell"] .cart-drawer,
:root[data-theme="hell"] .cart-drawer__head,
:root[data-theme="hell"] .cart-drawer__kasse { background: #ffffff; }
:root[data-theme="hell"] .cart-drawer { border-left-color: rgba(21, 21, 20, 0.1); box-shadow: -24px 0 64px rgba(21, 21, 20, 0.12); }
:root[data-theme="hell"] .kasse-meldung,
:root[data-theme="hell"] .kasse-konto { background: #f5f5f5; }

/* Mieten-Datumsfelder: Kalender in hell */
:root[data-theme] #d119RentalStart, :root[data-theme] #d119RentalEnd { color-scheme: light; }

/* Runder Umschalter unten links auf jeder Seite (ansicht.js) */
.d119-ansicht {
  position: fixed; left: 14px; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); z-index: 60;
  width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; padding: 0;
  border: 1px solid rgba(242, 239, 231, 0.34); background: rgba(10, 10, 9, 0.78); color: #f2efe7;
  cursor: pointer; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  transition: transform .15s ease, border-color .15s ease;
}
.d119-ansicht:hover { border-color: #f2efe7; transform: scale(1.05); }
.d119-ansicht:focus-visible { outline: 2px solid #8f897c; outline-offset: 3px; }
.d119-ansicht svg { width: 20px; height: 20px; }
:root[data-theme="hell"] .d119-ansicht { border-color: rgba(21, 21, 20, 0.28); background: rgba(255, 255, 255, 0.86); color: #151514; }
:root[data-theme="hell"] .d119-ansicht:hover { border-color: #151514; }
@media print { .d119-ansicht { display: none; } }

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
