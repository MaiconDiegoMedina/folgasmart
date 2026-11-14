import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Flame, AlertTriangle, Users, CalendarDays } from "lucide-react";
import { DAYS_SHORT, OFFS_PER_MODE, weekDates, fmtDayMonth, isoDate, http } from "@/lib/api";
import { defaultShiftOf } from "@/lib/workloadTimes";
import { WeekNav } from "@/components/folga/WeekNav";
import { PeakHoursPanel } from "@/components/folga/PeakHoursPanel";
import { isIntermittent, convocationOf, acceptedOn, shortNotice, CONVOCATION_LABEL, MIN_NOTICE_DAYS } from "@/lib/convocation";

// Célula do intermitente: — -> CONVOCADO -> ACEITO -> RECUSOU -> —
const CONVOCATION_STYLE = {
  none: "bg-white border-dashed border-[#D1CBBF] text-[#B8B2A7] hover:border-[#0EA5E9] hover:text-[#0369A1]",
  pending: "bg-[#F0F9FF] border-[#7DD3FC] text-[#0369A1] hover:bg-[#E0F2FE]",
  accepted: "bg-[#F0FDF4] border-[#BBF7D0] text-[#15803D] hover:bg-[#DCFCE7]",
  declined: "bg-[#F8FAFC] border-[#E2E8F0] text-[#94A3B8] line-through hover:bg-[#F1F5F9]",
};
const CONVOCATION_NEXT = { none: "convocar", pending: "marcar aceite", accepted: "marcar recusa", declined: "limpar" };

const ConvocationCell = ({ conv, date, vacation, shift, onClick, testId }) => {
  if (vacation) return <Cell status="ferias" testId={testId} />;
  const state = conv?.status || "none";
  const late = shortNotice(conv, date);
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      title={`${state === "none" ? "Não convocado" : CONVOCATION_LABEL[state]}${conv?.at ? ` em ${conv.at.split("-").reverse().join("/")}` : ""} · clique: ${CONVOCATION_NEXT[state]}${
        late ? ` · convocação com menos de ${MIN_NOTICE_DAYS} dias de antecedência` : ""
      }`}
      className={`w-full h-11 rounded-lg text-[10px] font-bold tracking-wider font-mono-data border transition-colors duration-200 select-none focus:outline-none ${CONVOCATION_STYLE[state]} ${late ? "ring-2 ring-[#F59E0B] ring-offset-1" : ""}`}
    >
      {state === "none" ? "—" : state === "accepted" ? (shift ? <ShiftText shift={shift} /> : "TRAB.") : CONVOCATION_LABEL[state]}
    </button>
  );
};

// Horário do dia: entrada–saída e, embaixo, o intervalo
const ShiftText = ({ shift }) => (
  <span className="flex flex-col items-center leading-tight">
    <span className="text-[11px] tracking-normal">{shift[0]}–{shift[shift.length - 1]}</span>
    {shift.length === 4 && <span className="text-[9px] font-medium tracking-normal opacity-70">int. {shift[1]}–{shift[2]}</span>}
  </span>
);

const Cell = ({ off, susp, absent, extra, peak, status, cct, shift, onClick, testId }) => {
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

  let texto = shift ? <ShiftText shift={shift} /> : "TRAB.";
  let classesEstilo = "bg-[#F0FDF4] border-[#BBF7D0] text-[#15803D] hover:bg-[#DCFCE7]"; // Trabalhando

  if (extra) {
    texto = "FOLGA"; // A cor lilás indica que é EXTRA
    classesEstilo = "bg-[#F5F3FF] border-[#C4B5FD] text-[#6D28D9] hover:bg-[#EDE9FE]"; // Trabalha na folga
  } else if (absent) {
    texto = "FALTA";
    classesEstilo = "bg-[#FFF7ED] border-[#FDBA74] text-[#C2410C] hover:bg-[#FFEDD5]"; // Falta
  } else if (susp) {
    texto = "SUSP.";
    classesEstilo = "bg-[#FFF1F2] border-[#FECDD3] text-[#E11D48] hover:bg-[#FFE4E6]"; // Suspensão
  } else if (off) {
    texto = "FOLGA";
    classesEstilo = peak
      ? "bg-[#FEF2F2] border-[#DC2626] text-[#DC2626]" // Folga em dia de pico
      : "bg-[#FFFBEB] border-[#FCD34D] text-[#B45309] hover:bg-[#FEF3C7]"; // Folga comum
  }

  return (
    <button
      data-testid={testId}
      onClick={onClick}
      // Evita que o shift + click selecione texto da tabela
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      title={
        cct ||
        (extra
          ? "Extra: trabalha no dia de folga (clique para voltar a folga)"
          : absent
            ? "Falta · clique: volta a trabalhar"
            : susp
              ? "Suspensão · clique: falta"
              : off
                ? "Folga · clique: suspensão · shift + clique: EXTRA"
                : "Trabalha · clique: folga")
      }
      className={`w-full h-11 rounded-lg text-[11px] font-bold tracking-wider font-mono-data border transition-colors duration-200 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#0F172A] ${classesEstilo} ${cct ? "ring-2 ring-[#DC2626] ring-offset-1" : ""}`}
    >
      {texto}
    </button>
  );
};

const Row = ({ emp, offs, suspensions, absences, vacationDays = [], extras, peaks, required, onToggle, onExtra, cctAlert, streakDays, idx, schedule, dates, shiftOn }) => {
  const intermittent = isIntermittent(emp);
  // EXTRA é computado como folga. Folga a mais pode ocorrer pelas regras de domingo/6 dias.
  const realOffs = offs;
  // Semana com férias: os dias de férias contam como descanso, sem alerta de folga
  const onVacation = emp.status === "ferias" || vacationDays.length > 0;
  const wrong = !onVacation && realOffs.length < required;

  return (
    <tr data-testid="employee-row" className="rise border-t border-[#EFEBE3]" style={{ animationDelay: `${idx * 30}ms` }}>
      <td className="py-2 pr-4 sticky left-0 bg-white z-10 min-w-[110px] md:min-w-[200px]">
        <p className="font-semibold text-sm leading-tight flex items-center gap-1.5">
          {emp.name}
          {emp.status === "ferias" && <span className="text-[9px] bg-[#E2E8F0] text-[#475569] font-bold px-1.5 py-0.5 rounded">FÉRIAS</span>}
          {emp.status === "suspensao" && <span className="text-[9px] bg-[#FFE4E6] text-[#E11D48] font-bold px-1.5 py-0.5 rounded">SUSP.</span>}
          {emp.status === "falta" && <span className="text-[9px] bg-[#FFEDD5] text-[#C2410C] font-bold px-1.5 py-0.5 rounded">FALTA</span>}
          {intermittent && <span className="text-[9px] bg-[#E0F2FE] text-[#0369A1] font-bold px-1.5 py-0.5 rounded">INTERMITENTE</span>}
          {cctAlert && (
            <span data-testid={`cct-alert-${emp.id}`} title={cctAlert} className="inline-flex items-center gap-0.5 text-[9px] bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] font-bold px-1.5 py-0.5 rounded">
              <AlertTriangle className="h-2.5 w-2.5" /> CCT
            </span>
          )}
        </p>
        {cctAlert && <p className="text-[10px] text-[#DC2626] leading-tight mt-0.5 max-w-[220px]">{cctAlert.replace("CCT: ", "")}</p>}
        {streakDays?.length > 0 && (
          <p data-testid={`streak-alert-${emp.id}`} className="text-[10px] text-[#DC2626] leading-tight mt-0.5 max-w-[220px] flex items-center gap-1">
            <AlertTriangle className="h-2.5 w-2.5 shrink-0" /> Mais de 6 dias seguidos sem folga
          </p>
        )}
        <p className="text-xs text-[#8A929B]">{emp.role} · {emp.sector}</p>
      </td>
      {DAYS_SHORT.map((_, d) => (
        <td key={d} className="p-1 min-w-[72px]">
          {intermittent ? (
            <ConvocationCell
              conv={convocationOf(schedule, emp.id, d)}
              date={dates[d]}
              vacation={vacationDays.includes(d)}
              shift={shiftOn(d)}
              onClick={() => onToggle(emp.id, d)}
              testId={`cell-${emp.id}-${d}`}
            />
          ) : (
          <Cell
            off={offs.includes(d)}
            susp={suspensions.includes(d)}
            absent={absences.includes(d)}
            extra={extras.includes(d)}
            cct={streakDays?.includes(d) ? "Mais de 6 dias seguidos sem folga (máximo 6)" : d === 6 ? cctAlert : undefined}
            peak={peaks.includes(d)}
            shift={shiftOn(d)}
            status={vacationDays.includes(d) ? "ferias" : emp.status}
            // Clique: TRAB. -> FOLGA -> SUSP. -> FALTA -> TRAB. Shift + clique numa folga marca EXTRA.
            onClick={(e) => (e.shiftKey ? onExtra(emp, d, offs.includes(d)) : onToggle(emp.id, d))}
            testId={`cell-${emp.id}-${d}`}
          />
          )}
        </td>
      ))}
      <td className="pl-3 text-center">
        {intermittent ? (
          <span data-testid={`row-summary-${emp.id}`} className="text-xs font-mono-data font-semibold text-[#0369A1]" title="Dias com convocação aceita">
            {DAYS_SHORT.filter((_, d) => acceptedOn(schedule, emp.id, d)).length} dia(s)
          </span>
        ) : (
        <span data-testid={`row-summary-${emp.id}`} className={`inline-flex items-center gap-1 text-xs font-mono-data font-semibold ${wrong ? "text-[#DC2626]" : "text-[#575E65]"}`}>
          {wrong && <AlertTriangle className="h-3.5 w-3.5" />}
          {emp.status === "ferias" || vacationDays.length === 7 ? "Férias" : `${realOffs.length}/${required}`}
        </span>
        )}
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

const SectorModeToggle = ({ sector, mode, onChange }) => (
  <div className="inline-flex items-center gap-1.5">
    <span className="text-[11px] text-[#8A929B]">Escala do setor:</span>
    <div data-testid="sector-mode-toggle" className="inline-flex rounded-md border border-[#E5E1D8] bg-white p-0.5">
      {["6x1", "5x2"].map((m) => (
        <button
          key={m}
          onClick={() => m !== mode && onChange(sector, m)}
          className={`px-2.5 py-0.5 rounded text-xs font-semibold font-mono-data transition-colors ${m === mode ? "bg-[#0F172A] text-white" : "text-[#575E65] hover:bg-[#F2EFE8]"}`}
        >
          {m}
        </button>
      ))}
    </div>
  </div>
);

const SectorHeader = ({ name, members, worksOn, peaks, mode, showCount }) => (
  <tr data-testid={`sector-group-${name}`}>
    <td className="pt-5 pb-2 sticky left-0 bg-white z-10">
      <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#0F172A]">{name}</span>
      <span className="ml-2 text-[11px] text-[#8A929B]">{members.length} pessoa(s) · {mode}</span>
    </td>
    {DAYS_SHORT.map((_, d) => {
      if (!showCount) return <td key={d} />;
      const c = members.filter((e) => worksOn(e.id, d)).length;
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

export const ScheduleGrid = ({ employees, movement, schedule, week, onWeekChange, onToggle, sectorModes = {}, onSectorMode, workloads = [], sector: sectorProp, onSectorChange }) => {
  const dates = weekDates(week);
  const today = isoDate(new Date());
  const [sectorLocal, setSectorLocal] = useState("all");
  const sector = sectorProp ?? sectorLocal;
  const setSector = onSectorChange ?? setSectorLocal;
  const [dayView, setDayView] = useState(null);
  const peaks = movement?.peak_days || [];
  // Escala de cada setor: a usada na geração desta semana; se não gerada, a configuração atual
  const modeOf = (sectorName) => {
    const used = Object.entries(schedule.sector_modes || {}).find(([k]) => k.toLowerCase() === sectorName.toLowerCase());
    return used?.[1] || sectorModes[sectorName.toLowerCase()] || "6x1";
  };
  const configuredMode = (sectorName) => sectorModes[sectorName.toLowerCase()] || "6x1";
  const offsOf = (id) => schedule.off_days?.[id] || [];
  const suspensionsOf = (id) => schedule.suspension_days?.[id] || [];
  const absencesOf = (id) => schedule.absence_days?.[id] || [];
  const vacationOf = (id) => schedule.vacation_days?.[id] || [];
  const extrasOf = (id) => schedule.extra_days?.[id] || [];
  // EXTRA conta como dia trabalhado mesmo sendo folga
  // Suspensão e falta não contam como em operação
  const byId = Object.fromEntries(employees.map((e) => [e.id, e]));
  const worksOn = (id, d) =>
    isIntermittent(byId[id]) ? acceptedOn(schedule, id, d) && !vacationOf(id).includes(d) :
    (!offsOf(id).includes(d) || extrasOf(id).includes(d)) && !suspensionsOf(id).includes(d) && !absencesOf(id).includes(d) && !vacationOf(id).includes(d);
  const sectors = [...new Set(employees.map((e) => e.sector))].sort((a, b) => a.localeCompare(b));
  const activeSector = sectors.includes(sector) ? sector : "all";
  const activeDay = activeSector === "all" ? null : dayView;
  const visible = activeSector === "all" ? employees : employees.filter((e) => e.sector === activeSector);
  const groups = sectors.filter((s) => activeSector === "all" || s === activeSector).map((s) => ({ name: s, members: visible.filter((e) => e.sector === s) }));
  const coverage = DAYS_SHORT.map((_, d) => visible.filter((e) => worksOn(e.id, d)).length);

  const [weekShifts, setWeekShifts] = useState({});
  useEffect(() => {
    if (activeDay !== null) return; // recarrega ao voltar da sub-aba, onde os turnos podem ter mudado
    http.get("/shifts/week", { params: { week } }).then(({ data }) => setWeekShifts(data)).catch(() => setWeekShifts({}));
  }, [week, activeDay]);
  const shiftOf = (emp, d) =>
    weekShifts[String(d)]?.[emp.id] ||
    (isIntermittent(emp) ? null : defaultShiftOf(workloads.find((w) => w.id === emp.workload), modeOf(emp.sector), d));

  const onExtra = (emp, d, isOff) => {
    if (emp.status === "ferias") return toast.error("EXTRA não pode ser marcado para funcionário de férias.");
    if (!isOff) return toast.error("EXTRA só pode ser marcado em um dia de folga.");
    onToggle(emp.id, d, true);
  };

  return (
    <section data-testid="weekly-calendar-grid" className="print-area rounded-2xl border border-[#E5E1D8] bg-white shadow-[0_1px_0_#E5E1D8,0_12px_32px_-16px_rgba(15,23,42,0.12)]">
      <div className="flex flex-wrap items-end justify-between gap-4 p-5 sm:p-6 border-b border-[#EFEBE3]">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8A929B]">
            Escala semanal · {[...new Set(sectors.map(modeOf))].join(" + ") || schedule.mode}
          </p>
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
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#FFE4E6] border border-[#FECDD3]" />Suspensão</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#FFEDD5] border border-[#FDBA74]" />Falta</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#F0F9FF] border border-[#7DD3FC]" />Convocado (intermitente)</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#F1F5F9] border border-[#CBD5E1]" />Férias</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#F5F3FF] border border-[#C4B5FD]" />Extra (shift + clique na folga)</span>
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
            <>
              <div className="no-print px-5 sm:px-6 pt-3">
                <SectorModeToggle sector={activeSector} mode={configuredMode(activeSector)} onChange={onSectorMode} />
                {configuredMode(activeSector) !== modeOf(activeSector) && (
                  <span className="ml-2 text-[11px] text-[#B45309]">Esta semana foi gerada em {modeOf(activeSector)}. Clique em Gerar escala · {activeSector} para aplicar.</span>
                )}
              </div>
              <DayTabs dates={dates} peaks={peaks} value={activeDay} onChange={setDayView} />
            </>
          )}
          {activeDay !== null ? (
            <PeakHoursPanel day={activeDay} date={dates[activeDay]} sector={activeSector} sectorMode={modeOf(activeSector)} workloads={workloads} members={visible} schedule={schedule} week={week} />
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
                  <SectorHeader key={`h-${g.name}`} name={g.name} members={g.members} worksOn={worksOn} peaks={peaks} mode={modeOf(g.name)} showCount={groups.length > 1} />,
                  ...g.members.map((emp, idx) => (
                    <Row
                      key={emp.id}
                      idx={idx}
                      emp={emp}
                      offs={offsOf(emp.id)}
                      suspensions={suspensionsOf(emp.id)}
                      absences={absencesOf(emp.id)}
                      vacationDays={vacationOf(emp.id)}
                      schedule={schedule}
                      dates={dates}
                      extras={extrasOf(emp.id)}
                      cctAlert={schedule.cct_alerts?.[emp.id]}
                      streakDays={schedule.streak_alerts?.[emp.id]}
                      peaks={peaks}
                      required={OFFS_PER_MODE[modeOf(emp.sector)]}
                      onToggle={onToggle}
                      onExtra={onExtra}
                      shiftOn={(d) => shiftOf(emp, d)}
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
