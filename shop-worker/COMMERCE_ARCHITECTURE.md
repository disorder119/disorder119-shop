# Disorder119 Commerce Foundation

This document describes the server-side commerce architecture. It does not change the visual shop, Match, Chaos or Baukasten.

## Source of truth

- `data/items.json` remains the curated product/catalog source used by the static build.
- Cloudflare D1 is the private operational source for inventory locks, reservations, orders, payments, rentals, shipments, returns, refunds and audit events.
- Browser-provided prices are never authoritative.
- Customer/order/payment/rental data must never be committed as public JSON.

## Rental price rule

The authoritative rule lives in `commerce-core.js`:

`daily rental price = 10.00% of current sale price`

All calculation is performed in integer cents and rounded to the nearest cent. The public API returns two-decimal EUR amounts. If the catalogue has no fixed positive sale price, the quote is `priceOnRequest=true` and contains no fabricated daily/total amount. `SOLD` products cannot receive new rental reservations.

For dated rentals the server calculates inclusive rental days and `total = daily * days`. `rental_days` has a composite primary key `(inventory_id, rental_date)`, so two live reservations cannot own the same item/day even under concurrent requests.

`0003_state_integrity.sql` additionally enforces the 10%-daily-price rule and total-price arithmetic in D1 itself so a future server/admin bug cannot persist a manipulated rental amount.

## Inventory and order lifecycle

Inventory statuses are deliberately finite and server-controlled:

`AVAILABLE -> RESERVED -> PAYMENT_PENDING -> PAID -> PREPARING -> SHIPPED -> DELIVERED -> RETURN_REQUESTED -> RETURNED -> REFUNDED/CANCELLED`

Only supported transitions may be implemented by server/admin operations. Payment success is derived from a verified provider response/webhook, never a browser flag.

Purchase reservations expire after 15 minutes. Expired holds are lazily reclaimed on the next relevant operation. D1 conditional writes/unique constraints are used instead of GitHub JSON writes for commerce locking.

The explicit inventory/order/rental transition policies exist in `commerce-core.js`, while `0003_state_integrity.sql` mirrors the critical transition guards at database level.

## Idempotency and webhooks

State-changing public commerce endpoints require an `Idempotency-Key` (16-128 safe characters). Provider calls also receive provider-side idempotency keys where supported.

The Worker computes a canonical SHA-256 request hash from the relevant payload and stores it with the idempotency record. Reusing the same idempotency key with a different payload is rejected. Completed retries replay the original stored response; stale keys may be reclaimed only after expiry.

PayPal webhook processing requires provider signature verification, checks transmission freshness and records `payment_events` with a unique provider event ID. Duplicate events become no-ops. The full webhook payload is not persisted for audit purposes; only a SHA-256 payload hash is stored alongside event metadata.

## Security boundary

- Allowlisted origins are enforced for browser writes; CORS alone is not treated as access control.
- JSON Content-Type and a 32 KiB maximum request body are enforced.
- Error responses expose stable codes/request IDs, not provider secrets or raw upstream responses.
- Security headers are returned by the API.
- Optional `RATE_LIMITER` and `TURNSTILE_SECRET` bindings are supported; if absent they do not break the shop.
- `/health` exposes readiness booleans only, never secret values.
- Admin bearer token support remains a temporary operational bridge; migrate admin access to Cloudflare Access/external identity before broad production use.

## Customer accounts

Do not create a password table in D1. The `customers` table stores only an external identity reference (`auth_provider`, `auth_subject`) plus commerce profile state.

Recommended target: Supabase Auth (or another managed OIDC-compatible provider) for email verification, magic link/OTP, Google and Apple. The Worker should validate provider JWTs and map `provider + subject` to `customers.id`. Guest checkout remains first-class and does not require a customer record.

Account export/deletion requests are represented by `account_privacy_requests`. Actual account endpoints intentionally return `AUTH_PROVIDER_NOT_CONFIGURED` until a real provider and JWT verification are configured.

### Optional future Postgres/Supabase migration

D1 is sufficient for the current single-store operational workload and removes the dangerous public-JSON locking pattern. If account/reporting complexity grows, migrate private commerce tables to Postgres/Supabase in phases:

1. Create equivalent Postgres schema and constraints.
2. Backfill D1 data using server-side tooling; never through public static files.
3. Dual-read validation, then controlled dual-write if required.
4. Move auth/profile queries first; keep checkout inventory locking on one authoritative database at a time.
5. Cut over only after reconciliation of inventory, open reservations, orders and payments.

Never allow D1 and Postgres to be simultaneous independent authorities for the same inventory lock.

## Payments

PayPal remains disabled until real Worker URL/client configuration/secrets exist. The schema is provider-neutral enough to add Stripe later (`payments.provider`). Stripe can then expose card, Apple Pay and Google Pay through its supported wallet surfaces without changing inventory/order semantics.

Provider order/payment IDs are private operational data in D1. Post-payment catalogue syncing may mark `data/items.json` as `SOLD`, but it must not copy PayPal/Stripe transaction identifiers into the public catalogue.

Required before live PayPal checkout:

- D1 database + `DB` binding, with `schema.sql` then migrations applied in order.
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`.
- `GITHUB_TOKEN` scoped only to this repository if post-payment catalogue syncing remains enabled.
- Worker URL and public PayPal client ID in `config/shop-config.json`, then deliberately enable `features.paypalCheckout`.
- Production webhook endpoint registered and tested in sandbox first.

Optional integrations: DHL credentials, email provider, Turnstile keys, rate-limiter binding, external auth provider.

## Shipping, returns, refunds and trust

The schema contains stable order numbers, `shipments`, `returns`, `refunds` and `audit_events`. Customer-facing email delivery should be driven by these state changes once an email provider exists: order confirmed, payment confirmed, shipped/tracking, return received and refund confirmed. Do not invent certificates, reviews, guarantees or trust badges.

Audit metadata must contain operational IDs/status data only; do not log card data, PayPal tokens, secrets or full sensitive payment payloads.

A DHL label integration and outbound email provider are not currently production-configured by this repository; they must not be represented as live until separately implemented and tested.

### Reservieren beim Kauf, Einziehen beim Versand (seit Migration 0030)

- Die Kasse bestellt bei PayPal mit `intent: "AUTHORIZE"` (SDK-Parameter `intent=authorize`). Nach der Freigabe durch die Kundin reserviert `/capture-order` den Betrag (`/v2/checkout/orders/<id>/authorize`, Request-Id `authorize:<paymentId>`): Zahlung `AUTHORIZED`, Bestellung `PAID`, Stücke verkauft – aber kein Geld geflossen, kein Steuerbeleg, keine Rechnung. PayPal-Bestellungen aus der Zeit davor (`ACTION_DOES_NOT_MATCH_INTENT`) werden wie bisher sofort eingezogen.
- Eingezogen wird (`zahlung.js`, `/v2/payments/authorizations/<id>/capture`, `final_capture`, Request-Id `einzug:<paymentId>`): beim Etikett (Packlink-Entwurf/-Kauf, DHL, DHL-QR), bei „Versendet“ in der Admin-App, mit „Jetzt einziehen“ und spätestens per Cron 66 Stunden nach der Reservierung (`capture_due_at`, PayPal garantiert drei Tage). Klappt es nicht, gibt es kein Etikett und keinen Versandstatus (`ZahlungFehler`), der Inhaber bekommt „NICHT VERSENDEN“ per Telegram. Meldet die Sendungsverfolgung „unterwegs“, gilt das trotzdem; der Einzug wird sofort versucht.
- Erst mit dem Einzug: Steuerbeleg (`tax_cash_events` capture + fee), Rechnung (`sendInvoiceAfterCapture`, ausgestellt zum Zeitpunkt des Einziehens, archiviert in `rechnungen`, genau einmal; der Cron holt gescheiterte Mails 14 Tage lang nach). Die Bestellbestätigung sagt „bei PayPal reserviert, abgebucht beim Versand“ und enthält keine Rechnung.
- Storno vor dem Versand bei reservierter Zahlung: Der Erstattungsauftrag gibt die Reservierung frei (`/void`, Request-Id `freigabe:<paymentId>`) statt zu erstatten – kein Geld, keine PayPal-Gebühr, kein Guthaben nötig. Ergebnis `FREIGEGEBEN`, Bestellung `CANCELLED`, Stücke zurück in den Shop, Mail „nichts abgebucht“. War das Geld inzwischen eingezogen (Wettlauf), erstattet derselbe Auftrag wie gewohnt. Teilbeträge (Kulanz) gehen erst nach dem Einzug (`ZAHLUNG_NOCH_RESERVIERT`).
- Einziehen endgültig gescheitert (Reservierung abgelaufen, abgelehnt): Zahlung `FAILED`, „Stornieren“ storniert ohne Geldbewegung. PayPal prüft den Einzug noch (`PENDING`): Versand bleibt gesperrt, der Cron fragt alle 30 Minuten nach.
- Bestätigung, Telegram, Gutschein und Konto-Link holt der Cron nach, wenn der Kassenabschluss unterbrochen wurde (Abgleich über PayPal).

### Storno, Rücksendung, Widerruf (seit Migration 0029)

- **Erstattungsaufträge** (`erstattung-auftrag.js`, Tabelle `erstattungsauftraege`): Stornieren (bezahlt, noch nicht versendet), „Ware eingegangen“ nach einer Rücksendung und Kulanz legen einen Auftrag an. Er zahlt über die ursprüngliche PayPal-Capture zurück (keine neue Geldsendung) – ist die Zahlung nur reserviert, gibt er sie frei (siehe oben) – und bleibt bestehen, bis PayPal wirklich ausgezahlt bzw. freigegeben hat. Der Link „Rückzahlung in PayPal“ führt direkt auf die Rückzahlungsseite der Original-Transaktion (`/activity/actions/refund/edit/<captureId>`).
  - Zu wenig Guthaben (`REFUND_FAILED_INSUFFICIENT_FUNDS`): Status `WARTET_AUF_DECKUNG`, der Cron versucht es erneut (2 h lang alle 15 min, dann stündlich, ab Tag 2 alle 3 h), Telegram an den Inhaber mit Fehlbetrag, danach täglich eine Erinnerung. Ein erneuter Klick versucht es sofort.
  - Doppelte Auszahlung ausgeschlossen: je Versuch eine PayPal-Request-Id (`auftrag:<id>`), eine neue nur nach eindeutiger Ablehnung; unklare Fehler (Netz, 5xx) wiederholen mit derselben Id. Nur ein Lauf je Auftrag (Anspruch per `UPDATE … WHERE status`), höchstens ein laufender Auftrag je Bestellung (Unique-Index).
  - Erst nach der Rückzahlung: Bestellstatus, Stücke zurück in den Shop (Pull Request), Mail an die Kundin (`sendRefundConfirmation`, Durchschlag ins Shop-Postfach), Telegram. Scheitert ein Schritt, holt der Cron ihn 14 Tage lang nach.
  - Direkt in PayPal erstattet oder Webhook schneller als die eigene Antwort: Der Auftrag erkennt das an der Summe der abgeschlossenen Erstattungen und zahlt nicht noch einmal.
  - Ist ein Storno-Paket inzwischen doch unterwegs (Sendungsverfolgung), hält der Auftrag an (`SCHON_VERSENDET`) statt auszuzahlen. Solange ein Storno läuft oder vor dem Versand widerrufen wurde, sperren Admin-Versandknopf und Packlink-Etikettenkauf (`versandSperre`).
- **Widerrufsfunktion** nach § 356a BGB (`widerruf.js`, `POST /widerruf`, Seite `/widerruf/`): Name, E-Mail, Bestellung, ganz oder teilweise, zweiter Schritt „Widerruf bestätigen“. Turnstile und Rate-Limit wie beim Newsletter. Jede Erklärung steht unveränderlich in `widerrufe` (Trigger: kein Ändern von Inhalt/Eingang, kein Löschen); die Eingangsbestätigung mit Inhalt, Datum und Uhrzeit geht sofort per Mail raus (Kopie ans Shop-Postfach), scheitert sie, holt der Cron sie nach. Zugeordnet wird nur bei passender Bestellnummer **und** E-Mail; der Absender erfährt nie, ob es die Bestellung gibt.
  - versendet → „Rücksendung angefragt“ + Rücksendeanleitung; noch nicht versendet → Versand gesperrt, Inhaber storniert. Kundenkonto und „Rücksendung anlegen“ in der Admin-App (Widerruf per Mail/Brief) laufen über denselben Weg.
  - Erinnerungen per Telegram: nicht zugeordnet oder vor dem Versand täglich, bei laufender Rücksendung nach 7 und 12 Tagen (Rückzahlungsfrist 14 Tage ab Eingang, Zurückbehaltung bis zum Wareneingang erlaubt).

## Backups and retention

Before live launch, configure recurring D1 export/backup procedures and document restore testing. Define retention for abandoned reservations/idempotency records, payment events, audit events and legally required order/invoice records. Privacy deletion must remove or anonymize data that is not legally required while preserving accounting records as required.

## Migration order

Existing installations:

1. Apply `shop-worker/schema.sql` if not already applied.
2. Apply `shop-worker/migrations/0002_commerce_foundation.sql`.
3. Apply `shop-worker/migrations/0003_state_integrity.sql`.
4. Bind the resulting D1 database as `DB`.
5. Keep checkout/customer-account feature flags disabled until provider credentials and end-to-end sandbox tests pass.

The commerce migrations are additive and do not drop the existing legacy `orders` or `rental_requests` tables.
