import { useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { http, errMsg, DAYS_SHORT } from "@/lib/api";

const pad = (n) => String(n).padStart(2, "0");
export const fmtMinutes = (m) => (m ? `${Math.floor(m / 60)}h${m % 60 ? pad(m % 60) : ""}` : "—");
const toMinutes = (t) => (/^\d{2}:\d{2}$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : 0);

const EMPTY = { name: "", days: ["08:00", "08:00", "08:00", "08:00", "08:00", "04:00", ""], breakMinutes: "60", fiveTwo: "" };

export const WorkloadsPanel = ({ workloads, onChange }) => {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Dê um nome para a jornada.");
    setBusy(true);
    try {
      await http.post("/workloads", {
        name: form.name.trim(),
        minutes: form.days.map(toMinutes),
        break_minutes: Number(form.breakMinutes) || 0,
        minutes_5x2: form.fiveTwo ? toMinutes(form.fiveTwo) : null,
      });
      toast.success("Jornada cadastrada");
      setForm(EMPTY);
      onChange();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (w) => {
    if (!window.confirm(`Excluir a jornada "${w.name}"? Quem usa essa jornada ficará sem jornada definida.`)) return;
    try {
      await http.delete(`/workloads/${w.id}`);
      onChange();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const timeCls = "w-full rounded-md border border-[#E5E1D8] bg-white px-1 py-1 text-xs font-mono-data focus:outline-none focus:ring-2 focus:ring-[#0F172A]";

  return (
    <section data-testid="workloads-panel" className="rounded-2xl border border-[#E5E1D8] bg-white p-5 sm:p-6">
      <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8A929B]">Jornadas</p>
      <h3 className="font-display text-2xl font-bold tracking-tight mt-1 mb-4">Horas de trabalho por dia</h3>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-[#8A929B]">
              <th className="text-left font-semibold pb-2 pr-3">Jornada</th>
              {DAYS_SHORT.map((d) => <th key={d} className="font-semibold pb-2 px-1 min-w-[64px]">{d}</th>)}
              <th className="font-semibold pb-2 px-1">Intervalo</th>
              <th className="font-semibold pb-2 px-1" title="Horas por dia quando o setor está em 5x2">No 5x2</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {workloads.map((w) => (
              <tr key={w.id} className="border-t border-[#EFEBE3]">
                <td className="py-2 pr-3 font-semibold">{w.name}</td>
                {w.minutes.map((m, i) => <td key={i} className="text-center font-mono-data text-xs">{fmtMinutes(m)}</td>)}
                <td className="text-center font-mono-data text-xs">{w.break_minutes} min</td>
                <td className="text-center font-mono-data text-xs">{w.minutes_5x2 ? fmtMinutes(w.minutes_5x2) : "—"}</td>
                <td className="text-right">
                  <button onClick={() => remove(w)} className="p-1.5 rounded-lg text-[#8A929B] hover:bg-[#FEF2F2] hover:text-[#DC2626]" aria-label={`Excluir ${w.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-[#E5E1D8]">
              <td className="py-2 pr-3">
                <Input placeholder="Nova jornada" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-8 text-xs" />
              </td>
              {form.days.map((t, i) => (
                <td key={i} className="px-1">
                  <input
                    type="time"
                    aria-label={`Horas ${DAYS_SHORT[i]}`}
                    value={t}
                    onChange={(e) => setForm({ ...form, days: form.days.map((x, j) => (j === i ? e.target.value : x)) })}
                    className={timeCls}
                  />
                </td>
              ))}
              <td className="px-1">
                <select value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })} className={timeCls}>
                  {["0", "15", "30", "60", "90", "120"].map((m) => <option key={m} value={m}>{m} min</option>)}
                </select>
              </td>
              <td className="px-1">
                <input type="time" aria-label="Horas por dia no 5x2" value={form.fiveTwo} onChange={(e) => setForm({ ...form, fiveTwo: e.target.value })} className={timeCls} />
              </td>
              <td className="pl-1">
                <Button size="sm" disabled={busy} onClick={submit} className="bg-[#0F172A] hover:bg-[#1E293B] text-white h-8">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[#575E65] mt-3">
        Deixe o dia vazio quando a jornada não prevê trabalho nele. O intervalo é aplicado nos dias com mais de 6h (até 6h, 15 min; até 4h, sem intervalo).
        "No 5x2" é a jornada diária usada quando o setor está em 5x2.
      </p>
    </section>
  );
};
