// Synthetic cross-language fixture. Contains no real orders or customer data.
import { sqliteD1, allMigrations } from './test-d1.mjs';
import { captureStatements, recordVerifiedRefund } from './tax-evidence.js';
export async function taxFixture() {
  const DB=sqliteD1(allMigrations());
  DB.raw.exec(`INSERT INTO commerce_orders(id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
    VALUES('o1','TEST-2025-001','PAID','EUR',9500,500,10000,'test-order','2025-12-30T12:00:00Z');
    INSERT INTO payments(id,order_id,provider,provider_order_id,provider_payment_id,status,amount_cents,currency,idempotency_key,created_at)
    VALUES('p1','o1','PAYPAL','PP-ORDER','PP-CAPTURE','COMPLETED',10000,'EUR','test-payment','2025-12-30T12:00:00Z');
    INSERT INTO inventory(id,item_id,article_no,updated_at)VALUES('i1',1,'TEST-1','2025-12-30');
    INSERT INTO order_items(id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents,quantity,currency)
    VALUES('oi1','o1','i1',1,'TEST-1','Testjacke',9500,1,'EUR');`);
  const capture={id:'PP-CAPTURE',status:'COMPLETED',amount:{value:'100.00',currency_code:'EUR'},create_time:'2025-12-31T23:30:00Z',
    seller_receivable_breakdown:{paypal_fee:{value:'3.20',currency_code:'EUR'}}};
  await DB.batch(await captureStatements(DB,{id:'p1',commerce_order_id:'o1'},capture,'2026-01-01T00:30:05Z'));
  await recordVerifiedRefund({DB},{resource:{id:'PP-REFUND',status:'COMPLETED',amount:{value:'20.00',currency_code:'EUR'},
    create_time:'2026-02-01T10:00:00Z',supplementary_data:{related_ids:{capture_id:'PP-CAPTURE'}}}});
  return {DB,capture};
}
