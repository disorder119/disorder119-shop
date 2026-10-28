import copy, importlib.util, pathlib, tempfile, unittest, sys
from unittest.mock import patch
import xml.etree.ElementTree as ET
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import build_site

class ConfirmedDefectFeedTest(unittest.TestCase):
    def test_confirmed_missing_buttons_reach_short_merchant_description(self):
        item=copy.deepcopy(next(x for x in build_site.ITEMS if str(x.get("article"))=="13"))
        item["public_status"]="AVAILABLE"
        with tempfile.TemporaryDirectory() as directory:
            target=pathlib.Path(directory)/"feed.xml"
            target_en=pathlib.Path(directory)/"feed-en.xml"
            with patch.object(build_site,"ITEMS",[item]),patch.object(build_site,"MERCHANT_FEED_PATH",target),\
                    patch.object(build_site,"MERCHANT_FEED_EN_PATH",target_en):
                build_site.build_merchant_feed()
            root=ET.parse(target).getroot();ns={"g":"http://base.google.com/ns/1.0"}
            product=root.find("channel/item")
            self.assertIsNotNone(product)
            self.assertEqual(product.findtext("g:id",namespaces=ns),"13")
            self.assertIn("Knöpfe am Kragen fehlen",product.findtext("g:description",namespaces=ns))
            self.assertEqual(product.findtext("g:price",namespaces=ns),f'{item["price"]:.2f} EUR')
            self.assertEqual(product.findtext("g:link",namespaces=ns),"https://disorder119.com/artikel/13/")
            # Versand je Lieferland der Kasse: Deutschland zuerst, dann die EU.
            laender=[s.findtext("g:country",namespaces=ns) for s in product.findall("g:shipping",ns)]
            self.assertEqual(laender[0],"DE")
            self.assertEqual(len(laender),27)
            self.assertIn("FR",laender)
            # Englischer Feed: gleiche ID, englische Seite und englischer Titel.
            en=ET.parse(target_en).getroot().find("channel/item")
            self.assertEqual(en.findtext("g:id",namespaces=ns),"13")
            self.assertEqual(en.findtext("g:link",namespaces=ns),"https://disorder119.com/en/artikel/13/")
            self.assertTrue(en.findtext("g:title",namespaces=ns).endswith("– Pre-Owned"))
            self.assertEqual(len(en.findall("g:shipping",ns)),27)

if __name__=="__main__": unittest.main()
