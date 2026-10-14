# Security and withdrawal review, 14 October 2026

The public Worker health route exposed configuration and credential-readiness
details. It now returns only `{"ok":true}`; authenticated `/admin/system` keeps
the detailed diagnostic. The strict storefront CSP now blocks scripts rather
than merely reporting them. CSV exports also neutralize formula prefixes hidden
behind whitespace, newlines and byte-order marks.

## Storefront script authorization

`shop-worker/storefront-csp.js` authorizes five reviewed fixed bootstraps and
strict JSON assignments to six existing public configuration variables. It does
not authorize arbitrary scripts from the origin. The existing deferred loader
is accepted only with its exact reviewed function body and approved local asset
names. Hashes are calculated after HTML newline normalization. Only the fixed
CSS preload event handler has an attribute hash permission; scripts have no
blanket `unsafe-inline` or `unsafe-eval` permission.

PayPal receives a fresh response nonce through Cloudflare's parsed HTML API and
`data-csp-nonce`. Unknown script sources are not given that nonce. The testshop
rehashes its rewritten configuration and permits only its test API origin.
HTML processing is capped at 2 MiB and 10 seconds. HTML responses do not retain
conditional/cache metadata from a different nonce; static assets keep caching.
When adding a new executable inline bootstrap, review it or move it to a local
script file, and keep the complete published-page coverage test passing.

## Withdrawal policy

Canonical source: `config/legal-content.json`, version `2026-10-14-1`.
The browser bundle, translated legal pages and contract confirmation share this
source. Checkout states the return-cost rule before payment. The normal statutory
withdrawal period is 14 days from receipt; separate deliveries of one order use
receipt of the last item. No additional voluntary extended return period is offered.
Refunds must be made without undue delay and within the statutory 14-day period
after receipt of the withdrawal, subject to withholding until the goods or return
shipping evidence arrive, whichever occurs first. Standard delivery costs are
included for complete withdrawal. Statutory defect rights remain unaffected.

Authoritative references checked:

- https://www.gesetze-im-internet.de/bgb/__355.html
- https://www.gesetze-im-internet.de/bgb/__356.html
- https://www.gesetze-im-internet.de/bgb/__356a.html
- https://www.gesetze-im-internet.de/bgb/__357.html

There is no automatic rejection of declarations solely by order age. The period
depends on receipt and proper information; defective or missing information can
extend the withdrawal right. Consumer defect claims are separate.

## Verification and operational limits

Regression coverage includes authentication, payments, refunds, data exports,
withdrawal receipts and all available published HTML bootstraps. The nonce handler
was also executed with real Cloudflare HTMLRewriter in a local synthetic Worker.
Twenty bounded live GET checks passed before publication. These did not create
orders, execute payments, send customer messages or perform a denial-of-service test.
The current source and 49 recent history commits were scanned with no detected
high-risk credential patterns; this does not cover every historical commit or
prove that credentials were never compromised elsewhere.

Account MFA, least-privilege provider tokens and the zone's actual WAF/DDoS rules
must remain part of operating the shop. Code checks cannot guarantee immunity to
all attacks or provider outages. Real payment, refund and shipping transactions
are separate acceptance checks. Existing catalog identities, prices, curated
photo assignments and original accounting evidence are not changed by this review.
