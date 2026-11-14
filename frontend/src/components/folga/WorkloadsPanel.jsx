import { useState } from "react";
import { Plus, Trash2, Loader2, Pencil, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { http, errMsg, DAYS_SHORT } from "@/lib/api";
import { dayMinutes, timesOf, times5x2Of } from "@/lib/workloadTimes";

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
    <tr className="border-t border-[#EFEBE3]">
      <td className="py-1.5 pr-3 text-xs font-semibold whitespace-nowrap">{label}</td>
      {fields.map((v, i) => (
        <td key={i} className="px-1">
          <input
            type="time"
            step={300}
            aria-label={`${FIELDS[i]} ${label}`}
            value={v}
            onChange={(e) => onChange(fields.map((x, j) => (j === i ? e.target.value : x)))}
            className={`w-[84px] rounded-md border border-[#E5E1D8] px-1 py-1 text-xs font-mono-data focus:outline-none focus:ring-2 focus:ring-[#0F172A] ${i === 1 || i === 2 ? "bg-[#F0F9FF]" : "bg-white"}`}
          />
        </td>
      ))}
      <td className="px-2 text-xs font-mono-data text-[#575E65] whitespace-nowrap">{t && ok ? fmtMinutes(dayMinutes(t)) : t ? "?" : "folga"}</td>
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
    <div data-testid="workload-editor" className="rounded-xl border border-[#E5E1D8] bg-[#F9F8F5] p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Nome da jornada (ex.: 8h seg–sex + 4h sáb)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-9 max-w-sm bg-white" />
        <span className="text-xs text-[#575E65]">Total na semana: <b className="font-mono-data">{fmtMinutes(total)}</b></span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[#8A929B]">
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
                  <button type="button" onClick={copyMonday} title="Copiar o horário de segunda para terça a sexta" className="p-1.5 rounded-lg text-[#8A929B] hover:bg-white hover:text-[#0F172A]">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                )}
              />
            ))}
            <TimeRow label="No 5x2" fields={form.fiveTwo} onChange={(v) => setForm({ ...form, fiveTwo: v })} />
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[#575E65]">
        Use os horários do cartão ponto. Deixe o dia em branco quando não há trabalho nele. "No 5x2" é o horário de cada dia trabalhado quando o setor está em 5x2.
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" disabled={busy} onClick={save} className="bg-[#0F172A] hover:bg-[#1E293B] text-white">
          {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar jornada
        </Button>
      </div>
    </div>
  );
};

const Span = ({ t }) =>
  !t ? (
    <span className="text-[#B8B2A7]">—</span>
  ) : (
    <>
      <span className="block">{t[0]}–{t[t.length - 1]}</span>
      {t.length === 4 && <span className="block text-[10px] text-[#0369A1]">int. {t[1]}–{t[2]}</span>}
    </>
  );

export const WorkloadsPanel = ({ workloads, onChange }) => {
  const [editing, setEditing] = useState(null);

  const edit = (w) =>
    setEditing({ id: w.id, name: w.name, days: timesOf(w).map(toFields), fiveTwo: toFields(times5x2Of(w)) });

  const remove = async (w) => {
    if (!window.confirm(`Excluir a jornada "${w.name}"? Quem usa essa jornada ficará sem jornada definida.`)) return;
    try {
      await http.delete(`/workloads/${w.id}`);
      onChange();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <section data-testid="workloads-panel" className="rounded-2xl border border-[#E5E1D8] bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8A929B]">Jornadas</p>
          <h3 className="font-display text-2xl font-bold tracking-tight mt-1">Horários do ponto</h3>
        </div>
        {!editing && (
          <Button size="sm" onClick={() => setEditing({ ...NEW_FORM })} className="bg-[#0F172A] hover:bg-[#1E293B] text-white">
            <Plus className="h-4 w-4 mr-1" /> Nova jornada
          </Button>
        )}
      </div>

      {editing && (
        <div className="mb-4">
          <Editor key={editing.id || "new"} initial={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); onChange(); }} />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-[#8A929B]">
              <th className="text-left font-semibold pb-2 pr-3">Jornada</th>
              {DAYS_SHORT.map((d) => <th key={d} className="font-semibold pb-2 px-1 min-w-[84px]">{d}</th>)}
              <th className="font-semibold pb-2 px-1" title="Horário de cada dia trabalhado quando o setor está em 5x2">No 5x2</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {workloads.map((w) => (
              <tr key={w.id} className="border-t border-[#EFEBE3] align-top">
                <td className="py-2 pr-3">
                  <p className="font-semibold">{w.name}</p>
                  <p className="text-[11px] text-[#8A929B]">{fmtMinutes(w.minutes.reduce((s, m) => s + m, 0))} na semana</p>
                  {!w.times && <p className="text-[11px] text-[#C2410C]">Sem horário do ponto — edite para preencher a sub-aba</p>}
                </td>
                {w.times
                  ? w.times.map((t, i) => <td key={i} className="py-2 text-center font-mono-data text-xs"><Span t={t} /></td>)
                  : w.minutes.map((m, i) => <td key={i} className="py-2 text-center font-mono-data text-xs text-[#8A929B]">{fmtMinutes(m)}</td>)}
                <td className="py-2 text-center font-mono-data text-xs">
                  {w.times_5x2 ? <Span t={w.times_5x2} /> : w.minutes_5x2 ? <span className="text-[#8A929B]">{fmtMinutes(w.minutes_5x2)}</span> : "—"}
                </td>
                <td className="py-1 text-right whitespace-nowrap">
                  <button onClick={() => edit(w)} className="p-1.5 rounded-lg text-[#8A929B] hover:bg-[#F2EFE8] hover:text-[#0F172A]" aria-label={`Editar ${w.name}`}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => remove(w)} className="p-1.5 rounded-lg text-[#8A929B] hover:bg-[#FEF2F2] hover:text-[#DC2626]" aria-label={`Excluir ${w.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[#575E65] mt-3">
        Os efetivos já entram na sub-aba de horários com o horário da sua jornada. Ajustes feitos lá valem só para aquele dia.
      </p>
    </section>
  );
};
