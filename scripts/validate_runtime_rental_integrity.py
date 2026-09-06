#!/usr/bin/env python3
"""Hard end-to-end checks for the single Disorder119 Rental V2 runtime."""
from __future__ import annotations

from pathlib import Path

BASE = Path(__file__).resolve().parents[1]


def text(rel: str) -> str:
    return (BASE / rel).read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit("FEHLER: Runtime-Rental-Integritaet: " + message)


def main() -> None:
    template = text("index_template.html")
    rental = text("assets/rental-v2.js")
    ui = text("assets/rental-v2-ui.js")
    picker = text("assets/rental-v2-picker.js")
    core = text("shop-worker/commerce-core.js")
    worker = text("shop-worker/worker.js")
    bundle = text("shop-worker/rental-bundle.js")
    injector = text("scripts/inject_rental_v2.py")

    legacy_scripts = ("/assets/rental-commerce.js", "/assets/rental-v2-bundle.js")
    for legacy in legacy_scripts:
        require(legacy not in template, f"Template laedt Legacy-Runtime {legacy}")

    require("RUNTIME_AUDIT_ATOMIC_BUNDLE_POST" in rental, "atomarer Bundle-POST fehlt in Rental V2")
    require(' + "/rental-bundle"' in rental, "Rental V2 nutzt /rental-bundle nicht")
    require(' + "/rental-request"' not in rental, "Rental V2 sendet noch einzelne /rental-request Requests")
    require("RUNTIME_AUDIT_PICKER_API" in rental and "window.D119RentalV2" in rental, "stabile Picker-API fehlt")
    require("RUNTIME_AUDIT_RENTAL_DEDUPE" in rental, "Rental-State wird nicht dedupliziert")
    require("RUNTIME_AUDIT_NO_PAST_RENTAL" in rental, "Frontend blockiert vergangene Mietzeiträume nicht")
    require("BUNDLE_RECEIPT_KEY" in rental and "saveBundleReceipt" in rental, "atomare Server-Belege werden nicht lokal dokumentiert")

    require("RUNTIME_AUDIT_UI_DEDUPE" in ui, "Rental-UI dedupliziert IDs nicht")
    require("RUNTIME_AUDIT_PICKER_DEDUPE" in picker, "Picker dedupliziert IDs nicht")
    require("RUNTIME_AUDIT_PICKER_TAXONOMY" in picker, "Picker nutzt die geprüfte Taxonomie nicht")
    require("item.taxonomy_category || item.category" in picker, "Picker fällt nicht korrekt auf Legacy-Kategorie zurück")
    require("RUNTIME_AUDIT_PICKER_OFFDOM" in picker, "Picker hängt weiterhin von gerenderten Archivkarten ab")
    require("api.toggleItem(id)" in picker, "Picker verwendet Rental-V2-API nicht")
    require("RUNTIME_AUDIT_PICKER_ALT" in picker, "Picker-Alttexte deduplizieren die Marke nicht")

    require("RUNTIME_AUDIT_SERVER_NO_PAST" in core and "RENTAL_DATE_IN_PAST" in core, "Server akzeptiert vergangene Mietstarts")
    require(worker.count("RUNTIME_AUDIT_SERVER_DATE_MAP") >= 2, "Legacy Rental-Quote/Request mappt Past-Date Fehler nicht sauber")
    require("RUNTIME_AUDIT_BUNDLE_DATE_MAP" in bundle, "Atomic Bundle mappt Past-Date Fehler nicht sauber")

    require("LEGACY_BRIDGE" in injector and "LEGACY_BUNDLE" in injector, "Injector entfernt Legacy-Scripts nicht explizit")
    require("Single Rental V2 + UI + Picker" in injector, "Injector ist nicht auf Single-Runtime umgestellt")

    # Representative generated bundle pages must carry only the single runtime.
    generated = ["index.html", "mieten/index.html", "en/index.html", "fr/index.html"]
    for rel in generated:
        page = text(rel)
        for legacy in legacy_scripts:
            require(legacy not in page, f"{rel} laedt Legacy-Runtime {legacy}")
        require(page.count('/assets/rental-v2.js') == 1, f"{rel} laedt Rental V2 nicht genau einmal")
        require(page.count('/assets/rental-v2-ui.js') == 1, f"{rel} laedt Rental V2 UI nicht genau einmal")
        require(page.count('/assets/rental-v2-picker.js') == 1, f"{rel} laedt Rental Picker nicht genau einmal")

    print("Runtime-Rental-Integritaet: OK — eine Frontend-Architektur, atomarer Bundle-POST, Taxonomie/API/Past-Date abgesichert.")


if __name__ == "__main__":
    main()
