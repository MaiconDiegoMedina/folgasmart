import { isShortWeek, dailyTargetOf } from "@/lib/scaleModels";

// Horários do ponto por jornada: cada dia é null, [entrada, saída] ou [entrada, saída int., volta int., saída]

const pad = (n) => String(n).padStart(2, "0");
export const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

// Minutos trabalhados num dia (descontando o intervalo)
export const dayMinutes = (t) => (!t ? 0 : toMin(t[t.length - 1]) - toMin(t[0]) - (t.length === 4 ? toMin(t[2]) - toMin(t[1]) : 0));

// Jornadas antigas só tinham horas por dia: monta um horário a partir das 08:00 para editar
export const legacyDay = (minutes, breakMinutes = 60, start = 480) => {
  if (!minutes) return null;
  const brk = minutes > 360 ? breakMinutes : minutes > 240 ? 15 : 0;
  const end = start + minutes + brk;
  if (end >= 24 * 60) return null;
  if (!brk) return [fromMin(start), fromMin(end)];
  const at = start + (minutes > 360 ? 240 : Math.round(minutes / 2 / 5) * 5);
  return [fromMin(start), fromMin(at), fromMin(at + brk), fromMin(end)];
};

export const timesOf = (wl) => wl?.times || (wl ? wl.minutes.map((m) => legacyDay(m, wl.break_minutes)) : Array(7).fill(null));
export const times5x2Of = (wl) => wl?.times_5x2 || (wl?.minutes_5x2 ? legacyDay(wl.minutes_5x2, wl.break_minutes) : null);

// Horário padrão do funcionário no dia, pela jornada. Usado só nos dias em que ele trabalha.
// Se a jornada não tem horário para esse dia (ex.: dia EXTRA, ou folga da escala em outro dia da semana),
// usa o horário de um dia normal dela. Jornada antiga, só com horas por dia: monta a partir das 08:00.
export const defaultShiftOf = (wl, mode, day) => {
  if (!wl) return null;
  const five = times5x2Of(wl);
  const all = timesOf(wl);
  if (isShortWeek(mode)) {
    const base = five || all[day] || all.find(Boolean) || null;
    const target = dailyTargetOf(mode);
    return target ? fitShift(base, target) : base;
  }
  return all[day] || all.find(Boolean) || five || null;
};

// Mesmo horário com a saída ajustada para fechar os minutos do dia (ex.: 42h no 5x2 = 8h24)
export const fitShift = (t, minutes) => {
  if (!t || !minutes) return t;
  const brk = t.length === 4 ? toMin(t[2]) - toMin(t[1]) : 0;
  const end = toMin(t[0]) + minutes + brk;
  if (end >= 24 * 60) return t;
  if (t.length === 4 && toMin(t[2]) >= end) return [t[0], fromMin(end)];
  return t.length === 4 ? [t[0], t[1], t[2], fromMin(end)] : [t[0], fromMin(end)];
};

// Horário inicial para quem não tem jornada: 6h trabalhadas com 15 min de intervalo (ajuste arrastando a barra)
export const STARTER_SHIFT = ["08:00", "11:00", "11:15", "14:15"];
