#!/usr/bin/env python3
"""Improve product metadata only where the source record itself proves the fact.

Rules:
- color: inferred only from explicit color words in the title
- size: inferred only from an explicit Size/Größe/Taille/EU/UK/US label
- condition: inferred only from an explicit Zustand/Condition/État label
- thin descriptions: expanded using already-known facts plus an honest gap note
- unresolved fields remain unresolved and are tracked in data_quality_open

No condition, size, color or article number is guessed from photos or assumptions.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
ITEMS_PATH = BASE / "data" / "items.json"

WEARABLE_CATEGORIES = {"Jackets", "Coats", "Tops", "Shirts", "Knitwear", "Pants", "Skirts", "Dresses", "Shoes"}

# Longest/specific phrases first. Canonical values intentionally stay compact
# because the public color filter uses these exact values.
COLOR_PATTERNS = [
    (r"\b(?:neon\s*green|neongr(?:ü|u)n)\b", "Neongrün"),
    (r"\b(?:dark\s*blue|navy|dunkelblau)\b", "Dunkelblau"),
    (r"\b(?:light\s*blue|hellblau)\b", "Hellblau"),
    (r"\b(?:burgundy|bordeaux|weinrot)\b", "Bordeaux"),
    (r"\b(?:rotbraun(?:e|er|es)?|reddish\s*brown)\b", "Rotbraun"),
    (r"\b(?:black|schwarz(?:e|er|es)?)\b", "Schwarz"),
    (r"\b(?:white|wei(?:ß|ss)(?:e|er|es)?)\b", "Weiß"),
    (r"\b(?:grey|gray|grau(?:e|er|es)?)\b", "Grau"),
    (r"\b(?:blue|blau(?:e|er|es)?)\b", "Blau"),
    (r"\b(?:green|gr(?:ü|u)n(?:e|er|es)?)\b", "Grün"),
    (r"\b(?:red|rot(?:e|er|es)?)\b", "Rot"),
    (r"\b(?:orange)\b", "Orange"),
    (r"\b(?:brown|braun(?:e|er|es)?)\b", "Braun"),
    (r"\b(?:beige)\b", "Beige"),
    (r"\b(?:pink|rosa)\b", "Rosa"),
    (r"\b(?:purple|violet|violett|lila)\b", "Violett"),
    (r"\b(?:yellow|gelb(?:e|er|es)?)\b", "Gelb"),
    (r"\b(?:silver|silber(?:n|ne|ner|nes)?)\b", "Silber"),
    (r"\b(?:gold|golden)\b", "Gold"),
]

CONDITION_MAP = {
    "sehr gut": "Sehr gut", "very good": "Sehr gut", "très bon": "Sehr gut", "tres bon": "Sehr gut",
    "gut": "Gut", "good": "Gut", "bon": "Gut",
    "zufriedenstellend": "Zufriedenstellend", "satisfactory": "Zufriedenstellend", "satisfaisant": "Zufriedenstellend",
    "repariert": "Repariert", "repaired": "Repariert", "réparé": "Repariert", "repare": "Repariert",
    "mit defekt": "Mit Defekt", "with defect": "Mit Defekt", "avec défaut": "Mit Defekt", "avec defaut": "Mit Defekt",
}

SIZE_RE = re.compile(
    r"\b(?:gr(?:ö|oe)sse|gr\.?|size|taille|eu|uk|us)\s*[:#-]?\s*"
    r"(?P<size>xxs|xs|s|m|l|xl|xxl|xxxl|\d{1,3}(?:[.,]\d)?)\b",
    re.I,
)
CONDITION_RE = re.compile(
    r"\b(?:zustand|condition|état|etat)\s*[:\-]\s*"
    r"(?P<condition>sehr gut|very good|très bon|tres bon|gut|good|bon|"
    r"zufriedenstellend|satisfactory|satisfaisant|repariert|repaired|réparé|repare|"
    r"mit defekt|with defect|avec défaut|avec defaut)\b",
    re.I,
)


def normalized(text: str) -> str:
    return unicodedata.normalize("NFKC", text or "")


def infer_color(title: str) -> str:
    text = normalized(title)
    found = []
    occupied = []
    for pattern, value in COLOR_PATTERNS:
        for match in re.finditer(pattern, text, flags=re.I):
            span = match.span()
            if any(not (span[1] <= other[0] or span[0] >= other[1]) for other in occupied):
                continue
            occupied.append(span)
            if value not in found:
                found.append(value)
    return ", ".join(found[:3])


def infer_size(item: dict) -> str:
    text = "\n".join(str(item.get(k) or "") for k in ("title", "desc_de", "desc", "desc_en", "desc_fr"))
    match = SIZE_RE.search(normalized(text))
    if not match:
        return ""
    raw = match.group("size").upper().replace(",", ".")
    prefix = match.group(0).lower()
    if re.search(r"\beu\b", prefix) and raw[0].isdigit():
        return "EU " + raw
    if re.search(r"\buk\b", prefix) and raw[0].isdigit():
        return "UK " + raw
    if re.search(r"\bus\b", prefix) and raw[0].isdigit():
        return "US " + raw
    return raw


def infer_condition(item: dict) -> str:
    text = "\n".join(str(item.get(k) or "") for k in ("desc_de", "desc", "desc_en", "desc_fr"))
    match = CONDITION_RE.search(normalized(text))
    if not match:
        return ""
    key = match.group("condition").strip().lower()
    return CONDITION_MAP.get(key, "")


def missing_fields(item: dict) -> list[str]:
    category = item.get("taxonomy_category") or item.get("category") or ""
    missing = []
    if category in WEARABLE_CATEGORIES and not str(item.get("size") or "").strip():
        missing.append("size")
    if not str(item.get("color") or "").strip():
        missing.append("color")
    if not str(item.get("condition") or "").strip():
        missing.append("condition")
    return missing


def expand_description(item: dict, lang: str) -> str:
    key = {"de": "desc_de", "en": "desc_en", "fr": "desc_fr"}[lang]
    fallback = item.get("desc") if lang == "de" else ""
    current = str(item.get(key) or fallback or "").strip()
    if len(current) >= 80:
        return current
    brand = str(item.get("brand") or "Disorder119").strip()
    title = str(item.get("title") or "Archivstück").strip()
    category = str(item.get("taxonomy_category") or item.get("category") or "").strip()
    size = str(item.get("size") or "").strip()
    color = str(item.get("color") or "").strip()
    condition = str(item.get("condition") or "").strip()
    gaps = missing_fields(item)
    if lang == "de":
        start = current or f"Aus dem kuratierten Archiv von Disorder119. {title} von {brand}."
        facts = []
        if category: facts.append("Kategorie: " + category)
        if size: facts.append("Größe: " + size)
        if color: facts.append("Farbe: " + color)
        if condition: facts.append("Zustand: " + condition)
        extra = (" " + ". ".join(facts) + ".") if facts else ""
        gap = " Fehlende Angaben werden vor dem Kauf bestätigt und nicht geschätzt." if gaps else ""
    elif lang == "en":
        start = current or f"From the curated Disorder119 archive. {title} by {brand}."
        facts = []
        if category: facts.append("Category: " + category)
        if size: facts.append("Size: " + size)
        if color: facts.append("Color: " + color)
        if condition: facts.append("Condition: " + condition)
        extra = (" " + ". ".join(facts) + ".") if facts else ""
        gap = " Missing details are confirmed before purchase and are never guessed." if gaps else ""
    else:
        start = current or f"Issu de l’archive sélectionnée Disorder119. {title} par {brand}."
        facts = []
        if category: facts.append("Catégorie : " + category)
        if size: facts.append("Taille : " + size)
        if color: facts.append("Couleur : " + color)
        if condition: facts.append("État : " + condition)
        extra = (" " + ". ".join(facts) + ".") if facts else ""
        gap = " Les informations manquantes sont confirmées avant l’achat et ne sont jamais inventées." if gaps else ""
    return (start.rstrip(". ") + "." + extra + gap).strip()


def main() -> None:
    items = json.loads(ITEMS_PATH.read_text(encoding="utf-8"))
    changed = False
    filled = {"color": 0, "size": 0, "condition": 0, "description": 0}
    for item in items:
        provenance = item.get("data_quality_sources")
        if not isinstance(provenance, dict):
            provenance = {}

        if not str(item.get("color") or "").strip():
            value = infer_color(str(item.get("title") or ""))
            if value:
                item["color"] = value
                provenance["color"] = "explicit-title-color"
                filled["color"] += 1
                changed = True

        if not str(item.get("size") or "").strip():
            value = infer_size(item)
            if value:
                item["size"] = value
                provenance["size"] = "explicit-labeled-source-text"
                filled["size"] += 1
                changed = True

        if not str(item.get("condition") or "").strip():
            value = infer_condition(item)
            if value:
                item["condition"] = value
                provenance["condition"] = "explicit-labeled-source-text"
                filled["condition"] += 1
                changed = True

        for lang, key in (("de", "desc_de"), ("en", "desc_en"), ("fr", "desc_fr")):
            before = str(item.get(key) or (item.get("desc") if lang == "de" else "") or "").strip()
            after = expand_description(item, lang)
            if after != before:
                item[key] = after
                if lang == "de":
                    item["desc"] = after
                filled["description"] += 1
                changed = True

        open_fields = missing_fields(item)
        if item.get("data_quality_open") != open_fields:
            item["data_quality_open"] = open_fields
            changed = True
        if provenance:
            if item.get("data_quality_sources") != provenance:
                item["data_quality_sources"] = provenance
                changed = True

    if changed:
        ITEMS_PATH.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Produktdaten konservativ gehaertet: " + ", ".join(f"{k}={v}" for k, v in filled.items()))
    unresolved = {"size": 0, "color": 0, "condition": 0}
    available = 0
    for item in items:
        if item.get("public_status") != "AVAILABLE":
            continue
        available += 1
        for field in item.get("data_quality_open") or []:
            if field in unresolved:
                unresolved[field] += 1
    print(f"AVAILABLE={available}; offene Felder nach sicherer Reparatur: {unresolved}")


if __name__ == "__main__":
    main()
