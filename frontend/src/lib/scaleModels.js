// Modelos de escala cadastrados (Configurações > Escalas). O Dashboard carrega a lista do servidor
// e grava aqui, para os cálculos (folgas, dias seguidos, horário do dia) consultarem sem passar por props.
const BUILTIN = [
  { id: "6x1", name: "6x1", work_days: 6, weekly_minutes: null, builtin: true },
  { id: "5x2", name: "5x2", work_days: 5, weekly_minutes: null, builtin: true },
  { id: "5x2-42h", name: "5x2 · 42h", work_days: 5, weekly_minutes: 42 * 60, builtin: true },
];

let models = BUILTIN;

export const setScaleModels = (list) => {
  models = Array.isArray(list) && list.length ? list : BUILTIN;
};
export const scaleModels = () => models;

// Modelo da escala; id desconhecido conta como 6x1
export const modelOf = (mode) => models.find((m) => m.id === mode) || BUILTIN.find((m) => m.id === mode) || BUILTIN[0];
export const modeLabel = (mode) => modelOf(mode)?.name || mode || "6x1";
// Folgas por semana
export const offsOf = (mode) => Math.max(0, 7 - modelOf(mode).work_days);
// Semana reduzida (5x2, 4x3...): usa o horário "No 5x2" da jornada
export const isShortWeek = (mode) => modelOf(mode).work_days < 6;
// Minutos por dia quando a escala fixa as horas da semana (ex.: 42h em 5 dias = 8h24); null = segue a jornada
export const dailyTargetOf = (mode) => {
  const m = modelOf(mode);
  return m.weekly_minutes ? Math.round(m.weekly_minutes / m.work_days) : null;
};
export const fmtHours = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
};
export const modelDesc = (m) =>
  `${m.work_days} dia${m.work_days > 1 ? "s" : ""} de trabalho e ${7 - m.work_days} folga${7 - m.work_days > 1 ? "s" : ""} por semana` +
  (m.weekly_minutes ? ` · ${fmtHours(m.weekly_minutes)} semanais (${fmtHours(Math.round(m.weekly_minutes / m.work_days))} por dia)` : "");
