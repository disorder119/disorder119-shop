import unittest
from validate_catalog_number_links import validate

class CatalogNumbersTest(unittest.TestCase):
    def setUp(self):
        self.items=[dict(id=9472,article='123'),dict(id=6199,article='196'),dict(id=9427,article='72')]
        self.manifest=dict(links=[dict(shop_id=9472,article='123'),dict(shop_id=6199,article='196')],excluded_shop_ids=[9427])
    def test_correct_ids_and_numbers(self): self.assertEqual(validate(self.items,self.manifest),[])
    def test_old_article_number_rejected(self):
        self.items[0]['article']='126'; self.assertTrue(validate(self.items,self.manifest))
    def test_swapped_article_numbers_rejected(self):
        self.items[0]['article'],self.items[1]['article']='196','123'; self.assertTrue(validate(self.items,self.manifest))
    def test_missing_product_rejected(self): self.assertTrue(validate(self.items[1:],self.manifest))
    def test_duplicate_product_rejected(self): self.assertTrue(validate(self.items+[self.items[0]],self.manifest))
    def test_duplicate_manifest_number_rejected(self):
        self.manifest['links'][1]['article']='123'; self.assertTrue(validate(self.items,self.manifest))
    def test_duplicate_manifest_id_rejected(self):
        self.manifest['links'].append(self.manifest['links'][0]); self.assertTrue(validate(self.items,self.manifest))
    def test_excluded_product_cannot_be_mapped(self):
        self.manifest['links'].append(dict(shop_id=9427,article='72')); self.assertTrue(validate(self.items,self.manifest))

if __name__=='__main__': unittest.main()
