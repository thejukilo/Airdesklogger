/**
 * Turns an HTTP request body into a validated FlightEntryInput.
 *
 * This is the boundary where untrusted input enters the system, so it is also
 * where UTC is enforced. The shape is checked first, then each leg time is
 * parsed with parseUtcInstant, which rejects any value that is not expressed in
 * UTC. A bad shape or a non-UTC time produces a RequestError that the handlers
 * turn into a 400 response.
 */

import { z } from "zod";
import { parseUtcInstant, NonUtcTimeError } from "../domain/time.js";
import type { FlightEntryInput } from "../domain/types.js";

export class RequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestError";
  }
}

const LegShape = z.object({
  departurePlace: z.string().min(1),
  departureTime: z.string(),
  arrivalPlace: z.string().min(1),
  arrivalTime: z.string(),
});

const EntryShape = z.object({
  pilotId: z.string().min(1),
  aircraft: z.object({
    makeModelVariant: z.string().min(1),
    registration: z.string().min(1),
    engineClass: z.enum(["SE", "ME"]),
    multiPilot: z.boolean(),
  }),
  legs: z.array(LegShape).min(1),
  picName: z.string(),
  landings: z.object({
    day: z.number().int().nonnegative(),
    night: z.number().int().nonnegative(),
  }),
  conditions: z.object({
    night: z.number().int().nonnegative(),
    ifr: z.number().int().nonnegative(),
  }),
  function: z.object({
    primary: z.enum(["PIC", "PICUS", "SPIC", "CO_PILOT", "DUAL"]),
    instructor: z.number().int().nonnegative(),
  }),
  remarks: z.string(),
});

/** Vercel parses a JSON body into an object, but a raw string can also arrive. */
function asObject(body: unknown): unknown {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      throw new RequestError("Request body is not valid JSON.");
    }
  }
  return body;
}

export function parseEntryRequest(body: unknown): FlightEntryInput {
  const parsed = EntryShape.safeParse(asObject(body));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first ? first.path.join(".") || "body" : "body";
    throw new RequestError(`Invalid ${where}: ${first ? first.message : "unknown error"}`);
  }
  const data = parsed.data;

  try {
    return {
      pilotId: data.pilotId,
      aircraft: data.aircraft,
      legs: data.legs.map((l) => ({
        departurePlace: l.departurePlace,
        departureTime: parseUtcInstant(l.departureTime),
        arrivalPlace: l.arrivalPlace,
        arrivalTime: parseUtcInstant(l.arrivalTime),
      })),
      picName: data.picName,
      landings: data.landings,
      conditions: data.conditions,
      function: data.function,
      remarks: data.remarks,
    };
  } catch (err) {
    if (err instanceof NonUtcTimeError) throw new RequestError(err.message);
    throw err;
  }
}
