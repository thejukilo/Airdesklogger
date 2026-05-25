/**
 * Turns an HTTP request body into a validated FSTD session input. As with flight
 * entries, the session date must be supplied in UTC and is rejected otherwise.
 */

import { z } from "zod";
import { parseUtcInstant, NonUtcTimeError } from "../domain/time.js";
import { RequestError } from "./parseEntry.js";
import type { FstdSessionInput } from "../domain/types.js";

const Shape = z.object({
  pilotId: z.string().min(1),
  deviceType: z.string().min(1),
  qualificationNumber: z.string().min(1),
  instruction: z.string(),
  date: z.string(),
  totalMinutes: z.number().int().positive(),
  remarks: z.string(),
});

export function parseFstdRequest(body: unknown): FstdSessionInput {
  const obj = typeof body === "string" ? safeJson(body) : body;
  const parsed = Shape.safeParse(obj);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new RequestError(`Invalid ${first ? first.path.join(".") || "body" : "body"}: ${first?.message ?? "unknown"}`);
  }
  try {
    return { ...parsed.data, date: parseUtcInstant(parsed.data.date) };
  } catch (err) {
    if (err instanceof NonUtcTimeError) throw new RequestError(err.message);
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
