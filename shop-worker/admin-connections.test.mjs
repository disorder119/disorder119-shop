import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionSnapshot, handleAdminSystem } from './admin-system.js';

test('configuration snapshot is bounded, honest and contains no credentials or personal values',()=>{
  const secret='NEVER_RETURN_THIS';
  const data=connectionSnapshot({DB:{},GITHUB_TOKEN:secret,PAYPAL_CLIENT_ID:secret,PAYPAL_ENVIRONMENT:'live',
    MAIL_API_KEY:secret,TELEGRAM_BOT_TOKEN:secret,TELEGRAM_CHAT_ID:secret,MAIL_FROM:'private@example.test',
    DHL_PRIVAT_API_KEY:secret,DHL_PRIVAT_ENVIRONMENT:'live',PACKLINK_WEBHOOK_TOKEN:secret});
  assert.equal(data.services.api.state,'reachable');
  assert.equal(data.services.paypal.state,'partial');
  assert.equal(data.services.paypal.webhook,false);
  assert.equal(data.services.paypal.environment,'live');
  assert.equal(data.services.github.state,'configured');
  assert.equal(data.services.newsletter.state,'partial');
  assert.equal(data.services.turnstile.state,'missing');
  assert.equal(data.services.dhl.state,'configured');
  assert.ok(!JSON.stringify(data).includes(secret));
  assert.ok(!JSON.stringify(data).includes('private@example.test'));
  assert.ok(JSON.stringify(data).length<1800);
});

test('authenticated read never invokes database or third-party services; missing DB can be reported',async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=()=>assert.fail('provider calls must not occur');
  const url=new URL('https://api.disorder119.com/admin/connections');
  const env={ADMIN_TOKEN:'test',DB:{prepare(){assert.fail('no SQL for connection snapshot');}}};
  const read=(headers={},method='GET')=>handleAdminSystem(new Request(url,{method,headers}),env,url,'test','https://admin.disorder119.com');
  try {
    assert.equal((await read()).status,401);
    const response=await read({Authorization:'Bearer test'});
    assert.equal(response.status,200);
    assert.match(response.headers.get('Cache-Control'),/no-store/);
    assert.equal((await response.json()).schema,'connections-v1');
    assert.equal((await read({Authorization:'Bearer test'},'POST')).status,405);
    delete env.DB;
    assert.equal((await (await read({Authorization:'Bearer test'})).json()).services.database.state,'missing');
    const denied=await handleAdminSystem(new Request(url,{headers:{Authorization:'Bearer test'}}),env,url,'test','https://foreign.test');
    assert.equal(denied.status,403);
  } finally {globalThis.fetch=previous;}
});
