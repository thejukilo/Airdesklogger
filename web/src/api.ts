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
  const body = text ? JSON.parse(text) : {};
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

export async function exportLogbookPdf(): Promise<Blob> {
  const token = getToken();
  const res = await fetch("/api/export/logbook", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, "Could not generate the export.");
  return res.blob();
}
