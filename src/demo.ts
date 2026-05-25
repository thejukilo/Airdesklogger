/**
 * End-to-end demonstration of the compliance core. Requires a database
 * (DATABASE_URL or PG* env). Walks the full lifecycle:
 *   create pilot -> log a multi-flight entry -> log an SPIC training flight ->
 *   amend it -> instructor signs it off (locks it) -> prove the lock ->
 *   verify the ledger chain -> render the PDF logbook.
 *
 * Run: PGHOST=/tmp PGUSER=postgres PGDATABASE=airdesklogger npm run demo
 */

import { writeFileSync } from "node:fs";
import { migrate } from "./db/migrate.js";
import { closePool } from "./db/pool.js";
import {
  createPilot,
  createEntry,
  amendEntry,
  signCurrentVersion,
  getHistory,
  getLedger,
} from "./db/repository.js";
import { validateEntry } from "./domain/validation.js";
import { verifyChain } from "./domain/hashChain.js";
import { generateSigningKeyPair, signEntry } from "./domain/signature.js";
import { generateLogbookPdf, type LogbookEntryForPdf } from "./pdf/logbook.js";
import type { FlightEntryInput } from "./domain/types.js";

function pdfRow(input: FlightEntryInput): LogbookEntryForPdf {
  const d = validateEntry(input).derived!;
  return {
    ...d,
    aircraftType: input.aircraft.makeModelVariant,
    aircraftReg: input.aircraft.registration,
    picName: input.picName,
    remarks: input.remarks,
  };
}

async function main(): Promise<void> {
  await migrate();
  const student = await createPilot("Jordan Student", "UK.FCL.SPL.5521");

  // A valid multi-flight day: out and back, sub-30-min turnaround.
  const multi: FlightEntryInput = {
    pilotId: student,
    aircraft: { makeModelVariant: "Cessna 172S", registration: "G-ABCD", engineClass: "SE", multiPilot: false },
    legs: [
      { departurePlace: "EGKB", departureTime: new Date("2026-05-25T09:00:00Z"), arrivalPlace: "EGMC", arrivalTime: new Date("2026-05-25T09:40:00Z") },
      { departurePlace: "EGMC", departureTime: new Date("2026-05-25T10:00:00Z"), arrivalPlace: "EGKB", arrivalTime: new Date("2026-05-25T10:45:00Z") },
    ],
    picName: "SELF",
    landings: { day: 2, night: 0 },
    conditions: { night: 0, ifr: 0 },
    function: { primary: "PIC", instructor: 0 },
    remarks: "Local nav, out-and-back",
  };
  const mv = validateEntry(multi);
  console.log("multi-flight valid:", mv.valid, "total min:", mv.derived?.total, "isMultiFlight:", mv.derived?.isMultiFlight);
  await createEntry(multi, mv.derived!, student);

  // An SPIC skill test that must be countersigned by the instructor.
  const spic: FlightEntryInput = {
    pilotId: student,
    aircraft: { makeModelVariant: "Piper PA-28", registration: "G-WXYZ", engineClass: "SE", multiPilot: false },
    legs: [
      { departurePlace: "EGKB", departureTime: new Date("2026-05-25T13:00:00Z"), arrivalPlace: "EGKB", arrivalTime: new Date("2026-05-25T14:10:00Z") },
    ],
    picName: "SELF (SPIC)",
    landings: { day: 1, night: 0 },
    conditions: { night: 0, ifr: 25 },
    function: { primary: "SPIC", instructor: 0 },
    remarks: "SPIC — PPL skill test",
  };
  const sv = validateEntry(spic);
  const created = await createEntry(spic, sv.derived!, student);

  // Correct a typo: a new immutable version, history preserved.
  const fixed = { ...spic, remarks: "SPIC — PPL skill test (pass)" };
  await amendEntry(created.entryId, fixed, validateEntry(fixed).derived!, student, "record result");
  console.log("history versions:", (await getHistory(created.entryId)).map((h) => h.version_no));

  // Instructor signs off -> entry locked forever.
  const keys = generateSigningKeyPair();
  const instructor = await createPilot("Sam Examiner", "UK.FE.0099", keys.publicKey);
  const sig = await signCurrentVersion(created.entryId, keys, { signerId: instructor, signerRole: "EXAMINER" }, signEntry);
  console.log("signed off by examiner, content hash:", sig.contentHash.slice(0, 16), "…");

  try {
    await amendEntry(created.entryId, fixed, validateEntry(fixed).derived!, student, "tamper");
    console.log("ERROR: locked entry was edited (should not happen)");
  } catch (e) {
    console.log("locked entry correctly rejected edit:", (e as Error).message);
  }

  const ledger = await getLedger();
  console.log("ledger length:", ledger.length, "chain valid:", verifyChain(ledger).valid);

  const pdf = await generateLogbookPdf([pdfRow(fixed), pdfRow(multi)], {
    pilotName: "Jordan Student",
    licenseNumber: "UK.FCL.SPL.5521",
    rowsPerPage: 12,
  });
  writeFileSync("logbook-sample.pdf", pdf);
  console.log("wrote logbook-sample.pdf (", pdf.length, "bytes )");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closePool);
