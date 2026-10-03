import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1,allMigrations} from './test-d1.mjs';
import {listPrivacyRequests, updatePrivacyRequest, privacyDeadline, handleAdminPrivacy} from './admin-privacy.js';

function fixture() {
  const DB=sqliteD1(allMigrations());
  DB.raw.exec(`INSERT INTO customers(id,email_normalized,status,created_at) VALUES('c','customer@example.test','DELETION_PENDING','2025-01-01');
    INSERT INTO customer_addresses(id,customer_id,recipient_name,address_line1,postal_code,city,country_code,created_at)
      VALUES('a','c','Test','Street 1','12345','Test','DE','2025-01-01');
    INSERT INTO customer_sessions(id,customer_id,created_at,expires_at) VALUES('s','c','2025-01-01','2030-01-01');
    INSERT INTO commerce_orders(id,order_number,customer_id,status,subtotal_cents,total_cents,idempotency_key,created_at) VALUES('o','SYNTHETIC-RETAIN','c','CANCELLED',100,100,'synthetic-retain','2025-01-01');
    INSERT INTO order_contact_snapshots(order_id,source_provider,email,captured_at) VALUES('o','PAYPAL','customer@example.test','2025-01-01');
    INSERT INTO order_confirmation_archive(order_id,subject,html,text,html_sha256,text_sha256,invoice_json,created_at) VALUES('o','Test','Test','Test','hash','hash','{}','2025-01-01');
    INSERT INTO account_privacy_requests(id,customer_id,request_type,status,requested_at) VALUES('r','c','DELETE','REQUESTED','2025-01-31T12:00:00.000Z');`);
  return {DB};
}
test('privacy deadlines use calendar months including leap years',()=>{
  assert.equal(privacyDeadline('2025-01-31T12:00:00Z'),'2025-02-28T12:00:00.000Z');
  assert.equal(privacyDeadline('2024-01-31T12:00:00Z'),'2024-02-29T12:00:00.000Z');
  assert.equal(privacyDeadline('bad'),null);
});
test('requests remain open until a documented response and explicit confirmation exist',async()=>{
  const env=fixture();
  assert.equal((await listPrivacyRequests(env))[0].overdue,true);
  await assert.rejects(updatePrivacyRequest(env,{id:'r',action:'complete'}),{code:'PRIVACY_RESPONSE_REQUIRED'});
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM customer_addresses').get().n,1);
  await updatePrivacyRequest(env,{id:'r',action:'process'});
  assert.equal((await listPrivacyRequests(env))[0].status,'PROCESSING');
});
test('owner-confirmed completion deletes optional account data without deleting business tables',async()=>{
  const env=fixture();
  const tables=['commerce_orders','order_contact_snapshots','order_items','payments','order_confirmation_archive'];
  const snapshot=env.DB.raw.prepare('SELECT * FROM order_confirmation_archive').get();
  const before=tables.map(t=>env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
  await updatePrivacyRequest(env,{id:'r',action:'complete',confirm:true,responseNote:'Response delivered with business-record retention explanation.',responseSentAt:new Date().toISOString()});
  assert.equal((await listPrivacyRequests(env))[0].status,'COMPLETED');
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM customer_addresses').get().n,0);
  assert.equal(env.DB.raw.prepare('SELECT email_normalized FROM customers').get().email_normalized,null);
  assert.deepEqual(env.DB.raw.prepare('SELECT * FROM order_confirmation_archive').get(),snapshot);
  assert.deepEqual(tables.map(t=>env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n),before);
  await assert.rejects(updatePrivacyRequest(env,{id:'r',action:'complete',confirm:true}),{code:'PRIVACY_REQUEST_CLOSED'});
});
test('privacy API rejects unauthenticated and foreign-origin requests',async()=>{
  const env=fixture(),url=new URL('https://api.disorder119.com/admin/privacy/requests');
  for(const origin of ['https://admin.disorder119.com','https://evil.example']){
    const response=await handleAdminPrivacy(new Request(url,{headers:{Origin:origin}}),env,url);
    assert.ok([401,403,503].includes(response.status));
    assert.equal(Object.hasOwn(await response.json(),'requests'),false);
  }
});

test('read-only admin scope cannot delete account data',async()=>{
  const env=fixture();
  const scoped=Object.create(env);
  scoped.ADMIN_TOKEN='scoped-test-token';scoped.ADMIN_AUTH_CONTEXT={role:'READER'};
  const url=new URL('https://api.disorder119.com/admin/privacy/requests');
  const response=await handleAdminPrivacy(new Request(url,{method:'POST',headers:{Origin:'https://admin.disorder119.com',Authorization:'Bearer scoped-test-token','Content-Type':'application/json'},body:JSON.stringify({id:'r',action:'process'})}),scoped,url);
  assert.equal(response.status,403);
  assert.equal((await listPrivacyRequests(env))[0].status,'REQUESTED');
});
