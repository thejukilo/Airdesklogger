import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadLogbookForExport, loadDeletionsForExport } from "../../src/db/exportRepository.js";
import { getUserById } from "../../src/db/authRepository.js";
import { generateLogbookPdf, type AuditAppendix, type LogbookEntryForPdf } from "../../src/pdf/logbook.js";
import { requireUser, AuthError } from "../../src/http/auth.js";

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
    const rows: LogbookEntryForPdf[] = entries.map((e) => e.row);

    const audit: AuditAppendix = { signoffs: [], changeLog: [] };
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
      for (const v of e.history) {
        audit.changeLog.push({
          entry: ref,
          text: `v${v.versionNo} ${v.createdAt} by ${v.createdByName}${v.changeReason ? ` - ${v.changeReason}` : ""} [${v.contentHash.slice(0, 12)}]`,
        });
      }
    });
    // Deletions after the 48-hour window are part of the change log (FOCA 2.3.7).
    for (const d of deletions) {
      audit.changeLog.push({
        entry: `${d.date}${d.aircraft ? ` ${d.aircraft}` : ""}`,
        text: `flight deleted on ${d.voidedAt}`,
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
