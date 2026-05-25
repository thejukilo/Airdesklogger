import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { useAuth } from "../auth";
import * as api from "../api";
import { Alert, Button, Card, Field, Select } from "../components/ui";

const emptyProfile = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  address: "",
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
          address: p.address ?? "",
          licenseNumber: p.licenseNumber ?? "",
          instructorCertificate: p.instructorCertificate ?? "",
          examinerCertificate: p.examinerCertificate ?? "",
          paperSize: p.paperSize ?? "A4",
        });
        setMfaLogin(p.mfaRequiredForLogin);
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="First name" value={profile.firstName} onChange={setP("firstName")} />
            <Field label="Last name" value={profile.lastName} onChange={setP("lastName")} />
            <div className="max-w-[14rem]">
              <Field label="Date of birth" type="date" value={profile.dateOfBirth} onChange={setP("dateOfBirth")} />
            </div>
            <Field label="Pilot licence number" value={profile.licenseNumber} onChange={setP("licenseNumber")} />
          </div>
          <Field label="Address" value={profile.address} onChange={setP("address")} />
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
