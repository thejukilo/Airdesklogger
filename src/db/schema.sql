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
  voided          boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- An unsigned entry can be removed from the logbook by voiding it: the row and
-- its history stay for the audit trail, but it no longer appears or counts. A
-- void after the 48-hour window is logged (void_logged) and shown on the export.
ALTER TABLE flight_entries ADD COLUMN IF NOT EXISTS voided boolean NOT NULL DEFAULT false;
ALTER TABLE flight_entries ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE flight_entries ADD COLUMN IF NOT EXISTS void_logged boolean NOT NULL DEFAULT false;

-- Append-only snapshots. A modification is a NEW row, never an UPDATE. The full
-- 12-column payload is stored as jsonb (times as UTC ISO strings) alongside its
-- content hash, which the ledger and signatures reference.
CREATE TABLE IF NOT EXISTS flight_entry_versions (
  entry_id     uuid NOT NULL REFERENCES flight_entries(id),
  version_no   integer NOT NULL,
  content      jsonb NOT NULL,
  content_hash text NOT NULL,
  change_reason text,
  logged       boolean NOT NULL DEFAULT true,
  created_by   uuid NOT NULL REFERENCES pilots(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, version_no)
);
-- A change made within 48 hours of the initial entry need not appear in the
-- exported change log (FOCA 2.3.7); such a version is recorded with logged=false.
ALTER TABLE flight_entry_versions ADD COLUMN IF NOT EXISTS logged boolean NOT NULL DEFAULT true;

-- Cryptographic sign-off. Presence of a row here flips flight_entries.locked.
CREATE TABLE IF NOT EXISTS signatures (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id     uuid NOT NULL REFERENCES flight_entries(id),
  version_no   integer NOT NULL,
  signer_id    uuid NOT NULL REFERENCES pilots(id),
  signer_role  text NOT NULL,
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
-- Address kept as structured parts (FOCA 2.1.3); `address` holds the composed
-- one-line form used on the export.
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS address_street     text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS address_zip        text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS address_country    text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS first_name         text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS last_name          text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS date_of_birth      date;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS email_verified     boolean NOT NULL DEFAULT false;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS email_verification_token text;
-- Self-declared professional credentials. Holding an instructor or examiner
-- certificate is what lets a user countersign in that capacity; the number is
-- recorded on every sign-off they make.
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS instructor_certificate text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS examiner_certificate   text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS password_hash      text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS roles              text[] NOT NULL DEFAULT '{PILOT}';
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS mfa_secret_wrapped text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS mfa_enabled        boolean NOT NULL DEFAULT false;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS mfa_activated_at   timestamptz;
-- When true, the second factor is also required at sign-in, not only for signing.
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS mfa_required_for_login boolean NOT NULL DEFAULT false;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS signing_public_key text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS signing_key_wrapped text;
-- Password reset: a hashed, single-use, time-limited token (FOCA-agnostic, a
-- standard account-recovery measure). The token itself is only ever emailed.
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS password_reset_token_hash  text;
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS password_reset_expires_at  timestamptz;
-- Preferred paper size for the PDF export ('A4' or 'LETTER').
ALTER TABLE pilots ADD COLUMN IF NOT EXISTS export_paper_size  text NOT NULL DEFAULT 'A4';
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
                ('REGISTER','LOGIN_SUCCESS','LOGIN_FAILED','MFA_SETUP','MFA_ACTIVATED','SIGN_STEP_UP','SIGN_STEP_UP_FAILED','PASSWORD_RESET_REQUEST')),
  detail      jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Keep the allowed event types in sync on a database that predates a new one.
ALTER TABLE account_events DROP CONSTRAINT IF EXISTS account_events_event_type_check;
ALTER TABLE account_events ADD CONSTRAINT account_events_event_type_check CHECK (event_type IN
  ('REGISTER','LOGIN_SUCCESS','LOGIN_FAILED','MFA_SETUP','MFA_ACTIVATED','SIGN_STEP_UP','SIGN_STEP_UP_FAILED','PASSWORD_RESET_REQUEST'));

CREATE INDEX IF NOT EXISTS idx_account_events_user ON account_events(user_id);

DROP TRIGGER IF EXISTS trg_account_events_immutable ON account_events;
CREATE TRIGGER trg_account_events_immutable
  BEFORE UPDATE OR DELETE ON account_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---- Reference data (FOCA 2.3.2, 2.3.3) ---------------------------------------

-- Airports the provider maintains. Places on an entry must be a code present
-- here, or the no-location indicator ZZZZ. Seed with the ICAO dataset in
-- production; the reference endpoint can load it.
CREATE TABLE IF NOT EXISTS airports (
  icao       char(4) PRIMARY KEY,
  name       text NOT NULL,
  country    text,
  latitude   double precision,
  longitude  double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Coordinates are used to compute night time automatically (FOCA 2.3.4). Added
-- with IF NOT EXISTS so the migration stays idempotent on an existing database.
ALTER TABLE airports ADD COLUMN IF NOT EXISTS latitude  double precision;
ALTER TABLE airports ADD COLUMN IF NOT EXISTS longitude double precision;

-- Aircraft, with the properties FOCA asks for. A registration may appear more
-- than once over its life (variant change, re-registration), distinguished by
-- valid_from, so the entry refers to the record current at the flight date.
CREATE TABLE IF NOT EXISTS aircraft (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration    text NOT NULL,
  model           text NOT NULL,
  icao_type       text,
  variant         text,
  category        text NOT NULL CHECK (category IN ('AEROPLANE','HELICOPTER','SAILPLANE','BALLOON')),
  engine_type     text,
  engine_count    integer,
  multi_pilot     boolean NOT NULL DEFAULT false,
  balloon_group   text,
  valid_from      date NOT NULL DEFAULT '1970-01-01',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registration, valid_from)
);

CREATE INDEX IF NOT EXISTS idx_aircraft_registration ON aircraft (registration);

-- ICAO Doc 8643 type designators. A registration lookup gives an aircraft's
-- ICAO type code (e.g. EC35, PC12, BALL); this table says what that code is
-- (LandPlane, Helicopter, Balloon, ...), which classifies the Part-FCL category
-- and prefills the engine fields. Reference data the provider maintains: seed it
-- from the bundled list with `npm run seed:icao-types`.
CREATE TABLE IF NOT EXISTS icao_types (
  code           text PRIMARY KEY,
  description    text NOT NULL,
  aircraft_model text,
  engine_type    text,
  engine_count   integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- The Doc 8643 "role" (e.g. Glider, Motor-Glider), which distinguishes types
-- that may be logged under more than one category (a motor-glider as an
-- aeroplane or a sailplane). Added with IF NOT EXISTS for an existing database.
ALTER TABLE icao_types ADD COLUMN IF NOT EXISTS role text;
-- A representative model name for the type designator, so a registration that
-- carries only the ICAO type can still show a human model name.
ALTER TABLE icao_types ADD COLUMN IF NOT EXISTS aircraft_model text;

-- Synthetic training devices, including kind and level (FNPT I/II, FTD, FFS).
CREATE TABLE IF NOT EXISTS fstd_devices (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_number text NOT NULL UNIQUE,
  device_kind          text NOT NULL CHECK (device_kind IN ('FNPT_I','FNPT_II','FTD','FFS','BITD','OTHER')),
  level                text,
  aircraft_type        text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Certified simulators (FSTDs) the pilot can log a session against, picked by
-- autocomplete on the EASA code or serial number. Seeded from the bundled list
-- (npm run seed:simulators); users may also add a device that is not yet listed.
-- easa_code is not unique in the source data (a code can cover several devices),
-- so the key is synthetic and easa_code/serial_number are indexed for search.
CREATE TABLE IF NOT EXISTS simulators (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  easa_code             text NOT NULL,
  serial_number         text,
  aircraft_type         text,
  qualification         text,
  eval_type             text,
  aircraft_manufacturer text,
  sim_manufacturer      text,
  location              text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_simulators_easa_code ON simulators (lower(easa_code));
CREATE INDEX IF NOT EXISTS idx_simulators_serial ON simulators (lower(serial_number));

-- Permitted signer roles (FOCA 2.4.1). A named constraint so it can be updated
-- on an existing database; the older inline constraint is dropped if present.
ALTER TABLE signatures DROP CONSTRAINT IF EXISTS signatures_signer_role_check;
ALTER TABLE signatures DROP CONSTRAINT IF EXISTS signatures_signer_role_ck;
ALTER TABLE signatures ADD CONSTRAINT signatures_signer_role_ck
  CHECK (signer_role IN ('INSTRUCTOR','EXAMINER','SUPERVISING_PIC','ATO','DTO','HOT','AIRPORT','OTHER'));

-- The handwritten signature image FOCA 2.4.3 accepts (a PNG data URL drawn on a
-- device screen). The signatures table is append-only, so once stored it cannot
-- be altered. The Ed25519 signature remains the integrity proof; the image is
-- the human-facing signature.
ALTER TABLE signatures ADD COLUMN IF NOT EXISTS signature_image text;
-- Snapshot of who signed, captured at signing time so it is stable and works
-- for an external signer who has no account (filled in the one-time-link flow).
ALTER TABLE signatures ADD COLUMN IF NOT EXISTS signer_name    text;
ALTER TABLE signatures ADD COLUMN IF NOT EXISTS signer_email   text;
ALTER TABLE signatures ADD COLUMN IF NOT EXISTS signer_license text;
-- An external signer (one-time link) has no account, so the FK signer_id is null
-- for them and the snapshot columns above carry who signed.
ALTER TABLE signatures ALTER COLUMN signer_id DROP NOT NULL;

-- One-time signing links for external instructors/examiners who do not have an
-- account. Only the token hash is stored; the link carries the token. A request
-- is single-use (used_at) and expires.
CREATE TABLE IF NOT EXISTS signoff_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id     uuid NOT NULL REFERENCES flight_entries(id),
  token_hash   text NOT NULL UNIQUE,
  signer_name  text NOT NULL,
  signer_email text NOT NULL,
  capacity     text NOT NULL,
  created_by   uuid NOT NULL REFERENCES pilots(id),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signoff_requests_entry ON signoff_requests(entry_id);
