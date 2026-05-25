import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { verifyPassword } from "../../src/auth/passwords.js";
import { signSession } from "../../src/auth/tokens.js";
import { getUserByEmail, logAccountEvent } from "../../src/db/authRepository.js";
import { getJwtSecret } from "../../src/config.js";
import { clientIp } from "../../src/http/auth.js";

/**
 * Password login. This is a single factor on purpose: the second factor is a
 * step-up demanded only when a signer countersigns an entry. A failed attempt
 * and a successful one are both written to the security log. The response uses
 * the same wording for "no such account" and "wrong password" so it does not
 * reveal which emails are registered.
 */
const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  const parsed = Body.safeParse(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }
  const ip = clientIp(req);
  const ipField = ip !== undefined ? { ip } : {};
  const user = await getUserByEmail(parsed.data.email);

  if (!user || !user.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    await logAccountEvent({ email: parsed.data.email, eventType: "LOGIN_FAILED", ...ipField });
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  const token = await signSession(
    { sub: user.id, roles: user.roles, email: user.email ?? "" },
    getJwtSecret(),
  );
  await logAccountEvent({ userId: user.id, email: user.email ?? "", eventType: "LOGIN_SUCCESS", ...ipField });

  res.status(200).json({
    token,
    user: { id: user.id, email: user.email, name: user.name, roles: user.roles },
    mfaEnabled: user.mfaEnabled,
  });
}
