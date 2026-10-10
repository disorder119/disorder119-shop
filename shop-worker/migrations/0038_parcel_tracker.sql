-- Private mobile parcel tracker for manually entered incoming/outgoing parcels.
-- Shop orders continue to use the existing shipments table and are merged into
-- the app view at read time.
CREATE TABLE IF NOT EXISTS parcel_tracker_manual (
  id TEXT PRIMARY KEY,
  tracking_number TEXT NOT NULL UNIQUE,
  label TEXT,
  carrier TEXT,
  direction TEXT NOT NULL DEFAULT 'IN' CHECK (direction IN ('IN','OUT','RETURN')),
  platform TEXT,
  external_ref TEXT,
  status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (status IN (
    'UNKNOWN','INFO_RECEIVED','IN_TRANSIT','OUT_FOR_DELIVERY','PICKUP_READY','DELIVERED','EXCEPTION','RETURNED'
  )),
  status_text TEXT,
  eta_date TEXT,
  eta_latest TEXT,
  eta_from TEXT,
  eta_to TEXT,
  location TEXT,
  delivered_at TEXT,
  track17_registered INTEGER NOT NULL DEFAULT 0 CHECK (track17_registered IN (0,1)),
  track17_carrier INTEGER,
  track17_events_json TEXT,
  track17_expired INTEGER NOT NULL DEFAULT 0 CHECK (track17_expired IN (0,1)),
  track17_last_sync TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parcel_tracker_manual_status ON parcel_tracker_manual(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_parcel_tracker_manual_direction ON parcel_tracker_manual(direction, updated_at);

