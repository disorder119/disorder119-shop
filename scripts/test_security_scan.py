import unittest
from unittest.mock import patch
import security_scan as scan


class SecretAssignments(unittest.TestCase):
    def test_shipping_and_mail_secrets_are_detected_in_json_and_javascript(self):
        for name in ('PACKLINK_API_KEY','PACKLINK_WEBHOOK_TOKEN','DHL_PASSWORD','MAIL_API_KEY','EBAY_CLIENT_SECRET','EBAY_CERT_ID','EBAY_VERIFICATION_TOKEN'):
            for source in (f'{name} = "opaque-fixture-value"',f'"{name}": "opaque-fixture-value"'):
                with self.subTest(name=name,source=source),patch('pathlib.Path.read_bytes',return_value=source.encode()):
                    self.assertTrue(scan.scan_file(scan.ROOT/'assets'/'app.js'))

    def test_public_client_ids_and_placeholders_are_not_private_keys(self):
        for source in ('"PAYPAL_CLIENT_ID": "public-client-id"','"EBAY_CLIENT_ID": "public-app-id"','PACKLINK_API_KEY="your_key"'):
            with patch('pathlib.Path.read_bytes',return_value=source.encode()):
                self.assertEqual(scan.scan_file(scan.ROOT/'assets'/'app.js'),[])


if __name__=='__main__':unittest.main()
