/**
 * Thin client over the Airdeck Logger API. The SPA and the API share an origin in
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
  token?: string;
  user?: SessionUser;
  mfaEnabled?: boolean;
  /** True when the account requires a second-factor code that was not supplied. */
  mfaRequired?: boolean;
}

export function login(email: string, password: string, code?: string): Promise<LoginResponse> {
  return request<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password, ...(code ? { code } : {}) }),
  });
}

export function register(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  addressStreet: string;
  addressZip: string;
  addressCountry: string;
  licenseNumber?: string;
}): Promise<{ id: string; email: string; emailVerificationToken: string; emailed: boolean }> {
  return request("/auth/register", { method: "POST", body: JSON.stringify(input) });
}

export function verifyEmail(token: string): Promise<{ emailVerified: boolean }> {
  return request("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) });
}

export function resendVerification(email: string): Promise<{ ok: boolean }> {
  return request("/auth/resend-verification", { method: "POST", body: JSON.stringify({ email }) });
}

export function requestPasswordReset(email: string): Promise<{ ok: boolean }> {
  return request("/auth/request-password-reset", { method: "POST", body: JSON.stringify({ email }) });
}

export function resetPassword(token: string, password: string): Promise<{ ok: boolean }> {
  return request("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
}

export interface AttributeDetails {
  hesloLevel?: 1 | 2 | 3 | 4;
  hecLevel?: 1 | 2;
  hoistCycles?: number;
  mountainLandingGear?: "SKI" | "WHEELS";
  lowVisibilityLandingType?: string;
}

export interface EntryColumns {
  kind: string;
  date: string;
  departurePlace: string;
  arrivalPlace: string;
  departurePlaceName?: string;
  arrivalPlaceName?: string;
  departureTime: string;
  arrivalTime: string;
  singleEngine: number;
  multiEngine: number;
  multiPilot: number;
  total: number;
  dayLandings: number;
  nightLandings: number;
  night: number;
  ifr: number;
  pic: number;
  coPilot: number;
  dual: number;
  instructor: number;
  isMultiFlight?: boolean;
  crewSize?: number;
  category?: string;
  operatingRole?: string;
  launchMethod?: string;
  instructorPosition?: string;
  attributes?: string[];
  attributeDetails?: AttributeDetails;
  signatureRequired?: boolean;
  enteredInLocalTime?: boolean;
  fstd?: { deviceType: string; qualificationNumber: string; totalMinutes: number };
}

export interface EntryContent {
  pilotId: string;
  picName?: string;
  remarks?: string;
  operatingRole?: string;
  aircraft?: { makeModelVariant?: string; registration?: string; engineClass?: "SE" | "ME"; multiPilot?: boolean; category?: string };
  function?: { primary?: string; instructor?: number; tookControl?: boolean };
  columns?: EntryColumns;
}

export interface EntryRow {
  id: string;
  locked: boolean;
  content: EntryContent;
}

export function listEntries(): Promise<{ entries: EntryRow[] }> {
  return request("/entries", { method: "GET" });
}

export interface NewEntryRequest {
  timeZone?: "UTC" | "LOCAL";
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
    departurePlaceName?: string;
    arrivalPlaceName?: string;
  }>;
  picName: string;
  landings: { day: number; night: number };
  conditions: { night: number; ifr: number };
  function: { primary: string; instructor: number };
  remarks: string;
  attributes?: string[];
  attributeDetails?: AttributeDetails;
}

export function createEntry(input: NewEntryRequest): Promise<{ entryId: string }> {
  return request("/entries", { method: "POST", body: JSON.stringify(input) });
}

export function amendEntry(id: string, input: NewEntryRequest & { reason?: string }): Promise<{ entryId: string }> {
  return request(`/entries/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteEntry(id: string): Promise<{ deleted: boolean }> {
  return request(`/entries/${id}`, { method: "DELETE" });
}

export interface NewFstdRequest {
  deviceType: string;
  deviceKind: string;
  qualificationNumber: string;
  instruction: string;
  date: string;
  totalMinutes: number;
  remarks: string;
  attributes?: string[];
}

export function createFstd(input: NewFstdRequest): Promise<{ entryId: string }> {
  return request("/fstd", { method: "POST", body: JSON.stringify(input) });
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

export interface AirportRef {
  icao: string;
  name: string;
  country: string | null;
}

export function searchAirports(q: string): Promise<{ airports: AirportRef[] }> {
  return request(`/reference/airports?q=${encodeURIComponent(q)}`, { method: "GET" });
}

export interface Profile {
  id: string;
  email: string | null;
  name: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  address: string | null;
  addressStreet: string | null;
  addressZip: string | null;
  addressCountry: string | null;
  licenseNumber: string | null;
  instructorCertificate: string | null;
  examinerCertificate: string | null;
  paperSize: "A4" | "LETTER";
  roles: string[];
  mfaEnabled: boolean;
  mfaRequiredForLogin: boolean;
}

export function getProfile(): Promise<Profile> {
  return request("/account", { method: "GET" });
}

export function updateProfile(input: {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  addressStreet?: string;
  addressZip?: string;
  addressCountry?: string;
  licenseNumber?: string;
  instructorCertificate?: string;
  examinerCertificate?: string;
  paperSize?: "A4" | "LETTER";
  mfaRequiredForLogin?: boolean;
}): Promise<Profile> {
  return request("/account", { method: "PATCH", body: JSON.stringify(input) });
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
    signerLicense: string | null;
  }>;
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

export function requestSignoff(
  entryId: string,
  input: { signerName: string; signerEmail: string; capacity: string },
): Promise<{ link: string; expiresAt: string; emailed: boolean; emailConfigured: boolean }> {
  return request(`/entries/${entryId}/request-signoff`, { method: "POST", body: JSON.stringify(input) });
}

export interface PublicSignoff {
  capacity: string;
  signerName: string;
  entry: {
    date: string | null;
    departurePlace: string | null;
    arrivalPlace: string | null;
    total: number | null;
    picName: string | null;
    aircraft: string;
    locked: boolean;
  };
}

export function getSignoffPublic(token: string): Promise<PublicSignoff> {
  return request(`/signoff/${token}`, { method: "GET" });
}

export function submitSignoffPublic(
  token: string,
  input: { signerName: string; signerLicense?: string; signatureImage?: string },
): Promise<{ locked: boolean }> {
  return request(`/signoff/${token}`, { method: "POST", body: JSON.stringify(input) });
}

export interface AdminStats {
  databaseSize: string;
  databaseSizeBytes: number;
  entries: number;
  users: number;
  aircraft: number;
  airports: number;
}

export function adminStats(): Promise<AdminStats> {
  return request("/admin/stats", { method: "GET" });
}

export function adminBootstrap(token: string): Promise<{ token: string; user: SessionUser }> {
  return request("/admin/bootstrap", { method: "POST", body: JSON.stringify({ token }) });
}

export function adminImportAirports(): Promise<{ imported: number; source: string }> {
  return request("/admin/import-airports", { method: "GET" });
}

export function adminImportAircraft(): Promise<{ imported: number; configured: boolean; message?: string; source?: string }> {
  return request("/admin/import-aircraft", { method: "POST" });
}

export async function exportLogbookPdf(): Promise<Blob> {
  const token = getToken();
  const res = await fetch("/api/export/logbook", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, "Could not generate the export.");
  return res.blob();
}
