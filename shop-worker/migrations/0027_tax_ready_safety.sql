-- Tax Ready 2026 safety rules.
-- Once an accounting source record has produced immutable ledger events, it may
-- not be silently voided or moved to another payment date. Corrections require
-- explicit reversal/correction events so the audit trail remains reproducible.
PRAGMA foreign_keys = ON;

CREATE TRIGGER IF NOT EXISTS tax_purchase_booked_no_void
BEFORE UPDATE OF status ON tax_purchases
WHEN NEW.status='VOID'
 AND EXISTS (SELECT 1 FROM tax_ledger_events e WHERE e.purchase_id=OLD.id)
BEGIN
  SELECT RAISE(ABORT,'tax_purchase_has_booked_cash_reversal_required');
END;

CREATE TRIGGER IF NOT EXISTS tax_purchase_booked_no_payment_date_change
BEFORE UPDATE OF payment_date ON tax_purchases
WHEN EXISTS (SELECT 1 FROM tax_ledger_events e WHERE e.purchase_id=OLD.id)
 AND NEW.payment_date IS NOT OLD.payment_date
BEGIN
  SELECT RAISE(ABORT,'tax_purchase_payment_date_locked_after_booking');
END;

-- A PATCH from DRAFT/REVIEW_REQUIRED to CONFIRMED is only safe when the cash
-- side already exists. New purchases created as CONFIRMED are handled by the
-- API's creation flow, which immediately appends the cash event(s).
CREATE TRIGGER IF NOT EXISTS tax_purchase_update_confirm_requires_cash
BEFORE UPDATE OF status ON tax_purchases
WHEN NEW.status='CONFIRMED' AND OLD.status!='CONFIRMED'
 AND NOT EXISTS (SELECT 1 FROM tax_ledger_events e WHERE e.purchase_id=OLD.id AND e.event_type='PURCHASE')
BEGIN
  SELECT RAISE(ABORT,'tax_purchase_confirmation_requires_cash_event');
END;

CREATE TRIGGER IF NOT EXISTS tax_expense_booked_no_void
BEFORE UPDATE OF status ON tax_expense_events
WHEN NEW.status='VOID'
 AND EXISTS (SELECT 1 FROM tax_ledger_events e WHERE e.expense_id=OLD.id)
BEGIN
  SELECT RAISE(ABORT,'tax_expense_has_booked_cash_reversal_required');
END;

CREATE TRIGGER IF NOT EXISTS tax_expense_booked_no_payment_date_change
BEFORE UPDATE OF payment_date ON tax_expense_events
WHEN EXISTS (SELECT 1 FROM tax_ledger_events e WHERE e.expense_id=OLD.id)
 AND NEW.payment_date IS NOT OLD.payment_date
BEGIN
  SELECT RAISE(ABORT,'tax_expense_payment_date_locked_after_booking');
END;
