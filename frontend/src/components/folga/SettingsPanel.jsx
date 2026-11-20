import { useCallback, useEffect, useState } from "react";
import { Check, Clock, Flag, Layers, Loader2, Lock, LockOpen, Pencil, Plus, Repeat, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { PageTitle } from "@/components/folga/Header";
import { useUnlock, openUnlock } from "@/components/folga/UnlockDialog";
import { http, errMsg, isoDate, mondayOf, addDays, parseIso } from "@/lib/api";
import { modeLabel, modelDesc, setScaleModels, fmtHours } from "@/lib/scaleModels";

export const SETTINGS_SECTIONS = [
  { id: "setores", label: "Setores", icon: Layers },
  { id: "escalas", label: "Escalas", icon: Repeat },
  { id: "jornadas", label: "Jornadas", icon: Clock },
  { id: "feriados", label: "Feriados", icon: Flag },
];

const CARD = "glass rounded-[26px] p-[22px]";
const INPUT = "h-10 rounded-xl border border-[#E4E0F3] bg-white px-3 text-sm outline-none focus:border-[#17142E]";
const BTN = "inline-flex h-10 items-center gap-1.5 rounded-full bg-[#17142E] px-4 text-sm font-semibold text-white hover:bg-[#2A2550] disabled:opacity-50";
const ICON_BTN = "grid h-9 w-9 place-items-center rounded-full border border-[#E4E0F3] bg-white text-[#5E5880] hover:border-[#17142E] hover:text-[#17142E]";
const fmtDate = (iso) => parseIso(iso).toLocaleDateString("pt-BR");

// Faixa do administrador: mostra se as alterações estão liberadas
const AdminBar = () => {
  const until = useUnlock();
  return until ? (
    <p className="flex items-center gap-2 rounded-2xl bg-[#E3F5EC] px-4 py-2.5 text-sm text-[#1D6B45]">
      <LockOpen className="h-4 w-4" /> Alterações liberadas até {new Date(until).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.
    </p>
  ) : (
    <p className="flex flex-wrap items-center gap-2 rounded-2xl bg-[#FFF4D1] px-4 py-2.5 text-sm text-[#7A5500]">
      <Lock className="h-4 w-4" /> Só o administrador altera as configurações.
      <button onClick={openUnlock} className="font-semibold underline underline-offset-2">Informar a senha do administrador</button>
    </p>
  );
};

// ---------- Setores ----------
const SectorsSection = ({ sectors, onChange }) => {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);

  const run = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      onChange();
      return true;
    } catch (err) {
      toast.error(errMsg(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (await run(() => http.post("/sectors", { name: name.trim() }), `Setor ${name.trim()} cadastrado`)) setName("");
  };
  const rename = async () => {
    if (!editing.name.trim()) return;
    if (await run(() => http.put(`/sectors/${editing.id}`, { name: editing.name.trim() }), "Setor renomeado. Os funcionários dele foram atualizados.")) setEditing(null);
  };

  return (
    <>
      <PageTitle eyebrow="Configurações · a lista usada no cadastro de funcionários">Setores</PageTitle>
      <div className={CARD}>
        <form onSubmit={add} className="mb-4 flex flex-wrap gap-2">
          <input data-testid="input-sector-name" className={`${INPUT} min-w-[220px] flex-1`} placeholder="Nome do setor (ex.: Padaria)" value={name} onChange={(e) => setName(e.target.value)} />
          <button data-testid="btn-add-sector" disabled={busy || !name.trim()} className={BTN}><Plus className="h-4 w-4" /> Adicionar setor</button>
        </form>
        {!sectors.length && <p className="text-sm text-[#5E5880]">Nenhum setor cadastrado.</p>}
        <ul className="divide-y divide-[#ECE9F6]">
          {sectors.map((s) => (
            <li key={s.id} data-testid={`sector-row-${s.name}`} className="flex items-center gap-3 py-2.5">
              {editing?.id === s.id ? (
                <>
                  <input autoFocus className={`${INPUT} flex-1`} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") rename(); if (e.key === "Escape") setEditing(null); }} />
                  <button aria-label="Salvar" onClick={rename} disabled={busy} className={ICON_BTN}><Check className="h-4 w-4" /></button>
                  <button aria-label="Cancelar" onClick={() => setEditing(null)} className={ICON_BTN}><X className="h-4 w-4" /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 font-medium">{s.name}</span>
                  <span className="text-xs text-[#5E5880]">{s.employees} {s.employees === 1 ? "funcionário" : "funcionários"}</span>
                  <button aria-label={`Renomear ${s.name}`} title="Renomear" onClick={() => setEditing({ id: s.id, name: s.name })} className={ICON_BTN}><Pencil className="h-4 w-4" /></button>
                  <button aria-label={`Excluir ${s.name}`} title={s.employees ? "Há funcionários neste setor" : "Excluir"} disabled={busy || s.employees > 0}
                    onClick={() => window.confirm(`Excluir o setor ${s.name}?`) && run(() => http.delete(`/sectors/${s.id}`), `Setor ${s.name} excluído`)}
                    className={`${ICON_BTN} disabled:opacity-40`}><Trash2 className="h-4 w-4" /></button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
};

// ---------- Escalas ----------
const parseHours = (txt) => {
  const m = /^\s*(\d{1,2})(?:[:h](\d{2}))?\s*h?\s*$/i.exec(txt || "");
  return m ? Number(m[1]) * 60 + Number(m[2] || 0) : null;
};

const ScalesSection = ({ sectors, models, onChange }) => {
  const thisWeek = isoDate(mondayOf(new Date()));
  const [changes, setChanges] = useState([]);
  const [now, setNow] = useState({});
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ sector: "*", mode: models[0]?.id || "6x1", start: isoDate(addDays(parseIso(thisWeek), 7)) });
  const [model, setModel] = useState({ name: "", work_days: 5, hours: "" });

  const reload = useCallback(() => {
    http.get("/sectors/mode-changes").then(({ data }) => setChanges(data)).catch((err) => toast.error(errMsg(err)));
    http.get("/sectors/modes", { params: { week: thisWeek } }).then(({ data }) => setNow(data)).catch(() => {});
  }, [thisWeek]);
  useEffect(() => { reload(); }, [reload]);

  const sectorName = (key) => (key === "*" ? "Todos os setores" : sectors.find((s) => s.name.toLowerCase() === key)?.name || key);
  const run = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      reload();
      onChange();
      return true;
    } catch (err) {
      toast.error(errMsg(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const addChange = (e) => {
    e.preventDefault();
    const monday = isoDate(mondayOf(parseIso(form.start)));
    run(() => http.post("/sectors/mode-changes", form),
      `${sectorName(form.sector === "*" ? "*" : form.sector.toLowerCase())}: ${modeLabel(form.mode)} a partir de ${fmtDate(monday)}`);
  };
  const addModel = async (e) => {
    e.preventDefault();
    const weekly = model.hours.trim() ? parseHours(model.hours) : null;
    if (model.hours.trim() && !weekly) return toast.error("Horas na semana inválidas. Use, por exemplo, 42 ou 40:30.");
    const ok = await run(async () => {
      const { data } = await http.post("/scale-models", { name: model.name.trim(), work_days: Number(model.work_days), weekly_minutes: weekly });
      setScaleModels(data);
    }, `Escala ${model.name.trim()} cadastrada`);
    if (ok) setModel({ name: "", work_days: 5, hours: "" });
  };
  const removeModel = (m) => window.confirm(`Excluir a escala ${m.name}?`) && run(async () => {
    const { data } = await http.delete(`/scale-models/${m.id}`);
    setScaleModels(data);
  }, `Escala ${m.name} excluída`);

  const status = (c) => {
    if (c.start_week > thisWeek) return { text: "programada", cls: "bg-[#EEEBFB] text-[#4B3BB0]" };
    const later = changes.some((o) => o.start_week > c.start_week && o.start_week <= thisWeek && (o.sector === c.sector || o.sector === "*"));
    return later ? { text: "substituída", cls: "bg-[#F2F0F8] text-[#5E5880]" } : { text: "valendo", cls: "bg-[#E3F5EC] text-[#1D6B45]" };
  };
  const nameOf = (m) => (m ? modeLabel(m) : "");

  return (
    <>
      <PageTitle eyebrow="Configurações · qual escala cada setor usa e a partir de quando">Escalas</PageTitle>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className={CARD}>
          <h2 className="mb-1 font-display text-lg font-semibold">Escala desta semana</h2>
          <p className="mb-3 text-xs text-[#5E5880]">Semana de {fmtDate(thisWeek)}. Semanas já geradas mantêm a escala com que foram geradas.</p>
          <ul className="divide-y divide-[#ECE9F6]">
            {sectors.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                <span>{s.name}</span>
                <span className="rounded-full bg-[#F2F0F8] px-2.5 py-0.5 font-mono-data text-xs font-semibold">{nameOf(now[s.name.toLowerCase()] || "6x1")}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={CARD}>
          <h2 className="mb-1 font-display text-lg font-semibold">Mudar a escala a partir de uma data</h2>
          <p className="mb-3 text-xs text-[#5E5880]">Vale da segunda-feira da semana escolhida em diante. As semanas anteriores não mudam.</p>
          <form onSubmit={addChange} className="grid gap-2 sm:grid-cols-3">
            <select data-testid="change-sector" className={INPUT} value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })}>
              <option value="*">Todos os setores</option>
              {sectors.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
            <select data-testid="change-mode" className={INPUT} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input data-testid="change-start" type="date" min={thisWeek} className={INPUT} value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
            <button data-testid="btn-add-change" disabled={busy || !form.start} className={`${BTN} sm:col-span-3 justify-center`}><Plus className="h-4 w-4" /> Programar troca</button>
          </form>

          <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-[0.08em] text-[#5E5880]">Trocas cadastradas</h3>
          <ul className="divide-y divide-[#ECE9F6]">
            {changes.filter((c) => c.start_week !== "2000-01-03" || status(c).text === "valendo").map((c) => {
              const st = status(c);
              return (
                <li key={c.id} data-testid={`change-${c.sector}-${c.start_week}`} className="flex items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <b>{sectorName(c.sector)}</b> · {nameOf(c.mode)}
                    <span className="block text-xs text-[#5E5880]">{c.start_week === "2000-01-03" ? "desde o início" : `a partir de ${fmtDate(c.start_week)}`}</span>
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.text}</span>
                  {c.start_week > thisWeek && (
                    <button aria-label="Cancelar troca" title="Cancelar troca" disabled={busy}
                      onClick={() => window.confirm("Cancelar esta troca de escala?") && run(() => http.delete(`/sectors/mode-changes/${c.id}`), "Troca cancelada")}
                      className={ICON_BTN}><Trash2 className="h-4 w-4" /></button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className={CARD}>
        <h2 className="mb-1 font-display text-lg font-semibold">Modelos de escala</h2>
        <p className="mb-3 text-xs text-[#5E5880]">
          Com horas na semana, o horário de cada dia é ajustado sozinho (ex.: 42h em 5 dias = 8h24 por dia, mantendo a entrada e o intervalo da jornada).
          Sem horas, vale o horário da jornada.
        </p>
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {models.map((m) => (
            <div key={m.id} data-testid={`model-${m.id}`} className="flex items-start gap-2 rounded-2xl border border-[#E4E0F3] bg-white px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono-data text-sm font-bold">{m.name}{m.builtin && <span className="ml-2 rounded-full bg-[#F2F0F8] px-2 py-0.5 font-sans text-[10px] font-semibold text-[#5E5880]">do sistema</span>}</p>
                <p className="text-xs text-[#5E5880]">{modelDesc(m)}</p>
              </div>
              {!m.builtin && (
                <button aria-label={`Excluir ${m.name}`} onClick={() => removeModel(m)} disabled={busy} className={ICON_BTN}><Trash2 className="h-4 w-4" /></button>
              )}
            </div>
          ))}
        </div>
        <form onSubmit={addModel} className="grid gap-2 sm:grid-cols-4">
          <input data-testid="model-name" className={INPUT} placeholder="Nome (ex.: 4x3)" value={model.name} onChange={(e) => setModel({ ...model, name: e.target.value })} />
          <select data-testid="model-days" className={INPUT} value={model.work_days} onChange={(e) => setModel({ ...model, work_days: e.target.value })}>
            {[6, 5, 4, 3, 2, 1].map((d) => <option key={d} value={d}>{d} dia{d > 1 ? "s" : ""} de trabalho · {7 - d} folga{7 - d > 1 ? "s" : ""}</option>)}
          </select>
          <input data-testid="model-hours" className={INPUT} placeholder="Horas na semana (opcional, ex.: 42)" value={model.hours} onChange={(e) => setModel({ ...model, hours: e.target.value })} />
          <button data-testid="btn-add-model" disabled={busy || !model.name.trim()} className={`${BTN} justify-center`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Cadastrar escala
          </button>
        </form>
        {model.hours && parseHours(model.hours) && (
          <p className="mt-2 text-xs text-[#5E5880]">{fmtHours(Math.round(parseHours(model.hours) / model.work_days))} por dia trabalhado.</p>
        )}
      </div>
    </>
  );
};

// Aba Configurações: Setores, Escalas, Jornadas e Feriados (só o administrador altera)
export const SettingsPanel = ({ section, onSection, sectors, models, onChange, workloadsPanel, holidaysPanel }) => (
  <div className="space-y-6">
    <nav aria-label="Configurações" className="no-print flex flex-wrap gap-2">
      {SETTINGS_SECTIONS.map((s) => (
        <button
          key={s.id}
          data-testid={`settings-${s.id}`}
          onClick={() => onSection(s.id)}
          aria-current={section === s.id ? "page" : undefined}
          className={`inline-flex h-[38px] items-center gap-1.5 rounded-full border px-4 text-sm font-medium ${section === s.id ? "border-[#17142E] bg-[#17142E] text-white" : "border-[#E4E0F3] bg-white/75 text-[#3A3555] hover:border-[#17142E]"}`}
        >
          <s.icon className="h-4 w-4" /> {s.label}
        </button>
      ))}
    </nav>
    <AdminBar />
    {section === "setores" && <SectorsSection sectors={sectors} onChange={onChange} />}
    {section === "escalas" && <ScalesSection sectors={sectors} models={models} onChange={onChange} />}
    {section === "jornadas" && workloadsPanel}
    {section === "feriados" && holidaysPanel}
  </div>
);
