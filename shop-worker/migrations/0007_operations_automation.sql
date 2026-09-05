-- Disorder119 automated operations alerts / task deduplication.
-- Apply after 0006_operations_cases.sql.
-- This migration adds metadata only to private D1 operations tasks. It does not
-- execute provider actions, send mail, charge/refund money or expose customer data.
PRAGMA foreign_keys = ON;

ALTER TABLE operations_tasks ADD COLUMN automation_key TEXT;
ALTER TABLE operations_tasks ADD COLUMN automation_kind TEXT;
ALTER TABLE operations_tasks ADD COLUMN auto_managed INTEGER NOT NULL DEFAULT 0 CHECK (auto_managed IN (0,1));
ALTER TABLE operations_tasks ADD COLUMN automation_active INTEGER NOT NULL DEFAULT 0 CHECK (automation_active IN (0,1));
ALTER TABLE operations_tasks ADD COLUMN first_seen_at TEXT;
ALTER TABLE operations_tasks ADD COLUMN last_seen_at TEXT;
ALTER TABLE operations_tasks ADD COLUMN occurrence_count INTEGER NOT NULL DEFAULT 0 CHECK (occurrence_count >= 0);

-- SQLite permits multiple NULL values in a UNIQUE index, so manual tasks remain
-- unrestricted while every automated condition gets one durable dedupe key.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_operations_tasks_automation_key
  ON operations_tasks(automation_key);
CREATE INDEX IF NOT EXISTS idx_operations_tasks_auto_status
  ON operations_tasks(auto_managed, automation_active, status, priority, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_operations_tasks_automation_kind
  ON operations_tasks(automation_kind, automation_active, status) WHERE auto_managed=1;
