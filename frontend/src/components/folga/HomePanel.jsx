import { AlertTriangle, CalendarDays, Flag, Flame, Users } from "lucide-react";
import { PageTitle } from "@/components/folga/Header";
import { DAYS, DAYS_SHORT, weekDates, isoDate, fmtDayMonth } from "@/lib/api";
import { isIntermittent, acceptedOn } from "@/lib/convocation";

const OK = "bg-[#E3F5EC] text-[#1D6B45] border-[#8FD0AE]";
const WARN = "bg-[#FFF4D1] text-[#7A5500] border-[#F2CF6B]";
const RISK = "bg-[#FDE2E2] text-[#A12828] border-[#EE9A9A]";
const NEUTRAL = "bg-white/70 text-[#1B1830] border-white";

const Kpi = ({ icon: Icon, label, value, note, tone = NEUTRAL, onClick }) => (
  <button onClick={onClick} className={`rounded-[26px] border p-5 text-left transition hover:brightness-[0.98] ${tone}`}>
    <div className="flex items-center gap-2 text-[13px] font-semibold opacity-90"><Icon className="h-4 w-4" />{label}</div>
    <p className="mt-2 font-display text-[40px] font-semibold leading-none tracking-tight">{value}</p>
    {note && <p className="mt-2 text-[13px] opacity-90">{note}</p>}
  </button>
);

// Resumo do dia: quem trabalha hoje, alertas da semana e feriados
export const HomePanel = ({ employees, schedule, movement, week, onTab }) => {
  const dates = weekDates(week);
  const todayIso = isoDate(new Date());
  const idx = dates.findIndex((d) => isoDate(d) === todayIso);
  const day = idx >= 0 ? idx : 0;
  const has = (key, id, d) => (schedule[key]?.[id] || []).includes(d);
  const closed = (schedule.closed_days || []).includes(day);
  const works = (e, d) => {
    if (closed || has("vacation_days", e.id, d) || has("sick_days", e.id, d)) return false;
    if (isIntermittent(e)) return acceptedOn(schedule, e.id, d);
    return (!has("off_days", e.id, d) || has("extra_days", e.id, d)) && !has("suspension_days", e.id, d) && !has("absence_days", e.id, d);
  };
  const active = employees.filter((e) => !isIntermittent(e) || acceptedOn(schedule, e.id, day));
  const working = employees.filter((e) => works(e, day));
  const away = employees.filter((e) => has("vacation_days", e.id, day) || has("sick_days", e.id, day));
  const ratio = active.length ? working.length / active.length : 1;
  const byId = Object.fromEntries(employees.map((e) => [e.id, e]));
  const streak = Object.entries(schedule.streak_alerts || {}).filter(([id, days]) => byId[id] && days?.length);
  const cct = Object.entries(schedule.cct_alerts || {}).filter(([id, msg]) => byId[id] && msg);
  const peaks = movement?.peak_days || [];
  const holidays = Object.entries(schedule.holidays || {}).map(([d, h]) => ({ d: Number(d), ...h }));
  const risks = streak.length;
  const warns = cct.length + (schedule.generated_at ? 0 : 1);

  return (
    <div className="space-y-6">
      <PageTitle eyebrow={`${DAYS[day]} · ${fmtDayMonth(dates[day])}${idx < 0 ? " · semana selecionada" : ""}`}>
        Bom dia, <em>vamos escalar</em>
      </PageTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Users} label="Trabalhando hoje" value={working.length} note={`${Math.round(ratio * 100)}% da equipe escalada`} tone={ratio >= 0.75 ? OK : ratio >= 0.6 ? WARN : RISK} onClick={() => onTab("escala")} />
        <Kpi icon={CalendarDays} label="Folga ou ausência" value={active.length - working.length} note={away.length ? `${away.length} de férias ou atestado` : "ninguém de férias hoje"} onClick={() => onTab("escala")} />
        <Kpi icon={AlertTriangle} label="Precisa de atenção" value={risks + warns} note={`${risks} risco · ${warns} atenção`} tone={risks ? RISK : warns ? WARN : OK} onClick={() => onTab("escala")} />
        <Kpi icon={Flame} label="Dias de pico" value={peaks.length || "—"} note={peaks.length ? peaks.map((d) => DAYS_SHORT[d]).join(", ") : "cadastre o movimento"} tone={peaks.includes(day) ? WARN : NEUTRAL} onClick={() => onTab("movimento")} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <section className="glass rounded-[26px] p-5 sm:p-6 lg:col-span-3">
          <h2 className="mb-4 text-base font-bold">Alertas da semana</h2>
          {!schedule.generated_at && <p className={`mb-2 rounded-2xl border px-4 py-3 text-sm ${WARN}`}><b>Atenção:</b> a escala desta semana ainda não foi gerada.</p>}
          {streak.map(([id, days]) => (
            <p key={id} className={`mb-2 rounded-2xl border px-4 py-3 text-sm ${RISK}`}>
              <b>Risco · +6 dias:</b> {byId[id].name} passa de 6 dias seguidos sem folga em {days.map((d) => `${DAYS_SHORT[d]} ${fmtDayMonth(dates[d])}`).join(", ")}.
            </p>
          ))}
          {cct.map(([id, msg]) => (
            <p key={id} className={`mb-2 rounded-2xl border px-4 py-3 text-sm ${WARN}`}><b>Atenção · CCT:</b> {byId[id].name} — {msg}</p>
          ))}
          {schedule.generated_at && !streak.length && !cct.length && <p className={`rounded-2xl border px-4 py-3 text-sm ${OK}`}>Tudo certo: nenhum alerta nesta semana.</p>}
        </section>
        <section className="glass rounded-[26px] p-5 sm:p-6 lg:col-span-2">
          <h2 className="mb-4 flex items-center gap-2 text-base font-bold"><Flag className="h-4 w-4" />Feriados da semana</h2>
          {holidays.length === 0 && <p className="text-sm text-[#5E5880]">Nenhum feriado nesta semana.</p>}
          {holidays.map((h) => (
            <div key={h.d} className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm"><b>{DAYS_SHORT[h.d]} {fmtDayMonth(dates[h.d])}</b> · {h.name}</span>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${h.closed ? OK : WARN}`}>{h.closed ? "Ok · loja fechada" : "Atenção · custo 2×"}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
};
