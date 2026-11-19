import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { Flame, AlertTriangle, Users, Printer, Lock, ChevronLeft, ChevronRight, Hand, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportMenu } from "@/components/folga/ExportMenu";
import { UnlockButton, useUnlock } from "@/components/folga/UnlockDialog";
import { groupByRole } from "@/lib/groupByRole";
import { DAYS_SHORT, OFFS_PER_MODE, weekDates, fmtDayMonth, isoDate, http, addDays, parseIso, mondayOf } from "@/lib/api";
import { defaultShiftOf } from "@/lib/workloadTimes";
import { GenerateDialog } from "@/components/folga/GenerateDialog";
import { isIntermittent, convocationOf, acceptedOn, shortNotice, CONVOCATION_LABEL, MIN_NOTICE_DAYS } from "@/lib/convocation";

// Célula do intermitente: — -> CONVOCADO -> ACEITO -> RECUSOU -> —
const OK = "bg-[#E3F5EC] border-[#E3F5EC] text-[#1D6B45] hover:border-[#8FD0AE]";
const WARN = "bg-[#FFF4D1] border-[#F2CF6B] text-[#7A5500]";
const RISK = "bg-[#FDE2E2] border-[#EE9A9A] text-[#A12828]";
const CELL = "relative w-full h-[52px] rounded-[14px] border-[1.5px] font-mono-data select-none";
const CONVOCATION_STYLE = {
  none: "bg-white/60 border-dashed border-[#D6D0EE] text-[#B9B2DA] hover:border-[#7C6AE0] hover:text-[#4B3DA8]",
  pending: "bg-[#E8EEF7] border-[#B9CBE6] text-[#34507A] hover:brightness-[0.98]",
  accepted: OK,
  declined: "bg-[#F8FAFC] border-[#E2E8F0] text-[#94A3B8] line-through hover:bg-[#F1F5F9]",
};
const CONVOCATION_NEXT = { none: "convocar", pending: "marcar aceite", accepted: "marcar recusa", declined: "limpar" };

const Tags = ({ checkout, doublePay, streak }) =>
  checkout || doublePay || streak ? (
    <span className="absolute top-1 right-1.5 flex max-w-[calc(100%-8px)] gap-[3px]">
      {checkout && <b title={`Caixa: ${checkout}`} className="truncate rounded-md bg-[#17142E] px-[5px] py-[2px] text-[9px] font-bold leading-none tracking-normal text-white">{checkout}</b>}
      {doublePay && <b title="Trabalha no feriado: pagamento em dobro" className="shrink-0 rounded-md bg-[#7A5500] px-[5px] py-[2px] text-[9px] font-bold leading-none tracking-normal text-[#FFF4D1]">2×</b>}
      {streak && <b title="Passou de 6 dias seguidos sem folga" className="shrink-0 rounded-md bg-[#A12828] px-[5px] py-[2px] text-[9px] font-bold leading-none tracking-normal text-white">+6 DIAS</b>}
    </span>
  ) : null;

const ConvocationCell = ({ conv, date, vacation, sick, closed, doublePay, shift, checkout, mural, excess, onClick, testId }) => {
  if (closed) return <Cell status="feriado" testId={testId} />;
  if (vacation) return <Cell status="ferias" testId={testId} />;
  if (sick) return <Cell status="atestado" testId={testId} />;
  const state = conv?.status || "none";
  // Mural: só o dia aceito aparece; convocação pendente ou recusada fica em branco
  if (mural) {
    return state === "accepted" && !excess ? (
      <Cell shift={shift} checkout={checkout} doublePay={doublePay} mural testId={testId} />
    ) : (
      <div data-testid={testId} className="w-full h-[52px]" />
    );
  }
  const late = shortNotice(conv, date);
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      title={`${state === "none" ? "Não convocado" : CONVOCATION_LABEL[state]}${conv?.at ? ` em ${conv.at.split("-").reverse().join("/")}` : ""} · clique: ${CONVOCATION_NEXT[state]}${
        late ? ` · convocação com menos de ${MIN_NOTICE_DAYS} dias de antecedência` : ""
      }${excess ? ` · ${excess} — fica fora do mural` : ""}`}
      className={`${CELL} text-[10px] font-bold tracking-wider transition-colors duration-200 focus:outline-none ${excess ? RISK : state === "accepted" && doublePay ? WARN : CONVOCATION_STYLE[state]} ${late && !excess ? "ring-2 ring-[#F2CF6B] ring-offset-1" : ""} ${state === "accepted" && (checkout || doublePay || excess) ? "pt-3" : ""}`}
    >
      {state === "accepted" && <Tags checkout={checkout} doublePay={doublePay} streak={!!excess} />}
      {state === "none" ? "—" : state === "accepted" ? (shift ? <ShiftText shift={shift} /> : "TRAB.") : CONVOCATION_LABEL[state]}
    </button>
  );
};

// Horário do dia: entrada–saída e, embaixo, o intervalo
const ShiftText = ({ shift }) => (
  <span className="flex flex-col items-center leading-tight">
    <span className="text-[12px] font-semibold tracking-normal">{shift[0]}–{shift[shift.length - 1]}</span>
    {shift.length === 4 && <span className="whitespace-nowrap font-sans text-[9.5px] font-medium tracking-[-0.01em] opacity-85">int. {shift[1]}–{shift[2]}</span>}
  </span>
);

const Cell = ({ off, susp, absent: absentProp, extra, peak, status, cct: cctProp, streak: streakProp, shift, checkout, doublePay, mural, locked, onClick, testId }) => {
  // Mural: falta acontece depois da impressão (vale o horário escalado) e não mostra alertas
  const absent = mural ? false : absentProp;
  const cct = mural ? undefined : cctProp;
  const streak = mural ? false : streakProp;
  if (status === "ferias") {
    return (
      <div
        data-testid={testId}
        className={`${CELL} flex items-center justify-center text-[11px] font-bold bg-[#E6F2F1] border-[#E6F2F1] text-[#2E5F5B] cursor-not-allowed`}
        title="Funcionário em período de férias"
      >
        Férias
      </div>
    );
  }
  if (status === "feriado") {
    return (
      <div
        data-testid={testId}
        className={`${CELL} flex items-center justify-center text-[11px] font-bold bg-[#EEEBFB] border-[#EEEBFB] text-[#4B3DA8] cursor-not-allowed`}
        title="Feriado com a loja fechada"
      >
        Feriado
      </div>
    );
  }
  if (status === "atestado") {
    return (
      <div
        data-testid={testId}
        className={`${CELL} flex items-center justify-center text-[11px] font-bold bg-[#E8EEF7] border-[#E8EEF7] text-[#34507A] cursor-not-allowed`}
        title="Atestado médico (lançado no status do funcionário)"
      >
        Atestado
      </div>
    );
  }

  let texto = shift ? <ShiftText shift={shift} /> : "Trab.";
  // Semáforo: verde = ok · amarelo = atenção · vermelho = risco
  let classesEstilo = streak ? RISK : doublePay ? WARN : OK; // Trabalhando

  if (absent) {
    texto = "Falta";
    classesEstilo = RISK; // Falta
  } else if (extra) {
    texto = "Folga"; // A cor lilás indica que é EXTRA
    classesEstilo = streak ? RISK : "bg-[#EEEBFB] border-[#C9BFFF] text-[#4B3DA8]"; // Trabalha na folga
  } else if (susp) {
    texto = "Susp.";
    classesEstilo = "bg-[#FFF1F4] border-[#F6C6D2] text-[#A12850]"; // Suspensão
  } else if (off) {
    texto = "Folga";
    classesEstilo = peak
      ? WARN // Folga em dia de pico
      : "bg-[#F2F0F8] border-[#F2F0F8] text-[#4A4566] hover:border-[#D6D0EE]"; // Folga comum
  }

  // Dia trabalhado (inclui EXTRA): mostra o caixa
  const working = !absent && (extra || (!off && !susp));

  if (mural) {
    return (
      <div data-testid={testId} className={`${CELL} flex items-center justify-center text-[12px] font-semibold ${classesEstilo} ${working && (checkout || doublePay) ? "pt-3" : ""}`}>
        {working && <Tags checkout={checkout} doublePay={doublePay} />}
        {texto}
      </div>
    );
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
        (locked
          ? absent
            ? "Dia bloqueado · Falta · clique: retirar a falta"
            : off || susp
              ? "Dia bloqueado · só falta ou atestado"
              : "Dia bloqueado · clique: lançar falta"
          : extra
          ? "Extra: trabalha no dia de folga (clique para voltar a folga)"
          : absent
            ? "Falta · clique: volta a trabalhar"
            : susp
              ? "Suspensão · clique: falta"
              : off
                ? "Folga · clique: suspensão · shift + clique: EXTRA"
                : "Trabalha · clique: folga")
      }
      className={`${CELL} text-[12px] font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#6D5BD0] ${classesEstilo} ${cct && !streak ? "ring-2 ring-[#F2CF6B] ring-offset-1" : ""} ${locked && !absent ? "opacity-60" : ""} ${working && (checkout || doublePay || streak) ? "pt-3" : ""}`}
    >
      {working && <Tags checkout={checkout} doublePay={doublePay} streak={streak} />}
      {texto}
    </button>
  );
};

const Alert = ({ title, testId, children }) => (
  <span data-testid={testId} title={title} className="inline-flex items-center gap-0.5 text-[9px] bg-[#FDECEC] text-[#C93C3C] border border-[#EE9A9A] font-bold px-1.5 py-0.5 rounded cursor-help">
    <AlertTriangle className="h-2.5 w-2.5" /> {children}
  </span>
);

const Row = ({ emp, offs, suspensions, absences, vacationDays = [], extras, peaks, required, onToggle, onExtra, cctAlert, streakDays, idx, schedule, dates, shiftOn, mural, streakLimit = 6, sickDays = [], lockedDay = () => false, checkoutOn = () => null, closedDays = [], openHolidays = [] }) => {
  const intermittent = isIntermittent(emp);
  // Intermitente: dias aceitos depois do limite de dias seguidos (6 no 6x1, 5 no 5x2)
  const excessDays = new Set();
  if (intermittent) {
    let run = 0;
    for (let d = 0; d < 7; d++) {
      run = acceptedOn(schedule, emp.id, d) && !vacationDays.includes(d) ? run + 1 : 0;
      if (run > streakLimit) excessDays.add(d);
    }
  }
  // EXTRA é computado como folga. Folga a mais pode ocorrer pelas regras de domingo/6 dias.
  const realOffs = offs;
  // Semana com férias: os dias de férias contam como descanso, sem alerta de folga
  const onVacation = emp.status === "ferias" || vacationDays.length > 0;
  const wrong = !onVacation && realOffs.length < required;

  return (
    <tr data-testid="employee-row" className="rise border-t border-[#EEEBFB]" style={{ animationDelay: `${idx * 30}ms` }}>
      <td className="py-[3px] pr-4 sticky left-0 bg-[#FBFAFE] z-10 min-w-[150px] md:min-w-[240px]">
        <div className="flex items-center gap-3">
        {!mural && <span className="hidden sm:grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-[#E6E1FA] text-[13px] font-bold text-[#4B3DA8]">{emp.name.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>}
        <div className="min-w-0">
        <p className="font-semibold text-sm leading-tight flex flex-wrap items-center gap-1.5">
          {emp.name}
          {emp.status === "ferias" && <span className="text-[9px] bg-[#E2E8F0] text-[#475569] font-bold px-1.5 py-0.5 rounded">FÉRIAS</span>}
          {emp.status === "suspensao" && <span className="text-[9px] bg-[#FFE4E6] text-[#E11D48] font-bold px-1.5 py-0.5 rounded">SUSP.</span>}
          {emp.status === "falta" && <span className="text-[9px] bg-[#FFEDD5] text-[#C2410C] font-bold px-1.5 py-0.5 rounded">FALTA</span>}
          {intermittent && !mural && <span title="Intermitente: trabalha só nos dias com convocação aceita" className="text-[9px] bg-[#E0F2FE] text-[#0369A1] font-bold px-1.5 py-0.5 rounded">INT.</span>}
          {!mural && cctAlert && <Alert testId={`cct-alert-${emp.id}`} title={cctAlert}>CCT</Alert>}
          {!mural && excessDays.size > 0 && <Alert title={`Mais de ${streakLimit} dias seguidos — os dias excedentes ficam fora do mural`}>+{streakLimit} DIAS</Alert>}
        </p>
        {emp.role && <span className="text-xs text-[#5E5880]">{emp.role}</span>}
        </div>
        </div>
      </td>
      {DAYS_SHORT.map((_, d) => (
        <td key={d} className="p-[3px] min-w-[96px]">
          {intermittent ? (
            <ConvocationCell
              conv={convocationOf(schedule, emp.id, d)}
              date={dates[d]}
              vacation={vacationDays.includes(d)}
              sick={sickDays.includes(d)}
              closed={closedDays.includes(d)}
              doublePay={openHolidays.includes(d)}
              shift={shiftOn(d)}
              checkout={checkoutOn(d)}
              mural={mural}
              excess={excessDays.has(d) ? `Passou de ${streakLimit} dias seguidos` : null}
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
            streak={!!streakDays?.includes(d)}
            peak={peaks.includes(d)}
            shift={shiftOn(d)}
            checkout={checkoutOn(d)}
            mural={mural}
            locked={lockedDay(d)}
            doublePay={openHolidays.includes(d)}
            status={closedDays.includes(d) ? "feriado" : vacationDays.includes(d) ? "ferias" : sickDays.includes(d) ? "atestado" : emp.status}
            // Clique: TRAB. -> FOLGA -> SUSP. -> FALTA -> TRAB. Shift + clique numa folga marca EXTRA.
            onClick={(e) => (e.shiftKey ? onExtra(emp, d, offs.includes(d)) : onToggle(emp.id, d))}
            testId={`cell-${emp.id}-${d}`}
          />
          )}
        </td>
      ))}
      {!mural && <td className="pl-3 text-center">
        {intermittent ? (
          <span data-testid={`row-summary-${emp.id}`} className="text-xs font-mono-data font-semibold text-[#0369A1]" title="Dias com convocação aceita">
            {DAYS_SHORT.filter((_, d) => acceptedOn(schedule, emp.id, d)).length} dia(s)
          </span>
        ) : (
        <span data-testid={`row-summary-${emp.id}`} className={`inline-flex items-center gap-1 text-xs font-mono-data font-semibold ${wrong ? "text-[#C93C3C]" : "text-[#5E5880]"}`}>
          {wrong && <AlertTriangle className="h-3.5 w-3.5" />}
          {emp.status === "ferias" || vacationDays.length === 7 ? "Férias" : `${realOffs.length}/${required}`}
        </span>
        )}
      </td>}
    </tr>
  );
};

const SectorTabs = ({ sectors, value, onChange }) => (
  <div data-testid="sector-tabs" className="no-print flex flex-wrap gap-2">
    {["all", ...sectors].map((s) => (
      <button
        key={s}
        data-testid={`sector-tab-${s === "all" ? "todos" : s}`}
        onClick={() => onChange(s)}
        className={`h-[38px] px-4 rounded-full text-sm font-medium border transition-colors duration-200 ${
          value === s ? "bg-[#17142E] border-[#17142E] text-white" : "bg-white/75 border-[#E4E0F3] text-[#3A3555] hover:border-[#17142E]"
        }`}
      >
        {s === "all" ? "Todos" : s}
      </button>
    ))}
  </div>
);

const SectorHeader = ({ name, members, worksOn, peaks, mode, showCount, mural, newPage }) => (
  <tr data-testid={`sector-group-${name}`} className={mural && newPage ? "print:break-before-page" : ""}>
    <td className="pt-5 pb-2 sticky left-0 bg-[#FBFAFE] z-10">
      <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#5E5880]">{name}{!mural && <> · {members.length} {members.length === 1 ? "pessoa" : "pessoas"} · {mode}</>}</span>
    </td>
    {DAYS_SHORT.map((_, d) => {
      if (!showCount) return <td key={d} />;
      const c = members.filter((e) => worksOn(e.id, d)).length;
      return (
        <td key={d} className="pt-5 pb-2 text-center">
          <span data-testid={`sector-coverage-${name}-${d}`} className={`font-mono-data text-[11px] font-semibold ${peaks.includes(d) && c < members.length ? "text-[#C93C3C]" : "text-[#8A85A3]"}`}>
            {c}/{members.length}
          </span>
        </td>
      );
    })}
    {!mural && <td />}
  </tr>
);

export const ScheduleGrid = ({ employees, movement, schedule, week, onWeekChange, onToggle, sectorModes = {}, workloads = [], checkouts = [], sector: sectorProp, onSectorChange, onGenerate, generating, generateSector }) => {
  const dates = weekDates(week);
  const today = isoDate(new Date());
  const [sectorLocal, setSectorLocal] = useState("all");
  const sector = sectorProp ?? sectorLocal;
  const setSector = onSectorChange ?? setSectorLocal;
  const [genOpen, setGenOpen] = useState(false);
  // Versão para o mural: ligada pelo botão ou automaticamente ao imprimir
  const [muralOn, setMuralOn] = useState(false);
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true)); // aplica antes de o navegador montar a impressão
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  const mural = muralOn || printing;
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
  const sickOf = (id) => schedule.sick_days?.[id] || [];
  const holidayOn = (d) => schedule.holidays?.[String(d)];
  const closedDays = schedule.closed_days || [];
  const openHolidays = DAYS_SHORT.map((_, d) => d).filter((d) => holidayOn(d) && !holidayOn(d).closed);
  // Dias antes de hoje ficam bloqueados (só falta e atestado), a não ser com a senha do administrador
  const unlockedUntil = useUnlock();
  const pastDay = (d) => isoDate(dates[d]) < today;
  const lockedDay = (d) => pastDay(d) && !unlockedUntil;
  // EXTRA conta como dia trabalhado mesmo sendo folga
  // Suspensão e falta não contam como em operação
  const byId = Object.fromEntries(employees.map((e) => [e.id, e]));
  const worksOn = (id, d) =>
    isIntermittent(byId[id]) ? acceptedOn(schedule, id, d) && !vacationOf(id).includes(d) && !sickOf(id).includes(d) && !closedDays.includes(d) :
    (!offsOf(id).includes(d) || extrasOf(id).includes(d)) && !suspensionsOf(id).includes(d) && !absencesOf(id).includes(d) && !vacationOf(id).includes(d) && !sickOf(id).includes(d) && !closedDays.includes(d);
  const sectors = [...new Set(employees.map((e) => e.sector))].sort((a, b) => a.localeCompare(b));
  const activeSector = sectors.includes(sector) ? sector : "all";
  const visible = activeSector === "all" ? employees : employees.filter((e) => e.sector === activeSector);
  // No mural fica de fora o intermitente sem nenhum dia aceito na semana
  const onBoard = (e) => !isIntermittent(e) || DAYS_SHORT.some((_, d) => acceptedOn(schedule, e.id, d));
  const groups = sectors
    .filter((s) => activeSector === "all" || s === activeSector)
    .map((s) => ({ name: s, members: visible.filter((e) => e.sector === s && (!mural || onBoard(e))) }))
    .filter((g) => !mural || g.members.length > 0);
  const fmtLong = (d) => d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "");
  const coverage = DAYS_SHORT.map((_, d) => visible.filter((e) => worksOn(e.id, d)).length);

  const [weekShifts, setWeekShifts] = useState({});
  useEffect(() => {
    http.get("/shifts/week", { params: { week } }).then(({ data }) => setWeekShifts(data)).catch(() => setWeekShifts({}));
  }, [week]);
  // Caixa de cada operadora por dia
  const [weekCheckouts, setWeekCheckouts] = useState({});
  useEffect(() => {
    http.get("/checkouts/assign/week", { params: { week } }).then(({ data }) => setWeekCheckouts(data)).catch(() => setWeekCheckouts({}));
  }, [week]);
  const checkoutName = (id) => checkouts.find((c) => c.id === id)?.name || null;
  const shiftOf = (emp, d) =>
    weekShifts[String(d)]?.[emp.id] ||
    (isIntermittent(emp) ? null : defaultShiftOf(workloads.find((w) => w.id === emp.workload), modeOf(emp.sector), d));

  const onExtra = (emp, d, isOff) => {
    if (emp.status === "ferias") return toast.error("EXTRA não pode ser marcado para funcionário de férias.");
    if (!isOff) return toast.error("EXTRA só pode ser marcado em um dia de folga.");
    onToggle(emp.id, d, true);
  };

  // Na loja por dia: quem trabalha / quem está escalado no dia (intermitente só conta quando aceitou)
  const expected = (d) => visible.filter((e) => !isIntermittent(e) || acceptedOn(schedule, e.id, d)).length;
  const countTone = (c, n) => (!n ? "bg-[#F2F0F8] text-[#5E5880]" : c / n >= 0.75 ? "bg-[#E3F5EC] text-[#1D6B45]" : c / n >= 0.6 ? "bg-[#FFF4D1] text-[#7A5500]" : "bg-[#FDE2E2] text-[#A12828]");
  const pastNames = DAYS_SHORT.filter((_, d) => pastDay(d));
  const withoutOff = visible.filter((e) => !isIntermittent(e) && e.status !== "ferias" && !vacationOf(e.id).length && offsOf(e.id).length < OFFS_PER_MODE[modeOf(e.sector)]).length;
  const notGenerated = !schedule.generated_at && employees.length > 0;
  const fmtShort = () => {
    const a = dates[0], b = dates[6];
    const m = (d) => d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
    return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${m(b)}` : `${a.getDate()} ${m(a)} – ${b.getDate()} ${m(b)}`;
  };
  const shiftWeek = (n) => onWeekChange(isoDate(addDays(parseIso(week), n * 7)));
  const currentWeek = isoDate(mondayOf(new Date()));
  const legend = (
    <div className="flex flex-wrap items-center gap-3.5 text-xs text-[#4A4566]">
      <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded border-[1.5px] border-[#8FD0AE] bg-[#E3F5EC]" />Ok</span>
      <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded border-[1.5px] border-[#F2CF6B] bg-[#FFF4D1]" />Atenção</span>
      <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded border-[1.5px] border-[#EE9A9A] bg-[#FDE2E2]" />Risco</span>
      <span className="text-[#8A84A6]">|</span>
      <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-[#F2F0F8]" />Folga</span>
      <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded border border-[#C9BFFF] bg-[#EEEBFB]" />Extra</span>
      <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-[#E6F2F1]" />Férias</span>
      <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-[#E8EEF7]" />Atestado</span>
    </div>
  );

  return (
    <div className="space-y-5">
      <header className="no-print flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[13px] font-medium text-[#5E5880]">
            Escala semanal · {[...new Set(sectors.map(modeOf))].join(" + ") || schedule.mode}
            {peaks.length > 0 && <> · pico: <b className="font-semibold text-[#9A3A0E]">{peaks.map((d) => DAYS_SHORT[d]).join(", ")}</b></>}
          </p>
          <h1 className="font-serif-title text-[40px] leading-none sm:text-[56px]">Quem trabalha, <em>quem folga</em></h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div data-testid="week-nav" className="flex h-11 items-center gap-1 rounded-full border border-[#E4E0F3] bg-white/80 px-1.5">
            <button data-testid="btn-prev-week" onClick={() => shiftWeek(-1)} aria-label="Semana anterior" title="Semana anterior" className="grid h-[34px] w-[34px] place-items-center rounded-full text-[#3A3555] hover:bg-[#EEEBFB]"><ChevronLeft className="h-[18px] w-[18px]" /></button>
            <strong data-testid="week-range" className="px-1.5 font-display text-[15px] font-semibold">{fmtShort()}</strong>
            <button data-testid="btn-next-week" onClick={() => shiftWeek(1)} aria-label="Próxima semana" title="Próxima semana" className="grid h-[34px] w-[34px] place-items-center rounded-full text-[#3A3555] hover:bg-[#EEEBFB]"><ChevronRight className="h-[18px] w-[18px]" /></button>
          </div>
          {week !== currentWeek && (
            <button data-testid="btn-current-week" onClick={() => onWeekChange(currentWeek)} className="h-11 rounded-full border border-[#E4E0F3] bg-white/80 px-4 text-sm font-semibold text-[#1B1830] hover:border-[#17142E]">Semana atual</button>
          )}
          <button
            data-testid="btn-mural"
            onClick={() => setMuralOn((v) => !v)}
            title="Mostra a escala como vai ser impressa: só quem trabalha na semana, sem contagens e alertas"
            className={`inline-flex h-11 items-center gap-2 rounded-full border px-[18px] text-sm font-semibold transition-colors ${muralOn ? "border-[#17142E] bg-[#17142E] text-white" : "border-[#E4E0F3] bg-white/80 text-[#1B1830] hover:border-[#17142E]"}`}
          >
            <Printer className="h-[18px] w-[18px]" /> Mural
          </button>
          <ExportMenu employees={employees} schedule={schedule} />
          {onGenerate && (
            <Button data-testid="btn-generate-roster" onClick={() => setGenOpen(true)} disabled={generating} className="h-11 rounded-full bg-[#6D5BD0] px-[18px] text-white hover:bg-[#5B4BC4]">
              {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {generateSector ? `Gerar escala · ${generateSector}` : "Gerar escala"}
            </Button>
          )}
          {DAYS_SHORT.some((_, d) => pastDay(d)) && <UnlockButton />}
          {onGenerate && (
            <GenerateDialog open={genOpen} onOpenChange={setGenOpen} sector={activeSector === "all" ? null : activeSector} sectors={sectors} modeOf={configuredMode} regenerating={!!schedule.generated_at} onConfirm={onGenerate} />
          )}
        </div>
      </header>

      {employees.length > 0 && (
        <div className="no-print flex flex-wrap items-center justify-between gap-3.5">
          <SectorTabs sectors={sectors} value={activeSector} onChange={setSector} />
          {!mural && legend}
        </div>
      )}

      {!mural && employees.length > 0 && (
        <div className={`no-print flex items-center gap-2.5 rounded-2xl border border-dashed px-3.5 py-2.5 text-[13px] ${withoutOff || notGenerated ? "border-[#EE9A9A] bg-[#FDE2E2] text-[#A12828]" : "border-[#8FD0AE] bg-[#E3F5EC] text-[#1D6B45]"}`}>
          <Hand className="h-[18px] w-[18px] shrink-0" />
          <span data-testid={notGenerated ? "week-not-generated" : undefined}>
            {notGenerated ? <>Escala desta semana ainda não gerada — clique em <b>Gerar escala</b>. </> : "Clique num dia para dar ou tirar a folga · shift + clique na folga marca EXTRA. "}
            {pastNames.length > 0 && `${pastNames.length === 1 ? `${pastNames[0]} já passou e fica bloqueado` : `${pastNames.slice(0, -1).join(", ")} e ${pastNames[pastNames.length - 1]} já passaram e ficam bloqueados`}. `}
            <b>{withoutOff ? `${withoutOff} ${withoutOff === 1 ? "pessoa ainda sem folga" : "pessoas ainda sem folga"} nesta semana.` : "Todo mundo tem folga nesta semana."}</b>
          </span>
        </div>
      )}

    <section data-testid="weekly-calendar-grid" className="print-area glass rounded-[26px]">
      {mural && (
        <div className="p-5 sm:p-6">
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8A85A3]">Escala semanal</p>
          <h2 className="font-serif-title text-4xl sm:text-5xl mt-1">{activeSector === "all" ? "Todos os setores" : activeSector}</h2>
          <p className="text-sm font-semibold text-[#5E5880] mt-1">{fmtLong(dates[0])} a {fmtLong(dates[6])} de {dates[6].getFullYear()}</p>
        </div>
      )}
      {employees.length === 0 ? (
        <div data-testid="schedule-empty" className="p-12 text-center text-[#5E5880]">
          <Users className="h-8 w-8 mx-auto mb-3 text-[#8A85A3]" />
          Cadastre funcionários abaixo e clique em <b>Gerar escala</b>.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto p-3 sm:p-5">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="text-left align-bottom text-xs font-semibold text-[#5E5880] pb-4 sticky left-0 bg-[#FBFAFE] z-10">Funcionário</th>
                  {DAYS_SHORT.map((d, i) => (
                    <th
                      key={d}
                      data-testid="calendar-header-day"
                      className="pb-3 px-1 align-bottom"
                    >
                      <div className="flex flex-col items-center gap-1">
                        <div className="flex h-5 items-center gap-1">
                          {peaks.includes(i) && <span className="inline-flex h-5 items-center gap-1 rounded-full bg-[#FFE4D6] px-2 text-[11px] font-bold text-[#9A3A0E]"><Flame className="h-[11px] w-[11px]" />pico</span>}
                          {holidayOn(i) && (
                            <span
                              title={`${holidayOn(i).name}${holidayOn(i).closed ? " · loja fechada" : " · loja aberta (pagamento em dobro)"}`}
                              className="inline-flex h-5 items-center rounded-full bg-[#E6E1FA] px-2 text-[11px] font-bold text-[#4B3DA8]"
                            >
                              feriado
                            </span>
                          )}
                        </div>
                        <span className={`inline-flex items-center gap-1 font-display text-sm font-semibold ${isoDate(dates[i]) === today ? "text-[#5B4BC4]" : "text-[#1B1830]"}`}>
                          {lockedDay(i) && !mural && <Lock className="h-3 w-3" />}{d}
                        </span>
                        <span data-testid={`header-date-${i}`} className={`text-xs font-medium ${isoDate(dates[i]) === today ? "text-[#5B4BC4]" : "text-[#5E5880]"}`}>{fmtDayMonth(dates[i])}</span>
                        {!mural && (
                          <span className={`inline-flex h-[22px] items-center whitespace-nowrap rounded-full px-2 text-[11px] font-bold ${countTone(coverage[i], expected(i))}`}>
                            {coverage[i]}/{expected(i)} na loja
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                  {!mural && <th className="pb-4 align-bottom text-xs font-semibold text-[#5E5880]">Folgas</th>}
                </tr>
              </thead>
              <tbody>
                {groups.map((g, gi) => [
                  <SectorHeader key={`h-${g.name}`} name={g.name} members={g.members} worksOn={worksOn} peaks={peaks} mode={modeOf(g.name)} showCount={groups.length > 1 && !mural} mural={mural} newPage={gi > 0} />,
                  ...groupByRole(g.members, undefined, g.name).flatMap((rg) => [
                    ...rg.members.map((emp, idx) => (
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
                      streakLimit={modeOf(emp.sector) === "5x2" ? 5 : 6}
                      sickDays={sickOf(emp.id)}
                      closedDays={closedDays}
                      openHolidays={mural ? [] : openHolidays}
                      lockedDay={lockedDay}
                      onToggle={onToggle}
                      onExtra={onExtra}
                      shiftOn={(d) => shiftOf(emp, d)}
                      checkoutOn={(d) => checkoutName(weekCheckouts[String(d)]?.[emp.id])}
                      mural={mural}
                    />
                  )),
                  ]),
                ])}
              </tbody>

            </table>
            {!mural && openHolidays.map((d) => {
              const names = visible.filter((e) => worksOn(e.id, d)).map((e) => e.name);
              return (
                <p key={d} className="no-print mt-3 text-xs text-[#4338CA]">
                  <b>Feriado {fmtDayMonth(dates[d])} · {holidayOn(d).name}</b> (pagamento em dobro): {names.length ? names.join(", ") : "ninguém escalado"}.
                </p>
              );
            })}
          </div>
        </>
      )}
    </section>
    </div>
  );
};
