import { Navigate, Route, Routes, Link, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./auth";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { Logbook } from "./pages/Logbook";
import { NewEntry } from "./pages/NewEntry";
import { EntryDetail } from "./pages/EntryDetail";
import { Account } from "./pages/Account";
import { Sign } from "./pages/Sign";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-slate-50 text-ink">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="font-semibold tracking-tight">
            AirdeskLogger
          </Link>
          {user && (
            <div className="flex items-center gap-4 text-sm">
              <Link to="/account" className="text-slate-600 hover:text-ink">
                {user.name}
              </Link>
              <button onClick={logout} className="text-slate-600 hover:text-ink">
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
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
          path="/account"
          element={
            <RequireAuth>
              <Account />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
