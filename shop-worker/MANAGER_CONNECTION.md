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
