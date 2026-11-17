import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { http, errMsg, parseIso, isoDate } from "@/lib/api";

const KIND_LABEL = { nacional: "Nacional", estadual: "Estadual", municipal: "Municipal" };
const KIND_STYLE = {
  nacional: "bg-[#EEF2FF] text-[#4338CA]",
  estadual: "bg-[#F0FDFA] text-[#0F766E]",
  municipal: "bg-[#FEF3C7] text-[#B45309]",
};
const fmt = (iso) => parseIso(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");

// Feriados nacionais (automáticos) e os cadastrados (municipais/estaduais); cada um pode fechar a loja
export const HolidaysPanel = ({ onChange }) => {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ date: "", name: "", kind: "municipal", closed: false });
  const [busy, setBusy] = useState(false);
  const today = isoDate(new Date());

  const load = useCallback(() => {
    http.get("/holidays", { params: { year } }).then(({ data }) => setItems(data)).catch((e) => toast.error(errMsg(e)));
  }, [year]);
  useEffect(load, [load]);

  const save = async (h, patch, msg) => {
    try {
      await http.put("/holidays", { date: h.date, name: h.name, kind: h.kind, closed: h.closed, ...patch });
      if (msg) toast.success(msg);
      load();
      onChange?.();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const remove = async (h) => {
    if (!window.confirm(`Excluir o feriado "${h.name}" (${fmt(h.date)})?`)) return;
    try {
      await http.delete(`/holidays/${h.date}`);
      load();
      onChange?.();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const add = async (e) => {
    e.preventDefault();
    if (!form.date || !form.name.trim()) return toast.error("Informe a data e o nome do feriado.");
    setBusy(true);
    await save(form, {}, "Feriado cadastrado");
    setForm({ date: "", name: "", kind: "municipal", closed: false });
    if (form.date.slice(0, 4) !== String(year)) setYear(Number(form.date.slice(0, 4)));
    setBusy(false);
  };

  const inputCls = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

  return (
    <section data-testid="holidays-panel" className="rounded-2xl border border-[#E5E1D8] bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8A929B]">Calendário</p>
          <h3 className="font-display text-2xl font-bold tracking-tight mt-1">Feriados</h3>
        </div>
        <div className="inline-flex items-center gap-1">
          <button onClick={() => setYear(year - 1)} aria-label="Ano anterior" className="p-1.5 rounded-lg hover:bg-[#F2EFE8]"><ChevronLeft className="h-4 w-4" /></button>
          <span className="font-mono-data text-sm font-bold w-12 text-center">{year}</span>
          <button onClick={() => setYear(year + 1)} aria-label="Próximo ano" className="p-1.5 rounded-lg hover:bg-[#F2EFE8]"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      <ul className="divide-y divide-[#EFEBE3] max-h-80 overflow-y-auto">
        {items.map((h) => (
          <li key={h.date} className={`py-2 flex items-center gap-3 ${h.date < today ? "opacity-60" : ""}`}>
            <span className="font-mono-data text-xs w-24 shrink-0 text-[#575E65]">{fmt(h.date)}</span>
            <span className="text-sm font-semibold flex-1 min-w-0 truncate">{h.name}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${KIND_STYLE[h.kind]}`}>{KIND_LABEL[h.kind]}</span>
            <label className="inline-flex items-center gap-1.5 text-xs text-[#575E65] cursor-pointer select-none" title="Loja fechada: ninguém trabalha nesse dia">
              <input
                type="checkbox"
                checked={h.closed}
                onChange={(e) => save(h, { closed: e.target.checked }, e.target.checked ? `Loja fechada em ${fmt(h.date)}` : `Loja aberta em ${fmt(h.date)}`)}
              />
              Loja fecha
            </label>
            {h.kind !== "nacional" ? (
              <button onClick={() => remove(h)} aria-label={`Excluir ${h.name}`} className="p-1.5 rounded-lg text-[#8A929B] hover:bg-[#FEF2F2] hover:text-[#DC2626]">
                <Trash2 className="h-4 w-4" />
              </button>
            ) : (
              <span className="w-7" />
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="mt-4 grid grid-cols-1 sm:grid-cols-[auto_1fr_auto_auto_auto] gap-2 items-center">
        <input type="date" aria-label="Data" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} />
        <Input placeholder="Nome (ex.: Aniversário da cidade)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select aria-label="Tipo" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={inputCls}>
          <option value="municipal">Municipal</option>
          <option value="estadual">Estadual</option>
        </select>
        <label className="inline-flex items-center gap-1.5 text-xs text-[#575E65]">
          <input type="checkbox" checked={form.closed} onChange={(e) => setForm({ ...form, closed: e.target.checked })} /> Loja fecha
        </label>
        <Button type="submit" size="sm" disabled={busy} className="bg-[#0F172A] hover:bg-[#1E293B] text-white h-9">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </Button>
      </form>
      <p className="text-xs text-[#575E65] mt-3">
        Os feriados nacionais entram sozinhos. Loja fechada: ninguém trabalha e a folga da semana continua em outro dia. Loja aberta: quem trabalha fica marcado com 2× (pagamento em dobro).
      </p>
    </section>
  );
};
