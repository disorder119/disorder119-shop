"""Regression: responsive first paint must preserve curated source bytes."""
import hashlib
import importlib.util
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_site

class MobileHeroTests(unittest.TestCase):
    def test_pwa_preparation_preserves_catalogue_footer_and_deferred_product_scripts(self):
        from apply_pwa import patch_build
        root = Path(__file__).resolve().parents[1]
        source = (root / "build_site.py").read_text()
        self.assertTrue(patch_build(source) == source, "PWA preparation must preserve the current generator verbatim")

    def test_mobile_hero_geometry_is_stable_when_full_styles_arrive(self):
        # Product CSS loads independently of the inline first-paint shell.
        # The intermediate base stylesheet used to move the photo down 4px.
        root = Path(__file__).resolve().parents[1]
        layers = {
            "critical": build_site.PRODUCT_CRITICAL_CSS,
            "base": (root / "assets/article.css").read_text(),
            "final": (root / "assets/product-page-v4.css").read_text(),
        }
        geometry = {}
        for name, css in layers.items():
            match = re.search(r"\.product\s*\{\s*grid-template-columns:\s*1fr;([^}]+)\}", css)
            self.assertIsNotNone(match, name)
            rules = dict(re.findall(r"([a-z-]+):\s*([^;]+)(?:;|$)", match.group(1)))
            geometry[name] = (rules.get("gap"), rules.get("padding"))
        self.assertEqual(geometry["base"], geometry["final"])
        self.assertEqual(geometry["critical"], geometry["final"])

    def test_derivative_preserves_original_and_refreshes_changed_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel = "assets/img/test/0.webp"
            original = root / rel
            original.parent.mkdir(parents=True)
            Image.new("RGBA", (1200, 1600), (50, 100, 140, 128)).save(original, "WEBP")
            before = hashlib.sha256(original.read_bytes()).hexdigest()
            items = [{"gallery": [rel]}, {"gallery": [rel]}, {"gallery": []}, {"gallery": ["missing.webp"]}]
            with patch.object(build_site, "BASE", root), patch.object(build_site, "ITEMS", items):
                build_site.build_mobile_heroes()
                target = root / build_site.mobile_hero_path(rel)
                with Image.open(target) as image:
                    self.assertEqual(image.size, (600, 800))
                    self.assertIn("A", image.getbands())
                self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), before)
                first = target.read_bytes()
                Image.new("RGBA", (1200, 1600), (200, 30, 40, 128)).save(original, "WEBP")
                build_site.build_mobile_heroes()
                self.assertNotEqual(target.read_bytes(), first)
                self.assertEqual(items[0]["gallery"], [rel])

if __name__ == "__main__":
    unittest.main()
