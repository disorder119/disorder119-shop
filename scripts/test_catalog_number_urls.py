import json,re,unittest
from pathlib import Path
BASE=Path(__file__).resolve().parents[1]

class CatalogUrlTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.items=json.loads((BASE/'data/items.json').read_text(encoding='utf-8'))
        cls.by={i['id']:i for i in cls.items}
        cls.links=json.loads((BASE/'config/catalog-number-links.json').read_text(encoding='utf-8'))['links']
    def test_canonical_slugs_are_unique(self): self.assertEqual(len({i['url_slug'] for i in self.items}),len(self.items))
    def test_confirmed_numbers_have_correct_product_pages(self):
        for r in self.links:
            i=self.by[r['shop_id']]; self.assertEqual(i['url_slug'],r['article'])
            if i['public_status']=='DRAFT': continue
            for lang in ('','en','fr'):
                file=BASE/lang/'artikel'/i['url_slug']/'index.html'; text=file.read_text(encoding='utf-8')
                canonical='https://disorder119.com/'+(lang+'/' if lang else '')+'artikel/'+i['url_slug']+'/'
                self.assertIn(f'<link rel="canonical" href="{canonical}">',text)
                payload,_=json.JSONDecoder().raw_decode(text.split('window.ARTICLE_ITEM = ',1)[1])
                self.assertEqual(payload['id'],i['id']); self.assertEqual(payload['article'],r['article'])
    def test_legacy_page_has_same_product_and_redirect(self):
        for id in (6184,9429,9472,6241):
            text=(BASE/'artikel'/str(id)/'index.html').read_text(encoding='utf-8')
            self.assertIn(f'content="0;url=/artikel/{self.by[id]["url_slug"]}/"',text)
    def test_only_confirmed_grey_trousers_published(self):
        self.assertEqual(self.by[9429]['public_status'],'AVAILABLE');self.assertEqual(self.by[9429]['article'],'69')
        self.assertEqual(self.by[9427]['public_status'],'DRAFT')
    def test_catalog_keeps_product_id_and_route_number(self):
        public={i['id']:i for i in json.loads((BASE/'data/catalog.json').read_text(encoding='utf-8'))}
        for r in self.links:
            if self.by[r['shop_id']]['public_status']=='DRAFT':continue
            self.assertEqual(public[r['shop_id']]['url_slug'],r['article'])
if __name__=='__main__':unittest.main()
