import unittest
from browser_product_selection import rental_item_id


class RentalSelection(unittest.TestCase):
    def test_rental_uses_internal_id_and_an_available_priced_item(self):
        items=[dict(id=8001,url_slug='1',public_status='SOLD',price=60),
               dict(id=8002,url_slug='2',public_status='AVAILABLE',price=0),
               dict(id=8003,url_slug='3',public_status='AVAILABLE',price=75)]
        self.assertEqual(rental_item_id(items),8003)

    def test_no_eligible_item_fails_instead_of_testing_an_unrelated_number(self):
        with self.assertRaises(AssertionError):rental_item_id([dict(id=9000,url_slug='23',public_status='DRAFT',price=20)])


if __name__=='__main__':unittest.main()
