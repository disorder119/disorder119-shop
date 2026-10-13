-- Only encrypted eBay identity data. Decryption key lives on the owner's PC.
-- Receipt is separate from deletion / documented legal retention.
CREATE TABLE IF NOT EXISTS ebay_privacy_notifications (
  id TEXT PRIMARY KEY,
  event_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  deadline TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','DELETED','NO_DATA','LEGAL_RETENTION')),
  envelope TEXT NOT NULL,
  resolved_at TEXT,
  resolution_note TEXT
);
CREATE INDEX IF NOT EXISTS ebay_privacy_notifications_pending
  ON ebay_privacy_notifications(status,received_at);

-- Same transaction as receipt: an owner-visible task cannot be lost even if
-- the laptop is offline. Never include customer identities in its title/body.
CREATE TRIGGER IF NOT EXISTS ebay_privacy_notification_task
AFTER INSERT ON ebay_privacy_notifications
BEGIN
  INSERT INTO operations_tasks(id,entity_type,entity_id,title,body,priority,status,due_at,created_at)
  VALUES('ebay-privacy:' || NEW.id,'SYSTEM',NEW.id,'eBay: Kontolöschungsmitteilung prüfen',
    'Geschützte Mitteilung unter /admin/ebay/privacy-requests exportieren und mit scripts/ebay_privacy_review.py lokal prüfen. Daten löschen oder einen konkreten gesetzlichen Aufbewahrungsgrund dokumentieren. Eingang ist noch kein Abschluss.',
    'HIGH','OPEN',NEW.deadline,NEW.received_at);
END;
CREATE TRIGGER IF NOT EXISTS ebay_privacy_task_resolution
AFTER UPDATE OF status ON ebay_privacy_notifications
WHEN NEW.status <> 'PENDING'
BEGIN
  UPDATE operations_tasks SET status='DONE',completed_at=NEW.resolved_at,updated_at=NEW.resolved_at
  WHERE id='ebay-privacy:' || NEW.id AND status <> 'DONE';
END;
CREATE TRIGGER IF NOT EXISTS ebay_privacy_task_no_silent_dismiss
BEFORE UPDATE OF status ON operations_tasks
WHEN NEW.status <> 'OPEN' AND EXISTS (
  SELECT 1 FROM ebay_privacy_notifications WHERE 'ebay-privacy:' || id=NEW.id AND status='PENDING'
)
BEGIN
  SELECT RAISE(ABORT,'ebay_privacy_resolution_required');
END;
