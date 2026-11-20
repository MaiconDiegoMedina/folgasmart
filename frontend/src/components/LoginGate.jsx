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
      <main
        // Capa: versão em pé no celular e deitada a partir do tablet (a marca fica no canto inferior direito)
        className="login-bg min-h-screen grid place-items-center bg-[#17142E] bg-cover bg-right-bottom px-4"
        style={{ "--bg-mobile": `url(${process.env.PUBLIC_URL}/login-bg-mobile.jpg)`, "--bg-wide": `url(${process.env.PUBLIC_URL}/login-bg.jpg)` }}
      >
        <form onSubmit={submit} className="w-full max-w-sm glass rounded-[26px] p-7 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]">
          <div className="mb-6 text-center">
            <img src={`${process.env.PUBLIC_URL}/logo-96.png`} alt="" width="48" height="48" className="mx-auto mb-3 h-12 w-12 rounded-xl" />
            <h1 className="text-2xl font-bold text-[#1B1830]">Unit Escala</h1>
            <p className="mt-2 text-sm text-[#5E5880]">Digite a senha de acesso para continuar.</p>
          </div>
          <label htmlFor="access-password" className="mb-2 block text-sm font-medium text-[#1B1830]">Senha</label>
          <input
            id="access-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            className="w-full rounded-lg border border-[#D6D0EE] px-3 py-2.5 outline-none focus:border-[#17142E] focus:ring-2 focus:ring-[#17142E]/10"
          />
          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          <button disabled={busy} className="mt-5 w-full rounded-lg bg-[#17142E] px-4 py-2.5 font-semibold text-white hover:bg-[#2A2550] disabled:opacity-60">
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
