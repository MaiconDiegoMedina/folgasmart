import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Clock, FileUp, Flame, Loader2, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { http, errMsg, DAYS, fmtDayMonth } from "@/lib/api";
import { isIntermittent, acceptedOn } from "@/lib/convocation";
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
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

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

const ShiftInputs = ({ shift, onSave, minutes, breakLen }) => {
  const [values, setValues] = useState(() => toFields(shift));
  useEffect(() => { setValues(toFields(shift)); }, [shift]);

  // Salva só quando o foco sai dos quatro campos
  const onBlur = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    const [start, bs, be, end] = values;
    if (values.join("|") === toFields(shift).join("|")) return;
    if (!start && !bs && !be && !end) return onSave(null);
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
            setValues((v) => {
              // Ao digitar a entrada com os demais vazios, preenche pela jornada
              if (i === 0 && !v[1] && !v[2] && !v[3]) return suggestShift(value, minutes, breakLen) || [value, "", "", ""];
              return v.map((x, j) => (j === i ? value : x));
            });
          }}
          className={`${cls} ${i === 1 || i === 2 ? "bg-[#F0F9FF]" : ""}`}
        />
      ))}
    </div>
  );
};

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

export const PeakHoursPanel = ({ day, date, sector, sectorMode = "6x1", workloads = [], members, schedule, week }) => {
  const wlOf = (emp) => workloads.find((w) => w.id === emp.workload);
  const minutesOf = (emp) => dailyMinutes(wlOf(emp), sectorMode, day);
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

  const report = hourlyAll.find((h) => h.day === day);
  const working = members.filter((e) => worksOn(schedule, e, day));
  const away = members.filter((e) => !worksOn(schedule, e, day));

  const hours = useMemo(() => {
    let [lo, hi] = DEFAULT_RANGE;
    if (report?.hours.length) {
      lo = Math.min(...report.hours.map((h) => h.hour));
      hi = Math.max(...report.hours.map((h) => h.hour));
    }
    for (const id of Object.keys(shifts)) {
      const s = shifts[id][0];
      const e = shifts[id][shifts[id].length - 1];
      lo = Math.min(lo, Number(s.slice(0, 2)));
      hi = Math.max(hi, Number(e.slice(0, 2)) - (e.endsWith(":00") ? 1 : 0));
    }
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [report, shifts]);

  const peaks = report ? peakHours(report.hours) : [];
  const clientsAt = (h) => report?.hours.find((x) => x.hour === h)?.clients || 0;
  const coverage = hours.map((h) => working.filter((e) => coversHour(shifts[e.id], h)).length);
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

      {working.length === 0 ? (
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
              {working.map((emp) => (
                <tr key={emp.id} className="border-t border-[#EFEBE3]">
                  <td className="py-1.5 pr-3 sticky left-0 bg-white z-10 min-w-[120px]">
                    <p className="font-semibold text-sm leading-tight">{emp.name}</p>
                    <p className="text-xs text-[#8A929B]">
                      {emp.role}
                      {minutesOf(emp) && <> · {fromMin(minutesOf(emp)).replace(":", "h")}</>}
                    </p>
                  </td>
                  <td className="px-2 no-print"><ShiftInputs shift={shifts[emp.id]} minutes={minutesOf(emp)} breakLen={breakFor(wlOf(emp), minutesOf(emp))} onSave={(times) => saveShift(emp.id, times)} /></td>
                  {hours.map((h) => (
                    <td key={h} className="p-0.5">
                      <div
                        title={onBreak(shifts[emp.id], h) ? "Intervalo" : undefined}
                        className={`h-8 rounded ${
                          coversHour(shifts[emp.id], h) ? "bg-[#15803D]" : onBreak(shifts[emp.id], h) ? "bg-[#BAE6FD]" : peaks.includes(h) ? "bg-[#FEF2F2]" : "bg-[#F2EFE8]"
                        }`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="pt-3 text-xs font-bold uppercase tracking-wider sticky left-0 bg-white">Na loja</td>
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
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#FEF2F2] border border-[#FECACA]" />Pico sem a pessoa</span>
          </div>
          {coverage.some((_, i) => understaffed(i)) && (
            <p className="text-xs text-[#DC2626] mt-3 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Horários de pico com poucos funcionários para o movimento. Ajuste os turnos.
            </p>
          )}
        </div>
      )}

      {away.length > 0 && (
        <p className="text-xs text-[#8A929B]">Fora neste dia (folga, férias, suspensão ou falta): {away.map((e) => e.name).join(", ")}</p>
      )}
    </div>
  );
};
