# eBay gateway

`ebay-gateway.js` provides two public routes and an owner-only privacy inbox.
No seller token, catalog changes, purchases, refunds or listing operations occur.

Required Worker Secrets (values never committed):

- `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`: approved Production application pair.
- `EBAY_VERIFICATION_TOKEN`: random 32–80 character alphanumeric/underscore/hyphen.
- `EBAY_PRIVACY_PUBLIC_KEY`: RSA public SPKI PEM from the local DPAPI privacy vault.
  Never upload its private key.

Apply `0038_ebay_privacy_notifications.sql` after the existing D1 migrations.
Missing configuration/schema fails closed even for the challenge. Deploying code
alone cannot falsely enroll an unprepared receiver.

Register in eBay:

- HTTPS accepted return: `https://api.disorder119.com/ebay/return`
- HTTPS declined return: same isolated page (no successful code is accepted).
- Privacy policy: the existing public Disorder119 privacy page.
- Account-deletion endpoint: `https://api.disorder119.com/ebay/account-deletion`

The return page has hash-based CSP, no third-party resources, no token exchange
and clears the code/state from visible browser history. Hosting still receives the
initial callback request; do not add logging of its URL/query or callback body.

Incoming signatures follow the official eBay Notification SDK: fixed ECDSA/SHA-1,
verified SPKI public key fetched from eBay with application-only authorization,
bounded one-hour cache. Both raw-byte signatures (manual/Java guidance) and
JSON.stringify signatures (official Node SDK) are verified cryptographically.
No supplied key URL or selectable digest is trusted. eBay upstream redirects are
rejected; inputs, responses, streaming duration and key lookup rate are bounded.

Receipt is committed before acknowledgement. Payload identities are encrypted to
the PC key. Only IDs, event timestamps and workflow status remain unencrypted.
The D1 trigger creates an owner-visible `SYSTEM` task in the same transaction.

Owner API after existing passkey/owner authorization:

- `GET /admin/ebay/privacy-requests`: at most 200 encrypted pending notices.
- `POST /admin/ebay/privacy-requests`: `{id, action, confirm:true, note}`.
  `action`: `DELETED`, `NO_DATA`, `LEGAL_RETENTION`. Note must describe actual local
  review/deletion or a demonstrable specific legal retention basis, with no PII.
  This explicit attestation does not claim to erase an offline PC automatically.
  Completed notice ciphertext is removed; the linked task closes atomically.

Export the pending package and inspect with the Manager's local
`scripts/ebay_privacy_review.py`. It scans immutable API archives read-only;
review other exports/databases/backups separately. Complete actual deletion or
specific lawful retention before resolving a notice. Do not opt out by claiming
the Manager stores no eBay data. Do not treat HTTP receipt as compliance completion.

Register and send the real eBay test only after deployment. Until that live test
succeeds, unit tests and a successful bundle are not proof of active eBay access.
