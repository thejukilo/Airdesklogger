/**
 * Roles and the authorisation rules that depend on them.
 *
 * A person can hold more than one role: an instructor is usually also a pilot,
 * and an examiner is usually also an instructor. The rules here answer two
 * questions the API asks repeatedly: may this user edit this logbook, and may
 * this user sign off an entry in the given capacity.
 */

export type Role =
  | "PILOT"
  | "INSTRUCTOR"
  | "EXAMINER"
  | "ADMIN"
  | "ATO"
  | "DTO"
  | "HOT"
  | "AIRPORT";

export const ALL_ROLES: readonly Role[] = [
  "PILOT",
  "INSTRUCTOR",
  "EXAMINER",
  "ADMIN",
  "ATO",
  "DTO",
  "HOT",
  "AIRPORT",
];

export function isRole(value: string): value is Role {
  return (ALL_ROLES as readonly string[]).includes(value);
}

/** A pilot owns their own logbook. Nobody edits someone else's entries. */
export function canEditOwnLogbook(userId: string, logbookHolderId: string): boolean {
  return userId === logbookHolderId;
}

/**
 * The signer capacities, and the role each one requires. FOCA 2.4.1 allows
 * instructors, examiners, training organisations, heads of training, airports
 * and other parties to sign.
 */
export type SignerCapacity =
  | "INSTRUCTOR"
  | "EXAMINER"
  | "SUPERVISING_PIC"
  | "ATO"
  | "DTO"
  | "HOT"
  | "AIRPORT"
  | "OTHER";

export function canSignAs(roles: readonly Role[], capacity: SignerCapacity): boolean {
  switch (capacity) {
    case "EXAMINER":
      return roles.includes("EXAMINER");
    case "INSTRUCTOR":
      // An examiner may also act as an instructor for countersigning purposes.
      return roles.includes("INSTRUCTOR") || roles.includes("EXAMINER");
    case "SUPERVISING_PIC":
      // Supervising-PIC countersignature (for PICUS) only needs a qualified pilot.
      return roles.includes("PILOT") || roles.includes("INSTRUCTOR") || roles.includes("EXAMINER");
    case "ATO":
      return roles.includes("ATO");
    case "DTO":
      return roles.includes("DTO");
    case "HOT":
      return roles.includes("HOT");
    case "AIRPORT":
      return roles.includes("AIRPORT");
    case "OTHER":
      // A catch-all party; only an administrator may attest as "other".
      return roles.includes("ADMIN");
  }
}
