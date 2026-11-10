import { useState } from "react";
import { Flame, AlertTriangle, Users, CalendarDays } from "lucide-react";
import { DAYS_SHORT, OFFS_PER_MODE, weekDates, fmtDayMonth, isoDate } from "@/lib/api";
import { WeekNav } from "@/components/folga/WeekNav";
import { PeakHoursPanel } from "@/components/folga/PeakHoursPanel";

const Cell = ({ off, susp, peak, status, selected, onClick, testId }) => {
  if (status === "ferias") {
    return (
      <div
        data-testid={testId}
        className="w-full h-11 flex items-center justify-center rounded-lg text-[10px] font-extrabold tracking-wider bg-[#F1F5F9] border border-[#CBD5E1] text-[#64748B] font-mono-data select-none cursor-not-allowed"
        title="Funcionário em período de férias"
      >
        FÉRIAS
      </div>
    );
  }

  let texto = "TRAB.";
  let classesEstilo = "bg-[#F0FDF4] border-[#BBF7D0] text-[#15803D] hover:bg-[#DCFCE7]"; // Trabalhando

  if (susp) {
    texto = "SUSP.";
    classesEstilo = "bg-[#FFF1F2] border-[#FECDD3] text-[#E11D48] hover:bg-[#FFE4E6]"; // Suspensão
  } else if (off) {
    texto = "FOLGA";
    classesEstilo = peak
      ? "bg-[#FEF2F2] border-[#DC2626] text-[#DC2626]" // Folga em dia de pico
      : "bg-[#FFFBEB] border-[#FCD34D] text-[#B45309] hover:bg-[#FEF3C7]"; // Folga comum
  }

  // Selecionada (shift + click): preenche a célula de preto.
  // Fica por último para sobrescrever as demais cores.
  if (selected) {
    classesEstilo = "bg-[#0F172A] border-[#0F172A] text-white hover:bg-[#1E293B]";
  }

  return (
    <button
      data-testid={testId}
      onClick={onClick}
      // Evita que o shift + click selecione texto da tabela
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      aria-pressed={selected}
      className={`w-full h-11 rounded-lg text-[11px] font-bold tracking-wider font-mono-data border transition-colors duration-200 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#0F172A] ${classesEstilo}`}
    >
      {texto}
    </button>
  );
};

const Row = ({ emp, offs, suspensions, peaks, required, onToggle, selected, onSelect, idx }) => {
  const wrong = emp.status !== "ferias" && offs.length !== required;

  return (
    <tr data-testid="employee-row" className="rise border-t border-[#EFEBE3]" style={{ animationDelay: `${idx * 30}ms` }}>
      <td className="py-2 pr-4 sticky left-0 bg-white z-10 min-w-[110px] md:min-w-[200px]">
        <p className="font-semibold text-sm leading-tight flex items-center gap-1.5">
          {emp.name}
          {emp.status === "ferias" && <span className="text-[9px] bg-[#E2E8F0] text-[#475569] font-bold px-1.5 py-0.5 rounded">FÉRIAS</span>}
          {emp.status === "suspensao" && <span className="text-[9px] bg-[#FFE4E6] text-[#E11D48] font-bold px-1.5 py-0.5 rounded">SUSP.</span>}
        </p>
        <p className="text-xs text-[#8A929B]">{emp.role} · {emp.sector}</p>
      </td>
      {DAYS_SHORT.map((_, d) => (
        <td key={d} className="p-1 min-w-[72px]">
          <Cell
            off={offs.includes(d)}
            susp={suspensions.includes(d)}
            peak={peaks.includes(d)}
            status={emp.status}
            selected={selected.has(`${emp.id}-${d}`)}
            // Shift + click seleciona (preto). Clique normal alterna a folga.
            onClick={(e) => (e.shiftKey ? onSelect(emp.id, d) : onToggle(emp.id, d))}
            testId={`cell-${emp.id}-${d}`}
          />
        </td>
      ))}
      <td className="pl-3 text-center">
        <span data-testid={`row-summary-${emp.id}`} className={`inline-flex items-center gap-1 text-xs font-mono-data font-semibold ${wrong ? "text-[#DC2626]" : "text-[#575E65]"}`}>
          {wrong && <AlertTriangle className="h-3.5 w-3.5" />}
          {emp.status === "ferias" ? "7/7" : `${offs.length}/${required}`}
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

const DayTabs = ({ dates, peaks, value, onChange }) => (
  <div data-testid="day-tabs" className="no-print flex flex-wrap items-center gap-1.5 px-5 sm:px-6 pt-3">
    <button
      onClick={() => onChange(null)}
      className={`px-3 py-1 rounded-md text-xs font-semibold border transition-colors duration-200 inline-flex items-center gap-1 ${
        value === null ? "bg-[#F2EFE8] border-[#191C1E] text-[#191C1E]" : "bg-white border-[#E5E1D8] text-[#575E65] hover:border-[#191C1E]"
      }`}
    >
      <CalendarDays className="h-3.5 w-3.5" /> Semana
    </button>
    <span className="text-[11px] text-[#8A929B] mx-1">Horários do dia:</span>
    {DAYS_SHORT.map((d, i) => (
      <button
        key={d}
        data-testid={`day-tab-${i}`}
        onClick={() => onChange(i)}
        className={`px-3 py-1 rounded-md text-xs font-semibold border transition-colors duration-200 inline-flex items-center gap-1 ${
          value === i ? "bg-[#F2EFE8] border-[#191C1E] text-[#191C1E]" : "bg-white border-[#E5E1D8] text-[#575E65] hover:border-[#191C1E]"
        }`}
      >
        {peaks.includes(i) && <Flame className="h-3 w-3 text-[#DC2626]" />}
        {d} <span className="font-mono-data text-[10px] opacity-70">{fmtDayMonth(dates[i])}</span>
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
  const [selected, setSelected] = useState(() => new Set());
  const [dayView, setDayView] = useState(null);
  const peaks = movement?.peak_days || [];
  const required = OFFS_PER_MODE[schedule.mode];
  const offsOf = (id) => schedule.off_days?.[id] || [];
  const suspensionsOf = (id) => schedule.suspension_days?.[id] || [];
  const sectors = [...new Set(employees.map((e) => e.sector))].sort((a, b) => a.localeCompare(b));
  const activeSector = sectors.includes(sector) ? sector : "all";
  const activeDay = activeSector === "all" ? null : dayView;
  const visible = activeSector === "all" ? employees : employees.filter((e) => e.sector === activeSector);
  const groups = sectors.filter((s) => activeSector === "all" || s === activeSector).map((s) => ({ name: s, members: visible.filter((e) => e.sector === s) }));
  const coverage = DAYS_SHORT.map((_, d) => visible.filter((e) => !offsOf(e.id).includes(d)).length);

  // Alterna a seleção (preto) de uma célula
  const onSelect = (id, d) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const key = `${id}-${d}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Ao trocar de semana, limpa a seleção
  const handleWeekChange = (w) => {
    setSelected(new Set());
    onWeekChange(w);
  };

  return (
    <section data-testid="weekly-calendar-grid" className="print-area rounded-2xl border border-[#E5E1D8] bg-white shadow-[0_1px_0_#E5E1D8,0_12px_32px_-16px_rgba(15,23,42,0.12)]">
      <div className="flex flex-wrap items-end justify-between gap-4 p-5 sm:p-6 border-b border-[#EFEBE3]">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8A929B]">Escala semanal · {schedule.mode}</p>
          <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight mt-1">Quem trabalha, quem folga.</h2>
          <div className="mt-4"><WeekNav week={week} onChange={handleWeekChange} /></div>
          {!schedule.generated_at && employees.length > 0 && (
            <p data-testid="week-not-generated" className="no-print text-xs text-[#B45309] mt-3">Escala desta semana ainda não gerada — clique em <b>Gerar escala</b>.</p>
          )}
        </div>
        <div className="flex gap-4 text-xs text-[#575E65] no-print">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#DCFCE7] border border-[#BBF7D0]" />Trabalha</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#FEF3C7] border border-[#FCD34D]" />Folga</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#FEF2F2] border border-[#DC2626]" />Folga em pico</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#FFE4E6] border border-[#FECDD3]" />Suspensão</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#F1F5F9] border border-[#CBD5E1]" />Férias</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#0F172A] border border-[#0F172A]" />Selecionada (shift + clique)</span>
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
          {activeSector === "all" ? (
            <p className="no-print px-5 sm:px-6 pt-2 text-[11px] text-[#8A929B]">Selecione um setor para escalar os horários de pico de cada dia.</p>
          ) : (
            <DayTabs dates={dates} peaks={peaks} value={activeDay} onChange={setDayView} />
          )}
          {activeDay !== null ? (
            <PeakHoursPanel day={activeDay} date={dates[activeDay]} sector={activeSector} members={visible} schedule={schedule} week={week} />
          ) : (
          <div className="overflow-x-auto p-3 sm:p-5">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="text-left text-xs font-semibold text-[#8A929B] uppercase tracking-wider pb-3 sticky left-0 bg-white z-10">Funcionário</th>
                  {DAYS_SHORT.map((d, i) => (
                    <th
                      key={d}
                      data-testid="calendar-header-day"
                      onClick={activeSector !== "all" ? () => setDayView(i) : undefined}
                      title={activeSector !== "all" ? "Ver horários de pico deste dia" : undefined}
                      className={`pb-3 px-1 ${activeSector !== "all" ? "cursor-pointer" : ""}`}
                    >
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
                    <Row
                      key={emp.id}
                      idx={idx}
                      emp={emp}
                      offs={offsOf(emp.id)}
                      suspensions={suspensionsOf(emp.id)}
                      peaks={peaks}
                      required={required}
                      onToggle={onToggle}
                      selected={selected}
                      onSelect={onSelect}
                    />
                  )),
                ])}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#191C1E]">
                  <td className="pt-4 text-xs font-bold uppercase tracking-wider sticky left-0 bg-white">
                    Em operação{activeSector !== "all" && <span className="block text-[10px] text-[#8A929B] normal-case tracking-normal">{activeSector}</span>}
                  </td>
                  {coverage.map((c, d) => (
                    <td key={d} className="pt-4 text-center font-mono-data text-xs font-bold text-[#191C1E]">
                      {c}/{visible.length}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          )}
        </>
      )}
    </section>
  );
};
