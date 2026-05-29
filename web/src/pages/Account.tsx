import { useEffect, useState, type FormEvent } from "react";
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
function ImportTokensCard() {
  const [tokens, setTokens] = useState<api.ImportToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<{ token: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

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
      const { token, row } = await api.createImportToken(name.trim());
      setNewSecret({ token, name: row.name });
      setName("");
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

      <form onSubmit={create} className="mb-3 flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[12rem]">
          <Field
            label="Token name"
            placeholder="e.g. Aero-Club logbook"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={creating}
          />
        </div>
        <Button type="submit" disabled={creating || !name.trim()}>
          {creating ? "Creating..." : "Create token"}
        </Button>
      </form>

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
                <th className="px-3 py-2 text-left">Last used</th>
                <th className="px-3 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...active, ...revoked].map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-700">{t.name}</td>
                  <td className="px-3 py-2"><code className="text-xs">{t.tokenPrefix}...</code></td>
                  <td className="px-3 py-2 text-slate-500">
                    {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {t.revokedAt ? (
                      <span className="text-xs text-slate-400">revoked</span>
                    ) : (
                      <button
                        type="button"
                        className="text-xs font-medium text-rose-700 hover:underline disabled:opacity-50"
                        onClick={() => revoke(t.id, t.name)}
                        disabled={revokingId === t.id}
                      >
                        {revokingId === t.id ? "Revoking..." : "Revoke"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
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
