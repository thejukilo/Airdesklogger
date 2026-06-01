/**
 * Thin client over the Airdeck Logger API. The SPA and the API share an origin in
 * production, so paths are relative. The session token is kept in localStorage
 * and attached as a bearer on every request.
 */

import { recordServerDate } from "./lib/clockSkew";

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

// Called when an authenticated request is rejected because the session token is
// missing/expired (401), so the app can clear the session and return to login.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const startedAt = Date.now();
  const res = await fetch(`/api${path}`, { ...init, headers });
  recordServerDate(res.headers.get("date"), startedAt, Date.now());
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
    // A 401 on a request we sent a token with means the session is no longer
    // valid: drop it and let the app send the user back to sign in.
    if (res.status === 401 && token) onUnauthorized?.();
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
  // Legacy single-HESLO/HEC, kept for older entries.
  hesloLevel?: 1 | 2 | 3 | 4;
  hecLevel?: 1 | 2;
  hoistCycles?: number;
  lowVisibilityLandingType?: string;
  // Aeroplane / helicopter mountain landings.
  mountainLandingGear?: "SKI" | "WHEELS";
  mountainLandings?: number;
  mountainLandingsOfficial?: number;
  mountainLandingsAbove2000?: number;
  mountainLandingsAbove2700?: number;
  // Aeroplane manoeuvres.
  goArounds?: number;
  touchAndGo?: number;
  // Helicopter operations.
  hdfTakeoffs?: number;
  nvisMinutes?: number;
  heslo1Cycles?: number;
  heslo2Cycles?: number;
  heslo3Cycles?: number;
  heslo4Cycles?: number;
  hec1Cycles?: number;
  hec2Cycles?: number;
  hhoCycles?: number;
  // Sailplane / shared.
  aerobaticLevel?: "BASIC" | "ADVANCED";
  // Comments on checks.
  skillTestComment?: string;
  proficiencyCheckComment?: string;
  licenceProficiencyCheckComment?: string;
  languageProficiencyComment?: string;
  aocComment?: string;
  demoFlightComment?: string;
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
  dayNightPattern?: string;
  pic: number;
  coPilot: number;
  dual: number;
  instructor: number;
  isMultiFlight?: boolean;
  crewSize?: number;
  category?: string;
  operatingRole?: string;
  launchMethod?: string;
  balloonFlightType?: "FREE" | "TETHERED";
  inflations?: number;
  balloonGroupA?: number;
  balloonGroupB?: number;
  balloonGroupC?: number;
  balloonGroupD?: number;
  balloonGas?: number;
  flightTimeMinutes?: number;
  instructorPosition?: string;
  attributes?: string[];
  attributeDetails?: AttributeDetails;
  signatureRequired?: boolean;
  enteredInLocalTime?: boolean;
  timesLocal?: boolean;
  counters?: {
    ftcStart?: number;
    ftcEnd?: number;
    hobbsStart?: number;
    hobbsEnd?: number;
  };
  track?: {
    type: "LineString";
    coordinates: Array<[number, number] | [number, number, number]>;
  };
  fstd?: { deviceType: string; qualificationNumber: string; totalMinutes: number };
}

export interface EntryContent {
  pilotId: string;
  picName?: string;
  remarks?: string;
  operatingRole?: string;
  aircraft?: { makeModelVariant?: string; registration?: string; engineClass?: "SE" | "ME"; multiPilot?: boolean; category?: string; balloonGroup?: string };
  function?: { primary?: string; instructor?: number; tookControl?: boolean };
  columns?: EntryColumns;
}

export interface EntryRow {
  id: string;
  locked: boolean;
  content: EntryContent;
  /** Present when the entry was created via the Import API. */
  import_source?: string | null;
  import_at?: string | null;
  /** True when the holder has voided this entry. Only present when includeVoided is requested. */
  voided?: boolean;
  voided_at?: string | null;
}

export function listEntries(opts: { includeVoided?: boolean } = {}): Promise<{ entries: EntryRow[] }> {
  const qs = opts.includeVoided ? "?includeVoided=1" : "";
  return request(`/entries${qs}`, { method: "GET" });
}

export interface NewEntryRequest {
  timeZone?: "UTC" | "LOCAL";
  aircraft: {
    makeModelVariant: string;
    registration: string;
    engineClass: "SE" | "ME";
    multiPilot: boolean;
    category?: string;
    balloonGroup?: string;
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
  function: { primary: string; instructor: number; instructorPosition?: string; tookControl?: boolean };
  remarks: string;
  operatingRole?: string;
  launchMethod?: string;
  balloonFlightType?: "FREE" | "TETHERED";
  inflations?: number;
  flightTimeMinutes?: number;
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
  deviceType: string; // aircraft model
  qualificationNumber: string; // EASA code
  qualification?: string; // FSTD type
  pilotFunction?: "TRAINEE" | "SFI_SFE";
  instruction?: string;
  date: string;
  totalMinutes: number;
  landings?: { day: number; night: number };
  remarks: string;
  attributes?: string[];
}

export function createFstd(input: NewFstdRequest): Promise<{ entryId: string }> {
  return request("/fstd", { method: "POST", body: JSON.stringify(input) });
}

export interface SimulatorRef {
  id: string;
  easaCode: string;
  serialNumber: string | null;
  aircraftType: string | null;
  qualification: string | null;
  location: string | null;
}

export function searchSimulators(q: string): Promise<{ simulators: SimulatorRef[] }> {
  return request(`/reference/simulators?q=${encodeURIComponent(q)}`, { method: "GET" });
}

export function addSimulator(input: {
  easaCode: string;
  aircraftType: string;
  qualification: string;
  serialNumber?: string;
}): Promise<{ id: string }> {
  return request("/reference/simulators", { method: "POST", body: JSON.stringify(input) });
}

export interface AircraftMatch {
  registration: string;
  model: string;
  icaoType?: string;
  category: string;
  engineType?: string;
  engineCount?: number;
  multiPilot?: boolean;
  /** Group A/B/C/D for balloons (envelope-volume band that bounds the rating). */
  balloonGroup?: string;
}

export function lookupAircraft(
  registration: string,
): Promise<{
  match: AircraftMatch | null;
  source: "db" | "external" | "none";
  subtype: string | null;
  allowedCategories?: string[];
}> {
  return request(`/reference/aircraft?registration=${encodeURIComponent(registration)}`, {
    method: "GET",
  });
}

export interface AirportRef {
  icao: string;
  name: string;
  country: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** IANA timezone derived from coords; null when unavailable. */
  timezone?: string | null;
}

/**
 * Resolve an exact ICAO to its coords (and metadata). Used by the Log-a-flight
 * form to decide whether a flight crosses civil twilight and the landings
 * field should split into day and night inputs. Returns null when the airport
 * isn't in our reference table.
 */
export async function findAirport(icao: string): Promise<AirportRef | null> {
  const normalized = icao.trim().toUpperCase();
  if (normalized.length !== 4) return null;
  const { airports } = await searchAirports(normalized);
  return airports.find((a) => a.icao === normalized) ?? null;
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
  /** True once any flight has been logged: name and DOB become read-only. */
  identityLocked: boolean;
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
    signedPlace: string | null;
  }>;
}

export function getEntry(id: string): Promise<EntryDetail> {
  return request(`/entries/${id}`, { method: "GET" });
}

export function signEntry(
  id: string,
  body: { code: string; role: string; signatureImage: string; signedPlace: string },
): Promise<{ locked: boolean }> {
  return request(`/entries/${id}/sign`, { method: "POST", body: JSON.stringify(body) });
}

export function requestSignoff(
  entryId: string,
  input: { signerName: string; signerEmail: string; capacity: string },
): Promise<{ link: string; expiresAt: string; emailed: boolean; emailConfigured: boolean; entryCount: number }> {
  return request(`/entries/${entryId}/request-signoff`, { method: "POST", body: JSON.stringify(input) });
}

/** Request one signing link covering multiple entries (FOCA 2.4.2 bulk sign-off). */
export function requestSignoffBatch(
  input: { entryIds: string[]; signerName: string; signerEmail: string; capacity: string },
): Promise<{ link: string; expiresAt: string; emailed: boolean; emailConfigured: boolean; entryCount: number }> {
  return request(`/entries/batch/request-signoff`, { method: "POST", body: JSON.stringify(input) });
}

export interface PublicSignoffEntry {
  id: string;
  date: string | null;
  departurePlace: string | null;
  arrivalPlace: string | null;
  total: number | null;
  picName: string | null;
  aircraft: string;
  locked: boolean;
}

export interface PublicSignoff {
  capacity: string;
  signerName: string;
  entries: PublicSignoffEntry[];
}

export function getSignoffPublic(token: string): Promise<PublicSignoff> {
  return request(`/signoff/${token}`, { method: "GET" });
}

export function submitSignoffPublic(
  token: string,
  input: { signerName: string; signerLicense?: string; signatureImage: string; signedPlace: string },
): Promise<{ locked: boolean; entryIds: string[] }> {
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

export function adminSeedIcaoTypes(): Promise<{ seeded: number }> {
  return request("/admin/seed-icao-types", { method: "POST" });
}

export function adminSeedAircraft(): Promise<{ seeded: number }> {
  return request("/admin/seed-aircraft", { method: "POST" });
}

export function adminSeedAircraftEurope(): Promise<{ seeded: number }> {
  return request("/admin/seed-aircraft-europe", { method: "POST" });
}

export function adminSeedSimulators(): Promise<{ seeded: number }> {
  return request("/admin/seed-simulators", { method: "POST" });
}

export function adminApplyBalloonGroups(csv: string): Promise<{ updated: number }> {
  return request("/admin/apply-balloon-groups", { method: "POST", body: JSON.stringify({ csv }) });
}

/**
 * DEV ONLY — wipes every flight entry, signature, sign-off request, import
 * mapping, and audit-ledger row across all pilots. Removed once the system
 * starts carrying real regulatory data.
 */
export function adminWipeAllEntries(): Promise<{ wiped: true; before: Record<string, number> }> {
  return request("/admin/wipe-all-entries", {
    method: "POST",
    body: JSON.stringify({ confirm: "WIPE_ALL_LOGS" }),
  });
}

export type ImportTokenSourceTz = "UTC" | "LOCAL";
export type ImportTokenStoreTz = "UTC" | "LOCAL";
export type ImportTokenTmgFiling = "AEROPLANE" | "SAILPLANE";

export interface ImportToken {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  sourceTimeZone: ImportTokenSourceTz;
  storeTimeZone: ImportTokenStoreTz;
  tmgCategory: ImportTokenTmgFiling;
}

export interface ImportTokenPrefsInput {
  sourceTimeZone?: ImportTokenSourceTz;
  storeTimeZone?: ImportTokenStoreTz;
  tmgCategory?: ImportTokenTmgFiling;
}

export function listImportTokens(): Promise<{ tokens: ImportToken[] }> {
  return request("/account/import-tokens", { method: "GET" });
}

export function createImportToken(
  name: string,
  prefs: ImportTokenPrefsInput = {},
): Promise<{ token: string; row: ImportToken }> {
  return request("/account/import-tokens", {
    method: "POST",
    body: JSON.stringify({ name, ...prefs }),
  });
}

export function updateImportToken(
  id: string,
  patch: ImportTokenPrefsInput & { name?: string },
): Promise<{ row: ImportToken }> {
  return request(`/account/import-tokens/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function revokeImportToken(id: string): Promise<void> {
  return request(`/account/import-tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function exportLogbookPdf(): Promise<Blob> {
  const token = getToken();
  const res = await fetch("/api/export/logbook", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, "Could not generate the export.");
  return res.blob();
}
