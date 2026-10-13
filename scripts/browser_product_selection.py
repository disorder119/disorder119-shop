"""Choose public test subjects without confusing URL slugs with internal IDs."""
import json
from pathlib import Path


def rental_item_id(items=None):
    if items is None:items=json.loads(Path('data/items.json').read_text(encoding='utf-8'))
    for item in items:
        value=item.get('id')
        if str(item.get('public_status') or '').upper()!='AVAILABLE':continue
        if type(value) is not int or value<=0:continue
        price=item.get('price')
        if type(price) not in (int,float) or price<=0:continue
        return value
    raise AssertionError('Kein verfügbarer Artikel mit positivem Preis für die Mietprüfung gefunden.')
