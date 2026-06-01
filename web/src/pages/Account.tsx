import { useEffect, useState, Fragment, type FormEvent } from "react";
import QRCode from "qrcode";
import { useAuth } from "../auth";
import * as api from "../api";
import { Alert, Button, Card, Field, Select } from "../components/ui";
import { AddressAutocomplete } from "../components/AddressAutocomplete";

const emptyProfile = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  addressStreet: "",
  addressZip: "",
  addressCountry: "",
  licenseNumber: "",
  instructorCertificate: "",
  examinerCertificate: "",
  paperSize: "A4" as "A4" | "LETTER",
};

export function Account() {
  const { user, mfaEnabled, setMfaEnabled, refreshUser } = useAuth();
  const [secret, setSecret] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [profile, setProfile] = useState(emptyProfile);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  // True once a flight has been logged: forename, surname and DOB are frozen
  // server-side, and we mirror that in the UI as disabled inputs.
  const [identityLocked, setIdentityLocked] = useState(false);

  const [mfaLogin, setMfaLogin] = useState(false);
  const [savingMfaLogin, setSavingMfaLogin] = useState(false);

  useEffect(() => {
    api
      .getProfile()
      .then((p) => {
        // The account is created with a single full name; split it as a starting
        // point for forename and surname when those are not yet set.
        const parts = (p.name ?? "").trim().split(/\s+/).filter(Boolean);
        setProfile({
          firstName: p.firstName ?? parts[0] ?? "",
          lastName: p.lastName ?? parts.slice(1).join(" "),
          dateOfBirth: p.dateOfBirth ?? "",
          addressStreet: p.addressStreet ?? "",
          addressZip: p.addressZip ?? "",
          addressCountry: p.addressCountry ?? "",
          licenseNumber: p.licenseNumber ?? "",
          instructorCertificate: p.instructorCertificate ?? "",
          examinerCertificate: p.examinerCertificate ?? "",
          paperSize: p.paperSize ?? "A4",
        });
        setMfaLogin(p.mfaRequiredForLogin);
        setIdentityLocked(p.identityLocked);
      })
      .catch((err) => setProfileMsg(err instanceof Error ? err.message : "Could not load your profile."));
  }, []);

  async function toggleMfaLogin(required: boolean) {
    setMfaLogin(required);
    setSavingMfaLogin(true);
    try {
      await api.updateProfile({ mfaRequiredForLogin: required });
    } catch {
      setMfaLogin(!required); // revert on failure
    } finally {
      setSavingMfaLogin(false);
    }
  }

  const setP = (k: Exclude<keyof typeof profile, "paperSize">) => (e: { target: { value: string } }) =>
    setProfile((p) => ({ ...p, [k]: e.target.value }));

  const [paperMsg, setPaperMsg] = useState<string | null>(null);
  const [savingPaper, setSavingPaper] = useState(false);

  async function savePaper(size: "A4" | "LETTER") {
    setProfile((p) => ({ ...p, paperSize: size }));
    setPaperMsg(null);
    setSavingPaper(true);
    try {
      await api.updateProfile({ paperSize: size });
      setPaperMsg("Export setting saved.");
    } catch (err) {
      setPaperMsg(err instanceof Error ? err.message : "Could not save the setting.");
    } finally {
      setSavingPaper(false);
    }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const updated = await api.updateProfile(profile);
      refreshUser({ id: updated.id, email: updated.email, name: updated.name, roles: updated.roles });
      setProfileMsg("Profile saved.");
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : "Could not save the profile.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function startSetup() {
    setError(null);
    setBusy(true);
    try {
      const { secret, otpauthUri } = await api.mfaSetup();
      setSecret(secret);
      setQr(await QRCode.toDataURL(otpauthUri, { margin: 1, width: 200 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start MFA setup.");
    } finally {
      setBusy(false);
    }
  }

  async function activate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.mfaActivate(code.trim());
      setMfaEnabled(true);
      setSecret(null);
      setQr(null);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code did not match.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">Account</h1>

      <SubscriptionCard />

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Profile</h2>
          <span className="text-xs text-slate-500">{user?.email} &middot; {user?.roles.join(", ")}</span>
        </div>
        <form onSubmit={saveProfile} className="space-y-4">
          {profileMsg && <p className="text-sm text-slate-600">{profileMsg}</p>}
          <div className={`rounded-md border px-3 py-2 text-xs ${
            identityLocked
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-slate-200 bg-slate-50 text-slate-600"
          }`}>
            <strong className="block font-semibold">
              {identityLocked ? "Identity locked" : "Important: your identity will lock once you log a flight"}
            </strong>
            <span className="mt-0.5 block">
              {identityLocked
                ? "First name, last name and date of birth can no longer be changed because flights have been logged under this account. This protects the regulatory chain that ties every signed entry to a single physical person."
                : "EASA logbook records must stay tied to one physical person. As soon as your first flight is logged, first name, last name and date of birth become permanent. Double-check them now."}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="First name"
              value={profile.firstName}
              onChange={setP("firstName")}
              disabled={identityLocked}
            />
            <Field
              label="Last name"
              value={profile.lastName}
              onChange={setP("lastName")}
              disabled={identityLocked}
            />
            <div className="sm:max-w-[14rem]">
              <Field
                label="Date of birth"
                type="date"
                value={profile.dateOfBirth}
                onChange={setP("dateOfBirth")}
                disabled={identityLocked}
              />
            </div>
            <Field label="Pilot licence number" value={profile.licenseNumber} onChange={setP("licenseNumber")} />
          </div>
          <AddressAutocomplete
            countryHint="ch"
            onSelect={(a) =>
              setProfile((p) => ({
                ...p,
                addressStreet: a.street || p.addressStreet,
                addressZip: [a.zip, a.place].filter(Boolean).join(" ") || p.addressZip,
                addressCountry: a.country || p.addressCountry,
              }))
            }
          />
          <Field label="Street / no." value={profile.addressStreet} onChange={setP("addressStreet")} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="ZIP / place" value={profile.addressZip} onChange={setP("addressZip")} />
            <Field label="Country" value={profile.addressCountry} onChange={setP("addressCountry")} />
          </div>
          <div className="rounded-md bg-slate-50 p-3">
            <p className="mb-2 text-xs text-slate-500">
              Enter a certificate number to be able to countersign in that capacity. The number is
              recorded on every sign-off you make.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Instructor certificate (FI, CRI, ...)" value={profile.instructorCertificate} onChange={setP("instructorCertificate")} />
              <Field label="Examiner certificate (FE, ...)" value={profile.examinerCertificate} onChange={setP("examinerCertificate")} />
            </div>
          </div>
          <Button type="submit" disabled={savingProfile}>
            {savingProfile ? "Saving..." : "Save profile"}
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-1 font-medium">Export settings</h2>
        <p className="mb-3 text-sm text-slate-500">
          Choose the paper size for your logbook PDF. Both render the EASA grid in landscape.
        </p>
        <div className="max-w-xs">
          <Select
            label="Paper size"
            value={profile.paperSize}
            disabled={savingPaper}
            onChange={(e) => savePaper(e.target.value === "LETTER" ? "LETTER" : "A4")}
          >
            <option value="A4">A4 (landscape)</option>
            <option value="LETTER">US Letter (landscape)</option>
          </Select>
        </div>
        {paperMsg && <p className="mt-2 text-sm text-slate-600">{paperMsg}</p>}
      </Card>

      <ImportTokensCard />

      <Card>
        <h2 className="mb-1 font-medium">Two-factor authentication</h2>
        <p className="mb-3 text-sm text-slate-500">
          Required to countersign entries. Add the key to an authenticator app, then confirm a code.
        </p>
        {error && <Alert>{error}</Alert>}

        {mfaEnabled ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-700">Two-factor authentication is enabled.</p>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={mfaLogin}
                disabled={savingMfaLogin}
                onChange={(e) => toggleMfaLogin(e.target.checked)}
              />
              Also require a code when I sign in (not just when signing entries)
            </label>
          </div>
        ) : !secret ? (
          <Button onClick={startSetup} disabled={busy}>
            {busy ? "Starting..." : "Set up MFA"}
          </Button>
        ) : (
          <form onSubmit={activate} className="space-y-3">
            {qr && <img src={qr} alt="Authenticator QR code" className="rounded border" />}
            <p className="text-xs text-slate-500">
              Or enter this key manually: <code className="break-all">{secret}</code>
            </p>
            <Field
              label="6-digit code from your app"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              required
            />
            <Button type="submit" disabled={busy}>
              {busy ? "Verifying..." : "Activate"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}

/**
 * Personal access tokens for the Import API. A pilot creates one for each
 * external system (one per flight school is the usual pattern), and the secret
 * is shown once on the screen — there is no way to recover it afterwards.
 */
type SrcTz = api.ImportTokenSourceTz;
type DstTz = api.ImportTokenStoreTz;
type TmgF = api.ImportTokenTmgFiling;

interface TokenPrefsState {
  sourceTimeZone: SrcTz;
  storeTimeZone: DstTz;
  tmgCategory: TmgF;
}

const DEFAULT_PREFS: TokenPrefsState = {
  sourceTimeZone: "UTC",
  storeTimeZone: "UTC",
  tmgCategory: "AEROPLANE",
};

function TimeZoneRadio({
  legend,
  hint,
  value,
  onChange,
  disabled,
}: {
  legend: string;
  hint: string;
  value: SrcTz | DstTz;
  onChange: (v: "UTC" | "LOCAL") => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-xs font-medium uppercase tracking-wide text-slate-500">{legend}</legend>
      <div className="space-y-1 text-sm">
        <label className="flex items-start gap-2">
          <input type="radio" className="mt-1" checked={value === "UTC"}
                 onChange={() => onChange("UTC")} disabled={disabled} />
          <span>UTC</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" className="mt-1" checked={value === "LOCAL"}
                 onChange={() => onChange("LOCAL")} disabled={disabled} />
          <span>Local time</span>
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-500">{hint}</p>
    </fieldset>
  );
}

function TmgRadio({
  value,
  onChange,
  disabled,
}: {
  value: TmgF;
  onChange: (v: TmgF) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-xs font-medium uppercase tracking-wide text-slate-500">TMG aircraft</legend>
      <div className="space-y-1 text-sm">
        <label className="flex items-start gap-2">
          <input type="radio" className="mt-1" checked={value === "AEROPLANE"}
                 onChange={() => onChange("AEROPLANE")} disabled={disabled} />
          <span>Log under Aeroplane</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" className="mt-1" checked={value === "SAILPLANE"}
                 onChange={() => onChange("SAILPLANE")} disabled={disabled} />
          <span>Log under Sailplane</span>
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Touring motor gliders. Regulatory choice — match how you log your other TMG flights so totals line up.
      </p>
    </fieldset>
  );
}

function prefChips(t: api.ImportToken) {
  const arrow = "→";
  return [
    `Time: ${t.sourceTimeZone} ${arrow} ${t.storeTimeZone}`,
    `TMG: ${t.tmgCategory === "AEROPLANE" ? "Aeroplane" : "Sailplane"}`,
  ];
}

function ImportTokensCard() {
  const [tokens, setTokens] = useState<api.ImportToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [name, setName] = useState("");
  const [prefs, setPrefs] = useState<TokenPrefsState>(DEFAULT_PREFS);
  const [newSecret, setNewSecret] = useState<{ token: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<TokenPrefsState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  async function refresh() {
    try {
      const { tokens } = await api.listImportTokens();
      setTokens(tokens);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load tokens.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setCreating(true);
    try {
      const { token, row } = await api.createImportToken(name.trim(), prefs);
      setNewSecret({ token, name: row.name });
      setName("");
      setPrefs(DEFAULT_PREFS);
      setCreatorOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create token.");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string, tokenName: string) {
    if (!confirm(`Revoke "${tokenName}"? Any system using this token will stop being able to import flights.`)) return;
    setError(null);
    setRevokingId(id);
    try {
      await api.revokeImportToken(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke token.");
    } finally {
      setRevokingId(null);
    }
  }

  function beginEdit(t: api.ImportToken) {
    setEditingId(t.id);
    setEditDraft({
      sourceTimeZone: t.sourceTimeZone,
      storeTimeZone: t.storeTimeZone,
      tmgCategory: t.tmgCategory,
    });
  }

  async function saveEdit(id: string) {
    if (!editDraft) return;
    setError(null);
    setSavingEdit(true);
    try {
      await api.updateImportToken(id, editDraft);
      setEditingId(null);
      setEditDraft(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update token.");
    } finally {
      setSavingEdit(false);
    }
  }

  const active = tokens.filter((t) => !t.revokedAt);
  const revoked = tokens.filter((t) => t.revokedAt);

  return (
    <Card>
      <h2 className="mb-1 font-medium">Import tokens</h2>
      <p className="mb-3 text-sm text-slate-500">
        Hand a token to an external system (your flight school's logbook software, for example) so it
        can append flights to your logbook. Tokens are write-only and bound to your account; they
        cannot sign, read, or change anything else.
      </p>
      {error && <Alert>{error}</Alert>}

      {newSecret && (
        <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">Token created &mdash; copy it now</p>
          <p className="mt-0.5 text-xs text-emerald-800">
            This is the only time the full secret is shown. Paste it into <strong>{newSecret.name}</strong>'s
            settings before closing this notice.
          </p>
          <code className="mt-2 block break-all rounded bg-white px-2 py-1 text-xs">{newSecret.token}</code>
          <button
            type="button"
            className="mt-2 text-xs font-medium text-emerald-900 underline"
            onClick={() => setNewSecret(null)}
          >
            I have copied it, hide this
          </button>
        </div>
      )}

      {!creatorOpen ? (
        <div className="mb-3">
          <Button type="button" onClick={() => setCreatorOpen(true)}>
            Create token
          </Button>
        </div>
      ) : (
        <form onSubmit={create} className="mb-3 space-y-3 rounded-md border border-slate-200 p-3">
          <Field
            label="Token name"
            placeholder="e.g. Aero-Club logbook"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={creating}
          />
          <div className="grid gap-3 md:grid-cols-3">
            <TimeZoneRadio
              legend="Source time format"
              hint="What the external system sends. Most modern school systems send UTC."
              value={prefs.sourceTimeZone}
              onChange={(v) => setPrefs((p) => ({ ...p, sourceTimeZone: v }))}
              disabled={creating}
            />
            <TimeZoneRadio
              legend="Store as"
              hint="What appears in your logbook. UTC is the regulatory norm; local time is common at gliding clubs."
              value={prefs.storeTimeZone}
              onChange={(v) => setPrefs((p) => ({ ...p, storeTimeZone: v }))}
              disabled={creating}
            />
            <TmgRadio
              value={prefs.tmgCategory}
              onChange={(v) => setPrefs((p) => ({ ...p, tmgCategory: v }))}
              disabled={creating}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="text-sm font-medium text-slate-500 hover:underline"
              onClick={() => { setCreatorOpen(false); setName(""); setPrefs(DEFAULT_PREFS); }}
              disabled={creating}
            >
              Cancel
            </button>
            <Button type="submit" disabled={creating || !name.trim()}>
              {creating ? "Generating..." : "Generate token"}
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            Scope is fixed to <code>entries:append</code> &mdash; tokens cannot sign, read, or edit anything else.
          </p>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : active.length === 0 && revoked.length === 0 ? (
        <p className="text-sm text-slate-500">You don't have any import tokens yet.</p>
      ) : (
        <div className="overflow-hidden rounded border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Token</th>
                <th className="px-3 py-2 text-left">Settings</th>
                <th className="px-3 py-2 text-left">Last used</th>
                <th className="px-3 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...active, ...revoked].map((t) => {
                const editing = editingId === t.id && editDraft;
                return (
                  <Fragment key={t.id}>
                    <tr className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-700">{t.name}</td>
                      <td className="px-3 py-2"><code className="text-xs">{t.tokenPrefix}...</code></td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {prefChips(t).map((chip) => (
                            <span key={chip} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{chip}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {t.revokedAt ? (
                          <span className="text-xs text-slate-400">revoked</span>
                        ) : (
                          <div className="flex justify-end gap-3">
                            <button
                              type="button"
                              className="text-xs font-medium text-sky-700 hover:underline disabled:opacity-50"
                              onClick={() => beginEdit(t)}
                              disabled={editingId === t.id}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="text-xs font-medium text-rose-700 hover:underline disabled:opacity-50"
                              onClick={() => revoke(t.id, t.name)}
                              disabled={revokingId === t.id}
                            >
                              {revokingId === t.id ? "Revoking..." : "Revoke"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {editing && (
                      <tr className="border-t border-slate-100 bg-slate-50">
                        <td colSpan={5} className="px-3 py-3">
                          <div className="grid gap-3 md:grid-cols-3">
                            <TimeZoneRadio
                              legend="Source time format"
                              hint="What the external system sends."
                              value={editDraft!.sourceTimeZone}
                              onChange={(v) => setEditDraft((d) => d && ({ ...d, sourceTimeZone: v }))}
                              disabled={savingEdit}
                            />
                            <TimeZoneRadio
                              legend="Store as"
                              hint="What appears in your logbook."
                              value={editDraft!.storeTimeZone}
                              onChange={(v) => setEditDraft((d) => d && ({ ...d, storeTimeZone: v }))}
                              disabled={savingEdit}
                            />
                            <TmgRadio
                              value={editDraft!.tmgCategory}
                              onChange={(v) => setEditDraft((d) => d && ({ ...d, tmgCategory: v }))}
                              disabled={savingEdit}
                            />
                          </div>
                          <div className="mt-3 flex justify-end gap-2">
                            <button
                              type="button"
                              className="text-sm font-medium text-slate-500 hover:underline"
                              onClick={() => { setEditingId(null); setEditDraft(null); }}
                              disabled={savingEdit}
                            >
                              Cancel
                            </button>
                            <Button type="button" onClick={() => saveEdit(t.id)} disabled={savingEdit}>
                              {savingEdit ? "Saving..." : "Save"}
                            </Button>
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            Changes apply to <strong>future</strong> imports through this token. Entries already in your logbook are not modified.
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-500">
        For the request shape and field mapping, see <code>docs/api-import-v1.md</code> in the
        Airdesklogger repository, or the OpenAPI spec in <code>docs/openapi-import-v1.yaml</code>.
      </p>
    </Card>
  );
}

/**
 * Subscription card on the Account page. Shows the current plan state, the
 * next charge date, and (for any state that has a Stripe customer behind
 * it) a button that opens the Stripe-hosted Customer Portal where the
 * holder can change card, see invoices, or cancel. New / trial accounts
 * see a one-button Subscribe CTA that opens Stripe Checkout.
 */
function SubscriptionCard() {
  const { profile } = useAuth();
  const sub = profile?.subscription;
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!sub) return null;

  async function openCheckout() {
    setError(null);
    setBusy("checkout");
    try {
      const { url } = await api.startCheckout();
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open checkout.");
      setBusy(null);
    }
  }

  async function openPortal() {
    setError(null);
    setBusy("portal");
    try {
      const { url } = await api.openBillingPortal();
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open billing portal.");
      setBusy(null);
    }
  }

  const labels: Record<api.SubscriptionState, { title: string; tone: string; }> = {
    trialing:  { title: "Trial",                tone: "bg-amber-100 text-amber-800"   },
    active:    { title: "Active",               tone: "bg-emerald-100 text-emerald-800" },
    past_due:  { title: "Payment failed",       tone: "bg-amber-100 text-amber-900"   },
    cancelled: { title: "Cancelled",            tone: "bg-slate-100 text-slate-700"   },
    read_only: { title: "Read-only",            tone: "bg-rose-100 text-rose-800"     },
  };
  const l = labels[sub.state];

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Subscription</h2>
          <p className="text-xs text-slate-500">Single plan · CHF 5.99 / month · cancel anytime</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${l.tone}`}>{l.title}</span>
      </div>

      {error && <div className="mt-3"><Alert>{error}</Alert></div>}

      <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
        {sub.state === "trialing" && sub.trialEndsAt && (
          <>
            <dt className="text-slate-500">Trial ends</dt>
            <dd className="text-right tabular-nums">{sub.trialEndsAt.slice(0, 10)}</dd>
          </>
        )}
        {sub.subscriptionPeriodEnd && (sub.state === "active" || sub.state === "cancelled" || sub.state === "past_due") && (
          <>
            <dt className="text-slate-500">{sub.state === "cancelled" ? "Access until" : "Next charge"}</dt>
            <dd className="text-right tabular-nums">{sub.subscriptionPeriodEnd.slice(0, 10)}</dd>
          </>
        )}
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        {(sub.state === "trialing" || sub.state === "read_only" || sub.state === "cancelled" || sub.state === "past_due") && (
          <Button onClick={openCheckout} disabled={busy !== null}>
            {busy === "checkout"
              ? "Opening checkout..."
              : sub.state === "cancelled" ? "Resume — CHF 5.99 / mo"
              : sub.state === "past_due" ? "Update payment"
              : "Subscribe — CHF 5.99 / mo"}
          </Button>
        )}
        {(sub.state === "active" || sub.state === "past_due" || sub.state === "cancelled") && (
          <button
            type="button"
            onClick={openPortal}
            disabled={busy !== null}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {busy === "portal" ? "Opening portal..." : "Manage payment / cancel"}
          </button>
        )}
      </div>
    </Card>
  );
}
