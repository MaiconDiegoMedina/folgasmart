import { useState } from "react";
import { Flame, AlertTriangle, Users } from "lucide-react";
import { DAYS_SHORT, OFFS_PER_MODE, weekDates, fmtDayMonth, isoDate } from "@/lib/api";
import { WeekNav } from "@/components/folga/WeekNav";

const Cell = ({ off, peak, onClick, testId }) => (
  <button
    data-testid={testId}
    onClick={onClick}
    title="Clique para alternar"
    className={`w-full h-11 rounded-lg text-[11px] font-bold tracking-wider font-mono-data border transition-colors duration-200 ${
      off
        ? peak
          ? "bg-[#FEF2F2] border-[#DC2626] text-[#DC2626]"
          : "bg-[#FFFBEB] border-[#FCD34D] text-[#B45309] hover:bg-[#FEF3C7]"
        : "bg-[#F0FDF4] border-[#BBF7D0] text-[#15803D] hover:bg-[#DCFCE7]"
    }`}
  >
    {off ? "FOLGA" : "TRAB."}
  </button>
);

const Row = ({ emp, offs, peaks, required, onToggle, idx }) => {
  const wrong = offs.length !== required;
  return (
    <tr data-testid="employee-row" className="rise border-t border-[#EFEBE3]" style={{ animationDelay: `${idx * 30}ms` }}>
      <td className="py-2 pr-4 sticky left-0 bg-white z-10 min-w-[110px] md:min-w-[200px]">
        <p className="font-semibold text-sm leading-tight">{emp.name}</p>
        <p className="text-xs text-[#8A929B]">{emp.role} · {emp.sector}</p>
      </td>
      {DAYS_SHORT.map((_, d) => (
        <td key={d} className="p-1 min-w-[72px]">
          <Cell off={offs.includes(d)} peak={peaks.includes(d)} onClick={() => onToggle(emp.id, d)} testId={`cell-${emp.id}-${d}`} />
        </td>
      ))}
      <td className="pl-3 text-center">
        <span data-testid={`row-summary-${emp.id}`} className={`inline-flex items-center gap-1 text-xs font-mono-data font-semibold ${wrong ? "text-[#DC2626]" : "text-[#575E65]"}`}>
          {wrong && <AlertTriangle className="h-3.5 w-3.5" />}{offs.length}/{required}
        </span>
      </td>
    </tr>
  );
};

const SectorTabs = ({ sectors, value, onChange }) => (
  <div data-testid="sector-tabs" className="no-print flex flex-wrap gap-2 px-5 sm:px-6 pt-4">
    {["all", ...sectors].map((s) => (
      <button
        key={s}
        data-testid={`sector-tab-${s === "all" ? "todos" : s}`}
        onClick={() => onChange(s)}
        className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors duration-200 ${
          value === s ? "bg-[#0F172A] border-[#0F172A] text-white" : "bg-white border-[#E5E1D8] text-[#575E65] hover:border-[#0F172A] hover:text-[#191C1E]"
        }`}
      >
        {s === "all" ? "Todos os setores" : s}
      </button>
    ))}
  </div>
);

const SectorHeader = ({ name, members, offsOf, peaks }) => (
  <tr data-testid={`sector-group-${name}`}>
    <td className="pt-5 pb-2 sticky left-0 bg-white z-10">
      <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#0F172A]">{name}</span>
      <span className="ml-2 text-[11px] text-[#8A929B]">{members.length} pessoa(s)</span>
    </td>
    {DAYS_SHORT.map((_, d) => {
      const c = members.filter((e) => !offsOf(e.id).includes(d)).length;
      return (
        <td key={d} className="pt-5 pb-2 text-center">
          <span data-testid={`sector-coverage-${name}-${d}`} className={`font-mono-data text-[11px] font-semibold ${peaks.includes(d) && c < members.length ? "text-[#DC2626]" : "text-[#8A929B]"}`}>
            {c}/{members.length}
          </span>
        </td>
      );
    })}
    <td />
  </tr>
);

export const ScheduleGrid = ({ employees, movement, schedule, week, onWeekChange, onToggle }) => {
  const dates = weekDates(week);
  const today = isoDate(new Date());
  const [sector, setSector] = useState("all");
  const peaks = movement?.peak_days || [];
  const required = OFFS_PER_MODE[schedule.mode];
  const offsOf = (id) => schedule.off_days[id] || [];
  const sectors = [...new Set(employees.map((e) => e.sector))].sort((a, b) => a.localeCompare(b));
  const activeSector = sectors.includes(sector) ? sector : "all";
  const visible = activeSector === "all" ? employees : employees.filter((e) => e.sector === activeSector);
  const groups = sectors.filter((s) => activeSector === "all" || s === activeSector).map((s) => ({ name: s, members: visible.filter((e) => e.sector === s) }));
  const coverage = DAYS_SHORT.map((_, d) => visible.filter((e) => !offsOf(e.id).includes(d)).length);

  return (
    <section data-testid="weekly-calendar-grid" className="print-area rounded-2xl border border-[#E5E1D8] bg-white shadow-[0_1px_0_#E5E1D8,0_12px_32px_-16px_rgba(15,23,42,0.12)]">
      <div className="flex flex-wrap items-end justify-between gap-4 p-5 sm:p-6 border-b border-[#EFEBE3]">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8A929B]">Escala semanal · {schedule.mode}</p>
          <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight mt-1">Quem trabalha, quem folga.</h2>
          <div className="mt-4"><WeekNav week={week} onChange={onWeekChange} /></div>
          {!schedule.generated_at && employees.length > 0 && (
            <p data-testid="week-not-generated" className="no-print text-xs text-[#B45309] mt-3">Escala desta semana ainda não gerada — clique em <b>Gerar escala</b>.</p>
          )}
        </div>
        <div className="flex gap-4 text-xs text-[#575E65] no-print">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#DCFCE7] border border-[#BBF7D0]" />Trabalha</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#FEF3C7] border border-[#FCD34D]" />Folga</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#FEF2F2] border border-[#DC2626]" />Folga em pico</span>
        </div>
      </div>
      {employees.length === 0 ? (
        <div data-testid="schedule-empty" className="p-12 text-center text-[#575E65]">
          <Users className="h-8 w-8 mx-auto mb-3 text-[#8A929B]" />
          Cadastre funcionários abaixo e clique em <b>Gerar escala</b>.
        </div>
      ) : (
        <>
        <SectorTabs sectors={sectors} value={activeSector} onChange={setSector} />
        <div className="overflow-x-auto p-3 sm:p-5">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="text-left text-xs font-semibold text-[#8A929B] uppercase tracking-wider pb-3 sticky left-0 bg-white z-10">Funcionário</th>
                {DAYS_SHORT.map((d, i) => (
                  <th key={d} data-testid="calendar-header-day" className="pb-3 px-1">
                    <div className={`rounded-lg py-1.5 text-xs font-bold uppercase tracking-wider ${peaks.includes(i) ? "bg-[#DC2626] text-white" : "text-[#575E65]"} ${isoDate(dates[i]) === today ? "ring-2 ring-offset-2 ring-[#0F172A]" : ""}`}>
                      <span className="inline-flex items-center gap-1">{peaks.includes(i) && <Flame className="h-3 w-3" />}{d}</span>
                      <span data-testid={`header-date-${i}`} className="block font-mono-data text-[10px] font-medium opacity-80 normal-case">{fmtDayMonth(dates[i])}</span>
                    </div>
                  </th>
                ))}
                <th className="pb-3 text-xs font-semibold text-[#8A929B] uppercase tracking-wider">Folgas</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => [
                <SectorHeader key={`h-${g.name}`} name={g.name} members={g.members} offsOf={offsOf} peaks={peaks} />,
                ...g.members.map((emp, idx) => (
                  <Row key={emp.id} idx={idx} emp={emp} offs={offsOf(emp.id)} peaks={peaks} required={required} onToggle={onToggle} />
                )),
              ])}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#191C1E]">
                <td className="pt-4 text-xs font-bold uppercase tracking-wider sticky left-0 bg-white">
                  Em operação{activeSector !== "all" && <span className="block text-[10px] text-[#8A929B] normal-case tracking-normal">{activeSector}</span>}
                </td>
                {coverage.map((c, d) => (
                  <td key={d} className="pt-4 text-center" data-testid={`coverage-count-footer-${d}`}>
                    <span className={`font-mono-data text-lg font-bold ${peaks.includes(d) && c < visible.length ? "text-[#DC2626]" : "text-[#191C1E]"}`}>{c}</span>
                    <span className="text-xs text-[#8A929B]">/{visible.length}</span>
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      )}
    </section>
  );
};
