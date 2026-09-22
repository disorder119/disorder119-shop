# Disorder119 — Free Production Setup

The code path is designed so no monthly SaaS subscription is required by the shop
itself. Provider transaction fees (for example PayPal payment fees) are separate from
software hosting costs.

## 1. Cloudflare Worker + D1

Create/deploy the Worker from `shop-worker/worker-entry.js`, bind the production D1
database as `DB`, then apply the migrations in the order documented in `README.md`.
Keep `PAYPAL_ENVIRONMENT=sandbox` until the complete end-to-end test passes.

Production write routes deliberately fail closed when the required database,
rate-limiter and Turnstile controls are missing.

## 2. Worker secrets

Set real values with Cloudflare Worker secrets; never add them to GitHub:

- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_WEBHOOK_ID`
- `GITHUB_TOKEN` (minimum repository scope required to mark an item SOLD)
- `ADMIN_READ_TOKEN`
- `ADMIN_WRITE_TOKEN`
- `TURNSTILE_SECRET`
- optional `TELEGRAM_BOT_TOKEN`
- optional `TELEGRAM_CHAT_ID`

Use `shop-worker/.dev.vars.example` only as a list of variable names for local work.

## 3. PayPal

Keep the frontend client ID public in `config/shop-config.json`; the PayPal client
secret stays only in the Worker. Complete a sandbox purchase and verify all of the
following before changing to live:

- item reservation is created once
- a repeated request with the same idempotency key does not double-order
- server-side amount and item ID match the PayPal capture
- PayPal webhook signature verification succeeds
- duplicate webhook events do not duplicate state
- paid inventory changes to SOLD
- the order appears through the private `/admin/*` API
- no PayPal provider ID is written into public `data/items.json`

## 4. Free instant sale notification

Create a Telegram bot, put its token in `TELEGRAM_BOT_TOKEN`, and put the destination
chat ID in `TELEGRAM_CHAT_ID`. After confirmed payment the Worker sends a deduplicated
push containing order number, article/title and amount only. Customer email/address
are intentionally excluded.

Telegram is optional: missing Telegram configuration never blocks checkout.

## 5. Admin

Use the private admin application and the Worker `/admin/*` routes. Remote production
must have both split admin tokens. Do not use the legacy shared `ADMIN_TOKEN` on a
remote Worker.

## 6. Customer accounts

Customer accounts remain disabled until a real authentication method is configured.
Do not turn `features.customerAccounts` on merely to expose UI. Guest checkout is the
safe production default and orders still flow into D1/Admin.

A future account system must verify sessions server-side and must never make an email
address alone sufficient to read another customer's order history.

## 7. CI/security

Every PR and main push runs `.github/workflows/security-gate.yml`. It checks for common
secret formats, tracked environment files, syntax errors and notification regressions.
Do not bypass a failed security gate for a production release.
