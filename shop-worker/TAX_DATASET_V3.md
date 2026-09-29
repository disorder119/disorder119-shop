# Disorder119 Tax Ready 2026 / Shop Dataset v3

## Zweck

Dataset v3 erweitert den bestehenden, weiterhin unterstützten `TAX_DATASET_V2` um private Buchhaltungs-Quelldaten. Es ist **keine Steuererklärung**, nimmt keine automatische steuerliche Freigabe vor und übermittelt nichts an ELSTER.

Die öffentliche Website bleibt von privaten Buchhaltungsdaten getrennt. Einkaufspreise, Einkaufsquellen, private Zahlungskonten, Belege, interne Steuerklassifikationen, Einlagen/Entnahmen und interne Margen gehören ausschließlich in die private D1-Datenbank und die Admin-Routen unter `/admin/buchhaltung/*`.

## Rückwärtskompatibilität

Der bisherige Export bleibt unverändert erreichbar:

```text
GET /admin/buchhaltung/datensatz.zip?jahr=2026
```

Dataset v3 ist ausdrücklich opt-in:

```text
GET /admin/buchhaltung/datensatz-v3.zip?jahr=2026
```

oder:

```text
GET /admin/buchhaltung/datensatz.zip?jahr=2026&format=v3
```

Der v3-Export enthält die bisherigen v2-Dateien und zusätzlich `v3/*`. Das neue Manifest trägt `schema_version: 3` und `backwards_compatible_with: [2]`.

## Datenquellen und Priorität

### Bereits vorhandene Provider-Nachweise

`tax_cash_events` aus Migration `0024_tax_evidence.sql` bleibt unverändert die append-only Quelle für verifizierte Zahlungsanbieter-Ereignisse:

- `capture` -> `SALE_INCOME`
- `refund` -> `REFUND_OUT`
- `fee` -> `PAYMENT_FEE`

Der tatsächliche Provider-Zeitpunkt (`occurred_at`) bestimmt die technische Jahreszuordnung. Fehlt er oder ist das Ereignis anderweitig blockiert, wird kein Umsatz erfunden; der Vorgang bleibt in der Prüfqueue.

### Private/weitere Geldbewegungen

`tax_ledger_events` ergänzt Bank, Vinted Wallet, Bargeld, private Finanzierung und sonstige Geschäftskonten. Ein manuell eingetragener Provider-Vorgang mit identischer Provider-Referenz und Ereignisart verdrängt den entsprechenden v2-Provider-Eintrag in der kombinierten v3-Sicht, damit nichts doppelt gezählt wird.

## Zentrale Invarianten

1. **Order != Zahlung.** Ein Checkout, eine Reservierung oder eine `PAYMENT_PENDING`-Bestellung ist kein steuerlicher Zahlungseingang.
2. **ACCOUNT_TRANSFER != Einnahme/Ausgabe.** Ein Transfer zwischen Vinted Wallet, PayPal und Bank wird als zwei gleich hohe Ledger-Beine mit derselben `transfer_group_id` gespeichert und nie in das Betriebsergebnis aufgenommen.
3. **Einlage/Entnahme != Betriebsergebnis.** `OWNER_CONTRIBUTION` und `OWNER_DRAW` werden separat ausgewiesen.
4. **Privat bezahlter betrieblicher Einkauf.** Der Einkauf bleibt Betriebsausgabe; bei `PRIVATE_FUNDS` wird zusätzlich eine gleich hohe `OWNER_CONTRIBUTION` erzeugt. Dadurch wird die Ausgabe nicht doppelt gebucht.
5. **Keine erfundenen Nullen.** Fehlende Zahlungsdaten, Belege oder Zuordnungen führen zu `REVIEW_REQUIRED`/Issue-Einträgen.
6. **Keine Hard Deletes von Finanznachweisen.** Ledger, Belegmetadaten und Reconciliations sind unveränderlich; Einkaufs-/Ausgabenquellen dürfen nicht gelöscht werden.
7. **Steuerstatus pro Jahr ist explizit.** `tax_year_profiles.vat_mode` ist `KLEINUNTERNEHMER`, `REGELBESTEUERUNG` oder `UNKNOWN`; nur eine manuelle Bestätigung setzt `confirmed=1`. Umsatzwerte ändern den Status nicht automatisch.

## Neue D1-Tabellen

Migration `0026_tax_ready_2026.sql` ergänzt:

- `tax_accounts`
- `tax_documents`
- `tax_purchases`
- `tax_purchase_items`
- `tax_expense_events`
- `tax_ledger_events`
- `tax_reconciliations`
- `tax_classifications`
- `tax_year_profiles`

Die bestehende `inventory.item_id`/`inventory.id`-Identität wird wiederverwendet. Es wird keine zweite öffentliche Artikelidentität eingeführt.

## Konten

Unterstützte Typen:

- `BUSINESS_BANK`
- `VINTED_WALLET`
- `PAYPAL`
- `CASH`
- `PRIVATE_SOURCE`
- `OTHER`

`PRIVATE_SOURCE` ist nur eine private Finanzierungsquelle für betriebliche Vorgänge. Es ist kein öffentliches Kundenkonto.

## Einkäufe

Ein Einkauf speichert mindestens:

- Kaufdatum
- optional tatsächliches Zahlungsdatum
- Plattform/Quellenreferenz
- Warenpreis
- Käuferschutz-/Plattformgebühr
- Einkaufsversand
- weitere Anschaffungsnebenkosten
- Gesamtsumme
- Zahlungskonto
- Finanzierungsart
- Artikelpositionen mit stabiler Artikelreferenz

Die Summe der Artikel-/Nebenkosten muss exakt `total_paid_cents` ergeben. Ebenso müssen die auf die Artikel verteilten Kosten exakt zur Einkaufssumme passen. Abweichungen werden abgelehnt, nicht gerundet oder geschätzt.

## Ausgaben

Allgemeine betriebliche Ausgaben können separat erfasst werden, z. B.:

- Versand
- Werbung
- Software
- Verpackung
- Plattformgebühren
- Zahlungsgebühren
- sonstige Betriebsausgaben

Auch hier bleibt `PRIVATE_FUNDS` getrennt von `BUSINESS_FUNDS`.

## Belege

`tax_documents` speichert derzeit sichere Metadaten:

- Originaldateiname
- MIME-Type
- Byte-Länge
- SHA-256
- Quellenreferenz
- Archivstatus
- optional privaten `storage_key`

**Wichtig:** Die aktuelle v3-API implementiert noch keinen Binärdatei-Upload. `storage_state=ARCHIVED` ist nur zulässig, wenn ein privater `storage_key` angegeben wird. GitHub und `data/items.json` sind ausdrücklich kein Belegarchiv. Bis ein privates R2-/anderes Archiv angebunden ist, sollen Belege `METADATA_ONLY` oder `REVIEW_REQUIRED` bleiben.

## Private Admin-API

Alle Routen laufen unter der bereits vorhandenen Admin-Gateway-/Passkey-/RBAC-Schicht und führen zusätzlich die bestehende interne Admin-Prüfung aus.

```text
GET  /admin/buchhaltung/konten
POST /admin/buchhaltung/konten

GET  /admin/buchhaltung/einkaeufe
POST /admin/buchhaltung/einkaeufe
PATCH /admin/buchhaltung/einkaeufe/:id

GET  /admin/buchhaltung/ausgaben
POST /admin/buchhaltung/ausgaben

GET  /admin/buchhaltung/cash-events
POST /admin/buchhaltung/cash-events

GET  /admin/buchhaltung/belege
POST /admin/buchhaltung/belege

POST /admin/buchhaltung/reconcile

GET /admin/buchhaltung/steuerprofil/:jahr
PUT /admin/buchhaltung/steuerprofil/:jahr

GET /admin/buchhaltung/steuercheck/:jahr
```

Finanzielle Schreiboperationen erzeugen Audit-Events.

## Cash Event Typen

```text
SALE_INCOME
OTHER_INCOME
PURCHASE
PLATFORM_FEE
PAYMENT_FEE
SHIPPING_EXPENSE
ADVERTISING
SOFTWARE
PACKAGING
REFUND_IN
REFUND_OUT
OWNER_CONTRIBUTION
OWNER_DRAW
ACCOUNT_TRANSFER
OTHER_EXPENSE
OTHER
UNKNOWN
```

`UNKNOWN` ist absichtlich erlaubt, damit unklare Vorgänge erfasst werden können, ohne eine falsche Kategorie zu erfinden.

## Steuercheck

`GET /admin/buchhaltung/steuercheck/:jahr` prüft technisch unter anderem:

- bestätigte Einkäufe ohne Zahlungsdatum
- Einkaufs-Summenfehler
- Einkauf ohne Artikelzuordnung
- private Finanzierung ohne Einlage
- bestätigte Ausgaben ohne Zahlungsdatum
- ungeklärte Cash Events
- unvollständige/unbalancierte Kontotransfers
- nicht archivierte Belegmetadaten
- nicht bestätigtes Steuerjahresprofil
- bestehende v2-Probleme, etwa fehlender Provider-Zahlungszeitpunkt oder nicht abgestimmte Gebühren/Refunds

Das Ergebnis bleibt immer `reviewRequired: true`; die Anwendung erklärt keinen steuerlichen Vorgang eigenmächtig für endgültig richtig.

## Dataset-v3-Dateien

Zusätzlich zu allen v2-Inhalten:

```text
v3/accounts.json
v3/purchases.json
v3/purchase_items.json
v3/expense_events.json
v3/documents.json
v3/manual_cash_events.json
v3/combined_cash_ledger.json
v3/owner_contributions.json
v3/owner_draws.json
v3/reconciliations.json
v3/tax_classifications.json
v3/tax_year_profiles.json
v3/year_summary.json
v3/issues.json
v3/README.txt
```

Das finale `manifest.json` enthält für alle transportierten Dateien SHA-256 und Byte-Länge. Die vorhandene v2-Logik für unveränderliche Rechnungen/Bestätigungen und das gemeinsame Logo bleibt erhalten.

## Noch bewusst nicht automatisch erledigt

Diese erste v3-Stufe löst die private Datenbasis und den Export. Folgende Punkte benötigen weiterhin eine eigene, explizite Implementierung bzw. Admin-UI:

- tatsächlicher privater Binär-Belegspeicher (z. B. R2) samt Upload/Download/Hash-Verifikation
- komfortabler Bulk-/CSV-Import der >100 Alt-Einkäufe
- automatische Vinted-Abrechnung/Wallet-Reconciliation
- automatische Packlink-/DHL-Labelkostenübernahme als Betriebsausgabe, sobald der tatsächlich gezahlte Betrag sicher belegt ist
- Korrektur-/Storno-Workflows für bereits gebuchte manuelle Finanzereignisse
- Manager-UI für Konten, Einkäufe, Ausgaben, Belege, Einlagen/Entnahmen und Prüfqueue

Diese Punkte dürfen nicht durch Schätzwerte oder stilles `0` ersetzt werden.
