#!/usr/bin/env python3
"""Make canonical rental terms sync depend on Rental V2, not the legacy bridge."""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
PATH = BASE / "scripts" / "apply_rental_terms.py"


def main() -> None:
    text = PATH.read_text(encoding="utf-8")
    if "RUNTIME_TERMS_V2_ANCHOR" in text:
        print("Rental-Terms Runtime-Anker bereits aktuell.")
        return
    old_marker = 'BRIDGE_MARKER = \'<script src="/assets/rental-commerce.js"></script>\''
    new_marker = 'RUNTIME_MARKER = \'<script src="/assets/rental-v2.js"></script>\'  # RUNTIME_TERMS_V2_ANCHOR'
    if old_marker not in text:
        raise SystemExit("FEHLER: Legacy Rental-Terms Marker fehlt")
    text = text.replace(old_marker, new_marker, 1)

    old = '''    # rental-commerce.js still contains a short compatibility summary for old builds.\n    # Re-apply the canonical full terms immediately after that bridge executes so the\n    # visible DOM and the no-JS static HTML are identical.\n    html = SYNC_RE.sub("", html)\n    if BRIDGE_MARKER not in html:\n        raise SystemExit(f"FEHLER: Rental-Bridge fehlt in {path.relative_to(BASE)}")\n    sync = (\n        '<script id="rentalTermsCanonical">(function(){var p=document.querySelector('\n        '\".static-page .legal-panel\");if(p)p.innerHTML='\n        + json.dumps(TERMS[lang], ensure_ascii=False)\n        + ';})();</script>'\n    )\n    html = html.replace(BRIDGE_MARKER, BRIDGE_MARKER + "\\n" + sync, 1)'''
    new = '''    # Re-apply the canonical full terms immediately after Rental V2 loads so the\n    # visible DOM and the no-JS static HTML stay identical without a legacy bridge.\n    html = SYNC_RE.sub("", html)\n    if RUNTIME_MARKER not in html:\n        raise SystemExit(f"FEHLER: Rental-V2-Runtime fehlt in {path.relative_to(BASE)}")\n    sync = (\n        '<script id="rentalTermsCanonical">(function(){var p=document.querySelector('\n        '\".static-page .legal-panel\");if(p)p.innerHTML='\n        + json.dumps(TERMS[lang], ensure_ascii=False)\n        + ';})();</script>'\n    )\n    html = html.replace(RUNTIME_MARKER, RUNTIME_MARKER + "\\n" + sync, 1)'''
    if old not in text:
        raise SystemExit("FEHLER: Legacy Rental-Terms Sync-Block fehlt")
    text = text.replace(old, new, 1)
    PATH.write_text(text, encoding="utf-8")
    print("Rental-Terms auf Rental-V2-Runtime umgestellt.")


if __name__ == "__main__":
    main()
