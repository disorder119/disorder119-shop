# Separate read-only Manager connection

Migration 0031 adds only authorization request/grant tables; it changes no
business records. Apply it before deploying the corresponding Worker. Preserve
live variables and secrets with `wrangler deploy --keep-vars`.

The native application binds an ephemeral IPv4 loopback receiver, sends a
32-byte random state and S256 PKCE challenge to POST /manager/authorize, and
opens the returned fixed Admin URL in the system browser. The public request
identifier travels in a fragment. Existing passkey login plus explicit checkbox
approval is mandatory. The approval returns only a validated loopback callback
with a single-use code (60 seconds). The pending request expires after ten
minutes; the Manager waits at most five. POST /manager/token requires the
original callback and verifier. Token issuance/consumption is a transactional
D1 batch, including passkey revocation checks.

Grants contain SHA-256 bearer fingerprints, the approving passkey and fixed
shop_dataset_read scope, and expire after 90 days. No browser session or broad
admin token is returned. GET /manager/status and GET /manager/dataset.zip are
the only read endpoints; POST /manager/disconnect only revokes that grant.
Admin grant listing and revocation require the real passkey cookie and allowed
Admin origin. These routes run before broad Admin scoping. The dedicated bearer
is never converted into an Admin bearer and cannot enter commerce mutations.
Revoking the approving passkey also disables its grants.

Requests are rate-limited; auth JSON is bounded to 4 KiB and endpoints fail
closed without a database/limiter. Exports reuse the existing full-history,
integrity-checked ZIP stream with immutable document originals. No provider
reconciliation, notification, invoice creation or business write is initiated.
No token/code is logged. Desktop tokens must be protected with Windows DPAPI.

Run the synthetic real-SQLite tests:
`node --test shop-worker/manager-connection.test.mjs shop-worker/admin-passkeys.test.mjs shop-worker/tax-dataset-stream.test.mjs`.

The native browser flow follows the external-browser/loopback/PKCE safeguards
in RFC 8252 and RFC 7636. This private protocol is not a general OAuth service.

## Second, separate grant: new catalog items as drafts (Migration 0056)

The Manager's "An Shop senden" uses its own grant with the fixed scope
`katalog_entwurf`. `POST /manager/authorize` accepts `scope` (`shop_dataset_read`
remains the default); the request remembers it, the Admin approval page names
exactly what the scope allows, and `/manager/token` issues the grant into its own
table `manager_katalog_grants` (CHECK scope='katalog_entwurf'). The read-only table
and its CHECK constraint are unchanged. A dataset bearer is refused on
`/manager/katalog/*` (403) and a catalog bearer on `/manager/dataset.zip` (403).
Grant listing and revocation in the Admin app cover both tables.

Routes (manager-katalog.js), all with the catalog bearer and rate limits:

- `GET /manager/katalog/pruefen?id=&article=` - is ID/number free? Existing item,
  article number, URL slug, old shop-ID redirect or excluded ID = not free.
- `POST /manager/katalog/bilder` - at most three WebP photos (real RIFF/WEBP,
  longest side <= 1600 px, <= 0.45 MiB) become Git blobs; each answer carries an
  HMAC that binds the blob to grant and item ID.
- `POST /manager/katalog/entwurf` - fields plus signed blobs. Adds exactly one
  NEW item (public_status DRAFT, url_slug = article number, ID = Manager ID) to
  `data/items.json` and one link to `config/catalog-number-links.json`, as one
  commit merged through a pull request (like the Admin catalog editor). Existing
  items, numbers, prices and photos cannot be changed through this grant. Sending
  the same draft again changes nothing (`vorhanden`).

Test shop (`SANDBOX=1`): every check runs against the public main state, but
nothing is written to GitHub. Rollout: `wrangler d1 migrations apply` (sandbox
first, then production), then deploy the worker. Tests:
`node --test shop-worker/manager-katalog.test.mjs shop-worker/manager-connection.test.mjs`.

## Third, separate grant: pieces sold elsewhere (Migration 0059)

When a piece sells on Vinted, eBay or elsewhere, the Manager marks it SOLD in
the shop so it cannot be sold twice. Fixed scope `katalog_verkauft`; pairing is
identical to `katalog_entwurf` (`POST /manager/authorize` with
`scope: "katalog_verkauft"`, passkey approval, `/manager/token`, 90 days,
listed and revocable in the Admin app, `/manager/status` and
`/manager/disconnect` as usual). Migration 0059 is purely additive: SQLite
cannot widen the scope CHECK of `manager_auth_requests` (0056), and rebuilding
that table fails under D1's always-on foreign keys because both grant tables
reference it. Pending requests for this scope therefore live in
`manager_verkauft_requests`, grants in `manager_verkauft_grants` (CHECK
scope='katalog_verkauft', revoke is final), finished answers in
`manager_verkauft_meldungen`. A draft or dataset bearer gets 403 on this route;
this bearer gets 403 on `/manager/katalog/pruefen|bilder|entwurf` and
`/manager/dataset.zip`. Requests with an `Origin` header are refused (403).

`POST /manager/katalog/verkauft`, `Authorization: Bearer <katalog_verkauft token>`,
JSON (max. 4 KiB):
`{"artikelnummer":"213","plattform":"vinted"|"ebay"|"sonstige","verkauft_am":"YYYY-MM-DD","request_id":"<uuid>"}`

| Answer | Meaning |
| --- | --- |
| 200 `{"ok":true,"status":"SOLD","artikelnummer":"213","shop_id":6216,"bereits":false}` | marked SOLD now |
| 200 `{...,"bereits":true}` | was already SOLD - no second commit |
| 200 `{"ok":true,"nicht_im_shop":true,"artikelnummer","shop_id","status"}` | DRAFT/hidden, excluded shop id or retired number (`status` "DRAFT" or "ENTFERNT") - nothing done |
| 409 `{"error":"in_bestellung","bestellung":"<order number>"\|null,"bestellstatus","art":"bestellung"\|"miete"\|"kasse"}` | piece is in an open shop order (RESERVED ... RETURN_REQUESTED), an active rental or a checkout in progress - nothing changed, the owner decides (double sale). Checked before "already SOLD". |
| 404 `{"error":"artikel_unbekannt"}` | number unknown to the shop |
| 400 `{"error":"anfrage_ungueltig","feld":...}` | bad body/field (date: valid, not in the future, one day tolerance) |
| 409 `request_id_wiederverwendet` / `in_arbeit` / `katalog_konflikt` / `nummer_mehrdeutig` | same id other body / same piece or id still running / main kept moving / number not unique - retry later or fix |
| 401/403/429/502/503 | grant invalid / wrong scope / rate limited / GitHub unreachable / not configured - retry later |

Idempotency: the first finished 200 answer per `request_id` is stored and
returned unchanged on every repeat (no second commit, audit or Telegram).
409/404/5xx are not stored; a repeat with the same id is evaluated again (e.g.
after the owner cancelled the conflicting shop order).

Article number -> shop id: `config/catalog-number-links.json` `links` (confirmed),
otherwise the `article` field in `data/items.json`; `excluded_shop_ids` and
`retired_links` count as "nicht im Shop". There is no arithmetic rule
(#213 = 6216, #1 = 9372).

Effect: exactly the checkout's post-payment path - `markCatalogSold`
(worker.js) pushes one commit `Verkauft: Artikel <shop id>` that changes only the
two status lines, the only direct push the main guard
(`scripts/main_provenance.py`) keeps. Checkout reads `data/items.json` fresh from
main for every purchase, so the piece is unpurchasable from that commit on; the
static rebuild only updates the pages. Before the commit a short D1 hold (the
checkout's own reservation: `reservations` RESERVED + `inventory` RESERVED,
key `manager-verkauft:`, 5 minutes) keeps anyone from reserving it in between;
afterwards `inventory.catalog_status='SOLD'` and the hold is released. A failed
commit releases the hold at once (502). Each outcome writes an `audit_events`
row (`MANAGER_VERKAUFT`, `_BEREITS`, `_NICHT_IM_SHOP`, `_IN_BESTELLUNG`; actor
ADMIN, `actor_ref` `manager:<grant id>`); a success sends the owner
"Manager: Artikel N auf <Plattform> verkauft – im Shop ausgeblendet" via
Telegram - a Telegram failure never fails the request. `sold_platform` in the
catalog is not set: the guard would revert any extra line.

Test shop (`SANDBOX=1`): public main catalog, SOLD only in D1 (`sandbox_verkauft`),
nothing written to GitHub, answers carry `"testshop":true`.
Rollout: `wrangler d1 migrations apply` (sandbox first, then production), deploy
the Admin app with labels for the new scope, then the worker. Tests:
`node --test shop-worker/manager-verkauft.test.mjs shop-worker/manager-connection.test.mjs shop-worker/manager-katalog.test.mjs`.
