/**
 * Turns an HTTP request body into a validated FSTD session input. As with flight
 * entries, the session date must be supplied in UTC and is rejected otherwise.
 */

import { z } from "zod";
import { parseInstant, AmbiguousTimeError } from "../domain/time.js";
import { RequestError } from "./parseEntry.js";
import type { FstdSessionInput } from "../domain/types.js";
import type { EntryAttribute } from "../domain/attributes.js";

const Shape = z.object({
  pilotId: z.string().min(1),
  deviceType: z.string().min(1),
  qualificationNumber: z.string().min(1),
  qualification: z.string().optional(),
  pilotFunction: z.enum(["TRAINEE", "SFI_SFE"]).optional(),
  instruction: z.string().optional().default(""),
  date: z.string(),
  totalMinutes: z.number().int().positive(),
  landings: z.object({ day: z.number().int().nonnegative(), night: z.number().int().nonnegative() }).optional(),
  remarks: z.string(),
  attributes: z.array(z.string()).optional(),
});

export function parseFstdRequest(body: unknown): FstdSessionInput {
  const obj = typeof body === "string" ? safeJson(body) : body;
  const parsed = Shape.safeParse(obj);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new RequestError(`Invalid ${first ? first.path.join(".") || "body" : "body"}: ${first?.message ?? "unknown"}`);
  }
  try {
    const { date, attributes, ...rest } = parsed.data;
    const parsedDate = parseInstant(date);
    return {
      ...rest,
      date: parsedDate.utc,
      attributes: (attributes ?? []) as EntryAttribute[],
      enteredInLocalTime: parsedDate.enteredLocal,
    };
  } catch (err) {
    if (err instanceof AmbiguousTimeError) throw new RequestError(err.message);
    throw err;
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    throw new RequestError("Request body is not valid JSON.");
  }
}
