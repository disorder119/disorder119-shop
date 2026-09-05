import { safeText } from "./commerce-core.js";

export const OPERATIONS_AUTOMATION_VERSION = "ops-auto-v1";
export const OPERATIONS_AUTOMATION_SCHEMA_COLUMNS = Object.freeze([
  "automation_key",
  "automation_kind",
  "auto_managed",
  "first_seen_at",
  "last_seen_at",
  "occurrence_count",
]);

const PRIORITY_WEIGHT = Object.freeze({ URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 });
const VALID_PRIORITIES = new Set(Object.keys(PRIORITY_WEIGHT));
const VALID_ENTITY_TYPES = new Set([
  "ORDER", "RENTAL", "RENTAL_GROUP", "RETURN", "REFUND", "PAYMENT",
  "SHIPMENT", "CUSTOMER", "INVENTORY", "SYSTEM",
]);
const MAX_PER_KIND = 250;
const MAX_ALERTS_PER_SYNC = 300;
const UPSERT_CHUNK_SIZE = 40;

export function buildAutomationKey(kind, sourceId) {
  const normalizedKind = safeText(kind, 80).toUpperCase().replace(/[^A-Z0-9_:-]/g, "_");
  const normalizedSource = safeText(sourceId, 180).replace(/[\r\n\t]/g, " ");
  if (!normalizedKind || !normalizedSource) return "";
  return `${OPERATIONS_AUTOMATION_VERSION}:${normalizedKind}:${normalizedSource}`;
}

export function normalizeAutomationCandidate(row) {
  if (!row || typeof row !== "object") return null;
  const kind = safeText(row.kind, 80).toUpperCase();
  const entityType = safeText(row.entityType, 30).toUpperCase();
  const entityId = safeText(row.entityId, 160);
  const sourceId = safeText(row.sourceId || entityId, 180);
  const title = safeText(row.title, 240);
  const body = safeText(row.body, 4000) || null;
  const priority = safeText(row.priority || "NORMAL", 20).toUpperCase();
  const dueAt = safeText(row.dueAt, 60) || null;
  const automationKey = buildAutomationKey(kind, sourceId);
  if (!automationKey || !VALID_ENTITY_TYPES.has(entityType) || !entityId || !title || !VALID_PRIORITIES.has(priority)) {
    return null;
  }
  return { kind, entityType, entityId, sourceId, title, body, priority, dueAt, automationKey };
}

export function rankAutomationCandidates(candidates) {
  return Array.from(candidates || []).sort((left, right) => {
    const priorityDelta = (PRIORITY_WEIGHT[left.priority] ?? 9) - (PRIORITY_WEIGHT[right.priority] ?? 9);
    if (priorityDelta) return priorityDelta;
    const dueLeft = left.dueAt || "9999";
    const dueRight = right.dueAt || "9999";
    if (dueLeft !== dueRight) return dueLeft.localeCompare(dueRight);
    return left.automationKey.localeCompare(right.automationKey);
  });
}

async function taskAutomationSchema(db) {
  const info = await db.prepare("PRAGMA table_info(operations_tasks)").all();
  const columns = new Set((info.results || []).map(row => String(row.name)));
  const missing = OPERATIONS_AUTOMATION_SCHEMA_COLUMNS.filter(name => !columns.has(name));
  return { ready: missing.length === 0, missingColumns: missing };
}

function conditionQueries(db, nowIso) {
  const limit = MAX_PER_KIND;
  return [
    db.prepare(`SELECT
        'RENTAL_GROUP_OVERDUE' AS kind,
        'RENTAL_GROUP' AS entityType,
        g.id AS entityId,
        g.id AS sourceId,
        'Mehrfachmiete überfällig' AS title,
        ('Rückgabe bis ' || g.end_date || ' · Status ' || g.status || '.') AS body,
        CASE WHEN julianday(?) - julianday(g.end_date) >= 2 THEN 'URGENT' ELSE 'HIGH' END AS priority,
        (g.end_date || 'T23:59:59.000Z') AS dueAt
      FROM rental_groups g
      WHERE g.status IN ('ACTIVE','RETURN_DUE') AND date(g.end_date) < date(?)
      ORDER BY g.end_date ASC LIMIT ${limit}`).bind(nowIso, nowIso),

    db.prepare(`SELECT
        'RENTAL_OVERDUE' AS kind,
        'RENTAL' AS entityType,
        r.id AS entityId,
        r.id AS sourceId,
        'Mietrückgabe überfällig' AS title,
        ('Rental ' || rr.id || COALESCE(' · Art.-Nr. ' || i.article_no, '') || ' · Status ' || r.status || '.') AS body,
        CASE WHEN julianday(?) - julianday(COALESCE(r.due_at,rr.end_date)) >= 2 THEN 'URGENT' ELSE 'HIGH' END AS priority,
        COALESCE(r.due_at,rr.end_date) AS dueAt
      FROM rentals r
      JOIN rental_reservations rr ON rr.id=r.rental_reservation_id
      JOIN inventory i ON i.id=r.inventory_id
      WHERE rr.group_id IS NULL
        AND r.status IN ('ACTIVE','RETURN_DUE')
        AND date(COALESCE(r.due_at,rr.end_date)) < date(?)
      ORDER BY COALESCE(r.due_at,rr.end_date) ASC LIMIT ${limit}`).bind(nowIso, nowIso),

    db.prepare(`SELECT
        'RETURN_ACTION_REQUIRED' AS kind,
        'RETURN' AS entityType,
        r.id AS entityId,
        r.id AS sourceId,
        CASE r.status
          WHEN 'REQUESTED' THEN 'Rückgabe prüfen'
          WHEN 'RECEIVED' THEN 'Rückgabe kontrollieren'
          ELSE 'Rückgabe abschließen'
        END AS title,
        ('Return ' || r.id || ' · Status ' || r.status || COALESCE(' · Grund ' || r.reason_code, '')) AS body,
        CASE WHEN r.status IN ('RECEIVED','INSPECTED') THEN 'HIGH' ELSE 'NORMAL' END AS priority,
        NULL AS dueAt
      FROM returns r
      WHERE r.status IN ('REQUESTED','RECEIVED','INSPECTED')
      ORDER BY r.created_at ASC LIMIT ${limit}`),

    db.prepare(`SELECT
        'DAMAGE_CASE_OPEN' AS kind,
        'RENTAL' AS entityType,
        d.rental_id AS entityId,
        d.id AS sourceId,
        CASE WHEN d.status='REVIEW' THEN 'Schaden in Prüfung' ELSE 'Schaden bearbeiten' END AS title,
        ('Damage Case ' || d.id || ' · ' || d.severity || ' · Status ' || d.status || '.') AS body,
        CASE WHEN d.severity IN ('MAJOR','LOST') OR d.status='REVIEW' THEN 'HIGH' ELSE 'NORMAL' END AS priority,
        NULL AS dueAt
      FROM damage_cases d
      WHERE d.status IN ('OPEN','REVIEW')
      ORDER BY CASE d.severity WHEN 'LOST' THEN 0 WHEN 'MAJOR' THEN 1 ELSE 2 END,d.created_at ASC LIMIT ${limit}`),

    db.prepare(`SELECT
        CASE WHEN rf.status='FAILED' THEN 'REFUND_FAILED' ELSE 'REFUND_STALE' END AS kind,
        'REFUND' AS entityType,
        rf.id AS entityId,
        rf.id AS sourceId,
        CASE WHEN rf.status='FAILED' THEN 'Refund fehlgeschlagen' ELSE 'Refund seit über 24 h offen' END AS title,
        ('Refund ' || rf.id || ' · Status ' || rf.status || ' · ' || printf('%.2f EUR',rf.amount_cents/100.0)) AS body,
        CASE WHEN rf.status='FAILED' THEN 'URGENT' ELSE 'HIGH' END AS priority,
        NULL AS dueAt
      FROM refunds rf
      WHERE rf.status='FAILED'
         OR (rf.status='PENDING' AND julianday(?) - julianday(COALESCE(rf.updated_at,rf.created_at)) >= 1)
      ORDER BY CASE rf.status WHEN 'FAILED' THEN 0 ELSE 1 END,rf.created_at ASC LIMIT ${limit}`).bind(nowIso),

    db.prepare(`SELECT
        CASE WHEN p.status='FAILED' THEN 'PAYMENT_FAILED' ELSE 'PAYMENT_STALE' END AS kind,
        'PAYMENT' AS entityType,
        p.id AS entityId,
        p.id AS sourceId,
        CASE WHEN p.status='FAILED' THEN 'Zahlung fehlgeschlagen' ELSE 'Zahlung seit über 24 h offen' END AS title,
        ('Payment ' || p.id || ' · ' || p.provider || ' · Status ' || p.status || '.') AS body,
        'HIGH' AS priority,
        NULL AS dueAt
      FROM payments p
      WHERE p.status='FAILED'
         OR (p.status IN ('PENDING','AUTHORIZED') AND julianday(?) - julianday(COALESCE(p.updated_at,p.created_at)) >= 1)
      ORDER BY CASE p.status WHEN 'FAILED' THEN 0 ELSE 1 END,p.created_at ASC LIMIT ${limit}`).bind(nowIso),

    db.prepare(`SELECT
        'SHIPMENT_EXCEPTION' AS kind,
        'SHIPMENT' AS entityType,
        s.id AS entityId,
        s.id AS sourceId,
        'Versandproblem prüfen' AS title,
        ('Shipment ' || s.id || COALESCE(' · ' || s.carrier, '') || ' · Status EXCEPTION.') AS body,
        'URGENT' AS priority,
        NULL AS dueAt
      FROM shipments s
      WHERE s.status='EXCEPTION'
      ORDER BY COALESCE(s.updated_at,s.created_at) ASC LIMIT ${limit}`),

    db.prepare(`SELECT
        'PAYMENT_EVENT_UNPROCESSED' AS kind,
        CASE WHEN pe.payment_id IS NULL THEN 'SYSTEM' ELSE 'PAYMENT' END AS entityType,
        COALESCE(pe.payment_id,pe.provider_event_id) AS entityId,
        pe.provider_event_id AS sourceId,
        'Payment-Event nicht verarbeitet' AS title,
        ('Provider-Event ' || pe.provider_event_id || ' · ' || pe.event_type || ' · länger als 15 Minuten offen.') AS body,
        'URGENT' AS priority,
        NULL AS dueAt
      FROM payment_events pe
      WHERE pe.processed_at IS NULL
        AND julianday(?) - julianday(pe.received_at) >= (15.0/1440.0)
      ORDER BY pe.received_at ASC LIMIT ${limit}`).bind(nowIso),
  ];
}

function upsertStatement(db, candidate, nowIso) {
  return db.prepare(`INSERT INTO operations_tasks
      (id,entity_type,entity_id,title,body,priority,status,due_at,created_at,updated_at,
       automation_key,automation_kind,auto_managed,first_seen_at,last_seen_at,occurrence_count)
    VALUES (?,?,?,?,?,?,'OPEN',?,?,?, ?,?,1,?,?,1)
    ON CONFLICT(automation_key) DO UPDATE SET
      entity_type=excluded.entity_type,
      entity_id=excluded.entity_id,
      title=excluded.title,
      body=excluded.body,
      priority=excluded.priority,
      due_at=excluded.due_at,
      automation_kind=excluded.automation_kind,
      auto_managed=1,
      first_seen_at=COALESCE(operations_tasks.first_seen_at,excluded.first_seen_at),
      last_seen_at=excluded.last_seen_at,
      occurrence_count=CASE
        WHEN operations_tasks.status='DONE' THEN operations_tasks.occurrence_count + 1
        ELSE MAX(operations_tasks.occurrence_count,1)
      END,
      status=CASE WHEN operations_tasks.status='DONE' THEN 'OPEN' ELSE operations_tasks.status END,
      completed_at=CASE WHEN operations_tasks.status='DONE' THEN NULL ELSE operations_tasks.completed_at END,
      updated_at=excluded.updated_at`).bind(
        crypto.randomUUID(),
        candidate.entityType,
        candidate.entityId,
        candidate.title,
        candidate.body,
        candidate.priority,
        candidate.dueAt,
        nowIso,
        nowIso,
        candidate.automationKey,
        candidate.kind,
        nowIso,
        nowIso,
      );
}

async function batchInChunks(db, statements, size = UPSERT_CHUNK_SIZE) {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

export async function syncOperationsAlerts(env, options = {}) {
  if (!env?.DB) {
    return { ready: false, reason: "COMMERCE_DATABASE_NOT_CONFIGURED", missingColumns: [], activeAlerts: 0 };
  }
  const db = env.DB;
  const nowDate = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(nowDate.getTime())) throw new Error("INVALID_OPERATIONS_AUTOMATION_TIME");
  const nowIso = nowDate.toISOString();
  const schema = await taskAutomationSchema(db);
  if (!schema.ready) {
    return {
      ready: false,
      reason: "MIGRATION_0007_REQUIRED",
      missingColumns: schema.missingColumns,
      generatedAt: nowIso,
      activeAlerts: 0,
    };
  }

  const queryResults = await db.batch(conditionQueries(db, nowIso));
  const sourceTruncated = queryResults.some(result => (result.results || []).length >= MAX_PER_KIND);
  const byKey = new Map();
  for (const result of queryResults) {
    for (const row of result.results || []) {
      const candidate = normalizeAutomationCandidate(row);
      if (candidate) byKey.set(candidate.automationKey, candidate);
    }
  }

  const ranked = rankAutomationCandidates(byKey.values());
  const truncated = sourceTruncated || ranked.length > MAX_ALERTS_PER_SYNC;
  const active = ranked.slice(0, MAX_ALERTS_PER_SYNC);
  await batchInChunks(db, active.map(candidate => upsertStatement(db, candidate, nowIso)));

  let autoResolved = 0;
  if (!truncated) {
    const closeResult = await db.prepare(`UPDATE operations_tasks
      SET status='DONE',completed_at=COALESCE(completed_at,?),updated_at=?
      WHERE auto_managed=1 AND automation_key IS NOT NULL
        AND status IN ('OPEN','DISMISSED')
        AND (last_seen_at IS NULL OR last_seen_at<>?)`).bind(nowIso, nowIso, nowIso).run();
    autoResolved = Number(closeResult?.meta?.changes || 0);
  }

  const state = await db.prepare(`SELECT
      COUNT(*) AS totalAutoTasks,
      SUM(CASE WHEN status='OPEN' THEN 1 ELSE 0 END) AS openAutoTasks,
      SUM(CASE WHEN status='DISMISSED' THEN 1 ELSE 0 END) AS dismissedAutoTasks,
      SUM(CASE WHEN status='DONE' THEN 1 ELSE 0 END) AS doneAutoTasks
    FROM operations_tasks WHERE auto_managed=1`).first();

  const metadata = {
    version: OPERATIONS_AUTOMATION_VERSION,
    activeAlerts: active.length,
    autoResolved,
    truncated,
    source: safeText(options.source || "ADMIN", 40) || "ADMIN",
  };
  await db.prepare(`INSERT INTO audit_events
      (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'SYSTEM','system','operations-alerts','OPERATIONS_AUTOMATION_SYNC',?,?,?)`).bind(
      crypto.randomUUID(),
      safeText(options.requestId, 160) || null,
      JSON.stringify(metadata),
      nowIso,
    ).run();

  return {
    ready: true,
    generatedAt: nowIso,
    version: OPERATIONS_AUTOMATION_VERSION,
    activeAlerts: active.length,
    autoResolved,
    truncated,
    counts: {
      totalAutoTasks: Number(state?.totalAutoTasks || 0),
      openAutoTasks: Number(state?.openAutoTasks || 0),
      dismissedAutoTasks: Number(state?.dismissedAutoTasks || 0),
      doneAutoTasks: Number(state?.doneAutoTasks || 0),
    },
  };
}
