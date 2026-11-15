import { useEffect, useRef, useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Clock, FileUp, Flame, Loader2, Trash2, AlertTriangle, UserPlus, X, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { http, errMsg, DAYS, fmtDayMonth } from "@/lib/api";
import { isIntermittent, acceptedOn } from "@/lib/convocation";
import { defaultShiftOf, fromMin, toMin, dayMinutes } from "@/lib/workloadTimes";
import { groupByRole } from "@/lib/groupByRole";
import { isTrial } from "@/components/folga/RoleDialog";

const fmtHours = (m) => (m ? `${Math.floor(m / 60)}h${pad(m % 60)}` : "–");
import { parseHourlyReport, singleWeekday, peakHours, coversHour, onBreak } from "@/lib/hourlyReport";

const DEFAULT_RANGE = [7, 22];
const pad = (n) => String(n).padStart(2, "0");

const readText = async (file) => {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf); // CISS exporta em ANSI
  }
};

const worksOn = (schedule, emp, day) => {
  if (emp.status === "ferias") return false;
  if ((schedule.vacation_days?.[emp.id] || []).includes(day)) return false;
  if ((schedule.sick_days?.[emp.id] || []).includes(day)) return false;
  if (isIntermittent(emp)) return acceptedOn(schedule, emp.id, day);
  if ((schedule.suspension_days?.[emp.id] || []).includes(day)) return false;
  if ((schedule.absence_days?.[emp.id] || []).includes(day)) return false;
  if ((schedule.vacation_days?.[emp.id] || []).includes(day)) return false;
  const off = (schedule.off_days?.[emp.id] || []).includes(day);
  return !off || (schedule.extra_days?.[emp.id] || []).includes(day);
};

const FIELDS = ["Entrada", "Saída intervalo", "Volta intervalo", "Saída"];
// Turno salvo como [entrada, saída] ou [entrada, saída intervalo, volta intervalo, saída]
const toFields = (shift) => (!shift ? ["", "", "", ""] : shift.length === 4 ? [...shift] : [shift[0], "", "", shift[1]]);

// Minutos de trabalho no dia conforme a jornada cadastrada e a escala do setor
const dailyMinutes = (wl, mode, day) => {
  if (!wl) return null;
  if (mode === "5x2" && wl.minutes_5x2) return wl.minutes_5x2;
  return wl.minutes[day] || null;
};
// Intervalo: o da jornada acima de 6h; 15 min entre 4h e 6h; nenhum até 4h
const breakFor = (wl, minutes) => (minutes > 360 ? wl?.break_minutes ?? 60 : minutes > 240 ? 15 : 0);

// Sugere intervalo e saída a partir da entrada (intervalo após 4h, ou no meio do turno se for curto)
const suggestShift = (start, minutes, breakLen) => {
  if (!minutes || !/^\d{2}:\d{2}$/.test(start)) return null;
  const s = toMin(start);
  const end = s + minutes + breakLen;
  if (end >= 24 * 60) return null;
  if (!breakLen) return [start, "", "", fromMin(end)];
  const at = s + (minutes > 360 ? 240 : Math.round(minutes / 2 / 5) * 5);
  return [start, fromMin(at), fromMin(at + breakLen), fromMin(end)];
};

const ShiftInputs = ({ shift, fallback, onSave, minutes, breakLen }) => {
  const base = shift || fallback;
  const [values, setValues] = useState(() => toFields(base));
  useEffect(() => { setValues(toFields(base)); }, [base]);
  const usingDefault = !shift && !!fallback && values.join("|") === toFields(fallback).join("|");

  // Salva só quando o foco sai dos quatro campos
  const onBlur = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    const [start, bs, be, end] = values;
    if (values.join("|") === toFields(base).join("|")) return;
    if (!start && !bs && !be && !end) {
      if (fallback) setValues(toFields(fallback)); // limpar volta para o horário da jornada
      return shift ? onSave(null) : undefined;
    }
    if (fallback && !shift && values.join("|") === toFields(fallback).join("|")) return;
    if (!start || !end) return toast.error("Informe a entrada e a saída do expediente.");
    if (end <= start) return toast.error("A saída precisa ser depois da entrada.");
    if (!!bs !== !!be) return toast.error("Informe a saída e a volta do intervalo.");
    if (bs && !(start <= bs && bs < be && be <= end)) return toast.error("O intervalo precisa ficar dentro do expediente.");
    onSave({ start, break_start: bs || null, break_end: be || null, end });
  };

  const cls = "w-[78px] rounded-md border border-[#E5E1D8] bg-white px-1 py-1 text-xs font-mono-data focus:outline-none focus:ring-2 focus:ring-[#0F172A]";
  return (
    <div className="flex items-center gap-1" onBlur={onBlur}>
      {FIELDS.map((label, i) => (
        <input
          key={label}
          type="time"
          step={300}
          aria-label={label}
          title={label}
          value={values[i]}
          onChange={(e) => {
            const value = e.target.value;
            setValues((v) => v.map((x, j) => (j === i ? value : x)));
          }}
          onKeyDown={(e) => {
            // Enter ou Tab na entrada (com os demais vazios): preenche o restante pela jornada
            if (i !== 0 || (e.key !== "Enter" && e.key !== "Tab")) return;
            setValues((v) => (!v[1] && !v[2] && !v[3] && v[0] ? suggestShift(v[0], minutes, breakLen) || v : v));
          }}
          className={`${cls} ${i === 1 || i === 2 ? "bg-[#F0F9FF]" : ""} ${usingDefault ? "text-[#8A929B]" : ""}`}
        />
      ))}
    </div>
  );
};

// Estado de cada 15 minutos da hora: "work" | "break" | null
const inRange = (shift, a, b, m) => !!shift && toMin(shift[a]) <= m && m < toMin(shift[b]);
const quarterState = (shift, h, q) => {
  if (!shift) return null;
  const m = h * 60 + q * 15 + 7; // meio do bloco de 15 min
  if (!inRange(shift, 0, shift.length - 1, m)) return null;
  if (shift.length === 4 && inRange(shift, 1, 2, m)) return "break";
  return "work";
};
const fmtQuarter = (h, q) => `${pad(h)}:${pad(q * 15)}`;

// Uma hora da grade, dividida em 4 blocos de 15 min
const HourCell = ({ shift, h, peak, workColor = "bg-[#15803D]", lentAt }) => (
  <div className={`h-8 rounded overflow-hidden flex gap-px ${peak ? "bg-[#FEF2F2]" : "bg-[#F2EFE8]"}`}>
    {[0, 1, 2, 3].map((q) => {
      const st = quarterState(shift, h, q);
      const lent = st === "work" && lentAt?.(h * 60 + q * 15 + 7);
      const color = lent ? "bg-[#FCD34D]" : st === "work" ? workColor : st === "break" ? "bg-[#BAE6FD]" : "";
      const label = lent ? `Ajudando em ${lent}` : st === "break" ? "Intervalo" : st === "work" ? "No setor" : "Fora";
      return <div key={q} title={`${fmtQuarter(h, q)} · ${label}`} className={`flex-1 ${color}`} />;
    })}
  </div>
);

// Janela em que alguém de outro setor ajuda aqui: [de, até]
const LoanInputs = ({ shift, onSave }) => {
  const [values, setValues] = useState(shift);
  useEffect(() => { setValues(shift); }, [shift]);
  const onBlur = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (values.join("|") === shift.join("|")) return;
    const [start, end] = values;
    if (!start || !end || end <= start) {
      setValues(shift);
      return toast.error("Informe de que horas até que horas a pessoa ajuda.");
    }
    onSave({ start, break_start: null, break_end: null, end });
  };
  const cls = "w-[78px] rounded-md border border-[#C4B5FD] bg-[#F5F3FF] px-1 py-1 text-xs font-mono-data focus:outline-none focus:ring-2 focus:ring-[#6D28D9]";
  return (
    <div className="flex items-center gap-1" onBlur={onBlur}>
      <input type="time" step={300} aria-label="Ajuda de" title="Ajuda de" value={values[0]} onChange={(e) => setValues([e.target.value, values[1]])} className={cls} />
      <span className="text-[10px] text-[#8A929B] w-[78px] text-center">até</span>
      <input type="time" step={300} aria-label="Ajuda até" title="Ajuda até" value={values[1]} onChange={(e) => setValues([values[0], e.target.value])} className={cls} />
    </div>
  );
};

const isOperator = (emp) => !/pacot|fiscal|recep/i.test(emp?.role || "");

const ImportPreview = ({ preview, setPreview, onSave, saving }) => {
  const period = preview.periods.find((p) => p.key === preview.key);
  const total = period.hours.reduce((s, h) => s + h.clients, 0);
  const peaks = peakHours(period.hours);
  return (
    <div data-testid="hourly-import-preview" className="rounded-xl border border-[#E5E1D8] bg-[#F9F8F5] p-4 space-y-3">
      <p className="text-sm font-bold">Relatório lido: {period.hours.length} faixas de horário</p>
      {preview.periods.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {preview.periods.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreview({ ...preview, key: p.key, day: singleWeekday(p) ?? preview.day })}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${p.key === preview.key ? "bg-[#0F172A] border-[#0F172A] text-white" : "bg-white border-[#E5E1D8] text-[#575E65]"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-[#575E65]">
        {preview.periods.length === 1 && <>{period.label} · </>}
        {Math.round(total)} clientes · pico em {peaks.length ? peaks.map((h) => `${h}h`).join(", ") : "—"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-semibold">Usar como movimento de</label>
        <select
          value={preview.day}
          onChange={(e) => setPreview({ ...preview, day: Number(e.target.value) })}
          className="rounded-md border border-[#E5E1D8] bg-white px-2 py-1 text-xs"
        >
          {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Cancelar</Button>
          <Button size="sm" disabled={saving} onClick={() => onSave(period, preview.day)} className="bg-[#0F172A] hover:bg-[#1E293B] text-white">
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar
          </Button>
        </div>
      </div>
    </div>
  );
};

export const PeakHoursPanel = ({ day, date, sector, sectorMode = "6x1", workloads = [], members, allEmployees = [], schedule, week, locked = false, checkouts = [], assign = {}, onAssign }) => {
  // Coluna de caixa só nos setores de frente de caixa
  const showCheckouts = checkouts.length > 0 && /caixa|checkout|pdv/i.test(sector);
  const extraCols = showCheckouts ? 1 : 0;
  const wlOf = (emp) => workloads.find((w) => w.id === emp.workload);
  const minutesOf = (emp) => dailyMinutes(wlOf(emp), sectorMode, day);
  // Efetivos: horário do ponto da jornada, a não ser que tenha um ajuste salvo para o dia
  const defaultOf = (emp) => (isIntermittent(emp) ? null : defaultShiftOf(wlOf(emp), sectorMode, day));
  const shiftOf = (emp) => shifts[emp.id] || defaultOf(emp);
  const fileRef = useRef(null);
  const [hourlyAll, setHourlyAll] = useState([]);
  const [shifts, setShifts] = useState({});
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    http.get("/hourly").then(({ data }) => setHourlyAll(data)).catch((e) => toast.error(errMsg(e)));
  }, []);
  useEffect(() => {
    setShifts({});
    http.get("/shifts", { params: { week, day } }).then(({ data }) => setShifts(data.shifts)).catch((e) => toast.error(errMsg(e)));
  }, [week, day]);
  const [weekAll, setWeekAll] = useState({});
  useEffect(() => {
    http.get("/shifts/week", { params: { week } }).then(({ data }) => setWeekAll(data)).catch(() => setWeekAll({}));
  }, [week, day]);

  const report = hourlyAll.find((h) => h.day === day);
  const working = members.filter((e) => worksOn(schedule, e, day));
  const away = members.filter((e) => !worksOn(schedule, e, day));

  // Ajuda de outro setor: turno salvo com a chave "funcionário@setor" (só a janela em que ajuda)
  const byId = Object.fromEntries(allEmployees.map((e) => [e.id, e]));
  const loanKey = (id) => `${id}@${sector}`;
  const offKey = (id) => `${id}@${sector}@fora`;
  const helpers = [
    ...Object.entries(shifts)
      .filter(([k]) => k.endsWith(`@${sector}`))
      .map(([k, shift]) => ({ emp: byId[k.slice(0, k.lastIndexOf("@"))], shift, key: k, offClock: false }))
      .filter((x) => x.emp && x.emp.sector !== sector),
    ...Object.entries(shifts)
      .filter(([k]) => k.endsWith(`@${sector}@fora`))
      .map(([k, shift]) => ({ emp: byId[k.slice(0, k.indexOf("@"))], shift, key: k, offClock: true }))
      .filter((x) => x.emp),
  ];
  // Operadoras do setor que trabalham hoje e podem ficar depois do turno, fora do ponto
  const offClockCandidates = members
    .filter((e) => isOperator(e) && worksOn(schedule, e, day) && !shifts[offKey(e.id)])
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const candidates = allEmployees
    .filter((e) => e.sector !== sector && e.status !== "inativo" && worksOn(schedule, e, day) && !shifts[loanKey(e.id)])
    .sort((a, b) => a.sector.localeCompare(b.sector) || a.name.localeCompare(b.name, "pt-BR"));
  // Gente deste setor ajudando em outro: nessas horas não conta aqui
  const lentOut = (emp) =>
    Object.entries(shifts)
      .filter(([k]) => k.startsWith(`${emp.id}@`) && k !== loanKey(emp.id) && !k.endsWith("@fora"))
      .map(([k, shift]) => ({ to: k.slice(k.lastIndexOf("@") + 1), shift }));
  const lentAt = (emp, h) => lentOut(emp).find((l) => coversHour(l.shift, h));
  const presentAt = (emp, h) => coversHour(shiftOf(emp), h) && !lentAt(emp, h);

  let [lo, hi] = DEFAULT_RANGE;
  if (report?.hours.length) {
    lo = Math.min(...report.hours.map((h) => h.hour));
    hi = Math.max(...report.hours.map((h) => h.hour));
  }
  for (const emp of working) {
    const shift = shiftOf(emp);
    if (!shift) continue;
    const e = shift[shift.length - 1];
    lo = Math.min(lo, Number(shift[0].slice(0, 2)));
    hi = Math.max(hi, Number(e.slice(0, 2)) - (e.endsWith(":00") ? 1 : 0));
  }
  for (const { shift } of helpers) {
    lo = Math.min(lo, Number(shift[0].slice(0, 2)));
    hi = Math.max(hi, Number(shift[1].slice(0, 2)) - (shift[1].endsWith(":00") ? 1 : 0));
  }
  const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

  const peaks = report ? peakHours(report.hours) : [];
  const clientsAt = (h) => report?.hours.find((x) => x.hour === h)?.clients || 0;
  const coverage = hours.map((h) => working.filter((e) => presentAt(e, h)).length + helpers.filter((x) => coversHour(x.shift, h)).length);
  const staffHours = coverage.reduce((s, c, i) => s + (clientsAt(hours[i]) > 0 ? c : 0), 0);
  const totalClients = hours.reduce((s, h) => s + clientsAt(h), 0);
  const avgRatio = staffHours ? totalClients / staffHours : 0;
  // Pico com equipe abaixo do necessário: ninguém escalado, ou clientes por pessoa 25% acima da média do dia
  const understaffed = (i) => {
    if (!staffHours || !peaks.includes(hours[i])) return false;
    return coverage[i] === 0 || clientsAt(hours[i]) / coverage[i] > avgRatio * 1.25;
  };
  const chartData = hours.map((h, i) => ({ hora: `${h}h`, clientes: clientsAt(h), equipe: coverage[i], peak: peaks.includes(h) }));

  const onFile = async (file) => {
    if (!file) return;
    try {
      const periods = parseHourlyReport(await readText(file));
      if (!periods.length) return toast.error("Não encontrei faixas de horário nesse arquivo. Exporte o relatório 170 como CSV ou Texto.");
      setPreview({ periods, key: periods[0].key, day: singleWeekday(periods[0]) ?? day });
    } catch (e) {
      toast.error("Não foi possível ler o arquivo.");
    } finally {
      fileRef.current.value = "";
    }
  };

  const saveReport = async (period, targetDay) => {
    setSaving(true);
    try {
      const { data } = await http.put("/hourly", { day: targetDay, label: period.label, hours: period.hours });
      setHourlyAll((all) => [...all.filter((h) => h.day !== targetDay), data]);
      setPreview(null);
      toast.success(`Movimento por horário salvo para ${DAYS[targetDay]}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const removeReport = async () => {
    try {
      await http.delete(`/hourly/${day}`);
      setHourlyAll((all) => all.filter((h) => h.day !== day));
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const saveShift = async (employee_id, times) => {
    try {
      const { data } = await http.put("/shifts", { week, day, employee_id, ...(times || {}) });
      setShifts(data.shifts);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const clashes = [];
  if (showCheckouts) {
    for (const c of checkouts) {
      const people = [
        ...working.filter((e) => isOperator(e) && assign[e.id] === c.id).map((e) => ({ id: e.id, shift: shiftOf(e) })),
        ...helpers.filter((h) => assign[h.key] === c.id).map((h) => ({ id: h.key, shift: h.shift })),
      ];
      if (people.length < 2) continue;
      let from = null;
      const names = new Set();
      for (let slot = 0; slot <= 24 * 4; slot++) {
        const h = Math.floor(slot / 4);
        const q = slot % 4;
        const busy = slot < 24 * 4 ? people.filter((x) => quarterState(x.shift, h, q) === "work") : [];
        if (busy.length > 1) {
          if (from === null) from = slot;
          busy.forEach((e) => names.add(e.id));
        } else if (from !== null) {
          clashes.push({ checkout: c.name, ids: [...names], from: fmtQuarter(Math.floor(from / 4), from % 4), to: fmtQuarter(h, q) });
          from = null;
          names.clear();
        }
      }
    }
  }
  const nameOf = (id) => working.find((e) => e.id === id)?.name || helpers.find((h) => h.key === id)?.emp.name;
  const clashOf = (id) => {
    const c = clashes.find((x) => x.ids.includes(id));
    return c && `${c.checkout}: ${c.ids.map(nameOf).join(" e ")} ao mesmo tempo (${c.from}–${c.to})`;
  };

  // Riscos de quem trabalha fora do ponto (só informativo: a decisão é do gestor)
  const offClockOn = (id, dayShifts) =>
    Object.entries(dayShifts || {})
      .filter(([k]) => k.startsWith(`${id}@`) && k.endsWith("@fora"))
      .reduce((sum, [, sh]) => sum + dayMinutes(sh), 0);
  const offClockRisks = helpers
    .filter((x) => x.offClock)
    .map(({ emp, shift }) => {
      const own = shiftOf(emp);
      const off = dayMinutes(shift);
      const total = dayMinutes(own) + off;
      const flags = [];
      if (total > 600) flags.push(`jornada de ${fmtHours(total)} no dia — passa do limite legal de 10h (art. 59)`);
      if (off > 120) flags.push(`${fmtHours(off)} além do turno — passa de 2h extras por dia`);
      if (own && own[own.length - 1] > shift[0]) flags.push(`começa antes do fim do turno (${own[own.length - 1]})`);
      if (day < 6 && worksOn(schedule, emp, day + 1)) {
        const next = isIntermittent(emp) ? null : defaultShiftOf(wlOf(emp), sectorMode, day + 1);
        if (next) {
          const rest = 24 * 60 - toMin(shift[1]) + toMin(next[0]);
          if (rest < 660) flags.push(`descanso de ${fmtHours(rest)} até a entrada de amanhã (${next[0]}) — mínimo de 11h (art. 66)`);
        }
      }
      let weekOff = 0;
      for (let d = 0; d < 7; d++) weekOff += offClockOn(emp.id, d === day ? shifts : weekAll[String(d)]);
      return { emp, off, total, flags, weekOff };
    });
  const offClockDay = offClockRisks.reduce((sum, r) => sum + r.off, 0);
  const offClockWeek = (() => {
    let sum = 0;
    for (let d = 0; d < 7; d++) {
      const dayShifts = d === day ? shifts : weekAll[String(d)];
      for (const [k, sh] of Object.entries(dayShifts || {})) if (k.endsWith(`@${sector}@fora`)) sum += dayMinutes(sh);
    }
    return sum;
  })();

  // Dentro de cada cargo, em ordem de entrada
  const byStart = (a, b) =>
    (shiftOf(a)?.[0] || "99:99").localeCompare(shiftOf(b)?.[0] || "99:99") || a.name.localeCompare(b.name, "pt-BR");

  // Frente de caixa: operadoras agrupadas por caixa (quem entra de manhã e quem assume à tarde);
  // sem caixa num grupo à parte; fiscais, pacoteiros e recepcionistas por cargo no fim
  const hasCheckout = (id) => checkouts.some((c) => c.id === assign[id]);
  const empItem = (emp) => ({ kind: "emp", id: emp.id, emp, start: shiftOf(emp)?.[0] || "99:99" });
  const helpItem = (h) => ({ kind: "help", id: h.key, ...h, start: h.shift[0] });
  const byItemStart = (a, b) => a.start.localeCompare(b.start) || a.emp.name.localeCompare(b.emp.name, "pt-BR");
  const roleGroups = (list) => groupByRole(list, byStart).map((g) => ({ role: g.role, items: g.members.map(empItem) }));
  const rowGroups = showCheckouts
    ? [
        ...checkouts
          .map((c) => ({
            role: c.name,
            items: [
              ...working.filter((e) => isOperator(e) && assign[e.id] === c.id).map(empItem),
              ...helpers.filter((h) => assign[h.key] === c.id).map(helpItem),
            ].sort(byItemStart),
          }))
          .filter((g) => g.items.length > 0),
        ...[{ role: "Sem caixa", items: working.filter((e) => isOperator(e) && !hasCheckout(e.id)).sort(byStart).map(empItem) }].filter((g) => g.items.length > 0),
        ...roleGroups(working.filter((e) => !isOperator(e))),
      ]
    : roleGroups(working);
  // Ajudas sem caixa ficam no fim, como antes
  const trailingHelpers = showCheckouts ? helpers.filter((h) => !hasCheckout(h.key)) : helpers;

  // Soma das horas do dia (funcionários do setor + ajuda de outros setores)
  const totalMinutes =
    working.reduce((sum, e) => sum + dayMinutes(shiftOf(e)), 0) + helpers.filter((x) => !x.offClock).reduce((sum, x) => sum + dayMinutes(x.shift), 0);

  const addHelper = (value) => {
    if (!value) return;
    if (value.startsWith("fora:")) {
      const emp = byId[value.slice(5)];
      const own = shiftOf(emp);
      const start = own ? toMin(own[own.length - 1]) : 18 * 60;
      const end = Math.min(start + 120, 23 * 60 + 55);
      if (end <= start) return toast.error("O turno dessa operadora termina tarde demais para incluir mais horas.");
      return saveShift(offKey(emp.id), { start: fromMin(start), break_start: null, break_end: null, end: fromMin(end) });
    }
    const id = value;
    const start = peaks.length ? Math.min(...peaks) : 11;
    const end = peaks.length ? Math.max(...peaks) + 1 : 14;
    saveShift(loanKey(id), { start: `${pad(start)}:00`, break_start: null, break_end: null, end: `${pad(Math.min(end, 23))}:00` });
  };

  const checkoutCell = (id, name) => (
    <td className="px-2">
      <select
        aria-label={`Caixa de ${name}`}
        value={checkouts.some((c) => c.id === assign[id]) ? assign[id] : ""}
        onChange={(e) => onAssign?.(id, e.target.value)}
        title={clashOf(id) || undefined}
        className={`rounded-md border px-1.5 py-1 text-xs max-w-[120px] ${
          clashOf(id) ? "border-[#DC2626] bg-[#FEF2F2] text-[#DC2626]" : assign[id] ? "border-[#0F172A] bg-white font-semibold" : "border-[#E5E1D8] bg-white text-[#8A929B]"
        }`}
      >
        <option value="">—</option>
        {checkouts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </td>
  );

  const empRow = (emp) => (
                <tr key={emp.id} className="border-t border-[#EFEBE3]">
                  <td className="py-1 pr-3 sticky left-0 bg-white z-10 min-w-[120px]">
                    <p className="font-semibold text-sm leading-tight flex items-center gap-1.5">
                      {isTrial(emp) && <span title={`Em teste (${emp.role})`} className="text-[9px] bg-[#FEF3C7] text-[#B45309] font-bold px-1.5 py-0.5 rounded">TESTE</span>}
                      {emp.name}
                      {defaultOf(emp) && shifts[emp.id] && (
                        <button onClick={() => saveShift(emp.id, null)} className="no-print text-[10px] font-semibold text-[#C2410C] hover:underline" title="Horário ajustado neste dia · clique para voltar ao horário da jornada">
                          ↺ jornada
                        </button>
                      )}
                    </p>
                    {lentOut(emp).map((l) => (
                      <p key={l.to} className="text-[10px] font-semibold text-[#B45309]">ajuda em {l.to} {l.shift[0]}–{l.shift[1]}</p>
                    ))}
                  </td>
                  <td className="px-2 no-print"><ShiftInputs shift={shifts[emp.id]} fallback={defaultOf(emp)} minutes={minutesOf(emp)} breakLen={breakFor(wlOf(emp), minutesOf(emp))} onSave={(times) => saveShift(emp.id, times)} /></td>
                  <td className="px-2 text-center font-mono-data text-xs font-semibold text-[#191C1E] whitespace-nowrap">{fmtHours(dayMinutes(shiftOf(emp)))}</td>
                  {showCheckouts && (isOperator(emp) ? checkoutCell(emp.id, emp.name) : <td />)}
                  {hours.map((h) => (
                    <td key={h} className="p-0.5">
                      <HourCell
                        shift={shiftOf(emp)}
                        h={h}
                        peak={peaks.includes(h)}
                        lentAt={(m) => lentOut(emp).find((l) => inRange(l.shift, 0, 1, m))?.to}
                      />
                    </td>
                  ))}
                </tr>
  );

  const helperRow = ({ emp, shift, key, offClock }) => (
                <tr key={key} className="border-t border-[#EFEBE3]">
                  <td className="py-1.5 pr-3 sticky left-0 bg-white z-10 min-w-[120px]">
                    <p className="font-semibold text-sm leading-tight flex items-center gap-1">
                      {emp.name}
                      <button onClick={() => { saveShift(key, null); if (assign[key]) onAssign?.(key, ""); }} className="no-print p-0.5 rounded text-[#8A929B] hover:text-[#DC2626]" aria-label={`Tirar ${emp.name} da ajuda`}>
                        <X className="h-3 w-3" />
                      </button>
                    </p>
                    {offClock ? (
                      <p className="text-[10px] font-semibold text-[#C2410C]" title="Depois do turno, sem bater ponto. Não entra no total de horas nem no mural.">
                        após o turno · fora do ponto
                        {shiftOf(emp) && shiftOf(emp)[shiftOf(emp).length - 1] > shift[0] && (
                          <span className="block text-[#DC2626]">começa antes do fim do turno ({shiftOf(emp)[shiftOf(emp).length - 1]})</span>
                        )}
                      </p>
                    ) : (
                      <p className="text-[10px] font-semibold text-[#6D28D9]">ajuda · vem de {emp.sector}</p>
                    )}
                  </td>
                  <td className="px-2 no-print"><LoanInputs shift={shift} onSave={(times) => saveShift(key, times)} /></td>
                  <td
                    className={`px-2 text-center font-mono-data text-xs font-semibold whitespace-nowrap ${offClock ? "text-[#C2410C]" : "text-[#6D28D9]"}`}
                    title={offClock ? "Fora do ponto: não entra no total" : undefined}
                  >
                    {offClock ? `(${fmtHours(dayMinutes(shift))})` : fmtHours(dayMinutes(shift))}
                  </td>
                  {showCheckouts && checkoutCell(key, emp.name)}
                  {hours.map((h) => (
                    <td key={h} className="p-0.5">
                      <HourCell shift={shift} h={h} peak={peaks.includes(h)} workColor={offClock ? "bg-[#EA580C]" : "bg-[#8B5CF6]"} />
                    </td>
                  ))}
                </tr>
  );

  return (
    <div data-testid="peak-hours-panel" className="p-3 sm:p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8A929B]">Horários de pico · {sector}</p>
          <h3 className="font-display text-2xl font-bold tracking-tight mt-1">{DAYS[day]}, {fmtDayMonth(date)}</h3>
          <p className="text-xs text-[#575E65] mt-1">
            {report ? <>Movimento da loja: <b>{report.label || "relatório importado"}</b></> : "Nenhum relatório de horários para este dia da semana."}
          </p>
        </div>
        <div className="flex gap-2 no-print">
          {report && (
            <Button size="sm" variant="ghost" onClick={removeReport} className="hover:bg-[#F2EFE8]">
              <Trash2 className="h-4 w-4 mr-1" /> Remover relatório
            </Button>
          )}
          <Button data-testid="btn-import-hourly" size="sm" onClick={() => fileRef.current.click()} className="bg-[#0F172A] hover:bg-[#1E293B] text-white">
            <FileUp className="h-4 w-4 mr-1" /> Importar relatório
          </Button>
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => onFile(e.target.files[0])} />
        </div>
      </div>

      {locked && (
        <p className="no-print text-xs text-[#B45309] bg-[#FFFBEB] border border-[#FCD34D] rounded-lg px-3 py-2">
          Este dia já passou: os horários estão bloqueados. Para alterar, desbloqueie com a senha do administrador.
        </p>
      )}

      {preview && <ImportPreview preview={preview} setPreview={setPreview} onSave={saveReport} saving={saving} />}

      {report ? (
        <div className="h-56 -ml-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid vertical={false} stroke="#EFEBE3" />
              <XAxis dataKey="hora" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#575E65" }} />
              <YAxis yAxisId="c" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8A929B" }} width={40} />
              <YAxis yAxisId="e" orientation="right" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8A929B" }} width={28} />
              <Tooltip cursor={{ fill: "#F2EFE8" }} formatter={(v, name) => (name === "clientes" ? [`${v}`, "Clientes"] : [`${v}`, `Equipe ${sector}`])} />
              <Bar yAxisId="c" dataKey="clientes" radius={[6, 6, 0, 0]}>
                {chartData.map((d) => <Cell key={d.hora} fill={d.peak ? "#DC2626" : "#CBD5E1"} />)}
              </Bar>
              <Line yAxisId="e" type="stepAfter" dataKey="equipe" stroke="#0F172A" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        !preview && (
          <div className="rounded-xl border border-dashed border-[#D1CBBF] p-6 text-center text-sm text-[#575E65]">
            <Clock className="h-6 w-6 mx-auto mb-2 text-[#8A929B]" />
            Movimento de Vendas por faixa de Horário
          </div>
        )
      )}

      {working.length === 0 && helpers.length === 0 && candidates.length === 0 && offClockCandidates.length === 0 ? (
        <p className="text-sm text-[#575E65]">Ninguém do setor {sector} trabalha neste dia.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="text-left text-xs font-semibold text-[#8A929B] uppercase tracking-wider pb-2 sticky left-0 bg-white z-10">Funcionário</th>
                <th className="text-left text-[10px] font-semibold text-[#8A929B] uppercase tracking-wider pb-2 px-2 no-print">
                  <div className="flex gap-1">
                    {["Entrada", "Saída int.", "Volta int.", "Saída"].map((t) => <span key={t} className="w-[78px]">{t}</span>)}
                  </div>
                </th>
                <th className="text-[10px] font-semibold text-[#8A929B] uppercase tracking-wider pb-2 px-2" title="Horas trabalhadas no dia (sem o intervalo)">Total</th>
                {showCheckouts && <th className="text-left text-[10px] font-semibold text-[#8A929B] uppercase tracking-wider pb-2 px-2">Caixa</th>}
                {hours.map((h) => (
                  <th key={h} className="pb-2 px-0.5 min-w-[38px]">
                    <div className={`rounded-md py-1 text-[11px] font-bold font-mono-data ${peaks.includes(h) ? "bg-[#DC2626] text-white" : "text-[#575E65]"}`}>
                      <span className="inline-flex items-center gap-0.5">{peaks.includes(h) && <Flame className="h-2.5 w-2.5" />}{pad(h)}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowGroups.flatMap((rg, gi) => [
                <tr key={`r-${gi}-${rg.role}`}>
                  <td colSpan={3 + extraCols + hours.length} className="pt-3 pb-1 sticky left-0 bg-white">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8A929B]">{rg.role}</span>
                    <span className="ml-1.5 text-[10px] text-[#B8B2A7]">{rg.items.length}</span>
                  </td>
                </tr>,
                ...rg.items.map((it) => (it.kind === "emp" ? empRow(it.emp) : helperRow(it))),
              ])}
              {trailingHelpers.map(helperRow)}
              {(candidates.length > 0 || offClockCandidates.length > 0) && (
                <tr className="no-print">
                  <td colSpan={3 + extraCols + hours.length} className="pt-2">
                    <label className="inline-flex items-center gap-1.5 text-xs text-[#6D28D9] font-semibold">
                      <UserPlus className="h-3.5 w-3.5" />
                      <select
                        data-testid="select-helper"
                        value=""
                        onChange={(e) => addHelper(e.target.value)}
                        className="rounded-md border border-[#C4B5FD] bg-[#F5F3FF] px-2 py-1 text-xs text-[#6D28D9]"
                      >
                        <option value="">Ajuda de outro setor…</option>
                        {candidates.length > 0 && (
                          <optgroup label="Outros setores">
                            {candidates.map((e) => <option key={e.id} value={e.id}>{e.sector} · {e.name}</option>)}
                          </optgroup>
                        )}
                        {offClockCandidates.length > 0 && (
                          <optgroup label="Após o turno (fora do ponto)">
                            {offClockCandidates.map((e) => (
                              <option key={e.id} value={`fora:${e.id}`}>
                                {e.name}{shiftOf(e) ? ` · saiu às ${shiftOf(e)[shiftOf(e).length - 1]}` : ""}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </label>
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="pt-3 text-xs font-bold uppercase tracking-wider sticky left-0 bg-white">Na loja</td>
                <td className="pt-3 px-2 text-center font-mono-data text-xs font-bold text-[#191C1E] whitespace-nowrap" title="Soma das horas do dia">
                  {fmtHours(totalMinutes)}
                </td>
                {showCheckouts && <td />}
                {coverage.map((c, i) => (
                  <td key={hours[i]} className={`pt-3 text-center font-mono-data text-xs font-bold ${understaffed(i) ? "text-[#DC2626]" : "text-[#191C1E]"}`}>
                    {understaffed(i) && <AlertTriangle className="h-3 w-3 mx-auto" />}
                    {c}
                  </td>
                ))}
              </tr>
              {report && (
                <tr>
                  <td colSpan={2} className="pt-1 text-[10px] text-[#8A929B] sticky left-0 bg-white">Clientes por pessoa</td>
                  <td />
                  {showCheckouts && <td />}
                  {coverage.map((c, i) => (
                    <td key={hours[i]} className="pt-1 text-center font-mono-data text-[10px] text-[#8A929B]">
                      {c && clientsAt(hours[i]) ? Math.round(clientsAt(hours[i]) / c) : "–"}
                    </td>
                  ))}
                </tr>
              )}
            </tfoot>
          </table>
          <div className="flex gap-4 text-[11px] text-[#575E65] mt-3">
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#15803D]" />No setor</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#BAE6FD]" />Intervalo</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#8B5CF6]" />Ajuda de outro setor</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#EA580C]" />Após o turno (fora do ponto)</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#FCD34D]" />Ajudando em outro setor</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#FEF2F2] border border-[#FECACA]" />Pico sem a pessoa</span>
          </div>
          {coverage.some((_, i) => understaffed(i)) && (
            <p className="text-xs text-[#DC2626] mt-3 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Horários de pico com poucos funcionários para o movimento. Ajuste os turnos.
            </p>
          )}
          {clashes.map((c) => (
            <p key={`${c.checkout}-${c.from}`} className="text-xs text-[#DC2626] mt-2 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Caixa {c.checkout}: {c.ids.map(nameOf).join(" e ")} ao mesmo tempo das {c.from} às {c.to}.
            </p>
          ))}
          {offClockRisks.length > 0 && (
            <div data-testid="offclock-risks" className="no-print mt-4 rounded-xl border border-[#FDBA74] bg-[#FFF7ED] p-4">
              <p className="text-sm font-bold text-[#9A3412] flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4" /> Riscos do fora do ponto
              </p>
              <ul className="mt-2 space-y-2">
                {offClockRisks.map((r) => (
                  <li key={r.emp.id} className="text-xs text-[#7C2D12]">
                    <span className="font-semibold">{r.emp.name}</span>: {fmtHours(r.off)} fora do ponto hoje · {fmtHours(r.total)} trabalhadas no dia · {fmtHours(r.weekOff)} fora do ponto na semana
                    {r.flags.map((f) => (
                      <span key={f} className="flex items-start gap-1 text-[#DC2626] mt-0.5">
                        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {f}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-[#9A3412] mt-3 pt-3 border-t border-[#FED7AA]">
                Passivo potencial: <b>{fmtHours(offClockDay)}</b> hoje e <b>{fmtHours(offClockWeek)}</b> na semana em {sector}. Numa ação, cada hora sai
                por no mínimo 1,5 hora de salário (adicional de 50%), mais reflexos em DSR, férias, 13º e FGTS. Fora do ponto, um acidente também não fica
                coberto como acidente de trabalho.
              </p>
            </div>
          )}
        </div>
      )}

      {away.length > 0 && (
        <p className="text-xs text-[#8A929B]">Fora neste dia (folga, férias, suspensão ou falta): {away.map((e) => e.name).join(", ")}</p>
      )}
    </div>
  );
};
