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
            with patch.object(build_site,"ITEMS",[item]),patch.object(build_site,"MERCHANT_FEED_PATH",target):
                build_site.build_merchant_feed()
            root=ET.parse(target).getroot();ns={"g":"http://base.google.com/ns/1.0"}
            product=root.find("channel/item")
            self.assertIsNotNone(product)
            self.assertEqual(product.findtext("g:id",namespaces=ns),"13")
            self.assertIn("Knöpfe am Kragen fehlen",product.findtext("g:description",namespaces=ns))
            self.assertEqual(product.findtext("g:price",namespaces=ns),f'{item["price"]:.2f} EUR')
            self.assertEqual(product.findtext("g:link",namespaces=ns),"https://disorder119.com/artikel/13/")

if __name__=="__main__": unittest.main()
