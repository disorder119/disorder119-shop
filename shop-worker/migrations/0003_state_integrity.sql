-- Disorder119 commerce state-integrity hardening (non-destructive)
-- Apply after 0002_commerce_foundation.sql.
-- Adds database-level invariants so invalid status jumps or manipulated rental totals
-- cannot be persisted even if a future Worker/Admin code path contains a bug.
PRAGMA foreign_keys = ON;

CREATE TRIGGER IF NOT EXISTS trg_inventory_status_transition
BEFORE UPDATE OF status ON inventory
FOR EACH ROW
WHEN NEW.status <> OLD.status AND NOT (
  (OLD.status = 'AVAILABLE' AND NEW.status = 'RESERVED') OR
  (OLD.status = 'RESERVED' AND NEW.status IN ('AVAILABLE','PAYMENT_PENDING','CANCELLED')) OR
  (OLD.status = 'PAYMENT_PENDING' AND NEW.status IN ('RESERVED','PAID','CANCELLED')) OR
  (OLD.status = 'PAID' AND NEW.status IN ('PREPARING','REFUNDED')) OR
  (OLD.status = 'PREPARING' AND NEW.status IN ('SHIPPED','REFUNDED')) OR
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

CREATE TRIGGER IF NOT EXISTS trg_order_status_transition
BEFORE UPDATE OF status ON commerce_orders
FOR EACH ROW
WHEN NEW.status <> OLD.status AND NOT (
  (OLD.status = 'RESERVED' AND NEW.status IN ('PAYMENT_PENDING','CANCELLED')) OR
  (OLD.status = 'PAYMENT_PENDING' AND NEW.status IN ('PAID','CANCELLED')) OR
  (OLD.status = 'PAID' AND NEW.status IN ('PREPARING','REFUNDED')) OR
  (OLD.status = 'PREPARING' AND NEW.status IN ('SHIPPED','REFUNDED')) OR
  (OLD.status = 'SHIPPED' AND NEW.status IN ('DELIVERED','RETURN_REQUESTED')) OR
  (OLD.status = 'DELIVERED' AND NEW.status = 'RETURN_REQUESTED') OR
  (OLD.status = 'RETURN_REQUESTED' AND NEW.status = 'RETURNED') OR
  (OLD.status = 'RETURNED' AND NEW.status = 'REFUNDED')
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_order_status_transition');
END;

CREATE TRIGGER IF NOT EXISTS trg_rental_status_transition
BEFORE UPDATE OF status ON rental_reservations
FOR EACH ROW
WHEN NEW.status <> OLD.status AND NOT (
  (OLD.status = 'RESERVED' AND NEW.status IN ('PAYMENT_PENDING','CONFIRMED','CANCELLED')) OR
  (OLD.status = 'PAYMENT_PENDING' AND NEW.status IN ('RESERVED','CONFIRMED','CANCELLED')) OR
  (OLD.status = 'CONFIRMED' AND NEW.status IN ('ACTIVE','CANCELLED','REFUNDED')) OR
  (OLD.status = 'ACTIVE' AND NEW.status IN ('RETURN_DUE','RETURNED')) OR
  (OLD.status = 'RETURN_DUE' AND NEW.status = 'RETURNED') OR
  (OLD.status = 'RETURNED' AND NEW.status = 'REFUNDED')
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_rental_status_transition');
END;

CREATE TRIGGER IF NOT EXISTS trg_rental_price_integrity_insert
BEFORE INSERT ON rental_reservations
FOR EACH ROW
WHEN
  (
    NEW.price_on_request = 1 AND (
      NEW.daily_price_cents IS NOT NULL OR
      NEW.total_price_cents IS NOT NULL OR
      (SELECT sale_price_cents FROM inventory WHERE id = NEW.inventory_id) IS NOT NULL
    )
  ) OR
  (
    NEW.price_on_request = 0 AND (
      NEW.daily_price_cents IS NULL OR
      NEW.total_price_cents IS NULL OR
      NEW.daily_price_cents <= 0 OR
      NEW.total_price_cents <> NEW.daily_price_cents * NEW.days OR
      (SELECT sale_price_cents FROM inventory WHERE id = NEW.inventory_id) IS NULL OR
      NEW.daily_price_cents <> CAST(((SELECT sale_price_cents FROM inventory WHERE id = NEW.inventory_id) + 5) / 10 AS INTEGER)
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid_rental_price');
END;

CREATE TRIGGER IF NOT EXISTS trg_rental_price_integrity_update
BEFORE UPDATE OF inventory_id, days, daily_price_cents, total_price_cents, price_on_request ON rental_reservations
FOR EACH ROW
WHEN
  (
    NEW.price_on_request = 1 AND (
      NEW.daily_price_cents IS NOT NULL OR
      NEW.total_price_cents IS NOT NULL OR
      (SELECT sale_price_cents FROM inventory WHERE id = NEW.inventory_id) IS NOT NULL
    )
  ) OR
  (
    NEW.price_on_request = 0 AND (
      NEW.daily_price_cents IS NULL OR
      NEW.total_price_cents IS NULL OR
      NEW.daily_price_cents <= 0 OR
      NEW.total_price_cents <> NEW.daily_price_cents * NEW.days OR
      (SELECT sale_price_cents FROM inventory WHERE id = NEW.inventory_id) IS NULL OR
      NEW.daily_price_cents <> CAST(((SELECT sale_price_cents FROM inventory WHERE id = NEW.inventory_id) + 5) / 10 AS INTEGER)
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid_rental_price');
END;

CREATE INDEX IF NOT EXISTS idx_rental_days_reservation
  ON rental_days(rental_reservation_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_unprocessed
  ON payment_events(received_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_audit_created_at
  ON audit_events(created_at);
