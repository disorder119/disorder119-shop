-- Disorder119 backend hardening v1.
-- Apply after 0007_operations_automation.sql.
-- Enforces the immutable maximum rental duration at the database boundary so a
-- future Worker/Admin path cannot persist a rental that bypasses commerce-core.
PRAGMA foreign_keys = ON;

CREATE TRIGGER IF NOT EXISTS trg_rental_duration_insert
BEFORE INSERT ON rental_reservations
FOR EACH ROW
WHEN
  NEW.days NOT BETWEEN 1 AND 7 OR
  julianday(NEW.start_date) IS NULL OR
  julianday(NEW.end_date) IS NULL OR
  CAST(julianday(NEW.end_date) - julianday(NEW.start_date) AS INTEGER) + 1 <> NEW.days
BEGIN
  SELECT RAISE(ABORT, 'invalid_rental_duration');
END;

CREATE TRIGGER IF NOT EXISTS trg_rental_duration_update
BEFORE UPDATE ON rental_reservations
FOR EACH ROW
WHEN
  NEW.days NOT BETWEEN 1 AND 7 OR
  julianday(NEW.start_date) IS NULL OR
  julianday(NEW.end_date) IS NULL OR
  CAST(julianday(NEW.end_date) - julianday(NEW.start_date) AS INTEGER) + 1 <> NEW.days
BEGIN
  SELECT RAISE(ABORT, 'invalid_rental_duration');
END;

CREATE TRIGGER IF NOT EXISTS trg_rental_group_duration_insert
BEFORE INSERT ON rental_groups
FOR EACH ROW
WHEN
  NEW.days NOT BETWEEN 1 AND 7 OR
  julianday(NEW.start_date) IS NULL OR
  julianday(NEW.end_date) IS NULL OR
  CAST(julianday(NEW.end_date) - julianday(NEW.start_date) AS INTEGER) + 1 <> NEW.days
BEGIN
  SELECT RAISE(ABORT, 'invalid_rental_group_duration');
END;

CREATE TRIGGER IF NOT EXISTS trg_rental_group_duration_update
BEFORE UPDATE ON rental_groups
FOR EACH ROW
WHEN
  NEW.days NOT BETWEEN 1 AND 7 OR
  julianday(NEW.start_date) IS NULL OR
  julianday(NEW.end_date) IS NULL OR
  CAST(julianday(NEW.end_date) - julianday(NEW.start_date) AS INTEGER) + 1 <> NEW.days
BEGIN
  SELECT RAISE(ABORT, 'invalid_rental_group_duration');
END;
