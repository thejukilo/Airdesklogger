/**
 * Loads everything an export needs in the shape the PDF wants.
 *
 * FOCA 2.5 requires an export to carry, beyond the AMC1 FCL.050 columns, the
 * applied attributes, the signatures, and the complete change log; and FOCA
 * 2.4.6 requires entries that need a signature but lack one to be flagged. This
 * module assembles that from the stored versions, signatures and ledger so the
 * PDF can render it. Each stored signature is re-verified here, so the export
 * reflects the cryptographic truth rather than a trusted flag.
 */

import { getPool } from "./pool.js";
import { verifySignature } from "../domain/signature.js";
import type { SignerRole } from "../domain/signature.js";
import type { DerivedColumns } from "../domain/types.js";
import type { LogbookEntryForPdf } from "../pdf/logbook.js";

export interface ExportSignature {
  signerName: string;
  signerRole: SignerRole;
  signedAt: string;
  signerLicense: string | null;
  signedPlace: string | null;
  valid: boolean;
}

export interface ExportVersion {
  versionNo: number;
  createdAt: string;
  changeReason: string | null;
  createdByName: string;
  contentHash: string;
}

export interface ExportEntry {
  entryId: string;
  row: LogbookEntryForPdf;
  signatures: ExportSignature[];
  history: ExportVersion[];
}

/** Rebuild the derived columns from stored JSON, reviving the two Date fields. */
function reviveColumns(columns: Record<string, unknown>): DerivedColumns {
  return {
    ...(columns as unknown as DerivedColumns),
    departureTime: new Date(columns.departureTime as string),
    arrivalTime: new Date(columns.arrivalTime as string),
  };
}

function toRow(
  content: Record<string, unknown>,
  signed: boolean,
  signatureMissing: boolean,
  signatures: ExportSignature[],
): LogbookEntryForPdf {
  const columns = reviveColumns(content.columns as Record<string, unknown>);
  const aircraft = content.aircraft as { makeModelVariant?: string; registration?: string } | undefined;
  // Per FOCA 2.4.3 the signer's name and licence appear with the entry; we
  // build a compact summary the PDF can print alongside the remarks.
  const signedSummary = signatures
    .filter((s) => s.valid)
    .map((s) => {
      const lic = s.signerLicense ? ` (${s.signerLicense})` : "";
      const place = s.signedPlace ? ` at ${s.signedPlace}` : "";
      const date = s.signedAt.slice(0, 10);
      return `${s.signerName}${lic}${place} on ${date}`;
    })
    .join("; ");
  return {
    ...columns,
    aircraftType: aircraft?.makeModelVariant ?? "",
    aircraftReg: aircraft?.registration ?? "",
    picName: (content.picName as string) ?? "",
    remarks: (content.remarks as string) ?? "",
    signed,
    signatureMissing,
    ...(signedSummary ? { signedSummary } : {}),
  };
}

export interface ExportRange {
  from?: string | undefined; // yyyy-mm-dd inclusive
  to?: string | undefined; // yyyy-mm-dd inclusive
}

export interface DeletedEntry {
  date: string;
  aircraft: string;
  voidedAt: string;
}

/**
 * Flights deleted after the 48-hour window (void_logged), which FOCA 2.3.7
 * requires to appear in the export change log even though the flight itself no
 * longer counts.
 */
export async function loadDeletionsForExport(pilotId: string, range: ExportRange = {}): Promise<DeletedEntry[]> {
  const { rows } = await getPool().query(
    `SELECT e.voided_at,
            v.content->'columns'->>'date' AS date,
            COALESCE(v.content->'aircraft'->>'registration', '') AS reg
       FROM flight_entries e
       JOIN flight_entry_versions v ON v.entry_id = e.id AND v.version_no = e.current_version
      WHERE e.pilot_id = $1 AND e.voided = true AND e.void_logged = true
        AND v.content->'columns'->>'date' >= COALESCE($2, '0000-01-01')
        AND v.content->'columns'->>'date' <= COALESCE($3, '9999-12-31')
      ORDER BY v.content->'columns'->>'date' ASC`,
    [pilotId, range.from ?? null, range.to ?? null],
  );
  return rows.map((r) => ({
    date: (r.date as string) ?? "",
    aircraft: (r.reg as string) ?? "",
    voidedAt: r.voided_at ? new Date(r.voided_at).toISOString().replace(/\.\d{3}Z$/, "Z") : "",
  }));
}

export async function loadLogbookForExport(
  pilotId: string,
  range: ExportRange = {},
): Promise<ExportEntry[]> {
  const pool = getPool();

  // Dates are stored as yyyy-mm-dd strings, so a lexicographic comparison is a
  // correct date comparison. A range lets an export cover just a revalidation
  // period (FOCA 2.5.1).
  const { rows: entryRows } = await pool.query(
    `SELECT e.id, e.locked, e.current_version,
            v.content
       FROM flight_entries e
       JOIN flight_entry_versions v ON v.entry_id = e.id AND v.version_no = e.current_version
      WHERE e.pilot_id = $1 AND e.voided = false
        AND v.content->'columns'->>'date' >= COALESCE($2, '0000-01-01')
        AND v.content->'columns'->>'date' <= COALESCE($3, '9999-12-31')
      ORDER BY v.content->'columns'->>'date' ASC, e.created_at ASC`,
    [pilotId, range.from ?? null, range.to ?? null],
  );
  if (entryRows.length === 0) return [];

  const ids = entryRows.map((r) => r.id as string);

  const { rows: sigRows } = await pool.query(
    `SELECT s.entry_id, s.version_no, s.signer_role, s.content_hash, s.signature, s.public_key, s.signed_at,
            s.signer_id, COALESCE(s.signer_name, p.name) AS signer_name, s.signer_license, s.signed_place
       FROM signatures s LEFT JOIN pilots p ON p.id = s.signer_id
      WHERE s.entry_id = ANY($1::uuid[])
      ORDER BY s.signed_at ASC`,
    [ids],
  );
  const currentVersionByEntry = new Map<string, number>(entryRows.map((r) => [r.id as string, Number(r.current_version)]));

  const { rows: histRows } = await pool.query(
    `SELECT v.entry_id, v.version_no, v.change_reason, v.content_hash, v.created_at, p.name AS by_name
       FROM flight_entry_versions v JOIN pilots p ON p.id = v.created_by
      WHERE v.entry_id = ANY($1::uuid[]) AND v.logged = true
      ORDER BY v.entry_id, v.version_no ASC`,
    [ids],
  );

  const signaturesByEntry = new Map<string, ExportSignature[]>();
  const anySignature = new Set<string>();
  const currentValid = new Set<string>();
  for (const s of sigRows) {
    anySignature.add(s.entry_id);
    const valid = verifySignature({
      entryId: s.entry_id,
      contentHash: s.content_hash,
      signerId: s.signer_id,
      signerRole: s.signer_role,
      signedAt: new Date(s.signed_at).toISOString().replace(/\.\d{3}Z$/, "Z"),
      signature: s.signature,
      publicKey: s.public_key,
    });
    // Only a signature on the current version counts as a present sign-off; a
    // signature on a superseded version was invalidated by a later edit.
    const isCurrent = Number(s.version_no) === currentVersionByEntry.get(s.entry_id);
    if (isCurrent && valid) currentValid.add(s.entry_id);
    if (!isCurrent) continue;
    const list = signaturesByEntry.get(s.entry_id) ?? [];
    list.push({
      signerName: s.signer_name,
      signerRole: s.signer_role,
      signedAt: new Date(s.signed_at).toISOString().replace(/\.\d{3}Z$/, "Z"),
      signerLicense: (s.signer_license as string) ?? null,
      signedPlace: (s.signed_place as string) ?? null,
      valid,
    });
    signaturesByEntry.set(s.entry_id, list);
  }

  const historyByEntry = new Map<string, ExportVersion[]>();
  for (const h of histRows) {
    const list = historyByEntry.get(h.entry_id) ?? [];
    list.push({
      versionNo: Number(h.version_no),
      createdAt: new Date(h.created_at).toISOString().replace(/\.\d{3}Z$/, "Z"),
      changeReason: h.change_reason ?? null,
      createdByName: h.by_name,
      contentHash: h.content_hash,
    });
    historyByEntry.set(h.entry_id, list);
  }

  return entryRows.map((e) => {
    const signatures = signaturesByEntry.get(e.id) ?? [];
    const signed = currentValid.has(e.id);
    const columns = (e.content as { columns?: { signatureRequired?: boolean } }).columns ?? {};
    // Flag a missing signature when the entry needs one (a check/test attribute)
    // or was previously signed and the sign-off has since been invalidated.
    const signatureMissing = (Boolean(columns.signatureRequired) || anySignature.has(e.id)) && !signed;
    return {
      entryId: e.id as string,
      row: toRow(e.content, signed, signatureMissing, signatures),
      signatures,
      history: historyByEntry.get(e.id) ?? [],
    };
  });
}
