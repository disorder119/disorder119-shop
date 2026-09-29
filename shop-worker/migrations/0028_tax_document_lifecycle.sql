-- Keep document identity/hash immutable while allowing a later transition from
-- METADATA_ONLY/REVIEW_REQUIRED to a verified private archive location.
PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS tax_documents_no_update;

CREATE TRIGGER IF NOT EXISTS tax_documents_content_no_update
BEFORE UPDATE OF document_type,original_filename,mime_type,byte_length,sha256,source_reference,created_at
ON tax_documents
BEGIN
  SELECT RAISE(ABORT,'tax_document_identity_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS tax_documents_archive_state_valid
BEFORE UPDATE OF storage_state,storage_key ON tax_documents
WHEN NEW.storage_state='ARCHIVED' AND (NEW.storage_key IS NULL OR length(trim(NEW.storage_key))=0)
BEGIN
  SELECT RAISE(ABORT,'archived_document_requires_storage_key');
END;

-- Once ARCHIVED, moving back to an unarchived state would make a previously
-- verified tax package weaker. A missing/corrupt object must instead be flagged
-- by a separate issue/correction record, never by erasing the historical fact.
CREATE TRIGGER IF NOT EXISTS tax_documents_archive_no_downgrade
BEFORE UPDATE OF storage_state ON tax_documents
WHEN OLD.storage_state='ARCHIVED' AND NEW.storage_state!='ARCHIVED'
BEGIN
  SELECT RAISE(ABORT,'archived_document_state_cannot_be_downgraded');
END;
