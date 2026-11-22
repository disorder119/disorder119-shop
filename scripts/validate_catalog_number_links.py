"""Reject drift in the owner's confirmed product-ID/article-number crosswalk."""
from __future__ import annotations
import json
from pathlib import Path
BASE=Path(__file__).resolve().parents[1]

def validate(items, manifest):
    errors=[]
    by_id={i['id']:i for i in items}
    if len(by_id)!=len(items): errors.append('Duplicate product IDs')
    links=manifest['links']
    retired=manifest.get('retired_links',[])
    all_links=links+retired
    if len({r['shop_id'] for r in all_links})!=len(all_links): errors.append('Duplicate reserved product IDs')
    if len({r['article'] for r in all_links})!=len(all_links): errors.append('Duplicate reserved article numbers')
    if len({r['shop_id'] for r in links})!=len(links): errors.append('Duplicate mapped product IDs')
    if len({r['article'] for r in links})!=len(links): errors.append('Duplicate confirmed article numbers')
    if set(manifest.get('excluded_shop_ids',[])) & {r['shop_id'] for r in links}: errors.append('Excluded product mapped')
    for row in retired:
        if row['shop_id'] in by_id: errors.append(f'Retired product still present: {row["shop_id"]}')
        if row['shop_id'] not in manifest.get('excluded_shop_ids',[]): errors.append(f'Retired product not excluded: {row["shop_id"]}')
    for row in links:
        item=by_id.get(row['shop_id'])
        if item is None: errors.append(f'Mapped product missing: {row["shop_id"]}')
        elif item.get('article')!=row['article']: errors.append(f'Product {row["shop_id"]}: expected article {row["article"]}, found {item.get("article")}')
        elif item.get('url_slug',row['article'])!=row['article']: errors.append(f'Product {row["shop_id"]}: canonical URL does not match confirmed article number')
    return errors

def main():
    items=json.loads((BASE/'data/items.json').read_text(encoding='utf-8'))
    manifest=json.loads((BASE/'config/catalog-number-links.json').read_text(encoding='utf-8'))
    errors=validate(items,manifest)
    if errors: raise SystemExit('\n'.join(errors))
    print(f'Confirmed catalog numbers: {len(manifest["links"])} product identities matched')

if __name__=='__main__': main()
