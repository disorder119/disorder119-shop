-- Zahlung beim Kauf nur reservieren, beim Versand einziehen (PayPal intent
-- AUTHORIZE). Ein Storno vor dem Versand gibt die Reservierung frei: keine
-- PayPal-Gebuehr, kein Guthaben noetig, nichts zu erstatten.
PRAGMA foreign_keys = ON;

ALTER TABLE payments ADD COLUMN authorization_id TEXT;
ALTER TABLE payments ADD COLUMN authorized_at TEXT;
-- Bis hierhin zieht der Shop spaetestens ein (Ende der PayPal-Garantiezeit
-- von drei Tagen, mit Sicherheitsabstand).
ALTER TABLE payments ADD COLUMN capture_due_at TEXT;
ALTER TABLE payments ADD COLUMN authorization_expires_at TEXT;
ALTER TABLE payments ADD COLUMN capture_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN capture_last_attempt_at TEXT;
ALTER TABLE payments ADD COLUMN capture_error TEXT;
ALTER TABLE payments ADD COLUMN voided_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payments_authorization ON payments(authorization_id)
  WHERE authorization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_capture_due ON payments(status, capture_due_at);

-- Erstattungsauftrag: Geld zurueck (ERSTATTET) oder Reservierung freigegeben.
ALTER TABLE erstattungsauftraege ADD COLUMN ergebnis TEXT
  CHECK (ergebnis IS NULL OR ergebnis IN ('ERSTATTET','FREIGEGEBEN'));

-- "Bezahlt" und "Wird gepackt" duerfen jetzt auf "Storniert": das ist der
-- Storno einer nur reservierten Zahlung. updateOrder laesst CANCELLED nur zu,
-- wenn keine reservierte oder eingezogene Zahlung mehr besteht.
DROP TRIGGER IF EXISTS trg_order_status_transition;
CREATE TRIGGER trg_order_status_transition
BEFORE UPDATE OF status ON commerce_orders
FOR EACH ROW
WHEN NEW.status <> OLD.status AND NOT (
  (OLD.status = 'RESERVED' AND NEW.status IN ('PAYMENT_PENDING','CANCELLED')) OR
  (OLD.status = 'PAYMENT_PENDING' AND NEW.status IN ('PAID','CANCELLED')) OR
  (OLD.status = 'PAID' AND NEW.status IN ('PREPARING','REFUNDED','CANCELLED')) OR
  (OLD.status = 'PREPARING' AND NEW.status IN ('SHIPPED','REFUNDED','CANCELLED')) OR
  (OLD.status = 'SHIPPED' AND NEW.status IN ('DELIVERED','RETURN_REQUESTED')) OR
  (OLD.status = 'DELIVERED' AND NEW.status = 'RETURN_REQUESTED') OR
  (OLD.status = 'RETURN_REQUESTED' AND NEW.status = 'RETURNED') OR
  (OLD.status = 'RETURNED' AND NEW.status = 'REFUNDED')
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_order_status_transition');
END;

DROP TRIGGER IF EXISTS trg_inventory_status_transition;
CREATE TRIGGER trg_inventory_status_transition
BEFORE UPDATE OF status ON inventory
FOR EACH ROW
WHEN NEW.status <> OLD.status AND NOT (
  (OLD.status = 'AVAILABLE' AND NEW.status = 'RESERVED') OR
  (OLD.status = 'RESERVED' AND NEW.status IN ('AVAILABLE','PAYMENT_PENDING','CANCELLED')) OR
  (OLD.status = 'PAYMENT_PENDING' AND NEW.status IN ('RESERVED','PAID','CANCELLED')) OR
  (OLD.status = 'PAID' AND NEW.status IN ('PREPARING','REFUNDED','CANCELLED')) OR
  (OLD.status = 'PREPARING' AND NEW.status IN ('SHIPPED','REFUNDED','CANCELLED')) OR
  (OLD.status = 'SHIPPED' AND NEW.status IN ('DELIVERED','RETURN_REQUESTED')) OR
  (OLD.status = 'DELIVERED' AND NEW.status = 'RETURN_REQUESTED') OR
  (OLD.status = 'RETURN_REQUESTED' AND NEW.status = 'RETURNED') OR
  (OLD.status = 'RETURNED' AND NEW.status IN ('REFUNDED','AVAILABLE')) OR
  (OLD.status = 'REFUNDED' AND NEW.status = 'AVAILABLE') OR
  (OLD.status = 'CANCELLED' AND NEW.status = 'AVAILABLE')
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_inventory_status_transition');
END;
