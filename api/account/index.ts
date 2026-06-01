import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { getUserById, pilotHasEntries, updateProfile, IdentityLockedError } from "../../src/db/authRepository.js";
import { getSubscription, type SubscriptionSnapshot } from "../../src/db/subscriptionRepository.js";
import { requireUser, AuthError } from "../../src/http/auth.js";
import type { UserRow } from "../../src/db/authRepository.js";

/**
 * The signed-in user's own profile.
 *   GET   returns the profile and roles.
 *   PATCH updates personal details and the professional certificates; declaring
 *         an instructor or examiner certificate grants the matching signer role.
 */
const Body = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional(),
  addressStreet: z.string().optional(),
  addressZip: z.string().optional(),
  addressCountry: z.string().optional(),
  licenseNumber: z.string().optional(),
  instructorCertificate: z.string().optional(),
  examinerCertificate: z.string().optional(),
  paperSize: z.enum(["A4", "LETTER"]).optional(),
  mfaRequiredForLogin: z.boolean().optional(),
});

function publicProfile(u: UserRow, identityLocked: boolean, subscription: SubscriptionSnapshot | null) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    firstName: u.firstName,
    lastName: u.lastName,
    dateOfBirth: u.dateOfBirth,
    address: u.address,
    addressStreet: u.addressStreet,
    addressZip: u.addressZip,
    addressCountry: u.addressCountry,
    licenseNumber: u.licenseNumber,
    instructorCertificate: u.instructorCertificate,
    examinerCertificate: u.examinerCertificate,
    paperSize: u.exportPaperSize,
    roles: u.roles,
    mfaEnabled: u.mfaEnabled,
    mfaRequiredForLogin: u.mfaRequiredForLogin,
    identityLocked,
    subscription,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const claims = await requireUser(req);

    if (req.method === "GET") {
      const user = await getUserById(claims.sub);
      if (!user) {
        res.status(404).json({ error: "Account not found." });
        return;
      }
      res.status(200).json(publicProfile(user, await pilotHasEntries(claims.sub), await getSubscription(claims.sub)));
      return;
    }

    if (req.method === "PATCH") {
      const parsed = Body.safeParse(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid profile." });
        return;
      }
      const updated = await updateProfile(claims.sub, parsed.data);
      res.status(200).json(publicProfile(updated, await pilotHasEntries(claims.sub)));
      return;
    }

    res.status(405).json({ error: "Use GET or PATCH." });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof IdentityLockedError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}
