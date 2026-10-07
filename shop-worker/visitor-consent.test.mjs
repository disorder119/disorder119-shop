import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const script=fs.readFileSync(new URL('../assets/besucher.js',import.meta.url),'utf8');

function page(stored=null,hash='') {
  const callbacks={},nodes=[],network=[],reads=[],store=new Map();
  if(stored) store.set('d119_analytics_consent_v1',JSON.stringify(stored));
  store.set('disorder119_cart','["119"]');
  const listener=(name,fn)=>{(callbacks[name] ||= []).push(fn);};
  function node(tag) {const n={tag,children:[],style:{},appendChild(x){this.children.push(x);return x;},append(...xs){this.children.push(...xs);},setAttribute(){},addEventListener(name,fn){this[name]=fn;},remove(){this.removed=true;}};nodes.push(n);return n;}
  const localStorage={getItem(key){reads.push(key);return store.get(key)||null;},setItem(key,val){store.set(key,val);},removeItem(key){store.delete(key);}};
  const document={documentElement:{lang:'de',getAttribute(){return 'de';}},referrer:'',body:node('body'),createElement:node,addEventListener:listener,visibilityState:'visible'};
  const window={SHOP_CONFIG:{shopWorkerUrl:'https://api.disorder119.com'},localStorage,addEventListener:listener};
  const context={window,document,location:{hash,pathname:'/'},history:{pushState(){}},navigator:{},Date,Blob,setTimeout:fn=>fn(),fetch:(url,init)=>{network.push({url,body:JSON.parse(init.body)});return Promise.resolve();}};
  vm.runInNewContext(script,context);
  return {nodes,network,reads,window,document,store,fire:(name,event={})=>(callbacks[name]||[]).forEach(fn=>fn(event))};
}
test('no opt-in means no statistics or cart-storage reads, including clicks and unload',()=>{
  const p=page();
  p.fire('click',{target:{closest(){return null;}}});p.fire('pagehide');p.fire('d119:artikel',{detail:{id:119}});
  assert.equal(p.network.length,0);assert.equal(p.reads.includes('disorder119_cart'),false);
  const choices=p.nodes.filter(n=>n.tag==='button');
  assert.ok(choices.some(n=>n.textContent==='Nur notwendige'));assert.ok(choices.some(n=>n.textContent==='Statistik erlauben'));
});
test('consent starts statistics, revocation stops every later event and cart read',()=>{
  const p=page();p.nodes.find(n=>n.textContent==='Statistik erlauben').click();
  assert.equal(p.network.length,1);assert.equal(p.network[0].body.consentVersion,1);
  p.fire('d119:artikel',{detail:{id:119}});assert.equal(p.network.length,2);
  p.window.D119Privacy.open();
  p.nodes.filter(n=>n.textContent==='Nur notwendige').at(-1).click();
  const before=p.reads.filter(k=>k==='disorder119_cart').length;
  p.fire('click',{target:{closest(){return null;}}});p.fire('pagehide');p.fire('d119:artikel',{detail:{id:119}});
  assert.equal(p.network.length,2);assert.equal(p.reads.filter(k=>k==='disorder119_cart').length,before);
});
test('expired consent does not restart collection',()=>{
  const p=page({version:1,allowed:true,at:Date.now()-181*86400000});
  assert.equal(p.network.length,0);assert.equal(p.reads.includes('disorder119_cart'),false);
});
test('the consented start event is marked so the server-side page count is not doubled',()=>{
  const p=page();p.nodes.find(n=>n.textContent==='Statistik erlauben').click();
  assert.equal(p.network[0].body.t,'seite');assert.equal(p.network[0].body.s,1);
  p.fire('d119:artikel',{detail:{id:119}});
  assert.equal(p.network[1].body.t,'artikel');assert.equal(p.network[1].body.s,undefined);
});
test('#nicht-zaehlen also sets the objection cookie for the server count, #zaehlen removes it',()=>{
  const aus=page(null,'#nicht-zaehlen');
  assert.equal(aus.store.get('d119_nicht_zaehlen'),'1');
  assert.match(aus.document.cookie,/^d119_nicht_zaehlen=1; Max-Age=31536000; Path=\/; Secure; SameSite=Lax$/);
  assert.equal(aus.network.length,0);assert.equal(aus.nodes.filter(n=>n.tag==='button').length,0);
  const an=page(null,'#zaehlen');
  assert.equal(an.store.has('d119_nicht_zaehlen'),false);
  assert.match(an.document.cookie,/^d119_nicht_zaehlen=; Max-Age=0;/);
  const normal=page();
  assert.equal(normal.document.cookie,undefined,'no cookie without an explicit request');
});
