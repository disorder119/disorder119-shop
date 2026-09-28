import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DOCUMENT_LOGO} from './document-branding.js';
import {renderInvoice} from './tax-invoice.js';
const profile={mode:'small_business',confirmed:true,tax_number:'DEMO',seller:{name:'Muster',street:'Musterweg 1',city:'12345 Test',country:'DE'}};
const order={order_number:'DEMO',currency:'EUR',subtotal_cents:1000,shipping_cents:0,total_cents:1000,created_at:'2025-11-01',contact:{recipient_name:'Test',address_line1:'Testweg 2',postal_code:'12345',city:'Test',country_code:'DE'},items:[{article_no:'#0123',title_snapshot:'Shop <Jacke>',quantity:1,unit_price_cents:1000}]};
test('invoice embeds exact logo offline and preserves original shop title and internal number',()=>{
 assert.equal(createHash('sha256').update(Buffer.from(DOCUMENT_LOGO.split(',')[1],'base64')).digest('hex'),'7f68c0bc0cc49df50271b3b9e8584b2004aa382f0921130afb646be42a0be333');
 const i=renderInvoice(order,profile,'2025-11-01T12:00:00Z');assert.equal(i.ready,true);assert.ok(i.html.includes(DOCUMENT_LOGO));assert.match(i.html,/Shop &lt;Jacke&gt;/);assert.match(i.html,/Interne Artikel-Nr. #0123/);assert.doesNotMatch(i.html,/##0123/);assert.match(i.text,/#0123/);
});
test('missing internal number or shop name leaves document a draft',()=>{
 for(const patch of [{article_no:''},{article_no:'#'},{title_snapshot:' '}]){const i=renderInvoice({...order,items:[{...order.items[0],...patch}]},profile);assert.equal(i.ready,false);assert.match(i.html,/ENTWURF/);}
});
