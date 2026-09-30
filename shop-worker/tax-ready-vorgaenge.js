// Tax Ready 2026: abgeleitete, private Sichten fuer den Manager (Dataset v3).
//
// Hier wird nichts gespeichert und nichts veraendert. Alles entsteht beim
// Export aus den unveraenderten Rohdaten: Bestellungen, Zahlungsnachweise
// (TAX_DATASET_V2-Ledger), Versandwahl, Etiketten, Rechnungen, Audit und dem
// privaten Ledger. Deshalb ist jeder Export aus demselben Datenstand gleich,
// und ein wiederholter Export erzeugt keine Duplikate.
//
// Grundsaetze (siehe TAX_DATASET_V3.md):
//   * Umsatz nur aus einer belegten, abgeschlossenen Zahlung (capture).
//     Bestellung, Reservierung, offene PayPal-Seite oder Storno sind keiner.
//   * Kundenversand und eigener Etikettenaufwand bleiben getrennte Rohwerte.
//   * Eine Erstattung ueberschreibt nie die Originalrechnung; sie bekommt eine
//     eigene Korrektur-Referenz.
//   * Alle Rohzeitpunkte bleiben erhalten; das Steuerjahr entscheidet der
//     Manager anhand des tatsaechlichen Zu-/Abflusses. Nichts wird freigegeben.
import { bookDate } from './tax-dataset.js';

export const VORGANG_QUERIES = Object.freeze({
  inventory: 'SELECT id,item_id,article_no,status,catalog_status FROM inventory ORDER BY id',
  order_items: 'SELECT id,order_id,inventory_id,item_id,article_no,unit_price_cents,quantity FROM order_items ORDER BY id',
  shipping_choices: 'SELECT order_id,option_id,art,quelle,packlink_service_id,carrier,service_name,paket,preis_cents,laufzeit,created_at FROM order_versand ORDER BY order_id',
  shipments: 'SELECT id,order_id,carrier,service,tracking_number,status,shipped_at,delivered_at,created_at,updated_at FROM shipments ORDER BY id',
  // Ersetzte Entwuerfe und abgelehnte Kaeufe haben nie etwas gekostet.
  packlink_labels: "SELECT id,order_id,reference,service_id,carrier,service_name,paket,price_cents,state,tracking_number,created_at,updated_at FROM packlink_sendungen WHERE state NOT IN ('ERSETZT','KAUF_ABGELEHNT') ORDER BY id",
  dhl_labels: "SELECT id,order_id,product_id,state,price_cents,shipment_number,created_at,updated_at,paid_at FROM dhl_qr_marken WHERE state<>'ERSETZT' ORDER BY id",
  // Nur Betrags- und Zeitangaben, keine Personendaten.
  order_audit: "SELECT id,entity_id AS order_id,event_type,metadata_json,created_at FROM audit_events WHERE entity_type='order' AND event_type IN ('COUPON_RESERVED','COUPON_REDEEMED','ORDER_CANCELLED','ORDER_REFUNDED') ORDER BY created_at,id",
  invoice_meta: 'SELECT id,order_id,rechnungsnummer,ausgestellt_am,gesamt_cents,document_type,html_sha256,pruefsumme FROM rechnungen ORDER BY id',
});

// Etiketten-Zustaende -> ob Geld dafuer faellig ist. Spiegelt PHASEN in
// packlink.js (Test prueft, dass jeder Zustand dort hier einsortiert ist).
const PACKLINK_BEZAHLT = new Set([
  'PURCHASE_SUCCESS', 'CARRIER_PENDING', 'RETRY', 'CARRIER_KO', 'LABELS_KO', 'INTEGRATION_KO',
  'READY_TO_PRINT', 'READY_FOR_COLLECTION', 'COMPLETED', 'CARRIER_OK',
  'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED_TO_SENDER', 'INCIDENT',
]);
const PACKLINK_OFFEN = new Set(['AWAITING_COMPLETION', 'READY_TO_PURCHASE']);
const STORNIERT = new Set(['CANCELED', 'CANCELLED']);
const UNKLAR = new Set(['KAUF_LAEUFT', 'KAUF_UNKLAR']);

export function etikettZahlstatus(provider, state) {
  const s = String(state || '').toUpperCase();
  if (STORNIERT.has(s)) return 'VOIDED';
  if (provider === 'DHL') return s === 'PAYED' ? 'PAID' : 'UNPAID';
  if (UNKLAR.has(s)) return 'UNCLEAR';
  if (PACKLINK_BEZAHLT.has(s)) return 'PAID';
  if (PACKLINK_OFFEN.has(s)) return 'UNPAID';
  return 'UNCLEAR';
}

function jahrAus(timestamp) {
  const date = bookDate(timestamp);
  return date ? Number(date.slice(0, 4)) : null;
}

function metadata(row) {
  try { return JSON.parse(row?.metadata_json || '{}') || {}; } catch { return {}; }
}

function nachAuftrag(rows, key = 'order_id') {
  const map = new Map();
  for (const row of rows || []) {
    const id = row?.[key];
    if (id == null) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
}

function summe(rows, feld = 'amount_cents') {
  return rows.reduce((total, row) => total + Number(row[feld] || 0), 0);
}

function frueheste(werte) {
  const gueltig = werte.filter(w => w && Number.isFinite(Date.parse(w))).sort();
  return gueltig[0] || null;
}

// Status der Capture laut Anbieter-Nachweis (evidence_json der v2-Cash-Events).
function captureStatus(cashEvents) {
  const status = new Map();
  for (const e of cashEvents || []) {
    if (e.kind !== 'capture') continue;
    try { status.set(e.id, String(JSON.parse(e.evidence_json || '{}').status || '').toUpperCase()); }
    catch { status.set(e.id, ''); }
  }
  return status;
}

// Ein Vorgang je Shop-Bestellung: alle Rohzeitpunkte und Betraege getrennt.
// v2: die Tabellen aus TAX_DATASET_V2 (orders, payments, cash_events),
// ledger: das v2-Ledger (verifizierte und Alt-Nachweise, mit blocks).
export function buildSalesTransactions(v2, ledger, extra) {
  const itemsByOrder = nachAuftrag(extra.order_items);
  const paymentsByOrder = nachAuftrag(v2.payments);
  const ledgerByOrder = nachAuftrag(ledger);
  const auditByOrder = nachAuftrag(extra.order_audit);
  const statusByCapture = captureStatus(v2.cash_events);

  return (v2.orders || []).map(order => {
    const events = ledgerByOrder.get(order.id) || [];
    const gueltig = events.filter(e => !(e.blocks || []).length);
    const captures = gueltig.filter(e => e.kind === 'capture');
    const fees = gueltig.filter(e => e.kind === 'fee');
    const refunds = gueltig.filter(e => e.kind === 'refund');
    const audit = auditByOrder.get(order.id) || [];
    const coupon = audit.filter(a => a.event_type === 'COUPON_RESERVED').map(metadata).pop() || null;
    const couponEingeloest = audit.some(a => a.event_type === 'COUPON_REDEEMED');
    const rabatt = coupon && Number.isSafeInteger(Number(coupon.discountCents)) ? Number(coupon.discountCents) : 0;
    const storno = audit.find(a => a.event_type === 'ORDER_CANCELLED');
    const erste = captures.slice().sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)))[0];
    const brutto = summe(captures), gebuehr = summe(fees), erstattet = summe(refunds);
    let revenueState = 'NOT_PAID';
    if (!captures.length && order.status === 'CANCELLED') revenueState = 'CANCELLED_UNPAID';
    else if (captures.length && erstattet >= brutto) revenueState = 'REFUNDED_FULL';
    else if (captures.length && erstattet > 0) revenueState = 'REFUNDED_PARTIAL';
    else if (captures.length) revenueState = 'PAID';
    const jahre = [...new Set(gueltig.map(e => jahrAus(e.occurred_at)).filter(Boolean))].sort();

    return {
      order_id: order.id,
      order_number: order.order_number,
      status: order.status,
      items: (itemsByOrder.get(order.id) || []).map(i => ({
        order_item_id: i.id, item_id: i.item_id, inventory_id: i.inventory_id, article_no: i.article_no,
        unit_price_cents: Number(i.unit_price_cents || 0), quantity: Number(i.quantity || 1),
      })),
      timestamps: {
        order_created_at: order.created_at || null,
        payment_started_at: frueheste((paymentsByOrder.get(order.id) || []).map(p => p.created_at)),
        payment_completed_at: erste?.occurred_at || null,
        // PayPal schreibt eine abgeschlossene Capture sofort gut. Die spaetere
        // Auszahlung aufs Bankkonto ist ein ACCOUNT_TRANSFER, kein Zeitpunkt
        // dieses Vorgangs.
        provider_settled_at: erste && statusByCapture.get(erste.id) === 'COMPLETED' ? erste.occurred_at : null,
        refunded_at: refunds.map(r => r.occurred_at).filter(Boolean).sort(),
        cancelled_at: storno?.created_at || (order.status === 'CANCELLED' ? order.updated_at || null : null),
        cancelled_at_source: storno ? 'audit_event' : order.status === 'CANCELLED' ? 'order_updated_at' : null,
      },
      amounts_cents: {
        item_total: Number(order.subtotal_cents || 0) + rabatt,
        discount: rabatt,
        item_total_after_discount: Number(order.subtotal_cents || 0),
        customer_shipping: Number(order.shipping_cents || 0),
        order_total: Number(order.total_cents || 0),
        gross_paid: brutto,
        provider_fee: gebuehr,
        refund: erstattet,
        net_cash: brutto - gebuehr - erstattet,
      },
      coupon: coupon ? { discount_cents: rabatt, redeemed: couponEingeloest } : null,
      evidence: {
        captures: captures.map(e => e.id),
        fees: fees.map(e => e.id),
        refunds: refunds.map(e => e.id),
        blocked: events.filter(e => (e.blocks || []).length).map(e => e.id),
      },
      cash_years: jahre,
      counts_as_sale: captures.length > 0,
      revenue_state: revenueState,
      review_required: true,
    };
  });
}

// Versand je Bestellung: was die Kundschaft bezahlt hat und was der Shop fuer
// Etiketten ausgibt - nebeneinander, nie miteinander verrechnet.
export function buildShipping(v2, extra) {
  const wahl = new Map((extra.shipping_choices || []).map(row => [row.order_id, row]));
  const packlink = nachAuftrag(extra.packlink_labels);
  const dhl = nachAuftrag(extra.dhl_labels);
  const sendungen = nachAuftrag(extra.shipments);
  const rows = [];
  for (const order of v2.orders || []) {
    const labels = [
      ...(packlink.get(order.id) || []).map(l => ({
        provider: 'PACKLINK', id: l.id, reference: String(l.reference || '').startsWith('kauf-') ? null : l.reference,
        carrier: l.carrier || null, service: l.service_name || null, paket: l.paket || null,
        label_cost_cents: l.price_cents == null ? null : Number(l.price_cents), state: l.state,
        payment_state: etikettZahlstatus('PACKLINK', l.state), tracking_number: l.tracking_number || null,
        created_at: l.created_at, paid_at: null,
      })),
      ...(dhl.get(order.id) || []).map(l => ({
        provider: 'DHL', id: l.id, reference: l.shipment_number || null, carrier: 'DHL', service: l.product_id || null,
        paket: null, label_cost_cents: l.price_cents == null ? null : Number(l.price_cents), state: l.state,
        payment_state: etikettZahlstatus('DHL', l.state), tracking_number: l.shipment_number || null,
        created_at: l.created_at, paid_at: l.paid_at || null,
      })),
    ].map(label => ({
      ...label,
      // Storniertes Etikett: ob und wann das Porto zurueckkam, steht nur in der
      // Abrechnung des Anbieters - der Manager ordnet die Gutschrift zu.
      label_refund: label.payment_state === 'VOIDED' ? 'VOIDED_CHECK_PROVIDER_CREDIT' : null,
    })).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
    const choice = wahl.get(order.id) || null;
    const shipments = (sendungen.get(order.id) || []).map(s => ({
      id: s.id, carrier: s.carrier || null, service: s.service || null, tracking_number: s.tracking_number || null,
      status: s.status, shipped_at: s.shipped_at || null, delivered_at: s.delivered_at || null,
    }));
    if (!choice && !labels.length && !shipments.length && !Number(order.shipping_cents || 0)) continue;
    rows.push({
      order_id: order.id,
      order_number: order.order_number,
      order_status: order.status,
      customer_paid_shipping_cents: Number(order.shipping_cents || 0),
      customer_choice: choice ? {
        option_id: choice.option_id, art: choice.art, quelle: choice.quelle, carrier: choice.carrier || null,
        service: choice.service_name || null, paket: choice.paket, preis_cents: Number(choice.preis_cents || 0),
        laufzeit: choice.laufzeit || null, chosen_at: choice.created_at,
      } : null,
      labels,
      shipments,
      label_cost_paid_cents: summe(labels.filter(l => l.payment_state === 'PAID' && l.label_cost_cents != null), 'label_cost_cents'),
      label_cost_unclear: labels.some(l => l.payment_state === 'UNCLEAR' || (l.payment_state === 'PAID' && l.label_cost_cents == null)),
      note: 'Kundenversand und Etikettenkosten sind getrennte Rohwerte und wurden nicht verrechnet.',
    });
  }
  return rows;
}

// Erstattung -> eigene Korrektur-Referenz zur unveraenderten Originalrechnung.
export function buildInvoiceCorrections(v2, ledger, extra) {
  const rechnungen = nachAuftrag((extra.invoice_meta || []).filter(r => r.document_type === 'invoice'));
  const orders = new Map((v2.orders || []).map(o => [o.id, o]));
  return (ledger || []).filter(e => e.kind === 'refund').map(refund => {
    const original = (rechnungen.get(refund.order_id) || [])[0] || null;
    const amount = Number(refund.amount_cents || 0);
    return {
      id: `korrektur:${refund.provider_reference || refund.id}`,
      order_id: refund.order_id,
      order_number: orders.get(refund.order_id)?.order_number || refund.order_number || null,
      original_invoice: original ? {
        id: original.id, number: original.rechnungsnummer, issued_at: original.ausgestellt_am,
        total_cents: Number(original.gesamt_cents || 0), html_sha256: original.html_sha256 || null,
        text_sha256: original.pruefsumme || null,
      } : null,
      refund: {
        ledger_id: refund.id, provider: refund.provider || null, provider_reference: refund.provider_reference || null,
        amount_cents: amount, occurred_at: refund.occurred_at || null, source: refund.source,
        blocked: (refund.blocks || []).length > 0,
      },
      scope: original ? (amount >= Number(original.gesamt_cents || 0) ? 'FULL' : 'PARTIAL') : 'UNKNOWN',
      note: 'Die Originalrechnung bleibt unverändert. Diese Referenz dokumentiert die Erstattung dazu.',
    };
  });
}

// Eine stabile Artikel-ID (inventory.item_id = Katalog-ID) verbindet Einkauf,
// Verkauf, Zahlung, Erstattung, Versand und private Geldbewegungen.
export function buildItemLinks(v2, v3, extra, transactions, shipping) {
  const byItem = new Map();
  const eintrag = itemId => {
    const key = Number(itemId);
    if (!byItem.has(key)) byItem.set(key, {
      item_id: key, inventory_ids: new Set(), article_numbers: new Set(), purchases: [], orders: [],
      ledger_event_ids: [], shipping_label_ids: [],
    });
    return byItem.get(key);
  };
  const inventarZuArtikel = new Map();
  for (const inv of extra.inventory || []) {
    if (!Number.isSafeInteger(Number(inv.item_id))) continue;
    inventarZuArtikel.set(inv.id, Number(inv.item_id));
    const e = eintrag(inv.item_id);
    e.inventory_ids.add(inv.id);
    if (inv.article_no) e.article_numbers.add(inv.article_no);
  }
  for (const p of v3.purchase_items || []) {
    const itemId = Number.isSafeInteger(Number(p.item_id)) && p.item_id != null ? Number(p.item_id) : inventarZuArtikel.get(p.inventory_id);
    if (itemId == null) continue;
    const e = eintrag(itemId);
    if (p.inventory_id) e.inventory_ids.add(p.inventory_id);
    if (p.article_no) e.article_numbers.add(p.article_no);
    e.purchases.push({
      purchase_id: p.purchase_id, purchase_item_id: p.id,
      allocated_cost_cents: Number(p.allocated_item_price_cents || 0) + Number(p.allocated_shared_cost_cents || 0),
    });
  }
  const labelsByOrder = new Map(shipping.map(s => [s.order_id, s.labels.map(l => l.id)]));
  for (const t of transactions) {
    for (const item of t.items) {
      if (item.item_id == null) continue;
      const e = eintrag(item.item_id);
      if (item.inventory_id) e.inventory_ids.add(item.inventory_id);
      if (item.article_no) e.article_numbers.add(item.article_no);
      e.orders.push({
        order_id: t.order_id, order_number: t.order_number, status: t.status, revenue_state: t.revenue_state,
        unit_price_cents: item.unit_price_cents, capture_ids: t.evidence.captures, refund_ids: t.evidence.refunds,
      });
      e.shipping_label_ids.push(...(labelsByOrder.get(t.order_id) || []));
    }
  }
  for (const event of v3.ledger_events || []) {
    const itemId = inventarZuArtikel.get(event.inventory_id);
    if (itemId != null) eintrag(itemId).ledger_event_ids.push(event.id);
  }
  return [...byItem.values()]
    .sort((a, b) => a.item_id - b.item_id)
    .map(e => ({
      ...e,
      inventory_ids: [...e.inventory_ids].sort(),
      article_numbers: [...e.article_numbers].sort(),
      shipping_label_ids: [...new Set(e.shipping_label_ids)].sort(),
    }));
}

// Kleinunternehmer: Warnungen aus den erfassten Umsaetzen, nie eine
// Statusaenderung. Grenzen kommen ausschliesslich aus dem Steuerprofil des
// Jahres, das der Inhaber selbst pflegt.
export function smallBusinessCheck(tables, year, yearSummary) {
  const profile = (tables.tax_year_profiles || []).find(p => Number(p.tax_year) === Number(year)) || null;
  const umsatz = summary => summary.sale_income_cents + summary.other_income_cents - summary.refund_out_cents;
  const current = umsatz(yearSummary(year));
  const prior = umsatz(yearSummary(year - 1));
  const warnings = [];
  const ratio = Number(profile?.warning_ratio_basis_points || 8000);
  if (profile && profile.vat_mode === 'KLEINUNTERNEHMER') {
    const priorLimit = Number(profile.prior_year_limit_cents || 0);
    const currentLimit = Number(profile.current_year_limit_cents || 0);
    if (priorLimit && prior > priorLimit) {
      warnings.push({ code: 'SMALL_BUSINESS_PRIOR_YEAR_LIMIT_EXCEEDED', reference: String(year), message: 'Erfasster Vorjahresumsatz liegt über der eingetragenen Vorjahresgrenze. Status für dieses Jahr prüfen – er wird nicht automatisch geändert.' });
    }
    if (currentLimit && current > currentLimit) {
      warnings.push({ code: 'SMALL_BUSINESS_LIMIT_EXCEEDED', reference: String(year), message: 'Erfasster Umsatz liegt über der eingetragenen Jahresgrenze. Steuerliche Folgen prüfen – der Status wird nicht automatisch geändert.' });
    } else if (currentLimit && current * 10000 >= currentLimit * ratio) {
      warnings.push({ code: 'SMALL_BUSINESS_LIMIT_WARNING', reference: String(year), message: 'Erfasster Umsatz erreicht die Warnschwelle der eingetragenen Jahresgrenze.' });
    }
    if (!priorLimit || !currentLimit) {
      warnings.push({ code: 'SMALL_BUSINESS_LIMITS_NOT_CONFIGURED', reference: String(year), message: 'Umsatzgrenzen im Steuerprofil des Jahres eintragen, damit Warnungen möglich sind.' });
    }
  }
  return {
    tax_year: Number(year),
    vat_mode: profile?.vat_mode || 'UNKNOWN',
    confirmed: Number(profile?.confirmed || 0) === 1,
    recorded_turnover_cents: current,
    prior_year_recorded_turnover_cents: prior,
    prior_year_limit_cents: profile?.prior_year_limit_cents ?? null,
    current_year_limit_cents: profile?.current_year_limit_cents ?? null,
    warning_ratio_basis_points: ratio,
    warnings,
    note: 'Umsatz = erfasste Zuflüsse (Verkäufe + sonstige Einnahmen − Erstattungen) aus Shop-Nachweisen und privatem Ledger, ohne Kontotransfers und Einlagen. Keine automatische Statusänderung, keine steuerliche Freigabe.',
  };
}

// Pruefungen, die erst mit den abgeleiteten Sichten moeglich sind.
export function vorgangIssues(transactions, shipping, corrections, ledgerEvents) {
  const issues = [];
  const versandGebucht = new Set((ledgerEvents || [])
    .filter(e => e.event_type === 'SHIPPING_EXPENSE' && e.order_id)
    .map(e => e.order_id));
  for (const s of shipping) {
    if (s.label_cost_paid_cents > 0 && !versandGebucht.has(s.order_id)) {
      issues.push({ code: 'SHIPPING_LABEL_EXPENSE_UNBOOKED', reference: s.order_id, message: 'Bezahltes Versandetikett ohne verknüpfte Versandausgabe; Packlink-/DHL-Abrechnung als SHIPPING_EXPENSE mit dieser Bestellung erfassen.' });
    }
    if (s.label_cost_unclear) {
      issues.push({ code: 'SHIPPING_LABEL_COST_UNCLEAR', reference: s.order_id, message: 'Etikettenkauf ohne klaren Zahlstatus oder Preis; in Packlink/DHL prüfen.' });
    }
  }
  for (const c of corrections) {
    if (!c.original_invoice) {
      issues.push({ code: 'REFUND_WITHOUT_ORIGINAL_INVOICE', reference: c.order_id, message: 'Erstattung ohne archivierte Originalrechnung; Korrektur-Referenz kann nicht zugeordnet werden.' });
    }
  }
  for (const t of transactions) {
    if (t.counts_as_sale && t.amounts_cents.gross_paid !== t.amounts_cents.order_total) {
      issues.push({ code: 'PAID_AMOUNT_DIFFERS_FROM_ORDER', reference: t.order_id, message: 'Belegte Zahlung weicht vom Bestellbetrag ab; Rohwerte prüfen.' });
    }
  }
  return issues;
}
