import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import {
  bearerToken,
  clientIp,
} from "../../../src/http/auth.js";
import {
  findActiveTokenByRaw,
  findImportByExternalId,
  recordImport,
  replaceImportTarget,
  touchTokenUse,
} from "../../../src/db/importTokensRepository.js";
import { prepareFlightEntry, type ImportPrefs } from "../../../src/http/buildEntry.js";
import { RequestError } from "../../../src/http/parseEntry.js";
import { createEntry } from "../../../src/db/repository.js";

/**
 * Import API v1 — write-only entry point for external flight-school systems.
 *
 * Auth:  Bearer airdesk_pat_*** (per-pilot personal access token, scope
 *        entries:append). The pilot id is bound to the token; the request body
 *        never carries it, so a token cannot write to anyone else's logbook.
 *
 * Modes: single  { externalId, entry }
 *        batch   { entries: [{ externalId, entry }, ...] }   (max 200 per call)
 *
 * Query: ?dryRun=1  validate without persisting; nothing is written.
 *
 * Idempotency: (token, externalId) is the dedup key. A retry with the same
 *              externalId returns the original entry id with status="duplicate"
 *              and a 200, not a 201. Concurrent retries are resolved by the
 *              unique constraint on entry_imports.
 */

const ItemShape = z.object({
  externalId: z.string().min(1).max(128),
  entry: z.unknown(),
});

const BodyShape = z.union([
  ItemShape,
  z.object({ entries: z.array(ItemShape).min(1).max(200) }),
]);

type ItemOutcome =
  | { externalId: string; status: "created"; entryId: string }
  | { externalId: string; status: "duplicate"; entryId: string; importedAt: string }
  | { externalId: string; status: "validated" }
  | { externalId: string; status: "invalid"; issues: unknown };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Use POST." });
    return;
  }

  const raw = bearerToken(req);
  if (!raw) {
    res.status(401).json({ error: "Missing bearer token." });
    return;
  }
  const token = await findActiveTokenByRaw(raw);
  if (!token) {
    res.status(401).json({ error: "Invalid or revoked token." });
    return;
  }
  if (token.scope !== "entries:append") {
    res.status(403).json({ error: `Token scope ${token.scope} cannot write entries.` });
    return;
  }

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body;
  const parsed = BodyShape.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    res.status(400).json({
      error: `Invalid body: ${first?.message ?? "unknown shape error"}`,
      path: first?.path,
    });
    return;
  }

  const dryRun = String(req.query.dryRun ?? "") === "1";
  const items = "entries" in parsed.data ? parsed.data.entries : [parsed.data];
  const batch = "entries" in parsed.data;

  // External ids must be unique within a single request; otherwise two siblings
  // would race for the same idempotency slot.
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.externalId)) {
      res.status(400).json({ error: `Duplicate externalId in request: ${it.externalId}` });
      return;
    }
    seen.add(it.externalId);
  }

  const ip = clientIp(req);
  const importPrefs = {
    sourceTimeZone: token.sourceTimeZone,
    storeTimeZone: token.storeTimeZone,
    tmgCategory: token.tmgCategory,
  };
  const outcomes: ItemOutcome[] = [];
  for (const it of items) {
    outcomes.push(await processItem(token.id, token.userId, it, { dryRun, ip, importPrefs }));
  }

  // Single-item mode keeps a clean 201/200/422 shape; batch always returns 207.
  if (!batch) {
    const only = outcomes[0]!;
    if (only.status === "invalid") {
      res.status(422).json({ valid: false, externalId: only.externalId, issues: only.issues });
      return;
    }
    if (only.status === "duplicate") {
      res.status(200).json(only);
      return;
    }
    if (only.status === "validated") {
      res.status(200).json(only);
      return;
    }
    res.status(201).json(only);
    return;
  }

  // Batch: always 207 so the caller has to look at each item's status.
  void touchTokenUse(token.id).catch(() => {});
  res.status(207).json({ items: outcomes });
}

async function processItem(
  tokenId: string,
  pilotId: string,
  it: { externalId: string; entry?: unknown },
  opts: { dryRun: boolean; ip: string | undefined; importPrefs: ImportPrefs },
): Promise<ItemOutcome> {
  // Idempotency: a previous successful import wins for the same externalId,
  // UNLESS the holder has voided that entry in the meantime. A voided entry
  // is a deliberate "this was wrong, take it off my logbook" — when the school
  // re-pushes the corrected flight under the same externalId, we treat the
  // (token, externalId) slot as available again, create a fresh entry, and
  // forward the mapping to it. The voided entry stays in the audit ledger.
  const existing = await findImportByExternalId(tokenId, it.externalId);
  if (existing && !existing.entryVoided) {
    return {
      externalId: it.externalId,
      status: "duplicate",
      entryId: existing.entryId,
      importedAt: existing.importedAt,
    };
  }

  try {
    const prepared = await prepareFlightEntry(it.entry, pilotId, { importPrefs: opts.importPrefs });
    if (!prepared.ok) {
      return { externalId: it.externalId, status: "invalid", issues: (prepared.body as { issues?: unknown }).issues ?? prepared.body };
    }
    if (opts.dryRun) {
      return { externalId: it.externalId, status: "validated" };
    }

    const created = await createEntry(prepared.input, prepared.derived, pilotId, `import:${it.externalId}`);
    if (existing && existing.entryVoided) {
      // Re-import after delete: forward the mapping to the new entry.
      await replaceImportTarget(tokenId, it.externalId, created.entryId);
    } else {
      try {
        await recordImport(tokenId, it.externalId, created.entryId);
      } catch (err) {
        // Concurrent retry won the unique constraint race; resolve to the winner.
        const winner = await findImportByExternalId(tokenId, it.externalId);
        if (winner && winner.entryId !== created.entryId && !winner.entryVoided) {
          return {
            externalId: it.externalId,
            status: "duplicate",
            entryId: winner.entryId,
            importedAt: winner.importedAt,
          };
        }
        throw err;
      }
    }
    void touchTokenUse(tokenId).catch(() => {});
    return { externalId: it.externalId, status: "created", entryId: created.entryId };
  } catch (err) {
    if (err instanceof RequestError) {
      return { externalId: it.externalId, status: "invalid", issues: [{ field: "body", message: err.message }] };
    }
    throw err;
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
