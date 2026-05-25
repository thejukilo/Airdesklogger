import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { getUserById, updateProfile } from "../../src/db/authRepository.js";
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
  address: z.string().optional(),
  licenseNumber: z.string().optional(),
  instructorCertificate: z.string().optional(),
  examinerCertificate: z.string().optional(),
});

function publicProfile(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    firstName: u.firstName,
    lastName: u.lastName,
    dateOfBirth: u.dateOfBirth,
    address: u.address,
    licenseNumber: u.licenseNumber,
    instructorCertificate: u.instructorCertificate,
    examinerCertificate: u.examinerCertificate,
    roles: u.roles,
    mfaEnabled: u.mfaEnabled,
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
      res.status(200).json(publicProfile(user));
      return;
    }

    if (req.method === "PATCH") {
      const parsed = Body.safeParse(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid profile." });
        return;
      }
      const updated = await updateProfile(claims.sub, parsed.data);
      res.status(200).json(publicProfile(updated));
      return;
    }

    res.status(405).json({ error: "Use GET or PATCH." });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}
