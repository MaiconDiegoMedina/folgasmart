import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
export const http = axios.create({ baseURL: API });

const TOKEN_KEY = "folgasmart_access_token";
export const getAccessToken = () => sessionStorage.getItem(TOKEN_KEY);
export const clearAccessToken = () => sessionStorage.removeItem(TOKEN_KEY);

// Desbloqueio dos dias passados pela senha do administrador (só em memória, expira em 30 min)
let adminUnlock = null;
export const adminUnlockedUntil = () => (adminUnlock && adminUnlock.expiresAt > Date.now() ? adminUnlock.expiresAt : null);
const unlockChanged = () => window.dispatchEvent(new Event("folgasmart:unlock-changed"));
export const unlockAdmin = async (password) => {
  const { data } = await http.post("/admin/unlock", { password });
  adminUnlock = { token: data.token, expiresAt: data.expires_at * 1000 };
  unlockChanged();
};
export const lockAdmin = () => {
  adminUnlock = null;
  unlockChanged();
};

http.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (adminUnlockedUntil()) config.headers["X-Admin-Unlock"] = adminUnlock.token;
  return config;
});

http.interceptors.response.use((response) => response, (error) => {
  const isLoginRequest = error.config?.url?.endsWith("/auth/login");
  if (error.response?.status === 401 && !isLoginRequest && getAccessToken()) {
    clearAccessToken();
    window.dispatchEvent(new Event("folgasmart:auth-expired"));
  }
  // Dia bloqueado: pede a senha do administrador
  if (error.response?.status === 423) window.dispatchEvent(new Event("folgasmart:locked"));
  return Promise.reject(error);
});

export const login = async (password) => {
  const { data } = await axios.post(`${API}/auth/login`, { password });
  sessionStorage.setItem(TOKEN_KEY, data.access_token);
};

export const logout = async () => {
  try {
    if (getAccessToken()) await http.post("/auth/logout");
  } finally {
    clearAccessToken();
  }
};

const pad = (n) => String(n).padStart(2, "0");
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const mondayOf = (d) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
export const weekDates = (week) => Array.from({ length: 7 }, (_, i) => addDays(parseIso(week), i));
export const fmtDayMonth = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
export const fmtWeekRange = (week) => {
  const [a, b] = [parseIso(week), addDays(parseIso(week), 6)];
  const month = (d) => d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  return `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)} ${b.getFullYear()}`;
};

export const DAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
export const DAYS_SHORT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
export const DAY_SLUGS = ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"];
export const OFFS_PER_MODE = { "6x1": 1, "5x2": 2 };

export const errMsg = (e) => {
  const detail = e?.response?.data?.detail;
  if (Array.isArray(detail)) return "Dados inválidos: " + detail.map((d) => d?.msg).filter(Boolean).join("; ");
  if (detail) return String(detail);
  if (e?.response?.status >= 500) return "Erro no servidor. Verifique se as tabelas do banco foram criadas.";
  return "Ocorreu um erro. Tente novamente.";
};

export const downloadFile = (name, content, type = "text/csv;charset=utf-8") => {
  const blob = new Blob(["\ufeff" + content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

export const SAMPLE_CSV = (() => {
  const base = [120, 95, 100, 130, 210, 260, 180];
  const rows = ["data,clientes"];
  const start = new Date(2026, 3, 6);
  for (let i = 0; i < 28; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const v = base[i % 7] + Math.round((Math.sin(i) * 15));
    const p = (n) => String(n).padStart(2, "0");
    rows.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())},${v}`);
  }
  return rows.join("\n");
})();
