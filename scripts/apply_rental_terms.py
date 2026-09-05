#!/usr/bin/env python3
"""Apply the canonical Disorder119 rental terms to all generated rental pages.

The static site generator still owns the page shell. This post-build step owns the
rental-conditions block and deliberately runs immediately after build_site.py so
future rebuilds cannot reintroduce obsolete rental wording.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]

TERMS = {
    "de": (
        '<h2>Mieten &amp; Ausleihen</h2>'
        '<p>Jedes verfügbare Stück im Archiv kann auch geliehen statt gekauft werden — für Shootings, '
        'Musikvideos, Film- und Theaterproduktionen, redaktionelle Strecken, Events oder private Anlässe. '
        'Wähle ein Stück und sende eine unverbindliche Anfrage mit deinem Wunschzeitraum.</p>'
        '<h3 id="mietbedingungen">Mietbedingungen</h3>'
        '<ul>'
        '<li><strong>Mietpreis:</strong> Der Mietpreis beträgt exakt 10&nbsp;% des aktuell angegebenen '
        'Verkaufspreises pro ausgewähltem Kalendertag. Start- und Rückgabetag zählen jeweils als Miettag. '
        'Bei Artikeln ohne festen Verkaufspreis wird der Mietpreis individuell bestätigt.</li>'
        '<li><strong>Kaution:</strong> Die Kaution beträgt grundsätzlich 50&nbsp;% des aktuellen '
        'Verkaufspreises, mindestens jedoch 50&nbsp;€. Bei besonders wertvollen oder empfindlichen '
        'Einzelstücken kann vor der Buchungsbestätigung eine abweichende Kaution vereinbart werden. '
        'Die Kaution wird nach ordnungsgemäßer Rückgabe und Prüfung des Artikels zurückerstattet bzw. freigegeben.</li>'
        '<li><strong>Zustand bei Übergabe:</strong> Jeder Artikel wird vor Übergabe bzw. Versand geprüft '
        'und sein Zustand dokumentiert. Bereits vorhandene Gebrauchsspuren gehören zum beschriebenen Zustand. '
        'Nicht dokumentierte Mängel bitte unverzüglich, möglichst innerhalb von 12 Stunden nach Erhalt, mit Fotos melden.</li>'
        '<li><strong>Sorgfältiger Umgang:</strong> Die Mietstücke sind überwiegend Designer-, Vintage- und '
        'Second-Hand-Einzelstücke und entsprechend sorgfältig zu behandeln. Normale Gebrauchsspuren durch '
        'vertragsgemäßen und sorgfältigen Gebrauch gelten nicht als Beschädigung.</li>'
        '<li><strong>Reinigung:</strong> Mietstücke bitte nicht selbst waschen, chemisch reinigen, bleichen, '
        'bügeln, färben oder anderweitig behandeln, sofern dies nicht vorher ausdrücklich vereinbart wurde. '
        'Die normale Reinigung nach der Rückgabe ist im Mietpreis enthalten. Bei außergewöhnlichen Verschmutzungen '
        'können tatsächlich entstandene, nachvollziehbare Spezialreinigungs- oder Fleckenentfernungskosten berechnet werden.</li>'
        '<li><strong>Beschädigungen:</strong> Schäden oder außergewöhnliche Verschmutzungen bitte möglichst '
        'sofort mitteilen. Bei vom Mieter verursachten Schäden können die erforderlichen und angemessenen '
        'Reparatur-, Reinigungs- oder Wiederherstellungskosten berechnet werden. Bei Verlust oder wirtschaftlich '
        'nicht reparierbarem Schaden kann Ersatz des nachweisbaren aktuellen Werts verlangt werden; eine geleistete '
        'Kaution wird angerechnet.</li>'
        '<li><strong>Keine Veränderungen:</strong> Kürzen, Nähen, Kleben, Färben, Entfernen von Labels, '
        'Anbringen von Applikationen oder sonstige Veränderungen sind ohne vorherige Zustimmung nicht erlaubt.</li>'
        '<li><strong>Keine Weitervermietung:</strong> Eine Weitervermietung oder sonstige Überlassung an Dritte '
        'ist ohne vorherige Zustimmung nicht gestattet.</li>'
        '<li><strong>Rückgabe:</strong> Das Mietstück muss spätestens zum vereinbarten Rückgabetermin zurückgegeben '
        'werden. Bei Versand ist die Rückgabe entsprechend der vereinbarten Versandart nachweisbar aufzugeben.</li>'
        '<li><strong>Verspätete Rückgabe:</strong> Für jeden verspäteten Kalendertag kann der reguläre Tagesmietpreis '
        'weiterberechnet werden. Entsteht durch eine vom Mieter zu vertretende verspätete Rückgabe ein zusätzlicher, '
        'nachweisbarer Schaden — etwa durch den Ausfall einer bereits bestätigten Folgemiete — kann dieser zusätzlich '
        'geltend gemacht werden.</li>'
        '<li><strong>Nicht passend oder nicht gefallen:</strong> Wird ein Artikel ausschließlich zur Anprobe erhalten '
        'und nach vorheriger Abstimmung innerhalb von 24 Stunden nach Erhalt ungetragen, unverändert und mit einem '
        'gegebenenfalls angebrachten Sicherheitssiegel zurückgesendet, kann der Mietpreis erstattet werden. '
        'Versandkosten können davon ausgenommen sein.</li>'
        '<li><strong>Anfrage und Buchung:</strong> Das Absenden einer Mietanfrage ist noch keine bestätigte Buchung. '
        'Die Miete wird erst verbindlich, nachdem Disorder119 Verfügbarkeit, Mietzeitraum, Mietpreis, Kaution sowie '
        'gegebenenfalls Versandbedingungen ausdrücklich bestätigt hat.</li>'
        '</ul>'
    ),
    "en": (
        '<h2>Rent &amp; Borrow</h2>'
        '<p>Every available piece in the archive can also be rented instead of bought — for shoots, music videos, '
        'film and theatre productions, editorial stories, events or personal occasions. Choose a piece and send a '
        'non-binding request with your preferred dates.</p>'
        '<h3 id="mietbedingungen">Rental terms</h3>'
        '<ul>'
        '<li><strong>Rental price:</strong> The rental price is exactly 10% of the current listed sale price per '
        'selected calendar day. Both the start date and return date count as rental days. If an item has no fixed '
        'sale price, the rental price is confirmed individually.</li>'
        '<li><strong>Deposit:</strong> The deposit is generally 50% of the current sale price, with a minimum of '
        '€50. A different deposit may be agreed before booking confirmation for particularly valuable or delicate '
        'one-off pieces. The deposit is refunded or released after proper return and inspection of the item.</li>'
        '<li><strong>Condition on handover:</strong> Every item is inspected and its condition documented before '
        'handover or shipping. Existing signs of wear form part of the described condition. Please report any '
        'previously undocumented issue without undue delay, preferably within 12 hours of receipt, with photos.</li>'
        '<li><strong>Care:</strong> Rental pieces are predominantly designer, vintage and second-hand one-offs and '
        'must be handled with appropriate care. Normal wear resulting from proper and careful use is not treated as damage.</li>'
        '<li><strong>Cleaning:</strong> Please do not wash, dry-clean, bleach, iron, dye or otherwise treat a rental '
        'piece unless this has been expressly agreed in advance. Normal cleaning after return is included in the '
        'rental price. Documented additional costs for specialist cleaning or stain removal may be charged for '
        'exceptional soiling.</li>'
        '<li><strong>Damage:</strong> Please report damage or exceptional soiling as soon as reasonably possible. '
        'Where damage was caused by the renter, necessary and reasonable repair, cleaning or restoration costs may '
        'be charged. In the event of loss or damage that cannot economically be repaired, the demonstrable current '
        'value may be claimed; any deposit already paid will be credited.</li>'
        '<li><strong>No alterations:</strong> Shortening, sewing, gluing, dyeing, removing labels, adding '
        'applications or making any other alteration is not permitted without prior consent.</li>'
        '<li><strong>No sub-rental:</strong> Sub-renting or otherwise passing the item on to a third party is not '
        'permitted without prior consent.</li>'
        '<li><strong>Return:</strong> The rental piece must be returned no later than the agreed return date. Where '
        'shipping is used, the return must be handed over in a trackable manner using the agreed shipping method.</li>'
        '<li><strong>Late return:</strong> The regular daily rental price may continue to be charged for each late '
        'calendar day. If a delay for which the renter is responsible causes an additional demonstrable loss — for '
        'example because a confirmed subsequent rental cannot take place — that additional loss may also be claimed.</li>'
        '<li><strong>Does not fit or is not suitable:</strong> If an item is supplied solely for fitting and, after '
        'prior agreement, is returned within 24 hours of receipt unworn, unaltered and with any security seal intact, '
        'the rental price may be refunded. Shipping costs may be excluded from the refund.</li>'
        '<li><strong>Request and booking:</strong> Sending a rental request does not itself create a confirmed '
        'booking. The rental only becomes binding once Disorder119 expressly confirms availability, rental period, '
        'rental price, deposit and any applicable shipping conditions.</li>'
        '</ul>'
        '<p><small>This English version is provided for convenience. In case of discrepancies between translations, '
        'the German version is the reference version.</small></p>'
    ),
    "fr": (
        '<h2>Location</h2>'
        '<p>Chaque pièce disponible de l’archive peut également être louée au lieu d’être achetée — pour des '
        'shootings, clips musicaux, productions de film ou de théâtre, projets éditoriaux, événements ou occasions '
        'privées. Choisis une pièce et envoie une demande sans engagement avec les dates souhaitées.</p>'
        '<h3 id="mietbedingungen">Conditions de location</h3>'
        '<ul>'
        '<li><strong>Prix de location :</strong> Le prix de location correspond exactement à 10&nbsp;% du prix de '
        'vente actuel indiqué par jour calendaire sélectionné. Le premier et le dernier jour comptent tous deux comme '
        'jours de location. Si une pièce n’a pas de prix de vente fixe, le prix de location est confirmé individuellement.</li>'
        '<li><strong>Caution :</strong> La caution correspond en principe à 50&nbsp;% du prix de vente actuel, avec '
        'un minimum de 50&nbsp;€. Une caution différente peut être convenue avant la confirmation pour les pièces '
        'particulièrement précieuses ou délicates. Elle est remboursée ou libérée après le retour conforme et le contrôle de la pièce.</li>'
        '<li><strong>État lors de la remise :</strong> Chaque pièce est contrôlée et son état documenté avant remise '
        'ou expédition. Les traces d’usage déjà présentes font partie de l’état décrit. Merci de signaler sans délai '
        'tout défaut non documenté, de préférence dans les 12 heures suivant la réception, avec des photos.</li>'
        '<li><strong>Utilisation soigneuse :</strong> Les pièces louées sont principalement des pièces uniques '
        'designer, vintage et seconde main et doivent être manipulées avec soin. L’usure normale résultant d’une '
        'utilisation conforme et soigneuse n’est pas considérée comme un dommage.</li>'
        '<li><strong>Nettoyage :</strong> Merci de ne pas laver, nettoyer à sec, blanchir, repasser, teindre ou traiter '
        'la pièce sans accord préalable exprès. Le nettoyage normal après retour est inclus dans le prix de location. '
        'En cas de salissure exceptionnelle, les frais supplémentaires réels et justifiables de nettoyage spécialisé '
        'ou de détachage peuvent être facturés.</li>'
        '<li><strong>Dommages :</strong> Merci de signaler dès que possible tout dommage ou toute salissure '
        'exceptionnelle. Lorsque le dommage est imputable au locataire, les frais nécessaires et raisonnables de '
        'réparation, nettoyage ou remise en état peuvent être facturés. En cas de perte ou de dommage économiquement '
        'irréparable, la valeur actuelle justifiable de la pièce peut être réclamée ; la caution déjà versée est déduite.</li>'
        '<li><strong>Aucune modification :</strong> Raccourcir, coudre, coller, teindre, retirer des étiquettes, '
        'ajouter des éléments ou effectuer toute autre modification est interdit sans accord préalable.</li>'
        '<li><strong>Pas de sous-location :</strong> La sous-location ou la remise de la pièce à un tiers est '
        'interdite sans accord préalable.</li>'
        '<li><strong>Retour :</strong> La pièce doit être restituée au plus tard à la date convenue. En cas '
        'd’expédition, le retour doit être remis de manière traçable selon le mode d’envoi convenu.</li>'
        '<li><strong>Retour tardif :</strong> Le tarif journalier normal peut continuer à être facturé pour chaque '
        'jour calendaire de retard. Si un retard imputable au locataire entraîne un préjudice supplémentaire '
        'justifiable — par exemple l’impossibilité d’honorer une location suivante déjà confirmée — ce préjudice peut '
        'également être réclamé.</li>'
        '<li><strong>La pièce ne convient pas :</strong> Si une pièce est remise uniquement pour essayage et, après '
        'accord préalable, est renvoyée dans les 24 heures suivant sa réception sans avoir été portée, sans modification '
        'et avec l’éventuel scellé de sécurité intact, le prix de location peut être remboursé. Les frais d’expédition '
        'peuvent être exclus du remboursement.</li>'
        '<li><strong>Demande et réservation :</strong> L’envoi d’une demande de location ne constitue pas encore une '
        'réservation confirmée. La location ne devient contraignante qu’après confirmation expresse par Disorder119 de '
        'la disponibilité, de la période, du prix de location, de la caution et, le cas échéant, des conditions d’expédition.</li>'
        '</ul>'
        '<p><small>Cette version française est fournie pour faciliter la compréhension. En cas de divergence entre '
        'les traductions, la version allemande sert de version de référence.</small></p>'
    ),
}

PAGES = {
    "de": BASE / "mieten" / "index.html",
    "en": BASE / "en" / "mieten" / "index.html",
    "fr": BASE / "fr" / "mieten" / "index.html",
}

STATIC_BLOCK_RE = re.compile(
    r'<div class="static-page"><div class="legal-panel">.*?</div></div>\s*'
    r'<div class="app-shell hidden" id="appShell">',
    re.S,
)
SYNC_RE = re.compile(r'\n?<script id="rentalTermsCanonical">.*?</script>', re.S)
BRIDGE_MARKER = '<script src="/assets/rental-commerce.js"></script>'


def apply_page(lang: str, path: Path) -> None:
    if not path.is_file():
        raise SystemExit(f"FEHLER: Rental-Seite fehlt: {path.relative_to(BASE)}")
    html = path.read_text(encoding="utf-8")
    replacement = (
        '<div class="static-page"><div class="legal-panel">'
        + TERMS[lang]
        + '</div></div>\n<div class="app-shell hidden" id="appShell">'
    )
    html, count = STATIC_BLOCK_RE.subn(replacement, html, count=1)
    if count != 1:
        raise SystemExit(f"FEHLER: Rental-Bedingungsblock nicht eindeutig in {path.relative_to(BASE)} gefunden.")

    # rental-commerce.js still contains a short compatibility summary for old builds.
    # Re-apply the canonical full terms immediately after that bridge executes so the
    # visible DOM and the no-JS static HTML are identical.
    html = SYNC_RE.sub("", html)
    if BRIDGE_MARKER not in html:
        raise SystemExit(f"FEHLER: Rental-Bridge fehlt in {path.relative_to(BASE)}")
    sync = (
        '<script id="rentalTermsCanonical">(function(){var p=document.querySelector('
        '".static-page .legal-panel");if(p)p.innerHTML='
        + json.dumps(TERMS[lang], ensure_ascii=False)
        + ';})();</script>'
    )
    html = html.replace(BRIDGE_MARKER, BRIDGE_MARKER + "\n" + sync, 1)
    path.write_text(html, encoding="utf-8")
    print(f"Mietbedingungen aktualisiert: {path.relative_to(BASE)}")


def main() -> None:
    for lang, path in PAGES.items():
        apply_page(lang, path)


if __name__ == "__main__":
    main()
