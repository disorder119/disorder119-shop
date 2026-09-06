#!/usr/bin/env python3
"""Improve product metadata only where the source record itself proves the fact.

Rules:
- color: inferred only from explicit color words in the title, excluding known
  brand/collection-name contexts that merely look like color words
- size: inferred only from an explicit Size/Größe/Taille/EU/UK/US label
- condition: inferred only from an explicit Zustand/Condition/État label or an
  equally explicit condition phrase
- unresolved physical facts remain open and are never guessed
- automated fills retain machine-readable provenance
"""
from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
ITEMS_PATH = BASE / "data" / "items.json"
REPORT_PATH = BASE / "data" / "product-metadata-evidence-report.json"

WEARABLE_CATEGORIES = {"Jackets", "Coats", "Tops", "Shirts", "Knitwear", "Pants", "Skirts", "Dresses", "Shoes"}

# Longest/specific phrases first. Canonical values stay compact because the
# public color filter uses these exact values.
COLOR_PATTERNS = [
    (r"\b(?:multi[\s-]?colou?r|mehrfarbig)\b", "Mehrfarbig"),
    (r"\b(?:neon\s*green|neongr(?:ü|u)n)\b", "Neongrün"),
    (r"\b(?:dark\s*blue|navy|dunkelblau)\b", "Dunkelblau"),
    (r"\b(?:light\s*blue|hellblau)\b", "Hellblau"),
    (r"\b(?:burgundy|bordeaux|weinrot)\b", "Bordeaux"),
    (r"\b(?:rotbraun(?:e|er|es)?|reddish\s*brown)\b", "Rotbraun"),
    (r"\b(?:cream|creme|crème)\b", "Creme"),
    (r"\b(?:olive|oliv)\b", "Oliv"),
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

# These phrases contain words that look like colors but identify a brand or
# collection. Their spans are excluded while other explicit colors in the same
# title remain valid: "Red Valentino Black and Blue" -> Schwarz, Blau.
COLOR_CONTEXT_EXCLUSIONS = [
    re.compile(r"\b(?:linea\s+rossa|linnea\s+rosa)\b", re.I),
    re.compile(r"\bred\s+valentino\b", re.I),
    re.compile(r"\boff[\s-]+white\b", re.I),
]

CONDITION_MAP = {
    "sehr gut": "Sehr gut", "very good": "Sehr gut", "très bon": "Sehr gut", "tres bon": "Sehr gut",
    "sehr guten": "Sehr gut", "sehr gutem": "Sehr gut", "sehr guter": "Sehr gut",
    "gut": "Gut", "good": "Gut", "bon": "Gut",
    "guten": "Gut", "gutem": "Gut", "guter": "Gut",
    "zufriedenstellend": "Zufriedenstellend", "satisfactory": "Zufriedenstellend", "satisfaisant": "Zufriedenstellend",
    "zufriedenstellenden": "Zufriedenstellend", "zufriedenstellendem": "Zufriedenstellend",
    "repariert": "Repariert", "repaired": "Repariert", "réparé": "Repariert", "repare": "Repariert",
    "reparierten": "Repariert", "repariertem": "Repariert",
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
CONDITION_PROSE_RES = [
    re.compile(
        r"\b(?:in|mit)\s+(?:einem\s+)?(?P<condition>sehr\s+guten|sehr\s+gutem|guten|gutem|"
        r"zufriedenstellenden|zufriedenstellendem|reparierten|repariertem)\s+zustand\b", re.I
    ),
    re.compile(r"\bzustand\s+(?:ist|bleibt)\s+(?P<condition>sehr\s+gut|gut|zufriedenstellend|repariert)\b", re.I),
    re.compile(r"\b(?:in|with)\s+(?P<condition>very\s+good|good|satisfactory|repaired)\s+condition\b", re.I),
    re.compile(r"\bcondition\s+(?:is|remains)\s+(?P<condition>very\s+good|good|satisfactory|repaired)\b", re.I),
    re.compile(r"\b(?:en|dans\s+un)\s+(?P<condition>très\s+bon|tres\s+bon|bon|satisfaisant|réparé|repare)\s+état\b", re.I),
    re.compile(r"\b(?:état|etat)\s+(?:est\s+)?(?P<condition>très\s+bon|tres\s+bon|bon|satisfaisant|réparé|repare)\b", re.I),
]


def normalized(text: str) -> str:
    return unicodedata.normalize("NFKC", text or "")


def overlaps(span: tuple[int, int], other: tuple[int, int]) -> bool:
    return not (span[1] <= other[0] or span[0] >= other[1])


def infer_color(title: str) -> str:
    text = normalized(title)
    excluded = [m.span() for pattern in COLOR_CONTEXT_EXCLUSIONS for m in pattern.finditer(text)]
    found: list[str] = []
    occupied: list[tuple[int, int]] = []
    for pattern, value in COLOR_PATTERNS:
        for match in re.finditer(pattern, text, flags=re.I):
            span = match.span()
            if any(overlaps(span, blocked) for blocked in excluded):
                continue
            if any(overlaps(span, other) for other in occupied):
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


def condition_evidence(item: dict) -> tuple[str, str]:
    text = normalized("\n".join(str(item.get(k) or "") for k in ("desc_de", "desc", "desc_en", "desc_fr")))
    match = CONDITION_RE.search(text)
    if match:
        key = re.sub(r"\s+", " ", match.group("condition").strip().lower())
        return CONDITION_MAP.get(key, ""), "explicit-labeled-source-text"
    for pattern in CONDITION_PROSE_RES:
        match = pattern.search(text)
        if match:
            key = re.sub(r"\s+", " ", match.group("condition").strip().lower())
            value = CONDITION_MAP.get(key, "")
            if value:
                return value, "explicit-condition-prose"
    return "", ""


def infer_condition(item: dict) -> str:
    return condition_evidence(item)[0]


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


def write_report(items: list[dict], filled: dict[str, int]) -> None:
    available_items = [item for item in items if item.get("public_status") == "AVAILABLE"]
    unresolved = Counter()
    unresolved_rows = []
    provenance = Counter()
    for item in items:
        sources = item.get("data_quality_sources")
        if isinstance(sources, dict):
            provenance.update(str(value) for value in sources.values() if value)
    for item in available_items:
        gaps = missing_fields(item)
        unresolved.update(gaps)
        if gaps:
            unresolved_rows.append({
                "id": item.get("id"),
                "title": item.get("title") or "",
                "brand": item.get("brand") or "",
                "missing": gaps,
            })
    report = {
        "policy": "Only explicit source evidence; no guessed physical product facts.",
        "available_items": len(available_items),
        "filled_this_run": filled,
        "unresolved_available": {key: unresolved.get(key, 0) for key in ("size", "color", "condition")},
        "provenance_counts": dict(sorted(provenance.items())),
        "manual_evidence_queue": unresolved_rows,
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_color_inference_regressions() -> None:
    cases = {
        "Burberrys Sweater Cream Embroidered Cursive Logo": "Creme",
        "Prada Lack Heel Creme": "Creme",
        "Issey Miyake Olive": "Oliv",
        "Louis Vuitton Takashi Murakami Multicolor Monogram Sandals": "Mehrfarbig",
        "Maison Margiela Linnea Rosa Knit Sweater": "",
        "Prada Linea Rossa Knit Sweater": "",
        "Red Valentino Black and Blue": "Schwarz, Blau",
        "OFF White Undercover Red": "Rot",
    }
    for title, expected in cases.items():
        actual = infer_color(title)
        if actual != expected:
            raise SystemExit(f"FEHLER: Color-Evidence-Regression für {title!r}: {actual!r} != {expected!r}")


def main() -> None:
    validate_color_inference_regressions()
    items = json.loads(ITEMS_PATH.read_text(encoding="utf-8"))
    changed = False
    filled = {"color": 0, "color_corrected": 0, "size": 0, "condition": 0, "description": 0}
    for item in items:
        provenance = item.get("data_quality_sources")
        if not isinstance(provenance, dict):
            provenance = {}

        title = str(item.get("title") or "")
        inferred_color = infer_color(title)
        existing_color = str(item.get("color") or "").strip()
        if provenance.get("color") == "explicit-title-color":
            # Re-evaluate only our own automated values. Manually supplied color
            # fields are never touched. This self-corrects older false positives
            # when a brand/collection token is newly excluded.
            if existing_color != inferred_color:
                item["color"] = inferred_color
                if inferred_color:
                    provenance["color"] = "explicit-title-color"
                else:
                    provenance.pop("color", None)
                filled["color_corrected"] += 1
                changed = True
        elif not existing_color and inferred_color:
            item["color"] = inferred_color
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
            value, source = condition_evidence(item)
            if value:
                item["condition"] = value
                provenance["condition"] = source
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
        elif item.get("data_quality_sources"):
            item.pop("data_quality_sources", None)
            changed = True

    if changed:
        ITEMS_PATH.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_report(items, filled)
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
