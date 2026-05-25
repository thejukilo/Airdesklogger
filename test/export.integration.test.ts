/**
 * Integration test for the FOCA-style export (data loading plus PDF appendix).
 * Skipped unless a database connection is configured.
 *   PGHOST=/tmp PGUSER=postgres PGDATABASE=airdesklogger npm test
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { migrate } from "../src/db/migrate.js";
import { closePool } from "../src/db/pool.js";
import { createUser, setMfaSecret, activateMfa, getUserById } from "../src/db/authRepository.js";
import { createEntry, amendEntry, signCurrentVersion } from "../src/db/repository.js";
import { loadLogbookForExport } from "../src/db/exportRepository.js";
import { provisionSigningKeypair, unwrapPrivateKey, wrapPrivateKey } from "../src/auth/signingKeys.js";
import { generateTotpSecret } from "../src/auth/totp.js";
import { validateEntry } from "../src/domain/validation.js";
import { signEntry } from "../src/domain/signature.js";
import { generateLogbookPdf, type LogbookEntryForPdf, type AuditAppendix } from "../src/pdf/logbook.js";
import type { FlightEntryInput } from "../src/domain/types.js";

const hasDb = Boolean(process.env.DATABASE_URL || process.env.PGHOST);
const MASTER = "0".repeat(64);
const uniq = () => Math.random().toString(36).slice(2, 10);

function flight(pilotId: string, attributes: string[]): FlightEntryInput {
  return {
    pilotId,
    aircraft: { makeModelVariant: "PA-28", registration: "G-WXYZ", engineClass: "SE", multiPilot: false },
    legs: [
      {
        departurePlace: "EGKB",
        departureTime: new Date("2026-05-25T13:00:00Z"),
        arrivalPlace: "EGKB",
        arrivalTime: new Date("2026-05-25T14:10:00Z"),
      },
    ],
    picName: "SELF (SPIC)",
    landings: { day: 1, night: 0 },
    conditions: { night: 0, ifr: 0 },
    function: { primary: "SPIC", instructor: 0 },
    remarks: "skill test",
    attributes: attributes as never,
  };
}

describe.skipIf(!hasDb)("FOCA export (integration)", () => {
  beforeAll(async () => {
    await migrate();
  });
  afterAll(async () => {
    await closePool();
  });

  it("loads sign-offs and change log, and renders a PDF with the appendix", async () => {
    const studentKeys = provisionSigningKeypair(MASTER);
    const student = await createUser({
      email: `exp-stu-${uniq()}@x.com`,
      passwordHash: "x",
      name: "Export Student",
      roles: ["PILOT"],
      signingPublicKey: studentKeys.publicKey,
      signingKeyWrapped: studentKeys.wrappedPrivateKey,
    });
    const instrKeys = provisionSigningKeypair(MASTER);
    const instructor = await createUser({
      email: `exp-fi-${uniq()}@x.com`,
      passwordHash: "x",
      name: "Export Instructor",
      roles: ["EXAMINER"],
      signingPublicKey: instrKeys.publicKey,
      signingKeyWrapped: instrKeys.wrappedPrivateKey,
    });
    await setMfaSecret(instructor.id, wrapPrivateKey(generateTotpSecret(), MASTER));
    await activateMfa(instructor.id);

    // A signed skill-test entry.
    const signedInput = flight(student.id, ["skill_test"]);
    const signed = await createEntry(signedInput, validateEntry(signedInput).derived!, student.id);
    const fresh = await getUserById(instructor.id);
    await signCurrentVersion(
      signed.entryId,
      { privateKey: unwrapPrivateKey(fresh!.signingKeyWrapped!, MASTER), publicKey: fresh!.signingPublicKey! },
      { signerId: instructor.id, signerRole: "EXAMINER" },
      signEntry,
    );

    // An amended (two-version) entry with no signature.
    const plain = flight(student.id, ["cross_country"]);
    const created = await createEntry(plain, validateEntry(plain).derived!, student.id);
    const fixed = { ...plain, remarks: "corrected" };
    await amendEntry(created.entryId, fixed, validateEntry(fixed).derived!, student.id, "fix remarks");

    const entries = await loadLogbookForExport(student.id);
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const signedExport = entries.find((e) => e.entryId === signed.entryId)!;
    expect(signedExport.signatures.length).toBe(1);
    expect(signedExport.signatures[0]!.valid).toBe(true);
    expect(signedExport.row.signed).toBe(true);

    const amendedExport = entries.find((e) => e.entryId === created.entryId)!;
    expect(amendedExport.history.map((h) => h.versionNo)).toEqual([0, 1]);

    const rows: LogbookEntryForPdf[] = entries.map((e) => e.row);
    const audit: AuditAppendix = {
      signoffs: entries.flatMap((e) =>
        e.signatures.map((s) => ({ entry: e.row.date, text: `${s.signerRole} ${s.valid}` })),
      ),
      changeLog: entries.flatMap((e) =>
        e.history.map((h) => ({ entry: e.row.date, text: `v${h.versionNo} ${h.createdByName}` })),
      ),
    };

    const withAudit = await generateLogbookPdf(rows, { pilotName: "Export Student" }, audit);
    const withoutAudit = await generateLogbookPdf(rows, { pilotName: "Export Student" });
    const a = await PDFDocument.load(withAudit);
    const b = await PDFDocument.load(withoutAudit);
    expect(a.getPageCount()).toBeGreaterThan(b.getPageCount()); // appendix pages added
  });
});
