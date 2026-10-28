import unittest
from unittest.mock import patch
import security_scan as scan


class SecretAssignments(unittest.TestCase):
    def test_shipping_and_mail_secrets_are_detected_in_json_and_javascript(self):
        for name in ('PACKLINK_API_KEY','PACKLINK_WEBHOOK_TOKEN','DHL_PASSWORD','MAIL_API_KEY','EBAY_CLIENT_SECRET','EBAY_CERT_ID','EBAY_VERIFICATION_TOKEN'):
            for source in (f'{name} = "opaque-fixture-value"',f'"{name}": "opaque-fixture-value"'):
                with self.subTest(name=name,source=source),patch('pathlib.Path.read_bytes',return_value=source.encode()):
                    self.assertTrue(scan.scan_file(scan.ROOT/'assets'/'app.js'))

    def test_pepper_testshop_password_brevo_and_meta_tokens_are_detected(self):
        brevo = 'xkeysib-' + 'a1' * 32 + '-' + 'Zx9Yw8Vu7Ts6Rq5P'
        meta = 'EAA' + 'Bx' * 30
        # Namen per Format zusammengesetzt, damit diese Datei selbst den Scan besteht.
        pfeffer, passwort = 'LOGIN_IP_PEPPER', 'TESTSHOP_PASSWORT'
        for source in (f'{pfeffer} = "4f1c2d3e4f5a6b7c8d9e"', f'"{passwort}": "geheim-119"', f'const k = "{brevo}";', f'token={meta}'):
            with self.subTest(source=source[:24]), patch('pathlib.Path.read_bytes', return_value=source.encode()):
                self.assertTrue(scan.scan_file(scan.ROOT/'assets'/'app.js'))
        # Starke Formate gelten auch in Testdateien.
        with patch('pathlib.Path.read_bytes', return_value=f'x = "{brevo}"'.encode()):
            self.assertTrue(scan.scan_file(scan.ROOT/'shop-worker'/'newsletter.test.mjs'))

    def test_env_references_and_names_without_value_are_fine(self):
        for source in ('const p = env.LOGIN_IP_PEPPER;', 'LOGIN_IP_PEPPER fehlt', '"TESTSHOP_PASSWORT": "${secrets.TESTSHOP_PASSWORT}"', 'EAAbc kurz'):
            with self.subTest(source=source), patch('pathlib.Path.read_bytes', return_value=source.encode()):
                self.assertEqual(scan.scan_file(scan.ROOT/'assets'/'app.js'), [])

    def test_public_client_ids_and_placeholders_are_not_private_keys(self):
        for source in ('"PAYPAL_CLIENT_ID": "public-client-id"','"EBAY_CLIENT_ID": "public-app-id"','PACKLINK_API_KEY="your_key"'):
            with patch('pathlib.Path.read_bytes',return_value=source.encode()):
                self.assertEqual(scan.scan_file(scan.ROOT/'assets'/'app.js'),[])


if __name__=='__main__':unittest.main()
