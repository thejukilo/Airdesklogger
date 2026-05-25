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

function toRow(entryId: string, content: Record<string, unknown>, signed: boolean): LogbookEntryForPdf {
  const columns = reviveColumns(content.columns as Record<string, unknown>);
  const aircraft = content.aircraft as { makeModelVariant?: string; registration?: string } | undefined;
  return {
    ...columns,
    aircraftType: aircraft?.makeModelVariant ?? "",
    aircraftReg: aircraft?.registration ?? "",
    picName: (content.picName as string) ?? "",
    remarks: (content.remarks as string) ?? "",
    signed,
  };
}

export interface ExportRange {
  from?: string | undefined; // yyyy-mm-dd inclusive
  to?: string | undefined; // yyyy-mm-dd inclusive
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
    `SELECT e.id, e.locked,
            v.content
       FROM flight_entries e
       JOIN flight_entry_versions v ON v.entry_id = e.id AND v.version_no = e.current_version
      WHERE e.pilot_id = $1
        AND v.content->'columns'->>'date' >= COALESCE($2, '0000-01-01')
        AND v.content->'columns'->>'date' <= COALESCE($3, '9999-12-31')
      ORDER BY v.content->'columns'->>'date' ASC, e.created_at ASC`,
    [pilotId, range.from ?? null, range.to ?? null],
  );
  if (entryRows.length === 0) return [];

  const ids = entryRows.map((r) => r.id as string);

  const { rows: sigRows } = await pool.query(
    `SELECT s.entry_id, s.signer_role, s.content_hash, s.signature, s.public_key, s.signed_at,
            s.signer_id, p.name AS signer_name
       FROM signatures s JOIN pilots p ON p.id = s.signer_id
      WHERE s.entry_id = ANY($1::uuid[])
      ORDER BY s.signed_at ASC`,
    [ids],
  );

  const { rows: histRows } = await pool.query(
    `SELECT v.entry_id, v.version_no, v.change_reason, v.content_hash, v.created_at, p.name AS by_name
       FROM flight_entry_versions v JOIN pilots p ON p.id = v.created_by
      WHERE v.entry_id = ANY($1::uuid[])
      ORDER BY v.entry_id, v.version_no ASC`,
    [ids],
  );

  const signaturesByEntry = new Map<string, ExportSignature[]>();
  for (const s of sigRows) {
    const valid = verifySignature({
      entryId: s.entry_id,
      contentHash: s.content_hash,
      signerId: s.signer_id,
      signerRole: s.signer_role,
      signedAt: new Date(s.signed_at).toISOString().replace(/\.\d{3}Z$/, "Z"),
      signature: s.signature,
      publicKey: s.public_key,
    });
    const list = signaturesByEntry.get(s.entry_id) ?? [];
    list.push({
      signerName: s.signer_name,
      signerRole: s.signer_role,
      signedAt: new Date(s.signed_at).toISOString().replace(/\.\d{3}Z$/, "Z"),
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
    return {
      entryId: e.id as string,
      row: toRow(e.id, e.content, signatures.some((s) => s.valid)),
      signatures,
      history: historyByEntry.get(e.id) ?? [],
    };
  });
}
