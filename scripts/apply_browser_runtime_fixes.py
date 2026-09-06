#!/usr/bin/env python3
"""Fix runtime defects exposed by the real-browser smoke suite.

Only the normal archive/rental source is touched. Protected creative modes and
mode-guard.json are outside this migration.
"""
from __future__ import annotations

import re
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
APP = BASE / "assets" / "app.js"
RENTAL = BASE / "assets" / "rental-v2.js"
PRICE_MARKER = "BROWSER_RUNTIME_RENTAL_PRICE_V1"
OBSERVER_MARKER = "BROWSER_RUNTIME_RENTAL_OBSERVER_V1"


def patch_app() -> bool:
    text = APP.read_text(encoding="utf-8")
    changed = False

    if PRICE_MARKER not in text:
        pattern = re.compile(
            r'(  function fmtPriceDisplay\(v\) \{\n'
            r'    return v > 0 \? fmtPrice\(v\) : t\("priceOnRequest"\);\n'
            r'  \}\n)'
        )
        match = pattern.search(text)
        if not match:
            raise SystemExit("FEHLER: fmtPriceDisplay-Patchmarker fehlt")
        addition = match.group(1) + '''\n  // Rental catalogue cards use the same protected 10%-per-calendar-day rule\n  // as Rental V2. Keep this formatter local to the catalogue renderer so the\n  // rental archive never depends on a removed legacy runtime.\n  function fmtRentalPrice(it) { // BROWSER_RUNTIME_RENTAL_PRICE_V1\n    var salePrice = Number(it && it.price);\n    if (!Number.isFinite(salePrice) || salePrice <= 0) return t("rentalPriceOnRequest");\n    var daily = Math.round(salePrice * 10) / 100;\n    return fmtPrice(daily) + (LANG === "fr" ? " / jour" : LANG === "en" ? " / day" : " / Tag");\n  }\n'''
        text = text[:match.start()] + addition + text[match.end():]
        changed = True

    replacements = {
        'mietenTermsHeading: "Wie die Miete funktiert"': 'mietenTermsHeading: "Wie die Miete funktioniert"',
        'mietenTermsHtml: "<ul><li><strong>Mietpreis:</strong> in der Regel ca. 15&nbsp;% des im Archiv angegebenen Preises pro Zeitraum von bis zu 4 Tagen (Richtwert — der genaue Preis wird bei jeder Anfrage persönlich bestätigt, abhängig von Stück und Zeitraum).</li><li><strong>Kaution:</strong> wird bei Abholung/Versand hinterlegt und nach unbeschädigter, vollständiger Rückgabe innerhalb von 7 Tagen zurückerstattet.</li><li><strong>Reinigung:</strong> normale Gebrauchsspuren und einfache Verschmutzungen sind im Mietpreis enthalten. Für die professionelle Reinigung nach der Nutzung wird ggf. eine Reinigungspauschale einbehalten.</li><li><strong>Schäden:</strong> Reparable Schäden werden von der Kaution beglichen; bei nicht behebbaren Schäden oder Verlust wird der aktuelle Archivwert des Stücks fällig.</li><li><strong>Zeitraum:</strong> Standard bis zu 4 Tage, längere Zeiträume auf Anfrage möglich.</li><li>Alle Angaben sind unverbindlich und werden bei jeder Anfrage individuell bestätigt — dies ist kein automatisiertes Buchungssystem.</li></ul>"': 'mietenTermsHtml: "<ul><li><strong>Mietpreis:</strong> exakt 10&nbsp;% des aktuell angegebenen Verkaufspreises pro ausgewähltem Kalendertag.</li><li><strong>Kaution:</strong> grundsätzlich 50&nbsp;% des aktuellen Verkaufspreises, mindestens 50&nbsp;€.</li><li><strong>Zeitraum:</strong> standardmäßig maximal 7 Kalendertage; längere Zeiträume nur nach individueller Bestätigung.</li><li>Das Absenden einer Anfrage ist noch keine bestätigte Buchung.</li></ul>"',
        'mietenTermsHtml: "<ul><li><strong>Rental price:</strong> typically around 15% of the archive price per period of up to 4 days (a guideline — the exact price is confirmed personally for every request, depending on the piece and duration).</li><li><strong>Deposit:</strong> collected at pickup/shipping and refunded after undamaged, complete return within 7 days.</li><li><strong>Cleaning:</strong> normal wear and light soiling are included in the rental price. A cleaning fee may be withheld for professional cleaning after use.</li><li><strong>Damage:</strong> repairable damage is settled from the deposit; for damage beyond repair or loss, the piece\'s current archive value becomes due.</li><li><strong>Duration:</strong> up to 4 days by default, longer periods on request.</li><li>All details are non-binding and confirmed individually for every request — this is not an automated booking system.</li></ul>"': 'mietenTermsHtml: "<ul><li><strong>Rental price:</strong> exactly 10% of the current listed sale price per selected calendar day.</li><li><strong>Deposit:</strong> generally 50% of the current sale price, with a minimum of €50.</li><li><strong>Duration:</strong> normally a maximum of 7 calendar days; longer periods require individual confirmation.</li><li>Sending a request does not itself create a confirmed booking.</li></ul>"',
        'mietenTermsHtml: "<ul><li><strong>Prix de location :</strong> environ 15&nbsp;% du prix indiqué dans l\'archive par période de 4 jours maximum (indicatif — le prix exact est confirmé personnellement pour chaque demande, selon la pièce et la durée).</li><li><strong>Caution :</strong> déposée au retrait/à l\'envoi et remboursée après un retour complet et non endommagé sous 7 jours.</li><li><strong>Nettoyage :</strong> l\'usure normale et les salissures légères sont incluses dans le prix de location. Des frais de nettoyage professionnel peuvent être retenus après usage.</li><li><strong>Dommages :</strong> les dommages réparables sont réglés via la caution ; en cas de dommage irréparable ou de perte, la valeur actuelle de la pièce dans l\'archive est due.</li><li><strong>Durée :</strong> 4 jours maximum par défaut, périodes plus longues sur demande.</li><li>Toutes les informations sont sans engagement et confirmées individuellement pour chaque demande — il ne s\'agit pas d\'un système de réservation automatisé.</li></ul>"': 'mietenTermsHtml: "<ul><li><strong>Prix de location :</strong> exactement 10&nbsp;% du prix de vente actuel indiqué par jour calendaire sélectionné.</li><li><strong>Caution :</strong> en principe 50&nbsp;% du prix de vente actuel, avec un minimum de 50&nbsp;€.</li><li><strong>Durée :</strong> normalement 7 jours calendaires maximum ; les périodes plus longues nécessitent une confirmation individuelle.</li><li>L\'envoi d\'une demande ne constitue pas encore une réservation confirmée.</li></ul>"',
    }
    for old, new in replacements.items():
        if old in text:
            text = text.replace(old, new, 1)
            changed = True

    # The obsolete percentages must never survive in the source I18N table.
    obsolete = ("ca. 15&nbsp;%", "typically around 15%", "environ 15&nbsp;%", "Standard bis zu 4 Tage", "up to 4 days by default", "4 jours maximum par défaut")
    remaining = [token for token in obsolete if token in text]
    if remaining:
        raise SystemExit("FEHLER: veraltete Rental-Regel in app.js verblieben: " + ", ".join(remaining))

    if changed:
        APP.write_text(text, encoding="utf-8")
    return changed


def patch_rental_observer() -> bool:
    """Make grid refresh idempotent so its own MutationObserver cannot loop.

    The rental grid observer watches childList mutations. Assigning textContent
    unconditionally inside that observer creates another childList mutation,
    which schedules the observer again forever and can freeze Chromium on
    /mieten/?item=... . Only write when the visible label actually changed.
    """
    text = RENTAL.read_text(encoding="utf-8")
    if OBSERVER_MARKER in text:
        return False

    old = '''      var id = Number(btn.getAttribute("data-rental"));\n      var active = state.ids.indexOf(id) >= 0;\n      btn.textContent = active ? t("added") : t("add");\n      btn.setAttribute("aria-pressed", active ? "true" : "false");'''
    new = '''      var id = Number(btn.getAttribute("data-rental"));\n      var active = state.ids.indexOf(id) >= 0;\n      var label = active ? t("added") : t("add"); // BROWSER_RUNTIME_RENTAL_OBSERVER_V1\n      if (btn.textContent !== label) btn.textContent = label;\n      var pressed = active ? "true" : "false";\n      if (btn.getAttribute("aria-pressed") !== pressed) btn.setAttribute("aria-pressed", pressed);'''
    if old not in text:
        raise SystemExit("FEHLER: Rental-Card-Refreshblock fuer Observer-Fix nicht gefunden")
    text = text.replace(old, new, 1)

    # Guard against reintroducing the exact self-triggering write pattern.
    if 'btn.textContent = active ? t("added") : t("add");' in text:
        raise SystemExit("FEHLER: nicht-idempotenter Rental-Observer-Write verblieben")

    RENTAL.write_text(text, encoding="utf-8")
    return True


def main() -> None:
    app_changed = patch_app()
    rental_changed = patch_rental_observer()
    if app_changed or rental_changed:
        print("Browser-Runtime-Fixes angewendet: Rental-Kartenformat, konsistente Regeln und loop-sicherer Grid-Observer.")
    else:
        print("Browser-Runtime-Fixes bereits aktuell.")


if __name__ == "__main__":
    main()
