// Empfangene Vordergrundzeit, keine Aussage ueber menschliche Aufmerksamkeit.
// Das Frontend beginnt bei jedem Sichtbarkeits-/Kontextwechsel einen neuen,
// rein fluechtigen Abschnitt. Keine Cookies oder dauerhaften Browser-IDs.
const MAX_MS = 86_400_000;
const PAUSE = 30 * 60 * 1000;

export function sichtzeitBody(body) {
  const ms = Number(body.ms);
  if (!/^[a-f0-9]{24}$/.test(String(body.v || "")) || !Number.isSafeInteger(ms) || ms < 0 || ms > MAX_MS) return null;
  const pfad = String(body.p || "/").split(/[?#]/)[0].slice(0, 200);
  if (!pfad.startsWith("/") || pfad.startsWith("//")) return null;
  const a = body.a == null ? null : String(body.a);
  if (a !== null && !/^\d{1,9}$/.test(a)) return null;
  return { abschnitt: body.v, ms, pfad, artikelId: a };
}

export async function sichtzeitSpeichern(env, besucher, body, now) {
  const e = sichtzeitBody(body);
  if (!e) return false;
  const alt = await env.DB.prepare("SELECT * FROM besucher_sichtzeit WHERE besucher=? AND abschnitt=?").bind(besucher,e.abschnitt).first();
  if (alt && (alt.pfad !== e.pfad || (alt.artikel_id || null) !== e.artikelId)) return false;
  if (alt && e.ms <= Number(alt.zaehler_ms)) return true;
  const delta = alt ? e.ms - Number(alt.zaehler_ms) : e.ms;
  const maximal = alt ? Math.min(60_000,Math.max(0,now-Date.parse(alt.zuletzt))+1500) : 30_000;
  const angenommen = Math.min(delta,maximal);
  const sicht = Math.min(MAX_MS,Number(alt?.sicht_ms || 0)+angenommen);
  const zeit = new Date(now).toISOString();
  const beginn = alt?.beginn || new Date(now-angenommen).toISOString();
  const begrenzt = Boolean(alt?.begrenzt) || angenommen < delta;
  await env.DB.prepare(`INSERT INTO besucher_sichtzeit
    (besucher,abschnitt,beginn,zuletzt,pfad,artikel_id,zaehler_ms,sicht_ms,begrenzt) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(besucher,abschnitt) DO UPDATE SET zuletzt=excluded.zuletzt,
      zaehler_ms=excluded.zaehler_ms,sicht_ms=MAX(besucher_sichtzeit.sicht_ms,excluded.sicht_ms),
      begrenzt=MAX(besucher_sichtzeit.begrenzt,excluded.begrenzt)
    WHERE excluded.zaehler_ms > besucher_sichtzeit.zaehler_ms`)
    .bind(besucher,e.abschnitt,beginn,zeit,e.pfad,e.artikelId,e.ms,sicht,begrenzt?1:0).run();
  return true;
}

export function zeitIntervalle(zeilen) {
  return (zeilen || []).map(r=>({von:Date.parse(r.beginn),bis:Date.parse(r.zuletzt),ms:Number(r.sicht_ms),pfad:r.pfad,artikelId:r.artikel_id || null,begrenzt:Boolean(r.begrenzt)}))
    .filter(r=>Number.isFinite(r.von)&&Number.isFinite(r.bis)&&r.bis>=r.von&&Number.isFinite(r.ms)&&r.ms>=0)
    .sort((a,b)=>a.von-b.von || a.bis-b.bis);
}

// Verbundene Messabschnitte halten auch einen langen, stillen Lesebesuch
// zusammen; ein Abschnitt im Hintergrund zaehlt nicht als Lebenszeichen.
export function zeitGruppen(intervalle) {
  const gruppen=[];
  for(const r of intervalle){
    let g=gruppen[gruppen.length-1];
    if(!g || r.von-g.bis>PAUSE){g={von:r.von,bis:r.bis,intervalle:[]};gruppen.push(g);}
    g.bis=Math.max(g.bis,r.bis);g.intervalle.push(r);
  }
  return gruppen;
}
export function verbundeneZeiten(gruppen, von) {
  let lo=0,hi=(gruppen || []).length;
  while(lo<hi){const m=(lo+hi)>>>1;if(gruppen[m].bis<von)lo=m+1;else hi=m;}
  const g=(gruppen || [])[lo];
  return g && g.von-von<=PAUSE ? g : {intervalle:[],bis:von};
}

// Vereinte Intervalle einmal indizieren, statt fuer jeden Verlaufsschritt alle
// Messpunkte erneut zu durchsuchen. Abfragen kosten dann logarithmische Zeit.
const kontextKey = r => JSON.stringify([r.pfad,r.artikelId || null]);
export function sichtzeitIndex(intervalle) {
  const raw=new Map([["*",[]]]);
  for(const r of intervalle){const k=kontextKey(r);if(!raw.has(k))raw.set(k,[]);const t=[Math.max(r.von,r.bis-r.ms),r.bis];if(t[1]>t[0]){raw.get("*").push(t);raw.get(k).push(t);}}
  const index=new Map();
  for(const [k,teile] of raw){
    teile.sort((a,b)=>a[0]-b[0]);const vereint=[];
    for(const t of teile){const alt=vereint[vereint.length-1];if(alt && t[0]<=alt[1])alt[1]=Math.max(alt[1],t[1]);else vereint.push([...t]);}
    let summe=0;index.set(k,vereint.map(([a,b])=>{const r={a,b,vor:summe};summe+=b-a;return r;}));
  }
  return index;
}
export function sichtzeitZwischen(index,von,bis,kontext) {
  const teile=index.get(kontext?kontextKey(kontext):"*");if(!teile)return null;
  function davor(t){let lo=0,hi=teile.length;while(lo<hi){const m=(lo+hi)>>>1;if(teile[m].a<t)lo=m+1;else hi=m;}if(!lo)return 0;const r=teile[lo-1];return r.vor+Math.max(0,Math.min(t,r.b)-r.a);}
  return Math.max(0,Math.round(davor(bis)-davor(von)));
}

export function vereinigteZeit(intervalle, von, bis, kontext) {
  const teile=(intervalle || []).filter(r=>!kontext || (r.pfad===kontext.pfad && r.artikelId===(kontext.artikelId || null)))
    .map(r=>[Math.max(von,r.von,r.bis-r.ms),Math.min(bis,r.bis)])
    .filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
  let summe=0,ende=-Infinity;
  for(const [a,b] of teile){summe+=Math.max(0,b-Math.max(a,ende));ende=Math.max(ende,b);}
  return Math.round(summe);
}
