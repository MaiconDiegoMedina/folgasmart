import { modelOf } from "@/lib/scaleModels";

// Escala (6x1/5x2) de um setor numa semana.
// Semana já gerada: vale a escala usada na geração dela; se o setor não ficou registrado (gerações antigas),
// vale a escala da semana. A configuração atual dos setores só vale para semana ainda não gerada —
// assim, escolher 5x2 para a semana que vem não muda as semanas já geradas.
export const weekModeOf = (schedule, sectorModes, sector) => {
  const key = (sector || "").toLowerCase();
  const used = Object.entries(schedule?.sector_modes || {}).find(([k]) => k.toLowerCase() === key);
  if (used) return used[1];
  if (schedule?.generated_at) return schedule.mode || "6x1";
  return sectorModes?.[key] || "6x1";
};

// Dias seguidos permitidos na escala: os dias de trabalho do modelo (6 no 6x1, 5 no 5x2)
export const streakLimitOf = (mode) => modelOf(mode).work_days;
