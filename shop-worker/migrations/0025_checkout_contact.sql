ALTER TABLE order_contact_snapshots ADD COLUMN account_requested INTEGER NOT NULL DEFAULT 0 CHECK (account_requested IN (0,1));
ALTER TABLE order_contact_snapshots ADD COLUMN account_link_queued_at TEXT;
