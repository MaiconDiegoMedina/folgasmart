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

// Horário padrão do funcionário no dia — só quando a jornada tem o horário do ponto cadastrado
export const defaultShiftOf = (wl, mode, day) => {
  if (!wl?.times) return null;
  if (mode === "5x2" && wl.times_5x2) return wl.times_5x2;
  return wl.times[day] || null;
};
