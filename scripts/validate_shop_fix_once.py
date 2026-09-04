from pathlib import Path

p = Path(__file__).resolve().parents[1] / "scripts" / "validate_shop.py"
s = p.read_text(encoding="utf-8")

old = '''        "price_on_request": [],
    }
'''
new = '''        "price_on_request": [],
        "missing_brand": [],
        "duplicate_article_number": [],
    }
'''
if old in s:
    s = s.replace(old, new, 1)

old = '''        if status in PUBLIC_STATUSES and not str(item.get("brand") or "").strip():
            severe.append(f"Artikel {item_id}: oeffentlicher Artikel ohne Marke")
'''
new = '''        if status in PUBLIC_STATUSES and not str(item.get("brand") or "").strip():
            issues["missing_brand"].append(item_id)
'''
if old in s:
    s = s.replace(old, new, 1)

old = '''    if len(article_numbers) != len(set(article_numbers)):
        seen_art = set()
        dupes = sorted({x for x in article_numbers if x in seen_art or seen_art.add(x)})
        severe.append("Doppelte Artikelnummern: " + ", ".join(dupes))
'''
new = '''    if len(article_numbers) != len(set(article_numbers)):
        seen_art = set()
        dupes = sorted({x for x in article_numbers if x in seen_art or seen_art.add(x)})
        issues["duplicate_article_number"].extend(dupes)
'''
if old in s:
    s = s.replace(old, new, 1)

p.write_text(s, encoding="utf-8")
print("Legacy-Datenluecken werden jetzt als Qualitaetswarnungen behandelt.")
