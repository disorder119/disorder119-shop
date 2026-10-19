"""Regression: responsive first paint must preserve curated source bytes."""
import hashlib
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_site

class MobileHeroTests(unittest.TestCase):
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
