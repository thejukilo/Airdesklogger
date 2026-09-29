import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, requireWriteCapability, AuthError } from "../../src/http/auth.js";
import { prepareFlightEntry } from "../../src/http/buildEntry.js";
import { parseFstdRequest } from "../../src/http/parseFstd.js";
import { validateFstdSession } from "../../src/domain/validation.js";
import { RequestError } from "../../src/http/parseEntry.js";
import { createEntry, createFstdEntry } from "../../src/db/repository.js";
import { getAircraftForFlight, upsertAircraft, fstdDeviceExists, upsertFstdDevice } from "../../src/db/referenceRepository.js";
import { parseImportCsv, type DateFormat, type MappedRow } from "../../src/http/importCsv.js";
import { parseCapzlogCsv, type CapzlogReport } from "../../src/http/capzlog.js";

/**
 * Self-service CSV logbook import for the signed-in holder.
 *
 *   POST /api/import/csv
 *     { csv, source?, reportType?, timeZone?, dateFormat?, selfName?, commit? }
 *
 * `source` selects the file format: "default" (the Airdesk template) or
 * "capzlog" (capzlog.aero exports). For capzlog, `reportType` names which report
 * the file is (airplane/helicopter/sailplane/balloon/simulator); it is detected
 * from the header when omitted. Both sources map onto the same internal entry
 * shapes and run through the identical prepareFlightEntry / FSTD pipelines.
 *
 * commit=false (default) is a dry run: nothing is written to the logbook, and
 * each row comes back "ready" or "error" with its computed total. commit=true
 * writes only the rows that validate.
 *
 * Aircraft the capzlog file describes but that are not yet on file are added to
 * the aircraft registry (the same registry a registration lookup populates); a
 * simulator device is auto-registered on import. Neither is a logbook entry.
 */

const MAX_ROWS = 200;

interface RowResult {
  line: number;
  externalId: string | null;
  date: string;
  route: string;
  aircraft: string;
  function: string;
  status: "ready" | "created" | "error";
  totalMinutes: number | null;
  entryId?: string;
  issues?: Array<{ field: string; message: string }>;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).json({ error: "Use POST." });
      return;
    }

    const claims = await requireUser(req);
    const body = (typeof req.body === "string" ? safeJson(req.body) : req.body) as {
      csv?: unknown;
      source?: unknown;
      reportType?: unknown;
      timeZone?: unknown;
      dateFormat?: unknown;
      selfName?: unknown;
      commit?: unknown;
    };

    const csv = typeof body.csv === "string" ? body.csv : "";
    if (!csv.trim()) {
      res.status(400).json({ error: "No CSV content was provided." });
      return;
    }
    const source = body.source === "capzlog" ? "capzlog" : "default";
    const timeZone: "UTC" | "LOCAL" = body.timeZone === "LOCAL" ? "LOCAL" : "UTC";
    const dateFormat: DateFormat = ["YMD", "DMY", "MDY", "auto"].includes(body.dateFormat as string)
      ? (body.dateFormat as DateFormat)
      : "auto";
    const reportType = ["airplane", "helicopter", "sailplane", "balloon", "simulator"].includes(body.reportType as string)
      ? (body.reportType as CapzlogReport)
      : undefined;
    const selfName = typeof body.selfName === "string" ? body.selfName : null;
    const commit = body.commit === true;

    if (commit) await requireWriteCapability(claims.sub);

    // Parse into normalized rows, per source.
    let rows: MappedRow[];
    let fatal: string | null;
    let dateUsed: string | undefined;
    let reportUsed: CapzlogReport | undefined;
    if (source === "capzlog") {
      const parsed = parseCapzlogCsv(csv, { ...(reportType ? { reportType } : {}), selfName });
      rows = parsed.rows;
      fatal = parsed.fatal;
      reportUsed = parsed.report;
    } else {
      const parsed = parseImportCsv(csv, { dateFormat, selfName });
      rows = parsed.rows;
      fatal = parsed.fatal;
      dateUsed = parsed.dateFormat;
    }

    if (fatal) {
      res.status(400).json({ error: fatal });
      return;
    }
    if (rows.length > MAX_ROWS) {
      res.status(400).json({
        error: `This file has ${rows.length} rows. Please split it into files of at most ${MAX_ROWS} rows and import them one at a time.`,
      });
      return;
    }

    const results: RowResult[] = [];
    for (const row of rows) {
      results.push(await processRow(row, claims.sub, { timeZone, commit }));
    }

    const summary = {
      total: results.length,
      ready: results.filter((r) => r.status === "ready").length,
      created: results.filter((r) => r.status === "created").length,
      errors: results.filter((r) => r.status === "error").length,
    };

    res.status(200).json({
      committed: commit,
      ...(dateUsed ? { dateFormat: dateUsed } : {}),
      ...(reportUsed ? { report: reportUsed } : {}),
      summary,
      rows: results,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof RequestError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
}

/** Fill the aircraft fields left blank (default template) from the reference DB. */
async function resolveAircraft(row: MappedRow): Promise<{ field: string; message: string } | null> {
  const ac = row.entry!.aircraft;
  const onDate = row.entry!.legs[0]!.departureTime.slice(0, 10);
  const rec = await getAircraftForFlight(ac.registration, onDate);
  if (!rec) {
    return {
      field: "aircraft.registration",
      message: `${ac.registration} is not in the reference database, so its type and class could not be filled in automatically. Add the aircraft in the app first, or fill the type, engine_class and category columns for this flight.`,
    };
  }
  if (ac.makeModelVariant === "") ac.makeModelVariant = rec.model;
  if (ac.engineClass === "") ac.engineClass = rec.engineCount && rec.engineCount > 1 ? "ME" : "SE";
  if (ac.multiPilot === null) ac.multiPilot = rec.multiPilot ?? false;
  if (ac.category === "") ac.category = rec.category;
  return null;
}

async function processRow(
  row: MappedRow,
  pilotId: string,
  opts: { timeZone: "UTC" | "LOCAL"; commit: boolean },
): Promise<RowResult> {
  const base: RowResult = {
    line: row.line,
    externalId: row.externalId,
    date: row.summary.date,
    route: row.summary.route,
    aircraft: row.summary.aircraft,
    function: row.summary.function,
    status: "error",
    totalMinutes: null,
  };

  if (!row.ok) {
    return { ...base, issues: row.issues ?? [{ field: "row", message: "Row could not be read." }] };
  }

  try {
    if (row.kind === "FSTD") return await processFstd(row, pilotId, base, opts.commit);
    return await processFlight(row, pilotId, base, opts);
  } catch (err) {
    if (err instanceof RequestError) return { ...base, issues: [{ field: "entry", message: err.message }] };
    const message = err instanceof Error ? err.message : "Unexpected error while importing this row.";
    return { ...base, issues: [{ field: "entry", message }] };
  }
}

async function processFlight(
  row: MappedRow,
  pilotId: string,
  base: RowResult,
  opts: { timeZone: "UTC" | "LOCAL"; commit: boolean },
): Promise<RowResult> {
  if (!row.entry) return { ...base, issues: [{ field: "row", message: "Missing flight body." }] };

  // capzlog carries the aircraft in the file; register it so validation (which
  // requires the aircraft on file) passes, instead of failing a migrated tail.
  if (row.aircraftSeed) {
    const s = row.aircraftSeed;
    await upsertAircraft({
      registration: s.registration,
      model: s.model,
      category: s.category,
      engineCount: s.engineClass === "ME" ? 2 : 1,
      multiPilot: s.multiPilot,
      ...(s.icaoType ? { icaoType: s.icaoType } : {}),
    });
    base.aircraft = [s.registration, s.model].filter(Boolean).join(" ");
  } else if (row.needsAircraftLookup) {
    const miss = await resolveAircraft(row);
    if (miss) return { ...base, issues: [miss] };
    base.aircraft = [row.entry.aircraft.registration, row.entry.aircraft.makeModelVariant].filter(Boolean).join(" ");
  }

  const entryBody = { ...row.entry, ...(opts.timeZone === "LOCAL" ? { timeZone: "LOCAL" as const } : {}) };
  const prepared = await prepareFlightEntry(entryBody, pilotId);
  if (!prepared.ok) {
    const issues = (prepared.body as { issues?: Array<{ field: string; message: string }> }).issues;
    return { ...base, issues: issues ?? [{ field: "entry", message: "Entry failed validation." }] };
  }

  const total = prepared.derived.total;
  if (!opts.commit) return { ...base, status: "ready", totalMinutes: total };

  const created = await createEntry(
    prepared.input,
    prepared.derived,
    pilotId,
    row.externalId ? `csv-import:${row.externalId}` : "csv-import",
  );
  return { ...base, status: "created", totalMinutes: total, entryId: created.entryId };
}

async function processFstd(row: MappedRow, pilotId: string, base: RowResult, commit: boolean): Promise<RowResult> {
  if (!row.fstd) return { ...base, issues: [{ field: "row", message: "Missing simulator body." }] };
  const input = parseFstdRequest({ ...row.fstd, pilotId });
  const result = validateFstdSession(input);
  if (!result.valid || !result.derived) {
    return { ...base, issues: (result.issues as Array<{ field: string; message: string }>) ?? [{ field: "entry", message: "Session failed validation." }] };
  }
  if (!commit) return { ...base, status: "ready", totalMinutes: row.fstd.totalMinutes };

  // Auto-register the device, mirroring the single-session FSTD endpoint.
  if (!(await fstdDeviceExists(input.qualificationNumber))) {
    await upsertFstdDevice({ qualificationNumber: input.qualificationNumber, deviceKind: "OTHER", aircraftType: input.deviceType });
  }
  const created = await createFstdEntry(input, result.derived, pilotId, "csv-import:capzlog");
  return { ...base, status: "created", totalMinutes: row.fstd.totalMinutes, entryId: created.entryId };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
