-- Disorder119 operational cases / manual task foundation.
-- Apply after 0005_rental_groups.sql.
-- Provider payments/refunds remain authoritative; this migration only adds
-- internal operations records and damage documentation in private D1.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS damage_cases (
  id TEXT PRIMARY KEY,
  rental_id TEXT NOT NULL REFERENCES rentals(id),
  return_id TEXT REFERENCES returns(id),
  severity TEXT NOT NULL CHECK (severity IN ('MINOR','MAJOR','LOST','OTHER')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REVIEW','RESOLVED','WAIVED')),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 4000),
  estimated_amount_cents INTEGER CHECK (estimated_amount_cents IS NULL OR estimated_amount_cents >= 0),
  withheld_amount_cents INTEGER CHECK (withheld_amount_cents IS NULL OR withheld_amount_cents >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_damage_cases_status_created ON damage_cases(status, created_at);
CREATE INDEX IF NOT EXISTS idx_damage_cases_rental ON damage_cases(rental_id, created_at);
CREATE INDEX IF NOT EXISTS idx_damage_cases_return ON damage_cases(return_id) WHERE return_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS operations_tasks (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('ORDER','RENTAL','RENTAL_GROUP','RETURN','REFUND','PAYMENT','SHIPMENT','CUSTOMER','INVENTORY','SYSTEM')),
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  body TEXT CHECK (body IS NULL OR length(body) <= 4000),
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE','DISMISSED')),
  due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_operations_tasks_status_priority ON operations_tasks(status, priority, due_at, created_at);
CREATE INDEX IF NOT EXISTS idx_operations_tasks_entity ON operations_tasks(entity_type, entity_id, created_at);
