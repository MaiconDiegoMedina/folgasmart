import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageTitle } from "@/components/folga/Header";
import { http, errMsg, parseIso, isoDate, DAYS } from "@/lib/api";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEK_HEAD = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const KIND = { nacional: "nacional", estadual: "estadual", municipal: "municipal" };
const pad = (n) => String(n).padStart(2, "0");
const fmt = (iso) => parseIso(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
const wdIdx = (iso) => (parseIso(iso).getDay() + 6) % 7;
const CHIP = "inline-flex h-[26px] items-center whitespace-nowrap rounded-[13px] px-2.5 text-xs font-semibold align-middle";
const OPEN = { background: "#FFF4D1", color: "#7A5500" };
const CLOSED = { background: "#E3F5EC", color: "#1D6B45" };

// Nome curto para caber no quadradinho do calendário
const SHORT = [
  [/confraterniza/i, "Ano Novo"], [/carnaval/i, "Carnaval"], [/sexta-feira santa|paix/i, "Paixão"], [/p[aá]scoa/i, "Páscoa"],
  [/tiradentes/i, "Tiradent."], [/trabalh/i, "Trabalho"], [/corpus/i, "Corpus"], [/independ/i, "Indep."],
  [/aparecida/i, "N. Sra."], [/finados/i, "Finados"], [/rep[uú]blica/i, "Repúbl."], [/consci[eê]ncia/i, "Consc."], [/natal/i, "Natal"],
];
const shortName = (n) => SHORT.find(([re]) => re.test(n))?.[1] || (n.split(" ")[0].length > 8 ? `${n.split(" ")[0].slice(0, 7)}.` : n.split(" ")[0]);

const IconBtn = ({ label, onClick, d }) => (
  <button onClick={onClick} aria-label={label} className="grid h-[38px] w-[38px] place-items-center rounded-full border border-[#E4E0F3] bg-white text-[#3A3555] hover:border-[#17142E]">
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
  </button>
);

const Calendar = ({ y, m, byDate, today, onPrev, onNext, thisYear }) => {
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return (
    <div className="glass min-w-0 rounded-[26px] p-[22px]" style={{ flex: "1 1 380px" }}>
      <div className="mb-4 flex items-center justify-between">
        <IconBtn label="Mês anterior" onClick={onPrev} d="m15 6-6 6 6 6" />
        <h2 className="m-0 font-display text-xl font-semibold">{MONTHS[m]}{y !== thisYear ? ` ${y}` : ""}</h2>
        <IconBtn label="Próximo mês" onClick={onNext} d="m9 6 6 6-6 6" />
      </div>
      <div className="grid grid-cols-7 gap-2">
        {WEEK_HEAD.map((d) => <div key={d} className="pb-1 text-center text-xs font-semibold text-[#5E5880]">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const iso = `${y}-${pad(m + 1)}-${pad(d)}`;
          const h = byDate[iso];
          const isToday = iso === today;
          const style = h
            ? { ...(h.closed ? CLOSED : OPEN), boxShadow: `inset 0 0 0 1.5px ${h.closed ? "#8FD0AE" : "#F2CF6B"}` }
            : { background: "rgba(255,255,255,.7)", color: "#1B1830" };
          return (
            <div
              key={iso}
              title={h ? `${h.name} · ${h.closed ? "loja fechada" : "loja aberta, paga em dobro"}` : undefined}
              className="flex aspect-square min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-2xl font-display text-base font-semibold"
              style={{ ...style, ...(isToday ? { outline: "2px solid #17142E", outlineOffset: -2 } : {}) }}
            >
              {d}
              {(h || isToday) && <small className="max-w-full truncate px-0.5 font-sans text-[10px] font-semibold">{h ? shortName(h.name) : "hoje"}</small>}
            </div>
          );
        })}
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
    // Próximos feriados atravessam a virada do ano: busca também o ano seguinte
    Promise.all([year, year + 1].map((y) => http.get("/holidays", { params: { year: y } }).then(({ data }) => data)))
      .then(([a, b]) => setItems([...a, ...b]))
      .catch((e) => toast.error(errMsg(e)));
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
  const ofYear = items.filter((h) => h.date.startsWith(String(year)));
  const upcoming = items.filter((h) => h.date >= today);
  const list = all ? ofYear : upcoming.slice(0, 3);
  const field = "h-11 w-full rounded-[14px] border border-[#E4E0F3] bg-white px-3.5 text-sm font-medium text-[#1B1830]";

  return (
    <section data-testid="holidays-panel" className="flex flex-col gap-5">
      <PageTitle
        eyebrow="Nacionais entram sozinhos · municipais você cadastra"
        actions={
          <button onClick={() => document.getElementById("holiday-date")?.focus()} className="inline-flex h-11 items-center gap-2 rounded-[22px] bg-[#6D5BD0] px-[18px] text-sm font-semibold text-white hover:bg-[#5B4BC4]">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            Feriado municipal
          </button>
        }
      >
        Feriados de <em>{year}</em>
      </PageTitle>

      <div className="flex flex-wrap items-start gap-5">
        <Calendar y={cal.y} m={cal.m} byDate={byDate} today={today} thisYear={now.getFullYear()} onPrev={() => move(-1)} onNext={() => move(1)} />

        <div className="flex min-w-0 flex-col gap-3.5" style={{ flex: "2 1 520px" }}>
          <div className="glass flex flex-col gap-3 rounded-[26px] p-[22px]">
            <div className="mb-1 flex items-center justify-between gap-3">
              <h2 className="m-0 text-lg font-bold">{all ? `Feriados de ${year}` : "Próximos feriados"}</h2>
              <button onClick={() => setAll(!all)} className="text-[13px] font-semibold text-[#5B4BC4] hover:underline">
                {all ? "Só os próximos" : `Ver todos de ${year}`}
              </button>
            </div>
            {!list.length && <p className="m-0 text-sm text-[#5E5880]">{all ? `Nenhum feriado em ${year}.` : "Nenhum feriado pela frente."}</p>}
            {list.map((h) => {
              const d = parseIso(h.date);
              const tone = h.closed ? CLOSED : OPEN;
              return (
                <div key={h.date} className={`flex flex-wrap items-center gap-3.5 rounded-[20px] border border-[#EFECF8] bg-white/80 p-4 ${h.date < today ? "opacity-60" : ""}`}>
                  <div className="flex h-[58px] w-[58px] shrink-0 flex-col items-center justify-center rounded-[18px]" style={tone}>
                    <b className="font-display text-[22px] font-semibold leading-none">{pad(d.getDate())}</b>
                    <span className="text-[11px] font-semibold uppercase">{MONTHS_SHORT[d.getMonth()]}</span>
                  </div>
                  <div className="min-w-0" style={{ flex: "1 1 200px" }}>
                    <p className="m-0 font-bold">
                      {h.name} <span className={`${CHIP} ml-1.5`} style={tone}>{h.closed ? "Ok · loja fechada" : "Atenção · custo 2×"}</span>
                    </p>
                    <p className="mt-0.5 text-[13px] text-[#5E5880]">{DAYS[wdIdx(h.date)].split("-")[0]} · {KIND[h.kind]}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="inline-flex rounded-2xl bg-[#F2F0F8] p-[3px]" role="group" aria-label={`Loja em ${fmt(h.date)}`}>
                      <button
                        aria-pressed={!h.closed}
                        onClick={() => h.closed && save(h, { closed: false }, `Loja aberta em ${fmt(h.date)}`)}
                        className="h-8 rounded-[13px] px-3 text-xs font-semibold"
                        style={!h.closed ? OPEN : { color: "#4A4566" }}
                      >
                        Loja aberta · 2×
                      </button>
                      <button
                        aria-pressed={h.closed}
                        onClick={() => !h.closed && save(h, { closed: true }, `Loja fechada em ${fmt(h.date)}`)}
                        className="h-8 rounded-[13px] px-3 text-xs font-semibold"
                        style={h.closed ? { background: "#fff", color: "#1B1830", boxShadow: "0 2px 6px rgba(27,24,48,.1)" } : { color: "#4A4566" }}
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
                </div>
              );
            })}
          </div>

          <form onSubmit={add} className="glass rounded-[26px] p-[22px]">
            <h2 className="mb-3.5 text-lg font-bold">Cadastrar feriado municipal</h2>
            <div className="grid items-end gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-[#3A3555]">
                Data
                <input id="holiday-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={field} />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-[#3A3555]">
                Nome
                <input type="text" placeholder="Ex.: Aniversário da cidade" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-[#3A3555]">
                Loja
                <select value={form.closed ? "fechada" : "aberta"} onChange={(e) => setForm({ ...form, closed: e.target.value === "fechada" })} className={field}>
                  <option value="aberta">Aberta · paga em dobro</option>
                  <option value="fechada">Fechada</option>
                </select>
              </label>
              <button type="submit" disabled={busy} className="inline-flex h-11 items-center justify-center gap-2 rounded-[22px] bg-[#6D5BD0] px-[18px] text-sm font-semibold text-white hover:bg-[#5B4BC4] disabled:opacity-60">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Salvar feriado
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
};
