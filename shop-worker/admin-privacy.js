import { authorizeAdminRequest, timingSafeEqualText, RuntimeGuardError } from "./backend-runtime.js";

// One calendar month, clamped at month end (not a fixed 30-day interval).
export function privacyDeadline(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth()+1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString();
}

class PrivacyError extends Error {
  constructor(code, status=400) { super(code); this.code=code; this.status=status; }
}

export async function listPrivacyRequests(env) {
  const result = await env.DB.prepare(`SELECT r.id,r.customer_id,r.request_type,r.status,
    r.requested_at,r.completed_at,r.response_note,r.response_sent_at,c.email_normalized AS email
    FROM account_privacy_requests r JOIN customers c ON c.id=r.customer_id
    ORDER BY CASE WHEN r.status IN ('REQUESTED','PROCESSING') THEN 0 ELSE 1 END,r.requested_at ASC LIMIT 200`).all();
  return (result.results || []).map(row => ({...row, deadline:privacyDeadline(row.requested_at),
    overdue:['REQUESTED','PROCESSING'].includes(row.status) && Date.parse(privacyDeadline(row.requested_at)) < Date.now()}));
}

export async function updatePrivacyRequest(env, body) {
  const id = String(body.id || "").trim();
  const row = await env.DB.prepare(`SELECT r.*,c.email_normalized FROM account_privacy_requests r
    JOIN customers c ON c.id=r.customer_id WHERE r.id=?`).bind(id).first();
  if (!row) throw new PrivacyError("PRIVACY_REQUEST_NOT_FOUND",404);
  if (!['REQUESTED','PROCESSING'].includes(row.status)) throw new PrivacyError("PRIVACY_REQUEST_CLOSED",409);
  if (body.action === 'process') {
    await env.DB.prepare("UPDATE account_privacy_requests SET status='PROCESSING' WHERE id=? AND status='REQUESTED'").bind(id).run();
    return {ok:true};
  }
  if (body.action !== 'complete' || row.request_type !== 'DELETE') throw new PrivacyError("INVALID_PRIVACY_ACTION");
  const note = String(body.responseNote || '').trim();
  const sentAt = new Date(body.responseSentAt || '');
  if (body.confirm !== true || note.length < 20 || note.length > 2000 || !Number.isFinite(sentAt.getTime())
      || sentAt.getTime() > Date.now() || sentAt.getTime() < Date.parse(row.requested_at)) {
    throw new PrivacyError("PRIVACY_RESPONSE_REQUIRED");
  }
  const now = new Date().toISOString();
  // Never delete orders, addresses frozen in an order, invoice/confirmation
  // archives, payments, refunds, withdrawal evidence or audit records here.
  // Everything below is executed atomically and only after explicit owner action.
  const openGuard = `EXISTS (SELECT 1 FROM account_privacy_requests WHERE id=? AND status IN ('REQUESTED','PROCESSING'))`;
  const statements = [
    env.DB.prepare(`DELETE FROM customer_addresses WHERE customer_id=? AND ${openGuard}`).bind(row.customer_id,id),
    env.DB.prepare(`DELETE FROM customer_sessions WHERE customer_id=? AND ${openGuard}`).bind(row.customer_id,id),
    env.DB.prepare(`DELETE FROM customer_login_tokens WHERE email_normalized=? AND ${openGuard}`).bind(row.email_normalized,id),
    env.DB.prepare(`UPDATE customers SET status='DELETED',email_normalized=NULL,email_verified=0,
      auth_subject=NULL,deleted_at=?,updated_at=? WHERE id=? AND ${openGuard}`).bind(now,now,row.customer_id,id),
    env.DB.prepare(`UPDATE account_privacy_requests SET status='COMPLETED',completed_at=?,response_note=?,response_sent_at=?
      WHERE id=? AND status IN ('REQUESTED','PROCESSING')`).bind(now,note,sentAt.toISOString(),id),
  ];
  const result = await env.DB.batch(statements);
  if (!Number(result.at(-1)?.meta?.changes)) throw new PrivacyError("PRIVACY_REQUEST_CLOSED",409);
  return {ok:true, completedAt:now, retained:"Geschäftsbelege und gesetzlich erforderliche Nachweise bleiben erhalten. Newsletter-Abmeldungen sind getrennt zu bearbeiten."};
}

export async function handleAdminPrivacy(request, env, url) {
  const origin = request.headers.get('Origin');
  const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization',
    'Access-Control-Allow-Credentials':'true'};
  const reply = (data,status=200) => new Response(JSON.stringify(data),{status,headers});
  try {
    if (!['https://admin.disorder119.com','http://localhost:8765','http://127.0.0.1:8765'].includes(origin)) throw new PrivacyError('ORIGIN_NOT_ALLOWED',403);
    if (origin) headers['Access-Control-Allow-Origin']=origin;
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
    // worker-entry has already verified the passkey/role and scoped ADMIN_TOKEN;
    // direct module calls still must carry the matching per-request credential.
    const supplied = String(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
    if (env.ADMIN_AUTH_CONTEXT && await timingSafeEqualText(supplied,env.ADMIN_TOKEN)) {
      if (request.method !== 'GET' && env.ADMIN_AUTH_CONTEXT.role !== 'OWNER') throw new PrivacyError('FORBIDDEN',403);
    } else await authorizeAdminRequest(request,env,request.method === 'GET'?'READER':'OWNER');
    if (!env.DB) throw new PrivacyError('COMMERCE_DATABASE_NOT_CONFIGURED',503);
    if (url.pathname !== '/admin/privacy/requests') throw new PrivacyError('NOT_FOUND',404);
    if (request.method === 'GET') return reply({ok:true,requests:await listPrivacyRequests(env)});
    if (request.method !== 'POST') throw new PrivacyError('METHOD_NOT_ALLOWED',405);
    const body = await request.json().catch(() => null);
    if (!body || Array.isArray(body)) throw new PrivacyError('INVALID_JSON');
    return reply(await updatePrivacyRequest(env,body));
  } catch (error) {
    if (error instanceof PrivacyError || error instanceof RuntimeGuardError) return reply({error:error.code},error.status);
    return reply({error:'PRIVACY_REQUEST_FAILED'},500);
  }
}
