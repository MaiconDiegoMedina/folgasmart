// Leitura do relatório "170 - Movimento de Vendas por Faixa do Horário" (CISS)
// exportado em CSV ou Texto. Cada linha de dados começa com a faixa de horário
// ("8:00 à 8:59") seguida dos números:
//   com dois períodos: Valor A, Valor B, Clientes A, Clientes B, Médio A, Médio B
//   com um período:    Valor, Clientes, Médio

const TIME = /(\d{1,2}):(\d{2})/;
const STARTS_WITH_TIME = /^[\s"']*(\d{1,2}):(\d{2})/;
const DATE = /(\d{2})[-/.](\d{2})[-/.](\d{4})/;

export const parseBrNumber = (raw) => {
  let s = String(raw ?? "").trim().replace(/^["']|["']$/g, "").replace(/\s|R\$/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  return Number(s);
};

// Divide respeitando aspas ("3.093,96" dentro de um CSV separado por vírgula)
const splitBy = (line, sep) => {
  const out = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === sep && !quoted) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
};

const cellsOf = (line) => {
  for (const sep of [";", "\t", "|"]) {
    const cells = splitBy(line, sep);
    if (cells.length >= 3) return cells;
  }
  if (line.includes('"')) return splitBy(line, ",");
  // Texto (*.txt) alinhado por espaços: a vírgula ali é decimal, não separador
  const words = line.trim().split(/\s+/);
  if (words.filter((w) => parseBrNumber(w) !== null).length >= 2) return words;
  return splitBy(line, ",");
};

const toIso = (m) => `${m[3]}-${m[2]}-${m[1]}`;

export const parseHourlyReport = (text) => {
  const lines = String(text).replace(/^﻿/, "").split(/\r?\n/);
  const rowsA = [];
  const rowsB = [];
  const dates = { A: {}, B: {} };

  for (const line of lines) {
    const info = line.match(/data\s+(inicial|final)\s+da\s+(primeira|segunda)/i);
    const date = line.match(DATE);
    if (info && date) {
      const period = info[2].toLowerCase() === "primeira" ? "A" : "B";
      dates[period][info[1].toLowerCase() === "inicial" ? "start" : "end"] = toIso(date);
      continue;
    }

    const start = line.match(STARTS_WITH_TIME);
    if (!start) continue;
    const hour = Number(start[1]);
    if (hour > 23) continue;
    const n = cellsOf(line).filter((c) => !TIME.test(c)).map(parseBrNumber).filter((v) => v !== null);
    if (n.length >= 6) {
      rowsA.push({ hour, value: n[0], clients: n[2] });
      rowsB.push({ hour, value: n[1], clients: n[3] });
    } else if (n.length >= 2) {
      rowsA.push({ hour, value: n[0], clients: n[1] });
    } else if (n.length === 1) {
      rowsA.push({ hour, value: 0, clients: n[0] });
    }
  }

  const label = (key) => {
    const { start, end } = dates[key];
    const fmt = (iso) => iso.split("-").reverse().join("/");
    if (start && end && start !== end) return `Período ${key} · ${fmt(start)} a ${fmt(end)}`;
    if (start || end) return `Período ${key} · ${fmt(start || end)}`;
    return `Período ${key}`;
  };

  const periods = [];
  if (rowsA.length) periods.push({ key: "A", label: label("A"), ...dates.A, hours: rowsA });
  if (rowsB.some((r) => r.clients > 0 || r.value > 0)) periods.push({ key: "B", label: label("B"), ...dates.B, hours: rowsB });
  return periods;
};

// Dia da semana (0 = segunda) quando o período é um único dia
export const singleWeekday = (period) => {
  const iso = period.start && (!period.end || period.end === period.start) ? period.start : null;
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
};

// Horas de pico: movimento pelo menos 25% acima da média das horas com movimento
export const peakHours = (hours) => {
  const active = hours.filter((h) => h.clients > 0);
  if (!active.length) return [];
  const mean = active.reduce((s, h) => s + h.clients, 0) / active.length;
  return active.filter((h) => h.clients >= mean * 1.25).map((h) => h.hour);
};

export const toMinutes = (hhmm) => {
  const m = String(hhmm || "").match(/^(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// Funcionário conta na faixa se estiver presente por pelo menos 30 minutos dela
export const coversHour = (shift, hour) => {
  if (!shift) return false;
  const [s, e] = shift.map(toMinutes);
  if (s === null || e === null) return false;
  return Math.min(e, (hour + 1) * 60) - Math.max(s, hour * 60) >= 30;
};
