-- AirdeskLogger schema. UTC-only, append-only audit trail, signature locking.
-- All timestamps are timestamptz stored in UTC; the application refuses any
-- non-UTC input before it ever reaches the database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Pilots / signers. A signer (instructor/examiner/supervising PIC) is also a row
-- here; their public key is retained so signatures stay verifiable forever.
CREATE TABLE IF NOT EXISTS pilots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  license_number text,
  public_key     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Logical entry: a stable id plus the mutable "head" metadata (which version is
-- current, and whether sign-off has locked it). The canonical flight data lives
-- in the append-only versions table, never here.
CREATE TABLE IF NOT EXISTS flight_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_id        uuid NOT NULL REFERENCES pilots(id),
  current_version integer NOT NULL DEFAULT 0,
  locked          boolean NOT NULL DEFAULT false,
  locked_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Append-only snapshots. A modification is a NEW row, never an UPDATE. The full
-- 12-column payload is stored as jsonb (times as UTC ISO strings) alongside its
-- content hash, which the ledger and signatures reference.
CREATE TABLE IF NOT EXISTS flight_entry_versions (
  entry_id     uuid NOT NULL REFERENCES flight_entries(id),
  version_no   integer NOT NULL,
  content      jsonb NOT NULL,
  content_hash text NOT NULL,
  change_reason text,
  created_by   uuid NOT NULL REFERENCES pilots(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, version_no)
);

-- Cryptographic sign-off. Presence of a row here flips flight_entries.locked.
CREATE TABLE IF NOT EXISTS signatures (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id     uuid NOT NULL REFERENCES flight_entries(id),
  version_no   integer NOT NULL,
  signer_id    uuid NOT NULL REFERENCES pilots(id),
  signer_role  text NOT NULL CHECK (signer_role IN ('INSTRUCTOR','EXAMINER','SUPERVISING_PIC')),
  content_hash text NOT NULL,
  signature    text NOT NULL,
  public_key   text NOT NULL,
  signed_at    timestamptz NOT NULL,
  FOREIGN KEY (entry_id, version_no) REFERENCES flight_entry_versions(entry_id, version_no)
);

-- Global tamper-evident ledger: one chained record per mutation across the whole
-- logbook. seq is contiguous from 0; record_hash chains via prev_hash.
CREATE TABLE IF NOT EXISTS audit_ledger (
  seq          bigint PRIMARY KEY,
  prev_hash    text NOT NULL,
  event_type   text NOT NULL CHECK (event_type IN ('CREATE','MODIFY','SIGN','VOID')),
  entry_id     uuid NOT NULL REFERENCES flight_entries(id),
  payload_hash text NOT NULL,
  actor_id     uuid NOT NULL REFERENCES pilots(id),
  recorded_at  timestamptz NOT NULL,
  record_hash  text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_versions_entry ON flight_entry_versions(entry_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entry ON audit_ledger(entry_id);

-- ---- Immutability enforcement -------------------------------------------------

-- Reject any UPDATE/DELETE on append-only tables at the database level, so the
-- audit trail cannot be rewritten even by a direct SQL connection.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_versions_immutable ON flight_entry_versions;
CREATE TRIGGER trg_versions_immutable
  BEFORE UPDATE OR DELETE ON flight_entry_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DROP TRIGGER IF EXISTS trg_signatures_immutable ON signatures;
CREATE TRIGGER trg_signatures_immutable
  BEFORE UPDATE OR DELETE ON signatures
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DROP TRIGGER IF EXISTS trg_ledger_immutable ON audit_ledger;
CREATE TRIGGER trg_ledger_immutable
  BEFORE UPDATE OR DELETE ON audit_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Once an entry is locked by sign-off, no further versions may be appended.
CREATE OR REPLACE FUNCTION forbid_version_when_locked() RETURNS trigger AS $$
DECLARE is_locked boolean;
BEGIN
  SELECT locked INTO is_locked FROM flight_entries WHERE id = NEW.entry_id;
  IF is_locked THEN
    RAISE EXCEPTION 'Entry % is locked by sign-off; no further edits permitted', NEW.entry_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_no_edit_when_locked ON flight_entry_versions;
CREATE TRIGGER trg_no_edit_when_locked
  BEFORE INSERT ON flight_entry_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_version_when_locked();

-- ---- Accounts and authentication ----------------------------------------------

-- The pilots table doubles as the account table: a holder, instructor or
-- examiner all authenticate as a row here. These columns are added with IF NOT
-- EXISTS so the migration stays idempotent on an existing database.
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS email              text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS address            text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS first_name         text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS last_name          text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS date_of_birth      date;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS email_verified     boolean NOT NULL DEFAULT false;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS email_verification_token text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS password_hash      text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS roles              text[] NOT NULL DEFAULT '{PILOT}';
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS mfa_secret_wrapped text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS mfa_enabled        boolean NOT NULL DEFAULT false;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS mfa_activated_at   timestamptz;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS signing_public_key text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS signing_key_wrapped text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS updated_at         timestamptz NOT NULL DEFAULT now();

-- One account per email address, case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pilots_email ON pilots (lower(email)) WHERE email IS NOT NULL;

-- Security log, separate from the flight audit trail. Records who authenticated
-- and when, and every second-factor step-up used to sign an entry. Append-only,
-- like the flight trail, so it cannot be quietly edited after the fact. A failed
-- login keeps the attempted email but no user id.
CREATE TABLE IF NOT EXISTS account_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES pilots(id),
  email       text,
  event_type  text NOT NULL CHECK (event_type IN
                ('REGISTER','LOGIN_SUCCESS','LOGIN_FAILED','MFA_SETUP','MFA_ACTIVATED','SIGN_STEP_UP','SIGN_STEP_UP_FAILED')),
  detail      jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_events_user ON account_events(user_id);

DROP TRIGGER IF EXISTS trg_account_events_immutable ON account_events;
CREATE TRIGGER trg_account_events_immutable
  BEFORE UPDATE OR DELETE ON account_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
