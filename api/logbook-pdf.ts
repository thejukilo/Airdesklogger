import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { parseEntryRequest, RequestError } from "../src/http/parseEntry.js";
import { validateEntry } from "../src/domain/validation.js";
import { generateLogbookPdf, type LogbookEntryForPdf } from "../src/pdf/logbook.js";

/**
 * Render a set of entries to the EASA paper layout as a PDF. Each entry is
 * validated first, so an invalid entry stops the render with a 422 that points
 * at the offending row. Like the validate endpoint, this needs no database.
 */
const RequestShape = z.object({
  pilotName: z.string().min(1),
  licenseNumber: z.string().optional(),
  rowsPerPage: z.number().int().positive().max(40).optional(),
  entries: z.array(z.unknown()).min(1),
});

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST with { pilotName, entries: [...] }." });
    return;
  }

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body;
  const parsed = RequestShape.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
    return;
  }

  const rows: LogbookEntryForPdf[] = [];
  try {
    parsed.data.entries.forEach((raw, index) => {
      const input = parseEntryRequest(raw);
      const result = validateEntry(input);
      if (!result.valid || !result.derived) {
        throw new RequestError(`Entry ${index + 1} is invalid: ${result.issues[0]?.message ?? "unknown"}`);
      }
      rows.push({
        ...result.derived,
        aircraftType: input.aircraft.makeModelVariant,
        aircraftReg: input.aircraft.registration,
        picName: input.picName,
        remarks: input.remarks,
      });
    });
  } catch (err) {
    if (err instanceof RequestError) {
      res.status(422).json({ error: err.message });
      return;
    }
    throw err;
  }

  const pdf = await generateLogbookPdf(rows, {
    pilotName: parsed.data.pilotName,
    ...(parsed.data.licenseNumber !== undefined ? { licenseNumber: parsed.data.licenseNumber } : {}),
    ...(parsed.data.rowsPerPage !== undefined ? { rowsPerPage: parsed.data.rowsPerPage } : {}),
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="logbook.pdf"');
  res.status(200).send(Buffer.from(pdf));
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
