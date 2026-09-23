(function () {
  "use strict";

  if (window.__D119_ZERO_G_RUNWAY_V1__) return;
  window.__D119_ZERO_G_RUNWAY_V1__ = true;

  var ROOT_ID = "d119SecretGames";
  var COUPON_KEY = "d119_reward_coupon";
  var BEST_KEY = "d119_zero_g_runway_best_v1";
  var USER_KEY = "d119_secret_player";
  var LOCAL_BOARD_KEY = "d119_zero_g_runway_board_v1";
  var GAME_ID = "warp";
  var SUBMISSION_VERSION = "archive-raid-v3";
  var PUBLIC_VERSION = "zero-g-runway-v1";
  var META = { title: "ZERO-G RUNWAY 119", target: 48000, duration: 52000, slots: ["top", "bottom", "shoes", "accessory"] };
  var SLOT_LABELS = { top: "TOP", bottom: "BOTTOM", shoes: "SHOES", accessory: "ACCESSORY" };
  var ARCHIVE_BRANDS = ["JEAN PAUL GAULTIER","JPG","VIVIENNE WESTWOOD","MARGIELA","MAISON MARGIELA","PRADA","YOHJI YAMAMOTO","COMME DES GARCONS","COMME DES GARÇONS","RAF SIMONS","ISSEY MIYAKE","ALEXANDER MCQUEEN","DIOR","YVES SAINT LAURENT","YSL","W&LT"];

  var state = { root:null, gate:null, stage:null, result:null, encounter:null, encounterTimer:0, active:false, run:null, stopGame:null, items:null, directStarted:false, selectionGuardInstalled:false, username:"PLAYER119", leaderboard:[] };
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function now() { return Date.now(); }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function randomId() { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); return "local-" + now().toString(36) + "-" + Math.random().toString(36).slice(2,12); }
  function formatScore(value) { return Math.max(0, Math.round(Number(value)||0)).toLocaleString("de-DE") + " P"; }
  function money(value) { try { return Number(value||0).toLocaleString("de-DE", {style:"currency",currency:"EUR",maximumFractionDigits:0}); } catch (_) { return String(Math.round(Number(value)||0)) + " €"; } }
  function apiBase() { var cfg = window.SHOP_CONFIG || window.ARTICLE_SHOP_CONFIG || {}; return String(window.D119_GAME_API || cfg.shopWorkerUrl || "").replace(/\/$/, ""); }
  async function api(path, options) {
    var base = apiBase(); if (!base) throw new Error("GAME_API_NOT_CONFIGURED");
    var response = await fetch(base + path, Object.assign({headers:{"Content-Type":"application/json"},credentials:"omit"}, options || {}));
    var data = {}; try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(data && data.error ? data.error : "GAME_API_FAILED");
    return data || {};
  }
  function normalizeUsername(value) { var name = String(value||"").trim().replace(/\s+/g," ").slice(0,16); if (name.length < 3) return "PLAYER119"; return name.replace(/[^A-Za-z0-9À-ž._ -]/g,"").slice(0,16) || "PLAYER119"; }
  function restoreUsername() { try { state.username = normalizeUsername(localStorage.getItem(USER_KEY)||"PLAYER119"); } catch (_) { state.username = "PLAYER119"; } }
  function saveUsername(value) { state.username = normalizeUsername(value); try { localStorage.setItem(USER_KEY,state.username); } catch (_) {} }

  function slotFor(item) {
    var text = [item&&item.taxonomy_category,item&&item.product_type,item&&item.category,item&&item.title].filter(Boolean).join(" ").toLowerCase();
    if (/shoe|sneaker|boot|loafer|heel|sandal|pump/.test(text)) return "shoes";
    if (/pant|trouser|jean|denim|skirt|short|legging/.test(text)) return "bottom";
    if (/accessor|bag|handbag|sunglass|glasses|belt|hat|cap|scarf|jewel|necklace|bracelet|wallet|tie/.test(text)) return "accessory";
    if (/jacket|coat|blazer|shirt|t-shirt|tee|top|knit|sweater|hoodie|cardigan|dress|vest|parka|blouse/.test(text)) return "top";
    return "";
  }
  function isArchive(item) { var brand=String(item&&item.brand||"").toUpperCase(), price=Number(item&&item.price||0); return price>=350 || ARCHIVE_BRANDS.some(function(name){return brand.indexOf(name)>=0;}); }
  async function loadItems() {
    if (state.items) return state.items;
    try {
      var response=await fetch("/data/catalog.json",{cache:"no-store"}); if(!response.ok) throw new Error("catalog");
      var raw=await response.json(); var list=Array.isArray(raw)?raw:(Array.isArray(raw.items)?raw.items:[]);
      state.items=list.filter(function(it){return String(it.public_status||"").toUpperCase()==="AVAILABLE" && slotFor(it) && ((it.grid_image&&String(it.grid_image))||(Array.isArray(it.gallery)&&it.gallery[0]));}).slice(0,320);
    } catch (_) { state.items=[]; }
    return state.items;
  }
  function imageUrl(item) { var value=item&&item.grid_image?String(item.grid_image):(item&&item.gallery&&item.gallery[0]?String(item.gallery[0]):""); if(!value)return""; if(/^https?:\/\//i.test(value))return value; return "/"+value.replace(/^\/+/,""); }
  function articleUrl(item) { return item&&item.id ? "/artikel/"+encodeURIComponent(String(item.id))+"/" : "#"; }
  function universeReady() { var view=document.getElementById("chaosView"); return !!(view&&!view.classList.contains("hidden")&&!view.classList.contains("chaos-view--game")&&!state.active&&(!state.root||state.root.hidden)); }
  function stopNativeGame() { var native=document.getElementById("chaosGame"); if(native&&!native.hidden){var back=document.getElementById("chaosGameBack"); if(back)back.click();} }
  function installSelectionGuard() {
    if(state.selectionGuardInstalled)return; var host=document.getElementById("chaosScreen"); if(!host)return; state.selectionGuardInstalled=true;
    host.addEventListener("selectstart",function(event){var target=event.target;if(target&&target.closest&&target.closest("input,textarea,[contenteditable='true']"))return;event.preventDefault();},true);
    host.addEventListener("dragstart",function(event){var target=event.target;if(target&&target.closest&&target.closest("input,textarea,[contenteditable='true']"))return;event.preventDefault();},true);
  }

  function localBoard(){try{var value=JSON.parse(localStorage.getItem(LOCAL_BOARD_KEY)||"[]");return Array.isArray(value)?value.slice(0,8):[];}catch(_){return[];}}
  function saveLocalScore(username,score){var board=localBoard();board.push({username:normalizeUsername(username),score:Math.round(score),createdAt:new Date().toISOString()});board.sort(function(a,b){return Number(b.score||0)-Number(a.score||0);});board=board.slice(0,8);try{localStorage.setItem(LOCAL_BOARD_KEY,JSON.stringify(board));}catch(_){}return board;}
  async function loadLeaderboard(){try{var response=await api("/games/leaderboard?game="+encodeURIComponent(GAME_ID)+"&limit=8",{method:"GET"});state.leaderboard=Array.isArray(response.scores)?response.scores:[];}catch(_){state.leaderboard=localBoard();}renderLeaderboard(qs("[data-leaderboard]",state.gate),state.leaderboard);}
  function renderLeaderboard(host,board){if(!host)return;var rows=(board||[]).slice(0,8);host.innerHTML='<div class="d119-board-head"><span>RUNWAY RANKING</span><span>SCORE</span></div>'+(rows.length?rows.map(function(row,index){return'<div class="d119-board-row"><span><b>'+(index+1)+'</b>'+escapeHtml(row.username||"PLAYER119")+'</span><strong>'+formatScore(row.score)+'</strong></div>';}).join(""):'<p class="d119-board-empty">Noch keine Runs gespeichert.</p>');}

  function buildRoot(){
    if(state.root)return state.root;restoreUsername();var host=document.getElementById("chaosScreen")||document.body;var root=document.createElement("div");
    root.id=ROOT_ID;root.className="d119-games d119-runway-game";root.hidden=true;
    root.innerHTML='<div class="d119-games__veil"></div><section class="d119-game-gate" data-view="gate" hidden><button type="button" class="d119-game-close" data-action="close" aria-label="Schließen">×</button><p class="d119-game-kicker">DISORDER119 // UNIVERSE GAME</p><h2 class="d119-game-heading">ZERO-G<br>RUNWAY <i>119</i></h2><p class="d119-game-copy">Baue im freien Fall einen kompletten Look aus echten Disorder119-Pieces. Fange nacheinander TOP, BOTTOM, SHOES und ACCESSORY. Falsche Pieces und SOLD-Hazards kosten Combo. Seltene ARCHIVE-Pieces lösen Slow-Motion und Bonus aus.</p><div class="d119-game-rules"><span>52 SEK.</span><span>4 PIECES = 1 LOOK</span><span>ARCHIVE = BONUS</span><span>48K = 10%</span></div><label class="d119-player-field"><span>DEIN USERNAME</span><input type="text" maxlength="16" autocomplete="off" spellcheck="false" data-player-name value="'+escapeHtml(state.username)+'"></label><button type="button" class="d119-game-start" data-action="start">ENTER ZERO-G</button><p class="d119-gate-note">Desktop: Maus einfach bewegen. Mobil: Finger ziehen. Nicht klicken. Pfeiltasten funktionieren ebenfalls. Esc beendet den Run.</p><div class="d119-leaderboard" data-leaderboard></div></section><section class="d119-game-stage" data-view="stage" hidden></section><section class="d119-game-result" data-view="result" hidden></section>';
    host.appendChild(root);state.root=root;state.gate=qs('[data-view="gate"]',root);state.stage=qs('[data-view="stage"]',root);state.result=qs('[data-view="result"]',root);
    root.addEventListener("click",function(event){var action=event.target&&event.target.closest?event.target.closest("[data-action]"):null;if(!action)return;var name=action.getAttribute("data-action");if(name==="close"||name==="back")closeGames();else if(name==="start"||name==="retry"){var input=qs("[data-player-name]",state.gate);if(input)saveUsername(input.value);launchGame();}});
    installSelectionGuard();loadLeaderboard();return root;
  }
  function setView(name){[state.gate,state.stage,state.result].forEach(function(view){if(view)view.hidden=true;});var target=name==="gate"?state.gate:name==="stage"?state.stage:state.result;if(target)target.hidden=false;}
  function showRoot(){buildRoot();stopNativeGame();removeEncounter();state.root.hidden=false;document.documentElement.classList.add("d119-game-open");document.body.classList.add("d119-game-open");}
  function closeGames(){if(state.stopGame){try{state.stopGame();}catch(_){}}state.stopGame=null;state.active=false;state.run=null;if(state.root){state.root.hidden=true;state.stage.innerHTML="";state.result.innerHTML="";}document.documentElement.classList.remove("d119-game-open");document.body.classList.remove("d119-game-open");state.directStarted=false;scheduleEncounter(32000+Math.random()*56000);}
  function showGate(){showRoot();setView("gate");loadLeaderboard();}
  async function createRun(){try{var result=await api("/games/start",{method:"POST",body:JSON.stringify({game:GAME_ID})});return{id:result.runId,token:result.runToken||"",startedAt:Number(result.startedAt||now()),server:true};}catch(_){return{id:randomId(),token:"",startedAt:now(),server:false};}}
  function requestStart(){showGate();}
  async function launchGame(){showRoot();setView("stage");state.stage.innerHTML='<div class="d119-game-loading"><span></span><p>RUNWAY INITIALISIEREN</p></div>';state.active=true;var pair=await Promise.all([createRun(),loadItems()]);if(!state.active)return;state.run=pair[0];if(!pair[1].length){state.stage.innerHTML='<div class="d119-game-loading"><p>Keine geeigneten Pieces gefunden.</p></div>';return;}startRunway(pair[1]);}

  async function finishGame(score,details,durationMs){
    if(state.stopGame){try{state.stopGame();}catch(_){}}state.stopGame=null;state.active=false;var run=state.run;var safeScore=clamp(Math.round(score),0,149900);var qualified=safeScore>=META.target,couponCode="",server=false,leaderboard=null;
    if(run&&run.server){
      try{
        var serverDetails=Object.assign({},details||{});
        if(Array.isArray(serverDetails.finalLook))serverDetails.finalLook=serverDetails.finalLook.map(function(item){return item&&item.id?String(item.id):"";});
        var response=await api("/games/score",{method:"POST",body:JSON.stringify({game:GAME_ID,runId:run.id,runToken:run.token,username:state.username,score:safeScore,durationMs:Math.round(durationMs),detail:Object.assign({version:SUBMISSION_VERSION,mode:PUBLIC_VERSION},serverDetails)})});
        qualified=Boolean(response.qualified);couponCode=String(response.couponCode||"");leaderboard=Array.isArray(response.leaderboard)?response.leaderboard:null;server=true;
      }catch(_){}
    }
    if(!server)leaderboard=saveLocalScore(state.username,safeScore);if(!server&&qualified)couponCode="D11910-PREVIEW";
    if(couponCode){try{localStorage.setItem(COUPON_KEY,JSON.stringify({code:couponCode,game:GAME_ID,issuedAt:now(),server:server}));}catch(_){}document.dispatchEvent(new CustomEvent("d119:coupon-earned",{detail:{code:couponCode,server:server}}));}
    state.leaderboard=leaderboard||state.leaderboard;renderResult(safeScore,qualified,couponCode,server,details||{});
  }
  function pieceCard(item){if(!item)return'<div class="d119-look-piece is-empty"><span>EMPTY</span></div>';return'<a class="d119-look-piece" href="'+escapeHtml(articleUrl(item))+'"><img src="'+escapeHtml(imageUrl(item))+'" alt="" loading="lazy"><span><b>'+escapeHtml(item.brand||"DISORDER119")+'</b><small>'+escapeHtml(item.title||"Piece")+'</small><em>'+money(item.price)+'</em></span></a>';}
  function renderResult(score,qualified,couponCode,server,details){
    showRoot();setView("result");var best=0;try{best=Number(localStorage.getItem(BEST_KEY)||0);}catch(_){}if(score>best){best=score;try{localStorage.setItem(BEST_KEY,String(score));}catch(_){}}
    var looks=Math.max(0,Number(details.looks||0)),archive=Math.max(0,Number(details.archive||0)),wrong=Math.max(0,Number(details.wrong||0)),finalLook=Array.isArray(details.finalLook)?details.finalLook.slice(0,4):[];
    var reward=qualified?'<div class="d119-reward is-earned"><span>10 % UNLOCKED</span><strong>'+escapeHtml(couponCode||"FREIGESCHALTET")+'</strong><small>'+(server?"Einmaliger Code · serverseitig geprüft":"Preview · echter Code sobald der Shop-Worker aktiv ist")+'</small></div>':'<div class="d119-reward"><span>10 % LOCKED</span><strong>NOCH '+formatScore(Math.max(0,META.target-score))+'</strong><small>Complete Looks + ARCHIVE-Pieces bringen dich am schnellsten auf 48K.</small></div>';
    state.result.innerHTML='<button type="button" class="d119-game-close" data-action="close" aria-label="Schließen">×</button><p class="d119-game-kicker">ZERO-G RUNWAY 119 // FINISH</p><h2 class="d119-result-score">'+formatScore(score)+'</h2><p class="d119-result-line">'+looks+' komplette Looks · '+archive+' ARCHIVE-Pieces · '+wrong+' Fehlgriffe</p><p class="d119-result-best">'+escapeHtml(state.username)+' · Bestwert auf diesem Gerät: '+formatScore(best)+'</p><section class="d119-final-look"><div class="d119-final-look__head"><span>YOUR 119 LOOK</span><small>echte Pieces aus dem Shop</small></div><div class="d119-final-look__grid">'+META.slots.map(function(_,index){return pieceCard(finalLook[index]);}).join("")+'</div></section>'+reward+'<div class="d119-result-actions"><button type="button" class="d119-retry" data-action="retry">NOCHMAL</button><button type="button" class="d119-return-universe" data-action="back">ZURÜCK INS UNIVERSUM</button></div><div class="d119-leaderboard d119-leaderboard--result" data-result-board></div>';
    renderLeaderboard(qs("[data-result-board]",state.result),state.leaderboard);
  }

  function startRunway(items){
    var stage=state.stage;
    stage.innerHTML='<div class="d119-runway-shell"><canvas class="d119-runway-canvas" tabindex="0" aria-label="Zero-G Runway 119. Bewege den 119-Cursor und sammle die geforderte Kleidungskategorie."></canvas><div class="d119-runway-hud"><span><small>ZEIT</small><strong data-hud="time">52</strong></span><span><small>SCORE</small><strong data-hud="score">0 P</strong></span><span><small>LOOKS</small><strong data-hud="looks">0</strong></span><span><small>COMBO</small><strong data-hud="combo">×1.0</strong></span></div><div class="d119-runway-target"><small>NEXT PIECE</small><strong data-target>TOP</strong></div><div class="d119-look-dock" data-look-dock></div><div class="d119-runway-flash" data-flash></div><p class="d119-runway-help">MOVE · MATCH THE SLOT · AVOID WRONG PIECES</p><button type="button" class="d119-game-close d119-game-close--play" data-action="close" aria-label="Spiel beenden">×</button></div>';
    var canvas=qs("canvas",stage),ctx=canvas.getContext("2d",{alpha:false}),shell=qs(".d119-runway-shell",stage),hudTime=qs('[data-hud="time"]',stage),hudScore=qs('[data-hud="score"]',stage),hudLooks=qs('[data-hud="looks"]',stage),hudCombo=qs('[data-hud="combo"]',stage),targetEl=qs("[data-target]",stage),dock=qs("[data-look-dock]",stage),flash=qs("[data-flash]",stage);
    var dpr=1,W=1,H=1,raf=0,started=performance.now(),last=started,lastSpawn=started-900,score=0,looks=0,archiveCount=0,wrong=0,stopped=false,combo=1,slowUntil=0,flashUntil=0;
    var player={x:0,y:0,r:18,invUntil:0},currentLook=[],lastCompletedLook=[],objects=[],pops=[],keys={},imageCache=Object.create(null),pools={top:[],bottom:[],shoes:[],accessory:[]};
    items.forEach(function(item){var slot=slotFor(item);if(slot&&pools[slot])pools[slot].push(item);});
    var stars=[];for(var si=0;si<96;si++)stars.push({x:Math.random(),y:Math.random(),s:.35+Math.random()*1.8,a:.13+Math.random()*.55});
    function requiredSlot(){return META.slots[currentLook.length%META.slots.length];}
    function resize(){var r=shell.getBoundingClientRect();W=Math.max(1,r.width);H=Math.max(1,r.height);dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);canvas.style.width=W+"px";canvas.style.height=H+"px";if(!player.x){player.x=W*.5;player.y=H*.72;}player.x=clamp(player.x,player.r+4,W-player.r-4);player.y=clamp(player.y,104,H-player.r-10);}
    function imageFor(item){var src=imageUrl(item);if(!src)return null;if(!imageCache[src]){var im=new Image();im.decoding="async";im.src=src;imageCache[src]=im;}return imageCache[src];}
    function randomFrom(list){return list&&list.length?list[Math.floor(Math.random()*list.length)]:null;}
    function spawn(progress){var target=requiredSlot(),roll=Math.random();if(roll<.12){objects.push({kind:"hazard",label:Math.random()<.55?"SOLD":"NO FIT",nx:.12+Math.random()*.76,z:1,speed:.24+progress*.12,drift:(Math.random()-.5)*.08,resolved:false});return;}var slot=roll<.68?target:META.slots[Math.floor(Math.random()*META.slots.length)],pool=pools[slot].length?pools[slot]:items,item=randomFrom(pool);if(!item)return;objects.push({kind:"piece",item:item,slot:slot,rare:isArchive(item)&&Math.random()<.34,img:imageFor(item),nx:.10+Math.random()*.80,z:1,speed:.205+progress*.13+Math.random()*.035,drift:(Math.random()-.5)*(.07+progress*.06),resolved:false,angle:(Math.random()-.5)*.12});}
    function project(o){var depth=clamp(1-o.z,0,1.15),spread=.22+depth*.78,x=W*(.5+(o.nx-.5)*spread),y=H*(.13+Math.pow(depth,1.62)*.90),scale=.12+depth*(W<600?.92:1.08),base=W<600?78:92;return{x:x,y:y,scale:scale,w:base*scale,h:base*1.24*scale};}
    function overlap(p){var rx=Math.max(18,p.w*.28),ry=Math.max(20,p.h*.30);return Math.abs(player.x-p.x)<rx+player.r&&Math.abs(player.y-p.y)<ry+player.r;}
    function addPop(text,x,y,strong){pops.push({text:text,x:x,y:y,t:performance.now(),strong:strong});}
    function setFlash(text,ms){flash.textContent=text;flash.classList.add("is-visible");flashUntil=performance.now()+(ms||850);}
    function updateDock(){dock.innerHTML=META.slots.map(function(slot,index){var item=currentLook[index];return'<span class="d119-dock-slot'+(item?' is-filled':(index===currentLook.length?' is-next':''))+'">'+(item?'<img src="'+escapeHtml(imageUrl(item))+'" alt="">':'<b>'+SLOT_LABELS[slot].slice(0,3)+'</b>')+'</span>';}).join("");targetEl.textContent=SLOT_LABELS[requiredSlot()];}
    function collectPiece(o,p,t){if(o.resolved)return;o.resolved=true;var wanted=requiredSlot();if(o.kind==="hazard"||o.slot!==wanted){wrong++;combo=1;score=Math.max(0,score-(o.kind==="hazard"?2000:1500));player.invUntil=t+460;addPop(o.kind==="hazard"?"SOLD −2.000":"WRONG PIECE −1.500",player.x,player.y-28,true);return;}currentLook.push(o.item);combo=Math.min(2.2,combo+.15);var price=Math.max(0,Number(o.item&&o.item.price)||0),gain=Math.round((1300+Math.min(1200,price*1.6))*combo);if(o.rare){gain+=2400;archiveCount++;slowUntil=t+1350;setFlash("ARCHIVE PIECE // +2.400",1050);}score=Math.min(149900,score+gain);addPop("+"+gain.toLocaleString("de-DE"),p.x,p.y-20,o.rare);updateDock();if(currentLook.length===META.slots.length){looks++;var lookBonus=6200+Math.round(combo*700);score=Math.min(149900,score+lookBonus);lastCompletedLook=currentLook.slice();setFlash("LOOK 0"+looks+" COMPLETE // +"+lookBonus.toLocaleString("de-DE"),1200);currentLook=[];combo=Math.min(2.2,combo+.25);window.setTimeout(function(){if(!stopped)updateDock();},480);}}
    function updateHud(remaining){hudTime.textContent=String(Math.max(0,Math.ceil(remaining/1000)));hudScore.textContent=formatScore(score);hudLooks.textContent=String(looks);hudCombo.textContent="×"+combo.toFixed(2).replace(/0$/,"");}
    function onPointer(e){var r=canvas.getBoundingClientRect();player.x=clamp(e.clientX-r.left,player.r+4,W-player.r-4);player.y=clamp(e.clientY-r.top,104,H-player.r-10);if(e.pointerType!=="mouse"&&e.cancelable)e.preventDefault();}
    function onKeyDown(e){if(e.key==="Escape"){e.preventDefault();closeGames();return;}if(/^Arrow(Up|Down|Left|Right)$/.test(e.key)){e.preventDefault();keys[e.key]=true;}}
    function onKeyUp(e){delete keys[e.key];}
    function stop(){if(stopped)return;stopped=true;if(raf)cancelAnimationFrame(raf);canvas.removeEventListener("pointermove",onPointer);canvas.removeEventListener("pointerdown",onPointer);document.removeEventListener("keydown",onKeyDown);document.removeEventListener("keyup",onKeyUp);window.removeEventListener("resize",resize);}
    state.stopGame=stop;canvas.addEventListener("pointermove",onPointer,{passive:false});canvas.addEventListener("pointerdown",onPointer,{passive:false});document.addEventListener("keydown",onKeyDown);document.addEventListener("keyup",onKeyUp);window.addEventListener("resize",resize);resize();updateDock();try{canvas.focus({preventScroll:true});}catch(_){}
    function drawBackground(elapsed,speedScale){ctx.fillStyle="#020202";ctx.fillRect(0,0,W,H);var grad=ctx.createRadialGradient(W*.5,H*.23,0,W*.5,H*.4,H*.75);grad.addColorStop(0,"rgba(72,72,78,.17)");grad.addColorStop(.45,"rgba(18,18,22,.08)");grad.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);stars.forEach(function(s){var yy=(s.y*H+elapsed*s.s*.018*speedScale)%H;ctx.globalAlpha=s.a;ctx.fillStyle="#f2efe7";ctx.fillRect(s.x*W,yy,s.s,s.s*2.2);});ctx.globalAlpha=1;ctx.save();ctx.strokeStyle="rgba(242,239,231,.10)";ctx.lineWidth=1;var horizonY=H*.18;[-.44,-.30,-.16,0,.16,.30,.44].forEach(function(lane){ctx.beginPath();ctx.moveTo(W*.5+lane*W*.10,horizonY);ctx.lineTo(W*.5+lane*W,H*1.08);ctx.stroke();});for(var gy=0;gy<9;gy++){var q=gy/8,yy2=horizonY+Math.pow(q,2.1)*(H-horizonY);ctx.beginPath();ctx.moveTo(W*(.5-.46*q),yy2);ctx.lineTo(W*(.5+.46*q),yy2);ctx.stroke();}ctx.restore();}
    function drawObject(o,p){ctx.save();ctx.translate(p.x,p.y);ctx.rotate(o.angle||0);if(o.kind==="hazard"){ctx.globalAlpha=.92;ctx.strokeStyle="rgba(242,239,231,.60)";ctx.lineWidth=1.2;ctx.strokeRect(-p.w*.44,-p.h*.22,p.w*.88,p.h*.44);ctx.fillStyle="rgba(0,0,0,.72)";ctx.fillRect(-p.w*.44,-p.h*.22,p.w*.88,p.h*.44);ctx.fillStyle="#f2efe7";ctx.font="800 "+Math.max(8,p.w*.14)+"px Helvetica Neue, Arial";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(o.label,0,0);}else{if(o.rare){ctx.shadowColor="rgba(242,239,231,.78)";ctx.shadowBlur=Math.max(8,p.w*.14);ctx.strokeStyle="rgba(242,239,231,.75)";ctx.lineWidth=1;ctx.strokeRect(-p.w*.53,-p.h*.53,p.w*1.06,p.h*1.06);}ctx.globalAlpha=.96;if(o.img&&o.img.complete&&o.img.naturalWidth>0){var ratio=o.img.naturalHeight/o.img.naturalWidth,hh=Math.min(p.h*1.45,p.w*ratio);ctx.drawImage(o.img,-p.w/2,-hh/2,p.w,hh);}else{ctx.strokeStyle="rgba(242,239,231,.45)";ctx.strokeRect(-p.w/2,-p.h/2,p.w,p.h);}if(o.rare&&p.scale>.42){ctx.shadowBlur=0;ctx.globalAlpha=.96;ctx.fillStyle="#f2efe7";ctx.fillRect(-p.w*.50,p.h*.43,p.w,Math.max(12,p.h*.12));ctx.fillStyle="#050505";ctx.font="800 "+Math.max(7,p.w*.09)+"px Helvetica Neue, Arial";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("ARCHIVE",0,p.h*.49);}}ctx.restore();}
    function frame(t){if(stopped||!state.active)return;var dt=Math.min(34,Math.max(0,t-last));last=t;var elapsed=t-started,remaining=META.duration-elapsed,progress=clamp(elapsed/META.duration,0,1);if(remaining<=0){updateHud(0);finishGame(score,{looks:looks,archive:archiveCount,wrong:wrong,finalLook:lastCompletedLook.length?lastCompletedLook:currentLook},META.duration);return;}var speedScale=t<slowUntil?.42:1,move=dt*.58;if(keys.ArrowLeft)player.x-=move;if(keys.ArrowRight)player.x+=move;if(keys.ArrowUp)player.y-=move;if(keys.ArrowDown)player.y+=move;player.x=clamp(player.x,player.r+4,W-player.r-4);player.y=clamp(player.y,104,H-player.r-10);var interval=860-progress*300;if(t-lastSpawn>=interval){lastSpawn=t;spawn(progress);}objects.forEach(function(o){if(o.resolved)return;o.z-=o.speed*speedScale*dt/1000;o.nx+=o.drift*speedScale*dt/1000;if(o.nx<.05||o.nx>.95)o.drift*=-1;var p=project(o);if(t>=player.invUntil&&p.scale>.38&&overlap(p))collectPiece(o,p,t);if(!o.resolved&&o.z<-.08)o.resolved=true;});objects=objects.filter(function(o){return !o.resolved&&o.z>-.16;});pops=pops.filter(function(p){return t-p.t<920;});if(flashUntil&&t>flashUntil){flash.classList.remove("is-visible");flashUntil=0;}ctx.setTransform(dpr,0,0,dpr,0,0);drawBackground(elapsed,speedScale);objects.slice().sort(function(a,b){return b.z-a.z;}).forEach(function(o){drawObject(o,project(o));});ctx.globalAlpha=t<player.invUntil?(Math.floor(t/70)%2?.25:1):1;ctx.beginPath();ctx.arc(player.x,player.y,player.r,0,Math.PI*2);ctx.fillStyle="rgba(242,239,231,.96)";ctx.fill();ctx.strokeStyle="rgba(0,0,0,.85)";ctx.lineWidth=2;ctx.stroke();ctx.fillStyle="#050505";ctx.font="800 9px Helvetica Neue, Arial";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("119",player.x,player.y+.5);ctx.globalAlpha=1;ctx.textAlign="center";ctx.textBaseline="alphabetic";ctx.font="800 12px Helvetica Neue, Arial";pops.forEach(function(p){var q=(t-p.t)/920;ctx.globalAlpha=1-q;ctx.fillStyle=p.strong?"#f2efe7":"rgba(242,239,231,.82)";ctx.fillText(p.text,p.x,p.y-q*36);});ctx.globalAlpha=1;updateHud(remaining);raf=requestAnimationFrame(frame);}
    raf=requestAnimationFrame(frame);
  }

  function removeEncounter(){if(state.encounter){try{state.encounter.remove();}catch(_){}state.encounter=null;}}
  function scheduleEncounter(delay){clearTimeout(state.encounterTimer);state.encounterTimer=setTimeout(function waitForUniverse(){if(!universeReady()){state.encounterTimer=setTimeout(waitForUniverse,1700+Math.random()*2100);return;}spawnEncounter();},Math.max(1200,delay||7600));}
  function spawnEncounter(){removeEncounter();if(!universeReady())return;var host=document.getElementById("chaosScreen");if(!host)return;var btn=document.createElement("button");btn.type="button";btn.className="d119-universe-encounter d119-zero-g-bag";btn.setAttribute("aria-label","Zero-G Runway 119 starten");btn.innerHTML='<span class="d119-zero-g-bag__icon" aria-hidden="true"><i>119</i></span><span class="d119-zero-g-bag__label">ZERO-G<br><b>RUNWAY</b></span>';btn.style.setProperty("--enc-y",(18+Math.random()*52).toFixed(1)+"%");btn.style.setProperty("--enc-dur",(9+Math.random()*4).toFixed(2)+"s");btn.addEventListener("pointerdown",function(event){event.stopPropagation();});btn.addEventListener("click",function(event){event.preventDefault();event.stopPropagation();removeEncounter();requestStart();});btn.addEventListener("animationend",function(){if(state.encounter!==btn)return;removeEncounter();scheduleEncounter(35000+Math.random()*56000);});host.appendChild(btn);state.encounter=btn;}
  function directGame(){var value=String(new URLSearchParams(location.search).get("game")||"").toLowerCase();return["zero","zero-g","runway","fashion","dodge","raid","warp","1"].indexOf(value)>=0;}
  function init(){buildRoot();if(directGame()&&!state.directStarted){state.directStarted=true;window.setTimeout(showGate,80);}else scheduleEncounter(7600+Math.random()*18000);}
  window.D119SecretGames={version:PUBLIC_VERSION,start:function(){showGate();},discover:spawnEncounter,close:closeGames,state:function(){return{active:state.active,username:state.username,version:PUBLIC_VERSION};}};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
