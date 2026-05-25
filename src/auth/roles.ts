/**
 * Roles and the authorisation rules that depend on them.
 *
 * A person can hold more than one role: an instructor is usually also a pilot,
 * and an examiner is usually also an instructor. The rules here answer two
 * questions the API asks repeatedly: may this user edit this logbook, and may
 * this user sign off an entry in the given capacity.
 */

export type Role = "PILOT" | "INSTRUCTOR" | "EXAMINER" | "ADMIN";

export const ALL_ROLES: readonly Role[] = ["PILOT", "INSTRUCTOR", "EXAMINER", "ADMIN"];

export function isRole(value: string): value is Role {
  return (ALL_ROLES as readonly string[]).includes(value);
}

/** A pilot owns their own logbook. Nobody edits someone else's entries. */
export function canEditOwnLogbook(userId: string, logbookHolderId: string): boolean {
  return userId === logbookHolderId;
}

/** The signer roles, mapped to the capacities they are allowed to attest. */
export type SignerCapacity = "INSTRUCTOR" | "EXAMINER" | "SUPERVISING_PIC";

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
  }
}
