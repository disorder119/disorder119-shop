"""Merchant single-item shipping from the checkout's shared configuration."""
from decimal import Decimal
import re

SIZES = ('S', 'M', 'L', 'XL', 'XXL')


def package_for_item(item, config):
    shipping = config['versand']
    estimate = shipping['schaetzung']
    base = (estimate.get('nachProdukttyp', {}).get(str(item.get('product_type') or ''))
            or estimate.get('nachKategorie', {}).get(str(item.get('taxonomy_category') or item.get('category') or ''))
            or estimate['standard'])
    heavy = estimate.get('schwer') or {}
    factor = heavy.get('faktor', 1) if heavy.get('muster') and re.search(heavy['muster'], str(item.get('title') or ''), re.I) else 1
    weight = estimate.get('verpackungKg', 0.4) + base['kg'] * factor
    volume = base['liter'] * factor
    for size in SIZES:
        package = shipping['pakete'][size]
        if weight <= package['gewichtKg'] + 1e-9 and (not package.get('maxLiter') or volume <= package['maxLiter']):
            return size
    return SIZES[-1]


def merchant_shipping_cents(item, config):
    """Return the cheapest configured standard price; None for dynamic providers."""
    shipping = config['versand']
    if shipping.get('quelle') != 'fest':
        return None
    value = int(Decimal(str(item.get('price') or 0)) * 100)
    size = package_for_item(item, config)
    prices = [tariff['preise'][size] for tariff in shipping.get('tarife', {}).get('liste', [])
              if tariff.get('art') == 'standard' and value >= tariff.get('abWarenwertCents', 0)]
    if not prices:
        raise ValueError('Kein fester Standardtarif für Merchant-Artikel.')
    free = (shipping.get('versandkostenfrei') or {}).get('abCents')
    return 0 if free and value >= free else min(prices)
