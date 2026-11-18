import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageTitle } from "@/components/folga/Header";
import { http, errMsg, parseIso, isoDate } from "@/lib/api";

const KIND_LABEL = { nacional: "Nacional", estadual: "Estadual", municipal: "Municipal" };
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEK_HEAD = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const fmt = (iso) => parseIso(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
const weekday = (iso) => { const w = parseIso(iso).toLocaleDateString("pt-BR", { weekday: "long" }); return w[0].toUpperCase() + w.slice(1); };
const pad = (n) => String(n).padStart(2, "0");
const shortName = (n) => (n.length > 12 ? `${n.slice(0, 11)}…` : n);

const Calendar = ({ y, m, byDate, today, onPrev, onNext }) => {
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return (
    <div className="glass rounded-[26px] p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold">{MONTHS[m]} {y}</h3>
        <div className="flex gap-1">
          <button onClick={onPrev} aria-label="Mês anterior" className="grid h-9 w-9 place-items-center rounded-full border border-[#E4E0F3] bg-white hover:border-[#17142E]"><ChevronLeft className="h-4 w-4" /></button>
          <button onClick={onNext} aria-label="Próximo mês" className="grid h-9 w-9 place-items-center rounded-full border border-[#E4E0F3] bg-white hover:border-[#17142E]"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-center">
        {WEEK_HEAD.map((d) => (
          <span key={d} className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#8A85A3]">{d}</span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const iso = `${y}-${pad(m + 1)}-${pad(d)}`;
          const h = byDate[iso];
          const isToday = iso === today;
          return (
            <div
              key={iso}
              title={h ? `${h.name} · ${h.closed ? "loja fechada" : "loja aberta, paga em dobro"}` : undefined}
              className={`flex min-h-[54px] flex-col items-center justify-start rounded-xl px-0.5 py-1.5 ${
                h ? (h.closed ? "bg-[#F2F0F8] text-[#4A4566]" : "bg-[#FFF4D1] text-[#7A5500]") : "bg-white/50"
              } ${isToday ? "ring-2 ring-[#6D5BD0]" : ""}`}
            >
              <span className={`font-mono-data text-sm ${h || isToday ? "font-bold" : ""} ${isToday && !h ? "text-[#5B4BC4]" : ""}`}>{d}</span>
              {h && <span className="mt-0.5 w-full truncate text-[9.5px] font-semibold leading-tight">{shortName(h.name)}</span>}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-xs text-[#4A4566]">
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-[#FFF4D1] ring-1 ring-[#F2CF6B]" />Loja aberta · 2×</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-[#F2F0F8] ring-1 ring-[#D6D0EE]" />Loja fechada</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded ring-2 ring-[#6D5BD0]" />Hoje</span>
      </div>
    </div>
  );
};

// Feriados nacionais (automáticos) e os cadastrados (municipais/estaduais); cada um pode fechar a loja
export const HolidaysPanel = ({ onChange }) => {
  const now = new Date();
  const [cal, setCal] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const year = cal.y;
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ date: "", name: "", kind: "municipal", closed: false });
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const today = isoDate(now);

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
      return true;
    } catch (e) {
      toast.error(errMsg(e));
      return false;
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
    const ok = await save(form, {}, "Feriado cadastrado");
    if (ok) {
      const d = parseIso(form.date);
      setCal({ y: d.getFullYear(), m: d.getMonth() });
      setForm({ date: "", name: "", kind: "municipal", closed: false });
    }
    setBusy(false);
  };

  const move = (delta) => setCal(({ y, m }) => {
    const d = new Date(y, m + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const byDate = Object.fromEntries(items.map((h) => [h.date, h]));
  const upcoming = items.filter((h) => h.date >= today);
  const list = all || !upcoming.length ? items : upcoming.slice(0, 6);
  const inputCls = "h-11 w-full rounded-xl border border-[#E4E0F3] bg-white px-3 text-sm";

  return (
    <section data-testid="holidays-panel" className="space-y-5">
      <PageTitle
        eyebrow="Nacionais entram sozinhos · municipais você cadastra"
        actions={
          <Button onClick={() => document.getElementById("holiday-date")?.focus()} className="h-11 rounded-full bg-[#6D5BD0] px-[18px] text-white hover:bg-[#5B4BC4]">
            <Plus className="mr-2 h-4 w-4" /> Feriado municipal
          </Button>
        }
      >
        Feriados de <em>{year}</em>
      </PageTitle>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1fr]">
        <Calendar y={cal.y} m={cal.m} byDate={byDate} today={today} onPrev={() => move(-1)} onNext={() => move(1)} />

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold">{all || !upcoming.length ? `Todos os feriados de ${year}` : "Próximos feriados"}</h3>
            {upcoming.length > 0 && (
              <button onClick={() => setAll(!all)} className="text-sm font-semibold text-[#5B4BC4] hover:underline">
                {all ? "Só os próximos" : `Ver todos (${items.length})`}
              </button>
            )}
          </div>
          {!items.length && <p className="text-sm text-[#5E5880]">Nenhum feriado em {year}.</p>}
          <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
            {list.map((h) => {
              const d = parseIso(h.date);
              const past = h.date < today;
              return (
                <article key={h.date} className={`glass flex flex-wrap items-center gap-4 rounded-[22px] p-4 ${past ? "opacity-60" : ""}`}>
                  <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-center leading-none ${h.closed ? "bg-[#F2F0F8] text-[#4A4566]" : "bg-[#FFF4D1] text-[#7A5500]"}`}>
                    <div>
                      <p className="font-display text-xl font-bold">{pad(d.getDate())}</p>
                      <p className="text-[11px] font-semibold uppercase">{MONTHS_SHORT[d.getMonth()]}</p>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{h.name}</p>
                    <p className="text-xs text-[#5E5880]">{weekday(h.date)} · {KIND_LABEL[h.kind]}</p>
                    <span className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${h.closed ? "bg-[#E3F5EC] text-[#1D6B45]" : "bg-[#FFF4D1] text-[#7A5500]"}`}>
                      {h.closed ? "Ok · loja fechada" : "Atenção · custo 2×"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="inline-flex rounded-full bg-[#F2F0F8] p-1 text-xs font-semibold" role="group" aria-label={`Loja em ${h.name}`}>
                      <button
                        aria-pressed={!h.closed}
                        onClick={() => h.closed && save(h, { closed: false }, `Loja aberta em ${fmt(h.date)}`)}
                        className={`rounded-full px-3 py-1.5 ${!h.closed ? "bg-white text-[#7A5500] shadow-sm" : "text-[#5E5880]"}`}
                      >
                        Loja aberta · 2×
                      </button>
                      <button
                        aria-pressed={h.closed}
                        onClick={() => !h.closed && save(h, { closed: true }, `Loja fechada em ${fmt(h.date)}`)}
                        className={`rounded-full px-3 py-1.5 ${h.closed ? "bg-white text-[#1B1830] shadow-sm" : "text-[#5E5880]"}`}
                      >
                        Loja fechada
                      </button>
                    </div>
                    {h.kind !== "nacional" && (
                      <button onClick={() => remove(h)} aria-label={`Excluir ${h.name}`} className="rounded-full p-2 text-[#8A85A3] hover:bg-[#FDE2E2] hover:text-[#A12828]">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>

      <form onSubmit={add} className="glass rounded-[26px] p-5 sm:p-6">
        <h3 className="mb-4 text-base font-bold">Cadastrar feriado municipal</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[180px_1fr_170px_230px_auto] xl:items-end">
          <label className="space-y-1.5 text-xs font-semibold text-[#5E5880]">
            Data
            <input id="holiday-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} />
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-[#5E5880]">
            Nome
            <Input placeholder="Ex.: Aniversário da cidade" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-11 rounded-xl border-[#E4E0F3] bg-white" />
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-[#5E5880]">
            Tipo
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={inputCls}>
              <option value="municipal">Municipal</option>
              <option value="estadual">Estadual</option>
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-[#5E5880]">
            Loja
            <select value={form.closed ? "fechada" : "aberta"} onChange={(e) => setForm({ ...form, closed: e.target.value === "fechada" })} className={inputCls}>
              <option value="aberta">Aberta · paga em dobro</option>
              <option value="fechada">Fechada</option>
            </select>
          </label>
          <Button type="submit" disabled={busy} className="h-11 rounded-full bg-[#6D5BD0] px-5 text-white hover:bg-[#5B4BC4]">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar feriado
          </Button>
        </div>
        <p className="mt-3 text-xs text-[#5E5880]">
          Loja fechada: ninguém trabalha e a folga da semana continua em outro dia. Loja aberta: quem trabalha fica marcado com 2× (pagamento em dobro).
        </p>
      </form>
    </section>
  );
};
