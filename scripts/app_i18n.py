"""I18N-Tabelle aus assets/app.js fuer den Build (build_site.py) und Pruefungen.

Die Startseiten /en/ und /fr/ stehen seit dem 28.10.2026 fertig uebersetzt im
HTML. Die Texte kommen aus genau der Tabelle, mit der app.js im Browser
uebersetzt (var I18N = {...} plus spaetere Zuweisungen I18N.xx.key = "..."),
damit es keine zweite Uebersetzungsliste gibt. Gelesen werden nur
Zeichenketten; Rechtstexte (window.D119Legal...) bleiben aussen vor.
"""
from __future__ import annotations

import re
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
APP_JS = BASE / "assets" / "app.js"

_APP_I18N = None


def _js_zeichenkette(text, start):
    """Liest ein JS-Zeichenkettenliteral ab text[start] (" oder ')."""
    ende_zeichen = text[start]
    teile, i = [], start + 1
    ersatz = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}
    while True:
        c = text[i]
        if c == ende_zeichen:
            return "".join(teile), i + 1
        if c == "\\":
            n = text[i + 1]
            if n == "u":
                teile.append(chr(int(text[i + 2:i + 6], 16)))
                i += 6
                continue
            if n == "x":
                teile.append(chr(int(text[i + 2:i + 4], 16)))
                i += 4
                continue
            teile.append(ersatz.get(n, n))
            i += 2
            continue
        if c == "\n":
            raise ValueError("Zeilenumbruch in JS-Zeichenkette")
        teile.append(c)
        i += 1


def app_i18n():
    """I18N-Tabelle aus assets/app.js (nur Zeichenketten; Rechtstexte fehlen)."""
    global _APP_I18N
    if _APP_I18N is not None:
        return _APP_I18N
    text = APP_JS.read_text(encoding="utf-8")
    start = text.index("var I18N = {")
    i = text.index("{", start) + 1
    tabelle, sprache, tiefe = {}, None, 1
    muster = re.compile(r"\s*([A-Za-z_$][\w$]*)\s*:\s*")
    while tiefe > 0:
        c = text[i]
        if c in " \t\r\n,":
            i += 1
            continue
        if c == "}":
            tiefe -= 1
            sprache = None if tiefe == 1 else sprache
            i += 1
            continue
        m = muster.match(text, i)
        if not m:
            raise ValueError(f"I18N in app.js nicht lesbar bei Zeichen {i}: {text[i:i + 40]!r}")
        name, i = m.group(1), m.end()
        if tiefe == 1:
            if text[i] != "{":
                raise ValueError(f"I18N-Sprache {name} ist kein Objekt")
            sprache = tabelle.setdefault(name, {})
            tiefe, i = 2, i + 1
            continue
        if text[i] in "\"'":
            wert, i = _js_zeichenkette(text, i)
            while True:  # "a" + "b"
                m2 = re.compile(r"\s*\+\s*").match(text, i)
                if not m2 or text[m2.end()] not in "\"'":
                    break
                mehr, i = _js_zeichenkette(text, m2.end())
                wert += mehr
            sprache[name] = wert
        elif text.startswith("window.D119Legal.", i):
            i = re.compile(r"[\w$.]+").match(text, i).end()  # Rechtstexte: nicht statisch
        else:
            raise ValueError(f"I18N-Wert {name} ist keine Zeichenkette")
    for m in re.finditer(r'I18N\.(de|en|fr)\.([A-Za-z_$][\w$]*)\s*=\s*(["\'])', text):
        wert, _ = _js_zeichenkette(text, m.start(3))
        tabelle[m.group(1)][m.group(2)] = wert
    _APP_I18N = tabelle
    return tabelle


def app_text(lang, key):
    """Wie t() in app.js: Sprache, sonst Deutsch."""
    tabelle = app_i18n()
    wert = tabelle.get(lang, {}).get(key)
    return wert if wert is not None else tabelle["de"].get(key, "")
