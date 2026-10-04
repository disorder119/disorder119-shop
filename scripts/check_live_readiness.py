#!/usr/bin/env python3
"""Bounded public GET checks. No login, payments, email or business-data writes.

An automatic pass is limited to the listed technical checks. Operator duties and
actual provider/browser acceptance are explicitly left unconfirmed.
"""
from __future__ import annotations

import argparse
import concurrent.futures
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

SHOP = 'https://disorder119.com'
API = 'https://api.disorder119.com'
MAX_BYTES = 4_000_000
PRIVATE_FIELDS = frozenset({
    'purchase_price', 'purchase_date', 'purchase_cost', 'cost_price',
    'seller_email', 'supplier_name', 'invoice_path', 'receipt_path',
    'local_path', 'data_quality_open', 'data_quality_sources',
})
PAGE_PATHS = ('/', '/kasse/', '/konto/', '/agb/', '/datenschutz/', '/widerruf/')
BLOCKED_PATHS = (
    '/shop-worker/worker.js', '/shop-worker/wrangler.toml',
    '/config/shop-config.json', '/data/catalog-taxonomy-report.json',
    '/.git/config', '/.env',
)
REQUESTS = (
    *((SHOP + path, None) for path in PAGE_PATHS + BLOCKED_PATHS),
    (SHOP + '/data/items.json', None),
    (SHOP + '/data/catalog.json', None),
    ('https://www.disorder119.com/kasse/', None),
    (API + '/admin/privacy/requests', None),
    (API + '/admin/privacy/requests', 'https://admin.disorder119.com'),
    (API + '/admin/privacy/requests', 'https://untrusted.example'),
    (API + '/admin/orders', None),
    (API + '/account/profile', None),
)
MANUAL_CHECKS = (
    'LUCID, Systembeteiligung und Mengenmeldungen belegen',
    'Geschäftliche Telefonnummer und zuverlässige Lieferfrist bestätigen',
    'Tatsächliche PayPal-Sandbox-Bestellung und Rückzahlung abnehmen',
    'Apple Pay auf einem unterstützten Gerät abnehmen',
    'Bestell-, Rechnungs- und Widerrufs-E-Mail-Zustellung abnehmen',
    'Datenschutzverträge, Warenangaben und gegebenenfalls Mietverträge prüfen',
)


@dataclass(frozen=True)
class Response:
    status: int
    headers: dict[str, str]
    body: bytes = b''
    error: str | None = None


def fetch_public(url: str, origin: str | None = None) -> Response:
    headers = {'User-Agent': 'Disorder119Manager/readonly', 'Cache-Control': 'no-cache'}
    if origin:
        headers['Origin'] = origin
    try:
        try:
            response = urlopen(Request(url, headers=headers, method='GET'), timeout=15)
        except HTTPError as error:
            response = error
        with response:
            body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                return Response(response.status, {}, error='RESPONSE_TOO_LARGE')
            final = urlsplit(response.url)
            original = urlsplit(url)
            allowed_hosts = {original.hostname}
            if original.hostname == 'www.disorder119.com':
                allowed_hosts.add('disorder119.com')
            if final.scheme != 'https' or final.hostname not in allowed_hosts:
                return Response(response.status, {}, error='UNEXPECTED_REDIRECT')
            return Response(response.status, {k.lower(): v for k, v in response.headers.items()}, body)
    except Exception as error:
        # Do not export exception text: it can contain response or environment data.
        return Response(0, {}, error=type(error).__name__)


def header_gaps(headers: dict[str, str]) -> list[str]:
    gaps = []
    hsts = headers.get('strict-transport-security', '')
    age = re.search(r'\bmax-age\s*=\s*(\d+)', hsts, re.I)
    if not age or int(age.group(1)) < 31_536_000:
        gaps.append('HSTS')
    if headers.get('x-content-type-options', '').lower() != 'nosniff':
        gaps.append('nosniff')
    if headers.get('x-frame-options', '').upper() != 'DENY':
        gaps.append('Frame-Schutz')
    # Report-only alone is not an enforced policy.
    if not re.search(r"(?:^|;)\s*frame-ancestors\s+'none'\s*(?:;|$)", headers.get('content-security-policy', ''), re.I):
        gaps.append('verbindliche CSP-Frame-Regel')
    if headers.get('referrer-policy', '') not in ('no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin'):
        gaps.append('Referrer-Policy')
    if not re.search(r'\bpayment\s*=', headers.get('permissions-policy', ''), re.I):
        gaps.append('Permissions-Policy mit Zahlungsfreigabe')
    return gaps


def catalog_problem(body: bytes) -> str | None:
    try:
        rows = json.loads(body)
        if not isinstance(rows, list) or not rows:
            return 'Öffentlicher Katalog fehlt oder ist leer.'
        if any(not isinstance(row, dict) or row.get('public_status') not in ('AVAILABLE', 'SOLD') for row in rows):
            return 'Entwürfe oder ungültige Artikelstatus werden öffentlich ausgeliefert.'
        def contains_private(value):
            if isinstance(value, dict):
                return bool(PRIVATE_FIELDS.intersection(value)) or any(contains_private(v) for v in value.values())
            if isinstance(value, list):
                return any(contains_private(v) for v in value)
            return False
        if contains_private(rows):
            return 'Interne Arbeits- oder Einkaufsfelder werden öffentlich ausgeliefert.'
    except (ValueError, TypeError, RecursionError):
        return 'Katalogantwort ist kein gültiges Artikel-JSON.'
    return None


def evaluate(responses: dict[tuple[str, str | None], Response]) -> dict:
    checks = []
    def check(label, key, expected, inspect=None):
        response = responses.get(key, Response(0, {}, error='NOT_CHECKED'))
        problem = response.error or (f'HTTP {response.status}; erwartet {expected}.' if response.status != expected else None)
        if not problem and inspect:
            problem = inspect(response)
        checks.append({'label': label, 'url': key[0], 'origin': key[1], 'passed': problem is None,
                       'detail': problem or 'Bestanden.'})
    def check_headers(response):
        gaps = header_gaps(response.headers)
        return 'Fehlender Schutz: ' + ', '.join(gaps) if gaps else None
    for path in PAGE_PATHS:
        check('Seite und Schutzheader: ' + path, (SHOP + path, None), 200, check_headers)
    check('www-Kasse und Schutzheader', ('https://www.disorder119.com/kasse/', None), 200, check_headers)
    for path in BLOCKED_PATHS:
        check('Interner Pfad gesperrt: ' + path, (SHOP + path, None), 404)
    for path in ('/data/items.json', '/data/catalog.json'):
        check('Öffentliche Artikelauswahl: ' + path, (SHOP + path, None), 200, lambda r: catalog_problem(r.body))
    for path, origin, expected in (
        ('/admin/privacy/requests', None, 401),
        ('/admin/privacy/requests', 'https://admin.disorder119.com', 401),
        ('/admin/privacy/requests', 'https://untrusted.example', 403),
        ('/admin/orders', None, 401),
        ('/account/profile', None, 401),
    ):
        check('Zugriffsschutz: ' + path, (API + path, origin), expected)
    return {'checked_at_utc': datetime.now(timezone.utc).isoformat(),
            'scope': 'Nur die aufgeführten öffentlichen GET-Prüfungen; keine Datenänderungen.',
            'automated_checks_passed': all(c['passed'] for c in checks),
            'overall_release_confirmed': False,
            'checks': checks,
            'manual_checks': [{'label': label, 'status': 'unconfirmed'} for label in MANUAL_CHECKS]}


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Strukturierten Bericht ohne Antwortinhalte speichern.')
    args = parser.parse_args()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        responses = dict(zip(REQUESTS, pool.map(lambda key: fetch_public(*key), REQUESTS)))
    report = evaluate(responses)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    for check in report['checks']:
        print(('OK' if check['passed'] else 'OFFEN') + ': ' + check['label'] + ' — ' + check['detail'])
    print('Praktische Abnahme und Betreiberpflichten: weiterhin separat zu bestätigen.')
    print('Gesamtfreigabe: nicht bestätigt.')
    return 0 if report['automated_checks_passed'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
