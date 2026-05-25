import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import {
  searchAirports,
  upsertAirport,
  listAircraft,
  upsertAircraft,
  getAircraftByRegistration,
  upsertFstdDevice,
} from "../../src/db/referenceRepository.js";
import { lookupExternalAircraft } from "../../src/http/aircraftLookup.js";
import { requireUser, AuthError } from "../../src/http/auth.js";

/**
 * Reference data lookups and maintenance, one function for airports, aircraft
 * and FSTD devices (path-dispatched, to respect the Vercel function limit).
 *   GET  /api/reference/airports?q=  search airports
 *   GET  /api/reference/aircraft?q=  list aircraft
 *   POST /api/reference/airports|aircraft|fstd  add or update a record
 * Adding records requires the ADMIN role, since this is the shared database the
 * provider maintains.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const kind = String(req.query.kind);
  try {
    const claims = await requireUser(req);

    if (req.method === "GET") {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      if (kind === "airports") {
        res.status(200).json({ airports: await searchAirports(q) });
        return;
      }
      if (kind === "aircraft") {
        const registration =
          typeof req.query.registration === "string" ? req.query.registration.trim() : "";
        if (registration) {
          // Exact lookup with a public-source fallback that is cached on a hit,
          // so the next flight entry for this registration validates against it.
          let match = await getAircraftByRegistration(registration);
          let source = match ? "db" : "none";
          if (!match) {
            const external = await lookupExternalAircraft(registration);
            if (external) {
              await upsertAircraft(external);
              match = await getAircraftByRegistration(registration);
              source = "external";
            }
          }
          res.status(200).json({ match, source });
          return;
        }
        res.status(200).json({ aircraft: await listAircraft(q) });
        return;
      }
      res.status(404).json({ error: "Unknown reference kind." });
      return;
    }

    if (req.method === "POST") {
      if (!claims.roles.includes("ADMIN")) {
        res.status(403).json({ error: "Administrator role required to edit reference data." });
        return;
      }
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (kind === "airports") {
        const a = AirportShape.parse(body);
        await upsertAirport(a);
        res.status(201).json({ ok: true });
        return;
      }
      if (kind === "aircraft") {
        const a = AircraftShape.parse(body);
        const id = await upsertAircraft(a);
        res.status(201).json({ id });
        return;
      }
      if (kind === "fstd") {
        const d = FstdShape.parse(body);
        await upsertFstdDevice(d);
        res.status(201).json({ ok: true });
        return;
      }
      res.status(404).json({ error: "Unknown reference kind." });
      return;
    }

    res.status(405).json({ error: "Use GET or POST." });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0]?.message ?? "Invalid record." });
      return;
    }
    throw err;
  }
}

const AirportShape = z.object({
  icao: z.string().regex(/^[A-Za-z]{4}$/),
  name: z.string().min(1),
  country: z.string().optional(),
});

const AircraftShape = z.object({
  registration: z.string().min(1),
  model: z.string().min(1),
  icaoType: z.string().optional(),
  variant: z.string().optional(),
  category: z.enum(["AEROPLANE", "HELICOPTER", "SAILPLANE", "BALLOON"]),
  engineType: z.string().optional(),
  engineCount: z.number().int().positive().optional(),
  multiPilot: z.boolean().optional(),
  balloonGroup: z.string().optional(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const FstdShape = z.object({
  qualificationNumber: z.string().min(1),
  deviceKind: z.enum(["FNPT_I", "FNPT_II", "FTD", "FFS", "BITD", "OTHER"]),
  level: z.string().optional(),
  aircraftType: z.string().optional(),
});
