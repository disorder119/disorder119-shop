# Shop, Admin-App und Disorder Manager: Steuer-Datensatz v1

Stand: 28.09.2026. Technische Übergabe für Claude, Codex und Betreiber.
Diese Datei enthält keine Zugangsdaten, Kundendaten oder produktiven Steuerwerte.

## Ablauf

1. In der privaten Admin-App **Steuern & Datensatz** öffnen und Jahr auswählen.
2. **Datensatz für Disorder Manager erzeugen** lädt einen vollständigen ZIP-Schnappschuss.
3. Im Manager ab Version 1.26.0: **Jahresabschluss → Shop-Datensatz hinzufügen**.
4. Vorschau vergleichen, als ungeprüfte Vorschläge übernehmen, Zahlungen und Quellenhinweise prüfen.
5. Erst der Jahresabschluss kombiniert Shop, Vinted, weitere Konten und Ausgaben.

Das ausgewählte Jahr begrenzt die Anzeige, nicht den ZIP-Inhalt. Vollständige Historie
verhindert, dass eine Rückzahlung im Folgejahr ihren ursprünglichen Verkauf verliert.
Ein erneuter identischer Import erzeugt keine zusätzlichen Buchungen.
Geänderte/fehlende Zahlungsereignisse sperren bisherige Freigaben; alte Originale
und Entscheidungen bleiben erhalten. Keine automatische Änderung am Manager-Katalog.
Artikelnummern werden als Zuordnungshinweise angezeigt.

## Autoritative Quellen und Format

Öffentliches HTML und der GitHub-Katalog enthalten keine vollständigen Zahlungen.
Autoritativ sind die private Cloudflare-D1-Bestellhistorie und verifizierte PayPal-Ereignisse.
Ein Cloud-Scraper ersetzt diese Verbindung nicht. Die ZIP ist die technische Bridge;
diese Dokumentation ist die Agenten-Übergabe. Automatische Cloud-Synchronisation
wurde nicht eingerichtet.

Geschützte GET-Routen:

- /admin/buchhaltung/datensatz.zip?jahr=2025: vollständige ZIP.
- /admin/buchhaltung/datensatz?jahr=2025: Exportzusammenfassung und Quellenhinweise.
- /admin/buchhaltung/jahr/2025: datierte Zahlungseingänge, Rückzahlungen, Gebühren.
- /admin/buchhaltung/rechnungen?jahr=2025: Dokumentenarchiv.
- /admin/buchhaltung/bestellungen.csv?jahr=2025: operative Bestellliste, keine EÜR.

Die zentrale Passkey-Sitzung schützt die Routen; kein Schlüssel kommt in den Browser.
Antworten sind no-store. Der Service Worker speichert nur Programmdateien.

manifest.json: format=disorder119.shop-dataset, schema_version=1,
source_id=disorder119.com, scope=full_history, timezone=Europe/Berlin,
generated_at, requested_year, files mit path, sha256, bytes.
Jede Datei außer dem Manifest selbst ist aufgeführt. Prüfsummen erkennen Änderungen;
sie sind keine digitale Signatur und beweisen allein keine steuerliche Richtigkeit.

data/*.json enthält Bestellungen, Positionen, Zahlungen, Erstattungen, Zahlungsereignisse,
Rechnungen, Bestätigungskopien, Mieten/Kautionen und reduzierte Audit-Metadaten.
ledger.json bildet Brutto-Eingang, Gebühr und Rückzahlung separat ab.
invoices/ enthält unveränderte HTML-/Textfassungen. Die ZIP ist vertraulich.
Die verifizierte Provider-Antwort wird auf ID, Betrag, Währung, Status, Zeitpunkt und
Gebühren reduziert und mit eigenem Hash archiviert. Keine erfundenen Zahlungszeitpunkte:
historische Datensätze ohne Provider-Zeit bleiben ungeklärt.
Ein PayPal-Transfer aufs Bankkonto ist kein zusätzlicher Verkauf.

## Rechnungen

Neue Bestätigungen und Rechnungen werden vor dem Versand mit Prüfsummen gespeichert.
Wiederholungen verwenden dieselben Bytes. Rechnungsarchiv, Zahlungsnachweise und
Bestätigungskopien sind durch SQL-Trigger gegen UPDATE/DELETE geschützt.
Ein Archivfehler verhindert den Versand der neuen Bestätigung.

Der automatische Rechnungsfall unterstützt bestätigte Kleinunternehmer in EUR.
Private Worker-Konfiguration, niemals im Repository speichern:

- TAX_MODE=small_business
- TAX_CONFIRMED=true nur nach tatsächlicher Klärung des Umsatzsteuerstatus
- TAX_NUMBER: betriebliche Steuernummer oder gültige USt-IdNr.; als Secret hinterlegen

Ohne diese Angaben entsteht keine scheinbar gültige §19-Rechnung.
Die Vertragsbestätigung bleibt möglich und benennt die ausstehende Rechnung.
Eine später ergänzte Konfiguration verändert keine bereits archivierte Bestätigung.
Altbelege und notwendige Rechnungsberichtigungen müssen separat und nachvollziehbar
ausgestellt werden; dafür gibt es noch keinen automatischen Korrekturassistenten.
Normale Umsatzsteuer, Differenzbesteuerung, strukturierte E-Rechnung und direkte
ELSTER-Übermittlung sind nicht implementiert.

## Vor der Live-Aktivierung

1. Bestehende D1-Datenbank sichern; Aufbewahrung, Wiederherstellung und Zugriffe dokumentieren.
2. Migration 0024_tax_evidence.sql über den vorhandenen D1-Migrationsprozess ausführen,
   bevor der neue Worker deployt wird. Der Code benötigt die neuen Tabellen/Spalten.
3. Tatsächlichen §19-Status, Steuerkennung, Anbieteranschrift und die §19-Aussagen auf
   Preis-/Checkout-/AGB-Seiten miteinander abgleichen. Der Status ist hier nicht nachgewiesen.
4. Worker deployen; dann Admin-App-Version mit tax.js und tax.css.
5. Sandbox-Bestellung, Zahlung, Gebühren, Teilrückzahlung, Rechnungsversand und ZIP-Import
   mit den echten Anbieter-Konfigurationen testen. Lokale Tests senden keine echten Mails.
6. Altzahlungen/Refunds, fehlende Gebühren, Mietzahlungen und Kautionen mit Provider-
   Abrechnungen abstimmen. Die Anwendung kennzeichnet diese Lücken.

Maximal 10.000 Zeilen je Quelltabelle; zusätzlich begrenzte Exportgröße (16 MiB ZIP).
Größere Exporte werden ausdrücklich abgebrochen, nie still gekürzt. Partitionierte
Großexporte benötigen eine spätere Format-/Speichererweiterung.
Hash-Archive ersetzen keine externen Backups oder vollständige GoBD-Verfahrensdokumentation.

## Fachliche Grenzen

Der Shop kennt weder alle Vinted-Accounts noch private Einkommen, Wareneinlagen und
sämtliche Betriebsausgaben. Er kann daher keine vollständige Einkommensteuererklärung
oder kanalübergreifende Kleinunternehmerfreigabe erzeugen.
Ein fehlender Einkaufsbeleg ist kein Nachweis einer Privateinlage. Eigenbelege benötigen
tatsächliche nachvollziehbare Angaben und ersetzen keine erfundenen Verkäuferdaten.
Gewerbebeginn, §19-Status und Vollständigkeit bleiben anhand von Unterlagen zu bestätigen.
GoBD-/ELSTER- oder Betriebsprüfungsakzeptanz wird nicht garantiert.

Geprüfte Primärquellen:

- [§34a UStDV: Kleinunternehmerrechnung](https://www.gesetze-im-internet.de/ustdv_1980/__34a.html)
- [§14 UStG: Rechnungen](https://www.gesetze-im-internet.de/ustg_1980/__14.html)
- [§19 UStG: Kleinunternehmer](https://www.gesetze-im-internet.de/ustg_1980/__19.html)
- [§11 EStG: Zufluss/Abfluss](https://www.gesetze-im-internet.de/estg/__11.html)
- [BMF: E-Rechnung](https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html)
- [BMF: GoBD-Änderung 14.07.2025](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/2025-07-14-GoBD-2-aenderung.html)
- [D1-Transaktionsabfragen](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [PayPal: Rückzahlungen](https://developer.paypal.com/api/payments/v2/captures-refund)

## Tests und Weiterarbeit

node --test shop-worker/*.test.mjs prüft Backend und Authentifizierung.
python scripts/test_d1_migrations.py prüft die echte Migrationskette.
Der Manager hat synthetische Cross-Language-Tests in tests/test_shop_dataset.py
sowie den isolierten EXE-Selbsttest mit Shop-Import.
Keine produktiven Bestellungen, Kundennachrichten, Zahlungen oder Katalogzeilen
wurden für diese Entwicklung verändert.
