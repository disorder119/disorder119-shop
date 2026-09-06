#!/usr/bin/env python3
"""Fix reviewed product subtypes after the multilingual taxonomy audit.

The taxonomy classifier intentionally reads translated descriptions, but French
``veste`` means *jacket*, not English/German *vest/Weste*. Treating ``veste`` as
``Vest`` caused fully sleeved jackets to appear publicly as ``Weste`` while the
broad category still remained ``Jacken``. This migration removes that ambiguous
cross-language synonym and pins the verified affected records to their reviewed
subtype.

Match, Chaos and Baukasten are not touched. The protected legacy ``category``
field is not modified here.
"""
from __future__ import annotations

from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
PATH = BASE / "scripts" / "catalog_taxonomy.py"
MARKER = "TAXONOMY_SUBTYPE_AUDIT_20260906"


def main() -> None:
    text = PATH.read_text(encoding="utf-8")
    if MARKER in text:
        print("Taxonomie-Subtype-Audit bereits angewendet.")
        return

    # These products were manually checked against their public German
    # descriptions after the audit. They explicitly describe sleeved jackets.
    # 9417 is the inverse regression guard: its description explicitly says
    # "Ärmellose Zip-Weste", so it must remain a Vest even though its title is
    # the French-looking "Y-3 Veste".
    anchor = 'PRODUCT_TYPE_OVERRIDES = {\n'
    if anchor not in text:
        raise SystemExit("FEHLER: PRODUCT_TYPE_OVERRIDES fehlt in catalog_taxonomy.py")
    reviewed = (
        'PRODUCT_TYPE_OVERRIDES = {\n'
        '    # TAXONOMY_SUBTYPE_AUDIT_20260906: reviewed jacket/vest semantics.\n'
        '    9512: "Jacket",  # Dsquared2 Suf Camp Gelb – description: Leichte Jacke\n'
        '    9500: "Jacket",  # Prada Knitterjacke – description: Diese Prada Jacke\n'
        '    9454: "Jacket",  # Prada Goretex Weiss – description: Diese Prada Jacke\n'
        '    9443: "Jacket",  # Balmain Braun – description: Diese Balmain Jacke\n'
        '    9442: "Jacket",  # Balmain Furry – description: Kurze Balmain Jacke\n'
        '    9417: "Vest",    # Y-3 Veste – description: Ärmellose Zip-Weste\n'
    )
    text = text.replace(anchor, reviewed, 1)

    old_rule = r'(r"\bvest\b|\bweste\b|\bveste\b", "Vest")'
    new_rule = r'(r"\bvest\b|\bweste\b", "Vest")'
    if old_rule not in text:
        raise SystemExit("FEHLER: erwartete Vest-Regel fehlt in catalog_taxonomy.py")
    text = text.replace(old_rule, new_rule, 1)

    PATH.write_text(text, encoding="utf-8")
    print("Taxonomie-Subtype-Audit angewendet: französisches 'veste' ist kein Vest-Synonym mehr; 6 Fälle regressionsfest.")


if __name__ == "__main__":
    main()
