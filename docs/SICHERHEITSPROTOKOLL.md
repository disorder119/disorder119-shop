# Sicherheitsprotokoll disorder119.com

Laufendes Protokoll der Sicherheitsarbeiten. Jede Änderung mit Datum, Prüfweg und Rückweg.
**Hier stehen nie Schlüssel, Tokens oder Passwörter.** Geheimnisse nur über
`npx.cmd wrangler secret put …` oder die Einrichtungs-Skripte in `D:\Disorder119_Admin_Einrichtung`.

---

## 1. Ausgangslage (geprüft 22.11.2026)

| Bereich | Stand |
|---|---|
| Domain | bei Porkbun registriert, Transfer-Sperre an; DNS bei Cloudflare (`alice`/`seamus.ns.cloudflare.com`) |
| Live-Status | Shop, Kasse, Admin-App: 200; API-Wurzel `/`: 403 (gewollt, nur definierte Pfade offen); Shop-Sperre aus |
| HTTP-Header | HSTS `max-age=31536000; includeSubDomains` (ohne `preload`), strenge CSP, `X-Frame-Options: DENY`, `nosniff`, Referrer- und Permissions-Policy |
| Admin | Passkey-Login, sehr strenge CSP |
| TLS (von außen) | TLS 1.0 und 1.1 abgelehnt, TLS 1.2 und 1.3 angenommen; `http://` leitet um |
| Code | keine Schlüssel im Code oder in der Git-Historie, einziger Zugriff: Konto `disorder119`; alle Actions per SHA gepinnt; Cloudflare-Deploy-Token nur für `main` |
| Secret Scanning | GitHub Secret Scanning und Push Protection bereits **an**, 0 Funde |
| Mail ausgehend | nur Brevo (`customer-mail.js`, `MAIL_FROM` = `kontakt@disorder119.com`), DKIM `brevo1`/`brevo2._domainkey` (CNAME), dazu Cloudflare-DKIM `cf2024-1` |
| SPF | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| DMARC | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` – nur Beobachtung |
| DNSSEC | aus (kein DS-Eintrag bei .com) |
| CAA | kein Eintrag |

### Mail-Prüfung vor der DMARC-Verschärfung (22.11.2026)
- Echte Versandbestätigung vom 05.11.2026 (Brevo) im Gmail-Original: **SPF PASS, DKIM PASS (`disorder119.com`), DMARC PASS**.
- In beiden Gmail-Konten (`joelb119@…`, `disorder119shop@…`) ist unter „Senden als“ **keine** `@disorder119.com`-Adresse eingerichtet. Es gibt also keinen Gmail-Versand, der durch `p=quarantine` im Spam landen würde.
- Eingehende Mails laufen über Cloudflare Email Routing; DMARC der eigenen Domain betrifft nur Mails, die *als* `@disorder119.com` verschickt werden.

---

## 2. Änderungen

### 2.1 GitHub

| Datum | Änderung | Prüfen | Rückweg |
|---|---|---|---|
| 22.11.2026 | **Lighthouse-Audit misst komprimiert wie live** (PR #446): neuer `scripts/quality_static_server.py` (Gzip für Text-Dateien), nur der Audit-Schritt in `browser-smoke.yml` nutzt ihn. Ursache für das wiederkehrend rote `chromium-smoke`: `python -m http.server` lieferte `app.css` (114 KB) roh, live kommt sie per Brotli (~27 KB). Im simulierten Mobilnetz schwankte die mobile LCP der Startseite zwischen 2,25 und 3,3 s (Grenze 2,5 s). Grenzwerte **unverändert**. | Lauf von #446: home-mobile Performance 100, LCP 1504 ms; product-mobile 99, LCP 1542 ms | PR #446 zurücknehmen (Revert) |
| 22.11.2026 | **Dependabot #292** (checkout v4→v7.0.1, setup-python v5→v7.1.0, setup-node v4→v7.1.0): erwartete SHAs in `scripts/validate_focus_three.py` angehoben. SHAs gegen die offiziellen Tags geprüft (`git ls-remote --tags https://github.com/actions/<name>`): `3d3c42e5…` = v7.0.1, `6d4fd22b…` = v7.1.0, `949feb24…` = v7.1.0. | CI von #292 grün; nach Merge Main-Rebuild und Veröffentlichung beobachten | Revert des Merge-Commits |
| 22.11.2026 | **Dependabot #293** (upload-artifact v4→v7.0.2 `cf430e03…`, download-artifact v4→v8.0.2 `9000827c…`): SHAs gegen Tags geprüft. | CI von #293 grün; nach Merge: Job „Validierten Main-Rebuild publizieren“ lädt den Patch | Revert des Merge-Commits |
| 22.11.2026 | **Alte PRs geschlossen** (Branches bleiben): #238 (ersetzt durch #275), #275 (Konflikt, Migration 0038 inzwischen belegt), #297 und #337 (seit Oktober in Konflikt mit main, würden neuere Stände überschreiben). Begründung steht je PR als Kommentar. | `gh pr list --state closed` | PR wieder öffnen (`gh pr reopen <nr>`) |
| 22.11.2026 | **14 Branches `claude/*` gelöscht.** Alle per Squash gemergt (#197, #199, #200, #212, #213, #217, #285, #286, #287, #288) oder in #217 zusammengefasst (#214, #215, #216); `claude/sharp-knuth-ncrrwl` ohne PR, durch spätere PRs ersetzt. Letzte SHAs siehe Anhang A. | `gh api repos/disorder119/disorder119-shop/branches --paginate --jq '.[].name' \| grep claude/` → leer | `gh api -X POST repos/disorder119/disorder119-shop/git/refs -f ref=refs/heads/<name> -f sha=<sha>` |
| 22.11.2026 | **Wächter: Telegram-Modus `hart`** (`shop-worker/waechter.js`): mit `WAECHTER_TELEGRAM=hart` meldet Telegram nur noch harte Angriffe (Angriffs-Programm, SQL-Injection, XSS, Path-Traversal, Log4Shell), jede solche Sperre gebündelt. Scanner-Pfade, Fluten und Wellen sperren weiter, aber still (Admin-App → Besucher → Sicherheit). Standard ohne Variable bleibt wie bisher. Test `WAECHTER_TELEGRAM=hart: …` in `waechter.test.mjs`. Eingeschaltet über `WAECHTER_TELEGRAM = "hart"` in `shop-worker/wrangler.toml`. | `node --test shop-worker/waechter.test.mjs` (27/27) | Zeile in `wrangler.toml` entfernen, neu deployen; Code per Revert |
| 22.11.2026 | **Admin-Einrichtung „4 - GitHub verbinden“**: das vorausgefüllte Token-Formular setzt jetzt **365 Tage Ablauf** statt „kein Ablauf“ (`_skripte/github.ps1`, Sicherung `github.ps1.bak_20261122`; liegt außerhalb des Repos). | Skript öffnet GitHub mit `expires_in=365` | Sicherung zurückkopieren |

**Hinweis zum Worker-Token:** Der Worker braucht für Katalog-Speicherungen aus der Admin-App **Contents: Read and write** *und* **Pull requests: Read and write** (er legt einen PR an und mergt ihn, damit der Main-Wächter die Änderung akzeptiert). Nur „Contents“ würde das Speichern brechen.

### 2.2 Cloudflare und Domain

Stand: **offen – braucht Anmeldung des Inhabers bei Cloudflare und Porkbun.**
Die Schritte stehen in Abschnitt 3.

| Datum | Änderung | Prüfen | Rückweg |
|---|---|---|---|
| – | DMARC auf `p=quarantine` | DoH `_dmarc.disorder119.com` TXT | Eintrag auf `p=none` zurück |
| – | DNSSEC an + DS bei Porkbun | DoH `disorder119.com` DS vorhanden, AD-Flag `true` | **Erst** DS bei Porkbun löschen, 48 h warten, **dann** DNSSEC in Cloudflare aus |
| – | Minimum TLS 1.2, Always Use HTTPS | TLS-1.1-Handshake abgelehnt, `http://` → 301 | Einstellung zurück |
| – | CAA für `letsencrypt.org`, `pki.goog`, `ssl.com` | DoH `disorder119.com` CAA | CAA-Einträge löschen |
| – | HSTS-Preload **nicht** aktivieren | Header ohne `preload` | – |

---

## 3. Schritte, die nur der Inhaber klicken kann

### 3.1 Cloudflare (dash.cloudflare.com → disorder119.com)
1. **DMARC:** DNS → Records → TXT `_dmarc` bearbeiten → Inhalt
   `v=DMARC1; p=quarantine; rua=mailto:rua@dmarc.brevo.com` → Save.
   Nach 2–4 Wochen sauberer Brevo-DMARC-Berichte: `p=reject`.
2. **DNSSEC:** DNS → Settings → DNSSEC → *Enable DNSSEC*. Cloudflare zeigt die DS-Daten (Key Tag, Algorithm 13, Digest Type 2, Digest).
3. **Porkbun:** Domain Management → disorder119.com → *DNSSEC* → die vier Werte aus Schritt 2 eintragen → Save.
   Danach dauert es bis zu ein paar Stunden, bis Cloudflare „Success“ zeigt.
4. **TLS:** SSL/TLS → Edge Certificates → *Minimum TLS Version* = **TLS 1.2**; *Always Use HTTPS* = **an**.
   *HSTS* dort **nicht** auf „Preload“ stellen. SSL-Modus bleibt **Full** (nie „Full (strict)“, siehe Betreiberpflichten).
5. **CAA:** DNS → Records → Add record → Typ **CAA**, Name `@`, Tag *Only allow specific hostnames*, je ein Eintrag für
   `letsencrypt.org`, `pki.goog`, `ssl.com`. Optional Tag *Send violation reports to URL* mit `mailto:kontakt@disorder119.com`.

### 3.2 Zwei-Faktor-Anmeldung (Passkey oder Authenticator-App, **nicht SMS**)

- [ ] GitHub (`disorder119` und das zweite Konto) – danach Settings → Security log auf fremde Anmeldungen prüfen
- [ ] Cloudflare
- [ ] PayPal
- [ ] Brevo
- [ ] Porkbun
- [ ] Gmail (`disorder119shop@…` und `joelb119@…`)

Wiederherstellungscodes jeweils offline ablegen (Notfallpaket), nicht in der Cloud-Notiz.

### 3.3 Neuer Worker-Token für GitHub (mit Ablaufdatum)
1. `D:\Disorder119_Admin_Einrichtung\4 - GitHub verbinden.cmd` starten.
   GitHub öffnet ein vorausgefülltes Formular: nur Repository `disorder119-shop`, *Contents* und *Pull requests* = Read and write, **Ablauf 365 Tage**.
2. *Generate token* → Schlüssel ins Fenster einfügen. Das Skript prüft ihn und speichert ihn per `wrangler secret put GITHUB_TOKEN`.
3. Danach bei GitHub → Settings → Developer settings → Fine-grained tokens den **alten** Token (ohne Ablauf, z. B. „lo go“ / „Disorder119 Admin-App“) **löschen**.
4. Erinnerung setzen: Token läuft nach 365 Tagen ab → dann Schritt 1 wiederholen.

### 3.4 Wächter-Telegram auf „nur harte Angriffe“
Steht als `WAECHTER_TELEGRAM = "hart"` in `shop-worker/wrangler.toml` (`[vars]`) und gilt nach dem nächsten
`npx.cmd wrangler deploy` im Ordner `shop-worker`. **Nicht** im Cloudflare-Dashboard setzen: `wrangler deploy`
überschreibt dortige Variablen mit `[vars]`.
Zurück: Zeile in `wrangler.toml` löschen (oder `"alles"`) und neu deployen.

---

## 4. Nachprüfung von außen

Wird nach den Cloudflare-Schritten ergänzt (DoH `_dmarc`, DS, CAA; TLS-Versionen; Header; Live-Status).

---

## Anhang A – gelöschte Branches (letzte SHAs)

```
claude/alles-zusammen               b3267c1bf95f2a935eca440304d08884fb95eab6
claude/besucher-auswertung          51e13066b1bbcae86c96d4f7b2d0eef283af7985
claude/besucher-live                d355f47e56966c46437e6fad3cdc4227fc7b5be8
claude/erstatten                    8b607c553f63b459ed47e6c2111c912c6d0ee206
claude/heller-modus                 aecd9fe24d9414809f313a76374133d807946399
claude/kasse-claim-gutschein-replay 3b347b30d92493bcd9449dfce5517fb00019a724
claude/kasse-nur-verfuegbar         63967603824d0c4e851cb76dc48a5e1d4b159c88
claude/nur-paypal                   8b8bab38f099dfa2a0ff80855a5c4c35011546bc
claude/paypal-live                  4423cef3cebea8578562bfda411a9e89a1543a52
claude/sharp-knuth-ncrrwl           f92f1bf754ace9b7d17e306e9261d6bb8b596348
claude/testartikel                  7beb43861ae8fa955c4edd60ef8c0deb324f5902
claude/tests-jahr-und-ci            f97ce586b91a38b31ec0b4ec203a9512d0e7f0a7
claude/widerruf-besitzpruefung      6955e615692f90d82feff9e8613c9f5f3dc7ce9e
claude/worker-deploy                c7cf9a23037e88e4ae075ee4cdbabb824764ad73
```
