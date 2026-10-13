import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRequestBodySize, guardRuntimeRequest } from './backend-runtime.js';

test('public rate-limit rejection happens before reading a request body or database', async () => {
  const calls=[];
  const request=new Request('https://api.disorder119.com/site-unlock', {method:'POST',body:'{}',headers:{'CF-Connecting-IP':'192.0.2.1'}});
  request.clone=()=>{throw new Error('body should not be read');};
  const env={RATE_LIMITER:{limit:async value=>{calls.push(value);return {success:false};}}};
  await assert.rejects(()=>guardRuntimeRequest(request,env),error=>error.code==='RATE_LIMITED'&&error.status===429);
  assert.equal(calls[0].key,'body-ingress:192.0.2.1');
});

test('slow bodies have a total read deadline even below the byte limit', async () => {
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1]));}});
  const request=new Request('https://api.disorder119.com/site-unlock',{method:'POST',body:stream,duplex:'half'});
  await assert.rejects(()=>assertRequestBodySize(request,32768,10),error=>error.code==='REQUEST_BODY_TIMEOUT'&&error.status===408);
});

test('normal checkout JSON remains accepted; streamed oversized bodies fail', async () => {
  await assertRequestBodySize(new Request('https://api.disorder119.com/create-order',{method:'POST',body:'{"items":[1]}'}));
  const request=new Request('https://api.disorder119.com/create-order',{method:'POST',body:'x'.repeat(32769)});
  await assert.rejects(()=>assertRequestBodySize(request),error=>error.code==='REQUEST_TOO_LARGE'&&error.status===413);
});

test('provider callbacks do not share the public browser write bucket', async () => {
  const request=new Request('https://api.disorder119.com/paypal-webhook',{method:'POST',body:'{}'});
  await guardRuntimeRequest(request,{RATE_LIMITER:{limit:async()=>{throw new Error('callback used browser limiter');}}});
});
