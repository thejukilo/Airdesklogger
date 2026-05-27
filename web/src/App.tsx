import { Navigate, Route, Routes, Link, useLocation } from "react-router-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./auth";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { Logbook } from "./pages/Logbook";
import { NewEntry } from "./pages/NewEntry";
import { EntryDetail } from "./pages/EntryDetail";
import { Account } from "./pages/Account";
import { Admin } from "./pages/Admin";
import { Sign } from "./pages/Sign";
import { Verify } from "./pages/Verify";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

function BrandMark() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
      <svg viewBox="0 0 22 22" className="h-5 w-5" fill="none" aria-hidden="true">
        <path d="M3 11L11 3L19 11L11 19L3 11Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M7 11L11 7L15 11L11 15L7 11Z" fill="currentColor" />
      </svg>
    </span>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  if (!user) return null;
  const item = "block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-brand-50 hover:text-brand-700";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1.5 pr-3 text-slate-700 shadow-sm transition hover:bg-slate-50"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <UserIcon />
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm sm:block">{user.name}</span>
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="border-b border-slate-100 px-4 py-2.5">
            <div className="truncate text-sm font-medium text-ink">{user.name}</div>
            {user.email && <div className="truncate text-xs text-slate-500">{user.email}</div>}
          </div>
          {user.roles.includes("ADMIN") && (
            <Link to="/admin" onClick={() => setOpen(false)} className={item}>Admin</Link>
          )}
          <Link to="/account" onClick={() => setOpen(false)} className={item}>Profile</Link>
          <button type="button" onClick={() => { setOpen(false); logout(); }} className={item}>Sign out</button>
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 via-slate-50 to-slate-100 text-ink">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-4 py-2.5">
          <Link to="/" className="flex items-center gap-2.5">
            <BrandMark />
            <span className="text-lg font-semibold tracking-tight text-ink">
              Airdeck<span className="font-normal text-slate-500"> Logger</span>
            </span>
          </Link>
          <UserMenu />
        </div>
      </header>
      <main className="mx-auto max-w-screen-2xl px-4 py-6">{children}</main>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      {/* Public, no account: external signers reach the signing page by token. */}
      <Route path="/sign/:token" element={<Sign />} />
      <Route path="/*" element={<AppShell />} />
    </Routes>
  );
}

function AppShell() {
  return (
    <Shell>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/forgot" element={<ForgotPassword />} />
        <Route path="/reset" element={<ResetPassword />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Logbook />
            </RequireAuth>
          }
        />
        <Route
          path="/new"
          element={
            <RequireAuth>
              <NewEntry />
            </RequireAuth>
          }
        />
        <Route
          path="/entry/:id"
          element={
            <RequireAuth>
              <EntryDetail />
            </RequireAuth>
          }
        />
        <Route
          path="/entry/:id/edit"
          element={
            <RequireAuth>
              <NewEntry />
            </RequireAuth>
          }
        />
        <Route
          path="/account"
          element={
            <RequireAuth>
              <Account />
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAuth>
              <Admin />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
