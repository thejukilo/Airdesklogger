import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadLogbookForExport, loadDeletionsForExport } from "../../src/db/exportRepository.js";
import { getUserById } from "../../src/db/authRepository.js";
import { generateLogbookPdf, type AppendixAttributeBlock, type AuditAppendix, type ChangeLogRow, type ChangeLogSnapshot, type LogbookEntryForPdf } from "../../src/pdf/logbook.js";
import { formatAttributeRows } from "../../src/pdf/attributeLines.js";
import { requireUser, AuthError } from "../../src/http/auth.js";

/** Build a ChangeLogSnapshot from a stored version content payload. */
function snapshotFromContent(content: Record<string, unknown>): ChangeLogSnapshot {
  const cols = (content.columns ?? {}) as Record<string, unknown>;
  const ac = (content.aircraft ?? {}) as { registration?: string; makeModelVariant?: string };
  const hhmm = (m: unknown): string => {
    const n = Number(m ?? 0);
    if (!Number.isFinite(n) || n <= 0) return "00:00";
    return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  };
  const clockZ = (v: unknown): string => {
    const s = typeof v === "string" ? v : "";
    return s.length >= 16 ? `${s.slice(11, 16)}Z` : "";
  };
  return {
    date: String(cols.date ?? ""),
    aircraft: String(ac.registration ?? ""),
    from: String(cols.departurePlace ?? ""),
    to: String(cols.arrivalPlace ?? ""),
    off: clockZ(cols.departureTime),
    on: clockZ(cols.arrivalTime),
    total: hhmm(cols.total),
    pic: String(content.picName ?? ""),
    dayLandings: String(Number(cols.dayLandings ?? 0)),
    nightLandings: String(Number(cols.nightLandings ?? 0)),
    night: hhmm(cols.night),
    ifr: hhmm(cols.ifr),
    remarks: String(content.remarks ?? ""),
  };
}

/**
 * The holder's complete logbook as a PDF, in the form FOCA expects for
 * submission: the AMC1 FCL.050 grid with page totals, plus an appendix carrying
 * the sign-offs and the full change log (FOCA 2.5). Built from stored data, so
 * the change log and the re-verified signatures are the real record.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Use GET." });
    return;
  }
  try {
    const claims = await requireUser(req);
    const user = await getUserById(claims.sub);
    if (!user) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    const entries = await loadLogbookForExport(claims.sub, { from, to });
    const deletions = await loadDeletionsForExport(claims.sub, { from, to });
    // An entry is "edited" when it has more than one logged version (a
    // post-48h amendment); pre-48h edits don't appear in the change log, per
    // FOCA 2.3.7, so they don't trigger the EDITED marker either.
    const rows: LogbookEntryForPdf[] = entries.map((e) => ({
      ...e.row,
      ...(e.history.length > 1 ? { edited: true } : {}),
    }));

    const attributeBlocks: AppendixAttributeBlock[] = [];
    const changeLog: ChangeLogRow[] = [];
    const audit: AuditAppendix = { signoffs: [], changeLog };
    entries.forEach((e, index) => {
      const ref = `${e.row.date} #${index + 1}`;
      if (e.signatures.length > 0) {
        audit.signoffs.push({
          entryId: e.entryId,
          entryRef: ref,
          signatures: e.signatures.map((s) => ({
            signerName: s.signerName,
            signerRole: s.signerRole,
            signerLicense: s.signerLicense,
            signedPlace: s.signedPlace,
            signedAt: s.signedAt,
            signatureImage: s.signatureImage,
            valid: s.valid,
          })),
        });
      }
      const attrRows = formatAttributeRows(e.row.attributes, e.row.attributeDetails);
      if (attrRows.length > 0) {
        attributeBlocks.push({ entryId: e.entryId, entryRef: ref, items: attrRows });
      }
      for (let i = 0; i < e.history.length; i++) {
        const v = e.history[i]!;
        const prev = i > 0 ? e.history[i - 1] : null;
        // v0 is the initial CREATE; later versions are amendments and carry a
        // full before/after snapshot of every column on the AMC1 FCL.050 row,
        // so an auditor can read the original vs the new entry verbatim.
        const isEdit = prev !== null;
        const before = prev ? snapshotFromContent(prev.content) : undefined;
        const after = isEdit ? snapshotFromContent(v.content) : undefined;
        changeLog.push({
          entry: ref,
          version: `v${v.versionNo}`,
          at: v.createdAt,
          by: v.createdByName,
          ...(v.changeReason ? { reason: v.changeReason } : {}),
          hash: v.contentHash.slice(0, 12),
          ...(isEdit ? { edited: true } : {}),
          ...(before ? { before } : {}),
          ...(after ? { after } : {}),
        });
      }
    });
    if (attributeBlocks.length > 0) audit.attributes = attributeBlocks;
    // Deletions after the 48-hour window are part of the change log (FOCA 2.3.7).
    for (const d of deletions) {
      changeLog.push({
        entry: `${d.date}${d.aircraft ? ` ${d.aircraft}` : ""}`,
        at: d.voidedAt,
        by: "system",
        reason: "flight deleted",
      });
    }

    const pdf = await generateLogbookPdf(
      rows,
      {
        pilotName: user.name,
        paperSize: user.exportPaperSize,
        ...(user.licenseNumber ? { licenseNumber: user.licenseNumber } : {}),
        ...(user.address ? { holderAddress: user.address } : {}),
        ...(user.dateOfBirth ? { dateOfBirth: user.dateOfBirth } : {}),
      },
      audit,
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="logbook.pdf"');
    res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}
