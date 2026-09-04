from pathlib import Path

p = Path(__file__).resolve().parent / "seo_upgrade_once.py"
s = p.read_text(encoding="utf-8")
s = s.replace("new_render_bundle = '''", "new_render_bundle = r'''", 1)
s = s.replace("new_sitemap = '''", "new_sitemap = r'''", 1)
p.write_text(s, encoding="utf-8")
print("SEO-Patch-Escaping korrigiert.")
