"""Merchant single-item shipping from the checkout's shared configuration."""
from decimal import Decimal
import re

SIZES = ('S', 'M', 'L', 'XL', 'XXL')

# Bearbeitungszeit wie shop-worker/lieferzeit.js (AGB § 4): fruehestens am
# naechsten Werktag versendet, spaetestens am dritten (VERSAND_WERKTAGE).
HANDLING_DAYS = (1, 3)


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


def _value_cents(item):
    return int(Decimal(str(item.get('price') or 0)) * 100)


def _zones(shipping):
    """Liefergebiet der Kasse (versand.zonen); ohne Zonen nur Deutschland."""
    zones = {key: zone for key, zone in (shipping.get('zonen') or {}).items() if isinstance(zone, dict)}
    return zones or {'DE': {'laender': ['DE']}}


def _cheapest_standard(item, shipping, zone_key):
    """Guenstigster Standardtarif der Zone wie versand.js (festeOptionen +
    versandkostenfreiAnwenden): Tarife ab/bis Warenwert, versandkostenfrei
    nur in den Zonen von versand.versandkostenfrei. (tarif, cents) oder None."""
    value = _value_cents(item)
    size = package_for_item(item, {'versand': shipping})
    candidates = [tariff for tariff in shipping.get('tarife', {}).get('liste', [])
                  if tariff.get('art') == 'standard' and tariff.get('zone', 'DE') == zone_key
                  and value >= tariff.get('abWarenwertCents', 0)
                  and not (tariff.get('bisWarenwertCents') and value > tariff['bisWarenwertCents'])]
    if not candidates:
        return None
    tariff = min(candidates, key=lambda t: (t['preise'][size], str(t.get('id', ''))))
    free = shipping.get('versandkostenfrei') or {}
    if free.get('abCents') and value >= free['abCents'] and zone_key in (free.get('zonen') or ['DE']):
        return tariff, 0
    return tariff, tariff['preise'][size]


def merchant_shipping_cents(item, config):
    """Return the cheapest configured standard price; None for dynamic providers."""
    shipping = config['versand']
    if shipping.get('quelle') != 'fest':
        return None
    found = _cheapest_standard(item, shipping, 'DE')
    if not found:
        raise ValueError('Kein fester Standardtarif für Merchant-Artikel.')
    return found[1]


def merchant_shipping_entries(item, config):
    """Ein g:shipping-Eintrag je Lieferland der Kasse (Deutschland + EU, seit
    28.10.2026): Land, Dienst, Preis in Cent, Bearbeitungs- und Laufzeit in
    Werktagen. Die Laufzeit kommt je Land aus versand.zonen.<Zone>.laufzeitTage,
    sonst aus dem Tarif. Leer bei dynamischen Anbietern (Packlink)."""
    shipping = config['versand']
    if shipping.get('quelle') != 'fest':
        return []
    entries = []
    for zone_key, zone in _zones(shipping).items():
        found = _cheapest_standard(item, shipping, zone_key)
        if not found:
            continue
        tariff, cents = found
        transit_by_country = zone.get('laufzeitTage') or {}
        for country in zone.get('laender') or []:
            span = transit_by_country.get(country)
            if not span and tariff.get('laufzeitTage'):
                span = [tariff['laufzeitTage'], tariff['laufzeitTage']]
            entries.append({
                'country': country,
                'service': tariff.get('titel') or 'DHL',
                'cents': cents,
                'min_handling_time': HANDLING_DAYS[0],
                'max_handling_time': HANDLING_DAYS[1],
                'min_transit_time': span[0] if span else None,
                'max_transit_time': span[1] if span else None,
            })
    # Deutschland zuerst (wie lieferlaender() im Worker), dann alphabetisch.
    entries.sort(key=lambda e: (e['country'] != 'DE', e['country']))
    return entries
