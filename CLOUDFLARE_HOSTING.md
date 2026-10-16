# Shop-Auslieferung von Cloudflare

GitHub bleibt die Quelle mit Versionshistorie. Nur die Auslieferung der
öffentlichen Shop-Dateien wechselt. Der bestehende Worker
`disorder119-storefront-security` behält seine beiden Routen sowie CSP,
Katalogfilter, alte Artikel-Weiterleitungen und die BESUCH-Dienstbindung.
Er liest Dateien danach ausschließlich über sein ASSETS-Binding.

## Was erhalten bleibt

- `https://disorder119.com` und `https://www.disorder119.com`, Produktadressen,
  Artikelnummern, Preise, Bilddateien und deren Reihenfolge.
- `https://api.disorder119.com`, dessen Datenbank, Bestellungen, PayPal-,
  DHL-, eBay-, Mail- und Manager-Verbindungen.
- `https://admin.disorder119.com`, Sandbox, Google-Merchant-Feed,
  Search-Console- und Apple-Pay-Verifikationsdatei.

Der Umzug erteilt keine neue Manager-Lesefreigabe und ersetzt keinen echten
Sandbox-Kauf mit anschließender Prüfung von Mail, Versand und Manager-Import.
Die Infrastrukturänderung ist keine rechtliche oder Sicherheitsgarantie.

## Sichere automatische Veröffentlichung

`rebuild.yml` validiert wie bisher und publiziert seinen generierten Commit.
Nur dessen exakte Revision kann ausgeliefert werden. Ein neuerer Main-Commit
oder eine fremde gleichzeitige Worker-Veröffentlichung bricht den Deploy ab.
Der Export liest Git-Objekte und erlaubt ausschließlich die vorhandenen
öffentlichen Pfade. Private Katalogfelder und Entwürfe werden bereits vor
dem Upload entfernt. Der Repository-Ordner wird niemals als Asset-Ordner
hochgeladen. Lokale uncommittete Änderungen werden nicht übernommen.

Der Client ist unter `tools/storefront-publish` fest auf Wrangler 4.151.1
mit npm-Integritätswerten verankert. Installation erhält keine Zugangsdaten.
Der Cloudflare-Token steht ausschließlich im Veröffentlichungs-Schritt zur
Verfügung; PR-Validierungen bekommen ihn nicht.

Vor der ersten Aktivierung sind erforderlich:

1. Ein Cloudflare **Account API Token**: **Specified Workers** → ausschließlich
   `disorder119-storefront-security` → **Editor**. Keine DNS-, D1-, Backend-,
   Account-Admin- oder Zahlungsrechte. Erstellung benötigt die Eigentümerfreigabe.
2. Dieses Token als GitHub-Actions-Secret **CLOUDFLARE_STOREFRONT_TOKEN** nur in
   `disorder119/disorder119-shop` speichern. Kein Passwort und kein interaktives
   Wrangler-OAuth-Token in GitHub verwenden.
3. Repository-Variable **CLOUDFLARE_STOREFRONT_ENABLED=true** nach der Einrichtung
   setzen. Bis dahin wird kein Cloudflare-Deploy ausgelöst.
4. Einen erfolgreichen vollständigen Main-Lauf abwarten, Auslieferungsmarker,
   Katalog, Bilder und die bisherigen Service-Adressen gegenprüfen.
5. Erst danach Web-DNS vom bisherigen GitHub-Ursprung lösen und GitHub Pages
   abschalten. Mail-, API-, Admin-, Verifikations- und Sandbox-DNS bleiben bestehen.

Die Publikation lädt zunächst eine inaktive Version hoch und aktiviert sie
erst nach erneuter Main-/Versionskontrolle. Öffentliche GET-Prüfungen prüfen
Shopseiten, Feed, Verifikation, Artikelbilder, Katalog und API-Health.
Bei Fehlern wird auf die vorherige Versionsverteilung zurückgeschaltet, sofern
kein anderer Akteur inzwischen publiziert hat. Ein Fehler bei diesem Rückweg
muss manuell behandelt werden; niemals `force` einsetzen.

## Rückweg

Vor der ersten Aktivierung Worker-Version, Quellstand, DNS und Pages-Einstellung
lokal sichern. Zuerst die vorige Worker-Version aktivieren, solange der
bisherige Ursprung noch verfügbar ist. Nach abgeschaltetem GitHub Pages müssen
zusätzlich Pages und dessen vorherige DNS-Einträge wiederhergestellt werden.
Alternativ kann jederzeit die zuvor geprüfte Cloudflare-Asset-Version erneut
aktiviert werden. Keine Datenbank-Rücksicherung für einen reinen Hostingwechsel.

Der kostenlose Tarif wird nicht gewechselt. Dateizahl und Einzeldateigröße werden
beim Export begrenzt. Worker- und Build-Kontingente bleiben tarifabhängig;
ein bezahltes Upgrade ist keine automatische Fehlerbehebung.
