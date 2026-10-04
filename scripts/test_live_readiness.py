import json
import unittest
from unittest.mock import patch
import check_live_readiness as readiness

HEADERS = {
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
    'content-security-policy': "object-src 'none'; frame-ancestors 'none'",
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), payment=(self "https://www.paypal.com")',
}


def fixtures():
    rows = json.dumps([{'id': 1, 'public_status': 'AVAILABLE', 'title': 'Synthetic'}]).encode()
    result = {}
    for url, origin in readiness.REQUESTS:
        path = readiness.urlsplit(url).path
        if url.startswith(readiness.API):
            response = readiness.Response(403 if origin == 'https://untrusted.example' else 401, {})
        elif path in readiness.BLOCKED_PATHS:
            response = readiness.Response(404, {})
        else:
            response = readiness.Response(200, HEADERS, rows if '/data/' in path else b'<p>Synthetic</p>')
        result[(url, origin)] = response
    return result


class LiveReadinessTests(unittest.TestCase):
    def test_technical_pass_does_not_confirm_operator_or_payment_readiness(self):
        report = readiness.evaluate(fixtures())
        self.assertTrue(report['automated_checks_passed'])
        self.assertFalse(report['overall_release_confirmed'])
        self.assertTrue(all(c['status'] == 'unconfirmed' for c in report['manual_checks']))

    def test_published_but_unproxied_shop_fails(self):
        responses = fixtures()
        responses[(readiness.SHOP + '/', None)] = readiness.Response(200, {'cache-control': 'max-age=600'})
        self.assertFalse(readiness.evaluate(responses)['automated_checks_passed'])

    def test_report_only_csp_does_not_count_as_enforcement(self):
        headers = dict(HEADERS)
        headers['content-security-policy-report-only'] = headers.pop('content-security-policy')
        self.assertIn('verbindliche CSP-Frame-Regel', readiness.header_gaps(headers))

    def test_exposed_backend_source_fails(self):
        responses = fixtures()
        responses[(readiness.SHOP + readiness.BLOCKED_PATHS[0], None)] = readiness.Response(200, {})
        self.assertFalse(readiness.evaluate(responses)['automated_checks_passed'])

    def test_nested_private_fields_and_drafts_fail_without_exporting_values(self):
        for rows in ([{'public_status': 'DRAFT'}], [{'public_status': 'AVAILABLE', 'nested': [{'purchase_price': 25}]}]):
            self.assertIsNotNone(readiness.catalog_problem(json.dumps(rows).encode()))

    def test_malformed_empty_or_non_array_catalog_fails(self):
        for body in (b'not-json', b'[]', b'{}', b'[null]'):
            self.assertIsNotNone(readiness.catalog_problem(body))

    def test_foreign_origin_granted_access_fails(self):
        responses = fixtures()
        responses[(readiness.API + '/admin/privacy/requests', 'https://untrusted.example')] = readiness.Response(200, {})
        self.assertFalse(readiness.evaluate(responses)['automated_checks_passed'])

    def test_failed_or_missing_request_does_not_pass(self):
        self.assertFalse(readiness.evaluate({})['automated_checks_passed'])
        responses = fixtures()
        responses[(readiness.SHOP + '/', None)] = readiness.Response(0, {}, error='TimeoutError')
        self.assertFalse(readiness.evaluate(responses)['automated_checks_passed'])

    def test_report_never_exports_http_response_bodies(self):
        responses = fixtures()
        responses[(readiness.API + '/account/profile', None)] = readiness.Response(200, {}, b'PRIVATE_RESPONSE_SENTINEL')
        self.assertNotIn('PRIVATE_RESPONSE_SENTINEL', json.dumps(readiness.evaluate(responses)))

    @patch('check_live_readiness.urlopen')
    def test_canonical_www_redirect_is_allowed(self, open_url):
        class Stub:
            status = 200
            headers = HEADERS
            url = readiness.SHOP + '/kasse/'
            def read(self, limit): return b'ok'
            def __enter__(self): return self
            def __exit__(self, *args): return False
        open_url.return_value = Stub()
        response = readiness.fetch_public('https://www.disorder119.com/kasse/')
        self.assertIsNone(response.error)
        self.assertEqual(response.status, 200)

    @patch('check_live_readiness.urlopen')
    def test_fetch_is_get_without_authentication_and_rejects_redirect(self, open_url):
        class Stub:
            status = 200
            headers = HEADERS
            url = 'https://unexpected.example/'
            def read(self, limit): return b'ok'
            def __enter__(self): return self
            def __exit__(self, *args): return False
        open_url.return_value = Stub()
        response = readiness.fetch_public(readiness.SHOP + '/')
        request = open_url.call_args.args[0]
        self.assertEqual(request.get_method(), 'GET')
        self.assertFalse(request.has_header('Authorization'))
        self.assertFalse(request.has_header('Cookie'))
        self.assertEqual(response.error, 'UNEXPECTED_REDIRECT')


if __name__ == '__main__':
    unittest.main()
