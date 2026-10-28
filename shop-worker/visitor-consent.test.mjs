import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const script=fs.readFileSync(new URL('../assets/besucher.js',import.meta.url),'utf8');

function page(stored=null,hash='',shared=null) {
  const callbacks={},nodes=[],network=[],reads=[],store=shared||new Map();
  if(stored) store.set('d119_analytics_consent_v1',JSON.stringify(stored));
  store.set('disorder119_cart','["119"]');
  const listener=(name,fn)=>{(callbacks[name] ||= []).push(fn);};
  function node(tag) {const n={tag,children:[],style:{},appendChild(x){this.children.push(x);return x;},append(...xs){this.children.push(...xs);},setAttribute(){},addEventListener(name,fn){this[name]=fn;},remove(){this.removed=true;}};nodes.push(n);return n;}
  const localStorage={getItem(key){reads.push(key);return store.get(key)||null;},setItem(key,val){store.set(key,val);},removeItem(key){store.delete(key);}};
  const document={documentElement:{lang:'de',getAttribute(){return 'de';}},referrer:'',body:node('body'),createElement:node,addEventListener:listener,visibilityState:'visible',getElementById(){return null;}};
  const window={SHOP_CONFIG:{shopWorkerUrl:'https://api.disorder119.com'},localStorage,addEventListener:listener};
  const context={window,document,location:{hash,pathname:'/',origin:'https://disorder119.com',href:'https://disorder119.com/'},URL,history:{pushState(){}},navigator:{},Date,Blob,setInterval:()=>1,clearInterval(){},setTimeout:fn=>fn(),fetch:(url,init)=>{network.push({url,body:JSON.parse(init.body)});return Promise.resolve();}};
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
  assert.equal(p.network.length,1);assert.equal(p.network[0].body.consentVersion,2);
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

// Version 2 (28.10.2026): Besuchszahl im Browser-Speicher, Abschied fuer die Zusammenfassung.
test('an earlier consent (version 1) does not cover the visit count: ask again and collect nothing',()=>{
  const p=page({version:1,allowed:true,at:Date.now()-1000});
  assert.equal(p.network.length,0);
  assert.ok(p.nodes.some(n=>n.textContent==='Statistik erlauben'),'banner is shown again');
  assert.equal(p.store.has('d119_besuche_v1'),false);
});
test('an earlier refusal (version 1) stays respected without a new banner',()=>{
  const p=page({version:1,allowed:false,at:Date.now()-1000});
  assert.equal(p.network.length,0);
  assert.equal(p.nodes.filter(n=>n.tag==='section').length,0);
});
test('with consent the browser stores only a visit count and two dates, and sends them with the start event',()=>{
  const p=page();p.nodes.find(n=>n.textContent==='Statistik erlauben').click();
  const start=p.network[0].body;
  assert.equal(start.wn,1);assert.match(start.we,/^\d{4}-\d{2}-\d{2}$/);assert.equal(start.wv,undefined);
  const gespeichert=JSON.parse(p.store.get('d119_besuche_v1'));
  assert.deepEqual(Object.keys(gespeichert).sort(),['erster','n','vorher','zuletzt']);
  assert.equal(JSON.stringify(gespeichert).length<120,true,'no identifier, only numbers and dates');
});
test('a later visit after 30 minutes counts up and names the previous day; within 30 minutes it stays the same visit',()=>{
  const vorher=Date.now()-3*86400000;
  const zwei=page({version:2,allowed:true,at:Date.now()-1000});
  zwei.store.set('d119_besuche_v1',JSON.stringify({n:2,erster:'2026-09-01',vorher:'2026-09-20',zuletzt:vorher}));
  // Neue Seite laden: dieselbe Ablage, neue Ausfuehrung.
  const p=page({version:2,allowed:true,at:Date.now()-1000},'',zwei.store);
  const start=p.network[0].body;
  assert.equal(start.wn,3);assert.equal(start.we,'2026-09-01');assert.equal(start.wv,new Date(vorher).toISOString().slice(0,10));
  const gleich=page({version:2,allowed:true,at:Date.now()-1000},'',p.store);
  assert.equal(gleich.network[0].body.wn,3,'same visit within 30 minutes');
});
test('refusing or withdrawing deletes the stored visit count',()=>{
  const p=page();p.nodes.find(n=>n.textContent==='Statistik erlauben').click();
  assert.ok(p.store.has('d119_besuche_v1'));
  p.window.D119Privacy.open();p.nodes.filter(n=>n.textContent==='Nur notwendige').at(-1).click();
  assert.equal(p.store.has('d119_besuche_v1'),false);
});
test('leaving the page sends a farewell, following an internal link only a page change',()=>{
  const p=page({version:2,allowed:true,at:Date.now()-1000});
  p.fire('pagehide');
  assert.equal(p.network.at(-1).body.t,'verlassen');assert.equal(p.network.at(-1).body.w,undefined);
  const q=page({version:2,allowed:true,at:Date.now()-1000});
  const link={getAttribute(name){return name==='href'?'/artikel/12/':null;},hasAttribute(){return false;}};
  q.fire('click',{target:{closest(sel){return sel==='a[href]'?link:null;}}});
  q.fire('pagehide');
  assert.equal(q.network.at(-1).body.t,'verlassen');assert.equal(q.network.at(-1).body.w,1);
  const extern={getAttribute(name){return name==='href'?'https://instagram.com/disorder119':null;},hasAttribute(){return false;}};
  const r=page({version:2,allowed:true,at:Date.now()-1000});
  r.fire('click',{target:{closest(sel){return sel==='a[href]'?extern:null;}}});
  r.fire('pagehide');
  assert.equal(r.network.at(-1).body.w,undefined,'external link is a real farewell');
});
