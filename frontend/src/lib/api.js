import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
export const http = axios.create({ baseURL: API, withCredentials: true });

export const DAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
export const DAYS_SHORT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
export const DAY_SLUGS = ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"];
export const OFFS_PER_MODE = { "6x1": 1, "5x2": 2 };

export const errMsg = (e) => e?.response?.data?.detail?.toString?.() || "Ocorreu um erro. Tente novamente.";

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
