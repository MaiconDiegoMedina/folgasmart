import { createContext, useContext, useEffect, useState } from "react";
import { http, getAccessToken, login, logout } from "@/lib/api";

const AuthContext = createContext({ logout: async () => {} });
export const useAuth = () => useContext(AuthContext);

export function LoginGate({ children }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(Boolean(getAccessToken()));
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onExpired = () => {
      setAuthenticated(false);
      setChecking(false);
      setError("Sua sessão expirou. Entre novamente.");
    };
    window.addEventListener("folgasmart:auth-expired", onExpired);
    if (getAccessToken()) {
      http.get("/auth/me")
        .then(() => setAuthenticated(true))
        .catch(() => setAuthenticated(false))
        .finally(() => setChecking(false));
    }
    return () => window.removeEventListener("folgasmart:auth-expired", onExpired);
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(password);
      setPassword("");
      setAuthenticated(true);
    } catch (err) {
      setError(err.response?.data?.detail || "Não foi possível entrar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      await logout();
    } finally {
      setAuthenticated(false);
    }
  };

  if (checking) return <div className="min-h-screen grid place-items-center text-slate-500">Verificando acesso…</div>;

  if (!authenticated) {
    return (
      <main className="min-h-screen grid place-items-center bg-[#F9F8F5] px-4">
        <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-[#E5E1D8] bg-white p-7 shadow-sm">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-[#0F172A] text-xl text-white">F</div>
            <h1 className="text-2xl font-bold text-[#191C1E]">FolgaSmart</h1>
            <p className="mt-2 text-sm text-[#575E65]">Digite a senha de acesso para continuar.</p>
          </div>
          <label htmlFor="access-password" className="mb-2 block text-sm font-medium text-[#191C1E]">Senha</label>
          <input
            id="access-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            className="w-full rounded-lg border border-[#D1CBBF] px-3 py-2.5 outline-none focus:border-[#0F172A] focus:ring-2 focus:ring-[#0F172A]/10"
          />
          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          <button disabled={busy} className="mt-5 w-full rounded-lg bg-[#0F172A] px-4 py-2.5 font-semibold text-white hover:bg-[#1E293B] disabled:opacity-60">
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <AuthContext.Provider value={{ logout: signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
