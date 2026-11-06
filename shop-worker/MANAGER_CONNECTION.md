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
