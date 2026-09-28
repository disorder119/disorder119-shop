import { DOCUMENT_LOGO } from './document-branding.js';
// Configuration is private Worker configuration, never browser code.
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const articleNumber=v=>{const value=String(v??'').trim().replace(/^#+\s*/, '');return value?'#'+value:'Zuordnung offen';};
const money=n=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(n/100);
export function invoiceProfile(env={},seller={}) {
  return {mode:env.TAX_MODE||'unknown',confirmed:env.TAX_CONFIRMED==='true',tax_number:String(env.TAX_NUMBER||'').trim(),seller:{...seller}};
}
export function renderInvoice(order,profile,issuedAt=new Date().toISOString()) {
  const seller=profile.seller||{},contact=order.contact||{},items=order.items||[];
  const issues=[];
  if(profile.mode!=='small_business'||profile.confirmed!==true)issues.push('Umsatzsteuerstatus nicht bestätigt oder außerhalb des unterstützten Kleinunternehmerfalls.');
  if(!profile.tax_number)issues.push('Steuernummer beziehungsweise USt-IdNr. fehlt.');
  if(!seller.name||!seller.street||!seller.city||!seller.country)issues.push('Vollständige Anbieteranschrift fehlt.');
  if(!contact.recipient_name||!contact.address_line1||!contact.postal_code||!contact.city||!contact.country_code)issues.push('Vollständiger Rechnungsempfänger fehlt.');
  if(order.currency!=='EUR'||!order.order_number||![order.total_cents,order.subtotal_cents,order.shipping_cents].every(n=>Number.isSafeInteger(n)&&n>=0))issues.push('Rechnungsnummer, Betrag oder Währung unklar.');
  if(!items.length||items.some(i=>!i.title_snapshot||!Number.isSafeInteger(i.unit_price_cents)||i.unit_price_cents<0||(i.quantity??1)!==1))issues.push('Artikelpositionen unvollständig.');
  if(items.some(i=>!String(i.article_no??'').trim().replace(/^#+\s*/, '')||!String(i.title_snapshot??'').trim()))issues.push('Interne Artikelnummer oder ursprünglicher Shop-Artikelname fehlt.');
  const itemsTotal=items.reduce((s,i)=>s+(i.unit_price_cents||0)*(i.quantity??1),0);
  const discount=itemsTotal-order.subtotal_cents;
  if(discount<0||order.total_cents!==order.subtotal_cents+order.shipping_cents)issues.push('Positionen, Rabatt, Versand und Gesamtbetrag stimmen nicht überein.');
  const ready=issues.length===0,date=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(issuedAt));
  const number=String(order.order_number||'OFFEN');
  const rows=items.map(i=>`<tr><td style="padding:12px 0;border-bottom:1px solid #ddd">${esc(i.title_snapshot)}<br><small>Interne Artikel-Nr. ${esc(articleNumber(i.article_no))}</small></td><td style="text-align:center">${esc(i.quantity??1)}</td><td style="text-align:right;white-space:nowrap">${money(i.unit_price_cents||0)}</td></tr>`).join('');
  const address=[contact.recipient_name,contact.address_line1,contact.address_line2,[contact.postal_code,contact.city].filter(Boolean).join(' '),contact.country_code].filter(Boolean);
  const title=ready?'Rechnung':'RECHNUNGSENTWURF – nicht ausgestellt';
  const taxNote=ready?'Für diese Lieferung gilt die Steuerbefreiung für Kleinunternehmer gemäß § 19 UStG. Es wird keine Umsatzsteuer ausgewiesen.':'Steuerliche Angaben noch ungeklärt. Dieser Entwurf ist keine ausgestellte Rechnung.';
  const fragment=`<section style="background:#fff;color:#171717;padding:32px;font:13px/1.5 Arial,sans-serif;max-width:760px;margin:0 auto">
    <header style="background:#080808;color:#fff;padding:18px 22px;display:flex;align-items:center;justify-content:space-between;gap:20px;break-inside:avoid;print-color-adjust:exact;-webkit-print-color-adjust:exact"><img src="${DOCUMENT_LOGO}" alt="DISORDER119 Logo" width="128" height="90" style="display:block;object-fit:contain"><div style="text-align:right;font-size:12px;letter-spacing:2px">DISORDER119<br>ARCHIVE CLOTHING</div></header>
    <h1 style="font-size:27px;margin:28px 0 6px">${title}</h1><p>Nr. ${esc(number)} · Ausgestellt am ${esc(date)}</p>
    ${ready?'':`<p style="border:2px solid #9b5700;padding:12px">${issues.map(esc).join('<br>')}</p>`}
    <table style="width:100%;margin:25px 0"><tr><td style="width:52%;vertical-align:top"><b>Rechnung an</b><br>${address.map(esc).join('<br>')}</td><td style="vertical-align:top"><b>${esc(seller.name||'Anbieter offen')}</b><br>${esc(seller.street||'')}<br>${esc(seller.city||'')}<br>${esc(seller.country||'')}<br>${profile.tax_number?'Steuernummer / USt-IdNr.: '+esc(profile.tax_number):'Steuerkennung: offen'}</td></tr></table>
    <table style="border-collapse:collapse;width:100%"><thead><tr style="background:#111;color:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact"><th style="text-align:left;padding:10px 0">Artikel</th><th>Menge</th><th style="text-align:right">Betrag</th></tr></thead><tbody>${rows}</tbody></table>
    <div style="margin:20px 0 20px auto;max-width:330px"><p>Warenwert <b style="float:right">${money(itemsTotal)}</b></p>${discount>0?`<p>Rabatt <b style="float:right">−${money(discount)}</b></p>`:''}<p>Versand <b style="float:right">${money(order.shipping_cents||0)}</b></p><p style="border-top:2px solid #111;padding-top:14px;font-size:20px">Gesamt <b style="float:right">${money(order.total_cents||0)}</b></p></div>
    <p>${esc(taxNote)}</p><p>Bestellung vom ${esc(String(order.created_at||'').slice(0,10))}. Lieferzeitpunkt gemäß gesondertem Liefer-/Versandnachweis. Zahlung über den Zahlungsanbieter; Erstattungen werden separat dokumentiert.</p><footer style="border-top:1px solid #ddd;margin-top:30px;padding-top:15px;font-size:12px">DISORDER119 · ${esc(seller.name||'')} · Danke für deinen Einkauf.</footer></section>`;
  const text=[title,`Rechnungsnummer: ${number}`,`Ausgestellt am: ${date}`,seller.name,seller.street,seller.city,seller.country,`Steuerkennung: ${profile.tax_number||'OFFEN'}`,'Rechnung an:',...address,...items.map(i=>`${i.quantity??1} × ${i.title_snapshot} (${articleNumber(i.article_no)}): ${money(i.unit_price_cents||0)}`),`Rabatt: ${money(Math.max(0,discount))}`,`Versand: ${money(order.shipping_cents||0)}`,`Gesamt: ${money(order.total_cents||0)}`,taxNote,...issues].join('\n');
  return {ready,issues,number,issued_at:issuedAt,profile,fragment,text,html:`<!doctype html><html lang="de"><meta charset="utf-8"><title>${esc(title)} ${esc(number)}</title><style>@page{size:A4;margin:16mm}body{margin:0;background:#eee}td,th{overflow-wrap:anywhere}thead{display:table-header-group}@media print{body{background:#fff}section{padding:0!important}tr{break-inside:avoid}img{max-width:100%}}</style><body>${fragment}</body></html>`};
}
