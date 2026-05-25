/**
 * Thin client over the AirdeskLogger API. The SPA and the API share an origin in
 * production, so paths are relative. The session token is kept in localStorage
 * and attached as a bearer on every request.
 */

const TOKEN_KEY = "airdesk.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`/api${path}`, { ...init, headers });
  const text = await res.text();

  let body: { error?: string; issues?: Array<{ message?: string }> } = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // The body was not JSON. This usually means a platform error page rather
      // than one of our handlers (for example a 500 before the function ran).
      // Surface something the user can act on instead of a parse error.
      const message =
        res.status >= 500
          ? "The server had an error. The deployment may be missing its database connection or auth secrets."
          : `Unexpected response from the server (${res.status}).`;
      throw new ApiError(res.status, message);
    }
  }
  if (!res.ok) {
    const message = body?.error ?? body?.issues?.[0]?.message ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export interface SessionUser {
  id: string;
  email: string | null;
  name: string;
  roles: string[];
}

export interface LoginResponse {
  token: string;
  user: SessionUser;
  mfaEnabled: boolean;
}

export function login(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function register(input: {
  email: string;
  password: string;
  name: string;
  licenseNumber?: string;
}): Promise<{ id: string; email: string; emailVerificationToken: string }> {
  return request("/auth/register", { method: "POST", body: JSON.stringify(input) });
}

export interface EntrySummary {
  id: string;
  date: string;
  total_minutes: string | null;
  locked: boolean;
}

export function listEntries(): Promise<{ entries: EntrySummary[] }> {
  return request("/entries", { method: "GET" });
}

export interface NewEntryRequest {
  aircraft: {
    makeModelVariant: string;
    registration: string;
    engineClass: "SE" | "ME";
    multiPilot: boolean;
    category?: string;
  };
  legs: Array<{
    departurePlace: string;
    departureTime: string;
    arrivalPlace: string;
    arrivalTime: string;
  }>;
  picName: string;
  landings: { day: number; night: number };
  conditions: { night: number; ifr: number };
  function: { primary: string; instructor: number };
  remarks: string;
  attributes?: string[];
}

export function createEntry(input: NewEntryRequest): Promise<{ entryId: string }> {
  return request("/entries", { method: "POST", body: JSON.stringify(input) });
}

export interface AircraftMatch {
  registration: string;
  model: string;
  icaoType?: string;
  category: string;
  engineType?: string;
  engineCount?: number;
  multiPilot?: boolean;
}

export function lookupAircraft(
  registration: string,
): Promise<{ match: AircraftMatch | null; source: "db" | "external" | "none" }> {
  return request(`/reference/aircraft?registration=${encodeURIComponent(registration)}`, {
    method: "GET",
  });
}

export function mfaSetup(): Promise<{ secret: string; otpauthUri: string }> {
  return request("/auth/mfa/setup", { method: "POST" });
}

export function mfaActivate(code: string): Promise<{ mfaEnabled: boolean }> {
  return request("/auth/mfa/activate", { method: "POST", body: JSON.stringify({ code }) });
}

export interface EntryDetail {
  current: { version_no: number; content: EntryContent; content_hash: string; locked: boolean } | null;
  history: Array<{
    version_no: number;
    content_hash: string;
    change_reason: string | null;
    created_at: string;
  }>;
  signatures: Array<{
    signerName: string;
    signerRole: string;
    signedAt: string;
    signatureImage: string | null;
  }>;
}

export interface EntryContent {
  pilotId: string;
  picName?: string;
  remarks?: string;
  aircraft?: { makeModelVariant?: string; registration?: string };
  columns?: Record<string, unknown>;
}

export function getEntry(id: string): Promise<EntryDetail> {
  return request(`/entries/${id}`, { method: "GET" });
}

export function signEntry(
  id: string,
  body: { code: string; role: string; signatureImage?: string },
): Promise<{ locked: boolean }> {
  return request(`/entries/${id}/sign`, { method: "POST", body: JSON.stringify(body) });
}

export async function exportLogbookPdf(): Promise<Blob> {
  const token = getToken();
  const res = await fetch("/api/export/logbook", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, "Could not generate the export.");
  return res.blob();
}
