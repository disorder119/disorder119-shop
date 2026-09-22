# Disorder119 Security Policy

## Public repository model

The storefront source can be public. Public source code is not a security boundary.
All security-sensitive values must live outside Git in Cloudflare Worker secrets or
other provider-side secret stores.

Never commit:

- PayPal client secrets or webhook secrets/IDs intended to stay private
- GitHub write tokens
- Cloudflare API tokens
- Admin read/write tokens
- Turnstile secrets
- Telegram bot tokens
- private keys, certificates containing private keys, `.env` or `.dev.vars`
- customer, order, address or payment data

The repository CI runs `python scripts/security_scan.py` on every pull request and
push to `main`. This is a guardrail, not a replacement for rotating a leaked secret.

## Production authentication

Remote admin access requires both `ADMIN_READ_TOKEN` and `ADMIN_WRITE_TOKEN`.
The legacy shared `ADMIN_TOKEN` is local-development-only and must not be enabled on
a remote production Worker.

Use long randomly generated tokens and protect GitHub, Cloudflare and PayPal accounts
with MFA.

## Checkout safety

A browser is never trusted for price, inventory or successful-payment state.
Production payment completion must be established server-side. PayPal webhooks must
pass provider signature verification and event deduplication before affecting state.

## Customer data

Customer/order/address/payment operational data belongs in D1, not in public catalog
JSON or generated static pages. Logs must contain request IDs and operational error
codes, not raw tokens or complete sensitive provider payloads.

## If a secret is exposed

1. Revoke/rotate the credential immediately at the provider.
2. Replace the Worker/provider secret with the new value.
3. Check provider and Worker logs for unexpected access.
4. Remove the secret from the current tree and, when necessary, Git history.
5. Treat deletion from the latest commit alone as insufficient; Git history may still
   contain the old value.

## Sale notifications

Optional Telegram sale notifications use `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_CHAT_ID` as Worker secrets. Messages deliberately contain only operational
order data (order number, article/title and amount), not customer email or address.
