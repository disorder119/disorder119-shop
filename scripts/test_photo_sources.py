import json
import tempfile
import unittest
from pathlib import Path

import validate_photo_sources as vps
from validate_photo_sources import parse_name, validate


def h(zeichen):
    return zeichen * 64


def eintrag(sid, gal, article, n, name, sha='a'):
    return dict(shop_id=sid, gallery=gal, article=article, n=n, freigestellt=name,
                freigestellt_sha256=h(sha), webp_sha256=h(chr(ord(sha) + 3)))


class PhotoSourcesTest(unittest.TestCase):
    def setUp(self):
        self.items = [dict(id=9370, article='15', gallery=['assets/img/9370/0.webp', 'assets/img/9370/1.webp']),
                      dict(id=6195, article='192', gallery=['assets/img/b2-195/0.webp']),
                      dict(id=9374, article='15-2', gallery=['assets/img/9374/0.webp'])]
        self.manifest = dict(links=[dict(shop_id=9370, article='15'), dict(shop_id=6195, article='192')], excluded_shop_ids=[9374])
        self.sources = dict(version=1, bilder=[
            eintrag(9370, 'assets/img/9370/0.webp', '15', 1, 'S1/sold/mm6 top  (1) #15 freigestellt.png', 'a'),
            eintrag(9370, 'assets/img/9370/1.webp', '15', 2, 'S1/sold/mm6 top  (2) #15 freigestellt.png', 'b'),
            eintrag(6195, 'assets/img/b2-195/0.webp', '192', 1, 'S10/A.F Vandevorst Bluse Blau #195 (1) #192 freigestellt.png', 'c')],
            ausnahmen=[])

    def test_correct(self):
        self.assertEqual(validate(self.items, self.manifest, self.sources), ([], []))

    def test_name_parser_takes_number_after_index(self):
        self.assertEqual(parse_name('S10/A.F Vandevorst Bluse Blau #195 (1) #192 freigestellt.png'), (1, '192'))
        self.assertEqual(parse_name('S10\\y-3 rasta mütze #2017 (3) #214 freigestellt.png'), (3, '214'))
        self.assertIsNone(parse_name('top mm6 (2) freigestellt.png'))
        self.assertIsNone(parse_name('gaultier jeans blau #241 (1) freigestellt.png'))
        self.assertIsNone(parse_name('mm6 top  (1) #15.JPG'))

    def test_cutout_of_other_article_rejected(self):
        self.sources['bilder'][2]['freigestellt'] = 'S1/sold/mm6 top  (3) #15 freigestellt.png'
        self.assertTrue(validate(self.items, self.manifest, self.sources)[0])

    def test_old_tag_as_number_rejected(self):
        self.sources['bilder'][2]['article'] = '195'
        self.assertTrue(validate(self.items, self.manifest, self.sources)[0])

    def test_renumbering_without_new_mapping_rejected(self):
        self.manifest['links'][1]['article'] = '193'
        self.assertTrue(validate(self.items, self.manifest, self.sources)[0])

    def test_unlinked_item_compared_with_catalog_number(self):
        self.manifest['links'] = self.manifest['links'][:1]
        self.assertEqual(validate(self.items, self.manifest, self.sources)[0], [])
        self.items[1]['article'] = '251'
        self.assertTrue(validate(self.items, self.manifest, self.sources)[0])

    def test_wrong_index_rejected(self):
        self.sources['bilder'][1]['n'] = 3
        self.assertTrue(validate(self.items, self.manifest, self.sources)[0])

    def test_same_cutout_for_two_articles_rejected(self):
        self.sources['bilder'][2]['freigestellt_sha256'] = h('a')
        self.assertTrue(validate(self.items, self.manifest, self.sources)[0])

    def test_duplicate_entry_rejected(self):
        self.sources['bilder'].append(dict(self.sources['bilder'][0]))
        self.assertTrue(validate(self.items, self.manifest, self.sources)[0])

    def test_bad_path_or_hash_rejected(self):
        self.sources['bilder'][0]['gallery'] = 'assets\\img\\9370\\0.webp'
        self.assertTrue(validate(self.items, self.manifest, self.sources)[0])
        self.setUp()
        self.sources['bilder'][0]['webp_sha256'] = ''
        self.assertTrue(validate(self.items, self.manifest, self.sources)[0])

    def test_new_admin_image_is_only_a_hint(self):
        self.items[0]['gallery'].append('assets/img/9370/2.webp')
        fehler, hinweise = validate(self.items, self.manifest, self.sources)
        self.assertEqual(fehler, [])
        self.assertTrue(any('9370/2.webp' in x for x in hinweise))

    def test_replaced_image_is_only_a_hint(self):
        fehler, hinweise = validate(self.items, self.manifest, self.sources, lambda rel: 'anders')
        self.assertEqual(fehler, [])
        self.assertEqual(len(hinweise), 3)

    def test_photo_of_other_article_is_named_in_hint(self):
        self.items[1]['gallery'].append('assets/img/9370/0.webp')     # fremder Pfad in der Galerie
        fehler, hinweise = validate(self.items, self.manifest, self.sources)
        self.assertEqual(fehler, [])
        self.assertTrue(any('Artikel #15' in x for x in hinweise))
        self.setUp()
        fremd = self.sources['bilder'][0]['webp_sha256']             # Inhalt von #15 ueber #192 geschrieben
        fehler, hinweise = validate(self.items, self.manifest, self.sources,
                                    lambda rel: fremd if rel.endswith('b2-195/0.webp') else None)
        self.assertTrue(any('Foto von Artikel #15' in x for x in hinweise))

    def test_excluded_and_exceptions_need_no_source(self):
        fehler, hinweise = validate(self.items, self.manifest, self.sources)
        self.assertEqual(hinweise, [])          # 9374 ist ausgeschlossen
        self.items[1]['gallery'].append('assets/img/b2-195/1.webp')
        self.sources['ausnahmen'] = [dict(shop_id=6195, gallery='assets/img/b2-195/1.webp', grund='Original geloescht')]
        self.assertEqual(validate(self.items, self.manifest, self.sources), ([], []))
        self.items[1]['gallery'].pop()
        self.assertTrue(any('veraltet' in x for x in validate(self.items, self.manifest, self.sources)[1]))

    def test_wrong_version_rejected(self):
        self.assertTrue(validate(self.items, self.manifest, dict(bilder=[]))[0])

    def test_bom_and_missing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            alt = vps.BASE
            try:
                vps.BASE = Path(tmp)
                (Path(tmp) / 'x.json').write_text(json.dumps(dict(version=1)), encoding='utf-8-sig')
                self.assertEqual(vps._lade('x.json'), dict(version=1))
                with self.assertRaises(SystemExit):
                    vps._lade('fehlt.json')
            finally:
                vps.BASE = alt


if __name__ == '__main__':
    unittest.main()
