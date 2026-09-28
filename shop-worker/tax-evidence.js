// Only called after a provider response/signature has been verified.
export async function sha256(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function decimalCents(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(value??''))) return null;
  const [whole,part='']=String(value).split('.');
  const n=Number(whole)*100+Number(part.padEnd(2,'0'));
  return Number.isSafeInteger(n)?n:null;
}
export function providerDate(value) {
  const s=String(value||'');
  return /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s)&&Number.isFinite(Date.parse(s))?new Date(s).toISOString():null;
}
export async function cashStatement(db,{paymentId,orderId,kind,reference,amount,currency,occurredAt,observedAt,evidence}) {
  if (!reference || !Number.isSafeInteger(amount) || amount<=0 || currency!=='EUR') throw new Error('INVALID_TAX_CASH_EVIDENCE');
  const id=`paypal:${kind}:${reference}`;const hash=await sha256(JSON.stringify(evidence));
  const old=await db.prepare('SELECT * FROM tax_cash_events WHERE id=?').bind(id).first();
  if (old && (old.payment_id!==paymentId||old.order_id!==orderId||old.amount_cents!==amount||old.currency!==currency||old.occurred_at!==providerDate(occurredAt))) throw new Error('CONFLICTING_TAX_CASH_EVIDENCE');
  return db.prepare(`INSERT OR IGNORE INTO tax_cash_events
    (id,payment_id,order_id,kind,provider,provider_reference,amount_cents,currency,occurred_at,observed_at,evidence_hash,evidence_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,paymentId,orderId,kind,'PAYPAL',reference,amount,currency,providerDate(occurredAt),observedAt,hash,JSON.stringify(evidence));
}
export async function captureStatements(db,payment,capture,observedAt) {
  const amount=decimalCents(capture?.amount?.value);
  const base={paymentId:payment.id,orderId:payment.commerce_order_id,reference:String(capture?.id||''),currency:capture?.amount?.currency_code,occurredAt:capture?.create_time,observedAt};
  const evidence={id:base.reference,status:capture.status,amount:capture.amount,create_time:capture.create_time||null};
  const statements=[await cashStatement(db,{...base,kind:'capture',amount,evidence})];
  const fee=capture.seller_receivable_breakdown?.paypal_fee;
  if (fee && decimalCents(fee.value)>0 && fee.currency_code===base.currency) statements.push(await cashStatement(db,{...base,kind:'fee',amount:decimalCents(fee.value),evidence:{...evidence,paypal_fee:fee}}));
  return statements;
}
export async function recordVerifiedRefund(env,event) {
  const r=event.resource||{};
  if (String(r.status||'').toUpperCase()!=='COMPLETED') throw new Error('REFUND_NOT_COMPLETED');
  const captureId=r.supplementary_data?.related_ids?.capture_id || (r.links||[]).map(x=>String(x.href||'')).map(x=>/\/v2\/payments\/captures\/([^/?]+)/.exec(x)?.[1]).find(Boolean);
  if (!captureId) throw new Error('REFUND_CAPTURE_REFERENCE_MISSING');
  const payment=await env.DB.prepare("SELECT id,order_id FROM payments WHERE provider='PAYPAL' AND provider_payment_id=?").bind(captureId).first();
  if (!payment) throw new Error('REFUND_PAYMENT_NOT_FOUND');
  const statement=await cashStatement(env.DB,{paymentId:payment.id,orderId:payment.order_id,kind:'refund',reference:String(r.id||''),amount:decimalCents(r.amount?.value),currency:r.amount?.currency_code,occurredAt:r.create_time,observedAt:new Date().toISOString(),evidence:{id:r.id,capture_id:captureId,status:r.status,amount:r.amount,create_time:r.create_time||null}});
  await statement.run();
}
