import { useState } from "react";
import { Plus, Trash2, Loader2, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { http, errMsg, DAYS_SHORT } from "@/lib/api";
import { dayMinutes, timesOf, times5x2Of } from "@/lib/workloadTimes";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageTitle } from "@/components/folga/Header";

const pad = (n) => String(n).padStart(2, "0");
export const fmtMinutes = (m) => (m ? `${Math.floor(m / 60)}h${m % 60 ? pad(m % 60) : ""}` : "—");

const FIELDS = ["Entrada", "Saída int.", "Volta int.", "Saída"];
const toFields = (t) => (!t ? ["", "", "", ""] : t.length === 4 ? [...t] : [t[0], "", "", t[1]]);
const fromFields = (f) => (f.some(Boolean) ? (f[1] || f[2] ? f : [f[0], f[3]]) : null);

const WEEKDAY = ["08:00", "12:00", "13:00", "17:00"];
const NEW_FORM = {
  name: "",
  days: [...Array(5).fill(WEEKDAY), ["08:00", "", "", "12:00"], ["", "", "", ""]],
  fiveTwo: ["", "", "", ""],
};

// Valida um dia do formulário; devolve a mensagem de erro ou null
const dayError = (f, label) => {
  if (!f.some(Boolean)) return null;
  const [start, bs, be, end] = f;
  if (!start || !end) return `${label}: informe a entrada e a saída.`;
  if (end <= start) return `${label}: a saída precisa ser depois da entrada.`;
  if (!!bs !== !!be) return `${label}: informe a saída e a volta do intervalo.`;
  if (bs && !(start <= bs && bs < be && be <= end)) return `${label}: o intervalo precisa ficar dentro do expediente.`;
  return null;
};

const TimeRow = ({ label, fields, onChange, extra }) => {
  const t = fromFields(fields);
  const ok = !dayError(fields, label);
  return (
    <tr className="border-t border-[#EEEBFB]">
      <td className="py-1.5 pr-3 text-xs font-semibold whitespace-nowrap">{label}</td>
      {fields.map((v, i) => (
        <td key={i} className="px-1">
          <input
            type="time"
            step={300}
            aria-label={`${FIELDS[i]} ${label}`}
            value={v}
            onChange={(e) => onChange(fields.map((x, j) => (j === i ? e.target.value : x)))}
            className={`w-[84px] rounded-md border border-[#E4E0F3] px-1 py-1 text-xs font-mono-data focus:outline-none focus:ring-2 focus:ring-[#17142E] ${i === 1 || i === 2 ? "bg-[#F0F9FF]" : "bg-white"}`}
          />
        </td>
      ))}
      <td className="px-2 text-xs font-mono-data text-[#5E5880] whitespace-nowrap">{t && ok ? fmtMinutes(dayMinutes(t)) : t ? "?" : "folga"}</td>
      <td className="pl-1">{extra}</td>
    </tr>
  );
};

const Editor = ({ initial, onCancel, onSaved }) => {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const setDay = (i, f) => setForm({ ...form, days: form.days.map((x, j) => (j === i ? f : x)) });
  const copyMonday = () => setForm({ ...form, days: form.days.map((x, j) => (j > 0 && j < 6 && x.some(Boolean) ? [...form.days[0]] : x)) });

  const total = form.days.reduce((s, f) => s + (dayError(f, "") ? 0 : dayMinutes(fromFields(f))), 0);

  const save = async () => {
    if (!form.name.trim()) return toast.error("Dê um nome para a jornada.");
    const err = form.days.map((f, i) => dayError(f, DAYS_SHORT[i])).find(Boolean) || dayError(form.fiveTwo, "No 5x2");
    if (err) return toast.error(err);
    setBusy(true);
    try {
      const body = { name: form.name.trim(), times: form.days.map(fromFields), times_5x2: fromFields(form.fiveTwo) };
      if (form.id) await http.put(`/workloads/${form.id}`, body);
      else await http.post("/workloads", body);
      toast.success(form.id ? "Jornada atualizada" : "Jornada cadastrada");
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="workload-editor" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Nome da jornada (ex.: 8h seg–sex + 4h sáb)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-9 max-w-sm bg-white" />
        <span className="text-xs text-[#5E5880]">Total na semana: <b className="font-mono-data">{fmtMinutes(total)}</b></span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[#8A85A3]">
              <th />
              {FIELDS.map((f) => <th key={f} className="text-left font-semibold pb-1 px-1">{f}</th>)}
              <th className="text-left font-semibold pb-1 px-2">Horas</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {form.days.map((f, i) => (
              <TimeRow
                key={i}
                label={DAYS_SHORT[i]}
                fields={f}
                onChange={(v) => setDay(i, v)}
                extra={i === 0 && (
                  <button type="button" onClick={copyMonday} title="Copiar o horário de segunda para terça a sexta" className="p-1.5 rounded-lg text-[#8A85A3] hover:bg-white hover:text-[#17142E]">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                )}
              />
            ))}
            <TimeRow label="No 5x2" fields={form.fiveTwo} onChange={(v) => setForm({ ...form, fiveTwo: v })} />
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[#5E5880]">
        Use os horários do cartão ponto. Deixe o dia em branco quando não há trabalho nele. "No 5x2" é o horário de cada dia trabalhado quando o setor está em 5x2.
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" disabled={busy} onClick={save} className="bg-[#17142E] hover:bg-[#2A2550] text-white">
          {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar jornada
        </Button>
      </div>
    </div>
  );
};

const T_START = 5 * 60;
const T_END = 23 * 60;
const T_SPAN = T_END - T_START;
const tPct = (m) => `${(((Math.min(Math.max(m, T_START), T_END) - T_START) / T_SPAN) * 100).toFixed(2)}%`;
const tWidth = (a, b) => `${(((Math.min(b, T_END) - Math.max(a, T_START)) / T_SPAN) * 100).toFixed(2)}%`;
const toM = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const DAY_NAMES = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

// Junta dias seguidos com o mesmo horário: "Seg a Sex", "Sábado"
const groupDays = (times) => {
  const groups = [];
  times.forEach((t, d) => {
    const key = JSON.stringify(t || null);
    const last = groups[groups.length - 1];
    if (last && last.key === key && last.to === d - 1) last.to = d;
    else groups.push({ key, t, from: d, to: d });
  });
  return groups
    .filter((g) => g.t)
    .map((g) => ({ ...g, label: g.from === g.to ? DAY_NAMES[g.from] : `${DAYS_SHORT[g.from]} a ${DAYS_SHORT[g.to]}` }));
};

const Timeline = ({ t }) => {
  const [a, b] = [toM(t[0]), toM(t[t.length - 1])];
  const brk = t.length === 4 ? [toM(t[1]), toM(t[2])] : null;
  const seg = (x, y, label) => (
    <div className="absolute top-1 bottom-1 grid place-items-center overflow-hidden whitespace-nowrap rounded-lg bg-[#6D5BD0] text-[11px] font-bold text-white" style={{ left: tPct(x), width: `calc(${tWidth(x, y)} - 2px)` }}>
      {label}
    </div>
  );
  return (
    <div className="relative h-[34px] rounded-xl bg-[#F2F0F8]">
      {brk ? (
        <>
          {seg(a, brk[0], `${t[0]} – ${t[1]}`)}
          <div
            title={`Intervalo ${t[1]}–${t[2]}`}
            className="absolute top-1 bottom-1 grid place-items-center overflow-hidden whitespace-nowrap rounded-lg text-[11px] font-semibold text-[#4B3DA8]"
            style={{ left: tPct(brk[0]), width: tWidth(brk[0], brk[1]), background: "repeating-linear-gradient(135deg,rgba(124,106,224,.22) 0 4px,rgba(124,106,224,.08) 4px 8px)" }}
          >
            {brk[1] - brk[0] >= 90 ? "intervalo" : ""}
          </div>
          {seg(brk[1], b, `${t[2]} – ${t[3]}`)}
        </>
      ) : (
        seg(a, b, `${t[0]} – ${t[1]}`)
      )}
    </div>
  );
};

const HOURS_AXIS = [5, 8, 11, 14, 17, 20, 23];
const LIMIT = 44 * 60;
const WEEK_CHIP = { ok: "bg-[#E3F5EC] text-[#1D6B45]", warn: "bg-[#FFF4D1] text-[#7A5500]", risk: "bg-[#FDE2E2] text-[#A12828]" };

export const WorkloadsPanel = ({ workloads, employees = [], onChange }) => {
  const [editing, setEditing] = useState(null);

  const edit = (w) =>
    setEditing({ id: w.id, name: w.name, days: timesOf(w).map(toFields), fiveTwo: toFields(times5x2Of(w)) });

  const remove = async (w) => {
    if (!window.confirm(`Excluir a jornada "${w.name}"? Quem usa essa jornada ficará sem jornada definida.`)) return;
    try {
      await http.delete(`/workloads/${w.id}`);
      setEditing(null);
      onChange();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const people = (w) => employees.filter((e) => e.workload === w.id && e.status !== "inativo").length;
  const editingW = editing?.id && workloads.find((w) => w.id === editing.id);

  return (
    <section data-testid="workloads-panel" className="space-y-5">
      <PageTitle
        eyebrow={`Horários do ponto · ${workloads.length} ${workloads.length === 1 ? "jornada cadastrada" : "jornadas cadastradas"}`}
        actions={
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-[#4A4566]"><i className="h-3 w-3 rounded bg-[#6D5BD0]" />Trabalho</span>
            <span className="inline-flex items-center gap-1.5 text-xs text-[#4A4566]"><i className="h-3 w-3 rounded bg-[#E6E1FA]" />Intervalo</span>
            <Button onClick={() => setEditing({ ...NEW_FORM })} className="h-11 rounded-full bg-[#6D5BD0] px-[18px] text-white hover:bg-[#5B4BC4]">
              <Plus className="mr-2 h-4 w-4" /> Nova jornada
            </Button>
          </>
        }
      >
        Jornadas de <em>trabalho</em>
      </PageTitle>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {workloads.map((w) => {
          const total = w.minutes.reduce((s, m) => s + m, 0);
          const groups = w.times ? groupDays(w.times) : [];
          const five = w.times_5x2;
          const wide = groups.length + (five ? 1 : 0) > 1;
          const n = people(w);
          return (
            <article key={w.id} className={`glass rounded-[26px] p-5 sm:p-6 ${wide ? "xl:col-span-2" : ""}`}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-bold">{w.name}</h3>
                <div className="flex flex-wrap items-center gap-2">
                  {total > 0 && (() => {
                    // Semana no 6x1: uma folga por semana, que pode cair em qualquer dia com horário
                    const on = w.minutes.filter((m) => m > 0);
                    const lo = total - Math.max(...on);
                    const hi = on.length < 7 ? total : total - Math.min(...on);
                    const lvl = hi <= LIMIT ? "ok" : lo <= LIMIT ? "warn" : "risk";
                    const txt = lo === hi ? fmtMinutes(lo) : `${fmtMinutes(lo)} a ${fmtMinutes(hi)}`;
                    return (
                      <span title="Horas na semana com uma folga (6x1). Varia conforme o dia da folga." className={`rounded-full px-2.5 py-1 text-xs font-semibold ${WEEK_CHIP[lvl]}`}>
                        {txt} · {lvl === "ok" ? "dentro do limite" : lvl === "warn" ? "passa de 44h conforme a folga" : "acima de 44h"}
                      </span>
                    );
                  })()}
                  {w.minutes_5x2 > 0 && (
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${w.minutes_5x2 * 5 <= LIMIT ? WEEK_CHIP.ok : WEEK_CHIP.risk}`}>No 5×2 · {fmtMinutes(w.minutes_5x2 * 5)}</span>
                  )}
                  <span className="rounded-full bg-[#F2F0F8] px-2.5 py-1 text-xs font-semibold text-[#4A4566]">{n} {n === 1 ? "pessoa" : "pessoas"}</span>
                  <button onClick={() => edit(w)} aria-label={`Editar ${w.name}`} className="h-9 rounded-full border border-[#E4E0F3] bg-white px-4 text-sm font-semibold hover:border-[#17142E]">Editar</button>
                </div>
              </div>
              {!w.times ? (
                <p className="rounded-xl border border-dashed border-[#F2CF6B] bg-[#FFF9E6] px-4 py-3 text-sm text-[#7A5500]">
                  Sem horário do ponto: {DAYS_SHORT.map((d, i) => `${d} ${fmtMinutes(w.minutes[i])}`).join(" · ")}. Clique em Editar para preencher os horários.
                </p>
              ) : (
                <div className="space-y-2">
                  {wide && (
                    <div className="grid grid-cols-[110px_1fr] gap-3">
                      <span />
                      <div className="relative h-4 font-mono-data text-[11px] text-[#5E5880]">
                        {HOURS_AXIS.map((h) => (
                          <span key={h} className="absolute -translate-x-1/2" style={{ left: tPct(h * 60) }}>{h}h</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {groups.map((g) => (
                    <div key={`${g.from}-${g.to}`} className="grid grid-cols-[110px_1fr] items-center gap-3">
                      <span className="text-sm font-semibold text-[#3A3555]">{g.label}</span>
                      <Timeline t={g.t} />
                    </div>
                  ))}
                  {five && (
                    <div className="grid grid-cols-[110px_1fr] items-center gap-3">
                      <span className="text-sm font-semibold text-[#3A3555]" title="Horário de cada dia trabalhado quando o setor está em 5x2">No 5×2</span>
                      <Timeline t={five} />
                    </div>
                  )}
                  {groups.length === 0 && <p className="text-sm text-[#5E5880]">Nenhum dia com horário.</p>}
                </div>
              )}
            </article>
          );
        })}
        <button
          onClick={() => setEditing({ ...NEW_FORM })}
          className="flex min-h-[170px] flex-col items-center justify-center gap-1 rounded-[26px] border-2 border-dashed border-[#C9BFFF] bg-white/40 p-6 text-center hover:bg-white/70"
        >
          <Plus className="h-6 w-6 text-[#4B3DA8]" />
          <span className="text-base font-bold text-[#4B3DA8]">Cadastrar nova jornada</span>
          <span className="text-[13px] text-[#5E5880]">Entrada, intervalo e saída de cada dia</span>
        </button>
      </div>
      <p className="text-xs text-[#5E5880]">
        Os efetivos já entram na sub-aba de horários com o horário da sua jornada. Ajustes feitos lá valem só para aquele dia.
      </p>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle>{editing?.id ? `Editar ${editing.name}` : "Nova jornada"}</DialogTitle>
            <DialogDescription>Use os horários do cartão ponto.</DialogDescription>
          </DialogHeader>
          {editing && <Editor key={editing.id || "new"} initial={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); onChange(); }} />}
          {editingW && (
            <button onClick={() => remove(editingW)} className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-[#A12828] hover:underline">
              <Trash2 className="h-4 w-4" /> Excluir esta jornada
            </button>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
};
