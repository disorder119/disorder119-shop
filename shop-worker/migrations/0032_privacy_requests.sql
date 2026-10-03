-- Workflow metadata only; no existing account or business records are changed.
ALTER TABLE account_privacy_requests ADD COLUMN response_note TEXT;
ALTER TABLE account_privacy_requests ADD COLUMN response_sent_at TEXT;
