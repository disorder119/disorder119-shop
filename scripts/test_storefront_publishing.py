"""Security and rollback regressions; only temporary repositories and fake APIs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import tomllib
import unittest
from unittest.mock import patch

import export_storefront_assets as exporter
import publish_storefront as publisher


class PublishingTests(unittest.TestCase):
    def test_production_config_preserves_routes_and_only_existing_service(self):
        cfg = tomllib.loads((exporter.ROOT / 'shop-worker/wrangler.storefront.toml').read_text('utf-8'))
        publisher.validate_config(cfg)
        for change in ({'workers_dev': True}, {'preview_urls': True}, {'d1_databases': [{}]},
                       {'services': []}, {'assets': {'directory': '..'}}):
            with self.assertRaises(AssertionError):
                publisher.validate_config(dict(cfg, **change))

    def test_geo_block_variables_are_validated_before_reaching_wrangler(self):
        self.assertEqual(publisher.geo_vars({}), [])
        self.assertEqual(publisher.geo_vars({'GEO_SPERRE_LAENDER': ' '}), [])
        self.assertEqual(publisher.geo_vars({'GEO_SPERRE_LAENDER': 'ru, by;in ru', 'GEO_SPERRE_KONTINENTE': 'as'}),
                         ['--var', 'GEO_SPERRE_LAENDER:RU,BY,IN', '--var', 'GEO_SPERRE_KONTINENTE:AS'])
        self.assertEqual(publisher.geo_vars({'GEO_SPERRE_LAENDER': 'AUS'}), ['--var', 'GEO_SPERRE_LAENDER:aus'])
        for bad in ('RU,"; rm -rf', 'RUS', 'R', 'RU IN --var X:Y'):
            with self.assertRaises(ValueError):
                publisher.geo_vars({'GEO_SPERRE_LAENDER': bad})

    def test_manifest_detects_missing_modified_and_extra_upload_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public = root / 'public'
            public.mkdir()
            file = public / 'index.html'
            body = b'original'
            file.write_bytes(body)
            manifest = {'asset_count': 1, 'files': [{'path': 'index.html', 'sha256': hashlib.sha256(body).hexdigest()}]}
            (root / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
            publisher.verify_manifest(root)
            file.write_bytes(b'changed')
            with self.assertRaises(AssertionError): publisher.verify_manifest(root)
            file.write_bytes(body)
            (public / 'password.txt').write_text('should not upload')
            with self.assertRaises(AssertionError): publisher.verify_manifest(root)
            (public / 'password.txt').unlink()
            file.unlink()
            with self.assertRaises(AssertionError): publisher.verify_manifest(root)

    def test_export_uses_git_objects_and_filters_private_rows_fields_and_files(self):
        node = os.environ.get('NODE_FOR_TESTS', 'node')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'repo'
            root.mkdir()
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            (root / 'shop-worker').mkdir()
            for name in ('storefront-edge.js', 'storefront-csp.js', 'catalog-number-routes.js', 'geo-sperre.js', 'waechter-regeln.js', 'waechter-seiten.js', 'waechter-erwischt-texte.js', 'privacy-security.js'):
                shutil.copyfile(exporter.ROOT / 'shop-worker' / name, root / 'shop-worker' / name)
            paths = ['index.html', 'en/index.html', 'fr/index.html', 'kasse/index.html',
                'feed/google-merchant.xml', 'google7945c4dc594a9a9c.html',
                '.well-known/apple-developer-merchantid-domain-association', 'assets/img/a.webp',
                'artikel/777/index.html', 'en/artikel/777/index.html', 'fr/artikel/777/index.html',
                'config/credentials.json', 'assets/example.test.js', 'admin/index.html']
            for path in paths:
                destination = root / path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(b'original')
            (root / 'data').mkdir()
            rows = [{'id': 1, 'article': '119', 'url_slug': '777', 'title': 'Approved', 'price': 149,
                     'public_status': 'AVAILABLE', 'gallery': ['assets/img/a.webp'], 'purchase_price': 10},
                    {'id': 2, 'public_status': 'DRAFT', 'title': 'Private'}]
            for name in ('catalog.json', 'items.json'):
                (root / 'data' / name).write_text(json.dumps(rows), encoding='utf-8')
            subprocess.run(['git', '-C', str(root), 'add', '.'], check=True)
            subprocess.run(['git', '-C', str(root), '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
                            'commit', '-qm', 'fixture'], check=True)
            (root / 'index.html').write_bytes(b'dirty unpublished')
            output = Path(directory) / 'output'
            manifest = exporter.export(root, output, 'HEAD', node)
            self.assertEqual((output / 'public/index.html').read_bytes(), b'original')
            exported = json.loads((output / 'public/data/items.json').read_text('utf-8'))
            self.assertEqual(len(exported), 1)
            self.assertNotIn('purchase_price', exported[0])
            self.assertEqual(exported[0]['article'], '119')
            for path in ('config/credentials.json', 'admin/index.html', 'assets/example.test.js'):
                self.assertFalse((output / 'public' / path).exists())
            self.assertEqual(manifest['raw_private_catalog_uploaded'], False)
            publisher.verify_manifest(output)
            with self.assertRaises(ValueError): exporter.export(root, output, 'HEAD', node)

    def test_asset_versions_are_content_hashes_leaves_first_and_never_touch_inline_scripts(self):
        with tempfile.TemporaryDirectory() as directory:
            public = Path(directory)
            (public / 'assets').mkdir()
            files = {
                'assets/site-lock.js': 'lock()',
                'assets/runtime.js': 's.src="/assets/site-lock.js?v=20261008-1";',
                'assets/pwa.js': 's.src="/assets/runtime.js?v=20261008-1";',
                'assets/upgrade.js': 'var V="1";css("/assets/promos.css?v=" + V);js("/assets/missing.js?v=" + V);',
                'assets/promos.css': 'a{}',
                'assets/rental.js': 'rent()',
                'assets/app.js': 'app()',
            }
            for name, text in files.items():
                (public / name).write_text(text, encoding='utf-8')
            fixed = '<script>try{document.write(\'<script src="/assets/rental.js"></scr\'+\'ipt>\')}catch(e){}</script>'
            page = ('<head><link rel="stylesheet" href="/assets/promos.css?v=abc">\r\n'
                    '<script src="/assets/pwa.js?v=old"></script>' + fixed + '</head><body>'
                    '<script>/* FOCUS3_MOBILE_RUNTIME_AFTER_LCP */(function(){var s=["/assets/app.js?v=0","/assets/rental.js"],i=0;})();</script>'
                    '<script>window.SHOP_CONFIG = {"logo":"/assets/rental.js"};</script>'
                    '<a href="/assets/img/x.webp">x</a><script src="/assets/gone.js"></script></body>')
            (public / 'index.html').write_bytes(page.encode('utf-8'))
            changed = exporter.asset_versionen(public)
            h = lambda name: hashlib.sha256((public / name).read_bytes()).hexdigest()[:10]
            runtime = (public / 'assets/runtime.js').read_text('utf-8')
            self.assertEqual(runtime, f's.src="/assets/site-lock.js?v={h("assets/site-lock.js")}";')
            self.assertIn(f'/assets/runtime.js?v={h("assets/runtime.js")}', (public / 'assets/pwa.js').read_text('utf-8'))
            upgrade = (public / 'assets/upgrade.js').read_text('utf-8')
            self.assertIn(f'css("/assets/promos.css?v={h("assets/promos.css")}")', upgrade)
            self.assertIn('js("/assets/missing.js?v=" + V)', upgrade)  # unknown file stays untouched
            html = (public / 'index.html').read_bytes().decode('utf-8')
            self.assertIn(f'href="/assets/promos.css?v={h("assets/promos.css")}">\r\n', html)
            self.assertIn(f'<script src="/assets/pwa.js?v={h("assets/pwa.js")}"></script>', html)
            self.assertIn(f'"/assets/app.js?v={h("assets/app.js")}","/assets/rental.js?v={h("assets/rental.js")}"', html)
            self.assertIn(fixed, html)  # CSP-hashed inline code unchanged
            self.assertIn('{"logo":"/assets/rental.js"}', html)
            self.assertIn('<script src="/assets/gone.js"></script>', html)
            self.assertEqual(changed, {'assets/runtime.js', 'assets/pwa.js', 'assets/upgrade.js', 'index.html'})
            self.assertGreater(exporter.asset_versionen_pruefen(public), 4)
            self.assertEqual(exporter.asset_versionen(public), set())  # idempotent
            (public / 'assets/site-lock.js').write_text('changed()', encoding='utf-8')
            with self.assertRaises(ValueError): exporter.asset_versionen_pruefen(public)

    def test_remote_head_checks_are_unambiguous(self):
        with patch.object(publisher, 'git', return_value=b'a' * 40 + b'\trefs/heads/main\n'):
            self.assertEqual(publisher.main_head(), 'a' * 40)
        with patch.object(publisher, 'git', return_value=b''):
            with self.assertRaises(RuntimeError): publisher.main_head()

    def test_activation_api_only_changes_version_distribution(self):
        old = [{'version_id': 'old', 'percentage': 100}]
        with patch.object(publisher, 'api', return_value={}) as api:
            publisher.deploy_versions(old, 'rollback')
            api.assert_called_once_with('/deployments', 'POST', {
                'strategy': 'percentage', 'versions': old, 'annotations': {'workers/message': 'rollback'}})

    def test_failed_public_checks_roll_back_and_verify_previous_version(self):
        old = [{'version_id': 'old', 'percentage': 100}]
        new = [{'version_id': 'new', 'percentage': 100}]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            with patch.object(publisher, 'deploy_versions') as deploy, \
                 patch.object(publisher, 'check_public', side_effect=RuntimeError('bad response')), \
                 patch.object(publisher, 'current_versions', side_effect=[new, old]), \
                 patch.object(publisher.time, 'sleep'):
                with self.assertRaises(RuntimeError):
                    publisher.activate_and_verify('new', old, 'a' * 40, {}, path)
                self.assertEqual(deploy.call_args_list[-1].args[0], old)
                state = json.loads(path.read_text('utf-8'))
                self.assertTrue(state['rolled_back'])
                self.assertFalse(state['verified'])

    def test_activation_timeout_is_observed_and_not_blindly_sent_again(self):
        old = [{'version_id': 'old', 'percentage': 100}]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            with patch.object(publisher, 'deploy_versions', side_effect=[TimeoutError(), {}]) as deploy, \
                 patch.object(publisher, 'current_versions', side_effect=[[{'version_id': 'new', 'percentage': 100}], old]):
                with self.assertRaises(RuntimeError):
                    publisher.activate_and_verify('new', old, 'a' * 40, {}, path)
                self.assertEqual(deploy.call_count, 2)
                self.assertEqual(deploy.call_args_list[-1].args[0], old)
                self.assertTrue(json.loads(path.read_text('utf-8'))['rolled_back'])

    def test_never_roll_back_somebody_elses_newer_deployment(self):
        old = [{'version_id': 'old', 'percentage': 100}]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            with patch.object(publisher, 'deploy_versions') as deploy, \
                 patch.object(publisher, 'check_public', side_effect=RuntimeError()), \
                 patch.object(publisher, 'current_versions', return_value=[{'version_id': 'other', 'percentage': 100}]), \
                 patch.object(publisher.time, 'sleep'):
                with self.assertRaises(RuntimeError):
                    publisher.activate_and_verify('new', old, 'a' * 40, {}, path)
                self.assertEqual(deploy.call_count, 1)
                self.assertTrue(json.loads(path.read_text('utf-8'))['rollback_skipped_newer_deployment'])


if __name__ == '__main__':
    unittest.main()
